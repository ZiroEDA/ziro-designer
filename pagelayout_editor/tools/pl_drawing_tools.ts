// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/tools/pl_drawing_tools.h` + `pl_drawing_tools.cpp`:
 * `PL_DRAWING_TOOLS`, the tool responsible for drawing/placing items (lines,
 * rectangles, text, images).
 */
import { type DS_DATA_ITEM, DS_ITEM_TYPE } from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import type { DS_DRAW_ITEM_BASE } from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import { IS_MOVING, IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  TA_ANY,
  TC_MESSAGE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { PL_EDITOR_FRAME } from '../pl_editor_frame.js';
import { PL_ACTIONS } from './pl_actions.js';
import { PL_SELECTION_TOOL } from './pl_selection_tool.js';

/** The message {@link PL_DRAWING_TOOLS.waitForModal} resumes on. Ours, no KiCad name. */
const MODAL_DONE = 'plEditor.InteractiveDrawing.modalDone';

/**
 * Tool responsible for drawing/placing items (lines, rectangles, text, etc.)
 */
export class PL_DRAWING_TOOLS extends TOOL_INTERACTIVE {
  private m_frame: PL_EDITOR_FRAME | null;
  private m_selectionTool: PL_SELECTION_TOOL | null;

  constructor() {
    super('plEditor.InteractiveDrawing');
    this.m_frame = null;
    this.m_selectionTool = null;
  }

  /**
   * `getViewControls()` as the `VIEW_CONTROLS` it is: the manager's type
   * names only the calls the manager itself makes (STRUCTURE.md).
   */
  private viewControls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
    this.m_selectionTool = this.m_toolMgr!.GetTool(PL_SELECTION_TOOL);

    const ctxMenu = this.m_menu.GetMenu();

    // cancel current tool goes in main context menu at the top if present
    ctxMenu.AddItem(ACTIONS.cancelInteractive, SELECTION_CONDITIONS.ShowAlways, 1);
    ctxMenu.AddSeparator(1);

    // Finally, add the standard zoom/grid items
    this.m_frame.AddStandardSubMenus(this.m_menu);

    return true;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  Reset(aReason: RESET_REASON): void {
    if (aReason === RESET_REASON.MODEL_RELOAD) this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
  }

  /**
   * `dlg.ShowModal()` inside a coroutine: suspend until the page's dialog
   * settles. wx runs a nested event loop and the canvas sees no events
   * meanwhile; here the tool waits on one message only, and the page's modal
   * backdrop keeps the canvas from being clicked. A tool torn down while it
   * waits (Wait returns null) reads as Cancel.
   */
  private *waitForModal<T>(aPromise: Promise<T>): COROUTINE_BODY<T | null> {
    let settled = false;
    let result: T | null = null;

    void aPromise.then((aResult) => {
      result = aResult;
      settled = true;
      this.m_toolMgr?.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_ANY, MODAL_DONE));
    });

    while (!settled) {
      const evt = yield* this.Wait(new TOOL_EVENT(TC_MESSAGE, TA_ANY, MODAL_DONE));

      if (!evt) return null;
    }

    return result;
  }

  *PlaceItem(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;
    const selectionTool = this.m_selectionTool!;
    const type = aEvent.Parameter<DS_ITEM_TYPE>();
    let cursorPos: VECTOR2I;
    let item: DS_DRAW_ITEM_BASE | null = null;
    const isText = aEvent.IsAction(PL_ACTIONS.placeText);

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    frame.PushTool(aEvent);

    const setCursor = (): void => {
      if (item) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PLACE);
      else if (isText) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.TEXT);
      else if (aEvent.IsAction(PL_ACTIONS.placeImage))
        frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
      else frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
    };

    const cleanup = (): void => {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      item = null;

      // There's nothing to roll-back, but we still need to pop the undo stack
      // This also deletes the item being placed.
      frame.RollbackFromUndo();
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    this.viewControls().ShowCursor(true);
    // Set initial cursor
    setCursor();

    if (aEvent.HasPosition()) this.m_toolMgr!.PrimeTool(aEvent.Position());

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();
      cursorPos = this.viewControls().GetCursorPosition(!evt.DisableGridSnapping());

      if (evt.IsCancelInteractive() || (item && evt.IsAction(ACTIONS.undo))) {
        if (item) {
          cleanup();
        } else {
          frame.PopTool(aEvent);
          break;
        }
      } else if (evt.IsActivate()) {
        if (item) cleanup();

        if (evt.IsMoveTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        } else {
          frame.PopTool(aEvent);
          break;
        }
      } else if (evt.IsClick(BUT_LEFT)) {
        let placeItem = true;

        if (!item) {
          // AddDrawingSheetItem( DS_BITMAP ) opens "Choose Image" and blocks on
          // it; the page's dialog cannot block, so the tool waits for it here.
          const imageFile =
            type === DS_ITEM_TYPE.DS_BITMAP
              ? yield* this.waitForModal(frame.ChooseImageFile())
              : null;

          const dataItem: DS_DATA_ITEM | null = frame.AddDrawingSheetItem(type, imageFile);

          if (dataItem) {
            // dataItem = nullptr can happens if the command was cancelled
            frame.SaveCopyInUndoList();

            this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

            item = dataItem.GetDrawItems()[0]!;
            item.SetFlags(IS_NEW | IS_MOVING);

            // Select the item but don't inform other tools (to prevent the Properties
            // panel from updating the item before it has been placed)
            selectionTool.AddItemToSel(item, true);

            // update the cursor so it looks correct before another event
            setCursor();

            // Text is a single-click-place; all others are first-click-creates,
            // second-click-places.
            placeItem = dataItem.GetType() === DS_ITEM_TYPE.DS_TEXT;
          }
        }

        if (item && placeItem) {
          item.GetPeer()!.MoveStartPointToIU(cursorPos);
          item.SetPosition(item.GetPeer()!.GetStartPosIU(0));
          item.ClearEditFlags();
          this.getView()!.Update(item);

          // Now we re-select and inform other tools, so that the Properties panel
          // is updated.
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
          selectionTool.AddItemToSel(item, false);

          item = null;

          frame.OnModify();
        }
      } else if (evt.IsClick(BUT_RIGHT)) {
        // Warp after context menu only if dragging...
        if (!item) this.m_toolMgr!.VetoContextMenuMouseWarp();

        this.m_menu.ShowContextMenu(selectionTool.GetSelection());
      } else if (item && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
        item.GetPeer()!.MoveStartPointToIU(cursorPos);
        item.SetPosition(item.GetPeer()!.GetStartPosIU(0));
        this.getView()!.Update(item);
      } else {
        evt.SetPassEvent();
      }

      // Enable autopanning and cursor capture only when there is an item to be placed
      this.viewControls().SetAutoPan(item !== null);
      this.viewControls().CaptureCursor(item !== null);
    }

    this.viewControls().SetAutoPan(false);
    this.viewControls().CaptureCursor(false);
    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    return 0;
  }

  *DrawShape(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;
    const selectionTool = this.m_selectionTool!;
    const type = aEvent.Parameter<DS_ITEM_TYPE>();
    let item: DS_DRAW_ITEM_BASE | null = null;

    // We might be running as the same shape in another co-routine.  Make sure that one
    // gets whacked.
    this.m_toolMgr!.DeactivateTool();

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    frame.PushTool(aEvent);

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    this.viewControls().ShowCursor(true);
    // Set initial cursor
    setCursor();

    if (aEvent.HasPosition()) this.m_toolMgr!.PrimeTool(aEvent.Position());

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();

      const cursorPos = this.viewControls().GetCursorPosition(!evt.DisableGridSnapping());

      if (evt.IsCancelInteractive() || (item && evt.IsAction(ACTIONS.undo))) {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

        if (item) {
          item = null;

          // Pop the undo stack and delete the item being placed
          frame.RollbackFromUndo();
        } else {
          break;
        }
      } else if (evt.IsActivate()) {
        if (item) {
          item = null;

          // Pop the undo stack and delete the item being placed
          frame.RollbackFromUndo();
        }

        if (evt.IsPointEditor() || evt.IsMoveTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        }
      } else if (evt.IsClick(BUT_LEFT)) {
        if (!item) {
          // start drawing
          frame.SaveCopyInUndoList();
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

          const dataItem = frame.AddDrawingSheetItem(type)!;
          dataItem.MoveToIU(cursorPos);

          item = dataItem.GetDrawItems()[0]!;
          item.SetFlags(IS_NEW);

          // Select the item but don't inform other tools (to prevent the Properties
          // panel from updating the item before it has been placed)
          selectionTool.AddItemToSel(item, true);
        } else {
          // finish drawing
          // Now we re-select and inform other tools, so that the Properties panel
          // is updated.
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
          selectionTool.AddItemToSel(item, false);

          item.ClearEditFlags();
          item = null;

          // Activate point editor immediately to allow resizing of the item just created
          this.m_toolMgr!.RunAction(ACTIONS.activatePointEditor);

          frame.OnModify();
        }
      } else if (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion()) {
        if (item) {
          item.GetPeer()!.MoveEndPointToIU(cursorPos);
          item.SetEnd(item.GetPeer()!.GetEndPosIU(0));
          this.getView()!.Update(item);
        }
      } else if (evt.IsClick(BUT_RIGHT)) {
        // Warp after context menu only if dragging...
        if (!item) this.m_toolMgr!.VetoContextMenuMouseWarp();

        this.m_menu.ShowContextMenu(selectionTool.GetSelection());
      } else {
        evt.SetPassEvent();
      }

      // Enable autopanning and cursor capture only when there is a shape being drawn
      this.viewControls().SetAutoPan(item !== null);
      this.viewControls().CaptureCursor(item !== null);
    }

    this.viewControls().SetAutoPan(false);
    this.viewControls().CaptureCursor(false);
    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    frame.PopTool(aEvent);
    return 0;
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(this.DrawShape, PL_ACTIONS.drawLine.MakeEvent());
    this.Go(this.DrawShape, PL_ACTIONS.drawRectangle.MakeEvent());
    this.Go(this.PlaceItem, PL_ACTIONS.placeText.MakeEvent());
    this.Go(this.PlaceItem, PL_ACTIONS.placeImage.MakeEvent());
  }
}
