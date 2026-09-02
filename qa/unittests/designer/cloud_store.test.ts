// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The cloud commit protocol, exercised against a transport that fails.
 *
 * This file is the point of the redesign. The previous cloud store called the
 * Supabase client directly, so every path that mattered ran only in a browser
 * against a live database and none of them were reachable from here. Three
 * defects lived in that blind spot until they had emptied eleven projects:
 *
 *   1. `storage.upload()` reports failure by returning `{ data, error }`, and
 *      the push never read `error` — a push whose every upload failed reported
 *      success.
 *   2. The push then rewrote the row to list file names only, discarding the
 *      inline copies that were at that moment the only ones left.
 *   3. The pull turned a failed download into `gzB64: ''` and wrote the
 *      resulting empty record over the local one.
 *
 * Each has a test below that fails if it is reintroduced. The fake backend can
 * be told to fail any operation, which is the whole capability the old design
 * did not have.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  cloudDelete,
  cloudGet,
  cloudListMeta,
  cloudUpsert,
  setCloudBackend,
} from '@ziroeda/designer/src/cloud/cloudStore.js';
import { blobPath, sha256Hex } from '@ziroeda/designer/src/cloud/blobStore.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const fromB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

/** A project in the shape sync passes around. */
const project = (
  files: Record<string, string>,
  over: Partial<{ id: string; name: string }> = {},
) => ({
  id: over.id ?? 'p1',
  name: over.name ?? 'Amp',
  createdAt: 1_000,
  updatedAt: 2_000,
  files: Object.entries(files).map(([name, text]) => ({ name, gzB64: b64(text) })),
});

interface Fake extends CloudBackend {
  objects: Map<string, Uint8Array>;
  rows: Map<string, ProjectRow>;
  calls: string[];
  versions: ProjectRow[];
  /** Operations to fail, by `op:path` prefix. */
  failOn: (match: RegExp) => void;
  /** Accept an upload and silently drop it, the failure mode commit-verify exists for. */
  swallowUploads: boolean;
}

function fake(): Fake {
  let fail: RegExp | null = null;
  const guard = (tag: string): void => {
    if (fail?.test(tag)) throw new Error(`fake backend refused ${tag}`);
  };
  const f: Fake = {
    objects: new Map(),
    rows: new Map(),
    calls: [],
    versions: [],
    swallowUploads: false,
    failOn(match) {
      fail = match;
    },
    async listProjects() {
      guard('listProjects');
      return [...f.rows.values()].map((r) => ({ id: r.id, version: r.version ?? 1 }));
    },
    async getProject(id) {
      guard(`getProject:${id}`);
      return f.rows.get(id) ?? null;
    },
    async commitProject(row, base) {
      guard(`putProject:${row.id}`);
      f.calls.push(`putProject:${row.id}`);
      const cur = f.rows.get(row.id);
      // The rule the RPC enforces: base 0 asserts the row is new, any other
      // base asserts the row is still exactly at that version.
      if (base <= 0 ? cur !== undefined : (cur?.version ?? 1) !== base) return null;
      const version = base <= 0 ? 1 : base + 1;
      f.rows.set(row.id, { ...row, version });
      return version;
    },
    async deleteProject(id) {
      guard(`deleteProject:${id}`);
      f.rows.delete(id);
    },
    async putObject(path, bytes) {
      guard(`putObject:${path}`);
      f.calls.push(`putObject:${path}`);
      if (!f.swallowUploads) f.objects.set(path, bytes);
    },
    async getObject(path) {
      guard(`getObject:${path}`);
      const b = f.objects.get(path);
      if (!b) throw new Error(`no such object ${path}`);
      return b;
    },
    async hasObject(path) {
      guard(`hasObject:${path}`);
      return f.objects.has(path);
    },
    async removeObjects(paths) {
      guard('removeObjects');
      for (const p of paths) f.objects.delete(p);
    },
    async recordVersion(_userId, row) {
      guard(`recordVersion:${row.id}`);
      f.versions.push(row);
    },
  };
  return f;
}

const install = (): Fake => {
  const f = fake();
  setCloudBackend(f);
  return f;
};

afterEach(() => setCloudBackend(null));

describe('a push', () => {
  it('stores each blob under the hash of its bytes, and commits a manifest', async () => {
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA', 'b.kicad_pcb': 'BBB' }));

    const row = f.rows.get('p1')!;
    expect(row.files).toHaveLength(2);
    for (const entry of row.files as { name: string; hash: string; size: number }[]) {
      const stored = f.objects.get(blobPath(USER, entry.hash))!;
      expect(stored).toBeDefined();
      // The key states what the bytes must be, which is what makes a read
      // verifiable and an overwrite incapable of destroying anything.
      expect(await sha256Hex(stored)).toBe(entry.hash);
      expect(entry.size).toBe(stored.length);
    }
  });

  it('writes the row only after every blob is stored', async () => {
    // The ordering is the protocol. Until the row lands, the previous version
    // is intact; the old code wrote the row first and lost the files it named.
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA', 'b.kicad_pcb': 'BBB' }));
    const commit = f.calls.indexOf('putProject:p1');
    expect(commit).toBe(f.calls.length - 1);
    expect(f.calls.filter((c) => c.startsWith('putObject:'))).toHaveLength(2);
  });

  it('does not touch the row when an upload fails', async () => {
    // Defect 1. `upload()` returned its error rather than throwing and nobody
    // read it, so the push continued and rewrote the row regardless.
    const f = install();
    f.failOn(/^putObject:/);
    await expect(cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }))).rejects.toThrow(/refused/);
    expect(f.rows.has('p1')).toBe(false);
  });

  it('leaves an existing version intact when a later upload fails', async () => {
    // The case that actually cost the projects: there was already something
    // there, and the failed push replaced it.
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'ORIGINAL' }));
    const before = f.rows.get('p1')!;

    f.failOn(/^putObject:/);
    await expect(cloudUpsert(USER, project({ 'a.kicad_sch': 'REPLACEMENT' }))).rejects.toThrow();
    expect(f.rows.get('p1')).toEqual(before);
    // And the original blob is still readable.
    const p = await cloudGet('p1');
    expect(p!.files[0]!.gzB64).toBe(b64('ORIGINAL'));
  });

  it('refuses to commit when an upload reports success but stored nothing', async () => {
    // A write that claims to have landed and did not. Unverifiable in the old
    // design, which is why the row could end up naming objects nobody had.
    const f = install();
    f.swallowUploads = true;
    await expect(cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }))).rejects.toThrow(
      /blobs are not in the store/,
    );
    expect(f.rows.has('p1')).toBe(false);
  });

  it('refuses to push a project whose files are all empty', async () => {
    // The signature of an already-damaged local copy. Pushing it would destroy
    // the one place a recovery could have come from.
    const f = install();
    await expect(
      cloudUpsert(USER, {
        ...project({}),
        files: [
          { name: 'a', gzB64: '' },
          { name: 'b', gzB64: '' },
        ],
      }),
    ).rejects.toThrow(/local copy is damaged/);
    expect(f.rows.has('p1')).toBe(false);
  });

  it('still pushes a project that genuinely has no files', async () => {
    // Empty is a real state; "every file is empty" is not.
    const f = install();
    await cloudUpsert(USER, project({}));
    expect(f.rows.get('p1')!.files).toEqual([]);
  });

  it('uploads shared content once', async () => {
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'SAME', 'b.kicad_sch': 'SAME' }));
    expect(f.calls.filter((c) => c.startsWith('putObject:'))).toHaveLength(1);
    expect(f.objects.size).toBe(1);
  });

  it('re-pushing unchanged content writes no blobs at all', async () => {
    // A project synced daily accumulates no new objects, so it accumulates no
    // new risk.
    const f = install();
    const p = project({ 'a.kicad_sch': 'AAA' });
    const { version } = await cloudUpsert(USER, p);
    f.calls.length = 0;
    // Over the version the first push landed as, which is what `pushOne` sends.
    await cloudUpsert(USER, p, new Set(), version);
    expect(f.calls.filter((c) => c.startsWith('putObject:'))).toEqual([]);
  });

  it('records the committed manifest as history', async () => {
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }));
    expect(f.versions).toHaveLength(1);
    expect(f.versions[0]!.files).toEqual(f.rows.get('p1')!.files);
  });

  it('succeeds even when history cannot be recorded', async () => {
    // The commit has already landed. Failing here would tell sync the push did
    // not happen and leave the two sides marked as disagreeing when they agree.
    const f = install();
    f.failOn(/^recordVersion:/);
    // Resolves with the manifest it committed, history or no history.
    const { manifest, version } = await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }));
    expect(manifest.map((m) => m.name)).toEqual(['a.kicad_sch']);
    // A first commit lands as version 1; history failing does not roll it back.
    expect(version).toBe(1);
    expect(f.rows.has('p1')).toBe(true);
  });
});

describe('asking whether a blob is there', () => {
  it('does not treat a store that cannot answer as an empty store', async () => {
    // The real backend answers this with a HEAD on the object. It used to list
    // the whole `<user>/blobs/` prefix, which grew with every file the user had
    // ever saved and began returning 504 once there were a few thousand. What
    // must never happen is a failure being read as "absent": the commit
    // verification would then pass by concluding nothing is there.
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }));
    f.failOn(/^hasObject:/);

    await expect(
      cloudUpsert(USER, project({ 'a.kicad_sch': 'BBB' }, { id: 'p2' })),
    ).rejects.toThrow(/refused/);
    // And nothing was committed on the strength of an unanswered question.
    expect(f.rows.has('p2')).toBe(false);
  });
});

describe('a pull', () => {
  it('returns the files that were pushed', async () => {
    install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA', 'b.kicad_pcb': 'BBB' }));
    const p = await cloudGet('p1');
    expect(p!.name).toBe('Amp');
    expect(p!.files.map((f) => [f.name, Buffer.from(f.gzB64 ?? '', 'base64').toString()])).toEqual([
      ['a.kicad_sch', 'AAA'],
      ['b.kicad_pcb', 'BBB'],
    ]);
  });

  it('throws when a blob cannot be downloaded', async () => {
    // Defect 3, and the one that did the damage: this used to return
    // `gzB64: ''`, which the caller wrote over the local copy as if complete.
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }));
    f.failOn(/^getObject:/);
    await expect(cloudGet('p1')).rejects.toThrow(/refused/);
  });

  it('throws when a blob does not hash to what the manifest committed', async () => {
    // Truncation, a partial upload, a substituted object. Handing these back
    // would put a corrupt board in front of the user with nothing to say so.
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }));
    const [path] = [...f.objects.keys()];
    f.objects.set(path!, new Uint8Array([1, 2, 3]));
    await expect(cloudGet('p1')).rejects.toThrow(/is corrupt/);
  });

  it('returns null for a project that is not there', async () => {
    install();
    expect(await cloudGet('nope')).toBeNull();
  });
});

describe('rows written by older versions', () => {
  const legacyRow = (files: ProjectRow['files']): ProjectRow => ({
    id: 'old',
    user_id: USER,
    name: 'Legacy',
    created_at: new Date(1_000).toISOString(),
    updated_at: new Date(2_000).toISOString(),
    files,
  });

  it('are still readable in the inline shape', async () => {
    const f = install();
    f.rows.set('old', legacyRow([{ name: 'a.kicad_sch', gzB64: b64('AAA') }]));
    const p = await cloudGet('old');
    expect(p!.files[0]!.gzB64).toBe(b64('AAA'));
  });

  it('are still readable in the names-only shape', async () => {
    const f = install();
    f.rows.set('old', legacyRow([{ name: 'a.kicad_sch' }]));
    f.objects.set(`${USER}/old/a.kicad_sch.gz`, fromB64(b64('AAA')));
    const p = await cloudGet('old');
    expect(p!.files[0]!.gzB64).toBe(b64('AAA'));
  });

  it('throw rather than yield an empty file when the names-only blob is gone', async () => {
    // Exactly the shape and exactly the failure that emptied the projects.
    const f = install();
    f.rows.set('old', legacyRow([{ name: 'a.kicad_sch' }]));
    await expect(cloudGet('old')).rejects.toThrow(/no such object/);
  });
});

describe('deleting a project', () => {
  it('removes the blobs no other project references', async () => {
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'ONLY-MINE' }, { id: 'p1' }));
    expect(f.objects.size).toBe(1);
    await cloudDelete('p1');
    expect(f.rows.has('p1')).toBe(false);
    expect(f.objects.size).toBe(0);
  });

  it('keeps a blob another project still shares', async () => {
    // Blobs are shared by content, so deleting by project would quietly empty
    // the sibling that happens to contain the same footprint library.
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'SHARED' }, { id: 'p1' }));
    await cloudUpsert(USER, project({ 'copy.kicad_sch': 'SHARED' }, { id: 'p2' }));
    expect(f.objects.size).toBe(1);

    await cloudDelete('p1');
    expect(f.objects.size).toBe(1);
    // And p2 still reads.
    expect((await cloudGet('p2'))!.files[0]!.gzB64).toBe(b64('SHARED'));
  });

  it('leaves blobs alone when it cannot prove they are unreferenced', async () => {
    // The only destructive path in the module, so it errs towards orphans.
    const f = install();
    await cloudUpsert(USER, project({ 'a.kicad_sch': 'AAA' }, { id: 'p1' }));
    f.failOn(/^listProjects$/);
    await cloudDelete('p1');
    expect(f.rows.has('p1')).toBe(false);
    expect(f.objects.size).toBe(1);
  });
});

describe('with no backend installed', () => {
  it('refuses loudly rather than doing nothing', async () => {
    // A cloud call that silently no-ops is how a sync layer looks when it has
    // stopped working.
    setCloudBackend(null);
    await expect(cloudListMeta()).rejects.toThrow(/no backend installed/);
    await expect(cloudGet('p1')).rejects.toThrow(/no backend installed/);
    await expect(cloudUpsert(USER, project({ a: 'A' }))).rejects.toThrow(/no backend installed/);
  });
});
