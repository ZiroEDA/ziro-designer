// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The colour picker's Defined Colors page, and the vertical wxSlider beside it.
 *
 * Both were shipped wrong from the same mistake: reading the C++ (and the wx
 * style-bit names) instead of running it.
 *
 * - `initDefinedColors` has two branches, and the one taken when the caller
 *   passes no CUSTOM_COLORS_LIST - every caller we have - is the one that
 *   builds the DEFAULT palette. Ours read it as "no list, no swatches" and the
 *   page came up blank in every launcher.
 * - `wxSL_LEFT` on a vertical slider does NOT put the labels on the left. A
 *   real wxSlider built with the colour picker's own bits reports
 *   `value-pos=RIGHT` and a range-label box to the RIGHT of the scale
 *   (qa/probes/slider_probe.cpp). Placed on the left, the value label landed
 *   under the thumb.
 *
 * The numbers asserted here are that probe's, not a screenshot's.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEGACY_COLOR_NAMES, colorRefs } from '@ziroeda/common/src/color4d.js';
import { DEFINED_COLORS_ROWS, definedColorGrid } from '@ziroeda/designer/src/ui/defined_colors.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SHELL = read('../../../designer/src/ui/shell.css');
const DIALOG = read('../../../designer/src/ui/DialogColorPicker.tsx');
const SLIDER = read('../../../designer/src/ui/Slider.tsx');

/** The declarations of one rule in shell.css, as a property -> value map. */
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

/** A :root token's value. */
function token(name: string): string {
  const at = SHELL.indexOf(':root {');
  const body = SHELL.slice(at, SHELL.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const m = body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  expect(m, `shell.css has no ${name}`).not.toBeNull();
  return (m as RegExpMatchArray)[1].trim();
}

const rgb255 = (c: { r: number; g: number; b: number }): [number, number, number] => [
  Math.round(c.r * 255),
  Math.round(c.g * 255),
  Math.round(c.b * 255),
];

describe('colorRefs(), the table the page is built from', () => {
  it('has all 35 rows', () => {
    // NBCOLORS - the enum runs BLACK..PUREORANGE (include/gal/color4d.h:42-79)
    // and s_ColorRefs is declared `[NBCOLORS]`, so a short table would leave
    // holes in the 7 x 5 matrix.
    expect(colorRefs()).toHaveLength(35);
    expect(Object.keys(LEGACY_COLOR_NAMES)).toHaveLength(35);
  });

  it('is in the TABLE’s row order, which is not the enum’s', () => {
    // s_ColorRefs (common/gal/color4d.cpp:44-51). The enum has LIGHTYELLOW
    // followed by DARKBLUE; the table slips LIGHTERORANGE between them, and the
    // matrix below is indexed into this order.
    expect(
      colorRefs()
        .slice(0, 8)
        .map((c) => c.label),
    ).toEqual(['Black', 'Gray 1', 'Gray 2', 'Gray 3', 'White', 'L.Yellow', 'L.Orange', 'Blue 1']);
  });

  it('reads StructColors blue-first, as the C++ initialisers are declared', () => {
    // `{ 0, 77, 128, DARKORANGE, TS( "Orange 1" ) }` is m_Blue, m_Green, m_Red -
    // so rgb(128, 77, 0), a brown-orange, NOT rgb(0, 77, 128), a blue.
    const byLabel = (l: string) => colorRefs().find((c) => c.label === l);
    expect(rgb255(byLabel('Orange 1')!.color)).toEqual([128, 77, 0]);
    // `{ 255, 0, 0, PUREBLUE, TS( "Blue 4" ) }` - blue 255, not red 255.
    expect(rgb255(byLabel('Blue 4')!.color)).toEqual([0, 0, 255]);
    // And the greys, where the swap is invisible, still have to be right.
    expect(rgb255(byLabel('Gray 1')!.color)).toEqual([72, 72, 72]);
  });

  it('names every colour, with no enumerator name leaking through', () => {
    // The labels are m_ColorName, not the EDA_COLOR_T spelling: the page reads
    // as four shades of each hue.
    for (const ref of colorRefs()) {
      expect(ref.label, ref.name).not.toBe(ref.name);
      expect(ref.label.length, ref.name).toBeGreaterThan(0);
    }
  });
});

describe('the 7 x 5 matrix initDefinedColors lays the swatches out in', () => {
  const grid = definedColorGrid();
  const labels = grid.map((c) => c.label);
  const row = (n: number) => labels.slice(n * 5, n * 5 + 5);

  it('uses upstream’s table_row_count of 7', () => {
    expect(DEFINED_COLORS_ROWS).toBe(7);
  });

  it('emits every colour exactly once', () => {
    // A transpose that drops or repeats an entry would still fill the grid.
    expect(grid).toHaveLength(35);
    expect(new Set(labels).size).toBe(35);
  });

  it('is a REORDERING, not the table walked straight through', () => {
    // ii = grid_row + grid_col * 7, so the second cell is table row 7, not 1.
    // Without this the first row would read Black, Gray 1, Gray 2, Gray 3,
    // White - which is what a grid filled in table order looks like.
    expect(labels[1]).not.toBe(colorRefs()[1]?.label);
    expect(labels[1]).toBe(colorRefs()[DEFINED_COLORS_ROWS]?.label);
  });

  it('lays out the rows the way the real page does', () => {
    // Read off a capture of KiCad 10.0.5's own Defined Colors page.
    expect(row(0)).toEqual(['Black', 'Blue 1', 'Blue 2', 'Blue 3', 'Blue 4']);
    expect(row(1)).toEqual(['Gray 1', 'Green 1', 'Green 2', 'Green 3', 'Green 4']);
    expect(row(4)).toEqual(['White', 'Magenta 1', 'Magenta 2', 'Magenta 3', 'Magenta 4']);
    expect(row(5)).toEqual(['L.Yellow', 'Brown 1', 'Brown 2', 'Yellow 3', 'Yellow 4']);
    expect(row(6)).toEqual(['L.Orange', 'Orange 1', 'Orange 2', 'Orange 3', 'Orange 4']);
  });
});

describe('the dialog draws that grid', () => {
  it('fills the page from the default palette rather than leaving it empty', () => {
    // The bug: `if( aPredefinedColors ) {...} else {...build the defaults...}`
    // read as "no list, no swatches".
    //
    // `toContain('definedColorGrid()')` was the first shape of this and it is
    // one of the four that cannot fail: `definedColorGrid().slice(0, 0).map(...)`
    // type-checks, renders the blank page again and passes it. qa has no DOM
    // environment, so the JSX can only be read as source - then read it
    // exactly, with nothing allowed between the grid and the map.
    expect(DIALOG).toContain('{definedColorGrid().map((ref) => (');
    // And one row per colour: no `slice`, no `filter`, no `take` anywhere in
    // the page's own block.
    const page = DIALOG.slice(DIALOG.indexOf('definedColorGrid()'));
    const block = page.slice(0, page.indexOf('))}'));
    for (const limiter of ['.slice(', '.filter(', '.splice(']) {
      expect(block, `the grid is narrowed by ${limiter}`).not.toContain(limiter);
    }
  });

  it('builds each swatch at SWATCH_SIZE_LARGE_DU, on the checkerboard', () => {
    // addSwatch calls the same COLOR_SWATCH::MakeBitmap the previews use, which
    // always lays a checkerboard down first and paints the colour over it at
    // its own alpha (dialog_color_picker.cpp:188-193).
    expect(DIALOG).toContain('className="ze-swatch unspecified large"');
  });

  it('takes the colour on a click and accepts on a double click', () => {
    // buttColorClick sets the colour; colorDClick posts wxID_OK
    // (dialog_color_picker.cpp:603-622). One without the other is half the
    // control.
    expect(DIALOG).toContain('onClick={() => applyRgb(ref.color)}');
    expect(DIALOG).toContain('onDoubleClick={() => onDone(ref.color)}');
  });

  it('gives the grid m_fgridColor’s ten columns and its two gaps', () => {
    const g = shellRule('.ze-cp-defined');
    expect(g.display).toBe('grid');
    // wxFlexGridSizer( 0, 10, 25, 5 ) with AddGrowableCol on the odd ones.
    expect(g['grid-template-columns']).toBe('repeat(5, auto 1fr)');
    expect(g['column-gap']).toBe('5px');
    expect(g['row-gap']).toBe('25px');
    expect(g['align-items']).toBe('center');
    // `m_SizerDefinedColors->Add( m_fgridColor, 1, wxALL|wxEXPAND, 10 )`.
    expect(g.padding).toBe('10px');
  });

  it('gives the name cell its wxRIGHT border of 15 and nothing else', () => {
    expect(shellRule('.ze-cp-defined > span')['margin-right']).toBe('15px');
  });

  it('sizes the large swatch from the dialog-unit conversion, unbordered', () => {
    // SWATCH_SIZE_LARGE_DU(24, 16): 24*8/4 x (16*18+4)/8 = 48 x 36, and a
    // capture of the real page reads exactly that.
    expect(token('--swatch-large-w')).toBe('48px');
    expect(token('--swatch-large-h')).toBe('36px');
    const s = shellRule('.ze-swatch.large');
    expect(s.width).toBe('var(--swatch-large-w)');
    expect(s.height).toBe('var(--swatch-large-h)');
    // A bare wxStaticBitmap, not the bordered COLOR_SWATCH panel.
    expect(s.border).toBe('none');
  });
});

describe('the vertical wxSlider, as the probe measured it', () => {
  it('reserves both label columns from the RANGE, not from a fixed width', () => {
    // GTK sizes each column to the widest string it can hold, which is the
    // longer of the two ends. A 0..255 slider gets three digits; a 0..100 one
    // gets three as well, and a 0..9 one would get one.
    expect(SLIDER).toContain('Math.max(String(min).length, String(max).length)');
    expect(SLIDER).toContain("'--slider-label-w': `${labelChars}ch`");
  });

  it('is a ROW - the scale, then the range labels beside it', () => {
    const v = shellRule('.ze-slider.vertical');
    expect(v['flex-direction']).toBe('row');
    // 12 + 4 + 12 + label + label = the 76 px the probe read off a real one.
    expect(v.width.replace(/\s+/g, ' ')).toBe(
      'calc( 2 * var(--slider-track-inset) + var(--slider-track-height) + 2 * var(--slider-label-w) )',
    );
  });

  it('puts the value text to the RIGHT of the trough, not the left', () => {
    // The whole bug: wxSL_LEFT reads as "labels on the left" and is not. On the
    // left the value label sat on top of the thumb.
    const val = shellRule('.ze-slider.vertical .ze-slider-val');
    expect(val.left).toContain('var(--slider-track-inset)');
    expect(val.left).toContain('var(--slider-track-height)');
    expect(val.right).toBeUndefined();
    expect(val['text-align']).toBe('left');
  });

  it('starts the thumb’s travel one scale-padding in from each end', () => {
    // The trough is inset 12 px along the track (`scale { padding: 12px }`), so
    // the value label following the thumb has to be inset by that too - without
    // it the label ran past the ends of the track it was meant to be beside.
    const val = shellRule('.ze-slider.vertical .ze-slider-val');
    // `toContain('var(--slider-track-inset)')` cannot fail: the token appears
    // again inside the travel term, so deleting the LEADING one - the whole
    // point of this assertion - left it passing. Read the expression whole.
    expect(val.top).toBe(
      'calc( var(--slider-track-inset) + var(--slider-thumb-size) / 2 + ' +
        '(1 - var(--slider-frac)) * ' +
        '(100% - 2 * var(--slider-track-inset) - var(--slider-thumb-size)) )',
    );
    expect(val.transform).toBe('translateY(-50%)');
  });

  it('gives the two range labels their own column further right still', () => {
    const ends = shellRule('.ze-slider.vertical .ze-slider-ends');
    // Past the scale AND past the value text: one label width beyond it.
    expect(ends.left).toContain('var(--slider-label-w)');
    expect(ends.width).toBe('var(--slider-label-w)');
    // The horizontal rule pins `right`; left un-set it would over-constrain.
    expect(ends.right).toBe('auto');
    // wxSL_INVERSE: the minimum is first in the DOM and belongs at the bottom.
    expect(ends['flex-direction']).toBe('column-reverse');
    expect(ends['justify-content']).toBe('space-between');
    // GtkLabels at their default xalign.
    expect(ends['align-items']).toBe('center');
  });

  it('makes the input one thumb wide, centred on where the trough goes', () => {
    const input = shellRule('.ze-app .ze-slider.vertical > input[type="range"]');
    expect(input.width).toBe('var(--slider-thumb-size)');
    // margin-left = inset + trough/2 - thumb/2 puts the trough centre at 14 px,
    // which is where the probe painted it.
    expect(input['margin-left']).toContain('var(--slider-track-inset)');
    expect(input['margin-left']).toContain('var(--slider-thumb-size) / 2');
    expect(input['margin-top']).toBe('var(--slider-track-inset)');
    expect(input['margin-bottom']).toBe('var(--slider-track-inset)');
  });

  it('still paints the trough and thumb at the sizes GTK reports', () => {
    // slider_probe: the slider node is min 20 x 20 with -9 margins all round,
    // so the trough is 2 px of box - and the rendered run is 4 px, which is the
    // number that has to be here.
    expect(token('--slider-track-height')).toBe('4px');
    expect(token('--slider-thumb-size')).toBe('20px');
    expect(token('--slider-track-bg')).toBe('#4b4b4b');
    // `scale { padding: 12px }`, the same inset in both axes.
    expect(token('--slider-track-inset')).toBe('12px');
  });
});
