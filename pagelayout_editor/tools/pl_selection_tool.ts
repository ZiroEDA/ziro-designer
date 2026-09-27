// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/tools/pl_selection_tool.h` + `pl_selection_tool.cpp`:
 * `PL_SELECTION_TOOL`, the Drawing Sheet Editor's selection on the shared
 * `SELECTION_TOOL` - click, box, the disambiguation menu, and the context
 * menu the standard zoom / grid submenus hang off.
 */

import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { COLLECTOR } from '@ziroeda/common/collector.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { BRIGHTENED, SELECTED } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { MOUSE_DRAG_ACTION } from '@ziroeda/common/mouse_drag_action.js';
import { SELECTION_AREA } from '@ziroeda/common/preview_items/selection_area.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import { SELECTION_MODE, SELECTION_TOOL } from '@ziroeda/common/tool/selection_tool.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  BUT_LEFT,
  BUT_MIDDLE,
  BUT_RIGHT,
  EVENTS,
  MD_ALT,
  MD_CTRL,
  MD_SHIFT,
  TA_UNDO_REDO_PRE,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { wxGetKeyState } from '@ziroeda/common/wx/wx_event.js';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { PL_EDITOR_FRAME } from '../pl_editor_frame.js';
import { PL_ACTIONS } from './pl_actions.js';
import { PL_POINT_EDITOR } from './pl_point_editor.js';
import { PL_SELECTION } from './pl_selection.js';

/** `#define HITTEST_THRESHOLD_PIXELS 3` (pl_selection_tool.cpp:43). [data] */
const HITTEST_THRESHOLD_PIXELS = 3;

export class PL_SELECTION_TOOL extends SELECTION_TOOL {
  private m_frame: PL_EDITOR_FRAME | null; // Pointer to the parent frame
  private m_selection = new PL_SELECTION(); // Current state of selection

  constructor() {
    super('common.InteractiveSelection');
    this.m_frame = null;
  }

  /**
   * `getViewControls()` as the `VIEW_CONTROLS` it is: the manager's type
   * names only the calls the manager itself makes (STRUCTURE.md).
   */
  private viewControls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /// @copydoc TOOL_BASE::Init()
  override Init(): boolean {
    this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();

    const menu = this.m_menu.GetMenu();

    menu.AddSeparator(200);
    menu.AddItem(PL_ACTIONS.drawLine, SELECTION_CONDITIONS.Empty, 200);
    menu.AddItem(PL_ACTIONS.drawRectangle, SELECTION_CONDITIONS.Empty, 200);
    menu.AddItem(PL_ACTIONS.placeText, SELECTION_CONDITIONS.Empty, 200);
    menu.AddItem(PL_ACTIONS.placeImage, SELECTION_CONDITIONS.Empty, 200);

    menu.AddSeparator(1000);
    this.m_frame.AddStandardSubMenus(this.m_menu);

    // m_disambiguateTimer's owner is set by SELECTION_TOOL's constructor.

    return true;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  Reset(aReason: RESET_REASON): void {
    if (aReason === RESET_REASON.MODEL_RELOAD) this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
  }

  *Main(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      // on left click, a selection is made, depending on modifiers ALT, SHIFT, CTRL:
      this.setModifiersState(
        evt.Modifier(MD_SHIFT) !== 0,
        evt.Modifier(MD_CTRL) !== 0,
        evt.Modifier(MD_ALT) !== 0,
      );

      if (evt.IsMouseDown(BUT_LEFT)) {
        // Avoid triggering when running under other tools
        const pt_tool = this.m_toolMgr!.GetTool(PL_POINT_EDITOR);

        if (frame.ToolStackIsEmpty() && pt_tool && !pt_tool.HasPoint()) {
          this.m_originalCursor = this.m_toolMgr!.GetMousePosition();
          this.m_disambiguateTimer.StartOnce(ADVANCED_CFG.GetCfg().m_DisambiguationMenuDelay);
        }
      }
      // Single click? Select single object
      else if (evt.IsClick(BUT_LEFT)) {
        // If the timer has stopped, then we have already run the disambiguate routine
        // and we don't want to register an extra click here
        if (!this.m_disambiguateTimer.IsRunning()) {
          evt.SetPassEvent();
          continue;
        }

        this.m_disambiguateTimer.Stop();
        yield* this.SelectPoint(evt.Position());
      }

      // right click? if there is any object - show the context menu
      else if (evt.IsClick(BUT_RIGHT)) {
        this.m_disambiguateTimer.Stop();
        const selectionCancelled = { value: false };

        if (this.m_selection.Empty()) {
          yield* this.SelectPoint(evt.Position(), selectionCancelled);
          this.m_selection.SetIsHover(true);
        }

        // Show selection before opening menu
        frame.GetCanvas()!.ForceRefresh();

        if (!selectionCancelled.value) this.m_menu.ShowContextMenu(this.m_selection);
      }

      // double click? Display the properties window
      else if (evt.IsDblClick(BUT_LEFT)) {
        // No double-click actions currently defined
      }

      // drag with LMB? Select multiple objects (or at least draw a selection box) or drag them
      else if (evt.IsDrag(BUT_LEFT)) {
        this.m_disambiguateTimer.Stop();

        if (this.hasModifier() || this.m_selection.Empty()) {
          yield* this.selectMultiple();
        } else {
          // Check if dragging has started within any of selected items bounding box
          if (this.selectionContains(evt.Position())) {
            // Yes -> run the move tool and wait till it finishes
            this.m_toolMgr!.RunAction('plEditor.InteractiveMove.move');
          } else {
            // No -> clear the selection list
            this.ClearSelection();
          }
        }
      }

      // Middle double click?  Do zoom to fit or zoom to objects
      else if (evt.IsDblClick(BUT_MIDDLE)) {
        this.m_toolMgr!.RunAction(ACTIONS.zoomFitScreen);
      } else if (evt.IsCancelInteractive()) {
        this.m_disambiguateTimer.Stop();
        this.ClearSelection();
      } else if (evt.Action() === TA_UNDO_REDO_PRE) {
        this.ClearSelection();
      } else evt.SetPassEvent();

      if (frame.ToolStackIsEmpty()) {
        if (
          !this.hasModifier() &&
          !this.m_selection.Empty() &&
          frame.GetDragAction() === MOUSE_DRAG_ACTION.DRAG_SELECTED &&
          evt.HasPosition() &&
          this.selectionContains(evt.Position())
        ) {
          frame.GetCanvas()!.SetCurrentCursor(KICURSOR.MOVING);
        } else {
          if (this.m_additive) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ADD);
          else if (this.m_subtractive) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.SUBTRACT);
          else if (this.m_exclusive_or) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.XOR);
          else frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
        }
      }
    }

    return 0;
  }

  private *disambiguateCursor(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    // wxGetMouseState()'s modifiers: the platform's key state, which the
    // panel feeds from every DOM event (wx/wx_event.ts).
    this.setModifiersState(
      wxGetKeyState(WXK.WXK_SHIFT),
      wxGetKeyState(WXK.WXK_CONTROL),
      wxGetKeyState(WXK.WXK_ALT),
    );

    this.m_skip_heuristics = true;
    const cancelled = { value: false };
    yield* this.SelectPoint(this.m_originalCursor, cancelled);
    this.m_canceledMenu = cancelled.value;
    this.m_skip_heuristics = false;

    return 0;
  }

  override GetSelection(): PL_SELECTION {
    return this.m_selection;
  }

  /**
   * Return either an existing selection (filtered), or the selection at the current
   * cursor if the existing selection is empty.
   */
  *RequestSelection(): COROUTINE_BODY<PL_SELECTION> {
    // If nothing is selected do a hover selection
    if (this.m_selection.Empty()) {
      const cursorPos = this.viewControls().GetCursorPosition(true);

      this.ClearSelection();
      yield* this.SelectPoint(cursorPos);
      this.m_selection.SetIsHover(true);
    }

    return this.m_selection;
  }

  /**
   * Select an item pointed by the parameter aWhere. If there is more than one item at that
   * place, there is a menu displayed that allows one to choose the item.
   *
   * @param aWhere is the place where the item should be selected.
   * @param aSelectionCancelledFlag allows the function to inform its caller that a selection
   *                                was cancelled (for instance, by clicking outside of the
   *                                disambiguation menu).
   */
  *SelectPoint(
    aWhere: VECTOR2I,
    aSelectionCancelledFlag: { value: boolean } | null = null,
  ): COROUTINE_BODY<void> {
    const threshold = KiROUND(this.getView()!.ToWorld(HITTEST_THRESHOLD_PIXELS));

    // locate items.
    const collector = new COLLECTOR();

    for (const dataItem of DS_DATA_MODEL.GetTheInstance().GetItems()) {
      for (const drawItem of dataItem.GetDrawItems()) {
        if (drawItem.HitTest(aWhere, threshold)) collector.Append(drawItem);
      }
    }

    this.m_selection.ClearReferencePoint();

    // Apply some ugly heuristics to avoid disambiguation menus whenever possible
    if (collector.GetCount() > 1 && !this.m_skip_heuristics)
      this.guessSelectionCandidates(collector, aWhere);

    // If still more than one item we're going to have to ask the user.
    if (collector.GetCount() > 1) {
      yield* this.doSelectionMenu(collector);

      if (collector.m_MenuCancelled) {
        if (aSelectionCancelledFlag) aSelectionCancelledFlag.value = true;

        return;
      }
    }

    let anyAdded = false;
    let anySubtracted = false;

    if (!this.m_additive && !this.m_subtractive && !this.m_exclusive_or) {
      if (collector.GetCount() === 0) anySubtracted = true;

      this.ClearSelection();
    }

    if (collector.GetCount() > 0) {
      for (let i = 0; i < collector.GetCount(); ++i) {
        const item = collector.At(i)!;

        if (this.m_subtractive || (this.m_exclusive_or && item.IsSelected())) {
          this.unselect(item);
          anySubtracted = true;
        } else {
          this.select(item);
          anyAdded = true;
        }
      }
    }

    if (anyAdded) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    if (anySubtracted) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
  }

  /**
   * Apply heuristics to try and determine a single object when multiple are found under the
   * cursor.
   */
  private guessSelectionCandidates(collector: COLLECTOR, aPos: VECTOR2I): void {
    // There are certain conditions that can be handled automatically.

    // Prefer an exact hit to a sloppy one
    for (let i = 0; collector.GetCount() === 2 && i < 2; ++i) {
      const item = collector.At(i)!;
      const other = collector.At((i + 1) % 2)!;

      if (item.HitTest(aPos, 0) && !other.HitTest(aPos, 0)) collector.Transfer(other);
    }
  }

  /**
   * Handle drawing a selection box that allows one to select many items at the same time.
   *
   * @return true if the function was canceled (i.e. CancelEvent was received).
   */
  private *selectMultiple(): COROUTINE_BODY<boolean> {
    const frame = this.m_frame!;
    let cancelled = false; // Was the tool cancelled while it was running?
    this.m_multiple = true; // Multiple selection mode is active
    const view = this.getView()!;

    const area = new SELECTION_AREA();
    view.Add(area);

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      /* Selection mode depends on direction of drag-selection:
       * Left > Right : Select objects that are fully enclosed by selection
       * Right > Left : Select objects that are crossed by selection
       */
      const windowSelection = area.GetEnd().x > area.GetOrigin().x;

      frame
        .GetCanvas()!
        .SetCurrentCursor(windowSelection ? KICURSOR.SELECT_WINDOW : KICURSOR.SELECT_LASSO);

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        cancelled = true;
        break;
      }

      if (evt.IsDrag(BUT_LEFT)) {
        if (!this.m_drag_additive && !this.m_drag_subtractive) this.ClearSelection();

        // Start drawing a selection box
        area.SetOrigin(evt.DragOrigin());
        area.SetEnd(evt.Position());
        area.SetAdditive(this.m_drag_additive);
        area.SetSubtractive(this.m_drag_subtractive);
        area.SetExclusiveOr(false);
        area.SetMode(
          windowSelection ? SELECTION_MODE.INSIDE_RECTANGLE : SELECTION_MODE.TOUCHING_RECTANGLE,
        );

        view.SetVisible(area, true);
        view.Update(area);
        this.viewControls().SetAutoPan(true);
      }

      if (evt.IsMouseUp(BUT_LEFT)) {
        this.viewControls().SetAutoPan(false);

        // End drawing the selection box
        view.SetVisible(area, false);

        let anyAdded = false;
        let anySubtracted = false;

        // Construct a BOX2I to determine EDA_ITEM selection
        const selectionRect = area.ViewBBox();

        selectionRect.Normalize();

        for (const dataItem of DS_DATA_MODEL.GetTheInstance().GetItems()) {
          for (const item of dataItem.GetDrawItems()) {
            if (item.HitTest(selectionRect, windowSelection)) {
              if (this.m_subtractive || (this.m_exclusive_or && item.IsSelected())) {
                this.unselect(item);
                anySubtracted = true;
              } else {
                this.select(item);
                anyAdded = true;
              }
            }
          }
        }

        // Inform other potentially interested tools
        if (anyAdded) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

        if (anySubtracted) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

        break; // Stop waiting for events
      }
    }

    this.viewControls().SetAutoPan(false);

    // Stop drawing the selection box
    view.Remove(area);
    this.m_multiple = false; // Multiple selection mode is inactive

    if (!cancelled) this.m_selection.ClearReferencePoint();

    return cancelled;
  }

  /** `int ClearSelection( const TOOL_EVENT& )`, the `selectionClear` action's handler. */
  ClearSelectionEvent(_aEvent: TOOL_EVENT): number {
    this.ClearSelection();
    return 0;
  }

  /**
   * Rebuild the selection from the flags in the view items.
   */
  RebuildSelection(): void {
    this.m_selection.Clear();

    for (const dataItem of DS_DATA_MODEL.GetTheInstance().GetItems()) {
      for (const item of dataItem.GetDrawItems()) {
        if (item.IsSelected()) this.select(item);
      }
    }
  }

  /**
   * Clear current selection event handler.
   */
  ClearSelection(): void {
    if (this.m_selection.Empty()) return;

    while (this.m_selection.GetSize())
      this.unhighlight(this.m_selection.Front()!, SELECTED, this.m_selection);

    this.getView()!.Update(this.m_selection);

    this.m_selection.SetIsHover(false);
    this.m_selection.ClearReferencePoint();

    // Inform other potentially interested tools
    this.m_toolMgr!.ProcessEvent(EVENTS.ClearedEvent);
  }

  protected selection(): SELECTION {
    return this.m_selection;
  }

  /**
   * Take necessary action mark an item as selected.
   */
  protected select(aItem: EDA_ITEM): void {
    this.highlight(aItem, SELECTED, this.m_selection);
  }

  /**
   * Take necessary action mark an item as unselected.
   */
  protected unselect(aItem: EDA_ITEM): void {
    this.unhighlight(aItem, SELECTED, this.m_selection);
  }

  /**
   * Highlight the item visually.
   */
  protected highlight(aItem: EDA_ITEM, aMode: number, aGroup?: SELECTION): void {
    if (aMode === SELECTED) aItem.SetSelected();
    else if (aMode === BRIGHTENED) aItem.SetBrightened();

    if (aGroup) aGroup.Add(aItem);

    this.getView()!.Update(aItem);
  }

  /**
   * Unhighlight the item visually.
   */
  protected unhighlight(aItem: EDA_ITEM, aMode: number, aGroup?: SELECTION): void {
    if (aMode === SELECTED) aItem.ClearSelected();
    else if (aMode === BRIGHTENED) aItem.ClearBrightened();

    if (aGroup) aGroup.Remove(aItem);

    this.getView()!.Update(aItem);
  }

  /**
   * @return true if the given point is contained in any of selected items' bounding boxes.
   */
  private selectionContains(aPoint: VECTOR2I): boolean {
    const GRIP_MARGIN = 20;
    const margin = this.getView()!.ToWorld({ x: GRIP_MARGIN, y: GRIP_MARGIN }, false);

    // Check if the point is located within any of the currently selected items bounding boxes
    for (const item of this.m_selection) {
      const itemBox = item.ViewBBox();
      itemBox.Inflate(margin.x, margin.y); // Give some margin for gripping an item

      if (itemBox.Contains(aPoint)) return true;
    }

    return false;
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.UpdateMenu), ACTIONS.updateMenu.MakeEvent());

    this.Go(this.Main, ACTIONS.selectionActivate.MakeEvent());
    this.Go(SYNC_HANDLER(this.ClearSelectionEvent), ACTIONS.selectionClear.MakeEvent());

    this.Go(SYNC_HANDLER(this.AddItemToSel), ACTIONS.selectItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.AddItemsToSel), ACTIONS.selectItems.MakeEvent());
    this.Go(SYNC_HANDLER(this.RemoveItemFromSel), ACTIONS.unselectItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.RemoveItemsFromSel), ACTIONS.unselectItems.MakeEvent());
    this.Go(this.SelectionMenu, ACTIONS.selectionMenu.MakeEvent());

    this.Go(this.disambiguateCursor, EVENTS.DisambiguatePoint);
  }
}
