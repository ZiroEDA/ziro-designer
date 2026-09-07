// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Courtyard collisions while footprints are being moved.
 * Counterpart: `pcbnew/drc/drc_interactive_courtyard_clearance.cpp`.
 *
 * This is not DRC. It is the live feedback `EDIT_TOOL::doMoveSelection` runs on
 * every frame of a move (`edit_tool_move_fct.cpp:1207`): the courtyards that
 * touch get `COURTYARD_CONFLICT` set, `FOOTPRINT::ViewGetLayers` then adds
 * `LAYER_CONFLICTS_SHADOW` for them, and the painter fills their courtyard
 * polygons in that layer's colour (`pcb_painter.cpp:2846`). Four things fall
 * out of reading it that way:
 *
 *  - **The clearance is zero.** The provider computes a worst-case
 *    `COURTYARD_CLEARANCE_CONSTRAINT` but then does not use it —
 *    "Currently, do not use DRC engine for calculation time reasons" — and
 *    collides at `clearance = 0`. It only widens the broad-phase boxes, which
 *    is all `largestClearance` does here.
 *  - **A pad HOLE inside the other courtyard counts**, in both directions, and
 *    short-circuits the second direction when the first already matched.
 *  - **A rule area that disallows footprints counts**, per side, and the zone
 *    is shaded along with the footprint.
 *  - **Both sides of the collision are marked**, the moving footprint included:
 *    the move tool passes `aHighlightMoved = true`.
 *
 * Split into `beginCourtyardConflicts` / `courtyardConflictsAt` the way the
 * provider splits `Init` from `Run`: deriving a courtyard from the footprint's
 * F.CrtYd graphics is the expensive half and nothing about it changes while the
 * mouse is down. A frame only translates the cached outlines by the delta,
 * which is what moving the footprint would have done to them anyway.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { buildCourtyard } from './courtyard.js';
import { shapeDist } from './drc/drc_geometry.js';
import { footprintBBox } from './edit-footprint.js';
import { padHoleSegment } from './footprint_checker.js';
import type { Board, PcbFootprint } from './types.js';

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One drilled pad's `PAD::GetEffectiveHoleShape`, at rest. */
interface Hole {
  a: Vec2;
  b: Vec2;
  r: number;
}

interface FpEntry {
  index: number;
  /** `GetCourtyard( F_CrtYd )`, board coordinates, at rest. */
  front: Vec2[][];
  back: Vec2[][];
  frontBBox: Box | null;
  backBBox: Box | null;
  /** `GetBoundingBox( true )`. */
  bbox: Box | null;
  holes: Hole[];
}

/** A rule area with `GetDoNotAllowFootprints()`. */
interface RuleAreaEntry {
  index: number;
  outline: Vec2[];
  /** `( GetLayerSet() & LSET::FrontMask() ).any()` — every `F.*` layer. */
  disallowFront: boolean;
  disallowBack: boolean;
}

/** What `Init` caches, plus which footprints the gesture is moving. */
export interface CourtyardConflictSession {
  readonly fps: readonly FpEntry[];
  readonly moving: readonly FpEntry[];
  /**
   * `m_FpInMove` as indices. The painter needs it: a moving footprint is a
   * SELECTED one, and `PCB_RENDER_SETTINGS::GetColor` hands a selected item
   * `m_layerColorsSel` rather than the layer colour (`pcb_painter.cpp:337-343`),
   * so its shadow is the brightened variant and the victim's is not.
   */
  readonly movingFootprints: ReadonlySet<number>;
  readonly ruleAreas: readonly RuleAreaEntry[];
  readonly largestClearance: number;
}

/** `m_itemsInConflict`, as indices into `board.footprints` / `board.zones`. */
export interface CourtyardConflicts {
  readonly footprints: ReadonlySet<number>;
  readonly zones: ReadonlySet<number>;
}

const EMPTY_CONFLICTS: CourtyardConflicts = { footprints: new Set(), zones: new Set() };

function bboxOf(rings: readonly Vec2[][]): Box | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

const shift = (b: Box | null, d: Vec2): Box | null =>
  b && { minX: b.minX + d.x, minY: b.minY + d.y, maxX: b.maxX + d.x, maxY: b.maxY + d.y };

const inflate = (b: Box, n: number): Box => ({
  minX: b.minX - n,
  minY: b.minY - n,
  maxX: b.maxX + n,
  maxY: b.maxY + n,
});

const intersects = (a: Box | null, b: Box | null): boolean =>
  a !== null &&
  b !== null &&
  a.minX <= b.maxX &&
  b.minX <= a.maxX &&
  a.minY <= b.maxY &&
  b.minY <= a.maxY;

const move = (ring: readonly Vec2[], d: Vec2): Vec2[] =>
  d.x === 0 && d.y === 0 ? (ring as Vec2[]) : ring.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));

const moveAll = (rings: readonly Vec2[][], d: Vec2): Vec2[][] => rings.map((r) => move(r, d));

/** `SHAPE_POLY_SET::Collide( &other, 0 )` over two outline sets. */
function ringsCollide(a: readonly Vec2[][], b: readonly Vec2[][]): boolean {
  for (const ra of a) {
    for (const rb of b) {
      if (shapeDist({ kind: 'poly', pts: ra, r: 0 }, { kind: 'poly', pts: rb, r: 0 }) === 0)
        return true;
    }
  }
  return false;
}

/** `testPadAgainstCourtyards`: a drilled pad's hole inside either courtyard. */
function holeInCourtyards(hole: Hole, d: Vec2, rings: readonly Vec2[][]): boolean {
  const shape = {
    kind: 'stadium' as const,
    a: { x: hole.a.x + d.x, y: hole.a.y + d.y },
    b: { x: hole.b.x + d.x, y: hole.b.y + d.y },
    r: hole.r,
  };
  return rings.some((ring) => shapeDist(shape, { kind: 'poly', pts: ring, r: 0 }) === 0);
}

function entryFor(fp: PcbFootprint, index: number): FpEntry {
  const front = buildCourtyard(fp, 'F.CrtYd').outlines;
  const back = buildCourtyard(fp, 'B.CrtYd').outlines;
  const bb = footprintBBox(fp, true);
  const holes: Hole[] = [];
  for (const pad of fp.pads) {
    // `if( pad->HasHole() )` — a pad with no drill has no hole to test.
    const seg = padHoleSegment(pad);
    if (seg && seg.width > 0) holes.push({ a: seg.a, b: seg.b, r: seg.width / 2 });
  }
  return {
    index,
    front,
    back,
    frontBBox: bboxOf(front),
    backBBox: bboxOf(back),
    bbox: bb ? { minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY } : null,
    holes,
  };
}

/**
 * `DRC_INTERACTIVE_COURTYARD_CLEARANCE::Init` plus `m_FpInMove`.
 *
 * `largestClearance` is the worst `COURTYARD_CLEARANCE_CONSTRAINT` on the
 * board; it widens the broad-phase boxes and nothing else, because the
 * narrow-phase collide is hardcoded to zero upstream. Zero is right for a board
 * with no custom rule, and a larger value can only add candidate pairs.
 */
export function beginCourtyardConflicts(
  board: Board,
  movingFootprints: Iterable<number>,
  largestClearance = 0,
): CourtyardConflictSession {
  const movingIdx = new Set(movingFootprints);
  const fps = board.footprints.map(entryFor);
  const ruleAreas: RuleAreaEntry[] = [];

  for (let i = 0; i < board.zones.length; i++) {
    const z = board.zones[i]!;
    // `if( !zone->GetIsRuleArea() || !zone->HasKeepoutParametersSet()
    //      || !zone->GetDoNotAllowFootprints() ) continue;`
    if (!z.ruleArea?.footprints) continue;
    if (!z.outline || z.outline.length < 3) continue;
    ruleAreas.push({
      index: i,
      outline: z.outline,
      disallowFront: z.layers.some((l) => l.startsWith('F.')),
      disallowBack: z.layers.some((l) => l.startsWith('B.')),
    });
  }

  return {
    fps,
    moving: fps.filter((e) => movingIdx.has(e.index)),
    movingFootprints: movingIdx,
    ruleAreas,
    largestClearance,
  };
}

/**
 * `Run()` + `UpdateConflicts( view, true )` for one frame: the items in
 * conflict once the moving footprints have been shifted by `delta`.
 */
export function courtyardConflictsAt(
  session: CourtyardConflictSession,
  delta: Vec2,
): CourtyardConflicts {
  if (session.moving.length === 0) return EMPTY_CONFLICTS;

  const footprints = new Set<number>();
  const zones = new Set<number>();
  const moving = new Set(session.moving.map((e) => e.index));

  // `movingBBox`: the union of the moving footprints' boxes, inflated once.
  let movingBBox: Box | null = null;
  const movedBBox = new Map<number, Box | null>();
  for (const b of session.moving) {
    const box = shift(b.bbox, delta);
    movedBBox.set(b.index, box);
    if (!box) continue;
    movingBBox = movingBBox
      ? {
          minX: Math.min(movingBBox.minX, box.minX),
          minY: Math.min(movingBBox.minY, box.minY),
          maxX: Math.max(movingBBox.maxX, box.maxX),
          maxY: Math.max(movingBBox.maxY, box.maxY),
        }
      : box;
  }
  if (movingBBox) movingBBox = inflate(movingBBox, session.largestClearance);

  for (const a of session.fps) {
    // `if( fpA->IsSelected() ) continue;` — a moving footprint is never fpA.
    if (moving.has(a.index)) continue;
    if (!intersects(movingBBox, a.bbox)) continue;
    // "No courtyards defined and no hole testing against other footprint's
    // courtyards" — fpA with neither is skipped outright, which is why a
    // footprint that draws no courtyard never lights up.
    if (a.front.length === 0 && a.back.length === 0) continue;

    const frontABox = a.frontBBox && inflate(a.frontBBox, session.largestClearance);
    const backABox = a.backBBox && inflate(a.backBBox, session.largestClearance);

    for (const b of session.moving) {
      const frontB = moveAll(b.front, delta);
      const backB = moveAll(b.back, delta);
      const bBox = movedBBox.get(b.index) ?? null;
      const frontBBox = shift(b.frontBBox, delta);
      const backBBox = shift(b.backBBox, delta);

      let hit = false;

      if (a.front.length > 0 && frontB.length > 0 && intersects(frontABox, frontBBox))
        hit = ringsCollide(a.front, frontB);

      if (!hit && a.back.length > 0 && backB.length > 0 && intersects(backABox, backBBox))
        hit = ringsCollide(a.back, backB);

      if (hit) {
        footprints.add(a.index);
        footprints.add(b.index);
      }

      // A hole of the MOVING footprint inside the static one's courtyard.
      let skipNextCmp = false;
      if (
        (a.front.length > 0 && intersects(frontABox, bBox)) ||
        (a.back.length > 0 && intersects(backABox, bBox))
      ) {
        const aRings = [...a.front, ...a.back];
        for (const hole of b.holes) {
          if (!holeInCourtyards(hole, delta, aRings)) continue;
          footprints.add(a.index);
          footprints.add(b.index);
          skipNextCmp = true;
          break;
        }
      }

      if (skipNextCmp) continue; // fpA and fpB are already in the list

      // …and the other way round: a static hole inside the moving courtyard.
      if (
        (frontB.length > 0 && intersects(frontBBox, a.bbox)) ||
        (backB.length > 0 && intersects(backBBox, a.bbox))
      ) {
        const bRings = [...frontB, ...backB];
        for (const hole of a.holes) {
          if (!holeInCourtyards(hole, { x: 0, y: 0 }, bRings)) continue;
          footprints.add(a.index);
          footprints.add(b.index);
          break;
        }
      }
    }
  }

  for (const area of session.ruleAreas) {
    for (const b of session.moving) {
      // Upstream breaks out of the footprint loop on the first hit for this
      // zone, so a zone is tested until one moving footprint matches.
      if (area.disallowFront && b.front.length > 0) {
        if (ringsCollide([area.outline], [move(b.front[0]!, delta)])) {
          footprints.add(b.index);
          zones.add(area.index);
          break;
        }
      }

      if (area.disallowBack && b.back.length > 0) {
        if (ringsCollide([area.outline], [move(b.back[0]!, delta)])) {
          footprints.add(b.index);
          zones.add(area.index);
          break;
        }
      }
    }
  }

  return { footprints, zones };
}

/**
 * The polygons `PCB_PAINTER::draw( FOOTPRINT*, LAYER_CONFLICTS_SHADOW )` fills
 * for one conflicting footprint — both courtyards, at the moved position.
 */
export function conflictShadowRings(
  session: CourtyardConflictSession,
  fpIndex: number,
  delta: Vec2,
): Vec2[][] {
  const e = session.fps[fpIndex];
  if (!e) return [];
  const d = session.movingFootprints.has(fpIndex) ? delta : { x: 0, y: 0 };
  return [...moveAll(e.front, d), ...moveAll(e.back, d)];
}
