// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::MULTI_DRAGGER`, dragging a bundle of tracks together. Counterpart:
 * `pcbnew/router/pns_multi_dragger.{h,cpp}`. Upstream's own header calls it
 * *"very trivial ... for demonstration purposes"*, and the code reads like it:
 * the algorithm is a projection, not a solver.
 *
 * ## What it does
 *
 * `Start` assembles one `MDRAG_LINE` per distinct line in the selection, works
 * out which of them the cursor is nearest and how (a corner or a mid-segment),
 * and from that picks a **primary line** and one global `DM_CORNER` /
 * `DM_SEGMENT` mode for the whole bundle.
 *
 * `Drag` drags the primary line, takes the perpendicular of its leader segment,
 * and places every other line at its own signed distance along that
 * perpendicular. Lines whose leader segment is not roughly parallel to the
 * primary's are left out of the drag entirely. Three "postures" are tried in
 * turn — the plain drag, the drag with each line's last point dropped, and the
 * drag measured against the *pre-drag* direction — and the first that leaves
 * every line pointing the same way wins.
 *
 * ## The three finishers
 *
 * `multidragMarkObstacles` clips each line against the ones before it;
 * `multidragWalkaround` walks the whole bundle around obstacles in both orders
 * and keeps the cheaper; `multidragShove` hands every line to `SHOVE` at once.
 *
 * ## Upstream bugs reproduced here
 *
 * - `multidragWalkaround` indexes its results by `lidx` on **both** attempts
 *   while processing attempt 1 in reverse, so attempt 1's walked lines are
 *   permuted onto the wrong `MDRAG_LINE`s. See {@link PnsMultiDragger}.
 * - `clipToOtherLine` can clip a line to nothing at all.
 * - `restoreLeaderSegments` reads `GetLink( -1 )`, which is out of bounds on a
 *   `std::vector`. See the note there for what this port does instead.
 * - `SetMode` is empty and `Mode()` always answers `DM_CORNER`.
 */

import { Direction45, Directions, AngleType } from '@ziroeda/kimath/src/geometry/direction45.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { ObstacleSet, makeCollisionSearchContext, type NetHandle } from './pns_collision.js';
import { PnsDragAlgo, PnsDragMode, toShoveSettings } from './pns_drag_algo.js';
import { collectObstacleHulls } from './pns_dragger.js';
import { PnsKind, type PnsItem, type PnsLinkedItem } from './pns_item.js';
import { PnsItemSet } from './pns_itemset.js';
import { PnsLine, PnsLineChain } from './pns_line_item.js';
import { chainSplit, lineDragCorner, lineDragSegment } from './pns_line_drag.js';
import type { PnsNode } from './pns_node.js';
import { PnsMode } from './pns_routing_settings.js';
import { PnsSegment } from './pns_segment.js';
import { PnsShove, PnsShovePolicy, PnsShoveStatus } from './pns_shove.js';
import { routeShortest } from './pns_walkaround.js';
import type { Seg } from './pns_line.js';

/** `MULTI_DRAGGER::MDRAG_LINE`, field for field. */
interface MdragLine {
  leaderItem: PnsItem | null;
  originalLeaders: PnsItem[];

  isStrict: boolean;
  isMidSeg: boolean;
  isCorner: boolean;
  isDraggable: boolean;

  leaderSegIndex: number;
  cornerIsLast: boolean;

  /** The complete line (in a bundle) to drag. */
  originalLine: PnsLine;
  preDragLine: PnsLine;
  /** The result of the drag calculation. */
  draggedLine: PnsLine;
  preShoveLine: PnsLine;

  dragOK: boolean;
  /** True for the "leader"/"primary" line, the one the cursor is attached to. */
  isPrimaryLine: boolean;
  clipDone: boolean;
  /** Distance between this line and the primary one. */
  offset: number;
  midSeg: Seg;
  dragDist: number;
  cornerDistance: number;
  leaderSegDistance: number;
  /** Index in `m_mdragLines`, used for identity tracking. */
  mdragIndex: number;
}

const ZERO_SEG: Seg = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };

function newMdragLine(): MdragLine {
  return {
    leaderItem: null,
    originalLeaders: [],
    isStrict: false,
    isMidSeg: false,
    isCorner: false,
    isDraggable: false,
    leaderSegIndex: -1,
    cornerIsLast: false,
    originalLine: new PnsLine(),
    preDragLine: new PnsLine(),
    draggedLine: new PnsLine(),
    preShoveLine: new PnsLine(),
    dragOK: false,
    isPrimaryLine: false,
    clipDone: false,
    offset: 0,
    midSeg: ZERO_SEG,
    dragDist: 0,
    cornerDistance: 0,
    leaderSegDistance: 0,
    mdragIndex: -1,
  };
}

// ----- the small geometry MULTI_DRAGGER leans on ---------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** `VECTOR2I::Perpendicular()`, which is `(-y, x)` — not `(y, -x)`. */
const perpendicular = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

/** `VECTOR2I::Resize( aNewLength )`; a zero vector stays zero. */
function resizeVec(v: Vec2, aNewLength: number): Vec2 {
  const l = Math.hypot(v.x, v.y);

  if (l === 0) return { x: 0, y: 0 };

  return { x: Math.round((v.x * aNewLength) / l), y: Math.round((v.y * aNewLength) / l) };
}

/**
 * `SEG::LineDistance( aP, aDetermineSide )`: the distance to the segment's
 * *infinite* line, signed by which side `aP` falls on when asked.
 *
 * The sign is `sgn( det )` where `det` is the same determinant `SEG::Side`
 * uses, so it agrees with `Side`'s left/right convention. Every call in
 * `MULTI_DRAGGER` passes `true`, and the sign is what makes lines on opposite
 * sides of the primary stay on opposite sides.
 */
export function segLineDistance(aSeg: Seg, aP: Vec2, aDetermineSide = false): number {
  const p = aSeg.a.y - aSeg.b.y;
  const q = aSeg.b.x - aSeg.a.x;
  const r = -p * aSeg.a.x - q * aSeg.a.y;
  const l = p * p + q * q;
  const det = p * aP.x + q * aP.y + r;

  const dist = l > 0 ? Math.trunc(Math.sqrt((det * det) / l)) : 0;

  return aDetermineSide ? sign(det) * dist : Math.abs(dist);
}

/** `SEG::LineProject( aP )`: the projection onto the *infinite* line. */
export function segLineProject(aSeg: Seg, aP: Vec2): Vec2 {
  const d = sub(aSeg.b, aSeg.a);
  const lSquared = dot(d, d);

  if (lSquared === 0) return { ...aSeg.a };

  const t = dot(d, sub(aP, aSeg.a));

  return {
    x: Math.round(aSeg.a.x + (t * d.x) / lSquared),
    y: Math.round(aSeg.a.y + (t * d.y) / lSquared),
  };
}

/** `SEG::Distance( aP )`: to the segment, clamped at its ends. */
export function segDistance(aSeg: Seg, aP: Vec2): number {
  const d = sub(aSeg.b, aSeg.a);
  const len2 = dot(d, d);

  if (len2 === 0) return Math.round(Math.hypot(aP.x - aSeg.a.x, aP.y - aSeg.a.y));

  let t = dot(sub(aP, aSeg.a), d) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  return Math.round(Math.hypot(aP.x - (aSeg.a.x + d.x * t), aP.y - (aSeg.a.y + d.y * t)));
}

/** `SEG::Contains( aP )`, which is `Distance( aP ) <= 1`. */
const segContains = (aSeg: Seg, aP: Vec2): boolean => segDistance(aSeg, aP) <= 1;

/** `SEG::IntersectLines`: where the two *infinite* lines meet, or null. */
export function segIntersectLines(aA: Seg, aB: Seg): Vec2 | null {
  const d1 = sub(aA.b, aA.a);
  const d2 = sub(aB.b, aB.a);
  const denom = d1.x * d2.y - d1.y * d2.x;

  if (denom === 0) return null;

  const t = ((aB.a.x - aA.a.x) * d2.y - (aB.a.y - aA.a.y) * d2.x) / denom;

  return { x: Math.round(aA.a.x + d1.x * t), y: Math.round(aA.a.y + d1.y * t) };
}

/**
 * `DIRECTION_45::Opposite()`.
 *
 * Upstream indexes a nine-entry table by `m_dir`, which for `UNDEFINED` (−1) is
 * an out-of-bounds read. This answers `UNDEFINED` there instead: kimath must
 * stay purely additive here, so the method is not added to `Direction45`, and
 * reproducing an out-of-bounds read is not something TypeScript can do anyway.
 */
export function directionOpposite(aDir: Direction45): Direction45 {
  if (!aDir.isDefined()) return Direction45.UNDEFINED;

  return Direction45.of(((aDir.dir + 4) % Directions.LAST) as Directions);
}

/**
 * `SHAPE_LINE_CHAIN::PointAlong( aPathLength )`: the point `aPathLength` along
 * the chain. Past the end it answers the last point, and length 0 the first.
 */
export function chainPointAlong(aChain: PnsLineChain, aPathLength: number): Vec2 {
  let total = 0;

  if (aPathLength === 0) return aChain.cPoint(0);

  for (let i = 0; i < aChain.segmentCount(); i++) {
    const s = aChain.cSegment(i);
    const l = Math.round(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y));

    if (total + l >= aPathLength) {
      return add(s.a, resizeVec(sub(s.b, s.a), aPathLength - total));
    }

    total += l;
  }

  return aChain.cLastPoint();
}

/**
 * `LINE::Collide( const LINE*, NODE*, int aLayer, COLLISION_SEARCH_CONTEXT* )`.
 *
 * Upstream's `LINE::Shape()` returns the line's own `SHAPE_LINE_CHAIN`, so
 * `ITEM::collideSimple` compares two polylines directly. **This port's
 * `PnsLine.shape()` answers `null`** — a LINE is not something the spatial
 * index holds — and `collideSimple` returns false the moment either shape is
 * missing. A line would therefore never collide with anything, and
 * `clipToOtherLine` would never clip.
 *
 * The bridge is the pairwise segment test, which is the same question with the
 * same clearance: a scratch `SEGMENT` per line carries that line's width, net
 * and layers (`SEGMENT::fromParentLine`), and every pair goes through the
 * ordinary `ITEM::Collide`. Upstream folds each line's half-width into the
 * clearance; a `SEGMENT`'s stadium shape carries its own width, so the sum
 * comes out the same.
 *
 * The argument order is upstream's: the *clipped* line is `aItem` and the
 * reference is `aHead`, which is what decides whose net the resolver is asked
 * about first.
 */
function linesCollide(
  aNode: PnsNode,
  aLine: PnsLine,
  aRef: PnsLine,
  aCtx: ReturnType<typeof makeCollisionSearchContext>,
): boolean {
  const ca = aLine.cLine();
  const cb = aRef.cLine();

  if (ca.segmentCount() === 0 || cb.segmentCount() === 0) return false;

  const sa = PnsSegment.fromParentLine(aLine, ca.cSegment(0));
  const sb = PnsSegment.fromParentLine(aRef, cb.cSegment(0));

  for (let i = 0; i < ca.segmentCount(); i++) {
    const a = ca.cSegment(i);

    sa.setEnds(a.a, a.b);

    for (let j = 0; j < cb.segmentCount(); j++) {
      const b = cb.cSegment(j);

      sb.setEnds(b.a, b.b);

      if (sa.collide(sb, aNode, aLine.layer(), aCtx)) return true;
    }
  }

  return false;
}

/**
 * `clipToOtherLine` (`pns_multi_dragger.cpp:294-346`): shorten `aClipped` until
 * it stops touching `aRef`, by binary search on its length.
 *
 * Two upstream details decide what this actually does:
 *
 * - `tightest` starts **empty** and is only ever assigned on a probe that does
 *   *not* collide. A line that collides on its first probe and never gets short
 *   enough to clear is therefore clipped to **nothing**, not left alone.
 * - The loop halves `step` on both branches, so a search that keeps colliding
 *   terminates on `step > clipLengthThreshold` (100) rather than on success.
 *
 * Returns whether anything was clipped, and mutates `aClipped` as upstream's
 * reference parameter does.
 */
export function clipToOtherLine(aNode: PnsNode, aRef: PnsLine, aClipped: PnsLine): boolean {
  const obstacles = new ObstacleSet();
  const ctx = makeCollisionSearchContext(obstacles);

  const clipLengthThreshold = 100;

  const l = aClipped.clone();
  let tightest = new PnsLineChain();

  let didClip = false;
  let curL = aClipped.cLine().length();
  let step = Math.trunc(curL / 2) - 1;

  while (step > clipLengthThreshold) {
    let slTmp = aClipped.cLine().clone();
    const pclip = chainPointAlong(slTmp, curL);
    const idx = chainSplit(slTmp, pclip);

    slTmp = slTmp.slice(0, idx);

    l.setShape(slTmp);

    if (linesCollide(aNode, l, aRef, ctx)) {
      didClip = true;
      curL -= step;
      step = Math.trunc(step / 2);
    } else {
      tightest = slTmp;

      if (didClip) {
        curL += step;
        step = Math.trunc(step / 2);
      } else {
        break;
      }
    }
  }

  aClipped.setShape(tightest);

  return didClip;
}

/** `PNS::MULTI_DRAGGER`. */
export class PnsMultiDragger extends PnsDragAlgo {
  private mDragStatus = false;
  private mDragMode: PnsDragMode = PnsDragMode.DM_CORNER;
  private mMdragLines: MdragLine[] = [];
  private mLeaderSegments: PnsItem[] = [];
  private mLastNode: PnsNode | null = null;
  private mPreShoveNode: PnsNode | null = null;
  private mOrigDraggedItems = new PnsItemSet();
  private mDraggedItems = new PnsItemSet();
  private mDragStartPoint: Vec2 = { x: 0, y: 0 };
  private mGuide: Seg = ZERO_SEG;
  private mShove: PnsShove | null = null;

  override currentNode(): PnsNode | null {
    return this.mLastNode ? this.mLastNode : this.mWorld;
  }

  override traces(): PnsItemSet {
    return this.mDraggedItems;
  }

  /** `CurrentLayer()`: upstream's body is `// fixme: should we care?` and `return 0`. */
  override currentLayer(): number {
    return 0;
  }

  /** `SetMode`: upstream's body is empty. */
  override setMode(_aDragMode: PnsDragMode): void {}

  /** `Mode()`: upstream always answers `DM_CORNER`, whatever mode is running. */
  override mode(): PnsDragMode {
    return PnsDragMode.DM_CORNER;
  }

  override getForceMarkObstaclesMode(aDragStatus: { value: boolean }): boolean {
    aDragStatus.value = this.mDragStatus;

    return false;
  }

  override getLastCommittedLeaderSegments(): PnsItem[] {
    return this.mLeaderSegments;
  }

  /** The mode the drag is *actually* running in, which `Mode()` will not tell you. */
  dragMode(): PnsDragMode {
    return this.mDragMode;
  }

  /** The assembled bundle, for tests; upstream's is private. */
  mdragLines(): readonly MdragLine[] {
    return this.mMdragLines;
  }

  /** The shove instance, for tests. */
  shove(): PnsShove | null {
    return this.mShove;
  }

  /**
   * `CurrentNets()`: the distinct nets of the *dragged* lines.
   *
   * Note it reads `draggedLine`, which is an empty `LINE` until `Drag` has run
   * at least once — so this answers nothing between `Start` and the first
   * `Drag`.
   */
  override currentNets(): NetHandle[] {
    const uniqueNets = new Set<NetHandle>();

    for (const l of this.mMdragLines) {
      const net = l.draggedLine.net();

      if (net) uniqueNets.add(net);
    }

    return [...uniqueNets];
  }

  /**
   * `MULTI_DRAGGER::Start` (`:45-281`).
   *
   * ### The mid-segment loop keeps the *last* match, not the nearest
   *
   * Every link that is a `SEGMENT` present in the selection overwrites
   * `midSeg`, `isMidSeg`, `leaderSegIndex` and `leaderSegDistance` — including
   * over a corner that was already chosen above. Selecting two segments of the
   * same line therefore leaves the later one as the leader regardless of where
   * the cursor is.
   *
   * ### `DM_CORNER` is provisional
   *
   * Any line whose dragged end has no joint, or has a non-trivial one, demotes
   * the *whole* drag to `DM_SEGMENT`. The no-joint case `break`s out of the
   * loop, so lines after it are not reversed; the non-trivial case does not.
   */
  override start(aP: Vec2, aPrimitives: PnsItemSet): boolean {
    const world = this.mWorld as PnsNode;

    this.mLastNode = null;
    this.mDragStatus = false;
    this.mDragStartPoint = aP;

    if (aPrimitives.empty()) return false;

    this.mMdragLines = [];

    for (const pitem of aPrimitives.items()) {
      const litem = pitem as PnsLinkedItem;
      let redundant = false;

      for (const l of this.mMdragLines) {
        if (l.originalLine.containsLink(litem)) {
          l.originalLeaders.push(litem);
          redundant = true;
          break;
        }
      }

      // Several SEGMENTs in aPrimitives can belong to the same line; those are
      // rejected.
      if (!redundant) {
        const l = newMdragLine();

        l.originalLine = world.assembleLine(litem);
        l.originalLeaders.push(litem);
        l.isDraggable = true;
        l.mdragIndex = this.mMdragLines.length;
        this.mMdragLines.push(l);
      }
    }

    let anyStrictCornersFound = false;
    let anyStrictMidSegsFound = false;

    for (const l of this.mMdragLines) {
      const thr = Math.trunc(l.originalLine.width() / 2);

      const origFirst = l.originalLine.cLine().cPoint(0);
      const distFirst = Math.trunc(Math.hypot(origFirst.x - aP.x, origFirst.y - aP.y));

      const origLast = l.originalLine.cLine().cLastPoint();
      const distLast = Math.trunc(Math.hypot(origLast.x - aP.x, origLast.y - aP.y));

      l.cornerDistance = Math.min(distFirst, distLast);

      let takeFirst = false;
      const ilast = aPrimitives.findVertex(origLast);
      const ifirst = aPrimitives.findVertex(origFirst);

      if (ilast && ifirst) takeFirst = distFirst < distLast;
      else if (ilast) takeFirst = false;
      else if (ifirst) takeFirst = true;

      if (ifirst || ilast) {
        if (takeFirst) {
          l.cornerIsLast = false;
          l.leaderSegIndex = 0;
          l.cornerDistance = distFirst;
          l.isCorner = true;

          if (distFirst <= thr) {
            l.isStrict = true;
            l.cornerDistance = 0;
          }
        } else {
          l.cornerIsLast = true;
          l.leaderSegIndex = l.originalLine.segmentCount() - 1;
          l.cornerDistance = distLast;
          l.isCorner = true;

          if (distLast <= thr) {
            l.isStrict = true;
            l.cornerDistance = 0;
          }
        }
      }

      const links = l.originalLine.links();

      for (let lidx = 0; lidx < links.length; lidx++) {
        const lseg = links[lidx] as PnsLinkedItem;

        if (lseg.kind() !== PnsKind.SEGMENT_T) continue;

        if (!aPrimitives.contains(lseg)) continue;

        const d = segDistance((lseg as PnsSegment).seg(), aP);

        l.midSeg = (lseg as PnsSegment).seg();
        l.isMidSeg = true;
        l.leaderSegIndex = lidx;
        l.leaderSegDistance = d + thr;

        if (d < thr && !l.isStrict) {
          l.isCorner = false;
          l.isStrict = true;
          l.leaderSegDistance = 0;
        }
      }

      if (l.isStrict) {
        anyStrictCornersFound ||= l.isCorner;
        anyStrictMidSegsFound ||= !l.isCorner;
      }
    }

    if (anyStrictCornersFound) {
      this.mDragMode = PnsDragMode.DM_CORNER;
    } else if (anyStrictMidSegsFound) {
      this.mDragMode = PnsDragMode.DM_SEGMENT;
    } else {
      let minLeadSegDist = Number.MAX_SAFE_INTEGER;
      let minCornerDist = Number.MAX_SAFE_INTEGER;
      let bestSeg: MdragLine | null = null;
      let bestCorner: MdragLine | null = null;

      for (const l of this.mMdragLines) {
        if (l.cornerDistance < minCornerDist) {
          minCornerDist = l.cornerDistance;
          bestCorner = l;
        }

        if (l.leaderSegDistance < minLeadSegDist) {
          minLeadSegDist = l.leaderSegDistance;
          bestSeg = l;
        }
      }

      if (bestCorner && bestSeg) {
        // Strict `<`, so a tie goes to the segment.
        if (minCornerDist < minLeadSegDist) {
          this.mDragMode = PnsDragMode.DM_CORNER;
          bestCorner.isPrimaryLine = true;
        } else {
          this.mDragMode = PnsDragMode.DM_SEGMENT;
          bestSeg.isPrimaryLine = true;
        }
      } else if (bestCorner) {
        this.mDragMode = PnsDragMode.DM_CORNER;
        bestCorner.isPrimaryLine = true;
      } else if (bestSeg) {
        this.mDragMode = PnsDragMode.DM_SEGMENT;
        bestSeg.isPrimaryLine = true;
      } else {
        // "can it really happen?", upstream. Only with no lines at all, which
        // the empty-primitives guard above has already excluded.
        return false;
      }
    }

    if (this.mDragMode === PnsDragMode.DM_CORNER) {
      for (const l of this.mMdragLines) {
        // Make sure the corner to drag is the last one.
        if (!l.cornerIsLast) {
          l.originalLine.reverse();
          l.cornerIsLast = true;
        }

        // And if it's connected (non-trivial fanout), disregard it.
        const jt = world.findJointForItem(l.originalLine.cLastPoint(), l.originalLine);

        if (!jt) {
          this.mDragMode = PnsDragMode.DM_SEGMENT;
          break;
        }

        if (!jt.isTrivialEndpoint()) {
          // Note: no break. Later lines are still reversed.
          this.mDragMode = PnsDragMode.DM_SEGMENT;
        }
      }
    }

    for (const l of this.mMdragLines) {
      if ((anyStrictCornersFound || anyStrictMidSegsFound) && l.isStrict) {
        l.isPrimaryLine = true;
        break;
      }
    }

    this.mOrigDraggedItems = aPrimitives;

    if (this.settings().routingMode === PnsMode.RM_Shove) {
      this.mPreShoveNode = world.branch();

      for (const l of this.mMdragLines) this.mPreShoveNode.removeLine(l.originalLine);

      this.mShove = new PnsShove(this.mPreShoveNode, toShoveSettings(this.settings()));
      this.mShove.setDefaultShovePolicy(
        PnsShovePolicy.SHP_SHOVE | PnsShovePolicy.SHP_DONT_LOCK_ENDPOINTS,
      );
    }

    return true;
  }

  /**
   * `MULTI_DRAGGER::FixRoute` (`:366-382`).
   *
   * No pre-drag re-try, unlike `DRAGGER::FixRoute`: a failed last drag is
   * simply refused unless DRC violations are allowed.
   */
  override fixRoute(_aForceCommit: boolean): boolean {
    const node = this.currentNode();

    if (node) {
      if (!this.mDragStatus && !this.settings().allowDrcViolations) return false;

      this.mRouter.commitRouting(node);

      return true;
    }

    return false;
  }

  /**
   * `MULTI_DRAGGER::tryWalkaround` (`:384-405`).
   *
   * The same bridge as `PnsDragger.tryWalkaround`, with upstream's *different*
   * length limit: `SetLengthLimit( true, 3.0 )` here against `30.0` there. A
   * bundle drag is far less willing to grow a detour than a single-track drag.
   */
  private tryWalkaround(aNode: PnsNode, aOrig: PnsLine): PnsLine | null {
    if (aOrig.segmentCount() < 1) return null;

    const hulls = collectObstacleHulls(aNode, aOrig);

    if (hulls.length === 0) return aOrig.clone();

    const result = routeShortest(aOrig.cLine().points(), hulls, {
      iterationLimit: this.settings().walkaroundIterationLimit,
      lengthLimit: true,
      lengthExpansionFactor: 3.0,
    });

    if (result.status !== 'done') return null;

    const out = aOrig.clone();
    out.setShape(PnsLineChain.fromPoints(result.path));

    return out;
  }

  /**
   * `MULTI_DRAGGER::findNewLeaderSegment` (`:407-427`): which segment of the
   * dragged line took over from the one that was selected.
   *
   * It must both cross the guide line — the perpendicular through the cursor —
   * *and* run parallel (or anti-parallel) to the original leader. Either test
   * alone matches too much on a line that doubles back.
   */
  private findNewLeaderSegment(aLine: MdragLine): number {
    const origLeader = aLine.preDragLine.cLine().cSegment(aLine.leaderSegIndex);
    const origLeaderDir = Direction45.fromSeg(origLeader.a, origLeader.b);

    for (let i = 0; i < aLine.draggedLine.segmentCount(); i++) {
      const curSeg = aLine.draggedLine.cLine().cSegment(i);
      const curDir = Direction45.fromSeg(curSeg.a, curSeg.b);

      const ip = segIntersectLines(curSeg, this.mGuide);

      if (ip && segContains(curSeg, ip)) {
        if (curDir.equals(origLeaderDir) || curDir.equals(directionOpposite(origLeaderDir))) {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * `MULTI_DRAGGER::restoreLeaderSegments` (`:429-456`): after the drag, hand
   * back the segments that correspond to the ones the user had selected, so the
   * selection survives the operation.
   *
   * **`GetLink( -1 )`** is upstream's, and `LINE::GetLink` is `m_links[aIndex]`
   * on a `std::vector` — so −1 reads one element before the start. What the
   * code plainly means is "the last link", since `DM_CORNER` drags the last
   * corner, and that is what this does. Answering `undefined` (which the TS
   * `getLink` does for a negative index) and pushing it would leave a hole in
   * `m_leaderSegments` that no caller expects.
   */
  private restoreLeaderSegments(aCompletedLines: MdragLine[]): void {
    this.mLeaderSegments = [];

    for (const l of aCompletedLines) {
      if (!l.dragOK) continue;

      if (this.mDragMode === PnsDragMode.DM_CORNER) {
        if (l.draggedLine.linkCount() > 0) {
          const links = l.draggedLine.links();

          this.mLeaderSegments.push(links[links.length - 1] as PnsItem);
        }
      } else {
        const newLeaderIdx = this.findNewLeaderSegment(l);

        if (newLeaderIdx >= 0 && newLeaderIdx < l.draggedLine.linkCount()) {
          this.mLeaderSegments.push(l.draggedLine.getLink(newLeaderIdx) as PnsItem);
        }
      }
    }
  }

  /**
   * `MULTI_DRAGGER::multidragWalkaround` (`:458-570`).
   *
   * Two attempts: the lines are walked in ascending `dragDist` order, then in
   * descending, and whichever grew the bundle less wins. Walking them in one
   * order is not enough because each walked line becomes an obstacle for the
   * next, so which line yields depends entirely on who goes first.
   *
   * **The upstream bug.** `state->postWalkLines[lidx] = walk` uses the *loop*
   * index, while attempt 1 reads `aCompletedLines[size - 1 - lidx]`. So attempt
   * 1 stores each walked line at the slot of the line processed in that
   * position, not the line it belongs to — and the caller then copies
   * `postWalkLines[lidx]` back onto `aCompletedLines[lidx]`. Whenever attempt 1
   * wins with more than one line, the bundle's geometries are reversed onto
   * each other. Reproduced exactly; see the test.
   */
  private multidragWalkaround(aCompletedLines: MdragLine[]): boolean {
    this.mLastNode = null;

    aCompletedLines.sort((a, b) => a.dragDist - b.dragDist);

    const preWalkNode = (this.mWorld as PnsNode).branch();

    for (const l of aCompletedLines) preWalkNode.removeLine(l.originalLine);

    interface WalkState {
      node: PnsNode;
      totalLength: number;
      postWalkLines: PnsLine[];
      fail: boolean;
    }

    const walkState: WalkState[] = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      const state: WalkState = {
        node: preWalkNode.branch(),
        totalLength: 0,
        postWalkLines: new Array<PnsLine>(aCompletedLines.length),
        fail: false,
      };

      walkState.push(state);

      for (let lidx = 0; lidx < aCompletedLines.length; lidx++) {
        const l = aCompletedLines[attempt ? aCompletedLines.length - 1 - lidx : lidx] as MdragLine;

        const walk = this.tryWalkaround(state.node, l.draggedLine);

        if (walk) {
          state.node.addLine(walk);
          state.totalLength += walk.cLine().length() - l.draggedLine.cLine().length();
          // Upstream's `lidx`, not the reversed index. See the docblock.
          state.postWalkLines[lidx] = walk;
        } else {
          state.fail = true;
          break;
        }
      }
    }

    const s0 = walkState[0] as WalkState;
    const s1 = walkState[1] as WalkState;

    let bestAttempt: number | null = null;

    if (!s0.fail && !s1.fail) {
      bestAttempt = s0.totalLength < s1.totalLength ? 0 : 1;
    } else if (!s0.fail) {
      bestAttempt = 0;
    } else if (!s1.fail) {
      bestAttempt = 1;
    }

    if (bestAttempt === null) return false;

    const best = walkState[bestAttempt] as WalkState;

    for (let lidx = 0; lidx < aCompletedLines.length; lidx++) {
      (aCompletedLines[lidx] as MdragLine).draggedLine = best.postWalkLines[lidx] as PnsLine;
    }

    this.mLastNode = best.node;

    this.restoreLeaderSegments(aCompletedLines);

    return true;
  }

  /**
   * `MULTI_DRAGGER::multidragMarkObstacles` (`:573-611`).
   *
   * The clip loop is upper-triangular and **only `l2` is clipped**, so the
   * earlier line in the bundle always wins a conflict and the ordering of
   * `aCompletedLines` decides which track gets shortened.
   */
  private multidragMarkObstacles(aCompletedLines: MdragLine[]): boolean {
    // m_lastNode holds the temporary (post-modification) state — an efficient
    // undo buffer. The board is not changed directly, only this branch of it,
    // which can then be committed or discarded.
    this.mLastNode = (this.mWorld as PnsNode).branch();

    for (let l1 = 0; l1 < aCompletedLines.length; l1++) {
      for (let l2 = l1 + 1; l2 < aCompletedLines.length; l2++) {
        const l1l = (aCompletedLines[l1] as MdragLine).draggedLine;
        const l2l = (aCompletedLines[l2] as MdragLine).draggedLine.clone();

        if (clipToOtherLine(this.mLastNode, l1l, l2l)) {
          (aCompletedLines[l2] as MdragLine).draggedLine = l2l;
        }
      }
    }

    for (const l of aCompletedLines) {
      this.mLastNode.removeLine(l.originalLine);
      this.mLastNode.addLine(l.draggedLine);
    }

    this.restoreLeaderSegments(aCompletedLines);

    return true;
  }

  /**
   * `MULTI_DRAGGER::multidragShove` (`:613-701`).
   *
   * Every completed line goes in as a head at once, with
   * `SHP_SHOVE | SHP_DONT_OPTIMIZE` — the whole bundle has to move together or
   * not at all.
   *
   * The re-add loop matters: `Start` removed *every* `m_mdragLines` entry from
   * `m_preShoveNode`, but only the lines that survived the drag-angle check are
   * in `aCompletedLines`. Without putting the rest back, a line the posture
   * rejected would simply vanish from the board.
   *
   * A non-`SH_OK` status returns false **after** the branch and the re-add, so
   * `m_lastNode` is left pointing at a coherent world either way.
   */
  private multidragShove(aCompletedLines: MdragLine[]): boolean {
    this.mLastNode = null;

    const shove = this.mShove;

    if (!shove) return false;

    aCompletedLines.sort((a, b) => a.dragDist - b.dragDist);

    shove.setDefaultShovePolicy(PnsShovePolicy.SHP_SHOVE);
    shove.clearHeads();

    for (const l of aCompletedLines) {
      shove.addHeads(l.draggedLine, PnsShovePolicy.SHP_SHOVE | PnsShovePolicy.SHP_DONT_OPTIMIZE);
    }

    const status = shove.run();

    this.mLastNode = shove.currentNode().branch();

    const completedIndices = new Set<number>();

    for (const cl of aCompletedLines) completedIndices.add(cl.mdragIndex);

    for (const ml of this.mMdragLines) {
      if (!completedIndices.has(ml.mdragIndex)) {
        const preserved = ml.originalLine.clone();

        preserved.clearLinks();
        this.mLastNode.addLine(preserved);
      }
    }

    if (status !== PnsShoveStatus.SH_OK) return false;

    for (let i = 0; i < aCompletedLines.length; i++) {
      const l = aCompletedLines[i] as MdragLine;

      if (shove.headsModified(i)) l.draggedLine = shove.getModifiedHead(i);

      // This should not be linked (assert in rt-test).
      l.draggedLine.clearLinks();

      this.mLastNode.addLine(l.draggedLine);
    }

    this.restoreLeaderSegments(aCompletedLines);

    return true;
  }

  /**
   * `MULTI_DRAGGER::Drag` (`:704-997`).
   *
   * ### The three postures
   *
   * - **0** — drag as selected.
   * - **1** — drop the last point of every pre-drag line first, but only if the
   *   primary has more than two points. A bundle whose ends were already
   *   staggered can then be re-cut from one corner back.
   * - **2** — measure against the *pre-drag* last segment rather than the
   *   dragged one, and accept lines that failed the angle test (`aVariant < 2`
   *   guards the `!dragOK` rejection).
   *
   * A `DM_SEGMENT` posture always succeeds — it returns before the
   * ending-direction check — so variants 1 and 2 only ever run for corner
   * drags.
   *
   * ### What decides whether a line joins the drag
   *
   * Corner mode: the angle between the primary's pre-drag last segment and this
   * line's must be obtuse, right or straight. Segment mode: the angle mask is
   * `ANG_HALF_FULL | ANG_STRAIGHT`, i.e. parallel or anti-parallel only.
   */
  override drag(aP: Vec2): boolean {
    let primaryPreDrag: PnsLine | null = null;
    let primaryDragged: PnsLine | null = null;

    let lastPreDrag: Seg = ZERO_SEG;
    let primaryDir = Direction45.UNDEFINED;
    let perp: Vec2 = { x: 0, y: 0 };
    let primaryLastSegDir = Direction45.UNDEFINED;

    let completed: MdragLine[] = [];

    const tryPosture = (aVariant: number): boolean => {
      let primaryLine: MdragLine | null = null;

      for (const l of this.mMdragLines) {
        l.dragOK = false;
        l.preDragLine = l.originalLine.clone();

        if (l.isPrimaryLine) {
          // A copy of the primary line, pre-drag and post-drag. The pre-drag
          // version is what lets NODE::Remove() find the segments as they were
          // before the multidrag algorithm modified them.
          primaryDragged = l.originalLine.clone();
          primaryDragged.clearLinks();
          primaryPreDrag = l.originalLine.clone();
          primaryLine = l;
        }
      }

      // Upstream dereferences primaryPreDrag here with no null check; with no
      // primary line at all that is a crash.
      const pre = primaryPreDrag as PnsLine;
      const dragged = primaryDragged as PnsLine;

      if (aVariant === 1 && pre.pointCount() > 2) {
        pre.line().removePoint(pre.pointCount() - 1);
        dragged.line().removePoint(dragged.pointCount() - 1);

        for (const l of this.mMdragLines) {
          l.preDragLine.line().removePoint(l.preDragLine.pointCount() - 1);
        }
      }

      completed = [];

      const snapThreshold = this.settings().smoothDraggedSegments
        ? Math.trunc(dragged.width() / 4)
        : 0;

      if (this.mDragMode === PnsDragMode.DM_CORNER) {
        // First, drag only the primary line.
        lastPreDrag = pre.cLine().cSegment(pre.segmentCount() - 1);
        primaryDir = Direction45.fromSeg(lastPreDrag.a, lastPreDrag.b);

        dragged.setSnapThreshhold(snapThreshold);
        lineDragCorner(dragged, aP, dragged.pointCount() - 1, false);

        if (dragged.segmentCount() > 0) {
          let lastPrimDrag = dragged.cLine().cSegment(dragged.segmentCount() - 1);

          if (aVariant === 2) lastPrimDrag = lastPreDrag;

          const lastSeg = dragged.cLine().cSegment(dragged.segmentCount() - 1);

          if (!Direction45.fromSeg(lastSeg.a, lastSeg.b).equals(primaryDir)) {
            const len = Math.hypot(lastSeg.b.x - lastSeg.a.x, lastSeg.b.y - lastSeg.a.y);

            if (len < dragged.width()) lastPrimDrag = lastPreDrag;
          }

          perp = perpendicular(sub(lastPrimDrag.b, lastPrimDrag.a));
          primaryLastSegDir = Direction45.fromSeg(lastPrimDrag.a, lastPrimDrag.b);
        } else {
          return false;
        }
      } else {
        const leaderIdx = (primaryLine as MdragLine).leaderSegIndex;

        lastPreDrag = dragged.cLine().cSegment(leaderIdx);
        dragged.setSnapThreshhold(snapThreshold);
        lineDragSegment(dragged, aP, leaderIdx);
        perp = perpendicular(
          sub((primaryLine as MdragLine).midSeg.b, (primaryLine as MdragLine).midSeg.a),
        );
        this.mGuide = { a: aP, b: add(aP, perp) };
      }

      // Overwritten by restoreLeaderSegments on every success path; upstream
      // assigns it here anyway.
      this.mLeaderSegments = [...this.mOrigDraggedItems.citems()];
      this.mDraggedItems.clear();

      // Now drag all other lines.
      for (const l of this.mMdragLines) {
        if (l.isDraggable) {
          l.dragOK = false;

          // Reject nulls.
          if (l.preDragLine.segmentCount() >= 1) {
            // Check the direction of the last segment of the line against the
            // direction of the last segment of the primary line (both before
            // dragging) and perform the drag only when the directions are the
            // same. The algorithm is quite trivial and would otherwise produce
            // really awkward results.
            if (this.mDragMode === PnsDragMode.DM_CORNER) {
              const lastPre = l.preDragLine.cLine().cSegment(l.preDragLine.segmentCount() - 1);
              const parallelDir = Direction45.fromSeg(lastPre.a, lastPre.b);

              const leadAngle = primaryDir.angle(parallelDir);

              if (
                leadAngle === AngleType.ANG_OBTUSE ||
                leadAngle === AngleType.ANG_RIGHT ||
                leadAngle === AngleType.ANG_STRAIGHT
              ) {
                // Distance between the primary line and the last point of the
                // line being processed...
                const dist = segLineDistance(lastPreDrag, l.preDragLine.cLastPoint(), true);

                // ...projected onto the perpendicular computed above.
                const projected = add(aP, resizeVec(perp, dist));

                const parallelDragged = l.preDragLine.clone();

                parallelDragged.clearLinks();
                lineDragCorner(
                  parallelDragged,
                  projected,
                  parallelDragged.pointCount() - 1,
                  false,
                  primaryLastSegDir,
                );

                // DragCorner can collapse a very short secondary line to a
                // single point; skip it so the later CSegment(-1) check stays
                // valid.
                if (parallelDragged.segmentCount() < 1) continue;

                l.dragOK = true;

                if (!l.isPrimaryLine) {
                  l.draggedLine = parallelDragged;
                  completed.push(l);
                  this.mDraggedItems.addLine(parallelDragged);
                }
              }
            } else if (this.mDragMode === PnsDragMode.DM_SEGMENT) {
              const sdrag = l.midSeg;
              const refDir = Direction45.fromSeg(lastPreDrag.a, lastPreDrag.b);
              const curDir = Direction45.fromSeg(sdrag.a, sdrag.b);
              const ang = refDir.angle(curDir);

              if (ang & (AngleType.ANG_HALF_FULL | AngleType.ANG_STRAIGHT)) {
                const dist = segLineDistance(
                  lastPreDrag,
                  l.preDragLine.cLine().cPoint(l.leaderSegIndex),
                  true,
                );
                const projected = add(aP, resizeVec(perp, dist));

                const sperp: Seg = { a: aP, b: add(aP, resizeVec(perp, 10000000)) };
                const startProj = segLineProject(sperp, this.mDragStartPoint);

                const v = sub(projected, startProj);

                l.dragDist = Math.trunc(Math.hypot(v.x, v.y)) * sign(dot(v, perp));
                l.dragOK = true;

                if (!l.isPrimaryLine) {
                  l.draggedLine = l.preDragLine.clone();
                  l.draggedLine.clearLinks();
                  l.draggedLine.setSnapThreshhold(snapThreshold);
                  lineDragSegment(l.draggedLine, projected, l.leaderSegIndex, false);
                  completed.push(l);
                }
              }
            }
          }
        }

        if (l.isPrimaryLine) {
          l.draggedLine = dragged.clone();
          l.dragOK = true;
          completed.push(l);
        }
      }

      if (this.mDragMode === PnsDragMode.DM_SEGMENT) return true;

      for (const l of completed) {
        if (!l.dragOK && aVariant < 2) return false;

        if (l.isPrimaryLine) continue;

        // A degenerate dragged line has no last segment to read a direction
        // from; reject this posture so the next variant is attempted.
        if (l.draggedLine.segmentCount() < 1) return false;

        const last = l.draggedLine.cLine().cSegment(l.draggedLine.segmentCount() - 1);

        if (!Direction45.fromSeg(last.a, last.b).equals(primaryLastSegDir)) return false;
      }

      return true;
    };

    for (let variant = 0; variant < 3; variant++) {
      if (tryPosture(variant)) break;
    }

    switch (this.settings().routingMode) {
      case PnsMode.RM_Walkaround:
        this.mDragStatus = this.multidragWalkaround(completed);
        break;

      case PnsMode.RM_Shove:
        this.mDragStatus = this.multidragShove(completed);
        break;

      case PnsMode.RM_MarkObstacles:
        this.mDragStatus = this.multidragMarkObstacles(completed);
        break;

      default:
        break;
    }

    return this.mDragStatus;
  }
}
