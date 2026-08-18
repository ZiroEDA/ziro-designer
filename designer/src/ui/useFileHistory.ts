// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * React binding for the shared `FILE_HISTORY` port in `file_history.ts`.
 *
 * Kept apart from the store itself so `file_history.ts` stays React-free and
 * `qa`'s tsconfig — which compiles `.ts` and is the only project that
 * typechecks the tests — can reach every behaviour in it.
 *
 * Upstream the equivalent is `EDA_BASE_FRAME::UpdateFileHistory` calling
 * `ReCreateMenuBar()` (common/eda_base_frame.cpp:1477-1481): the frame rebuilds
 * its menu whenever the history changes. `useSyncExternalStore` is the same
 * thing said in React's words — `getFiles()` returns the same frozen array
 * until a mutation replaces it, which is exactly the stable snapshot the hook
 * requires.
 */
import { useSyncExternalStore } from 'react';
import type { FileHistory, FileHistoryEntry } from './file_history.js';

/** Subscribe a component to a `FileHistory` and read its rows, newest first. */
export function useFileHistory<T extends FileHistoryEntry>(history: FileHistory<T>): readonly T[] {
  return useSyncExternalStore(
    (fn) => history.subscribe(fn),
    () => history.getFiles(),
    () => history.getFiles(),
  );
}
