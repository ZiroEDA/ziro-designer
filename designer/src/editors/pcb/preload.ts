// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pcbnew end of `IFACE::PreloadLibraries` (pcbnew/pcbnew.cpp:772).
 *
 * `PCB_EDIT_FRAME::OpenProjectFiles` fires it as the project is switched, just
 * before the board itself is read (pcbnew/files.cpp:605-612):
 *
 *     Kiface().PreloadLibraries( &Kiway() );
 *     Pgm().PreloadDesignBlockLibraries( &Kiway() );
 *
 * so by the time the board is on screen the footprint libraries are resident —
 * which is why `Update Footprints from Library`, the footprint chooser and the
 * CvPcb assignment list never wait upstream.
 *
 * The work list is the same substitution the symbol side makes: the hosted set
 * is 155 libraries and 15 435 footprint files, so what is made resident is the
 * name index plus every footprint the board actually places. See
 * libraryPreload.ts.
 */

import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { preloadBundle, preloadLibraries, workQueueAdapter } from '../../libraryPreload.js';
import { footprintPreloadWork } from '../../widgets/footprint_list.js';

/** Every footprint LIB_ID on the board — `FOOTPRINT::GetFPID`. */
export function placedFootprintIds(aBoard: BOARD): string[] {
  const ids = new Set<string>();

  for (const fp of aBoard.Footprints()) {
    const id = fp.GetFPID();

    if (id.GetLibNickname() !== '') ids.add(id.Format());
  }

  return [...ids];
}

/**
 * Fire the footprint preload for a freshly opened board. Not awaited, and on a
 * `setTimeout(0)` rather than an idle callback, for the reason spelled out in
 * the schematic's `preloadSchematicLibraries`.
 */
export function preloadBoardLibraries(aBoard: BOARD): void {
  const work = footprintPreloadWork(placedFootprintIds(aBoard));
  setTimeout(() => {
    // The stock footprint catalogue first, as one object; the preload below
    // then reads it locally, or falls through to the network without it.
    void preloadBundle('footprints').then(() =>
      preloadLibraries('footprints', workQueueAdapter(work)),
    );
  }, 0);
}
