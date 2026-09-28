// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The program's side of the Footprint Editor: what `pcbnew`'s footprint
 * modules ask of the app they run in, wired to what `designer` actually has.
 * `pcbnew` never imports `designer`; this is the one file that answers it,
 * the way `editors/schematic/cvpcb_app.tsx` answers `CVPCB_APP`.
 */
import type { FOOTPRINT_LIBRARY_IO } from '@ziroeda/pcbnew/footprint_libraries_utils.js';
import { footprintText } from '../../libraryBundleStore.js';
import { libraryBase } from '../../libraryHosts.js';
import { settings } from '../../prefs/settings.js';
import { trackLibraryLoad } from '../../widgets/library_loading.js';

// The hosted footprint library set, or the bundled subset when it is
// unreachable (see libraryHosts.ts).
export const footprintsBase = (): string => libraryBase.footprints;

/** `FootprintLibraryManager`'s storage: the resident catalogue, the hosted
 *  library set, and `pcbnew.json`'s flip direction. */
export const FP_LIBRARY_IO: FOOTPRINT_LIBRARY_IO = {
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
