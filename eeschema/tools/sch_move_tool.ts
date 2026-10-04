// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/tools/sch_move_tool.{h,cpp}`: SCH_MOVE_TOOL on the live model - move, drag, break and
 * slice, with orthogonal drag of the wires hanging off a dragged item, labels kept on their wires,
 * drop into a sheet, junction upkeep and Align to Grid.
 *
 * Porting notes (the file is the C++, method for method):
 *  - The handlers wait for events, so Main / doMoveSelection are generators (coroutine.ts).
 *  - `std::map<SCH_LINE*, …>` / `std::set<SCH_LINE*>` are Maps and Sets: only membership and the
 *    insertion of new bend lines matter, never their iteration order across items.
 *  - wxGetKeyState( WXK_CONTROL ) is the DOM's key state (common/wx/wx_event.ts wxGetKeyState).
 */
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  BRIGHTENED,
  ENDPOINT,
  IS_BROKEN,
  IS_CHANGED,
  IS_MOVING,
  IS_NEW,
  IS_PASTED,
  SELECTED,
  SELECTED_BY_DRAG,
  STARTPOINT,
  STRUCT_DELETED,
} from '@ziroeda/common/eda_item_flags.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ACTIONS, CURSOR_EVENT_TYPE, type INCREMENT } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  EVENTS,
  MD_CTRL,
  MD_SHIFT,
  SYNCRONOUS_TOOL_STATE,
  TA_CHOICE_MENU_CHOICE,
  TC_KEYBOARD,
  TC_MOUSE,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { wxGetKeyState } from '@ziroeda/common/wx/wx_event.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { CHANGE_TYPE } from '@ziroeda/common/commit.js';
import { id_eeschema_frm } from '../eeschema_id.js';
import { AnalyzePoint, PreviewJunctions } from '../junction_helpers.js';
import { SCH_COLLECTOR } from '../sch_collectors.js';
import { SCH_COMMIT } from '../sch_commit.js';
import { SCH_CONNECTION } from '../sch_connection.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_GROUP } from '../sch_group.js';
import {
  type DANGLING_END_ITEM,
  DANGLING_END_ITEM_HELPER,
  AUTOPLACE_ALGO,
  SCH_ITEM,
} from '../sch_item.js';
import {
  AlignSchematicItemsToGrid,
  MoveSchematicItem,
  type SCH_ALIGNMENT_CALLBACKS,
} from '../sch_item_alignment.js';
import { SCH_JUNCTION } from '../sch_junction.js';
import { SCH_LABEL_BASE } from '../sch_label.js';
import { SCH_LINE } from '../sch_line.js';
import type { SCH_PIN } from '../sch_pin.js';
import { SCH_SHAPE } from '../sch_shape.js';
import { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PIN } from '../sch_sheet_pin.js';
import { SCH_SHEET_LIST } from '../sch_sheet_path.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import type { SCH_TEXT } from '../sch_text.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { SCH_ACTIONS, LINE_MODE } from './sch_actions.js';
import { SCH_DRAG_NET_COLLISION_MONITOR } from './sch_drag_net_collision.js';
import { SCH_LINE_WIRE_BUS_TOOL } from './sch_line_wire_bus_tool.js';
import { SCH_SELECTION } from './sch_selection.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

// For adding to or removing from selections
const QUIET_MODE = true;

function isGraphicItemForDrop(aItem: SCH_ITEM): boolean {
  switch (aItem.Type()) {
    case KICAD_T.SCH_SHAPE_T:
    case KICAD_T.SCH_BITMAP_T:
    case KICAD_T.SCH_TEXT_T:
    case KICAD_T.SCH_TEXTBOX_T:
      return true;
    case KICAD_T.SCH_LINE_T:
      return (aItem as SCH_LINE).IsGraphicLine();
    default:
      return false;
  }
}

function cloneWireConnection(
  aNewLine: SCH_LINE | null,
  aSource: SCH_ITEM | null,
  aFrame: SCH_EDIT_FRAME | null,
): void {
  if (!aNewLine || !aSource || !aFrame) return;

  const sourceLine = aSource instanceof SCH_LINE ? aSource : null;

  if (!sourceLine) return;

  const sheetPath = aFrame.GetCurrentSheet();
  const sourceConnection = sourceLine.Connection(sheetPath);

  if (!sourceConnection) return;

  const newConnection = aNewLine.InitializeConnection(sheetPath, null);

  if (!newConnection) return;

  newConnection.Clone(sourceConnection);
}

/** `SPECIAL_CASE_LABEL_INFO` (sch_move_tool.h): a label kept on the wire it sits on. */
interface SPECIAL_CASE_LABEL_INFO {
  attachedLine: SCH_LINE | null;
  originalLabelPos: VECTOR2I;
  originalLineStart: VECTOR2I;
  originalLineEnd: VECTOR2I;
  trackMovingEnd: boolean;
}

/** `HIDDEN_JUNCTION` (sch_move_tool.h): a junction hidden while the line end it marks moves. */
interface HIDDEN_JUNCTION {
  m_junction: SCH_JUNCTION;
  m_lineId: KIID;
  m_atLineStart: boolean;
}

export enum MOVE_MODE {
  MOVE,
  DRAG,
  BREAK,
  SLICE,
}

enum AXIS_LOCK {
  NONE,
  HORIZONTAL,
  VERTICAL,
}

const v = (x: number, y: number): VECTOR2I => ({ x, y });
const vadd = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const vsub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
const veq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;
const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);
/** `alg::signbit`: a negative number, -0 included. */
const signbit = (n: number): boolean => n < 0 || Object.is(n, -0);

export class SCH_MOVE_TOOL extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  ///< Re-entrancy guard
  private m_inMoveTool = false;

  ///< Flag determining if anything is being dragged right now
  private m_moveInProgress = false;
  private m_mode: MOVE_MODE = MOVE_MODE.MOVE;

  ///< Items (such as wires) which were added to the selection for a drag
  private m_dragAdditions: KIID[] = [];

  ///< Cache of the line's original connections before dragging started
  private m_lineConnectionCache = new Map<SCH_LINE, EDA_ITEM[]>();

  ///< Lines added at bend points dynamically during the move
  private m_newDragLines = new Set<SCH_LINE>();

  ///< Lines changed by drag algorithm that weren't selected
  private m_changedDragLines = new Set<SCH_LINE>();

  ///< Used for chaining commands
  private m_moveOffset: VECTOR2I = v(0, 0);

  ///< Last cursor position (needed for getModificationPoint() to avoid changes
  ///< of edit reference point).
  private m_cursor: VECTOR2I = v(0, 0);

  private m_anchorPos: VECTOR2I | null = null;
  private m_breakPos: VECTOR2I | null = null;

  // A map of labels to scaling factors.  Used to scale the movement vector for labels that
  // are attached to wires which have only one end moving.
  private m_specialCaseLabels = new Map<SCH_LABEL_BASE, SPECIAL_CASE_LABEL_INFO>();

  // A map of sheet pins to wire ends.  Used to keep wire ends attached to sheet pins
  // that are constrained along the sheet edge.
  private m_specialCaseSheetPins = new Map<SCH_SHEET_PIN, [SCH_LINE, boolean]>();

  private m_hiddenJunctions: HIDDEN_JUNCTION[] = [];

  constructor() {
    super('eeschema.InteractiveMove');
  }

  override Init(): boolean {
    super.Init();

    const moveCondition: SELECTION_CONDITION = (aSel) => {
      if (aSel.Empty() || SELECTION_CONDITIONS.OnlyTypes([KICAD_T.SCH_MARKER_T])(aSel))
        return false;

      if (SCH_LINE_WIRE_BUS_TOOL.IsDrawingLineWireOrBus(aSel)) return false;

      return true;
    };

    // Add move actions to the selection tool menu
    //
    const selToolMenu = this.m_selectionTool!.GetToolMenu().GetMenu();

    selToolMenu.AddItem(SCH_ACTIONS.move, moveCondition, 150);
    selToolMenu.AddItem(SCH_ACTIONS.drag, moveCondition, 150);
    selToolMenu.AddItem(SCH_ACTIONS.alignToGrid, moveCondition, 150);

    return true;
  }

  override Reset(aReason: RESET_REASON): void {
    super.Reset(aReason);

    if (aReason === RESET_REASON.MODEL_RELOAD || aReason === RESET_REASON.SUPERMODEL_RELOAD) {
      // If we were in the middle of a move/drag operation and the model changes (e.g., sheet
      // switch), we need to clean up our state to avoid blocking future move/drag operations
      if (this.m_moveInProgress) {
        // Clear the move state
        this.m_moveInProgress = false;
        this.m_mode = MOVE_MODE.MOVE;
        this.m_moveOffset = v(0, 0);
        this.m_anchorPos = null;
        this.m_breakPos = null;

        // Clear cached data that references items from the previous sheet
        this.m_dragAdditions = [];
        this.m_lineConnectionCache.clear();
        this.m_newDragLines.clear();
        this.m_changedDragLines.clear();
        this.m_specialCaseLabels.clear();
        this.m_specialCaseSheetPins.clear();
        this.m_hiddenJunctions = [];

        // Clear any preview
        this.m_view?.ClearPreview();
      }
    }
  }

  private cache(aLine: SCH_LINE): EDA_ITEM[] {
    let list = this.m_lineConnectionCache.get(aLine);

    if (!list) {
      list = [];
      this.m_lineConnectionCache.set(aLine, list);
    }

    return list;
  }

  private orthoLineDrag(
    aCommit: SCH_COMMIT,
    line: SCH_LINE,
    splitDelta: VECTOR2I,
    bendCount: { x: number; y: number },
    grid: EE_GRID_HELPER,
  ): void {
    // If the move is not the same angle as this move,  then we need to do something special with
    // the unselected end to maintain orthogonality. Either drag some connected line that is the
    // same angle as the move or add two lines to make a 90 degree connection
    if (!EDA_ANGLE.fromVector(splitDelta).IsParallelTo(line.Angle()) || line.GetLength() === 0) {
      const unselectedEnd = line.HasFlag(STARTPOINT) ? line.GetEndPoint() : line.GetStartPoint();
      const selectedEnd = line.HasFlag(STARTPOINT) ? line.GetStartPoint() : line.GetEndPoint();

      // Look for pre-existing lines we can drag with us instead of creating new ones
      let foundAttachment = false;
      let foundJunction = false;
      let foundPin = false;
      let foundLine: SCH_LINE | null = null;

      for (const cItem of this.cache(line)) {
        foundAttachment = true;

        // If the move is the same angle as a connected line, we can shrink/extend that line
        // endpoint
        switch (cItem.Type()) {
          case KICAD_T.SCH_LINE_T: {
            const cLine = cItem as SCH_LINE;

            // A matching angle on a non-zero-length line means lengthen/shorten will work
            if (
              EDA_ANGLE.fromVector(splitDelta).IsParallelTo(cLine.Angle()) &&
              cLine.GetLength() !== 0
            )
              foundLine = cLine;

            // Zero length lines are lines that this algorithm has shortened to 0 so they also
            // work but we should prefer using a segment with length and angle matching when
            // we can (otherwise the zero length line will draw overlapping segments on them)
            if (!foundLine && cLine.GetLength() === 0) foundLine = cLine;

            break;
          }
          case KICAD_T.SCH_JUNCTION_T:
            foundJunction = true;
            break;

          case KICAD_T.SCH_PIN_T:
            foundPin = true;
            break;

          case KICAD_T.SCH_SHEET_T:
            for (const [pin] of this.m_specialCaseSheetPins) {
              if (pin.IsConnected(selectedEnd)) {
                foundPin = true;
                break;
              }
            }

            break;

          default:
            break;
        }
      }

      // Ok... what if our original line is length zero from moving in its direction, and the
      // last added segment of the 90 bend we are connected to is zero from moving it in its
      // direction after it was added?
      //
      // If we are moving in original direction, we should lengthen the original drag wire.
      // Otherwise we should lengthen the new wire.
      let preferOriginalLine = false;

      if (
        foundLine &&
        foundLine.GetLength() === 0 &&
        line.GetLength() === 0 &&
        EDA_ANGLE.fromVector(splitDelta).IsParallelTo(line.GetStoredAngle())
      ) {
        preferOriginalLine = true;
      }
      // If we have found an attachment, but not a line, we want to check if it's a junction.
      // These are special-cased and get a single line added instead of a 90-degree bend. Except
      // when we're on a pin, because pins always need bends, and junctions are just added to
      // pins for visual clarity.
      else if (!foundLine && foundJunction && !foundPin) {
        // Create a new wire ending at the unselected end
        foundLine = new SCH_LINE(unselectedEnd, line.GetLayer());
        foundLine.SetFlags(IS_NEW);
        foundLine.SetLastResolvedState(line);
        cloneWireConnection(foundLine, line, this.m_frame);
        this.m_frame!.AddToScreen(foundLine, this.m_frame!.GetScreen());
        this.m_newDragLines.add(foundLine);

        // We just broke off of the existing items, so replace all of them with our new
        // end connection.
        this.m_lineConnectionCache.set(foundLine, this.cache(line));
        this.m_lineConnectionCache.set(line, [foundLine]);
      }

      // We want to drag our found line if it's in the same angle as the move or zero length,
      // but if the original drag line is also zero and the same original angle we should extend
      // that one first
      if (foundLine && !preferOriginalLine) {
        // Move the connected line found oriented in the direction of our move.
        //
        // Make sure we grab the right endpoint, it's not always STARTPOINT since the user can
        // draw a box of lines. We need to only move one though, and preferably the start point,
        // in case we have a zero length line that we are extending (we want the foundLine
        // start point to be attached to the unselected end of our drag line).
        //
        // Also, new lines are added already so they'll be in the undo list, skip adding them.

        if (!foundLine.HasFlag(IS_CHANGED) && !foundLine.HasFlag(IS_NEW)) {
          aCommit.Modify(foundLine, this.m_frame!.GetScreen());

          if (!foundLine.IsSelected()) this.m_changedDragLines.add(foundLine);
        }

        if (veq(foundLine.GetStartPoint(), unselectedEnd)) foundLine.MoveStart(splitDelta);
        else if (veq(foundLine.GetEndPoint(), unselectedEnd)) foundLine.MoveEnd(splitDelta);

        this.updateItem(foundLine, true);

        let bendLine: SCH_LINE | null = null;
        const foundCache = this.m_lineConnectionCache.get(foundLine);

        // m_lineConnectionCache.count( foundLine ) == 1: the line has an entry (count is 0 or 1)
        if (foundCache && foundCache[0]?.Type() === KICAD_T.SCH_LINE_T)
          bendLine = foundCache[0] as SCH_LINE;

        // Remerge segments we've created if this is a segment that we've added whose only
        // other connection is also an added segment
        //
        // bendLine is first added segment at the original attachment point, foundLine is the
        // orthogonal line between bendLine and this line
        if (
          foundLine.HasFlag(IS_NEW) &&
          foundLine.GetLength() === 0 &&
          bendLine &&
          bendLine.HasFlag(IS_NEW)
        ) {
          if (line.HasFlag(STARTPOINT)) line.SetEndPoint(bendLine.GetEndPoint());
          else line.SetStartPoint(bendLine.GetEndPoint());

          // Update our cache of the connected items.

          // Re-attach drag labels from lines being deleted to the surviving line.
          // This prevents dangling pointers when bendLine/foundLine are deleted below.
          for (const info of this.m_specialCaseLabels.values()) {
            if (info.attachedLine === bendLine || info.attachedLine === foundLine) {
              info.attachedLine = line;
              info.originalLineStart = line.GetStartPoint();
              info.originalLineEnd = line.GetEndPoint();
            }
          }

          this.m_lineConnectionCache.set(line, this.cache(bendLine));
          this.m_lineConnectionCache.set(bendLine, []);
          this.m_lineConnectionCache.set(foundLine, []);

          this.m_frame!.RemoveFromScreen(bendLine, this.m_frame!.GetScreen());
          this.m_frame!.RemoveFromScreen(foundLine, this.m_frame!.GetScreen());

          this.m_newDragLines.delete(bendLine);
          this.m_newDragLines.delete(foundLine);
        }
        //Ok, move the unselected end of our item
        else {
          if (line.HasFlag(STARTPOINT)) line.MoveEnd(splitDelta);
          else line.MoveStart(splitDelta);
        }

        this.updateItem(line, true);
      } else if (line.GetLength() === 0) {
        // We didn't find another line to shorten/lengthen, (or we did but it's also zero)
        // so now is a good time to use our existing zero-length original line
      }
      // Either no line was at the "right" angle, or this was a junction, pin, sheet, etc. We
      // need to add segments to keep the soon-to-move unselected end connected to these items.
      //
      // To keep our drag selections all the same, we'll move our unselected end point and then
      // put wires between it and its original endpoint.
      else if (foundAttachment && line.IsOrthogonal()) {
        const lineGrid = grid.GetGridSize(grid.GetItemGrid(line));

        // The bend counter handles a group of wires all needing their offset one grid movement
        // further out from each other to not overlap.  The absolute value stuff finds the
        // direction of the line and hence the the bend increment on that axis
        const xMoveBit = splitDelta.x !== 0 ? 1 : 0;
        const yMoveBit = splitDelta.y !== 0 ? 1 : 0;
        const xLength = Math.abs(unselectedEnd.x - selectedEnd.x);
        const yLength = Math.abs(unselectedEnd.y - selectedEnd.y);
        const xMove = Math.trunc(
          (xLength - bendCount.x * lineGrid.x) * sign(selectedEnd.x - unselectedEnd.x),
        );
        const yMove = Math.trunc(
          (yLength - bendCount.y * lineGrid.y) * sign(selectedEnd.y - unselectedEnd.y),
        );

        // Create a new wire ending at the unselected end, we'll move the new wire's start
        // point to the unselected end
        const a = new SCH_LINE(unselectedEnd, line.GetLayer());
        a.MoveStart(v(xMove, yMove));
        a.SetFlags(IS_NEW);
        a.SetConnectivityDirty(true);
        a.SetLastResolvedState(line);
        cloneWireConnection(a, line, this.m_frame);
        this.m_frame!.AddToScreen(a, this.m_frame!.GetScreen());
        this.m_newDragLines.add(a);

        const b = new SCH_LINE(a.GetStartPoint(), line.GetLayer());
        b.MoveStart(v(splitDelta.x, splitDelta.y));
        b.SetFlags(IS_NEW | STARTPOINT);
        b.SetConnectivityDirty(true);
        b.SetLastResolvedState(line);
        cloneWireConnection(b, line, this.m_frame);
        this.m_frame!.AddToScreen(b, this.m_frame!.GetScreen());
        this.m_newDragLines.add(b);

        bendCount.x += yMoveBit;
        bendCount.y += xMoveBit;

        // Ok move the unselected end of our item
        if (line.HasFlag(STARTPOINT))
          line.MoveEnd(v(splitDelta.x ? splitDelta.x : xMove, splitDelta.y ? splitDelta.y : yMove));
        else
          line.MoveStart(
            v(splitDelta.x ? splitDelta.x : xMove, splitDelta.y ? splitDelta.y : yMove),
          );

        // Update our cache of the connected items. First, attach our drag labels to the line
        // left behind.
        for (const candidate of this.cache(line)) {
          const label = candidate instanceof SCH_LABEL_BASE ? candidate : null;

          if (!label || !this.m_specialCaseLabels.has(label)) continue;

          const info = this.m_specialCaseLabels.get(label)!;

          if (veq(label.GetPosition(), selectedEnd)) {
            info.trackMovingEnd = true;
          } else {
            info.attachedLine = a;
            info.originalLineStart = a.GetStartPoint();
            info.originalLineEnd = a.GetEndPoint();
          }
        }

        // We just broke off of the existing items, so replace all of them with our new end
        // connection.
        this.m_lineConnectionCache.set(a, this.cache(line));
        this.cache(b).push(a);
        this.m_lineConnectionCache.set(line, [b]);
      }
      // Original line has no attachments, just move the unselected end
      else if (!foundAttachment) {
        if (line.HasFlag(STARTPOINT)) line.MoveEnd(splitDelta);
        else line.MoveStart(splitDelta);
      }
    }
  }

  /** Run an interactive move of the selected items, or the item under the cursor. */
  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (aEvent.IsAction(SCH_ACTIONS.drag)) this.m_mode = MOVE_MODE.DRAG;
    else if (aEvent.IsAction(SCH_ACTIONS.breakWire)) this.m_mode = MOVE_MODE.BREAK;
    else if (aEvent.IsAction(SCH_ACTIONS.slice)) this.m_mode = MOVE_MODE.SLICE;
    else this.m_mode = MOVE_MODE.MOVE;

    const eventCommit = aEvent.Commit();

    if (eventCommit instanceof SCH_COMMIT) {
      const state = aEvent.SynchronousState();
      console.assert(!!state);

      if (state) state.value = SYNCRONOUS_TOOL_STATE.STS_RUNNING;

      const finished = yield* this.doMoveSelection(aEvent, eventCommit);

      if (state)
        state.value = finished
          ? SYNCRONOUS_TOOL_STATE.STS_FINISHED
          : SYNCRONOUS_TOOL_STATE.STS_CANCELLED;
    } else {
      const localCommit = new SCH_COMMIT(this.m_toolMgr!);

      if (yield* this.doMoveSelection(aEvent, localCommit)) {
        switch (this.m_mode) {
          case MOVE_MODE.MOVE:
            localCommit.Push('Move');
            break;
          case MOVE_MODE.DRAG:
            localCommit.Push('Drag');
            break;
          case MOVE_MODE.BREAK:
            localCommit.Push('Break Wire');
            break;
          case MOVE_MODE.SLICE:
            localCommit.Push('Slice Wire');
            break;
        }
      } else {
        localCommit.Revert();
      }
    }

    return 0;
  }

  /** Break or slice the current selection before initiating a move, if required. */
  private preprocessBreakOrSliceSelection(aCommit: SCH_COMMIT | null, aEvent: TOOL_EVENT): void {
    if (this.m_mode !== MOVE_MODE.BREAK && this.m_mode !== MOVE_MODE.SLICE) return;

    if (!aCommit) return;

    const lwbTool = this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL);

    if (!lwbTool) return;

    const selection = this.m_selectionTool!.GetSelection();

    if (selection.Empty()) return;

    const lines: SCH_LINE[] = [];

    for (const item of selection.GetItems()) {
      if (item.Type() === KICAD_T.SCH_LINE_T) {
        // This function gets called every time segments are broken, which can also be for subsequent
        // breaks in a loop without leaving the current move tool.
        // Skip already placed segments (segment keeps IS_BROKEN but will have IS_NEW cleared below)
        // so that only the actively placed tail segment gets split again.
        if (item.HasFlag(IS_BROKEN) && !item.HasFlag(IS_NEW)) continue;

        lines.push(item as SCH_LINE);
      }
    }

    if (lines.length === 0) return;

    const controls = this.controls();
    const screen = this.m_frame!.GetScreen()!;
    const cursorPos = controls.GetCursorPosition(!aEvent.DisableGridSnapping());

    let useCursorForSingleLine = false;

    if (lines.length === 1) useCursorForSingleLine = true;

    this.m_selectionTool!.ClearSelection();
    this.m_breakPos = null;

    for (const line of lines) {
      const breakPos = useCursorForSingleLine ? cursorPos : line.GetMidPoint();

      if (this.m_mode === MOVE_MODE.BREAK && !this.m_breakPos) this.m_breakPos = breakPos;

      const newLine: { value: SCH_LINE | null } = { value: null };

      lwbTool.BreakSegment(aCommit, line, breakPos, newLine, screen);

      if (!newLine.value) continue;

      // If this is a second+ round break, we need to get rid of the IS_NEW flag since the new segment
      // is now an existing segment we are breaking from, this will be checked for in the line selection
      // gathering above
      line.ClearFlags(STARTPOINT | IS_NEW);
      line.SetFlags(ENDPOINT);
      this.m_selectionTool!.AddItemToSel(line);

      newLine.value.ClearFlags(ENDPOINT | STARTPOINT);

      if (this.m_mode === MOVE_MODE.BREAK) {
        this.m_selectionTool!.AddItemToSel(newLine.value);
        newLine.value.SetFlags(STARTPOINT);
      }
    }
  }

  private *doMoveSelection(aEvent: TOOL_EVENT, aCommit: SCH_COMMIT): COROUTINE_BODY<boolean> {
    const controls = this.controls();
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const currentModeIsDragLike = this.m_mode !== MOVE_MODE.MOVE;
    const wasDragging = this.m_moveInProgress && currentModeIsDragLike;
    let didAtLeastOneBreak = false;

    this.m_anchorPos = null;

    // Check if already in progress and handle state transitions
    if (this.checkMoveInProgress(aEvent, aCommit, currentModeIsDragLike, wasDragging)) return false;

    if (this.m_inMoveTool)
      // Must come after m_moveInProgress checks above...
      return false;

    // REENTRANCY_GUARD guard( &m_inMoveTool )
    this.m_inMoveTool = true;

    try {
      this.preprocessBreakOrSliceSelection(aCommit, aEvent);

      // Prepare selection (promote pins to symbols, request selection)
      const unselectRef = { value: false };
      let selection = this.prepareSelection(unselectRef);
      const unselect = unselectRef.value;

      // Keep an original copy of the starting points for cleanup after the move
      const internalPoints: DANGLING_END_ITEM[] = [];

      // Track selection characteristics
      const traits = {
        hasSheetPins: false,
        hasGraphicItems: false,
        hasNonGraphicItems: false,
        isGraphicsOnly: false,
      };

      let netCollisionMonitor: SCH_DRAG_NET_COLLISION_MONITOR | null = null;

      const refreshTraits = (): void => this.refreshSelectionTraits(selection, traits);

      refreshTraits();

      if (!selection.Empty()) {
        netCollisionMonitor = new SCH_DRAG_NET_COLLISION_MONITOR(this.m_frame!, this.m_view!);
        netCollisionMonitor.Initialize(selection);
      }

      let lastCtrlDown = false;

      // When items are pasted via Ctrl+V, the Ctrl key is still held when the move tool
      // starts. Ctrl disables grid snapping, so the pasted items would track off-grid.
      // The synthetic move action event carries no modifier bits, so query the live
      // keyboard state and ignore Ctrl until the user releases and re-presses it.
      let pasteHoldingCtrl = false;

      for (const item of selection.GetItems()) {
        if (item.HasFlag(IS_PASTED)) {
          pasteHoldingCtrl = wxGetKeyState(WXK.WXK_CONTROL);
          break;
        }
      }

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      this.m_frame!.PushTool(aEvent);

      if (selection.Empty()) {
        // Note that it's important to go through push/pop even when the selection is empty.
        // This keeps other tools from having to special-case an empty move.
        this.m_frame!.PopTool(aEvent);
        return false;
      }

      let restore_state = false;
      let evt: TOOL_EVENT | null = aEvent.clone();
      let prevPos = controls.GetCursorPosition();
      const snapLayer = { value: GRID_HELPER_GRIDS.GRID_CURRENT };
      let hoverSheet: SCH_SHEET | null = null;
      let currentCursor = KICURSOR.MOVING;
      this.m_cursor = controls.GetCursorPosition();

      // Axis locking for arrow key movement
      let axisLock = AXIS_LOCK.NONE;
      let lastArrowKeyAction = 0;

      // Main loop: keep receiving events
      do {
        this.m_frame!.GetCanvas()!.SetCurrentCursor(currentCursor);
        grid.SetSnap(!evt.Modifier(MD_SHIFT));

        const ctrlDown = evt.Modifier(MD_CTRL) !== 0;

        // Only real input events carry modifier state; the synthetic move action does not.
        const hasModifierState = evt.Category() === TC_MOUSE || evt.Category() === TC_KEYBOARD;

        if (pasteHoldingCtrl && hasModifierState && !ctrlDown) pasteHoldingCtrl = false;

        // The paste-held Ctrl only masks grid snapping.  Ctrl also forces a graphics-only drop
        // into a sheet, and that gesture must still honor a physically-held key.
        const gridSnapDisabled = ctrlDown && !pasteHoldingCtrl;

        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !gridSnapDisabled);

        lastCtrlDown = ctrlDown;

        if (
          evt.IsAction(SCH_ACTIONS.restartMove) ||
          evt.IsAction(SCH_ACTIONS.move) ||
          evt.IsAction(SCH_ACTIONS.drag) ||
          evt.IsMotion() ||
          evt.IsDrag(BUT_LEFT) ||
          evt.IsAction(ACTIONS.refreshPreview)
        ) {
          refreshTraits();

          if (!this.m_moveInProgress) {
            // Prepare to start moving/dragging
            this.initializeMoveOperation(aEvent, selection, aCommit, internalPoints, snapLayer);
            prevPos = this.m_cursor;
            refreshTraits();
          }

          //------------------------------------------------------------------------
          // Follow the mouse
          //
          this.m_view!.ClearPreview();

          // We need to bypass refreshPreview action here because it is triggered by the move, so we were
          // getting double-key events that toggled the axis locking if you pressed them in a certain order.
          const vcSettings = controls.GetSettings();

          if (
            vcSettings.m_lastKeyboardCursorPositionValid &&
            !evt.IsAction(ACTIONS.refreshPreview)
          ) {
            const keyboardPos = vcSettings.m_lastKeyboardCursorPosition;
            const action = vcSettings.m_lastKeyboardCursorCommand;

            grid.SetSnap(false);
            this.m_cursor = grid.Align(keyboardPos, snapLayer.value);

            // Update axis lock based on arrow key press
            if (
              action === CURSOR_EVENT_TYPE.CURSOR_LEFT ||
              action === CURSOR_EVENT_TYPE.CURSOR_RIGHT
            ) {
              if (axisLock === AXIS_LOCK.HORIZONTAL) {
                // Check if opposite horizontal key pressed to unlock
                if (
                  (lastArrowKeyAction === CURSOR_EVENT_TYPE.CURSOR_LEFT &&
                    action === CURSOR_EVENT_TYPE.CURSOR_RIGHT) ||
                  (lastArrowKeyAction === CURSOR_EVENT_TYPE.CURSOR_RIGHT &&
                    action === CURSOR_EVENT_TYPE.CURSOR_LEFT)
                ) {
                  axisLock = AXIS_LOCK.NONE;
                }
                // Same direction axis, keep locked
              } else {
                axisLock = AXIS_LOCK.HORIZONTAL;
              }
            } else if (
              action === CURSOR_EVENT_TYPE.CURSOR_UP ||
              action === CURSOR_EVENT_TYPE.CURSOR_DOWN
            ) {
              if (axisLock === AXIS_LOCK.VERTICAL) {
                // Check if opposite vertical key pressed to unlock
                if (
                  (lastArrowKeyAction === CURSOR_EVENT_TYPE.CURSOR_UP &&
                    action === CURSOR_EVENT_TYPE.CURSOR_DOWN) ||
                  (lastArrowKeyAction === CURSOR_EVENT_TYPE.CURSOR_DOWN &&
                    action === CURSOR_EVENT_TYPE.CURSOR_UP)
                ) {
                  axisLock = AXIS_LOCK.NONE;
                }
                // Same direction axis, keep locked
              } else {
                axisLock = AXIS_LOCK.VERTICAL;
              }
            }

            lastArrowKeyAction = action;
          } else {
            this.m_cursor = grid.BestSnapAnchor(
              controls.GetCursorPosition(false),
              snapLayer.value,
              selection,
            );
          }

          if (axisLock === AXIS_LOCK.HORIZONTAL) this.m_cursor = v(this.m_cursor.x, prevPos.y);
          else if (axisLock === AXIS_LOCK.VERTICAL) this.m_cursor = v(prevPos.x, this.m_cursor.y);

          // Find potential target sheet for dropping.  This relocation is only meaningful for a
          // plain move; drag/break/slice reshape existing connections in place and must never
          // pull items onto a sub-sheet's screen.
          let sheet: SCH_SHEET | null = null;

          if (this.m_mode === MOVE_MODE.MOVE)
            sheet = this.findTargetSheet(
              selection,
              this.m_cursor,
              traits.hasSheetPins,
              traits.isGraphicsOnly,
              ctrlDown,
            );

          if (sheet !== hoverSheet) {
            if (hoverSheet) {
              hoverSheet.ClearFlags(BRIGHTENED);
              this.m_frame!.UpdateItem(hoverSheet, false);
            }

            hoverSheet = sheet;

            if (hoverSheet) {
              hoverSheet.SetFlags(BRIGHTENED);
              this.m_frame!.UpdateItem(hoverSheet, false);
            }
          }

          currentCursor = hoverSheet ? KICURSOR.PLACE : KICURSOR.MOVING;

          if (netCollisionMonitor) currentCursor = netCollisionMonitor.AdjustCursor(currentCursor);

          const delta = vsub(this.m_cursor, prevPos);
          this.m_anchorPos = this.m_cursor;

          // Used for tracking how far off a drag end should have its 90 degree elbow added
          const bendCount = { x: 1, y: 1 };

          this.performItemMove(selection, delta, aCommit, bendCount, grid);
          prevPos = this.m_cursor;

          const previewItems: SCH_ITEM[] = [];

          for (const it of selection.GetItems()) previewItems.push(it as SCH_ITEM);

          for (const line of this.m_newDragLines) previewItems.push(line);

          for (const line of this.m_changedDragLines) previewItems.push(line);

          const previewJunctions = PreviewJunctions(this.m_frame!.GetScreen()!, previewItems);

          if (netCollisionMonitor) netCollisionMonitor.Update(previewJunctions, selection);

          for (const jct of previewJunctions) this.m_view!.AddToPreview(jct, true);

          this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsMoved);
        }
        //------------------------------------------------------------------------
        // Handle cancel
        //
        else if (evt.IsCancelInteractive() || evt.IsActivate() || evt.IsAction(ACTIONS.undo)) {
          if (evt.IsCancelInteractive()) {
            this.m_frame!.GetInfoBar()?.Dismiss();

            // When breaking, the user can cancel after multiple breaks to keep all but the last
            // break, so exit normally if we have done at least one break
            if (didAtLeastOneBreak && this.m_mode === MOVE_MODE.BREAK) break;
          }

          if (this.m_moveInProgress) {
            if (evt.IsActivate()) {
              // Allowing other tools to activate during a move runs the risk of race
              // conditions in which we try to spool up both event loops at once.

              switch (this.m_mode) {
                case MOVE_MODE.MOVE:
                  this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel move.');
                  break;
                case MOVE_MODE.DRAG:
                  this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel drag.');
                  break;
                case MOVE_MODE.BREAK:
                  this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel break.');
                  break;
                case MOVE_MODE.SLICE:
                  this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel slice.');
                  break;
              }

              evt.SetPassEvent(false);
              continue;
            }

            evt.SetPassEvent(false);
            restore_state = true;
          } else if (this.m_mode === MOVE_MODE.BREAK || this.m_mode === MOVE_MODE.SLICE) {
            // preprocessBreakOrSliceSelection() split the wire before any motion arrived,
            // so cancel must roll those edits back.  Activations still pass through so the
            // requested tool starts.
            if (!evt.IsActivate()) evt.SetPassEvent(false);

            restore_state = true;
          }

          this.clearNewDragLines();

          this.m_view!.ClearPreview();

          break;
        }
        //------------------------------------------------------------------------
        // Handle TOOL_ACTION special cases
        //
        else if (!this.handleMoveToolActions(evt, aCommit, selection)) {
          break; // Exit if told to by handler
        }
        //------------------------------------------------------------------------
        // Handle context menu
        //
        else if (evt.IsClick(BUT_RIGHT)) {
          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        }
        //------------------------------------------------------------------------
        // Handle drop
        //
        else if (evt.IsMouseUp(BUT_LEFT) || evt.IsClick(BUT_LEFT)) {
          if (this.m_mode !== MOVE_MODE.BREAK)
            break; // Finish
          else {
            didAtLeastOneBreak = true;
            this.preprocessBreakOrSliceSelection(aCommit, evt);
            selection = this.m_selectionTool!.RequestSelection(SCH_COLLECTOR.MovableItems, true);

            if (this.m_breakPos) {
              this.m_cursor = this.m_breakPos;
              this.m_anchorPos = this.m_cursor;
              selection.SetReferencePoint(this.m_cursor);
              this.m_moveOffset = v(0, 0);
              this.m_breakPos = null;

              controls.SetCursorPosition(this.m_cursor, false);
              prevPos = this.m_cursor;
            }
          }
        } else if (evt.IsDblClick(BUT_LEFT)) {
          // Double click always finishes, even breaks
          break;
        }
        // Don't call SetPassEvent() for events we've handled - let them be consumed
        else if (
          evt.IsAction(SCH_ACTIONS.rotateCW) ||
          evt.IsAction(SCH_ACTIONS.rotateCCW) ||
          evt.IsAction(ACTIONS.increment) ||
          evt.IsAction(SCH_ACTIONS.toDLabel) ||
          evt.IsAction(SCH_ACTIONS.toGLabel) ||
          evt.IsAction(SCH_ACTIONS.toHLabel) ||
          evt.IsAction(SCH_ACTIONS.toLabel) ||
          evt.IsAction(SCH_ACTIONS.toText) ||
          evt.IsAction(SCH_ACTIONS.toTextBox) ||
          evt.IsAction(SCH_ACTIONS.highlightNet) ||
          evt.IsAction(SCH_ACTIONS.selectOnPCB) ||
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.redo)
        ) {
          // Event was already handled by handleMoveToolActions, don't pass it on
        } else {
          evt.SetPassEvent();
        }

        controls.SetAutoPan(this.m_moveInProgress);
        // biome-ignore lint/suspicious/noAssignInExpressions: the C++ do/while fetches the next event in its condition, which every `continue` above must reach
      } while ((evt = yield* this.Wait())); //Should be assignment not equality test

      let targetSheet = hoverSheet;

      if (traits.hasSheetPins || (traits.isGraphicsOnly && !lastCtrlDown)) targetSheet = null;

      if (hoverSheet) {
        hoverSheet.ClearFlags(BRIGHTENED);
        this.m_frame!.UpdateItem(hoverSheet, false);
      }

      if (restore_state) {
        for (const hidden of this.m_hiddenJunctions) this.m_view!.Hide(hidden.m_junction, false);

        this.m_selectionTool!.RemoveItemsFromSel(this.m_dragAdditions, QUIET_MODE);

        // Clear the split-segment selection that preprocessBreakOrSliceSelection() built
        // before the caller's Revert() runs.  Revert() rebuilds selection from the screen,
        // so leaving the splits selected keeps the restored wire hidden until the next
        // selection refresh.
        if (this.m_mode === MOVE_MODE.BREAK || this.m_mode === MOVE_MODE.SLICE)
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      } else {
        // Only drop into a sheet when the move is committed, not when canceled.
        if (targetSheet) {
          this.moveSelectionToSheet(selection, targetSheet, aCommit);
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
          this.m_newDragLines.clear();
          this.m_changedDragLines.clear();
        }

        this.finalizeMoveOperation(selection, aCommit, unselect, internalPoints);
      }

      this.m_dragAdditions = [];
      this.m_lineConnectionCache.clear();
      this.m_moveInProgress = false;
      this.m_breakPos = null;

      this.m_hiddenJunctions = [];
      this.m_view!.ClearPreview();
      this.m_frame!.PopTool(aEvent);

      return !restore_state;
    } finally {
      this.m_inMoveTool = false;
    }
  }

  /** Check if a move is already in progress and handle state transitions. */
  private checkMoveInProgress(
    _aEvent: TOOL_EVENT,
    aCommit: SCH_COMMIT,
    aCurrentModeIsDragLike: boolean,
    aWasDragging: boolean,
  ): boolean {
    const controls = this.controls();

    if (!this.m_moveInProgress) return false;

    if (aCurrentModeIsDragLike !== aWasDragging) {
      const sel = this.m_selectionTool!.GetSelection().Front();

      if (sel && !sel.IsNew()) {
        // Reset the selected items so we can start again with the current drag mode state
        aCommit.Revert();

        this.m_selectionTool!.RemoveItemsFromSel(this.m_dragAdditions, QUIET_MODE);
        this.m_anchorPos = vsub(this.m_cursor, this.m_moveOffset);
        this.m_moveInProgress = false;
        controls.SetAutoPan(false);

        // Give it a kick so it doesn't have to wait for the first mouse movement to refresh
        this.m_toolMgr!.PostAction(SCH_ACTIONS.restartMove);
      }
    } else {
      // The tool hotkey is interpreted as a click when already dragging/moving
      this.m_toolMgr!.PostAction(ACTIONS.cursorClick);
    }

    return true;
  }

  /** Promote pin selections to parent symbols and request final selection. */
  private prepareSelection(aUnselect: { value: boolean }): SCH_SELECTION {
    const userSelection = this.m_selectionTool!.GetSelection();

    // If a single pin is selected, promote the move selection to its parent symbol
    if (userSelection.GetSize() === 1) {
      const selItem = userSelection.Front()!;

      if (selItem.Type() === KICAD_T.SCH_PIN_T) {
        const parent = selItem.GetParent()!;

        if (parent.Type() === KICAD_T.SCH_SYMBOL_T) {
          this.m_selectionTool!.ClearSelection();
          this.m_selectionTool!.AddItemToSel(parent);
        }
      }
    }

    // Be sure that there is at least one item that we can move. If there's no selection try
    // looking for the stuff under mouse cursor (i.e. KiCad old-style hover selection).
    const selection = this.m_selectionTool!.RequestSelection(SCH_COLLECTOR.MovableItems, true);
    aUnselect.value = selection.IsHover();

    return selection;
  }

  /** Refresh selection traits (sheet pins, graphic items, etc.). */
  private refreshSelectionTraits(
    aSelection: SCH_SELECTION,
    aTraits: {
      hasSheetPins: boolean;
      hasGraphicItems: boolean;
      hasNonGraphicItems: boolean;
      isGraphicsOnly: boolean;
    },
  ): void {
    aTraits.hasSheetPins = false;
    aTraits.hasGraphicItems = false;
    aTraits.hasNonGraphicItems = false;

    for (const edaItem of aSelection.GetItems()) {
      const schItem = edaItem as SCH_ITEM;

      if (schItem.Type() === KICAD_T.SCH_SHEET_PIN_T) aTraits.hasSheetPins = true;

      if (isGraphicItemForDrop(schItem)) aTraits.hasGraphicItems = true;
      else if (schItem.Type() !== KICAD_T.SCH_SHEET_T) aTraits.hasNonGraphicItems = true;
    }

    aTraits.isGraphicsOnly = aTraits.hasGraphicItems && !aTraits.hasNonGraphicItems;
  }

  /** Setup items for drag operation, collecting connected items. */
  private setupItemsForDrag(aSelection: SCH_SELECTION, aCommit: SCH_COMMIT): void {
    // Drag of split items start over top of their other segment, so we want to skip grabbing
    // the segments we split from
    if (this.m_mode !== MOVE_MODE.DRAG && this.m_mode !== MOVE_MODE.BREAK) return;

    const connectedDragItems: EDA_ITEM[] = [];

    // Add connections to the selection for a drag.
    // Do all non-labels/entries first so we don't add junctions to drag when the line will
    // eventually be drag selected.
    const stageTwo: SCH_ITEM[] = [];

    for (const edaItem of aSelection.GetItems()) {
      const item = edaItem as SCH_ITEM;
      let connections: VECTOR2I[] = [];

      switch (item.Type()) {
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_DIRECTIVE_LABEL_T:
          stageTwo.push(item);
          break;

        case KICAD_T.SCH_LINE_T:
          (item as SCH_LINE).GetSelectedPoints(connections);
          break;

        default:
          connections = item.GetConnectionPoints();
      }

      for (const point of connections)
        this.getConnectedDragItems(aCommit, item, point, connectedDragItems);
    }

    // Go back and get all label connections now that we can test for drag-selected lines
    // the labels might be on
    for (const item of stageTwo) {
      for (const point of item.GetConnectionPoints())
        this.getConnectedDragItems(aCommit, item, point, connectedDragItems);
    }

    for (const item of connectedDragItems) {
      this.m_dragAdditions.push(item.m_Uuid);
      this.m_selectionTool!.AddItemToSel(item, QUIET_MODE);
    }

    // Pre-cache all connections of our selected objects so we can keep track of what they
    // were originally connected to as we drag them around
    for (const edaItem of aSelection.GetItems()) {
      const schItem = edaItem as SCH_ITEM;

      if (schItem.Type() === KICAD_T.SCH_LINE_T) {
        const line = schItem as SCH_LINE;

        // Store the original angle of the line; needed later to decide which segment
        // to extend when they've become zero length
        line.StoreAngle();

        for (const point of line.GetConnectionPoints())
          this.getConnectedItems(line, point, this.cache(line));
      }
    }
  }

  /** Setup items for move operation, marking dangling ends. */
  private setupItemsForMove(aSelection: SCH_SELECTION, aInternalPoints: DANGLING_END_ITEM[]): void {
    // Mark the edges of the block with dangling flags for a move
    for (const item of aSelection.GetItems()) (item as SCH_ITEM).GetEndPoints(aInternalPoints);

    const endPointsByType = [...aInternalPoints];
    const endPointsByPos = [...endPointsByType];
    DANGLING_END_ITEM_HELPER.sort_dangling_end_items(endPointsByType, endPointsByPos);

    for (const item of aSelection.GetItems())
      (item as SCH_ITEM).UpdateDanglingState(endPointsByType, endPointsByPos);
  }

  /** Initialize the move/drag operation, setting up flags and connections. */
  private initializeMoveOperation(
    aEvent: TOOL_EVENT,
    aSelection: SCH_SELECTION,
    aCommit: SCH_COMMIT,
    aInternalPoints: DANGLING_END_ITEM[],
    aSnapLayer: { value: GRID_HELPER_GRIDS },
  ): void {
    const controls = this.controls();
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const sch_item = aSelection.Front() as SCH_ITEM | null;
    const placingNewItems = !!sch_item && sch_item.IsNew();

    //------------------------------------------------------------------------
    // Setup a drag or a move
    //
    this.m_dragAdditions = [];
    this.m_specialCaseLabels.clear();
    this.m_specialCaseSheetPins.clear();
    aInternalPoints.length = 0;
    this.clearNewDragLines();

    for (const it of this.m_frame!.GetScreen()!.Items()) {
      it.ClearFlags(SELECTED_BY_DRAG);

      if (!it.IsSelected()) it.ClearFlags(STARTPOINT | ENDPOINT);
    }

    this.setupItemsForDrag(aSelection, aCommit);
    this.setupItemsForMove(aSelection, aInternalPoints);

    this.recordRedundantJunctions(aSelection);

    // Generic setup
    aSnapLayer.value = grid.GetSelectionGrid(aSelection);

    for (const item of aSelection.GetItems()) {
      const schItem = item as SCH_ITEM;

      if (schItem.IsNew()) {
        // Item was added to commit in a previous command

        // While SCH_COMMIT::Push() will add any new items to the entered group, we need
        // to do it earlier so that the previews while moving are correct.
        const enteredGroup = this.m_selectionTool!.GetEnteredGroup();

        if (enteredGroup) {
          if (schItem.IsGroupableType() && !schItem.GetParentGroup()) {
            aCommit.Modify(enteredGroup, this.m_frame!.GetScreen(), RECURSE_MODE.NO_RECURSE);
            enteredGroup.AddItem(schItem);
          }
        }
      } else if (schItem.GetParent()?.IsSelected()) {
        // Item will be (or has been) added to commit by parent
      } else {
        aCommit.Modify(schItem, this.m_frame!.GetScreen(), RECURSE_MODE.RECURSE);
      }

      schItem.SetFlags(IS_MOVING);

      if (schItem instanceof SCH_SHAPE) {
        schItem.SetHatchingDirty();
        schItem.UpdateHatching();
      }

      schItem.RunOnChildren((aChild: SCH_ITEM) => {
        aChild.SetFlags(IS_MOVING);
      }, RECURSE_MODE.RECURSE);

      schItem.SetStoredPos(schItem.GetPosition());
    }

    // Set up the starting position and move/drag offset
    this.m_cursor = controls.GetCursorPosition();

    if (this.m_mode === MOVE_MODE.BREAK && this.m_breakPos) {
      this.m_cursor = this.m_breakPos;
      this.m_anchorPos = this.m_cursor;
      aSelection.SetReferencePoint(this.m_cursor);
      this.m_moveOffset = v(0, 0);
      this.m_breakPos = null;
    }

    if (aEvent.IsAction(SCH_ACTIONS.restartMove)) {
      console.assert(!!this.m_anchorPos, 'Should be already set from previous cmd');
    } else if (placingNewItems) {
      this.m_anchorPos = aSelection.GetReferencePoint();
    }

    if (this.m_anchorPos) {
      const delta = vsub(this.m_cursor, this.m_anchorPos);
      let isPasted = false;

      // Drag items to the current cursor position
      for (const item of aSelection.GetItems()) {
        // Don't double move pins, fields, etc.
        if (item.GetParent()?.IsSelected()) continue;

        this.moveItem(item, delta);
        this.updateItem(item, false);

        isPasted ||= (item.GetFlags() & IS_PASTED) !== 0;
      }

      // The first time pasted items are moved we need to store the position of the cursor
      // so that rotate while moving works as expected (instead of around the original
      // anchor point)
      if (isPasted) aSelection.SetReferencePoint(this.m_cursor);

      this.m_anchorPos = this.m_cursor;
    }
    // For some items, moving the cursor to anchor is not good (for instance large
    // hierarchical sheets or symbols can have the anchor outside the view)
    else if (aSelection.Size() === 1 && !sch_item!.IsMovableFromAnchorPoint()) {
      this.m_cursor = controls.GetCursorPosition(true);
      this.m_anchorPos = this.m_cursor;
    } else {
      if (this.m_frame!.GetMoveWarpsCursor()) {
        // User wants to warp the mouse
        this.m_cursor = grid.BestDragOrigin(this.m_cursor, aSnapLayer.value, aSelection);
        aSelection.SetReferencePoint(this.m_cursor);
      } else {
        // User does not want to warp the mouse
        this.m_cursor = controls.GetCursorPosition(true);
      }
    }

    controls.SetCursorPosition(this.m_cursor, false);
    controls.SetAutoPan(true);
    this.m_moveInProgress = true;
  }

  /** Find the target sheet for dropping items (if any). */
  private findTargetSheet(
    aSelection: SCH_SELECTION,
    aCursorPos: VECTOR2I,
    aHasSheetPins: boolean,
    aIsGraphicsOnly: boolean,
    aCtrlDown: boolean,
  ): SCH_SHEET | null {
    // Fields are children of their parent item and must not be dropped into a sheet
    for (const it of aSelection.GetItems()) {
      if (it.Type() === KICAD_T.SCH_FIELD_T) return null;
    }

    // Determine potential target sheet
    const found = this.m_frame!.GetScreen()!.GetItem(aCursorPos, 0, KICAD_T.SCH_SHEET_T);
    let sheet = found instanceof SCH_SHEET ? found : null;

    if (sheet && (sheet.IsSelected() || sheet.HasFlag(IS_MOVING))) sheet = null; // Never target a selected sheet

    if (!sheet) {
      // Build current selection bounding box in its (already moved) position
      const selBBox = new BOX2I();

      for (const it of aSelection.GetItems()) {
        if (it instanceof SCH_ITEM) selBBox.Merge(it.GetBoundingBox());
      }

      if (selBBox.GetWidth() > 0 && selBBox.GetHeight() > 0) {
        const selCenter = v(
          selBBox.GetX() + Math.trunc(selBBox.GetWidth() / 2),
          selBBox.GetY() + Math.trunc(selBBox.GetHeight() / 2),
        );

        // Find first non-selected sheet whose body fully contains the selection or at
        // least contains its center point
        for (const it of this.m_frame!.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)) {
          const candidate = it as SCH_SHEET;

          if (candidate.IsSelected() || candidate.IsTopLevelSheet() || candidate.HasFlag(IS_MOVING))
            continue;

          const body = candidate.GetBodyBoundingBox();

          if (body.Contains(selBBox) || body.Contains(selCenter)) {
            sheet = candidate;
            break;
          }
        }
      }
    }

    // Don't drop into a sheet if any connection point of the selection lands on a sheet pin.
    // This indicates the user is trying to connect to the pin, not drop into the sheet.
    if (sheet) {
      for (const it of aSelection.GetItems()) {
        const schItem = it instanceof SCH_ITEM ? it : null;

        if (!schItem) continue;

        for (const pt of schItem.GetConnectionPoints()) {
          if (sheet.GetPin(pt)) {
            sheet = null;
            break;
          }
        }

        if (!sheet) break;
      }
    }

    if (sheet && this.dropWouldRecurse(aSelection, sheet)) sheet = null;

    const dropAllowedBySelection = !aHasSheetPins;
    const dropAllowedByModifiers = !aIsGraphicsOnly || aCtrlDown;

    if (sheet && !(dropAllowedBySelection && dropAllowedByModifiers)) sheet = null;

    return sheet;
  }

  /** True when dropping the selection into aTargetSheet would make a sheet its own descendant. */
  private dropWouldRecurse(aSelection: SCH_SELECTION, aTargetSheet: SCH_SHEET): boolean {
    const destScreen = aTargetSheet.GetScreen();

    if (!destScreen || destScreen.GetFileName() === '') return false;

    const movedSheets: SCH_SHEET[] = [];

    for (const item of aSelection.GetItems()) {
      if (item.Type() === KICAD_T.SCH_SHEET_T) movedSheets.push(item as SCH_SHEET);
    }

    if (movedSheets.length === 0) return false;

    const hierarchy = this.m_frame!.Schematic().Hierarchy();

    for (const movedSheet of movedSheets) {
      const movedHierarchy = SCH_SHEET_LIST.build(movedSheet);

      if (hierarchy.TestForRecursion(movedHierarchy, destScreen.GetFileName())) return true;
    }

    return false;
  }

  /** Perform the actual move of items by delta, handling split moves and orthogonal dragging. */
  private performItemMove(
    aSelection: SCH_SELECTION,
    aDelta: VECTOR2I,
    aCommit: SCH_COMMIT,
    aBendCount: { x: number; y: number },
    aGrid: EE_GRID_HELPER,
  ): void {
    // We need to check if the movement will change the net offset direction on the X and Y
    // axes. This is because we remerge added bend lines in realtime, and we also account for
    // the direction of the move when adding bend lines. So, if the move direction changes,
    // we need to split it into a move that gets us back to zero, then the rest of the move.
    const splitMoves: VECTOR2I[] = [];

    if (signbit(this.m_moveOffset.x) !== signbit(this.m_moveOffset.x + aDelta.x)) {
      splitMoves.push(v(-1 * this.m_moveOffset.x, 0));
      splitMoves.push(v(aDelta.x + this.m_moveOffset.x, 0));
    } else {
      splitMoves.push(v(aDelta.x, 0));
    }

    if (signbit(this.m_moveOffset.y) !== signbit(this.m_moveOffset.y + aDelta.y)) {
      splitMoves.push(v(0, -1 * this.m_moveOffset.y));
      splitMoves.push(v(0, aDelta.y + this.m_moveOffset.y));
    } else {
      splitMoves.push(v(0, aDelta.y));
    }

    this.m_moveOffset = vadd(this.m_moveOffset, aDelta);

    // Split the move into X and Y moves so we can correctly drag orthogonal lines
    for (const splitDelta of splitMoves) {
      // Skip non-moves
      if (veq(splitDelta, v(0, 0))) continue;

      for (const item of aSelection.GetItemsSortedByTypeAndXY(aDelta.x >= 0, aDelta.y >= 0)) {
        // Don't double move pins, fields, etc.
        if (item.GetParent()?.IsSelected()) continue;

        const line = item instanceof SCH_LINE ? item : null;
        let isLineModeConstrained = false;

        const cfg = this.m_frame!.eeconfig();

        if (cfg) isLineModeConstrained = cfg.drawing.line_mode !== LINE_MODE.LINE_MODE_FREE;

        // Only partially selected drag lines in orthogonal line mode need special handling.
        // Skip newly-created connectivity wires added to maintain connectivity at junctions:
        // these are marked with both IS_NEW and SELECTED_BY_DRAG; they already have the
        // correct endpoint constraint and don't need orthogonal bending
        if (
          this.m_mode === MOVE_MODE.DRAG &&
          isLineModeConstrained &&
          line &&
          line.HasFlag(STARTPOINT) !== line.HasFlag(ENDPOINT) &&
          !line.HasFlag(SELECTED_BY_DRAG | IS_NEW)
        ) {
          this.orthoLineDrag(aCommit, line, splitDelta, aBendCount, aGrid);
        }

        // Move all other items normally, including the selected end of partially selected
        // lines
        this.moveItem(item, splitDelta);
        this.updateItem(item, false);

        // Update any lines connected to sheet pins to the sheet pin's location (which may
        // not exactly follow the splitDelta as the pins are constrained along the sheet
        // edges)
        for (const [pin, [lineEnd, atStart]] of this.m_specialCaseSheetPins) {
          if (atStart && lineEnd.HasFlag(STARTPOINT)) lineEnd.SetStartPoint(pin.GetPosition());
          else if (!atStart && lineEnd.HasFlag(ENDPOINT)) lineEnd.SetEndPoint(pin.GetPosition());
        }
      }

      // Needed to keep labels attached to a line when dragging a sheet/wire combo with a label
      // on the line. The label moves by splitDelta for each part of the split move, but the
      // line endpoints may not follow splitDelta due to orthogonal drag or sheet pin constraints,
      // which can put the label off the line.
      for (const [label, info] of this.m_specialCaseLabels) {
        if (!label || !info.attachedLine) continue;

        if (info.trackMovingEnd) {
          label.Move(splitDelta);

          const start = info.attachedLine.GetStartPoint();
          const end = info.attachedLine.GetEndPoint();

          if (
            info.attachedLine.GetLength() > 0 &&
            info.attachedLine.HitTest(info.originalLabelPos, 1) &&
            !veq(info.originalLabelPos, start) &&
            !veq(info.originalLabelPos, end)
          ) {
            info.trackMovingEnd = false;
            label.SetPosition(info.originalLabelPos);
            info.originalLineStart = start;
            info.originalLineEnd = end;
          }

          this.updateItem(label, false);
          continue;
        }

        const start = info.attachedLine.GetStartPoint();
        const end = info.attachedLine.GetEndPoint();
        const deltaStart = vsub(start, info.originalLineStart);
        const deltaEnd = vsub(end, info.originalLineEnd);

        // TODO: this could be improved by positioning the label based on the new line geometry,
        // bends are involved.
        //
        // For now, special casing the equal delta case and using splitDelta should work in most
        // cases as the user would expect.
        if (veq(deltaStart, deltaEnd)) {
          label.SetPosition(vadd(info.originalLabelPos, deltaStart));
        } else {
          const startDrags = info.attachedLine.HasFlag(STARTPOINT);
          const fixedEndDelta = startDrags ? deltaEnd : deltaStart;

          label.SetPosition(vadd(info.originalLabelPos, fixedEndDelta));

          // If the line shrank while dragging, keep the label on the line,
          // otherwise the label can drift off the end of the line, and change connectivity
          if (!info.attachedLine.HitTest(label.GetPosition(), 1)) {
            const seg = new SEG(start, end);
            label.SetPosition(seg.NearestPoint(label.GetPosition()));

            const movingEnd = startDrags ? start : end;

            if (veq(label.GetPosition(), movingEnd)) info.trackMovingEnd = true;
          }
        }

        this.updateItem(label, false);
      }
    }

    if (aSelection.HasReferencePoint())
      aSelection.SetReferencePoint(vadd(aSelection.GetReferencePoint(), aDelta));
  }

  /** Handle tool action events during the move operation; false to end the move. */
  private handleMoveToolActions(
    aEvent: TOOL_EVENT,
    aCommit: SCH_COMMIT,
    aSelection: SCH_SELECTION,
  ): boolean {
    if (aEvent.IsAction(ACTIONS.doDelete)) {
      aEvent.SetPassEvent();
      return false; // Exit on delete; there will no longer be anything to drag
    } else if (
      aEvent.IsAction(ACTIONS.duplicate) ||
      aEvent.IsAction(SCH_ACTIONS.repeatDrawItem) ||
      aEvent.IsAction(ACTIONS.redo)
    ) {
      wxBell();
    } else if (aEvent.IsAction(SCH_ACTIONS.rotateCW)) {
      this.m_toolMgr!.RunSynchronousAction(SCH_ACTIONS.rotateCW, aCommit);
      this.updateStoredPositions(aSelection);
      // Note: SCH_EDIT_TOOL::Rotate already posts refreshPreview when moving
    } else if (aEvent.IsAction(SCH_ACTIONS.rotateCCW)) {
      this.m_toolMgr!.RunSynchronousAction(SCH_ACTIONS.rotateCCW, aCommit);
      this.updateStoredPositions(aSelection);
      // Note: SCH_EDIT_TOOL::Rotate already posts refreshPreview when moving
    } else if (aEvent.IsAction(ACTIONS.increment)) {
      if (aEvent.HasParameter())
        this.m_toolMgr!.RunSynchronousAction(
          ACTIONS.increment,
          aCommit,
          aEvent.Parameter<INCREMENT>(),
        );
      else
        this.m_toolMgr!.RunSynchronousAction(ACTIONS.increment, aCommit, {
          Delta: 1,
          Index: 0,
        } as INCREMENT);

      this.updateStoredPositions(aSelection);
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    } else if (
      aEvent.IsAction(SCH_ACTIONS.toDLabel) ||
      aEvent.IsAction(SCH_ACTIONS.toGLabel) ||
      aEvent.IsAction(SCH_ACTIONS.toHLabel) ||
      aEvent.IsAction(SCH_ACTIONS.toLabel) ||
      aEvent.IsAction(SCH_ACTIONS.toText) ||
      aEvent.IsAction(SCH_ACTIONS.toTextBox)
    ) {
      const action = [
        SCH_ACTIONS.toDLabel,
        SCH_ACTIONS.toGLabel,
        SCH_ACTIONS.toHLabel,
        SCH_ACTIONS.toLabel,
        SCH_ACTIONS.toText,
        SCH_ACTIONS.toTextBox,
      ].find((a) => aEvent.IsAction(a))!;

      this.m_toolMgr!.RunSynchronousAction(action, aCommit);
      this.updateStoredPositions(aSelection);
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    } else if (aEvent.Action() === TA_CHOICE_MENU_CHOICE) {
      const id = aEvent.GetCommandId() ?? -1;
      const I = id_eeschema_frm;

      if (id >= I.ID_POPUP_SCH_SELECT_UNIT && id <= I.ID_POPUP_SCH_SELECT_UNIT_END) {
        const symbol = this.m_selectionTool!.GetSelection().Front();
        const unit = id - I.ID_POPUP_SCH_SELECT_UNIT;

        if (symbol instanceof SCH_SYMBOL) {
          this.m_frame!.SelectUnit(symbol, unit);
          this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
        }
      } else if (
        id >= I.ID_POPUP_SCH_SELECT_BODY_STYLE &&
        id <= I.ID_POPUP_SCH_SELECT_BODY_STYLE_END
      ) {
        const symbol = this.m_selectionTool!.GetSelection().Front();
        const bodyStyle = id - I.ID_POPUP_SCH_SELECT_BODY_STYLE + 1;

        if (symbol instanceof SCH_SYMBOL && symbol.GetBodyStyle() !== bodyStyle) {
          this.m_frame!.SelectBodyStyle(symbol, bodyStyle);
          this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
        }
      }
    } else if (
      aEvent.IsAction(SCH_ACTIONS.highlightNet) ||
      aEvent.IsAction(SCH_ACTIONS.selectOnPCB)
    ) {
      // These don't make any sense during a move. Eat them.
    } else {
      return true; // Continue processing
    }

    return true; // Continue processing
  }

  /** Update stored positions after transformations (rotation, mirroring, etc.) during move. */
  private updateStoredPositions(aSelection: SCH_SELECTION): void {
    // After transformations like rotation during a move, we need to update the stored
    // positions that moveItem() uses, particularly for sheet pins which rely on them
    // for constraint calculations.
    for (const item of aSelection.GetItems()) {
      const schItem = item instanceof SCH_ITEM ? item : null;

      if (!schItem) continue;

      schItem.SetStoredPos(schItem.GetPosition());

      // Also update stored positions for sheet pins
      if (schItem.Type() === KICAD_T.SCH_SHEET_T) {
        for (const pin of (schItem as SCH_SHEET).GetPins()) pin.SetStoredPos(pin.GetPosition());
      }
    }
  }

  /**
   * Hide the junction dots that the pending edit will make redundant, noting the line end each one
   * marks.
   */
  private recordRedundantJunctions(aSelection: SCH_SELECTION): void {
    this.m_hiddenJunctions = [];

    for (const item of aSelection.GetItems()) item.SetFlags(STRUCT_DELETED);

    for (const edaItem of aSelection.GetItems()) {
      if (edaItem.Type() !== KICAD_T.SCH_LINE_T) continue;

      const line = edaItem as SCH_LINE;

      for (const pt of line.GetConnectionPoints()) {
        const jct = this.m_frame!.GetScreen()!.GetItem(
          pt,
          0,
          KICAD_T.SCH_JUNCTION_T,
        ) as SCH_JUNCTION | null;

        if (jct && !jct.IsSelected() && !this.m_hiddenJunctions.some((h) => h.m_junction === jct)) {
          const info = AnalyzePoint(this.m_frame!.GetScreen()!.Items(), pt, false);

          if (!info.isJunction) {
            this.m_hiddenJunctions.push({
              m_junction: jct,
              m_lineId: line.m_Uuid,
              m_atLineStart: veq(pt, line.GetStartPoint()),
            });
            this.m_view!.Hide(jct, true);
          }
        }
      }
    }

    for (const item of aSelection.GetItems()) item.ClearFlags(STRUCT_DELETED);
  }

  /** Move those junction dots to wherever the line end they marked has ended up. */
  private migrateHiddenJunctions(aCommit: SCH_COMMIT): void {
    const screen = this.m_frame!.GetScreen()!;

    for (const hidden of this.m_hiddenJunctions) {
      this.m_view!.Hide(hidden.m_junction, false);

      const resolved = this.m_frame!.Schematic().ResolveItem(hidden.m_lineId, null, true);
      const line = resolved instanceof SCH_LINE ? resolved : null;

      if (!line) continue;

      const newPos = hidden.m_atLineStart ? line.GetStartPoint() : line.GetEndPoint();

      if (
        !veq(newPos, hidden.m_junction.GetPosition()) &&
        !screen.IsExplicitJunction(hidden.m_junction.GetPosition()) &&
        screen.IsExplicitJunctionNeeded(newPos)
      ) {
        aCommit.Modify(hidden.m_junction, screen);
        hidden.m_junction.SetPosition(newPos);
        this.m_frame!.UpdateItem(hidden.m_junction, false, true);
      }
    }
  }

  /** Finalize the move operation, updating junctions and cleaning up. */
  private finalizeMoveOperation(
    aSelection: SCH_SELECTION,
    aCommit: SCH_COMMIT,
    aUnselect: boolean,
    aInternalPoints: readonly DANGLING_END_ITEM[],
  ): void {
    const controls = this.controls();
    const isSlice = this.m_mode === MOVE_MODE.SLICE;
    const isDragLike = this.m_mode === MOVE_MODE.DRAG || this.m_mode === MOVE_MODE.BREAK;

    // Save whatever new bend lines and changed lines survived the drag
    for (const newLine of this.m_newDragLines) {
      newLine.ClearEditFlags();
      aCommit.Added(newLine, this.m_frame!.GetScreen());
    }

    // These lines have been changed, but aren't selected. We need to manually clear these
    // edit flags or they'll stick around.
    for (const oldLine of this.m_changedDragLines) oldLine.ClearEditFlags();

    controls.ForceCursorPosition(false);
    controls.ShowCursor(false);
    controls.SetAutoPan(false);

    this.m_moveOffset = v(0, 0);
    this.m_anchorPos = null;

    // One last update after exiting loop (for slower stuff, such as updating SCREEN's RTree)
    for (const item of aSelection.GetItems()) {
      this.updateItem(item, true);

      if (item instanceof SCH_ITEM) item.SetConnectivityDirty(true);
    }

    if (aSelection.GetSize() === 1 && aSelection.Front()!.IsNew())
      this.m_frame!.SaveCopyForRepeatItem(aSelection.Front() as SCH_ITEM);

    this.m_selectionTool!.RemoveItemsFromSel(this.m_dragAdditions, QUIET_MODE);

    const lwbTool = this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;

    // If we move items away from a junction, we _may_ want to add a junction there
    // to denote the state
    for (const it of aInternalPoints) {
      if (this.m_frame!.GetScreen()!.IsExplicitJunctionNeeded(it.GetPosition()))
        lwbTool.AddJunction(aCommit, this.m_frame!.GetScreen()!, it.GetPosition());
    }

    // Create a selection of original selection, drag selected/changed items, and new bend
    // lines for later before we clear them in the aCommit. We'll need these to check for new
    // junctions needed, etc.
    const selectionCopy = new SCH_SELECTION().assign(aSelection);

    for (const line of this.m_newDragLines) selectionCopy.Add(line);

    for (const line of this.m_changedDragLines) selectionCopy.Add(line);

    lwbTool.TrimOverLappingWires(aCommit, selectionCopy);

    this.migrateHiddenJunctions(aCommit);

    lwbTool.AddJunctionsIfNeeded(aCommit, selectionCopy);

    // This needs to run prior to `RecalculateConnections` because we need to identify the
    // lines that are newly dangling
    if (isDragLike && !isSlice) this.trimDanglingLines(aCommit);

    // Auto-rotate any moved labels
    for (const item of aSelection.GetItems())
      this.m_frame!.AutoRotateItem(this.m_frame!.GetScreen()!, item as SCH_ITEM);

    // Clear SELECTED_BY_DRAG and other temp flags before CleanUp so that cleanup can properly
    // process all items, including removing zero-length wires and unwanted stubs
    for (const item of this.m_frame!.GetScreen()!.Items()) item.ClearTempFlags();

    for (const item of selectionCopy.GetItems()) item.ClearTempFlags();

    this.m_frame!.Schematic().CleanUp(aCommit);

    // Mirror the IS_MOVING flag propagation done at the start of the move so that child items
    // (e.g. label fields, symbol pins/fields) don't keep their edit flags after the move ends.
    const clearChildEditFlags = (aItem: SCH_ITEM): void => {
      aItem.RunOnChildren((aChild: SCH_ITEM) => {
        aChild.ClearEditFlags();
      }, RECURSE_MODE.RECURSE);
    };

    for (const item of this.m_frame!.GetScreen()!.Items()) {
      item.ClearEditFlags();
      clearChildEditFlags(item);
    }

    // Ensure any selected item not in screen main list (for instance symbol fields) has its
    // edit flags cleared
    for (const item of selectionCopy.GetItems()) {
      item.ClearEditFlags();

      if (item instanceof SCH_ITEM) clearChildEditFlags(item);
    }

    this.m_newDragLines.clear();
    this.m_changedDragLines.clear();

    if (aUnselect) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    else this.m_selectionTool!.RebuildSelection(); // Schematic cleanup might have merged lines, etc.
  }

  private moveSelectionToSheet(
    aSelection: SCH_SELECTION,
    aTargetSheet: SCH_SHEET,
    aCommit: SCH_COMMIT,
  ): void {
    const destScreen = aTargetSheet.GetScreen()!;
    const srcScreen = this.m_frame!.GetScreen()!;

    const bbox = new BOX2I();

    for (const item of aSelection.GetItems()) bbox.Merge((item as SCH_ITEM).GetBoundingBox());

    let offset = vsub(v(0, 0), bbox.GetPosition());
    const step = schIUScale.milsToIU(50);
    let overlap = false;

    do {
      const moved = bbox.Clone();
      moved.Move(offset);
      overlap = false;

      for (const existing of destScreen.Items()) {
        if (moved.Intersects(existing.GetBoundingBox())) {
          overlap = true;
          break;
        }
      }

      if (overlap) offset = vadd(offset, v(step, step));
    } while (overlap);

    for (const item of aSelection.GetItems()) {
      const schItem = item as SCH_ITEM;

      // Remove from current screen and view manually
      this.m_frame!.RemoveFromScreen(schItem, srcScreen);

      // Move the item
      schItem.Move(offset);

      // Add to destination screen manually (won't add to view since it's not current)
      destScreen.Append(schItem);

      // Record in commit with CHT_DONE flag to bypass automatic screen/view operations
      aCommit.Stage(schItem, CHANGE_TYPE.CHT_REMOVE | CHANGE_TYPE.CHT_DONE, srcScreen);
      aCommit.Stage(schItem, CHANGE_TYPE.CHT_ADD | CHANGE_TYPE.CHT_DONE, destScreen);
    }
  }

  /** Cleanup dangling lines left after a drag. */
  private trimDanglingLines(aCommit: SCH_COMMIT): void {
    // Need a local cleanup first to ensure we remove unneeded junctions
    this.m_frame!.Schematic().CleanUp(aCommit, this.m_frame!.GetScreen());

    const danglers = new Set<SCH_ITEM>();

    const changeHandler = (aChangedItem: SCH_ITEM): void => {
      this.m_toolMgr!.GetView()!.Update(aChangedItem, VIEW_UPDATE_FLAGS.REPAINT);

      if (aChangedItem.IsSelected()) return;

      const line = aChangedItem instanceof SCH_LINE ? aChangedItem : null;

      if (!line) return;

      // Split segments that are dangling get trimmed back since they extend
      // past the break point.
      if (line.HasFlag(IS_BROKEN) && line.IsDangling()) {
        danglers.add(aChangedItem);
      }
      // Drag wires that are completely disconnected (both ends dangling) are
      // stubs that should be removed. Wires with only one connected end are
      // still providing connectivity and must be preserved.
      else if (
        line.HasFlag(IS_NEW) &&
        !line.HasFlag(IS_BROKEN) &&
        line.IsStartDangling() &&
        line.IsEndDangling()
      ) {
        danglers.add(aChangedItem);
      }
    };

    this.m_frame!.GetScreen()!.TestDanglingEnds(null, changeHandler);

    for (const line of danglers) {
      line.SetFlags(STRUCT_DELETED);
      aCommit.Removed(line, this.m_frame!.GetScreen());
      this.updateItem(line, false); // Update any cached visuals before commit processes
      this.m_frame!.RemoveFromScreen(line, this.m_frame!.GetScreen());
    }
  }

  /**
   * Find additional items for a drag operation. Connected items with no wire are included (as
   * there is no wire to adjust for the drag). Connected wires are included with any un-connected
   * ends flagged (STARTPOINT or ENDPOINT).
   */
  private getConnectedItems(aOriginalItem: SCH_ITEM, aPoint: VECTOR2I, aList: EDA_ITEM[]): void {
    const items = this.m_frame!.GetScreen()!.Items();
    const itemsOverlapping = items.Overlapping(aOriginalItem.GetBoundingBox());
    let foundJunction: SCH_ITEM | null = null;
    let foundSymbol: SCH_ITEM | null = null;

    // If you're connected to a junction, you're only connected to the junction.
    //
    // But, if you're connected to a junction on a pin, you're only connected to the pin. This
    // is because junctions and pins have different logic for how bend lines are generated and
    // we need to prioritize the pin version in some cases.
    for (const item of itemsOverlapping) {
      if (item !== aOriginalItem && item.IsConnected(aPoint)) {
        if (item.Type() === KICAD_T.SCH_JUNCTION_T) foundJunction = item;
        else if (item.Type() === KICAD_T.SCH_SYMBOL_T) foundSymbol = item;
      }
    }

    if (foundSymbol && foundJunction) {
      aList.push(foundSymbol);
      return;
    }

    if (foundJunction) {
      aList.push(foundJunction);
      return;
    }

    for (const test of itemsOverlapping) {
      if (test === aOriginalItem || !test.CanConnect(aOriginalItem)) continue;

      switch (test.Type()) {
        case KICAD_T.SCH_LINE_T: {
          const line = test as SCH_LINE;

          // When getting lines for the connection cache, it's important that we only add
          // items at the unselected end, since that is the only end that is handled specially.
          // Fully selected lines, and the selected end of a partially selected line, are moved
          // around normally and don't care about their connections.
          if (
            (line.HasFlag(STARTPOINT) && veq(aPoint, line.GetStartPoint())) ||
            (line.HasFlag(ENDPOINT) && veq(aPoint, line.GetEndPoint()))
          ) {
            continue;
          }

          if (test.IsConnected(aPoint)) aList.push(test);

          // Labels can connect to a wire (or bus) anywhere along the length
          if (aOriginalItem instanceof SCH_LABEL_BASE) {
            if ((test as SCH_LINE).HitTest(aOriginalItem.GetPosition(), 1)) aList.push(test);
          }

          break;
        }

        case KICAD_T.SCH_SHEET_T:
          if (aOriginalItem.Type() === KICAD_T.SCH_LINE_T) {
            const line = aOriginalItem as SCH_LINE;

            for (const pin of (test as SCH_SHEET).GetPins()) {
              if (pin.IsConnected(aPoint)) {
                if (pin.IsSelected())
                  this.m_specialCaseSheetPins.set(pin, [line, veq(line.GetStartPoint(), aPoint)]);

                aList.push(pin);
              }
            }
          }

          break;

        case KICAD_T.SCH_SYMBOL_T:
        case KICAD_T.SCH_JUNCTION_T:
        case KICAD_T.SCH_NO_CONNECT_T:
          if (test.IsConnected(aPoint)) aList.push(test);

          break;

        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_DIRECTIVE_LABEL_T:
          // Labels can connect to a wire (or bus) anywhere along the length
          if (aOriginalItem.Type() === KICAD_T.SCH_LINE_T && test.CanConnect(aOriginalItem)) {
            const label = test as SCH_LABEL_BASE;
            const line = aOriginalItem as SCH_LINE;

            if (line.HitTest(label.GetPosition(), 1)) aList.push(label);
          }

          break;

        case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
        case KICAD_T.SCH_BUS_BUS_ENTRY_T:
          if (aOriginalItem.Type() === KICAD_T.SCH_LINE_T && test.CanConnect(aOriginalItem)) {
            const label = test as unknown as SCH_TEXT;
            const line = aOriginalItem as SCH_LINE;

            if (line.HitTest(aPoint, 1)) aList.push(label);
          }

          break;

        default:
          break;
      }
    }
  }

  private getConnectedDragItems(
    aCommit: SCH_COMMIT,
    aSelectedItem: SCH_ITEM,
    aPoint: VECTOR2I,
    aList: EDA_ITEM[],
  ): void {
    const items = this.m_frame!.GetScreen()!.Items();
    // std::set<SCH_ITEM*>: membership only; the candidates' order does not reach the result
    // beyond which item makes the one new wire, which the C++ also leaves to pointer order.
    const connectableCandidates = new Set<SCH_ITEM>();
    const itemsConnectable: SCH_ITEM[] = [];
    let ptHasUnselectedJunction = false;

    for (const item of items.Overlapping(aSelectedItem.GetBoundingBox()))
      connectableCandidates.add(item);

    // Labels can connect at their anchor even if the label bbox doesn't overlap the target, e.g.
    // sheet pins can do this sometimes with just net labels and no wires.
    if (aSelectedItem instanceof SCH_LABEL_BASE) {
      for (const item of items.Overlapping(aPoint, 1)) connectableCandidates.add(item);
    }

    const makeNewWire = (
      commit: SCH_COMMIT,
      fixed: SCH_ITEM,
      selected: SCH_ITEM,
      start: VECTOR2I,
      end: VECTOR2I,
    ): SCH_LINE => {
      let newWire: SCH_LINE;
      let isBusLabel = false;

      if (fixed instanceof SCH_LABEL_BASE)
        isBusLabel ||= SCH_CONNECTION.IsBusLabel(fixed.GetText());

      if (selected instanceof SCH_LABEL_BASE)
        isBusLabel ||= SCH_CONNECTION.IsBusLabel(selected.GetText());

      // Add a new newWire between the fixed item and the selected item so the selected
      // item can be dragged.
      if (
        fixed.GetLayer() === SCH_LAYER_ID.LAYER_BUS_JUNCTION ||
        fixed.GetLayer() === SCH_LAYER_ID.LAYER_BUS ||
        selected.GetLayer() === SCH_LAYER_ID.LAYER_BUS ||
        isBusLabel
      ) {
        newWire = new SCH_LINE(start, SCH_LAYER_ID.LAYER_BUS);
      } else {
        newWire = new SCH_LINE(start, SCH_LAYER_ID.LAYER_WIRE);
      }

      newWire.SetFlags(IS_NEW);
      newWire.SetConnectivityDirty(true);

      const selectedLine = selected instanceof SCH_LINE ? selected : null;
      const fixedLine = fixed instanceof SCH_LINE ? fixed : null;

      if (selectedLine) {
        newWire.SetLastResolvedState(selected);
        cloneWireConnection(newWire, selectedLine, this.m_frame);
      } else if (fixedLine) {
        newWire.SetLastResolvedState(fixed);
        cloneWireConnection(newWire, fixedLine, this.m_frame);
      }

      newWire.SetEndPoint(end);
      this.m_frame!.AddToScreen(newWire, this.m_frame!.GetScreen());
      commit.Added(newWire, this.m_frame!.GetScreen());

      return newWire;
    };

    const makeNewJunction = (commit: SCH_COMMIT, line: SCH_LINE, pt: VECTOR2I): SCH_JUNCTION => {
      const junction = new SCH_JUNCTION(pt);
      junction.SetFlags(IS_NEW);
      junction.SetConnectivityDirty(true);
      junction.SetLastResolvedState(line);

      if (line.IsBus()) junction.SetLayer(SCH_LAYER_ID.LAYER_BUS_JUNCTION);

      this.m_frame!.AddToScreen(junction, this.m_frame!.GetScreen());
      commit.Added(junction, this.m_frame!.GetScreen());

      return junction;
    };

    for (const item of connectableCandidates) {
      if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const sheet = item as SCH_SHEET;

        // A sheet inside a selected group moves with the group, so its pins should not be
        // treated as fixed connection anchors.
        if (sheet.HasSelectedAncestorGroup()) continue;

        for (const pin of sheet.GetPins()) {
          if (!pin.IsSelected() && veq(pin.GetPosition(), aPoint) && pin.CanConnect(aSelectedItem))
            itemsConnectable.push(pin);
        }

        continue;
      }

      // Skip ourselves, skip already selected items (but not lines, they need both ends tested)
      // and skip unconnectable items. Items inside a selected group are also moving with the
      // selection even though they do not carry the SELECTED flag themselves; treating them as
      // fixed anchors causes spurious stub wires to be created at the group boundary.
      if (
        item === aSelectedItem ||
        (item.Type() !== KICAD_T.SCH_LINE_T &&
          (item.IsSelected() || item.HasSelectedAncestorGroup())) ||
        !item.CanConnect(aSelectedItem)
      ) {
        continue;
      }

      itemsConnectable.push(item);
    }

    for (const item of itemsConnectable) {
      if (
        item.Type() === KICAD_T.SCH_JUNCTION_T &&
        item.IsConnected(aPoint) &&
        !item.IsSelected()
      ) {
        ptHasUnselectedJunction = true;
        break;
      }
    }

    let newWire: SCH_LINE | null = null;

    for (const test of itemsConnectable) {
      const testType = test.Type();

      switch (testType) {
        case KICAD_T.SCH_LINE_T: {
          // Select the connected end of wires/bus connections that don't have an unselected
          // junction isolating them from the drag
          if (ptHasUnselectedJunction) break;

          const line = test as SCH_LINE;

          // A line that is itself a member of a selected group is already moving with that
          // group; do not add it as a drag attachment or it will move twice.
          const lineInSelectedGroup = line.HasSelectedAncestorGroup();

          if (veq(line.GetStartPoint(), aPoint)) {
            // It's possible to manually select one end of a line and get a drag
            // connected other end, so we set the flag and then early exit the loop
            // later if the other drag items like labels attached to the line have
            // already been grabbed during the partial selection process.
            if (!lineInSelectedGroup) line.SetFlags(STARTPOINT);

            if (line.HasFlag(SELECTED) || line.HasFlag(SELECTED_BY_DRAG) || lineInSelectedGroup) {
              continue;
            } else {
              line.SetFlags(SELECTED_BY_DRAG);
              aList.push(line);
            }
          } else if (veq(line.GetEndPoint(), aPoint)) {
            if (!lineInSelectedGroup) line.SetFlags(ENDPOINT);

            if (line.HasFlag(SELECTED) || line.HasFlag(SELECTED_BY_DRAG) || lineInSelectedGroup) {
              continue;
            } else {
              line.SetFlags(SELECTED_BY_DRAG);
              aList.push(line);
            }
          } else {
            switch (aSelectedItem.Type()) {
              // These items can connect anywhere along a line
              case KICAD_T.SCH_BUS_BUS_ENTRY_T:
              case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
              case KICAD_T.SCH_LABEL_T:
              case KICAD_T.SCH_HIER_LABEL_T:
              case KICAD_T.SCH_GLOBAL_LABEL_T:
              case KICAD_T.SCH_DIRECTIVE_LABEL_T:
                // Only add a line if this line is unselected; if the label and line are both
                // selected they'll move together
                if (
                  line.HitTest(aPoint, 1) &&
                  !line.HasFlag(SELECTED) &&
                  !line.HasFlag(SELECTED_BY_DRAG)
                ) {
                  newWire = makeNewWire(aCommit, line, aSelectedItem, aPoint, aPoint);
                  newWire.SetFlags(SELECTED_BY_DRAG | STARTPOINT);
                  newWire.StoreAngle(line.Angle().add(ANGLE_90).Normalize());
                  aList.push(newWire);

                  if (!veq(aPoint, line.GetStartPoint()) && !veq(aPoint, line.GetEndPoint())) {
                    // Split line in half
                    aCommit.Modify(line, this.m_frame!.GetScreen());

                    const oldEnd = line.GetEndPoint();
                    line.SetEndPoint(aPoint);

                    makeNewWire(aCommit, line, line, aPoint, oldEnd);
                    makeNewJunction(aCommit, line, aPoint);
                  } else {
                    this.m_lineConnectionCache.set(newWire, [line]);
                    this.m_lineConnectionCache.set(line, [newWire]);
                  }
                }
                break;

              default:
                break;
            }

            break;
          }

          // When only one end moves, keep attached labels tracking the moving end so they stay
          // connected to the line.
          for (const item of items.Overlapping(line.GetBoundingBox())) {
            const label = item instanceof SCH_LABEL_BASE ? item : null;

            if (!label || label.IsSelected()) continue; // These will be moved on their own because they're selected

            if (label.HasFlag(SELECTED_BY_DRAG)) continue;

            if (label.CanConnect(line) && line.HitTest(label.GetPosition(), 1)) {
              label.SetFlags(SELECTED_BY_DRAG);
              aList.push(label);

              this.m_specialCaseLabels.set(label, {
                attachedLine: line,
                originalLabelPos: label.GetPosition(),
                originalLineStart: line.GetStartPoint(),
                originalLineEnd: line.GetEndPoint(),
                trackMovingEnd: false,
              });
            }
          }

          break;
        }

        case KICAD_T.SCH_SHEET_T:
          for (const pin of (test as SCH_SHEET).GetPins()) {
            if (pin.IsConnected(aPoint)) {
              if (pin.IsSelected() && aSelectedItem.Type() === KICAD_T.SCH_LINE_T) {
                const line = aSelectedItem as SCH_LINE;
                this.m_specialCaseSheetPins.set(pin, [line, veq(line.GetStartPoint(), aPoint)]);
              } else if (!newWire) {
                // Add a new wire between the sheetpin and the selected item so the
                // selected item can be dragged.
                newWire = makeNewWire(aCommit, pin, aSelectedItem, aPoint, aPoint);
                newWire.SetFlags(SELECTED_BY_DRAG | STARTPOINT);
                aList.push(newWire);
              }
            }
          }

          break;

        case KICAD_T.SCH_SYMBOL_T:
        case KICAD_T.SCH_JUNCTION_T:
          if (test.IsConnected(aPoint) && !newWire) {
            // Add a new wire between the symbol or junction and the selected item so
            // the selected item can be dragged.
            newWire = makeNewWire(aCommit, test, aSelectedItem, aPoint, aPoint);
            newWire.SetFlags(SELECTED_BY_DRAG | STARTPOINT);
            aList.push(newWire);
          }

          break;

        case KICAD_T.SCH_NO_CONNECT_T:
          // Select no-connects that are connected to items being moved.
          if (!test.HasFlag(SELECTED_BY_DRAG) && test.IsConnected(aPoint)) {
            aList.push(test);
            test.SetFlags(SELECTED_BY_DRAG);
          }

          break;

        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_DIRECTIVE_LABEL_T:
        case KICAD_T.SCH_SHEET_PIN_T:
          // Performance optimization:
          if (test.HasFlag(SELECTED_BY_DRAG)) break;

          // Select labels that are connected to a wire (or bus) being moved.
          if (aSelectedItem.Type() === KICAD_T.SCH_LINE_T && test.CanConnect(aSelectedItem)) {
            const label = test as SCH_LABEL_BASE;
            const line = aSelectedItem as SCH_LINE;

            const oneEndFixed = !line.HasFlag(STARTPOINT) || !line.HasFlag(ENDPOINT);

            if (line.HitTest(label.GetTextPos(), 1)) {
              if (
                (!line.HasFlag(STARTPOINT) && veq(label.GetPosition(), line.GetStartPoint())) ||
                (!line.HasFlag(ENDPOINT) && veq(label.GetPosition(), line.GetEndPoint()))
              ) {
                //If we have a line selected at only one end, don't grab labels
                //connected directly to the unselected endpoint
                break;
              } else {
                label.SetFlags(SELECTED_BY_DRAG);
                aList.push(label);

                if (oneEndFixed) {
                  this.m_specialCaseLabels.set(label, {
                    attachedLine: line,
                    originalLabelPos: label.GetPosition(),
                    originalLineStart: line.GetStartPoint(),
                    originalLineEnd: line.GetEndPoint(),
                    trackMovingEnd: false,
                  });
                }
              }
            }
          } else if (test.IsConnected(aPoint) && !newWire) {
            // Add a new wire between the label and the selected item so the selected item
            // can be dragged.
            newWire = makeNewWire(aCommit, test, aSelectedItem, aPoint, aPoint);
            newWire.SetFlags(SELECTED_BY_DRAG | STARTPOINT);
            aList.push(newWire);
          }

          break;

        case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
        case KICAD_T.SCH_BUS_BUS_ENTRY_T:
          // Performance optimization:
          if (test.HasFlag(SELECTED_BY_DRAG)) break;

          // Select bus entries that are connected to a bus being moved.
          if (aSelectedItem.Type() === KICAD_T.SCH_LINE_T && test.CanConnect(aSelectedItem)) {
            const line = aSelectedItem as SCH_LINE;

            if (
              (!line.HasFlag(STARTPOINT) && test.IsConnected(line.GetStartPoint())) ||
              (!line.HasFlag(ENDPOINT) && test.IsConnected(line.GetEndPoint()))
            ) {
              // If we have a line selected at only one end, don't grab bus entries
              // connected directly to the unselected endpoint
              continue;
            }

            for (const point of test.GetConnectionPoints()) {
              if (line.HitTest(point, 1)) {
                test.SetFlags(SELECTED_BY_DRAG);
                aList.push(test);

                // A bus entry needs its wire & label as well
                const ends = test.GetConnectionPoints();
                let otherEnd: VECTOR2I;

                if (veq(ends[0]!, point)) otherEnd = ends[1]!;
                else otherEnd = ends[0]!;

                this.getConnectedDragItems(aCommit, test, otherEnd, aList);

                // No need to test the other end of the bus entry
                break;
              }
            }
          }

          break;

        default:
          break;
      }
    }
  }

  private moveItem(aItem: EDA_ITEM, aDelta: VECTOR2I): void {
    switch (aItem.Type()) {
      case KICAD_T.SCH_LINE_T:
        if (this.m_mode === MOVE_MODE.MOVE) {
          // In MOVE mode, both endpoints always move
          (aItem as SCH_LINE).Move(aDelta);
        } else {
          // In DRAG mode, only flagged endpoints move - use shared function
          MoveSchematicItem(aItem, aDelta);
        }

        break;

      case KICAD_T.SCH_PIN_T:
      case KICAD_T.SCH_FIELD_T: {
        const parent = aItem.GetParent() as SCH_ITEM | null;
        let delta = aDelta;

        if (parent && parent.Type() === KICAD_T.SCH_SYMBOL_T) {
          const symbol = parent as SCH_SYMBOL;
          const transform = symbol.GetTransform().InverseTransform();

          delta = transform.TransformCoordinate(delta);
        }

        (aItem as SCH_ITEM).Move(delta);

        // If we're moving a field with respect to its parent then it's no longer auto-placed
        if (aItem.Type() === KICAD_T.SCH_FIELD_T && parent && !parent.IsSelected())
          parent.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

        break;
      }

      case KICAD_T.SCH_SHEET_PIN_T:
        // Use shared function for sheet pin movement
        MoveSchematicItem(aItem, aDelta);
        break;

      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_DIRECTIVE_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T: {
        const label = aItem as SCH_LABEL_BASE;
        if (!this.m_specialCaseLabels.has(label)) label.Move(aDelta);

        break;
      }

      default:
        (aItem as SCH_ITEM).Move(aDelta);
        break;
    }

    aItem.SetFlags(IS_MOVING);
  }

  /** Align selected elements to the grid. */
  AlignToGrid(_aEvent: TOOL_EVENT): number {
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const selection = this.m_selectionTool!.RequestSelection(SCH_COLLECTOR.MovableItems);
    const selectionGrid = grid.GetSelectionGrid(selection);
    const commit = new SCH_COMMIT(this.m_toolMgr!);

    const doMoveItem = (item: EDA_ITEM, delta: VECTOR2I): void => {
      commit.Modify(item, this.m_frame!.GetScreen(), RECURSE_MODE.RECURSE);

      // Ensure only one end is moved when calling moveItem
      // i.e. we are in drag mode
      const tmpMode = this.m_mode;
      this.m_mode = MOVE_MODE.DRAG;
      this.moveItem(item, delta);
      this.m_mode = tmpMode;

      item.ClearFlags(IS_MOVING);
      this.updateItem(item, true);
    };

    for (const it of this.m_frame!.GetScreen()!.Items()) {
      if (!it.IsSelected()) it.ClearFlags(STARTPOINT | ENDPOINT);

      if (!selection.IsHover() && it.IsSelected()) it.SetFlags(STARTPOINT | ENDPOINT);

      it.SetStoredPos(it.GetPosition());

      if (it.Type() === KICAD_T.SCH_SHEET_T) {
        for (const pin of (it as SCH_SHEET).GetPins()) pin.SetStoredPos(pin.GetPosition());
      }
    }

    const callbacks: SCH_ALIGNMENT_CALLBACKS = {
      m_doMoveItem: doMoveItem,
      m_getConnectedDragItems: (aItem, aPoint, aList) => {
        this.getConnectedDragItems(commit, aItem, aPoint, aList);
      },
      m_updateItem: (aItem) => {
        this.updateItem(aItem, true);
      },
    };

    this.recordRedundantJunctions(selection);

    const items = [...selection.GetItems()];
    AlignSchematicItemsToGrid(this.m_frame!.GetScreen()!, items, grid, selectionGrid, callbacks);

    const lwbTool = this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;
    lwbTool.TrimOverLappingWires(commit, selection);
    this.migrateHiddenJunctions(commit);
    lwbTool.AddJunctionsIfNeeded(commit, selection);

    this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsMoved);

    this.m_frame!.Schematic().CleanUp(commit);
    commit.Push('Align Items to Grid');
    return 0;
  }

  /** Clears the new drag lines and removes them from the screen. */
  private clearNewDragLines(): void {
    // Remove new bend lines added during the drag
    for (const newLine of this.m_newDragLines)
      this.m_frame!.RemoveFromScreen(newLine, this.m_frame!.GetScreen());

    this.m_newDragLines.clear();
  }

  /** `getViewControls()`, with the VIEW_CONTROLS methods the TOOL_MANAGER's interface leaves out. */
  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  protected override setTransitions(): void {
    this.Go(this.Main, SCH_ACTIONS.move.MakeEvent());
    this.Go(this.Main, SCH_ACTIONS.drag.MakeEvent());
    this.Go(this.Main, SCH_ACTIONS.breakWire.MakeEvent());
    this.Go(this.Main, SCH_ACTIONS.slice.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignToGrid), SCH_ACTIONS.alignToGrid.MakeEvent());
  }
}
