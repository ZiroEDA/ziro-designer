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
import { parseGerber } from '@ziroeda/gerbview';
import {
  GBR_CONTROL,
  GBR_TOP_AUX_TOOLBAR,
  GBR_TOP_TOOLBAR,
} from '@ziroeda/designer/src/editors/gerbview/gerberToolbars.js';
import {
  apertureAttributeChoices,
  componentChoices,
  dcodeChoices,
  netChoices,
  NO_SELECTION_STRING,
  showApertureType,
  textInfoLine,
} from '@ziroeda/designer/src/editors/gerbview/gerberAuxControls.js';
import { gridChoiceLabel } from '@ziroeda/designer/src/ui/grid_settings.js';
import { ZOOM_LIST, zoomChoices } from '@ziroeda/designer/src/ui/zoom_settings.js';
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
    expect(showApertureType(APERTURE_T.APT_POLYGON)).toBe('Poly');
  });

  it('names the other four as upstream does', () => {
    expect(showApertureType(APERTURE_T.APT_CIRCLE)).toBe('Round');
    expect(showApertureType(APERTURE_T.APT_RECT)).toBe('Rect');
    expect(showApertureType(APERTURE_T.APT_OVAL)).toBe('Oval');
    expect(showApertureType(APERTURE_T.APT_MACRO)).toBe('Macro');
  });
});

/**
 * A two-aperture, two-item RS-274X file in millimetres: D10 is a 0.6 mm round
 * pad and D11 a 1.5 x 0.8 mm rectangle, flashed with %TO.N / %TO.C attached.
 */
const SAMPLE = [
  '%FSLAX36Y36*%',
  '%MOMM*%',
  '%TF.FileFunction,Copper,L1,Top*%',
  '%ADD10C,0.6*%',
  '%ADD11R,1.5X0.8*%',
  '%TO.N,GND*%',
  '%TO.C,R1*%',
  'D10*',
  'X1000000Y1000000D03*',
  '%TO.N,VCC*%',
  '%TO.C,C2*%',
  'D11*',
  'X2000000Y1000000D03*',
  'M02*',
].join('\n');

describe('updateDCodeSelectBox', () => {
  const image = parseGerber(SAMPLE, 'top.gbr');

  /**
   * `msg.Printf( wxT( "tool %d [%.3fx%.3f %s] %s" ), ... )` (`:322-326`).
   * `%.3f` is three decimals in EVERY unit, which is why this does not go
   * through MessageTextFromValue: 0.6 mm is "0.600", not "0.6000".
   */
  it('formats an aperture as tool N [WxH unit] Type', () => {
    const rows = dcodeChoices(image, 'mm', GBR_IU_PER_MM);
    expect(rows.map((r) => r.label)).toEqual([
      'tool 10 [0.600x0.600 mm] Round',
      'tool 11 [1.500x0.800 mm] Rect',
    ]);
  });

  /** `units = wxT( "in" )` and `wxT( "mil" )` — singular, and not "inches". */
  it('spells the units in and mil, GerbView’s own words', () => {
    expect(dcodeChoices(image, 'in', GBR_IU_PER_MM)[0]?.label).toBe(
      'tool 10 [0.024x0.024 in] Round',
    );
    expect(dcodeChoices(image, 'mils', GBR_IU_PER_MM)[0]?.label).toBe(
      'tool 10 [23.622x23.622 mil] Round',
    );
  });

  it('carries the D-code number the selection stores', () => {
    expect(dcodeChoices(image, 'mm', GBR_IU_PER_MM).map((r) => r.dcode)).toEqual([10, 11]);
  });

  /** The box is per-active-layer, so no image means no rows at all (`:275-283`). */
  it('is empty when the active layer holds no image', () => {
    expect(dcodeChoices(null, 'mm', GBR_IU_PER_MM)).toEqual([]);
  });
});

describe('the three highlight lists', () => {
  const a = parseGerber(SAMPLE, 'top.gbr');
  const b = parseGerber(
    ['%FSLAX36Y36*%', '%MOMM*%', '%ADD10C,0.2*%', '%TO.C,U9*%', 'D10*', 'X0Y0D03*', 'M02*'].join(
      '\n',
    ),
    'bot.gbr',
  );

  /**
   * "Build the full list of component names from the partial lists stored in
   * EACH file image" (`:335-345`). Ours read the active image only, so U9 —
   * which lives on the second layer — was invisible while layer 1 was active.
   */
  it('spans every loaded image, not just the active one', () => {
    expect(componentChoices([a, b])).toEqual(['C2', 'R1', 'U9']);
    expect(componentChoices([a])).toEqual(['C2', 'R1']);
  });

  /** `std::map<wxString, int>` sorts and de-duplicates before the append. */
  it('sorts and de-duplicates, as the std::map does', () => {
    expect(netChoices([a, a])).toEqual(['GND', 'VCC']);
  });

  /**
   * `m_SelNetnameBox->Append( UnescapeString( entry.first ) )` (`:381`) -- the
   * net choice is the ONE of the three that unescapes, and a hierarchical net
   * name reaches the file with its slash written `{slash}`. Note the sort is
   * still on the escaped key, because upstream's std::map is keyed on it and
   * only the Append unescapes.
   */
  it('unescapes a net name, which the component and attribute lists do not', () => {
    const esc = parseGerber(
      [
        '%FSLAX36Y36*%',
        '%MOMM*%',
        '%ADD10C,0.2*%',
        '%TO.N,SHEET{slash}NET*%',
        '%TO.C,J{slash}1*%',
        'D10*',
        'X0Y0D03*',
        'M02*',
      ].join('\n'),
      'esc.gbr',
    );
    expect(netChoices([esc])).toEqual(['SHEET/NET']);
    expect(componentChoices([esc])).toEqual(['J{slash}1']);
  });

  it('is empty when nothing is loaded', () => {
    expect(netChoices([])).toEqual([]);
    expect(apertureAttributeChoices([])).toEqual([]);
  });
});

describe('UpdateTitleAndInfo’s text-info box', () => {
  /** `wxString info = _( "Drawing layer not in use" );` (`gerbview_frame.cpp:671`). */
  it('says the layer is not in use when there is no image', () => {
    expect(textInfoLine(null)).toBe('Drawing layer not in use');
  });

  /**
   * `"fmt: %s X%d.%d Y%d.%d no %cZ"` (`:701-708`). %FSLAX36Y36 is 3 integer
   * and 6 fractional digits with leading zeros omitted, so the trailing-zero
   * flag prints 'L'; %MOMM makes the unit word "mm". The file carries a
   * %TF.FileFunction, which is the one thing that sets `m_IsX2_file`
   * (`rs274x.cpp:390-397`), so " X2 attr" follows.
   */
  it('prints the coordinate format, and flags an X2 file', () => {
    expect(textInfoLine(parseGerber(SAMPLE, 'top.gbr'))).toBe('fmt: mm X3.6 Y3.6 no LZ X2 attr');
  });

  it('omits the X2 flag for a file with no file function', () => {
    const plain = parseGerber(
      ['%FSLAX24Y24*%', '%MOIN*%', '%ADD10C,0.01*%', 'D10*', 'X0Y0D03*', 'M02*'].join('\n'),
      'p.gbr',
    );
    expect(textInfoLine(plain)).toBe('fmt: in X2.4 Y2.4 no LZ');
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
    expect(gridChoiceLabel('0.5 mm', 'mm', GBR_IU_PER_MM)).toBe('0.5000 mm (19.69 mils)');
  });

  /** `GetUnitPair`: an imperial primary pairs with mm, a metric one with mils. */
  it('swaps the bracketed unit when the frame is imperial', () => {
    expect(gridChoiceLabel('10 mil', 'mils', GBR_IU_PER_MM)).toBe('10.00 mils (0.2540 mm)');
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
