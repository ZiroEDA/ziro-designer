// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two boxes on GerbView's TOP_MAIN toolbar: the layer selector and the
 * `fmt:` info box beside it.
 *
 * A side-by-side of the two against a real GerbView, same window size, showed
 * three things at once:
 *
 *   1. the layer selector had no colour swatch before the name;
 *   2. the info box was #262626 inside #1e1e1e at radius 3 with 5 px of
 *      padding, where KiCad's is #272727 inside #181818 at radius 6 with 8;
 *   3. and (2) was not a GerbView bug at all — `.ze-tb-textinfo` named every
 *      one of the right tokens and lost all four to `.ze-app input`, a
 *      (0,1,1) rule that wrote panel chrome where an entry's values belong.
 *
 * (3) is the specificity trap from CLAUDE.md with the values the way round that
 * makes it hard to see: the SHARED rule was the drifted one, so the fix was not
 * to restate the tokens locally — it was to make the shared rule right and have
 * the local rule state nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SHELL = read('../../../designer/src/ui/shell.css');
const COMBO = read('../../../designer/src/ui/Combo.tsx');
const VIEWER = read('../../../designer/src/editors/gerbview/GerberViewer.tsx');

const ruleBody = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', at);
  return css.slice(at, end).replace(/\/\*[\s\S]*?\*\//g, '');
};

describe('a text field is a GTK entry, wherever it is', () => {
  const body = ruleBody(SHELL, '.ze-app select,\n.ze-app textarea');

  it('found the shared rule, so this cannot pass by scanning nothing', () => {
    expect(body).toMatch(/font:\s*inherit/);
  });

  /**
   * Each of these was measured on a live GerbView's info box and each already
   * had a token. Listed one property at a time rather than as one block match
   * so a regression names which value came back, not that "the rule changed".
   */
  const ENTRY: [string, RegExp][] = [
    ['fill', /background:\s*var\(--field-bg\)/],
    ['border colour', /border:\s*1px solid var\(--ctl-border\)/],
    ['corner radius', /border-radius:\s*var\(--ctl-radius\)/],
    ['horizontal padding', /padding:\s*2px var\(--field-pad-x\)/],
  ];
  for (const [what, re] of ENTRY) {
    it(`takes the entry's ${what} from its token`, () => {
      expect(body).toMatch(re);
    });
  }

  it('and none of the panel-chrome values it used to write', () => {
    // --chrome-bg2 is #262626 and --chrome-border #1e1e1e: inset-surface greys,
    // not what GTK paints an entry with. The 3px radius was neither.
    expect(body).not.toMatch(/--chrome-bg2|--chrome-border|border-radius:\s*3px/);
  });
});

describe('the fmt: box states nothing an entry already is', () => {
  const body = ruleBody(SHELL, '.ze-tb-textinfo');

  it('keeps only what is this control\u2019s, not the entry\u2019s', () => {
    // wx built it at wxDefaultSize and the probe reports 98 x 34, so the width
    // floor and the height ARE local. Everything else is the entry's.
    expect(body).toMatch(/width:\s*var\(--gbr-textinfo-width\)/);
    expect(body).toMatch(/height:\s*var\(--ctl-height\)/);
    expect(body).not.toMatch(/background|border|padding|font:/);
  });
});

describe('the layer selector carries a colour swatch per entry', () => {
  it('the shared Combo can draw one', () => {
    // `Append( name, wxBitmapBundle::FromBitmaps( bitmaps ), ... )`
    // (`gbr_layer_box_selector.cpp:105`). On the shared option because
    // PCB_LAYER_BOX_SELECTOR draws its entries the same way.
    expect(COMBO).toMatch(/swatch\?: string;/);
    expect(COMBO).toMatch(/ze-combo-swatch/);
  });

  it('and it is outside the ghost grid that sizes the box', () => {
    // .ze-combo-value stacks every entry in ONE grid cell to take the width of
    // the widest; a swatch put in there would stack with them and vanish under
    // the label. This asserts the swatch span comes BEFORE that element.
    const swatchAt = COMBO.indexOf('selected?.swatch !== undefined');
    const valueAt = COMBO.indexOf('className="ze-combo-value"');
    expect(swatchAt).toBeGreaterThanOrEqual(0);
    expect(swatchAt).toBeLessThan(valueAt);
  });

  it('is 14 px with a black outline, which is what DrawColorSwatch paints', () => {
    // `const int size = 14` (`gbr_layer_box_selector.cpp:80`) is [data], and
    // `bmpDC.SetPen( *wxBLACK_PEN )` (`layer_presentation.cpp:59`) is the
    // outline. Not the COLOR_SWATCH dialog-unit size — a different widget.
    const body = ruleBody(SHELL, '.ze-combo-swatch');
    expect(body).toMatch(/width:\s*14px/);
    expect(body).toMatch(/height:\s*14px/);
    expect(body).toMatch(/border:\s*1px solid #000/);
  });

  it('GerbView actually passes the layer colour to it', () => {
    // Without this the three above pass while the selector stays bare — the
    // shape of test that cannot fail, since the widget supporting a swatch is
    // not the widget showing one.
    // By ROW, not off the Layer: `GetLayerColor( GERBER_DRAW_LAYER( layer ) )`
    // (`gerbview/widgets/gerbview_layer_widget.cpp:307`). A colour frozen onto
    // the image would follow the file through a sort instead of staying on the
    // row it belongs to.
    expect(VIEWER).toMatch(/swatch: colorAt\(i\),/);
  });
});
