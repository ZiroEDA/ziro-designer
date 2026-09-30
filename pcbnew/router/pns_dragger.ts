// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::DRAGGER`, the single-item drag. Counterpart:
 * `pcbnew/router/pns_dragger.{h,cpp}`.
 *
 * ## The node bookkeeping, which is the whole design
 *
 * `Start` branches the world **once** into `m_preDragNode`. Every subsequent
 * `Drag(p)` throws away last move's `m_lastNode` and builds a fresh one — from
 * `m_preDragNode` in mark-obstacles and walkaround modes, and from the shove's
 * own current node in shove mode. So the dragger never accumulates state across
 * mouse moves; each move is computed from the pre-drag world. That is what lets
 * a drag be abandoned by simply dropping the branch.
 *
 * The one exception is the failure path in {@link PnsDragger.drag}: when a move
 * fails and it is *not* the first, `m_lastNode` is rebuilt from its own parent
 * and the previous solution (`m_lastDragSolution`) is re-added — the cursor
 * runs ahead of the route rather than the route snapping back.
 *
 * ## Two latches
 *
 * `m_freeAngleMode` is read out of `m_mode`'s `DM_FREE_ANGLE` bit at the top of
 * `Start`, before the start-drag helpers overwrite `m_mode` with a single mode
 * bit. `m_forceMarkObstaclesMode` latches true the first time a drag fails and
 * is never cleared; from then on the dragger only highlights obstacles, and
 * `FixRoute` will only commit with `aForceCommit`.
 *
 * ## Collaborator gaps
 *
 * - `LINE::DragArc` is injected (`PnsRouterHost.dragArc`) and has no default
 *   implementation; every `DM_ARC` control-flow path here is ported.
 * - `WALKAROUND` (the class) is bridged to `routeShortest` over the hulls of
 *   the obstacles the node reports, as `PnsShove.routeAroundCluster` is.
 * - `OPTIMIZER` (the class) is bridged to `mergeFull`/`mergeColinear`;
 *   `KEEP_TOPOLOGY`, `RESTRICT_AREA` and `SetPreserveVertex` are composed into
 *   the effort mask and have nothing behind them, the same gap shove shipped.
 * - `VIA::PushoutForce` lives on the via, in `pns_via.ts`, as upstream keeps it.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { ObstacleSet } from './pns_node.js';
import { type NetHandle } from './pns_item.js';
import type { PnsArc } from './pns_arc.js';
import {
  PNS_IU_PER_MM,
  PNS_MAX_TANGENT_ANGLE_DEVIATION_DEG,
  PNS_MAX_TRACK_LENGTH_TO_KEEP_MM,
  PnsDragAlgo,
  PnsDragMode,
  toShoveSettings,
} from './pns_drag_algo.js';
import { LineMarker, PnsKind, type PnsItem, type PnsLinkedItem } from './pns_item.js';
import { itemHull } from './pns_utils.js';
import { PnsItemSet } from './pns_itemset.js';
import { PnsLine, PnsLineChain } from './pns_line.js';
import { chainSplit, lineDragCorner, lineDragSegment } from './pns_line.js';
import { mergeColinear, mergeFull } from './pns_optimizer.js';
import type { PnsNode } from './pns_node.js';
import { PnsMode } from './pns_routing_settings.js';
import { PnsMouseTrailTracer } from './pns_mouse_trail_tracer.js';
import { PnsSegment } from './pns_segment.js';
import {
  PnsShove,
  PnsShovePolicy,
  PnsShoveStatus,
  PnsOptimizerFlags,
  lineChangedArea,
} from './pns_shove.js';
import type { PnsVia, ViaHandle } from './pns_via.js';
import { viaPushoutForce } from './pns_via.js';
import { PnsLayerRange } from './pns_layerset.js';
import { routeShortest } from './pns_walkaround.js';
import { arcShape } from '../drc/drc_engine_view.js';
import { withTrackEnds } from '../edit-board.js';
import type { Board, PcbTrack } from '../types.js';
import { dragCorner, dragSegment45, segmentCount } from './pns_line.js';
import type { Chain } from './pns_line.js';

/** `VIA_HANDLE{}`, whose only initialised member is `valid = false`. */
function invalidViaHandle(): ViaHandle {
  return { valid: false, pos: { x: 0, y: 0 }, layers: new PnsLayerRange(-1), net: null };
}

/**
 * `VIA::PushoutForce` in both its overloads lives on the via, in
 * `pns_via.ts` — which is where upstream keeps it (`pns_via.cpp:126` and
 * `:143`). `DRAGGER` and `LINE_PLACER` both call it there rather than each
 * carrying a copy; they used to carry one each, and the two disagreed.
 */
export { viaPushoutForce, viaPushoutForceAgainstItem } from './pns_via.js';

/** `PNS::DRAGGER`. */
export class PnsDragger extends PnsDragAlgo {
  private mInitialVia: ViaHandle = invalidViaHandle();
  private mDraggedVia: ViaHandle = invalidViaHandle();

  private mLastNode: PnsNode | null = null;
  private mPreDragNode: PnsNode | null = null;

  /**
   * `int m_mode`, not `DRAG_MODE` — it carries `DM_FREE_ANGLE` alongside a mode
   * bit between `SetMode` and `Start`. See {@link PnsDragMode}.
   */
  private mMode: number = PnsDragMode.DM_SEGMENT;

  private mDraggedLine = new PnsLine();
  private mLastDragSolution = new PnsLine();
  private mShove: PnsShove | null = null;
  private mDraggedSegmentIndex = 0;
  private mDragStatus = false;
  private mCurrentMode: PnsMode = PnsMode.RM_MarkObstacles;
  private mLastValidPoint: Vec2 = { x: 0, y: 0 };

  /** `m_draggedItems`: what `Traces()` hands back for previewing. */
  private mDraggedItems = new PnsItemSet();

  private mFreeAngleMode = false;
  private mForceMarkObstaclesMode = false;
  private mMouseTrailTracer = new PnsMouseTrailTracer();

  // `ITEM_SET m_origViaConnections` is declared in pns_dragger.h and never read
  // or written anywhere in pns_dragger.cpp. Not ported.
  //
  // `DRAGGER( ROUTER* )` only forwards to `DRAG_ALGO`'s constructor after the
  // member initialisation above, all of which is field initialisers here, so
  // there is no constructor left to write.

  // ----- accessors -------------------------------------------------------------

  /** `GetOriginalLine()`. */
  getOriginalLine(): PnsLine {
    return this.mDraggedLine;
  }

  /** `GetLastDragSolution()`. */
  getLastDragSolution(): PnsLine {
    return this.mLastDragSolution;
  }

  override currentLayer(): number {
    return this.mDraggedLine.layer();
  }

  override currentNode(): PnsNode | null {
    return this.mLastNode ? this.mLastNode : this.mWorld;
  }

  override traces(): PnsItemSet {
    return this.mDraggedItems;
  }

  override setMode(aMode: PnsDragMode): void {
    this.mMode = aMode as number;
  }

  override mode(): PnsDragMode {
    return this.mMode as PnsDragMode;
  }

  override getForceMarkObstaclesMode(aDragStatus: { value: boolean }): boolean {
    aDragStatus.value = this.mDragStatus;

    return this.mForceMarkObstaclesMode;
  }

  /** `CurrentNets()`: one entry, either the dragged via's net or the line's. */
  override currentNets(): NetHandle[] {
    if (this.mMode === PnsDragMode.DM_VIA) return [this.mDraggedVia.net];

    return [this.mDraggedLine.net()];
  }

  /** The shove instance, for tests; upstream's is private. */
  shove(): PnsShove | null {
    return this.mShove;
  }

  /** The pre-drag branch, for tests. */
  preDragNode(): PnsNode | null {
    return this.mPreDragNode;
  }

  /** `m_draggedSegmentIndex`, for tests. */
  draggedSegmentIndex(): number {
    return this.mDraggedSegmentIndex;
  }

  /** `m_draggedVia`, for tests. */
  draggedVia(): ViaHandle {
    return this.mDraggedVia;
  }

  // ----- start -----------------------------------------------------------------

  /**
   * `DRAGGER::checkVirtualVia` (`:81-115`).
   *
   * Grabbing a segment within half a width of a joint that carries a *virtual*
   * via drags the via instead of the segment, so the two segments meeting there
   * stay attached.
   *
   * Two upstream details: endpoint **A is tested first** and both tests are
   * `<=`, so on a segment shorter than its own width A wins even when the
   * cursor is nearer B; and a missing joint answers null rather than falling
   * through to B.
   */
  private checkVirtualVia(aP: Vec2, aSeg: PnsSegment): PnsVia | null {
    const w2 = Math.trunc(aSeg.width() / 2);
    const s = aSeg.seg();

    const distA = Math.hypot(aP.x - s.a.x, aP.y - s.a.y);
    const distB = Math.hypot(aP.x - s.b.x, aP.y - s.b.y);

    let psnap: Vec2;

    if (distA <= w2) psnap = s.a;
    else if (distB <= w2) psnap = s.b;
    else return null;

    const jt = (this.mWorld as PnsNode).findJointForItem(psnap, aSeg);

    if (!jt) return null;

    for (const item of jt.linkList()) {
      if (item.isVirtual() && item.ofKind(PnsKind.VIA_T)) return item as PnsVia;
    }

    return null;
  }

  /**
   * `DRAGGER::startDragSegment` (`:118-152`).
   *
   * Note the two comparisons are deliberately different. Whether this is a
   * corner drag at all is `distA < w2 || distB < w2` — strict — while which
   * corner it is is `distB <= distA`, so a cursor exactly equidistant from both
   * ends takes the **far** one.
   */
  private startDragSegment(aP: Vec2, aSeg: PnsSegment): boolean {
    const w2 = Math.trunc(aSeg.width() / 2);
    const idx = { value: 0 };

    this.mDraggedLine = (this.mWorld as PnsNode).assembleLine(aSeg, idx);
    this.mDraggedSegmentIndex = idx.value;
    this.mLastDragSolution = this.mDraggedLine.clone();

    const s = aSeg.seg();
    const distA = Math.hypot(aP.x - s.a.x, aP.y - s.a.y);
    const distB = Math.hypot(aP.x - s.b.x, aP.y - s.b.y);

    // UNPINNED (mutation survivor): relaxing this `<` to `<=` changes nothing
    // any test here reaches, because none grabs a segment at *exactly* `w2`
    // from an end — the boundary needs a segment whose width is even and a
    // cursor placed on the integer distance, and the fixtures all sit clear of
    // it. The strictness is upstream's and is the reason a grab exactly half a
    // width from a corner is a *segment* drag; it is left documented rather
    // than pinned.
    if (distA < w2 || distB < w2) {
      this.mMode = PnsDragMode.DM_CORNER;

      if (distB <= distA) this.mDraggedSegmentIndex++;
    } else if (this.mFreeAngleMode) {
      if (
        distB < distA &&
        this.mDraggedSegmentIndex < this.mDraggedLine.pointCount() - 2 &&
        !this.mDraggedLine.cLine().isPtOnArc(this.mDraggedSegmentIndex + 1)
      ) {
        this.mDraggedSegmentIndex++;
      }

      this.mMode = PnsDragMode.DM_CORNER;
    } else {
      this.mMode = PnsDragMode.DM_SEGMENT;
    }

    return true;
  }

  /**
   * `DRAGGER::startDragArc` (`:155-254`).
   *
   * Refuses an arc that is already near a half turn, because the tangent
   * construction `LINE::DragArc` uses degenerates there. Then, if the arc's run
   * of points reaches either end of the assembled line, it grows a short
   * **tangential stub** off that end *into `m_preDragNode`* so the arc has a
   * neighbour to hinge against, and re-assembles from the branch rather than
   * from the world.
   *
   * The stub's direction is the outward tangent at the endpoint: the radial
   * turned 90°, flipped to whichever of the two perpendiculars points *away*
   * from the arc's midpoint.
   */
  private startDragArc(_aP: Vec2, aArc: PnsArc): boolean {
    const sharc = aArc.cArc();
    const g = arcShape(sharc.p0, sharc.arcMid, sharc.p1, sharc.width);

    // `SHAPE_ARC::GetCentralAngle()`; a degenerate (collinear) arc has none, and
    // upstream's `GetCentralAngle` divides by zero there.
    const centralAngleDeg = g.kind === 'arc' ? Math.abs((g.sweep * 180) / Math.PI) : 0;

    if (centralAngleDeg + PNS_MAX_TANGENT_ANGLE_DEVIATION_DEG >= 180) {
      const limit = 180 - PNS_MAX_TANGENT_ANGLE_DEVIATION_DEG;

      this.mRouter.setFailureReason(
        `Unable to drag arc tracks of ${limit.toFixed(1)} degrees or greater.`,
      );

      return false;
    }

    const probeIdx = { value: 0 };
    const probe = (this.mWorld as PnsNode).assembleLine(aArc, probeIdx);

    let arcIdx = -1;
    let firstArcPt = -1;
    let lastArcPt = -1;

    for (let i = 0; i < probe.pointCount(); i++) {
      const a = probe.cLine().arcIndex(i);

      if (a < 0) continue;

      if (arcIdx < 0) arcIdx = a;

      if (a === arcIdx) {
        if (firstArcPt < 0) firstArcPt = i;

        lastArcPt = i;
      }
    }

    const isolatedStart = firstArcPt === 0;
    const isolatedEnd = lastArcPt === probe.pointCount() - 1;
    const idx = { value: 0 };

    if (isolatedStart || isolatedEnd) {
      const maxStubIU = Math.round(PNS_MAX_TRACK_LENGTH_TO_KEEP_MM * PNS_IU_PER_MM);
      const stubLen = Math.max(1, Math.trunc(maxStubIU / 2));

      const center = g.kind === 'arc' ? { x: Math.round(g.c.x), y: Math.round(g.c.y) } : sharc.p0;
      const mid = sharc.arcMid;

      const outwardTangent = (aEndpoint: Vec2): Vec2 => {
        const radial = { x: aEndpoint.x - center.x, y: aEndpoint.y - center.y };
        let perp = { x: -radial.y, y: radial.x };
        const toMid = { x: mid.x - aEndpoint.x, y: mid.y - aEndpoint.y };

        if (perp.x * toMid.x + perp.y * toMid.y > 0) perp = { x: radial.y, y: -radial.x };

        const mag = Math.hypot(perp.x, perp.y);

        if (mag <= 0) return { x: stubLen, y: 0 };

        return {
          x: Math.round((perp.x * stubLen) / mag),
          y: Math.round((perp.y * stubLen) / mag),
        };
      };

      const preDrag = this.mPreDragNode as PnsNode;

      if (isolatedStart) {
        const p0 = sharc.p0;
        const t = outwardTangent(p0);
        const stub = new PnsSegment(
          { seg: { a: { x: p0.x + t.x, y: p0.y + t.y }, b: p0 }, width: aArc.width() },
          aArc.net(),
        );

        stub.setWidth(aArc.width());
        stub.setLayers(aArc.layers());
        preDrag.addSegment(stub);
      }

      if (isolatedEnd) {
        const p1 = sharc.p1;
        const t = outwardTangent(p1);
        const stub = new PnsSegment(
          { seg: { a: p1, b: { x: p1.x + t.x, y: p1.y + t.y } }, width: aArc.width() },
          aArc.net(),
        );

        stub.setWidth(aArc.width());
        stub.setLayers(aArc.layers());
        preDrag.addSegment(stub);
      }

      this.mDraggedLine = preDrag.assembleLine(aArc, idx);
    } else {
      this.mDraggedLine = (this.mWorld as PnsNode).assembleLine(aArc, idx);
    }

    this.mDraggedSegmentIndex = idx.value;
    this.mMode = PnsDragMode.DM_ARC;

    return true;
  }

  /** `DRAGGER::startDragVia` (`:257-265`). */
  private startDragVia(aVia: PnsVia): boolean {
    this.mInitialVia = aVia.makeHandle();
    this.mDraggedVia = this.mInitialVia;

    this.mMode = PnsDragMode.DM_VIA;

    return true;
  }

  /**
   * `DRAGGER::findViaFanoutByHandle` (`:267-302`): the via at a handle plus
   * every line leaving it.
   *
   * Each line is **reversed when the seed segment is not its first**, so the
   * via's end is always the line's point 0 — which is what makes
   * `CLine().Find( handle.pos )` a usable drag index at the call sites.
   *
   * At most **one** via is added, however many the joint carries.
   */
  private findViaFanoutByHandle(aNode: PnsNode, aHandle: ViaHandle): PnsItemSet {
    const rv = new PnsItemSet();

    const jt = aNode.findJoint(aHandle.pos, aHandle.layers.start(), aHandle.net);

    if (!jt) return rv;

    let foundVia = false;

    for (const item of jt.linkList()) {
      if (item.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)) {
        const segIndex = { value: 0 };
        const l = aNode.assembleLine(item as PnsLinkedItem, segIndex);

        if (segIndex.value !== 0) l.reverse();

        rv.addLine(l);
      } else if (item.ofKind(PnsKind.VIA_T)) {
        if (!foundVia) {
          rv.add(item);
          foundVia = true;
        }
      }
    }

    return rv;
  }

  /** `DRAGGER::Start` (`:304-357`). */
  override start(aP: Vec2, aPrimitives: PnsItemSet): boolean {
    if (aPrimitives.empty()) return false;

    const startItem = aPrimitives.at(0) as PnsItem;

    this.mLastNode = null;
    this.mDraggedItems.clear();
    this.mCurrentMode = this.settings().routingMode;
    this.mFreeAngleMode = (this.mMode & PnsDragMode.DM_FREE_ANGLE) !== 0;
    this.mForceMarkObstaclesMode = false;
    this.mLastValidPoint = aP;

    this.mMouseTrailTracer.clear();
    this.mMouseTrailTracer.addTrailPoint(aP);

    this.mPreDragNode = (this.mWorld as PnsNode).branch();

    if (this.mCurrentMode === PnsMode.RM_Shove && !this.mFreeAngleMode) {
      this.mShove = new PnsShove(this.mPreDragNode, toShoveSettings(this.settings()));
      this.mShove.setDefaultShovePolicy(PnsShovePolicy.SHP_SHOVE);
    }

    startItem.unmark(LineMarker.MK_LOCKED);

    switch (startItem.kind()) {
      case PnsKind.SEGMENT_T: {
        const seg = startItem as PnsSegment;
        const vvia = this.checkVirtualVia(aP, seg);

        if (vvia) return this.startDragVia(vvia);

        return this.startDragSegment(aP, seg);
      }

      case PnsKind.VIA_T:
        return this.startDragVia(startItem as PnsVia);

      case PnsKind.ARC_T:
        return this.startDragArc(aP, startItem as PnsArc);

      default:
        return false;
    }
  }

  // ----- mark obstacles ---------------------------------------------------------

  /**
   * `DRAGGER::dragMarkObstacles` (`:381-449`).
   *
   * **Returns `true` unconditionally.** The drag's success is reported through
   * `m_dragStatus`, not the return value, so `Drag`'s failure path is
   * unreachable while in mark-obstacles mode — which is exactly why
   * `m_forceMarkObstaclesMode` is a one-way latch.
   *
   * The snap threshold is a quarter of the line width here; `dragShove` uses a
   * half. That asymmetry is upstream's.
   */
  private dragMarkObstacles(aP: Vec2): boolean {
    this.mLastNode = (this.mPreDragNode as PnsNode).branch();

    switch (this.mMode) {
      case PnsDragMode.DM_SEGMENT:
      case PnsDragMode.DM_CORNER: {
        // TODO (upstream): make the threshold configurable.
        const thresh = this.settings().smoothDraggedSegments
          ? Math.trunc(this.mDraggedLine.width() / 4)
          : 0;
        const origLine = this.mDraggedLine.clone();
        const dragged = this.mDraggedLine.clone();

        dragged.setSnapThreshhold(thresh);
        dragged.clearLinks();

        if (this.mMode === PnsDragMode.DM_SEGMENT) {
          lineDragSegment(dragged, aP, this.mDraggedSegmentIndex);
        } else {
          lineDragCorner(dragged, aP, this.mDraggedSegmentIndex, this.mFreeAngleMode);
        }

        this.mLastNode.removeLine(origLine);
        this.mLastNode.addLine(dragged);

        this.mDraggedItems.clear();
        this.mDraggedItems.addLine(dragged);

        break;
      }

      case PnsDragMode.DM_ARC: {
        const origLine = this.mDraggedLine.clone();
        const dragged = this.mDraggedLine.clone();

        dragged.clearLinks();

        this.mRouter.dragArc(dragged, aP, this.mDraggedSegmentIndex);

        // A collapsed arc drag leaves an empty chain, so Add() is a no-op and
        // the arc is simply dropped from the route, which is the intended
        // outcome here.
        this.mLastNode.removeLine(origLine);
        this.mLastNode.addLine(dragged);

        this.mDraggedItems.clear();
        this.mDraggedItems.addLine(dragged);

        break;
      }

      case PnsDragMode.DM_VIA:
        this.dragViaMarkObstacles(this.mInitialVia, this.mLastNode, aP);

        break;

      default:
        break;
    }

    if (this.settings().allowDrcViolations) this.mDragStatus = true;
    else this.mDragStatus = this.mLastNode.checkColliding(this.mDraggedItems) === null;

    return true;
  }

  /**
   * `DRAGGER::dragViaMarkObstacles` (`:452-489`).
   *
   * `aNode` is upstream's parameter and upstream **ignores it**, working on
   * `m_lastNode` instead. The two are the same object at the one call site;
   * the parameter is kept so the signature still reads as upstream's.
   */
  private dragViaMarkObstacles(aHandle: ViaHandle, aNode: PnsNode, aP: Vec2): boolean {
    this.mDraggedItems.clear();

    const fanout = this.findViaFanoutByHandle(aNode, aHandle);

    if (fanout.empty()) return true;

    const lastNode = this.mLastNode as PnsNode;

    for (const item of fanout.items()) {
      if (item.kind() === PnsKind.LINE_T) {
        const l = item as PnsLine;
        const origLine = l.clone();
        const draggedLine = l.clone();

        lineDragCorner(draggedLine, aP, origLine.cLine().find(aHandle.pos), this.mFreeAngleMode);
        draggedLine.clearLinks();

        this.mDraggedItems.addLine(draggedLine);

        lastNode.removeLine(origLine);
        lastNode.addLine(draggedLine);
      } else if (item.kind() === PnsKind.VIA_T) {
        const via = item as PnsVia;
        const nvia = via.clone();

        nvia.setPos(aP);
        this.mDraggedItems.add(nvia);

        lastNode.removeVia(via);
        lastNode.addVia(nvia);
      }
    }

    return true;
  }

  // ----- walkaround -------------------------------------------------------------

  /**
   * `DRAGGER::propagateViaForces` (`:62-78`).
   *
   * Only the **first** via of the set is considered, whatever else is in it.
   * The lead vector is the *negated* mouse trail lead — pointing back the way
   * the cursor came — so a via that cannot be pushed sideways retreats towards
   * the user rather than deeper into the obstacle.
   */
  private propagateViaForces(aNode: PnsNode, aVias: Set<PnsVia>): boolean {
    const via = aVias.values().next().value as PnsVia | undefined;

    if (!via) return false;

    const lead = this.mMouseTrailTracer.getTrailLeadVector();
    const negated = { x: -lead.x, y: -lead.y };

    const force = viaPushoutForce(
      aNode,
      via,
      negated,
      PnsKind.ANY_T,
      this.settings().viaForcePropIterationLimit,
    );

    if (force) {
      via.setPos({ x: via.pos().x + force.x, y: via.pos().y + force.y });

      return true;
    }

    return false;
  }

  /**
   * `DRAGGER::dragViaWalkaround` (`:492-566`).
   *
   * Two passes over the fanout, and the split matters: the via has to reach its
   * force-propagated position **before** any line is dragged, because the lines
   * are dragged to *that* position (`viaTargetPos`), not to the cursor.
   *
   * When no via in the fanout could be force-propagated this returns false with
   * the via already removed from `m_lastNode` and not put back. Upstream's;
   * `Drag`'s failure path then rebuilds the node from its parent anyway.
   *
   * The collision test that decides whether to walk around is against
   * **`m_world`**, not the branch being edited.
   */
  private dragViaWalkaround(aHandle: ViaHandle, aNode: PnsNode, aP: Vec2): boolean {
    this.mDraggedItems.clear();

    const fanout = this.findViaFanoutByHandle(aNode, aHandle);

    if (fanout.empty()) return true;

    let viaPropOk = false;
    let viaTargetPos: Vec2 = { x: 0, y: 0 };
    const lastNode = this.mLastNode as PnsNode;

    for (const item of fanout.items()) {
      if (item.kind() !== PnsKind.VIA_T) continue;

      const via = item as PnsVia;
      const draggedVia = via.clone();

      draggedVia.setPos(aP);
      this.mDraggedItems.add(draggedVia);

      const vias = new Set<PnsVia>([draggedVia]);

      lastNode.removeVia(via);

      const ok = this.propagateViaForces(lastNode, vias);

      if (ok) {
        viaTargetPos = draggedVia.pos();
        viaPropOk = true;
        lastNode.addVia(draggedVia);
      }
    }

    if (!viaPropOk) return false;

    for (const item of fanout.items()) {
      if (item.kind() !== PnsKind.LINE_T) continue;

      const l = item as PnsLine;
      const origLine = l.clone();
      const draggedLine = l.clone();

      lineDragCorner(
        draggedLine,
        viaTargetPos,
        origLine.cLine().find(aHandle.pos),
        this.mFreeAngleMode,
      );
      draggedLine.clearLinks();

      if ((this.mWorld as PnsNode).checkColliding(draggedLine)) {
        const walkLine = this.tryWalkaround(lastNode, draggedLine);

        if (!walkLine) return false;

        lastNode.removeLine(origLine);
        this.optimizeAndUpdateDraggedLine(walkLine, origLine, aP);
      } else {
        this.mDraggedItems.addLine(draggedLine);

        lastNode.removeLine(origLine);
        lastNode.addLine(draggedLine);
      }
    }

    return true;
  }

  /**
   * `DRAGGER::optimizeAndUpdateDraggedLine` (`:569-618`).
   *
   * `ClearLinks()` and `Unmark()` happen **always**, optimisation only under
   * `GetOptimizeEntireDraggedTrack()`. The final `Add` + `m_draggedItems`
   * refresh are unconditional too, which is why this is the single exit for
   * every walkaround and shove path.
   *
   * ### What the optimiser bridge does and does not do
   *
   * Upstream builds `MERGE_SEGMENTS | KEEP_TOPOLOGY | RESTRICT_AREA`
   * (`| MERGE_COLINEAR` when smoothing), sets a preserve-vertex at the anchor
   * and a restrict-area of the changed region — falling back to the degenerate
   * box `BOX2I( aP )`, whose stated purpose is to *disable* optimisation
   * because nothing can be inside it.
   *
   * `mergeFull` and `mergeColinear` are what this repo has. `KEEP_TOPOLOGY`,
   * `RESTRICT_AREA` and the preserve-vertex have no counterpart, the same gap
   * `PnsShove.runOptimizer` shipped with. The consequences are named rather
   * than hidden: without restrict-area an optimisation may reach further along
   * the track than upstream would allow, and the changed-area fallback that
   * disables optimisation entirely is honoured explicitly instead of emerging
   * from an empty box.
   *
   * The `Split( anchor )` *is* ported, because it changes the chain whether or
   * not anything preserves the vertex it inserts.
   */
  private optimizeAndUpdateDraggedLine(aDragged: PnsLine, aOrig: PnsLine, aP: Vec2): void {
    let draggedPostOpt: PnsLine;

    aDragged.clearLinks();
    aDragged.unmark();

    if (this.settings().optimizeEntireDraggedTrack) {
      let effort =
        PNS_OPT.MERGE_SEGMENTS |
        PNS_OPT.KEEP_TOPOLOGY |
        PNS_OPT.RESTRICT_AREA |
        PNS_OPT.PRESERVE_VERTEX;

      if (this.settings().smoothDraggedSegments) effort |= PNS_OPT.MERGE_COLINEAR;

      // `OPT_BOX2I affectedArea = aDragged.ChangedArea( &aOrig )`. A null area
      // means the two lines do not differ, and upstream then substitutes the
      // degenerate box `BOX2I( aP )` with the stated intent of *disabling*
      // optimization — nothing can be inside a zero-area restrict area. That is
      // honoured here by skipping the merge passes, because `RESTRICT_AREA`
      // itself has no implementation to reject with.
      const affectedArea = lineChangedArea(aDragged, aOrig);

      let anchor = aP;

      if (aDragged.cLine().find(aP) < 0) anchor = aDragged.cLine().nearestPoint(aP);

      chainSplit(aDragged.line(), anchor);

      draggedPostOpt = affectedArea
        ? this.optimizeLine(aDragged, effort, this.mLastNode as PnsNode)
        : this.optimizeLine(aDragged, 0, this.mLastNode as PnsNode);
    } else {
      draggedPostOpt = aDragged.clone();
    }

    (this.mLastNode as PnsNode).addLine(draggedPostOpt);
    this.mDraggedItems.clear();
    this.mDraggedItems.addLine(draggedPostOpt);
  }

  /**
   * The `OPTIMIZER::Optimize` bridge, shaped exactly as
   * `PnsShove.optimizeLine`: the effort mask selects a merge pass, and a pass
   * that changes nothing leaves the line alone.
   */
  private optimizeLine(aLine: PnsLine, aEffort: number, aNode: PnsNode): PnsLine {
    // `*aResult = *aLine; aResult->ClearLinks();` happens before any pass, so
    // an effort mask with nothing this bridge implements still yields an
    // unlinked copy rather than the caller's line.
    const optimized = aLine.clone();

    optimized.clearLinks();

    const chain = aLine.cLine().points();

    if (chain.length < 3) return optimized;

    const collides = (path: Vec2[]): boolean => {
      const probe = PnsLine.fromBase(aLine, PnsLineChain.fromPoints(path));
      probe.clearLinks();

      return aNode.checkColliding(probe) !== null;
    };

    let out: Vec2[] = chain;

    // Upstream skips MERGE_SEGMENTS on a line carrying arcs ("TODO: Fix for
    // arcs"); MERGE_COLINEAR has no such guard.
    if (aEffort & PNS_OPT.MERGE_SEGMENTS && aLine.cLine().arcCount() === 0) {
      out = mergeFull(out, collides);
    }

    if (aEffort & PNS_OPT.MERGE_COLINEAR) out = mergeColinear(out);

    if (out === chain) return optimized;

    optimized.setShape(PnsLineChain.fromPoints(out));

    return optimized;
  }

  /**
   * `DRAGGER::tryWalkaround` (`:621-642`).
   *
   * Upstream builds a `WALKAROUND` with solids-only off, the settings'
   * iteration limit, a length limit of **30.0** and the single policy
   * `WP_SHORTEST`, then keeps the result only on `ST_DONE`.
   *
   * `WALKAROUND` the class is not ported (see the shove spec, §11). The bridge
   * gathers the hulls of everything the node reports colliding with the line and
   * hands them to `routeShortest`, which is `WP_SHORTEST` — both ways round,
   * the better kept — with the same iteration limit and length-limit factor.
   * The difference from upstream is that the obstacle set is enumerated once
   * rather than re-queried after each detour.
   *
   * Returns the walked line, or null; upstream's `aWalk = aOrig` on entry is
   * subsumed by returning null and leaving the caller's line alone.
   */
  private tryWalkaround(aNode: PnsNode, aOrig: PnsLine): PnsLine | null {
    if (aOrig.segmentCount() < 1) return null;

    const hulls = collectObstacleHulls(aNode, aOrig);

    if (hulls.length === 0) {
      // Nothing to walk around: upstream's WALKAROUND returns ST_DONE on the
      // first iteration with the line untouched.
      return aOrig.clone();
    }

    const result = routeShortest(aOrig.cLine().points(), hulls, {
      iterationLimit: this.settings().walkaroundIterationLimit,
      lengthLimit: true,
      lengthExpansionFactor: 30.0,
    });

    if (result.status !== 'done') return null;

    const out = aOrig.clone();
    out.setShape(PnsLineChain.fromPoints(result.path));

    return out;
  }

  /** `DRAGGER::dragWalkaround` (`:645-735`). */
  private dragWalkaround(aP: Vec2): boolean {
    let ok = false;

    this.mLastNode = (this.mPreDragNode as PnsNode).branch();

    switch (this.mMode) {
      case PnsDragMode.DM_SEGMENT:
      case PnsDragMode.DM_CORNER: {
        const thresh = this.settings().smoothDraggedSegments
          ? Math.trunc(this.mDraggedLine.width() / 4)
          : 0;
        const dragged = this.mDraggedLine.clone();
        let draggedWalk = this.mDraggedLine.clone();
        const origLine = this.mDraggedLine.clone();

        dragged.setSnapThreshhold(thresh);

        if (this.mMode === PnsDragMode.DM_SEGMENT) {
          lineDragSegment(dragged, aP, this.mDraggedSegmentIndex);
        } else {
          // Note: no free-angle argument here, unlike dragMarkObstacles.
          lineDragCorner(dragged, aP, this.mDraggedSegmentIndex);
        }

        if ((this.mWorld as PnsNode).checkColliding(dragged)) {
          const walked = this.tryWalkaround(this.mLastNode, dragged);

          ok = walked !== null;

          if (walked) draggedWalk = walked;
        } else {
          draggedWalk = dragged;
          ok = true;
        }

        if (draggedWalk.cLine().pointCount() < 2) ok = false;

        if (ok) {
          this.mLastNode.removeLine(origLine);
          this.optimizeAndUpdateDraggedLine(draggedWalk, origLine, aP);
        }

        break;
      }

      case PnsDragMode.DM_ARC: {
        const dragged = this.mDraggedLine.clone();
        let draggedWalk = this.mDraggedLine.clone();
        const origLine = this.mDraggedLine.clone();

        this.mRouter.dragArc(dragged, aP, this.mDraggedSegmentIndex);

        if ((this.mWorld as PnsNode).checkColliding(dragged)) {
          const walked = this.tryWalkaround(this.mLastNode, dragged);

          ok = walked !== null;

          if (walked) draggedWalk = walked;
        } else {
          draggedWalk = dragged;
          ok = true;
        }

        if (draggedWalk.cLine().pointCount() < 2) ok = false;

        if (ok) {
          this.mLastNode.removeLine(origLine);
          this.optimizeAndUpdateDraggedLine(draggedWalk, origLine, aP);
        }

        break;
      }

      case PnsDragMode.DM_VIA:
        ok = this.dragViaWalkaround(this.mInitialVia, this.mLastNode, aP);

        break;

      default:
        break;
    }

    this.mDragStatus = ok;

    return ok;
  }

  // ----- shove ------------------------------------------------------------------

  /**
   * `DRAGGER::dragShove` (`:738-890`).
   *
   * `m_lastNode` is rebuilt from the shove's current node **whether or not the
   * shove succeeded**, so a failed shove still leaves a coherent world for
   * `Drag`'s recovery path to branch from.
   *
   * The snap threshold here is **half** the line width; mark-obstacles and
   * walkaround use a quarter.
   *
   * `SHP_REVERSED` is added for a corner drag at index 0 — the far end of the
   * line is then the one shove treats as fixed.
   */
  private dragShove(aP: Vec2): boolean {
    const shove = this.mShove as PnsShove;

    switch (this.mMode) {
      case PnsDragMode.DM_SEGMENT:
      case PnsDragMode.DM_CORNER: {
        let ok = false;
        // TODO (upstream): make the threshold configurable.
        const thresh = this.settings().smoothDraggedSegments
          ? Math.trunc(this.mDraggedLine.width() / 2)
          : 0;
        const draggedPreShove = this.mDraggedLine.clone();

        draggedPreShove.setSnapThreshhold(thresh);

        if (this.mMode === PnsDragMode.DM_SEGMENT) {
          lineDragSegment(draggedPreShove, aP, this.mDraggedSegmentIndex);
        } else {
          lineDragCorner(draggedPreShove, aP, this.mDraggedSegmentIndex);
        }

        const preShoveNode = shove.currentNode();

        if (preShoveNode) preShoveNode.removeLine(draggedPreShove);

        let policy = PnsShovePolicy.SHP_SHOVE | PnsShovePolicy.SHP_DONT_LOCK_ENDPOINTS;

        if (this.mMode === PnsDragMode.DM_CORNER && this.mDraggedSegmentIndex === 0) {
          policy |= PnsShovePolicy.SHP_REVERSED;
        }

        shove.clearHeads();
        shove.addHeads(draggedPreShove, policy);
        ok = shove.run() === PnsShoveStatus.SH_OK;

        let draggedPostShove = draggedPreShove.clone();

        if (ok && shove.headsModified()) draggedPostShove = shove.getModifiedHead(0);

        this.mLastNode = shove.currentNode().branch();

        if (ok) {
          draggedPostShove.clearLinks();
          draggedPostShove.unmark();
          this.optimizeAndUpdateDraggedLine(draggedPostShove, this.mDraggedLine, aP);
          this.mLastDragSolution = draggedPostShove;
        }

        this.mDragStatus = ok;

        break;
      }

      case PnsDragMode.DM_ARC: {
        let ok = false;

        const draggedPreShove = this.mDraggedLine.clone();

        this.mRouter.dragArc(draggedPreShove, aP, this.mDraggedSegmentIndex);

        // A collapsed arc drag can leave fewer than two points, which is not a
        // valid shove head. Treat that as an unsuccessful shove (as
        // dragWalkaround does) rather than feeding a degenerate line to
        // AddHeads.
        if (draggedPreShove.cLine().pointCount() >= 2) {
          const preShoveNode = shove.currentNode();

          if (preShoveNode) preShoveNode.removeLine(draggedPreShove);

          const policy = PnsShovePolicy.SHP_SHOVE | PnsShovePolicy.SHP_DONT_LOCK_ENDPOINTS;

          shove.clearHeads();
          shove.addHeads(draggedPreShove, policy);
          ok = shove.run() === PnsShoveStatus.SH_OK;
        }

        let draggedPostShove = draggedPreShove.clone();

        if (ok && shove.headsModified()) draggedPostShove = shove.getModifiedHead(0);

        this.mLastNode = shove.currentNode().branch();

        if (ok) {
          draggedPostShove.clearLinks();
          draggedPostShove.unmark();
          this.optimizeAndUpdateDraggedLine(draggedPostShove, this.mDraggedLine, aP);
          this.mLastDragSolution = draggedPostShove;
        }

        this.mDragStatus = ok;

        break;
      }

      case PnsDragMode.DM_VIA: {
        // The corner-count limiter intended to avoid excessive optimization
        // produces mediocre results for via shoving. This is upstream's hack to
        // disable it.
        shove.disablePostShoveOptimizations(PnsOptimizerFlags.LIMIT_CORNER_COUNT);

        shove.clearHeads();
        shove.addHeadsVia(this.mDraggedVia, aP, PnsShovePolicy.SHP_SHOVE);

        const st = shove.run();

        if (shove.headsModified()) this.mDraggedVia = shove.getModifiedHeadVia(0);

        this.mLastNode = shove.currentNode().branch();

        this.mDraggedItems.clear();

        // If the drag didn't work (i.e. dragged onto a collision) try
        // walkaround instead.
        if (st !== PnsShoveStatus.SH_OK) {
          this.mDragStatus = this.dragViaWalkaround(this.mDraggedVia, this.mLastNode, aP);
        } else {
          this.mDragStatus = true;
        }

        break;
      }

      default:
        break;
    }

    return this.mDragStatus;
  }

  // ----- drag / fix -------------------------------------------------------------

  /** `DRAGGER::Drag` (`:934-985`). */
  override drag(aP: Vec2): boolean {
    this.mMouseTrailTracer.addTrailPoint(aP);

    const firstDrag = this.mLastNode === null;
    let ret = false;

    if (this.mFreeAngleMode || this.mForceMarkObstaclesMode) {
      ret = this.dragMarkObstacles(aP);
    } else {
      switch (this.mCurrentMode) {
        case PnsMode.RM_MarkObstacles:
          ret = this.dragMarkObstacles(aP);
          break;

        case PnsMode.RM_Shove:
          ret = this.dragShove(aP);
          break;

        case PnsMode.RM_Walkaround:
          ret = this.dragWalkaround(aP);
          break;

        default:
          break;
      }
    }

    if (ret) {
      this.mLastValidPoint = aP;
    } else if (firstDrag) {
      // First collision resolution failed, switch to highlight mode.
      this.mForceMarkObstaclesMode = true;

      ret = this.dragMarkObstacles(aP);

      if (ret) this.mLastValidPoint = aP;
    } else if (this.mLastNode) {
      // Restore last solution.
      const parent = (this.mLastNode.getParent() as PnsNode).branch();

      this.mLastNode = parent;
      this.mDraggedItems.clear();
      this.mLastDragSolution.clearLinks();
      this.mLastNode.addLine(this.mLastDragSolution);
    }

    return ret;
  }

  /**
   * `DRAGGER::FixRoute` (`:893-931`).
   *
   * The third branch is the interesting one: a drag that is *currently*
   * colliding is re-run against the last point that worked, and committed if
   * that succeeds. In shove and walkaround modes every track that would be
   * committed is then in a valid position even though the solution under the
   * cursor is not.
   */
  override fixRoute(aForceCommit: boolean): boolean {
    let node = this.currentNode();

    if (node) {
      if (this.mDragStatus) {
        this.mRouter.commitRouting(node);

        return true;
      }

      if (this.mForceMarkObstaclesMode) {
        if (aForceCommit) {
          this.mRouter.commitRouting(node);

          return true;
        }

        return false;
      }

      this.drag(this.mLastValidPoint);
      node = this.currentNode();

      if (node && this.mDragStatus) {
        this.mRouter.commitRouting(node);

        return true;
      }
    }

    return false;
  }
}

/**
 * `OPTIMIZER::OptimizationEffort` (`pns_optimizer.h:73-86`), with **upstream's
 * values**.
 *
 * `PnsOptimizerFlags` in `pns_shove.ts` carries only the five bits shove uses
 * and gives `RESTRICT_AREA` and `LIMIT_CORNER_COUNT` different values from
 * upstream's (`0x20`/`0x80` rather than `0x100`/`0x200`). That is
 * self-consistent inside shove — it composes and masks its own values and never
 * shows them to anyone — but it cannot be mixed with the four extra bits the
 * dragger asks for. This is the dragger's private mask; the one place the two
 * meet, `DisablePostShoveOptimizations`, deliberately uses **shove's**
 * `LIMIT_CORNER_COUNT` because the mask it lands in is shove's.
 */
const PNS_OPT = {
  MERGE_SEGMENTS: 0x01,
  SMART_PADS: 0x02,
  MERGE_OBTUSE: 0x04,
  FANOUT_CLEANUP: 0x08,
  KEEP_TOPOLOGY: 0x10,
  PRESERVE_VERTEX: 0x20,
  RESTRICT_VERTEX_RANGE: 0x40,
  MERGE_COLINEAR: 0x80,
  RESTRICT_AREA: 0x100,
  LIMIT_CORNER_COUNT: 0x200,
} as const;

/**
 * Enumerate every obstacle the node reports against a line and turn each into a
 * hull, which is the input `routeShortest` wants.
 *
 * The per-segment loop is `NODE::NearestObstacle`'s own way of asking a line's
 * question of an index that only understands single items; it is repeated here
 * rather than exported from `pns_node.ts` so that file does not move.
 */
export function collectObstacleHulls(aNode: PnsNode, aLine: PnsLine): Vec2[][] {
  const chain = aLine.cLine();

  if (chain.segmentCount() === 0) return [];

  const obstacleSet = new ObstacleSet();
  const scratch = PnsSegment.fromParentLine(aLine, chain.cSegment(0));

  for (let i = 0; i < chain.segmentCount(); i++) {
    const s = chain.cSegment(i);

    scratch.setEnds(s.a, s.b);
    aNode.queryColliding(scratch, obstacleSet);
  }

  if (aLine.endsWithVia()) aNode.queryColliding(aLine.via(), obstacleSet);

  const hulls: Vec2[][] = [];
  const seen = new Set<PnsItem>();

  for (const obs of obstacleSet.items()) {
    if (!obs.item || seen.has(obs.item)) continue;

    seen.add(obs.item);

    const clearance = aNode.getClearance(obs.item, aLine);

    hulls.push([...itemHull(obs.item, clearance, aLine.width(), aLine.layer())]);
  }

  return hulls;
}

// ============================================================================
// Folded in from pns_drag.ts (the KiCad file that holds this code is this one; see STRUCTURE.md).
// ============================================================================
/**
 * Dragging a track the way the push-and-shove router does. Counterparts:
 * `pcbnew/router/pns_dragger.cpp` (DRAGGER::startDragSegment / drag) and
 * `pcbnew/router/pns_node.cpp` (NODE::AssembleLine, NODE::followLine,
 * JOINT::NextSegment).
 *
 * The unit of a drag is not the segment you grabbed but the *line* it belongs
 * to: the run of same-net, same-layer, same-width segments joined end to end,
 * ending wherever the topology branches or a via or pad anchors it. Grab a
 * corner and the corner moves; grab the middle of a segment and the segment
 * slides while its neighbours are re-cut to keep the 45° regime.
 *
 * `TRACK_DRAG_ACTION::DRAG`, 45°, is what KiCad does with a left-drag on a
 * trace by default (PCBNEW_SETTINGS::m_TrackDragAction); free-angle is the
 * `dragFreeAngle` action, and it only ever drags corners (upstream asserts on a
 * free-angle *segment* drag).
 *
 * Not ported: arcs are treated as ends of a line rather than dragged through
 * (LINE::DragArc), via dragging, and the router's collision response, shoving
 * or walking around what is in the way. This is the free-space geometry.
 */

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A line assembled out of board tracks, in walk order. */
export interface AssembledLine {
  /** The corner points, `tracks.length + 1` of them. */
  chain: Chain;
  /** Board track indices, one per chain segment, in the same order. */
  tracks: number[];
  /** Chain index of the seed segment (NODE::AssembleLine's origin index). */
  originSegment: number;
  width: number;
  layer: string;
  net: number;
}

/**
 * JOINT::NextSegment, the one other track that carries the line on through
 * `p`. Null when the joint branches, carries a via or pad, or the next segment
 * is a different width: all of those end the line.
 */
function nextSegment(
  board: Board,
  p: Vec2,
  current: number,
  line: { net: number; layer: string; width: number },
): number | null {
  // A via or pad at the joint anchors the line (upstream returns nullptr for
  // SOLID_T / VIA_T without even looking for another segment).
  for (const via of board.vias) {
    if (via.net === line.net && same(via.at, p)) return null;
  }
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if ((pad.net ?? 0) === line.net && same(pad.at, p)) return null;
    }
  }
  // An arc through the joint is not dragged as part of the line, so stop there.
  for (const arc of board.arcs) {
    if (arc.net === line.net && (same(arc.start, p) || same(arc.end, p))) return null;
  }

  let found: number | null = null;
  for (let i = 0; i < board.tracks.length; i++) {
    if (i === current) continue;
    const t = board.tracks[i]!;
    if (t.net !== line.net || t.layer !== line.layer) continue;
    if (!same(t.start, p) && !same(t.end, p)) continue;
    if (found !== null) return null; // a branch: more than one candidate
    found = i;
  }
  if (found === null) return null;
  if (board.tracks[found]!.width !== line.width) return null;
  return found;
}

/**
 * NODE::AssembleLine, the whole line through `trackIndex`, walked out both
 * ways from the seed segment.
 */
export function assembleLine(board: Board, trackIndex: number): AssembledLine | null {
  const seed = board.tracks[trackIndex];
  if (!seed) return null;

  const spec = { net: seed.net, layer: seed.layer, width: seed.width };
  const chain: Chain = [{ ...seed.start }, { ...seed.end }];
  const tracks = [trackIndex];

  const walk = (from: Vec2, forwards: boolean): void => {
    let p = from;
    let current = trackIndex;
    for (;;) {
      const next = nextSegment(board, p, current, spec);
      if (next === null || tracks.includes(next)) break; // no continuation, or a loop
      const t = board.tracks[next]!;
      const far = same(t.start, p) ? t.end : t.start;
      if (forwards) {
        chain.push({ ...far });
        tracks.push(next);
      } else {
        chain.unshift({ ...far });
        tracks.unshift(next);
      }
      p = far;
      current = next;
    }
  };

  walk(seed.end, true);
  const before = tracks.length;
  walk(seed.start, false);
  // Every segment prepended shifts the seed along the chain.
  const originSegment = tracks.length - before;

  return { chain, tracks, originSegment, width: spec.width, layer: spec.layer, net: spec.net };
}

export type DragMode = 'corner' | 'segment';

export interface TrackDrag {
  line: AssembledLine;
  mode: DragMode;
  /** Corner index for a corner drag; segment index for a segment drag. */
  index: number;
  freeAngle: boolean;
  /** LINE::SetSnapThreshhold, width/4 with "smooth dragged segments" on. */
  snapThreshold: number;
}

/**
 * DRAGGER::startDragSegment, grabbing within half a track width of either end
 * drags that corner; anywhere else slides the segment, except in free-angle
 * mode, which only ever drags corners.
 */
export function startTrackDrag(
  board: Board,
  trackIndex: number,
  p: Vec2,
  opts: { freeAngle?: boolean; smoothDraggedSegments?: boolean } = {},
): TrackDrag | null {
  const line = assembleLine(board, trackIndex);
  if (!line) return null;

  const freeAngle = opts.freeAngle === true;
  const smooth = opts.smoothDraggedSegments !== false;
  const w2 = line.width / 2;

  let index = line.originSegment;
  const a = line.chain[index]!;
  const b = line.chain[index + 1]!;
  const distA = dist(p, a);
  const distB = dist(p, b);

  let mode: DragMode;
  if (distA < w2 || distB < w2) {
    mode = 'corner';
    if (distB <= distA) index++;
  } else if (freeAngle) {
    if (distB < distA && index < line.chain.length - 2) index++;
    mode = 'corner';
  } else {
    mode = 'segment';
  }

  return { line, mode, index, freeAngle, snapThreshold: smooth ? Math.floor(line.width / 4) : 0 };
}

/**
 * The line's new shape with the grabbed corner/segment at `p`. Corners land on
 * whole internal units, as everything upstream is VECTOR2I, guide intersections
 * are otherwise free to land a half-unit off and write coordinates back with
 * more precision than the file format carries.
 */
export function updateTrackDrag(drag: TrackDrag, p: Vec2): Chain {
  const chain =
    drag.mode === 'corner'
      ? dragCorner(drag.line.chain, p, drag.index, drag.freeAngle, drag.snapThreshold)
      : dragSegment45(drag.line.chain, p, drag.index, drag.snapThreshold);
  return chain.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }));
}

/**
 * The line's segments after a drag: the old track objects re-pointed at the new
 * corners so they keep their identity (uuid, net, locked, source formatting),
 * plus writer-canonical ones for any segment the drag added.
 */
export function trackDragSegments(board: Board, drag: TrackDrag, chain: Chain): PcbTrack[] {
  const count = segmentCount(chain);
  const old = drag.line.tracks.map((i) => board.tracks[i]!);
  const template = old[0]!;
  const rebuilt: PcbTrack[] = [];

  for (let i = 0; i < count; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    const reuse = old[i];
    if (reuse) {
      rebuilt.push(withTrackEnds(reuse, a, b));
    } else {
      // A new segment the drag created: its own model and identity.
      const { uuid, k, ...rest } = template;
      void uuid;
      void k;
      rebuilt.push({ ...rest, start: a, end: b });
    }
  }
  return rebuilt;
}

/**
 * Commit a dragged line: the line's own segments become the new chain's,
 * dropping or adding segments at the end when the counts do not line up.
 */
export function applyTrackDrag(board: Board, drag: TrackDrag, chain: Chain): Board {
  const count = segmentCount(chain);
  if (count === 0) return board;

  const rebuilt = trackDragSegments(board, drag, chain);

  // Replace in place so the surviving segments keep their indices (and so any
  // selection referring to them stays valid); extras are appended, and the tail
  // of a shortened line is dropped.
  const dropped = new Set(drag.line.tracks.slice(count));
  const byIndex = new Map<number, PcbTrack>();
  drag.line.tracks.slice(0, count).forEach((boardIdx, i) => {
    byIndex.set(boardIdx, rebuilt[i]!);
  });
  const extra = rebuilt.slice(drag.line.tracks.length);

  const tracks = board.tracks.map((t, i) => byIndex.get(i) ?? t).filter((_, i) => !dropped.has(i));

  return { ...board, tracks: [...tracks, ...extra] };
}
