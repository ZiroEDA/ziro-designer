// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Flush pending autosave writes when the page stops being visible.
 *
 * Autosave is debounced by 1.2 s, which is right while someone is typing and
 * wrong at the moment they leave: an edit followed within that window by a tab
 * close, a reload, a swipe to another app or a back-navigation never reaches
 * storage, and nothing tells anyone. The editor already flushes when you leave
 * it for the home screen; leaving the *page* had no equivalent.
 *
 * **`visibilitychange` is the event to use, not `beforeunload`.** A page can be
 * discarded without ever firing `beforeunload` or `unload` — that is normal on
 * mobile and increasingly common on desktop — and both are ignored outright
 * when the tab is killed by the OS. `visibilitychange` to `hidden` is the last
 * callback a page is guaranteed to get, so it is where the "save now" belongs.
 * `pagehide` is a belt for the bfcache path, where visibility may not change.
 *
 * The flush cannot be awaited: nothing may block the unload, and IndexedDB has
 * no synchronous form. Starting the transaction here is the whole of what is
 * available, and it is a great deal better than a timer that never fires.
 */

export interface FlushOnHideTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface FlushOnHideOptions {
  /** Defaults to `document`; injected so this is testable off a real page. */
  target?: FlushOnHideTarget;
  /** Reads the page's visibility; defaults to `document.visibilityState`. */
  isHidden?: () => boolean;
  /** Defaults to `window`, which is where `pagehide` lands. */
  pageTarget?: FlushOnHideTarget;
}

/**
 * Call `flush` whenever the page becomes hidden or is being unloaded. Returns
 * the disposer.
 *
 * A visibility change back to *visible* must not flush: it is not a moment of
 * risk, and flushing there would write on every tab switch back.
 */
export function installFlushOnHide(flush: () => void, opts: FlushOnHideOptions = {}): () => void {
  const target = opts.target ?? (typeof document !== 'undefined' ? document : null);
  const pageTarget = opts.pageTarget ?? (typeof window !== 'undefined' ? window : null);
  const isHidden =
    opts.isHidden ??
    (() => (typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false));

  const onVisibility = (): void => {
    if (isHidden()) flush();
  };
  const onPageHide = (): void => flush();

  target?.addEventListener('visibilitychange', onVisibility);
  pageTarget?.addEventListener('pagehide', onPageHide);

  return () => {
    target?.removeEventListener('visibilitychange', onVisibility);
    pageTarget?.removeEventListener('pagehide', onPageHide);
  };
}
