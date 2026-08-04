// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Serialise read-modify-write on a stored project record.
 *
 * Every write to a project is read-modify-write over the *whole* record: read
 * it, merge the changed files into the copy just read, put it back. Two of
 * those interleaving is silent, total loss of the loser's work — and not only
 * of the file it was editing. The winner writes back its own snapshot of
 * **every** file in the project, so an edit the other tab made to a different
 * sheet minutes earlier goes with it.
 *
 * That is not a hypothetical: opening the same project in two tabs is
 * ordinary, autosave fires on a 1.2 s debounce in both, and nothing coordinated
 * them.
 *
 * `navigator.locks` is the right primitive. It serialises across every tab and
 * worker in the browser profile, which is exactly the scope of the problem, and
 * it releases automatically when a tab dies — a lock held by a crashed tab
 * cannot wedge the app, which is the failure mode a hand-rolled flag in
 * localStorage would have.
 *
 * Where the API is missing, the fallback chains the work per record *within
 * this tab*. That is strictly less than the real thing and it is stated rather
 * than hidden: it fixes overlapping saves in one tab and does nothing for two.
 * The alternative — no serialisation at all — is what this replaces.
 */

interface LockManagerLike {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** Per-record tail of pending work, for the no-Web-Locks fallback. */
const chains = new Map<string, Promise<unknown>>();

function locksApi(): LockManagerLike | null {
  const nav = globalThis.navigator as { locks?: LockManagerLike } | undefined;
  return nav?.locks ?? null;
}

/**
 * Run `fn` holding an exclusive lock on `id`. Returns whatever it returns; a
 * throw propagates, and the lock is released either way.
 */
export async function withRecordLock<T>(
  id: string,
  fn: () => Promise<T>,
  api: LockManagerLike | null = locksApi(),
): Promise<T> {
  const name = `ziro-project:${id}`;
  if (api) return api.request(name, fn);

  // Fallback: chain on the previous operation for this record. The tail keeps
  // the *settled* promise, so one failure does not poison every later write.
  const prev = chains.get(name) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(
    name,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  try {
    return await run;
  } finally {
    // Drop the entry once this is the last operation, so the map cannot grow
    // for the lifetime of the tab.
    if (chains.get(name) !== undefined) {
      const tail = chains.get(name)!;
      void tail.then(() => {
        if (chains.get(name) === tail) chains.delete(name);
      });
    }
  }
}

/** Test seam: forget the fallback chains. */
export function resetRecordLocksForTests(): void {
  chains.clear();
}
