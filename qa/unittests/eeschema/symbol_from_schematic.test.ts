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
  symbolEditorRequest,
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

  it('falls back to the library position when the placement has none', () => {
    // Nothing to borrow, so the library's own position stands — rather than the
    // field losing its position altogether.
    const sym = placement('90');
    const stripped: SchSymbol = {
      ...sym,
      fields: sym.fields.map((f) => ({ ...f, at: undefined })),
    };
    const out = libSymbolFromPlacement(stripped, libSymbol());
    expect(out.properties.find((p) => p.key === 'Reference')!.at).toEqual(fieldAt(libSymbol()));
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

  it('keeps the LIBRARY’s field value, not the placement’s', () => {
    // The divergence that matters. libById *is* the schematic's embedded
    // lib_symbols, so a save-back carrying "R1" into the cached Device:R would
    // leave "Update Symbols from Library" ready to push R1 onto every other
    // resistor on the sheet.
    const out = libSymbolFromPlacement(placement('90'), libSymbol());
    const f = out.properties.find((p) => p.key === 'Reference')!;
    expect(f.value).toBe('R');
  });

  it('borrows the position even so', () => {
    // Taking the library's value must not mean taking its position: the whole
    // point is that the editor shows the fields where they were placed.
    const out = libSymbolFromPlacement(placement('0'), libSymbol());
    expect(fieldAt(out)).toEqual({ x: mm(10), y: mm(5) });
    expect(fieldAt(libSymbol())).not.toEqual({ x: mm(10), y: mm(5) });
  });

  it('drops a field the library does not have', () => {
    // Not part of the library symbol; the placement keeps it either way.
    const sym = placement('0');
    const extra: SchSymbol = {
      ...sym,
      fields: [...sym.fields, { ...sym.fields[0]!, key: 'MPN', value: 'X-1' }],
    };
    const out = libSymbolFromPlacement(extra, libSymbol());
    expect(out.properties.find((p) => p.key === 'MPN')).toBeUndefined();
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

// ---------------------------------------------------------------------------
// The seed both of DIALOG_SYMBOL_PROPERTIES' hand-off buttons build.
//
// Upstream runs one handler for both and switches on the dialog's return code
// (`sch_edit_tool.cpp:2727-2760`):
//
//     SYMBOL_PROPS_EDIT_SCHEMATIC_SYMBOL -> LoadSymbolFromSchematic( symbol )
//     SYMBOL_PROPS_EDIT_LIBRARY_SYMBOL   -> LoadSymbol( GetLibId(), GetUnit(),
//                                                       GetBodyStyle() )
//
// Ours had "Edit Symbol..." wired to a bare view switch with no symbol at all,
// so the editor opened on `[no symbol loaded]`. These pin that BOTH buttons
// produce a symbol, and that they produce *different* ones.
// ---------------------------------------------------------------------------

/** The whole sheet, so the request has both the placement and the cache. */
const sheet = (orient: string, unit = 1, bodyStyle = 1) =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4")
      (lib_symbols
        (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
          (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
          (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
            (stroke (width 0) (type default)) (fill (type none))))))
      (symbol (lib_id "L:R") (at 100 100 ${orient}) (unit ${unit})
        (body_style ${bodyStyle})
        (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-1")
        (property "Reference" "R1" (at 110 105 0) (effects (font (size 1.27 1.27))))))`),
  );

const cacheOf = (d: ReturnType<typeof sheet>): Map<string, LibSymbol> =>
  new Map(d.libSymbols.map((l) => [l.libId, l]));

// `refId('symbol', uuid, i)` is the uuid when there is one, and the fixture
// gives it one — written out rather than computed, so a change to how ids are
// formed shows up here as a failure instead of following along silently.
const S1 = 's-1';

describe('symbolEditorRequest: what each hand-off button seeds the editor with', () => {
  it('"Edit Symbol..." hands over a symbol, not nothing', () => {
    // The bug: this leg used to call the plain "show the symbol editor" action
    // with no payload, which is the same thing the launcher's menu entry does —
    // and that legitimately opens on `[no symbol loaded]`.
    const d = sheet('0');
    const req = symbolEditorRequest(d.symbols, cacheOf(d), S1, 'schematic');
    expect(req).not.toBeNull();
    expect(req?.symbol.libId).toBe('L:R');
    expect(req?.targetId).toBe(S1);
  });

  it('"Edit Library Symbol..." hands over a symbol, not nothing', () => {
    const d = sheet('0');
    const req = symbolEditorRequest(d.symbols, cacheOf(d), S1, 'library');
    expect(req).not.toBeNull();
    expect(req?.symbol.libId).toBe('L:R');
    expect(req?.targetId).toBe(S1);
  });

  it('the library leg is the cached part untouched, field positions and all', () => {
    // `LoadSymbol( GetLibId(), … )`: the library entry as it stands. Its
    // Reference sits at the origin, where the library put it — 180° of
    // placement rotation must not have moved it.
    const d = sheet('180');
    const req = symbolEditorRequest(d.symbols, cacheOf(d), S1, 'library');
    expect(fieldAt(req!.symbol)).toEqual({ x: 0, y: 0 });
  });

  it('the schematic leg folds this placement in', () => {
    // Same 180° placement, and now the field IS the placement's, carried back
    // into symbol space: the field is 10 right / 5 below the symbol origin in
    // the sheet, and 180° maps (x,y) -> (-x,-y), so it came from (-10,-5).
    const d = sheet('180');
    const req = symbolEditorRequest(d.symbols, cacheOf(d), S1, 'schematic');
    expect(fieldAt(req!.symbol)).toEqual({ x: mm(-10), y: mm(-5) });
  });

  it('opens on the placement’s own unit and body style', () => {
    const d = sheet('0', 3, 2);
    expect(symbolEditorRequest(d.symbols, cacheOf(d), S1, 'library')).toMatchObject({
      unit: 3,
      bodyStyle: 2,
    });
    expect(symbolEditorRequest(d.symbols, cacheOf(d), S1, 'schematic')).toMatchObject({
      unit: 3,
      bodyStyle: 2,
    });
  });

  it('floors an unset unit at 1 rather than opening on unit 0', () => {
    const d = sheet('0', 0, 0);
    expect(symbolEditorRequest(d.symbols, cacheOf(d), S1, 'library')).toMatchObject({
      unit: 1,
      bodyStyle: 1,
    });
  });

  it('refuses a broken library symbol link on both legs', () => {
    // `"Symbols with broken library symbol links cannot be edited."`
    // (sch_editor_control.cpp:2870). Null, so the caller reports it — NOT a
    // request with no symbol in it, which is how the editor ends up empty.
    const d = sheet('0');
    const empty = new Map<string, LibSymbol>();
    expect(symbolEditorRequest(d.symbols, empty, S1, 'library')).toBeNull();
    expect(symbolEditorRequest(d.symbols, empty, S1, 'schematic')).toBeNull();
  });

  it('refuses an id that is not on the sheet', () => {
    const d = sheet('0');
    expect(symbolEditorRequest(d.symbols, cacheOf(d), 'nobody', 'library')).toBeNull();
    expect(symbolEditorRequest(d.symbols, cacheOf(d), 'nobody', 'schematic')).toBeNull();
  });
});
