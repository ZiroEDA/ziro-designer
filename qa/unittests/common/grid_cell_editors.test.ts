// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRID_CELL_COMBOBOX` (common/widgets/grid_combobox.cpp) and
 * `GRID_CELL_MARK_AS_NULLABLE` / `GRID_CELL_NULLABLE_INTERFACE`
 * (include/widgets/grid_text_helpers.h:166-207), and what `WX_GRID::onCellEditorHidden`
 * does with a nullable cell (common/widgets/wx_grid.cpp:438-492).
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GRID_CELL_COMBOBOX } from '@ziroeda/common/widgets/grid_combobox.js';
import {
  GRID_CELL_MARK_AS_NULLABLE,
  GRID_CELL_TEXT_EDITOR,
  isNullableEditor,
} from '@ziroeda/common/widgets/grid_text_helpers.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridCellAttr, wxGridStringTable } from '@ziroeda/common/wx/grid.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';

describe('GRID_CELL_COMBOBOX', () => {
  it('is a choice editor over its names that also takes typed text (:35, wxComboBox default style)', () => {
    const e = new GRID_CELL_COMBOBOX(['a', 'b']);
    expect(e.m_choices).toEqual(['a', 'b']);
    expect(e.m_allowOthers).toBe(true);
  });

  it('clones with its names (:41-44)', () => {
    const c = new GRID_CELL_COMBOBOX(['a', 'b']).Clone();
    expect(c).toBeInstanceOf(GRID_CELL_COMBOBOX);
    expect(c.m_choices).toEqual(['a', 'b']);
  });
});

describe('GRID_CELL_MARK_AS_NULLABLE', () => {
  it('is nullable by default, and as told (.h:192-199)', () => {
    expect(new GRID_CELL_MARK_AS_NULLABLE().IsNullable()).toBe(true);
    expect(new GRID_CELL_MARK_AS_NULLABLE(true).IsNullable()).toBe(true);
    expect(new GRID_CELL_MARK_AS_NULLABLE(false).IsNullable()).toBe(false);
  });

  it('Reset does nothing, so an edit is not rolled back to the text it started from (.h:203)', () => {
    const e = new GRID_CELL_MARK_AS_NULLABLE();
    e.m_value = 'typed';
    e.Reset();
    expect(e.m_value).toBe('typed');
  });

  it('is recognised by the interface test, and a plain editor is not', () => {
    expect(isNullableEditor(new GRID_CELL_MARK_AS_NULLABLE())).toBe(true);
    expect(isNullableEditor(new GRID_CELL_TEXT_EDITOR())).toBe(false);
    expect(isNullableEditor(null)).toBe(false);
  });
});

describe('WX_GRID::onCellEditorHidden and a nullable cell', () => {
  const make = (aNullable: boolean): WX_GRID => {
    const g = new WX_GRID();
    g.SetTable(new wxGridStringTable(1, 2), true);
    g.SetUnitsProvider(new UNITS_PROVIDER(pcbIUScale, 'mm'), 0);
    g.SetAutoEvalCols([0, 1]);
    const a = new wxGridCellAttr();
    a.SetEditor(new GRID_CELL_MARK_AS_NULLABLE(aNullable));
    g.SetColAttr(0, a);
    return g;
  };
  const type = async (g: WX_GRID, col: number, text: string): Promise<void> => {
    g.SetGridCursor(0, col);
    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = text;
    g.DisableCellEditControl();
    await new Promise((r) => setTimeout(r, 0));
  };

  it('an empty entry in a nullable cell stays empty', async () => {
    const g = make(true);
    g.SetCellValue(0, 0, '1 mm');
    await type(g, 0, '');
    expect(g.GetCellValue(0, 0)).toBe('');
  });

  it('a number in a nullable cell is formatted with its unit', async () => {
    const g = make(true);
    await type(g, 0, '2');
    expect(g.GetCellValue(0, 0)).toBe('2 mm');
  });

  it('an empty entry in a cell that is not nullable becomes 0', async () => {
    const g = make(false);
    await type(g, 0, '');
    expect(g.GetCellValue(0, 0)).toBe('0 mm');
  });

  it('an auto-eval cell with no nullable editor becomes 0', async () => {
    const g = make(true);
    await type(g, 1, '');
    expect(g.GetCellValue(0, 1)).toBe('0 mm');
  });
});
