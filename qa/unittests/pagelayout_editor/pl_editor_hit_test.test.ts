// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How close a click has to be, and what arming a tool does to the selection,
 * driven through `PL_SELECTION_TOOL` and `PL_DRAWING_TOOLS` on the frame.
 *
 *   `#define HITTEST_THRESHOLD_PIXELS 3` (pl_selection_tool.cpp:43), turned
 *   into world units by `SelectPoint` with `getView()->ToWorld( … )` (:141).
 *   `PL_DRAWING_TOOLS::PlaceItem` and `::DrawShape` both open with
 *   `RunAction( ACTIONS::selectionClear )` (pl_drawing_tools.cpp:77, :243);
 *   `ZOOM_TOOL::Main` only pushes itself (zoom_tool.cpp:65).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_ITEM_TYPE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_CLICK, TA_MOUSE_DOWN } from '@ziroeda/common/tool/tool_event.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
import { PL_SELECTION_TOOL } from '@ziroeda/pagelayout_editor/tools/pl_selection_tool.js';
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

/** A horizontal line at y = 60 mm (10 mm margin + 50), x 60..160 mm, in IU. */
function withLine(): Harness {
  const h = makeHarness(EDA_UNITS_INT.MM);
  model.ClearList();
  const line = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
  line.SetStart(50, 50, CORNER_ANCHOR.LT_CORNER);
  line.SetEnd(150, 50, CORNER_ANCHOR.LT_CORNER);
  line.m_LineWidth = 0.0001; // a hairline, so the pen adds nothing to the margin
  model.Append(line);
  h.frame.HardRedraw();
  return h;
}

const selected = (h: Harness): number => h.mgr.GetTool(PL_SELECTION_TOOL)!.GetSelection().GetSize();

describe('HITTEST_THRESHOLD_PIXELS', () => {
  it('is 3 px: a click 3 px off the line takes it, 5 px off does not', async () => {
    const h = withLine();
    // One screen pixel in world units at the stub view's scale.
    const px = h.view.ToWorld(1);

    mouse(h.mgr, TA_MOUSE_DOWN, { x: 110000, y: 60000 + Math.round(5 * px) }, h);
    mouse(h.mgr, TA_MOUSE_CLICK, { x: 110000, y: 60000 + Math.round(5 * px) }, h);
    await settle();
    expect(selected(h)).toBe(0);

    mouse(h.mgr, TA_MOUSE_DOWN, { x: 110000, y: 60000 + Math.round(3 * px) }, h);
    mouse(h.mgr, TA_MOUSE_CLICK, { x: 110000, y: 60000 + Math.round(3 * px) }, h);
    await settle();
    expect(selected(h)).toBe(1);
  });
});

describe('arming a tool and the selection (pl_drawing_tools.cpp:77, :243)', () => {
  it('clears it for the four placement tools', () => {
    for (const action of [
      PL_ACTIONS.drawLine,
      PL_ACTIONS.drawRectangle,
      PL_ACTIONS.placeText,
      PL_ACTIONS.placeImage,
    ]) {
      const h = withLine();
      h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(model.GetItem(0)!.GetDrawItems()[0]!);

      toolbar(h.mgr, action);

      expect(selected(h), action.GetName()).toBe(0);
    }
  });

  it('leaves it alone for the zoom tool', () => {
    const h = withLine();
    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(model.GetItem(0)!.GetDrawItems()[0]!);

    toolbar(h.mgr, ACTIONS.zoomTool);

    expect(selected(h)).toBe(1);
  });
});
