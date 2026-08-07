// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PNG_PLOTTER, the raster plot back-end, transcribed from
 * common/plotters/PNG_plotter.cpp and include/plotters/plotter_png.h, plus the
 * PLOTTER base members it leans on (the three-point Arc, the MoveTo/LineTo/
 * FinishTo/PenFinish pen wrappers and the Thick* helpers).
 *
 * Every other back-end in this directory writes a *document*: a stream of
 * operators a consumer replays later. This one writes an *image*, and that
 * single difference is behind everything odd about it.
 *
 * 1. **The coordinate transform is inverted.** `PLOTTER::userToDeviceSize` is
 *    `size * m_plotScale * m_iuPerDeviceUnit`; PNG_PLOTTER's override is
 *    `abs( size * m_plotScale / m_iuPerDeviceUnit )` — a divide and an
 *    absolute value. `SetViewport` matches it by storing
 *    `m_IUsPerDecimil * 10000 / m_dpi`, which genuinely is *IU per pixel*,
 *    where the four document back-ends store the reciprocal in the same
 *    inherited field. The member's name is only honest here. The abs is
 *    observable: a negative plot scale still yields a positive radius and pen
 *    width, while `userToDeviceCoordinates` keeps the sign, so a mirrored plot
 *    puts positive-radius circles at negative coordinates.
 * 2. **The line-width sentinels are never resolved.** PS and PDF turn
 *    USE_DEFAULT_LINE_WIDTH into the render settings' default pen;
 *    `PNG_PLOTTER::SetCurrentLineWidth` has no render settings at all and hands
 *    -1 straight to `userToDeviceSize`, where the abs turns it into a positive
 *    sub-pixel width that the `> 0 ? : 1.0` guard then rounds up to one device
 *    unit. `SetDash` likewise ignores `GetDashLength`/`GetDotLength`/
 *    `GetGapLength` and hard-codes 4/2/1 multiples of the width. So this is the
 *    one back-end with no RENDER_SETTINGS dependency whatsoever.
 * 3. **The pen tip is stored in device space.** `PenTo` ends with an
 *    unconditional `m_penLastpos = VECTOR2I( pos.x, pos.y )` where `pos` is the
 *    already-transformed device point — the base class and every other
 *    back-end store the user-space point. The same line also makes the
 *    `m_penLastpos = (-1,-1)` park inside the 'Z' branch dead code: it is
 *    overwritten two statements later, every time.
 * 4. **The path is never explicitly cleared.** Cairo's `fill` and `stroke`
 *    consume the current path, but `Arc` appends with `cairo_arc` and no
 *    `cairo_new_path`, so an arc issued while a pen stroke is open is joined to
 *    it by an implicit line, and `Arc`'s fill branch does not touch the pen at
 *    all. Reproduced as op order; see {@link pngRecordingBackend}.
 *
 * Faithfully reproduced oddities, none of which is to be "fixed": `Rect`
 * accepts `aCornerRadius` and ignores it completely, so a rounded rectangle
 * plots square, and its filled branch ignores the width too; `Arc` truncates
 * its `VECTOR2D` centre to a `VECTOR2I` before transforming it, losing the
 * sub-IU part the double was there to carry, and it selects
 * `cairo_arc_negative` on `aAngle.AsDegrees() < 0` while drawing device-space
 * geometry with user-space angles, so a y-reversed viewport comes out mirrored
 * and upstream does not compensate; `SetColor`'s monochrome branch tests
 * `aColor == COLOR4D::WHITE` with full four-component equality, so a
 * translucent white is not white and lands on black; `StartPlot` validates the
 * pixel size *before* tearing anything down, so a rejected StartPlot leaves the
 * previous plot's surface intact and drawable; `PlotImage` repaints the source
 * without invalidating `m_currentColor`, so the next `SetColor` to the same
 * colour is a cache hit and the image is left as the source; and
 * `FlashRegularPolygon`'s third parameter really is a diameter here, where the
 * same slot on the DXF and PostScript back-ends is a radius.
 *
 * ## The rasterisation bridge
 *
 * Upstream is a **Cairo** back-end. There is no Cairo here, no libpng, and no
 * wxWidgets, so the pixels have to come from somewhere else. Rather than
 * approximate the drawing, this port splits the file the way the file already
 * splits itself:
 *
 * - the *geometry* — the whole PLOTTER interface, the pen model, the transform,
 *   the pad flashes — is ported literally and drives a {@link PngContext}, a
 *   one-for-one transcription of exactly the `cairo_*` entry points the .cpp
 *   calls. It is injected, in the same spirit as the PostScript port's `PsFont`
 *   and `PsImage`;
 * - {@link pngRecordingBackend} implements that interface by *recording* the op
 *   stream. It rasterises nothing, and it is what the tests assert on: every
 *   quirk listed above is visible in the op order without a rasteriser being
 *   involved at all;
 * - {@link pngCanvas2DBackend} implements it against a
 *   `CanvasRenderingContext2D`-shaped object. That is the browser's own
 *   Cairo-equivalent and is where real pixels come from in the application. The
 *   interface is declared structurally here, so this module needs no DOM
 *   import and `qa` can drive it with a plain recorder;
 * - the encoding is `pcbnew/src/png_encoder.ts`, a byte-exact PNG writer
 *   standing in for `cairo_surface_write_to_png`, including cairo's own
 *   un-premultiply arithmetic.
 *
 * ## Deliberate gaps
 *
 * - `FlashPadRoundRect` needs `TransformRoundChamferedRectToPolygon`, which
 *   kimath does not have. It throws rather than approximating.
 * - `Text`/`PlotText` are not overridden upstream — they are `PLOTTER`'s
 *   stroke-font implementations, identical to the ones the PostScript port
 *   already carries behind an injected `PsFont`. Nothing PNG-specific touches
 *   them, so they are absent here rather than transcribed a second time.
 * - `SetAntialias` has no exact Canvas2D counterpart; see
 *   {@link pngCanvas2DBackend}.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE, ANGLE_360 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint, CalcArcCenter } from '@ziroeda/kimath/src/trigo.js';
import {
  pngEncodeRgba8,
  pngPremultiplyRgba8,
  pngUnpremultiplyArgb32,
  type PngEncodeOptions,
} from './png_encoder.js';

/** `FILL_T` (eda_shape.h). NO_FILL is 1, not 0 — never treat this as a boolean. */
export enum FILL_T {
  NO_FILL = 1,
  FILLED_SHAPE,
  FILLED_WITH_BG_BODYCOLOR,
  FILLED_WITH_COLOR,
  HATCH,
  REVERSE_HATCH,
  CROSS_HATCH,
}

/** `LINE_STYLE` (stroke_params.h). */
export enum LINE_STYLE {
  DEFAULT = -1,
  SOLID = 0,
  DASH,
  DOT,
  DASHDOT,
  DASHDOTDOT,
}

/** `PLOTTER::DO_NOT_SET_LINE_WIDTH` / `USE_DEFAULT_LINE_WIDTH` (plotter.h). */
export const DO_NOT_SET_LINE_WIDTH = -2;
export const USE_DEFAULT_LINE_WIDTH = -1;

/** `DEFAULT_PNG_DPI` / `MIN_PNG_DPI` / `MAX_PNG_DPI` (plotter_png.h). */
export const DEFAULT_PNG_DPI = 300;
export const MIN_PNG_DPI = 72;
export const MAX_PNG_DPI = 2400;

/**
 * `MAX_PNG_DIMENSION`, a `constexpr` local to `StartPlot`. Cairo image surfaces
 * top out at INT16_MAX in either dimension; past that, surface creation returns
 * CAIRO_STATUS_INVALID_SIZE, so upstream rejects up front rather than risking a
 * multi-gigabyte allocation that fails late.
 */
export const MAX_PNG_DIMENSION = 32767;

/** COLOR4D, components in 0..1. Equality includes alpha, as COLOR4D's does. */
export interface Color4d {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const COLOR4D_BLACK: Color4d = { r: 0, g: 0, b: 0, a: 1 };
export const COLOR4D_WHITE: Color4d = { r: 1, g: 1, b: 1, a: 1 };

/** `COLOR4D::UNSPECIFIED`, which really is transparent black — color4d.cpp:543. */
export const COLOR4D_UNSPECIFIED: Color4d = { r: 0, g: 0, b: 0, a: 0 };

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

// ===========================================================================
// The Cairo surface the back-end draws on, reduced to what the .cpp calls
// ===========================================================================

/** `cairo_status_t`, reduced to the two values the .cpp compares against. */
export enum CAIRO_STATUS {
  SUCCESS = 0,
  NO_MEMORY = 1,
  INVALID_SIZE = 12,
}

/** `cairo_antialias_t`, reduced to the two `SetAntialias` selects between. */
export enum CAIRO_ANTIALIAS {
  DEFAULT = 1,
  NONE = 2,
}

/** `cairo_operator_t`, reduced to the two `SetClearCompositing` selects between. */
export enum CAIRO_OPERATOR {
  CLEAR = 0,
  OVER = 2,
}

/** `cairo_line_cap_t` / `cairo_line_join_t`. StartPlot only ever picks ROUND. */
export enum CAIRO_LINE_CAP {
  BUTT = 0,
  ROUND = 1,
  SQUARE = 2,
}

export enum CAIRO_LINE_JOIN {
  MITER = 0,
  ROUND = 1,
  BEVEL = 2,
}

/**
 * `cairo_surface_t`, an image surface. Always `CAIRO_FORMAT_ARGB32`: one
 * native-endian 32-bit word per pixel with the colour channels premultiplied by
 * alpha, rows `GetStride()` bytes apart (cairo pads the stride, so it may be
 * wider than `GetWidth() * 4`).
 *
 * `WriteToPng` stands in for `cairo_surface_write_to_png`. There is no
 * filesystem here — the PostScript port's `bytes()` makes the same concession —
 * so it answers with the encoded file, or null for the failure
 * `cairo_surface_write_to_png` would report as a non-SUCCESS status.
 */
export interface PngSurface {
  Status(): CAIRO_STATUS;
  GetWidth(): number;
  GetHeight(): number;
  GetStride(): number;
  GetData(): Uint8Array;
  MarkDirty(): void;
  Flush(): void;
  Destroy(): void;
  WriteToPng(): Uint8Array | null;
}

/**
 * `cairo_t`, reduced to exactly the entry points PNG_plotter.cpp calls — no
 * more, so that a reader can check the port against the .cpp line by line.
 */
export interface PngContext {
  Status(): CAIRO_STATUS;
  Destroy(): void;

  SetAntialias(aMode: CAIRO_ANTIALIAS): void;
  SetOperator(aOperator: CAIRO_OPERATOR): void;
  SetSourceRgba(r: number, g: number, b: number, a: number): void;
  SetLineWidth(aWidth: number): void;
  SetLineCap(aCap: CAIRO_LINE_CAP): void;
  SetLineJoin(aJoin: CAIRO_LINE_JOIN): void;
  /** `cairo_set_dash`. An empty pattern is cairo's `(nullptr, 0, 0)`. */
  SetDash(aDashes: readonly number[], aOffset: number): void;

  MoveTo(x: number, y: number): void;
  LineTo(x: number, y: number): void;
  ClosePath(): void;
  Rectangle(x: number, y: number, w: number, h: number): void;
  Arc(cx: number, cy: number, r: number, a1: number, a2: number): void;
  ArcNegative(cx: number, cy: number, r: number, a1: number, a2: number): void;

  Fill(): void;
  Stroke(): void;
  Paint(): void;

  Save(): void;
  Restore(): void;
  Translate(x: number, y: number): void;
  Scale(x: number, y: number): void;
  SetSourceSurface(aSurface: PngSurface, x: number, y: number): void;
}

/**
 * Cairo itself, as the two factory calls the .cpp makes.
 * `CreateImageSurface` is `cairo_image_surface_create( CAIRO_FORMAT_ARGB32, … )`
 * and `Create` is `cairo_create`.
 */
export interface PngBackend {
  CreateImageSurface(aWidth: number, aHeight: number): PngSurface;
  Create(aSurface: PngSurface): PngContext;
}

/**
 * `wxImage`, reduced to what `PlotImage` uses. The data layout is wxImage's:
 * `GetData()` is tightly packed RGB, three bytes per pixel, row-major, and
 * `GetAlpha()` is a separate one-byte-per-pixel plane that only exists when
 * `HasAlpha()` says so.
 */
export interface PngImage {
  IsOk(): boolean;
  GetWidth(): number;
  GetHeight(): number;
  HasAlpha(): boolean;
  GetData(): Uint8Array;
  GetAlpha(): Uint8Array | null;
}

// ===========================================================================
// The recording backend: the op stream, with nothing rasterised
// ===========================================================================

/**
 * One recorded `cairo_*` call. `args` holds the call's arguments in order, so
 * a test reads exactly what upstream would have passed to Cairo.
 */
export interface PngOp {
  op: string;
  args: readonly (number | readonly number[])[];
}

/** The recording context, plus the ops it has collected. */
export interface PngRecordingContext extends PngContext {
  Ops(): readonly PngOp[];
}

/** The recording backend, plus every surface and context it has handed out. */
export interface PngRecordingBackend extends PngBackend {
  /** The ops of the context created most recently, or an empty list. */
  Ops(): readonly PngOp[];
  Surfaces(): readonly PngSurface[];
  Contexts(): readonly PngRecordingContext[];
}

/**
 * A plain `CAIRO_FORMAT_ARGB32` memory surface — a zero-filled buffer with a
 * stride, exactly what `cairo_image_surface_create` hands back before anything
 * is drawn on it. Nothing rasterises into it; `PlotImage` writes into one
 * directly, which is the only place upstream touches surface bytes itself.
 *
 * `aStatus` lets a test drive the two failure paths `StartPlot` guards, which
 * are otherwise unreachable without an allocator that can fail.
 */
export function pngMemorySurface(
  aWidth: number,
  aHeight: number,
  aStatus: CAIRO_STATUS = CAIRO_STATUS.SUCCESS,
  aEncodeOptions: PngEncodeOptions = {},
): PngSurface {
  // cairo_format_stride_for_width( ARGB32, w ) is 4 * w rounded up to the
  // surface's alignment, which for a 32-bit format is already a multiple of 4.
  const stride = aWidth * 4;
  const data = new Uint8Array(Math.max(0, stride * aHeight));
  let destroyed = false;

  return {
    Status: () => aStatus,
    GetWidth: () => aWidth,
    GetHeight: () => aHeight,
    GetStride: () => stride,
    GetData: () => data,
    MarkDirty: () => {},
    Flush: () => {},
    Destroy: () => {
      destroyed = true;
    },
    WriteToPng: () => {
      if (destroyed || aStatus !== CAIRO_STATUS.SUCCESS) return null;
      if (aWidth <= 0 || aHeight <= 0) return null;

      return pngEncodeRgba8(
        aWidth,
        aHeight,
        pngUnpremultiplyArgb32(aWidth, aHeight, data, stride),
        aEncodeOptions,
      );
    },
  };
}

/**
 * A {@link PngBackend} that records the op stream instead of rasterising it.
 *
 * This is the honest statement of what this repo has: the geometry is ported,
 * the drawing is not ours to do. It is also the whole test surface — every
 * upstream quirk in this file shows up as an op, an argument or an ordering,
 * and none of them needs a pixel to be observed.
 *
 * `aStatus` and `aContextStatus` drive the surface-creation and
 * context-creation failure paths in `StartPlot`.
 */
export function pngRecordingBackend(
  aOptions: {
    surfaceStatus?: CAIRO_STATUS;
    contextStatus?: CAIRO_STATUS;
    encode?: PngEncodeOptions;
  } = {},
): PngRecordingBackend {
  const surfaces: PngSurface[] = [];
  const contexts: PngRecordingContext[] = [];

  const backend: PngRecordingBackend = {
    CreateImageSurface(aWidth, aHeight) {
      const surface = pngMemorySurface(
        aWidth,
        aHeight,
        aOptions.surfaceStatus ?? CAIRO_STATUS.SUCCESS,
        aOptions.encode ?? {},
      );
      surfaces.push(surface);
      return surface;
    },

    Create(_aSurface) {
      const ops: PngOp[] = [];
      const rec =
        (op: string) =>
        (...args: (number | readonly number[])[]): void => {
          ops.push({ op, args });
        };

      const context: PngRecordingContext = {
        Ops: () => ops,
        Status: () => aOptions.contextStatus ?? CAIRO_STATUS.SUCCESS,
        Destroy: rec('destroy'),
        SetAntialias: rec('set_antialias'),
        SetOperator: rec('set_operator'),
        SetSourceRgba: rec('set_source_rgba'),
        SetLineWidth: rec('set_line_width'),
        SetLineCap: rec('set_line_cap'),
        SetLineJoin: rec('set_line_join'),
        SetDash: (aDashes, aOffset) => {
          ops.push({ op: 'set_dash', args: [[...aDashes], aOffset] });
        },
        MoveTo: rec('move_to'),
        LineTo: rec('line_to'),
        ClosePath: rec('close_path'),
        Rectangle: rec('rectangle'),
        Arc: rec('arc'),
        ArcNegative: rec('arc_negative'),
        Fill: rec('fill'),
        Stroke: rec('stroke'),
        Paint: rec('paint'),
        Save: rec('save'),
        Restore: rec('restore'),
        Translate: rec('translate'),
        Scale: rec('scale'),
        SetSourceSurface: (aSurface, x, y) => {
          ops.push({
            op: 'set_source_surface',
            args: [aSurface.GetWidth(), aSurface.GetHeight(), x, y],
          });
        },
      };

      contexts.push(context);
      return context;
    },

    Ops: () => contexts[contexts.length - 1]?.Ops() ?? [],
    Surfaces: () => surfaces,
    Contexts: () => contexts,
  };

  return backend;
}

// ===========================================================================
// The Canvas 2D backend: where real pixels come from
// ===========================================================================

/**
 * `CanvasRenderingContext2D`, declared structurally so this module carries no
 * DOM import and `qa` can hand it a recorder. A real
 * `CanvasRenderingContext2D` and a real `OffscreenCanvasRenderingContext2D`
 * both satisfy it.
 */
export interface PngCanvas2D {
  /** The drawable this context paints into — what `drawImage` accepts. */
  readonly canvas: unknown;

  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  lineDashOffset: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;

  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(cx: number, cy: number, r: number, a1: number, a2: number, ccw?: boolean): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  setLineDash(aSegments: number[]): void;
  drawImage(aImage: unknown, dx: number, dy: number): void;
  createImageData(w: number, h: number): { data: Uint8ClampedArray };
  putImageData(aData: unknown, dx: number, dy: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

/** An `rgba()` colour string from COLOR4D's 0..1 components, as CSS wants it. */
export function cssRgba(r: number, g: number, b: number, a: number): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${ch(r)}, ${ch(g)}, ${ch(b)}, ${a})`;
}

/**
 * A {@link PngBackend} over Canvas 2D. This is not a port of anything — Cairo
 * and Canvas 2D are near-identical immediate-mode path APIs, and the mapping
 * below is the whole of it:
 *
 * | cairo                       | canvas 2d                                  |
 * | --------------------------- | ------------------------------------------ |
 * | `set_source_rgba`           | `fillStyle` *and* `strokeStyle`            |
 * | `set_line_width/cap/join`   | `lineWidth` / `lineCap` / `lineJoin`       |
 * | `set_dash`                  | `setLineDash` + `lineDashOffset`           |
 * | `set_operator CLEAR`        | `globalCompositeOperation` `destination-out` |
 * | `set_operator OVER`         | `source-over`                              |
 * | `move_to`/`line_to`/`rect`  | `moveTo`/`lineTo`/`rect`                   |
 * | `arc`/`arc_negative`        | `arc(…, ccw)`                              |
 * | `fill`/`stroke`             | `fill()`/`stroke()` **then `beginPath()`** |
 * | `paint`                     | `fillRect` over the whole surface          |
 * | `set_source_surface`+`paint`| `putImageData` to a scratch canvas, then `drawImage` |
 *
 * Two entries there are not equalities and are called out rather than papered
 * over. `cairo_fill`/`cairo_stroke` *consume* the current path where Canvas 2D
 * keeps it, so the adapter issues its own `beginPath()` afterwards to restore
 * cairo's semantics — without it every subsequent fill would redraw the whole
 * history. And `cairo_set_antialias( NONE )` has no Canvas 2D counterpart at
 * all: `imageSmoothingEnabled` governs image *scaling*, not path rasterisation,
 * so it is set for want of anything better and a non-antialiased PNG is a
 * documented gap, not a delivered feature.
 *
 * `aCreateCanvas` makes a 2D context of the requested pixel size; it is used
 * for the plot surface and again for the scratch surface `SetSourceSurface`
 * needs. Returning null is the allocation failure `cairo_image_surface_create`
 * reports as a non-SUCCESS status.
 */
export function pngCanvas2DBackend(
  aCreateCanvas: (aWidth: number, aHeight: number) => PngCanvas2D | null,
  aEncodeOptions: PngEncodeOptions = {},
): PngBackend {
  const canvasOf = new WeakMap<PngSurface, PngCanvas2D>();

  const makeSurface = (aWidth: number, aHeight: number): PngSurface => {
    const canvas = aWidth > 0 && aHeight > 0 ? aCreateCanvas(aWidth, aHeight) : null;

    if (!canvas) {
      // No canvas: a surface in an error status, which is what StartPlot tests.
      return pngMemorySurface(Math.max(aWidth, 0), Math.max(aHeight, 0), CAIRO_STATUS.NO_MEMORY);
    }

    const stride = aWidth * 4;
    let destroyed = false;

    const surface: PngSurface = {
      Status: () => (destroyed ? CAIRO_STATUS.NO_MEMORY : CAIRO_STATUS.SUCCESS),
      GetWidth: () => aWidth,
      GetHeight: () => aHeight,
      GetStride: () => stride,
      // getImageData is straight RGBA; an ARGB32 surface is premultiplied, so
      // the conversion runs here and not at the call site.
      GetData: () =>
        pngPremultiplyRgba8(
          aWidth,
          aHeight,
          Uint8Array.from(canvas.getImageData(0, 0, aWidth, aHeight).data),
        ),
      MarkDirty: () => {},
      Flush: () => {},
      Destroy: () => {
        destroyed = true;
      },
      // Straight from getImageData: no premultiply round trip, so no rounding
      // loss on the way to the file.
      WriteToPng: () => {
        if (destroyed) return null;

        const rgba = Uint8Array.from(canvas.getImageData(0, 0, aWidth, aHeight).data);
        return pngEncodeRgba8(aWidth, aHeight, rgba, aEncodeOptions);
      },
    };

    canvasOf.set(surface, canvas);
    return surface;
  };

  return {
    CreateImageSurface: makeSurface,

    Create(aSurface) {
      const canvas = canvasOf.get(aSurface);

      if (!canvas) {
        return {
          Status: () => CAIRO_STATUS.NO_MEMORY,
          ...noopContext(),
        };
      }

      canvas.beginPath();

      return {
        Status: () => CAIRO_STATUS.SUCCESS,
        Destroy: () => {},

        SetAntialias: (aMode) => {
          canvas.imageSmoothingEnabled = aMode === CAIRO_ANTIALIAS.DEFAULT;
        },
        SetOperator: (aOperator) => {
          canvas.globalCompositeOperation =
            aOperator === CAIRO_OPERATOR.CLEAR ? 'destination-out' : 'source-over';
        },
        SetSourceRgba: (r, g, b, a) => {
          const css = cssRgba(r, g, b, a);
          canvas.fillStyle = css;
          canvas.strokeStyle = css;
        },
        SetLineWidth: (aWidth) => {
          canvas.lineWidth = aWidth;
        },
        SetLineCap: (aCap) => {
          canvas.lineCap =
            aCap === CAIRO_LINE_CAP.ROUND
              ? 'round'
              : aCap === CAIRO_LINE_CAP.SQUARE
                ? 'square'
                : 'butt';
        },
        SetLineJoin: (aJoin) => {
          canvas.lineJoin =
            aJoin === CAIRO_LINE_JOIN.ROUND
              ? 'round'
              : aJoin === CAIRO_LINE_JOIN.BEVEL
                ? 'bevel'
                : 'miter';
        },
        SetDash: (aDashes, aOffset) => {
          canvas.setLineDash([...aDashes]);
          canvas.lineDashOffset = aOffset;
        },

        MoveTo: (x, y) => canvas.moveTo(x, y),
        LineTo: (x, y) => canvas.lineTo(x, y),
        ClosePath: () => canvas.closePath(),
        Rectangle: (x, y, w, h) => canvas.rect(x, y, w, h),
        Arc: (cx, cy, r, a1, a2) => canvas.arc(cx, cy, r, a1, a2, false),
        ArcNegative: (cx, cy, r, a1, a2) => canvas.arc(cx, cy, r, a1, a2, true),

        Fill: () => {
          canvas.fill();
          canvas.beginPath();
        },
        Stroke: () => {
          canvas.stroke();
          canvas.beginPath();
        },
        Paint: () => {
          canvas.fillRect(0, 0, aSurface.GetWidth(), aSurface.GetHeight());
        },

        Save: () => canvas.save(),
        Restore: () => canvas.restore(),
        Translate: (x, y) => canvas.translate(x, y),
        Scale: (x, y) => canvas.scale(x, y),

        SetSourceSurface: (aSource, x, y) => {
          const w = aSource.GetWidth();
          const h = aSource.GetHeight();
          const scratch = aCreateCanvas(w, h);

          if (!scratch) return;

          const image = scratch.createImageData(w, h);
          image.data.set(pngUnpremultiplyArgb32(w, h, aSource.GetData(), aSource.GetStride()));
          scratch.putImageData(image, 0, 0);
          canvas.drawImage(scratch.canvas, x, y);
        },
      };
    },
  };
}

/** The do-nothing half of a failed `cairo_create`, so `Status` can report it. */
function noopContext(): Omit<PngContext, 'Status'> {
  const nop = () => {};
  return {
    Destroy: nop,
    SetAntialias: nop,
    SetOperator: nop,
    SetSourceRgba: nop,
    SetLineWidth: nop,
    SetLineCap: nop,
    SetLineJoin: nop,
    SetDash: nop,
    MoveTo: nop,
    LineTo: nop,
    ClosePath: nop,
    Rectangle: nop,
    Arc: nop,
    ArcNegative: nop,
    Fill: nop,
    Stroke: nop,
    Paint: nop,
    Save: nop,
    Restore: nop,
    Translate: nop,
    Scale: nop,
    SetSourceSurface: nop,
  };
}

// ===========================================================================
// PNG_PLOTTER
// ===========================================================================

/**
 * `PNG_PLOTTER`.
 *
 * Drive it as upstream does: `SetPixelSize` / `SetResolution` / `SetViewport`,
 * optionally `OpenFile`, then `StartPlot`, the primitives, and `EndPlot`. Read
 * the finished file back with {@link PngPlotter.bytes} — there is no
 * filesystem here, so `SaveFile` keeps what it wrote rather than writing it.
 */
export class PngPlotter {
  // --- PLOTTER base members -------------------------------------------------
  private m_plotOffset: Vec2 = { x: 0, y: 0 };
  private m_plotScale = 1;
  private m_IUsPerDecimil = 1;
  private m_iuPerDeviceUnit = 1;
  private m_currentPenWidth = -1;
  private m_penState: 'U' | 'D' | 'Z' = 'Z';
  private m_penLastpos: Vec2 = { x: 0, y: 0 };
  private m_plotMirror = false;
  private m_yaxisReversed = false;
  private m_colorMode = false;
  private m_negativeMode = false;
  private m_filename = '';

  // --- PNG_PLOTTER members, at their constructor values ---------------------
  private m_surface: PngSurface | null = null;
  private m_context: PngContext | null = null;
  private m_dpi = DEFAULT_PNG_DPI;
  private m_width = 0;
  private m_height = 0;
  private m_antialias = false;
  private m_backgroundColor: Color4d = { r: 0, g: 0, b: 0, a: 0 };
  private m_currentColor: Color4d = COLOR4D_BLACK;

  /** The last file `SaveFile` produced, standing in for the file on disk. */
  private m_files = new Map<string, Uint8Array>();
  private m_lastSaved: Uint8Array | null = null;

  /**
   * The Cairo stand-in. Injected because there is no Cairo to import; see the
   * module docblock. {@link pngRecordingBackend} is the default because a
   * back-end that silently drew nothing would be worse than one that says so.
   */
  constructor(private readonly m_backend: PngBackend = pngRecordingBackend()) {}

  // =========================================================================
  // Accessors (plotter_png.h, all inline there)
  // =========================================================================

  GetPlotterType(): 'PNG' {
    return 'PNG';
  }

  static GetDefaultFileExtension(): string {
    return 'png';
  }

  SetResolution(aDPI: number): void {
    this.m_dpi = aDPI;
  }

  GetResolution(): number {
    return this.m_dpi;
  }

  SetPixelSize(aWidth: number, aHeight: number): void {
    this.m_width = aWidth;
    this.m_height = aHeight;
  }

  GetPixelWidth(): number {
    return this.m_width;
  }

  GetPixelHeight(): number {
    return this.m_height;
  }

  SetBackgroundColor(aColor: Color4d): void {
    this.m_backgroundColor = { ...aColor };
  }

  GetBackgroundColor(): Color4d {
    return { ...this.m_backgroundColor };
  }

  SetAntialias(aEnable: boolean): void {
    this.m_antialias = aEnable;
  }

  GetAntialias(): boolean {
    return this.m_antialias;
  }

  /**
   * pcbnew is Y-up and Cairo is Y-down; gerbview already emits Y-down, so the
   * caller decides. Reads and writes the base class's `m_yaxisReversed`.
   */
  SetYAxisReversed(aReversed: boolean): void {
    this.m_yaxisReversed = aReversed;
  }

  GetYAxisReversed(): boolean {
    return this.m_yaxisReversed;
  }

  /** `PLOTTER::SetColorMode` / `SetNegative`, needed by `SetColor`. */
  SetColorMode(aColorMode: boolean): void {
    this.m_colorMode = aColorMode;
  }

  GetColorMode(): boolean {
    return this.m_colorMode;
  }

  SetNegative(aNegative: boolean): void {
    this.m_negativeMode = aNegative;
  }

  /** `PLOTTER::GetCurrentLineWidth`. */
  GetCurrentLineWidth(): number {
    return this.m_currentPenWidth;
  }

  /**
   * The pen tip, `PLOTTER::m_penLastpos`. Not an upstream accessor — the member
   * is `protected` there and nothing reads it — but it is exposed here because
   * what `PenTo` stores in it is one of this back-end's real divergences (a
   * *device* point, where the base class keeps a user one) and a divergence
   * nothing can observe is a divergence nothing can pin.
   */
  GetPenLastPos(): Vec2 {
    return { ...this.m_penLastpos };
  }

  /** `PLOTTER`'s pen state, exposed for the same reason as the tip. */
  GetPenState(): 'U' | 'D' | 'Z' {
    return this.m_penState;
  }

  /** The surface and context in play, for callers that need the pixels. */
  GetSurface(): PngSurface | null {
    return this.m_surface;
  }

  GetContext(): PngContext | null {
    return this.m_context;
  }

  /** The bytes of the most recent successful `SaveFile`, if any. */
  bytes(): Uint8Array | null {
    return this.m_lastSaved;
  }

  /** Every path `SaveFile` has written, in place of a filesystem. */
  files(): ReadonlyMap<string, Uint8Array> {
    return this.m_files;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * `PNG_PLOTTER::OpenFile`. Nothing is opened: the surface accumulates the
   * draws in memory and the file is written in `EndPlot`. It records the name
   * and returns true unconditionally — there is no failure path.
   */
  OpenFile(aFullFilename: string): boolean {
    this.m_filename = aFullFilename;
    return true;
  }

  /**
   * `PNG_PLOTTER::StartPlot`. The page number is accepted and ignored — a PNG
   * has one page by construction.
   *
   * Note the order of the first two steps: the size is validated *before* any
   * teardown, so a StartPlot rejected for a bad pixel size leaves the previous
   * plot's surface and context alive and still drawable. Only once the size is
   * known good is the old pair destroyed.
   *
   * The two cache busts at the end are not tidiness. The background paint has
   * just set the Cairo source to `m_backgroundColor`; if `m_currentColor` still
   * held BLACK from a previous plot, the next `SetColor( BLACK )` would take the
   * early return and every subsequent draw would come out in the background
   * colour. Same for the pen width against a brand-new context whose line width
   * is Cairo's default 2.0.
   */
  StartPlot(_aPageNumber = ''): boolean {
    if (
      this.m_width <= 0 ||
      this.m_height <= 0 ||
      this.m_width > MAX_PNG_DIMENSION ||
      this.m_height > MAX_PNG_DIMENSION
    )
      return false;

    if (this.m_context) {
      this.m_context.Destroy();
      this.m_context = null;
    }

    if (this.m_surface) {
      this.m_surface.Destroy();
      this.m_surface = null;
    }

    this.m_surface = this.m_backend.CreateImageSurface(this.m_width, this.m_height);

    if (this.m_surface.Status() !== CAIRO_STATUS.SUCCESS) {
      this.m_surface.Destroy();
      this.m_surface = null;
      return false;
    }

    this.m_context = this.m_backend.Create(this.m_surface);

    if (this.m_context.Status() !== CAIRO_STATUS.SUCCESS) {
      this.m_context.Destroy();
      this.m_context = null;
      this.m_surface.Destroy();
      this.m_surface = null;
      return false;
    }

    this.m_context.SetAntialias(this.m_antialias ? CAIRO_ANTIALIAS.DEFAULT : CAIRO_ANTIALIAS.NONE);

    if (this.m_backgroundColor.a > 0) {
      this.m_context.SetSourceRgba(
        this.m_backgroundColor.r,
        this.m_backgroundColor.g,
        this.m_backgroundColor.b,
        this.m_backgroundColor.a,
      );
      this.m_context.Paint();
    }

    this.m_context.SetLineCap(CAIRO_LINE_CAP.ROUND);
    this.m_context.SetLineJoin(CAIRO_LINE_JOIN.ROUND);

    this.m_currentColor = COLOR4D_UNSPECIFIED;
    this.m_currentPenWidth = -1;

    return true;
  }

  /**
   * `PNG_PLOTTER::EndPlot`. The surface is deliberately *not* torn down: both
   * `OpenFile`+`StartPlot`+`EndPlot` (which writes here) and
   * `StartPlot`+`EndPlot`+`SaveFile` (which does not) are valid, and destroying
   * the surface would break the second. Cleanup happens at the next `StartPlot`
   * or never.
   */
  EndPlot(): boolean {
    if (!this.m_context) return false;

    this.m_surface?.Flush();

    if (this.m_filename !== '') return this.SaveFile(this.m_filename);

    return true;
  }

  /**
   * `PNG_PLOTTER::SaveFile`, i.e. `cairo_surface_write_to_png`. There is no
   * filesystem in the browser, so the encoded bytes are kept under the path
   * instead of being written to it; {@link PngPlotter.bytes} and
   * {@link PngPlotter.files} read them back.
   */
  SaveFile(aPath: string): boolean {
    if (!this.m_surface) return false;

    const encoded = this.m_surface.WriteToPng();

    if (!encoded) return false;

    this.m_files.set(aPath, encoded);
    this.m_lastSaved = encoded;
    return true;
  }

  // =========================================================================
  // Pen and colour state
  // =========================================================================

  /**
   * `PNG_PLOTTER::SetCurrentLineWidth`.
   *
   * The cache is checked and updated whether or not there is a context, so a
   * width set before `StartPlot` is remembered but never reaches Cairo — which
   * is exactly why `StartPlot` resets the cache to -1.
   *
   * The sentinels are *not* resolved. This back-end has no render settings, so
   * USE_DEFAULT_LINE_WIDTH (-1) and DO_NOT_SET_LINE_WIDTH (-2) go straight into
   * `userToDeviceSize`, whose `abs` turns them into small positive widths; the
   * `> 0 ? : 1.0` guard then floors the result at one device unit. And because
   * `StartPlot` leaves the cache at -1, a `SetCurrentLineWidth( -1 )` as the
   * first call after `StartPlot` is a cache hit and does nothing whatsoever.
   */
  SetCurrentLineWidth(aWidth: number, _aData?: unknown): void {
    if (aWidth === this.m_currentPenWidth) return;

    this.m_currentPenWidth = aWidth;

    if (this.m_context) {
      const deviceWidth = this.userToDeviceSize(aWidth);
      this.m_context.SetLineWidth(deviceWidth > 0 ? deviceWidth : 1.0);
    }
  }

  /**
   * `PNG_PLOTTER::SetColor`.
   *
   * In monochrome mode the test is `aColor == COLOR4D::WHITE`, full
   * four-component equality — so a translucent white fails it and plots black —
   * and the resulting grey is forced to alpha 1, discarding the requested
   * transparency. In colour mode the negative inversion touches r, g and b and
   * leaves alpha alone.
   */
  SetColor(aColor: Color4d): void {
    let effective: Color4d;

    if (this.m_colorMode) {
      effective = { ...aColor };

      if (this.m_negativeMode) {
        effective.r = 1.0 - effective.r;
        effective.g = 1.0 - effective.g;
        effective.b = 1.0 - effective.b;
      }
    } else {
      let k = colorEquals(aColor, COLOR4D_WHITE) ? 1.0 : 0.0;

      if (this.m_negativeMode) k = 1.0 - k;

      effective = { r: k, g: k, b: k, a: 1.0 };
    }

    if (colorEquals(effective, this.m_currentColor)) return;

    this.m_currentColor = effective;

    this.m_context?.SetSourceRgba(effective.r, effective.g, effective.b, effective.a);
  }

  /**
   * `PNG_PLOTTER::SetClearCompositing`. Not a PLOTTER virtual — PNG-only.
   * CLEAR punches transparent holes in the alpha channel for negative-polarity
   * items on a transparent export; the caller restores OVER afterwards.
   */
  SetClearCompositing(aClear: boolean): void {
    this.m_context?.SetOperator(aClear ? CAIRO_OPERATOR.CLEAR : CAIRO_OPERATOR.OVER);
  }

  /**
   * `PNG_PLOTTER::SetDash`. Unlike every other back-end this ignores
   * RENDER_SETTINGS entirely: the pattern is hard-coded multiples of the line
   * width in *device* units, floored at one pixel so a hairline still dashes.
   * The offset is always zero, and DEFAULT is treated as SOLID.
   */
  SetDash(aLineWidth: number, aLineStyle: LINE_STYLE): void {
    if (!this.m_context) return;

    if (aLineStyle === LINE_STYLE.SOLID || aLineStyle === LINE_STYLE.DEFAULT) {
      this.m_context.SetDash([], 0);
      return;
    }

    const base = Math.max(1.0, this.userToDeviceSize(aLineWidth));
    let dash: number[];

    switch (aLineStyle) {
      case LINE_STYLE.DASH:
        dash = [4.0 * base, 2.0 * base];
        break;

      case LINE_STYLE.DOT:
        dash = [1.0 * base, 2.0 * base];
        break;

      case LINE_STYLE.DASHDOT:
        dash = [4.0 * base, 2.0 * base, 1.0 * base, 2.0 * base];
        break;

      case LINE_STYLE.DASHDOTDOT:
        dash = [4.0 * base, 2.0 * base, 1.0 * base, 2.0 * base, 1.0 * base, 2.0 * base];
        break;

      default:
        this.m_context.SetDash([], 0);
        return;
    }

    this.m_context.SetDash(dash, 0);
  }

  // =========================================================================
  // Viewport and transform
  // =========================================================================

  /**
   * `PNG_PLOTTER::SetViewport`.
   *
   * `m_iuPerDeviceUnit` here really is IU per pixel — 10000 decimils to the
   * inch and `m_dpi` pixels to the inch — where the document back-ends store
   * device units per IU in the same inherited field. Everything downstream
   * divides by it rather than multiplying.
   */
  SetViewport(aOffset: Vec2, aIusPerDecimil: number, aScale: number, aMirror: boolean): void {
    this.m_plotOffset = { x: aOffset.x, y: aOffset.y };
    this.m_IUsPerDecimil = aIusPerDecimil;
    this.m_plotScale = aScale;
    this.m_plotMirror = aMirror;

    this.m_iuPerDeviceUnit = (this.m_IUsPerDecimil * 10000.0) / this.m_dpi;
  }

  /**
   * `PNG_PLOTTER::userToDeviceCoordinates`. The sign survives the scale here —
   * only the size overload takes an absolute value — and the mirror is always
   * horizontal, flipping about the image's pixel width rather than about a
   * paper size.
   */
  private userToDeviceCoordinates(aCoordinate: Vec2): Vec2 {
    const pos = { x: aCoordinate.x, y: aCoordinate.y };

    pos.x -= this.m_plotOffset.x;
    pos.y -= this.m_plotOffset.y;

    pos.x = (pos.x * this.m_plotScale) / this.m_iuPerDeviceUnit;
    pos.y = (pos.y * this.m_plotScale) / this.m_iuPerDeviceUnit;

    if (this.m_plotMirror) pos.x = this.m_width - pos.x;

    if (this.m_yaxisReversed) pos.y = this.m_height - pos.y;

    return pos;
  }

  /**
   * `PNG_PLOTTER::userToDeviceSize( double )`. A **divide** by
   * `m_iuPerDeviceUnit` and an `abs`, both of which invert the base class's
   * `size * m_plotScale * m_iuPerDeviceUnit`.
   */
  private userToDeviceSize(aSize: number): number {
    return Math.abs((aSize * this.m_plotScale) / this.m_iuPerDeviceUnit);
  }

  /**
   * `PNG_PLOTTER::userToDeviceSize( VECTOR2I )`: componentwise on the scalar
   * overload, so both components come back non-negative. Nothing inside this
   * file calls it — it is a PLOTTER virtual, overridden for callers outside.
   */
  userToDeviceSizeV(aSize: Vec2): Vec2 {
    return { x: this.userToDeviceSize(aSize.x), y: this.userToDeviceSize(aSize.y) };
  }

  // =========================================================================
  // Primitives
  // =========================================================================

  /**
   * `PNG_PLOTTER::Rect`. `aCornerRadius` is accepted and **ignored** — a
   * rounded rectangle plots square — and the filled branch ignores `aWidth`
   * too, so a filled rect never touches the pen.
   *
   * The corners are normalised by min/abs, so the two points may arrive in any
   * order and the rectangle still has positive extents.
   */
  Rect(p1: Vec2, p2: Vec2, aFill: FILL_T, aWidth: number, _aCornerRadius = 0): void {
    if (!this.m_context) return;

    const start = this.userToDeviceCoordinates(p1);
    const end = this.userToDeviceCoordinates(p2);

    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    if (aFill === FILL_T.NO_FILL) {
      this.SetCurrentLineWidth(aWidth);
      this.strokeRect(x, y, width, height);
    } else {
      this.fillRect(x, y, width, height);
    }
  }

  /**
   * `PNG_PLOTTER::Circle`. The radius is `aDiameter / 2.0` in *double*, so an
   * odd diameter keeps its half — unlike the integer halving the pad flashes do.
   */
  Circle(aCenter: Vec2, aDiameter: number, aFill: FILL_T, aWidth: number): void {
    if (!this.m_context) return;

    const center = this.userToDeviceCoordinates(aCenter);
    const radius = this.userToDeviceSize(aDiameter / 2.0);

    if (aFill === FILL_T.NO_FILL) {
      this.SetCurrentLineWidth(aWidth);
      this.strokeCircle(center.x, center.y, radius);
    } else {
      this.fillCircle(center.x, center.y, radius);
    }
  }

  /**
   * `PNG_PLOTTER::Arc`, the centre-and-sweep overload.
   *
   * Three things here are upstream's and are kept. The `VECTOR2D` centre is
   * truncated to a `VECTOR2I` before the transform, discarding the sub-IU part
   * the double parameter existed to carry. There is no `cairo_new_path`, so an
   * arc issued while a path is open is joined to it by the implicit line
   * `cairo_arc` draws from the current point. And the filled branch never calls
   * `SetCurrentLineWidth`, so a filled arc inherits whatever pen was last set.
   *
   * The sense test is on the *sweep*, `aAngle.AsDegrees() < 0`, and the angles
   * handed to Cairo are user-space angles applied to device-space geometry: a
   * y-reversed viewport therefore draws the arc mirrored, and upstream does not
   * compensate for it.
   */
  Arc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aFill: FILL_T,
    aWidth: number,
  ): void {
    if (!this.m_context) return;

    const center = this.userToDeviceCoordinates({
      x: Math.trunc(aCenter.x),
      y: Math.trunc(aCenter.y),
    });
    const deviceRadius = this.userToDeviceSize(aRadius);

    const startRad = aStartAngle.AsRadians();
    const endRad = aStartAngle.add(aAngle).AsRadians();

    if (aAngle.AsDegrees() < 0)
      this.m_context.ArcNegative(center.x, center.y, deviceRadius, startRad, endRad);
    else this.m_context.Arc(center.x, center.y, deviceRadius, startRad, endRad);

    if (aFill === FILL_T.NO_FILL) {
      this.SetCurrentLineWidth(aWidth);
      this.m_context.Stroke();
    } else {
      this.m_context.Fill();
    }
  }

  /**
   * `PLOTTER::Arc( start, mid, end, … )`, inherited unchanged: it derives the
   * centre and sweep and defers to the override above. `det <= 0` counts a
   * collinear triple as clockwise, so a degenerate arc normalises positive.
   */
  ArcThroughPoints(aStart: Vec2, aMid: Vec2, aEnd: Vec2, aFill: FILL_T, aWidth: number): void {
    const aCenter = CalcArcCenter(aStart, aMid, aEnd);

    const startAngle = EDA_ANGLE.fromVector({ x: aStart.x - aCenter.x, y: aStart.y - aCenter.y });
    const endAngle = EDA_ANGLE.fromVector({ x: aEnd.x - aCenter.x, y: aEnd.y - aCenter.y });

    // < 0: left, 0 : on the line, > 0 : right
    const det =
      (aEnd.x - aStart.x) * (aMid.y - aStart.y) - (aEnd.y - aStart.y) * (aMid.x - aStart.x);

    const cw = det <= 0;
    const angle = endAngle.sub(startAngle);

    if (cw) angle.Normalize();
    else angle.NormalizeNegative();

    const radius = Math.hypot(aStart.x - aCenter.x, aStart.y - aCenter.y);

    this.Arc(aCenter, startAngle, angle, radius, aFill, aWidth);
  }

  /**
   * `PNG_PLOTTER::PenTo`.
   *
   * Two upstream oddities live here. The `m_penLastpos = (-1,-1)` written
   * inside the 'Z' branch is dead: the unconditional assignment at the end of
   * the function overwrites it on the very next statement, every time. And what
   * that assignment stores is the *device* point — the base class and every
   * other back-end keep the user point in `m_penLastpos` — truncated by the
   * `VECTOR2I` conversion.
   *
   * The early return when there is no context skips the trailing assignment
   * too, so a pen move before `StartPlot` leaves the tip where it was.
   */
  PenTo(aPos: Vec2, aPlume: 'U' | 'D' | 'Z'): void {
    if (!this.m_context) return;

    const pos = this.userToDeviceCoordinates(aPos);

    switch (aPlume) {
      case 'U':
        this.m_context.MoveTo(pos.x, pos.y);
        this.m_penState = 'U';
        break;

      case 'D':
        if (this.m_penState === 'Z') this.m_context.MoveTo(pos.x, pos.y);
        else this.m_context.LineTo(pos.x, pos.y);

        this.m_penState = 'D';
        break;

      case 'Z':
        if (this.m_penState !== 'Z') {
          this.m_context.Stroke();
          this.m_penState = 'Z';
          this.m_penLastpos = { x: -1, y: -1 };
        }
        break;
    }

    this.m_penLastpos = { x: Math.trunc(pos.x), y: Math.trunc(pos.y) };
  }

  /**
   * `PNG_PLOTTER::PlotPoly`. Fewer than two corners draws nothing at all — not
   * even the `move_to` — and the filled branch closes the path itself, so a
   * caller need not repeat the first corner.
   */
  PlotPoly(aCornerList: readonly Vec2[], aFill: FILL_T, aWidth: number, _aData?: unknown): void {
    if (!this.m_context || aCornerList.length < 2) return;

    const start = this.userToDeviceCoordinates(aCornerList[0]!);
    this.m_context.MoveTo(start.x, start.y);

    for (let i = 1; i < aCornerList.length; i++) {
      const pt = this.userToDeviceCoordinates(aCornerList[i]!);
      this.m_context.LineTo(pt.x, pt.y);
    }

    if (aFill !== FILL_T.NO_FILL) {
      this.m_context.ClosePath();
      this.m_context.Fill();
    } else {
      this.SetCurrentLineWidth(aWidth);
      this.m_context.Stroke();
    }
  }

  /**
   * `PNG_PLOTTER::PlotImage`.
   *
   * The wxImage's RGB plane (and its optional separate alpha plane) is
   * converted into a premultiplied ARGB32 surface by hand, with the
   * round-half-up `( c * a + 127 ) / 255` upstream spells out, and only when
   * `a < 255` — an opaque pixel skips the arithmetic entirely, which is the
   * same answer by a shorter route.
   *
   * `aPos` is the image *centre*, so the destination is shifted back by half
   * the drawn size. `drawW`/`drawH` come from `userToDeviceSize( imgW *
   * aScaleFactor )`: the image's pixel count is treated as a length in IU, so
   * the scale factor is the caller's whole means of sizing it.
   *
   * The `paint` at the end also replaces the Cairo source with the image while
   * leaving `m_currentColor` untouched, so the next `SetColor` back to the
   * colour that was in force is a cache hit and draws with the image pattern
   * instead. That is upstream's bug and it is kept.
   */
  PlotImage(aImage: PngImage, aPos: Vec2, aScaleFactor: number): void {
    if (!this.m_context || !aImage.IsOk()) return;

    const imgW = aImage.GetWidth();
    const imgH = aImage.GetHeight();

    if (imgW === 0 || imgH === 0) return;

    const imgSurface = this.m_backend.CreateImageSurface(imgW, imgH);

    if (imgSurface.Status() !== CAIRO_STATUS.SUCCESS) {
      imgSurface.Destroy();
      return;
    }

    const srcData = aImage.GetData();
    const alphaData = aImage.HasAlpha() ? aImage.GetAlpha() : null;
    const dstBytes = imgSurface.GetData();
    const dstStride = imgSurface.GetStride();

    for (let y = 0; y < imgH; y++) {
      const srcRow = y * imgW * 3;
      const alphaRow = alphaData ? y * imgW : 0;
      const dstRow = y * dstStride;

      if (!alphaData) {
        for (let x = 0; x < imgW; x++) {
          const r = srcData[srcRow + x * 3]!;
          const g = srcData[srcRow + x * 3 + 1]!;
          const b = srcData[srcRow + x * 3 + 2]!;
          // Little-endian ARGB32: (a<<24)|(r<<16)|(g<<8)|b lands as b,g,r,a.
          dstBytes[dstRow + x * 4] = b;
          dstBytes[dstRow + x * 4 + 1] = g;
          dstBytes[dstRow + x * 4 + 2] = r;
          dstBytes[dstRow + x * 4 + 3] = 0xff;
        }
      } else {
        for (let x = 0; x < imgW; x++) {
          let r = srcData[srcRow + x * 3]!;
          let g = srcData[srcRow + x * 3 + 1]!;
          let b = srcData[srcRow + x * 3 + 2]!;
          const a = alphaData[alphaRow + x]!;

          if (a < 255) {
            r = ((r * a + 127) / 255) | 0;
            g = ((g * a + 127) / 255) | 0;
            b = ((b * a + 127) / 255) | 0;
          }

          dstBytes[dstRow + x * 4] = b;
          dstBytes[dstRow + x * 4 + 1] = g;
          dstBytes[dstRow + x * 4 + 2] = r;
          dstBytes[dstRow + x * 4 + 3] = a;
        }
      }
    }

    imgSurface.MarkDirty();

    const device = this.userToDeviceCoordinates(aPos);
    const drawW = this.userToDeviceSize(imgW * aScaleFactor);
    const drawH = this.userToDeviceSize(imgH * aScaleFactor);

    // aPos is the image centre; adjust to top-left for Cairo.
    const pos = { x: device.x - drawW / 2.0, y: device.y - drawH / 2.0 };

    this.m_context.Save();
    this.m_context.Translate(pos.x, pos.y);
    this.m_context.Scale(drawW / imgW, drawH / imgH);
    this.m_context.SetSourceSurface(imgSurface, 0, 0);
    this.m_context.Paint();
    this.m_context.Restore();

    imgSurface.Destroy();
  }

  // =========================================================================
  // Thick primitives (PLOTTER)
  // =========================================================================

  /**
   * `PLOTTER::ThickSegment`. A zero-length segment becomes a filled circle, and
   * the width doubles as a sentinel: USE_DEFAULT_LINE_WIDTH is resolved
   * *through* `SetCurrentLineWidth` so the pen is left at the default too,
   * while DO_NOT_SET_LINE_WIDTH reads the live pen without touching it. An
   * unresolved sentinel then trips a `wxCHECK2_MSG` and draws nothing — and on
   * this back-end `SetCurrentLineWidth` resolves neither sentinel, so
   * `ThickSegment( p, p, USE_DEFAULT_LINE_WIDTH )` reads -1 straight back out
   * and is the one caller that actually hits that check.
   */
  ThickSegment(aStart: Vec2, aEnd: Vec2, aWidth: number, aData?: unknown): void {
    if (aStart.x === aEnd.x && aStart.y === aEnd.y) {
      let diameter = aWidth;

      if (aWidth === USE_DEFAULT_LINE_WIDTH) {
        this.SetCurrentLineWidth(aWidth, aData);
        diameter = this.GetCurrentLineWidth();
      } else if (aWidth === DO_NOT_SET_LINE_WIDTH) {
        diameter = this.GetCurrentLineWidth();
      }

      if (diameter < 0) return;

      this.Circle(aStart, diameter, FILL_T.FILLED_SHAPE, 0);
    } else {
      this.SetCurrentLineWidth(aWidth);
      this.MoveTo(aStart);
      this.FinishTo(aEnd);
    }
  }

  /** `PLOTTER::ThickArc`, which is an unfilled Arc and nothing else. */
  ThickArc(
    aCentre: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aWidth: number,
    _aData?: unknown,
  ): void {
    this.Arc(aCentre, aStartAngle, aAngle, aRadius, FILL_T.NO_FILL, aWidth);
  }

  /** `PLOTTER::ThickRect`. */
  ThickRect(p1: Vec2, p2: Vec2, width: number, _aData?: unknown): void {
    this.Rect(p1, p2, FILL_T.NO_FILL, width, 0);
  }

  /** `PLOTTER::ThickCircle`. */
  ThickCircle(pos: Vec2, diametre: number, width: number, _aData?: unknown): void {
    this.Circle(pos, diametre, FILL_T.NO_FILL, width);
  }

  /** `PLOTTER::FilledCircle`. */
  FilledCircle(pos: Vec2, diametre: number, _aData?: unknown): void {
    this.Circle(pos, diametre, FILL_T.FILLED_SHAPE, 0);
  }

  // =========================================================================
  // Pad flashes
  // =========================================================================

  /** `PNG_PLOTTER::FlashPadCircle`. */
  FlashPadCircle(aPadPos: Vec2, aDiameter: number, _aData?: unknown): void {
    this.Circle(aPadPos, aDiameter, FILL_T.FILLED_SHAPE, 0);
  }

  /**
   * `PNG_PLOTTER::FlashPadOval`. The oval is a thick segment between the two
   * cap centres. Note this picks the long axis *directly* — where the
   * PostScript back-end normalises the pad to a vertical tablet and adds 90
   * degrees to the orientation, this one asks which of x and y is bigger and
   * lays the delta along it. `len / 2` is integer division, so an odd-length
   * oval loses half an IU off each cap.
   */
  FlashPadOval(aPadPos: Vec2, aSize: Vec2, aPadOrient: EDA_ANGLE, aData?: unknown): void {
    const width = Math.min(aSize.x, aSize.y);
    const len = Math.max(aSize.x, aSize.y) - width;

    if (len === 0) {
      this.FlashPadCircle(aPadPos, width, aData);
      return;
    }

    let delta: Vec2;

    if (aSize.x > aSize.y) delta = { x: Math.trunc(len / 2), y: 0 };
    else delta = { x: 0, y: Math.trunc(len / 2) };

    delta = RotatePoint(delta, aPadOrient);

    const start = { x: aPadPos.x - delta.x, y: aPadPos.y - delta.y };
    const end = { x: aPadPos.x + delta.x, y: aPadPos.y + delta.y };

    this.ThickSegment(start, end, width, aData);
  }

  /**
   * `PNG_PLOTTER::FlashPadRect`. The corners are built anticlockwise from the
   * top-left in the pad's own frame, rotated about the *origin* and only then
   * translated onto the pad. Four corners, not five: `PlotPoly`'s
   * `close_path` closes the ring.
   */
  FlashPadRect(aPadPos: Vec2, aSize: Vec2, aPadOrient: EDA_ANGLE, aData?: unknown): void {
    const dx = Math.trunc(aSize.x / 2);
    const dy = Math.trunc(aSize.y / 2);

    const corners: Vec2[] = [
      { x: -dx, y: -dy },
      { x: -dx, y: dy },
      { x: dx, y: dy },
      { x: dx, y: -dy },
    ].map((corner) => {
      const rotated = RotatePoint(corner, aPadOrient);
      return { x: rotated.x + aPadPos.x, y: rotated.y + aPadPos.y };
    });

    this.PlotPoly(corners, FILL_T.FILLED_SHAPE, 0, aData);
  }

  /**
   * `PNG_PLOTTER::FlashPadRoundRect` is `TransformRoundChamferedRectToPolygon`
   * followed by a `PlotPoly` of outline 0. kimath has no
   * `TransformRoundChamferedRectToPolygon`, so this is deliberately unreachable
   * rather than approximated with, say, a plain rectangle — a square pad where
   * a rounded one belongs is a wrong plot, not a rough one.
   */
  FlashPadRoundRect(
    _aPadPos: Vec2,
    _aSize: Vec2,
    _aCornerRadius: number,
    _aOrient: EDA_ANGLE,
    _aData?: unknown,
  ): void {
    throw new Error(
      'PNG FlashPadRoundRect is not ported (needs TransformRoundChamferedRectToPolygon)',
    );
  }

  /**
   * `PNG_PLOTTER::FlashPadCustom`. Position, size and orientation are all
   * ignored: the polygons arrive already placed. Holes are plotted too, one
   * outline at a time, because upstream walks every outline index — and each is
   * filled, so an inner outline paints over the outer one rather than being
   * subtracted from it.
   */
  FlashPadCustom(
    _aPadPos: Vec2,
    _aSize: Vec2,
    _aPadOrient: EDA_ANGLE,
    aPolygons: readonly (readonly Vec2[][])[] | null,
    aData?: unknown,
  ): void {
    if (!aPolygons || aPolygons.length === 0) return;

    for (let i = 0; i < aPolygons.length; i++) {
      const outline = aPolygons[i]![0]!;
      this.PlotPoly(outline, FILL_T.FILLED_SHAPE, 0, aData);
    }
  }

  /** `PNG_PLOTTER::FlashPadTrapez`. The corners rotate about the ORIGIN, then translate. */
  FlashPadTrapez(
    aPadPos: Vec2,
    aCorners: readonly Vec2[],
    aPadOrient: EDA_ANGLE,
    aData?: unknown,
  ): void {
    const corners: Vec2[] = [];

    for (let i = 0; i < 4; i++) {
      const rotated = RotatePoint(aCorners[i]!, aPadOrient);
      corners.push({ x: rotated.x + aPadPos.x, y: rotated.y + aPadPos.y });
    }

    this.PlotPoly(corners, FILL_T.FILLED_SHAPE, 0, aData);
  }

  /**
   * `PNG_PLOTTER::FlashRegularPolygon`.
   *
   * The third parameter really is a **diameter** on this back-end — the same
   * slot is a radius on DXF and PostScript, and neither of those draws anything
   * with it. The corners are laid out from `aOrient` by `ANGLE_360 /
   * aCornerCount` and truncated to integers on the way into the corner list.
   */
  FlashRegularPolygon(
    aShapePos: Vec2,
    aDiameter: number,
    aCornerCount: number,
    aOrient: EDA_ANGLE,
    aData?: unknown,
  ): void {
    const corners: Vec2[] = [];
    const radius = aDiameter / 2.0;
    const delta = ANGLE_360.divide(aCornerCount);

    for (let i = 0; i < aCornerCount; i++) {
      const angle = aOrient.add(delta.multiply(i));
      corners.push({
        x: Math.trunc(radius * Math.cos(angle.AsRadians())) + aShapePos.x,
        y: Math.trunc(radius * Math.sin(angle.AsRadians())) + aShapePos.y,
      });
    }

    this.PlotPoly(corners, FILL_T.FILLED_SHAPE, 0, aData);
  }

  // =========================================================================
  // Pen wrappers (PLOTTER)
  // =========================================================================

  MoveTo(pos: Vec2): void {
    this.PenTo(pos, 'U');
  }

  LineTo(pos: Vec2): void {
    this.PenTo(pos, 'D');
  }

  FinishTo(pos: Vec2): void {
    this.PenTo(pos, 'D');
    this.PenTo(pos, 'Z');
  }

  PenFinish(): void {
    // The point is not important with Z motion
    this.PenTo({ x: 0, y: 0 }, 'Z');
  }

  // =========================================================================
  // private helpers
  // =========================================================================

  /**
   * `fillRect` / `strokeRect` / `fillCircle` / `strokeCircle`.
   *
   * Each is one path-building call and one paint call, with no `new_path`
   * between them. `cairo_rectangle` and `cairo_arc` both begin a *sub*-path;
   * neither discards whatever path is already open, so a shape drawn while a
   * pen stroke is in flight is painted together with it.
   */
  private fillRect(aX: number, aY: number, aWidth: number, aHeight: number): void {
    if (!this.m_context) return;

    this.m_context.Rectangle(aX, aY, aWidth, aHeight);
    this.m_context.Fill();
  }

  private strokeRect(aX: number, aY: number, aWidth: number, aHeight: number): void {
    if (!this.m_context) return;

    this.m_context.Rectangle(aX, aY, aWidth, aHeight);
    this.m_context.Stroke();
  }

  private fillCircle(aCx: number, aCy: number, aRadius: number): void {
    if (!this.m_context) return;

    this.m_context.Arc(aCx, aCy, aRadius, 0, 2 * Math.PI);
    this.m_context.Fill();
  }

  private strokeCircle(aCx: number, aCy: number, aRadius: number): void {
    if (!this.m_context) return;

    this.m_context.Arc(aCx, aCy, aRadius, 0, 2 * Math.PI);
    this.m_context.Stroke();
  }
}
