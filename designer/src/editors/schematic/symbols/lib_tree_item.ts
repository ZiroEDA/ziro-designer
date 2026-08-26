// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIB_TREE_ITEM` (include/lib_tree_item.h:40-88) — everything the library tree
 * asks a symbol for, and nothing else:
 *
 *     GetLIB_ID  GetName  GetLibNickname  GetDesc  GetChooserFields
 *     GetSearchTerms  IsRoot  IsPowerSymbol  GetFootprint  GetPinCount
 *     GetSubUnitCount
 *
 * Upstream's `LIB_SYMBOL` implements this on the resident symbol, because in
 * KiCad the whole library set is already in memory: `SYMBOL_TREE_MODEL_ADAPTER`
 * holds `LIB_SYMBOL*` and the tree calls straight through.
 *
 * We cannot. A parsed `.kicad_sym` retains **21.1x** its source text as JS
 * objects (measured over 35 libraries with `--expose-gc`, qa/perf), so the 230 MB
 * hosted set would be about 4.9 GB resident — past what V8 gives a tab, which is
 * why keeping every library made the preload thrash rather than merely take a
 * while. So the preload keeps the interface and drops the symbol: this is the
 * projection, it is what crosses back from the parse worker, and the full
 * `LIB_SYMBOL` is fetched one at a time by `loadSymbol` when something actually
 * needs to draw or place it.
 *
 * `GetSearchTerms` is not a field here. It is *derived* — nickname 4, name 8,
 * LIB_ID 16, each keyword token 4, the keyword string 1, the description 1 and
 * the footprint 1 (eeschema/lib_symbol.cpp:160-183) — so carrying `keywords`
 * and letting the tree build the terms is the same data without the duplication.
 */
import type { LibSymbol } from '@ziroeda/eeschema';

/** One symbol, reduced to what `LIB_TREE_ITEM` exposes. */
export interface LibTreeItem {
  /** `GetName()`, the item half of the LIB_ID. */
  name: string;
  /** `GetDesc()`, the `Description` property. */
  description: string;
  /** `ki_keywords`, which `GetSearchTerms` tokenises. */
  keywords: string;
  /** `GetFootprint()`, the `Footprint` property. */
  footprint: string;
  /** `IsPowerSymbol()`. */
  isPower: boolean;
  /** `IsRoot()` — false for a symbol that `extends` another. */
  isRoot: boolean;
  /** `GetPinCount()`. */
  pinCount: number;
  /** `GetSubUnitCount()`. */
  unitCount: number;
  /** `GetChooserFields()`, the `(show_in_chooser yes)` properties. */
  chooserFields: [string, string][];
}

/** A symbol's `(property ...)` value, or '' — `LIB_SYMBOL::GetDescription` etc. */
export function symbolProperty(sym: LibSymbol, key: string): string {
  return sym.properties.find((p) => p.key === key)?.value ?? '';
}

/** `LIB_SYMBOL::GetPinCount`, the unit-1 (or common) graphical pins. */
export function libSymbolPinCount(sym: LibSymbol): number {
  return sym.units.reduce((n, u) => n + (u.unit === 0 || u.unit === 1 ? u.pins.length : 0), 0);
}

/** `LIB_SYMBOL::GetSubUnitCount`, the distinct numbered units. */
export function libSymbolUnitCount(sym: LibSymbol): number {
  return new Set(sym.units.map((u) => u.unit).filter((u) => u > 0)).size;
}

/**
 * Project a parsed symbol onto the interface above.
 *
 * `name` is the bare item name: a symbol read straight out of a `.kicad_sym`
 * carries its own name in `libId` with no nickname, and one that has already
 * been through `loadLibrary` carries "Nickname:Name".
 */
export function libTreeItem(sym: LibSymbol): LibTreeItem {
  const chooserFields: [string, string][] = [];
  for (const f of sym.properties) if (f.showInChooser) chooserFields.push([f.key, f.value]);
  return {
    name: sym.libId.includes(':') ? sym.libId.slice(sym.libId.indexOf(':') + 1) : sym.libId,
    description: symbolProperty(sym, 'Description'),
    keywords: symbolProperty(sym, 'ki_keywords'),
    footprint: symbolProperty(sym, 'Footprint'),
    isPower: sym.isPower,
    isRoot: !sym.extends,
    pinCount: libSymbolPinCount(sym),
    unitCount: libSymbolUnitCount(sym),
    chooserFields,
  };
}
