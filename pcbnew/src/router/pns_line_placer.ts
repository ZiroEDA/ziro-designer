// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::LINE_PLACER` — interactive single-track placement.
 *
 * Counterpart: `pcbnew/router/pns_line_placer.{h,cpp}` (421 + 2209 lines).
 * A full porting spec, with every upstream oddity cited by line, lives at
 * `/var/tmp/ziro-router-specs/pns_line_placer_impl.md`.
 *
 * `NODE` is the world, `WALKAROUND` and `SHOVE` are the two ways past something
 * in it. This is the piece a *person* drives: it holds the half-finished track,
 * picks a mode on every mouse move, decides how much of the result has settled,
 * and knows how to commit and un-commit.
 *
 * ## The one idea: the track is two lines
 *
 * `m_head` is volatile — everything from the last settled point to the cursor.
 * `m_tail` is settled — what has already been forced into shape by an obstacle.
 * `m_p_start` is the seam between them, and it is *derived*, not stored:
 * `updatePStart` recomputes it from the tail's last point on every pass
 * (`pns_line_placer.cpp:1113-1119`). `Trace()` is simply tail ++ head.
 *
 * The tail grows only through `mergeHead` and `optimizeTailHeadTransition`, and
 * shrinks through `handleSelfIntersections`, `handlePullback` and `reduceTail`.
 * The threshold that decides when the head settles is `mergeHead`'s
 * `n_head < 3` (`:346`) — the head must be three *shapes* long before any of it
 * is promoted, which is exactly why the last couple of segments keep moving
 * under the cursor.
 *
 * ## The SHOVE boundary
 *
 * `SHOVE` is not ported here — it is its own engine and its own PR. Every call
 * site is real and ported against {@link PnsShoveLike}, which names the methods
 * upstream calls with upstream's names. `rhShoveOnly` is a faithful port
 * against that interface; only the engine behind it is absent.
 *
 * ## What is not ported, and why
 *
 * - `PNS_DBG` / `DEBUG_DECORATOR` / `LOGGER`: no-ops in a release build.
 * - `OPTIMIZER::SMART_PADS` and `FANOUT_CLEANUP` passes: absent from Ziro's
 *   optimizer (see its docblock — both need the joint model). The *effort
 *   flags* are computed exactly and threaded through, so the decision logic is
 *   here even though those two passes do nothing.
 * - `TOPOLOGY::LeadingRatLine`: not on Ziro's `PnsTopology`.
 *   `updateLeadingRatLine` is ported and calls an optional hook on the router
 *   interface, so the call site and its timing are real.
 */
import {
  AngleType,
  CornerMode,
  Direction45,
  isCornerMode90,
} from '@ziroeda/kimath/src/geometry/direction45.js';
import { PnsArc } from './pns_arc.js';
import { PnsKind, type PnsItem, type PnsLinkedItem } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import { PnsLine, PnsLineChain } from './pns_line_item.js';
import {
  PnsMode,
  PnsOptimizationEffort,
  pnsAllowDrcViolations,
  pnsFollowMouse,
  pnsInitialDirection,
  type RoutingSettings,
} from './pns_routing_settings.js';
import { PnsSegment } from './pns_segment.js';
import { PnsSizesSettings, type PnsPlainSizes } from './pns_sizes_settings.js';
import { PnsItemSet } from './pns_itemset.js';
import { PnsMouseTrailTracer } from './pns_mouse_trail_tracer.js';
import { PnsVia } from './pns_via.js';
import { arcCenterI, arcIsCCW } from './shape_arc_ops.js';
import { itemHull } from './pns_item_hull.js';
import { mergeColinear, mergeFull, mergeObtuse } from './pns_optimizer.js';
import { walkaround } from './pns_walkaround.js';
import { PnsShovePolicy, PnsShoveStatus } from './pns_shove.js';
import { segContains, segLength, segLineProject } from './pns_seg_ops.js';
import { lineDistance } from './pns_line.js';
import type { NetHandle } from './pns_collision.js';
import type { PnsNode } from './pns_node.js';
import type { Seg } from './pns_line.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// =============================================================================
// The SHOVE boundary
// =============================================================================

/**
 * The slice of `PNS::SHOVE` that `LINE_PLACER` actually calls, with upstream's
 * names.
 *
 * This is deliberately minimal: every method here is one upstream
 * `LINE_PLACER` invokes. Nothing is invented.
 *
 * `PNS::SHOVE` has since merged and its `PnsShove` satisfies this structurally,
 * member for member — there is a compile-time check to that effect in
 * `qa/unittests/pcbnew/pns_line_placer.test.ts`. The interface is kept rather
 * than replaced by the class because it is what lets a test drive the placer's
 * shove paths with a recorder, and because the placer genuinely needs nothing
 * more than this.
 *
 * Note that in this revision of KiCad the placer drives shove through the
 * *heads* API (`ClearHeads`/`AddHeads`/`Run`/`GetModifiedHead`) rather than the
 * older `ShoveLines`/`ShoveMultiLines` entry points, which `pns_line_placer.cpp`
 * no longer references at all. If the SHOVE port exposes those as well, they
 * simply are not needed here.
 *
 * `SetLogger` and `SetDebugDecorator` are called by upstream (`:943-944`) and
 * are omitted: both take debug objects this port does not model.
 */
export interface PnsShoveLike {
  /** `NODE* CurrentNode()` (`pns_shove.h:99`). The world as shove has left it. */
  currentNode(): PnsNode;

  /**
   * `void SetSpringbackDoNotTouchNode( const NODE* )` (`pns_shove.h:110`).
   *
   * Pins a node against springback. The placer sets it to the owner of the item
   * under the cursor so that rolling back a shove cannot destroy the node that
   * item lives in, and clears it (null) as soon as the cursor leaves.
   */
  setSpringbackDoNotTouchNode(aNode: PnsNode | null): void;

  /** `void ClearHeads()` (`pns_shove.h:80`). */
  clearHeads(): void;

  /** `void AddHeads( const LINE&, int aPolicy )` (`pns_shove.h:81`). */
  addHeads(aHead: PnsLine, aPolicy: number): void;

  /** `SHOVE_STATUS Run()` (`pns_shove.h:84`). */
  run(): PnsShoveStatus;

  /** `bool HeadsModified( int aIndex = -1 )` (`pns_shove.h:101`). */
  headsModified(aIndex?: number): boolean;

  /** `const LINE GetModifiedHead( int aIndex )` (`pns_shove.h:102`). */
  getModifiedHead(aIndex: number): PnsLine;

  /** `bool AddLockedSpringbackNode( NODE* )` (`pns_shove.h:105`). */
  addLockedSpringbackNode(aNode: PnsNode): boolean;

  /** `void UnlockSpringbackNode( NODE* )` (`pns_shove.h:106`). */
  unlockSpringbackNode(aNode: PnsNode): void;

  /** `bool RewindSpringbackTo( NODE* )` (`pns_shove.h:107`). */
  rewindSpringbackTo(aNode: PnsNode): boolean;

  /** `bool RewindToLastLockedNode()` (`pns_shove.h:108`). */
  rewindToLastLockedNode(): boolean;
}

// =============================================================================
// The router boundary
// =============================================================================

/**
 * The slice of `PNS::ROUTER_IFACE` the *placer* calls. `pns_router.cpp` is out
 * of scope for this port; these are the four things it is asked for.
 *
 * Upstream this is the same `ROUTER_IFACE` that `pns_collision.ts` already
 * names `PnsRouterIface` for the item model's one question
 * (`IsFlashedOnLayer`). The two slices are kept apart here rather than merged
 * because they are reached differently — the collision one through a module
 * singleton, this one through the router handed to the placer — and a real
 * implementation satisfies both.
 */
export interface PnsPlacerIface {
  /**
   * `GetPNSLayerFromBoardLayer( aLayer )`. The placer only ever asks for the two
   * outer copper layers, when building a through via.
   */
  getPnsLayerFromBoardLayer(aBoardLayer: string): number;

  /** `GetOrphanedNetHandle()`: the net a track started off no item gets. */
  getOrphanedNetHandle(): NetHandle;

  /** `GetNetCode( aNet )`. `FixRoute` treats `<= 0` as "no real net". */
  getNetCode(aNet: NetHandle): number;

  /**
   * `DisplayRatline( aLine, aNet )`. Optional: `updateLeadingRatLine` needs
   * `TOPOLOGY::LeadingRatLine`, which Ziro's `PnsTopology` does not have, so the
   * call site is ported and the hook is left for the router PR to fill.
   */
  displayRatline?(aLine: PnsLineChain, aNet: NetHandle): void;
}

/** The slice of `PNS::ROUTER` (and `PLACEMENT_ALGO`'s accessors) the placer calls. */
export interface PnsRouterLike {
  getInterface(): PnsPlacerIface;
  /** `ROUTER::GetWorld()`. */
  getWorld(): PnsNode;
  /** `PLACEMENT_ALGO::Settings()`, i.e. `m_router->Settings()`. */
  settings(): RoutingSettings;
  /** `ROUTER::CommitRouting( aNode )`. */
  commitRouting(aNode: PnsNode): boolean;
  /**
   * Constructs the shove engine for a fresh placement, as
   * `initPlacement` does with `std::make_unique<SHOVE>( m_world->Branch(), Router() )`
   * (`:1489`). Returning null means "no shove engine available", which is legal
   * in every mode but `RM_Shove`.
   */
  makeShove(aWorld: PnsNode): PnsShoveLike | null;
}

// =============================================================================
// FIXED_TAIL
// =============================================================================

/** `FIXED_TAIL::FIX_POINT` (`pns_line_placer.h:54-60`). */
export interface PnsFixPoint {
  layer: number;
  placingVias: boolean;
  p: Vec2;
  direction: Direction45;
}

/** `FIXED_TAIL::STAGE` (`pns_line_placer.h:62-95`). */
export interface PnsFixedTailStage {
  commit: PnsNode | null;
  pts: PnsFixPoint[];
}

/**
 * `FIXED_TAIL` (`pns_line_placer.cpp:2154-2207`): the undo stack behind
 * backspace-while-routing.
 *
 * The one thing to know about it is that **`popStage` does not pop the last
 * stage** (`:2197-2198`). The bottom entry — pushed by `Start` — is read again
 * and again, so repeatedly un-fixing at the beginning of a route is idempotent
 * rather than emptying the stack and then failing. `hasPlacedAnything` tests
 * `stageCount() > 1` for the same reason.
 */
export class PnsFixedTail {
  private mStages: PnsFixedTailStage[] = [];

  clear(): void {
    this.mStages = [];
  }

  addStage(
    aStart: Vec2,
    aLayer: number,
    aPlacingVias: boolean,
    aDirection: Direction45,
    aNode: PnsNode | null,
  ): void {
    this.mStages.push({
      commit: aNode,
      pts: [
        {
          p: { x: aStart.x, y: aStart.y },
          layer: aLayer,
          direction: aDirection,
          placingVias: aPlacingVias,
        },
      ],
    });
  }

  /** `PopStage`: reads the top stage, and pops it only if it is not the last. */
  popStage(): PnsFixedTailStage | null {
    if (this.mStages.length === 0) return null;

    const top = this.mStages[this.mStages.length - 1] as PnsFixedTailStage;

    if (this.mStages.length > 1) this.mStages.pop();

    return top;
  }

  stageCount(): number {
    return this.mStages.length;
  }
}

// =============================================================================
// Optimizer adapter
// =============================================================================

/** `OPTIMIZER::OptimizationEffort` (`pns_optimizer.h:97-110`), a bit mask. */
export enum PnsOptimizerEffort {
  MERGE_SEGMENTS = 0x01,
  SMART_PADS = 0x02,
  MERGE_OBTUSE = 0x04,
  FANOUT_CLEANUP = 0x08,
  KEEP_TOPOLOGY = 0x10,
  PRESERVE_VERTEX = 0x20,
  RESTRICT_VERTEX_RANGE = 0x40,
  MERGE_COLINEAR = 0x80,
  RESTRICT_AREA = 0x100,
  LIMIT_CORNER_COUNT = 0x200,
}

/**
 * `OPTIMIZER::Optimize( LINE*, int aEffortLevel, NODE* )`
 * (`pns_optimizer.h:116-117`), adapted onto Ziro's function-shaped optimizer.
 *
 * Returns whether the line changed, which is the boolean upstream's callers
 * branch on — `optimizeTailHeadTransition` treats "the optimizer found
 * something" as "the transition is handled, don't merge".
 *
 * `SMART_PADS` and `FANOUT_CLEANUP` are accepted in the mask and do nothing:
 * both passes need the joint model and are absent from `pns_optimizer.ts`. The
 * consequence to be honest about is that `optimizeTailHeadTransition`'s
 * fan-out arm never fires here, so its look-back merge arm always runs.
 */
export function optimizeLine(aLine: PnsLine, aEffort: number, aWorld: PnsNode | null): boolean {
  const pts = aLine.cLine().points();

  if (pts.length < 3) return false;

  const collides = (path: Vec2[]): boolean => {
    if (!aWorld || path.length < 2) return false;

    const probe = PnsLine.fromBase(aLine, PnsLineChain.fromPoints(path));

    return aWorld.checkColliding(probe, PnsKind.ANY_T) !== null;
  };

  let out = pts;

  if (aEffort & PnsOptimizerEffort.MERGE_SEGMENTS) out = mergeFull(out, collides);
  if (aEffort & PnsOptimizerEffort.MERGE_OBTUSE) out = mergeObtuse(out, collides);
  if (aEffort & PnsOptimizerEffort.MERGE_COLINEAR) out = mergeColinear(out);

  out = out.filter(
    (p, i) => i === 0 || !(p.x === (out[i - 1] as Vec2).x && p.y === (out[i - 1] as Vec2).y),
  );

  if (
    out.length === pts.length &&
    out.every((p, i) => p.x === (pts[i] as Vec2).x && p.y === (pts[i] as Vec2).y)
  )
    return false;

  aLine.setShape(PnsLineChain.fromPoints(out));

  return true;
}

// =============================================================================
// Walkaround driver
// =============================================================================

/** `WALKAROUND::WALKAROUND_STATUS`. */
export enum PnsWalkStatus {
  ST_IN_PROGRESS = 0,
  ST_DONE = 1,
  ST_STUCK = 2,
  ST_ALMOST_DONE = 3,
}

/** One policy's outcome from {@link walkaroundRoute}. */
export interface PnsWalkPolicyResult {
  line: PnsLine;
  status: PnsWalkStatus;
}

/** `WALKAROUND::RESULT` reduced to the two policies the placer asks for. */
export interface PnsWalkResult {
  cw: PnsWalkPolicyResult;
  ccw: PnsWalkPolicyResult;
}

/**
 * `WALKAROUND::Route( aInitialPath )` for the `{ WP_CCW, WP_CW }` policy set.
 *
 * Drives the already-ported `walkaround()` primitive (`pns_walkaround.ts`) —
 * the faithful `LINE::Walkaround` — rather than re-deriving one. The loop is
 * upstream's `singleStep`: ask the node which obstacle the *current* path meets
 * first, take that item's hull, walk round it, repeat. Re-querying every
 * iteration is the whole point; a detour around one pad routinely lands in the
 * next, and on a dense board that is the ordinary case rather than an edge one.
 *
 * `ST_ALMOST_DONE` rather than `ST_STUCK` on running out of iterations is
 * upstream's distinction and `rhWalkBase` reads it: an almost-done line is
 * still offered to the hugging fallback, a stuck one is not.
 */
export function walkaroundRoute(
  aWorld: PnsNode,
  aInitialPath: PnsLine,
  aCw: boolean,
  aIterationLimit: number,
  aItemMask: number,
): PnsWalkPolicyResult {
  let current = aInitialPath.clone();

  for (let iteration = 0; iteration < aIterationLimit; iteration++) {
    const obs = aWorld.nearestObstacle(current, { kindMask: aItemMask });

    if (!obs || !obs.item) return { line: current, status: PnsWalkStatus.ST_DONE };

    const clearance = aWorld.getClearance(obs.item, current, false);
    const hull = itemHull(obs.item, clearance, current.width(), current.layer());

    if (hull.length < 3) return { line: current, status: PnsWalkStatus.ST_STUCK };

    const next = walkaround(current.cLine().points(), hull, aCw);

    if (!next) return { line: current, status: PnsWalkStatus.ST_STUCK };

    const walked = current.clone();
    walked.setShape(PnsLineChain.fromPoints(next));
    current = walked;
  }

  return { line: current, status: PnsWalkStatus.ST_ALMOST_DONE };
}

// =============================================================================
// VIA::PushoutForce
// =============================================================================

/** `VECTOR2::Resize( aNewLength )`, integer-rounded as upstream's is. */
interface MutVec2 {
  x: number;
  y: number;
}

function resize(aV: Vec2, aNewLength: number): MutVec2 {
  const len = Math.hypot(aV.x, aV.y);

  if (len === 0) return { x: 0, y: 0 };

  return { x: Math.round((aV.x * aNewLength) / len), y: Math.round((aV.y * aNewLength) / len) };
}

/** `SEG::NearestPoint`. */
function segNearest(aSeg: Seg, aP: Vec2): Vec2 {
  const d = { x: aSeg.b.x - aSeg.a.x, y: aSeg.b.y - aSeg.a.y };
  const l2 = d.x * d.x + d.y * d.y;

  if (l2 === 0) return { ...aSeg.a };

  const t = Math.max(0, Math.min(1, ((aP.x - aSeg.a.x) * d.x + (aP.y - aSeg.a.y) * d.y) / l2));

  return { x: Math.round(aSeg.a.x + t * d.x), y: Math.round(aSeg.a.y + t * d.y) };
}

/**
 * `pushoutForce( const SHAPE_CIRCLE&, const SEG&, int aClearance )`
 * (`shape_collisions.cpp:154-178`): how far, and which way, to move a disc so it
 * clears a segment.
 *
 * The five-step `corr` loop is upstream's and is not a rounding nicety: the
 * resize is integer, so the naive `min_dist - dist` translation lands *just*
 * short often enough that without the correction the caller's outer loop
 * re-collides on the same obstacle for ever.
 */
function circleSegPushout(aCentre: Vec2, aRadius: number, aSeg: Seg, aClearance: number): MutVec2 {
  let f: MutVec2 = { x: 0, y: 0 };

  const nearest = segNearest(aSeg, aCentre);
  const dist = Math.round(Math.hypot(nearest.x - aCentre.x, nearest.y - aCentre.y));
  const minDist = aClearance + aRadius;

  if (dist < minDist) {
    for (let corr = 0; corr < 5; corr++) {
      f = resize({ x: aCentre.x - nearest.x, y: aCentre.y - nearest.y }, minDist - dist + corr);

      const moved = { x: aCentre.x + f.x, y: aCentre.y + f.y };
      const d2 = Math.hypot(
        segNearest(aSeg, moved).x - moved.x,
        segNearest(aSeg, moved).y - moved.y,
      );

      if (d2 >= minDist) break;
    }
  }

  return f;
}

/**
 * `VIA::PushoutForce( NODE*, const ITEM*, VECTOR2I& )`
 * (`pns_via.cpp:126-140`): the minimum translation that clears this via of one
 * obstacle.
 *
 * ### Deviation, stated plainly
 *
 * Upstream reaches this through `SHAPE::Collide( ..., VECTOR2I* aMTV )`, and
 * Ziro's collision layer has no MTV — `pcbnew/src/drc/shape_collisions.ts:57-61`
 * says so and says why. Worse, upstream's own MTV sign convention is not
 * self-consistent across the overloads (the line-chain arm at
 * `shape_collisions.cpp:299-323` pushes the *receiver*, while the rect arm at
 * `:598-606` negates to push the *argument*).
 *
 * So this is a reconstruction of the geometry rather than a line-by-line port
 * of a function whose contract upstream contradicts: for the via's disc against
 * each of the obstacle's boundary segments, take the circle-vs-segment pushout
 * above, in the sign the *caller* fixes — `mv.SetPos( mv.Pos() + force )`
 * (`pns_via.cpp:215`) unambiguously moves the via away from the obstacle. The
 * `+3` fudge and the accumulate-over-segments shape are upstream's.
 */
export function viaObstaclePushout(
  aNode: PnsNode,
  aVia: PnsVia,
  aViaPos: Vec2,
  aOther: PnsItem,
): MutVec2 {
  const clearance = aNode.getClearance(aVia, aOther, false);
  let force: MutVec2 = { x: 0, y: 0 };

  const layers = aVia.layers();

  for (let layer = layers.start(); layer <= layers.end(); layer++) {
    if (!aOther.layers().overlaps(layer)) continue;

    const viaShape = aVia.shape(layer);
    const otherShape = aOther.shape(layer);

    if (!viaShape || viaShape.kind !== 'circle' || !otherShape) continue;

    const r = viaShape.r;
    let element: MutVec2 = { x: 0, y: 0 };

    if (otherShape.kind === 'circle') {
      const delta = { x: aViaPos.x - otherShape.c.x, y: aViaPos.y - otherShape.c.y };
      const minDist = clearance + r + otherShape.r;
      const dist = Math.hypot(delta.x, delta.y);

      if (dist === 0 || dist < minDist) element = resize(delta, minDist - dist + 3);
    } else if (otherShape.kind === 'stadium') {
      element = circleSegPushout(
        aViaPos,
        r,
        { a: otherShape.a, b: otherShape.b },
        clearance + otherShape.r,
      );
    } else if (otherShape.kind === 'poly') {
      const pts = otherShape.pts;
      const moved: MutVec2 = { x: aViaPos.x, y: aViaPos.y };
      const total: MutVec2 = { x: 0, y: 0 };

      for (let s = 0; s < pts.length; s++) {
        const a = pts[s] as Vec2;
        const b = pts[(s + 1) % pts.length] as Vec2;
        const f = circleSegPushout(moved, r, { a, b }, clearance + otherShape.r);
        moved.x += f.x;
        moved.y += f.y;
        total.x += f.x;
        total.y += f.y;
      }

      element = total;
    }

    if (element.x * element.x + element.y * element.y > force.x * force.x + force.y * force.y)
      force = element;
  }

  return force;
}

/**
 * `VIA::PushoutForce( NODE*, const VECTOR2I& aDirection, VECTOR2I& aForce, int
 * aCollisionMask, int aMaxIterations )` (`pns_via.cpp:143-232`).
 *
 * Returns the accumulated force, or `null` for "could not place the via" —
 * which is the answer `buildInitialLine` turns into `aViaOk = false`.
 *
 * Three details carry the behaviour:
 *
 *  - the per-step force is clamped to a quarter of the via diameter
 *    (`:181`, upstream calls it *"another stupid heuristic"*), which stops the
 *    via jumping across a keepout in one frame;
 *  - past **half** the iteration budget, if the force is still over that
 *    threshold, the via is moved along the caller's `aDirection` lead vector
 *    instead of along the collision normal (`:187-199`) — the barycentric force
 *    can point into a dead end, and the lead vector usually points back towards
 *    the cursor;
 *  - a collision that yields a *zero* MTV is a hard failure, not a "no
 *    collision" (`:168-175`).
 */
export function viaPushoutForce(
  aNode: PnsNode,
  aVia: PnsVia,
  aDirection: Vec2,
  aCollisionMask: number,
  aMaxIterations: number,
): MutVec2 | null {
  let iter = 0;
  const mv = aVia.clone() as PnsVia;
  let pos: MutVec2 = { x: aVia.pos().x, y: aVia.pos().y };
  const totalForce: MutVec2 = { x: 0, y: 0 };

  while (iter < aMaxIterations) {
    mv.setPos(pos);

    const obs = aNode.checkColliding(mv, {
      limitCount: 1,
      kindMask: aCollisionMask,
      useClearanceEpsilon: false,
    });

    if (!obs || !obs.item) break;

    const force = viaObstaclePushout(aNode, mv, pos, obs.item);
    const collFound = force.x !== 0 || force.y !== 0;

    if (!collFound) {
      // It happens, rarely, that a collision is reported but the MTV is zero.
      // Upstream assumes force propagation has failed rather than that the via
      // is clear.
      return null;
    }

    const threshold = Math.trunc(aVia.diameter(aVia.layers().start()) / 4);
    const forceMag = Math.hypot(force.x, force.y);

    if (iter > aMaxIterations / 2 && forceMag > threshold) {
      const l = resize(aDirection, threshold);
      totalForce.x += l.x;
      totalForce.y += l.y;
      pos = { x: pos.x + l.x, y: pos.y + l.y };
    } else {
      const applied = forceMag > threshold ? resize(force, threshold) : force;
      totalForce.x += applied.x;
      totalForce.y += applied.y;
      pos = { x: pos.x + applied.x, y: pos.y + applied.y };
    }

    iter++;
  }

  if (iter === aMaxIterations) return null;

  return totalForce;
}

// =============================================================================
// LINE_PLACER
// =============================================================================

export class PnsLinePlacer {
  private mRouter: PnsRouterLike;

  private mDirection: Direction45 = Direction45.UNDEFINED;
  private mInitialDirection: Direction45 = Direction45.of(0 as never);

  private mHead = new PnsLine();
  private mTail = new PnsLine();

  private mWorld: PnsNode | null = null;
  private mPStart: Vec2 = { x: 0, y: 0 };
  private mFixStart: Vec2 = { x: 0, y: 0 };
  private mLastPEnd: Vec2 | null = null;

  private mShove: PnsShoveLike | null = null;

  private mCurrentNode: PnsNode | null = null;
  private mLastNode: PnsNode | null = null;

  private mSizes = new PnsSizesSettings();
  private mPlacingVia = false;
  private mCurrentNet: NetHandle = null;
  private mCurrentLayer = 0;
  private mCurrentEnd: Vec2 = { x: 0, y: 0 };
  private mCurrentStart: Vec2 = { x: 0, y: 0 };
  private mCurrentTrace = new PnsLine();

  private mStartItem: PnsItem | null = null;
  private mEndItem: PnsItem | null = null;

  private mIdle = true;
  private mChainedPlacement = false;
  private mOrthoMode = false;
  private mPlacementCorrect = false;

  private mFixedTail = new PnsFixedTail();
  private mMouseTrailTracer = new PnsMouseTrailTracer();

  constructor(aRouter: PnsRouterLike) {
    this.mRouter = aRouter;
    this.mInitialDirection = Direction45.of(0); // DIRECTION_45::N
  }

  private settings(): RoutingSettings {
    return this.mRouter.settings();
  }

  // ----- accessors -------------------------------------------------------------

  head(): PnsLine {
    return this.mHead;
  }

  tail(): PnsLine {
    return this.mTail;
  }

  currentStart(): Vec2 {
    return this.mCurrentStart;
  }

  currentEnd(): Vec2 {
    return this.mCurrentEnd;
  }

  currentNets(): NetHandle[] {
    return [this.mCurrentNet];
  }

  currentLayer(): number {
    return this.mCurrentLayer;
  }

  isPlacingVia(): boolean {
    return this.mPlacingVia;
  }

  getModifiedNets(): NetHandle[] {
    return [this.mCurrentNet];
  }

  setOrthoMode(aOrthoMode: boolean): void {
    this.mOrthoMode = aOrthoMode;
  }

  /** Test seam: the posture solver. */
  mouseTrailTracer(): PnsMouseTrailTracer {
    return this.mMouseTrailTracer;
  }

  /** Test seam: `m_direction`, the direction the next head segment leaves in. */
  direction(): Direction45 {
    return this.mDirection;
  }

  /** Test seam: `m_p_start`, the head/tail seam. */
  pStart(): Vec2 {
    return this.mPStart;
  }

  /**
   * Test seam. Upstream keeps all of these private and so does this class; the
   * head/tail machinery is exactly the part whose thresholds and tie-breaks are
   * worth pinning individually, and pinning them only through `move()` would
   * mean a test that passes for reasons other than the one it names.
   *
   * @internal
   */
  internals() {
    return {
      splitHeadTail: (aNewLine: PnsLine, aOldTail: PnsLine) =>
        this.splitHeadTail(aNewLine, aOldTail),
      mergeHead: () => this.mergeHead(),
      handlePullback: () => this.handlePullback(),
      handleSelfIntersections: () => this.handleSelfIntersections(),
      reduceTail: (aEnd: Vec2) => this.reduceTail(aEnd),
      cursorDistMinimum: (aL: PnsLineChain, aCursor: Vec2, aThreshold: number) =>
        this.cursorDistMinimum(aL, aCursor, aThreshold),
      clipAndCheckCollisions: (
        aP: Vec2,
        aL: PnsLineChain,
        aState: { out: PnsLineChain; thresholdDist: number },
      ) => this.clipAndCheckCollisions(aP, aL, aState),
      buildInitialLine: (aP: Vec2, aHead: PnsLine, aMode: PnsMode, aForceNoVia = false) =>
        this.buildInitialLine(aP, aHead, aMode, aForceNoVia),
      rhMarkObstacles: (aP: Vec2) => this.rhMarkObstacles(aP),
      rhWalkOnly: (aP: Vec2) => this.rhWalkOnly(aP),
      optimizerEffortMask: () => this.optimizerEffortMask(),
      routeStep: (aP: Vec2) => this.routeStep(aP),
      updatePStart: (aTail: PnsLine) => this.updatePStart(aTail),
      setHead: (aLine: PnsLine) => {
        this.mHead = aLine;
      },
      setTail: (aLine: PnsLine) => {
        this.mTail = aLine;
      },
      setPStart: (aP: Vec2) => {
        this.mPStart = { ...aP };
      },
      setCurrentStart: (aP: Vec2) => {
        this.mCurrentStart = { ...aP };
      },
      setDirection: (aDir: Direction45) => {
        this.mDirection = aDir;
      },
      setInitialDirection: (aDir: Direction45) => {
        this.mInitialDirection = aDir;
      },
      setCurrentNode: (aNode: PnsNode | null) => {
        this.mCurrentNode = aNode;
        this.mWorld = this.mWorld ?? aNode;
      },
      setPlacingVia: (aOn: boolean) => {
        this.mPlacingVia = aOn;
      },
      setSizes: (aSizes: PnsSizesSettings) => {
        this.mSizes = aSizes;
      },
      setLastPEnd: (aP: Vec2 | null) => {
        this.mLastPEnd = aP;
      },
      lastPEnd: () => this.mLastPEnd,
      initialDirection: () => this.mInitialDirection,
      isChainedPlacement: () => this.mChainedPlacement,
      isIdle: () => this.mIdle,
      fixedTail: () => this.mFixedTail,
    };
  }

  /** `CurrentNode( aLoopsRemoved )` (`:1289-1295`). */
  currentNode(aLoopsRemoved = false): PnsNode | null {
    if (aLoopsRemoved && this.mLastNode) return this.mLastNode;

    return this.mCurrentNode;
  }

  private setWorld(aWorld: PnsNode | null): void {
    this.mWorld = aWorld;
  }

  // ----- Trace -----------------------------------------------------------------

  /**
   * `Trace()` (`:1244-1263`): tail ++ head.
   *
   * The `PointCount() > 2` guard on the simplify is deliberate and commented
   * upstream (`:1249-1251`): a trace that is nothing but a zero-length segment
   * must survive, because that is the *only* feedback the user gets when the
   * routing start itself violates DRC — the track width is too wide for the
   * space, say. `Simplify` would collapse it to a point and the user would see
   * nothing happen at all.
   */
  trace(): PnsLine {
    const l = this.mTail.cLine().clone();
    l.appendChain(this.mHead.cLine());

    if (l.pointCount() > 2) l.simplify();

    const tmp = this.mHead.clone();
    tmp.setShape(l);

    return tmp;
  }

  /**
   * `LINE_PLACER::Traces()` (`:1266-1270`) — `ITEM_SET( &m_currentTrace )`.
   *
   * A **set**, not the line, which is what `PLACEMENT_ALGO::Traces()` promises
   * and what every other placer and dragger in this directory returns. This one
   * handed back the bare `PnsLine` for as long as nothing called it through the
   * interface — `ROUTER::movePlacing` walks `Traces().CItems()` and died on the
   * first move of the first real route.
   */
  traces(): PnsItemSet {
    this.mCurrentTrace = this.trace();

    return new PnsItemSet(this.mCurrentTrace);
  }

  // ----- posture ---------------------------------------------------------------

  /**
   * `setInitialDirection` (`:106-112`).
   *
   * `m_direction` is only overwritten when the tail has **no segments**. Once
   * there is a tail, its last segment owns the direction and this call is
   * recorded for the *next* fresh line rather than applied now.
   */
  private setInitialDirection(aDirection: Direction45): void {
    this.mInitialDirection = aDirection;

    if (this.mTail.segmentCount() === 0) this.mDirection = aDirection;
  }

  /**
   * `FlipPosture()` (`:1273-1286`).
   *
   * The first half is upstream's fix for issue 12369: the placer may have
   * changed the route since the tracer last spoke, so the *current trace's*
   * first-segment direction is copied into the tracer before flipping.
   * Otherwise the flip is relative to a stale posture and the track appears to
   * jump two steps.
   */
  flipPosture(): void {
    if (!this.mMouseTrailTracer.isManuallyForced() && this.mCurrentTrace.segmentCount() > 0) {
      const s = this.mCurrentTrace.cLine().cSegment(0);
      this.mMouseTrailTracer.setDefaultDirections(
        Direction45.fromSeg(s.a, s.b),
        Direction45.UNDEFINED,
      );
    }

    this.mMouseTrailTracer.flipPosture();
  }

  // ----- head/tail surgery -----------------------------------------------------

  /**
   * `handleSelfIntersections()` (`:115-181`): if the head has crossed back over
   * the tail, cut the tail at the crossing and steer from there.
   *
   * Three exits before any geometry happens, and the third is the interesting
   * one: when the tail and the head both start at the same point the head is a
   * *completely new* trace, so the tail is thrown away wholesale and the
   * direction reset — not clipped.
   *
   * The chosen crossing is the one with the smallest `index_our`, i.e. the
   * earliest point along the **tail** (`Intersect` is called on the tail, so
   * "our" is the tail). The crossing at the seam itself is ignored.
   */
  private handleSelfIntersections(): boolean {
    const head = this.mHead.line();
    const tail = this.mTail.line();

    // If there is no tail, there is nothing to intersect with.
    if (tail.pointCount() < 2) return false;
    if (head.pointCount() < 2) return false;

    // Completely new head trace? Chop off the tail.
    const t0 = tail.cPoint(0);
    const h0 = head.cPoint(0);

    if (t0.x === h0.x && t0.y === h0.y) {
      this.mDirection = this.mInitialDirection;
      tail.clear();
      return true;
    }

    const ips = tail.intersect(head);

    if (ips.length === 0) return false;

    let n = Number.MAX_SAFE_INTEGER;
    let ipoint: Vec2 = { x: 0, y: 0 };

    for (const i of ips) {
      if (i.indexOur < n) {
        n = i.indexOur;
        ipoint = i.p;
      }
    }

    // Ignore the point where head and tail meet.
    const tLast = tail.cLastPoint();

    if ((ipoint.x === h0.x && ipoint.y === h0.y) || (ipoint.x === tLast.x && ipoint.y === tLast.y))
      return false;

    if (n < 2) {
      // On the first or second segment: just start routing from the beginning.
      this.mDirection = this.mInitialDirection;
      tail.clear();
      head.clear();

      return true;
    }

    // Clip to the last tail segment before the intersection and adopt its
    // direction.
    const last = tail.cSegment(n - 1);
    this.mDirection = Direction45.fromSeg(last.a, last.b);
    tail.remove(n, -1);

    return true;
  }

  /**
   * `handlePullback()` (`:184-264`): shrink the tail when the head doubles back
   * on it.
   *
   * Two upstream oddities are preserved verbatim:
   *
   *  - `pullback_1` is hard-wired `false` (`:224`); its real condition survives
   *    only as a comment. The live test is entirely `pullback_2` — the tail's
   *    last direction and the head's first form a right or acute angle.
   *  - the `n < 2` arm inside the pull-back (`:252-253`) is **unreachable**:
   *    `n === 0` and `n === 1` have already returned above, so only
   *    `removeShape(-1)` ever runs. It is kept because removing it would be an
   *    "improvement", and because the reader deserves to know it is dead rather
   *    than to wonder.
   *
   * `removeShape(-1)` and not `remove(-1, -1)`: pulling back over an arc must
   * drop the whole arc, not one of its polyline vertices.
   */
  private handlePullback(): boolean {
    const head = this.mHead.line();
    const tail = this.mTail.line();

    if (head.pointCount() < 2) return false;

    const n = tail.pointCount();

    if (n === 0) return false;

    if (n === 1) {
      tail.clear();
      return true;
    }

    const firstHead = head.isPtOnArc(0)
      ? directionOfArc(head, head.arcIndex(0))
      : Direction45.fromSeg(head.cSegment(0).a, head.cSegment(0).b);

    const lastSegIdx = tail.pointCount() - 2;

    const lastTail = tail.isPtOnArc(lastSegIdx)
      ? directionOfArc(tail, tail.arcIndex(lastSegIdx))
      : Direction45.fromSeg(tail.cSegment(lastSegIdx).a, tail.cSegment(lastSegIdx).b);

    const angle = firstHead.angle(lastTail);

    // Case 1 is upstream's, and upstream disabled it.
    const pullback1 = false;

    // Case 2: an acute or right tail/head corner is unroutable however we got
    // here; drop a tail segment and hope the next iteration is cleaner.
    const pullback2 = angle === AngleType.ANG_RIGHT || angle === AngleType.ANG_ACUTE;

    if (pullback1 || pullback2) {
      if (!tail.isArcSegment(lastSegIdx)) {
        const seg = tail.cSegment(lastSegIdx);
        this.mDirection = Direction45.fromSeg(seg.a, seg.b);
      } else {
        this.mDirection = directionOfArc(tail, tail.arcIndex(lastSegIdx));
      }

      // `n < 2` is unreachable here — see the docblock.
      if (n < 2) tail.clear();
      else tail.removeShape(-1);

      if (!tail.segmentCount()) this.mDirection = this.mInitialDirection;

      return true;
    }

    return false;
  }

  /**
   * `reduceTail( aEnd )` (`:267-328`): throw away a run of tail segments if a
   * direct trace from further back reaches the cursor without colliding.
   *
   * The loop walks **backwards** from the end of the tail and `break`s at the
   * first candidate that collides, so what survives is the deepest cut that is
   * still clean — the tail is shortened as much as the board allows, not as
   * little.
   *
   * The `DIRECTION_45( replacement.CSegment(0) ) == dir` test is what keeps the
   * cut honest: the replacement must *leave in the same direction* as the
   * segment it replaces, otherwise the join would be a new corner rather than a
   * shortening.
   *
   * `reducedLine` at `:316` is computed and discarded upstream; it is not
   * reproduced because it has no observable effect and, unlike the dead
   * branches above, cannot be misread as behaviour.
   */
  private reduceTail(aEnd: Vec2): boolean {
    const head = this.mHead.line();
    const tail = this.mTail.line();

    const n = tail.segmentCount();

    if (head.segmentCount() < 1) return false;

    // Don't attempt this for too short tails.
    if (n < 2) return false;

    let newDirection: Direction45 = Direction45.UNDEFINED;
    let reduceIndex = -1;

    for (let i = tail.segmentCount() - 1; i >= 0; i--) {
      const s = tail.cSegment(i);
      const dir = Direction45.fromSeg(s.a, s.b);

      const replacement = PnsLineChain.fromPoints(dir.buildInitialTrace(s.a, aEnd));

      if (replacement.segmentCount() < 1) continue;

      const tmp = PnsLine.fromBase(this.mTail, replacement);

      if (this.mCurrentNode?.checkColliding(tmp, PnsKind.ANY_T)) break;

      const r0 = replacement.cSegment(0);

      if (Direction45.fromSeg(r0.a, r0.b).equals(dir)) {
        newDirection = dir;
        reduceIndex = i;
      }
    }

    if (reduceIndex >= 0) {
      this.mDirection = newDirection;
      tail.remove(reduceIndex + 1, -1);
      head.clear();
      return true;
    }

    if (!tail.segmentCount()) this.mDirection = this.mInitialDirection;

    return false;
  }

  /**
   * `mergeHead()` (`:331-402`): promote the head into the tail.
   *
   * This is where a track stops being provisional, and the threshold is
   * `n_head < 3` **shapes** (`:346`) — not segments, not points. Until the head
   * is three shapes long none of it settles, which is exactly the behaviour a
   * user reads as "the last corner keeps following my mouse".
   *
   * The three other vetoes, in upstream's order: a discontinuity between the
   * tail's end and the head's start; any acute / 180° / undefined corner
   * *inside* the head; and an acute / 180° / undefined corner *at the join*.
   * A corner that cannot be routed must never be frozen into the tail, because
   * nothing downstream will ever revisit it.
   */
  private mergeHead(): boolean {
    const head = this.mHead.line();
    const tail = this.mTail.line();

    const forbiddenAngles = AngleType.ANG_ACUTE | AngleType.ANG_HALF_FULL | AngleType.ANG_UNDEFINED;

    head.simplify();
    tail.simplify();

    // `ShapeCount`, not `SegmentCount`. On an arc-free chain the two are
    // identically `pointCount - 1`, and every head this placer builds *is*
    // arc-free — `Direction45` emits no arcs in the two ported corner modes —
    // so swapping them is unobservable here and mutation testing cannot tell
    // them apart. The distinction is real the moment a head carries an arc (an
    // arc is one shape and many segments), which is what the rounded corner
    // modes would produce, so upstream's spelling is kept rather than the one
    // that happens to be equivalent today.
    const nHead = head.shapeCount();
    const nTail = tail.shapeCount();

    if (nHead < 3) return false;

    if (nTail) {
      const h0 = head.cPoint(0);
      const tLast = tail.cLastPoint();

      if (h0.x !== tLast.x || h0.y !== tLast.y) return false;
    }

    if (this.mHead.countCorners(forbiddenAngles) !== 0) return false;

    const dirHead = head.isPtOnArc(0)
      ? directionOfArc(head, head.arcIndex(0))
      : Direction45.fromSeg(head.cSegment(0).a, head.cSegment(0).b);

    if (nTail) {
      const lastSegIdx = tail.pointCount() - 2;

      const dirTail = tail.isPtOnArc(lastSegIdx)
        ? directionOfArc(tail, tail.arcIndex(lastSegIdx))
        : Direction45.fromSeg(tail.cSegment(-1).a, tail.cSegment(-1).b);

      if (dirHead.angle(dirTail) & forbiddenAngles) return false;
    }

    tail.appendChain(head);
    tail.simplify();

    const lastSegIdx = tail.pointCount() - 2;

    this.mDirection = tail.isArcSegment(lastSegIdx)
      ? directionOfArc(tail, tail.arcIndex(lastSegIdx))
      : Direction45.fromSeg(tail.cSegment(-1).a, tail.cSegment(-1).b);

    head.remove(0, -1);

    head.simplify();
    tail.simplify();

    return true;
  }

  /**
   * `optimizeTailHeadTransition()` (`:1049-1111`): two independent attempts to
   * tidy the join before `mergeHead` gets to freeze it.
   *
   * (a) `FANOUT_CLEANUP` over the whole trace. On success the *entire trace
   * becomes the head* and the tail is emptied — a fan-out cleanup rewrites the
   * pad exit, so nothing before it can be considered settled any more. Upstream
   * notes at `:1055` that this can override the posture setting, which is why it
   * is skipped when the user has forced a posture by hand.
   *
   * Ziro's optimizer has no `FANOUT_CLEANUP` pass, so this arm never fires here.
   * It is written out anyway: the arm's *effect on state* is the part a reader
   * needs, and when the pass lands it must be wired to exactly this.
   *
   * (b) a look-back merge over the last three tail segments plus the first two
   * head points. `threshold` is `min(tail.PointCount(), 4)` — four *points* for
   * three segments — and `end` is `min(2, head.PointCount() - 1)`.
   */
  private optimizeTailHeadTransition(): boolean {
    const linetmp = this.trace();

    if (
      !this.mMouseTrailTracer.isManuallyForced() &&
      optimizeLine(linetmp, PnsOptimizerEffort.FANOUT_CLEANUP, this.mCurrentNode)
    ) {
      if (linetmp.segmentCount() < 1) return false;

      this.mHead = linetmp;
      const s0 = linetmp.cLine().cSegment(0);
      this.mDirection = Direction45.fromSeg(s0.a, s0.b);
      this.mTail.line().clear();

      return true;
    }

    const head = this.mHead.line();
    const tail = this.mTail.line();

    const tailLookbackSegments = 3;
    const threshold = Math.min(tail.pointCount(), tailLookbackSegments + 1);

    if (tail.shapeCount() < 3) return false;

    // Assemble the last few tail segments with the beginning of the head.
    const optLine = tail.slice(-threshold, -1);

    const end = Math.min(2, head.pointCount() - 1);

    optLine.appendChain(head.slice(0, end));

    const newHead = PnsLine.fromBase(this.mTail, optLine);

    // ...and see if it could be made simpler by merging obtuse/collinear
    // segments. If so, replace the last `threshold` tail points and the head
    // with the optimized line.
    if (optimizeLine(newHead, PnsOptimizerEffort.MERGE_SEGMENTS, this.mCurrentNode)) {
      head.clear();
      tail.replace(-threshold, -1, newHead.cLine());
      tail.simplify();

      const s = newHead.cLine().cSegment(-1);
      this.mDirection = Direction45.fromSeg(s.a, s.b);

      return true;
    }

    return false;
  }

  /**
   * `updatePStart( tail )` (`:1113-1119`).
   *
   * The seam is derived, never stored authoritatively, and `routeStep` calls
   * this **twice** per iteration — once before `routeHead` and once after
   * (`:1153`, `:1172`) — because `routeHead` can hand back a different tail than
   * the one it was given.
   */
  private updatePStart(aTail: PnsLine): void {
    this.mPStart = aTail.cLine().pointCount()
      ? { ...aTail.cLine().cLastPoint() }
      : { ...this.mCurrentStart };
  }

  // ----- the hugging heuristic -------------------------------------------------

  /**
   * `clipAndCheckCollisions( aP, aL, aOut, thresholdDist )` (`:405-437`).
   *
   * Clip `aL` at `aP` and accept the prefix if it is both **longer than
   * `thresholdDist`** and collision-free. `thresholdDist` is an in/out
   * parameter — every acceptance raises it — which is the ratchet that lets
   * `cursorDistMinimum`'s fallback sweep keep the *longest* clean clip rather
   * than the first one it happens to find.
   *
   * The collision probe is built from `m_head` (its width, layer and net), not
   * from the line being clipped.
   */
  private clipAndCheckCollisions(
    aP: Vec2,
    aL: PnsLineChain,
    aState: { out: PnsLineChain; thresholdDist: number },
  ): boolean {
    const l = aL.clone();
    const idx = l.split(aP);

    if (idx < 0) return false;

    let rv = true;

    const l2 = l.slice(0, idx);
    const dist = l2.length();

    if (dist < aState.thresholdDist) rv = false;

    const ctest = PnsLine.fromBase(this.mHead, l2);

    if (this.mCurrentNode?.checkColliding(ctest, PnsKind.ANY_T)) rv = false;

    if (rv) {
      aState.out = l2;
      aState.thresholdDist = dist;
    }

    return rv;
  }

  /**
   * `cursorDistMinimum( aL, aCursor, lengthThreshold, aOut )` (`:440-557`):
   * where along a walked line should we stop, to sit as close to the cursor as
   * possible without going the whole way round?
   *
   * The candidate set is every segment start, every perpendicular foot that
   * falls strictly *inside* a segment, and one terminating point — the chain's
   * last point, or the far end of whichever segment first pushed the running
   * length past `lengthThreshold`.
   *
   * ### The dead local minimum
   *
   * Upstream computes a *local* minimum as well as a global one, thirty lines
   * of it, and then throws it away:
   *
   * ```cpp
   * // fixme: I didn't make my mind yet if local or global minimum feels better.
   * // I'm leaving both in the code, enabling the global one by default
   *     minPLoc = -1;                                            // :526
   * ```
   *
   * So `preferred` is *always* the global argmin. The local-minimum computation
   * is reproduced here because deleting it would quietly resolve a question
   * upstream has explicitly left open, and because a future reader comparing the
   * two files needs to find it.
   */
  private cursorDistMinimum(
    aL: PnsLineChain,
    aCursor: Vec2,
    aLengthThreshold: number,
  ): PnsLineChain | null {
    const dists: number[] = [];
    const pts: Vec2[] = [];

    if (aL.pointCount() === 0) return null;

    let lastP = aL.cLastPoint();
    let accumulatedDist = 0;

    for (let i = 0; i < aL.segmentCount(); i++) {
      const s = aL.cSegment(i);

      dists.push(Math.round(Math.hypot(aCursor.x - s.a.x, aCursor.y - s.a.y)));
      pts.push(s.a);

      const pn = segNearest(s, aCursor);

      if (!(pn.x === s.a.x && pn.y === s.a.y) && !(pn.x === s.b.x && pn.y === s.b.y)) {
        dists.push(Math.round(Math.hypot(pn.x - aCursor.x, pn.y - aCursor.y)));
        pts.push(pn);
      }

      accumulatedDist += segLength(s);

      if (accumulatedDist > aLengthThreshold) {
        lastP = s.b;
        break;
      }
    }

    dists.push(Math.round(Math.hypot(aCursor.x - lastP.x, aCursor.y - lastP.y)));
    pts.push(lastP);

    let minDistLoc = Number.MAX_SAFE_INTEGER;
    let minPLoc = -1;
    let minDistGlob = Number.MAX_SAFE_INTEGER;
    let minPGlob = -1;

    for (let i = 0; i < dists.length; i++) {
      const d = dists[i] as number;

      if (d < minDistGlob) {
        minDistGlob = d;
        minPGlob = i;
      }
    }

    if (dists.length >= 3) {
      // Note `- 3` and `<`: the final triple is never examined.
      for (let i = 0; i < dists.length - 3; i++) {
        if (
          (dists[i + 2] as number) > (dists[i + 1] as number) &&
          (dists[i] as number) > (dists[i + 1] as number)
        ) {
          const d = dists[i + 1] as number;

          if (d < minDistLoc) {
            minDistLoc = d;
            minPLoc = i + 1;
          }
        }
      }

      if ((dists[dists.length - 1] as number) < minDistLoc && minPLoc >= 0) {
        minDistLoc = dists[dists.length - 1] as number;
        minPLoc = dists.length - 1;
      }
    } else {
      // Too few points: just use the global.
      minDistLoc = minDistGlob;
      minPLoc = minPGlob;
    }

    // fixme (upstream's, verbatim): I didn't make my mind yet if local or global
    // minimum feels better. I'm leaving both in the code, enabling the global
    // one by default.
    minPLoc = -1;

    const preferred = minPLoc < 0 ? minPGlob : minPLoc;

    if (preferred < 0) return null;

    const state = { out: new PnsLineChain(), thresholdDist: 0 };

    if (this.clipAndCheckCollisions(pts[preferred] as Vec2, aL, state)) return state.out;

    // Fallback sweep. `thresholdDist` is *not* reset between candidates, so the
    // longest clean clip wins rather than the first.
    state.thresholdDist = 0;
    let ok = false;

    for (let i = 0; i < pts.length; i++) {
      ok = this.clipAndCheckCollisions(pts[i] as Vec2, aL, state) || ok;
    }

    return ok ? state.out : null;
  }

  // ----- the three modes -------------------------------------------------------

  /**
   * `rhWalkBase( aP, aWalkLine, aCollisionMask, aMode, aViaOk )` (`:560-745`) —
   * the real walkaround driver behind both walk and shove mode.
   *
   * ### Two thresholds, both derived from `WalkaroundHugLengthThreshold` (1.5)
   *
   * Let `L` be the length of the direct tail+head trace.
   *
   *  - **`3.0 × L`** (`hugThresholdLengthComplete`): a *complete* detour round
   *    everything is taken only if it comes in under this. Past it, going all
   *    the way round is judged worse than stopping short.
   *  - **`1.5 × L`** (`hugThresholdLength`): passed into `cursorDistMinimum` as
   *    the length past which it stops looking for a place to stop. This is the
   *    "hug" — follow the obstacle's edge as far as is useful and no further.
   *
   * ### Two tie-breaks, pointing opposite ways
   *
   * Choosing the *complete* detour uses `len_ccw < len_cw` (`:660`), so an exact
   * length tie goes to **CW**. Choosing the *hug* uses `distCw < distCcw`
   * (`:707`), so an exact distance tie goes to **CCW**. Both are upstream's and
   * they genuinely disagree.
   *
   * ### The round counter
   *
   * `buildInitialLine( walkP, l1, aMode, round == 0 )` is evaluated *before*
   * `round++` on the very next line (`:589-590`), so round 0 forces no via and
   * round 1 — reached only when placing one — allows it. `while( round < 2 &&
   * m_placingVia )` caps it at two.
   */
  private rhWalkBase(
    aP: Vec2,
    aCollisionMask: number,
    aMode: PnsMode,
  ): { walkLine: PnsLine; viaOk: boolean; ok: boolean } {
    const walkFull = this.mHead.clone();
    let l1 = this.mHead.clone();

    let walkP = { ...aP };
    let viaOk = false;
    let round = 0;

    do {
      l1 = this.mHead.clone();
      l1.clear();

      const built = this.buildInitialLine(walkP, l1, aMode, round === 0);
      viaOk = built.ok;
      l1 = built.line;
      round++;

      const initTrack = this.mTail.clone();
      initTrack.line().appendChain(l1.cLine());
      initTrack.line().simplify();

      const initialLength = initTrack.cLine().length();
      const hugThresholdLength = initialLength * this.settings().walkaroundHugLengthThreshold;
      const hugThresholdLengthComplete =
        2.0 * initialLength * this.settings().walkaroundHugLengthThreshold;

      const world = this.mCurrentNode;

      if (!world) return { walkLine: walkFull, viaOk, ok: false };

      const wr: PnsWalkResult = {
        cw: walkaroundRoute(
          world,
          initTrack,
          true,
          this.settings().walkaroundIterationLimit,
          aCollisionMask,
        ),
        ccw: walkaroundRoute(
          world,
          initTrack,
          false,
          this.settings().walkaroundIterationLimit,
          aCollisionMask,
        ),
      };

      let bestLine: PnsLine | null = null;

      let lenCw =
        wr.cw.status !== PnsWalkStatus.ST_STUCK
          ? wr.cw.line.cLine().length()
          : Number.MAX_SAFE_INTEGER;
      let lenCcw =
        wr.ccw.status !== PnsWalkStatus.ST_STUCK
          ? wr.ccw.line.cLine().length()
          : Number.MAX_SAFE_INTEGER;

      if (wr.cw.status === PnsWalkStatus.ST_DONE) {
        optimizeLine(wr.cw.line, PnsOptimizerEffort.MERGE_SEGMENTS, world);

        const split = this.splitHeadTail(wr.cw.line, this.mTail);

        if (split.ok) {
          optimizeLine(split.head, PnsOptimizerEffort.MERGE_SEGMENTS, world);
          wr.cw.line.setShape(split.tail.cLine());
          wr.cw.line.line().appendChain(split.head.cLine());
        }

        lenCw = wr.cw.line.cLine().length();
        bestLine = wr.cw.line;
      }

      if (wr.ccw.status === PnsWalkStatus.ST_DONE) {
        optimizeLine(wr.ccw.line, PnsOptimizerEffort.MERGE_SEGMENTS, world);

        const split = this.splitHeadTail(wr.ccw.line, this.mTail);

        if (split.ok) {
          optimizeLine(split.head, PnsOptimizerEffort.MERGE_SEGMENTS, world);
          wr.ccw.line.setShape(split.tail.cLine());
          wr.ccw.line.line().appendChain(split.head.cLine());
        }

        lenCcw = wr.ccw.line.cLine().length();

        // Strict `<`: a length tie keeps the clockwise route.
        if (lenCcw < lenCw) bestLine = wr.ccw.line;
      }

      const bestLength = lenCw < lenCcw ? lenCw : lenCcw;

      if (bestLength < hugThresholdLengthComplete && bestLine) {
        walkFull.setShape(bestLine.cLine().clone());
        walkP = { ...walkFull.cLine().cLastPoint() };
        continue;
      }

      let validCw = false;
      let validCcw = false;
      let distCcw = Number.MAX_SAFE_INTEGER;
      let distCw = Number.MAX_SAFE_INTEGER;
      let lCw: PnsLineChain | null = null;
      let lCcw: PnsLineChain | null = null;

      if (wr.cw.status !== PnsWalkStatus.ST_STUCK) {
        lCw = this.cursorDistMinimum(wr.cw.line.cLine(), aP, hugThresholdLength);
        validCw = lCw !== null;

        if (lCw)
          distCw = Math.round(Math.hypot(aP.x - lCw.cLastPoint().x, aP.y - lCw.cLastPoint().y));
      }

      if (wr.ccw.status !== PnsWalkStatus.ST_STUCK) {
        lCcw = this.cursorDistMinimum(wr.ccw.line.cLine(), aP, hugThresholdLength);
        validCcw = lCcw !== null;

        if (lCcw)
          distCcw = Math.round(Math.hypot(aP.x - lCcw.cLastPoint().x, aP.y - lCcw.cLastPoint().y));
      }

      // Strict `<` again, but now the *other* way round: a distance tie keeps
      // the counter-clockwise route.
      if (distCw < distCcw && validCw && lCw) {
        walkFull.setShape(lCw);
        walkP = { ...lCw.cLastPoint() };
      } else if (validCcw && lCcw) {
        walkFull.setShape(lCcw);
        walkP = { ...lCcw.cLastPoint() };
      } else {
        return { walkLine: walkFull, viaOk, ok: false };
      }
    } while (round < 2 && this.mPlacingVia);

    if (l1.endsWithVia()) {
      const v = l1.via().clone() as PnsVia;
      v.setPos(walkFull.cLine().cLastPoint());
      walkFull.appendVia(v);
    }

    return { walkLine: walkFull, viaOk, ok: !walkFull.endsWithVia() || viaOk };
  }

  /**
   * `splitHeadTail( aNewLine, aOldTail, aNewHead, aNewTail )` (`:871-929`):
   * re-derive the head/tail seam from a line that was walked as a whole.
   *
   * The comment that justifies walking the whole thing is at `:786-798` and is
   * worth restating because it is the reason this function exists at all: with
   * the clearance epsilon in play, a head walked *on its own* can come back
   * reporting no collision while its first point sits inside a hull that has
   * not been processed yet. The algorithm requires `head[0]` to be outside every
   * hull. So the tail and head are walked together and the seam is put back
   * afterwards, as close to the old one as possible but never inside an
   * obstacle. Upstream's own summary: *"asinine heuristic to make the router get
   * stuck much less often."*
   *
   * Two things a reader will misjudge:
   *
   *  - the new head is built from the **old tail** and then cleared. That is how
   *    it inherits width, layer and net — not from `aNewLine`.
   *  - the seam index `i` is the first old-tail point *missing* from the new
   *    line; if none is missing, it is decremented to the last agreed point.
   *    The two slices then **share** point `i`, which is what makes `Trace()`'s
   *    plain append correct.
   *
   * It never returns false, though all four call sites test it (`:630`, `:650`,
   * `:800`, `:1011`). The always-true return is reproduced.
   */
  private splitHeadTail(
    aNewLine: PnsLine,
    aOldTail: PnsLine,
  ): { head: PnsLine; tail: PnsLine; ok: boolean } {
    const newTail = aOldTail.clone();
    const newHead = aOldTail.clone();
    const l2 = aNewLine.clone();

    newTail.removeVia();
    newHead.clear();

    let i = 0;
    let found = false;
    const n = l2.pointCount();

    if (n > 1 && aOldTail.pointCount() > 1) {
      if (l2.cLine().pointOnEdge(aOldTail.cLine().cLastPoint()))
        l2.line().split(aOldTail.cLine().cLastPoint());

      for (i = 0; i < aOldTail.pointCount(); i++) {
        if (l2.cLine().find(aOldTail.cLine().cPoint(i)) < 0) {
          found = true;
          break;
        }
      }

      if (!found) i--;

      // If the old tail doesn't have any points of the new line, we can't split.
      if (i >= l2.pointCount()) i = l2.pointCount() - 1;

      newHead.clear();

      if (i === 0) newTail.clear();
      else newTail.setShape(l2.cLine().slice(0, i));

      newHead.setShape(l2.cLine().slice(i, -1));

      return { head: newHead, tail: newTail, ok: true };
    }

    // The short arm is `newHead = std::move( l2 )` — the *whole* line, its
    // width, layers, net and via included. It is not a re-shape of the
    // old-tail copy, and the difference shows the moment the walked line
    // carries a via.
    newTail.clear();

    return { head: l2, tail: newTail, ok: true };
  }

  /**
   * `rhMarkObstacles( aP, aNewHead, aNewTail )` (`:819-868`) — the snapping mode.
   *
   * Mark-obstacles does not route around anything; it lets the user place a
   * violating track and highlights the violation. Its one piece of assistance is
   * this snap: if the head runs into something, offer the nearest point on that
   * obstacle's hull, so a user can lay track *exactly* at clearance without
   * turning on walk or shove.
   *
   * ### The snapping threshold
   *
   * ```cpp
   * if( ( nearest - aP ).EuclideanNorm() < m_head.Width() / 2 )    // :843
   * ```
   *
   * **Half the track width.** Not a clearance, not a layer-dependent quantity,
   * not configurable. Integer division, so an odd width rounds *down*; strict
   * `<`, so a point exactly half a width away does not snap. Widening it makes
   * the cursor feel magnetic across the whole board; narrowing it makes the snap
   * unreachable in practice.
   *
   * Two further details that differ from every other clearance query in the
   * class: `getClearance(..., false)` turns the epsilon **off** (`:831`), and
   * the hull is fetched with the head's width as its walkaround thickness
   * (`:833`) where `NODE::nearestObstacle` uses `0` — so the hull snapped to is
   * deliberately fatter than the one the obstacle search used.
   *
   * In a 90°-corner mode the snap target is the hull's **bounding box**, not the
   * hull.
   *
   * The mode never fails and never touches the tail — which, combined with
   * `followMouse()` being false in this mode, is why mark-obstacles routing is a
   * single rubber band from the start point to the cursor.
   */
  private rhMarkObstacles(aP: Vec2): { head: PnsLine; tail: PnsLine; ok: boolean } {
    const built = this.buildInitialLine(aP, this.mHead, PnsMode.RM_MarkObstacles);
    this.mHead = built.line;

    const obs = this.mCurrentNode?.nearestObstacle(this.mHead) ?? null;

    if (obs?.item && this.mCurrentNode) {
      const clearance = this.mCurrentNode.getClearance(obs.item, this.mHead, false);
      const resolver = this.mCurrentNode.getRuleResolver();
      const hull =
        resolver?.hullCache?.(obs.item, clearance, this.mHead.width(), this.mHead.layer()) ??
        itemHull(obs.item, clearance, this.mHead.width(), this.mHead.layer());

      const hullChain = PnsLineChain.fromPoints(hull);
      hullChain.setClosed(true);

      const cornerMode = this.settings().cornerMode;
      const nearest = isCornerMode90(cornerMode)
        ? bboxNearestPoint(hullChain.bbox(), aP)
        : hullChain.nearestPoint(aP);

      if (Math.hypot(nearest.x - aP.x, nearest.y - aP.y) < Math.trunc(this.mHead.width() / 2)) {
        const snapped = this.buildInitialLine(nearest, this.mHead, PnsMode.RM_MarkObstacles);
        this.mHead = snapped.line;
      }
    }

    return { head: this.mHead, tail: this.mTail, ok: true };
  }

  /**
   * The optimizer effort mask shared by `rhWalkOnly` (`:758-778`) and
   * `rhShoveOnly` (`:976-998`), byte for byte the same in both.
   *
   * `SMART_PADS` is gated on three things at once: the setting, a **45°** corner
   * mode (upstream's comment: *"Smart Pads is incompatible with 90-degree mode
   * for now"*), and the user *not* having forced a posture by hand — rerouting a
   * pad exit would override the posture they just chose.
   */
  private optimizerEffortMask(): number {
    let effort = 0;

    switch (this.settings().optimizerEffort) {
      case PnsOptimizationEffort.OE_LOW:
        effort = 0;
        break;
      case PnsOptimizationEffort.OE_MEDIUM:
      case PnsOptimizationEffort.OE_FULL:
        effort = PnsOptimizerEffort.MERGE_SEGMENTS;
        break;
    }

    const cornerMode = this.settings().cornerMode;

    if (
      this.settings().smartPads &&
      (cornerMode === CornerMode.MITERED_45 || cornerMode === CornerMode.ROUNDED_45) &&
      !this.mMouseTrailTracer.isManuallyForced()
    ) {
      effort |= PnsOptimizerEffort.SMART_PADS;
    }

    return effort;
  }

  /** `rhWalkOnly( aP, aNewHead, aNewTail )` (`:748-816`). */
  private rhWalkOnly(aP: Vec2): { head: PnsLine; tail: PnsLine; ok: boolean } {
    const walk = this.rhWalkBase(aP, PnsKind.ANY_T, PnsMode.RM_Walkaround);

    if (!walk.ok) return { head: this.mHead, tail: this.mTail, ok: false };

    const effort = this.optimizerEffortMask();

    if (this.mCurrentNode?.checkColliding(walk.walkLine, PnsKind.ANY_T))
      return { head: this.mHead, tail: this.mTail, ok: false };

    const split = this.splitHeadTail(walk.walkLine, this.mTail);

    if (!split.ok) return { head: this.mHead, tail: this.mTail, ok: false };

    if (this.mPlacingVia && walk.viaOk)
      split.head.appendVia(this.makeVia(split.head.cLine().cLastPoint()));

    optimizeLine(split.head, effort, this.mCurrentNode);

    return { head: split.head, tail: split.tail, ok: true };
  }

  /**
   * `rhShoveOnly( aP, aNewHead, aNewTail )` (`:932-1028`).
   *
   * Ported against {@link PnsShoveLike}; the engine itself is a sibling PR.
   *
   * The collision mask handed to `rhWalkBase` is **`SOLID_T`, not `ANY_T`**
   * (`:938`): shove mode walks around the things that cannot move — pads, board
   * edge — and leaves every track for the shove engine to push. Using `ANY_T`
   * here would make shove mode behave as walkaround mode that happens to own a
   * shove engine.
   *
   * `m_currentNode` is re-read from the engine **twice**, before and after
   * `Run()` (`:941`, `:974`), because the engine branches the world as it works
   * and the placer must talk to whatever it has arrived at.
   *
   * The failure path is not an error: `rhShoveOnly` falls back to
   * `rhWalkOnly` (`:1024`), so a shove that cannot be resolved degrades to a
   * walkaround rather than to nothing.
   */
  private rhShoveOnly(aP: Vec2): { head: PnsLine; tail: PnsLine; ok: boolean } {
    const walk = this.rhWalkBase(aP, PnsKind.SOLID_T, PnsMode.RM_Shove);

    if (!walk.ok) return { head: this.mHead, tail: this.mTail, ok: false };

    const shove = this.mShove;

    if (!shove) return this.rhWalkOnly(aP);

    this.mCurrentNode = shove.currentNode();

    if (this.mEndItem) {
      // Make sure the springback algorithm won't erase the NODE that owns
      // m_endItem.
      shove.setSpringbackDoNotTouchNode((this.mEndItem.owner() as PnsNode | null) ?? null);
    } else {
      // No end item under the cursor any more. Clear the DoNotTouchNode so
      // springback can roll back past frames pinned by an earlier obstacle
      // touch.
      shove.setSpringbackDoNotTouchNode(null);
    }

    let newHead = walk.walkLine.clone();

    if (this.mPlacingVia && walk.viaOk)
      newHead.appendVia(this.makeVia(newHead.cLine().cLastPoint()));

    shove.clearHeads();
    shove.addHeads(newHead, PnsShovePolicy.SHP_SHOVE);

    const shoveOk = shove.run() === PnsShoveStatus.SH_OK;

    this.mCurrentNode = shove.currentNode();

    const effort = this.optimizerEffortMask();

    if (shoveOk) {
      if (shove.headsModified()) newHead = shove.getModifiedHead(0);

      const split = this.splitHeadTail(newHead, this.mTail);

      if (!split.ok) return { head: this.mHead, tail: this.mTail, ok: false };

      if (newHead.endsWithVia()) split.head.appendVia(newHead.via());

      optimizeLine(split.head, effort, this.mCurrentNode);

      return { head: split.head, tail: split.tail, ok: true };
    }

    return this.rhWalkOnly(aP);
  }

  /** `routeHead( aP, aNewHead, aNewTail )` (`:1031-1046`). */
  private routeHead(aP: Vec2): { head: PnsLine; tail: PnsLine; ok: boolean } {
    switch (this.settings().routingMode) {
      case PnsMode.RM_MarkObstacles:
        return this.rhMarkObstacles(aP);
      case PnsMode.RM_Walkaround:
        return this.rhWalkOnly(aP);
      case PnsMode.RM_Shove:
        return this.rhShoveOnly(aP);
      default:
        return { head: this.mHead, tail: this.mTail, ok: false };
    }
  }

  // ----- the driver ------------------------------------------------------------

  /**
   * `routeStep( aP )` (`:1121-1230`).
   *
   * A loop whose bound `n_iter` is incremented *inside itself*: a
   * self-intersection or a pull-back each buy one extra pass, because both have
   * changed the tail out from under the head and the head must be re-derived.
   * There is no hard cap; upstream accepts that.
   *
   * The failure fallback is the piece most likely to be "cleaned up" by mistake:
   *
   * ```cpp
   * m_tail.Line().Append( m_p_start );
   * m_tail.Line().Append( m_p_start, true );      // :1166, allowDuplication
   * ```
   *
   * Two identical points, the second forced past `Append`'s duplicate guard, so
   * the tail is a deliberate **zero-length segment**. Upstream's comment
   * (`:1160-1162`) says why: if we cannot walk out of the start point, returning
   * an empty line looks to the user like the router has died, so return
   * something visible and prune it later. A single `Append` would leave a
   * one-point tail and no segment at all.
   *
   * `mergeHead` runs only when `optimizeTailHeadTransition` *failed* — the two
   * are alternatives, not a sequence — and both sit behind `followMouse()`,
   * which is false in mark-obstacles mode.
   */
  private routeStep(aP: Vec2): void {
    let fail = false;
    let goBack = false;
    let nIter = 1;

    for (let i = 0; i < nIter; i++) {
      // Copies, not references: `rhMarkObstacles` rewrites `m_head` in place,
      // so a reference would restore the object it had already changed.
      const prevTail = this.mTail.clone();
      const prevHead = this.mHead.clone();

      if (!goBack && pnsFollowMouse(this.settings())) this.reduceTail(aP);

      goBack = false;

      this.updatePStart(this.mTail);

      const routed = this.routeHead(aP);

      if (!routed.ok) {
        this.mTail = prevTail;
        this.mHead = prevHead;

        // If we fail to walk out of the initial point (no tail), return a
        // zero-length line rather than an empty one, so the user gets some
        // feedback that routing is happening. This gets pruned later.
        if (this.mTail.pointCount() === 0) {
          this.mTail.line().appendPoint(this.mPStart);
          this.mTail.line().appendPoint(this.mPStart, true);
        }

        fail = true;
      }

      this.updatePStart(this.mTail);

      if (fail) break;

      this.mHead = routed.head;
      this.mTail = routed.tail;

      if (this.handleSelfIntersections()) {
        nIter++;
        goBack = true;
      }

      if (!goBack && this.handlePullback()) {
        nIter++;
        this.mHead.clear();
        goBack = true;
      }
    }

    if (!fail && pnsFollowMouse(this.settings())) {
      if (!this.optimizeTailHeadTransition()) this.mergeHead();
    }

    this.mLastPEnd = { ...aP };
  }

  /** `route( aP )` (`:1233-1241`): did the head actually reach the cursor? */
  private route(aP: Vec2): boolean {
    this.routeStep(aP);

    if (!this.mHead.pointCount()) return false;

    const last = this.mHead.cLine().cLastPoint();

    return last.x === aP.x && last.y === aP.y;
  }

  // ----- via -------------------------------------------------------------------

  /**
   * `makeVia( aP )` (`:76-92`).
   *
   * A through via always spans the two outer copper layers in PNS numbering,
   * whatever the sizes settings say; anything else spans the settings' explicit
   * top and bottom. Upstream's `// fixme: should belong to KICAD_IFACE` at `:78`
   * is about the layer lookup, and is preserved as a fact about the design.
   */
  private makeVia(aP: Vec2): PnsVia {
    const iface = this.mRouter.getInterface();

    const start =
      this.mSizes.viaType() === 'through'
        ? iface.getPnsLayerFromBoardLayer('F.Cu')
        : this.mSizes.getLayerTop();
    const end =
      this.mSizes.viaType() === 'through'
        ? iface.getPnsLayerFromBoardLayer('B.Cu')
        : this.mSizes.getLayerBottom();

    return new PnsVia(
      aP,
      new PnsLayerRange(start, end),
      this.mSizes.viaDiameter(),
      this.mSizes.viaDrill(),
      null,
      this.mSizes.viaType(),
    );
  }

  /**
   * `ToggleVia( aEnabled )` (`:95-103`). Disabling removes the via from the head
   * **immediately** rather than waiting for the next route step, so the user
   * sees it go the moment they press the key. Always returns true.
   */
  toggleVia(aEnabled: boolean): boolean {
    this.mPlacingVia = aEnabled;

    if (!aEnabled) this.mHead.removeVia();

    return true;
  }

  /**
   * `buildInitialLine( aP, aHead, aMode, aForceNoVia )` (`:2049-2137`).
   *
   * ### Where posture enters the geometry, and where it does not
   *
   * ```cpp
   * if( !m_tail.PointCount() ) l = guessedDir.BuildInitialTrace( ... );   // :2078
   * else                       l = m_direction.BuildInitialTrace( ... );  // :2080
   * ```
   *
   * The posture solver only shapes the trace while there is **no tail**. Once a
   * tail exists, `m_direction` — maintained by pullback, merge and reduce — is
   * authoritative and the solver is ignored. But the via push-out branch at
   * `:2123` rebuilds the trace with `guessedDir` *regardless* of the tail. That
   * asymmetry is upstream's and is easy to lose in a tidy-up.
   *
   * ### Two attempts at pushing the via out
   *
   * The first uses the cursor relative to the routing start as its lead vector;
   * the second, only if a previous end point is remembered, uses the cursor
   * relative to *that* — the mouse's recent travel, which is a much better hint
   * when the user is dragging a via along a row of pads.
   *
   * Failing both is a genuine failure: it returns false, which becomes
   * `aViaOk = false` in `rhWalkBase`, which fails the whole route step if the
   * walked line ended up carrying a via.
   *
   * In `RM_MarkObstacles` the via is appended with **no collision handling at
   * all** (`:2104-2108`) — consistent with the mode's contract that the user is
   * responsible for what they place.
   */
  private buildInitialLine(
    aP: Vec2,
    aHead: PnsLine,
    aMode: PnsMode,
    aForceNoVia = false,
  ): { line: PnsLine; ok: boolean } {
    let l = new PnsLineChain();
    const guessedDir = this.mMouseTrailTracer.getPosture(aP);

    let cornerMode = this.settings().cornerMode;

    // Rounded corners don't make sense when routing orthogonally (single track
    // at a time).
    if (this.mOrthoMode) cornerMode = CornerMode.MITERED_45;

    const head = aHead;

    if (this.mPStart.x === aP.x && this.mPStart.y === aP.y) {
      l.clear();
    } else {
      if (
        this.settings().freeAngleMode &&
        this.settings().routingMode === PnsMode.RM_MarkObstacles
      ) {
        l = PnsLineChain.fromPoints([this.mPStart, aP]);
      } else {
        const dir = !this.mTail.pointCount() ? guessedDir : this.mDirection;
        l = PnsLineChain.fromPoints(dir.buildInitialTrace(this.mPStart, aP, false, cornerMode));
      }

      if (l.segmentCount() > 1 && this.mOrthoMode) {
        const newLast = segLineProject(l.cSegment(0), l.cLastPoint());

        l.remove(-1, -1);
        l.setPoint(1, newLast);
      }
    }

    head.setLayer(this.mCurrentLayer);
    head.setShape(l);

    if (!this.mPlacingVia || aForceNoVia) return { line: head, ok: true };

    const v = this.makeVia(aP);
    v.setNet(head.net());

    if (aMode === PnsMode.RM_MarkObstacles) {
      head.appendVia(v);
      return { line: head, ok: true };
    }

    const collMask = aMode === PnsMode.RM_Walkaround ? PnsKind.ANY_T : PnsKind.SOLID_T;
    const iterLimit = this.settings().viaForcePropIterationLimit;
    const world = this.mCurrentNode;

    for (let attempt = 0; attempt < 2; attempt++) {
      let lead = { x: aP.x - this.mPStart.x, y: aP.y - this.mPStart.y };

      if (attempt === 1 && this.mLastPEnd)
        lead = { x: aP.x - this.mLastPEnd.x, y: aP.y - this.mLastPEnd.y };

      const force = world ? viaPushoutForce(world, v, lead, collMask, iterLimit) : null;

      if (force) {
        const line = PnsLineChain.fromPoints(
          guessedDir.buildInitialTrace(
            this.mPStart,
            { x: aP.x + force.x, y: aP.y + force.y },
            false,
            cornerMode,
          ),
        );

        const out = PnsLine.fromBase(head, line);

        v.setPos({ x: v.pos().x + force.x, y: v.pos().y + force.y });
        out.appendVia(v);

        return { line: out, ok: true };
      }
    }

    return { line: head, ok: false }; // via placement unsuccessful
  }

  // ----- lifecycle -------------------------------------------------------------

  /**
   * `Start( aP, aStartItem )` (`:1391-1450`).
   *
   * ### Posture seeding, and an upstream bug preserved
   *
   * Landing on a **segment endpoint** seeds `lastSegDir` with that segment's
   * direction (reversed at the A end), so the new track continues in the same
   * direction; landing in the *middle* of a segment deliberately leaves it
   * undefined so the posture solver is not biased (`:1413-1415`).
   *
   * Landing on a **pad** computes `initialDir` from the pad's orientation
   * (`:1426-1428`) — and then never uses it. `SetDefaultDirections` at `:1437`
   * is passed `m_initial_direction`, not `initialDir`. Pad orientation therefore
   * does *not* bias the first segment, contrary to what the code appears to say.
   * The computation is reproduced, unused, so the bug is visible rather than
   * silently fixed.
   *
   * `SetTolerance( m_head.Width() )` — the posture solver's entire distance
   * scale *is* the track width.
   */
  start(aP: Vec2, aStartItem: PnsItem | null): boolean {
    this.mPlacementCorrect = false;
    this.mCurrentStart = { ...aP };
    this.mFixStart = { ...aP };
    this.mCurrentEnd = { ...aP };
    this.mCurrentNet = aStartItem
      ? aStartItem.net()
      : this.mRouter.getInterface().getOrphanedNetHandle();
    this.mStartItem = aStartItem;
    this.mPlacingVia = false;
    this.mChainedPlacement = false;
    this.mFixedTail.clear();
    this.mEndItem = null;

    this.setInitialDirection(pnsInitialDirection(this.settings()));

    this.initPlacement();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- upstream's
    // `initialDir` is computed and never used; see the docblock.
    let initialDir = this.mInitialDirection;
    let lastSegDir = Direction45.UNDEFINED;

    if (aStartItem && aStartItem.kind() === PnsKind.SEGMENT_T) {
      const seg = (aStartItem as PnsSegment).seg();

      if (aP.x === seg.a.x && aP.y === seg.a.y) lastSegDir = Direction45.fromSeg(seg.b, seg.a);
      else if (aP.x === seg.b.x && aP.y === seg.b.y) lastSegDir = Direction45.fromSeg(seg.a, seg.b);
    } else if (aStartItem && aStartItem.kind() === PnsKind.SOLID_T) {
      const orientation = solidOrientationDegrees(aStartItem);

      if (orientation !== null) {
        const angle = (orientation + 22.5) / 45.0;
        initialDir = Direction45.of(Math.trunc(angle));
      }
    }

    void initialDir;

    this.mMouseTrailTracer.clear();
    this.mMouseTrailTracer.addTrailPoint(aP);
    this.mMouseTrailTracer.setTolerance(this.mHead.width());
    this.mMouseTrailTracer.setDefaultDirections(this.mInitialDirection, Direction45.UNDEFINED);
    this.mMouseTrailTracer.setMouseDisabled(!this.settings().autoPosture);

    void lastSegDir;

    const n =
      this.settings().routingMode === PnsMode.RM_Shove && this.mShove
        ? this.mShove.currentNode()
        : this.mCurrentNode;

    this.mFixedTail.addStage(
      this.mFixStart,
      this.mCurrentLayer,
      this.mPlacingVia,
      this.mDirection,
      n,
    );

    return true;
  }

  /**
   * `initPlacement()` (`:1453-1490`).
   *
   * `world->KillChildren()` **before** `world->Branch()` is the reset: every
   * branch left over from a previous placement is destroyed first, so the new
   * root branch starts from a clean world rather than from whatever the last
   * shove left behind.
   */
  private initPlacement(): void {
    this.mIdle = false;

    this.mHead.line().clear();
    this.mTail.line().clear();
    this.mHead.setNet(this.mCurrentNet);
    this.mTail.setNet(this.mCurrentNet);
    this.mHead.setLayer(this.mCurrentLayer);
    this.mTail.setLayer(this.mCurrentLayer);
    this.mHead.setWidth(this.mSizes.trackWidth());
    this.mTail.setWidth(this.mSizes.trackWidth());
    this.mHead.removeVia();
    this.mTail.removeVia();

    this.mLastPEnd = null;
    this.mPStart = { ...this.mCurrentStart };
    this.mDirection = this.mInitialDirection;

    const world = this.mRouter.getWorld();

    world.killChildren();
    const rootNode = world.branch();

    this.splitAdjacentSegments(rootNode, this.mStartItem, this.mCurrentStart);

    this.setWorld(rootNode);

    this.mLastNode = null;
    this.mCurrentNode = this.mWorld;

    this.mShove = this.mWorld ? this.mRouter.makeShove(this.mWorld.branch()) : null;
  }

  /**
   * `Move( aP, aEndItem )` (`:1493-1563`).
   *
   * The collinear-endpoint snap at `:1527-1538` is worth reading twice: when the
   * finished trace's last segment is collinear with and overlapping the segment
   * under the cursor, the end point is moved onto that segment — but the point
   * chosen is `targetSeg.NearestPoint( lastSeg.A )`, the nearest point to the
   * last segment's **A end**, not to its endpoint. Reproduced as written.
   *
   * The via fallback at `:1516-1521` handles the case where the user presses V
   * without moving the mouse: the push-out lead vector is then zero and can
   * resolve nothing, so no via reaches the head and the commit silently drops
   * it. Force-attaching it here is what makes the key press stick.
   */
  move(aP: Vec2, aEndItem: PnsItem | null): boolean {
    let eiDepth = -1;

    if (aEndItem && aEndItem.owner()) eiDepth = (aEndItem.owner() as PnsNode).depth();

    this.mLastNode = null;
    this.mEndItem = aEndItem;

    const reachesEnd = this.route(aP);

    if (
      this.mPlacingVia &&
      aP.x === this.mPStart.x &&
      aP.y === this.mPStart.y &&
      !this.mHead.endsWithVia()
    ) {
      const fallbackVia = this.makeVia(aP);
      fallbackVia.setNet(this.mCurrentNet);
      this.mHead.appendVia(fallbackVia);
    }

    const current = this.trace();

    let splitPoint = current.pointCount()
      ? { ...current.cLine().cLastPoint() }
      : { ...this.mPStart };

    if (reachesEnd && aEndItem && current.segmentCount() && aEndItem.kind() === PnsKind.SEGMENT_T) {
      const lastSeg = current.cLine().cSegment(current.segmentCount() - 1);
      const targetSeg = (aEndItem as PnsSegment).seg();

      if (segsAreCollinear(lastSeg, targetSeg) && segsOverlap(targetSeg, lastSeg)) {
        splitPoint = segNearest(targetSeg, lastSeg.a);
        current.line().setPoint(current.pointCount() - 1, splitPoint);
        this.mHead.line().setPoint(this.mHead.pointCount() - 1, splitPoint);
      }
    }

    this.mCurrentEnd = current.pointCount() ? splitPoint : { ...this.mPStart };

    const latestNode = this.mCurrentNode;

    if (!latestNode) return true;

    this.mLastNode = latestNode.branch();

    if (
      reachesEnd &&
      eiDepth >= 0 &&
      aEndItem &&
      latestNode.depth() >= eiDepth &&
      current.segmentCount()
    ) {
      if (aEndItem.net() === this.mCurrentNet)
        this.splitAdjacentSegments(this.mLastNode, aEndItem, splitPoint);

      if (this.settings().removeLoops) this.removeLoops(this.mLastNode, current);
    }

    this.updateLeadingRatLine();
    this.mMouseTrailTracer.addTrailPoint(aP);

    return true;
  }

  /**
   * `SetLayer( aLayer )` (`:1358-1388`).
   *
   * Three ways to say yes and two to say no, and the interesting refusal is
   * `m_chainedPlacement` — set by `FixRoute` whenever the previous click did
   * *not* place a via. You cannot change layer mid-track without a via, so the
   * request is refused outright rather than silently placing one.
   *
   * The other refusal is starting on a segment: a track pins you to its layer.
   * A via or a pad does not, provided the requested layer is in its span.
   *
   * On success it does not merely record the layer: it resets the seam and the
   * direction, wipes both lines and the posture trail, and **re-runs `Move`** to
   * rebuild the trace on the new layer.
   */
  setLayer(aLayer: number): boolean {
    if (this.mIdle) {
      this.mCurrentLayer = aLayer;
      return true;
    }

    if (this.mChainedPlacement) return false;

    if (
      !this.mStartItem ||
      (this.mStartItem.kind() === PnsKind.VIA_T && this.mStartItem.layers().overlaps(aLayer)) ||
      (this.mStartItem.kind() === PnsKind.SOLID_T && this.mStartItem.layers().overlaps(aLayer))
    ) {
      this.mCurrentLayer = aLayer;
      this.mPStart = { ...this.mCurrentStart };
      this.mDirection = this.mInitialDirection;
      this.mMouseTrailTracer.clear();
      this.mHead.line().clear();
      this.mTail.line().clear();
      this.mHead.removeVia();
      this.mTail.removeVia();
      this.mHead.setLayer(this.mCurrentLayer);
      this.mTail.setLayer(this.mCurrentLayer);
      this.move(this.mCurrentEnd, null);
      return true;
    }

    return false;
  }

  /**
   * `FixRoute( aP, aEndItem, aForceFinish )` (`:1566-1767`) — commit what has
   * been drawn.
   *
   * ### `lastV`: how much of the trace is committed
   *
   * ```cpp
   * lastV = ( realEnd || m_placingVia || fixAll ) ? l.SegmentCount()
   *                                               : max( 1, l.SegmentCount() - 1 );
   * ```
   *
   * Without fix-all, the **last segment is deliberately left uncommitted**, so
   * the next click can still steer it. That single `- 1` is the difference
   * between "click to place corners" and "click to place segments".
   *
   * Any arc in the trace silently forces fix-all (`:1661-1662`), because
   * rollback does not work properly with partially-committed arcs.
   *
   * ### The DRC gate
   *
   * Collisions block a fix unless "allow DRC violations" is on — which, per
   * `ROUTING_SETTINGS`, is only ever true in mark-obstacles mode. In **shove**
   * mode only *solid* collisions block, because the shove node sometimes reports
   * collisions against the very objects it has just shoved (upstream's TODO at
   * `:1605-1606`).
   *
   * ### The empty-line branch
   *
   * A trace with no segments but with a via is the "place a stitching via and
   * stop" path: the via is cloned with a fresh uid, added, and the placement ends
   * successfully. Without a via, an empty trace commits nothing and returns
   * false.
   */
  fixRoute(aP: Vec2, aEndItem: PnsItem | null, aForceFinish: boolean): boolean {
    void aP;

    let fixAll = this.settings().fixAllSegments;
    let realEnd = false;

    const pl = this.trace();

    if (this.settings().routingMode === PnsMode.RM_MarkObstacles && aEndItem) {
      // The user has indicated a connection should be made. If either the trace
      // or the end item is net-less, allow it by adopting the other's net.
      const iface = this.mRouter.getInterface();

      if (iface.getNetCode(this.mCurrentNet) <= 0) {
        this.mCurrentNet = aEndItem.net();
        pl.setNet(this.mCurrentNet);
      } else if (iface.getNetCode(aEndItem.net()) <= 0) {
        aEndItem.setNet(this.mCurrentNet);
      }
    }

    if (!pnsAllowDrcViolations(this.settings())) {
      const checkNode =
        this.settings().routingMode === PnsMode.RM_Shove && this.mShove
          ? this.mShove.currentNode()
          : this.mWorld;

      const obs = checkNode?.checkColliding(pl, PnsKind.ANY_T) ?? null;

      if (obs?.item) {
        if (
          this.settings().routingMode !== PnsMode.RM_Shove ||
          obs.item.kind() === PnsKind.SOLID_T
        ) {
          return false;
        }
      }
    }

    const l = pl.cLine();

    if (!l.segmentCount()) {
      if (this.mLastNode) {
        // Do a final optimization to the stored state.
        const { added } = this.mLastNode.getUpdatedItems();
        const back = added[added.length - 1];

        if (back && back.kind() === PnsKind.SEGMENT_T)
          this.simplifyNewLine(this.mLastNode, back as PnsLinkedItem);
      }

      // Nothing to commit if we have an empty line.
      if (!pl.endsWithVia()) return false;

      if (this.mLastNode) {
        const newVia = pl.via().clone() as PnsVia;
        newVia.resetUid?.();
        this.mLastNode.addVia(newVia);
        this.mShove?.addLockedSpringbackNode(this.mLastNode);
      }

      this.mCurrentNode = null;
      this.mIdle = true;
      this.mPlacementCorrect = true;

      return true;
    }

    const pLast = l.cLastPoint();
    let pPreLast = pLast;

    if (l.pointCount() > 2) pPreLast = l.cPoint(l.pointCount() - 2);

    if (aEndItem && this.mCurrentNet && this.mCurrentNet === aEndItem.net()) realEnd = true;
    if (aForceFinish) realEnd = true;

    // Rollback doesn't work properly if fix-all isn't enabled and we are placing
    // arcs, so if we are, act as though we are in fix-all mode.
    if (!fixAll && l.arcCount()) fixAll = true;

    const lastDirSeg = !fixAll && l.segmentCount() > 1 ? l.cSegment(-2) : l.cSegment(-1);
    const dLast = Direction45.fromSeg(lastDirSeg.a, lastDirSeg.b);

    const lastV =
      realEnd || this.mPlacingVia || fixAll ? l.segmentCount() : Math.max(1, l.segmentCount() - 1);

    let lastItem: PnsLinkedItem | null = null;
    let lastArc = -1;

    for (let i = 0; i < lastV; i++) {
      const arcIndex = l.arcIndex(i);

      if (arcIndex < 0 || (lastArc >= 0 && i === lastV - 1 && !l.isPtOnArc(lastV))) {
        const seg = new PnsSegment(pl.cLine().cSegment(i), this.mCurrentNet);
        seg.setWidth(pl.width());
        seg.setLayer(this.mCurrentLayer);

        lastItem = seg;

        if (!this.mLastNode?.addSegment(seg)) lastItem = null;
      } else {
        if (arcIndex === lastArc) continue;

        const arc = new PnsArc(l.arc(arcIndex), this.mCurrentNet);
        arc.setWidth(pl.width());
        arc.setLayer(this.mCurrentLayer);

        lastItem = arc;

        if (!this.mLastNode?.addArc(arc)) lastItem = null;

        lastArc = arcIndex;
      }
    }

    if (pl.endsWithVia() && this.mLastNode) {
      const newVia = pl.via().clone() as PnsVia;
      newVia.resetUid?.();
      this.mLastNode.addVia(newVia);
    }

    if (lastItem && this.mLastNode) this.simplifyNewLine(this.mLastNode, lastItem);

    if (!realEnd) {
      this.setInitialDirection(dLast);
      this.mCurrentStart = this.mPlacingVia || fixAll ? { ...pLast } : { ...pPreLast };

      this.mFixedTail.addStage(
        this.mFixStart,
        this.mCurrentLayer,
        this.mPlacingVia,
        this.mDirection,
        this.mCurrentNode,
      );

      this.mFixStart = { ...this.mCurrentStart };
      this.mStartItem = null;
      this.mPlacingVia = false;
      this.mChainedPlacement = !pl.endsWithVia();

      this.mPStart = { ...this.mCurrentStart };
      this.mDirection = this.mInitialDirection;

      this.mHead.line().clear();
      this.mTail.line().clear();
      this.mHead.removeVia();
      this.mTail.removeVia();

      this.mCurrentNode = this.mLastNode;
      this.mLastNode = this.mLastNode?.branch() ?? null;

      if (this.mCurrentNode) this.mShove?.addLockedSpringbackNode(this.mCurrentNode);

      const lastSegDir = pl.endsWithVia() ? Direction45.UNDEFINED : dLast;

      this.mMouseTrailTracer.clear();
      this.mMouseTrailTracer.setTolerance(this.mHead.width());
      this.mMouseTrailTracer.addTrailPoint(this.mCurrentStart);
      this.mMouseTrailTracer.setDefaultDirections(lastSegDir, Direction45.UNDEFINED);

      this.mPlacementCorrect = true;
    } else {
      if (this.mLastNode) this.mShove?.addLockedSpringbackNode(this.mLastNode);
      this.mPlacementCorrect = true;
      this.mIdle = true;
    }

    return realEnd;
  }

  /**
   * `UnfixRoute()` (`:1770-1812`) — backspace while routing.
   *
   * Returns the head's *first* point, read before the head is cleared, so the
   * caller can put the cursor back where the un-fixed segment started. An empty
   * head returns nothing.
   *
   * The posture reset here passes `( m_initial_direction, m_direction )` — the
   * **opposite order** from `FixRoute`, which passes `( lastSegDir, UNDEFINED )`.
   * Un-fixing restores the direction we are backing *into* as the last-segment
   * hint; fixing sets it as the current posture. Both are deliberate.
   *
   * It does not call `SetTolerance`, so the tracer keeps whatever tolerance it
   * had.
   */
  unfixRoute(): Vec2 | null {
    const st = this.mFixedTail.popStage();

    if (!st) return null;

    let ret: Vec2 | null = null;

    if (this.mHead.line().pointCount()) ret = { ...this.mHead.line().cPoint(0) };

    const pt = st.pts[0] as PnsFixPoint;

    this.mHead.line().clear();
    this.mTail.line().clear();
    this.mStartItem = null;
    this.mPStart = { ...pt.p };
    this.mFixStart = { ...this.mPStart };
    this.mDirection = pt.direction;
    this.mPlacingVia = pt.placingVias;
    this.mCurrentNode = st.commit;
    this.mCurrentLayer = pt.layer;
    this.mCurrentStart = { ...this.mPStart };
    this.mHead.setLayer(this.mCurrentLayer);
    this.mTail.setLayer(this.mCurrentLayer);
    this.mHead.removeVia();
    this.mTail.removeVia();

    this.mMouseTrailTracer.clear();
    this.mMouseTrailTracer.setDefaultDirections(this.mInitialDirection, this.mDirection);
    this.mMouseTrailTracer.addTrailPoint(this.mPStart);

    if (this.mCurrentNode && this.mShove) {
      this.mShove.rewindSpringbackTo(this.mCurrentNode);
      this.mShove.unlockSpringbackNode(this.mCurrentNode);
    }

    if (this.settings().routingMode === PnsMode.RM_Shove && this.mShove) {
      this.mCurrentNode = this.mShove.currentNode();
      this.mCurrentNode.killChildren();
    }

    this.mLastNode = this.mCurrentNode?.branch() ?? null;

    return ret;
  }

  /** `HasPlacedAnything()` (`:1815-1818`). */
  hasPlacedAnything(): boolean {
    return this.mPlacementCorrect || this.mFixedTail.stageCount() > 1;
  }

  /** `CommitPlacement()` (`:1821-1836`). */
  commitPlacement(): boolean {
    if (this.settings().routingMode === PnsMode.RM_Shove && this.mShove) {
      this.mShove.rewindToLastLockedNode();
      this.mLastNode = this.mShove.currentNode();
      this.mLastNode.killChildren();
    }

    if (this.mLastNode) this.mRouter.commitRouting(this.mLastNode);

    this.mLastNode = null;
    this.mCurrentNode = null;

    return true;
  }

  /**
   * `AbortPlacement()` (`:2146-2151`).
   *
   * Note it does **not** set `m_idle`, so the placer is left mid-placement as
   * far as `SetLayer` and `UpdateSizes` are concerned. That is upstream's; the
   * router owns the idle flag on this path.
   */
  abortPlacement(): boolean {
    this.mWorld?.killChildren();
    this.mLastNode = null;

    return true;
  }

  /**
   * `UpdateSizes( aSizes )` (`:2006-2029`).
   *
   * The guard is the "don't silently renarrow a track you are continuing" rule:
   * the width only changes if the user picked one explicitly, or if nothing has
   * been placed yet *and* we did not start from an existing segment. Upstream's
   * comment (`:2012-2014`) adds the second reason — changing width after a
   * segment is fixed would mean going back to rip up track or accepting a DRC
   * error.
   */
  updateSizes(aSizes: PnsPlainSizes | PnsSizesSettings): void {
    // `ROUTER::UpdateSizes` passes `m_sizes`, which this port spells as a plain
    // object; `PLACEMENT_ALGO::UpdateSizes` upstream takes the one class there
    // is. This is the edge where the two meet — see `PnsSizesSettings.from`.
    this.mSizes = PnsSizesSettings.from(aSizes);

    if (!this.mIdle) {
      if (
        this.mSizes.trackWidthIsExplicit() ||
        (!this.hasPlacedAnything() &&
          (!this.mStartItem || this.mStartItem.kind() !== PnsKind.SEGMENT_T))
      ) {
        this.mHead.setWidth(this.mSizes.trackWidth());
        this.mTail.setWidth(this.mSizes.trackWidth());
        this.mCurrentTrace.setWidth(this.mSizes.trackWidth());
      }

      if (this.mHead.endsWithVia()) {
        this.mHead.via().setDiameter(PnsVia.ALL_LAYERS, this.mSizes.viaDiameter());
        this.mHead.via().setDrill(this.mSizes.viaDrill());
      }
    }
  }

  // ----- node post-processing --------------------------------------------------

  /**
   * `SplitAdjacentSegments( aNode, aSeg, aP )` (`:1298-1323`).
   *
   * The third guard is the one that matters: if a joint already exists at `aP`
   * with any links, there is nothing to split — the point is already a
   * connection. Splitting anyway would produce two coincident zero-length
   * halves.
   */
  splitAdjacentSegments(aNode: PnsNode | null, aSeg: PnsItem | null, aP: Vec2): boolean {
    if (!aNode || !aSeg) return false;
    if (aSeg.kind() !== PnsKind.SEGMENT_T) return false;

    const jt = aNode.findJointForItem(aP, aSeg);

    if (jt && jt.linkCount() >= 1) return false;

    const sOld = aSeg as PnsSegment;

    const sNew0 = sOld.clone() as PnsSegment;
    const sNew1 = sOld.clone() as PnsSegment;

    sNew0.setEnds(sOld.seg().a, aP);
    sNew1.setEnds(aP, sOld.seg().b);

    aNode.removeSegment(sOld);
    aNode.addSegment(sNew0, true);
    aNode.addSegment(sNew1, true);

    return true;
  }

  /**
   * `SplitAdjacentArcs( aNode, aArc, aP )` (`:1326-1355`). Same shape as
   * {@link splitAdjacentSegments}, over an arc's start/end/centre.
   */
  splitAdjacentArcs(aNode: PnsNode | null, aArc: PnsItem | null, aP: Vec2): boolean {
    if (!aNode || !aArc) return false;
    if (aArc.kind() !== PnsKind.ARC_T) return false;

    const jt = aNode.findJointForItem(aP, aArc);

    if (jt && jt.linkCount() >= 1) return false;

    const aOld = aArc as PnsArc;
    const oArc = aOld.arc();

    const aNew0 = aOld.clone() as PnsArc;
    const aNew1 = aOld.clone() as PnsArc;

    const centre = arcCenterI(oArc.p0, oArc.arcMid, oArc.p1);
    const clockwise = !arcIsCCW(oArc);

    aNew0.setArc({
      p0: oArc.p0,
      arcMid: arcMidFromStartEndCentre(oArc.p0, aP, centre, clockwise),
      p1: aP,
      width: oArc.width,
    });
    aNew1.setArc({
      p0: aP,
      arcMid: arcMidFromStartEndCentre(aP, oArc.p1, centre, clockwise),
      p1: oArc.p1,
      width: oArc.width,
    });

    aNode.removeArc(aOld);
    aNode.addArc(aNew0, true);
    aNode.addArc(aNew1, true);

    return true;
  }

  /**
   * `removeLoops( aNode, aLatest )` (`:1839-1902`): rip up any existing track
   * that runs between the same two joints as the one just drawn.
   *
   * The new line is **added to the node first** — that is not a convenience, it
   * is required: `AssembleLine` and `FindLinesBetweenJoints` work off the node's
   * joint graph, so the new track has to be in it before it can be asked what it
   * connects. It is removed again at the end.
   *
   * A closed loop (first point equals last) is left alone, and locked segments
   * are never removed.
   */
  removeLoops(aNode: PnsNode, aLatest: PnsLine): void {
    if (!aLatest.segmentCount()) return;

    const first = aLatest.cLine().cPoint(0);
    const last = aLatest.cLine().cLastPoint();

    if (first.x === last.x && first.y === last.y) return;

    const toErase = new Set<PnsLinkedItem>();

    aLatest.clearLinks();
    aNode.addLine(aLatest, true);

    for (let s = 0; s < aLatest.linkCount(); s++) {
      const seg = aLatest.getLink(s);

      if (!seg) continue;

      const ourLine = aNode.assembleLine(seg);
      let ends = aNode.findLineEnds(ourLine);

      if (ends.a === ends.b) ends = aNode.findLineEnds(aLatest);

      const lines = aNode.findLinesBetweenJoints(ends.a, ends.b);

      for (const line of lines) {
        if (!line.containsLink(seg) && line.segmentCount()) {
          // Don't remove locked tracks.
          let hasLockedSegment = false;

          for (const ss of line.links()) {
            if (ss.isLocked()) {
              hasLockedSegment = true;
              break;
            }
          }

          if (!hasLockedSegment) {
            for (const ss of line.links()) toErase.add(ss);
          }
        }
      }
    }

    for (const s of toErase) aNode.removeItem(s);

    aNode.removeLine(aLatest);
  }

  /**
   * `simplifyNewLine( aNode, aLatest )` (`:1905-2003`).
   *
   * Two phases, and the first exists only because of a blind spot in the second.
   *
   * **(a)** Collinear stubs hanging off a joint that is *not* a line corner are
   * removed by hand. Upstream's comment (`:1909-1911`): they prevent proper
   * assembly of the line and the optimizer will not clean them up. The test is
   * `refSeg.Contains(testSeg)` in either direction, with the *other* end of the
   * contained segment required to be a dead end (`LinkCount() === 1`) — so only
   * genuine stubs go, never a segment something else depends on.
   *
   * **(b)** Assemble the line and replace it if either the optimizer changed it
   * **or** `Simplify` changed its point count. The `||` is not redundancy: the
   * two passes catch different things, and upstream tests both.
   */
  simplifyNewLine(aNode: PnsNode, aLatest: PnsLinkedItem): void {
    const { added } = aNode.getUpdatedItems();
    const cleanup = new Set<PnsItem>();

    const processJoint = (
      aJoint: ReturnType<PnsNode['findJointForItem']>,
      aItem: PnsItem,
    ): void => {
      if (!aJoint || aJoint.isLineCorner()) return;

      const refSeg = (aItem as PnsSegment).seg();

      for (const neighbor of aJoint.cLinks().items()) {
        if (
          neighbor === aItem ||
          !(neighbor.kind() === PnsKind.SEGMENT_T || neighbor.kind() === PnsKind.ARC_T) ||
          !neighbor.layersOverlap(aItem)
        ) {
          continue;
        }

        if ((neighbor as PnsSegment).width() !== (aItem as PnsSegment).width()) continue;

        const testSeg = (neighbor as PnsSegment).seg();

        if (segContainsSeg(refSeg, testSeg)) {
          const nA = aNode.findJointForItem(neighbor.anchor(0), neighbor);
          const nB = aNode.findJointForItem(neighbor.anchor(1), neighbor);

          if (
            (nA === aJoint && nB?.linkCount() === 1) ||
            (nB === aJoint && nA?.linkCount() === 1)
          ) {
            cleanup.add(neighbor);
          }
        } else if (segContainsSeg(testSeg, refSeg)) {
          const aA = aNode.findJointForItem(aItem.anchor(0), aItem);
          const aB = aNode.findJointForItem(aItem.anchor(1), aItem);

          if (
            (aA === aJoint && aB?.linkCount() === 1) ||
            (aB === aJoint && aA?.linkCount() === 1)
          ) {
            cleanup.add(aItem);
            return;
          }
        }
      }
    };

    for (const item of added) {
      if (item.kind() !== PnsKind.SEGMENT_T || cleanup.has(item)) continue;

      const jA = aNode.findJointForItem(item.anchor(0), item);
      const jB = aNode.findJointForItem(item.anchor(1), item);

      processJoint(jA, item);
      processJoint(jB, item);
    }

    for (const seg of cleanup) aNode.removeItem(seg);

    // And now we can proceed with assembling the final line and optimizing it.
    const lOrig = aNode.assembleLine(aLatest, null, false, false, false);
    const l = lOrig.clone();

    const optimized = optimizeLine(l, PnsOptimizerEffort.MERGE_COLINEAR, aNode);

    const simplified = l.cLine().clone();
    simplified.simplify();

    if (optimized || simplified.pointCount() !== l.pointCount()) {
      aNode.removeLine(lOrig);
      l.setShape(simplified);
      aNode.addLine(l);
    }
  }

  /**
   * `updateLeadingRatLine()` (`:2032-2040`): draw the rats-nest line from the
   * end of the track to the nearest thing still unrouted on this net.
   *
   * `TOPOLOGY::LeadingRatLine` is not on Ziro's `PnsTopology`, so the geometry
   * cannot be computed here; the call site and its position in `Move` are
   * ported, and the display hook is optional on the router interface.
   */
  private updateLeadingRatLine(): void {
    const iface = this.mRouter.getInterface();

    if (!iface.displayRatline) return;

    const current = this.trace();

    void current;
  }
}

// ----- small geometric helpers, all upstream ------------------------------------

/** `DIRECTION_45( const SHAPE_ARC& )`: the direction of the arc's chord. */
function directionOfArc(aChain: PnsLineChain, aArcIndex: number): Direction45 {
  if (aArcIndex < 0 || aArcIndex >= aChain.arcCount()) return Direction45.UNDEFINED;

  const arc = aChain.arc(aArcIndex);

  return Direction45.fromSeg(arc.p0, arc.p1);
}

/** `SEG::Collinear( aSeg )`. */
function segsAreCollinear(aA: Seg, aB: Seg): boolean {
  return lineDistance(aA, aB.a) === 0 && lineDistance(aA, aB.b) === 0;
}

/** `SEG::Overlaps( aSeg )`: collinear and sharing more than a point. */
function segsOverlap(aA: Seg, aB: Seg): boolean {
  return segContains(aA, aB.a) || segContains(aA, aB.b) || segContains(aB, aA.a);
}

/** `SEG::Contains( const SEG& )`: both ends of the inner lie on the outer. */
function segContainsSeg(aOuter: Seg, aInner: Seg): boolean {
  return segContains(aOuter, aInner.a) && segContains(aOuter, aInner.b);
}

/**
 * `BOX2I::NearestPoint( aP )`: clamp into the box. `PnsLineChain::bbox` reports
 * origin-plus-size, so the far corner is `x + w`, `y + h`.
 */
function bboxNearestPoint(aBox: { x: number; y: number; w: number; h: number }, aP: Vec2): Vec2 {
  return {
    x: Math.max(aBox.x, Math.min(aBox.x + aBox.w, aP.x)),
    y: Math.max(aBox.y, Math.min(aBox.y + aBox.h, aP.y)),
  };
}

/**
 * `SHAPE_ARC::ConstructFromStartEndCenter`, reduced to the mid-point the chain
 * representation needs. The sweep runs from `aStart` to `aEnd` the short way
 * round in the requested direction, so a split arc keeps its parent's handedness.
 */
function arcMidFromStartEndCentre(
  aStart: Vec2,
  aEnd: Vec2,
  aCentre: Vec2,
  aClockwise: boolean,
): Vec2 {
  const r = Math.hypot(aStart.x - aCentre.x, aStart.y - aCentre.y);
  const a0 = Math.atan2(aStart.y - aCentre.y, aStart.x - aCentre.x);
  const a1 = Math.atan2(aEnd.y - aCentre.y, aEnd.x - aCentre.x);

  let delta = a1 - a0;

  if (aClockwise) {
    while (delta <= 0) delta += 2 * Math.PI;
  } else {
    while (delta >= 0) delta -= 2 * Math.PI;
  }

  const am = a0 + delta / 2;

  return {
    x: Math.round(aCentre.x + r * Math.cos(am)),
    y: Math.round(aCentre.y + r * Math.sin(am)),
  };
}

/**
 * `static_cast<SOLID*>( aStartItem )->GetOrientation().AsDegrees()`
 * (`:1426`). Optional on Ziro's `PnsSolid`; null when it has no orientation.
 */
function solidOrientationDegrees(aItem: PnsItem): number | null {
  const withOrientation = aItem as PnsItem & { orientationDegrees?: () => number };

  return withOrientation.orientationDegrees ? withOrientation.orientationDegrees() : null;
}
