// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sync across both halves — a real local store and a cloud transport that can
 * fail — including a replay of the incident that prompted the redesign.
 *
 * `cloud_store.test.ts` covers the commit protocol on its own. What that cannot
 * show is the thing that actually happened: a pull whose blobs were unreachable
 * produced empty files, `importProject` wrote them over a local copy that had
 * contents, and `markSynced` then recorded the two sides as agreeing. Every
 * step reported success. Reproducing it needs both stores at once, so this file
 * runs the local one against `fake-indexeddb`.
 *
 * That there was no IndexedDB in the test package is a large part of why the
 * local half of the data path had never been executed here at all.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  exportProject,
  importProject,
  isHollowRecord,
  saveProject,
  loadProject,
  markSynced,
} from '@ziroeda/designer/src/home/projectStore.js';
import { setCloudBackend, cloudUpsert } from '@ziroeda/designer/src/cloud/cloudStore.js';
import { syncAllProjects } from '@ziroeda/designer/src/cloud/sync.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** The same in-memory backend as cloud_store.test.ts, minus the call log. */
function fake(): CloudBackend & {
  objects: Map<string, Uint8Array>;
  rows: Map<string, ProjectRow>;
  blackout: boolean;
  failCommitFor: string;
} {
  const f = {
    objects: new Map<string, Uint8Array>(),
    rows: new Map<string, ProjectRow>(),
    /** Simulates a storage layer that has stopped serving objects. */
    blackout: false,
    /** Project id whose commit is refused, to fail exactly one transfer. */
    failCommitFor: '' as string,
    async listProjects() {
      return [...f.rows.values()].map((r) => ({ id: r.id, updated_at: r.updated_at }));
    },
    async getProject(id: string) {
      return f.rows.get(id) ?? null;
    },
    async putProject(row: ProjectRow & { user_id: string }) {
      if (row.id === f.failCommitFor) throw new Error('commit refused');
      f.rows.set(row.id, row);
    },
    async deleteProject(id: string) {
      f.rows.delete(id);
    },
    async putObject(path: string, bytes: Uint8Array) {
      f.objects.set(path, bytes);
    },
    async getObject(path: string) {
      if (f.blackout) throw new Error('storage unavailable');
      const b = f.objects.get(path);
      if (!b) throw new Error(`no such object ${path}`);
      return b;
    },
    async hasObject(path: string) {
      return f.objects.has(path);
    },
    async removeObjects(paths: string[]) {
      for (const p of paths) f.objects.delete(p);
    },
  };
  return f;
}

let backend: ReturnType<typeof fake>;
beforeEach(() => {
  backend = fake();
  setCloudBackend(backend);
});
afterEach(() => setCloudBackend(null));

describe('a project pushed and pulled back', () => {
  it('comes back byte-identical', async () => {
    const id = await saveProject('Amp', [
      { name: 'amp.kicad_sch', bytes: text('(kicad_sch (version 20250114))') },
      { name: 'amp.kicad_pcb', bytes: text('(kicad_pcb (version 20241229))') },
    ]);
    await cloudUpsert(USER, (await exportProject(id))!);

    // Drop the local copy's contents the only legitimate way — a fresh browser
    // — by importing into a new id from the cloud row.
    const row = backend.rows.get(id)!;
    expect(row.files).toHaveLength(2);

    const { cloudGet } = await import('@ziroeda/designer/src/cloud/cloudStore.js');
    const pulled = await cloudGet(id);
    await importProject({ ...pulled!, id: `${id}-copy` });

    const back = await loadProject(`${id}-copy`);
    expect(new TextDecoder().decode(back!.files[0]!.bytes)).toBe('(kicad_sch (version 20250114))');
    expect(new TextDecoder().decode(back!.files[1]!.bytes)).toBe('(kicad_pcb (version 20241229))');
  });
});

describe('the incident, replayed', () => {
  it('a pull whose blobs are unreachable leaves the local copy alone and reports', async () => {
    // Exactly what happened: the objects became unreadable, the pull produced
    // empty files, and they were written over a local copy that had contents.
    const id = await saveProject('Amp', [
      { name: 'amp.kicad_sch', bytes: text('(kicad_sch (version 20250114))') },
    ]);
    await cloudUpsert(USER, (await exportProject(id))!);
    await markSynced(id);

    // The cloud row is newer, so the reconcile chooses to pull.
    const row = backend.rows.get(id)!;
    backend.rows.set(id, { ...row, updated_at: new Date(Date.now() + 60_000).toISOString() });
    backend.blackout = true;

    const result = await syncAllProjects(USER);

    // Reported, not swallowed...
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.direction).toBe('pull');
    expect(result.failures[0]!.message).toMatch(/storage unavailable/);
    // ...and the local copy still has its contents.
    const local = await loadProject(id);
    expect(new TextDecoder().decode(local!.files[0]!.bytes)).toBe('(kicad_sch (version 20250114))');
  });

  it('one project failing does not abandon the others', async () => {
    // The old code gathered every transfer into one Promise.all, so the first
    // rejection took the rest of the reconcile with it — and the caller logged
    // the whole thing to the console as a single line.
    const a = await saveProject('A', [{ name: 'a.kicad_sch', bytes: text('AAA') }]);
    const b = await saveProject('B', [{ name: 'b.kicad_sch', bytes: text('BBB') }]);
    backend.failCommitFor = b;

    const result = await syncAllProjects(USER);

    // B is named as a failure...
    expect(result.failures.map((f) => f.id)).toContain(b);
    expect(backend.rows.has(b)).toBe(false);
    // ...and A went up regardless. (Other tests in this file share the store,
    // so the assertion is about these two ids, not about the totals.)
    expect(result.failures.map((f) => f.id)).not.toContain(a);
    expect(backend.rows.has(a)).toBe(true);
  });
});

describe('the local guard of last resort', () => {
  it('refuses an empty copy over a project that has contents', async () => {
    // Whatever the layers above believe. This is the one that would have held
    // when the other two did not.
    const id = await saveProject('Amp', [
      { name: 'amp.kicad_sch', bytes: text('(kicad_sch (version 20250114))') },
    ]);
    await expect(
      importProject({
        id,
        name: 'Amp',
        createdAt: 1,
        updatedAt: 2,
        files: [{ name: 'amp.kicad_sch', gzB64: '' }],
      }),
    ).rejects.toThrow(/refusing to overwrite/);

    const local = await loadProject(id);
    expect(local!.files[0]!.bytes.byteLength).toBeGreaterThan(0);
  });

  it('allows a project that genuinely has no files', async () => {
    // Empty is a real state; "every file is empty" is not.
    await importProject({ id: 'blank', name: 'Blank', createdAt: 1, updatedAt: 2, files: [] });
    expect((await loadProject('blank'))!.files).toEqual([]);
  });

  it('allows an empty copy when there is nothing to lose', async () => {
    // Refusing here would mean a project the user can see in Recent but can
    // never open, which is worse than an empty one they can delete.
    await importProject({
      id: 'fresh',
      name: 'Fresh',
      createdAt: 1,
      updatedAt: 2,
      files: [{ name: 'a.kicad_sch', gzB64: '' }],
    });
    expect((await loadProject('fresh'))!.files).toHaveLength(1);
  });

  it('names damage precisely: all empty, and at least one file', () => {
    expect(isHollowRecord([])).toBe(false);
    expect(isHollowRecord([{ gz: new Uint8Array(0) }])).toBe(true);
    expect(isHollowRecord([{ gz: new Uint8Array(0) }, { gz: new Uint8Array(3) }])).toBe(false);
  });
});
