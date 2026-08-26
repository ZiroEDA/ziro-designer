// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import {
  CombinedMatcherContext,
  EdaCombinedMatcher,
  netclassPatternMatches,
  searchTerm,
  type SearchTerm,
} from '@ziroeda/common/src/eda_pattern_match.js';

// Weighted terms as LIB_SYMBOL::cacheSearchTerms builds them for Device:R.
function deviceR(): SearchTerm[] {
  return [
    searchTerm('Device', 4),
    searchTerm('R', 8, true),
    searchTerm('Device:R', 16, true),
    searchTerm('R', 4), // keyword token
    searchTerm('res resistor', 1),
    searchTerm('Resistor', 1),
  ];
}

describe('EdaCombinedMatcher', () => {
  it('finds plain substrings case-insensitively', () => {
    const m = new EdaCombinedMatcher('resist');
    expect(m.find('Resistor')).toBe(0);
    expect(m.find('photoresistor')).toBe(5);
    expect(m.find('capacitor')).toBe(-1);
  });

  it('matches wildcard patterns', () => {
    const m = new EdaCombinedMatcher('74ls*4');
    expect(m.find('74ls04')).toBe(0);
    expect(m.find('74hc04')).toBe(-1);
  });

  it('matches regex patterns', () => {
    const m = new EdaCombinedMatcher('^cap.*tor$');
    expect(m.find('capacitor')).toBe(0);
  });

  it('scores an exact name match into the exact tier', () => {
    const m = new EdaCombinedMatcher('r');
    const { score, exact } = m.scoreTerms(deviceR());
    expect(exact).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it('weights matches at the start above matches elsewhere', () => {
    const m = new EdaCombinedMatcher('res');
    const atStart = m.scoreTerms([searchTerm('res resistor', 1)]);
    const inside = m.scoreTerms([searchTerm('thermal res', 1)]);
    expect(atStart.score).toBeGreaterThan(inside.score);
    expect(atStart.exact).toBe(false);
  });

  it('does not mark a keyword equalling the query as exact', () => {
    const m = new EdaCombinedMatcher('resistor');
    const { exact } = m.scoreTerms([searchTerm('resistor', 4, false)]);
    expect(exact).toBe(false);
  });

  it('returns zero when nothing matches', () => {
    const m = new EdaCombinedMatcher('zzz');
    expect(m.scoreTerms(deviceR()).score).toBe(0);
  });
});

/**
 * WHICH patterns get a regex matcher at all.
 *
 * `EDA_PATTERN_MATCH_REGEX::SetPattern` (common/eda_pattern_match.cpp:80-104)
 * accepts a pattern only if it is fully anchored (`^…$`) or slash-delimited
 * (`/…/`, trailing slash optional) — "for now regular expressions must be
 * explicit". Everything else returns false and `AddMatcher` drops the matcher,
 * leaving CTX_LIBITEM with the escaped wildcard and the plain substring, both
 * of which look for the pattern LITERALLY.
 *
 * So a metacharacter typed into the search box is a character, not syntax. The
 * counts below are KiCad 10.0.5's own, measured over the whole of
 * /usr/share/kicad/symbols/Device.kicad_sym with qa/probes/chooser_score:
 *
 *     r+   0 rows      c.   0 rows      (R)   0 rows
 *     r*Var  18 rows   /^R_Var/  2 rows   r_var  2 rows
 *
 * We used to compile any pattern holding a metacharacter, so `r+` became /r+/
 * and matched every symbol with an r in it.
 */
describe('EdaCombinedMatcher treats an unanchored metacharacter as a literal', () => {
  it('does not read `r+` as a regex', () => {
    const m = new EdaCombinedMatcher('r+');
    expect(m.find('r_variable')).toBe(-1);
    expect(m.find('resistor')).toBe(-1);
    // ...but it still finds the literal two characters.
    expect(m.find('r+5v rail')).toBe(0);
  });

  it('does not read `c.` or `(R)` as a regex', () => {
    expect(new EdaCombinedMatcher('c.').find('capacitor')).toBe(-1);
    expect(new EdaCombinedMatcher('c.').find('c.1 net')).toBe(0);
    expect(new EdaCombinedMatcher('(r)').find('resistor')).toBe(-1);
    expect(new EdaCombinedMatcher('(r)').find('net (r) here')).toBe(4);
  });

  it('still reads an anchored or slash-delimited pattern as a regex', () => {
    expect(new EdaCombinedMatcher('^r$').find('r')).toBe(0);
    expect(new EdaCombinedMatcher('^r$').find('r_variable')).toBe(-1);
    expect(new EdaCombinedMatcher('/^r_/').find('r_variable')).toBe(0);
    expect(new EdaCombinedMatcher('/^r_/').find('thermistor')).toBe(-1);
    // The trailing slash is optional: "requiring a '/' on the end means they
    // get no feedback while they type."
    expect(new EdaCombinedMatcher('/^r_').find('r_variable')).toBe(0);
  });

  it('still reads `*` and `?` as wildcards', () => {
    expect(new EdaCombinedMatcher('r*var').find('r_variable')).toBe(0);
    expect(new EdaCombinedMatcher('r?var').find('r_variable')).toBe(0);
    expect(new EdaCombinedMatcher('r?var').find('r__variable')).toBe(-1);
  });
});

/**
 * EDA_COMBINED_MATCHER's CTX_NETCLASS arm (eda_pattern_match.cpp:413): an
 * anchored regex matcher and an anchored wildcard matcher, and nothing else —
 * no substring matcher, and no case folding.
 */
describe('EdaCombinedMatcher in CTX_NETCLASS', () => {
  const netclass = (pattern: string) =>
    new EdaCombinedMatcher(pattern, CombinedMatcherContext.NETCLASS);

  it('has no substring matcher, unlike every other context', () => {
    expect(netclass('GND').startsWith('GNDA')).toBe(false);
    // CTX_LIBITEM does fall back to the substring matcher.
    expect(new EdaCombinedMatcher('GND').find('AGND')).toBe(1);
  });

  it('builds the anchored wildcard matcher even with no * or ? in the pattern', () => {
    // `+3V3` is not a compilable regex ("nothing to repeat"), so only the
    // wildcard matcher survives — and it must still exist.
    expect(netclass('+3V3').startsWith('+3V3')).toBe(true);
    expect(netclass('+3V3').startsWith('+3V3A')).toBe(false);
  });

  it('anchors both matchers, so StartsWith means "matches the whole name"', () => {
    expect(netclass('D*').startsWith('D1')).toBe(true);
    expect(netclass('*D').startsWith('SD')).toBe(true);
    expect(netclass('D').startsWith('D1')).toBe(false);
  });

  it('does not fold case', () => {
    expect(netclass('GND').startsWith('gnd')).toBe(false);
    expect(netclass('GND').startsWith('GND')).toBe(true);
  });

  it('anchors per alternation branch, and StartsWith wants position 0', () => {
    // REGEX_ANCHORED wraps the whole pattern, so `a|b` compiles to `^a|b$` and
    // the anchors bind to their own branch. StartsWith takes a match at 0, so
    // the `^a` branch matches "ax" while the `b$` branch matching "xb" at
    // position 1 does not. This is wxRegEx GetMatch's answer too.
    expect(netclass('a|b').startsWith('ax')).toBe(true);
    expect(netclass('a|b').startsWith('xb')).toBe(false);
    expect(netclass('a|b').startsWith('a')).toBe(true);
    expect(netclass('a|b').startsWith('b')).toBe(true);
  });
});

/**
 * `EDA_COMBINED_MATCHER( pattern, CTX_NETCLASS )` (net_settings.cpp:614) is an
 * anchored REGEX matcher plus an anchored WILDCARD matcher, and StartsWith()
 * (net_settings.cpp:807) takes either. It is not a glob, and it is not
 * case-insensitive.
 */
describe('netclassPatternMatches', () => {
  it('anchors the pattern', () => {
    expect(netclassPatternMatches('VCC', 'VCC')).toBe(true);
    expect(netclassPatternMatches('VCC', 'XVCC')).toBe(false);
    expect(netclassPatternMatches('VCC', 'VCCX')).toBe(false);
  });

  it('handles * and ?', () => {
    expect(netclassPatternMatches('V*', 'VBUS')).toBe(true);
    expect(netclassPatternMatches('D?', 'D1')).toBe(true);
    expect(netclassPatternMatches('D?', 'D12')).toBe(false);
  });

  it('reads regex metacharacters as regex AND as literals, because both matchers run', () => {
    // The wildcard matcher escapes the brackets, so the literal net still
    // matches; the anchored regex matcher does not, so "NET1" matches too.
    expect(netclassPatternMatches('NET(1)', 'NET(1)')).toBe(true);
    expect(netclassPatternMatches('NET(1)', 'NET1')).toBe(true);
  });

  it('selects on a regular expression, which a plain glob silently could not', () => {
    // Every one of these matched NOTHING under the old glob, so the nets fell
    // through to Default and were fabricated with Default's clearances.
    expect(['GND', 'VCC', 'SDA'].filter((n) => netclassPatternMatches('VCC|GND', n))).toEqual([
      'GND',
      'VCC',
    ]);
    expect(['LED1', 'LED2', 'LED10'].filter((n) => netclassPatternMatches('LED[12]', n))).toEqual([
      'LED1',
      'LED2',
    ]);
    expect(['CLK', 'CLK_P', 'CLK_N'].filter((n) => netclassPatternMatches('CLK_[PN]', n))).toEqual([
      'CLK_P',
      'CLK_N',
    ]);
    expect(netclassPatternMatches('^GND$', 'GND')).toBe(true);
    expect(netclassPatternMatches('.*', 'anything')).toBe(true);
    expect(netclassPatternMatches('LED.', 'LEDA')).toBe(true);
  });

  it('lets a regex quantifier widen the selection past the literal net', () => {
    // `GND+` is a plausible net name AND a valid regex. KiCad takes both.
    expect(
      ['GND', 'GNDD', 'GNDDD', 'GND+', 'GN'].filter((n) => netclassPatternMatches('GND+', n)),
    ).toEqual(['GND', 'GNDD', 'GNDDD', 'GND+']);
  });

  it('matches case-sensitively, as wxRegEx without wxRE_ICASE does', () => {
    expect(netclassPatternMatches('GND', 'gnd')).toBe(false);
    expect(netclassPatternMatches('gnd', 'GND')).toBe(false);
    expect(netclassPatternMatches('GND*', 'gnd')).toBe(false);
    expect(netclassPatternMatches('usb_d*', 'USB_D+')).toBe(false);
    expect(netclassPatternMatches('USB_D*', 'USB_D+')).toBe(true);
  });

  it('takes a trailing /* as both "any child" and "the parent itself"', () => {
    // The wildcard matcher gives ^/Power/.*$; the regex matcher reads the `/*`
    // as "zero or more slashes" and gives ^/Powe r/*$, which also spans /Power.
    expect(netclassPatternMatches('/Power/*', '/Power/VCC')).toBe(true);
    expect(netclassPatternMatches('/Power/*', '/Power')).toBe(true);
  });

  it('drops a pattern that will not compile rather than matching everything', () => {
    // AddMatcher only keeps a matcher whose SetPattern succeeded; the wildcard
    // matcher escapes the bracket and survives, so the literal still matches.
    expect(netclassPatternMatches('LED[', 'LED[')).toBe(true);
    expect(netclassPatternMatches('LED[', 'LEDX')).toBe(false);
  });
});

describe('netclassPatternMatches is a whole-name test, not a prefix test', () => {
  it('does not select every net that merely begins with the pattern', () => {
    // The schematic editor read EDA_COMBINED_MATCHER::StartsWith as "the
    // pattern is a prefix of the net name" and returned netName.startsWith().
    // StartsWith actually means "a matcher matched from position 0", and both
    // CTX_NETCLASS matchers are anchored at BOTH ends.
    const nets = ['GND', 'GNDA', 'GND_ANALOG', 'AGND'];
    expect(nets.filter((n) => netclassPatternMatches('GND', n))).toEqual(['GND']);
    expect(nets.filter((n) => netclassPatternMatches('GND*', n))).toEqual([
      'GND',
      'GNDA',
      'GND_ANALOG',
    ]);
  });

  it('anchors a wildcard pattern at the end too', () => {
    expect(netclassPatternMatches('*_P', 'CLK_P')).toBe(true);
    expect(netclassPatternMatches('CLK_*', 'CLK_P_EXTRA')).toBe(true);
    expect(netclassPatternMatches('*_P', 'CLK_P_EXTRA')).toBe(false);
  });

  it('rejects an empty pattern outright', () => {
    expect(netclassPatternMatches('', '')).toBe(false);
    expect(netclassPatternMatches('', 'GND')).toBe(false);
  });
});
