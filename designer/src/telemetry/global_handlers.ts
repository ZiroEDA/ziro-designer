// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Global error and unhandled-rejection handlers, routed into `captureError`.
 *
 * The React error boundary is the only thing that reported anything, and by
 * design it catches **neither** of the two ways this app actually fails:
 *
 *  - **errors thrown in event handlers.** React does not route those to a
 *    boundary at all, and nearly everything here is a canvas pointer handler,
 *    a key handler or a menu action;
 *  - **anything asynchronous** — a rejected promise from storage, a throw
 *    inside a `setTimeout`, a failed dynamic import. A boundary never sees it.
 *
 * So the boundary covers render and commit, which is the part that was already
 * least likely to be where a schematic editor breaks. Everything else went to
 * the console of a machine nobody is looking at.
 *
 * **The rate limit is the load-bearing part.** A handler that throws on
 * `pointermove`, or a render loop that throws every frame, produces thousands
 * of identical events a second. Unbounded, that is a self-inflicted flood: it
 * costs the user bandwidth, buries the one event worth reading, and can be
 * worse for them than the bug. Identical errors are reported once per window,
 * the window is capped, and hitting the cap is itself reported once so the
 * silence that follows is on the record rather than indistinguishable from
 * health.
 */

import { HandleException } from '@ziroeda/common/pgm_base.js';

interface EventTargetLike {
  addEventListener(type: string, listener: (e: unknown) => void): void;
  removeEventListener(type: string, listener: (e: unknown) => void): void;
}

export interface GlobalHandlerOptions {
  /** Defaults to `window`; injected so this is testable off a real page. */
  target?: EventTargetLike;
  /** Defaults to `PGM_BASE::HandleException( err, true )`. */
  capture?: (err: unknown, context?: Record<string, string>) => void;
  /** Injectable clock. */
  now?: () => number;
  /** Reports allowed per window. */
  maxPerWindow?: number;
  /** Window length in ms. */
  windowMs?: number;
}

/** "ResizeObserver loop limit exceeded" / "... completed with undelivered notifications." */
const RESIZE_OBSERVER_LOOP = /^ResizeObserver loop /;

/**
 * The schemes a browser or an extension runs its own injected scripts under. Safari shows an
 * extension's script as `webkit-masked-url://hidden/`.
 */
const INJECTED_SCRIPT =
  /^(iabjs|chrome-extension|moz-extension|safari-extension|safari-web-extension|webkit-masked-url):/;

/** A path that names a script file: every frame of ours is in one (a built chunk, or a dev module). */
const SCRIPT_FILE = /\.(m?js|jsx?|tsx?)$/;

/**
 * Whether \a aUrl is a script the page did not load from a file of ours: an injected scheme, or a
 * page address itself. index.html carries no inline script, so a frame "at" a page - `/:230`,
 * `/p/…/pcb:816` - is one a translator or an extension added to the document (Sentry 13 and 19,
 * ko-KR and th-TH; 1F beside a `webkit-masked-url` frame).
 */
export function isInjected(aUrl: string): boolean {
  if (INJECTED_SCRIPT.test(aUrl)) return true;

  if (!/^https?:/.test(aUrl)) return false;

  try {
    return !SCRIPT_FILE.test(new URL(aUrl).pathname);
  } catch {
    return false;
  }
}

/**
 * A V8 frame with no file at all: `at <anonymous>:1:1`. That is code the host handed to the page
 * as a string - an Android WebView's `evaluateJavascript`, which is how an in-app browser calls
 * into its own bridge. A built-in under a frame of ours reads `at Array.map (<anonymous>)`, and
 * our own `eval` names its file, so neither is taken for one.
 */
const EVALUATED_BY_HOST = /^at (?:\S+ \()?<anonymous>(?::\d+){1,2}\)?$/;

/**
 * Whether every frame of \a err's stack is a script the browser injected - an Android in-app
 * browser's `iabjs://` logger or the string it evaluates in the page (Sentry 1P, Zalo's
 * `zaloJSV2`), an extension, a page translator - so nothing of ours is in it to fix.
 */
function fromInjectedScript(err: unknown): boolean {
  if (!(err instanceof Error) || !err.stack) return false;

  const lines = err.stack.split('\n').map((line) => line.trim());
  const urls = stackUrls(lines);

  if (!urls.every(isInjected)) return false;
  if (urls.length > 0) return true;

  // No file in the stack at all: only when every frame is one the host evaluated.
  const frames = lines.filter((line) => line.startsWith('at '));

  return frames.length > 0 && frames.every((line) => EVALUATED_BY_HOST.test(line));
}

/**
 * The file of each frame that names one, innermost first: "at fn (url:line:col)" (V8) or
 * "fn@url:line:col" (SpiderMonkey, JavaScriptCore).
 */
function stackUrls(aLines: readonly string[]): string[] {
  return aLines
    .map((line) => /(?:\(|@|at )([a-z][a-z0-9+.-]*:[^\s)]*?)(?::\d+){1,2}\)?\s*$/i.exec(line)?.[1])
    .filter((u): u is string => !!u);
}

/**
 * A fetch that failed on the network, as each engine words it; Sentry's fetch instrumentation adds
 * the host - "Failed to fetch (us.i.posthog.com)".
 */
const FETCH_FAILED =
  /^(?:Failed to fetch|NetworkError when attempting to fetch resource|Load failed)\b/;

/**
 * Whether \a err is a fetch that failed inside an extension's wrapper of `fetch`, called from
 * ours: an injected frame sits inside one of ours. The rejection left unhandled is the wrapper's
 * own - ours had its catch (Sentry 1S, the usage counts' `fetch(...).catch()` through a Chrome
 * extension's `libs/requests.js`). The same failure with no extension in the way names no
 * injected frame, and is still reported.
 */
function fetchFailedInInjectedWrapper(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== 'TypeError' || !err.stack) return false;
  if (!FETCH_FAILED.test(err.message)) return false;

  const urls = stackUrls(err.stack.split('\n').map((line) => line.trim()));
  let outermostOurs = -1;
  urls.forEach((u, i) => {
    if (!isInjected(u)) outermostOurs = i;
  });

  return urls.some((u, i) => i < outermostOurs && isInjected(u));
}

/**
 * A WebExtension's messaging failing, as each engine words it: Safari's "Invalid call to
 * runtime.sendMessage(). Tab not found.", Chrome's and Firefox's "Could not establish connection.
 * Receiving end does not exist.", Chrome's "Extension context invalidated.". The app calls none
 * of these APIs.
 */
const EXTENSION_MESSAGING =
  /\bruntime\.(?:sendMessage|connect)\(\)|Receiving end does not exist|Extension context invalidated/;

/**
 * Whether \a err is an extension's own messaging failure, rejected in the page with no frame of
 * ours (Sentry 1V: no stack at all, en-GB). One with a frame of ours in its stack is still
 * reported.
 */
function extensionMessagingFailed(err: unknown): boolean {
  if (!(err instanceof Error) || !EXTENSION_MESSAGING.test(err.message)) return false;

  return stackUrls((err.stack ?? '').split('\n').map((line) => line.trim())).every(isInjected);
}

/** What an error is "the same as", for de-duplication. */
function signatureOf(err: unknown): string {
  if (err instanceof Error) {
    const firstFrame = (err.stack ?? '').split('\n')[1]?.trim() ?? '';
    return `${err.name}: ${err.message}\n${firstFrame}`;
  }
  return String(err);
}

/**
 * Install the handlers. Returns the disposer.
 *
 * Every path is wrapped: a reporting failure must never become the crash it was
 * trying to describe.
 */
export function installGlobalErrorHandlers(opts: GlobalHandlerOptions = {}): () => void {
  const target =
    opts.target ?? (typeof window !== 'undefined' ? (window as EventTargetLike) : null);
  const capture = opts.capture ?? ((err: unknown) => HandleException(err, true));
  const now = opts.now ?? (() => Date.now());
  const maxPerWindow = opts.maxPerWindow ?? 10;
  const windowMs = opts.windowMs ?? 60_000;

  let windowStart = now();
  let sent = 0;
  let seen = new Set<string>();
  let capReported = false;

  const report = (err: unknown, source: string): void => {
    try {
      const t = now();
      if (t - windowStart >= windowMs) {
        windowStart = t;
        sent = 0;
        seen = new Set();
        capReported = false;
      }
      // A browser's own injected script failing (an in-app browser's logger losing its bridge)
      // is not this app's error.
      if (
        fromInjectedScript(err) ||
        fetchFailedInInjectedWrapper(err) ||
        extensionMessagingFailed(err)
      )
        return;

      const sig = signatureOf(err);
      // The same failure firing every frame is one fact, not a thousand.
      if (seen.has(sig)) return;
      if (sent >= maxPerWindow) {
        // Say once that we stopped, so the quiet is a decision on the record
        // and not indistinguishable from nothing going wrong.
        if (!capReported) {
          capReported = true;
          capture(new Error('Error reporting rate limit reached'), {
            source,
            suppressed: 'true',
          });
        }
        return;
      }
      seen.add(sig);
      sent++;
      capture(err, { source });
    } catch {
      /* a failed report is never worth a second crash */
    }
  };

  const onError = (e: unknown): void => {
    const ev = e as { error?: unknown; message?: string };
    // The browser's own notice that a ResizeObserver callback resized what it observes, so some
    // notifications wait for the next frame. It carries no error object and nothing failed: the
    // spec reports it through `error` only so a page can notice a layout that never settles.
    if (ev?.error == null && RESIZE_OBSERVER_LOOP.test(ev?.message ?? '')) return;
    report(ev?.error ?? new Error(ev?.message ?? 'Unknown error'), 'window.onerror');
  };
  const onRejection = (e: unknown): void => {
    const ev = e as { reason?: unknown };
    report(ev?.reason ?? new Error('Unhandled rejection'), 'unhandledrejection');
  };

  target?.addEventListener('error', onError);
  target?.addEventListener('unhandledrejection', onRejection);

  return () => {
    target?.removeEventListener('error', onError);
    target?.removeEventListener('unhandledrejection', onRejection);
  };
}
