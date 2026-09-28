// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `<cairo.h>`, the part of it KiCad's Cairo GAL calls, over the browser's
 * Canvas 2D context.
 *
 * There is no libcairo in the page. The ported classes (`cairo_gal.ts`,
 * `cairo_compositor.ts`, `cairo_print.ts`) call these functions by Cairo's own
 * names with Cairo's own arguments, so they read line for line like the C++;
 * this module is where Cairo's semantics are rebuilt on a
 * `CanvasRenderingContext2D` (or its `OffscreenCanvas` twin).
 *
 * Every rule below that is not obvious was put to the installed libcairo
 * 1.18.0 through pycairo: `qa/probes/cairo_semantics_probe.py`.
 *
 * ## How the model maps
 *
 * - **The path is Cairo's, not the canvas's.** A `cairo_t` keeps its own path
 *   record (each segment with the user-to-device matrix it was added under) and
 *   replays it onto the canvas at `cairo_fill` / `cairo_stroke`. That is what
 *   gives `cairo_new_sub_path`, `cairo_copy_path` / `cairo_append_path` and the
 *   `_preserve` variants their Cairo meaning: a canvas path survives `fill()`
 *   and `stroke()` (Cairo's clears unless `_preserve`), has no way to drop the
 *   current point without starting a subpath, and cannot be copied.
 * - **The graphics state is Cairo's.** `cairo_save` / `cairo_restore` push and
 *   pop the CTM, pen, source, operator and fill rule here; the path is not part
 *   of it (probe 11). The canvas's own save/restore is never used.
 * - **The pen is in user space at stroke time**, the canvas's rule too: the
 *   replay puts each segment down under its own matrix, then sets the CTM
 *   before `stroke()`.
 *
 * ## Where Canvas 2D is not Cairo (each handled here, or stated)
 *
 * 1. **Arcs past a full turn.** `cairo_arc` normalises `angle2 >= angle1` by
 *    whole turns and then draws the WHOLE sweep, so 0 to 3π is one and a half
 *    turns ending at 3π (probe 2). A canvas `arc()` stops at one turn and ends
 *    where it started. A sweep over 2π is cut into pieces of at most π here,
 *    so the end point and the winding count are Cairo's.
 * 2. **Radius <= 0.** Canvas throws `IndexSizeError` on a negative radius;
 *    Cairo draws two `line_to`s to the centre (a move and a line with no
 *    current point, one line with one; probes 4, 18). Done here as Cairo does.
 * 3. **Line width 0.** `lineWidth = 0` is ignored by a canvas (the old width
 *    stays); Cairo accepts it and a stroke then paints nothing (probe 16). A
 *    negative width is 0 in Cairo. A zero-width stroke is skipped here.
 * 4. **Operators.** `CLEAR` and `SOURCE` are bounded by the shape in Cairo
 *    (probe 17); canvas `copy` is not. `CLEAR` is `destination-out` with an
 *    opaque pen; `SOURCE` is `destination-out` then `lighter` (the sum is
 *    src·mask + dst·(1 - mask), Cairo's formula). `DIFFERENCE` and `OVER` are
 *    the canvas modes of the same name. The rest of Cairo's list is mapped where
 *    the canvas has the same mode, and throws where it does not.
 * 5. **Colour quantisation.** Cairo stores a channel as
 *    `(int)( c * 65535 + 0.5 )` and an ARGB32 surface keeps its top byte
 *    (probe 21: 0 mismatches in 10 001 values, against 2 480 for
 *    `c * 255 + 0.5`). The CSS colour handed to the canvas is that byte, so an
 *    opaque colour lands on the same byte Cairo would write. Premultiplying a
 *    translucent one is the browser's arithmetic, not pixman's: a byte may
 *    differ by one.
 * 6. **Antialiasing cannot be chosen.** `cairo_set_antialias` is kept in the
 *    state and read back, but a canvas always antialiases its paths, so
 *    `CAIRO_ANTIALIAS_NONE` (KiCad's `AA_NONE`) still renders smooth edges.
 * 7. **Fixed point.** Cairo rounds every path coordinate to 24.8 fixed point
 *    (1/256 px); a canvas keeps floats. The GAL snaps its coordinates to whole
 *    or half pixels first (`roundp`), which both represent exactly.
 * 8. **Arcs are Béziers in Cairo** (its tolerance picks the count); a canvas
 *    draws the exact circle. The difference is below a tenth of a pixel at
 *    Cairo's default tolerance.
 * 9. **Image filtering.** A surface source is drawn with the canvas's image
 *    smoothing, not Cairo's `CAIRO_FILTER_GOOD`.
 * 10. **Surfaces are canvases.** `cairo_image_surface_create` asks a factory
 *    for an `OffscreenCanvas` (a DOM `<canvas>` where there is none), so pixel
 *    data is reached through `getImageData` / `putImageData`, which are
 *    straight-alpha where Cairo's ARGB32 is premultiplied.
 */

/// `cairo_matrix_t`: x' = xx·x + xy·y + x0, y' = yx·x + yy·y + y0.
export interface cairo_matrix_t {
  xx: number;
  yx: number;
  xy: number;
  yy: number;
  x0: number;
  y0: number;
}

export enum cairo_format_t {
  CAIRO_FORMAT_INVALID = -1,
  CAIRO_FORMAT_ARGB32 = 0,
  CAIRO_FORMAT_RGB24 = 1,
  CAIRO_FORMAT_A8 = 2,
  CAIRO_FORMAT_A1 = 3,
  CAIRO_FORMAT_RGB16_565 = 4,
  CAIRO_FORMAT_RGB30 = 5,
}

export enum cairo_line_cap_t {
  CAIRO_LINE_CAP_BUTT,
  CAIRO_LINE_CAP_ROUND,
  CAIRO_LINE_CAP_SQUARE,
}

export enum cairo_line_join_t {
  CAIRO_LINE_JOIN_MITER,
  CAIRO_LINE_JOIN_ROUND,
  CAIRO_LINE_JOIN_BEVEL,
}

export enum cairo_fill_rule_t {
  CAIRO_FILL_RULE_WINDING,
  CAIRO_FILL_RULE_EVEN_ODD,
}

export enum cairo_antialias_t {
  CAIRO_ANTIALIAS_DEFAULT,
  CAIRO_ANTIALIAS_NONE,
  CAIRO_ANTIALIAS_GRAY,
  CAIRO_ANTIALIAS_SUBPIXEL,
  CAIRO_ANTIALIAS_FAST,
  CAIRO_ANTIALIAS_GOOD,
  CAIRO_ANTIALIAS_BEST,
}

export enum cairo_operator_t {
  CAIRO_OPERATOR_CLEAR,
  CAIRO_OPERATOR_SOURCE,
  CAIRO_OPERATOR_OVER,
  CAIRO_OPERATOR_IN,
  CAIRO_OPERATOR_OUT,
  CAIRO_OPERATOR_ATOP,
  CAIRO_OPERATOR_DEST,
  CAIRO_OPERATOR_DEST_OVER,
  CAIRO_OPERATOR_DEST_IN,
  CAIRO_OPERATOR_DEST_OUT,
  CAIRO_OPERATOR_DEST_ATOP,
  CAIRO_OPERATOR_XOR,
  CAIRO_OPERATOR_ADD,
  CAIRO_OPERATOR_SATURATE,
  CAIRO_OPERATOR_MULTIPLY,
  CAIRO_OPERATOR_SCREEN,
  CAIRO_OPERATOR_OVERLAY,
  CAIRO_OPERATOR_DARKEN,
  CAIRO_OPERATOR_LIGHTEN,
  CAIRO_OPERATOR_COLOR_DODGE,
  CAIRO_OPERATOR_COLOR_BURN,
  CAIRO_OPERATOR_HARD_LIGHT,
  CAIRO_OPERATOR_SOFT_LIGHT,
  CAIRO_OPERATOR_DIFFERENCE,
  CAIRO_OPERATOR_EXCLUSION,
  CAIRO_OPERATOR_HSL_HUE,
  CAIRO_OPERATOR_HSL_SATURATION,
  CAIRO_OPERATOR_HSL_COLOR,
  CAIRO_OPERATOR_HSL_LUMINOSITY,
}

/**
 * The drawing calls a Canvas 2D context has and the adapter makes: what
 * `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D` share.
 */
export type CANVAS_2D = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'bezierCurveTo'
  | 'arc'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'clearRect'
  | 'drawImage'
  | 'createImageData'
  | 'putImageData'
  | 'getImageData'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'miterLimit'
  | 'fillStyle'
  | 'strokeStyle'
  | 'globalAlpha'
  | 'globalCompositeOperation'
>;

/** What a surface is backed by: a canvas's 2D context, and the canvas itself to draw from. */
export interface CAIRO_SURFACE_BACKING {
  readonly ctx: CANVAS_2D;
  readonly image: CanvasImageSource;
}

/** Makes the canvas behind `cairo_image_surface_create( format, w, h )`. */
export type CAIRO_SURFACE_FACTORY = (aWidth: number, aHeight: number) => CAIRO_SURFACE_BACKING;

function defaultSurfaceFactory(aWidth: number, aHeight: number): CAIRO_SURFACE_BACKING {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(Math.max(1, aWidth), Math.max(1, aHeight));
    const ctx = canvas.getContext('2d');

    if (ctx) return { ctx: ctx as unknown as CANVAS_2D, image: canvas };
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, aWidth);
    canvas.height = Math.max(1, aHeight);
    const ctx = canvas.getContext('2d');

    if (ctx) return { ctx, image: canvas };
  }

  throw new Error('Could not create Cairo surface');
}

let s_surfaceFactory: CAIRO_SURFACE_FACTORY = defaultSurfaceFactory;

/**
 * Ours: where image surfaces come from. The default is an `OffscreenCanvas`;
 * a test, or a host with its own canvases, sets another. Returns the previous
 * factory so it can be put back.
 */
export function cairo_set_surface_factory(aFactory: CAIRO_SURFACE_FACTORY): CAIRO_SURFACE_FACTORY {
  const previous = s_surfaceFactory;
  s_surfaceFactory = aFactory;
  return previous;
}

// ---------------------------------------------------------------------------
// Matrices (cairo-matrix.c)
// ---------------------------------------------------------------------------

export function cairo_matrix_init(
  aMatrix: cairo_matrix_t,
  xx: number,
  yx: number,
  xy: number,
  yy: number,
  x0: number,
  y0: number,
): void {
  aMatrix.xx = xx;
  aMatrix.yx = yx;
  aMatrix.xy = xy;
  aMatrix.yy = yy;
  aMatrix.x0 = x0;
  aMatrix.y0 = y0;
}

export function cairo_matrix_init_identity(aMatrix: cairo_matrix_t): void {
  cairo_matrix_init(aMatrix, 1, 0, 0, 1, 0, 0);
}

/** Ours: a fresh identity `cairo_matrix_t`, for a member the C++ declares by value. */
export function cairo_matrix_new(): cairo_matrix_t {
  return { xx: 1, yx: 0, xy: 0, yy: 1, x0: 0, y0: 0 };
}

export function cairo_matrix_copy(aMatrix: cairo_matrix_t): cairo_matrix_t {
  return { ...aMatrix };
}

/**
 * `cairo_matrix_multiply( result, a, b )`: the effect of the result is to apply
 * `a` first, then `b` (probe 7).
 */
export function cairo_matrix_multiply(
  aResult: cairo_matrix_t,
  a: cairo_matrix_t,
  b: cairo_matrix_t,
): void {
  const xx = a.xx * b.xx + a.yx * b.xy;
  const yx = a.xx * b.yx + a.yx * b.yy;
  const xy = a.xy * b.xx + a.yy * b.xy;
  const yy = a.xy * b.yx + a.yy * b.yy;
  const x0 = a.x0 * b.xx + a.y0 * b.xy + b.x0;
  const y0 = a.x0 * b.yx + a.y0 * b.yy + b.y0;

  cairo_matrix_init(aResult, xx, yx, xy, yy, x0, y0);
}

/** Apply a translation first, then `aMatrix`. */
export function cairo_matrix_translate(aMatrix: cairo_matrix_t, tx: number, ty: number): void {
  cairo_matrix_multiply(aMatrix, { xx: 1, yx: 0, xy: 0, yy: 1, x0: tx, y0: ty }, aMatrix);
}

/** Apply a scale first, then `aMatrix`. */
export function cairo_matrix_scale(aMatrix: cairo_matrix_t, sx: number, sy: number): void {
  cairo_matrix_multiply(aMatrix, { xx: sx, yx: 0, xy: 0, yy: sy, x0: 0, y0: 0 }, aMatrix);
}

/** Apply a rotation (radians) first, then `aMatrix`. `cairo_matrix_init_rotate` is (c, s, -s, c). */
export function cairo_matrix_rotate(aMatrix: cairo_matrix_t, aRadians: number): void {
  const s = Math.sin(aRadians);
  const c = Math.cos(aRadians);
  cairo_matrix_multiply(aMatrix, { xx: c, yx: s, xy: -s, yy: c, x0: 0, y0: 0 }, aMatrix);
}

export function cairo_matrix_transform_point(
  aMatrix: cairo_matrix_t,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: aMatrix.xx * x + aMatrix.xy * y + aMatrix.x0,
    y: aMatrix.yx * x + aMatrix.yy * y + aMatrix.y0,
  };
}

export function cairo_matrix_transform_distance(
  aMatrix: cairo_matrix_t,
  dx: number,
  dy: number,
): { x: number; y: number } {
  return { x: aMatrix.xx * dx + aMatrix.xy * dy, y: aMatrix.yx * dx + aMatrix.yy * dy };
}

/** `cairo_matrix_invert`: false (and the matrix untouched) when it is singular. */
export function cairo_matrix_invert(aMatrix: cairo_matrix_t): boolean {
  const det = aMatrix.xx * aMatrix.yy - aMatrix.yx * aMatrix.xy;

  if (det === 0 || !Number.isFinite(det)) return false;

  const xx = aMatrix.yy / det;
  const yx = -aMatrix.yx / det;
  const xy = -aMatrix.xy / det;
  const yy = aMatrix.xx / det;
  const x0 = -(xx * aMatrix.x0 + xy * aMatrix.y0);
  const y0 = -(yx * aMatrix.x0 + yy * aMatrix.y0);

  cairo_matrix_init(aMatrix, xx, yx, xy, yy, x0, y0);
  return true;
}

function matrixEquals(a: cairo_matrix_t, b: cairo_matrix_t): boolean {
  return (
    a.xx === b.xx &&
    a.yx === b.yx &&
    a.xy === b.xy &&
    a.yy === b.yy &&
    a.x0 === b.x0 &&
    a.y0 === b.y0
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** `cairo_surface_t`: an image surface, backed by a canvas. */
export class cairo_surface_t {
  readonly width: number;
  readonly height: number;
  readonly backing: CAIRO_SURFACE_BACKING;
  /** `cairo_surface_set_device_scale`: device units per surface pixel. */
  device_scale: { x: number; y: number } = { x: 1, y: 1 };

  constructor(aBacking: CAIRO_SURFACE_BACKING, aWidth: number, aHeight: number) {
    this.backing = aBacking;
    this.width = aWidth;
    this.height = aHeight;
  }
}

/** `CAIRO_STRIDE_FOR_WIDTH_BPP`: whole bytes, rounded up to a multiple of 4. */
export function cairo_format_stride_for_width(aFormat: cairo_format_t, aWidth: number): number {
  const bpp =
    aFormat === cairo_format_t.CAIRO_FORMAT_A1
      ? 1
      : aFormat === cairo_format_t.CAIRO_FORMAT_A8
        ? 8
        : aFormat === cairo_format_t.CAIRO_FORMAT_RGB16_565
          ? 16
          : 32;

  return ((Math.trunc((bpp * aWidth + 7) / 8) + 3) & ~3) >>> 0;
}

export function cairo_image_surface_create(
  aFormat: cairo_format_t,
  aWidth: number,
  aHeight: number,
): cairo_surface_t {
  return new cairo_surface_t(s_surfaceFactory(aWidth, aHeight), aWidth, aHeight);
}

/**
 * `cairo_image_surface_create_for_data`: a surface over storage the caller
 * owns. The storage is a canvas here, where the C++ hands over a byte buffer.
 */
export function cairo_image_surface_create_for_data(
  aData: CAIRO_SURFACE_BACKING,
  aFormat: cairo_format_t,
  aWidth: number,
  aHeight: number,
  aStride: number,
): cairo_surface_t {
  return new cairo_surface_t(aData, aWidth, aHeight);
}

export function cairo_image_surface_get_width(aSurface: cairo_surface_t): number {
  return aSurface.width;
}

export function cairo_image_surface_get_height(aSurface: cairo_surface_t): number {
  return aSurface.height;
}

export function cairo_surface_set_device_scale(
  aSurface: cairo_surface_t,
  aXScale: number,
  aYScale: number,
): void {
  aSurface.device_scale = { x: aXScale, y: aYScale };
}

/** A canvas has no pending batch to flush, and nothing to mark: these are no-ops. */
export function cairo_surface_flush(aSurface: cairo_surface_t): void {}
export function cairo_surface_mark_dirty(aSurface: cairo_surface_t): void {}
/** Reference counting is the garbage collector's. */
export function cairo_surface_destroy(aSurface: cairo_surface_t | null): void {}
export function cairo_surface_reference(aSurface: cairo_surface_t): cairo_surface_t {
  return aSurface;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

type PATH_OP =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  | { op: 'Z' }
  | { op: 'A'; xc: number; yc: number; r: number; a1: number; a2: number; ccw: boolean };

/** One segment, and the user-to-device matrix it was added under. */
interface PATH_ELEMENT {
  seg: PATH_OP;
  m: cairo_matrix_t;
}

/**
 * `cairo_path_t`, as `cairo_copy_path` returns it: in the user space of the
 * CTM at copy time (probe 8), so `cairo_append_path` re-transforms it by the
 * CTM it is appended under. Each segment keeps the matrix from its own user
 * space to that copy-time user space.
 */
export interface cairo_path_t {
  readonly data: readonly PATH_ELEMENT[];
}

export function cairo_path_destroy(aPath: cairo_path_t | null): void {}

// ---------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------

type SOURCE =
  | { kind: 'rgba'; r: number; g: number; b: number; a: number }
  | { kind: 'surface'; surface: cairo_surface_t; x: number; y: number; m: cairo_matrix_t };

interface GSTATE {
  matrix: cairo_matrix_t;
  lineWidth: number;
  lineCap: cairo_line_cap_t;
  lineJoin: cairo_line_join_t;
  miterLimit: number;
  source: SOURCE;
  op: cairo_operator_t;
  fillRule: cairo_fill_rule_t;
  antialias: cairo_antialias_t;
}

/** Cairo's defaults (probe 10): a 2.0 pen, butt caps, miter joins, winding, OVER, opaque black. */
function defaultGstate(): GSTATE {
  return {
    matrix: cairo_matrix_new(),
    lineWidth: 2.0,
    lineCap: cairo_line_cap_t.CAIRO_LINE_CAP_BUTT,
    lineJoin: cairo_line_join_t.CAIRO_LINE_JOIN_MITER,
    miterLimit: 10.0,
    source: { kind: 'rgba', r: 0, g: 0, b: 0, a: 1 },
    op: cairo_operator_t.CAIRO_OPERATOR_OVER,
    fillRule: cairo_fill_rule_t.CAIRO_FILL_RULE_WINDING,
    antialias: cairo_antialias_t.CAIRO_ANTIALIAS_DEFAULT,
  };
}

function cloneGstate(g: GSTATE): GSTATE {
  return { ...g, matrix: cairo_matrix_copy(g.matrix) };
}

/**
 * A channel as an ARGB32 surface stores it: `_cairo_color_double_to_short`
 * (`c * 65535 + 0.5`, truncated), top byte kept (probe 21). Out-of-range values
 * are clamped first, as `cairo_set_source_rgba` does.
 */
export function cairoChannelByte(c: number): number {
  const clamped = c < 0 ? 0 : c > 1 ? 1 : c;
  return Math.trunc(clamped * 65535.0 + 0.5) >> 8;
}

function cssColor(r: number, g: number, b: number, a: number): string {
  const alpha = cairoChannelByte(a) / 255;
  return `rgba(${cairoChannelByte(r)}, ${cairoChannelByte(g)}, ${cairoChannelByte(b)}, ${alpha})`;
}

const LINE_CAP: Record<cairo_line_cap_t, CanvasLineCap> = {
  [cairo_line_cap_t.CAIRO_LINE_CAP_BUTT]: 'butt',
  [cairo_line_cap_t.CAIRO_LINE_CAP_ROUND]: 'round',
  [cairo_line_cap_t.CAIRO_LINE_CAP_SQUARE]: 'square',
};

const LINE_JOIN: Record<cairo_line_join_t, CanvasLineJoin> = {
  [cairo_line_join_t.CAIRO_LINE_JOIN_MITER]: 'miter',
  [cairo_line_join_t.CAIRO_LINE_JOIN_ROUND]: 'round',
  [cairo_line_join_t.CAIRO_LINE_JOIN_BEVEL]: 'bevel',
};

/** The Cairo operators a canvas has a mode for. CLEAR and SOURCE are built from two. */
const COMPOSITE_OP: Partial<Record<cairo_operator_t, GlobalCompositeOperation>> = {
  [cairo_operator_t.CAIRO_OPERATOR_OVER]: 'source-over',
  [cairo_operator_t.CAIRO_OPERATOR_IN]: 'source-in',
  [cairo_operator_t.CAIRO_OPERATOR_OUT]: 'source-out',
  [cairo_operator_t.CAIRO_OPERATOR_ATOP]: 'source-atop',
  [cairo_operator_t.CAIRO_OPERATOR_DEST_OVER]: 'destination-over',
  [cairo_operator_t.CAIRO_OPERATOR_DEST_IN]: 'destination-in',
  [cairo_operator_t.CAIRO_OPERATOR_DEST_OUT]: 'destination-out',
  [cairo_operator_t.CAIRO_OPERATOR_DEST_ATOP]: 'destination-atop',
  [cairo_operator_t.CAIRO_OPERATOR_XOR]: 'xor',
  [cairo_operator_t.CAIRO_OPERATOR_ADD]: 'lighter',
  [cairo_operator_t.CAIRO_OPERATOR_MULTIPLY]: 'multiply',
  [cairo_operator_t.CAIRO_OPERATOR_SCREEN]: 'screen',
  [cairo_operator_t.CAIRO_OPERATOR_OVERLAY]: 'overlay',
  [cairo_operator_t.CAIRO_OPERATOR_DARKEN]: 'darken',
  [cairo_operator_t.CAIRO_OPERATOR_LIGHTEN]: 'lighten',
  [cairo_operator_t.CAIRO_OPERATOR_COLOR_DODGE]: 'color-dodge',
  [cairo_operator_t.CAIRO_OPERATOR_COLOR_BURN]: 'color-burn',
  [cairo_operator_t.CAIRO_OPERATOR_HARD_LIGHT]: 'hard-light',
  [cairo_operator_t.CAIRO_OPERATOR_SOFT_LIGHT]: 'soft-light',
  [cairo_operator_t.CAIRO_OPERATOR_DIFFERENCE]: 'difference',
  [cairo_operator_t.CAIRO_OPERATOR_EXCLUSION]: 'exclusion',
  [cairo_operator_t.CAIRO_OPERATOR_HSL_HUE]: 'hue',
  [cairo_operator_t.CAIRO_OPERATOR_HSL_SATURATION]: 'saturation',
  [cairo_operator_t.CAIRO_OPERATOR_HSL_COLOR]: 'color',
  [cairo_operator_t.CAIRO_OPERATOR_HSL_LUMINOSITY]: 'luminosity',
};

const OPAQUE = 'rgba(0, 0, 0, 1)';
const IDENTITY: cairo_matrix_t = { xx: 1, yx: 0, xy: 0, yy: 1, x0: 0, y0: 0 };

/** `cairo_t`: a drawing context on one surface. */
export class cairo_t {
  readonly target: cairo_surface_t;
  private gstate: GSTATE = defaultGstate();
  private stack: GSTATE[] = [];
  private path: PATH_ELEMENT[] = [];
  /** The current point, in device space; null when there is none. */
  private currentPoint: { x: number; y: number } | null = null;
  /** Where the current subpath started, in device space: `close_path` returns there. */
  private subpathStart: { x: number; y: number } | null = null;

  constructor(aTarget: cairo_surface_t) {
    this.target = aTarget;
  }

  private get ctx(): CANVAS_2D {
    return this.target.backing.ctx;
  }

  // --- state ---------------------------------------------------------------

  save(): void {
    this.stack.push(cloneGstate(this.gstate));
  }

  restore(): void {
    const g = this.stack.pop();

    if (g) this.gstate = g;
  }

  getMatrix(): cairo_matrix_t {
    return cairo_matrix_copy(this.gstate.matrix);
  }

  setMatrix(aMatrix: cairo_matrix_t): void {
    this.gstate.matrix = cairo_matrix_copy(aMatrix);
  }

  get state(): Readonly<GSTATE> {
    return this.gstate;
  }

  setLineWidth(aWidth: number): void {
    this.gstate.lineWidth = aWidth < 0 ? 0 : aWidth;
  }

  setLineCap(aCap: cairo_line_cap_t): void {
    this.gstate.lineCap = aCap;
  }

  setLineJoin(aJoin: cairo_line_join_t): void {
    this.gstate.lineJoin = aJoin;
  }

  setFillRule(aRule: cairo_fill_rule_t): void {
    this.gstate.fillRule = aRule;
  }

  setOperator(aOp: cairo_operator_t): void {
    this.gstate.op = aOp;
  }

  setAntialias(aAntialias: cairo_antialias_t): void {
    this.gstate.antialias = aAntialias;
  }

  setSourceRgba(r: number, g: number, b: number, a: number): void {
    this.gstate.source = { kind: 'rgba', r, g, b, a };
  }

  setSourceSurface(aSurface: cairo_surface_t, x: number, y: number): void {
    this.gstate.source = {
      kind: 'surface',
      surface: aSurface,
      x,
      y,
      m: cairo_matrix_copy(this.gstate.matrix),
    };
  }

  // --- path ----------------------------------------------------------------

  private push(aSeg: PATH_OP, aMatrix: cairo_matrix_t = this.gstate.matrix): void {
    this.path.push({ seg: aSeg, m: cairo_matrix_copy(aMatrix) });
  }

  private device(x: number, y: number, m = this.gstate.matrix): { x: number; y: number } {
    return cairo_matrix_transform_point(m, x, y);
  }

  newPath(): void {
    this.path = [];
    this.currentPoint = null;
    this.subpathStart = null;
  }

  newSubPath(): void {
    this.currentPoint = null;
  }

  moveTo(x: number, y: number): void {
    this.push({ op: 'M', x, y });
    this.currentPoint = this.device(x, y);
    this.subpathStart = this.currentPoint;
  }

  /** With no current point, a `line_to` is a `move_to`. */
  lineTo(x: number, y: number): void {
    if (!this.currentPoint) {
      this.moveTo(x, y);
      return;
    }

    this.push({ op: 'L', x, y });
    this.currentPoint = this.device(x, y);
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    if (!this.currentPoint) this.moveTo(x1, y1);

    this.push({ op: 'C', x1, y1, x2, y2, x3, y3 });
    this.currentPoint = this.device(x3, y3);
  }

  closePath(): void {
    if (!this.currentPoint) return;

    this.push({ op: 'Z' });
    this.currentPoint = this.subpathStart;
  }

  /** `cairo_rectangle`: move, three relative lines, close (probe 19). */
  rectangle(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  /**
   * `cairo_arc` / `cairo_arc_negative` after their angle normalisation:
   * `_cairo_default_context_arc`.
   */
  arc(xc: number, yc: number, r: number, a1: number, a2: number, aForward: boolean): void {
    // radius <= 0: two line_to's to the centre, the second dropped when it repeats a line_to
    if (r <= 0.0) {
      const hadPoint = this.currentPoint !== null;
      this.lineTo(xc, yc);

      if (!hadPoint) this.lineTo(xc, yc);

      return;
    }

    const startX = xc + r * Math.cos(a1);
    const startY = yc + r * Math.sin(a1);

    // line_to the start: a move_to when there is no current point
    if (!this.currentPoint) this.moveTo(startX, startY);

    // The whole sweep, as Cairo draws it: past a full turn, in pieces of at most pi.
    const sweep = Math.abs(a2 - a1);

    if (sweep > 2 * Math.PI) {
      const n = Math.ceil(sweep / Math.PI);
      const step = (a2 - a1) / n;

      for (let i = 0; i < n; i++) {
        const from = a1 + i * step;
        const to = i === n - 1 ? a2 : a1 + (i + 1) * step;
        this.push({ op: 'A', xc, yc, r, a1: from, a2: to, ccw: !aForward });
      }
    } else {
      this.push({ op: 'A', xc, yc, r, a1, a2, ccw: !aForward });
    }

    this.currentPoint = this.device(xc + r * Math.cos(a2), yc + r * Math.sin(a2));
  }

  copyPath(): cairo_path_t {
    const inverse = cairo_matrix_copy(this.gstate.matrix);
    cairo_matrix_invert(inverse);

    return {
      data: this.path.map((e) => {
        const rel = cairo_matrix_new();
        cairo_matrix_multiply(rel, e.m, inverse);
        return { seg: e.seg, m: rel };
      }),
    };
  }

  appendPath(aPath: cairo_path_t): void {
    for (const e of aPath.data) {
      const m = cairo_matrix_new();
      cairo_matrix_multiply(m, e.m, this.gstate.matrix);
      this.path.push({ seg: e.seg, m });

      const s = e.seg;

      switch (s.op) {
        case 'M':
          this.currentPoint = this.device(s.x, s.y, m);
          this.subpathStart = this.currentPoint;
          break;
        case 'L':
          this.currentPoint = this.device(s.x, s.y, m);
          break;
        case 'C':
          this.currentPoint = this.device(s.x3, s.y3, m);
          break;
        case 'Z':
          this.currentPoint = this.subpathStart;
          break;
        case 'A':
          this.currentPoint = this.device(
            s.xc + s.r * Math.cos(s.a2),
            s.yc + s.r * Math.sin(s.a2),
            m,
          );
          break;
      }
    }
  }

  // --- replay onto the canvas ------------------------------------------------

  private setCanvasTransform(m: cairo_matrix_t): void {
    this.ctx.setTransform(m.xx, m.yx, m.xy, m.yy, m.x0, m.y0);
  }

  /** The recorded path, onto the canvas, each segment under its own matrix. */
  private emitPath(): void {
    const ctx = this.ctx;
    let last: cairo_matrix_t | null = null;

    ctx.beginPath();

    for (const e of this.path) {
      if (!last || !matrixEquals(last, e.m)) {
        this.setCanvasTransform(e.m);
        last = e.m;
      }

      const s = e.seg;

      switch (s.op) {
        case 'M':
          ctx.moveTo(s.x, s.y);
          break;
        case 'L':
          ctx.lineTo(s.x, s.y);
          break;
        case 'C':
          ctx.bezierCurveTo(s.x1, s.y1, s.x2, s.y2, s.x3, s.y3);
          break;
        case 'Z':
          ctx.closePath();
          break;
        case 'A':
          ctx.arc(s.xc, s.yc, s.r, s.a1, s.a2, s.ccw);
          break;
      }
    }
  }

  private sourceStyle(): string | CanvasPattern {
    const src = this.gstate.source;

    if (src.kind === 'rgba') return cssColor(src.r, src.g, src.b, src.a);

    // A surface source over a path is not something the Cairo GAL does.
    throw new Error('cairo adapter: a surface source can only be painted');
  }

  /** Paint the replayed path with the current operator: `aPaint` fills or strokes it. */
  private composite(aPaint: (aStyle: string | CanvasPattern) => void): void {
    const ctx = this.ctx;
    const op = this.gstate.op;

    ctx.globalAlpha = 1;

    if (op === cairo_operator_t.CAIRO_OPERATOR_CLEAR) {
      ctx.globalCompositeOperation = 'destination-out';
      aPaint(OPAQUE);
    } else if (op === cairo_operator_t.CAIRO_OPERATOR_SOURCE) {
      // Bounded SOURCE: dst·(1 - mask), then + src·mask.
      ctx.globalCompositeOperation = 'destination-out';
      aPaint(OPAQUE);
      ctx.globalCompositeOperation = 'lighter';
      aPaint(this.sourceStyle());
    } else if (op === cairo_operator_t.CAIRO_OPERATOR_DEST) {
      // leaves the destination alone
    } else {
      const mode = COMPOSITE_OP[op];

      if (!mode)
        throw new Error(`cairo adapter: operator ${cairo_operator_t[op]} has no canvas mode`);

      ctx.globalCompositeOperation = mode;
      aPaint(this.sourceStyle());
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  fill(aPreserve: boolean): void {
    this.emitPath();

    const rule: CanvasFillRule =
      this.gstate.fillRule === cairo_fill_rule_t.CAIRO_FILL_RULE_EVEN_ODD ? 'evenodd' : 'nonzero';

    this.composite((aStyle) => {
      this.ctx.fillStyle = aStyle;
      this.ctx.fill(rule);
    });

    if (!aPreserve) this.newPath();
  }

  stroke(aPreserve: boolean): void {
    const g = this.gstate;

    // A zero-width pen paints nothing in Cairo; a canvas would keep its old width.
    if (g.lineWidth > 0) {
      this.emitPath();

      const ctx = this.ctx;
      this.setCanvasTransform(g.matrix);
      ctx.lineWidth = g.lineWidth;
      ctx.lineCap = LINE_CAP[g.lineCap];
      ctx.lineJoin = LINE_JOIN[g.lineJoin];
      ctx.miterLimit = g.miterLimit;

      this.composite((aStyle) => {
        ctx.strokeStyle = aStyle;
        ctx.stroke();
      });
    }

    if (!aPreserve) this.newPath();
  }

  /** `cairo_paint_with_alpha`: the source over the whole surface. */
  paint(aAlpha: number): void {
    const ctx = this.ctx;
    const src = this.gstate.source;
    const op = this.gstate.op;

    if (src.kind === 'surface') {
      const mode =
        op === cairo_operator_t.CAIRO_OPERATOR_CLEAR ? 'destination-out' : COMPOSITE_OP[op];

      if (!mode)
        throw new Error(`cairo adapter: operator ${cairo_operator_t[op]} has no canvas mode`);

      this.setCanvasTransform(src.m);
      ctx.globalAlpha = aAlpha;
      ctx.globalCompositeOperation = mode;
      ctx.drawImage(src.surface.backing.image, src.x, src.y);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    this.setCanvasTransform(IDENTITY);
    const whole = (aStyle: string | CanvasPattern): void => {
      ctx.fillStyle = aStyle;
      ctx.fillRect(0, 0, this.target.width, this.target.height);
    };

    this.composite(whole);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// The C API, by Cairo's names
// ---------------------------------------------------------------------------

export function cairo_create(aTarget: cairo_surface_t): cairo_t {
  return new cairo_t(aTarget);
}

export function cairo_destroy(cr: cairo_t | null): void {}

export function cairo_reference(cr: cairo_t): cairo_t {
  return cr;
}

export function cairo_get_target(cr: cairo_t): cairo_surface_t {
  return cr.target;
}

export function cairo_save(cr: cairo_t): void {
  cr.save();
}

export function cairo_restore(cr: cairo_t): void {
  cr.restore();
}

export function cairo_set_source_rgba(
  cr: cairo_t,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  cr.setSourceRgba(r, g, b, a);
}

export function cairo_set_source_surface(
  cr: cairo_t,
  aSurface: cairo_surface_t,
  x: number,
  y: number,
): void {
  cr.setSourceSurface(aSurface, x, y);
}

export function cairo_set_operator(cr: cairo_t, aOp: cairo_operator_t): void {
  cr.setOperator(aOp);
}

export function cairo_get_operator(cr: cairo_t): cairo_operator_t {
  return cr.state.op;
}

export function cairo_set_antialias(cr: cairo_t, aAntialias: cairo_antialias_t): void {
  cr.setAntialias(aAntialias);
}

export function cairo_get_antialias(cr: cairo_t): cairo_antialias_t {
  return cr.state.antialias;
}

export function cairo_set_line_width(cr: cairo_t, aWidth: number): void {
  cr.setLineWidth(aWidth);
}

export function cairo_get_line_width(cr: cairo_t): number {
  return cr.state.lineWidth;
}

export function cairo_set_line_cap(cr: cairo_t, aCap: cairo_line_cap_t): void {
  cr.setLineCap(aCap);
}

export function cairo_set_line_join(cr: cairo_t, aJoin: cairo_line_join_t): void {
  cr.setLineJoin(aJoin);
}

export function cairo_set_fill_rule(cr: cairo_t, aRule: cairo_fill_rule_t): void {
  cr.setFillRule(aRule);
}

export function cairo_get_fill_rule(cr: cairo_t): cairo_fill_rule_t {
  return cr.state.fillRule;
}

// Transformations: each applies its operation first, then the existing CTM.

export function cairo_translate(cr: cairo_t, tx: number, ty: number): void {
  const m = cr.getMatrix();
  cairo_matrix_translate(m, tx, ty);
  cr.setMatrix(m);
}

export function cairo_scale(cr: cairo_t, sx: number, sy: number): void {
  const m = cr.getMatrix();
  cairo_matrix_scale(m, sx, sy);
  cr.setMatrix(m);
}

export function cairo_rotate(cr: cairo_t, aAngle: number): void {
  const m = cr.getMatrix();
  cairo_matrix_rotate(m, aAngle);
  cr.setMatrix(m);
}

export function cairo_transform(cr: cairo_t, aMatrix: cairo_matrix_t): void {
  const m = cairo_matrix_new();
  cairo_matrix_multiply(m, aMatrix, cr.getMatrix());
  cr.setMatrix(m);
}

export function cairo_set_matrix(cr: cairo_t, aMatrix: cairo_matrix_t): void {
  cr.setMatrix(aMatrix);
}

export function cairo_get_matrix(cr: cairo_t, aMatrix: cairo_matrix_t): void {
  Object.assign(aMatrix, cr.getMatrix());
}

export function cairo_identity_matrix(cr: cairo_t): void {
  cr.setMatrix(cairo_matrix_new());
}

/** `cairo_device_to_user_distance` (probe 9): the inverse CTM, without its translation. */
export function cairo_device_to_user_distance(
  cr: cairo_t,
  aDx: number,
  aDy: number,
): { x: number; y: number } {
  const inverse = cr.getMatrix();

  if (!cairo_matrix_invert(inverse)) return { x: aDx, y: aDy };

  return cairo_matrix_transform_distance(inverse, aDx, aDy);
}

export function cairo_new_path(cr: cairo_t): void {
  cr.newPath();
}

export function cairo_new_sub_path(cr: cairo_t): void {
  cr.newSubPath();
}

export function cairo_move_to(cr: cairo_t, x: number, y: number): void {
  cr.moveTo(x, y);
}

export function cairo_line_to(cr: cairo_t, x: number, y: number): void {
  cr.lineTo(x, y);
}

export function cairo_curve_to(
  cr: cairo_t,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): void {
  cr.curveTo(x1, y1, x2, y2, x3, y3);
}

export function cairo_close_path(cr: cairo_t): void {
  cr.closePath();
}

export function cairo_rectangle(cr: cairo_t, x: number, y: number, w: number, h: number): void {
  cr.rectangle(x, y, w, h);
}

/**
 * `cairo_arc`: `angle2` is raised by whole turns until it is not below
 * `angle1` (cairo.c), then the arc runs forward.
 */
export function cairo_arc(
  cr: cairo_t,
  xc: number,
  yc: number,
  radius: number,
  angle1: number,
  angle2: number,
): void {
  if (angle2 < angle1) {
    // increase angle2 by multiples of full circle until it satisfies angle2 >= angle1
    angle2 = (angle2 - angle1) % (2 * Math.PI); // fmod
    if (angle2 < 0) angle2 += 2 * Math.PI;
    angle2 += angle1;
  }

  cr.arc(xc, yc, radius, angle1, angle2, true);
}

/** `cairo_arc_negative`: `angle2` is lowered by whole turns until it is not above `angle1`. */
export function cairo_arc_negative(
  cr: cairo_t,
  xc: number,
  yc: number,
  radius: number,
  angle1: number,
  angle2: number,
): void {
  if (angle2 > angle1) {
    angle2 = (angle2 - angle1) % (2 * Math.PI); // fmod
    if (angle2 > 0) angle2 -= 2 * Math.PI;
    angle2 += angle1;
  }

  cr.arc(xc, yc, radius, angle1, angle2, false);
}

export function cairo_copy_path(cr: cairo_t): cairo_path_t {
  return cr.copyPath();
}

export function cairo_append_path(cr: cairo_t, aPath: cairo_path_t | null): void {
  if (aPath) cr.appendPath(aPath);
}

export function cairo_fill(cr: cairo_t): void {
  cr.fill(false);
}

export function cairo_fill_preserve(cr: cairo_t): void {
  cr.fill(true);
}

export function cairo_stroke(cr: cairo_t): void {
  cr.stroke(false);
}

export function cairo_stroke_preserve(cr: cairo_t): void {
  cr.stroke(true);
}

export function cairo_paint(cr: cairo_t): void {
  cr.paint(1.0);
}

export function cairo_paint_with_alpha(cr: cairo_t, aAlpha: number): void {
  cr.paint(aAlpha);
}
