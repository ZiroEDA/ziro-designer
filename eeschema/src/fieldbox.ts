// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol-field text geometry, ported from KiCad.
 *
 * KiCad does not draw a symbol field with its stored justification. Because the
 * parent symbol's transform would make mirrored/rotated justification ambiguous,
 * SCH_PAINTER::draw(SCH_FIELD) computes the field's *bounding box*, text box,
 * rotated by the text angle, mapped through the symbol transform, and then draws
 * the text centre-justified at the box centre (sch_painter.cpp). The properties
 * dialog's H/V-align columns likewise show the *effective* justification derived
 * from that box (SCH_FIELD::GetEffectiveHorizJustify / IsHorizJustifyFlipped).
 *
 * Ported here exactly from:
 *   - common/eda_text.cpp        EDA_TEXT::GetTextBox (single-line stroke text)
 *   - common/gr_text.cpp         GetPenSizeForBold/Normal, ClampTextPenSize
 *   - common/font/font.cpp       FONT::StringBoundaryLimits (stroke inflate ×1.5)
 *   - common/font/stroke_font.cpp GetTextAsGlyphs bbox (INTER_CHAR = 0.2)
 *   - eeschema/sch_field.cpp     GetBoundingBox, GetDrawRotation,
 *                                IsHoriz/VertJustifyFlipped, Get/SetEffective*Justify
 *   - eeschema/lib_symbol.cpp    LIB_SYMBOL::LetterSubReference
 *
 * Text width measurement is injected (the Newstroke advance function lives with
 * the renderer), so this stays framework-free and unit-testable.
 */

import type { LibSymbol, SchField, SchSymbol, Vec2 } from './types.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { textWidth } from '@ziroeda/common/src/font/font_provider.js';
import { ITALIC_TILT } from '@ziroeda/common/src/font/font_metrics.js';
import {
  symbolTransform,
  applyTransform,
  invertTransform,
  type Transform,
} from '@ziroeda/common/src/transform.js';

/** Advance width of `text` at glyph size `sizeIU` (Newstroke advance sum). */
export type TextMeasurer = (text: string, sizeIU: number) => number;

/** DEFAULT_SIZE_TEXT: 50 mil. */
export const DEFAULT_TEXT_SIZE = mmToIU(1.27);

/**
 * `include/font/font.h:62` `ITALIC_TILT = 1.0 / 8`: glyphs shear right by
 * y·tilt. Re-exported, not redeclared — the single home is
 * `common/src/font/font_metrics.ts`, and `@ziroeda/eeschema` is where the
 * symbol and schematic renderers have always reached for it.
 */
export { ITALIC_TILT } from '@ziroeda/common/src/font/font_metrics.js';

const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const centreOf = (b: Box): Vec2 => ({ x: b.x + Math.trunc(b.w / 2), y: b.y + Math.trunc(b.h / 2) });

/** EDA_TEXT::GetEffectiveTextPenWidth with aDefaultPenWidth = 0 (as GetTextBox calls it). */
function effectivePenWidth(w: number, h: number, bold: boolean): number {
  // GetTextThickness() is unmodelled (0) -> bold pen w/5, else normal pen w/8.
  const pen = bold ? kiRound(w / 5) : kiRound(w / 8);
  return Math.min(pen, kiRound(Math.min(Math.abs(w), Math.abs(h)) * 0.25)); // ClampTextPenSize
}

const fieldSize = (f: SchField): { h: number; w: number } => ({
  h: f.effects?.fontSize?.[0] ?? DEFAULT_TEXT_SIZE,
  w: f.effects?.fontSize?.[1] ?? DEFAULT_TEXT_SIZE,
});

export type HJustify = 'left' | 'center' | 'right';
type VJustify = 'top' | 'center' | 'bottom';

export const storedHJustify = (f: SchField): HJustify =>
  f.effects?.justify?.includes('left')
    ? 'left'
    : f.effects?.justify?.includes('right')
      ? 'right'
      : 'center';

export const storedVJustify = (f: SchField): VJustify =>
  f.effects?.justify?.includes('top')
    ? 'top'
    : f.effects?.justify?.includes('bottom')
      ? 'bottom'
      : 'center';

/** LIB_SYMBOL::LetterSubReference: 1→"A", 26→"Z", 27→"AA", … The initial
 *  letter is expected to be 'A' or 'a' (26 letters available). */
export function letterSubReference(unit: number, initialLetter = 'A'): string {
  let suffix = '';
  let n = unit;
  const base = initialLetter.charCodeAt(0);
  do {
    const u = (n - 1) % 26;
    suffix = String.fromCharCode(base + u) + suffix;
    n = Math.trunc((n - u) / 26); // C++ integer division
  } while (n > 0);
  return suffix;
}

/** The unit-notation slice of SCHEMATIC_SETTINGS the sub-reference reads:
 *  m_SubpartIdSeparator (0 = none, else the separator char code) and
 *  m_SubpartFirstId ('A' = letters, '1' = numbers). */
export interface SubpartSettings {
  separator: number;
  firstId: number;
}

/** SCHEMATIC_SETTINGS::SubReference (schematic_settings.cpp). */
export function subReference(
  unit: number,
  subpart: SubpartSettings = { separator: 0, firstId: 65 },
  addSeparator = true,
): string {
  let subRef = '';
  if (unit < 1) return subRef;
  if (subpart.separator !== 0 && addSeparator) subRef += String.fromCharCode(subpart.separator);
  if (subpart.firstId >= 48 && subpart.firstId <= 57) subRef += String(unit);
  else subRef += letterSubReference(unit, String.fromCharCode(subpart.firstId));
  return subRef;
}

/**
 * The text the painter shows for a field (SCH_FIELD::GetShownText with extras):
 * a multi-unit Reference gains its sub-reference per the project's unit
 * notation (GetRef(..., true) → SubReference); `show_name` prefixes "Name: ".
 */
export function fieldShownText(
  field: SchField,
  sym: SchSymbol,
  unitCount: number,
  subpart?: SubpartSettings,
): string {
  let text = field.value;
  if (field.key === 'Reference' && unitCount > 1) text += subReference(sym.unit, subpart);
  if (field.nameShown) text = `${field.key}: ${text}`;
  return text;
}

/**
 * EDA_TEXT::GetTextBox for a single-line stroke-font field, anchored at the field
 * position with the *stored* justification, before any rotation/transform.
 */
export function fieldTextBox(field: SchField, shownText: string, posOverride?: Vec2): Box {
  const { h, w } = fieldSize(field);
  const bold = !!field.effects?.bold;
  const italic = !!field.effects?.italic;
  const thickness = effectivePenWidth(w, h, bold);

  // FONT::StringBoundaryLimits: stroke glyph run bbox, inflated by round(1.5·pen).
  const inflate = kiRound(thickness * 1.5);
  // Through the shared entry point (#154), so a field carrying `(font (face …))`
  // is measured by whatever will draw it. With no provider installed that is
  // the stroke font, which is what the injected measurer always was.
  const extentsX =
    textWidth(shownText, w, { face: field.effects?.face, bold, italic }) -
    kiRound(w * 0.2) +
    2 * inflate; // INTER_CHAR = 0.2
  const extentsY = h + 2 * inflate;

  const fudge = kiRound(extentsY * 0.17); // stroke-font fudge factor
  // `if( text.Contains( "~{" ) ) overbarOffset = extents.y / 6;` — an overbar
  // climbs above the nominal ascent, so the box grows to hold it. Integer
  // division in C++, hence trunc and not round. It is added AFTER the fudge and
  // is part of GetHeight(), which is what the centre/bottom arms below divide
  // and subtract; the top/bottom *offsets* stay on the fudge alone.
  const overbar = shownText.includes('~{') ? Math.trunc(extentsY / 6) : 0;
  const pos = posOverride ?? field.at ?? { x: 0, y: 0 };
  const box: Box = { x: pos.x, y: pos.y, w: extentsX, h: extentsY + fudge + overbar };

  const italicOffset = italic ? kiRound(h * ITALIC_TILT) : 0;
  switch (storedHJustify(field)) {
    case 'left':
      break;
    case 'center':
      box.x -= Math.trunc((box.w - italicOffset) / 2);
      break;
    case 'right':
      box.x -= box.w - italicOffset;
      break;
  }
  switch (storedVJustify(field)) {
    case 'top':
      box.y -= fudge;
      break;
    case 'center':
      box.y -= Math.trunc(box.h / 2);
      break;
    case 'bottom':
      box.y -= box.h;
      box.y += fudge;
      break;
  }
  return box;
}

/** kimath RotatePoint: (x,y) → (x·cosθ + y·sinθ, −x·sinθ + y·cosθ) about `c`. */
function rotatePoint(p: Vec2, c: Vec2, angleDeg: number): Vec2 {
  const a = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const x = p.x - c.x;
  const y = p.y - c.y;
  return { x: c.x + kiRound(x * cos + y * sin), y: c.y + kiRound(y * cos - x * sin) };
}

/** A symbol's placement, as much of it as a field's position depends on. */
export interface SymbolPlacement {
  readonly at: Vec2;
  readonly angle: number;
  readonly mirror?: 'x' | 'y';
}

/**
 * `SCH_FIELD::GetPosition()` composed with `SCH_FIELD::SetPosition()`: where a
 * field that KiCad is not moving ends up drawn once its parent symbol's
 * placement changes.
 *
 * KiCad never writes this composition, because it does not have to. A symbol's
 * field stores `m_pos` in **symbol-local, un-transformed** coordinates, and the
 * position that is drawn and written to file is derived on demand
 * (sch_field.cpp:1425-1438):
 *
 *     relativePos = GetTextPos() - parentSymbol->GetPosition();
 *     relativePos = parentSymbol->GetTransform().TransformCoordinate( relativePos );
 *     return relativePos + parentSymbol->GetPosition();
 *
 * so `SetOrientation` alone carries every field round with the body. We hold the
 * derived position instead — it is what the file's `(at …)` means
 * (`saveField`, sch_io_kicad_sexpr.cpp:1016-1019) and what `fieldBoundingBox`
 * takes back through the inverse — so the trip out to local and back has to be
 * spelled out at every place that changes a symbol's angle, mirror or position.
 */
export function reanchorFields<F extends SchField>(
  fields: readonly F[],
  from: SymbolPlacement,
  to: SymbolPlacement,
): readonly F[] {
  const toLocal = invertTransform(symbolTransform(from.angle, from.mirror));
  const toWorld = symbolTransform(to.angle, to.mirror);
  return fields.map((f) => {
    if (!f.at) return f;
    const local = applyTransform(toLocal, { x: f.at.x - from.at.x, y: f.at.y - from.at.y });
    const drawn = applyTransform(toWorld, local);
    return { ...f, at: { x: to.at.x + drawn.x, y: to.at.y + drawn.y } };
  });
}

/**
 * SCH_FIELD::GetBoundingBox: the text box rotated by the field angle around the
 * field position and mapped through the parent symbol's transform. This box is in
 * schematic coordinates; the painter draws the text centred inside it.
 *
 * The file's `(at ...)` for a symbol field is SCH_FIELD::GetPosition(), the
 * *transformed* position. KiCad's internal GetTextPos() is the pre-transform
 * one (GetPosition applies the parent transform, sch_field.cpp), so the box is
 * built at inverse-transform(at - origin) and mapped forward again.
 */
export function fieldBoundingBox(field: SchField, sym: SchSymbol, shownText: string): Box {
  const origin = sym.at;
  const t: Transform = symbolTransform(sym.angle, sym.mirror);
  const relFile: Vec2 = { x: (field.at?.x ?? 0) - origin.x, y: (field.at?.y ?? 0) - origin.y };
  const pos = applyTransform(invertTransform(t), relFile); // GetTextPos() - origin

  const box = fieldTextBox(field, shownText, pos);
  let begin: Vec2 = { x: box.x, y: box.y };
  let end: Vec2 = { x: box.x + box.w, y: box.y + box.h };
  begin = rotatePoint(begin, pos, field.angle);
  end = rotatePoint(end, pos, field.angle);

  begin = applyTransform(t, begin);
  end = applyTransform(t, end);

  const minX = Math.min(begin.x, end.x) + origin.x;
  const minY = Math.min(begin.y, end.y) + origin.y;
  const maxX = Math.max(begin.x, end.x) + origin.x;
  const maxY = Math.max(begin.y, end.y) + origin.y;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * SCH_FIELD::GetDrawRotation: the angle the text is actually drawn at, the
 * field's own angle, toggled H<->V when the symbol transform has y1 != 0
 * (i.e. the symbol is rotated 90°/270°).
 */
export function fieldDrawRotation(field: SchField, sym: SchSymbol): 0 | 90 {
  const vertical = ((field.angle % 180) + 180) % 180 === 90;
  const t = symbolTransform(sym.angle, sym.mirror);
  return (t.y1 !== 0 ? !vertical : vertical) ? 90 : 0;
}

/** SCH_FIELD::IsHorizJustifyFlipped: does the box render on the other side of the anchor? */
export function isHorizJustifyFlipped(
  field: SchField,
  sym: SchSymbol,
  shownText: string,
  measure: TextMeasurer,
): boolean {
  const centre = centreOf(fieldBoundingBox(field, sym, shownText));
  const pos = field.at ?? { x: 0, y: 0 };
  const vertical = fieldDrawRotation(field, sym) === 90;
  switch (storedHJustify(field)) {
    case 'left':
      return vertical ? centre.y > pos.y : centre.x < pos.x;
    case 'right':
      return vertical ? centre.y < pos.y : centre.x > pos.x;
    default:
      return false;
  }
}

/** SCH_FIELD::IsVertJustifyFlipped. */
export function isVertJustifyFlipped(
  field: SchField,
  sym: SchSymbol,
  shownText: string,
  measure: TextMeasurer,
): boolean {
  const centre = centreOf(fieldBoundingBox(field, sym, shownText));
  const pos = field.at ?? { x: 0, y: 0 };
  const vertical = fieldDrawRotation(field, sym) === 90;
  switch (storedVJustify(field)) {
    case 'top':
      return vertical ? centre.x < pos.x : centre.y < pos.y;
    case 'bottom':
      return vertical ? centre.x > pos.x : centre.y > pos.y;
    default:
      return false;
  }
}

const flipH = (j: HJustify): HJustify => (j === 'left' ? 'right' : j === 'right' ? 'left' : j);
const flipV = (j: VJustify): VJustify => (j === 'top' ? 'bottom' : j === 'bottom' ? 'top' : j);

/** SCH_FIELD::GetEffectiveHorizJustify, what the dialog's H-Align column shows. */
export function effectiveHorizJustify(
  field: SchField,
  sym: SchSymbol,
  shownText: string,
  measure: TextMeasurer,
): HJustify {
  const j = storedHJustify(field);
  return j === 'center' ? j : isHorizJustifyFlipped(field, sym, shownText, measure) ? flipH(j) : j;
}

/** SCH_FIELD::GetEffectiveVertJustify, what the dialog's V-Align column shows. */
export function effectiveVertJustify(
  field: SchField,
  sym: SchSymbol,
  shownText: string,
  measure: TextMeasurer,
): VJustify {
  const j = storedVJustify(field);
  return j === 'center' ? j : isVertJustifyFlipped(field, sym, shownText, measure) ? flipV(j) : j;
}

/**
 * SCH_FIELD::SetEffectiveHorizJustify: the stored justification that renders as
 * `desired`. Set first, then flip if the render side is inverted (exact KiCad order).
 */
export function storedForEffectiveHoriz(
  field: SchField,
  sym: SchSymbol,
  shownText: string,
  measure: TextMeasurer,
  desired: HJustify,
): HJustify {
  if (desired === 'center') return 'center';
  const trial: SchField = {
    ...field,
    effects: {
      ...(field.effects ?? { hidden: false }),
      justify: justifyTokens(desired, storedVJustify(field)),
    },
  };
  return isHorizJustifyFlipped(trial, sym, shownText, measure) ? flipH(desired) : desired;
}

/** SCH_FIELD::SetEffectiveVertJustify. */
export function storedForEffectiveVert(
  field: SchField,
  sym: SchSymbol,
  shownText: string,
  measure: TextMeasurer,
  desired: VJustify,
): VJustify {
  if (desired === 'center') return 'center';
  const trial: SchField = {
    ...field,
    effects: {
      ...(field.effects ?? { hidden: false }),
      justify: justifyTokens(storedHJustify(field), desired),
    },
  };
  return isVertJustifyFlipped(trial, sym, shownText, measure) ? flipV(desired) : desired;
}

/** Canonical justify token array (h then v, centres omitted); undefined when both centred. */
export function justifyTokens(h: HJustify, v: VJustify): readonly string[] | undefined {
  const tokens: string[] = [];
  if (h !== 'center') tokens.push(h);
  if (v !== 'center') tokens.push(v);
  return tokens.length ? tokens : undefined;
}

// ----- selection geometry -----------------------------------------------------

/** A placed symbol's field as the selection sees it: its world bounding box. */
export interface SymbolFieldBox {
  /** Index into `sym.fields`, the `k` of the `<symbolRefId>:field<k>` id. */
  index: number;
  key: string;
  shown: string;
  box: Box;
}

/**
 * The visible fields of a placed symbol with their bounding boxes.
 *
 * KiCad treats every SCH_FIELD as a selectable, movable item in its own right
 * (SCH_COLLECTOR::EditableItems / MovableItems both list SCH_FIELD_T), so
 * clicking a reference or footprint text picks the text, not the symbol. Hidden
 * fields and empty ones are not drawn and so cannot be picked, matching
 * SCH_SELECTION_TOOL::Selectable's IsVisible() gate.
 */
export function symbolFieldBoxes(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  opts: { showHidden?: boolean; subpart?: SubpartSettings } = {},
): SymbolFieldBox[] {
  const unitCount = lib ? lib.units.reduce((m, u) => Math.max(m, u.unit), 0) : 1;
  const out: SymbolFieldBox[] = [];
  sym.fields.forEach((f, index) => {
    if (!f.at) return;
    if (f.effects?.hidden && !opts.showHidden) return;
    const shown = fieldShownText(f, sym, unitCount, opts.subpart);
    if (shown === '') return;
    out.push({ index, key: f.key, shown, box: fieldBoundingBox(f, sym, shown) });
  });
  return out;
}
