// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_solder_mask.cpp`.
 *
 * Solder mask tests. Checks for silkscreen which is clipped by mask openings and for bridges
 * between mask apertures with different nets.
 * Errors generated:
 * - DRCE_SILK_MASK_CLEARANCE
 * - DRCE_SOLDERMASK_BRIDGE
 */
import { IsFrontLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { CornerStrategy } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PAD } from '../pad.js';
import { PADSTACK } from '../padstack.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TEXT } from '../pcb_text.js';
import type { PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_RTREE } from './drc_rtree.js';
import { DRC_CONSTRAINT, DRC_CONSTRAINT_T, DRC_RULE } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';
import { ptrOrdinal, ptrPairKey } from './ptr_order.js';

function isNPTHPadWithNoCopper(aItem: BOARD_ITEM): boolean {
  if (aItem.Type() === KICAD_T.PCB_PAD_T) return (aItem as PAD).IsNPTHWithNoCopper();

  return false;
}

// Simple mask apertures aren't associated with copper items, so they only constitute a bridge
// when they expose other copper items having at least two distinct nets.  We use a map to record
// the first net exposed by each mask aperture (on each copper layer).
//
// Note that this algorithm is also used for free pads.

function isMaskAperture(aItem: BOARD_ITEM): boolean {
  if (aItem.Type() === KICAD_T.PCB_PAD_T && (aItem as PAD).IsFreePad()) return true;

  const saved = new LSET([PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask]);

  const maskLayers = aItem.GetLayerSet().and(saved);
  const copperLayers = aItem.GetLayerSet().and(new LSET(saved).flip()).and(LSET.AllCuMask());

  return maskLayers.count() > 0 && copperLayers.count() === 0;
}

/** `PTR_LAYER_CACHE_KEY` as a map key. */
const ptrLayerKey = (aItem: BOARD_ITEM, aLayer: PCB_LAYER_ID): string =>
  `${ptrOrdinal(aItem)}:${aLayer}`;

interface MASK_APERTURE_COLLISION {
  aperture: BOARD_ITEM;
  collidingItem: BOARD_ITEM;
  collidingNet: number;
  pos: VECTOR2I;
  layer: PCB_LAYER_ID;
}

export class DRC_TEST_PROVIDER_SOLDER_MASK extends DRC_TEST_PROVIDER {
  private readonly m_bridgeRule = new DRC_RULE();

  private m_webWidth = 0;
  private m_maxError = 0;
  private m_largestClearance = 0;

  private m_fullSolderMaskRTree: DRC_RTREE | null = null;
  private m_itemTree: DRC_RTREE | null = null;

  private readonly m_checkedPairs = new Map<string, LSET>();

  // Shapes used to define solder mask apertures don't have nets, so we assign them the
  // first object+net that bridges their aperture (after which any other nets will generate
  // violations).
  //
  // When "report all track errors" is enabled, we store all items per net so we can report
  // violations for each pair of items from different nets.
  private readonly m_maskApertureNetMap = new Map<string, [BOARD_ITEM, number]>();

  // Extended storage for "report all track errors" mode: stores all items per net per aperture
  private readonly m_maskApertureNetMapAll = new Map<string, [BOARD_ITEM, number][]>();

  // Pending collision info for deferred violation reporting (avoids race condition).
  // Stores info about each mask aperture that bridges different nets.
  private readonly m_pendingCollisions: MASK_APERTURE_COLLISION[] = [];

  constructor() {
    super();
    this.m_bridgeRule.m_Name = 'board setup solder mask min width';
  }

  override GetName(): string {
    return 'solder_mask_issues';
  }

  private addItemToRTrees(aItem: BOARD_ITEM): void {
    for (const layer of [PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask]) {
      if (!aItem.IsOnLayer(layer)) continue;

      const solderMask = this.m_board!.m_SolderMaskBridges.GetFill(layer)!;

      if (aItem.Type() === KICAD_T.PCB_ZONE_T) {
        const zone = aItem as ZONE;

        solderMask.BooleanAdd(zone.GetFilledPolysList(layer));
      } else {
        let clearance = Math.trunc(this.m_webWidth / 2);

        if (aItem.Type() === KICAD_T.PCB_PAD_T)
          clearance += (aItem as PAD).GetSolderMaskExpansion(layer);
        else if (aItem.Type() === KICAD_T.PCB_VIA_T)
          clearance += (aItem as PCB_VIA).GetSolderMaskExpansion();
        else if (aItem.Type() === KICAD_T.PCB_SHAPE_T)
          clearance += (aItem as PCB_SHAPE).GetSolderMaskExpansion();

        if (aItem.Type() === KICAD_T.PCB_FIELD_T || aItem.Type() === KICAD_T.PCB_TEXT_T) {
          const text = aItem as PCB_TEXT;

          text.TransformTextToPolySet(
            solderMask,
            clearance,
            this.m_maxError,
            ERROR_LOC.ERROR_OUTSIDE,
          );
        } else {
          aItem.TransformShapeToPolygon(
            solderMask,
            layer,
            clearance,
            this.m_maxError,
            ERROR_LOC.ERROR_OUTSIDE,
          );
        }

        this.m_itemTree!.Insert(aItem, layer, undefined, this.m_largestClearance);
      }
    }
  }

  private buildRTrees(): void {
    const solderMask = this.m_board!.m_SolderMaskBridges;
    const layers = new LSET([
      PCB_LAYER_ID.F_Mask,
      PCB_LAYER_ID.B_Mask,
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.B_Cu,
    ]);

    const progressDelta = 500;
    let count = 0;
    let ii = 0;

    solderMask.GetFill(PCB_LAYER_ID.F_Mask)!.RemoveAllContours();
    solderMask.GetFill(PCB_LAYER_ID.B_Mask)!.RemoveAllContours();

    this.m_fullSolderMaskRTree = new DRC_RTREE();
    this.m_itemTree = new DRC_RTREE();

    this.forEachGeometryItem(DRC_TEST_PROVIDER.s_allBasicItems, layers, (): boolean => {
      ++count;
      return true;
    });

    this.forEachGeometryItem(
      DRC_TEST_PROVIDER.s_allBasicItems,
      layers,
      (item: BOARD_ITEM): boolean => {
        if (!this.reportProgress(ii++, count, progressDelta)) return false;

        this.addItemToRTrees(item);
        return true;
      },
    );

    solderMask.GetFill(PCB_LAYER_ID.F_Mask)!.Simplify();
    solderMask.GetFill(PCB_LAYER_ID.B_Mask)!.Simplify();

    if (this.m_webWidth > 0) {
      solderMask
        .GetFill(PCB_LAYER_ID.F_Mask)!
        .Deflate(
          Math.trunc(this.m_webWidth / 2),
          CornerStrategy.CHAMFER_ALL_CORNERS,
          this.m_maxError,
        );
      solderMask
        .GetFill(PCB_LAYER_ID.B_Mask)!
        .Deflate(
          Math.trunc(this.m_webWidth / 2),
          CornerStrategy.CHAMFER_ALL_CORNERS,
          this.m_maxError,
        );
    }

    solderMask.SetFillFlag(PCB_LAYER_ID.F_Mask, true);
    solderMask.SetFillFlag(PCB_LAYER_ID.B_Mask, true);
    solderMask.SetIsFilled(true);

    solderMask.CacheTriangulation();

    this.m_fullSolderMaskRTree.Insert(solderMask, PCB_LAYER_ID.F_Mask);
    this.m_fullSolderMaskRTree.Insert(solderMask, PCB_LAYER_ID.B_Mask);

    this.m_checkedPairs.clear();
  }

  private testSilkToMaskClearance(): void {
    const silkLayers = new LSET([PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.B_SilkS]);

    // If we have no minimum web width then we delegate to the silk checker which does object-to-object
    // testing (instead of object-to-solder-mask-zone-fill checking that we do here).
    if (this.m_webWidth <= 0) return;

    const progressDelta = 250;
    let count = 0;
    let ii = 0;

    this.forEachGeometryItem(DRC_TEST_PROVIDER.s_allBasicItems, silkLayers, (): boolean => {
      ++count;
      return true;
    });

    this.forEachGeometryItem(
      DRC_TEST_PROVIDER.s_allBasicItems,
      silkLayers,
      (item: BOARD_ITEM): boolean => {
        if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE))
          return false;

        if (!this.reportProgress(ii++, count, progressDelta)) return false;

        if (this.isInvisibleText(item)) return true;

        for (const layer of silkLayers) {
          if (!item.IsOnLayer(layer)) continue;

          const maskLayer =
            layer === PCB_LAYER_ID.F_SilkS ? PCB_LAYER_ID.F_Mask : PCB_LAYER_ID.B_Mask;
          const itemBBox = item.GetBoundingBox();
          const constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT,
            item,
            null,
            maskLayer,
          );
          const clearance = constraint.GetValue().Min();
          const actual = { value: 0 };
          const pos = { value: { x: 0, y: 0 } as VECTOR2I };

          if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE || clearance < 0) return true;

          const itemShape = item.GetEffectiveShape(layer);

          if (
            this.m_fullSolderMaskRTree!.QueryColliding(
              itemBBox,
              itemShape,
              maskLayer,
              clearance,
              actual,
              pos,
            )
          ) {
            const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE)!;

            if (clearance > 0) {
              drce.SetErrorDetail(
                this.formatMsg(
                  '(%s clearance %s; actual %s)',
                  constraint.GetName(),
                  clearance,
                  actual.value,
                ),
              );
            }

            drce.SetItems(item);
            drce.SetViolatingRule(constraint.GetParentRule());

            this.reportViolation(drce, pos.value, layer);
          }
        }

        return true;
      },
    );
  }

  private checkMaskAperture(
    aMaskItem: BOARD_ITEM,
    aTestItem: BOARD_ITEM,
    aTestLayer: PCB_LAYER_ID,
    aTestNet: number,
    aCollidingItem: { value: BOARD_ITEM | null },
  ): boolean {
    if (aTestLayer === PCB_LAYER_ID.F_Mask && !aTestItem.IsOnLayer(PCB_LAYER_ID.F_Cu)) return false;

    if (aTestLayer === PCB_LAYER_ID.B_Mask && !aTestItem.IsOnLayer(PCB_LAYER_ID.B_Cu)) return false;

    const maskLayer = IsFrontLayer(aTestLayer) ? PCB_LAYER_ID.F_Mask : PCB_LAYER_ID.B_Mask;

    const fp = aMaskItem.GetParentFootprint();

    // Mask apertures in footprints which allow soldermask bridges are ignored entirely.
    if (fp && fp.AllowSolderMaskBridges()) return false;

    const key = ptrLayerKey(aMaskItem, maskLayer);
    let alreadyEncounteredItem: BOARD_ITEM | null = null;
    let encounteredItemNet = -1;

    {
      const ii = this.m_maskApertureNetMap.get(key);

      const all = this.m_maskApertureNetMapAll.get(key) ?? [];
      this.m_maskApertureNetMapAll.set(key, all);

      if (ii === undefined) {
        this.m_maskApertureNetMap.set(key, [aTestItem, aTestNet]);
        all.push([aTestItem, aTestNet]);

        // First net; no bridge yet....
        return false;
      }

      alreadyEncounteredItem = ii[0];
      encounteredItemNet = ii[1];

      // Always store the item in the full list for complete violation reporting.
      // This ensures all items are available when we generate violations in post-processing,
      // avoiding race conditions from parallel thread execution.
      all.push([aTestItem, aTestNet]);

      if (encounteredItemNet === aTestNet) return false;

      // Net code <= 0 is no net (NPTH, <no net> items). Cannot bridge.
      if (aTestNet <= 0) return false;

      if (encounteredItemNet <= 0) {
        // Replace the no-net placeholder with this real net.
        this.m_maskApertureNetMap.set(key, [aTestItem, aTestNet]);
        return false;
      }
    }

    if (fp && aTestItem.GetParentFootprint() === fp) {
      const padToNetTieGroupMap = fp.MapPadNumbersToNetTieGroups();
      let padA: PAD | null = null;
      let padB: PAD | null = null;

      if (alreadyEncounteredItem.Type() === KICAD_T.PCB_PAD_T) padA = alreadyEncounteredItem as PAD;

      if (aTestItem.Type() === KICAD_T.PCB_PAD_T) padB = aTestItem as PAD;

      if (padA && padB && (padA.SameLogicalPadAs(padB) || padA.SharesNetTieGroup(padB))) {
        return false;
      } else if (padA && aTestItem.Type() === KICAD_T.PCB_SHAPE_T) {
        if (padToNetTieGroupMap.has(padA.GetNumber())) return false;
      } else if (padB && alreadyEncounteredItem.Type() === KICAD_T.PCB_SHAPE_T) {
        if (padToNetTieGroupMap.has(padB.GetNumber())) return false;
      }
    }

    aCollidingItem.value = alreadyEncounteredItem;
    return true;
  }

  private checkItemMask(aItem: BOARD_ITEM, aTestNet: number): boolean {
    const fp = aItem.GetParentFootprint();

    if (fp) {
      // If we're allowing bridges then we're allowing bridges.  Nothing to check.
      if (fp.AllowSolderMaskBridges()) return false;

      // Items belonging to a net-tie may share the mask aperture of pads in the same group.
      if (aItem.Type() === KICAD_T.PCB_PAD_T && fp.IsNetTie()) {
        const pad = aItem as PAD;
        const padNumberToGroupIdxMap = fp.MapPadNumbersToNetTieGroups();
        // `std::map::operator[]` inserts a default (0) for a missing key.
        const groupIdx = padNumberToGroupIdxMap.get(pad.GetNumber()) ?? 0;

        if (groupIdx >= 0) {
          if (aTestNet < 0) return false;

          if (pad.GetNetCode() === aTestNet) return false;

          for (const other of fp.GetNetTiePads(pad)) {
            if (other.GetNetCode() === aTestNet) return false;
          }
        }
      }
    }

    return true;
  }

  private testItemAgainstItems(
    aItem: BOARD_ITEM,
    _aItemBBox: BOX2I,
    aRefLayer: PCB_LAYER_ID,
    aTargetLayer: PCB_LAYER_ID,
  ): void {
    const pad = aItem.Type() === KICAD_T.PCB_PAD_T ? (aItem as PAD) : null;
    const via = aItem.Type() === KICAD_T.PCB_VIA_T ? (aItem as PCB_VIA) : null;
    const shape = aItem.Type() === KICAD_T.PCB_SHAPE_T ? (aItem as PCB_SHAPE) : null;
    let itemNet = -1;

    let itemConstraint: DRC_CONSTRAINT | null = null;
    let otherConstraint = new DRC_CONSTRAINT();

    if (aItem.IsConnected()) itemNet = (aItem as BOARD_CONNECTED_ITEM).GetNetCode();

    const itemShape = aItem.GetEffectiveShape(aRefLayer);

    this.m_itemTree!.QueryCollidingItem(
      aItem,
      aRefLayer,
      aTargetLayer,
      // Filter:
      (other: BOARD_ITEM): boolean => {
        const itemFP = aItem.GetParentFootprint();
        const otherPad = other.Type() === KICAD_T.PCB_PAD_T ? (other as PAD) : null;
        let otherNet = -1;

        if (other.IsConnected()) otherNet = (other as BOARD_CONNECTED_ITEM).GetNetCode();

        if (otherNet > 0 && otherNet === itemNet) return false;

        if (isNPTHPadWithNoCopper(other)) return false;

        if (itemFP && itemFP === other.GetParentFootprint()) {
          // Board-wide exclusion
          const board = itemFP.GetBoard();

          if (board) {
            if (board.GetDesignSettings().m_AllowSoldermaskBridgesInFPs) return false;
          }

          // Footprint-specific exclusion
          if (itemFP.AllowSolderMaskBridges()) return false;
        }

        if (
          pad &&
          otherPad &&
          (pad.SameLogicalPadAs(otherPad) || pad.SharesNetTieGroup(otherPad))
        ) {
          return false;
        }

        if (itemFP && itemFP.IsNetTie()) {
          const nets = itemFP.GetNetTieCache(aItem);

          if (otherNet < 0 || nets.has(otherNet)) return false;
        }

        const otherFP = other.GetParentFootprint();

        if (otherFP && otherFP.IsNetTie()) {
          const nets = otherFP.GetNetTieCache(other);

          if (itemNet < 0 || nets.has(itemNet)) return false;
        }

        // store canonical order so we don't collide in both directions (a:b and b:a)
        const key = ptrPairKey(aItem, other);

        {
          const it = this.m_checkedPairs.get(key);

          if (it !== undefined && it.test(aTargetLayer)) {
            return false;
          } else {
            if (it === undefined) this.m_checkedPairs.set(key, new LSET().set(aTargetLayer));
            else it.set(aTargetLayer);
            return true;
          }
        }
      },
      // Visitor:
      (other: BOARD_ITEM): boolean => {
        const otherPad = other.Type() === KICAD_T.PCB_PAD_T ? (other as PAD) : null;
        const otherVia = other.Type() === KICAD_T.PCB_VIA_T ? (other as PCB_VIA) : null;
        const otherShape = other.Type() === KICAD_T.PCB_SHAPE_T ? (other as PCB_SHAPE) : null;
        const otherItemShape = other.GetEffectiveShape(aTargetLayer);
        let otherNet = -1;

        if (other.IsConnected()) otherNet = (other as BOARD_CONNECTED_ITEM).GetNetCode();

        const actual = { value: 0 };
        const pos: VECTOR2I = { x: 0, y: 0 };
        let clearance = 0;

        if (aRefLayer === PCB_LAYER_ID.F_Mask || aRefLayer === PCB_LAYER_ID.B_Mask) {
          // Aperture-to-aperture must enforce web-min-width
          clearance = this.m_webWidth;
        } // ( aRefLayer == F_Cu || aRefLayer == B_Cu )
        else {
          // Copper-to-aperture uses the solder-mask-to-copper-clearance
          clearance = this.m_board!.GetDesignSettings().m_SolderMaskToCopperClearance;
        }

        if (pad) clearance += pad.GetSolderMaskExpansion(aRefLayer);
        else if (via && !via.IsTented(aRefLayer)) clearance += via.GetSolderMaskExpansion();
        else if (shape) clearance += shape.GetSolderMaskExpansion();

        if (otherPad) clearance += otherPad.GetSolderMaskExpansion(aTargetLayer);
        else if (otherVia && !otherVia.IsTented(aTargetLayer))
          clearance += otherVia.GetSolderMaskExpansion();
        else if (otherShape) clearance += otherShape.GetSolderMaskExpansion();

        if (itemShape.Collide(otherItemShape, clearance, actual, pos)) {
          if (itemConstraint === null) {
            itemConstraint = this.m_drcEngine!.EvalRules(
              DRC_CONSTRAINT_T.BRIDGED_MASK_CONSTRAINT,
              aItem,
              null,
              aRefLayer,
            );
          }

          otherConstraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.BRIDGED_MASK_CONSTRAINT,
            other,
            null,
            aTargetLayer,
          );

          const itemConstraintIgnored = itemConstraint.GetSeverity() === RPT_SEVERITY_IGNORE;
          const otherConstraintIgnored = otherConstraint.GetSeverity() === RPT_SEVERITY_IGNORE;

          // Mask apertures are ignored on their own; in other cases both participants must be ignored
          if (
            (isMaskAperture(aItem) && itemConstraintIgnored) ||
            (isMaskAperture(other) && otherConstraintIgnored) ||
            (itemConstraintIgnored && otherConstraintIgnored)
          ) {
            return !this.m_drcEngine!.IsCancelled();
          }

          let msg: string;
          const colliding = { value: null as BOARD_ITEM | null };

          if (aTargetLayer === PCB_LAYER_ID.F_Mask)
            msg = 'Front solder mask aperture bridges items with different nets';
          else msg = 'Rear solder mask aperture bridges items with different nets';

          // Simple mask apertures aren't associated with copper items, so they only
          // constitute a bridge when they expose other copper items having at least
          // two distinct nets.
          if (isMaskAperture(aItem)) {
            if (this.checkMaskAperture(aItem, other, aRefLayer, otherNet, colliding)) {
              // Store collision info for deferred reporting after all threads complete.
              // This avoids race conditions where some items haven't been added yet.
              this.m_pendingCollisions.push({
                aperture: aItem,
                collidingItem: other,
                collidingNet: otherNet,
                pos: { x: pos.x, y: pos.y },
                layer: aTargetLayer,
              });
            }
          } else if (isMaskAperture(other)) {
            if (this.checkMaskAperture(other, aItem, aRefLayer, itemNet, colliding)) {
              // Store collision info for deferred reporting after all threads complete.
              // This avoids race conditions where some items haven't been added yet.
              this.m_pendingCollisions.push({
                aperture: other,
                collidingItem: aItem,
                collidingNet: itemNet,
                pos: { x: pos.x, y: pos.y },
                layer: aTargetLayer,
              });
            }
          } else if (this.checkItemMask(other, itemNet)) {
            const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE)!;

            drce.SetErrorMessage(msg);
            drce.SetItems(aItem, other);
            drce.SetViolatingRule(this.m_bridgeRule);
            this.reportViolation(drce, pos, aTargetLayer);
          }
        }

        return !this.m_drcEngine!.IsCancelled();
      },
      this.m_largestClearance,
    );
  }

  private testMaskItemAgainstZones(
    aItem: BOARD_ITEM,
    aItemBBox: BOX2I,
    aMaskLayer: PCB_LAYER_ID,
    aTargetLayer: PCB_LAYER_ID,
  ): void {
    const pad = aItem.Type() === KICAD_T.PCB_PAD_T ? (aItem as PAD) : null;
    const via = aItem.Type() === KICAD_T.PCB_VIA_T ? (aItem as PCB_VIA) : null;
    const shape = aItem.Type() === KICAD_T.PCB_SHAPE_T ? (aItem as PCB_SHAPE) : null;

    for (const zone of this.m_board!.m_DRCCopperZones) {
      if (!zone.GetLayerSet().test(aTargetLayer)) continue;

      const zoneNet = zone.GetNetCode();

      if (aItem.IsConnected()) {
        const connectedItem = aItem as BOARD_CONNECTED_ITEM;

        if (zoneNet === connectedItem.GetNetCode() && zoneNet > 0) continue;
      }

      const inflatedBBox = aItemBBox.Clone();
      let clearance = this.m_board!.GetDesignSettings().m_SolderMaskToCopperClearance;

      if (pad) clearance += pad.GetSolderMaskExpansion(aTargetLayer);
      else if (via && !via.IsTented(aTargetLayer)) clearance += via.GetSolderMaskExpansion();
      else if (shape) clearance += shape.GetSolderMaskExpansion();

      inflatedBBox.Inflate(clearance);

      if (!inflatedBBox.Intersects(zone.GetBoundingBox())) continue;

      const zoneTree = this.m_board!.m_CopperZoneRTreeCache.get(zone) ?? null;
      const actual = { value: 0 };
      const pos = { value: { x: 0, y: 0 } as VECTOR2I };

      const itemShape = aItem.GetEffectiveShape(aMaskLayer);

      if (
        zoneTree &&
        zoneTree.QueryColliding(aItemBBox, itemShape, aTargetLayer, clearance, actual, pos)
      ) {
        let msg: string;
        const colliding = { value: null as BOARD_ITEM | null };

        if (aMaskLayer === PCB_LAYER_ID.F_Mask)
          msg = 'Front solder mask aperture bridges items with different nets';
        else msg = 'Rear solder mask aperture bridges items with different nets';

        // Simple mask apertures aren't associated with copper items, so they only constitute
        // a bridge when they expose other copper items having at least two distinct nets.
        if (isMaskAperture(aItem) && zoneNet >= 0) {
          if (this.checkMaskAperture(aItem, zone, aTargetLayer, zoneNet, colliding)) {
            const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE)!;

            drce.SetErrorMessage(msg);
            drce.SetItems(aItem, colliding.value, zone);
            drce.SetViolatingRule(this.m_bridgeRule);
            this.reportViolation(drce, pos.value, aTargetLayer);
          }
        } else {
          const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE)!;

          drce.SetErrorMessage(msg);
          drce.SetItems(aItem, zone);
          drce.SetViolatingRule(this.m_bridgeRule);
          this.reportViolation(drce, pos.value, aTargetLayer);
        }
      }

      if (this.m_drcEngine!.IsCancelled()) return;
    }
  }

  private testMaskBridges(): void {
    const copperAndMaskLayers = new LSET([
      PCB_LAYER_ID.F_Mask,
      PCB_LAYER_ID.B_Mask,
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.B_Cu,
    ]);
    let count = 0;
    const test_items: BOARD_ITEM[] = [];

    this.forEachGeometryItem(
      DRC_TEST_PROVIDER.s_allBasicItemsButZones,
      copperAndMaskLayers,
      (item: BOARD_ITEM): boolean => {
        test_items.push(item);
        return true;
      },
    );

    // The thread pool's loop runs here one item at a time, with the progress
    // reported as the wait loop would.
    for (let i = 0; i < test_items.length; ++i) {
      const item = test_items[i]!;

      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE)) break;

      const itemBBox = item.GetBoundingBox();

      if (item.IsOnLayer(PCB_LAYER_ID.F_Mask) && !isNPTHPadWithNoCopper(item)) {
        // Test for aperture-to-aperture collisions
        this.testItemAgainstItems(item, itemBBox, PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.F_Mask);

        // Test for aperture-to-zone collisions
        this.testMaskItemAgainstZones(item, itemBBox, PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.F_Cu);
      } else if (item.IsOnLayer(PADSTACK.ALL_LAYERS)) {
        // Test for copper-item-to-aperture collisions
        this.testItemAgainstItems(item, itemBBox, PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Mask);
      }

      if (item.IsOnLayer(PCB_LAYER_ID.B_Mask) && !isNPTHPadWithNoCopper(item)) {
        // Test for aperture-to-aperture collisions
        this.testItemAgainstItems(item, itemBBox, PCB_LAYER_ID.B_Mask, PCB_LAYER_ID.B_Mask);

        // Test for aperture-to-zone collisions
        this.testMaskItemAgainstZones(item, itemBBox, PCB_LAYER_ID.B_Mask, PCB_LAYER_ID.B_Cu);
      } else if (item.IsOnLayer(PCB_LAYER_ID.B_Cu)) {
        // Test for copper-item-to-aperture collisions
        this.testItemAgainstItems(item, itemBBox, PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.B_Mask);
      }

      ++count;

      this.reportProgress(count, test_items.length);
    }

    // Process deferred mask aperture violations now that all threads have completed.
    // This ensures we have the complete list of items for each aperture.
    const reportedTriplets = new Set<string>();
    const tripletKey = (a: BOARD_ITEM, b: BOARD_ITEM, c: BOARD_ITEM): string =>
      `${ptrOrdinal(a)}:${ptrOrdinal(b)}:${ptrOrdinal(c)}`;

    for (const collision of this.m_pendingCollisions) {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE)) break;

      const maskLayer = IsFrontLayer(collision.layer) ? PCB_LAYER_ID.F_Mask : PCB_LAYER_ID.B_Mask;
      const key = ptrLayerKey(collision.aperture, maskLayer);

      let itemsInAperture: [BOARD_ITEM, number][] = [];

      {
        const it = this.m_maskApertureNetMapAll.get(key);

        if (it !== undefined) itemsInAperture = it;
      }

      let msg: string;

      if (collision.layer === PCB_LAYER_ID.F_Mask)
        msg = 'Front solder mask aperture bridges items with different nets';
      else msg = 'Rear solder mask aperture bridges items with different nets';

      let reportedAnyTrack = false;

      for (const [firstNetItem, firstNet] of itemsInAperture) {
        // Only report items from a different net than the colliding item.
        if (firstNet === collision.collidingNet) continue;

        // No-net items cannot bridge.
        if (firstNet <= 0) continue;

        // Deduplicate: ensure we don't report the same triplet twice.
        const k = tripletKey(collision.aperture, firstNetItem, collision.collidingItem);

        if (reportedTriplets.has(k)) continue;

        reportedTriplets.add(k);

        // Also insert the reverse to avoid reporting (A, B, C) and (A, C, B).
        reportedTriplets.add(tripletKey(collision.aperture, collision.collidingItem, firstNetItem));

        const firstIsTrack =
          firstNetItem.Type() === KICAD_T.PCB_TRACE_T || firstNetItem.Type() === KICAD_T.PCB_ARC_T;

        if (firstIsTrack) {
          if (this.m_drcEngine!.GetReportAllTrackErrors() || !reportedAnyTrack) {
            const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE)!;

            drce.SetErrorMessage(msg);
            drce.SetItems(collision.aperture, firstNetItem, collision.collidingItem);
            drce.SetViolatingRule(this.m_bridgeRule);
            this.reportViolation(drce, collision.pos, collision.layer);
            reportedAnyTrack = true;
          }
        } else {
          const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE)!;

          drce.SetErrorMessage(msg);
          drce.SetItems(collision.aperture, firstNetItem, collision.collidingItem);
          drce.SetViolatingRule(this.m_bridgeRule);
          this.reportViolation(drce, collision.pos, collision.layer);
        }
      }
    }
  }

  Run(): boolean {
    if (
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE) &&
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE)
    ) {
      this.REPORT_AUX('Solder mask violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    this.m_board = this.m_drcEngine!.GetBoard();
    this.m_webWidth = this.m_board!.GetDesignSettings().m_SolderMaskMinWidth;
    this.m_maxError = this.m_board!.GetDesignSettings().m_MaxError;
    this.m_largestClearance = 0;

    const updateLargestClearance = (aClearance: number): void => {
      this.m_largestClearance = Math.max(this.m_largestClearance, aClearance);
    };

    for (const footprint of this.m_board!.Footprints()) {
      for (const pad of footprint.Pads())
        updateLargestClearance(pad.GetSolderMaskExpansion(PADSTACK.ALL_LAYERS));

      for (const item of footprint.GraphicalItems()) {
        if (item.Type() === KICAD_T.PCB_SHAPE_T)
          updateLargestClearance((item as PCB_SHAPE).GetSolderMaskExpansion());
      }
    }

    for (const track of this.m_board!.Tracks())
      updateLargestClearance(track.GetSolderMaskExpansion());

    for (const item of this.m_board!.Drawings()) {
      if (item.Type() === KICAD_T.PCB_SHAPE_T)
        updateLargestClearance((item as PCB_SHAPE).GetSolderMaskExpansion());
    }

    // Order is important here: m_webWidth must be added in before m_largestClearance is
    // maxed with the various clearance constraints.
    // biome-ignore lint/suspicious/noMisrefactoredShorthandAssign: the C++ doubles it, `m_largestClearance += m_largestClearance + m_webWidth`
    this.m_largestClearance += this.m_largestClearance + this.m_webWidth;

    // Include SolderMaskToCopperClearance so R-tree queries find copper items that are within
    // the required distance of mask apertures. Without this, tracks passing near pad apertures
    // from different nets would not be found if SolderMaskToCopperClearance > m_largestClearance.
    this.m_largestClearance = Math.max(
      this.m_largestClearance,
      this.m_board!.GetDesignSettings().m_SolderMaskToCopperClearance,
    );

    const worstClearanceConstraint = this.m_drcEngine!.QueryWorstConstraint(
      DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT,
    );

    if (worstClearanceConstraint) {
      this.m_largestClearance = Math.max(
        this.m_largestClearance,
        worstClearanceConstraint.m_Value.Min(),
      );
    }

    if (!this.reportPhase('Building solder mask...')) return false; // DRC cancelled

    this.m_checkedPairs.clear();
    this.m_maskApertureNetMap.clear();
    this.m_maskApertureNetMapAll.clear();
    this.m_pendingCollisions.length = 0;

    this.buildRTrees();

    if (!this.reportPhase('Checking solder mask to silk clearance...')) return false; // DRC cancelled

    this.testSilkToMaskClearance();

    if (!this.reportPhase('Checking solder mask web integrity...')) return false; // DRC cancelled

    this.testMaskBridges();

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_SOLDER_MASK);
