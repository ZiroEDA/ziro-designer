// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * KiCad's creepage DRC tests: `qa/tests/pcbnew/drc/test_drc_creepage*.cpp`,
 * each on its own board from the reference tree's `qa/data/pcbnew`. The
 * counts and every "actual" distance were also checked uuid-for-uuid against
 * `kicad-cli pcb drc` on the same boards (issue 636, stage 4d).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_IGNORE } from '@ziroeda/common/reporter.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { add, EuclideanNorm, equal, sub, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import {
  CREEP_SHAPE_TYPE,
  CREEPAGE_GRAPH,
  SegmentIntersectsBoard,
} from '@ziroeda/pcbnew/drc/drc_creepage_utils.js';
import type { DRC_ITEM } from '@ziroeda/pcbnew/drc/drc_item.js';
import { PCB_DRC_CODE } from '@ziroeda/pcbnew/drc/drc_item.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB } from '@ziroeda/pcbnew/padstack.js';
import { PCB_MARKER } from '@ziroeda/pcbnew/pcb_marker.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { HAVE_TEST_DATA, LoadBoard } from './drc_test_utils.js';

const suite = HAVE_TEST_DATA ? describe : describe.skip;

interface ViolationInfo {
  item: DRC_ITEM;
  pos: VECTOR2I;
  layer: number;
  pathShapes: readonly PCB_SHAPE[];
  reportedActual: number;
}

/** "actual N.NNNN mm" out of the error message; -1 when absent. */
const parseActual = (msg: string): number => {
  const m = /actual\s+([0-9]+\.[0-9]+)\s*mm/.exec(msg);

  return m ? Number.parseFloat(m[1]!) : -1.0;
};

/** The fixture body every creepage suite shares: only DRCE_CREEPAGE is an error. */
function runCreepage(board: BOARD): ViolationInfo[] {
  const violations: ViolationInfo[] = [];
  const bds = board.GetDesignSettings();

  expect(bds.m_DRCEngine, 'DRC engine not initialized').toBeTruthy();

  for (let ii = PCB_DRC_CODE.DRCE_FIRST; ii <= PCB_DRC_CODE.DRCE_LAST; ++ii)
    bds.m_DRCSeverities.set(ii, RPT_SEVERITY_IGNORE);

  bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_CREEPAGE, RPT_SEVERITY_ERROR);

  bds.m_DRCEngine!.SetViolationHandler(
    (
      aItem: DRC_ITEM,
      aPos: VECTOR2I,
      aLayer: number,
      aPathGenerator: (aMarker: PCB_MARKER) => void,
    ) => {
      if (bds.GetSeverity(aItem.GetErrorCode()) !== RPT_SEVERITY_ERROR) return;

      const marker = new PCB_MARKER(aItem, aPos, aLayer);
      aPathGenerator(marker);

      violations.push({
        item: aItem,
        pos: aPos,
        layer: aLayer,
        pathShapes: marker.GetPath(),
        reportedActual: parseActual(aItem.GetErrorMessage(false)),
      });
    },
  );

  bds.m_DRCEngine!.RunTests('mm', true, false);

  bds.m_DRCEngine!.ClearViolationHandler();

  return violations;
}

/** The C4 pads "1" and "2" that the slot regressions measure against. */
function findC4Pads(board: BOARD): [PAD, PAD] {
  let pad1: PAD | null = null;
  let pad2: PAD | null = null;

  for (const fp of board.Footprints()) {
    if (fp.GetReference() !== 'C4') continue;

    for (const p of fp.Pads()) {
      if (p.GetNumber() === '1') pad1 = p;
      else if (p.GetNumber() === '2') pad2 = p;
    }
  }

  expect(pad1 && pad2, 'C4 pads 1 and 2 not found in board').toBeTruthy();

  return [pad1!, pad2!];
}

const isOrthogonal = (aPad: PAD): boolean => {
  const deg = aPad.GetOrientation().Normalize().AsDegrees();
  const mod = deg % 90.0;
  return mod < 0.01 || mod > 89.99;
};

/** The F.Cu violation reported between the two pads. */
function findPadPairViolation(
  violations: ViolationInfo[],
  pad1: PAD,
  pad2: PAD,
  needPath = false,
): ViolationInfo | null {
  for (const vi of violations) {
    if (vi.layer !== PCB_LAYER_ID.F_Cu) continue;

    const idA = vi.item.GetMainItemID();
    const idB = vi.item.GetAuxItemID();
    const matchA = idA === pad1.m_Uuid || idA === pad2.m_Uuid;
    const matchB = idB === pad1.m_Uuid || idB === pad2.m_Uuid;

    if (matchA && matchB && idA !== idB && (!needPath || vi.pathShapes.length > 0)) return vi;
  }

  return null;
}

suite('DRC creepage (KiCad qa/tests/pcbnew/drc/test_drc_creepage*.cpp)', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  // test_drc_creepage.cpp
  it('CreepageHVvsGND', { timeout: 120_000 }, () => {
    const violations = runCreepage(LoadBoard('creepage/creepage'));

    // The board has HV and GND netclass traces ~3.25mm apart. The custom rule requires
    // 8mm creepage between HV and GND netclasses, so at least one violation must be detected.
    expect(violations.length).toBeGreaterThanOrEqual(1);

    // kicad-cli on this board: exactly one, at 3.9263 mm
    expect(violations.length).toBe(1);
    expect(violations[0]!.reportedActual).toBeCloseTo(3.9263, 4);
  });

  // Regression test for https://gitlab.com/kicad/code/kicad/-/issues/23653
  it('CreepageMalformedEdge', { timeout: 120_000 }, () => {
    const violations = runCreepage(LoadBoard('creepage/creepage_malformed_edge'));

    // Same board geometry as CreepageHVvsGND but with an extra malformed Edge.Cuts line.
    // The creepage DRC must still detect violations even when the board outline is invalid.
    expect(violations.length).toBeGreaterThanOrEqual(1);

    // kicad-cli: one, at 2.9822 mm
    expect(violations.length).toBe(1);
    expect(violations[0]!.reportedActual).toBeCloseTo(2.9822, 4);
  });

  // test_drc_creepage_issue20480.cpp
  it('CreepageSlotIssue20480', { timeout: 120_000 }, () => {
    const violations = runCreepage(LoadBoard('issue20480/issue20480'));

    // The board has pads with netclasses L and N separated by a slot. The custom rule
    // requires 10mm creepage. The actual creepage around the slot is ~5mm, so the DRC
    // must detect at least one violation. Before the fix, the algorithm could not route
    // around slot edges that shared the same parent board item.
    expect(violations.length).toBeGreaterThanOrEqual(1);

    // kicad-cli: one, at 5.2361 mm
    expect(violations.length).toBe(1);
    expect(violations[0]!.reportedActual).toBeCloseTo(5.2361, 4);
  });

  // test_drc_creepage_issue23364.cpp
  it('CreepageCircularPadsIssue23364', { timeout: 120_000 }, () => {
    const violations = runCreepage(LoadBoard('creepage_slots/creepage_slots'));

    // The board has circular pads in the 'Sitove' netclass separated by two
    // rectangular slots on Edge.Cuts. The creepage rule requires 5mm. Before
    // the fix, CU_SHAPE_CIRCLE had a shadowed m_pos member that caused
    // GetPos() through a base pointer to return (0,0), making spatial filtering
    // reject all work items involving circular pads.
    expect(violations.length).toBeGreaterThanOrEqual(1);

    // kicad-cli: three, at 2.0000 / 3.0800 / 3.1219 mm
    expect(violations.map((v) => v.reportedActual).sort()).toEqual([2.0, 3.08, 3.1219]);
  });

  // test_drc_creepage_issue23389.cpp
  it('CreepageNPTHSlotIssue23389', { timeout: 120_000 }, () => {
    const violations = runCreepage(LoadBoard('issue23389/issue23389'));

    let maxActual = 0.0;

    for (const v of violations) maxActual = Math.max(maxActual, v.reportedActual);

    // The board has multiple 'Sitove' netclass pad pairs around a 5mm x 1mm NPTH oval slot.
    // With correct slot modeling (arcs + segments), creepage paths must go around the actual
    // slot boundary. This produces 4 violations, two of which have actual distances above 4mm.
    // If the slot were modeled as an oversized circle (old bug, radius=2.5mm instead of 0.5mm),
    // those longer paths would exceed 5mm and not be reported, dropping the count to 2.
    expect(violations.length).toBe(4);

    // At least one violation must have a measured distance above 4mm, proving the path
    // correctly traverses the slot boundary rather than cutting through the slot interior
    // or detouring around an oversized circle.
    expect(maxActual).toBeGreaterThan(4.0);

    // kicad-cli: 2.0000 / 3.0800 / 3.1428 / 4.4693 mm
    expect(violations.map((v) => v.reportedActual).sort()).toEqual([2.0, 3.08, 3.1428, 4.4693]);
  });

  // test_drc_creepage_issue23576.cpp
  it('CreepagePathEndsOnTrackEdgeIssue23576', { timeout: 120_000 }, () => {
    const board = LoadBoard('issue23389/issue23389');
    const violations = runCreepage(board);

    expect(violations.length).toBeGreaterThanOrEqual(1);

    // Build a lookup of board items by UUID for resolving DRC item references
    const itemMap = new Map<string, BOARD_ITEM>();

    for (const track of board.Tracks()) itemMap.set(track.m_Uuid, track);

    for (const fp of board.Footprints()) {
      itemMap.set(fp.m_Uuid, fp);

      for (const pad of fp.Pads()) itemMap.set(pad.m_Uuid, pad);
    }

    let checked = 0;

    for (const vi of violations) {
      if (vi.pathShapes.length === 0) continue;

      // Resolve the items from the violation
      const itemA = itemMap.get(vi.item.GetMainItemID()) ?? null;
      const itemB = itemMap.get(vi.item.GetAuxItemID()) ?? null;

      // For tracks, verify that the path shape vertex nearest to the track lies on
      // its physical edge (at halfWidth from the centerline), not on the centerline.
      // Path shapes can have inconsistent direction, so check ALL vertices.
      for (const item of [itemA, itemB]) {
        if (!item || item.Type() !== KICAD_T.PCB_TRACE_T) continue;

        const track = item as unknown as {
          GetStart(): VECTOR2I;
          GetEnd(): VECTOR2I;
          GetWidth(): number;
        };
        const trackSeg = new SEG(track.GetStart(), track.GetEnd());
        const halfWidth = Math.trunc(track.GetWidth() / 2);

        let minDist = Number.MAX_SAFE_INTEGER;

        for (const s of vi.pathShapes) {
          minDist = Math.min(minDist, trackSeg.Distance(s.GetStart()));
          minDist = Math.min(minDist, trackSeg.Distance(s.GetEnd()));
        }

        const tolerance = 10000; // 10um
        expect(Math.abs(minDist - halfWidth)).toBeLessThanOrEqual(tolerance);
        checked++;
      }
    }

    // kicad-cli reports one track-to-track violation on this board (B.Cu), so the
    // edge check above ran for both of its items; without this the loop could
    // pass by never entering.
    expect(checked).toBe(2);
  });

  // test_drc_creepage_issue23578.cpp
  it('CreepageRoundedRectSlotIssue23578', { timeout: 120_000 }, () => {
    const violations = runCreepage(LoadBoard('issue23578/issue23578'));

    // The board has a rounded rectangle slot (gr_rect with radius=0.5mm, effectively a
    // stadium shape) on Edge.Cuts, with Sitove-class traces within 5mm creepage distance
    // of each other measured around the slot boundary. Without the fix, the DRC reported
    // zero violations because rounded corners were not modeled. With the fix, at least
    // one violation must be detected.
    expect(violations.length).toBeGreaterThanOrEqual(1);

    // kicad-cli: 2.0000 / 2.3771 / 3.0800 mm
    expect(violations.map((v) => v.reportedActual).sort()).toEqual([2.0, 2.3771, 3.08]);
  });

  // test_drc_creepage_issue24286.cpp
  it('CreepageNPTHSlotTangentIssue24286', { timeout: 120_000 }, () => {
    const board = LoadBoard('issue24286/issue24286');
    const violations = runCreepage(board);

    const [pad1, pad2] = findC4Pads(board);

    const p1Pos = pad1.GetPosition();
    const p2Pos = pad2.GetPosition();
    const directSeg = new SEG(p1Pos, p2Pos);
    const directDist = EuclideanNorm(sub(p2Pos, p1Pos)) / 1e6;

    // Find the violation reported between pad1 and pad2 on the F.Cu layer. The bug
    // surfaces specifically on F.Cu (the user-reported "incorrect" path); B.Cu is
    // separately reported and not the regression target here.
    const c4Violation = findPadPairViolation(violations, pad1, pad2);

    expect(
      c4Violation,
      'No F.Cu creepage violation reported between C4 pad1 and pad2',
    ).toBeTruthy();
    expect(c4Violation!.pathShapes.length).toBeGreaterThanOrEqual(1);

    // Sum the geometric length of the reported path.
    let pathLen = 0.0;

    for (const s of c4Violation!.pathShapes) {
      if (s.GetShape() === SHAPE_T.SEGMENT) {
        pathLen += EuclideanNorm(sub(s.GetEnd(), s.GetStart())) / 1e6;
      } else if (s.GetShape() === SHAPE_T.ARC) {
        const arc = new PCB_SHAPE(null, SHAPE_T.ARC);
        arc.SetArcGeometry(s.GetStart(), s.GetArcMid(), s.GetEnd());
        pathLen += arc.GetLength() / 1e6;
      }
    }

    // Path must not cut through the NPTH slot interior. The capacitor is centred on the
    // NPTH oval so the direct centre-to-centre segment runs straight through the slot.
    // A correct creepage path must wrap around the slot, so every segment of the reported
    // path must lie at least 0.4 mm (half the slot's short axis, minus a 100 um tolerance)
    // off the direct line.
    let pathLeavesDirectLine = false;

    for (const s of c4Violation!.pathShapes) {
      const distStart = directSeg.Distance(s.GetStart());
      const distEnd = directSeg.Distance(s.GetEnd());

      if (distStart > 400000 || distEnd > 400000) {
        pathLeavesDirectLine = true;
        break;
      }
    }

    expect(pathLeavesDirectLine).toBe(true);

    // The actual surface creepage between two THT pads centred on a 4mm x 1mm NPTH slot
    // must be appreciably longer than the centre-to-centre distance.
    expect(pathLen).toBeGreaterThanOrEqual(directDist - 0.1);

    // With the fix the path uses proper tangent points and the reported distance drops below 4 mm.
    expect(c4Violation!.reportedActual).toBeGreaterThanOrEqual(0);
    expect(c4Violation!.reportedActual).toBeLessThan(4.0);

    // kicad-cli: 2.8084 (B.Cu) / 3.6113 (F.Cu) mm
    expect(violations.map((v) => v.reportedActual).sort()).toEqual([2.8084, 3.6113]);
  });

  // test_drc_creepage_issue24523.cpp
  it('CreepageTwoSlotsIssue24523', { timeout: 120_000 }, () => {
    const violations = runCreepage(LoadBoard('issue24523/issue24523'));

    let shortestActual = Number.MAX_VALUE;

    for (const vi of violations) {
      if (vi.reportedActual >= 0.0) shortestActual = Math.min(shortestActual, vi.reportedActual);
    }

    // The two nets violate the 5 mm rule because the true surface path that winds
    // around the two NPTH slots is only ~3 mm. The path search must find it.
    expect(violations.length).toBeGreaterThan(0);

    // Guard against a future regression that lets a grossly overestimated (but still
    // sub-5 mm) path through: the real path is ~3 mm.
    expect(shortestActual).toBeLessThan(4.0);

    // kicad-cli: one, at 3.0707 mm
    expect(violations.length).toBe(1);
    expect(shortestActual).toBeCloseTo(3.0707, 4);
  });

  // test_drc_creepage_issue24543.cpp
  it('CreepageRotatedPadAnchorIssue24543', { timeout: 120_000 }, () => {
    const board = LoadBoard('issue24543/issue24543');
    const violations = runCreepage(board);

    const [pad1, pad2] = findC4Pads(board);

    // The bug is specific to a non-orthogonal rotation, so confirm at least one C4 pad
    // is rotated off-axis. If neither were, GetEffectiveShape() would emit a SHAPE_RECT
    // and the original (axis-aligned) path would already be correct.
    expect(
      !isOrthogonal(pad1) || !isOrthogonal(pad2),
      'Expected at least one C4 pad to be rotated off-axis',
    ).toBe(true);

    const c4Violation = findPadPairViolation(violations, pad1, pad2);

    expect(
      c4Violation,
      'No F.Cu creepage violation reported between C4 pad1 and pad2',
    ).toBeTruthy();
    expect(c4Violation!.pathShapes.length).toBeGreaterThanOrEqual(1);

    // Collect every endpoint of the reported creepage path.
    const endpoints: VECTOR2I[] = [];

    for (const s of c4Violation!.pathShapes) {
      endpoints.push(s.GetStart());
      endpoints.push(s.GetEnd());
    }

    const poly1 = pad1.GetEffectivePolygon(PCB_LAYER_ID.F_Cu);
    const poly2 = pad2.GetEffectivePolygon(PCB_LAYER_ID.F_Cu);

    expect(poly1.OutlineCount() > 0 && poly2.OutlineCount() > 0).toBe(true);

    // Distance from a point to the copper edge (outline), not the solid interior.
    const edge1 = poly1.COutline(0);
    const edge2 = poly2.COutline(0);

    // Distance of a point from the nearest NPTH hole centre.
    const distToNearestHoleMM = (aPt: VECTOR2I): number => {
      let best = Number.MAX_VALUE;

      for (const p of board.GetPads()) {
        if (p.GetAttribute() !== PAD_ATTRIB.NPTH) continue;

        const hole = p.GetEffectiveHoleShape();

        if (!hole) continue;

        const r = Math.trunc(hole.GetWidth() / 2);
        const d = hole.GetSeg().SquaredDistance(aPt);
        const edgeDist = Math.abs(Math.sqrt(d) - r) / 1e6;
        best = Math.min(best, edgeDist);
      }

      return best;
    };

    let closestToPad1 = Number.MAX_VALUE;
    let closestToPad2 = Number.MAX_VALUE;
    let anchor1: VECTOR2I = { x: 0, y: 0 };
    let anchor2: VECTOR2I = { x: 0, y: 0 };

    for (const pt of endpoints) {
      const d1 = Math.sqrt(edge1.SquaredDistance(pt)) / 1e6;
      const d2 = Math.sqrt(edge2.SquaredDistance(pt)) / 1e6;

      if (d1 < closestToPad1) {
        closestToPad1 = d1;
        anchor1 = pt;
      }

      if (d2 < closestToPad2) {
        closestToPad2 = d2;
        anchor2 = pt;
      }
    }

    // Core assertion: the creepage path must terminate on each pad's copper outline.
    expect(closestToPad1).toBeLessThan(0.05);
    expect(closestToPad2).toBeLessThan(0.05);

    // Verify each pad anchor is on copper and not pinned to the hole.
    expect(distToNearestHoleMM(anchor1) > 0.1 || closestToPad1 < 0.05).toBe(true);
    expect(distToNearestHoleMM(anchor2) > 0.1 || closestToPad2 < 0.05).toBe(true);

    // kicad-cli: one, at 3.1925 mm
    expect(violations.map((v) => v.reportedActual)).toEqual([3.1925]);
  });

  // test_drc_creepage_issue24544.cpp
  it('CreepageRoundedSlotWrapIssue24544', { timeout: 120_000 }, () => {
    const board = LoadBoard('issue24544/issue24544');
    const violations = runCreepage(board);

    // Recover the rounded-rectangle slot geometry from Edge.Cuts.
    let slotStart: VECTOR2I = { x: 0, y: 0 };
    let slotEnd: VECTOR2I = { x: 0, y: 0 };
    let slotRadius = 0;
    let slotFound = false;

    for (const item of board.Drawings()) {
      const s = item instanceof PCB_SHAPE ? item : null;

      if (!s || !s.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) continue;

      if (s.GetShape() !== SHAPE_T.RECTANGLE || s.GetCornerRadius() <= 0) continue;

      slotStart = s.GetStart();
      slotEnd = s.GetEnd();
      slotRadius = s.GetCornerRadius();
      slotFound = true;
      break;
    }

    expect(slotFound, 'Rounded-rectangle slot not found on Edge.Cuts').toBe(true);

    const x1 = Math.min(slotStart.x, slotEnd.x);
    const y1 = Math.min(slotStart.y, slotEnd.y);
    const x2 = Math.max(slotStart.x, slotEnd.x);
    const y2 = Math.max(slotStart.y, slotEnd.y);
    const r = slotRadius;

    // Build the exact rounded-rectangle slot outline as a polygon.
    const slotPoly = new SHAPE_POLY_SET();
    slotPoly.NewOutline();
    const ERR = 1000; // arc approximation error, 1 um

    slotPoly.Append({ x: x1 + r, y: y1 });
    slotPoly.Append({ x: x2 - r, y: y1 });

    const appendArc = (aCenter: VECTOR2I, aStart: EDA_ANGLE, aEnd: EDA_ANGLE): void => {
      const startPt: VECTOR2I = {
        x: aCenter.x + KiROUND(r * aStart.Cos()),
        y: aCenter.y + KiROUND(r * aStart.Sin()),
      };
      const realArc = new SHAPE_ARC(aCenter, startPt, aEnd.sub(aStart), 0);
      const chain = realArc.ConvertToPolyline(ERR);

      for (let i = 0; i < chain.PointCount(); ++i) slotPoly.Append(chain.CPoint(i));
    };

    const deg = (d: number): EDA_ANGLE => new EDA_ANGLE(d, EDA_ANGLE_T.DEGREES_T);

    appendArc({ x: x2 - r, y: y1 + r }, deg(-90.0), deg(0.0));
    if (y2 - y1 > 2 * r) appendArc({ x: x2 - r, y: y2 - r }, deg(0.0), deg(90.0));
    slotPoly.Append({ x: x2 - r, y: y2 });
    slotPoly.Append({ x: x1 + r, y: y2 });
    appendArc({ x: x1 + r, y: y2 - r }, deg(90.0), deg(180.0));
    if (y2 - y1 > 2 * r) appendArc({ x: x1 + r, y: y1 + r }, deg(180.0), deg(270.0));
    slotPoly.Outline(0).SetClosed(true);

    const [pad1, pad2] = findC4Pads(board);

    expect(
      !isOrthogonal(pad1) || !isOrthogonal(pad2),
      'Expected at least one C4 pad to be rotated off-axis',
    ).toBe(true);

    const slotViolation = findPadPairViolation(violations, pad1, pad2, true);

    expect(slotViolation, 'No creepage violation reported between C4 pad1 and pad2').toBeTruthy();

    // Densify the path into a point list.
    const pathPts: VECTOR2I[] = [];
    const pushPt = (aPt: VECTOR2I): void => {
      if (pathPts.length === 0 || !equal(pathPts[pathPts.length - 1]!, aPt)) pathPts.push(aPt);
    };

    for (const s of slotViolation!.pathShapes) {
      if (s.GetShape() === SHAPE_T.ARC) {
        const arc = new SHAPE_ARC(s.GetStart(), s.GetArcMid(), s.GetEnd(), 0);
        const chain = arc.ConvertToPolyline(1000);

        for (let i = 0; i < chain.PointCount(); ++i) pushPt(chain.CPoint(i));
      } else {
        pushPt(s.GetStart());
        pushPt(s.GetEnd());
      }
    }

    expect(pathPts.length, 'Reported creepage path has no usable geometry').toBeGreaterThanOrEqual(
      2,
    );

    // (1) The path must respect the slot boundary - no point may fall inside the slot interior.
    let maxInsideMM = 0.0;

    for (let i = 0; i + 1 < pathPts.length; ++i) {
      const a = pathPts[i]!;
      const b = pathPts[i + 1]!;
      const steps = 32;

      for (let k = 0; k <= steps; ++k) {
        // a + ( b - a ) * k / steps in integer arithmetic
        const d = sub(b, a);
        const pt: VECTOR2I = {
          x: a.x + Math.trunc((d.x * k) / steps),
          y: a.y + Math.trunc((d.y * k) / steps),
        };

        if (slotPoly.Contains(pt)) {
          const depth = Math.sqrt(slotPoly.COutline(0).SquaredDistance(pt)) / 1e6;

          if (depth > maxInsideMM) maxInsideMM = depth;
        }
      }
    }

    expect(maxInsideMM).toBeLessThan(0.02);

    // (2) The path must actually follow the CURVED part of a rounded end.
    const onRoundedCorner = (aPt: VECTOR2I): boolean => {
      const inEndBand = aPt.x < x1 + r || aPt.x > x2 - r;
      const inSideBand = aPt.y < y1 + r || aPt.y > y2 - r;

      if (!inEndBand || !inSideBand) return false;

      const distToOutline = Math.sqrt(slotPoly.COutline(0).SquaredDistance(aPt)) / 1e6;
      return distToOutline < 0.02;
    };

    let wrapsRoundedCorner = false;

    for (const pt of pathPts) {
      if (onRoundedCorner(pt)) {
        wrapsRoundedCorner = true;
        break;
      }
    }

    expect(wrapsRoundedCorner).toBe(true);

    // kicad-cli: one, at 2.4899 mm
    expect(violations.map((v) => v.reportedActual)).toEqual([2.4899]);
  });

  // test_drc_creepage_issue24597.cpp
  it('CreepageArcParentNotExemptIssue24597', { timeout: 120_000 }, () => {
    const violations = runCreepage(LoadBoard('issue24597/issue24597'));

    expect(violations.length, 'Expected a creepage violation around the slot').toBeGreaterThan(0);

    // The corner-cutting bug measured <= 2.76mm on this board, the correct path around
    // both corner arcs is ~2.82mm. Any value below the wrapped length means the path
    // shortcut across the slot.
    for (const v of violations) {
      expect(v.reportedActual).toBeGreaterThanOrEqual(0);
      expect(v.reportedActual).toBeGreaterThan(2.78);
    }

    // kicad-cli: one, at 2.8170 mm
    expect(violations.map((v) => v.reportedActual)).toEqual([2.817]);
  });

  // test_drc_creepage_issue24875.cpp
  // Overlapping caps. Was 1.93mm (shortcut across the void), correct ~3.93mm (wraps the merged
  // end via the arc tangents). Below 3.0 = shortcut, above 4.0 = forced onto arc endpoints.
  it('CreepageOverlappingCapsIssue24875', { timeout: 120_000 }, () => {
    const actuals = runCreepage(LoadBoard('issue24875/issue24875')).map((v) => v.reportedActual);

    expect(actuals.length, 'Expected a creepage violation around the slots').toBeGreaterThan(0);

    for (const actual of actuals) {
      expect(actual).toBeGreaterThan(3.0);
      expect(actual).toBeLessThan(4.0);
    }

    // kicad-cli: one, at 3.9253 mm
    expect(actuals).toEqual([3.9253]);
  });

  // A cap overlaps the other slot's straight section. Never a false path, so this guards
  // against the overlap detection over-triggering. The fix leaves it unchanged (~2.31mm).
  it('CreepageCapOverStraightIssue24875', { timeout: 120_000 }, () => {
    const actuals = runCreepage(LoadBoard('issue24875_capstraight/issue24875_capstraight')).map(
      (v) => v.reportedActual,
    );

    expect(actuals.length, 'Expected a creepage violation around the slots').toBeGreaterThan(0);

    for (const actual of actuals) {
      expect(actual).toBeGreaterThan(2.0);
      expect(actual).toBeLessThan(2.6);
    }

    // kicad-cli: one, at 2.3108 mm
    expect(actuals).toEqual([2.3108]);
  });
});

// test_drc_creepage_issue24524.cpp: no board; the two production code paths that
// consume the stadium cap geometry.
describe('DRC creepage stadium caps (test_drc_creepage_issue24524.cpp)', () => {
  // Build a horizontal stadium slot: 20 mm wide, 2 mm tall, 1 mm corner radius.
  // The left cap is centered at (1, 1) mm and the right cap at (19, 1) mm.
  const MakeHorizontalStadium = (): PCB_SHAPE => {
    const slot = new PCB_SHAPE(null, SHAPE_T.RECTANGLE);
    slot.SetStart({ x: 0, y: 0 });
    slot.SetEnd({ x: pcbIUScale.mmToIU(20), y: pcbIUScale.mmToIU(2) });
    slot.SetCornerRadius(pcbIUScale.mmToIU(1));
    return slot;
  };

  // A path segment crossing the outer apex of a cap must be reported as crossing
  // the board edge (return value false), while a segment grazing the inner half
  // of the same circle stays inside the slot and must read as clear (true).
  it('CreepageStadiumCapsBlockOuterSide', () => {
    const slot = MakeHorizontalStadium();
    const edges: BOARD_ITEM[] = [slot];
    const dontTest: BOARD_ITEM[] = [];
    const oneMM = pcbIUScale.mmToIU(1);
    const halfMM = pcbIUScale.mmToIU(0.5);

    // Left cap apex sits at (0, 1) mm. A horizontal probe through it must be blocked.
    expect(
      SegmentIntersectsBoard({ x: -halfMM, y: oneMM }, { x: halfMM, y: oneMM }, edges, dontTest, 0),
    ).toBe(false);

    // Right cap apex sits at (20, 1). A horizontal probe through it must be blocked.
    expect(
      SegmentIntersectsBoard(
        { x: pcbIUScale.mmToIU(19.5), y: oneMM },
        { x: pcbIUScale.mmToIU(20.5), y: oneMM },
        edges,
        dontTest,
        0,
      ),
    ).toBe(false);

    // A probe across the inner half of the left cap's circle (around (2, 1)) lies
    // inside the slot, away from any real boundary, so it must read as clear.
    expect(
      SegmentIntersectsBoard(
        { x: pcbIUScale.mmToIU(1.5), y: oneMM },
        { x: pcbIUScale.mmToIU(2.5), y: oneMM },
        edges,
        dontTest,
        0,
      ),
    ).toBe(true);
  });

  // The decomposition feeding the routing graph must emit two cap arcs whose
  // swept midpoints fall on the outer side of each cap center.
  it('CreepageStadiumCapsArcOutward', () => {
    const board = new BOARD();
    const graph = new CREEPAGE_GRAPH(board);
    const slot = MakeHorizontalStadium();
    graph.m_boardEdge.push(slot);

    graph.TransformEdgeToCreepShapes();

    const arcs = graph.m_shapeCollection.filter(
      (shape) => shape && shape.GetType() === CREEP_SHAPE_TYPE.ARC,
    );

    expect(arcs.length).toBe(2);

    const oneMM = pcbIUScale.mmToIU(1);

    for (const arc of arcs) {
      const center = arc.GetPos();
      const midAngle = arc.GetStartAngle().add(arc.GetEndAngle()).divide(2.0);
      const apexX = center.x + arc.GetRadius() * midAngle.Cos();

      expect(arc.GetRadius()).toBe(oneMM);

      if (center.x < pcbIUScale.mmToIU(10))
        expect(apexX).toBeLessThan(center.x); // left cap bulges left
      else expect(apexX).toBeGreaterThan(center.x); // right cap bulges right
    }
  });
});

// test_drc_creepage_issue21482.cpp: the performance board (57 violations across two
// rules). KiCad's suite asserts < 20 s on a thread pool; ours is single-threaded and
// takes ~6 min, so it only runs when asked for: ZIRO_SLOW_DRC=1.
const slow = HAVE_TEST_DATA && process.env.ZIRO_SLOW_DRC ? describe : describe.skip;

slow('DRC creepage performance board (test_drc_creepage_issue21482.cpp)', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('CreepagePerformanceIssue21482', { timeout: 1_800_000 }, () => {
    const violations = runCreepage(LoadBoard('issue21482/issue21482'));

    // kicad-cli on this board: 57 creepage violations
    expect(violations.length).toBe(57);
    expect(violations.filter((v) => v.reportedActual === 7.0614).length).toBe(1);
  });
});
