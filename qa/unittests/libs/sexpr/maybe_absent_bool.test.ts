// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `parseMaybeAbsentBool`, the helper both KiCad s-expression parsers keep a copy
 * of — `PCB_IO_KICAD_SEXPR_PARSER::parseMaybeAbsentBool`
 * (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp:265) and
 * `SCH_IO_KICAD_SEXPR_PARSER::parseMaybeAbsentBool`
 * (eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_parser.cpp:147).
 *
 * Its own comment names the three shapes it accepts: `e.g. "hide", "hide)",
 * "(hide yes)"`. The first two both mean `aDefaultValue`; only the third carries
 * a value of its own. What separates them in the C++ is `PrevTok() == T_LEFT`,
 * which here is the difference between a bare `SAtom` sitting in the parent's
 * items and a child `SList`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { ExpectingError, maybeAbsentBool, maybeAbsentBoolOf } from '@ziroeda/sexpr/src/query.js';
import { childNamed } from '@ziroeda/sexpr/src/query.js';

const node = (src: string) => parse(src);

describe('parseMaybeAbsentBool: the three shapes', () => {
  it('reads a bare positional token as aDefaultValue, not as absent', () => {
    // `(fp_text value "G***" (at 0.75 0) (layer "F.SilkS") hide …)` — the shape
    // the else branch at :286 handles ("hide"), returning aDefaultValue.
    const n = node('(fp_text value "G***" (at 0.75 0) hide)');
    expect(maybeAbsentBool(n, 'hide', true, 'yes-no-true-false')).toBe(true);
    // The same token with the other default, to prove the value comes from the
    // call site rather than from the token's name.
    expect(maybeAbsentBool(n, 'hide', false, 'yes-no-true-false')).toBe(false);
  });

  it('reads a list with no argument as aDefaultValue — the DSN_RIGHT early return', () => {
    // ":272 — if( static_cast<int>( token ) == DSN_RIGHT ) return aDefaultValue;"
    const n = node('(pad "1" smd rect (locked) (size 1 1))');
    expect(maybeAbsentBool(n, 'locked', true, 'yes-no-true-false')).toBe(true);
    expect(maybeAbsentBool(n, 'locked', false, 'yes-no-true-false')).toBe(false);
  });

  it('reads an explicit bool from a list, ignoring aDefaultValue', () => {
    const yes = node('(gr_text "x" (hide yes))');
    const no = node('(gr_text "x" (hide no))');
    expect(maybeAbsentBool(yes, 'hide', false, 'yes-no-true-false')).toBe(true);
    expect(maybeAbsentBool(no, 'hide', true, 'yes-no-true-false')).toBe(false);
  });

  it('returns undefined when the token appears in neither shape', () => {
    // Absent is not the same as present-with-the-default: the caller has to be
    // able to leave the item's own constructed value standing.
    const n = node('(gr_text "x" (at 0 0))');
    expect(maybeAbsentBool(n, 'hide', true, 'yes-no-true-false')).toBeUndefined();
    expect(maybeAbsentBool(n, 'locked', false, 'yes-no-true-false')).toBeUndefined();
  });

  it('does not mistake a quoted string for the token', () => {
    // KiCad's tokenizer gives DSN_STRING for `"hide"`, never T_hide, so a
    // footprint or a text whose *content* is the word must not read as a flag.
    const n = node('(gr_text "hide" (at 0 0))');
    expect(maybeAbsentBool(n, 'hide', true, 'yes-no-true-false')).toBeUndefined();
  });

  it('does not mistake the parent’s own head token for a child', () => {
    const n = node('(hide (at 0 0))');
    expect(maybeAbsentBool(n, 'hide', true, 'yes-no-true-false')).toBeUndefined();
  });

  it('does not look inside sub-lists', () => {
    // `unlocked` positional inside `(at …)` is parsed by the `case T_at` arm,
    // not by this helper; a flag scan that descended would double-count it.
    const n = node('(fp_text value "x" (at 1 2 unlocked))');
    expect(maybeAbsentBool(n, 'unlocked', true, 'yes-no-true-false')).toBeUndefined();
  });

  it('lets the last occurrence win, as a token loop does', () => {
    // Each `case` in upstream's `for( token = NextTok(); … )` assigns over the
    // last, so a hand-edited file naming the flag twice keeps the later one.
    expect(maybeAbsentBool(node('(x (hide yes) (hide no))'), 'hide', true, 'yes-no')).toBe(false);
    expect(maybeAbsentBool(node('(x (hide no) (hide yes))'), 'hide', true, 'yes-no')).toBe(true);
    expect(maybeAbsentBool(node('(x (hide no) hide)'), 'hide', true, 'yes-no')).toBe(true);
  });
});

describe('parseMaybeAbsentBool: the dialects', () => {
  it("takes true/false in pcbnew's copy", () => {
    // pcb_io_kicad_sexpr_parser.cpp:274 — `token == T_yes || token == T_true`.
    expect(maybeAbsentBool(node('(x (hide true))'), 'hide', false, 'yes-no-true-false')).toBe(true);
    expect(maybeAbsentBool(node('(x (hide false))'), 'hide', true, 'yes-no-true-false')).toBe(
      false,
    );
  });

  it("rejects true/false in eeschema's copy", () => {
    // sch_io_kicad_sexpr_parser.cpp:158 has no T_true arm, so `true` reaches
    // Expecting( "yes or no" ).
    expect(() => maybeAbsentBool(node('(x (hide true))'), 'hide', false, 'yes-no')).toThrow(
      ExpectingError,
    );
  });
});

describe('parseMaybeAbsentBool: Expecting("yes or no")', () => {
  it('throws on a word that is not a boolean, rather than silently defaulting', () => {
    // :279 — `else Expecting( "yes or no" );`. Substituting aDefaultValue here
    // is exactly the silent wrong answer this helper exists to prevent.
    expect(() => maybeAbsentBool(node('(x (hide maybe))'), 'hide', true, 'yes-no')).toThrow(
      /Expecting "yes or no"/,
    );
  });

  it('throws on a quoted argument', () => {
    expect(() => maybeAbsentBool(node('(x (hide "yes"))'), 'hide', true, 'yes-no')).toThrow(
      ExpectingError,
    );
  });

  it('throws on a nested list where the bool belongs', () => {
    expect(() => maybeAbsentBool(node('(x (hide (yes)))'), 'hide', true, 'yes-no')).toThrow(
      ExpectingError,
    );
  });

  it('throws when a second argument would fail NeedRIGHT()', () => {
    // :283 — NeedRIGHT() straight after the bool.
    expect(() => maybeAbsentBool(node('(x (hide yes no))'), 'hide', true, 'yes-no')).toThrow(
      ExpectingError,
    );
  });
});

describe('maybeAbsentBoolOf: the list half on its own', () => {
  it('is what a caller walking children in file order needs', () => {
    // parsePAD / parsePCB_VIA apply remove_unused_layers and keep_end_layers in
    // the order they appear, so those call sites hold the loop themselves and
    // reach for this half.
    const root = node('(via (remove_unused_layers) (keep_end_layers no))');
    expect(maybeAbsentBoolOf(childNamed(root, 'remove_unused_layers')!, true, 'yes-no')).toBe(true);
    expect(maybeAbsentBoolOf(childNamed(root, 'keep_end_layers')!, true, 'yes-no')).toBe(false);
  });

  it('carries the token name into the error message', () => {
    const root = node('(via (free perhaps))');
    expect(() => maybeAbsentBoolOf(childNamed(root, 'free')!, true, 'yes-no')).toThrow(
      /\(free perhaps\)/,
    );
  });
});
