// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZONE_FILLER_TOOL` (pcbnew/tools/zone_filler_tool.cpp, zone_filler_tool.h),
 * on the live BOARD: Fill (the selected zones), Fill All, the automatic refill
 * of dirty zones after an edit, the out-of-date check, Unfill and Unfill All.
 */
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import { EVENTS, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { APPEND_UNDO, BOARD_COMMIT, SKIP_CONNECTIVITY, ZONE_FILL_OP } from '../board_commit.js';
import type { PAD } from '../pad.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_VIA } from '../pcb_track.js';
import { TEARDROP_MANAGER } from '../teardrop/teardrop.js';
import type { ZONE } from '../zone.js';
import { ZONE_FILLER } from '../zone_filler.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';

/** `ZONE_FILLER_TOOL_NAME`. */
export const ZONE_FILLER_TOOL_NAME = 'pcbnew.ZoneFiller';

/** What ZONE_FILLER_TOOL asks of PCB_EDIT_FRAME beyond PCB_BASE_EDIT_FRAME. */
export interface ZONE_FILLER_TOOL_FRAME {
  /** `PCB_EDIT_FRAME::m_ZoneFillsDirty`: the board changed since the last fill. */
  m_ZoneFillsDirty: boolean;
  /**
   * `infobar->ShowMessageFor( "Zone fills may be inaccurate.  DRC rules contain
   * errors.", 10000, wxICON_WARNING )`, with its "Show DRC rules" link.
   */
  ShowZoneFillRulesWarning(): void;
  /**
   * `infobar->ShowMessageFor( "Automatic refill of zones can be turned off in
   * Preferences if it becomes too slow.", 10000, wxICON_INFORMATION )`, with
   * its "Open Preferences" link, after an auto-refill that took over 3 s.
   */
  ShowZoneAutoRefillSlowMessage(): void;
  /** `KIDIALOG( frame, ... ).ShowModal()`: ZONE_FILLER's out-of-date question. */
  AskKiDialog(aRequest: KiDialogRequest): Promise<KiDialogResult>;
}

type FRAME = PCB_BASE_EDIT_FRAME & ZONE_FILLER_TOOL_FRAME;

export class ZONE_FILLER_TOOL extends PCB_TOOL_BASE {
  private m_fillInProgress = false;
  private m_filler: ZONE_FILLER | null = null;
  /** `m_dirtyZoneIDs`: the zones an edit touched, for the next ZoneFillDirty. */
  private m_dirtyZoneIDs = new Set<string>();

  constructor() {
    super(ZONE_FILLER_TOOL_NAME);
  }

  override Reset(): void {}

  private editFrame(): FRAME {
    return this.getEditFrame<FRAME>();
  }

  /**
   * `CheckAllZones( aCaller, aReporter )`: when the board changed since the last
   * fill, re-pour and, if any fill moved, ask before keeping it.
   */
  async CheckAllZones(
    _aCaller: unknown = null,
    aReporter: PROGRESS_REPORTER | null = null,
  ): Promise<void> {
    const frame = this.editFrame();

    if (!frame.m_ZoneFillsDirty || this.m_fillInProgress) return;

    this.m_fillInProgress = true;

    const toFill: ZONE[] = [...this.board().Zones()];
    const commit = new BOARD_COMMIT(this);

    this.m_filler = new ZONE_FILLER(this.board(), commit);

    // `WX_PROGRESS_REPORTER( aCaller, "Check Zones", 4, PR_CAN_ABORT )` when none
    // was passed: the pour runs on this thread, so there is no window to show.
    if (aReporter) this.m_filler.SetProgressReporter(aReporter);

    try {
      if (await this.m_filler.CheckFill(toFill, (r) => frame.AskKiDialog(r))) {
        commit.Push('Fill Zone(s)', SKIP_CONNECTIVITY | ZONE_FILL_OP);
        frame.m_ZoneFillsDirty = false;
      } else {
        commit.Revert();
      }

      this.rebuildConnectivity();
      this.refresh();
    } finally {
      this.m_fillInProgress = false;
      this.m_filler = null;
    }
  }

  /** `IsBusy()`: a fill is running. */
  IsBusy(): boolean {
    return this.m_fillInProgress;
  }

  /** `FillAllZones( aCaller, aReporter, aHeadless )`. */
  FillAllZones(
    _aCaller: unknown = null,
    aReporter: PROGRESS_REPORTER | null = null,
    aHeadless = false,
  ): void {
    if (this.m_fillInProgress) return;

    this.m_fillInProgress = true;

    const frame = aHeadless ? null : this.editFrame();
    const board = this.board();
    const commit = new BOARD_COMMIT(this);
    const teardropMgr = new TEARDROP_MANAGER(board, this.m_toolMgr);
    const toFill: ZONE[] = [];

    teardropMgr.UpdateTeardrops(commit, [], new Set(), true /* forceFullUpdate */);

    board.IncrementTimeStamp(); // Clear caches

    for (const zone of board.Zones()) toFill.push(zone);

    this.m_filler = new ZONE_FILLER(board, commit);

    if (!aHeadless && !board.GetDesignSettings().m_DRCEngine?.RulesValid())
      frame!.ShowZoneFillRulesWarning();

    // `WX_PROGRESS_REPORTER( aCaller, "Fill All Zones", 5, PR_CAN_ABORT )` when no
    // reporter was passed: the pour runs on this thread here, so there is no
    // window to show while it does.
    if (aReporter) this.m_filler.SetProgressReporter(aReporter);

    if (this.m_filler.Fill(toFill)) {
      this.m_filler.GetProgressReporter()?.AdvancePhase();

      commit.Push('Fill Zone(s)', SKIP_CONNECTIVITY | ZONE_FILL_OP);

      if (!aHeadless) frame!.m_ZoneFillsDirty = false;
    } else {
      commit.Revert();
    }

    this.rebuildConnectivity(aHeadless);

    if (!aHeadless) this.refresh();

    this.m_fillInProgress = false;
    this.m_filler = null;
  }

  /** `DirtyZone( aZone )`: BOARD_COMMIT marks a zone its push left stale. */
  DirtyZone(aZone: ZONE): void {
    this.m_dirtyZoneIDs.add(aZone.m_Uuid);
  }

  /**
   * `ZoneFillDirty` (zone_filler_tool.cpp:207-313): the automatic refill after
   * an edit, of every unfilled zone and every zone a commit marked dirty,
   * appended to that edit's undo step.
   */
  ZoneFillDirty(_aEvent: TOOL_EVENT): number {
    const frame = this.editFrame();
    const toFill: ZONE[] = [];

    for (const zone of this.board().Zones()) {
      if (!zone.IsFilled() || this.m_dirtyZoneIDs.has(zone.m_Uuid)) toFill.push(zone);
    }

    if (toFill.length === 0) return 0;

    if (this.m_fillInProgress) return 0;

    const startTime = performance.now();
    this.m_fillInProgress = true;

    this.m_dirtyZoneIDs.clear();

    this.board().IncrementTimeStamp(); // Clear caches

    const commit = new BOARD_COMMIT(this);

    this.m_filler = new ZONE_FILLER(this.board(), commit);

    if (!this.board().GetDesignSettings().m_DRCEngine?.RulesValid())
      frame.ShowZoneFillRulesWarning();

    // Upstream shows a WX_PROGRESS_REPORTER past 1000 fill points; the pour runs
    // on this thread here, so there is no window to show while it does.

    if (this.m_filler.Fill(toFill))
      commit.Push('Auto-fill Zone(s)', APPEND_UNDO | SKIP_CONNECTIVITY | ZONE_FILL_OP);
    else commit.Revert();

    this.rebuildConnectivity();
    this.refresh();

    if (performance.now() - startTime > 3000)
      // 3 seconds
      frame.ShowZoneAutoRefillSlowMessage();

    this.m_fillInProgress = false;
    this.m_filler = null;

    return 0;
  }

  /**
   * `ZoneFill` (zone_filler_tool.cpp:316-377): fill the zone passed with the
   * event, else the selected zones.
   */
  ZoneFill(aEvent: TOOL_EVENT): number {
    if (this.m_fillInProgress) return -1; // wxBell()

    const toFill: ZONE[] = [];
    const passedZone = aEvent.HasParameter() ? aEvent.Parameter<ZONE | null>() : null;

    if (passedZone) {
      toFill.push(passedZone);
    } else {
      const selTool = this.m_toolMgr!.FindTool(
        'common.InteractiveSelection',
      ) as unknown as PCB_SELECTION_TOOL;
      const sel = selTool.RequestSelection(() => {});

      for (const item of sel) {
        if (item.Type() === KICAD_T.PCB_ZONE_T) toFill.push(item as unknown as ZONE);
      }
    }

    // Bail out of the filler if there is nothing to fill
    if (toFill.length === 0) return -1; // wxBell()

    this.m_fillInProgress = true;

    const commit = new BOARD_COMMIT(this);

    this.m_filler = new ZONE_FILLER(this.board(), commit);

    if (this.m_filler.Fill(toFill)) {
      this.m_filler.GetProgressReporter()?.AdvancePhase();
      commit.Push('Fill Zone(s)', SKIP_CONNECTIVITY | ZONE_FILL_OP);
    } else {
      commit.Revert();
    }

    this.rebuildConnectivity();
    this.refresh();

    this.m_fillInProgress = false;
    this.m_filler = null;
    return 0;
  }

  ZoneFillAll(_aEvent: TOOL_EVENT): number {
    this.FillAllZones(this.frame());
    return 0;
  }

  ZoneUnfill(_aEvent: TOOL_EVENT): number {
    const selTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;
    const sel = selTool.RequestSelection(() => {});
    const toUnfill: ZONE[] = [];

    for (const item of sel) {
      if (item.Type() === KICAD_T.PCB_ZONE_T) toUnfill.push(item as unknown as ZONE);
    }

    // Bail out if there are no zones
    if (toUnfill.length === 0) return -1; // wxBell()

    const commit = new BOARD_COMMIT(this);

    for (const zone of toUnfill) {
      commit.Modify(zone);

      zone.UnFill();
    }

    commit.Push('Unfill Zone', ZONE_FILL_OP);

    this.refresh();

    return 0;
  }

  ZoneUnfillAll(_aEvent: TOOL_EVENT): number {
    const commit = new BOARD_COMMIT(this);

    for (const zone of this.board().Zones()) {
      commit.Modify(zone);

      zone.UnFill();
    }

    commit.Push('Unfill All Zones', ZONE_FILL_OP);

    this.refresh();

    return 0;
  }

  GetProgressReporter(): PROGRESS_REPORTER | null {
    if (this.m_fillInProgress && this.m_filler) return this.m_filler.GetProgressReporter();
    else return null;
  }

  private rebuildConnectivity(aHeadless = false): void {
    this.board().BuildConnectivity();
    this.m_toolMgr?.PostEvent(EVENTS.ConnectivityChangedEvent);

    if (!aHeadless) this.canvas()?.RedrawRatsnest();
  }

  private refresh(): void {
    // Note: KIGFX::REPAINT isn't enough for things that go from invisible to visible as
    // they won't be found in the view layer's itemset for re-painting.
    this.canvas()
      ?.GetView()
      .UpdateAllItemsConditionally(VIEW_UPDATE_FLAGS.ALL, (aItem) => {
        const item = aItem as unknown as { Type?(): KICAD_T };

        if (item.Type?.() === KICAD_T.PCB_VIA_T)
          return (aItem as unknown as PCB_VIA).GetRemoveUnconnected();
        else if (item.Type?.() === KICAD_T.PCB_PAD_T)
          return (aItem as unknown as PAD).GetRemoveUnconnected();

        return false;
      });

    this.canvas()?.Refresh();
  }

  /** `IsZoneFillAction`: a user's fill or unfill, not the system's zoneFillDirty. */
  static IsZoneFillAction(aEvent: TOOL_EVENT): boolean {
    return (
      aEvent.IsAction(PCB_ACTIONS.zoneFill) ||
      aEvent.IsAction(PCB_ACTIONS.zoneFillAll) ||
      aEvent.IsAction(PCB_ACTIONS.zoneUnfill) ||
      aEvent.IsAction(PCB_ACTIONS.zoneUnfillAll)
    );
  }

  protected override setTransitions(): void {
    const S = SYNC_HANDLER<ZONE_FILLER_TOOL>;

    // Zone actions
    this.Go(S(this.ZoneFill), PCB_ACTIONS.zoneFill.MakeEvent());
    this.Go(S(this.ZoneFillAll), PCB_ACTIONS.zoneFillAll.MakeEvent());
    this.Go(S(this.ZoneFillDirty), PCB_ACTIONS.zoneFillDirty.MakeEvent());
    this.Go(S(this.ZoneUnfill), PCB_ACTIONS.zoneUnfill.MakeEvent());
    this.Go(S(this.ZoneUnfillAll), PCB_ACTIONS.zoneUnfillAll.MakeEvent());
  }
}
