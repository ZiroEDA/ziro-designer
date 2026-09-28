// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PL_POINT_EDITOR` (pagelayout_editor/tools/pl_point_editor.cpp) on common's
 * `EDIT_POINTS` (common/tool/edit_points.cpp), driven through the frame:
 *
 *   EDIT_POINTS_FACTORY::Make (:59-106)  a line's two ends; a rectangle's four
 *       corners, normalised so point 0 is the top left.
 *   Main (:166-270)  a drag on a handle takes ONE undo copy at its start,
 *       moves the point, and Escape mid-drag rolls it back (RollbackFromUndo).
 *   pinEditedCorner (:273-335)  a corner cannot cross its opposite: it stops
 *       1 mil short (MilsToIU( 1 ) = 25 IU, drawSheetIUScale).
 *   EDIT_POINTS::FindPoint (edit_points.cpp:58-78)  within ToWorld( 8 ).
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
import {
  AS_GLOBAL,
  BUT_LEFT,
  TA_MOUSE_DOWN,
  TA_MOUSE_DRAG,
  TA_MOUSE_MOTION,
  TA_MOUSE_UP,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { PL_POINT_EDITOR } from '@ziroeda/pagelayout_editor/tools/pl_point_editor.js';
import { PL_SELECTION_TOOL } from '@ziroeda/pagelayout_editor/tools/pl_selection_tool.js';
import { type Harness, makeHarness, mouse } from './pl_editor_fixture.js';

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

/** One item, selected (not quietly, so SelectedEvent starts the point editor). */
function withItem(
  aType: DS_ITEM_TYPE,
  aStart: [number, number],
  aEnd: [number, number],
): {
  h: Harness;
  item: DS_DATA_ITEM;
} {
  const h = makeHarness(EDA_UNITS_INT.MM);
  model.ClearList();
  const item = new DS_DATA_ITEM(aType);
  item.SetStart(aStart[0], aStart[1], CORNER_ANCHOR.LT_CORNER);
  item.SetEnd(aEnd[0], aEnd[1], CORNER_ANCHOR.LT_CORNER);
  model.Append(item);
  h.frame.HardRedraw();
  h.frame.ClearUndoRedoList();
  h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(item.GetDrawItems()[0]!);
  return { h, item };
}

const handles = (h: Harness): VECTOR2I[] => {
  const pts = h.mgr.GetTool(PL_POINT_EDITOR)!.GetEditPoints();
  return pts ? Array.from({ length: pts.PointsSize() }, (_, i) => pts.Point(i).GetPosition()) : [];
};

/** A left-button drag from `aFrom` to `aTo`, as WX_VIEW_CONTROLS reports one. */
function drag(h: Harness, aFrom: VECTOR2I, aTo: VECTOR2I, aRelease = true): void {
  mouse(h.mgr, TA_MOUSE_MOTION, aFrom, h);
  mouse(h.mgr, TA_MOUSE_DOWN, aFrom, h);

  // TOOL_DISPATCHER's first drag event is where the pointer crossed the drag
  // threshold, next to the origin; the rest follow the pointer.
  for (const at of [aFrom, aTo]) {
    h.cursor.at = at;
    const e = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DRAG, BUT_LEFT, AS_GLOBAL);
    e.SetMousePosition(at);
    e.setMouseDragOrigin(aFrom);
    h.mgr.ProcessEvent(e);
  }

  if (aRelease) mouse(h.mgr, TA_MOUSE_UP, aTo, h);
}

describe('EDIT_POINTS_FACTORY', () => {
  it('puts a handle on each end of a selected line', () => {
    // 10 mm margins, LT_CORNER: (20, 20) mm and (60, 40) mm on the page.
    const { h } = withItem(DS_ITEM_TYPE.DS_SEGMENT, [10, 10], [50, 30]);

    expect(handles(h)).toEqual([
      { x: 20000, y: 20000 },
      { x: 60000, y: 40000 },
    ]);
  });

  it('puts four on a rectangle, top left first whichever way it was drawn', () => {
    const { h } = withItem(DS_ITEM_TYPE.DS_RECT, [50, 30], [10, 10]);

    expect(handles(h)).toEqual([
      { x: 20000, y: 20000 },
      { x: 60000, y: 20000 },
      { x: 20000, y: 40000 },
      { x: 60000, y: 40000 },
    ]);
  });

  it('has none for a text', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    model.ClearList();
    const text = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_TEXT);
    model.Append(text);
    h.frame.HardRedraw();
    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(text.GetDrawItems()[0]!);

    expect(handles(h)).toEqual([]);
  });
});

describe('dragging a handle', () => {
  it('moves that end only, as one undo entry, and marks the sheet modified', () => {
    const { h, item } = withItem(DS_ITEM_TYPE.DS_SEGMENT, [10, 10], [50, 30]);

    drag(h, { x: 20000, y: 20000 }, { x: 25000, y: 30000 });

    expect(item.GetStartPosIU()).toEqual({ x: 25000, y: 30000 });
    expect(item.GetEndPosIU()).toEqual({ x: 60000, y: 40000 });
    expect(h.frame.GetUndoCommandCount()).toBe(1);

    // The tool ends on the next selection change and OnModify()s (:258-266).
    h.mgr.GetTool(PL_SELECTION_TOOL)!.ClearSelection();
    expect(h.frame.IsContentModified()).toBe(true);
  });

  it('Escape mid-drag puts the end back and leaves no undo entry', () => {
    const { h } = withItem(DS_ITEM_TYPE.DS_SEGMENT, [10, 10], [50, 30]);

    drag(h, { x: 20000, y: 20000 }, { x: 25000, y: 30000 }, false);
    h.mgr.RunAction(ACTIONS.cancelInteractive);

    // Restore rebuilds the model from the entry's text: a new item.
    expect(model.GetItem(0)!.GetStartPosIU()).toEqual({ x: 20000, y: 20000 });
    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
  });

  it('grabs the handle within ToWorld( 8 ); 9 px away the drag moves the whole line', () => {
    const { h } = withItem(DS_ITEM_TYPE.DS_SEGMENT, [10, 10], [50, 30]);
    const px = h.view.ToWorld(1);

    // 7 px up and left of the start: inside the handle's square.
    const near = { x: 20000 - Math.round(7 * px), y: 20000 - Math.round(7 * px) };
    drag(h, near, { x: 25000, y: 30000 });
    expect(model.GetItem(0)!.GetStartPosIU()).toEqual({ x: 25000, y: 30000 });
    expect(model.GetItem(0)!.GetEndPosIU()).toEqual({ x: 60000, y: 40000 });
  });

  it('9 px away is past the handle but inside the 20 px grip: the move tool takes it', () => {
    // selectionContains' GRIP_MARGIN (pl_selection_tool.cpp:530): a drag that
    // misses every handle but starts on the item's inflated box moves it.
    const { h } = withItem(DS_ITEM_TYPE.DS_SEGMENT, [10, 10], [50, 30]);
    const px = h.view.ToWorld(1);
    const off = { x: 20000 - Math.round(9 * px), y: 20000 - Math.round(9 * px) };

    drag(h, off, { x: off.x + 5000, y: off.y + 10000 });
    h.mgr.RunAction(ACTIONS.cursorClick);

    expect(model.GetItem(0)!.GetStartPosIU()).toEqual({ x: 25000, y: 30000 });
    expect(model.GetItem(0)!.GetEndPosIU()).toEqual({ x: 65000, y: 50000 });
  });

  it('a rectangle corner stops 1 mil short of its opposite', () => {
    const { h, item } = withItem(DS_ITEM_TYPE.DS_RECT, [10, 10], [50, 30]);

    // Top left dragged well past the bottom right (60, 40) mm.
    drag(h, { x: 20000, y: 20000 }, { x: 90000, y: 90000 });

    // MilsToIU( 1 ) = 25.4 -> 25 IU inside (60000, 40000).
    expect(item.GetStartPosIU()).toEqual({ x: 59975, y: 39975 });
    expect(item.GetEndPosIU()).toEqual({ x: 60000, y: 40000 });
  });
});
