// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_PIN::GetBoundingBox` / `PIN_LAYOUT_CACHE::GetPinBoundingBox`, pinned
 * structurally.
 *
 * Every expectation is derived from the C++: which branch a given pin reaches,
 * and what each constant is defined as. Coordinates that could only come from a
 * measurement are not asserted — what is asserted is that a branch is taken,
 * that a constant has its defined value, and that a box grows in the direction
 * the source says it grows.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { libPinBoundingBox } from '@ziroeda/eeschema/src/pin_box.js';
import type { LibSymbol, LibPin } from '@ziroeda/eeschema/src/types.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

/**
 * One library symbol carrying one pin, built from the caller's tokens.
 *
 * `pinNameOffset` is `(pin_names (offset n))`: non-zero puts the name INSIDE
 * the body, zero puts it outside, and the two take different arms of
 * `GetPinBoundingBox`.
 */
const sym = (offsetMM: number, pinTokens: string, hideNames = false): LibSymbol =>
  readSchematic(
    parse(`(kicad_sch (version 20260306) (generator "x")
      (lib_symbols
        (symbol "T:P" (pin_names (offset ${offsetMM})${hideNames ? ' hide' : ''})
          (property "Reference" "U" (at 0 0 0))
          (property "Value" "P" (at 0 0 0))
          (symbol "P_1_1" ${pinTokens}))))`),
  ).libSymbols[0]!;

const onlyPin = (s: LibSymbol): LibPin => s.units.flatMap((u) => u.pins)[0]!;
const box = (s: LibSymbol): ReturnType<typeof libPinBoundingBox> =>
  libPinBoundingBox(onlyPin(s), s);

/** A plain 2.54 mm passive pin pointing right from the origin. */
const PIN = (type = 'passive', shape = 'line', angle = 0) =>
  `(pin ${type} ${shape} (at 0 0 ${angle}) (length 2.54)
     (name "A" (effects (font (size 1.27 1.27))))
     (number "1" (effects (font (size 1.27 1.27)))))`;

describe('the dangling indicator', () => {
  /**
   * `m_isDangling` is `true` in every SCH_PIN constructor and only the
   * schematic's own pins are ever updated by the connectivity pass
   * (SCH_SYMBOL::UpdateDanglingState), so a LIBRARY pin keeps that true.
   * `IsDangling()` is then false only for the not-connected electrical types
   * (sch_pin.cpp:464-470). When it is true the box merges a circle of
   * TARGET_PIN_RADIUS about the connection point.
   *
   * `BARE` has no name and no number text, so nothing competes with that
   * circle and the box is the pin line plus the circle alone.
   */
  const BARE = (type: string) =>
    `(pin ${type} line (at 0 0 0) (length 2.54) (name "") (number ""))`;
  const halfHeight = (s: LibSymbol): number => {
    const b = box(s);
    return Math.max(Math.abs(b.minY), Math.abs(b.maxY));
  };

  it('reaches TARGET_PIN_RADIUS from the connection point when connectable', () => {
    // `BOX2I::ByCenter( c.Center, { c.Radius * 2, c.Radius * 2 } )` on the
    // dangling indicator, then the final `Inflate(…+1)`. TARGET_PIN_RADIUS is
    // `schIUScale.MilsToIU( 15 )` (sch_pin.h:37) = 15 × 254 = 3810 IU, so a
    // bare pin's box is exactly that plus the one-unit inflate, either side.
    expect(halfHeight(sym(1.016, BARE('passive')))).toBe(mmToIU(15 * 0.0254) + 1);
  });

  it('is absent for every spelling of a not-connected type', () => {
    // `case T_unconnected: case T_no_connect: return PT_NC;`
    // (sch_io_kicad_sexpr_parser.cpp:1601-1602). `unconnected` is what a file
    // written before 20210123 uses for the same type (sch_file_versions.h:79),
    // and we keep whichever token the file carried. With no circle, a bare
    // horizontal pin has no height at all beyond the inflate.
    for (const t of ['no_connect', 'unconnected', 'free']) {
      expect(halfHeight(sym(1.016, BARE(t)))).toBe(1);
    }
  });

  it('treats `unconnected` exactly as `no_connect`', () => {
    expect(box(sym(1.016, PIN('unconnected')))).toEqual(box(sym(1.016, PIN('no_connect'))));
  });
});

describe('the name goes inside or outside depending on pin_names offset', () => {
  it('a non-zero offset puts the name inside, so the box does not grow past the pin', () => {
    // `GetPinBoundingBox` includes the name box only when it is drawn; with the
    // name inside the body it sits over the pin line rather than beyond it.
    const inside = box(sym(1.016, PIN()));
    const outside = box(sym(0, PIN()));
    // Outside-name is the taller of the two: the name and number then share the
    // space either side of the line instead of the number owning it alone.
    expect(outside.maxY - outside.minY).toBeGreaterThan(inside.maxY - inside.minY);
  });

  it('hidden pin names do not contribute', () => {
    const shown = box(sym(0, PIN()));
    const hidden = box(sym(0, PIN(), true));
    expect(hidden.maxX - hidden.minX).toBeLessThanOrEqual(shown.maxX - shown.minX);
  });
});

describe('orientation', () => {
  /**
   * `PinDrawOrient( DefaultTransform )` — and DefaultTransform is the identity
   * (transform.cpp:32), so a library pin's orientation is the stored one. The
   * box is built for a right-pointing pin and then reflected/rotated, so the
   * four angles give the same box turned four ways.
   */
  it('a 90° pin has the 0° pin box with its axes swapped', () => {
    const h = box(sym(1.016, PIN('passive', 'line', 0)));
    const v = box(sym(1.016, PIN('passive', 'line', 90)));
    expect(v.maxY - v.minY).toBe(h.maxX - h.minX);
    expect(v.maxX - v.minX).toBe(h.maxY - h.minY);
  });

  it('180° mirrors 0° about the connection point', () => {
    const a = box(sym(1.016, PIN('passive', 'line', 0)));
    const b = box(sym(1.016, PIN('passive', 'line', 180)));
    expect(b.maxX - b.minX).toBe(a.maxX - a.minX);
    expect(b.maxY - b.minY).toBe(a.maxY - a.minY);
  });
});

describe('the final inflate', () => {
  it('is one internal unit, because a pin pen width is zero', () => {
    // `bbox.Inflate( ( m_pin.GetPenWidth() / 2 ) + 1 )`, and
    // `SCH_PIN::GetPenWidth()` is `return 0` (sch_pin.h:251). A zero-length
    // invisible-everything pin is therefore still 2 IU across, not 0.
    const b = box(sym(0, `(pin no_connect line (at 0 0 0) (length 0) (name "") (number ""))`));
    expect(b.maxX - b.minX).toBeGreaterThanOrEqual(2);
    expect(b.maxY - b.minY).toBeGreaterThanOrEqual(2);
  });
});

describe('the shape decorations', () => {
  /**
   * The decoration is built about the origin and then `box->Move( {
   * m_pin.GetLength(), 0 } )` — "Put the box at the root of the pin"
   * (pin_layout_cache.cpp:702-706). So on a normal-length pin the inversion
   * bubble lands INSIDE the span the pin line already covers and does not grow
   * the box at all; measuring it needs a zero-length pin, where the root and
   * the connection point coincide.
   */
  const ZERO = (shape: string) =>
    `(pin passive ${shape} (at 0 0 0) (length 0) (name "") (number ""))`;

  it('an inverted bubble reaches 2 × externalPinDecoSize back from the root', () => {
    // `makeInvertBox` is `ByCenter( { -decoSize, 0 }, { decoSize*2, decoSize*2 } )`
    // (pin_layout_cache.cpp:648-651), spanning x ∈ [-2·decoSize, 0].
    // `externalPinDecoSize` with null settings is half the NUMBER text size,
    // which defaults to DEFAULT_PINNUM_SIZE = 50 mils = 12700 IU, so
    // decoSize = 6350 and the box reaches -12700, plus the one-unit inflate.
    expect(box(sym(1.016, ZERO('inverted'))).minX).toBe(-2 * 6350 - 1);
  });

  it('a clock wedge reaches internalPinDecoSize either side of the axis', () => {
    // `makeClockBox` is `ByCorners( { 0, -intDecoSize }, { intDecoSize, intDecoSize } )`
    // (:659-663). `internalPinDecoSize` with null settings is half the NAME
    // text size — DEFAULT_PINNAME_SIZE = 50 mils = 12700 — so 6350 each way.
    const b = box(sym(1.016, ZERO('clock')));
    expect(b.maxY - b.minY).toBe(2 * 6350 + 2);
  });
});
