// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PDF_OUTLINE_FONT_SUBSET` / `PDF_OUTLINE_FONT_MANAGER`: KiCad's
 * `common/plotters/pdf_outline_font.cpp` and
 * `include/plotters/pdf_outline_font.h`. An outline (TrueType/OpenType) font
 * as a PDF CIDFontType2 with Identity-H encoding: two-byte CIDs, a CIDToGIDMap,
 * the whole font file embedded as `/FontFile2`, and a ToUnicode map.
 *
 * FreeType and HarfBuzz are answered by the face (`OutlineFace`,
 * outline_face.ts): the face's `head` bbox, OS/2 `fsType`, unscaled advances
 * and shaped runs with their clusters. `FontFileData` is the file the face was
 * parsed from rather than a re-read of `GetFileName()`; a face without it
 * embeds nothing, which is what upstream does when the file cannot be opened.
 */

import { ITALIC_TILT } from '../font/font_metrics.js';
import { EMBEDDING_PERMISSION, type OUTLINE_FONT } from '../font/outline_font.js';

const TEXT_ENCODER = new TextEncoder();

const hex = (aValue: number, aDigits: number): string =>
  aValue.toString(16).toUpperCase().padStart(aDigits, '0');

function formatUnicodeHex(aCodepoint: number): string {
  if (aCodepoint <= 0xffff) return hex(aCodepoint, 4);

  if (aCodepoint <= 0x10ffff) {
    const value = aCodepoint - 0x10000;
    const high = 0xd800 + (value >> 10);
    const low = 0xdc00 + (value & 0x3ff);
    return `${hex(high, 4)}${hex(low, 4)}`;
  }

  return '003F';
}

function generateSubsetPrefix(aSubsetIndex: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const prefix = ['A', 'A', 'A', 'A', 'A', 'A'];
  let index = aSubsetIndex;

  for (let ii = 5; ii >= 0; --ii) {
    prefix[ii] = letters[index % 26]!;
    index = Math.trunc(index / 26);
  }

  return prefix.join('');
}

function unitsToPdf(aValue: number, aUnitsPerEm: number): number {
  if (aUnitsPerEm === 0.0) return 0.0;

  return (aValue * 1000.0) / aUnitsPerEm;
}

/** `lrint`: round half to even, as the default FE_TONEAREST mode does. */
function lrint(aValue: number): number {
  const floor = Math.floor(aValue);
  const diff = aValue - floor;

  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;

  return floor % 2 === 0 ? floor : floor + 1;
}

export interface PDF_OUTLINE_FONT_GLYPH {
  cid: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface PDF_OUTLINE_FONT_RUN {
  m_subset: PDF_OUTLINE_FONT_SUBSET;
  m_bytes: number[];
  m_glyphs: PDF_OUTLINE_FONT_GLYPH[];
}

/** Code points, as `std::u32string`. */
type U32 = readonly number[];

export class PDF_OUTLINE_FONT_SUBSET {
  private m_font: OUTLINE_FONT | null;
  private m_resourceName: string;
  private m_baseFontName: string;
  private m_widths: number[] = [];
  private m_cidToGid: number[] = [];
  private m_cidToUnicode: U32[] = [];
  /** `std::map<GLYPH_KEY, uint16_t>`: glyph index and unicode; only looked up, never walked. */
  private m_glyphMap = new Map<string, number>();
  private m_unitsPerEm = 1000.0;
  private m_ascent = 0.0;
  private m_descent = 0.0;
  private m_capHeight = 0.0;
  private m_italicAngle = 0.0;
  private m_stemV = 80.0;
  private m_bboxMinX = 0.0;
  private m_bboxMinY = 0.0;
  private m_bboxMaxX = 0.0;
  private m_bboxMaxY = 0.0;
  private m_flags = 32;
  private m_fontData: Uint8Array = new Uint8Array(0);
  private m_fontDataLoaded = false;
  private m_nextCID = 1;
  private m_fontFileHandle = -1;
  private m_fontDescriptorHandle = -1;
  private m_cidFontHandle = -1;
  private m_cidMapHandle = -1;
  private m_toUnicodeHandle = -1;
  private m_fontHandle = -1;

  constructor(aFont: OUTLINE_FONT | null, aSubsetIndex: number) {
    this.m_font = aFont;
    this.m_resourceName = PDF_OUTLINE_FONT_SUBSET.makeResourceName(aSubsetIndex);
    this.m_baseFontName = PDF_OUTLINE_FONT_SUBSET.makeSubsetName(aFont, aSubsetIndex);

    const face = aFont ? (aFont.GetFace()?.face ?? null) : null;

    if (face) {
      if (face.unitsPerEm > 0) this.m_unitsPerEm = face.unitsPerEm;

      const bbox = face.bbox ?? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

      this.m_ascent = unitsToPdf(face.ascender, this.m_unitsPerEm);
      this.m_descent = unitsToPdf(face.descender, this.m_unitsPerEm);
      this.m_capHeight = unitsToPdf(bbox.yMax, this.m_unitsPerEm);
      this.m_bboxMinX = unitsToPdf(bbox.xMin, this.m_unitsPerEm);
      this.m_bboxMinY = unitsToPdf(bbox.yMin, this.m_unitsPerEm);
      this.m_bboxMaxX = unitsToPdf(bbox.xMax, this.m_unitsPerEm);
      this.m_bboxMaxY = unitsToPdf(bbox.yMax, this.m_unitsPerEm);

      if (face.isItalic) this.m_italicAngle = -12.0;
      else if (aFont!.IsItalic()) this.m_italicAngle = -12.0;

      if (aFont!.IsBold()) this.m_stemV = 140.0;

      if (face.isFixedPitch) this.m_flags |= 1;

      if (aFont!.IsItalic()) this.m_flags |= 64;
    }

    this.m_widths = [0.0];
    this.m_cidToGid = [0];
    this.m_cidToUnicode = [[]];
  }

  HasGlyphs(): boolean {
    return this.m_nextCID > 1;
  }

  private ensureNotdef(): void {
    if (this.m_widths.length === 0) {
      this.m_widths = [0.0];
      this.m_cidToGid = [0];
      this.m_cidToUnicode = [[]];
    }
  }

  EnsureGlyph(aGlyphIndex: number, aUnicode: U32): number {
    if (aGlyphIndex === 0) return 0;

    const key = `${aGlyphIndex}:${aUnicode.join(',')}`;
    const existing = this.m_glyphMap.get(key);

    if (existing !== undefined) return existing;

    this.ensureNotdef();

    const face = this.m_font ? (this.m_font.GetFace()?.face ?? null) : null;

    if (!face) return 0;

    // For FT_LOAD_NO_SCALE the advance is in font units.
    const rawAdvanceFontUnits = face.advance ? face.advance(aGlyphIndex) : 0;
    const advance = unitsToPdf(rawAdvanceFontUnits, this.m_unitsPerEm);

    const cid = this.m_nextCID++;

    while (this.m_widths.length <= cid) this.m_widths.push(0.0);
    while (this.m_cidToGid.length <= cid) this.m_cidToGid.push(0);
    while (this.m_cidToUnicode.length <= cid) this.m_cidToUnicode.push([]);

    this.m_widths[cid] = advance;
    this.m_cidToGid[cid] = aGlyphIndex & 0xffff;
    this.m_cidToUnicode[cid] = [...aUnicode];

    this.m_glyphMap.set(key, cid);

    return cid;
  }

  FontFileData(): Uint8Array {
    if (!this.m_fontDataLoaded) {
      this.m_fontDataLoaded = true;

      if (!this.m_font) return this.m_fontData;

      const data = this.m_font.GetFace()?.face.fontData;

      if (data && data.length > 0) this.m_fontData = data;
    }

    return this.m_fontData;
  }

  BuildWidthsArray(): string {
    // Return empty if there are no glyphs beyond .notdef
    if (this.m_nextCID <= 1) return '[]';

    // PDF expects widths in 1000/em units for CIDFontType2 /W array entries.
    // m_widths currently stores advance in PDF user units produced by unitsToPdf().
    // This is a bit of a fudge factor to reconstruct the output width
    const designScale = 0.0072 * 2.25;

    let buffer = '[ 1 [';

    for (let cid = 1; cid < this.m_nextCID; ++cid) {
      const adv = this.m_widths[cid]!;
      let width1000 = 0;

      if (designScale !== 0.0) width1000 = lrint(adv / designScale);

      buffer += ` ${width1000}`;
    }

    buffer += ' ] ]';
    return buffer;
  }

  BuildToUnicodeCMap(): string {
    if (this.m_nextCID <= 1) return '';

    let buffer = '';

    const cmapName = `${this.m_baseFontName}_ToUnicode`;

    buffer += '/CIDInit /ProcSet findresource begin\n';
    buffer += '12 dict begin\n';
    buffer += 'begincmap\n';
    buffer += '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n';
    buffer += `/CMapName /${cmapName} def\n`;
    buffer += '/CMapType 2 def\n';
    buffer += '1 begincodespacerange\n';
    buffer += '<0000> <FFFF>\n';
    buffer += 'endcodespacerange\n';

    let mappingCount = 0;

    for (let cid = 1; cid < this.m_nextCID; ++cid) {
      if (this.m_cidToUnicode[cid]!.length > 0) ++mappingCount;
    }

    buffer += `${mappingCount} beginbfchar\n`;

    for (let cid = 1; cid < this.m_nextCID; ++cid) {
      const unicode = this.m_cidToUnicode[cid]!;

      if (unicode.length === 0) continue;

      buffer += `<${hex(cid, 4)}> <`;

      for (const codepoint of unicode) buffer += formatUnicodeHex(codepoint);

      buffer += '>\n';
    }

    buffer += 'endbfchar\n';
    buffer += 'endcmap\n';
    buffer += 'CMapName currentdict /CMap defineresource pop\n';
    buffer += 'end\n';
    buffer += 'end\n';

    return buffer;
  }

  BuildCIDToGIDStream(): Uint8Array {
    if (this.m_nextCID === 0) return new Uint8Array(0);

    const data = new Uint8Array(this.m_nextCID * 2);

    for (let cid = 0; cid < this.m_nextCID; ++cid) {
      const gid = cid < this.m_cidToGid.length ? this.m_cidToGid[cid]! : 0;
      data[cid * 2] = (gid >> 8) & 0xff;
      data[cid * 2 + 1] = gid & 0xff;
    }

    return data;
  }

  ResourceName(): string {
    return this.m_resourceName;
  }
  BaseFontName(): string {
    return this.m_baseFontName;
  }
  Widths(): readonly number[] {
    return this.m_widths;
  }
  CIDToGID(): readonly number[] {
    return this.m_cidToGid;
  }
  CIDToUnicode(): readonly U32[] {
    return this.m_cidToUnicode;
  }
  UnitsPerEm(): number {
    return this.m_unitsPerEm;
  }
  Ascent(): number {
    return this.m_ascent;
  }
  Descent(): number {
    return this.m_descent;
  }
  CapHeight(): number {
    return this.m_capHeight;
  }
  ItalicAngle(): number {
    return this.m_italicAngle;
  }
  StemV(): number {
    return this.m_stemV;
  }
  BBoxMinX(): number {
    return this.m_bboxMinX;
  }
  BBoxMinY(): number {
    return this.m_bboxMinY;
  }
  BBoxMaxX(): number {
    return this.m_bboxMaxX;
  }
  BBoxMaxY(): number {
    return this.m_bboxMaxY;
  }
  Flags(): number {
    return this.m_flags;
  }

  SetFontFileHandle(aHandle: number): void {
    this.m_fontFileHandle = aHandle;
  }
  FontFileHandle(): number {
    return this.m_fontFileHandle;
  }
  SetFontDescriptorHandle(aHandle: number): void {
    this.m_fontDescriptorHandle = aHandle;
  }
  FontDescriptorHandle(): number {
    return this.m_fontDescriptorHandle;
  }
  SetCIDFontHandle(aHandle: number): void {
    this.m_cidFontHandle = aHandle;
  }
  CIDFontHandle(): number {
    return this.m_cidFontHandle;
  }
  SetCIDMapHandle(aHandle: number): void {
    this.m_cidMapHandle = aHandle;
  }
  CIDMapHandle(): number {
    return this.m_cidMapHandle;
  }
  SetToUnicodeHandle(aHandle: number): void {
    this.m_toUnicodeHandle = aHandle;
  }
  ToUnicodeHandle(): number {
    return this.m_toUnicodeHandle;
  }
  SetFontHandle(aHandle: number): void {
    this.m_fontHandle = aHandle;
  }
  FontHandle(): number {
    return this.m_fontHandle;
  }
  Font(): OUTLINE_FONT | null {
    return this.m_font;
  }

  ForceSyntheticStyle(aBold: boolean, aItalic: boolean, aItalicAngleDeg: number): void {
    if (aBold) this.m_flags |= 1; // force bold flag
    if (aItalic) this.m_flags |= 64; // force italic flag
    if (aItalic) this.m_italicAngle = aItalicAngleDeg; // negative for right-leaning
    if (aBold && this.m_stemV < 140.0) this.m_stemV = 140.0; // boost stem weight heuristic
  }

  private static makeResourceName(aSubsetIndex: number): string {
    return `/KiCadOutline${aSubsetIndex}`;
  }

  /** `sanitizeFontName`: every byte of the UTF-8 name that is not alphanumeric becomes '-'. */
  private static sanitizeFontName(aName: string): string {
    let sanitized = '';

    for (const ch of TEXT_ENCODER.encode(aName)) {
      const c = String.fromCharCode(ch);
      sanitized += /[A-Za-z0-9]/.test(c) ? c : '-';
    }

    if (sanitized === '') sanitized = 'Font';

    return sanitized;
  }

  private static makeSubsetName(aFont: OUTLINE_FONT | null, aSubsetIndex: number): string {
    const prefix = generateSubsetPrefix(aSubsetIndex);
    const name = aFont ? PDF_OUTLINE_FONT_SUBSET.sanitizeFontName(aFont.GetName()) : 'Font';
    return `${prefix}+${name}`;
  }
}

/** `utf8ToU32`: the code points of a UTF-8 byte run. */
function utf8ToU32(aUtf8: Uint8Array): number[] {
  return Array.from(new TextDecoder().decode(aUtf8), (c) => c.codePointAt(0)!);
}

export class PDF_OUTLINE_FONT_MANAGER {
  /**
   * `std::map<SUBSET_KEY, …>`, ordered by font *pointer*, then italic, then
   * bold. Pointer order is allocation order in practice; here fonts are
   * ranked by first sight, which is the same for the fonts one plot sees.
   */
  private m_subsets: {
    font: OUTLINE_FONT;
    italic: boolean;
    bold: boolean;
    subset: PDF_OUTLINE_FONT_SUBSET;
  }[] = [];
  private m_fontRank = new Map<OUTLINE_FONT, number>();
  private m_nextSubsetIndex = 0;

  Reset(): void {
    this.m_subsets = [];
    this.m_fontRank = new Map();
    this.m_nextSubsetIndex = 0;
  }

  private ensureSubset(
    aFont: OUTLINE_FONT | null,
    aItalic: boolean,
    aBold: boolean,
  ): PDF_OUTLINE_FONT_SUBSET | null {
    if (!aFont) return null;

    const found = this.m_subsets.find(
      (s) => s.font === aFont && s.italic === aItalic && s.bold === aBold,
    );

    if (found) return found.subset;

    const subset = new PDF_OUTLINE_FONT_SUBSET(aFont, this.m_nextSubsetIndex++);

    // Synthetic style application: if requested styles not actually present in font face flags.
    // Distinguish real face style from fake style flags so that a fake italic does not block
    // PDF shear application. We consider the face to have a real italic only if FT_STYLE_FLAG_ITALIC
    // is set. (m_fakeItal only indicates substitution missing an italic variant.)
    let faceHasRealItalic = false;
    let faceHasRealBold = false;
    const face = aFont.GetFace()?.face;

    if (face) {
      faceHasRealItalic = face.isItalic;
      faceHasRealBold = face.isBold;
    }

    const needSyntheticItalic = aItalic && !faceHasRealItalic; // ignore fake italic
    const needSyntheticBold = aBold && !faceHasRealBold; // ignore fake bold

    if (needSyntheticItalic || needSyntheticBold) {
      // Approx italic angle based on shear ITALIC_TILT (radians) => degrees
      const angleDeg = (-Math.atan(ITALIC_TILT) * 180.0) / Math.PI; // negative for conventional PDF italicAngle
      subset.ForceSyntheticStyle(needSyntheticBold, needSyntheticItalic, angleDeg);
    }

    if (!this.m_fontRank.has(aFont)) this.m_fontRank.set(aFont, this.m_fontRank.size);

    const rank = (f: OUTLINE_FONT): number => this.m_fontRank.get(f)!;
    const entry = { font: aFont, italic: aItalic, bold: aBold, subset };
    const before = (a: typeof entry, b: typeof entry): boolean => {
      if (rank(a.font) !== rank(b.font)) return rank(a.font) < rank(b.font);
      if (a.italic !== b.italic) return !a.italic;
      return !a.bold && b.bold;
    };

    let index = 0;

    while (index < this.m_subsets.length && before(this.m_subsets[index]!, entry)) index++;

    this.m_subsets.splice(index, 0, entry);
    return subset;
  }

  EncodeString(
    aText: string,
    aFont: OUTLINE_FONT | null,
    aItalicRequested: boolean,
    aBoldRequested: boolean,
    aRuns: PDF_OUTLINE_FONT_RUN[],
  ): void {
    if (!aFont) return;

    const permission = aFont.GetEmbeddingPermission();

    if (
      permission !== EMBEDDING_PERMISSION.INSTALLABLE &&
      permission !== EMBEDDING_PERMISSION.EDITABLE
    ) {
      return;
    }

    // If italic requested and font has a dedicated italic variant discoverable via style linkage,
    // the caller should already have selected that font (aFont). We still separate subsets by
    // italic flag so synthetic slant and regular do not share widths.
    const subset = this.ensureSubset(aFont, aItalicRequested, aBoldRequested);

    if (!subset) return;

    const face = aFont.GetFace()?.face;

    if (!face) return;

    const textUtf8 = TEXT_ENCODER.encode(aText);
    const glyphs = face.shape(aText);

    if (glyphs.length === 0) return;

    const run: PDF_OUTLINE_FONT_RUN = { m_subset: subset, m_bytes: [], m_glyphs: [] };

    let hasVisibleGlyph = false;

    for (let ii = 0; ii < glyphs.length; ++ii) {
      const glyphIndex = glyphs[ii]!.id;

      let clusterStart = glyphs[ii]!.cluster ?? 0;
      let clusterEnd = ii + 1 < glyphs.length ? (glyphs[ii + 1]!.cluster ?? 0) : textUtf8.length;

      if (clusterEnd < clusterStart) [clusterStart, clusterEnd] = [clusterEnd, clusterStart];

      const unicode = utf8ToU32(textUtf8.subarray(clusterStart, clusterEnd));

      if (unicode.length === 0) unicode.push(0);

      const cid = subset.EnsureGlyph(glyphIndex, unicode);

      if (cid !== 0) hasVisibleGlyph = true;

      run.m_bytes.push((cid >> 8) & 0xff);
      run.m_bytes.push(cid & 0xff);

      // HarfBuzz positioning, font units, converted to PDF units
      const upem = subset.UnitsPerEm();
      run.m_glyphs.push({
        cid,
        xAdvance: unitsToPdf(glyphs[ii]!.xAdvance, upem),
        yAdvance: unitsToPdf(glyphs[ii]!.yAdvance, upem),
        xOffset: unitsToPdf(glyphs[ii]!.xOffset ?? 0, upem),
        yOffset: unitsToPdf(glyphs[ii]!.yOffset ?? 0, upem),
      });
    }

    if (hasVisibleGlyph && run.m_bytes.length > 0) aRuns.push(run);
  }

  AllSubsets(): PDF_OUTLINE_FONT_SUBSET[] {
    return this.m_subsets.map((s) => s.subset);
  }
}
