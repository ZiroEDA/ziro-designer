// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Unit menu. Counterparts: `SYMBOL_UNIT_MENU`
 * (eeschema/tools/sch_edit_tool.cpp), `LIB_SYMBOL::GetUnitDisplayName` and
 * `GetUnplacedUnitsForSymbol` (eeschema/tools/sch_tool_utils.cpp).
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
 */

import type { LibSymbol, Schematic, SchSymbol } from '../types.js';
import type { EditCommand } from './command.js';
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

/**
 * `GetUnplacedUnitsForSymbol`: the units of this part's reference that are not
 * on the sheet yet.
 *
 * Units are matched by reference, which is what makes them the same physical
 * part. Before annotation every symbol is "U?", so that alone would collapse
 * an unannotated op-amp and an unannotated logic gate into one part — upstream
 * adds the library id as a tie-breaker in exactly that case, and so do we.
 */
export function unplacedUnits(
  doc: Schematic,
  symbolIndex: number,
  libById: ReadonlyMap<string, LibSymbol>,
): Set<number> {
  const sym = doc.symbols[symbolIndex];
  if (!sym) return new Set();
  const refOf = (s: SchSymbol): string => s.fields.find((f) => f.key === 'Reference')?.value ?? '';
  const ref = refOf(sym);
  const unannotated = ref.endsWith('?');

  const missing = new Set<number>();
  for (let u = 1; u <= symbolUnitCount(libById.get(sym.libId)); u++) missing.add(u);

  for (const other of doc.symbols) {
    if (refOf(other) !== ref) continue;
    if (unannotated && other.libId !== sym.libId) continue;
    missing.delete(other.unit);
  }
  return missing;
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
