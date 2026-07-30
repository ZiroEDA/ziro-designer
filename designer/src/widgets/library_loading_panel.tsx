// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a chooser shows while its libraries are still arriving: a spinner
 * centred in the pane the rows will fill (see library_loading.ts). KiCad covers
 * the same wait with its "Loading Symbol Libraries" progress dialog.
 *
 * Deliberately the *only* shape, an extra line above a populated list shifts
 * everything under it every time a library is fetched, which is worse than no
 * feedback at all.
 */

import { useCallback, useSyncExternalStore, type JSX } from 'react';
import {
  libraryLoadingState,
  subscribeLibraryLoading,
  type LibraryKind,
  type LibraryLoadingState,
} from './library_loading.js';

/** The live loading state of one library kind (both kinds when omitted). */
export function useLibraryLoading(kind?: LibraryKind): LibraryLoadingState {
  const snapshot = useCallback(() => libraryLoadingState(kind), [kind]);
  return useSyncExternalStore(subscribeLibraryLoading, snapshot, snapshot);
}

/**
 * The centred "still loading" panel: a large spinner, the headline, and the
 * library currently being read under it. Fills its container, so drop it where
 * the rows will be. `fallback` renders instead once loading is done.
 */
export function LibraryLoadingPanel({
  kind,
  fallback = null,
  label,
}: {
  /** Which library set this pane shows; omit to react to any. */
  kind?: LibraryKind;
  fallback?: JSX.Element | null;
  /** Headline, e.g. "Loading symbol libraries…". Defaults to the live label. */
  label?: string;
}): JSX.Element | null {
  const loading = useLibraryLoading(kind);
  if (loading.count === 0) return fallback;
  const headline = label ?? loading.label;
  return (
    <div className="ze-lib-loading-panel">
      <span className="ze-spinner big" />
      <span className="msg">{headline}</span>
      {loading.label && loading.label !== headline && (
        <span className="detail">{loading.label}</span>
      )}
    </div>
  );
}
