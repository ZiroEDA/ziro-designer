// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_TEXT::TransformShapeToPolygon` (pcb_text.cpp:679) vertex for vertex:
 * `TransformTextToPolySet` (:615) renders the text through the stroke font —
 * `FONT::Draw` → `getLinePositions` → `drawSingleLineText` → `drawMarkup` →
 * `STROKE_FONT::GetTextAsGlyphs` → `STROKE_GLYPH::Transform` — into a
 * `CALLBACK_GAL` whose stroke callback runs every segment through
 * `TransformOvalToPolygon`, simplifies, inflates by the max error, and
 * `buildBoundingHull` (:587) takes the axis-aligned box of that in the text's
 * own frame and rotates its four corners back.
 *
 * The integer/double mix is upstream's and it matters: the cursor is a
 * VECTOR2I that advances by `KiROUND` per glyph, the glyph points are
 * doubles that the callback TRUNCATES into VECTOR2I, and the line offsets
 * are `int += double` truncations.
 */

import { effectiveTextPenWidth } from '@ziroeda/common/src/font/text_box.js';
import { ITALIC_TILT } from '@ziroeda/common/src/font/font_metrics.js';
import {
  splitTextLines,
  strokeGlyphs,
  type StrokeGlyph,
} from '@ziroeda/common/src/font/stroke_font.js';
import {
  ErrorLoc,
  transformOvalToPolygon,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import {
  ANGLE_0,
  ANGLE_90,
  ANGLE_180,
  ANGLE_270,
  EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  booleanAdd,
  CornerStrategy,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** A mutable point, for the cursors upstream keeps as `VECTOR2I` locals. */
type Pt = { x: number; y: number };
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { segmentsForRadius } from './convert_basic_shapes_to_polygon.js';
import type { PcbTextItem } from './types.js';

/** `KIFONT::METRICS::Default()`. */
const METRICS = { interlinePitch: 1.68, overbarHeight: 1.23, underlineOffset: -0.16 };
/** `STROKE_FONT::GetInterline`'s LEGACY_FACTOR. */
const LEGACY_FACTOR = 0.9583;

const truncInt = (v: number): number => Math.trunc(v);

/** `RotatePoint( double*, double*, const EDA_ANGLE& )` about an origin. */
function rotatePointD(p: Vec2, origin: Vec2, aAngle: EDA_ANGLE): Vec2 {
  const ox = p.x - origin.x;
  const oy = p.y - origin.y;
  const angle = aAngle.Normalized();
  let x: number;
  let y: number;
  if (angle.equals(ANGLE_0)) {
    x = ox;
    y = oy;
  } else if (angle.equals(ANGLE_90)) {
    x = oy;
    y = -ox;
  } else if (angle.equals(ANGLE_180)) {
    x = -ox;
    y = -oy;
  } else if (angle.equals(ANGLE_270)) {
    x = -oy;
    y = ox;
  } else {
    const sinus = angle.Sin();
    const cosinus = angle.Cos();
    x = oy * sinus + ox * cosinus;
    y = oy * cosinus - ox * sinus;
  }
  return { x: x + origin.x, y: y + origin.y };
}

interface TextStyle {
  italic: boolean;
  sub: boolean;
  sup: boolean;
}

/**
 * `STROKE_FONT::GetTextAsGlyphs`: the strokes of one run of text, in board
 * coordinates, and the cursor it leaves behind. `aGlyphs` collects each
 * glyph's polylines as transformed doubles.
 */
function getTextAsGlyphs(
  aBBox: { origin: Vec2; end: Vec2 } | null,
  aGlyphs: Vec2[][] | null,
  aText: string,
  aSize: Vec2,
  aPosition: Vec2,
  aAngle: EDA_ANGLE,
  aMirror: boolean,
  aOrigin: Vec2,
  style: TextStyle,
): Vec2 {
  const TAB_WIDTH = 4;
  const INTER_CHAR = 0.2;
  const SUPER_SUB_SIZE_MULTIPLIER = 0.8;
  const SUPER_HEIGHT_OFFSET = 0.35;
  const SUB_HEIGHT_OFFSET = 0.15;

  const table = strokeGlyphs();
  const cursor: Pt = { x: aPosition.x, y: aPosition.y };
  let glyphSize: Vec2 = { x: aSize.x, y: aSize.y };
  const tilt = style.italic ? ITALIC_TILT : 0.0;
  const space_width = table[0]!.advance; // First char is space
  let char_count = 0;

  if (style.sub || style.sup) {
    glyphSize = {
      x: glyphSize.x * SUPER_SUB_SIZE_MULTIPLIER,
      y: glyphSize.y * SUPER_SUB_SIZE_MULTIPLIER,
    };
    // `cursor.y += glyphSize.y * SUB_HEIGHT_OFFSET`: int += double.
    if (style.sub) cursor.y = truncInt(cursor.y + glyphSize.y * SUB_HEIGHT_OFFSET);
    else cursor.y = truncInt(cursor.y - glyphSize.y * SUPER_HEIGHT_OFFSET);
  }

  for (const ch of aText) {
    let c = ch.codePointAt(0)!;
    if (c === 0x09) {
      // Handle tabs as locked to the next 4th column (in base-widths).
      char_count = Math.trunc(char_count / TAB_WIDTH + 1) * TAB_WIDTH - 1;
      let new_cursor = truncInt(aPosition.x + aSize.x * char_count + aSize.x * space_width);
      while (new_cursor <= cursor.x) {
        char_count += TAB_WIDTH;
        new_cursor += aSize.x * TAB_WIDTH;
      }
      cursor.x = new_cursor;
    } else if (c === 0x20) {
      // 'space' character - draw nothing, advance cursor position
      cursor.x += KiROUND(glyphSize.x * space_width);
    } else {
      let dd = c - 0x20;
      if (dd < 0 || dd >= table.length) {
        c = 0x3f; // '?'
        dd = c - 0x20;
      }
      const source: StrokeGlyph = table[dd]!;

      if (aGlyphs) {
        // `STROKE_GLYPH::Transform( glyphSize, cursor, tilt, aAngle, aMirror, aOrigin )`
        for (const pointList of source.strokes) {
          const out: Vec2[] = [];
          for (const pt of pointList) {
            let x = pt.x * glyphSize.x;
            let y = pt.y * glyphSize.y;
            if (tilt !== 0.0) x -= y * tilt;
            x += cursor.x;
            y += cursor.y;
            if (aMirror) x = aOrigin.x - (x - aOrigin.x);
            let p: Vec2 = { x, y };
            if (!aAngle.IsZero()) p = rotatePointD(p, aOrigin, aAngle);
            out.push(p);
          }
          aGlyphs.push(out);
        }
      }

      // `glyphExtents = source->BoundingBox().GetEnd() * glyphSize`
      cursor.x += KiROUND(source.advance * glyphSize.x);
    }
    ++char_count;
  }

  if (aBBox) {
    aBBox.origin = { x: aPosition.x, y: aPosition.y };
    aBBox.end = {
      x: cursor.x - KiROUND(glyphSize.x * INTER_CHAR),
      y: truncInt(cursor.y - glyphSize.y),
    };
  }
  return { x: cursor.x, y: aPosition.y };
}

/** `MARKUP::NODE`, enough of it: a flat parse of `~{}` `_{}` `^{}` runs. */
interface MarkupNode {
  text: string;
  overbar: boolean;
  sub: boolean;
  sup: boolean;
}

function parseMarkupNodes(line: string): MarkupNode[] {
  const nodes: MarkupNode[] = [];
  let plain = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const next = line[i + 1];
    if ((c === '~' || c === '_' || c === '^') && next === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < line.length && depth > 0) {
        if (line[j] === '{') depth++;
        else if (line[j] === '}') depth--;
        j++;
      }
      if (plain) {
        nodes.push({ text: plain, overbar: false, sub: false, sup: false });
        plain = '';
      }
      nodes.push({
        text: line.slice(i + 2, depth === 0 ? j - 1 : j),
        overbar: c === '~',
        sub: c === '_',
        sup: c === '^',
      });
      i = j - 1;
    } else plain += c;
  }
  if (plain) nodes.push({ text: plain, overbar: false, sub: false, sup: false });
  return nodes;
}

/**
 * `drawMarkup`: every node's glyphs, the overbars, and the cursor at the end
 * of the line.
 */
function drawMarkup(
  aBoundingBox: { origin: Vec2; end: Vec2; set: boolean } | null,
  aGlyphs: Vec2[][] | null,
  aText: string,
  aPosition: Vec2,
  aSize: Vec2,
  aAngle: EDA_ANGLE,
  aMirror: boolean,
  aOrigin: Vec2,
  italic: boolean,
): Vec2 {
  let nextPosition: Vec2 = { ...aPosition };
  for (const node of parseMarkupNodes(aText)) {
    const start: Vec2 = { ...nextPosition };
    if (node.text.length > 0) {
      const bbox = { origin: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
      nextPosition = getTextAsGlyphs(
        bbox,
        aGlyphs,
        node.text,
        aSize,
        nextPosition,
        aAngle,
        aMirror,
        aOrigin,
        {
          italic,
          sub: node.sub,
          sup: node.sup,
        },
      );
      if (aBoundingBox) {
        // `aBoundingBox->Merge( bbox )` over a normalized BOX2I.
        const x0 = Math.min(bbox.origin.x, bbox.end.x);
        const x1 = Math.max(bbox.origin.x, bbox.end.x);
        const y0 = Math.min(bbox.origin.y, bbox.end.y);
        const y1 = Math.max(bbox.origin.y, bbox.end.y);
        if (!aBoundingBox.set) {
          aBoundingBox.origin = { x: x0, y: y0 };
          aBoundingBox.end = { x: x1, y: y1 };
          aBoundingBox.set = true;
        } else {
          aBoundingBox.origin = {
            x: Math.min(aBoundingBox.origin.x, x0),
            y: Math.min(aBoundingBox.origin.y, y0),
          };
          aBoundingBox.end = {
            x: Math.max(aBoundingBox.end.x, x1),
            y: Math.max(aBoundingBox.end.y, y1),
          };
        }
      }
    }
    if (node.overbar && aGlyphs) {
      // Shorten the bar a little so its rounded ends don't make it over-long
      const barTrim = aSize.x * 0.1;
      const barOffset = aSize.y * METRICS.overbarHeight;
      let barStart: Vec2 = { x: start.x + barTrim, y: start.y - barOffset };
      let barEnd: Vec2 = { x: nextPosition.x - barTrim, y: nextPosition.y - barOffset };
      // `barGlyph.Transform( { 1.0, 1.0 }, { 0, 0 }, false, aAngle, aMirror, aOrigin )`
      if (aMirror) {
        barStart = { x: aOrigin.x - (barStart.x - aOrigin.x), y: barStart.y };
        barEnd = { x: aOrigin.x - (barEnd.x - aOrigin.x), y: barEnd.y };
      }
      if (!aAngle.IsZero()) {
        barStart = rotatePointD(barStart, aOrigin, aAngle);
        barEnd = rotatePointD(barEnd, aOrigin, aAngle);
      }
      aGlyphs.push([barStart, barEnd]);
    }
  }
  return nextPosition;
}

/** `PCB_TEXT::GetDrawRotation`. */
export function textDrawRotation(t: PcbTextItem): EDA_ANGLE {
  let rotation = new EDA_ANGLE(t.angle);
  if (t.keepUpright) {
    // Keep angle between ]-90..90] deg. Otherwise the text is not easy to read
    while (rotation.AsDegrees() > 90) rotation = new EDA_ANGLE(rotation.AsDegrees() - 180);
    while (rotation.AsDegrees() <= -90) rotation = new EDA_ANGLE(rotation.AsDegrees() + 180);
  } else rotation = rotation.Normalized();
  return rotation;
}

/**
 * `FONT::Draw` with a `CALLBACK_GAL`: every stroke segment of the text, as
 * the integer segments the stroke callback receives (`VECTOR2I( VECTOR2D )`
 * truncates).
 */
export function textStrokeSegments(t: PcbTextItem): [Vec2, Vec2][] {
  const text = t.text;
  if (!text) return [];
  const size: Vec2 = { x: Math.trunc(t.size.x), y: Math.trunc(t.size.y) };
  const strokeWidth = effectiveTextPenWidth({ thickness: t.thickness, bold: t.bold, size: t.size });
  const angle = textDrawRotation(t);
  const justify = t.justify ?? [];
  const halign = justify.includes('left') ? 'left' : justify.includes('right') ? 'right' : 'center';
  const valign = justify.includes('top') ? 'top' : justify.includes('bottom') ? 'bottom' : 'center';
  const position: Vec2 = { x: Math.trunc(t.at.x), y: Math.trunc(t.at.y) };

  // `getLinePositions`
  const lines = splitTextLines(text);
  const interline = truncInt(size.y * METRICS.interlinePitch * LEGACY_FACTOR * 1.0);
  let height = 0;
  const extents: Vec2[] = [];
  lines.forEach((line, i) => {
    const pos: Vec2 = { x: position.x, y: position.y + i * interline };
    const end = drawMarkup(null, null, line, pos, size, ANGLE_0, false, { x: 0, y: 0 }, !!t.italic);
    extents.push({ x: end.x - pos.x, y: end.y - pos.y });
    if (i === 0)
      height = truncInt(height + size.y * 1.17); // 1.17 is a fudge to match 6.0 positioning
    else height += interline;
  });

  const offset: Pt = { x: 0, y: 0 };
  offset.y += size.y;
  // Fudge factors to match 6.0 positioning
  offset.x = truncInt(offset.x + strokeWidth / 1.52);
  offset.y = truncInt(offset.y - strokeWidth * 0.052);

  if (valign === 'center') offset.y -= Math.trunc(height / 2);
  else if (valign === 'bottom') offset.y -= height;

  const positions: Vec2[] = [];
  lines.forEach((_line, i) => {
    const lineSize = extents[i]!;
    const lineOffset: Pt = { x: offset.x, y: offset.y + i * interline };
    if (halign === 'center') lineOffset.x = -Math.trunc(lineSize.x / 2);
    else if (halign === 'right') lineOffset.x = -(lineSize.x + offset.x);
    positions.push({ x: position.x + lineOffset.x, y: position.y + lineOffset.y });
  });

  // `drawSingleLineText` per line, glyphs into the callback
  const glyphs: Vec2[][] = [];
  lines.forEach((line, i) => {
    drawMarkup(null, glyphs, line, positions[i]!, size, angle, !!t.mirror, position, !!t.italic);
  });

  const segs: [Vec2, Vec2][] = [];
  for (const pointList of glyphs)
    for (let ii = 1; ii < pointList.length; ii++)
      segs.push([
        { x: truncInt(pointList[ii - 1]!.x), y: truncInt(pointList[ii - 1]!.y) },
        { x: truncInt(pointList[ii]!.x), y: truncInt(pointList[ii]!.y) },
      ]);
  return segs;
}

/** `PCB_TEXT::TransformTextToPolySet`, the non-knockout branch. */
export function textTransformTextToPolySet(
  t: PcbTextItem,
  aClearance: number,
  aMaxError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  const penWidth = effectiveTextPenWidth({ thickness: t.thickness, bold: t.bold, size: t.size });
  let textShape: Polygon[] = [];
  for (const [a, b] of textStrokeSegments(t))
    textShape.push(...transformOvalToPolygon(a, b, penWidth, aMaxError, aErrorLoc));

  textShape = booleanAdd(textShape, []); // Simplify

  let clearance = aClearance;
  if (clearance > 0 || aErrorLoc === ErrorLoc.ERROR_OUTSIDE) {
    if (aErrorLoc === ErrorLoc.ERROR_OUTSIDE) clearance += aMaxError;
    textShape = inflate(
      textShape,
      clearance,
      CornerStrategy.ROUND_ALL_CORNERS,
      segmentsForRadius(Math.abs(clearance), aMaxError),
    );
  }
  return textShape;
}

/**
 * `PCB_TEXT::TransformShapeToPolygon`: the rendered text's bounding hull —
 * `buildBoundingHull( &aBuffer, poly, aClearance )`.
 */
export function textTransformShapeToPolygon(
  t: PcbTextItem,
  aClearance: number,
  aMaxError: number,
  aErrorLoc: ErrorLoc,
): Polygon[] {
  if (t.hide || !t.text) return [];
  const poly = textTransformTextToPolySet(t, 0, aMaxError, aErrorLoc);
  if (poly.length === 0) return [];

  const rotation = textDrawRotation(t);
  const drawPos: Vec2 = { x: Math.trunc(t.at.x), y: Math.trunc(t.at.y) };
  const minus = new EDA_ANGLE(-rotation.AsDegrees());

  // `poly.Rotate( -GetDrawRotation(), GetDrawPos() )`, then `BBox( aClearance )`
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of poly)
    for (const ring of p)
      for (const pt of ring) {
        const r = RotatePoint(pt, drawPos, minus);
        if (r.x < x0) x0 = r.x;
        if (r.y < y0) y0 = r.y;
        if (r.x > x1) x1 = r.x;
        if (r.y > y1) y1 = r.y;
      }
  x0 -= aClearance;
  y0 -= aClearance;
  x1 += aClearance;
  y1 += aClearance;

  const corners: Vec2[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const out: Vec2[] = [];
  for (const corner of corners) {
    const r = RotatePoint(corner, drawPos, rotation);
    const l = out[out.length - 1];
    if (!l || l.x !== r.x || l.y !== r.y) out.push(r);
  }
  return [[out]];
}
