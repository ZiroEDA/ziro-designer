// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import {
  CombinedMatcherContext,
  EdaCombinedMatcher,
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
