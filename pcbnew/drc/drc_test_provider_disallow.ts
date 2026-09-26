// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_disallow.cpp`.
 *
 * "Disallow" test. Goes through all items, matching types/conditions drop errors.
 * Errors generated:
 * - DRCE_ALLOWED_ITEMS
 * - DRCE_TEXT_ON_EDGECUTS
 */
import { HOLE_PROXY } from '@ziroeda/common/eda_item_flags.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { BaseType, KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import type { OutInt } from '@ziroeda/kimath/src/geometry/shape.js';
import { CornerStrategy } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_TRACK } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T, type DRC_CONSTRAINT } from './drc_rule.js';
import { DRC_RTREE } from './drc_rtree.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_DISALLOW extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'disallow';
  }

  Run(): boolean {
    if (!this.reportPhase('Checking keepouts & disallow constraints...')) return false; // DRC cancelled

    const board = this.m_drcEngine!.GetBoard()!;
    const epsilon = board.GetDesignSettings().GetDRCEpsilon();

    // First build out the board's cache of copper-keepout to copper-zone caches.  This is where
    // the bulk of the time is spent, and we can do this in parallel.
    //
    const antiCopperKeepouts: ZONE[] = [];
    const copperZones: ZONE[] = [];
    const toCache: [ZONE, ZONE][] = [];
    let done = 1;
    let totalCount = 0;
    const antiTrackKeepouts = new DRC_RTREE();

    this.forEachGeometryItem(
      [KICAD_T.PCB_ZONE_T],
      LSET.AllLayersMask(),
      (item: BOARD_ITEM): boolean => {
        const zone = item as ZONE;

        if (zone.GetIsRuleArea()) {
          if (zone.GetDoNotAllowZoneFills()) antiCopperKeepouts.push(zone);

          if (zone.GetDoNotAllowTracks()) {
            for (const layer of zone.GetLayerSet()) antiTrackKeepouts.Insert(zone, layer);
          }
        } else if (zone.IsOnCopperLayer()) {
          copperZones.push(zone);
        }

        totalCount++;
        return true;
      },
    );

    for (const ruleArea of antiCopperKeepouts) {
      for (const copperZone of copperZones) {
        toCache.push([ruleArea, copperZone]);
        totalCount++;
      }
    }

    const query_areas = (idx: number): number => {
      if (this.m_drcEngine!.IsCancelled()) return 0;

      const areaZonePair = toCache[idx]!;
      const ruleArea = areaZonePair[0];
      const copperZone = areaZonePair[1];
      const areaBBox = ruleArea.GetBoundingBox();
      const copperBBox = copperZone.GetBoundingBox();
      let isInside = false;

      if (copperZone.IsFilled() && areaBBox.Intersects(copperBBox)) {
        // Collisions include touching, so we need to deflate outline by enough to
        // exclude it.  This is particularly important for detecting copper fills as
        // they will be exactly touching along the entire exclusion border.
        const areaPoly = ruleArea.Outline().CloneDropTriangulation();
        areaPoly.Fracture();
        areaPoly.Deflate(epsilon, CornerStrategy.ALLOW_ACUTE_CORNERS, ARC_LOW_DEF);

        const zoneRTree = board.m_CopperZoneRTreeCache.get(copperZone);

        if (zoneRTree) {
          for (let ii = 0; ii < ruleArea.GetLayerSet().size(); ++ii) {
            if (ruleArea.GetLayerSet().test(ii)) {
              const layer = ii as PCB_LAYER_ID;

              if (zoneRTree.QueryColliding(areaBBox, areaPoly, layer)) {
                isInside = true;
                break;
              }

              if (this.m_drcEngine!.IsCancelled()) return 0;
            }
          }
        }
      }

      if (this.m_drcEngine!.IsCancelled()) return 0;

      // PTR_PTR_LAYER_CACHE_KEY key = { ruleArea, copperZone, UNDEFINED_LAYER }
      {
        let byItem = board.m_IntersectsAreaCache.get(ruleArea);

        if (!byItem) {
          byItem = new Map();
          board.m_IntersectsAreaCache.set(ruleArea, byItem);
        }

        let byLayer = byItem.get(copperZone);

        if (!byLayer) {
          byLayer = new Map();
          byItem.set(copperZone, byLayer);
        }

        byLayer.set(PCB_LAYER_ID.UNDEFINED_LAYER, isInside);
      }

      done += 1;
      return 1;
    };

    // `tp.submit_loop( 0, toCache.size(), query_areas )`: the pool's loop, in order
    for (let idx = 0; idx < toCache.length; ++idx) {
      query_areas(idx);
      this.reportProgress(done, toCache.length);
    }

    if (this.m_drcEngine!.IsCancelled()) return false;

    // Now go through all the board objects calling the DRC_ENGINE to run the actual disallow
    // tests.  These should be reasonably quick using the caches generated above.
    //
    const progressDelta = 250;
    let ii = toCache.length;

    const checkTextOnEdgeCuts = (item: BOARD_ITEM): void => {
      // Tables and barcodes also plot geometry onto Edge.Cuts and corrupt the
      // board outline. Reference images are excluded since they are never plotted.
      if (
        item.Type() === KICAD_T.PCB_FIELD_T ||
        item.Type() === KICAD_T.PCB_TEXT_T ||
        item.Type() === KICAD_T.PCB_TEXTBOX_T ||
        item.Type() === KICAD_T.PCB_TABLE_T ||
        item.Type() === KICAD_T.PCB_BARCODE_T ||
        BaseType(item.Type()) === KICAD_T.PCB_DIMENSION_T
      ) {
        if (item.GetLayer() === PCB_LAYER_ID.Edge_Cuts) {
          const drc = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TEXT_ON_EDGECUTS)!;
          drc.SetItems(item);
          this.reportViolation(drc, item.GetPosition(), PCB_LAYER_ID.Edge_Cuts);
        }
      }
    };

    const checkAntiTrackKeepout = (track: PCB_TRACK, keepout: ZONE): void => {
      const shape = track.GetEffectiveShape();
      const dummyActual: OutInt = { value: 0 };
      const pos: VECTOR2I = { x: 0, y: 0 };

      if (keepout.Outline().Collide(shape, 0, dummyActual, pos)) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_ALLOWED_ITEMS)!;
        drcItem.SetItems(track);
        this.reportViolation(drcItem, pos, track.GetLayerSet().ExtractLayer());
      }
    };

    this.forEachGeometryItem([], LSET.AllLayersMask(), (item: BOARD_ITEM): boolean => {
      if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TEXT_ON_EDGECUTS))
        checkTextOnEdgeCuts(item);

      if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_ALLOWED_ITEMS)) {
        if (item.Type() === KICAD_T.PCB_ZONE_T) {
          const zone = item as ZONE;

          if (zone.GetIsRuleArea() && zone.HasKeepoutParametersSet()) return true;
        }

        item.ClearFlags(HOLE_PROXY); // Just in case

        if (item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T) {
          const track = item as PCB_TRACK;
          const layer = track.GetLayer();

          antiTrackKeepouts.QueryCollidingItem(
            track,
            layer,
            layer,
            // Filter:
            (_other: BOARD_ITEM): boolean => {
              return true;
            },
            // Visitor:
            (other: BOARD_ITEM): boolean => {
              checkAntiTrackKeepout(track, other as ZONE);
              return !this.m_drcEngine!.IsCancelled();
            },
            board.m_DRCMaxPhysicalClearance,
          );
        }

        // Tracks and arcs against keepout areas that disallow tracks are already
        // reported above via antiTrackKeepouts (which collides every crossing, not
        // just one per rule match).  Skip the track/arc case for implicit keepout
        // rules here to avoid duplicate markers, but still let EvalRules produce
        // markers for all other item types against implicit keepout rules.
        const isTrackOrArc =
          item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T;

        const reportDisallow = (aConstraint: DRC_CONSTRAINT): void => {
          const rule = aConstraint.GetParentRule();

          if (!rule) return;

          if (isTrackOrArc && rule.IsImplicit()) return;

          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_ALLOWED_ITEMS)!;
          const layer = item.GetLayerSet().ExtractLayer();
          let pos = item.GetPosition();

          // Provide a better location for keepout area collisions by
          // snapping to where the item actually crosses the keepout outline.
          // Use the cached BOARD_ITEM* rather than a UUID lookup, since
          // ResolveItem mutates an unsynchronized cache and this lambda
          // runs inside the parallel DRC worker pool.
          if (rule.IsImplicit()) {
            if (rule.m_ImplicitItem && rule.m_ImplicitItem.Type() === KICAD_T.PCB_ZONE_T) {
              const keepout = rule.m_ImplicitItem as ZONE;
              const shape = item.GetEffectiveShape(layer);
              const dummyActual: OutInt = { value: 0 };
              const loc: VECTOR2I = { x: pos.x, y: pos.y };

              keepout.Outline().Collide(shape, 0, dummyActual, loc);
              pos = loc;
            }
          }

          drcItem.SetErrorDetail(`(${aConstraint.GetName()})`);
          drcItem.SetItems(item);
          drcItem.SetViolatingRule(rule);

          this.reportViolation(drcItem, pos, layer);
        };

        let constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT,
          item,
          null,
          PCB_LAYER_ID.UNDEFINED_LAYER,
        );

        if (constraint.m_DisallowFlags && constraint.GetSeverity() !== RPT_SEVERITY_IGNORE) {
          reportDisallow(constraint);
        }

        // N.B. HOLE_PROXY is set/cleared on the item's flags for
        // EvalRules to distinguish hole-specific disallow constraints.
        if (item.HasHole()) {
          item.SetFlags(HOLE_PROXY);

          constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT,
            item,
            null,
            PCB_LAYER_ID.UNDEFINED_LAYER,
          );

          if (constraint.m_DisallowFlags && constraint.GetSeverity() !== RPT_SEVERITY_IGNORE) {
            reportDisallow(constraint);
          }

          item.ClearFlags(HOLE_PROXY);
        }
      }

      if (!this.reportProgress(ii++, totalCount, progressDelta)) return false;

      return true;
    });

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_DISALLOW);
