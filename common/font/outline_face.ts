// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What `OUTLINE_FONT` asks of FreeType and HarfBuzz, as one interface, and the
 * one implementation of it we have: an OpenType/TrueType file parsed by
 * opentype.js.
 *
 * KiCad reads a face through FreeType (`FT_New_Face`, `FT_Load_Glyph`,
 * `FT_Outline_Decompose`) and shapes a run through HarfBuzz (`hb_shape`, which
 * gives glyph ids, advances and kerning). Neither library exists in a browser,
 * so the questions they answer are stated here and answered by opentype.js:
 *
 *   glyph lookup   `FT_Get_Char_Index`            → `glyphIndex`
 *   outline        `FT_Outline_Decompose`         → `outline` (move/line/quad/cubic)
 *   shaping        `hb_shape`                     → `shape` (ids + advances)
 *   metrics        `face->size->metrics.ascender` → `ascender` / `descender`
 *
 * Where the answers differ is recorded on each method. The one that matters:
 * HarfBuzz applies every GSUB/GPOS feature the font carries — ligatures,
 * contextual forms, mark positioning — where `shape` applies pair kerning
 * only. For Latin text at the sizes a schematic uses that is the visible
 * part; a font with an `fi` ligature draws two glyphs here and one in KiCad.
 *
 * Coordinates are FONT UNITS (`unitsPerEm` per em, y up), which is what
 * FreeType's outline holds before `FT_Set_Char_Size` scales it. The scaling
 * to KiCad's glyph units is `outline_font.ts`'s job, so the face adapter
 * stays a plain reading of the file.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { parse as parseOpenType, type Font, type Glyph } from 'opentype.js';

/** One drawing command of a glyph outline, in font units. */
export type OutlineCommand =
  | { readonly type: 'M'; readonly x: number; readonly y: number }
  | { readonly type: 'L'; readonly x: number; readonly y: number }
  | {
      readonly type: 'Q';
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'Z' };

/** One shaped glyph of a run: `hb_glyph_info_t` + `hb_glyph_position_t`. */
export interface ShapedGlyph {
  /** Glyph id; 0 is `.notdef`, which draws as a tofu box upstream. */
  readonly id: number;
  /** `x_advance`, in font units, kerning included. */
  readonly xAdvance: number;
  /** `y_advance`; zero for horizontal scripts. */
  readonly yAdvance: number;
}

/**
 * `FT_Outline_Get_Orientation`: which way a filled contour turns in this
 * face. TrueType outlines fill clockwise, PostScript (CFF) ones
 * counter-clockwise, and `OUTLINE_FONT::contourIsFilled` reads a contour's
 * winding against this.
 */
export type OutlineOrientation = 'truetype' | 'postscript' | 'none';

export interface OutlineFace {
  /** The family name the file declares. */
  readonly familyName: string;
  readonly unitsPerEm: number;
  /** `hhea` ascender / descender in font units (descender negative). */
  readonly ascender: number;
  readonly descender: number;
  /** `FT_STYLE_FLAG_BOLD` / `_ITALIC`: what the face itself is. */
  readonly isBold: boolean;
  readonly isItalic: boolean;
  /**
   * `head.flags` bit 3, "ppem must be rounded to integers". FreeType's
   * TrueType driver honours it (`tt_size_reset`): the scale a glyph is
   * loaded at is `x_ppem << 6 / unitsPerEM` with the ppem rounded, not the
   * requested fractional size — so at KiCad's 358.25 ppem such a face is
   * drawn at 358, 0.07 % smaller, and [px] the kicad-cli SVG of a Liberation
   * Sans run is exactly that much narrower than the unrounded arithmetic.
   */
  readonly integerPpem: boolean;
  /** `FT_Get_Char_Index`: 0 when the face has no glyph for the codepoint. */
  glyphIndex(codepoint: number): number;
  /** `hb_shape` over a run: one entry per glyph, in order. */
  shape(text: string): ShapedGlyph[];
  /** `FT_Load_Glyph` + the outline, in font units, y up. */
  outline(glyphId: number): readonly OutlineCommand[];
  /** `FT_Outline_Get_Orientation` for one glyph's outline. */
  orientation(glyphId: number): OutlineOrientation;
}

/**
 * An `OutlineFace` over a parsed opentype.js `Font`.
 *
 * `parseOutlineFace` takes the file's bytes; a face is parsed once and read
 * many times, and `outline` results are cached per glyph because the
 * renderer asks for the same few dozen glyphs on every frame.
 */
export class OpenTypeFace implements OutlineFace {
  readonly familyName: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly isBold: boolean;
  readonly isItalic: boolean;
  readonly integerPpem: boolean;
  private readonly outlines = new Map<number, readonly OutlineCommand[]>();
  private readonly orientations = new Map<number, OutlineOrientation>();

  constructor(private readonly font: Font) {
    const family = (font.names as { fontFamily?: Record<string, string> }).fontFamily ?? {};
    this.familyName = family.en ?? Object.values(family)[0] ?? '';
    this.unitsPerEm = font.unitsPerEm;
    this.ascender = font.ascender;
    this.descender = font.descender;
    // FreeType sets FT_STYLE_FLAG_BOLD from the OS/2 fsSelection / head
    // macStyle bits, and FT_STYLE_FLAG_ITALIC likewise. opentype.js exposes
    // both tables raw.
    const tables = font.tables as {
      os2?: { fsSelection?: number };
      head?: { macStyle?: number; flags?: number };
      cff?: unknown;
    };
    const fsSelection = tables.os2?.fsSelection ?? 0;
    const macStyle = tables.head?.macStyle ?? 0;
    this.isBold = (fsSelection & 0x20) !== 0 || (macStyle & 0x01) !== 0;
    this.isItalic = (fsSelection & 0x01) !== 0 || (macStyle & 0x02) !== 0;
    // The TrueType driver's rule; the CFF driver has no such rounding.
    this.integerPpem = !tables.cff && ((tables.head?.flags ?? 0) & 8) !== 0;
  }

  glyphIndex(codepoint: number): number {
    const g = this.font.charToGlyphIndex(String.fromCodePoint(codepoint));
    return g > 0 ? g : 0;
  }

  /**
   * Pair kerning only — see the module header. `.notdef` (id 0) stands in for
   * a codepoint the face lacks, with its own advance, which is what HarfBuzz
   * reports for an unmapped character and what the tofu box is sized by.
   *
   * The GPOS `kern` feature lives under a SCRIPT, and `hb_buffer_guess_
   * segment_properties` picks the script from the text. opentype.js's own
   * `getKerningValue` looks only under `DFLT`, where Liberation Sans keeps no
   * features at all — so "AV" came out unkerned while the font carries −152.
   * The script is guessed here the same way, from the first letter.
   */
  shape(text: string): ShapedGlyph[] {
    const out: ShapedGlyph[] = [];
    const tables = this.kerningTables(text);
    let prev: Glyph | null = null;
    for (const ch of text) {
      const id = this.glyphIndex(ch.codePointAt(0)!);
      const glyph = this.font.glyphs.get(id);
      const xAdvance = glyph.advanceWidth ?? 0;
      if (prev && tables) {
        // HarfBuzz applies the pair to the LEFT glyph's advance.
        const k = this.position().getKerningValue(tables, prev.index, glyph.index);
        if (k && out.length) {
          const left = out[out.length - 1]!;
          out[out.length - 1] = { ...left, xAdvance: left.xAdvance + k };
        }
      }
      out.push({ id, xAdvance, yAdvance: 0 });
      prev = glyph;
    }
    return out;
  }

  private readonly kerningByScript = new Map<string, unknown[] | null>();

  /** opentype.js's `Position` object, which its typings leave off `Font`. */
  private position(): {
    getKerningTables(script: string, language: string): unknown[];
    getKerningValue(tables: unknown[], left: number, right: number): number;
  } {
    return (this.font as unknown as { position: ReturnType<OpenTypeFace['position']> }).position;
  }

  /** The `kern` lookups for the text's script, `DFLT`'s when it has none. */
  private kerningTables(text: string): unknown[] | null {
    const tag = scriptTag(text);
    let tables = this.kerningByScript.get(tag);
    if (tables === undefined) {
      const position = this.position();
      tables = position.getKerningTables(tag, 'dflt');
      if (!tables?.length) tables = position.getKerningTables('DFLT', 'dflt');
      if (!tables?.length) tables = null;
      this.kerningByScript.set(tag, tables);
    }
    return tables;
  }

  outline(glyphId: number): readonly OutlineCommand[] {
    let cmds = this.outlines.get(glyphId);
    if (!cmds) {
      const glyph = this.font.glyphs.get(glyphId);
      // opentype.js's path is in font units already; `getPath` with no
      // arguments would scale to 72 units per em, so read `path` directly.
      const path = glyph.path;
      cmds = (path.commands as OutlineCommand[]).map((c) => ({ ...c }));
      this.outlines.set(glyphId, cmds);
    }
    return cmds;
  }

  /**
   * `FT_Outline_Get_Orientation` (ftoutln.c): the signed area of the WHOLE
   * outline by Green's theorem, every contour summed —
   *
   *     area += ( v_cur.y - v_prev.y ) * ( v_cur.x + v_prev.x );
   *     if( area > 0 ) return FT_ORIENTATION_POSTSCRIPT;   // counter-clockwise fills
   *     else if( area < 0 ) return FT_ORIENTATION_TRUETYPE; // clockwise fills
   *     else return FT_ORIENTATION_NONE;
   *
   * — and an outline with no points at all is TRUETYPE. It is decided by
   * geometry, not by the file format, so a CFF font whose glyphs wind
   * clockwise still reads as TrueType-oriented, exactly as it does there.
   */
  orientation(glyphId: number): OutlineOrientation {
    let o = this.orientations.get(glyphId);
    if (o) return o;
    let area = 0;
    let points = 0;
    let start: Vec2 | null = null;
    let prev: Vec2 | null = null;
    const edge = (a: Vec2, b: Vec2): void => {
      area += (b.y - a.y) * (b.x + a.x);
    };
    const close = (): void => {
      if (start && prev && prev !== start) edge(prev, start);
      start = prev = null;
    };
    for (const c of this.outline(glyphId)) {
      if (c.type === 'Z') {
        close();
        continue;
      }
      const p = { x: c.x, y: c.y };
      points++;
      if (c.type === 'M') {
        close();
        start = p;
      } else if (prev) edge(prev, p);
      prev = p;
    }
    close();
    o = points === 0 ? 'truetype' : area > 0 ? 'postscript' : area < 0 ? 'truetype' : 'none';
    this.orientations.set(glyphId, o);
    return o;
  }
}

/**
 * `hb_buffer_guess_segment_properties`'s script, reduced to the scripts a
 * schematic is likely to carry: the first letter's block decides, and
 * anything else is Latin.
 */
function scriptTag(text: string): string {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x0370) return 'latn';
    if (cp < 0x0400) return 'grek';
    if (cp < 0x0530) return 'cyrl';
    if (cp >= 0x0590 && cp < 0x0600) return 'hebr';
    if (cp >= 0x0600 && cp < 0x0700) return 'arab';
    if (cp >= 0x3040 && cp < 0x30ff) return 'kana';
    if (cp >= 0x4e00 && cp < 0xa000) return 'hani';
    if (cp >= 0xac00 && cp < 0xd7b0) return 'hang';
    return 'latn';
  }
  return 'latn';
}

/** `FT_New_Face` from bytes: TrueType (.ttf) and OpenType (.otf), as upstream. */
export function parseOutlineFace(bytes: ArrayBuffer): OpenTypeFace {
  return new OpenTypeFace(parseOpenType(bytes));
}
