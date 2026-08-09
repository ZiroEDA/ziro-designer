// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A sheet pin faces *into* its sheet.
 *
 * It is drawn as the hierarchical label it derives from
 * (`draw( static_cast<SCH_HIERLABEL*>( sheetPin ), ... )`), but its orientation
 * is not the one a hierarchical label at the same place would have:
 * `SCH_SHEET_PIN::SetSide` deliberately inverts it.
 *
 *     case SHEET_SIDE::LEFT:   SetSpinStyle( SPIN_STYLE::RIGHT );  // Orientation horiz inverse
 *     case SHEET_SIDE::RIGHT:  SetSpinStyle( SPIN_STYLE::LEFT );   // Orientation horiz normal
 *     case SHEET_SIDE::TOP:    SetSpinStyle( SPIN_STYLE::BOTTOM );
 *     case SHEET_SIDE::BOTTOM: SetSpinStyle( SPIN_STYLE::UP );
 *
 * The two horizontal edges were inverted here; the vertical pair was not, so a
 * pin on the top or bottom border pointed and measured outwards.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { sheetPinBBox } from '@ziroeda/eeschema/src/tools/bbox.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** A 40 x 40 sheet at (100,50) with one pin on each of its four borders. */
const doc: Schematic = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols)
    (sheet (at 100 50) (size 40 40) (uuid "sh1")
      (property "Sheetname" "S" (at 100 49 0))
      (property "Sheetfile" "s.kicad_sch" (at 100 95 0))
      (pin "LEFT" input (at 100 70 180) (uuid "pl"))
      (pin "RIGHT" input (at 140 70 0) (uuid "pr"))
      (pin "TOP" input (at 120 50 90) (uuid "pt"))
      (pin "BOTTOM" input (at 120 90 270) (uuid "pb")))
    )`),
);

const pin = (name: string) => doc.sheets[0]!.pins.find((p) => p.name === name)!;
const body = { x0: mmToIU(100), y0: mmToIU(50), x1: mmToIU(140), y1: mmToIU(90) };

describe('a sheet pin reads inwards from its border', () => {
  it('left border: the name extends to the right, inside', () => {
    const b = sheetPinBBox(pin('LEFT'));
    expect(b.maxX).toBeGreaterThan(body.x0);
    expect(b.maxX).toBeLessThanOrEqual(body.x1);
  });

  it('right border: to the left, inside', () => {
    const b = sheetPinBBox(pin('RIGHT'));
    expect(b.minX).toBeLessThan(body.x1);
    expect(b.minX).toBeGreaterThanOrEqual(body.x0);
  });

  it('top border: downwards, inside', () => {
    // Was upwards: SPIN_STYLE::UP instead of the inverted BOTTOM.
    const b = sheetPinBBox(pin('TOP'));
    expect(b.maxY).toBeGreaterThan(body.y0);
    expect(b.maxY).toBeLessThanOrEqual(body.y1);
  });

  it('bottom border: upwards, inside', () => {
    const b = sheetPinBBox(pin('BOTTOM'));
    expect(b.minY).toBeLessThan(body.y1);
    expect(b.minY).toBeGreaterThanOrEqual(body.y0);
  });

  it('and each box straddles its own border, never the opposite one', () => {
    for (const [name, near] of [
      ['LEFT', body.x0],
      ['RIGHT', body.x1],
    ] as const) {
      const b = sheetPinBBox(pin(name));
      expect(b.minX).toBeLessThanOrEqual(near);
      expect(b.maxX).toBeGreaterThanOrEqual(near);
    }
    for (const [name, near] of [
      ['TOP', body.y0],
      ['BOTTOM', body.y1],
    ] as const) {
      const b = sheetPinBBox(pin(name));
      expect(b.minY).toBeLessThanOrEqual(near);
      expect(b.maxY).toBeGreaterThanOrEqual(near);
    }
  });
});
