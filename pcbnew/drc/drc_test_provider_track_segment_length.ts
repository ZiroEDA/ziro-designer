// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_track_segment_length.cpp`.
 *
 * Track segment length test: every segment and arc against the
 * track_segment_length rules.
 * Errors generated:
 * - DRCE_TRACK_SEGMENT_LENGTH
 */
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_ARC, PCB_TRACK } from '../pcb_track.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_TRACK_SEGMENT_LENGTH extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'segment_length';
  }

  Run(): boolean {
    if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TRACK_SEGMENT_LENGTH)) {
      this.REPORT_AUX('Track segment length violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    if (
      !this.m_drcEngine!.HasRulesForConstraintType(DRC_CONSTRAINT_T.TRACK_SEGMENT_LENGTH_CONSTRAINT)
    ) {
      this.REPORT_AUX('No track segment length constraints found. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.reportPhase('Checking track segment lengths...')) return false; // DRC cancelled

    const checkTrackSegmentLength = (idx: number): boolean => {
      const item: BOARD_ITEM = this.m_drcEngine!.GetBoard()!.Tracks()[idx]!;

      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_TRACK_SEGMENT_LENGTH))
        return false;

      let actual: number;
      let p0: VECTOR2I;

      if (item.Type() === KICAD_T.PCB_ARC_T) {
        const arc = item as PCB_ARC;

        actual = arc.GetLength();
        p0 = arc.GetStart();
      } else if (item.Type() === KICAD_T.PCB_TRACE_T) {
        const track = item as PCB_TRACK;

        actual = track.GetLength();
        p0 = {
          x: Math.trunc((track.GetStart().x + track.GetEnd().x) / 2),
          y: Math.trunc((track.GetStart().y + track.GetEnd().y) / 2),
        };
      } else {
        return true;
      }

      const constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.TRACK_SEGMENT_LENGTH_CONSTRAINT,
        item,
        null,
        item.GetLayer(),
      );
      let fail_min = false;
      let fail_max = false;
      let constraintLength = 0;

      if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE) {
        if (constraint.Value().HasMin() && actual < constraint.Value().Min()) {
          fail_min = true;
          constraintLength = constraint.Value().Min();
        }

        if (constraint.Value().HasMax() && actual > constraint.Value().Max()) {
          fail_max = true;
          constraintLength = constraint.Value().Max();
        }
      }

      if (fail_min || fail_max) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_TRACK_SEGMENT_LENGTH)!;
        let constraintName = constraint.GetName();

        if (fail_min) {
          if (constraint.m_ImplicitMin) constraintName = 'board setup constraints';

          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s min length %s; actual %s)',
              constraintName,
              constraintLength,
              actual,
            ),
          );
        } else {
          drcItem.SetErrorDetail(
            this.formatMsg(
              '(%s max length %s; actual %s)',
              constraintName,
              constraintLength,
              actual,
            ),
          );
        }

        drcItem.SetItems(item);
        drcItem.SetViolatingRule(constraint.GetParentRule());

        this.reportViolation(drcItem, p0, item.GetLayer());
      }

      return true;
    };

    const progressDelta = 250;
    let ii = 0;

    // `tp.submit_loop( 0, Tracks().size(), checkTrackSegmentLength )`: the pool's loop, in order
    const tracks = this.m_drcEngine!.GetBoard()!.Tracks();

    for (let idx = 0; idx < tracks.length; ++idx) {
      this.reportProgress(ii++, tracks.length, progressDelta);
      checkTrackSegmentLength(idx);
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_TRACK_SEGMENT_LENGTH);
