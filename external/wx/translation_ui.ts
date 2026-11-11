// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The React half of `translation.ts`.
 *
 * KiCad answers a language change by walking every open frame and calling
 * `ShowChangedLanguage()`, which rebuilds the menu bar, the toolbars and the
 * panes from scratch with the new `_()` results. A React tree rebuilds itself
 * when something it subscribed to changes, so the equivalent is one hook: a
 * component that draws translated text calls `useTranslations()` and is
 * re-rendered when the catalog is swapped.
 */
import { useSyncExternalStore } from 'react';
import { wxTranslations } from './translation.js';

/**
 * Subscribe the calling component to the language. The return value is the
 * catalog generation; it is only useful as a `useMemo` dependency for data
 * built with `_()` inside the memo.
 */
export function useTranslations(): number {
  const t = wxTranslations.Get();
  return useSyncExternalStore(t.Subscribe, t.GetVersion, t.GetVersion);
}
