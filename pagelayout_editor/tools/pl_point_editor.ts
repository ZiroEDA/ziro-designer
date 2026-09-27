// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/tools/pl_point_editor.h` + `pl_point_editor.cpp`:
 * `PL_POINT_EDITOR`, the handles on a selected line's two ends and a selected
 * rectangle's four corners, dragged to reshape it.
 *
 * `m_angleItem` (`KIGFX::PREVIEW::ANGLE_ITEM`, the angle readout drawn while
 * a line end is dragged) is not in common/preview_items yet; the handles and
 * the edit itself are whole without it.
 */
import type { DS_DATA_ITEM } from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import type {
  DS_DRAW_ITEM_BASE,
  DS_DRAW_ITEM_LINE,
  DS_DRAW_ITEM_RECT,
} from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { drawSheetIUScale } from '@ziroeda/common/eda_units.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { type EDIT_POINT, EDIT_POINTS } from '@ziroeda/common/tool/edit_points.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { BUT_LEFT, EVENTS, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { PL_EDITOR_FRAME } from '../pl_editor_frame.js';
import { PL_SELECTION_TOOL } from './pl_selection_tool.js';

// Few constants to avoid using bare numbers for point indices
export enum RECTANGLE_POINTS {
  RECT_TOPLEFT,
  RECT_TOPRIGHT,
  RECT_BOTLEFT,
  RECT_BOTRIGHT,
}

export enum LINE_POINTS {
  LINE_START,
  LINE_END,
}

const { RECT_TOPLEFT, RECT_TOPRIGHT, RECT_BOTLEFT, RECT_BOTRIGHT } = RECTANGLE_POINTS;
const { LINE_START, LINE_END } = LINE_POINTS;

const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });

export class EDIT_POINTS_FACTORY {
  static Make(aItem: EDA_ITEM | null): EDIT_POINTS | null {
    const points = new EDIT_POINTS(aItem);

    if (!aItem) return points;

    // Generate list of edit points based on the item type
    switch (aItem.Type()) {
      case KICAD_T.WSG_LINE_T: {
        const line = aItem as unknown as DS_DRAW_ITEM_LINE;
        points.AddPoint(line.GetStart());
        points.AddPoint(line.GetEnd());
        break;
      }

      case KICAD_T.WSG_RECT_T: {
        const rect = aItem as unknown as DS_DRAW_ITEM_RECT;
        const topLeft = { ...rect.GetStart() };
        const botRight = { ...rect.GetEnd() };

        if (topLeft.y > botRight.y) [topLeft.y, botRight.y] = [botRight.y, topLeft.y];

        if (topLeft.x > botRight.x) [topLeft.x, botRight.x] = [botRight.x, topLeft.x];

        points.AddPoint(topLeft);
        points.AddPoint({ x: botRight.x, y: topLeft.y });
        points.AddPoint({ x: topLeft.x, y: botRight.y });
        points.AddPoint(botRight);
        break;
      }

      default:
        return null;
    }

    return points;
  }
}

/**
 * Pin the edited corner within the opposite one, at least `aMin*` away, and
 * push its two edges onto the adjacent corners (pl_point_editor.cpp:287-335).
 */
export function pinEditedCorner(
  editedPointIndex: number,
  minWidth: number,
  minHeight: number,
  c: { topLeft: VECTOR2I; topRight: VECTOR2I; botLeft: VECTOR2I; botRight: VECTOR2I },
): void {
  const { topLeft, topRight, botLeft, botRight } = c;

  switch (editedPointIndex) {
    case RECT_TOPLEFT:
      // pin edited point within opposite corner
      c.topLeft = {
        x: Math.min(topLeft.x, botRight.x - minWidth),
        y: Math.min(topLeft.y, botRight.y - minHeight),
      };

      // push edited point edges to adjacent corners
      c.topRight = { x: topRight.x, y: c.topLeft.y };
      c.botLeft = { x: c.topLeft.x, y: botLeft.y };
      break;

    case RECT_TOPRIGHT:
      // pin edited point within opposite corner
      c.topRight = {
        x: Math.max(topRight.x, botLeft.x + minWidth),
        y: Math.min(topRight.y, botLeft.y - minHeight),
      };

      // push edited point edges to adjacent corners
      c.topLeft = { x: topLeft.x, y: c.topRight.y };
      c.botRight = { x: c.topRight.x, y: botRight.y };
      break;

    case RECT_BOTLEFT:
      // pin edited point within opposite corner
      c.botLeft = {
        x: Math.min(botLeft.x, topRight.x - minWidth),
        y: Math.max(botLeft.y, topRight.y + minHeight),
      };

      // push edited point edges to adjacent corners
      c.botRight = { x: botRight.x, y: c.botLeft.y };
      c.topLeft = { x: c.botLeft.x, y: topLeft.y };
      break;

    case RECT_BOTRIGHT:
      // pin edited point within opposite corner
      c.botRight = {
        x: Math.max(botRight.x, topLeft.x + minWidth),
        y: Math.max(botRight.y, topLeft.y + minHeight),
      };

      // push edited point edges to adjacent corners
      c.botLeft = { x: botLeft.x, y: c.botRight.y };
      c.topRight = { x: c.botRight.x, y: topRight.y };
      break;
  }
}

/**
 * Tool that displays edit points allowing to modify items by dragging the points.
 */
export class PL_POINT_EDITOR extends TOOL_INTERACTIVE {
  private m_frame: PL_EDITOR_FRAME | null;
  private m_selectionTool: PL_SELECTION_TOOL | null;

  ///< Currently edited point, NULL if there is none.
  private m_editedPoint: EDIT_POINT | null;

  ///< Currently available edit points.
  private m_editPoints: EDIT_POINTS | null = null;

  constructor() {
    super('plEditor.PointEditor');
    this.m_frame = null;
    this.m_selectionTool = null;
    this.m_editedPoint = null;
  }

  private viewControls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  Reset(aReason: RESET_REASON): void {
    if (aReason === RESET_REASON.MODEL_RELOAD) {
      // Init variables used by every drawing tool
      this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
    }

    const view = this.getView();

    if (view && this.m_editPoints) view.Remove(this.m_editPoints);

    this.m_editPoints = null;
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
    this.m_selectionTool = this.m_toolMgr!.GetTool(PL_SELECTION_TOOL);
    return true;
  }

  /**
   * Indicate the cursor is over an edit point.  Used to coordinate cursor shapes with
   * other tools.
   */
  HasPoint(): boolean {
    return this.m_editedPoint !== null;
  }

  /** The currently available edit points (the handles on screen), or null. */
  GetEditPoints(): EDIT_POINTS | null {
    return this.m_editPoints;
  }

  private updateEditedPoint(aEvent: TOOL_EVENT): void {
    let point = this.m_editedPoint;
    const view = this.getView()!;

    if (aEvent.IsMotion()) point = this.m_editPoints!.FindPoint(aEvent.Position(), view);
    else if (aEvent.IsDrag(BUT_LEFT))
      point = this.m_editPoints!.FindPoint(aEvent.DragOrigin(), view);
    else point = this.m_editPoints!.FindPoint(this.viewControls().GetCursorPosition(), view);

    if (this.m_editedPoint !== point) this.setEditedPoint(point);
  }

  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;
    const controls = this.viewControls();
    const selection = this.m_selectionTool!.GetSelection();

    if (
      selection.GetSize() !== 1 ||
      !(selection.Front() as EDA_ITEM).IsType([KICAD_T.WSG_LINE_T, KICAD_T.WSG_RECT_T])
    )
      return 0;

    const item = selection.Front() as EDA_ITEM;

    // Wait till drawing tool is done
    if (item.IsNew()) return 0;

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);

    this.m_editPoints = EDIT_POINTS_FACTORY.Make(item);

    if (!this.m_editPoints) return 0;

    this.getView()!.Add(this.m_editPoints);
    this.setEditedPoint(null);
    this.updateEditedPoint(aEvent);
    let inDrag = false;
    let modified = false;

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      if (!this.m_editPoints || evt.IsSelectionEvent()) break;

      if (!inDrag) this.updateEditedPoint(evt);

      if (evt.IsDrag(BUT_LEFT) && this.m_editedPoint) {
        if (!inDrag) {
          frame.SaveCopyInUndoList();

          controls.ForceCursorPosition(false);
          inDrag = true;
          modified = true;
        }

        this.m_editedPoint.SetPosition(controls.GetCursorPosition(!evt.DisableGridSnapping()));

        this.updateItem();
        this.updatePoints();
      } else if (inDrag && evt.IsMouseUp(BUT_LEFT)) {
        controls.SetAutoPan(false);
        inDrag = false;
      } else if (evt.IsCancelInteractive() || evt.IsActivate()) {
        if (inDrag) {
          // Restore the last change
          frame.RollbackFromUndo();
          inDrag = false;
          modified = false;
        } else if (evt.IsCancelInteractive()) {
          break;
        }

        if (evt.IsActivate() && !evt.IsMoveTool()) break;
      } else {
        evt.SetPassEvent();
      }

      controls.SetAutoPan(inDrag);
      controls.CaptureCursor(inDrag);
    }

    controls.SetAutoPan(false);
    controls.CaptureCursor(false);

    if (this.m_editPoints) {
      this.getView()!.Remove(this.m_editPoints);

      if (modified) frame.OnModify();

      this.m_editPoints = null;
      frame.GetCanvas()!.Refresh();
    }

    return 0;
  }

  /** Return the index of the edited point, or -1 (`getEditedPointIndex`). */
  private getEditedPointIndex(): number {
    return this.m_editPoints ? this.m_editPoints.IndexOf(this.m_editedPoint) : -1;
  }

  ///< Update item's points with edit points.
  private updateItem(): void {
    const frame = this.m_frame!;
    const item = this.m_editPoints!.GetParent();

    if (!item) return;

    const dataItem = (item as DS_DRAW_ITEM_BASE).GetPeer() as DS_DATA_ITEM;
    const view = this.getView()!;

    // The current item is perhaps not the main item if we have a set of repeated items.
    // So we change the coordinate references in dataItem using move vectors of the start and
    // end points that are the same for each repeated item.

    switch (item.Type()) {
      case KICAD_T.WSG_LINE_T: {
        const line = item as unknown as DS_DRAW_ITEM_LINE;

        const move_startpoint = sub(
          this.m_editPoints!.Point(LINE_START).GetPosition(),
          line.GetStart(),
        );
        const move_endpoint = sub(this.m_editPoints!.Point(LINE_END).GetPosition(), line.GetEnd());

        dataItem.MoveStartPointToIU(add(dataItem.GetStartPosIU(), move_startpoint));
        dataItem.MoveEndPointToIU(add(dataItem.GetEndPosIU(), move_endpoint));

        for (const draw_item of dataItem.GetDrawItems()) {
          const draw_line = draw_item as unknown as DS_DRAW_ITEM_LINE;

          draw_line.SetStart(add(draw_line.GetStart(), move_startpoint));
          draw_line.SetEnd(add(draw_line.GetEnd(), move_endpoint));
          view.Update(draw_item);
        }

        break;
      }

      case KICAD_T.WSG_RECT_T: {
        const rect = item as unknown as DS_DRAW_ITEM_RECT;
        const c = {
          topLeft: this.m_editPoints!.Point(RECT_TOPLEFT).GetPosition(),
          topRight: this.m_editPoints!.Point(RECT_TOPRIGHT).GetPosition(),
          botLeft: this.m_editPoints!.Point(RECT_BOTLEFT).GetPosition(),
          botRight: this.m_editPoints!.Point(RECT_BOTRIGHT).GetPosition(),
        };

        pinEditedCorner(
          this.getEditedPointIndex(),
          drawSheetIUScale.milsToIU(1),
          drawSheetIUScale.milsToIU(1),
          c,
        );

        const { topLeft, botRight } = c;
        const start_delta = { x: 0, y: 0 };
        const end_delta = { x: 0, y: 0 };

        if (rect.GetStart().y > rect.GetEnd().y) {
          start_delta.y = botRight.y - rect.GetStart().y;
          end_delta.y = topLeft.y - rect.GetEnd().y;
        } else {
          start_delta.y = topLeft.y - rect.GetStart().y;
          end_delta.y = botRight.y - rect.GetEnd().y;
        }

        if (rect.GetStart().x > rect.GetEnd().x) {
          start_delta.x = botRight.x - rect.GetStart().x;
          end_delta.x = topLeft.x - rect.GetEnd().x;
        } else {
          start_delta.x = topLeft.x - rect.GetStart().x;
          end_delta.x = botRight.x - rect.GetEnd().x;
        }

        dataItem.MoveStartPointToIU(add(dataItem.GetStartPosIU(), start_delta));
        dataItem.MoveEndPointToIU(add(dataItem.GetEndPosIU(), end_delta));

        for (const draw_item of dataItem.GetDrawItems()) {
          const draw_rect = draw_item as unknown as DS_DRAW_ITEM_RECT;

          draw_rect.SetStart(add(draw_rect.GetStart(), start_delta));
          draw_rect.SetEnd(add(draw_rect.GetEnd(), end_delta));
          view.Update(draw_item);
        }

        break;
      }

      default:
        break;
    }

    frame.SetMsgPanel(item);

    // The Properties frame will be updated. Avoid flicker during update: Freeze / Thaw, n/a.
    frame.GetPropertiesFrame()?.CopyPrmsFromItemToPanel(dataItem);
  }

  ///< Update edit points with item's points.
  private updatePoints(): void {
    if (!this.m_editPoints) return;

    const item = this.m_editPoints.GetParent();

    if (!item) return;

    switch (item.Type()) {
      case KICAD_T.WSG_LINE_T: {
        const line = item as unknown as DS_DRAW_ITEM_LINE;

        this.m_editPoints.Point(LINE_START).SetPosition(line.GetStart());
        this.m_editPoints.Point(LINE_END).SetPosition(line.GetEnd());
        break;
      }

      case KICAD_T.WSG_RECT_T: {
        const rect = item as unknown as DS_DRAW_ITEM_RECT;
        const topLeft = { ...rect.GetPosition() };
        const botRight = { ...rect.GetEnd() };

        if (topLeft.y > botRight.y) [topLeft.y, botRight.y] = [botRight.y, topLeft.y];

        if (topLeft.x > botRight.x) [topLeft.x, botRight.x] = [botRight.x, topLeft.x];

        this.m_editPoints.Point(RECT_TOPLEFT).SetPosition(topLeft);
        this.m_editPoints.Point(RECT_TOPRIGHT).SetPosition({ x: botRight.x, y: topLeft.y });
        this.m_editPoints.Point(RECT_BOTLEFT).SetPosition({ x: topLeft.x, y: botRight.y });
        this.m_editPoints.Point(RECT_BOTRIGHT).SetPosition(botRight);
        break;
      }

      default:
        break;
    }

    this.getView()!.Update(this.m_editPoints);
  }

  ///< Set the current point being edited. NULL means none.
  private setEditedPoint(aPoint: EDIT_POINT | null): void {
    const controls = this.viewControls();

    if (aPoint) {
      this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
      controls.ForceCursorPosition(true, aPoint.GetPosition());
      controls.ShowCursor(true);
    } else {
      if (this.m_frame!.ToolStackIsEmpty()) controls.ShowCursor(false);

      controls.ForceCursorPosition(false);
    }

    this.m_editedPoint = aPoint;
  }

  private modifiedSelection(_aEvent: TOOL_EVENT): number {
    this.updatePoints();
    return 0;
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(this.Main, EVENTS.SelectedEvent);
    this.Go(this.Main, ACTIONS.activatePointEditor.MakeEvent());
    this.Go(SYNC_HANDLER(this.modifiedSelection), EVENTS.SelectedItemsModified);
  }
}
