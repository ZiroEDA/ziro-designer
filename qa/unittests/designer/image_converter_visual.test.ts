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

/** The stylesheet with its comments taken out, so they cannot read as values. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of one rule, as a property -> value map. */
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
    expect(CSS).not.toContain('linear-gradient');
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
  it('puts the value above the track and the two ends below it', () => {
    expect(at('className="imgc-slider-val"')).toBeLessThan(at('type="range"'));
    expect(at('type="range"')).toBeLessThan(at('className="imgc-slider-ends"'));
    expect(TSX).toContain('<span>0</span>');
    expect(TSX).toContain('<span>100</span>');
  });

  it('centres the value on the thumb rather than parking it beside the track', () => {
    const val = rule('.imgc-slider-val');
    expect(val.position).toBe('absolute');
    expect(val.transform).toBe('translateX(-50%)');
    expect(val.left).toContain('var(--imgc-thumb-pos)');
    // The thumb centre only travels between half a thumb in from each end.
    expect(val.left).toContain('var(--imgc-thumb-frac)');
    expect(TSX).toContain("'--imgc-thumb-pos': `${threshold}%`");
    expect(TSX).toContain("'--imgc-thumb-frac': threshold / 100");
  });

  it('spreads 0 and 100 across the ends of the track', () => {
    const ends = rule('.imgc-slider-ends');
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

  it('keeps the status bar at a native fixed height', () => {
    expect(rule('.imgc-statusbar')['min-height']).toBe('24px');
  });

  it('draws flat notebook tabs with an accent underline on the selected one', () => {
    const tab = rule('.imgc-tab');
    expect(tab.background).toBe('transparent');
    expect(tab.border).toBe('none');
    expect(tab['border-bottom']).toBe('2px solid transparent');
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
