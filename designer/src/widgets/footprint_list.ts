// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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
  /**
   * Distinct numbered pads per footprint, parallel to `footprints`.
   *
   * Absent on an index generated before this field existed, and the pin-count
   * filter degrades to "no filtering" rather than to "nothing matches" — the
   * same graceful shape the power flag uses. It only takes effect once
   * `tools/libraries/upload.mjs` has regenerated the index.
   *
   * Counted the way `FOOTPRINT_INFO::GetUniquePadCount` does: distinct pad
   * *numbers*, so a two-pad SMD resistor is 2 and the unnumbered mechanical
   * pads on a connector shell add nothing.
   */
  pads?: number[];
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
 * `FOOTPRINT_FILTER` over the index: a footprint is offered when it matches ANY
 * of the symbol's `fp_filters` globs (`FilterPattern`) **and**, when a pin
 * count is given, has that many distinct numbered pads (`FilterByPinCount`).
 * Results are "Lib:Name" ids, capped at `max` (upstream `m_max_items`).
 *
 * The two filters are independent, which is the part that is easy to get
 * wrong. Upstream offers pin-count-matched footprints for a symbol with **no**
 * `fp_filters` at all — so an empty glob list plus a pin count is not "match
 * nothing", it is "match on pins alone". Without a pin count an empty glob
 * list still matches nothing, because then there is no criterion left.
 */
export function filterFootprints(
  index: readonly FpIndexEntry[],
  filters: readonly string[],
  max = 400,
  pinCount?: number,
): string[] {
  const compiled = filters.map(compileFilter).filter((f) => f !== null);
  const byPins = pinCount !== undefined && pinCount > 0;
  if (compiled.length === 0 && !byPins) return [];
  const out: string[] = [];
  for (const lib of index) {
    for (const [i, name] of lib.footprints.entries()) {
      const id = `${lib.name}:${name}`;
      if (compiled.length > 0 && !compiled.some((f) => f.re.test(f.withLib ? id : name))) continue;
      if (byPins) {
        const pads = lib.pads?.[i];
        // An index without pad counts cannot answer, so it does not veto:
        // filtering everything out would be worse than not filtering.
        if (pads !== undefined && pads !== pinCount) continue;
      }
      out.push(id);
      if (out.length >= max) return out;
    }
  }
  return out;
}
