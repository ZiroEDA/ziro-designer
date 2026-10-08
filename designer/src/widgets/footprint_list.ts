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
import type { FootprintIndexLibrary } from '@ziroeda/pcbnew/footprint_info_impl.js';
import { fetchLibraryIndex } from '../libraryHosts.js';
import { trackLibraryLoad } from './library_loading.js';

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

/**
 * `FOOTPRINT_LIBRARY_ADAPTER`'s side of `IFACE::PreloadLibraries`
 * (pcbnew/pcbnew.cpp:772) — the work list the "Loading Footprint Libraries"
 * background job runs. The symbol counterpart is `symbolPreloadWork`
 * (editors/schematic/symbols/index.ts) and the reasoning is the same one:
 * upstream reads every table row off local disk, ours would be 155 hosted
 * libraries and 15 435 footprint files, so what is made resident is the index
 * plus every footprint the open design assigns.
 *
 * A LIB_ID with no library part is dropped; the store answers `null` for
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
    // The library store's file cache: the footprint is fetched once and parsed
    // on each LoadFootprint, as upstream's FP_CACHE holds files, not copies.
    work.push(() =>
      import('../editors/pcb/footprint_lib_adapter_app.js').then((m) =>
        m.preloadLibraryFootprint(fpId),
      ),
    );
  }
  return work;
}
