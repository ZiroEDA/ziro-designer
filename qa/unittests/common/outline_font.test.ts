// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `OUTLINE_FONT` against KiCad's own output.
 *
 * `qa/data/font/fonttest_kicad_cli.svg` is `kicad-cli sch export svg` (10.0.5)
 * of `fonttest.kicad_sch`, whose texts name Arial, DejaVu Sans, Liberation
 * Mono, Times New Roman, a face that does not exist, and the KiCad Font by
 * name. An outline text is plotted as the same filled polygons the screen
 * draws (`PLOTTER::PlotText` → `FONT::Draw` → the polygon callback), so the
 * ink extents in that file are eeschema's glyph geometry, in millimetres, on
 * the machine the bundled fonts came from. The tests read those extents back
 * and lay the same strings out here.
 *
 * What is pinned, per row: the ink width and height, the left side bearing,
 * and the baseline's distance below the anchor — which together cover the
 * 1.4 size compensation, the integer-ppem rounding, kerning, the fake
 * italic shear, fontconfig's substitutions, and the two SCH_TEXT offsets.
 * The tolerance is what hinting leaves: FreeType grid-fits the outline at
 * 358 ppem and we do not, so a coordinate may differ by a fraction of one of
 * those pixels — under 0.1 % of the em.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseOutlineFace } from '@ziroeda/common/src/font/outline_face.js';
import {
  OutlineFont,
  emUnits,
  faceSize,
  subscriptSize,
} from '@ziroeda/common/src/font/outline_font.js';
import {
  layoutOutlineText,
  outlineBoundaryLimits,
  outlineTextWidth,
} from '@ziroeda/common/src/font/outline_layout.js';
import { BUNDLED_FONTS, findFont } from '@ziroeda/common/src/font/fontconfig.js';
import { contourWinding, outlineToSegments } from '@ziroeda/common/src/font/outline_decomposer.js';
import { setFontProvider, textLimits, textWidth } from '@ziroeda/common/src/font/font_provider.js';
import { isStrokeFont, stringBoundaryLimits } from '@ziroeda/common/src/font/text_box.js';

const FONTS = fileURLToPath(new URL('../../../designer/public/fonts/', import.meta.url));
const DATA = fileURLToPath(new URL('../../data/font/', import.meta.url));
/** eeschema's IU per mm. */
const MM = 10000;

const faces = new Map<string, ReturnType<typeof parseOutlineFace>>();
function face(file: string) {
  let f = faces.get(file);
  if (!f) {
    const b = readFileSync(FONTS + file);
    f = parseOutlineFace(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    faces.set(file, f);
  }
  return f;
}
function fontFor(name: string, bold = false, italic = false): OutlineFont {
  const found = findFont(name, bold, italic)!;
  return new OutlineFont(face(found.file.file), name, found.fakeBold, found.fakeItalic);
}

/** The plotted ink extents of every `stroked-text` group of the SVG, by text. */
function oracle(): Map<
  string,
  { minX: number; maxX: number; minY: number; maxY: number; anchorY: number }
> {
  const svg = readFileSync(`${DATA}fonttest_kicad_cli.svg`, 'utf8');
  const out = new Map<
    string,
    { minX: number; maxX: number; minY: number; maxY: number; anchorY: number }
  >();
  const re = /<g class="stroked-text"><desc>(.*?)<\/desc>(.*?)<\/g>/gs;
  for (const m of svg.matchAll(re)) {
    const name = m[1]!.replace(/&gt;/g, '>');
    const nums = [...m[2]!.matchAll(/(-?\d+\.\d+)[ ,]+(-?\d+\.\d+)/g)];
    if (!nums.length) continue;
    const xs = nums.map((n) => Number(n[1]));
    const ys = nums.map((n) => Number(n[2]));
    out.set(name, {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      anchorY: 0,
    });
  }
  return out;
}

/** The test file's rows: face, text, bold, italic, and the anchor's y in mm. */
const ROWS: [string, string, boolean, boolean, number][] = [
  ['Arial', 'Arial Hello AVWo 0123', false, false, 20.32],
  ['Arial', 'Arial bold AVWo', true, false, 27.94],
  ['Arial', 'Arial italic AVWo', false, true, 35.56],
  ['DejaVu Sans', 'DejaVu Sans italic (fake)', false, true, 43.18],
  ['Liberation Mono', 'Liberation Mono 0O1l', false, false, 50.8],
  ['Times New Roman', 'Times New Roman Qfg', false, false, 58.42],
  ['Nonexistent Face', 'Unknown face -> Noto Sans', false, false, 66.04],
];

function ink(font: OutlineFont, text: string, size: number) {
  const lay = layoutOutlineText(font, text, size, 'left');
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const g of lay.glyphs)
    for (const r of g.rings)
      for (const p of r) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
  return { minX, maxX, minY, maxY };
}

describe('OUTLINE_FONT against kicad-cli (fonttest_kicad_cli.svg)', () => {
  const o = oracle();
  const size = 2.54 * MM;

  for (const [name, text, bold, italic, anchorY] of ROWS) {
    it(`${name}: "${text}" has eeschema's ink extents`, () => {
      const k = o.get(text);
      expect(k, `no plotted group for "${text}"`).toBeDefined();
      const font = fontFor(name, bold, italic);
      const ours = ink(font, text, size);
      // One pixel at the 358 ppem the outline is hinted at, in mm: what a
      // grid-fitted point can move by.
      const px = (1.4 * 2.54) / 358;
      const dw = Math.abs((ours.maxX - ours.minX) / MM - (k!.maxX - k!.minX));
      const dh = Math.abs((ours.maxY - ours.minY) / MM - (k!.maxY - k!.minY));
      const dl = Math.abs(ours.minX / MM - (k!.minX - 25.4));
      // A run's width is two hinted edges plus the advances' rounding.
      expect(dw, `ink width off by ${dw.toFixed(4)} mm`).toBeLessThan(3 * px);
      expect(dh, `ink height off by ${dh.toFixed(4)} mm`).toBeLessThan(px);
      // The left side bearing: KiCad's first x less the 25.4 mm anchor.
      expect(dl, `left bearing off by ${dl.toFixed(4)} mm`).toBeLessThan(px);
    });
  }

  it('the baseline sits where SCH_TEXT::Plot puts it: 0.25 + 0.17·size + 0.4·(box − size) above the anchor', () => {
    // "Arial Hello AVWo 0123": the ink bottom is the 'o' overshoot below the
    // baseline, the same in both; compare bottoms.
    const k = o.get('Arial Hello AVWo 0123')!;
    const font = fontFor('Arial');
    const ours = ink(font, 'Arial Hello AVWo 0123', size);
    const boxH = outlineBoundaryLimits(font, 'Arial Hello AVWo 0123', size).y;
    const adjust = Math.round(0.4 * (boxH - size));
    const baseline = 20.32 * MM - 2500 - adjust - (1.17 * size - size);
    expect(Math.abs((baseline + ours.maxY) / MM - k.maxY)).toBeLessThan(0.005);
    // And the box height that drives `adjust` is ascender + descender at 1.4×.
    const f = face('LiberationSans-Regular.ttf');
    const em = emUnits(f, faceSize());
    expect(boxH).toBeCloseTo(
      ((f.ascender - f.descender) * (em / f.unitsPerEm) * 1.4 * size) / faceSize(),
      0,
    );
  });

  it('a run is as wide as the plotter says (textLength), within hinting', () => {
    // `<text textLength="35.6121">` is the plotter's advance for the row.
    const w = outlineTextWidth(fontFor('Arial'), 'Arial Hello AVWo 0123', size) / MM;
    expect(Math.abs(w - 35.6121)).toBeLessThan(0.02);
  });

  it('two lines are one METRICS interline apart, with no stroke legacy factor', () => {
    const lay = layoutOutlineText(fontFor('Arial'), 'line one\nline two longer', size, 'left');
    const tops = lay.glyphs.map((g) => Math.min(...g.rings.flat().map((p) => p.y)));
    const line2 = Math.min(...tops.filter((t) => t > 0.5 * size));
    const line1 = Math.min(...tops);
    // 'l' tops differ by exactly the interline: 1.68 × size.
    expect(line2 - line1).toBeCloseTo(1.68 * size, 0);
    expect(lay.lineCount).toBe(2);
  });
});

describe('the size arithmetic', () => {
  it('faceSize is the int 1433, subscriptSize KiROUND 917, and an em is 1.4 sizes', () => {
    expect(faceSize()).toBe(1433);
    expect(subscriptSize()).toBe(917);
    const f = face('LiberationSans-Regular.ttf');
    const font = new OutlineFont(f, 'Arial');
    const run = font.getTextAsGlyphs('H', { x: 10000, y: 10000 }, { x: 0, y: 0 }, 0, false, {
      x: 0,
      y: 0,
    });
    const top = Math.min(...run.glyphs[0]!.rings.flat().map((p) => p.y));
    // Liberation Sans' cap height is 1409/2048 em; at 1.4 sizes, with the
    // 1432/1433 ppem rounding.
    expect(-top).toBeCloseTo((1409 / 2048) * 1.4 * 10000 * (1432 / 1433), -1);
  });

  it('every face is drawn at the whole ppem FreeType settles on: 358, not 358.25', () => {
    expect(face('LiberationSans-Regular.ttf').integerPpem).toBe(true);
    expect(emUnits(face('LiberationSans-Regular.ttf'), 1433)).toBe(1432);
    expect(emUnits(face('LiberationSans-Regular.ttf'), 917)).toBe(916);
    // Noto has no head flag 3, and [px] the oracle shrinks it all the same.
    expect(face('NotoSans-Regular.ttf').integerPpem).toBe(false);
    expect(emUnits(face('NotoSans-Regular.ttf'), 1433)).toBe(1432);
  });

  it('kerning comes from the text’s script, not DFLT', () => {
    const f = face('LiberationSans-Regular.ttf');
    const [a, v] = f.shape('AV');
    const [a2] = f.shape('A');
    expect(a!.xAdvance).toBe(a2!.xAdvance - 152);
    expect(v!.xAdvance).toBe(1366);
  });

  it('a codepoint the face lacks draws the face’s own .notdef, and a space draws nothing', () => {
    // `FT_Load_Glyph( face, 0 )` is the font's missing-glyph box — Liberation
    // Mono's is a hollow rectangle — not KiCad's tofu, which is only for an
    // outline FreeType cannot decompose. A space has no contours and must not
    // become a box either: it did, and every space in a Serif row measured
    // taller than the 'f' beside it.
    const f = face('LiberationMono-Regular.ttf');
    const font = new OutlineFont(f, 'Liberation Mono');
    const sz = { x: 1433, y: 1433 };
    const o = { x: 0, y: 0 };
    const missing = font.getTextAsGlyphs('\u{10FFFF}', sz, o, 0, false, o).glyphs[0]!;
    expect(missing.rings.length).toBe(2);
    const space = font.getTextAsGlyphs(' ', sz, o, 0, false, o);
    expect(space.glyphs[0]!.rings).toHaveLength(0);
    expect(space.end.x).toBeGreaterThan(0);
  });

  it('a glyph the reader cannot decompose is the tofu box: 0.72 tall over the advance, 0.06 walls', () => {
    const broken = {
      familyName: 'Broken',
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      isBold: false,
      isItalic: false,
      integerPpem: false,
      glyphIndex: () => 5,
      shape: () => [{ id: 5, xAdvance: 600, yAdvance: 0 }],
      outline: () => {
        throw new Error('bad glyf');
      },
      orientation: () => 'truetype' as const,
    };
    const font = new OutlineFont(broken, 'Broken');
    const run = font.getTextAsGlyphs('x', { x: 1433, y: 1433 }, { x: 0, y: 0 }, 0, false, {
      x: 0,
      y: 0,
    });
    const [outer, hole] = run.glyphs[0]!.rings;
    // With size = faceSize the scale is 1.4 and y is flipped.
    const xs = outer!.map((p) => p.x);
    const ys = outer!.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(1433 * 0.03 * 1.4, 3);
    expect(Math.min(...ys)).toBeCloseTo(-1433 * 0.72 * 1.4, 3);
    const hx = hole!.map((p) => p.x);
    expect(Math.min(...hx)).toBeCloseTo(1433 * 0.09 * 1.4, 3);
    expect(Math.max(...xs) - Math.max(...hx)).toBeCloseTo(1433 * 0.06 * 1.4, 3);
  });

  it('sub- and superscripts are the 0.64 face, offset by −0.25 and +0.45 of it', () => {
    // outline_font.h:193-212: `subscriptSize()` = KiROUND( 1433 × 0.64 ) = 917,
    // and the glyph is lifted by `m_superscriptVerticalOffset × scaler` (y up)
    // before the scale to text size — so in IU, by 0.45 × 917 × 1.4 × size / 1433.
    const f = face('LiberationSans-Regular.ttf');
    const font = new OutlineFont(f, 'Arial');
    const sz = { x: 10000, y: 10000 };
    const o = { x: 0, y: 0 };
    const bottom = (rings: readonly (readonly { y: number }[])[]) =>
      Math.max(...rings.flat().map((p) => p.y));
    const top = (rings: readonly (readonly { y: number }[])[]) =>
      Math.min(...rings.flat().map((p) => p.y));
    const normal = font.getTextAsGlyphs('H', sz, o, 0, false, o).glyphs[0]!.rings;
    const sup = font.getTextAsGlyphs('H', sz, o, 0, false, o, { superscript: true }).glyphs[0]!
      .rings;
    const sub = font.getTextAsGlyphs('H', sz, o, 0, false, o, { subscript: true }).glyphs[0]!.rings;
    const scaleY = (1.4 * 10000) / 1433;
    expect(bottom(sup)).toBeCloseTo(-0.45 * 917 * scaleY, 0);
    expect(bottom(sub)).toBeCloseTo(0.25 * 917 * scaleY, 0);
    // Height: the 916/1432 em (917 → 916 by the ppem rounding).
    expect((bottom(sup) - top(sup)) / (bottom(normal) - top(normal))).toBeCloseTo(916 / 1432, 3);
  });

  it('the fake italic is a 12° shear of an upright face', () => {
    // DejaVu Sans has no oblique in the bundle, so italic is faked; a glyph
    // top leans right by tan(12°) × its height-ish — check 'l' moves right at
    // the top and not at the baseline.
    const f = face('DejaVuSans.ttf');
    const fake = new OutlineFont(f, 'DejaVu Sans', false, true);
    const up = new OutlineFont(f, 'DejaVu Sans');
    const sz = { x: 10000, y: 10000 };
    const o = { x: 0, y: 0 };
    const lFake = fake.getTextAsGlyphs('l', sz, o, 0, false, o).glyphs[0]!.rings[0]!;
    const lUp = up.getTextAsGlyphs('l', sz, o, 0, false, o).glyphs[0]!.rings[0]!;
    const topFake = Math.min(...lFake.map((p) => p.y));
    const rightAtTop = (r: readonly { x: number; y: number }[], y: number) =>
      Math.max(...r.filter((p) => Math.abs(p.y - y) < 1).map((p) => p.x));
    // `FT_Set_Transform` with xx = cos(-12°), xy = -sin(-12°): x' = 0.978 x +
    // 0.208 y (y up), so a point at the top moves right by 0.208 of its height
    // and every point comes in by 2.2 % of its x.
    const a = (-12 * Math.PI) / 180;
    const xUp = rightAtTop(lUp, topFake);
    expect(rightAtTop(lFake, topFake)).toBeCloseTo(Math.cos(a) * xUp + Math.sin(a) * topFake, -1);
    expect(fake.isItalic).toBe(true);
    expect(up.isItalic).toBe(false);
  });
});

describe('the decomposer', () => {
  it('winding is the signed shoelace sum with the closing edge', () => {
    expect(
      contourWinding([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    ).toBe(-1);
    expect(
      contourWinding([
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ]),
    ).toBe(1);
    expect(contourWinding([{ x: 0, y: 0 }])).toBe(0);
  });

  it('flattens conics and cubics and drops repeated points', () => {
    const c = outlineToSegments(
      [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 0, y: 0 },
        { type: 'Q', x1: 50, y1: 100, x: 100, y: 0 },
        { type: 'Z' },
      ],
      1,
      'truetype',
    )!;
    expect(c).toHaveLength(1);
    expect(c[0]!.points.length).toBeGreaterThan(4);
    expect(c[0]!.points[0]).toEqual({ x: 0, y: 0 });
    expect(c[0]!.points[1]).not.toEqual({ x: 0, y: 0 });
    // No contours is a successful decomposition of nothing, not a failure.
    expect(outlineToSegments([], 1, 'truetype')).toEqual([]);
  });
});

describe('fontconfig: FindFont over the catalogue', () => {
  it('substitutes the way the desktop does, and never fakes a substitute', () => {
    expect(findFont('Arial', false, false)!.file.file).toBe('LiberationSans-Regular.ttf');
    expect(findFont('Arial', true, true)!.file.file).toBe('LiberationSans-BoldItalic.ttf');
    expect(findFont('Times New Roman', false, false)!.file.family).toBe('Liberation Serif');
    expect(findFont('Courier New', false, false)!.file.family).toBe('Liberation Mono');
    expect(findFont('Nonexistent Face', false, false)!.file.family).toBe('Noto Sans');
    const sub = findFont('Arial', true, false)!;
    expect(sub.result).toBe('substitute');
    expect(sub.fakeBold).toBe(false);
  });

  it('fakes a style only for the family asked for: DejaVu Sans has no oblique', () => {
    const f = findFont('DejaVu Sans', false, true)!;
    expect(f.file.file).toBe('DejaVuSans.ttf');
    expect(f.result).toBe('missing_ital');
    expect(f.fakeItalic).toBe(true);
    expect(f.fakeBold).toBe(false);
    const b = findFont('DejaVu Sans', true, true)!;
    expect(b.file.file).toBe('DejaVuSans-Bold.ttf');
    expect(b.result).toBe('missing_ital');
    expect(findFont('Liberation Sans', true, false)!.result).toBe('ok');
  });

  it('a bold word in the name asks for bold — of whatever family the name resolves to', () => {
    // "Liberation Sans Bold" is not a family, so fontconfig falls to the
    // default sans; the name's "bold" then picks that family's bold face.
    // [px] `fc-match "Liberation Sans Bold:style=Bold"` → Noto Sans:style=Bold.
    expect(findFont('Liberation Sans Bold', false, false)!.file.file).toBe('NotoSans-Bold.ttf');
    expect(findFont('Arial Black', false, false)!.file.file).toBe('NotoSans-Bold.ttf');
  });

  it('every catalogue file is shipped', () => {
    for (const f of BUNDLED_FONTS) expect(() => readFileSync(FONTS + f.file)).not.toThrow();
  });
});

describe('the provider seam', () => {
  it('"KiCad Font" by name is the stroke font', () => {
    expect(isStrokeFont('KiCad Font')).toBe(true);
    expect(isStrokeFont(undefined)).toBe(true);
    expect(isStrokeFont('Arial')).toBe(false);
  });

  it('an outline face’s box is the advance wide and ascender+descender tall, uninflated', () => {
    const font = fontFor('Arial');
    setFontProvider({
      measure: (t, s) => outlineTextWidth(font, t, s),
      limits: (t, s) => outlineBoundaryLimits(font, t, s),
    });
    try {
      const size = 25400;
      const box = stringBoundaryLimits(
        'Hello',
        { size: { x: size, y: size }, face: 'Arial' },
        1524,
      );
      expect(box.x).toBeCloseTo(outlineTextWidth(font, 'Hello', size), 3);
      expect(box.y).toBeCloseTo(outlineBoundaryLimits(font, 'Hello', size).y, 3);
      expect(textLimits('Hello', size, { face: 'Arial' })).not.toBeNull();
      expect(textWidth('Hello', size, { face: 'Arial' })).toBeCloseTo(box.x, 3);
      // No face: the stroke font, whatever the provider says.
      expect(textLimits('Hello', size)).toBeNull();
    } finally {
      setFontProvider(null);
    }
  });
});
