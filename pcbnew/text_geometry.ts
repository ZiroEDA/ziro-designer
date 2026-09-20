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
import { circlePoly, stadiumPoly } from './convert_basic_shapes_to_polygon.js';
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
 * The rendered text is one `maxError` fatter than the strokes' pen on every
 * side: `TransformTextToPolySet` inflates it by that under `ERROR_OUTSIDE`
 * ("if( aErrorLoc == ERROR_OUTSIDE ) aClearance += aMaxError;
 * textShape.Inflate( aClearance, … )", pcb_text.cpp:666-672), and the hull is
 * taken of the inflated shape. Ask KiCad for a lone '-' at pen 0.3048 with a
 * 0.005 mm maxError and the bar comes back 0.3148 tall. Without it every text
 * knockout of ours sat 5 µm inside upstream's on all four sides; and the
 * strokes' round caps, measured as polygons rather than as a pen radius, are
 * the last 3 µm on a diagonal.
 *
 * The clearance goes in HERE, as `buildBoundingHull`'s `aClearance`: it grows
 * the box before the corners are rotated, so the knockout keeps its square
 * corners. The rectangle comes back as a bare `poly` shape with nothing left
 * for the caller to add.
 *
 * Hidden text has none: "if( text->IsVisible() )" guards the knockout. A
 * knockout text is not modelled — upstream inverts that one, leaving holes
 * only where the letters are.
 */
export function textShapes(t: PcbTextItem, maxError: number, clearance = 0): Shape[] {
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

  // The bounding box is taken in the text's OWN frame, before the rotation —
  // and off the RENDERED strokes, not their centrelines. `TransformTextToPolySet`
  // runs every stroke through `TransformOvalToPolygon( …, penWidth, aMaxError,
  // ERROR_OUTSIDE )`, whose round caps sit at a corrected radius
  // (`r / cos( π / n )`, 3 µm on a 0.3 mm pen) while its straight sides are
  // clamped to the exact half pen; a diagonal stroke's cap therefore reaches
  // past `centreline ± pen / 2` and the hull follows it. `stadiumPoly` is that
  // polygon, and the vertices are the same relative to the segment whatever
  // the text's rotation, so measuring here and rotating the four corners is
  // what `buildBoundingHull` does.
  const half = pen / 2;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const grow = (x: number, y: number): void => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  const local = (p: Vec2): Vec2 => ({
    x: ((p.x + offX) * sx - p.y * tilt) * mirror,
    y: p.y + offY,
  });

  for (const stroke of strokes) {
    if (stroke.length === 1) {
      for (const [x, y] of circlePoly(local(stroke[0]!), half, maxError)) grow(x, y);
      continue;
    }
    for (let i = 1; i < stroke.length; i++) {
      const a = local(stroke[i - 1]!);
      const b = local(stroke[i]!);
      for (const [x, y] of stadiumPoly(a, b, half, maxError)) grow(x, y);
    }
  }

  if (!Number.isFinite(x0)) return [];

  // Then the whole rendered text is inflated by one maxError — "if( aErrorLoc
  // == ERROR_OUTSIDE ) aClearance += aMaxError; textShape.Inflate( … )" — and
  // an offset with round joins moves a bounding box by exactly its amount.
  //
  // And `buildBoundingHull( &aBuffer, poly, aClearance )` is `BBox( aClearance )`
  // — the axis-aligned box grown by the clearance, SQUARE corners, no arc and
  // no error correction — whose four corners are then rotated. A caller that
  // inflated the bare hull as a polygon would round the corners and grow it by
  // one maxError too, which is a different hole.
  const gap = maxError + clearance;
  x0 -= gap;
  y0 -= gap;
  x1 += gap;
  y1 += gap;

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
