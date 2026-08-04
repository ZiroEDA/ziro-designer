// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Cleanup Tracks & Vias — the *geometric* passes. Counterpart:
 * `TRACKS_CLEANER::cleanup` (pcbnew/tracks_cleaner.cpp:378) and the part of
 * `TRACKS_CLEANER::CleanupBoard` (tracks_cleaner.cpp:59) that drives it.
 *
 * Ported here: zero-length segments, duplicate segments, collinear merging, the
 * `CLEANUP_ITEM` report rows and the dry-run / real-run split. The passes that
 * need answers this port cannot yet give — shorting tracks, dangling tracks and
 * vias, tracks inside pads, redundant vias — are absent rather than stubbed;
 * see the notes at the end of this block.
 *
 * ## Flags, and why the run needs a working copy
 *
 * Two per-item flags drive everything, and both survive across passes:
 *
 *  - `IS_DELETED` — "logically gone". On a real run the item is also removed
 *    from the board; **on a dry run only the flag is set**, so the board still
 *    holds it and every later pass has to honour the flag by hand.
 *  - `SKIP_STRUCT` — "already processed by this geometry pass", which is what
 *    makes duplicate detection asymmetric: of N identical tracks the *last*
 *    survives, and the reference track is reported once per partner it finds,
 *    so three identical tracks give two removals and three report rows.
 *
 * Both are cleared at the start and at the end of every `cleanup()` call and
 * nowhere else. Upstream can set them because it owns mutable `PCB_TRACK`
 * pointers; here they live on {@link TrackRec}, a working copy that also
 * carries the item's *original* `boardItemId`. Report rows name original ids,
 * because a dry run must stay clickable against the board the caller still
 * has, and the new board is only materialised at the end — deleting as we went
 * would renumber every index-based id mid-run.
 *
 * ## Iteration order
 *
 * Upstream walks one interleaved `m_tracks` deque; a ziro `Board` keeps
 * `tracks`, `arcs` and `vias` in three arrays and the file's interleaving is
 * not recoverable from it. The canonical order here is
 * `[...tracks, ...arcs, ...vias]`. No outcome depends on it — every
 * order-sensitive comparison in these passes is like-with-like and the relative
 * order inside each array is preserved — but the *interleaving of report rows*
 * differs from KiCad's for a board that interleaves vias among tracks.
 *
 * ## Two deliberate divergences
 *
 *  - `if( candidate < segment ) continue` in the merge scan compares raw
 *    pointers. Its only purpose is to emit each unordered pair once, and a
 *    pointer order has no counterpart in TS, so canonical-index order stands in:
 *    the **earlier** track is `seg1` and survives, the later is `seg2` and is
 *    removed. Upstream's survivor is whichever the allocator put lower in
 *    memory; the "one merge per pair" effect is reproduced exactly, the choice
 *    of survivor is ours.
 *  - Upstream's connectivity keeps being updated *during* the apply phase of a
 *    merge pass (`Update( aSeg1 )`, `Remove( aSeg2 )`), but its
 *    `m_connectedItemsCache` — cleared once per merge iteration — means every
 *    re-test in that phase reads the pre-merge clusters anyway. This port
 *    builds the graph once per iteration and caches clusters for its duration,
 *    which lands on the same answers by construction.
 *
 * ## Not ported (each needs machinery this port does not have)
 *
 *  - `removeShortingTrackSegments`, `deleteDanglingTracks`: both need
 *    connectivity queries this module does not expose, and the dangling test
 *    needs `TestTrackEndpointDangling`.
 *  - `deleteTracksInPads`: needs `TransformOvalToPolygon` and
 *    `PAD::GetEffectivePolygon( layer, ERROR_INSIDE )`, and the two must share
 *    an inscribe convention or the boolean subtraction leaves slivers and the
 *    pass silently reports nothing.
 *  - the duplicate-**via** half of `cleanup()` (`aDeleteDuplicateVias`): the
 *    R-tree half stands alone, but the through-hole-pad rule beside it needs
 *    `GetConnectedPads`, and half a pass is worse than none.
 *
 * Because `deleteDanglingTracks` is absent, `CleanupBoard`'s step 8 — a second
 * collinear pass gated on `has_deleted && aMergeSegments` — can never fire.
 * Note that it could not fire on a dry run either way: `deleteDanglingTracks`
 * returns `modified`, which is only ever set when `!m_dryRun`.
 */

import { segApproxCollinear } from '@ziroeda/kimath/src/geometry/seg.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { atom, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import type { Reporter } from '@ziroeda/common/src/reporter.js';
import {
  buildCleanupConnectivity,
  cnItemHitTest,
  padCnItems,
  type CleanupCnItem,
  type CleanupConnectivity,
} from './cleanup_connectivity.js';
import { makeCleanupItem, type CleanupRcItem } from './cleanup_item.js';
import { arcShape, viaLayers } from './drc/drc_engine.js';
import { shapeDist, type Shape } from './drc/drc_geometry.js';
import { boardItemId, deleteBoardItems, mm, patchChild } from './edit-board.js';
import { groupLockedUuids } from './global_deletion.js';
import { enabledCopperLayers } from './swap_layers.js';
import type { Board, PcbTrack } from './types.js';

// ---------------------------------------------------------------------------
// The working copy

/** `EDA_ITEM_FLAGS` bits `PCB_TRACK::IsPointOnEnds` returns. */
const STARTPOINT = 1;
const ENDPOINT = 2;

/**
 * One `PCB_TRACK` of the board, plus the two flags and the geometry the run is
 * allowed to rewrite. A via is a track whose start and end are its centre,
 * exactly as `PCB_VIA` is a `PCB_TRACK` upstream.
 */
interface TrackRec {
  /** `boardItemId()` against the *input* board; stable for the whole run. */
  id: string;
  /** Position in `[...tracks, ...arcs, ...vias]`; the pointer-order stand-in. */
  order: number;
  type: 'track' | 'arc' | 'via';
  start: Vec2;
  end: Vec2;
  /** Arcs only. */
  mid?: Vec2;
  /** `GetWidth()`; a via's is its diameter, as `PCB_VIA::GetWidth()` is. */
  width: number;
  /** `GetLayer()` — for a via, its *top* layer alone. */
  layer: string;
  /** `GetLayerSet()`, intersected with the board's enabled layers. */
  layers: string[];
  net: number;
  /** `BOARD_ITEM::IsLocked()`, ancestor groups included. */
  locked: boolean;
  isDeleted: boolean;
  skipStruct: boolean;
  /** Set when a merge rewrote `start`/`end`, so the emitter patches this one. */
  merged: boolean;
}

interface CleanerState {
  recs: TrackRec[];
  byId: Map<string, TrackRec>;
  /** Pads never change during a run, so they are built once. */
  pads: CleanupCnItem[];
  dryRun: boolean;
  filterItem: (aId: string) => boolean;
  items: CleanupRcItem[];
  /** Ids to drop from the board when the run finishes; real runs only. */
  removed: Set<string>;
}

/**
 * `m_brd->Tracks()` — the items still *on* the board.
 *
 * Upstream's `removeItems` takes them off it, so the next `cleanup()` call, the
 * connectivity rebuild and every later pass simply do not see them; here the
 * working copy outlives the removal, so the exclusion has to be explicit —
 * `cleanup()` clears `IS_DELETED` on the way out, and without this a track that
 * was removed for real walks back into the second `cleanup()` call with a clean
 * flag.
 *
 * `removed` is only ever filled on a real run, which is exactly right — on a
 * dry run the item genuinely is still on the board, carrying its flag.
 *
 * Mutation testing says no test can currently tell the difference: with only
 * the null and duplicate passes ported, everything this filters out is already
 * excluded by `IsNull()` or by the `IS_DELETED` check at the use site. It stays
 * because it is what "removed from the board" means, and the first pass added
 * either side of it would depend on it.
 */
const live = (aState: CleanerState): TrackRec[] =>
  aState.recs.filter((r) => !aState.removed.has(r.id));

/** `PCB_TRACK::IsNull()` — a via is null by definition, hence the type guards
 *  the callers put in front of it. */
const isNull = (aRec: TrackRec): boolean =>
  aRec.type === 'via' || (aRec.start.x === aRec.end.x && aRec.start.y === aRec.end.y);

/**
 * `PCB_TRACK::IsPointOnEnds( point, min_dist )` (pcb_track.cpp:943), returning
 * the same `STARTPOINT | ENDPOINT` bitmask. Every call site in the cleaner uses
 * the result as a boolean, but the mask is what upstream returns and the two
 * ends genuinely differ for a caller that wants to know which one matched.
 *
 * `min_dist == 0` is *exact integer equality*, which is why a reversed
 * duplicate track counts and one that is a single IU off does not.
 */
function isPointOnEnds(
  aEnds: { start: Vec2; end: Vec2; width: number },
  aPoint: Vec2,
  aMinDist = 0,
): number {
  let result = 0;
  let minDist = aMinDist;

  if (minDist < 0) minDist = Math.trunc(aEnds.width / 2);

  if (minDist === 0) {
    if (aEnds.start.x === aPoint.x && aEnds.start.y === aPoint.y) result |= STARTPOINT;
    if (aEnds.end.x === aPoint.x && aEnds.end.y === aPoint.y) result |= ENDPOINT;
  } else {
    if (minDist >= Math.hypot(aEnds.start.x - aPoint.x, aEnds.start.y - aPoint.y)) {
      result |= STARTPOINT;
    }

    if (minDist >= Math.hypot(aEnds.end.x - aPoint.x, aEnds.end.y - aPoint.y)) {
      result |= ENDPOINT;
    }
  }

  return result;
}

/** `PCB_TRACK::ApproxCollinear` (pcb_track.cpp:537): the two chords, threshold 1. */
const approxCollinear = (aA: TrackRec, aB: TrackRec): boolean =>
  segApproxCollinear(aA.start, aA.end, aB.start, aB.end);

/** `GetEffectiveShape()` — SHAPE_SEGMENT, SHAPE_ARC or a via's circle. */
function recShape(aRec: TrackRec): Shape {
  if (aRec.type === 'via') return { kind: 'circle', c: aRec.start, r: aRec.width / 2 };
  if (aRec.type === 'arc' && aRec.mid) {
    return arcShape(aRec.start, aRec.mid, aRec.end, aRec.width);
  }
  return { kind: 'stadium', a: aRec.start, b: aRec.end, r: aRec.width / 2 };
}

/** `std::popcount` over the four attachment-point bits. */
function popcount(aFlags: number): number {
  let count = 0;

  for (let bits = aFlags; bits !== 0; bits >>>= 1) count += bits & 1;

  return count;
}

function buildRecs(aBoard: Board): TrackRec[] {
  const enabled = aBoard.layers.map((l) => l.name);
  const copperOrder = enabledCopperLayers(aBoard);
  const lockedByGroup = groupLockedUuids(aBoard);
  const recs: TrackRec[] = [];

  const locked = (item: { locked?: boolean; uuid?: string }): boolean =>
    !!item.locked || (item.uuid !== undefined && lockedByGroup.has(item.uuid));

  // `PCB_TRACK::GetLayerSet()` (pcb_track.cpp:1545): the copper layer, plus the
  // matching mask layer when the track carries a solder-mask opening.
  const traceLayers = (layer: string, maskLayer: string | undefined): string[] =>
    [layer, ...(maskLayer === undefined ? [] : [maskLayer])].filter((l) => enabled.includes(l));

  aBoard.tracks.forEach((t, i) => {
    recs.push({
      id: boardItemId('track', i),
      order: recs.length,
      type: 'track',
      start: t.start,
      end: t.end,
      width: t.width,
      layer: t.layer,
      layers: traceLayers(t.layer, t.maskLayer),
      net: t.net,
      locked: locked(t),
      isDeleted: false,
      skipStruct: false,
      merged: false,
    });
  });

  aBoard.arcs.forEach((a, i) => {
    recs.push({
      id: boardItemId('arc', i),
      order: recs.length,
      type: 'arc',
      start: a.start,
      mid: a.mid,
      end: a.end,
      width: a.width,
      layer: a.layer,
      layers: traceLayers(a.layer, a.maskLayer),
      net: a.net,
      locked: locked(a),
      isDeleted: false,
      skipStruct: false,
      merged: false,
    });
  });

  aBoard.vias.forEach((v, i) => {
    recs.push({
      id: boardItemId('via', i),
      order: recs.length,
      type: 'via',
      // A via's start and end are both its centre; `cleanup()` even repairs a
      // via whose two differ, which our single-point model cannot express.
      start: v.at,
      end: v.at,
      width: v.size,
      // `GetLayer()` for a via is the *top* of its span, which is the only
      // layer the R-tree indexes it on.
      layer: v.layers[0],
      layers: viaLayers(v, copperOrder).filter((l) => enabled.includes(l)),
      net: v.net,
      locked: locked(v),
      isDeleted: false,
      skipStruct: false,
      merged: false,
    });
  });

  return recs;
}

// ---------------------------------------------------------------------------
// The spatial index (DRC_RTREE)

/**
 * `DRC_RTREE::QueryColliding( ref, refLayer, targetLayer, filter, visitor )`
 * (drc/drc_rtree.h:225) as a brute-force scan.
 *
 * The three properties that matter are kept: an item never matches itself, each
 * parent is visited at most once, and the collision is the effective shapes at
 * clearance 0. Items are indexed on `GetLayer()` and both the query layers are
 * the reference's own, so only same-layer items are candidates at all.
 *
 * The *filter* is applied at visit time rather than when the candidate list is
 * built, because the visitor sets flags the filter reads.
 */
function buildTrackIndex(aRecs: readonly TrackRec[]): (aRef: TrackRec) => TrackRec[] {
  const byLayer = new Map<string, TrackRec[]>();
  const shapes = new Map<string, Shape>();

  for (const rec of aRecs) {
    const bucket = byLayer.get(rec.layer);

    if (bucket) bucket.push(rec);
    else byLayer.set(rec.layer, [rec]);

    shapes.set(rec.id, recShape(rec));
  }

  return (aRef: TrackRec): TrackRec[] => {
    const refShape = shapes.get(aRef.id)!;

    return (byLayer.get(aRef.layer) ?? []).filter(
      (other) => other !== aRef && shapeDist(refShape, shapes.get(other.id)!) <= 0,
    );
  };
}

// ---------------------------------------------------------------------------
// testMergeCollinearSegments and friends

/**
 * `TRACKS_CLEANER::testTrackEndpointIsNode` (tracks_cleaner.cpp:230),
 * reproduced faithfully — **including the fact that it cannot fire**.
 *
 * `ItemEntry( aTrack ).GetItems()` holds the track's own `CN_ITEM` and nothing
 * else (`m_itemMap[item] = ITEM_MAP_ENTRY( item )`; `Link()` is used only for
 * the extra items a zone gets per layer), and the loop's first guard skips the
 * item whose parent *is* `aTrack`. So the body never executes, `itemcount`
 * stays 0, and the answer is always false.
 *
 * Even if the list did hold neighbours, the anchor test asks a single anchor to
 * equal both `GetStart()` *and* `GetEnd()`, which no anchor of a non-degenerate
 * track can. It is written out here so that the day upstream fixes it, this is
 * a small diff instead of a rediscovery.
 */
function testTrackEndpointIsNode(aTrack: TrackRec, aTstStart: boolean, aTstEnd: boolean): boolean {
  if (!(aTstStart && aTstEnd)) return false;

  const items: readonly TrackRec[] = [aTrack];

  if (items.length === 0) return false;

  let itemcount = 0;

  for (const item of items) {
    if (item === aTrack || item.isDeleted) continue;

    if (item.type === 'track' && approxCollinear(item, aTrack)) continue;

    for (const anchor of [item.start, item.end]) {
      if (
        aTstStart &&
        anchor.x === aTrack.start.x &&
        anchor.y === aTrack.start.y &&
        aTstEnd &&
        anchor.x === aTrack.end.x &&
        anchor.y === aTrack.end.y
      ) {
        itemcount++;
        break;
      }
    }
  }

  return itemcount > 1;
}

/**
 * `TRACKS_CLEANER::testMergeCollinearSegments` (tracks_cleaner.cpp:412).
 *
 * The question it answers is "would merging these two lose an attachment?".
 * It collects the *distinct points at which anything else is attached* to
 * either segment as a four-bit mask over
 * `[seg1.start, seg1.end, seg2.start, seg2.end]`; more than two such points
 * means there is a node in the middle of the pair, and the merge is refused.
 *
 * Two details that look interchangeable and are not:
 *
 *  - the attachment scan walks each segment's whole **same-net cluster**
 *    (`GetConnectedItems`), not its direct neighbours. A track with net <= 0
 *    gets an empty cluster, so the mask stays 0 and an unnetted collinear pair
 *    always merges;
 *  - a track, arc or via sets a bit by *exact* endpoint equality, while
 *    anything else sets it by `HitTest` at `(width + 1) / 2` — the integer
 *    round-*up* of the segment's own half width.
 *
 * When `aDummySeg` is supplied the merged geometry is written into it, which is
 * how `mergeCollinearSegments` gets the geometry it commits.
 */
function testMergeCollinearSegments(
  aState: CleanerState,
  aConnectivity: CleanupConnectivity,
  aSeg1: TrackRec,
  aSeg2: TrackRec,
  aDummySeg?: { start: Vec2; end: Vec2 },
): boolean {
  if (aSeg1.locked || aSeg2.locked) return false;

  const pts = [aSeg1.start, aSeg1.end, aSeg2.start, aSeg2.end];
  let flags = 0;

  // p1s = 1 << 0, p1e = 1 << 1, p2s = 1 << 2, p2e = 1 << 3.
  const collectPts = (aItem: CleanupCnItem, aBase: number, aSeg: TrackRec): void => {
    if (popcount(flags) > 2) return;

    const startBit = 1 << aBase;
    const endBit = 1 << (aBase + 1);

    if (aItem.type !== 'pad') {
      const other = aState.byId.get(aItem.id)!;

      if (isPointOnEnds(other, aSeg.start)) flags |= startBit;
      if (isPointOnEnds(other, aSeg.end)) flags |= endBit;
    } else {
      const accuracy = Math.trunc((aSeg.width + 1) / 2);

      if (!(flags & startBit) && cnItemHitTest(aItem, aSeg.start, accuracy)) flags |= startBit;
      if (!(flags & endBit) && cnItemHitTest(aItem, aSeg.end, accuracy)) flags |= endBit;
    }
  };

  const scan = (aSeg: TrackRec, aBase: number): void => {
    for (const item of aConnectivity.cluster(aSeg.id)) {
      if (aState.byId.get(item.id)?.isDeleted) continue;
      if (item.id === aSeg1.id || item.id === aSeg2.id) continue;

      collectPts(item, aBase, aSeg);
    }
  };

  scan(aSeg1, 0);
  scan(aSeg2, 2);

  // This means there is a node in the center.
  if (popcount(flags) > 2) return false;

  const minX = Math.min(aSeg1.start.x, aSeg1.end.x, aSeg2.start.x, aSeg2.end.x);
  const minY = Math.min(aSeg1.start.y, aSeg1.end.y, aSeg2.start.y, aSeg2.end.y);
  const maxX = Math.max(aSeg1.start.x, aSeg1.end.x, aSeg2.start.x, aSeg2.end.x);
  const maxY = Math.max(aSeg1.start.y, aSeg1.end.y, aSeg2.start.y, aSeg2.end.y);

  // Which diagonal of the bounding box the merged segment runs along is decided
  // by aSeg1's own orientation alone — aSeg2 does not get a vote, which is what
  // makes the survivor's identity matter.
  const dummy =
    aSeg1.start.x > aSeg1.end.x === aSeg1.start.y > aSeg1.end.y
      ? { start: { x: minX, y: minY }, end: { x: maxX, y: maxY } }
      : { start: { x: minX, y: maxY }, end: { x: maxX, y: minY } };

  if (aDummySeg) {
    aDummySeg.start = dummy.start;
    aDummySeg.end = dummy.end;
  }

  const dummyEnds = { ...dummy, width: aSeg1.width };

  // Every attachment point must still be an endpoint of the merged segment.
  for (let i = 0; i < 4; ++i) {
    if (flags & (1 << i) && !isPointOnEnds(dummyEnds, pts[i]!)) return false;
  }

  return !testTrackEndpointIsNode(
    aSeg1,
    isPointOnEnds(dummyEnds, aSeg1.start) !== 0,
    isPointOnEnds(dummyEnds, aSeg1.end) !== 0,
  );
}

/**
 * `TRACKS_CLEANER::mergeCollinearSegments` (tracks_cleaner.cpp:530).
 *
 * The test is re-run with a real out-parameter rather than carrying geometry
 * over from the scan, so the merged shape is computed against whatever the
 * segments look like *now* — an earlier merge in the same pass may have moved
 * `aSeg1`'s far end.
 *
 * `*aSeg1 = dummy_seg` copies through `EDA_ITEM::operator=`, which does not
 * copy `m_Uuid`: the surviving track keeps its own uuid, width, layer and net,
 * and only its endpoints change.
 */
function mergeCollinearSegments(
  aState: CleanerState,
  aConnectivity: CleanupConnectivity,
  aSeg1: TrackRec,
  aSeg2: TrackRec,
): boolean {
  const dummy = { start: aSeg1.start, end: aSeg1.end };

  if (!testMergeCollinearSegments(aState, aConnectivity, aSeg1, aSeg2, dummy)) return false;

  aState.items.push(makeCleanupItem('merge_tracks', aSeg1.id, aSeg2.id));

  aSeg2.isDeleted = true;

  if (!aState.dryRun) {
    aSeg1.start = dummy.start;
    aSeg1.end = dummy.end;
    aSeg1.merged = true;

    // Merge successful, seg2 has to go away.
    aState.removed.add(aSeg2.id);
  }

  return true;
}

/**
 * The `mergeSegments` lambda of `cleanup()` (tracks_cleaner.cpp:509): collect
 * every mergeable pair, then apply them.
 *
 * Upstream splits the scan across a thread pool purely for speed, but the
 * two-phase shape it forces is observable: a pair collected before its partner
 * was flagged is *skipped* at apply time, yet still counts as "something
 * happened" and so drives another iteration of the outer loop.
 *
 * The scan iterates the segment's `CN_ITEM`s, not its two ends — and a track
 * has exactly one — so despite the comment upstream a segment yields **at most
 * one pair per pass** and picks up its other end on the next one.
 */
function mergeSegmentsPass(aState: CleanerState, aConnectivity: CleanupConnectivity): boolean {
  const pairs: [TrackRec, TrackRec][] = [];

  for (const segment of live(aState)) {
    // One can merge only collinear segments, not vias or arcs.
    if (segment.type !== 'track') continue;
    if (segment.isDeleted) continue; // already taken into account
    if (aState.filterItem(segment.id)) continue;

    // Do not merge an end which has different width tracks attached -- it's a
    // common use-case for necking-down a track between pads.
    const sameWidthCandidates: TrackRec[] = [];
    let differentWidth = false;

    for (const connected of aConnectivity.neighbours(segment.id)) {
      const candidate = aState.byId.get(connected.id);

      if (
        candidate === undefined ||
        candidate.type !== 'track' ||
        candidate.isDeleted ||
        aState.filterItem(candidate.id)
      ) {
        continue;
      }

      if (candidate.width === segment.width) {
        sameWidthCandidates.push(candidate);
      } else {
        differentWidth = true;
        break;
      }
    }

    if (differentWidth) continue;

    for (const candidate of sameWidthCandidates) {
      // Upstream's `if( candidate < segment ) continue` — see the file header.
      if (candidate.order < segment.order) continue;

      if (
        approxCollinear(segment, candidate) &&
        testMergeCollinearSegments(aState, aConnectivity, segment, candidate)
      ) {
        pairs.push([segment, candidate]);
        break;
      }
    }
  }

  let retval = false;

  for (const [seg1, seg2] of pairs) {
    retval = true;

    if (seg1.isDeleted || seg2.isDeleted) continue;

    mergeCollinearSegments(aState, aConnectivity, seg1, seg2);
  }

  return retval;
}

/** `BOARD::BuildConnectivity()` + `RecalculateRatsnest()`, over the working copy. */
function rebuildConnectivity(aState: CleanerState): CleanupConnectivity {
  const items: CleanupCnItem[] = [];

  // On a real run the flagged items came off the board with `removeItems`, so
  // they are out of the connectivity too; on a dry run they are still on it,
  // still linked, and every consumer filters them by flag instead. The
  // difference is observable — a dry run can reach through a doomed segment to
  // the far side of a cluster, a real run cannot.
  for (const rec of live(aState)) {
    items.push({
      id: rec.id,
      type: rec.type,
      net: rec.net,
      layers: rec.layers,
      shapes: [recShape(rec)],
      // CN_ITEMs for tracks and arcs are built with aCanChangeNet = true, and a
      // via's is `!GetIsFree()` — free vias are not modelled, so every via here
      // is an ordinary one.
      canChangeNet: true,
    });
  }

  return buildCleanupConnectivity([...items, ...aState.pads]);
}

// ---------------------------------------------------------------------------
// cleanup()

/**
 * `TRACKS_CLEANER::cleanup` (tracks_cleaner.cpp:378), minus the duplicate-via
 * branch — see the file header.
 *
 * All the branches run for the same item inside one iteration, in this order,
 * which is why a zero-length trace flagged by the null pass is never also
 * examined by the duplicate pass: `IsNull()` excludes it there.
 */
function geometryCleanup(
  aState: CleanerState,
  aDeleteNullSegments: boolean,
  aDeleteDuplicateSegments: boolean,
  aMergeSegments: boolean,
): void {
  const tracks = live(aState);

  for (const rec of tracks) {
    rec.isDeleted = false;
    rec.skipStruct = false;
  }

  const queryColliding = buildTrackIndex(tracks);
  const toRemove = new Set<string>();

  for (const track of tracks) {
    if (track.isDeleted || track.locked || aState.filterItem(track.id)) continue;

    if (aDeleteNullSegments && track.type !== 'via') {
      // `IsNull()` is exact equality of the two ends, and arcs are *not*
      // excluded here, so a closed arc is reported as a zero-length track.
      if (isNull(track)) {
        aState.items.push(makeCleanupItem('zero_length_track', track.id));

        track.isDeleted = true;
        toRemove.add(track.id);
      }
    }

    if (aDeleteDuplicateSegments && track.type === 'track' && !isNull(track)) {
      for (const other of queryColliding(track)) {
        if (other.type !== 'track' || other.skipStruct || other.isDeleted || isNull(other)) {
          continue;
        }

        if (
          isPointOnEnds(track, other.start) &&
          isPointOnEnds(track, other.end) &&
          track.width === other.width &&
          track.layer === other.layer
        ) {
          // The *reference* is the one reported and flagged, once per partner
          // it finds; the visitor neither stops nor re-checks the flag.
          aState.items.push(makeCleanupItem('duplicate_track', track.id));

          track.isDeleted = true;
          toRemove.add(track.id);
        }
      }

      // Redundant for traces and kept anyway: duplicate-ness is exact equality,
      // hence an equivalence, so every member of a group but the last is
      // already IS_DELETED by the time a later reference could look at it, and
      // no test can distinguish this line from a no-op. SKIP_STRUCT earns its
      // keep in the duplicate-*via* branch, which sets it on every via it
      // examines rather than only on the ones it flags.
      track.skipStruct = true;
    }
  }

  if (!aState.dryRun) for (const id of toRemove) aState.removed.add(id);

  if (aMergeSegments) {
    let more = true;

    while (more) {
      const connectivity = rebuildConnectivity(aState);

      more = mergeSegmentsPass(aState, connectivity);
    }
  }

  for (const rec of live(aState)) {
    rec.isDeleted = false;
    rec.skipStruct = false;
  }
}

// ---------------------------------------------------------------------------
// The board the run produces

const xyNode = (aName: string, aPoint: Vec2): SList => ({
  kind: 'list',
  items: [atom(aName), atom(mm(aPoint.x)), atom(mm(aPoint.y))] as SNode[],
});

function emitBoard(aBoard: Board, aState: CleanerState): Board {
  const merged = aState.recs.filter((r) => r.merged);

  if (merged.length === 0 && aState.removed.size === 0) return aBoard;

  const tracks: PcbTrack[] = aBoard.tracks.map((track, i) => {
    const rec = aState.byId.get(boardItemId('track', i));

    if (!rec?.merged) return track;

    return {
      ...track,
      start: rec.start,
      end: rec.end,
      source: patchChild(
        patchChild(track.source, 'start', xyNode('start', rec.start)),
        'end',
        xyNode('end', rec.end),
      ),
    };
  });

  return deleteBoardItems({ ...aBoard, tracks }, aState.removed);
}

// ---------------------------------------------------------------------------
// The entry point

export interface TrackGeometryCleanupOptions {
  /** `aDryRun`: build the change list without touching the board. */
  dryRun: boolean;
  /**
   * `removeNullSegments`, which `CleanupBoard` derives as
   * `aMergeSegments || aRemoveMisConnected` (tracks_cleaner.cpp:78) — the
   * shorting pass needs zero-length segments gone before it runs, so the
   * "Delete tracks connecting different nets" checkbox turns this on too. It is
   * taken as an input here because the shorting pass itself is not ported.
   */
  removeNullSegments?: boolean;
  /** `aMergeSegments`: the "Merge co-linear tracks" checkbox. */
  mergeSegments?: boolean;
  /**
   * `TRACKS_CLEANER::m_filter`. **Returning true EXCLUDES the item** — the
   * polarity is upstream's and reads backwards.
   */
  filter?: (aId: string) => boolean;
  /** `aReporter`: the dialog's progress log. */
  reporter?: Reporter;
}

export interface TrackGeometryCleanupResult {
  /** The input board itself on a dry run, which changes nothing. */
  board: Board;
  /** `aItemsList`, in the order upstream pushes rows. */
  items: CleanupRcItem[];
}

/**
 * `TRACKS_CLEANER::CleanupBoard` restricted to the geometry passes.
 *
 * The one step here that is easy to get wrong: **duplicate-track removal always
 * runs**. Step 2 asks for it when `mergeSegments` is set, and step 4 runs a
 * second `cleanup()` for it alone when `mergeSegments` is clear — so there is
 * no combination of checkboxes that switches it off, and the dialog offers
 * none.
 */
export function cleanupTrackGeometry(
  aBoard: Board,
  aOpts: TrackGeometryCleanupOptions,
): TrackGeometryCleanupResult {
  const recs = buildRecs(aBoard);
  const state: CleanerState = {
    recs,
    byId: new Map(recs.map((r) => [r.id, r])),
    pads: padCnItems(aBoard),
    dryRun: aOpts.dryRun,
    filterItem: aOpts.filter ?? (() => false),
    items: [],
    removed: new Set<string>(),
  };

  const mergeSegments = aOpts.mergeSegments ?? false;
  const removeNullSegments = aOpts.removeNullSegments ?? false;

  aOpts.reporter?.report(
    aOpts.dryRun ? 'Checking null tracks and vias...' : 'Removing null tracks and vias...',
  );

  geometryCleanup(state, removeNullSegments, mergeSegments, mergeSegments);

  aOpts.reporter?.report(
    aOpts.dryRun ? 'Checking redundant tracks...' : 'Removing redundant tracks...',
  );

  // If we didn't remove duplicates above, do it now.
  if (!mergeSegments) geometryCleanup(state, false, true, false);

  return { board: emitBoard(aBoard, state), items: state.items };
}
