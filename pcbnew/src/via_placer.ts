// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DRAWING_TOOL::DrawVia`'s `VIA_PLACER` — the Place Vias tool.
 * Counterpart: `pcbnew/tools/drawing_tool.cpp:3686-4412`.
 *
 * The tool looks like "drop a circle where you clicked", and the two things it
 * actually does are neither of those:
 *
 * - **it picks the net up in a fixed order** — the track under it, then a pad,
 *   then a filled graphic that has a net, and only then the zone it is
 *   stitching (`PlaceItem`, `:4285-4318`). A via placed on a track takes the
 *   *track's* net even when a zone of another net is under it too.
 * - **it BREAKS the track it lands on.** A via strictly inside a segment
 *   shortens that segment to the via and adds a second one from the via to the
 *   old end (`:4340-4361`). Without it the board still holds one continuous
 *   track through the via, so the router cannot attach to it and dragging
 *   either end moves the whole thing.
 *
 * The split is skipped when the via lands exactly on an end — there is nothing
 * to break — and when the user held Shift, because "if the user explicitly
 * disables snap … then don't break the tracks. This will prevent PNS from
 * being able to connect the via and track but it is explicitly requested".
 *
 * This lives in `pcbnew/` rather than in the canvas because it is board
 * surgery: the caller supplies the click, and what comes back is a board.
 */

import { newKiid } from '@ziroeda/common/src/kiid.js';
import type { Board, PcbTrack, PcbVia } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { segNearestPoint } from '@ziroeda/kimath/src/geometry/seg.js';
import { TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';

/** `findTrack`'s answer: the index of the track a via at `at` would attach to. */
export function trackUnderVia(
  board: Board,
  at: Vec2,
  layers: readonly string[],
  viaWidth: number,
): number | null {
  let best: number | null = null;
  let minDist = Number.POSITIVE_INFINITY;

  board.tracks.forEach((track, i) => {
    if (!layers.includes(track.layer)) return;

    // `TestSegmentHit( aPosition, start, end, ( track width + via width ) / 2 )`.
    if (!TestSegmentHit(at, track.start, track.end, (track.width + viaWidth) / 2)) return;

    // "for( PCB_TRACK* track : possible_tracks )" — the NEAREST wins, measured
    // to the segment rather than to either end.
    const near = segNearestPoint({ a: track.start, b: track.end }, at);
    const dist = Math.hypot(near.x - at.x, near.y - at.y);

    if (dist < minDist) {
      minDist = dist;
      best = i;
    }
  });

  return best;
}

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * `SEG::Contains( aVia )` for the split test: the via has to be ON the segment,
 * not merely near it.
 *
 * Upstream's `trackSeg.Contains( viaPos )` is `SquaredDistance <= 3`, i.e. an
 * exact-ish hit in internal units — the via position has already been snapped
 * onto the segment by `SnapItem`'s `AlignToSegment`, so this is asking "did the
 * snap actually land", not "is it close enough".
 */
function onSegment(track: PcbTrack, at: Vec2): boolean {
  const near = segNearestPoint({ a: track.start, b: track.end }, at);
  const dx = near.x - at.x;
  const dy = near.y - at.y;
  return dx * dx + dy * dy <= 3;
}

export interface PlaceViaResult {
  board: Board;
  /** The id the caller selects, as `commit.Add( via )` then hands over. */
  viaId: string;
  /** Whether the track under the via was broken in two. */
  splitTrack: boolean;
}

/**
 * `VIA_PLACER::PlaceItem` — add the via, take the net from what is underneath,
 * and break the track it landed on.
 *
 * `allowSplit` is `m_gridHelper.GetSnap()`, which Shift turns off.
 */
export function placeVia(
  board: Board,
  via: PcbVia,
  opts: { allowSplit?: boolean } = {},
): PlaceViaResult {
  const allowSplit = opts.allowSplit !== false;
  const viaId = `via:${board.vias.length}`;

  const idx = trackUnderVia(board, via.at, via.layers, via.size);
  const track = idx === null ? null : board.tracks[idx];

  const noSplit = (): PlaceViaResult => ({
    board: { ...board, vias: [...board.vias, via] },
    viaId,
    splitTrack: false,
  });

  if (!allowSplit || !track) return noSplit();
  // "if( viaPos == trackStart || viaPos == trackEnd ) return true;" — landing on
  // an end attaches to the track without breaking it.
  if (same(via.at, track.start) || same(via.at, track.end)) return noSplit();
  if (!onSegment(track, via.at)) return noSplit();

  // `aCommit.Modify( track )` shortens it, and a CLONE carries every other
  // property — width, layer, net, mask opening, locked — to the far half. Only
  // the uuid is reissued (`const_cast<KIID&>( newTrack->m_Uuid ) = KIID()`).
  const nearHalf: PcbTrack = { ...track, end: { x: via.at.x, y: via.at.y } };
  const farHalf: PcbTrack = {
    ...track,
    start: { x: via.at.x, y: via.at.y },
    uuid: newKiid(),
  };

  const tracks = [...board.tracks];
  tracks[idx!] = nearHalf;
  tracks.push(farHalf);

  return {
    board: { ...board, tracks, vias: [...board.vias, via] },
    viaId,
    splitTrack: true,
  };
}
