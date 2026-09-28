// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Walking the connectivity graph past the end of a single line.
 * Counterpart: `pcbnew/router/pns_topology.cpp` (`TOPOLOGY`), complete.
 *
 * ## What is here, and what upstream declares but never defines
 *
 * Every function `pns_topology.cpp` defines is ported: `SimplifyLine`,
 * `AssembleTrivialPath` with its two private walks, `ConnectedJoints`,
 * `NearestUnconnectedItem`, `NearestUnconnectedAnchorPoint`, `LeadingRatLine`,
 * `AssembleCluster`, `AssembleDiffPair`, `AssembleTuningPath` with
 * `findLinesFromVia` and `walkTuningPath`, and the two `ConnectedItems` stubs.
 *
 * Three members are declared in `pns_topology.h` and **have no definition
 * anywhere in KiCad** — `int64_t ShortestConnectionLength( ITEM*, ITEM* )`
 * (h:70) and `const DIFF_PAIR AssembleDiffPair( SEGMENT* )` (h:99). A call to
 * either would not link. They are not ported because there is nothing to port.
 *
 * ## `LeadingRatLine` does not need board connectivity
 *
 * Earlier notes in this file said it did, and two ports left it behind a host
 * hook on that basis. It does not: the chain is `NearestUnconnectedAnchorPoint`
 * → `NearestUnconnectedItem` → `NODE::AllItemsInNet`, which reads the router
 * node's **own index**. No ratsnest, no `BOARD`. It is ported outright.
 *
 * ## `AssembleTuningPath` is the one thing that needs a host
 *
 * Its three post-processing passes clip the assembled trace inside pads and
 * vias, and those are `LENGTH_DELAY_CALCULATION` calls against a live `BOARD`.
 * They sit behind {@link PnsTuningHost}, which is optional — see that
 * interface, and see `assembleTuningPath` for what upstream does when the
 * items' parents are not board pads and vias, which is the same thing.
 *
 * ## What "trivial path" means, and why it is not trivial
 *
 * `NODE::AssembleLine` stops at the first non-trivial joint: a fanout, a pad, a
 * via. `AssembleTrivialPath` carries on *through* those, which is what the
 * length tuner needs — a differential pair that changes layer three times is one
 * path to the user and six lines to the node.
 *
 * The continuation is a **depth-first search that keeps the longest terminal
 * path**, not a walk. At a fanout there is no single "next", so upstream tries
 * every branch and takes whichever runs furthest, with a per-path set of
 * visited joints to stop it going round in circles and a wall-clock budget to
 * stop it exploring a dense plane forever.
 *
 * ## The timeout is real, and it is a parameter here
 *
 * Upstream reads `ADVANCED_CFG::m_FollowBranchTimeout`, whose default is 500 ms
 * (`common/advanced_config.cpp:340`), and *returns the best path found so far*
 * when it expires. That makes the result of a search over a big enough graph
 * machine-dependent — which is upstream's design, not an accident, and is
 * reproduced. It is a constructor argument so that a test can pin the timeout
 * path deterministically instead of racing it.
 *
 * ## The global visited set is seeded and then never added to
 *
 * `followTrivialPath` fills `visited` with the seed line's links and hands the
 * same set to both branch searches, which only ever *read* it. A segment
 * reachable from both ends is therefore assembled twice and can appear in the
 * path twice. Upstream's; kept.
 */
import { PnsItemSet } from './pns_itemset.js';
import { LineMarker, PnsKind, PnsLinkedItem, type PnsItem } from './pns_item.js';
import { ObstacleSet, getShapeCollider } from './pns_collision.js';
import { DiffPair } from './pns_diff_pair.js';
import type { PnsLineChain } from './pns_line_item.js';
import { segApproxParallel } from './pns_seg_ops.js';
import { arcRadius, shapeArcCenter } from './shape_arc_ops.js';
import { commonParallelProjection } from '../drc/drc_diff_pair.js';
import { shapeBBox, shapeDist } from '../drc/drc_geometry.js';
import { segSquaredDistanceToSeg } from '@ziroeda/kimath/src/geometry/seg.js';
import type { PnsArc } from './pns_arc.js';
import type { NetHandle } from './pns_collision.js';
import type { PnsJoint } from './pns_joint.js';
import type { PnsLayerRange } from './pns_layerset.js';
import type { PnsLine } from './pns_line_item.js';
import type { TuningPathResult } from './pns_meander_placer_base.js';
import type { PnsNode } from './pns_node.js';
import type { PnsSegment } from './pns_segment.js';
import type { PnsSolid } from './pns_solid.js';
import type { PnsVia } from './pns_via.js';
import type { Shape } from '../drc/drc_geometry.js';
import { EuclideanNormI } from '@ziroeda/kimath/src/math/vector2.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** `VECTOR2I::SquaredEuclideanNorm` of a difference. */
const squaredDistance = (a: Vec2, b: Vec2): number => {
  const d = sub(a, b);

  return d.x * d.x + d.y * d.y;
};

/** `TOPOLOGY::DP_PARALLELITY_THRESHOLD` — `pns_topology.h:106`. */
export const DP_PARALLELITY_THRESHOLD = 5;

/** `VECTOR2::Cross`. */
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

/** `SEG::Square`. */
const square = (v: number): number => v * v;

/** A zero-radius circle: upstream treats a point as an infinitely small one. */
const pointShape = (aPoint: Vec2): Shape => ({ kind: 'circle', c: aPoint, r: 0 });

/** `BOX2I`, as `AssembleCluster` uses one. */
interface TopoBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** `BOX2I::Merge`. */
const mergeBox = (a: TopoBox, b: TopoBox): TopoBox => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

/** `BOX2I::GetArea()`. */
const boxArea = (b: TopoBox): number => (b.maxX - b.minX) * (b.maxY - b.minY);

/**
 * `SHAPE::Centre()`, whose base implementation is `BBox( 0 ).Centre()`
 * (`shape.h`). Every shape this file feeds it uses that base.
 */
const shapeCentre = (s: Shape): Vec2 => {
  const b = shapeBBox(s);

  // `BOX2I::Centre()` is `m_Pos + m_Size / 2` in integer arithmetic.
  return {
    x: b.minX + Math.trunc((b.maxX - b.minX) / 2),
    y: b.minY + Math.trunc((b.maxY - b.minY) / 2),
  };
};

/**
 * `SHAPE::SquaredDistance( aP )`.
 *
 * Upstream buffers the shape into a polygon and asks the outline for an exact
 * integer squared distance (`shape.cpp:111-119`). Here it is
 * `shapeDist( shape, point )²`, which is float-rounded. It is only ever used as
 * a comparison key inside `AssembleDiffPair`'s candidate search, where the
 * competitors are whole segments apart; a rounding difference cannot change the
 * winner without the two candidates being sub-IU apart from the target, at
 * which point upstream's own choice is arbitrary too.
 */
const shapeSquaredDistanceToPoint = (s: Shape, aP: Vec2): number =>
  square(shapeDist(s, pointShape(aP)));

/** `ADVANCED_CFG::m_FollowBranchTimeout` — `common/advanced_config.cpp:340`. */
export const PNS_FOLLOW_BRANCH_TIMEOUT_MS = 500;

/** `TOPOLOGY::PATH_RESULT` — `pns_topology.h:108-115`. */
export interface PnsPathResult {
  items: PnsItemSet;
  end: PnsJoint | null;
  length: number;
}

/** One entry of `followBranch`'s explicit DFS stack — `pns_topology.cpp:243-251`. */
interface BranchState {
  joint: PnsJoint | null;
  prev: PnsLinkedItem | null;
  pathItems: PnsItemSet;
  pathLength: number;
  visitedJoints: Set<PnsJoint | null>;
  via: PnsItem | null;
}

/** The two terminal joints `AssembleTrivialPath` optionally reports. */
export interface PnsTerminalJoints {
  a: PnsJoint | null;
  b: PnsJoint | null;
}

/**
 * `TOPOLOGY::CLUSTER` (`pns_topology.h:46-50`).
 *
 * `m_key` is declared upstream and **never assigned by anything**, so every
 * cluster any caller has ever seen carries a null key. Kept, rather than
 * quietly dropped, because a reader of `AssembleCluster` will look for it.
 *
 * `pns_shove.ts` declares a private structural twin of this, written when
 * `PnsTopology` carried only `assembleTrivialPath`. It is deliberately left
 * where it is — see this file's commit message.
 */
export interface PnsCluster {
  key: PnsItem | null;
  items: PnsItem[];
}

/** What {@link PnsTopology.nearestUnconnectedItem} answers with. */
export interface PnsNearestUnconnected {
  item: PnsItem;
  /** `*aAnchor`: the index of `item`'s anchor that was nearest. */
  anchor: number;
}

/** What {@link PnsTopology.nearestUnconnectedAnchorPoint} answers with. */
export interface PnsUnconnectedAnchor {
  point: Vec2;
  layers: PnsLayerRange;
  item: PnsItem;
}

/**
 * An opaque `PCB_VIA*` / `PAD*`. `AssembleTuningPath` never looks inside one; it
 * only tests it for null and hands it back to the length calculator.
 */
export type PnsBoardViaHandle = object;
export type PnsBoardPadHandle = object;

/**
 * The `ROUTER_IFACE` and `LENGTH_DELAY_CALCULATION` calls `AssembleTuningPath`
 * makes, and the only part of `pns_topology.cpp` that cannot be ported into
 * this tree.
 *
 * All four need the live `BOARD`: `OptimiseTraceInPad`/`OptimiseTraceInVia`
 * clip a trace against a pad's effective polygon or a via's effective shape on
 * a given board layer, and `IsPointInsideViaPad` is the same question for a
 * point. `pcbnew/length_delay_calculation/` has no counterpart here, exactly as
 * `MeanderRouterIface` says of its own calls.
 *
 * **The host is optional and its absence is not a degraded mode.** Upstream
 * guards every one of these behind `parent && parent->Type() == PCB_VIA_T` (or
 * `PCB_PAD_T`), and a `PNS::VIA`/`PNS::SOLID` synthesised by the router rather
 * than read off a board has no such parent. With no host, this port takes those
 * same `else` branches: the anchor test in `findLinesFromVia` falls back to
 * `aVia->Shape( aVia->Layer() )->Collide( anchor, 0 )` (which is upstream's own
 * fallback at `pns_topology.cpp:586-589`), continuation lengths are the plain
 * chain length, and `AssembleTuningPath` returns at its `if( !padA && !padB )`
 * (line 910). The `SOLID*` start/end pads are still reported either way —
 * those are router items, not board items.
 */
export interface PnsTuningHost {
  /** `ROUTER_IFACE::GetBoardLayerFromPNSLayer( aLayer )`. */
  getBoardLayerFromPNSLayer(aLayer: number): number;

  /**
   * `via->Parent()->Type() == PCB_VIA_T ? static_cast<const PCB_VIA*>( … ) : nullptr`.
   */
  boardVia(aVia: PnsVia): PnsBoardViaHandle | null;

  /** `solid->Parent()->Type() == PCB_PAD_T ? static_cast<PAD*>( … ) : nullptr`. */
  boardPad(aSolid: PnsSolid): PnsBoardPadHandle | null;

  /** `LENGTH_DELAY_CALCULATION::IsPointInsideViaPad( aVia, aPoint, aBoardLayer )`. */
  isPointInsideViaPad(aVia: PnsBoardViaHandle, aPoint: Vec2, aBoardLayer: number): boolean;

  /** `LENGTH_DELAY_CALCULATION::OptimiseTraceInVia( aLine, aVia, aBoardLayer )` — mutates `aLine`. */
  optimiseTraceInVia(aLine: PnsLineChain, aVia: PnsBoardViaHandle, aBoardLayer: number): void;

  /** `LENGTH_DELAY_CALCULATION::OptimiseTraceInPad( aLine, aPad, aBoardLayer )` — mutates `aLine`. */
  optimiseTraceInPad(aLine: PnsLineChain, aPad: PnsBoardPadHandle, aBoardLayer: number): void;
}

/** `TOPOLOGY::WALK_RESULT` — `pns_topology.h:117-128`. */
interface WalkResult {
  items: PnsItemSet;
  endPad: PnsSolid | null;
  /** Starts at **-1**, so a zero-length terminal state still wins once. */
  length: number;
}

/** One entry of `walkTuningPath`'s explicit DFS stack — `pns_topology.cpp:622-628`. */
interface WalkState {
  endpoint: Vec2;
  pathItems: PnsItemSet;
  pathLength: number;
  visited: Set<PnsItem>;
}

/** `TOPOLOGY`. */
export class PnsTopology {
  private readonly mWorld: PnsNode;
  private readonly mFollowBranchTimeoutMs: number;

  constructor(aNode: PnsNode, aFollowBranchTimeoutMs = PNS_FOLLOW_BRANCH_TIMEOUT_MS) {
    this.mWorld = aNode;
    this.mFollowBranchTimeoutMs = aFollowBranchTimeoutMs;
  }

  /**
   * Every item on the trivial path through `aStart`.
   *
   * A `VIA` start is only accepted if its joint is a **non-fanout** via —
   * exactly two segment links plus the via — and the walk then begins at the
   * first segment or arc it finds there. Anything that is not a via, a segment
   * or an arc yields an empty set, and so does a fanout via.
   *
   * The joint lookup for a via is dereferenced with no null check upstream
   * (`pns_topology.cpp:477-478`); a via that is in the index but not in the
   * joint map crashes there and throws here.
   */
  assembleTrivialPath(
    aStart: PnsItem,
    aTerminalJoints: PnsTerminalJoints | null = null,
    aFollowLockedSegments = false,
  ): PnsItemSet {
    let seg: PnsLinkedItem | null = null;

    if (aStart.kind() === PnsKind.VIA_T) {
      const via = aStart as PnsVia;
      const jt = this.mWorld.findJointForItem(via.pos(), via);

      if (!jt) throw new Error('PNS: TOPOLOGY::AssembleTrivialPath() on a via with no joint');

      if (!jt.isNonFanoutVia()) return new PnsItemSet();

      for (const item of jt.cLinks().citems()) {
        if (item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
          seg = item as PnsLinkedItem;
          break;
        }
      }
    } else if (aStart.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
      seg = aStart as PnsLinkedItem;
    }

    if (!seg) return new PnsItemSet();

    // Assemble a line following through locked segments.
    // TODO: consider if we want to allow tuning lines with different widths.
    const l = this.mWorld.assembleLine(seg, null, false, aFollowLockedSegments);
    const result = this.followTrivialPath(l, aFollowLockedSegments);

    if (aTerminalJoints) {
      aTerminalJoints.a = result.terminalA;
      aTerminalJoints.b = result.terminalB;
    }

    return result.path;
  }

  /**
   * Extend a line past both of its ends and glue the three pieces together.
   *
   * The left result is **prepended item by item**, so it lands in the path in
   * reverse of the order the search produced it; the right result is appended
   * in order. That asymmetry is upstream's and it is what makes the path read
   * end-to-end.
   */
  private followTrivialPath(
    aLine: PnsLine,
    aFollowLockedSegments: boolean,
  ): { path: PnsItemSet; terminalA: PnsJoint | null; terminalB: PnsJoint | null } {
    if (!aLine.isLinked()) {
      throw new Error('PNS: TOPOLOGY::followTrivialPath() on an unlinked line');
    }

    const path = new PnsItemSet();

    path.addLine(aLine);

    const visited = new Set<PnsItem>();

    for (const link of aLine.links()) visited.add(link);

    const jtA = this.mWorld.findJointForItem(aLine.cPoint(0), aLine);
    const jtB = this.mWorld.findJointForItem(aLine.cLastPoint(), aLine);

    const left = this.followBranch(jtA, aLine.getLink(0) ?? null, visited, aFollowLockedSegments);
    const right = this.followBranch(jtB, aLine.getLink(-1) ?? null, visited, aFollowLockedSegments);

    for (const item of left.items.citems()) path.prepend(item);

    for (const item of right.items.citems()) path.add(item);

    return { path, terminalA: left.end, terminalB: right.end };
  }

  /**
   * Depth-first from a joint, keeping the longest path that ends nowhere.
   *
   * Points that decide the answer, all of them upstream's:
   *
   *  - **Longest wins, and only terminal paths count.** A state that found any
   *    branch to push does not compete; only a joint with nothing left to
   *    explore updates `best`. The comparison is strict `>`, so among equal
   *    lengths the *first* terminal reached keeps it — and the stack makes that
   *    the last branch pushed.
   *  - **`visitedJoints` is per path, `aVisited` is global and read-only.** A
   *    path cannot revisit its own joints; two different paths can share
   *    everything.
   *  - **`null` is a legitimate member of `visitedJoints`.** `FindJoint` can
   *    answer null, upstream inserts that null, and the second null next-joint
   *    on a path is then skipped by the membership test rather than explored.
   *  - **The via is carried across the joint**, once per branch, and it is
   *    chosen before the branch loop from the first unvisited via link.
   *  - **The timeout returns the best found so far**, which makes a search over
   *    a large enough graph machine-dependent.
   */
  private followBranch(
    aStartJoint: PnsJoint | null,
    aPrev: PnsLinkedItem | null,
    aVisited: Set<PnsItem>,
    aFollowLockedSegments: boolean,
  ): PnsPathResult {
    const best: PnsPathResult = { items: new PnsItemSet(), end: aStartJoint, length: 0 };
    const startTime = Date.now();

    const stack: BranchState[] = [
      {
        joint: aStartJoint,
        prev: aPrev,
        pathItems: new PnsItemSet(),
        pathLength: 0,
        visitedJoints: new Set<PnsJoint | null>([aStartJoint]),
        via: null,
      },
    ];

    while (stack.length > 0) {
      if (Date.now() - startTime > this.mFollowBranchTimeoutMs) break;

      const current = stack.pop() as BranchState;
      const joint = current.joint;

      // Upstream dereferences `joint` unconditionally here.
      if (!joint) throw new Error('PNS: TOPOLOGY::followBranch() reached a null joint');

      const links = joint.cLinks();

      // Check for a via at this joint.
      let via: PnsItem | null = null;

      for (const link of links.citems()) {
        if (link.ofKind(PnsKind.VIA_T) && !aVisited.has(link)) {
          via = link;
          break;
        }
      }

      // Find all unvisited branches from this joint.
      let foundBranch = false;

      for (const link of links.citems()) {
        if (!link.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) continue;

        if (link === current.prev) continue;

        if (aVisited.has(link)) continue;

        const l = this.mWorld.assembleLine(
          link as PnsLinkedItem,
          null,
          false,
          aFollowLockedSegments,
        );

        if (!samePoint(l.cPoint(0), joint.pos())) l.reverse();

        const nextJoint = this.mWorld.findJointForItem(l.cLastPoint(), l);

        // Skip if we've already visited this joint in the current path.
        if (current.visitedJoints.has(nextJoint)) continue;

        foundBranch = true;

        const nextState: BranchState = {
          joint: nextJoint,
          prev: l.getLink(-1) ?? null,
          pathItems: current.pathItems.clone(),
          pathLength: current.pathLength + l.cLine().length(),
          visitedJoints: new Set(current.visitedJoints),
          via,
        };

        nextState.visitedJoints.add(nextJoint);

        // Add via and line to path.
        if (via) nextState.pathItems.add(via);

        nextState.pathItems.addLine(l);

        stack.push(nextState);
      }

      // If no branches found, this is a terminal joint — check if it's the best.
      if (!foundBranch) {
        if (current.pathLength > best.length) {
          best.length = current.pathLength;
          best.end = joint;
          best.items = current.pathItems;
        }
      }
    }

    return best;
  }

  /**
   * `TOPOLOGY::SimplifyLine`: collapse the colinear runs out of whatever line
   * `aLine` belongs to, in the node.
   *
   * Three things about it are easy to get wrong:
   *
   *  1. **The argument is a handle, not the subject.** Only `aLine`'s *first
   *     link* is read; the line that is actually simplified is the one
   *     `assembleLine` builds from that link, which may be longer than `aLine`
   *     at both ends. A caller that has just added two lines and simplifies each
   *     in turn can therefore find the second call operating on a line the first
   *     one already replaced.
   *  2. The rewrite is **conditional on the point count changing**. `Simplify`
   *     with the default tolerance only removes colinear vertices, so an
   *     already-clean line is left in the node untouched — identity included,
   *     which matters because the caller may still hold pointers into it.
   *  3. `aLine` itself is never modified. The return value is the only signal
   *     that anything happened, and `DIFF_PAIR_PLACER::FixRoute` ignores it.
   *
   * `assembleLine`'s fifth argument is passed explicitly: upstream's
   * `AssembleLine( root, nullptr, false, false, false )` forbids a segment-size
   * mismatch, where this port's default allows one.
   */
  simplifyLine(aLine: PnsLine): boolean {
    if (!aLine.isLinked() || !aLine.segmentCount()) return false;

    const root = aLine.getLink(0);

    if (!root) return false;

    const l = this.mWorld.assembleLine(root, null, false, false, false);
    const simplified = l.cLine().clone();

    simplified.simplify();

    if (simplified.pointCount() !== l.pointCount()) {
      this.mWorld.removeLine(l);

      // `LINE lnew( l )` copies a line whose links `Remove` has just cleared,
      // which is the only reason the `Add` below is legal.
      const lnew = l.clone();

      lnew.setShape(simplified);
      this.mWorld.addLine(lnew);

      return true;
    }

    return false;
  }

  // ----- connectivity walks ------------------------------------------------------

  /**
   * `TOPOLOGY::ConnectedJoints` (`cpp:73-104`): every joint reachable from
   * `aStart` by walking segments and arcs.
   *
   * Three things decide what comes back:
   *
   *  - **Only `SEGMENT_T | ARC_T` links are walked.** A via is not a step; the
   *    walk crosses layers only because the segments on both sides of a via
   *    share its joint.
   *  - **`processed` is keyed on identity, `next` is chosen by value.** The
   *    `*a == *current` at `cpp:92` is `JOINT::operator==`, which compares the
   *    *tag* — position and net, not the layer span and not the pointer — while
   *    the set that stops the walk repeating is a `std::set<const JOINT*>`.
   *    Both are kept as written.
   *  - Because the choice is `( *a == *current ) ? b : a`, a **zero-length**
   *    segment whose two anchors land on the same joint answers `b`, i.e.
   *    itself, and is dropped by the `processed` test on the next line.
   *
   * `FindJoint` is dereferenced unguarded at `cpp:90-91`. An item in the index
   * whose anchor carries no joint is UB upstream and throws here.
   */
  connectedJoints(aStart: PnsJoint): Set<PnsJoint> {
    const searchQueue: PnsJoint[] = [aStart];
    const processed = new Set<PnsJoint>([aStart]);

    while (searchQueue.length > 0) {
      const current = searchQueue.shift() as PnsJoint;

      for (const item of current.linkList()) {
        if (item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
          const a = this.mWorld.findJointForItem(item.anchor(0), item);
          const b = this.mWorld.findJointForItem(item.anchor(1), item);

          if (!a || !b) {
            throw new Error('PNS: TOPOLOGY::ConnectedJoints() — a link anchor with no joint');
          }

          const next = a.equals(current) ? b : a;

          if (!processed.has(next)) {
            processed.add(next);
            searchQueue.push(next);
          }
        }
      }
    }

    return processed;
  }

  /**
   * `TOPOLOGY::NearestUnconnectedItem` (`cpp:185-225`): the nearest item on
   * `aStart`'s net that `aStart` is *not* already galvanically joined to.
   *
   * "Not connected" is computed entirely inside the node — `AllItemsInNet` reads
   * the node's own index — so this needs no board ratsnest, and neither does
   * {@link leadingRatLine} above it. That is worth saying plainly, because both
   * earlier ports through this file assumed otherwise and left the caller a host
   * hook instead.
   *
   * `aAnchor` upstream is an out-parameter written **only when the distance
   * improves**, so it ends up as the index of `best`'s nearest anchor; when
   * nothing is found it is never written at all, and `NearestUnconnectedAnchorPoint`
   * only escapes reading it uninitialised because it checks the item first
   * (`cpp:155-156`). Returning the pair makes the coupling impossible to get
   * wrong.
   *
   * The distance is `VECTOR2I::EuclideanNorm`, i.e. **truncated to an int**, and
   * the comparison is strict `<` — among equal distances the first candidate
   * seen wins, and upstream's "first" is `std::set<ITEM*>` pointer order, which
   * is arbitrary. Ties here resolve in the index's insertion order instead. It
   * is not a difference any well-formed board can observe and it is not pinned.
   */
  nearestUnconnectedItem(
    aStart: PnsJoint,
    aKindMask = PnsKind.ANY_T,
  ): PnsNearestUnconnected | null {
    const disconnected = this.mWorld.allItemsInNet(aStart.net());

    for (const jt of this.connectedJoints(aStart)) {
      for (const link of jt.linkList()) {
        if (disconnected.has(link)) disconnected.delete(link);
      }
    }

    let bestDist = 2147483647; // INT_MAX
    let best: PnsItem | null = null;
    let anchor = 0;

    for (const item of disconnected) {
      if (item.ofKind(aKindMask)) {
        for (let i = 0; i < item.anchorCount(); i++) {
          const p = item.anchor(i);
          const d = EuclideanNormI(sub(p, aStart.pos()));

          if (d < bestDist) {
            bestDist = d;
            best = item;
            anchor = i;
          }
        }
      }
    }

    return best ? { item: best, anchor } : null;
  }

  /**
   * `TOPOLOGY::NearestUnconnectedAnchorPoint` (`cpp:107-165`): where the ratline
   * hanging off the end of `aTrack` should point.
   *
   * The whole thing runs in a **throw-away branch**. `aTrack` is copied, its
   * links are cleared, and the copy is added to the branch — which makes fresh
   * segments there — so that `FindJoint` at the track's last point sees whatever
   * the track has just landed on. Upstream's `unique_ptr` frees the branch on
   * every return path; the `finally` here does the same, and also on a throw,
   * which matters because a leaked branch stays in `m_world`'s children set and
   * would be destroyed by the next unrelated `Commit`.
   *
   * Two subtleties:
   *
   *  - **The link-count thresholds count the track itself.** Two links (three if
   *    the track ends in a via, because the via is a link too) means something
   *    other than the track is at that joint. The `!link->BelongsTo( tmpNode )`
   *    filter then skips the branch's own copies — upstream's comment says why:
   *    they are freed on return and the caller would be left with a dangling
   *    anchor item.
   *  - **The `connected` branch reports the joint's layers, not the item's.**
   *    Only the fallback branch reads layers off the item it found.
   *
   * `GetRuleResolver()` is dereferenced unguarded at `cpp:123`, but only after
   * the `!jt` short-circuit — so a null resolver with no joint returns false
   * upstream rather than crashing, and that ordering is preserved here.
   */
  nearestUnconnectedAnchorPoint(aTrack: PnsLine): PnsUnconnectedAnchor | null {
    const track = aTrack.clone();

    if (!track.pointCount()) return null;

    const tmpNode = this.mWorld.branch();

    try {
      track.clearLinks();
      tmpNode.addLine(track);

      const jt = tmpNode.findJointForItem(track.cLastPoint(), track);

      if (!jt) return null;

      const resolver = this.mWorld.getRuleResolver();

      if (!resolver) {
        throw new Error('PNS: TOPOLOGY::NearestUnconnectedAnchorPoint() with no rule resolver');
      }

      if (resolver.netCode(jt.net()) <= 0) return null;

      let connected: PnsItem | null = null;

      if (
        (!track.endsWithVia() && jt.linkCount() >= 2) ||
        (track.endsWithVia() && jt.linkCount() >= 3)
      ) {
        // tmpNode's own track is freed on return, skip it to avoid a dangling
        // anchor item.
        for (const link of jt.linkList()) {
          if (!link.belongsTo(tmpNode)) {
            connected = link;
            break;
          }
        }
      }

      if (connected) return { point: jt.pos(), layers: jt.layers(), item: connected };

      const topo = new PnsTopology(tmpNode, this.mFollowBranchTimeoutMs);
      const it = topo.nearestUnconnectedItem(jt);

      if (!it) return null;

      return { point: it.item.anchor(it.anchor), layers: it.item.layers(), item: it.item };
    } finally {
      tmpNode.destroy();
    }
  }

  /**
   * `TOPOLOGY::LeadingRatLine` (`cpp:168-182`): the two-point rubber band from
   * the end of a track to whatever it still has to reach.
   *
   * `aRatLine` is cleared **only on success** — the `Clear()` is after the early
   * `return false`, so a caller that keeps one chain across frames keeps last
   * frame's ratline whenever this fails. `LINE_PLACER::updateLeadingRatLine` and
   * `DIFF_PAIR_PLACER::updateLeadingRatLine` both pass a fresh local, so neither
   * observes it; it is still upstream's contract and it is kept.
   */
  leadingRatLine(aTrack: PnsLine, aRatLine: PnsLineChain): boolean {
    const end = this.nearestUnconnectedAnchorPoint(aTrack);

    if (!end) return false;

    aRatLine.clear();
    aRatLine.appendPoint(aTrack.cLastPoint());
    aRatLine.appendPoint(end.point);

    return true;
  }

  /**
   * `TOPOLOGY::ConnectedItems( const JOINT*, int )` (`cpp:1021-1024`).
   *
   * Upstream's body is `return ITEM_SET();` — declared, never implemented, and
   * called by nothing. Ported as the stub it is rather than left out, so that a
   * reader who finds the declaration in the header finds the answer here.
   */
  connectedItems(_aStart: PnsJoint | PnsItem, _aKindMask = PnsKind.ANY_T): PnsItemSet {
    return new PnsItemSet();
  }

  // ----- clusters ----------------------------------------------------------------

  /**
   * `TOPOLOGY::AssembleCluster` (`cpp:1187-1256`): the blob of items *touching*
   * `aStart`, grown breadth-first.
   *
   * "Touching", not "in violation": the query runs with `overrideClearance = 0`
   * and `differentNetsOnly = false`, so it finds actual contact and it finds it
   * on the item's own net too.
   *
   * The five things that decide the answer:
   *
   *  1. **Track-on-track across nets is not contact.** Two crossing segments on
   *     different nets are two obstacles, not one cluster — but a segment
   *     touching a *pad* of another net is, which is what makes the exclusion
   *     `SEGMENT_T` on both sides rather than a net test.
   *  2. **The bounding box grows for every obstacle**, including the ones the
   *     `Overlaps` / `MK_HEAD` test then refuses to admit. An item that never
   *     joins the cluster can still be what trips the area limit.
   *  3. **A segment or arc contributes its whole assembled line's box**, not its
   *     own — one segment of a long track drags the entire track's extent into
   *     the limit calculation.
   *  4. **The area `break` leaves the outer loop running.** It abandons the rest
   *     of *this* item's obstacles; everything already queued is still expanded,
   *     so the cluster can keep growing after the limit is hit.
   *  5. `aStart` is admitted at *pop* time and everything else at *discovery*
   *     time. With a FIFO those produce the same order, which is why the two
   *     spellings can sit side by side upstream without disagreeing.
   *
   * `aStart->Shape( aLayer )` is dereferenced unguarded at `cpp:1199`; an item
   * with no shape on that layer throws here.
   *
   * `CLUSTER::m_key` is declared upstream and assigned by nothing, anywhere. It
   * is null on every cluster this returns, as it is on every cluster upstream
   * returns.
   */
  assembleCluster(
    aStart: PnsItem,
    aLayer: number,
    aAreaExpansionLimit = 0.0,
    aExcludedNet: NetHandle = null,
  ): PnsCluster {
    const cluster: PnsCluster = { key: null, items: [] };
    const pending: PnsItem[] = [aStart];

    const startShape = aStart.shape(aLayer);

    if (!startShape) {
      throw new Error('PNS: TOPOLOGY::AssembleCluster() on an item with no shape on that layer');
    }

    let clusterBBox = shapeBBox(startShape);
    const initialArea = boxArea(clusterBBox);
    const processed = new Set<PnsItem>();

    while (pending.length > 0) {
      const obstacles = new ObstacleSet();
      const top = pending.shift() as PnsItem;

      if (!processed.has(top)) cluster.items.push(top);

      processed.add(top);

      // Only query touching objects.
      this.mWorld.queryColliding(top, obstacles, {
        differentNetsOnly: false,
        overrideClearance: 0,
      });

      for (const obs of obstacles) {
        const item = obs.item;

        if (!item) continue;

        const trackOnTrack =
          item.net() !== top.net() &&
          item.ofKind(PnsKind.SEGMENT_T) &&
          top.ofKind(PnsKind.SEGMENT_T);

        if (trackOnTrack) continue;

        if (aExcludedNet && item.net() === aExcludedNet) continue;

        if (item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T) && item.layers().overlaps(aLayer)) {
          const line = this.mWorld.assembleLine(item as PnsLinkedItem);
          const b = line.cLine().bbox();

          clusterBBox = mergeBox(clusterBBox, {
            minX: b.x,
            minY: b.y,
            maxX: b.x + b.w,
            maxY: b.y + b.h,
          });
        } else {
          const s = item.shape(aLayer);

          // Upstream dereferences this too; an item with no shape on the layer
          // is skipped rather than crashed on, because unlike the seed it is
          // reached through a query that does not guarantee one.
          if (s) clusterBBox = mergeBox(clusterBBox, shapeBBox(s));
        }

        const currentArea = boxArea(clusterBBox);
        const areaRatio = currentArea / (initialArea + 1);

        if (aAreaExpansionLimit > 0.0 && areaRatio > aAreaExpansionLimit) break;

        if (
          !processed.has(item) &&
          item.layers().overlaps(aLayer) &&
          !(item.marker() & LineMarker.MK_HEAD)
        ) {
          processed.add(item);
          cluster.items.push(item);
          pending.push(item);
        }
      }
    }

    return cluster;
  }

  // ----- differential pairs ------------------------------------------------------

  /**
   * `TOPOLOGY::AssembleDiffPair( ITEM* aStart, DIFF_PAIR& aPair )`
   * (`cpp:1036-1185`): recover the pair a user clicked one half of.
   *
   * Upstream's `bool` plus out-parameter becomes "the pair, or null".
   *
   * ### How the coupled item is chosen
   *
   * Candidates are every `SEGMENT`/`ARC` on the complementary net whose layer
   * span **equals** the start item's. A candidate must match kind and width; a
   * segment must additionally be `ApproxParallel` within
   * {@link DP_PARALLELITY_THRESHOLD} and have a non-empty common parallel
   * projection with the reference, and an arc must have its centre within that
   * same threshold. The score is then **two distances at once**:
   * `dist_sq` from the reference item, and `distTarget_sq` from the *clicked
   * point*. A candidate is taken when it is no further from the reference
   * (`<=`) **and** strictly nearer the click. Both minima move together, so the
   * search is not "nearest to the reference" and not "nearest to the click" but
   * a ratchet over the pair — that coupling is upstream's and it is why the two
   * cannot be collapsed into one comparison.
   *
   * ### Four things upstream does that look like mistakes
   *
   *  1. **`pItems` is built and never read** (`cpp:1047-1054`). The search runs
   *     on `startItem` itself, not on the assembled line's links. Dead upstream,
   *     dead here.
   *  2. **The fallback widens by one joint, not by the line.** When nothing
   *     couples to the clicked item, every link of the joints at *its* two
   *     anchors is tried — so `refItem`, and therefore the measured gap, can end
   *     up being a neighbouring segment rather than the one under the cursor.
   *  3. **The polarity swap happens before the gap is measured.** `lp` and `ln`
   *     are exchanged at `cpp:1160-1161`; `refItem`/`coupledItem` were fixed
   *     before that and are *not* exchanged, so a negative-polarity pair
   *     measures its gap from the reference item while subtracting the width of
   *     what is now the other lane. Same width in every real pair, and kept
   *     regardless.
   *  4. `gap` initialises to `-1` and stays there only if `refItem` is null —
   *     which cannot happen, because `refItem` and `coupledItem` are assigned
   *     together and the function has already returned if `coupledItem` is null.
   *     `DP_MEANDER_PLACER`'s `gap() < 0` fallback is for the *other*
   *     constructor, not for this path.
   *
   * ### Where this port is not bit-exact
   *
   * `SHAPE_ARC::GetRadius()` is an `int` upstream and a double here
   * (`shape_arc_ops.ts`), so the arc gap and the arc `dist_sq` carry a fraction
   * where upstream carries none. The `(int)` cast on the gap is reproduced with
   * `Math.trunc`, which absorbs it at the one place it reaches a stored value.
   * `SHAPE::SquaredDistance` is likewise float-rounded — see
   * {@link shapeSquaredDistanceToPoint}.
   */
  assembleDiffPair(aStart: PnsItem): DiffPair | null {
    const refNet = aStart.net();
    const resolver = this.mWorld.getRuleResolver();

    // Upstream dereferences the resolver unguarded (`cpp:1039`).
    if (!resolver) throw new Error('PNS: TOPOLOGY::AssembleDiffPair() with no rule resolver');

    const coupledNet = resolver.dpCoupledNet(refNet);
    const startItem = aStart instanceof PnsLinkedItem ? aStart : null;

    if (!coupledNet || !startItem) return null;

    let lp = this.mWorld.assembleLine(startItem, null, false, false, false);

    // `pItems` is upstream's, and upstream never reads it. Not reproduced as a
    // dead local; the loop that filled it had no side effects.

    const nItems: PnsItem[] = [];

    for (const item of this.mWorld.allItemsInNet(coupledNet)) {
      if (
        item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T) &&
        item.layers().equals(startItem.layers())
      )
        nItems.push(item);
    }

    let refItem: PnsLinkedItem | null = null;
    let coupledItem: PnsLinkedItem | null = null;
    let minDistSq = Number.MAX_VALUE;
    let minDistTargetSq = Number.MAX_VALUE;

    const startShape = aStart.shape(-1);

    // Upstream dereferences this too (`cpp:1069`).
    if (!startShape) throw new Error('PNS: TOPOLOGY::AssembleDiffPair() on an item with no shape');

    const targetPoint = shapeCentre(startShape);

    const findNItem = (pItem: PnsItem): void => {
      for (const nItem of nItems) {
        let distSq = Number.MAX_VALUE;

        if (nItem.kind() !== pItem.kind()) continue;

        if (pItem.kind() === PnsKind.SEGMENT_T) {
          const pSeg = pItem as PnsSegment;
          const nSeg = nItem as PnsSegment;

          if (nSeg.width() !== pSeg.width()) continue;

          if (!segApproxParallel(pSeg.seg(), nSeg.seg(), DP_PARALLELITY_THRESHOLD)) continue;

          if (!commonParallelProjection(pSeg.seg(), nSeg.seg())) continue;

          distSq = segSquaredDistanceToSeg(nSeg.seg(), pSeg.seg());
        } else if (pItem.kind() === PnsKind.ARC_T) {
          const pArc = pItem as PnsArc;
          const nArc = nItem as PnsArc;

          if (nArc.width() !== pArc.width()) continue;

          const centerDiff = sub(shapeArcCenter(nArc.cArc()), shapeArcCenter(pArc.cArc()));
          const centerDistSq = centerDiff.x * centerDiff.x + centerDiff.y * centerDiff.y;

          if (centerDistSq > square(DP_PARALLELITY_THRESHOLD)) continue;

          distSq = square(arcRadius(pArc.cArc()) - arcRadius(nArc.cArc()));
        }

        // A kind that is neither leaves `distSq` at its maximum, which the `<=`
        // below still accepts on the very first candidate. Upstream's, and
        // unreachable: `nItems` holds segments and arcs only.
        if (distSq <= minDistSq) {
          const nShape = nItem.shape(-1);

          if (!nShape) continue;

          const distTargetSq = shapeSquaredDistanceToPoint(nShape, targetPoint);

          if (distTargetSq < minDistTargetSq) {
            minDistTargetSq = distTargetSq;
            minDistSq = distSq;

            refItem = pItem as PnsLinkedItem;
            coupledItem = nItem as PnsLinkedItem;
          }
        }
      }
    };

    findNItem(startItem);

    if (!coupledItem) {
      const linksToTest = new Set<PnsItem>();

      for (let i = 0; i < startItem.anchorCount(); i++) {
        const jt = this.mWorld.findJointForItem(startItem.anchor(i), startItem);

        if (!jt) continue;

        for (const link of jt.linkList()) {
          if (link !== startItem) linksToTest.add(link);
        }
      }

      for (const link of linksToTest) findNItem(link);
    }

    if (!coupledItem) return null;

    // TS narrows these to `never` through the closure; they are assigned there.
    const ref = refItem as PnsLinkedItem | null;
    const coupled = coupledItem as PnsLinkedItem;

    let ln = this.mWorld.assembleLine(coupled, null, false, false, false);

    if (resolver.dpNetPolarity(refNet) < 0) {
      const tmp = lp;

      lp = ln;
      ln = tmp;
    }

    let gap = -1;

    if (ref && ref.kind() === PnsKind.SEGMENT_T) {
      // Segments are parallel -> compute pair gap.
      const refDir = sub(ref.anchor(1), ref.anchor(0));
      const displacement = sub(ref.anchor(1), coupled.anchor(1));

      gap = Math.abs(Math.trunc(cross(refDir, displacement) / EuclideanNormI(refDir))) - lp.width();
    } else if (ref && ref.kind() === PnsKind.ARC_T) {
      const refArc = ref as PnsArc;
      const coupledArc = coupled as PnsArc;

      gap =
        Math.trunc(Math.abs(arcRadius(refArc.cArc()) - arcRadius(coupledArc.cArc()))) - lp.width();
    }

    const pair = DiffPair.fromLines(lp, ln);

    pair.setWidth(lp.width());
    pair.setLayers(lp.layers());
    pair.setGap(gap);

    return pair;
  }

  // ----- tuning paths ------------------------------------------------------------

  /**
   * `TOPOLOGY::findLinesFromVia` (`cpp:536-608`): the tracks that actually land
   * on a via's pad, one assembled line per physical run.
   *
   * The query is for `SEGMENT_T | ARC_T` only, at zero clearance and across
   * nets, and the results are then filtered down to the via's own net. Touching
   * is not enough: **at least one of a candidate's two anchors must be inside
   * the via pad**, which is what stops a track that merely grazes the annulus
   * from being read as connected to it.
   *
   * That inside test is the one place a board is needed. With a
   * {@link PnsTuningHost} and a board via it is
   * `LENGTH_DELAY_CALCULATION::IsPointInsideViaPad`, which knows about
   * per-layer padstacks; without one it is upstream's own fallback at
   * `cpp:586-589`, `aVia->Shape( aVia->Layer() )->Collide( anchor, 0 )`.
   *
   * `assembled` collects the *links* of every line produced, so a run that was
   * hit by the query three times yields one line and not three.
   */
  private findLinesFromVia(
    aHost: PnsTuningHost | null,
    aVia: PnsVia,
    aVisited: ReadonlySet<PnsItem>,
  ): PnsLine[] {
    const result: PnsLine[] = [];
    const obstacles = new ObstacleSet();

    this.mWorld.queryColliding(aVia, obstacles, {
      differentNetsOnly: false,
      overrideClearance: 0,
      kindMask: PnsKind.SEGMENT_T | PnsKind.ARC_T,
    });

    const net = aVia.net();
    const assembled = new Set<PnsLinkedItem>();
    const boardVia = aHost ? aHost.boardVia(aVia) : null;

    for (const obs of obstacles) {
      const item = obs.item;

      if (!item) continue;

      if (item.net() !== net) continue;

      const linked = item as PnsLinkedItem;

      if (aVisited.has(linked)) continue;

      if (assembled.has(linked)) continue;

      // Make sure at least one anchor is inside the via pad.
      const anchor0 = linked.anchor(0);
      const anchor1 = linked.anchor(1);

      let anchor0Inside: boolean;
      let anchor1Inside: boolean;

      if (aHost && boardVia) {
        const pcbLayer = aHost.getBoardLayerFromPNSLayer(linked.layer());

        anchor0Inside = aHost.isPointInsideViaPad(boardVia, anchor0, pcbLayer);
        anchor1Inside = aHost.isPointInsideViaPad(boardVia, anchor1, pcbLayer);
      } else {
        // Fallback to PNS shape collision.
        const shape = aVia.shape(aVia.layer());
        const collide = getShapeCollider();

        anchor0Inside = !!shape && collide(shape, pointShape(anchor0), 0).collides;
        anchor1Inside = !!shape && collide(shape, pointShape(anchor1), 0).collides;
      }

      if (!anchor0Inside && !anchor1Inside) continue;

      const l = this.mWorld.assembleLine(linked, null, false, true);

      for (const link of l.links()) assembled.add(link);

      result.push(l);
    }

    return result;
  }

  /**
   * `TOPOLOGY::walkTuningPath` (`cpp:611-784`): depth-first from one end of the
   * seed line, keeping the longest path.
   *
   * How it differs from {@link followBranch}, which does the same job for
   * `AssembleTrivialPath`:
   *
   *  - It walks **by position**, through `HitTest`, not by joint. That is what
   *    lets it cross a pad or a via that no joint ties together.
   *  - `visited` is **per path** and seeded from the caller's set, where
   *    `followBranch`'s is global and read-only. Two branches out of the same
   *    fanout can therefore both consume the same item.
   *  - `best.m_length` starts at **-1**, not 0, so a terminal state of length
   *    zero still records itself once — which is how a path that ends
   *    immediately still reports its end pad.
   *
   * The three cases at each endpoint, in the order they are tested:
   *
   *  1. **A pad.** Record it, then *keep going through it* — the pad is marked
   *    visited and every unvisited same-net segment or arc at that point is
   *    pushed. This is what makes tuning span a net that passes through an
   *    in-line pad rather than stopping at it. The via case is skipped
   *    entirely for this state.
   *  2. **A via.** Push one state per continuation from
   *    {@link findLinesFromVia}, carrying the via into the path. The
   *    continuation's contribution to the length is the in-via-clipped length
   *    when a host and a board via are available and the plain chain length
   *    otherwise. A via with no continuations is a terminal state that records
   *    the via.
   *  3. **Neither.** Terminal.
   *
   * `startNear` picks which end of a continuation to walk on from by squared
   * distance, with `<=` — a zero-length continuation therefore walks on from
   * its last point.
   */
  private walkTuningPath(
    aHost: PnsTuningHost | null,
    aStartLine: PnsLine,
    aStartFromBack: boolean,
    aVisited: ReadonlySet<PnsItem>,
  ): WalkResult {
    const best: WalkResult = { items: new PnsItemSet(), endPad: null, length: -1 };
    const net = aStartLine.net();
    const startTime = Date.now();

    const stack: WalkState[] = [
      {
        endpoint: aStartFromBack ? aStartLine.cLastPoint() : aStartLine.cPoint(0),
        pathItems: new PnsItemSet(),
        pathLength: 0,
        visited: new Set(aVisited),
      },
    ];

    while (stack.length > 0) {
      if (Date.now() - startTime > this.mFollowBranchTimeoutMs) break;

      const current = stack.pop() as WalkState;
      const hits = this.mWorld.hitTest(current.endpoint);

      let pad: PnsSolid | null = null;

      for (const item of hits.citems()) {
        if (item.ofKind(PnsKind.SOLID_T) && item.net() === net && !current.visited.has(item)) {
          pad = item as PnsSolid;
          break;
        }
      }

      if (pad) {
        if (current.pathLength > best.length) {
          best.length = current.pathLength;
          best.items = current.pathItems.clone();
          best.endPad = pad;
        }

        // Continue through an in-line pad so tuning spans the whole net.
        current.visited.add(pad);

        for (const item of hits.citems()) {
          if (!item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) continue;

          if (item.net() !== net || current.visited.has(item)) continue;

          const contLine = this.mWorld.assembleLine(item as PnsLinkedItem, null, false, true);
          const ep = current.endpoint;
          const startNear =
            squaredDistance(contLine.cPoint(0), ep) <= squaredDistance(contLine.cLastPoint(), ep);

          const nextState: WalkState = {
            endpoint: startNear ? contLine.cLastPoint() : contLine.cPoint(0),
            pathItems: current.pathItems.clone(),
            pathLength: current.pathLength + contLine.cLine().length(),
            visited: new Set(current.visited),
          };

          nextState.pathItems.addLine(contLine);

          for (const link of contLine.links()) nextState.visited.add(link);

          stack.push(nextState);
        }

        continue;
      }

      let via: PnsVia | null = null;

      for (const item of hits.citems()) {
        if (
          item.ofKind(PnsKind.VIA_T) &&
          item.net() === net &&
          !item.isVirtual() &&
          !current.visited.has(item)
        ) {
          via = item as PnsVia;
          break;
        }
      }

      if (via) {
        current.visited.add(via);

        const continuations = this.findLinesFromVia(aHost, via, current.visited);
        const boardVia = aHost ? aHost.boardVia(via) : null;

        for (const contLine of continuations) {
          const ep = current.endpoint;
          const startNearVia =
            squaredDistance(contLine.cPoint(0), ep) <= squaredDistance(contLine.cLastPoint(), ep);

          const forwardEndpoint = startNearVia ? contLine.cLastPoint() : contLine.cPoint(0);

          let contLength = contLine.cLine().length();

          if (aHost && boardVia) {
            const clipped = contLine.line().clone();
            const pcbLayer = aHost.getBoardLayerFromPNSLayer(contLine.layer());

            aHost.optimiseTraceInVia(clipped, boardVia, pcbLayer);
            contLength = clipped.length();
          }

          const nextState: WalkState = {
            endpoint: forwardEndpoint,
            pathItems: current.pathItems.clone(),
            pathLength: current.pathLength + contLength,
            visited: new Set(current.visited),
          };

          nextState.pathItems.add(via);
          nextState.pathItems.addLine(contLine);

          for (const link of contLine.links()) nextState.visited.add(link);

          stack.push(nextState);
        }

        if (continuations.length === 0) {
          if (current.pathLength > best.length) {
            best.length = current.pathLength;
            best.items = current.pathItems.clone();
            best.items.add(via);
            best.endPad = null;
          }
        }
      } else {
        if (current.pathLength > best.length) {
          best.length = current.pathLength;
          best.items = current.pathItems.clone();
          best.endPad = null;
        }
      }
    }

    return best;
  }

  /**
   * `TOPOLOGY::AssembleTuningPath` (`cpp:787-1018`): the length tuner's view of
   * a track — `AssembleTrivialPath`, but following the *track length* rules
   * instead of the topology ones.
   *
   * @see BOARD::GetTrackLength — upstream's note asks that the two be kept in
   * sync.
   *
   * ### It is more permissive about a via start than `AssembleTrivialPath` is
   *
   * A fanout via is *not* rejected here. When the joint gives no segment — a
   * fanout, or no joint at all — the seed is taken from the first link of the
   * first {@link findLinesFromVia} continuation instead, and only an empty
   * continuation list returns nothing. `AssembleTrivialPath` gives up at the
   * fanout test.
   *
   * ### What the host does and does not gate
   *
   * The three post-processing passes — clip the trace inside the start/end pads,
   * clip it inside any intermediate pad, clip it inside every via on the path —
   * are `LENGTH_DELAY_CALCULATION` calls against a live `BOARD`. Without a
   * {@link PnsTuningHost} this returns at upstream's own
   * `if( !padA && !padB ) return path;` (`cpp:910`), which is exactly the branch
   * upstream takes when the end solids have no `PCB_PAD_T` parent.
   *
   * **`aStartPad`/`aEndPad` are gated too, and that is upstream, not a
   * shortcut.** `*aStartPad = left.m_endPad` sits *inside* the
   * `bi->Type() == PCB_PAD_T` test at `cpp:884-890`, so a `PNS::SOLID` that is
   * not a board pad is found by the walk, ends the path, and is still **not**
   * reported to the caller. With no host, both are always null.
   *
   * ### The passes are ordered and they are not idempotent
   *
   * `processPad` rewrites the path's lines in place. The path holds
   * `ITEM_SET`-owned *copies* (`Add( const LINE& )` clones), so the node's own
   * lines are untouched — but running the same pad twice would clip an
   * already-clipped line, which is what `processedPads` is for. Note it holds
   * the start and end pads from the outset, and that the intermediate sweep
   * `break`s at the first same-net solid at each endpoint whether or not that
   * solid turned out to be a pad.
   */
  assembleTuningPath(aHost: PnsTuningHost | null, aStart: PnsItem): TuningPathResult {
    const empty = (): TuningPathResult => ({
      path: new PnsItemSet(),
      startPad: null,
      endPad: null,
    });

    let seg: PnsLinkedItem | null = null;

    if (aStart.kind() === PnsKind.VIA_T) {
      const via = aStart as PnsVia;
      const jt = this.mWorld.findJointForItem(via.pos(), via);

      if (jt && jt.isNonFanoutVia()) {
        for (const item of jt.cLinks().citems()) {
          if (item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
            seg = item as PnsLinkedItem;
            break;
          }
        }
      }

      if (!seg) {
        const continuations = this.findLinesFromVia(aHost, via, new Set<PnsItem>());

        if (continuations.length === 0) return empty();

        for (const link of (continuations[0] as PnsLine).links()) {
          if (link.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
            seg = link;
            break;
          }
        }
      }
    } else if (aStart.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
      seg = aStart as PnsLinkedItem;
    }

    if (!seg) return empty();

    const l = this.mWorld.assembleLine(seg, null, false, true);

    const visited = new Set<PnsItem>();

    for (const link of l.links()) visited.add(link);

    const left = this.walkTuningPath(aHost, l, false, visited);
    const right = this.walkTuningPath(aHost, l, true, visited);

    const path = new PnsItemSet();

    for (const item of left.items.citems()) path.prepend(item);

    path.addLine(l);

    for (const item of right.items.citems()) path.add(item);

    let padA: PnsBoardPadHandle | null = null;
    let padB: PnsBoardPadHandle | null = null;
    let startPad: PnsSolid | null = null;
    let endPad: PnsSolid | null = null;

    if (left.endPad) {
      const bi = aHost ? aHost.boardPad(left.endPad) : null;

      if (bi) {
        padA = bi;
        startPad = left.endPad;
      }
    }

    if (right.endPad) {
      const bi = aHost ? aHost.boardPad(right.endPad) : null;

      if (bi) {
        padB = bi;
        endPad = right.endPad;
      }
    }

    if (!padA && !padB) return { path, startPad, endPad };

    // `padA || padB` is only ever set through `aHost`, so it is non-null here.
    const host = aHost as PnsTuningHost;

    const processPad = (aPad: PnsBoardPadHandle): void => {
      for (let idx = 0; idx < path.size(); idx++) {
        const entry = path.at(idx) as PnsItem;

        if (entry.kind() !== PnsKind.LINE_T) continue;

        const line = entry as PnsLine;
        const pcbLayer = host.getBoardLayerFromPNSLayer(line.layer());

        host.optimiseTraceInPad(line.line(), aPad, pcbLayer);
      }
    };

    if (padA) processPad(padA);

    if (padB) processPad(padB);

    const processedPads = new Set<PnsBoardPadHandle>();

    if (padA) processedPads.add(padA);

    if (padB) processedPads.add(padB);

    for (let idx = 0; idx < path.size(); idx++) {
      const entry = path.at(idx) as PnsItem;

      if (entry.kind() !== PnsKind.LINE_T) continue;

      const line = entry as PnsLine;

      for (const pt of [line.cPoint(0), line.cLastPoint()]) {
        const hits = this.mWorld.hitTest(pt);

        for (const item of hits.citems()) {
          if (item.ofKind(PnsKind.SOLID_T) && item.net() === line.net()) {
            const intermediatePad = host.boardPad(item as PnsSolid);

            if (intermediatePad && !processedPads.has(intermediatePad)) {
              processPad(intermediatePad);
              processedPads.add(intermediatePad);
            }

            break;
          }
        }
      }
    }

    // Clip in-VIA portions and add residual path to VIA centre.
    for (let idx = 0; idx < path.size(); idx++) {
      const entry = path.at(idx) as PnsItem;

      if (entry.kind() !== PnsKind.VIA_T) continue;

      const boardVia = host.boardVia(entry as PnsVia);

      if (!boardVia) continue;

      for (const delta of [-1, 1]) {
        const j = idx + delta;

        if (j < 0 || j >= path.size()) continue;

        const neighbour = path.at(j) as PnsItem;

        if (neighbour.kind() !== PnsKind.LINE_T) continue;

        const line = neighbour as PnsLine;
        const pcbLayer = host.getBoardLayerFromPNSLayer(line.layer());

        host.optimiseTraceInVia(line.line(), boardVia, pcbLayer);
      }
    }

    return { path, startPad, endPad };
  }
}
