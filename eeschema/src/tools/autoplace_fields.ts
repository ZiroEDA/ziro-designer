// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Autoplace a symbol's fields (O). Counterpart: `eeschema/autoplace_fields.cpp`
 * (AUTOPLACER), whose own comment lays the algorithm out:
 *
 *   1. compute the fields' bounding box                    computeFBoxSize
 *   2. choose a side to put it on                          chooseSideForFields
 *      a. rank the four sides by orientation               getPreferredSides
 *      b. prefer a side with no pins on it, highest-ranked first
 *      c. failing that, the side with the fewest pins
 *   3. compute where that box goes                         fieldBoxPlacement
 *   4. move each field into it                             fieldH/VPlacement
 *      a. re-justify toward the side, if the option allows  justifyField
 *      b. round to a 50 mil grid coordinate, if desired
 *
 * The preferred-side ranking is where the behaviour lives, and upstream is
 * candid that it "was determined mostly by trial and error": right, top, left,
 * bottom by default; left and right swapped for a horizontally mirrored symbol;
 * horizontal and vertical swapped once a symbol is more than three times as
 * wide as it is tall; and a different order again for power symbols, which want
 * their label above them.
 *
 * AUTOPLACE_MANUAL — what the O hotkey runs, as against the AUTOPLACE_AUTO pass
 * a placement does — adds two steps that need the rest of the sheet rather than
 * the symbol, and so change nothing on an uncluttered schematic:
 *
 *   2a. rule out sides where the fields would land on something
 *       (`getCollidingSides` / `chooseSideFiltered`). A side is ruled out
 *       *twice over*: first the sides that hit an object, then the sides that
 *       hit only horizontal wires, so a wire is a softer obstacle than a
 *       symbol. Running off the drawable area counts as hitting an object.
 *   3a. if the box landed on horizontal wires above or below the symbol, snap
 *       it to the 100 mil wire pitch so the fields sit *between* them rather
 *       than across them (`fitFieldsBetweenWires`), which also switches the box
 *       to fixed one-wire-per-field spacing.
 */

import type { LibSymbol, SchField, SchSheet, SchSymbol, SchLine, Vec2 } from '../types.js';
import { symbolBodyBBox, labelBox, type BBox } from './bbox.js';
import { symbolFieldBoxes, type SymbolFieldBox } from '../fieldbox.js';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';
import { symbolTransform } from '@ziroeda/common/src/transform.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { refId } from './hittest.js';
import type { Schematic } from '../types.js';
import type { EditCommand } from './command.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import { buildPropertyNode } from '../sch_io/sexpr/write-schematic.js';

/** The paddings, all "arbitrarily chosen for aesthetics" upstream. */
const FIELD_PADDING = mmToIU(15 * 0.0254);
const HPADDING = mmToIU(25 * 0.0254);
const VPADDING = mmToIU(15 * 0.0254);
/** The grid autoplaced fields round to. */
const GRID_50_MIL = mmToIU(50 * 0.0254);
/** `WIRE_V_SPACING`: the 100 mil pitch wires are drawn on. */
const WIRE_V_SPACING = mmToIU(100 * 0.0254);

/** The four sides, as unit vectors (+Y is down). */
const SIDE_TOP = { x: 0, y: -1 };
const SIDE_BOTTOM = { x: 0, y: 1 };
const SIDE_LEFT = { x: -1, y: 0 };
const SIDE_RIGHT = { x: 1, y: 0 };

type Side = { x: number; y: number };
const sameSide = (a: Side, b: Side): boolean => a.x === b.x && a.y === b.y;

export interface AutoplaceOptions {
  /** `m_AutoplaceFields.allow_rejustify`: also set each field's justification. */
  allowRejustify: boolean;
  /** `m_AutoplaceFields.align_to_grid`: round the result to the 50 mil grid. */
  alignToGrid: boolean;
}

/** `round_n`: to the nearest multiple of n, up or down. */
const roundN = (value: number, n: number, up: boolean): number =>
  value % n ? n * (Math.trunc(value / n) + (up ? 1 : 0)) : value;

/**
 * `getPinSide`. A pin drawn pointing right sits on the symbol's *left*: the pin
 * line runs outward from the body, so the side it occupies is the opposite of
 * the direction it points.
 */
function pinSide(pinAngle: number, sym: SchSymbol): Side {
  const t = symbolTransform(sym.angle, sym.mirror);
  // The pin's local direction, through the placement transform.
  const local =
    pinAngle === 0
      ? { x: 1, y: 0 }
      : pinAngle === 90
        ? { x: 0, y: -1 }
        : pinAngle === 180
          ? { x: -1, y: 0 }
          : { x: 0, y: 1 };
  const world = {
    x: t.x1 * local.x + t.y1 * local.y,
    y: t.x2 * local.x + t.y2 * local.y,
  };
  if (world.x > 0) return SIDE_LEFT;
  if (world.x < 0) return SIDE_RIGHT;
  if (world.y < 0) return SIDE_BOTTOM;
  return SIDE_TOP;
}

/** The pins of the symbol's active unit, as their drawn angles. */
function pinAngles(sym: SchSymbol, lib: LibSymbol | undefined, powerSymbol: boolean): number[] {
  if (!lib) return [];
  const out: number[] = [];
  for (const u of lib.units) {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      continue;
    for (const p of u.pins) {
      // A hidden pin still occupies its side on a power symbol, whose pin is
      // always hidden and is the whole point of the symbol.
      if (p.hidden && !powerSymbol) continue;
      out.push(p.angle);
    }
  }
  return out;
}

/** `getPreferredSides`, ranked best first. */
function preferredSides(
  sym: SchSymbol,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  powerSymbol: boolean,
): Side[] {
  const sides = [SIDE_RIGHT, SIDE_TOP, SIDE_LEFT, SIDE_BOTTOM];
  const swap = (i: number, j: number): void => {
    const t = sides[i]!;
    sides[i] = sides[j]!;
    sides[j] = t;
  };
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  const angle = ((sym.angle % 360) + 360) % 360;

  if (powerSymbol) {
    // A power symbol wants its label above it, whichever way it is turned.
    if (angle === 0) {
      swap(0, 1);
      swap(1, 3); // TOP, BOTTOM, RIGHT, LEFT
    } else if (angle === 90) {
      swap(0, 2);
      swap(1, 2); // LEFT, RIGHT, TOP, BOTTOM
    } else if (angle === 180) {
      swap(0, 3); // BOTTOM, TOP, LEFT, RIGHT
    } else {
      swap(1, 2); // RIGHT, LEFT, TOP, BOTTOM
    }
    return sides;
  }

  // A horizontally mirrored symbol reads the other way round, so its preferred
  // left and right swap with it.
  if (sym.mirror === 'x' && (angle === 0 || angle === 180)) swap(0, 2);
  // A symbol much wider than it is tall has more room above and below it.
  if (h > 0 && w / h > 3.0) {
    swap(0, 1);
    swap(1, 3);
  }
  return sides;
}

/** The fields that autoplace moves: visible, and not opted out. */
const placeable = (f: SchField): boolean => !f.effects?.hidden && !f.doNotAutoplace;

// ----- AUTOPLACE_MANUAL: the sheet around the symbol ---------------------------

/** What the sheet looks like to a symbol whose fields are being placed. */
export interface AutoplaceSheet {
  /** The sheet the symbol sits on. */
  doc: Schematic;
  libById: ReadonlyMap<string, LibSymbol>;
  /**
   * The page minus the drawing sheet's margins (`getDrawableArea`), if the
   * caller knows it — resolving a paper name to a size is the application's
   * job, not the model's. Upstream skips this check whenever the area comes
   * back degenerate, and so do we when it is not supplied.
   */
  drawableArea?: BBox;
}

/** `COLLISION`: nothing, only horizontal wires, or something solid. */
type Collision = 'none' | 'hWires' | 'objects';

/** One thing the fields could land on. */
interface Collider {
  box: BBox;
  /** Set when the collider is a line, which `getCollidingSides` treats apart. */
  line?: SchLine;
}

const box2 = (a: Vec2, b: Vec2): BBox => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

const intersects = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

const containsBox = (outer: BBox, inner: BBox): boolean =>
  inner.minX >= outer.minX &&
  inner.maxX <= outer.maxX &&
  inner.minY >= outer.minY &&
  inner.maxY <= outer.maxY;

/**
 * `getPossibleCollisions`: everything on the sheet that could get in the way,
 * the symbol itself excepted. Another symbol contributes its own visible
 * fields as well as its body.
 *
 * Upstream pre-filters by the union of the candidate boxes and the symbol's;
 * we collect the sheet once and let `filterCollisions` do the narrowing, which
 * is the same answer without an index to maintain.
 */
function possibleColliders(sheet: AutoplaceSheet, self: SchSymbol): Collider[] {
  const { doc, libById } = sheet;
  const out: Collider[] = [];

  doc.symbols.forEach((s) => {
    if (s === self || (s.uuid !== undefined && s.uuid === self.uuid)) return;
    const lib = libById.get(schSymbolLibraryName(s));
    out.push({ box: symbolBodyBBox(s, lib) });
    for (const fb of symbolFieldBoxes(s, lib)) {
      const f = s.fields[fb.index];
      if (!f || f.effects?.hidden) continue;
      out.push({
        box: {
          minX: fb.box.x,
          minY: fb.box.y,
          maxX: fb.box.x + fb.box.w,
          maxY: fb.box.y + fb.box.h,
        },
      });
    }
  });

  for (const l of doc.lines) out.push({ box: box2(l.start, l.end), line: l });
  for (const l of doc.labels) out.push({ box: labelBox(l) });
  for (const d of doc.directiveLabels ?? []) out.push({ box: box2(d.at, d.at) });
  for (const j of doc.junctions) out.push({ box: box2(j.at, j.at) });
  for (const nc of doc.noConnects) out.push({ box: box2(nc.at, nc.at) });
  for (const be of doc.busEntries)
    out.push({ box: box2(be.at, { x: be.at.x + be.size.x, y: be.at.y + be.size.y }) });
  for (const sh of doc.sheets)
    out.push({ box: box2(sh.at, { x: sh.at.x + sh.size.w, y: sh.at.y + sh.size.h }) });
  for (const tb of doc.textBoxes) out.push({ box: box2(tb.start, tb.end) });
  // Images are left out: their extent needs the PNG's pixel dimensions, which
  // the model does not carry (only the base64 payload and a scale).

  return out;
}

/** `filterCollisions`: those that actually overlap the box. */
const filterCollisions = (colliders: readonly Collider[], box: BBox): Collider[] =>
  colliders.filter((c) => intersects(c.box, box));

/**
 * `getCollidingSides`: for each side, whether the field box placed there would
 * hit nothing, only horizontal wires, or something solid.
 *
 * A line only counts as the softer `hWires` when the side is vertical
 * (`!side.x`) and the line is horizontal; anything else is a hard collision.
 */
function collidingSides(
  sym: SchSymbol,
  bbox: BBox,
  size: Vec2,
  colliders: readonly Collider[],
  drawableArea: BBox | undefined,
): Map<Side, Collision> {
  const out = new Map<Side, Collision>();
  for (const side of [SIDE_RIGHT, SIDE_TOP, SIDE_LEFT, SIDE_BOTTOM]) {
    const topLeft = fieldBoxTopLeft(bbox, size, side);
    const box: BBox = {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: topLeft.x + size.x,
      maxY: topLeft.y + size.y,
    };

    let collision: Collision = 'none';
    // Running off the drawing sheet is as bad as landing on an item.
    if (drawableArea && !containsBox(drawableArea, box)) collision = 'objects';

    for (const c of filterCollisions(colliders, box)) {
      if (c.line && side.x === 0) {
        if (c.line.start.y === c.line.end.y && collision !== 'objects') collision = 'hWires';
        else collision = 'objects';
      } else {
        collision = 'objects';
      }
    }
    if (collision !== 'none') out.set(side, collision);
  }
  return out;
}

/**
 * `fitFieldsBetweenWires`: when the box sits above or below the symbol and
 * every obstacle under it is a horizontal wire on one consistent offset, snap
 * its top to the wire pitch so the fields land in the gaps.
 *
 * Returns the new top, or null when the conditions do not hold — upstream is
 * careful that every "return false" happens *before* it commits to the fixed
 * spacing, so a refusal leaves the dynamic box untouched.
 */
function fitFieldsBetweenWires(
  boxTopLeft: Vec2,
  size: Vec2,
  side: Side,
  colliders: readonly Collider[],
): number | null {
  if (!sameSide(side, SIDE_TOP) && !sameSide(side, SIDE_BOTTOM)) return null;

  const box: BBox = {
    minX: boxTopLeft.x,
    minY: boxTopLeft.y,
    maxX: boxTopLeft.x + size.x,
    maxY: boxTopLeft.y + size.y,
  };
  const hits = filterCollisions(colliders, box);
  if (hits.length === 0) return null;

  let offset = 0;
  for (const c of hits) {
    if (!c.line) return null;
    if (c.line.start.y !== c.line.end.y) return null;
    const thisOffset = (3 * WIRE_V_SPACING) / 2 - (c.line.start.y % WIRE_V_SPACING);
    if (offset === 0) offset = thisOffset;
    else if (offset !== thisOffset) return null;
  }

  return roundN(boxTopLeft.y, WIRE_V_SPACING, sameSide(side, SIDE_BOTTOM));
}

/**
 * `chooseSideForFields`, including the collision sifting `chooseSideFiltered`
 * does when the run is manual.
 *
 * Upstream reverses the preference list before filtering and scans it in both
 * directions afterwards, which is what settles ties: a side removed for
 * colliding is still remembered as a fallback if it has no more pins than the
 * best fallback so far, and iterating worst-preferred-first means the most
 * preferred of an equal-pin group is the one that sticks.
 *
 * Objects are sifted before horizontal wires, so a side blocked only by wires
 * outranks one blocked by a symbol.
 */
function chooseSide(
  ranked: readonly Side[],
  countOn: (s: Side) => number,
  colliding: Map<Side, Collision> | null,
): { side: Side; pins: number } {
  // Worst-preferred first, as upstream reverses it.
  let sides = ranked.slice().reverse();
  let sel = { side: SIDE_RIGHT, pins: Number.MAX_SAFE_INTEGER };

  const sift = (collision: Collision): void => {
    const keep: Side[] = [];
    for (const s of sides) {
      if (colliding!.get(s) === collision) {
        const n = countOn(s);
        if (n <= sel.pins) sel = { side: s, pins: n };
      } else {
        keep.push(s);
      }
    }
    sides = keep;
  };

  if (colliding) {
    sift('objects');
    sift('hWires');
  }

  // A survivor with no pins at all wins outright, best-preferred first.
  for (const s of sides.slice().reverse()) if (countOn(s) === 0) return { side: s, pins: 0 };

  for (const s of sides) {
    const n = countOn(s);
    if (n <= sel.pins) sel = { side: s, pins: n };
  }
  return sel;
}

/** `fieldBoxPlacement`: the top-left of the field box on a given side. */
function fieldBoxTopLeft(bbox: BBox, size: Vec2, side: Side): Vec2 {
  const centre = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
  let offsX = (bbox.maxX - bbox.minX + size.x) / 2;
  let offsY = (bbox.maxY - bbox.minY + size.y) / 2;
  if (side.x !== 0) offsX += HPADDING;
  else if (side.y !== 0) offsY += VPADDING;
  return {
    x: centre.x + side.x * offsX - size.x / 2,
    y: centre.y + side.y * offsY - size.y / 2,
  };
}

/**
 * The fields' bounding box: as wide as the widest field, as tall as all of them
 * stacked with their padding (`computeFBoxSize`, dynamic spacing).
 */
function fieldBoxSize(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  alignToGrid: boolean,
  dynamic = true,
): { boxes: { index: number; w: number; h: number }[]; size: Vec2 } {
  const boxes: { index: number; w: number; h: number }[] = [];
  let maxWidth = 0;
  let totalHeight = 0;
  for (const fb of symbolFieldBoxes(sym, lib)) {
    const f = sym.fields[fb.index];
    if (!f || !placeable(f)) continue;
    const w = fb.box.w;
    const h = fb.box.h;
    boxes.push({ index: fb.index, w, h });
    maxWidth = Math.max(maxWidth, w);
    // Non-dynamic: one wire pitch per field, whatever the text measures.
    totalHeight += !dynamic
      ? WIRE_V_SPACING
      : alignToGrid
        ? roundN(h, GRID_50_MIL, true)
        : h + FIELD_PADDING;
  }
  return { boxes, size: { x: maxWidth, y: totalHeight } };
}

/**
 * Autoplace one symbol's fields, returning the fields as they should be.
 * Exported for testing; `autoplaceFields` wraps it in a command.
 */
export function autoplacedFields(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  opts: AutoplaceOptions,
  sheet?: AutoplaceSheet,
): SchField[] {
  const powerSymbol = !!lib?.isPower;
  const bbox = symbolBodyBBox(sym, lib);
  const { boxes, size } = fieldBoxSize(sym, lib, opts.alignToGrid);
  if (boxes.length === 0) return sym.fields.slice();

  // Step 2: the highest-ranked side with no pins, else the fewest-pin side —
  // with the colliding sides sifted out first when this is a manual run.
  const angles = pinAngles(sym, lib, powerSymbol);
  const ranked = preferredSides(sym, bbox, powerSymbol);
  const countOn = (s: Side): number => angles.filter((a) => sameSide(pinSide(a, sym), s)).length;
  const colliders = sheet ? possibleColliders(sheet, sym) : null;
  const chosen = chooseSide(
    ranked,
    countOn,
    colliders ? collidingSides(sym, bbox, size, colliders, sheet?.drawableArea) : null,
  );
  const side = chosen.side;
  const pins = chosen.pins;

  // Step 3: where the box goes (fieldBoxPlacement), and — on a manual run above
  // or below the symbol — snapped to the wire pitch so the fields sit in the
  // gaps between horizontal wires rather than across them.
  const topLeft = fieldBoxTopLeft(bbox, size, side);
  const fittedTop = colliders ? fitFieldsBetweenWires(topLeft, size, side, colliders) : null;
  const forceWireSpacing = fittedTop !== null;
  const boxLeft = topLeft.x;
  const boxTop = fittedTop ?? topLeft.y;
  const boxRight = boxLeft + size.x;

  // Step 4: lay the fields out down the box.
  // justifyField sets ToHAlignment(-side.x), so a field on the symbol's right
  // is left-justified: it reads away from the body. With pins in the way the
  // box has been shifted clear of them, and the justification comes from the
  // perpendicular side instead: SIDE_RIGHT (left-justified) for a top or bottom
  // placement, SIDE_TOP (centred) for a left or right one.
  const hJustify = !opts.allowRejustify
    ? null
    : pins > 0
      ? side.y !== 0
        ? 'left'
        : 'center'
      : side.x > 0
        ? 'left'
        : side.x < 0
          ? 'right'
          : 'center';

  let y = boxTop;
  const out = sym.fields.slice();
  for (const b of boxes) {
    const f = out[b.index]!;
    const justify = hJustify ?? currentHJustify(f);
    // fieldVPlacement's !aDynamic branch: one wire pitch per field, split evenly
    // between the field and its padding, so each lands on its own wire slot.
    const height = forceWireSpacing ? WIRE_V_SPACING / 2 : b.h;
    const padding = forceWireSpacing
      ? WIRE_V_SPACING / 2
      : opts.alignToGrid
        ? roundN(b.h, GRID_50_MIL, true) - b.h
        : FIELD_PADDING;
    let py = y + padding / 2 + height / 2;
    y += padding + height;
    // fieldHPlacement: the anchor follows the justification.
    let px =
      justify === 'left' ? boxLeft : justify === 'right' ? boxRight : (boxLeft + boxRight) / 2;

    if (opts.alignToGrid) {
      // Rounded away from the symbol, so a field never creeps back over it.
      if (side.x !== 0) px = roundN(px, GRID_50_MIL, side.x >= 0);
      if (side.y !== 0) py = roundN(py, GRID_50_MIL, side.y >= 0);
    }

    const effects = { ...(f.effects ?? { hidden: false }) };
    if (hJustify !== null) {
      const tokens = [justify, 'center'].filter((t) => t !== 'center');
      if (tokens.length) (effects as { justify?: string[] }).justify = tokens;
      else delete (effects as { justify?: string[] }).justify;
    }
    out[b.index] = {
      ...f,
      at: { x: Math.round(px), y: Math.round(py) },
      // Fields always display horizontally after autoplace; a symbol turned 90
      // degrees stores them vertical so the transform brings them back level.
      angle: symbolTransform(sym.angle, sym.mirror).y1 !== 0 ? 90 : 0,
      effects,
    };
  }
  return out;
}

const currentHJustify = (f: SchField): string =>
  (f.effects?.justify ?? []).find((t) => t === 'left' || t === 'right') ?? 'center';

/**
 * Autoplace the fields of every selected symbol
 * (SCH_ACTIONS::autoplaceFields, hotkey O).
 */
export function autoplaceFields(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: Map<string, LibSymbol>,
  opts: AutoplaceOptions = { allowRejustify: true, alignToGrid: true },
  drawableArea?: BBox,
): EditCommand | null {
  const targets = doc.symbols.flatMap((s, i) => (ids.has(refId('symbol', s.uuid, i)) ? [i] : []));
  if (targets.length === 0) return null;

  // The O hotkey and the context-menu entry are both AUTOPLACE_MANUAL, so the
  // sheet always comes along; an AUTOPLACE_AUTO caller would omit it.
  const sheet: AutoplaceSheet = drawableArea ? { doc, libById, drawableArea } : { doc, libById };

  const placed = new Map<number, SchField[]>();
  for (const i of targets) {
    const s = doc.symbols[i]!;
    placed.set(i, autoplacedFields(s, libById.get(schSymbolLibraryName(s)), opts, sheet));
  }

  return {
    label: 'Autoplace Fields',
    apply(d) {
      return {
        ...d,
        symbols: d.symbols.map((s, i) => {
          const fields = placed.get(i);
          return fields ? { ...s, fields } : s;
        }),
      };
    },
    invert(before) {
      return {
        label: 'Autoplace Fields',
        apply: (d) => ({
          ...d,
          symbols: d.symbols.map((s, i) =>
            placed.has(i) ? { ...s, fields: before.symbols[i]!.fields } : s,
          ),
        }),
        invert: () => autoplaceFields(doc, ids, libById, opts)!,
      };
    },
  };
}

/**
 * The autoplace a symbol gets because it is being *placed*, rather than because
 * the user asked for one.
 *
 * `SCH_DRAWING_TOOLS::PlaceSymbol` runs it at both of its placement points,
 * each guarded by `if( m_frame->eeconfig()->m_AutoplaceFields.enable )`
 * (sch_drawing_tools.cpp:484-499). The preference defaults to true
 * (eeschema_settings.cpp:328), so out of the box every placed symbol is
 * autoplaced, and the library's own field positions are only a starting point.
 *
 * `sheet` is upstream's screen argument, and the two calls differ in nothing
 * else. It is omitted while the symbol is still attached to the cursor ("Not
 * placed yet, so pass a nullptr screen reference") and supplied once the symbol
 * lands, which is what lets the second pass see the rest of the sheet and step
 * the fields around what is already there.
 *
 * The gate lives here rather than at the call site so that it is reachable from
 * a test: the placement path itself runs inside a WebGL canvas component.
 */
export function autoplacePlacedSymbol(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  enable: boolean,
  opts: AutoplaceOptions,
  sheet?: AutoplaceSheet,
): SchSymbol {
  if (!enable) return sym;
  return { ...sym, fields: autoplacedFields(sym, lib, opts, sheet) };
}

/**
 * `LIB_SYMBOL::AutoplaceFields` on a library symbol's own properties, with no
 * placement behind it.
 *
 * The symbol preview runs this before it measures anything
 * (`SYMBOL_PREVIEW_WIDGET::DisplaySymbol`, symbol_preview_widget.cpp:229-233,
 * and `DisplayPart` again at :283-287), under the same
 * `m_AutoplaceFields.enable` gate as the placement tool. It is why the chooser
 * shows a connector's reference and value stacked beside the body rather than
 * above and below it where the library stores them, and why the preview is
 * scaled to fit a symbol that includes its fields.
 *
 * There is no screen at this point, hence no sheet: nothing else is on it.
 */
export function autoplacedLibFields(
  lib: LibSymbol,
  enable: boolean,
  opts: AutoplaceOptions,
): readonly SchField[] {
  return libPreviewFields(lib, enable, opts).fields;
}

/**
 * The same, plus each field's drawn box.
 *
 * The preview needs both: it draws the fields, and it scales itself to a
 * bounding box that CONTAINS them, because `GetUnitBoundingBox` takes each
 * field's full text extent rather than its anchor
 * (symbol_preview_widget.cpp:238-239). Fitting to the anchors alone leaves a
 * long value string hanging off the side of the pane, which is exactly what a
 * first attempt at this did.
 */
export function libPreviewFields(
  lib: LibSymbol,
  enable: boolean,
  opts: AutoplaceOptions,
): { readonly fields: readonly SchField[]; readonly boxes: readonly SymbolFieldBox[] } {
  // The autoplacer works off a placement, so the library symbol stands in as
  // one at the origin, unrotated and unmirrored, carrying its own properties.
  const asPlaced: SchSymbol = {
    libId: lib.libId,
    at: { x: 0, y: 0 },
    angle: 0,
    unit: 1,
    bodyStyle: 1,
    inBom: true,
    onBoard: true,
    dnp: false,
    fields: lib.properties,
    source: lib.source,
  };
  const fields = enable ? autoplacedFields(asPlaced, lib, opts) : lib.properties;
  return { fields, boxes: symbolFieldBoxes({ ...asPlaced, fields }, lib) };
}

/**
 * `SCH_SHEET::AutoplaceFields` (sch_sheet.cpp:897): the sheet name goes above
 * the box and the filename below it, both left-justified against its left edge,
 * clear of the border by half a text height.
 *
 * A sheet with pins only on its top and bottom edges is "vertically oriented",
 * and then the two fields stand on end beside it instead
 * (`IsVerticalOrientation`: `topBottom > 0 && leftRight == 0`).
 */
function autoplacedSheetFields(sheet: SchSheet, defaultLineWidth: number): SchField[] {
  const penWidth =
    sheet.stroke?.width && sheet.stroke.width > 0 ? sheet.stroke.width : defaultLineWidth;
  const borderMargin = Math.round(penWidth / 2) + 4;
  // A pin's `angle` encodes its side: 0 = right, 90 = top, 180 = left,
  // 270 = bottom (SHEET_SIDE).
  let leftRight = 0;
  let topBottom = 0;
  for (const p of sheet.pins) {
    if (p.angle === 0 || p.angle === 180) leftRight++;
    else if (p.angle === 90 || p.angle === 270) topBottom++;
  }
  const vertical = topBottom > 0 && leftRight === 0;

  const place = (f: SchField, isName: boolean): SchField => {
    const [h = 0, w = 0] = f.effects?.fontSize ?? [];
    // The name clears the border by half a text size, the filename by 0.4 of it.
    const margin = borderMargin + Math.round(Math.max(w, h) * (isName ? 0.5 : 0.4));
    const at = isName
      ? vertical
        ? { x: sheet.at.x - margin, y: sheet.at.y + sheet.size.h }
        : { x: sheet.at.x, y: sheet.at.y - margin }
      : vertical
        ? { x: sheet.at.x + sheet.size.w + margin, y: sheet.at.y + sheet.size.h }
        : { x: sheet.at.x, y: sheet.at.y + sheet.size.h + margin };
    // Both are left-justified; the name sits on its baseline above the box and
    // the filename hangs below its own.
    const justify = ['left', isName ? 'bottom' : 'top'];
    const next: SchField = {
      ...f,
      at,
      angle: vertical ? 90 : 0,
      effects: { ...(f.effects ?? { hidden: false }), justify },
    };
    return { ...next, source: buildPropertyNode(next) };
  };

  return sheet.fields.map((f) =>
    f.key === 'Sheetname' ? place(f, true) : f.key === 'Sheetfile' ? place(f, false) : f,
  );
}

/**
 * Autoplace the fields of every selected sheet, the sheet half of
 * SCH_ACTIONS::autoplaceFields (`autoplaceCondition` is `FieldOwners`, which is
 * symbols, sheets and labels — not symbols alone).
 */
export function autoplaceSheetFields(
  doc: Schematic,
  ids: ReadonlySet<string>,
  defaultLineWidth: number,
): EditCommand | null {
  const placed = new Map<number, SchField[]>();
  doc.sheets.forEach((sh, i) => {
    if (ids.has(refId('sheet', sh.uuid, i)))
      placed.set(i, autoplacedSheetFields(sh, defaultLineWidth));
  });
  if (placed.size === 0) return null;

  return {
    label: 'Autoplace Fields',
    apply(d) {
      return {
        ...d,
        sheets: d.sheets.map((sh, i) => {
          const fields = placed.get(i);
          return fields ? { ...sh, fields } : sh;
        }),
      };
    },
    invert(before) {
      return {
        label: 'Autoplace Fields',
        apply: (d) => ({
          ...d,
          sheets: d.sheets.map((sh, i) =>
            placed.has(i) ? { ...sh, fields: before.sheets[i]!.fields } : sh,
          ),
        }),
        invert: () => autoplaceSheetFields(doc, ids, defaultLineWidth)!,
      };
    },
  };
}
