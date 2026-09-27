// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * LIB_TABLE_GRID_DATA_MODEL (common/libraries/lib_table_grid_data_model.cpp)
 * and LIB_TABLE_GRID_TRICKS (common/lib_table_grid_tricks.cpp) on a headless
 * WX_GRID. Each expectation is the C++ walked by hand.
 */
import { describe, expect, it } from 'vitest';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { LIB_TABLE_GRID_TRICKS } from '@ziroeda/common/lib_table_grid_tricks.js';
import {
  COL_DESCR,
  COL_ENABLED,
  COL_NICKNAME,
  COL_STATUS,
  COL_URI,
  COL_VISIBLE,
  LIB_TABLE_GRID_DATA_MODEL,
} from '@ziroeda/common/libraries/lib_table_grid_data_model.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  type LIBRARY_TABLE_ROW,
} from '@ziroeda/common/libraries/library_table.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';

const TABLE = `(sym_lib_table
  (version 7)
  (lib (name "A")(type "KiCad")(uri "\${KIPRJMOD}/a.kicad_sym")(options "")(descr "first"))
  (lib (name "B")(type "KiCad")(uri "\${KIPRJMOD}/b.kicad_sym")(options "")(descr "")(disabled))
  (lib (name "C")(type "KiCad")(uri "\${KIPRJMOD}/c.kicad_sym")(options "")(descr ""))
)`;

class TRICKS extends LIB_TABLE_GRID_TRICKS {
  options: number[] = [];
  protected optionsEditor(aRow: number): void {
    this.options.push(aRow);
  }
  protected openTable(_aRow: LIBRARY_TABLE_ROW): void {}
  protected supportsVisibilityColumn(): boolean {
    return true;
  }
  protected getTablePreamble(): string {
    return '(sym_lib_table';
  }
}

function make(aReadOnly = false): {
  g: WX_GRID;
  model: LIB_TABLE_GRID_DATA_MODEL;
  source: LIBRARY_TABLE;
} {
  const source = new LIBRARY_TABLE(true, TABLE, LIBRARY_TABLE_SCOPE.PROJECT);
  source.SetReadOnly(aReadOnly);
  const g = new WX_GRID();
  const model = new LIB_TABLE_GRID_DATA_MODEL(source, null, ['KiCad', 'Legacy']);
  g.SetTable(model, true);
  new TRICKS(g);
  return { g, model, source };
}

const errors: string[] = [];
SetErrorPresenter((aText) => errors.push(aText));

describe('LIB_TABLE_GRID_DATA_MODEL', () => {
  it('edits a working copy, not the table it was given', () => {
    const { model, source } = make();
    model.SetValue(0, COL_DESCR, 'changed');
    expect(model.GetValue(0, COL_DESCR)).toBe('changed');
    expect(source.Rows()[0]!.Description()).toBe('first');
  });

  it('shows the nickname unescaped and stores it escaped', () => {
    const { model } = make();
    model.SetValue(0, COL_NICKNAME, 'D:y');
    expect(model.At(0).Nickname()).toBe('D{colon}y');
    expect(model.GetValue(0, COL_NICKNAME)).toBe('D:y');
  });

  it('reads Enable and Show as bools and "0"/"1"', () => {
    const { model } = make();
    expect(model.GetValue(1, COL_ENABLED)).toBe('0');
    expect(model.GetValueAsBool(0, COL_ENABLED)).toBe(true);
    model.SetValueAsBool(0, COL_VISIBLE, false);
    expect(model.At(0).Hidden()).toBe(true);
    expect(model.GetColLabelValue(COL_STATUS)).toBe(' ');
  });

  it('a read-only table takes only Enable and Show, and no rows', () => {
    const { model } = make(true);
    model.SetValue(0, COL_DESCR, 'nope');
    expect(model.GetValue(0, COL_DESCR)).toBe('first');
    model.SetValue(0, COL_ENABLED, '0');
    expect(model.At(0).Disabled()).toBe(true);
    expect(model.AppendRows(1)).toBe(false);
    expect(model.DeleteRows(0, 1)).toBe(false);
    expect(model.GetNumberRows()).toBe(3);
  });

  it('marks the page dirty on every change', () => {
    const { model } = make();
    let dirty = 0;
    model.SetChangeCallback(() => dirty++);
    model.SetValue(0, COL_DESCR, 'x');
    model.AppendRows(1);
    model.DeleteRows(3, 1);
    expect(dirty).toBe(3);
  });
});

describe('LIB_TABLE_GRID_TRICKS', () => {
  it('moves the cursor row up and down in the table', () => {
    const { g, model } = make();
    g.SetGridCursor(1, COL_NICKNAME);
    LIB_TABLE_GRID_TRICKS.MoveUpHandler(g);
    expect(
      model
        .Table()
        .Rows()
        .map((r) => r.Nickname()),
    ).toEqual(['B', 'A', 'C']);
    expect(g.GetGridCursorRow()).toBe(0);
    LIB_TABLE_GRID_TRICKS.MoveDownHandler(g);
    LIB_TABLE_GRID_TRICKS.MoveDownHandler(g);
    expect(
      model
        .Table()
        .Rows()
        .map((r) => r.Nickname()),
    ).toEqual(['A', 'C', 'B']);
  });

  it('appends a row and deletes the cursor row', () => {
    const { g, model } = make();
    LIB_TABLE_GRID_TRICKS.AppendRowHandler(g);
    expect(model.GetNumberRows()).toBe(4);
    expect(g.GetGridCursorRow()).toBe(3);
    g.CancelPendingChanges();
    g.ClearSelection();
    g.SetGridCursor(0, COL_NICKNAME);
    LIB_TABLE_GRID_TRICKS.DeleteRowHandler(g);
    expect(
      model
        .Table()
        .Rows()
        .map((r) => r.Nickname()),
    ).toEqual(['B', 'C', '']);
  });

  it('VerifyTable drops path-less rows, trims, and refuses duplicates', () => {
    const { g, model } = make();
    model.AppendRows(1); // no URI: silently removed
    model.SetValue(1, COL_NICKNAME, '  A ');
    let at: [number, number] | null = null;
    errors.length = 0;
    expect(LIB_TABLE_GRID_TRICKS.VerifyTable(g, true, (r, c) => (at = [r, c]))).toBe(false);
    expect(model.GetNumberRows()).toBe(3);
    expect(model.GetValue(1, COL_NICKNAME)).toBe('A');
    expect(at).toEqual([1, 1]);
    expect(errors).toEqual(["Multiple libraries cannot share the same nickname ('A')."]);
  });

  it('VerifyTable names an illegal character', () => {
    const { g, model } = make();
    model.SetValue(2, COL_NICKNAME, 'C:x');
    errors.length = 0;
    expect(LIB_TABLE_GRID_TRICKS.VerifyTable(g, true, () => {})).toBe(false);
    expect(errors).toEqual(["Illegal character ':' in nickname 'C:x'."]);
  });

  it('VerifyTable refuses a missing nickname and clears Show when unsupported', () => {
    const { g, model } = make();
    model.SetValueAsBool(0, COL_VISIBLE, false);
    expect(LIB_TABLE_GRID_TRICKS.VerifyTable(g, false, () => {})).toBe(true);
    expect(model.At(0).Hidden()).toBe(false);
    model.SetValue(0, COL_NICKNAME, '');
    errors.length = 0;
    expect(LIB_TABLE_GRID_TRICKS.VerifyTable(g, false, () => {})).toBe(false);
    expect(errors).toEqual(['Library must have a nickname.']);
  });
});
