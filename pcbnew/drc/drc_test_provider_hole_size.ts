// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_test_provider_hole_size.cpp`.
 *
 * Drilled hole size test. scans vias/through-hole pads and checks for min drill sizes
 * Errors generated:
 * - DRCE_DRILL_OUT_OF_RANGE
 * - DRCE_MICROVIA_DRILL_OUT_OF_RANGE
 * - DRCE_PADSTACK
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ResizeI, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { PAD } from '../pad.js';
import { type PCB_VIA, VIATYPE } from '../pcb_track.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import { DRC_CONSTRAINT_T } from './drc_rule.js';
import { DRC_REGISTER_TEST_PROVIDER, DRC_TEST_PROVIDER } from './drc_test_provider.js';

export class DRC_TEST_PROVIDER_HOLE_SIZE extends DRC_TEST_PROVIDER {
  override GetName(): string {
    return 'hole_size';
  }

  Run(): boolean {
    if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE)) {
      if (!this.reportPhase('Checking pad holes...')) return false; // DRC cancelled

      for (const footprint of this.m_drcEngine!.GetBoard()!.Footprints()) {
        for (const pad of footprint.Pads()) {
          if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE))
            this.checkPadHole(pad);
        }
      }
    }

    if (
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_MICROVIA_DRILL_OUT_OF_RANGE) ||
      !this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE)
    ) {
      if (!this.m_drcEngine!.IsErrorLimitExceeded(PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE)) {
        if (!this.reportPhase('Checking via holes...')) return false; // DRC cancelled
      } else {
        if (!this.reportPhase('Checking micro-via holes...')) return false; // DRC cancelled
      }

      for (const track of this.m_drcEngine!.GetBoard()!.Tracks()) {
        if (track.Type() === KICAD_T.PCB_VIA_T) {
          const exceedMicro = this.m_drcEngine!.IsErrorLimitExceeded(
            PCB_DRC_CODE.DRCE_MICROVIA_DRILL_OUT_OF_RANGE,
          );
          const exceedStd = this.m_drcEngine!.IsErrorLimitExceeded(
            PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE,
          );

          if (exceedMicro && exceedStd) break;

          this.checkViaHole(track as PCB_VIA, exceedMicro, exceedStd);
        }
      }
    }

    return !this.m_drcEngine!.IsCancelled();
  }

  private checkPadHole(aPad: PAD): void {
    const holeMinor = Math.min(aPad.GetDrillSize().x, aPad.GetDrillSize().y);
    const holeMajor = Math.max(aPad.GetDrillSize().x, aPad.GetDrillSize().y);

    if (holeMinor === 0) return;

    const constraint = this.m_drcEngine!.EvalRules(
      DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT,
      aPad,
      null,
      PCB_LAYER_ID.UNDEFINED_LAYER /* holes are not layer-specific */,
    );
    let fail_min = false;
    let fail_max = false;
    let constraintValue = 0;
    let ptA: VECTOR2I = { x: 0, y: 0 };
    let ptB: VECTOR2I = { x: 0, y: 0 };

    if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE) return;

    if (constraint.Value().HasMax() && holeMajor > constraint.Value().Max()) {
      fail_max = true;
      constraintValue = constraint.Value().Max();

      ptA = aPad.GetPosition();

      if (aPad.GetDrillSizeX() === aPad.GetDrillSizeY())
        ptB = sub(ptA, ResizeI(aPad.GetDrillSize(), Math.trunc(aPad.GetDrillSizeX() / 2)));
      else if (aPad.GetDrillSizeX() > aPad.GetDrillSizeY())
        ptB = sub(ptA, { x: Math.trunc(aPad.GetDrillSizeX() / 2), y: 0 });
      else ptB = sub(ptA, { x: 0, y: Math.trunc(aPad.GetDrillSizeY() / 2) });
    }

    if (constraint.Value().HasMin() && holeMinor < constraint.Value().Min()) {
      fail_min = true;
      constraintValue = constraint.Value().Min();

      ptA = aPad.GetPosition();

      if (aPad.GetDrillSizeX() === aPad.GetDrillSizeY())
        ptB = sub(ptA, ResizeI(aPad.GetDrillSize(), Math.trunc(aPad.GetDrillSizeX() / 2)));
      else if (aPad.GetDrillSizeX() < aPad.GetDrillSizeY())
        ptB = sub(ptA, { x: Math.trunc(aPad.GetDrillSizeX() / 2), y: 0 });
      else ptB = sub(ptA, { x: 0, y: Math.trunc(aPad.GetDrillSizeY() / 2) });
    }

    if (fail_min || fail_max) {
      const drcItem = DRC_ITEM.Create(PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE)!;
      let constraintName = constraint.GetName();

      if (fail_min) {
        if (constraint.GetParentRule() && constraint.GetParentRule()!.IsImplicit())
          constraintName = 'board setup constraints';

        drcItem.SetErrorDetail(
          this.formatMsg('(%s min hole %s; actual %s)', constraintName, constraintValue, holeMinor),
        );
      } else {
        drcItem.SetErrorDetail(
          this.formatMsg('(%s max hole %s; actual %s)', constraintName, constraintValue, holeMajor),
        );
      }

      drcItem.SetItems(aPad);
      drcItem.SetViolatingRule(constraint.GetParentRule());

      this.reportTwoPointGeometry(drcItem, ptA, ptA, ptB, PCB_LAYER_ID.UNDEFINED_LAYER);
    }
  }

  private checkViaHole(via: PCB_VIA, aExceedMicro: boolean, aExceedStd: boolean): void {
    let errorCode: number;

    if (via.GetViaType() === VIATYPE.MICROVIA) {
      if (aExceedMicro) return;

      errorCode = PCB_DRC_CODE.DRCE_MICROVIA_DRILL_OUT_OF_RANGE;
    } else {
      if (aExceedStd) return;

      errorCode = PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE;
    }

    const constraint = this.m_drcEngine!.EvalRules(
      DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT,
      via,
      null,
      PCB_LAYER_ID.UNDEFINED_LAYER /* holes are not layer-specific */,
    );
    let fail_min = false;
    let fail_max = false;
    let constraintValue = 0;
    const drill = via.GetDrillValue();

    if (constraint.GetSeverity() === RPT_SEVERITY_IGNORE) return;

    if (constraint.Value().HasMin() && drill < constraint.Value().Min()) {
      fail_min = true;
      constraintValue = constraint.Value().Min();
    }

    if (constraint.Value().HasMax() && drill > constraint.Value().Max()) {
      fail_max = true;
      constraintValue = constraint.Value().Max();
    }

    if (fail_min || fail_max) {
      const drcItem = DRC_ITEM.Create(errorCode)!;
      let constraintName = constraint.GetName();

      if (fail_min) {
        if (constraint.m_ImplicitMin) constraintName = 'board setup constraints';

        drcItem.SetErrorDetail(
          this.formatMsg('(%s min hole %s; actual %s)', constraintName, constraintValue, drill),
        );
      } else {
        drcItem.SetErrorDetail(
          this.formatMsg('(%s max hole %s; actual %s)', constraintName, constraintValue, drill),
        );
      }

      drcItem.SetItems(via);
      drcItem.SetViolatingRule(constraint.GetParentRule());

      const ptA = via.GetPosition();
      const ptB = sub(ptA, ResizeI({ x: drill, y: drill }, Math.trunc(drill / 2)));

      this.reportTwoPointGeometry(drcItem, ptA, ptA, ptB, PCB_LAYER_ID.UNDEFINED_LAYER);
    }
  }
}

DRC_REGISTER_TEST_PROVIDER(DRC_TEST_PROVIDER_HOLE_SIZE);
