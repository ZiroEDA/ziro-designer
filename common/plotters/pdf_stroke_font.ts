// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PDF_STROKE_FONT_SUBSET` / `PDF_STROKE_FONT_MANAGER`: KiCad's
 * `common/plotters/pdf_stroke_font.cpp` and `include/plotters/pdf_stroke_font.h`.
 * The KiCad stroke font as PDF Type 3 fonts, one subset of at most 255 glyphs
 * per style (bold, italic, stroke width, glyph size), so PDF text stays text:
 * selectable, searchable, with a ToUnicode map.
 *
 * `wxUniChar` is a code point here; a string is walked by code point, as
 * wxString's iterator does.
 */

import { ADVANCED_CFG } from '../advanced_config.js';
import type { STROKE_GLYPH } from '../font/glyph.js';
import { STROKE_FONT } from '../font/stroke_font.js';
import { fixed, formatG } from './fmt.js';

const MAX_SIMPLE_FONT_CODES = 256;

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

/** A run of text in one subset: its single-byte codes. */
export interface PDF_STROKE_FONT_RUN {
  m_subset: PDF_STROKE_FONT_SUBSET;
  m_bytes: Uint8Array;
  m_bold: boolean;
  m_italic: boolean;
}

/** `PDF_STROKE_FONT_SUBSET::GLYPH`. */
export interface PDF_STROKE_FONT_GLYPH {
  m_unicode: number;
  m_code: number;
  m_glyphIndex: number;
  m_name: string;
  m_stream: string;
  m_width: number;
  m_minX: number;
  m_minY: number;
  m_maxX: number;
  m_maxY: number;
  m_charProcHandle: number;
}

export class PDF_STROKE_FONT_SUBSET {
  private m_font: STROKE_FONT | null;
  private m_unitsPerEm: number;
  private m_resourceName: string;
  private m_cmapName: string;
  private m_unicodeToCode = new Map<number, number>();
  private m_glyphs: PDF_STROKE_FONT_GLYPH[] = [];
  private m_widths: number[] = new Array<number>(MAX_SIMPLE_FONT_CODES).fill(0.0);
  private m_nextCode = 1;
  private m_lastCode = 0;
  private m_bboxMinX: number;
  private m_bboxMinY: number;
  private m_bboxMaxX: number;
  private m_bboxMaxY: number;
  private m_charProcsHandle = -1;
  private m_fontHandle = -1;
  private m_toUnicodeHandle = -1;
  private m_isBold: boolean;
  private m_isItalic: boolean;
  private m_strokeWidthFactor: number;
  private m_aspectRatio: number;

  constructor(
    aFont: STROKE_FONT | null,
    aUnitsPerEm: number,
    aSubsetIndex: number,
    aBold: boolean,
    aItalic: boolean,
    aStrokeWidthFactor: number,
    aAspectRatio: number,
  ) {
    this.m_font = aFont;
    this.m_unitsPerEm = aUnitsPerEm;
    this.m_resourceName = `/KiCadStroke${aSubsetIndex}`;
    this.m_cmapName = `KiCadStrokeCMap${aSubsetIndex}`;
    this.m_isBold = aBold;
    this.m_isItalic = aItalic;
    this.m_strokeWidthFactor = aStrokeWidthFactor;
    this.m_aspectRatio = aAspectRatio;

    this.m_glyphs.push({
      m_unicode: 0,
      m_code: 0,
      m_glyphIndex: -1,
      m_name: '.notdef',
      m_stream: '',
      m_width: 0.0,
      m_minX: 0.0,
      m_minY: 0.0,
      m_maxX: 0.0,
      m_maxY: 0.0,
      m_charProcHandle: -1,
    });

    this.m_bboxMinX = 0.0;
    this.m_bboxMinY = 0.0;
    this.m_bboxMaxX = 0.0;
    this.m_bboxMaxY = 0.0;
  }

  // Build the stroked path for a glyph.
  // KiCad's internal stroke font glyph coordinates use an inverted Y axis relative to the
  // PDF coordinate system we are targeting here.  We therefore flip Y so text renders upright.
  private buildGlyphStream(aGlyph: STROKE_GLYPH | null): string {
    if (!aGlyph) return '';

    let buffer = '';

    const xEm = this.m_unitsPerEm * this.m_aspectRatio;
    const yEm = this.m_unitsPerEm;

    const lw = this.m_unitsPerEm * this.m_strokeWidthFactor;
    buffer += `${fixed(lw, 3)} w 1 J 1 j `;
    const cfg = ADVANCED_CFG.GetCfg();

    for (const stroke of aGlyph.strokes) {
      let firstPoint = true;

      for (const point of stroke) {
        const x = (point.x + cfg.m_PDFStrokeFontXOffset) * xEm;
        let y = point.y * yEm;

        y = -y; // Mirror vertically about baseline (y=0)
        y += cfg.m_PDFStrokeFontYOffset * yEm;

        if (firstPoint) {
          buffer += `${fixed(x, 3)} ${fixed(y, 3)} m `;
          firstPoint = false;
        } else {
          buffer += `${fixed(x, 3)} ${fixed(y, 3)} l `;
        }
      }

      if (stroke.length > 0) buffer += 'S ';
    }

    return buffer;
  }

  Contains(aCode: number): boolean {
    return this.m_unicodeToCode.has(aCode);
  }

  EnsureGlyph(aCode: number): number {
    const existing = this.m_unicodeToCode.get(aCode);

    if (existing !== undefined) return existing;

    if (this.IsFull()) return -1;

    const glyphIndex = this.glyphIndexForUnicode(aCode);

    const code = this.m_nextCode++;
    this.m_lastCode = Math.max(this.m_lastCode, code);

    let glyph: STROKE_GLYPH | null = null;
    let bboxOrigin = { x: 0, y: 0 };
    let bboxSize = { x: 0, y: 0 };

    if (this.m_font) {
      glyph = this.m_font.GetGlyph(glyphIndex);
      const bbox = this.m_font.GetGlyphBoundingBox(glyphIndex);
      bboxOrigin = bbox.GetOrigin();
      bboxSize = bbox.GetSize();
    }

    const xEm = this.m_unitsPerEm * this.m_aspectRatio;
    const yEm = this.m_unitsPerEm;

    const data: PDF_STROKE_FONT_GLYPH = {
      m_unicode: aCode,
      m_code: code,
      m_glyphIndex: glyphIndex,
      m_name: this.makeGlyphName(code),
      m_stream: '',
      m_width: bboxSize.x * xEm,
      m_minX: bboxOrigin.x * xEm,
      m_minY: bboxOrigin.y * yEm,
      m_maxX: (bboxOrigin.x + bboxSize.x) * xEm,
      m_maxY: (bboxOrigin.y + bboxSize.y) * yEm,
      m_charProcHandle: -1,
    };

    // Invert Y so glyphs render upright in PDF coordinate space.
    {
      // Mirror bounding box vertically about baseline.
      const newMinY = -data.m_maxY;
      const newMaxY = -data.m_minY;
      data.m_minY = newMinY;
      data.m_maxY = newMaxY;

      // Apply Y offset to bounding box to match the offset applied to stroke coordinates
      const yOffset = ADVANCED_CFG.GetCfg().m_PDFStrokeFontYOffset * yEm;
      data.m_minY += yOffset;
      data.m_maxY += yOffset;
    }

    // Apply X offset to bounding box to match the offset applied to stroke coordinates
    const xOffset = ADVANCED_CFG.GetCfg().m_PDFStrokeFontXOffset * xEm;
    data.m_minX += xOffset;
    data.m_maxX += xOffset;

    // Expand bbox by half the stroke width so the d1 clipping rect covers the full painted
    // area, not just the stroke center lines.
    const halfStroke = (this.m_unitsPerEm * this.m_strokeWidthFactor) / 2.0;
    data.m_minX -= halfStroke;
    data.m_minY -= halfStroke;
    data.m_maxX += halfStroke;
    data.m_maxY += halfStroke;

    // Build charproc stream: first specify width and bbox (d1 operator) then stroke path.
    let kerningFactor = ADVANCED_CFG.GetCfg().m_PDFStrokeFontKerningFactor;

    if (kerningFactor <= 0.0) kerningFactor = 1.0;

    const strokes = this.buildGlyphStream(glyph);
    data.m_width = bboxSize.x * xEm * kerningFactor;
    data.m_stream =
      `${fixed(data.m_width, 3)} 0 ${fixed(data.m_minX, 3)} ${fixed(data.m_minY, 3)} ` +
      `${fixed(data.m_maxX, 3)} ${fixed(data.m_maxY, 3)} d1 ${strokes}`;

    this.m_widths[code] = data.m_width;

    this.m_bboxMinX = Math.min(this.m_bboxMinX, data.m_minX);
    this.m_bboxMinY = Math.min(this.m_bboxMinY, data.m_minY);
    this.m_bboxMaxX = Math.max(this.m_bboxMaxX, data.m_maxX);
    this.m_bboxMaxY = Math.max(this.m_bboxMaxY, data.m_maxY);

    this.m_glyphs.push(data);
    this.m_unicodeToCode.set(aCode, code);

    return code;
  }

  CodeForGlyph(aCode: number): number {
    return this.m_unicodeToCode.get(aCode) ?? -1;
  }

  IsFull(): boolean {
    return this.m_nextCode >= MAX_SIMPLE_FONT_CODES;
  }

  GlyphCount(): number {
    return this.m_glyphs.length;
  }

  FirstChar(): number {
    return 0;
  }

  LastChar(): number {
    return Math.max(0, this.m_lastCode);
  }

  UnitsPerEm(): number {
    return this.m_unitsPerEm;
  }

  FontBBoxMinX(): number {
    return this.m_bboxMinX;
  }
  FontBBoxMinY(): number {
    return this.m_bboxMinY;
  }
  FontBBoxMaxX(): number {
    return this.m_bboxMaxX;
  }
  FontBBoxMaxY(): number {
    return this.m_bboxMaxY;
  }

  ResourceName(): string {
    return this.m_resourceName;
  }
  CMapName(): string {
    return this.m_cmapName;
  }
  IsBold(): boolean {
    return this.m_isBold;
  }
  IsItalic(): boolean {
    return this.m_isItalic;
  }

  Glyphs(): PDF_STROKE_FONT_GLYPH[] {
    return this.m_glyphs;
  }

  Widths(): readonly number[] {
    return this.m_widths;
  }

  BuildDifferencesArray(): string {
    const first = this.FirstChar();
    const last = this.LastChar();

    let buffer = `[ ${first} `;

    for (let code = first; code <= last; ++code) {
      const glyph = this.glyphForCode(code);

      if (glyph) buffer += `/${glyph.m_name} `;
      else buffer += '/.notdef ';
    }

    buffer += ']';
    return buffer;
  }

  BuildWidthsArray(): string {
    const first = this.FirstChar();
    const last = this.LastChar();

    let buffer = '[';

    for (let code = first; code <= last; ++code) buffer += ` ${formatG(this.m_widths[code]!)}`;

    buffer += ' ]';
    return buffer;
  }

  BuildToUnicodeCMap(): string {
    let mappingCount = 0;

    for (const glyph of this.m_glyphs) {
      if (glyph.m_code === 0) continue;

      ++mappingCount;
    }

    let buffer = '';

    buffer += '/CIDInit /ProcSet findresource begin\n';
    buffer += '12 dict begin\n';
    buffer += 'begincmap\n';
    buffer += '/CIDSystemInfo << /Registry (KiCad) /Ordering (StrokeFont) /Supplement 0 >> def\n';
    buffer += `/CMapName /${this.m_cmapName} def\n`;
    buffer += '/CMapType 2 def\n';
    buffer += '1 begincodespacerange\n';
    buffer += '<00> <FF>\n';
    buffer += 'endcodespacerange\n';

    buffer += `${mappingCount} beginbfchar\n`;

    for (const glyph of this.m_glyphs) {
      if (glyph.m_code === 0) continue;

      buffer += `<${hex(glyph.m_code, 2)}> <${formatUnicodeHex(glyph.m_unicode)}>\n`;
    }

    buffer += 'endbfchar\n';
    buffer += 'endcmap\n';
    buffer += 'CMapName currentdict /CMap defineresource pop\n';
    buffer += 'end\n';
    buffer += 'end\n';

    return buffer;
  }

  SetCharProcsHandle(aHandle: number): void {
    this.m_charProcsHandle = aHandle;
  }
  CharProcsHandle(): number {
    return this.m_charProcsHandle;
  }

  SetFontHandle(aHandle: number): void {
    this.m_fontHandle = aHandle;
  }
  FontHandle(): number {
    return this.m_fontHandle;
  }

  SetToUnicodeHandle(aHandle: number): void {
    this.m_toUnicodeHandle = aHandle;
  }
  ToUnicodeHandle(): number {
    return this.m_toUnicodeHandle;
  }

  private glyphIndexForUnicode(aCode: number): number {
    const value = aCode;
    const QUESTION = '?'.charCodeAt(0) - ' '.charCodeAt(0);

    if (value < 32) return QUESTION;

    const index = value - 32;
    const count = this.m_font ? this.m_font.GetGlyphCount() : 0;

    if (index < 0 || index >= count) return QUESTION;

    return index;
  }

  private makeGlyphName(aCode: number): string {
    return `g${hex(aCode, 2)}`;
  }

  private glyphForCode(aCode: number): PDF_STROKE_FONT_GLYPH | null {
    for (const glyph of this.m_glyphs) {
      if (glyph.m_code === aCode) return glyph;
    }

    return null;
  }
}

/** `STYLE_KEY`: `std::tuple<bool, bool, int, int, int>`. */
type STYLE_KEY = readonly [boolean, boolean, number, number, number];

/** `std::tuple`'s `operator<`: element by element, `false < true`. */
function compareStyleKeys(a: STYLE_KEY, b: STYLE_KEY): number {
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);

    if (x !== y) return x < y ? -1 : 1;
  }

  return 0;
}

export class PDF_STROKE_FONT_MANAGER {
  private m_font: STROKE_FONT | null;
  private m_unitsPerEm = 1000.0;
  private m_nextSubsetIndex = 0; // global counter for unique resource names
  /** `std::map<STYLE_KEY, STYLE_GROUP>`: kept sorted by key, as the map iterates. */
  private m_styleGroups: { key: STYLE_KEY; subsets: PDF_STROKE_FONT_SUBSET[] }[] = [];

  constructor() {
    this.m_font = STROKE_FONT.LoadFont('');
    this.Reset();
  }

  Reset(): void {
    this.m_styleGroups = [];
    this.m_nextSubsetIndex = 0;

    if (!this.m_font) this.m_font = STROKE_FONT.LoadFont('');
  }

  private static styleKey(
    aBold: boolean,
    aItalic: boolean,
    aStrokeWidth: number,
    aFontWidth: number,
    aFontHeight: number,
  ): STYLE_KEY {
    const strokeWidth = Math.abs(aStrokeWidth);
    const fontWidth = Math.abs(aFontWidth);
    const fontHeight = strokeWidth > 0 ? Math.abs(aFontHeight) : 0;
    return [aBold, aItalic, strokeWidth, fontWidth, fontHeight];
  }

  /** `m_styleGroups[key]`: find, or insert in key order. */
  private group(aKey: STYLE_KEY): PDF_STROKE_FONT_SUBSET[] {
    let index = 0;

    for (; index < this.m_styleGroups.length; index++) {
      const cmp = compareStyleKeys(this.m_styleGroups[index]!.key, aKey);

      if (cmp === 0) return this.m_styleGroups[index]!.subsets;

      if (cmp > 0) break;
    }

    const entry = { key: aKey, subsets: [] as PDF_STROKE_FONT_SUBSET[] };
    this.m_styleGroups.splice(index, 0, entry);
    return entry.subsets;
  }

  EncodeString(
    aText: string,
    aRuns: PDF_STROKE_FONT_RUN[],
    aStrokeWidth: number,
    aFontWidth: number,
    aFontHeight: number,
    aBold = false,
    aItalic = false,
  ): void {
    aRuns.length = 0;

    if (aText === '') return;

    let currentSubset: PDF_STROKE_FONT_SUBSET | null = null;
    let currentBytes: number[] = [];

    for (const c of aText) {
      const ch = c.codePointAt(0)!;
      const subset = this.ensureSubsetForGlyph(
        ch,
        aStrokeWidth,
        aFontWidth,
        aFontHeight,
        aBold,
        aItalic,
      );

      if (!subset) continue;

      const code = subset.EnsureGlyph(ch);

      if (code < 0) continue;

      if (subset !== currentSubset) {
        if (currentBytes.length > 0 && currentSubset)
          aRuns.push({
            m_subset: currentSubset,
            m_bytes: Uint8Array.from(currentBytes),
            m_bold: aBold,
            m_italic: aItalic,
          });

        currentSubset = subset;
        currentBytes = [];
      }

      currentBytes.push(code);
    }

    if (currentBytes.length > 0 && currentSubset)
      aRuns.push({
        m_subset: currentSubset,
        m_bytes: Uint8Array.from(currentBytes),
        m_bold: aBold,
        m_italic: aItalic,
      });
  }

  private ensureSubsetForGlyph(
    aCode: number,
    aStrokeWidth: number,
    aFontWidth: number,
    aFontHeight: number,
    aBold: boolean,
    aItalic: boolean,
  ): PDF_STROKE_FONT_SUBSET | null {
    const strokeWidth = Math.abs(aStrokeWidth);
    const fontWidth = Math.abs(aFontWidth);
    const fontHeight = Math.abs(aFontHeight);

    let widthFactor: number;

    if (strokeWidth > 0 && fontHeight > 0) {
      widthFactor = strokeWidth / fontHeight;
    } else {
      widthFactor = ADVANCED_CFG.GetCfg().m_PDFStrokeFontWidthFactor;

      if (widthFactor <= 0.0) widthFactor = 0.04;

      if (aBold) {
        let boldMul = ADVANCED_CFG.GetCfg().m_PDFStrokeFontBoldMultiplier;

        if (boldMul < 1.0) boldMul = 1.0;

        widthFactor *= boldMul;
      }
    }

    let aspectRatio = 1.0;

    if (fontHeight > 0 && fontWidth > 0) aspectRatio = fontWidth / fontHeight;

    const key = PDF_STROKE_FONT_MANAGER.styleKey(
      aBold,
      aItalic,
      aStrokeWidth,
      aFontWidth,
      aFontHeight,
    );
    const group = this.group(key);

    for (const subset of group) {
      if (subset.Contains(aCode)) return subset;
    }

    for (const subset of group) {
      if (subset.IsFull()) continue;

      if (subset.EnsureGlyph(aCode) >= 0) return subset;
    }

    const subsetIndex = this.m_nextSubsetIndex++;
    const newSubset = new PDF_STROKE_FONT_SUBSET(
      this.m_font,
      this.m_unitsPerEm,
      subsetIndex,
      aBold,
      aItalic,
      widthFactor,
      aspectRatio,
    );
    newSubset.EnsureGlyph(aCode);
    group.push(newSubset);
    return newSubset;
  }

  // Collect all subsets including style-group (bold/italic) subsets. Returned pointers are
  // owned by the manager; vector is a temporary snapshot.
  AllSubsets(): PDF_STROKE_FONT_SUBSET[] {
    const out: PDF_STROKE_FONT_SUBSET[] = [];

    for (const { subsets } of this.m_styleGroups) for (const up of subsets) out.push(up);

    return out;
  }
}
