// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Blobs are stored under a two-character prefix, and the flat layout stays
 * readable forever.
 *
 * Asking whether an object exists costs a directory listing, and every blob of
 * every project of one user sat in a single folder: that listing grew with
 * everything the account had ever saved, and started answering 504, which fails
 * a push outright. The name is already a uniform hash, so a two-character level
 * spreads them by construction.
 *
 * The half that can lose data is the other one. Blobs written before the split
 * are not moved — copying every object of every user is not a migration anyone
 * should run — so anything that asks "is this blob there" has to accept both
 * layouts. `cloudMissingObjects` drives a repair that overwrites the cloud copy;
 * a blob reported missing merely because it predates the split would be a
 * fabricated loss, followed by a real one.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import {
  cloudGet,
  cloudMissingObjects,
  cloudUpsert,
  setCloudBackend,
} from '@ziroeda/designer/src/cloud/cloudStore.js';
import { blobPath, flatBlobPath, sha256Hex } from '@ziroeda/designer/src/cloud/blobStore.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

interface Fake extends CloudBackend {
  objects: Map<string, Uint8Array>;
  rows: Map<string, ProjectRow>;
  listed: string[];
}

function fake(): Fake {
  const f: Fake = {
    objects: new Map(),
    rows: new Map(),
    listed: [],
    async listProjects() {
      return [...f.rows.values()].map((r) => ({ id: r.id, updated_at: r.updated_at }));
    },
    async getProject(id) {
      return f.rows.get(id) ?? null;
    },
    async putProject(row) {
      f.rows.set(row.id, row);
    },
    async deleteProject(id) {
      f.rows.delete(id);
    },
    async putObject(path, bytes) {
      f.objects.set(path, bytes);
    },
    async getObject(path) {
      const b = f.objects.get(path);
      if (!b) throw new Error(`download ${path}: Object not found`);
      return b;
    },
    async hasObject(path) {
      // Records the folder each question scans, which is the cost this layout
      // exists to bound.
      f.listed.push(path.slice(0, path.lastIndexOf('/')));
      return f.objects.has(path);
    },
    async removeObjects(paths) {
      for (const p of paths) f.objects.delete(p);
    },
  };
  return f;
}

let backend: Fake;
const install = (): Fake => {
  backend = fake();
  setCloudBackend(backend);
  return backend;
};
afterEach(() => setCloudBackend(null));

const project = (files: Record<string, string>, id = 'p1') => ({
  id,
  name: 'Amp',
  createdAt: 1_000,
  updatedAt: 2_000,
  files: Object.entries(files).map(([name, text]) => ({ name, gzB64: b64(text) })),
});

describe('where a blob is stored', () => {
  it('puts it under the first two characters of its hash', async () => {
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }));

    const [key] = [...f.objects.keys()];
    const hash = key!.split('/').pop()!;
    expect(key).toBe(`${USER}/blobs/${hash.slice(0, 2)}/${hash}`);
    // And nothing was asked about the undivided folder.
    expect(f.listed).not.toContain(`${USER}/blobs`);
  });

  it('spreads a project across many folders rather than one', async () => {
    const f = install();
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i++) files[`f${i}.kicad_mod`] = `(footprint "F${i}")`;
    await cloudUpsert(USER, project(files));

    const folders = new Set([...f.objects.keys()].map((k) => k.slice(0, k.lastIndexOf('/'))));
    // The exact count is a property of the hashes, not of the code; what
    // matters is that it is not one folder holding everything.
    expect(folders.size).toBeGreaterThan(20);
  });
});

describe('blobs written before the split', () => {
  /** Store `text` the old way and return a row naming it. */
  async function legacyRow(id: string, name: string, text: string): Promise<string> {
    const bytes = new Uint8Array(Buffer.from(text, 'utf8'));
    const hash = await sha256Hex(bytes);
    backend.objects.set(flatBlobPath(USER, hash), bytes);
    backend.rows.set(id, {
      id,
      user_id: USER,
      name,
      created_at: new Date(1_000).toISOString(),
      updated_at: new Date(2_000).toISOString(),
      files: [{ name, hash, size: bytes.length }],
    });
    return hash;
  }

  it('are still readable', async () => {
    install();
    await legacyRow('p-old', 'a.kicad_sch', 'ORIGINAL');

    const p = await cloudGet('p-old');
    expect(Buffer.from(p!.files[0]!.gzB64, 'base64').toString('utf8')).toBe('ORIGINAL');
  });

  it('are not reported as missing', async () => {
    // The dangerous one. A blob called missing here is treated as damage, and
    // the repair replaces the cloud copy with whatever is on this machine.
    install();
    await legacyRow('p-old', 'a.kicad_sch', 'ORIGINAL');

    expect(await cloudMissingObjects('p-old')).toMatchObject({ missing: 0, total: 1 });
  });

  it('are still reported as missing when they really are gone', async () => {
    // The check must not have become one that always says yes.
    const f = install();
    const hash = await legacyRow('p-old', 'a.kicad_sch', 'ORIGINAL');
    f.objects.delete(flatBlobPath(USER, hash));

    expect(await cloudMissingObjects('p-old')).toMatchObject({ missing: 1, total: 1 });
  });

  it('move to the new layout when the project is pushed again', async () => {
    const f = install();
    const hash = await legacyRow('p-old', 'a.kicad_sch', 'ORIGINAL');

    await cloudUpsert(USER, project({ 'a.kicad_sch': 'ORIGINAL' }, 'p-old'));

    expect(f.objects.has(blobPath(USER, hash))).toBe(true);
    // The old copy is left exactly where it is: other rows may name it, and it
    // may be the only copy of something.
    expect(f.objects.has(flatBlobPath(USER, hash))).toBe(true);
  });
});
