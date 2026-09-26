// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_cache_generator.h` + `.cpp`: the pseudo-provider that
 * runs first and builds the board's DRC caches - the copper item R-tree, the
 * copper zone R-trees, the courtyard and net-tie caches, the isolated
 * islands map, the connectivity. Its thread pool is a plain loop here.
 */
import { IsCopperLayer, type PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PAD } from '../pad.js';
import { ISOLATED_ISLANDS, type ZONE } from '../zone.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_RTREE } from './drc_rtree.js';
import { DRC_TEST_PROVIDER } from './drc_test_provider.js';

/** `INT_MAX / 3` */
const INT_MAX_THIRD = Math.trunc(2147483647 / 3);

export class DRC_CACHE_GENERATOR extends DRC_TEST_PROVIDER {
  Run(): boolean {
    this.m_board = this.m_drcEngine!.GetBoard();

    const board = this.m_board!;
    let largestClearance = board.m_DRCMaxClearance;
    let largestPhysicalClearance = board.m_DRCMaxPhysicalClearance;
    const boardCopperLayers = LSET.AllCuMask(board.GetCopperLayerCount());

    largestClearance = Math.max(largestClearance, board.GetMaxClearanceValue());

    // Only consider unconditional constraints for the global maximum.  Conditional constraints
    // (like the barcode physical clearance default) apply only to specific item types and
    // should not inflate the R-tree query radius for all items on the board.
    let worstConstraint = this.m_drcEngine!.QueryWorstConstraint(
      DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
      true,
    );

    if (worstConstraint) largestPhysicalClearance = worstConstraint.GetValue().Min();

    worstConstraint = this.m_drcEngine!.QueryWorstConstraint(
      DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
      true,
    );

    if (worstConstraint)
      largestPhysicalClearance = Math.max(
        largestPhysicalClearance,
        worstConstraint.GetValue().Min(),
      );

    // If the unconditional max is 0, check for conditional constraints that may still apply.
    // User-defined conditional rules always need the test to run.  The implicit barcode rule
    // only needs the test if barcodes actually exist on the board.
    if (largestPhysicalClearance <= 0) {
      let conditionalMax = 0;

      worstConstraint = this.m_drcEngine!.QueryWorstConstraint(
        DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
      );

      if (worstConstraint) conditionalMax = worstConstraint.GetValue().Min();

      worstConstraint = this.m_drcEngine!.QueryWorstConstraint(
        DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
      );

      if (worstConstraint)
        conditionalMax = Math.max(conditionalMax, worstConstraint.GetValue().Min());

      if (conditionalMax > 0) {
        if (this.m_drcEngine!.HasUserDefinedPhysicalConstraint()) {
          largestPhysicalClearance = conditionalMax;
        } else {
          let hasMatchingItems = false;

          this.forEachGeometryItem(
            [KICAD_T.PCB_BARCODE_T],
            LSET.AllLayersMask(),
            (_item: BOARD_ITEM): boolean => {
              hasMatchingItems = true;
              return false;
            },
          );

          if (hasMatchingItems) largestPhysicalClearance = conditionalMax;
        }
      }
    }

    // Ensure algorithmic safety
    largestClearance = Math.min(largestClearance, INT_MAX_THIRD);
    largestPhysicalClearance = Math.min(largestPhysicalClearance, INT_MAX_THIRD);

    board.m_DRCMaxClearance = largestClearance;
    board.m_DRCMaxPhysicalClearance = largestPhysicalClearance;

    const allZones = new Set<ZONE>();

    const cacheBBoxes = (zone: ZONE, copperLayers: LSET): void => {
      zone.Outline().BuildBBoxCaches();

      for (const layer of copperLayers) {
        const fill = zone.GetFill(layer);

        if (fill) fill.BuildBBoxCaches();
      }
    };

    for (const zone of board.Zones()) {
      allZones.add(zone);

      if (!zone.GetIsRuleArea()) {
        board.m_DRCZones.push(zone);

        const zoneCopperLayers = zone.GetLayerSet().and(boardCopperLayers);

        if (zoneCopperLayers.any()) {
          cacheBBoxes(zone, zoneCopperLayers);
          board.m_DRCCopperZones.push(zone);
        }
      }
    }

    for (const footprint of board.Footprints()) {
      for (const zone of footprint.Zones()) {
        allZones.add(zone);

        if (!zone.GetIsRuleArea()) {
          board.m_DRCZones.push(zone);

          const zoneCopperLayers = zone.GetLayerSet().and(boardCopperLayers);

          if (zoneCopperLayers.any()) {
            cacheBBoxes(zone, zoneCopperLayers);
            board.m_DRCCopperZones.push(zone);
          }
        }
      }
    }

    let count = 0;
    let done = 1;

    const countItems = (_item: BOARD_ITEM): boolean => {
      ++count;
      return true;
    };

    const addToCopperTree = (item: BOARD_ITEM): boolean => {
      if (this.m_drcEngine!.IsCancelled()) return false;

      let copperLayers = item.GetLayerSet().and(boardCopperLayers);

      // Special-case pad holes which pierce all the copper layers
      if (item.Type() === KICAD_T.PCB_PAD_T) {
        const pad = item as PAD;

        if (pad.HasHole()) copperLayers = boardCopperLayers;
      }

      copperLayers.RunOnLayers((layer: PCB_LAYER_ID) => {
        board.m_CopperItemRTreeCache!.Insert(item, layer, undefined, largestClearance);
      });

      done += 1;
      return true;
    };

    if (!this.reportPhase('Gathering copper items...')) return false; // DRC cancelled

    const itemTypes: KICAD_T[] = [
      KICAD_T.PCB_TRACE_T,
      KICAD_T.PCB_ARC_T,
      KICAD_T.PCB_VIA_T,
      KICAD_T.PCB_PAD_T,
      KICAD_T.PCB_SHAPE_T,
      KICAD_T.PCB_FIELD_T,
      KICAD_T.PCB_TEXT_T,
      KICAD_T.PCB_TEXTBOX_T,
      KICAD_T.PCB_TABLE_T,
      KICAD_T.PCB_TABLECELL_T,
      KICAD_T.PCB_DIMENSION_T,
      KICAD_T.PCB_BARCODE_T,
    ];

    this.forEachGeometryItem(itemTypes, boardCopperLayers, countItems);
    if (!board.m_CopperItemRTreeCache) board.m_CopperItemRTreeCache = new DRC_RTREE();

    this.forEachGeometryItem(itemTypes, boardCopperLayers, addToCopperTree);

    this.reportProgress(done, count);

    if (!this.reportPhase('Tessellating copper zones...')) return false; // DRC cancelled

    // Cache zone bounding boxes, triangulation, copper zone rtrees, and footprint courtyards
    // before we start.

    for (const footprint of board.Footprints()) {
      footprint.BuildCourtyardCaches();
      footprint.BuildNetTieCache();
    }

    const cache_zones = (aZone: ZONE): number => {
      if (this.m_drcEngine!.IsCancelled()) return 0;

      aZone.CacheBoundingBox();
      aZone.CacheTriangulation();

      if (!aZone.GetIsRuleArea() && aZone.IsOnCopperLayer()) {
        const rtree = new DRC_RTREE();

        aZone.GetLayerSet().RunOnLayers((layer: PCB_LAYER_ID) => {
          if (IsCopperLayer(layer)) rtree.Insert(aZone, layer);
        });
        board.m_CopperZoneRTreeCache.set(aZone, rtree);

        done += 1;
      }

      return 1;
    };

    done = 1;

    for (const zone of allZones) {
      cache_zones(zone);
      this.reportProgress(done, allZones.size);
    }

    board.m_ZoneIsolatedIslandsMap.clear();

    for (const zone of board.Zones()) {
      if (!zone.GetIsRuleArea() && !zone.IsTeardropArea()) {
        zone.GetLayerSet().RunOnLayers((layer: PCB_LAYER_ID) => {
          let perLayer = board.m_ZoneIsolatedIslandsMap.get(zone);

          if (!perLayer) {
            perLayer = new Map();
            board.m_ZoneIsolatedIslandsMap.set(zone, perLayer);
          }

          perLayer.set(layer, new ISOLATED_ISLANDS());
        });
      }
    }

    board.UpdateBoardOutline();

    if (board.BoardOutline()) board.BoardOutline().GetOutline().BuildBBoxCaches();

    const connectivity = board.GetConnectivity();

    connectivity.ClearRatsnest();
    connectivity.Build(board, this.m_drcEngine!.GetProgressReporter());
    connectivity.FillIsolatedIslandsMap(board.m_ZoneIsolatedIslandsMap, true);

    return !this.m_drcEngine!.IsCancelled();
  }
}
