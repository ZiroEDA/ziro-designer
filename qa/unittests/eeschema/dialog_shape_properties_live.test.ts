// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_SHAPE_PROPERTIES (dialog_shape_properties.cpp), schematic branch, on a live shape: the
 * border and fill shown, OK as one "Edit <shape>" commit, no border as width -1.
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { DIALOG_SHAPE_PROPERTIES } from '@ziroeda/eeschema/dialogs/dialog_shape_properties.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schFrame, schToolHarness } from './support/sch_tool_harness.js';

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const GREEN = { r: 0, g: 1, b: 0, a: 1 };

function setUp() {
  const h = schToolHarness(schFrame({}));
  const shape = new SCH_SHAPE(SHAPE_T.RECTANGLE);
  shape.SetStart({ x: 0, y: 0 });
  shape.SetEnd({ x: 12700, y: 12700 });
  h.frame.AddToScreen(shape, h.frame.GetScreen());
  return { h, shape, dlg: new DIALOG_SHAPE_PROPERTIES(h.frame, shape) };
}

describe('DIALOG_SHAPE_PROPERTIES', () => {
  it('shows the border and the fill mode as the combo selects them', () => {
    const { shape, dlg } = setUp();
    shape.SetFillModeProp(1);
    const shown = dlg.TransferDataToWindow();
    expect(shown.border).toBe(shape.GetWidth() >= 0);
    expect(shown.fillType).toBe('color');
  });

  it('OK writes border, style, colours and fill as one commit named after the shape', () => {
    const { h, shape, dlg } = setUp();
    const undo = h.frame.GetUndoCommandCount();

    dlg.TransferDataFromWindow({
      border: true,
      borderWidth: 2540,
      borderStyle: 'dash',
      borderColor: GREEN,
      fillType: 'hatch',
      fillColor: GREEN,
    });

    expect(shape.GetWidth()).toBe(2540);
    expect(shape.GetStroke().GetLineStyle()).toBe(LINE_STYLE.DASH);
    expect(shape.GetStroke().GetColor()).toEqual(GREEN);
    expect(shape.GetFillModeProp()).toBe(2);
    expect(shape.GetFillColor()).toEqual(GREEN);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('no border stores width -1; the Default style row is SOLID', () => {
    const { shape, dlg } = setUp();
    dlg.TransferDataFromWindow({
      border: false,
      borderWidth: 2540,
      borderStyle: 'default',
      borderColor: GREEN,
      fillType: 'none',
      fillColor: GREEN,
    });
    expect(shape.GetWidth()).toBe(-1);
    expect(shape.GetStroke().GetLineStyle()).toBe(LINE_STYLE.SOLID);
  });
});
