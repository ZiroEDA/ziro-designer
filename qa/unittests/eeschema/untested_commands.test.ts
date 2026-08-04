// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The five `EditCommand` factories that no test called (#407), found by the
 * coverage guard in `undo_sweep.test.ts`.
 *
 * Nothing had ever applied them and nothing had ever run their `invert`. Each
 * gets the same treatment the sweep gives the rest: apply changes the document,
 * undo puts it back byte for byte, redo puts it forward again.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { annotateCommand, setSymbolsCommand } from '@ziroeda/eeschema/src/tools/annotate.js';
import { splitLinesCommand } from '@ziroeda/eeschema/src/tools/break_wire.js';
import { embeddedFilesCommand, setEmbedFonts } from '@ziroeda/eeschema/src/tools/embedded.js';
import { replaceSheetPin } from '@ziroeda/eeschema/src/tools/sch_sheet_pin_tool.js';
import type { EditCommand } from '@ziroeda/eeschema/src/tools/command.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

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
  it('annotateCommand', () => {
    const d = doc();
    roundTrip('annotateCommand', d, annotateCommand(libById, ANNOTATE_ALL));
    // And it did the thing: R? becomes a real reference.
    const after = annotateCommand(libById, ANNOTATE_ALL).apply(d);
    expect(after.symbols[0]!.fields.find((f) => f.key === 'Reference')!.value).not.toBe('R?');
  });

  it('setSymbolsCommand', () => {
    const d = doc();
    const symbols = d.symbols.map((s) => ({
      ...s,
      fields: s.fields.map((f) => (f.key === 'Value' ? { ...f, value: '4k7' } : f)),
    }));
    roundTrip('setSymbolsCommand', d, setSymbolsCommand(symbols, 'Edit Symbols'));
  });

  it('splitLinesCommand', () => {
    // Break at the midpoint: the original wire is shortened and a second one
    // carries the rest.
    const d = doc();
    const line = d.lines[0]!;
    const mid = { x: (line.start.x + line.end.x) / 2, y: line.start.y };
    roundTrip(
      'splitLinesCommand',
      d,
      splitLinesCommand('break', new Map([[0, mid]]), [{ ...line, start: mid, uuid: 'w-2' }]),
    );
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

  it('embeddedFilesCommand', () => {
    // The zstd work is async, so the dialog computes the document first and the
    // command only swaps the source in. Toggling the fonts flag is the smallest
    // change that produces a different source.
    const d = doc();
    roundTrip('embeddedFilesCommand', d, embeddedFilesCommand(setEmbedFonts(d, true)));
  });

  it('embeddedFilesCommand replaces only the source, not the items', () => {
    // Worth pinning: it swaps a whole precomputed `source` in. If it dropped
    // the model arrays with it, every item would vanish on an embed.
    const d = doc();
    const after = embeddedFilesCommand(setEmbedFonts(d, true)).apply(d);
    expect(after.symbols).toBe(d.symbols);
    expect(after.sheets).toBe(d.sheets);
  });
});
