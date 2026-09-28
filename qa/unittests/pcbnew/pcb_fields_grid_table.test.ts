// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_FIELDS_GRID_TABLE` (`pcbnew/pcb_fields_grid_table.cpp`). Cases derived
 * from the C++: a mandatory field's Name column is read-only, the X/Y Offset
 * columns round-trip through `GetFPRelativePosition`/`SetFPRelativePosition`
 * (footprint-relative, not absolute board position), and each typed
 * column (bool/long/string) only answers `CanGetValueAs` for its own type.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PCB_FIELD } from '@ziroeda/pcbnew/pcb_field.js';
import {
  PCB_FIELDS_COL_ORDER,
  PCB_FIELDS_GRID_TABLE,
} from '@ziroeda/pcbnew/pcb_fields_grid_table.js';

const MM = (mm: number) => pcbIUScale.mmToIU(mm);
const units = new UNITS_PROVIDER(pcbIUScale, 'mm');
const {
  PFC_NAME,
  PFC_VALUE,
  PFC_SHOWN,
  PFC_LAYER,
  PFC_XOFFSET,
  PFC_YOFFSET,
  PFC_UPRIGHT,
} = PCB_FIELDS_COL_ORDER;

function mkFootprint(): FOOTPRINT {
  const board = new BOARD();
  const fp = new FOOTPRINT(board);
  fp.SetPosition({ x: MM(10), y: MM(20) });
  return fp;
}

describe('PCB_FIELDS_GRID_TABLE', () => {
  it('GetNumberRows/GetNumberCols and the column labels', () => {
    const fp = mkFootprint();
    const ref = new PCB_FIELD(fp, FIELD_T.REFERENCE);
    const table = new PCB_FIELDS_GRID_TABLE(units, [ref]);

    expect(table.GetNumberRows()).toBe(1);
    expect(table.GetNumberCols()).toBe(PCB_FIELDS_COL_ORDER.PFC_COUNT);
    expect(table.GetColLabelValue(PFC_NAME)).toBe('Name');
    expect(table.GetColLabelValue(PFC_XOFFSET)).toBe('X Offset');
  });

  it('a mandatory field (Reference) is read-only in the Name column; a user field is not', () => {
    const fp = mkFootprint();
    const ref = new PCB_FIELD(fp, FIELD_T.REFERENCE);
    const user = new PCB_FIELD(fp, FIELD_T.USER, 'MyField');
    const table = new PCB_FIELDS_GRID_TABLE(units, [ref, user]);

    expect(table.GetMandatoryRowCount()).toBe(1);
    expect(table.GetAttr(0, PFC_NAME, 0)?.IsReadOnly()).toBe(true);
    expect(table.GetAttr(1, PFC_NAME, 0)?.IsReadOnly() ?? false).toBe(false);
  });

  it('Name/Value round-trip as plain strings', () => {
    const fp = mkFootprint();
    const field = new PCB_FIELD(fp, FIELD_T.USER, 'Tolerance');
    const table = new PCB_FIELDS_GRID_TABLE(units, [field]);

    expect(table.GetValue(0, PFC_NAME)).toBe('Tolerance');

    table.SetValue(0, PFC_VALUE, '1%');
    expect(table.GetValue(0, PFC_VALUE)).toBe('1%');
  });

  it('Shown is a bool column, round-tripping through IsVisible/SetVisible', () => {
    const fp = mkFootprint();
    const field = new PCB_FIELD(fp, FIELD_T.USER, 'X');
    const table = new PCB_FIELDS_GRID_TABLE(units, [field]);

    expect(table.CanGetValueAs(0, PFC_SHOWN, 'bool')).toBe(true);
    expect(table.CanGetValueAs(0, PFC_SHOWN, 'string')).toBe(false);

    table.SetValueAsBool(0, PFC_SHOWN, false);
    expect(table.GetValueAsBool(0, PFC_SHOWN)).toBe(false);
    expect(field.IsVisible()).toBe(false);

    // Keep Upright is a bool column too.
    table.SetValueAsBool(0, PFC_UPRIGHT, true);
    expect(field.IsKeepUpright()).toBe(true);
  });

  it('Layer is a long column round-tripping through GetLayer/SetLayer, and mirrors on a back layer', () => {
    const fp = mkFootprint();
    const field = new PCB_FIELD(fp, FIELD_T.USER, 'X');
    const table = new PCB_FIELDS_GRID_TABLE(units, [field]);

    expect(table.CanGetValueAs(0, PFC_LAYER, 'number')).toBe(true);

    table.SetValueAsLong(0, PFC_LAYER, PCB_LAYER_ID.B_SilkS);
    expect(table.GetValueAsLong(0, PFC_LAYER)).toBe(PCB_LAYER_ID.B_SilkS);
    expect(field.IsMirrored()).toBe(true);
  });

  it('X/Y Offset are footprint-relative, not the field absolute position', () => {
    const fp = mkFootprint(); // at (10mm, 20mm)
    const field = new PCB_FIELD(fp, FIELD_T.USER, 'X');
    field.SetPosition({ x: MM(11), y: MM(22) }); // 1mm right, 2mm down of the footprint
    const table = new PCB_FIELDS_GRID_TABLE(units, [field]);

    expect(table.GetValue(0, PFC_XOFFSET)).toBe(units.StringFromValue(MM(1), true));
    expect(table.GetValue(0, PFC_YOFFSET)).toBe(units.StringFromValue(MM(2), true));

    table.SetValue(0, PFC_XOFFSET, units.StringFromValue(MM(3), false));
    // Position moved with it (absolute = footprint position + relative).
    expect(field.GetPosition().x).toBe(MM(13));
  });
});
