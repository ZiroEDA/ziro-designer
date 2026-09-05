// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The sync never copies a project on its own.
 *
 * It used to. When a project had changed on both sides, the pull forked the
 * local copy aside as "<name> (local copy, <date>)" and then took the cloud's.
 * Nothing was lost, which is why it was built that way — and it is still the
 * wrong behaviour, because the decision is not the sync's to make and it made it
 * silently. What a person sees is duplicates of their board appearing in Open
 * Project with no idea where they came from. Two of them did.
 *
 * So a conflict is reported and neither side is touched, and the two
 * resolutions are things somebody chooses. `keepBoth` still makes the same
 * copy — the entire difference is that it was asked for.
 *
 * There is deliberately no "take the cloud's and discard mine". That is the one
 * outcome that destroys work.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProject,
  exportManifest,
  hasDivergedLocally,
  listProjects,
  markSynced,
  saveProject,
  setProjectOwner,
  updateProjectFiles,
} from '@ziroeda/designer/src/home/projectStore.js';
import { cloudUpsert, setCloudBackend } from '@ziroeda/designer/src/cloud/cloudStore.js';
import {
  resolveKeepBoth,
  resolveKeepMine,
  syncAllProjects,
} from '@ziroeda/designer/src/cloud/sync.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

function fake(): CloudBackend & {
  rows: Map<string, ProjectRow>;
  objects: Map<string, Uint8Array>;
} {
  const f = {
    rows: new Map<string, ProjectRow>(),
    objects: new Map<string, Uint8Array>(),
    async listProjects() {
      return [...f.rows.values()].map((r) => ({
        id: r.id,
        version: r.version ?? 1,
        ...(r.uid ? { uid: r.uid } : {}),
        ...(r.user_id ? { user_id: r.user_id } : {}),
      }));
    },
    async getProject(id: string, uid?: string) {
      if (uid) return [...f.rows.values()].find((r) => r.uid === uid) ?? null;
      return f.rows.get(id) ?? null;
    },
    async commitProject(row: ProjectRow & { user_id: string }, base: number) {
      const target = row.uid
        ? [...f.rows.values()].find((r) => r.uid === row.uid)
        : f.rows.get(row.id);
      if (!target) {
        if (base > 0) return null;
        f.rows.set(row.id, { ...row, version: 1 });
        return 1;
      }
      if (base <= 0 || (target.version ?? 1) !== base) return null;
      const version = (target.version ?? 1) + 1;
      f.rows.set(target.id, { ...target, name: row.name, files: row.files, version });
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
  return f as CloudBackend & { rows: Map<string, ProjectRow>; objects: Map<string, Uint8Array> };
}

let backend: ReturnType<typeof fake>;

/**
 * A project that is synced, then changed on BOTH sides: another device commits,
 * and this one edits without pushing.
 */
async function bothSidesChanged(): Promise<string> {
  const id = await saveProject('Amp', [{ name: 'Amp.kicad_sch', bytes: text('ORIGINAL') }]);
  const { manifest, version } = await cloudUpsert(USER, (await exportManifest(id))!);
  await markSynced(
    id,
    manifest.map((m) => m.hash),
    version,
  );
  // Another device: the row moves on.
  const row = [...backend.rows.values()][0]!;
  backend.rows.set(row.id, { ...row, name: 'Amp', version: (row.version ?? 1) + 1 });
  // And this one edits, without pushing.
  await updateProjectFiles(id, [{ name: 'Amp.kicad_sch', bytes: text('MY UNSAVED EDIT') }]);
  return id;
}

beforeEach(async () => {
  backend = fake();
  setCloudBackend(backend);
  setProjectOwner(USER);
  for (const p of await listProjects()) await deleteProject(p.id);
});
afterEach(() => {
  setCloudBackend(null);
  setProjectOwner(null);
});

describe('a project that changed on both sides', () => {
  it('is reported, and nothing is copied or overwritten', async () => {
    const id = await bothSidesChanged();
    const before = (await listProjects()).length;

    const r = await syncAllProjects(USER);

    expect(r.conflicts.map((c) => c.localId)).toEqual([id]);
    expect(r.pulled).toBe(0);
    // The bug: a second project appeared, named "(local copy, …)", that nobody
    // asked for.
    expect((await listProjects()).length).toBe(before);
    expect((await listProjects()).some((p) => p.name.includes('local copy'))).toBe(false);
  });

  it('leaves this machine’s edit exactly where it was', async () => {
    const id = await bothSidesChanged();
    await syncAllProjects(USER);
    const files = (await exportManifest(id))!.files;
    // Not overwritten either. The whole point of stopping is that neither copy
    // is touched until somebody says which one wins.
    expect(files).toHaveLength(1);
    const local = await import('@ziroeda/designer/src/home/projectStore.js');
    const loaded = await local.loadProject(id);
    expect(new TextDecoder().decode(loaded!.files[0]!.bytes)).toBe('MY UNSAVED EDIT');
  });

  it('stays diverged, so it keeps saying so', async () => {
    const id = await bothSidesChanged();
    await syncAllProjects(USER);

    // The tempting bug is to mark it synced so it stops nagging. That is not
    // silence, it is a project that has quietly stopped syncing with unpushed
    // work in it -- and the next real change would then look like the first.
    expect(await hasDivergedLocally(id)).toBe(true);
    expect((await syncAllProjects(USER)).conflicts.map((c) => c.localId)).toEqual([id]);
  });
});

describe('resolving it', () => {
  it('"keep mine" pushes over the cloud, and still makes no copy', async () => {
    const id = await bothSidesChanged();
    await syncAllProjects(USER);
    const before = (await listProjects()).length;

    await resolveKeepMine(USER, id);

    expect((await listProjects()).length).toBe(before);
    const row = [...backend.rows.values()][0]!;
    expect(row.files).toHaveLength(1);
    // And the conflict is gone: the two sides agree on this machine's copy.
    expect((await syncAllProjects(USER)).conflicts).toEqual([]);
  });

  it('"keep both" makes the copy — because it was asked for', async () => {
    const id = await bothSidesChanged();
    await syncAllProjects(USER);
    const before = (await listProjects()).length;

    await resolveKeepBoth(USER, id);

    const after = await listProjects();
    expect(after.length).toBe(before + 1);
    expect(after.some((p) => p.name.includes('local copy'))).toBe(true);
    // The original now holds the cloud's copy, which is what "both" means.
    void id;
  });
});
