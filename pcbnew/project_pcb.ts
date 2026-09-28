// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/project_pcb.cpp` / `include/project_pcb.h`: `PROJECT_PCB`, the four
 * static accessors a `PROJECT*` doesn't carry itself — the footprint library
 * adapter, the 3D cache manager, its filename resolver, and cache cleanup.
 *
 * `PROJECT` and `LIBRARY_MANAGER` are not ported here, so three of the four
 * have no `PROJECT_PCB.<Name>( aProject )` shape to port into — each already
 * has a real equivalent living where the object it would have needed to
 * touch already lives, per file:
 *
 * - `FootprintLibAdapter`: `BOARD.GetFootprintLibAdapter`/
 *   `SetFootprintLibAdapter` (`pcbnew/board.ts`) hang the adapter straight off
 *   the `BOARD` — the host builds one (implementing
 *   `pcbnew/footprint_library_adapter.ts`'s `FOOTPRINT_LIBRARY_ADAPTER`) and
 *   sets it, in place of the lazy `LIBRARY_MANAGER`-backed singleton this
 *   file's C++ registers on first call. See that file's own doc comment.
 * - `Get3DCacheManager` / `Cleanup3DCache`: `S3D_CACHE` is not ported either —
 *   `designer/src/editors/pcb/model_cache.ts` replaces its on-disk `.3dc`
 *   cache with an IndexedDB store keyed by the model's own content hash
 *   (`model_cache.ts`'s own doc comment says why: no filesystem, no mtime, no
 *   sidecar file). That file's `cleanup3dCache` is
 *   `PROJECT_PCB::Cleanup3DCache`'s real port, and stays there rather than
 *   here: it depends on that same IndexedDB store, which only exists in the
 *   browser/designer layer `pcbnew` does not (and must not: `qa` and other
 *   non-browser callers use this package too) reach into.
 *
 * `Get3DFilenameResolver` has none of that problem — `FILENAME_RESOLVER`
 * (`common/filename_resolver.ts`) is a plain object, so this is a real move:
 * out of `3d-viewer/component3d.ts`'s local `make3dResolver`, which had no
 * KiCad-named home before this file existed.
 */

import { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { wxGetTempDir } from '@ziroeda/common/wx/filefn.js';

export class PROJECT_PCB {
  private constructor() {}

  /**
   * `PROJECT_PCB::Get3DFilenameResolver` (project_pcb.cpp:93-96): the
   * resolver `Get3DCacheManager` sets up the first time it creates the cache
   * (`Set3DConfigDir`, `SetProgramBase( &Pgm() )`, `SetProject( aProject )`).
   * The config directory only has to exist (it is what builds the
   * search-path list); the settings folder exists on every desktop, and the
   * one directory a page always has is the temp directory.
   */
  static Get3DFilenameResolver(): FILENAME_RESOLVER {
    const resolver = new FILENAME_RESOLVER();
    const pgm = PgmOrNull();
    resolver.Set3DConfigDir(wxGetTempDir());
    resolver.SetProgramBase(pgm);
    resolver.SetProject(pgm ? pgm.GetSettingsManager().Prj() : null);
    return resolver;
  }
}
