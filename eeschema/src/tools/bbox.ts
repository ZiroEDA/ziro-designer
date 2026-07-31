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

/**
 * Approximate text box of a label/text item: anchored at its connection point and
 * growing away from it per the justification. Shared by click and box selection.
 */
export function labelBox(l: SchLabel): BBox {
  const h = l.effects?.fontSize?.[0] ?? 12700;
  const justify = l.effects?.justify;
  const w = Math.max(1, l.text.length) * h * 0.7;
  const at = l.at;
  const left = justify?.includes('right') ? at.x - w : at.x;
  const right = justify?.includes('right') ? at.x : at.x + w;
  const top = justify?.includes('bottom')
    ? at.y - h
    : justify?.includes('top')
      ? at.y
      : at.y - h / 2;
  const bottom = justify?.includes('bottom')
    ? at.y
    : justify?.includes('top')
      ? at.y + h
      : at.y + h / 2;
  return { minX: left, minY: top, maxX: right, maxY: bottom };
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
  // GetTextBox().GetWidth(), approximated the way labelBox above does, plus the
  // height upstream adds for the triangular shape.
  const length = Math.max(1, pin.name.length) * textHeight * 0.7 + height;

  let x = pin.at.x;
  let y = pin.at.y;
  let dx: number;
  let dy: number;
  switch (pin.angle) {
    case 90: // top edge, SPIN_STYLE::UP
      dx = height;
      dy = -length;
      x -= height / 2;
      y += DANGLING_SYMBOL_SIZE;
      break;
    case 180: // left edge, SPIN_STYLE::RIGHT
      dx = length;
      dy = height;
      x -= DANGLING_SYMBOL_SIZE;
      y -= height / 2;
      break;
    case 270: // bottom edge, SPIN_STYLE::BOTTOM
      dx = height;
      dy = length;
      x -= height / 2;
      y -= DANGLING_SYMBOL_SIZE;
      break;
    default: // right edge, SPIN_STYLE::LEFT
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
