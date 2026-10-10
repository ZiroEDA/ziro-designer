// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `EditCommand` factories that no test called (#407), found by the
 * coverage guard in `undo_sweep.test.ts`.
 *
 * Nothing had ever applied them and nothing had ever run their `invert`. Each
 * gets the same treatment the sweep gives the rest: apply changes the document,
 * undo puts it back byte for byte, redo puts it forward again.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { setSymbolsCommand } from '@ziroeda/eeschema/annotate.js';
import { replaceSheetPin } from '@ziroeda/eeschema/tools/sch_sheet_pin_tool.js';
import type { EditCommand } from '@ziroeda/eeschema/tools/command.js';
import type { Schematic } from '@ziroeda/eeschema/types.js';

const FIXTURE = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
        (stroke (width 0) (type default)) (fill (type none))))))
  (wire (pts (xy 10 10) (xy 50 10))
    (stroke (width 0.2) (type solid)) (uuid "w-1"))
  (symbol (lib_id "L:R") (at 10 50 0) (unit 1)
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-1")
    (property "Reference" "R?" (at 12 48 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 12 52 0) (effects (font (size 1.27 1.27)))))
  (sheet (at 60 50) (size 20 20) (stroke (width 0.1) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh-1")
    (property "Sheetname" "sub" (at 60 49 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 60 71 0)
      (effects (font (size 1.27 1.27))))
    (pin "CLK" input (at 60 55 180) (effects (font (size 1.27 1.27))) (uuid "p-1"))))`;

const doc = (): Schematic => readSchematic(parse(FIXTURE));

/** Annotate everything from scratch, incrementally — DIALOG_ANNOTATE's defaults. */
const ANNOTATE_ALL = {
  scope: 'all',
  order: 'x',
  algo: 'incremental',
  resetExisting: true,
  startNumber: 0,
} as const;
const libById = new Map(doc().libSymbols.map((l) => [l.libId, l]));

/** apply changes it, undo restores it exactly, redo puts it forward again. */
function roundTrip(name: string, before: Schematic, cmd: EditCommand): void {
  const text = serializeSchematic(before);
  const after = cmd.apply(before);
  expect(serializeSchematic(after), `${name} changed nothing`).not.toBe(text);
  expect(serializeSchematic(cmd.invert(before).apply(after)), `${name} did not undo`).toBe(text);
  const undone = cmd.invert(before).apply(after);
  expect(
    serializeSchematic(cmd.invert(before).invert(after).apply(undone)),
    `${name} did not redo`,
  ).toBe(serializeSchematic(after));
}

describe('the commands nothing was calling', () => {
  it('setSymbolsCommand', () => {
    const d = doc();
    const symbols = d.symbols.map((s) => ({
      ...s,
      fields: s.fields.map((f) => (f.key === 'Value' ? { ...f, value: '4k7' } : f)),
    }));
    roundTrip('setSymbolsCommand', d, setSymbolsCommand(symbols, 'Edit Symbols'));
  });

  it('replaceSheetPin', () => {
    const d = doc();
    const pin = d.sheets[0]!.pins[0]!;
    roundTrip(
      'replaceSheetPin',
      d,
      replaceSheetPin({ sheet: 0, pin: 0 }, { ...pin, name: 'RESET' }),
    );
  });
});
