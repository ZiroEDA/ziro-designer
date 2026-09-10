// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_ITEM::TransformShapeToPolygon` for the items a zone knocks out —
 * `PAD::TransformShapeToPolygon` / `TransformHoleToPolygon` (pad.cpp:2592-2711),
 * `PCB_TRACK::TransformShapeToPolygon` (pcb_track.cpp:2827) and
 * `EDA_SHAPE::TransformShapeToPolygon` (eda_shape.cpp:2494) — vertex for
 * vertex, on the kimath ports of `convert_basic_shapes_to_polygon.cpp`.
 *
 * Every function returns what `aBuffer.Append( … )` would have added: a list
 * of polygons, each an outline followed by its holes, in the order KiCad
 * appends them.
 */

import {
  ErrorLoc,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
  transformArcToPolygon,
  transformCircleToPolygonSet,
  transformOvalToPolygon,
  transformRingToPolygon,
  transformRoundChamferedRectToPolygon,
  transformTrapezoidToPolygon,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  booleanAdd,
  CornerStrategy,
  fracture,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { hypot } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { segmentsForRadius } from './convert_basic_shapes_to_polygon.js';
import { padShapePos } from './padstack.js';
import { isSolidFill } from './shape_fill.js';
import type { PadPrimitive, PcbArcTrack, PcbPad, PcbShape, PcbTrack, PcbVia } from './types.js';

export { ErrorLoc };

/** `SHAPE_POLY_SET::Inflate( aAmount, aCornerStrategy, aMaxError )`. */
const inflateKi = (
  polys: Polygon[],
  amount: number,
  strategy: CornerStrategy,
  maxError: number,
): Polygon[] => inflate(polys, amount, strategy, segmentsForRadius(Math.abs(amount), maxError));

/** `VECTOR2<double>::EuclideanNorm` of an integer difference, `Distance`. */
function distance(a: Vec2, b: Vec2): number {
  const x = b.x - a.x;
  const y = b.y - a.y;
  if (Math.abs(x) === Math.abs(y)) return Math.abs(x) * Math.SQRT2;
  if (x === 0) return Math.abs(y);
  if (y === 0) return Math.abs(x);
  return hypot(x, y);
}

/** `PADSTACK::ChamferPositions`: the four `(chamfer …)` tokens as the bit set. */
function chamferPositions(pad: PcbPad): number {
  let bits = 0;
  for (const c of pad.chamfer ?? []) {
    if (c === 'top_left') bits |= RECT_CHAMFER_TOP_LEFT;
    else if (c === 'top_right') bits |= RECT_CHAMFER_TOP_RIGHT;
    else if (c === 'bottom_left') bits |= RECT_CHAMFER_BOTTOM_LEFT;
    else if (c === 'bottom_right') bits |= RECT_CHAMFER_BOTTOM_RIGHT;
  }
  return bits;
}

/** `PAD::GetShape`: the file's `roundrect` is CHAMFERED_RECT when it chamfers. */
function padShapeKind(pad: PcbPad): PcbPad['shape'] | 'chamfered' {
  if (pad.shape === 'roundrect' && (pad.chamferRatio ?? 0) > 0) return 'chamfered';
  return pad.shape;
}

/**
 * `PAD::TransformShapeToPolygon( aBuffer, aLayer, aClearance, aMaxError,
 * aErrorLoc )`.
 */
export function padTransformShapeToPolygon(
  pad: PcbPad,
  aClearance: number,
  aMaxError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  // minimal segment count to approximate a circle to create the polygonal pad shape
  const pad_min_seg_per_circle_count = 16;
  const dx = Math.trunc(pad.size.x / 2);
  const dy = Math.trunc(pad.size.y / 2);
  const padShapePosI = padShapePos(pad);
  const orientation = new EDA_ANGLE(pad.angle);
  const shape = padShapeKind(pad);

  switch (shape) {
    case 'circle':
    case 'oval': {
      // Note: dx == dy is not guaranteed for circle pads in legacy boards
      if (dx === dy || shape === 'circle')
        return [
          [
            transformCircleToPolygonSet(
              padShapePosI,
              dx + aClearance,
              aMaxError,
              aErrorLoc,
              pad_min_seg_per_circle_count,
            ),
          ],
        ];
      const half_width = Math.min(dx, dy);
      const delta = RotatePoint({ x: dx - half_width, y: dy - half_width }, orientation);
      return transformOvalToPolygon(
        { x: padShapePosI.x - delta.x, y: padShapePosI.y - delta.y },
        { x: padShapePosI.x + delta.x, y: padShapePosI.y + delta.y },
        (half_width + aClearance) * 2,
        aMaxError,
        aErrorLoc,
        pad_min_seg_per_circle_count,
      );
    }

    case 'trapezoid':
    case 'rect': {
      const ddx = shape === 'trapezoid' ? Math.trunc((pad.delta?.x ?? 0) / 2) : 0;
      const ddy = shape === 'trapezoid' ? Math.trunc((pad.delta?.y ?? 0) / 2) : 0;
      return [
        [
          transformTrapezoidToPolygon(
            padShapePosI,
            pad.size,
            orientation,
            ddx,
            ddy,
            aClearance,
            aMaxError,
            aErrorLoc,
          ),
        ],
      ];
    }

    case 'chamfered':
    case 'roundrect': {
      const doChamfer = shape === 'chamfered';
      // `PADSTACK::RoundRectRadius`: `KiROUND( min( size ) * ratio )`.
      const radius = KiROUND(Math.min(pad.size.x, pad.size.y) * (pad.roundrectRatio ?? 0));
      return [
        [
          transformRoundChamferedRectToPolygon(
            padShapePosI,
            pad.size,
            orientation,
            radius,
            doChamfer ? (pad.chamferRatio ?? 0) : 0,
            doChamfer ? chamferPositions(pad) : 0,
            aClearance,
            aMaxError,
            aErrorLoc,
          ),
        ],
      ];
    }

    case 'custom': {
      let outline = mergePrimitivesAsPolygon(pad, aMaxError, aErrorLoc);
      // `outline.Rotate( GetOrientation() ); outline.Move( padShapePos )`.
      outline = outline.map((poly) =>
        poly.map((ring) =>
          ring.map((p) => {
            const r = RotatePoint(p, orientation);
            return { x: r.x + padShapePosI.x, y: r.y + padShapePosI.y };
          }),
        ),
      );
      let clearance = aClearance;
      if (clearance > 0 || aErrorLoc === ErrorLoc.ERROR_OUTSIDE) {
        if (aErrorLoc === ErrorLoc.ERROR_OUTSIDE) clearance += aMaxError;
        outline = inflateKi(outline, clearance, CornerStrategy.ROUND_ALL_CORNERS, aMaxError);
        outline = fracture(outline).map((r) => [r]);
      } else if (clearance < 0) {
        outline = inflateKi(outline, clearance, CornerStrategy.ALLOW_ACUTE_CORNERS, aMaxError);
        outline = fracture(outline).map((r) => [r]);
      }
      return outline;
    }
  }
  return [];
}

/**
 * `PAD::MergePrimitivesAsPolygon`: the anchor at (0, 0), the primitives
 * unioned onto it, fractured.
 */
function mergePrimitivesAsPolygon(pad: PcbPad, maxError: number, errorLoc: ErrorLoc): Polygon[] {
  const padSize = pad.size;
  let merged: Polygon[];
  if (pad.anchorShape === 'rect') {
    const x0 = -Math.trunc(padSize.x / 2);
    const y0 = -Math.trunc(padSize.y / 2);
    // `SHAPE_RECT::Outline`: the four corners, closed.
    merged = [
      [
        [
          { x: x0, y: y0 },
          { x: x0 + padSize.x, y: y0 },
          { x: x0 + padSize.x, y: y0 + padSize.y },
          { x: x0, y: y0 + padSize.y },
        ],
      ],
    ];
  } else {
    merged = [
      [transformCircleToPolygonSet({ x: 0, y: 0 }, Math.trunc(padSize.x / 2), maxError, errorLoc)],
    ];
  }

  let polyset: Polygon[] = [];
  for (const primitive of pad.primitives ?? []) {
    if (primitive.kind === 'gr_vector') continue; // IsProxyItem
    polyset.push(...primitiveTransformShapeToPolygon(primitive, 0, maxError, errorLoc));
  }
  polyset = booleanAdd(polyset, []); // Simplify

  if (polyset.length > 0) {
    merged = booleanAdd(merged, polyset);
    merged = fracture(merged).map((r) => [r]);
  }
  return merged;
}

/** A pad primitive is a PCB_SHAPE in pad-local coordinates. */
function primitiveTransformShapeToPolygon(
  p: PadPrimitive,
  aClearance: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  const kindMap: Record<PadPrimitive['kind'], PcbShape['kind']> = {
    gr_poly: 'poly',
    gr_line: 'line',
    gr_circle: 'circle',
    gr_arc: 'arc',
    gr_rect: 'rect',
    gr_vector: 'line',
  };
  return edaShapeTransformShapeToPolygon(
    {
      kind: kindMap[p.kind],
      start: p.start,
      end: p.end,
      mid: p.mid,
      center: p.center,
      pts: p.pts,
      width: p.width,
      fillMode: p.fill ? 'solid' : 'none',
      layer: '',
    } as unknown as PcbShape,
    aClearance,
    aError,
    aErrorLoc,
    false,
  );
}

/**
 * `PAD::TransformHoleToPolygon`: `TransformOvalToPolygon` on
 * `GetEffectiveHoleShape`, the drill's slot segment through `m_pos` — the
 * pad position, NOT `ShapePos`.
 */
export function padTransformHoleToPolygon(
  pad: PcbPad,
  aClearance: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  if (!pad.drill || !pad.drill.w || !pad.drill.h) return [];

  // `VECTOR2I half_size = m_padStack.Drill().size / 2` — a VECTOR2I divided
  // by a scalar is `KiROUND( x / aFactor )` per component (vector2d.h:536),
  // NOT the truncating integer division a plain `int / 2` would be.
  const half_size = { x: KiROUND(pad.drill.w / 2), y: KiROUND(pad.drill.h / 2) };
  let half_width: number;
  let half_len: Vec2 = { x: 0, y: 0 };
  if (!pad.drill.oblong) {
    half_width = half_size.x;
  } else {
    half_width = Math.min(half_size.x, half_size.y);
    half_len = { x: half_size.x - half_width, y: half_size.y - half_width };
  }
  half_len = RotatePoint(half_len, new EDA_ANGLE(pad.angle));

  return transformOvalToPolygon(
    { x: pad.at.x - half_len.x, y: pad.at.y - half_len.y },
    { x: pad.at.x + half_len.x, y: pad.at.y + half_len.y },
    half_width * 2 + aClearance * 2,
    aError,
    aErrorLoc,
  );
}

/** `PCB_TRACK::TransformShapeToPolygon`, the segment case. */
export function trackTransformShapeToPolygon(
  t: PcbTrack,
  aClearance: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  const width = t.width + 2 * aClearance;
  return transformOvalToPolygon(t.start, t.end, width, aError, aErrorLoc);
}

/** `PCB_TRACK::TransformShapeToPolygon`, the PCB_ARC_T case. */
export function arcTrackTransformShapeToPolygon(
  a: PcbArcTrack,
  aClearance: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  const width = a.width + 2 * aClearance;
  return transformArcToPolygon(a.start, a.mid, a.end, width, aError, aErrorLoc);
}

/** `PCB_TRACK::TransformShapeToPolygon`, the PCB_VIA_T case. */
export function viaTransformShapeToPolygon(
  v: PcbVia,
  aClearance: number,
  aError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  const radius = Math.trunc(v.size / 2) + aClearance;
  return [[transformCircleToPolygonSet(v.at, radius, aError, aErrorLoc)]];
}

/**
 * `EDA_SHAPE::TransformShapeToPolygon( aBuffer, aClearance, aError, aErrorLoc,
 * ignoreLineWidth, includeFill = true )`.
 */
export function edaShapeTransformShapeToPolygon(
  s: PcbShape,
  aClearance: number,
  aError: number,
  aErrorLoc: ErrorLoc,
  ignoreLineWidth: boolean,
): Polygon[] {
  // `IsSolidFill() || ( IsHatchedFill() && !includeFill ) || IsProxyItem()`
  const solidFill = isSolidFill(s);
  let width = ignoreLineWidth ? 0 : s.width;
  width += 2 * aClearance;
  const out: Polygon[] = [];

  switch (s.kind) {
    case 'circle': {
      if (!s.center || !s.end) break;
      const r = Math.max(1, KiROUND(distance(s.center, s.end)));
      if (solidFill)
        out.push([
          transformCircleToPolygonSet(s.center, r + Math.trunc(width / 2), aError, aErrorLoc),
        ]);
      else
        out.push(
          ...transformRingToPolygon(s.center, r, width, aError, aErrorLoc).map((rg) => [rg]),
        );
      break;
    }

    case 'rect': {
      if (!s.start || !s.end) break;
      if ((s.cornerRadius ?? 0) > 0) {
        const size = { x: Math.abs(s.end.x - s.start.x), y: Math.abs(s.end.y - s.start.y) };
        // `BOX2I::GetCenter`: origin plus half the size, each an integer division.
        const position = {
          x: Math.min(s.start.x, s.end.x) + Math.trunc(size.x / 2),
          y: Math.min(s.start.y, s.end.y) + Math.trunc(size.y / 2),
        };
        if (solidFill) {
          out.push([
            transformRoundChamferedRectToPolygon(
              position,
              size,
              new EDA_ANGLE(0),
              s.cornerRadius!,
              0.0,
              0,
              Math.trunc(width / 2),
              aError,
              aErrorLoc,
            ),
          ]);
        } else {
          // The stroked rounded rectangle: four sides as ovals, four corner
          // arcs as arc polygons.
          const r = s.cornerRadius!;
          const x0 = Math.min(s.start.x, s.end.x);
          const y0 = Math.min(s.start.y, s.end.y);
          const x1 = Math.max(s.start.x, s.end.x);
          const y1 = Math.max(s.start.y, s.end.y);
          const sides: [Vec2, Vec2][] = [
            [
              { x: x0 + r, y: y0 },
              { x: x1 - r, y: y0 },
            ],
            [
              { x: x1, y: y0 + r },
              { x: x1, y: y1 - r },
            ],
            [
              { x: x1 - r, y: y1 },
              { x: x0 + r, y: y1 },
            ],
            [
              { x: x0, y: y1 - r },
              { x: x0, y: y0 + r },
            ],
          ];
          for (const [a, b] of sides)
            out.push(...transformOvalToPolygon(a, b, width, aError, aErrorLoc));
          const c = Math.SQRT1_2;
          const arcs: [Vec2, Vec2, Vec2][] = [
            [
              { x: x1 - r, y: y0 },
              { x: KiROUND(x1 - r + r * c), y: KiROUND(y0 + r - r * c) },
              { x: x1, y: y0 + r },
            ],
            [
              { x: x1, y: y1 - r },
              { x: KiROUND(x1 - r + r * c), y: KiROUND(y1 - r + r * c) },
              { x: x1 - r, y: y1 },
            ],
            [
              { x: x0 + r, y: y1 },
              { x: KiROUND(x0 + r - r * c), y: KiROUND(y1 - r + r * c) },
              { x: x0, y: y1 - r },
            ],
            [
              { x: x0, y: y0 + r },
              { x: KiROUND(x0 + r - r * c), y: KiROUND(y0 + r - r * c) },
              { x: x0 + r, y: y0 },
            ],
          ];
          for (const [p0, m, p1] of arcs)
            out.push(...transformArcToPolygon(p0, m, p1, width, aError, aErrorLoc));
        }
      } else {
        const pts: Vec2[] = [
          { x: s.start.x, y: s.start.y },
          { x: s.end.x, y: s.start.y },
          { x: s.end.x, y: s.end.y },
          { x: s.start.x, y: s.end.y },
        ];
        if (solidFill) out.push([pts.map((p) => ({ ...p }))]);
        if (width > 0 || !solidFill) {
          out.push(...transformOvalToPolygon(pts[0]!, pts[1]!, width, aError, aErrorLoc));
          out.push(...transformOvalToPolygon(pts[1]!, pts[2]!, width, aError, aErrorLoc));
          out.push(...transformOvalToPolygon(pts[2]!, pts[3]!, width, aError, aErrorLoc));
          out.push(...transformOvalToPolygon(pts[3]!, pts[0]!, width, aError, aErrorLoc));
        }
      }
      break;
    }

    case 'arc':
      if (!s.start || !s.mid || !s.end) break;
      out.push(...transformArcToPolygon(s.start, s.mid, s.end, width, aError, aErrorLoc));
      break;

    case 'line':
      if (!s.start || !s.end) break;
      out.push(...transformOvalToPolygon(s.start, s.end, width, aError, aErrorLoc));
      break;

    case 'poly': {
      const pts = s.pts ?? [];
      if (pts.length <= 2) break; // IsPolyShapeValid
      if (solidFill) {
        let tmp: Polygon[] = [[pts.map((p) => ({ x: p.x, y: p.y }))]];
        if (width > 0) {
          let inflateBy = Math.trunc(width / 2);
          if (aErrorLoc === ErrorLoc.ERROR_OUTSIDE) inflateBy += aError;
          tmp = inflateKi(tmp, inflateBy, CornerStrategy.ROUND_ALL_CORNERS, aError);
        }
        out.push(...tmp);
      } else {
        for (let jj = 0; jj < pts.length; ++jj) {
          const a = pts[jj]!;
          const b = pts[(jj + 1) % pts.length]!;
          out.push(...transformOvalToPolygon(a, b, width, aError, aErrorLoc));
        }
      }
      break;
    }

    case 'curve':
      break;
  }
  return out;
}
