// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView's default colours against `s_defaultTheme`
 * (`common/settings/builtin_color_themes.h:28-289`).
 *
 * This file replaced an invented palette: sixteen hexes that appear nowhere
 * upstream, plus a `#DDDDDD` for DCodes, a `#0F0F1A` for negative objects, a
 * flat white for every highlight and a permanent 0.8 alpha. CLAUDE.md calls
 * this case out by name - a table KiCad hardcodes is data, it stays local, but
 * it "must mirror KiCad's own table rather than our invention".
 *
 * Every expectation is transcribed from the header, not read back off the
 * module.
 */
import { describe, expect, it } from 'vitest';
import {
  brightened,
  defaultLayerColor,
  GERBER_AXES_COLOR,
  GERBER_BG_COLOR,
  GERBER_DCODE_COLOR,
  GERBER_DEFAULT_THEME_LAYERS,
  GERBER_DRAWINGSHEET_COLOR,
  GERBER_GRID_COLOR,
  GERBER_LAYER_COLORS,
  GERBER_NEGATIVE_COLOR,
  GERBER_OPACITY_MODE_ALPHA,
  GERBER_PAGE_LIMITS_COLOR,
  highlightedLayerColor,
  selectedLayerColor,
} from '@ziroeda/designer/src/editors/gerbview/gerberColors.js';
import { itemColor } from '@ziroeda/designer/src/editors/gerbview/gerberRender.js';

/** `builtin_color_themes.h:91-104`, the fourteen distinct rows, in order. */
const CYCLE = [
  'rgb(200, 52, 52)',
  'rgb(127, 200, 127)',
  'rgb(206, 125, 44)',
  'rgb(79, 203, 203)',
  'rgb(219, 98, 139)',
  'rgb(167, 165, 198)',
  'rgb(40, 204, 217)',
  'rgb(232, 178, 167)',
  'rgb(242, 237, 161)',
  'rgb(141, 203, 129)',
  'rgb(237, 124, 51)',
  'rgb(91, 195, 235)',
  'rgb(247, 111, 142)',
  'rgb(77, 127, 196)',
];

describe('the layer palette', () => {
  it('is KiCad’s fourteen, in KiCad’s order', () => {
    expect([...GERBER_LAYER_COLORS]).toEqual(CYCLE);
  });

  /**
   * The palette we shipped before. None of these sixteen appears anywhere in
   * KiCad; they were invented and then described in a comment as "GerbView's
   * default colour set", which is what made them survive so long.
   */
  it('holds none of the sixteen invented hexes it replaced', () => {
    const invented = [
      '#D02020',
      '#20A020',
      '#2020D0',
      '#C0C020',
      '#C020C0',
      '#20C0C0',
      '#E08020',
      '#8060C0',
      '#60A0E0',
      '#A0C060',
      '#E060A0',
      '#A0A0A0',
      '#E0A040',
      '#40C080',
      '#C06060',
      '#8080E0',
    ];
    const joined = GERBER_LAYER_COLORS.join('|').toUpperCase();
    for (const hex of invented) expect(joined).not.toContain(hex.toUpperCase());
  });

  /**
   * `s_defaultTheme` lists all 64 entries explicitly and every one is the
   * fourteen repeated - index 14 is index 0 again, and it holds without
   * exception for the whole run (`:91-154`).
   */
  it('repeats every fourteen layers, as the table does', () => {
    expect(defaultLayerColor(0)).toBe(CYCLE[0]);
    expect(defaultLayerColor(13)).toBe(CYCLE[13]);
    expect(defaultLayerColor(14)).toBe(CYCLE[0]);
    expect(defaultLayerColor(28)).toBe(CYCLE[0]);
    expect(defaultLayerColor(63)).toBe(CYCLE[63 % 14]);
  });

  /**
   * GERBER_DRAWLAYERS_COUNT is PCB_LAYER_ID_COUNT = 128
   * (`include/layer_ids.h:519,171`) but the default theme stops at 64; the rest
   * are skipped with "Missing default color for gerbview layer %d"
   * (`color_settings.cpp:113-118`). The gap is KiCad's, recorded not filled.
   */
  it('records that the theme names 64 layers, not all 128', () => {
    expect(GERBER_DEFAULT_THEME_LAYERS).toBe(64);
  });
});

describe('the seven gerbview-specific layers', () => {
  /** `color_settings.cpp:103-109` maps each of these to its s_defaultTheme row. */
  it('are the rows the theme gives them', () => {
    expect(GERBER_AXES_COLOR).toBe('rgb(0, 0, 132)'); // :83
    expect(GERBER_BG_COLOR).toBe('rgb(0, 0, 0)'); // :84
    expect(GERBER_DCODE_COLOR).toBe('rgb(255, 255, 255)'); // :85
    expect(GERBER_GRID_COLOR).toBe('rgb(132, 132, 132)'); // :86
    expect(GERBER_NEGATIVE_COLOR).toBe('rgb(132, 132, 132)'); // :87
    expect(GERBER_DRAWINGSHEET_COLOR).toBe('rgb(0, 0, 132)'); // :88
    expect(GERBER_PAGE_LIMITS_COLOR).toBe('rgb(132, 132, 132)'); // :89
  });

  /**
   * Both were wrong, and both in the direction of being invisible: DCodes were
   * #DDDDDD against white, and the negative-object "ghost" was #0F0F1A - a
   * near-black - against a black background.
   */
  it('no longer dims DCodes or hides the negative-object ghost', () => {
    expect(GERBER_DCODE_COLOR).not.toBe('#DDDDDD');
    expect(GERBER_NEGATIVE_COLOR).not.toBe('#0F0F1A');
  });

  /** DARKGRAY is `{ 132, 132, 132 }` (`common/gal/color4d.cpp:46`). */
  it('gives negative objects the same DARKGRAY the display options default to', () => {
    // GBR_DISPLAY_OPTIONS(): m_NegativeDrawColor = COLOR4D( DARKGRAY )
    // (gerbview/gbr_display_options.h:57).
    expect(GERBER_NEGATIVE_COLOR).toBe(GERBER_GRID_COLOR);
  });
});

describe('the opacity mode', () => {
  /**
   * `m_OpacityModeAlphaValue = 0.6` (`gbr_display_options.h:61`), applied ONLY
   * when m_ForceOpacityMode is on (`gerbview_painter.cpp:65-66`). Outside it a
   * layer keeps the theme's alpha, which is 1 for all 64 rows. Ours composited
   * everything at a permanent 0.8.
   */
  it('is 0.6, and it is a mode rather than the normal state', () => {
    expect(GERBER_OPACITY_MODE_ALPHA).toBe(0.6);
    expect(GERBER_OPACITY_MODE_ALPHA).not.toBe(0.8);
  });
});

describe('COLOR4D::Brightened', () => {
  /**
   * `r * ( 1.0 - aFactor ) + aFactor` on 0..1 components
   * (`include/gal/color4d.h:269-275`) - a lerp towards white, not a multiply.
   * Worked by hand: 77/255 = 0.30196; 0.30196 * 0.5 + 0.5 = 0.65098;
   * 0.65098 * 255 = 166.0 -> 166.
   */
  it('lerps towards white by the factor', () => {
    expect(brightened('rgb(77, 127, 196)', 0.5)).toBe('rgb(166, 191, 226)');
  });

  it('is the identity at 0 and pure white at 1', () => {
    expect(brightened('rgb(200, 52, 52)', 0)).toBe('rgb(200, 52, 52)');
    expect(brightened('rgb(200, 52, 52)', 1)).toBe('rgb(255, 255, 255)');
  });

  /**
   * A lerp lifts a dark colour much further than a light one, which a multiply
   * would not. 40 -> 148 is +108; 217 -> 236 is only +19.
   */
  it('lifts a dark channel far more than a light one', () => {
    expect(brightened('rgb(40, 204, 217)', 0.5)).toBe('rgb(148, 230, 236)');
  });

  it('reads hex as well as rgb(), and leaves anything else alone', () => {
    expect(brightened('#4d7fc4', 0.5)).toBe('rgb(166, 191, 226)');
    expect(brightened('not-a-colour', 0.5)).toBe('not-a-colour');
  });
});

describe('the highlight and selection colours', () => {
  /**
   * `m_layerColorsHi[i] = baseColor.Brightened( 0.5 )` and
   * `m_layerColorsSel[i] = baseColor.Brightened( 0.8 )`
   * (`gerbview_painter.cpp:70-71`). Both are the LAYER's colour lifted, so a
   * highlighted item still reads as belonging to its layer. Ours painted every
   * highlight flat white, which lost the layer entirely.
   */
  it('are the layer’s own colour brightened, not white', () => {
    const layer = CYCLE[0] as string;
    expect(highlightedLayerColor(layer)).toBe(brightened(layer, 0.5));
    expect(selectedLayerColor(layer)).toBe(brightened(layer, 0.8));
    expect(highlightedLayerColor(layer)).not.toBe('rgb(255, 255, 255)');
  });

  it('lift a selection further than a highlight', () => {
    const layer = CYCLE[13] as string;
    // 0.8 > 0.5, so the selected form is closer to white on every channel.
    expect(selectedLayerColor(layer)).toBe('rgb(219, 229, 243)');
    expect(highlightedLayerColor(layer)).toBe('rgb(166, 191, 226)');
  });

  it('differ per layer, which a single constant could not', () => {
    const a = highlightedLayerColor(CYCLE[0] as string);
    const b = highlightedLayerColor(CYCLE[6] as string);
    expect(a).not.toBe(b);
  });
});

describe('GERBVIEW_RENDER_SETTINGS::GetColor, as the renderer applies it', () => {
  const layer = 'rgb(200, 52, 52)';
  /** (layerColor, highlighted, negativePolarity, showNegativeObjects) */

  /**
   * A highlighted item must take ITS OWN LAYER's colour brightened,
   * `m_layerColorsHi[aLayer]` (`gerbview_painter.cpp:70,135-147`), not a
   * constant. A flat white here survived a mutation sweep of the colour module
   * because nothing reached the renderer's choice - so the choice is a function
   * now, and this is what pins it.
   */
  it('brightens the layer for a highlighted item, per layer', () => {
    expect(itemColor(layer, true, false, false)).toBe(highlightedLayerColor(layer));
    expect(itemColor(layer, true, false, false)).not.toBe('rgb(255, 255, 255)');

    const other = 'rgb(40, 204, 217)';
    expect(itemColor(other, true, false, false)).not.toBe(itemColor(layer, true, false, false));
  });

  it('leaves an ordinary item on its layer colour', () => {
    expect(itemColor(layer, false, false, false)).toBe(layer);
  });

  /** LAYER_NEGATIVE_OBJECTS when show_negative_objects is on (`:124-127`). */
  it('gives a shown negative object the negative-objects colour', () => {
    expect(itemColor(layer, false, true, true)).toBe(GERBER_NEGATIVE_COLOR);
  });

  /** `return transparent;` — COLOR4D( 0, 0, 0, 0 ) (`:130`). */
  it('gives a hidden negative object no colour at all', () => {
    expect(itemColor(layer, false, true, false)).toBe(null);
  });

  /**
   * THE ORDER. `if( gbrItem && gbrItem->GetLayerPolarity() )` is at `:122` and
   * the first highlight test is at `:135`, so polarity wins. An earlier draft
   * of this module had it the other way round and an earlier draft of this very
   * test asserted the wrong answer and passed - which is why it is spelled out
   * against the line numbers rather than described.
   */
  it('tests polarity BEFORE the highlight, as upstream does', () => {
    // Clear object, highlighted, toggle on -> negative colour, not brightened.
    expect(itemColor(layer, true, true, true)).toBe(GERBER_NEGATIVE_COLOR);
    expect(itemColor(layer, true, true, true)).not.toBe(highlightedLayerColor(layer));

    // Clear object, highlighted, toggle off -> transparent, still not brightened.
    expect(itemColor(layer, true, true, false)).toBe(null);
  });
});

describe('the axes', () => {
  /**
   * GerbView is the ONE editor that draws them: `grid.axes_enabled` defaults
   * false in every app (`common/settings/app_settings.cpp:459-460`), but
   * GERBVIEW_FRAME's constructor sets the GAL option directly - "Enable the
   * axes to match legacy draw style" (`gerbview/gerbview_frame.cpp:188-191`).
   * Ours drew none at all.
   *
   * The colour is NOT LAYER_GERBVIEW_AXES, though that entry exists with the
   * same value. Only pcbnew and eeschema call `SetAxesColor` with a theme
   * colour (`pcbnew/pcb_draw_panel_gal.cpp:495`); GerbView never does, so the
   * axes keep the GAL default `SetAxesColor( COLOR4D( BLUE ) )`
   * (`opengl_gal.cpp:433`).
   *
   * `BLUE` is `{ 132, 0, 0 }` in `colorRefs()` (`color4d.cpp:54`) and that
   * table is **BGR** - `m_Blue, m_Green, m_Red` (`color4d.h:85-92`). Read in
   * written order it would be a dark RED; read correctly it is rgb(0,0,132).
   */
  it('is COLOR4D(BLUE), which is BGR-encoded and reads rgb(0, 0, 132)', () => {
    expect(GERBER_AXES_COLOR).toBe('rgb(0, 0, 132)');
    // The trap: taking colorRefs()'s three bytes in written order.
    expect(GERBER_AXES_COLOR).not.toBe('rgb(132, 0, 0)');
  });

  /**
   * It coincides with LAYER_GERBVIEW_AXES (`builtin_color_themes.h:83`), which
   * is what the Colors preference page edits
   * (`panel_gerbview_color_settings.cpp:96`) - and editing it does not move the
   * drawn axes, because nothing wires it to the GAL. Same value, different
   * provenance; pinned so the coincidence is not mistaken for a wiring.
   */
  it('coincides with the theme entry without being it', () => {
    expect(GERBER_AXES_COLOR).toBe('rgb(0, 0, 132)');
    expect(GERBER_DRAWINGSHEET_COLOR).toBe('rgb(0, 0, 132)');
  });
});
