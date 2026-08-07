// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PNG_PLOTTER, checked op by op against the Cairo call stream
 * common/plotters/PNG_plotter.cpp would have produced.
 *
 * Nothing here rasterises. That is the point: every divergence this back-end
 * has from its four siblings — the inverted transform, the unresolved pen
 * sentinels, the device-space pen tip, the never-cleared path — is a matter of
 * *which* Cairo calls are made with *which* arguments in *which* order, and all
 * of that is visible without a single pixel.
 */
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  CAIRO_ANTIALIAS,
  CAIRO_LINE_CAP,
  CAIRO_LINE_JOIN,
  CAIRO_OPERATOR,
  CAIRO_STATUS,
  COLOR4D_BLACK,
  COLOR4D_WHITE,
  DEFAULT_PNG_DPI,
  DO_NOT_SET_LINE_WIDTH,
  FILL_T,
  LINE_STYLE,
  MAX_PNG_DIMENSION,
  MIN_PNG_DPI,
  MAX_PNG_DPI,
  type PngCanvas2D,
  type PngImage,
  type PngOp,
  PngPlotter,
  cssRgba,
  pngCanvas2DBackend,
  pngMemorySurface,
  pngRecordingBackend,
  type PngRecordingBackend,
  USE_DEFAULT_LINE_WIDTH,
} from '@ziroeda/pcbnew/src/plot_png.js';

/**
 * One IU per decimil and 100 dpi, so `m_iuPerDeviceUnit` is 1 * 10000 / 100 =
 * **100 IU per pixel** and every device coordinate below is the IU value over a
 * hundred. pcbnew's real numbers are 2540 IU per decimil at 300 dpi.
 */
const IUS_PER_DECIMIL = 1;
const DPI = 100;
const IU_PER_PIXEL = 100;

const PIXEL_W = 400;
const PIXEL_H = 300;

interface Options {
  width?: number;
  height?: number;
  dpi?: number;
  scale?: number;
  mirror?: boolean;
  offset?: { x: number; y: number };
  yaxisReversed?: boolean;
  colorMode?: boolean;
  negative?: boolean;
  background?: { r: number; g: number; b: number; a: number };
  antialias?: boolean;
  backend?: PngRecordingBackend;
}

/** A plotter sized, viewported and started, with its StartPlot ops discarded. */
function started(aOptions: Options = {}): { plotter: PngPlotter; backend: PngRecordingBackend } {
  const backend = aOptions.backend ?? pngRecordingBackend();
  const plotter = new PngPlotter(backend);

  plotter.SetPixelSize(aOptions.width ?? PIXEL_W, aOptions.height ?? PIXEL_H);
  plotter.SetResolution(aOptions.dpi ?? DPI);
  plotter.SetAntialias(aOptions.antialias ?? false);
  plotter.SetColorMode(aOptions.colorMode ?? false);
  plotter.SetNegative(aOptions.negative ?? false);
  plotter.SetYAxisReversed(aOptions.yaxisReversed ?? false);

  if (aOptions.background) plotter.SetBackgroundColor(aOptions.background);

  plotter.SetViewport(
    aOptions.offset ?? { x: 0, y: 0 },
    IUS_PER_DECIMIL,
    aOptions.scale ?? 1,
    aOptions.mirror ?? false,
  );

  expect(plotter.StartPlot()).toBe(true);

  return { plotter, backend };
}

/** The ops recorded since `aFrom`, as `[name, ...args]` tuples. */
function opsFrom(aBackend: PngRecordingBackend, aFrom: number): (string | unknown)[][] {
  return aBackend
    .Ops()
    .slice(aFrom)
    .map((op: PngOp) => [op.op, ...op.args]);
}

const names = (aBackend: PngRecordingBackend, aFrom = 0): string[] =>
  aBackend
    .Ops()
    .slice(aFrom)
    .map((op) => op.op);

describe('PngPlotter construction and accessors', () => {
  it('starts at PNG_PLOTTER::PNG_PLOTTER()s values', () => {
    const plotter = new PngPlotter();

    expect(plotter.GetResolution()).toBe(DEFAULT_PNG_DPI);
    expect(plotter.GetResolution()).toBe(300);
    expect(plotter.GetPixelWidth()).toBe(0);
    expect(plotter.GetPixelHeight()).toBe(0);
    expect(plotter.GetAntialias()).toBe(false);
    // COLOR4D( 0, 0, 0, 0 ): transparent, so StartPlot paints no background.
    expect(plotter.GetBackgroundColor()).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(plotter.GetYAxisReversed()).toBe(false);
    expect(plotter.GetPlotterType()).toBe('PNG');
    expect(PngPlotter.GetDefaultFileExtension()).toBe('png');
  });

  it('carries the headers DPI bounds', () => {
    expect(MIN_PNG_DPI).toBe(72);
    expect(MAX_PNG_DPI).toBe(2400);
    // INT16_MAX: cairo image surfaces go no wider.
    expect(MAX_PNG_DIMENSION).toBe(32767);
  });

  it('OpenFile opens nothing and cannot fail', () => {
    const plotter = new PngPlotter();
    expect(plotter.OpenFile('board.png')).toBe(true);
    expect(plotter.GetSurface()).toBeNull();
    expect(plotter.bytes()).toBeNull();
  });
});

describe('StartPlot', () => {
  it('rejects a non-positive or oversized image before creating anything', () => {
    for (const [w, h] of [
      [0, 10],
      [10, 0],
      [-1, 10],
      [10, -1],
      [MAX_PNG_DIMENSION + 1, 10],
      [10, MAX_PNG_DIMENSION + 1],
    ]) {
      const backend = pngRecordingBackend();
      const plotter = new PngPlotter(backend);
      plotter.SetPixelSize(w!, h!);
      plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);

      expect(plotter.StartPlot(), `${w}x${h}`).toBe(false);
      expect(backend.Surfaces().length, `${w}x${h}`).toBe(0);
    }
  });

  it('accepts exactly MAX_PNG_DIMENSION', () => {
    const backend = pngRecordingBackend();
    const plotter = new PngPlotter(backend);
    plotter.SetPixelSize(MAX_PNG_DIMENSION, 1);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);

    expect(plotter.StartPlot()).toBe(true);
  });

  it('validates the size BEFORE tearing down, so a rejected restart keeps the old plot', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetPixelSize(0, 0);
    expect(plotter.StartPlot()).toBe(false);

    // The context survived: the old surface is still there and still drawable.
    expect(plotter.GetContext()).not.toBeNull();
    plotter.Circle({ x: 0, y: 0 }, 200, FILL_T.FILLED_SHAPE, 0);
    expect(names(backend, before)).toEqual(['arc', 'fill']);
  });

  it('reports a surface that could not be created, and destroys it', () => {
    const backend = pngRecordingBackend({ surfaceStatus: CAIRO_STATUS.INVALID_SIZE });
    const plotter = new PngPlotter(backend);
    plotter.SetPixelSize(PIXEL_W, PIXEL_H);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);

    expect(plotter.StartPlot()).toBe(false);
    expect(backend.Surfaces().length).toBe(1);
    expect(backend.Contexts().length).toBe(0);
    expect(plotter.GetSurface()).toBeNull();
  });

  it('reports a context that could not be created, and destroys both', () => {
    const backend = pngRecordingBackend({ contextStatus: CAIRO_STATUS.NO_MEMORY });
    const plotter = new PngPlotter(backend);
    plotter.SetPixelSize(PIXEL_W, PIXEL_H);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);

    expect(plotter.StartPlot()).toBe(false);
    expect(backend.Contexts().length).toBe(1);
    expect(names(backend)).toEqual(['destroy']);
    expect(plotter.GetSurface()).toBeNull();
    expect(plotter.GetContext()).toBeNull();
  });

  it('sets antialias, then caps and joins, and paints no background at alpha 0', () => {
    const { backend } = started();

    expect(opsFrom(backend, 0)).toEqual([
      ['set_antialias', CAIRO_ANTIALIAS.NONE],
      ['set_line_cap', CAIRO_LINE_CAP.ROUND],
      ['set_line_join', CAIRO_LINE_JOIN.ROUND],
    ]);
  });

  it('paints the background between antialias and the caps when its alpha is above 0', () => {
    const { backend } = started({
      antialias: true,
      background: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
    });

    expect(opsFrom(backend, 0)).toEqual([
      ['set_antialias', CAIRO_ANTIALIAS.DEFAULT],
      ['set_source_rgba', 0.25, 0.5, 0.75, 1],
      ['paint'],
      ['set_line_cap', CAIRO_LINE_CAP.ROUND],
      ['set_line_join', CAIRO_LINE_JOIN.ROUND],
    ]);
  });

  it('treats any positive alpha as a background, however faint', () => {
    const { backend } = started({ background: { r: 0, g: 0, b: 0, a: 0.001 } });
    expect(names(backend)).toContain('paint');
  });

  it('busts the colour cache, so the first SetColor after it always reaches Cairo', () => {
    // The constructor leaves m_currentColor at BLACK. Without StartPlot's reset
    // to UNSPECIFIED, this SetColor would take the early return and every draw
    // would come out in the background colour the paint above installed.
    const { plotter, backend } = started({ background: { r: 1, g: 1, b: 1, a: 1 } });
    const before = backend.Ops().length;

    plotter.SetColor(COLOR4D_BLACK);
    expect(opsFrom(backend, before)).toEqual([['set_source_rgba', 0, 0, 0, 1]]);
  });

  it('busts the pen cache to -1, which makes USE_DEFAULT_LINE_WIDTH a no-op', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    expect(plotter.GetCurrentLineWidth()).toBe(-1);
    // -1 === m_currentPenWidth, so SetCurrentLineWidth returns before it can
    // resolve anything. This back-end never resolves the sentinel anyway.
    plotter.SetCurrentLineWidth(USE_DEFAULT_LINE_WIDTH);
    expect(opsFrom(backend, before)).toEqual([]);
    expect(plotter.GetCurrentLineWidth()).toBe(-1);
  });

  it('destroys the previous context and then the previous surface on a restart', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    expect(plotter.StartPlot()).toBe(true);

    expect(backend.Surfaces().length).toBe(2);
    expect(backend.Contexts().length).toBe(2);
    // The old context's very last op is its destroy.
    expect(
      backend
        .Contexts()[0]!
        .Ops()
        .slice(before)
        .map((o) => o.op),
    ).toEqual(['destroy']);
  });

  it('ignores the page number', () => {
    const backend = pngRecordingBackend();
    const plotter = new PngPlotter(backend);
    plotter.SetPixelSize(4, 4);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);

    expect(plotter.StartPlot('17')).toBe(true);
    expect(names(backend)).toEqual(['set_antialias', 'set_line_cap', 'set_line_join']);
  });
});

describe('EndPlot and SaveFile', () => {
  it('refuses to end a plot that never started', () => {
    expect(new PngPlotter().EndPlot()).toBe(false);
  });

  it('writes to the name OpenFile was given', () => {
    const backend = pngRecordingBackend();
    const plotter = new PngPlotter(backend);
    plotter.OpenFile('board.png');
    plotter.SetPixelSize(4, 3);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();

    expect(plotter.EndPlot()).toBe(true);
    expect([...plotter.files().keys()]).toEqual(['board.png']);
    expect(plotter.bytes()!.subarray(0, 4)).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('writes nothing when no file was opened, and leaves the surface for SaveFile', () => {
    const { plotter } = started({ width: 4, height: 3 });

    expect(plotter.EndPlot()).toBe(true);
    expect(plotter.bytes()).toBeNull();

    // The second valid usage pattern: EndPlot then an explicit SaveFile. It
    // only works because EndPlot deliberately does not destroy the surface.
    expect(plotter.SaveFile('later.png')).toBe(true);
    expect(plotter.bytes()).not.toBeNull();
  });

  it('refuses to save without a surface', () => {
    expect(new PngPlotter().SaveFile('x.png')).toBe(false);
  });

  it('produces a PNG whose IHDR states the pixel size that was plotted', () => {
    const { plotter } = started({ width: 9, height: 5 });
    plotter.SaveFile('x.png');

    const file = plotter.bytes()!;
    const be32 = (off: number) =>
      ((file[off]! << 24) | (file[off + 1]! << 16) | (file[off + 2]! << 8) | file[off + 3]!) >>> 0;

    expect(be32(16)).toBe(9);
    expect(be32(20)).toBe(5);
  });

  it('produces a fully transparent image, because the recording backend rasterises nothing', () => {
    // This is the documented gap, pinned rather than hidden: the geometry is
    // ported, the drawing is not ours to do. Real pixels come from the Canvas
    // backend below.
    const { plotter } = started({ width: 2, height: 2 });
    plotter.Circle({ x: 0, y: 0 }, 400, FILL_T.FILLED_SHAPE, 0);
    plotter.SaveFile('x.png');

    const file = plotter.bytes()!;
    const idatStart = 8 + 25 + 8; // signature + IHDR chunk + IDAT length/type
    const idatLen =
      ((file[8 + 25]! << 24) | (file[8 + 26]! << 16) | (file[8 + 27]! << 8) | file[8 + 28]!) >>> 0;
    const raw = new Uint8Array(
      inflateSync(Buffer.from(file.subarray(idatStart, idatStart + idatLen))),
    );

    expect(Array.from(raw)).toEqual(new Array(2 * (2 * 4 + 1)).fill(0));
  });
});

describe('SetColor', () => {
  it('passes the colour through in colour mode', () => {
    const { plotter, backend } = started({ colorMode: true });
    const before = backend.Ops().length;

    plotter.SetColor({ r: 0.2, g: 0.4, b: 0.6, a: 0.8 });
    expect(opsFrom(backend, before)).toEqual([['set_source_rgba', 0.2, 0.4, 0.6, 0.8]]);
  });

  it('inverts r, g and b in negative colour mode and leaves alpha alone', () => {
    const { plotter, backend } = started({ colorMode: true, negative: true });
    const before = backend.Ops().length;

    plotter.SetColor({ r: 0.25, g: 0, b: 1, a: 0.5 });
    expect(opsFrom(backend, before)).toEqual([['set_source_rgba', 0.75, 1, 0, 0.5]]);
  });

  it('collapses to black or white in monochrome mode, forcing alpha to 1', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetColor(COLOR4D_WHITE);
    plotter.SetColor({ r: 0.9, g: 0.9, b: 0.9, a: 1 });

    expect(opsFrom(backend, before)).toEqual([
      ['set_source_rgba', 1, 1, 1, 1],
      ['set_source_rgba', 0, 0, 0, 1],
    ]);
  });

  it('does not call a translucent white white — the equality includes alpha', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetColor({ r: 1, g: 1, b: 1, a: 0.5 });
    expect(opsFrom(backend, before)).toEqual([['set_source_rgba', 0, 0, 0, 1]]);
  });

  it('inverts the monochrome decision in negative mode', () => {
    const { plotter, backend } = started({ negative: true });
    const before = backend.Ops().length;

    plotter.SetColor(COLOR4D_WHITE);
    plotter.SetColor(COLOR4D_BLACK);

    expect(opsFrom(backend, before)).toEqual([
      ['set_source_rgba', 0, 0, 0, 1],
      ['set_source_rgba', 1, 1, 1, 1],
    ]);
  });

  it('caches on the EFFECTIVE colour, so two different greys are one Cairo call', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetColor({ r: 0.9, g: 0.1, b: 0.2, a: 1 });
    plotter.SetColor({ r: 0.3, g: 0.7, b: 0.4, a: 1 }); // also not white: also black

    expect(opsFrom(backend, before)).toEqual([['set_source_rgba', 0, 0, 0, 1]]);
  });

  it('still updates the cache without a context, so the state survives StartPlot', () => {
    const backend = pngRecordingBackend();
    const plotter = new PngPlotter(backend);
    plotter.SetColorMode(true);
    plotter.SetColor({ r: 1, g: 0, b: 0, a: 1 });

    plotter.SetPixelSize(4, 4);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();
    const before = backend.Ops().length;

    // StartPlot reset the cache to UNSPECIFIED, so the same colour goes again.
    plotter.SetColor({ r: 1, g: 0, b: 0, a: 1 });
    expect(opsFrom(backend, before)).toEqual([['set_source_rgba', 1, 0, 0, 1]]);
  });
});

describe('SetCurrentLineWidth', () => {
  it('converts IU to device units through the inverted transform', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetCurrentLineWidth(200);
    // 200 IU / 100 IU-per-pixel = 2 px. The base class would have MULTIPLIED.
    expect(opsFrom(backend, before)).toEqual([['set_line_width', 2]]);
  });

  it('floors a zero or sub-zero device width at one device unit', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetCurrentLineWidth(0);
    expect(opsFrom(backend, before)).toEqual([['set_line_width', 1]]);
  });

  it('takes the absolute value, so a negative plot scale still widens the pen', () => {
    const { plotter, backend } = started({ scale: -1 });
    const before = backend.Ops().length;

    plotter.SetCurrentLineWidth(200);
    expect(opsFrom(backend, before)).toEqual([['set_line_width', 2]]);
  });

  it('does NOT resolve DO_NOT_SET_LINE_WIDTH — it plots it as a width', () => {
    // PS and PDF resolve the sentinels against the render settings. This
    // back-end has no render settings at all, so -2 IU goes through the
    // transform like any other number: abs(-2 / 100) = 0.02 device units.
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetCurrentLineWidth(DO_NOT_SET_LINE_WIDTH);
    expect(opsFrom(backend, before)).toEqual([['set_line_width', 0.02]]);
  });

  it('caches, so a repeated width is one Cairo call', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetCurrentLineWidth(500);
    plotter.SetCurrentLineWidth(500);
    plotter.SetCurrentLineWidth(600);

    expect(opsFrom(backend, before)).toEqual([
      ['set_line_width', 5],
      ['set_line_width', 6],
    ]);
  });

  it('remembers a width set before StartPlot but never sends it', () => {
    const backend = pngRecordingBackend();
    const plotter = new PngPlotter(backend);
    plotter.SetCurrentLineWidth(700);
    expect(plotter.GetCurrentLineWidth()).toBe(700);

    plotter.SetPixelSize(4, 4);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();

    // ...and StartPlot throws the remembered value away, which is what stops
    // the pen from silently keeping Cairo's default 2.0.
    expect(plotter.GetCurrentLineWidth()).toBe(-1);
    expect(names(backend)).not.toContain('set_line_width');
  });
});

describe('SetDash', () => {
  it('does nothing without a context', () => {
    const backend = pngRecordingBackend();
    new PngPlotter(backend).SetDash(100, LINE_STYLE.DASH);
    expect(backend.Ops()).toEqual([]);
  });

  it('clears the dash for SOLID and for DEFAULT alike', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetDash(200, LINE_STYLE.SOLID);
    plotter.SetDash(200, LINE_STYLE.DEFAULT);

    expect(opsFrom(backend, before)).toEqual([
      ['set_dash', [], 0],
      ['set_dash', [], 0],
    ]);
  });

  it('builds hard-coded multiples of the device line width, ignoring RENDER_SETTINGS', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // 200 IU / 100 = 2 device units, so base = 2.
    plotter.SetDash(200, LINE_STYLE.DASH);
    plotter.SetDash(200, LINE_STYLE.DOT);
    plotter.SetDash(200, LINE_STYLE.DASHDOT);
    plotter.SetDash(200, LINE_STYLE.DASHDOTDOT);

    expect(opsFrom(backend, before)).toEqual([
      ['set_dash', [8, 4], 0],
      ['set_dash', [2, 4], 0],
      ['set_dash', [8, 4, 2, 4], 0],
      ['set_dash', [8, 4, 2, 4, 2, 4], 0],
    ]);
  });

  it('floors the base at one device unit, so a hairline still dashes', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetDash(1, LINE_STYLE.DASH); // 0.01 device units
    expect(opsFrom(backend, before)).toEqual([['set_dash', [4, 2], 0]]);
  });

  it('clears the dash for a style it does not know', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetDash(200, 99 as LINE_STYLE);
    expect(opsFrom(backend, before)).toEqual([['set_dash', [], 0]]);
  });
});

describe('the coordinate transform', () => {
  it('divides by m_iuPerDeviceUnit, which SetViewport fills with IU per pixel', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.MoveTo({ x: 12345, y: -6700 });
    expect(opsFrom(backend, before)).toEqual([
      ['move_to', 12345 / IU_PER_PIXEL, -6700 / IU_PER_PIXEL],
    ]);
    expect(IU_PER_PIXEL).toBe((IUS_PER_DECIMIL * 10000) / DPI);
  });

  it('reads the DPI SetViewport saw, not the one set afterwards', () => {
    const { plotter, backend } = started();
    plotter.SetResolution(200); // no SetViewport follows, so nothing changes
    const before = backend.Ops().length;

    plotter.MoveTo({ x: 10000, y: 0 });
    expect(opsFrom(backend, before)).toEqual([['move_to', 100, 0]]);
  });

  it('subtracts the plot offset before scaling', () => {
    const { plotter, backend } = started({ offset: { x: 1000, y: 2000 } });
    const before = backend.Ops().length;

    plotter.MoveTo({ x: 1000, y: 2000 });
    expect(opsFrom(backend, before)).toEqual([['move_to', 0, 0]]);
  });

  it('mirrors about the image WIDTH in pixels, always horizontally', () => {
    const { plotter, backend } = started({ mirror: true });
    const before = backend.Ops().length;

    plotter.MoveTo({ x: 10000, y: 5000 });
    expect(opsFrom(backend, before)).toEqual([['move_to', PIXEL_W - 100, 50]]);
  });

  it('flips y about the image HEIGHT when the y axis is reversed', () => {
    const { plotter, backend } = started({ yaxisReversed: true });
    const before = backend.Ops().length;

    plotter.MoveTo({ x: 10000, y: 5000 });
    expect(opsFrom(backend, before)).toEqual([['move_to', 100, PIXEL_H - 50]]);
  });

  it('keeps the sign in a coordinate where the size overload takes an absolute value', () => {
    const { plotter, backend } = started({ scale: -1 });
    const before = backend.Ops().length;

    plotter.Circle({ x: 10000, y: 10000 }, 400, FILL_T.FILLED_SHAPE, 0);
    // The centre went negative; the radius did not.
    expect(opsFrom(backend, before)).toEqual([['arc', -100, -100, 2, 0, 2 * Math.PI], ['fill']]);
  });

  it('never returns a negative component from the VECTOR2I size overload', () => {
    const { plotter } = started({ scale: -1 });
    expect(plotter.userToDeviceSizeV({ x: -500, y: 300 })).toEqual({ x: 5, y: 3 });
  });
});

describe('Rect', () => {
  it('strokes an unfilled rectangle after setting the pen', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.Rect({ x: 0, y: 0 }, { x: 1000, y: 2000 }, FILL_T.NO_FILL, 300);

    expect(opsFrom(backend, before)).toEqual([
      ['set_line_width', 3],
      ['rectangle', 0, 0, 10, 20],
      ['stroke'],
    ]);
  });

  it('fills without touching the pen at all', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.Rect({ x: 0, y: 0 }, { x: 1000, y: 2000 }, FILL_T.FILLED_SHAPE, 300);

    expect(opsFrom(backend, before)).toEqual([['rectangle', 0, 0, 10, 20], ['fill']]);
  });

  it('ignores the corner radius entirely — a rounded rect plots square', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.Rect({ x: 0, y: 0 }, { x: 1000, y: 1000 }, FILL_T.FILLED_SHAPE, 0, 0);
    plotter.Rect({ x: 0, y: 0 }, { x: 1000, y: 1000 }, FILL_T.FILLED_SHAPE, 0, 400);

    const ops = opsFrom(backend, before);
    expect(ops.slice(0, 2)).toEqual(ops.slice(2, 4));
  });

  it('normalises the corners, so the two points may arrive in any order', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.Rect({ x: 1000, y: 2000 }, { x: 0, y: 0 }, FILL_T.FILLED_SHAPE, 0);
    expect(opsFrom(backend, before)).toEqual([['rectangle', 0, 0, 10, 20], ['fill']]);
  });

  it('draws nothing at all without a context', () => {
    const backend = pngRecordingBackend();
    new PngPlotter(backend).Rect({ x: 0, y: 0 }, { x: 1, y: 1 }, FILL_T.NO_FILL, 1);
    expect(backend.Ops()).toEqual([]);
  });
});

describe('Circle', () => {
  it('halves the diameter in double, keeping the odd half', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // 101 / 2 = 50.5 IU, then / 100 IU-per-pixel = 0.505 device units.
    plotter.Circle({ x: 0, y: 0 }, 101, FILL_T.FILLED_SHAPE, 0);
    expect(opsFrom(backend, before)).toEqual([['arc', 0, 0, 0.505, 0, 2 * Math.PI], ['fill']]);
  });

  it('sets the pen only for the unfilled branch', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.Circle({ x: 200, y: 400 }, 1000, FILL_T.NO_FILL, 100);

    expect(opsFrom(backend, before)).toEqual([
      ['set_line_width', 1],
      ['arc', 2, 4, 5, 0, 2 * Math.PI],
      ['stroke'],
    ]);
  });
});

describe('Arc', () => {
  it('truncates its VECTOR2D centre to a VECTOR2I before transforming it', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // 1099.9 truncates to 1099 -> 10.99 device units, not 10.999.
    plotter.Arc(
      { x: 1099.9, y: -1099.9 },
      new EDA_ANGLE(0),
      new EDA_ANGLE(90),
      500,
      FILL_T.NO_FILL,
      100,
    );

    expect(opsFrom(backend, before)[0]).toEqual(['arc', 10.99, -10.99, 5, 0, Math.PI / 2]);
  });

  it('picks arc_negative on a negative sweep', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.Arc({ x: 0, y: 0 }, new EDA_ANGLE(90), new EDA_ANGLE(-45), 500, FILL_T.NO_FILL, 0);

    expect(opsFrom(backend, before)).toEqual([
      ['arc_negative', 0, 0, 5, Math.PI / 2, Math.PI / 4],
      ['set_line_width', 1],
      ['stroke'],
    ]);
  });

  it('sets the pen AFTER building the path, and not at all when filling', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 500, FILL_T.FILLED_SHAPE, 300);

    expect(opsFrom(backend, before)).toEqual([['arc', 0, 0, 5, 0, Math.PI / 2], ['fill']]);
  });

  it('appends to a live path — there is no cairo_new_path', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.MoveTo({ x: 0, y: 0 });
    plotter.LineTo({ x: 1000, y: 0 });
    plotter.Arc(
      { x: 2000, y: 0 },
      new EDA_ANGLE(0),
      new EDA_ANGLE(90),
      500,
      FILL_T.FILLED_SHAPE,
      0,
    );

    // The arc joins the open pen stroke by cairo's implicit line, and the fill
    // consumes both. Upstream draws it exactly this way.
    expect(names(backend, before)).toEqual(['move_to', 'line_to', 'arc', 'fill']);
  });

  it('derives centre and sweep for the three-point overload', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // A quarter circle of radius 1000 about the origin, sampled at three
    // integer points: (1000,0) -> (707,707) -> (0,1000). The mid point is a
    // rounded one, so the circumcentre lands a fraction of an IU off the
    // origin and the radius a fraction over 1000 — which is exactly what
    // CalcArcCenter is for.
    plotter.ArcThroughPoints(
      { x: 1000, y: 0 },
      { x: 707, y: 707 },
      { x: 0, y: 1000 },
      FILL_T.NO_FILL,
      0,
    );

    const arc = opsFrom(backend, before)[0]!;
    expect(arc[0]).toBe('arc');
    expect(arc[1] as number).toBeCloseTo(0, 1);
    expect(arc[2] as number).toBeCloseTo(0, 1);
    expect(arc[3] as number).toBeCloseTo(10, 1);
    // A positive sweep, so the clockwise `arc` and not `arc_negative`.
    expect((arc[5] as number) - (arc[4] as number)).toBeCloseTo(Math.PI / 2, 2);
  });

  it('draws nothing at all without a context', () => {
    const backend = pngRecordingBackend();
    new PngPlotter(backend).Arc(
      { x: 0, y: 0 },
      new EDA_ANGLE(0),
      new EDA_ANGLE(90),
      1,
      FILL_T.NO_FILL,
      0,
    );
    expect(backend.Ops()).toEqual([]);
  });
});

describe('PenTo and the pen wrappers', () => {
  it('moves on U, moves on the first D, and lines on every D after it', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.MoveTo({ x: 0, y: 0 });
    plotter.LineTo({ x: 1000, y: 0 });
    plotter.LineTo({ x: 1000, y: 1000 });

    expect(opsFrom(backend, before)).toEqual([
      ['move_to', 0, 0],
      ['line_to', 10, 0],
      ['line_to', 10, 10],
    ]);
  });

  it('moves rather than lines when the pen was at rest', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    expect(plotter.GetPenState()).toBe('Z');
    plotter.LineTo({ x: 1000, y: 1000 });

    expect(opsFrom(backend, before)).toEqual([['move_to', 10, 10]]);
  });

  it('strokes on Z, and only when the pen was not already at rest', () => {
    const { plotter, backend } = started();

    plotter.MoveTo({ x: 0, y: 0 });
    plotter.FinishTo({ x: 1000, y: 0 });
    const before = backend.Ops().length;

    plotter.PenFinish();
    plotter.PenFinish();

    expect(opsFrom(backend, before)).toEqual([]);
    expect(plotter.GetPenState()).toBe('Z');
  });

  it('stores the pen tip in DEVICE space, truncated — not in user space', () => {
    const { plotter } = started();

    plotter.MoveTo({ x: 12345, y: 6789 });
    // 123.45 and 67.89, truncated by the VECTOR2I conversion.
    expect(plotter.GetPenLastPos()).toEqual({ x: 123, y: 67 });
  });

  it('overwrites the (-1,-1) park on Z before anyone can see it', () => {
    // PenTo's trailing assignment is unconditional, so the park written inside
    // the 'Z' branch is dead code. Upstream's; kept.
    const { plotter } = started();

    plotter.MoveTo({ x: 0, y: 0 });
    plotter.LineTo({ x: 5000, y: 5000 });
    plotter.PenTo({ x: 5000, y: 5000 }, 'Z');

    expect(plotter.GetPenLastPos()).toEqual({ x: 50, y: 50 });
  });

  it('leaves the tip alone when there is no context', () => {
    const plotter = new PngPlotter();
    plotter.MoveTo({ x: 12345, y: 6789 });
    expect(plotter.GetPenLastPos()).toEqual({ x: 0, y: 0 });
  });

  it('FinishTo lines and then strokes', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.MoveTo({ x: 0, y: 0 });
    plotter.FinishTo({ x: 1000, y: 0 });

    expect(names(backend, before)).toEqual(['move_to', 'line_to', 'stroke']);
  });
});

describe('PlotPoly', () => {
  it('draws nothing at all for fewer than two corners', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.PlotPoly([], FILL_T.FILLED_SHAPE, 0);
    plotter.PlotPoly([{ x: 0, y: 0 }], FILL_T.NO_FILL, 300);

    expect(opsFrom(backend, before)).toEqual([]);
  });

  it('closes and fills, without setting the pen', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
      ],
      FILL_T.FILLED_SHAPE,
      300,
    );

    expect(opsFrom(backend, before)).toEqual([
      ['move_to', 0, 0],
      ['line_to', 10, 0],
      ['line_to', 10, 10],
      ['close_path'],
      ['fill'],
    ]);
  });

  it('sets the pen and strokes an open path when unfilled', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
      ],
      FILL_T.NO_FILL,
      300,
    );

    expect(opsFrom(backend, before)).toEqual([
      ['move_to', 0, 0],
      ['line_to', 10, 0],
      ['set_line_width', 3],
      ['stroke'],
    ]);
  });

  it('treats every non-NO_FILL mode as a fill', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    for (const fill of [FILL_T.HATCH, FILL_T.FILLED_WITH_BG_BODYCOLOR, FILL_T.CROSS_HATCH])
      plotter.PlotPoly(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        fill,
        300,
      );

    expect(names(backend, before)).toEqual([
      'move_to',
      'line_to',
      'close_path',
      'fill',
      'move_to',
      'line_to',
      'close_path',
      'fill',
      'move_to',
      'line_to',
      'close_path',
      'fill',
    ]);
  });
});

describe('ThickSegment', () => {
  it('strokes a real segment', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.ThickSegment({ x: 0, y: 0 }, { x: 1000, y: 0 }, 300);

    expect(opsFrom(backend, before)).toEqual([
      ['set_line_width', 3],
      ['move_to', 0, 0],
      ['line_to', 10, 0],
      ['stroke'],
    ]);
  });

  it('turns a zero-length segment into a filled circle of that width', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.ThickSegment({ x: 500, y: 500 }, { x: 500, y: 500 }, 400);

    expect(opsFrom(backend, before)).toEqual([['arc', 5, 5, 2, 0, 2 * Math.PI], ['fill']]);
  });

  it('reads the live pen for DO_NOT_SET_LINE_WIDTH', () => {
    const { plotter, backend } = started();
    plotter.SetCurrentLineWidth(600);
    const before = backend.Ops().length;

    plotter.ThickSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, DO_NOT_SET_LINE_WIDTH);

    expect(opsFrom(backend, before)).toEqual([['arc', 0, 0, 3, 0, 2 * Math.PI], ['fill']]);
  });

  it('draws nothing for an unresolved USE_DEFAULT_LINE_WIDTH — this back-end resolves neither', () => {
    // SetCurrentLineWidth( -1 ) is a cache hit right after StartPlot, so the
    // sentinel comes straight back out of GetCurrentLineWidth and trips
    // ThickSegment's diameter >= 0 check. On PS and PDF the render settings
    // would have replaced it with a real width by now.
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.ThickSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, USE_DEFAULT_LINE_WIDTH);

    expect(opsFrom(backend, before)).toEqual([]);
  });

  it('ThickRect, ThickCircle and FilledCircle defer to the primitives', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.ThickRect({ x: 0, y: 0 }, { x: 1000, y: 1000 }, 200);
    plotter.ThickCircle({ x: 0, y: 0 }, 1000, 400);
    plotter.FilledCircle({ x: 0, y: 0 }, 1000);

    expect(names(backend, before)).toEqual([
      'set_line_width',
      'rectangle',
      'stroke',
      'set_line_width',
      'arc',
      'stroke',
      'arc',
      'fill',
    ]);
  });
});

describe('pad flashes', () => {
  it('FlashPadCircle is a filled circle', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.FlashPadCircle({ x: 1000, y: 1000 }, 600);
    expect(opsFrom(backend, before)).toEqual([['arc', 10, 10, 3, 0, 2 * Math.PI], ['fill']]);
  });

  it('FlashPadOval degenerates to a circle when the axes are equal', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.FlashPadOval({ x: 0, y: 0 }, { x: 600, y: 600 }, new EDA_ANGLE(0));
    expect(opsFrom(backend, before)).toEqual([['arc', 0, 0, 3, 0, 2 * Math.PI], ['fill']]);
  });

  it('FlashPadOval lays the delta along the long axis directly, unlike the PS back-end', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // Wide pad: width = 400, len = 1000 - 400 = 600, delta = (300, 0).
    plotter.FlashPadOval({ x: 1000, y: 1000 }, { x: 1000, y: 400 }, new EDA_ANGLE(0));

    expect(opsFrom(backend, before)).toEqual([
      ['set_line_width', 4],
      ['move_to', 7, 10],
      ['line_to', 13, 10],
      ['stroke'],
    ]);
  });

  it('FlashPadOval halves the length with integer division', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // len = 401 - 100 = 301; 301 / 2 truncates to 150, not 150.5.
    plotter.FlashPadOval({ x: 0, y: 0 }, { x: 100, y: 401 }, new EDA_ANGLE(0));

    expect(opsFrom(backend, before)[2]).toEqual(['line_to', 0, 1.5]);
  });

  it('FlashPadRect builds four corners, rotated about the origin then translated', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.FlashPadRect({ x: 1000, y: 1000 }, { x: 400, y: 200 }, new EDA_ANGLE(90));

    // (-200,-100) rotated by 90 degrees is (-100, 200) under KiCad's screen
    // convention, then translated onto the pad.
    const ops = opsFrom(backend, before);
    expect(ops[0]![0]).toBe('move_to');
    expect(ops.map((o) => o[0])).toEqual([
      'move_to',
      'line_to',
      'line_to',
      'line_to',
      'close_path',
      'fill',
    ]);
    // Four corners, never five: close_path closes the ring.
    expect(ops.filter((o) => o[0] === 'line_to').length).toBe(3);
  });

  it('FlashPadRect halves the size with integer division', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.FlashPadRect({ x: 0, y: 0 }, { x: 401, y: 401 }, new EDA_ANGLE(0));
    // 401 / 2 truncates to 200, so the pad is 400 wide, not 401.
    expect(opsFrom(backend, before)[0]).toEqual(['move_to', -2, -2]);
  });

  it('FlashPadTrapez rotates its corners about the origin then translates', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.FlashPadTrapez(
      { x: 1000, y: 1000 },
      [
        { x: -100, y: -100 },
        { x: -200, y: 100 },
        { x: 200, y: 100 },
        { x: 100, y: -100 },
      ],
      new EDA_ANGLE(0),
    );

    expect(opsFrom(backend, before)).toEqual([
      ['move_to', 9, 9],
      ['line_to', 8, 11],
      ['line_to', 12, 11],
      ['line_to', 11, 9],
      ['close_path'],
      ['fill'],
    ]);
  });

  it('FlashRegularPolygon takes a DIAMETER, not the radius its siblings take', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // Diameter 2000 -> radius 1000 IU -> 10 device units.
    plotter.FlashRegularPolygon({ x: 0, y: 0 }, 2000, 4, new EDA_ANGLE(0));

    expect(opsFrom(backend, before)).toEqual([
      ['move_to', 10, 0],
      ['line_to', 0, 10],
      ['line_to', -10, 0],
      ['line_to', 0, -10],
      ['close_path'],
      ['fill'],
    ]);
  });

  it('FlashRegularPolygon truncates each corner to an integer IU', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // Radius 500, three corners at 0, 120 and 240 degrees. sin(120) * 500 is
    // 433.0127, truncated to 433 — and cos(120) * 500 comes out of the double
    // as -249.99999999999997, which truncates toward zero to **-249**, not to
    // -250. That one-IU bias is the truncation, faithfully reproduced; a
    // KiROUND here would have given -250.
    plotter.FlashRegularPolygon({ x: 0, y: 0 }, 1000, 3, new EDA_ANGLE(0));

    expect(opsFrom(backend, before)[1]).toEqual(['line_to', -2.49, 4.33]);
  });

  it('FlashPadCustom ignores position, size and orientation and fills every outline', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.FlashPadCustom({ x: 99999, y: 99999 }, { x: 5, y: 5 }, new EDA_ANGLE(45), [
      [
        [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 1000 },
        ],
      ],
      [
        [
          { x: 200, y: 200 },
          { x: 400, y: 200 },
          { x: 400, y: 400 },
        ],
      ],
    ]);

    expect(opsFrom(backend, before)).toEqual([
      ['move_to', 0, 0],
      ['line_to', 10, 0],
      ['line_to', 10, 10],
      ['close_path'],
      ['fill'],
      ['move_to', 2, 2],
      ['line_to', 4, 2],
      ['line_to', 4, 4],
      ['close_path'],
      ['fill'],
    ]);
  });

  it('FlashPadCustom draws nothing for a null or empty polygon set', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.FlashPadCustom({ x: 0, y: 0 }, { x: 1, y: 1 }, new EDA_ANGLE(0), null);
    plotter.FlashPadCustom({ x: 0, y: 0 }, { x: 1, y: 1 }, new EDA_ANGLE(0), []);

    expect(opsFrom(backend, before)).toEqual([]);
  });

  it('FlashPadRoundRect names the kimath function that is missing rather than approximating', () => {
    const { plotter } = started();

    expect(() =>
      plotter.FlashPadRoundRect({ x: 0, y: 0 }, { x: 1000, y: 500 }, 100, new EDA_ANGLE(0)),
    ).toThrow(/TransformRoundChamferedRectToPolygon/);
  });
});

describe('SetClearCompositing', () => {
  it('switches Cairos operator between CLEAR and OVER', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.SetClearCompositing(true);
    plotter.SetClearCompositing(false);

    expect(opsFrom(backend, before)).toEqual([
      ['set_operator', CAIRO_OPERATOR.CLEAR],
      ['set_operator', CAIRO_OPERATOR.OVER],
    ]);
  });

  it('does nothing without a context', () => {
    const backend = pngRecordingBackend();
    new PngPlotter(backend).SetClearCompositing(true);
    expect(backend.Ops()).toEqual([]);
  });
});

describe('PlotImage', () => {
  const image = (
    w: number,
    h: number,
    rgb: number[],
    alpha: number[] | null = null,
    ok = true,
  ): PngImage => ({
    IsOk: () => ok,
    GetWidth: () => w,
    GetHeight: () => h,
    HasAlpha: () => alpha !== null,
    GetData: () => Uint8Array.from(rgb),
    GetAlpha: () => (alpha ? Uint8Array.from(alpha) : null),
  });

  it('draws nothing for an unusable or empty image', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    plotter.PlotImage(image(1, 1, [1, 2, 3], null, false), { x: 0, y: 0 }, 1);
    plotter.PlotImage(image(0, 1, []), { x: 0, y: 0 }, 1);
    plotter.PlotImage(image(1, 0, []), { x: 0, y: 0 }, 1);

    expect(opsFrom(backend, before)).toEqual([]);
  });

  it('writes an opaque source surface as little-endian B, G, R, 255', () => {
    const { plotter, backend } = started();
    plotter.PlotImage(image(2, 1, [10, 20, 30, 40, 50, 60]), { x: 0, y: 0 }, 1);

    // The image surface is the second one the backend handed out.
    const surface = backend.Surfaces()[1]!;
    expect(Array.from(surface.GetData())).toEqual([30, 20, 10, 255, 60, 50, 40, 255]);
  });

  it('premultiplies with (c * a + 127) / 255, and skips the arithmetic at alpha 255', () => {
    const { plotter, backend } = started();
    plotter.PlotImage(image(2, 1, [200, 200, 200, 200, 200, 200], [128, 255]), { x: 0, y: 0 }, 1);

    // (200 * 128 + 127) / 255 = 100; the opaque pixel is left untouched.
    expect(Array.from(backend.Surfaces()[1]!.GetData())).toEqual([
      100, 100, 100, 128, 200, 200, 200, 255,
    ]);
  });

  it('treats the image pixel count as a length in IU, scaled by aScaleFactor', () => {
    const { plotter, backend } = started();
    const before = backend.Ops().length;

    // 400 "IU" wide at scale 1 -> 4 device units. Centred on (1000, 1000).
    plotter.PlotImage(image(400, 200, new Array(400 * 200 * 3).fill(0)), { x: 1000, y: 1000 }, 1);

    expect(opsFrom(backend, before)).toEqual([
      ['save'],
      ['translate', 10 - 2, 10 - 1],
      ['scale', 4 / 400, 2 / 200],
      ['set_source_surface', 400, 200, 0, 0],
      ['paint'],
      ['restore'],
    ]);
  });

  it('leaves the colour cache stale, so the next SetColor to the same colour is skipped', () => {
    // cairo_paint replaced the source with the image pattern, but
    // m_currentColor still says red. Upstream's bug; reproduced.
    const { plotter, backend } = started({ colorMode: true });
    plotter.SetColor({ r: 1, g: 0, b: 0, a: 1 });
    plotter.PlotImage(image(1, 1, [1, 2, 3]), { x: 0, y: 0 }, 1);
    const before = backend.Ops().length;

    plotter.SetColor({ r: 1, g: 0, b: 0, a: 1 });
    expect(opsFrom(backend, before)).toEqual([]);
  });

  it('draws nothing without a context', () => {
    const backend = pngRecordingBackend();
    new PngPlotter(backend).PlotImage(image(1, 1, [1, 2, 3]), { x: 0, y: 0 }, 1);
    expect(backend.Ops()).toEqual([]);
  });
});

describe('pngMemorySurface', () => {
  it('reports its size, a tight ARGB32 stride and a zeroed buffer', () => {
    const surface = pngMemorySurface(3, 2);

    expect(surface.GetWidth()).toBe(3);
    expect(surface.GetHeight()).toBe(2);
    expect(surface.GetStride()).toBe(12);
    expect(surface.GetData().length).toBe(24);
    expect(Array.from(surface.GetData())).toEqual(new Array(24).fill(0));
  });

  it('refuses to encode after Destroy, or in an error status', () => {
    const destroyed = pngMemorySurface(2, 2);
    destroyed.Destroy();
    expect(destroyed.WriteToPng()).toBeNull();

    expect(pngMemorySurface(2, 2, CAIRO_STATUS.NO_MEMORY).WriteToPng()).toBeNull();
    expect(pngMemorySurface(0, 0).WriteToPng()).toBeNull();
  });

  it('un-premultiplies on its way to the file', () => {
    const surface = pngMemorySurface(1, 1);
    surface.GetData().set([100, 100, 100, 128]); // B, G, R, A
    const file = surface.WriteToPng()!;

    const idat = file.subarray(8 + 25 + 8, file.length - 12 - 4);
    const raw = new Uint8Array(inflateSync(Buffer.from(idat)));

    // (100 * 255 + 64) / 128 = 199.
    expect(Array.from(raw)).toEqual([0, 199, 199, 199, 128]);
  });
});

describe('pngCanvas2DBackend', () => {
  interface Call {
    name: string;
    args: unknown[];
  }

  /** A Canvas 2D that records instead of rasterising, plus a fixed readback. */
  function fakeCanvas(w: number, h: number, aPixels?: Uint8ClampedArray) {
    const calls: Call[] = [];
    const rec =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push({ name, args });
      };

    const canvas: PngCanvas2D & { calls: Call[]; id: string } = {
      calls,
      id: `${w}x${h}`,
      canvas: { tag: `${w}x${h}` },
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
      lineDashOffset: 0,
      fillStyle: '',
      strokeStyle: '',
      globalCompositeOperation: '',
      imageSmoothingEnabled: false,
      save: rec('save'),
      restore: rec('restore'),
      translate: rec('translate'),
      scale: rec('scale'),
      beginPath: rec('beginPath'),
      moveTo: rec('moveTo'),
      lineTo: rec('lineTo'),
      closePath: rec('closePath'),
      rect: rec('rect'),
      arc: rec('arc'),
      fill: rec('fill'),
      stroke: rec('stroke'),
      fillRect: rec('fillRect'),
      setLineDash: rec('setLineDash'),
      drawImage: rec('drawImage'),
      createImageData: (cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4) }),
      putImageData: rec('putImageData'),
      getImageData: () => ({ data: aPixels ?? new Uint8ClampedArray(w * h * 4) }),
    };

    return canvas;
  }

  it('is satisfied by a real CanvasRenderingContext2D', () => {
    // Compile-time only: if the structural declaration drifts from the DOM's,
    // this stops building.
    const check = (aContext: CanvasRenderingContext2D): PngCanvas2D => aContext;
    expect(typeof check).toBe('function');
  });

  it('maps colours onto both fillStyle and strokeStyle', () => {
    const canvas = fakeCanvas(4, 4);
    const plotter = new PngPlotter(pngCanvas2DBackend(() => canvas));
    plotter.SetPixelSize(4, 4);
    plotter.SetColorMode(true);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();

    plotter.SetColor({ r: 1, g: 0.5, b: 0, a: 0.5 });

    expect(canvas.fillStyle).toBe('rgba(255, 128, 0, 0.5)');
    expect(canvas.strokeStyle).toBe('rgba(255, 128, 0, 0.5)');
  });

  it('restores cairos path semantics by beginning a new path after every paint', () => {
    const canvas = fakeCanvas(4, 4);
    const plotter = new PngPlotter(pngCanvas2DBackend(() => canvas));
    plotter.SetPixelSize(4, 4);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();
    canvas.calls.length = 0;

    plotter.Rect({ x: 0, y: 0 }, { x: 100, y: 100 }, FILL_T.FILLED_SHAPE, 0);
    plotter.Rect({ x: 0, y: 0 }, { x: 100, y: 100 }, FILL_T.NO_FILL, 100);

    expect(canvas.calls.map((c) => c.name)).toEqual([
      'rect',
      'fill',
      'beginPath',
      'rect',
      'stroke',
      'beginPath',
    ]);
  });

  it('maps the clear operator onto destination-out, and back', () => {
    const canvas = fakeCanvas(4, 4);
    const plotter = new PngPlotter(pngCanvas2DBackend(() => canvas));
    plotter.SetPixelSize(4, 4);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();

    plotter.SetClearCompositing(true);
    expect(canvas.globalCompositeOperation).toBe('destination-out');
    plotter.SetClearCompositing(false);
    expect(canvas.globalCompositeOperation).toBe('source-over');
  });

  it('flags a negative arc as counter-clockwise', () => {
    const canvas = fakeCanvas(4, 4);
    const plotter = new PngPlotter(pngCanvas2DBackend(() => canvas));
    plotter.SetPixelSize(4, 4);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();
    canvas.calls.length = 0;

    plotter.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 100, FILL_T.FILLED_SHAPE, 0);
    plotter.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(-90), 100, FILL_T.FILLED_SHAPE, 0);

    expect(canvas.calls[0]!.args[5]).toBe(false);
    expect(canvas.calls[3]!.args[5]).toBe(true);
  });

  it('paints the background as a fillRect over the whole surface', () => {
    const canvas = fakeCanvas(40, 30);
    const plotter = new PngPlotter(pngCanvas2DBackend(() => canvas));
    plotter.SetPixelSize(40, 30);
    plotter.SetBackgroundColor({ r: 0, g: 0, b: 0, a: 1 });
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();

    expect(canvas.calls.find((c) => c.name === 'fillRect')!.args).toEqual([0, 0, 40, 30]);
  });

  it('maps the dash pattern and its offset', () => {
    const canvas = fakeCanvas(4, 4);
    const plotter = new PngPlotter(pngCanvas2DBackend(() => canvas));
    plotter.SetPixelSize(4, 4);
    plotter.SetResolution(DPI);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();
    canvas.calls.length = 0;

    plotter.SetDash(200, LINE_STYLE.DASH);
    expect(canvas.calls[0]).toEqual({ name: 'setLineDash', args: [[8, 4]] });
    expect(canvas.lineDashOffset).toBe(0);
  });

  it('fails StartPlot when no canvas can be made', () => {
    const plotter = new PngPlotter(pngCanvas2DBackend(() => null));
    plotter.SetPixelSize(4, 4);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);

    expect(plotter.StartPlot()).toBe(false);
  });

  it('encodes the canvas pixels straight from getImageData, with no premultiply round trip', () => {
    // A 2x1 image: one half-transparent orange, one opaque black.
    const pixels = new Uint8ClampedArray([255, 128, 0, 128, 0, 0, 0, 255]);
    const canvas = fakeCanvas(2, 1, pixels);
    const plotter = new PngPlotter(pngCanvas2DBackend(() => canvas));
    plotter.SetPixelSize(2, 1);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();

    expect(plotter.SaveFile('c.png')).toBe(true);

    const file = plotter.bytes()!;
    const idat = file.subarray(8 + 25 + 8, file.length - 12 - 4);
    const raw = new Uint8Array(inflateSync(Buffer.from(idat)));

    // A premultiply/un-premultiply round trip would have turned 255 into 254.
    expect(Array.from(raw)).toEqual([0, 255, 128, 0, 128, 0, 0, 0, 255]);
  });

  it('premultiplies for GetData, because an ARGB32 surface is premultiplied', () => {
    const pixels = new Uint8ClampedArray([200, 200, 200, 128]);
    const canvas = fakeCanvas(1, 1, pixels);
    const backend = pngCanvas2DBackend(() => canvas);
    const surface = backend.CreateImageSurface(1, 1);

    // (200 * 128 + 127) / 255 = 100, and the bytes come back B, G, R, A.
    expect(Array.from(surface.GetData())).toEqual([100, 100, 100, 128]);
  });

  it('puts a source surface through a scratch canvas and draws it', () => {
    const made: ReturnType<typeof fakeCanvas>[] = [];
    const backend = pngCanvas2DBackend((w, h) => {
      const c = fakeCanvas(w, h);
      made.push(c);
      return c;
    });

    const plotter = new PngPlotter(backend);
    plotter.SetPixelSize(8, 8);
    plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    plotter.StartPlot();

    plotter.PlotImage(
      {
        IsOk: () => true,
        GetWidth: () => 1,
        GetHeight: () => 1,
        HasAlpha: () => false,
        GetData: () => Uint8Array.from([1, 2, 3]),
        GetAlpha: () => null,
      },
      { x: 0, y: 0 },
      1,
    );

    // made[0] is the plot surface, made[1] the image surface, made[2] the
    // scratch the source pixels are staged on before drawImage lifts them.
    expect(made.length).toBe(3);
    expect(made[2]!.calls.map((c) => c.name)).toEqual(['putImageData']);
    expect(made[0]!.calls.map((c) => c.name)).toContain('drawImage');
  });
});

describe('cssRgba', () => {
  it('scales, rounds and clamps the 0..1 components', () => {
    expect(cssRgba(0, 0, 0, 1)).toBe('rgba(0, 0, 0, 1)');
    expect(cssRgba(1, 1, 1, 0)).toBe('rgba(255, 255, 255, 0)');
    expect(cssRgba(0.5, 0.5, 0.5, 0.25)).toBe('rgba(128, 128, 128, 0.25)');
    expect(cssRgba(-1, 2, 0.5, 1)).toBe('rgba(0, 255, 128, 1)');
  });
});
