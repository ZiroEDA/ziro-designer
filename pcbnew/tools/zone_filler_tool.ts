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
import {
  type FILL_JOB_HOOKS,
  type FILL_JOB_REQUEST,
  type FILL_JOB_RESULT,
  applyFillJobResult,
} from '../browser/fill_job.js';
import {
  CTL_ENUMERATE_LAYERS,
  CTL_FOR_BOARD,
  FormatBoardAsync,
} from '../pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { WX_PROGRESS_REPORTER } from '@ziroeda/common/widgets/wx_progress_reporters.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

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
  /**
   * Not KiCad's: `ZONE_FILLER::Fill` on another thread (fill_job.ts). Absent - the footprint
   * editor, a headless run - the pour runs here, as upstream.
   */
  RunFillJob?(aRequest: FILL_JOB_REQUEST, aHooks: FILL_JOB_HOOKS): Promise<FILL_JOB_RESULT | null>;
  /** `WX_PROGRESS_REPORTER( frame, aTitle, 5, PR_CAN_ABORT )`, or null with no window. */
  OpenProgressReporter?(aTitle: string): WX_PROGRESS_REPORTER | null;
  GetProjectText?(): string | null;
  GetDesignRulesText?(): string | null;
  GetDesignRulesPath?(): string;
}

type FRAME = PCB_BASE_EDIT_FRAME & ZONE_FILLER_TOOL_FRAME;

export class ZONE_FILLER_TOOL extends PCB_TOOL_BASE {
  private m_fillInProgress = false;
  /** Not KiCad's: the fill a tool event started, which may still be pouring on a worker. */
  private m_pendingFill: Promise<void> | null = null;
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
        commit.Push(_('Fill Zone(s)'), SKIP_CONNECTIVITY | ZONE_FILL_OP);
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

  /**
   * `m_filler->Fill( aZones )`, where it can run: on the frame's worker when the frame has one,
   * else here. On the worker it is the same filler over the same board text (fill_job.ts), and
   * what it leaves is installed on this board; `Fill`'s own `m_commit->Modify( zone )` happens
   * here first, so the commit holds the zones as they were. Cancel leaves the board untouched.
   */
  private async fill(aZones: ZONE[], aCommit: BOARD_COMMIT): Promise<boolean> {
    const filler = this.m_filler!;
    const frame = this.frame() as Partial<FRAME> | null;

    if (!frame?.RunFillJob) return filler.Fill(aZones);

    const reporter = filler.GetProgressReporter();
    const board = this.board();

    for (const zone of aZones) {
      if (!zone.GetIsRuleArea() && zone.GetNumCorners() > 2) aCommit.Modify(zone);
    }

    const yieldToUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const cancelled = (): boolean => reporter?.IsCancelled() ?? false;

    reporter?.Report('Preparing the board...');
    reporter?.KeepRefreshing();

    // `CTL_ENUMERATE_LAYERS`, as the DRC job's: a transport, not a save.
    const boardText = await FormatBoardAsync(
      board,
      yieldToUI,
      cancelled,
      undefined,
      undefined,
      CTL_FOR_BOARD | CTL_ENUMERATE_LAYERS,
    );

    if (boardText === null) return false;

    let result: FILL_JOB_RESULT | null;

    try {
      result = await frame.RunFillJob(
        {
          boardText,
          boardPath: board.GetFileName(),
          boardUuid: board.m_Uuid,
          projectText: frame.GetProjectText?.() ?? null,
          rulesText: frame.GetDesignRulesText?.() ?? null,
          rulesPath: frame.GetDesignRulesPath?.() ?? '',
          zones: aZones.map((z) => z.m_Uuid),
        },
        {
          onPhase: (aMessage) => {
            reporter?.Report(aMessage);
            reporter?.KeepRefreshing();
          },
          onProgress: (aValue) => {
            reporter?.SetCurrentProgress(aValue);
            reporter?.KeepRefreshing();
          },
          isCancelled: cancelled,
        },
      );
    } catch (e) {
      // The worker failed: a fill that did not happen, as a cancelled one - the caller reverts,
      // and the board keeps the fills it had.
      console.error('Zone fill failed:', e);
      return false;
    }

    if (!result) return false;

    applyFillJobResult(board, result);

    return result.filled;
  }

  /** The frame's progress dialog for a fill, when there is a window to show it in. */
  private openReporter(aTitle: string): WX_PROGRESS_REPORTER | null {
    return (this.frame() as Partial<FRAME> | null)?.OpenProgressReporter?.(aTitle) ?? null;
  }

  /** Not KiCad's: resolves once the fill a tool event started has been installed and pushed. */
  async WaitForFill(): Promise<void> {
    await this.m_pendingFill;
  }

  /** `IsBusy()`: a fill is running. */
  IsBusy(): boolean {
    return this.m_fillInProgress;
  }

  /** `FillAllZones( aCaller, aReporter, aHeadless )`. */
  async FillAllZones(
    _aCaller: unknown = null,
    aReporter: PROGRESS_REPORTER | null = null,
    aHeadless = false,
  ): Promise<void> {
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
    // reporter was passed.
    const ownReporter = aReporter || aHeadless ? null : this.openReporter(_('Fill All Zones'));

    if (aReporter ?? ownReporter) this.m_filler.SetProgressReporter(aReporter ?? ownReporter);

    let filled: boolean;

    try {
      filled = await this.fill(toFill, commit);
    } finally {
      ownReporter?.Close();
    }

    if (filled) {
      this.m_filler.GetProgressReporter()?.AdvancePhase();

      commit.Push(_('Fill Zone(s)'), SKIP_CONNECTIVITY | ZONE_FILL_OP);

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
    this.m_pendingFill = this.zoneFillDirty();
    return 0;
  }

  private async zoneFillDirty(): Promise<void> {
    const frame = this.editFrame();
    const toFill: ZONE[] = [];

    for (const zone of this.board().Zones()) {
      if (!zone.IsFilled() || this.m_dirtyZoneIDs.has(zone.m_Uuid)) toFill.push(zone);
    }

    if (toFill.length === 0) return;

    if (this.m_fillInProgress) return;

    const startTime = performance.now();
    this.m_fillInProgress = true;

    this.m_dirtyZoneIDs.clear();

    this.board().IncrementTimeStamp(); // Clear caches

    const commit = new BOARD_COMMIT(this);

    this.m_filler = new ZONE_FILLER(this.board(), commit);

    if (!this.board().GetDesignSettings().m_DRCEngine?.RulesValid())
      frame.ShowZoneFillRulesWarning();

    // A WX_PROGRESS_REPORTER past 1000 fill points.
    let pts = 0;
    let reporter: WX_PROGRESS_REPORTER | null = null;

    for (const zone of toFill) {
      for (const layer of zone.GetLayerSet().Seq())
        pts += zone.GetFilledPolysList(layer).FullPointCount();

      if (pts > 1000) {
        reporter = this.openReporter(wxFormat(_('Refill %d Zones'), toFill.length));
        this.m_filler.SetProgressReporter(reporter);
        break;
      }
    }

    let filled: boolean;

    try {
      filled = await this.fill(toFill, commit);
    } finally {
      reporter?.Close();
    }

    if (filled) commit.Push(_('Auto-fill Zone(s)'), APPEND_UNDO | SKIP_CONNECTIVITY | ZONE_FILL_OP);
    else commit.Revert();

    this.rebuildConnectivity();
    this.refresh();

    if (performance.now() - startTime > 3000)
      // 3 seconds
      frame.ShowZoneAutoRefillSlowMessage();

    this.m_fillInProgress = false;
    this.m_filler = null;

    return;
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

    this.m_pendingFill = this.zoneFill(toFill);
    return 0;
  }

  private async zoneFill(toFill: ZONE[]): Promise<void> {
    const commit = new BOARD_COMMIT(this);

    this.m_filler = new ZONE_FILLER(this.board(), commit);

    const reporter = this.openReporter(_('Fill Zone'));
    this.m_filler.SetProgressReporter(reporter);

    let filled: boolean;

    try {
      filled = await this.fill(toFill, commit);
    } finally {
      reporter?.Close();
    }

    if (filled) {
      this.m_filler.GetProgressReporter()?.AdvancePhase();
      commit.Push(_('Fill Zone(s)'), SKIP_CONNECTIVITY | ZONE_FILL_OP);
    } else {
      commit.Revert();
    }

    this.rebuildConnectivity();
    this.refresh();

    this.m_fillInProgress = false;
    this.m_filler = null;
  }

  ZoneFillAll(_aEvent: TOOL_EVENT): number {
    this.m_pendingFill = this.FillAllZones(this.frame());
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

    commit.Push(_('Unfill Zone'), ZONE_FILL_OP);

    this.refresh();

    return 0;
  }

  ZoneUnfillAll(_aEvent: TOOL_EVENT): number {
    const commit = new BOARD_COMMIT(this);

    for (const zone of this.board().Zones()) {
      commit.Modify(zone);

      zone.UnFill();
    }

    commit.Push(_('Unfill All Zones'), ZONE_FILL_OP);

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
