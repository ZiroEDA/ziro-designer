// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * KiCad's per-provider DRC tests that need no zone refill and no length
 * calculation: `qa/tests/pcbnew/drc/test_drc_*.cpp`, each on its own board
 * from the reference tree's `qa/data/pcbnew`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { niluuid } from '@ziroeda/common/src/kiid.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/src/reporter.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { BaseType, KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_ITEM } from '@ziroeda/pcbnew/src/board_item.js';
import type { DRC_ITEM } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import { PCB_DRC_CODE } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import { PAD_ATTRIB } from '@ziroeda/pcbnew/src/padstack.js';
import { PCB_MARKER } from '@ziroeda/pcbnew/src/pcb_marker.js';
import { HAVE_TEST_DATA, LoadBoard } from './drc_test_utils.js';

const suite = HAVE_TEST_DATA ? describe : describe.skip;

const ignoreAll = (bds: { m_DRCSeverities: Map<number, number> }): void => {
  for (let ii = PCB_DRC_CODE.DRCE_FIRST; ii <= PCB_DRC_CODE.DRCE_LAST; ++ii)
    bds.m_DRCSeverities.set(ii, RPT_SEVERITY_IGNORE);
};

suite('DRC providers (KiCad qa/tests/pcbnew/drc)', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  // test_drc_via_dangling.cpp
  it('DRCViaDanglingRuleTest', { timeout: 60_000 }, () => {
    const board = LoadBoard('via_dangling');
    const violations: DRC_ITEM[] = [];
    const bds = board.GetDesignSettings();

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM, aPos: VECTOR2I) => {
      const temp = new PCB_MARKER(aItem, aPos);

      if (!bds.m_DrcExclusions.has(temp.SerializeToString())) violations.push(aItem);
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);

    let danglingVias = 0;

    for (const item of violations) {
      if (item.GetErrorCode() === PCB_DRC_CODE.DRCE_DANGLING_VIA) danglingVias++;
    }

    // The report only on failure: the C++ builds it in the else branch, and the
    // handler's temporary marker (the item's parent) has no board to ask.
    let report = '';

    if (!(danglingVias === 1 && violations.length === 1)) {
      const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'in');
      const itemMap = board.FillItemMap();
      report = violations
        .map((item) => item.ShowReport(unitsProvider, RPT_SEVERITY_ERROR, itemMap))
        .join('');
    }

    expect([danglingVias, violations.length], report).toEqual([1, 1]);
  });

  // test_drc_keepout_disallow.cpp
  it('DRCKeepoutDisallowViasAndTracks', { timeout: 60_000 }, () => {
    const board = LoadBoard('keepout_disallow/keepout_disallow');
    const violations: DRC_ITEM[] = [];
    const bds = board.GetDesignSettings();

    // Suppress unrelated checks that fire on a bare-bones board.
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_INVALID_OUTLINE, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_VIA_DIAMETER, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_STARVED_THERMAL, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_ALLOWED_ITEMS, RPT_SEVERITY_ERROR);

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
      if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_ALLOWED_ITEMS) violations.push(aItem);
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);

    let trackViolations = 0;
    let viaViolations = 0;
    const itemMap = board.FillItemMap();

    for (const item of violations) {
      const id = item.GetMainItemID();

      if (id === niluuid) continue;

      const it = itemMap.get(id);

      if (it === undefined) continue;

      switch (it.Type()) {
        case KICAD_T.PCB_VIA_T:
          viaViolations++;
          break;
        case KICAD_T.PCB_TRACE_T:
          trackViolations++;
          break;
        default:
          break;
      }
    }

    const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'mm');
    const report = violations
      .map((item) => item.ShowReport(unitsProvider, RPT_SEVERITY_ERROR, itemMap))
      .join('');

    // Expect exact counts so that duplicate-marker regressions are caught.
    expect([viaViolations, trackViolations, violations.length], report).toEqual([2, 1, 3]);
  });

  // test_drc_keepout_disallow.cpp: a track outside a no-tracks keepout must not be flagged
  // when board->m_DRCMaxClearance is large.
  it('DRCKeepoutNoClearanceInflation', { timeout: 60_000 }, () => {
    const board = LoadBoard('keepout_no_clearance/keepout_no_clearance');
    const violations: DRC_ITEM[] = [];
    const bds = board.GetDesignSettings();

    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_INVALID_OUTLINE, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_STARVED_THERMAL, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_ALLOWED_ITEMS, RPT_SEVERITY_ERROR);

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
      if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_ALLOWED_ITEMS) violations.push(aItem);
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);

    const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'mm');
    const itemMap = board.FillItemMap();
    const report = violations
      .map((item) => item.ShowReport(unitsProvider, RPT_SEVERITY_ERROR, itemMap))
      .join('');

    expect(violations.length, report).toBe(0);
  });

  // test_drc_physical_clearance.cpp: m_DRCMaxPhysicalClearance == 0 after DRC cache generation.
  it('DRCPhysicalClearanceNoConstraints', { timeout: 60_000 }, () => {
    const board = LoadBoard('issue4139');
    const bds = board.GetDesignSettings();

    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_INVALID_OUTLINE, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_STARVED_THERMAL, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_IGNORE);

    bds.m_DRCEngine!.SetViolationHandler(() => {});

    bds.m_DRCEngine!.RunTests('mm', true, false);

    expect(board.m_DRCMaxPhysicalClearance).toBe(0);
  });

  // test_drc_hole_clearance_issue24355.cpp
  it('HoleClearanceIssue24355', { timeout: 60_000 }, () => {
    const board = LoadBoard('issue24355/issue24355');
    expect(board.Footprints().length).toBe(1);

    const fp = board.Footprints()[0]!;
    expect(fp.Pads().length).toBe(2);

    // The bug is direction-sensitive; the fixture deliberately lists the
    // NPTH pad first.
    const first = fp.Pads()[0]!;
    const second = fp.Pads()[1]!;
    expect(first.GetAttribute(), 'Fixture pad order changed: expected NPTH first.').toBe(
      PAD_ATTRIB.NPTH,
    );
    expect(second.GetAttribute(), 'Fixture pad order changed: expected PTH second.').toBe(
      PAD_ATTRIB.PTH,
    );

    let holeClearanceCount = 0;
    const bds = board.GetDesignSettings();

    ignoreAll(bds);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_HOLE_CLEARANCE, RPT_SEVERITY_ERROR);

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
      if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_HOLE_CLEARANCE) ++holeClearanceCount;
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);
    bds.m_DRCEngine!.ClearViolationHandler();

    // One violation per shared copper layer (F.Cu, B.Cu) for a 2-layer board.
    expect(holeClearanceCount).toBe(2);
  });

  // test_drc_issue23469.cpp
  it('DRCIssue23469_ReferenceReducesEdgeClearance', { timeout: 60_000 }, () => {
    const board = LoadBoard('issue23469/issue23469');
    const edgeViolations: DRC_ITEM[] = [];
    const holeViolations: DRC_ITEM[] = [];
    const bds = board.GetDesignSettings();

    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_INVALID_OUTLINE, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_STARVED_THERMAL, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_IGNORE);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_IGNORE);

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
      if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_EDGE_CLEARANCE) edgeViolations.push(aItem);
      else if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_HOLE_CLEARANCE)
        holeViolations.push(aItem);
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);

    const itemMap = board.FillItemMap();

    // Count violations where at least one (or both) of the affected items belong to a
    // footprint whose reference designator matches aRef.
    const countViolationsForRef = (
      aViolations: DRC_ITEM[],
      aRef: string,
      aRequireBothItems: boolean,
    ): number => {
      let count = 0;

      for (const item of aViolations) {
        let hits = 0;

        for (const uuid of [item.GetMainItemID(), item.GetAuxItemID()]) {
          if (uuid === niluuid) continue;

          const it = itemMap.get(uuid);

          if (it === undefined) continue;

          const boardItem = it instanceof BOARD_ITEM ? it : null;

          if (!boardItem) continue;

          const fp = boardItem.GetParentFootprint();

          if (fp && fp.GetReference() === aRef) ++hits;
        }

        if (aRequireBothItems ? hits >= 2 : hits > 0) ++count;
      }

      return count;
    };

    // Positive control: the NPTH mounting hole on SW1 crosses the board edge.
    expect(countViolationsForRef(edgeViolations, 'SW1', false)).toBeGreaterThan(0);
    // Primary assertion: "(condition "A.Reference == 'J1'")" reduces the edge clearance.
    expect(countViolationsForRef(edgeViolations, 'J1', false)).toBe(0);
    // Secondary assertion: the hole_clearance rule keyed on A.Reference and B.Reference.
    expect(countViolationsForRef(holeViolations, 'J1', true)).toBe(0);
  });

  // test_drc_issue24525.cpp
  it('DRCIssue24525_TableAndBarcodeOnEdgeCuts', { timeout: 60_000 }, () => {
    const board = LoadBoard('issue24525/issue24525');
    const bds = board.GetDesignSettings();

    // Make sure the rule under test is active regardless of what the fixture stored.
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_TEXT_ON_EDGECUTS, RPT_SEVERITY_ERROR);

    const violations: DRC_ITEM[] = [];

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
      if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_TEXT_ON_EDGECUTS) violations.push(aItem);
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);

    const itemMap = board.FillItemMap();
    const byType = new Map<KICAD_T, number>();

    for (const item of violations) {
      const it = itemMap.get(item.GetMainItemID());
      expect(it).toBeDefined();

      let type = it!.Type();

      if (BaseType(type) === KICAD_T.PCB_DIMENSION_T) type = KICAD_T.PCB_DIMENSION_T;

      byType.set(type, (byType.get(type) ?? 0) + 1);
    }

    expect(byType.get(KICAD_T.PCB_TEXT_T) ?? 0).toBe(1);
    expect(byType.get(KICAD_T.PCB_DIMENSION_T) ?? 0).toBe(1);
    expect(byType.get(KICAD_T.PCB_TABLE_T) ?? 0).toBe(2);
    expect(byType.get(KICAD_T.PCB_BARCODE_T) ?? 0).toBe(1);
    // The reference image on Edge.Cuts must not be flagged.
    expect(byType.get(KICAD_T.PCB_REFERENCE_IMAGE_T) ?? 0).toBe(0);
    expect(violations.length).toBe(5);
  });

  // test_drc_arc_arc_edge_clearance.cpp
  it('DRCArcArcEdgeClearance_InternalContainment', { timeout: 60_000 }, () => {
    const board = LoadBoard('drc_arc_arc_edge_clearance/drc_arc_arc_edge_clearance');
    const edgeViolations: DRC_ITEM[] = [];
    const bds = board.GetDesignSettings();

    ignoreAll(bds);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_EDGE_CLEARANCE, RPT_SEVERITY_ERROR);

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
      if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_EDGE_CLEARANCE) edgeViolations.push(aItem);
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);

    expect(edgeViolations.length).toBeGreaterThanOrEqual(1);

    const trackUuid = 'e918352c-937f-4a75-aac0-7856db5d052e';
    const cutoutLeftArcUuid = 'b9bfe430-49e3-430b-b86f-c88b7c1be60e';
    let trackHit = false;
    let cutoutHit = false;

    for (const item of edgeViolations) {
      for (const uuid of [item.GetMainItemID(), item.GetAuxItemID()]) {
        if (uuid === trackUuid) trackHit = true;
        else if (uuid === cutoutLeftArcUuid) cutoutHit = true;
      }
    }

    expect(
      trackHit && cutoutHit,
      'Expected a DRCE_EDGE_CLEARANCE violation between the F.Cu track arc and the Edge.Cuts left cutout arc',
    ).toBe(true);
  });

  // test_drc_annular_overlap_issue24340.cpp
  it('AnnularOverlapIssue24340', { timeout: 60_000 }, () => {
    const board = LoadBoard('issue24340/issue24340');
    const annularViolations: { item: DRC_ITEM; pos: VECTOR2I }[] = [];
    const bds = board.GetDesignSettings();

    ignoreAll(bds);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_ANNULAR_WIDTH, RPT_SEVERITY_ERROR);

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM, aPos: VECTOR2I) => {
      if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_ANNULAR_WIDTH)
        annularViolations.push({ item: aItem, pos: aPos });
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);
    bds.m_DRCEngine!.ClearViolationHandler();

    // Bug-case THT board position: footprint (130, 95.5) + pad (-1.4, 0) = (128.6, 95.5).
    // Control THT board position:   footprint (176, 95.5) + pad (-1.4, 0) = (174.6, 95.5).
    const bugPos = { x: pcbIUScale.mmToIU(128.6), y: pcbIUScale.mmToIU(95.5) };
    const controlPos = { x: pcbIUScale.mmToIU(174.6), y: pcbIUScale.mmToIU(95.5) };
    const tol = pcbIUScale.mmToIU(0.5);

    let onBugFootprint = 0;
    let onControlFootprint = 0;

    for (const v of annularViolations) {
      if (Math.abs(v.pos.x - bugPos.x) < tol && Math.abs(v.pos.y - bugPos.y) < tol)
        ++onBugFootprint;
      else if (Math.abs(v.pos.x - controlPos.x) < tol && Math.abs(v.pos.y - controlPos.y) < tol)
        ++onControlFootprint;
    }

    // Bug-case pad: exact annular 0.1524 mm meets the 0.1524 mm constraint.
    expect(onBugFootprint).toBe(0);
    // Control pad: 0.1 mm annular is genuinely below the constraint.
    expect(onControlFootprint).toBe(1);
  });

  // test_drc_invalid_outline_issue24078.cpp
  it('InvalidOutlineBezierSlotIssue24078', { timeout: 60_000 }, () => {
    const board = LoadBoard('issue24078/issue24078');
    const violations: DRC_ITEM[] = [];
    const bds = board.GetDesignSettings();

    ignoreAll(bds);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_INVALID_OUTLINE, RPT_SEVERITY_ERROR);

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
      if (bds.GetSeverity(aItem.GetErrorCode()) === RPT_SEVERITY_ERROR) violations.push(aItem);
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);
    bds.m_DRCEngine!.ClearViolationHandler();

    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  // test_drc_text_var_issue24442.cpp
  it('DRCTextVarIssue24442', { timeout: 60_000 }, () => {
    const board = LoadBoard('issue24442');
    const bds = board.GetDesignSettings();

    // Disable DRC tests not useful or not handled in this testcase
    ignoreAll(bds);

    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_GENERIC_ERROR, RPT_SEVERITY_ERROR);
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_GENERIC_WARNING, RPT_SEVERITY_WARNING);

    // testTextVars() only runs when DRCE_UNRESOLVED_VARIABLE is enabled; keep it active so the
    // phase is reached.
    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE, RPT_SEVERITY_ERROR);

    let genericErrors = 0;
    let genericWarnings = 0;
    let unresolvedVars = 0;
    const errorMessages: string[] = [];
    const warningMessages: string[] = [];

    bds.m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
      if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_GENERIC_ERROR) {
        genericErrors++;
        errorMessages.push(aItem.GetErrorMessage(false));
      } else if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_GENERIC_WARNING) {
        genericWarnings++;
        warningMessages.push(aItem.GetErrorMessage(false));
      } else if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE) {
        unresolvedVars++;
      }
    });

    bds.m_DRCEngine!.RunTests('mm', true, false);

    // The fixture board contains three texts/textboxes referencing ${DRC_ERROR ...} and two
    // referencing ${DRC_WARNING ...}, plus an escaped "literal: \${DRC_ERROR not_a_real_error}"
    // which must NOT trigger DRCE_GENERIC_ERROR.
    expect(genericErrors).toBe(3);
    expect(genericWarnings).toBe(2);
    // Only the escaped literal remains an unresolved variable.
    expect(unresolvedVars).toBe(1);

    const containsMsg = (aList: string[], aNeedle: string): boolean =>
      aList.some((msg) => msg.includes(aNeedle));

    expect(containsMsg(errorMessages, 'start_of_text')).toBe(true);
    expect(containsMsg(errorMessages, 'placeholder_text')).toBe(true);
    expect(containsMsg(errorMessages, 'text_box_error')).toBe(true);
    expect(containsMsg(warningMessages, 'this_is_warning')).toBe(true);
    expect(containsMsg(warningMessages, 'embedded_warning')).toBe(true);
    // The escaped literal must never surface as a generic error.
    expect(containsMsg(errorMessages, 'not_a_real_error')).toBe(false);
  });
});
