// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FILL_T` for a board graphic, and the three questions `EDA_SHAPE` asks of it.
 * Counterpart: `include/eda_shape.h:57-146`.
 *
 * A PCB_SHAPE's fill is NOT a boolean. `EDA_SHAPE::m_fill` is an enum, and a
 * `.kicad_pcb` carries five of its values (`pcb_io_kicad_sexpr.cpp:1071-1097`,
 * `pcb_io_kicad_sexpr_parser.cpp:3580-3600`):
 *
 *     (fill yes) | (fill solid)   FILLED_SHAPE   -- `yes` is the 2017 spelling
 *     (fill no)  | (fill none)    NO_FILL
 *     (fill hatch)                HATCH
 *     (fill reverse_hatch)        REVERSE_HATCH
 *     (fill cross_hatch)          CROSS_HATCH
 *
 * Modelling it as a boolean read every hatched graphic back as unfilled and then
 * wrote `no` over it on the next edit — the hatch was lost by opening the board
 * and touching the shape.
 *
 * Which predicate a call site wants is upstream's own split, and they differ:
 * hit testing is `IsFilledForHitTesting()`, which is `IsSolidFill()`, so a
 * hatched shape is picked by its OUTLINE. The two remaining FILL_T values,
 * FILLED_WITH_BG_BODYCOLOR and FILLED_WITH_COLOR, are eeschema's and have no
 * board spelling; eeschema keeps its own union because it writes FILLED_SHAPE as
 * `outline` rather than `solid`.
 */

import {
  generateHatchLines,
  hatchSlopes,
  hatchSpacing,
  type HatchSeg,
} from '@ziroeda/kimath/src/geometry/hatch_lines.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { PcbShape } from './types.js';

/** `FILL_T`, spelled as a `.kicad_pcb` spells it. */
export type PcbFillMode = 'none' | 'solid' | 'hatch' | 'reverse_hatch' | 'cross_hatch';

/** The `(fill …)` words the parser accepts, mapped to the mode they mean. */
export function pcbFillModeFromToken(token: string | undefined): PcbFillMode {
  switch (token) {
    case 'yes':
    case 'solid':
      return 'solid';
    case 'hatch':
      return 'hatch';
    case 'reverse_hatch':
      return 'reverse_hatch';
    case 'cross_hatch':
      return 'cross_hatch';
    // `none`, `no`, and an absent token: NO_FILL is EDA_SHAPE's default.
    default:
      return 'none';
  }
}

/** `EDA_SHAPE::IsAnyFill()` — anything but NO_FILL. */
export const isAnyFill = (s: { fillMode: PcbFillMode }): boolean => s.fillMode !== 'none';

/**
 * `EDA_SHAPE::IsSolidFill()` — the value that paints the shape's interior in the
 * shape's own colour. This is also `IsFilledForHitTesting()`.
 */
export const isSolidFill = (s: { fillMode: PcbFillMode }): boolean => s.fillMode === 'solid';

/** `EDA_SHAPE::IsHatchedFill()` — one of the three hatch modes. */
export const isHatchedFill = (s: { fillMode: PcbFillMode }): boolean =>
  s.fillMode === 'hatch' || s.fillMode === 'reverse_hatch' || s.fillMode === 'cross_hatch';

/**
 * `ENUM_MAP<UI_FILL_MODE>`'s labels (`common/eda_shape.cpp:2765-2772`), in Map
 * order. UI_FILL_MODE is FILL_T without the two schematic-only values, which is
 * why it maps one-to-one onto the board spellings above.
 */
export const UI_FILL_MODE_CHOICES = [
  ['none', 'None'],
  ['solid', 'Solid'],
  ['hatch', 'Hatch'],
  ['reverse_hatch', 'Reverse Hatch'],
  ['cross_hatch', 'Cross-hatch'],
] as const satisfies readonly (readonly [PcbFillMode, string])[];

/**
 * `EDA_SHAPE::UpdateHatching`'s hatch lines for one shape (eda_shape.cpp:668-760).
 *
 * The outline it hatches is the shape's own filled area — a ROUNDRECT for a
 * rectangle, a tessellated circle, a closed polygon — and nothing for a segment,
 * an arc or a bezier, which have no interior to fill. Every consumer that draws
 * or hit-tests a hatched shape asks for these, so it lives beside the mode.
 */
export function shapeHatchLines(s: PcbShape): HatchSeg[] {
  if (!isHatchedFill(s)) return [];

  const outline = shapeFillOutline(s);
  if (outline.length === 0) return [];

  const xs = outline.flat().map((p) => p.x);
  const ys = outline.flat().map((p) => p.y);
  const majorAxis = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const spacing = hatchSpacing(s.width, majorAxis);
  if (spacing <= 0) return [];

  return generateHatchLines(outline, hatchSlopes(s.fillMode as HatchMode), spacing);
}

type HatchMode = 'hatch' | 'reverse_hatch' | 'cross_hatch';

/**
 * The polygon `UpdateHatching` fills — and the same one `hitTest` collides
 * against. `getMaxError()` is the board's `m_MaxError`, which pcbnew defaults to
 * 0.005 mm; the segment count that follows from it is what KiCad tessellates a
 * circle into, so a hatched circle's lines land where KiCad's do.
 */
export function shapeFillOutline(s: PcbShape): Vec2[][] {
  const CIRCLE_SEGMENTS = 64;

  if (s.kind === 'rect' && s.start && s.end) {
    const x0 = Math.min(s.start.x, s.end.x);
    const x1 = Math.max(s.start.x, s.end.x);
    const y0 = Math.min(s.start.y, s.end.y);
    const y1 = Math.max(s.start.y, s.end.y);
    const r = Math.min(s.cornerRadius ?? 0, Math.min(x1 - x0, y1 - y0) / 2);
    if (r <= 0)
      return [
        [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      ];

    // `ROUNDRECT::TransformToPolygon`: the four corner arcs, quarter by quarter.
    const pts: Vec2[] = [];
    const arc = (cx: number, cy: number, from: number): void => {
      const steps = Math.max(2, Math.round(CIRCLE_SEGMENTS / 4));
      for (let i = 0; i <= steps; i++) {
        const a = from + (i / steps) * (Math.PI / 2);
        pts.push({ x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) });
      }
    };
    arc(x1 - r, y0 + r, -Math.PI / 2);
    arc(x1 - r, y1 - r, 0);
    arc(x0 + r, y1 - r, Math.PI / 2);
    arc(x0 + r, y0 + r, Math.PI);
    return [pts];
  }

  if (s.kind === 'circle' && s.center && s.end) {
    const r = Math.hypot(s.end.x - s.center.x, s.end.y - s.center.y);
    if (r <= 0) return [];
    const pts: Vec2[] = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      pts.push({
        x: Math.round(s.center.x + r * Math.cos(a)),
        y: Math.round(s.center.y + r * Math.sin(a)),
      });
    }
    return [pts];
  }

  // `case SHAPE_T::POLY: if( !IsClosed() ) return;` — three points at least.
  if (s.kind === 'poly' && s.pts && s.pts.length >= 3) return [s.pts];

  // ARC, SEGMENT and BEZIER return early upstream: nothing to fill.
  return [];
}
