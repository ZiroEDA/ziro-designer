// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol library access.
 *
 * The full set of (combined) KiCad symbol libraries lives under `public/symbols`
 * as static assets, a names index (`index.json`, loaded up front for search) and
 * one `<Library>.kicad_sym` per library (fetched and parsed on demand when a symbol
 * is placed). This keeps the JS bundle small while making thousands of real KiCad
 * symbols available. They are read natively with the same parser as schematics.
 */
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib, type LibSymbol } from '@ziroeda/eeschema';
import { searchTerm, type SearchTerm } from '@ziroeda/common';
import { fetchLibraryIndex, libraryBase } from '../../../libraryHosts.js';
import { trackLibraryLoad } from '../../../widgets/library_loading.js';

export interface LibIndexEntry {
  name: string;
  count: number;
  symbols: string[];
  /**
   * Names of the power symbols in this library, when the index carries them.
   *
   * `LIB_SYMBOL::IsPower` is a property of the symbol, not of the library it
   * lives in — a power symbol can sit anywhere and a "power"-named library can
   * hold ordinary parts. Knowing it without loading the library needs the flag
   * in the index, which is what this is. Optional so an index generated before
   * it existed still loads; `isPowerSymbol` falls back in that case.
   *
   * **Absent for two unrelated reasons**, which is the whole reason
   * `powerSymbolTest` exists: the generator omits the key for a library with no
   * power symbols at all (`...(power.length ? { power } : {})`, to keep the
   * index small), and an index written before the flag existed has it nowhere.
   */
  power?: string[];
  /**
   * Unit count per symbol, for the symbols that have more than one.
   *
   * The chooser needs this before anything is fetched. KiCad builds a symbol's
   * unit rows when it builds the node (`LIB_TREE_NODE_ITEM::Update` calling
   * `AddUnit`), so a multi-unit part shows its expander arrow as soon as the
   * tree does. Without the count in the index the only way to know was to
   * download the symbol, so the arrow appeared only after the row was clicked
   * and the fetch came back.
   *
   * Absent for a library with no multi-unit parts, and absent altogether from
   * an index generated before the field existed — in which case the tree falls
   * back to discovering units on selection, as it used to.
   */
  units?: Record<string, number>;
}

/**
 * Whether a symbol is a power symbol, judged from **one** index entry.
 *
 * With the flag this is exact. Without it, the only thing available before the
 * library loads is the library's *name*, which is a guess in both directions:
 * an ordinary part in a library called "power" passes, and a real power symbol
 * elsewhere is hidden until its library is read. KiCad has no such problem
 * because it holds the whole index in memory; we load lazily on purpose, so the
 * flag has to travel with the index.
 *
 * Prefer `powerSymbolTest`, which can tell the two kinds of absence apart. This
 * is the primitive it falls back to.
 */
export function isPowerSymbol(entry: LibIndexEntry, symbolName: string): boolean {
  if (entry.power) return entry.power.includes(symbolName);
  return /power/i.test(entry.name);
}

/**
 * The power test for a whole index — the one the chooser should use.
 *
 * Reading `power` per entry cannot distinguish "this library has no power
 * symbols" from "this index predates the flag", because the generator writes
 * the same absence for both. The index as a whole can: if *any* library reports
 * power symbols then the generator knew about the flag, so a library without
 * the key has none, and the name guess must not be consulted.
 *
 * That distinction is not academic. KiCad's standard set ships **four**
 * libraries matching `/power/i`, and only one of them holds power symbols:
 *
 *     power.kicad_sym               101 power symbols  -> has the key
 *     Power_Management.kicad_sym      0                -> key omitted
 *     Power_Protection.kicad_sym      0                -> key omitted
 *     Power_Supervisor.kicad_sym      0                -> key omitted
 *
 * so falling back per entry put every ordinary power-management IC into the
 * Place Power Port chooser — the exact complaint the flag was added to fix,
 * surviving in the one case the "omit when empty" optimisation created.
 *
 * Returns a closure so the index-wide scan runs once rather than per symbol.
 */
export function powerSymbolTest(
  index: readonly LibIndexEntry[],
): (entry: LibIndexEntry, symbolName: string) => boolean {
  const flagged = index.some((e) => e.power !== undefined);
  return (entry, symbolName) => {
    if (entry.power) return entry.power.includes(symbolName);
    return flagged ? false : isPowerSymbol(entry, symbolName);
  };
}

// The hosted symbol library set, or the bundled subset when it is unreachable
// (see libraryHosts.ts).
/** Where the hosted (global-table stand-in) symbol libraries are served from. */
export const symbolsBase = (): string => libraryBase.symbols;

let indexPromise: Promise<LibIndexEntry[]> | null = null;
/** Load the library index (library names + their symbol names) for search. */
export function loadIndex(): Promise<LibIndexEntry[]> {
  if (!indexPromise)
    indexPromise = trackLibraryLoad(
      'symbols',
      'Loading symbol libraries...',
      fetchLibraryIndex<LibIndexEntry>('symbols'),
    );
  return indexPromise;
}

const libCache = new Map<string, Promise<Map<string, LibSymbol>>>();
function loadLibrary(name: string): Promise<Map<string, LibSymbol>> {
  let p = libCache.get(name);
  if (!p) {
    // Tracked across the whole fetch+parse, so the chooser's progress row
    // stays up until the symbols are actually in the tree.
    p = trackLibraryLoad(
      'symbols',
      `Loading ${name}...`,
      fetch(`${symbolsBase()}/${name}.kicad_sym`)
        .then((r) => {
          // Without this the body of a 404 or an error page reached the parser,
          // and a missing library surfaced as `Expected a top-level list
          // starting with "("` — a message that says nothing about which
          // library failed, or that the failure was a fetch at all.
          if (!r.ok) {
            throw new Error(`symbol library "${name}" could not be loaded (HTTP ${r.status})`);
          }
          return r.text();
        })
        .then((text) => {
          const map = new Map<string, LibSymbol>();
          for (const sym of readSymbolLib(parse(text))) {
            // Give it a KiCad-style Library:Name id.
            map.set(sym.libId, { ...sym, libId: `${name}:${sym.libId}` });
          }
          return map;
        }),
    );
    libCache.set(name, p);
  }
  return p;
}

/**
 * Whether the host serves one file per symbol.
 *
 * Starts optimistic and is turned off for the session by the first miss that
 * the whole library then answers, which is the signature of a host laid out the
 * old way (the bundled subset under `public/symbols` is exactly that). A miss on
 * a symbol the library does not have either does *not* flip it: that is a
 * missing symbol, not a missing layout, and one bad name must not push every
 * later placement back onto multi-megabyte library fetches.
 */
let perSymbolFiles = true;

/**
 * One symbol's own file: `<base>/<Library>/<Symbol>.kicad_sym`, holding the
 * symbol and the parent chain it extends (see tools/libraries/upload.mjs).
 * Undefined means "not served that way", not "no such symbol".
 *
 * The name is percent-encoded into the path, which the object store decodes
 * back to the key it was uploaded under. 111 of the symbols in the standard set
 * contain a `+`.
 */
async function fetchOneSymbol(library: string, symbolName: string): Promise<LibSymbol | undefined> {
  const url = `${symbolsBase()}/${library}/${encodeURIComponent(symbolName)}.kicad_sym`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const text = await res.text();
  // The file holds the parent chain too, so pick out the one that was asked
  // for; `readSymbolLib` has already flattened it against those parents.
  for (const sym of readSymbolLib(parse(text))) {
    if (sym.libId === symbolName) return { ...sym, libId: `${library}:${sym.libId}` };
  }
  return undefined;
}

const symbolCache = new Map<string, Promise<LibSymbol | undefined>>();

/**
 * Load one symbol by library and name.
 *
 * Fetches just that symbol where the host serves it that way, which is the
 * difference between about a kilobyte and, for Connector_Generic, 7.0 MB of
 * library that is then parsed in full to use one part. Falls back to the whole
 * library, which is also what the library browser and any host without the
 * per-symbol layout use, so nothing depends on the split having happened.
 */
export async function loadSymbol(
  library: string,
  symbolName: string,
): Promise<LibSymbol | undefined> {
  // Already paid for the whole library (the browser opened it, or an earlier
  // fallback): read it from there rather than fetching again.
  const whole = libCache.get(library);
  if (whole) return (await whole).get(symbolName);
  if (!perSymbolFiles) return (await loadLibrary(library)).get(symbolName);

  const key = `${library}:${symbolName}`;
  let p = symbolCache.get(key);
  if (!p) {
    p = fetchOneSymbol(library, symbolName)
      .catch(() => undefined) // network or parse failure: let the library answer
      .then(async (sym) => {
        if (sym) return sym;
        const fromLib = (await loadLibrary(library)).get(symbolName);
        // The library has it and the per-symbol path did not, so this host does
        // not serve them individually. Stop asking for the rest of the session.
        if (fromLib) perSymbolFiles = false;
        return fromLib;
      });
    symbolCache.set(key, p);
  }
  return p;
}

/**
 * `SYMBOL_LIBRARY_ADAPTER`'s side of `IFACE::PreloadLibraries`
 * (eeschema/eeschema.cpp:487) — the work list the "Loading Symbol Libraries"
 * background job runs.
 *
 * Upstream's adapter loads every row of the symbol library table. Ours cannot:
 * the hosted set is 223 libraries totalling 219.7 MB, or 22 778 individual
 * symbol files, both measured against the bucket. What it loads instead is the
 * name index plus the library copy of every symbol the open design places —
 * the set upstream's chooser reads synchronously when it builds its "Recently
 * Used" and "Already Placed" groups, and the set ERC's symbol comparison walks.
 * See libraryPreload.ts for why that substitution is the faithful answer.
 *
 * The index counts as one work item so the gauge moves for a design with few
 * symbols, and because it genuinely is the largest single fetch of the set.
 *
 * A `libId` with no library part cannot be answered by any hosted library, so
 * it is dropped rather than turned into a certain 404.
 */
export function symbolPreloadWork(libIds: Iterable<string>): (() => Promise<unknown>)[] {
  const work: (() => Promise<unknown>)[] = [() => loadIndex()];
  const seen = new Set<string>();
  for (const libId of libIds) {
    const sep = libId.indexOf(':');
    if (sep <= 0 || sep === libId.length - 1) continue;
    if (seen.has(libId)) continue;
    seen.add(libId);
    const library = libId.slice(0, sep);
    const name = libId.slice(sep + 1);
    work.push(() => loadSymbol(library, name));
  }
  return work;
}

/**
 * Every symbol of one library, in file order, SYMBOL_LIBRARY_ADAPTER::GetSymbols,
 * which the Symbol Library Browser needs whole so it can filter on keywords,
 * description and pin count rather than just names.
 */
export async function loadLibrarySymbols(library: string): Promise<LibSymbol[]> {
  return [...(await loadLibrary(library)).values()];
}

/** LIBRARY_MANAGER::GetFullURI, where a library nickname's file actually lives. */
export function libraryUri(library: string): string {
  return `${symbolsBase()}/${library}.kicad_sym`;
}

/** A symbol's `(property ...)` value, or '', LIB_SYMBOL::GetDescription/GetKeyWords. */
export function symbolProperty(sym: LibSymbol, key: string): string {
  return sym.properties.find((p) => p.key === key)?.value ?? '';
}

/**
 * LIB_SYMBOL::cachePinCount, pins of every unit in the base body style.
 * (Upstream also folds stacked pins in through GetStackedPinCount; the parsed
 * library carries each stacked pin separately, so counting them is the same.)
 */
export function symbolPinCount(sym: LibSymbol): number {
  let count = 0;
  for (const u of sym.units) if (u.bodyStyle === 0 || u.bodyStyle === 1) count += u.pins.length;
  return count;
}

/** LIB_SYMBOL::cacheSearchTerms, the weighted terms a filter scores against. */
export function symbolSearchTerms(sym: LibSymbol): SearchTerm[] {
  const [nickname = '', name = ''] = splitLibId(sym.libId);
  const keywords = symbolProperty(sym, 'ki_keywords');
  const terms = [
    searchTerm(nickname, 4),
    searchTerm(name, 8, true),
    searchTerm(sym.libId, 16, true),
    ...keywords
      .split(/\s+/)
      .filter(Boolean)
      .map((kw) => searchTerm(kw, 4)),
    searchTerm(keywords, 1),
    searchTerm(symbolProperty(sym, 'Description'), 1),
  ];
  const footprint = symbolProperty(sym, 'Footprint');
  if (footprint) terms.push(searchTerm(footprint, 1));
  return terms;
}

/** "Library:Name" -> [library, name]; a bare name has no library part. */
function splitLibId(libId: string): [string, string] {
  const at = libId.indexOf(':');
  return at < 0 ? ['', libId] : [libId.slice(0, at), libId.slice(at + 1)];
}
