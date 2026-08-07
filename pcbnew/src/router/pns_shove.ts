// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::SHOVE` — the push-and-shove router core. Counterpart:
 * `pcbnew/router/pns_shove.{h,cpp}`.
 *
 * ## What shove is, in one paragraph
 *
 * Walkaround asks "how do I get past this?"; shove asks "will you move?". Given
 * a *head* — the track the user is drawing — it finds the nearest obstacle,
 * pushes it out of the way, then finds whatever *that* now collides with and
 * pushes that, and so on until nothing collides or it gives up. The whole thing
 * runs on a {@link PnsNode.branch}: every push mutates a throwaway overlay of
 * the board, and if the cascade fails to settle the overlay is simply dropped
 * and the board is untouched. There is no undo log — the branch *is* the undo
 * log, which is why this class could not be written until `PNS::NODE` was
 * complete.
 *
 * ## The spring-back stack
 *
 * A successful `Run()` does not throw its branch away; it pushes it on
 * {@link PnsShove.mNodeStack} as a *spring-back frame*. The next `Run()` — the
 * next mouse move — starts by asking each frame from the top down whether it
 * still matters to the new head, and pops the ones that do not. So dragging a
 * track forwards accumulates frames and dragging it back releases them, and the
 * shoved tracks spring back to where they were. Frames are nested branches, so
 * popping one is `delete` and nothing else.
 *
 * Two things guard the pop and both exist because of real crashes upstream:
 * a frame may be **locked** (`AddLockedSpringbackNode`, used by `LINE_PLACER`
 * when it commits a segment), and one frame may be named
 * *do-not-touch* ({@link PnsShove.setSpringbackDoNotTouchNode}) because the
 * router tool is still holding an item that belongs to it.
 *
 * ## The API this exposes is not the one you may remember
 *
 * `ShoveLines`, `ShoveMultiLines` and `ShoveDraggingVia` were the pre-2023
 * entry points and **no longer exist upstream** — `ShoveDraggingVia` survives as
 * a declaration at `pns_shove.h:86` with no definition anywhere and a
 * commented-out call at `pns_dragger.cpp:855`. The live API is heads-based:
 * {@link PnsShove.clearHeads}, {@link PnsShove.addHeads}, {@link PnsShove.run},
 * then {@link PnsShove.headsModified} / {@link PnsShove.getModifiedHead}.
 * `pns_line_placer.cpp` uses exactly that and nothing else.
 *
 * ## Ranks
 *
 * Every item carries a rank. The head is ranked 100000, so everything else is
 * "lower-ranking" and gets shoved. Each thing shoved is ranked one *below* its
 * pusher, so the cascade has a strict order and a line cannot push back on what
 * pushed it. Hitting something ranked *above* you is a "reverse collision" and
 * means **you** move, not it. Rank -1 is untouched world geometry.
 *
 * ## What is not ported
 *
 * The debug decorator and logger calls are dropped wholesale; they have no
 * behavioural effect. `PNS::WALKAROUND` (the class), `PNS::OPTIMIZER` (the
 * class) and `ROUTING_SETTINGS` do not exist in this tree yet, so
 * {@link PnsShoveSettings} carries upstream's accessor names and defaults and
 * the walkaround/optimiser passes are driven through the free functions that do
 * exist. Each of those is flagged at its site.
 *
 * The full porting spec, with `file:line` for every claim, is
 * `/var/tmp/ziro-router-specs/pns_shove_impl.md`.
 */
import { LineMarker, PnsKind } from './pns_item.js';
import { PnsLine, PnsLineChain } from './pns_line_item.js';
import { PnsSegment } from './pns_segment.js';
import { PnsItemSet } from './pns_itemset.js';
import type { PnsVia } from './pns_via.js';
import { itemHull } from './pns_item_hull.js';
import { walkaround as chainWalkaround, routeShortest } from './pns_walkaround.js';
import { dragCorner } from './pns_line.js';
import { pointInside } from './pns_chain.js';
import { mergeObtuse, mergeFull } from './pns_optimizer.js';
import type { PnsBox, PnsNode } from './pns_node.js';
import type { PnsArc } from './pns_arc.js';
import type { PnsItem, PnsLinkedItem } from './pns_item.js';
import type { ViaHandle } from './pns_via.js';
import type { PnsJoint } from './pns_joint.js';
import { ObstacleSet } from './pns_collision.js';
import type { Obstacle, CollisionSearchOptions } from './pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `SHOVE::SHOVE_STATUS` (`pns_shove.h:50-57`). */
export enum PnsShoveStatus {
  SH_OK = 0,
  /**
   * `shoveIteration`'s initial value. It escapes whenever the dispatch switch
   * hits a `default`, which leaves the line stack unchanged — so the main loop
   * finds the same obstacle again and spins to the iteration cap. Upstream's,
   * and the reason the cap is not optional.
   */
  SH_NULL = 1,
  SH_INCOMPLETE = 2,
  /** Declared upstream and never returned by anything. Kept for API fidelity. */
  SH_HEAD_MODIFIED = 3,
  /** "I cannot shove this" — every caller converts it to a walkaround. */
  SH_TRY_WALK = 4,
}

/**
 * `SHOVE::SHOVE_POLICY` (`pns_shove.h:59-69`), a bit mask.
 *
 * Only four of the eight are read anywhere upstream: `SHP_IGNORE`,
 * `SHP_DONT_OPTIMIZE`, `SHP_DONT_LOCK_ENDPOINTS` and `SHP_REVERSED`. `SHP_SHOVE`
 * is stored (it is the default policy, and what `LINE_PLACER` passes) and never
 * tested; `SHP_WALK_FORWARD` and `SHP_WALK_BACK` are neither stored nor tested.
 */
export enum PnsShovePolicy {
  SHP_DEFAULT = 0,
  SHP_SHOVE = 0x1,
  SHP_WALK_FORWARD = 0x2,
  SHP_WALK_BACK = 0x4,
  SHP_IGNORE = 0x8,
  SHP_DONT_OPTIMIZE = 0x10,
  SHP_DONT_LOCK_ENDPOINTS = 0x20,
  SHP_REVERSED = 0x40,
}

/** `PNS_OPTIMIZATION_EFFORT`. */
// `PNS::PNS_OPTIMIZATION_EFFORT` is defined once, in pns_routing_settings.ts,
// which landed with the router-settings dialog while this port was in flight.
// Re-exported here so shove's callers can reach it from either module without
// a second enum carrying the same three values.
import { PnsOptimizationEffort } from './pns_routing_settings.js';

export { PnsOptimizationEffort };

/**
 * `OPTIMIZER::OptimizationEffort` (`pns_optimizer.h:97-110`), the flag bits
 * `runOptimizer` composes.
 *
 * The whole enum is spelled out even though shove composes only five of the
 * bits, because these are a **mask**: leaving a member out does not remove its
 * bit, it leaves that bit free to be claimed by the next member somebody adds.
 * This enum previously carried `RESTRICT_AREA = 0x20` and
 * `LIMIT_CORNER_COUNT = 0x80` — which are upstream's `PRESERVE_VERTEX` and
 * `MERGE_COLINEAR` — so a mask built here meant something else to any code
 * reading it against upstream's numbering.
 */
export enum PnsOptimizerFlags {
  /** Reduce corner cost iteratively. */
  MERGE_SEGMENTS = 0x01,
  /** Reroute pad exits. */
  SMART_PADS = 0x02,
  /** Reduce corner cost by merging obtuse segments. */
  MERGE_OBTUSE = 0x04,
  /** Simplify pad-pad and pad-via connections if possible. */
  FANOUT_CLEANUP = 0x08,
  KEEP_TOPOLOGY = 0x10,
  PRESERVE_VERTEX = 0x20,
  RESTRICT_VERTEX_RANGE = 0x40,
  /** Merge co-linear segments. */
  MERGE_COLINEAR = 0x80,
  RESTRICT_AREA = 0x100,
  /** Do not optimize if the result's corner count leaves the allowed range. */
  LIMIT_CORNER_COUNT = 0x200,
}

/**
 * The slice of `PNS::ROUTING_SETTINGS` that `SHOVE` reads, with upstream's
 * accessor names and upstream's defaults (`pns_routing_settings.cpp:36-46`).
 *
 * `ROUTING_SETTINGS` is not ported; this is the seam. Keeping the names means a
 * later port can satisfy the interface without touching any call site here.
 */
export interface PnsShoveSettings {
  /** `ShoveIterationLimit()`, default 250. */
  shoveIterationLimit: number;
  /** `ShoveTimeLimit()`, milliseconds, default 1000. */
  shoveTimeLimit: number;
  /** `ShoveVias()`, default true. */
  shoveVias: boolean;
  /** `JumpOverObstacles()`, default false. */
  jumpOverObstacles: boolean;
  /** `WalkaroundIterationLimit()`, default 40. */
  walkaroundIterationLimit: number;
  /** `OptimizerEffort()`, default `OE_MEDIUM`. */
  optimizerEffort: PnsOptimizationEffort;
  /** `SmartPads()`, default true. */
  smartPads: boolean;
  /** `GetCornerMode()`; only the 45° modes enable `SMART_PADS`. */
  cornerMode45: boolean;
}

/** Upstream's `ROUTING_SETTINGS` constructor defaults. */
export const DEFAULT_SHOVE_SETTINGS: PnsShoveSettings = {
  shoveIterationLimit: 250,
  shoveTimeLimit: 1000,
  shoveVias: true,
  jumpOverObstacles: false,
  walkaroundIterationLimit: 40,
  optimizerEffort: PnsOptimizationEffort.OE_MEDIUM,
  smartPads: true,
  cornerMode45: true,
};

/**
 * `SHOVE::ROOT_LINE_ENTRY` (`pns_shove.h:118-131`): the *pre-shove* shape of a
 * line the shove touched, so the optimiser can refuse to move it somewhere it
 * was never allowed to be.
 *
 * `rootLine` is genuinely nullable — {@link PnsShove.touchRootLineForItem}
 * allocates entries with no line at all, which is the via path.
 */
export interface PnsShoveRootLineEntry {
  rootLine: PnsLine | null;
  oldVia: PnsVia | null;
  newVia: PnsVia | null;
  newLine: PnsLine | null;
  policy: number;
  isHead: boolean;
}

/** `SHOVE::HEAD_LINE_ENTRY` (`pns_shove.h:133-192`). */
interface PnsShoveHeadLineEntry {
  geometryModified: boolean;
  prevVia: ViaHandle | null;
  theVia: ViaHandle | null;
  draggedVia: PnsVia | null;
  viaNewPos: Vec2;
  origHead: PnsLine | null;
  newHead: PnsLine | null;
  policy: number;
}

/**
 * `SHOVE::SPRINGBACK_TAG` (`pns_shove.h:194-210`).
 *
 * Three of upstream's seven fields (`m_length`, `m_p`, `m_seq`) are never read
 * by anything. `seq` is computed and kept because dropping it would make the
 * push path read differently from upstream for no gain; the other two are
 * omitted because they are never even written.
 */
interface PnsSpringbackTag {
  draggedVias: (ViaHandle | null)[];
  node: PnsNode | null;
  affectedArea: PnsBox | null;
  seq: number;
  locked: boolean;
}

/** `TOPOLOGY::CLUSTER`. */
interface PnsCluster {
  items: PnsItem[];
}

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** `VECTOR2I::EuclideanNorm`, truncated to an integer as upstream's `int` is. */
const norm = (v: Vec2): number => Math.trunc(Math.sqrt(v.x * v.x + v.y * v.y));

const squaredNorm = (v: Vec2): number => v.x * v.x + v.y * v.y;

/**
 * `VECTOR2I::Resize( aNewLength )`: the same direction, the given length.
 * Upstream's is exact-integer and rounds half away from zero; the router only
 * ever calls it with length 2 here, so the rounding mode is unobservable.
 */
function resizeVec(v: Vec2, len: number): Vec2 {
  const l = Math.sqrt(v.x * v.x + v.y * v.y);

  if (l === 0) return { x: 0, y: 0 };

  return { x: Math.round((v.x * len) / l), y: Math.round((v.y * len) / l) };
}

/** `BOX2I::Merge`. */
function mergeBox(a: PnsBox | null, b: PnsBox | null): PnsBox | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };

  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** `BOX2I::Inflate`. */
function inflateBox(a: PnsBox, by: number): PnsBox {
  return { minX: a.minX - by, minY: a.minY - by, maxX: a.maxX + by, maxY: a.maxY + by };
}

function boxOfPoints(pts: readonly Vec2[]): PnsBox | null {
  if (pts.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * `LINE::ChangedArea( const LINE* )` (`pns_line.cpp`): the box enclosing the
 * part of the two lines that actually differs, inflated by the wider width.
 *
 * The forward scan is the subtle half. A point that moved is not enough to
 * start the changed region: if the *other* line's point still lies **on** this
 * line's segment at that index, the line was merely re-vertexed there and the
 * scan keeps going. Only a point genuinely off the old path — or a difference at
 * the very last common index — opens the region. Without that test every
 * `Simplify2` would report the whole line as changed and the optimiser's
 * restrict-area would cover the board.
 */
export function lineChangedArea(aLineA: PnsLine, aLineB: PnsLine): PnsBox | null {
  const self = aLineA.cLine().clone();
  self.simplify();

  const other = aLineB.cLine().clone();
  other.simplify();

  const npSelf = self.pointCount();
  const npOther = other.pointCount();
  const n = Math.min(npSelf, npOther);

  let iStart = -1;
  let iEndSelf = -1;
  let iEndOther = -1;

  for (let i = 0; i < n; i++) {
    const p1 = self.cPoint(i);
    const p2 = other.cPoint(i);

    if (samePoint(p1, p2)) continue;

    if (i !== n - 1) {
      const a = self.cPoint(i);
      const b = self.cPoint(i + 1);

      if (!segContains(a, b, p2)) {
        iStart = i;
        break;
      }
    } else {
      iStart = i;
      break;
    }
  }

  for (let i = 0; i < n; i++) {
    const p1 = self.cPoint(npSelf - 1 - i);
    const p2 = other.cPoint(npOther - 1 - i);

    if (!samePoint(p1, p2)) {
      iEndSelf = npSelf - 1 - i;
      iEndOther = npOther - 1 - i;
      break;
    }
  }

  if (iStart < 0) iStart = n;
  if (iEndSelf < 0) iEndSelf = npSelf - 1;
  if (iEndOther < 0) iEndOther = npOther - 1;

  const pts: Vec2[] = [];

  for (let i = iStart; i <= iEndSelf; i++) pts.push(self.cPoint(i));
  for (let i = iStart; i <= iEndOther; i++) pts.push(other.cPoint(i));

  const area = boxOfPoints(pts);

  if (!area) return null;

  return inflateBox(area, Math.max(aLineA.width(), aLineB.width()));
}

/** `SEG::Contains( VECTOR2I )`, upstream's 1-unit tolerance. */
function segContains(a: Vec2, b: Vec2, p: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;

  if (len2 === 0) return samePoint(a, p);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  const qx = a.x + dx * t;
  const qy = a.y + dy * t;

  return (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy) <= 1;
}

/** `VIA::ChangedArea( const VIA* )`: null when the via did not move. */
export function viaChangedArea(aA: PnsVia, aB: PnsVia): PnsBox | null {
  if (samePoint(aA.pos(), aB.pos())) return null;

  const rA = idiv(aA.diameter(aA.layers().start()), 2);
  const rB = idiv(aB.diameter(aB.layers().start()), 2);

  return mergeBox(
    {
      minX: aA.pos().x - rA,
      minY: aA.pos().y - rA,
      maxX: aA.pos().x + rA,
      maxY: aA.pos().y + rA,
    },
    {
      minX: aB.pos().x - rB,
      minY: aB.pos().y - rB,
      maxX: aB.pos().x + rB,
      maxY: aB.pos().y + rB,
    },
  );
}

/** `PNS::ChangedArea( const ITEM*, const ITEM* )` (`pns_utils.cpp`). */
export function itemChangedArea(aA: PnsItem, aB: PnsItem): PnsBox | null {
  if (aA.ofKind(PnsKind.VIA_T) && aB.ofKind(PnsKind.VIA_T))
    return viaChangedArea(aA as PnsVia, aB as PnsVia);

  if (aA.ofKind(PnsKind.LINE_T) && aB.ofKind(PnsKind.LINE_T))
    return lineChangedArea(aA as PnsLine, aB as PnsLine);

  return null;
}

/**
 * `LINE::Walkaround( const SHAPE_LINE_CHAIN& aObstacle, SHAPE_LINE_CHAIN& aPath, bool aCw )`.
 *
 * Delegates to the graph walk already ported in `pns_walkaround.ts`, which is
 * the same function over a plain point array. Nothing is lost by the adapter:
 * upstream's output chain is built by `out.Append( v->pos )` alone, so it never
 * carries arcs even when the input did.
 */
export function lineWalkaround(
  aLine: PnsLineChain,
  aObstacle: readonly Vec2[],
  aCw: boolean,
): PnsLineChain | null {
  if (aLine.segmentCount() < 1) return null;

  const out = chainWalkaround(aLine.points(), [...aObstacle], aCw);

  return out ? PnsLineChain.fromPoints(out) : null;
}

/**
 * The actual push-and-shove algorithm.
 *
 * The public surface is upstream's, method for method, and is what
 * `PNS::LINE_PLACER` calls. See the class doc for why it is not the
 * `ShoveLines`/`ShoveMultiLines` API some callers may expect.
 */
export class PnsShove {
  private mNodeStack: PnsSpringbackTag[] = [];
  private mLineStack: PnsLine[] = [];
  private mOptimizerQueue: PnsLine[] = [];
  private mHeadLines: PnsShoveHeadLineEntry[] = [];

  /**
   * The owning list and the UID index. They are kept apart, as upstream keeps
   * them apart (`pns_shove.h:280-282`): several UIDs deliberately alias the
   * *same* entry, so the index cannot own.
   */
  private mRootLineHistoryEntries: PnsShoveRootLineEntry[] = [];
  private mRootLineHistory = new Map<number, PnsShoveRootLineEntry>();

  private mRoot: PnsNode;
  private mCurrentNode: PnsNode;
  private mSpringbackDoNotTouchNode: PnsNode | null = null;
  private mDraggedVia: PnsVia | null = null;
  private mIter = 0;
  private mHeadsModified = false;
  private mForceClearance = -1;
  private mOptFlagDisableMask = 0;
  private mDefaultPolicy: number = PnsShovePolicy.SHP_SHOVE;
  private mAffectedArea: PnsBox | null = null;

  private mSettings: PnsShoveSettings;

  /**
   * `m_restrictSpringbackTagId` is upstream's and is assigned 0 in the
   * constructor and never touched again. Not ported as a field.
   *
   * `aWorld` is normally already a branch — `LINE_PLACER` constructs shove with
   * `m_world->Branch()` (`pns_line_placer.cpp:1489`), so shove never sees the
   * true root and `mRoot` is its own private base.
   */
  constructor(aWorld: PnsNode, aSettings: PnsShoveSettings = DEFAULT_SHOVE_SETTINGS) {
    this.mRoot = aWorld;
    this.mCurrentNode = aWorld;
    this.mSettings = aSettings;
  }

  // ----- configuration -------------------------------------------------------------

  settings(): PnsShoveSettings {
    return this.mSettings;
  }

  /** `SHOVE::ForceClearance( bool, int )` (`pns_shove.h:91-97`). */
  forceClearance(aEnabled: boolean, aClearance: number): void {
    this.mForceClearance = aEnabled ? aClearance : -1;
  }

  /** `SHOVE::DisablePostShoveOptimizations( int )`. */
  disablePostShoveOptimizations(aMask: number): void {
    this.mOptFlagDisableMask = aMask;
  }

  /** `SHOVE::SetDefaultShovePolicy( int )`. */
  setDefaultShovePolicy(aPolicy: number): void {
    this.mDefaultPolicy = aPolicy;
  }

  /** `SHOVE::SetShovePolicy( const LINE&, int )`. */
  setShovePolicyForLine(aLine: PnsLine, aPolicy: number): void {
    this.touchRootLine(aLine).policy = aPolicy;
  }

  /** `SHOVE::SetShovePolicy( const LINKED_ITEM*, int )`. */
  setShovePolicyForItem(aItem: PnsLinkedItem, aPolicy: number): void {
    this.touchRootLineForItem(aItem).policy = aPolicy;
  }

  /**
   * `SHOVE::CurrentNode()` — `m_currentNode ? m_currentNode : m_root`.
   *
   * Upstream's commented-out alternative on the same line reads the stack top
   * instead; it is not what ships and not what `LINE_PLACER` sees.
   */
  currentNode(): PnsNode {
    return this.mCurrentNode ?? this.mRoot;
  }

  /**
   * `SHOVE::SetSpringbackDoNotTouchNode( const NODE* )`.
   *
   * Names a frame {@link reduceSpringback} must never delete. `LINE_PLACER`
   * points it at the owner of the `endItem` it handed to `Move()`: freeing that
   * node out from under the router tool crashes it, and upstream's comment at
   * `pns_shove.cpp:930-931` says so. A plain setter, null accepted.
   */
  setSpringbackDoNotTouchNode(aNode: PnsNode | null): void {
    this.mSpringbackDoNotTouchNode = aNode;
  }

  // ----- heads ----------------------------------------------------------------------

  /** `SHOVE::ClearHeads()`. */
  clearHeads(): void {
    this.mHeadLines = [];
  }

  /**
   * `SHOVE::AddHeads( const LINE&, int aPolicy )`.
   *
   * The stored head is a **link-free clone**: upstream's `HEAD_LINE_ENTRY`
   * constructor calls `origHead->ClearLinks()` in its body
   * (`pns_shove.h:135-140`), which is what lets {@link run} assert the head has
   * no links before it adds it to the branch.
   */
  addHeads(aHead: PnsLine, aPolicy: number = PnsShovePolicy.SHP_DEFAULT): void {
    const orig = aHead.clone();
    orig.clearLinks();

    this.mHeadLines.push({
      geometryModified: false,
      prevVia: null,
      theVia: null,
      draggedVia: null,
      viaNewPos: { x: 0, y: 0 },
      origHead: orig,
      newHead: null,
      policy: aPolicy,
    });

    this.setShovePolicyForLine(aHead, aPolicy);
  }

  /** `SHOVE::AddHeads( VIA_HANDLE, VECTOR2I, int aPolicy )`. */
  addHeadsVia(aHead: ViaHandle, aNewPos: Vec2, aPolicy: number = PnsShovePolicy.SHP_DEFAULT): void {
    this.mHeadLines.push({
      geometryModified: false,
      prevVia: aHead,
      theVia: aHead,
      draggedVia: null,
      viaNewPos: { x: aNewPos.x, y: aNewPos.y },
      origHead: null,
      newHead: null,
      policy: aPolicy,
    });
  }

  /** `SHOVE::HeadsModified( int aIndex = -1 )`. */
  headsModified(aIndex = -1): boolean {
    if (aIndex < 0) return this.mHeadsModified;

    return this.mHeadLines[aIndex]?.geometryModified ?? false;
  }

  /** `SHOVE::GetModifiedHead( int )`. Upstream dereferences an empty optional. */
  getModifiedHead(aIndex: number): PnsLine {
    const h = this.mHeadLines[aIndex]?.newHead;

    if (!h) throw new Error('PNS: GetModifiedHead() on a head that was not modified');

    return h;
  }

  /** `SHOVE::GetModifiedHeadVia( int )`. */
  getModifiedHeadVia(aIndex: number): ViaHandle {
    const v = this.mHeadLines[aIndex]?.theVia;

    if (!v) throw new Error('PNS: GetModifiedHeadVia() on a head with no via');

    return v;
  }

  // ----- the spring-back stack ------------------------------------------------------

  /**
   * `SHOVE::pushSpringback( NODE*, const OPT_BOX2I& )`.
   *
   * Called from exactly one place — the success path of {@link run} — and its
   * position there is load-bearing. Upstream's comment (`pns_shove.cpp:2568`)
   * is *"this must be called after reconstructHeads as it requires up-to-date
   * via handles"*, and the reason is step 3 below: the frame snapshots
   * `theVia` for every head, and `reconstructHeads` is what rewrites `theVia`
   * to where the via actually ended up. Push first and the frame records the
   * *pre*-shove via positions, so the next {@link reduceSpringback} restores
   * stale handles and the dragged via jumps back a move.
   *
   * The affected-area rule (step 5) is also not arbitrary: with no new area the
   * previous frame's area is **inherited**, not dropped, so the area grows
   * monotonically up the stack and the optimiser's restrict-area covers
   * everything the whole route touched.
   */
  private pushSpringback(aNode: PnsNode, aAffectedArea: PnsBox | null): boolean {
    const prevArea = this.mNodeStack.length
      ? (this.mNodeStack[this.mNodeStack.length - 1] as PnsSpringbackTag).affectedArea
      : null;

    const draggedVias: (ViaHandle | null)[] = new Array<ViaHandle | null>(
      this.mHeadLines.length,
    ).fill(null);

    let n = 0;

    for (const head of this.mHeadLines) {
      if (head.theVia) draggedVias[n] = head.theVia;

      // Incremented unconditionally: the slot index must track m_headLines by
      // position, or a line head preceding a via head misfiles the snapshot.
      n++;
    }

    let affectedArea: PnsBox | null;

    if (aAffectedArea) affectedArea = prevArea ? mergeBox(prevArea, aAffectedArea) : aAffectedArea;
    else affectedArea = prevArea;

    this.mNodeStack.push({
      draggedVias,
      node: aNode,
      affectedArea,
      seq: this.mNodeStack.length
        ? (this.mNodeStack[this.mNodeStack.length - 1] as PnsSpringbackTag).seq + 1
        : 1,
      locked: false,
    });

    return true;
  }

  /**
   * `SHOVE::reduceSpringback( const ITEM_SET& )`: pop the frames that no longer
   * matter, and return the frame the next branch should be taken from.
   *
   * Six details, all of them load-bearing:
   *
   * 1. **`size() > 1`, not `!empty()`** — the bottom frame is never popped
   *    here. Only {@link rewindSpringbackTo} removes it.
   * 2. The do-not-touch check comes **first**, before the collision query, and
   *    breaks out of the loop entirely rather than skipping one frame.
   * 3. A frame is popped only when it collides with nothing **and** is
   *    unlocked. Either alone keeps it.
   * 4. {@link pruneRootLines} runs **before** the node is released — it reads
   *    the node's own index, which upstream's `delete` invalidates.
   * 5. The via restore runs on the frame that *survived*, unconditionally, even
   *    when nothing was popped. `prevVia` and `theVia` are assigned together so
   *    they end up equal, and `geometryModified` is forced true whether or not
   *    the via actually moved.
   * 6. An empty stack answers {@link mRoot}. Reachable only on the first
   *    `run()` — the loop cannot empty the stack.
   */
  private reduceSpringback(aHeadSet: PnsItemSet): PnsNode {
    while (this.mNodeStack.length > 1) {
      const spTag = this.mNodeStack[this.mNodeStack.length - 1] as PnsSpringbackTag;

      // Prevent the springback algo from erasing NODEs holding items the
      // ROUTER_TOOL/LINE_PLACER is still using.
      if (spTag.node === this.mSpringbackDoNotTouchNode) break;

      const obs = spTag.node ? spTag.node.checkColliding(aHeadSet) : null;

      if (!obs && !spTag.locked) {
        if (spTag.node) {
          this.pruneRootLines(spTag.node);
          this.releaseNode(spTag.node);
        }

        this.mNodeStack.pop();
      } else {
        break;
      }
    }

    if (this.mNodeStack.length === 0) return this.mRoot;

    const spTag = this.mNodeStack[this.mNodeStack.length - 1] as PnsSpringbackTag;

    for (let i = 0; i < spTag.draggedVias.length; i++) {
      const vh = spTag.draggedVias[i];
      const head = this.mHeadLines[i];

      if (vh && head) {
        head.prevVia = vh;
        head.theVia = vh;
        head.geometryModified = true;
      }
    }

    return spTag.node ?? this.mRoot;
  }

  /**
   * Upstream's `delete spTag.m_node` — {@link PnsNode.destroy} is `~NODE()`.
   * Dropping the frame's node is what makes its overlay stop existing; the
   * parent's state was never written to, so nothing has to be undone.
   */
  private releaseNode(aNode: PnsNode): void {
    aNode.destroy();
  }

  /** `SHOVE::AddLockedSpringbackNode( NODE* )`. */
  addLockedSpringbackNode(aNode: PnsNode): boolean {
    // Note this does NOT go through pushSpringback: no dragged-via snapshot, no
    // area merge, seq left at 0. Upstream's, deliberately — the frame exists
    // only to stop the pop loop.
    this.mNodeStack.push({
      draggedVias: [],
      node: aNode,
      affectedArea: null,
      seq: 0,
      locked: true,
    });

    return true;
  }

  /** `SHOVE::UnlockSpringbackNode( NODE* )`: the **first** match from the front. */
  unlockSpringbackNode(aNode: PnsNode): void {
    for (const tag of this.mNodeStack) {
      if (tag.node === aNode) {
        tag.locked = false;
        break;
      }
    }
  }

  /**
   * `SHOVE::RewindSpringbackTo( NODE* )`.
   *
   * Note the asymmetry: the **node** survives — only its children are killed —
   * but its **frame** is erased along with everything above it, because the
   * erase range starts at the match rather than after it. A node not on the
   * stack changes nothing and answers false.
   */
  rewindSpringbackTo(aNode: PnsNode): boolean {
    const idx = this.mNodeStack.findIndex((t) => t.node === aNode);

    if (idx < 0) return false;

    aNode.killChildren();
    this.mNodeStack.splice(idx);

    this.mCurrentNode = this.mNodeStack.length
      ? ((this.mNodeStack[this.mNodeStack.length - 1] as PnsSpringbackTag).node ?? this.mRoot)
      : this.mRoot;

    return true;
  }

  /**
   * `SHOVE::RewindToLastLockedNode()`.
   *
   * **The popped frames' nodes are neither released nor pruned** — every other
   * pop path in this class does both. That is upstream's leak
   * (`pns_shove.cpp:2186-2197`), reproduced: closing it would change which
   * nodes stay reachable and therefore what a later `findRootLine` answers.
   *
   * Returns whether the frame it stopped on is actually locked, so `false`
   * means "there was no locked frame and we bottomed out at index 0".
   */
  rewindToLastLockedNode(): boolean {
    if (this.mNodeStack.length === 0) return false;

    while (
      !(this.mNodeStack[this.mNodeStack.length - 1] as PnsSpringbackTag).locked &&
      this.mNodeStack.length > 1
    )
      this.mNodeStack.pop();

    const top = this.mNodeStack[this.mNodeStack.length - 1] as PnsSpringbackTag;

    this.mCurrentNode = top.node ?? this.mRoot;

    return top.locked;
  }

  /**
   * `SHOVE::totalAffectedArea()`: the top frame's area merged with the current
   * run's. Upstream merges into a *copy* of the frame's optional, so the stored
   * frame area is not modified; the reassignment here says the same thing.
   */
  private totalAffectedArea(): PnsBox | null {
    let area = this.mNodeStack.length
      ? (this.mNodeStack[this.mNodeStack.length - 1] as PnsSpringbackTag).affectedArea
      : null;

    if (area && this.mAffectedArea) area = mergeBox(area, this.mAffectedArea);
    else if (!area) area = this.mAffectedArea;

    return area;
  }

  // ----- the root-line history ------------------------------------------------------

  /** `SHOVE::allocRootLine`. `aLine` is genuinely allowed to be null. */
  private allocRootLine(
    aLine: PnsLine | null,
    aPolicy: number = PnsShovePolicy.SHP_DEFAULT,
  ): PnsShoveRootLineEntry {
    const entry: PnsShoveRootLineEntry = {
      rootLine: aLine,
      oldVia: null,
      newVia: null,
      newLine: null,
      policy: aPolicy,
      isHead: false,
    };

    this.mRootLineHistoryEntries.push(entry);

    return entry;
  }

  /** `SHOVE::findRootLine( const LINE& )`: the first link with an entry wins. */
  findRootLine(aLine: PnsLine): PnsShoveRootLineEntry | null {
    for (const link of aLine.links()) {
      const it = this.mRootLineHistory.get(link.uid());

      if (it) return it;
    }

    return null;
  }

  /**
   * `SHOVE::findRootLine( const LINKED_ITEM* )`.
   *
   * The obstacle filter in {@link shoveIteration} reaches this with `SOLID_T`
   * and `HOLE_T` items, which upstream `static_cast`s to `LINKED_ITEM*` even
   * though neither `SOLID` nor `HOLE` derives from it (`pns_solid.h:36`,
   * `pns_hole.h:33`). That cast is undefined behaviour whose only use is to read
   * `Uid()` off whatever happens to sit at that offset — in practice a value
   * that matches no key. "No uid, no entry" is therefore the faithful answer,
   * and the only one available here.
   */
  findRootLineForItem(aItem: PnsLinkedItem | null): PnsShoveRootLineEntry | null {
    if (!aItem || typeof aItem.uid !== 'function') return null;

    return this.mRootLineHistory.get(aItem.uid()) ?? null;
  }

  /** `SHOVE::touchRootLine( const LINE& )`: find, or create from a clone. */
  private touchRootLine(aLine: PnsLine): PnsShoveRootLineEntry {
    for (const link of aLine.links()) {
      const it = this.mRootLineHistory.get(link.uid());

      if (it) return it;
    }

    const rootEntry = this.allocRootLine(aLine.clone());

    for (const link of aLine.links()) this.mRootLineHistory.set(link.uid(), rootEntry);

    return rootEntry;
  }

  /**
   * `SHOVE::touchRootLine( const LINKED_ITEM* )`: the via path, and the one
   * place an entry is created with **no** root line at all.
   */
  private touchRootLineForItem(aItem: PnsLinkedItem): PnsShoveRootLineEntry {
    const it = this.mRootLineHistory.get(aItem.uid());

    if (it) return it;

    const rootEntry = this.allocRootLine(null);

    this.mRootLineHistory.set(aItem.uid(), rootEntry);

    return rootEntry;
  }

  /**
   * `SHOVE::pruneRootLines( NODE* )`.
   *
   * Only the **index** is pruned; {@link mRootLineHistoryEntries} — the owner —
   * grows for the lifetime of the shove. And only `added` is walked; `removed`
   * is fetched and discarded. Both are upstream's.
   */
  private pruneRootLines(aRemovedNode: PnsNode): void {
    const { added } = aRemovedNode.getUpdatedItems();

    for (const item of added) {
      if (item.ofKind(PnsKind.LINKED_ITEM_MASK_T))
        this.mRootLineHistory.delete((item as PnsLinkedItem).uid());
    }
  }

  // ----- replacement ----------------------------------------------------------------

  /** `SHOVE::replaceItems( ITEM*, unique_ptr<ITEM> )`: the via twin of {@link replaceLine}. */
  private replaceItems(aOld: PnsItem, aNew: PnsItem): void {
    const changedArea = itemChangedArea(aOld, aNew);

    if (changedArea) this.mAffectedArea = mergeBox(this.mAffectedArea, changedArea);

    let re: PnsShoveRootLineEntry | null = null;
    let newId = -1;

    if (aOld.ofKind(PnsKind.VIA_T)) {
      re = this.touchRootLineForItem(aOld as PnsVia);
      re.newVia = aNew as PnsVia;
      // Captured before the replace, as upstream captures it before the move.
      newId = (aNew as PnsVia).uid();
    }

    this.mCurrentNode.replaceItem(aOld, aNew);

    if (re && newId >= 0) this.mRootLineHistory.set(newId, re);
  }

  /**
   * `SHOVE::replaceLine( LINE&, LINE&, bool, bool, NODE* )`.
   *
   * The ordering is the whole of it, and upstream flags the reason at
   * `pns_shove.cpp:150`: **`NODE::Replace` invalidates a LINE's links**. So the
   * via unlink and the predecessor lookup must happen before the replace, and
   * re-pointing the new line's links must happen after it.
   *
   * The via unlink (step 2) is not cosmetic: without it `Remove( LINE& )`
   * dispatches the via link too and the via is deleted along with the segments.
   */
  private replaceLine(
    aOld: PnsLine,
    aNew: PnsLine,
    aIncludeInChangedArea = true,
    aAllowRedundantSegments = true,
    aNode: PnsNode | null = null,
  ): PnsShoveRootLineEntry {
    if (aIncludeInChangedArea) {
      const changedArea = lineChangedArea(aOld, aNew);

      if (changedArea) this.mAffectedArea = mergeBox(this.mAffectedArea, changedArea);
    }

    if (aOld.endsWithVia()) {
      let viaLink: PnsLinkedItem | null = null;

      for (const lnk of aOld.links()) {
        if (lnk.ofKind(PnsKind.VIA_T)) {
          viaLink = lnk;
          break;
        }
      }

      if (viaLink) aOld.unlink(viaLink);
    }

    let foundPredecessor = false;
    let rootEntry: PnsShoveRootLineEntry | null = null;

    // Does the shoved line already have an ancestor — from a previous shove
    // iteration, or a previous cursor position?
    for (const link of aOld.links()) {
      const oldLineIter = this.mRootLineHistory.get(link.uid());

      if (oldLineIter) {
        rootEntry = oldLineIter;
        foundPredecessor = true;
        break;
      }
    }

    if (!foundPredecessor) {
      // Upstream's inner `if( !rootEntry )` is provably true here; kept implicit.
      rootEntry = this.allocRootLine(aOld.clone());

      for (const link of aOld.links()) this.mRootLineHistory.set(link.uid(), rootEntry);
    }

    const entry = rootEntry as PnsShoveRootLineEntry;

    if (aNode) aNode.replaceLine(aOld, aNew, aAllowRedundantSegments);
    else this.mCurrentNode.replaceLine(aOld, aNew, aAllowRedundantSegments);

    // Point the new line's links at its oldest ancestor.
    for (const link of aNew.links()) this.mRootLineHistory.set(link.uid(), entry);

    entry.newLine = aNew;

    return entry;
  }

  // ----- the line stack -------------------------------------------------------------

  /**
   * `SHOVE::pushLineStack( const LINE&, bool aKeepCurrentOnTop )`.
   *
   * The guard rejects a line that has segments but no links — such a line is not
   * in the node, so shoving it would move nothing. **Every** call site converts
   * a `false` here into `SH_INCOMPLETE`.
   *
   * `aKeepCurrentOnTop` is never passed true upstream; the one site that would
   * has it commented out with a `// WHY?`. Ported for fidelity.
   */
  private pushLineStack(aL: PnsLine, aKeepCurrentOnTop = false): boolean {
    if (!aL.isLinked() && aL.segmentCount() !== 0) return false;

    if (aKeepCurrentOnTop && this.mLineStack.length > 0)
      this.mLineStack.splice(this.mLineStack.length - 1, 0, aL);
    else this.mLineStack.push(aL);

    this.pruneLineFromOptimizerQueue(aL);
    this.mOptimizerQueue.push(aL);

    return true;
  }

  /**
   * `SHOVE::popLineStack()`.
   *
   * Asymmetric with the push on purpose: pushing *adds* to the optimiser queue,
   * popping *removes* from it. A line that was pushed and then popped leaves no
   * trace for the optimiser. Contrast {@link shoveIteration}'s no-obstacle
   * path, which uses a bare `pop()` precisely so the line **stays** queued.
   */
  private popLineStack(): void {
    const l = this.mLineStack[this.mLineStack.length - 1];

    if (!l) return;

    this.pruneLineFromOptimizerQueue(l);
    this.mLineStack.pop();
  }

  /**
   * `SHOVE::pruneLineFromOptimizerQueue( const LINE& )`: drop every queue entry
   * sharing a **non-via** link with `aLine`. The via exclusion is what keeps a
   * line queued when all it shares with the newcomer is the via at its end.
   */
  private pruneLineFromOptimizerQueue(aLine: PnsLine): boolean {
    this.mOptimizerQueue = this.mOptimizerQueue.filter((q) => {
      for (const s of aLine.links()) {
        if (q.containsLink(s) && !s.ofKind(PnsKind.VIA_T)) return false;
      }

      return true;
    });

    return true;
  }

  /**
   * `SHOVE::unwindLineStack( const LINKED_ITEM* )`.
   *
   * The tadpole branch is the reason this is not a plain filter. Upstream's
   * comment (`pns_shove.cpp:1397-1398`): *"if we have a 'tadpole' in the stack,
   * keep track of the via even if the parent line has been deleted. otherwise —
   * the via will be ignored in the case of collisions with tracks on another
   * layer. Can happen pretty often in densely packed PCBs."* So a stacked line
   * whose segments are going away is **reduced to its via** rather than dropped,
   * and only a line with no via is dropped outright.
   *
   * The inner via search has no early exit upstream, so it keeps the **last**
   * via link rather than the first. With one via per line that is the same
   * thing; it is still what the code does.
   */
  private unwindLineStackForItem(aSeg: PnsLinkedItem): void {
    const kept: PnsLine[] = [];

    for (const i of this.mLineStack) {
      if (!i.containsLink(aSeg)) {
        kept.push(i);
        continue;
      }

      if (i.endsWithVia() && !aSeg.ofKind(PnsKind.VIA_T)) {
        let via: PnsVia | null = null;

        for (const l of i.links()) {
          if (l.ofKind(PnsKind.VIA_T)) via = l as PnsVia;
        }

        if (via) {
          i.clearLinks();
          i.line().clear();
          i.linkVia(via);
        }

        kept.push(i);
      }
      // else: dropped.
    }

    this.mLineStack = kept;

    // The optimiser queue gets no tadpole treatment — plain erasure.
    this.mOptimizerQueue = this.mOptimizerQueue.filter(
      (i) => !(i.containsLink(aSeg) && !aSeg.ofKind(PnsKind.VIA_T)),
    );
  }

  /**
   * `SHOVE::unwindLineStack( const ITEM* )`.
   *
   * **`VIA_T`, `SOLID_T` and `HOLE_T` fall through and do nothing.** That is
   * why `pushOrShoveVia`'s `unwindLineStack( aVia )` is a silent no-op, and why
   * the `aDontUnwindStack` guard around it is decorative at that one site.
   * Reproduced exactly.
   */
  private unwindLineStack(aItem: PnsItem): void {
    if (aItem.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
      this.unwindLineStackForItem(aItem as PnsLinkedItem);
    } else if (aItem.ofKind(PnsKind.LINE_T)) {
      for (const seg of (aItem as PnsLine).links()) this.unwindLineStackForItem(seg);
    }
  }

  // ----- geometry -------------------------------------------------------------------

  /**
   * `SHOVE::getClearance( const ITEM*, const ITEM* )`.
   *
   * Note `aUseEpsilon = false` on all three queries: shove wants the *hard*
   * clearance, not the epsilon-relaxed one the collision search uses. A forced
   * clearance short-circuits everything.
   */
  private getClearance(aA: PnsItem, aB: PnsItem): number {
    if (this.mForceClearance >= 0) return this.mForceClearance;

    let clearance = this.mCurrentNode.getClearance(aA, aB, false);

    const holeA = aA.hole();
    const holeB = aB.hole();

    if (aA.hasHole() && holeA)
      clearance = Math.max(clearance, this.mCurrentNode.getClearance(holeA, aB, false));

    if (aB.hasHole() && holeB)
      clearance = Math.max(clearance, this.mCurrentNode.getClearance(aA, holeB, false));

    return clearance;
  }

  /**
   * `SHOVE::assembleLine( const LINKED_ITEM*, int*, bool aPreCleanup )`.
   *
   * Note the `true` third argument to `AssembleLine` — the walk stops at locked
   * joints. `aPreCleanup` is passed only by {@link onCollidingSegment}.
   */
  private assembleLine(
    aSeg: PnsLinkedItem,
    aIndex: { value: number } | null = null,
    aPreCleanup = false,
  ): PnsLine {
    const cur = this.mCurrentNode.assembleLine(aSeg, aIndex, true);

    if (aPreCleanup) {
      const cleaned = new PnsLine();

      if (this.preShoveCleanup(cur, cleaned)) return cleaned;
    }

    return cur;
  }

  /**
   * `SHOVE::checkShoveDirection`: was the obstacle pushed *outwards* from the
   * pusher, or did it wrap around it?
   *
   * Upstream calls this "a dumb function" in its own comment, and it is: there
   * is no mathematical notion of the orientation of an open curve, so the test
   * closes a ring out of the obstacle's *before* shape followed by its *after*
   * shape **reversed**, and asks whether the pusher's reference point ended up
   * inside it. Inside means the line wrapped round the pusher — wrong way.
   *
   * The reference point is the pusher's **first** point, because a head grows
   * from its start and its start is therefore what is pressing. `SHP_REVERSED`
   * flips that to the last point, which is the segment-endpoint drag case where
   * the far end is what moves. A lone via has neither, so the flip is suppressed
   * for it.
   *
   * Dropping the `Reverse()` would make the two polylines run the same way, so
   * the "ring" would be a figure of eight and the inside test noise.
   */
  private checkShoveDirection(
    aCurLine: PnsLine,
    aObstacleLine: PnsLine,
    aShovedLine: PnsLine,
  ): boolean {
    const root = this.findRootLine(aCurLine);

    const loneVia = aCurLine.pointCount() === 0 && aCurLine.endsWithVia();
    let cp = loneVia ? aCurLine.via().pos() : aCurLine.cPoint(0);

    if (root && root.policy & PnsShovePolicy.SHP_REVERSED && !loneVia) cp = aCurLine.cPoint(-1);

    const ring = [...aObstacleLine.cLine().points(), ...aShovedLine.cLine().reverse().points()];

    return !pointInside(ring, cp);
  }

  /**
   * `SHOVE::shoveLineFromLoneVia`: push the obstacle away from the pusher's via
   * alone.
   *
   * Only reachable when the pusher's segments cannot be used — a different layer
   * or none at all — so the via's hull is the whole obstacle.
   *
   * The clearance adjustment is the **hole-dominates rule**: when the drill's own
   * clearance ring sticks out past the annulus's, the effective clearance is
   * grown so the hull still encloses the hole. The same six lines appear again
   * inside {@link shoveObstacleLine}; upstream duplicates them and so does this.
   *
   * Note the counter-clockwise fallback is taken **without re-checking the
   * direction** — if clockwise was wrong, ccw is assumed right. Then four
   * rejections: too few points, either endpoint moved (a shoved line's ends are
   * pinned at its joints), or the result still hits the pusher.
   */
  private shoveLineFromLoneVia(
    aCurLine: PnsLine,
    aObstacleLine: PnsLine,
    aResultLine: PnsLine,
  ): boolean {
    const obstacleLineWidth = aObstacleLine.width();
    const via = aCurLine.via();
    let clearance = this.getClearance(via, aObstacleLine);
    const viaHole = via.hole();
    const holeClearance = viaHole ? this.getClearance(viaHole, aObstacleLine) : 0;

    if (
      holeClearance + idiv(via.drill(), 2) >
      clearance + idiv(via.diameter(aObstacleLine.layer()), 2)
    )
      clearance =
        holeClearance + idiv(via.drill(), 2) - idiv(via.diameter(aObstacleLine.layer()), 2);

    const hull = itemHull(via, clearance, obstacleLineWidth, aCurLine.layer());

    const pathCw = lineWalkaround(aObstacleLine.cLine(), hull, true);

    if (!pathCw) return false;

    const pathCcw = lineWalkaround(aObstacleLine.cLine(), hull, false);

    if (!pathCcw) return false;

    aResultLine.setShape(pathCw);

    if (!this.checkShoveDirection(aCurLine, aObstacleLine, aResultLine))
      aResultLine.setShape(pathCcw);

    if (aResultLine.cLine().pointCount() < 2) return false;

    if (!samePoint(aObstacleLine.cLastPoint(), aResultLine.cLine().cLastPoint())) return false;

    if (!samePoint(aObstacleLine.cPoint(0), aResultLine.cLine().cPoint(0))) return false;

    // Live since ZiroEDA issue #484 — a LINE had no shape, so this answered
    // `false` whatever the geometry. Forcing it back to that answer still leaves
    // the whole suite green: no fixture walks a line round a via and lands it
    // back on the line it was avoiding. Named rather than contrived, and the
    // same is true of the three sister guards in this file.
    if (aResultLine.collide(aCurLine, this.mCurrentNode, aResultLine.layer())) return false;

    return true;
  }

  /**
   * `SHOVE::shoveLineToHullSet`: re-walk the obstacle around a set of hulls.
   *
   * Four attempts, which are `{forward, reverse hull order} × {ccw, cw}`:
   * `invertTraversal = attempt >= 2` reverses the *order the hulls are visited*,
   * not the hulls themselves, and `clockwise = attempt % 2`.
   *
   * Each hull is walked around the **result** of the previous one, cumulatively,
   * with a `Simplify2` between — so the hull order genuinely changes the answer,
   * which is why reversing it is worth two of the four attempts.
   *
   * The endpoint adjustment (only when permitted, and only from attempt 2) pulls
   * an endpoint that is within 1 µm of a hull onto that hull. **The end is
   * appended before the start is inserted**, so the insertion at index 0 cannot
   * disturb the append.
   *
   * Then five acceptance tests in order, each of which abandons the attempt:
   * geometry differs nowhere yet compares unequal; either endpoint moved; the
   * direction check; self-intersection; still colliding with the pusher. The
   * direction check **writes `aResultLine` before rejecting** — deliberate, and
   * relied on by the same "write then reconsider" shape in
   * {@link shoveLineFromLoneVia}.
   *
   * ### What the test suite does *not* pin here
   *
   * Mutation testing found these sub-behaviours unkilled, and they are recorded
   * rather than papered over with a contrived board:
   *
   * - **Which of `aPermitAdjustingStart`/`aPermitAdjustingEnd` gates which
   *   endpoint**, and **whether the adjustment is offered from attempt 0 or
   *   attempt 2.** On the one geometry in the suite that reaches the adjustment
   *   at all (an obstacle exactly co-extensive with its pusher), both endpoints
   *   are adjustable and the unadjusted attempt-0 walk happens to land on the
   *   same chain, so swapping either produces an identical result.
   * - **The moved-endpoint rejection**, for the same reason: on that geometry
   *   attempt 0's walk is a bodily translation whose endpoints coincide with
   *   what the adjustment would have chosen.
   * - **The `clockwise` and `invertTraversal` schedules.** Every tested
   *   geometry is symmetric about its pusher, so both directions and both hull
   *   orders yield an acceptable candidate and `checkShoveDirection` picks the
   *   outward one either way.
   * - **The still-colliding rejection**, which no tested case triggers.
   *
   * Distinguishing them needs an asymmetric multi-hull board where one traversal
   * order genuinely fails — that is a fixture worth building when a real board
   * regression points at one, not before.
   */
  private shoveLineToHullSet(
    aCurLine: PnsLine,
    aObstacleLine: PnsLine,
    aResultLine: PnsLine,
    aHulls: readonly Vec2[][],
    aPermitAdjustingStart = false,
    aPermitAdjustingEnd = false,
  ): boolean {
    const C_ENDPOINT_ON_HULL_THRESHOLD = 1000;
    const permitAdjustingEndpoints = aPermitAdjustingStart || aPermitAdjustingEnd;

    for (let attempt = 0; attempt < 4; attempt++) {
      const invertTraversal = attempt >= 2;
      const clockwise = attempt % 2 !== 0;

      let vFirst = -1;
      let vLast = -1;

      let obs = aObstacleLine.cLine().clone();
      const l = aObstacleLine.clone();
      let path = l.cLine().clone();

      if (permitAdjustingEndpoints && l.segmentCount() >= 1) {
        const minDistP = (pref: Vec2): { p: Vec2; dist: number } => {
          let minDist = Number.MAX_SAFE_INTEGER;
          let nearestP: Vec2 = { x: 0, y: 0 };

          for (let i = 0; i < aHulls.length; i++) {
            const hull = aHulls[invertTraversal ? aHulls.length - 1 - i : i] as Vec2[];
            const p = nearestPointOnChain(hull, pref);
            const dist = pointInside(hull, pref) ? 0 : norm({ x: p.x - pref.x, y: p.y - pref.y });

            if (dist < C_ENDPOINT_ON_HULL_THRESHOLD && dist < minDist) {
              // Upstream declares a `reject` flag here, never assigns it, and
              // guards this block with `if( !reject )`. A stub for a rule that
              // was never written; the block is therefore unconditional.
              minDist = dist;
              nearestP = p;
            }
          }

          return { p: nearestP, dist: minDist };
        };

        const r0 = minDistP(l.cPoint(0));
        const r1 = minDistP(l.cLastPoint());

        // End first, then start: appending is index-free, inserting at 0 is not.
        if (r1.dist < C_ENDPOINT_ON_HULL_THRESHOLD && aPermitAdjustingEnd) {
          l.line().appendPoint(r1.p);
          obs = l.cLine().clone();
          path = l.cLine().clone();
        }

        if (r0.dist < C_ENDPOINT_ON_HULL_THRESHOLD && aPermitAdjustingStart) {
          l.line().insertPoint(0, r0.p);
          obs = l.cLine().clone();
          path = l.cLine().clone();
        }
      }

      let failWalk = false;

      for (let i = 0; i < aHulls.length; i++) {
        const hull = aHulls[invertTraversal ? aHulls.length - 1 - i : i] as Vec2[];

        const next = lineWalkaround(l.cLine(), hull, clockwise);

        if (!next) {
          failWalk = true;
          break;
        }

        path = next;
        path.simplify2();
        l.setShape(path.clone());
      }

      if (failWalk) continue;

      for (let i = 0; i < Math.min(path.pointCount(), obs.pointCount()); i++) {
        if (!samePoint(path.cPoint(i), obs.cPoint(i))) {
          vFirst = i;
          break;
        }
      }

      let k = obs.pointCount() - 1;

      for (let i = path.pointCount() - 1; i >= 0 && k >= 0; i--, k--) {
        if (!samePoint(path.cPoint(i), obs.cPoint(k))) {
          vLast = i;
          break;
        }
      }

      if ((vFirst < 0 || vLast < 0) && !path.compareGeometry(obs)) continue;

      if (!samePoint(path.cLastPoint(), obs.cLastPoint())) continue;
      if (!samePoint(path.cPoint(0), obs.cPoint(0))) continue;

      if (!this.checkShoveDirection(aCurLine, aObstacleLine, l)) {
        // Deliberately written out before abandoning the attempt.
        aResultLine.setShape(l.cLine().clone());
        continue;
      }

      if (path.selfIntersecting()) continue;

      // Live since issue #484, uncovered — see the note in shoveLineFromLoneVia.
      if (l.collide(aCurLine, this.mCurrentNode, l.layer())) continue;

      aResultLine.setShape(l.cLine().clone());

      return true;
    }

    return false;
  }

  /**
   * `SHOVE::ShoveObstacleLine`: push `aObstacleLine` away from `aCurLine` by the
   * clearance, into `aResultLine`. Public upstream, and public here.
   *
   * Two geometries. If the pusher ends with a via **and** either it has no
   * usable segments or they are on another layer, the via alone does the
   * pushing ({@link shoveLineFromLoneVia}). Otherwise a hull per segment of the
   * pusher, plus the via's if it has one, and three attempts with the hulls
   * growing by 1 µm each time.
   *
   * ### Not pinned: the arc clearance
   *
   * No test in the suite gives a pusher an arc segment, so removing the
   * `DEFAULT_ARC_ACCURACY_FOR_PCB` addition below — and with it the accumulation
   * bug described next — changes nothing observable. Building an arc-bearing
   * `PnsLineChain` fixture is the missing piece.
   *
   * ### Upstream bug: the arc clearance accumulates
   *
   * `pns_shove.cpp:589-594` does `clearance += DefaultAccuracyForPCB()` **inside**
   * the per-segment hull loop, on the shared `clearance` local. So a line with
   * three arc segments builds its third hull at three times the extra clearance,
   * the via hull inherits all of it, and it carries into the next attempt. It
   * was plainly meant to be a per-hull addition. Reproduced, because the hulls
   * a real board produces are what this port has to match.
   *
   * Endpoint adjustment is offered only from the third attempt, and never for an
   * endpoint carrying a via — a via pins the endpoint, so moving it would
   * disconnect the track.
   */
  shoveObstacleLine(aCurLine: PnsLine, aObstacleLine: PnsLine, aResultLine: PnsLine): boolean {
    const C_HULL_FAILURE_EXPANSION_FACTOR = 1000;
    let extraHullExpansion = 0;

    let voeStart = false;
    let voeEnd = false;
    let jtStart: PnsJoint | null = null;
    let jtEnd: PnsJoint | null = null;

    if (aObstacleLine.pointCount() >= 2) {
      jtStart = this.mCurrentNode.findJointForItem(aObstacleLine.cPoint(0), aObstacleLine);
      jtEnd = this.mCurrentNode.findJointForItem(aObstacleLine.cLastPoint(), aObstacleLine);
    }

    if (jtStart) voeStart = jtStart.via() !== null;
    if (jtEnd) voeEnd = jtEnd.via() !== null;

    aResultLine.clearLinks();

    const viaOnEnd = aCurLine.endsWithVia();

    const obstacleLine = aObstacleLine.clone();
    let obsVia: PnsVia | null = null;

    if (obstacleLine.endsWithVia()) {
      obsVia = aObstacleLine.via();
      obstacleLine.removeVia();
    }

    if (viaOnEnd && (!aCurLine.layersOverlap(obstacleLine) || aCurLine.segmentCount() === 0)) {
      return this.shoveLineFromLoneVia(aCurLine, obstacleLine, aResultLine);
    }

    const obstacleLineWidth = obstacleLine.width();
    let clearance = this.getClearance(aCurLine, obstacleLine);
    const currentLineSegmentCount = aCurLine.segmentCount();

    for (let attempt = 0; attempt < 3; attempt++) {
      const hulls: Vec2[][] = [];

      for (let i = 0; i < currentLineSegmentCount; i++) {
        const s = aCurLine.cLine().cSegment(i);
        const seg = PnsSegment.fromParentLine(aCurLine, s);

        // Arcs need extra clearance so the hull is always bigger than the arc.
        // See the docblock: this `+=` mutates the shared local, upstream's bug.
        if (aCurLine.cLine().isArcSegment(i)) clearance += DEFAULT_ARC_ACCURACY_FOR_PCB;

        hulls.push(
          itemHull(seg, clearance + extraHullExpansion, obstacleLineWidth, obstacleLine.layer()),
        );
      }

      if (viaOnEnd) {
        const via = aCurLine.via();
        let viaClearance = this.getClearance(via, obstacleLine);
        const viaHole = via.hole();
        const holeClearance = viaHole ? this.getClearance(viaHole, obstacleLine) : 0;
        const layer = aObstacleLine.layer();

        if (holeClearance + idiv(via.drill(), 2) > viaClearance + idiv(via.diameter(layer), 2))
          viaClearance = holeClearance + idiv(via.drill(), 2) - idiv(via.diameter(layer), 2);

        hulls.push(itemHull(via, viaClearance, obstacleLineWidth, layer));
      }

      const permitMovingStart = attempt >= 2 && !voeStart;
      const permitMovingEnd = attempt >= 2 && !voeEnd;

      if (
        this.shoveLineToHullSet(
          aCurLine,
          obstacleLine,
          aResultLine,
          hulls,
          permitMovingStart,
          permitMovingEnd,
        )
      ) {
        if (obsVia) aResultLine.appendVia(obsVia);

        return true;
      }

      extraHullExpansion += C_HULL_FAILURE_EXPANSION_FACTOR;
    }

    return false;
  }

  // ----- collision handlers ---------------------------------------------------------

  /**
   * `SHOVE::onCollidingSegment`. The pusher stays; the obstacle's whole line is
   * re-walked and takes rank one *below* the pusher, which is what makes the
   * next iteration willing to shove it further rather than bounce off it.
   *
   * This is the only handler that runs {@link preShoveCleanup}.
   */
  private onCollidingSegment(aCurrent: PnsLine, aObstacleSeg: PnsSegment): PnsShoveStatus {
    const segIndex = { value: 0 };

    const obstacleLine = this.assembleLine(aObstacleSeg, segIndex, true);
    const shovedLine = obstacleLine.clone();

    if (obstacleLine.hasLockedSegments()) return PnsShoveStatus.SH_TRY_WALK;

    const shoveOK = this.shoveObstacleLine(aCurrent, obstacleLine, shovedLine);

    if (shoveOK) {
      const rank = aCurrent.rank();

      shovedLine.setRank(rank - 1);
      shovedLine.line().simplify2();

      this.unwindLineStack(obstacleLine);

      this.replaceLine(obstacleLine, shovedLine, true, false);

      if (!this.pushLineStack(shovedLine)) return PnsShoveStatus.SH_INCOMPLETE;

      return PnsShoveStatus.SH_OK;
    }

    return PnsShoveStatus.SH_INCOMPLETE;
  }

  /**
   * `SHOVE::onCollidingArc`.
   *
   * Two things differ from the segment path. There is an **extension check**:
   * a shove that more than doubles the arc's length is taken as evidence the
   * shove is wrong, and asks for a walkaround instead.
   *
   * ### Upstream bug: a failed arc shove reports success
   *
   * `pns_shove.cpp:720-731` — the `if( shoveOK )` wraps only the mutation, and
   * the `return SH_OK` sits **outside** it. So when the shove fails nothing
   * moves and the caller is told everything is fine; the main loop then finds
   * the same arc again next iteration and spins to the cap. Reproduced.
   */
  private onCollidingArc(aCurrent: PnsLine, aObstacleArc: PnsArc): PnsShoveStatus {
    const segIndex = { value: 0 };
    const obstacleLine = this.assembleLine(aObstacleArc, segIndex);
    const shovedLine = obstacleLine.clone();

    if (obstacleLine.hasLockedSegments()) return PnsShoveStatus.SH_TRY_WALK;

    const shoveOK = this.shoveObstacleLine(aCurrent, obstacleLine, shovedLine);

    const extensionWalkThreshold = 1.0;

    const obsLen = obstacleLine.cLine().length();
    const shovedLen = shovedLine.cLine().length();
    let extensionFactor = 0.0;

    if (obsLen !== 0.0) extensionFactor = shovedLen / obsLen - 1.0;

    if (extensionFactor > extensionWalkThreshold) return PnsShoveStatus.SH_TRY_WALK;

    if (shoveOK) {
      const rank = aCurrent.rank();
      shovedLine.setRank(rank - 1);

      this.replaceLine(obstacleLine, shovedLine, true, false);

      if (!this.pushLineStack(shovedLine)) return PnsShoveStatus.SH_INCOMPLETE;
    }

    // Outside the `if` — see the docblock.
    return PnsShoveStatus.SH_OK;
  }

  /**
   * `SHOVE::onCollidingLine`: plain line-on-line, used by the reverse paths.
   *
   * Note `replaceLine` runs **before** `setRank`. The rank has to land on links
   * that exist; setting it first would write it to links `Replace` then throws
   * away.
   */
  private onCollidingLine(
    aCurrent: PnsLine,
    aObstacle: PnsLine,
    aNextRank: number,
  ): PnsShoveStatus {
    const shovedLine = aObstacle.clone();

    const shoveOK = this.shoveObstacleLine(aCurrent, aObstacle, shovedLine);

    if (shoveOK) {
      this.replaceLine(aObstacle, shovedLine, true, false);

      shovedLine.setRank(aNextRank);

      if (!this.pushLineStack(shovedLine)) return PnsShoveStatus.SH_INCOMPLETE;

      return PnsShoveStatus.SH_OK;
    }

    return PnsShoveStatus.SH_INCOMPLETE;
  }

  /**
   * `SHOVE::onCollidingSolid`: the walkaround fallback. **The current line
   * moves, not the obstacle** — solids do not shove.
   *
   * If the pusher ends with a via and *that* is what hits the solid, the via is
   * shoved instead (note the inverted argument order into
   * {@link onCollidingVia}: the solid is passed as the "current" item).
   *
   * Otherwise the obstacle's connected cluster is assembled and the line is
   * routed around it. Two attempts, differing only in the rank the result takes:
   * `currentRank + 10000` on the first — "go over the top", rank it so far above
   * everything that nothing tries to shove it back this pass — and
   * `currentRank - 1` on the second, or on the first when the settings say to
   * jump over obstacles.
   *
   * The success test is against `m_lineStack.front()` — the **bottom** of the
   * stack, the original head, not the top. And the entire success path is inside
   * `if( !m_lineStack.empty() )`, so an empty stack means failure however good
   * the route was.
   *
   * Finally {@link popLineStack} runs **before** the push: the current line is
   * *replaced* on the stack, not stacked on top of itself.
   */
  private onCollidingSolid(
    aCurrent: PnsLine,
    aObstacle: PnsItem,
    aObstacleInfo: Obstacle,
  ): PnsShoveStatus {
    let walkaroundLine = aCurrent.clone();

    if (aCurrent.endsWithVia()) {
      const vh = aCurrent.via();
      let via: PnsVia | null = null;
      const jtStart = this.mCurrentNode.findJointForItem(vh.pos(), aCurrent);

      if (!jtStart) return PnsShoveStatus.SH_INCOMPLETE;

      for (const item of jtStart.linkList()) {
        if (item.ofKind(PnsKind.VIA_T)) {
          via = item as PnsVia;
          break;
        }
      }

      if (via?.collide(aObstacle, this.mCurrentNode, aObstacle.layer()))
        // Note the inverted argument order: the SOLID is passed as "current".
        return this.onCollidingVia(aObstacle, via, aObstacleInfo, aObstacle.rank() - 1);
    }

    const cluster = this.assembleCluster(aObstacle, aCurrent.layers().start(), 10.0);

    const currentRank = aCurrent.rank();
    let nextRank = currentRank - 1;

    let success = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt === 1 || this.mSettings.jumpOverObstacles) nextRank = currentRank - 1;
      else nextRank = currentRank + 10000;

      const routed = this.routeAroundCluster(aCurrent, cluster);

      if (!routed) continue;

      walkaroundLine = routed;

      walkaroundLine.clearLinks();
      walkaroundLine.unmark();
      walkaroundLine.line().simplify2();

      if (walkaroundLine.hasLoops()) continue;

      if (this.mLineStack.length > 0) {
        const lastLine = this.mLineStack[0] as PnsLine;

        // Live since issue #484, uncovered — see the note in shoveLineFromLoneVia.
        if (lastLine.collide(walkaroundLine, this.mCurrentNode, lastLine.layer())) {
          const dummy = lastLine.clone();

          if (this.shoveObstacleLine(walkaroundLine, lastLine, dummy)) {
            success = true;
            break;
          }
        } else {
          success = true;
          break;
        }
      }
    }

    if (!success) return PnsShoveStatus.SH_INCOMPLETE;

    this.replaceLine(aCurrent, walkaroundLine, true, false);
    walkaroundLine.setRank(nextRank);

    this.popLineStack();

    if (!this.pushLineStack(walkaroundLine)) return PnsShoveStatus.SH_INCOMPLETE;

    return PnsShoveStatus.SH_OK;
  }

  /**
   * `SHOVE::pushOrShoveVia`: move a via by at least `aForce`, dragging every
   * track fanning out of it along with it.
   *
   * The four early exits are in a semantic order, not an arbitrary one: a zero
   * force **succeeds** even for a locked via; a missing joint fails before the
   * lock is consulted at all; a locked *via* asks for a walkaround while a
   * locked *joint* is a hard failure.
   *
   * The joint-avoidance loop nudges the destination 2 nm along the force
   * direction until it is not on top of an existing joint — two vias sharing a
   * joint would be merged by `touchJoint` and the router would lose one.
   * Upstream has no iteration cap there; see the note on the loop below.
   *
   * Each fanout line is normalised so the via is at its **end**
   * (`segIndex == 0` → reverse), because every consumer of a via-terminated line
   * in this class assumes that.
   */
  private pushOrShoveVia(
    aVia: PnsVia,
    aForce: Vec2,
    aNewRank: number,
    aDontUnwindStack = false,
  ): PnsShoveStatus {
    const draggedLines: { first: PnsLine; second: PnsLine }[] = [];
    const p0 = aVia.pos();
    const jt = this.mCurrentNode.findJointForItem(p0, aVia);
    let p0Pushed: Vec2 = { x: p0.x + aForce.x, y: p0.y + aForce.y };

    // Nothing to do...
    if (aForce.x === 0 && aForce.y === 0) return PnsShoveStatus.SH_OK;

    if (!jt) return PnsShoveStatus.SH_INCOMPLETE;

    if (this.mSettings.shoveVias === false || aVia.isLocked()) return PnsShoveStatus.SH_TRY_WALK;

    if (jt.isLocked()) return PnsShoveStatus.SH_INCOMPLETE;

    // Make sure the pushed via does not overlap any existing joint.
    //
    // Upstream's `while( true )` has no cap. It terminates because joints are
    // finite and every step is a fixed 2 nm along a fixed direction, but an
    // unbounded loop in TypeScript freezes the editor's main thread where C++
    // would merely be slow. The cap is set far above any reachable value and
    // exhausting it is treated as a failed shove. This is the one place the port
    // is not byte-identical, and it is called out in the spec (§10.3).
    const step = resizeVec(aForce, 2);
    let guard = 0;

    for (;;) {
      const jtNext = this.mCurrentNode.findJointForItem(p0Pushed, aVia);

      if (!jtNext) break;

      if (++guard > 100000) return PnsShoveStatus.SH_INCOMPLETE;

      p0Pushed = { x: p0Pushed.x + step.x, y: p0Pushed.y + step.y };
    }

    const pushedVia = aVia.clone();
    pushedVia.setPos(p0Pushed);
    pushedVia.mark(aVia.marker());

    for (const item of jt.linkList()) {
      if (item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
        const li = item as PnsLinkedItem;
        const segIndex = { value: 0 };

        const first = this.assembleLine(li, segIndex);

        if (first.hasLockedSegments()) return PnsShoveStatus.SH_TRY_WALK;

        // Upstream asserts the via is at one end or the other. In a release
        // build the assert is gone and the reverse below runs anyway.
        if (segIndex.value === 0) first.reverse();

        const second = first.clone();
        second.clearLinks();

        const idx = second.cLine().find(p0);
        const dragged = dragCorner(second.cLine().points(), p0Pushed, idx, false);

        second.setShape(PnsLineChain.fromPoints(dragged));
        second.line().simplify2();

        draggedLines.push({ first, second });
      }
    }

    pushedVia.setRank(aNewRank);

    const v2 = pushedVia;

    // A no-op: `unwindLineStack( ITEM* )` has no VIA_T arm. Upstream's, kept so
    // the guard reads the same. See the docblock on `unwindLineStack`.
    if (!aDontUnwindStack) this.unwindLineStack(aVia);

    this.replaceItems(aVia, pushedVia);

    if (draggedLines.length === 0) {
      // A stitching via — make sure the router does not forget about it.
      const tmpLine = new PnsLine();
      tmpLine.linkVia(v2);

      if (!this.pushLineStack(tmpLine)) return PnsShoveStatus.SH_INCOMPLETE;
    }

    for (const lp of draggedLines) {
      if (!aDontUnwindStack) this.unwindLineStack(lp.first);

      if (lp.second.segmentCount()) {
        lp.second.clearLinks();

        // aAllowRedundantSegments = true, and this is the ONLY replaceLine call
        // in the class that passes true: dragging a via can legitimately make a
        // segment coincide with an existing one, whereas a shove never should.
        const rootEntry = this.replaceLine(lp.first, lp.second, true, true);

        lp.second.linkVia(v2);

        if (!aDontUnwindStack) this.unwindLineStack(lp.second);

        lp.second.setRank(aNewRank);

        if (rootEntry) rootEntry.newLine = lp.second; // upstream: "fixme: it's inelegant"

        if (!this.pushLineStack(lp.second)) return PnsShoveStatus.SH_INCOMPLETE;
      } else {
        this.mCurrentNode.removeLine(lp.first);
      }
    }

    return PnsShoveStatus.SH_OK;
  }

  /**
   * `SHOVE::onCollidingVia`: work out the minimum translation that resolves the
   * collision and hand it to {@link pushOrShoveVia}.
   *
   * `maxFanoutWidth` — set by {@link fixupViaCollisions} — temporarily fattens
   * the obstacle via to the width of the widest track fanning out of it, so the
   * translation computed is enough to clear those tracks and not just the via.
   *
   * The priority is via-collision, then line-collision, then solid-collision,
   * and each takes the **negated** MTV; `pushOrShoveVia` is then called with
   * `-mtv`, so the force applied is `+mtv`. Upstream leaves a
   * `// fixme: we may have a sign issue` beside it. The double negation is kept
   * literally rather than collapsed, because collapsing it would hide the note
   * the next reader needs.
   */
  private onCollidingVia(
    aCurrent: PnsItem,
    aObstacleVia: PnsVia,
    aObstacleInfo: Obstacle,
    aNextRank: number,
  ): PnsShoveStatus {
    const clearance = this.getClearance(aCurrent, aObstacleVia);
    let mtv: Vec2 = { x: 0, y: 0 };

    let lineCollision = false;
    let viaCollision = false;
    let solidCollision = false;
    let mtvLine: Vec2 = { x: 0, y: 0 };
    let mtvVia: Vec2 = { x: 0, y: 0 };
    const mtvSolid: Vec2 = { x: 0, y: 0 };

    if (aCurrent.ofKind(PnsKind.LINE_T)) {
      const vtmp = aObstacleVia.clone();
      const layer = aCurrent.layer();

      if (
        aObstacleInfo.maxFanoutWidth > 0 &&
        aObstacleInfo.maxFanoutWidth > aObstacleVia.diameter(layer)
      )
        vtmp.setDiameter(layer, aObstacleInfo.maxFanoutWidth);

      const currentLine = aCurrent as PnsLine;

      const r = collideViaWithLine(
        vtmp,
        currentLine,
        clearance + idiv(currentLine.width(), 2),
        layer,
      );

      lineCollision = r.collides;
      mtvLine = r.mtv;

      // Check the via if present. Via takes priority.
      if (currentLine.endsWithVia()) {
        const currentVia = currentLine.via();
        const viaClearance = this.getClearance(currentVia, vtmp);

        for (const viaLayer of currentVia.relevantShapeLayers(vtmp)) {
          const lm = collideViaWithVia(currentVia, vtmp, viaClearance, viaLayer);

          viaCollision = viaCollision || lm.collides;

          if (squaredNorm(lm.mtv) > squaredNorm(mtvVia)) mtvVia = lm.mtv;
        }
      }
    } else if (aCurrent.ofKind(PnsKind.SOLID_T)) {
      // Upstream doubts this case is reachable at all and does not shove solids.
      solidCollision = false;
    }

    if (viaCollision) mtv = { x: -mtvVia.x, y: -mtvVia.y };
    else if (lineCollision) mtv = { x: -mtvLine.x, y: -mtvLine.y };
    else if (solidCollision) mtv = { x: -mtvSolid.x, y: -mtvSolid.y };
    else mtv = { x: 0, y: 0 };

    return this.pushOrShoveVia(aObstacleVia, { x: -mtv.x, y: -mtv.y }, aNextRank);
  }

  /**
   * `SHOVE::onReverseCollidingVia`: the obstacle out-ranks us, so **we** walk
   * around **it**.
   *
   * If our own via hits theirs it becomes a forward via shove instead. (The
   * `dist`, hull and `epInsideHull` upstream computes just above that branch
   * feed only a debug print and have no effect on it; they are not ported.)
   *
   * Otherwise, for each track fanning out of the obstacle via, a synthetic
   * pusher is built out of *that track plus the obstacle via* and used to shove
   * us. `cur` accumulates across the fanout, so each successive track pushes us
   * further. A via with no fanout at all is handled by the `n === 0` arm with a
   * pusher that is just the via.
   *
   * The stack is unwound **twice** — once before the shove and once after — and
   * the rank is set **after** the push rather than before, unlike every other
   * handler. Both are upstream's; the rank still lands because
   * {@link PnsLine.setRank} writes through to the shared links.
   */
  private onReverseCollidingVia(
    aCurrent: PnsLine,
    aObstacleVia: PnsVia,
    aObstacleInfo: Obstacle,
  ): PnsShoveStatus {
    let n = 0;

    if (aCurrent.endsWithVia()) {
      const clearance = this.getClearance(aCurrent.via(), aObstacleVia);

      let viaCollision = false;

      for (const viaLayer of aCurrent.via().relevantShapeLayers(aObstacleVia)) {
        viaCollision =
          viaCollision ||
          collideViaWithVia(aCurrent.via(), aObstacleVia, clearance, viaLayer).collides;
      }

      if (viaCollision)
        return this.onCollidingVia(aCurrent, aObstacleVia, aObstacleInfo, aCurrent.rank() - 1);
    }

    const cur = aCurrent.clone();
    cur.clearLinks();

    const jt = this.mCurrentNode.findJointForItem(aObstacleVia.pos(), aObstacleVia);
    const shoved = aCurrent.clone();
    shoved.clearLinks();

    cur.removeVia();
    this.unwindLineStack(aCurrent);

    // Upstream dereferences `jt` here with no null check, unlike every other
    // FindJoint in the file. A null joint is a crash upstream; here it is a
    // failed shove, which is the closest defined behaviour.
    if (!jt) return PnsShoveStatus.SH_INCOMPLETE;

    for (const item of jt.linkList()) {
      if (item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T) && item.layersOverlap(aCurrent)) {
        const li = item as PnsLinkedItem;
        const head = this.assembleLine(li);

        head.appendVia(aObstacleVia);

        const shoveOK = this.shoveObstacleLine(head, cur, shoved);

        if (!shoveOK) return PnsShoveStatus.SH_INCOMPLETE;

        cur.setShape(shoved.cLine().clone());
        n++;
      }
    }

    if (!n) {
      const head = aCurrent.clone();
      head.line().clear();
      head.appendVia(aObstacleVia);
      head.clearLinks();

      const shoveOK = this.shoveObstacleLine(head, aCurrent, shoved);

      if (!shoveOK) return PnsShoveStatus.SH_INCOMPLETE;

      cur.setShape(shoved.cLine().clone());
    }

    if (aCurrent.endsWithVia()) shoved.appendVia(aCurrent.via());

    const currentRank = aCurrent.rank();
    this.unwindLineStack(aCurrent);
    this.replaceLine(aCurrent, shoved, true, false);

    if (!this.pushLineStack(shoved)) return PnsShoveStatus.SH_INCOMPLETE;

    shoved.setRank(currentRank);

    return PnsShoveStatus.SH_OK;
  }

  /**
   * `SHOVE::fixupViaCollisions`: mutate the obstacle in place so the shove can
   * actually resolve.
   *
   * Upstream states the reason at `pns_shove.cpp:1521-1525`: the algorithm's
   * base assumption is that track ends never move on their own, only dragged by
   * force-propagated vias. So a via *narrower* than the tracks fanning out of it
   * cannot resolve the collision by moving — the tracks still overlap — and the
   * shove thrashes. The fix is to pretend the via is as wide as its widest
   * track (the `+ 1` makes it strictly wider), or, when the obstacle is a
   * segment pinned by such a via, to **redirect the shove onto the via**.
   */
  private fixupViaCollisions(aCurrent: PnsLine, obs: Obstacle): boolean {
    const layer = aCurrent.layer();

    if (!obs.item) return false;

    if (obs.item.ofKind(PnsKind.VIA_T)) {
      const v = obs.item as PnsVia;
      let maxw = 0;
      const jv = this.mCurrentNode.findJointForItem(v.pos(), v);

      if (!jv) return false;

      for (const link of jv.linkList()) {
        if (link.ofKind(PnsKind.SEGMENT_T)) maxw = Math.max((link as PnsSegment).width(), maxw);
        else if (link.ofKind(PnsKind.ARC_T)) maxw = Math.max((link as PnsArc).width(), maxw);
      }

      obs.maxFanoutWidth = 0;

      if (maxw > 0 && maxw >= v.diameter(layer)) {
        obs.maxFanoutWidth = maxw + 1;

        return true;
      }

      return false;
    }

    if (!obs.item.ofKind(PnsKind.SEGMENT_T)) return false;

    const s = obs.item as PnsSegment;
    const sl = s.layer();

    const ja = this.mCurrentNode.findJointForItem(s.seg().a, s);
    const jb = this.mCurrentNode.findJointForItem(s.seg().b, s);

    // Upstream dereferences both unchecked.
    const vias: (PnsVia | null)[] = [
      (ja?.via() as PnsVia | null) ?? null,
      (jb?.via() as PnsVia | null) ?? null,
    ];

    for (const v of vias) {
      // A via already wider than the segment is fine — force propagation copes.
      if (!v || v.diameter(sl) > s.width()) continue;

      const vtest = v.clone();
      vtest.setDiameter(sl, s.width());

      // `aCurrent` is a LINE, so this too was dead before issue #484, and it too
      // is uncovered — see the note in shoveLineFromLoneVia.
      if (vtest.collide(aCurrent, this.mCurrentNode, aCurrent.layer())) {
        // Drop the segment from this iteration and force-propagate the via.
        obs.item = v;
        obs.maxFanoutWidth = s.width() + 1;

        return true;
      }
    }

    return false;
  }

  /**
   * `SHOVE::patchTadpoleVia`: if the current line ends on a joint that carries a
   * colliding via, adopt that via so the collision is not lost.
   *
   * **Returns false unconditionally**, even on the branch that modified
   * `current` — and both call sites discard the return anyway. The `nearest`
   * parameter is never read. Both upstream's.
   */
  private patchTadpoleVia(_nearest: PnsItem, current: PnsLine): boolean {
    if (current.cLine().pointCount() < 1) return false;

    const jtViaEnd = this.mCurrentNode.findJointForItem(current.cLine().cLastPoint(), current);

    if (!jtViaEnd) return false;

    const viaEnd = jtViaEnd.via() as PnsVia | null;

    if (!viaEnd) return false;

    const colliding = this.mCurrentNode.checkColliding(viaEnd) !== null;

    if (viaEnd && !current.endsWithVia() && colliding) current.linkVia(viaEnd);

    return false;
  }

  // ----- the loops -------------------------------------------------------------------

  /**
   * `SHOVE::shoveIteration`: resolve the next collision.
   *
   * ### The search order decides everything
   *
   * `{ SOLID_T, VIA_T, SEGMENT_T, HOLE_T }`, first non-empty result wins and
   * breaks. That is the "what gets shoved first" policy: pads before vias before
   * tracks before holes. Reorder it and the router starts pushing a track where
   * it should have moved a via, or walks round a pad it should have shoved past.
   *
   * **`ARC_T` is not in the list.** So the arc arms of both dispatch switches
   * below are unreachable in this revision — an arc obstacle is simply never
   * found. Reproduced; flagged in the spec (§9.9).
   *
   * ### The rank split
   *
   * `!SOLID_T && rank >= 0 && rank > currentLine.rank()` selects the *reverse*
   * branch: we have hit something we already shoved, so **we** move. Solids are
   * excluded because they never rank, and rank -1 (untouched world geometry) is
   * excluded so it takes the forward branch and gets shoved.
   *
   * Note the arc arm of the reverse branch passes `revLine.rank() - 1` where the
   * segment arm passes `+ 1`. Almost certainly a typo upstream; reproduced.
   *
   * ### No obstacle
   *
   * A bare `pop()`, **not** {@link popLineStack} — so the line stays in the
   * optimiser queue. That asymmetry is what feeds the optimiser: a line that
   * shoved cleanly is exactly what wants optimising.
   */
  private shoveIteration(_aIter: number): PnsShoveStatus {
    const currentLine = this.mLineStack[this.mLineStack.length - 1] as PnsLine;
    let nearest: Obstacle | null = null;
    let st: PnsShoveStatus = PnsShoveStatus.SH_NULL;

    for (const searchOrder of [PnsKind.SOLID_T, PnsKind.VIA_T, PnsKind.SEGMENT_T, PnsKind.HOLE_T]) {
      const opts: CollisionSearchOptions = {
        kindMask: searchOrder,
        filter: (item: PnsItem): boolean => {
          let rv = true;

          if (
            item.ofKind(
              PnsKind.SEGMENT_T | PnsKind.ARC_T | PnsKind.VIA_T | PnsKind.SOLID_T | PnsKind.HOLE_T,
            )
          ) {
            // Upstream casts SOLID_T and HOLE_T to LINKED_ITEM* here, which they
            // are not, purely to read Uid(). An item with no uid simply has no
            // entry.
            const ent = this.findRootLineForItem(item as PnsLinkedItem);

            if (!ent && this.mDefaultPolicy & PnsShovePolicy.SHP_IGNORE) rv = false;

            if (ent && ent.policy & PnsShovePolicy.SHP_IGNORE) rv = false;
          } else {
            if (this.mDefaultPolicy & PnsShovePolicy.SHP_IGNORE) rv = false;
          }

          return rv;
        },
      };

      nearest = this.mCurrentNode.nearestObstacle(currentLine, opts);

      if (nearest) break;
    }

    if (!nearest) {
      // Bare pop: the line stays queued for the optimiser.
      this.mLineStack.pop();

      return PnsShoveStatus.SH_OK;
    }

    this.fixupViaCollisions(currentLine, nearest);

    const ni = nearest.item;

    if (!ni) return PnsShoveStatus.SH_INCOMPLETE;

    this.unwindLineStack(ni);

    if (!ni.ofKind(PnsKind.SOLID_T) && ni.rank() >= 0 && ni.rank() > currentLine.rank()) {
      // Collision with a higher-ranking object, i.e. one we have already shoved.
      switch (ni.kind()) {
        case PnsKind.VIA_T: {
          this.patchTadpoleVia(ni, currentLine);

          if (
            currentLine.endsWithVia() &&
            ni.collide(currentLine.via(), this.mCurrentNode, ni.layer())
          ) {
            st = this.onCollidingVia(currentLine, ni as PnsVia, nearest, ni.rank() + 1);
          } else {
            st = this.onReverseCollidingVia(currentLine, ni as PnsVia, nearest);
          }

          break;
        }

        case PnsKind.SEGMENT_T: {
          const revLine = this.assembleLine(ni as PnsSegment);

          this.popLineStack();
          this.unwindLineStack(revLine);
          this.patchTadpoleVia(ni, currentLine);

          if (
            currentLine.endsWithVia() &&
            currentLine.via().collide(ni, this.mCurrentNode, currentLine.layer())
          ) {
            const vh: ViaHandle = {
              pos: currentLine.via().pos(),
              layers: currentLine.via().layers(),
              net: currentLine.via().net(),
              valid: true,
            };

            const rvia = this.mCurrentNode.findViaByHandle(vh);

            if (!rvia) st = PnsShoveStatus.SH_INCOMPLETE;
            else st = this.onCollidingVia(revLine, rvia, nearest, revLine.rank() + 1);
          } else {
            st = this.onCollidingLine(revLine, currentLine, revLine.rank() + 1);
          }

          if (!this.pushLineStack(revLine)) return PnsShoveStatus.SH_INCOMPLETE;

          break;
        }

        case PnsKind.ARC_T: {
          const revLine = this.assembleLine(ni as PnsArc);

          this.popLineStack();
          // `- 1` here where the segment arm above uses `+ 1`. Upstream's.
          st = this.onCollidingLine(revLine, currentLine, revLine.rank() - 1);

          if (!this.pushLineStack(revLine)) return PnsShoveStatus.SH_INCOMPLETE;

          break;
        }

        default:
          // Upstream asserts. In a release build it falls out with SH_NULL.
          break;
      }
    } else {
      // Collision with a lower-ranking object, or a solid.
      switch (ni.kind()) {
        case PnsKind.SEGMENT_T:
          st = this.onCollidingSegment(currentLine, ni as PnsSegment);

          if (st === PnsShoveStatus.SH_TRY_WALK)
            st = this.onCollidingSolid(currentLine, ni, nearest);

          break;

        case PnsKind.ARC_T:
          st = this.onCollidingArc(currentLine, ni as PnsArc);

          if (st === PnsShoveStatus.SH_TRY_WALK)
            st = this.onCollidingSolid(currentLine, ni, nearest);

          break;

        case PnsKind.VIA_T:
          st = this.onCollidingVia(currentLine, ni as PnsVia, nearest, currentLine.rank() - 1);

          if (st === PnsShoveStatus.SH_TRY_WALK)
            st = this.onCollidingSolid(currentLine, ni, nearest);

          break;

        case PnsKind.HOLE_T:
        case PnsKind.SOLID_T:
          // Already the fallback, so no SH_TRY_WALK arm here.
          st = this.onCollidingSolid(currentLine, ni, nearest);

          break;

        default:
          break;
      }
    }

    return st;
  }

  /**
   * `SHOVE::shoveMainLoop`: iterate until the stack empties or we give up.
   *
   * Three details:
   *
   * - **`m_affectedArea` is cleared here, per main loop, not per `run()`** — so
   *   with several heads each head wipes the area the previous one accumulated
   *   and the spring-back frame ends up covering only the last. Upstream's
   *   (`pns_shove.cpp:1884`), flagged in the spec (§9.10).
   * - `mIter` is incremented **before** the limit test and the test is `>=`, so
   *   exactly `iterLimit` iterations run.
   * - **Hitting the limit is `SH_INCOMPLETE` regardless of the last iteration's
   *   status.** An expired timer likewise overwrites a good status — the
   *   assignment is inside the same branch as both tests.
   *
   * `m_draggedVia` is never assigned anywhere in this revision, so the proxy
   * push at the top is dead. Ported for fidelity.
   */
  private shoveMainLoop(): PnsShoveStatus {
    let st: PnsShoveStatus = PnsShoveStatus.SH_OK;

    this.mAffectedArea = null;

    const iterLimit = this.mSettings.shoveIterationLimit;
    const deadline = Date.now() + this.mSettings.shoveTimeLimit;

    this.mIter = 0;

    if (this.mLineStack.length === 0 && this.mDraggedVia) {
      const proxy = new PnsLine();
      proxy.linkVia(this.mDraggedVia);
      this.pushLineStack(proxy);
    }

    while (this.mLineStack.length > 0) {
      st = this.shoveIteration(this.mIter);

      this.mIter++;

      if (st === PnsShoveStatus.SH_INCOMPLETE || Date.now() > deadline || this.mIter >= iterLimit) {
        st = PnsShoveStatus.SH_INCOMPLETE;
        break;
      }
    }

    return st;
  }

  /**
   * `SHOVE::preShoveCleanup`: `Simplify2` the line and, if that changed the
   * vertex count, install the simplified version in the node.
   *
   * Note the `replaceLine` here takes **default arguments** — so the change
   * counts towards the affected area *and* redundant segments are allowed. Every
   * other `replaceLine` in the shove path passes `false` for the latter.
   */
  private preShoveCleanup(aOld: PnsLine, aNew: PnsLine): boolean {
    const orig = aOld.cLine().clone();

    const vcPrev = orig.pointCount();
    orig.simplify2();
    const vcPost = orig.pointCount();

    copyLineInto(aOld, aNew);

    if (vcPrev !== vcPost) {
      aNew.clearLinks();
      aNew.setShape(orig);
      this.replaceLine(aOld, aNew);

      return true;
    }

    return false;
  }

  /**
   * `SHOVE::runOptimizer( NODE* )`.
   *
   * The `std::reverse` at the top of **every** pass is deliberate: optimising
   * A-then-B does not give the same answer as B-then-A, so two passes visit the
   * queue in opposite directions (and leave it in its original order). With a
   * single pass the queue ends up reversed.
   *
   * Heads and `SHP_DONT_OPTIMIZE` lines are skipped — a head belongs to the user,
   * not to the optimiser.
   *
   * ### Upstream bug reproduced: the four-argument `replaceLine`
   *
   * `pns_shove.cpp:2122` is `replaceLine( lineToOpt, optimized, false, aNode )`,
   * which binds `aNode` — a pointer — to the **`aAllowRedundantSegments` bool**,
   * leaving the real `aNode` parameter at its `nullptr` default. So the
   * optimiser's replacements go to `m_currentNode` and redundant segments are
   * allowed whenever `aNode` is non-null. It is harmless today only because the
   * one caller passes `m_currentNode` anyway. The call here reproduces the
   * *effective* arguments — `aAllowRedundantSegments = true`, `aNode = null` —
   * rather than the intended ones.
   *
   * ### What is not ported
   *
   * `PNS::OPTIMIZER` (the class) does not exist in this tree; `pns_optimizer.ts`
   * offers the merge passes as free functions over a point array. So
   * `MERGE_SEGMENTS` and `MERGE_OBTUSE` are driven directly, and
   * `RESTRICT_AREA`, `SMART_PADS` and `LIMIT_CORNER_COUNT` are composed into
   * {@link mOptFlagDisableMask}-able flags but have no implementation to reach.
   * The restrict-area rectangle is still computed, because
   * {@link totalAffectedArea} is observable through the spring-back stack.
   */
  private runOptimizer(aNode: PnsNode): void {
    let optFlags = 0;
    let nPasses = 0;

    const effort = this.mSettings.optimizerEffort;

    let area = this.totalAffectedArea();

    let maxWidth = 0;

    for (const line of this.mOptimizerQueue) maxWidth = Math.max(line.width(), maxWidth);

    if (area) area = inflateBox(area, maxWidth);

    switch (effort) {
      case PnsOptimizationEffort.OE_LOW:
        optFlags |= PnsOptimizerFlags.MERGE_OBTUSE;
        nPasses = 1;
        break;

      case PnsOptimizationEffort.OE_MEDIUM:
        optFlags |= PnsOptimizerFlags.MERGE_SEGMENTS;
        nPasses = 2;
        break;

      case PnsOptimizationEffort.OE_FULL:
        // Upstream assigns rather than OR-ing here. Identical in effect.
        optFlags = PnsOptimizerFlags.MERGE_SEGMENTS;
        nPasses = 2;
        break;

      default:
        break;
    }

    optFlags |= PnsOptimizerFlags.LIMIT_CORNER_COUNT;

    if (area) optFlags |= PnsOptimizerFlags.RESTRICT_AREA;

    if (this.mSettings.smartPads && this.mSettings.cornerMode45)
      optFlags |= PnsOptimizerFlags.SMART_PADS;

    const effortLevel = optFlags & ~this.mOptFlagDisableMask;

    for (let pass = 0; pass < nPasses; pass++) {
      this.mOptimizerQueue.reverse();

      for (let i = 0; i < this.mOptimizerQueue.length; i++) {
        const lineToOpt = this.mOptimizerQueue[i] as PnsLine;
        const rootEntry = this.findRootLine(lineToOpt);

        if (rootEntry) {
          if (rootEntry.policy & PnsShovePolicy.SHP_DONT_OPTIMIZE) continue;
          if (rootEntry.isHead) continue;
        }

        const optimized = this.optimizeLine(lineToOpt, effortLevel, aNode);

        if (optimized) {
          // See the docblock: these are upstream's *effective* arguments.
          this.replaceLine(lineToOpt, optimized, false, true, null);
          this.mOptimizerQueue[i] = optimized;
        }
      }
    }
  }

  /**
   * `OPTIMIZER::Optimize( LINE*, LINE*, LINE* aRoot )`, to the extent the free
   * functions in `pns_optimizer.ts` can express it. Null means "no improvement",
   * which is upstream's `false` return.
   */
  private optimizeLine(aLine: PnsLine, aEffortLevel: number, aNode: PnsNode): PnsLine | null {
    const chain = aLine.cLine().points();

    if (chain.length < 3) return null;

    const collides = (path: Vec2[]): boolean => {
      const probe = PnsLine.fromBase(aLine, PnsLineChain.fromPoints(path));
      probe.clearLinks();

      return aNode.checkColliding(probe) !== null;
    };

    let out: Vec2[] = chain;

    if (aEffortLevel & PnsOptimizerFlags.MERGE_SEGMENTS) out = mergeFull(out, collides);
    else if (aEffortLevel & PnsOptimizerFlags.MERGE_OBTUSE) out = mergeObtuse(out, collides);
    else return null;

    if (out.length === chain.length) return null;

    const optimized = PnsLine.fromBase(aLine, PnsLineChain.fromPoints(out));
    optimized.clearLinks();

    if (aLine.endsWithVia()) optimized.appendVia(aLine.via());

    return optimized;
  }

  // ----- heads, reconstruction and the entry point ------------------------------------

  /**
   * `SHOVE::removeHeads()`: drop the head geometry from the branch again.
   *
   * The head is the *router's* to draw, not the node's to keep — the node only
   * ever held it so that the shove cascade had something to push with. It runs
   * after {@link reconstructHeads} has copied the resulting geometry out.
   *
   * Iterating a snapshot while mutating the node is safe because
   * `getUpdatedItems` returns copies.
   */
  private removeHeads(): void {
    const { added } = this.mCurrentNode.getUpdatedItems();

    for (const item of added) {
      const rootEntry = this.findRootLineForItem(item as PnsLinkedItem);

      if (rootEntry?.isHead) this.mCurrentNode.removeItem(item);
    }
  }

  /**
   * `SHOVE::reconstructHeads( bool aShoveFailed )`. The parameter is never read
   * upstream — the only live call passes `false` and the failure call is
   * commented out — so it is not ported.
   *
   * For a line head, `geometryModified` is the **negation** of
   * `CompareGeometry`: modified iff the new geometry does *not* compare equal to
   * the root. And because `CompareGeometry` simplifies first, a head that was
   * merely re-vertexed reports unmodified, which is the whole point.
   *
   * When `newLine` is unset nothing at all is written — `newHead` stays empty and
   * `geometryModified` keeps whatever {@link reduceSpringback} may have set.
   */
  private reconstructHeads(): void {
    for (const headEntry of this.mHeadLines) {
      if (headEntry.origHead) {
        const rootEntry = this.findRootLine(headEntry.origHead);

        // Upstream asserts both of these.
        if (rootEntry?.newLine && rootEntry.rootLine) {
          headEntry.newHead = rootEntry.newLine;
          headEntry.geometryModified = !rootEntry.newLine
            .cLine()
            .compareGeometry(rootEntry.rootLine.cLine());
        }
      } else {
        // Upstream does not null-check this one.
        const rootEntry = this.findRootLineForItem(headEntry.draggedVia);

        if (rootEntry?.newVia) {
          headEntry.geometryModified = true;
          headEntry.theVia = {
            pos: rootEntry.newVia.pos(),
            layers: rootEntry.newVia.layers(),
            net: rootEntry.newVia.net(),
            valid: true,
          };
        } else if (rootEntry?.oldVia) {
          // Note: geometryModified is deliberately NOT set on this branch.
          headEntry.theVia = {
            pos: rootEntry.oldVia.pos(),
            layers: rootEntry.oldVia.layers(),
            net: rootEntry.oldVia.net(),
            valid: true,
          };
        }
      }

      this.mHeadsModified = this.mHeadsModified || headEntry.geometryModified;
    }
  }

  /**
   * `SHOVE::Run()` — the entry point.
   *
   * The shape is: build the head set, drop the spring-back frames that no longer
   * matter, **branch**, then for each head add it to the branch and run the
   * cascade. On success optimise, read the results back out, remove the head
   * geometry and push a new spring-back frame. On failure throw the branch away
   * and go back to the parent.
   *
   * Order matters twice on the success path and upstream says so at
   * `pns_shove.cpp:2568`: {@link pushSpringback} must come **after**
   * {@link reconstructHeads} because it snapshots via handles that
   * `reconstructHeads` writes, and {@link removeHeads} must come after
   * `reconstructHeads` because it deletes the geometry `reconstructHeads` reads.
   *
   * On the failure path the line stack and optimiser queue are cleared **before**
   * the branch is released. Upstream's comment (`:2593-2594`) is about a
   * use-after-free; there is no dangling pointer here, but the clear is still
   * required — leaving stale lines in the queue would let the next run optimise
   * geometry that no longer exists.
   *
   * `m_currentNode->ClearRanks()` runs once after the branch **and again at the
   * top of every head's iteration**, so each head starts from an unranked world
   * and discards the ranks the previous head established.
   */
  run(): PnsShoveStatus {
    let st: PnsShoveStatus = PnsShoveStatus.SH_OK;

    // Upstream sets `m_multiLineMode = false` here. The field is never set true
    // anywhere in this revision and both readers are inside `#if 0` blocks, so
    // the assignment has no observable effect and the field is not ported.
    // Likewise absent, for the same reason: `SPRINGBACK_TAG::m_length` and
    // `::m_p`, never written at all, and `m_restrictSpringbackTagId`, assigned
    // 0 in the constructor and never touched again.
    this.mHeadsModified = false;
    this.mLineStack = [];
    this.mOptimizerQueue = [];

    const headSet = new PnsItemSet();

    for (const l of this.mHeadLines) {
      if (l.theVia) {
        const realVia = this.mCurrentNode.findViaByHandle(l.theVia);

        // Upstream asserts non-null here and would then dereference it, so a
        // release build crashes. The head is skipped instead, which routes the
        // run into the defined failure the per-head loop already has for
        // exactly this case (`pns_shove.cpp:2446-2450`) — so the via handles
        // are restored rather than the run aborting halfway.
        if (realVia) headSet.add(realVia.clone());
      } else if (l.origHead) {
        headSet.add(l.origHead.clone());
      }
    }

    // Pop the NODEs holding previous shoves that are no longer necessary.
    const parent = this.reduceSpringback(headSet);

    this.mCurrentNode = parent.branch();
    this.mCurrentNode.clearRanks();

    for (const headLineEntry of this.mHeadLines) {
      this.mCurrentNode.clearRanks();

      if (headLineEntry.theVia) {
        const viaToDrag = this.mCurrentNode.findViaByHandle(headLineEntry.theVia);

        if (!viaToDrag) {
          st = PnsShoveStatus.SH_INCOMPLETE;
          break;
        }

        const viaRoot = this.touchRootLineForItem(viaToDrag);
        viaRoot.oldVia = viaToDrag;
        headLineEntry.draggedVia = viaToDrag;

        st = this.pushOrShoveVia(
          viaToDrag,
          {
            x: headLineEntry.viaNewPos.x - viaToDrag.pos().x,
            y: headLineEntry.viaNewPos.y - viaToDrag.pos().y,
          },
          0,
          true,
        );

        if (st !== PnsShoveStatus.SH_OK) break;
      } else {
        const origHead = headLineEntry.origHead as PnsLine;

        // Upstream asserts origHead->LinkCount() == 0 — addHeads cleared them.
        this.mCurrentNode.addLine(origHead, true);

        const head = origHead.clone();

        // Empty head? Nothing to shove.
        if (!head.segmentCount() && !head.endsWithVia()) {
          st = PnsShoveStatus.SH_INCOMPLETE;
          break;
        }

        if (!(headLineEntry.policy & PnsShovePolicy.SHP_DONT_LOCK_ENDPOINTS)) {
          if (head.pointCount() > 0) this.mCurrentNode.lockJoint(head.cPoint(0), head, true);

          // A via already pins that end, so it is not locked again.
          if (!head.endsWithVia()) this.mCurrentNode.lockJoint(head.cLastPoint(), head, true);
        }

        this.setShovePolicyForLine(head, headLineEntry.policy);

        // Heads rank enormously high, so everything else is "lower-ranking".
        head.setRank(100000);

        if (head.endsWithVia()) {
          const headVia = head.via().clone();
          headVia.setRank(100000);
          origHead.linkVia(headVia);
          head.linkVia(headVia);
          this.mCurrentNode.addVia(headVia);
        }

        const headRoot = this.touchRootLine(origHead);
        headRoot.isHead = true;
        headRoot.rootLine = origHead.clone();
        headRoot.policy = headLineEntry.policy;

        if (head.endsWithVia()) this.mRootLineHistory.set(origHead.via().uid(), headRoot);

        if (!this.pushLineStack(head)) {
          st = PnsShoveStatus.SH_INCOMPLETE;
          break;
        }
      }

      st = this.shoveMainLoop();

      if (st !== PnsShoveStatus.SH_OK) break;
    }

    if (st === PnsShoveStatus.SH_OK) {
      this.runOptimizer(this.mCurrentNode);

      this.reconstructHeads();
      this.removeHeads();

      // Must follow reconstructHeads — it needs up-to-date via handles.
      this.pushSpringback(this.mCurrentNode, this.mAffectedArea);
    } else {
      for (const headEntry of this.mHeadLines) {
        if (headEntry.prevVia) {
          headEntry.theVia = headEntry.prevVia;
          headEntry.geometryModified = true;
          this.mHeadsModified = true;
        }
      }

      // Clear these before releasing the branch — see the docblock.
      this.mLineStack = [];
      this.mOptimizerQueue = [];

      this.pruneRootLines(this.mCurrentNode);

      this.releaseNode(this.mCurrentNode);
      this.mCurrentNode = parent;
    }

    return st;
  }

  // ----- collaborators that are not ported yet -----------------------------------------

  /**
   * `TOPOLOGY::AssembleCluster( ITEM*, int aLayer, double aAreaExpansionLimit )`
   * (`pns_topology.cpp`), inlined here because `PnsTopology` carries only
   * `assembleTrivialPath` so far.
   *
   * A cluster is the blob of items *touching* the start item — the query uses
   * `overrideClearance = 0` and `differentNetsOnly = false`, so it finds actual
   * contact, not clearance violations. Track-on-track between different nets is
   * excluded (two crossing tracks are not one obstacle), and the walk stops
   * growing once the bounding box has expanded past `aAreaExpansionLimit` times
   * its original area — a pad in a dense fanout would otherwise drag in half the
   * board.
   */
  private assembleCluster(
    aStart: PnsItem,
    aLayer: number,
    aAreaExpansionLimit: number,
  ): PnsCluster {
    const cluster: PnsCluster = { items: [] };
    const pending: PnsItem[] = [aStart];
    const processed = new Set<PnsItem>();

    const startShape = aStart.shape(aLayer);
    let clusterBBox = startShape ? shapeBBox(startShape) : null;
    const initialArea = clusterBBox ? boxArea(clusterBBox) : 0;

    while (pending.length > 0) {
      const top = pending.shift() as PnsItem;

      if (!processed.has(top)) cluster.items.push(top);

      processed.add(top);

      // Only *touching* objects: clearance 0 and same-net allowed.
      const obstacles = new ObstacleSet();

      this.mCurrentNode.queryColliding(top, obstacles, {
        differentNetsOnly: false,
        overrideClearance: 0,
      });

      for (const obs of obstacles) {
        if (!obs.item) continue;

        const trackOnTrack =
          obs.item.net() !== top.net() &&
          obs.item.ofKind(PnsKind.SEGMENT_T) &&
          top.ofKind(PnsKind.SEGMENT_T);

        if (trackOnTrack) continue;

        if (
          obs.item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T) &&
          obs.item.layers().overlaps(aLayer)
        ) {
          const line = this.mCurrentNode.assembleLine(obs.item as PnsLinkedItem);
          const b = line.cLine().bbox();

          clusterBBox = mergeBox(clusterBBox, {
            minX: b.x,
            minY: b.y,
            maxX: b.x + b.w,
            maxY: b.y + b.h,
          });
        } else {
          const s = obs.item.shape(aLayer);

          if (s) clusterBBox = mergeBox(clusterBBox, shapeBBox(s));
        }

        const currentArea = clusterBBox ? boxArea(clusterBBox) : 0;
        const areaRatio = currentArea / (initialArea + 1);

        if (aAreaExpansionLimit > 0.0 && areaRatio > aAreaExpansionLimit) break;

        if (
          !processed.has(obs.item) &&
          obs.item.layers().overlaps(aLayer) &&
          !(obs.item.marker() & LineMarker.MK_HEAD)
        )
          pending.push(obs.item);
      }
    }

    return cluster;
  }

  /**
   * `WALKAROUND::Route( aInitialPath )` under `SetAllowedPolicies({WP_SHORTEST})`,
   * `SetSolidsOnly(false)` and `RestrictToCluster(true, cluster)`.
   *
   * The `WALKAROUND` class is not ported; `pns_walkaround.ts` has the shortest-of-
   * both-directions search as a free function over a point array. Restricting to
   * the cluster becomes "build hulls only for the cluster's items", which is what
   * the restriction does. Null is returned for anything but `ST_DONE`, since that
   * is the only status upstream accepts here.
   */
  private routeAroundCluster(aCurrent: PnsLine, aCluster: PnsCluster): PnsLine | null {
    if (aCurrent.segmentCount() < 1) return null;

    const hulls: Vec2[][] = [];

    for (const item of aCluster.items) {
      const clearance = this.getClearance(item, aCurrent);

      hulls.push(itemHull(item, clearance, aCurrent.width(), aCurrent.layer()));
    }

    if (hulls.length === 0) return null;

    const result = routeShortest(aCurrent.cLine().points(), hulls, {
      iterationLimit: this.mSettings.walkaroundIterationLimit,
    });

    if (result.status !== 'done') return null;

    const out = aCurrent.clone();
    out.setShape(PnsLineChain.fromPoints(result.path));

    return out;
  }
}

/**
 * `SHAPE_ARC::DefaultAccuracyForPCB()` — 5 µm in KiCad's internal units.
 * `ShoveObstacleLine` adds it to the clearance for every arc segment.
 */
const DEFAULT_ARC_ACCURACY_FOR_PCB = 5000;

/** `*aNew = *aOld` on a LINE: everything, links included. */
function copyLineInto(aOld: PnsLine, aNew: PnsLine): void {
  aNew.setShape(aOld.cLine().clone());
  aNew.setWidth(aOld.width());
  aNew.setNet(aOld.net());
  aNew.setLayers(aOld.layers());
  aNew.setRank(aOld.rank());
  aNew.clearLinks();

  for (const l of aOld.links()) aNew.link(l);

  if (aOld.endsWithVia()) aNew.appendVia(aOld.via());
}

/**
 * `SHAPE::Collide( other, clearance, VECTOR2I* aMTV )` for a via against a line,
 * reduced to what `onCollidingVia` needs: does the via's disc come within
 * `clearance` of the polyline, and by how much must it move to stop.
 *
 * The MTV is along the line from the nearest point on the polyline to the via
 * centre, which is the direction upstream's circle-vs-chain collision produces.
 */
function collideViaWithLine(
  aVia: PnsVia,
  aLine: PnsLine,
  aClearance: number,
  aLayer: number,
): { collides: boolean; mtv: Vec2 } {
  const c = aVia.pos();
  const r = idiv(aVia.diameter(aLayer), 2);
  const chain = aLine.cLine();

  if (chain.pointCount() === 0) return { collides: false, mtv: { x: 0, y: 0 } };

  const nearest = chain.nearestPoint(c);
  const d = { x: c.x - nearest.x, y: c.y - nearest.y };
  const dist = Math.sqrt(d.x * d.x + d.y * d.y);
  const want = r + aClearance;

  if (dist >= want) return { collides: false, mtv: { x: 0, y: 0 } };

  const push = want - dist;

  if (dist === 0) {
    // Degenerate: the centre is exactly on the line. Any direction is as good
    // as another; upstream's SEG-based code picks the segment normal.
    return { collides: true, mtv: { x: push, y: 0 } };
  }

  return {
    collides: true,
    mtv: { x: Math.round((-d.x * push) / dist), y: Math.round((-d.y * push) / dist) },
  };
}

/** The same, via against via. */
function collideViaWithVia(
  aA: PnsVia,
  aB: PnsVia,
  aClearance: number,
  aLayer: number,
): { collides: boolean; mtv: Vec2 } {
  const d = { x: aB.pos().x - aA.pos().x, y: aB.pos().y - aA.pos().y };
  const dist = Math.sqrt(d.x * d.x + d.y * d.y);
  const want = idiv(aA.diameter(aLayer), 2) + idiv(aB.diameter(aLayer), 2) + aClearance;

  if (dist >= want) return { collides: false, mtv: { x: 0, y: 0 } };

  const push = want - dist;

  if (dist === 0) return { collides: true, mtv: { x: push, y: 0 } };

  return {
    collides: true,
    mtv: { x: Math.round((d.x * push) / dist), y: Math.round((d.y * push) / dist) },
  };
}

/** `SHAPE::BBox()` for the shape kinds a cluster walk can meet. */
function shapeBBox(aShape: { kind: string } & Record<string, unknown>): PnsBox {
  switch (aShape.kind) {
    case 'circle': {
      const c = aShape.c as Vec2;
      const r = aShape.r as number;

      return { minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r };
    }

    case 'segment': {
      const s = aShape.seg as { a: Vec2; b: Vec2 };
      const w = idiv((aShape.width as number) ?? 0, 2);

      return {
        minX: Math.min(s.a.x, s.b.x) - w,
        minY: Math.min(s.a.y, s.b.y) - w,
        maxX: Math.max(s.a.x, s.b.x) + w,
        maxY: Math.max(s.a.y, s.b.y) + w,
      };
    }

    case 'rect': {
      const p0 = aShape.p0 as Vec2;
      const size = aShape.size as Vec2;

      return { minX: p0.x, minY: p0.y, maxX: p0.x + size.x, maxY: p0.y + size.y };
    }

    default: {
      const pts = (aShape.points ?? aShape.pts) as Vec2[] | undefined;

      return boxOfPoints(pts ?? []) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
  }
}

const boxArea = (b: PnsBox): number => (b.maxX - b.minX) * (b.maxY - b.minY);

/** `SHAPE_LINE_CHAIN::NearestPoint` over a closed hull expressed as points. */
function nearestPointOnChain(aChain: readonly Vec2[], aP: Vec2): Vec2 {
  let best: Vec2 = aChain[0] ?? { x: 0, y: 0 };
  let bestD = Number.POSITIVE_INFINITY;

  for (let i = 0; i < aChain.length; i++) {
    const a = aChain[i] as Vec2;
    const b = aChain[(i + 1) % aChain.length] as Vec2;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;

    let q: Vec2;

    if (len2 === 0) {
      q = { x: a.x, y: a.y };
    } else {
      let t = ((aP.x - a.x) * dx + (aP.y - a.y) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      q = { x: Math.round(a.x + dx * t), y: Math.round(a.y + dy * t) };
    }

    const d = (aP.x - q.x) * (aP.x - q.x) + (aP.y - q.y) * (aP.y - q.y);

    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }

  return best;
}

export type { PnsCluster };
