// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `OUTLINE_DECOMPOSER` (common/font/outline_decomposer.cpp): a glyph outline
 * as FreeType hands it over — move / line / conic / cubic — flattened into
 * closed polygonal contours, each tagged with its winding and the outline's
 * orientation so `OUTLINE_FONT` can tell a filled contour from a hole.
 *
 * Units are KiCad's GLYPH units: FreeType's 26.6 pixel coordinates at the
 * face size times `GLYPH_SIZE_SCALER` (72 / 1152), which comes to
 * `font units × scaler / unitsPerEm` — one em is `scaler` units. The caller
 * passes that factor in, since it is the face size KiCad set, not a property
 * of the outline.
 *
 * The curves are flattened by `BEZIER_POLY::GetPoly` at
 * `ADVANCED_CFG::m_FontErrorSize`, default 2 (advanced_config.cpp:296) —
 * in these units, so the same fraction of an em whatever the text size.
 * A conic becomes a cubic with one control point (`quadraticTo` calls
 * `cubicTo` with the second control point null), which `BEZIER_POLY` reads
 * as a three-point quadratic.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import type { OutlineCommand, OutlineOrientation } from './outline_face.js';

/** `ADVANCED_CFG::m_FontErrorSize`, the flattening tolerance in glyph units. */
export const FONT_ERROR_SIZE = 2;

/** `CONTOUR` (outline_decomposer.h). */
export interface Contour {
  points: Vec2[];
  /** `winding()`: 1 clockwise, -1 counter-clockwise, 0 degenerate. */
  winding: number;
  orientation: OutlineOrientation;
}

/**
 * `OUTLINE_DECOMPOSER::winding`: the sign of the shoelace sum over the closed
 * contour, with the closing edge included. 1 is clockwise (the sum positive),
 * -1 counter-clockwise, 0 a contour of fewer than two points.
 */
export function contourWinding(points: readonly Vec2[]): number {
  if (points.length < 2) return 0;
  let sum = 0;
  const len = points.length;
  for (let i = 0; i < len - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    sum += (p2.x - p1.x) * (p2.y + p1.y);
  }
  const first = points[0]!;
  const last = points[len - 1]!;
  sum += (first.x - last.x) * (first.y + last.y);
  if (sum > 0) return 1;
  if (sum < 0) return -1;
  return 0;
}

/**
 * `OUTLINE_DECOMPOSER::OutlineToSegments`. `scale` is glyph units per font
 * unit; `orientation` is the outline's, stamped on every contour as
 * `newContour` does.
 *
 * An outline with no contours — a space, or a `.notdef` drawn as nothing —
 * decomposes to an empty list and is a SUCCESS: `FT_Outline_Decompose`
 * returns no error for it and the glyph simply has no ink. The tofu box is
 * for the failure case only, which here is a glyph whose path opentype.js
 * cannot read, reported to the caller as null.
 */
export function outlineToSegments(
  commands: readonly OutlineCommand[],
  scale: number,
  orientation: OutlineOrientation,
): Contour[] | null {
  const contours: Contour[] = [];
  let last: Vec2 = { x: 0, y: 0 };
  const add = (p: Vec2): void => {
    const c = contours[contours.length - 1];
    if (!c) return;
    const prev = c.points[c.points.length - 1];
    // `addContourPoint` drops a point equal to the one before it.
    if (!prev || prev.x !== p.x || prev.y !== p.y) c.points.push(p);
  };
  const toVec = (x: number, y: number): Vec2 => ({ x: x * scale, y: y * scale });
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        last = toVec(cmd.x, cmd.y);
        contours.push({ points: [], winding: 0, orientation });
        add(last);
        break;
      case 'L':
        last = toVec(cmd.x, cmd.y);
        add(last);
        break;
      case 'Q':
      case 'C': {
        const ctrl = [last, toVec(cmd.x1, cmd.y1)];
        if (cmd.type === 'C') ctrl.push(toVec(cmd.x2, cmd.y2));
        const end = toVec(cmd.x, cmd.y);
        ctrl.push(end);
        for (const p of new BezierPoly(ctrl).getPolyD(FONT_ERROR_SIZE)) add(p);
        last = end;
        break;
      }
      case 'Z':
        // FreeType has no close command: a contour ends where the next one
        // begins, and the points already close it.
        break;
    }
  }
  for (const c of contours) c.winding = contourWinding(c.points);
  return contours;
}
