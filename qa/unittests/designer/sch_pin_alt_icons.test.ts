// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Show pin alternate mode indicator icons" on the SCHEMATIC —
 * `m_Appearance.show_pin_alt_icons` (`eeschema_settings.cpp:231-232`), default
 * true, pushed at the render settings by `sch_edit_frame.cpp:2011`.
 *
 * The Symbol Editor's copy of this landed first. `drawAltPinModesIcon` is a
 * static in `sch_painter.cpp`, and `SCH_PAINTER` is the painter BOTH frames
 * use — the same shape as `SCH_POINT_EDITOR`, one class registered by two
 * frames — so the glyph moved out of `symbolRenderer.ts` into
 * `schematic/render/pin_alt_icon.ts` and the symbol editor imports it. Two
 * renderers, one geometry.
 *
 * The gate is on the PIN, not the setting: `getUntransformedAltIconBox` returns
 * null unless the pin declares alternates (`pin_layout_cache.cpp:621`). The
 * glyph means "this pin has other modes", so a pin with none must not wear one
 * however the checkbox is set — and that is what makes a "does the icon appear"
 * test worth writing, because the flag alone cannot produce it.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

function spy(): { strokes: number; ctx: CanvasRenderingContext2D } {
  const n = { strokes: 0 };
  const noop = (): void => {};
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    clip: noop,
    drawImage: noop,
    fillText: noop,
    fillRect: noop,
    fill: noop,
    strokeRect: () => {
      n.strokes++;
    },
    stroke: () => {
      n.strokes++;
    },
  };
  return {
    get strokes() {
      return n.strokes;
    },
    ctx: ctx as unknown as CanvasRenderingContext2D,
  } as unknown as { strokes: number; ctx: CanvasRenderingContext2D };
}

/** One symbol whose single pin either declares an `(alternate …)` or does not. */
const doc = (alternates: boolean, namesHidden = false) =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (lib_symbols
        (symbol "L:U" (pin_names (offset 1.016)${namesHidden ? ' hide' : ''})
          (property "Reference" "U" (at 2 0 90))
          (property "Value" "U" (at 0 0 90))
          (symbol "U_0_1"
            (rectangle (start -5 5) (end 5 -5)
              (stroke (width 0.254) (type default)) (fill (type none))))
          (symbol "U_1_1"
            (pin input line (at -7.62 0 0) (length 2.62)
              (name "IN" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27))))
              ${alternates ? '(alternate "CLK" input inverted)' : ''}))))
      (symbol (lib_id "L:U") (at 50 50 0) (unit 1)
        (uuid "44444444-4444-4444-4444-444444444444")
        (property "Reference" "U1" (at 53 48 0)
          (effects (font (size 1.27 1.27)) (hide yes)))
        (property "Value" "x" (at 53 52 0)
          (effects (font (size 1.27 1.27)) (hide yes)))))`),
  );

const paint = (d: ReturnType<typeof readSchematic>, showPinAltIcons: boolean): number => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      d,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      900,
      600,
      new Set(),
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        showPinAltIcons,
        showDrawingSheet: false,
        showPageLimits: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      },
    );
  } finally {
    setVectorText(false);
  }
  return s.strokes;
};

describe('the icon appears for a pin with alternates, and only then', () => {
  it('draws it when the setting is on', () => {
    const withAlt = doc(true);
    expect(paint(withAlt, false)).toBeLessThan(paint(withAlt, true));
  });

  it('draws nothing extra for a pin that declares none', () => {
    // The gate `getUntransformedAltIconBox` applies before the setting is even
    // consulted. Without this, "the flag changes the picture" would pass for a
    // painter that drew a glyph on every pin.
    const noAlt = doc(false);
    expect(paint(noAlt, false)).toBe(paint(noAlt, true));
  });

  it('draws nothing when the pin NAMES are hidden', () => {
    // `sch_painter.cpp:1672-1679` puts the icon inside the name's own `if`, so
    // a symbol with `(pin_names … hide)` shows no icons however the box would
    // have been placed.
    const hidden = doc(true, true);
    expect(paint(hidden, false)).toBe(paint(hidden, true));
  });

  it('adds a fixed number of strokes — the glyph, not a stroke per pin', () => {
    // SIX lines and one arc for `aBaseSelected = true`, counted off
    // `sch_painter.cpp:873-903` rather than off what the code printed:
    //
    //   top    full line, + two arrowhead strokes          = 3
    //   bottom half line, + two arrowhead strokes          = 3
    //   arcs   the second only; the first is `if( !aBaseSelected )` = 1
    //
    // The gapped variant's extra top line and extra arc are unreachable, since
    // the call site passes `true` unconditionally (`:1674-1676`).
    const withAlt = doc(true);
    expect(paint(withAlt, true) - paint(withAlt, false)).toBe(7);
  });
});

describe('the default is upstream’s', () => {
  it('is TRUE', () => {
    expect(EESCHEMA_DEFAULTS.appearance.show_pin_alt_icons).toBe(true);
    expect(DEFAULT_RENDER_OPTS.showPinAltIcons).toBe(true);
  });
});
