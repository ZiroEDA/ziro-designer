// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PL_EDIT_TOOL::InteractiveDelete` (pl_edit_tool.cpp:414-484) on common's
 * `PICKER_TOOL` (common/tool/picker_tool.cpp), the right toolbar's eraser:
 *
 *   the REMOVE cursor; the item within `HITTEST_THRESHOLD_PIXELS` 5 (:414) of
 *   the pointer is brightened as the pointer moves; a click deletes it through
 *   ACTIONS::doDelete (one undo entry) and the picker stays armed (the click
 *   handler returns true); Escape ends it and unbrightens.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_ITEM_TYPE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_CLICK, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { wxUpdateUIEvent } from '@ziroeda/common/wx/wx_event.js';
import { type Harness, makeHarness, mouse, settle, toolbar } from './pl_editor_fixture.js';

let model: DS_DATA_MODEL;

beforeEach(() => {
  SetPgm(new PGM_BASE());
  model = new DS_DATA_MODEL();
  DS_DATA_MODEL.SetAltInstance(model);
});

afterEach(() => {
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

/** Two hairlines: y = 60 mm and y = 100 mm on the page, x 60..160 mm. */
function sheet(): Harness {
  const h = makeHarness(EDA_UNITS_INT.MM);
  model.ClearList();
  for (const y of [50, 90]) {
    const l = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
    l.SetStart(50, y, CORNER_ANCHOR.LT_CORNER);
    l.SetEnd(150, y, CORNER_ANCHOR.LT_CORNER);
    l.m_LineWidth = 0.0001;
    model.Append(l);
  }
  h.frame.HardRedraw();
  h.frame.ClearUndoRedoList();
  return h;
}

const ys = (): number[] => model.GetItems().map((i) => i.m_Pos.m_Pos.y);

describe('InteractiveDelete', () => {
  it('arms with the REMOVE cursor and checks the eraser', () => {
    const h = sheet();

    toolbar(h.mgr, ACTIONS.deleteTool);

    expect(KICURSOR[h.canvasCursor.kind!]).toBe('REMOVE');
    const e = new wxUpdateUIEvent(ACTIONS.deleteTool.GetUIId());
    h.frame.ProcessUpdateUI(e);
    expect(e.GetChecked()).toBe(true);
  });

  it('brightens what is within 5 px, and a click deletes it and stays armed', async () => {
    const h = sheet();
    const px = h.view.ToWorld(1);
    toolbar(h.mgr, ACTIONS.deleteTool);

    // 7 px off the first line: nothing is picked.
    mouse(h.mgr, TA_MOUSE_MOTION, { x: 110000, y: 60000 + Math.round(7 * px) }, h);
    expect(model.GetItems().some((i) => i.GetDrawItems()[0]!.IsBrightened())).toBe(false);

    // 4 px off: within the delete tool's 5, where the pointer's own 3 is not.
    const near = { x: 110000, y: 60000 + Math.round(4 * px) };
    mouse(h.mgr, TA_MOUSE_MOTION, near, h);
    expect(model.GetItem(0)!.GetDrawItems()[0]!.IsBrightened()).toBe(true);

    mouse(h.mgr, TA_MOUSE_CLICK, near, h);
    await settle();

    expect(ys()).toEqual([90]);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(h.frame.ToolStackIsEmpty()).toBe(false);

    // …and the next one goes too.
    const second = { x: 110000, y: 100000 };
    mouse(h.mgr, TA_MOUSE_MOTION, second, h);
    mouse(h.mgr, TA_MOUSE_CLICK, second, h);
    await settle();
    expect(ys()).toEqual([]);
  });

  it('Escape ends it and leaves nothing brightened', async () => {
    const h = sheet();
    toolbar(h.mgr, ACTIONS.deleteTool);
    mouse(h.mgr, TA_MOUSE_MOTION, { x: 110000, y: 60000 }, h);

    h.mgr.RunAction(ACTIONS.cancelInteractive);
    await settle();

    expect(h.frame.ToolStackIsEmpty()).toBe(true);
    expect(model.GetItem(0)!.GetDrawItems()[0]!.IsBrightened()).toBe(false);
    expect(ys()).toEqual([50, 90]);
  });
});
