// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROJECT_PCB::FootprintLibAdapter( &Prj() )` for the windows that only read
 * the hosted footprint libraries — the chooser's preview and 3D pane: one
 * FOOTPRINT_LIBRARY_STORE for the program, its library names from the hosted
 * index, each footprint's file fetched the first time it is asked for.
 */
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import {
  FOOTPRINT_LIBRARY_STORE,
  type FOOTPRINT_LIBRARY_STORE_IO,
} from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { loadFootprintIndex } from '../../widgets/footprint_list.js';
import { footprintText } from '../../libraryBundleStore.js';
import { libraryBase } from '../../libraryHosts.js';
import { settings } from '../../prefs/settings.js';
import { trackLibraryLoad } from '../../widgets/library_loading.js';

// The hosted footprint library set, or the bundled subset when it is
// unreachable (see libraryHosts.ts).
export const footprintsBase = (): string => libraryBase.footprints;

/** FOOTPRINT_LIBRARY_STORE's storage: the resident catalogue, the hosted
 *  library set, and `pcbnew.json`'s flip direction. */
export const FP_LIBRARY_IO: Pick<FOOTPRINT_LIBRARY_STORE_IO, 'footprintText' | 'flipLeftRight'> = {
  footprintText: (libName, fpName) =>
    // Resident catalogue first; null falls through to the network, which
    // is what a device without a bundle still uses.
    trackLibraryLoad(
      'footprints',
      `Loading ${libName}...`,
      footprintText(libName, fpName).then(async (resident) => {
        if (resident !== null) return resident;
        const r = await fetch(
          `${footprintsBase()}/${encodeURIComponent(libName)}.pretty/${encodeURIComponent(fpName)}.kicad_mod`,
        );
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      }),
    ),
  flipLeftRight: () => settings.pcbnew.editing.flip_left_right,
};

let s_store: FOOTPRINT_LIBRARY_STORE | null = null;
let s_indexed: Promise<void> | null = null;

/** The program's store of hosted footprint libraries, its names loaded. */
export function hostedFootprintLibs(): Promise<FOOTPRINT_LIBRARY_STORE> {
  if (!s_store) s_store = new FOOTPRINT_LIBRARY_STORE(FP_LIBRARY_IO);

  const store = s_store;

  s_indexed ??= loadFootprintIndex()
    .then((idx) => {
      for (const lib of idx) store.AddGlobalLibrary(lib.name, lib.footprints);
    })
    .catch(() => {
      // No index: every lookup answers null, "Footprint not found.".
    });

  return s_indexed.then(() => store);
}

/**
 * `FootprintLibAdapter()->LoadFootprint( nickname, name, false )` by
 * "Library:Name": a fresh copy each time, as upstream's is, or null.
 */
export async function loadLibraryFootprint(
  aLibId: string,
  aKeepUUID = false,
): Promise<FOOTPRINT | null> {
  const id = new LIB_ID();

  if (id.Parse(aLibId) >= 0 || id.GetUniStringLibNickname() === '') return null;

  const store = await hostedFootprintLibs();

  return store.LoadFootprintAsync(
    id.GetUniStringLibNickname(),
    id.GetUniStringLibItemName(),
    aKeepUUID,
  );
}

/** `IFACE::PreloadLibraries`' footprint work: the file made resident, no copy parsed. */
export async function preloadLibraryFootprint(aLibId: string): Promise<void> {
  const id = new LIB_ID();

  if (id.Parse(aLibId) >= 0 || id.GetUniStringLibNickname() === '') return;

  const store = await hostedFootprintLibs();

  await store.FootprintText(id.GetUniStringLibNickname(), id.GetUniStringLibItemName());
}
