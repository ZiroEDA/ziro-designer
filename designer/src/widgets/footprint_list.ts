// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The hosted footprint libraries' I/O: their index (what
 * `FOOTPRINT_LIST_IMPL::ReadFootprintIndex` builds the footprint list from -
 * pcbnew/footprint_info_impl.ts) and lazy per-footprint `.kicad_mod` fetches.
 * The list, the filter and pcbnew's filterFootprints are KiCad's classes in
 * common/footprint_info.ts, common/footprint_filter.ts and pcbnew/pcbnew.ts.
 *
 * Deployments serve the full KiCad footprint set from the same hosted bucket
 * as the symbol libraries (FOOTPRINTS_BASE / VITE_FOOTPRINTS_URL).
 */
import type { PcbFootprint } from '@ziroeda/pcbnew';
import type { FootprintIndexLibrary } from '@ziroeda/pcbnew/footprint_info_impl.js';
import { footprintText } from '../libraryBundleStore.js';
import { fetchLibraryIndex, libraryBase } from '../libraryHosts.js';
import { trackLibraryLoad } from './library_loading.js';
import { parseFootprint } from '../editors/footprint/footprintBoard.js';

let indexPromise: Promise<FootprintIndexLibrary[]> | null = null;

/** Load the footprint-library index (library → footprint names). */
export function loadFootprintIndex(): Promise<FootprintIndexLibrary[]> {
  if (!indexPromise) {
    indexPromise = trackLibraryLoad(
      'footprints',
      'Loading footprint libraries...',
      fetchLibraryIndex<FootprintIndexLibrary>('footprints'),
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
      `Loading ${lib}...`,
      // The resident catalogue first — it arrives as one object at project
      // open. Null means this device has no bundle yet, and the fetch is still
      // the answer, so the network path below is never removed.
      footprintText(lib, name)
        .then(async (resident) => {
          if (resident !== null) return resident;
          const r = await fetch(
            `${libraryBase.footprints}/${encodeURIComponent(lib)}.pretty/${encodeURIComponent(name)}.kicad_mod`,
          );
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

/**
 * `FOOTPRINT_LIBRARY_ADAPTER`'s side of `IFACE::PreloadLibraries`
 * (pcbnew/pcbnew.cpp:772) — the work list the "Loading Footprint Libraries"
 * background job runs. The symbol counterpart is `symbolPreloadWork`
 * (editors/schematic/symbols/index.ts) and the reasoning is the same one:
 * upstream reads every table row off local disk, ours would be 155 hosted
 * libraries and 15 435 footprint files, so what is made resident is the index
 * plus every footprint the open design assigns.
 *
 * A LIB_ID with no library part is dropped; `loadFootprint` answers `null` for
 * one anyway, and counting a guaranteed non-fetch against the gauge would make
 * the preload look like it did more work than it did.
 */
export function footprintPreloadWork(fpIds: Iterable<string>): (() => Promise<unknown>)[] {
  const work: (() => Promise<unknown>)[] = [() => loadFootprintIndex()];
  const seen = new Set<string>();
  for (const fpId of fpIds) {
    const sep = fpId.indexOf(':');
    if (sep <= 0 || sep === fpId.length - 1) continue;
    if (seen.has(fpId)) continue;
    seen.add(fpId);
    work.push(() => loadFootprint(fpId));
  }
  return work;
}
