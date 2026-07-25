/**
 * Storage health — does persistence actually work, and has it started failing?
 *
 * The project store is the only thing standing between a user and losing hours
 * of layout work, and it can fail for reasons that are invisible until a reload
 * throws the work away: the origin is over quota (a big board plus plots and 3D
 * models adds up fast), site data is blocked, or the browser handed us an
 * ephemeral private-mode store that evaporates when the tab closes.
 *
 * So we do two things instead of assuming it works:
 *
 *   1. `probeStorage()` at boot — a real round-trip (write a canary, read it
 *      back, delete it) rather than a `typeof indexedDB` feature check, which
 *      only proves the API exists.
 *   2. `reportStorageFailure()` from the store's write path — persistence can
 *      break *during* a session (quota fills up mid-edit), long after a clean
 *      boot probe. Subscribers surface it immediately.
 *
 * Nothing here throws: a health check that breaks the app it's protecting would
 * be worse than the problem.
 */

/** Why persistence is unusable, in terms we can show a user. */
export type StorageFailure =
  | 'unsupported' // no IndexedDB at all
  | 'blocked' // opening the database was refused (site data blocked)
  | 'quota' // out of space
  | 'unknown';

export interface StorageStatus {
  ok: boolean;
  failure?: StorageFailure;
  /** Bytes in use / available, when the browser will tell us. */
  usage?: number;
  quota?: number;
}

/** Reserved project id used by the boot probe; never a real project. */
export const PROBE_ID = '__ziro_storage_probe__';

/**
 * Classify a thrown IndexedDB error. Quota shows up under several names across
 * engines — the DOMException name, the legacy code (22), and Firefox's
 * message-only form — so check all three rather than trusting one.
 */
export function classifyError(err: unknown): StorageFailure {
  const e = err as { name?: string; code?: number; message?: string } | null;
  const name = e?.name ?? '';
  const msg = e?.message ?? '';
  if (name === 'QuotaExceededError' || e?.code === 22 || /quota/i.test(msg)) return 'quota';
  if (name === 'SecurityError' || name === 'InvalidStateError' || /denied|blocked/i.test(msg))
    return 'blocked';
  return 'unknown';
}

// ----- live failure reporting -------------------------------------------------

type Listener = (status: StorageStatus) => void;
const listeners = new Set<Listener>();
let current: StorageStatus = { ok: true };

/** The last known health, for components mounting after a failure. */
export const storageStatus = (): StorageStatus => current;

/** Subscribe to health changes. Returns an unsubscribe function. */
export function subscribeStorageHealth(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(status: StorageStatus): void {
  current = status;
  for (const fn of listeners) {
    try {
      fn(status);
    } catch {
      /* a broken listener must not break persistence */
    }
  }
}

/**
 * Called by the store when a write fails. Latches unhealthy — once persistence
 * has dropped work we keep saying so until a probe proves it recovered, because
 * a single successful write afterwards does not bring back what was lost.
 */
export function reportStorageFailure(err: unknown): void {
  const failure = classifyError(err);
  if (!current.ok && current.failure === failure) return; // already reported
  void withEstimate({ ok: false, failure }).then(emit);
}

/** Called by the store after a write commits, to clear a transient failure. */
export function reportStorageOk(): void {
  if (current.ok) return;
  emit({ ok: true });
}

/** Attach usage/quota numbers when the browser exposes them. */
async function withEstimate(status: StorageStatus): Promise<StorageStatus> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) return { ...status, usage: est.usage, quota: est.quota };
  } catch {
    /* estimate is advisory only */
  }
  return status;
}

// ----- boot probe -------------------------------------------------------------

/**
 * Prove persistence works with a real write/read/delete round-trip against the
 * live database, so we find out at boot rather than when the user reloads.
 *
 * The canary goes into the existing `projects` store under {@link PROBE_ID}
 * rather than a dedicated object store: adding one would mean a version bump,
 * and a version bump blocks indefinitely when the user has the app open in a
 * second tab. Listings filter the id out in case a probe dies mid-round-trip.
 */
export async function probeStorage(
  openDB: () => Promise<IDBDatabase>,
  storeName: string,
): Promise<StorageStatus> {
  if (typeof indexedDB === 'undefined') {
    const status: StorageStatus = { ok: false, failure: 'unsupported' };
    emit(status);
    return status;
  }
  try {
    const db = await openDB();
    const canary = { id: PROBE_ID, name: PROBE_ID, createdAt: 0, updatedAt: 0, files: [] };
    await runTx(db, storeName, 'readwrite', (s) => s.put(canary));
    const read = await runTx<unknown>(db, storeName, 'readonly', (s) => s.get(PROBE_ID));
    await runTx(db, storeName, 'readwrite', (s) => s.delete(PROBE_ID));
    if (!read) {
      // Wrote without error, but it wasn't there on read-back — the store is
      // lying to us, which is exactly the silent-loss case we're hunting.
      const status = await withEstimate({ ok: false, failure: 'unknown' });
      emit(status);
      return status;
    }
    const status = await withEstimate({ ok: true });
    emit(status);
    return status;
  } catch (err) {
    const status = await withEstimate({ ok: false, failure: classifyError(err) });
    emit(status);
    return status;
  }
}

/**
 * Run one transaction, resolving only once it has *committed*.
 *
 * A plain `request.onsuccess` is not proof of durability: IndexedDB reports
 * quota exhaustion and other commit-time faults by aborting the transaction
 * after its individual requests have already succeeded. Waiting for
 * `oncomplete` on writes is the difference between knowing the bytes landed and
 * merely knowing they were accepted.
 */
export function runTx<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(storeName, mode);
    } catch (err) {
      reject(err); // e.g. InvalidStateError when the connection is closing
      return;
    }
    let result: T;
    const req = fn(t.objectStore(storeName));
    req.onsuccess = () => {
      result = req.result;
    };
    req.onerror = () => reject(req.error);
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error);
    t.onerror = () => reject(t.error);
  });
}
