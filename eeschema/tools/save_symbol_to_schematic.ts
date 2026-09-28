// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The return leg of "Edit with Symbol Editor". Counterpart:
 * `SCH_EDIT_FRAME::SaveSymbolToSchematic` — the edited symbol goes back into
 * the schematic's own `lib_symbols`, and every placement that draws from it
 * catches up.
 *
 * Three things it does that are easy to miss:
 *
 *  - **It updates every unit, not the one you opened.** Upstream collects every
 *    placement sharing the principal's annotated reference (`allUnits`) and
 *    re-points all of them. A four-unit op-amp edited through unit B would
 *    otherwise leave A, C and D drawing the old body.
 *  - **The library entry is replaced, not merged.** The schematic's cached
 *    `lib_symbols` entry becomes the edited symbol. That cache is what the file
 *    is written from, so a save that skipped it would produce a schematic whose
 *    symbols disagree with the symbols it embeds.
 *  - **Orphaned alternates are cleared.** A placement can name an alternate pin
 *    function that the edited symbol no longer defines; upstream drops those
 *    rather than leaving a placement pointing at nothing.
 *
 * **Not here yet: `UpdateFields`.** Upstream follows the re-point with
 * `unit->UpdateFields( …, true, true, true, false, false )` — update style,
 * update ref, update other fields, reset neither — which pushes the edited
 * symbol's field text, effects and positions onto every placement. That path can rewrite the **Reference**, and it is only safe
 * because `LoadSymbolFromSchematic` seeded the working symbol's fields from the
 * placement — so the "library" value it writes back is the placement's own
 * "U1", not the library's "U". Getting that wrong de-annotates a schematic,
 * which is not a bug worth risking for a feature that is not yet reachable, so
 * it lands with the UI once the seeding is wired end to end and can be tested
 * against it. Everything here is safe without it: the body updates, and the
 * fields keep what the user placed.
 *
 * One deliberate divergence: a *derived* symbol saves as a concrete one.
 * Upstream flattens on the way in (`LoadSymbolFromSchematic`) and again on the
 * way out (`SetLibSymbol( aSymbol.Flatten() )`), so what returns is a full
 * symbol either way; writing it back with its `extends` intact would mean
 * writing a body the format says derived symbols do not have, and the edits
 * would vanish on the next read.
 */

import type { EditCommand } from './command.js';
import type { LibSymbol, SchSymbol, Schematic } from '../types.js';
import { writeLibSymbolNode } from '../sch_io/sexpr/write-symbol-lib.js';
import { refId } from './hittest.js';
import { clearAlternates } from './pin_alternates.js';

/** The Reference field's value, or undefined when the symbol is unannotated. */
function referenceOf(sym: SchSymbol): string | undefined {
  const ref = sym.fields.find((f) => f.key === 'Reference')?.value;
  // "?" and "R?" are placeholders, not an annotation: grouping by them would
  // sweep in every unannotated symbol on the sheet.
  return ref && !ref.endsWith('?') ? ref : undefined;
}

/**
 * Which placements the save applies to: the one that was edited, plus every
 * other placement carrying the same annotated reference (`allUnits`).
 *
 * An unannotated placement stands alone — there is no reference to group it by,
 * and grouping by the placeholder would catch every other unannotated symbol.
 */
export function unitsOfSameSymbol(doc: Schematic, targetId: string): number[] {
  const at = doc.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === targetId);
  if (at === -1) return [];
  const ref = referenceOf(doc.symbols[at]!);
  if (ref === undefined) return [at];
  return doc.symbols
    .map((s, i) => (i === at || referenceOf(s) === ref ? i : -1))
    .filter((i) => i !== -1);
}

/**
 * The edited symbol as the schematic's `lib_symbols` should hold it: named by
 * the placement's lib id, concrete, and with a freshly built source node so the
 * writer emits the edit rather than the bytes it was read with.
 */
export function embeddedLibSymbol(edited: LibSymbol, libId: string): LibSymbol {
  const { extends: _derived, ...concrete } = edited;
  const named: LibSymbol = { ...concrete, libId };
  return { ...named, source: writeLibSymbolNode(named) };
}

/**
 * Put the edited symbol back into the schematic.
 *
 * Returns null when the placement is gone — the editor is a separate view, and
 * the symbol can be deleted while it is open.
 */
export function saveSymbolToSchematic(
  doc: Schematic,
  targetId: string,
  edited: LibSymbol,
): EditCommand | null {
  const units = unitsOfSameSymbol(doc, targetId);
  if (units.length === 0) return null;
  const libId = doc.symbols[units[0]!]!.libId;
  const entry = embeddedLibSymbol(edited, libId);
  const libPins = entry.units.flatMap((u) => u.pins);
  const touched = new Set(units);

  const apply = (d: Schematic): Schematic => {
    const at = d.libSymbols.findIndex((l) => l.libId === libId);
    const libSymbols =
      at === -1 ? [...d.libSymbols, entry] : d.libSymbols.map((l, i) => (i === at ? entry : l));
    return {
      ...d,
      libSymbols,
      // resetAll false: an alternate the edited symbol still defines is the
      // user's choice and survives. Only the orphans go.
      symbols: d.symbols.map((s, i) => (touched.has(i) ? clearAlternates(s, libPins, false) : s)),
    };
  };

  return {
    label: 'Save Symbol to Schematic',
    apply,
    // The whole of what apply touches, snapshotted. Reversing an embedded
    // library entry field by field would be guesswork; putting back the two
    // arrays is exact.
    invert: (before) => restore(before.libSymbols, before.symbols),
  };
}

function restore(libSymbols: readonly LibSymbol[], symbols: readonly SchSymbol[]): EditCommand {
  return {
    label: 'Save Symbol to Schematic',
    apply: (d) => ({ ...d, libSymbols, symbols }),
    invert: (before) => restore(before.libSymbols, before.symbols),
  };
}
