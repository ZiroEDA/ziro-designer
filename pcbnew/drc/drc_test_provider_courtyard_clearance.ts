// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_courtyard_clearance.cpp`.
 *
 * Couartyard clearance. Tests for malformed component courtyards and overlapping footprints.
 * Generated errors:
 * - DRCE_OVERLAPPING_FOOTPRINTS
 * - DRCE_MISSING_COURTYARD
 * - DRCE_MALFORMED_COURTYARD
 * - DRCE_PTH_IN_COURTYARD,
 * - DRCE_NPTH_IN_COURTYARD,
 */
import { MALFORMED_COURTYARDS } from '@ziroeda/common/eda_item_flags.js';
import { PCB_LAYER_ID, UNDEFINED_LAYER } from '@ziroeda/common/layer_id.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { OUTLINE_ERROR_HANDLER } from '../convert_shape_list_to_polygon.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_PROP } from '../padstack.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { type DRC_CONSTRAINT, DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_COURTYARD_CLEARANCE extends DRC_TEST_PROVIDER {
  private m_largestCourtyardClearance = 0;

  constructor() {
    super();
    this.m_isRuleDriven = false;
  }

  override GetName(): string {
    return 'courtyard_clearance';
  }

  private testFootprintCourtyardDefinitions(): boolean {
    // Detects missing (or malformed) footprint courtyards
    if (
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MALFORMED_COURTYARD) ||
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MISSING_COURTYARD)
    ) {
      if (!this.reportPhase('Checking footprint courtyard definitions...')) return false; // DRC cancelled
    } else if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_OVERLAPPING_FOOTPRINTS)) {
      if (!this.reportPhase('Gathering footprint courtyards...')) return false; // DRC cancelled
    } else {
      this.REPORT_AUX('All courtyard violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    const progressDelta = 500;
    let ii = 0;

    for (const footprint of this.m_board!.Footprints()) {
      if (!this.reportProgress(ii++, this.m_board!.Footprints().length, progressDelta))
        return false; // DRC cancelled

      if ((footprint.GetFlags() & MALFORMED_COURTYARDS) !== 0) {
        if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MALFORMED_COURTYARD)) continue;

        const errorHandler: OUTLINE_ERROR_HANDLER = (
          msg: string,
          _a: BOARD_ITEM | null,
          _b: BOARD_ITEM | null,
          pt: VECTOR2I,
        ): void => {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_MALFORMED_COURTYARD)!;
          drcItem.SetErrorDetail(msg);
          drcItem.SetItems(footprint);
          this.reportViolation(drcItem, pt, UNDEFINED_LAYER);
        };

        // Re-run courtyard tests to generate DRC_ITEMs
        footprint.BuildCourtyardCaches(errorHandler);
      } else if (
        footprint.GetCourtyard(PCB_LAYER_ID.F_CrtYd).OutlineCount() === 0 &&
        footprint.GetCourtyard(PCB_LAYER_ID.B_CrtYd).OutlineCount() === 0
      ) {
        if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MISSING_COURTYARD)) continue;

        if (footprint.AllowMissingCourtyard()) continue;

        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_MISSING_COURTYARD)!;
        drcItem.SetItems(footprint);
        this.reportViolation(drcItem, footprint.GetPosition(), UNDEFINED_LAYER);
      } else {
        footprint.GetCourtyard(PCB_LAYER_ID.F_CrtYd).BuildBBoxCaches();
        footprint.GetCourtyard(PCB_LAYER_ID.B_CrtYd).BuildBBoxCaches();
      }
    }

    return !this.m_drcEngine!.IsCancelled();
  }

  private testCourtyardClearances(): boolean {
    if (!this.reportPhase('Checking footprints for overlapping courtyards...')) return false; // DRC cancelled

    const progressDelta = 100;
    let ii = 0;

    // Stable sorting gives stable violation generation (and stable comparisons to previously-
    // generated violations for exclusion checking).
    const footprints: FOOTPRINT[] = [...this.m_board!.Footprints()];

    footprints.sort((a: FOOTPRINT, b: FOOTPRINT): number =>
      a.m_Uuid < b.m_Uuid ? -1 : a.m_Uuid > b.m_Uuid ? 1 : 0,
    );

    for (let itA = 0; itA < footprints.length; itA++) {
      if (!this.reportProgress(ii++, footprints.length, progressDelta)) return false; // DRC cancelled

      // Ensure tests realted to courtyard constraints are not fully disabled:
      if (
        this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_OVERLAPPING_FOOTPRINTS) &&
        this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_PTH_IN_COURTYARD) &&
        this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_NPTH_IN_COURTYARD)
      ) {
        return true; // continue with other tests
      }

      const fpA = footprints[itA]!;
      const frontA = fpA.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
      const backA = fpA.GetCourtyard(PCB_LAYER_ID.B_CrtYd);

      if (
        frontA.OutlineCount() === 0 &&
        backA.OutlineCount() === 0 &&
        this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_PTH_IN_COURTYARD) &&
        this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_NPTH_IN_COURTYARD)
      ) {
        // No courtyards defined and no hole testing against other footprint's courtyards
        continue;
      }

      const frontA_worstCaseBBox = frontA.BBoxFromCaches();
      const backA_worstCaseBBox = backA.BBoxFromCaches();

      frontA_worstCaseBBox.Inflate(this.m_largestCourtyardClearance);
      backA_worstCaseBBox.Inflate(this.m_largestCourtyardClearance);

      const fpA_bbox = fpA.GetBoundingBox();

      for (let itB = itA + 1; itB < footprints.length; itB++) {
        const fpB = footprints[itB]!;
        const frontB = fpB.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
        const backB = fpB.GetCourtyard(PCB_LAYER_ID.B_CrtYd);

        if (
          frontB.OutlineCount() === 0 &&
          backB.OutlineCount() === 0 &&
          this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_PTH_IN_COURTYARD) &&
          this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_NPTH_IN_COURTYARD)
        ) {
          // No courtyards defined and no hole testing against other footprint's courtyards
          continue;
        }

        const frontB_worstCaseBBox = frontB.BBoxFromCaches();
        const backB_worstCaseBBox = backB.BBoxFromCaches();

        frontB_worstCaseBBox.Inflate(this.m_largestCourtyardClearance);
        backB_worstCaseBBox.Inflate(this.m_largestCourtyardClearance);

        const fpB_bbox = fpB.GetBoundingBox();
        let constraint: DRC_CONSTRAINT;
        let clearance: number;
        const actual = { value: 0 };
        const pos: VECTOR2I = { x: 0, y: 0 };

        // Check courtyard-to-courtyard collisions on front of board,
        // if DRCE_OVERLAPPING_FOOTPRINTS is not diasbled
        if (
          frontA.OutlineCount() > 0 &&
          frontB.OutlineCount() > 0 &&
          frontA_worstCaseBBox.Intersects(frontB.BBoxFromCaches()) &&
          !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_OVERLAPPING_FOOTPRINTS)
        ) {
          constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
            fpA,
            fpB,
            PCB_LAYER_ID.F_Cu,
          );
          clearance = constraint.GetValue().Min();

          if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance >= 0) {
            if (frontA.Collide(frontB, clearance, actual, pos)) {
              const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_OVERLAPPING_FOOTPRINTS)!;

              if (clearance > 0) {
                drcItem.SetErrorDetail(
                  this.formatMsg(
                    '(%s clearance %s; actual %s)',
                    constraint.GetName(),
                    clearance,
                    actual.value,
                  ),
                );
              }

              drcItem.SetViolatingRule(constraint.GetParentRule());
              drcItem.SetItems(fpA, fpB);
              this.reportTwoShapeGeometry(
                drcItem,
                pos,
                frontA,
                frontB,
                PCB_LAYER_ID.F_CrtYd,
                actual.value,
              );
            }
          }
        }

        // Check courtyard-to-courtyard collisions on back of board,
        // if DRCE_OVERLAPPING_FOOTPRINTS is not disabled
        if (
          backA.OutlineCount() > 0 &&
          backB.OutlineCount() > 0 &&
          backA_worstCaseBBox.Intersects(backB.BBoxFromCaches()) &&
          !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_OVERLAPPING_FOOTPRINTS)
        ) {
          constraint = this.m_drcEngine!.EvalRules(
            DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
            fpA,
            fpB,
            PCB_LAYER_ID.B_Cu,
          );
          clearance = constraint.GetValue().Min();

          if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance >= 0) {
            if (backA.Collide(backB, clearance, actual, pos)) {
              const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_OVERLAPPING_FOOTPRINTS)!;

              if (clearance > 0) {
                drcItem.SetErrorDetail(
                  this.formatMsg(
                    '(%s clearance %s; actual %s)',
                    constraint.GetName(),
                    clearance,
                    actual.value,
                  ),
                );
              }

              drcItem.SetViolatingRule(constraint.GetParentRule());
              drcItem.SetItems(fpA, fpB);
              this.reportTwoShapeGeometry(
                drcItem,
                pos,
                backA,
                backB,
                PCB_LAYER_ID.B_CrtYd,
                actual.value,
              );
            }
          }
        }

        //
        // Check pad-hole-to-courtyard collisions on front and back of board.
        //
        // NB: via holes are not checked.  There is a presumption that a physical object goes
        // through a pad hole, which is not the case for via holes.
        //
        let checkFront = false;
        let checkBack = false;

        constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
          fpA,
          fpB,
          PCB_LAYER_ID.F_Cu,
        );
        clearance = constraint.GetValue().Min();

        if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance >= 0) checkFront = true;

        constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
          fpB,
          fpA,
          PCB_LAYER_ID.F_Cu,
        );
        clearance = constraint.GetValue().Min();

        if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance >= 0) checkFront = true;

        constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
          fpA,
          fpB,
          PCB_LAYER_ID.B_Cu,
        );
        clearance = constraint.GetValue().Min();

        if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance >= 0) checkBack = true;

        constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
          fpB,
          fpA,
          PCB_LAYER_ID.B_Cu,
        );
        clearance = constraint.GetValue().Min();

        if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE && clearance >= 0) checkBack = true;

        const testPadAgainstCourtyards = (pad: PAD, fp: FOOTPRINT): void => {
          let errorCode = 0;

          if (pad.GetProperty() === PAD_PROP.HEATSINK) return;
          else if (pad.GetAttribute() === PAD_ATTRIB.PTH)
            errorCode = PCB_DRC_CODE.DRCE_PTH_IN_COURTYARD;
          else if (pad.GetAttribute() === PAD_ATTRIB.NPTH)
            errorCode = PCB_DRC_CODE.DRCE_NPTH_IN_COURTYARD;
          else return;

          if (this.m_drcEngine!.IsErrorLimitExceeded(errorCode)) return;

          if (pad.HasHole()) {
            const hole = pad.GetEffectiveHoleShape()!;
            const front = fp.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
            const back = fp.GetCourtyard(PCB_LAYER_ID.B_CrtYd);

            if (checkFront && front.OutlineCount() > 0 && front.Collide(hole, 0)) {
              const drce = DRC_ITEM.Create(errorCode)!;
              drce.SetItems(pad, fp);
              this.reportViolation(drce, pad.GetPosition(), PCB_LAYER_ID.F_CrtYd);
            } else if (checkBack && back.OutlineCount() > 0 && back.Collide(hole, 0)) {
              const drce = DRC_ITEM.Create(errorCode)!;
              drce.SetItems(pad, fp);
              this.reportViolation(drce, pad.GetPosition(), PCB_LAYER_ID.B_CrtYd);
            }
          }
        };

        if (
          (frontA.OutlineCount() > 0 && frontA_worstCaseBBox.Intersects(fpB_bbox)) ||
          (backA.OutlineCount() > 0 && backA_worstCaseBBox.Intersects(fpB_bbox))
        ) {
          for (const padB of fpB.Pads()) testPadAgainstCourtyards(padB, fpA);
        }

        if (
          (frontB.OutlineCount() > 0 && frontB.BBoxFromCaches().Intersects(fpA_bbox)) ||
          (backB.OutlineCount() > 0 && backB.BBoxFromCaches().Intersects(fpA_bbox))
        ) {
          for (const padA of fpA.Pads()) testPadAgainstCourtyards(padA, fpB);
        }

        if (this.m_drcEngine!.IsCancelled()) return false;
      }
    }

    return !this.m_drcEngine!.IsCancelled();
  }

  Run(): boolean {
    this.m_board = this.m_drcEngine!.GetBoard();

    const constraint = this.m_drcEngine!.QueryWorstConstraint(
      DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
    );

    if (constraint) this.m_largestCourtyardClearance = constraint.GetValue().Min();

    if (!this.testFootprintCourtyardDefinitions()) return false;

    if (!this.testCourtyardClearances()) return false;

    return true;
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_COURTYARD_CLEARANCE);
