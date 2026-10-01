// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_UNUSED_PAD_LAYERS` (pcbnew/dialogs/dialog_unused_pad_layers.cpp):
 * mark the copper layers of through-hole pads and vias that connect nothing as
 * removable ("Remove Unused Layers") or bring them all back ("Restore All
 * Layers"), on the selection or the whole board, as one commit. The window is
 * dialog_unused_pad_layers_ui.tsx.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import type { COMMIT } from '@ziroeda/common/commit.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB } from '../padstack.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_VIA } from '../pcb_track.js';
import { VIATYPE } from '../pcb_track_types.js';

export class DIALOG_UNUSED_PAD_LAYERS {
  m_cbVias = false;
  m_cbPads = false;
  m_cbSelectedOnly = false;
  // Set keep Through Hole pads on external layers ON by default.
  // Because such a pad does not allow soldering/unsoldering, disable this option
  // is probably not frequent
  m_cbPreserveExternalLayers = true;

  constructor(
    private readonly m_frame: PCB_BASE_FRAME,
    private readonly m_items: Iterable<EDA_ITEM>,
    private readonly m_commit: COMMIT,
  ) {}

  /** `updateImage`: the illustration follows "Keep outside layers". */
  GetImage(): BITMAPS {
    return this.m_cbPreserveExternalLayers
      ? BITMAPS.pads_remove_unused_keep_bottom
      : BITMAPS.pads_remove_unused;
  }

  /** OK: "Remove Unused Layers". */
  OnOK(): void {
    this.updatePadsAndVias(true); // called only with wxID_OK
  }

  /** Apply: "Restore All Layers". */
  OnApply(): void {
    this.updatePadsAndVias(false);
  }

  private updatePadsAndVias(aRemoveLayers: boolean): void {
    const board = this.m_frame.GetBoard()!;

    const viaHasPotentiallyUnusedLayers = (via: PCB_VIA): boolean => {
      if (via.GetViaType() === VIATYPE.THROUGH) return board.GetCopperLayerCount() > 2;

      const startLayer = via.Padstack().StartLayer();
      const endLayer = via.Padstack().EndLayer();

      if (startLayer < 0 || endLayer < 0) return board.GetCopperLayerCount() > 2;
      else return board.LayerDepth(startLayer, endLayer) > 1;
    };

    const padHasPotentiallyUnusedLayers = (pad: PAD): boolean =>
      pad.GetAttribute() === PAD_ATTRIB.PTH;

    const setPad = (pad: PAD): void => {
      if (padHasPotentiallyUnusedLayers(pad)) {
        pad.SetRemoveUnconnected(aRemoveLayers);

        if (aRemoveLayers) pad.SetKeepTopBottom(this.m_cbPreserveExternalLayers);
      }
    };

    if (this.m_cbSelectedOnly) {
      for (const item of this.m_items) {
        this.m_commit.Modify(item);

        if (item.Type() === KICAD_T.PCB_VIA_T && this.m_cbVias) {
          const via = item as unknown as PCB_VIA;

          if (viaHasPotentiallyUnusedLayers(via)) {
            via.SetRemoveUnconnected(aRemoveLayers);

            if (aRemoveLayers) via.SetKeepStartEnd(this.m_cbPreserveExternalLayers);
          }
        }

        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T && this.m_cbPads) {
          for (const pad of (item as unknown as FOOTPRINT).Pads()) setPad(pad);
        }

        if (item.Type() === KICAD_T.PCB_PAD_T && this.m_cbPads) setPad(item as unknown as PAD);
      }
    } else {
      if (this.m_cbPads) {
        for (const footprint of board.Footprints()) {
          this.m_commit.Modify(footprint);

          for (const pad of footprint.Pads()) setPad(pad);
        }
      }

      if (this.m_cbVias) {
        for (const item of board.Tracks()) {
          if (item.Type() !== KICAD_T.PCB_VIA_T) continue;

          const via = item as unknown as PCB_VIA;

          if (viaHasPotentiallyUnusedLayers(via)) {
            this.m_commit.Modify(via);
            via.SetRemoveUnconnected(aRemoveLayers);

            if (aRemoveLayers) via.SetKeepStartEnd(this.m_cbPreserveExternalLayers);
          }
        }
      }
    }

    this.m_commit.Push('Remove Unused Pads');
  }
}
