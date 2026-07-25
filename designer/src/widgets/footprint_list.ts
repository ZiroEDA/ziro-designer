/**
 * The global footprint list backing the chooser widgets: library/footprint
 * names from the hosted libraries' index, lazy per-footprint `.kicad_mod`
 * fetches, and the symbol footprint-filter matching. Mirrors
 * kicad/common/footprint_info.cpp (FOOTPRINT_LIST) and
 * kicad/common/footprint_filter.cpp (FOOTPRINT_FILTER).
 *
 * Deployments serve the full KiCad footprint set from the same hosted bucket
 * as the symbol libraries (FOOTPRINTS_BASE / VITE_FOOTPRINTS_URL).
 */
import type { PcbFootprint } from '@ziroeda/pcbnew';
import { fetchLibraryIndex, libraryBase } from '../libraryHosts.js';
import { trackLibraryLoad } from './library_loading.js';
import { parseFootprint } from '../editors/footprint/footprintBoard.js';

export interface FpIndexEntry {
  name: string;
  footprints: string[];
}

let indexPromise: Promise<FpIndexEntry[]> | null = null;

/** Load the footprint-library index (library → footprint names). */
export function loadFootprintIndex(): Promise<FpIndexEntry[]> {
  if (!indexPromise) {
    indexPromise = trackLibraryLoad(
      'footprints',
      'Loading footprint libraries…',
      fetchLibraryIndex<FpIndexEntry>('footprints'),
    );
  }
  return indexPromise;
}

const fpCache = new Map<string, Promise<PcbFootprint | null>>();

/** Fetch + parse one footprint by its LIB_ID text ("Library:Name"). */
export function loadFootprint(libId: string): Promise<PcbFootprint | null> {
  let p = fpCache.get(libId);
  if (!p) {
    const sep = libId.indexOf(':');
    if (sep <= 0) return Promise.resolve(null);
    const lib = libId.slice(0, sep);
    const name = libId.slice(sep + 1);
    p = trackLibraryLoad(
      'footprints',
      `Loading ${lib}…`,
      fetch(
        `${libraryBase.footprints}/${encodeURIComponent(lib)}.pretty/${encodeURIComponent(name)}.kicad_mod`,
      )
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then((text) => parseFootprint(text))
        .catch(() => null),
    );
    fpCache.set(libId, p);
  }
  return p;
}

/** One fp_filter glob compiled to an anchored matcher (EDA_PATTERN_MATCH_WILDCARD_ANCHORED). */
function compileFilter(pattern: string): { withLib: boolean; re: RegExp } | null {
  const withLib = pattern.includes(':');
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  try {
    return { withLib, re: new RegExp(`^${escaped}$`, 'i') };
  } catch {
    return null;
  }
}

/**
 * FOOTPRINT_FILTER::FilterPattern — footprints whose name (or "Lib:Name" for
 * patterns containing a colon) matches ANY of the symbol's fp_filters globs.
 * Results are "Lib:Name" ids, capped at `max` (upstream m_max_items).
 */
export function filterFootprints(
  index: readonly FpIndexEntry[],
  filters: readonly string[],
  max = 400,
): string[] {
  const compiled = filters.map(compileFilter).filter((f) => f !== null);
  if (compiled.length === 0) return [];
  const out: string[] = [];
  for (const lib of index) {
    for (const name of lib.footprints) {
      const id = `${lib.name}:${name}`;
      if (compiled.some((f) => f.re.test(f.withLib ? id : name))) {
        out.push(id);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}
