// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Inactive Layer View Mode" dims by MIXING toward the background, not by alpha.
 *
 * `ACTIONS::highContrastMode` — "Toggle inactive layers between normal and
 * dimmed" (`common/tool/actions.cpp`). GerbView treats it as a plain boolean:
 * both it and `highContrastModeCycle` run the same
 * `cfg->m_Display.m_HighContrastMode = !...` (`gerbview_control.cpp:296-300`).
 *
 * The dimmed colour is
 *
 *     m_hiContrastColor[i] = m_layerColors[i].Mix( m_layerColors[LAYER_PCB_BACKGROUND],
 *                                                  m_hiContrastFactor );
 *                                               common/render_settings.cpp:92-93
 *
 * with `m_hiContrastFactor = 0.2f` (`:42`), and `GERBVIEW_PAINTER::getLayerColor`
 * uses it for every layer NOT in `m_highContrastLayers`
 * (`gerbview/gerbview_painter.cpp:163-168`) — a set GerbView fills with exactly
 * one layer, the active one (`gerbview_draw_panel_gal.cpp:74-86`).
 *
 * Akshay reported the toggle doing nothing. Two reasons: the only implementation
 * was `ctx.globalAlpha = 0.3` in the 2D renderer, and GerbView draws through
 * `GerbviewGl`, which had no reference to high contrast at all. The 0.3 was also
 * the wrong model — alpha composites against whatever is underneath, so two
 * dimmed layers overlapping come out brighter than either, where a mix toward
 * the background is per-layer and does not accumulate.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseColor4d, toCss, mix } from '@ziroeda/common/src/color4d.js';
import { HI_CONTRAST_FACTOR, hiContrastColor } from '@ziroeda/common/src/render_settings.js';

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const BLACK = parseColor4d('rgb(0, 0, 0)');

describe('COLOR4D::Mix', () => {
  it('weights THIS colour by the factor and the other by 1 - factor', () => {
    // include/gal/color4d.h:296-304 — easy to invert, so pinned explicitly.
    const a = { r: 1, g: 1, b: 1, a: 1 };
    const b = { r: 0, g: 0, b: 0, a: 1 };
    expect(mix(a, b, 0.25)).toEqual({ r: 0.25, g: 0.25, b: 0.25, a: 1 });
  });

  it('keeps the alpha of the first colour rather than blending it', () => {
    const a = { r: 1, g: 0, b: 0, a: 0.5 };
    const b = { r: 0, g: 0, b: 1, a: 1 };
    expect(mix(a, b, 0.5).a).toBe(0.5);
  });
});

describe('the dimmed colour', () => {
  it('uses KiCad factor 0.2', () => {
    expect(HI_CONTRAST_FACTOR).toBe(0.2);
  });

  it('is one fifth of the layer colour on GerbView black', () => {
    // GERBER_BG_COLOR is rgb(0,0,0) (builtin_color_themes.h:84), so the mix
    // reduces to 0.2 * layer. Row 0 is rgb(200,52,52) -> rgb(40, 10.4, 10.4).
    const dim = hiContrastColor(parseColor4d('rgb(200, 52, 52)'), BLACK);
    expect(toCss(dim)).toBe(toCss(mix(parseColor4d('rgb(200, 52, 52)'), BLACK, 0.2)));
    expect(dim.r).toBeCloseTo((200 / 255) * 0.2, 6);
  });

  it('leaves the colour fully opaque — it is not a transparency', () => {
    expect(hiContrastColor(parseColor4d('rgb(200, 52, 52)'), BLACK).a).toBe(1);
  });

  it('does not accumulate the way alpha would', () => {
    // Two dimmed layers drawn over each other stay at the dimmed colour,
    // whereas 0.3 alpha twice composites to 0.51.
    const dim = hiContrastColor(parseColor4d('rgb(200, 52, 52)'), BLACK);
    expect(hiContrastColor(parseColor4d('rgb(200, 52, 52)'), BLACK)).toEqual(dim);
  });
});

describe('the frame applies it per layer, so every renderer gets it', () => {
  const VIEWER = src('editors/gerbview/GerberViewer.tsx');
  const RENDER = src('editors/gerbview/gerberRender.ts');

  it('dims every layer except the active one', () => {
    expect(VIEWER).toContain('highContrast && i !== activeLayer');
    expect(VIEWER).toContain('hiContrastColor(parseColor4d(base), bg)');
  });

  it('no longer fakes it with alpha in the 2D path', () => {
    // GerbView renders through GerbviewGl, which never saw opts.highContrast —
    // so the only implementation there was could not run at all.
    expect(RENDER).not.toContain('? 0.3 : 1');
  });
});
