// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Selection Filter across the item surface, counterpart
 * SCH_SELECTION_TOOL::itemPassesFilter.
 *
 * The failure mode this sweep exists to catch is quiet in a particular way: an
 * id the resolver does not recognise *passes*, because an unresolved id is
 * assumed to be something the caller already vouched for. So a kind nobody
 * wired up is not merely mis-filtered — it ignores the filter entirely, and
 * every toggle looks like it works because the common kinds do.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  itemPassesFilter,
  type SelectionFilterOptions,
} from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';
import { refId, sheetPinId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** Every category on, locked items included, so only the toggle under test bites. */
const ALL_ON: SelectionFilterOptions = {
  lockedItems: true,
  symbols: true,
  text: true,
  wires: true,
  labels: true,
  pins: true,
  graphics: true,
  images: true,
  ruleAreas: true,
  otherItems: true,
};

/** Everything on, except the one category under test. */
const allBut = (off: keyof SelectionFilterOptions): SelectionFilterOptions => ({
  ...ALL_ON,
  [off]: false,
});

const SHEET = `(sheet (at 10 10) (size 20 20) (uuid "sh-1")
   (property "Sheetname" "sub" (at 10 9 0) (effects (font (size 1.27 1.27))))
   (property "Sheetfile" "sub.kicad_sch" (at 10 31 0) (effects (font (size 1.27 1.27))))
   (pin "A" input (at 10 14 180) (effects (font (size 1.27 1.27)))))`;

const DIRECTIVE = `(netclass_flag "HV" (length 2.54) (shape round) (at 50 50 0)
   (effects (font (size 1.27 1.27)) (justify left)) (uuid "nc-1")
   (property "Netclass" "HV" (at 50 50 0) (effects (font (size 1.27 1.27)))))`;

describe('a sheet pin follows the Pins toggle', () => {
  const doc = () => sheet(SHEET);
  const pinId = (d: Schematic) => sheetPinId(refId('sheet', d.sheets[0]!.uuid, 0), 0);

  it('passes when pins are on', () => {
    const d = doc();
    expect(itemPassesFilter(d, pinId(d), ALL_ON)).toBe(true);
  });

  it('is rejected when pins are off', () => {
    // Before this, a sheet pin resolved to nothing and so passed regardless —
    // the Pins toggle simply did not reach it.
    const d = doc();
    expect(itemPassesFilter(d, pinId(d), allBut('pins'))).toBe(false);
  });

  it('is not governed by the Symbols toggle', () => {
    const d = doc();
    expect(itemPassesFilter(d, pinId(d), allBut('symbols'))).toBe(true);
  });
});

describe('a directive label follows Other Items', () => {
  const doc = () => sheet(DIRECTIVE);
  const id = (d: Schematic) => refId('directive', (d.directiveLabels ?? [])[0]!.uuid, 0);

  it('passes when other items are on', () => {
    const d = doc();
    expect(itemPassesFilter(d, id(d), ALL_ON)).toBe(true);
  });

  it('is rejected when other items are off', () => {
    const d = doc();
    expect(itemPassesFilter(d, id(d), allBut('otherItems'))).toBe(false);
  });

  it('is NOT governed by Labels', () => {
    // Upstream lists SCH_LABEL_T, SCH_GLOBAL_LABEL_T and SCH_HIER_LABEL_T under
    // `labels` but not SCH_DIRECTIVE_LABEL_T, which reaches the default arm.
    const d = doc();
    expect(itemPassesFilter(d, id(d), allBut('labels'))).toBe(true);
  });
});

describe("a symbol's field is text, not part of the symbol", () => {
  const doc = () =>
    sheet(`(symbol (lib_id "Device:R") (at 20 20 0) (unit 1) (uuid "s-1")
       (property "Reference" "R1" (at 22 19 0) (effects (font (size 1.27 1.27))))
       (property "Value" "10k" (at 22 21 0) (effects (font (size 1.27 1.27)))))`);
  const fieldId = (d: Schematic) => `${refId('symbol', d.symbols[0]!.uuid, 0)}:field0`;

  it('is rejected when Text is off', () => {
    // SCH_FIELD_T sits with SCH_TEXT_T / SCH_TEXTBOX_T / SCH_TABLE_T upstream.
    const d = doc();
    expect(itemPassesFilter(d, fieldId(d), allBut('text'))).toBe(false);
  });

  it('survives the Symbols toggle being off', () => {
    const d = doc();
    expect(itemPassesFilter(d, fieldId(d), allBut('symbols'))).toBe(true);
  });

  it('still inherits its parent symbol’s locked state', () => {
    // The owner lookup is kept for exactly this: a field of a locked symbol is
    // locked, whatever category the field itself falls into.
    const d = sheet(`(symbol (lib_id "Device:R") (at 20 20 0) (unit 1) (uuid "s-1")
         (property "Reference" "R1" (at 22 19 0) (effects (font (size 1.27 1.27)))))`);
    const locked: Schematic = { ...d, symbols: [{ ...d.symbols[0]!, locked: true }] };
    const opts = { ...ALL_ON, lockedItems: false };
    expect(itemPassesFilter(locked, fieldId(locked), opts)).toBe(false);
  });
});

describe('the kinds that already worked still do', () => {
  it('a wire follows Wires, a bus entry follows Other Items', () => {
    const d = sheet(
      [
        `(wire (pts (xy 0 0) (xy 10 0)) (uuid "w-1"))`,
        `(bus_entry (at 20 20) (size 2.54 2.54) (uuid "be-1"))`,
      ].join('\n'),
    );
    expect(itemPassesFilter(d, refId('line', 'w-1', 0), allBut('wires'))).toBe(false);
    expect(itemPassesFilter(d, refId('busentry', 'be-1', 0), allBut('otherItems'))).toBe(false);
  });

  it('an unknown id still passes, which is what made the gaps quiet', () => {
    const d = sheet(`(wire (pts (xy 0 0) (xy 10 0)) (uuid "w-1"))`);
    expect(itemPassesFilter(d, 'nonsense:id', allBut('wires'))).toBe(true);
  });
});
