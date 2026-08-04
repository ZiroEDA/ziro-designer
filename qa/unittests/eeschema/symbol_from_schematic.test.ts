// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME::LoadSymbolFromSchematic`: turning a placement back into
 * the library symbol the editor opens, which is almost entirely a question of
 * where the fields go.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  editorUnitFor,
  libSymbolFromPlacement,
} from '@ziroeda/eeschema/src/tools/symbol_from_schematic.js';
import { applyTransform, invertTransform, symbolTransform } from '@ziroeda/common/src/transform.js';
import type { LibSymbol, SchSymbol } from '@ziroeda/eeschema/src/types.js';

/** Positions in the model are internal units; the fixture is written in mm. */
const mm = (n: number): number => n * 10000;

/** A placement at (100, 100) with one field 10 to its right and 5 below. */
const placement = (orient: string, unit = 1): SchSymbol =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4")
      (lib_symbols
        (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
          (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
          (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
            (stroke (width 0) (type default)) (fill (type none))))))
      (symbol (lib_id "L:R") (at 100 100 ${orient}) (unit ${unit})
        (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-1")
        (property "Reference" "R1" (at 110 105 0) (effects (font (size 1.27 1.27))))))`),
  ).symbols[0]!;

/** The library symbol as the index holds it. */
const libSymbol = (): LibSymbol =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4")
      (lib_symbols
        (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
          (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
          (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
            (stroke (width 0) (type default)) (fill (type none)))))))`),
  ).libSymbols[0]!;

const fieldAt = (s: LibSymbol) => s.properties.find((p) => p.key === 'Reference')!.at!;

describe('the fields land in symbol space', () => {
  it('an unrotated placement just loses the origin', () => {
    // The field is 10 right and 5 down of the symbol; with no rotation that is
    // exactly where it sits on the library symbol.
    const out = libSymbolFromPlacement(placement('0'), libSymbol());
    expect(fieldAt(out)).toEqual({ x: mm(10), y: mm(5) });
  });

  it('undoes a 90° rotation', () => {
    // Forward: 90° maps (x,y) -> (y,-x). So a field drawn at (10,5) in symbol
    // space would appear at (5,-10); the placement has it at (10,5), which must
    // therefore have come from (-5,10).
    const out = libSymbolFromPlacement(placement('90'), libSymbol());
    expect(fieldAt(out)).toEqual({ x: mm(-5), y: mm(10) });
  });

  it('undoes 180°', () => {
    const out = libSymbolFromPlacement(placement('180'), libSymbol());
    expect(fieldAt(out)).toEqual({ x: mm(-10), y: mm(-5) });
  });

  it('undoes a mirror', () => {
    // mirror x flips Y (SCH_SYMBOL MirrorVertically), and is its own inverse.
    const out = libSymbolFromPlacement(placement('0) (mirror x'), libSymbol());
    expect(fieldAt(out)).toEqual({ x: mm(10), y: mm(-5) });
  });

  it('undoes rotation and mirror together, in the right order', () => {
    // The case that catches a hand-rolled inverse applied the wrong way round:
    // with 90° + mirror the two do not commute, so an inverse that rotates
    // before mirroring lands somewhere else entirely.
    const sym = placement('90) (mirror y');
    const out = libSymbolFromPlacement(sym, libSymbol());
    // Round-trip through the *forward* transform: whatever symbol-space point
    // we produce must map back to where the placement actually has the field.
    const t = symbolTransform(sym.angle, sym.mirror);
    const back = applyTransform(t, fieldAt(out));
    expect({ x: back.x + sym.at.x, y: back.y + sym.at.y }).toEqual({ x: mm(110), y: mm(105) });
  });

  it('round-trips for every orientation the format allows', () => {
    // Eleven canonical states; the inverse must be exact for all of them, not
    // just the four plain rotations.
    for (const angle of [0, 90, 180, 270]) {
      for (const mirror of [undefined, 'x', 'y'] as const) {
        const t = symbolTransform(angle, mirror);
        const p = { x: 37, y: -11 };
        const there = applyTransform(t, p);
        const back = applyTransform(invertTransform(t), there);
        expect(back, `angle=${angle} mirror=${mirror}`).toEqual(p);
      }
    }
  });

  it('leaves a field with no position alone', () => {
    const sym = placement('90');
    const stripped: SchSymbol = {
      ...sym,
      fields: sym.fields.map((f) => ({ ...f, at: undefined })),
    };
    const out = libSymbolFromPlacement(stripped, libSymbol());
    expect(out.properties.find((p) => p.key === 'Reference')!.at).toBeUndefined();
  });
});

describe('what else comes across', () => {
  it('takes the lib id from the placement, not the library entry', () => {
    // symbol->SetLibId( aSymbol->GetLibId() ): a placement pointing at a name
    // the library has since changed still opens under the name it refers to.
    const lib: LibSymbol = { ...libSymbol(), libId: 'Renamed:R' };
    expect(libSymbolFromPlacement(placement('0'), lib).libId).toBe('L:R');
  });

  it('keeps the library body, not the placement', () => {
    const out = libSymbolFromPlacement(placement('90'), libSymbol());
    expect(out.units).toEqual(libSymbol().units);
    expect(out.pinNamesHidden).toBe(libSymbol().pinNamesHidden);
  });

  it('carries the field text and effects through untouched', () => {
    // Upstream copies the whole field and overwrites only the position.
    const out = libSymbolFromPlacement(placement('90'), libSymbol());
    const f = out.properties.find((p) => p.key === 'Reference')!;
    expect(f.value).toBe('R1');
    expect(f.effects).toEqual(placement('90').fields[0]!.effects);
  });

  it('floors unit and body style at 1', () => {
    // std::max( 1, … ): a placement may carry 0, and there is no unit 0 to show.
    expect(editorUnitFor({ ...placement('0'), unit: 0, bodyStyle: 0 })).toEqual({
      unit: 1,
      bodyStyle: 1,
    });
    expect(editorUnitFor(placement('0', 2)).unit).toBe(2);
  });
});
