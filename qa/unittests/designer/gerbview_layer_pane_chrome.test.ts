// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The chrome of GerbView's Layers Manager, which a side-by-side against a real
 * GerbView showed to be wrong in four ways at once.
 *
 * All four are ABSENCES or shared tokens, so they are checked in the stylesheet
 * rather than through a render: the rule being broken was that we *had* a
 * declaration where KiCad has none, and a DOM assertion cannot see a rule that
 * should not exist. Each is scoped to the one selector that carried it, so this
 * names the offender rather than reporting that "the pane somewhere" regressed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SHELL = read('../../../designer/src/ui/shell.css');
const GBR = read('../../../designer/src/editors/gerbview/gerbview.css');

/** The body of a rule, comments stripped so prose about a value is not the value. */
const ruleBody = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', at);
  return css.slice(at, end).replace(/\/\*[\s\S]*?\*\//g, '');
};

describe('a layer row paints no background', () => {
  it('found the row rule, so this cannot pass by scanning nothing', () => {
    expect(ruleBody(GBR, '.ze-gbr-layer-row')).toMatch(/display:\s*grid/);
  });

  /**
   * `LAYER_WIDGET::insertLayerRow` (`gerbview/widgets/layer_widget.cpp:320-372`)
   * inserts five loose child windows into a wxFlexGridSizer. There is not one
   * `SetBackgroundColour` in that file and no enter/leave binding, and
   * selecting a row does exactly one thing:
   *
   *     void LAYER_WIDGET::SelectLayerRow( int aRow )            // :664
   *     {
   *         oldIndicator->SetIndicatorState( STATE::OFF );
   *         newIndicator->SetIndicatorState( STATE::ON );
   *     }
   *
   * Ours painted the active row in --chrome-active, a full-width orange band
   * that is the loudest thing on the pane and is in no real GerbView.
   */
  for (const state of ['.active', ':hover']) {
    it(`has no rule for a row${state}`, () => {
      expect(GBR).not.toContain(`.ze-gbr-layer-row${state} {`);
    });
  }

  it('still lights the indicator icon, which is what selection DOES change', () => {
    // The opposite bug: with no row background AND no indicator, nothing would
    // show which layer is active at all.
    expect(SHELL).toContain('.ze-layer-indicator.on {');
  });
});

describe('the INDICATOR_ICON is the arrow createArrow draws', () => {
  it('sits in a c_IndicatorSizeDIP box', () => {
    // 10 (`include/widgets/ui_common.h:52`). Ours was 8.
    expect(SHELL).toMatch(/--indicator-size:\s*10px;/);
    expect(ruleBody(SHELL, '.ze-layer-indicator')).toMatch(/width:\s*var\(--indicator-size\)/);
  });

  it('is KiCad\u2019s own rgb(64, 72, 255), not a chrome tone', () => {
    // `createArrow( ..., wxColour( 64, 72, 255 ) )` (`indicator_icon.cpp:216`)
    // — a colour KiCad picks itself rather than asking the theme for, so it is
    // [data]. A live pane samples exactly that. Ours was #4d7fc4.
    const body = ruleBody(SHELL, '.ze-layer-indicator.on');
    expect(body).toMatch(/background:\s*rgb\(64 72 255\)/);
  });

  it('does not fill the box: 5 across and 9 down, flat edge at x=4', () => {
    // createArrow plots x=4..4, 3..5, 2..6, 1..7, 0..8 over y=1..5 and then
    // Rotate90 maps (x,y) to (H-1-y, x), which lands the flat edge at x=4
    // spanning y=0..8 with the apex at (8,4). A triangle drawn corner to corner
    // — which is what `polygon(0 0, 100% 50%, 0 100%)` gave — is twice as wide
    // and one row short.
    expect(ruleBody(SHELL, '.ze-layer-indicator.on')).toMatch(
      /clip-path:\s*polygon\(4px 0, 4px 9px, 9px 4\.5px\)/,
    );
  });
});

describe('a COLOR_SWATCH is a bare filled rectangle', () => {
  it('has neither a border nor a radius', () => {
    // COLOR_SWATCH::RenderToDC draws with `aDC->SetPen( *wxTRANSPARENT_PEN )`
    // and plain DrawRectangle calls (`common/widgets/color_swatch.cpp:64-110`):
    // no outline and no rounding anywhere in the function. Ours had a 1 px #444
    // border and a 2 px radius, which ate two of the swatch's fourteen rows.
    //
    // The check used to be `not.toMatch(/border/)` — "declare nothing" — and
    // that is exactly what let the defect through. In a browser, declaring
    // nothing on a <button> does NOT mean no border: the user agent supplies a
    // 2px OUTSET one, which rendered as a white-and-grey bevel around every
    // swatch. Matching the C++ here means explicitly REMOVING it, so the
    // assertion has to be that `border: none` is stated, not that the word is
    // absent. Same lesson as the notebook tabs coming out in Arial.
    const body = ruleBody(SHELL, '.ze-layer-swatch');
    expect(body).toMatch(/var\(--swatch-small-w\)/);
    expect(body).toMatch(/border:\s*none/);
    expect(body).toMatch(/padding:\s*0/);
    expect(body).not.toMatch(/radius/);
  });

  it('is 16 x 14, which is the dialog-unit size wx rounds to', () => {
    // SWATCH_SIZE_SMALL_DU(8,6) (include/widgets/color_swatch.h:46) through
    // ConvertDialogToPixels, i.e. wxMulDivInt32 with rounding, at the
    // GetCharWidth() 8 / GetCharHeight() 18 a wx probe reports for Ubuntu
    // Sans 11: 8*8/4 = 16 and (6*18+4)/8 = 14. The token said 14 x 13, whose
    // width is not what that formula gives for any rounding rule; a live
    // GerbView pane measures exactly 16 x 14.
    expect(SHELL).toMatch(/--swatch-small-w:\s*16px;/);
    expect(SHELL).toMatch(/--swatch-small-h:\s*14px;/);
    // The medium swatch shares the formula and is the check that the two are
    // not simply whatever numbers made one screenshot line up.
    expect(SHELL).toMatch(/--swatch-medium-w:\s*48px;/);
    expect(SHELL).toMatch(/--swatch-medium-h:\s*23px;/);
  });
});

describe('a wxNotebook sizes its tabs to their labels', () => {
  const body = ruleBody(SHELL, '.ze-ds-tabs button,\n.ze-nb-tabs button');

  it('does not stretch them to fill the strip', () => {
    // `flex: 1` split the strip evenly between Layers and Items and centred
    // each label, which read as two half-width buttons. Gtk lays tabs out from
    // the left at label width: asked directly, a real two-tab Yaru-dark
    // notebook allocates "Layers" at x=21 w=42 and "Items" at x=95 w=37.
    expect(body).toMatch(/flex:\s*0 0 auto/);
    expect(body).not.toMatch(/flex:\s*1/);
  });

  it('pads them with the token that existed for it', () => {
    // --tab-pad-x sat in the token block unused while this rule wrote 4px.
    // 12 is confirmed twice: the accent under the selected tab runs 66 px for a
    // 42 px label in an offscreen render of a real notebook, and 8..73 inside
    // the notebook on a live GerbView pane.
    expect(body).toMatch(/padding:\s*8px var\(--tab-pad-x\)/);
  });

  it('does not embolden the selected one', () => {
    // Asked of Gtk: the style context of the SELECTED tab's label reports
    // weight 400, the same as the unselected one. The 600 was ours.
    expect(ruleBody(SHELL, '.ze-ds-tabs button.active,\n.ze-nb-tabs button.active')).not.toMatch(
      /font-weight/,
    );
  });
});

describe('the shared checkbox takes the desktop accent, not a shade of our own', () => {
  it('accents with --chrome-active at --check-size', () => {
    // GTK paints one accent for every app. Ours wrote #e07b1a, a shade that is
    // in no Yaru stylesheet, and the Schematic Editor's dock then restated the
    // right value locally — the specificity trap: one launcher looked correct
    // while the rest drifted. A live GerbView confirms it from a second app:
    // its visibility checkboxes fill with rgb(233,84,32) and measure 16 across,
    // not the 13 a bare <input type=checkbox> takes from the user agent.
    //
    // `accent-color` was how this was done, and it got the FILL right — but the
    // browser then picks the tick colour itself, and for this accent Chrome
    // chooses BLACK where GTK strokes it white. So the control is drawn rather
    // than accented, and the accent moves to the checked background. The fill
    // is still --chrome-active and the size is still --check-size; what changed
    // is which property carries them.
    // [px] qa/probes/checkbox_probe.cpp renders the control through
    // wxRendererNative::DrawCheckBox — the same GTK draw LAYER_WIDGET's
    // wxCheckBox gets (`gerbview/widgets/layer_widget.cpp:347`): checked
    // rgb(233,84,32) with the stroke at rgb(255,252,252).
    const body = ruleBody(SHELL, '.ze-app input[type="checkbox"]');
    expect(body).toMatch(/appearance:\s*none/);
    expect(body).toMatch(/width:\s*var\(--check-size\)/);
    const checked = ruleBody(SHELL, '.ze-app input[type="checkbox"]:checked');
    expect(checked).toMatch(/background-color:\s*var\(--chrome-active\)/);
  });

  it('and no launcher restates it', () => {
    // Per-occurrence: this names every selector that brings the old shade back,
    // rather than reporting that the file contains it somewhere.
    const offenders = SHELL.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .filter((block) => /accent-color/.test(block))
      .map((block) => block.split('{')[0]!.trim().replace(/\s+/g, ' '))
      // `.ze-app select` is allowed and is the ONLY other one: a dropdown's
      // popup is painted by the browser, so the accent is the only way to
      // reach it. A checkbox and a radio are drawn here instead, for the
      // reason recorded beside them — the browser picks the tick's colour and
      // Chrome picks black where GTK strokes white — so an accent for THOSE
      // would re-open a measured decision, and this list still catches it.
      .filter((sel) => sel !== '.ze-app input[type="checkbox"]' && sel !== '.ze-app select');
    expect(
      offenders,
      'the accent is the theme\u2019s, so only the shared rule states it',
    ).toStrictEqual([]);
  });
});
