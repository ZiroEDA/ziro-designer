// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_tables/`: the two `PCB_TABLE`s Place > Board Characteristics
 * and Place > Stackup Table build (`board_characteristics_table.cpp`,
 * `board_stackup_table.cpp`).
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { Build_Board_Characteristics_Table } from '@ziroeda/pcbnew/board_tables/board_characteristics_table.js';
import { Build_Board_Stackup_Table } from '@ziroeda/pcbnew/board_tables/board_stackup_table.js';
import { BS_EDGE_CONNECTOR_BEVELLED } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** A 4-layer board with a 20 x 10 mm outline and one 0.2 mm track. */
function board(): BOARD {
  const b = new BOARD();
  b.SetCopperLayerCount(4);
  const rect = new PCB_SHAPE(b, SHAPE_T.RECTANGLE);
  rect.SetLayer(PCB_LAYER_ID.Edge_Cuts);
  rect.SetStart({ x: MM(100), y: MM(100) });
  rect.SetEnd({ x: MM(120), y: MM(110) });
  b.Add(rect);
  const track = new PCB_TRACK(b);
  track.SetStart({ x: MM(101), y: MM(101) });
  track.SetEnd({ x: MM(110), y: MM(101) });
  track.SetWidth(MM(0.2));
  b.Add(track);
  return b;
}

const rows = (cells: { GetText(): string }[], cols: number): string[][] => {
  const out: string[][] = [];
  for (let r = 0; r < cells.length / cols; r++)
    out.push(cells.slice(r * cols, r * cols + cols).map((c) => c.GetText()));
  return out;
};

describe('Build_Board_Stackup_Table', () => {
  it('is seven columns: a header row, then one row per stackup sublayer', () => {
    const t = Build_Board_Stackup_Table(board(), 'mm');
    expect(t.GetColCount()).toBe(7);
    const r = rows(t.GetCells(), 7);
    expect(r[0]).toEqual([
      'Layer Name',
      'Type',
      'Material',
      'Thickness',
      'Color',
      'Epsilon R',
      'Loss Tangent',
    ]);
    // 13 rows for the default 4-layer stackup (silk, paste, mask, 4 Cu, 3 dielectric, ×2).
    expect(r.length).toBe(14);
    // `InitialCaps( GetTypeName() )`: "Top silk screen", not "Top Silk Screen".
    expect(r[1]).toEqual([
      'F.Silkscreen',
      'Top silk screen',
      'Not specified',
      'Not specified',
      'Not specified',
      '1',
      '0',
    ]);
    // A dielectric is named by its id, not its (empty) layer name.
    expect(r[5]).toEqual([
      'Dielectric 1',
      'Core',
      'FR4',
      '0.48 mm',
      'Not specified',
      '4.5',
      '0.02',
    ]);
    expect(r[4]![0]).toBe('F.Cu');
    expect(r[4]![3]).toBe('0.035 mm');
    // Paste has no editable thickness: "Not specified", never "0 mm".
    expect(r[2]![3]).toBe('Not specified');
  });

  it('header cells are 1.5 mm / 0.3 mm, data 1.5 mm / 0.2 mm, numbers right-justified', () => {
    const t = Build_Board_Stackup_Table(board(), 'mm');
    const cells = t.GetCells();
    expect(cells[0]!.GetTextSize()).toEqual({ x: MM(1.5), y: MM(1.5) });
    expect(cells[0]!.GetTextThickness()).toBe(MM(0.3));
    expect(cells[7]!.GetTextThickness()).toBe(MM(0.2));
    // Thickness, Epsilon R, Loss Tangent are 'R'; the rest left.
    const data = cells.slice(7, 14);
    expect(
      data.map((c) => c.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT),
    ).toEqual([false, false, false, true, false, true, true]);
    expect(t.GetPosition()).toEqual({ x: 0, y: 0 });
  });

  it('a two-sublayer dielectric gets "Dielectric N (i/n)" rows, and inches follow the units', () => {
    const b = board();
    // A fresh board's stackup is empty until the builder's `SynchronizeWithBoard`.
    Build_Board_Stackup_Table(b, 'mm');
    const item = b.GetDesignSettings().GetStackupDescriptor().GetList()[4]!;
    item.AddDielectricPrms(1);
    const t = Build_Board_Stackup_Table(b, 'in');
    const r = rows(t.GetCells(), 7);
    expect(r.length).toBe(15);
    expect(r[5]![0]).toBe('Dielectric 1 (1/2)');
    expect(r[6]![0]).toBe('Dielectric 1 (2/2)');
    // The digits are stringFromValue's (pinned in its own test); the unit is the point.
    expect(r[4]![3]).toMatch(/^0\.00137\d* in$/);
  });
});

describe('Build_Board_Characteristics_Table', () => {
  it('four columns, a spanning title, no strokes, and every row upstream writes', () => {
    const t = Build_Board_Characteristics_Table(board(), 'mm');
    expect(t.GetColCount()).toBe(4);
    const cells = t.GetCells();
    expect(cells[0]!.GetText()).toBe('BOARD CHARACTERISTICS');
    expect(cells[0]!.GetColSpan()).toBe(4);
    expect(cells[0]!.GetTextSize()).toEqual({ x: MM(2.0), y: MM(2.0) });
    expect(cells[0]!.GetTextThickness()).toBe(MM(0.4));
    // The three filler header cells are colspan 0.
    expect(cells.slice(1, 4).map((c) => c.GetColSpan())).toEqual([0, 0, 0]);
    expect(rows(cells, 4).slice(1)).toEqual([
      ['Copper layer count: ', '4', 'Board thickness: ', '1.6000 mm'],
      ['Board overall dimensions: ', '20.0000 mm x 10.0000 mm', '', ''],
      ['Min track/spacing: ', '0.2000 mm / 2147.4836 mm', 'Min hole diameter: ', '2147.4836 mm'],
      ['Copper finish: ', 'None', 'Impedance control: ', 'No'],
      ['Castellated pads: ', 'No', 'Press-fit pads: ', 'No'],
      ['Plated board edge: ', 'No', 'Edge card connectors: ', 'No'],
    ]);
    expect(t.StrokeExternal()).toBe(false);
    expect(t.StrokeHeaderSeparator()).toBe(false);
    expect(t.StrokeColumns()).toBe(false);
    expect(t.StrokeRows()).toBe(false);
  });

  it('reads the stackup flags: finish, impedance control, plated edge, bevelled connector', () => {
    const b = board();
    const st = b.GetDesignSettings().GetStackupDescriptor();
    st.m_FinishType = 'ENIG';
    st.m_HasDielectricConstrains = true;
    st.m_EdgePlating = true;
    st.m_EdgeConnectorConstraints = BS_EDGE_CONNECTOR_BEVELLED;
    const r = rows(Build_Board_Characteristics_Table(b, 'mm').GetCells(), 4);
    expect(r[4]).toEqual(['Copper finish: ', 'ENIG', 'Impedance control: ', 'Yes']);
    expect(r[6]).toEqual(['Plated board edge: ', 'Yes', 'Edge card connectors: ', 'Yes, Bevelled']);
  });
});
