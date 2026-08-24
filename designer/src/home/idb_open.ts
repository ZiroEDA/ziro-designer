// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Opening an IndexedDB connection, and the three events every opener must
 * handle but none of ours did.
 *
 * There are three databases — `ziroeda` (projects), `ziroeda-templates` and
 * `ziroeda-history` — and each had its own `openDB` caching a promise forever
 * with no event handlers at all. That is fine until any of these happens, and
 * then it is permanent:
 *
 *   versionchange  another TAB opened the same database at a higher version.
 *                  The tab holding the old one must close it or the upgrade is
 *                  blocked indefinitely - and the tab doing the upgrading just
 *                  hangs. A user with the app open twice across a deploy meets
 *                  this the first time any schema moves.
 *
 *   blocked        the other side of the same coin: our open is waiting on a
 *                  connection somebody else will not close. Silence here is a
 *                  dialog that never appears and a spinner that never stops.
 *
 *   close          the browser dropped the connection - storage evicted, quota
 *                  reclaimed, a private window discarding on exit. The cached
 *                  promise then hands every later transaction the SAME dead
 *                  connection, and every one of them fails with "Failed to
 *                  execute 'transaction' on 'IDBDatabase': The database
 *                  connection is closing." Forever, until the tab is reloaded.
 *
 * The last one is why this is a durability bug and not a tidiness one: the
 * recovery is to drop the cache and open again, which costs nothing and turns a
 * permanent failure into a hiccup.
 */

/** What a caller does to build its stores on a version change. */
export type IdbUpgrade = (db: IDBDatabase, req: IDBOpenDBRequest) => void;

export interface IdbHandle {
  /** The live connection, opening it if the last one went away. */
  get(): Promise<IDBDatabase>;
  /** Drop the cached connection so the next `get` opens a fresh one. */
  forget(): void;
}

/**
 * A lazily-opened, self-healing connection.
 *
 * `onBlocked` is called when another connection is holding the database at an
 * older version; the caller decides what to say, because only it knows whether
 * a person is waiting on it.
 */
export function idbHandle(
  name: string,
  version: number,
  upgrade: IdbUpgrade,
  onBlocked?: () => void,
): IdbHandle {
  let pending: Promise<IDBDatabase> | null = null;

  const forget = (): void => {
    pending = null;
  };

  const get = (): Promise<IDBDatabase> => {
    if (pending) return pending;

    pending = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, version);

      req.onupgradeneeded = () => upgrade(req.result, req);
      req.onblocked = () => onBlocked?.();

      req.onsuccess = () => {
        const db = req.result;

        // Another tab wants to upgrade. Close so it can, and forget the
        // connection so our next call opens the new version rather than
        // handing out a closed one.
        db.onversionchange = () => {
          db.close();
          forget();
        };

        // The browser dropped it - evicted, reclaimed, or a private window
        // discarding. Nothing to do but stop handing it out.
        db.onclose = () => forget();

        resolve(db);
      };

      req.onerror = () => {
        forget();
        reject(req.error);
      };
    }).catch((err: unknown) => {
      // A failed open must not be cached as a permanent failure either.
      forget();
      throw err;
    });

    return pending;
  };

  return { get, forget };
}
