// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Teardrops, the global edit behind `Edit → Edit Teardrops…`.
 * Counterpart: `pcbnew/dialogs/dialog_global_edit_teardrops.cpp`
 * (`setSpecifiedParams`, `processItem`, `visitItem`, `TransferDataFromWindow`),
 * over the live BOARD: the items' TEARDROP_PARAMETERS are staged on a
 * BOARD_COMMIT and TEARDROP_MANAGER rebuilds the zones, as upstream does.
 *
 * The dialog does not draw teardrops. It writes `(teardrops …)` onto the pads
 * and vias the filters select, and only then lets the manager rebuild — which
 * is why "remove" here means `m_Enabled = false` on the item rather than
 * deleting a zone: the zones are derived, the per-item parameters are the state.
 *
 * GLOBAL_EDIT_TOOL::EditTeardrops builds it; the window is
 * dialog_global_edit_teardrops_ui.tsx.
 */

import { CHANGE_TYPE } from '@ziroeda/common/commit.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import { APPEND_UNDO, BOARD_COMMIT, SKIP_TEARDROPS } from '../board_commit.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PADSTACK } from '../padstack.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import type { PCB_VIA } from '../pcb_track.js';
import { TEARDROP_MANAGER } from '../teardrop/teardrop.js';
import { TARGET_TD, type TEARDROP_PARAMETERS } from '../teardrop/teardrop_parameters.js';

// Globals to remember filters during a session
let g_netclassFilter = '';
let g_netFilter = '';

/** A wxCheckBox in wxCHK_3STATE: true, false, or null for undetermined. */
export type TRI_STATE = boolean | null;

/** The Action radio group: m_removeTeardrops, m_removeAllTeardrops, m_addTeardrops, m_specifiedValues. */
export enum TEARDROP_ACTION {
  REMOVE,
  REMOVE_ALL,
  ADD_DEFAULTS,
  SPECIFIED,
}

export class DIALOG_GLOBAL_EDIT_TEARDROPS {
  // Scope
  m_pthPads = false;
  m_smdPads = false;
  m_vias = false;
  m_trackToTrack = false;

  // Filter Items
  m_netFilterOpt = false;
  /** NET_SELECTOR's selected net code; -1 is none. */
  m_netFilter = -1;
  m_netclassFilterOpt = false;
  m_netclassFilter = '';
  /** `m_netclassFilter`'s choices. */
  readonly m_netclassNames: string[] = [];
  m_layerFilterOpt = false;
  m_layerFilter: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu;
  m_roundPadsFilter = false;
  m_existingFilter = false;
  m_selectedItemsFilter = false;

  // Action (the base checks m_addTeardrops)
  m_action: TEARDROP_ACTION = TEARDROP_ACTION.ADD_DEFAULTS;
  m_cbPreferZoneConnection: TRI_STATE = null;
  m_cbTeardropsUseNextTrack: TRI_STATE = null;
  m_curvedEdges: TRI_STATE = null;

  readonly m_teardropHDPercent: UNIT_BINDER;
  readonly m_teardropLenPercent: UNIT_BINDER;
  readonly m_teardropMaxLen: UNIT_BINDER;
  readonly m_teardropHeightPercent: UNIT_BINDER;
  readonly m_teardropMaxHeight: UNIT_BINDER;

  private readonly m_brd: BOARD;

  constructor(private readonly m_parent: PCB_EDIT_FRAME) {
    this.m_brd = m_parent.GetBoard()!;

    const provider = m_parent as unknown as ConstructorParameters<typeof UNIT_BINDER>[0];
    this.m_teardropHDPercent = new UNIT_BINDER(provider, 'Track width limit:');
    this.m_teardropLenPercent = new UNIT_BINDER(provider, 'Best length (L):');
    this.m_teardropMaxLen = new UNIT_BINDER(provider, 'Maximum length (L):');
    this.m_teardropHeightPercent = new UNIT_BINDER(provider, 'Best width (W):');
    this.m_teardropMaxHeight = new UNIT_BINDER(provider, 'Maximum width (W):');

    this.m_teardropHDPercent.SetUnits('percent');
    this.m_teardropLenPercent.SetUnits('percent');
    this.m_teardropHeightPercent.SetUnits('percent');

    this.buildFilterLists();
  }

  /** The destructor's statics. */
  OnClose(): void {
    g_netclassFilter = this.m_netclassFilter;
    g_netFilter = this.m_brd.FindNet(this.m_netFilter)?.GetNetname() ?? '';
  }

  /** `onSpecifiedValuesUpdateUi`. */
  SpecifiedValuesEnabled(): boolean {
    return this.m_action === TEARDROP_ACTION.SPECIFIED;
  }

  /** `onFilterUpdateUi`: track-to-track teardrops follow the board settings, unfiltered. */
  FiltersEnabled(): boolean {
    return !this.m_trackToTrack;
  }

  /**
   * `onTrackToTrack`: track-to-track teardrops always follow the document-wide
   * settings, so it turns Set-to-specified-values back into the defaults.
   */
  OnTrackToTrack(aChecked: boolean): void {
    this.m_trackToTrack = aChecked;

    if (aChecked && this.m_action === TEARDROP_ACTION.SPECIFIED)
      this.m_action = TEARDROP_ACTION.ADD_DEFAULTS;
  }

  /** `OnExistingFilterSelect`: the two "add" labels drop "add" for existing teardrops. */
  AddLabels(): { addTeardrops: string; specifiedValues: string } {
    return this.m_existingFilter
      ? {
          addTeardrops: 'Set teardrops to default values for shape',
          specifiedValues: 'Set teardrops to specified values:',
        }
      : {
          addTeardrops: 'Add teardrops with default values for shape',
          specifiedValues: 'Add teardrops with specified values:',
        };
  }

  private buildFilterLists(): void {
    // Populate the net filter list with net names
    const highlighted = this.m_brd.GetHighLightNetCodes();

    if (highlighted.size > 0) this.m_netFilter = [...highlighted][0]!;

    // Populate the netclass filter list with netclass names
    const settings = this.m_brd.GetDesignSettings().m_NetSettings;

    this.m_netclassNames.push(settings.GetDefaultNetclass().GetName());

    for (const name of settings.GetNetclasses().keys()) this.m_netclassNames.push(name);

    this.m_netclassFilter = this.m_brd.GetDesignSettings().GetCurrentNetClassName();

    // Populate the layer filter list
    this.m_layerFilter = this.m_parent.GetActiveLayer();
  }

  TransferDataToWindow(): boolean {
    const bds = this.m_brd.GetDesignSettings();

    this.m_vias = bds.m_TeardropParamsList.m_TargetVias;
    this.m_pthPads = bds.m_TeardropParamsList.m_TargetPTHPads;
    this.m_smdPads = bds.m_TeardropParamsList.m_TargetSMDPads;
    this.m_trackToTrack = bds.m_TeardropParamsList.m_TargetTrack2Track;

    // wxChoice::SetStringSelection and NET_SELECTOR::SetSelectedNet leave the
    // selection alone for a name they do not hold.
    if (this.m_netclassNames.includes(g_netclassFilter)) this.m_netclassFilter = g_netclassFilter;

    const net = this.m_brd.FindNet(g_netFilter);

    if (net) this.m_netFilter = net.GetNetCode();

    this.m_cbPreferZoneConnection = null;
    this.m_cbTeardropsUseNextTrack = null;
    this.m_teardropHDPercent.SetText(INDETERMINATE_ACTION);
    this.m_teardropLenPercent.SetText(INDETERMINATE_ACTION);
    this.m_teardropMaxLen.SetText(INDETERMINATE_ACTION);
    this.m_teardropHeightPercent.SetText(INDETERMINATE_ACTION);
    this.m_teardropMaxHeight.SetText(INDETERMINATE_ACTION);
    this.m_curvedEdges = null;

    return true;
  }

  private setSpecifiedParams(targetParams: TEARDROP_PARAMETERS): void {
    if (this.m_cbPreferZoneConnection !== null)
      targetParams.m_TdOnPadsInZones = !this.m_cbPreferZoneConnection;

    if (this.m_cbTeardropsUseNextTrack !== null)
      targetParams.m_AllowUseTwoTracks = this.m_cbTeardropsUseNextTrack;

    if (!this.m_teardropHDPercent.IsIndeterminate())
      targetParams.m_WidthtoSizeFilterRatio = this.m_teardropHDPercent.GetDoubleValue() / 100.0;

    if (!this.m_teardropLenPercent.IsIndeterminate())
      targetParams.m_BestLengthRatio = this.m_teardropLenPercent.GetDoubleValue() / 100.0;

    if (!this.m_teardropMaxLen.IsIndeterminate())
      targetParams.m_TdMaxLen = this.m_teardropMaxLen.GetIntValue();

    if (!this.m_teardropHeightPercent.IsIndeterminate())
      targetParams.m_BestWidthRatio = this.m_teardropHeightPercent.GetDoubleValue() / 100.0;

    if (!this.m_teardropMaxHeight.IsIndeterminate())
      targetParams.m_TdMaxWidth = this.m_teardropMaxHeight.GetIntValue();

    if (this.m_curvedEdges !== null) targetParams.m_CurvedEdges = this.m_curvedEdges;
  }

  private processItem(aCommit: BOARD_COMMIT, aItem: BOARD_CONNECTED_ITEM): void {
    const brdSettings = this.m_brd.GetDesignSettings();
    let targetParams: TEARDROP_PARAMETERS;

    if (aItem.Type() === KICAD_T.PCB_PAD_T) targetParams = (aItem as PAD).GetTeardropParams();
    else if (aItem.Type() === KICAD_T.PCB_VIA_T)
      targetParams = (aItem as PCB_VIA).GetTeardropParams();
    else return;

    aCommit.Stage(aItem, CHANGE_TYPE.CHT_MODIFY);

    if (this.m_action === TEARDROP_ACTION.REMOVE || this.m_action === TEARDROP_ACTION.REMOVE_ALL) {
      targetParams.m_Enabled = false;
    } else if (this.m_action === TEARDROP_ACTION.ADD_DEFAULTS) {
      // NOTE: This ignores possible padstack shape variation.
      if (TEARDROP_MANAGER.IsRound(aItem, PADSTACK.ALL_LAYERS))
        targetParams.assign(
          brdSettings.GetTeadropParamsList().GetParameters(TARGET_TD.TARGET_ROUND),
        );
      else
        targetParams.assign(
          brdSettings.GetTeadropParamsList().GetParameters(TARGET_TD.TARGET_RECT),
        );

      targetParams.m_Enabled = true;
    } else if (this.m_action === TEARDROP_ACTION.SPECIFIED) {
      this.setSpecifiedParams(targetParams);

      if (!this.m_existingFilter) targetParams.m_Enabled = true;
    }
  }

  private visitItem(
    aCommit: BOARD_COMMIT,
    aItem: BOARD_CONNECTED_ITEM,
    aSelectAlways: boolean,
  ): void {
    if (this.m_selectedItemsFilter) {
      if (!aItem.IsSelected()) {
        let group = aItem.GetParentGroup();

        while (group && !group.AsEdaItem().IsSelected()) group = group.AsEdaItem().GetParentGroup();

        if (!group) return;
      }
    }

    if (aSelectAlways) {
      this.processItem(aCommit, aItem);
      return;
    }

    if (this.m_netFilterOpt && this.m_netFilter >= 0) {
      if (aItem.GetNetCode() !== this.m_netFilter) return;
    }

    if (this.m_netclassFilterOpt && this.m_netclassFilter !== '') {
      const filterNetclass = this.m_netclassFilter;
      const netclass = aItem.GetEffectiveNetClass();

      if (!netclass.ContainsNetclassWithName(filterNetclass)) return;
    }

    if (this.m_layerFilterOpt && this.m_layerFilter !== PCB_LAYER_ID.UNDEFINED_LAYER) {
      if (aItem.GetLayer() !== this.m_layerFilter) return;
    }

    if (this.m_roundPadsFilter) {
      // TODO(JE) padstacks -- teardrops needs to support per-layer pad handling
      if (!TEARDROP_MANAGER.IsRound(aItem, PADSTACK.ALL_LAYERS)) return;
    }

    if (this.m_existingFilter) {
      if (aItem.Type() === KICAD_T.PCB_PAD_T) {
        if (!(aItem as PAD).GetTeardropParams().m_Enabled) return;
      } else if (aItem.Type() === KICAD_T.PCB_VIA_T) {
        if (!(aItem as PCB_VIA).GetTeardropParams().m_Enabled) return;
      }
    }

    this.processItem(aCommit, aItem);
  }

  TransferDataFromWindow(): boolean {
    this.m_brd.SetLegacyTeardrops(false);

    const commit = new BOARD_COMMIT(this.m_parent);

    // Save some dialog options
    const bds = this.m_brd.GetDesignSettings();

    bds.m_TeardropParamsList.m_TargetVias = this.m_vias;
    bds.m_TeardropParamsList.m_TargetPTHPads = this.m_pthPads;
    bds.m_TeardropParamsList.m_TargetSMDPads = this.m_smdPads;
    bds.m_TeardropParamsList.m_TargetTrack2Track = this.m_trackToTrack;
    bds.m_TeardropParamsList.m_UseRoundShapesOnly = this.m_roundPadsFilter;

    const remove_all = this.m_action === TEARDROP_ACTION.REMOVE_ALL;

    if (this.m_vias || remove_all) {
      for (const track of this.m_brd.Tracks()) {
        if (track.Type() === KICAD_T.PCB_VIA_T) this.visitItem(commit, track, remove_all);
      }
    }

    for (const footprint of this.m_brd.Footprints()) {
      for (const pad of footprint.Pads()) {
        if (remove_all) {
          this.visitItem(commit, pad, true);
          continue;
        }

        if (this.m_pthPads && pad.GetAttribute() === PAD_ATTRIB.PTH) {
          this.visitItem(commit, pad, false);
        } else if (
          this.m_smdPads &&
          (pad.GetAttribute() === PAD_ATTRIB.SMD || pad.GetAttribute() === PAD_ATTRIB.CONN)
        ) {
          this.visitItem(commit, pad, false);
        }
      }
    }

    if (this.m_trackToTrack) {
      const paramsList = this.m_brd.GetDesignSettings().GetTeadropParamsList();
      const targetParams = paramsList.GetParameters(TARGET_TD.TARGET_TRACK);
      const teardropManager = new TEARDROP_MANAGER(this.m_brd, this.m_parent.GetToolManager());

      teardropManager.DeleteTrackToTrackTeardrops(commit);
      teardropManager.BuildTrackCaches();

      if (
        this.m_action === TEARDROP_ACTION.REMOVE ||
        this.m_action === TEARDROP_ACTION.REMOVE_ALL
      ) {
        targetParams.m_Enabled = false;
      } else if (this.m_action === TEARDROP_ACTION.ADD_DEFAULTS) {
        targetParams.m_Enabled = true;
        teardropManager.AddTeardropsOnTracks(commit, new Set(), true);
      }
    }

    // If there are no filters then a force-full-update is equivalent, and will be faster.
    if (
      !this.m_netFilterOpt &&
      !this.m_netclassFilterOpt &&
      !this.m_layerFilterOpt &&
      !this.m_roundPadsFilter &&
      !this.m_existingFilter &&
      !this.m_selectedItemsFilter
    ) {
      commit.Push('Edit Teardrops', SKIP_TEARDROPS);

      const teardropMgr = new TEARDROP_MANAGER(this.m_brd, this.m_parent.GetToolManager());
      teardropMgr.UpdateTeardrops(commit, [], new Set(), true /* forceFullUpdate */);
      commit.Push('Edit Teardrops', SKIP_TEARDROPS | APPEND_UNDO);
    } else {
      commit.Push('Edit Teardrops');
    }

    return true;
  }
}
