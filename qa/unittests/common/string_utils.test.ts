// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The shared string helpers, against KiCad's own cases where it has them:
 * `qa/tests/common/test_kicad_string.cpp` covers GetTrailingInt (TrailingInt),
 * StrNumCmp (NaturalNumberCompare) and ValueStringCompare (ValueCompare).
 * WildCompareString has no upstream unit test, so its cases are read off
 * `common/string_utils.cpp:910` and off the call sites that use it.
 */
import { describe, it, expect } from 'vitest';
import {
  escapeLibId,
  getTrailingInt,
  splitString,
  strNumCmp,
  valueStringCompare,
  wildCompareString,
} from '@ziroeda/common/src/string_utils.js';

describe('wildCompareString', () => {
  it('matches case-insensitively when the caller asks for it', () => {
    // Every WildCompareString call site in KiCad passes case_sensitive =
    // false: eeschema/net_navigator.cpp:404,
    // eeschema/dialogs/dialog_global_edit_text_and_graphics.cpp:309,
    // dialog_change_symbols.cpp:484, pcbnew/pcbexpr_evaluator.cpp:182,
    // pcbnew/dialogs/dialog_exchange_footprints.cpp:178, and the rest. So a
    // netclass filter typed `default*` has to find `Default`.
    expect(wildCompareString('default*', 'Default', false)).toBe(true);
    expect(wildCompareString('R*', 'r1', false)).toBe(true);
    expect(wildCompareString('r1', 'R1', false)).toBe(true);
    expect(wildCompareString('HIGHSPEED', 'HighSpeed', false)).toBe(true);
  });

  it('matches case-sensitively when the caller asks for that instead', () => {
    // wxString::Matches, which is what the reannotate exclusion list and the
    // DRC area selector use, folds no case.
    expect(wildCompareString('default*', 'Default', true)).toBe(false);
    expect(wildCompareString('R*', 'r1', true)).toBe(false);
    expect(wildCompareString('R*', 'R1', true)).toBe(true);
  });

  it('defaults to case-sensitive, as include/string_utils.h:233 does', () => {
    expect(wildCompareString('r1', 'R1')).toBe(false);
    expect(wildCompareString('R1', 'R1')).toBe(true);
  });

  it('lets `*` stand for an empty run', () => {
    expect(wildCompareString('R*', 'R', false)).toBe(true);
    expect(wildCompareString('*R', 'R', false)).toBe(true);
    expect(wildCompareString('R*1', 'R1', false)).toBe(true);
    expect(wildCompareString('**', 'R', false)).toBe(true);
  });

  it('lets `*` stand for a run of several characters', () => {
    expect(wildCompareString('R*', 'R1234', false)).toBe(true);
    expect(wildCompareString('*Rail', 'PowerRail', false)).toBe(true);
    expect(wildCompareString('P*R*l', 'PowerRail', false)).toBe(true);
    // The backtracking case: the first `*` must give characters back.
    expect(wildCompareString('*abc', 'abcXabc', false)).toBe(true);
    expect(wildCompareString('*ab*cd', 'ab_ab_cd', false)).toBe(true);
  });

  it('lets `?` stand for exactly one character, never zero', () => {
    expect(wildCompareString('Hi?Speed', 'Hi-Speed', false)).toBe(true);
    expect(wildCompareString('Hi?Speed', 'HiSpeed', false)).toBe(false);
    expect(wildCompareString('Hi?Speed', 'Hi--Speed', false)).toBe(false);
    expect(wildCompareString('R?', 'R1', false)).toBe(true);
    expect(wildCompareString('R?', 'R', false)).toBe(false);
    expect(wildCompareString('?', '', false)).toBe(false);
  });

  it('treats every regex metacharacter in the pattern as a literal', () => {
    // A translation to a regular expression is where these leak. Upstream
    // walks the pattern directly, so there is no escape set to get wrong.
    for (const ch of ['.', '+', '^', '$', '(', ')', '[', ']', '|', '\\']) {
      expect(wildCompareString(`Net${ch}Cu`, `Net${ch}Cu`, false)).toBe(true);
      expect(wildCompareString(`Net${ch}Cu`, 'NetXCu', false)).toBe(false);
    }
    expect(wildCompareString('a{2}', 'aa', false)).toBe(false);
    expect(wildCompareString('a{2}', 'a{2}', false)).toBe(true);
    expect(wildCompareString('[a-z]', 'q', false)).toBe(false);
  });

  it('matches nothing but the empty string against an empty pattern', () => {
    expect(wildCompareString('', '', false)).toBe(true);
    expect(wildCompareString('', 'R1', false)).toBe(false);
  });

  it('matches anything at all against a pattern of just `*`', () => {
    expect(wildCompareString('*', '', false)).toBe(true);
    expect(wildCompareString('*', 'R1', false)).toBe(true);
    expect(wildCompareString('*', 'anything.at[all]', false)).toBe(true);
  });

  it('anchors both ends: a pattern is not a substring search', () => {
    expect(wildCompareString('R', 'R1', false)).toBe(false);
    expect(wildCompareString('1', 'R1', false)).toBe(false);
    expect(wildCompareString('ail', 'PowerRail', false)).toBe(false);
  });
});

describe('getTrailingInt', () => {
  // qa/tests/common/test_kicad_string.cpp, BOOST_AUTO_TEST_CASE( TrailingInt ).
  it('matches KiCad case for case', () => {
    const cases: [string, number][] = [
      ['', 0],
      ['foo', 0],
      ['0', 0],
      ['42', 42],
      ['1001', 1001],
      ['Foo42', 42],
      ['12Foo42', 42],
      ['12Foo4.2', 2], // no dots
    ];
    for (const [text, want] of cases) expect(getTrailingInt(text)).toBe(want);
  });

  it('is the trailing run only, so a sign or a space ends it', () => {
    expect(getTrailingInt('R-10')).toBe(10);
    expect(getTrailingInt('R10 ')).toBe(0);
    expect(getTrailingInt('R?')).toBe(0);
  });
});

describe('strNumCmp', () => {
  // qa/tests/common/test_kicad_string.cpp, NaturalNumberCompare. The pair is
  // (case sensitive, case insensitive), as upstream checks both.
  it('matches KiCad case for case', () => {
    const cases: [string, string, number, number][] = [
      ['a', 'b', -1, -1],
      ['b', 'a', 1, 1],
      ['a', 'a', 0, 0],
      ['a', 'A', 1, 0],
      ['A', 'a', -1, 0],
      ['a', '', 1, 1],
      ['', 'a', -1, -1],
      ['10', '2', 1, 1],
      ['2', '10', -1, -1],
      ['01', '1', 0, 0],
      ['01a', '1b', -1, -1],
      ['10 ten', '2 two', 1, 1],
      ['SYM1', 'sym2', -1, -1],
      ['sym2', 'SYM1', 1, 1],
      ['a10b20c30', 'a10b20c31', -1, -1],
      ['u10', 'U10', 1, 0],
      ['U10.1', 'U10.10', -1, -1],
      ['U10.A', 'U10.a', -1, 0],
    ];
    for (const [a, b, sensitive, insensitive] of cases) {
      expect(Math.sign(strNumCmp(a, b))).toBe(sensitive);
      expect(Math.sign(strNumCmp(a, b, true))).toBe(insensitive);
    }
  });

  it('defaults to case-SENSITIVE, as StrNumCmp does', () => {
    // include/string_utils.h:203 — aIgnoreCase defaults to false. eeschema
    // used to re-export a wrapper that defaulted it to true, which quietly
    // inverted the default for anyone who left the argument off.
    expect(strNumCmp('r2', 'R2')).not.toBe(0);
    expect(strNumCmp('r2', 'R2', true)).toBe(0);
  });
});

describe('valueStringCompare', () => {
  // qa/tests/common/test_kicad_string.cpp, BOOST_AUTO_TEST_CASE( ValueCompare ).
  it('matches KiCad case for case', () => {
    const cases: [string, string, number][] = [
      ['100', '10', 1],
      ['10K', '1K', 1],
      ['10K', '1K5', 1],
      ['10K', '10,000', 0],
      ['1K5', '1.5K', 0],
      ['1K5', '1,5K', 0],
      ['K5', '1K', -1],
      ['1K5', 'K55', 1],
      ['1R5', '1.5', 0],
      ['1u5F', '1.5uF', 0],
      ['1µ5', '1u5', 0],
    ];
    for (const [a, b, want] of cases) expect(Math.sign(valueStringCompare(a, b))).toBe(want);
  });

  it('orders the values a BOM column actually holds', () => {
    expect(valueStringCompare('10uF', '100uF')).toBeLessThan(0);
    expect(valueStringCompare('1mF', '100uF')).toBeGreaterThan(0);
    expect(valueStringCompare('4k7', '4k7')).toBe(0);
  });

  it('compares unescaped text, as ValueStringCompare does first thing', () => {
    // common/string_utils.cpp:1160-1161 runs both sides through
    // UnescapeString, so a value stored with a `{…}` escape sorts as the text
    // the user typed rather than as its escaped spelling.
    expect(valueStringCompare('1{slash}5', '1/5')).toBe(0);
    expect(valueStringCompare('A{space}1', 'A 1')).toBe(0);
  });
});

describe('splitString', () => {
  // common/string_utils.cpp:1213, the split ValueStringCompare is built on.
  it('breaks a value into preamble, digits and ending', () => {
    // The header's own example: "C10A is split to C 10 A".
    expect(splitString('C10A')).toEqual({ beginning: 'C', digits: '10', end: 'A' });
    expect(splitString('foo')).toEqual({ beginning: 'foo', digits: '', end: '' });
    expect(splitString('')).toEqual({ beginning: '', digits: '', end: '' });
  });

  it('moves an old-school decimal separator out of the digit run', () => {
    expect(splitString('4k7')).toEqual({ beginning: '', digits: '4.7', end: 'k' });
    expect(splitString('1u5F')).toEqual({ beginning: '', digits: '1.5', end: 'uF' });
    // A leading separator counts too: K5 is 0.5 K, which is what makes it sort
    // below 1K (test_kicad_string.cpp: { "K5", "1K" } -> -1).
    expect(splitString('K5')).toEqual({ beginning: '', digits: '.5', end: 'K' });
  });

  it('only treats the 14 old-school separator characters as one', () => {
    // The set is p n µ μ u m L R F k K M G T, not "any letter": `C` is a
    // preamble above, while `R` really is the IEC 60062 ohm separator, so
    // `R10` is 0.10 R and not the reference designator it looks like.
    expect(splitString('R10')).toEqual({ beginning: '', digits: '.10', end: 'R' });
    expect(splitString('X10')).toEqual({ beginning: 'X', digits: '10', end: '' });
  });
});

/**
 * `EscapeString( …, CTX_LIBID )` — the escapes a LIB_ID part carries so that a
 * name a user gave a symbol can still be written into one.
 */
describe('escapeLibId', () => {
  it('escapes each character LIB_ID::isLegalChar rejects', () => {
    expect(escapeLibId('a<b')).toBe('a{lt}b');
    expect(escapeLibId('a>b')).toBe('a{gt}b');
    expect(escapeLibId('a:b')).toBe('a{colon}b');
    expect(escapeLibId('a"b')).toBe('a{dblquote}b');
    expect(escapeLibId('a\\b')).toBe('a{backslash}b');
  });

  /**
   * `converted += wxEmptyString;    // drop` — a newline has no escape token,
   * so it is removed rather than turned into one. An escape would round-trip
   * back into a character LIB_ID still forbids.
   */
  it('drops a newline and a carriage return rather than escaping them', () => {
    expect(escapeLibId('a\nb')).toBe('ab');
    expect(escapeLibId('a\r\nb')).toBe('ab');
  });

  /** "We no longer escape '/' in LIB_IDs, but we used to" — CTX_LEGACY_LIBID's
   *  `{slash}` is the one thing the modern context does not do. */
  it('leaves a slash, a brace and a space alone', () => {
    expect(escapeLibId('a/b')).toBe('a/b');
    expect(escapeLibId('a{b}c')).toBe('a{b}c');
    expect(escapeLibId('a b')).toBe('a b');
  });

  it('leaves a name that needs nothing exactly as it was', () => {
    expect(escapeLibId('Conn_01x02')).toBe('Conn_01x02');
  });
});
