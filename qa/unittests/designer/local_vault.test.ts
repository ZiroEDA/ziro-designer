// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The local store at rest: docs/encryption-plan.md P2.
 *
 * Two halves. The envelope and the seal are pure and tested as such. Then the
 * project store itself, over fake-indexeddb, is asked the question the wall
 * could not answer: with the account open, what does the database actually
 * hold, and with it locked, what can be read back.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decodeEnvelope,
  encodeEnvelope,
  isSealed,
  localVaultOpen,
  openRecord,
  sealRecord,
  setLocalVaultFromMasterKey,
  setLocalVaultKey,
} from '@ziroeda/designer/src/home/local_vault.js';
import {
  listProjects,
  loadProject,
  saveProject,
  sealLocalStore,
  setProjectOwner,
} from '@ziroeda/designer/src/home/projectStore.js';

const KEY = new Uint8Array(32).fill(0x11);
const OTHER = new Uint8Array(32).fill(0x22);
const bytes = (s: string) => new TextEncoder().encode(s);

afterEach(() => setLocalVaultKey(null));

describe('the envelope carries a record with its binary fields intact', () => {
  it('round-trips nested objects, arrays and every typed-array kind, byte for byte', () => {
    const rec = {
      id: 'p1',
      name: 'Amp',
      files: [
        { name: 'a', gz: new Uint8Array([1, 2, 3]) },
        { name: 'b', gz: new Uint8Array(0) },
      ],
      tess: {
        position: new Float32Array([1.5, -2.25]),
        index: new Uint32Array([7, 8, 9]),
        normal: null,
      },
      n: 42,
      flag: true,
    };
    const back = decodeEnvelope<typeof rec>(encodeEnvelope(rec));
    expect(back.name).toBe('Amp');
    expect([...back.files[0]!.gz]).toEqual([1, 2, 3]);
    expect(back.files[1]!.gz).toBeInstanceOf(Uint8Array);
    expect(back.files[1]!.gz.length).toBe(0);
    expect(back.tess.position).toBeInstanceOf(Float32Array);
    expect([...back.tess.position]).toEqual([1.5, -2.25]);
    expect(back.tess.index).toBeInstanceOf(Uint32Array);
    expect([...back.tess.index]).toEqual([7, 8, 9]);
    expect(back.tess.normal).toBeNull();
    expect(back.n).toBe(42);
  });

  it('does not base64: the bytes are in the envelope raw', () => {
    const gz = new Uint8Array(1000).fill(0xab);
    const env = encodeEnvelope({ id: 'x', gz });
    expect(env.length).toBeLessThan(1000 + 100);
  });
});

describe('sealing a record', () => {
  it('keeps only the named fields in the clear; the rest is one ciphertext', async () => {
    setLocalVaultKey(KEY);
    const sealed = await sealRecord(
      { id: 'p1', updatedAt: 5, name: 'Amp', files: [{ name: 'a.kicad_pcb', gz: bytes('BOARD') }] },
      ['id', 'updatedAt'],
    );
    expect(isSealed(sealed)).toBe(true);
    const json = JSON.stringify(sealed, (_k, v) =>
      v instanceof Uint8Array ? `<${v.length} bytes>` : v,
    );
    expect(json).toContain('"id":"p1"');
    expect(json).toContain('"updatedAt":5');
    expect(json).not.toContain('Amp');
    expect(json).not.toContain('kicad_pcb');
    expect(Buffer.from((sealed as { sealed: Uint8Array }).sealed).toString('latin1')).not.toContain(
      'BOARD',
    );
  });

  it('opens with the same key, to the same record', async () => {
    setLocalVaultKey(KEY);
    const rec = { id: 'p1', updatedAt: 5, name: 'Amp', files: [{ name: 'a', gz: bytes('BOARD') }] };
    const back = await openRecord<typeof rec>(await sealRecord(rec, ['id', 'updatedAt']));
    expect(back?.name).toBe('Amp');
    expect(back?.id).toBe('p1');
    expect(Buffer.from(back!.files[0]!.gz).toString()).toBe('BOARD');
  });

  it("is null under another account's key, and null with no key at all", async () => {
    setLocalVaultKey(KEY);
    const sealed = await sealRecord({ id: 'p1', updatedAt: 5, name: 'Amp' }, ['id', 'updatedAt']);
    setLocalVaultKey(OTHER);
    expect(await openRecord(sealed)).toBeNull();
    setLocalVaultKey(null);
    expect(await openRecord(sealed)).toBeNull();
  });

  it('with no vault, a record is stored and read as it is (a build without an account)', async () => {
    const rec = { id: 'p1', updatedAt: 5, name: 'Amp' };
    expect(await sealRecord(rec, ['id'])).toBe(rec);
    expect(await openRecord(rec)).toBe(rec);
  });

  it('the vault key is derived from the master key under its own label, not the master key itself', async () => {
    await setLocalVaultFromMasterKey(KEY);
    expect(localVaultOpen()).toBe(true);
    const sealed = await sealRecord({ id: 'p1', updatedAt: 1, name: 'x' }, ['id']);
    setLocalVaultKey(KEY); // the master key used directly must NOT open it
    expect(await openRecord(sealed)).toBeNull();
    await setLocalVaultFromMasterKey(null);
    expect(localVaultOpen()).toBe(false);
  });
});

describe('the project store, at rest', () => {
  beforeEach(() => setProjectOwner(null));

  /** What IndexedDB holds for a record, raw. */
  const raw = async (id: string): Promise<Record<string, unknown> | undefined> =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open('ziroeda');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const req = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        req.onsuccess = () => {
          db.close();
          resolve(req.result as Record<string, unknown> | undefined);
        };
        req.onerror = () => reject(req.error);
      };
    });

  it('with the account open, the database holds neither the name nor a file of a saved project', async () => {
    setLocalVaultKey(KEY);
    const id = await saveProject('Secret Amp', [
      { name: 'amp.kicad_pcb', bytes: bytes('BOARD BYTES') },
    ]);
    const row = await raw(id);
    expect(row).toBeDefined();
    expect(Object.keys(row!).sort()).toEqual(['id', 'sealed', 'updatedAt', 'v']);
    // And the store reads it back whole.
    expect((await listProjects()).map((p) => p.name)).toContain('Secret Amp');
    const loaded = await loadProject(id);
    expect(loaded?.files.map((f) => f.name)).toEqual(['amp.kicad_pcb']);
  });

  it('locked, the same store lists nothing and loads nothing', async () => {
    setLocalVaultKey(KEY);
    const id = await saveProject('Secret Amp', [{ name: 'a', bytes: bytes('X') }]);
    setLocalVaultKey(null);
    expect((await listProjects()).map((p) => p.id)).not.toContain(id);
    expect(await loadProject(id)).toBeNull();
    // Another account on the same browser sees it no better.
    setLocalVaultKey(OTHER);
    expect((await listProjects()).map((p) => p.id)).not.toContain(id);
  });

  it('a store written before the vault is sealed on the first open, in place', async () => {
    setLocalVaultKey(null);
    const id = await saveProject('Old plaintext', [{ name: 'a', bytes: bytes('X') }]);
    expect((await raw(id))!.name).toBe('Old plaintext');
    setLocalVaultKey(KEY);
    expect(await sealLocalStore()).toBeGreaterThanOrEqual(1);
    const row = await raw(id);
    expect(row!.name).toBeUndefined();
    expect(row!.sealed).toBeInstanceOf(Uint8Array);
    expect((await listProjects()).map((p) => p.name)).toContain('Old plaintext');
  });
});
