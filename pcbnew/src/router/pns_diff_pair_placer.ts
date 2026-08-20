// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Interactive differential-pair routing: the thing that turns a cursor position
 * into two parallel tracks.
 * Counterpart: `pcbnew/router/pns_diff_pair_placer.{h,cpp}` (`DIFF_PAIR_PLACER`).
 *
 * `pns_diff_pair.ts` owns the *geometry* — where a pair may leave a pad, how two
 * gateways are joined, what counts as coupled. This owns the *session*: which
 * gateways to build for the current cursor, which world state to build them
 * against, what to do when the result collides, and what to hand the board when
 * the user clicks. The division is upstream's and it is a clean one: nothing in
 * `pns_diff_pair.ts` mentions `NODE`, and almost nothing here does geometry.
 *
 * ## The three-node dance
 *
 * There are never fewer than three `NODE`s alive during a placement, and mixing
 * them up is the classic way to break this class:
 *
 *  - `m_world` — a **branch** of the router's world, made once per placement
 *    segment by {@link PnsDiffPairPlacer.initPlacement}. Everything fixed so far
 *    lives here. Note the name is misleading: after `initPlacement` it is *not*
 *    the router's world.
 *  - `m_currentNode` — what collisions are checked against. In shove mode it is
 *    the shove engine's node and changes under you on every move.
 *  - `m_lastNode` — a branch of `m_currentNode` taken *after* routing, holding
 *    the head. It is what `CurrentNode()` hands out and what `FixRoute` commits.
 *
 * ## Upstream bugs reproduced here
 *
 * Four, each pinned by a test and each documented at its site:
 *
 *  1. {@link PnsDiffPairPlacer.tryWalkDp}'s `bestScore > 0.0` guard is true even
 *     when every walk attempt failed, so it returns success having replaced the
 *     pair with empty chains.
 *  2. {@link PnsDiffPairPlacer.routeHead} returns the **previous**
 *     `m_currentTraceOk` when the fit fails, not `false`, so a stale trace is
 *     reported as a live one.
 *  3. {@link PnsDiffPairPlacer.propagateDpHeadForces} accumulates a `totalForce`
 *     it never reads, and its `force` is a running maximum across iterations
 *     rather than a per-iteration value.
 *  4. `attemptWalk`'s `aWindCw` parameter is never used, so half of
 *     `tryWalkDp`'s four attempts are exact duplicates of the other half.
 *
 * ## What is declared here rather than ported
 *
 * `PLACEMENT_ALGO`, `ALGO_BASE` and `ROUTER` have no port. Rather than invent
 * them, this file declares the **minimum surface it calls** —
 * {@link DpPlacerHost} — and reproduces `PLACEMENT_ALGO`'s pure-virtual list as
 * ordinary public methods. `SIZES_SETTINGS` likewise becomes
 * {@link DpPlacerSizes}, a plain-data subset. None of the three is re-exported
 * from `pcbnew/src/index.ts`, because `LINE_PLACER` needs the same three and the
 * two ports must not race for the names.
 *
 * ## Reductions, named
 *
 *  - `WALKAROUND`'s class is not ported; `pns_walkaround.ts` is the hull-list
 *    form. {@link PnsDiffPairPlacer.attemptWalk} therefore fixes its hull set
 *    once per walk where upstream re-queries the node each iteration, so an
 *    obstacle that only the *detour* runs into is missed.
 *  - `SHAPE::Collide( …, VECTOR2I* aMTV )` has no port. The predicate and the
 *    magnitude come from the exact `collideShapes`; only the *direction* is
 *    reduced to nearest-point, exactly as `pns_shove.ts` reduces its own via
 *    pushout. See {@link pushoutForce}.
 *  - `TOPOLOGY::LeadingRatLine` needs board connectivity and is not ported;
 *    `updateLeadingRatLine` keeps its shape and calls an optional host hook.
 */
import { AngleType, CornerMode, Direction45 } from '@ziroeda/kimath/src/geometry/direction45.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import { segNearestPoint } from '@ziroeda/kimath/src/geometry/seg.js';
import { collideShapes } from '../drc/shape_collisions.js';
import { DiffPair, DpGateways, DpPrimitivePair } from './pns_diff_pair.js';
import { ObstacleSet } from './pns_collision.js';
import { PnsItemSet } from './pns_itemset.js';
import { PnsKind } from './pns_item.js';
import { PnsLayerRange } from './pns_layerset.js';
import { PNS_HULL_MARGIN, type PnsLine, PnsLineChain } from './pns_line_item.js';
import { PnsMode, pnsAllowDrcViolations } from './pns_routing_settings.js';
import { PnsShove, PnsShoveStatus } from './pns_shove.js';
import { PnsSegment } from './pns_segment.js';
import { PnsTopology } from './pns_topology.js';
import { PnsVia } from './pns_via.js';
import { cpoint, csegment, segmentCount, type Chain } from './pns_line.js';
import { itemHull } from './pns_item_hull.js';
import { optimizeDiffPair } from './pns_optimizer_diff_pair.js';
import { routeShortest } from './pns_walkaround.js';
import { segLineProject } from './pns_seg_ops.js';
import type { NetHandle } from './pns_collision.js';
import type { PnsArc } from './pns_arc.js';
import type { PnsItem } from './pns_item.js';
import type { PnsNode } from './pns_node.js';
import type { PnsShoveSettings } from './pns_shove.js';
import type { PnsViaType } from './pns_via.js';
import type { RoutingSettings } from './pns_routing_settings.js';
import type { Shape } from '../drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ---------------------------------------------------------------------------
// SIZES_SETTINGS, reduced to the members this placer reads.
//
// `pns_sizes_settings.ts` does not exist on `main`. Rather than create it — two
// concurrent ports inventing the same module is how the last merge conflict
// here happened — the ten members `DIFF_PAIR_PLACER` touches are declared as
// plain data and the two derived accessors as free functions.

/** The `PNS::SIZES_SETTINGS` members `DIFF_PAIR_PLACER` reads. */
export interface DpPlacerSizes {
  /** `DiffPairWidth()` — the width of each of the two tracks. */
  diffPairWidth: number;
  /** `DiffPairGap()` — the edge-to-edge gap between them. */
  diffPairGap: number;
  /** The raw `m_diffPairViaGap`; {@link diffPairViaGap} applies the flag. */
  diffPairViaGap: number;
  /** `DiffPairViaGapSameAsTraceGap()`. */
  diffPairViaGapSameAsTraceGap: boolean;
  /** `GetDiffPairHoleToHole()`. */
  diffPairHoleToHole: number;
  /** `GetDiffPairCopperToHole()`. */
  diffPairCopperToHole: number;
  viaDiameter: number;
  viaDrill: number;
  viaType: PnsViaType;
  /** `GetLayerTop()`. */
  layerTop: number;
  /** `GetLayerBottom()`. */
  layerBottom: number;
  /** `TrackWidthIsExplicit()`. */
  trackWidthIsExplicit: boolean;
}

/** `SIZES_SETTINGS::DiffPairViaGap()` — pns_sizes_settings.h:87. */
export function diffPairViaGap(aSizes: DpPlacerSizes): number {
  return aSizes.diffPairViaGapSameAsTraceGap ? aSizes.diffPairGap : aSizes.diffPairViaGap;
}

/**
 * `SIZES_SETTINGS::EffectiveDiffPairViaGap()` — pns_sizes_settings.h:146.
 *
 * Copper-to-copper is only one of three ways two diff-pair vias can be too
 * close; the other two are measured hole-to-hole and copper-to-hole, and both
 * have to be converted to a copper-to-copper equivalent by subtracting the
 * annular ring they do not include. The largest of the three wins.
 *
 * `annularRing` is C++ integer division, so it truncates toward zero rather
 * than flooring — which only differs for the nonsensical case of a drill wider
 * than the via.
 */
export function effectiveDiffPairViaGap(aSizes: DpPlacerSizes): number {
  const annularRing = Math.trunc((aSizes.viaDiameter - aSizes.viaDrill) / 2);

  return Math.max(
    diffPairViaGap(aSizes),
    aSizes.diffPairHoleToHole - 2 * annularRing,
    aSizes.diffPairCopperToHole - annularRing,
  );
}

/** A `SIZES_SETTINGS` with every member at its C++ default, for tests and seeds. */
export const DEFAULT_DP_PLACER_SIZES: DpPlacerSizes = {
  diffPairWidth: 0,
  diffPairGap: 0,
  diffPairViaGap: 0,
  diffPairViaGapSameAsTraceGap: false,
  diffPairHoleToHole: 0,
  diffPairCopperToHole: 0,
  viaDiameter: 0,
  viaDrill: 0,
  viaType: 'through',
  layerTop: 0,
  layerBottom: 0,
  trackWidthIsExplicit: false,
};

// ---------------------------------------------------------------------------
// ROUTER, reduced to the members ALGO_BASE and this placer reach through.

/**
 * The `PNS::ROUTER` surface `DIFF_PAIR_PLACER` uses.
 *
 * `Settings()` is `ALGO_BASE::Settings()`, which is `Router()->Settings()`;
 * `Router()->GetWorld()` is the board as the router sees it, *before* any
 * branching. The last two are the router interface's, i.e. the UI, and are
 * optional because the placer's arithmetic does not depend on them.
 */
export interface DpPlacerHost {
  /** `ROUTER::GetWorld()`. */
  world(): PnsNode;
  /** `ROUTER::Settings()`. */
  settings(): RoutingSettings;
  /** `ROUTER::SetFailureReason()`. */
  setFailureReason(aReason: string): void;
  /** `ROUTER::CommitRouting( NODE* )`. */
  commitRouting(aNode: PnsNode): boolean;
  /**
   * `TOPOLOGY::LeadingRatLine`, which is not ported — it needs
   * `NearestUnconnectedItem` and with it the board's connectivity. Supplying
   * this makes `updateLeadingRatLine` do something; omitting it makes the
   * method a no-op, which is all it ever was outside the UI.
   */
  leadingRatLine?(aNode: PnsNode | null, aTrack: PnsLine): Chain | null;
  /** `ROUTER_IFACE::DisplayRatline`. */
  displayRatline?(aLine: Chain, aNet: NetHandle): void;
}

/** `SHOVE`'s settings, projected out of `ROUTING_SETTINGS` as its ctor does. */
function shoveSettingsFrom(aSettings: RoutingSettings): PnsShoveSettings {
  return {
    shoveIterationLimit: aSettings.shoveIterationLimit,
    shoveTimeLimit: aSettings.shoveTimeLimit,
    shoveVias: aSettings.shoveVias,
    jumpOverObstacles: aSettings.jumpOverObstacles,
    walkaroundIterationLimit: aSettings.walkaroundIterationLimit,
    optimizerEffort: aSettings.optimizerEffort,
    smartPads: aSettings.smartPads,
    // `SHOVE` asks `GetCornerMode()` only to decide whether smart pads apply,
    // and only the two 45° modes enable them (pns_shove.cpp's `SMART_PADS`).
    cornerMode45:
      aSettings.cornerMode === CornerMode.MITERED_45 ||
      aSettings.cornerMode === CornerMode.ROUNDED_45,
  };
}

// ---------------------------------------------------------------------------
// The MTV reduction.

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const squaredNorm = (a: Vec2): number => a.x * a.x + a.y * a.y;

/**
 * The point of `aShape` nearest `aP`, ignoring the shape's own inflation `r`.
 *
 * Only the *direction* from this point to `aP` is used, and inflation is
 * radially symmetric about the skeleton, so dropping it changes nothing.
 *
 * An `arc` answers its centre rather than a point on the arc. Nothing a
 * `SOLID`, `VIA` or `SEGMENT` presents here is an arc — a routed arc is a
 * `stadium` — so this branch is unreachable from the placer today and is
 * written for total coverage rather than for correctness under load.
 */
function shapeNearestPoint(aShape: Shape, aP: Vec2): Vec2 {
  switch (aShape.kind) {
    case 'circle':
      return { ...aShape.c };

    case 'stadium':
      return segNearestPoint({ a: aShape.a, b: aShape.b }, aP);

    case 'arc':
      return { ...aShape.c };

    case 'poly': {
      let best: Vec2 = aShape.pts[0] ?? { x: 0, y: 0 };
      let bestD = Number.POSITIVE_INFINITY;

      for (let i = 0; i < aShape.pts.length; i++) {
        const a = aShape.pts[i] as Vec2;
        const b = aShape.pts[(i + 1) % aShape.pts.length] as Vec2;
        const q = segNearestPoint({ a, b }, aP);
        const d = squaredNorm(sub(aP, q));

        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }

      return best;
    }
  }
}

/**
 * `SHAPE::Collide( aOther, aClearance, VECTOR2I* aMTV )`, for the one case this
 * file needs: a circular virtual head against an arbitrary obstacle shape.
 *
 * There is no MTV anywhere in this port — `collideShapes` answers
 * `{collides, actual, location}` and `pns_shove.ts` met the same wall and
 * answered it with two nearest-point reductions of its own. This is the third,
 * and it is the least lossy of the three: the **decision** and the
 * **magnitude** both come from the exact `collideShapes` (`actual` is the
 * measured gap, so `clearance - actual` is precisely how far short it fell),
 * and only the **direction** is reduced to "away from the nearest point of the
 * obstacle". For a circle against a convex shape that direction is the true
 * MTV direction; for a concave polygon it can differ.
 *
 * Rounding is `Math.round` per component, matching `collideViaWithLine` in
 * `pns_shove.ts` rather than inventing a fourth convention.
 */
export function pushoutForce(
  aObstacle: Shape,
  aHead: Shape,
  aHeadPos: Vec2,
  aClearance: number,
): { collides: boolean; force: Vec2 } {
  const r = collideShapes(aObstacle, aHead, aClearance);

  // The boolean is reported separately from the vector because upstream's
  // `Collide` does: it returns true and writes `*aMTV` only then, and a
  // collision resolved by a zero-length translation — two shapes exactly at
  // the clearance — is still a collision. Folding the two together would make
  // `propagateDpHeadForces`' `collided |= …` mean something else.
  if (!r.collides) return { collides: false, force: { x: 0, y: 0 } };

  const push = aClearance - r.actual;

  if (push <= 0) return { collides: true, force: { x: 0, y: 0 } };

  const nearest = shapeNearestPoint(aObstacle, aHeadPos);
  const d = sub(aHeadPos, nearest);
  const dist = Math.sqrt(squaredNorm(d));

  // Degenerate: the head's centre is exactly on the obstacle's skeleton. Any
  // direction resolves it; `pns_shove.ts` picks +x in the same situation.
  if (dist === 0) return { collides: true, force: { x: push, y: 0 } };

  return {
    collides: true,
    force: { x: Math.round((d.x * push) / dist), y: Math.round((d.y * push) / dist) },
  };
}

// ---------------------------------------------------------------------------

/**
 * The point at which `aItem` is dangling, i.e. the end a pair could be started
 * or finished from.
 *
 * A track only has one if one of its two joints is unshared — a segment in the
 * middle of a run is not a place to start a pair from. **The `A` end is tested
 * first**, so a segment dangling at *both* ends answers `A`, which is what
 * makes the answer stable rather than dependent on which end the user clicked.
 *
 * Pads and vias always answer; a `LINE` answers its first point if it has one.
 * Everything else, including a `DIFF_PAIR`, answers nothing.
 */
export function getDanglingAnchor(aNode: PnsNode, aItem: PnsItem): Vec2 | null {
  switch (aItem.kind()) {
    case PnsKind.LINE_T: {
      const l = aItem as PnsLine;

      if (!l.pointCount()) return null;

      return { ...l.cPoint(0) };
    }

    case PnsKind.VIA_T:
    case PnsKind.SOLID_T:
      return { ...aItem.anchor(0) };

    case PnsKind.ARC_T: {
      const a = aItem as PnsArc;
      const jA = aNode.findJointForItem(aItem.anchor(0), aItem);
      const jB = aNode.findJointForItem(aItem.anchor(1), aItem);

      if (jA && jA.linkCount() === 1) return { ...a.arc().p0 };
      if (jB && jB.linkCount() === 1) return { ...a.arc().p1 };

      return null;
    }

    case PnsKind.SEGMENT_T: {
      const s = aItem as PnsSegment;
      const jA = aNode.findJointForItem(aItem.anchor(0), aItem);
      const jB = aNode.findJointForItem(aItem.anchor(1), aItem);

      if (jA && jA.linkCount() === 1) return { ...s.seg().a };
      if (jB && jB.linkCount() === 1) return { ...s.seg().b };

      return null;
    }

    default:
      return null;
  }
}

/**
 * `DIFF_PAIR`'s copy constructor and copy assignment, which it does not expose.
 *
 * Everything the two of them carry that a `SetShape` does not: the gap, the
 * width, the nets and the layers. `setGap` rebuilds the ±10000 IU constraint
 * band, which is what the *source* pair's band is too whenever it came through
 * `SetGap` rather than through the `DIFF_PAIR( aGap )` constructor — and every
 * pair this file copies did.
 *
 * `m_maxUncoupledLength` and `m_chamferLimit` are copied for completeness;
 * nothing in the placer reads either.
 */
function copyDiffPair(aDst: DiffPair, aSrc: DiffPair): void {
  aDst.setShapeFrom(aSrc);
  aDst.setGap(aSrc.gap());
  aDst.setWidth(aSrc.width());
  aDst.setViaGap(aSrc.viaGap());
  aDst.setMaxUncoupledLength(aSrc.maxUncoupledLength());
  aDst.setChamferLimit(aSrc.chamferLimit());
  aDst.setNets(aSrc.netP(), aSrc.netN());
  aDst.setLayers(aSrc.layers());
}

/** `FindDpPrimitivePair`'s two out-parameters. `pair` is null exactly on failure. */
export interface DpPrimitivePairSearch {
  pair: DpPrimitivePair | null;
  errorMsg: string | null;
}

/** The three failure messages, verbatim from `pns_diff_pair_placer.cpp:526-600`. */
export const DP_ERR_NO_COMPLEMENTARY_NET =
  'Unable to find complementary differential pair nets. Make sure the names of the nets ' +
  'belonging to a differential pair end with either N/P or +/-.';
export const DP_ERR_NO_STARTING_POINT =
  "Can't find a suitable starting point.  If starting from an existing differential pair " +
  'make sure you are at the end.';
export const dpErrNoCoupledStartingPoint = (aNetName: string): string =>
  `Can't find a suitable starting point for coupled net "${aNetName}".`;

/**
 * `DIFF_PAIR_PLACER::FindDpPrimitivePair`: given one half of a pair, find the
 * other half and orient the two so that P is P.
 *
 * The search is over *every* item on the coupled net, filtered to the same kind
 * as the reference and (for pads and vias) the same layer range, and scored by
 * plain distance between the two dangling anchors. That is deliberately weak:
 * it will happily pair a pad with the nearest pad of the coupled net even when
 * the two belong to different components.
 *
 * **`aP` is never read.** Upstream takes the cursor position and does nothing
 * with it — the anchor always comes from the item. Kept in the signature
 * because it is part of the public static's contract.
 *
 * Two details:
 *
 *  - the comparison is a strict `<`, so among equidistant candidates the first
 *    in iteration order wins. Upstream iterates a `std::set<ITEM*>` — heap
 *    addresses, i.e. arbitrary — where this iterates insertion order. The
 *    *choice between exact ties* is therefore ours; which item wins a strict
 *    contest is upstream's.
 *  - `refNet !== netP` decides the orientation, so `pair.primP()` is always on
 *    the P net regardless of which half the user grabbed.
 */
export function findDpPrimitivePair(
  aWorld: PnsNode,
  _aP: Vec2,
  aItem: PnsItem | null,
): DpPrimitivePairSearch {
  const resolver = aWorld.getRuleResolver();

  // A null item and a null resolver both mean "no pair". Upstream's
  // `DpNetPair` implementation opens with `if( !aItem || !aItem->Parent() )
  // return false`, so the null-item case *is* upstream's; a null resolver is a
  // segfault there and this message here.
  const nets = aItem && resolver ? resolver.dpNetPair(aItem) : null;

  if (!nets || !aItem) {
    return { pair: null, errorMsg: DP_ERR_NO_COMPLEMENTARY_NET };
  }

  const { netP, netN } = nets;
  const refNet = aItem.net();
  const coupledNet = refNet === netP ? netN : netP;

  const refAnchor = getDanglingAnchor(aWorld, aItem);

  if (!refAnchor) return { pair: null, errorMsg: DP_ERR_NO_STARTING_POINT };

  const primRef = aItem;
  const coupledItems = aWorld.allItemsInNet(coupledNet);

  let bestDist = Number.MAX_VALUE;
  let found: DpPrimitivePair | null = null;

  for (const item of coupledItems) {
    if (item.kind() !== aItem.kind()) continue;

    const anchor = getDanglingAnchor(aWorld, item);

    if (!anchor) continue;

    const dist = EuclideanNormI(sub(anchor, refAnchor));

    // A pad or via whose layer range differs is not the other half of a pair,
    // however close it is. Tracks are exempt: they are single-layer anyway.
    const shapeMatches = !(
      item.ofKind(PnsKind.SOLID_T | PnsKind.VIA_T) && !item.layers().equals(aItem.layers())
    );

    if (dist < bestDist && shapeMatches) {
      bestDist = dist;

      if (refNet !== netP) {
        found = DpPrimitivePair.fromItems(item, primRef);
        found.setAnchors(anchor, refAnchor);
      } else {
        found = DpPrimitivePair.fromItems(primRef, item);
        found.setAnchors(refAnchor, anchor);
      }
    }
  }

  if (!found) {
    return {
      pair: null,
      errorMsg: dpErrNoCoupledStartingPoint(resolver ? resolver.netName(coupledNet) : ''),
    };
  }

  return { pair: found, errorMsg: null };
}

/** `DIFF_PAIR_PLACER::State`. Declared, assigned once, and never read again. */
export enum DpPlacerState {
  RT_START = 0,
  RT_ROUTE = 1,
  RT_FINISH = 2,
}

/**
 * `PNS::DIFF_PAIR_PLACER`.
 *
 * The public method list is `PLACEMENT_ALGO`'s pure virtuals; there is no
 * abstract base here because none is ported (see the module note).
 */
export class PnsDiffPairPlacer {
  private readonly mHost: DpPlacerHost;

  /**
   * Upstream declares `m_state` and sets it to `RT_START` in the constructor.
   * Nothing ever reads or writes it again — grep the file. Ported so that the
   * absence is visibly deliberate rather than an omission.
   */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private mState: DpPlacerState = DpPlacerState.RT_START;

  private mChainedPlacement = false;
  private mInitialDiagonal = false;
  private mStartDiagonal = false;
  private mFitOk = false;

  private mNetP: NetHandle = null;
  private mNetN: NetHandle = null;

  private mStart: DpPrimitivePair | null = null;
  private mPrevPair: DpPrimitivePair | null = null;

  /** Dead upstream, like {@link mState}: initialised and never touched. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private mIteration = 0;

  private mWorld: PnsNode | null = null;

  /** Dead upstream. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private mPStart: Vec2 = { x: 0, y: 0 };

  private mShove: PnsShove | null = null;
  private mCurrentNode: PnsNode | null = null;
  private mLastNode: PnsNode | null = null;
  private mLastFixNode: PnsNode | null = null;

  private mSizes: DpPlacerSizes = { ...DEFAULT_DP_PLACER_SIZES };

  private mPlacingVia = false;

  /** Dead upstream: `UpdateSizes` does not maintain them. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private mViaDiameter = 0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private mViaDrill = 0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private mCurrentWidth = 0;

  private mCurrentLayer = 0;

  /** Dead upstream. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private mStartsOnVia = false;

  /** Written by `SetOrthoMode` and `initPlacement`; never read. Upstream's. */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: dead upstream too
  private mOrthoMode = false;

  private mSnapOnTarget = false;

  private mCurrentEnd: Vec2 = { x: 0, y: 0 };
  private mCurrentStart: Vec2 = { x: 0, y: 0 };
  private mCurrentTrace = new DiffPair();
  private mCurrentTraceOk = false;

  private mCurrentEndItem: PnsItem | null = null;

  private mIdle = true;
  private mHasFixedAnything = false;

  constructor(aHost: DpPlacerHost) {
    this.mHost = aHost;
  }

  // ----- ALGO_BASE ------------------------------------------------------------

  private settings(): RoutingSettings {
    return this.mHost.settings();
  }

  private setWorld(aWorld: PnsNode | null): void {
    this.mWorld = aWorld;
  }

  // ----- sizes ---------------------------------------------------------------

  /** `viaGap()`. */
  private viaGap(): number {
    return effectiveDiffPairViaGap(this.mSizes);
  }

  /**
   * `gap()` — **centre-to-centre**, not the DRC gap.
   *
   * `DP_GATEWAYS` is built with this, and `DIFF_PAIR::SetGap` is called with it
   * once and with the DRC gap (`DiffPairGap()`) once, in that order, inside
   * {@link routeHead}. Confusing the two shifts every gateway by half a track
   * width.
   */
  private gap(): number {
    return this.mSizes.diffPairGap + this.mSizes.diffPairWidth;
  }

  /** `makeVia()`. */
  private makeVia(aP: Vec2, aNet: NetHandle): PnsVia {
    const layers = new PnsLayerRange(this.mSizes.layerTop, this.mSizes.layerBottom);

    return new PnsVia(
      aP,
      layers,
      this.mSizes.viaDiameter,
      this.mSizes.viaDrill,
      aNet,
      this.mSizes.viaType,
    );
  }

  // ----- trivial accessors ----------------------------------------------------

  /** `SetOrthoMode`. The member it sets is never read; the re-`Move` is the effect. */
  setOrthoMode(aOrthoMode: boolean): void {
    this.mOrthoMode = aOrthoMode;

    if (!this.mIdle) this.move(this.mCurrentEnd, null);
  }

  /** `ToggleVia`. Always reports success, even when the re-route fails. */
  toggleVia(aEnabled: boolean): boolean {
    this.mPlacingVia = aEnabled;

    if (!this.mIdle) this.move(this.mCurrentEnd, null);

    return true;
  }

  isPlacingVia(): boolean {
    return this.mPlacingVia;
  }

  /** `FlipPosture`: swap which diagonal the first leg takes and re-route. */
  flipPosture(): void {
    this.mStartDiagonal = !this.mStartDiagonal;

    if (!this.mIdle) this.move(this.mCurrentEnd, null);
  }

  /** `Traces()`: the P line then the N line, as a one-member-per-lane set. */
  traces(): PnsItemSet {
    const t = new PnsItemSet();

    t.add(this.mCurrentTrace.pLine());
    t.add(this.mCurrentTrace.nLine());

    return t;
  }

  currentStart(): Vec2 {
    return this.mCurrentStart;
  }

  currentEnd(): Vec2 {
    return this.mCurrentEnd;
  }

  currentLayer(): number {
    return this.mCurrentLayer;
  }

  currentNets(): NetHandle[] {
    return [this.mNetP, this.mNetN];
  }

  getModifiedNets(aNets: NetHandle[]): void {
    aNets.push(this.mNetP);
    aNets.push(this.mNetN);
  }

  /** `CurrentNode( aLoopsRemoved )`. **The argument is ignored upstream.** */
  currentNode(_aLoopsRemoved = false): PnsNode | null {
    if (this.mLastNode) return this.mLastNode;

    return this.mCurrentNode;
  }

  /** `HasPlacedAnything`: an **or**, so a half-built pair counts. */
  hasPlacedAnything(): boolean {
    return segmentCount(this.mCurrentTrace.cP()) > 0 || segmentCount(this.mCurrentTrace.cN()) > 0;
  }

  /** The current pair, for tests and for the tools that draw it. */
  currentTrace(): DiffPair {
    return this.mCurrentTrace;
  }

  fitOk(): boolean {
    return this.mFitOk;
  }

  isIdle(): boolean {
    return this.mIdle;
  }

  /** Did the last `routeHead` land on a real target pair rather than the cursor? */
  snapOnTarget(): boolean {
    return this.mSnapOnTarget;
  }

  /**
   * `SetLayer`, four-way.
   *
   * The third arm is the interesting one: a placement in progress may change
   * layer only when it is *not* chained (i.e. the last fix ended the run) and
   * the previous pair either has no P primitive at all or ends on a via that
   * reaches the requested layer. A pair sitting on track ends cannot change
   * layer without a via, which is exactly what that test enforces.
   */
  setLayer(aLayer: number): boolean {
    if (this.mIdle) {
      this.mCurrentLayer = aLayer;
      return true;
    }

    if (this.mChainedPlacement || !this.mPrevPair) return false;

    const primP = this.mPrevPair.primP();

    if (!primP || (primP.ofKind(PnsKind.VIA_T) && primP.layers().overlaps(aLayer))) {
      this.mCurrentLayer = aLayer;
      this.mStart = this.mPrevPair.copy();
      this.initPlacement();
      this.move(this.mCurrentEnd, null);
      return true;
    }

    return false;
  }

  /**
   * `UpdateSizes`: change width, gap and via dimensions mid-route.
   *
   * The guard is upstream's and matches `LINE_PLACER`'s: when the width came
   * from a track already on the board rather than from an explicit choice, and
   * something has already been fixed in this run, the inherited diff-pair width
   * is kept instead of snapping back to the netclass default halfway through a
   * route.
   *
   * `m_viaDiameter`, `m_viaDrill` and `m_currentWidth` are **not** updated —
   * upstream does not, and nothing reads them.
   */
  updateSizes(aSizes: DpPlacerSizes): void {
    const prevDiffPairWidth = this.mSizes.diffPairWidth;

    this.mSizes = { ...aSizes };

    if (!this.mIdle) {
      if (!this.mSizes.trackWidthIsExplicit && this.mHasFixedAnything) {
        this.mSizes.diffPairWidth = prevDiffPairWidth;
      }

      this.mCurrentTrace.setWidth(this.mSizes.diffPairWidth);
      this.mCurrentTrace.setGap(this.mSizes.diffPairGap);

      if (this.mCurrentTrace.endsWithVias()) {
        this.mCurrentTrace.setViaDiameter(this.mSizes.viaDiameter);
        this.mCurrentTrace.setViaDrill(this.mSizes.viaDrill);
      }
    }
  }

  sizes(): DpPlacerSizes {
    return this.mSizes;
  }

  // ----- the session ----------------------------------------------------------

  /**
   * `Start`: latch on to the pair `aStartItem` belongs to and prepare to route.
   *
   * Everything that survives across the fixes of one run is reset here and
   * nowhere else — `m_currentTraceOk` in particular, which is why
   * {@link routeHead}'s stale-trace behaviour lasts for a whole run.
   */
  start(aP: Vec2, aStartItem: PnsItem | null): boolean {
    const p = { ...aP };

    this.setWorld(this.mHost.world());
    this.mCurrentNode = this.mWorld;

    const found = findDpPrimitivePair(this.mCurrentNode as PnsNode, aP, aStartItem);

    if (!found.pair) {
      this.mHost.setFailureReason(found.errorMsg ?? '');
      return false;
    }

    this.mStart = found.pair;

    this.mNetP = (this.mStart.primP() as PnsItem).net();
    this.mNetN = (this.mStart.primN() as PnsItem).net();

    this.mCurrentStart = p;
    this.mCurrentEnd = { ...p };
    this.mPlacingVia = false;
    this.mChainedPlacement = false;
    this.mHasFixedAnything = false;
    this.mCurrentTraceOk = false;
    this.mCurrentTrace = new DiffPair();
    this.mCurrentTrace.setNets(this.mNetP, this.mNetN);
    this.mLastFixNode = null;

    this.initPlacement();

    return true;
  }

  /**
   * `initPlacement`: start a fresh segment of the run against a fresh branch.
   *
   * Note what `m_world` becomes: the **branch**, not the router's world. Every
   * later `m_world` read in this class — `AbortPlacement`'s `KillChildren`, the
   * shove rebuilt in `FixRoute` — therefore means "everything fixed so far",
   * not "the board".
   */
  private initPlacement(): void {
    this.mIdle = false;
    this.mOrthoMode = false;
    this.mCurrentEndItem = null;
    this.mStartDiagonal = this.mInitialDiagonal;

    const world = this.mHost.world();

    world.killChildren();

    const rootNode = world.branch();

    this.setWorld(rootNode);

    this.mLastNode = null;
    this.mCurrentNode = rootNode;

    this.mShove = new PnsShove(this.mCurrentNode, shoveSettingsFrom(this.settings()));
  }

  /**
   * `routeHead`: build the entry and target gateways for the current cursor and
   * fit a pair between them. **This is the whole of the escape geometry.**
   *
   * Two gateway sets. The entry set always comes from the pair the route is
   * continuing — a pad pair, a via pair, or the two track ends of the last fix.
   * The target set is built one of two ways:
   *
   *  - the cursor is over a *real* pair (`FindDpPrimitivePair` succeeds): the
   *    target is that pair's gateways and `m_snapOnTarget` goes true, which is
   *    what tells `FixRoute` the route is finished;
   *  - otherwise the cursor is pushed out of any obstacle it is sitting in
   *    ({@link propagateDpHeadForces}) and the target is built around the
   *    result.
   *
   * In the second case one number decides whether the pair goes straight on or
   * turns: `lead_dist`, the distance from the corrected cursor to the extension
   * of the pair's current heading. Beyond half a `gap()` the pair is allowed to
   * turn and the target is built at the cursor; at or below it the target is
   * built at the *projection* and every gateway spread along the direction of
   * travel is filtered out, which keeps the two lanes side by side rather than
   * one behind the other. The comparison is a strict `>` on a truncating
   * division, so exactly-on-the-threshold keeps straight.
   *
   * ### The failure return is not `false`
   *
   * When `FitGateways` fails this returns `m_currentTraceOk` — the flag left by
   * the last *successful* fit — so from the second move onwards a failure is
   * reported as a success and `m_currentTrace` still holds the previous, now
   * stale, geometry. Upstream's; reproduced and pinned.
   */
  private routeHead(aP: Vec2): boolean {
    this.mFitOk = false;

    const gwsEntry = new DpGateways(this.gap());
    const gwsTarget = new DpGateways(this.gap());

    if (!this.mPrevPair) this.mPrevPair = this.mStart;

    const prevPair = this.mPrevPair as DpPrimitivePair;

    gwsEntry.buildFromPrimitivePair(prevPair, this.mStartDiagonal);

    const target = findDpPrimitivePair(this.mCurrentNode as PnsNode, aP, this.mCurrentEndItem).pair;

    if (target) {
      gwsTarget.buildFromPrimitivePair(target, this.mStartDiagonal);
      this.mSnapOnTarget = true;
    } else {
      const fp = this.propagateDpHeadForces(aP);

      if (!fp) return false;

      const { midpoint: midp, direction: dirV } = prevPair.cursorOrientation(fp);

      const fpProj = segLineProject({ a: midp, b: add(midp, dirV) }, fp);

      // The 'leader point' distance: how far the cursor is off the extension of
      // the starting segment pair.
      const leadDist = EuclideanNormI(sub(fpProj, fp));

      gwsTarget.setFitVias(this.mPlacingVia, this.mSizes.viaDiameter, this.viaGap());

      if (leadDist > Math.trunc((this.mSizes.diffPairGap + this.mSizes.diffPairWidth) / 2)) {
        // Far from the initial segment extension line -> allow a 45-degree
        // obtuse turn.
        gwsTarget.buildForCursor(fp);
      } else {
        // Close to it -> keep the straight part only, projected as close to the
        // cursor as possible.
        gwsTarget.buildForCursor(fpProj);
        gwsTarget.filterByOrientation(
          AngleType.ANG_STRAIGHT | AngleType.ANG_HALF_FULL,
          Direction45.fromVector(dirV),
        );
      }

      this.mSnapOnTarget = false;
    }

    this.mCurrentTrace.setGap(this.gap());
    this.mCurrentTrace.setLayer(this.mCurrentLayer);

    const result = gwsEntry.fitGateways(
      gwsEntry,
      gwsTarget,
      this.mStartDiagonal,
      this.mCurrentTrace,
    );

    if (result) {
      this.mCurrentTraceOk = true;
      this.mCurrentTrace.setNets(this.mNetP, this.mNetN);
      this.mCurrentTrace.setWidth(this.mSizes.diffPairWidth);
      this.mCurrentTrace.setGap(this.mSizes.diffPairGap);

      if (this.mPlacingVia) {
        const lastP = cpoint(this.mCurrentTrace.cP(), -1);
        const lastN = cpoint(this.mCurrentTrace.cN(), -1);

        this.mCurrentTrace.appendVias(
          this.makeVia(lastP, this.mNetP),
          this.makeVia(lastN, this.mNetN),
        );
      } else {
        this.mCurrentTrace.removeVias();
      }

      return true;
    }

    return this.mCurrentTraceOk;
  }

  /**
   * `propagateDpHeadForces`: nudge the cursor out of whatever it is sitting in.
   *
   * The head is modelled as a **virtual via** whose diameter is the pair's full
   * width — gap plus both tracks — because the pair as a whole is what has to
   * fit, not either lane. In via-placing mode the diameter is the via gap plus
   * two via diameters instead.
   *
   * Returns the corrected point, or null when the head could not be freed. In
   * highlight-collisions mode it returns the cursor untouched.
   *
   * ### Four upstream oddities, all load-bearing to the answer
   *
   *  1. `totalForce` is accumulated on every colliding iteration and **never
   *     read**. The answer is `aP + force`.
   *  2. `force` is declared *outside* the loop and never reset, so it is a
   *     running maximum over every iteration, and it survives an iteration in
   *     which nothing collided. `layerForce` *is* fresh each iteration.
   *  3. `collided` is fresh each iteration, so `succeeded` inspects only the
   *     last one — and an early break (nothing in the way, or an obstacle
   *     already handled) leaves it holding the previous iteration's value.
   *  4. the clearance is resolved between the obstacle and the pair's **P
   *     lane**, not between the obstacle and the virtual head. Upstream's
   *     comment above the loop says why: a via's resolved clearance to an item
   *     is not the diff pair's.
   *
   * `handled` means each obstacle contributes once, so the loop leaves long
   * before `maxIter` in every realistic case — which is also why `iter != maxIter`
   * almost always rescues a `collided` that was never cleared.
   */
  private propagateDpHeadForces(aP: Vec2): Vec2 | null {
    const virtHead = this.makeVia(aP, null);

    if (this.mPlacingVia) {
      virtHead.setDiameter(
        PnsVia.ALL_LAYERS,
        this.viaGap() + 2 * virtHead.diameter(PnsVia.ALL_LAYERS),
      );
    } else {
      virtHead.setLayer(this.mCurrentLayer);
      virtHead.setDiameter(
        PnsVia.ALL_LAYERS,
        this.mSizes.diffPairGap + 2 * this.mSizes.diffPairWidth,
      );
    }

    let solidsOnly = true;
    const mode = this.settings().routingMode;

    if (mode === PnsMode.RM_MarkObstacles) return { ...aP };

    if (mode === PnsMode.RM_Walkaround) solidsOnly = false;

    // fixme: I'm too lazy to do it well. Circular approximation will do for the
    // moment. (Upstream's comment; the code below is upstream's too.)
    const maxIter = 40;
    let iter = 0;
    let collided = false;
    let force: Vec2 = { x: 0, y: 0 };
    let totalForce: Vec2 = { x: 0, y: 0 };
    const handled = new Set<PnsItem>();

    const node = this.mCurrentNode as PnsNode;

    while (iter < maxIter) {
      const obs = node.checkColliding(virtHead, {
        kindMask: solidsOnly ? PnsKind.SOLID_T : PnsKind.ANY_T,
      });

      if (!obs?.item || handled.has(obs.item)) break;

      const clearance = node.getClearance(obs.item, this.mCurrentTrace.pLine(), false);

      // Fresh each iteration, and — like upstream's out-parameter — **not**
      // cleared between layers within one: `Collide` writes through the pointer
      // only when it returns true, so a layer that does not collide leaves the
      // previous layer's force standing to be compared against `force`.
      let layerForce: Vec2 = { x: 0, y: 0 };

      collided = false;

      for (const viaLayer of virtHead.relevantShapeLayers(obs.item)) {
        const obsShape = obs.item.shape(viaLayer);
        const headShape = virtHead.shape(viaLayer);

        if (!obsShape || !headShape) continue;

        const r = pushoutForce(obsShape, headShape, virtHead.pos(), clearance);

        collided ||= r.collides;

        // Unpinned: the virtual head is single-layer in every fixture, so
        // this loop runs once and "keep the previous layer's force" never
        // differs from "always assign".
        if (r.collides) layerForce = r.force;

        if (squaredNorm(layerForce) > squaredNorm(force)) force = layerForce;
      }

      if (collided) {
        totalForce = add(totalForce, force);
        virtHead.setPos(add(virtHead.pos(), force));
      }

      handled.add(obs.item);

      iter++;
    }

    // `totalForce` is dead here, upstream included. Referenced so the port does
    // not look like it dropped a statement.
    void totalForce;

    const succeeded = !collided || iter !== maxIter;

    // Unpinned: every fixture pushes the head off exactly one obstacle, where
    // `force` and `totalForce` are equal, so the upstream bug this reproduces
    // is documented rather than pinned.
    if (succeeded) return add(aP, force);

    return null;
  }

  /**
   * The hull of everything in `aNode` that `aLine` collides with.
   *
   * This is the reduction named in the module note. `WALKAROUND::singleStep`
   * re-queries the node on **every** iteration, so a detour that runs into a
   * fresh obstacle sees it; `routeShortest` takes a fixed hull list. The list
   * built here covers every obstacle the *straight* line meets, which is the
   * overwhelming majority of them.
   */
  private hullsFor(aNode: PnsNode, aLine: PnsLine, aSolidsOnly: boolean): Chain[] {
    const obstacles = new ObstacleSet();
    const opts = { kindMask: aSolidsOnly ? PnsKind.SOLID_T : PnsKind.ANY_T };
    const chain = aLine.cLine();

    // Segment by segment through a single scratch item, exactly as
    // `NODE::NearestObstacle` does: the spatial index takes a `SEGMENT`, not a
    // `LINE`, and the obstacle set de-duplicates an item found by two of them.
    const scratch =
      chain.segmentCount() > 0 ? PnsSegment.fromParentLine(aLine, chain.cSegment(0)) : null;

    for (let i = 0; i < chain.segmentCount(); i++) {
      const s = chain.cSegment(i);

      (scratch as PnsSegment).setEnds(s.a, s.b);
      aNode.queryColliding(scratch as PnsSegment, obstacles, opts);
    }

    const hulls: Chain[] = [];

    for (const obs of obstacles.items()) {
      if (!obs.item) continue;

      const clearance = aNode.getClearance(obs.item, aLine, false);

      hulls.push(itemHull(obs.item, clearance, aLine.width(), aLine.layer()));
    }

    return hulls;
  }

  /**
   * `attemptWalk`: walk one lane around the obstacles, shove the other lane out
   * of the way of the result, and repeat with the roles swapped.
   *
   * Alternating is the point. Walking both lanes independently gives two paths
   * that no longer run parallel; walking one and *shoving* the other with a
   * forced clearance of `gap - 2·PNS_HULL_MARGIN` keeps them coupled. The margin
   * subtraction is what lets the shoved lane sit exactly one gap away instead of
   * one gap plus the hull inflation.
   *
   * ### `aWindCw` is never used
   *
   * Upstream takes the parameter and does nothing with it — the winding is
   * decided inside `WALKAROUND` by the `WP_SHORTEST` policy. {@link tryWalkDp}
   * runs four attempts over `(pFirst, windCw)` and only `pFirst` can change the
   * outcome, so attempts 0/2 and 1/3 are identical work. Reproduced, parameter
   * and all, because removing it would silently change `tryWalkDp`'s attempt
   * count if upstream ever starts using it.
   *
   * ### The `continue` skips the iteration counter
   *
   * A lane with no collision flips `currentIsP` and `continue`s **without**
   * `iter++`, so the three-iteration budget is spent only on real work. The
   * loop still terminates: the `continue` is guarded by the *other* lane
   * colliding, and if neither does it breaks.
   */
  private attemptWalk(
    aNode: PnsNode,
    aCurrent: DiffPair,
    aWalk: DiffPair,
    aPFirst: boolean,
    _aWindCw: boolean,
    aSolidsOnly: boolean,
  ): boolean {
    const shove = new PnsShove(aNode, shoveSettingsFrom(this.settings()));

    // `aWalk = *aCurrent` is DIFF_PAIR's copy *assignment*, not a shape copy —
    // and `tryWalkDp` immediately scores the result with `CoupledLength()` and
    // `Skew()`, both of which read the width and the gap constraint. Copying
    // only the chains would score every attempt against a zero-width pair.
    copyDiffPair(aWalk, aCurrent);

    let iter = 0;

    // `DIFF_PAIR cur( *aCurrent )` — the copy constructor, same reasoning.
    const cur = new DiffPair();

    copyDiffPair(cur, aCurrent);

    let currentIsP = aPFirst;

    const mask = aSolidsOnly ? PnsKind.SOLID_T : PnsKind.ANY_T;

    do {
      const preWalk = currentIsP ? cur.pLine() : cur.nLine();
      const preShove = currentIsP ? cur.nLine() : cur.pLine();

      if (!aNode.checkColliding(preWalk, mask)) {
        currentIsP = !currentIsP;

        if (!aNode.checkColliding(preShove, mask)) break;

        continue;
      }

      const hulls = this.hullsFor(aNode, preWalk, aSolidsOnly);
      const wf1 = routeShortest(preWalk.cLine().points(), hulls, {
        iterationLimit: this.settings().walkaroundIterationLimit,
      });

      if (wf1.status !== 'done') return false;

      const postWalk = preWalk.clone();

      postWalk.setShape(PnsLineChain.fromPoints(wf1.path));

      const postShove = preShove.clone();

      shove.forceClearance(true, cur.gap() - 2 * PNS_HULL_MARGIN);

      if (!shove.shoveObstacleLine(postWalk, preShove, postShove)) return false;

      postWalk.line().simplify();
      postShove.line().simplify();

      cur.setShape(postWalk.cLine().points(), postShove.cLine().points(), !currentIsP);

      currentIsP = !currentIsP;

      if (!aNode.checkColliding(postShove, mask)) break;

      iter++;
    } while (iter < 3);

    if (iter === 3) return false;

    aWalk.setShape(cur.cP(), cur.cN());

    return true;
  }

  /**
   * `tryWalkDp`: try the walk four ways and keep the best-scoring result.
   *
   * The score is `1 + coupledLength + 3·|skew|` and **lower is better**, so a
   * pair that stays coupled and balanced wins. The weight of 3 on skew is what
   * makes the router prefer a slightly longer route to a lopsided one.
   *
   * ### The guard is wrong, upstream, and it matters
   *
   * `bestScore` starts at `1e14` and the test is `bestScore > 0.0`. Every real
   * score is at least 1, so the test is **true whether or not any attempt
   * succeeded** — and when none did, `best` is a default-constructed empty
   * `DIFF_PAIR`. The pair is then overwritten with *empty chains* and this
   * returns `true`. `rhWalkOnly` duly reports `m_fitOk = true`, and the only
   * thing standing between that and a committed empty route is `FixRoute`'s
   * `SegmentCount() < 1` guard.
   *
   * It was plainly meant to be `bestScore < 1e14`, or a `found` flag.
   * Reproduced and pinned; changing it would change which routes the walk and
   * shove modes are willing to attempt.
   *
   * ### The branch comes from `m_currentNode`, not `aNode`
   *
   * Both call sites pass `m_currentNode`, so the two agree today. They would
   * not if anything ever passed something else.
   */
  private tryWalkDp(_aNode: PnsNode, aPair: DiffPair, aSolidsOnly: boolean): boolean {
    const best = new DiffPair();
    let bestScore = 100000000000000.0;

    for (let attempt = 0; attempt <= 3; attempt++) {
      const p = new DiffPair();
      const tmp = (this.mCurrentNode as PnsNode).branch();

      const pFirst = (attempt & 1) !== 0;
      const windCw = (attempt & 2) !== 0;

      if (this.attemptWalk(tmp, aPair, p, pFirst, windCw, aSolidsOnly)) {
        const cl = 1 + p.coupledLength();
        const skew = p.skew();
        const score = cl + Math.abs(skew) * 3.0;

        if (score < bestScore) {
          bestScore = score;
          best.setShapeFrom(p);
        }
      }

      tmp.destroy();
    }

    if (bestScore > 0.0) {
      aPair.setShapeFrom(best);

      // `OPTIMIZER optimizer( m_currentNode ); optimizer.Optimize( &aPair )`.
      // The upstream order is this way round — the pair is re-shaped from the
      // best walk *before* the optimizer runs, so the optimizer works on the
      // pair the caller will read, not on `best`.
      optimizeDiffPair(this.mCurrentNode as PnsNode, aPair);

      return true;
    }

    return false;
  }

  // ----- the three route steps ------------------------------------------------

  /**
   * `rhMarkObstacles`: route the head and simply report whether it collides.
   *
   * Both `CheckColliding` calls are assigned to locals before the `||`, so
   * **both always run** — the short-circuit upstream could have had is not
   * there, and neither is it here.
   */
  private rhMarkObstacles(aP: Vec2): boolean {
    if (!this.routeHead(aP)) return false;

    const node = this.mCurrentNode as PnsNode;
    const collP = node.checkColliding(this.mCurrentTrace.pLine()) !== null;
    const collN = node.checkColliding(this.mCurrentTrace.nLine()) !== null;

    this.mFitOk = !(collP || collN);

    return this.mFitOk;
  }

  /** `rhWalkOnly`. Note `aSolidsOnly = false`: walk around **everything**. */
  private rhWalkOnly(aP: Vec2): boolean {
    if (!this.routeHead(aP)) return false;

    this.mFitOk = this.tryWalkDp(this.mCurrentNode as PnsNode, this.mCurrentTrace, false);

    return this.mFitOk;
  }

  /**
   * `rhShoveOnly`: walk around the solids, then shove everything else aside.
   *
   * The walk here is `aSolidsOnly = **true**` — the opposite of
   * {@link rhWalkOnly} — because pads cannot be shoved and so must be walked,
   * while tracks are the shove engine's job.
   *
   * `m_currentNode` is re-read from the shove engine twice on the success path,
   * once before the status test and once inside it. Upstream's; harmless.
   *
   * The `else` branch's "bring back previous state" writes the two lines that
   * were read *before* `Run()` back into the trace — which is a genuine no-op,
   * since nothing has modified them. Kept because it documents the intent.
   */
  private rhShoveOnly(aP: Vec2): boolean {
    const shove = this.mShove as PnsShove;

    this.mCurrentNode = shove.currentNode();

    const ok = this.routeHead(aP);

    this.mFitOk = false;

    if (!ok) return false;

    if (!this.tryWalkDp(this.mCurrentNode as PnsNode, this.mCurrentTrace, true)) return false;

    // `LINE pLine( m_currentTrace.PLine() )` — copies, so what goes to the
    // shove engine is not the pair's own cached line.
    let pLine = this.mCurrentTrace.pLine().clone();
    let nLine = this.mCurrentTrace.nLine().clone();

    shove.clearHeads();
    shove.addHeads(pLine);
    shove.addHeads(nLine);

    const status = shove.run();

    this.mCurrentNode = shove.currentNode();

    if (status === PnsShoveStatus.SH_OK) {
      this.mCurrentNode = shove.currentNode();

      if (shove.headsModified(0)) pLine = shove.getModifiedHead(0);
      if (shove.headsModified(1)) nLine = shove.getModifiedHead(1);

      // Update the trace with the shoved shapes so FixRoute() commits the right
      // geometry.
      this.mCurrentTrace.setShape(pLine.cLine().points(), nLine.cLine().points());

      const node = this.mCurrentNode;

      if (node.checkColliding(pLine) === null && node.checkColliding(nLine) === null) {
        this.mFitOk = true;
      }
    } else {
      // Bring back the previous state.
      this.mCurrentTrace.setShape(pLine.cLine().points(), nLine.cLine().points());
    }

    return this.mFitOk;
  }

  /** `route`: dispatch on the mode. A mode outside the three is a hard failure. */
  private route(aP: Vec2): boolean {
    switch (this.settings().routingMode) {
      case PnsMode.RM_MarkObstacles:
        return this.rhMarkObstacles(aP);
      case PnsMode.RM_Walkaround:
        return this.rhWalkOnly(aP);
      case PnsMode.RM_Shove:
        return this.rhShoveOnly(aP);
      default:
        return false;
    }
  }

  /**
   * `Move`: re-route to `aP`.
   *
   * `m_currentEnd` is written **after** routing and holds the *requested*
   * point, not the one the route reached — which is why `FlipPosture`,
   * `ToggleVia` and `SetOrthoMode` all re-`Move` to it and get the same answer.
   */
  move(aP: Vec2, aEndItem: PnsItem | null): boolean {
    this.mCurrentEndItem = aEndItem;
    this.mFitOk = false;

    this.mLastNode?.destroy();
    this.mLastNode = null;

    const retval = this.route(aP);

    const latestNode = this.mCurrentNode as PnsNode;

    this.mLastNode = latestNode.branch();
    this.mCurrentEnd = { ...aP };

    this.updateLeadingRatLine();

    return retval;
  }

  /**
   * `updateLeadingRatLine`: draw the line from each lane's end to the nearest
   * thing it still has to reach.
   *
   * `TOPOLOGY::LeadingRatLine` is not ported (see the module note), so the
   * computation is the host's. With no host hook this is a no-op — which is all
   * it is anyway outside a UI.
   */
  private updateLeadingRatLine(): void {
    const lead = this.mHost.leadingRatLine;
    const display = this.mHost.displayRatline;

    if (!lead || !display) return;

    const ratLineP = lead.call(this.mHost, this.mLastNode, this.mCurrentTrace.pLine());

    if (ratLineP) display.call(this.mHost, ratLineP, this.mNetP);

    const ratLineN = lead.call(this.mHost, this.mLastNode, this.mCurrentTrace.nLine());

    if (ratLineN) display.call(this.mHost, ratLineN, this.mNetN);
  }

  /**
   * `FixRoute`: commit what is on screen and either finish or carry on.
   *
   * **`aP` and `aEndItem` are both unused upstream.** The geometry that gets
   * committed is `m_currentTrace`, i.e. whatever the last `Move` produced.
   *
   * The return value is a continuation protocol, not a success flag: `true`
   * means the run is over, `false` means "fixed, keep routing". The caller sees
   * a failure only through the two guards at the top.
   *
   * Three details:
   *
   *  - `m_initialDiagonal` is taken from the **second to last** segment and
   *    **negated**, so the next placement starts on the opposite diagonal sense
   *    from the corner just laid. A single-segment fix leaves the posture alone.
   *  - the last segment is trimmed off only when **both** lanes have more than
   *    one segment, so a pair whose N lane is a single segment keeps its P
   *    lane's last segment too. That trim is what makes free-hand routing leave
   *    the head unfixed so the next move can re-place it.
   *  - the shove engine is rebuilt from `m_world` — everything fixed so far —
   *    before `CommitPlacement`, because committing invalidates its head state.
   */
  fixRoute(_aP: Vec2, _aEndItem: PnsItem | null, aForceFinish: boolean): boolean {
    if (!this.mFitOk && !pnsAllowDrcViolations(this.settings())) return false;

    if (segmentCount(this.mCurrentTrace.cP()) < 1 || segmentCount(this.mCurrentTrace.cN()) < 1) {
      return false;
    }

    if (segmentCount(this.mCurrentTrace.cP()) > 1) {
      const s = csegment(this.mCurrentTrace.cP(), -2);

      this.mInitialDiagonal = !Direction45.fromSeg(s.a, s.b).isDiagonal();
    }

    const lastNode = this.mLastNode as PnsNode;
    const topo = new PnsTopology(lastNode);

    if (
      !this.mSnapOnTarget &&
      !this.mCurrentTrace.endsWithVias() &&
      !aForceFinish &&
      !this.settings().fixAllSegments
    ) {
      const newP = this.mCurrentTrace.cP().map((p) => ({ ...p }));
      const newN = this.mCurrentTrace.cN().map((p) => ({ ...p }));

      if (segmentCount(newP) > 1 && segmentCount(newN) > 1) {
        newP.pop();
        newN.pop();
      }

      this.mCurrentTrace.setShape(newP, newN);
    }

    if (this.mCurrentTrace.endsWithVias()) {
      lastNode.addVia(this.mCurrentTrace.pLine().via().clone());
      lastNode.addVia(this.mCurrentTrace.nLine().via().clone());
      this.mChainedPlacement = false;
    } else {
      // Unpinned, and provably so: when `aForceFinish` is true this line's
      // value cannot be observed. The same branch below sets `m_idle`, the
      // flag's only reader (`SetLayer`) tests `m_idle` first, and `Start`
      // resets the flag. A mutant dropping `&& !aForceFinish` survives.
      this.mChainedPlacement = !this.mSnapOnTarget && !aForceFinish;
    }

    const lineP = this.mCurrentTrace.pLine().clone();
    const lineN = this.mCurrentTrace.nLine().clone();

    lastNode.addLine(lineP);
    lastNode.addLine(lineN);

    topo.simplifyLine(lineP);
    topo.simplifyLine(lineN);

    this.mPrevPair = this.mCurrentTrace.endingPrimitives();
    this.mLastFixNode = lastNode;

    // Avoid a use-after-free: CommitPlacement calls NODE::Commit, which
    // invalidates the shove heads state. (Upstream's comment.)
    if (this.settings().routingMode === PnsMode.RM_Shove) {
      this.mShove = new PnsShove(this.mWorld as PnsNode, shoveSettingsFrom(this.settings()));
    }

    this.commitPlacement();
    this.mPlacingVia = false;
    this.mLastFixNode = null;

    if (this.mSnapOnTarget || aForceFinish) {
      this.mIdle = true;
      return true;
    }

    this.mHasFixedAnything = true;
    this.initPlacement();

    return false;
  }

  /**
   * `AbortPlacement`.
   *
   * Note what it does *not* do: `m_currentNode`, `m_idle` and `m_shove` are all
   * left as they were, and `m_world` is the placement branch rather than the
   * board — so this kills the branch's children, not the branch.
   */
  abortPlacement(): boolean {
    this.mWorld?.killChildren();
    this.mLastNode = null;

    return true;
  }

  /** `CommitPlacement`. Reports true even when there was nothing to commit. */
  commitPlacement(): boolean {
    if (this.mLastFixNode) this.mHost.commitRouting(this.mLastFixNode);

    this.mLastFixNode = null;
    this.mLastNode = null;
    this.mCurrentNode = null;

    return true;
  }
}
