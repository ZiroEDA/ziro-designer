// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board connectivity: which track/arc endpoints attach to which pads/vias.
 *
 * A minimal port of the piece of pcbnew's CONNECTIVITY_DATA the interactive
 * editor needs first, enough to answer "when this footprint moves, which track
 * ends should move with it?" (EDIT_TOOL's drag vs. move). KiCad decides two
 * copper items touch when they share a net and their shapes overlap
 * (CN_VISITOR::operator()); here a track end attaches to a pad when its end cap
 * touches the pad's copper on a shared net, which is what a drag needs to keep
 * the routing rubber-banded to the part.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { padShapes } from './drc/drc_engine.js';
import { shapeDist, type Shape } from './drc/drc_geometry.js';
import type { Board } from './types.js';

/** A specific end of a track or arc segment. */
export interface TrackEndRef {
  kind: 'track' | 'arc';
  index: number;
  end: 'start' | 'end';
}

/** A pad and the copper shapes it is collided by (padShapes is not cheap). */
interface PadCopper {
  net: number;
  shapes: Shape[];
}

/**
 * Does a track end at `pt`, `width` wide, touch this pad's copper? The end cap ,
 * a disc of half the track width, as SHAPE_SEGMENT's cap is, is collided against
 * the pad's real shape, so a route ending on the edge of an oblong or rotated pad
 * counts and one that merely passes near it does not.
 */
function endOnPad(pt: Vec2, width: number, pad: PadCopper): boolean {
  const cap: Shape = { kind: 'circle', c: pt, r: width / 2 };
  return pad.shapes.some((s) => shapeDist(cap, s) <= 0);
}

/** The copper of every pad of the given footprints. */
function movingPads(board: Board, footprintIdx: ReadonlySet<number>): PadCopper[] {
  const pads: PadCopper[] = [];
  for (const i of footprintIdx) {
    const fp = board.footprints[i];
    if (!fp) continue;
    for (const pad of fp.pads) pads.push({ net: pad.net ?? -1, shapes: padShapes(pad) });
  }
  return pads;
}

/**
 * Track/arc endpoints attached (same net + on-pad) to any pad of the given
 * footprints, the ends a drag should carry so the routing stretches with the
 * part. A track selected in its own right is the caller's concern; this only
 * reports the attachment geometry.
 */
export function connectedTrackEnds(board: Board, footprintIdx: ReadonlySet<number>): TrackEndRef[] {
  const pads = movingPads(board, footprintIdx);
  if (pads.length === 0) return [];

  const out: TrackEndRef[] = [];
  const attach = (
    pt: Vec2,
    width: number,
    net: number,
    kind: 'track' | 'arc',
    index: number,
    end: 'start' | 'end',
  ): void => {
    for (const pad of pads) {
      if (pad.net !== net) continue;
      if (endOnPad(pt, width, pad)) {
        out.push({ kind, index, end });
        return;
      }
    }
  };

  board.tracks.forEach((t, i) => {
    attach(t.start, t.width, t.net, 'track', i, 'start');
    attach(t.end, t.width, t.net, 'track', i, 'end');
  });
  board.arcs.forEach((a, i) => {
    attach(a.start, a.width, a.net, 'arc', i, 'start');
    attach(a.end, a.width, a.net, 'arc', i, 'end');
  });
  return out;
}
