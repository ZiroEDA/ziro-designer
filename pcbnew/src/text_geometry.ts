// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A text item's copper, as geometry. Counterpart: `EDA_TEXT::TransformTextToPolySet`
 * and `PCB_TEXT::TransformShapeToPolygon`.
 *
 * The stroke font draws a glyph as a set of polylines; the copper is each of
 * those segments thickened by the text's effective pen width. That is what the
 * plotter puts on the board, what DRC measures, and — the reason this module
 * exists — what a zone pour has to keep clear of. `ZONE_FILLER`'s
 * `knockoutGraphicClearance` runs over every drawing, and `addKnockout` has a
 * `PCB_TEXT_T` case; without one here a pour ran straight through the copper
 * lettering on a board, which is a short, not a cosmetic difference.
 */

import { effectiveTextPenWidth } from '@ziroeda/common/src/font/text_box.js';
import { ITALIC_TILT } from '@ziroeda/common/src/font/font_metrics.js';
import { layoutText, textBlockOffset } from '@ziroeda/common/src/font/stroke_font.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { Shape } from './drc/drc_geometry.js';
import type { PcbTextItem } from './types.js';

/**
 * `PCB_TEXT::GetDrawRotation` keeps footprint reference and value text in
 * ]-90°, 90°] so it never reads upside down.
 */
function drawAngle(t: PcbTextItem): number {
  if (!t.keepUpright && t.kind !== 'reference' && t.kind !== 'value') return t.angle;

  let angle = t.angle;
  while (angle > 90) angle -= 180;
  while (angle <= -90) angle += 180;
  return angle;
}

/**
 * One text item's knockout: its **oriented bounding rectangle**, not its
 * glyphs.
 *
 * `PCB_TEXT::TransformShapeToPolygon` renders the text to polygons, hands them
 * to `buildBoundingHull`, and that un-rotates them about the text position,
 * takes an axis-aligned `BBox( aClearance )`, and rotates the four corners
 * back. So a pour keeps clear of the whole block of lettering, not of each
 * stroke — which on a two-line label is a very different shape: the short line
 * reserves as much width as the long one.
 *
 * The clearance is added by the caller, which is why the rectangle comes back
 * as a bare `poly` shape.
 *
 * Hidden text has none: "if( text->IsVisible() )" guards the knockout. A
 * knockout text is not modelled — upstream inverts that one, leaving holes
 * only where the letters are.
 */
export function textShapes(t: PcbTextItem): Shape[] {
  if (t.hide || !t.text || t.size.y <= 0) return [];

  const size = t.size.y;
  const justify = t.justify ?? [];
  const hAlign = justify.includes('left') ? 'left' : justify.includes('right') ? 'right' : 'center';
  const vAlign = justify.includes('top') ? 'top' : justify.includes('bottom') ? 'bottom' : 'center';
  const { strokes, width, lineCount } = layoutText(t.text, size, hAlign);
  if (strokes.length === 0) return [];

  // `GetEffectiveTextPenWidth`, which asks the text WIDTH for the default and
  // then clamps against the smaller of the two sizes.
  const pen = effectiveTextPenWidth({ thickness: t.thickness, bold: t.bold, size: t.size });

  // `FONT::getLinePositions`, shared so that the pour and the two renderers put
  // the same block in the same place.
  const { x: offX, y: offY } = textBlockOffset({
    size,
    width,
    // `getLinePositions` reads the STORED thickness, not the effective pen.
    strokeWidth: t.thickness ?? 0,
    lineCount,
    hAlign,
    vAlign,
  });

  const mirror = t.mirror ? -1 : 1;
  const tilt = t.italic ? ITALIC_TILT : 0;

  // KiCad scales the glyphs by width and height separately — the file's
  // `(size height width)`, which the reader has already swapped into `(x, y) =
  // (width, height)` — while `layoutText` lays them out square at the height.
  const sx = t.size.x / size;

  // The bounding box is taken in the text's OWN frame, before the rotation.
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;

  for (const stroke of strokes) {
    for (const p of stroke) {
      const gx = ((p.x + offX) * sx - p.y * tilt) * mirror;
      const gy = p.y + offY;
      if (gx < x0) x0 = gx;
      if (gy < y0) y0 = gy;
      if (gx > x1) x1 = gx;
      if (gy > y1) y1 = gy;
    }
  }

  if (!Number.isFinite(x0)) return [];

  // The rendered text is the strokes THICKENED by the pen, so its box is the
  // stroke box grown by half a pen on each side.
  const half = pen / 2;
  x0 -= half;
  y0 -= half;
  x1 += half;
  y1 += half;

  const rad = (-drawAngle(t) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const place = (gx: number, gy: number): Vec2 => ({
    x: t.at.x + gx * cos - gy * sin,
    y: t.at.y + gx * sin + gy * cos,
  });

  return [
    {
      kind: 'poly',
      pts: [place(x0, y0), place(x1, y0), place(x1, y1), place(x0, y1)],
      r: 0,
    },
  ];
}
