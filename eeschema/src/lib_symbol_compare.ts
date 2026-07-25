/**
 * Library symbol comparison. Counterpart: `eeschema/lib_symbol.cpp`
 * (`LIB_SYMBOL::Compare`) under the flags ERC uses —
 * `COMPARE_FLAGS::EQUALITY | COMPARE_FLAGS::ERC` — which is what
 * TestLibSymbolIssues runs to decide whether a schematic's cached symbol still
 * matches the library copy (ERCE_LIB_SYMBOL_MISMATCH).
 *
 * Under those flags `SCH_ITEM::compare` stops after type, unit, body style, the
 * private flag and the position, so the comparison is: the power flag, the unit
 * count, the graphic items (count, then each one's geometry), the pins (matched
 * by number + unit + body style, then position), the fields (matched by
 * mandatory id or name, then text — position skipped, since Compare adds
 * SKIP_TST_POS for fields under ERC), the footprint filters, the keywords and
 * the pin-name offset. The show-pin-names / exclude-from-* settings are
 * deliberately *not* compared under ERC (upstream guards them with
 * `( aCompareFlags & ERC ) == 0`).
 *
 * Not compared here because this model does not carry them: pin maps,
 * associated footprints, unit display names and body-style names.
 */

import type { LibGraphic, LibPin, LibSymbol, LibSymbolUnit, SchField, Vec2 } from './types.js';

/** Why two symbols differ — the message Compare would have reported. */
export type LibSymbolDifference =
  | 'power flag'
  | 'unit count'
  | 'graphic item count'
  | 'graphic item'
  | 'extra pin'
  | 'missing pin'
  | 'pin'
  | 'extra field'
  | 'missing field'
  | 'field'
  | 'footprint filters'
  | 'keywords'
  | 'pin name offset';

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

const samePoints = (a: readonly Vec2[], b: readonly Vec2[]): boolean =>
  a.length === b.length && a.every((p, i) => samePoint(p, b[i]!));

/** EDA_SHAPE::compare — the geometry of one graphic item. */
function sameGraphic(a: LibGraphic, b: LibGraphic): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'rectangle':
      return b.kind === 'rectangle' && samePoint(a.start, b.start) && samePoint(a.end, b.end);
    case 'circle':
      return b.kind === 'circle' && samePoint(a.center, b.center) && a.radius === b.radius;
    case 'arc':
      return (
        b.kind === 'arc' &&
        samePoint(a.start, b.start) &&
        samePoint(a.mid, b.mid) &&
        samePoint(a.end, b.end)
      );
    case 'polyline':
    case 'bezier':
      return (b.kind === 'polyline' || b.kind === 'bezier') && samePoints(a.points, b.points);
    default:
      // Text and any other body item: position and content.
      return (
        'at' in a &&
        'at' in b &&
        samePoint(a.at as Vec2, b.at as Vec2) &&
        ('text' in a && 'text' in b ? a.text === b.text : true)
      );
  }
}

/** cmp_items: shapes are compared in a stable order, not as written. */
function sortedGraphics(units: readonly LibSymbolUnit[]): LibGraphic[] {
  const all = units.flatMap((u) => [...u.graphics]);
  return all.sort((a, b) => (keyOfGraphic(a) < keyOfGraphic(b) ? -1 : 1));
}

function keyOfGraphic(g: LibGraphic): string {
  switch (g.kind) {
    case 'rectangle':
      return `rect|${g.start.x},${g.start.y}|${g.end.x},${g.end.y}`;
    case 'circle':
      return `circle|${g.center.x},${g.center.y}|${g.radius}`;
    case 'arc':
      return `arc|${g.start.x},${g.start.y}|${g.mid.x},${g.mid.y}|${g.end.x},${g.end.y}`;
    case 'polyline':
    case 'bezier':
      return `${g.kind}|${g.points.map((p) => `${p.x},${p.y}`).join(';')}`;
    default:
      return `${(g as { kind: string }).kind}|${JSON.stringify(g)}`;
  }
}

/** GetPin( number, unit, bodyStyle ). */
function findPin(units: readonly LibSymbolUnit[], number: string, unit: number, body: number) {
  for (const u of units) {
    if (u.unit !== unit || u.bodyStyle !== body) continue;
    const pin = u.pins.find((p) => p.number === number);
    if (pin) return pin;
  }
  return undefined;
}

interface UnitPin {
  pin: LibPin;
  unit: number;
  bodyStyle: number;
}

const allPins = (units: readonly LibSymbolUnit[]): UnitPin[] =>
  units.flatMap((u) => u.pins.map((pin) => ({ pin, unit: u.unit, bodyStyle: u.bodyStyle })));

const property = (sym: LibSymbol, key: string): SchField | undefined =>
  sym.properties.find((f) => f.key === key);

/** LIB_SYMBOL::GetUnitCount. */
const unitCount = (sym: LibSymbol): number => Math.max(1, ...sym.units.map((u) => u.unit));

/**
 * Compare a schematic's cached symbol with the library's copy. Returns the
 * first difference found, or null when they match — Compare's `retv != 0`.
 */
export function compareLibSymbolsForErc(
  cached: LibSymbol,
  library: LibSymbol,
): LibSymbolDifference | null {
  if (cached.isPower !== library.isPower) return 'power flag';
  if (unitCount(cached) !== unitCount(library)) return 'unit count';

  // Graphic items: count first, then each one in sorted order.
  const aShapes = sortedGraphics(cached.units);
  const bShapes = sortedGraphics(library.units);
  if (aShapes.length !== bShapes.length) return 'graphic item count';
  for (let i = 0; i < aShapes.length; i++) {
    if (!sameGraphic(aShapes[i]!, bShapes[i]!)) return 'graphic item';
  }

  // Pins, matched by number within the same unit and body style. (Upstream's
  // reverse loop looks the pin up in aRhs again — plainly a typo, since that
  // can never fail; the intent, mirrored here, is to catch a pin the library
  // has and the schematic copy lacks.)
  for (const { pin, unit, bodyStyle } of allPins(cached.units)) {
    const other = findPin(library.units, pin.number, unit, bodyStyle);
    if (!other) return 'extra pin';
    if (!samePoint(pin.at, other.at)) return 'pin';
  }
  for (const { pin, unit, bodyStyle } of allPins(library.units)) {
    if (!findPin(cached.units, pin.number, unit, bodyStyle)) return 'missing pin';
  }

  // Fields, matched by name; the text is compared (EQUALITY) but not the
  // position (Compare adds SKIP_TST_POS for fields under ERC).
  for (const field of cached.properties) {
    const other = property(library, field.key);
    if (!other) return 'extra field';
    if (field.value !== other.value) return 'field';
  }
  for (const field of library.properties) {
    if (!property(cached, field.key)) return 'missing field';
  }

  const filters = (sym: LibSymbol): string[] =>
    (property(sym, 'ki_fp_filters')?.value ?? '').split(/\s+/).filter(Boolean);
  const aFilters = filters(cached);
  const bFilters = filters(library);
  if (aFilters.length !== bFilters.length) return 'footprint filters';
  for (let i = 0; i < aFilters.length; i++) {
    if (aFilters[i] !== bFilters[i]) return 'footprint filters';
  }

  if (
    (property(cached, 'ki_keywords')?.value ?? '') !==
    (property(library, 'ki_keywords')?.value ?? '')
  )
    return 'keywords';

  if (cached.pinNameOffset !== library.pinNameOffset) return 'pin name offset';

  return null;
}
