// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GAL::DrawGrid` + `GAL::blitCursor` — the one grid and crosshair every editor
 * frame shares.
 *
 * Upstream both live on the GAL, which is constructed once by
 * `EDA_DRAW_PANEL_GAL` (`common/draw_panel_gal.cpp:170`) and is therefore the
 * same code in eeschema, pcbnew, the symbol and footprint editors, gerbview and
 * pl_editor. `EDA_DRAW_PANEL_GAL::onPaint` calls `m_gal->DrawGrid()` for every
 * frame in the suite (`draw_panel_gal.cpp:386`), styled from
 * `GAL_DISPLAY_OPTIONS` (grid style / line width / min spacing / axes) and
 * `WINDOW_SETTINGS::cursor` (crosshair mode, always-show).
 *
 * We had four separate implementations
 * (`schematic/render/renderer.ts`, `pcb/renderBoard.ts`, and inline passes in
 * `DrawingSheetCanvas.tsx` and `GerberCanvas.tsx`) plus a fifth hardcoded one in
 * `symbol/render/symbolRenderer.ts` that no toggle could turn off, and the
 * footprint editor drew no grid at all while its toolbar button rendered
 * pressed. Only the schematic copy implemented all three grid styles; the other
 * four assumed DOTS and ignored the setting.
 *
 * Everything here is framework-free so `qa`'s tsc (which has no `--jsx`) can
 * typecheck it, and the geometry decisions are pure functions so they can be
 * asserted without a canvas.
 *
 * Colour is deliberately NOT owned here. Upstream each frame answers
 * `GetGridColor()` / `GetCursorColor()` out of its own `COLOR_SETTINGS` layer —
 * `LAYER_SCHEMATIC_GRID` in eeschema (`sch_render_settings.h:70`), `LAYER_GRID`
 * in pcbnew and the footprint editor (`pcb_painter.h:133`,
 * `footprint_editor_utils.cpp:269`), `LAYER_GERBVIEW_GRID` in gerbview
 * (`gerbview_frame.cpp:1042`) and a background-luma choice in pl_editor
 * (`ds_painter.h:71`) — so a per-editor colour is parity, not drift. The caller
 * passes the colour its own theme resolved.
 */
import { parseColor4d, toCss, withAlpha } from '@ziroeda/common';

/** `KIGFX::GRID_STYLE` (include/gal/gal_display_options.h:46-51). */
export type GridStyle = 'dots' | 'lines' | 'crosses';

/** `KIGFX::CROSS_HAIR_MODE` (gal_display_options.h:68-73). */
export type CrosshairMode = 'small' | 'full' | '45';

/**
 * `GAL::SetCoarseGrid( 10 )` from the GAL constructor
 * (`graphics_abstraction_layer.cpp:76`): every tenth line/dot/cross is drawn at
 * double width, and it is also the factor the spacing steps up by when the grid
 * gets too dense — a grid jumps 50 mil -> 500 mil, it does not double.
 */
export const GRID_TICK = 10;

/**
 * `GAL::GetVisibleGridSize` floors the grid size at 100 IU before anything else
 * (`graphics_abstraction_layer.h:879-881`).
 */
export const MIN_GRID_IU = 100;

/**
 * `blitCursor`'s `const int cursorSize = 80` (`cairo_gal.cpp:1231`,
 * `opengl_gal.cpp:2841`): the small crosshair is 80 screen px across at any
 * zoom, so each arm is 40 px.
 *
 * "Screen" here is GAL's `m_screenSize`, which `EDA_DRAW_PANEL_GAL::onSize`
 * fills from `GetClientSize()` — *logical* pixels, not native ones
 * (`draw_panel_gal.cpp:459`; `OPENGL_GAL::ResizeScreen` multiplies by the scale
 * factor only for the framebuffer, `opengl_gal.cpp:2050-2059`). So on a
 * device-pixel canvas the arms are 40 * devicePixelRatio device px.
 */
export const SMALL_CROSS_PX = 80;

/**
 * The appearance half of `GAL_DISPLAY_OPTIONS`, with KiCad's own defaults
 * (`common/gal/gal_display_options.cpp:49-56`, and the `.grid.*` params in
 * `common/settings/app_settings.cpp:549-562`, which agree).
 */
export interface GridAppearance {
  /** `m_gridStyle`. Every app defaults to DOTS (`grid.style` default 0). */
  style: GridStyle;
  /** `m_gridLineWidth`, in logical px. */
  lineWidthPx: number;
  /** `m_gridMinSpacing`, the minimum on-screen node spacing in logical px. */
  minSpacingPx: number;
}

export const DEFAULT_GRID_APPEARANCE: GridAppearance = {
  style: 'dots',
  lineWidthPx: 1,
  minSpacingPx: 10,
};

/**
 * A canvas' world -> device-pixel transform.
 *
 * `scale` is always positive (device px per world IU); a mirrored axis is a
 * flag rather than a negative scale so the lattice maths never has to reason
 * about a sign. pcbnew's flip-board view mirrors X (`SetMirror` on X) and
 * gerbview's canvas is Y-up, so both flags are real.
 */
export interface GridView {
  scale: number;
  tx: number;
  ty: number;
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * The same transform spelled `{ scale, offsetX, offsetY }`, which is how the
 * eeschema and symbol-editor canvases carry theirs.
 */
export function viewFromOffsets(v: { scale: number; offsetX: number; offsetY: number }): GridView {
  return { scale: v.scale, tx: v.offsetX, ty: v.offsetY };
}

/** Device x for a world x under `view`. */
export function worldToDeviceX(view: GridView, x: number): number {
  return x * (view.flipX ? -view.scale : view.scale) + view.tx;
}

/** Device y for a world y under `view`. */
export function worldToDeviceY(view: GridView, y: number): number {
  return y * (view.flipY ? -view.scale : view.scale) + view.ty;
}

/** World x for a device x under `view`. */
export function deviceToWorldX(view: GridView, px: number): number {
  return (px - view.tx) / (view.flipX ? -view.scale : view.scale);
}

/** World y for a device y under `view`. */
export function deviceToWorldY(view: GridView, py: number): number {
  return (py - view.ty) / (view.flipY ? -view.scale : view.scale);
}

/**
 * `GAL::GetVisibleGridSize` (`graphics_abstraction_layer.h:875-896`), which is
 * also the loop `DrawGrid` runs inline (`cairo_gal.cpp:1785-1795`).
 *
 * `worldScale` is device px per world IU and `dpr` is GAL's `m_scaleFactor`:
 * the threshold is a *screen pixel* distance, so it converts through the same
 * scale factor GAL applies to every pixel-valued display option.
 *
 * SMALL_CROSS needs twice the room because a cross is wider than a dot.
 */
export function visibleGridStep(
  sizeIU: number,
  worldScale: number,
  style: GridStyle,
  minSpacingPx: number,
  dpr = 1,
): number {
  let step = Math.max(MIN_GRID_IU, sizeIU);
  if (!(worldScale > 0)) return step;
  // KiROUND( computeMinGridSpacing() / m_worldScale ) — the rounding is
  // upstream's and matters at very high zoom, where the threshold in IU is a
  // fraction of one unit and rounds to zero.
  let threshold = Math.round((Math.max(0, minSpacingPx) * dpr) / worldScale);
  if (style === 'crosses') threshold *= 2;
  while (step <= threshold) step *= GRID_TICK;
  return step;
}

/**
 * `DrawGrid`'s node index range for one axis (`cairo_gal.cpp:1798-1813`):
 * `KiROUND( ( world - origin ) / step )` at each end, normalised so start < end,
 * then one node of margin on each side so the lattice always fills the screen.
 */
export function gridIndexRange(
  worldA: number,
  worldB: number,
  origin: number,
  step: number,
): { start: number; end: number } {
  let start = Math.round((worldA - origin) / step);
  let end = Math.round((worldB - origin) / step);
  if (start > end) [start, end] = [end, start];
  return { start: start - 1, end: end + 1 };
}

/**
 * `DrawGrid`'s `marker` / `doubleMarker` in device pixels
 * (`cairo_gal.cpp:1770-1771`), with the stored width GAL derives from the
 * setting: `m_gridLineWidth = m_scaleFactor * options.m_gridLineWidth + 0.25`
 * (`graphics_abstraction_layer.cpp:124`), floored at one pixel by
 * `std::fmax( 1.0f, m_gridLineWidth )`.
 */
export function gridPenWidths(lineWidthPx: number, dpr = 1): { minor: number; major: number } {
  const stored = dpr * Math.max(0, lineWidthPx) + 0.25;
  const minor = Math.max(1, stored);
  return { minor, major: minor * 2 };
}

/**
 * The DOTS branch's mark size (`cairo_gal.cpp:1868-1871`):
 *
 *     double doubleGridLineWidth = m_gridLineWidth * 2.0f;
 *     drawGridPoint( pos, tickX ? doubleGridLineWidth : m_gridLineWidth, ... );
 *
 * where `m_gridLineWidth` already carries GAL's own `+ 0.25`
 * (`graphics_abstraction_layer.cpp:124`), and `drawGridPoint` clamps each of
 * width and height with `std::max( 1.0, aWidth )` AFTER the doubling. So a
 * default 1 px pen gives a 1.25 px dot and a 2.5 px tick — which is not a
 * mistake and not what made ours look wrong. See {@link gridDotEdge}.
 */
export function gridDotWidths(lineWidthPx: number, dpr = 1): { minor: number; major: number } {
  const stored = dpr * Math.max(0, lineWidthPx) + 0.25;
  return { minor: Math.max(1, stored), major: Math.max(1, stored * 2) };
}

/**
 * Where a dot's rectangle starts, which is the half of `drawGridPoint` that was
 * missing (`cairo_gal.cpp:1857-1868`):
 *
 *     VECTOR2D p = roundp( xform( aPoint ) );
 *     cairo_rectangle( ctx, p.x - std::floor( sw / 2 ) - 0.5, ..., sw, sh );
 *
 * with `roundp` being `floor( x + 0.5 ) + 0.5` for an odd pen
 * (`cairo_gal.cpp:186-188`). Every mark is snapped to the pixel grid and only
 * then offset, so its left edge is a whole pixel and a 1.25 px dot paints one
 * solid pixel.
 *
 * Ours placed the rectangle at `x - sw / 2` from the unsnapped position, so
 * each dot straddled a pixel boundary by a different fraction and the canvas
 * anti-aliased it away: a capture showed marks smeared across 2 px and ticks
 * across 4, where KiCad's read as 1 and 2.
 *
 * Returned as the integer edge — `roundp(x) - floor(w / 2) - 0.5` collapses to
 * `floor(x + 0.5) - floor(w / 2)`, which is what a canvas rect wants.
 */
export function gridDotEdge(device: number, width: number): number {
  return Math.floor(device + 0.5) - Math.floor(width / 2);
}

/** A line segment in device pixels. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * `CAIRO_GAL_BASE::blitCursor` (`cairo_gal.cpp:1204-1235`), as device-pixel
 * segments. The OpenGL backend draws the identical shapes in world space
 * (`opengl_gal.cpp:2824-2905`); expressing them in screen space is what makes
 * the small cross 80 px at every zoom, which is what upstream means.
 */
export function crosshairSegments(
  mode: CrosshairMode,
  cursor: { x: number; y: number },
  widthPx: number,
  heightPx: number,
  /** GAL's `m_scaleFactor`: `cursorSize` is 80 *logical* px. */
  dpr = 1,
): Segment[] {
  const { x, y } = cursor;
  if (mode === 'full') {
    return [
      { x1: 0, y1: y, x2: widthPx, y2: y },
      { x1: x, y1: 0, x2: x, y2: heightPx },
    ];
  }
  if (mode === '45') {
    // "Oversized but that's ok" — cairo_gal.cpp:1222.
    const d = widthPx + heightPx;
    return [
      { x1: x - d, y1: y - d, x2: x + d, y2: y + d },
      { x1: x - d, y1: y + d, x2: x + d, y2: y - d },
    ];
  }
  const half = (SMALL_CROSS_PX / 2) * (dpr > 0 ? dpr : 1);
  return [
    { x1: x - half, y1: y, x2: x + half, y2: y },
    { x1: x, y1: y - half, x2: x, y2: y + half },
  ];
}

/**
 * `GAL::IsCursorEnabled()` (`graphics_abstraction_layer.h:1003-1006`) folded
 * together with `GAL::getCursorColor()` (`graphics_abstraction_layer.cpp:
 * 258-268`).
 *
 * `toolWantsCursor` is `m_isCursorEnabled`, which the active tool sets via
 * `ShowCursor` — the drawing tools turn it on, the selection tool does not.
 * `alwaysShow` is `m_forceDisplayCursor`, the "Always show crosshairs"
 * preference. A cursor that is on only because it was forced is drawn at half
 * alpha: upstream's own comment says that "helps to provide a hint for active
 * tools".
 *
 * Returns the alpha multiplier, or null when no crosshair is drawn at all.
 */
export function cursorAlphaFactor(toolWantsCursor: boolean, alwaysShow: boolean): number | null {
  if (!toolWantsCursor && !alwaysShow) return null;
  return toolWantsCursor ? 1 : 0.5;
}

/** `getCursorColor()` applied to a CSS colour: multiply, do not overwrite, alpha. */
export function dimmedCursorColor(css: string, factor: number): string {
  if (factor >= 1) return css;
  const c = parseColor4d(css);
  return toCss(withAlpha(c, c.a * factor));
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/** Everything `DrawGrid` reads, for one canvas, for one frame. */
export interface GridOptions {
  /** `WINDOW_SETTINGS::grid.show` / `GAL::SetGridVisibility`. */
  show?: boolean;
  /** `GAL::m_gridSize`, in the canvas' world units. */
  sizeIU: number;
  /** `GAL::m_gridOrigin` (pcbnew's board grid origin; zero elsewhere). */
  origin?: { x: number; y: number };
  /** The frame's `GetGridColor()`. */
  color: string;
  /** `GAL_DISPLAY_OPTIONS::m_gridStyle`. */
  style?: GridStyle;
  /** `m_gridLineWidth`, logical px. */
  lineWidthPx?: number;
  /** `m_gridMinSpacing`, logical px. */
  minSpacingPx?: number;
  /** GAL's `m_scaleFactor`. */
  devicePixelRatio?: number;
  /** `m_axesEnabled` + `m_axesColor`; null/omitted = axes off (KiCad's default). */
  axes?: { color: string } | null;
}

/**
 * Guard against a pathological view (a not-yet-sized canvas, or a scale of a
 * few nanometres per pixel) asking for millions of nodes. No upstream
 * counterpart: GAL cannot hit this because `GetVisibleGridSize` is driven by a
 * real window size.
 */
const MAX_GRID_NODES = 1_000_000;

interface GridGeometry {
  key: string;
  /** Minor nodes/lines, and the coarse (every GRID_TICK-th) ones. */
  minor: Path2D;
  major: Path2D;
}

/**
 * Retained lattice geometry, per canvas context.
 *
 * The lattice is built once into `Path2D` form in device space and afterwards
 * only translated, so the grid costs one fill (dots) or two strokes
 * (lines/crosses) per frame instead of a draw call per node — the same reason
 * `OPENGL_GAL::DrawGrid` submits the whole grid through the non-cached vertex
 * manager in one go. Keyed on the context rather than module-global because six
 * canvases share this module and two of them can be mounted at once.
 */
const geomCache = new WeakMap<CanvasRenderingContext2D, GridGeometry>();

/** Non-negative remainder, for indices that go negative left of the origin. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * `GAL::DrawGrid` (`common/gal/cairo/cairo_gal.cpp:1756-1876`), painted in
 * device space on the live canvas — GAL draws it to `TARGET_NONCACHED` at
 * `m_depthRange.y * 0.75`, i.e. behind every layer but re-rasterised every
 * frame, which is exactly what an untransformed pass before the scene blit is.
 *
 * The caller's transform is saved and restored.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: GridView,
  widthPx: number,
  heightPx: number,
  opts: GridOptions,
): void {
  const dpr = opts.devicePixelRatio && opts.devicePixelRatio > 0 ? opts.devicePixelRatio : 1;
  const style = opts.style ?? DEFAULT_GRID_APPEARANCE.style;
  const lineWidthPx = opts.lineWidthPx ?? DEFAULT_GRID_APPEARANCE.lineWidthPx;
  const minSpacingPx = opts.minSpacingPx ?? DEFAULT_GRID_APPEARANCE.minSpacingPx;
  const ox = opts.origin?.x ?? 0;
  const oy = opts.origin?.y ?? 0;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // "Draw axes if desired" runs before the grid-visibility test upstream
  // (cairo_gal.cpp:1773-1781, opengl_gal.cpp:1919-1928), so the axes survive
  // Show Grid being off.
  //
  // Known deviation: with LINES and axes both on, upstream skips the grid line
  // that would cover an axis (`if( m_axesEnabled && y == 0.0 ) continue`). Our
  // lattice is a retained path that knows only its own anchor, so we do not;
  // a coarse grid line at zero overdraws the axis.
  //
  // The settings flag `grid.axes_enabled` defaults FALSE in every app
  // (`common/settings/app_settings.cpp:459-460`), but GerbView does not go
  // through it: GERBVIEW_FRAME's constructor sets the GAL option directly,
  // "Enable the axes to match legacy draw style"
  // (`gerbview/gerbview_frame.cpp:188-191`), so the Gerber Viewer is the one
  // editor that draws them.
  if (opts.axes) {
    const axisX = worldToDeviceX(view, 0);
    const axisY = worldToDeviceY(view, 0);
    ctx.strokeStyle = opts.axes.color;
    ctx.lineWidth = gridPenWidths(lineWidthPx, dpr).minor;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, axisY);
    ctx.lineTo(widthPx, axisY);
    ctx.moveTo(axisX, 0);
    ctx.lineTo(axisX, heightPx);
    ctx.stroke();
  }

  // "if( !m_gridVisibility || m_gridSize.x == 0 || m_gridSize.y == 0 ) return"
  if (opts.show === false || !(opts.sizeIU > 0) || !(view.scale > 0)) {
    ctx.restore();
    return;
  }

  const step = visibleGridStep(opts.sizeIU, view.scale, style, minSpacingPx, dpr);
  const pitch = step * view.scale; // node spacing, device px (always positive)
  if (!(pitch > 0)) {
    ctx.restore();
    return;
  }

  const xr = gridIndexRange(deviceToWorldX(view, 0), deviceToWorldX(view, widthPx), ox, step);
  const yr = gridIndexRange(deviceToWorldY(view, 0), deviceToWorldY(view, heightPx), oy, step);

  const nx = xr.end - xr.start;
  const ny = yr.end - yr.start;
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || (nx + 1) * (ny + 1) > MAX_GRID_NODES) {
    ctx.restore();
    return;
  }

  // Walk the lattice in the +device direction: on a mirrored axis that is the
  // *decreasing* index direction. Coarseness has period GRID_TICK and is
  // symmetric about a tick, so counting steps from a tick-aligned anchor gives
  // the same coarse pattern either way, and the retained path then only has to
  // be translated as the view pans.
  const dirX = view.flipX ? -1 : 1;
  const dirY = view.flipY ? -1 : 1;
  const i0 = view.flipX ? xr.end : xr.start;
  const j0 = view.flipY ? yr.end : yr.start;
  // Nearest tick-aligned index at or before i0 in the walking direction.
  const iA = i0 - dirX * mod(dirX * i0, GRID_TICK);
  const jA = j0 - dirY * mod(dirY * j0, GRID_TICK);
  const cols = nx + GRID_TICK;
  const rows = ny + GRID_TICK;

  const { minor: minorW, major: majorW } = gridPenWidths(lineWidthPx, dpr);
  const dots = gridDotWidths(lineWidthPx, dpr);

  const key = `${style}|${pitch}|${cols}x${rows}|${widthPx}x${heightPx}|${minorW}|${dots.minor}`;
  let geom = geomCache.get(ctx);
  if (!geom || geom.key !== key) {
    const minorPath = new Path2D();
    const majorPath = new Path2D();
    const w = cols * pitch;
    const h = rows * pitch;

    if (style === 'lines') {
      // "Now draw the grid, every coarse grid line gets the double width"
      // (cairo_gal.cpp:1819-1846): a horizontal line is coarse on its own row
      // index and a vertical one on its own column index.
      for (let l = 0; l <= rows; l++) {
        const y = l * pitch;
        const p = l % GRID_TICK === 0 ? majorPath : minorPath;
        p.moveTo(0, y);
        p.lineTo(w, y);
      }
      for (let k = 0; k <= cols; k++) {
        const x = k * pitch;
        const p = k % GRID_TICK === 0 ? majorPath : minorPath;
        p.moveTo(x, 0);
        p.lineTo(x, h);
      }
    } else if (style === 'crosses') {
      // SMALL_CROSS (opengl_gal.cpp:1973-1993): a cross is coarse only where
      // *both* indices are on a tick (`tickX && tickY`), and each arm is
      // `lineLen = 2.0 * GetLineWidth()`.
      //
      // The two backends disagree by half a pixel here — CAIRO_GAL_BASE::
      // drawGridCross uses `2.0 * m_lineWidthInPixels + 0.5` — and OpenGL is
      // KiCad's default renderer, so that is the one we match.
      for (let k = 0; k <= cols; k++) {
        const x = k * pitch;
        const tickX = k % GRID_TICK === 0;
        for (let l = 0; l <= rows; l++) {
          const y = l * pitch;
          const coarse = tickX && l % GRID_TICK === 0;
          const p = coarse ? majorPath : minorPath;
          const arm = 2 * (coarse ? majorW : minorW);
          p.moveTo(x - arm, y);
          p.lineTo(x + arm, y);
          p.moveTo(x, y - arm);
          p.lineTo(x, y + arm);
        }
      }
    } else {
      // DOTS (cairo_gal.cpp:1863-1870 + drawGridPoint): the mark is a filled
      // rectangle whose width comes from the column's tick-ness and whose
      // height comes from the row's, so a coarse column is a wider mark, a
      // coarse row a taller one and a coarse crossing a big square. All of them
      // fill in one pass.
      for (let k = 0; k <= cols; k++) {
        const x = k * pitch;
        const sw = k % GRID_TICK === 0 ? dots.major : dots.minor;
        for (let l = 0; l <= rows; l++) {
          const sh = l % GRID_TICK === 0 ? dots.major : dots.minor;
          // Each point is snapped, as `drawGridPoint` snaps each one — not the
          // path as a whole. Rounding only the translate would leave every
          // mark off by the same fraction and blur all of them together.
          minorPath.rect(gridDotEdge(x, sw), gridDotEdge(l * pitch, sh), sw, sh);
        }
      }
    }
    geom = { key, minor: minorPath, major: majorPath };
    geomCache.set(ctx, geom);
  }

  const tx = worldToDeviceX(view, iA * step + ox);
  const ty = worldToDeviceY(view, jA * step + oy);
  // The dot path is already snapped point by point, so the offset it rides on
  // has to be whole pixels too — a fractional translate would put every
  // snapped mark back between pixels and undo the snapping.
  if (style === 'dots') ctx.translate(Math.round(tx), Math.round(ty));
  else ctx.translate(tx, ty);
  if (style === 'dots') {
    ctx.fillStyle = opts.color;
    ctx.fill(geom.minor);
  } else {
    ctx.strokeStyle = opts.color;
    ctx.setLineDash([]);
    ctx.lineWidth = minorW;
    ctx.stroke(geom.minor);
    ctx.lineWidth = majorW;
    ctx.stroke(geom.major);
  }
  ctx.restore();
}

/** Everything `blitCursor` reads. */
export interface CrosshairOptions {
  /** `WINDOW_SETTINGS::cursor.cross_hair_mode`. */
  mode?: CrosshairMode;
  /** The frame's `GetCursorColor()`. */
  color: string;
  /** `m_isCursorEnabled` — the active tool asked for a crosshair. */
  toolWantsCursor?: boolean;
  /** `m_forceDisplayCursor` — "Always show crosshairs". */
  alwaysShow?: boolean;
  /** GAL's `m_scaleFactor`; the pen is 1 logical px (`glLineWidth( 1.0 )`). */
  devicePixelRatio?: number;
}

/**
 * `blitCursor` (`cairo_gal.cpp:1204-1235`, `opengl_gal.cpp:2823-2915`).
 *
 * `cursor` is already in device pixels and already snapped — upstream draws at
 * `m_cursorPosition`, which the tools set through
 * `VIEW_CONTROLS::ForceCursorPosition`/the grid helper, so the crosshair marks
 * where the click will land rather than where the pointer is. Pass null to draw
 * nothing (the pointer has left the canvas).
 *
 * The caller's transform is saved and restored.
 */
export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  cursor: { x: number; y: number } | null,
  widthPx: number,
  heightPx: number,
  opts: CrosshairOptions,
): void {
  if (!cursor) return;
  const alpha = cursorAlphaFactor(opts.toolWantsCursor ?? false, opts.alwaysShow ?? false);
  if (alpha === null) return;
  const dpr = opts.devicePixelRatio && opts.devicePixelRatio > 0 ? opts.devicePixelRatio : 1;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Clip so the 45-degree lines (deliberately oversized upstream) and the
  // full-window ones never spill past the canvas.
  ctx.beginPath();
  ctx.rect(0, 0, widthPx, heightPx);
  ctx.clip();
  ctx.strokeStyle = dimmedCursorColor(opts.color, alpha);
  ctx.lineWidth = Math.max(1, dpr);
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const s of crosshairSegments(opts.mode ?? 'small', cursor, widthPx, heightPx, dpr)) {
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
  ctx.restore();
}
