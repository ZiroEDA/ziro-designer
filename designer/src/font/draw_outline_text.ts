// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FONT::Draw` for an `OUTLINE_FONT`, on any 2D context — the schematic
 * renderer, the symbol editor's, and every plot adapter that stands in for
 * one. KiCad has ONE of these (`FONT::Draw` → `drawSingleLineText` →
 * `GAL::DrawGlyphs`), which is why this is a module of its own rather than
 * a copy per renderer.
 *
 * The run is laid out by `layoutOutlineText` (block frame, line 0 on the
 * baseline), placed by `getLinePositions` (font.cpp:181-243) and handed to
 * the context as filled polygons — what `OPENGL_GAL::DrawGlyph` does with an
 * `OUTLINE_GLYPH` (opengl_gal.cpp:3122-3138): `Triangulate` into
 * `m_fillColor`, no stroke at all. The GL recorder's `fill` triangulates the
 * same rings under the non-zero rule the winding was built for; Canvas2D
 * and the plot adapters fill them the same way.
 *
 * The placement is the stroke renderer's arithmetic without the two
 * `if( IsStroke() )` terms — `offset.x += strokeWidth / 1.52` and
 * `offset.y -= strokeWidth * 0.052` — and with `OUTLINE_FONT::GetInterline`,
 * which has no legacy factor. The 1.17 block fudge is `getLinePositions`'
 * own and applies to both.
 *
 * The overbar is the one stroke: `drawMarkup` adds it as a `STROKE_GLYPH`
 * for every font, at the pen `FONT::Draw` set (`aGal->SetLineWidth(
 * aAttrs.m_StrokeWidth )`), which is why the pen still reaches here.
 */
import type { Vec2 } from '@ziroeda/kimath';
import { metricsInterline } from '@ziroeda/common/src/font/font_metrics.js';
import type { OutlineFont } from '@ziroeda/common/src/font/outline_font.js';
import {
  layoutOutlineText,
  type OutlineTextLayout,
} from '@ziroeda/common/src/font/outline_layout.js';
import type { TextHAlign } from '@ziroeda/common/src/font/stroke_font.js';

/** `getLinePositions`' `height += size.y * 1.17` — "a fudge to match 6.0 positioning". */
const SINGLE_LINE_BLOCK = 1.17;

// Retained layouts, keyed by font and style as well as text: two faces lay
// the same string out differently.
const g_outlineLayouts = new Map<string, OutlineTextLayout>();

export function outlineLayout(
  font: OutlineFont,
  text: string,
  size: number,
  hAlign: TextHAlign,
): OutlineTextLayout {
  const key = `${font.fontName}|${font.isBold ? 1 : 0}${font.isItalic ? 1 : 0}|${hAlign}|${size}|${text}`;
  let entry = g_outlineLayouts.get(key);
  if (!entry) {
    entry = layoutOutlineText(font, text, size, hAlign);
    if (g_outlineLayouts.size > 6000) g_outlineLayouts.clear();
    g_outlineLayouts.set(key, entry);
  }
  return entry;
}

export interface OutlineTextDraw {
  text: string;
  /** The anchor, `EDA_TEXT::GetDrawPos()` plus whatever the item adds. */
  at: Vec2;
  /** The text height, IU. */
  size: number;
  color: string;
  hAlign: TextHAlign;
  vAlign: 'top' | 'center' | 'bottom';
  /** Counter-clockwise on screen, as `EDA_ANGLE` reads. */
  angleDeg: number;
  /**
   * `attrs.m_StrokeWidth` — the item's pen, plus the selection shadow when
   * drawing one. It strokes the overbar, and sizes the shadow box.
   */
  penIU: number;
  /**
   * The pen as the context should be given it: the renderer's own device
   * quantisation, or the identity for a plot.
   */
  lineWidth: (penIU: number) => number;
  /** A selection shadow: the whole run is boxed instead of filled. */
  shadow?: boolean;
}

export function drawOutlineText(
  ctx: CanvasRenderingContext2D,
  font: OutlineFont,
  d: OutlineTextDraw,
): void {
  const cap = d.size;
  const a = (((d.angleDeg % 360) + 360) % 360) * (Math.PI / 180);
  const layout = outlineLayout(font, d.text, d.size, d.hAlign);
  const width = layout.width;
  const blockH = cap * SINGLE_LINE_BLOCK + (layout.lineCount - 1) * metricsInterline(cap);
  const offY = d.vAlign === 'top' ? cap : d.vAlign === 'bottom' ? cap - blockH : cap - blockH / 2;
  const offX = d.hAlign === 'right' ? -width : d.hAlign === 'left' ? 0 : -width / 2;

  ctx.save();
  ctx.translate(d.at.x, d.at.y);
  if (a !== 0) ctx.rotate(-a);
  ctx.translate(offX, offY);
  ctx.fillStyle = d.color;
  if (d.shadow) {
    // "Trying to draw glyph-shaped shadows on outline text is a fool's
    // errand. Just box it." (sch_painter.cpp:2258-2268): the text's bounding
    // box, inflated by half the pen across and twice the pen up and down,
    // filled in the shadow colour — where `attrs.m_StrokeWidth` is the
    // item's pen plus the shadow width.
    const w = d.penIU;
    const b = layout.bbox;
    ctx.fillRect(b.minX - w / 2, b.minY - 2 * w, b.maxX - b.minX + w, b.maxY - b.minY + 4 * w);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  for (const g of layout.glyphs) {
    for (const ring of g.rings) {
      if (ring.length < 3) continue;
      const p0 = ring[0]!;
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i]!.x, ring[i]!.y);
      ctx.closePath();
    }
  }
  // Canvas2D's default rule is non-zero, which is the one the winding was
  // built for. Not `fill('nonzero')`: the recorder's `fill( path, rule )`
  // would take the string as the path and draw nothing.
  ctx.fill();
  if (layout.bars.length) {
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.lineWidth(d.penIU);
    ctx.lineCap = 'round';
    for (const bar of layout.bars) {
      ctx.beginPath();
      ctx.moveTo(bar[0]!.x, bar[0]!.y);
      ctx.lineTo(bar[1]!.x, bar[1]!.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
