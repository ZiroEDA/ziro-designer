// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `qa/tests/pcbnew/drc/test_drc_regressions.cpp`: KiCad's own DRC regression
 * boards, with KiCad's own expected counts, run through the ported engine and
 * providers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  type Severity,
} from '@ziroeda/common/reporter.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import type { DRC_ITEM } from '@ziroeda/pcbnew/drc/drc_item.js';
import { PCB_DRC_CODE } from '@ziroeda/pcbnew/drc/drc_item.js';
import { PCB_MARKER } from '@ziroeda/pcbnew/pcb_marker.js';
import { HAVE_TEST_DATA, LoadBoard } from './drc_test_utils.js';

const suite = HAVE_TEST_DATA ? describe : describe.skip;

suite('DRC regressions (KiCad qa/tests/pcbnew/drc/test_drc_regressions.cpp)', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('DRCFalsePositiveRegressions', { timeout: 600_000 }, () => {
    // These documents at one time flagged DRC errors that they shouldn't have.

    const tests: string[] = [
      'issue4139', // DRC fails wrongly with minimally-spaced pads at 45 degree
      'issue4774', // Shape collisions missing SH_POLY_SET
      'issue5978', // Hole clearance violation with non-copper pad
      'issue5990', // DRC flags a board edge clearance violation although the clearance is respected
      'issue6443', // Wrong DRC and rendering of THT pads with selective inner copper layers
      'issue7567', // DRC constraint to disallow holes gets SMD pads also
      'issue7975', // Differential pair gap out of range fault by DRC
      'issue8407', // PCBNEW: Arc for diff pair has clearance DRC error
      'issue10906', // Soldermask bridge for only one object
      'issue12609', // Arc collison edge case
      'issue14412', // Solder mask bridge between pads in a net-tie pad group
      'issue15280', // Very wide spokes mis-counted as being single spoke
      'issue14008', // Net-tie clearance error
      'issue17967/issue17967', // Arc dp coupling
      'issue18203', // DRC error due to colliding arc and circle
      'issue18839', // False positive board edge clearance between concentric arcs
      'unconnected-netnames/unconnected-netnames', // Raised false schematic partity error
      'net_tie_drc', // Net tie bridging soldermask DRC test
      'diff_pair_uncoupled_tuning_drc', // Tuning pattern length wrongly counted as uncoupled
    ];

    const failures: string[] = [];

    for (const relPath of tests) {
      const board = LoadBoard(relPath);
      // Do not refill zones here because this is testing the DRC engine, not the zone filler

      const violations: DRC_ITEM[] = [];
      const bds = board.GetDesignSettings();

      // Disable DRC tests not useful or not handled in this testcase
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_INVALID_OUTLINE, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_STARVED_THERMAL, RPT_SEVERITY_IGNORE);
      // These DRC tests are not useful and do not work because they need a footprint library
      // associated to the board
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_IGNORE);

      bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
        if (bds.GetSeverity(aItem.GetErrorCode()) === RPT_SEVERITY_ERROR) violations.push(aItem);
      });

      bds.m_DRCEngine!.RunTests('mm', true, false);

      if (violations.length !== 0) {
        const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'in');
        const itemMap = board.FillItemMap();
        let report = '';

        for (const item of violations)
          report += item.ShowReport(unitsProvider, RPT_SEVERITY_ERROR, itemMap);

        failures.push(
          `DRC regression: ${relPath}\n${violations.length} violations found (expected 0)\n${report}`,
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('DRCFalseNegativeRegressions', { timeout: 600_000 }, () => {
    // These documents at one time failed to catch DRC errors that they should have

    const issue19325_ignore = new Map<number, Severity>([
      [PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE, RPT_SEVERITY_IGNORE],
    ]);
    const issue22102_ignore = new Map<number, Severity>([
      [PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, RPT_SEVERITY_IGNORE],
      [PCB_DRC_CODE.DRCE_DANGLING_TRACK, RPT_SEVERITY_IGNORE],
    ]);

    const tests: [string, number, Map<number, Severity>][] = [
      ['issue1358', 2, new Map()],
      ['issue2512', 5, new Map()],
      ['issue2528', 1, new Map()],
      ['issue5750', 4, new Map()], // Shorting zone fills pass DRC in some cases
      ['issue5854', 3, new Map()],
      ['issue6879', 6, new Map()],
      ['issue6945', 2, new Map()],
      ['issue7241', 1, new Map()],
      ['issue7267', 5, new Map()],
      ['issue7325', 2, new Map()],
      ['issue8003', 2, new Map()],
      ['issue9081', 2, new Map()],
      ['issue12109', 8, new Map()], // Pads fail annular width test
      ['issue14334', 2, new Map()], // Thermal spoke to otherwise unconnected island
      ['issue16566', 6, new Map()], // Pad_Shape vs Shape property
      ['issue18142', 1, new Map()], // blind/buried via to micro-via hole-to-hole
      ['reverse_via', 3, new Map()], // Via/track ordering
      ['intersectingzones', 1, new Map()], // zones are too close to each other
      ['fill_bad', 1, new Map()], // zone max BBox was too small
      ['issue18878', 12, new Map()], // Updated: fix reports all cross-net mask bridge pairs
      ['issue19325/issue19325', 4, issue19325_ignore], // Overlapping pad annular ring calculation
      ['issue22102', 2, issue22102_ignore], // arc-to-rect collision; colocated arcs collision
      ['issue11814', 2, new Map()], // Teardrop clearance to pad
    ];

    const failures: string[] = [];

    for (const [testName, expectedErrors, customSeverities] of tests) {
      const board = LoadBoard(testName);
      // Do not refill zones here because this is testing the DRC engine, not the zone filler

      const markers: PCB_MARKER[] = [];
      const violations: DRC_ITEM[] = [];
      const bds = board.GetDesignSettings();

      // Disable DRC tests not useful in this testcase
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_IGNORE);
      bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_TRACK_NOT_CENTERED_ON_VIA, RPT_SEVERITY_IGNORE);

      for (const [test, severity] of customSeverities) bds.m_DRCSeverities.set(test, severity);

      bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM, aPos) => {
        markers.push(new PCB_MARKER(aItem, aPos));

        if (!bds.m_DrcExclusions.has(markers[markers.length - 1]!.SerializeToString()))
          violations.push(aItem);
      });

      bds.m_DRCEngine!.RunTests('mm', true, false);

      if (violations.length !== expectedErrors) {
        const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'in');
        const itemMap = board.FillItemMap();
        let report = '';

        for (const item of violations)
          report += item.ShowReport(unitsProvider, RPT_SEVERITY_ERROR, itemMap);

        failures.push(
          `DRC regression: ${testName}\n${violations.length} violations found (expected ${expectedErrors})\n${report}`,
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
