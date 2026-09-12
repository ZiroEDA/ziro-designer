// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A multi-line, marked-up text run laid out with an `OutlineFont` — the
 * outline half of what `stroke_font.ts`'s `layoutText` does for Newstroke,
 * with the same frame so a renderer can place either the same way: the
 * block's left edge at x = 0, line 0's baseline at y = 0, later lines
 * `GetInterline` further down, and each line shifted inside the block by
 * the horizontal alignment exactly as `FONT::getLinePositions` shifts it.
 *
 * What differs from the stroke layout is what `OUTLINE_FONT` differs in:
 *
 *   - `GetInterline` is `METRICS::GetInterline` with no legacy factor
 *     (outline_font.cpp:184; `fontInterline` in text_box.ts says the same);
 *   - sub/superscripts are the font's own 0.64-size faces at its own
 *     offsets, not the stroke font's 0.8 and 0.35/0.15 (outline_font.h:
 *     193-212), all inside `OutlineFont.getTextAsGlyphs`;
 *   - the overbar is the one thing still drawn as a STROKE: `drawMarkup`
 *     (font.cpp:329-347) adds a `STROKE_GLYPH` bar at
 *     `GetOverbarVerticalPosition`, trimmed by `0.1 · size.x` at each end,
 *     for every font. It comes back separately as `bars` so the renderer
 *     strokes it with the text's pen while filling the glyphs.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { metricsInterline, overbarVerticalPosition } from './font_metrics.js';
import type { BBox, OutlineFont, OutlineGlyph } from './outline_font.js';
import { parseMarkup, splitTextLines, type TextHAlign } from './stroke_font.js';

export interface OutlineTextLayout {
  /** Every glyph of every line, in block coordinates (IU, y down). */
  glyphs: OutlineGlyph[];
  /** Overbar polylines, to be stroked. */
  bars: Vec2[][];
  /**
   * The union of every run's `GetTextAsGlyphs` box — ascender to descender,
   * advance wide — which is what `EDA_TEXT::GetBoundingBox` is built from.
   */
  bbox: BBox;
  /** The widest line: the block's width, which is what a caller positions by. */
  width: number;
  lineCount: number;
}

/**
 * Lay `text` out at glyph height `size` (square: `size.x = size.y`, which is
 * what every schematic and board text has).
 */
export function layoutOutlineText(
  font: OutlineFont,
  text: string,
  size: number,
  hAlign: TextHAlign = 'center',
): OutlineTextLayout {
  const lines = splitTextLines(text);
  const sz = { x: size, y: size };
  const origin = { x: 0, y: 0 };
  // Pass 1: each line from x = 0 on its own baseline.
  const laid = lines.map((line, li) => {
    const glyphs: OutlineGlyph[] = [];
    const bars: Vec2[][] = [];
    const y = li * metricsInterline(size);
    let cursor: Vec2 = { x: 0, y };
    const bbox: BBox = { minX: 0, minY: y, maxX: 0, maxY: y };
    for (const run of parseMarkup(line)) {
      const start = cursor;
      const r = font.getTextAsGlyphs(run.text, sz, cursor, 0, false, origin, {
        subscript: run.style === 'sub',
        superscript: run.style === 'super',
      });
      glyphs.push(...r.glyphs);
      cursor = r.end;
      bbox.minY = Math.min(bbox.minY, r.bbox.minY);
      bbox.maxY = Math.max(bbox.maxY, r.bbox.maxY);
      bbox.maxX = Math.max(bbox.maxX, r.bbox.maxX);
      if (run.style === 'overbar') {
        const barTrim = sz.x * 0.1;
        const barOffset = overbarVerticalPosition(sz.y);
        bars.push([
          { x: start.x + barTrim, y: start.y - barOffset },
          { x: cursor.x - barTrim, y: cursor.y - barOffset },
        ]);
      }
    }
    return { glyphs, bars, width: cursor.x, bbox };
  });

  const maxWidth = Math.max(0, ...laid.map((l) => l.width));
  const glyphs: OutlineGlyph[] = [];
  const bars: Vec2[][] = [];
  const bbox: BBox = { minX: 0, minY: 0, maxX: maxWidth, maxY: 0 };
  for (const ld of laid) {
    const dx =
      hAlign === 'left' ? 0 : hAlign === 'right' ? maxWidth - ld.width : (maxWidth - ld.width) / 2;
    bbox.minY = Math.min(bbox.minY, ld.bbox.minY);
    bbox.maxY = Math.max(bbox.maxY, ld.bbox.maxY);
    if (dx === 0) {
      glyphs.push(...ld.glyphs);
      bars.push(...ld.bars);
      continue;
    }
    for (const g of ld.glyphs)
      glyphs.push({ rings: g.rings.map((r) => r.map((p) => ({ x: p.x + dx, y: p.y }))) });
    for (const b of ld.bars) bars.push(b.map((p) => ({ x: p.x + dx, y: p.y })));
  }
  return { glyphs, bars, bbox, width: maxWidth, lineCount: lines.length };
}

/**
 * `OUTLINE_FONT`'s answer to `textWidth`: the widest line's advance, which
 * is `boundingBoxSingleLine`'s `end - pos` — the cursor, not the ink.
 */
export function outlineTextWidth(font: OutlineFont, text: string, size: number): number {
  let widest = 0;
  const sz = { x: size, y: size };
  const origin = { x: 0, y: 0 };
  for (const line of splitTextLines(text)) {
    let cursor: Vec2 = { x: 0, y: 0 };
    for (const run of parseMarkup(line)) {
      cursor = font.getTextAsGlyphs(
        run.text,
        sz,
        cursor,
        0,
        false,
        origin,
        { subscript: run.style === 'sub', superscript: run.style === 'super' },
        false,
      ).end;
    }
    if (cursor.x > widest) widest = cursor.x;
  }
  return widest;
}

/**
 * `OUTLINE_FONT`'s `StringBoundaryLimits` for one line: `drawMarkup` with a
 * bounding box and no glyphs, the box merged over every run — so its width
 * is the advance of the whole line and its height the ascender plus
 * descender of the tallest run (a sub/superscript run is shorter). No
 * inflation: "an outline font is not, because its thickness is built into
 * the outline" (font.cpp:451-474, the empty `else if( IsOutline() )`).
 */
export function outlineBoundaryLimits(
  font: OutlineFont,
  line: string,
  size: number,
): { x: number; y: number } {
  const sz = { x: size, y: size };
  const origin = { x: 0, y: 0 };
  let cursor: Vec2 = { x: 0, y: 0 };
  let minY = 0;
  let maxY = 0;
  for (const run of parseMarkup(line)) {
    const r = font.getTextAsGlyphs(
      run.text,
      sz,
      cursor,
      0,
      false,
      origin,
      { subscript: run.style === 'sub', superscript: run.style === 'super' },
      false,
    );
    cursor = r.end;
    if (r.bbox.minY < minY) minY = r.bbox.minY;
    if (r.bbox.maxY > maxY) maxY = r.bbox.maxY;
  }
  return { x: cursor.x, y: maxY - minY };
}
