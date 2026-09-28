// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TABLE_PROPERTIES on a live PCB_TABLE (dialog_table_properties.cpp).
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { DIALOG_TABLE_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_table_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_TABLE } from '@ziroeda/pcbnew/pcb_table.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

const cell = (
  text: string,
  n: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  span = '(span 1 1)',
) =>
  `(table_cell "${text}" (start ${x0} ${y0}) (end ${x1} ${y1}) (margins 1 1 1 1) ${span}
        (layer "LAYER") (uuid "aaaaaaaa-0000-4000-8000-00000000000${n}") (effects (font (size 1 1))))`;

function load(layer = 'F.SilkS', spans: string[] = []) {
  const board = ParseBoard(
    `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen"))
  (net 0 "")
  (table (column_count 2) (uuid "d6f049b1-ff3f-4087-ba96-404a150d1c9b") (layer "LAYER")
    (border (external yes) (header no) (stroke (width 0.2) (type solid)))
    (separators (rows yes) (cols yes) (stroke (width 0.05) (type dash)))
    (column_widths 10 10) (row_heights 5 5)
    (cells
      ${cell('A', 1, 0, 0, 10, 5, spans[0])}
      ${cell('B', 2, 10, 0, 20, 5, spans[1])}
      ${cell('C', 3, 0, 5, 10, 10, spans[2])}
      ${cell('D', 4, 10, 5, 20, 10, spans[3])})))`.replaceAll('LAYER', layer),
  );
  const frame = new TEST_PCB_FRAME(board);
  const table = () => board.Drawings()[0] as PCB_TABLE;
  return { board, frame, table, dlg: () => new DIALOG_TABLE_PROPERTIES(frame, table()) };
}

describe('DIALOG_TABLE_PROPERTIES', () => {
  it('reads the grid and the strokes', () => {
    const { dlg } = load();
    expect(dlg().TransferDataToWindow()).toEqual({
      layer: 'F.SilkS',
      locked: false,
      borderExternal: true,
      borderHeader: false,
      borderWidth: MM(0.2),
      borderStyle: 'solid',
      separatorRows: true,
      separatorCols: true,
      separatorWidth: MM(0.05),
      separatorStyle: 'dash',
      cellText: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    });
  });

  it('shows a back-layer table mirrored, and writes it back the same way', () => {
    const { dlg, table } = load('B.SilkS');
    const v = dlg().TransferDataToWindow();
    expect(v.cellText).toEqual([
      ['B', 'A'],
      ['D', 'C'],
    ]);
    dlg().TransferDataFromWindow({ ...v, cellText: [['left', 'right'], v.cellText[1]!] });
    expect(table().GetCell(0, 1)!.GetText()).toBe('left');
    expect(table().GetCell(0, 0)!.GetText()).toBe('right');
  });

  it('writes the grid through the layer the table is on, then moves every cell', () => {
    // The loop reads IsBackLayer( m_table->GetLayer() ) before SetLayer: a
    // front table sent to the back keeps its columns where the grid showed them.
    const { dlg, table, frame } = load();
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, layer: 'B.SilkS' });
    expect(table().GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
    expect(table().GetCell(0, 0)!.GetText()).toBe('A');
    expect(table().GetCell(1, 1)!.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
    expect(frame.GetUndoCommandCount()).toBe(1);
  });

  it('turning both separators off stores a -1 width', () => {
    const { dlg, table } = load();
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({
      ...v,
      separatorRows: false,
      separatorCols: false,
      borderStyle: 'dot',
    });
    expect(table().GetSeparatorsStroke().GetWidth()).toBe(-1);
    expect(table().GetBorderStroke().GetLineStyle()).toBe(LINE_STYLE.DOT);
    const again = dlg().TransferDataToWindow();
    expect(again.separatorRows).toBe(false);
    expect(again.separatorWidth).toBe(0);
    // A flag left on over a -1 stroke still reads as off.
    table().SetStrokeRows(true);
    expect(dlg().TransferDataToWindow().separatorRows).toBe(false);
  });

  it('a covered cell shows and keeps no text', () => {
    const { dlg, table } = load('F.SilkS', ['(span 2 1)', '(span 0 0)']);
    const v = dlg().TransferDataToWindow();
    expect(v.cellText[0]).toEqual(['A', '']);
    dlg().TransferDataFromWindow({ ...v, cellText: [['A', 'typed'], v.cellText[1]!] });
    expect(table().GetCell(0, 1)!.GetText()).toBe('');
  });
});
