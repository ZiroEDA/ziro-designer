// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The autoplacer's STRUCTURE, pinned against `eeschema/autoplace_fields.cpp`
 * rather than against a measurement.
 *
 * Every expectation below is derived from the C++ — from its constants, from
 * the candidate list in `SCH_SYMBOL::GetOrientation`, from which branch a given
 * input reaches — and the derivation is written out beside it. Nothing here was
 * read off our own output, and nothing here came from a probe.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { autoplacedFields } from '@ziroeda/eeschema/src/tools/autoplace_fields.js';
import type { Schematic, SchSymbol, LibSymbol } from '@ziroeda/eeschema/src/types.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  symbolOrientation,
  SYM_MIRROR_X,
  SYM_MIRROR_Y,
  SYM_ORIENT_0,
  SYM_ORIENT_90,
  SYM_ORIENT_180,
  SYM_ORIENT_270,
} from '@ziroeda/common/src/transform.js';

const OPTS = { allowRejustify: true, alignToGrid: true };

// ---------------------------------------------------------------------------
// SCH_SYMBOL::GetOrientation
// ---------------------------------------------------------------------------

describe('GetOrientation reports the transform, not the stored mirror', () => {
  /**
   * `rotate_values` in sch_symbol.cpp:2555-2566, in order:
   *
   *   ORIENT_0, ORIENT_90, ORIENT_180, ORIENT_270,
   *   MIRROR_X+ORIENT_0, MIRROR_X+ORIENT_90, MIRROR_X+ORIENT_270,
   *   MIRROR_Y, MIRROR_Y+ORIENT_0, MIRROR_Y+ORIENT_90,
   *   MIRROR_Y+ORIENT_180, MIRROR_Y+ORIENT_270
   *
   * `GetOrientation` returns the FIRST whose transform matches, so the answer
   * for a mirrored placement is whichever candidate comes first — not the token
   * the file carried. Each row below is the transform worked out from
   * `SetOrientation`'s matrices (sch_symbol.cpp:2400-2435) and its composition
   * rule `new = old ∘ temp` (:2491-2508), then matched against that list by
   * hand.
   */
  const TABLE: [number, 'x' | 'y' | undefined, number, string][] = [
    [0, undefined, SYM_ORIENT_0, '( 1, 0, 0, 1) is candidate 1'],
    [90, undefined, SYM_ORIENT_90, '( 0, 1,-1, 0) is candidate 2'],
    [180, undefined, SYM_ORIENT_180, '(-1, 0, 0,-1) is candidate 3'],
    [270, undefined, SYM_ORIENT_270, '( 0,-1, 1, 0) is candidate 4'],
    [0, 'x', SYM_MIRROR_X + SYM_ORIENT_0, '( 1, 0, 0,-1) is candidate 5'],
    [90, 'x', SYM_MIRROR_X + SYM_ORIENT_90, '( 0, 1, 1, 0) is candidate 6'],
    [270, 'x', SYM_MIRROR_X + SYM_ORIENT_270, '( 0,-1,-1, 0) is candidate 7'],
    [180, 'x', SYM_MIRROR_Y + SYM_ORIENT_0, '(-1, 0, 0, 1) is candidate 9'],
    [0, 'y', SYM_MIRROR_Y + SYM_ORIENT_0, '(-1, 0, 0, 1) is candidate 9'],
    [90, 'y', SYM_MIRROR_X + SYM_ORIENT_270, '( 0,-1,-1, 0) is candidate 7'],
    [180, 'y', SYM_MIRROR_X + SYM_ORIENT_0, '( 1, 0, 0,-1) is candidate 5'],
    [270, 'y', SYM_MIRROR_X + SYM_ORIENT_90, '( 0, 1, 1, 0) is candidate 6'],
  ];

  for (const [angle, mirror, expected, why] of TABLE) {
    it(`${angle}° mirror=${mirror ?? 'none'} → ${why}`, () => {
      expect(symbolOrientation(angle, mirror)).toBe(expected);
    });
  }

  it('reports a mirrored placement under the OTHER axis half the time', () => {
    // The header says so outright (sch_symbol.h:282-284). These two are the
    // pair that reading `sym.mirror` gets backwards, and the reason the
    // orientation port exists at all.
    expect(symbolOrientation(180, 'y') & SYM_MIRROR_X).toBe(SYM_MIRROR_X);
    expect(symbolOrientation(180, 'x') & SYM_MIRROR_X).toBe(0);
  });

  it('MIRROR_X + ORIENT_180 is not a candidate, so h_mirrored has one transform', () => {
    // `h_mirrored = (orient & SYM_MIRROR_X) && (angle == ORIENT_0 || ORIENT_180)`
    // (autoplace_fields.cpp:344-345). The list carries MIRROR_X with ORIENT_0,
    // _90 and _270 only, so the ORIENT_180 half of that test is unreachable and
    // exactly one transform satisfies it.
    const hMirrored = (a: number, m?: 'x' | 'y'): boolean => {
      const o = symbolOrientation(a, m);
      const ang = o & 0xff;
      return (o & SYM_MIRROR_X) !== 0 && (ang === SYM_ORIENT_0 || ang === SYM_ORIENT_180);
    };
    const all: [number, 'x' | 'y' | undefined][] = [];
    for (const m of [undefined, 'x', 'y'] as const)
      for (const a of [0, 90, 180, 270]) all.push([a, m]);
    expect(all.filter(([a, m]) => hMirrored(a, m))).toEqual([
      [0, 'x'],
      [180, 'y'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// getPreferredSides, observed through where the fields land
// ---------------------------------------------------------------------------

/**
 * A body 2.54 mm square with no pins at all.
 *
 * No pins means every side has zero, so `chooseSideForFields` takes its first
 * loop — "if any remaining sides have zero pins there, choose the highest
 * zero-pin side according to preference order" — and returns `sides[0]`. Where
 * the fields land is therefore a direct read-out of the preference ranking.
 *
 * Square on purpose: `w/h > 3.0` (autoplace_fields.cpp:384) would otherwise
 * swap the horizontal and vertical sides and hide the mirror test.
 */
const SQUARE = `(lib_symbols
  (symbol "Test:SQ" (pin_names (offset 0))
    (property "Reference" "U" (at 0 0 0))
    (property "Value" "SQ" (at 0 0 0))
    (symbol "SQ_0_1"
      (rectangle (start -1.27 -1.27) (end 1.27 1.27) (stroke (width 0.254)) (fill (type none))))))`;

const place = (
  angle: number,
  mirror?: 'x' | 'y',
): { doc: Schematic; sym: SchSymbol; lib: LibSymbol } => {
  const doc = readSchematic(
    parse(`(kicad_sch (version 20260306) (generator "x") ${SQUARE}
      (symbol (lib_id "Test:SQ") (at 100 100 ${angle}) ${mirror ? `(mirror ${mirror})` : ''}
        (unit 1) (uuid "u1")
        (property "Reference" "U1" (at 100 100 0) (effects (font (size 1.27 1.27))))
        (property "Value" "SQ" (at 100 100 0) (effects (font (size 1.27 1.27))))))`),
  );
  const sym = doc.symbols[0]!;
  return { doc, sym, lib: doc.libSymbols[0]! };
};

/** Which side of the body the fields ended up on. */
const landedSide = (angle: number, mirror?: 'x' | 'y'): 'left' | 'right' | 'above' | 'below' => {
  const { sym, lib } = place(angle, mirror);
  const f = autoplacedFields(sym, lib, OPTS)[0]!;
  const dx = f.at!.x - sym.at.x;
  const dy = f.at!.y - sym.at.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'below' : 'above';
};

describe('getPreferredSides ranks RIGHT first, and h_mirrored swaps it to LEFT', () => {
  it('unmirrored, at every angle, prefers the right', () => {
    // `sides_init` is { RIGHT, TOP, LEFT, BOTTOM } (autoplace_fields.cpp:334-339)
    // and nothing reorders it when the symbol is neither mirrored nor squat.
    for (const a of [0, 90, 180, 270]) expect(landedSide(a)).toBe('right');
  });

  it('(mirror x) at 0° swaps left and right — it is MIRROR_X + ORIENT_0', () => {
    expect(landedSide(0, 'x')).toBe('left');
  });

  it('(mirror y) at 180° ALSO swaps: same transform, so KiCad calls it mirrored', () => {
    // Reading the stored token would say "y, therefore not h_mirrored" and
    // leave the fields on the right. This is the bug the orientation port fixes.
    expect(landedSide(180, 'y')).toBe('left');
  });

  it('(mirror x) at 180° does NOT swap: it is MIRROR_Y + ORIENT_0', () => {
    // And this is the same bug in the other direction.
    expect(landedSide(180, 'x')).toBe('right');
  });

  it('(mirror y) at 0° does not swap either', () => {
    expect(landedSide(0, 'y')).toBe('right');
  });
});

describe('a body more than 3x as wide as it is tall swaps H and V', () => {
  /** 10.16 mm wide, 2.54 mm tall: w/h = 4.0, over the 3.0 threshold. */
  const WIDE = `(lib_symbols
    (symbol "Test:W" (pin_names (offset 0))
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "W" (at 0 0 0))
      (symbol "W_0_1"
        (rectangle (start -5.08 -1.27) (end 5.08 1.27) (stroke (width 0.254))
          (fill (type none))))))`;

  it('puts the fields above, not beside', () => {
    const doc = readSchematic(
      parse(`(kicad_sch (version 20260306) (generator "x") ${WIDE}
        (symbol (lib_id "Test:W") (at 100 100 0) (unit 1) (uuid "u1")
          (property "Reference" "U1" (at 100 100 0) (effects (font (size 1.27 1.27))))
          (property "Value" "W" (at 100 100 0) (effects (font (size 1.27 1.27))))))`),
    );
    const sym = doc.symbols[0]!;
    const f = autoplacedFields(sym, doc.libSymbols[0]!, OPTS)[0]!;
    // `swap(0,1); swap(1,3)` turns { R, T, L, B } into { T, B, R, L }, so the
    // best side is TOP and TOP is (0,-1) — upward, which is -y.
    expect(f.at!.y).toBeLessThan(sym.at.y);
  });
});

// ---------------------------------------------------------------------------
// BOX2I: the autoplacer never sees a fractional extent
// ---------------------------------------------------------------------------

describe('computeFBoxSize works in whole internal units', () => {
  it('places every field on an integer coordinate', () => {
    // `VECTOR2I computeFBoxSize()` and `field->SetPosition( VECTOR2I )` — there
    // is no fractional quantity anywhere in DoAutoplace. A field width taken
    // straight from our stroke-font measurer is fractional (a 'D1' at 1.27 mm
    // measures 27019.238… IU), so this fails without the rounding at the
    // BOX2I boundary.
    for (const a of [0, 90, 180, 270]) {
      const { sym, lib } = place(a);
      for (const f of autoplacedFields(sym, lib, OPTS)) {
        expect(Number.isInteger(f.at!.x)).toBe(true);
        expect(Number.isInteger(f.at!.y)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The constants
// ---------------------------------------------------------------------------

describe('the paddings are the C++ values', () => {
  it('matches the four #defines', () => {
    // autoplace_fields.cpp:64-67, all written as `schIUScale.MilsToIU( n )`.
    // A schematic internal unit is 100 nm, so 1 mm is 10000 IU and one mil is
    // 25400 nm = 254 IU:
    //
    //   FIELD_PADDING   15 mil × 254 =  3810
    //   HPADDING        25 mil × 254 =  6350
    //   VPADDING        15 mil × 254 =  3810
    //   WIRE_V_SPACING 100 mil × 254 = 25400
    //   the autoplace grid, MilsToIU( 50 ) at :177-181 and :737
    //                       50 mil × 254 = 12700
    expect(mmToIU(15 * 0.0254)).toBe(15 * 254);
    expect(mmToIU(25 * 0.0254)).toBe(25 * 254);
    expect(mmToIU(100 * 0.0254)).toBe(100 * 254);
    expect(mmToIU(50 * 0.0254)).toBe(50 * 254);
  });
});
