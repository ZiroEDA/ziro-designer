// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Junction-point analysis. Counterpart: `eeschema/junction_helpers.cpp`
 * (JUNCTION_HELPERS::AnalyzePoint) and the SCH_SCREEN::IsExplicitJunction*
 * predicates (`eeschema/sch_screen.cpp`).
 *
 * A point is a junction when three or more distinct exit directions leave it
 * on the same layer (wires or buses). Everything connectable contributes:
 * wire/bus ends and pass-throughs, symbol pins, sheet pins, bus entries, and
 * labels. Pins and entries get unique direction tokens (a pin at 90° must not
 * merge with a wire at 90°, upstream's `uniqueAngle`). Upstream first merges
 * collinear overlapping lines; collecting *directions* in a set dedups the
 * same cases (two collinear exits share one direction key), so the merge pass
 * is not replicated.
 */

import type {
  LibSymbol,
  SchLabel,
  SchLine,
  SchSheet,
  SchSymbol,
  Schematic,
  Vec2,
} from '../types.js';
import { symbolPinPositions } from './connect.js';

export interface PointInfo {
  /** 3+ same-layer exit directions meet here (wires or buses). */
  isJunction: boolean;
  /** A bus entry touches the point. */
  hasBusEntry: boolean;
  /** The bus-entry root also fans out to several wires (junction stays). */
  hasBusEntryToMultipleWires: boolean;
  /** An explicit junction dot item sits on the point. */
  hasExplicitJunctionDot: boolean;
  /** A bus passes through or ends at the point. */
  hasBusAtPoint: boolean;
}

const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** p strictly inside segment [a,b] (collinear, not an endpoint). */
function onSegInterior(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot > 0 && dot < len2;
}

const gcd = (a: number, b: number): number => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
};

/** Exact direction key from `p` toward `q` (upstream rounds to degrees). */
function dirKey(p: Vec2, q: Vec2): string {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const g = gcd(dx, dy);
  return `${dx / g},${dy / g}`;
}

/** SCH_CONNECTION::IsBusLabel: a vector bus (`NAME[3..0]`) or a bus group
 *  (`NAME{A B}` / `{A B}`). */
export function isBusLabelText(text: string): boolean {
  return /^[^\s]+\[\d+\.\.\d+\]$/.test(text) || /^[^\s{}]*\{[^{}]+\}$/.test(text);
}

/**
 * Every connection point a *position-only* lookup needs, built once per
 * document and reused.
 *
 * `analyzePoint` is called from the post-edit cleanup loop about a thousand
 * times per pass — once per junction, twice per wire — and each call used to
 * rescan the whole sheet. The symbol-pin walk was the expensive part:
 * `symbolPinPositions` builds a transform and allocates one point per pin, so
 * on the coldfire demo (118 symbols, up to 100 pins each) a single call
 * allocated several thousand points. Dropping a dragged part spent **4.5
 * seconds** in that loop, which is the freeze after a drop.
 *
 * The caches are keyed on the *arrays*, not on the `Schematic`. That is
 * deliberate: the cleanup loop analyses a document it rebuilds on every call
 * (`{ ...sch, lines, junctions }`), so a cache keyed on the document object
 * could never hit — but `symbols`, `sheets` and `labels` keep their identity
 * through that spread, and those are exactly the three walks worth caching.
 * Lines and junctions genuinely change each pass and are still scanned.
 */
interface PointCounts {
  symbolPins: Map<string, number>;
  sheetPins: Map<string, number>;
  labels: Map<string, SchLabel[]>;
}
const symbolPinCache = new WeakMap<
  readonly SchSymbol[],
  { lib: ReadonlyMap<string, LibSymbol> | undefined; at: Map<string, number> }
>();
const sheetPinCache = new WeakMap<readonly SchSheet[], Map<string, number>>();
const labelCache = new WeakMap<readonly SchLabel[], Map<string, SchLabel[]>>();

function pinCountsAt(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
): PointCounts {
  let sym = symbolPinCache.get(sch.symbols);
  // The library map is derived from the document's own `lib_symbols`, so a
  // different one means different geometry and the entry has to be rebuilt.
  if (!sym || sym.lib !== libById) {
    const at = new Map<string, number>();
    if (libById) {
      for (const s of sch.symbols) {
        for (const pin of symbolPinPositions(s, libById.get(s.libId))) {
          const k = `${pin.x},${pin.y}`;
          at.set(k, (at.get(k) ?? 0) + 1);
        }
      }
    }
    sym = { lib: libById, at };
    symbolPinCache.set(sch.symbols, sym);
  }

  let sheetPins = sheetPinCache.get(sch.sheets);
  if (!sheetPins) {
    sheetPins = new Map<string, number>();
    for (const sheet of sch.sheets) {
      for (const pin of sheet.pins) {
        const k = `${pin.at.x},${pin.at.y}`;
        sheetPins.set(k, (sheetPins.get(k) ?? 0) + 1);
      }
    }
    sheetPinCache.set(sch.sheets, sheetPins);
  }

  let labels = labelCache.get(sch.labels);
  if (!labels) {
    labels = new Map<string, SchLabel[]>();
    for (const l of sch.labels) {
      const k = `${l.at.x},${l.at.y}`;
      const list = labels.get(k);
      if (list) list.push(l);
      else labels.set(k, [l]);
    }
    labelCache.set(sch.labels, labels);
  }

  return { symbolPins: sym.at, sheetPins, labels };
}

/**
 * JUNCTION_HELPERS::AnalyzePoint. `libById` resolves symbol pin positions;
 * when omitted, pins are not considered (legacy callers/tests).
 */
export function analyzePoint(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
  p: Vec2,
  breakCrossings = false,
): PointInfo {
  const info: PointInfo = {
    isJunction: false,
    hasBusEntry: false,
    hasBusEntryToMultipleWires: false,
    hasExplicitJunctionDot: false,
    hasBusAtPoint: false,
  };

  const exits = { wire: new Set<string>(), bus: new Set<string>() };
  const breakLines = { wire: false, bus: false };
  const midPointLines = { wire: [] as SchLine[], bus: [] as SchLine[] };
  let uniqueToken = 0;
  const unique = (layer: 'wire' | 'bus'): void => {
    breakLines[layer] = true;
    exits[layer].add(`u${uniqueToken++}`);
  };

  for (const j of sch.junctions) {
    if (eq(j.at, p)) info.hasExplicitJunctionDot = true;
  }

  for (const l of sch.lines) {
    if (l.kind !== 'wire' && l.kind !== 'bus') continue;
    if (eq(l.start, l.end)) continue;
    const layer = l.kind;
    if (eq(l.start, p) || eq(l.end, p)) {
      breakLines[layer] = true;
      exits[layer].add(dirKey(p, eq(l.start, p) ? l.end : l.start));
      if (layer === 'bus') info.hasBusAtPoint = true;
    } else if (onSegInterior(p, l.start, l.end)) {
      if (breakCrossings) breakLines[layer] = true;
      midPointLines[layer].push(l);
      if (layer === 'bus') info.hasBusAtPoint = true;
    }
  }

  // Bus entries connect at both ends and break wires and buses alike.
  for (const be of sch.busEntries) {
    const end = { x: be.at.x + be.size.x, y: be.at.y + be.size.y };
    if (eq(be.at, p) || eq(end, p)) {
      info.hasBusEntry = true;
      unique('bus');
      unique('wire');
    } else if (onSegInterior(p, be.at, end)) {
      // Overlapping-but-not-connected entry (upstream's first-pass flag).
      info.hasBusEntry = true;
    }
  }

  // Symbol pins, sheet pins and labels are looked up by position rather than
  // rescanned. See `pinCountsAt` for why this matters so much: on a 118-symbol
  // sheet the pin walk alone allocated a few thousand points *per call*, and
  // the cleanup loop makes about a thousand calls per pass.
  const pins = pinCountsAt(sch, libById);
  const key = `${p.x},${p.y}`;
  for (let n = pins.symbolPins.get(key) ?? 0; n > 0; n--) unique('wire');
  for (let n = pins.sheetPins.get(key) ?? 0; n > 0; n--) unique('wire');
  for (const label of pins.labels.get(key) ?? []) {
    if (label.kind === 'label') breakLines[isBusLabelText(label.text) ? 'bus' : 'wire'] = true;
    else if (label.kind === 'global_label' || label.kind === 'hierarchical_label')
      breakLines.wire = true;
  }

  // Pass-through lines only fan out (count both directions) once something
  // else breaks the layer at this point.
  for (const layer of ['wire', 'bus'] as const) {
    if (!breakLines[layer]) continue;
    for (const l of midPointLines[layer]) {
      exits[layer].add(dirKey(p, l.start));
      exits[layer].add(dirKey(p, l.end));
    }
  }

  if (info.hasBusEntry) {
    // One wire + the entry is two wire exits and exactly one bus exit; more
    // wire exits mean the entry root feeds several wires.
    info.hasBusEntryToMultipleWires = exits.wire.size > 2 && exits.bus.size === 1;
  }

  info.isJunction = exits.wire.size >= 3 || exits.bus.size >= 3;
  return info;
}

/** SCH_SCREEN::IsExplicitJunction: a junction dot belongs at `p` (existing
 *  dots are legitimate here). */
export function isExplicitJunction(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
  p: Vec2,
): boolean {
  const info = analyzePoint(sch, libById, p);
  return info.isJunction && (!info.hasBusEntry || info.hasBusEntryToMultipleWires);
}

/**
 * SCH_SCREEN::IsExplicitJunctionAllowed: whether the user may place a dot at
 * `p`. Unlike the two predicates above this analyzes with crossings broken, so
 * a wire crossing another counts as four exits and a dot is offered there,
 * upstream's junction tool refuses the click when this is false ("Junction
 * location contains no joinable wires and/or pins.").
 */
export function isExplicitJunctionAllowed(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
  p: Vec2,
): boolean {
  const info = analyzePoint(sch, libById, p, true);
  return info.isJunction && (!info.hasBusEntry || info.hasBusEntryToMultipleWires);
}

/** SCH_SCREEN::IsExplicitJunctionNeeded: a dot belongs at `p` and none is
 *  there yet. */
export function isExplicitJunctionNeeded(
  sch: Schematic,
  libById: ReadonlyMap<string, LibSymbol> | undefined,
  p: Vec2,
): boolean {
  const info = analyzePoint(sch, libById, p);
  return (
    info.isJunction &&
    (!info.hasBusEntry || info.hasBusEntryToMultipleWires) &&
    !info.hasExplicitJunctionDot
  );
}
