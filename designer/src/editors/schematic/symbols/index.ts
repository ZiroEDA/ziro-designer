// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The designer end of `@ziroeda/eeschema/libraries/symbol_library_adapter.js`
 * (`SYMBOL_LIBRARY_ADAPTER`): where the hosted symbol libraries actually live
 * (the R2 bucket / bundled-subset split in `libraryHosts.ts`), the "loading"
 * progress signal (`widgets/library_loading.ts`), and the worker pool a whole
 * library is parsed off of (`preload_pool.ts`). Configured once, at module
 * load, the same job `eeschema_app.tsx` does for `EESCHEMA_APP` — `eeschema`
 * never imports `designer`, so this is the one file that answers its
 * `SymbolLibraryHost` seam. Every function is re-exported so existing callers
 * keep one import site for symbol access.
 */
import {
  configureSymbolLibraryAdapter,
  isPowerSymbol,
  libraryLoaded,
  libraryUri,
  loadedLibraryItems,
  loadIndex,
  loadLibrarySymbols,
  loadSymbol,
  powerSymbolTest,
  preloadLibraryItems,
  symbolPinCount,
  symbolPreloadWork,
  symbolProperty,
  symbolsBase,
  symbolSearchTerms,
  libSymbolPinCount,
  libSymbolUnitCount,
  type LibIndexEntry,
  type LibTreeItem,
} from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import { fetchLibraryIndex, libraryBase } from '../../../libraryHosts.js';
import { trackLibraryLoad } from '../../../widgets/library_loading.js';
import { loadLibraryItemsPooled } from './preload_pool.js';

configureSymbolLibraryAdapter({
  symbolsBase: () => libraryBase.symbols,
  fetchIndex: () => fetchLibraryIndex<LibIndexEntry>('symbols'),
  trackLoad: (label, work) => trackLibraryLoad('symbols', label, work),
  loadLibraryItemsPooled,
});

export type { LibIndexEntry, LibTreeItem };
export {
  isPowerSymbol,
  libraryLoaded,
  libraryUri,
  loadedLibraryItems,
  loadIndex,
  loadLibrarySymbols,
  loadSymbol,
  powerSymbolTest,
  preloadLibraryItems,
  symbolPinCount,
  symbolPreloadWork,
  symbolProperty,
  symbolsBase,
  symbolSearchTerms,
  libSymbolPinCount,
  libSymbolUnitCount,
};
