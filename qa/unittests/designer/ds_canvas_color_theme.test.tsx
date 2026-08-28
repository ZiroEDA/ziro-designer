// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Drawing Sheet Editor > Colors has to change what is DRAWN.
 *
 * `PANEL_PL_EDITOR_COLOR_SETTINGS` writes `appearance.color_theme`, and for one
 * commit that was the whole of it: our canvas declared its palette inline, so
 * the control stored a value nothing read — the PCB Calculator bug with the
 * halves swapped. A test that asserts the value round-trips through the
 * settings store is that same bug in test form; it would have passed
 * throughout. So this file renders the canvas against a recording 2D context
 * and reads the colours back off the paint calls.
 *
 * The chain being pinned is upstream's, end to end:
 *
 *   PL_DRAW_PANEL_GAL::PL_DRAW_PANEL_GAL      pl_draw_panel_gal.cpp:57-59
 *       cfg = GetAppSettings<PL_EDITOR_SETTINGS>( "pl_editor" )
 *       m_painter->GetSettings()->LoadColors( ::GetColorSettings( cfg->m_ColorTheme ) )
 *   DS_RENDER_SETTINGS::LoadColors            ds_painter.cpp:58-69
 *       m_backgroundColor = GetColor( LAYER_SCHEMATIC_BACKGROUND )   :66
 *       m_pageBorderColor = GetColor( LAYER_SCHEMATIC_GRID )         :67
 *       m_normalColor     = GetColor( LAYER_SCHEMATIC_DRAWINGSHEET ) :68
 *   EDA_DRAW_PANEL_GAL::onPaint               draw_panel_gal.cpp:364
 *       m_gal->SetClearColor( settings->GetBackgroundColor() )
 *
 * The two themes are KiCad's own built-ins, and they differ in all three
 * layers, so no assertion here can pass by accident on a shared value:
 * Default is beige / rgb(181,181,181) / rgb(132,0,0) and Classic is
 * WHITE / DARKGRAY / RED (`builtin_color_themes.h`, `s_defaultTheme` and
 * `s_classicTheme`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { DsDrawItem } from '@ziroeda/common';
import { DrawingSheetCanvas } from '@ziroeda/designer/src/editors/drawingsheet/DrawingSheetCanvas.js';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';
import { KICAD_CLASSIC, KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

afterEach(cleanup);

/** One horizontal sheet line, wide enough that the hairline snap is not taken. */
const DRAWS: DsDrawItem[] = [
  { kind: 'line', a: { x: 0, y: 0 }, b: { x: 100000, y: 0 }, width: 1500, src: 0 },
];

/** Everything the canvas paints, in order, with the style in force at the time. */
interface Recorder {
  /** Every `fillRect`, as the `fillStyle` it was made with. */
  fills: string[];
  /** Every `stroke()` / `strokeRect()`, as the `strokeStyle` in force. */
  strokes: string[];
}

const rec: Recorder = { fills: [], strokes: [] };

/**
 * The recording context.
 *
 * `getTransform` has to be real: the canvas transforms the page corners by hand
 * to snap the page rectangle onto the device pixel grid, and `ds_painter`'s
 * hairline path asks for it too. An identity-with-scale matrix is enough —
 * `isAxisAligned` only looks at `b` and `c`.
 */
const ctx = (() => {
  const self = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    canvas: { width: 800, height: 600 },
    setTransform: () => {},
    getTransform: () => ({ a: 0.02, b: 0, c: 0, d: 0.02, e: 0, f: 0 }),
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    clip: () => {},
    setLineDash: () => {},
    clearRect: () => {},
    drawImage: () => {},
    fillText: () => {},
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => rec.fills.push(self.fillStyle),
    strokeRect: () => rec.strokes.push(self.strokeStyle),
    fill: () => rec.fills.push(self.fillStyle),
    stroke: () => rec.strokes.push(self.strokeStyle),
  };
  return self;
})();

interface Patchable {
  requestAnimationFrame: unknown;
  cancelAnimationFrame: unknown;
  ResizeObserver: unknown;
  devicePixelRatio: number;
}
const win = globalThis as unknown as Patchable;
const saved: Partial<Patchable> = {};

beforeEach(() => {
  saved.requestAnimationFrame = win.requestAnimationFrame;
  saved.cancelAnimationFrame = win.cancelAnimationFrame;
  saved.ResizeObserver = win.ResizeObserver;
  saved.devicePixelRatio = win.devicePixelRatio;
  // Synchronous frames: the canvas schedules every repaint through rAF, and a
  // real one would land after the test has already read `rec`.
  win.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    cb(0);
    return 0;
  };
  win.cancelAnimationFrame = (): void => {};
  win.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
  win.devicePixelRatio = 1;
});

afterEach(() => {
  Object.assign(win, saved);
  settings.updatePlEditor((s) => {
    s.appearance.color_theme = '_builtin_default';
  });
});

/**
 * Paint the canvas once with the theme currently stored in `pl_editor.json`,
 * and hand back what it painted.
 *
 * `getContext` answers only for `'2d'`: `DrawingSheetGl.create` asks for
 * `webgl2` first and must get null, so the raster path — the one whose calls
 * are readable — is the one that runs.
 */
async function paint(themeId: string): Promise<Recorder> {
  rec.fills.length = 0;
  rec.strokes.length = 0;
  settings.updatePlEditor((s) => {
    s.appearance.color_theme = themeId;
  });

  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: unknown;
    getBoundingClientRect: unknown;
  };
  const savedGet = proto.getContext;
  const savedRect = proto.getBoundingClientRect;
  proto.getContext = (kind: string) => (kind === '2d' ? ctx : null);
  proto.getBoundingClientRect = () => ({ width: 800, height: 600, x: 0, y: 0, top: 0, left: 0 });
  try {
    await act(async () => {
      render(
        <DrawingSheetCanvas
          draws={DRAWS}
          pageW={4200000}
          pageH={2970000}
          selection={new Set()}
          activeTool="select"
          showGrid={false}
          gridIU={500000}
        />,
      );
    });
  } finally {
    proto.getContext = savedGet;
    proto.getBoundingClientRect = savedRect;
  }
  return rec;
}

describe('the canvas paints the colours of the stored theme', () => {
  it('clears to LAYER_SCHEMATIC_BACKGROUND of KiCad Default', async () => {
    // draw_panel_gal.cpp:364 — SetClearColor( settings->GetBackgroundColor() ).
    const r = await paint('_builtin_default');
    expect(r.fills[0]).toBe(KICAD_DEFAULT.background);
  });

  it('strokes the page outline and its marker in LAYER_SCHEMATIC_GRID', async () => {
    // m_pageBorderColor, ds_painter.cpp:67 and :361-383.
    const r = await paint('_builtin_default');
    expect(r.strokes).toContain(KICAD_DEFAULT.grid);
  });

  it('strokes the sheet items in LAYER_SCHEMATIC_DRAWINGSHEET', async () => {
    // m_normalColor, ds_painter.cpp:68, handed to every DS_PAINTER::draw.
    const r = await paint('_builtin_default');
    expect(r.strokes).toContain(KICAD_DEFAULT.pageFrame);
  });
});

describe('choosing another theme repaints all three', () => {
  it('KiCad Classic clears to WHITE, not to the beige of Default', async () => {
    const r = await paint('_builtin_classic');
    expect(r.fills[0]).toBe(KICAD_CLASSIC.background);
    expect(r.fills[0]).not.toBe(KICAD_DEFAULT.background);
  });

  it('KiCad Classic draws the page outline in DARKGRAY', async () => {
    const r = await paint('_builtin_classic');
    expect(r.strokes).toContain(KICAD_CLASSIC.grid);
    expect(r.strokes).not.toContain(KICAD_DEFAULT.grid);
  });

  it('KiCad Classic draws the sheet in its own LAYER_SCHEMATIC_DRAWINGSHEET', async () => {
    // No `not.toContain` here, and that is a fact about KiCad rather than a
    // weakened assertion: `s_classicTheme` gives the layer `COLOR4D( RED )` and
    // RED is `{132, 0, 0}` (`common/gal/color4d.cpp:61`), which is exactly what
    // `s_defaultTheme` spells out as `CSS_COLOR( 132, 0, 0, 1 )`. The two
    // built-ins agree on this one layer. The User theme below is the case that
    // moves it.
    const r = await paint('_builtin_classic');
    expect(KICAD_CLASSIC.pageFrame).toBe(KICAD_DEFAULT.pageFrame);
    expect(r.strokes).toContain(KICAD_CLASSIC.pageFrame);
  });

  it('a User-theme override moves the sheet ink off both built-ins', async () => {
    // `COLOR_SETTINGS` "User" is where a per-layer override lands; there is no
    // built-in whose LAYER_SCHEMATIC_DRAWINGSHEET differs from the other's, so
    // this is the only way to show that `m_normalColor` is READ rather than
    // being a constant that happens to match.
    settings.setUserColors({ pageFrame: 'rgb(1, 2, 3)' });
    try {
      const r = await paint('user');
      expect(r.strokes).toContain('rgb(1, 2, 3)');
      expect(r.strokes).not.toContain(KICAD_DEFAULT.pageFrame);
    } finally {
      settings.resetUserColors();
    }
  });

  it('repaints without a remount when the stored theme changes under it', async () => {
    // `PL_EDITOR_FRAME::CommonSettingsChanged` (pl_editor_frame.cpp:641-650)
    // re-runs LoadColors and then forces a redraw; the canvas is subscribed to
    // the settings store, so writing the key is enough. A canvas that only read
    // the theme at mount would still be painting the old one here.
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: unknown;
      getBoundingClientRect: unknown;
    };
    const savedGet = proto.getContext;
    const savedRect = proto.getBoundingClientRect;
    proto.getContext = (kind: string) => (kind === '2d' ? ctx : null);
    proto.getBoundingClientRect = () => ({ width: 800, height: 600, x: 0, y: 0, top: 0, left: 0 });
    try {
      settings.updatePlEditor((s) => {
        s.appearance.color_theme = '_builtin_default';
      });
      await act(async () => {
        render(
          <DrawingSheetCanvas
            draws={DRAWS}
            pageW={4200000}
            pageH={2970000}
            selection={new Set()}
            activeTool="select"
            showGrid={false}
            gridIU={500000}
          />,
        );
      });
      rec.fills.length = 0;
      rec.strokes.length = 0;
      await act(async () => {
        settings.updatePlEditor((s) => {
          s.appearance.color_theme = '_builtin_classic';
        });
      });
      expect(rec.fills[0]).toBe(KICAD_CLASSIC.background);
      expect(rec.strokes).toContain(KICAD_CLASSIC.pageFrame);
    } finally {
      proto.getContext = savedGet;
      proto.getBoundingClientRect = savedRect;
    }
  });
});
