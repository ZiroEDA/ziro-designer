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
}

// The hosted symbol library set, or the bundled subset when it is unreachable
// (see libraryHosts.ts).
const symbolsBase = (): string => libraryBase.symbols;

let indexPromise: Promise<LibIndexEntry[]> | null = null;
/** Load the library index (library names + their symbol names) for search. */
export function loadIndex(): Promise<LibIndexEntry[]> {
  if (!indexPromise)
    indexPromise = trackLibraryLoad(
      'symbols',
      'Loading symbol libraries…',
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
      `Loading ${name}…`,
      fetch(`${symbolsBase()}/${name}.kicad_sym`)
        .then((r) => r.text())
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

/** Load one symbol by library and name (fetches+caches the library on demand). */
export async function loadSymbol(
  library: string,
  symbolName: string,
): Promise<LibSymbol | undefined> {
  return (await loadLibrary(library)).get(symbolName);
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
