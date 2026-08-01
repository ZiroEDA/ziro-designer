// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Cycle Body Style (SCH_EDIT_TOOL::CycleBodyStyle).
 *
 * The second body style is KiCad's "De Morgan" alternate: the same gate drawn
 * with its inputs and output inverted. Body styles are numbered from 1, and a
 * unit drawn with style 0 belongs to *every* style, which is why the count is
 * the highest number declared rather than the number of unit blocks.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  cycleBodyStyle,
  bodyStyleCount,
  hasAlternateBodyStyle,
} from '@ziroeda/eeschema/src/tools/body_style.js';

/** A gate with a De Morgan alternate, and a resistor without one. */
const LIB = `(lib_symbols
  (symbol "L:AND" (property "Reference" "U" (at 0 0 0))
    (symbol "AND_0_1" (rectangle (start -2 -2) (end 2 2)))
    (symbol "AND_1_1" (pin input line (at -4 0 0) (length 2) (name "A") (number "1")))
    (symbol "AND_1_2" (pin input inverted (at -4 0 0) (length 2) (name "A") (number "1"))))
  (symbol "L:R" (property "Reference" "R" (at 0 0 0))
    (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)))
    (symbol "R_1_1" (pin passive line (at 0 4 270) (length 2) (name "~") (number "1")))))`;

const doc = readSchematic(
  parse(`(kicad_sch (version 20250114) (generator "x") ${LIB}
    (symbol (lib_id "L:AND") (at 10 10 0) (unit 1) (body_style 1) (uuid "u1")
      (property "Reference" "U1" (at 10 8 0)))
    (symbol (lib_id "L:R") (at 30 10 0) (unit 1) (body_style 1) (uuid "r1")
      (property "Reference" "R1" (at 30 8 0))))`),
);
const libs = new Map(doc.libSymbols.map((s) => [s.libId, s]));
const AND = refId('symbol', 'u1', 0);
const R = refId('symbol', 'r1', 1);

describe('counting body styles', () => {
  it('takes the highest number declared, not the unit count', () => {
    // AND has blocks 0_1, 1_1 and 1_2: three blocks, two body styles.
    expect(bodyStyleCount(libs.get('L:AND'))).toBe(2);
    expect(hasAlternateBodyStyle(libs.get('L:AND'))).toBe(true);
  });

  it('is 1 for a symbol with no alternate', () => {
    expect(bodyStyleCount(libs.get('L:R'))).toBe(1);
    expect(hasAlternateBodyStyle(libs.get('L:R'))).toBe(false);
  });

  it('is 1 for an unknown symbol rather than 0', () => {
    // A missing library symbol must not make the count zero and wrap oddly.
    expect(bodyStyleCount(undefined)).toBe(1);
  });
});

describe('cycling', () => {
  it('steps to the alternate and wraps back', () => {
    const once = cycleBodyStyle(doc, new Set([AND]), libs)!.apply(doc);
    expect(once.symbols[0]!.bodyStyle).toBe(2);
    const twice = cycleBodyStyle(once, new Set([AND]), libs)!.apply(once);
    expect(twice.symbols[0]!.bodyStyle).toBe(1);
  });

  it('skips a symbol with nothing to cycle', () => {
    // A mixed selection must not silently renumber the ones that had only one
    // body style.
    const out = cycleBodyStyle(doc, new Set([AND, R]), libs)!.apply(doc);
    expect(out.symbols[0]!.bodyStyle).toBe(2);
    expect(out.symbols[1]!.bodyStyle).toBe(1);
  });

  it('does nothing when no selected symbol has an alternate', () => {
    expect(cycleBodyStyle(doc, new Set([R]), libs)).toBeNull();
    expect(cycleBodyStyle(doc, new Set(), libs)).toBeNull();
  });

  it('undoes exactly, and the result saves', () => {
    const cmd = cycleBodyStyle(doc, new Set([AND]), libs)!;
    const after = cmd.apply(doc);
    expect(
      cmd
        .invert(doc)
        .apply(after)
        .symbols.map((s) => s.bodyStyle),
    ).toEqual(doc.symbols.map((s) => s.bodyStyle));
    expect(readSchematic(parse(serializeSchematic(after))).symbols[0]!.bodyStyle).toBe(2);
  });
});
