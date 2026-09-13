// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `font/font.h` / `common/font/font.cpp`: `KIFONT::FONT`, the base of the
 * stroke and outline fonts: the font registry, the line layout, the markup
 * walk, line breaking.
 */

import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { GAL } from '../gal/graphics_abstraction_layer.js';
import { MARKUP_PARSER, type NODE } from '../markup_parser.js';
import { wxStringSplit } from '../string_utils.js';
import { ITALIC_TILT, type METRICS } from './font_metrics.js';
import { type GLYPH_LIKE, STROKE_GLYPH } from './glyph.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T, type TEXT_ATTRIBUTES } from './text_attributes.js';

export enum TEXT_STYLE {
  BOLD = 1,
  ITALIC = 1 << 1,
  SUBSCRIPT = 1 << 2,
  SUPERSCRIPT = 1 << 3,
  OVERBAR = 1 << 4,
  UNDERLINE = 1 << 5,
}

// `font.h`'s `ITALIC_TILT` has its one home in font_metrics.ts.
export { ITALIC_TILT } from './font_metrics.js';

export type TEXT_STYLE_FLAGS = number;

export const IsBold = (aFlags: TEXT_STYLE_FLAGS): boolean => (aFlags & TEXT_STYLE.BOLD) !== 0;
export const IsItalic = (aFlags: TEXT_STYLE_FLAGS): boolean => (aFlags & TEXT_STYLE.ITALIC) !== 0;
export const IsSuperscript = (aFlags: TEXT_STYLE_FLAGS): boolean =>
  (aFlags & TEXT_STYLE.SUPERSCRIPT) !== 0;
export const IsSubscript = (aFlags: TEXT_STYLE_FLAGS): boolean =>
  (aFlags & TEXT_STYLE.SUBSCRIPT) !== 0;

/** `wxString* aActiveUrl` out-parameter. */
export interface OutStr {
  value: string;
}

/** `std::pair<wxString, int>`: a word and its width. */
export type WORD_WIDTH = [string, number];

// The "official" name of the Kicad stroke font (always existing)
export const KICAD_FONT_NAME = 'KiCad Font';

/** `MARKUP_CACHE`: the last 1024 parsed markup strings, most recently used first. */
class MARKUP_CACHE {
  private m_cache = new Map<string, NODE | null>();

  constructor(private readonly m_maxSize: number) {}

  Put(aQuery: string, aResult: NODE | null): NODE | null {
    if (this.m_cache.has(aQuery)) this.m_cache.delete(aQuery);
    this.m_cache.set(aQuery, aResult);

    if (this.m_cache.size > this.m_maxSize) {
      const last = this.m_cache.keys().next().value!;
      this.m_cache.delete(last);
    }

    return aResult;
  }

  Get(aQuery: string): { root: NODE | null } | null {
    if (!this.m_cache.has(aQuery)) return null;

    const root = this.m_cache.get(aQuery)!;
    // move to the front
    this.m_cache.delete(aQuery);
    this.m_cache.set(aQuery, root);

    return { root };
  }

  Clear(): void {
    this.m_cache.clear();
  }
}

const s_markupCache = new MARKUP_CACHE(1024);

/**
 * @return position of cursor for drawing next substring.
 */
function drawMarkupNode(
  aBoundingBox: BOX2I | null,
  aGlyphs: GLYPH_LIKE[] | null,
  aNode: NODE | null,
  aPosition: VECTOR2I,
  aFont: FONT,
  aSize: VECTOR2I,
  aAngle: EDA_ANGLE,
  aMirror: boolean,
  aOrigin: VECTOR2I,
  aTextStyle: TEXT_STYLE_FLAGS,
  aFontMetrics: METRICS,
  aMousePos: VECTOR2I | null,
  aActiveUrl: OutStr | null,
): VECTOR2I {
  let nextPosition = aPosition;
  let drawUnderline = false;
  let drawOverbar = false;
  let useHoverColor = false;
  const start = aGlyphs ? aGlyphs.length : 0;

  if (aNode) {
    let textStyle = aTextStyle;

    if (!aNode.is_root()) {
      if (aNode.isSubscript()) textStyle |= TEXT_STYLE.SUBSCRIPT;
      else if (aNode.isSuperscript()) textStyle |= TEXT_STYLE.SUPERSCRIPT;

      if (aNode.isOverbar()) drawOverbar = true;

      if (aTextStyle & TEXT_STYLE.UNDERLINE) drawUnderline = true;

      if (aNode.has_content()) {
        const bbox = new BOX2I();

        nextPosition = aFont.GetTextAsGlyphs(
          bbox,
          aGlyphs,
          aNode.asWxString(),
          aSize,
          nextPosition,
          aAngle,
          aMirror,
          aOrigin,
          textStyle,
        );

        if (aBoundingBox) aBoundingBox.Merge(bbox);

        if (aNode.isURL() && aMousePos && bbox.Contains(aMousePos)) {
          useHoverColor = true;
          drawUnderline = true;
        }
      }
    }

    for (const child of aNode.children) {
      nextPosition = drawMarkupNode(
        aBoundingBox,
        aGlyphs,
        child,
        nextPosition,
        aFont,
        aSize,
        aAngle,
        aMirror,
        aOrigin,
        textStyle,
        aFontMetrics,
        aMousePos,
        aActiveUrl,
      );
    }
  }

  if (drawUnderline) {
    // Shorten the bar a little so its rounded ends don't make it over-long
    const barTrim = aSize.x * 0.1;
    const barOffset = aFontMetrics.GetUnderlineVerticalPosition(aSize.y);

    const barStart = { x: aPosition.x + barTrim, y: aPosition.y - barOffset };
    const barEnd = { x: nextPosition.x - barTrim, y: nextPosition.y - barOffset };

    if (aGlyphs) {
      const barGlyph = new STROKE_GLYPH();

      barGlyph.AddPoint(barStart);
      barGlyph.AddPoint(barEnd);
      barGlyph.Finalize();

      aGlyphs.push(
        barGlyph.Transform({ x: 1.0, y: 1.0 }, { x: 0, y: 0 }, 0, aAngle, aMirror, aOrigin),
      );
    }
  }

  if (drawOverbar) {
    // Shorten the bar a little so its rounded ends don't make it over-long
    const barTrim = aSize.x * 0.1;
    const barOffset = aFontMetrics.GetOverbarVerticalPosition(aSize.y);

    const barStart = { x: aPosition.x + barTrim, y: aPosition.y - barOffset };
    const barEnd = { x: nextPosition.x - barTrim, y: nextPosition.y - barOffset };

    if (aGlyphs) {
      const barGlyph = new STROKE_GLYPH();

      barGlyph.AddPoint(barStart);
      barGlyph.AddPoint(barEnd);
      barGlyph.Finalize();

      aGlyphs.push(
        barGlyph.Transform({ x: 1.0, y: 1.0 }, { x: 0, y: 0 }, 0, aAngle, aMirror, aOrigin),
      );
    }
  }

  if (useHoverColor) {
    for (let ii = start; ii < aGlyphs!.length; ++ii) aGlyphs![ii]!.SetIsHover(true);

    if (aActiveUrl && aActiveUrl.value === '') aActiveUrl.value = aNode!.asWxString();
  }

  return nextPosition;
}

/**
 * Break marked-up text into "words".
 *
 * In this context, a "word" is EITHER a run of marked-up text (subscript, superscript or
 * overbar), OR a run of non-marked-up text separated by spaces.
 */
function wordbreakMarkupNode(
  aWords: WORD_WIDTH[],
  aNode: NODE,
  aFont: FONT,
  aSize: VECTOR2I,
  aTextStyle: TEXT_STYLE_FLAGS,
  aInsideMarkup = false,
): void {
  let textStyle = aTextStyle;

  if (!aNode.is_root()) {
    let escapeChar = '';

    if (aNode.isSubscript()) {
      escapeChar = '_';
      textStyle = TEXT_STYLE.SUBSCRIPT;
    } else if (aNode.isSuperscript()) {
      escapeChar = '^';
      textStyle = TEXT_STYLE.SUPERSCRIPT;
    }

    if (aNode.isOverbar()) {
      escapeChar = '~';
      textStyle |= TEXT_STYLE.OVERBAR;
    }

    if (escapeChar) {
      let word = `${escapeChar}{`;
      let width = 0;

      if (aNode.has_content()) {
        const next = aFont.GetTextAsGlyphs(
          null,
          null,
          aNode.asWxString(),
          aSize,
          { x: 0, y: 0 },
          ANGLE_0,
          false,
          { x: 0, y: 0 },
          textStyle,
        );
        word += aNode.asWxString();
        width += next.x;
      }

      const childWords: WORD_WIDTH[] = [];

      for (const child of aNode.children)
        wordbreakMarkupNode(childWords, child, aFont, aSize, textStyle, true);

      for (const childWord of childWords) {
        word += childWord[0];
        width += childWord[1];
      }

      word += '}';
      aWords.push([word, width]);
      return;
    }
    if (aInsideMarkup) {
      // Inside a markup node, preserve the content verbatim (no tokenization).
      // wxStringTokenizer collapses consecutive spaces, which corrupts content
      // like ~{     } where spaces are intentional.
      const content = aNode.asWxString();
      const w = aFont.GetTextAsGlyphs(
        null,
        null,
        content,
        aSize,
        { x: 0, y: 0 },
        ANGLE_0,
        false,
        { x: 0, y: 0 },
        textStyle,
      ).x;

      aWords.push([content, w]);
    } else {
      const textRun = aNode.asWxString();
      const words: string[] = wxTokenizeRetDelims(textRun, ' ');

      for (const word of words) {
        // `chars.Trim()`: the trailing whitespace off
        const chars = word.replace(/\s+$/, '');

        const w = aFont.GetTextAsGlyphs(
          null,
          null,
          chars === '' ? word : chars,
          aSize,
          { x: 0, y: 0 },
          ANGLE_0,
          false,
          { x: 0, y: 0 },
          textStyle,
        ).x;

        aWords.push([word, w]);
      }
    }
  }

  for (const child of aNode.children)
    wordbreakMarkupNode(aWords, child, aFont, aSize, textStyle, aInsideMarkup);
}

/**
 * `wxStringTokenizer( str, " ", wxTOKEN_RET_DELIMS )` walked to the end
 * (`tokenzr.cpp`): each token runs up to and including the delimiter that
 * ended it, so a run of delimiters yields one-delimiter tokens, a leading
 * delimiter is a token of its own, and the tail is returned only when it
 * is not empty. `"a  b"` is `"a "`, `" "`, `"b"`.
 */
export function wxTokenizeRetDelims(aStr: string, aDelims: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = aStr.length;

  while (i < n) {
    const start = i;
    while (i < n && !aDelims.includes(aStr[i]!)) i++;
    // the delimiter that ended the token is returned with it
    if (i < n) i++;
    tokens.push(aStr.slice(start, i));
  }

  return tokens;
}

export abstract class FONT {
  protected m_fontName = ''; ///< Font name
  protected m_fontFileName = ''; ///< Font file name

  private static s_defaultFont: FONT | null = null;
  private static s_fontMap = new Map<string, FONT>();

  /** `STROKE_FONT::LoadFont` and `OUTLINE_FONT::LoadFont`, registered by their modules. */
  static loaders: {
    stroke: ((aFontName: string) => FONT | null) | null;
    outline:
      | ((
          aFontName: string,
          aBold: boolean,
          aItalic: boolean,
          aEmbeddedFiles: readonly string[] | null,
          aForDrawingSheet: boolean,
        ) => FONT | null)
      | null;
  } = { stroke: null, outline: null };

  IsStroke(): boolean {
    return false;
  }
  IsOutline(): boolean {
    return false;
  }
  IsBold(): boolean {
    return false;
  }
  IsItalic(): boolean {
    return false;
  }

  protected static getDefaultFont(): FONT {
    if (!FONT.s_defaultFont) FONT.s_defaultFont = FONT.loaders.stroke!('');

    return FONT.s_defaultFont!;
  }

  /**
   * Load (or return) the font with the given name and style; the default
   * (stroke) font when there is none.
   */
  static GetFont(
    aFontName = '',
    aBold = false,
    aItalic = false,
    aEmbeddedFiles: readonly string[] | null = null,
    aForDrawingSheet = false,
  ): FONT {
    if (aFontName === '' || aFontName.startsWith(KICAD_FONT_NAME)) return FONT.getDefaultFont();

    const key = `${aFontName} ${aBold ? 1 : 0}${aItalic ? 1 : 0}${aForDrawingSheet ? 1 : 0}`;

    let font: FONT | null = null;

    if (FONT.s_fontMap.has(key)) font = FONT.s_fontMap.get(key)!;

    if (!font)
      font = FONT.loaders.outline
        ? FONT.loaders.outline(aFontName, aBold, aItalic, aEmbeddedFiles, aForDrawingSheet)
        : null;

    if (!font) font = FONT.getDefaultFont();

    FONT.s_fontMap.set(key, font);

    return font;
  }

  /** Forget every cached font, so a face that has since loaded is resolved anew. */
  static ClearFontMap(): void {
    FONT.s_fontMap.clear();
  }

  /** `static bool IsStroke( const wxString& aFontName )`. */
  static IsStrokeName(aFontName: string): boolean {
    // This would need a more complex implementation if we ever support more stroke fonts
    // than the KiCad Font.
    return aFontName === 'Default Font' || aFontName === KICAD_FONT_NAME;
  }

  GetName(): string {
    return this.m_fontName;
  }
  NameAsToken(): string {
    return this.GetName();
  }

  /**
   * Draw a string.
   *
   * @param aGal is the graphics context.
   * @param aText is the text to be drawn.
   * @param aPosition is the text position in world coordinates.
   * @param aCursor is the current text position (for multiple text blocks within a single text
   *                object, such as a run of superscript characters)
   * @param aAttrs are the styling attributes of the text, including its rotation
   */
  Draw(
    aGal: GAL | null,
    aText: string,
    aPosition: VECTOR2I,
    aCursor: VECTOR2I,
    aAttrs: TEXT_ATTRIBUTES,
    aFontMetrics: METRICS,
    aMousePos: VECTOR2I | null = null,
    aActiveUrl: OutStr | null = null,
  ): void {
    if (!aGal || aText === '') return;

    const position = { x: aPosition.x - aCursor.x, y: aPosition.y - aCursor.y };

    // Split multiline strings into separate ones and draw them line by line
    const strings_list: string[] = [];
    const positions: VECTOR2I[] = [];
    const extents: VECTOR2I[] = [];

    this.getLinePositions(aText, position, strings_list, positions, extents, aAttrs, aFontMetrics);

    aGal.SetLineWidth(aAttrs.m_StrokeWidth);

    for (let i = 0; i < strings_list.length; i++) {
      this.drawSingleLineText(
        aGal,
        null,
        strings_list[i]!,
        positions[i]!,
        aAttrs.m_Size,
        aAttrs.m_Angle,
        aAttrs.m_Mirrored,
        aPosition,
        aAttrs.m_Italic,
        aAttrs.m_Underlined,
        aAttrs.m_Hover,
        aFontMetrics,
        aMousePos,
        aActiveUrl,
      );
    }
  }

  /** The form without a cursor: `Draw( aGal, aText, aPosition, aAttributes, aFontMetrics, ... )`. */
  DrawAt(
    aGal: GAL | null,
    aText: string,
    aPosition: VECTOR2I,
    aAttributes: TEXT_ATTRIBUTES,
    aFontMetrics: METRICS,
    aMousePos: VECTOR2I | null = null,
    aActiveUrl: OutStr | null = null,
  ): void {
    this.Draw(
      aGal,
      aText,
      aPosition,
      { x: 0, y: 0 },
      aAttributes,
      aFontMetrics,
      aMousePos,
      aActiveUrl,
    );
  }

  /**
   * Compute the boundary limits of aText (the bounding box of all shapes).
   *
   * @return a VECTOR2I giving the width and height of text.
   */
  StringBoundaryLimits(
    aText: string,
    aSize: VECTOR2I,
    aThickness: number,
    aBold: boolean,
    aItalic: boolean,
    aFontMetrics: METRICS,
  ): VECTOR2I {
    // TODO do we need to parse every time - have we already parsed?
    const boundingBox = new BOX2I();
    let textStyle: TEXT_STYLE_FLAGS = 0;

    if (aBold) textStyle |= TEXT_STYLE.BOLD;

    if (aItalic) textStyle |= TEXT_STYLE.ITALIC;

    this.drawMarkup(
      boundingBox,
      null,
      aText,
      { x: 0, y: 0 },
      aSize,
      ANGLE_0,
      false,
      { x: 0, y: 0 },
      textStyle,
      aFontMetrics,
    );

    if (this.IsStroke()) {
      // Inflate by a bit more than thickness/2 to catch diacriticals, descenders, etc.
      boundingBox.Inflate(KiROUND(aThickness * 1.5));
    } else if (this.IsOutline()) {
      // Outline fonts have thickness built in, and *usually* stay within their ascent/descent
    }

    return boundingBox.GetSize();
  }

  GetAlignedDrawPosition(
    aText: string,
    aAnchor: VECTOR2I,
    aAttributes: TEXT_ATTRIBUTES,
    aFontMetrics: METRICS,
  ): VECTOR2I {
    const strings_list: string[] = [];
    const positions: VECTOR2I[] = [];
    const extents: VECTOR2I[] = [];

    this.getLinePositions(
      aText,
      aAnchor,
      strings_list,
      positions,
      extents,
      aAttributes,
      aFontMetrics,
    );

    if (positions.length === 0) return aAnchor;

    return positions[0]!;
  }

  /**
   * Insert \n characters into text to ensure that no lines are wider than \a aColumnWidth.
   */
  LinebreakText(
    aText: OutStr,
    aColumnWidth: number,
    aSize: VECTOR2I,
    aThickness: number,
    aBold: boolean,
    aItalic: boolean,
  ): void {
    let textStyle: TEXT_STYLE_FLAGS = 0;

    if (aBold) textStyle |= TEXT_STYLE.BOLD;

    if (aItalic) textStyle |= TEXT_STYLE.ITALIC;

    const spaceWidth = this.GetTextAsGlyphs(
      null,
      null,
      ' ',
      aSize,
      { x: 0, y: 0 },
      ANGLE_0,
      false,
      { x: 0, y: 0 },
      textStyle,
    ).x;

    const textLines = wxStringSplit(aText.value, '\n');

    aText.value = '';

    for (let ii = 0; ii < textLines.length; ++ii) {
      const markup: WORD_WIDTH[] = [];
      const words: WORD_WIDTH[] = [];

      this.wordbreakMarkup(markup, textLines[ii]!, aSize, textStyle);

      for (const [run, runWidth] of markup) {
        if (words.length && !words[words.length - 1]![0].endsWith(' ')) {
          words[words.length - 1]![0] += run;
          words[words.length - 1]![1] += runWidth;
        } else {
          words.push([run, runWidth]);
        }
      }

      let buryMode = false;
      let lineWidth = 0;
      let pendingSpaces = '';

      for (const [word, wordWidth] of words) {
        let pendingSpaceWidth = pendingSpaces.length * spaceWidth;
        const overflow = lineWidth + pendingSpaceWidth + wordWidth > aColumnWidth - aThickness;

        if (overflow && pendingSpaces.length > 0) {
          aText.value += '\n';
          lineWidth = 0;
          pendingSpaces = '';
          pendingSpaceWidth = 0;
          buryMode = true;
        }

        if (word === ' ') {
          pendingSpaces += word;
        } else {
          if (buryMode) {
            buryMode = false;
          } else {
            aText.value += pendingSpaces;
            lineWidth += pendingSpaceWidth;
          }

          if (word.endsWith(' ')) {
            aText.value += word.substring(0, word.length - 1);
            pendingSpaces = ' ';
          } else {
            aText.value += word;
            pendingSpaces = '';
          }

          lineWidth += wordWidth;
        }
      }

      // Add the newlines back onto the string
      if (ii !== textLines.length - 1) aText.value += '\n';
    }
  }

  abstract GetInterline(aGlyphHeight: number, aFontMetrics: METRICS): number;

  /**
   * Convert text into an array of glyphs.
   *
   * @param aBBox the bounding box of the text.
   * @param aGlyphs is the glyph array to add the glyphs to.  Null when only the extent is wanted.
   * @return the position of the cursor after drawing the text.
   */
  abstract GetTextAsGlyphs(
    aBBox: BOX2I | null,
    aGlyphs: GLYPH_LIKE[] | null,
    aText: string,
    aSize: VECTOR2I,
    aPosition: VECTOR2I,
    aAngle: EDA_ANGLE,
    aMirror: boolean,
    aOrigin: VECTOR2I,
    aTextStyle: TEXT_STYLE_FLAGS,
  ): VECTOR2I;

  // ---- protected ---------------------------------------------------------

  protected linesCount(aText: string): number {
    if (aText === '') return 0; // std::count does not work well with empty strings

    // aText.end() - 1 is to skip a newline character that is potentially at the end
    let n = 0;
    for (let i = 0; i < aText.length - 1; i++) if (aText[i] === '\n') n++;
    return n + 1;
  }

  /**
   * Draws a single line of text. Multiline texts should be split before using the function.
   *
   * @param aGal is a pointer to the graphics abstraction layer, or nullptr if no drawing is
   *             needed
   * @param aBoundingBox is an optional pointer to be filled with the bounding box.
   * @param aText is the text to be drawn.
   * @param aPosition is text position.
   * @param aSize is the text size.
   * @param aAngle is text angle.
   * @param aMirror is true if text should be drawn mirrored, false otherwise.
   * @param aOrigin is the item origin (cursor).
   * @param aItalic is true if text should be drawn italic, false otherwise.
   * @param aUnderline is true if text should be drawn underlined, false otherwise.
   */
  protected drawSingleLineText(
    aGal: GAL | null,
    aBoundingBox: BOX2I | null,
    aText: string,
    aPosition: VECTOR2I,
    aSize: VECTOR2I,
    aAngle: EDA_ANGLE,
    aMirror: boolean,
    aOrigin: VECTOR2I,
    aItalic: boolean,
    aUnderline: boolean,
    aHover: boolean,
    aFontMetrics: METRICS,
    aMousePos: VECTOR2I | null,
    aActiveUrl: OutStr | null,
  ): void {
    if (!aGal) return;

    let textStyle: TEXT_STYLE_FLAGS = 0;

    if (aItalic) textStyle |= TEXT_STYLE.ITALIC;

    if (aUnderline) textStyle |= TEXT_STYLE.UNDERLINE;

    const glyphs: GLYPH_LIKE[] = [];

    this.drawMarkup(
      aBoundingBox,
      glyphs,
      aText,
      aPosition,
      aSize,
      aAngle,
      aMirror,
      aOrigin,
      textStyle,
      aFontMetrics,
      aMousePos,
      aActiveUrl,
    );

    if (aHover) {
      for (const glyph of glyphs) glyph.SetIsHover(true);
    }

    aGal.DrawGlyphs(glyphs);
  }

  /**
   * Computes the bounding box for a single line of text.
   * Multiline texts should be split before using the function.
   */
  protected boundingBoxSingleLine(
    aBBox: BOX2I | null,
    aText: string,
    aPosition: VECTOR2I,
    aSize: VECTOR2I,
    aItalic: boolean,
    aFontMetrics: METRICS,
  ): VECTOR2I {
    let textStyle: TEXT_STYLE_FLAGS = 0;

    if (aItalic) textStyle |= TEXT_STYLE.ITALIC;

    const extents = this.drawMarkup(
      aBBox,
      null,
      aText,
      aPosition,
      aSize,
      ANGLE_0,
      false,
      { x: 0, y: 0 },
      textStyle,
      aFontMetrics,
    );

    return extents;
  }

  protected getLinePositions(
    aText: string,
    aPosition: VECTOR2I,
    aTextLines: string[],
    aPositions: VECTOR2I[],
    aExtents: VECTOR2I[],
    aAttrs: TEXT_ATTRIBUTES,
    aFontMetrics: METRICS,
  ): void {
    for (const l of wxStringSplit(aText, '\n')) aTextLines.push(l);
    const lineCount = aTextLines.length;

    // `int interline = GetInterline( ... ) * aAttrs.m_LineSpacing`: truncated
    const interline = Math.trunc(
      this.GetInterline(aAttrs.m_Size.y, aFontMetrics) * aAttrs.m_LineSpacing,
    );
    let height = 0;

    for (let i = 0; i < lineCount; i++) {
      const pos = { x: aPosition.x, y: aPosition.y + i * interline };
      const end = this.boundingBoxSingleLine(
        null,
        aTextLines[i]!,
        pos,
        aAttrs.m_Size,
        aAttrs.m_Italic,
        aFontMetrics,
      );
      const bBox = { x: end.x - pos.x, y: end.y - pos.y };

      aExtents.push(bBox);

      if (i === 0)
        height += Math.trunc(aAttrs.m_Size.y * 1.17); // 1.17 is a fudge to match 6.0 positioning
      else height += interline;
    }

    const offset = { x: 0, y: 0 };
    offset.y += aAttrs.m_Size.y;

    if (this.IsStroke()) {
      // Fudge factors to match 6.0 positioning
      offset.x += Math.trunc(aAttrs.m_StrokeWidth / 1.52);
      offset.y -= Math.trunc(aAttrs.m_StrokeWidth * 0.052);
    }

    switch (aAttrs.m_Valign) {
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
        break;
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
        offset.y -= Math.trunc(height / 2);
        break;
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
        offset.y -= height;
        break;
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE:
        // wxFAIL_MSG( "Indeterminate state legal only in dialogs." )
        break;
    }

    for (let i = 0; i < lineCount; i++) {
      const lineSize = aExtents[i]!;
      const lineOffset = { x: offset.x, y: offset.y };

      lineOffset.y += i * interline;

      switch (aAttrs.m_Halign) {
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER:
          lineOffset.x = -Math.trunc(lineSize.x / 2);
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
          lineOffset.x = -(lineSize.x + offset.x);
          break;
        case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE:
          // wxFAIL_MSG( "Indeterminate state legal only in dialogs." )
          break;
      }

      aPositions.push({ x: aPosition.x + lineOffset.x, y: aPosition.y + lineOffset.y });
    }
  }

  /**
   * Draws a text with markup (subscripts, superscripts, overbars, urls).
   *
   * @return position of cursor for drawing next substring.
   */
  protected drawMarkup(
    aBoundingBox: BOX2I | null,
    aGlyphs: GLYPH_LIKE[] | null,
    aText: string,
    aPosition: VECTOR2I,
    aSize: VECTOR2I,
    aAngle: EDA_ANGLE,
    aMirror: boolean,
    aOrigin: VECTOR2I,
    aTextStyle: TEXT_STYLE_FLAGS,
    aFontMetrics: METRICS,
    aMousePos: VECTOR2I | null = null,
    aActiveUrl: OutStr | null = null,
  ): VECTOR2I {
    let markup = s_markupCache.Get(aText);

    if (!markup || !markup.root) {
      const markupParser = new MARKUP_PARSER(aText);
      const root = s_markupCache.Put(aText, markupParser.Parse());
      markup = { root };
    }

    // wxASSERT( markup && markup->root );

    return drawMarkupNode(
      aBoundingBox,
      aGlyphs,
      markup.root,
      aPosition,
      this,
      aSize,
      aAngle,
      aMirror,
      aOrigin,
      aTextStyle,
      aFontMetrics,
      aMousePos,
      aActiveUrl,
    );
  }

  protected wordbreakMarkup(
    aWords: WORD_WIDTH[],
    aText: string,
    aSize: VECTOR2I,
    aTextStyle: TEXT_STYLE_FLAGS,
  ): void {
    const markupParser = new MARKUP_PARSER(aText);
    const root = markupParser.Parse();

    if (root) wordbreakMarkupNode(aWords, root, this, aSize, aTextStyle);
  }
}

/** `operator<<( std::ostream&, const KIFONT::FONT& )`. */
export function fontToString(aFont: FONT): string {
  return `[Font "${aFont.GetName()}"${aFont.IsStroke() ? ' stroke' : ''}${aFont.IsOutline() ? ' outline' : ''}${aFont.IsBold() ? ' bold' : ''}${aFont.IsItalic() ? ' italic' : ''}]`;
}
