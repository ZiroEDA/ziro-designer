// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two markers `SCH_PAINTER::draw( SCH_SYMBOL )` paints over a symbol's
 * body — the DNP cross (`eeschema/sch_painter.cpp:2809-2835`) and the
 * excluded-from-simulation box with its badge (`:2837-2870`).
 *
 * They are here as pure geometry rather than inline in the renderer because
 * every number in them comes off the C++ and can therefore be checked against
 * it without a canvas. The renderer strokes what these return.
 *
 * Both are guarded upstream by `aLayer == LAYER_DEVICE`, "so draw them only
 * when the LAYER_DEVICE is drawn (to avoid draw artifacts)" — that is, once
 * per symbol and not once per unit.
 */
import { schIUScale } from '@ziroeda/common';
import type { BBox } from '@ziroeda/eeschema/src/tools/bbox.js';

interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** One `GAL::DrawSegment( pt1, pt2, width )`. */
export interface MarkerSegment {
  readonly a: Vec2;
  readonly b: Vec2;
}

/**
 * `KiROUND` (`include/math/util.h`): round half away from zero, which is what
 * `std::lround` does and what `Math.round` does NOT for a negative half.
 */
const kiRound = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

/**
 * `int strokeWidth = 3 * schIUScale.MilsToIU( DEFAULT_LINE_WIDTH_MILS )`
 * (`sch_painter.cpp:2816`). [data] `DEFAULT_LINE_WIDTH_MILS` is 6
 * (`eeschema/default_values.h:51`) — a number KiCad hardcodes, not one the
 * theme decides.
 */
export const DNP_MARKER_STROKE_WIDTH = 3 * schIUScale.milsToIU(6);

/**
 * `int strokeWidth = schIUScale.MilsToIU( ADVANCED_CFG::GetCfg()
 * .m_ExcludeFromSimulationLineWidth )` (`sch_painter.cpp:2841`).
 *
 * [data] the advanced-config default is 25 mils
 * (`common/advanced_config.cpp:326`), clamped to 1..100 by the PARAM_CFG_INT
 * that reads it (`:629-631`). We expose no advanced config, so the default is
 * the value.
 */
export const SIM_EXCLUSION_STROKE_WIDTH = schIUScale.milsToIU(25);

/**
 * The DNP cross, `sch_painter.cpp:2809-2835` (and `SCH_SYMBOL::PlotDNP`,
 * `sch_symbol.cpp:3384-3403`, which repeats it verbatim for the plotters).
 *
 * `body` is `GetBodyBoundingBox()` and `bodyAndPins` is
 * `GetBodyAndPinsBoundingBox()`; the difference between them on each side is
 * how much pin sticks out, and the cross is grown into that space so it covers
 * the body generously without reaching the pin ends.
 *
 *     VECTOR2D margins( std::max( bbox.GetX() - pins.GetX(),
 *                                 pins.GetEnd().x - bbox.GetEnd().x ),
 *                       std::max( bbox.GetY() - pins.GetY(),
 *                                 pins.GetEnd().y - bbox.GetEnd().y ) );
 *
 *     margins.x = std::max( margins.x * 0.6, margins.y * 0.3 );
 *     margins.y = std::max( margins.y * 0.6, margins.x * 0.3 );
 *
 * The second line reads the margins.x the FIRST line just wrote, not the
 * original. The order is load-bearing and is kept: swap the two statements and
 * a symbol with unequal pin margins gets a differently sized cross.
 */
export function dnpMarkerSegments(body: BBox, bodyAndPins: BBox): MarkerSegment[] {
  let mx = Math.max(body.minX - bodyAndPins.minX, bodyAndPins.maxX - body.maxX);
  let my = Math.max(body.minY - bodyAndPins.minY, bodyAndPins.maxY - body.maxY);

  mx = Math.max(mx * 0.6, my * 0.3);
  my = Math.max(my * 0.6, mx * 0.3);

  // `bbox.Inflate( KiROUND( margins.x ), KiROUND( margins.y ) )`: the rounding
  // happens on each axis separately, before the inflation, not on the result.
  const dx = kiRound(mx);
  const dy = kiRound(my);
  const minX = body.minX - dx;
  const minY = body.minY - dy;
  const maxX = body.maxX + dx;
  const maxY = body.maxY + dy;

  // `pt1 = bbox.GetOrigin(); pt2 = bbox.GetEnd();` … `std::swap( pt1.x, pt2.x )`.
  return [
    { a: { x: minX, y: minY }, b: { x: maxX, y: maxY } },
    { a: { x: maxX, y: minY }, b: { x: minX, y: maxY } },
  ];
}

/**
 * The excluded-from-simulation marker, `sch_painter.cpp:2837-2870`: a box round
 * the body and, off its bottom-right corner, a circled tilde.
 *
 * The badge's four points keep upstream's names even though `top` is the one
 * with the LARGER y — schematic coordinates run downward, and renaming them
 * here would only make the comparison with the C++ harder.
 */
export interface SimExclusionMarker {
  /** The four sides of the inflated body box, in upstream's order. */
  readonly box: MarkerSegment[];
  /** `DrawCircle( center, offset )`, filled at `marker_color.WithAlpha( 0.1 )`. */
  readonly circle: { readonly center: Vec2; readonly radius: number };
  /** `DrawCurve( left, top, bottom, right, 1 )` — a cubic bezier. */
  readonly curve: {
    readonly start: Vec2;
    readonly control1: Vec2;
    readonly control2: Vec2;
    readonly end: Vec2;
  };
}

/** [data] `marker_color.WithAlpha( 0.1 )` for the badge disc (`:2867`). */
export const SIM_EXCLUSION_BADGE_ALPHA = 0.1;

export function simExclusionMarker(body: BBox): SimExclusionMarker {
  const strokeWidth = SIM_EXCLUSION_STROKE_WIDTH;
  // `bbox.Inflate( KiROUND( strokeWidth * 0.5 ) )` — the one-argument Inflate,
  // so the same amount on both axes.
  const d = kiRound(strokeWidth * 0.5);
  const minX = body.minX - d;
  const minY = body.minY - d;
  const maxX = body.maxX + d;
  const maxY = body.maxY + d;

  const box: MarkerSegment[] = [
    { a: { x: minX, y: minY }, b: { x: maxX, y: minY } },
    { a: { x: maxX, y: minY }, b: { x: maxX, y: maxY } },
    { a: { x: maxX, y: maxY }, b: { x: minX, y: maxY } },
    { a: { x: minX, y: maxY }, b: { x: minX, y: minY } },
  ];

  //     int offset = 2 * strokeWidth;
  //     VECTOR2D center = bbox.GetEnd() + VECTOR2D( offset + strokeWidth, -offset );
  const offset = 2 * strokeWidth;
  const center = { x: maxX + offset + strokeWidth, y: maxY - offset };
  const left = { x: center.x - offset, y: center.y };
  const right = { x: center.x + offset, y: center.y };
  const top = { x: center.x, y: center.y + offset };
  const bottom = { x: center.x, y: center.y - offset };

  return {
    box,
    circle: { center, radius: offset },
    // The tilde: the endpoints are left/right and the CONTROLS are top/bottom,
    // which is what bends it into an S rather than a bow.
    curve: { start: left, control1: top, control2: bottom, end: right },
  };
}
