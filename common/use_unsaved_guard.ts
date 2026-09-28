// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Ask the browser to confirm before leaving with unsaved work.
 *
 * This is **not** the same job as `flush_on_hide.ts`, and the two want opposite
 * events. Flushing is for an editor that autosaves: there is nothing to ask,
 * the work just has to reach storage, and `visibilitychange` is the last
 * callback a page is guaranteed. Prompting is for an editor that does *not*
 * autosave: nothing can be written without the user's say-so, so the only
 * useful thing is to stop them leaving by accident — and `beforeunload` is the
 * only event that can.
 *
 * `beforeunload` is unreliable in the ways that do not matter here. It is
 * ignored when the OS kills the tab or a phone discards the page, and no API
 * helps there. It is honoured for the case this is for: a deliberate close,
 * reload or navigation after the user has interacted with the page.
 *
 * The message is the browser's own. Every current browser ignores custom text
 * — it was used to scare people — so passing one would only be a lie about
 * what the user is going to see.
 */

import { useEffect } from 'react';

export interface UnsavedGuardTarget {
  addEventListener(type: string, listener: (e: BeforeUnloadEvent) => void): void;
  removeEventListener(type: string, listener: (e: BeforeUnloadEvent) => void): void;
}

/** Register the handler. Returns the disposer. */
export function installUnsavedGuard(target?: UnsavedGuardTarget | null): () => void {
  const t =
    target ?? (typeof window !== 'undefined' ? (window as unknown as UnsavedGuardTarget) : null);
  if (!t) return () => undefined;
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    e.preventDefault();
    // Some engines still require the legacy return value before they will show
    // the prompt at all.
    e.returnValue = '';
  };
  t.addEventListener('beforeunload', onBeforeUnload);
  return () => t.removeEventListener('beforeunload', onBeforeUnload);
}

/**
 * Warn on leaving while `unsaved` is true. Registering nothing when it is
 * false matters: a page that always has a `beforeunload` listener can be
 * excluded from the back/forward cache, so an editor with nothing to lose
 * should not pay for one.
 */
export function useUnsavedGuard(unsaved: boolean, target?: UnsavedGuardTarget): void {
  useEffect(() => {
    if (!unsaved) return;
    return installUnsavedGuard(target);
  }, [unsaved, target]);
}
