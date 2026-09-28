// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/layer_utils.h` / `.cpp`: `LAYER_UTILS`, board-aware layer helpers
 * that don't belong on `LSET`/`LSEQ` themselves (no `BOARD`/`FOOTPRINT`
 * access there) or need `pcbnew` types.
 *
 * `AccumulateNames` already had a private copy inside
 * `footprint_needs_update.ts` (the library-parity DRC's own doc-comment even
 * cites this file as its source); that copy is now gone in favour of this
 * one, per the central-value rule.
 */
import { LSET } from '@ziroeda/common/lset.js';
import { LayerName, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { LSEQ } from '@ziroeda/common/lseq.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import type { FOOTPRINT } from './footprint.js';

export namespace LAYER_UTILS {
  /**
   * Accumulate layer names from a layer set into a comma separated string.
   *
   * @param aLayers is the list of layers to accumulate.
   * @param aBoard is the board to get layer names from, if null the default
   *   names are used.
   */
  export function AccumulateNames(aLayers: Iterable<PCB_LAYER_ID>, aBoard: BOARD | null): string {
    let result = '';

    for (const layer of aLayers) {
      if (result !== '') result += ', ';

      result += aBoard ? aBoard.GetLayerName(layer) : LayerName(layer);
    }

    return result;
  }

  /**
   * Accumulate layer names from a layer set into a comma separated string,
   * in UI order.
   */
  export function AccumulateNamesFromSet(aLayers: LSET, aBoard: BOARD | null): string {
    return AccumulateNames(aLayers.UIOrder(), aBoard);
  }

  /**
   * Return the union of layers referenced by every item inside the footprint
   * (including graphic items, pads, zones, fields, and nested groups).
   */
  export function GetAllFootprintLayers(aFootprint: FOOTPRINT): LSET {
    const usedLayers = new LSET();

    aFootprint.RunOnChildren((aSubItem: BOARD_ITEM) => {
      usedLayers.orAssign(aSubItem.GetLayerSet());
    }, RECURSE_MODE.RECURSE);

    return usedLayers;
  }

  /**
   * Compute the set of footprint-used layers that would be orphaned if the
   * footprint's allowed layer set is restricted to `aCustomUserLayers` (plus
   * the tech and user masks).
   *
   * The Rescue pseudo-layer is intentionally excluded. It is an internal
   * fallback for items referencing unknown layer names at load time and is
   * not surfaced in any layer-selection UI. Orphans on Rescue must be
   * addressed through the library-parity DRC, not by blocking edits in the
   * Footprint Properties dialog.
   */
  export function GetOrphanedFootprintLayers(aFootprint: FOOTPRINT, aCustomUserLayers: LSET): LSET {
    const usedLayers = GetAllFootprintLayers(aFootprint);

    usedLayers.andAssign(aCustomUserLayers.not());
    usedLayers.andAssign(LSET.AllTechMask().not());
    usedLayers.andAssign(LSET.UserMask().not());

    usedLayers.reset(PCB_LAYER_ID.Rescue);

    return usedLayers;
  }
}
