// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Storage durability, transaction commit semantics, failure classification and
 * live health reporting (designer/src/home/storageHealth.ts).
 *
 * The behaviour under test is the one that silently lost work: IndexedDB
 * reports quota exhaustion by *aborting the transaction* after its individual
 * requests have already fired `onsuccess`, so resolving on request success
 * reported a clean save for bytes that never landed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  classifyError,
  RECHECK_MS,
  reportStorageFailure,
  reportStorageOk,
  runTx,
  setStorageRecheck,
  storageStatus,
  subscribeStorageHealth,
} from '@ziroeda/designer/src/home/storageHealth.js';

/** Let queued microtasks and the health layer's async estimate settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * A minimal IndexedDB stand-in. `script` runs after `runTx` has attached its
 * handlers, and drives the request/transaction events in whatever order the
 * scenario needs.
 */
interface FakeReq {
  result: unknown;
  error: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
}
interface FakeTx {
  error: unknown;
  oncomplete?: () => void;
  onabort?: () => void;
  onerror?: () => void;
  objectStore: () => unknown;
}

function fakeDb(script: (h: { req: FakeReq; t: FakeTx }) => void): IDBDatabase {
  const req: FakeReq = { result: undefined, error: null };
  const store = { put: () => req, get: () => req, delete: () => req, getAll: () => req };
  // The transaction object is handed to runTx directly (not spread) so the
  // handlers it assigns are the ones `script` fires.
  const t: FakeTx = { error: null, objectStore: () => store };
  return {
    transaction: () => {
      queueMicrotask(() => script({ req, t }));
      return t as unknown as IDBTransaction;
    },
  } as unknown as IDBDatabase;
}

describe('runTx transaction semantics', () => {
  it('resolves a write only once the transaction commits', async () => {
    const db = fakeDb(({ req, t }) => {
      req.result = 'ok';
      req.onsuccess?.();
      t.oncomplete?.();
    });
    await expect(runTx(db, 'projects', 'readwrite', (s) => s.put({}) as never)).resolves.toBe('ok');
  });

  it('rejects when the transaction aborts after the request succeeded', async () => {
    // The quota case: the put reports success, then the commit is refused.
    const db = fakeDb(({ req, t }) => {
      req.result = 'ok';
      req.onsuccess?.();
      t.error = { name: 'QuotaExceededError' };
      t.onabort?.();
    });
    await expect(
      runTx(db, 'projects', 'readwrite', (s) => s.put({}) as never),
    ).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });

  it('rejects when the request itself errors', async () => {
    const db = fakeDb(({ req }) => {
      req.error = { name: 'DataError' };
      req.onerror?.();
    });
    await expect(
      runTx(db, 'projects', 'readwrite', (s) => s.put({}) as never),
    ).rejects.toMatchObject({ name: 'DataError' });
  });

  it('rejects when opening the transaction throws', async () => {
    const db = {
      transaction: () => {
        throw Object.assign(new Error('closing'), { name: 'InvalidStateError' });
      },
    } as unknown as IDBDatabase;
    await expect(runTx(db, 'projects', 'readonly', (s) => s.get('x') as never)).rejects.toThrow(
      'closing',
    );
  });
});

describe('classifyError', () => {
  it('recognises quota by DOMException name', () => {
    expect(classifyError({ name: 'QuotaExceededError' })).toBe('quota');
  });

  it('recognises quota by the legacy numeric code', () => {
    expect(classifyError({ code: 22 })).toBe('quota');
  });

  it('recognises quota from a message-only error', () => {
    expect(classifyError(new Error('The current transaction exceeded its quota limits'))).toBe(
      'quota',
    );
  });

  it('recognises blocked storage', () => {
    expect(classifyError({ name: 'SecurityError' })).toBe('blocked');
  });

  it('falls back to unknown', () => {
    expect(classifyError(new Error('something else'))).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
  });
});

describe('health reporting', () => {
  beforeEach(async () => {
    reportStorageOk();
    await settle();
  });

  it('notifies subscribers when a write fails', async () => {
    const seen: string[] = [];
    const off = subscribeStorageHealth((s) => seen.push(s.ok ? 'ok' : (s.failure ?? '?')));
    reportStorageFailure({ name: 'QuotaExceededError' });
    await settle();
    expect(seen).toContain('quota');
    expect(storageStatus().ok).toBe(false);
    off();
  });

  it('stays unhealthy until explicitly cleared, one good write does not undo lost work', async () => {
    reportStorageFailure({ name: 'QuotaExceededError' });
    await settle();
    reportStorageFailure({ name: 'QuotaExceededError' });
    await settle();
    expect(storageStatus().ok).toBe(false);

    reportStorageOk();
    await settle();
    expect(storageStatus().ok).toBe(true);
  });

  it('does not let a throwing subscriber break reporting', async () => {
    const off1 = subscribeStorageHealth(() => {
      throw new Error('bad listener');
    });
    let reached = false;
    const off2 = subscribeStorageHealth(() => {
      reached = true;
    });
    reportStorageFailure({ name: 'SecurityError' });
    await settle();
    expect(reached).toBe(true);
    off1();
    off2();
  });

  it('unsubscribes cleanly', async () => {
    let calls = 0;
    const off = subscribeStorageHealth(() => calls++);
    off();
    reportStorageFailure({ name: 'SecurityError' });
    await settle();
    expect(calls).toBe(0);
  });
});

/**
 * The stuck-banner bug: a transient failure latched the banner, and because
 * `reportStorageOk` fires only on the next successful write, a user who then
 * stopped editing never lifted it — and the banner cannot be dismissed. While
 * unhealthy the health layer now re-runs the probe on a timer, so a failure
 * that has passed clears itself.
 */
describe('self-healing recheck while latched', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    reportStorageOk();
    await vi.advanceTimersByTimeAsync(0);
  });
  afterEach(() => {
    setStorageRecheck(null as unknown as () => Promise<never>);
    vi.useRealTimers();
  });

  it('re-probes a recoverable failure and clears when the probe passes', async () => {
    let probes = 0;
    // First probe still fails (the blip has not passed), the second succeeds.
    setStorageRecheck(async () => {
      probes += 1;
      if (probes >= 2) {
        reportStorageOk();
        return { ok: true };
      }
      reportStorageFailure({ name: 'InvalidStateError' }); // connection closing
      return { ok: false, failure: 'blocked' };
    });

    reportStorageFailure({ name: 'InvalidStateError' });
    await vi.advanceTimersByTimeAsync(0);
    expect(storageStatus().ok).toBe(false);
    expect(probes).toBe(0); // scheduled, not yet fired

    await vi.advanceTimersByTimeAsync(RECHECK_MS);
    expect(probes).toBe(1);
    expect(storageStatus().ok).toBe(false); // still bad: it reschedules

    await vi.advanceTimersByTimeAsync(RECHECK_MS);
    expect(probes).toBe(2);
    expect(storageStatus().ok).toBe(true); // recovered, banner clears

    // Cleared means cleared: no further probes once healthy.
    await vi.advanceTimersByTimeAsync(RECHECK_MS * 3);
    expect(probes).toBe(2);
  });

  it('keeps re-probing a genuine ongoing failure until it recovers', async () => {
    let probes = 0;
    // Quota stays full for three checks, then space is freed.
    setStorageRecheck(async () => {
      probes += 1;
      if (probes >= 4) {
        reportStorageOk();
        return { ok: true };
      }
      reportStorageFailure({ name: 'QuotaExceededError' });
      return { ok: false, failure: 'quota' };
    });

    reportStorageFailure({ name: 'QuotaExceededError' });
    await vi.advanceTimersByTimeAsync(0);

    // It does not give up after one failed re-probe.
    await vi.advanceTimersByTimeAsync(RECHECK_MS * 3);
    expect(probes).toBe(3);
    expect(storageStatus().ok).toBe(false);

    await vi.advanceTimersByTimeAsync(RECHECK_MS);
    expect(probes).toBe(4);
    expect(storageStatus().ok).toBe(true);
  });

  it('does not schedule a recheck when no probe is registered', async () => {
    setStorageRecheck(null as unknown as () => Promise<never>);
    reportStorageFailure({ name: 'QuotaExceededError' });
    await vi.advanceTimersByTimeAsync(RECHECK_MS * 2);
    // Nothing to run and nothing to throw: the failure just stays latched.
    expect(storageStatus().ok).toBe(false);
  });
});
