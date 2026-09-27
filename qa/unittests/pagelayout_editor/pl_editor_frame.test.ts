// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PL_EDITOR_FRAME` and its tools, run through a real TOOL_MANAGER on a real
 * VIEW. The canvas's constructor needs WebGL2, which Node has not, so the
 * panel is an object on `PL_DRAW_PANEL_GAL`'s prototype holding what its
 * methods read (a VIEW on a stub GAL, view controls whose cursor the test
 * sets). Every expectation is worked from the C++:
 *
 *   ReturnCoordOriginCorner (pl_editor_frame.cpp:667-706)  a dummy segment's
 *       start at (0, 0) from each corner. A3 is MMsize( 420, 297 ) = 16535 x
 *       11693 mils (page_info.cpp:50); 10 mm margins; 1000 IU per mm.
 *   UpdateStatusBar (:726-806)  measured off a running pl_editor on an A3,
 *       corner_origin = 1 profile: `X 410  Y 287` and `dx -0  dy -0` before
 *       the pointer has moved (qa/probes/pl_e2e, pl_editor_frame.ts).
 *   PL_DRAWING_TOOLS::DrawShape (pl_drawing_tools.cpp:222-367)  click, move,
 *       click: SaveCopyInUndoList once, the start where the first click was
 *       and the end where the second was; the item is anchored RB_CORNER
 *       (DS_DATA_ITEM's POINT_COORD default).
 *   PL_DRAWING_TOOLS::PlaceItem (:77-219)  text is one click.
 *   PL_EDIT_TOOL::DoDelete / Undo (pl_edit_tool.cpp:385-418, :530-541)
 *   PL_EDIT_TOOL::Copy (:558-584)  DS_DATA_MODEL_IO::Format( model, items ):
 *       no (setup …) (ds_data_model_io.cpp:170-181).
 *   PL_EDITOR_CONTROL::UpdateMessagePanel (pl_editor_control.cpp:141-173)
 *       one selected item: DS_DRAW_ITEM_BASE::GetMsgPanelInfo's rows
 *       (ds_draw_item.cpp:107-168); none: the page's width and height.
 *   UpdateTitleAndInfo (:588-603)  '*' when modified, "[no drawing sheet
 *       loaded]" with no file, then " — Drawing Sheet Editor".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_DATA_ITEM_TEXT,
  DS_ITEM_TYPE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { LAYER_DRAWINGSHEET_PAGE1, LAYER_DRAWINGSHEET_PAGEn } from '@ziroeda/common/layer_id.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_CLICK, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
import { PL_SELECTION_TOOL } from '@ziroeda/pagelayout_editor/tools/pl_selection_tool.js';
import { type Harness, makeHarness, mouse, toolbar } from './pl_editor_fixture.js';

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

describe('PL_EDITOR_FRAME at start-up', () => {
  it('opens the default sheet, in edit mode, on the settings page (A3), unmodified', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);

    expect(model.m_EditMode).toBe(true);
    expect(model.GetCount()).toBe(countDefault());
    expect(h.frame.GetPageSettings().GetTypeAsString()).toBe('A3');
    // GetSizeIU: KiROUND( mils * IU_PER_MILS ), 25.4 IU per mil.
    expect(h.frame.GetPageSizeIU()).toEqual({ x: 419989, y: 297002 });
    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.IsContentModified()).toBe(false);
    expect(h.frame.GetTitle()).toBe('[no drawing sheet loaded] — Drawing Sheet Editor');
    // Nothing is loaded: no file name, an empty message pane, and an empty
    // message panel until a selection change (UpdateMsgPanelInfo's only two
    // callers are selection handlers, pl_editor_control.cpp:171).
    expect(h.frame.GetCurrentFileName()).toBe('');
    expect(h.status[0] ?? '').toBe('');
    expect(h.msgPanel).toEqual([]);
  });

  it('opens landscape, with the custom size at 17000 x 11000 mils (pl_editor_settings.cpp:52-58)', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);

    expect(h.frame.GetPageSettings().IsPortrait()).toBe(false);
    expect(PAGE_INFO.GetCustomWidthMils()).toBe(17000);
    expect(PAGE_INFO.GetCustomHeightMils()).toBe(11000);
    // A3 is 420 mm: the border band's 50 mm marks run to 8 (A4's 297 to 5).
    expect(Math.floor(h.frame.GetPageSettings().GetWidthMM() / 50)).toBe(8);
  });

  it('last_was_portrait swaps the page (LoadSettings, pl_editor_frame.cpp:543-548)', () => {
    const h = makeHarness(EDA_UNITS_INT.MM, 0, (cfg) => {
      cfg.m_LastWasPortrait = true;
    });

    expect(h.frame.GetPageSettings().IsPortrait()).toBe(true);
    expect(h.frame.GetPageSizeIU()).toEqual({ x: 297002, y: 419989 });
  });

  it('the page box shows page 1 items or later-page items, never both', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);

    h.frame.GetPageSelectBox().SetSelection(0);
    h.frame.OnSelectPage();

    expect(h.frame.GetPageNumberOption()).toBe(true);
    expect(h.view.IsLayerVisible(LAYER_DRAWINGSHEET_PAGE1)).toBe(true);
    expect(h.view.IsLayerVisible(LAYER_DRAWINGSHEET_PAGEn)).toBe(false);

    h.frame.GetPageSelectBox().SetSelection(1);
    h.frame.OnSelectPage();

    expect(h.frame.GetPageNumberOption()).toBe(false);
    expect(h.view.IsLayerVisible(LAYER_DRAWINGSHEET_PAGE1)).toBe(false);
    expect(h.view.IsLayerVisible(LAYER_DRAWINGSHEET_PAGEn)).toBe(true);
  });
});

/** The default sheet's item count, as a fresh model loads it. */
function countDefault(): number {
  const m = new DS_DATA_MODEL();
  m.SetDefaultLayout();
  return m.GetCount();
}

describe('ReturnCoordOriginCorner', () => {
  it('puts the origin on the chosen corner of the A3 page', () => {
    // RB = 16535 * 0.0254 - 10 = 409.989 mm, 11693 * 0.0254 - 10 = 287.0022 mm
    const expected: [number, VECTOR2I][] = [
      [0, { x: 0, y: 0 }],
      [1, { x: 409989, y: 287002 }],
      [2, { x: 10000, y: 287002 }],
      [3, { x: 409989, y: 10000 }],
      [4, { x: 10000, y: 10000 }],
    ];

    for (const [choice, at] of expected) {
      const h = makeHarness(EDA_UNITS_INT.MM, choice);
      expect(h.frame.ReturnCoordOriginCorner()).toEqual(at);
      // SetGridOrigin( originCoord ) at start-up puts the grid on it too.
      expect(h.frame.GetGridOrigin()).toEqual(at);
    }
  });
});

describe('UpdateStatusBar', () => {
  it('reads the measured A3, Right Bottom corner bar before the pointer moves', () => {
    const h = makeHarness(EDA_UNITS_INT.MM, 1);

    h.frame.UpdateStatusBar();

    expect(h.status[2]).toBe('X 410  Y 287');
    expect(h.status[3]).toBe('dx -0  dy -0');
    expect(h.status[5]).toBe('coord origin: Right Bottom page corner');
    expect(h.status[6]).toBe('mm');
  });

  it('formats both coordinate pairs with %.4g: a cold-open mils bar reads 1.266e+04', () => {
    // pl_editor_frame.cpp:770-771; %g goes exponential once the exponent
    // reaches the precision. 12660 mils = 321564 IU, 12170 mils = 309118 IU.
    const h = makeHarness(EDA_UNITS_INT.MILS);
    h.cursor.at = { x: 321564, y: 309118 };

    h.frame.UpdateStatusBar();

    expect(h.status[2]).toBe('X 1.266e+04  Y 1.217e+04');
    expect(h.status[3]).toBe('dx 1.266e+04  dy 1.217e+04');
  });

  it('writes the grid "%f" in mils, "%.3f" in inches (DisplayGridMsg, :701-722)', () => {
    const mils = makeHarness(EDA_UNITS_INT.MILS);
    mils.frame.DisplayGridMsg();
    // 0.5 mm = 19.685039... mils, and the MILS case is the switch's bare "%f".
    expect(mils.status[4]).toBe('grid 19.685039');

    const inch = makeHarness(EDA_UNITS_INT.INCH);
    inch.frame.DisplayGridMsg();
    expect(inch.status[4]).toBe('grid 0.020');
  });

  it('writes the grid at %.4f in mm', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.frame.GetCanvas()!.GetGAL().SetGridSize({ x: 500, y: 500 });

    h.frame.DisplayGridMsg();

    expect(h.status[4]).toBe('grid 0.5000');
  });
});

describe('PL_DRAWING_TOOLS', () => {
  it('draws a line with two clicks, anchored on the right-bottom corner', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const before = model.GetCount();

    toolbar(h.mgr, PL_ACTIONS.drawLine);
    mouse(h.mgr, TA_MOUSE_CLICK, { x: 100000, y: 50000 }, h);
    mouse(h.mgr, TA_MOUSE_MOTION, { x: 150000, y: 50000 }, h);
    mouse(h.mgr, TA_MOUSE_CLICK, { x: 150000, y: 50000 }, h);

    expect(model.GetCount()).toBe(before + 1);
    const line = model.GetItem(before)!;
    expect(line.GetType()).toBe(DS_ITEM_TYPE.DS_SEGMENT);
    expect(line.m_Pos.m_Anchor).toBe(CORNER_ANCHOR.RB_CORNER);
    expect(line.GetStartPosIU()).toEqual({ x: 100000, y: 50000 });
    expect(line.GetEndPosIU()).toEqual({ x: 150000, y: 50000 });

    // One undo step for the whole shape, and the frame knows it was modified.
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(h.frame.IsContentModified()).toBe(true);
    expect(h.frame.GetTitle().startsWith('*')).toBe(true);

    // Undo brings the sheet back and leaves a redo.
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    h.mgr.RunAction(ACTIONS.undo);
    expect(model.GetCount()).toBe(before);
    expect(h.frame.GetRedoCommandCount()).toBe(1);

    h.mgr.RunAction(ACTIONS.redo);
    expect(model.GetCount()).toBe(before + 1);
  });

  it('places a text with one click', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const before = model.GetCount();

    toolbar(h.mgr, PL_ACTIONS.placeText);
    mouse(h.mgr, TA_MOUSE_CLICK, { x: 60000, y: 40000 }, h);

    expect(model.GetCount()).toBe(before + 1);
    const text = model.GetItem(before) as DS_DATA_ITEM_TEXT;
    expect(text.GetType()).toBe(DS_ITEM_TYPE.DS_TEXT);
    expect(text.m_TextBase).toBe('Text');
    expect(text.GetStartPosIU()).toEqual({ x: 60000, y: 40000 });
  });
});

describe('PL_EDIT_TOOL and PL_EDITOR_CONTROL', () => {
  function withOneLine(): { h: Harness; line: DS_DATA_ITEM } {
    const h = makeHarness(EDA_UNITS_INT.MM);
    model.ClearList();
    const line = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
    line.SetStart(50, 50, CORNER_ANCHOR.LT_CORNER);
    line.SetEnd(150, 50, CORNER_ANCHOR.LT_CORNER);
    model.Append(line);
    h.frame.HardRedraw();
    return { h, line };
  }

  it('selecting an item puts its rows in the message panel', () => {
    const { h, line } = withOneLine();
    const sel = h.mgr.GetTool(PL_SELECTION_TOOL)!;

    sel.AddItemToSel(line.GetDrawItems()[0]!);

    const rows = h.frame.GetMsgPanelItems().map((r) => [r.GetUpperText(), r.GetLowerText()]);
    expect(rows).toEqual([
      ['Line', ''],
      ['First Page Option', 'All Pages'],
      ['Repeat Count', '1'],
      ['Repeat Label Increment', '1'],
      ['Repeat Position Increment', '(0.0000 mm, 0.0000 mm)'],
      ['Comment', ''],
    ]);

    // With nothing selected the panel shows the page and nothing else
    // (pl_editor_frame.cpp:968-977): 419989 x 297002 IU, MessageTextFromValue
    // with its default unit label (units_provider.h:127), "%.4f" in mm because
    // drawSheetIUScale is not SCH_IU_PER_MM (eda_units.cpp:422-424).
    sel.ClearSelection();
    const page = h.frame.GetMsgPanelItems().map((r) => [r.GetUpperText(), r.GetLowerText()]);
    expect(page).toEqual([
      ['Page Width', '419.9890 mm'],
      ['Page Height', '297.0020 mm'],
    ]);
  });

  it('Delete removes the selected item and stacks an undo', () => {
    const { h, line } = withOneLine();
    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(line.GetDrawItems()[0]!);

    h.mgr.RunAction(ACTIONS.doDelete);

    expect(model.GetCount()).toBe(0);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('Copy writes the selected items with no (setup)', () => {
    const { h, line } = withOneLine();
    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(line.GetDrawItems()[0]!);

    h.mgr.RunAction(ACTIONS.copy);

    expect(h.host.clipboard).toContain('(line');
    expect(h.host.clipboard).not.toContain('(setup');
  });

  it('the display mode switch turns variable substitution on and off', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);

    h.mgr.RunAction(PL_ACTIONS.layoutNormalMode);
    expect(model.m_EditMode).toBe(false);

    h.mgr.RunAction(PL_ACTIONS.layoutEditMode);
    expect(model.m_EditMode).toBe(true);
  });
});

describe('the canvas numbering never follows the page selector', () => {
  /**
   * `PL_DRAW_PANEL_GAL::DisplayDrawingSheet` resolves text through a dummy
   * DS_DRAW_ITEM_LIST (pl_draw_panel_gal.cpp:91-97) that is never given a page
   * number or a sheet count, so it reads its defaults, "1" of 1
   * (ds_draw_item.h). The driven pl_editor shows `Id: 1/1` on "Other pages"
   * too; the selector only swaps the PAGE1 / PAGEn layers.
   */
  it('reads 1/1 on "Page 1" and on "Other pages"', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    model.ClearList();
    const id = new DS_DATA_ITEM_TEXT('Id: ${#}/${##}');
    model.Append(id);
    h.mgr.RunAction(PL_ACTIONS.layoutNormalMode);

    expect(id.m_FullText).toBe('Id: 1/1');

    h.frame.GetPageSelectBox().SetSelection(1);
    h.frame.OnSelectPage();
    h.frame.HardRedraw();

    expect(id.m_FullText).toBe('Id: 1/1');
  });
});

describe('zoom', () => {
  it('steps through pl_editor’s ZOOM_LIST (zoom_defines.h:38, app_settings.cpp:580)', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const gal = h.frame.GetCanvas()!.GetGAL();

    gal.SetZoomFactor(1.0);
    h.mgr.RunAction(ACTIONS.zoomInCenter);
    // x1.3 = 1.3, then the first preset at or past it: 2.2.
    expect(gal.GetZoomFactor()).toBe(2.2);

    gal.SetZoomFactor(1.0);
    h.mgr.RunAction(ACTIONS.zoomOutCenter);
    // 1/1.3 = 0.769, the last preset at or below it: 0.6.
    expect(gal.GetZoomFactor()).toBe(0.6);
  });
});
