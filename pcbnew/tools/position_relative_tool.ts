// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `POSITION_RELATIVE_TOOL` (pcbnew/tools/position_relative_tool.h,
 * position_relative_tool.cpp): put the selection at a typed offset from a
 * reference point (`PositionRelative`, which shows the non-modal
 * DIALOG_POSITION_RELATIVE) or at an offset drawn with a ruler
 * (`InteractiveOffset`, which asks DIALOG_OFFSET_ITEM for the final vector),
 * on the live BOARD, through BOARD_COMMIT.
 *
 * What the tool asks the window for - the two dialogs - is the frame's, through
 * POSITION_RELATIVE_TOOL_FRAME (the frame's hooks). The non-modal dialog is a
 * `DIALOG_POSITION_RELATIVE` object the frame draws while it `IsShown()`; the
 * modal one answers a promise, as EDIT_TOOL_FRAME's dialogs do, so
 * `InteractiveOffset` finishes its click in the answer.
 */
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { LAYER_ANCHOR } from '@ziroeda/common/layer_id.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { EVENTS } from '@ziroeda/common/tool/actions.js';
import { MD_SHIFT, BUT_LEFT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { type RESET_REASON, RESET_REASON as RESET } from '@ziroeda/common/tool/tool_base.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { RULER_ITEM } from '@ziroeda/common/preview_items/ruler_item.js';
import { TWO_POINT_GEOMETRY_MANAGER } from '@ziroeda/common/preview_items/two_point_geom_manager.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import { DIALOG_OFFSET_ITEM, type OFFSET_VECTOR } from '../dialogs/dialog_offset_item.js';
import { DIALOG_POSITION_RELATIVE } from '../dialogs/dialog_position_relative.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';
import { PCB_SELECTION } from './pcb_selection.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';

/**
 * The window half of the tool: the two dialogs `POSITION_RELATIVE_TOOL` shows,
 * answered by the frame's hooks.
 */
export interface POSITION_RELATIVE_TOOL_FRAME {
  /**
   * `m_dialog = new DIALOG_POSITION_RELATIVE( editFrame )`: the frame draws the
   * window over this object for as long as it lives, visible while
   * `aDialog.IsShown()`, and unmounts it on `aDialog.Destroy()`.
   */
  AttachPositionRelativeDialog(aDialog: DIALOG_POSITION_RELATIVE): void;
  /**
   * `dlg.ShowModal() == wxID_OK` for the DIALOG_OFFSET_ITEM: true on OK, after
   * calling `aDialog.TransferDataFromWindow()` (which edits the offset).
   */
  ShowOffsetItemDialog(aDialog: DIALOG_OFFSET_ITEM): Promise<boolean>;
}

/**
 * Move each item in the selection by the given vector.
 *
 * Pads that belong to footprints are promoted to their parent footprint so the whole footprint
 * moves. A dedup set ensures each footprint is only moved once even when multiple of its pads
 * are in the selection.
 *
 * @param aAllowFreePads when true, pads are moved individually without promotion.
 */
function moveSelectionBy(
  aSelection: PCB_SELECTION,
  aMoveVec: VECTOR2I,
  commit: BOARD_COMMIT,
  aAllowFreePads: boolean,
): void {
  const moved = new Set<BOARD_ITEM>();

  for (const item of aSelection) {
    if (!item.IsBOARD_ITEM()) continue;

    let boardItem = item as BOARD_ITEM;

    if (boardItem.Type() === KICAD_T.PCB_PAD_T && !aAllowFreePads)
      boardItem = boardItem.GetParent() as BOARD_ITEM;

    if (moved.has(boardItem)) continue;

    moved.add(boardItem);

    commit.Modify(boardItem, null, RECURSE_MODE.RECURSE);
    boardItem.Move(aMoveVec);
  }
}

export class POSITION_RELATIVE_TOOL extends PCB_TOOL_BASE {
  private m_dialog: DIALOG_POSITION_RELATIVE | null = null;

  private m_selectionTool: PCB_SELECTION_TOOL | null = null;
  private m_selection: PCB_SELECTION = new PCB_SELECTION();
  private m_selectionAnchor: VECTOR2I = { x: 0, y: 0 };
  private m_inInteractivePosition = false; // Re-entrancy guard

  private m_commit: BOARD_COMMIT | null = null;

  constructor() {
    super('pcbnew.PositionRelative');
  }

  override Reset(aReason: RESET_REASON): void {
    if (aReason !== RESET.RUN) this.m_commit = new BOARD_COMMIT(this);
  }

  /// @copydoc TOOL_BASE::Init()
  override Init(): boolean {
    // Find the selection tool, so they can cooperate
    this.m_selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL | null;

    return this.m_selectionTool !== null;
  }

  /** `getEditFrame<PCB_BASE_FRAME>()` with the window half of the tool. */
  private editFrame(): PCB_BASE_FRAME & Partial<POSITION_RELATIVE_TOOL_FRAME> {
    return this.getEditFrame<PCB_BASE_FRAME>() as PCB_BASE_FRAME &
      Partial<POSITION_RELATIVE_TOOL_FRAME>;
  }

  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /**
   * Invoke a dialog box to allow positioning of the item relative to another by an exact amount.
   */
  PositionRelative(_aEvent: TOOL_EVENT): number {
    const editFrame = this.editFrame();

    const selection = this.m_selectionTool!.RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForLockedItems(aCollector);
    });

    if (this.m_selectionTool!.ReportFilteredLockedItems()) return 0;

    if (selection.Empty()) return 0;

    this.m_selection.assign(selection);

    // We prefer footprints, then pads, then anything else here.
    let preferredItem = this.m_selection.GetTopLeftItem(true);

    if (!preferredItem && this.m_selection.HasType(KICAD_T.PCB_PAD_T)) {
      const padsOnly = new PCB_SELECTION(this.m_selection);
      const items = padsOnly.Items();
      const kept = items.filter((aItem) => aItem.Type() === KICAD_T.PCB_PAD_T);
      items.splice(0, items.length, ...kept);

      preferredItem = padsOnly.GetTopLeftItem();
    }

    if (preferredItem) this.m_selectionAnchor = preferredItem.GetPosition();
    else this.m_selectionAnchor = this.m_selection.GetTopLeftItem()!.GetPosition();

    // The dialog is not modal and not deleted between calls.
    // It means some options can have changed since the last call.
    // Therefore we need to rebuild it in case UI units have changed since the last call.
    if (this.m_dialog && this.m_dialog.GetUserUnits() !== editFrame.GetUserUnits()) {
      this.m_dialog.Destroy();
      this.m_dialog = null;
    }

    if (!this.m_dialog) {
      this.m_dialog = new DIALOG_POSITION_RELATIVE(editFrame);
      editFrame.AttachPositionRelativeDialog?.(this.m_dialog);
    }

    this.m_dialog.Show(true);

    return 0;
  }

  /**
   * Draw a line connecting two points and allow the user to enter what it should be.
   * The move the items to match that.
   */
  *InteractiveOffset(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_inInteractivePosition) return 0;

    // REENTRANCY_GUARD guard( &m_inInteractivePosition )
    this.m_inInteractivePosition = true;

    try {
      return yield* this.interactiveOffset(aEvent);
    } finally {
      this.m_inInteractivePosition = false;
    }
  }

  private *interactiveOffset(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    // First, acquire the selection that we will be moving after we have the new offset vector.
    const selection = this.m_selectionTool!.RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForLockedItems(aCollector);
    });

    if (this.m_selectionTool!.ReportFilteredLockedItems()) return 0;

    if (selection.Empty()) return 0;

    const frame = this.frame<PCB_BASE_FRAME>();
    const editFrame = this.editFrame();

    if (this.m_isFootprintEditor && !frame.GetModel()) return 0;

    if (frame.IsCurrentTool(ACTIONS.measureTool)) return 0;

    const view = this.getView()!;
    const controls = this.controls();

    frame.PushTool(aEvent);

    let invertXAxis = this.displayOptions().m_DisplayInvertXAxis;
    let invertYAxis = this.displayOptions().m_DisplayInvertYAxis;

    if (this.m_isFootprintEditor) {
      invertXAxis = frame.GetFootprintEditorSettings().m_DisplayInvertXAxis;
      invertYAxis = frame.GetFootprintEditorSettings().m_DisplayInvertYAxis;
    }

    const twoPtMgr = new TWO_POINT_GEOMETRY_MANAGER();
    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, frame.GetMagneticItemsSettings());
    let originSet = false;
    let units = frame.GetUserUnits();
    const ruler = new RULER_ITEM(twoPtMgr, pcbIUScale, units, invertXAxis, invertYAxis);
    const statusPopup = new STATUS_TEXT_POPUP();

    const allowFreePads =
      this.m_isFootprintEditor ||
      (frame.GetPcbNewSettings() !== null && frame.GetPcbNewSettings().m_AllowFreePads);

    // Some colour to make it obviously not just a ruler
    ruler.SetColor(view.GetPainter().GetSettings().GetLayerColor(LAYER_ANCHOR));
    ruler.SetShowTicks(false);
    ruler.SetShowEndArrowHead(true);

    view.Add(ruler);
    view.SetVisible(ruler, false);

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.MEASURE);
    };

    const setInitialMsg = (): void => {
      statusPopup.SetText('Select the reference point on the item to move.');
    };

    const setDragMsg = (): void => {
      statusPopup.SetText('Select the point to define the new offset from.');
    };

    const setPopupPosition = (): void => {
      const at = KIPLATFORM_UI.GetMousePosition();
      statusPopup.Move({ x: at.x + 20, y: at.y - 50 });
    };

    const cleanup = (): void => {
      view.SetVisible(ruler, false);
      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      controls.ForceCursorPosition(false);
      originSet = false;
      setInitialMsg();
    };

    const applyVector = (aMoveVec: VECTOR2I): void => {
      const commit = new BOARD_COMMIT(frame);
      moveSelectionBy(selection, aMoveVec, commit, allowFreePads);
      commit.Push('Set Relative Position Interactively');
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.SetAutoPan(false);
    controls.CaptureCursor(false);
    controls.ForceCursorPosition(false);

    // Set initial cursor
    setCursor();

    setInitialMsg();

    setPopupPosition();
    statusPopup.Popup();
    this.canvas()!.SetStatusPopup({
      HasFocus: () => {
        const panel = statusPopup.GetPanel();
        return !!panel && typeof document !== 'undefined' && panel.contains(document.activeElement);
      },
    });

    // The modal DIALOG_OFFSET_ITEM answers a promise: while it is up the canvas is
    // blocked, as wxDialog::ShowModal() blocks it, so no event reaches the loop.
    let dialogOpen = false;

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      if (dialogOpen) continue;

      setCursor();
      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      grid.SetUseGrid(view.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());
      let cursorPos = evt.HasPosition() ? evt.Position() : controls.GetMousePosition();
      setPopupPosition();

      if (!evt.IsActivate() && !evt.IsCancelInteractive()) {
        // If we are switching, the canvas may not be valid any more
        cursorPos = grid.BestSnapAnchor(cursorPos, null);
        controls.ForceCursorPosition(true, cursorPos);
      } else {
        grid.FullReset();
      }

      if (evt.IsCancelInteractive()) {
        if (originSet) {
          cleanup();
        } else {
          frame.PopTool(aEvent);
          break;
        }
      } else if (evt.IsActivate()) {
        if (originSet) cleanup();

        frame.PopTool(aEvent);
        break;
      }
      // click or drag starts
      else if (!originSet && (evt.IsDrag(BUT_LEFT) || evt.IsClick(BUT_LEFT))) {
        twoPtMgr.SetOrigin(cursorPos);
        twoPtMgr.SetEnd(cursorPos);

        setDragMsg();

        controls.CaptureCursor(true);
        controls.SetAutoPan(true);

        originSet = true;
      }
      // second click or mouse up after drag ends
      else if (originSet && (evt.IsClick(BUT_LEFT) || evt.IsMouseUp(BUT_LEFT))) {
        // Hide the popup text so it doesn't get in the way
        statusPopup.Hide();

        // This is the forward vector from the ruler item
        const offsetVector: OFFSET_VECTOR = {
          x: twoPtMgr.GetEnd().x - twoPtMgr.GetOrigin().x,
          y: twoPtMgr.GetEnd().y - twoPtMgr.GetOrigin().y,
        };
        const toReferencePtVector: VECTOR2I = {
          x: twoPtMgr.GetOrigin().x - twoPtMgr.GetEnd().x,
          y: twoPtMgr.GetOrigin().y - twoPtMgr.GetEnd().y,
        };

        // Start with the value of that vector in the dialog (will match the rule HUD)
        const dlg = new DIALOG_OFFSET_ITEM(frame, offsetVector);

        const finish = (): void => {
          originSet = false;

          setInitialMsg();

          controls.SetAutoPan(false);
          controls.CaptureCursor(false);

          statusPopup.Popup();
        };

        if (!editFrame.ShowOffsetItemDialog) {
          finish();
          continue;
        }

        dialogOpen = true;

        void editFrame.ShowOffsetItemDialog(dlg).then((aOk) => {
          dialogOpen = false;

          if (aOk) {
            const move: VECTOR2I = {
              x: toReferencePtVector.x + offsetVector.x,
              y: toReferencePtVector.y + offsetVector.y,
            };

            applyVector(move);

            // Leave the arrow in place but update it
            twoPtMgr.SetEnd({
              x: twoPtMgr.GetOrigin().x + offsetVector.x,
              y: twoPtMgr.GetOrigin().y + offsetVector.y,
            });
            view.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
            this.canvas()!.Refresh();
          }

          finish();
        });
      }
      // move or drag when origin set updates rules
      else if (originSet && (evt.IsMotion() || evt.IsDrag(BUT_LEFT))) {
        const snap = frame.IsType(FRAME_T.FRAME_PCB_EDITOR)
          ? frame.GetPcbNewSettings().m_AngleSnapMode
          : frame.GetFootprintEditorSettings().m_AngleSnapMode;

        twoPtMgr.SetAngleSnap(snap);
        // The end is fixed; we must update the origin
        twoPtMgr.SetOrigin(cursorPos);

        view.SetVisible(ruler, true);
        view.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
      } else if (evt.IsAction(ACTIONS.updateUnits)) {
        if (frame.GetUserUnits() !== units) {
          units = frame.GetUserUnits();
          ruler.SwitchUnits(units);
          view.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
          this.canvas()!.ForceRefresh();
        }

        evt.SetPassEvent();
      } else if (evt.IsAction(ACTIONS.updatePreferences)) {
        invertXAxis = this.displayOptions().m_DisplayInvertXAxis;
        invertYAxis = this.displayOptions().m_DisplayInvertYAxis;

        if (this.m_isFootprintEditor) {
          invertXAxis = frame.GetFootprintEditorSettings().m_DisplayInvertXAxis;
          invertYAxis = frame.GetFootprintEditorSettings().m_DisplayInvertYAxis;
        }

        ruler.UpdateDir(invertXAxis, invertYAxis);

        view.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
        this.canvas()!.Refresh();
        evt.SetPassEvent();
      } else if (!evt.IsMouseAction()) {
        // Often this will end up changing the items we just moved, so the ruler will be
        // in the wrong place. Clear it away and the user can restart
        twoPtMgr.Reset();
        view.SetVisible(ruler, false);
        view.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);

        evt.SetPassEvent();
      } else {
        evt.SetPassEvent();
      }
    }

    view.SetVisible(ruler, false);
    view.Remove(ruler);

    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    controls.SetAutoPan(false);
    controls.CaptureCursor(false);
    controls.ForceCursorPosition(false);

    this.canvas()!.SetStatusPopup(null);
    return 0;
  }

  /** Return the position of the selected item(s). */
  GetSelectionAnchorPosition(): VECTOR2I {
    return this.m_selectionAnchor;
  }

  /**
   * Position the m_position_relative_selection selection relative to anchor position using
   * the given translation.
   */
  RelativeItemSelectionMove(aPosAnchor: VECTOR2I, aTranslation: VECTOR2I): number {
    const aggregateTranslation: VECTOR2I = {
      x: aPosAnchor.x + aTranslation.x - this.GetSelectionAnchorPosition().x,
      y: aPosAnchor.y + aTranslation.y - this.GetSelectionAnchorPosition().y,
    };

    const frame = this.frame<PCB_BASE_FRAME>();
    const allowFreePads =
      this.m_isFootprintEditor ||
      (frame.GetPcbNewSettings() !== null && frame.GetPcbNewSettings().m_AllowFreePads);

    moveSelectionBy(this.m_selection, aggregateTranslation, this.m_commit!, allowFreePads);
    this.m_commit!.Push('Position Relative');

    if (this.m_selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

    this.canvas()!.Refresh();
    return 0;
  }

  ///< Set up handlers for various events.
  protected override setTransitions(): void {
    this.Go(
      SYNC_HANDLER<POSITION_RELATIVE_TOOL>(this.PositionRelative),
      PCB_ACTIONS.positionRelative.MakeEvent(),
    );
    this.Go(this.InteractiveOffset, PCB_ACTIONS.interactiveOffsetTool.MakeEvent());
  }
}
