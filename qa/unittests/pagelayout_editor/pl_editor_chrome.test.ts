// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the Drawing Sheet Editor's canvas shows beyond the sheet: the pointer
 * each tool asks for, the units, and the coordinate-origin marker - driven
 * through the frame's tools, each read off the C++:
 *
 *   PL_DRAWING_TOOLS::PlaceItem's setCursor (pl_drawing_tools.cpp:88-99):
 *       TEXT for text, ARROW for an image, PENCIL otherwise, PLACE while an
 *       item is carried; DrawShape (:251) is PENCIL; both hand back ARROW.
 *   ZOOM_TOOL::Main (zoom_tool.cpp): ZOOM_IN.
 *   COMMON_TOOLS::ToggleUnits (common_tools.cpp:671-677): imperial <-> metric,
 *       returning to the last unit of the other family.
 *   OnSelectCoordOriginCorner (pl_editor_frame.cpp:470-476) ->
 *       DisplayDrawingSheet's SetMarkerPos( ReturnCoordOriginCorner() )
 *       (pl_draw_panel_gal.cpp:115-117).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { MD_CTRL, MD_SHIFT, TA_MOUSE_CLICK } from '@ziroeda/common/tool/tool_event.js';
import { wxUpdateUIEvent } from '@ziroeda/common/wx/wx_event.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
import { makeHarness, mouse, toolbar } from './pl_editor_fixture.js';

beforeEach(() => {
  SetPgm(new PGM_BASE());
  DS_DATA_MODEL.SetAltInstance(new DS_DATA_MODEL());
});

afterEach(() => {
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

describe('the pointer each tool asks for', () => {
  it.each([
    ['Draw Text', PL_ACTIONS.placeText, KICURSOR.TEXT],
    ['Place Bitmaps', PL_ACTIONS.placeImage, KICURSOR.ARROW],
    ['Draw Lines', PL_ACTIONS.drawLine, KICURSOR.PENCIL],
    ['Draw Rectangles', PL_ACTIONS.drawRectangle, KICURSOR.PENCIL],
    ['Zoom to Selection Area', ACTIONS.zoomTool, KICURSOR.ZOOM_IN],
  ])('%s', (_name, action, cursor) => {
    const h = makeHarness(EDA_UNITS_INT.MM);

    toolbar(h.mgr, action);

    expect(KICURSOR[h.canvasCursor.kind ?? -1]).toBe(KICURSOR[cursor]);
  });

  it('a shape in flight still draws with the pencil; Escape gives back the arrow', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);

    toolbar(h.mgr, PL_ACTIONS.drawLine);
    mouse(h.mgr, TA_MOUSE_CLICK, { x: 100000, y: 100000 }, h);
    expect(KICURSOR[h.canvasCursor.kind!]).toBe('PENCIL');

    h.mgr.RunAction(ACTIONS.cancelInteractive);
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(KICURSOR[h.canvasCursor.kind!]).toBe('ARROW');
  });
});

describe('units', () => {
  it('Ctrl+U swaps mils for mm and comes back to mils, not inches', () => {
    const h = makeHarness(EDA_UNITS_INT.MILS);

    h.mgr.RunAction(ACTIONS.toggleUnits);
    expect(h.frame.GetUserUnits()).toBe('mm');

    h.mgr.RunAction(ACTIONS.toggleUnits);
    expect(h.frame.GetUserUnits()).toBe('mils');
  });

  it('Ctrl+U reaches toggleUnits through the frame’s hotkeys; Shift+Ctrl+U does not', () => {
    // ACTIONS::toggleUnits .DefaultHotkey( MD_CTRL + 'U' ) (actions.cpp:1149-1156).
    const h = makeHarness(EDA_UNITS_INT.MILS);
    const am = h.mgr.GetActionManager();

    am.RunHotKey(MD_SHIFT + MD_CTRL + 'U'.charCodeAt(0));
    expect(h.frame.GetUserUnits()).toBe('mils');

    expect(am.RunHotKey(MD_CTRL + 'U'.charCodeAt(0))).toBe(true);
    expect(h.frame.GetUserUnits()).toBe('mm');
  });

  it('the units buttons set the frame and the status bar pane 6', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);

    h.mgr.RunAction(ACTIONS.inchesUnits);
    h.frame.UpdateStatusBar();

    expect(h.frame.GetUserUnits()).toBe('in');
    expect(h.status[6]).toBe('inches');
  });
});

describe('the coordinate-origin marker follows the dropdown', () => {
  it('sits on the chosen corner after OnSelectCoordOriginCorner', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const marker = (): unknown => h.frame.GetCanvas()!.GetPageDrawItem()!.GetMarkerPos();

    expect(marker()).toEqual({ x: 0, y: 0 });

    h.frame.GetOriginSelectBox().SetSelection(1);
    h.frame.OnSelectCoordOriginCorner();

    // Right Bottom page corner of A3 with 10 mm margins (pl_editor_frame.test.ts).
    expect(marker()).toEqual({ x: 409989, y: 287002 });
    expect(h.status[5]).toBe('coord origin: Right Bottom page corner');
  });
});

describe('the grid', () => {
  it('opens on 0.50 mm whatever the unit (grid.last_size = 4, app_settings.cpp:466-481)', () => {
    for (const units of [EDA_UNITS_INT.MILS, EDA_UNITS_INT.MM, EDA_UNITS_INT.INCH]) {
      const h = makeHarness(units);
      // 0.5 mm in drawSheetIUScale (1000 IU per mm).
      expect(h.frame.GetCanvas()!.GetGAL().GetGridSize()).toEqual({ x: 500, y: 500 });
    }
  });
});

describe('zoomTool is an armed rubber-band tool (ACTIONS::zoomTool, AF_ACTIVATE)', () => {
  it('the button arms it and checks it; Escape ends it', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const checked = (): boolean => {
      const e = new wxUpdateUIEvent(ACTIONS.zoomTool.GetUIId());
      h.frame.ProcessUpdateUI(e);
      return e.GetChecked();
    };

    toolbar(h.mgr, ACTIONS.zoomTool);
    expect(checked()).toBe(true);
    expect(h.frame.ToolStackIsEmpty()).toBe(false);

    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(checked()).toBe(false);
  });
});
