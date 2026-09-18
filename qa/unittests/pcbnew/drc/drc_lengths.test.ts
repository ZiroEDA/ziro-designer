// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `qa/tests/pcbnew/drc/test_drc_lengths.cpp` and `test_drc_skew.cpp`: the
 * matched-length provider over LENGTH_DELAY_CALCULATION. (Their
 * `KI_TEST::FillZones` is a no-op: none of these boards has a zone.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_IGNORE } from '@ziroeda/common/src/reporter.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { DRC_ITEM } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import { PCB_DRC_CODE } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import { LENGTH_DELAY_CALCULATION } from '@ziroeda/pcbnew/src/length_delay_calculation/length_delay_calculation.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/src/pcb_track.js';
import { HAVE_TEST_DATA, LoadBoard } from './drc_test_utils.js';

const suite = HAVE_TEST_DATA ? describe : describe.skip;

suite('DRC lengths (KiCad qa/tests/pcbnew/drc/test_drc_lengths.cpp, test_drc_skew.cpp)', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('DRCLengths', { timeout: 120_000 }, () => {
    const tests: [string, number][] = [
      ['length_calculations', 0],
      ['time_calculations', 1], // Expect one skew DRC error from NET_P
      ['issue22536', 0], // Via electrical span calculation (GitLab #22536)
      ['via_off_center', 0], // Off-center VIA endpoints should not affect length calculation
    ];

    const failures: string[] = [];

    for (const [name, expected] of tests) {
      const board = LoadBoard(name);
      const violations: DRC_ITEM[] = [];
      const bds = board.GetDesignSettings();

      // Disable DRC tests not useful or not handled in this testcase
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_INVALID_OUTLINE, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_STARVED_THERMAL, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_VIA_DIAMETER, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DANGLING_VIA, RPT_SEVERITY_IGNORE);

      // Ensure that our desired error is fired
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LENGTH_OUT_OF_RANGE, RPT_SEVERITY_ERROR);

      bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
        if (bds.GetSeverity(aItem.GetErrorCode()) === RPT_SEVERITY_ERROR) violations.push(aItem);
      });

      bds.m_DRCEngine!.RunTests('mm', true, false);

      if (violations.length !== expected) {
        const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'in');
        const itemMap = board.FillItemMap();
        const report = violations
          .map((item) => item.ShowReport(unitsProvider, RPT_SEVERITY_ERROR, itemMap))
          .join('');

        failures.push(
          `DRC lengths: ${name}\n${violations.length} violations found (expected ${expected})\n${report}`,
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  // Test that via electrical span is calculated from trace connections, not physical via span.
  // GitLab issue #22536: TH vias near TH connector pads should use the electrical span
  // (layers where traces connect) rather than spanning to layers where TH pads exist.
  it('ViaElectricalSpan', { timeout: 60_000 }, () => {
    const board = LoadBoard('issue22536');
    const lengthCalc = new LENGTH_DELAY_CALCULATION(board);

    // Find vias on Net 3 (Net-(J1-Pin_3)) which has:
    // - TH vias with physical span F.Cu to B.Cu
    // - Traces on F.Cu and In1.Cu only
    // The electrical span should be F.Cu to In1.Cu, not F.Cu to B.Cu
    const net3 = board.FindNet('Net-(J1-Pin_3)');
    expect(net3).not.toBeNull();

    let viaCount = 0;

    for (const track of board.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      if (track.GetNetCode() !== net3!.GetNetCode()) continue;

      const via = track as PCB_VIA;

      // Verify the via is physically a TH via spanning F.Cu to B.Cu
      expect(via.TopLayer()).toBe(PCB_LAYER_ID.F_Cu);
      expect(via.BottomLayer()).toBe(PCB_LAYER_ID.B_Cu);

      // Calculate the electrical span using CalculateViaLayers
      const item = lengthCalc.GetLengthCalculationItem(via);
      const [startLayer, endLayer] = item.GetLayers();

      // The electrical span should be F.Cu to In1.Cu (where traces connect),
      // not F.Cu to B.Cu (the physical via span)
      expect(startLayer).toBe(PCB_LAYER_ID.F_Cu);
      expect(endLayer).toBe(PCB_LAYER_ID.In1_Cu);
      viaCount++;
    }

    expect(viaCount).toBe(2); // Net 3 has 2 vias
  });

  it('DRCSkew', { timeout: 120_000 }, () => {
    const tests: [string, number][] = [
      ['skew_within_diff_pairs_drc', 2],
      ['skew_group_matched_drc', 5],
    ];

    const failures: string[] = [];

    for (const [name, expected] of tests) {
      const board = LoadBoard(name);
      const violations: DRC_ITEM[] = [];
      const bds = board.GetDesignSettings();

      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_INVALID_OUTLINE, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_STARVED_THERMAL, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_VIA_DIAMETER, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_IGNORE);

      // Ensure that our desired error is fired
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_SKEW_OUT_OF_RANGE, RPT_SEVERITY_ERROR);

      bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
        if (bds.GetSeverity(aItem.GetErrorCode()) === RPT_SEVERITY_ERROR) violations.push(aItem);
      });

      bds.m_DRCEngine!.RunTests('mm', true, false);

      if (violations.length !== expected) {
        const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'in');
        const itemMap = board.FillItemMap();
        const report = violations
          .map((item) => item.ShowReport(unitsProvider, RPT_SEVERITY_ERROR, itemMap))
          .join('');

        failures.push(
          `DRC skew: ${name}\n${violations.length} violations found (expected ${expected})\n${report}`,
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
