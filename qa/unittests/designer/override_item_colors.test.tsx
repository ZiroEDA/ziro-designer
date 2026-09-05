// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Override individual item colors" — `m_optOverrideColors`
 * (`common/dialogs/panel_color_settings_base.cpp:35`), the theme flag
 * `schematic.override_item_colors` (`common/settings/color_settings.cpp:48-49`).
 *
 * It is one branch, at the top of `SCH_PAINTER::getRenderColor`:
 *
 *     COLOR4D color = m_schSettings.GetLayerColor( aLayer );
 *     if( !m_schSettings.m_OverrideItemColors ) { … take the item's own … }
 *     (`eeschema/sch_painter.cpp:314-320`)
 *
 * — so the feature is not "a checkbox that stores a bool". It is the claim that
 * EVERY place the painter would have preferred an item's own colour now returns
 * the layer's. `getRenderColor` enumerates ten item types inside that branch;
 * ours has no common base class to hang the question on, so it asks per site,
 * and a site that forgot to ask is a colour the override silently fails to
 * reach. That is what the first half below is for: one document carrying an
 * own colour of every kind the reader can express, painted twice.
 *
 * The second half is the page: which rows the flag shows, and when the box is
 * live at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { PanelEeschemaColorSettings } from '@ziroeda/designer/src/editors/schematic/prefs/PanelEeschemaColorSettings.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import type { EeschemaSettings } from '@ziroeda/designer/src/prefs/settings.js';
import type { PrefsContext } from '@ziroeda/designer/src/dialogs/prefs/types.js';
import { readSchematic } from '@ziroeda/eeschema';
import { parse } from '@ziroeda/sexpr';

afterEach(cleanup);

/** Records every colour that reached the canvas, stroked or filled. */
function spy(): { colors: Set<string>; ctx: CanvasRenderingContext2D } {
  const colors = new Set<string>();
  const noop = (): void => {};
  const state = { strokeStyle: '', fillStyle: '' };
  const ctx = {
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
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
    strokeRect: () => {
      colors.add(state.strokeStyle);
    },
    fill: () => {
      colors.add(state.fillStyle);
    },
    fillRect: () => {
      colors.add(state.fillStyle);
    },
    stroke: () => {
      colors.add(state.strokeStyle);
    },
  };
  return { colors, ctx: ctx as unknown as CanvasRenderingContext2D };
}

class Path2DStub {
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  closePath(): void {}
}
(globalThis as { Path2D?: unknown }).Path2D ??= Path2DStub;

/**
 * One document per own-colour site `getRenderColor` knows, each colour distinct
 * so a site that keeps its own is named by the assertion that fails.
 *
 * Every colour here is a `(color r g b a)` in the FILE, which is the only thing
 * the override suppresses: a netclass colour, a highlight and a selection
 * shadow are the render settings' own and go on being obeyed.
 */
const OWN = {
  line: '240,10,10',
  junction: '11,241,12',
  sheetBorder: '13,14,242',
  sheetFill: '243,15,244',
  shapeStroke: '16,245,246',
  shapeFill: '247,248,17',
  boxBorder: '18,100,249',
  boxText: '101,19,250',
  boxFill: '251,102,20',
  text: '21,103,252',
  hierLabel: '253,22,104',
  field: '23,254,105',
  symbolFill: '106,24,255',
} as const;

/**
 * Compare colours by their CHANNELS, not by their spelling.
 *
 * The renderer emits `rgb(…)` from some sites and `rgba(…, 1)` from others —
 * a fill re-serialised through `backgroundLayerFill` loses the alpha term a
 * stroke keeps. Asserting on a literal string therefore writes a test that
 * cannot fail: `not.toContain('rgb(240, 10, 10)')` passes on a canvas that
 * drew `rgba(240, 10, 10, 1)` all along. This is the second shape in
 * "tests that cannot fail" — a value nothing ever reads.
 */
const channels = (colors: Iterable<string>): Set<string> => {
  const out = new Set<string>();
  for (const c of colors) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (m) out.add(`${m[1]},${m[2]},${m[3]}`);
  }
  return out;
};

/** `KICAD_DEFAULT` stores its layers as CSS too, so a layer colour compares
 *  the same way. */
const chan = (css: string): string => [...channels([css])][0] ?? css;

const DOC = readSchematic(
  parse(`(kicad_sch (version 20250114) (generator "eeschema")
  (lib_symbols
    (symbol "Device:R" (pin_numbers hide) (in_bom yes) (on_board yes)
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "Device:R_0_1"
        (rectangle (start -1.016 -2.54) (end 1.016 2.54)
          (stroke (width 0.254) (type default))
          (fill (type color) (color 106 24 255 1))))))
  (wire (pts (xy 10 10) (xy 30 10))
    (stroke (width 0) (type default) (color 240 10 10 1)) (uuid "w1"))
  (junction (at 30 10) (diameter 0) (color 11 241 12 1) (uuid "j1"))
  (text "FREE TEXT" (at 10 40 0)
    (effects (font (size 1.27 1.27) (color 21 103 252 1))) (uuid "t1"))
  (hierarchical_label "HL" (shape input) (at 10 50 0)
    (effects (font (size 1.27 1.27) (color 253 22 104 1))) (uuid "h1"))
  (rectangle (start 60 10) (end 80 30)
    (stroke (width 0.2) (type default) (color 16 245 246 1))
    (fill (type color) (color 247 248 17 1)) (uuid "r1"))
  (text_box "BOX" (at 60 40 0) (size 20 10)
    (stroke (width 0.2) (type default) (color 18 100 249 1))
    (fill (type color) (color 251 102 20 1))
    (effects (font (size 1.27 1.27) (color 101 19 250 1))) (uuid "b1"))
  (symbol (lib_id "Device:R") (at 40 60 0) (unit 1) (uuid "s1")
    (property "Reference" "R1" (at 40 57 0)
      (effects (font (size 1.27 1.27) (color 23 254 105 1))))
    (property "Value" "10k" (at 40 63 0) (effects (font (size 1.27 1.27)))))
  (sheet (at 100 10) (size 30 20)
    (stroke (width 0.2) (type solid) (color 13 14 242 1))
    (fill (color 243 15 244 1)) (uuid "sh1")
    (property "Sheetname" "S" (at 100 9 0) (effects (font (size 1.27 1.27)) (justify left bottom)))
    (property "Sheetfile" "s.kicad_sch" (at 100 30.5 0)
      (effects (font (size 1.27 1.27)) (justify left top)))))`),
);

const LIBS = new Map(DOC.libSymbols.map((l) => [l.libId, l]));

const paint = (override: boolean): Set<string> => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      DOC,
      { scale: 0.0004, offsetX: 20, offsetY: 20 },
      KICAD_DEFAULT,
      900,
      700,
      undefined,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        connectivity: false,
        showHiddenFields: true,
        showDrawingSheet: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        overrideItemColors: override,
      },
      LIBS,
    );
  } finally {
    setVectorText(false);
  }
  return s.colors;
};

describe('the document actually carries an own colour of every kind', () => {
  // Without this, an override test passes on a document whose colours the
  // reader dropped — the failure the whole file is built to catch, inverted.
  it('paints all thirteen when the override is off', () => {
    const seen = channels(paint(false));
    const missing = Object.entries(OWN).filter(([, rgb]) => !seen.has(rgb));
    expect(missing.map(([what]) => what)).toEqual([]);
  });
});

describe('m_OverrideItemColors replaces every own colour with its layer', () => {
  it('paints none of them when it is on', () => {
    const seen = channels(paint(true));
    const survived = Object.entries(OWN).filter(([, rgb]) => seen.has(rgb));
    expect(survived.map(([what]) => what)).toEqual([]);
  });

  /**
   * `COLOR4D color = m_schSettings.GetLayerColor( aLayer );` runs BEFORE the
   * branch, so the override does not blank an item — it draws it in the layer
   * colour it would have had with no `(color …)` in the file at all.
   */
  it('draws them in their layer colours instead', () => {
    const seen = channels(paint(true));
    for (const key of [
      'wire',
      'junction',
      'sheetBorder',
      'noText',
      'hierLabel',
      // LAYER_REFERENCEPART, which the field's own green was hiding.
      'reference',
      // LAYER_DEVICE_BACKGROUND, for the body fill that carried a colour.
      'symbolFill',
    ] as const)
      expect(seen, key).toContain(chan(KICAD_DEFAULT[key]));
  });

  /**
   * The netclass-highlight pass reads the same `SCH_LINE::GetLineColor()`
   * through `getRenderColor`, and it is drawn from a separate loop at the top of
   * the file — the one place a sweep of the painting code misses.
   */
  it('reaches the netclass-highlight band too', () => {
    const s = spy();
    setVectorText(true);
    try {
      renderSchematic(
        s.ctx,
        DOC,
        { scale: 0.0004, offsetX: 20, offsetY: 20 },
        KICAD_DEFAULT,
        900,
        700,
        undefined,
        undefined,
        {
          ...DEFAULT_RENDER_OPTS,
          connectivity: false,
          showDrawingSheet: false,
          grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
          highlightNetclassColors: true,
          overrideItemColors: true,
        },
        LIBS,
      );
    } finally {
      setVectorText(false);
    }
    expect(channels(s.colors)).not.toContain(OWN.line);
  });
});

/* ------------------------------------------------------------------ page -- */

function ctxFor(
  eeschema: EeschemaSettings,
  onUpdate: (fn: (s: EeschemaSettings) => void) => void,
): PrefsContext {
  return {
    eeschema,
    upE: onUpdate,
    userColors: {},
    setUserColors: () => {},
  } as unknown as PrefsContext;
}

const withTheme = (theme: string, override: boolean): EeschemaSettings => {
  const s = structuredClone(EESCHEMA_DEFAULTS);
  s.appearance.color_theme = theme;
  s.appearance.override_item_colors = override;
  return s;
};

const box = (): HTMLInputElement =>
  screen.getByLabelText('Override individual item colors') as HTMLInputElement;

describe('the checkbox belongs to the theme, so only a writable one has it', () => {
  /** `m_optOverrideColors->Enable( !newSettings->IsReadOnly() )`
   *  (`common/dialogs/panel_color_settings.cpp:171`). */
  it('is live on "user" and dead on a built-in', () => {
    render(<PanelEeschemaColorSettings ctx={ctxFor(withTheme('user', false), () => {})} />);
    expect(box().disabled).toBe(false);
    cleanup();

    render(
      <PanelEeschemaColorSettings ctx={ctxFor(withTheme('_builtin_default', false), () => {})} />,
    );
    expect(box().disabled).toBe(true);
  });

  /**
   * `SetOverrideSchItemColors( m_optOverrideColors->GetValue() )` — and both
   * built-ins leave it at `color_settings.cpp:49`'s false, so a stored true
   * must not follow the user into a read-only theme.
   */
  it('reads false on a built-in even when "user" has it set', () => {
    render(
      <PanelEeschemaColorSettings ctx={ctxFor(withTheme('_builtin_classic', true), () => {})} />,
    );
    expect(box().checked).toBe(false);
  });

  it('writes the flag when clicked', () => {
    const s = withTheme('user', false);
    render(<PanelEeschemaColorSettings ctx={ctxFor(s, (fn) => fn(s))} />);
    fireEvent.click(box());
    expect(s.appearance.override_item_colors).toBe(true);
  });
});

describe('updateAllowedSwatches hides the two rows the flag makes pointless', () => {
  /*
   * "If the theme is not overriding individual item colors then don't show them
   *  so that the user doesn't get seduced into thinking they'll have some
   *  effect." (`panel_eeschema_color_settings.cpp:536-548`) — LAYER_SHEET and
   * LAYER_SHEET_BACKGROUND only, because a SCH_SHEET is the one item whose own
   * colour the sample document always sets.
   */
  const HIDDEN = ['Sheet borders', 'Sheet backgrounds'];
  const KEPT = ['Sheet fields', 'Sheet file names', 'Sheet names', 'Wires'];

  it('shows neither row while the flag is off', () => {
    render(<PanelEeschemaColorSettings ctx={ctxFor(withTheme('user', false), () => {})} />);
    for (const name of HIDDEN) expect(screen.queryByText(name), name).toBeNull();
    for (const name of KEPT) expect(screen.queryByText(name), name).not.toBeNull();
  });

  it('shows both once it is on', () => {
    render(<PanelEeschemaColorSettings ctx={ctxFor(withTheme('user', true), () => {})} />);
    for (const name of [...HIDDEN, ...KEPT]) expect(screen.queryByText(name), name).not.toBeNull();
  });

  it('keeps them hidden under a built-in, which can never override', () => {
    render(
      <PanelEeschemaColorSettings ctx={ctxFor(withTheme('_builtin_default', true), () => {})} />,
    );
    for (const name of HIDDEN) expect(screen.queryByText(name), name).toBeNull();
  });
});
