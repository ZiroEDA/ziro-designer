/**
 * Crash recovery — getting a user's work out of a broken session.
 *
 * When a render throws, the editor is gone but the project is still sitting in
 * memory. The error boundary needs a way to hand that back rather than letting
 * a reload discard it, and the same escape hatch serves a user whose storage
 * has failed. Both are the difference between "the app crashed" and "the app
 * crashed and took my afternoon with it".
 *
 * The app registers a *provider* rather than pushing snapshots: a project can
 * be tens of megabytes, and copying it on every keystroke to prepare for a
 * crash that may never come would cost more than it saves. The provider is
 * called only once something has already gone wrong.
 *
 * Unlike Archive Project, this deliberately ignores KiCad's archive allow-list
 * and writes *every* file it has — gerbers, backups, plot outputs and all.
 * Recovery is not the moment to be opinionated about what deserves saving.
 */

import { zipSync } from 'fflate';
import { relPath } from './project_archiver.js';

export interface RecoverableFile {
  name: string;
  text: string;
  bytes?: Uint8Array;
}

export interface RecoverySnapshot {
  name: string;
  files: readonly RecoverableFile[];
}

type Provider = () => RecoverySnapshot | null;

let provider: Provider | null = null;

/** Register (or clear, with null) the source of the current project. */
export function setRecoveryProvider(fn: Provider | null): void {
  provider = fn;
}

/** The current project, or null when nothing is open / the provider throws. */
export function getRecoverySnapshot(): RecoverySnapshot | null {
  try {
    const snap = provider?.() ?? null;
    return snap && snap.files.length > 0 ? snap : null;
  } catch {
    return null; // the app is already broken; don't compound it
  }
}

const enc = new TextEncoder();

/** Zip a snapshot byte-exactly, nested under a folder named for the project. */
export function recoveryZip(snap: RecoverySnapshot): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of snap.files) {
    // Text files carry their content in `text`; binaries (plots, models) in
    // `bytes`. A UTF-8 file's raw bytes are its encoding, so either round-trips.
    const data = f.bytes && f.bytes.length > 0 ? f.bytes : enc.encode(f.text);
    if (data.length === 0) continue;
    entries[`${snap.name}/${relPath(f.name)}`] = data;
  }
  return zipSync(entries, { level: 6 });
}

/**
 * Download the current project as a .zip. Returns false when there was nothing
 * to save or the download itself failed — the caller is on an error path and
 * must not assume success.
 */
export function downloadRecoveryZip(): boolean {
  const snap = getRecoverySnapshot();
  if (!snap) return false;
  try {
    const blob = new Blob([recoveryZip(snap) as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snap.name}-recovered.zip`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
