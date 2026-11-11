// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDITOR_MOVE_TOOL` (eeschema/tools/symbol_editor_move_tool.{h,cpp}): the symbol editor's
 * interactive move of its selection, and Align Items to Grid.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IS_MOVING, IS_PASTED } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { ACTIONS, CURSOR_EVENT_TYPE } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  EVENTS,
  MD_SHIFT,
  SYNCRONOUS_TOOL_STATE,
  TA_UNDO_REDO_PRE,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { wxBell } from '@ziroeda/wx/utils.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_ITEM } from '../sch_item.js';
import { SCH_PIN } from '../sch_pin.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
import { SYMBOL_EDITOR_PIN_TOOL } from './symbol_editor_pin_tool.js';
import { _ } from '@ziroeda/wx/translation.js';

enum AXIS_LOCK {
  NONE,
  HORIZONTAL,
  VERTICAL,
}

const v = (x: number, y: number): VECTOR2I => ({ x, y });
const vadd = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const vsub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });

export class SYMBOL_EDITOR_MOVE_TOOL extends SCH_TOOL_BASE<SYMBOL_EDIT_FRAME> {
  private m_moveInProgress = false;

  ///< Last cursor position (needed for getModificationPoint() to avoid changes
  ///< of edit reference point).
  private m_cursor: VECTOR2I = v(0, 0);
  private m_anchorPos: VECTOR2I = v(0, 0);

  constructor() {
    super('eeschema.SymbolMoveTool');
  }

  override Init(): boolean {
    super.Init();

    //
    // Add move actions to the selection tool menu
    //
    const selToolMenu = this.m_selectionTool!.GetToolMenu().GetMenu();

    const canMove: SELECTION_CONDITION = (sel) => {
      const editor = this.m_frame;

      if (!editor) return false; // wxCHECK

      if (!editor.IsSymbolEditable()) return false;

      if (editor.IsSymbolAlias()) {
        for (const item of sel) {
          if (item.Type() !== KICAD_T.SCH_FIELD_T) return false;
        }
      }

      return true;
    };

    const { And } = SELECTION_CONDITIONS;

    selToolMenu.AddItem(SCH_ACTIONS.move, And(canMove, SELECTION_CONDITIONS.IdleSelection), 150);
    selToolMenu.AddItem(
      SCH_ACTIONS.alignToGrid,
      And(canMove, SELECTION_CONDITIONS.IdleSelection),
      150,
    );

    return true;
  }

  override Reset(aReason: RESET_REASON): void {
    super.Reset(aReason);

    if (aReason === RESET_REASON.MODEL_RELOAD) this.m_moveInProgress = false;
  }

  /** Run an interactive move of the selected items, or the item under the cursor. */
  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
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

      if (yield* this.doMoveSelection(aEvent, localCommit)) localCommit.Push(_('Move'));
      else localCommit.Revert();
    }

    return 0;
  }

  private *doMoveSelection(aEvent: TOOL_EVENT, aCommit: SCH_COMMIT): COROUTINE_BODY<boolean> {
    const controls = this.controls();
    const grid = new EE_GRID_HELPER(this.m_toolMgr!);
    const frame = this.m_frame!;

    this.m_anchorPos = v(0, 0);

    // Be sure that there is at least one item that we can move. If there's no selection try
    // looking for the stuff under mouse cursor (i.e. Kicad old-style hover selection).
    const selection = frame.IsSymbolAlias()
      ? this.m_selectionTool!.RequestSelection([KICAD_T.SCH_FIELD_T])
      : this.m_selectionTool!.RequestSelection();
    let unselect = selection.IsHover();

    if (!frame.IsSymbolEditable() || selection.Empty()) return false;

    if (this.m_moveInProgress) {
      // The tool hotkey is interpreted as a click when already moving
      this.m_toolMgr!.RunAction(ACTIONS.cursorClick);
      return true;
    }

    frame.PushTool(aEvent);

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.SetAutoPan(true);

    let restore_state = false;
    let evt: TOOL_EVENT | null = aEvent.clone();
    let prevPos = v(0, 0);
    let moveOffset = v(0, 0);

    // Axis locking for arrow key movement
    let axisLock = AXIS_LOCK.NONE;
    let lastArrowKeyAction = 0;

    aCommit.Modify(frame.GetCurSymbol()!, frame.GetScreen());

    this.m_cursor = controls.GetCursorPosition(!aEvent.DisableGridSnapping());

    // Main loop: keep receiving events
    do {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.MOVING);
      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

      if (
        evt.IsAction(SCH_ACTIONS.move) ||
        evt.IsMotion() ||
        evt.IsDrag(BUT_LEFT) ||
        evt.IsAction(ACTIONS.refreshPreview)
      ) {
        const snapLayer = grid.GetSelectionGrid(selection);

        if (!this.m_moveInProgress) {
          // Prepare to start moving/dragging
          let lib_item = selection.Front() as SCH_ITEM;

          // Pick up any synchronized pins
          //
          // Careful when pasting.  The pasted pin will be at the same location as it
          // was copied from, leading us to believe it's a synchronized pin.  It's not.
          if (frame.SynchronizePins() && !(lib_item.GetEditFlags() & IS_PASTED)) {
            const sync_pins = new Set<SCH_PIN>();

            for (const sel_item of selection) {
              lib_item = sel_item as SCH_ITEM;

              if (lib_item.Type() === KICAD_T.SCH_PIN_T) {
                const cur_pin = lib_item as SCH_PIN;
                const symbol = frame.GetCurSymbol()!;
                const got_unit: boolean[] = new Array(symbol.GetUnitCount() + 1).fill(false);

                got_unit[cur_pin.GetUnit()] = true;

                for (const pin of symbol.GetPins()) {
                  if (
                    !got_unit[pin.GetUnit()] &&
                    pin.GetPosition().x === cur_pin.GetPosition().x &&
                    pin.GetPosition().y === cur_pin.GetPosition().y &&
                    pin.GetOrientation() === cur_pin.GetOrientation() &&
                    pin.GetBodyStyle() === cur_pin.GetBodyStyle() &&
                    pin.GetType() === cur_pin.GetType() &&
                    pin.GetName() === cur_pin.GetName()
                  ) {
                    if (!sync_pins.has(pin)) {
                      sync_pins.add(pin);
                      got_unit[pin.GetUnit()] = true;
                    }
                  }
                }
              }
            }

            for (const pin of sync_pins)
              this.m_selectionTool!.AddItemToSel(pin, true /*quiet mode*/);
          }

          // Apply any initial offset in case we're coming from a previous command.
          //
          for (const item of selection) this.moveItem(item, moveOffset);

          // Set up the starting position and move/drag offset
          //
          this.m_cursor = controls.GetCursorPosition(!evt.DisableGridSnapping());

          if (lib_item.IsNew()) {
            this.m_anchorPos = selection.GetReferencePoint();
            const delta = vsub(this.m_cursor, this.m_anchorPos);

            // Drag items to the current cursor position
            for (const item of selection) {
              const schItem = item as SCH_ITEM;

              this.moveItem(schItem, delta);
              this.updateItem(schItem, false);

              // While SCH_COMMIT::Push() will add any new items to the entered group,
              // we need to do it earlier so that the previews while moving are correct.
              const enteredGroup = this.m_selectionTool!.GetEnteredGroup();

              if (enteredGroup) {
                if (schItem.IsGroupableType() && !item.GetParentGroup()) {
                  aCommit.Modify(enteredGroup, frame.GetScreen(), RECURSE_MODE.NO_RECURSE);
                  enteredGroup.AddItem(schItem);
                }
              }
            }

            this.m_anchorPos = this.m_cursor;
          } else if (frame.GetMoveWarpsCursor()) {
            // User wants to warp the mouse
            this.m_cursor = grid.BestDragOrigin(this.m_cursor, snapLayer, selection);
            selection.SetReferencePoint(this.m_cursor);
            this.m_anchorPos = this.m_cursor;
          } else {
            this.m_cursor = controls.GetCursorPosition(!evt.DisableGridSnapping());
            this.m_anchorPos = this.m_cursor;
          }

          controls.SetCursorPosition(this.m_cursor, false);

          prevPos = this.m_cursor;
          controls.SetAutoPan(true);
          this.m_moveInProgress = true;
        }

        //------------------------------------------------------------------------
        // Follow the mouse
        //
        // We need to bypass refreshPreview action here because it is triggered by the move,
        // so we were getting double-key events that toggled the axis locking if you
        // pressed them in a certain order.
        const vcSettings = controls.GetSettings();

        if (vcSettings.m_lastKeyboardCursorPositionValid && !evt.IsAction(ACTIONS.refreshPreview)) {
          const keyboardPos = vcSettings.m_lastKeyboardCursorPosition;
          const action = vcSettings.m_lastKeyboardCursorCommand;

          grid.SetSnap(false);
          this.m_cursor = grid.Align(keyboardPos, snapLayer);

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
            snapLayer,
            selection,
          );
        }

        if (axisLock === AXIS_LOCK.HORIZONTAL) this.m_cursor = v(this.m_cursor.x, prevPos.y);
        else if (axisLock === AXIS_LOCK.VERTICAL) this.m_cursor = v(prevPos.x, this.m_cursor.y);

        const delta = vsub(this.m_cursor, prevPos);
        this.m_anchorPos = this.m_cursor;

        moveOffset = vadd(moveOffset, delta);
        prevPos = this.m_cursor;

        for (const item of selection) {
          this.moveItem(item, delta);
          this.updateItem(item, false);
        }

        this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsMoved);
      }
      //------------------------------------------------------------------------
      // Handle cancel
      //
      else if (evt.IsCancelInteractive() || evt.IsActivate()) {
        if (this.m_moveInProgress) {
          evt.SetPassEvent(false);
          restore_state = true;
        }

        break;
      }
      //------------------------------------------------------------------------
      // Handle TOOL_ACTION special cases
      //
      else if (evt.Action() === TA_UNDO_REDO_PRE) {
        unselect = true;
        break;
      } else if (evt.IsAction(ACTIONS.doDelete)) {
        // Exit on a remove operation; there is no further processing for removed items.
        break;
      } else if (evt.IsAction(ACTIONS.duplicate)) {
        wxBell();
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
      else if (evt.IsMouseUp(BUT_LEFT) || evt.IsClick(BUT_LEFT) || evt.IsDblClick(BUT_LEFT)) {
        if (selection.GetSize() === 1 && selection.Front()!.Type() === KICAD_T.SCH_PIN_T) {
          const pinTool = this.m_toolMgr!.GetTool(SYMBOL_EDITOR_PIN_TOOL)!;
          const curr_pin = selection.Front() as SCH_PIN;

          if (yield* pinTool.PlacePin(aCommit, curr_pin, this)) {
            // PlacePin() clears the current selection, which we don't want.  Not only
            // is it a poor user experience, but it also prevents us from doing the
            // proper cleanup at the end of this routine (ie: clearing the edit flags).
            this.m_selectionTool!.AddItemToSel(curr_pin, true /*quiet mode*/);
          } else {
            restore_state = true;
          }
        }

        break; // Finish
      } else {
        evt.SetPassEvent();
      }
      // biome-ignore lint/suspicious/noAssignInExpressions: the C++ do/while fetches the next event in its condition
    } while ((evt = yield* this.Wait())); // Assignment intentional; not equality test

    controls.ForceCursorPosition(false);
    controls.ShowCursor(false);
    controls.SetAutoPan(false);

    this.m_anchorPos = v(0, 0);

    for (const item of selection) item.ClearEditFlags();

    if (unselect) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    this.m_moveInProgress = false;
    frame.PopTool(aEvent);

    return !restore_state;
  }

  /** Align selected elements to the grid. */
  AlignElements(_aEvent: TOOL_EVENT): number {
    const grid = new EE_GRID_HELPER(this.m_toolMgr!);
    const selection = this.m_selectionTool!.RequestSelection();
    const commit = new SCH_COMMIT(this.m_toolMgr!);

    for (const item of selection) {
      const newPos = grid.AlignGrid(item.GetPosition(), grid.GetItemGrid(item));
      const delta = vsub(newPos, item.GetPosition());

      if (delta.x !== 0 || delta.y !== 0) {
        commit.Modify(item, this.m_frame!.GetScreen(), RECURSE_MODE.RECURSE);
        (item as SCH_ITEM).Move(delta);
        this.updateItem(item, true);
      }

      if (item instanceof SCH_PIN) {
        const pin = item;
        const length = pin.GetLength();
        let pinGrid: number;

        if (
          pin.GetOrientation() === PIN_ORIENTATION.PIN_LEFT ||
          pin.GetOrientation() === PIN_ORIENTATION.PIN_RIGHT
        ) {
          pinGrid = KiROUND(grid.GetGridSize(grid.GetItemGrid(item)).x);
        } else {
          pinGrid = KiROUND(grid.GetGridSize(grid.GetItemGrid(item)).y);
        }

        const newLength = KiROUND(length / pinGrid) * pinGrid;

        if (newLength > 0) pin.SetLength(newLength);
      }
    }

    this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsMoved);

    commit.Push(_('Align Items to Grid'));
    return 0;
  }

  private moveItem(aItem: EDA_ITEM, aDelta: VECTOR2I): void {
    (aItem as SCH_ITEM).Move(aDelta);
    aItem.SetFlags(IS_MOVING);
  }

  /** `getViewControls()`, with the VIEW_CONTROLS methods the TOOL_MANAGER's interface leaves out. */
  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  protected override setTransitions(): void {
    this.Go(this.Main, SCH_ACTIONS.move.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignElements), SCH_ACTIONS.alignToGrid.MakeEvent());
  }
}
