// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::SELECTION_AREA` — the rubber band every canvas drags, and
 * the one table its colours come from.
 *
 * Upstream this is a single `ViewDraw` on a single preview item
 * (`common/preview_items/selection_area.cpp`), added to the view by whichever
 * tool is running: `ZOOM_TOOL::selectRegion` for a zoom-to-area drag
 * (`zoom_tool.cpp:115`) and each editor's `SELECTION_TOOL` for a box or lasso
 * select. One item, one table, six colours, two schemes.
 *
 * Here it had become FOUR partial copies, and the shape of the drift is worth
 * recording because it is what a per-file port produces every time:
 *
 *  - `ui/zoom_tool.ts` had two constants — the dark scheme's `normal` fill and
 *    its `outline_l2r` — and no light scheme at all;
 *  - `drawing_sheet/ds_painter.ts`'s `DS_MARQUEE` had both schemes but only
 *    three of the six colours, so a modifier-held drag was the plain colour;
 *  - `SchematicCanvas.tsx` and `SymbolCanvas.tsx` each had five constants
 *    hardcoded to `selectionColorScheme[1]`, the LIGHT scheme, which is simply
 *    wrong on a dark schematic theme — and the comment above them said so
 *    ("for a bright background") without anything acting on it.
 *
 * The table is KiCad's own literals, not a theme lookup: `ViewDraw` reads
 * `selectionColorScheme[…]` directly and never asks the painter for a layer
 * colour, so these stay [data] here rather than becoming tokens.
 */
import type { Color4d } from '../color4d.js';
import { brightness, parseColor4d, toCss } from '../color4d.js';

/** `struct SELECTION_COLORS` (`selection_area.cpp:34-42`). */
export interface SelectionColors {
  normal: string;
  additive: string;
  subtract: string;
  exclusiveOr: string;
  outlineL2R: string;
  outlineR2L: string;
}

const c = (r: number, g: number, b: number, a: number): string => toCss({ r, g, b, a } as Color4d);

/**
 * [data] `selectionColorScheme[2]` (`selection_area.cpp:44-62`), verbatim.
 * COLOR4D channels are 0..1 floats; `toCss` rounds each to 0..255 the one way
 * the rest of the codebase does, so no rounded literal is written here twice.
 */
export const SELECTION_COLOR_SCHEME: readonly [SelectionColors, SelectionColors] = [
  {
    // dark background
    normal: c(0.3, 0.3, 0.7, 0.3), // Slight blue
    additive: c(0.3, 0.7, 0.3, 0.3), // Slight green
    subtract: c(0.7, 0.3, 0.3, 0.3), // Slight red
    exclusiveOr: c(0.7, 0.3, 0.3, 0.3), // Slight red
    outlineL2R: c(1.0, 1.0, 0.4, 1.0), // yellow
    outlineR2L: c(0.4, 0.4, 1.0, 1.0), // blue
  },
  {
    // bright background
    normal: c(0.5, 0.3, 1.0, 0.5), // Slight blue
    additive: c(0.5, 1.0, 0.5, 0.5), // Slight green
    subtract: c(1.0, 0.5, 0.5, 0.5), // Slight red
    exclusiveOr: c(1.0, 0.5, 0.5, 0.5), // Slight red
    outlineL2R: c(0.7, 0.7, 0.0, 1.0), // yellow
    outlineR2L: c(0.1, 0.1, 1.0, 1.0), // blue
  },
];

/** `SELECTION_MODE` — only the INSIDE/TOUCHING distinction reaches the colour. */
export interface SelectionAreaState {
  /** `settings->IsBackgroundDark()` (`selection_area.cpp:105-106`). */
  backgroundDark: boolean;
  /**
   * `m_mode == INSIDE_RECTANGLE || m_mode == INSIDE_LASSO` (`:116-121`).
   *
   * A left-to-right drag is the "inside" (window) select and takes the yellow
   * outline; a right-to-left drag is the "touching" (greedy) select and takes
   * blue. `ZOOM_TOOL` never calls `SetMode`, so a zoom band is always the
   * default `INSIDE_RECTANGLE` and always yellow.
   */
  inside: boolean;
  additive?: boolean;
  subtractive?: boolean;
  exclusiveOr?: boolean;
}

/**
 * The `if` ladder of `ViewDraw` (`:109-121`), in its order — additive wins over
 * subtractive, which wins over exclusive-or.
 */
export function selectionAreaColors(s: SelectionAreaState): { fill: string; stroke: string } {
  const scheme = SELECTION_COLOR_SCHEME[s.backgroundDark ? 0 : 1];
  const fill = s.additive
    ? scheme.additive
    : s.subtractive
      ? scheme.subtract
      : s.exclusiveOr
        ? scheme.exclusiveOr
        : scheme.normal;
  return { fill, stroke: s.inside ? scheme.outlineL2R : scheme.outlineR2L };
}

/**
 * `CAIRO_GAL_BASE::syncLineWidth` (`cairo_gal.cpp:216-232`) for a pen the GAL
 * was given as zero:
 *
 *     double w = floor( xform( aForceWidth ? aWidth : m_lineWidth ) + 0.5 );
 *     if( w <= 1.0 )
 *     {
 *         w = 1.0;
 *         cairo_set_line_join( …, CAIRO_LINE_JOIN_MITER );
 *         cairo_set_line_cap( …, CAIRO_LINE_CAP_BUTT );
 *         cairo_set_line_width( …, 1.0 );
 *         m_lineWidthIsOdd = true;
 *     }
 *
 * `ViewDraw` asks for exactly that — `gal.SetLineWidth( 0.0 ); // force
 * 1-pixel-wide line` (`:126-127`) — so the band's outline is ONE DEVICE PIXEL
 * at every zoom and on every display. The canvases wrote `dpr`, or `1 / scale`,
 * which is one *logical* pixel: identical at 1x and twice too heavy on a HiDPI
 * screen, where KiCad's band stays a hairline.
 */
export const SELECTION_AREA_LINE_WIDTH_PX = 1;

/**
 * `roundp` for an odd pen (`cairo_gal.cpp`, and the same helper `drawGrid`
 * already uses): `floor( x + 0.5 ) + 0.5`.
 *
 * `m_lineWidthIsOdd` is set by the branch above, and an odd-width stroke is
 * centred on its path — so a path on an integer boundary straddles two pixel
 * columns at half coverage each and the line renders two pixels wide and grey.
 * Landing it on a half-integer is what makes KiCad's hairline crisp.
 */
export const roundOddPen = (x: number): number => Math.floor(x + 0.5) + 0.5;

/**
 * `SELECTION_AREA::ViewDraw`'s two passes, in ITS order (`:123-137`):
 *
 *     gal.SetIsStroke( true ); gal.SetIsFill( false );
 *     gal.SetLineWidth( 0.0 );          // force 1-pixel-wide line
 *     drawSelectionShape();
 *     // draw the fill as the second object so that Z test will not clamp
 *     // the single-pixel-wide rectangle sides
 *     gal.SetIsFill( true );
 *     drawSelectionShape();
 *
 * The order is load-bearing and every canvas had it backwards. The fill is
 * translucent (alpha 0.3 dark, 0.5 light), so painting it SECOND tints the
 * outline it overlaps; painting the outline second, as ours did, leaves it at
 * full strength. The comment upstream explains the depth-buffer reason, but the
 * visible consequence is the tint, and that is what a side-by-side shows.
 *
 * Device space only: the caller resets the transform, because a 1-device-pixel
 * pen and a half-pixel snap are both meaningless under a world transform.
 */
export function drawSelectionArea(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colors: { fill: string; stroke: string },
): void {
  const x = roundOddPen(Math.min(x0, x1));
  const y = roundOddPen(Math.min(y0, y1));
  const w = Math.round(Math.abs(x1 - x0));
  const h = Math.round(Math.abs(y1 - y0));

  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.lineWidth = SELECTION_AREA_LINE_WIDTH_PX;
  ctx.strokeStyle = colors.stroke;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = colors.fill;
  ctx.fillRect(x, y, w, h);
}

/**
 * `RENDER_SETTINGS::IsBackgroundDark()`, and the trap in it.
 *
 * The BASE returns a flat `false` (`include/render_settings.h:288-291`) and
 * exactly three subclasses override it, each on its own background layer:
 *
 *     SCH_RENDER_SETTINGS  LAYER_SCHEMATIC_BACKGROUND  (sch_render_settings.h:48-52)
 *     DS_RENDER_SETTINGS   m_backgroundColor           (ds_painter.h:57-61)
 *     PCB_RENDER_SETTINGS  LAYER_PCB_BACKGROUND        (pcb_painter.h:112-120)
 *
 * `GERBVIEW_RENDER_SETTINGS` is NOT among them — it derives straight from
 * `RENDER_SETTINGS` (`gerbview_painter.h:46`) and never overrides. So the
 * Gerber Viewer takes the BRIGHT scheme on its black canvas, which looks like
 * an upstream oversight and is nonetheless what KiCad draws. Ours had reasoned
 * from the visible background and picked the dark scheme, which is the more
 * sensible answer and the wrong one.
 *
 * The weights are `COLOR4D::GetBrightness`' ("Weighted W3C formula",
 * `color4d.h:334-338`), which `brightness` already carries.
 */
export const isBackgroundDark = (backgroundCss: string): boolean =>
  brightness(parseColor4d(backgroundCss)) < 0.5;

/**
 * `drawSelectionShape`'s lasso arm — `gal.DrawPolygon( m_shape_poly )`
 * (`selection_area.cpp:145-149`) — in the same stroke-then-fill order as the
 * rectangle, for the same reason.
 */
export function drawSelectionLasso(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  colors: { fill: string; stroke: string },
): void {
  if (points.length < 2) return;

  const path = (): void => {
    ctx.beginPath();
    points.forEach((p, i) =>
      i === 0
        ? ctx.moveTo(roundOddPen(p.x), roundOddPen(p.y))
        : ctx.lineTo(roundOddPen(p.x), roundOddPen(p.y)),
    );
    ctx.closePath();
  };

  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.lineWidth = SELECTION_AREA_LINE_WIDTH_PX;
  ctx.strokeStyle = colors.stroke;
  path();
  ctx.stroke();

  ctx.fillStyle = colors.fill;
  path();
  ctx.fill();
}

/**
 * Whether a lasso is an INSIDE (window) select, from its WINDING
 * (`sch_selection_tool.cpp:2352-2367`):
 *
 *     double shapeArea = area.GetPoly().Area( false );
 *     bool   isClockwise = shapeArea > 0 ? true : false;
 *     if( getView()->IsMirroredX() && shapeArea != 0 )
 *         isClockwise = !isClockwise;
 *     if( isClockwise ) selectionMode = INSIDE_LASSO;   // window, yellow
 *     else              selectionMode = TOUCHING_LASSO; // greedy, blue
 *
 * So a lasso drawn clockwise is a window select and takes the YELLOW outline.
 * The schematic canvas hardcoded blue with a comment asserting "lasso:
 * greedy/touching" — true of only half the drags, and the half that is wrong
 * also selects differently, so the colour was not merely cosmetic there.
 *
 * `Area( false )` is the signed shoelace sum; a positive one is clockwise in
 * KiCad's y-down world.
 */
export function lassoIsInside(
  points: readonly { x: number; y: number }[],
  mirroredX = false,
): boolean {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const clockwise = twiceArea > 0;
  return mirroredX && twiceArea !== 0 ? !clockwise : clockwise;
}
