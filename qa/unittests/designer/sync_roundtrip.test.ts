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
      return [...f.rows.values()].map((r) => ({ id: r.id, version: r.version ?? 1 }));
    },
    async getProject(id: string) {
      return f.rows.get(id) ?? null;
    },
    async commitProject(row: ProjectRow & { user_id: string }, base: number) {
      if (row.id === f.failCommitFor) throw new Error('commit refused');
      const cur = f.rows.get(row.id);
      // Mirrors commit_project (20260904121000_project_membership.sql:416-439):
      // base 0 INSERTs and is null when a row already exists; base > 0 UPDATEs
      // `where version = p_base` and is null when nothing matches -- including
      // when the row is GONE. The old `cur?.version ?? 1` treated a missing row
      // as version 1, so "update at base 1" succeeded against an empty cloud,
      // which is the one case that mattered: a local copy remembering a version
      // whose row has been deleted.
      if (base <= 0 ? cur !== undefined : cur === undefined || cur.version !== base) return null;
      const version = base <= 0 ? 1 : base + 1;
      f.rows.set(row.id, { ...row, version });
      return version;
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

  it('stops pushing a project that contains two identical files', async () => {
    // Two files with the same bytes have the same hash. Comparing a file COUNT
    // against a SET of hashes therefore could never be equal, and the project
    // pushed itself on every load forever -- versions 6 through 15 on a real
    // board with 32 files and 31 distinct contents, two identical .lck files.
    const id = await saveProject('Amp', [
      { name: 'amp.kicad_sch', bytes: text('(kicad_sch)') },
      { name: '~amp.kicad_pro.lck', bytes: text('lock') },
      { name: '~amp.kicad_sch.lck', bytes: text('lock') },
    ]);

    await syncAllProjects(USER);
    const landed = backend.rows.get(id)!.version;

    const second = await syncAllProjects(USER);
    expect(second.failures.some((f) => f.id === id)).toBe(false);
    expect(backend.rows.get(id)!.version).toBe(landed);
  });

  it('still notices a file copied to a second name', async () => {
    // The multiset is what keeps this visible: a set would see the same
    // contents and call it unchanged, but a new file is an edit.
    const id = await saveProject('Amp', [
      { name: 'a.txt', bytes: text('same') },
      { name: 'b.txt', bytes: text('different') },
    ]);
    await syncAllProjects(USER);
    const landed = backend.rows.get(id)!.version;

    await saveProject(
      'Amp',
      [
        { name: 'a.txt', bytes: text('same') },
        { name: 'b.txt', bytes: text('different') },
        { name: 'c.txt', bytes: text('same') },
      ],
      id,
    );
    await syncAllProjects(USER);
    expect(backend.rows.get(id)!.version).toBeGreaterThan(landed);
  });

  it('stops pushing once a project with tooling files has synced', async () => {
    // What a push sends and what counts as a local change must be the same
    // set. They were not: the push filtered .git and .history out, the
    // divergence check counted them in, so the record's file count never
    // matched the hashes the push recorded. One real project pushed itself on
    // every load, versions 6 through 11, with nothing edited.
    const id = await saveProject('Amp', [
      { name: 'amp.kicad_sch', bytes: text('(kicad_sch)') },
      { name: '.git/HEAD', bytes: text('ref: refs/heads/main') },
      { name: '.history/amp-20260101.kicad_sch', bytes: text('(old)') },
    ]);

    const first = await syncAllProjects(USER);
    expect(first.failures.some((f) => f.id === id)).toBe(false);
    expect(backend.rows.get(id)!.files).toHaveLength(1);
    const landed = backend.rows.get(id)!.version;

    // Nothing touched in between: the second pass must find nothing to do.
    const second = await syncAllProjects(USER);
    expect(second.failures.some((f) => f.id === id)).toBe(false);
    expect(backend.rows.get(id)!.version).toBe(landed);
  });

  it('re-creates a row that has vanished, instead of reporting success for nothing', async () => {
    // A local copy remembers the version it last agreed with, and nothing
    // rewrites that when the cloud row goes away -- deleted from another
    // device, or straight out of the database. The push then asked the
    // compare-and-swap to update a row that is not there; it refused; and the
    // refusal was read as staleness and answered by pulling, which found
    // nothing and reported success.
    //
    // Observed against a real project: five of them "synced" in under a second
    // on every reload, with an empty cloud and nothing ever committed.
    const id = await saveProject('Amp', [{ name: 'amp.kicad_sch', bytes: text('(kicad_sch)') }]);
    await cloudUpsert(USER, (await exportProject(id))!);
    await markSynced(id, undefined, 1);
    expect(backend.rows.has(id)).toBe(true);

    // The row disappears; the local record still believes it is at version 1.
    backend.rows.delete(id);

    const result = await syncAllProjects(USER);

    // Scoped to this project: earlier tests in this file leave records behind,
    // and the question here is whether THIS row came back.
    expect(result.failures.some((f) => f.id === id)).toBe(false);
    expect(backend.rows.has(id)).toBe(true);
    expect(backend.rows.get(id)!.files).toHaveLength(1);
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
