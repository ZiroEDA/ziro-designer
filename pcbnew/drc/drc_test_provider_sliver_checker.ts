// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_sliver_checker.cpp`.
 *
 * Checks for slivers in copper layers
 *
 * Errors generated:
 * - DRCE_COPPER_SLIVER
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { pcbMmToIU } from '@ziroeda/common/eda_units.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SquaredEuclideanNorm, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import { ZONE } from '../zone.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

/** `DEG2RAD` (`trigo.h`). */
const DEG2RAD = (deg: number): number => (deg * Math.PI) / 180.0;

/** `std::numeric_limits<float>::epsilon()`. */
const FLT_EPSILON = 1.1920928955078125e-7;

export class DRC_TEST_PROVIDER_SLIVER_CHECKER extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'sliver checker';
  }

  private layerDesc(aLayer: PCB_LAYER_ID): string {
    return `(${this.m_drcEngine!.GetBoard()!.GetLayerName(aLayer)})`;
  }

  Run(): boolean {
    if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_COPPER_SLIVER)) return true; // Continue with other tests

    if (!this.reportPhase('Running sliver detection on copper layers...')) return false; // DRC cancelled

    const widthTolerance = pcbMmToIU(ADVANCED_CFG.GetCfg().m_SliverWidthTolerance);
    const squared_width = widthTolerance * widthTolerance;

    const angleTolerance = ADVANCED_CFG.GetCfg().m_SliverAngleTolerance;
    const cosangleTol = 2.0 * Math.cos(DEG2RAD(angleTolerance));
    const copperLayers = LSET.AllCuMask(this.m_drcEngine!.GetBoard()!.GetCopperLayerCount()).Seq();
    const layerCount = copperLayers.length;

    // Report progress on board zones only.  Everything else is in the noise.
    let zoneLayerCount = 0;
    let done = 1;

    for (const layer of copperLayers) {
      for (const zone of this.m_drcEngine!.GetBoard()!.Zones()) {
        if (!zone.GetIsRuleArea() && zone.IsOnLayer(layer)) zoneLayerCount++;
      }
    }

    const reporter = this.m_drcEngine!.GetProgressReporter();

    if (reporter?.IsCancelled()) return false; // DRC cancelled

    const layerPolys: SHAPE_POLY_SET[] = [];

    for (let ii = 0; ii < layerCount; ++ii) layerPolys.push(new SHAPE_POLY_SET());

    const build_layer_polys = (layerIdx: number): number => {
      const layer = copperLayers[layerIdx]!;
      const poly = layerPolys[layerIdx]!;

      if (this.m_drcEngine!.IsCancelled()) return 0;

      let fill = new SHAPE_POLY_SET();

      this.forEachGeometryItem(
        DRC_TEST_PROVIDER.s_allBasicItems,
        new LSET().set(layer),
        (item: BOARD_ITEM): boolean => {
          if (item instanceof ZONE) {
            const zone = item;

            if (!zone.GetIsRuleArea()) {
              const zoneFill = zone.GetFill(layer);

              if (zoneFill) {
                fill = zoneFill.CloneDropTriangulation();
                poly.Append(fill);
              }

              // Report progress on board zones only.  Everything else is
              // in the noise.
              done += 1;
            }
          } else {
            item.TransformShapeToPolygon(poly, layer, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_INSIDE);
          }

          if (this.m_drcEngine!.IsCancelled()) return false;

          return true;
        },
      );

      if (this.m_drcEngine!.IsCancelled()) return 0;

      poly.Simplify();

      return 1;
    };

    // The thread pool's loop runs here one layer at a time, with the
    // progress reported as the wait loop would.
    for (let ii = 0; ii < copperLayers.length; ++ii) {
      build_layer_polys(ii);
      this.reportProgress(zoneLayerCount, done);
    }

    for (let ii = 0; ii < layerCount; ++ii) {
      const layer = copperLayers[ii]!;
      const poly = layerPolys[ii]!;

      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_COPPER_SLIVER)) continue;

      // Frequently, in filled areas, some points of the polygons are very near (dist is only
      // a few internal units, like 2 or 3 units.
      // We skip very small vertices: one cannot really compute a valid orientation of
      // such a vertex
      // So skip points near than min_len (in internal units).
      const min_len = pcbMmToIU(ADVANCED_CFG.GetCfg().m_SliverMinimumLength);

      for (let jj = 0; jj < poly.OutlineCount(); ++jj) {
        const pts = poly.Outline(jj).CPoints();
        const ptCount = pts.length;
        let offset = 0;

        const area = (p: VECTOR2I, q: VECTOR2I, r: VECTOR2I): number => {
          return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
        };

        const isLocallyInside = (aA: number, aB: number): boolean => {
          const prev = (ptCount + aA - 1) % ptCount;
          const next = (aA + 1) % ptCount;

          if (area(pts[prev]!, pts[aA]!, pts[next]!) < 0) {
            return (
              area(pts[aA]!, pts[aB]!, pts[next]!) >= 0 && area(pts[aA]!, pts[prev]!, pts[aB]!) >= 0
            );
          } else {
            return (
              area(pts[aA]!, pts[aB]!, pts[prev]!) < 0 || area(pts[aA]!, pts[next]!, pts[aB]!) < 0
            );
          }
        };

        if (ptCount <= 5) continue;

        for (let kk = 0; kk < ptCount; kk += offset) {
          const prior_index = (ptCount + kk - 1) % ptCount;
          let next_index = (kk + 1) % ptCount;
          let pt = pts[kk]!;
          const ptPrior = pts[prior_index]!;
          let vPrior = sub(ptPrior, pt);
          let forward_offset = 1;

          offset = 1;

          while (Math.abs(vPrior.x) < min_len && Math.abs(vPrior.y) < min_len && offset < ptCount) {
            pt = pts[(kk + offset++) % ptCount]!;
            vPrior = sub(ptPrior, pt);
          }

          if (offset >= ptCount) break;

          let ptAfter = pts[next_index]!;
          let vAfter = sub(ptAfter, pt);

          while (
            Math.abs(vAfter.x) < min_len &&
            Math.abs(vAfter.y) < min_len &&
            forward_offset < ptCount
          ) {
            next_index = (kk + forward_offset++) % ptCount;
            ptAfter = pts[next_index]!;
            vAfter = sub(ptAfter, pt);
          }

          if (offset >= ptCount) break;

          // Negative dot product means that the angle is > 90°
          if (vPrior.x * vAfter.x + vPrior.y * vAfter.y <= 0) continue;

          if (!isLocallyInside(prior_index, next_index)) continue;

          const vIncluded = sub(ptAfter, ptPrior);
          const arm1 = SquaredEuclideanNorm(vPrior);
          const arm2 = SquaredEuclideanNorm(vAfter);
          const opp = SquaredEuclideanNorm(vIncluded);

          const cos_ang = Math.abs((opp - arm1 - arm2) / (Math.sqrt(arm1) * Math.sqrt(arm2)));

          if (cos_ang > cosangleTol && 2.0 - cos_ang > FLT_EPSILON && opp > squared_width) {
            const drce = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_COPPER_SLIVER)!;
            drce.SetErrorDetail(this.layerDesc(layer));
            this.reportViolation(drce, pt, layer);
          }
        }
      }
    }

    return true;
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_SLIVER_CHECKER);
