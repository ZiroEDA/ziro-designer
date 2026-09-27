// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The program's `SENTRY_BACKEND` (`common/app_monitor.ts`): the browser Sentry
 * SDK where upstream links sentry-native, and the two values upstream keeps as
 * files in the user cache.
 *
 *  - The opt-in marker (`sentry-opt-in`) is `privacy.crash_reports`, a setting
 *    that follows the account. It is ON by default here where upstream starts
 *    opted out and asks: a product decision, recorded in the scrubbing notes.
 *  - The id (`sentry-uid`) is a localStorage key: one per browser, as upstream's
 *    is one per installation.
 *
 * Every event is scrubbed before it leaves (`scrub.ts`): a crash message from
 * an EDA tool carries board and project names, which upstream sends and we do
 * not. The scrubber also drops the `user` object, so the id travels as the
 * `install_id` tag instead of `sentry_set_user`.
 *
 * The SDK arrives after the first paint (a dynamic import); events raised
 * before it do are queued, and dropped if reporting is switched off first.
 */
import type * as SentryNs from '@sentry/browser';
import type { SENTRY_BACKEND } from '@ziroeda/common/app_monitor.js';
import { settings } from '../prefs/settings.js';
import { type ScrubbableEvent, scrubEvent } from './scrub.js';

type Sdk = typeof SentryNs;

const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** The DSN; with none (a local build) nothing is ever sent. */
const DSN: string | undefined = env.VITE_SENTRY_DSN;

/** What the build stamps as the release, `GetCommitHash()` upstream. */
export const SENTRY_RELEASE: string = env.VITE_RELEASE ?? 'dev';

const UID_KEY = 'ziroeda.installId';

let sdk: Sdk | null = null;
let closed = false;
const queued: (() => void)[] = [];

/**
 * `beforeSend`: nothing once reporting is off, and nothing unscrubbed - if
 * scrubbing fails, the event is dropped rather than sent as it was.
 */
export function prepareEvent(event: ScrubbableEvent): ScrubbableEvent | null {
  if (!settings.privacy.crash_reports) return null;

  try {
    return scrubEvent(event);
  } catch {
    return null;
  }
}

/** Run `aCall` on the SDK now, or when it arrives unless reporting closes first. */
function withSdk(aCall: (aSdk: Sdk) => void): void {
  if (sdk) aCall(sdk);
  else if (!closed) queued.push(() => sdk && aCall(sdk));
}

export const sentryBackend: SENTRY_BACKEND = {
  OptInExists: () => settings.privacy.crash_reports,

  SetOptInMarker: (aOptIn) =>
    settings.updatePrivacy((p) => {
      p.crash_reports = aOptIn;
    }),

  ReadUid: () => {
    try {
      return localStorage.getItem(UID_KEY) ?? '';
    } catch {
      return ''; // storage blocked; reports still group by stack
    }
  },

  WriteUid: (aUid) => {
    try {
      localStorage.setItem(UID_KEY, aUid);
    } catch {
      /* storage blocked */
    }
  },

  Init: ({ uid, release, environment, version }) => {
    if (!DSN) return;

    closed = false;
    void import('@sentry/browser').then((Sentry) => {
      // Closed before it arrived (reporting switched off in the meantime).
      if (closed) return;

      Sentry.init({
        dsn: DSN,
        release,
        ...(environment ? { environment } : {}),
        sendDefaultPii: false,
        // Breadcrumbs are heavily filtered downstream; keep a shallow trail.
        maxBreadcrumbs: 20,
        // Upstream samples 5% of transactions; we trace none (TRANSACTION).
        tracesSampleRate: 0,
        integrations: (defaults) =>
          // Drop the integrations that would collect far more than a stack trace.
          defaults.filter(
            (i) => !['BrowserTracing', 'Replay', 'BrowserProfiling'].includes(i.name),
          ),
        beforeSend: (event) => prepareEvent(event as ScrubbableEvent) as typeof event | null,
        beforeBreadcrumb: (crumb) =>
          // Console breadcrumbs are dropped at source as well as in the scrubber:
          // they are the likeliest carrier of project data.
          crumb.category === 'console' ? null : crumb,
      });
      Sentry.setTag('install_id', uid);
      if (version) Sentry.setTag('version', version);
      sdk = Sentry;

      for (const call of queued.splice(0)) call();
    });
  },

  Close: () => {
    // Stops the transport and prevents any queued event from being sent.
    closed = true;
    queued.length = 0;
    if (sdk) void sdk.close(0);
    sdk = null;
  },

  SetTag: (aKey, aValue) => withSdk((s) => s.setTag(aKey, aValue)),

  CaptureException: (aType, aMsg, aTags, aError) =>
    withSdk((s) =>
      s.captureException(aError ?? new Error(aMsg), { tags: { ...aTags, type: aType } }),
    ),

  AddBreadcrumb: ({ type, message, category, level }) =>
    withSdk((s) =>
      s.addBreadcrumb({
        type,
        message,
        category,
        ...(level ? { level: level as SentryNs.SeverityLevel } : {}),
      }),
    ),
};

/** For tests: forget the SDK and the queue. */
export function resetSentryBackendForTests(): void {
  sdk = null;
  closed = false;
  queued.length = 0;
}
