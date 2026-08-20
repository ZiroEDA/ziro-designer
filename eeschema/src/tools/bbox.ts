// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Axis-aligned bounding boxes in world (internal-unit) space.
 *
 * Used for hit-testing and drawing selection highlights. The symbol body box
 * mirrors KiCad's `SCH_SYMBOL::GetBodyBoundingBox`: the extent of the unit's
 * graphics and pins, mapped through the placement transform (fields excluded).
 */

import { localToWorld, type Transform } from '@ziroeda/common/src/transform.js';
import { symbolTransform } from '@ziroeda/common/src/transform.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { TextStyle } from '@ziroeda/common/src/font/font_provider.js';
import { stringBoundaryLimits } from '@ziroeda/common/src/font/text_box.js';
import type { LibSymbol, LibSymbolUnit, SchLabel, SchSymbol, SheetPin, Vec2 } from '../types.js';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBBox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function isEmpty(b: BBox): boolean {
  return !(b.minX <= b.maxX && b.minY <= b.maxY);
}

export function includePoint(b: BBox, p: Vec2): void {
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}

export function inflate(b: BBox, d: number): BBox {
  return { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d };
}

export function contains(b: BBox, p: Vec2): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

function includeUnit(b: BBox, unit: LibSymbolUnit, origin: Vec2, t: Transform): void {
  for (const g of unit.graphics) {
    switch (g.kind) {
      case 'rectangle':
        for (const c of [
          g.start,
          { x: g.end.x, y: g.start.y },
          g.end,
          { x: g.start.x, y: g.end.y },
        ])
          includePoint(b, localToWorld(origin, t, c));
        break;
      case 'polyline':
      case 'bezier': // control-point hull is a conservative bound
        for (const p of g.points) includePoint(b, localToWorld(origin, t, p));
        break;
      case 'circle':
        for (const c of [
          { x: g.center.x - g.radius, y: g.center.y },
          { x: g.center.x + g.radius, y: g.center.y },
          { x: g.center.x, y: g.center.y - g.radius },
          { x: g.center.x, y: g.center.y + g.radius },
        ])
          includePoint(b, localToWorld(origin, t, c));
        break;
      case 'arc':
        includePoint(b, localToWorld(origin, t, g.start));
        includePoint(b, localToWorld(origin, t, g.mid));
        includePoint(b, localToWorld(origin, t, g.end));
        break;
      case 'text':
        includePoint(b, localToWorld(origin, t, g.at));
        break;
    }
  }
  for (const pin of unit.pins) includePoint(b, localToWorld(origin, t, pin.at));
}

function unitMatches(u: LibSymbolUnit, unit: number, bodyStyle: number): boolean {
  return (u.unit === 0 || u.unit === unit) && (u.bodyStyle === 0 || u.bodyStyle === bodyStyle);
}

/** The schematic's default line width (6 mil), which text is stroked with. */
const DEFAULT_PEN = mmToIU(6 * 0.0254);

/**
 * `EDA_TEXT::GetEffectiveTextPenWidth` for schematic text left at the default
 * thickness: the default pen, or size/5 when bold, clamped to a quarter of the
 * size so tiny text does not turn into a blob (`ClampTextPenSize`).
 */
export function textPenWidth(height: number, bold = false): number {
  const pen = bold ? Math.round(height / 5) : DEFAULT_PEN;
  return Math.min(pen, Math.round(height * 0.25));
}

/**
 * The width of a run of schematic text, as `GetTextBox` measures it:
 * `FONT::StringBoundaryLimits`, which for a stroke font is the glyph-run box
 * inflated by `KiROUND( 1.5 × thickness )` on each side.
 *
 * This is `common/src/font/text_box.ts`'s `stringBoundaryLimits`, not a second
 * copy of it. The copy that used to live here added the pen but never took off
 * the trailing side bearing: `STROKE_FONT::GetTextAsGlyphs`
 * (`common/font/stroke_font.cpp:283`) closes the box at
 *
 *     aBBox->SetEnd( cursor.x - KiROUND( glyphSize.x * INTER_CHAR ), … )
 *
 * with `INTER_CHAR = 0.2`, because every Newstroke advance carries a trailing
 * bearing and the last one is not part of the ink. Leaving it on made every
 * schematic label, hierarchical label, sheet pin and free-text box
 * `0.2 · size` too wide — 10 mil at the default 50 mil text — which a user saw
 * as a global label flag drawn too long for its own text and as clicks landing
 * on a label from a tenth of a character's width past its right edge.
 * `fieldbox.ts` next door had the term all along.
 */
export function textBoxWidth(
  text: string,
  height: number,
  bold = false,
  style?: TextStyle,
): number {
  // Schematic text is square: `GetTextWidth()` and `GetTextHeight()` are both
  // the one stored size everywhere this is called from.
  return stringBoundaryLimits(
    text,
    { size: { x: height, y: height }, bold, italic: style?.italic, face: style?.face },
    textPenWidth(height, bold),
  ).x;
}

/** SPIN_STYLE, in KiCad's order. */
export const SPIN = { LEFT: 0, UP: 1, RIGHT: 2, BOTTOM: 3 } as const;

/** `SCH_LABEL_BASE::GetSpinStyle`: from the text angle and horizontal justify. */
export function labelSpin(angle: number, justify?: readonly string[]): number {
  const vertical = (((angle % 360) + 360) % 360) % 180 === 90;
  const right = justify?.includes('right') ?? false;
  if (vertical) return right ? SPIN.BOTTOM : SPIN.UP;
  return right ? SPIN.LEFT : SPIN.RIGHT;
}

/** The spin rotation CreateGraphicShape applies to its points. */
export function spinRotate(p: Vec2, spin: number): Vec2 {
  switch (spin) {
    case SPIN.UP:
      return { x: p.y, y: -p.x };
    case SPIN.RIGHT:
      return { x: -p.x, y: -p.y };
    case SPIN.BOTTOM:
      return { x: -p.y, y: p.x };
    default:
      return p;
  }
}

/** DEFAULT_LABEL_SIZE_RATIO: the box expansion around a global label's text. */
const DEFAULT_LABEL_SIZE_RATIO = 0.375;

/**
 * `SCH_GLOBALLABEL::CreateGraphicShape`: the six points of a global label's
 * outline, in world coordinates.
 *
 * Shared with the painter so the shape a label is drawn as and the box it is
 * selected by cannot drift apart — they were two separate estimates before, and
 * they disagreed.
 */
export function globalLabelShape(l: SchLabel, labelSizeRatio = DEFAULT_LABEL_SIZE_RATIO): Vec2[] {
  const h = l.effects?.fontSize?.[0] ?? 12700;
  const bold = !!l.effects?.bold;
  const pen = textPenWidth(h, bold);
  const margin = labelSizeRatio * h;
  const halfSize = h / 2 + margin;
  const symbLen = textBoxWidth(l.text, h, bold) + 2 * margin;
  const x = symbLen + pen + 3;
  const y = halfSize + pen + 3;

  const box: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: 0, y: -y },
    { x: -x, y: -y },
    { x: -x, y: 0 },
    { x: -x, y },
    { x: 0, y },
  ];

  // The flag's notch and point, per shape.
  let xoff = 0;
  const shape = l.shape ?? 'bidirectional';
  if (shape === 'input') {
    xoff = -halfSize;
    box[0]!.x += halfSize;
  } else if (shape === 'output') {
    box[3]!.x -= halfSize;
  } else if (shape === 'bidirectional' || shape === 'tri_state') {
    xoff = -halfSize;
    box[0]!.x += halfSize;
    box[3]!.x -= halfSize;
  }

  const spin = labelSpin(l.angle, l.effects?.justify);
  return box.map((p) => {
    const r = spinRotate({ x: p.x + xoff, y: p.y }, spin);
    return { x: l.at.x + r.x, y: l.at.y + r.y };
  });
}

/**
 * Body box of a label or free text. Counterpart: `SCH_LABEL::GetBodyBoundingBox`
 * — the measured text box, lifted by the text offset that holds a label clear
 * of its wire, inflated by the pen, and merged with the anchor point (which
 * sits outside the text box, since the text hangs off it).
 *
 * The width is measured rather than estimated: `III` and `WWW` are the same
 * length in characters and nothing like the same width on screen, and this box
 * is what decides whether a click lands on the label.
 *
 * The nominal text height is the right starting point and not a shortcut:
 * KiCad's own stroke font ends `GetTextAsGlyphs` with
 * `aBBox->SetEnd( cursor.x - …, cursor.y - glyphSize.y )`, so a line of `xxx`
 * boxes the same as `XXX` upstream too. The per-glyph boxes it builds feed the
 * advance *width* only.
 *
 * What the nominal height still needs, and what `labelTextBox` below adds, is
 * everything `EDA_TEXT::GetTextBox` puts around it.
 */
/**
 * `EDA_TEXT::GetTextBox` for one line of schematic text.
 *
 * The pieces, in upstream's order, because each one moves an edge:
 *
 *  1. `FONT::StringBoundaryLimits` — the glyph extent inflated by
 *     `1.5 × thickness` on every side for a stroke font, "to catch
 *     diacriticals, descenders, etc.". `textBoxWidth` already carries that on
 *     the width; the height needs it too.
 *  2. a stroke-font `fudgeFactor` of `0.17 × extents.y`, added to the height —
 *     and taken from the *inflated* extent, not the raw one.
 *  3. an overbar allowance of `extents.y / 6` when the text contains `~{`.
 *  4. justification, which moves the box relative to the anchor. The vertical
 *     cases also *use* the fudge: top offsets by `-fudge`, bottom by `+fudge`.
 *
 * Vertical justification defaults to centre here. KiCad reads it from the item
 * and our file model often has no vertical token at all; centre is what this
 * codebase has always drawn and hit-tested with, so it stays the default rather
 * than being changed on an unverifiable reading.
 */
export function labelTextBox(
  text: string,
  height: number,
  bold: boolean,
  justify: readonly string[] | undefined,
  at: Vec2,
): BBox {
  const pen = textPenWidth(height, bold);
  // StringBoundaryLimits inflates both axes; textBoxWidth has the width half.
  const extentsX = textBoxWidth(text, height, bold);
  const extentsY = height + 3 * pen;
  const fudge = Math.round(extentsY * 0.17);
  let sizeY = extentsY + fudge;
  // `text.Contains( "~{" )`: an overbar climbs above the nominal ascent.
  if (text.includes('~{')) sizeY += Math.round(extentsY / 6);

  // GetTextBox's horizontal switch, unmirrored:
  //
  //   LEFT   — origin stays on the anchor
  //   CENTER — bbox.SetX( bbox.GetX() - ( bbox.GetWidth() - italicOffset ) / 2 )
  //   RIGHT  — bbox.SetX( bbox.GetX() - ( bbox.GetWidth() - italicOffset ) )
  //
  // A label only ever carries left or right (`SetSpinStyle` sets one or the
  // other), but free text can be centred, and the centre arm used to return the
  // anchor unchanged — the same expression on both sides of the conditional —
  // so centred text was boxed entirely to its right.
  const right = justify?.includes('right') ?? false;
  const centreH = !right && !justify?.includes('left');
  const x0 = right ? at.x - extentsX : centreH ? at.x - extentsX / 2 : at.x;

  let y0: number;
  if (justify?.includes('top')) y0 = at.y - fudge;
  else if (justify?.includes('bottom')) y0 = at.y - sizeY + fudge;
  else y0 = at.y - sizeY / 2;

  return { minX: x0, minY: y0, maxX: x0 + extentsX, maxY: y0 + sizeY };
}

export function labelBox(l: SchLabel): BBox {
  const h = l.effects?.fontSize?.[0] ?? 12700;
  const justify = l.effects?.justify;
  const bold = !!l.effects?.bold;
  const pen = textPenWidth(h, bold);
  // A global label is boxed by its outline, not by its text
  // (SCH_LABEL_BASE::GetBodyBoundingBox merges the graphic shape's points and
  // inflates by half the pen). That box is bigger than the text on every side,
  // which is what makes the whole flag clickable and not just the letters.
  if (l.kind === 'global_label') {
    const b = emptyBBox();
    for (const p of globalLabelShape(l)) includePoint(b, p);
    return inflate(b, pen / 2);
  }
  // `SCH_LABEL::GetBodyBoundingBox`: the text box, lifted by the text offset,
  // inflated by the pen, turned by the text angle, and finally merged with the
  // anchor — the point where the wire actually attaches, which sits outside the
  // text box and would otherwise not be clickable at all.
  const box = labelTextBox(l.text, h, bold, justify, l.at);
  const offset = Math.round(TEXT_OFFSET_RATIO * h);
  let out: BBox = {
    minX: box.minX,
    minY: box.minY - offset,
    maxX: box.maxX,
    maxY: box.maxY - offset,
  };
  out = inflate(out, pen);

  const spinAngle = textAngleOf(l);
  if (spinAngle !== 0) {
    const b = emptyBBox();
    for (const p of [
      { x: out.minX, y: out.minY },
      { x: out.maxX, y: out.maxY },
    ]) {
      includePoint(b, rotateAbout(p, l.at, spinAngle));
    }
    out = b;
  }

  includePoint(out, l.at);
  return out;
}

/**
 * `EDA_TEXT::GetTextAngle()` for a label: 0 or 90, never 180 or 270.
 *
 * A label's stored angle is not its text angle. `saveText` folds the spin style
 * into the angle it writes, because a label's text is always drawn left-to-right
 * or bottom-to-top while the item itself faces four ways:
 *
 *     // The angle of the text is always 0 or 90 degrees for readibility reasons,
 *     // but the item itself can have more rotation (-90 and 180 deg)
 *     case SPIN_STYLE::LEFT:   angle += ANGLE_180; break;
 *     case SPIN_STYLE::BOTTOM: angle += ANGLE_180; break;
 *
 * and the parser undoes it on the way back in, mapping 0/90/180/270 straight to
 * a spin style, which `SetSpinStyle` then splits into a text angle of 0 or 90
 * plus a horizontal justification. So upstream's `GetTextAngle()` never sees the
 * 180. We keep the file's angle on the item instead, which is fine everywhere
 * that reads the spin (`labelSpin` takes `angle % 180` and the justify) — but
 * `GetBodyBoundingBox` rotates by the *text* angle, and rotating by the stored
 * 180 instead reflects the box through the anchor. The text of a spin-LEFT label
 * is drawn to the left of its anchor while its box sat to the right: clicking
 * the letters selected nothing, and clicking the empty space opposite selected
 * the label. 829 labels in KiCad's own demos are stored at 180.
 *
 * Free text is not a label — `saveText` only folds the spin in `if( label )` —
 * so it keeps whatever angle it was written with.
 */
function textAngleOf(l: SchLabel): number {
  const a = (((l.angle ?? 0) % 360) + 360) % 360;
  if (l.kind === 'text') return a;
  return a % 180 === 90 ? 90 : 0;
}

/** `RotatePoint( point, centre, angle )`, degrees, screen axes. */
function rotateAbout(p: Vec2, centre: Vec2, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return {
    x: Math.round(centre.x + dx * c + dy * s),
    y: Math.round(centre.y - dx * s + dy * c),
  };
}

/** DANGLING_SYMBOL_SIZE (default_values.h), 12 mils. */
const DANGLING_SYMBOL_SIZE = mmToIU(12 * 0.0254);
/** DEFAULT_TEXT_OFFSET_RATIO (default_values.h), the gap between a flag and its text. */
const TEXT_OFFSET_RATIO = 0.15;
const DEFAULT_TEXT_HEIGHT = mmToIU(1.27);

/**
 * A sheet pin's bounding box, flag and text together. Counterpart:
 * `SCH_HIERLABEL::GetBodyBoundingBox` (SCH_SHEET_PIN is a SCH_HIERLABEL), whose
 * box runs `length` away from the anchor along the pin's side and `height`
 * across it, where the length carries an extra `height` for the flag's
 * triangular point and the anchor is pulled back by DANGLING_SYMBOL_SIZE.
 *
 * The side comes from the file's angle encoding, which is the spin style:
 * 0 = right, 90 = top, 180 = left, 270 = bottom.
 */
export function sheetPinBBox(pin: SheetPin): BBox {
  const textHeight = pin.effects?.fontSize?.[1] ?? DEFAULT_TEXT_HEIGHT;
  // GetEffectiveTextPenWidth for a default-thickness label.
  const penWidth = Math.round(textHeight / 8);
  const margin = Math.round(TEXT_OFFSET_RATIO * textHeight);
  const height = textHeight + penWidth + margin;
  // GetTextBox().GetWidth(), measured the way labelBox does, plus the height
  // upstream adds for the triangular shape.
  const length = textBoxWidth(pin.name, textHeight, !!pin.effects?.bold) + height;

  let x = pin.at.x;
  let y = pin.at.y;
  let dx: number;
  let dy: number;
  // The edge decides the spin, and `SCH_SHEET_PIN::SetSide` *inverts* it so the
  // pin faces into the sheet: LEFT -> RIGHT, RIGHT -> LEFT, TOP -> BOTTOM,
  // BOTTOM -> UP. The bodies below are `SCH_HIERLABEL::GetBodyBoundingBox`'s,
  // picked by that inverted spin. The two horizontal edges were already
  // inverted; the vertical pair was not, so a pin on the top or bottom edge had
  // its box on the wrong side of the border — outside the sheet instead of in.
  switch (pin.angle) {
    case 90: // top edge -> SPIN_STYLE::BOTTOM
      dx = height;
      dy = length;
      x -= height / 2;
      y -= DANGLING_SYMBOL_SIZE;
      break;
    case 180: // left edge -> SPIN_STYLE::RIGHT
      dx = length;
      dy = height;
      x -= DANGLING_SYMBOL_SIZE;
      y -= height / 2;
      break;
    case 270: // bottom edge -> SPIN_STYLE::UP
      dx = height;
      dy = -length;
      x -= height / 2;
      y += DANGLING_SYMBOL_SIZE;
      break;
    default: // right edge -> SPIN_STYLE::LEFT
      dx = -length;
      dy = height;
      x += DANGLING_SYMBOL_SIZE;
      y -= height / 2;
      break;
  }
  // BOX2I( origin, size ).Normalize(), which sorts the corners.
  return {
    minX: Math.min(x, x + dx),
    minY: Math.min(y, y + dy),
    maxX: Math.max(x, x + dx),
    maxY: Math.max(y, y + dy),
  };
}

/** Body bounding box of a placed symbol (graphics + pins through the transform). */
export function symbolBodyBBox(sym: SchSymbol, lib: LibSymbol | undefined): BBox {
  const b = emptyBBox();
  if (!lib) {
    // Fallback: a small box around the origin so the symbol is still selectable.
    includePoint(b, { x: sym.at.x - 12700, y: sym.at.y - 12700 });
    includePoint(b, { x: sym.at.x + 12700, y: sym.at.y + 12700 });
    return b;
  }
  const t = symbolTransform(sym.angle, sym.mirror);
  for (const u of lib.units) {
    if (unitMatches(u, sym.unit, sym.bodyStyle)) includeUnit(b, u, sym.at, t);
  }
  if (isEmpty(b)) includePoint(b, sym.at);
  return b;
}
