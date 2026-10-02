// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/board_editor_control.cpp`: the board editor's own tool.
 *
 * Only the size-cycling arms are here so far — `TrackWidthInc`, `TrackWidthDec`
 * and the menu transition that resets everything. They mutate the live
 * `BOARD_DESIGN_SETTINGS`, which is where the indices and the custom flags
 * live, so nothing needs a copy of them.
 *
 * `BOARD_EDITOR_CONTROL` proper is below, its handlers landing a few at a
 * time.
 */
import type { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { ORIGIN_VIEWITEM } from '@ziroeda/common/origin_viewitem.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { type RESET_REASON, RESET_REASON as RESET } from '@ziroeda/common/tool/tool_base.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import type { PCB_PICKER_TOOL } from './pcb_picker_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { BOARD_COMMIT, SKIP_TEARDROPS } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { CHANGE_TYPE } from '@ziroeda/common/commit.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { EVENTS } from '@ziroeda/common/tool/actions.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { BUT_LEFT, BUT_RIGHT } from '@ziroeda/common/tool/tool_event.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { FOOTPRINT } from '../footprint.js';
import { IsZoneFillAction } from './pcb_picker_tool.js';
import { DS_PROXY_UNDO_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_undo_item.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { ITEM_PICKER, PICKED_ITEMS_LIST } from '@ziroeda/common/undo_redo_container.js';
import { VIEW_UPDATE_FLAGS, type VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { DoSetDrillOrigin } from './pcb_origins.js';

/**
 * `BOARD_EDITOR_CONTROL::TrackWidthInc` / `TrackWidthDec`
 * (`board_editor_control.cpp:1086-1200`), the differential-pair arm.
 *
 * Which list gets walked is the router's MODE:
 *
 *     if( routerTool->IsToolActive()
 *             && routerTool->Router()->Mode() == PNS_MODE_ROUTE_DIFF_PAIR )
 *         widthIndex = bds.GetDiffPairIndex() + 1;    // or - 1
 *
 * Both directions wrap, and they wrap ASYMMETRICALLY: increment falls off the
 * end to 0, decrement falls off the front to `size() - 1`. Index 0 is in the
 * cycle, so "use netclass" is one of the stops rather than a state you have to
 * leave the menu to reach.
 */
export function NextDiffPairIndex(aBds: BOARD_DESIGN_SETTINGS, aDelta: 1 | -1): void {
  const size = aBds.m_DiffPairDimensionsList.length;
  let index = aBds.GetDiffPairIndex() + aDelta;

  if (aDelta > 0) {
    // `if( widthIndex >= (int) size ) widthIndex = 0;`
    if (index >= size) index = 0;
  } else if (index < 0) {
    // `if( widthIndex < 0 ) widthIndex = size - 1;`
    index = size - 1;
  }

  // `SetDiffPairIndex( widthIndex ); UseCustomDiffPairDimensions( false );`
  aBds.SetDiffPairIndex(index);
  aBds.UseCustomDiffPairDimensions(false);
}

/**
 * The single-track arm of the same two actions, including the step it does
 * NOT take:
 *
 *     if( routerTool->IsToolActive() && Router()->GetState() == ROUTE_TRACK
 *             && bds.m_UseConnectedTrackWidth && !bds.m_TempOverrideTrackWidth )
 *         bds.m_TempOverrideTrackWidth = true;
 *     else
 *         widthIndex++;
 *
 * The first press while "use the starting track's width" is on does not change
 * the index at all — it turns the override on, so the NEXT press starts from
 * where the index already was.
 *
 * @returns the new `m_TempOverrideTrackWidth`, which the caller owns because
 *          it is per-route rather than part of the settings.
 */
export function NextTrackWidthIndex(
  aBds: BOARD_DESIGN_SETTINGS,
  aDelta: 1 | -1,
  aRouting: {
    routingTrack: boolean;
    useConnectedTrackWidth: boolean;
    tempOverrideTrackWidth: boolean;
  },
): boolean {
  if (aRouting.routingTrack && aRouting.useConnectedTrackWidth && !aRouting.tempOverrideTrackWidth)
    return true;

  const size = aBds.m_TrackWidthList.length;
  let index = aBds.GetTrackWidthIndex() + aDelta;

  if (aDelta > 0) {
    if (index >= size) index = 0;
  } else if (index < 0) {
    index = size - 1;
  }

  // `SetTrackWidthIndex( widthIndex ); UseCustomTrackViaSize( false );`
  aBds.SetTrackWidthIndex(index);
  aBds.UseCustomTrackViaSize(false);

  return aRouting.tempOverrideTrackWidth;
}

/**
 * `TRACK_WIDTH_MENU::eventHandler`'s `ID_POPUP_PCB_SELECT_USE_NETCLASS_VALUES`
 * arm (`router_tool.cpp:383-389`) — the one menu item that resets FOUR things,
 * including `m_UseConnectedTrackWidth`, which no other arm touches.
 *
 * @returns the new `m_UseConnectedTrackWidth`, always false.
 */
export function UseNetclassTrackAndVia(aBds: BOARD_DESIGN_SETTINGS): false {
  aBds.UseCustomTrackViaSize(false);
  aBds.SetViaSizeIndex(0);
  aBds.SetTrackWidthIndex(0);

  return false;
}

/**
 * `BOARD_EDITOR_CONTROL` (board_editor_control.cpp), the board editor's own
 * tool. Ported so far: the class, Reset, the drill/place origin
 * (DoSetDrillOrigin, DrillOrigin), the lock commands (modifyLockSelected),
 * PageSettings and PlaceFootprint. The rest of its handlers follow.
 */
/** The frame's half of PlaceFootprint: the footprint chooser, then the load. */
export interface PLACE_FOOTPRINT_FRAME {
  SelectFootprintFromLibrary(): Promise<FOOTPRINT | null>;
}

/** `BOARD_EDITOR_CONTROL::MODIFY_MODE`. */
enum MODIFY_MODE {
  ON,
  OFF,
  TOGGLE,
}

export class BOARD_EDITOR_CONTROL extends PCB_TOOL_BASE {
  private m_frame: PCB_BASE_FRAME | null = null;
  /** Place & drill origin marker. */
  private readonly m_placeOrigin = new ORIGIN_VIEWITEM(
    { r: 0.8, g: 0, b: 0, a: 1 },
    'circle_cross',
  );

  private m_inPlaceFootprint = false; // Re-entrancy guard for PlaceFootprint().
  private m_placingFootprint = false; // Persistent state for PlaceFootprint().

  constructor() {
    super('pcbnew.EditorControl');
  }

  /** The drill origin's view item, which the drill-origin undo record clones. */
  PlaceOriginItem(): ORIGIN_VIEWITEM {
    return this.m_placeOrigin;
  }

  override Reset(aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<PCB_BASE_FRAME>();

    if (
      aReason === RESET.MODEL_RELOAD ||
      aReason === RESET.GAL_SWITCH ||
      aReason === RESET.REDRAW
    ) {
      // Nothing to read while the frame is still binding its board.
      if (!this.getModel()) return;

      this.m_placeOrigin.SetPosition(this.board().GetDesignSettings().GetAuxOrigin());
      // getView()->Remove / Add( m_placeOrigin ): TRANSITIONAL, the board
      // canvas draws the marker itself (see ORIGIN_VIEWITEM).
    }
  }

  static DoSetDrillOrigin(
    aView: VIEW | null,
    aFrame: PCB_BASE_FRAME,
    originViewItem: EDA_ITEM,
    aPosition: VECTOR2D,
  ): void {
    DoSetDrillOrigin(aView, aFrame, originViewItem, aPosition);
  }

  DrillOrigin(aEvent: TOOL_EVENT): number {
    const frame = this.m_frame as unknown as PCB_BASE_EDIT_FRAME;

    // Upstream records the reset and the set-by-parameter as GRIDORIGIN, not
    // DRILLORIGIN (:2249, :2257); kept, so undo behaves as it does there.
    if (aEvent.IsAction(PCB_ACTIONS.drillResetOrigin)) {
      frame.SaveCopyInUndoList(this.m_placeOrigin, UNDO_REDO.GRIDORIGIN);
      BOARD_EDITOR_CONTROL.DoSetDrillOrigin(this.getView(), this.m_frame!, this.m_placeOrigin, {
        x: 0,
        y: 0,
      });
      return 0;
    }

    if (aEvent.IsAction(PCB_ACTIONS.drillSetOrigin)) {
      const origin = aEvent.Parameter<VECTOR2D>();
      frame.SaveCopyInUndoList(this.m_placeOrigin, UNDO_REDO.GRIDORIGIN);
      BOARD_EDITOR_CONTROL.DoSetDrillOrigin(
        this.getView(),
        this.m_frame!,
        this.m_placeOrigin,
        origin,
      );
      return 0;
    }

    const picker = this.m_toolMgr!.FindTool(
      'pcbnew.InteractivePicker',
    ) as unknown as PCB_PICKER_TOOL;

    // Deactivate other tools; particularly important if another PICKER is currently running
    this.Activate();

    picker.SetCursor(KICURSOR.PLACE);
    picker.ClearHandlers();

    picker.SetClickHandler((pt: VECTOR2D): boolean => {
      frame.SaveCopyInUndoList(this.m_placeOrigin, UNDO_REDO.DRILLORIGIN);
      BOARD_EDITOR_CONTROL.DoSetDrillOrigin(this.getView(), this.m_frame!, this.m_placeOrigin, pt);
      return false; // drill origin is a one-shot; don't continue with tool
    });

    this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);

    return 0;
  }

  *PlaceFootprint(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_inPlaceFootprint) return 0;

    this.m_inPlaceFootprint = true;

    try {
      return yield* this.placeFootprint(aEvent);
    } finally {
      this.m_inPlaceFootprint = false;
    }
  }

  private *placeFootprint(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame as unknown as PCB_BASE_EDIT_FRAME & PLACE_FOOTPRINT_FRAME;
    let fp: FOOTPRINT | null = aEvent.HasParameter() ? aEvent.Parameter<FOOTPRINT | null>() : null;
    const fromOtherCommand = fp !== null;
    const controls = this.getViewControls() as unknown as VIEW_CONTROLS;
    const commit = new BOARD_COMMIT(frame);
    const board = this.board();
    const common_settings = Pgm().GetCommonSettings();

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    const pushedEvent = aEvent;
    frame.PushTool(aEvent);

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
    };

    const cleanup = (): void => {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      commit.Revert();

      if (fromOtherCommand) {
        const undo = frame.PopCommandFromUndoList();

        if (undo) {
          frame.PutDataInPreviousState(undo);
          frame.ClearListAndDeleteItems(undo);
        }
      }

      fp = null;
      this.m_placingFootprint = false;
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    // Set initial cursor
    setCursor();

    let cursorPos: VECTOR2D = controls.GetCursorPosition();
    let ignorePrimePosition = false;
    let reselect = false;

    // Prime the pump
    if (fp) {
      this.m_placingFootprint = true;
      fp.SetPosition(cursorPos);
      this.m_toolMgr!.RunAction(ACTIONS.selectItem, fp);
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    } else if (aEvent.HasPosition()) {
      this.m_toolMgr!.PrimeTool(aEvent.Position());
    } else if ((common_settings?.m_Input.immediate_actions ?? true) && !aEvent.IsReactivate()) {
      this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });
      ignorePrimePosition = true;
    }

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();
      cursorPos = controls.GetCursorPosition(!evt.DisableGridSnapping());

      if (reselect && fp) this.m_toolMgr!.RunAction(ACTIONS.selectItem, fp);

      if (evt.IsCancelInteractive() || (fp && evt.IsAction(ACTIONS.undo))) {
        if (fp) {
          cleanup();
        } else {
          frame.PopTool(pushedEvent);
          break;
        }
      } else if (evt.IsActivate()) {
        if (fp) cleanup();

        if (evt.IsMoveTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        } else {
          frame.PopTool(pushedEvent);
          break;
        }
      } else if (evt.IsClick(BUT_LEFT)) {
        if (!fp) {
          // Pick the footprint to be placed
          fp = (yield* this.RunMainStackModal(() => frame.SelectFootprintFromLibrary())) ?? null;

          if (fp === null) continue;

          // If we started with a hotkey which has a position then warp back to that.
          // Otherwise update to the current mouse position pinned inside the autoscroll
          // boundaries.
          if (evt.IsPrime() && !ignorePrimePosition) {
            cursorPos = evt.Position();
            controls.WarpMouseCursor(cursorPos, true);
          } else {
            controls.PinCursorInsideNonAutoscrollArea(true);
            cursorPos = controls.GetMousePosition();
          }

          this.m_placingFootprint = true;

          fp.SetLink(niluuid);

          fp.SetFlags(IS_NEW); // whatever

          // Set parent so that clearance can be loaded
          fp.SetParent(board as unknown as BOARD_ITEM);
          board.UpdateUserUnits(fp, frame.GetCanvas()?.GetView() ?? null);

          for (const pad of fp.Pads()) {
            pad.SetLocalRatsnestVisible(frame.GetPcbNewSettings().m_Display.m_ShowGlobalRatsnest);

            // Pads in the library all have orphaned nets.  Replace with Default.
            pad.SetNetCode(0);
          }

          // Put it on FRONT layer,
          // (Can be stored flipped if the lib is an archive built from a board)
          if (fp.IsFlipped()) fp.Flip(fp.GetPosition(), frame.GetPcbNewSettings().m_FlipDirection);

          fp.SetOrientation(ANGLE_0);
          fp.SetPosition(cursorPos);

          commit.Add(fp);
          this.m_toolMgr!.RunAction(ACTIONS.selectItem, fp);

          this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
        } else {
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
          commit.Push('Place Footprint');
          fp = null; // to indicate that there is no footprint that we currently modify
          this.m_placingFootprint = false;
        }
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(this.selection());
      } else if (fp && (evt.IsMotion() || evt.IsAction(ACTIONS.refreshPreview))) {
        fp.SetPosition(cursorPos);
        this.selection().SetReferencePoint(cursorPos);
        this.getView()!.Update(this.selection());
        this.getView()!.Update(fp);
      } else if (fp && evt.IsAction(PCB_ACTIONS.properties)) {
        // Calling 'Properties' action clears the selection, so we need to restore it
        reselect = true;
      } else if (fp && (IsZoneFillAction(evt) || evt.IsAction(ACTIONS.redo))) {
        wxBell();
      } else {
        evt.SetPassEvent();
      }

      // Enable autopanning and cursor capture only when there is a footprint to be placed
      controls.SetAutoPan(fp !== null);
      controls.CaptureCursor(fp !== null);
    }

    controls.SetAutoPan(false);
    controls.CaptureCursor(false);
    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);

    return 0;
  }

  /** `m_placingFootprint`: a footprint is on the cursor. */
  PlacingFootprint(): boolean {
    return this.m_placingFootprint;
  }

  *PageSettings(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame as unknown as PCB_BASE_EDIT_FRAME;
    const undoCmd = new PICKED_ITEMS_LIST();
    const undoItem = new DS_PROXY_UNDO_ITEM(frame);
    const wrapper = new ITEM_PICKER(null, undoItem, UNDO_REDO.PAGESETTINGS);

    undoCmd.PushItem(wrapper);
    undoCmd.SetDescription('Page Settings');
    frame.SaveCopyInUndoList(undoCmd, UNDO_REDO.PAGESETTINGS);

    // DIALOG_PAGES_SETTINGS dlg( m_frame, …, MAX_PAGE_SIZE_PCBNEW_MILS ): the
    // window's, which writes the page and title block into the frame on OK.
    const ok = yield* this.RunMainStackModal(() => frame.ShowPageSettingsDialog());

    if (ok === true) {
      frame
        .GetCanvas()
        ?.GetView()
        ?.UpdateAllItemsConditionally((aItem: VIEW_ITEM): number => {
          const text = aItem as unknown as Partial<EDA_TEXT>;

          if (text.HasTextVars?.()) {
            text.ClearRenderCache!();
            text.ClearBoundingBoxCache!();
            return VIEW_UPDATE_FLAGS.GEOMETRY | VIEW_UPDATE_FLAGS.REPAINT;
          }

          return 0;
        });

      frame.OnModify();
    } else {
      frame.RollbackFromUndo();
    }

    return 0;
  }

  ToggleLockSelected(_aEvent: TOOL_EVENT): number {
    return this.modifyLockSelected(MODIFY_MODE.TOGGLE);
  }

  LockSelected(_aEvent: TOOL_EVENT): number {
    return this.modifyLockSelected(MODIFY_MODE.ON);
  }

  UnlockSelected(_aEvent: TOOL_EVENT): number {
    return this.modifyLockSelected(MODIFY_MODE.OFF);
  }

  /** `modifyLockSelected( MODIFY_MODE aMode )` (board_editor_control.cpp:1540-1631). */
  private modifyLockSelected(aMode: MODIFY_MODE): number {
    const selTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;

    // RequestSelection populates from the cursor when empty and marks it IsHover(), letting us
    // clear it afterwards without disturbing a pre-existing selection.
    const selection = selTool.RequestSelection(null);

    const commit = new BOARD_COMMIT(this.m_frame! as unknown as PCB_BASE_EDIT_FRAME);

    if (selection.Empty()) return 0;

    const isHover = selection.IsHover();

    // Resolve TOGGLE mode
    if (aMode === MODIFY_MODE.TOGGLE) {
      aMode = MODIFY_MODE.ON;

      for (const item of selection.Items()) {
        if (!item.IsBOARD_ITEM()) continue;

        if ((item as BOARD_ITEM).IsLocked()) {
          aMode = MODIFY_MODE.OFF;
          break;
        }
      }
    }

    for (const item of selection.Items()) {
      if (!item.IsBOARD_ITEM()) continue;

      const board_item = item as BOARD_ITEM;

      // Disallow locking free pads - it's confusing and not persisted
      // through save/load anyway.
      if (board_item.Type() === KICAD_T.PCB_PAD_T) continue;

      const parent_group = board_item.GetParentGroup();

      if (parent_group && parent_group.AsEdaItem().Type() === KICAD_T.PCB_GENERATOR_T) {
        const generator = parent_group.AsEdaItem() as unknown as BOARD_ITEM;

        if (generator && commit.GetStatus(generator) !== CHANGE_TYPE.CHT_MODIFY) {
          commit.Modify(generator);

          if (aMode === MODIFY_MODE.ON) generator.SetLocked(true);
          else generator.SetLocked(false);
        }
      }

      commit.Modify(board_item);

      if (aMode === MODIFY_MODE.ON) board_item.SetLocked(true);
      else board_item.SetLocked(false);

      if (aMode === MODIFY_MODE.OFF && board_item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        board_item.RunOnChildren((child: BOARD_ITEM) => {
          child.SetLocked(false);
        }, RECURSE_MODE.RECURSE);
      }
    }

    if (!commit.Empty()) {
      commit.Push(aMode === MODIFY_MODE.ON ? 'Lock' : 'Unlock', SKIP_TEARDROPS);

      this.m_toolMgr!.PostEvent(EVENTS.SelectedEvent);
      this.m_frame!.OnModify();
    }

    if (isHover) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  protected override setTransitions(): void {
    const drill = SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.DrillOrigin);
    this.Go(drill, PCB_ACTIONS.drillOrigin.MakeEvent());
    this.Go(drill, PCB_ACTIONS.drillResetOrigin.MakeEvent());
    this.Go(drill, PCB_ACTIONS.drillSetOrigin.MakeEvent());
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ToggleLockSelected),
      PCB_ACTIONS.toggleLock.MakeEvent(),
    );
    this.Go(SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.LockSelected), PCB_ACTIONS.lock.MakeEvent());
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.UnlockSelected),
      PCB_ACTIONS.unlock.MakeEvent(),
    );
    this.Go(this.PageSettings, ACTIONS.pageSettings.MakeEvent());
    this.Go(this.PlaceFootprint, PCB_ACTIONS.placeFootprint.MakeEvent());
  }
}
