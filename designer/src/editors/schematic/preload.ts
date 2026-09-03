// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The eeschema end of `IFACE::PreloadLibraries` — what
 * `SCH_EDIT_FRAME::OpenProjectFiles` schedules once a schematic has finished
 * loading (eeschema/files-io.cpp:857-864) and what `LoadProject` schedules
 * after the Open Project dialog closes (eeschema/sch_edit_frame.cpp:1492-1499).
 * Both are:
 *
 *     CallAfter( [&]()
 *         {
 *             KIFACE* schface = Kiway().KiFACE( KIWAY::FACE_SCH );
 *             schface->PreloadLibraries( &Kiway() );
 *             Pgm().PreloadDesignBlockLibraries( &Kiway() );
 *         } );
 *
 * — deferred, not awaited, and fired by *opening a project* rather than by any
 * tool. (`PreloadDesignBlockLibraries` has no counterpart here; we have no
 * design blocks.)
 *
 * Upstream schedules only the symbol face from eeschema. It gets footprints
 * anyway, because `KICAD_MANAGER_FRAME::LoadProject` (kicad/kicad_manager_frame.cpp:539-549)
 * fires both faces when the project manager opens a project, and pcbnew's own
 * `PreloadLibraries` runs when the board opens. Ours has no separate project
 * manager process, so the schematic frame does what the manager would: both.
 * That is what makes the footprint column of the symbol chooser, CvPcb's
 * assignment list and ERC's footprint tests stop waiting mid-work.
 */

import type { Schematic } from '@ziroeda/eeschema';
import { preloadBundle, preloadLibraries, workQueueAdapter } from '../../libraryPreload.js';
import { symbolPreloadWork } from './symbols/index.js';
import { terminatePreloadPool } from './symbols/preload_pool.js';
import { footprintPreloadWork } from '../../widgets/footprint_list.js';

/** Every symbol LIB_ID placed anywhere in the hierarchy. */
export function placedSymbolIds(docs: Iterable<Schematic>): string[] {
  const ids = new Set<string>();
  for (const doc of docs) for (const sym of doc.symbols) ids.add(sym.libId);
  return [...ids];
}

/**
 * Every footprint LIB_ID the hierarchy assigns.
 *
 * The Footprint field is where the assignment lives (`SCH_SYMBOL`'s
 * `FIELD_T::FOOTPRINT`); an empty one is an unassigned symbol, and one without
 * a `:` cannot name a library, so neither is a fetch.
 */
export function assignedFootprintIds(docs: Iterable<Schematic>): string[] {
  const ids = new Set<string>();
  for (const doc of docs) {
    for (const sym of doc.symbols) {
      const fp = sym.fields.find((f) => f.key === 'Footprint')?.value ?? '';
      if (fp.includes(':')) ids.add(fp);
    }
  }
  return [...ids];
}

/**
 * Fire both preloads for a freshly opened schematic project.
 *
 * Deliberately not awaited by its callers, and deliberately not scheduled on
 * `requestIdleCallback`: `CallAfter` runs at the *next* event-loop turn, not
 * when the browser next feels idle, and a preload that waits for idle on a
 * busy first paint is a preload the user out-races.
 */
export function preloadSchematicLibraries(docs: Iterable<Schematic>): void {
  const all = [...docs];
  const footprints = footprintPreloadWork(assignedFootprintIds(all));
  setTimeout(() => {
    // The stock catalogue first, as one object per kind. Everything below then
    // reads it out of IndexedDB instead of fetching library by library; when
    // there is no bundle it simply falls through to the network, unchanged.
    void preloadBundle('symbols').then(() =>
      // Symbols: every library, which needs the index first because the index is
      // our library table. Awaiting it here rather than making it a work item
      // keeps the gauge counting libraries, as `m_loadTotal = rows.size()` does.
      symbolPreloadWork()
        .then((symbols) => preloadLibraries('symbols', workQueueAdapter(symbols)))
        // `GetKiCadThreadPool().purge(); .wait();` (common/single_top.cpp:93-94).
        // Each parse worker is a whole JS realm with our parser instantiated in
        // it, and nothing else uses the pool once the preload has drained.
        .finally(terminatePreloadPool),
    );
    void preloadBundle('footprints').then(() =>
      preloadLibraries('footprints', workQueueAdapter(footprints)),
    );
  }, 0);
}
