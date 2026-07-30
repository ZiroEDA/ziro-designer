// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Crash reporting, the front door.
 *
 * Without this the team finds out about a launch-day crash loop from Twitter.
 * The point is not analytics; it is knowing that something is broken, for how
 * many people, and with what stack, while there is still time to act.
 *
 * Call sites bind to `captureError` and never to a vendor, so the transport is
 * one import away from being swapped or removed. Scrubbing lives below this
 * layer too, so no transport can accidentally bypass it.
 *
 * Reporting is opt-out (Preferences -> Common -> Privacy). Turning it off takes
 * effect immediately and permanently for that browser: the sink is closed and
 * `captureError` becomes a no-op, rather than merely being filtered later.
 *
 * Everything here is failure-tolerant by construction. Telemetry that can throw
 * would be a crash reporter that causes crashes.
 */

import { settings } from '../prefs/settings.js';
import { scrubEvent, type ScrubbableEvent } from './scrub.js';

/** A transport. `sentrySink` is the only implementation today. */
export interface TelemetrySink {
  install(opts: { dsn: string; release: string; installId: string }): void;
  close(): void;
  capture(err: unknown, context?: Record<string, string>): void;
}

/**
 * Read Vite's build-time env defensively. `import.meta.env` is typed by
 * `vite/client`, which the test package does not (and should not need to) pull
 * in just to exercise the privacy rules below.
 */
const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const DSN: string | undefined = env.VITE_SENTRY_DSN;
const RELEASE: string = env.VITE_RELEASE ?? 'dev';
const INSTALL_ID_KEY = 'ziroeda.installId';

let sink: TelemetrySink | null = null;
let installed = false;

/**
 * A random per-browser id, so reports can be grouped into "how many distinct
 * users hit this" without knowing who any of them are. Not tied to the signed-in
 * account, that would make crash reports identifying, which is the thing the
 * scrubber exists to prevent.
 */
export function installId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID?.() ?? `i${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(INSTALL_ID_KEY, id);
    return id;
  } catch {
    return 'unknown'; // storage blocked; reports still group by stack
  }
}

/** Whether the user has left crash reporting on. */
export const reportingEnabled = (): boolean => settings.privacy.crash_reports;

/** Whether reports can actually be sent (enabled *and* a DSN is configured). */
export const reportingActive = (): boolean => installed && reportingEnabled();

/**
 * Start reporting if it is both configured and permitted. Safe to call more
 * than once. With no DSN the app runs exactly as before, the same
 * env-gated-degrades-to-offline shape as Supabase auth and cloud sync.
 */
export function initTelemetry(sinkImpl: TelemetrySink): void {
  if (installed || !DSN || !reportingEnabled()) return;
  try {
    sinkImpl.install({ dsn: DSN, release: RELEASE, installId: installId() });
    sink = sinkImpl;
    installed = true;
  } catch {
    sink = null;
    installed = false;
  }
}

/**
 * Apply a change to the preference. Turning reporting off closes the transport
 * immediately; turning it back on re-installs it.
 */
export function setReportingEnabled(on: boolean, sinkImpl?: TelemetrySink): void {
  settings.updatePrivacy((p) => {
    p.crash_reports = on;
  });
  if (on) {
    if (sinkImpl) initTelemetry(sinkImpl);
    return;
  }
  try {
    sink?.close();
  } catch {
    /* closing a transport must never throw into the app */
  }
  sink = null;
  installed = false;
}

/**
 * Report an error. Silently does nothing when reporting is off or unconfigured,
 * which is the common case in development and for self-hosters.
 */
export function captureError(err: unknown, context?: Record<string, string>): void {
  if (!reportingActive()) return;
  try {
    sink?.capture(err, context);
  } catch {
    /* a failed report is not worth a second crash */
  }
}

/**
 * Final scrub, applied by the transport immediately before sending. Exposed
 * here so every sink routes through the same rules. Returning null drops the
 * event, which is what a disabled preference must do even for events already
 * queued inside the transport.
 */
export function prepareEvent(event: ScrubbableEvent): ScrubbableEvent | null {
  if (!reportingEnabled()) return null;
  try {
    return scrubEvent(event);
  } catch {
    return null; // if scrubbing fails we send nothing, never something unscrubbed
  }
}

/** Test seam: forget any installed transport. */
export function resetTelemetryForTests(): void {
  sink = null;
  installed = false;
}
