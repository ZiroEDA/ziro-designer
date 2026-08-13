// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A cloud copy whose objects are not in the store gets replaced, not retried.
 *
 * Rows written before the commit protocol existed name files at the mutable
 * `<user>/<project>/<file>.gz` path, and were rewritten without those objects
 * ever landing. Every download of one fails with "Object not found", so the
 * project fails on every sync, forever, and the user is shown a storage path
 * they cannot act on. Eleven projects in one account are in exactly that state.
 *
 * Such a row is not a copy of anything: nobody can read it, so there is nothing
 * to weigh against the local copy. The repair pushes the local one over it.
 *
 * The dangerous half is telling that apart from a bad connection, because the
 * repair overwrites the cloud. `hasObject` answering "absent" is damage; a
 * `hasObject` that *throws* is not an answer at all, and must leave the cloud
 * copy alone.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  deleteProject,
  exportProject,
  importProject,
  listProjects,
  markSynced,
  saveProject,
} from '@ziroeda/designer/src/home/projectStore.js';
import { setCloudBackend } from '@ziroeda/designer/src/cloud/cloudStore.js';
import { syncAllProjects } from '@ziroeda/designer/src/cloud/sync.js';
import { blobPath } from '@ziroeda/designer/src/cloud/blobStore.js';
import { isManifestEntry } from '@ziroeda/designer/src/cloud/backend.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

function fake(): CloudBackend & {
  objects: Map<string, Uint8Array>;
  rows: Map<string, ProjectRow>;
  /**
   * Paths whose existence cannot be established: a permission error, a dropped
   * connection, a partial outage. Scoped rather than global on purpose, so the
   * repair is not prevented merely by the rest of storage also being down.
   */
  cannotStat: RegExp | null;
} {
  const f = {
    objects: new Map<string, Uint8Array>(),
    rows: new Map<string, ProjectRow>(),
    cannotStat: null as RegExp | null,
    async listProjects() {
      return [...f.rows.values()].map((r) => ({ id: r.id, updated_at: r.updated_at }));
    },
    async getProject(id: string) {
      return f.rows.get(id) ?? null;
    },
    async putProject(row: ProjectRow & { user_id: string }) {
      f.rows.set(row.id, row);
    },
    async deleteProject(id: string) {
      f.rows.delete(id);
    },
    async putObject(path: string, bytes: Uint8Array) {
      f.objects.set(path, bytes);
    },
    async getObject(path: string) {
      const b = f.objects.get(path);
      if (!b) throw new Error(`download ${path}: Object not found`);
      return b;
    },
    async hasObject(path: string) {
      if (f.cannotStat?.test(path)) throw new Error(`stat ${path}: network error`);
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
  // fake-indexeddb persists for the whole file, and every test here counts what
  // a full sync did, so a project left behind by the previous one is an extra
  // transfer in this one's totals.
  for (const p of await listProjects()) await deleteProject(p.id);
  backend = fake();
  setCloudBackend(backend);
});
afterEach(() => setCloudBackend(null));

/**
 * The damaged shape, exactly as it exists in the account today: a row that
 * lists file *names*, whose objects were never stored, and which is newer than
 * the local copy so reconciliation chooses to pull it.
 */
async function legacyRowWithNoObjects(id: string, name: string): Promise<void> {
  backend.rows.set(id, {
    id,
    user_id: USER,
    name,
    created_at: new Date(1_000).toISOString(),
    updated_at: new Date(Date.now() + 60_000).toISOString(),
    files: [{ name: 'board.kicad_pcb' }, { name: 'ecc83/3d_shapes/ecc83.wrl' }],
  } as ProjectRow);
}

describe('a cloud copy whose objects are gone', () => {
  it('is replaced by the local copy instead of failing every sync', async () => {
    const id = await saveProject('CM5', [
      { name: 'board.kicad_pcb', bytes: text('(kicad_pcb (version 20241229))') },
    ]);
    await markSynced(id); // it has synced before, as the stuck projects have
    await legacyRowWithNoObjects(id, 'CM5');

    const result = await syncAllProjects(USER);

    expect(result.failures).toEqual([]);
    expect(result.healed).toBe(1);
    expect(result.pulled).toBe(0);

    // The row is now a content-addressed manifest whose blobs are all present:
    // readable by any client, which is what "repaired" has to mean.
    const row = backend.rows.get(id)!;
    expect(row.files.every(isManifestEntry)).toBe(true);
    expect(row.files).toHaveLength(1);
    for (const f of row.files) {
      expect(backend.objects.has(blobPath(USER, (f as { hash: string }).hash))).toBe(true);
    }
  });

  it('leaves the cloud alone when the store cannot say whether the objects exist', async () => {
    // The distinction the repair turns on. "Absent" is damage; "I could not
    // check" is not an answer, and acting on it would overwrite a cloud copy
    // that may be perfectly good with whatever happens to be on this machine.
    //
    // Only the damaged row's own paths refuse to answer. Failing every stat
    // would also break the push that follows, and the row would survive because
    // the repair could not complete rather than because it was never attempted:
    // a test that passes without the behaviour it is named for.
    const id = await saveProject('CM5', [
      { name: 'board.kicad_pcb', bytes: text('(kicad_pcb (version 20241229))') },
    ]);
    await markSynced(id);
    await legacyRowWithNoObjects(id, 'CM5');
    const before = backend.rows.get(id)!;
    backend.cannotStat = new RegExp(`^${USER}/${id}/`);

    const result = await syncAllProjects(USER);

    expect(result.healed).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.direction).toBe('pull');
    expect(result.failures[0]!.message).toContain('network error');
    expect(backend.rows.get(id)).toBe(before); // untouched, still the legacy row
  });

  it('says which project is gone when there is nothing local to restore from', async () => {
    // A row that arrived from another device, damaged, with no local copy: the
    // work really is lost, and the message should say so in those terms rather
    // than quoting a storage key.
    await legacyRowWithNoObjects('p-remote', 'CM5_MINIMA_3');

    const result = await syncAllProjects(USER);

    expect(result.healed).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.message).toContain('CM5_MINIMA_3');
    expect(result.failures[0]!.message).toContain('2 of 2 files are missing');
    expect(result.failures[0]!.message).not.toContain('.gz');
  });

  it('does not repair from a local copy that is itself empty', async () => {
    // Empty on both sides is not a repair opportunity: pushing would overwrite
    // the one record a manual recovery could still be built from.
    // A saved empty file is not hollow: gzip of nothing is still about twenty
    // bytes. The damaged shape is a record whose blobs have no bytes at all,
    // which is what a failed pull used to write, so it is imported directly.
    const id = 'p-hollow';
    await importProject({
      id,
      name: 'CM5',
      createdAt: 1_000,
      updatedAt: 2_000,
      files: [{ name: 'board.kicad_pcb', gzB64: '' }],
    });
    const local = await exportProject(id);
    expect(local!.files.every((f) => (f.gzB64?.length ?? 0) === 0)).toBe(true);
    await legacyRowWithNoObjects(id, 'CM5');

    const result = await syncAllProjects(USER);

    expect(result.healed).toBe(0);
    expect(result.failures).toHaveLength(1);
    // Refused, and said so: an empty local copy is not something to repair from.
    expect(result.failures[0]!.message).toContain('no copy on this device');
    expect(result.failures[0]!.unrecoverable).toBe(true);
  });

  it('still reports an ordinary failure when the copy is readable', async () => {
    // Nothing missing, but the commit fails: not damage, so not a repair.
    await saveProject('CM5', [
      { name: 'board.kicad_pcb', bytes: text('(kicad_pcb (version 20241229))') },
    ]);

    const result = await syncAllProjects(USER); // pushes: no cloud row yet
    expect(result.pushed).toBe(1);
    expect(result.healed).toBe(0);
    expect(result.failures).toEqual([]);
  });
});
