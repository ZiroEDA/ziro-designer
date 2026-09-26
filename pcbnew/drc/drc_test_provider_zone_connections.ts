// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_zone_connections.cpp`.
 *
 * This loads some rule resolvers for the ZONE_FILLER, and checks that pad thermal relief
 * connections have at least the required number of spokes.
 *
 * Errors generated:
 * - DRCE_STARVED_THERMAL
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { INTERSECTION } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { add, divideI, equal, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { EXCLUDE_ZONES } from '../connectivity/connectivity_data.js';
import { PAD_SHAPE } from '../padstack.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { ISOLATED_ISLANDS, type ZONE } from '../zone.js';
import { ZONE_CONNECTION } from '../zones.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { type DRC_CONSTRAINT, DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_ZONE_CONNECTIONS extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'zone connections';
  }

  private testZoneLayer(aZone: ZONE, aLayer: PCB_LAYER_ID): void {
    const board = this.m_drcEngine!.GetBoard()!;
    const bds = board.GetDesignSettings();
    const connectivity = board.GetConnectivity();
    let constraint: DRC_CONSTRAINT;

    const zoneFill = aZone.GetFilledPolysList(aLayer);
    let isolatedIslands = new ISOLATED_ISLANDS();

    const zoneIter = board.m_ZoneIsolatedIslandsMap.get(aZone);

    if (zoneIter !== undefined) {
      const layerIter = zoneIter.get(aLayer);

      if (layerIter !== undefined) isolatedIslands = layerIter;
    }

    for (const footprint of board.Footprints()) {
      for (const pad of footprint.Pads()) {
        if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_STARVED_THERMAL)) return;

        if (this.m_drcEngine!.IsCancelled()) return;

        //
        // Quick tests for "connected":
        //

        if (pad.GetNetCode() !== aZone.GetNetCode() || pad.GetNetCode() <= 0) continue;

        const item_bbox = pad.GetBoundingBox();

        if (!item_bbox.Intersects(aZone.GetBoundingBox())) continue;

        if (!pad.FlashLayer(aLayer)) continue;

        //
        // If those passed, do a thorough test:
        //

        constraint = bds.m_DRCEngine!.EvalZoneConnection(pad, aZone, aLayer);
        const conn = constraint.m_ZoneConnection;

        if (conn !== ZONE_CONNECTION.THERMAL) continue;

        constraint = bds.m_DRCEngine!.EvalRules(
          DRC_CONSTRAINT_T.MIN_RESOLVED_SPOKES_CONSTRAINT,
          pad,
          aZone,
          aLayer,
        );
        const minCount = constraint.m_Value.Min();

        if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE || minCount <= 0) continue;

        constraint = bds.m_DRCEngine!.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
          pad,
          aZone,
          aLayer,
        );
        const mid_gap = Math.trunc(constraint.m_Value.Min() / 2);

        const padPoly = new SHAPE_POLY_SET();
        pad.TransformShapeToPolygon(padPoly, aLayer, mid_gap, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);

        const padOutline = padPoly.Outline(0);
        const padBBox = padOutline.BBox();
        let spokes = 0;
        let ignoredSpokes = 0;
        let ignoredSpokePos: VECTOR2I = { x: 0, y: 0 };

        for (let jj = 0; jj < zoneFill.OutlineCount(); ++jj) {
          const intersections: INTERSECTION[] = [];

          zoneFill.Outline(jj).Intersect(padOutline, intersections, true, padBBox);

          const unique_intersections: INTERSECTION[] = [];

          for (const i of intersections) {
            const found = unique_intersections.find((j: INTERSECTION): boolean => equal(j.p, i.p));

            if (found === undefined) unique_intersections.push(i);
          }

          // If we connect to an island that only connects to a single item then we *are*
          // that item.  Thermal spokes to this (otherwise isolated) island don't provide
          // electrical connectivity to anything, so we don't count them.
          if (unique_intersections.length >= 2) {
            if (isolatedIslands.m_SingleConnectionOutlines.includes(jj)) {
              ignoredSpokes += Math.trunc(unique_intersections.length / 2);
              ignoredSpokePos = divideI(
                add(unique_intersections[0]!.p, unique_intersections[1]!.p),
                2,
              );
            } else {
              spokes += Math.trunc(unique_intersections.length / 2);
            }
          }
        }

        if (spokes === 0 && ignoredSpokes === 0) continue; // Not connected at all

        let customSpokes = 0;

        if (pad.GetShape(aLayer) === PAD_SHAPE.CUSTOM) {
          for (const primitive of pad.GetPrimitives(aLayer)) {
            if (primitive.IsProxyItem() && primitive.GetShape() === SHAPE_T.SEGMENT) customSpokes++;
          }
        }

        if (customSpokes > 0) {
          if (spokes < customSpokes) {
            const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_STARVED_THERMAL)!;
            let pos: VECTOR2I;

            if (ignoredSpokes) {
              drce.SetErrorDetail(
                `(layer ${board.GetLayerName(aLayer)}; ${ignoredSpokes} spokes connected to isolated island)`,
              );
              pos = ignoredSpokePos;
            } else {
              drce.SetErrorDetail(
                `(layer ${board.GetLayerName(aLayer)}; ${constraint.GetName()} custom spoke count ${customSpokes}; actual ${spokes})`,
              );
              pos = pad.GetPosition();
            }

            drce.SetItems(aZone, pad);
            drce.SetViolatingRule(constraint.GetParentRule());

            this.reportViolation(drce, pos, aLayer);
          }

          continue;
        }

        if (spokes >= minCount) continue; // We already have enough

        //
        // See if there are any other manual spokes added:
        //

        for (const track of connectivity.GetConnectedTracks(pad)) {
          if (padOutline.PointInside(track.GetStart())) {
            if (aZone.GetFilledPolysList(aLayer).Collide(track.GetEnd())) spokes++;
          } else if (padOutline.PointInside(track.GetEnd())) {
            if (aZone.GetFilledPolysList(aLayer).Collide(track.GetStart())) spokes++;
          }
        }

        for (const item of connectivity.GetConnectedItems(pad, EXCLUDE_ZONES)) {
          const shape = item instanceof PCB_SHAPE ? item : null;

          if (!shape || !shape.IsOnLayer(aLayer)) continue;

          const connectionPts = shape.GetConnectionPoints();

          for (const pt of connectionPts) {
            if (padOutline.PointInside(pt)) {
              for (const other of connectionPts) {
                if (!equal(other, pt) && zoneFill.Collide(other)) {
                  spokes++;
                  break;
                }
              }

              break;
            }
          }
        }

        //
        // If we're *only* connected to isolated islands, then ignore the fact that they're
        // isolated.  (We leave that for the connectivity tester, which checks connections on
        // all layers.)
        //

        if (spokes === 0) {
          spokes += ignoredSpokes;
          ignoredSpokes = 0;
        }

        //
        // And finally report it if there aren't enough:
        //

        if (spokes < minCount) {
          const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_STARVED_THERMAL)!;
          let pos: VECTOR2I;

          if (ignoredSpokes) {
            drce.SetErrorDetail(
              `(layer ${board.GetLayerName(aLayer)}; ${ignoredSpokes} spokes connected to isolated island)`,
            );
            pos = ignoredSpokePos;
          } else {
            drce.SetErrorDetail(
              `(layer ${board.GetLayerName(aLayer)}; ${constraint.GetName()} min spoke count ${minCount}; actual ${spokes})`,
            );
            pos = pad.GetPosition();
          }

          drce.SetItems(aZone, pad);
          drce.SetViolatingRule(constraint.GetParentRule());

          this.reportViolation(drce, pos, aLayer);
        }
      }
    }
  }

  Run(): boolean {
    const board = this.m_drcEngine!.GetBoard()!;

    if (!this.reportPhase('Checking thermal reliefs...')) return false; // DRC cancelled

    const zoneLayers: [ZONE, PCB_LAYER_ID][] = [];
    let done = 1;
    let total_effort = 0;

    for (const zone of board.m_DRCCopperZones) {
      if (!zone.IsTeardropArea()) {
        for (const layer of zone.GetLayerSet()) {
          zoneLayers.push([zone, layer]);
          total_effort += zone.GetFilledPolysList(layer).FullPointCount();
        }
      }
    }

    total_effort = Math.max(1, total_effort);

    // The thread pool's loop runs here one zone layer at a time, with the
    // progress reported as the wait loop would.
    for (let ii = 0; ii < zoneLayers.length; ++ii) {
      if (!this.m_drcEngine!.IsCancelled()) {
        const [zone, layer] = zoneLayers[ii]!;
        this.testZoneLayer(zone, layer);
        done += zone.GetFilledPolysList(layer).FullPointCount();
      }

      this.reportProgress(done, total_effort);
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_ZONE_CONNECTIONS);
