// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, expect, it } from 'vitest';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import {
  type Color4d,
  COLOR4D_BLACK,
  COLOR4D_WHITE,
  DO_NOT_SET_LINE_WIDTH,
  encodeStringForPlotter,
  FILL_T,
  formatG,
  getFillId,
  LINE_STYLE,
  PLOT_TEXT_MODE,
  POSTSCRIPT_TEXT_ASCENT,
  PS_MACRO_PROLOG,
  type PsFont,
  type PsImage,
  PsPlotter,
  type PsTextAttributes,
  psCreationDate,
  psPageInfo,
  psRenderSettings,
  USE_DEFAULT_LINE_WIDTH,
} from '@ziroeda/pcbnew/src/plot_ps.js';

/** A4 portrait and landscape in mils, as PAGE_INFO stores them for each orientation. */
const A4_PORTRAIT_MILS = { x: 8268, y: 11693 };
const A4_LANDSCAPE_MILS = { x: 11693, y: 8268 };

/**
 * Ten IU per decimil, so a device unit is a tenth of an IU and every expected
 * coordinate below can be read off by eye. pcbnew's real value is 2540.
 */
const IUS_PER_DECIMIL = 10;

/** A4 portrait's height in IU: the y every unmirrored device coordinate counts down from. */
const PAGE_TOP_IU = 11693 * 10 * IUS_PER_DECIMIL;

/** The same in device units, which is what actually reaches the file. */
const PAGE_TOP = PAGE_TOP_IU / IUS_PER_DECIMIL;

/** A fixed instant, so `%%CreationDate` is not a moving target. */
const WHEN = new Date(2026, 7, 5, 9, 3, 7);

interface PlotterOptions {
  portrait?: boolean;
  defaultPenWidth?: number;
  colorMode?: boolean;
  mirror?: boolean;
  type?: string;
  custom?: boolean;
}

/** A plotter opened, described and viewported, but not yet started. */
function makePlotter(aOptions: PlotterOptions = {}): PsPlotter {
  const portrait = aOptions.portrait ?? true;
  const plotter = new PsPlotter(
    psRenderSettings({ defaultPenWidth: aOptions.defaultPenWidth ?? 100 }),
  );

  plotter.OpenFile('/plots/board.ps');
  plotter.SetCreator('ZiroEDA (6.0)');
  plotter.SetTitle('board');
  plotter.SetPageSettings(
    psPageInfo({
      sizeMils: portrait ? A4_PORTRAIT_MILS : A4_LANDSCAPE_MILS,
      type: aOptions.type ?? 'A4',
      portrait,
      custom: aOptions.custom,
    }),
  );
  plotter.SetColorMode(aOptions.colorMode ?? true);
  plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, aOptions.mirror ?? false);

  return plotter;
}

/** A plotter whose emitted text so far is discarded: only the geometry that follows matters. */
function drawingPlotter(aOptions: PlotterOptions = {}): { plotter: PsPlotter; body: () => string } {
  const plotter = makePlotter(aOptions);

  plotter.StartPlot('1', WHEN);

  const prefix = plotter.text().length;

  return { plotter, body: () => plotter.text().slice(prefix) };
}

/** A font that yields one stroke per character, so the pen traffic is countable. */
const stubFont = (
  aStrokes: readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[],
): PsFont => ({
  Draw: () => aStrokes,
});

/** A wxImage of solid, distinguishable pixels. */
function makeImage(aOptions: {
  width: number;
  height: number;
  pixel: (x: number, y: number) => [number, number, number];
  alpha?: (x: number, y: number) => number;
  mask?: [number, number, number];
}): PsImage {
  return {
    GetWidth: () => aOptions.width,
    GetHeight: () => aOptions.height,
    GetRed: (x, y) => aOptions.pixel(x, y)[0],
    GetGreen: (x, y) => aOptions.pixel(x, y)[1],
    GetBlue: (x, y) => aOptions.pixel(x, y)[2],
    HasAlpha: () => aOptions.alpha !== undefined,
    GetAlpha: (x, y) => aOptions.alpha!(x, y),
    HasMask: () => aOptions.mask !== undefined,
    GetMaskRed: () => aOptions.mask![0],
    GetMaskGreen: () => aOptions.mask![1],
    GetMaskBlue: () => aOptions.mask![2],
  };
}

describe('PostScript number formatting', () => {
  it('writes six significant digits and strips the trailing zeros', () => {
    // If %g degenerated into toFixed or toPrecision the zeros would survive and
    // every coordinate in the file would grow.
    expect(formatG(0.5)).toBe('0.5');
    expect(formatG(100)).toBe('100');
    expect(formatG(2 / 3)).toBe('0.666667');
    expect(formatG(-0.0000125)).toBe('-1.25e-05');
  });

  it('switches to exponent form outside [-4, precision)', () => {
    // The 1000000 case is the boundary: six significant digits cannot hold a
    // seven-digit integer, so %g escapes to %e rather than padding.
    expect(formatG(999999)).toBe('999999');
    expect(formatG(1000000)).toBe('1e+06');
    expect(formatG(0.0001)).toBe('0.0001');
    expect(formatG(0.00001)).toBe('1e-05');
  });

  it('honours a narrower precision, which only setrgbcolor asks for', () => {
    // This is the whole point of parameterising formatG: the same double is a
    // different string in a colour than in a coordinate.
    expect(formatG(2 / 3, 3)).toBe('0.667');
    expect(formatG(2 / 3)).toBe('0.666667');
    expect(formatG(1234, 3)).toBe('1.23e+03');
  });
});

describe('encodeStringForPlotter', () => {
  it('escapes the three PostScript literal delimiters', () => {
    // An unescaped bracket ends the literal early and the rest of the file is
    // then read as operators.
    expect(encodeStringForPlotter('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
  });

  it('keeps Latin-1 as single bytes rather than escaping or expanding them', () => {
    const encoded = encodeStringForPlotter('Café');

    // The é must survive as one code unit of value 0xE9: that unit is written
    // to the file as one byte, and the prolog re-encodes the fonts to Latin-1
    // precisely so it renders.
    expect(encoded).toBe('(Café)');
    expect(encoded.charCodeAt(4)).toBe(0xe9);
  });

  it('drops every code point at or above 256 outright', () => {
    // Upstream's `if( ch < 256 )` has no else. A port that substituted a
    // replacement character, or that let the character through, would produce a
    // file KiCad never would.
    expect(encodeStringForPlotter('AΩB')).toBe('(AB)');
    expect(encodeStringForPlotter('A\u{1f600}B')).toBe('(AB)');
    expect(encodeStringForPlotter('ΩΩΩ')).toBe('()');
  });
});

describe('psCreationDate', () => {
  it('reproduces ctime, trailing newline included', () => {
    // The DSC comment that prints this supplies no newline of its own, so a
    // missing one here glues %%CreationDate to %%Title.
    expect(psCreationDate(WHEN)).toBe('Wed Aug  5 09:03:07 2026\n');
  });

  it('blank-pads the day of the month and zero-pads the time', () => {
    // ctime pads the day with a space and the clock with zeros. Getting this
    // uniform either way would shift every later column of the comment.
    expect(psCreationDate(new Date(2026, 0, 9, 1, 2, 3))).toBe('Fri Jan  9 01:02:03 2026\n');
    expect(psCreationDate(new Date(2026, 11, 25, 23, 59, 59))).toBe('Fri Dec 25 23:59:59 2026\n');
  });
});

describe('getFillId', () => {
  it('collapses everything that is not NO_FILL or FILLED_SHAPE onto 2', () => {
    // The macro id is concatenated straight onto the operator name, so a wrong
    // id names a macro the prolog may not define at all.
    expect(getFillId(FILL_T.NO_FILL)).toBe(0);
    expect(getFillId(FILL_T.FILLED_SHAPE)).toBe(1);
    expect(getFillId(FILL_T.HATCH)).toBe(2);
    expect(getFillId(FILL_T.FILLED_WITH_BG_BODYCOLOR)).toBe(2);
    expect(getFillId(FILL_T.CROSS_HATCH)).toBe(2);
  });
});

describe('StartPlot', () => {
  it('emits the DSC preamble, the prolog and the page setup, in that order', () => {
    const plotter = makePlotter();

    plotter.StartPlot('1', WHEN);

    // The whole preamble is asserted at once because the Document Structuring
    // Convention is positional: a comment out of order, or a missing one, makes
    // the file non-conforming for every downstream tool that reads it.
    expect(plotter.text()).toBe(
      '%!PS-Adobe-3.0\n' +
        '%%Creator: ZiroEDA (6.0)\n' +
        '%%CreationDate: Wed Aug  5 09:03:07 2026\n' +
        '%%Title: (board)\n' +
        '%%Pages: 1\n' +
        '%%PageOrder: Ascend\n' +
        '%%BoundingBox: 0 0 596 842\n' +
        '%%DocumentMedia: A4 595 842 0 () ()\n' +
        '%%Orientation: Portrait\n' +
        '%%EndComments\n' +
        PS_MACRO_PROLOG +
        '%%Page: (1) 1\n' +
        '%%BeginPageSetup\n' +
        'gsave\n' +
        '0.0072 0.0072 scale\n' +
        'linemode1\n' +
        '10 setlinewidth\n' +
        '%%EndPageSetup\n',
    );
  });

  it('rounds the bounding box up and the document media to nearest', () => {
    // 8268 mils is 595.296 big points. If both call sites shared a rounding the
    // two comments would agree — and upstream's deliberately do not, because a
    // bounding box has to enclose the media rather than match it.
    const preamble = (() => {
      const plotter = makePlotter();
      plotter.StartPlot('1', WHEN);
      return plotter.text();
    })();

    expect(preamble).toContain('%%BoundingBox: 0 0 596 842\n');
    expect(preamble).toContain('%%DocumentMedia: A4 595 842 0 () ()\n');
  });

  it('swaps a landscape page back to portrait and rototranslates instead', () => {
    const plotter = makePlotter({ portrait: false });

    plotter.StartPlot('1', WHEN);

    const text = plotter.text();

    // PAGE_INFO already holds 11693 x 8268 for a landscape A4. StartPlot puts
    // the *portrait* numbers in the comments and turns the page at draw time,
    // so a port that trusted GetSizeMils here would describe an 842 x 596 sheet
    // and then draw off it.
    expect(text).toContain('%%BoundingBox: 0 0 596 842\n');
    expect(text).toContain('%%DocumentMedia: A4 595 842 0 () ()\n');
    expect(text).toContain('%%Orientation: Landscape\n');
    expect(text).toContain('linemode1\n82680 0 translate 90 rotate\n');
  });

  it('does not rototranslate a portrait page', () => {
    const plotter = makePlotter({ portrait: true });

    plotter.StartPlot('1', WHEN);

    // The other half of the same asymmetry: emitting the rotation on a portrait
    // sheet would turn every plot on its side.
    expect(plotter.text()).not.toContain('translate 90 rotate');
    expect(plotter.text()).toContain('%%Orientation: Portrait\n');
  });

  it('renames a User sheet to Custom, and leaves every other name alone', () => {
    const custom = makePlotter({ type: 'User', custom: true });
    const named = makePlotter({ type: 'A3', custom: false });

    custom.StartPlot('1', WHEN);
    named.StartPlot('1', WHEN);

    // "User" is the enumerator name; the DSC wants "Custom". Both directions
    // are pinned because rewriting unconditionally would rename A3 as well.
    expect(custom.text()).toContain('%%DocumentMedia: Custom ');
    expect(named.text()).toContain('%%DocumentMedia: A3 ');
  });

  it('says one page however many pages the caller goes on to plot', () => {
    const plotter = makePlotter();

    plotter.StartPlot('7', WHEN);

    // %%Pages is a literal upstream while the %%Page comment carries the real
    // number. Deriving one from the other would be an improvement, not a port.
    expect(plotter.text()).toContain('%%Pages: 1\n');
    expect(plotter.text()).toContain('%%Page: (7) 1\n');
  });

  it('writes the fine scale only when one of the two axes is adjusted', () => {
    const both = makePlotter();
    const onlyY = makePlotter();
    const neither = makePlotter();

    both.SetScaleAdjust(1.001, 1.002);
    onlyY.SetScaleAdjust(1, 0.999);

    both.StartPlot('1', WHEN);
    onlyY.StartPlot('1', WHEN);
    neither.StartPlot('1', WHEN);

    // The test is an OR over the two axes; a port that used AND would drop the
    // correction whenever only one axis was calibrated.
    expect(both.text()).toContain('linemode1\n1.001 1.002 scale\n10 setlinewidth\n');
    expect(onlyY.text()).toContain('linemode1\n1 0.999 scale\n10 setlinewidth\n');
    expect(neither.text()).toContain('linemode1\n10 setlinewidth\n');
  });

  it('emits the default pen through the device transform', () => {
    // 100 IU at ten IU per decimil is ten device units. A raw 100 here would set
    // a pen a decade too wide for the whole page.
    const plotter = makePlotter({ defaultPenWidth: 250 });

    plotter.StartPlot('1', WHEN);

    expect(plotter.text()).toContain('25 setlinewidth\n%%EndPageSetup\n');
  });

  it('refuses to start before OpenFile', () => {
    const plotter = new PsPlotter(psRenderSettings());

    plotter.SetPageSettings(psPageInfo({ sizeMils: A4_PORTRAIT_MILS, type: 'A4', portrait: true }));

    // Upstream's wxASSERT( m_outputFile ) is compiled out of a release build and
    // then writes to a null FILE*. Throwing is the honest analogue.
    expect(() => plotter.StartPlot('1', WHEN)).toThrow(/before OpenFile/);
  });

  it('refuses to plot without a page description', () => {
    const plotter = new PsPlotter(psRenderSettings());

    plotter.OpenFile('/plots/board.ps');

    // PLOTTER's m_pageInfo is a default-constructed A3; reproducing that would
    // mean embedding page_info.cpp's size table, so an unset page is an error.
    expect(() => plotter.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false)).toThrow(
      /no page settings/,
    );
  });
});

describe('the two string encodings in one file', () => {
  it('writes the creator as UTF-8 and the title as Latin-1', () => {
    const plotter = makePlotter();

    plotter.SetCreator('Café');
    plotter.SetTitle('Café');
    plotter.StartPlot('1', WHEN);

    const bytes = plotter.bytes();
    const creatorAt = plotter.text().indexOf('%%Creator: ') + '%%Creator: '.length;
    const titleAt = plotter.text().indexOf('%%Title: (') + '%%Title: ('.length;

    // TO_UTF8 gives the creator two bytes for the é; encodeStringForPlotter
    // gives the title one. Both are checked because a single-encoding port
    // passes whichever half it chose and silently corrupts the other.
    expect([...bytes.slice(creatorAt, creatorAt + 5)]).toEqual([0x43, 0x61, 0x66, 0xc3, 0xa9]);
    expect([...bytes.slice(titleAt, titleAt + 4)]).toEqual([0x43, 0x61, 0x66, 0xe9]);
  });

  it('drops an untranslatable title character without disturbing the brackets', () => {
    const plotter = makePlotter();

    plotter.SetTitle('ΩboardΩ');
    plotter.StartPlot('1', WHEN);

    // The literal must still open and close; a port that emitted a placeholder
    // byte would put a non-Latin-1 byte in a comment that claims to be one.
    expect(plotter.text()).toContain('%%Title: (board)\n');
  });

  it('escapes a page number that contains a bracket', () => {
    const plotter = makePlotter();

    plotter.StartPlot('A(1)', WHEN);

    // The page number is caller data and goes through the same encoder as the
    // title; leaving it raw would close the %%Page literal early.
    expect(plotter.text()).toContain('%%Page: (A\\(1\\)) 1\n');
  });
});

describe('SetCurrentLineWidth', () => {
  it('writes setlinewidth only when the width actually changes', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetCurrentLineWidth(200);
    plotter.SetCurrentLineWidth(200);
    plotter.SetCurrentLineWidth(300);

    // The change test is what keeps the file from repeating a pen for every
    // segment of a track.
    expect(body()).toBe('20 setlinewidth\n30 setlinewidth\n');
  });

  it('leaves the pen entirely alone for DO_NOT_SET_LINE_WIDTH', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetCurrentLineWidth(200);
    plotter.SetCurrentLineWidth(DO_NOT_SET_LINE_WIDTH);

    // The sentinel returns before the member is assigned, which is what lets a
    // caller configure the pen once and then draw with it.
    expect(body()).toBe('20 setlinewidth\n');
    expect(plotter.GetCurrentLineWidth()).toBe(200);
  });

  it('promotes a requested zero to one', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetCurrentLineWidth(0);

    // A PostScript zero-width line is one device pixel, which is not a plot.
    expect(plotter.GetCurrentLineWidth()).toBe(1);
    expect(body()).toBe('0.1 setlinewidth\n');
  });

  it('lets USE_DEFAULT_LINE_WIDTH resolve to a zero pen, unlike the PDF sibling', () => {
    const { plotter, body } = drawingPlotter({ defaultPenWidth: 0 });

    plotter.SetCurrentLineWidth(USE_DEFAULT_LINE_WIDTH);

    // This is the `else if` chain: the zero clamp is an *alternative* to the
    // default lookup, not a check applied after it. PDF's separate `if` would
    // have made this 1, and the NO_FILL guards below depend on it being 0.
    expect(plotter.GetCurrentLineWidth()).toBe(0);
    expect(body()).toBe('0 setlinewidth\n');
  });
});

describe('Rect, Circle and PlotPoly', () => {
  it('names the fill macro from the fill mode', () => {
    const { plotter, body } = drawingPlotter();

    plotter.Rect({ x: 0, y: 0 }, { x: 1000, y: 500 }, FILL_T.NO_FILL, 100);
    plotter.Rect({ x: 0, y: 0 }, { x: 1000, y: 500 }, FILL_T.FILLED_SHAPE, 100);
    plotter.Rect({ x: 0, y: 0 }, { x: 1000, y: 500 }, FILL_T.HATCH, 100);

    // Origin, size and macro id in one line: the operands are a PostScript
    // rectangle, so an x/y transposition would silently mirror every box.
    expect(body()).toBe(
      '10 setlinewidth\n' +
        `0 ${PAGE_TOP} 100 -50 rect0\n` +
        `0 ${PAGE_TOP} 100 -50 rect1\n` +
        `0 ${PAGE_TOP} 100 -50 rect2\n`,
    );
  });

  it('emits a degenerate rectangle rather than special-casing it', () => {
    const { plotter, body } = drawingPlotter();

    plotter.Rect({ x: 500, y: 500 }, { x: 500, y: 500 }, FILL_T.NO_FILL, 100);

    // PDF has to turn a zero-sized rectangle into a stroked point; rectstroke
    // copes, so PostScript does not and must not.
    expect(body()).toBe(`10 setlinewidth\n50 ${PAGE_TOP - 50} 0 0 rect0\n`);
  });

  it('draws a circle from centre, radius and macro with no Bezier fallback', () => {
    const { plotter, body } = drawingPlotter();

    plotter.Circle({ x: 100, y: 100 }, 250, FILL_T.FILLED_SHAPE, 0);

    // The radius is half the diameter in device units; the `arc` operator does
    // the rest. Twelve curve operands here would mean the PDF code got copied.
    expect(body()).toBe(`0.1 setlinewidth\n10 ${PAGE_TOP - 10} 12.5 cir1\n`);
  });

  it('never promotes a thinner-than-pen circle to a filled one', () => {
    const { plotter, body } = drawingPlotter();

    plotter.Circle({ x: 0, y: 0 }, 10, FILL_T.NO_FILL, 500);

    // PDF grows a hairline circle into a filled disc. PS_PLOTTER has no such
    // branch, so the outline stays an outline however wide the pen.
    expect(body()).toBe(`50 setlinewidth\n0 ${PAGE_TOP} 0.5 cir0\n`);
  });

  it('opens a path, walks it and leaves the macro to close it', () => {
    const { plotter, body } = drawingPlotter();

    plotter.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
      ],
      FILL_T.FILLED_SHAPE,
      200,
    );

    // poly1 closes and fills; the corner list is deliberately not closed here,
    // which is why an unfilled polygon (poly0 is a bare `stroke`) stays open.
    expect(body()).toBe(
      '20 setlinewidth\n' +
        'newpath\n' +
        `0 ${PAGE_TOP} moveto\n` +
        `100 ${PAGE_TOP} lineto\n` +
        `100 ${PAGE_TOP - 100} lineto\n` +
        'poly1\n',
    );
  });

  it('sets the pen before giving up on a one-point corner list', () => {
    const { plotter, body } = drawingPlotter();

    plotter.PlotPoly([{ x: 0, y: 0 }], FILL_T.FILLED_SHAPE, 200);

    // The guards run in upstream's order — pen, then fill, then point count —
    // so the pen change is observable even though nothing is drawn.
    expect(body()).toBe('20 setlinewidth\n');
  });

  it('draws nothing unfilled once the resolved pen is not positive', () => {
    const { plotter, body } = drawingPlotter({ defaultPenWidth: 0 });

    plotter.Rect({ x: 0, y: 0 }, { x: 10, y: 10 }, FILL_T.NO_FILL, USE_DEFAULT_LINE_WIDTH);
    plotter.Circle({ x: 0, y: 0 }, 10, FILL_T.NO_FILL, DO_NOT_SET_LINE_WIDTH);
    plotter.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      FILL_T.NO_FILL,
      DO_NOT_SET_LINE_WIDTH,
    );

    // The test is on the *resolved* pen, not on the caller's argument, so it
    // only bites once the default pen has been allowed to stay zero.
    expect(body()).toBe('0 setlinewidth\n');
  });

  it('still draws a filled shape when the pen is zero', () => {
    const { plotter, body } = drawingPlotter({ defaultPenWidth: 0 });

    plotter.Rect({ x: 0, y: 0 }, { x: 100, y: 100 }, FILL_T.FILLED_SHAPE, USE_DEFAULT_LINE_WIDTH);

    // The other direction of the same guard: the pen only silences an *unfilled*
    // shape, and a pad flashed with width 0 has to survive it.
    expect(body()).toBe(`0 setlinewidth\n0 ${PAGE_TOP} 10 -10 rect1\n`);
  });

  it('has no corner-radius path to fall back on', () => {
    const { plotter } = drawingPlotter();

    // SHAPE_RECT::SetRadius and the SHAPE_LINE_CHAIN PlotPoly are not in this
    // repo. Approximating the rounding would produce a plot KiCad never makes.
    expect(() => plotter.Rect({ x: 0, y: 0 }, { x: 10, y: 10 }, FILL_T.NO_FILL, 5, 2)).toThrow(
      /corner radius is not ported/,
    );
  });
});

describe('Arc', () => {
  it('emits centre, radius and the two device angles', () => {
    const { plotter, body } = drawingPlotter();

    plotter.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 1000, FILL_T.NO_FILL, 500);

    // The angles are recomputed *after* the device transform, so the paper flip
    // turns a 0..90 sweep into -90..0. Angles carried straight through from the
    // caller would draw the complementary arc.
    expect(body()).toBe(`50 setlinewidth\n0 ${PAGE_TOP} 100 -90 0 arc0\n`);
  });

  it('swaps the endpoints the other way round on a mirrored plot', () => {
    const { plotter, body } = drawingPlotter({ mirror: true });

    plotter.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 1000, FILL_T.NO_FILL, 500);

    // `!m_plotMirror ^ ( aAngle < ANGLE_0 )`: mirroring flips which of the two
    // orderings needs correcting, so the same call comes out with the angles the
    // other way about. Both directions are pinned because a port that dropped
    // the negation passes one of them by luck.
    expect(body()).toBe(`50 setlinewidth\n82680 ${PAGE_TOP} 100 -180 -90 arc0\n`);
  });

  it('leaves a negative sweep unswapped when the plot is not mirrored', () => {
    const { plotter, body } = drawingPlotter();

    plotter.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(-90), 1000, FILL_T.NO_FILL, 500);

    // The XOR's right half. Sweeping backwards from the same start angle takes
    // the branch that the forward sweep did not.
    expect(body()).toBe(`50 setlinewidth\n0 ${PAGE_TOP} 100 0 90 arc0\n`);
  });

  it('sets the pen between computing the arc and writing it', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetCurrentLineWidth(100);
    plotter.Arc(
      { x: 0, y: 0 },
      new EDA_ANGLE(0),
      new EDA_ANGLE(90),
      1000,
      FILL_T.FILLED_SHAPE,
      200,
    );

    // The pen line lands immediately before the operator, not before the
    // preceding geometry, because SetCurrentLineWidth is called late.
    expect(body()).toBe(`10 setlinewidth\n20 setlinewidth\n0 ${PAGE_TOP} 100 -90 0 arc1\n`);
  });

  it('plots a zero-radius arc rather than guarding against it', () => {
    const { plotter, body } = drawingPlotter();

    plotter.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 0, FILL_T.NO_FILL, 500);

    // PDF turns a non-positive radius into a filled dot. PS_PLOTTER has no such
    // check, and both endpoints collapse onto the centre so both angles are 0.
    expect(body()).toBe(`50 setlinewidth\n0 ${PAGE_TOP} 0 0 0 arc0\n`);
  });

  it('derives centre and sweep from three points', () => {
    const { plotter, body } = drawingPlotter();

    plotter.ArcThroughPoints(
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
      { x: -1000, y: 0 },
      FILL_T.NO_FILL,
      500,
    );

    // The determinant is negative, so this triple is the clockwise one and the
    // sweep normalises to +180; the device transform then swaps the endpoints,
    // which is why the operands read -180 before 0 and not the other way round.
    expect(body()).toBe(`50 setlinewidth\n0 ${PAGE_TOP} 100 -180 0 arc0\n`);
  });
});

describe('colour', () => {
  it('writes the three components at three significant digits', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetColor({ r: 2 / 3, g: 1, b: 0.5, a: 1 });

    // Every coordinate in the file is %g at six digits; this one line is %.3g.
    // A shared formatter would give 0.666667 here and pass every other test.
    expect(body()).toBe('0.667 1 0.5 setrgbcolor\n');
  });

  it('pre-blends a translucent colour against white paper', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetColor({ r: 0, g: 0, b: 0, a: 0.5 });

    // PostScript has no alpha at all, so a half-transparent black has to arrive
    // as mid grey or it plots solid.
    expect(body()).toBe('0.5 0.5 0.5 setrgbcolor\n');
  });

  it('keeps only exact white white in mono mode', () => {
    const { plotter, body } = drawingPlotter({ colorMode: false });
    const almostWhite: Color4d = { r: 1, g: 1, b: 0.999, a: 1 };

    plotter.SetColor(COLOR4D_WHITE);
    plotter.SetColor(almostWhite);
    plotter.SetColor(COLOR4D_BLACK);

    // pcbnew draws holes white on black pads in mono, so the white test has to
    // be exact — including the alpha, which is part of COLOR4D's equality.
    expect(body()).toBe('1 1 1 setrgbcolor\n0 0 0 setrgbcolor\n0 0 0 setrgbcolor\n');
  });

  it('treats a translucent white as not white in mono mode', () => {
    const { plotter, body } = drawingPlotter({ colorMode: false });

    plotter.SetColor({ r: 1, g: 1, b: 1, a: 0.5 });

    // The comparison includes alpha. Comparing only the three channels would
    // paint this white and lose the hole.
    expect(body()).toBe('0 0 0 setrgbcolor\n');
  });

  it('inverts in negative mode, in colour and in mono', () => {
    const colour = drawingPlotter();
    const mono = drawingPlotter({ colorMode: false });

    colour.plotter.SetNegative(true);
    mono.plotter.SetNegative(true);

    colour.plotter.SetColor({ r: 0.25, g: 0.5, b: 1, a: 1 });
    mono.plotter.SetColor(COLOR4D_WHITE);

    // Colour mode inverts before the alpha blend, mono inverts the black/white
    // decision. Only checking one arm leaves the other free to do nothing.
    expect(colour.body()).toBe('0.75 0.5 0 setrgbcolor\n');
    expect(mono.body()).toBe('0 0 0 setrgbcolor\n');
  });
});

describe('SetDash', () => {
  it('writes each pattern with the element count its style requires', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetDash(1000, LINE_STYLE.DASH);
    plotter.SetDash(1000, LINE_STYLE.DOT);
    plotter.SetDash(1000, LINE_STYLE.DASHDOT);
    plotter.SetDash(1000, LINE_STYLE.DASHDOTDOT);

    // Dash is 11x the width, gap 4x and dot 0.2x, all through the device
    // transform and truncated. A dot/dash transposition renders as the wrong
    // line style and nothing else complains.
    expect(body()).toBe(
      '[1100 400] 0 setdash\n' +
        '[20 400] 0 setdash\n' +
        '[1100 400 20 400] 0 setdash\n' +
        '[1100 400 20 400 20 400] 0 setdash\n',
    );
  });

  it('calls the prolog macro for a solid line rather than writing a pattern', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetDash(1000, LINE_STYLE.SOLID);
    plotter.SetDash(1000, LINE_STYLE.DEFAULT);

    // SOLID and DEFAULT share the switch's default arm, and it emits the macro
    // name — not the `[] 0 setdash` the macro expands to.
    expect(body()).toBe('solidline\nsolidline\n');
  });

  it('truncates to whole device units and lets a pattern collapse to zeros', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetDash(1, LINE_STYLE.DASH);

    // PDF detects an all-zero array and falls back to solid; PostScript does
    // not, so the degenerate pattern reaches the file. Rounding instead of
    // truncating would hide it behind a 1.
    expect(body()).toBe('[1 0] 0 setdash\n');
  });
});

describe('the pen', () => {
  it('opens a path on leaving rest and strokes it on returning', () => {
    const { plotter, body } = drawingPlotter();

    plotter.MoveTo({ x: 0, y: 0 });
    plotter.LineTo({ x: 1000, y: 1000 });
    plotter.PenFinish();

    // The newpath/stroke bracket is what makes the segments one path; without
    // it every lineto would join whatever path happened to be open.
    expect(body()).toBe(
      'newpath\n' + `0 ${PAGE_TOP} moveto\n` + `100 ${PAGE_TOP - 100} lineto\n` + 'stroke\n',
    );
  });

  it('opens a fresh path for each plume that leaves rest, and only then', () => {
    const { plotter, body } = drawingPlotter();

    plotter.MoveTo({ x: 0, y: 0 });
    plotter.LineTo({ x: 1000, y: 0 });
    plotter.MoveTo({ x: 2000, y: 0 });
    plotter.PenFinish();
    plotter.MoveTo({ x: 0, y: 0 });

    // The newpath is keyed on the pen being at *rest*, not on the plume being a
    // move: the mid-path lift to (2000,0) gets no newpath, and the move after
    // the stroke does. Keying it on 'U' instead would split every polyline.
    expect(body()).toBe(
      'newpath\n' +
        `0 ${PAGE_TOP} moveto\n` +
        `100 ${PAGE_TOP} lineto\n` +
        `200 ${PAGE_TOP} moveto\n` +
        'stroke\n' +
        'newpath\n' +
        `0 ${PAGE_TOP} moveto\n`,
    );
  });

  it('suppresses a repeated point at the same plume', () => {
    const { plotter, body } = drawingPlotter();

    plotter.MoveTo({ x: 500, y: 500 });
    plotter.MoveTo({ x: 500, y: 500 });
    plotter.LineTo({ x: 500, y: 500 });

    // Only the plume change re-emits: the second moveto is dropped and the
    // lineto is not, which is how a zero-length segment still gets stroked.
    expect(body()).toBe(
      'newpath\n' + `50 ${PAGE_TOP - 50} moveto\n` + `50 ${PAGE_TOP - 50} lineto\n`,
    );
  });

  it('does not stroke twice when the pen is already at rest', () => {
    const { plotter, body } = drawingPlotter();

    plotter.PenFinish();
    plotter.PenFinish();

    // A stroke with no path is harmless in PostScript but is not what KiCad
    // writes, and it would shift every byte after it.
    expect(body()).toBe('');
  });

  it('closes the segment with FinishTo', () => {
    const { plotter, body } = drawingPlotter();

    plotter.MoveTo({ x: 0, y: 0 });
    plotter.FinishTo({ x: 1000, y: 0 });

    expect(body()).toBe(`newpath\n0 ${PAGE_TOP} moveto\n100 ${PAGE_TOP} lineto\nstroke\n`);
  });
});

describe('thick primitives and pad flashes', () => {
  it('turns a zero-length thick segment into a filled circle', () => {
    const { plotter, body } = drawingPlotter();

    plotter.ThickSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, 400);

    // A track stub of no length is a round pad of the track's width; drawing it
    // as a segment would leave nothing on the plot at all.
    expect(body()).toBe(`0.1 setlinewidth\n0 ${PAGE_TOP} 20 cir1\n`);
  });

  it('resolves a default-width sentinel through the pen before using it as a diameter', () => {
    const { plotter, body } = drawingPlotter({ defaultPenWidth: 600 });

    plotter.ThickSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, USE_DEFAULT_LINE_WIDTH);

    // USE_DEFAULT_LINE_WIDTH has to go through SetCurrentLineWidth so the pen is
    // left at the default too; reading the live pen instead would give the
    // circle whatever width the previous primitive used.
    expect(body()).toBe(`60 setlinewidth\n0.1 setlinewidth\n0 ${PAGE_TOP} 30 cir1\n`);
  });

  it('reads the live pen for a do-not-set sentinel', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetCurrentLineWidth(800);
    plotter.ThickSegment({ x: 0, y: 0 }, { x: 0, y: 0 }, DO_NOT_SET_LINE_WIDTH);

    // The other sentinel: no pen line of its own, and the diameter comes from
    // whatever the caller already configured.
    expect(body()).toBe(`80 setlinewidth\n0.1 setlinewidth\n0 ${PAGE_TOP} 40 cir1\n`);
  });

  it('draws a real thick segment as a stroked path', () => {
    const { plotter, body } = drawingPlotter();

    plotter.ThickSegment({ x: 0, y: 0 }, { x: 1000, y: 0 }, 400);

    expect(body()).toBe(
      `40 setlinewidth\nnewpath\n0 ${PAGE_TOP} moveto\n100 ${PAGE_TOP} lineto\nstroke\n`,
    );
  });

  it('flashes a circular pad as a filled circle', () => {
    const { plotter, body } = drawingPlotter();

    plotter.FlashPadCircle({ x: 0, y: 0 }, 500);

    expect(body()).toBe(`0.1 setlinewidth\n0 ${PAGE_TOP} 25 cir1\n`);
  });

  it('normalises a wide oval pad to a vertical one before flashing it', () => {
    const wide = drawingPlotter();
    const tall = drawingPlotter();

    wide.plotter.FlashPadOval({ x: 0, y: 0 }, { x: 2000, y: 1000 }, new EDA_ANGLE(0));
    tall.plotter.FlashPadOval({ x: 0, y: 0 }, { x: 1000, y: 2000 }, new EDA_ANGLE(90));

    // A pad wider than it is tall has its axes swapped and 90 degrees added, so
    // these two calls describe the same pad and must plot identically.
    expect(wide.body()).toBe(tall.body());
    expect(wide.body()).toBe(
      `100 setlinewidth\nnewpath\n-50 ${PAGE_TOP} moveto\n50 ${PAGE_TOP} lineto\nstroke\n`,
    );
  });

  it('flashes a rectangular pad as a closed five-point polygon about its centre', () => {
    const { plotter, body } = drawingPlotter();

    plotter.FlashPadRect({ x: 1000, y: 1000 }, { x: 400, y: 200 }, new EDA_ANGLE(0));

    // The corners rotate about the *pad*, and the first is repeated even though
    // poly1 would close the path anyway — so five lineto operands, not four.
    expect(body()).toBe(
      '0.1 setlinewidth\n' +
        'newpath\n' +
        `80 ${PAGE_TOP - 110} moveto\n` +
        `80 ${PAGE_TOP - 90} lineto\n` +
        `120 ${PAGE_TOP - 90} lineto\n` +
        `120 ${PAGE_TOP - 110} lineto\n` +
        `80 ${PAGE_TOP - 110} lineto\n` +
        'poly1\n',
    );
  });

  it('rotates a trapezoidal pad about the origin and only then translates it', () => {
    const { plotter, body } = drawingPlotter();

    plotter.FlashPadTrapez(
      { x: 1000, y: 1000 },
      [
        { x: -200, y: -100 },
        { x: 200, y: -100 },
        { x: 100, y: 100 },
        { x: -100, y: 100 },
      ],
      new EDA_ANGLE(90),
    );

    // Rotating about the pad position instead would move the whole pad off its
    // own centre once the orientation is not zero.
    expect(body()).toBe(
      '0.1 setlinewidth\n' +
        'newpath\n' +
        `90 ${PAGE_TOP - 120} moveto\n` +
        `90 ${PAGE_TOP - 80} lineto\n` +
        `110 ${PAGE_TOP - 90} lineto\n` +
        `110 ${PAGE_TOP - 110} lineto\n` +
        `90 ${PAGE_TOP - 120} lineto\n` +
        'poly1\n',
    );
  });

  it('draws nothing at all for a regular polygon', () => {
    const { plotter, body } = drawingPlotter();

    plotter.FlashRegularPolygon({ x: 0, y: 0 }, 500, 6, new EDA_ANGLE(0));

    // The upstream body is `wxASSERT( 0 )` under a "Do nothing" comment, so in a
    // release build this is a no-op — an omission to reproduce, not to fill in.
    expect(body()).toBe('');
  });

  it('delegates the unfilled thick shapes to their plain counterparts', () => {
    const { plotter, body } = drawingPlotter();

    plotter.ThickRect({ x: 0, y: 0 }, { x: 100, y: 100 }, 200);
    plotter.ThickCircle({ x: 0, y: 0 }, 100, 200);
    plotter.FilledCircle({ x: 0, y: 0 }, 100);

    expect(body()).toBe(
      `20 setlinewidth\n0 ${PAGE_TOP} 10 -10 rect0\n` +
        `0 ${PAGE_TOP} 5 cir0\n` +
        `0.1 setlinewidth\n0 ${PAGE_TOP} 5 cir1\n`,
    );
  });
});

describe('PlotImage', () => {
  const twoByTwo = makeImage({
    width: 2,
    height: 2,
    pixel: (x, y) => [x === 0 ? 0x10 : 0x20, y === 0 ? 0x30 : 0x40, 0x50],
  });

  it('emits the whole PostScript image program in colour mode', () => {
    const { plotter, body } = drawingPlotter();

    plotter.PlotImage(twoByTwo, { x: 0, y: 0 }, 100);

    // The save/restore bracket, the unit-square mapping and the source matrix
    // are all one program; asserting it whole is the only way to catch an
    // operand written in the wrong order. Note /pix is declared as *width*
    // bytes while colorimage consumes three per pixel — upstream's bug.
    expect(body()).toBe(
      '/origstate save def\n' +
        '/pix 2 string def\n' +
        `-10 ${PAGE_TOP - 10} translate\n` +
        '20 20 scale\n' +
        '2 2 8 [2 0 0 -2 0 2]\n' +
        '{currentfile pix readhexstring pop}\n' +
        'false 3 colorimage\n' +
        '103050' +
        '203050' +
        '104050' +
        '204050' +
        '\n' +
        'origstate restore\n',
    );
  });

  it('writes one greyscale byte per pixel and calls image in mono mode', () => {
    const { plotter, body } = drawingPlotter({ colorMode: false });

    plotter.PlotImage(twoByTwo, { x: 0, y: 0 }, 100);

    // CIE 1931 weights, KiROUNDed: 0x10*0.2126 + 0x30*0.7152 + 0x50*0.0722 is
    // 43.5, which rounds away from zero to 44. Math.round would agree here and
    // disagree on the negatives KiROUND exists for.
    expect(body()).toContain('image\n2C2F373A\norigstate restore\n');
    expect(body()).not.toContain('colorimage');
  });

  it('breaks the hex dump every sixteen pixels without resetting between rows', () => {
    const { plotter, body } = drawingPlotter({ colorMode: false });

    plotter.PlotImage(
      makeImage({ width: 5, height: 5, pixel: () => [0, 0, 0] }),
      { x: 0, y: 0 },
      1,
    );

    const dump = body().split('image\n')[1]!.split('\norigstate')[0]!;

    // Twenty-five pixels, one break after the sixteenth. The counter is not
    // reset per row upstream, so the break lands mid-row — resetting it would
    // put breaks after every fifth pixel instead.
    expect(dump).toBe(`${'00'.repeat(16)}\n${'00'.repeat(9)}`);
  });

  it('premultiplies alpha against white in single precision', () => {
    const { plotter, body } = drawingPlotter();

    plotter.PlotImage(
      makeImage({
        width: 2,
        height: 1,
        pixel: () => [0x00, 0x80, 0xff],
        alpha: (x) => (x === 0 ? 0x80 : 0xff),
      }),
      { x: 0, y: 0 },
      1,
    );

    // The first pixel is half transparent; the second is opaque and must be
    // left exactly alone, which is what the `alpha < 0xFF` guard is for. Two
    // upstream details show in the first pixel's three bytes: the arithmetic is
    // C `float`, so 127 comes out of `a * 0xFF` rather than 128, and the sum is
    // masked with 0xFF rather than clamped — so the already-saturated blue
    // channel *wraps* from 0xFF back down to 0x7E instead of staying white.
    expect(body()).toContain('colorimage\n7FFF7E0080FF\n');
  });

  it('masks rather than clamps on every one of the three channels', () => {
    const { plotter, body } = drawingPlotter();

    plotter.PlotImage(
      makeImage({
        width: 1,
        height: 1,
        pixel: () => [0xff, 0xc0, 0x81],
        alpha: () => 0x80,
      }),
      { x: 0, y: 0 },
      1,
    );

    // The test above only overflows blue, so red and green would survive being
    // clamped instead of masked. Here every channel is high enough that adding
    // the half-transparent 127 carries past 0xFF: 255+127 = 382 -> 0x7E,
    // 192+127 = 319 -> 0x3F, 129+127 = 256 -> 0x00. Upstream's `& 0xFF` is what
    // produces those; a clamp would write FFFFFF and lose the wrap on all three.
    expect(body()).toContain('colorimage\n7E3F00\n');
  });

  it('replaces a masked pixel with white, after the alpha blend and not before', () => {
    const { plotter, body } = drawingPlotter();

    plotter.PlotImage(
      makeImage({
        width: 2,
        height: 1,
        pixel: (x) => (x === 0 ? [0xff, 0x00, 0xff] : [0x11, 0x22, 0x33]),
        mask: [0xff, 0x00, 0xff],
      }),
      { x: 0, y: 0 },
      1,
    );

    // Magenta is the mask colour and becomes white; the other pixel is
    // untouched. PDF substitutes the render settings' background here — PS
    // hard-codes white, and the two must not be conflated.
    expect(body()).toContain('colorimage\nFFFFFF112233\n');
  });
});

describe('text', () => {
  const strokes: readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[] = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    [
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
  ];

  it('plots no phantom string in the default STROKE mode', () => {
    const { plotter, body } = drawingPlotter();

    expect(plotter.GetTextMode()).toBe(PLOT_TEXT_MODE.STROKE);

    plotter.Text(
      { x: 0, y: 0 },
      COLOR4D_BLACK,
      'Hi',
      new EDA_ANGLE(0),
      { x: 500, y: 500 },
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      200,
      false,
      false,
      true,
      stubFont(strokes),
    );

    // PS_PLOTTER's constructor overrides PSLIKE's PHANTOM with STROKE because
    // the phantom hack "reportedly crashes Adobe's own postscript interpreter".
    // A port that kept the base default would put an extra line in every plot.
    expect(body()).not.toContain('phantomshow');
  });

  it('plots the hidden search anchor once PHANTOM is asked for', () => {
    const { plotter, body } = drawingPlotter();

    plotter.SetTextMode(PLOT_TEXT_MODE.PHANTOM);
    plotter.Text(
      { x: 1000, y: 1000 },
      COLOR4D_BLACK,
      'H(i)',
      new EDA_ANGLE(0),
      { x: 500, y: 500 },
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      200,
      false,
      false,
      true,
      stubFont([]),
    );

    // The string goes through the same Latin-1 encoder as the title, and the
    // position is the anchor rather than the justified one.
    expect(body()).toContain(`(H\\(i\\)) 100 ${PAGE_TOP - 100} phantomshow\n`);
  });

  it('ignores a DEFAULT text mode instead of storing it', () => {
    const { plotter } = drawingPlotter();

    plotter.SetTextMode(PLOT_TEXT_MODE.PHANTOM);
    plotter.SetTextMode(PLOT_TEXT_MODE.DEFAULT);

    // DEFAULT means "leave the mode alone", not "reset to the default".
    expect(plotter.GetTextMode()).toBe(PLOT_TEXT_MODE.PHANTOM);
  });

  it('re-issues the pen for every glyph stroke on the Text path', () => {
    const { plotter, body } = drawingPlotter();

    plotter.Text(
      { x: 0, y: 0 },
      COLOR4D_BLACK,
      'Hi',
      new EDA_ANGLE(0),
      { x: 500, y: 500 },
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      200,
      false,
      false,
      true,
      stubFont(strokes),
    );

    // SetColor is emitted twice — once by PS_PLOTTER::Text and once by
    // PLOTTER::Text — and the stroke callback calls SetCurrentLineWidth per
    // segment. The change test then swallows all but the first.
    expect(body()).toBe(
      '20 setlinewidth\n' +
        '0 0 0 setrgbcolor\n' +
        '0 0 0 setrgbcolor\n' +
        `newpath\n0 ${PAGE_TOP} moveto\n10 ${PAGE_TOP} lineto\nstroke\n` +
        `newpath\n10 ${PAGE_TOP} moveto\n10 ${PAGE_TOP - 10} lineto\nstroke\n`,
    );
  });

  it('does not re-issue the pen per stroke on the PlotText path', () => {
    const { plotter, body } = drawingPlotter();
    const attributes: PsTextAttributes = {
      m_Size: { x: 500, y: 500 },
      m_Halign: GR_TEXT_H_ALIGN_T.LEFT,
      m_Valign: GR_TEXT_V_ALIGN_T.BOTTOM,
      m_StrokeWidth: 200,
      m_Angle: new EDA_ANGLE(0),
      m_Italic: false,
      m_Bold: false,
      m_Mirrored: false,
      m_Multiline: true,
    };

    plotter.PlotText({ x: 0, y: 0 }, COLOR4D_BLACK, 'Hi', attributes, stubFont(strokes));

    // PLOTTER::PlotText's stroke callback has no SetCurrentLineWidth, where
    // PLOTTER::Text's does. The difference is invisible while the pen never
    // changes, which is exactly why it needs pinning from both sides.
    expect(body()).toBe(
      '20 setlinewidth\n' +
        '0 0 0 setrgbcolor\n' +
        '0 0 0 setrgbcolor\n' +
        `newpath\n0 ${PAGE_TOP} moveto\n10 ${PAGE_TOP} lineto\nstroke\n` +
        `newpath\n10 ${PAGE_TOP} moveto\n10 ${PAGE_TOP - 10} lineto\nstroke\n`,
    );
  });

  it('hands the base class the resolved pen, not the caller sentinel', () => {
    const { plotter } = drawingPlotter();
    let seen = -99;

    plotter.SetCurrentLineWidth(700);
    plotter.Text(
      { x: 0, y: 0 },
      COLOR4D_BLACK,
      'Hi',
      new EDA_ANGLE(0),
      { x: 500, y: 500 },
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      DO_NOT_SET_LINE_WIDTH,
      false,
      false,
      true,
      {
        Draw: (_t, _p, aAttributes) => {
          seen = aAttributes.m_StrokeWidth;
          return [];
        },
      },
    );

    // GetCurrentLineWidth(), not aWidth: a do-not-set caller gets the live pen
    // threaded into the text attributes rather than the sentinel -2.
    expect(seen).toBe(700);
  });

  it('applies the bold default only to a zero pen, and only after that negates', () => {
    const bold = drawingPlotter();
    const negative = drawingPlotter();
    let boldWidth = -99;
    let negativeWidth = -99;

    const capture = (aSink: (aWidth: number) => void): PsFont => ({
      Draw: (_t, _p, aAttributes) => {
        aSink(aAttributes.m_StrokeWidth);
        return [];
      },
    });

    bold.plotter.Text(
      { x: 0, y: 0 },
      COLOR4D_BLACK,
      'Hi',
      new EDA_ANGLE(0),
      { x: 500, y: 900 },
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      0,
      false,
      true,
      true,
      capture((w) => {
        boldWidth = w;
      }),
    );

    negative.plotter.Text(
      { x: 0, y: 0 },
      COLOR4D_BLACK,
      'Hi',
      new EDA_ANGLE(0),
      { x: 500, y: 900 },
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      -300,
      false,
      true,
      true,
      capture((w) => {
        negativeWidth = w;
      }),
    );

    // Bold with a zero pen picks up min(size)/5 = 100. A negative pen is only a
    // sign trick and keeps its magnitude — it must not pick up the bold default
    // as well, which is what the ordering of the two tests guarantees.
    expect(boldWidth).toBe(1);
    expect(negativeWidth).toBe(300);
  });

  it('encodes a mirrored run as a negative width and reads it back out', () => {
    const { plotter } = drawingPlotter();
    let seen: PsTextAttributes | null = null;
    const attributes: PsTextAttributes = {
      m_Size: { x: 500, y: 500 },
      m_Halign: GR_TEXT_H_ALIGN_T.LEFT,
      m_Valign: GR_TEXT_V_ALIGN_T.BOTTOM,
      m_StrokeWidth: 200,
      m_Angle: new EDA_ANGLE(0),
      m_Italic: false,
      m_Bold: false,
      m_Mirrored: true,
      m_Multiline: true,
    };

    plotter.PlotText({ x: 0, y: 0 }, COLOR4D_BLACK, 'Hi', attributes, {
      Draw: (_t, _p, a) => {
        seen = a;
        return [];
      },
    });

    // PlotText passes the attributes through untouched, mirror flag and all —
    // it is Text that carries mirroring as a negative x size.
    expect(seen!.m_Mirrored).toBe(true);
    expect(seen!.m_Size.x).toBe(500);
  });

  it('turns a negative x size back into a mirror flag on the Text path', () => {
    const { plotter } = drawingPlotter();
    let seen: PsTextAttributes | null = null;

    plotter.Text(
      { x: 0, y: 0 },
      COLOR4D_BLACK,
      'Hi',
      new EDA_ANGLE(0),
      { x: -500, y: 500 },
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      200,
      false,
      false,
      true,
      {
        Draw: (_t, _p, a) => {
          seen = a;
          return [];
        },
      },
    );

    // The magnitude is restored and the flag set; there is no other channel for
    // "this string is mirrored" in PLOTTER::Text's signature.
    expect(seen!.m_Mirrored).toBe(true);
    expect(seen!.m_Size.x).toBe(500);
  });

  it('always allows multiline, whatever the caller asked for', () => {
    const { plotter } = drawingPlotter();
    let seen = false;

    plotter.Text(
      { x: 0, y: 0 },
      COLOR4D_BLACK,
      'Hi',
      new EDA_ANGLE(0),
      { x: 500, y: 500 },
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      200,
      false,
      false,
      false,
      {
        Draw: (_t, _p, a) => {
          seen = a.m_Multiline;
          return [];
        },
      },
    );

    // TEXT_ATTRIBUTES defaults m_Multiline to true and PLOTTER::Text never
    // assigns it, so aMultilineAllowed is threaded all the way down and then
    // discarded. Honouring it would be a fix, not a port.
    expect(seen).toBe(true);
  });

  it('needs a font, because KIFONT::FONT::GetFont has no counterpart here', () => {
    const { plotter } = drawingPlotter();

    expect(() =>
      plotter.Text(
        { x: 0, y: 0 },
        COLOR4D_BLACK,
        'Hi',
        new EDA_ANGLE(0),
        { x: 500, y: 500 },
        GR_TEXT_H_ALIGN_T.LEFT,
        GR_TEXT_V_ALIGN_T.BOTTOM,
        200,
        false,
        false,
        true,
        null,
      ),
    ).toThrow(/needs a font/);
  });
});

describe('returnPostscriptTextWidth', () => {
  it('scales the AFM tally by the x size and the Helvetica ascent', () => {
    const plotter = makePlotter();

    // "AV" is 0.667 + 0.667 in Helvetica; the ascent divisor is what converts
    // AFM em fractions to KiCad's glyph height.
    const expected = Math.round((1000 * (0.667 + 0.667)) / POSTSCRIPT_TEXT_ASCENT);

    expect(plotter.returnPostscriptTextWidth('AV', 1000, false, false)).toBe(expected);
  });

  it('picks a different table for each of the four faces', () => {
    const plotter = makePlotter();
    const regular = plotter.returnPostscriptTextWidth('m', 1000, false, false);
    const bold = plotter.returnPostscriptTextWidth('m', 1000, false, true);
    const oblique = plotter.returnPostscriptTextWidth('m', 1000, true, false);
    const boldOblique = plotter.returnPostscriptTextWidth('m', 1000, true, true);

    // The oblique tables are copies of their upright ones — an oblique face is a
    // shear — while the bold ones genuinely differ. Both facts are asserted so a
    // table swapped in the selector cannot pass.
    expect(oblique).toBe(regular);
    expect(boldOblique).toBe(bold);
    expect(bold).toBeGreaterThan(regular);
  });

  it('does not count a character the table has no room for', () => {
    const plotter = makePlotter();

    // The tables are 256 entries. Indexing past them in C++ reads whatever
    // follows in the data segment, so upstream skips instead — and a Cyrillic
    // string therefore measures exactly zero.
    expect(plotter.returnPostscriptTextWidth('ΩΩ', 1000, false, false)).toBe(0);
    expect(plotter.returnPostscriptTextWidth('AΩ', 1000, false, false)).toBe(
      plotter.returnPostscriptTextWidth('A', 1000, false, false),
    );
  });
});

describe('computeTextParameters', () => {
  const call = (aPlotter: PsPlotter, aOverrides: { width?: number; bold?: boolean } = {}) =>
    aPlotter.computeTextParameters(
      { x: 0, y: 0 },
      'AV',
      new EDA_ANGLE(0),
      { x: 1000, y: 1000 },
      false,
      GR_TEXT_H_ALIGN_T.RIGHT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      aOverrides.width ?? 0,
      false,
      aOverrides.bold ?? false,
    );

  it('measures with the bold table whenever the pen is non-zero', () => {
    const plotter = makePlotter();
    const thin = call(plotter, { width: 0 });
    const thick = call(plotter, { width: 1 });

    // `returnPostscriptTextWidth( aText, aSize.x, aItalic, aWidth )` hands an
    // int to a bool parameter. The right-justified offset therefore jumps the
    // moment the pen leaves zero, which is what moves ctm_e here.
    expect(thick.ctm_e).not.toBe(thin.ctm_e);
  });

  it('ignores its own aBold argument entirely', () => {
    const plotter = makePlotter();

    // The other half of the same fault: the declared bold flag reaches nothing.
    // Wiring it up would fix a bug that KiCad still has.
    expect(call(plotter, { width: 0, bold: true })).toEqual(
      call(plotter, { width: 0, bold: false }),
    );
  });

  it('negates the widening factor when exactly one of the two mirrors is set', () => {
    const plain = makePlotter();
    const mirrored = makePlotter({ mirror: true });

    plain.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, false);
    mirrored.SetViewport({ x: 0, y: 0 }, IUS_PER_DECIMIL, 1, true);

    const both = (aPlotter: PsPlotter, aMirror: boolean) =>
      aPlotter.computeTextParameters(
        { x: 0, y: 0 },
        'A',
        new EDA_ANGLE(0),
        { x: 1000, y: 500 },
        aMirror,
        GR_TEXT_H_ALIGN_T.LEFT,
        GR_TEXT_V_ALIGN_T.BOTTOM,
        0,
        false,
        false,
      ).wideningFactor;

    // It is an XOR: a mirrored string on a mirrored plot reads the right way
    // round again. Testing only the plain plot would let an OR through.
    expect(both(plain, false)).toBe(2);
    expect(both(plain, true)).toBe(-2);
    expect(both(mirrored, false)).toBe(-2);
    expect(both(mirrored, true)).toBe(2);
  });

  it('inverts the CTM rotation on a mirrored plot', () => {
    const plain = makePlotter();
    const mirrored = makePlotter({ mirror: true });

    const rotation = (aPlotter: PsPlotter) =>
      aPlotter.computeTextParameters(
        { x: 0, y: 0 },
        'A',
        new EDA_ANGLE(90),
        { x: 1000, y: 1000 },
        false,
        GR_TEXT_H_ALIGN_T.LEFT,
        GR_TEXT_V_ALIGN_T.BOTTOM,
        0,
        false,
        false,
      ).ctm_b;

    // ctm_b is sin(alpha), and alpha is the *inverted* angle when the plot is
    // mirrored — so the sign flips and the cosine terms do not.
    expect(rotation(plain)).toBeCloseTo(1, 12);
    expect(rotation(mirrored)).toBeCloseTo(-1, 12);
  });

  it('divides the device height by the Helvetica ascent', () => {
    const plotter = makePlotter();

    // "This is because the letters are less than 1 unit high": the height factor
    // is what scales a 1-unit font up to the requested glyph height.
    expect(call(plotter).heightFactor).toBeCloseTo(100 / POSTSCRIPT_TEXT_ASCENT, 12);
  });
});

describe('EndPlot', () => {
  it('shows the page, unwinds the page setup and marks the file complete', () => {
    const { plotter, body } = drawingPlotter();

    plotter.EndPlot();

    // The grestore pairs with StartPlot's gsave; without it a concatenated
    // document inherits this page's transform.
    expect(body()).toBe('showpage\ngrestore\n%%EOF\n');
  });

  it('refuses to end a plot that was never opened', () => {
    const plotter = new PsPlotter(psRenderSettings());

    expect(() => plotter.EndPlot()).toThrow(/before OpenFile/);
  });

  it('reports its file extension and remembers its filename', () => {
    const plotter = makePlotter();

    expect(PsPlotter.GetDefaultFileExtension()).toBe('ps');
    expect(plotter.GetFilename()).toBe('/plots/board.ps');
  });
});
