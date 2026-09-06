// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board footprint versus its library original.
 * Counterparts: `FOOTPRINT::FootprintNeedsUpdate`, `shapeNeedsUpdate`,
 * `padNeedsUpdate` and `padHasOverrides` in
 * `pcbnew/drc/drc_test_provider_library_parity.cpp`, the `cmp_pads` /
 * `cmp_drawings` orderings in `pcbnew/footprint.cpp`, and
 * `PCB_SHAPE::NormalizeForCompare` in `pcbnew/pcb_shape.cpp`.
 *
 * Two callers want this: the Diff Footprint report, which shows every
 * difference, and the `lib_footprint_mismatch` DRC check, which reports only
 * the ones that mean the footprint is genuinely stale. `DiffMode` is that
 * distinction, and it is upstream's `COMPARE_FLAGS::DRC`.
 *
 * The split matters. Clearance overrides and flags like "do not populate" are
 * as likely to be set deliberately on the board as in the library, so DRC
 * ignores them — reporting them would make every board with a local override
 * noisy, and a noisy check gets switched off. The diff report still shows
 * them, because there the user is asking what differs, not what is wrong.
 *
 * ## Everything upstream refuses to look at
 *
 * The far more dangerous half of this file is what it does *not* compare. A
 * board footprint is expected to differ from its library original in several
 * ways that mean nothing, and reporting any of them makes every board on the
 * bench look stale:
 *
 *  - **All text items.** Reference and value carry the instance's own text, and
 *    both are routinely moved and restyled per placement. Upstream copies only
 *    `PCB_SHAPE_T` items into the compared sets and says so in a comment: "we
 *    punt and ignore all the text items".
 *  - **Stroke off copper.** `shapeNeedsUpdate` compares the stroke only when
 *    the shape is on a copper layer, so a silkscreen line whose width or dash
 *    pattern was changed on the board is not a difference. It reads like an
 *    oversight; it is reproduced exactly.
 *  - **Position round-off.** Every point comparison carries `TEST_PT`'s
 *    `EPSILON` of 10 IU, and an arc's midpoint its own 0.0005 mm.
 *  - **Direction and winding.** A segment drawn end-to-start, a rectangle with
 *    its corners the other way round, and a rectangle stored as a four-vertex
 *    polygon all normalise to the same thing first.
 *  - **Pin function and pin type**, which come from the schematic, and a
 *    roundrect ratio on a pad that is not round-rectangular.
 *
 * ## Coordinates, and why the epsilon is not decoration here
 *
 * Our model stores footprint children board-absolute, with the parent transform
 * already applied; a library footprint sits at the origin with no rotation. So
 * everything is compared in the parent's frame, which is what the library
 * actually defines. Upstream instead keeps a second, exact set of library
 * coordinates on every item, and only needs `EPSILON` for "differentially
 * rotated parents". We have to *reconstruct* the library frame by unrotating,
 * and `rotatePcb` rounds to whole IU, so a placed copy of an untouched
 * footprint comes back off by 1 IU on roughly one coordinate in eight. Without
 * the epsilon, every footprint at any angle that is not a multiple of 90° would
 * be reported as modified.
 *
 * The normalisation predicates below (is this polygon axis-aligned, which end
 * of this segment sorts first) are exact equality upstream, and stay exact
 * here, so that 1 IU of round-off can still flip one of them. That is
 * upstream's fragility, not an extra one, and repairing it would be inventing
 * behaviour.
 */

import { strNumCmp } from '@ziroeda/common/src/string_utils.js';
import { rotatePcb } from './read-board.js';
import { isCopperLayerName } from './swap_layers.js';
import type { PcbFootprint, PcbPad, PcbShape } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { PcbFillMode } from './shape_fill.js';

export type DiffMode = 'report' | 'drc';

/** `EPSILON` in the parity provider: 10 IU, a hundredth of a micron. */
const EPSILON = 10;

/** `EPSILON_D`, the tolerance `TEST_D` allows on an angle in degrees. */
const EPSILON_D = 0.00001;

/** `pcbIUScale.mmToIU( 0.0005 )`, the slack allowed on a computed arc midpoint. */
const ARC_MID_EPSILON = 500;

/**
 * Attributes DRC ignores because they describe a design, not a footprint,
 * each with the label upstream puts in "'%s' settings differ."
 */
const DESIGN_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [
  ['board_only', 'Not in schematic'],
  ['exclude_from_pos_files', 'Exclude from position files'],
  ['exclude_from_bom', 'Exclude from bill of materials'],
  ['dnp', 'Do not populate'],
];

/** A board child's position in its footprint's own frame. */
function localPos(fp: PcbFootprint, p: Vec2): Vec2 {
  return rotatePcb({ x: p.x - fp.at.x, y: p.y - fp.at.y }, -fp.angle);
}

/** A board child's angle relative to its footprint, `Normalize()`d to [0, 360). */
function localAngle(fp: PcbFootprint, angle: number): number {
  const a = (angle - fp.angle) % 360;
  return a < 0 ? a + 360 : a;
}

/** `TEST_PT`: the same point to within a hundredth of a micron. */
const samePoint = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;

/** `TEST_D`. */
const sameValue = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON_D;

const ORIGIN: Vec2 = { x: 0, y: 0 };

/** `cmp_points_opt`: order by x, then y, exactly. Zero when identical. */
const comparePoints = (a: Vec2, b: Vec2): number => a.x - b.x || a.y - b.y;

/* -------------------------------------------------------------------------- */
/*  Graphics                                                                   */
/* -------------------------------------------------------------------------- */

/** A footprint graphic in the library frame, after `NormalizeForCompare`. */
interface NormalShape {
  kind: PcbShape['kind'];
  layer: string;
  width: number;
  strokeType?: string;
  fillMode: PcbFillMode;
  start: Vec2;
  end: Vec2;
  mid: Vec2;
  pts: Vec2[];
}

/**
 * `PCB_SHAPE::NormalizeForCompare`, and the `Normalize()` it falls back to.
 *
 * A segment is turned so its endpoints run left to right (and, on a vertical
 * segment, upward in screen coordinates); a rectangle becomes its normalised
 * bounding box; and a four-vertex axis-aligned polygon becomes a rectangle,
 * because that is how the same outline arrives from different editors.
 */
function normaliseShape(fp: PcbFootprint, s: PcbShape): NormalShape {
  const at = (p: Vec2 | undefined): Vec2 => (p ? localPos(fp, p) : ORIGIN);
  const out: NormalShape = {
    kind: s.kind,
    layer: s.layer,
    width: s.width,
    strokeType: s.strokeType,
    fillMode: s.fillMode,
    // A circle keeps its centre where every other shape keeps its start, which
    // is exactly how `PCB_SHAPE` stores it.
    start: at(s.kind === 'circle' ? s.center : s.start),
    end: at(s.end),
    mid: at(s.mid),
    pts: (s.pts ?? []).map((p) => localPos(fp, p)),
  };

  if (out.kind === 'line') {
    if (out.start.x > out.end.x || (out.start.x === out.end.x && out.start.y < out.end.y)) {
      const swap = out.start;
      out.start = out.end;
      out.end = swap;
    }

    return out;
  }

  if (out.kind === 'poly' && out.pts.length === 4) {
    const segA = (i: number): Vec2 => out.pts[i]!;
    const segB = (i: number): Vec2 => out.pts[(i + 1) % 4]!;
    const horizontal = (i: number): boolean => segA(i).y === segB(i).y;
    const vertical = (i: number): boolean => segA(i).x === segB(i).x;
    const minX = (i: number): number => Math.min(segA(i).x, segB(i).x);
    const maxX = (i: number): number => Math.max(segA(i).x, segB(i).x);
    const minY = (i: number): number => Math.min(segA(i).y, segB(i).y);
    const maxY = (i: number): number => Math.max(segA(i).y, segB(i).y);

    // `Segment( n )` runs from vertex n to vertex n+1, the last one closing the
    // outline, so the two axis-aligned readings differ only in which segment
    // carries the x extent.
    if (horizontal(0) && vertical(1) && horizontal(2) && vertical(3)) {
      out.kind = 'rect';
      out.start = { x: minX(0), y: minY(1) };
      out.end = { x: maxX(0), y: maxY(1) };
      out.pts = [];
    } else if (vertical(0) && horizontal(1) && vertical(2) && horizontal(3)) {
      out.kind = 'rect';
      out.start = { x: minX(1), y: minY(0) };
      out.end = { x: maxX(1), y: maxY(0) };
      out.pts = [];
    }
  }

  if (out.kind === 'rect') {
    const start = { x: Math.min(out.start.x, out.end.x), y: Math.min(out.start.y, out.end.y) };
    const end = { x: Math.max(out.start.x, out.end.x), y: Math.max(out.start.y, out.end.y) };
    out.start = start;
    out.end = end;
  }

  return out;
}

/**
 * `FOOTPRINT::cmp_drawings` for the `PCB_SHAPE` case. Only a sort key: it
 * decides which board graphic is compared against which library graphic, and
 * every field it looks at is compared exactly, tolerance or no tolerance.
 *
 * Upstream orders by `PCB_LAYER_ID`, an enum we have no numbering for; layer
 * name is the stand-in. Items that are genuinely equal sort together either
 * way, so this only picks the pairing among items that already differ.
 */
function compareShapes(a: NormalShape, b: NormalShape): number {
  if (a.layer !== b.layer) return a.layer < b.layer ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;

  if (a.kind !== 'poly') {
    const byStart = comparePoints(a.start, b.start);
    if (byStart !== 0) return byStart;

    const byEnd = comparePoints(a.end, b.end);
    if (byEnd !== 0) return byEnd;
  }

  if (a.kind === 'arc') {
    const byMid = comparePoints(a.mid, b.mid);
    if (byMid !== 0) return byMid;
  } else if (a.kind === 'poly' || a.kind === 'curve') {
    if (a.pts.length !== b.pts.length) return a.pts.length - b.pts.length;

    for (let i = 0; i < a.pts.length; i++) {
      const byPt = comparePoints(a.pts[i]!, b.pts[i]!);
      if (byPt !== 0) return byPt;
    }
  }

  return a.width - b.width;
}

/**
 * `SHAPE_LINE_CHAIN::CompareGeometry( other, true, EPSILON )`: same vertex
 * count, then every vertex within the tolerance once both outlines have been
 * sorted by their angle about their own centroid, so a polygon that starts at a
 * different corner or winds the other way still matches.
 */
function samePolygon(a: Vec2[], b: Vec2[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;

  const byCentroidAngle = (pts: Vec2[]): Vec2[] => {
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;

    return [...pts].sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  };

  const sortedA = byCentroidAngle(a);
  const sortedB = byCentroidAngle(b);

  return sortedA.every((p, i) => samePoint(p, sortedB[i]!));
}

/** `shapeNeedsUpdate`, on two graphics already in the library frame. */
function shapeDiffers(a: NormalShape, b: NormalShape): boolean {
  if (a.kind !== b.kind) return true;

  switch (a.kind) {
    // Both boxes were normalised on the way in, as upstream normalises them a
    // second time here.
    case 'rect':
    case 'line':
    case 'circle':
      if (!samePoint(a.start, b.start) || !samePoint(a.end, b.end)) return true;
      break;

    case 'arc': {
      if (!samePoint(a.start, b.start) || !samePoint(a.end, b.end)) return true;

      // The midpoint is derived from the centre and so drifts further than a
      // stored endpoint; it gets its own, looser tolerance.
      if (Math.hypot(a.mid.x - b.mid.x, a.mid.y - b.mid.y) > ARC_MID_EPSILON) return true;
      break;
    }

    case 'curve':
      // Start, end and both control points, in order.
      if (a.pts.length !== b.pts.length) return true;
      if (a.pts.some((p, i) => !samePoint(p, b.pts[i]!))) return true;
      break;

    case 'poly':
      if (!samePolygon(a.pts, b.pts)) return true;
      break;
  }

  // Off copper the stroke is not compared at all: a silkscreen line whose width
  // was changed on the board is not reported. Upstream's guard, kept as it is.
  if (isCopperLayerName(a.layer) && (a.width !== b.width || a.strokeType !== b.strokeType))
    return true;

  if (a.fillMode !== b.fillMode) return true;

  return a.layer !== b.layer;
}

/* -------------------------------------------------------------------------- */
/*  Pads                                                                       */
/* -------------------------------------------------------------------------- */

/** A pad in the library frame. */
interface NormalPad {
  pad: PcbPad;
  at: Vec2;
  angle: number;
  layers: string[];
}

const normalisePad = (fp: PcbFootprint, pad: PcbPad): NormalPad => ({
  pad,
  at: localPos(fp, pad.at),
  angle: localAngle(fp, pad.angle),
  layers: [...pad.layers].sort(),
});

const sameStrings = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((s, i) => s === b[i]);

const drillOf = (pad: PcbPad): { oblong: boolean; w: number; h: number } =>
  pad.drill ?? { oblong: false, w: 0, h: 0 };

/**
 * `PAD_SHAPE::CHAMFERED_RECT`, which the file has no token for: it spells a
 * chamfered pad as a roundrect that also carries a chamfer, and the parser
 * promotes the shape as soon as either the ratio or the corner list says
 * something. The model keeps the file's spelling, so the promotion has to be
 * redone here — otherwise a chamfered pad and a plain roundrect compare as the
 * same shape, and the chamfer is then never looked at.
 */
const isChamferedRect = (pad: PcbPad): boolean =>
  pad.shape === 'roundrect' && ((pad.chamferRatio ?? 0) > 0 || (pad.chamfer?.length ?? 0) > 0);

/** `PAD::GetShape`, with the chamfered rectangle told apart from the roundrect. */
const padShapeOf = (pad: PcbPad): string => (isChamferedRect(pad) ? 'chamfered_rect' : pad.shape);

/** `FOOTPRINT::cmp_pads`, again only a pairing key. */
function comparePads(a: NormalPad, b: NormalPad): number {
  if (a.pad.number !== b.pad.number) return strNumCmp(a.pad.number, b.pad.number);

  const byPos = comparePoints(a.at, b.at);
  if (byPos !== 0) return byPos;

  if (a.pad.size.x !== b.pad.size.x) return a.pad.size.x - b.pad.size.x;
  if (a.pad.size.y !== b.pad.size.y) return a.pad.size.y - b.pad.size.y;

  const shapeA = padShapeOf(a.pad);
  const shapeB = padShapeOf(b.pad);
  if (shapeA !== shapeB) return shapeA < shapeB ? -1 : 1;

  const layersA = a.layers.join(',');
  const layersB = b.layers.join(',');

  return layersA === layersB ? 0 : layersA < layersB ? -1 : 1;
}

/**
 * `PADSTACK::UNCONNECTED_LAYER_MODE` read back as the two booleans upstream
 * compares. `KeepTopBottom` is undefined unless `RemoveUnconnected` is set, so
 * only the first is always meaningful — which is also why a pad that says
 * `keep_all` and a pad that says nothing at all are the same pad.
 */
const removesUnconnected = (pad: PcbPad): boolean =>
  pad.unconnectedLayerMode === 'remove_all' ||
  pad.unconnectedLayerMode === 'remove_except_start_and_end' ||
  pad.unconnectedLayerMode === 'start_end_only';

const keepsTopBottom = (pad: PcbPad): boolean =>
  pad.unconnectedLayerMode === 'remove_except_start_and_end' ||
  pad.unconnectedLayerMode === 'start_end_only';

/** `padNeedsUpdate`, minus the padstack loop we have no per-layer model for. */
function padDiffers(a: NormalPad, b: NormalPad): boolean {
  if ((a.pad.padToDieLength ?? 0) !== (b.pad.padToDieLength ?? 0)) return true;
  if (!samePoint(a.at, b.at)) return true;
  if (a.pad.number !== b.pad.number) return true;

  if (removesUnconnected(a.pad) !== removesUnconnected(b.pad)) return true;
  if (removesUnconnected(a.pad) && keepsTopBottom(a.pad) !== keepsTopBottom(b.pad)) return true;
  if (!sameStrings(a.layers, b.layers)) return true;

  if (a.pad.type !== b.pad.type) return true;
  if ((a.pad.padProperty ?? '') !== (b.pad.padProperty ?? '')) return true;
  if (!sameValue(a.angle, b.angle)) return true;

  if (padShapeOf(a.pad) !== padShapeOf(b.pad)) return true;
  if (a.pad.size.x !== b.pad.size.x || a.pad.size.y !== b.pad.size.y) return true;

  const deltaA = a.pad.delta ?? ORIGIN;
  const deltaB = b.pad.delta ?? ORIGIN;
  if (deltaA.x !== deltaB.x || deltaA.y !== deltaB.y) return true;

  // A ratio only matters on a shape that has corners to apply it to; one left
  // over in the file on a plain rectangle or an oval is not a difference.
  if (a.pad.shape === 'roundrect') {
    if (!sameValue(a.pad.roundrectRatio ?? 0, b.pad.roundrectRatio ?? 0)) return true;
  }

  if (isChamferedRect(a.pad)) {
    if (!sameValue(a.pad.chamferRatio ?? 0, b.pad.chamferRatio ?? 0)) return true;
    if (!sameStrings([...(a.pad.chamfer ?? [])].sort(), [...(b.pad.chamfer ?? [])].sort()))
      return true;
  }

  if (!samePoint(a.pad.drill?.offset ?? ORIGIN, b.pad.drill?.offset ?? ORIGIN)) return true;

  const drillA = drillOf(a.pad);
  const drillB = drillOf(b.pad);

  if (drillA.oblong !== drillB.oblong) return true;

  return drillA.w !== drillB.w || drillA.h !== drillB.h;
}

/**
 * `padHasOverrides`, report mode only: the pad-level twin of the footprint's
 * local overrides, reported for the same reason — here the user asked what
 * differs, not what is wrong.
 */
function padOverrides(a: PcbPad, b: PcbPad): string[] {
  const out: string[] = [];
  const desc = `Pad ${a.number}`;

  if (a.localClearance !== undefined && a.localClearance !== b.localClearance)
    out.push(`${desc} has clearance override.`);

  if (a.localSolderMaskMargin !== undefined && a.localSolderMaskMargin !== b.localSolderMaskMargin)
    out.push(`${desc} has solder mask expansion override.`);

  if (
    a.localSolderPasteMargin !== undefined &&
    a.localSolderPasteMargin !== b.localSolderPasteMargin
  )
    out.push(`${desc} has solder paste clearance override.`);

  // The same sentence as the absolute margin above, upstream included: a pad
  // that overrides both says it twice.
  if (
    a.localSolderPasteMarginRatio !== undefined &&
    a.localSolderPasteMarginRatio !== b.localSolderPasteMarginRatio
  )
    out.push(`${desc} has solder paste clearance override.`);

  if (
    a.zoneConnection !== undefined &&
    a.zoneConnection !== 'inherited' &&
    a.zoneConnection !== b.zoneConnection
  )
    out.push(`${desc} has zone connection override.`);

  if (a.thermalGap !== undefined && a.thermalGap !== b.thermalGap)
    out.push(`${desc} has thermal relief gap override.`);

  if (a.thermalBridgeWidth !== undefined && a.thermalBridgeWidth !== b.thermalBridgeWidth)
    out.push(`${desc} has thermal relief spoke width override.`);

  return out;
}

/* -------------------------------------------------------------------------- */
/*  The comparison                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Every way the board footprint differs from the library one, in the order
 * upstream reports them.
 *
 * Empty means "no relevant differences detected", which is the phrase upstream
 * reports when the diff finds nothing.
 *
 * In DRC mode upstream stops at the first difference because its caller only
 * wants the boolean. We collect the rest anyway: the work is trivial, and no
 * check here can *clear* a difference a later one found, so the answer to
 * {@link footprintNeedsUpdate} is the same either way.
 */
export function footprintDifferences(
  board: PcbFootprint,
  lib: PcbFootprint,
  mode: DiffMode = 'report',
): string[] {
  const out: string[] = [];
  const a = new Set(board.attributes ?? []);
  const b = new Set(lib.attributes ?? []);

  // The footprint type is a property of the footprint itself, so it is
  // compared in both modes.
  for (const t of ['smd', 'through_hole'])
    if (a.has(t) !== b.has(t)) {
      out.push('Footprint types differ.');
      break;
    }

  if (a.has('allow_soldermask_bridges') !== b.has('allow_soldermask_bridges'))
    out.push("'Allow bridged solder mask apertures between pads' settings differ.");

  if (mode === 'report') {
    // Skipped for DRC: "presumed to relate to a given design".
    for (const [attr, label] of DESIGN_ATTRIBUTES)
      if (a.has(attr) !== b.has(attr)) out.push(`'${label}' settings differ.`);

    // Likewise the local overrides — as likely set on the board as in the
    // library. Only a value actually set on the board counts, which is why
    // each is checked for presence before being compared.
    if (board.localClearance !== undefined && board.localClearance !== lib.localClearance)
      out.push('Pad clearance overridden.');

    if (
      board.localSolderMaskMargin !== undefined &&
      board.localSolderMaskMargin !== lib.localSolderMaskMargin
    )
      out.push('Solder mask expansion overridden.');

    if (
      board.localSolderPasteMargin !== undefined &&
      board.localSolderPasteMargin !== lib.localSolderPasteMargin
    )
      out.push('Solder paste absolute clearance overridden.');

    if (
      board.localSolderPasteMarginRatio !== undefined &&
      board.localSolderPasteMarginRatio !== lib.localSolderPasteMarginRatio
    )
      out.push('Solder paste relative clearance overridden.');

    if (
      board.zoneConnection !== undefined &&
      board.zoneConnection !== 'inherited' &&
      board.zoneConnection !== lib.zoneConnection
    )
      out.push('Zone connection overridden.');
  }

  // Net tie groups are part of the footprint's definition, so they count in
  // both modes. Upstream then walks its own vector indexing into the library's,
  // which reads off the end when the two differ in length; we stop at the count.
  const tiesA = board.netTiePadGroups ?? [];
  const tiesB = lib.netTiePadGroups ?? [];

  if (tiesA.length !== tiesB.length || tiesA.some((g, i) => g !== tiesB[i]))
    out.push('Net tie pad groups differ.');

  // Graphics and pads are matched by sorting both sides with upstream's own
  // orderings rather than by index: a library that reorders its items has not
  // changed the footprint.
  const shapesA = board.shapes.map((s) => normaliseShape(board, s)).sort(compareShapes);
  const shapesB = lib.shapes.map((s) => normaliseShape(lib, s)).sort(compareShapes);

  if (shapesA.length !== shapesB.length) out.push('Graphic item count differs.');
  else if (shapesA.some((s, i) => shapeDiffers(s, shapesB[i]!))) out.push('Graphic items differ.');

  const padsA = board.pads.map((p) => normalisePad(board, p)).sort(comparePads);
  const padsB = lib.pads.map((p) => normalisePad(lib, p)).sort(comparePads);

  if (padsA.length !== padsB.length) {
    out.push('Pad count differs.');
  } else {
    const overrides: string[] = [];
    let geometryDiffers = false;

    for (let i = 0; i < padsA.length; i++) {
      // Upstream's `else if`: a pad that already differs geometrically does not
      // also get its overrides listed.
      if (padDiffers(padsA[i]!, padsB[i]!)) geometryDiffers = true;
      else if (mode === 'report') overrides.push(...padOverrides(padsA[i]!.pad, padsB[i]!.pad));
    }

    if (geometryDiffers) out.push('Pad properties differ.');
    out.push(...overrides);
  }

  return out;
}

/** Does the board footprint need updating from its library original? */
export function footprintNeedsUpdate(
  board: PcbFootprint,
  lib: PcbFootprint,
  mode: DiffMode = 'report',
): boolean {
  return footprintDifferences(board, lib, mode).length > 0;
}

export { localPos as footprintLocalPos, samePoint as footprintSamePoint };
