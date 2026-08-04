// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Serialising read-modify-write on a project record.
 *
 * The loss this prevents: every project write reads the whole record, merges
 * its own changed files into the copy it just read, and puts it back. Two of
 * those interleaving means the loser's work is gone — and not only the file it
 * was editing, because the winner writes back its own snapshot of every file in
 * the project. Two tabs on one project is ordinary, and nothing coordinated
 * them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetRecordLocksForTests,
  withRecordLock,
} from '@ziroeda/designer/src/home/record_lock.js';

beforeEach(() => resetRecordLocksForTests());

/** A Web Locks stand-in that actually serialises, one queue per name. */
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  return {
    names,
    request<T>(name: string, fn: () => Promise<T>): Promise<T> {
      names.push(name);
      const prev = tails.get(name) ?? Promise.resolve();
      const run = prev.then(fn, fn);
      tails.set(
        name,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    },
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * A read-modify-write shaped exactly like `updateProjectFiles`: read the whole
 * record, merge one file, write the whole thing back.
 */
function makeStore() {
  let record: Record<string, string> = { 'a.kicad_sch': 'a0', 'b.kicad_sch': 'b0' };
  return {
    get record() {
      return record;
    },
    async writeFile(name: string, value: string): Promise<void> {
      const read = { ...record }; // read
      await tick(); // the window a second writer slips into
      read[name] = value; // modify
      record = read; // write
    },
  };
}

describe('the interleaving this prevents', () => {
  it('loses a file without the lock — the bug, stated', () => {
    // Left unserialised, the second write puts back its own snapshot of every
    // file, so the first write's change to a *different* file disappears.
    const store = makeStore();
    return Promise.all([
      store.writeFile('a.kicad_sch', 'a1'),
      store.writeFile('b.kicad_sch', 'b1'),
    ]).then(() => {
      const kept = [store.record['a.kicad_sch'], store.record['b.kicad_sch']];
      expect(kept).not.toEqual(['a1', 'b1']); // one of them is gone
    });
  });

  it('keeps both when the writes hold the lock', async () => {
    const store = makeStore();
    const locks = fakeLocks();
    await Promise.all([
      withRecordLock('p1', () => store.writeFile('a.kicad_sch', 'a1'), locks),
      withRecordLock('p1', () => store.writeFile('b.kicad_sch', 'b1'), locks),
    ]);
    expect(store.record['a.kicad_sch']).toBe('a1');
    expect(store.record['b.kicad_sch']).toBe('b1');
  });

  it('names the lock per record, so two projects do not block each other', async () => {
    const locks = fakeLocks();
    await withRecordLock('p1', async () => undefined, locks);
    await withRecordLock('p2', async () => undefined, locks);
    expect(locks.names).toEqual(['ziro-project:p1', 'ziro-project:p2']);
  });
});

describe('without the Web Locks API', () => {
  it('still serialises within the tab', async () => {
    // Strictly less than the real thing — it does nothing for a second tab —
    // but it is what is available, and it beats no serialisation at all.
    const store = makeStore();
    await Promise.all([
      withRecordLock('p1', () => store.writeFile('a.kicad_sch', 'a1'), null),
      withRecordLock('p1', () => store.writeFile('b.kicad_sch', 'b1'), null),
    ]);
    expect(store.record['a.kicad_sch']).toBe('a1');
    expect(store.record['b.kicad_sch']).toBe('b1');
  });

  it('a failed write does not poison the ones behind it', async () => {
    // The chain keeps the settled promise, not the rejected one.
    const store = makeStore();
    const failed = withRecordLock(
      'p1',
      async () => {
        throw new Error('quota');
      },
      null,
    );
    await expect(failed).rejects.toThrow('quota');
    await withRecordLock('p1', () => store.writeFile('a.kicad_sch', 'a1'), null);
    expect(store.record['a.kicad_sch']).toBe('a1');
  });

  it('a fire-and-forget failure does not surface as an unhandled rejection', async () => {
    // The tail keeps the *settled* promise. Storing the raw one instead leaves
    // a rejected promise in the map with no handler until the next call comes,
    // which is an unhandled rejection — and callers here really are
    // fire-and-forget (`void (async () => …)()` in the autosave path).
    const seen: unknown[] = [];
    const onUnhandled = (e: unknown): void => {
      seen.push(e);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      void withRecordLock(
        'p-fire',
        async () => {
          throw new Error('quota');
        },
        null,
      ).catch(() => undefined);
      // Let the microtask queue and one macrotask drain, which is when node
      // decides a rejection is unhandled.
      await new Promise((r) => setTimeout(r, 10));
      expect(seen).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('returns the value and propagates the throw', async () => {
    await expect(withRecordLock('p1', async () => 42, null)).resolves.toBe(42);
    await expect(
      withRecordLock(
        'p1',
        async () => {
          throw new Error('nope');
        },
        null,
      ),
    ).rejects.toThrow('nope');
  });
});
