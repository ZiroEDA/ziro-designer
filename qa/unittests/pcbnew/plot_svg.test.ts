// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, expect, it } from 'vitest';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import {
  base64Encode,
  type Color4d,
  COLOR4D_WHITE,
  DO_NOT_SET_LINE_WIDTH,
  FILL_T,
  fixed,
  GetISO8601CurrentDateTime,
  GetPenSizeForBold,
  hex6,
  LINE_STYLE,
  type SvgFont,
  type SvgImage,
  SvgPlotter,
  svgRenderSettings,
  type SvgTextAttributes,
  USE_DEFAULT_LINE_WIDTH,
  XmlEsc,
} from '@ziroeda/pcbnew/src/plot_svg.js';

/** A4 landscape in mils, i.e. what PAGE_INFO::GetSizeMils() hands SetViewport. */
const A4_MILS = { x: 11693, y: 8268 };

/** One millimetre in IU, since pcbnew's 2540 IU/decimil makes a device unit a mm. */
const MM = 1_000_000;

const rgb = (r: number, g: number, b: number, a = 1): Color4d => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a,
});

/**
 * A plotter wired the way pcbnew wires one: A4, 2540 IU per decimil, unit
 * scale, colour on. The fixed date keeps `<title>` deterministic.
 */
function plotter(
  opts: {
    mirror?: boolean;
    colorMode?: boolean;
    defaultPenWidth?: number;
    scale?: number;
    offset?: { x: number; y: number };
    start?: boolean;
  } = {},
): SvgPlotter {
  const p = new SvgPlotter(svgRenderSettings({ defaultPenWidth: opts.defaultPenWidth ?? 0 }));
  p.OpenFile('/home/plots/board.svg');
  p.SetCreator('ZiroEDA');
  p.SetPageSettings(A4_MILS);
  p.SetColorMode(opts.colorMode ?? true);
  p.SetViewport(opts.offset ?? { x: 0, y: 0 }, 2540, opts.scale ?? 1, opts.mirror ?? false);

  if (opts.start !== false) p.StartPlot('', new Date(2026, 0, 2, 3, 4, 5));

  return p;
}

/** The document with the header dropped, so a test can read the body as prose. */
function body(p: SvgPlotter): string {
  const text = p.text();
  const cut = text.indexOf(' transform="translate(0 0) scale(1 1)">\n');
  return text.slice(cut + ' transform="translate(0 0) scale(1 1)">\n'.length);
}

/** A stroke font stub: one horizontal segment per character, at the baseline. */
const stubFont = (width = 1000): SvgFont => ({
  GRTextWidth: (aText) => aText.length * width,
  Draw: (aText, aPos) =>
    Array.from(aText, (_ch, i) => [
      { x: aPos.x + i * width, y: aPos.y },
      { x: aPos.x + (i + 1) * width, y: aPos.y },
    ]) as readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[],
});

const attributes = (over: Partial<SvgTextAttributes> = {}): SvgTextAttributes => ({
  m_Size: { x: 1500, y: 1500 },
  m_Halign: GR_TEXT_H_ALIGN_T.LEFT,
  m_Valign: GR_TEXT_V_ALIGN_T.BOTTOM,
  m_StrokeWidth: 0,
  m_Angle: new EDA_ANGLE(0),
  m_Italic: false,
  m_Bold: false,
  m_Mirrored: false,
  m_Multiline: false,
  ...over,
});

// ===========================================================================

describe('fixed — fmt "{:.Nf}"', () => {
  it('rounds an exact decimal tie to even, not away from zero', () => {
    // 0.5, 1.5, 2.5 and 0.125 are all exactly representable, so the tie is real
    // and printf resolves it to even. If this reads "1"/"2"/"3"/"0.13" then the
    // implementation has fallen back to Number.toFixed and every coordinate
    // that lands on a tie will be one ulp of the last digit away from KiCad's.
    expect(fixed(0.5, 0)).toBe('0');
    expect(fixed(1.5, 0)).toBe('2');
    expect(fixed(2.5, 0)).toBe('2');
    expect(fixed(0.125, 2)).toBe('0.12');
    expect(fixed(0.375, 2)).toBe('0.38');
  });

  it('keeps the sign of a negative zero and of a value that rounds to zero', () => {
    // printf("%.4f", -0.0) is "-0.0000"; toFixed drops the sign. A stroke width
    // or a translate() that lost its minus would mirror the wrong way.
    expect(fixed(-0, 4)).toBe('-0.0000');
    expect(fixed(-0.00001, 4)).toBe('-0.0000');
    expect(fixed(0, 4)).toBe('0.0000');
  });

  it('pads the integer part and honours the requested digit count', () => {
    // Six decimals is the bare {:f} used by <rect>, <image> and rotate();
    // four is m_precision. Confusing the two silently changes every rectangle.
    expect(fixed(2.5, 6)).toBe('2.500000');
    expect(fixed(2.5, 4)).toBe('2.5000');
    expect(fixed(0.04, 6)).toBe('0.040000');
    expect(fixed(297.0022, 4)).toBe('297.0022');
  });

  it('spells the non-finite values the way fmt does', () => {
    expect(fixed(Number.NaN, 4)).toBe('nan');
    expect(fixed(Number.POSITIVE_INFINITY, 4)).toBe('inf');
    expect(fixed(Number.NEGATIVE_INFINITY, 4)).toBe('-inf');
  });
});

describe('helpers', () => {
  it('formats colours as uppercase hex padded to six digits', () => {
    // fmt's {:06X}. Lowercase or an unpadded value produces a colour Inkscape
    // silently reads as a different one.
    expect(hex6(0)).toBe('000000');
    expect(hex6(0xff00)).toBe('00FF00');
    expect(hex6(0x7f0000)).toBe('7F0000');
  });

  it('base64-encodes without padding, as KiCad core does', () => {
    // KiCad's encoder emits 2 or 3 characters for a 1- or 2-byte tail and never
    // writes '='. btoa pads, so an image href produced with btoa would not be
    // byte-identical to KiCad's.
    expect(base64Encode(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(base64Encode(new Uint8Array([77, 97]))).toBe('TWE');
    expect(base64Encode(new Uint8Array([77]))).toBe('TQ');
    expect(base64Encode(new Uint8Array([]))).toBe('');
  });

  it('escapes the four XML characters and leaves the apostrophe alone', () => {
    // XmlEsc escapes CR in both modes but the quote only as an attribute, and
    // never the apostrophe. Over-escaping would corrupt a <title> body.
    expect(XmlEsc('a<b>c&d\re"f\'g')).toBe('a&lt;b&gt;c&amp;d&#xD;e"f\'g');
    expect(XmlEsc('e"f\tg\nh', true)).toBe('e&quot;f&#x9;g&#xA;h');
  });

  it('rounds the bold pen width rather than truncating it', () => {
    // GetPenSizeForBold is KiROUND(size / 5.0): 1500/5 is exact, 1502/5 is not.
    expect(GetPenSizeForBold(1500)).toBe(300);
    expect(GetPenSizeForBold(1502)).toBe(300);
    expect(GetPenSizeForBold(1503)).toBe(301);
  });

  it('formats the ISO 8601 stamp as local time with a T separator', () => {
    expect(GetISO8601CurrentDateTime(new Date(2026, 7, 4, 9, 5, 3))).toBe('2026-08-04T09:05:03');
  });
});

describe('SetViewport and the document header', () => {
  it('rounds A4 to 297.0022 mm, because the page is measured in whole mils', () => {
    // A4 is 11693 mils, not 11692.913, so every KiCad SVG of an A4 board says
    // 297.0022 mm. Deriving the width from millimetres instead would print a
    // clean 297.0000 and diverge from every file KiCad has ever written.
    const svg = plotter().text();

    expect(svg).toContain('  width="297.0022mm" height="210.0072mm"');
    expect(svg).toContain('viewBox="0.0000 0.0000 297.0022 210.0072">');
  });

  it('truncates fractional page mils into whole mils before scaling', () => {
    // PAGE_INFO::SetWidthMM stores mils as a double, so a user page really can
    // arrive fractional; m_paperSize is a VECTOR2I and the assignment truncates.
    // Keeping the fraction would turn 209.9818 mm into a clean 210.
    const p = new SvgPlotter(svgRenderSettings());
    p.SetPageSettings({ x: (210 * 1000) / 25.4, y: (297 * 1000) / 25.4 });
    p.SetViewport({ x: 0, y: 0 }, 2540, 1, false);
    p.StartPlot('', new Date(2026, 0, 2, 3, 4, 5));

    expect(p.text()).toContain('  width="209.9818mm" height="296.9768mm"');
  });

  it('opens a group the first primitive is expected to close', () => {
    // StartPlot leaves m_graphics_changed true on purpose. If the header group
    // were emitted clean, EndPlot's single </g> would leave the document
    // unbalanced.
    const p = plotter();

    expect(p.text()).toContain(
      '<g style="fill:#000000; fill-opacity:1.0000;stroke:#000000; stroke-opacity:1.0000;\n' +
        'stroke-linecap:round; stroke-linejoin:round;"\n' +
        ' transform="translate(0 0) scale(1 1)">\n',
    );

    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, MM);
    p.EndPlot();

    // One header group, one style group, one close each.
    expect(p.text().split('<g ').length - 1).toBe(2);
    expect(p.text().split('</g>').length - 1).toBe(2);
    expect(p.text().endsWith('</g> \n</svg>\n')).toBe(true);
  });

  it('escapes the title and the creator and uses the file base name', () => {
    const p = new SvgPlotter(svgRenderSettings());
    p.OpenFile('/home/plots/a&b<c>.svg');
    p.SetCreator('Ziro & Co');
    p.SetPageSettings(A4_MILS);
    p.SetViewport({ x: 0, y: 0 }, 2540, 1, false);
    p.StartPlot('', new Date(2026, 0, 2, 3, 4, 5));

    expect(p.text()).toContain(
      '<title>SVG Image created as a&amp;b&lt;c&gt;.svg date 2026-01-02T03:04:05 </title>\n',
    );
    expect(p.text()).toContain('  <desc>Image generated by Ziro &amp; Co </desc>\n');
  });
});

describe('coordinates', () => {
  it('leaves Y unflipped, because the reversed axis cancels the paper flip', () => {
    // A point 2 mm down the page must land at y = 2, not at 208.0072. Dropping
    // either half of the double flip inverts every plot.
    const p = plotter();
    p.MoveTo({ x: 3 * MM, y: 2 * MM });

    expect(body(p)).toContain('<path d="M3.0000 2.0000\n');
  });

  it('mirrors X about the paper width and leaves Y alone', () => {
    const p = plotter({ mirror: true });
    p.MoveTo({ x: 3 * MM, y: 2 * MM });

    expect(body(p)).toContain('<path d="M294.0022 2.0000\n');
  });

  it('subtracts the plot offset before scaling', () => {
    const p = plotter({ offset: { x: 1 * MM, y: 1 * MM }, scale: 2 });
    p.MoveTo({ x: 3 * MM, y: 2 * MM });

    expect(body(p)).toContain('<path d="M4.0000 2.0000\n');
  });
});

describe('colour', () => {
  it('truncates the channels rather than rounding them', () => {
    // 255 * 0.5 is 127.5 and emitSetRGBColor casts, so the pen is 7F. Rounding
    // would shift every mid-tone by one and change the emitted hex.
    const p = plotter();
    p.SetColor({ r: 0.5, g: 1, b: 0, a: 1 });
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, MM);

    expect(body(p)).toContain('stroke:#7FFF00;');
  });

  it('collapses everything but exact white to black in mono mode', () => {
    // The B&W branch keeps two colours so pcbnew can draw white holes on black
    // pads; anything else, alpha included in the comparison, becomes black.
    const p = plotter({ colorMode: false });
    p.SetColor(rgb(255, 255, 255));
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.FILLED_SHAPE, MM);

    expect(body(p)).toContain('fill:#FFFFFF;');

    const q = plotter({ colorMode: false });
    q.SetColor({ ...COLOR4D_WHITE, a: 0.5 });
    q.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.FILLED_SHAPE, MM);

    // Alpha 0.5 makes it "not white", so it goes black *and* opaque.
    expect(body(q)).toContain('fill:#000000; fill-opacity:1.0000;');
  });

  it('uses one triple for pen and brush but only fills carry the alpha', () => {
    const p = plotter();
    p.SetColor(rgb(0x12, 0x34, 0x56, 0.25));
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.FILLED_SHAPE, MM);

    expect(body(p)).toContain('fill:#123456; fill-opacity:0.2500; ');
    expect(body(p)).toContain('stroke:#123456; stroke-width:1.0000; stroke-opacity:1; ');
  });
});

describe('the graphics context', () => {
  it('emits dash lengths at m_precision but dot lengths at six decimals', () => {
    // DASH alone uses {:.{}f}; DOT, DASHDOT and DASHDOTDOT use a bare {:f}. A
    // single shared formatter would normalise all four to the same width.
    const p = plotter();
    p.SetDash(0, LINE_STYLE.DASH);
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, 200_000);

    expect(body(p)).toContain('stroke-dasharray:2.2000,0.8000;');

    const q = plotter();
    q.SetDash(0, LINE_STYLE.DOT);
    q.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, 200_000);

    expect(body(q)).toContain('stroke-dasharray:0.040000,0.800000;');
  });

  it('recomputes the dash geometry from the primitive width, not SetDash s', () => {
    // SetDash discards its width argument entirely; the numbers come from
    // whatever width reaches setSVGPlotStyle.
    const p = plotter();
    p.SetDash(999_999_999, LINE_STYLE.DASH);
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, 100_000);

    expect(body(p)).toContain('stroke-dasharray:1.1000,0.4000;');
  });

  it('writes stroke:none for a zero pen and skips the dash arm entirely', () => {
    const p = plotter();
    p.SetDash(0, LINE_STYLE.DASH);
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.FILLED_SHAPE, 0);

    expect(body(p)).toContain('stroke:none;');
    expect(body(p)).not.toContain('stroke-dasharray');
  });

  it('treats DO_NOT_SET_LINE_WIDTH as a return, keeping the previous pen', () => {
    // The sentinel must not fall through to an assignment, or the pen resets to
    // -2 and every later primitive comes out with stroke:none.
    const p = plotter();
    p.SetCurrentLineWidth(300_000);
    p.SetCurrentLineWidth(DO_NOT_SET_LINE_WIDTH);

    expect(p.GetCurrentLineWidth()).toBe(300_000);
  });

  it('resolves USE_DEFAULT_LINE_WIDTH through the render settings', () => {
    const p = new SvgPlotter(svgRenderSettings({ defaultPenWidth: 21_200 }));
    p.SetCurrentLineWidth(USE_DEFAULT_LINE_WIDTH);

    expect(p.GetCurrentLineWidth()).toBe(21_200);
  });

  it('only reopens a group when something actually changed', () => {
    // setFillMode and SetDash compare before dirtying, so a redundant call must
    // not cost a group. Two identical circles produce one style group.
    const p = plotter();
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, MM);
    p.SetDash(0, LINE_STYLE.SOLID);
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, MM);

    expect(body(p).split('</g>\n<g ').length - 1).toBe(1);
  });
});

describe('Rect', () => {
  it('normalises in device space and writes six decimals throughout', () => {
    // The corners arrive bottom-right first; without the device-space normalise
    // the width and height come out negative, which is what Inkscape chokes on.
    const p = plotter();
    p.Rect({ x: 2 * MM, y: 3 * MM }, { x: 1 * MM, y: 1 * MM }, FILL_T.NO_FILL, MM);

    expect(body(p)).toContain(
      '<rect x="1.000000" y="1.000000" width="1.000000" height="2.000000" rx="0.000000" />\n',
    );
  });

  it('renormalises in device space once the horizontal mirror flips the width', () => {
    // The user-space box is already positive; it is the mirror that makes
    // size_dev.x negative. Skipping the second normalise emits width="-1.000000",
    // which is exactly the negative extent the upstream comment says Inkscape
    // cannot draw.
    const p = plotter({ mirror: true });
    p.Rect({ x: 1 * MM, y: 1 * MM }, { x: 2 * MM, y: 3 * MM }, FILL_T.NO_FILL, MM);

    expect(body(p)).toContain(
      '<rect x="295.002200" y="1.000000" width="1.000000" height="2.000000" rx="0.000000" />\n',
    );
  });

  it('degrades a zero-sided rectangle to a line at m_precision', () => {
    // Inkscape does not draw a zero-height rect at all, so upstream swaps in a
    // <line> — and that element uses four decimals, not six.
    const p = plotter();
    p.Rect({ x: 0, y: 0 }, { x: 1 * MM, y: 0 }, FILL_T.NO_FILL, MM);

    expect(body(p)).toContain('<line x1="0.0000" y1="0.0000" x2="1.0000" y2="0.0000" />\n');
  });

  it('scales the corner radius into device units', () => {
    const p = plotter();
    p.Rect({ x: 0, y: 0 }, { x: 2 * MM, y: 2 * MM }, FILL_T.NO_FILL, MM, MM / 2);

    expect(body(p)).toContain('rx="0.500000" />');
  });
});

describe('Circle', () => {
  it('draws a plain circle at half the diameter', () => {
    const p = plotter();
    p.Circle({ x: 1 * MM, y: 2 * MM }, 3 * MM, FILL_T.NO_FILL, MM);

    expect(body(p)).toContain('<circle cx="1.0000" cy="2.0000" r="1.5000" /> \n');
  });

  it('halves an odd diameter in doubles, keeping the half IU', () => {
    // `diametre / 2.0` is a double divide, unlike DXF's integer one; a 3 IU
    // circle keeps its 1.5 IU radius. The half only survives above unit plot
    // scale, so this plots at 1000x to make it visible at m_precision.
    const p = plotter({ scale: 1000 });
    p.Circle({ x: 0, y: 0 }, 3, FILL_T.NO_FILL, 1);

    expect(body(p)).toContain('r="0.0015" /> \n');
  });

  it('draws a thin unfilled circle as a stroked ring, not a filled disc', () => {
    // The style is flushed before the branch runs, so switching to FILLED_SHAPE
    // and a zero pen changes nothing about *this* element: it still carries the
    // outer group's fill:none and 0.5 mm stroke, with the radius grown to
    // d/2 + w/2. Reading the code as "switch to filled mode" and emitting a
    // filled disc would be a different picture entirely.
    const p = plotter();
    p.Circle({ x: 0, y: 0 }, 100_000, FILL_T.NO_FILL, 500_000);

    expect(body(p)).toContain('fill:none; ');
    expect(body(p)).toContain('stroke-width:0.5000;');
    expect(body(p)).toContain('<circle cx="0.0000" cy="0.0000" r="0.3000" /> \n');
  });

  it('leaks the filled/zero-pen state on to the next primitive', () => {
    // The state change the thin-circle branch makes takes effect one element
    // late. Clearing it at the end of Circle would silently fix a real bug.
    const p = plotter();
    p.Circle({ x: 0, y: 0 }, 100_000, FILL_T.NO_FILL, 500_000);
    p.Rect({ x: 0, y: 0 }, { x: MM, y: MM }, FILL_T.FILLED_SHAPE, 0);

    const groups = body(p).split('</g>\n<g ');
    expect(groups).toHaveLength(3);
    expect(groups[2]).toContain('fill:#000000; fill-opacity:1.0000; stroke:none;');
  });
});

describe('Arc', () => {
  it('negates the start angle and orders the pair counter-clockwise', () => {
    // Start 0, sweep 90 gives start 0 / end -90, which swaps: the path runs
    // from the -90 point to the 0 point.
    const p = plotter();
    p.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 2 * MM, FILL_T.NO_FILL, MM);

    expect(body(p)).toContain('<path d="M0.0000 2.0000 A2.0000 2.0000 0.0 0 0 2.0000 0.0000" />\n');
  });

  it('sets the large-arc flag only above 180 degrees, never the sweep flag', () => {
    // A semicircle is exactly PI, and the test is strict, so it stays small.
    const p = plotter();
    p.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(180), MM, FILL_T.NO_FILL, MM);
    expect(body(p)).toContain('0.0 0 0');

    const q = plotter();
    q.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(270), MM, FILL_T.NO_FILL, MM);
    expect(body(q)).toContain('0.0 1 0');
  });

  it('emits the pie wedge and the stroked arc as two separate paths', () => {
    // A filled arc is drawn twice: once as a wedge with a zero pen, once as an
    // unfilled stroke. Emitting one path with both attributes would fill the
    // chord as well as the wedge.
    const p = plotter();
    p.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 2 * MM, FILL_T.FILLED_SHAPE, MM);

    const paths = body(p).match(/<path d="M[^"]*"/g) ?? [];
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('L 0.0000 0.0000 Z');
    expect(paths[1]).not.toContain('Z');
  });

  it('turns a non-positive radius into a circle whose diameter is the WIDTH', () => {
    // Circle(aCenter, aWidth, ...) really does pass the width into the diameter
    // slot, so a 1 mm pen gives a 0.5 mm radius, not 1 mm.
    const p = plotter();
    p.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 0, FILL_T.NO_FILL, MM);

    expect(body(p)).toContain('<circle cx="0.0000" cy="0.0000" r="0.5000" /> \n');
  });

  it('truncates a fractional centre into integer IU before transforming it', () => {
    // The centre is a VECTOR2D and userToDeviceCoordinates takes a VECTOR2I, so
    // C++ truncates towards zero on the way in; KiROUND would round 1900.7 up to
    // 1901. Sub-IU differences only show above unit plot scale, hence the 1000.
    const p = plotter({ scale: 1000 });
    p.Arc({ x: 1900.7, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), MM, FILL_T.FILLED_SHAPE, MM);

    expect(body(p)).toContain('L 1.9000 0.0000 Z');
  });

  it('derives the centre and radius from three points', () => {
    // The triple sits on a 1 mm circle centred at (2,2), so the emitted radii
    // and endpoints pin CalcArcCenter, the det sign and the sweep normalisation
    // together — a wrong centre moves both endpoints.
    const p = plotter();
    p.ArcThroughPoints(
      { x: 1 * MM, y: 2 * MM },
      { x: 2 * MM, y: 3 * MM },
      { x: 3 * MM, y: 2 * MM },
      FILL_T.NO_FILL,
      MM / 10,
    );

    expect(body(p)).toContain('<path d="M1.0000 2.0000 A1.0000 1.0000 0.0 0 0 3.0000 2.0000" />');
  });

  it('erases the direction, because flg_sweep is hard-coded to zero', () => {
    // Reversing the triple flips det, the sweep sign and the start/end swap —
    // and every one of those cancels, so the two arcs are byte-identical. The
    // sweep flag is the only thing that could have distinguished them and it is
    // a constant 0.
    const forwards = plotter();
    forwards.ArcThroughPoints(
      { x: 1 * MM, y: 2 * MM },
      { x: 2 * MM, y: 3 * MM },
      { x: 3 * MM, y: 2 * MM },
      FILL_T.NO_FILL,
      MM / 10,
    );

    const backwards = plotter();
    backwards.ArcThroughPoints(
      { x: 3 * MM, y: 2 * MM },
      { x: 2 * MM, y: 3 * MM },
      { x: 1 * MM, y: 2 * MM },
      FILL_T.NO_FILL,
      MM / 10,
    );

    expect(body(backwards)).toBe(body(forwards));
  });
});

describe('PlotPoly', () => {
  it('stops one vertex short and closes with Z when the ring is closed', () => {
    // The loop is `ii < size - 1`; a naive `ii < size` writes the closing
    // vertex and then Z, duplicating it.
    const p = plotter();
    p.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: MM, y: 0 },
        { x: MM, y: MM },
        { x: 0, y: 0 },
      ],
      FILL_T.FILLED_SHAPE,
      MM,
    );

    expect(body(p)).toContain('d="M 0.0000,0.0000\n1.0000,0.0000\n1.0000,1.0000\nZ" /> \n');
  });

  it('writes the last vertex out when the ring is open', () => {
    const p = plotter();
    p.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: MM, y: 0 },
        { x: MM, y: MM },
      ],
      FILL_T.NO_FILL,
      MM,
    );

    expect(body(p)).toContain('d="M 0.0000,0.0000\n1.0000,0.0000\n1.0000,1.0000\n" /> \n');
  });

  it('styles from the raw width, so a sentinel width yields stroke:none', () => {
    // SetCurrentLineWidth resolves the sentinel for the pen, but setSVGPlotStyle
    // is handed aWidth untouched, and userToDeviceSize(-1) is negative.
    const p = plotter({ defaultPenWidth: MM });
    p.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: MM, y: 0 },
      ],
      FILL_T.NO_FILL,
      USE_DEFAULT_LINE_WIDTH,
    );

    expect(p.GetCurrentLineWidth()).toBe(MM);
    expect(body(p)).toContain('stroke:none;');
  });

  it('puts the style inline on the path and leaves the context dirty', () => {
    // aIsGroup is false, so no group is opened and m_graphics_changed is not
    // cleared: the style attribute sits directly between `<path ` and `d=`, and
    // the *next* primitive still has to open a group of its own. Asking for a
    // group style here would splice `</g><g …>` into the middle of the element.
    for (const fill of [FILL_T.NO_FILL, FILL_T.FILLED_SHAPE]) {
      const p = plotter();
      p.PlotPoly(
        [
          { x: 0, y: 0 },
          { x: MM, y: 0 },
        ],
        fill,
        MM,
      );
      p.SetDash(0, LINE_STYLE.DASH);
      p.MoveTo({ x: 0, y: 0 });

      expect(body(p)).toMatch(/^<path style="[^"]*"\nd="M /);
      expect(body(p)).toContain('</g>\n<g style="');
    }
  });

  it('emits a hatch fill colour and lets the appended fill:none override it', () => {
    // HATCH is not in setSVGPlotStyle's opacity switch, so it prints
    // fill:#RRGGBB with no fill-opacity, and only CSS source order hides it.
    // Short-circuiting hatch to NO_FILL would drop the colour entirely.
    const p = plotter();
    p.PlotPoly(
      [
        { x: 0, y: 0 },
        { x: MM, y: 0 },
      ],
      FILL_T.HATCH,
      MM,
    );

    const style = body(p).slice(0, body(p).indexOf('d="M'));
    expect(style).toContain('fill:#000000; ');
    expect(style).not.toContain('fill-opacity');
    expect(style.indexOf('fill:none')).toBeGreaterThan(style.indexOf('fill:#000000'));
  });

  it('ignores a list of one point or fewer', () => {
    const p = plotter();
    p.PlotPoly([{ x: 0, y: 0 }], FILL_T.NO_FILL, MM);

    expect(body(p)).toBe('');
  });
});

describe('PenTo', () => {
  it('emits a lineto for a pen-up move inside an open path', () => {
    // There is no mid-path moveto in SVG_PLOTTER: a 'U' while a path is open
    // draws. Two shapes need an explicit PenFinish between them.
    const p = plotter();
    p.MoveTo({ x: 0, y: 0 });
    p.MoveTo({ x: MM, y: MM });

    expect(body(p)).toContain('<path d="M0.0000 0.0000\nL1.0000 1.0000\n');
  });

  it('parks the pen at (-1,-1) on Z so the next move opens a fresh path', () => {
    const p = plotter();
    p.MoveTo({ x: 0, y: 0 });
    p.FinishTo({ x: MM, y: 0 });
    p.MoveTo({ x: 2 * MM, y: 0 });

    expect(body(p)).toContain('L1.0000 0.0000\n" />\n<path d="M2.0000 0.0000\n');
  });

  it('drops a repeated lineto to the position the pen already holds', () => {
    const p = plotter();
    p.MoveTo({ x: 0, y: 0 });
    p.LineTo({ x: MM, y: 0 });
    p.LineTo({ x: MM, y: 0 });

    expect(body(p).match(/L1\.0000 0\.0000/g)).toHaveLength(1);
  });

  it('forces NO_FILL when opening a path, so an open contour is never filled', () => {
    const p = plotter();
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.FILLED_SHAPE, MM);
    p.MoveTo({ x: 0, y: 0 });

    const groups = body(p).split('</g>\n<g ');
    expect(groups[2]).toContain('fill:none; ');
  });

  it('does nothing for a Z while the pen is already at rest', () => {
    const p = plotter();
    p.PenFinish();

    expect(body(p)).toBe('');
  });
});

describe('layers and blocks', () => {
  it('flushes a pending style before opening the layer group', () => {
    // Otherwise the layer group nests inside a half-written context.
    const p = plotter();
    p.StartLayer('F.Cu');

    expect(body(p)).toBe(
      '</g>\n<g style="fill:none; stroke:none;">\n' +
        '<g id="F.Cu" inkscape:label="F.Cu" inkscape:groupmode="layer">\n',
    );
  });

  it('does not escape the layer name', () => {
    // Upstream has no caller, so nobody has noticed that an ampersand makes the
    // document invalid. Escaping it here would be a fix, not a port.
    const p = plotter();
    p.StartLayer('A&B');

    expect(body(p)).toContain('<g id="A&B" inkscape:label="A&B"');
  });

  it('closes two groups and dirties the context on EndLayer', () => {
    // The circles either side are identical, so nothing else can dirty the
    // context: the second one only reopens a group because EndLayer forced it.
    // Without that the document would be one `</g>` short.
    const p = plotter();
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, MM);
    p.StartLayer('F.Cu');
    p.EndLayer();
    p.Circle({ x: 0, y: 0 }, 2 * MM, FILL_T.NO_FILL, MM);

    expect(body(p)).toContain('</g>\n</g>\n</g>\n<g style="');
  });

  it('emits nothing at all for a block', () => {
    // <g> is spoken for by the lazy graphics context, so blocks are deliberately
    // no-ops rather than nested groups.
    const p = plotter();
    p.StartBlock({});
    p.EndBlock(null);

    expect(body(p)).toBe('');
  });
});

describe('PlotImage', () => {
  it('breaks the base64 payload every 64 characters and never pads it', () => {
    const png = new Uint8Array(100);
    for (let i = 0; i < png.length; i++) png[i] = i;

    const image: SvgImage = {
      GetWidth: () => 10,
      GetHeight: () => 10,
      SaveFilePng: () => png,
      ConvertToGreyscale: () => image,
    };

    const p = plotter();
    p.PlotImage(image, { x: 5 * MM, y: 5 * MM }, MM / 10);

    const href = body(p).slice(body(p).indexOf('base64,') + 'base64,'.length);
    const payload = href.slice(0, href.indexOf('"\n'));

    expect(payload).not.toContain('=');
    // 100 bytes encode to 134 characters, so exactly two newlines land inside.
    expect(payload.replace(/\n/g, '')).toBe(base64Encode(png));
    expect(payload.split('\n').map((line) => line.length)).toEqual([64, 64, 6]);
  });

  it('places the image at the truncated top-left corner and sizes it in mm', () => {
    const image: SvgImage = {
      GetWidth: () => 10,
      GetHeight: () => 10,
      SaveFilePng: () => new Uint8Array([1, 2, 3]),
      ConvertToGreyscale: () => image,
    };

    const p = plotter();
    p.PlotImage(image, { x: 5 * MM, y: 5 * MM }, MM / 10);

    // 10 px at 0.1 mm per px is 1 mm square, so the corner is at 4.5 mm.
    expect(body(p)).toContain('<image x="4.500000" y="4.500000"');
    expect(body(p)).toContain('preserveAspectRatio="none" width="1.0000" height="1.0000" />');
  });

  it('greyscales the source in mono mode instead of reusing the colour bytes', () => {
    const grey = new Uint8Array([9, 9, 9]);
    const image: SvgImage = {
      GetWidth: () => 10,
      GetHeight: () => 10,
      SaveFilePng: () => new Uint8Array([1, 2, 3]),
      ConvertToGreyscale: () => ({ ...image, SaveFilePng: () => grey }),
    };

    const p = plotter({ colorMode: false });
    p.PlotImage(image, { x: 5 * MM, y: 5 * MM }, MM / 10);

    expect(body(p)).toContain(`base64,${base64Encode(grey)}`);
  });

  it('falls back to the base class rectangle for a zero-sized image', () => {
    const image: SvgImage = {
      GetWidth: () => 0,
      GetHeight: () => 10,
      SaveFilePng: () => new Uint8Array([1]),
      ConvertToGreyscale: () => image,
    };

    const p = plotter({ defaultPenWidth: MM });
    p.PlotImage(image, { x: 5 * MM, y: 5 * MM }, MM / 10);

    expect(body(p)).not.toContain('<image');
    expect(body(p)).toContain('<line x1="5.0000" y1="4.5000" x2="5.0000" y2="5.5000" />\n');
  });
});

describe('Text', () => {
  it('writes the string twice: hidden for search, then stroked for ink', () => {
    const p = plotter();
    p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'AB', attributes(), stubFont());

    const out = body(p);
    expect(out).toContain('opacity="0" stroke-opacity="0">AB</text>\n');
    expect(out).toContain('<g class="stroked-text"><desc>AB</desc>\n');
    expect(out.endsWith('</g>')).toBe(true);
    // One <path> per glyph segment, because the callback finishes each stroke.
    expect(out.match(/<path d="M/g)).toHaveLength(2);
  });

  it('derives the em size from the text WIDTH, four thirds of aSize.x', () => {
    // text_size.y is |aSize.x * 4 / 3|, not aSize.y — and the arithmetic is
    // integer, so 1000 gives 1333 and not 1333.33.
    const p = plotter();
    p.PlotText(
      { x: 0, y: 0 },
      rgb(0, 0, 0),
      'AB',
      attributes({ m_Size: { x: 1000, y: 9000 } }),
      stubFont(),
    );

    expect(body(p)).toContain('font-size="0.0013"');
  });

  it('pivots the rotation on the anchor while the text sits at the justified pos', () => {
    // The <g> rotates about the original position and prints its angle with six
    // decimals, negated; the <text> x/y are the vertically justified position at
    // four. Conflating the two positions skews rotated centred text.
    const p = plotter();
    p.PlotText(
      { x: 2 * MM, y: 4 * MM },
      rgb(0, 0, 0),
      'A',
      attributes({ m_Angle: new EDA_ANGLE(30), m_Valign: GR_TEXT_V_ALIGN_T.TOP }),
      stubFont(),
    );

    expect(body(p)).toContain('<g transform="rotate(-30.000000 2.0000 4.0000)">\n');
    expect(body(p)).toContain('<text x="2.0000" y="4.0015"\n');
  });

  it('omits the rotate group for a zero angle', () => {
    const p = plotter();
    p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'A', attributes(), stubFont());

    expect(body(p)).not.toContain('rotate(');
  });

  it('mirrors on the XOR of the plot mirror and the negative size', () => {
    // A mirrored string on a mirrored plot is upright again, so the scale(-1 1)
    // must not appear. Testing either flag alone would miss that.
    const mirroredText = plotter();
    mirroredText.PlotText(
      { x: 2 * MM, y: 0 },
      rgb(0, 0, 0),
      'A',
      attributes({ m_Mirrored: true }),
      stubFont(),
    );
    expect(body(mirroredText)).toContain('transform="scale(-1 1) translate(-4.000000 0)"\n');

    const both = plotter({ mirror: true });
    both.PlotText(
      { x: 2 * MM, y: 0 },
      rgb(0, 0, 0),
      'A',
      attributes({ m_Mirrored: true }),
      stubFont(),
    );
    expect(body(both)).not.toContain('scale(-1 1)');

    const plotOnly = plotter({ mirror: true });
    plotOnly.PlotText({ x: 2 * MM, y: 0 }, rgb(0, 0, 0), 'A', attributes(), stubFont());
    expect(body(plotOnly)).toContain('scale(-1 1)');
  });

  it('shifts the baseline by half the height when centred, by all of it on top', () => {
    const centred = plotter();
    centred.PlotText(
      { x: 0, y: 0 },
      rgb(0, 0, 0),
      'A',
      attributes({ m_Size: { x: 1500, y: 1501 }, m_Valign: GR_TEXT_V_ALIGN_T.CENTER }),
      stubFont(),
    );
    // 1501 / 2 truncates to 750, not 750.5.
    expect(body(centred)).toContain('<text x="0.0000" y="0.0008"\n');

    const top = plotter();
    top.PlotText(
      { x: 0, y: 0 },
      rgb(0, 0, 0),
      'A',
      attributes({ m_Size: { x: 1500, y: 1501 }, m_Valign: GR_TEXT_V_ALIGN_T.TOP }),
      stubFont(),
    );
    expect(body(top)).toContain('<text x="0.0000" y="0.0015"\n');
  });

  it('maps the horizontal justification onto the SVG text anchors', () => {
    const p = plotter();
    p.PlotText(
      { x: 0, y: 0 },
      rgb(0, 0, 0),
      'A',
      attributes({ m_Halign: GR_TEXT_H_ALIGN_T.CENTER }),
      stubFont(),
    );
    expect(body(p)).toContain('text-anchor="middle"');

    const right = plotter();
    right.PlotText(
      { x: 0, y: 0 },
      rgb(0, 0, 0),
      'A',
      attributes({ m_Halign: GR_TEXT_H_ALIGN_T.RIGHT }),
      stubFont(),
    );
    expect(body(right)).toContain('text-anchor="end"');
  });

  it('applies the bold default width only when the caller passed zero', () => {
    // PLOTTER::Text substitutes size/5 for a zero width on bold text, and that
    // width is what the glyph strokes are drawn with.
    const p = plotter();
    p.PlotText(
      { x: 0, y: 0 },
      rgb(0, 0, 0),
      'A',
      attributes({ m_Bold: true, m_Size: { x: 1500, y: 1500 } }),
      stubFont(),
    );

    expect(p.GetCurrentLineWidth()).toBe(300);
  });

  it('stores a negative pen width, then takes its magnitude for the glyphs', () => {
    // Upstream only wxASSERTs on a negative width, so it is stored and the
    // intervening style comes out with stroke:none; PLOTTER::Text then negates
    // it for the strokes. Rejecting the value outright would abort the plot.
    const p = plotter();
    p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'A', attributes({ m_StrokeWidth: -400 }), stubFont());

    expect(body(p)).toContain('stroke:none;');
    expect(p.GetCurrentLineWidth()).toBe(400);
  });

  it('escapes the string in both the hidden text and the desc', () => {
    const p = plotter();
    p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'a<b', attributes(), stubFont());

    expect(body(p)).toContain('>a&lt;b</text>');
    expect(body(p)).toContain('<desc>a&lt;b</desc>');
  });

  it('refuses to guess a font rather than substituting the stroke font', () => {
    const p = plotter();
    expect(() => p.PlotText({ x: 0, y: 0 }, rgb(0, 0, 0), 'A', attributes(), null)).toThrow(
      /font/i,
    );
  });
});
