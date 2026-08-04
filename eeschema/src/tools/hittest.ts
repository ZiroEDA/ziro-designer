// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hit-testing for selection, grounded in KiCad's `HitTest(point, accuracy)`:
 * lines test segment proximity within a tolerance, junctions/labels/symbols test
 * against their shape/bounding box. `accuracy` is a world-space tolerance the
 * caller derives from a pixel radius (so selection feels the same at any zoom).
 */

import type { Schematic, SchSymbol, LibGraphic, LibSymbol, Vec2 } from '../types.js';
import { contains, inflate, labelBox, sheetPinBBox, symbolBodyBBox } from './bbox.js';
import { directiveBox } from './directive_label.js';
import { imageSizeIU } from './image_size.js';
import { symbolFieldBoxes, type Box } from '../fieldbox.js';
import { symbolTransform, localToWorld } from '@ziroeda/common/src/transform.js';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';

/** The id of a placed symbol's field: `<symbolRefId>:field<k>`, as sheet pins
 *  are `<sheetRefId>:sheetpin<k>`. */
export const fieldId = (symbolRefId: string, index: number): string =>
  `${symbolRefId}:field${index}`;

/** A field's world box as a plain BBox. */
const fieldBBox = (b: Box): { minX: number; minY: number; maxX: number; maxY: number } => ({
  minX: b.x,
  minY: b.y,
  maxX: b.x + b.w,
  maxY: b.y + b.h,
});

/** The id of a placed symbol's pin: `<symbolRefId>:pin<k>`, the same identity
 *  the netlist uses for that pin. */
export const pinId = (symbolRefId: string, index: number): string => `${symbolRefId}:pin${index}`;

/** The id of a sheet's hierarchical pin, the same identity the netlist,
 *  connectivity and ERC already address it by. */
export const sheetPinId = (sheetRefId: string, index: number): string =>
  `${sheetRefId}:sheetpin${index}`;

/**
 * SCH_PIN::HitTest floors its accuracy at m_PinSymbolSize / 4 so a pin with no
 * name or number is still clickable (sch_pin.cpp). Default pin symbol size is
 * 25 mil.
 */
const PIN_HIT_FLOOR = (0.635 * 10000) / 4;

/** Local-space unit vector from a pin's connection point toward the body. */
function pinDirection(angle: number): Vec2 {
  switch (((angle % 360) + 360) % 360) {
    case 0:
      return { x: 1, y: 0 };
    case 90:
      return { x: 0, y: -1 };
    case 180:
      return { x: -1, y: 0 };
    default:
      return { x: 0, y: 1 };
  }
}

export interface PinSegment {
  id: string;
  symbolIndex: number;
  index: number;
  /** Connection point (the "active" end) in world coordinates. */
  at: Vec2;
  /** Where the pin line meets the symbol body, in world coordinates. */
  bodyEnd: Vec2;
}

/**
 * Every drawn pin of every placed symbol as a world-space segment.
 *
 * Pins are selectable items in eeschema, SCH_SELECTION_TOOL::Selectable has a
 * SCH_PIN_T case gated on the "Pins" selection filter and on visibility, and
 * GuessSelectionCandidates lets an exact pin hit win outright. Hidden pins are
 * skipped unless `showHidden`, matching `!pin->IsVisible() && !GetShowAllPins()`.
 */
export function collectPinSegments(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  showHidden = false,
): PinSegment[] {
  const out: PinSegment[] = [];
  sch.symbols.forEach((sym, si) => {
    const lib = libById.get(sym.libId);
    if (!lib) return;
    const symId = refId('symbol', sym.uuid, si);
    const t = symbolTransform(sym.angle, sym.mirror);
    let k = 0;
    for (const u of lib.units) {
      if (
        (u.unit !== 0 && u.unit !== sym.unit) ||
        (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
      )
        continue;
      for (const pin of u.pins) {
        const index = k++;
        if (pin.hidden && !showHidden) continue;
        const d = pinDirection(pin.angle);
        out.push({
          id: pinId(symId, index),
          symbolIndex: si,
          index,
          at: localToWorld(sym.at, t, pin.at),
          bodyEnd: localToWorld(sym.at, t, {
            x: pin.at.x + d.x * pin.length,
            y: pin.at.y + d.y * pin.length,
          }),
        });
      }
    }
  });
  return out;
}

/** Distance from p to the pin's line, the shape a pin is picked by. */
export function pinDistance(seg: PinSegment, p: Vec2): number {
  const { at: a, bodyEnd: b } = seg;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The accuracy a pin hit test uses, floored as SCH_PIN::HitTest does. */
export const pinAccuracy = (accuracy: number): number => Math.max(accuracy, PIN_HIT_FLOOR);

/** Every visible field of every placed symbol, with its id and world box. */
export function collectFieldBoxes(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
): { id: string; symbolIndex: number; index: number; bbox: ReturnType<typeof fieldBBox> }[] {
  const out: {
    id: string;
    symbolIndex: number;
    index: number;
    bbox: ReturnType<typeof fieldBBox>;
  }[] = [];
  sch.symbols.forEach((sym, si) => {
    const symId = refId('symbol', sym.uuid, si);
    for (const f of symbolFieldBoxes(sym, libById.get(sym.libId), measureText)) {
      out.push({
        id: fieldId(symId, f.index),
        symbolIndex: si,
        index: f.index,
        bbox: fieldBBox(f.box),
      });
    }
  });
  return out;
}

/** A reference to a top-level, selectable schematic item. */
export interface ItemRef {
  kind:
    | 'symbol'
    | 'line'
    | 'junction'
    | 'noconnect'
    | 'label'
    | 'sheet'
    | 'busentry'
    | 'image'
    | 'graphic'
    | 'textbox'
    | 'table'
    | 'directive'
    | 'field'
    | 'pin'
    | 'sheetpin';
  /** Stable identity: the item's uuid, or `idx:<n>` when one is absent. */
  id: string;
}

/** Whether world point p hits the stroke (or filled interior) of a graphic shape. */
function hitGraphic(g: LibGraphic, p: Vec2, tol: number): boolean {
  switch (g.kind) {
    case 'rectangle': {
      const x0 = Math.min(g.start.x, g.end.x),
        x1 = Math.max(g.start.x, g.end.x);
      const y0 = Math.min(g.start.y, g.end.y),
        y1 = Math.max(g.start.y, g.end.y);
      if (g.fill && g.fill.type !== 'none' && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
        return true;
      return (
        Math.min(
          distToSegment(p, { x: x0, y: y0 }, { x: x1, y: y0 }),
          distToSegment(p, { x: x0, y: y1 }, { x: x1, y: y1 }),
          distToSegment(p, { x: x0, y: y0 }, { x: x0, y: y1 }),
          distToSegment(p, { x: x1, y: y0 }, { x: x1, y: y1 }),
        ) <= tol
      );
    }
    case 'circle': {
      const d = Math.hypot(p.x - g.center.x, p.y - g.center.y);
      if (g.fill && g.fill.type !== 'none' && d <= g.radius) return true;
      return Math.abs(d - g.radius) <= tol;
    }
    case 'arc':
      // Approximate the arc by its start-mid-end chords (fine within tolerance).
      return distToSegment(p, g.start, g.mid) <= tol || distToSegment(p, g.mid, g.end) <= tol;
    case 'polyline':
    case 'bezier': {
      // Béziers hit-test against their control polygon (fine within tolerance).
      for (let i = 1; i < g.points.length; i++)
        if (distToSegment(p, g.points[i - 1]!, g.points[i]!) <= tol) return true;
      return false;
    }
    case 'text': {
      const h = g.effects?.fontSize?.[0] ?? 12700;
      return (
        Math.abs(p.x - g.at.x) <= h * Math.max(2, g.text.length) && Math.abs(p.y - g.at.y) <= h
      );
    }
  }
}

export function refId(kind: ItemRef['kind'], uuid: string | undefined, index: number): string {
  return uuid ?? `${kind}:idx:${index}`;
}

/** Distance from point p to segment ab. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Find the top-most selectable item at a world point, within `accuracy` (world
 * units). Priority roughly follows KiCad: small/precise items (junctions, labels,
 * wires) win over the larger symbol body they may overlap.
 */
export function hitTest(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  p: Vec2,
  accuracy: number,
): ItemRef | null {
  for (let i = 0; i < sch.junctions.length; i++) {
    const j = sch.junctions[i]!;
    const r = (j.diameter > 0 ? j.diameter : 9000) / 2 + accuracy;
    if (Math.hypot(p.x - j.at.x, p.y - j.at.y) <= r)
      return { kind: 'junction', id: refId('junction', j.uuid, i) };
  }

  // No-connect flags: KiCad's X spans DEFAULT_NOCONNECT_SIZE (48 mil) about the point.
  for (let i = 0; i < sch.noConnects.length; i++) {
    const nc = sch.noConnects[i]!;
    const half = 6096 + accuracy; // 24 mil in IU
    if (Math.abs(p.x - nc.at.x) <= half && Math.abs(p.y - nc.at.y) <= half)
      return { kind: 'noconnect', id: refId('noconnect', nc.uuid, i) };
  }

  for (let i = 0; i < sch.labels.length; i++) {
    const l = sch.labels[i]!;
    if (contains(inflate(labelBox(l), accuracy), p))
      return { kind: 'label', id: refId('label', l.uuid, i) };
  }

  // Netclass directive labels: the pin line and its flag (SCH_DIRECTIVE_LABEL).
  const directives = sch.directiveLabels ?? [];
  for (let i = 0; i < directives.length; i++) {
    const d = directives[i]!;
    if (contains(inflate(directiveBox(d), accuracy), p))
      return { kind: 'directive', id: refId('directive', d.uuid, i) };
  }

  for (let i = 0; i < sch.lines.length; i++) {
    const ln = sch.lines[i]!;
    const tol = accuracy + (ln.stroke && ln.stroke.width > 0 ? ln.stroke.width / 2 : 0);
    if (distToSegment(p, ln.start, ln.end) <= tol)
      return { kind: 'line', id: refId('line', ln.uuid, i) };
  }

  // Wire-to-bus entries: the 45° stub from `at` to `at + size`.
  for (let i = 0; i < sch.busEntries.length; i++) {
    const be = sch.busEntries[i]!;
    const end = { x: be.at.x + be.size.x, y: be.at.y + be.size.y };
    if (distToSegment(p, be.at, end) <= accuracy)
      return { kind: 'busentry', id: refId('busentry', be.uuid, i) };
  }

  // Sheet-level graphic shapes (rectangles/circles/arcs/polylines).
  for (let i = 0; i < sch.graphics.length; i++) {
    const g = sch.graphics[i]!;
    const tol =
      accuracy + (g.kind !== 'text' && g.stroke && g.stroke.width > 0 ? g.stroke.width / 2 : 0);
    if (hitGraphic(g, p, tol)) return { kind: 'graphic', id: refId('graphic', undefined, i) };
  }

  // Pins first: GuessSelectionCandidates takes an exact pin hit immediately
  // ("if( item->Type() == SCH_PIN_T || … ) { closest = item; break; }").
  for (const seg of collectPinSegments(sch, libById)) {
    if (pinDistance(seg, p) <= pinAccuracy(accuracy)) return { kind: 'pin', id: seg.id };
  }

  // Symbol fields are items in their own right (SCH_COLLECTOR::EditableItems
  // lists SCH_FIELD_T), and they sit over or beside the body, so they are
  // tested before it, or the body would swallow every reference click.
  for (const f of collectFieldBoxes(sch, libById)) {
    if (contains(inflate(f.bbox, accuracy / 2), p)) return { kind: 'field', id: f.id };
  }

  for (let i = 0; i < sch.symbols.length; i++) {
    const s = sch.symbols[i]!;
    const box = inflate(symbolBodyBBox(s, libById.get(s.libId)), accuracy / 2);
    if (contains(box, p)) return { kind: 'symbol', id: refId('symbol', s.uuid, i) };
  }

  // Embedded images: bounding box centred at `at`, its true extent read out of
  // the PNG header (SCH_BITMAP::GetBoundingBox over REFERENCE_IMAGE::GetSize).
  // This used to assume a flat 40x40 pixels, so a large image was only
  // clickable near its middle and a small one was clickable well outside itself.
  for (let i = 0; i < sch.images.length; i++) {
    const im = sch.images[i]!;
    const size = imageSizeIU(im);
    const halfW = size.w / 2;
    const halfH = size.h / 2;
    if (Math.abs(p.x - im.at.x) <= halfW + accuracy && Math.abs(p.y - im.at.y) <= halfH + accuracy)
      return { kind: 'image', id: refId('image', im.uuid, i) };
  }

  // Text boxes: KiCad's SCH_TEXTBOX::HitTest matches any point in the bounding
  // box (rect.Contains), so the whole box selects. Tested late (like sheets) so
  // smaller items drawn over it win first.
  for (let i = 0; i < sch.textBoxes.length; i++) {
    const tb = sch.textBoxes[i]!;
    const x0 = Math.min(tb.start.x, tb.end.x),
      x1 = Math.max(tb.start.x, tb.end.x);
    const y0 = Math.min(tb.start.y, tb.end.y),
      y1 = Math.max(tb.start.y, tb.end.y);
    if (
      p.x >= x0 - accuracy &&
      p.x <= x1 + accuracy &&
      p.y >= y0 - accuracy &&
      p.y <= y1 + accuracy
    )
      return { kind: 'textbox', id: refId('textbox', tb.uuid, i) };
  }

  // Tables: the union of every cell's bounding box (SCH_TABLE::HitTest).
  for (let i = 0; i < sch.tables.length; i++) {
    const t = sch.tables[i]!;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of t.cells) {
      minX = Math.min(minX, c.start.x, c.end.x);
      minY = Math.min(minY, c.start.y, c.end.y);
      maxX = Math.max(maxX, c.start.x, c.end.x);
      maxY = Math.max(maxY, c.start.y, c.end.y);
    }
    if (
      t.cells.length &&
      p.x >= minX - accuracy &&
      p.x <= maxX + accuracy &&
      p.y >= minY - accuracy &&
      p.y <= maxY + accuracy
    )
      return { kind: 'table', id: refId('table', t.uuid, i) };
  }

  // Sheets last: their rectangle is large, so smaller items inside win first
  // (KiCad's SCH_SHEET::HitTest accepts any point in the body box).
  // A sheet's pins are items in their own right (SCH_SHEET_PIN is a
  // SCH_LABEL_BASE), and sit on the border, so they are tested before the body
  // or the sheet would always win the click.
  for (let i = 0; i < sch.sheets.length; i++) {
    const sh = sch.sheets[i]!;
    const shId = refId('sheet', sh.uuid, i);
    for (let k = 0; k < sh.pins.length; k++) {
      if (contains(inflate(sheetPinBBox(sh.pins[k]!), accuracy), p))
        return { kind: 'sheetpin', id: sheetPinId(shId, k) };
    }
  }

  for (let i = 0; i < sch.sheets.length; i++) {
    const sh = sch.sheets[i]!;
    const box = inflate(
      { minX: sh.at.x, minY: sh.at.y, maxX: sh.at.x + sh.size.w, maxY: sh.at.y + sh.size.h },
      accuracy,
    );
    if (contains(box, p)) return { kind: 'sheet', id: refId('sheet', sh.uuid, i) };
  }

  return null;
}

/** Stable id for a symbol, matching `refId` usage in hitTest. */
export function symbolId(s: SchSymbol, index: number): string {
  return refId('symbol', s.uuid, index);
}

/** Resolve a selection id back to its typed ItemRef (linear scan). */
export function itemRefById(sch: Schematic, id: string): ItemRef | null {
  const scan = <T>(
    kind: ItemRef['kind'],
    arr: readonly T[],
    uuid: (t: T) => string | undefined,
  ): ItemRef | null => {
    for (let i = 0; i < arr.length; i++)
      if (refId(kind, uuid(arr[i]!), i) === id) return { kind, id };
    return null;
  };
  // `<sheetRefId>:sheetpin<k>`. Checked before the `:pin` case below, which it
  // does not collide with (`:sheetpin` contains no `:pin`) but reads clearer
  // adjacent to it. Without this a sheet pin resolved to null, and everything
  // downstream that asks "what is this id?" — the properties panel and the
  // message panel both — went blank on a selected sheet pin.
  const sheetPinAt = id.lastIndexOf(':sheetpin');
  if (sheetPinAt > 0) {
    const shId = id.slice(0, sheetPinAt);
    const k = Number(id.slice(sheetPinAt + ':sheetpin'.length));
    const si = sch.sheets.findIndex((s, i) => refId('sheet', s.uuid, i) === shId);
    if (si >= 0 && Number.isInteger(k) && k >= 0 && k < sch.sheets[si]!.pins.length)
      return { kind: 'sheetpin', id };
    return null;
  }
  // `<symbolRefId>:pin<k>`, a composite id, like fields below.
  const pinAt = id.lastIndexOf(':pin');
  if (pinAt > 0) {
    const symId = id.slice(0, pinAt);
    if (sch.symbols.some((s, i) => refId('symbol', s.uuid, i) === symId))
      return { kind: 'pin', id };
    return null;
  }
  // `<symbolRefId>:field<k>`, resolved before the plain scans, since the
  // symbol prefix would otherwise never match the composite id.
  const fieldAt = id.lastIndexOf(':field');
  if (fieldAt > 0) {
    const symId = id.slice(0, fieldAt);
    const k = Number(id.slice(fieldAt + 6));
    const si = sch.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === symId);
    if (si >= 0 && Number.isInteger(k) && k >= 0 && k < sch.symbols[si]!.fields.length) {
      return { kind: 'field', id };
    }
    return null;
  }
  return (
    scan('symbol', sch.symbols, (t) => t.uuid) ??
    scan('line', sch.lines, (t) => t.uuid) ??
    scan('junction', sch.junctions, (t) => t.uuid) ??
    scan('noconnect', sch.noConnects, (t) => t.uuid) ??
    scan('label', sch.labels, (t) => t.uuid) ??
    scan('sheet', sch.sheets, (t) => t.uuid) ??
    scan('busentry', sch.busEntries, (t) => t.uuid) ??
    scan('image', sch.images, (t) => t.uuid) ??
    scan('graphic', sch.graphics, () => undefined) ??
    scan('textbox', sch.textBoxes, (t) => t.uuid) ??
    scan('table', sch.tables, (t) => t.uuid) ??
    scan('directive', sch.directiveLabels ?? [], (t) => t.uuid)
  );
}
