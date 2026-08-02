// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Unit menu and Place Next Symbol Unit. Counterparts:
 * `SYMBOL_UNIT_MENU` (eeschema/tools/sch_edit_tool.cpp),
 * `LIB_SYMBOL::GetUnitDisplayName` and `GetUnplacedUnitsForSymbol`
 * (eeschema/tools/sch_tool_utils.cpp), and
 * `SCH_DRAWING_TOOLS::PlaceNextSymbolUnit` (eeschema/tools/sch_drawing_tools.cpp).
 *
 * A multi-unit part is placed one unit at a time: U1A here, U1B over there,
 * all sharing one reference and one physical package. This is where a
 * placement is told which unit it is.
 *
 * The menu marks the units that are *already on the sheet*, because placing
 * two copies of U1A is a mistake the schematic cannot see — both are valid
 * symbols, they just both claim the same half of the same chip. Upstream
 * annotates each entry rather than disabling it, since re-picking a placed
 * unit is legitimate when you are swapping two of them over.
 *
 * Below that list sit the "Place unit X" entries, which start a placement of a
 * unit the sheet is missing. That placement is a *copy of the symbol you
 * right-clicked*, not a fresh one off the library: it inherits the reference,
 * so the new unit joins the same package instead of being annotated into a
 * package of its own.
 */

import type { LibSymbol, Schematic, SchSymbol } from '../types.js';
import type { EditCommand } from './command.js';
import { symbolNodeWithFreshUuids } from './build.js';
import { childNamed } from '@ziroeda/sexpr/src/query.js';
import { isList, type SList } from '@ziroeda/sexpr';

/** How many distinct units the library part has (SCH_SYMBOL::GetUnitCount). */
export function symbolUnitCount(lib: LibSymbol | undefined): number {
  if (!lib) return 1;
  const units = new Set(lib.units.map((u) => u.unit).filter((u) => u > 0));
  return Math.max(1, units.size);
}

/** `LIB_SYMBOL::LetterSubReference( unit, 'A' )`: 1 → A, 26 → Z, 27 → AA. */
export function unitLetter(unit: number): string {
  let out = '';
  let n = unit;
  do {
    const u = (n - 1) % 26;
    out = String.fromCharCode(65 + u) + out;
    n = Math.trunc((n - u) / 26);
  } while (n > 0);
  return out;
}

/** `(unit_name "…")` inside a unit's sub-symbol node, if the library gave one. */
function unitName(node: SList): string | undefined {
  for (const it of node.items) {
    if (!isList(it)) continue;
    const head = it.items[0];
    if (head?.kind === 'atom' && head.value === 'unit_name') {
      const arg = it.items[1];
      if (arg?.kind === 'string' || arg?.kind === 'atom') return arg.value;
    }
  }
  return undefined;
}

/**
 * `LIB_SYMBOL::GetUnitDisplayName`: the library's own name for the unit, or
 * its letter when it has none.
 */
export function unitDisplayName(lib: LibSymbol | undefined, unit: number): string {
  const named = lib?.units.find((u) => u.unit === unit && unitName(u.source) !== undefined);
  return named ? unitName(named.source)! : unitLetter(unit);
}

const referenceOf = (s: SchSymbol): string =>
  s.fields.find((f) => f.key === 'Reference')?.value ?? '';

/**
 * `GetUnplacedUnitsForSymbol`: the units of this part's reference that are not
 * on the sheet yet.
 *
 * Units are matched by reference, which is what makes them the same physical
 * part. Before annotation every symbol is "U?", so that alone would collapse
 * an unannotated op-amp and an unannotated logic gate into one part — upstream
 * adds the library id as a tie-breaker in exactly that case, and so do we.
 *
 * Upstream sweeps the whole hierarchy (`schematic->Hierarchy()`), not one sheet:
 * U1A on the power sheet still makes U1A placed when you are looking at U1B on
 * the root. Pass every open document as `hierarchy` to get that; the default
 * searches only `doc`.
 */
export function unplacedUnits(
  doc: Schematic,
  symbolIndex: number,
  libById: ReadonlyMap<string, LibSymbol>,
  hierarchy: Iterable<Schematic> = [doc],
): Set<number> {
  const sym = doc.symbols[symbolIndex];
  if (!sym) return new Set();
  const ref = referenceOf(sym);
  const unannotated = ref.endsWith('?');

  const missing = new Set<number>();
  for (let u = 1; u <= symbolUnitCount(libById.get(sym.libId)); u++) missing.add(u);

  for (const sheet of hierarchy) {
    for (const other of sheet.symbols) {
      if (referenceOf(other) !== ref) continue;
      if (unannotated && other.libId !== sym.libId) continue;
      missing.delete(other.unit);
    }
  }
  return missing;
}

/**
 * The info-bar messages `PlaceNextSymbolUnit` refuses with, verbatim.
 * They are the whole of its user-visible behaviour when it declines, so they
 * are part of the port rather than wording of our own.
 */
export const PLACE_NEXT_UNIT_MESSAGES = {
  /** Nothing, or more than one thing, is selected. */
  needsSingleSymbol: 'Select a single symbol to place the next unit.',
  /** `!symbol->IsMultiUnit()`. */
  singleUnit: 'This symbol has only one unit.',
  /** `missingUnits.empty()`. */
  allPlaced: 'All units of this symbol are already placed.',
  /** A specific unit was asked for and it is already on the sheet. */
  requestedPlaced: 'Requested unit already placed.',
} as const;

/** What Place Next Symbol Unit decided: a symbol to place, or why it refused. */
export type NextSymbolUnitPlan =
  | { readonly ok: true; readonly unit: number; readonly symbol: SchSymbol }
  | { readonly ok: false; readonly message: string };

/**
 * Copy a placed symbol as another unit of the same part.
 *
 * Everything that makes it the same package comes along — reference, value and
 * the other fields, orientation, body style, the BOM/board/DNP attributes — and
 * only the unit changes. The copy needs its own identity, so the node is
 * re-uuid'd (symbol and pins) and the original's per-sheet `(instances …)` are
 * dropped rather than inherited.
 *
 * Upstream instead calls `SetUnitSelection` to write the unit into every
 * instance of a shared screen. We do not model symbol instances — the
 * reference lives in the property — so the copy simply carries the property
 * across, which is what `SetRefProp` does there.
 */
export function cloneSymbolForUnit(sym: SchSymbol, unit: number): SchSymbol {
  const source = symbolNodeWithFreshUuids(sym.source);
  const uuidNode = childNamed(source, 'uuid')?.items[1];
  const uuid = uuidNode && uuidNode.kind !== 'list' ? uuidNode.value : sym.uuid;
  return { ...sym, uuid, unit, source };
}

/**
 * `SCH_DRAWING_TOOLS::PlaceNextSymbolUnit`: work out which unit to place next
 * for the symbol at `symbolIndex`, and build the symbol that will be placed.
 *
 * `requestedUnit` is the "Place unit X" menu entry's unit; 0 (the action's
 * default parameter) means "the lowest one still missing".
 */
export function planNextSymbolUnit(
  doc: Schematic,
  symbolIndex: number,
  libById: ReadonlyMap<string, LibSymbol>,
  requestedUnit = 0,
  hierarchy: Iterable<Schematic> = [doc],
): NextSymbolUnitPlan {
  const sym = doc.symbols[symbolIndex];
  if (!sym) return { ok: false, message: PLACE_NEXT_UNIT_MESSAGES.needsSingleSymbol };

  // SCH_SYMBOL::IsMultiUnit() — GetUnitCount() > 1.
  if (symbolUnitCount(libById.get(sym.libId)) < 2)
    return { ok: false, message: PLACE_NEXT_UNIT_MESSAGES.singleUnit };

  const missing = unplacedUnits(doc, symbolIndex, libById, hierarchy);
  if (missing.size === 0) return { ok: false, message: PLACE_NEXT_UNIT_MESSAGES.allPlaced };

  let next: number;
  if (requestedUnit > 0) {
    if (!missing.has(requestedUnit))
      return { ok: false, message: PLACE_NEXT_UNIT_MESSAGES.requestedPlaced };
    next = requestedUnit;
  } else {
    // The lowest unit number that is missing.
    next = Math.min(...missing);
  }

  return { ok: true, unit: next, symbol: cloneSymbolForUnit(sym, next) };
}

/** Set one symbol's unit (ID_POPUP_SCH_SELECT_UNIT). */
export function setSymbolUnit(index: number, unit: number): EditCommand {
  return {
    label: 'Change Unit',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => (i === index ? { ...s, unit } : s)),
      };
    },
    invert(before: Schematic): EditCommand {
      return setSymbolUnit(index, before.symbols[index]!.unit);
    },
  };
}
