// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_hole_to_hole.cpp`.
 *
 * Holes clearance test. Checks pad and via holes for their mechanical clearances.
 * Generated errors:
 * - DRCE_DRILLED_HOLES_TOO_CLOSE
 * - DRCE_DRILLED_HOLES_COLOCATED
 */
import { PCB_LAYER_ID, UNDEFINED_LAYER } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { EuclideanNormI, SquaredEuclideanNorm, sub } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PAD } from '../pad.js';
import type { PCB_VIA } from '../pcb_track.js';
import { VIATYPE } from '../pcb_track_types.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_RTREE } from './drc_rtree.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';
import { ptrPairKey } from './ptr_order.js';

function getHoleShape(aItem: BOARD_ITEM): SHAPE_CIRCLE {
  if (aItem.Type() === KICAD_T.PCB_VIA_T) {
    const via = aItem as PCB_VIA;
    return new SHAPE_CIRCLE(via.GetCenter(), Math.trunc(via.GetDrillValue() / 2));
  } else if (aItem.Type() === KICAD_T.PCB_PAD_T) {
    const pad = aItem as PAD;
    return new SHAPE_CIRCLE(pad.GetPosition(), Math.trunc(pad.GetDrillSize().x / 2));
  }

  return new SHAPE_CIRCLE({ x: 0, y: 0 }, 0);
}

export class DRC_TEST_PROVIDER_HOLE_TO_HOLE extends DRC_TEST_PROVIDER {
  private readonly m_holeTree = new DRC_RTREE();
  private m_largestHoleToHoleClearance = 0;

  override GetName(): string {
    return 'hole_to_hole_clearance';
  }

  Run(): boolean {
    if (
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE) &&
      this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DRILLED_HOLES_COLOCATED)
    ) {
      this.REPORT_AUX('Hole to hole violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    this.m_board = this.m_drcEngine!.GetBoard();

    const worstClearanceConstraint = this.m_drcEngine!.QueryWorstConstraint(
      DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT,
    );

    if (worstClearanceConstraint) {
      this.m_largestHoleToHoleClearance = worstClearanceConstraint.GetValue().Min();
    } else {
      this.REPORT_AUX('No hole to hole constraints found. Skipping check.');
      return true; // continue with other tests
    }

    if (!this.reportPhase('Checking hole to hole clearances...')) return false; // DRC cancelled

    const progressDelta = 200;
    let count = 0;
    let ii = 0;

    this.m_holeTree.clear();

    this.forEachGeometryItem(
      [KICAD_T.PCB_PAD_T, KICAD_T.PCB_VIA_T],
      LSET.AllLayersMask(),
      (): boolean => {
        ++count;
        return true;
      },
    );

    count *= 2; // One for adding to the rtree; one for checking

    this.forEachGeometryItem(
      [KICAD_T.PCB_PAD_T, KICAD_T.PCB_VIA_T],
      LSET.AllLayersMask(),
      (item: BOARD_ITEM): boolean => {
        if (!this.reportProgress(ii++, count, progressDelta)) return false;

        if (item.Type() === KICAD_T.PCB_PAD_T) {
          const pad = item as PAD;

          // Slots are generally milled _after_ drilling, so we ignore them.
          if (pad.GetDrillSize().x && pad.GetDrillSize().x === pad.GetDrillSize().y) {
            this.m_holeTree.Insert(
              item,
              PCB_LAYER_ID.Edge_Cuts,
              undefined,
              this.m_largestHoleToHoleClearance,
            );
          }
        } else if (item.Type() === KICAD_T.PCB_VIA_T) {
          // Blind/buried/microvias will be drilled/burned _prior_ to lamination, so
          // subsequently drilled holes need to avoid them.
          this.m_holeTree.Insert(
            item,
            PCB_LAYER_ID.Edge_Cuts,
            undefined,
            this.m_largestHoleToHoleClearance,
          );
        }

        return true;
      },
    );

    const checkedPairs = new Set<string>();

    for (const track of this.m_board!.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = track as PCB_VIA;

      if (!this.reportProgress(ii++, count, progressDelta)) return false; // DRC cancelled

      // We only care about mechanically drilled (ie: non-laser) holes.  These include both
      // blind/buried via holes (drilled prior to lamination) and through-via and drilled pad
      // holes (which are generally drilled post laminataion).
      if (via.GetViaType() !== VIATYPE.MICROVIA) {
        const holeShape = getHoleShape(via);

        this.m_holeTree.QueryCollidingItem(
          via,
          PCB_LAYER_ID.Edge_Cuts,
          PCB_LAYER_ID.Edge_Cuts,
          // Filter:
          (other: BOARD_ITEM): boolean => {
            // store canonical order so we don't collide in both directions
            // (a:b and b:a)
            const key = ptrPairKey(via, other);

            if (checkedPairs.has(key)) {
              return false;
            } else {
              checkedPairs.add(key);
              return true;
            }
          },
          // Visitor:
          (other: BOARD_ITEM): boolean => {
            return this.testHoleAgainstHole(via, holeShape, other);
          },
          this.m_largestHoleToHoleClearance,
        );
      }
    }

    checkedPairs.clear();

    for (const footprint of this.m_board!.Footprints()) {
      for (const pad of footprint.Pads()) {
        if (!this.reportProgress(ii++, count, progressDelta)) return false; // DRC cancelled

        // We only care about drilled (ie: round) pad holes
        if (pad.HasDrilledHole()) {
          const holeShape = getHoleShape(pad);

          this.m_holeTree.QueryCollidingItem(
            pad,
            PCB_LAYER_ID.Edge_Cuts,
            PCB_LAYER_ID.Edge_Cuts,
            // Filter:
            (other: BOARD_ITEM): boolean => {
              // store canonical order so we don't collide in both directions
              // (a:b and b:a)
              const key = ptrPairKey(pad, other);

              if (checkedPairs.has(key)) {
                return false;
              } else {
                checkedPairs.add(key);
                return true;
              }
            },
            // Visitor:
            (other: BOARD_ITEM): boolean => {
              return this.testHoleAgainstHole(pad, holeShape, other);
            },
            this.m_largestHoleToHoleClearance,
          );
        }
      }

      if (this.m_drcEngine!.IsCancelled()) return false;
    }

    return !this.m_drcEngine!.IsCancelled();
  }

  private testHoleAgainstHole(aItem: BOARD_ITEM, aHole: SHAPE_CIRCLE, aOther: BOARD_ITEM): boolean {
    const reportCoLocation = !this.m_drcEngine!.IsErrorLimitExceeded(
      PCB_DRC_CODE.DRCE_DRILLED_HOLES_COLOCATED,
    );
    const reportHole2Hole = !this.m_drcEngine!.IsErrorLimitExceeded(
      PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE,
    );

    if (!reportCoLocation && !reportHole2Hole) return false;

    const otherHole = getHoleShape(aOther);
    const epsilon = this.m_board!.GetDesignSettings().GetDRCEpsilon();
    const epsilon_sq = SEG.Square(epsilon);

    // Blind-buried vias are drilled prior to stackup; they're only an issue if they share layers
    if (aItem.Type() === KICAD_T.PCB_VIA_T && aOther.Type() === KICAD_T.PCB_VIA_T) {
      const viaHoleLayers = (aItem as PCB_VIA).GetLayerSet().and(LSET.AllCuMask());

      if (viaHoleLayers.and((aOther as PCB_VIA).GetLayerSet()).none()) return false;
    }

    // Holes at same location generate a separate violation
    if (SquaredEuclideanNorm(sub(aHole.GetCenter(), otherHole.GetCenter())) < epsilon_sq) {
      if (reportCoLocation) {
        // Generate violations based on a well-defined order so that exclusion checking
        // against previously-generated violations will work.
        if (aItem.m_Uuid > aOther.m_Uuid) [aItem, aOther] = [aOther, aItem];

        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_DRILLED_HOLES_COLOCATED)!;
        drcItem.SetItems(aItem, aOther);
        this.reportTwoPointGeometry(
          drcItem,
          aHole.GetCenter(),
          aHole.GetCenter(),
          aHole.GetCenter(),
          UNDEFINED_LAYER,
        );
      }
    } else if (reportHole2Hole) {
      let actual = EuclideanNormI(sub(aHole.GetCenter(), otherHole.GetCenter()));
      actual = Math.max(0, actual - aHole.GetRadius() - otherHole.GetRadius());

      const constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT,
        aItem,
        aOther,
        UNDEFINED_LAYER /* holes pierce all layers */,
      );
      const minClearance = Math.max(0, constraint.GetValue().Min() - epsilon);

      if (
        constraint.GetSeverity() !== RPT_SEVERITY_IGNORE &&
        minClearance >= 0 &&
        actual < minClearance
      ) {
        // Generate violations based on a well-defined order so that exclusion checking
        // against previously-generated violations will work.
        if (aItem.m_Uuid > aOther.m_Uuid) [aItem, aOther] = [aOther, aItem];

        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE)!;
        drcItem.SetErrorDetail(
          this.formatMsg('(%s min %s; actual %s)', constraint.GetName(), minClearance, actual),
        );
        drcItem.SetItems(aItem, aOther);
        drcItem.SetViolatingRule(constraint.GetParentRule());
        this.reportTwoShapeGeometry(
          drcItem,
          aHole.GetCenter(),
          aHole,
          otherHole,
          UNDEFINED_LAYER,
          actual,
        );
      }
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_HOLE_TO_HOLE);
