// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reconciliation is a fast-forward on a version integer, and no clock takes
 * part in it.
 *
 * It used to be last-write-wins on `projects.updated_at`, which held whatever
 * `Date.now()` the *browser* said. Two failures followed, and both were
 * reported by the user rather than by a test:
 *
 *  1. **Opening a project could overwrite another machine's work.** The
 *     schematic editor re-serializes and hands its sheets up 900 ms after a
 *     project is merely opened, `updateProjectFiles` restamped `updatedAt` for
 *     that identical content, and the stale copy then looked newer than the
 *     cloud's real one and won.
 *  2. **It forked a "(local copy)" aside every time.** Divergence was
 *     `updatedAt > syncedAt`, so the same restamp declared work that had not
 *     changed to be unsynced, and the pull preserved it as a new project. Three
 *     accumulated for one project in three days.
 *
 * Both are the same root cause — a decision made from a timestamp that says
 * nothing about content and is not even comparable between machines — so the
 * tests here are written against the two questions that replaced it: has the
 * *row* moved (version), and have the *files* changed (hashes).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  exportManifest,
  exportProject,
  hasDivergedLocally,
  importProject,
  listProjects,
  listSyncMeta,
  loadProject,
  markSynced,
  saveProject,
  updateProjectFiles,
} from '@ziroeda/designer/src/home/projectStore.js';
import {
  cloudGet,
  cloudUpsert,
  setCloudBackend,
  StaleBaseError,
} from '@ziroeda/designer/src/cloud/cloudStore.js';
import { syncAllProjects } from '@ziroeda/designer/src/cloud/sync.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const read = (b: Uint8Array): string => new TextDecoder().decode(b);
/** Captured before any stub, so the skew below is relative to the real clock. */
const realNow = Date.now.bind(Date);

function fake(): CloudBackend & {
  objects: Map<string, Uint8Array>;
  rows: Map<string, ProjectRow>;
  commits: number;
} {
  const f = {
    objects: new Map<string, Uint8Array>(),
    rows: new Map<string, ProjectRow>(),
    /** How many commits actually landed, so "wrote nothing" is checkable. */
    commits: 0,
    async listProjects() {
      return [...f.rows.values()].map((r) => ({ id: r.id, version: r.version ?? 1 }));
    },
    async getProject(id: string) {
      return f.rows.get(id) ?? null;
    },
    async commitProject(row: ProjectRow & { user_id: string }, base: number) {
      const cur = f.rows.get(row.id);
      // The rule `commit_project` enforces in Postgres: base 0 asserts the row
      // is new, any other base asserts the row is still exactly at it.
      if (base <= 0 ? cur !== undefined : (cur?.version ?? 1) !== base) return null;
      const version = base <= 0 ? 1 : base + 1;
      f.rows.set(row.id, { ...row, version });
      f.commits++;
      return version;
    },
    async deleteProject(id: string) {
      f.rows.delete(id);
    },
    async putObject(path: string, bytes: Uint8Array) {
      f.objects.set(path, bytes);
    },
    async getObject(path: string) {
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
beforeEach(async () => {
  backend = fake();
  setCloudBackend(backend);
  // fake-indexeddb persists across tests in a file; start from an empty store
  // or a leftover project makes the reconcile counts meaningless.
  const { deleteProject } = await import('@ziroeda/designer/src/home/projectStore.js');
  for (const p of await listProjects()) await deleteProject(p.id);
});
afterEach(() => setCloudBackend(null));

/** Save a project, push it, and record what it agreed on — a synced project. */
async function synced(name: string, body: string): Promise<string> {
  const id = await saveProject(name, [{ name: `${name}.kicad_sch`, bytes: text(body) }]);
  const { manifest, version } = await cloudUpsert(USER, (await exportManifest(id))!);
  await markSynced(
    id,
    manifest.map((m) => m.hash),
    version,
  );
  return id;
}

describe('a commit states the version it replaces', () => {
  it('refuses a push whose base is stale, and leaves the row untouched', async () => {
    const id = await synced('Amp', 'ORIGINAL');
    const at1 = backend.rows.get(id)!;

    // Another device commits. The row is now at 2.
    await cloudUpsert(USER, (await exportProject(id))!, new Set(), 1);
    expect(backend.rows.get(id)!.version).toBe(2);

    // This one still believes it is at 1, and says so.
    await expect(
      cloudUpsert(USER, (await exportProject(id))!, new Set(), 1),
    ).rejects.toBeInstanceOf(StaleBaseError);
    // The other device's commit is still the one in the cloud.
    expect(backend.rows.get(id)!.version).toBe(2);
    expect(at1.version).toBe(1);
  });

  it('refuses a first push when a row already exists under that id', async () => {
    // Base 0 means "this project is new". The user-data folders have fixed ids
    // shared by every device, so an upsert here would silently overwrite the
    // Templates folder another machine created.
    const id = await synced('Templates', 'ONE');
    await expect(
      cloudUpsert(USER, (await exportProject(id))!, new Set(), 0),
    ).rejects.toBeInstanceOf(StaleBaseError);
  });

  it('accepts the push that names the version actually there', async () => {
    const id = await synced('Amp', 'ORIGINAL');
    const { version } = await cloudUpsert(USER, (await exportProject(id))!, new Set(), 1);
    expect(version).toBe(2);
    expect(backend.rows.get(id)!.version).toBe(2);
  });
});

describe('opening a project', () => {
  it('does not mark it diverged when the bytes are identical', async () => {
    const id = await synced('Amp', '(kicad_sch (version 20250114))');
    expect(await hasDivergedLocally(id)).toBe(false);

    // What the editor does 900 ms after a project is opened: re-serialize the
    // same content and hand it up. Before, this restamped `updatedAt` and the
    // project read as diverged from that moment on.
    await updateProjectFiles(id, [
      { name: 'Amp.kicad_sch', bytes: text('(kicad_sch (version 20250114))') },
    ]);

    expect(await hasDivergedLocally(id)).toBe(false);
  });

  it('does not move updatedAt when the bytes are identical', async () => {
    const id = await synced('Amp', 'SAME');
    const before = (await listProjects()).find((p) => p.id === id)!.updatedAt;

    await updateProjectFiles(id, [{ name: 'Amp.kicad_sch', bytes: text('SAME') }]);

    const after = (await listProjects()).find((p) => p.id === id)!.updatedAt;
    expect(after).toBe(before);
  });

  it('is not diverged after a re-save that changed nothing, however late its clock', async () => {
    // The case that separates the two answers, and the reason divergence is
    // measured from content rather than from `updatedAt`.
    //
    // `saveProject` rebuilds the record and stamps `updatedAt: now`
    // unconditionally — unlike `updateProjectFiles` it has no identical-bytes
    // shortcut, because a full save is also a rename and a file-set change. So
    // after re-saving the same content, `updatedAt > syncedAt` is true while
    // the files are byte-for-byte what the cloud already has. The old test said
    // "diverged" and forked a copy aside; the hashes say what is actually so.
    const id = await synced('Amp', 'ORIGINAL');
    const before = (await listProjects()).find((p) => p.id === id)!.updatedAt;

    const skew = vi.spyOn(Date, 'now').mockReturnValue(realNow() + 3_600_000);
    await saveProject('Amp', [{ name: 'Amp.kicad_sch', bytes: text('ORIGINAL') }], id);
    skew.mockRestore();

    // The precondition, asserted rather than assumed: the save did move
    // `updatedAt` past the point the two sides agreed, so a timestamp rule
    // reaches "diverged" here and only a content rule reaches the truth.
    const after = (await listProjects()).find((p) => p.id === id)!.updatedAt;
    expect(after).toBeGreaterThan(before);

    expect(await hasDivergedLocally(id)).toBe(false);
    expect((await listSyncMeta()).find((m) => m.id === id)!.diverged).toBe(false);
  });

  it('still records a real edit', async () => {
    // The guard must not be so eager that it drops work. One byte different is
    // a save, and it is a divergence.
    const id = await synced('Amp', 'ORIGINAL');
    await updateProjectFiles(id, [{ name: 'Amp.kicad_sch', bytes: text('EDITED') }]);

    expect(await hasDivergedLocally(id)).toBe(true);
    const local = await loadProject(id);
    expect(read(local!.files[0]!.bytes)).toBe('EDITED');
  });

  it('pushes nothing to the account when nothing changed', async () => {
    const id = await synced('Amp', 'SAME');
    await updateProjectFiles(id, [{ name: 'Amp.kicad_sch', bytes: text('SAME') }]);
    backend.commits = 0;

    const result = await syncAllProjects(USER);

    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
    expect(backend.commits).toBe(0);
    expect(result.failures).toEqual([]);
    void id;
  });
});

describe('a clock says nothing about who is right', () => {
  it('does not overwrite a newer row from a machine whose clock is an hour ahead', async () => {
    // The reported failure, as a test. Both sides changed, and the local one
    // carries the later timestamp — under last-write-wins that alone decided
    // it, and the cloud's real work was overwritten. Here the version decides:
    // this copy's base is behind, so it pulls, and its own edit is preserved as
    // a fork rather than by destroying the other side.
    const id = await synced('Amp', 'ORIGINAL');

    // The other machine commits the work that matters. The row moves to 2.
    const other = await exportProject(id);
    await cloudUpsert(USER, other!, new Set(), 1);
    expect(backend.rows.get(id)!.version).toBe(2);

    // This machine edits too, with a clock an hour fast, so every timestamp it
    // writes is larger than anything the other machine could have produced.
    // Only the clock, not the event loop: fake timers stall fake-indexeddb,
    // whose requests need real ones to settle.
    const skew = vi.spyOn(Date, 'now').mockReturnValue(realNow() + 3_600_000);
    await updateProjectFiles(id, [{ name: 'Amp.kicad_sch', bytes: text('LOCAL-EDIT') }]);
    skew.mockRestore();

    const result = await syncAllProjects(USER);

    // It pulled. The future timestamp bought nothing, and the other machine's
    // commit is still what the account holds.
    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(1);
    expect(backend.rows.get(id)!.version).toBe(2);
    expect(result.failures).toEqual([]);

    // And the local edit was not simply discarded: a genuine conflict is kept
    // aside, which is the one case a "(local copy)" is supposed to appear in.
    const copies = (await listProjects()).filter((p) => p.name.includes('local copy'));
    expect(copies).toHaveLength(1);
    const kept = await loadProject(copies[0]!.id);
    expect(read(kept!.files[0]!.bytes)).toBe('LOCAL-EDIT');
  });
});

describe('what a pull agrees on', () => {
  it('records the version, so the next push replaces the row it came from', async () => {
    const id = await synced('Amp', 'ORIGINAL');
    await cloudUpsert(USER, (await exportProject(id))!, new Set(), 1); // now at 2

    const pulled = await cloudGet(id);
    expect(pulled!.baseVersion).toBe(2);
    await importProject(pulled!);

    const meta = (await listSyncMeta()).find((m) => m.id === id)!;
    expect(meta.baseVersion).toBe(2);
    expect(meta.diverged).toBe(false);
  });

  it('measures divergence for a legacy row, which carries no hashes', async () => {
    // Half the rows in the account predate content addressing. Their files have
    // no `hash`, so divergence has to be measured against hashes computed on
    // arrival — otherwise the project reads as "never synced" forever and the
    // reconcile stops pushing it.
    const id = await synced('Legacy', 'ORIGINAL');
    const p = await exportProject(id);
    await importProject({
      ...p!,
      // The legacy shape: bytes inline, no hash, no size.
      files: [{ name: 'Legacy.kicad_sch', gzB64: p!.files[0]!.gzB64 }],
      baseVersion: 1,
    });

    expect(await hasDivergedLocally(id)).toBe(false);
    await updateProjectFiles(id, [{ name: 'Legacy.kicad_sch', bytes: text('EDITED') }]);
    expect(await hasDivergedLocally(id)).toBe(true);
  });

  it('keeps measuring a legacy project across an ordinary re-save', async () => {
    // `saveProject` rebuilds the record from scratch, so a field it does not
    // carry is silently dropped — the shape that made `syncedAt` inert and
    // un-owned a project while signed out.
    //
    // Dropping `syncedHashes` is invisible for a project pushed from here,
    // because divergence falls back to `pushedHashes` and the push path sets
    // it. A project pulled from a legacy row has no `pushedHashes` at all —
    // its blobs are not in the content-addressed store — so there is nothing to
    // fall back to, and the project would read as "never synced" forever and
    // stop being pushed. Half the rows in the account are that shape.
    const id = await synced('Legacy', 'ORIGINAL');
    const p = await exportProject(id);
    await importProject({
      ...p!,
      files: [{ name: 'Legacy.kicad_sch', gzB64: p!.files[0]!.gzB64 }],
      baseVersion: 1,
    });
    // The pull left nothing that the fallback could stand in for.
    const fresh = await exportManifest(id);
    expect(fresh).toBeTruthy();

    await saveProject('Legacy', [{ name: 'Legacy.kicad_sch', bytes: text('ORIGINAL') }], id);
    expect(await hasDivergedLocally(id)).toBe(false);

    await updateProjectFiles(id, [{ name: 'Legacy.kicad_sch', bytes: text('EDITED') }]);
    expect(await hasDivergedLocally(id)).toBe(true);
  });
});
