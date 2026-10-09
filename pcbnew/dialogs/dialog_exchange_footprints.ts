// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EXCHANGE_FOOTPRINTS` (pcbnew/dialogs/dialog_exchange_footprints.cpp):
 * Tools > Update Footprints from Library and Edit > Change Footprints, one
 * dialog in two modes. The match mode picks the footprints (all, selected,
 * by reference or value wildcard, by library id), the update options say what
 * of the board copy survives, and each footprint goes through
 * PCB_EDIT_FRAME::ExchangeFootprint into one commit. The window is
 * dialog_exchange_footprints_ui.tsx.
 *
 * `LoadFootprint` reads a library, which is asynchronous here, so OnOKClicked
 * returns a Promise; KiCad's runs to completion under a busy cursor.
 */
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  Reporter,
} from '@ziroeda/common/reporter.js';
import { wildCompareString } from '@ziroeda/common/string_utils.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { FOOTPRINT } from '../footprint.js';
import { FootprintNeedsUpdate } from '../drc/drc_test_provider_library_parity.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import type { PCB_SELECTION_TOOL } from '../tools/pcb_selection_tool.js';

export const ID_MATCH_FP_ALL = 4200;
export const ID_MATCH_FP_SELECTED = 4201;
export const ID_MATCH_FP_REF = 4202;
export const ID_MATCH_FP_VAL = 4203;
export const ID_MATCH_FP_ID = 4204;

/** The four remembered match modes, one per (mode, selected) pair. */
const g_matchMode = {
  update: ID_MATCH_FP_ALL,
  updateSelected: ID_MATCH_FP_SELECTED,
  exchange: ID_MATCH_FP_REF,
  exchangeSelected: ID_MATCH_FP_SELECTED,
};

type MATCH_MODE_KEY = keyof typeof g_matchMode;

export class DIALOG_EXCHANGE_FOOTPRINTS {
  readonly m_updateMode: boolean;
  m_currentFootprint: FOOTPRINT | null;
  private readonly m_matchModeKey: MATCH_MODE_KEY;
  private m_commit: BOARD_COMMIT;
  private m_newFootprints: FOOTPRINT[] = [];

  m_specifiedRef = '';
  m_specifiedValue = '';
  m_specifiedID = '';
  m_newID = '';

  m_removeExtraBox: boolean;
  m_resetTextItemLayers: boolean;
  m_resetTextItemEffects: boolean;
  m_resetTextItemPositions: boolean;
  m_resetTextItemContent: boolean;
  m_resetFabricationAttrs: boolean;
  m_resetClearanceOverrides: boolean;
  m_reset3DModels: boolean;

  /** `m_MessageWindow`'s lines. */
  readonly m_MessageWindow = new Reporter();

  constructor(
    private readonly m_parent: PCB_EDIT_FRAME,
    aFootprint: FOOTPRINT | null,
    updateMode: boolean,
    selectedMode: boolean,
  ) {
    this.m_commit = new BOARD_COMMIT(m_parent);
    this.m_currentFootprint = aFootprint;
    this.m_updateMode = updateMode;

    // initialize controls based on update mode in case there is no saved state yet
    this.m_removeExtraBox = false;
    this.m_resetTextItemLayers = !this.m_updateMode;
    this.m_resetTextItemEffects = !this.m_updateMode;
    this.m_resetTextItemPositions = !this.m_updateMode;
    this.m_resetTextItemContent = !this.m_updateMode;
    this.m_resetFabricationAttrs = !this.m_updateMode;
    this.m_resetClearanceOverrides = true;
    this.m_reset3DModels = true;

    // initialize match-mode
    if (this.m_updateMode) this.m_matchModeKey = selectedMode ? 'updateSelected' : 'update';
    else this.m_matchModeKey = selectedMode ? 'exchangeSelected' : 'exchange';
  }

  get m_matchMode(): number {
    return g_matchMode[this.m_matchModeKey];
  }

  set m_matchMode(aMode: number) {
    g_matchMode[this.m_matchModeKey] = aMode;
  }

  GetTitle(): string {
    return this.m_updateMode ? 'Update Footprints from Library' : 'Change Footprints';
  }

  OkLabel(): string {
    return this.m_updateMode ? 'Update' : 'Change';
  }

  /** The labels the constructor rewrites for Change mode. */
  Labels(): {
    matchAll: string;
    matchSelected: string;
    matchRef: string;
    matchValue: string;
    matchID: string;
    resetTextItemLayers: string;
    resetTextItemEffects: string;
    resetTextItemPositions: string;
    resetTextItemContent: string;
    resetFabricationAttrs: string;
    resetClearanceOverrides: string;
    reset3DModels: string;
  } {
    if (this.m_updateMode) {
      return {
        matchAll: 'Update all footprints on board',
        matchSelected: 'Update selected footprint(s)',
        matchRef: 'Update footprints matching reference designator:',
        matchValue: 'Update footprints matching value:',
        matchID: 'Update footprints with library id:',
        resetTextItemLayers: 'Update/reset text layers and visibilities',
        resetTextItemEffects: 'Update/reset text sizes and styles',
        resetTextItemPositions: 'Update/reset text positions',
        resetTextItemContent: 'Update/reset text content',
        resetFabricationAttrs: 'Update/reset fabrication attributes',
        resetClearanceOverrides: 'Update/reset clearance overrides',
        reset3DModels: 'Update/reset 3D models',
      };
    }

    return {
      matchAll: 'Change all footprints on board',
      matchSelected: 'Change selected footprint(s)',
      matchRef: 'Change footprints matching reference designator:',
      matchValue: 'Change footprints matching value:',
      matchID: 'Change footprints with library id:',
      resetTextItemLayers: 'Update text layers and visibilities',
      resetTextItemEffects: 'Update text sizes and styles',
      resetTextItemPositions: 'Update text positions',
      resetTextItemContent: 'Update text content',
      resetFabricationAttrs: 'Update fabrication attributes',
      resetClearanceOverrides: 'Update clearance overrides',
      reset3DModels: 'Update 3D models',
    };
  }

  /** `m_upperSizer->FindItem( m_matchAll )->Show( false )` in Change mode. */
  ShowMatchAll(): boolean {
    return this.m_updateMode;
  }

  /** Hidden without a current footprint. */
  ShowMatchSelected(): boolean {
    return this.m_currentFootprint !== null;
  }

  /** `m_changeSizer->Show( false )` in Update mode. */
  ShowChangeSizer(): boolean {
    return !this.m_updateMode;
  }

  TransferDataToWindow(): boolean {
    if (this.m_currentFootprint) {
      if (this.m_updateMode) this.m_newID = this.m_currentFootprint.GetFPID().Format();

      this.m_specifiedRef = this.m_currentFootprint.GetReference();
      this.m_specifiedValue = this.m_currentFootprint.GetValue();
      this.m_specifiedID = this.m_currentFootprint.GetFPID().Format();
    }

    return true;
  }

  private isMatch(aFootprint: FOOTPRINT): boolean {
    const specifiedID = new LIB_ID();

    switch (this.m_matchMode) {
      case ID_MATCH_FP_ALL:
        return true;
      case ID_MATCH_FP_SELECTED:
        return aFootprint === this.m_currentFootprint || aFootprint.IsSelected();
      case ID_MATCH_FP_REF:
        return wildCompareString(this.m_specifiedRef, aFootprint.GetReference(), false);
      case ID_MATCH_FP_VAL:
        return wildCompareString(this.m_specifiedValue, aFootprint.GetValue(), false);
      case ID_MATCH_FP_ID:
        specifiedID.Parse(this.m_specifiedID);
        return aFootprint.GetFPID().equals(specifiedID);
      default:
        return false; // just to quiet compiler warnings....
    }
  }

  /** `checkAll`: the Check All / Uncheck All buttons. */
  CheckAll(aCheck: boolean): void {
    this.m_removeExtraBox = aCheck;
    this.m_resetTextItemLayers = aCheck;
    this.m_resetTextItemEffects = aCheck;
    this.m_resetTextItemPositions = aCheck;
    this.m_resetTextItemContent = aCheck;
    this.m_resetFabricationAttrs = aCheck;
    this.m_resetClearanceOverrides = aCheck;
    this.m_reset3DModels = aCheck;
  }

  async OnOKClicked(): Promise<void> {
    const selTool = this.m_parent
      .GetToolManager()!
      .FindTool('common.InteractiveSelection') as unknown as PCB_SELECTION_TOOL;

    this.m_MessageWindow.clear();

    this.m_newFootprints = [];
    await this.processMatchingFootprints();
    this.m_commit.Push(this.m_updateMode ? 'Update Footprint' : 'Change Footprint');
    // The dialog stays open, and OK again is a fresh commit (a pushed commit is empty).
    this.m_commit = new BOARD_COMMIT(this.m_parent);
    selTool.AddItemsToSel(this.m_newFootprints);

    this.m_parent.GetCanvas()?.Refresh();
  }

  private async processMatchingFootprints(): Promise<void> {
    const newFPID = new LIB_ID();

    if (this.m_parent.GetBoard()!.Footprints().length === 0) return;

    if (!this.m_updateMode) {
      newFPID.Parse(this.m_newID);

      if (!newFPID.IsValid()) return;
    }

    /*
     * NB: the change is done from the last footprint because processFootprint() modifies the
     * last item in the list.
     */
    for (const footprint of [...this.m_parent.GetBoard()!.Footprints()].reverse()) {
      if (!this.isMatch(footprint)) continue;

      if (this.m_updateMode) await this.processFootprint(footprint, footprint.GetFPID());
      else await this.processFootprint(footprint, newFPID);
    }
  }

  private async processFootprint(aFootprint: FOOTPRINT, aNewFPID: LIB_ID): Promise<void> {
    const oldFPID = aFootprint.GetFPID();
    let msg: string;

    // Load new footprint.
    if (this.m_updateMode) {
      msg = `Updated footprint ${aFootprint.GetReference()} (${oldFPID.Format()}): `;
    } else {
      msg = `Changed footprint ${aFootprint.GetReference()} from '${oldFPID.Format()}' to '${aNewFPID.Format()}': `;
    }

    const newFootprint = await this.m_parent.LoadFootprint(aNewFPID);

    if (!newFootprint) {
      msg += '*** library footprint not found ***';
      this.m_MessageWindow.report(msg, RPT_SEVERITY_ERROR);
      return;
    }

    const updated = {
      value: !this.m_updateMode || FootprintNeedsUpdate(aFootprint, newFootprint),
    };

    this.m_parent.ExchangeFootprint(
      aFootprint,
      newFootprint,
      this.m_commit,
      this.m_removeExtraBox,
      this.m_resetTextItemLayers,
      this.m_resetTextItemEffects,
      this.m_resetTextItemPositions,
      this.m_resetTextItemContent,
      this.m_resetFabricationAttrs,
      this.m_resetClearanceOverrides,
      this.m_reset3DModels,
      updated,
    );

    if (aFootprint === this.m_currentFootprint) this.m_currentFootprint = newFootprint;

    this.m_newFootprints.push(newFootprint);

    if (this.m_updateMode && !updated.value) {
      msg += ': (no changes)';
      this.m_MessageWindow.report(msg, RPT_SEVERITY_INFO);
    } else {
      msg += ': OK';
      this.m_MessageWindow.report(msg, RPT_SEVERITY_ACTION);
    }
  }

  /**
   * `ViewAndSelectFootprint`'s symbol-netlist payload for the chooser: the
   * current footprint's pad numbers and its filters, so the chooser can
   * filter the way KiCad's does.
   */
  ChooserNetlist(): { pins: string[]; filters: string } | null {
    if (!this.m_currentFootprint) return null;

    return {
      pins: [...this.m_currentFootprint.GetUniquePadNumbers()],
      filters: this.m_currentFootprint.GetFilters(),
    };
  }
}
