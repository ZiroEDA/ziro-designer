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
/**
 * Options for an ENGINE test, which is not the same thing as the dialog's
 * opening state.
 *
 * `defaultChangeSymbolsOptions` answers "what does DIALOG_CHANGE_SYMBOLS open
 * with", and upstream opens with the reference and the value UNCHECKED —
 * `m_ChangeSymbols.updateReferences` / `.updateValues` both default false
 * (eeschema_settings.cpp:636,639), because rewriting every reference from the
 * library is the destructive one. That opening state is pinned in
 * `designer/change_symbols_dialog.test.ts`, where it belongs.
 *
 * The tests below are about what the engine DOES to a field once it has been
 * selected, so they select all five mandatory fields and say so, rather than
 * leaning on whatever the dialog happens to offer. Every expectation in this
 * file is unchanged; only the setup stopped being implicit.
 */
const MANDATORY = ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description'];

const opts = (over: Partial<ChangeSymbolsOptions>): ChangeSymbolsOptions => ({
  ...defaultChangeSymbolsOptions(over.mode ?? 'update'),
  updateFields: new Set(MANDATORY),
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

/**
 * A part whose pin 2 has alternates, a placement using one, a pin-map override,
 * and a second library part that dropped the alternate the placement uses.
 */
const PINS_SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "MCU:U"
      (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "U" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "U_1_1"
        (pin power_in line (at 0 2.54 270) (length 2.54) (name "VCC") (number "1"))
        (pin bidirectional line (at 0 -2.54 90) (length 2.54)
          (name "PA0") (number "2")
          (alternate "SCK" output clock)))
      (symbol "U_2_1"
        (pin passive line (at 5 0 0) (length 2.54)
          (name "GND") (number "3")
          (alternate "AGND" passive line))))
    (symbol "MCU:U2"
      (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "U2" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "U2_1_1"
        (pin power_in line (at 0 2.54 270) (length 2.54) (name "VCC") (number "1"))
        (pin bidirectional line (at 0 -2.54 90) (length 2.54)
          (name "PA0") (number "2")))))
  (symbol (lib_id "MCU:U") (at 30 30 0) (unit 1) (uuid "u0")
    (property "Reference" "U1" (at 32 30 0) (effects (font (size 1.27 1.27))))
    (property "Value" "U" (at 32 28 0) (effects (font (size 1.27 1.27))))
    (pin_map_override (mode named_map) (map "STD-8"))
    (pin "1" (uuid "p-1"))
    (pin "2" (uuid "p-2") (alternate "SCK"))
    (pin "3" (uuid "p-3") (alternate "AGND"))))`;

const pinsDoc = (): Schematic => readSchematic(parse(PINS_SCH));
const pinsLibs = (): Map<string, LibSymbol> =>
  new Map(pinsDoc().libSymbols.map((l) => [l.libId, l]));
const altOf = (d: Schematic, number: string): string | undefined =>
  d.symbols[0]!.pins?.find((p) => p.number === number)?.alternate;

describe('alternate pins and pin map overrides', () => {
  it('leaves a valid alternate alone with the reset box off', () => {
    const r = changeSymbols(
      pinsDoc(),
      pinsLibs(),
      opts({ mode: 'update', resetAlternatePin: false, resetPinMapOverrides: false }),
    );
    expect(altOf(r.doc, '2')).toBe('SCK');
  });

  it('clears every alternate with the reset box on', () => {
    const r = changeSymbols(
      pinsDoc(),
      pinsLibs(),
      opts({ mode: 'update', resetAlternatePin: true }),
    );
    expect(altOf(r.doc, '2')).toBeUndefined();
    expect(altOf(r.doc, '3')).toBeUndefined();
    // The pin's identity is not collateral damage.
    expect(r.doc.symbols[0]!.pins?.find((p) => p.number === '2')?.uuid).toBe('p-2');
  });

  it('keeps an alternate on a pin of another unit, box off', () => {
    // The placement is unit 1, but its (pin …) list covers the whole part
    // (GetRawPins). Checking only the placed unit's pins would read pin 3 as
    // "not in the library" and clear a perfectly valid alternate.
    const r = changeSymbols(
      pinsDoc(),
      pinsLibs(),
      opts({ mode: 'update', resetAlternatePin: false }),
    );
    expect(altOf(r.doc, '3')).toBe('AGND');
  });

  it('clears a stale alternate even with the box off, on a Change', () => {
    // MCU:U2's pin 2 declares no alternates at all, so "SCK" no longer names
    // anything — upstream clears it whether or not the box is checked.
    const r = changeSymbols(
      pinsDoc(),
      pinsLibs(),
      opts({
        mode: 'change',
        newLibId: 'MCU:U2',
        resetAlternatePin: false,
        resetPinMapOverrides: false,
      }),
    );
    expect(r.doc.symbols[0]!.libId).toBe('MCU:U2');
    expect(altOf(r.doc, '2')).toBeUndefined();
  });

  it('drops the pin map override only when its box is on', () => {
    const kept = changeSymbols(
      pinsDoc(),
      pinsLibs(),
      opts({ mode: 'update', resetPinMapOverrides: false }),
    );
    expect(kept.doc.symbols[0]!.pinMapOverride?.mapName).toBe('STD-8');
    const reset = changeSymbols(
      pinsDoc(),
      pinsLibs(),
      opts({ mode: 'update', resetPinMapOverrides: true }),
    );
    expect(reset.doc.symbols[0]!.pinMapOverride).toBeUndefined();
  });

  it('defaults both boxes on for Change and off for Update', () => {
    // TransferDataToWindow: MODE::CHANGE checks them, MODE::UPDATE does not.
    expect(defaultChangeSymbolsOptions('change').resetAlternatePin).toBe(true);
    expect(defaultChangeSymbolsOptions('change').resetPinMapOverrides).toBe(true);
    expect(defaultChangeSymbolsOptions('update').resetAlternatePin).toBe(false);
    expect(defaultChangeSymbolsOptions('update').resetPinMapOverrides).toBe(false);
  });
});
