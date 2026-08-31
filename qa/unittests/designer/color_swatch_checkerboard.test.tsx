// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COLOR_SWATCH::RenderToDC` builds its checkerboard from a colour the CALLER
 * supplies, not from a fixed pair (`common/widgets/color_swatch.cpp:74-107`):
 *
 *     if( aColor.m_text || aColor == COLOR4D::UNSPECIFIED )   -> aCheckerboardBackground
 *     else                                                    -> aBackground
 *     if( base.GetBrightness() > 0.4 ) { white = base; black = white.Darkened( 0.15 ); }
 *     else                             { black = BLACK; white = black.Brightened( 0.15 ); }
 *
 * and the colour pages pass `m_currentSettings->GetColor( m_backgroundLayer )`
 * as `aBackground` (`panel_color_settings.cpp:262`) — the SCHEMATIC's own
 * background, which for KiCad Default is a bright rgb(245,244,239).
 *
 * Ours had the dark pair baked into the CSS. A live Colors page's "ERC
 * exclusions" swatch reads rgb(204,204,203): 194 at alpha 0.8 over 245, not
 * over black. Every partially transparent colour on the page was checkerboarded
 * against the wrong surface.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ColorSwatch } from '@ziroeda/designer/src/ui/ColorSwatch.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/src/color4d.js';

afterEach(cleanup);

/** `s_defaultTheme`'s LAYER_SCHEMATIC_BACKGROUND, rgb(245,244,239). */
const LIGHT: Color4d = { r: 245 / 255, g: 244 / 255, b: 239 / 255, a: 1 };
/** LAYER_ERC_EXCLUSION, rgb(194,194,194) at alpha 0.8. */
const HALF: Color4d = { r: 194 / 255, g: 194 / 255, b: 194 / 255, a: 0.8 };

const swatch = (color: Color4d, background?: Color4d): HTMLElement => {
  const { container } = render(
    <ColorSwatch label="x" color={color} background={background} onChange={() => {}} />,
  );
  return container.querySelector('.ze-swatch') as HTMLElement;
};

describe('the checkerboard is built from the surface the caller names', () => {
  it('takes the bright background and a 15 %-darker copy of it', () => {
    const el = swatch(HALF, LIGHT);
    // `white = aBackground`, `black = white.Darkened( 0.15 )`, and Darkened
    // scales each channel by 1 - f: 245*0.85 = 208.25 -> 208.
    expect(el.style.getPropertyValue('--checker-hi')).toBe('rgb(245, 244, 239)');
    expect(el.style.getPropertyValue('--checker-lo')).toBe('rgb(208, 207, 203)');
  });

  it('leaves the dark pair to the stylesheet when the background is dark', () => {
    const el = swatch(HALF, { r: 0.15, g: 0.15, b: 0.15, a: 1 });
    expect(el.style.getPropertyValue('--checker-hi')).toBe('');
    expect(el.style.getPropertyValue('--checker-lo')).toBe('');
  });

  it('ignores the background entirely for an UNSPECIFIED colour', () => {
    // That branch reads `m_checkerboardBg` — the PARENT window's background,
    // which is a --chrome-bg2 list in every one of our call sites, so it takes
    // the dark pair whatever the document background is.
    const el = swatch(COLOR4D_UNSPECIFIED, LIGHT);
    expect(el.style.getPropertyValue('--checker-hi')).toBe('');
    expect(el.style.getPropertyValue('--checker-lo')).toBe('');
  });

  it('says nothing when no caller names a surface', () => {
    const el = swatch(HALF);
    expect(el.style.getPropertyValue('--checker-hi')).toBe('');
  });
});
