// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Change Symbols / Update Symbols from Library, counterpart
 * dialog_change_symbols.cpp: what matches, what each switch carries over from
 * the library part, and the two rules that stop it destroying work — an empty
 * library field does not blank yours, and a power symbol's value is its net.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  changeSymbols,
  changeSymbolsCommand,
  defaultChangeSymbolsOptions,
  refDesNumber,
  refDesPrefix,
  type ChangeSymbolsOptions,
} from '@ziroeda/eeschema/src/tools/change_symbols.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 2 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 2 -2 0) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
      (property "Spice_Model" "res" (at 0 -4 0) (effects (font (size 1.27 1.27)) hide))
      (symbol "R_0_1"))
    (symbol "Device:R_Small"
      (property "Reference" "RS" (at 1 0 0) (effects (font (size 0.5 0.5))))
      (property "Value" "R_Small" (at 1 -1 0) (effects (font (size 0.5 0.5))))
      (symbol "R_Small_0_1"))
    (symbol "power:GND" (power)
      (property "Reference" "#PWR" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "GND" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "GND_0_1")))
  (symbol (lib_id "Device:R") (at 30 30 0) (unit 1) (uuid "s0")
    (property "Reference" "R7" (at 32 30 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 32 28 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "R_0805" (at 30 30 0) (effects (font (size 1.27 1.27)) hide))
    (property "MPN" "RC0805" (at 30 26 0) (effects (font (size 1.27 1.27)) hide)))
  (symbol (lib_id "power:GND") (at 60 60 0) (unit 1) (uuid "s1")
    (property "Reference" "#PWR01" (at 60 58 0) (effects (font (size 1.27 1.27))))
    (property "Value" "GNDA" (at 60 62 0) (effects (font (size 1.27 1.27))))))`;

const doc = (): Schematic => readSchematic(parse(SCH));
const libs = (): Map<string, LibSymbol> => new Map(doc().libSymbols.map((l) => [l.libId, l]));
const opts = (over: Partial<ChangeSymbolsOptions>): ChangeSymbolsOptions => ({
  ...defaultChangeSymbolsOptions(over.mode ?? 'update'),
  ...over,
});
const field = (d: Schematic, i: number, key: string) =>
  d.symbols[i]!.fields.find((f) => f.key === key);

describe('reference splitting', () => {
  it('keeps the number and takes only the prefix from the library', () => {
    expect(refDesPrefix('RS')).toBe('RS');
    expect(refDesPrefix('R12')).toBe('R');
    expect(refDesNumber('R7')).toBe(7);
    expect(refDesNumber('R?')).toBe(-1);
  });
});

describe('matching', () => {
  it('takes everything under "all"', () => {
    const r = changeSymbols(doc(), libs(), opts({ mode: 'update' }));
    expect(r.processed).toBe(2);
  });

  it('matches a reference as a wildcard', () => {
    const r = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'update', match: { mode: 'reference', text: 'R*' } }),
    );
    expect(r.processed).toBe(1);
  });

  it('matches a library id exactly, not as a wildcard', () => {
    expect(
      changeSymbols(doc(), libs(), opts({ match: { mode: 'libId', text: 'Device:R' } })).processed,
    ).toBe(1);
    expect(
      changeSymbols(doc(), libs(), opts({ match: { mode: 'libId', text: 'Device:*' } })).processed,
    ).toBe(0);
  });

  it('reports when nothing matched, and hands back the same document', () => {
    const before = doc();
    const r = changeSymbols(before, libs(), opts({ match: { mode: 'reference', text: 'U*' } }));
    expect(r.doc).toBe(before);
    expect(r.processed).toBe(0);
    expect(r.messages[0]?.text).toContain('No symbols matching criteria found');
  });
});

describe('update from library', () => {
  it('keeps the reference number while taking the library prefix', () => {
    const r = changeSymbols(
      doc(),
      libs(),
      opts({
        mode: 'change',
        newLibId: 'Device:R_Small',
        match: { mode: 'libId', text: 'Device:R' },
      }),
    );
    // R7 against a part called RS is RS7, not RS and not R7.
    expect(field(r.doc, 0, 'Reference')?.value).toBe('RS7');
  });

  it('does not blank a field the library leaves empty', () => {
    // Device:R has an empty Footprint; the schematic's R_0805 must survive.
    const r = changeSymbols(doc(), libs(), opts({ mode: 'update' }));
    expect(field(r.doc, 0, 'Footprint')?.value).toBe('R_0805');
  });

  it('…unless you ask for empty fields to be reset', () => {
    const r = changeSymbols(doc(), libs(), opts({ mode: 'update', resetEmptyFields: true }));
    expect(field(r.doc, 0, 'Footprint')?.value).toBe('');
  });

  it('leaves a power symbol its value, which is its net name', () => {
    const r = changeSymbols(doc(), libs(), opts({ mode: 'update' }));
    expect(field(r.doc, 1, 'Value')?.value).toBe('GNDA');
  });

  it('…unless the custom-power switch is on', () => {
    const r = changeSymbols(doc(), libs(), opts({ mode: 'update', resetCustomPower: true }));
    expect(field(r.doc, 1, 'Value')?.value).toBe('GND');
  });

  it('overwrites an ordinary value from the library', () => {
    const r = changeSymbols(doc(), libs(), opts({ mode: 'update' }));
    expect(field(r.doc, 0, 'Value')?.value).toBe('R');
  });
});

describe('the field switches', () => {
  it('takes text sizes only when field effects are reset', () => {
    const off = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'change', newLibId: 'Device:R_Small', resetFieldEffects: false }),
    );
    expect(field(off.doc, 0, 'Value')?.effects?.fontSize?.[0]).toBe(mmToIU(1.27));

    const on = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'change', newLibId: 'Device:R_Small', resetFieldEffects: true }),
    );
    expect(field(on.doc, 0, 'Value')?.effects?.fontSize?.[0]).toBe(mmToIU(0.5));
  });

  it('places fields relative to the symbol when positions are reset', () => {
    const r = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'change', newLibId: 'Device:R_Small', resetFieldPositions: true }),
    );
    // The library's Reference sits at (1, 0) from the origin; the symbol is at 30,30.
    expect(field(r.doc, 0, 'Reference')?.at?.x).toBe(mmToIU(31));
  });

  it('keeps visibility and position out of the effects copy', () => {
    // Footprint is hidden on the placement; resetting effects alone must not
    // unhide it (upstream saves and restores both around SetAttributes).
    const r = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'update', resetFieldEffects: true, resetFieldVisibilities: false }),
    );
    expect(field(r.doc, 0, 'Footprint')?.effects?.hidden).toBe(true);
  });

  it('only touches the fields on the list', () => {
    const r = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'update', updateFields: new Set(['Value']) }),
    );
    expect(field(r.doc, 0, 'Value')?.value).toBe('R');
    expect(field(r.doc, 0, 'Reference')?.value).toBe('R7');
  });

  it('removes a field the new part does not have, only when asked', () => {
    const keep = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'update', updateFields: new Set(['MPN']) }),
    );
    expect(field(keep.doc, 0, 'MPN')).toBeDefined();

    const drop = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'update', updateFields: new Set(['MPN']), removeExtraFields: true }),
    );
    expect(field(drop.doc, 0, 'MPN')).toBeUndefined();
  });

  it('adds a library field the schematic does not have yet', () => {
    const r = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'update', updateFields: new Set(['Spice_Model']) }),
    );
    expect(field(r.doc, 0, 'Spice_Model')?.value).toBe('res');
  });

  it('never removes a mandatory field, even off the list', () => {
    const r = changeSymbols(
      doc(),
      libs(),
      opts({ mode: 'update', updateFields: new Set(['Value']), removeExtraFields: true }),
    );
    expect(field(r.doc, 0, 'Reference')).toBeDefined();
    expect(field(r.doc, 0, 'Footprint')).toBeDefined();
  });
});

describe('errors and the command', () => {
  it('reports a library id that resolves to nothing', () => {
    const r = changeSymbols(doc(), libs(), opts({ mode: 'change', newLibId: 'Nope:Nope' }));
    expect(r.processed).toBe(0);
    expect(r.messages.some((m) => m.text.includes('not found in any library'))).toBe(true);
    expect(r.messages.every((m) => m.severity === 'error')).toBe(true);
  });

  it('refuses a part with too few units for the placement', () => {
    const multi = readSchematic(
      parse(`(kicad_sch (version 1)
        (lib_symbols
          (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (symbol "R_0_1")))
        (symbol (lib_id "Device:R") (at 0 0 0) (unit 3) (uuid "s0")
          (property "Reference" "R1" (at 0 0 0))))`),
    );
    const r = changeSymbols(
      multi,
      new Map(multi.libSymbols.map((l) => [l.libId, l])),
      opts({ mode: 'update' }),
    );
    expect(r.messages.some((m) => m.text.includes('too few units'))).toBe(true);
    expect(r.processed).toBe(0);
  });

  it('replaces the schematic’s own copy of the library part', () => {
    const r = changeSymbols(
      doc(),
      libs(),
      opts({
        mode: 'change',
        newLibId: 'Device:R_Small',
        match: { mode: 'libId', text: 'Device:R' },
      }),
    );
    expect(r.doc.symbols[0]!.libId).toBe('Device:R_Small');
    expect(r.doc.libSymbols.some((l) => l.libId === 'Device:R_Small')).toBe(true);
  });

  it('gives a null command when nothing was processed', () => {
    const { command } = changeSymbolsCommand(
      doc(),
      libs(),
      opts({ match: { mode: 'reference', text: 'U*' } }),
    );
    expect(command).toBeNull();
  });

  it('undoes cleanly', () => {
    const before = doc();
    const { command } = changeSymbolsCommand(before, libs(), opts({ mode: 'update' }));
    const after = command!.apply(before);
    expect(command!.invert(before).apply(after)).toEqual(before);
  });
});

/**
 * "Update/reset symbol attributes" (dialog_change_symbols.cpp): the four flags
 * come off the *flattened* library part, since a derived symbol declares none
 * of its own.
 */
const ATTR_SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Sim:Only" (exclude_from_sim yes) (in_bom no) (on_board no) (in_pos_files no)
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "Only" (at 0 -2 0))
      (symbol "Only_0_1"))
    (symbol "Sim:Base" (exclude_from_sim yes) (in_bom no) (on_board yes)
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "Base" (at 0 -2 0))
      (symbol "Base_0_1"))
    (symbol "Sim:Derived" (extends "Sim:Base")
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "Derived" (at 0 -2 0)))
    (symbol "Sim:Silent"
      (property "Reference" "U" (at 0 0 0))
      (property "Value" "Silent" (at 0 -2 0))
      (symbol "Silent_0_1")))
  (symbol (lib_id "Sim:Only") (at 30 30 0) (unit 1) (uuid "a0")
    (property "Reference" "U1" (at 32 30 0))
    (property "Value" "Only" (at 32 28 0)))
  (symbol (lib_id "Sim:Derived") (at 40 30 0) (unit 1) (uuid "a1")
    (property "Reference" "U2" (at 42 30 0))
    (property "Value" "Derived" (at 42 28 0)))
  (symbol (lib_id "Sim:Silent") (at 50 30 0) (unit 1) (dnp yes) (in_bom no) (uuid "a2")
    (property "Reference" "U3" (at 52 30 0))
    (property "Value" "Silent" (at 52 28 0))))`;

const attrDoc = (): Schematic => readSchematic(parse(ATTR_SCH));
const attrLibs = (): Map<string, LibSymbol> =>
  new Map(attrDoc().libSymbols.map((l) => [l.libId, l]));

describe('the library part’s own attributes', () => {
  it('reads them, un-inverting the two that are stored the other way round', () => {
    const l = attrLibs().get('Sim:Only')!;
    // in_bom / on_board / in_pos_files are written as "included"; the model
    // stores "excluded from", like a placement does.
    expect(l.excludedFromSim).toBe(true);
    expect(l.excludedFromBom).toBe(true);
    expect(l.excludedFromBoard).toBe(true);
    expect(l.excludedFromPosFiles).toBe(true);
  });

  it('leaves them undefined when the library never wrote them', () => {
    const l = attrLibs().get('Sim:Silent')!;
    expect(l.excludedFromSim).toBeUndefined();
    expect(l.excludedFromBom).toBeUndefined();
  });

  it('takes a derived symbol’s attributes from its parent', () => {
    // "They are not supported in derived symbols" — the flattened part answers.
    const l = attrLibs().get('Sim:Derived')!;
    expect(l.excludedFromSim).toBe(true);
    expect(l.excludedFromBom).toBe(true);
    expect(l.excludedFromBoard).toBe(false);
  });
});

describe('Update/reset symbol attributes', () => {
  const run = (over: Partial<ChangeSymbolsOptions> = {}) =>
    changeSymbols(attrDoc(), attrLibs(), opts({ mode: 'update', resetAttributes: true, ...over }));

  it('copies all four onto the placement', () => {
    const s = run().doc.symbols[0]!;
    expect(s.excludedFromSim).toBe(true);
    expect(s.inBom).toBe(false);
    expect(s.onBoard).toBe(false);
    expect(s.excludedFromPosFiles).toBe(true);
  });

  it('copies the parent’s attributes through a derived symbol', () => {
    const s = run().doc.symbols[1]!;
    expect(s.excludedFromSim).toBe(true);
    expect(s.inBom).toBe(false);
    expect(s.onBoard).toBe(true);
  });

  it('leaves a placement alone where the library says nothing', () => {
    // Sim:Silent declares no attributes. Reading that as "no" would clear U3's
    // real exclude-from-BOM, which is data the user set.
    const s = run().doc.symbols[2]!;
    expect(s.inBom).toBe(false);
    expect(s.dnp).toBe(true);
  });

  it('changes nothing when the switch is off', () => {
    const before = attrDoc().symbols[0]!;
    const s = run({ resetAttributes: false }).doc.symbols[0]!;
    expect(s.inBom).toBe(before.inBom);
    expect(s.onBoard).toBe(before.onBoard);
    expect(s.excludedFromSim).toBe(before.excludedFromSim);
  });
});
