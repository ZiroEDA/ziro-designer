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

import { captureError } from './reporter.js';

interface EventTargetLike {
  addEventListener(type: string, listener: (e: unknown) => void): void;
  removeEventListener(type: string, listener: (e: unknown) => void): void;
}

export interface GlobalHandlerOptions {
  /** Defaults to `window`; injected so this is testable off a real page. */
  target?: EventTargetLike;
  /** Defaults to `captureError`. */
  capture?: (err: unknown, context?: Record<string, string>) => void;
  /** Injectable clock. */
  now?: () => number;
  /** Reports allowed per window. */
  maxPerWindow?: number;
  /** Window length in ms. */
  windowMs?: number;
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
  const capture = opts.capture ?? captureError;
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
