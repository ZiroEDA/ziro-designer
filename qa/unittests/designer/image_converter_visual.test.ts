// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Image Converter's window has to LOOK like bitmap2component's.
 *
 * The one that matters is the preview. `BITMAP2CMP_PANEL_BASE` gives every
 * notebook page a `wxScrolledWindow` (bitmap2cmp_panel_base.cpp:21,24,27) whose
 * virtual size is the image's own width and height
 * (bitmap2cmp_panel.cpp:231-233), and each `OnPaint*` `DrawBitmap()`s at
 * (0, 0). The preview is never scaled: the user scrolls. Capping the canvas at
 * the pane instead resamples a 1-bit bitmap, which greys out single-pixel
 * strokes and drops thin ones, and the conversion reads as broken when the
 * traced geometry is in fact exact.
 *
 * jsdom does no layout and this repo has no DOM test environment, so the
 * layout half of this reads the source the way `search_panel_fits` does, with
 * the declarations pulled out of the rule block rather than matched loosely.
 * `bitmapDepth` is a real behavioural test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bitmapDepth } from '@ziroeda/designer/src/editors/image/imageMeta.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CSS = read('../../../designer/src/editors/image/imageConverter.css');
const TSX = read('../../../designer/src/editors/image/ImageConverter.tsx');
const SHELL = read('../../../designer/src/ui/shell.css');

/** The shared GTK control-theme tokens, as a name -> value map. */
const TOKENS: Record<string, string> = (() => {
  const at = SHELL.indexOf(':root {');
  expect(at, 'shell.css has no :root block').toBeGreaterThanOrEqual(0);
  const body = SHELL.slice(at, SHELL.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
})();

/** The stylesheet with its comments taken out, so they cannot read as values. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of one rule, as a property -> value map. */
/** The same, against the shared stylesheet — for what `ui/` owns, not this panel. */
function shellRule(selector: string): Record<string, string> {
  const code = SHELL.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = code.indexOf(`\n${selector} {`);
  expect(at, `shell.css has no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = code.slice(at + selector.length + 4, code.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    out[decl.slice(0, i).trim()] = decl
      .slice(i + 1)
      .trim()
      .replace(/\s+/g, ' ');
  }
  return out;
}

function rule(selector: string): Record<string, string> {
  const at = CSS_CODE.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = CSS_CODE.slice(at + selector.length + 4, CSS_CODE.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    out[decl.slice(0, i).trim()] = decl
      .slice(i + 1)
      .trim()
      .replace(/\s+/g, ' ');
  }
  return out;
}

/** Where a snippet sits in the JSX, so element order can be asserted. */
const at = (needle: string): number => {
  const i = TSX.indexOf(needle);
  expect(i, `not in ImageConverter.tsx: ${needle}`).toBeGreaterThanOrEqual(0);
  return i;
};

describe('D8: the preview is drawn 1:1 and scrolls', () => {
  it('never scales the canvas down to fit its pane', () => {
    const canvas = rule('.imgc-canvas');
    expect(canvas['max-width']).toBeUndefined();
    expect(canvas['max-height']).toBeUndefined();
    expect(canvas.width).toBeUndefined();
    expect(canvas.height).toBeUndefined();
    expect(canvas.transform).toBeUndefined();
    // A canvas is inline by default and would sit on a text baseline.
    expect(canvas.display).toBe('block');
  });

  it('scrolls the pane instead, from the top-left corner', () => {
    const view = rule('.imgc-view');
    expect(view.overflow).toBe('auto');
    // `place-items: center` would centre a smaller-than-pane image; wx draws
    // it at (0, 0).
    expect(view['place-items']).toBeUndefined();
    expect(view['align-items']).toBeUndefined();
    expect(view['justify-content']).toBeUndefined();
  });

  it('sizes the canvas from the bitmap, not from anything on screen', () => {
    // paintPage(): the wxEVT_PAINT handlers' DrawBitmap( bmp, 0, 0 ).
    expect(TSX).toContain('cv.width = data.width;');
    expect(TSX).toContain('cv.height = data.height;');
    expect(TSX).toContain('putImageData(data, 0, 0)');
  });

  it('keeps all three pages mounted so each holds its own scroll offset', () => {
    // AddPage() keeps three live wxScrolledWindows and three live bitmaps;
    // unmounting the inactive ones, or display:none, would drop their scroll
    // position on the next tab switch.
    for (const ref of ['originalCanvasRef', 'greyscaleCanvasRef', 'bwCanvasRef']) {
      expect(TSX).toContain(`ref={${ref}}`);
    }
    const pages = rule('.imgc-view');
    expect(pages.visibility).toBe('hidden');
    expect(pages.display).toBeUndefined();
    expect(rule('.imgc-view.active').visibility).toBe('visible');
    // Stacked in one grid cell so all three occupy the notebook body.
    expect(pages['grid-area']).toBe('1 / 1');
    expect(rule('.imgc-pages').display).toBe('grid');
  });

  it('rebuilds only the black & white page when the threshold moves', () => {
    // OnThresholdChange re-binarizes; it does not touch the other two bitmaps.
    const bwEffect = /useEffect\(\(\) => \{\s*paintPage\(bwCanvasRef[^}]*\}, \[([^\]]*)\]\)/.exec(
      TSX,
    );
    expect(bwEffect?.[1]).toBe('mono');
  });
});

describe('D6: the preview pages are flat', () => {
  it('has no checkerboard behind the bitmap', () => {
    const view = rule('.imgc-view');
    expect(view['background-image']).toBeUndefined();
    expect(view.background).toBe('var(--panel-bg)');
    // NO gradient at all in this file now. The one that used to be here was the
    // slider's accent fill, and the slider moved to shell.css when it stopped
    // being this launcher's private copy - so a gradient reappearing here means
    // a checkerboard or a fade, which is what the assertion is watching for.
    expect(CSS_CODE.match(/linear-gradient/g)?.length ?? 0).toBe(0);
    expect(rule('.imgc-pages')['background-image']).toBeUndefined();
  });
});

describe('D1: the column packs to the bottom', () => {
  it('puts the stretch spacer between Load Source Image and Output Size', () => {
    // bitmap2cmp_panel_base.cpp:79, Add( 0, 0, 1, wxEXPAND ).
    expect(at('Load Source Image')).toBeLessThan(at('className="imgc-spacer"'));
    expect(at('className="imgc-spacer"')).toBeLessThan(at('<legend>Output Size</legend>'));
    expect(rule('.imgc-spacer').flex).toBe('1 1 0');
  });

  it('lets the Output Format box take the other half of the slack', () => {
    // brightSizer->Add( sbOutputFormat, 1, ... ) is proportion 1 as well.
    expect(TSX).toContain('className="imgc-group imgc-format"');
    expect(rule('.imgc-group.imgc-format')['flex-grow']).toBe('1');
    // The groups above it must not absorb it instead.
    expect(rule('.imgc-group')['flex-grow']).toBeUndefined();
    expect(rule('.imgc-group')['flex-shrink']).toBe('0');
  });
});

describe('B2: the threshold slider carries wxSL_LABELS', () => {
  // The control itself is the SHARED wxSlider (designer/src/ui/Slider.tsx, and
  // the `.ze-slider` rules in shell.css). It used to be a block scoped to
  // `.imgc-frame` in this panel's own stylesheet, which is a per-launcher copy
  // of a control wx has exactly one of - and the colour picker proved the cost
  // by asking for the same slider and getting a bare range input. So these
  // assertions follow it to the shared files; what stays here is that this
  // panel asks for the label bit at all, and the range it asks for.
  it('asks the shared slider for wxSL_LABELS, 0 to 100', () => {
    expect(TSX).toContain('<Slider');
    const s = TSX.slice(at('<Slider'), TSX.indexOf('/>', at('<Slider')));
    expect(s).toContain('labels');
    expect(s).toContain('min={0}');
    expect(s).toContain('max={100}');
  });

  it('puts the value above the track and the two ends below it', () => {
    // Comments blanked, or the doc comment's own mention of a bare
    // `<input type="range">` is found before the element and the order reads
    // backwards.
    const SLIDER = read('../../../designer/src/ui/Slider.tsx')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const sAt = (needle: string): number => {
      const i = SLIDER.indexOf(needle);
      expect(i, `not in Slider.tsx: ${needle}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(sAt('className="ze-slider-val"')).toBeLessThan(sAt('type="range"'));
    expect(sAt('type="range"')).toBeLessThan(sAt('className="ze-slider-ends"'));
    // Both ends are printed, and from the range rather than written down.
    expect(SLIDER).toContain('<span>{min}</span>');
    expect(SLIDER).toContain('<span>{max}</span>');
  });

  it('centres the value on the thumb rather than parking it beside the track', () => {
    const val = shellRule('.ze-slider-val');
    expect(val.position).toBe('absolute');
    expect(val.transform).toBe('translateX(-50%)');
    // The thumb centre travels only over the trough, which is itself inset from
    // the slider's box, and only between half a thumb in from each of its ends.
    for (const term of [
      'var(--wx-border)',
      'var(--slider-track-inset)',
      'var(--slider-thumb-size)',
      'var(--slider-frac)',
    ]) {
      expect(val.left).toContain(term);
    }
    // The fraction is computed from the value and the RANGE, not from a 100
    // this one caller happens to use.
    expect(read('../../../designer/src/ui/Slider.tsx')).toContain(
      'const frac = max > min ? (value - min) / (max - min) : 0;',
    );
  });

  it('spreads 0 and 100 across the ends of the track', () => {
    const ends = shellRule('.ze-slider-ends');
    expect(ends['justify-content']).toBe('space-between');
    expect(ends.bottom).toBe('0');
  });
});

describe('D2/D3: the Image Information grid', () => {
  it('puts "bits" in column 3, with the spacer cell trailing it', () => {
    // Three cells then fgSizerInfo->Add( 0, 0, ... ).
    const bpp = TSX.slice(at('>BPP:<'), at('>BPP:<') + 400);
    expect(bpp).toMatch(
      /className="v">\{loaded \? loaded\.bpp[^}]*\}<\/span>\s*<span className="u">bits<\/span>\s*<span \/>/,
    );
  });

  it('left-aligns the values, as a wxFlexGridSizer cell is', () => {
    expect(rule('.imgc-info .v')['text-align']).toBe('left');
  });
});

describe('D4/D5/D7/C2: the rest of the chrome', () => {
  it('gives both export buttons the same plain styling', () => {
    const exportBtn = TSX.slice(at('onClick={exportToFile}') - 200, at('onClick={exportToFile}'));
    expect(exportBtn).toContain('className="imgc-btn block"');
    expect(exportBtn).not.toContain('primary');
  });

  it('takes the shared status bar, at its own measured height', () => {
    // The widget is shared - BM2CMP_FRAME gets the same panes, colours and
    // font as everything else, so .imgc-statusbar is gone and the frame
    // renders the shared KiStatusBar (.ze-statusbar, ui/shell.css).
    expect(TSX).toContain('<KiStatusBar>');
    expect(CSS_CODE).not.toMatch(/\n\.imgc-statusbar\s*\{/);

    // The HEIGHT is not shared, and this is the one frame that proves it.
    // BITMAP2CMP_FRAME calls plain CreateStatusBar( 1, wxSTB_SIZEGRIP )
    // (bitmap2cmp_frame.cpp:181) and never overrides OnCreateStatusBar, so it
    // gets a plain wxStatusBar rather than a KISTATUSBAR. Measured off a real
    // window at 1920x1200, x=600: bar (44,44,44) y=1167..1199 -> 33px, against
    // the project manager's 23. The 24px this file used to assert was neither.
    expect(rule('.imgc-frame')['--statusbar-height']).toBe('33px');

    // A native status bar never shrinks, and the frame is a flex column.
    expect(rule('.imgc-frame > .ze-statusbar').flex).toBe('none');
  });

  it('draws flat notebook tabs with an accent underline on the selected one', () => {
    const tab = rule('.imgc-tab');
    expect(tab.background).toBe('transparent');
    expect(tab.border).toBe('none');
    expect(tab['border-bottom']).toBe('var(--tab-underline) solid transparent');
    expect(tab['border-radius']).toBe('0');
    const active = rule('.imgc-tab.active');
    expect(active['border-bottom-color']).toBe('var(--chrome-active)');
    expect(active.background).toBeUndefined();
  });

  it('separates the file name from the frame name with a spaced em dash', () => {
    // BITMAP2CMP_FRAME::UpdateTitle, bitmap2cmp_frame.cpp:352-365.
    expect(TSX).toContain('`${loaded.fullName} \\u2014 Image Converter`');
    expect(TSX).not.toContain('fullName}, Image Converter');
  });
});

describe('D9: BPP is wxBitmap::GetDepth(), not the canvas buffer depth', () => {
  const rgba = (alphas: number[]): Uint8ClampedArray => {
    const px = new Uint8ClampedArray(alphas.length * 4);
    alphas.forEach((a, i) => {
      px[i * 4] = 10;
      px[i * 4 + 1] = 20;
      px[i * 4 + 2] = 30;
      px[i * 4 + 3] = a;
    });
    return px;
  };

  // Each expectation below was read off the installed wxGTK 3.2, the library
  // KiCad 10.0.5 links: wx.Bitmap(wx.Image(f)).GetDepth() for the file.
  it('calls a fully opaque image 24-bit even when its file is RGBA', () => {
    expect(bitmapDepth(rgba([255, 255, 255, 255]))).toBe(24);
  });

  it('calls an image with a fully transparent pixel 32-bit', () => {
    expect(bitmapDepth(rgba([255, 255, 0, 255]))).toBe(32);
  });

  it('calls an image with a partly transparent pixel 32-bit', () => {
    expect(bitmapDepth(rgba([255, 128, 255, 255]))).toBe(32);
  });

  it('reads the whole buffer, not just the first pixel', () => {
    expect(bitmapDepth(rgba([...Array(999).fill(255), 254]))).toBe(32);
  });

  it('is what the panel actually shows', () => {
    expect(TSX).toContain('bpp: bitmapDepth(original.data),');
  });
});

/**
 * Measured metrics.
 *
 * Two ground truths behind every number here. [css] is the Yaru-dark stylesheet
 * wxWidgets draws KiCad's controls from, extracted with
 *   gresource extract /usr/share/themes/Yaru-dark/gtk-3.0/gtk.gresource \
 *     /com/ubuntu/themes/Yaru-dark/3.0/gtk-dark.css
 * [px] is a pixel sampled off a live, focused bitmap2component window at
 * 1920x1200, Xft.dpi 96, gtk-font-name Cantarell 11.
 *
 * A test file cannot see a rendered glyph or a sampled colour, so what it pins
 * is the declaration: that the value we measured is the value in the stylesheet,
 * and - the point of the exercise - that the Image Converter reads it from the
 * shared token layer instead of restating it. The rendering itself was checked
 * by screenshotting the page over CDP and re-running the same pixel profiles
 * that measured KiCad; that evidence is the before/after table in the PR.
 */
describe('the shared GTK control-theme tokens hold the measured values', () => {
  it('carries the font wxSYS_DEFAULT_GUI_FONT resolves to', () => {
    // 11pt at 96 dpi = 14.667 px, the size Cantarell 11 renders at.
    expect(TOKENS['--ui-font-size']).toBe('11pt');
    // [px] The Image Information rows repeat every 23 px and each cell carries a
    // 5 px wxFormBuilder border, so one GtkLabel is 18 px tall.
    expect(TOKENS['--ui-line-height']).toBe('18px');
  });

  it('carries the one border colour every framed GTK control uses', () => {
    // [css] frame > border, button, entry, check, radio all take #181818.
    expect(TOKENS['--ctl-border']).toBe('#181818');
  });

  it('makes a button, a text field and a combo the same height', () => {
    // [css] button { min-height: 24px; padding: 4px 9px; border: 1px } and
    // entry { min-height: 32px; border: 1px } are both 34. [px] agrees.
    expect(TOKENS['--ctl-height']).toBe('34px');
    expect(TOKENS['--ctl-radius']).toBe('6px');
    expect(TOKENS['--ctl-face']).toBe('#373737');
    expect(TOKENS['--ctl-face-disabled']).toBe('#2a2a2a');
    expect(TOKENS['--ctl-fg-disabled']).toBe('#929292');
    // Asked of wx itself, not sampled: #272727 from GetBackgroundColour(),
    // from the GtkEntry's style context, and from a rendered pixel of the
    // drawn control. Was #282828 on the belief that wx renders a level lighter
    // than the toolkit; measured false 2026-08-21.
    expect(TOKENS['--field-bg']).toBe('#272727');
    expect(TOKENS['--field-pad-x']).toBe('8px');
  });

  it('sizes a checkbox and a radio the way GTK does', () => {
    // [css] check, radio { min-height: 14px; min-width: 14px; border: 1px }.
    expect(TOKENS['--check-size']).toBe('16px');
    expect(TOKENS['--check-margin']).toBe('4px');
    // [px] the Output Format radios repeat every 34 px against 5 + 5 of wx
    // border and a 2 px flexgrid vgap, so the control itself is 22.
    expect(TOKENS['--check-row']).toBe('22px');
  });

  it('sizes the slider from the scale the real window draws', () => {
    // [px] a 4 px flat track, a 20 px circle, the trough inset 12 px at each end
    // ([css] scale { padding: 12px }, scale slider { min-height: 18px }).
    expect(TOKENS['--slider-track-height']).toBe('4px');
    expect(TOKENS['--slider-track-bg']).toBe('#4b4b4b');
    expect(TOKENS['--slider-thumb-size']).toBe('20px');
    expect(TOKENS['--slider-thumb-bg']).toBe('#fcfcfc');
    expect(TOKENS['--slider-track-inset']).toBe('12px');
  });

  it('carries the notebook tab strip and the wxFormBuilder border', () => {
    expect(TOKENS['--tab-strip-height']).toBe('36px');
    // [css] notebook > header.top > tabs > tab:checked { box-shadow: inset 0 -3px }.
    expect(TOKENS['--tab-underline']).toBe('3px');
    expect(TOKENS['--tab-pad-x']).toBe('12px');
    // Every sizer item in every KiCad dialog is added with wxALL, 5.
    expect(TOKENS['--wx-border']).toBe('5px');
  });
});

describe('the Image Converter reads its metrics from the tokens', () => {
  it('states no colour of its own', () => {
    // A hex literal here is a value that has escaped the theme layer and will
    // drift away from every other editor, which is how we got here.
    const stripped = CSS_CODE.replace(/#[0-9a-f]{3,8}\b/gi, (m) =>
      // The check mark and the radio dot are drawn in the indicator's
      // foreground, which GTK paints white on the accent.
      m.toLowerCase() === '#ffffff' ? '' : m,
    );
    expect(stripped).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('states no font size of its own', () => {
    expect(rule('.imgc-frame')['font-size']).toBe('var(--ui-font-size)');
    expect(rule('.imgc-frame')['line-height']).toBe('var(--ui-line-height)');
    expect(rule('.imgc-frame')['font-family']).toBe('var(--ui-font-family)');
    expect(CSS_CODE).not.toMatch(/font-size:\s*\d/);
  });

  it('paints the column and the tab strip the window colour, not the inset one', () => {
    // [px] KiCad paints the menu bar, the tab strip, the right column and the
    // status bar all #2c2c2c; only the notebook pages are darker.
    expect(rule('.imgc-side').background).toBe('var(--chrome-bg)');
    expect(rule('.imgc-tabs').background).toBe('var(--chrome-bg)');
    expect(rule('.imgc-view').background).toBe('var(--panel-bg)');
  });

  it('gives the fields, the combos and the buttons the token height', () => {
    const field = rule('.imgc-frame .imgc-input');
    expect(field.height).toBe('var(--ctl-height)');
    expect(field.background).toBe('var(--field-bg)');
    expect(field.border).toBe('1px solid var(--ctl-border)');
    expect(field['border-radius']).toBe('var(--ctl-radius)');
    expect(field.padding).toBe('0 var(--field-pad-x)');
    const btn = rule('.imgc-frame .imgc-btn');
    expect(btn.height).toBe('var(--ctl-height)');
    expect(btn.background).toBe('var(--ctl-face)');
    expect(btn['border-radius']).toBe('var(--ctl-radius)');
  });

  it('greys a disabled control by colour, never by fading it', () => {
    // GTK has no opacity in any :disabled rule; it swaps the colour. Fading
    // washes out the control's own background and border with it.
    //
    // The combo's disabled treatment is the SHARED widget's, not this panel's.
    // This file restated it once, and because `.imgc-frame .imgc-select` is
    // (0,2,0) against `.ze-combo`'s (0,1,0), every local restatement silently
    // outranked the shared rule — which is how the Layer combo went on painting
    // the entry interior after the widget itself had been fixed.
    const comboOff = shellRule('.ze-combo:disabled');
    expect(comboOff.color).toBe('var(--ctl-fg-disabled)');
    expect(comboOff.background).toBe('var(--ctl-face-disabled)');
    expect(CSS_CODE).not.toMatch(/\.imgc-select:disabled/);
    expect(rule('.imgc-frame .imgc-btn:disabled').background).toBe('var(--ctl-face-disabled)');
    expect(rule('.imgc-frame .imgc-btn:disabled').color).toBe('var(--ctl-fg-disabled)');
    expect(CSS_CODE).not.toMatch(/opacity:\s*0/);
  });

  it('gives the check and radio indicators the token size', () => {
    const box = rule('.imgc-frame .imgc-radio input');
    expect(box.width).toBe('var(--check-size)');
    expect(box.height).toBe('var(--check-size)');
    expect(box.margin).toBe('0 var(--check-margin)');
    expect(box.background).toBe('var(--check-face)');
    expect(rule('.imgc-radio').height).toBe('var(--check-row)');
  });

  it('builds the slider out of the token track and thumb', () => {
    const thumb = shellRule('.ze-app .ze-slider > input[type="range"]::-webkit-slider-thumb');
    expect(thumb.width).toBe('var(--slider-thumb-size)');
    expect(thumb.background).toBe('var(--slider-thumb-bg)');
    const track = shellRule(
      '.ze-app .ze-slider > input[type="range"]::-webkit-slider-runnable-track',
    );
    expect(track.height).toBe('var(--slider-track-height)');
    expect(track.background).toContain('var(--slider-track-bg)');
    expect(track.background).toContain('var(--chrome-active)');
    // scale { padding: 12px }: the trough stops short of the widget's ends.
    const range = shellRule('.ze-app .ze-slider > input[type="range"]');
    expect(range.width).toBe('calc(100% - 2 * var(--slider-track-inset))');
    expect(range.margin).toBe('0 var(--slider-track-inset)');
  });

  it('sizes the tab strip and its accent bar from the tokens', () => {
    expect(rule('.imgc-tabs').height).toBe('var(--tab-strip-height)');
    expect(rule('.imgc-tab').padding).toBe('0 var(--tab-pad-x)');
    // The bar has to sit ON the strip's border row; one pixel lower and the
    // notebook page paints over it and the selected tab carries no mark at all.
    expect(rule('.imgc-tab')['margin-bottom']).toBe('-1px');
  });
});

describe('the arrangement bitmap2cmp_panel_base gives this panel alone', () => {
  it('is 277 px wide with 257 px group boxes inside it', () => {
    // bMainSizer->Add( brightSizer, 0, wxEXPAND|wxALL, 5 ) and then wxALL 5 on
    // every item inside it: 10 px in from the edge, 10 px between two items.
    const side = rule('.imgc-side');
    expect(side.width).toBe('277px');
    expect(side.padding).toBe('calc(2 * var(--wx-border))');
    expect(side.gap).toBe('calc(2 * var(--wx-border))');
  });

  it('draws a square GTK frame with a plain-weight label', () => {
    const group = rule('.imgc-group');
    expect(group.border).toBe('1px solid var(--ctl-border)');
    expect(group['border-radius']).toBe('0');
    // The frame has no padding: each child brings its own wx border instead,
    // and they differ per child, which is what puts every row where KiCad has it.
    expect(group.padding).toBe('0');
    expect(rule('.imgc-group legend')['font-weight']).toBe('normal');
  });

  it('insets the notebook 10 px from the left and bottom edges', () => {
    // bitmap2cmp_panel_base.cpp:30, Add( m_Notebook, 1, wxEXPAND|wxBOTTOM|wxLEFT, 10 ).
    expect(rule('.imgc-notebook').margin).toBe('0 0 10px 10px');
    expect(rule('.imgc-notebook').border).toBe('1px solid var(--ctl-border)');
  });

  it('gives the Size fields their SetMinSize widths and lets neither grow', () => {
    // bitmap2cmp_panel_base.cpp:112,118,126 - 60, 60 and 80, all at sizer
    // proportion 0, so the row packs left and the slack stays on the right.
    expect(rule('.imgc-sizerow .imgc-input').width).toBe('60px');
    expect(rule('.imgc-sizerow .imgc-select').width).toBe('80px');
    expect(rule('.imgc-frame .imgc-select').flex).toBe('none');
    // m_layerCtrl is the one control here at proportion 1.
    expect(rule('.imgc-frame .imgc-select.grow').flex).toBe('1');
  });

  it('indents the Layer label 28 px, and greys it with its combo', () => {
    // bitmap2cmp_panel_base.cpp:177, Add( m_layerLabel, 0, ...|wxLEFT, 28 ).
    expect(rule('.imgc-layerrow')['padding-left']).toBe('28px');
    // bitmap2cmp_panel.cpp:571, m_layerLabel->Enable( m_rbFootprint->GetValue() ).
    expect(rule('.imgc-layerrow.disabled .lbl').color).toBe('var(--ctl-fg-disabled)');
    expect(TSX).toContain("`imgc-layerrow${footprint ? '' : ' disabled'}`");
  });

  it('spaces the Output Format rows by the flexgrid vgap plus each wx border', () => {
    // wxFlexGridSizer( 5, 1, 2, 0 ), then wxBOTTOM / wxTOP / none / both / wxTOP
    // (bitmap2cmp_panel_base.cpp:161-193). The five rows must be siblings for
    // the positional rules to reach them.
    expect(rule('.imgc-formats').gap).toBe('2px');
    expect(rule('.imgc-formats > :nth-child(1)')['margin-bottom']).toBe('var(--wx-border)');
    expect(rule('.imgc-formats > :nth-child(2)')['margin-top']).toBe('var(--wx-border)');
    expect(rule('.imgc-formats > :nth-child(4)').margin).toBe('var(--wx-border) 0');
    expect(rule('.imgc-formats > :nth-child(5)')['margin-top']).toBe('var(--wx-border)');
    expect(TSX).toContain('className="imgc-formats"');
  });

  it('puts Export to Clipboard 5 px under Export to File, not 10', () => {
    // It is the one item added wxBOTTOM|wxRIGHT|wxLEFT, with no wxTOP
    // (bitmap2cmp_panel_base.cpp:205).
    expect(rule('.imgc-btn.block + .imgc-btn.block')['margin-top']).toBe(
      'calc(-1 * var(--wx-border))',
    );
  });
});

describe('B4: the preview panes are blank before a file is loaded', () => {
  it('paints no placeholder over the three scrolled windows', () => {
    // bitmap2cmp_panel_base.cpp:21,24,27 build three empty wxScrolledWindows and
    // nothing draws into them until OnLoadFile; KiCad prints no prompt.
    expect(TSX).not.toContain('No image loaded');
    expect(TSX).not.toContain('imgc-drop');
    expect(CSS_CODE).not.toContain('.imgc-drop');
  });
});
