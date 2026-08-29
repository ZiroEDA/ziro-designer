// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `COLOR4D` operations the painters derive colours with, and the two
 * derivations built on them: `EDIT_POINTS::ViewDraw`'s handle colours and
 * `SCH_PAINTER::getRenderColor`'s background-layer alpha.
 *
 * Both used to be hardcoded guesses. The edit points were a white square with a
 * dark border, which is upside down: `LAYER_SCHEMATIC_AUX_ITEMS` is black in
 * both builtin themes, so upstream draws a black square with a pale border.
 */
import { describe, it, expect } from 'vitest';
import {
  backgroundLayerFill,
  brightened,
  brightness,
  cssWithAlpha,
  darkened,
  distance,
  editPointColors,
  inverted,
  isTransparent,
  parseColor4d,
  toCss,
} from '@ziroeda/common';
import { KICAD_CLASSIC, KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

describe('parsing the forms the themes are written in', () => {
  it('reads rgb() and rgba()', () => {
    expect(parseColor4d('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor4d('rgba(0, 0, 0, 0.8)')).toEqual({ r: 0, g: 0, b: 0, a: 0.8 });
    // The transparent sheet background both builtin themes ship.
    expect(parseColor4d('rgba(255, 255, 255, 0)').a).toBe(0);
  });

  it('reads hex', () => {
    expect(parseColor4d('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor4d('#f00')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it('round-trips through CSS', () => {
    expect(toCss(parseColor4d('rgb(132, 0, 132)'))).toBe('rgb(132, 0, 132)');
    expect(toCss(parseColor4d('rgba(102, 178, 255, 0.8)'))).toBe('rgba(102, 178, 255, 0.8)');
  });

  it('falls back to opaque black rather than to something invisible', () => {
    expect(parseColor4d('not a colour')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe('the COLOR4D formulas', () => {
  it('Distance is the squared RGB distance, alpha ignored', () => {
    const white = parseColor4d('rgb(255, 255, 255)');
    const black = parseColor4d('rgb(0, 0, 0)');
    expect(distance(white, black)).toBeCloseTo(3, 10);
    expect(distance(white, parseColor4d('rgba(255, 255, 255, 0)'))).toBe(0);
  });

  it('GetBrightness uses KiCad’s weights', () => {
    // r * 0.299 + g * 0.587 + b * 0.117 (color4d.h; note 0.117, not 0.114).
    expect(brightness(parseColor4d('rgb(0, 255, 0)'))).toBeCloseTo(0.587, 10);
    expect(brightness(parseColor4d('rgb(0, 0, 0)'))).toBe(0);
  });

  it('Brightened mixes towards white, Darkened scales towards black', () => {
    expect(toCss(brightened(parseColor4d('rgb(0, 0, 0)'), 0.7))).toBe('rgb(179, 179, 179)');
    expect(toCss(darkened(parseColor4d('rgb(255, 255, 255)'), 0.7))).toBe('rgb(77, 77, 77)');
  });

  it('Inverted keeps alpha', () => {
    expect(inverted(parseColor4d('rgba(0, 0, 0, 0.5)'))).toEqual({ r: 1, g: 1, b: 1, a: 0.5 });
  });

  it('cssWithAlpha and isTransparent', () => {
    expect(cssWithAlpha('rgb(255, 0, 0)', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(isTransparent('rgba(255, 255, 255, 0)')).toBe(true);
    expect(isTransparent('rgb(255, 255, 255)')).toBe(false);
  });
});

describe('editPointColors (EDIT_POINTS::ViewDraw)', () => {
  it('gives a black handle with a pale border on a light sheet', () => {
    // LAYER_SCHEMATIC_AUX_ITEMS is black; the background is far from black, so
    // there is no inversion; black has brightness 0, so the border takes the
    // `Brightened( 0.7 )` arm at alpha 0.8.
    const c = editPointColors(KICAD_DEFAULT.auxItems, KICAD_DEFAULT.background);
    expect(c.fill).toBe('rgb(0, 0, 0)');
    expect(c.border).toBe('rgba(179, 179, 179, 0.8)');
    expect(c.highlight).toBe('rgba(128, 128, 128, 0.8)');
  });

  it('is the same on the classic theme, which also ships black aux items', () => {
    const c = editPointColors(KICAD_CLASSIC.auxItems, KICAD_CLASSIC.background);
    expect(c.fill).toBe('rgb(0, 0, 0)');
  });

  it('inverts the fill when it would vanish into the background', () => {
    // "Don't assume LAYER_AUX_ITEMS is always a good choice. Compare with
    // background." A black handle on a black sheet becomes white.
    const c = editPointColors('rgb(0, 0, 0)', 'rgb(20, 20, 20)');
    expect(c.fill).toBe('rgb(255, 255, 255)');
    // White is bright, so the border darkens instead of brightening.
    expect(c.border).toBe('rgba(77, 77, 77, 0.8)');
  });

  it('takes the middle arm for a mid-brightness fill', () => {
    // brightness between 0.2 and 0.5 -> Brightened( 0.4 ) / Brightened( 0.3 ).
    const c = editPointColors('rgb(0, 128, 0)', 'rgb(255, 255, 255)');
    expect(brightness(parseColor4d('rgb(0, 128, 0)'))).toBeGreaterThan(0.2);
    expect(brightness(parseColor4d('rgb(0, 128, 0)'))).toBeLessThan(0.5);
    expect(c.border).toBe('rgba(102, 179, 102, 0.8)');
  });
});

describe('backgroundLayerFill (getRenderColor, as KiCad actually composites it)', () => {
  it('leaves an unselected background exactly as it came, only normalised', () => {
    expect(backgroundLayerFill('rgb(40, 60, 100)', false, false)).toBe('rgb(40, 60, 100)');
    expect(backgroundLayerFill('#284364', false, false)).toBe('rgb(40, 67, 100)');
    expect(backgroundLayerFill('rgba(40, 60, 100, 0.35)', false, false)).toBe(
      'rgba(40, 60, 100, 0.35)',
    );
  });

  it('draws a selected one as the measured overlay composite, not WithAlpha(0.5)', () => {
    // Real eeschema 10.0.5 composites a selected background-layer fill as
    // clamp( 0.5·c + 0.75·dst ) — see qa/probes/sch_selected_background/. The
    // only single source-over draw with those weights is colour c/0.5 at alpha
    // 1 - 0.75, because 0.25·(2c) is the same 0.5·c.
    expect(backgroundLayerFill('rgb(40, 60, 100)', true, false)).toBe('rgba(80, 120, 200, 0.25)');
    // Explicitly not the alpha the C++ states.
    expect(backgroundLayerFill('rgb(40, 60, 100)', true, false)).not.toBe('rgba(40, 60, 100, 0.5)');
  });

  it('clamps the doubled colour, which is where the residual lives', () => {
    // LAYER_DEVICE_BACKGROUND. 2·194 = 388, so blue saturates as a CSS colour
    // while KiCad's clamp falls on the sum instead and reaches pure white.
    expect(backgroundLayerFill('rgb(255, 255, 194)', true, false)).toBe(
      'rgba(255, 255, 255, 0.25)',
    );
  });

  it('*replaces* the fill alpha rather than scaling it', () => {
    // `COLOR4D WithAlpha( double aAlpha ) const { return COLOR4D( r, g, b, aAlpha ); }`
    //
    // Selecting a half-transparent background must not compound its own alpha
    // with the selection's: a 0.35 fill and an opaque one are drawn the same.
    expect(backgroundLayerFill('rgba(40, 60, 100, 0.35)', true, false)).toBe(
      backgroundLayerFill('rgb(40, 60, 100)', true, false),
    );
  });

  it('keeps the brightened arm at the stated 0.2, because it was not measured', () => {
    // IsBrightened() is tested before IsSelected() upstream, and the probe never
    // reached this arm: UpdateNetHighlighting brightens a symbol's pins and a
    // power symbol's fields, never a symbol, shape or text box itself.
    expect(backgroundLayerFill('rgb(40, 60, 100)', false, true)).toBe('rgba(40, 60, 100, 0.2)');
    expect(backgroundLayerFill('rgb(40, 60, 100)', true, true)).toBe('rgba(40, 60, 100, 0.2)');
  });
});
