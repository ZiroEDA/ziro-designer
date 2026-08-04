// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME::SaveSymbolToSchematic`: the edited symbol going back into
 * the schematic's embedded library, and every unit that draws from it catching
 * up.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  embeddedLibSymbol,
  saveSymbolToSchematic,
  unitsOfSameSymbol,
} from '@ziroeda/eeschema/src/tools/save_symbol_to_schematic.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

/** A two-unit part, placed twice as U1 plus an unrelated U2. */
const doc = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4")
      (lib_symbols
        (symbol "L:Dual" (pin_names (offset 0))
          (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
          (symbol "Dual_1_1"
            (rectangle (start -5 -5) (end 5 5)
              (stroke (width 0) (type default)) (fill (type none)))
            (pin input line (at -7 0 0) (length 2)
              (name "IN" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27))))
              (alternate "SPARE" input line)))
          (symbol "Dual_2_1"
            (rectangle (start -5 -5) (end 5 5)
              (stroke (width 0) (type default)) (fill (type none))))))
      (symbol (lib_id "L:Dual") (at 50 50 0) (unit 1)
        (in_bom yes) (on_board yes) (dnp no) (uuid "a")
        (property "Reference" "U1" (at 50 45 0) (effects (font (size 1.27 1.27))))
        (pin "1" (uuid "pa") (alternate "SPARE")))
      (symbol (lib_id "L:Dual") (at 80 50 0) (unit 2)
        (in_bom yes) (on_board yes) (dnp no) (uuid "b")
        (property "Reference" "U1" (at 80 45 0) (effects (font (size 1.27 1.27)))))
      (symbol (lib_id "L:Dual") (at 110 50 0) (unit 1)
        (in_bom yes) (on_board yes) (dnp no) (uuid "c")
        (property "Reference" "U2" (at 110 45 0) (effects (font (size 1.27 1.27))))))`),
  );

const idOf = (d: Schematic, uuid: string): string =>
  refId(
    'symbol',
    uuid,
    d.symbols.findIndex((s) => s.uuid === uuid),
  );

/** The edited symbol: same part, but the alternate is gone. */
const editedNoAlt = (d: Schematic): LibSymbol => {
  const lib = d.libSymbols[0]!;
  return {
    ...lib,
    units: lib.units.map((u) => ({
      ...u,
      pins: u.pins.map((p) => ({ ...p, alternates: [] })),
    })),
  };
};

describe('which placements the save reaches', () => {
  it('takes every unit sharing the reference, not just the one edited', () => {
    // allUnits: a four-unit op-amp edited through unit B would otherwise leave
    // the other three drawing the old body.
    const d = doc();
    expect(unitsOfSameSymbol(d, idOf(d, 'a'))).toEqual([0, 1]);
  });

  it('leaves a different reference alone', () => {
    const d = doc();
    expect(unitsOfSameSymbol(d, idOf(d, 'a'))).not.toContain(2);
  });

  it('an unannotated placement stands alone', () => {
    // Grouping by "U?" would sweep in every other unannotated symbol.
    const d = doc();
    const anon: Schematic = {
      ...d,
      symbols: d.symbols.map((s) => ({
        ...s,
        fields: s.fields.map((f) => (f.key === 'Reference' ? { ...f, value: 'U?' } : f)),
      })),
    };
    expect(unitsOfSameSymbol(anon, idOf(anon, 'a'))).toEqual([0]);
  });

  it('returns nothing for a placement that is gone', () => {
    const d = doc();
    expect(saveSymbolToSchematic(d, 'symbol:missing:9', d.libSymbols[0]!)).toBeNull();
  });
});

describe('the embedded library entry', () => {
  it('is named by the placement lib id, not the editor’s', () => {
    const entry = embeddedLibSymbol({ ...doc().libSymbols[0]!, libId: 'Other:Name' }, 'L:Dual');
    expect(entry.libId).toBe('L:Dual');
  });

  it('saves a derived symbol as a concrete one', () => {
    // Writing it back with `extends` intact would emit a symbol with no body,
    // and the edit would vanish on the next read.
    const entry = embeddedLibSymbol({ ...doc().libSymbols[0]!, extends: 'Base' }, 'L:Dual');
    expect(entry.extends).toBeUndefined();
    expect(entry.units.length).toBeGreaterThan(0);
  });

  it('rebuilds its source, so the edit reaches the file', () => {
    // The writer emits each lib symbol's `source` verbatim. Reusing the source
    // it was read with would save the *old* symbol however much was edited.
    const d = doc();
    const edited: LibSymbol = {
      ...d.libSymbols[0]!,
      properties: d.libSymbols[0]!.properties.map((p) =>
        p.key === 'Reference' ? { ...p, value: 'XX' } : p,
      ),
    };
    const cmd = saveSymbolToSchematic(d, idOf(d, 'a'), edited)!;
    const text = serializeSchematic(cmd.apply(d));
    expect(text).toContain('"XX"');
  });
});

describe('applying it', () => {
  it('replaces the cached entry rather than appending a second one', () => {
    const d = doc();
    const after = saveSymbolToSchematic(d, idOf(d, 'a'), editedNoAlt(d))!.apply(d);
    expect(after.libSymbols.filter((l) => l.libId === 'L:Dual')).toHaveLength(1);
  });

  it('clears an alternate the edited symbol no longer defines', () => {
    const d = doc();
    expect(d.symbols[0]!.pins?.[0]?.alternate).toBe('SPARE');
    const after = saveSymbolToSchematic(d, idOf(d, 'a'), editedNoAlt(d))!.apply(d);
    expect(after.symbols[0]!.pins?.[0]?.alternate).toBeUndefined();
  });

  it('keeps an alternate the edited symbol still defines', () => {
    // resetAll is false: the user's choice survives an edit that kept it.
    const d = doc();
    const after = saveSymbolToSchematic(d, idOf(d, 'a'), d.libSymbols[0]!)!.apply(d);
    expect(after.symbols[0]!.pins?.[0]?.alternate).toBe('SPARE');
  });

  it('undoes and redoes', () => {
    const d = doc();
    const cmd = saveSymbolToSchematic(d, idOf(d, 'a'), editedNoAlt(d))!;
    const after = cmd.apply(d);
    const undone = cmd.invert(d).apply(after);
    expect(undone.symbols[0]!.pins?.[0]?.alternate).toBe('SPARE');
    expect(serializeSchematic(undone)).toBe(serializeSchematic(d));
    const redone = cmd.invert(d).invert(after).apply(undone);
    expect(redone.symbols[0]!.pins?.[0]?.alternate).toBeUndefined();
  });
});
