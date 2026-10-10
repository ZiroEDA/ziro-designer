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
import { BOARD_EDITOR_CONTROL_GenD356File } from '../exporters/export_d356.js';
import { RecreateCmpFile } from '../exporters/export_footprint_associations.js';
import { BOARD_EDITOR_CONTROL_ExportGenCAD } from '../exporters/export_gencad.js';
import { footprintAssignmentFileWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { JOB_EXPORT_PCB_ODB, ODB_UNITS } from '@ziroeda/common/jobs/job_export_pcb_odb.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import { GenerateODBPPFiles } from '../dialogs/dialog_export_odbpp.js';
import { HYPERLYNX_EXPORTER } from '../exporters/export_hyperlynx.js';
import { EXPORTER_VRML } from '../exporters/exporter_vrml.js';
import type { ZONE_FILLER_TOOL } from './zone_filler_tool.js';
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
import { ACTION_MENU, type TOOL_INTERACTIVE_LIKE } from '@ziroeda/common/tool/action_menu.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { PCB_SELECTION_CONDITIONS } from './pcb_selection_conditions.js';
import { ZONE } from '../zone.js';
import { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import type { BOARD } from '../board.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { DRAWING_MODE, type DRAWING_TOOL } from './drawing_tool.js';

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

/** `getOverlappingZones( aBoard, aZone )` (board_editor_control.cpp:99-131). */
function getOverlappingZones(aBoard: BOARD, aZone: ZONE): ZONE[] {
  const overlapping: ZONE[] = [];
  const bbox = aZone.GetBoundingBox();

  for (const candidate of aBoard.Zones()) {
    if (candidate === aZone) continue;

    if (candidate.GetIsRuleArea() || candidate.IsTeardropArea()) continue;

    if (!candidate.GetLayerSet().and(aZone.GetLayerSet()).any()) continue;

    if (!candidate.GetBoundingBox().Intersects(bbox)) continue;

    // Check edge collision and containment (one zone entirely inside another)
    if (
      aZone.Outline().Collide(candidate.Outline()) ||
      (candidate.Outline().TotalVertices() > 0 &&
        aZone.Outline().Contains(candidate.Outline().CVertex(0))) ||
      (aZone.Outline().TotalVertices() > 0 &&
        candidate.Outline().Contains(aZone.Outline().CVertex(0)))
    ) {
      overlapping.push(candidate);
    }
  }

  return overlapping;
}

/** `ZONE_PRIORITY_CONTEXT_MENU` (board_editor_control.cpp:205-262). */
class ZONE_PRIORITY_CONTEXT_MENU extends ACTION_MENU {
  constructor() {
    super(true);

    this.SetIcon(BITMAPS.swap);
    this.SetTitle('Zone Priority');

    this.Add(PCB_ACTIONS.zonePriorityMoveToTop);
    this.Add(PCB_ACTIONS.zonePriorityRaise);
    this.Add(PCB_ACTIONS.zonePriorityLower);
    this.Add(PCB_ACTIONS.zonePriorityMoveToBottom);
  }

  protected override create(): ACTION_MENU {
    return new ZONE_PRIORITY_CONTEXT_MENU();
  }

  protected override update(): void {
    const selTool = this.getToolManager()?.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL | null;

    if (!selTool) return;

    const selection = selTool.GetSelection();
    let canRaise = false;
    let canLower = false;

    if (selection.Size() === 1) {
      const zone = selection.Front() instanceof ZONE ? (selection.Front() as ZONE) : null;

      if (zone && !zone.GetIsRuleArea() && !zone.IsTeardropArea()) {
        const board = zone.GetBoard()!;
        const overlapping = getOverlappingZones(board, zone);

        for (const other of overlapping) {
          if (other.GetAssignedPriority() > zone.GetAssignedPriority()) canRaise = true;

          if (other.GetAssignedPriority() < zone.GetAssignedPriority()) canLower = true;
        }
      }
    }

    this.Enable(PCB_ACTIONS.zonePriorityMoveToTop.GetUIId(), canRaise);
    this.Enable(PCB_ACTIONS.zonePriorityRaise.GetUIId(), canRaise);
    this.Enable(PCB_ACTIONS.zonePriorityLower.GetUIId(), canLower);
    this.Enable(PCB_ACTIONS.zonePriorityMoveToBottom.GetUIId(), canLower);
  }
}

/** `ZONE_CONTEXT_MENU` (board_editor_control.cpp:265-300). */
class ZONE_CONTEXT_MENU extends ACTION_MENU {
  constructor() {
    super(true);

    this.SetIcon(BITMAPS.add_zone);
    this.SetTitle('Zones');

    this.Add(PCB_ACTIONS.zoneFill);
    this.Add(PCB_ACTIONS.zoneFillAll);
    this.Add(PCB_ACTIONS.zoneUnfill);
    this.Add(PCB_ACTIONS.zoneUnfillAll);

    this.AppendSeparator();

    this.Add(PCB_ACTIONS.zoneMerge);
    this.Add(PCB_ACTIONS.zoneDuplicate);
    this.Add(PCB_ACTIONS.drawZoneCutout);
    this.Add(PCB_ACTIONS.drawSimilarZone);

    this.AppendSeparator();

    this.Add(new ZONE_PRIORITY_CONTEXT_MENU());

    this.AppendSeparator();

    this.Add(PCB_ACTIONS.zonesManager);
  }

  protected override create(): ACTION_MENU {
    return new ZONE_CONTEXT_MENU();
  }
}

/** `LOCK_CONTEXT_MENU` (board_editor_control.cpp:303-323). */
class LOCK_CONTEXT_MENU extends CONDITIONAL_MENU {
  constructor(aTool: TOOL_INTERACTIVE_LIKE | null) {
    super(aTool);

    this.SetIcon(BITMAPS.locked);
    this.SetTitle('Locking');

    this.AddItem(PCB_ACTIONS.lock, PCB_SELECTION_CONDITIONS.HasUnlockedItems);
    this.AddItem(PCB_ACTIONS.unlock, PCB_SELECTION_CONDITIONS.HasLockedItems);
    this.AddItem(PCB_ACTIONS.toggleLock, SELECTION_CONDITIONS.ShowAlways);
  }

  protected override create(): ACTION_MENU {
    return new LOCK_CONTEXT_MENU(this.m_tool);
  }
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
      this.getView()?.Remove(this.m_placeOrigin);
      this.getView()?.Add(this.m_placeOrigin);
    }
  }

  /**
   * `OnAngleSnapModeChanged` (board_editor_control.cpp:353-370): the left
   * toolbar's Line modes group shows the current mode.
   */
  OnAngleSnapModeChanged(_aEvent: TOOL_EVENT): number {
    if (!this.m_frame?.IsType(FRAME_T.FRAME_PCB_EDITOR)) return 0;

    const f = this.m_frame;
    const mode = f.GetPcbNewSettings().m_AngleSnapMode;

    switch (mode) {
      case LEADER_MODE.DIRECT:
        f.SelectToolbarAction(PCB_ACTIONS.lineModeFree);
        break;
      case LEADER_MODE.DEG90:
        f.SelectToolbarAction(PCB_ACTIONS.lineMode90);
        break;
      default:
        f.SelectToolbarAction(PCB_ACTIONS.lineMode45);
        break;
    }

    return 0;
  }

  /** `ChangeLineMode` (board_editor_control.cpp:373-380). */
  ChangeLineMode(aEvent: TOOL_EVENT): number {
    const mode = aEvent.Parameter<LEADER_MODE>();
    this.m_frame!.GetPcbNewSettings().m_AngleSnapMode = mode;
    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    this.m_toolMgr!.RunAction(PCB_ACTIONS.angleSnapModeChanged);
    return 0;
  }

  /** `Init()` (board_editor_control.cpp:383-470). */
  override Init(): boolean {
    this.m_frame = this.getEditFrame<PCB_BASE_FRAME>();
    const frame = this.m_frame;

    const activeToolCondition = (_aSel: SELECTION): boolean => !frame.ToolStackIsEmpty();

    const inactiveStateCondition = (aSel: SELECTION): boolean =>
      frame.ToolStackIsEmpty() && aSel.Size() === 0;

    const placeModuleCondition = (aSel: SELECTION): boolean =>
      frame.IsCurrentTool(PCB_ACTIONS.placeFootprint) && aSel.GetSize() === 0;

    const ctxMenu = this.m_menu.GetMenu();

    // "Cancel" goes at the top of the context menu when a tool is active
    ctxMenu.AddItem(ACTIONS.cancelInteractive, activeToolCondition, 1);
    ctxMenu.AddSeparator(1);

    // "Get and Place Footprint" should be available for Place Footprint tool
    ctxMenu.AddItem(PCB_ACTIONS.getAndPlace, placeModuleCondition, 1000);
    ctxMenu.AddSeparator(1000);

    // Finally, add the standard zoom & grid items
    frame.AddStandardSubMenus(this.m_menu);

    const zoneMenu = new ZONE_CONTEXT_MENU();
    zoneMenu.SetTool(this);

    const lockMenu = new LOCK_CONTEXT_MENU(this);

    // Add the PCB control menus to relevant other tools

    const selTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL | null;

    if (selTool) {
      const toolMenu = selTool.GetToolMenu();
      const menu = toolMenu.GetMenu();

      // Add "Get and Place Footprint" when Selection tool is in an inactive state
      menu.AddItem(PCB_ACTIONS.getAndPlace, inactiveStateCondition);
      menu.AddSeparator();

      toolMenu.RegisterSubMenu(zoneMenu);
      toolMenu.RegisterSubMenu(lockMenu);

      menu.AddMenu(lockMenu, SELECTION_CONDITIONS.NotEmpty, 100);

      menu.AddMenu(zoneMenu, SELECTION_CONDITIONS.OnlyTypes([KICAD_T.PCB_ZONE_T]), 100);
    }

    const drawingTool = this.m_toolMgr!.FindTool(
      'pcbnew.InteractiveDrawing',
    ) as unknown as DRAWING_TOOL | null;

    if (drawingTool) {
      const toolMenu = drawingTool.GetToolMenu();
      const menu = toolMenu.GetMenu();

      toolMenu.RegisterSubMenu(zoneMenu);

      // Functor to say if the PCB_EDIT_FRAME is in a given mode
      // Capture the tool pointer and tool mode by value
      const toolActiveFunctor =
        (aMode: DRAWING_MODE) =>
        (_sel: SELECTION): boolean =>
          drawingTool.GetDrawingMode() === aMode;

      menu.AddMenu(zoneMenu, toolActiveFunctor(DRAWING_MODE.ZONE), 300);
    }

    // Ensure the left toolbar's Line modes group reflects the current setting at startup
    if (this.m_toolMgr) this.m_toolMgr.RunAction(PCB_ACTIONS.angleSnapModeChanged);

    return true;
  }

  /** `Find` (board_editor_control.cpp:577-581). */
  Find(_aEvent: TOOL_EVENT): number {
    (this.m_frame as unknown as PCB_EDIT_FRAME).ShowFindDialog();
    return 0;
  }

  /** `FindNext` (board_editor_control.cpp:584-588). */
  FindNext(aEvent: TOOL_EVENT): number {
    (this.m_frame as unknown as PCB_EDIT_FRAME).FindNext(aEvent.IsAction(ACTIONS.findPrevious));
    return 0;
  }

  /** `CrossProbeToSch` (board_editor_control.cpp:2083-2087). */
  CrossProbeToSch(aEvent: TOOL_EVENT): number {
    this.doCrossProbePcbToSch(aEvent, false);
    return 0;
  }

  /** `ExplicitCrossProbeToSch` (board_editor_control.cpp:2090-2094). */
  ExplicitCrossProbeToSch(aEvent: TOOL_EVENT): number {
    this.doCrossProbePcbToSch(aEvent, true);
    return 0;
  }

  /** `doCrossProbePcbToSch` (board_editor_control.cpp:2097-2114). */
  private doCrossProbePcbToSch(aEvent: TOOL_EVENT, aForce: boolean): void {
    const editFrame = this.m_frame as unknown as PCB_EDIT_FRAME;

    // Don't get in an infinite loop PCB -> SCH -> PCB -> SCH -> ...
    if (editFrame.m_ProbingSchToPcb) return;

    const selTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;
    const selection = selTool.GetSelection();
    let focusItem: EDA_ITEM | null = null;

    if (aEvent.Matches(EVENTS.PointSelectedEvent)) focusItem = selection.GetLastAddedItem();

    editFrame.SendSelectItemsToSch(selection.GetItems(), focusItem, aForce);

    // Update 3D viewer highlighting
    editFrame.Update3DView(false, editFrame.GetPcbNewSettings().m_Display.m_Live3DRefresh);
  }

  /** `AssignNetclass` (board_editor_control.cpp:2117-2190). */
  AssignNetclass(_aEvent: TOOL_EVENT): number {
    const selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;

    const selection = selectionTool.RequestSelection((_aPt, aCollector, sTool) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        if (!(item instanceof BOARD_CONNECTED_ITEM)) aCollector.Remove(item);
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    if (selectionTool.ReportFilteredLockedItems()) return 0;

    const netNames = new Set<string>();
    const netCodes = new Set<number>();

    for (const item of selection.Items()) {
      const net = (item as unknown as BOARD_CONNECTED_ITEM).GetNet()!;

      if (!net.HasAutoGeneratedNetname()) {
        netNames.add(net.GetNetname());
        netCodes.add(net.GetNetCode());
      }
    }

    if (netNames.size === 0) {
      (this.m_frame as unknown as PCB_EDIT_FRAME).ShowInfoBarError(
        'Selection contains no items with labeled nets.',
      );
      return 0;
    }

    selectionTool.ClearSelection();

    for (const code of netCodes) this.m_toolMgr!.RunAction(PCB_ACTIONS.selectNet, code);

    this.canvas()?.ForceRefresh();

    const editFrame = this.m_frame as unknown as PCB_EDIT_FRAME;

    void editFrame
      .ShowAssignNetclassDialog(
        netNames,
        this.board().GetNetClassAssignmentCandidates(),
        (aNetNames: readonly string[]) => {
          const selTool = this.m_toolMgr!.FindTool(
            'common.InteractiveSelection',
          ) as unknown as PCB_SELECTION_TOOL;
          selTool.ClearSelection();

          for (const curr_netName of aNetNames) {
            const curr_netCode =
              this.board().GetNetInfo().GetNetItem(curr_netName)?.GetNetCode() ?? 0;

            if (curr_netCode > 0) selTool.SelectAllItemsOnNet(curr_netCode);
          }

          this.canvas()?.ForceRefresh();
          this.m_frame!.UpdateMsgPanel();
        },
      )
      .then((aOk) => {
        if (aOk) {
          this.board().SynchronizeNetsAndNetClasses(false);
          // Refresh UI that depends on netclasses, such as the properties panel
          this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
        }
      });

    return 0;
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

  /** `GenerateDrillFiles` (dialog_gendrill.cpp:60-67). */
  GenerateDrillFiles(_aEvent: TOOL_EVENT): number {
    void this.getEditFrame<PCB_EDIT_FRAME>().ShowGenDrillDialog();
    return 0;
  }

  /** `GeneratePosFile` (dialog_gen_footprint_position.cpp:537-542). */
  GeneratePosFile(_aEvent: TOOL_EVENT): number {
    void this.getEditFrame<PCB_EDIT_FRAME>().ShowGenFootprintPositionDialog();
    return 0;
  }

  /** `GenIPC2581File` (files.cpp:1247): the dialog is modal, the handler returns at once. */
  GenIPC2581File(_aEvent: TOOL_EVENT): number {
    void this.getEditFrame<PCB_EDIT_FRAME>().ShowExport2581Dialog();
    return 0;
  }

  /**
   * `GenerateODBPPFiles` (files.cpp:1257): the dialog's settings, out-of-date zones refilled so
   * the export matches the layout, then DIALOG_EXPORT_ODBPP::GenerateODBPPFiles; whatever it
   * reported is shown as an error.
   */
  GenerateODBPPFiles(_aEvent: TOOL_EVENT): number {
    void this.generateODBPPFiles();
    return 0;
  }

  private async generateODBPPFiles(): Promise<void> {
    const frame = this.getEditFrame<PCB_EDIT_FRAME>();
    const dlg = await frame.ShowExportOdbppDialog();

    if (!dlg) return;

    // Refill zones if they are out-of-date so the export matches the current layout.
    const zoneFiller = this.m_toolMgr!.FindTool(
      'pcbnew.ZoneFiller',
    ) as unknown as ZONE_FILLER_TOOL | null;
    await zoneFiller?.CheckAllZones(frame);

    const board = frame.GetBoard()!;
    const job = new JOB_EXPORT_PCB_ODB();

    job.m_outputPath = dlg.outputPath;
    job.m_filename = board.GetFileName();
    job.m_compressionMode = dlg.compressFormat;
    job.m_precision = dlg.precision;
    job.m_units = dlg.units === 'mm' ? ODB_UNITS.MM : ODB_UNITS.INCH;

    const reporter = new Reporter();

    await GenerateODBPPFiles(
      job,
      board,
      {
        fileExists: (aPath) => frame.FileExists(aPath),
        confirmOverwrite: async (aMessage) =>
          (await frame.ShowKiDialog({
            caption: 'Confirmation',
            message: aMessage,
            icon: 'warning',
            labels: { ok: 'Overwrite' },
          })) === 'ok',
        write: (aPath, aBytes, aMime) => frame.WriteOutputFile(aPath, aBytes, aMime),
      },
      reporter,
    );

    if (reporter.lines.length > 0)
      DisplayErrorMessage(reporter.lines.map((l) => l.message).join('\n'));
  }

  /**
   * `ExportVRML` (dialog_export_vrml.cpp): <board>.wrl, the dialog, the origin (the user's, or
   * the board's centre), then EXPORTER_VRML.
   */
  ExportVRML(_aEvent: TOOL_EVENT): number {
    void this.exportVRML();
    return 0;
  }

  private async exportVRML(): Promise<void> {
    const frame = this.getEditFrame<PCB_EDIT_FRAME>();
    const board = frame.GetBoard()!;

    // Build default output file name
    const fullName = board.GetFileName().split(/[\\/]/).pop() ?? '';
    const dot = fullName.lastIndexOf('.');
    const path0 = `${dot > 0 ? fullName.slice(0, dot) : fullName}.wrl`;

    const dlg = await frame.ShowExportVrmlDialog(path0);

    if (!dlg) return;

    let aXRef: number;
    let aYRef: number;

    if (dlg.userDefinedOrigin) {
      aXRef = dlg.xRefMM;
      aYRef = dlg.yRefMM;
    } else {
      // Origin = board center:
      const bbox = board.ComputeBoundingBox(true, true);
      aXRef = pcbIUScale.iuToMM(bbox.GetCenter().x);
      aYRef = pcbIUScale.iuToMM(bbox.GetCenter().y);
    }

    const messages: string[] = [];
    const text = new EXPORTER_VRML(board).ExportVRML_File(
      messages,
      dlg.scale,
      !dlg.noUnspecified,
      !dlg.noDNP,
      dlg.copyFiles,
      dlg.useRelativePaths,
      dlg.subdir3Dshapes,
      aXRef,
      aYRef,
    );

    // PCB_EDIT_FRAME::ExportVRML_File shows the messages; the handler then reports the failure.
    if (messages.length > 0) DisplayErrorMessage(messages.join('\n'));

    if (text === null) {
      DisplayErrorMessage(`Failed to create file '${dlg.path}'.`);
      return;
    }

    frame.WriteOutputFile(dlg.path, new TextEncoder().encode(text), 'model/vrml');
  }

  /**
   * `ExportHyperlynx` (export_hyperlynx.cpp:669): the save dialog on <board>.hyp, the extension
   * enforced, then HYPERLYNX_EXPORTER.
   */
  ExportHyperlynx(_aEvent: TOOL_EVENT): number {
    void this.exportHyperlynx();
    return 0;
  }

  private async exportHyperlynx(): Promise<void> {
    const frame = this.getEditFrame<PCB_EDIT_FRAME>();
    const board = frame.GetBoard()!;
    const fullName = board.GetFileName().split(/[\\/]/).pop() ?? '';
    const dot = fullName.lastIndexOf('.');
    const fn = `${dot > 0 ? fullName.slice(0, dot) : fullName}.hyp`;

    const dlg = await frame.ShowSaveFileDialog(
      'Export Hyperlynx Layout',
      fn,
      { label: '*.hyp', extensions: ['hyp'] },
      null,
    );

    if (!dlg) return;

    // always enforce filename extension, user may not have entered it.
    const base = dlg.path.substring(dlg.path.lastIndexOf('/') + 1);
    const ext = base.lastIndexOf('.');
    const path =
      ext > 0 ? `${dlg.path.slice(0, dlg.path.length - base.length + ext)}.hyp` : `${dlg.path}.hyp`;

    const exporter = new HYPERLYNX_EXPORTER();
    exporter.SetBoard(board);
    exporter.SetOutputFilename(path);
    exporter.SetFileWriter((aPath, aData) =>
      frame.WriteTextFile(aPath, new TextDecoder().decode(aData)),
    );
    exporter.Run();
  }

  /** `GenD356File` (export_d356.cpp:437): the dialog is modal, the handler returns at once. */
  GenD356File(_aEvent: TOOL_EVENT): number {
    void BOARD_EDITOR_CONTROL_GenD356File(this.getEditFrame<PCB_EDIT_FRAME>());
    return 0;
  }

  /** `ExportGenCAD` (export_gencad.cpp:36): the dialog is modal, the handler returns at once. */
  ExportGenCAD(_aEvent: TOOL_EVENT): number {
    void BOARD_EDITOR_CONTROL_ExportGenCAD(this.getEditFrame<PCB_EDIT_FRAME>());
    return 0;
  }

  /**
   * `ExportCmpFile` (board_editor_control.cpp): the .cmp file name from the
   * board's, the save dialog, then RecreateCmpFile.
   */
  ExportCmpFile(_aEvent: TOOL_EVENT): number {
    void this.exportCmpFile();
    return 0;
  }

  private async exportCmpFile(): Promise<void> {
    const frame = this.getEditFrame<PCB_EDIT_FRAME>();

    // Build the .cmp file name from the board name
    const board = frame.GetBoard()!;
    const fullName = board.GetFileName().split(/[\\/]/).pop() ?? '';
    const dot = fullName.lastIndexOf('.');
    const fn = `${dot > 0 ? fullName.slice(0, dot) : fullName}.cmp`;

    const dlg = await frame.ShowSaveFileDialog(
      'Save Footprint Association File',
      fn,
      footprintAssignmentFileWildcard(),
      null,
    );

    if (!dlg) return;

    const path = dlg.path;

    // DisplayError: the same error box as DisplayErrorMessage, without extra info.
    if (!frame.WriteTextFile(path, RecreateCmpFile(board)))
      DisplayErrorMessage(`Failed to create file '${path}'.`);
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
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.GenerateDrillFiles),
      PCB_ACTIONS.generateDrillFiles.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.GeneratePosFile),
      PCB_ACTIONS.generatePosFile.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.GenIPC2581File),
      PCB_ACTIONS.generateIPC2581File.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ExportVRML),
      PCB_ACTIONS.exportVRML.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ExportHyperlynx),
      PCB_ACTIONS.exportHyperlynx.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.GenerateODBPPFiles),
      PCB_ACTIONS.generateODBPPFile.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.GenD356File),
      PCB_ACTIONS.generateD356File.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ExportGenCAD),
      PCB_ACTIONS.exportGenCAD.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ExportCmpFile),
      PCB_ACTIONS.exportCmpFile.MakeEvent(),
    );

    this.Go(SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.Find), ACTIONS.find.MakeEvent());
    this.Go(SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.FindNext), ACTIONS.findNext.MakeEvent());
    this.Go(SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.FindNext), ACTIONS.findPrevious.MakeEvent());

    this.Go(SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.CrossProbeToSch), EVENTS.PointSelectedEvent);
    this.Go(SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.CrossProbeToSch), EVENTS.SelectedEvent);
    this.Go(SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.CrossProbeToSch), EVENTS.UnselectedEvent);
    this.Go(SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.CrossProbeToSch), EVENTS.ClearedEvent);
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ExplicitCrossProbeToSch),
      PCB_ACTIONS.selectOnSchematic.MakeEvent(),
    );

    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.AssignNetclass),
      PCB_ACTIONS.assignNetClass.MakeEvent(),
    );

    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ChangeLineMode),
      PCB_ACTIONS.lineModeFree.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ChangeLineMode),
      PCB_ACTIONS.lineMode90.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.ChangeLineMode),
      PCB_ACTIONS.lineMode45.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<BOARD_EDITOR_CONTROL>(this.OnAngleSnapModeChanged),
      PCB_ACTIONS.angleSnapModeChanged.MakeEvent(),
    );
    this.Go(this.PlaceFootprint, PCB_ACTIONS.placeFootprint.MakeEvent());
  }
}
