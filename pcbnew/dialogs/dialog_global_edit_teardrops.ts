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
 * The window is `designer/.../dialog_global_edit_teardrops.tsx`; this module is
 * the controls' values ({@link GlobalTeardropEditOptions}) and what OK does.
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { CHANGE_TYPE } from '@ziroeda/common/commit.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import { APPEND_UNDO, BOARD_COMMIT, SKIP_TEARDROPS } from '../board_commit.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PADSTACK } from '../padstack.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_VIA } from '../pcb_track.js';
import { TEARDROP_MANAGER } from '../teardrop/teardrop.js';
import { TARGET_TD, type TEARDROP_PARAMETERS } from '../teardrop/teardrop_parameters.js';

/** What the Action radio group offers. */
export type TeardropEditAction =
  /** m_removeTeardrops: clear `m_Enabled` on everything the filters select. */
  | 'remove'
  /** m_removeAllTeardrops: clear it everywhere, filters ignored. */
  | 'removeAll'
  /** m_addTeardrops: copy the Board Setup defaults for the item's shape. */
  | 'addDefaults'
  /** m_specifiedValues: overlay the values the dialog specifies. */
  | 'specified';

/**
 * The "specified values" block, one field per control `setSpecifiedParams`
 * reads. An absent field is a three-state control (or a UNIT_BINDER) left
 * indeterminate, which upstream leaves untouched on the target.
 */
export interface SpecifiedTeardropValues {
  /** `!m_cbPreferZoneConnection`. */
  tdOnPadsInZones?: boolean;
  /** m_cbTeardropsUseNextTrack. */
  allowUseTwoTracks?: boolean;
  /** m_teardropHDPercent / 100. */
  widthtoSizeFilterRatio?: number;
  /** m_teardropLenPercent / 100. */
  bestLengthRatio?: number;
  /** m_teardropMaxLen, IU. */
  tdMaxLen?: number;
  /** m_teardropHeightPercent / 100. */
  bestWidthRatio?: number;
  /** m_teardropMaxHeight, IU. */
  tdMaxWidth?: number;
  /** m_curvedEdges. */
  curvedEdges?: boolean;
}

/**
 * The dialog's controls. A `null` filter is the unchecked checkbox.
 */
export interface GlobalTeardropEditOptions {
  // ----- Scope -----
  /** m_pthPads. */
  pthPads: boolean;
  /** m_smdPads; covers SMD and edge-connector pads, as upstream does. */
  smdPads: boolean;
  /** m_vias. */
  vias: boolean;
  /** m_trackToTrack. */
  trackToTrack: boolean;

  // ----- Filter Items -----
  /** m_netFilter / m_netFilterOpt: the net code, or null when unchecked. */
  netFilter?: number | null;
  /** m_netclassFilter / m_netclassFilterOpt. */
  netclassFilter?: string | null;
  /** m_layerFilter / m_layerFilterOpt: the layer's name, as the layer box lists it. */
  layerFilter?: string | null;
  /** m_roundPadsFilter. */
  roundPadsOnly?: boolean;
  /** m_existingFilter: only items that already have teardrops enabled. */
  existingOnly?: boolean;
  /** m_selectedItemsFilter. */
  selectedOnly?: boolean;

  // ----- Action -----
  action: TeardropEditAction;
  /** The `m_specifiedValues` fields that are not indeterminate. */
  specified?: SpecifiedTeardropValues;
}

/**
 * `EDA_ITEM::IsSelected()`. The editor's selection is not yet the items'
 * SELECTED flag (PCB_SELECTION_TOOL is stage 3 of #636), so the frame may
 * answer for it; left out, the flag itself is read, as upstream does.
 */
export type IsSelectedFn = (aItem: EDA_ITEM) => boolean;

/** DIALOG_GLOBAL_EDIT_TEARDROPS, the state TransferDataFromWindow reads. */
class DIALOG_GLOBAL_EDIT_TEARDROPS {
  private readonly m_parent: PCB_BASE_FRAME;
  private readonly m_brd: BOARD;
  private readonly m_opts: GlobalTeardropEditOptions;
  private readonly m_isSelected: IsSelectedFn;

  constructor(
    aParent: PCB_BASE_FRAME,
    aOpts: GlobalTeardropEditOptions,
    aIsSelected: IsSelectedFn,
  ) {
    this.m_parent = aParent;
    this.m_brd = aParent.GetBoard()!;
    this.m_opts = aOpts;
    this.m_isSelected = aIsSelected;
  }

  private setSpecifiedParams(targetParams: TEARDROP_PARAMETERS): void {
    const s = this.m_opts.specified ?? {};

    if (s.tdOnPadsInZones !== undefined) targetParams.m_TdOnPadsInZones = s.tdOnPadsInZones;

    if (s.allowUseTwoTracks !== undefined) targetParams.m_AllowUseTwoTracks = s.allowUseTwoTracks;

    if (s.widthtoSizeFilterRatio !== undefined)
      targetParams.m_WidthtoSizeFilterRatio = s.widthtoSizeFilterRatio;

    if (s.bestLengthRatio !== undefined) targetParams.m_BestLengthRatio = s.bestLengthRatio;

    if (s.tdMaxLen !== undefined) targetParams.m_TdMaxLen = s.tdMaxLen;

    if (s.bestWidthRatio !== undefined) targetParams.m_BestWidthRatio = s.bestWidthRatio;

    if (s.tdMaxWidth !== undefined) targetParams.m_TdMaxWidth = s.tdMaxWidth;

    if (s.curvedEdges !== undefined) targetParams.m_CurvedEdges = s.curvedEdges;
  }

  private processItem(aCommit: BOARD_COMMIT, aItem: BOARD_CONNECTED_ITEM): void {
    const brdSettings = this.m_brd.GetDesignSettings();
    let targetParams: TEARDROP_PARAMETERS;

    if (aItem.Type() === KICAD_T.PCB_PAD_T) targetParams = (aItem as PAD).GetTeardropParams();
    else if (aItem.Type() === KICAD_T.PCB_VIA_T)
      targetParams = (aItem as PCB_VIA).GetTeardropParams();
    else return;

    aCommit.Stage(aItem, CHANGE_TYPE.CHT_MODIFY);

    const action = this.m_opts.action;

    if (action === 'remove' || action === 'removeAll') {
      targetParams.m_Enabled = false;
    } else if (action === 'addDefaults') {
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
    } else if (action === 'specified') {
      this.setSpecifiedParams(targetParams);

      if (!this.m_opts.existingOnly) targetParams.m_Enabled = true;
    }
  }

  private visitItem(
    aCommit: BOARD_COMMIT,
    aItem: BOARD_CONNECTED_ITEM,
    aSelectAlways: boolean,
  ): void {
    const o = this.m_opts;

    if (o.selectedOnly) {
      if (!this.m_isSelected(aItem)) {
        let group = aItem.GetParentGroup();

        while (group && !this.m_isSelected(group.AsEdaItem()))
          group = group.AsEdaItem().GetParentGroup();

        if (!group) return;
      }
    }

    if (aSelectAlways) {
      this.processItem(aCommit, aItem);
      return;
    }

    if (o.netFilter != null && o.netFilter >= 0) {
      if (aItem.GetNetCode() !== o.netFilter) return;
    }

    if (o.netclassFilter) {
      const netclass = aItem.GetEffectiveNetClass();

      if (!netclass.ContainsNetclassWithName(o.netclassFilter)) return;
    }

    if (o.layerFilter) {
      const layer = this.m_brd.GetLayerID(o.layerFilter);

      if (layer !== PCB_LAYER_ID.UNDEFINED_LAYER && aItem.GetLayer() !== layer) return;
    }

    if (o.roundPadsOnly) {
      // TODO(JE) padstacks -- teardrops needs to support per-layer pad handling
      if (!TEARDROP_MANAGER.IsRound(aItem, PADSTACK.ALL_LAYERS)) return;
    }

    if (o.existingOnly) {
      if (aItem.Type() === KICAD_T.PCB_PAD_T) {
        if (!(aItem as PAD).GetTeardropParams().m_Enabled) return;
      } else if (aItem.Type() === KICAD_T.PCB_VIA_T) {
        if (!(aItem as PCB_VIA).GetTeardropParams().m_Enabled) return;
      }
    }

    this.processItem(aCommit, aItem);
  }

  TransferDataFromWindow(): boolean {
    const o = this.m_opts;

    this.m_brd.SetLegacyTeardrops(false);

    const commit = new BOARD_COMMIT(this.m_parent);

    // Save some dialog options
    const bds = this.m_brd.GetDesignSettings();

    bds.m_TeardropParamsList.m_TargetVias = o.vias;
    bds.m_TeardropParamsList.m_TargetPTHPads = o.pthPads;
    bds.m_TeardropParamsList.m_TargetSMDPads = o.smdPads;
    bds.m_TeardropParamsList.m_TargetTrack2Track = o.trackToTrack;
    bds.m_TeardropParamsList.m_UseRoundShapesOnly = o.roundPadsOnly ?? false;

    const remove_all = o.action === 'removeAll';

    if (o.vias || remove_all) {
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

        if (o.pthPads && pad.GetAttribute() === PAD_ATTRIB.PTH) {
          this.visitItem(commit, pad, false);
        } else if (
          o.smdPads &&
          (pad.GetAttribute() === PAD_ATTRIB.SMD || pad.GetAttribute() === PAD_ATTRIB.CONN)
        ) {
          this.visitItem(commit, pad, false);
        }
      }
    }

    if (o.trackToTrack) {
      const paramsList = this.m_brd.GetDesignSettings().GetTeadropParamsList();
      const targetParams = paramsList.GetParameters(TARGET_TD.TARGET_TRACK);
      const teardropManager = new TEARDROP_MANAGER(this.m_brd, this.m_parent.GetToolManager());

      teardropManager.DeleteTrackToTrackTeardrops(commit);
      teardropManager.BuildTrackCaches();

      if (o.action === 'remove' || o.action === 'removeAll') {
        targetParams.m_Enabled = false;
      } else if (o.action === 'addDefaults') {
        targetParams.m_Enabled = true;
        teardropManager.AddTeardropsOnTracks(commit, new Set(), true);
      }
    }

    // If there are no filters then a force-full-update is equivalent, and will be faster.
    if (
      o.netFilter == null &&
      !o.netclassFilter &&
      !o.layerFilter &&
      !o.roundPadsOnly &&
      !o.existingOnly &&
      !o.selectedOnly
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

/**
 * DIALOG_GLOBAL_EDIT_TEARDROPS::TransferDataFromWindow: stamp the parameters
 * onto the pads and vias the options select, save the scope checkboxes into
 * `BOARD_DESIGN_SETTINGS::m_TeardropParamsList`, and rebuild the teardrops —
 * all through BOARD_COMMITs on the frame, so it is one undo step.
 */
export function applyGlobalTeardropEdit(
  aParent: PCB_BASE_FRAME,
  aOpts: GlobalTeardropEditOptions,
  aIsSelected: IsSelectedFn = (item) => item.IsSelected(),
): boolean {
  return new DIALOG_GLOBAL_EDIT_TEARDROPS(aParent, aOpts, aIsSelected).TransferDataFromWindow();
}

/** dialog_global_edit_teardrops_base.cpp's initial control states. */
export const DEFAULT_GLOBAL_TEARDROP_EDIT: GlobalTeardropEditOptions = {
  pthPads: true,
  smdPads: true,
  vias: true,
  trackToTrack: false,
  netFilter: null,
  netclassFilter: null,
  layerFilter: null,
  roundPadsOnly: false,
  existingOnly: false,
  selectedOnly: false,
  action: 'addDefaults',
  specified: {},
};
