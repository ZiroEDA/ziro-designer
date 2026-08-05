// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, expect, it, vi } from 'vitest';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  type Color4d,
  COLOR4D_WHITE,
  DO_NOT_SET_LINE_WIDTH,
  encodeByteString,
  encodeStringForPlotter,
  EscapeJsString,
  FILL_T,
  fixed,
  formatG,
  IsGotoPageHref,
  LINE_STYLE,
  NormalizeFileUri,
  type PdfDeflate,
  type PdfImage,
  PdfPlotter,
  pdfCreationDate,
  pdfRenderSettings,
  USE_DEFAULT_LINE_WIDTH,
  WriteImageSMaskStream,
  WriteImageStream,
} from '@ziroeda/pcbnew/src/plot_pdf.js';

/** A4 landscape in mils, i.e. what PAGE_INFO::GetSizeMils() hands SetPageSettings. */
const A4_MILS = { x: 11693, y: 8268 };

/** One decimil in IU at pcbnew's 2540, so a device unit is a round number. */
const DECIMIL = 2540;

/** A4's height in decimils: the y every unmirrored device coordinate counts down from. */
const PAGE_TOP = 82680;

/**
 * A stand-in for `wxZlibOutputStream` that brackets its input instead of
 * compressing it. Two properties matter: the output is two bytes longer than
 * the input, so a test can tell a deferred `/Length` that reports the
 * *compressed* size from one that reports the plaintext size; and it stays
 * readable, so a stream's whole contents can be asserted as prose.
 */
const brace: PdfDeflate = (aBytes) => {
  const out = new Uint8Array(aBytes.length + 2);

  out[0] = 0x7b; // {
  out.set(aBytes, 1);
  out[aBytes.length + 1] = 0x7d; // }

  return out;
};

/** The graphics state StartPage lays down before any primitive runs. */
const CTM_LINE = '0.0072 0 0 0.0072 0 0 cm 1 J 1 j 0 0 0 rg 0 0 0 RG 0 w\n';

/** A fixed clock, so /CreationDate does not move under the golden assertions. */
const NOW = new Date(2026, 0, 2, 3, 4, 5);

interface PlotterOpts {
  colorMode?: boolean;
  mirror?: boolean;
  defaultPenWidth?: number;
  scale?: number;
  offset?: { x: number; y: number };
  background?: Color4d;
  debugPdfWriter?: boolean;
  deflate?: PdfDeflate;
  project?: { ResolveUriByEnvVars(aUri: string): string };
  start?: boolean;
}

/** A plotter wired the way pcbnew wires one: A4, 2540 IU per decimil, colour on. */
function plotter(opts: PlotterOpts = {}): PdfPlotter {
  const p = new PdfPlotter(
    pdfRenderSettings({
      defaultPenWidth: opts.defaultPenWidth ?? 0,
      backgroundColor: opts.background,
    }),
    opts.deflate ?? brace,
    { debugPdfWriter: opts.debugPdfWriter, project: opts.project },
  );

  p.OpenFile('/home/plots/board.pdf');
  p.SetCreator('ZiroEDA');
  p.SetPageSettings(A4_MILS);
  p.SetColorMode(opts.colorMode ?? true);
  p.SetViewport(opts.offset ?? { x: 0, y: 0 }, 2540, opts.scale ?? 1, opts.mirror ?? false);

  if (opts.start !== false) p.StartPlot('1');

  return p;
}

/** The offsets the trailer's cross-reference table claims for each object. */
function xrefOffsets(aText: string): number[] {
  const start = aText.lastIndexOf('\nxref\n');
  const lines = aText.slice(start + 1).split('\n');
  const count = Number(lines[1]!.split(' ')[1]);
  const offsets: number[] = [];

  for (let i = 0; i < count; i++) offsets.push(Number(lines[2 + i]!.slice(0, 10)));

  return offsets;
}

/**
 * Object `n`, found the only way a PDF reader can find it: by seeking to the
 * byte the xref table names. Every assertion built on this therefore fails if
 * an offset is wrong, not only if the object's text is.
 */
function objectAt(aText: string, n: number): string {
  const offset = xrefOffsets(aText)[n]!;
  const end = aText.indexOf('endobj\n', offset);

  return aText.slice(offset, end + 'endobj\n'.length);
}

/**
 * The first page's content stream, less its first line — which StartPage always
 * fills with the default graphics state, whatever the default pen width is.
 */
function stream(p: PdfPlotter): string {
  const text = p.text();
  const open = text.indexOf('stream\n{');
  const body = text.slice(open + 'stream\n{'.length, text.indexOf('}\nendstream', open));

  return body.slice(body.indexOf('\n') + 1);
}

/** Draw into page one, then finish the document so the stream can be read back. */
function draw(p: PdfPlotter, aBody: (aPlotter: PdfPlotter) => void): string {
  aBody(p);
  p.EndPlot(NOW);

  return stream(p);
}

/** A wxImage stand-in: a width * height RGB buffer with optional mask and alpha. */
function image(opts: {
  width: number;
  height: number;
  data: number[];
  alpha?: number[];
  mask?: [number, number, number];
  type?: number;
}): PdfImage {
  return {
    GetWidth: () => opts.width,
    GetHeight: () => opts.height,
    GetData: () => Uint8Array.from(opts.data),
    HasAlpha: () => opts.alpha !== undefined,
    GetAlpha: () => Uint8Array.from(opts.alpha ?? []),
    HasMask: () => opts.mask !== undefined,
    GetMaskRed: () => opts.mask?.[0] ?? 0,
    GetMaskGreen: () => opts.mask?.[1] ?? 0,
    GetMaskBlue: () => opts.mask?.[2] ?? 0,
    GetType: () => opts.type ?? 15,
  };
}

const rgb = (r: number, g: number, b: number, a = 1): Color4d => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a,
});

// ===========================================================================

describe('PdfPlotter file skeleton', () => {
  it('opens with the version line and the four high-bit bytes that mark it binary', () => {
    const p = plotter();
    p.EndPlot(NOW);

    // A viewer sniffs the second line for a byte with bit 7 set to decide the
    // file is binary. UTF-8 encoding these would emit eight bytes, not four,
    // and shift every xref offset in the file.
    expect([...p.bytes().slice(0, 15)]).toEqual([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0a, 0x25, 0x80, 0x81, 0x82, 0x83, 0x0a,
    ]);
  });

  it('reserves the page tree, the two resource dictionaries and the JS names first', () => {
    const p = plotter();
    p.EndPlot(NOW);

    const text = p.text();

    // StartPlot allocates 1..4 before writing anything, so the page content
    // stream is always object 5 and its deferred length always object 6. Every
    // page dictionary in the file refers to 1, 2 and 3 by those numbers.
    expect(text).toContain('5 0 obj\n<< /Length 6 0 R /Filter /FlateDecode >>\nstream\n');
    expect(objectAt(text, 1)).toContain('/Type /Pages');
    expect(objectAt(text, 2)).toBe('2 0 obj\n<<\n>>\nendobj\n');
    expect(objectAt(text, 3)).toBe('3 0 obj\n<<\n\n>>\nendobj\n');
    expect(objectAt(text, 4)).toContain('/JavaScript');
  });

  it('writes a page dictionary that names the reserved objects and the media box', () => {
    const p = plotter();
    p.EndPlot(NOW);

    // The whole object, because a PDF page is only openable if every one of
    // these keys is present and spelled this way. Note the media box is in
    // points: 11693 mils * 0.072.
    expect(objectAt(p.text(), 7)).toBe(
      '7 0 obj\n' +
        '<<\n' +
        '/Type /Page\n' +
        '/Parent 1 0 R\n' +
        '/Resources <<\n' +
        '    /ProcSet [/PDF /Text /ImageC /ImageB]\n' +
        '    /Font 2 0 R\n' +
        '    /XObject 3 0 R >>\n' +
        '/MediaBox [0 0 841.896 595.296]\n' +
        '/Contents 5 0 R\n' +
        '>>\n' +
        'endobj\n',
    );
  });

  it('describes the document in the info dictionary, defaulting the title to the file name', () => {
    const p = plotter();
    p.EndPlot(NOW);

    // The colon-separated date is not PDF date syntax; it is what
    // fmt::format( "D:{:%Y:%m:%d:%H:%M:%S}" ) produces and viewers show raw.
    expect(objectAt(p.text(), 10)).toBe(
      '10 0 obj\n' +
        '<<\n' +
        '/Producer (KiCad PDF)\n' +
        '/CreationDate (D:2026:01:02:03:04:05)\n' +
        '/Creator (ZiroEDA)\n' +
        '/Title (board.pdf)\n' +
        '/Author ()\n' +
        '/Subject ()\n' +
        '>>\n' +
        'endobj\n',
    );
  });

  it('keeps an explicit title, author and subject instead of the file name', () => {
    const p = plotter({ start: false });

    p.SetTitle('Main board');
    p.SetAuthor('A. Plotter');
    p.SetSubject('rev C');
    p.StartPlot('1');
    p.EndPlot(NOW);

    // SetTitle wins because the fallback only fires on an empty title; losing
    // that test would silently overwrite every caller-supplied title.
    expect(objectAt(p.text(), 10)).toContain('/Title (Main board)\n/Author (A. Plotter)\n');
    expect(objectAt(p.text(), 10)).toContain('/Subject (rev C)\n');
  });

  it('points the catalog at the outline and the JavaScript names', () => {
    const p = plotter();
    p.EndPlot(NOW);

    expect(objectAt(p.text(), 12)).toBe(
      '12 0 obj\n' +
        '<<\n' +
        '/Type /Catalog\n' +
        '/Pages 1 0 R\n' +
        '/Version /1.5\n' +
        '/PageMode /UseOutlines\n' +
        '/Outlines 11 0 R\n' +
        '/Names 4 0 R\n' +
        '/PageLayout /SinglePage\n' +
        '>>\n' +
        'endobj\n',
    );
  });

  it('ends with an xref table whose every offset really finds its object', () => {
    const p = plotter();

    p.Rect({ x: 0, y: 0 }, { x: 100 * DECIMIL, y: 50 * DECIMIL }, FILL_T.NO_FILL, DECIMIL);
    p.EndPlot(NOW);

    const text = p.text();
    const offsets = xrefOffsets(text);

    // The whole file hangs off these numbers. If a single emit changed length
    // — an extra newline, a UTF-8 expansion — every later object would still
    // be *written* correctly and none of them would be *findable*.
    expect(offsets[0]).toBe(0);

    for (let n = 1; n < offsets.length; n++)
      expect(text.slice(offsets[n]!, offsets[n]! + `${n} 0 obj\n`.length)).toBe(`${n} 0 obj\n`);
  });

  it('formats the free-list head and every xref entry as exactly twenty bytes', () => {
    const p = plotter();
    p.EndPlot(NOW);

    const text = p.text();
    const table = text.slice(text.lastIndexOf('\nxref\n') + '\nxref\n'.length);
    const [count, ...entries] = table.split('\n');

    expect(count).toBe('0 13');
    expect(entries[0]).toBe('0000000000 65535 f ');

    // Twenty bytes per entry including the newline: a reader seeks straight to
    // `xref_start + 20 * n + 20`, so a lost trailing space breaks every lookup.
    for (let n = 1; n < 13; n++) expect(entries[n]).toMatch(/^\d{10} 00000 n $/);
  });

  it('makes startxref the byte offset of the xref keyword itself', () => {
    const p = plotter();

    p.Circle({ x: 10 * DECIMIL, y: 10 * DECIMIL }, 4 * DECIMIL, FILL_T.FILLED_SHAPE, 0);
    p.EndPlot(NOW);

    const text = p.text();
    const startxref = Number(text.slice(text.lastIndexOf('startxref\n') + 10).split('\n')[0]);

    // This is the one offset a reader has no other way to recover.
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    expect(text).toContain(`trailer\n<< /Size 13 /Root 12 0 R /Info 10 0 R >>\n`);
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });

  it('writes objects to the file in a different order from their numbering', () => {
    const p = plotter();
    p.EndPlot(NOW);

    const offsets = xrefOffsets(p.text());

    // Object 9 is the outline entry, allocated during ClosePage but not
    // emitted until after the info dictionary (object 10). That inversion is
    // exactly why the xref table exists, and a port that emitted objects in
    // numeric order would pass every content assertion and still be wrong.
    expect(offsets[9]).toBeGreaterThan(offsets[10]!);
    expect(offsets[1]).toBeGreaterThan(offsets[7]!);
  });
});

describe('PdfPlotter stream length back-patching', () => {
  it('defers the length to an indirect object holding the compressed byte count', () => {
    const p = plotter();
    p.EndPlot(NOW);

    const text = p.text();
    const open = text.indexOf('stream\n') + 'stream\n'.length;
    const close = text.indexOf('\nendstream\n');
    const written = close - open;

    // The dictionary promises `/Length 6 0 R`; object 6 must then report the
    // number of bytes actually written between `stream` and `endstream`, which
    // for a compressed stream is not the length of the page content.
    expect(objectAt(text, 6)).toBe(`6 0 obj\n${written}\n`.concat('endobj\n'));
    expect(written).toBe(CTM_LINE.length + 2);
  });

  it('lets the stream body allocate objects without stealing the length handle', () => {
    const p = plotter();
    const img = image({ width: 1, height: 1, data: [1, 2, 3] });

    p.PlotImage(img, { x: 0, y: 0 }, 1000);
    p.EndPlot(NOW);

    // PlotImage allocates the XObject handle *while* the page stream is open.
    // The length handle was reserved first (6), so the image gets 7 — and the
    // page content refers to /Im7 while object 6 still carries the length.
    expect(stream(p)).toContain('/Im7 Do\n');
    expect(objectAt(p.text(), 6)).toMatch(/^6 0 obj\n\d+\nendobj\n$/);
    expect(objectAt(p.text(), 7)).toContain('/Type /XObject');
  });

  it('writes the stream uncompressed and unfiltered under the debug writer', () => {
    const deflate = vi.fn(brace);
    const p = plotter({ debugPdfWriter: true, deflate });

    p.EndPlot(NOW);

    const text = p.text();

    // The debug path is the only way to read a KiCad PDF in an editor, and it
    // must not leave a /Filter behind claiming the bytes are deflated.
    expect(text).toContain('5 0 obj\n<< /Length 6 0 R >>\nstream\n');
    expect(text).toContain(`stream\n${CTM_LINE}\nendstream\n`);
    expect(objectAt(text, 6)).toBe(`6 0 obj\n${CTM_LINE.length}\nendobj\n`);
    expect(deflate).not.toHaveBeenCalled();
  });

  it('compresses page content but reports the plaintext length nowhere', () => {
    const deflate = vi.fn(brace);
    const p = plotter({ deflate });

    p.EndPlot(NOW);

    expect(deflate).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(deflate.mock.calls[0]![0])).toBe(CTM_LINE);
    expect(objectAt(p.text(), 6)).not.toBe(`6 0 obj\n${CTM_LINE.length}\nendobj\n`);
  });
});

describe('PdfPlotter numeric encoding', () => {
  const encode = (aValue: number): string => plotter().encodeDoubleForPlotter(aValue);

  it('emits the shortest six-significant-digit form for ordinary values', () => {
    // fmt's {:g}: six significant digits with the trailing zeros gone.
    expect(encode(0.0072)).toBe('0.0072');
    expect(encode(841.896)).toBe('841.896');
    expect(encode(1)).toBe('1');
    expect(encode(100000)).toBe('100000');
    expect(encode(0.5)).toBe('0.5');
    expect(encode(-12.25)).toBe('-12.25');
  });

  it('falls back to ten fixed decimals when %g would have used an exponent', () => {
    // PDF syntax has no exponent notation at all: a viewer reading "1e-05"
    // aborts the content stream, which is why the fallback exists.
    expect(encode(1e-5)).toBe('0.00001');
    expect(encode(1234567)).toBe('1234567');
    expect(encode(12345678.5)).toBe('12345678.5');
    expect(encode(1e-11)).toBe('0');
  });

  it('rewrites a negative zero, however it arose', () => {
    // A tiny negative rounds to "-0.0000000000", strips to "-0", and "-0" is
    // then rewritten — the last two steps are separate and both are needed.
    expect(encode(-0)).toBe('0');
    expect(encode(-1e-30)).toBe('0');
    expect(encode(-0.4)).toBe('-0.4');
  });

  it('rounds ties to even on the exact binary value, as printf does', () => {
    // Number.toFixed rounds ties away from zero, so it is not a drop-in.
    expect(fixed(0.5, 0)).toBe('0');
    expect(fixed(1.5, 0)).toBe('2');
    expect(fixed(2.5, 0)).toBe('2');
    expect(fixed(-0, 2)).toBe('-0.00');
  });

  it('decides the %g exponent on the rounded value, not the raw one', () => {
    // 9.999999 has six significant digits only after rounding carries it into
    // the next decade; seeding the exponent from log10 alone would print
    // "10.0000" and put the digit count out by one.
    expect(formatG(9.999999)).toBe('10');
    expect(formatG(999999.5)).toBe('1e+06');
    expect(formatG(0.000123456789)).toBe('0.000123457');
    expect(formatG(0)).toBe('0');
    expect(formatG(-0)).toBe('-0');
  });
});

describe('PdfPlotter graphics state', () => {
  it('promotes a zero pen to one internal unit and emits the operator once', () => {
    const body = draw(plotter(), (p) => {
      p.SetCurrentLineWidth(0);
      p.SetCurrentLineWidth(0);
      p.SetCurrentLineWidth(DECIMIL);
    });

    // A PDF zero-width line is one device pixel however the page is scaled,
    // which is not a plot. The repeat writes nothing because the width did not
    // change; 1 IU is 1/2540 of a decimil.
    expect(body).toBe('0.000393701 w\n1 w\n');
  });

  it('leaves the pen alone for DO_NOT_SET_LINE_WIDTH and resolves the default', () => {
    const p = plotter({ defaultPenWidth: 3 * DECIMIL });
    const body = draw(p, (q) => {
      q.SetCurrentLineWidth(2 * DECIMIL);
      q.SetCurrentLineWidth(DO_NOT_SET_LINE_WIDTH);
      q.SetCurrentLineWidth(USE_DEFAULT_LINE_WIDTH);
    });

    // The sentinel returns before the member is touched, so the following
    // primitive still believes the pen is 2 decimils.
    expect(body).toBe('2 w\n3 w\n');
    expect(p.text()).toContain('0 rg 0 0 0 RG 3 w\n2 w\n');
    expect(p.GetCurrentLineWidth()).toBe(3 * DECIMIL);
  });

  it('sets fill and stroke colour together, pre-blending alpha against white paper', () => {
    const body = draw(plotter(), (p) => {
      p.SetColor(rgb(255, 0, 0));
      p.SetColor(rgb(0, 0, 0, 0.5));
    });

    // There is no change detection here: every SetColor writes both operators.
    // PDF's graphics state has no alpha, so half-transparent black is emitted
    // as mid grey.
    expect(body).toBe('1 0 0 rg 1 0 0 RG\n0.5 0.5 0.5 rg 0.5 0.5 0.5 RG\n');
  });

  it('collapses everything but exact white to black in mono mode', () => {
    const body = draw(plotter({ colorMode: false }), (p) => {
      p.SetColor(COLOR4D_WHITE);
      p.SetColor(rgb(255, 255, 255, 0.5));
      p.SetColor(rgb(200, 30, 30));
    });

    // pcbnew draws holes white on black pads in mono, so the white must
    // survive — but only when the alpha matches too, which the second call
    // fails.
    expect(body).toBe('1 1 1 rg 1 1 1 RG\n0 0 0 rg 0 0 0 RG\n0 0 0 rg 0 0 0 RG\n');
  });

  it('inverts through negative mode and forces the alpha away in mono', () => {
    const colour = plotter();
    colour.SetNegative(true);

    const mono = plotter({ colorMode: false });
    mono.SetNegative(true);

    expect(draw(colour, (p) => p.SetColor(rgb(255, 0, 0)))).toBe('0 1 1 rg 0 1 1 RG\n');
    expect(draw(mono, (p) => p.SetColor(COLOR4D_WHITE))).toBe('0 0 0 rg 0 0 0 RG\n');
  });

  it('truncates each dash element to a whole device unit', () => {
    const body = draw(plotter(), (p) => p.SetDash(10 * DECIMIL, LINE_STYLE.DASHDOTDOT));

    // Dash 11 * w, gap 4 * w, dot 0.2 * w — all in decimils, all truncated, so
    // the dot is 2 and not 2.0.
    expect(body).toBe('[110 40 2 40 2 40] 0 d\n');
  });

  it('truncates a fractional dash element rather than rounding it', () => {
    // Two and a half decimils of pen: the dash lands on 27.5 and the dot on
    // 0.5, both of which round *up*. Truncating is what upstream's `(int)` cast
    // does, and it is what lets a dot collapse to zero and take the whole
    // pattern with it into the solid-line fallback below.
    expect(draw(plotter(), (p) => p.SetDash(2.5 * DECIMIL, LINE_STYLE.DASHDOTDOT))).toBe(
      '[27 10 0 10 0 10] 0 d\n',
    );
    // Every arm builds its own pattern, so each one has to truncate for itself.
    expect(draw(plotter(), (p) => p.SetDash(2.5 * DECIMIL, LINE_STYLE.DASH))).toBe('[27 10] 0 d\n');
    expect(draw(plotter(), (p) => p.SetDash(2.5 * DECIMIL, LINE_STYLE.DOT))).toBe('[0 10] 0 d\n');
    expect(draw(plotter(), (p) => p.SetDash(2.5 * DECIMIL, LINE_STYLE.DASHDOT))).toBe(
      '[27 10 0 10] 0 d\n',
    );
  });

  it('falls back to a solid line when the pattern would sum to zero', () => {
    const body = draw(plotter(), (p) => {
      p.SetDash(0, LINE_STYLE.DASH);
      p.SetDash(DECIMIL, LINE_STYLE.SOLID);
    });

    // A zero-sum dash array makes Acrobat and Evince abandon the rest of the
    // page, so a dotted stroke on a zero-width pen must come out solid. The
    // SOLID case leaves the pattern empty and reaches the same line.
    expect(body).toBe('[] 0 d\n[] 0 d\n');
  });
});

describe('PdfPlotter entities', () => {
  it('draws a rectangle with the native operator and the right paint verb', () => {
    const p1 = { x: 10 * DECIMIL, y: 20 * DECIMIL };
    const p2 = { x: 110 * DECIMIL, y: 70 * DECIMIL };

    const outline = draw(plotter(), (p) => p.Rect(p1, p2, FILL_T.NO_FILL, DECIMIL));
    const both = draw(plotter(), (p) => p.Rect(p1, p2, FILL_T.FILLED_SHAPE, DECIMIL));
    const filled = draw(plotter(), (p) => p.Rect(p1, p2, FILL_T.FILLED_SHAPE, 0));

    // S strokes, B fills *and* strokes, f only fills. The height is negative
    // because the device y axis counts down from the top of the page.
    expect(outline).toBe(`1 w\n10 ${PAGE_TOP - 20} 100 -50 re S\n`);
    expect(both).toBe(`1 w\n10 ${PAGE_TOP - 20} 100 -50 re B\n`);
    // Width 0 still sets a pen — the clamp raises it to one *internal* unit,
    // which is 1/2540 of a device unit — and only then paints with `f`.
    expect(filled).toBe(`0.000393701 w\n10 ${PAGE_TOP - 20} 100 -50 re f\n`);
  });

  it('draws nothing at all for an unfilled rectangle with no pen', () => {
    // The early return precedes SetCurrentLineWidth, so not even a `w`
    // operator escapes.
    expect(
      draw(plotter(), (p) => p.Rect({ x: 0, y: 0 }, { x: 100, y: 100 }, FILL_T.NO_FILL, 0)),
    ).toBe('');
  });

  it('degenerates a zero-sized rectangle to a stroked point', () => {
    const at = { x: 40 * DECIMIL, y: 40 * DECIMIL };
    const body = draw(plotter(), (p) => p.Rect(at, at, FILL_T.NO_FILL, DECIMIL));

    // `re` with a zero extent draws nothing in most viewers, so the pen path
    // is used instead — and it goes through PenTo, hence six decimals.
    expect(body).toBe(
      `1 w\n40.000000 ${PAGE_TOP - 40}.000000 m\n40.000000 ${PAGE_TOP - 40}.000000 l\nS\n`,
    );
  });

  it('redraws a rectangle thinner than its own pen as a closed polygon', () => {
    const body = draw(plotter(), (p) =>
      p.Rect({ x: 0, y: 0 }, { x: 100 * DECIMIL, y: 2 * DECIMIL }, FILL_T.NO_FILL, 10 * DECIMIL),
    );

    // The test compares the *caller's* width against the shorter side, so a
    // 2-decimil-tall rectangle with a 10-decimil pen takes this path. Five
    // points, the last repeating the first.
    expect(body).toBe(
      '10 w\n' +
        `0.000000 ${PAGE_TOP}.000000 m ` +
        `100.000000 ${PAGE_TOP}.000000 l ` +
        `100.000000 ${PAGE_TOP - 2}.000000 l ` +
        `0.000000 ${PAGE_TOP - 2}.000000 l ` +
        `0.000000 ${PAGE_TOP}.000000 l S\n`,
    );
  });

  it('approximates a circle with four cubic Beziers', () => {
    const body = draw(plotter(), (p) =>
      p.Circle({ x: 100 * DECIMIL, y: 100 * DECIMIL }, 20 * DECIMIL, FILL_T.NO_FILL, DECIMIL),
    );

    // PDF has no arc operator. The control points sit 0.551784 * r off the
    // axis crossings; `s` closes and strokes, `b` closes, fills and strokes.
    const y = PAGE_TOP - 100;

    expect(body).toBe(
      '1 w\n' +
        `90 ${y} m ` +
        `90 82585.5 94.4822 ${y + 10} 100 ${y + 10} c ` +
        `105.518 ${y + 10} 110 82585.5 110 ${y} c ` +
        `110 82574.5 105.518 ${y - 10} 100 ${y - 10} c ` +
        `94.4822 ${y - 10} 90 82574.5 90 ${y} c s\n`,
    );
  });

  it('turns a circle thinner than the pen into a filled one', () => {
    const body = draw(plotter(), (p) =>
      p.Circle({ x: 100 * DECIMIL, y: 100 * DECIMIL }, DECIMIL, FILL_T.NO_FILL, 20 * DECIMIL),
    );

    // Diameter 1 against a pen of 20: the shape is refilled and the radius
    // grows to (d + w) / 2 = 10.5, so the hairline reads as a dot.
    expect(body).toContain('20 w\n89.5 ');
    expect(body.endsWith(' b\n')).toBe(true);
  });

  it('grows a thin circle by the width it was handed, not by the pen it resolved', () => {
    const body = draw(plotter({ defaultPenWidth: 20 * DECIMIL }), (p) =>
      p.Circle(
        { x: 100 * DECIMIL, y: 100 * DECIMIL },
        DECIMIL,
        FILL_T.NO_FILL,
        USE_DEFAULT_LINE_WIDTH,
      ),
    );

    // The trigger reads the resolved pen — 20 decimils, so the branch fires —
    // but the radius is grown by aWidth / 2, and aWidth is still the sentinel
    // -1. The circle therefore comes out a quarter of an internal unit
    // *smaller* than its own radius: 0.5 - 1/(2*2540) decimils.
    expect(body).toContain('20 w\n99.5002 ');
    expect(body).not.toContain('89.5 ');
    expect(body.endsWith(' b\n')).toBe(true);
  });

  it('flattens an arc at five degrees and closes a filled one back to the centre', () => {
    const centre = { x: 100 * DECIMIL, y: 100 * DECIMIL };
    const open = draw(plotter(), (p) =>
      p.Arc(centre, new EDA_ANGLE(0), new EDA_ANGLE(10), 10 * DECIMIL, FILL_T.NO_FILL, DECIMIL),
    );
    const pie = draw(plotter(), (p) =>
      p.Arc(
        centre,
        new EDA_ANGLE(0),
        new EDA_ANGLE(10),
        10 * DECIMIL,
        FILL_T.FILLED_SHAPE,
        DECIMIL,
      ),
    );

    // A ten-degree sweep gives the start, one five-degree sample and the end.
    const y = PAGE_TOP - 100;

    // arcPath negates the start angle and then swaps, so a 0..+10 sweep is
    // walked from -10 back to 0 and the first point is *not* the caller's start.
    expect(open).toBe(`1 w\n109.848 82578.3 m 109.962 82579.1 l 110 ${y} l S\n`);
    // The pie adds the centre and paints with `b`, so its two straight edges
    // are stroked as well as filled.
    expect(pie).toBe(`1 w\n109.848 82578.3 m 109.962 82579.1 l 110 ${y} l 100 ${y} l b\n`);
  });

  it('turns a non-positive arc radius into a filled circle of the current pen width', () => {
    const body = draw(plotter(), (p) =>
      p.Arc({ x: 0, y: 0 }, new EDA_ANGLE(0), new EDA_ANGLE(90), 0, FILL_T.NO_FILL, 0),
    );

    // The pen is set first, so a caller passing width 0 gets the clamped 1 IU
    // as the *diameter* — not 0, and not the caller's own width.
    expect(body).toBe(
      '0.000393701 w\n' +
        `-0.00019685 ${PAGE_TOP} m ` +
        `-0.00019685 ${PAGE_TOP} -0.000108619 ${PAGE_TOP} 0 ${PAGE_TOP} c ` +
        `0.000108619 ${PAGE_TOP} 0.00019685 ${PAGE_TOP} 0.00019685 ${PAGE_TOP} c ` +
        `0.00019685 ${PAGE_TOP} 0.000108619 ${PAGE_TOP} 0 ${PAGE_TOP} c ` +
        `-0.000108619 ${PAGE_TOP} -0.00019685 ${PAGE_TOP} -0.00019685 ${PAGE_TOP} c b\n`,
    );
  });

  it('distinguishes a zero-width filled polygon from a stroked one', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 10 * DECIMIL, y: 0 },
      { x: 10 * DECIMIL, y: 10 * DECIMIL },
    ];

    const stroked = draw(plotter(), (p) => p.PlotPoly(corners, FILL_T.NO_FILL, DECIMIL));
    const filled = draw(plotter(), (p) => p.PlotPoly(corners, FILL_T.FILLED_SHAPE, 0));
    const both = draw(plotter(), (p) => p.PlotPoly(corners, FILL_T.FILLED_SHAPE, DECIMIL));

    // `h f` closes and fills without stroking, which is what a zone fill needs;
    // `b` would outline it with the pen the clamp just raised to 1.
    expect(stroked.endsWith(' l S\n')).toBe(true);
    expect(filled.endsWith(' l h f\n')).toBe(true);
    expect(both.endsWith(' l b\n')).toBe(true);
    expect(draw(plotter(), (p) => p.PlotPoly(corners, FILL_T.NO_FILL, 0))).toBe('');
    expect(draw(plotter(), (p) => p.PlotPoly([corners[0]!], FILL_T.FILLED_SHAPE, 0))).toBe('');
  });

  it('writes polygon and pen coordinates with six decimals, not the shortest form', () => {
    const half = { x: 10 * DECIMIL + 1270, y: 0 };

    const poly = draw(plotter(), (p) =>
      p.PlotPoly([{ x: 0, y: 0 }, half], FILL_T.NO_FILL, DECIMIL),
    );
    const pen = draw(plotter(), (p) => {
      p.SetCurrentLineWidth(DECIMIL);
      p.MoveTo(half);
      p.FinishTo({ x: 0, y: 0 });
    });

    // PlotPoly and PenTo use a bare {:f}; Rect, Circle and Arc use
    // encodeDoubleForPlotter. Half a decimil is the discriminator: 10.500000
    // here, 10.5 there. Swapping either way changes these strings.
    expect(poly).toContain('10.500000 ');
    expect(pen).toContain('10.500000 ');
    expect(draw(plotter(), (p) => p.Rect({ x: 0, y: 0 }, half, FILL_T.FILLED_SHAPE, 0))).toContain(
      ' 10.5 ',
    );
  });

  it('opens a fresh path after the pen is lifted and suppresses a repeated point', () => {
    const a = { x: 10 * DECIMIL, y: 0 };
    const b = { x: 20 * DECIMIL, y: 0 };

    const body = draw(plotter(), (p) => {
      p.SetCurrentLineWidth(DECIMIL);
      p.MoveTo(a);
      p.LineTo(b);
      p.LineTo(b);
      p.PenFinish();
      p.PenFinish();
      p.MoveTo(a);
    });

    // 'Z' strokes and parks the pen; a second 'Z' writes nothing, and the
    // repeated LineTo is dropped because the *user* position is unchanged.
    expect(body).toBe(
      `1 w\n10.000000 ${PAGE_TOP}.000000 m\n20.000000 ${PAGE_TOP}.000000 l\nS\n` +
        `10.000000 ${PAGE_TOP}.000000 m\n`,
    );
  });

  it('truncates a fractional page size before scaling it to internal units', () => {
    const p = plotter({ start: false });

    // PAGE_INFO stores mils as mm * 1000 / 25.4, so they really can be
    // fractional; assigning GetSizeMils()'s VECTOR2D into a VECTOR2I member
    // drops the fraction before the multiply, which moves every device y by a
    // whole decimil. The media box, which reads the mils directly, keeps it.
    p.SetPageSettings({ x: 11693.9, y: 8268.9 });
    p.StartPlot('1');

    const body = draw(p, (q) =>
      q.Rect({ x: 0, y: 0 }, { x: DECIMIL, y: DECIMIL }, FILL_T.NO_FILL, DECIMIL),
    );

    expect(body).toBe(`1 w\n0 ${PAGE_TOP} 1 -1 re S\n`);
    expect(p.text()).toContain('/MediaBox [0 0 841.961 595.361]\n');
  });

  it('mirrors x about the page and leaves the vertical branch unreachable', () => {
    const body = draw(plotter({ mirror: true }), (p) =>
      p.Rect({ x: 0, y: 0 }, { x: 100 * DECIMIL, y: 50 * DECIMIL }, FILL_T.NO_FILL, DECIMIL),
    );

    // A4 is 11693 mils wide, i.e. 116930 decimils; the origin lands at the
    // right-hand edge.
    expect(body).toBe(`1 w\n116930 ${PAGE_TOP} -100 -50 re S\n`);
  });

  it('refuses a rounded rectangle rather than inventing a corner', () => {
    // SHAPE_RECT::SetRadius and the SHAPE_LINE_CHAIN PlotPoly overload have no
    // counterpart in this repo; approximating the corner would be a different
    // shape, not a port.
    expect(() =>
      draw(plotter(), (p) =>
        p.Rect({ x: 0, y: 0 }, { x: 100, y: 100 }, FILL_T.FILLED_SHAPE, 10, 5),
      ),
    ).toThrow(/corner radius is not ported/);
  });
});

describe('PdfPlotter images', () => {
  const pixels = image({ width: 2, height: 1, data: [10, 20, 30, 40, 50, 60] });

  it('scales the unit square onto the target rectangle and restores the matrix', () => {
    const body = draw(plotter(), (p) => p.PlotImage(pixels, { x: 0, y: 0 }, 10 * DECIMIL));

    // A PDF image is always drawn into the unit square at the origin, so the
    // whole placement lives in the `cm` matrix; `q`/`Q` keep it from leaking.
    expect(body).toBe(`q 20 0 0 10 -10 ${PAGE_TOP - 5} cm\n/Im7 Do\nQ\n`);
  });

  it('shares one XObject between images that compare equal', () => {
    const twin = image({ width: 2, height: 1, data: [10, 20, 30, 40, 50, 60] });
    const other = image({ width: 2, height: 1, data: [10, 20, 30, 40, 50, 61] });
    const retyped = image({ width: 2, height: 1, data: [10, 20, 30, 40, 50, 60], type: 3 });

    const body = draw(plotter(), (p) => {
      p.PlotImage(pixels, { x: 0, y: 0 }, DECIMIL);
      p.PlotImage(twin, { x: 0, y: 0 }, DECIMIL);
      p.PlotImage(other, { x: 0, y: 0 }, DECIMIL);
      p.PlotImage(retyped, { x: 0, y: 0 }, DECIMIL);
    });

    // The pixel-equal twin is merged; one differing byte and a differing
    // wxBitmapType each force a new object, so a board with the same logo
    // twice carries it once but two decodes of it carry it twice.
    expect(body.match(/\/Im\d+ Do/g)).toEqual(['/Im7 Do', '/Im7 Do', '/Im8 Do', '/Im9 Do']);
  });

  it('emits the image as a deflated XObject with a deferred length', () => {
    const p = plotter();

    p.PlotImage(pixels, { x: 0, y: 0 }, DECIMIL);
    p.EndPlot(NOW);

    const text = p.text();

    // /Length points forward to an object that does not exist yet when the
    // dictionary is written — the same back-patch the page stream uses, but
    // done by hand here rather than through closePdfStream.
    expect(objectAt(text, 7)).toBe(
      '7 0 obj\n' +
        '<<\n' +
        '/Type /XObject\n' +
        '/Subtype /Image\n' +
        '/BitsPerComponent 8\n' +
        '/ColorSpace /DeviceRGB\n' +
        '/Width 2\n' +
        '/Height 1\n' +
        '/Filter /FlateDecode\n' +
        '/Length 11 0 R\n' +
        '>>\n' +
        'stream\n' +
        '{\n\x14\x1e(2<}\n' +
        'endstream\n' +
        'endobj\n',
    );
    expect(objectAt(text, 11)).toBe('11 0 obj\n8\nendobj\n');
    expect(objectAt(text, 3)).toBe('3 0 obj\n<<\n\n    /Im7 7 0 R\n>>\nendobj\n');
  });

  it('adds a soft mask object only when the image carries transparency', () => {
    const masked = image({
      width: 2,
      height: 1,
      data: [10, 20, 30, 255, 0, 255],
      mask: [255, 0, 255],
    });

    const p = plotter();

    p.PlotImage(masked, { x: 0, y: 0 }, DECIMIL);
    p.EndPlot(NOW);

    const text = p.text();

    // The SMask handle is allocated after the image's length handle, so the
    // numbering runs image 7, length 11, mask 12, mask length 13 — and the mask
    // dictionary puts /Length before /Filter where the image puts it after.
    expect(objectAt(text, 7)).toContain('/SMask 12 0 R\n');
    expect(objectAt(text, 12)).toContain(
      '/ColorSpace /DeviceGray\n/Width 2\n/Height 1\n/Length 13 0 R\n/Filter /FlateDecode\n',
    );
    expect(objectAt(text, 12)).toContain('stream\n{\xff\x00}\nendstream\n');
    expect(objectAt(text, 13)).toBe('13 0 obj\n4\nendobj\n');
  });

  it('converts to greyscale and substitutes the background for masked pixels', () => {
    const masked = image({
      width: 2,
      height: 1,
      data: [255, 255, 255, 10, 20, 30],
      mask: [255, 255, 255],
    });

    // CIE 1931 weights, rounded. The masked pixel takes the render settings'
    // background *before* the conversion, so a mono plot shows the background's
    // luminance rather than a bare white.
    expect([...WriteImageStream(masked, { r: 0, g: 0, b: 0 }, false)]).toEqual([0, 19]);
    expect([...WriteImageStream(masked, { r: 0, g: 0, b: 0 }, true)]).toEqual([
      0, 0, 0, 10, 20, 30,
    ]);
  });

  it('prefers the mask over the alpha channel and yields nothing without either', () => {
    const both = image({
      width: 1,
      height: 1,
      data: [255, 0, 255],
      alpha: [128],
      mask: [255, 0, 255],
    });
    const alphaOnly = image({ width: 1, height: 1, data: [1, 2, 3], alpha: [128] });
    const plain = image({ width: 1, height: 1, data: [1, 2, 3] });

    expect([...WriteImageSMaskStream(both)]).toEqual([0]);
    expect([...WriteImageSMaskStream(alphaOnly)]).toEqual([128]);
    expect([...WriteImageSMaskStream(plain)]).toEqual([]);
  });

  it('names the image colour space from the plot mode, not the image', () => {
    const p = plotter({ colorMode: false });

    p.PlotImage(pixels, { x: 0, y: 0 }, DECIMIL);
    p.EndPlot(NOW);

    // One byte per pixel now, so the deflated stream is shorter too.
    expect(objectAt(p.text(), 7)).toContain('/ColorSpace /DeviceGray\n');
    expect(objectAt(p.text(), 11)).toBe('11 0 obj\n4\nendobj\n');
  });
});

describe('PdfPlotter outline and pages', () => {
  it('files each page under an outline entry named for its number', () => {
    const p = plotter();
    p.EndPlot(NOW);

    const text = p.text();

    expect(objectAt(text, 9)).toBe(
      '9 0 obj\n<<\n/Title (Page 1)\n/Parent 11 0 R\n/A 8 0 R\n>>\nendobj\n',
    );
    expect(objectAt(text, 11)).toBe(
      '11 0 obj\n<< /Type /Outlines\n   /Count 1\n   /First 9 0 R\n   /Last 9 0 R\n>>\nendobj\n',
    );
    expect(objectAt(text, 8)).toBe('8 0 obj\n<</S /GoTo /D [7 0 R /Fit]\n>>\nendobj\n');
  });

  it('formats an absent parent page as a name that can never match', () => {
    const p = plotter({ start: false });

    p.StartPlot('1');
    p.ClosePage();
    p.StartPage('2', '', '1', '');
    p.EndPlot(NOW);

    const text = p.text();

    // With no parent *name* the format is still applied, so page 2's parent is
    // "Page 1" — which does match, because page 1's own outline node is titled
    // "Page 1". Page 1's own parent is "Page " and matches nothing, so it sits
    // at the root. Treating an absent parent as empty would collapse both.
    expect(text).toContain('/Title (Page 1)');
    expect(text).toContain('/Title (Page 2)');

    // Page 1's outline node is 9 and page 2's is 14.
    expect(objectAt(text, 9)).toContain('/Count -1\n/First 14 0 R\n/Last 14 0 R\n');
    expect(objectAt(text, 14)).toContain('/Parent 9 0 R\n');
  });

  it('lets the formatted "Page " parent match a page whose number is empty', () => {
    const p = plotter({ start: false });

    p.StartPlot('');
    p.ClosePage();
    p.StartPage('2');
    p.EndPlot(NOW);

    const text = p.text();

    // Page one's number is empty, so its outline node is titled "Page " — and
    // page two, given no parent at all, looks for exactly that string and finds
    // it. Treating an absent parent as an empty string would skip the search
    // and leave page two at the root, which is why the formatting is not
    // shorthand for "no parent".
    expect(objectAt(text, 9)).toContain('/Title (Page )\n');
    expect(objectAt(text, 9)).toContain('/Count -1\n/First 14 0 R\n/Last 14 0 R\n');
    expect(objectAt(text, 14)).toContain('/Title (Page 2)\n/Parent 9 0 R\n');
  });

  it('lists every page in the page tree', () => {
    const p = plotter({ start: false });

    p.StartPlot('1');
    p.ClosePage();
    p.StartPage('2');
    p.EndPlot(NOW);

    const text = p.text();

    // Page two's content stream is object 10 and its page dictionary 12, so the
    // /Kids array is the only place their numbers are recorded in order.
    expect(objectAt(text, 1)).toBe(
      '1 0 obj\n<<\n/Type /Pages\n/Kids [\n7 0 R\n12 0 R\n]\n/Count 2\n>>\nendobj\n',
    );
    // With no parent page number either, both pages hang off the root: the
    // "Page " that StartPage formatted matches nothing in the tree.
    expect(objectAt(text, 9)).not.toContain('/First');
    expect(objectAt(text, 14)).not.toContain('/First');
  });

  it('chains sibling outline entries with /Next and /Prev and collapses parents', () => {
    const p = plotter();
    const box = { pos: { x: 0, y: 0 }, size: { x: DECIMIL, y: DECIMIL } };

    p.Bookmark(box, 'R1', 'Resistors');
    p.Bookmark(box, 'R2', 'Resistors');
    p.EndPlot(NOW);

    const text = p.text();

    // The group node counts its children negatively, which is the PDF encoding
    // for "start collapsed"; the two leaves point at each other.
    expect(objectAt(text, 10)).toContain('/Count -2\n/First 12 0 R\n/Last 14 0 R\n');
    expect(objectAt(text, 12)).toContain('/Next 14 0 R\n');
    expect(objectAt(text, 14)).toContain('/Prev 12 0 R\n');
    expect(objectAt(text, 12)).not.toContain('/Prev');
    expect(objectAt(text, 14)).not.toContain('/Next');
    // The root counts every node in the tree, positively.
    expect(objectAt(text, 16)).toContain('/Count 4\n');
  });

  it('sorts bookmarks inside a group and the groups themselves by title', () => {
    const p = plotter();
    const box = { pos: { x: 0, y: 0 }, size: { x: DECIMIL, y: DECIMIL } };

    p.Bookmark(box, 'R10', 'Resistors');
    p.Bookmark(box, 'R2', 'Resistors');
    p.Bookmark(box, 'C1', 'Capacitors');
    p.EndPlot(NOW);

    const text = p.text();

    // std::map orders the groups, and the per-group sort is lexicographic — so
    // Capacitors precedes Resistors even though it was bookmarked last, and R10
    // precedes R2, which is not a natural ordering.
    expect(objectAt(text, 10)).toContain('/Title (Capacitors)\n/Parent 9 0 R\n/Next 13 0 R\n');
    expect(objectAt(text, 13)).toContain('/Title (Resistors)\n/Parent 9 0 R\n/Prev 10 0 R\n');
    expect(objectAt(text, 15)).toContain('/Title (R10)\n/Parent 13 0 R\n/Next 17 0 R\n');
    expect(objectAt(text, 17)).toContain('/Title (R2)\n/Parent 13 0 R\n/Prev 15 0 R\n');
  });

  it('hangs the second bookmark group off the previous group, as upstream does', () => {
    const p = plotter();
    const box = { pos: { x: 0, y: 0 }, size: { x: DECIMIL, y: DECIMIL } };

    p.Bookmark(box, 'C1', 'Capacitors');
    p.Bookmark(box, 'R1', 'Resistors');
    p.EndPlot(NOW);

    const text = p.text();
    const action = (aTitle: string): string => {
      const entry = [...text.matchAll(/<<\n\/Title \(([^)]*)\)[^>]*?\/A (\d+) 0 R/gs)].find(
        (m) => m[1] === aTitle,
      );

      return entry![2]!;
    };

    // ClosePage reuses the variable that held the page's own GoTo action for
    // each bookmark's, so by the time the second group node is created the
    // variable names the *first group's last bookmark*. That is a bug, and it
    // is the one upstream ships: the Resistors node does not point at the page.
    expect(action('Capacitors')).toBe(action('Page 1'));
    expect(action('Resistors')).toBe(action('C1'));
    expect(action('Resistors')).not.toBe(action('Page 1'));
  });

  it('gives a bookmark a rectangle destination with whole-point coordinates', () => {
    const p = plotter();

    p.Bookmark(
      { pos: { x: 100 * DECIMIL, y: 100 * DECIMIL }, size: { x: 50 * DECIMIL, y: 20 * DECIMIL } },
      'U1',
    );
    p.EndPlot(NOW);

    // iuToPdfUserSpace returns doubles which upstream drops into a VECTOR2I, so
    // /FitR is truncated: 100 decimils is 7.2 points, and the y counts up from
    // the bottom of a 595.296-point page.
    // 100 decimils is 0.72 points, and the y counts up from the bottom of a
    // 595.296-point page: 594.576 and 594.432, both truncated to 594.
    expect(objectAt(p.text(), 11)).toBe(
      '11 0 obj\n<</S /GoTo /D [7 0 R /FitR 0 594 1 594]\n>>\nendobj\n',
    );
  });

  it('files an ungrouped bookmark under an outline node with no name at all', () => {
    const p = plotter();

    p.Bookmark({ pos: { x: 0, y: 0 }, size: { x: DECIMIL, y: DECIMIL } }, 'U1');
    p.EndPlot(NOW);

    // The default group name is the empty string, which is a perfectly good
    // std::map key — so the bookmark gets a nameless parent rather than hanging
    // directly off the page, and a reader shows a blank outline row.
    expect(objectAt(p.text(), 10)).toContain('/Title ()\n/Parent 9 0 R\n');
    expect(objectAt(p.text(), 12)).toContain('/Title (U1)\n/Parent 10 0 R\n');
  });

  it('reaches for /UseOutlines whenever any page was plotted', () => {
    // StartPlot always adds a page node, so the outline is never empty in
    // practice; the /UseNone arm is only reachable through 3D export mode.
    const p = plotter();
    p.EndPlot(NOW);

    expect(objectAt(p.text(), 12)).toContain('/PageMode /UseOutlines\n');
    expect(objectAt(p.text(), 12)).not.toContain('/UseNone');
  });
});

describe('PdfPlotter hyperlinks', () => {
  const box = { pos: { x: 0, y: 0 }, size: { x: 100 * DECIMIL, y: 50 * DECIMIL } };

  it('resolves an internal page reference to a destination on that page', () => {
    const p = plotter({ start: false });

    p.StartPlot('1');
    p.ClosePage();
    p.StartPage('2');
    p.HyperlinkBox(box, '#1');
    p.EndPlot(NOW);

    // /Rect is written [GetLeft GetBottom GetRight GetTop], and it comes out
    // right *because* the names lie: iuToPdfUserSpace already flipped y, so the
    // box's "bottom" is the smaller PDF y that a /Rect wants first.
    expect(objectAt(p.text(), 12)).toBe(
      '12 0 obj\n' +
        '<<\n' +
        '/Type /Annot\n' +
        '/Subtype /Link\n' +
        '/Rect [0 594.936 0.72 595.296]\n' +
        '/Border [16 16 0]\n' +
        '/Dest [7 0 R /FitB]\n' +
        '>>\n' +
        'endobj\n',
    );
  });

  it('gives a link to a page that was never plotted a no-op action', () => {
    const p = plotter();

    p.HyperlinkBox(box, '#99');
    p.EndPlot(NOW);

    // The alternative would be a dangling object reference, which stops a
    // viewer from opening the file at all.
    expect(objectAt(p.text(), 7)).toContain('/A << /Type /Action /S /NOP >>\n>>\n');
  });

  it('writes an external URL through the URI action, escaping the delimiters', () => {
    const p = plotter();

    p.HyperlinkBox(box, 'https://example.com/a(b)c');
    p.EndPlot(NOW);

    expect(objectAt(p.text(), 7)).toContain(
      '/A << /Type /Action /S /URI /URI (https://example.com/a\\(b\\)c) >>\n>>\n',
    );
  });

  it('runs an external URL through the project resolver, and only when there is one', () => {
    const project = { ResolveUriByEnvVars: (aUri: string) => aUri.replace('${DOCS}', '/docs') };

    const resolved = plotter({ project });
    resolved.HyperlinkBox(box, 'file://${DOCS}/a.pdf');
    resolved.EndPlot(NOW);

    const bare = plotter();
    bare.HyperlinkBox(box, 'file://${DOCS}/a.pdf');
    bare.EndPlot(NOW);

    // Upstream guards the call with `if( m_project )`, so a plot with no
    // project ships the unexpanded variable. Both directions matter: dropping
    // the guard would expand where upstream does not.
    expect(objectAt(resolved.text(), 7)).toContain('/URI (file:///docs/a.pdf)');
    expect(objectAt(bare.text(), 7)).toContain('/URI (file://${DOCS}/a.pdf)');
  });

  it('lists every annotation on the page in one array object', () => {
    const p = plotter();

    p.HyperlinkBox(box, 'https://a.example');
    p.HyperlinkMenu(box, ['https://b.example']);
    p.EndPlot(NOW);

    // The array is a separate indirect object because /Annots is written into
    // the page dictionary before either annotation exists.
    expect(objectAt(p.text(), 9)).toBe('9 0 obj\n[7 0 R 8 0 R]\nendobj\n');
    expect(objectAt(p.text(), 10)).toContain('/Annots 9 0 R>>\n');
  });

  it('builds a pop-up menu as a JavaScript action', () => {
    const p = plotter();

    p.HyperlinkMenu(box, ['!Datasheet = /docs/x.pdf', '#1', '/docs/y.pdf', 'https://example.com']);
    p.EndPlot(NOW);

    const menu = objectAt(p.text(), 7);

    // A `!` entry is a property line whose value becomes a file URI; a `#`
    // entry is an internal jump named by page *index*; a bare URL is offered
    // as "Open ...". The quotes are escaped as \u0022 by CTX_JS_STR.
    expect(menu).toContain(
      '/A << /Type /Action /S /JavaScript /JS (ShM\\([\n' +
        '["Datasheet = /docs/x.pdf", "file:///docs/x.pdf"],\n' +
        '["Show Page 1", "#0"],\n' +
        '["Open file:///docs/y.pdf", "file:///docs/y.pdf"],\n' +
        '["Open https://example.com", "https://example.com"],\n' +
        ']\\);) >>\n',
    );
  });

  it('drops a menu entry it cannot turn into a URL, and keeps a bare property', () => {
    const p = plotter();

    p.HyperlinkMenu(box, ['!Tolerance = 1%', 'not-a-url', '#404']);
    p.EndPlot(NOW);

    const menu = objectAt(p.text(), 7);

    // The property survives as a one-element entry — a menu line that does
    // nothing — while the unrecognised URL and the missing page vanish
    // entirely rather than producing a broken action.
    expect(menu).toContain('/JS (ShM\\([\n["Tolerance = 1%"],\n]\\);) >>\n');
  });

  it('ships the pop-up helper script in the name tree', () => {
    const p = plotter();
    p.EndPlot(NOW);

    const names = objectAt(p.text(), 4);

    // Every menu action calls ShM, so the script has to be registered as
    // JSInit whether or not the document has any menus.
    expect(names.startsWith('4 0 obj\n<< /JavaScript\n << /Names\n    [ (JSInit) ')).toBe(true);
    expect(names).toContain('function ShM\\(aEntries\\) {');
    expect(names).toContain('app.popUpMenuEx.apply\\(app, aParams\\);');
    expect(names.endsWith(' >> ]\n >>\n>>\nendobj\n')).toBe(true);
  });
});

describe('PdfPlotter string encoding', () => {
  it('keeps an ASCII string readable and escapes only the PDF delimiters', () => {
    expect(encodeStringForPlotter('R1 (0603)')).toBe('(R1 \\(0603\\))');
    expect(encodeStringForPlotter('C:\\plots')).toBe('(C:\\\\plots)');
    expect(encodeStringForPlotter('')).toBe('()');
  });

  it('switches the whole string to UTF-16BE hex as soon as one character is not ASCII-7', () => {
    // DEL counts as non-ASCII here — the test is `>= 0x7F`, not `> 0x7F` — so a
    // string containing it flips encoding even though it is a control code.
    expect(encodeStringForPlotter('Ω')).toBe('<FEFF03A9>');
    expect(encodeStringForPlotter('a\x7f')).toBe('<FEFF0061007F>');
    expect(encodeStringForPlotter('a b')).toBe('(a b)');
  });

  it('emits five hex digits for an astral character, as upstream does', () => {
    // wxString on Linux indexes code points, so `{:04X}` overflows its width
    // and the surrogate pair a reader expects never appears. Iterating UTF-16
    // units instead would quietly fix a real bug.
    expect(encodeStringForPlotter('\u{1F600}')).toBe('<FEFF1F600>');
  });

  it('octal-escapes anything unprintable in a byte string', () => {
    expect(encodeByteString(Uint8Array.from([0x41, 0x28, 0x00, 0xff, 0x5c]))).toBe(
      '(A\\(\\000\\377\\\\)',
    );
  });

  it('escapes a JavaScript string with at least four hex digits', () => {
    expect(EscapeJsString(`a'b"c\\d(e)f`)).toBe('a\\u0027b\\u0022c\\u005Cd\\u0028e\\u0029f');
    expect(EscapeJsString('Ω')).toBe('\\u03A9');
    expect(EscapeJsString('plain/path-1')).toBe('plain/path-1');
  });

  it('recognises a goto-page href only by its leading hash', () => {
    expect(IsGotoPageHref('#12')).toBe('12');
    expect(IsGotoPageHref('#')).toBe('');
    expect(IsGotoPageHref('https://x#12')).toBeNull();
  });

  it('normalises a file URI by stripping every colon after the scheme', () => {
    // The colon removal is unconditional, so a Windows drive letter loses its
    // colon too. That is upstream's, and "fixing" it would change every
    // Windows datasheet link in an existing plot.
    expect(NormalizeFileUri('file://C:\\docs\\a.pdf')).toBe('file:///C/docs/a.pdf');
    expect(NormalizeFileUri('file:///docs/a.pdf')).toBe('file:///docs/a.pdf');
    expect(NormalizeFileUri('file://docs/a.pdf')).toBe('file:///docs/a.pdf');
    expect(NormalizeFileUri('https://example.com')).toBe('https://example.com');
  });

  it('formats the creation date with colons throughout', () => {
    expect(pdfCreationDate(new Date(2026, 11, 31, 23, 59, 7))).toBe('D:2026:12:31:23:59:07');
  });
});

describe('PdfPlotter 3D export mode', () => {
  it('writes no content stream and annotates the page as 3D', () => {
    const p = plotter({ start: false });

    p.Set3DExport(true);
    p.StartPlot('1');
    p.EndPlot(NOW);

    const text = p.text();

    // With Plot3DModel unported the model handle stays -1, which is exactly
    // what upstream emits when the mode is set and no model is plotted.
    expect(text).not.toContain('/Filter /FlateDecode');
    expect(objectAt(text, 7)).not.toContain('/Contents');
    expect(objectAt(text, 6)).toBe('6 0 obj\n[5 0 R]\nendobj\n');
    expect(objectAt(text, 5)).toBe(
      '5 0 obj\n' +
        '<<\n' +
        '/Type /Annot\n' +
        '/Subtype /3D\n' +
        '/Rect [0 0 841.896 595.296]\n' +
        '/NM (3D Annotation)\n' +
        '/3DD -1 0 R\n' +
        '/3DV 0\n' +
        '/3DA<</A/PO/D/PC/TB true/NP true>>\n' +
        '/3DI true\n' +
        '/P 7 0 R\n' +
        '>>\n' +
        'endobj\n',
    );
  });

  it('emits no resources and leaves the catalog without an outline', () => {
    const p = plotter({ start: false });

    p.Set3DExport(true);
    p.StartPlot('1');
    p.EndPlot(NOW);

    const text = p.text();

    // endPlotEmitResources and emitOutline are both skipped, so the font and
    // image dictionaries are never written and objects 2, 3 and 4 keep a zero
    // xref offset.
    expect(xrefOffsets(text)[2]).toBe(0);
    expect(xrefOffsets(text)[4]).toBe(0);
    // The outline node ClosePage allocated is never emitted either, so its xref
    // entry stays at zero — a dangling reference a reader treats as free.
    expect(xrefOffsets(text)[9]).toBe(0);
    expect(text).toContain('/PageMode /UseNone\n');
  });
});
