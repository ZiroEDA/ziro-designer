// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView's TOP_AUX toolbar and the two controls that close TOP_MAIN.
 *
 * Counterpart: `GERBVIEW_TOOLBAR_SETTINGS::DefaultToolbarConfig`
 * (`gerbview/toolbars_gerber.cpp:39-116`) for the layout, and the four
 * `update*SelectBox` methods (`:265-421`) plus
 * `GERBVIEW_FRAME::UpdateTitleAndInfo` (`gerbview/gerbview_frame.cpp:660-719`)
 * for what goes in them.
 *
 * The row did not exist here at all: the four highlight choices were squeezed
 * onto the main button row with invented labels and an invented empty entry,
 * there was no `Attr:` choice, and no grid or zoom selector anywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  GBR_CONTROL,
  GBR_TOP_AUX_TOOLBAR,
  GBR_TOP_TOOLBAR,
  NO_SELECTION_STRING,
} from '@ziroeda/gerbview/toolbars_gerber.js';
import { D_CODE } from '@ziroeda/gerbview/dcode.js';
import { GRID_SIZE_LIST, gridChoiceLabel } from '@ziroeda/common/settings/grid_settings_ui.js';
import { ZOOM_LIST, zoomChoices } from '@ziroeda/common/settings/zoom_settings.js';
import { APERTURE_T } from '@ziroeda/gerbview';

/** GerbView reads coordinates at 1 nm per IU, `gerbIUScale.IU_PER_MM`. */
const GBR_IU_PER_MM = 1e6;

describe('the TOP_AUX toolbar layout', () => {
  /**
   * Written out from `toolbars_gerber.cpp:107-115` rather than read back off
   * the module, so a reordering here fails instead of agreeing with itself.
   * The asymmetry is upstream's: 5 px spacers between the four choices, and
   * separator rules only before the grid and zoom selectors.
   */
  it('is the four highlight choices, then grid and zoom behind separators', () => {
    expect(GBR_TOP_AUX_TOOLBAR).toEqual([
      { control: 'control.ComponentHighlight' },
      { spacer: 5 },
      { control: 'control.NetHighlight' },
      { spacer: 5 },
      { control: 'control.AppertureHighlight' },
      { spacer: 5 },
      { control: 'control.GerberDcodeSelector' },
      'sep',
      { control: 'control.GridSelector' },
      'sep',
      { control: 'control.ZoomSelector' },
    ]);
  });

  it('spaces the highlight choices and rules off the selectors, never the reverse', () => {
    const gaps = GBR_TOP_AUX_TOOLBAR.filter(
      (e) => e === 'sep' || (typeof e === 'object' && 'spacer' in e),
    );
    expect(gaps).toEqual([{ spacer: 5 }, { spacer: 5 }, { spacer: 5 }, 'sep', 'sep']);
  });
});

describe('TOP_MAIN ends where upstream ends it', () => {
  /** `.AppendSeparator().AppendControl( layerSelector ).AppendControl( textInfo )` (`:99-103`). */
  it('closes with a separator, the layer selector and the text info', () => {
    expect(GBR_TOP_TOOLBAR.slice(-3)).toEqual([
      'sep',
      { control: 'control.LayerSelector' },
      { control: 'control.TextInfo' },
    ]);
  });

  it('names the controls as upstream names them', () => {
    // A typo here means the frame's factory never matches and the widget
    // silently never renders, which is exactly how a control goes missing.
    expect(GBR_CONTROL).toEqual({
      layerSelector: 'control.LayerSelector',
      textInfo: 'control.TextInfo',
      componentHighlight: 'control.ComponentHighlight',
      netHighlight: 'control.NetHighlight',
      appertureHighlight: 'control.AppertureHighlight',
      dcodeSelector: 'control.GerberDcodeSelector',
      gridSelect: 'control.GridSelector',
      zoomSelect: 'control.ZoomSelector',
    });
  });
});

describe('the empty entry', () => {
  /** `#define NO_SELECTION_STRING _( "<No selection>" )` (`:280`). */
  it('is <No selection>, not our "-" or "All"', () => {
    expect(NO_SELECTION_STRING).toBe('<No selection>');
  });
});

describe('D_CODE::ShowApertureType', () => {
  /** `gerbview/dcode.cpp:86-110`. "Poly" is four letters; ours said "Polygon". */
  it('abbreviates a polygon to Poly', () => {
    expect(D_CODE.ShowApertureType(APERTURE_T.APT_POLYGON)).toBe('Poly');
  });

  it('names the other four as upstream does', () => {
    expect(D_CODE.ShowApertureType(APERTURE_T.APT_CIRCLE)).toBe('Round');
    expect(D_CODE.ShowApertureType(APERTURE_T.APT_RECT)).toBe('Rect');
    expect(D_CODE.ShowApertureType(APERTURE_T.APT_OVAL)).toBe('Oval');
    expect(D_CODE.ShowApertureType(APERTURE_T.APT_MACRO)).toBe('Macro');
  });
});

describe('the grid selector', () => {
  /**
   * The value a real GerbView shows on a cold open, read off the screenshot
   * Akshay captured on 2026-08-20: "0.5000 mm (19.69 mils)". It is index 15 of
   * GerbView's own grid list, which is `defaultGridIdx` for everything that is
   * not eeschema/symbol_editor/pl_editor (`app_settings.cpp:472-481`).
   *
   * Both halves are load-bearing: mm at four decimals and mils at two is
   * MessageTextFromValue's non-short-form precision, which is what a 1e6-IU
   * frame gets; a 1e4-IU frame would print "0.500 mm (20 mils)".
   */
  it('reads 0.5000 mm (19.69 mils) at GerbView’s default grid', () => {
    // Read from the table rather than retyped, so the row and the label are
    // pinned together: index 15 IS the default, and it is square.
    expect(gridChoiceLabel(GRID_SIZE_LIST.gerbview[15]!, 'mm', GBR_IU_PER_MM)).toBe(
      '0.5000 mm (19.69 mils)',
    );
  });

  /** `GetUnitPair`: an imperial primary pairs with mm, a metric one with mils. */
  it('swaps the bracketed unit when the frame is imperial', () => {
    expect(gridChoiceLabel({ x: '10 mil', y: '10 mil' }, 'mils', GBR_IU_PER_MM)).toBe(
      '10.00 mils (0.2540 mm)',
    );
  });

  /**
   * The row that decides how wide the whole control is, and the reason this
   * table needed a Y column at all. Four of GerbView's defaults are not square
   * (`app_settings.cpp:629,635-637`), and `GRID::MessageText` prints both axes
   * when their formatted strings differ. Read off the open dropdown in
   * Akshay's capture of 2026-08-21.
   */
  it('prints both axes for the four grids that are not square', () => {
    expect(gridChoiceLabel(GRID_SIZE_LIST.gerbview[13]!, 'mm', GBR_IU_PER_MM)).toBe(
      '1.5000 mm x 2.5000 mm (59.06 mils x 98.43 mils)',
    );
    expect(gridChoiceLabel(GRID_SIZE_LIST.gerbview[19]!, 'mm', GBR_IU_PER_MM)).toBe(
      '0.0500 mm x 0.0000 mm (1.97 mils x 0.00 mils)',
    );
    // A zero Y is upstream's own oddity, mirrored rather than corrected.
    expect(GRID_SIZE_LIST.gerbview[21]).toStrictEqual({ x: '0.01 mm', y: '0.0 mm' });
  });
});

describe('the zoom selector', () => {
  const list = ZOOM_LIST.gerbview;

  /**
   * The other value off that same screenshot: a fitted GerbView read
   * "Zoom 0.58", which is on no preset, so `updateZoomSelectBox` inserts a row
   * carrying the exact figure at index 1 and selects it
   * (`eda_draw_frame.cpp:521-533`).
   */
  it('gives an off-preset zoom a row of its own, below Zoom Auto', () => {
    const { choices, selected } = zoomChoices(0.58, list);
    expect(choices[0]?.label).toBe('Zoom Auto');
    expect(choices[1]?.label).toBe('Zoom 0.58');
    expect(selected).toBe(1);
  });

  /** "Zoom %.2f" — no colon. ZOOM_MENU's rows are "Zoom: %.2f" and are not this. */
  it('labels a preset without a colon', () => {
    expect(zoomChoices(1.0, list).choices[9]?.label).toBe('Zoom 1.00');
  });

  it('selects the preset itself when the zoom is on one, offset by Zoom Auto', () => {
    // 0.35 is index 6 of ZOOM_LIST_GERBVIEW, so row 7.
    expect(list[6]).toBe(0.35);
    const { choices, selected } = zoomChoices(0.35, list);
    expect(selected).toBe(7);
    expect(choices[selected]?.label).toBe('Zoom 0.35');
    // No custom row, so the list is Auto plus the presets and nothing more.
    expect(choices).toHaveLength(list.length + 1);
  });

  /**
   * `doZoomToPreset` numbering: "idx == 0 is Auto; idx == 1 is first entry in
   * zoomList" (`common_tools.cpp:467`). Auto runs ZoomFitScreen rather than a
   * scale, and the custom row dispatches nothing at all.
   */
  it('carries doZoomToPreset’s own indices, with null for the custom row', () => {
    const { choices } = zoomChoices(0.58, list);
    expect(choices[0]?.preset).toBe(0);
    expect(choices[1]?.preset).toBe(null);
    expect(choices[2]?.preset).toBe(1);
    expect(choices[choices.length - 1]?.preset).toBe(list.length);
  });
});

// ---------------------------------------------------------------------------
// List DCodes
// ---------------------------------------------------------------------------
