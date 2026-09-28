// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Automatically select track width" — `PNS_KICAD_IFACE_BASE::inheritTrackWidth`
 * (`pcbnew/router/pns_kicad_iface.cpp:982-1096`).
 *
 * The width a new route takes when it starts on something that already exists,
 * instead of the width the toolbar is showing. `ImportSizes` consults it only
 * under the toggle (:1146):
 *
 *     if( bds.m_UseConnectedTrackWidth && !bds.m_TempOverrideTrackWidth && aStartItem != nullptr )
 *     {
 *         found = inheritTrackWidth( aStartItem, &trackWidth, startPosInt );
 *
 *         if( found )
 *             aSizes.SetWidthSource( _( "existing track" ) );
 *     }
 *
 * so this answers null whenever upstream leaves `found` false and the netclass /
 * current width takes over.
 *
 * The three branches, in upstream's order:
 *
 *   1. The start item is itself a segment or an arc — take its own width
 *      (`tryGetTrackWidth`, :989-1006). This is the branch that fires when you
 *      begin a route by clicking on a trace.
 *   2. The start item is a via or a pad — look at the tracks meeting it. With a
 *      cursor position, take the one whose *far* end is nearest the cursor,
 *      "since all tracks share the pad/via endpoint, the far-end direction is a
 *      proxy for which exit stub the user is pointing at" (:1025-1027).
 *   3. Otherwise the narrowest track at that joint: the narrowest on the start
 *      layer if any is on it, else the narrowest on any layer (:1070-1093).
 *
 * A `PNS::JOINT` is "the links at this point", which without a PNS node is the
 * tracks and arcs with an endpoint there — the same set, since a joint is built
 * from exactly those endpoints.
 */

import type { Board, PcbArcTrack, PcbTrack } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** A track or arc at a joint, reduced to what the three branches read. */
interface Linked {
  width: number;
  layer: string;
  start: Vec2;
  end: Vec2;
}

const sqDist = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * What the route is starting from, as `ImportSizes` knows it.
 *
 * `kind` is `PNS::ITEM::Kind()`: a segment or arc answers branch 1, a via or a
 * pad (a `SOLID_T`) answers branches 2 and 3, and anything else is not a start
 * item at all.
 */
export interface TrackWidthStartItem {
  kind: 'track' | 'arc' | 'via' | 'pad';
  /** The item's own width — segments and arcs only. */
  width?: number;
  /** `aItem->Pos()`, the via or pad centre the joint is at. */
  at: Vec2;
}

/**
 * The inherited width in internal units, or null when nothing can be inherited.
 *
 * `aCursor` is `aStartPosition`; upstream skips branch 2 when it is the default
 * `VECTOR2I()`, so pass null for "no cursor" rather than the origin, which is a
 * real board coordinate here.
 */
export function inheritTrackWidth(
  aBoard: Board,
  aItem: TrackWidthStartItem,
  aStartLayer: string,
  aCursor: Vec2 | null,
): number | null {
  // 1. `int itemTrackWidth = tryGetTrackWidth( aItem ); if( itemTrackWidth > 0 )`
  if ((aItem.kind === 'track' || aItem.kind === 'arc') && (aItem.width ?? 0) > 0)
    return aItem.width as number;

  // `default: return false` — only a via or a pad reaches the joint branches.
  if (aItem.kind !== 'via' && aItem.kind !== 'pad') return null;

  const p = aItem.at;
  const linked: Linked[] = [];

  const add = (t: PcbTrack | PcbArcTrack): void => {
    if (t.width > 0 && (same(t.start, p) || same(t.end, p)))
      linked.push({ width: t.width, layer: t.layer, start: t.start, end: t.end });
  };

  for (const t of aBoard.tracks) add(t);
  for (const a of aBoard.arcs) add(a);

  // `if( linkedSegs.Empty() ) return false;`
  if (linked.length === 0) return null;

  // 2. The exit stub the cursor is pointing at, on the start layer only.
  if (aCursor) {
    let closest: Linked | null = null;
    let minDist = Number.POSITIVE_INFINITY;

    for (const li of linked) {
      if (li.layer !== aStartLayer) continue;

      // "The 'other end' is the anchor farther from the pad/via center".
      const other = sqDist(li.start, p) > sqDist(li.end, p) ? li.start : li.end;
      const d = sqDist(other, aCursor);

      if (d < minDist) {
        minDist = d;
        closest = li;
      }
    }

    if (closest) return closest.width;
  }

  // 3. "Fallback to minimum width when no start position provided or no valid
  //    exit stub found" — the start layer's narrowest, else any layer's.
  let minCurrentLayer = Number.POSITIVE_INFINITY;
  let minAllLayers = Number.POSITIVE_INFINITY;

  for (const li of linked) {
    minAllLayers = Math.min(li.width, minAllLayers);
    if (li.layer === aStartLayer) minCurrentLayer = Math.min(li.width, minCurrentLayer);
  }

  if (minAllLayers === Number.POSITIVE_INFINITY) return null;

  return minCurrentLayer < Number.POSITIVE_INFINITY ? minCurrentLayer : minAllLayers;
}
