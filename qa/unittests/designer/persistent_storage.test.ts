// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Without an account, this device's IndexedDB is the only copy of a project, and best-effort storage
 * is what a browser evicts under disk pressure: the first project saved asks for it to be kept
 * (`navigator.storage.persist()`), once a session, and a user-data folder (Symbols, Templates) is
 * not what asks.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProject } from '@ziroeda/designer/src/home/projectStore.js';
import {
  requestPersistentStorage,
  resetPersistentStorageRequestForTests,
} from '@ziroeda/designer/src/home/storageHealth.js';

let persist: ReturnType<typeof vi.fn>;
let persisted: boolean;

const stubStorage = (aStorage: unknown) => vi.stubGlobal('navigator', { storage: aStorage });

beforeEach(() => {
  resetPersistentStorageRequestForTests();
  persisted = false;
  persist = vi.fn(async () => true);
  stubStorage({ persist, persisted: async () => persisted });
});

afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise((r) => setTimeout(r, 0));
const file = { name: 'a.kicad_pro', bytes: new TextEncoder().encode('{}') };

describe('keeping this device’s projects', () => {
  it('asks once, at the first project saved', async () => {
    await saveProject('one', [file]);
    await saveProject('two', [file]);
    await settle();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('is not asked by a user-data folder', async () => {
    await saveProject('Symbols', [file], undefined, undefined, 'symbols');
    await settle();

    expect(persist).not.toHaveBeenCalled();
  });

  it('does not ask again what is already kept', async () => {
    persisted = true;

    requestPersistentStorage();
    await settle();

    expect(persist).not.toHaveBeenCalled();
  });

  it('is nothing on a browser without the API', async () => {
    stubStorage(undefined);

    expect(() => requestPersistentStorage()).not.toThrow();
  });
});
