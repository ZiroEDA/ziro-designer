// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RENDER_3D_RAYTRACE_BASE::IntersectBoardItem` (render_3d_raytrace_base.cpp
 * :1771) and what `EDA_3D_CANVAS` makes of the answer — the HOVERED_ITEM
 * message (eda_3d_canvas.cpp:985-1078) and the click that cross-probes
 * (:1129-1163).
 *
 * Upstream shoots the mouse ray into the ray tracer's BVH, which holds every
 * layer item (pad, track, via, zone fill — each carrying its `BOARD_ITEM`)
 * and every model triangle (carrying its `FOOTPRINT`). Nothing in a WebGL
 * rasteriser answers that, so the ray is met the other way round: the 3D
 * models are tested by the caller (a mesh raycast), and the board items are
 * found by dropping the ray onto the two outer copper faces and asking the
 * pcbnew polygon ports which item covers that point. The nearer hit along
 * the ray wins, as in the BVH.
 *
 * Only copper items produce a message; silk, mask and body do not
 * (`default: break`). A footprint's field (its reference text) counts as
 * the footprint for the click but says nothing on hover — left out.
 */
import type { Board } from '@ziroeda/pcbnew';
import { ARC_HIGH_DEF } from '@ziroeda/common/src/eda_units.js';
import { escapeIpc } from '@ziroeda/common/src/string_utils.js';
import { chainPointInside } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { padIsOnLayer } from '@ziroeda/pcbnew/src/pad_enumerate.js';
import {
  ErrorLoc,
  arcTrackTransformShapeToPolygon,
  padTransformHoleToPolygon,
  padTransformShapeToPolygon,
} from '@ziroeda/pcbnew/src/transform_shape_to_polygon.js';
import type { Vec3 } from './camera3d.js';

export type PickedItem =
  | { kind: 'footprint'; footprint: number }
  | { kind: 'pad'; footprint: number; pad: number }
  | { kind: 'track'; track: number }
  | { kind: 'arc'; arc: number }
  | { kind: 'via'; via: number }
  | { kind: 'zone'; zone: number; layer: string };

export interface PickFrame {
  /** `BiuTo3dUnits()`. */
  scale: number;
  /** The outer copper faces the ray is dropped onto, 3D units. */
  zTopFront: number;
  zBottomBack: number;
  /**
   * `GetBoardPoly()`'s outer rings, IU. The board body and the mask are in
   * the BVH too, carrying no item: a ray that lands on the board stops
   * there whether or not a copper item is under it. Only off the board does
   * it carry on to the far face.
   */
  boardOutline: readonly (readonly Vec2[])[];
}

/** The point on the plane `z = planeZ` along the ray, with its parameter, or null. */
function hitPlane(
  origin: Vec3,
  dir: Vec3,
  planeZ: number,
): { t: number; x: number; y: number } | null {
  if (Math.abs(dir[2]) < 1e-12) return null;
  const t = (planeZ - origin[2]) / dir[2];
  if (t < 0) return null;
  return { t, x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t };
}

/** `SEG::Distance`-style point-to-segment distance. */
function segDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The copper item under a board point on one outer layer, or null. */
export function boardItemAt(board: Board, pt: Vec2, layer: 'F.Cu' | 'B.Cu'): PickedItem | null {
  // Pads first: they sit on top of the layer's other items (drawn last, and
  // the BVH's nearest hit is the pad's top face).
  for (let fi = 0; fi < board.footprints.length; fi++) {
    const fp = board.footprints[fi]!;
    for (let pi = 0; pi < fp.pads.length; pi++) {
      const pad = fp.pads[pi]!;
      if (!padIsOnLayer(pad, layer)) continue;
      const shape = padTransformShapeToPolygon(pad, 0, ARC_HIGH_DEF, ErrorLoc.ERROR_INSIDE);
      if (!shape.some((poly) => poly[0] && chainPointInside(poly[0], pt))) continue;
      // through the drill there is nothing to hit
      const hole = padTransformHoleToPolygon(pad, 0, ARC_HIGH_DEF, ErrorLoc.ERROR_INSIDE);
      if (hole.some((poly) => poly[0] && chainPointInside(poly[0], pt))) return null;
      return { kind: 'pad', footprint: fi, pad: pi };
    }
  }
  for (let i = 0; i < board.vias.length; i++) {
    const v = board.vias[i]!;
    const on = v.kind === 'through' || v.layers[0] === layer || v.layers[1] === layer;
    if (!on) continue;
    const d = Math.hypot(pt.x - v.at.x, pt.y - v.at.y);
    if (d < v.drill / 2) return null;
    if (d <= v.size / 2) return { kind: 'via', via: i };
  }
  for (let i = 0; i < board.tracks.length; i++) {
    const t = board.tracks[i]!;
    if (t.layer !== layer) continue;
    if (segDistance(pt, t.start, t.end) <= t.width / 2) return { kind: 'track', track: i };
  }
  for (let i = 0; i < board.arcs.length; i++) {
    const a = board.arcs[i]!;
    if (a.layer !== layer) continue;
    const polys = arcTrackTransformShapeToPolygon(a, 0, ARC_HIGH_DEF, ErrorLoc.ERROR_INSIDE);
    if (polys.some((poly) => poly[0] && chainPointInside(poly[0], pt)))
      return { kind: 'arc', arc: i };
  }
  for (let zi = 0; zi < board.zones.length; zi++) {
    const z = board.zones[zi]!;
    for (const f of z.fills) {
      if (f.layer !== layer) continue;
      if (f.polys.some((ring) => chainPointInside(ring, pt)))
        return { kind: 'zone', zone: zi, layer };
    }
  }
  return null;
}

/**
 * The nearest of: a model hit the caller already found (`modelHit`, with its
 * ray parameter and footprint index), and the copper item under the ray on
 * whichever outer face it reaches first.
 */
export function pickBoardItem(
  board: Board,
  frame: PickFrame,
  origin: Vec3,
  dir: Vec3,
  modelHit: { t: number; footprint: number } | null,
): PickedItem | null {
  const planes: { z: number; layer: 'F.Cu' | 'B.Cu' }[] = [
    { z: frame.zTopFront, layer: 'F.Cu' },
    { z: frame.zBottomBack, layer: 'B.Cu' },
  ];
  const hits = planes
    .map((p) => ({ p, h: hitPlane(origin, dir, p.z) }))
    .filter(
      (x): x is { p: (typeof planes)[number]; h: NonNullable<ReturnType<typeof hitPlane>> } =>
        x.h !== null,
    )
    .sort((a, b) => a.h.t - b.h.t);
  for (const { p, h } of hits) {
    // 3D units → board IU, y un-flipped
    const pt = { x: h.x / frame.scale, y: -h.y / frame.scale };
    const onBoard = frame.boardOutline.some((ring) => chainPointInside(ring, pt));
    if (!onBoard) continue;
    // the board (or a model in front of it) is what the ray meets first
    if (modelHit && modelHit.t < h.t) return { kind: 'footprint', footprint: modelHit.footprint };
    return boardItemAt(board, pt, p.layer);
  }
  return modelHit ? { kind: 'footprint', footprint: modelHit.footprint } : null;
}

/** `printNetInfo`: `_( "Net %s\tNet class %s" )`. */
const netInfo = (board: Board, net: number, netClassOf: (net: number) => string): string =>
  `Net ${board.nets.get(net) ?? ''}\tNet class ${netClassOf(net)}`;

/**
 * The HOVERED_ITEM text for a hit (eda_3d_canvas.cpp:1010-1067). Empty for
 * an item with no message, and for none.
 */
export function hoveredItemMessage(
  board: Board,
  item: PickedItem | null,
  netClassOf: (net: number) => string,
): string {
  if (!item) return '';
  switch (item.kind) {
    case 'pad': {
      const fp = board.footprints[item.footprint]!;
      const pad = fp.pads[item.pad]!;
      let msg = '';
      if (pad.number) msg += `Pad ${pad.number}\t`;
      // `IsOnCopperLayer()`
      if (pad.layers.some((l) => /\.Cu$/.test(l))) msg += netInfo(board, pad.net ?? 0, netClassOf);
      return msg;
    }
    case 'footprint': {
      const fp = board.footprints[item.footprint]!;
      return `${fp.reference ?? ''}  ${fp.value ?? ''}`;
    }
    case 'track':
      return netInfo(board, board.tracks[item.track]!.net, netClassOf);
    case 'arc':
      return netInfo(board, board.arcs[item.arc]!.net, netClassOf);
    case 'via':
      return netInfo(board, board.vias[item.via]!.net, netClassOf);
    case 'zone': {
      const z = board.zones[item.zone]!;
      let msg = '';
      if (z.name) msg += z.ruleArea ? `Rule area ${z.name}\t` : `Zone ${z.name}\t`;
      if (/\.Cu$/.test(item.layer)) msg += netInfo(board, z.net, netClassOf);
      return msg;
    }
  }
}

/**
 * `OnLeftUp`'s cross-probe: the `$SELECT: 0,F<ref>` parts for a click — the
 * footprint of a footprint/pad hit, nothing for anything else (which clears
 * the selection: an empty `$SELECT` is "select nothing").
 */
export function clickSelectionParts(board: Board, item: PickedItem | null): string[] {
  if (!item) return [];
  if (item.kind !== 'footprint' && item.kind !== 'pad') return [];
  const fp = board.footprints[item.footprint]!;
  return [`F${escapeIpc(fp.reference ?? '')}`];
}
