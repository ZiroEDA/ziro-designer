// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where Change Symbols / Update Symbols from Library gets the parts it compares
 * against.
 *
 * `DIALOG_CHANGE_SYMBOLS::processSymbols` resolves every lib_id through the
 * symbol library table — `SCH_SYMBOL::ResolveLibSymbol`, which asks
 * `SCH_IO_MGR`, not the screen. That is the whole point of the command: the
 * schematic's `lib_symbols` block is the thing being brought back into line, so
 * it cannot also be the authority on what "correct" looks like.
 *
 * Ours passed the editor's `hierarchyLibs`, whose first term is
 *
 *     const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]))
 *
 * — the cache itself. Every symbol was therefore compared against a copy of
 * itself, so the command could only ever report "no changes", whatever was
 * wrong with the cache.
 *
 * That went unnoticed because `changeSymbols` is tested by handing it a good
 * library directly. The engine was right; the wiring never asked a library
 * anything. This module is that wiring, in a shape a test can reach.
 */
import type { LibSymbol } from '@ziroeda/eeschema';

/** Loads one symbol from the library, or undefined when it holds no such part. */
export type SymbolLoader = (library: string, symbolName: string) => Promise<LibSymbol | undefined>;

/**
 * The parts to compare against, for every `lib_id` placed on `sheets`.
 *
 * `fallback` is the document's own cache. A symbol the library no longer has
 * keeps its cached copy rather than vanishing, which is what leaves
 * `changeSymbols` free to report it as missing — upstream's "not found in any
 * library" row — instead of silently emptying the placement.
 */
export async function repairSourceLibs(
  libIds: Iterable<string>,
  load: SymbolLoader,
  fallback: ReadonlyMap<string, LibSymbol>,
): Promise<Map<string, LibSymbol>> {
  const libs = new Map(fallback);
  await Promise.all(
    [...new Set(libIds)].map(async (libId) => {
      const sep = libId.indexOf(':');
      // An unqualified id names no library to ask, so the cache is all there is.
      if (sep < 0) return;
      const fromLib = await load(libId.slice(0, sep), libId.slice(sep + 1)).catch(() => undefined);
      if (fromLib) libs.set(libId, fromLib);
    }),
  );
  return libs;
}
