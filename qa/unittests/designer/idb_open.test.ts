// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A dropped IndexedDB connection must not be permanent.
 *
 * Akshay hit "Failed to execute 'transaction' on 'IDBDatabase': The database
 * connection is closing." in the file chooser, with the storage-health banner
 * up beside it. Two things can close a connection - another tab upgrading the
 * schema, or the browser evicting site storage - and all three of our stores
 * cached the connection promise FOREVER with no event handlers, so once it went
 * the same dead connection was handed to every transaction after it. Until a
 * reload. That is what makes it a durability bug rather than a nuisance.
 *
 * The version that moved was `ziroeda-templates` (1 -> 2), which is exactly the
 * shape that blocks a second tab holding the old one open.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { idbHandle } from '@ziroeda/designer/src/home/idb_open.js';

let n = 0;
const freshName = (): string => `t${++n}`;

const upgrade = (d: IDBDatabase): void => {
  if (!d.objectStoreNames.contains('s')) d.createObjectStore('s', { keyPath: 'id' });
};

describe('the connection is cached while it is alive', () => {
  it('opens once and reuses it', async () => {
    const h = idbHandle(freshName(), 1, upgrade);
    const [a, b] = await Promise.all([h.get(), h.get()]);
    expect(a).toBe(b);
  });
});

describe('and opened again once it is gone', () => {
  it('reopens after the browser closes it', async () => {
    const h = idbHandle(freshName(), 1, upgrade);
    const first = await h.get();

    // What the browser does when it evicts storage or reclaims quota: it fires
    // `close` on the connection. It fires ONLY on abnormal closure - never when
    // you call `close()` yourself - so the handler is invoked the way the
    // browser would invoke it. fake-indexeddb will not accept a DOM `Event`
    // through `dispatchEvent`, which is a limit of the fake rather than a
    // reason to test something else.
    expect(typeof first.onclose, 'onclose was never wired').toBe('function');
    (first.onclose as (ev: Event) => void)(new Event('close'));

    const second = await h.get();
    expect(second, 'the dead connection was handed out again').not.toBe(first);
    // ...and it actually works, which is the whole point.
    await new Promise<void>((resolve, reject) => {
      const t = second.transaction('s', 'readwrite');
      t.objectStore('s').put({ id: 1 });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  });

  it('reopens after `forget`, which is what versionchange calls', async () => {
    const h = idbHandle(freshName(), 1, upgrade);
    const first = await h.get();
    h.forget();
    expect(await h.get()).not.toBe(first);
  });

  it('does not cache a FAILED open as a permanent failure', async () => {
    // An open that throws must not poison the handle: the next call has to try
    // again, or one transient failure ends the session.
    const name = freshName();
    let boom = true;
    const h = idbHandle(name, 1, (d) => {
      if (boom) throw new Error('upgrade failed');
      upgrade(d);
    });
    await expect(h.get()).rejects.toBeDefined();
    boom = false;
    h.forget();
    await expect(h.get()).resolves.toBeDefined();
  });
});

describe('another tab is let through instead of blocked', () => {
  it('closes on versionchange so a higher version can open', async () => {
    const name = freshName();
    const h = idbHandle(name, 1, upgrade);
    await h.get();

    // The second tab. Without our `onversionchange` closing the first
    // connection this open never completes.
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('s2'))
          req.result.createObjectStore('s2', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked: the old connection was never closed'));
    });

    expect(upgraded.version).toBe(2);
    upgraded.close();
  });
});
