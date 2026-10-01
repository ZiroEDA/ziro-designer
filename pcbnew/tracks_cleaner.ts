// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TRACKS_CLEANER` (pcbnew/tracks_cleaner.h, pcbnew/tracks_cleaner.cpp), whole,
 * on the live BOARD: Cleanup Tracks & Vias' engine, which
 * `GLOBAL_EDIT_TOOL::CleanupTracksAndVias` drives through
 * `DIALOG_CLEANUP_TRACKS_AND_VIAS`.
 *
 * Every pass is upstream's: null and duplicate segments, redundant vias
 * (duplicates, and through vias on a through-hole pad), co-linear merging,
 * shorting tracks and vias, tracks inside pads, and dangling tracks and vias.
 * They run on the BOARD's own items through its CONNECTIVITY_DATA and a
 * DRC_RTREE, set `IS_DELETED` / `SKIP_STRUCT` on the items as upstream does, and
 * on a real run remove through the caller's BOARD_COMMIT.
 *
 * Two things cannot be reproduced literally:
 *
 *  - `if( candidate < segment ) continue` in the merge scan compares raw
 *    pointers, to emit each unordered pair once. A pointer order has no
 *    counterpart here, so the item's index in `m_brd->Tracks()` stands in: the
 *    earlier track is `aSeg1` and survives. Upstream's survivor is whichever
 *    the allocator put lower in memory, which for a loaded board is usually
 *    the same load order.
 *  - The merge scan runs on KiCad's thread pool in blocks, and the pairs are
 *    applied block by block in index order. Run in one block it applies the
 *    same pairs in the same order; there is no thread pool here.
 */
import { SKIP_STRUCT, IS_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RPT_SEVERITY_UNDEFINED, type Reporter } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { type VECTOR2I, equal } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from './board.js';
import type { BOARD_COMMIT } from './board_commit.js';
import type { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import type { BOARD_ITEM } from './board_item.js';
import { CLEANUP_ITEM, CLEANUP_RC_CODE } from './cleanup_item.js';
import type { CN_CONNECTIVITY_ALGO } from './connectivity/connectivity_algo.js';
import { DRC_RTREE } from './drc/drc_rtree.js';
import { PCB_TRACK, type PCB_VIA } from './pcb_track.js';

const popcount = (v: number): number => {
  let n = 0;

  for (let x = v >>> 0; x; x &= x - 1) n++;

  return n;
};

export class TRACKS_CLEANER {
  private readonly m_brd: BOARD;
  private readonly m_commit: BOARD_COMMIT; // caller owns
  private m_dryRun = true;
  private m_itemsList: CLEANUP_ITEM[] = []; // caller owns
  private m_reporter: Reporter | null = null;

  // Cache connections.  O(n^2) is awful, but it beats O(2n^3).
  private readonly m_connectedItemsCache = new Map<PCB_TRACK, BOARD_CONNECTED_ITEM[]>();

  private m_filter: ((aItem: BOARD_CONNECTED_ITEM) => boolean) | null = null;

  /** The track's index in `m_brd->Tracks()` at the start of a merge scan: the pointer order. */
  private m_order = new Map<PCB_TRACK, number>();

  constructor(aPcb: BOARD, aCommit: BOARD_COMMIT) {
    this.m_brd = aPcb;
    this.m_commit = aCommit;
  }

  /**
   * The cleanup function.
   * @param aDryRun true to build the changes list, false to modify the board
   * @param aItemsList the list of modified items
   * @param aRemoveMisConnected true to remove segments connecting 2 different nets
   * @param aCleanVias true to remove superimposed vias
   * @param aMergeSegments true to merge collinear segments and remove 0 len segments
   * @param aDeleteUnconnected true to remove dangling tracks
   * @param aDeleteTracksinPad true to remove tracks fully inside pads
   * @param aDeleteDanglingVias true to remove a via that is only connected to a single layer
   * @param aReporter a REPORTER to print activity and info
   *
   * The parameter order is the definition's (tracks_cleaner.cpp:55-58), which
   * swaps the first two against the declaration's names; the definition is what
   * runs, and the dialog calls it in that order.
   */
  CleanupBoard(
    aDryRun: boolean,
    aItemsList: CLEANUP_ITEM[],
    aRemoveMisConnected: boolean,
    aCleanVias: boolean,
    aMergeSegments: boolean,
    aDeleteUnconnected: boolean,
    aDeleteTracksinPad: boolean,
    aDeleteDanglingVias: boolean,
    aReporter: Reporter | null = null,
  ): void {
    this.m_reporter = aReporter;
    let has_deleted = false;

    this.m_dryRun = aDryRun;
    this.m_itemsList = aItemsList;

    this.report(aDryRun ? 'Checking null tracks and vias...' : 'Removing null tracks and vias...');

    const removeNullSegments = aMergeSegments || aRemoveMisConnected;
    this.cleanup(aCleanVias, removeNullSegments, aMergeSegments /* dup segments*/, aMergeSegments);

    this.report(aDryRun ? 'Checking redundant tracks...' : 'Removing redundant tracks...');

    // If we didn't remove duplicates above, do it now
    if (!aMergeSegments) this.cleanup(false, false, true, false);

    if (aRemoveMisConnected) {
      this.report(aDryRun ? 'Checking shorting tracks...' : 'Removing shorting tracks...');

      this.removeShortingTrackSegments();
    }

    if (aDeleteTracksinPad) {
      this.report(aDryRun ? 'Checking tracks in pads...' : 'Removing tracks in pads...');

      this.deleteTracksInPads();
    }

    if (aDeleteUnconnected || aDeleteDanglingVias) {
      if (aDryRun) {
        this.report('Checking dangling tracks and vias...');
      } else {
        if (aDeleteUnconnected) this.report('Removing dangling tracks...');

        if (aDeleteDanglingVias) this.report('Removing dangling vias...');
      }

      has_deleted = this.deleteDanglingTracks(aDeleteUnconnected, aDeleteDanglingVias);
    }

    if (has_deleted && aMergeSegments) {
      this.report(aDryRun ? 'Checking collinear tracks...' : 'Merging collinear tracks...');

      this.cleanup(false, false, false, true);
    }
  }

  SetFilter(aFilter: ((aItem: BOARD_CONNECTED_ITEM) => boolean) | null): void {
    this.m_filter = aFilter;
  }

  /** `m_reporter->Report( msg )`; `wxSafeYield()` has nothing to yield to. */
  private report(aMsg: string): void {
    this.m_reporter?.report(aMsg, RPT_SEVERITY_UNDEFINED);
  }

  private filterItem(aItem: BOARD_CONNECTED_ITEM): boolean {
    if (!this.m_filter) return false;

    return this.m_filter(aItem);
  }

  private push(aCode: number, a: BOARD_ITEM, b: BOARD_ITEM | null = null): void {
    const item = new CLEANUP_ITEM(aCode);
    item.SetItems(a, b);
    this.m_itemsList.push(item);
  }

  /** Removes track segments which are connected to more than one net (short circuits). */
  private removeShortingTrackSegments(): void {
    const connectivity = this.m_brd.GetConnectivity();
    const toRemove = new Set<BOARD_ITEM>();

    for (const segment of this.m_brd.Tracks()) {
      if (segment.IsLocked() || this.filterItem(segment)) continue;

      const code =
        segment.Type() === KICAD_T.PCB_VIA_T
          ? CLEANUP_RC_CODE.CLEANUP_SHORTING_VIA
          : CLEANUP_RC_CODE.CLEANUP_SHORTING_TRACK;

      for (const testedPad of connectivity.GetConnectedPads(segment)) {
        if (segment.GetNetCode() !== testedPad.GetNetCode()) {
          this.push(code, segment);
          toRemove.add(segment);
        }
      }

      for (const testedTrack of connectivity.GetConnectedTracks(segment)) {
        if (segment.GetNetCode() !== testedTrack.GetNetCode()) {
          this.push(code, segment);
          toRemove.add(segment);
        }
      }
    }

    if (!this.m_dryRun) this.removeItems(toRemove);
  }

  /**
   * @return true if a track end position is a node, i.e. an end connected to more
   * than one item.
   */
  private testTrackEndpointIsNode(
    aTrack: PCB_TRACK,
    aTstStart: boolean,
    aTstEnd: boolean,
  ): boolean {
    if (!(aTstStart && aTstEnd)) return false;

    // A node is a point where more than 2 items are connected.  However, we elide tracks that
    // are collinear with the track being tested.
    const items = this.m_brd.GetConnectivity().GetConnectivityAlgo().ItemEntry(aTrack).GetItems();

    if (items.length === 0) return false;

    let itemcount = 0;

    for (const item of items) {
      if (!item.Valid() || item.Parent() === aTrack || item.Parent().HasFlag(IS_DELETED)) continue;

      if (
        item.Parent().Type() === KICAD_T.PCB_TRACE_T &&
        (item.Parent() as PCB_TRACK).ApproxCollinear(aTrack)
      ) {
        continue;
      }

      for (const anchor of item.Anchors()) {
        if (
          aTstStart &&
          equal(anchor.Pos(), aTrack.GetStart()) &&
          aTstEnd &&
          equal(anchor.Pos(), aTrack.GetEnd())
        ) {
          itemcount++;
          break;
        }
      }
    }

    return itemcount > 1;
  }

  /**
   * Removes tracks or vias only connected on one end.
   * @return true if any items were deleted
   */
  private deleteDanglingTracks(aTrack: boolean, aVia: boolean): boolean {
    let item_erased = false;
    let modified = false;

    if (!aTrack && !aVia) return false;

    do {
      // Iterate when at least one track is deleted
      item_erased = false;
      // Ensure the connectivity is up to date, especially after removing a dangling segment
      this.m_brd.BuildConnectivity();

      // Keep a duplicate deque to allow deleting in the primary
      const temp_tracks = [...this.m_brd.Tracks()];

      for (const track of temp_tracks) {
        if (track.HasFlag(IS_DELETED) || track.IsLocked() || this.filterItem(track)) continue;

        if (!aVia && track.Type() === KICAD_T.PCB_VIA_T) continue;

        if (!aTrack && (track.Type() === KICAD_T.PCB_TRACE_T || track.Type() === KICAD_T.PCB_ARC_T))
          continue;

        // Test if a track (or a via) endpoint is not connected to another track or zone.
        if (this.m_brd.GetConnectivity().TestTrackEndpointDangling(track, false)) {
          this.push(
            track.Type() === KICAD_T.PCB_VIA_T
              ? CLEANUP_RC_CODE.CLEANUP_DANGLING_VIA
              : CLEANUP_RC_CODE.CLEANUP_DANGLING_TRACK,
            track,
          );
          track.SetFlags(IS_DELETED);

          // keep iterating, because a track connected to the deleted track
          // now perhaps is not connected and should be deleted
          item_erased = true;

          if (!this.m_dryRun) {
            this.m_brd.Remove(track);
            this.m_commit.Removed(track);
            modified = true;
          }
        }
      }
    } while (item_erased); // A segment was erased: test for some new dangling segments

    return modified;
  }

  private deleteTracksInPads(): void {
    const toRemove = new Set<BOARD_ITEM>();

    // Delete tracks that start and end on the same pad
    const connectivity = this.m_brd.GetConnectivity();

    for (const track of this.m_brd.Tracks()) {
      if (track.IsLocked() || this.filterItem(track)) continue;

      if (track.Type() === KICAD_T.PCB_VIA_T) continue;

      // Mark track if connected to pads
      for (const pad of connectivity.GetConnectedPads(track)) {
        if (pad.HitTest(track.GetStart()) && pad.HitTest(track.GetEnd())) {
          const poly = new SHAPE_POLY_SET();
          track.TransformShapeToPolygon(
            poly,
            track.GetLayer(),
            0,
            track.GetMaxError(),
            ERROR_LOC.ERROR_INSIDE,
          );

          poly.BooleanSubtract(pad.GetEffectivePolygon(track.GetLayer(), ERROR_LOC.ERROR_INSIDE));

          if (poly.IsEmpty()) {
            this.push(CLEANUP_RC_CODE.CLEANUP_TRACK_IN_PAD, track);

            toRemove.add(track);
            track.SetFlags(IS_DELETED);
          }
        }
      }
    }

    if (!this.m_dryRun) this.removeItems(toRemove);
  }

  /** Geometry-based cleanup: duplicate items, null items, colinear items. */
  private cleanup(
    aDeleteDuplicateVias: boolean,
    aDeleteNullSegments: boolean,
    aDeleteDuplicateSegments: boolean,
    aMergeSegments: boolean,
  ): void {
    const rtree = new DRC_RTREE();

    for (const track of this.m_brd.Tracks()) {
      track.ClearFlags(IS_DELETED | SKIP_STRUCT);
      rtree.Insert(track, track.GetLayer());
    }

    const toRemove = new Set<BOARD_ITEM>();

    for (const track of this.m_brd.Tracks()) {
      if (track.HasFlag(IS_DELETED) || track.IsLocked() || this.filterItem(track)) continue;

      if (aDeleteDuplicateVias && track.Type() === KICAD_T.PCB_VIA_T) {
        const via = track as PCB_VIA;

        if (!equal(via.GetStart(), via.GetEnd())) via.SetEnd(via.GetStart());

        rtree.QueryCollidingItem(
          via,
          via.GetLayer(),
          via.GetLayer(),
          // Filter:
          (aItem) =>
            aItem.Type() === KICAD_T.PCB_VIA_T &&
            !aItem.HasFlag(SKIP_STRUCT) &&
            !aItem.HasFlag(IS_DELETED),
          // Visitor:
          (aItem) => {
            const other = aItem as PCB_VIA;

            if (
              equal(via.GetPosition(), other.GetPosition()) &&
              via.GetViaType() === other.GetViaType() &&
              via.GetLayerSet().equals(other.GetLayerSet())
            ) {
              this.push(CLEANUP_RC_CODE.CLEANUP_REDUNDANT_VIA, via);

              via.SetFlags(IS_DELETED);
              toRemove.add(via);
            }

            return true;
          },
        );

        // To delete through Via on THT pads at same location
        // Examine the list of connected pads: if a through pad is found, the via is redundant
        for (const pad of this.m_brd.GetConnectivity().GetConnectedPads(via)) {
          const all_cu = LSET.AllCuMask(this.m_brd.GetCopperLayerCount());

          if (pad.GetLayerSet().and(all_cu).equals(all_cu)) {
            this.push(CLEANUP_RC_CODE.CLEANUP_REDUNDANT_VIA, via, pad);

            via.SetFlags(IS_DELETED);
            toRemove.add(via);
            break;
          }
        }

        via.SetFlags(SKIP_STRUCT);
      }

      if (aDeleteNullSegments && track.Type() !== KICAD_T.PCB_VIA_T) {
        if (track.IsNull()) {
          this.push(CLEANUP_RC_CODE.CLEANUP_ZERO_LENGTH_TRACK, track);

          track.SetFlags(IS_DELETED);
          toRemove.add(track);
        }
      }

      if (aDeleteDuplicateSegments && track.Type() === KICAD_T.PCB_TRACE_T && !track.IsNull()) {
        rtree.QueryCollidingItem(
          track,
          track.GetLayer(),
          track.GetLayer(),
          // Filter:
          (aItem) =>
            aItem.Type() === KICAD_T.PCB_TRACE_T &&
            !aItem.HasFlag(SKIP_STRUCT) &&
            !aItem.HasFlag(IS_DELETED) &&
            !(aItem as PCB_TRACK).IsNull(),
          // Visitor:
          (aItem) => {
            const other = aItem as PCB_TRACK;

            if (
              track.IsPointOnEnds(other.GetStart()) &&
              track.IsPointOnEnds(other.GetEnd()) &&
              track.GetWidth() === other.GetWidth() &&
              track.GetLayer() === other.GetLayer()
            ) {
              this.push(CLEANUP_RC_CODE.CLEANUP_DUPLICATE_TRACK, track);

              track.SetFlags(IS_DELETED);
              toRemove.add(track);
            }

            return true;
          },
        );

        track.SetFlags(SKIP_STRUCT);
      }
    }

    if (!this.m_dryRun) this.removeItems(toRemove);

    const mergeSegments = (connectivity: CN_CONNECTIVITY_ALGO): boolean => {
      const tracksOf = this.m_brd.Tracks();

      this.m_order = new Map(tracksOf.map((t, i) => [t, i]));

      const before = (a: PCB_TRACK, b: PCB_TRACK): boolean =>
        (this.m_order.get(a) ?? Number.MAX_SAFE_INTEGER) <
        (this.m_order.get(b) ?? Number.MAX_SAFE_INTEGER);

      const track_loop = (aStart: number, aEnd: number): [PCB_TRACK, PCB_TRACK][] => {
        const tracks: [PCB_TRACK, PCB_TRACK][] = [];

        for (let ii = aStart; ii < aEnd; ++ii) {
          const segment = tracksOf[ii]!;

          // one can merge only collinear segments, not vias or arcs.
          if (segment.Type() !== KICAD_T.PCB_TRACE_T) continue;

          if (segment.HasFlag(IS_DELETED)) continue; // already taken into account

          if (this.filterItem(segment)) continue;

          // for each end of the segment:
          const cnItems = connectivity.ItemEntry(segment).GetItems();

          for (const citem of cnItems) {
            // Do not merge an end which has different width tracks attached -- it's a
            // common use-case for necking-down a track between pads.
            const sameWidthCandidates: PCB_TRACK[] = [];
            const differentWidthCandidates: PCB_TRACK[] = [];

            for (const connected of citem.ConnectedItems()) {
              if (!connected.Valid()) continue;

              const candidate = connected.Parent();

              if (
                candidate.Type() === KICAD_T.PCB_TRACE_T &&
                !candidate.HasFlag(IS_DELETED) &&
                !this.filterItem(candidate)
              ) {
                const candidateSegment = candidate as PCB_TRACK;

                if (candidateSegment.GetWidth() === segment.GetWidth()) {
                  sameWidthCandidates.push(candidateSegment);
                } else {
                  differentWidthCandidates.push(candidateSegment);
                  break;
                }
              }
            }

            if (differentWidthCandidates.length > 0) continue;

            for (const candidate of sameWidthCandidates) {
              if (before(candidate, segment)) continue; // avoid duplicate merges

              if (
                segment.ApproxCollinear(candidate) &&
                this.testMergeCollinearSegments(segment, candidate)
              ) {
                tracks.push([segment, candidate]);
                break;
              }
            }
          }
        }

        return tracks;
      };

      // Upstream submits the loop in blocks to the thread pool and applies the pairs
      // block by block; one block applies the same pairs in the same order.
      const merge_returns = [track_loop(0, tracksOf.length)];
      let retval = false;

      for (const ret of merge_returns) {
        for (const [seg1, seg2] of ret) {
          retval = true;

          if (seg1.HasFlag(IS_DELETED) || seg2.HasFlag(IS_DELETED)) continue;

          this.mergeCollinearSegments(seg1, seg2);
        }
      }

      return retval;
    };

    if (aMergeSegments) {
      do {
        while (!this.m_brd.BuildConnectivity()) {
          // wxSafeYield()
        }

        // BuildConnectivity adds items but doesn't establish connections between them.
        // RecalculateRatsnest triggers searchConnections which actually finds and links
        // connected items in the connectivity graph.
        this.m_brd.GetConnectivity().RecalculateRatsnest();

        this.m_connectedItemsCache.clear();
      } while (mergeSegments(this.m_brd.GetConnectivity().GetConnectivityAlgo()));
    }

    for (const track of this.m_brd.Tracks()) track.ClearFlags(IS_DELETED | SKIP_STRUCT);
  }

  private getConnectedItems(aTrack: PCB_TRACK): BOARD_CONNECTED_ITEM[] {
    const connectivity = this.m_brd.GetConnectivity();
    let items = this.m_connectedItemsCache.get(aTrack);

    if (!items) {
      items = connectivity.GetConnectedItems(aTrack);
      this.m_connectedItemsCache.set(aTrack, items);
    }

    return items;
  }

  /**
   * Test if 2 segments are colinear and can be merged. Does not modify the connectivity.
   * @param aSeg1 the reference
   * @param aSeg2 the candidate
   * @param aDummySeg receives the merged segment's ends
   */
  private testMergeCollinearSegments(
    aSeg1: PCB_TRACK,
    aSeg2: PCB_TRACK,
    aDummySeg: PCB_TRACK | null = null,
  ): boolean {
    if (aSeg1.IsLocked() || aSeg2.IsLocked()) return false;

    // Collect the unique points where the two tracks are connected to other items
    const p1s = 1 << 0;
    const p1e = 1 << 1;
    const p2s = 1 << 2;
    const p2e = 1 << 3;
    const pts: VECTOR2I[] = [aSeg1.GetStart(), aSeg1.GetEnd(), aSeg2.GetStart(), aSeg2.GetEnd()];
    let flags = 0;

    const collectPts = (
      aSeg: PCB_TRACK,
      ps: number,
      pe: number,
      citem: BOARD_CONNECTED_ITEM,
    ): void => {
      if (popcount(flags) > 2) return;

      if (
        citem.Type() === KICAD_T.PCB_TRACE_T ||
        citem.Type() === KICAD_T.PCB_ARC_T ||
        citem.Type() === KICAD_T.PCB_VIA_T
      ) {
        const track = citem as PCB_TRACK;

        if (track.IsPointOnEnds(aSeg.GetStart())) flags |= ps;

        if (track.IsPointOnEnds(aSeg.GetEnd())) flags |= pe;
      } else {
        const half = Math.trunc((aSeg.GetWidth() + 1) / 2);

        if (!(flags & ps) && citem.HitTest(aSeg.GetStart(), half)) flags |= ps;

        if (!(flags & pe) && citem.HitTest(aSeg.GetEnd(), half)) flags |= pe;
      }
    };

    for (const item of this.getConnectedItems(aSeg1)) {
      if (item.HasFlag(IS_DELETED)) continue;

      if (item !== aSeg1 && item !== aSeg2) collectPts(aSeg1, p1s, p1e, item);
    }

    for (const item of this.getConnectedItems(aSeg2)) {
      if (item.HasFlag(IS_DELETED)) continue;

      if (item !== aSeg1 && item !== aSeg2) collectPts(aSeg2, p2s, p2e, item);
    }

    // This means there is a node in the center
    if (popcount(flags) > 2) return false;

    // Verify the removed point after merging is not a node.
    // If it is a node (i.e. if more than one other item is connected, the segments cannot be merged
    const dummy_seg = aDummySeg ?? PCB_TRACK.copyOf(aSeg1);

    // Calculate the new ends of the segment to merge, and store them to dummy_seg:
    const min_x = Math.min(
      aSeg1.GetStart().x,
      aSeg1.GetEnd().x,
      aSeg2.GetStart().x,
      aSeg2.GetEnd().x,
    );
    const min_y = Math.min(
      aSeg1.GetStart().y,
      aSeg1.GetEnd().y,
      aSeg2.GetStart().y,
      aSeg2.GetEnd().y,
    );
    const max_x = Math.max(
      aSeg1.GetStart().x,
      aSeg1.GetEnd().x,
      aSeg2.GetStart().x,
      aSeg2.GetEnd().x,
    );
    const max_y = Math.max(
      aSeg1.GetStart().y,
      aSeg1.GetEnd().y,
      aSeg2.GetStart().y,
      aSeg2.GetEnd().y,
    );

    if (aSeg1.GetStart().x > aSeg1.GetEnd().x === aSeg1.GetStart().y > aSeg1.GetEnd().y) {
      dummy_seg.SetStart({ x: min_x, y: min_y });
      dummy_seg.SetEnd({ x: max_x, y: max_y });
    } else {
      dummy_seg.SetStart({ x: min_x, y: max_y });
      dummy_seg.SetEnd({ x: max_x, y: min_y });
    }

    // The new ends of the segment must be connected to all of the same points as the original
    // segments.  If not, the segments cannot be merged.
    for (let i = 0; i < 4; ++i) {
      if (flags & (1 << i) && !dummy_seg.IsPointOnEnds(pts[i]!)) return false;
    }

    // Now find the removed end(s) and stop merging if it is a node:
    return !this.testTrackEndpointIsNode(
      aSeg1,
      dummy_seg.IsPointOnEnds(aSeg1.GetStart()) !== 0,
      dummy_seg.IsPointOnEnds(aSeg1.GetEnd()) !== 0,
    );
  }

  /**
   * Merge aSeg1 and aSeg2 when they are colinear, same width, and same layer.
   * @param aSeg1 the reference
   * @param aSeg2 the candidate, and after merging, the removed segment
   * @return true if the segments are merged
   */
  private mergeCollinearSegments(aSeg1: PCB_TRACK, aSeg2: PCB_TRACK): boolean {
    const dummy_seg = PCB_TRACK.copyOf(aSeg1);

    if (!this.testMergeCollinearSegments(aSeg1, aSeg2, dummy_seg)) return false;

    this.push(CLEANUP_RC_CODE.CLEANUP_MERGE_TRACKS, aSeg1, aSeg2);

    aSeg2.SetFlags(IS_DELETED);

    if (!this.m_dryRun) {
      this.m_commit.Modify(aSeg1);

      // `*aSeg1 = dummy_seg`
      aSeg1.assignTrack(dummy_seg);

      this.m_brd.GetConnectivity().Update(aSeg1);

      // Merge successful, seg2 has to go away
      this.m_brd.Remove(aSeg2);
      this.m_commit.Removed(aSeg2);
    }

    return true;
  }

  private removeItems(aItems: Set<BOARD_ITEM>): void {
    for (const item of aItems) {
      this.m_brd.Remove(item);
      this.m_commit.Removed(item);
    }
  }
}
