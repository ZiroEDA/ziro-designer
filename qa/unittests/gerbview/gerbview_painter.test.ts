// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBVIEW_RENDER_SETTINGS::GetColor` (`gerbview/gerbview_painter.cpp:103-189`)
 * on real items read from a Gerber.
 *
 * These moved here from the tests of the page's old 2D/GL renderer, which
 * re-implemented the rules; the frame now paints through GERBVIEW_PAINTER, so
 * the rules are pinned where they live. Every expected colour is arithmetic on
 * the layer colours this file sets, not a call into the code under test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import {
  GAL_LAYER_ID,
  GERBER_DCODE_LAYER,
  GERBER_DRAW_LAYER,
  GERBVIEW_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { GERBER_DRAW_ITEM } from '@ziroeda/gerbview';
import { GERBVIEW_RENDER_SETTINGS, gvconfig } from '@ziroeda/gerbview/gerbview_painter.js';
import { parseGerber } from './load_image.js';

const rgb = (r: number, g: number, b: number): Color4d => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a: 1,
});

/** `rgb( r, g, b )` in 0-255, or null for COLOR4D( 0, 0, 0, 0 ). */
function css(c: Color4d): string | null {
  if (c.a === 0) return null;
  const ch = (v: number): number => Math.round(v * 255);
  return `rgb(${ch(c.r)}, ${ch(c.g)}, ${ch(c.b)})`;
}

const DRAW0 = GERBER_DRAW_LAYER(0);
const DRAW1 = GERBER_DRAW_LAYER(1);

/** Odd on every channel, so Brightened( 0.5 ) never lands on a half. */
const LAYER0 = rgb(79, 203, 203);
const LAYER1 = rgb(141, 203, 129);
const NEGATIVE = rgb(77, 77, 77);
const DCODES = rgb(255, 255, 255);

function settings(): GERBVIEW_RENDER_SETTINGS {
  const cs = new COLOR_SETTINGS();
  cs.SetColor(DRAW0, LAYER0);
  cs.SetColor(DRAW1, LAYER1);
  cs.SetColor(GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS, NEGATIVE);
  cs.SetColor(GERBVIEW_LAYER_ID.LAYER_DCODES, DCODES);
  // RENDER_SETTINGS::update() mixes high contrast towards this one.
  cs.SetColor(GAL_LAYER_ID.LAYER_PCB_BACKGROUND, rgb(0, 0, 0));

  const rs = new GERBVIEW_RENDER_SETTINGS();
  rs.LoadColors(cs);
  return rs;
}

/** A dark flash on net GND, D10, and a clear (%LPC) one on the same net. */
const [dark, clear] = parseGerber(
  [
    '%FSLAX46Y46*%',
    '%MOMM*%',
    '%ADD10C,1*%',
    '%TO.N,GND*%',
    '%TO.C,R1*%',
    'D10*',
    'X0Y0D03*',
    '%LPC*%',
    'X0Y0D03*',
    'M02*',
  ].join('\n'),
  't.gbr',
).GetItems() as [GERBER_DRAW_ITEM, GERBER_DRAW_ITEM];

const showNegative = gvconfig().m_Appearance.show_negative_objects;

afterEach(() => {
  gvconfig().m_Appearance.show_negative_objects = showNegative;
});

describe('GERBVIEW_RENDER_SETTINGS::GetColor', () => {
  it('leaves an ordinary item on its layer colour', () => {
    expect(css(settings().GetColor(dark, DRAW0))).toBe('rgb(79, 203, 203)');
    expect(css(settings().GetColor(dark, DRAW1))).toBe('rgb(141, 203, 129)');
  });

  it('draws every dcode layer in the one LAYER_DCODES colour (:108-112)', () => {
    const rs = settings();
    expect(css(rs.GetColor(dark, GERBER_DCODE_LAYER(DRAW0)))).toBe('rgb(255, 255, 255)');
    expect(css(rs.GetColor(dark, GERBER_DCODE_LAYER(DRAW1)))).toBe('rgb(255, 255, 255)');
  });

  /**
   * A highlighted item takes ITS OWN LAYER's colour brightened by 0.5
   * (`m_layerColorsHi`, :73 and :135-140), c + ( 255 - c ) / 2 per channel.
   * rgb(79, 203, 203): 79 + 88, 203 + 26. rgb(141, 203, 129): 141 + 57,
   * 203 + 26, 129 + 63.
   */
  it('brightens the layer for a highlighted net, per layer', () => {
    const rs = settings();
    rs.m_netHighlightString = 'GND';
    expect(css(rs.GetColor(dark, DRAW0))).toBe('rgb(167, 229, 229)');
    expect(css(rs.GetColor(dark, DRAW1))).toBe('rgb(198, 229, 192)');
  });

  it('highlights only the net it was asked for', () => {
    const rs = settings();
    rs.m_netHighlightString = 'VCC';
    expect(css(rs.GetColor(dark, DRAW0))).toBe('rgb(79, 203, 203)');
  });

  it('highlights by component, and by dcode number', () => {
    const byCmp = settings();
    byCmp.m_componentHighlightString = 'R1';
    expect(css(byCmp.GetColor(dark, DRAW0))).toBe('rgb(167, 229, 229)');

    const byDcode = settings();
    byDcode.m_dcodeHighlightValue = 10;
    expect(css(byDcode.GetColor(dark, DRAW0))).toBe('rgb(167, 229, 229)');
    byDcode.m_dcodeHighlightValue = 11;
    expect(css(byDcode.GetColor(dark, DRAW0))).toBe('rgb(79, 203, 203)');
  });

  it('gives a shown negative object the negative-objects colour (:122-127)', () => {
    gvconfig().m_Appearance.show_negative_objects = true;
    expect(css(settings().GetColor(clear, DRAW0))).toBe('rgb(77, 77, 77)');
  });

  it('gives a hidden negative object no colour at all (:130)', () => {
    gvconfig().m_Appearance.show_negative_objects = false;
    expect(css(settings().GetColor(clear, DRAW0))).toBe(null);
  });

  /**
   * THE ORDER: polarity at :122, the first highlight at :135, so polarity
   * wins even on the highlighted net.
   */
  it('tests polarity BEFORE the highlight', () => {
    const rs = settings();
    rs.m_netHighlightString = 'GND';

    gvconfig().m_Appearance.show_negative_objects = true;
    expect(css(rs.GetColor(clear, DRAW0))).toBe('rgb(77, 77, 77)');
    gvconfig().m_Appearance.show_negative_objects = false;
    expect(css(rs.GetColor(clear, DRAW0))).toBe(null);
  });

  /**
   * High contrast dims every layer outside m_highContrastLayers to
   * Mix( background, 0.2 ) (`render_settings.cpp:92-93`, factor 0.2 at :42) -
   * on black, one fifth of the layer. GerbView puts exactly the active layer
   * in the set (`gerbview_draw_panel_gal.cpp:74-86`).
   */
  it('dims every layer but the high-contrast one to a fifth, on black', () => {
    const rs = settings();
    rs.SetHighContrast(true);
    rs.SetLayerIsHighContrast(DRAW1);

    const dim = rs.GetColor(dark, DRAW0);
    expect(dim.r).toBeCloseTo((79 / 255) * 0.2, 6);
    expect(dim.g).toBeCloseTo((203 / 255) * 0.2, 6);
    expect(dim.a).toBe(1);
    expect(css(rs.GetColor(dark, DRAW1))).toBe('rgb(141, 203, 129)');
  });
});

/**
 * GERBVIEW_RENDER_SETTINGS never overrides IsBackgroundDark, whose base
 * returns a flat false (`render_settings.h:288-291`), so the selection box
 * takes the BRIGHT scheme on GerbView's black canvas. Reasoning from the
 * visible background instead is the more sensible answer and the wrong one.
 */
describe('GERBVIEW_RENDER_SETTINGS::IsBackgroundDark', () => {
  it('is false, whatever the background is', () => {
    expect(settings().IsBackgroundDark()).toBe(false);
  });
});
