// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Cycle Body Style. Counterpart: `SCH_EDIT_TOOL::CycleBodyStyle`
 * (eeschema/tools/sch_edit_tool.cpp).
 *
 * A symbol definition may draw itself more than one way: the second body style
 * is KiCad's "De Morgan" alternate, the equivalent gate drawn with its inputs
 * and output inverted. A placed symbol picks one with `(unit N)`'s companion
 * `(convert N)` / body-style number, and this steps through them.
 *
 * Body styles are numbered from 1, and a unit drawn with body style 0 belongs
 * to every style, which is why the count is the highest number any unit
 * declares rather than how many units there are.
 */

import type { LibSymbol, Schematic, SchSymbol } from '../types.js';
import { refId } from './hittest.js';
import type { EditCommand } from './command.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';

/**
 * `LIB_SYMBOL::GetBodyStyleCount`: the highest body style any unit declares, or
 * 1 when none declares one. Style 0 means "common to all styles" and does not
 * count as a style of its own.
 */
export function bodyStyleCount(lib: LibSymbol | undefined): number {
  if (!lib) return 1;
  return Math.max(1, ...lib.units.map((u) => u.bodyStyle));
}

/** Whether the symbol has an alternate body style to switch to. */
export const hasAlternateBodyStyle = (lib: LibSymbol | undefined): boolean =>
  bodyStyleCount(lib) > 1;

/**
 * Step the selected symbols to their next body style, wrapping back to 1.
 *
 * Symbols with only one body style are skipped rather than reset to 1: a mixed
 * selection should not silently renumber the ones that had nothing to cycle.
 */
export function cycleBodyStyle(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: Map<string, LibSymbol>,
): EditCommand | null {
  const next = new Map<number, number>();
  doc.symbols.forEach((s, i) => {
    if (!ids.has(refId('symbol', s.uuid, i))) return;
    const count = bodyStyleCount(libById.get(schSymbolLibraryName(s)));
    if (count < 2) return;
    // Numbered from 1, wrapping past the last.
    const n = s.bodyStyle + 1 > count ? 1 : s.bodyStyle + 1;
    if (n !== s.bodyStyle) next.set(i, n);
  });
  if (next.size === 0) return null;

  return {
    label: 'Change Body Style',
    apply(d: Schematic): Schematic {
      return {
        ...d,
        symbols: d.symbols.map((s, i) => {
          const n = next.get(i);
          return n === undefined ? s : { ...s, bodyStyle: n };
        }),
      };
    },
    invert(before: Schematic): EditCommand {
      return {
        label: 'Change Body Style',
        apply: (d: Schematic): Schematic => ({
          ...d,
          symbols: d.symbols.map((s, i) =>
            next.has(i) ? { ...s, bodyStyle: before.symbols[i]!.bodyStyle } : s,
          ),
        }),
        invert: () => cycleBodyStyle(doc, ids, libById)!,
      };
    },
  };
}

/** Set one symbol's body style outright (the properties dialog's checkbox). */
export function setBodyStyle(index: number, bodyStyle: number): EditCommand {
  return {
    label: 'Change Body Style',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        symbols: doc.symbols.map((s: SchSymbol, i) => (i === index ? { ...s, bodyStyle } : s)),
      };
    },
    invert(before: Schematic): EditCommand {
      return setBodyStyle(index, before.symbols[index]!.bodyStyle);
    },
  };
}
