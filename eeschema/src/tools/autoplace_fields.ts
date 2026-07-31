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
 * AUTOPLACE_MANUAL adds two things this does not do yet: sifting out sides
 * whose fields would collide with other items, and nudging the box to fit
 * between adjacent wires. Both need the rest of the sheet rather than the
 * symbol, and neither changes where fields land on an uncluttered schematic.
 */

import type { LibSymbol, SchField, SchSymbol, Vec2 } from '../types.js';
import { symbolBodyBBox } from './bbox.js';
import { symbolFieldBoxes } from '../fieldbox.js';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';
import { symbolTransform } from '@ziroeda/common/src/transform.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { refId } from './hittest.js';
import type { Schematic } from '../types.js';
import type { EditCommand } from './command.js';

/** The paddings, all "arbitrarily chosen for aesthetics" upstream. */
const FIELD_PADDING = mmToIU(15 * 0.0254);
const HPADDING = mmToIU(25 * 0.0254);
const VPADDING = mmToIU(15 * 0.0254);
/** The grid autoplaced fields round to. */
const GRID_50_MIL = mmToIU(50 * 0.0254);

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

/**
 * The fields' bounding box: as wide as the widest field, as tall as all of them
 * stacked with their padding (`computeFBoxSize`, dynamic spacing).
 */
function fieldBoxSize(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  alignToGrid: boolean,
): { boxes: { index: number; w: number; h: number }[]; size: Vec2 } {
  const boxes: { index: number; w: number; h: number }[] = [];
  let maxWidth = 0;
  let totalHeight = 0;
  for (const fb of symbolFieldBoxes(sym, lib, measureText)) {
    const f = sym.fields[fb.index];
    if (!f || !placeable(f)) continue;
    const w = fb.box.w;
    const h = fb.box.h;
    boxes.push({ index: fb.index, w, h });
    maxWidth = Math.max(maxWidth, w);
    totalHeight += alignToGrid ? roundN(h, GRID_50_MIL, true) : h + FIELD_PADDING;
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
): SchField[] {
  const powerSymbol = !!lib?.isPower;
  const bbox = symbolBodyBBox(sym, lib);
  const { boxes, size } = fieldBoxSize(sym, lib, opts.alignToGrid);
  if (boxes.length === 0) return sym.fields.slice();

  // Step 2: the highest-ranked side with no pins, else the fewest-pin side.
  const angles = pinAngles(sym, lib, powerSymbol);
  const ranked = preferredSides(sym, bbox, powerSymbol);
  const countOn = (s: Side): number => angles.filter((a) => sameSide(pinSide(a, sym), s)).length;
  let side = ranked[0]!;
  let pins = countOn(side);
  const empty = ranked.find((s) => countOn(s) === 0);
  if (empty) {
    side = empty;
    pins = 0;
  } else {
    for (const s of ranked) {
      const n = countOn(s);
      if (n < pins) {
        side = s;
        pins = n;
      }
    }
  }

  // Step 3: where the box goes (fieldBoxPlacement).
  const centre = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
  let offsX = (bbox.maxX - bbox.minX + size.x) / 2;
  let offsY = (bbox.maxY - bbox.minY + size.y) / 2;
  if (side.x !== 0) offsX += HPADDING;
  else if (side.y !== 0) offsY += VPADDING;
  const boxCentre = { x: centre.x + side.x * offsX, y: centre.y + side.y * offsY };
  const boxLeft = boxCentre.x - size.x / 2;
  const boxTop = boxCentre.y - size.y / 2;
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
    const padding = opts.alignToGrid ? roundN(b.h, GRID_50_MIL, true) - b.h : FIELD_PADDING;
    let py = y + padding / 2 + b.h / 2;
    y += padding + b.h;
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
): EditCommand | null {
  const targets = doc.symbols.flatMap((s, i) => (ids.has(refId('symbol', s.uuid, i)) ? [i] : []));
  if (targets.length === 0) return null;

  const placed = new Map<number, SchField[]>();
  for (const i of targets) {
    const s = doc.symbols[i]!;
    placed.set(i, autoplacedFields(s, libById.get(s.libId), opts));
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
