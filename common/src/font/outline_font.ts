// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIFONT::OUTLINE_FONT` (common/font/outline_font.cpp, include/font/
 * outline_font.h): a text run laid out with a real typeface as filled glyph
 * polygons, the way every KiCad renderer and plotter receives one —
 * `OPENGL_GAL::DrawGlyph` triangulates an `OUTLINE_GLYPH`, `CALLBACK_GAL`
 * hands the same polygons to the plotter, and the bounding box comes from
 * the same pass. No toolkit text call anywhere, which is why this can be
 * the one source the screen, the plots and the geometry all read.
 *
 * ### The size arithmetic, which is the part that is easy to get wrong
 *
 * KiCad loads every face at one nominal size and scales the glyphs to the
 * text afterwards:
 *
 *     m_faceSize = 16
 *     faceSize() = aSize * m_charSizeScaler(64) * m_outlineFontSizeCompensation(1.4)
 *                = 1433   (int; the double is 1433.6)
 *     FT_Set_Char_Size( face, 0, faceSize(), GLYPH_RESOLUTION(1152), 0 )
 *
 * At 1152 dpi that is `faceSize / 4` pixels per em; the outline comes back in
 * 26.6 pixels and `OUTLINE_DECOMPOSER::toVector2D` multiplies by
 * `GLYPH_SIZE_SCALER = 72 / 1152`, so in the units the contours are held in
 * **one em is `faceSize()` units** — 1433, or `subscriptSize()` = 917 for a
 * sub/superscript. Then
 *
 *     scaleFactor = ( glyphSize.x / faceSize(), -glyphSize.y / faceSize() )
 *                 * m_outlineFontSizeCompensation
 *
 * puts an em at `1.4 × the text height`. That 1.4 is the whole reason outline
 * text and stroke text look the same size: a stroke glyph's cap height IS the
 * text height, while an outline font's cap is about 0.7 em, so an em has to
 * be 1.4 heights for the caps to line up. The compensation is applied twice
 * on purpose, once into `faceSize()` and once into `scaleFactor` — the first
 * only picks the resolution the outline is decomposed at, the second is the
 * one that sizes the text.
 *
 * ### What is not FreeType here
 *
 * The face is read through `OutlineFace` (opentype.js), whose differences
 * from FreeType + HarfBuzz are listed on that interface. Hinting is the
 * other one: `FT_Load_Glyph( face, glyph, FT_LOAD_NO_BITMAP )` hints the
 * outline at 358 pixels per em, which moves points by a fraction of a
 * pixel there — under a thousandth of an em — and is not reproduced.
 *
 * Fake bold — `FT_Outline_Embolden( outline, 1 << 6 )`, one pixel at that
 * resolution, so 4 glyph units — moves each vertex out along the bisector
 * of its two edges, the same geometry as FreeType's `FT_Outline_EmboldenXY`
 * without its collapsing-segment guards. It is applied only when
 * `fontconfig` could not find a bold face, exactly as `SetFakeBold` is.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { OutlineCommand, OutlineFace, ShapedGlyph } from './outline_face.js';
import { type Contour, outlineToSegments } from './outline_decomposer.js';

/** `OUTLINE_FONT::m_faceSize`. */
const FACE_SIZE = 16;
/** `m_charSizeScaler`, 26.6 fixed point's 64. */
const CHAR_SIZE_SCALER = 64;
/** `m_outlineFontSizeCompensation`. */
export const OUTLINE_FONT_SIZE_COMPENSATION = 1.4;
/** `m_subscriptSuperscriptSize`: "we split the difference with 0.64". */
const SUBSCRIPT_SUPERSCRIPT_SIZE = 0.64;
/** `m_subscriptVerticalOffset` / `m_superscriptVerticalOffset`, × the face size, y up. */
const SUBSCRIPT_VERTICAL_OFFSET = -0.25;
const SUPERSCRIPT_VERTICAL_OFFSET = 0.45;
/** `FT_Outline_Embolden( …, 1 << 6 )`: one 26.6 pixel, in glyph units (× GLYPH_SIZE_SCALER × 64). */
const FAKE_BOLD_STRENGTH = 4;
/** `TAB_WIDTH` in `GetTextAsGlyphs`: four spaces of 0.6 em. */
const TAB_WIDTH = 4 * 0.6;

/** `int OUTLINE_FONT::faceSize( int aSize )` — an int, so 1433 not 1433.6. */
export const faceSize = (size = FACE_SIZE): number =>
  Math.trunc(size * CHAR_SIZE_SCALER * OUTLINE_FONT_SIZE_COMPENSATION);
/** `subscriptSize`: `KiROUND( faceSize( aSize ) * m_subscriptSuperscriptSize )`. */
export const subscriptSize = (size = FACE_SIZE): number =>
  KiROUND(faceSize(size) * SUBSCRIPT_SUPERSCRIPT_SIZE);

/**
 * Glyph units per em at `scaler`: what `FT_Set_Char_Size( face, 0, scaler,
 * 1152, 0 )` actually sets, not the fraction it asked for. `FT_Request_
 * Metrics` makes `x_ppem = ( w + 32 ) >> 6` of the 26.6 request
 * `w = scaler × 1152 / 72`, and the TrueType driver rescales the outline to
 * that whole ppem (`tt_size_reset`: "base scaling values on integer ppem
 * values, as mandated by the TrueType specification"); a glyph unit is a
 * quarter pixel (`GLYPH_SIZE_SCALER`), so the em is `4 × ppem` units — 1432
 * for the requested 1433, 916 for 917.
 *
 * `tt_size_reset` reads as gating this on `head.flags` bit 3, and Noto Sans
 * does not set that bit. [px] kicad-cli's SVG says otherwise: EVERY bundled
 * face — Noto Sans included — comes out 0.07 % narrower than the fractional
 * arithmetic, which is exactly 358 / 358.25, with the hinting scatter (up to
 * a pixel at that size) on top. The measurement wins over the reading, so
 * the rounding is applied to every face; `integerPpem` is kept on the face
 * for the record, not consulted here.
 */
export function emUnits(_face: OutlineFace, scaler: number): number {
  const w = scaler * 16;
  return ((w + 32) >> 6) * 4;
}

/** `TEXT_STYLE_FLAGS`, the ones `OUTLINE_FONT::getTextAsGlyphs` reads. */
export interface OutlineTextStyle {
  readonly subscript?: boolean;
  readonly superscript?: boolean;
}

/**
 * `OUTLINE_GLYPH`: one glyph's contours, positioned, scaled and rotated into
 * the caller's coordinates (y down, IU). Outlines and holes are kept as
 * rings; a hole is a ring inside an outline, which under a non-zero fill
 * rule is a hole by winding, and a "hole" that sits inside no outline is an
 * outline of its own (`getTextAsGlyphsUnlocked`'s `added_hole` fallback) —
 * which the same rule also gives.
 */
export interface OutlineGlyph {
  readonly rings: readonly (readonly Vec2[])[];
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A run's result: the glyphs, and where the cursor ends. */
export interface OutlineRun {
  readonly glyphs: OutlineGlyph[];
  /** The position after the last advance (`GetTextAsGlyphs`'s return). */
  readonly end: Vec2;
  /** `aBBox`: ascender/descender tall, cursor wide, at `position`. */
  readonly bbox: BBox;
}

interface GlyphData {
  contours: Contour[];
}

function contourIsFilled(c: Contour): boolean {
  switch (c.orientation) {
    case 'truetype':
      return c.winding === 1;
    case 'postscript':
      return c.winding === -1;
    default:
      return false;
  }
}

/**
 * `FT_Outline_Embolden`'s vertex shift: each point moves by `strength / 2`
 * along the bisector of the normals of its two edges, outward for the
 * outline's orientation. Straight runs move by exactly `strength / 2`;
 * corners a little more, as the real thing does, capped at the strength
 * so a sharp spike does not fly off.
 */
function embolden(
  points: Vec2[],
  strength: number,
  orientation: 'truetype' | 'postscript',
): Vec2[] {
  const n = points.length;
  if (n < 3) return points;
  const half = strength / 2;
  // Walking a clockwise contour on a y-up plane the interior is on the right,
  // so the outward normal of an edge (dx, dy) is (-dy, dx); counter-clockwise
  // it is the other one.
  const sign = orientation === 'truetype' ? -1 : 1;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i + n - 1) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const inX = p1.x - p0.x;
    const inY = p1.y - p0.y;
    const outX = p2.x - p1.x;
    const outY = p2.y - p1.y;
    const lIn = Math.hypot(inX, inY);
    const lOut = Math.hypot(outX, outY);
    if (lIn === 0 || lOut === 0) {
      out.push(p1);
      continue;
    }
    // Outward unit normals of the two edges.
    const n1x = (sign * inY) / lIn;
    const n1y = (-sign * inX) / lIn;
    const n2x = (sign * outY) / lOut;
    const n2y = (-sign * outX) / lOut;
    let bx = n1x + n2x;
    let by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl === 0) {
      out.push(p1);
      continue;
    }
    // Miter: the bisector scaled so each edge still moves out by `half`.
    const cosHalf = bl / 2;
    const len = half / Math.max(cosHalf, 0.5);
    bx = (bx / bl) * len;
    by = (by / bl) * len;
    out.push({ x: p1.x + bx, y: p1.y + by });
  }
  return out;
}

export class OutlineFont {
  private readonly glyphCache = new Map<string, GlyphData>();

  /**
   * @param fontName the name asked for, kept even when a substitute was
   *   loaded (`font->m_fontName = aFontName; // Keep asked-for name`).
   * @param fakeBold / fakeItalic `SetFakeBold` / `SetFakeItal`, set by
   *   `LoadFont` from fontconfig's `FF_MISSING_BOLD` / `FF_MISSING_ITAL`.
   */
  constructor(
    readonly face: OutlineFace,
    readonly fontName: string,
    readonly fakeBold = false,
    readonly fakeItalic = false,
  ) {}

  /** `OUTLINE_FONT::IsBold` / `IsItalic`: the face's own flag, or the fake. */
  get isBold(): boolean {
    return this.fakeBold || this.face.isBold;
  }
  get isItalic(): boolean {
    return this.fakeItalic || this.face.isItalic;
  }

  /**
   * `OUTLINE_FONT::GetTextAsGlyphs`: tabs are handled here, each run between
   * them by `getTextAsGlyphs`. A tab advances to the next multiple of
   * `TAB_WIDTH × size.x` from the origin.
   *
   * @param size `(size.x, size.y)` — the text size in IU.
   * @param position the baseline-left origin of the run, IU, y down.
   * @param angleDeg the text angle, counter-clockwise on screen as KiCad's
   *   `EDA_ANGLE` is (`RotatePoint` with y down).
   * @param origin the point the run is rotated and mirrored about.
   */
  getTextAsGlyphs(
    text: string,
    size: Vec2,
    position: Vec2,
    angleDeg: number,
    mirror: boolean,
    origin: Vec2,
    style: OutlineTextStyle = {},
    collect = true,
  ): OutlineRun {
    const glyphs: OutlineGlyph[] = [];
    const bbox: BBox = { minX: position.x, minY: position.y, maxX: position.x, maxY: position.y };
    let cursor = { ...position };
    let run = '';
    const flush = (): void => {
      if (run === '') return;
      cursor = this.textRun(
        bbox,
        collect ? glyphs : null,
        run,
        size,
        cursor,
        angleDeg,
        mirror,
        origin,
        style,
      );
      run = '';
    };
    for (const c of text) {
      if (c === '\t') {
        flush();
        const tabWidth = KiROUND(size.x * TAB_WIDTH);
        const currentIntrusion = (cursor.x - origin.x) % tabWidth;
        cursor = { x: cursor.x + tabWidth - currentIntrusion, y: cursor.y };
      } else run += c;
    }
    flush();
    return { glyphs, end: cursor, bbox };
  }

  /** `getTextAsGlyphsUnlocked`: one tab-free run. */
  private textRun(
    bbox: BBox,
    glyphs: OutlineGlyph[] | null,
    text: string,
    size: Vec2,
    position: Vec2,
    angleDeg: number,
    mirror: boolean,
    origin: Vec2,
    style: OutlineTextStyle,
  ): Vec2 {
    const face = this.face;
    const supersub = !!(style.subscript || style.superscript);
    // `scaler`: the face size the outline is read at, and so the number of
    // glyph units in one em for this run.
    const scaler = supersub ? subscriptSize() : faceSize();
    const unitsPerFontUnit = emUnits(face, scaler) / face.unitsPerEm;
    const shaped = face.shape(text);
    const scaleX = (size.x / faceSize()) * OUTLINE_FONT_SIZE_COMPENSATION;
    const scaleY = (-size.y / faceSize()) * OUTLINE_FONT_SIZE_COMPENSATION;
    const cursor = { x: 0, y: 0 };
    const a = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    for (const sg of shaped) {
      if (glyphs) {
        const data = this.glyphData(sg, scaler, unitsPerFontUnit);
        const rings: Vec2[][] = [];
        const holes: Vec2[][] = [];
        for (const c of data.contours) {
          const ring: Vec2[] = [];
          for (const v of c.points) {
            let x = v.x + cursor.x;
            let y = v.y + cursor.y;
            if (style.subscript) y += SUBSCRIPT_VERTICAL_OFFSET * scaler;
            else if (style.superscript) y += SUPERSCRIPT_VERTICAL_OFFSET * scaler;
            x = x * scaleX + position.x;
            y = y * scaleY + position.y;
            if (mirror) x = origin.x - (x - origin.x);
            if (a !== 0) {
              // `RotatePoint( pt, aOrigin, aAngle )`: KiCad's rotation on a
              // y-down plane, positive angles counter-clockwise on screen.
              const dx = x - origin.x;
              const dy = y - origin.y;
              x = origin.x + dx * cos + dy * sin;
              y = origin.y - dx * sin + dy * cos;
            }
            ring.push({ x, y });
          }
          if (contourIsFilled(c)) rings.push(ring);
          else holes.push(ring);
        }
        // Holes go in after the outlines, which is all the ring order needs
        // to say: a hole inside an outline cancels it under non-zero
        // winding, and one inside nothing fills on its own, both as upstream.
        for (const h of holes) rings.push(h);
        glyphs.push({ rings });
      }
      cursor.x += sg.xAdvance * unitsPerFontUnit;
      cursor.y += sg.yAdvance * unitsPerFontUnit;
    }

    // `face->size->metrics.ascender` / `descender`, in glyph units at the
    // run's scaler (the sub/superscript face size when that applies).
    const ascender = Math.abs(face.ascender * unitsPerFontUnit);
    const descender = Math.abs(face.descender * unitsPerFontUnit);
    mergeBBox(bbox, { x: position.x, y: position.y - ascender * Math.abs(scaleY) });
    mergeBBox(bbox, {
      x: position.x + cursor.x * scaleX,
      y: position.y + descender * Math.abs(scaleY),
    });

    return { x: position.x + cursor.x * scaleX, y: position.y - cursor.y * scaleY };
  }

  /**
   * The glyph's contours in glyph units at `scaler`, cached per (glyph,
   * scaler) as `s_glyphCache` is — the fake styles are constant per font, so
   * they need not be in the key.
   */
  private glyphData(sg: ShapedGlyph, scaler: number, unitsPerFontUnit: number): GlyphData {
    const key = `${sg.id}|${scaler}`;
    let data = this.glyphCache.get(key);
    if (data) return data;
    const face = this.face;
    let commands: readonly OutlineCommand[] = [];
    let unreadable = false;
    try {
      commands = face.outline(sg.id);
    } catch {
      unreadable = true;
    }
    if (commands.length && this.fakeItalic) {
      // `FT_Set_Transform` with the 12° shear matrix: x' = cos·x − sin·y
      // for angle −12°, i.e. x' = 0.978x + 0.208y (y up: tops lean right).
      const angle = (-Math.PI * 12) / 180;
      const xx = Math.cos(angle);
      const xy = -Math.sin(angle);
      commands = commands.map((c) => {
        switch (c.type) {
          case 'M':
          case 'L':
            return { type: c.type, x: xx * c.x + xy * c.y, y: c.y };
          case 'Q':
            return {
              type: 'Q',
              x1: xx * c.x1 + xy * c.y1,
              y1: c.y1,
              x: xx * c.x + xy * c.y,
              y: c.y,
            };
          case 'C':
            return {
              type: 'C',
              x1: xx * c.x1 + xy * c.y1,
              y1: c.y1,
              x2: xx * c.x2 + xy * c.y2,
              y2: c.y2,
              x: xx * c.x + xy * c.y,
              y: c.y,
            };
          default:
            return c;
        }
      });
    }
    // `.notdef` (id 0) is loaded like any glyph: `FT_Load_Glyph( face, 0 )`
    // gives the font's own missing-glyph box. The tofu below is for a glyph
    // FreeType could not decompose, which for us is one opentype.js threw on.
    let orientation: ReturnType<OutlineFace['orientation']> = 'none';
    let contours: Contour[] | null = null;
    if (!unreadable) {
      try {
        orientation = face.orientation(sg.id);
        contours = outlineToSegments(commands, unitsPerFontUnit, orientation);
      } catch {
        contours = null;
      }
    }
    if (contours && this.fakeBold && orientation !== 'none') {
      for (const c of contours) c.points = embolden(c.points, FAKE_BOLD_STRENGTH, orientation);
    }
    if (!contours) {
      // The tofu box: a rectangle 0.72 of the face size tall over the
      // advance, with a 0.06 wall. Upstream builds both rings from
      // `BOX2D::GetPosition()` and `GetSize()` and uses the SIZE as the far
      // corner, which is what the arithmetic below reproduces.
      const hbAdvance = sg.xAdvance * unitsPerFontUnit;
      const x0 = scaler * 0.03;
      const y0 = 0;
      const x1 = hbAdvance - scaler * 0.02;
      const y1 = scaler * 0.72;
      const outline: Contour = {
        winding: 1,
        orientation: 'truetype',
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      };
      const hx0 = x0 + scaler * 0.06;
      const hy0 = y0 + scaler * 0.06;
      // `SetSize( { GetWidth() - 0.06s, GetHeight() - 0.06s } )` after the
      // move: the far corner comes in by 0.06s as well.
      const hx1 = x1 - scaler * 0.06;
      const hy1 = y1 - scaler * 0.06;
      const hole: Contour = {
        winding: 1,
        orientation: 'none',
        points: [
          { x: hx0, y: hy0 },
          { x: hx1, y: hy0 },
          { x: hx1, y: hy1 },
          { x: hx0, y: hy1 },
        ],
      };
      contours = [outline, hole];
    }
    data = { contours };
    this.glyphCache.set(key, data);
    return data;
  }
}

function mergeBBox(b: BBox, p: Vec2): void {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}
