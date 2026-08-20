// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where the user's work currently is, and whether it is still on its way.
 *
 * Two things made this necessary at once. Edits reached IndexedDB and stopped
 * there: `pushProject` ran when a project was opened or renamed and nowhere
 * else, so an hour of editing sat on one machine until the next sign-in
 * happened to reconcile it, under a status bar reading "Saved in browser ·
 * cloud sync on". And when a write did fail, nothing said so.
 *
 * The state is derived from whether writes are landing, never from
 * `navigator.onLine`, which reports a captive portal and a half-open connection
 * as online and is wrong exactly when it matters.
 *
 * `describeSaveState` is a pure function of a snapshot and the current time so
 * the wording and the thresholds can be tested without a browser, a timer or a
 * network.
 */

export interface SaveSnapshot {
  /** Edits not yet written to local storage. */
  localPending: boolean;
  /** Local writes are failing (quota, private mode, a read-only origin). */
  localFailed: boolean;
  /** A cloud push is scheduled or in flight. */
  cloudPending: boolean;
  /** When the cloud last accepted a write, epoch ms; 0 if it never has. */
  cloudOkAt: number;
  /**
   * When the current run of cloud failures started, epoch ms; 0 when the last
   * attempt succeeded. A run, not a count: one failed retry among many that
   * work is not worth a word, and a minute of them is.
   */
  cloudFailingSince: number;
  /** Whether there is an account to sync to at all. */
  signedIn: boolean;
}

export const emptySnapshot: SaveSnapshot = {
  localPending: false,
  localFailed: false,
  cloudPending: false,
  cloudOkAt: 0,
  cloudFailingSince: 0,
  signedIn: false,
};

export type SaveKind = 'saved' | 'saving' | 'retrying' | 'stale' | 'local-only' | 'failed';

export interface SaveDescription {
  kind: SaveKind;
  text: string;
  /** Whether to offer a download, the escape hatch that always works. */
  offerDownload: boolean;
}

/**
 * How long a run of cloud failures is tolerated before it is escalated from
 * "retrying" to a timestamp the user can act on.
 *
 * A dropped request and a reconnect inside a minute is noise. Past that it is
 * worth saying, with the time of the last successful save, because from there
 * the honest question is whether to keep working in this tab.
 */
export const STALE_AFTER_MS = 60_000;

const hhmm = (t: number): string =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The one sentence to show. Order matters: it goes from the worst thing that is
 * true to the best, so a failure is never hidden behind a spinner.
 */
export function describeSaveState(s: SaveSnapshot, now: number): SaveDescription {
  // Local storage is where the work actually lives; nothing else matters while
  // that is broken. The storage banner says more, this keeps the two agreeing.
  if (s.localFailed) {
    return {
      kind: 'failed',
      text: 'Not saved: this browser refused to store it',
      offerDownload: true,
    };
  }

  if (s.signedIn && s.cloudFailingSince > 0) {
    const failingFor = now - s.cloudFailingSince;
    if (failingFor >= STALE_AFTER_MS) {
      return {
        kind: 'stale',
        text: s.cloudOkAt
          ? `Not saved to the cloud since ${hhmm(s.cloudOkAt)}. Your work is on this device.`
          : 'Not saved to the cloud. Your work is on this device.',
        offerDownload: true,
      };
    }
    return {
      kind: 'retrying',
      text: 'Reconnecting. Your work is saved on this device.',
      offerDownload: false,
    };
  }

  if (s.localPending || (s.signedIn && s.cloudPending)) {
    return { kind: 'saving', text: 'Saving...', offerDownload: false };
  }

  // Signed out is a legitimate, complete state, not a degraded one: the work is
  // saved, it is simply saved here. Saying "all changes saved" without that
  // would claim an account copy that does not exist.
  if (!s.signedIn) {
    return { kind: 'local-only', text: 'Saved on this device', offerDownload: false };
  }

  return { kind: 'saved', text: 'All changes saved', offerDownload: false };
}

// ----- the store ------------------------------------------------------------

let snapshot: SaveSnapshot = { ...emptySnapshot };
const listeners = new Set<(s: SaveSnapshot) => void>();

export function getSaveSnapshot(): SaveSnapshot {
  return snapshot;
}

export function subscribeSaveState(fn: (s: SaveSnapshot) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function update(patch: Partial<SaveSnapshot>): void {
  const next = { ...snapshot, ...patch };
  // Identical snapshots must not notify: this drives a render, and the write
  // path touches it on every keystroke's worth of autosave.
  if ((Object.keys(patch) as (keyof SaveSnapshot)[]).every((k) => snapshot[k] === next[k])) return;
  snapshot = next;
  for (const fn of listeners) fn(snapshot);
}

export const reportLocalPending = (pending: boolean): void => update({ localPending: pending });
export const reportLocalFailed = (failed: boolean): void => update({ localFailed: failed });
export const reportSignedIn = (signedIn: boolean): void => update({ signedIn });
export const reportCloudPending = (pending: boolean): void => update({ cloudPending: pending });

export function reportCloudOk(now: number = Date.now()): void {
  update({ cloudPending: false, cloudOkAt: now, cloudFailingSince: 0 });
}

export function reportCloudFailed(now: number = Date.now()): void {
  // The *start* of the run is kept, not the latest failure: the message says
  // how long this has been going on, and restamping it on every retry would
  // hold it at zero and never escalate.
  update({
    cloudPending: false,
    cloudFailingSince: snapshot.cloudFailingSince || now,
  });
}

/** Test seam: forget everything. */
export function resetSaveState(): void {
  snapshot = { ...emptySnapshot };
  listeners.clear();
}
