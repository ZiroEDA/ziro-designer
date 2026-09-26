// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_track_angle.cpp`.
 *
 * Track angle test. Checks the angle between two connected track segments.
 * Errors generated:
 * - DRCE_TRACK_ANGLE
 */
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import {
  ANGLE_0,
  ANGLE_90,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { equal, ResizeD, sub, type Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_TRACK_ANGLE extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'angle';
  }

  Run(): boolean {
    if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TRACK_ANGLE)) {
      this.REPORT_AUX('Track angle violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.m_drcEngine!.HasRulesForConstraintType(DRC_CONSTRAINT_T.TRACK_ANGLE_CONSTRAINT)) {
      this.REPORT_AUX('No track angle constraints found. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.reportPhase('Checking track angles...')) return false; // DRC cancelled

    const checkTrackAngle = (ind: number): boolean => {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TRACK_ANGLE)) {
        return false;
      }

      const item = this.m_drcEngine!.GetBoard()!.Tracks()[ind]!;

      if (item.Type() !== KICAD_T.PCB_TRACE_T) {
        return true;
      }

      const segment = new SEG(item.GetStart(), item.GetEnd());

      const connectivity = this.m_drcEngine!.GetBoard()!.GetConnectivity();

      for (const other of connectivity.GetConnectedTracks(item)) {
        if (other.Type() !== KICAD_T.PCB_TRACE_T) {
          continue;
        }

        const other_segment = new SEG(other.GetStart(), other.GetEnd());

        const intersection_opt = segment.Intersect(other_segment);

        if (intersection_opt === null || intersection_opt === undefined) {
          continue;
        }

        const p0 = intersection_opt;

        if (this.m_drcEngine!.GetBoard()!.GetPad(p0, new LSET([item.GetLayer()]))) {
          continue;
        }

        const constraint = this.m_drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.TRACK_ANGLE_CONSTRAINT,
          item,
          other,
          item.GetLayer(),
        );

        let direction: Vec2 = ResizeD(sub(item.GetEnd(), item.GetStart()), 1);
        let other_direction: Vec2 = ResizeD(sub(other.GetEnd(), other.GetStart()), 1);
        let actual: EDA_ANGLE;

        let angle_below_90 = false;

        if (equal(segment.B, p0)) {
          direction = { x: -direction.x, y: -direction.y };
        } else if (!equal(segment.A, p0)) {
          angle_below_90 = true;
        }

        if (equal(other_segment.B, p0)) {
          other_direction = { x: -other_direction.x, y: -other_direction.y };
        } else if (!equal(other_segment.A, p0)) {
          angle_below_90 = true;
        }

        actual = EDA_ANGLE.Arccos(
          direction.x * other_direction.x + direction.y * other_direction.y,
        );

        if (angle_below_90 && actual.gt(ANGLE_90)) {
          actual = actual.sub(ANGLE_90);
        }

        let fail_min = false;
        let fail_max = false;
        let constraintAngle = ANGLE_0;

        if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE) {
          if (constraint.Value().HasMin() && actual.AsDegrees() < constraint.Value().Min()) {
            fail_min = true;
            constraintAngle = new EDA_ANGLE(constraint.Value().Min(), EDA_ANGLE_T.DEGREES_T);
          }

          if (constraint.Value().HasMax() && actual.AsDegrees() > constraint.Value().Max()) {
            fail_max = true;
            constraintAngle = new EDA_ANGLE(constraint.Value().Max(), EDA_ANGLE_T.DEGREES_T);
          }
        }

        if (fail_min || fail_max) {
          const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TRACK_ANGLE)!;
          const constraintName = constraint.GetName();

          if (fail_min) {
            drcItem.SetErrorDetail(
              this.formatMsg(
                '(%s min angle %s; actual %s)',
                constraintName,
                constraintAngle,
                actual,
              ),
            );
          } else {
            drcItem.SetErrorDetail(
              this.formatMsg(
                '(%s max angle %s; actual %s)',
                constraintName,
                constraintAngle,
                actual,
              ),
            );
          }

          drcItem.SetItems(item, other);
          drcItem.SetViolatingRule(constraint.GetParentRule());

          this.reportViolation(drcItem, p0, item.GetLayer());
        }
      }

      return true;
    };

    const progressDelta = 250;
    let ii = 0;

    // `tp.submit_loop( 0, Tracks().size(), checkTrackAngle )`: the pool's loop, in order
    const tracks = this.m_drcEngine!.GetBoard()!.Tracks();

    for (let ind = 0; ind < tracks.length; ++ind) {
      this.reportProgress(ii++, tracks.length, progressDelta);
      checkTrackAngle(ind);
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_TRACK_ANGLE);
