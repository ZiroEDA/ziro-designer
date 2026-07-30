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

import * as Sentry from '@sentry/browser';
import { prepareEvent, type TelemetrySink } from './reporter.js';
import type { ScrubbableEvent } from './scrub.js';

export const sentrySink: TelemetrySink = {
  install({ dsn, release, installId }) {
    Sentry.init({
      dsn,
      release,
      sendDefaultPii: false,
      // Breadcrumbs are heavily filtered downstream; keep a shallow trail.
      maxBreadcrumbs: 20,
      tracesSampleRate: 0,
      integrations: (defaults) =>
        // Drop the integrations that would collect far more than a stack trace.
        defaults.filter((i) => !['BrowserTracing', 'Replay', 'BrowserProfiling'].includes(i.name)),
      beforeSend: (event) => prepareEvent(event as ScrubbableEvent) as typeof event | null,
      beforeBreadcrumb: (crumb) =>
        // Console breadcrumbs are dropped at source as well as in the scrubber:
        // they are the likeliest carrier of project data, and not capturing them
        // is cheaper than sanitising them.
        crumb.category === 'console' ? null : crumb,
    });
    Sentry.setTag('install_id', installId);
  },

  close() {
    // Stops the transport and prevents any queued event from being sent.
    void Sentry.close(0);
  },

  capture(err, context) {
    Sentry.captureException(err, context ? { tags: context } : undefined);
  },
};
