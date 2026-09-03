// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pure editing operations on a LibSymbol, mirroring KiCad's symbol editor tools
 * (symbol_editor_edit_tool.cpp / symbol_editor_pin_tool.cpp / drawing tools).
 *
 * Every operation returns a new LibSymbol; the editor keeps whole-symbol
 * snapshots for undo/redo exactly as SYMBOL_EDIT_FRAME::SaveCopyInUndoList does
 * ("the full data is duplicated"). Items keep their `source` nodes so the
 * lossless writer can pass untouched items through byte-for-byte.
 */

import type { Vec2 } from '@ziroeda/kimath';
import {
  EMPTY_SOURCE,
  type LibGraphic,
  type LibPin,
  type LibSymbol,
  type LibSymbolUnit,
  type SchField,
} from '@ziroeda/eeschema';
import {
  nearestGridPosition,
  nearestHalfGridPosition,
} from '@ziroeda/common/src/eda_draw_frame.js';
import { textWidth } from '@ziroeda/common/src/font/font_provider.js';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';
import {
  libUnitShown,
  pinBodyEnd,
  pinNameInfo,
  pinNumberInfo,
  symItemId,
  type SymItemKind,
} from './render/symbolRenderer.js';
import { symbolGridIU } from './grid.js';
import { incrementString } from '@ziroeda/eeschema/src/tools/repeat_item.js';
import { schIUScale } from '@ziroeda/common/src/eda_units.js';
import {
  type EditHandle,
  dragGraphic,
  draggedRectEdge,
  graphicHandles,
  graphicIndicatorLines,
  pinRoot,
  pinRootOnSeg,
} from '@ziroeda/eeschema/src/tools/point_editor.js';
import type { ArcEditMode } from '@ziroeda/eeschema/src/tools/arc_edit.js';

export interface SymItemRef {
  kind: SymItemKind;
  unitIdx: number;
  itemIdx: number;
}

export function parseItemId(id: string): SymItemRef | null {
  const m = /^(pin|gfx|field):(\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return { kind: m[1] as SymItemKind, unitIdx: Number(m[2]), itemIdx: Number(m[3]) };
}

/**
 * `EDA_DRAW_FRAME::GetNearestGridPosition`, on the grid the frame is actually
 * working on — `symbolGridIU()`, which is `symbol_editor.json`'s
 * `window.grid.sizes[last_size]`. It was the module constant `GRID`, so the
 * Grids page could store a grid nothing snapped to.
 */
const snap = (p: Vec2): Vec2 => nearestGridPosition(p, symbolGridIU());
/** GetNearestHalfGridPosition: multi-item rotate/mirror centres snap to grid/2. */
const snapHalf = (p: Vec2): Vec2 => nearestHalfGridPosition(p, symbolGridIU());

// ----- structural helpers ------------------------------------------------------

function withUnits(sym: LibSymbol, units: readonly LibSymbolUnit[]): LibSymbol {
  return { ...sym, units };
}

function mapUnit(
  sym: LibSymbol,
  unitIdx: number,
  fn: (u: LibSymbolUnit) => LibSymbolUnit,
): LibSymbol {
  return withUnits(
    sym,
    sym.units.map((u, i) => (i === unitIdx ? fn(u) : u)),
  );
}

/** The base symbol name of a unit-node name (`R_0_1` -> `R`). */
const unitName = (symName: string, unit: number, bodyStyle: number): string =>
  `${symName}_${unit}_${bodyStyle}`;

/**
 * Find (or create) the unit entry items with (unit, bodyStyle) land in, KiCad
 * groups draw items into `Name_U_B` child symbols on save.
 */
export function ensureUnitEntry(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
): { sym: LibSymbol; unitIdx: number } {
  const idx = sym.units.findIndex((u) => u.unit === unit && u.bodyStyle === bodyStyle);
  if (idx !== -1) return { sym, unitIdx: idx };
  const entry: LibSymbolUnit = {
    name: unitName(sym.libId, unit, bodyStyle),
    unit,
    bodyStyle,
    graphics: [],
    pins: [],
    source: EMPTY_SOURCE,
  };
  // Keep KiCad's save order: sorted by unit then body style.
  const units = [...sym.units, entry].sort((a, b) => a.unit - b.unit || a.bodyStyle - b.bodyStyle);
  return { sym: withUnits(sym, units), unitIdx: units.indexOf(entry) };
}

/** Number of units (derived like LIB_SYMBOL::GetUnitCount from the unit entries). */
export function unitCount(sym: LibSymbol): number {
  return Math.max(1, ...sym.units.map((u) => u.unit));
}

export function hasAlternateBodyStyle(sym: LibSymbol): boolean {
  return sym.units.some((u) => u.bodyStyle > 1);
}

/**
 * `LIB_SYMBOL::UnitsLocked()` — the units are NOT interchangeable.
 *
 * Serialised as the `ki_locked` user field
 * (`sch_io_kicad_sexpr_lib_cache.cpp:466-474`), which is where we read it.
 * It lives here, beside `unitCount`, because two callers need the same answer:
 * `multiUnitModeCond` in `conditions.ts` (:609-613) and `m_SyncPinEdit` in
 * `toggles.ts` (:968). A second copy is how the two drift apart.
 */
export function unitsLocked(sym: LibSymbol): boolean {
  return sym.properties.some((f) => f.key === 'ki_locked');
}

/** All pins visible for a unit/body-style view. */
export function pinsShown(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
): { pin: LibPin; id: string }[] {
  const out: { pin: LibPin; id: string }[] = [];
  sym.units.forEach((u, ui) => {
    if (!libUnitShown(u, unit, bodyStyle)) return;
    u.pins.forEach((p, pi) => out.push({ pin: p, id: symItemId('pin', ui, pi) }));
  });
  return out;
}

/** Every pin of the symbol (across all units/body styles), like LIB_SYMBOL::GetPins(). */
export function allPins(sym: LibSymbol): { pin: LibPin; unitIdx: number; pinIdx: number }[] {
  const out: { pin: LibPin; unitIdx: number; pinIdx: number }[] = [];
  sym.units.forEach((u, ui) =>
    u.pins.forEach((p, pi) => out.push({ pin: p, unitIdx: ui, pinIdx: pi })),
  );
  return out;
}

// ----- item transforms -----------------------------------------------------------

const rotCCW = (p: Vec2, c: Vec2): Vec2 => ({ x: c.x + (p.y - c.y), y: c.y - (p.x - c.x) });
const rotCW = (p: Vec2, c: Vec2): Vec2 => ({ x: c.x - (p.y - c.y), y: c.y + (p.x - c.x) });
const mirX = (p: Vec2, cx: number): Vec2 => ({ x: 2 * cx - p.x, y: p.y });
const mirY = (p: Vec2, cy: number): Vec2 => ({ x: p.x, y: 2 * cy - p.y });

/** Pin orientation cycle for a CCW rotation: right(0) -> up(90) -> left(180) -> down(270). */
const rotPinAngle = (angle: number, ccw: boolean): number =>
  (((angle + (ccw ? 90 : -90)) % 360) + 360) % 360;

const translate = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

function movePin(pin: LibPin, d: Vec2): LibPin {
  return { ...pin, at: translate(pin.at, d) };
}

function moveGraphic(g: LibGraphic, d: Vec2): LibGraphic {
  switch (g.kind) {
    case 'ellipse':
    case 'ellipse_arc':
      return { ...g, center: translate(g.center, d) };
    case 'rectangle':
      return { ...g, start: translate(g.start, d), end: translate(g.end, d) };
    case 'circle':
      return { ...g, center: translate(g.center, d) };
    case 'arc':
      return {
        ...g,
        start: translate(g.start, d),
        mid: translate(g.mid, d),
        end: translate(g.end, d),
      };
    case 'bezier':
    case 'polyline':
      return { ...g, points: g.points.map((p) => translate(p, d)) };
    case 'text':
      return { ...g, at: translate(g.at, d) };
  }
}

function moveField(f: SchField, d: Vec2): SchField {
  return { ...f, at: translate(f.at ?? { x: 0, y: 0 }, d) };
}

function rotatePin(pin: LibPin, c: Vec2, ccw: boolean): LibPin {
  return {
    ...pin,
    at: ccw ? rotCCW(pin.at, c) : rotCW(pin.at, c),
    angle: rotPinAngle(pin.angle, ccw),
  };
}

function rotateGraphic(g: LibGraphic, c: Vec2, ccw: boolean): LibGraphic {
  const r = (p: Vec2): Vec2 => (ccw ? rotCCW(p, c) : rotCW(p, c));
  switch (g.kind) {
    case 'ellipse':
    case 'ellipse_arc':
      // The centre turns with everything else; the shape's own tilt turns with
      // it, so the radii are untouched.
      return { ...g, center: r(g.center), rotation: g.rotation + (ccw ? 90 : -90) };
    case 'rectangle':
      return { ...g, start: r(g.start), end: r(g.end) };
    case 'circle':
      return { ...g, center: r(g.center) };
    case 'arc':
      return { ...g, start: r(g.start), mid: r(g.mid), end: r(g.end) };
    case 'bezier':
    case 'polyline':
      return { ...g, points: g.points.map(r) };
    case 'text':
      return { ...g, at: r(g.at), angle: g.angle % 180 === 90 ? 0 : 90 };
  }
}

function rotateField(f: SchField, c: Vec2, ccw: boolean): SchField {
  const at = f.at ?? { x: 0, y: 0 };
  return { ...f, at: ccw ? rotCCW(at, c) : rotCW(at, c), angle: f.angle % 180 === 90 ? 0 : 90 };
}

/** Flip left/right tokens in a justify list (GetFlippedAlignment). */
function flipJustifyH(justify: readonly string[] | undefined): string[] {
  const j = [...(justify ?? [])];
  const hasLeft = j.includes('left'),
    hasRight = j.includes('right');
  const out = j.filter((t) => t !== 'left' && t !== 'right');
  if (hasLeft) out.push('right');
  else if (hasRight) out.push('left');
  return out;
}

function flipJustifyV(justify: readonly string[] | undefined): string[] {
  const j = [...(justify ?? [])];
  const hasTop = j.includes('top'),
    hasBottom = j.includes('bottom');
  const out = j.filter((t) => t !== 'top' && t !== 'bottom');
  if (hasTop) out.push('bottom');
  else if (hasBottom) out.push('top');
  return out;
}

/** Pin orientation under a horizontal mirror (right<->left) or vertical (up<->down). */
const mirrorPinAngleH = (a: number): number => (a === 0 ? 180 : a === 180 ? 0 : a);
const mirrorPinAngleV = (a: number): number => (a === 90 ? 270 : a === 270 ? 90 : a);

function mirrorPin(pin: LibPin, c: Vec2, horizontal: boolean): LibPin {
  return horizontal
    ? { ...pin, at: mirX(pin.at, c.x), angle: mirrorPinAngleH(pin.angle) }
    : { ...pin, at: mirY(pin.at, c.y), angle: mirrorPinAngleV(pin.angle) };
}

function mirrorGraphic(g: LibGraphic, c: Vec2, horizontal: boolean): LibGraphic {
  const m = (p: Vec2): Vec2 => (horizontal ? mirX(p, c.x) : mirY(p, c.y));
  switch (g.kind) {
    case 'ellipse':
    case 'ellipse_arc':
      // Reflecting negates the tilt about the mirror axis; the radii are
      // unsigned lengths and do not change.
      return { ...g, center: m(g.center), rotation: -g.rotation + (horizontal ? 180 : 0) };
    case 'rectangle':
      return { ...g, start: m(g.start), end: m(g.end) };
    case 'circle':
      return { ...g, center: m(g.center) };
    case 'arc':
      return { ...g, start: m(g.start), mid: m(g.mid), end: m(g.end) };
    case 'bezier':
    case 'polyline':
      return { ...g, points: g.points.map(m) };
    case 'text': {
      const fx = g.effects;
      const effects = fx
        ? { ...fx, justify: horizontal ? flipJustifyH(fx.justify) : flipJustifyV(fx.justify) }
        : fx;
      return { ...g, at: m(g.at), ...(effects ? { effects } : {}) };
    }
  }
}

function mirrorField(f: SchField, c: Vec2, horizontal: boolean): SchField {
  const at = f.at ?? { x: 0, y: 0 };
  const fx = f.effects;
  const effects = fx
    ? { ...fx, justify: horizontal ? flipJustifyH(fx.justify) : flipJustifyV(fx.justify) }
    : fx;
  return { ...f, at: horizontal ? mirX(at, c.x) : mirY(at, c.y), ...(effects ? { effects } : {}) };
}

// ----- selection-level operations -------------------------------------------------

function itemPosition(sym: LibSymbol, ref: SymItemRef): Vec2 {
  if (ref.kind === 'pin') return sym.units[ref.unitIdx]?.pins[ref.itemIdx]?.at ?? { x: 0, y: 0 };
  if (ref.kind === 'field') return sym.properties[ref.itemIdx]?.at ?? { x: 0, y: 0 };
  const g = sym.units[ref.unitIdx]?.graphics[ref.itemIdx];
  if (!g) return { x: 0, y: 0 };
  switch (g.kind) {
    case 'rectangle':
      return g.start;
    case 'circle':
    case 'ellipse':
    case 'ellipse_arc':
      return g.center;
    case 'arc':
      return g.start;
    case 'bezier':
    case 'polyline':
      return g.points[0] ?? { x: 0, y: 0 };
    case 'text':
      return g.at;
  }
}

function selectionRefs(ids: ReadonlySet<string>): SymItemRef[] {
  const refs: SymItemRef[] = [];
  for (const id of ids) {
    const r = parseItemId(id);
    if (r) refs.push(r);
  }
  return refs;
}

function applyToItems(
  sym: LibSymbol,
  ids: ReadonlySet<string>,
  fnPin: (p: LibPin) => LibPin,
  fnGfx: (g: LibGraphic) => LibGraphic,
  fnField: (f: SchField) => SchField,
): LibSymbol {
  const units = sym.units.map((u, ui) => {
    let changed = false;
    const pins = u.pins.map((p, pi) => {
      if (!ids.has(symItemId('pin', ui, pi))) return p;
      changed = true;
      return fnPin(p);
    });
    const graphics = u.graphics.map((g, gi) => {
      if (!ids.has(symItemId('gfx', ui, gi))) return g;
      changed = true;
      return fnGfx(g);
    });
    return changed ? { ...u, pins, graphics } : u;
  });
  const properties = sym.properties.map((f, fi) =>
    ids.has(symItemId('field', 0, fi)) ? fnField(f) : f,
  );
  return { ...sym, units, properties };
}

export function moveSymbolItems(sym: LibSymbol, ids: ReadonlySet<string>, delta: Vec2): LibSymbol {
  return applyToItems(
    sym,
    ids,
    (p) => movePin(p, delta),
    (g) => moveGraphic(g, delta),
    (f) => moveField(f, delta),
  );
}

/**
 * Rotate the selection (SYMBOL_EDITOR_EDIT_TOOL::Rotate): a single item rotates
 * about its own position; several rotate about the selection centre snapped to
 * the half grid.
 */
export function rotateSymbolItems(
  sym: LibSymbol,
  ids: ReadonlySet<string>,
  ccw: boolean,
): LibSymbol {
  const refs = selectionRefs(ids);
  if (refs.length === 0) return sym;
  let c: Vec2;
  if (refs.length === 1) c = itemPosition(sym, refs[0]!);
  else {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const r of refs) {
      const p = itemPosition(sym, r);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    c = snapHalf({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }
  return applyToItems(
    sym,
    ids,
    (p) => rotatePin(p, c, ccw),
    (g) => rotateGraphic(g, c, ccw),
    (f) => rotateField(f, c, ccw),
  );
}

/**
 * Mirror the selection (SYMBOL_EDITOR_EDIT_TOOL::Mirror). A single *field*
 * only flips its justification (KiCad's special case); other single items
 * mirror about their own position; several mirror about the selection centre.
 */
export function mirrorSymbolItems(
  sym: LibSymbol,
  ids: ReadonlySet<string>,
  horizontal: boolean,
): LibSymbol {
  const refs = selectionRefs(ids);
  if (refs.length === 0) return sym;
  if (refs.length === 1 && refs[0]!.kind === 'field') {
    const fi = refs[0]!.itemIdx;
    const properties = sym.properties.map((f, i) => {
      if (i !== fi) return f;
      const fx = f.effects;
      const effects = fx
        ? { ...fx, justify: horizontal ? flipJustifyH(fx.justify) : flipJustifyV(fx.justify) }
        : { hidden: false, justify: horizontal ? ['right'] : [] };
      return { ...f, effects };
    });
    return { ...sym, properties };
  }
  let c: Vec2;
  if (refs.length === 1) c = itemPosition(sym, refs[0]!);
  else {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const r of refs) {
      const p = itemPosition(sym, r);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    c = snapHalf({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }
  return applyToItems(
    sym,
    ids,
    (p) => mirrorPin(p, c, horizontal),
    (g) => mirrorGraphic(g, c, horizontal),
    (f) => mirrorField(f, c, horizontal),
  );
}

/** What `deleteSymbolItems` did, so the caller can name the undo step. */
export interface SymbolDeleteResult {
  symbol: LibSymbol;
  /** `fieldsHidden` — visible fields that were hidden by this delete. */
  fieldsHidden: number;
  /** `fieldsAlreadyHidden` — selected fields that were hidden already. */
  fieldsAlreadyHidden: number;
  /** `toDelete.size()` — pins and graphics actually removed. */
  itemsDeleted: number;
}

/**
 * `SYMBOL_EDITOR_EDIT_TOOL::DoDelete`
 * (`eeschema/tools/symbol_editor_edit_tool.cpp:796-860`).
 *
 * **A field is never deleted here.** Upstream's branch for `SCH_FIELD_T` is:
 *
 * ```cpp
 * // Hide "deleted" fields
 * if( field->IsVisible() )
 * {
 *     field->SetVisible( false );
 *     fieldsHidden++;
 * }
 * else
 * {
 *     fieldsAlreadyHidden++;
 * }
 * ```
 *
 * — every field, mandatory or not. Only pins and graphics reach
 * `symbol->RemoveDrawItem( item )`. Removing a field is the Symbol Properties
 * dialog's job, which is what the infobar says when you press Delete on a
 * field that is already hidden.
 *
 * Ours deleted non-mandatory fields outright, against a MANDATORY set written
 * here rather than read from the model — so a user field was destroyed by a
 * keystroke KiCad uses to hide it, and no undo description ever said "Hide".
 */
export function deleteSymbolItems(sym: LibSymbol, ids: ReadonlySet<string>): SymbolDeleteResult {
  let itemsDeleted = 0;
  const units = sym.units.map((u, ui) => {
    const pins = u.pins.filter((_, pi) => !ids.has(symItemId('pin', ui, pi)));
    const graphics = u.graphics.filter((_, gi) => !ids.has(symItemId('gfx', ui, gi)));
    itemsDeleted += u.pins.length - pins.length + (u.graphics.length - graphics.length);
    return { ...u, pins, graphics };
  });

  let fieldsHidden = 0;
  let fieldsAlreadyHidden = 0;
  const properties = sym.properties.map((f, fi) => {
    if (!ids.has(symItemId('field', 0, fi))) return f;
    if (f.effects?.hidden) {
      fieldsAlreadyHidden++;
      return f;
    }
    fieldsHidden++;
    return { ...f, effects: { ...(f.effects ?? {}), hidden: true } };
  });

  return { symbol: { ...sym, units, properties }, fieldsHidden, fieldsAlreadyHidden, itemsDeleted };
}

/**
 * The undo description `DoDelete` pushes, or the infobar error it shows instead
 * (`symbol_editor_edit_tool.cpp:847-860`):
 *
 * ```cpp
 * if( toDelete.size() == 0 )
 * {
 *     if( fieldsHidden == 1 )        commit.Push( _( "Hide Field" ) );
 *     else if( fieldsHidden > 1 )    commit.Push( _( "Hide Fields" ) );
 *     else if( fieldsAlreadyHidden > 0 )
 *         m_frame->ShowInfoBarError( _( "Use the Symbol Properties dialog to remove fields." ) );
 * }
 * else
 * {
 *     commit.Push( _( "Delete" ) );
 * }
 * ```
 *
 * `kind: 'none'` is the case where nothing at all happened — no commit, no
 * message.
 */
export function symbolDeleteOutcome(
  r: SymbolDeleteResult,
):
  | { kind: 'commit'; description: string }
  | { kind: 'infobar'; message: string }
  | { kind: 'none' } {
  if (r.itemsDeleted > 0) return { kind: 'commit', description: 'Delete' };
  if (r.fieldsHidden === 1) return { kind: 'commit', description: 'Hide Field' };
  if (r.fieldsHidden > 1) return { kind: 'commit', description: 'Hide Fields' };
  if (r.fieldsAlreadyHidden > 0)
    return { kind: 'infobar', message: 'Use the Symbol Properties dialog to remove fields.' };
  return { kind: 'none' };
}

/** Replace one item by id. */
export function replaceSymbolItem(
  sym: LibSymbol,
  id: string,
  item: LibPin | LibGraphic | SchField,
): LibSymbol {
  const ref = parseItemId(id);
  if (!ref) return sym;
  if (ref.kind === 'field') {
    return {
      ...sym,
      properties: sym.properties.map((f, i) => (i === ref.itemIdx ? (item as SchField) : f)),
    };
  }
  return mapUnit(sym, ref.unitIdx, (u) =>
    ref.kind === 'pin'
      ? { ...u, pins: u.pins.map((p, i) => (i === ref.itemIdx ? (item as LibPin) : p)) }
      : {
          ...u,
          graphics: u.graphics.map((g, i) => (i === ref.itemIdx ? (item as LibGraphic) : g)),
        },
  );
}

/** Add a pin (SYMBOL_EDITOR_PIN_TOOL::PlacePin): returns the new item's id. */
export function addPinToSymbol(
  sym: LibSymbol,
  pin: LibPin,
  unit: number,
  bodyStyle: number,
): { sym: LibSymbol; id: string } {
  const r = ensureUnitEntry(sym, unit, bodyStyle);
  const u = r.sym.units[r.unitIdx]!;
  const next = mapUnit(r.sym, r.unitIdx, (uu) => ({ ...uu, pins: [...uu.pins, pin] }));
  return { sym: next, id: symItemId('pin', r.unitIdx, u.pins.length) };
}

/**
 * CreateImagePins: with synchronized pin edit on a multi-unit symbol, placing a
 * pin in one unit creates matching pins in every other unit (same position,
 * temporary "-U<letter>" numbers).
 */
export function createImagePins(
  sym: LibSymbol,
  pin: LibPin,
  unit: number,
  bodyStyle: number,
): LibSymbol {
  if (unit === 0) return sym;
  let out = sym;
  const count = unitCount(sym);
  for (let ii = 1; ii <= count; ii++) {
    if (ii === unit) continue;
    const copy: LibPin = {
      ...pin,
      number: `${pin.number}-U${String.fromCharCode(64 + ii)}`,
      source: EMPTY_SOURCE,
    };
    out = addPinToSymbol(out, copy, ii, bodyStyle).sym;
  }
  return out;
}

/**
 * The point editor, in the symbol editor.
 *
 * `SCH_POINT_EDITOR` is ONE tool registered by both `SCH_EDIT_FRAME`
 * (`sch_edit_frame.cpp:705`) and `SYMBOL_EDIT_FRAME`
 * (`symbol_edit_frame.cpp:431`), over one `pointEditorTypes` list
 * (`sch_point_editor.cpp:50-56`). A rectangle therefore carries the same eight
 * handles in either editor, and the geometry is the shared behaviours in
 * `eeschema/src/tools/point_editor.ts` — this file resolves the selection and
 * writes the result back, and computes nothing of its own.
 *
 * The symbol editor sees only `SCH_SHAPE_T` of that list: a `LIB_SYMBOL` holds
 * shapes and pins, and there are no sheets, tables or bitmaps inside one.
 */
export function symbolEditHandles(sym: LibSymbol, id: string): EditHandle[] {
  const g = findGraphicById(sym, id);
  return g ? graphicHandles(g.graphic) : [];
}

/** The leader lines a bezier's control points and an arc's centre get. */
export function symbolIndicatorLines(sym: LibSymbol, id: string): [Vec2, Vec2][] {
  return graphicIndicatorLines(findGraphicById(sym, id)?.graphic);
}

/**
 * Drag one handle of one shape, and carry the pins on a dragged EDGE with it.
 *
 * The pin half is `SCH_POINT_EDITOR::dragPinsOnEdge` (`:641-704`), which is
 * gated on the frame being the symbol editor AND on
 * `m_dragPinsAlongWithEdges` — Preferences > Symbol Editor > Editing Options'
 * "Keep pins attached when dragging edges". With it off the shape resizes and
 * the pins stay exactly where they were.
 *
 * Only pins in the SAME unit as the shape move (`aEdgeUnit == 0 ||
 * aEdgeUnit == editor.GetUnit()`, `:658`), and `GetGraphicalPins( aUnit, 0 )`
 * is what upstream collects them from.
 */
export function dragSymbolHandle(
  sym: LibSymbol,
  id: string,
  handle: EditHandle,
  pos: Vec2,
  opts: { arcMode: ArcEditMode; dragPins: boolean },
): LibSymbol {
  const found = findGraphicById(sym, id);
  if (!found) return sym;

  const before = found.graphic;
  const after = dragGraphic(before, handle, pos, opts.arcMode);
  if (after === before) return sym;

  let next = mapUnit(sym, found.unitIdx, (u) => ({
    ...u,
    graphics: u.graphics.map((x, i) => (i === found.itemIdx ? after : x)),
  }));

  // `dragPinsOnEdge` — a rectangle EDGE drag only, and only with the setting on.
  if (!opts.dragPins) return next;
  if (before.kind !== 'rectangle' || after.kind !== 'rectangle') return next;
  const edge = draggedRectEdge(before, after, handle);
  // `if( aMoveVecs[i] == VECTOR2I( 0, 0 ) … ) continue;`
  if (!edge || (edge.move.x === 0 && edge.move.y === 0)) return next;

  next = mapUnit(next, found.unitIdx, (u) => ({
    ...u,
    pins: u.pins.map((pin) =>
      pinRootOnSeg(pinRoot(pin), edge.seg)
        ? { ...pin, at: { x: pin.at.x + edge.move.x, y: pin.at.y + edge.move.y } }
        : pin,
    ),
  }));
  return next;
}

/** The graphic behind a selection id, with the unit it lives in. */
function findGraphicById(
  sym: LibSymbol,
  id: string,
): { graphic: LibGraphic; unitIdx: number; itemIdx: number } | null {
  for (const [ui, u] of sym.units.entries()) {
    for (const [gi, g] of u.graphics.entries()) {
      if (symItemId('gfx', ui, gi) === id) return { graphic: g, unitIdx: ui, itemIdx: gi };
    }
  }
  return null;
}

/**
 * `SYMBOL_EDITOR_PIN_TOOL::RepeatPin` (`symbol_editor_pin_tool.cpp:411-457`) —
 * Insert, the action that fills a pin row out.
 *
 * It duplicates the LAST PLACED pin, steps it by `m_Repeat.pin_step`, and
 * increments both its name and its number by `m_Repeat.label_delta`. Those two
 * numbers are Preferences > Symbol Editor > Editing Options' "Pitch of repeated
 * pins" and "Label increment", which had no reader until this existed.
 *
 * The step axis is the one PERPENDICULAR to the pin
 * (`symbol_editor_pin_tool.cpp:427-435`):
 *
 *     PIN_RIGHT: step.y = MilsToIU( pin_step )
 *     PIN_UP:    step.x = MilsToIU( pin_step )
 *     PIN_DOWN:  step.x = MilsToIU( pin_step )
 *     PIN_LEFT:  step.y = MilsToIU( pin_step )
 *
 * — a horizontal pin stacks down the side of the body, a vertical one stacks
 * across it. Every arm is POSITIVE, so a repeated pin always walks +y or +x
 * regardless of which way the pin itself faces; that asymmetry is upstream's.
 *
 * `IncrementString` steps the last run of digits and is a no-op on a name with
 * none, so an unnumbered pin repeats with its name unchanged rather than
 * failing. It also refuses to go below zero, which `incrementString` reports as
 * null and this treats the same way upstream's `false` return does: the string
 * is left as it was.
 *
 * Synchronized pins are honoured through `createImagePins`, exactly as
 * `PlacePin` does (`:454-456`), so a repeat in one unit of a multi-unit symbol
 * lands in the others too.
 */
export function repeatPin(
  sym: LibSymbol,
  sourceId: string,
  opts: {
    /** `m_Repeat.pin_step`, in MILS as the settings file stores it. */
    pinStepMils: number;
    /** `m_Repeat.label_delta`. */
    labelDelta: number;
    /** `SYMBOL_EDIT_FRAME::SynchronizePins()`. */
    synchronize: boolean;
    unit: number;
    bodyStyle: number;
  },
): { sym: LibSymbol; id: string; pin: LibPin } | null {
  const found = findPinById(sym, sourceId);
  if (!found) return null;

  // `schIUScale.MilsToIU` — the symbol editor is an SCH frame.
  const stepIU = schIUScale.milsToIU(opts.pinStepMils);
  // `switch( pin->GetOrientation() )` — the `default:` arm shares PIN_RIGHT's
  // case label upstream, so an angle outside the four steps in y like a
  // right-facing pin does.
  const vertical = found.pin.angle === 90 || found.pin.angle === 270;
  const at = vertical
    ? { x: found.pin.at.x + stepIU, y: found.pin.at.y }
    : { x: found.pin.at.x, y: found.pin.at.y + stepIU };

  const pin: LibPin = {
    ...found.pin,
    at,
    name: incrementString(found.pin.name, opts.labelDelta) ?? found.pin.name,
    number: incrementString(found.pin.number, opts.labelDelta) ?? found.pin.number,
    // A duplicate is a new item: it must not carry the source's file bytes, or
    // the writer would emit the original's text for both.
    source: EMPTY_SOURCE,
  };

  const added = addPinToSymbol(sym, pin, opts.unit, opts.bodyStyle);
  const out = opts.synchronize
    ? createImagePins(added.sym, pin, opts.unit, opts.bodyStyle)
    : added.sym;
  return { sym: out, id: added.id, pin };
}

/** The pin behind a selection id, with the unit it lives in. */
function findPinById(sym: LibSymbol, id: string): { pin: LibPin; unitIdx: number } | null {
  for (const [ui, u] of sym.units.entries()) {
    for (const [pi, p] of u.pins.entries()) {
      if (symItemId('pin', ui, pi) === id) return { pin: p, unitIdx: ui };
    }
  }
  return null;
}

/** Add a graphic body item; returns the new item's id. */
export function addGraphicToSymbol(
  sym: LibSymbol,
  g: LibGraphic,
  unit: number,
  bodyStyle: number,
): { sym: LibSymbol; id: string } {
  const r = ensureUnitEntry(sym, unit, bodyStyle);
  const u = r.sym.units[r.unitIdx]!;
  const next = mapUnit(r.sym, r.unitIdx, (uu) => ({ ...uu, graphics: [...uu.graphics, g] }));
  return { sym: next, id: symItemId('gfx', r.unitIdx, u.graphics.length) };
}

/** Place Anchor (SYMBOL_EDITOR_DRAWING_TOOLS::PlaceAnchor): symbol->Move(-pos). */
export function moveSymbolOrigin(sym: LibSymbol, pos: Vec2): LibSymbol {
  const d = { x: -pos.x, y: -pos.y };
  const units = sym.units.map((u) => ({
    ...u,
    pins: u.pins.map((p) => movePin(p, d)),
    graphics: u.graphics.map((g) => moveGraphic(g, d)),
  }));
  const properties = sym.properties.map((f) => (f.at ? moveField(f, d) : f));
  return { ...sym, units, properties };
}

/** Rename the symbol: updates libId, the Value field (KiCad keeps them in sync) and unit names. */
export function renameSymbol(sym: LibSymbol, newName: string): LibSymbol {
  const units = sym.units.map((u) => ({ ...u, name: unitName(newName, u.unit, u.bodyStyle) }));
  const properties = sym.properties.map((f) =>
    f.key === 'Value' && f.value === sym.libId ? { ...f, value: newName } : f,
  );
  return { ...sym, libId: newName, units, properties };
}

/** SetUnitCount: grow with empty unit entries, or drop the entries above the count. */
export function setUnitCount(sym: LibSymbol, count: number): LibSymbol {
  const cur = unitCount(sym);
  if (count === cur) return sym;
  if (count < cur) {
    return withUnits(
      sym,
      sym.units.filter((u) => u.unit <= count),
    );
  }
  let out = sym;
  for (let ii = cur + 1; ii <= count; ii++) out = ensureUnitEntry(out, ii, 1).sym;
  return out;
}

// ----- hit testing -----------------------------------------------------------------

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx,
    py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

interface TextBoxSpec {
  text: string;
  size: number;
  at: Vec2;
  vertical: boolean;
  halign: 'left' | 'center' | 'right';
  valign: 'top' | 'center' | 'bottom';
  /** `(font (face …))` and its style, so the hit box matches the drawn glyphs. */
  face?: string;
  bold?: boolean;
  italic?: boolean;
}

function inTextBox(p: Vec2, t: TextBoxSpec): boolean {
  if (t.text === '' || t.text === '~') return false;
  // Hit-testing measures through the shared entry point (#154), so what you can
  // click matches what is drawn once an outline face is drawable. With no
  // provider installed this is the stroke font, exactly as before.
  const w = textWidth(t.text, t.size, { face: t.face, bold: t.bold, italic: t.italic });
  const h = t.size;
  // Local frame: x along the reading direction, y down.
  let lx: number, ly: number;
  if (t.vertical) {
    lx = t.at.y - p.y;
    ly = p.x - t.at.x;
  } else {
    lx = p.x - t.at.x;
    ly = p.y - t.at.y;
  }
  const x0 = t.halign === 'left' ? 0 : t.halign === 'right' ? -w : -w / 2;
  const y0 = t.valign === 'top' ? 0 : t.valign === 'bottom' ? -h : -h / 2;
  return lx >= x0 && lx <= x0 + w && ly >= y0 && ly <= y0 + h;
}

export interface SymbolHit {
  id: string;
  kind: SymItemKind;
}

/**
 * Hit-test the shown items at a world point (tolerance in IU), pins by their
 * line + text boxes, graphics by stroke (interior when filled), fields by their
 * text box. Later-drawn items win (pins over body, fields on top).
 */
export function hitTestSymbol(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
  world: Vec2,
  tol: number,
  showHiddenPins: boolean,
  showHiddenFields: boolean,
): SymbolHit | null {
  // Fields first (drawn on top).
  for (let fi = sym.properties.length - 1; fi >= 0; fi--) {
    const f = sym.properties[fi]!;
    if (!f.at || f.value === '') continue;
    if (f.effects?.hidden && !showHiddenFields) continue;
    const size = f.effects?.fontSize?.[0] ?? 1.27 * 10000;
    const justify = f.effects?.justify;
    const box: TextBoxSpec = {
      text: f.nameShown ? `${f.key}: ${f.value}` : f.value,
      size,
      at: f.at,
      vertical: f.angle % 180 === 90,
      halign: justify?.includes('left') ? 'left' : justify?.includes('right') ? 'right' : 'center',
      valign: justify?.includes('top') ? 'top' : justify?.includes('bottom') ? 'bottom' : 'center',
      face: f.effects?.face,
      bold: f.effects?.bold,
      italic: f.effects?.italic,
    };
    if (inTextBox(world, box)) return { id: symItemId('field', 0, fi), kind: 'field' };
  }

  // Pins: the line segment plus the name/number text boxes.
  for (let ui = sym.units.length - 1; ui >= 0; ui--) {
    const u = sym.units[ui]!;
    if (!libUnitShown(u, unit, bodyStyle)) continue;
    for (let pi = u.pins.length - 1; pi >= 0; pi--) {
      const p = u.pins[pi]!;
      if (p.hidden && !showHiddenPins) continue;
      if (distToSegment(world, p.at, pinBodyEnd(p)) <= tol)
        return { id: symItemId('pin', ui, pi), kind: 'pin' };
      const ni = pinNameInfo(p, sym);
      if (
        ni &&
        inTextBox(world, {
          text: ni.text,
          size: ni.size,
          at: ni.at,
          vertical: ni.vertical,
          halign: ni.halign,
          valign: ni.valign,
        })
      )
        return { id: symItemId('pin', ui, pi), kind: 'pin' };
      const nu = pinNumberInfo(p, sym);
      if (
        nu &&
        inTextBox(world, {
          text: nu.text,
          size: nu.size,
          at: nu.at,
          vertical: nu.vertical,
          halign: nu.halign,
          valign: nu.valign,
        })
      )
        return { id: symItemId('pin', ui, pi), kind: 'pin' };
    }
  }

  // Graphics: stroke proximity; interior counts when filled.
  for (let ui = sym.units.length - 1; ui >= 0; ui--) {
    const u = sym.units[ui]!;
    if (!libUnitShown(u, unit, bodyStyle)) continue;
    for (let gi = u.graphics.length - 1; gi >= 0; gi--) {
      const g = u.graphics[gi]!;
      if (hitGraphic(g, world, tol)) return { id: symItemId('gfx', ui, gi), kind: 'gfx' };
    }
  }
  return null;
}

function hitGraphic(g: LibGraphic, p: Vec2, tol: number): boolean {
  switch (g.kind) {
    case 'ellipse':
    case 'ellipse_arc': {
      // Rotate into the ellipse's frame and normalise each axis, so the shape
      // becomes a unit circle and the test is a distance from 1.
      const rad = (-g.rotation * Math.PI) / 180;
      const dx = p.x - g.center.x;
      const dy = p.y - g.center.y;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      const a = Math.max(1, g.majorRadius);
      const b = Math.max(1, g.minorRadius);
      const r = Math.hypot(lx / a, ly / b);
      if (g.kind === 'ellipse' && g.fill && g.fill.type !== 'none' && r <= 1) return true;
      return Math.abs(r - 1) * Math.min(a, b) <= tol;
    }
    case 'rectangle': {
      const x0 = Math.min(g.start.x, g.end.x),
        x1 = Math.max(g.start.x, g.end.x);
      const y0 = Math.min(g.start.y, g.end.y),
        y1 = Math.max(g.start.y, g.end.y);
      const inside = p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      if (g.fill && g.fill.type !== 'none' && inside) return true;
      const dTop = distToSegment(p, { x: x0, y: y0 }, { x: x1, y: y0 });
      const dBot = distToSegment(p, { x: x0, y: y1 }, { x: x1, y: y1 });
      const dL = distToSegment(p, { x: x0, y: y0 }, { x: x0, y: y1 });
      const dR = distToSegment(p, { x: x1, y: y0 }, { x: x1, y: y1 });
      return Math.min(dTop, dBot, dL, dR) <= tol;
    }
    case 'circle': {
      const d = Math.hypot(p.x - g.center.x, p.y - g.center.y);
      if (g.fill && g.fill.type !== 'none' && d <= g.radius) return true;
      return Math.abs(d - g.radius) <= tol;
    }
    case 'arc': {
      // Sample the arc as a polyline for hit purposes.
      const pts = sampleArc(g.start, g.mid, g.end);
      for (let i = 1; i < pts.length; i++)
        if (distToSegment(p, pts[i - 1]!, pts[i]!) <= tol) return true;
      return false;
    }
    case 'bezier':
    case 'polyline': {
      for (let i = 1; i < g.points.length; i++)
        if (distToSegment(p, g.points[i - 1]!, g.points[i]!) <= tol) return true;
      if (g.fill && g.fill.type !== 'none' && pointInPolygon(p, g.points)) return true;
      return false;
    }
    case 'text': {
      const size = g.effects?.fontSize?.[0] ?? 1.27 * 10000;
      const justify = g.effects?.justify;
      return inTextBox(p, {
        text: g.text,
        size,
        at: g.at,
        vertical: g.angle % 180 === 90,
        halign: justify?.includes('left')
          ? 'left'
          : justify?.includes('right')
            ? 'right'
            : 'center',
        valign: justify?.includes('top')
          ? 'top'
          : justify?.includes('bottom')
            ? 'bottom'
            : 'center',
        face: g.effects?.face,
        bold: g.effects?.bold,
        italic: g.effects?.italic,
      });
    }
  }
}

function sampleArc(start: Vec2, mid: Vec2, end: Vec2): Vec2[] {
  const ax = start.x,
    ay = start.y,
    bx = mid.x,
    by = mid.y,
    cx = end.x,
    cy = end.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return [start, end];
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux);
  const a1 = Math.atan2(cy - uy, cx - ux);
  const aMid = Math.atan2(by - uy, bx - ux);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = !(norm(aMid - a0) <= norm(a1 - a0));
  const sweep = ccw ? -norm(a0 - a1) : norm(a1 - a0);
  const n = 24;
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push({ x: ux + r * Math.cos(a), y: uy + r * Math.sin(a) });
  }
  return pts;
}

function pointInPolygon(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!,
      b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Box-select: item ids fully inside (window) or touching (greedy) the rect. */
export function boxSelectSymbol(
  sym: LibSymbol,
  unit: number,
  bodyStyle: number,
  a: Vec2,
  b: Vec2,
  greedy: boolean,
  showHiddenPins: boolean,
): Set<string> {
  const x0 = Math.min(a.x, b.x),
    x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y),
    y1 = Math.max(a.y, b.y);
  const insidePt = (p: Vec2): boolean => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const out = new Set<string>();

  sym.units.forEach((u, ui) => {
    if (!libUnitShown(u, unit, bodyStyle)) return;
    u.pins.forEach((p, pi) => {
      if (p.hidden && !showHiddenPins) return;
      const tip = insidePt(p.at),
        root = insidePt(pinBodyEnd(p));
      if (greedy ? tip || root : tip && root) out.add(symItemId('pin', ui, pi));
    });
    u.graphics.forEach((g, gi) => {
      const pts = graphicPoints(g);
      const allIn = pts.every(insidePt);
      const anyIn = pts.some(insidePt);
      if (greedy ? anyIn : allIn) out.add(symItemId('gfx', ui, gi));
    });
  });
  sym.properties.forEach((f, fi) => {
    if (!f.at || f.value === '' || f.effects?.hidden) return;
    if (insidePt(f.at)) out.add(symItemId('field', 0, fi));
  });
  return out;
}

function graphicPoints(g: LibGraphic): Vec2[] {
  switch (g.kind) {
    case 'ellipse':
    case 'ellipse_arc':
      // The bounding square of the larger radius; enough for a box that is
      // merged with everything else.
      return [
        { x: g.center.x - g.majorRadius, y: g.center.y - g.majorRadius },
        { x: g.center.x + g.majorRadius, y: g.center.y + g.majorRadius },
      ];
    case 'rectangle':
      return [g.start, g.end];
    case 'circle':
      return [
        { x: g.center.x - g.radius, y: g.center.y - g.radius },
        { x: g.center.x + g.radius, y: g.center.y + g.radius },
      ];
    case 'arc':
      return [g.start, g.mid, g.end];
    case 'bezier':
    case 'polyline':
      return [...g.points];
    case 'text':
      return [g.at];
  }
}

export { snap, snapHalf };
