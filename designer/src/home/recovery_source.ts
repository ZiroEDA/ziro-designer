// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Assembling the crash-recovery snapshot from what the app holds in memory.
 *
 * `recovery.ts` asks for a *provider* rather than being handed snapshots,
 * because a project can be tens of megabytes and copying it on every keystroke
 * to prepare for a crash that may never come costs more than it saves. This is
 * the provider.
 *
 * Freshness order matters, and it is the whole of the logic here. The same file
 * can exist in three places at once, and the newest wins:
 *
 *  1. **the autosave queue** — bytes already serialised and waiting on the
 *     1.2 s debounce, which is the most recent form of anything just edited;
 *  2. **the live-edit mirror** — edits committed to the in-memory project so
 *     the home tree reflects them;
 *  3. **the opened project** — what was read from storage.
 *
 * Taking them in the other order would hand the user a crash zip that is a
 * minute older than the work they just lost, which is a subtler version of
 * losing it.
 */

export interface SourceFile {
  name: string;
  text: string;
}

export interface RecoverableFile {
  name: string;
  text: string;
  bytes?: Uint8Array;
}

export interface RecoverySnapshot {
  name: string;
  files: readonly RecoverableFile[];
}

/**
 * Everything the app currently holds for the open project, newest form of each
 * file. Returns null when nothing is open, which is what lets the crash screen
 * say "nothing was lost" *truthfully*.
 */
export function recoverySnapshotFrom(
  projectName: string | null,
  opened: readonly SourceFile[] | null,
  liveEdits: ReadonlyMap<string, string>,
  pending: ReadonlyMap<string, Uint8Array>,
): RecoverySnapshot | null {
  // An empty project falls out of the tail check below, so this only guards
  // "no project open at all".
  if (!opened) return null;

  const byName = new Map<string, RecoverableFile>();
  for (const f of opened) byName.set(f.name, { name: f.name, text: f.text });
  for (const [name, text] of liveEdits) byName.set(name, { name, text });
  // Queued bytes are the freshest: they were serialised on the edit and are
  // only waiting for the debounce. `bytes` wins over `text` in the zip writer,
  // so both are carried and nothing has to be re-encoded here.
  for (const [name, bytes] of pending) {
    const prev = byName.get(name);
    byName.set(name, { name, text: prev?.text ?? '', bytes });
  }

  const files = [...byName.values()];
  return files.length > 0 ? { name: projectName ?? 'project', files } : null;
}
