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
import { Reporter } from '@ziroeda/common/src/reporter.js';
import { searchTerm, type SearchTerm } from '@ziroeda/common';
import { fetchLibraryIndex, libraryBase } from '../../../libraryHosts.js';
import { trackLibraryLoad } from '../../../widgets/library_loading.js';
import { libTreeItem, symbolProperty, type LibTreeItem } from './lib_tree_item.js';
import { loadLibraryItemsPooled } from './preload_pool.js';

export type { LibTreeItem } from './lib_tree_item.js';
/** Re-exported so callers keep one import site for symbol access. */
export { symbolProperty, libSymbolPinCount, libSymbolUnitCount } from './lib_tree_item.js';

/**
 * Read a library, saying so when a derived symbol's parent is not in the file.
 *
 * `SCH_IO_KICAD_SEXPR_LIB_CACHE::updateParentSymbolLinks` throws an IO_ERROR
 * there, because a symbol whose `extends` names nothing has no body: every
 * draw item it renders belongs to the parent. We do not refuse the whole
 * library over one bad entry — the other few thousand symbols in it are fine —
 * but it must not pass in silence, because the symptom (a part that draws as
 * its field text and nothing else) says nothing about the cause.
 */
function readLibraryText(name: string, text: string): LibSymbol[] {
  const reporter = new Reporter();
  const symbols = readSymbolLib(parse(text), reporter);
  for (const line of reporter.lines) console.warn(`symbol library "${name}": ${line.message}`);
  return symbols;
}

/** `GetSymbols( lib )`'s map, keyed by the bare item name AddLibraries looks up. */
function itemsByName(items: readonly LibTreeItem[]): Map<string, LibTreeItem> {
  return new Map(items.map((i) => [i.name, i]));
}

export interface LibIndexEntry {
  name: string;
  count: number;
  symbols: string[];
  /**
   * The library's own description, shown against its row in the tree.
   *
   * It is the library TABLE row's, not anything inside the `.kicad_sym`:
   * `libDescription = ( *rowResult )->Description()`
   * (eeschema/symbol_tree_model_adapter.cpp:146), and KiCad ships the 223
   * strings in `template/sym-lib-table`. Optional, because an index generated
   * before the field existed simply has no descriptions and the column stays
   * empty, which is what it did for every library until now.
   */
  descr?: string;
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

/**
 * The libraries that have finished loading — `LOAD_STATUS::LOADED`.
 *
 * `SYMBOL_TREE_MODEL_ADAPTER::AddLibraries` asks
 * `m_adapter->GetLibraryStatus( lib )` for every row and adds only the ones
 * that are LOADED (eeschema/symbol_tree_model_adapter.cpp:130-139); the rest go
 * to `m_pending_load_libraries` and are retried. That test is synchronous, so a
 * pending promise is not enough to answer it and a resolved map is kept beside
 * the cache.
 *
 * What is kept is one {@link LibTreeItem} per symbol, `LIB_TREE_ITEM` being the
 * whole of what the tree asks a symbol for. Upstream keeps the `LIB_SYMBOL`
 * itself; we cannot, because the parsed form retains 21.1x its source text and
 * the hosted set would be ~4.9 GB (see lib_tree_item.ts). Anything that needs
 * the real symbol — the preview, a placement — goes through `loadSymbol`, which
 * fetches that one symbol's own file.
 */
const loadedLibraries = new Map<string, Map<string, LibTreeItem>>();

/** `GetLibraryStatus( lib )->load_status == LOAD_STATUS::LOADED`. */
export function libraryLoaded(name: string): boolean {
  return loadedLibraries.has(name);
}

/**
 * `m_adapter->GetSymbols( lib )` at the point AddLibraries calls it
 * (eeschema/symbol_tree_model_adapter.cpp:148) — synchronous, because the
 * library is already LOADED by the time that line runs. Undefined for a library
 * that is not, which is the same thing as it not being in the tree yet.
 */
export function loadedLibraryItems(name: string): LibTreeItem[] | undefined {
  const map = loadedLibraries.get(name);
  return map ? [...map.values()] : undefined;
}

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
          for (const sym of readLibraryText(name, text)) {
            // Give it a KiCad-style Library:Name id.
            map.set(sym.libId, { ...sym, libId: `${name}:${sym.libId}` });
          }
          return map;
        }),
    ).then((map) => {
      // A library read whole — by the library browser, or by `loadSymbol`
      // falling back — is LOADED for the tree too, so record its items. This is
      // the main-thread path; the preload's is `loadLibraryItemsPooled`.
      loadedLibraries.set(name, itemsByName([...map.values()].map(libTreeItem)));
      return map;
    });
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
  for (const sym of readLibraryText(library, text)) {
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
 * **Every library, as upstream's adapter loads every row of the symbol library
 * table.** This used to load only the index plus the symbols the open design
 * already placed, on the measurement that the hosted set was "223 libraries
 * totalling 219.7 MB". That number was the *uncompressed* size, and it was
 * large only because the bucket stored those objects with no
 * `content-encoding`. Stored gzipped, which they now are, the same 223
 * libraries are **9.7 MB** — Connector_Generic alone goes from 6.6 MB to
 * 214 kB. The objection was to our own headers, not to the data, and the
 * bounded substitution it justified is what made the chooser's search return
 * different results from KiCad's: `LIB_TREE_NODE`'s scoring gives an unloaded
 * library only its own name to match on (lib_tree_model.ts), so a query hit
 * every resident symbol upstream and only the library names here.
 *
 * One work item per library, so the gauge counts what upstream's counts:
 * `m_loadTotal = rows.size()` (library_manager.cpp:1798-1800) is libraries, not
 * bytes. The index is awaited before the list is built rather than being an
 * item in it, because it *is* our library table — upstream knows its row count
 * before the load starts, and so must we.
 *
 * **Each item runs on a worker, as `AsyncLoad` submits each row to the thread
 * pool.** It used to call `loadLibrarySymbols`, which fetches and parses inline:
 * 35 434 ms of main-thread CPU over the hosted set, in 92 tasks longer than
 * 50 ms, worst 2 030 ms (qa/perf/parse_all.bench.ts). That is what made typing
 * and scrolling stall while a project opened.
 */
export async function symbolPreloadWork(): Promise<(() => Promise<unknown>)[]> {
  const index = await loadIndex();
  return index.map((lib) => () => preloadLibraryItems(lib.name));
}

/**
 * One library's worth of `LIB_TREE_ITEM`s, parsed off the main thread, recorded
 * as LOADED.
 *
 * Memoised on `itemsPromises` the way `loadLibrary` is on `libCache`: the
 * preload and a chooser opening over the top of it must not fetch twice.
 */
const itemsPromises = new Map<string, Promise<LibTreeItem[]>>();

export function preloadLibraryItems(library: string): Promise<LibTreeItem[]> {
  let p = itemsPromises.get(library);
  if (!p) {
    p = trackLibraryLoad(
      'symbols',
      `Loading ${library}...`,
      loadLibraryItemsPooled(library, libraryUri(library)),
    ).then((items) => {
      loadedLibraries.set(library, itemsByName(items));
      return items;
    });
    itemsPromises.set(library, p);
  }
  return p;
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
