// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sentry transport for {@link TelemetrySink}.
 *
 * The only file that knows the vendor. Everything vendor-shaped is confined
 * here: swapping Sentry out means writing one more file like this one and
 * changing a single import in `main.tsx`.
 *
 * Configured conservatively on purpose:
 *   - No performance tracing, no session replay, no profiling. We are buying
 *     "something is broken and here is the stack", not an analytics product,
 *     and each of those would ship far more of the user's session than the
 *     privacy posture in `scrub.ts` allows.
 *   - Default PII off, so IP addresses and the signed-in account are never
 *     attached.
 *   - Every event passes through `prepareEvent`, which both scrubs and enforces
 *     the opt-out, including for events already queued inside the SDK when the
 *     user flips the setting.
 */

import type * as SentryNs from '@sentry/browser';
import { prepareEvent, type TelemetrySink } from './reporter.js';
import type { ScrubbableEvent } from './scrub.js';

type Sdk = typeof SentryNs;

/**
 * The SDK arrives after the first paint.
 *
 * `@sentry/browser` and its core are 208 KB of the entry chunk, and nothing a
 * sign-in screen needs. `install` is called at boot so a crash during the
 * first paint is still reported — and it still is: the import starts at
 * once, anything captured before it lands is queued, and the queue drains
 * into the SDK the moment it initialises. What changes is that the bytes no
 * longer stand between the user and the first screen.
 */
let sdk: Sdk | null = null;
let closed = false;
const queued: [unknown, Record<string, string> | undefined][] = [];

export const sentrySink: TelemetrySink = {
  install({ dsn, release, installId }) {
    closed = false;
    void import('@sentry/browser').then((Sentry) => {
      // Closed before it arrived (reporting switched off in the meantime).
      if (closed) return;
      Sentry.init({
        dsn,
        release,
        sendDefaultPii: false,
        // Breadcrumbs are heavily filtered downstream; keep a shallow trail.
        maxBreadcrumbs: 20,
        tracesSampleRate: 0,
        integrations: (defaults) =>
          // Drop the integrations that would collect far more than a stack trace.
          defaults.filter(
            (i) => !['BrowserTracing', 'Replay', 'BrowserProfiling'].includes(i.name),
          ),
        beforeSend: (event) => prepareEvent(event as ScrubbableEvent) as typeof event | null,
        beforeBreadcrumb: (crumb) =>
          // Console breadcrumbs are dropped at source as well as in the scrubber:
          // they are the likeliest carrier of project data, and not capturing them
          // is cheaper than sanitising them.
          crumb.category === 'console' ? null : crumb,
      });
      Sentry.setTag('install_id', installId);
      sdk = Sentry;
      for (const [err, context] of queued.splice(0))
        sdk.captureException(err, context ? { tags: context } : undefined);
    });
  },
  close() {
    // Stops the transport and prevents any queued event from being sent.
    closed = true;
    queued.length = 0;
    if (sdk) void sdk.close(0);
    sdk = null;
  },
  capture(err, context) {
    if (sdk) sdk.captureException(err, context ? { tags: context } : undefined);
    else if (!closed) queued.push([err, context]);
  },
};
