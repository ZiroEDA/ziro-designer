// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A push costs what changed, not what the project weighs.
 *
 * Content addressing already stopped unchanged files being re-uploaded, but not
 * being re-examined: every push hashed every file, asked the store whether each
 * blob existed, and then asked again to confirm. A 107-file project spent 214
 * round trips to push nothing at all.
 *
 * The hashes now come from the local store, where they are computed once when
 * the bytes are written, and the blobs of the last landed push are taken as
 * present, because the cloud row still references them. What must not regress
 * is the safety this is trading against: a file that *did* change is still
 * stored and still confirmed before any row names it.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  deleteProject,
  exportProject,
  listProjects,
  saveProject,
  updateProjectFiles,
} from '@ziroeda/designer/src/home/projectStore.js';
import { setCloudBackend } from '@ziroeda/designer/src/cloud/cloudStore.js';
import { syncAllProjects } from '@ziroeda/designer/src/cloud/sync.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

function fake(): CloudBackend & {
  objects: Map<string, Uint8Array>;
  rows: Map<string, ProjectRow>;
  calls: string[];
} {
  const f = {
    objects: new Map<string, Uint8Array>(),
    rows: new Map<string, ProjectRow>(),
    calls: [] as string[],
    async listProjects() {
      return [...f.rows.values()].map((r) => ({ id: r.id, updated_at: r.updated_at }));
    },
    async getProject(id: string) {
      return f.rows.get(id) ?? null;
    },
    async putProject(row: ProjectRow & { user_id: string }) {
      f.calls.push(`put:${row.id}`);
      f.rows.set(row.id, row);
    },
    async deleteProject(id: string) {
      f.rows.delete(id);
    },
    async putObject(path: string, bytes: Uint8Array) {
      f.calls.push(`upload:${path}`);
      f.objects.set(path, bytes);
    },
    async getObject(path: string) {
      const b = f.objects.get(path);
      if (!b) throw new Error(`download ${path}: Object not found`);
      return b;
    },
    async hasObject(path: string) {
      f.calls.push(`stat:${path}`);
      return f.objects.has(path);
    },
    async removeObjects(paths: string[]) {
      for (const p of paths) f.objects.delete(p);
    },
  };
  return f;
}

let backend: ReturnType<typeof fake>;
beforeEach(async () => {
  for (const p of await listProjects()) await deleteProject(p.id);
  backend = fake();
  setCloudBackend(backend);
});
afterEach(() => setCloudBackend(null));

const countOf = (kind: string): number => backend.calls.filter((c) => c.startsWith(kind)).length;

/** A project of `n` files, each with distinct contents. */
const many = (n: number): { name: string; bytes: Uint8Array }[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `part${i}.kicad_mod`,
    bytes: text(`(footprint "P${i}")`),
  }));

describe('pushing a project again', () => {
  it('touches the store not at all when nothing changed', async () => {
    const id = await saveProject('Amp', many(20));
    await syncAllProjects(USER); // first push: stores everything
    backend.calls.length = 0;

    // Something unrelated moved the clock on, so it is pushed again.
    await updateProjectFiles(id, [{ name: 'part0.kicad_mod', bytes: text('(footprint "P0")') }]);
    await syncAllProjects(USER);

    // The one rewritten file has identical bytes, so its hash is unchanged and
    // it is already in the store: nothing to upload, nothing to ask about.
    expect(countOf('upload')).toBe(0);
    expect(countOf('stat')).toBe(0);
    expect(countOf('put')).toBe(1); // the row itself still commits
  });

  it('stores and confirms the file that did change, and only that one', async () => {
    const id = await saveProject('Amp', many(20));
    await syncAllProjects(USER);
    backend.calls.length = 0;

    await updateProjectFiles(id, [
      { name: 'part7.kicad_mod', bytes: text('(footprint "EDITED")') },
    ]);
    await syncAllProjects(USER);

    expect(countOf('upload')).toBe(1);
    // Exactly one blob is asked about: putBlob's existence check and the commit
    // confirmation, over the single new file.
    expect(countOf('stat')).toBe(2);
  });

  it('still refuses to commit a row naming a blob that did not land', async () => {
    // The guarantee the shortcut is trading against. A store that accepts an
    // upload and drops it must still be caught, or the row references nothing.
    const id = await saveProject('Amp', many(3));
    await syncAllProjects(USER);
    await updateProjectFiles(id, [{ name: 'part1.kicad_mod', bytes: text('(footprint "NEW")') }]);

    backend.putObject = async (path: string) => {
      backend.calls.push(`upload:${path}`);
      /* accepted, and silently dropped */
    };
    const result = await syncAllProjects(USER);

    expect(result.pushed).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.message).toContain('not in the store');
    // The previous row is untouched, so the project is still whole in the cloud.
    expect(backend.rows.get(id)!.files).toHaveLength(3);
  });

  it('hashes a file the local store has no hash for', async () => {
    // Records written before hashes were stored still push, they are just
    // hashed at push time as they always were.
    const id = await saveProject('Amp', many(2));
    const exported = await exportProject(id);
    expect(exported!.files.every((f) => f.hash)).toBe(true);

    const stripped = { ...exported!, files: exported!.files.map(({ hash: _h, ...f }) => f) };
    const { cloudUpsert } = await import('@ziroeda/designer/src/cloud/cloudStore.js');
    const manifest = await cloudUpsert(USER, stripped);

    expect(manifest).toHaveLength(2);
    expect(manifest.every((m) => m.hash.length === 64)).toBe(true);
  });
});
