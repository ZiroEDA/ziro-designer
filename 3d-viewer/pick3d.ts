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
import { ARC_HIGH_DEF } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { escapeIpc, unescapeString } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { chainPointInside } from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_CONNECTED_ITEM } from '@ziroeda/pcbnew/board_connected_item.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import type { PCB_ARC, PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import type { Vec3 } from './camera3d.js';

export type PickedItem =
  /** By index into `Footprints()`, which is how the model meshes are keyed. */
  | { kind: 'footprint'; footprint: number }
  | { kind: 'pad'; footprint: number; pad: PAD }
  | { kind: 'track'; track: PCB_TRACK }
  | { kind: 'arc'; arc: PCB_ARC }
  | { kind: 'via'; via: PCB_VIA }
  | { kind: 'zone'; zone: ZONE; layer: string };

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
export function boardItemAt(aBoard: BOARD, pt: Vec2, layer: 'F.Cu' | 'B.Cu'): PickedItem | null {
  const layerId = layer === 'F.Cu' ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu;
  const inside = (aFill: (aSet: SHAPE_POLY_SET) => unknown): boolean => {
    const set = new SHAPE_POLY_SET();
    aFill(set);
    return set.Contains(pt);
  };

  // Pads first: they sit on top of the layer's other items (drawn last, and
  // the BVH's nearest hit is the pad's top face).
  const footprints = aBoard.Footprints();

  for (let fi = 0; fi < footprints.length; fi++) {
    for (const pad of footprints[fi]!.Pads()) {
      if (!pad.IsOnLayer(layerId)) continue;

      if (
        !inside((set) =>
          pad.TransformShapeToPolygon(set, layerId, 0, ARC_HIGH_DEF, ERROR_LOC.ERROR_INSIDE),
        )
      )
        continue;

      // through the drill there is nothing to hit
      if (inside((set) => pad.TransformHoleToPolygon(set, 0, ARC_HIGH_DEF, ERROR_LOC.ERROR_INSIDE)))
        return null;

      return { kind: 'pad', footprint: fi, pad };
    }
  }

  const tracks = aBoard.Tracks();

  for (const t of tracks) {
    if (t.Type() !== KICAD_T.PCB_VIA_T) continue;

    const v = t as PCB_VIA;

    if (!v.IsOnLayer(layerId)) continue;

    const d = Math.hypot(pt.x - v.GetStart().x, pt.y - v.GetStart().y);

    if (d < v.GetDrillValue() / 2) return null;

    if (d <= v.GetWidth(layerId) / 2) return { kind: 'via', via: v };
  }

  for (const t of tracks) {
    if (t.Type() !== KICAD_T.PCB_TRACE_T || t.GetLayer() !== layerId) continue;

    if (segDistance(pt, t.GetStart(), t.GetEnd()) <= t.GetWidth() / 2)
      return { kind: 'track', track: t };
  }

  for (const t of tracks) {
    if (t.Type() !== KICAD_T.PCB_ARC_T || t.GetLayer() !== layerId) continue;

    if (
      inside((set) =>
        t.TransformShapeToPolygon(set, layerId, 0, ARC_HIGH_DEF, ERROR_LOC.ERROR_INSIDE),
      )
    )
      return { kind: 'arc', arc: t as PCB_ARC };
  }

  for (const z of aBoard.Zones()) {
    if (!z.IsOnLayer(layerId)) continue;

    if (z.GetFilledPolysList(layerId).Contains(pt)) return { kind: 'zone', zone: z, layer };
  }

  return null;
}

export function pickBoardItem(
  board: BOARD,
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
    // 3D units → board IU, y un-flipped. Rounded: the polygon ports are the
    // integer-IU ones (`chainPointInside` goes through BigInt) and a ray hit
    // is a float; a nanometre is well inside any pad.
    const pt = { x: Math.round(h.x / frame.scale), y: Math.round(-h.y / frame.scale) };
    const onBoard = frame.boardOutline.some((ring) => chainPointInside(ring, pt));
    if (!onBoard) continue;
    // the board (or a model in front of it) is what the ray meets first
    if (modelHit && modelHit.t < h.t) return { kind: 'footprint', footprint: modelHit.footprint };
    return boardItemAt(board, pt, p.layer);
  }
  return modelHit ? { kind: 'footprint', footprint: modelHit.footprint } : null;
}

/**
 * `printNetInfo` (eda_3d_canvas.cpp:992-997): `_( "Net %s\tNet class %s" )`
 * over `aItem->GetNet()->GetNetname()` and the net's own
 * `GetNetClass()->GetHumanReadableName()`.
 */
const netInfo = (aItem: BOARD_CONNECTED_ITEM): string =>
  `Net ${unescapeString(aItem.GetNetname())}\tNet class ${aItem.GetNet()?.GetNetClass().GetHumanReadableName() ?? ''}`;

export function hoveredItemMessage(aBoard: BOARD, item: PickedItem | null): string {
  if (!item) return '';

  switch (item.kind) {
    case 'pad': {
      const pad = item.pad;
      let msg = '';

      if (pad.GetNumber()) msg += `Pad ${pad.GetNumber()}\t`;

      if (pad.IsOnCopperLayer()) msg += netInfo(pad);

      return msg;
    }

    case 'footprint': {
      const fp = aBoard.Footprints()[item.footprint]!;
      return `${fp.GetReference()}  ${fp.GetValue()}`;
    }

    case 'track':
      return netInfo(item.track);

    case 'arc':
      return netInfo(item.arc);

    case 'via':
      return netInfo(item.via);

    case 'zone': {
      const z = item.zone;
      let msg = '';

      if (z.GetZoneName())
        msg += z.GetIsRuleArea() ? `Rule area ${z.GetZoneName()}\t` : `Zone ${z.GetZoneName()}\t`;

      if (/\.Cu$/.test(item.layer)) msg += netInfo(z);

      return msg;
    }
  }
}

export function clickSelectionParts(aBoard: BOARD, item: PickedItem | null): string[] {
  if (!item) return [];

  if (item.kind !== 'footprint' && item.kind !== 'pad') return [];

  const fp = aBoard.Footprints()[item.footprint]!;
  return [`F${escapeIpc(fp.GetReference())}`];
}
