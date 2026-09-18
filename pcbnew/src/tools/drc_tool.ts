// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/drc_tool.h` + `.cpp`: the tool that owns the DRC dialog and
 * runs the engine over the board, the violations landing as PCB_MARKERs in a
 * BOARD_COMMIT.
 *
 * The dialog is a window the frame creates (`DRC_TOOL_FRAME.CreateDrcDialog`);
 * the tool drives it through `DIALOG_DRC_LIKE`, the subset of DIALOG_DRC's
 * surface the C++ tool calls. The Design Rule Editor dialog is not ported.
 */
import { ACTIONS } from '@ziroeda/common/src/tool/actions.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/src/progress_reporter.js';
import type { RC_ITEM } from '@ziroeda/common/src/rc_item.js';
import type { COROUTINE_BODY } from '@ziroeda/common/src/tool/coroutine.js';
import type { RESET_REASON, TOOL_STATE_FUNC } from '@ziroeda/common/src/tool/tool_base.js';
import { EVENTS, type TOOL_EVENT } from '@ziroeda/common/src/tool/tool_event.js';
import type { TOOL_ACTION } from '@ziroeda/common/src/tool/tool_action.js';
import { BaseType, KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import { BOARD_COMMIT, SKIP_SET_DIRTY, SKIP_UNDO } from '../board_commit.js';
import type { DRC_ENGINE } from '../drc/drc_engine.js';
import { type DRC_ITEM, PCB_DRC_CODE } from '../drc/drc_item.js';
import { FOOTPRINT } from '../footprint.js';
import { NETLIST } from '../netlist_reader/pcb_netlist.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_MARKER } from '../pcb_marker.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';

/** The DIALOG_DRC surface DRC_TOOL drives. */
export interface DIALOG_DRC_LIKE {
  Show(aShow: boolean): void;
  ShowModal(): void;
  Raise(): void;
  IsShownOnScreen(): boolean;
  Destroy(): void;
  UpdateData(): void;
  SetDrcRun(): void;
  SetFootprintTestsRun(): void;
  PrevMarker(): void;
  NextMarker(): void;
  SelectMarker(aMarker: PCB_MARKER): void;
  ExcludeMarker(): void;
}

/**
 * `ZONE_FILLER_TOOL` as RunTests uses it, found by its tool name
 * (`pcbnew.ZoneFiller`) until stage 3 supplies the class.
 */
export interface ZONE_FILLER_TOOL_LIKE {
  IsBusy(): boolean;
  FillAllZones(aCaller: unknown, aReporter: PROGRESS_REPORTER | null): void;
}

/** `PCB_EDIT_FRAME` as DRC_TOOL reads it (the frame class lives in the designer). */
export interface DRC_TOOL_FRAME extends PCB_BASE_EDIT_FRAME {
  /** `new DIALOG_DRC( m_editFrame, aParent )`: the window is the frame's to make. */
  CreateDrcDialog(aTool: DRC_TOOL, aParent: unknown): DIALOG_DRC_LIKE;
  /** `Kiface().IsSingle()`: true when no schematic accompanies the board. */
  IsSingle(): boolean;
  FetchNetlistFromSchematic(aNetlist: NETLIST, aAnnotateMessage: string): boolean;
  ResolveDRCExclusions(aCreateMarkers: boolean): void;
  OnEditItemRequest(aItem: BOARD_ITEM | null): void;
  /** `DIALOG_EXCHANGE_FOOTPRINTS( m_editFrame, footprint, updateMode, true ).ShowQuasiModal()`. */
  ShowExchangeFootprintsDialog(aFootprint: FOOTPRINT, aUpdateMode: boolean): void;
}

export class DRC_TOOL extends PCB_TOOL_BASE {
  private m_editFrame: DRC_TOOL_FRAME | null = null;
  private m_pcb: BOARD | null = null;
  private m_drcDialog: DIALOG_DRC_LIKE | null = null;
  private m_drcRunning = false;
  private m_drcEngine: DRC_ENGINE | null = null;

  constructor() {
    super('pcbnew.DRCTool');
  }

  override Reset(_aReason: RESET_REASON): void {
    this.m_editFrame = this.getEditFrame<DRC_TOOL_FRAME>();

    if (this.m_pcb !== this.m_editFrame.GetBoard()) {
      if (this.m_drcDialog) this.DestroyDRCDialog();

      this.m_pcb = this.m_editFrame.GetBoard();
      this.m_drcEngine = this.m_pcb!.GetDesignSettings().m_DRCEngine;
    }
  }

  /**
   * Opens the DRC dialog.  The dialog is only created if it is not already in existence.
   *
   * @param aParent is the parent window for modal invocations.  If nullptr, the parent will
   * be the PCB_EDIT_FRAME and the dialog will be modeless.
   */
  ShowDRCDialog(aParent: unknown): void;
  ShowDRCDialog(aEvent: TOOL_EVENT): number;
  ShowDRCDialog(aParent: unknown): number | void {
    // the TOOL_EVENT form: `ShowDRCDialog( nullptr ); return 0;`
    if (aParent && typeof aParent === 'object' && 'Matches' in (aParent as object)) {
      this.ShowDRCDialog(null);
      return 0;
    }

    let show_dlg_modal = true;

    // the dialog needs a parent frame. if it is not specified, this is the PCB editor frame
    // specified in DRC_TOOL class.
    if (!aParent) {
      // if any parent is specified, the dialog is modal.
      // if this is the default PCB editor frame, it is not modal
      show_dlg_modal = false;
      aParent = this.m_editFrame;
    }

    this.Activate();
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    if (!this.m_drcDialog) {
      this.m_drcDialog = this.m_editFrame!.CreateDrcDialog(this, aParent);
      this.updatePointers(false);

      if (show_dlg_modal) this.m_drcDialog.ShowModal();
      else this.m_drcDialog.Show(true);
    } // The dialog is just not visible (because the user has double clicked on an error item)
    else {
      this.updatePointers(false);
      this.m_drcDialog.Show(true);
    }
  }

  GetDRCDialog(): DIALOG_DRC_LIKE | null {
    return this.m_drcDialog;
  }

  /**
   * Check to see if the DRC_TOOL dialog is currently shown
   */
  IsDRCDialogShown(): boolean {
    if (this.m_drcDialog) return this.m_drcDialog.IsShownOnScreen();

    return false;
  }

  /**
   * Check to see if the DRC engine is running the tests
   */
  IsDRCRunning(): boolean {
    return this.m_drcRunning;
  }

  /**
   * Close and free the DRC dialog.
   */
  DestroyDRCDialog(): void {
    if (this.m_drcDialog) {
      this.m_drcDialog.Destroy();
      this.m_drcDialog = null;
    }
  }

  GetDRCEngine(): DRC_ENGINE | null {
    return this.m_drcEngine;
  }

  /**
   * Run the DRC tests.
   */
  RunTests(
    aProgressReporter: PROGRESS_REPORTER,
    aRefillZones: boolean,
    aReportAllTrackErrors: boolean,
    aTestFootprints: boolean,
  ): void {
    // One at a time, please.
    // Note that the main GUI entry points to get here are blocked, so this is really an
    // insurance policy and as such we make no attempts to queue up the DRC run or anything.
    if (this.m_drcRunning) return;

    const zoneFiller = this.m_toolMgr!.FindTool(
      'pcbnew.ZoneFiller',
    ) as unknown as ZONE_FILLER_TOOL_LIKE | null;
    const commit = new BOARD_COMMIT(this.m_editFrame!);
    const netlist = new NETLIST();
    let netlistFetched = false;

    // wxWindowDisabler disabler( m_drcDialog ): the dialog's own "running" state

    this.m_drcRunning = true;

    if (this.m_drcDialog) {
      if (aRefillZones) {
        aProgressReporter.AdvancePhase('Refilling all zones...');

        zoneFiller?.FillAllZones(this.m_drcDialog, aProgressReporter);
      }

      this.m_drcEngine!.SetDrawingSheet(this.m_editFrame!.GetCanvas()?.GetDrawingSheet() ?? null);

      if (aTestFootprints && !this.m_editFrame!.IsSingle()) {
        if (
          this.m_editFrame!.FetchNetlistFromSchematic(
            netlist,
            'Schematic parity tests require a fully annotated schematic.',
          )
        ) {
          netlistFetched = true;
        }

        if (this.m_drcDialog) this.m_drcDialog.Raise();

        this.m_drcEngine!.SetSchematicNetlist(netlist);
      }
    }

    this.m_drcEngine!.SetProgressReporter(aProgressReporter);

    this.m_drcEngine!.SetViolationHandler(
      (
        aItem: DRC_ITEM,
        aPos: VECTOR2I,
        aLayer: number,
        aPathGenerator: (aMarker: PCB_MARKER) => void,
      ) => {
        const marker = new PCB_MARKER(aItem, aPos, aLayer);
        aPathGenerator(marker);
        commit.Add(marker);
      },
    );

    this.m_drcEngine!.RunTests(
      this.m_editFrame!.GetUserUnits(),
      aReportAllTrackErrors,
      aTestFootprints,
      commit,
    );

    this.m_drcEngine!.SetProgressReporter(null);
    this.m_drcEngine!.ClearViolationHandler();

    if (this.m_drcDialog) {
      this.m_drcDialog.SetDrcRun();

      if (aTestFootprints && netlistFetched) this.m_drcDialog.SetFootprintTestsRun();
    }

    commit.Push('DRC', SKIP_UNDO | SKIP_SET_DIRTY);

    this.m_drcRunning = false;

    this.m_editFrame!.ShowSolderMask();

    // update the m_drcDialog listboxes
    this.updatePointers(aProgressReporter.IsCancelled());
  }

  /**
   * Update needed pointers from the one pointer which is known not to change.
   */
  private updatePointers(aDRCWasCancelled: boolean): void {
    // update my pointers, m_editFrame is the only unchangeable one
    this.m_pcb = this.m_editFrame!.GetBoard();

    this.m_editFrame!.ResolveDRCExclusions(aDRCWasCancelled);

    if (this.m_drcDialog) this.m_drcDialog.UpdateData();
  }

  PrevMarker(_aEvent: TOOL_EVENT): number {
    if (this.m_drcDialog) {
      this.m_drcDialog.Show(true);
      this.m_drcDialog.Raise();
      this.m_drcDialog.PrevMarker();
    } else {
      this.ShowDRCDialog(null);
    }

    return 0;
  }

  NextMarker(_aEvent: TOOL_EVENT): number {
    if (this.m_drcDialog) {
      this.m_drcDialog.Show(true);
      this.m_drcDialog.Raise();
      this.m_drcDialog.NextMarker();
    } else {
      this.ShowDRCDialog(null);
    }

    return 0;
  }

  CrossProbe(aEvent: TOOL_EVENT): number;
  /**
   * A more "active" CrossProbe which will open the DRC dialog if it is closed.  Used when
   * double-clicking on a marker.
   */
  CrossProbe(aMarker: PCB_MARKER): void;
  CrossProbe(a: TOOL_EVENT | PCB_MARKER): number | void {
    if (a instanceof PCB_MARKER) {
      if (!this.IsDRCDialogShown()) this.ShowDRCDialog(null);

      this.m_drcDialog!.SelectMarker(a);
      return;
    }

    if (this.m_drcDialog && this.m_drcDialog.IsShownOnScreen()) {
      const selection = this.selection();

      if (selection.GetSize() === 1 && selection.Front()!.Type() === KICAD_T.PCB_MARKER_T)
        this.m_drcDialog.SelectMarker(selection.Front() as PCB_MARKER);
    }

    return 0;
  }

  ExcludeMarker(_aEvent: TOOL_EVENT): number {
    if (this.m_drcDialog) this.m_drcDialog.ExcludeMarker();

    return 0;
  }

  FixDRCErrorMenuText(aDRCItem: RC_ITEM): string {
    const frame = this.frame<DRC_TOOL_FRAME>();
    const desc = (aAction: TOOL_ACTION): string => frame.GetRunMenuCommandDescription(aAction);

    if (aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES) {
      return desc(ACTIONS.showFootprintLibTable);
    } else if (aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH) {
      return desc(PCB_ACTIONS.updateFootprint);
    } else if (aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS) {
      return desc(PCB_ACTIONS.changeFootprint);
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT
    ) {
      return desc(ACTIONS.updatePcbFromSchematic);
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_FOOTPRINT_TYPE_MISMATCH ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_FOOTPRINT
    ) {
      return 'Edit Footprint Properties...';
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_PADSTACK ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_PADSTACK_INVALID
    ) {
      return 'Edit Pad Properties...';
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_TEXT_HEIGHT ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_TEXT_THICKNESS ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_MIRRORED_TEXT_ON_FRONT_LAYER ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER
    ) {
      const item = this.m_pcb!.ResolveItem(aDRCItem.GetMainItemID());

      if (item && BaseType(item.Type()) === KICAD_T.PCB_DIMENSION_T)
        return 'Edit Dimension Properties...';
      else if (item && item.Type() === KICAD_T.PCB_FIELD_T) return 'Edit Field Properties...';
      else return 'Edit Text Properties...';
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_DANGLING_TRACK ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_DANGLING_VIA
    ) {
      return desc(PCB_ACTIONS.cleanupTracksAndVias);
    }

    return '';
  }

  FixDRCError(aDRCItem: RC_ITEM): void {
    if (aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES) {
      this.m_toolMgr!.RunAction(ACTIONS.showFootprintLibTable);
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS
    ) {
      const updateMode = aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH;
      const item = this.m_pcb!.ResolveItem(aDRCItem.GetMainItemID());

      if (item instanceof FOOTPRINT)
        this.m_editFrame!.ShowExchangeFootprintsDialog(item, updateMode);
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT
    ) {
      this.m_toolMgr!.RunAction(ACTIONS.updatePcbFromSchematic);
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_FOOTPRINT_TYPE_MISMATCH ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_FOOTPRINT ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_PADSTACK ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_PADSTACK_INVALID ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_TEXT_HEIGHT ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_TEXT_THICKNESS ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_MIRRORED_TEXT_ON_FRONT_LAYER ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER
    ) {
      const item = this.m_pcb!.ResolveItem(aDRCItem.GetMainItemID());

      this.m_editFrame!.OnEditItemRequest(item);
    } else if (
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_DANGLING_TRACK ||
      aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_DANGLING_VIA
    ) {
      this.m_toolMgr!.RunAction(PCB_ACTIONS.cleanupTracksAndVias);
    }
  }

  ///< Set up handlers for various events.
  protected override setTransitions(): void {
    // The C++ handlers are plain `int f( const TOOL_EVENT& )`; a state function
    // here is a coroutine body, so each is wrapped in a generator that returns
    // its result at once.
    const sync = (f: (aEvent: TOOL_EVENT) => number): TOOL_STATE_FUNC =>
      // biome-ignore lint/correctness/useYield: a plain handler, returned as a finished coroutine
      function* (this: DRC_TOOL, aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
        return f.call(this, aEvent);
      };

    this.Go(
      sync(this.ShowDRCDialog as (aEvent: TOOL_EVENT) => number),
      PCB_ACTIONS.runDRC.MakeEvent(),
    );
    this.Go(sync(this.PrevMarker), ACTIONS.prevMarker.MakeEvent());
    this.Go(sync(this.NextMarker), ACTIONS.nextMarker.MakeEvent());
    this.Go(sync(this.ExcludeMarker), ACTIONS.excludeMarker.MakeEvent());
    this.Go(sync(this.CrossProbe as (aEvent: TOOL_EVENT) => number), EVENTS.PointSelectedEvent);
    this.Go(sync(this.CrossProbe as (aEvent: TOOL_EVENT) => number), EVENTS.SelectedEvent);
  }
}
