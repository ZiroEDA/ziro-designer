// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROJECT_SCH` — `eeschema/project_sch.cpp`. Per-project accessors the frame
 * asks for instead of holding itself.
 *
 * Only `LegacySchLibs` has a port, as {@link legacySchLibs}: the project's
 * `<project>-cache.lib`, read on first ask (the Project Rescue Helper, and
 * nothing else here — same as upstream, where it "is only used from the
 * remapping dialog"). It takes the file list and project root name as plain
 * arguments rather than a `PROJECT*`, so it stays a pure function; the caller
 * in `SchematicEditor.tsx` supplies both from its own state.
 *
 * `SchSearchS` (the Eeschema search stack) has no port — there is no
 * filesystem search path to resolve in a browser, every file is already in
 * hand. `SymbolLibAdapter` is ported as {@link SymbolLibAdapter}.
 */

import type { LibSymbol } from './types.js';
import { LIBRARY_TABLE_TYPE } from '@ziroeda/common/libraries/library_table.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import { SYMBOL_LIBRARY_ADAPTER } from './libraries/symbol_library_adapter.js';
import {
  legacyCacheFileNames,
  readLegacySymbolLibrary,
} from './sch_io/kicad_legacy/sch_io_kicad_legacy_lib_cache.js';

/** The shape `legacySchLibs` needs from a project's file list — a structural
 *  subset of `PickedFile` (`designer/.../SchematicEditor.tsx`), so this stays
 *  a pure function with no dependency on that UI-layer type. */
export interface SchLibFile {
  name: string;
  text: string;
}

/**
 * `PROJECT_SCH::LegacySchLibs`: the project's legacy `<project>-cache.lib`,
 * parsed and keyed by the name each symbol (aliases included) is cached
 * under — `LEGACY_SYMBOL_LIB::FindSymbol`'s lookup.
 *
 * A cache that will not parse leaves the map empty and the caller carries on
 * without it, which is what upstream does with the `IO_ERROR`: `AddLibrary`
 * throws, `LoadAllLibraries` catches it, logs "Symbol library '%s' failed to
 * load." and carries on with the libraries it did get.
 */
export function legacySchLibs(
  files: readonly SchLibFile[],
  projectRootFallback: string,
): Map<string, LibSymbol> {
  const names = legacyCacheFileNames(
    files.find((f) => /\.kicad_pro$/i.test(f.name))?.name ?? projectRootFallback,
  );
  const file = names
    .map((n) => files.find((f) => f.name.replace(/\\/g, '/').split('/').pop() === n))
    .find(Boolean);
  if (!file) return new Map();
  try {
    return new Map(readLegacySymbolLibrary(file.text).map((sym) => [sym.libId, sym]));
  } catch (e) {
    console.warn(`Symbol library '${file.name}' failed to load.`, e);
    return new Map();
  }
}

/**
 * `PROJECT_SCH::SymbolLibAdapter( aProject )` (project_sch.cpp:133): the library manager's symbol
 * adapter, registered on first ask.
 */
export function SymbolLibAdapter(_aProject: PROJECT | null): SYMBOL_LIBRARY_ADAPTER {
  const mgr = Pgm().GetLibraryManager();
  const adapter = mgr.Adapter(LIBRARY_TABLE_TYPE.SYMBOL);

  if (!adapter) {
    const created = new SYMBOL_LIBRARY_ADAPTER(mgr);
    mgr.RegisterAdapter(LIBRARY_TABLE_TYPE.SYMBOL, created);
    return created;
  }

  return adapter as SYMBOL_LIBRARY_ADAPTER;
}
