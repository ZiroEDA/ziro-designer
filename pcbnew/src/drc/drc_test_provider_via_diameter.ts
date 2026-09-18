// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_via_diameter.cpp`.
 *
 * Via diameter test.
 * Errors generated:
 * - DRCE_VIA_DIAMETER
 */
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/src/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PADSTACK } from '../padstack.js';
import type { PCB_VIA } from '../pcb_track.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_VIA_DIAMETER extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'diameter';
  }

  Run(): boolean {
    if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_VIA_DIAMETER)) {
      this.REPORT_AUX('Via diameter violations ignored. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.m_drcEngine!.HasRulesForConstraintType(DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT)) {
      this.REPORT_AUX('No via diameter constraints found. Tests not run.');
      return true; // continue with other tests
    }

    if (!this.reportPhase('Checking via diameters...')) return false; // DRC cancelled

    const checkViaDiameter = (item: BOARD_ITEM): boolean => {
      if (this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_VIA_DIAMETER)) return false;

      if (item.Type() !== KICAD_T.PCB_VIA_T) return true;

      const via = item as PCB_VIA;

      // TODO: once we have padstacks this will need to run per-layer...
      const constraint = this.m_drcEngine!.EvalRules(
        DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
      );
      let fail_min = false;
      let fail_max = false;
      let constraintDiameter = 0;

      // TODO(JE) padstacks
      const actual = via.GetWidth(PADSTACK.ALL_LAYERS);

      if (constraint.GetSeverity() !== RPT_SEVERITY_IGNORE) {
        if (constraint.Value().HasMin() && actual < constraint.Value().Min()) {
          fail_min = true;
          constraintDiameter = constraint.Value().Min();
        }

        if (constraint.Value().HasMax() && actual > constraint.Value().Max()) {
          fail_max = true;
          constraintDiameter = constraint.Value().Max();
        }
      }

      if (fail_min || fail_max) {
        const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_VIA_DIAMETER)!;
        let constraintName = constraint.GetName();
        let msg = '';

        if (fail_min) {
          if (constraint.m_ImplicitMin) constraintName = 'board setup constraints';

          msg = this.formatMsg(
            '(%s min diameter %s; actual %s)',
            constraintName,
            constraintDiameter,
            actual,
          );
        } else if (fail_max) {
          msg = this.formatMsg(
            '(%s max diameter %s; actual %s)',
            constraintName,
            constraintDiameter,
            actual,
          );
        }

        drcItem.SetErrorDetail(msg);
        drcItem.SetItems(item);
        drcItem.SetViolatingRule(constraint.GetParentRule());

        this.reportViolation(drcItem, via.GetPosition(), via.GetLayer());
      }

      return true;
    };

    const progressDelta = 500;
    let ii = 0;

    for (const item of this.m_drcEngine!.GetBoard()!.Tracks()) {
      if (!this.reportProgress(ii++, this.m_drcEngine!.GetBoard()!.Tracks().length, progressDelta))
        break;

      if (!checkViaDiameter(item)) break;
    }

    return !this.m_drcEngine!.IsCancelled();
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_VIA_DIAMETER);
