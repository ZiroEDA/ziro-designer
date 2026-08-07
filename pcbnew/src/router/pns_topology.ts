// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Walking the connectivity graph past the end of a single line.
 * Counterpart: `pcbnew/router/pns_topology.cpp` (`TOPOLOGY`).
 *
 * `AssembleTrivialPath` (with the two private walks it is built out of) and
 * `SimplifyLine` are here. `TOPOLOGY` upstream is much larger — cluster
 * assembly, diff pairs, `NearestUnconnectedItem`, `AssembleTuningPath` — and
 * every one of those belongs to the change that needs it.
 *
 * `LeadingRatLine` is the one a caller has already asked for and not got: it
 * needs `NearestUnconnectedAnchorPoint`, which needs `NearestUnconnectedItem`,
 * which needs board connectivity. `PNS::DIFF_PAIR_PLACER` reaches it through a
 * host hook instead, because the only thing it does with the answer is draw it.
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
import { PnsKind, type PnsItem, type PnsLinkedItem } from './pns_item.js';
import type { PnsJoint } from './pns_joint.js';
import type { PnsLine } from './pns_line_item.js';
import type { PnsNode } from './pns_node.js';
import type { PnsVia } from './pns_via.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

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

/** `TOPOLOGY`, reduced to the trivial-path walk. */
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
}
