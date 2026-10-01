// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_DELETION` (pcbnew/dialogs/dialog_global_deletion.cpp), and
 * GLOBAL_EDIT_TOOL::GlobalDeletions, which upstream defines in the same file:
 * the item kinds to delete, the lock filters, the layer filter, then one
 * "Global Delete" commit. The window is dialog_global_deletion_ui.tsx.
 *
 * A destructive dialog: upstream opts out of DIALOG_SHIM's control memory so
 * it always comes up benign, which is also what a fresh model here gives.
 *
 * Note the else-if chains, kept as they are: ticking "Graphics" (or "Board
 * outlines") means "Text" deletes nothing, and a drawing that is not a
 * PCB_SHAPE is never removed by "Graphics".
 */
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PCB_TUNING_PATTERN } from '../generators/pcb_tuning_pattern.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';

/** `m_rbLayersOptionChoices[]`; row 1 is formatted with the current layer's name. */
const LAYER_OPTION_TEMPLATES = ['All layers', 'Current layer (%s) only'] as const;

export class DIALOG_GLOBAL_DELETION {
  // Items to Delete
  m_delZones = false;
  m_delTexts = false;
  m_delBoardEdges = false;
  m_delDrawings = false;
  m_delFootprints = false;
  m_delTracks = false;
  m_delTeardrops = false;
  m_delMarkers = false;
  m_delAll = false;

  // Filter Settings (dialog_global_deletion_base.cpp: only the unlocked ones on)
  m_drawingFilterLocked = false;
  m_drawingFilterUnlocked = true;
  m_footprintFilterLocked = false;
  m_footprintFilterUnlocked = true;
  m_trackFilterLocked = false;
  m_trackFilterUnlocked = true;
  m_viaFilterLocked = false;
  m_viaFilterUnlocked = true;

  /**
   * `m_rbLayersOption`: 0 "All layers", 1 the current layer only. The base
   * selects row 1 (dialog_global_deletion_base.cpp); SetCurrentLayer, which the
   * tool always calls, puts it back on 0.
   */
  m_rbLayersOption = 1;
  m_layerOptionLabels: string[] = [...LAYER_OPTION_TEMPLATES];

  private m_currentLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu;

  constructor(private readonly m_Parent: PCB_BASE_EDIT_FRAME) {}

  SetCurrentLayer(aLayer: PCB_LAYER_ID): void {
    this.m_currentLayer = aLayer;
    this.m_layerOptionLabels[1] = LAYER_OPTION_TEMPLATES[1].replace(
      '%s',
      this.m_Parent.GetBoard()!.GetLayerName(ToLAYER_ID(aLayer)),
    );
    this.m_rbLayersOption = 0;
  }

  /** `onCheckDeleteTracks`: the track and via lock filters follow "Tracks & vias". */
  TrackFiltersEnabled(): boolean {
    return this.m_delTracks;
  }

  /** `onCheckDeleteFootprints`. */
  FootprintFiltersEnabled(): boolean {
    return this.m_delFootprints;
  }

  /** `onCheckDeleteDrawings` / `onCheckDeleteBoardOutlines`: either box enables them. */
  DrawingFiltersEnabled(): boolean {
    return this.m_delDrawings || this.m_delBoardEdges;
  }

  DoGlobalDeletions(): void {
    let gen_rastnest = false;
    const delete_all = this.m_delAll;

    // Clear selection before removing any items
    this.m_Parent.GetToolManager()!.RunAction(ACTIONS.selectionClear);

    const board = this.m_Parent.GetBoard()!;
    const commit = new BOARD_COMMIT(this.m_Parent);
    const all_layers = new LSET().set();
    let layers_filter = new LSET();

    if (this.m_rbLayersOption !== 0) layers_filter.set(this.m_currentLayer);
    else layers_filter = all_layers;

    const processItem = (item: BOARD_ITEM, layers_mask: LSET): void => {
      if (item.GetLayerSet().and(layers_mask).any()) commit.Remove(item);
    };

    const processConnectedItem = (item: BOARD_ITEM, layers_mask: LSET): void => {
      if (item.GetLayerSet().and(layers_mask).any()) {
        commit.Remove(item);
        gen_rastnest = true;
      }
    };

    for (const zone of board.Zones()) {
      if (delete_all) {
        processConnectedItem(zone, all_layers);
      } else if (zone.IsTeardropArea()) {
        if (this.m_delTeardrops) processConnectedItem(zone, layers_filter);
      } else {
        if (this.m_delZones) processConnectedItem(zone, layers_filter);
      }
    }

    const delete_shapes = this.m_delDrawings || this.m_delBoardEdges;
    const delete_texts = this.m_delTexts;

    if (delete_all || delete_shapes || delete_texts) {
      // Layer mask for drawings
      let drawing_layers_filter = new LSET();

      if (this.m_delDrawings)
        drawing_layers_filter = LSET.AllNonCuMask().set(PCB_LAYER_ID.Edge_Cuts, false);

      if (this.m_delBoardEdges) drawing_layers_filter.set(PCB_LAYER_ID.Edge_Cuts);

      drawing_layers_filter = drawing_layers_filter.and(layers_filter);

      for (const item of board.Drawings()) {
        if (delete_all) {
          processItem(item, all_layers);
        } else if (delete_shapes) {
          if (item.Type() === KICAD_T.PCB_SHAPE_T && item.IsLocked()) {
            if (this.m_drawingFilterLocked) processItem(item, drawing_layers_filter);
          } else if (item.Type() === KICAD_T.PCB_SHAPE_T && !item.IsLocked()) {
            if (this.m_drawingFilterUnlocked) processItem(item, drawing_layers_filter);
          }
        } else if (delete_texts) {
          if (item.Type() === KICAD_T.PCB_TEXT_T || item.Type() === KICAD_T.PCB_TEXTBOX_T)
            processItem(item, layers_filter);
        }
      }
    }

    if (delete_all || this.m_delFootprints) {
      for (const footprint of board.Footprints()) {
        if (delete_all) {
          processConnectedItem(footprint, all_layers);
        } else if (footprint.IsLocked()) {
          if (this.m_footprintFilterLocked) processConnectedItem(footprint, layers_filter);
        } else {
          if (this.m_footprintFilterUnlocked) processConnectedItem(footprint, layers_filter);
        }
      }
    }

    if (delete_all || this.m_delTracks) {
      for (const track of board.Tracks()) {
        if (delete_all) {
          processConnectedItem(track, all_layers);
        } else if (track.Type() === KICAD_T.PCB_VIA_T) {
          if (track.IsLocked()) {
            if (this.m_viaFilterLocked) processConnectedItem(track, layers_filter);
          } else {
            if (this.m_viaFilterUnlocked) processConnectedItem(track, layers_filter);
          }
        } else {
          if (track.IsLocked()) {
            if (this.m_trackFilterLocked) processConnectedItem(track, layers_filter);
          } else {
            if (this.m_trackFilterUnlocked) processConnectedItem(track, layers_filter);
          }
        }
      }

      for (const generator of board.Generators()) {
        if (generator instanceof PCB_TUNING_PATTERN) {
          if (generator.GetBoardItems().size === 0) commit.Remove(generator);
        }
      }
    }

    commit.Push('Global Delete');

    if (this.m_delMarkers) board.DeleteMARKERs();

    if (gen_rastnest) this.m_Parent.Compile_Ratsnest(true);

    // There is a chance that some of tracks have changed their nets, so rebuild ratsnest
    // from scratch.
    this.m_Parent.GetCanvas()?.Refresh();
  }
}
