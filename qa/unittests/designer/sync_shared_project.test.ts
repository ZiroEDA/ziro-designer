// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A project that belongs to somebody else.
 *
 * Until membership existed, every row the client could see was the signed-in
 * user's own, and the whole sync layer was written on that assumption: it
 * matched local records to cloud rows by `id`, addressed blobs by whoever was
 * signed in, and treated anything local that the cloud lacked as a project to
 * create. Each of those is wrong the moment a row can be reachable by two
 * accounts, and wrong in a way that writes:
 *
 *  - a shared project would be pushed back up as a **new project of the
 *    member's own**, so opening someone's board would copy it into your account;
 *  - its blobs would be uploaded into the **member's** storage space, where the
 *    owner cannot read them, and committed anyway;
 *  - `projects.id` comes from the browser's IndexedDB and is unique on one
 *    machine only, so a shared project can carry the **same id** as one of
 *    yours, and matching on it would reconcile two unrelated projects into each
 *    other -- overwriting your work with theirs;
 *  - a **viewer** would push on every pass, be refused, and accumulate a
 *    "(local copy)" fork each time.
 *
 * The fake below models the database's actual rules rather than a friendlier
 * version of them: rows are keyed by `uid`, a listing returns what row-level
 * security would return, and a commit by someone who may only read the project
 * comes back null exactly as `commit_project` does.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  deleteProject,
  exportManifest,
  importProject,
  listProjects,
  loadProject,
  saveProject,
  setProjectOwner,
  updateProjectFiles,
} from '@ziroeda/designer/src/home/projectStore.js';
import { setCloudBackend } from '@ziroeda/designer/src/cloud/cloudStore.js';
import {
  deleteCloudProject,
  pushProject,
  syncAllProjects,
} from '@ziroeda/designer/src/cloud/sync.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const ME = 'user-me';
const OWNER = 'user-owner';
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const read = (b: Uint8Array): string => new TextDecoder().decode(b);

type Role = 'owner' | 'editor' | 'viewer';
type Row = ProjectRow & { user_id: string; uid: string; version: number };

/**
 * The backend as row-level security actually behaves, from the point of view of
 * one signed-in user.
 */
function fake(me: string) {
  const f = {
    /** Keyed by `uid`, which is what the database keys membership on. */
    rows: new Map<string, Row>(),
    /** This user's role on projects they do not own. */
    members: new Map<string, Role>(),
    objects: new Map<string, Uint8Array>(),
    commits: 0,

    /** What `me` may do with a project, or null when they cannot see it. */
    roleOf(r: Row): Role | null {
      if (r.user_id === me) return 'owner';
      return f.members.get(r.uid) ?? null;
    },
    visible(): Row[] {
      return [...f.rows.values()].filter((r) => f.roleOf(r) !== null);
    },

    async listProjects() {
      return f.visible().map((r) => ({
        id: r.id,
        uid: r.uid,
        user_id: r.user_id,
        version: r.version,
      }));
    },
    async getProject(id: string, uid?: string) {
      if (uid) {
        const r = f.rows.get(uid);
        return r && f.roleOf(r) !== null ? r : null;
      }
      // What `.eq('id', id)` returns: every *visible* row of that id, in no
      // particular order. Taking the first is only sound when there is one.
      return f.visible().find((r) => r.id === id) ?? null;
    },
    async listMemberships() {
      return [...f.members].map(([project_uid, role]) => ({ project_uid, role }));
    },
    async leaveProject(uid: string) {
      f.members.delete(uid);
    },
    async commitProject(row: ProjectRow & { user_id: string }, base: number) {
      const target = row.uid
        ? f.rows.get(row.uid)
        : f.visible().find((r) => r.id === row.id && r.user_id === me);

      if (!target) {
        // Base 0 asserts the project is new, and a new project is always your
        // own -- you cannot create a row inside another account.
        if (base > 0) return null;
        const uid = `uid-${f.rows.size + 1}`;
        f.rows.set(uid, {
          ...row,
          uid,
          user_id: me,
          version: 1,
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
        f.commits++;
        return 1;
      }
      if (base <= 0) return null; // the row is already there: the caller is stale
      // `projects_update_editor`: a viewer's write matches no row it may see,
      // and the function reports that the same way it reports a stale base.
      const role = f.roleOf(target);
      if (role !== 'owner' && role !== 'editor') return null;
      if (target.version !== base) return null;
      // `projects_freeze_identity_trg`: the owner is not reassigned by a write.
      f.rows.set(target.uid, {
        ...target,
        name: row.name,
        files: row.files,
        version: target.version + 1,
      });
      f.commits++;
      return target.version + 1;
    },
    async deleteProject(id: string) {
      const r = f.visible().find((x) => x.id === id && x.user_id === me);
      if (r) f.rows.delete(r.uid);
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
  return f satisfies CloudBackend & Record<string, unknown>;
}

let backend: ReturnType<typeof fake>;

/** Put a project into the OWNER's account and share it with `me` at `role`. */
function shareIn(
  f: ReturnType<typeof fake>,
  opts: { uid: string; id: string; name: string; body: string; role: Role; hash: string },
): void {
  f.rows.set(opts.uid, {
    id: opts.id,
    uid: opts.uid,
    user_id: OWNER,
    name: opts.name,
    created_at: new Date(1000).toISOString(),
    updated_at: new Date(1000).toISOString(),
    version: 1,
    files: [{ name: `${opts.name}.kicad_sch`, hash: opts.hash, size: text(opts.body).length }],
  });
  f.members.set(opts.uid, opts.role);
  // The owner's blobs, in the owner's space -- which is the only place anyone
  // on the project can read them from.
  f.objects.set(`${OWNER}/blobs/${opts.hash.slice(0, 2)}/${opts.hash}`, text(opts.body));
}

/** Base64 of some text, the shape a pulled file arrives in. */
const b64 = (t: string): string => Buffer.from(text(t)).toString('base64');

/** The sha-256 the store would key these bytes under. */
async function hashOf(body: string): Promise<string> {
  const { sha256Hex } = await import('@ziroeda/designer/src/cloud/blobStore.js');
  return sha256Hex(text(body));
}

beforeEach(async () => {
  backend = fake(ME);
  setCloudBackend(backend);
  setProjectOwner(ME);
  for (const p of await listProjects()) await deleteProject(p.id);
});
afterEach(() => {
  setCloudBackend(null);
  setProjectOwner(null);
});

describe('a project shared with this user', () => {
  it('is filed under its uid, not under the id its owner gave it', async () => {
    shareIn(backend, {
      uid: 'uid-shared',
      id: 'proj-a',
      name: 'Owners Board',
      body: 'OWNER BODY',
      role: 'editor',
      hash: await hashOf('OWNER BODY'),
    });

    const r = await syncAllProjects(ME);
    expect(r.failures).toEqual([]);
    expect(r.pulled).toBe(1);

    const local = await listProjects();
    expect(local.map((p) => p.id)).toEqual(['uid-shared']);
  });

  it('is pushed back to the owner’s row rather than copied into this account', async () => {
    shareIn(backend, {
      uid: 'uid-shared',
      id: 'proj-a',
      name: 'Owners Board',
      body: 'OWNER BODY',
      role: 'editor',
      hash: await hashOf('OWNER BODY'),
    });
    await syncAllProjects(ME);

    await updateProjectFiles('uid-shared', [
      { name: 'Owners Board.kicad_sch', bytes: text('EDITED BY MEMBER') },
    ]);
    const r = await syncAllProjects(ME);
    expect(r.failures).toEqual([]);
    expect(r.pushed).toBe(1);

    // One row still, still the owner's, now at version 2. A second row would be
    // the bug: the member's edit copied into their own account.
    expect(backend.rows.size).toBe(1);
    const row = backend.rows.get('uid-shared')!;
    expect(row.user_id).toBe(OWNER);
    expect(row.version).toBe(2);
  });

  it('uploads its blobs into the owner’s space, where the owner can read them', async () => {
    shareIn(backend, {
      uid: 'uid-shared',
      id: 'proj-a',
      name: 'Owners Board',
      body: 'OWNER BODY',
      role: 'editor',
      hash: await hashOf('OWNER BODY'),
    });
    await syncAllProjects(ME);
    await updateProjectFiles('uid-shared', [
      { name: 'Owners Board.kicad_sch', bytes: text('EDITED BY MEMBER') },
    ]);
    await syncAllProjects(ME);

    // Every object of this project is under the owner's prefix. One under the
    // member's would be committed but unreadable by anybody else on the
    // project, which is the failure this is here to prevent.
    const written = [...backend.objects.keys()];
    expect(written.some((k) => k.startsWith(`${OWNER}/`))).toBe(true);
    expect(written.filter((k) => k.startsWith(`${ME}/`))).toEqual([]);
  });

  it('survives an ordinary save, which rebuilds the record from scratch', async () => {
    shareIn(backend, {
      uid: 'uid-shared',
      id: 'proj-a',
      name: 'Owners Board',
      body: 'OWNER BODY',
      role: 'editor',
      hash: await hashOf('OWNER BODY'),
    });
    await syncAllProjects(ME);

    // `saveProject` builds a fresh `StoredRecord` rather than patching the
    // stored one, so every field it does not carry across is dropped -- and
    // dropping these makes the project look like this user's own. The next sync
    // would then find a local project the cloud has no row for and push it up
    // as a *new* project in their account: someone else's board, copied by the
    // act of saving it.
    await saveProject(
      'Owners Board',
      [{ name: 'Owners Board.kicad_sch', bytes: text('EDITED AND SAVED') }],
      'uid-shared',
    );

    const r = await syncAllProjects(ME);
    expect(r.failures).toEqual([]);
    expect(backend.rows.size).toBe(1);
    expect(backend.rows.get('uid-shared')!.user_id).toBe(OWNER);
    expect(backend.rows.get('uid-shared')!.version).toBe(2);
  });
});

describe('a project shared read-only', () => {
  it('is never pushed, however much the local copy is edited', async () => {
    shareIn(backend, {
      uid: 'uid-ro',
      id: 'proj-ro',
      name: 'Read Only',
      body: 'ORIGINAL',
      role: 'viewer',
      hash: await hashOf('ORIGINAL'),
    });
    await syncAllProjects(ME);
    const commitsAfterPull = backend.commits;

    await updateProjectFiles('uid-ro', [
      { name: 'Read Only.kicad_sch', bytes: text('LOCAL SCRIBBLE') },
    ]);
    const r = await syncAllProjects(ME);

    // No write attempted, and nothing reported as a failure: being unable to
    // write a project you may only read is not an error to put in front of
    // somebody on every sign-in.
    expect(backend.commits).toBe(commitsAfterPull);
    expect(r.pushed).toBe(0);
    expect(r.failures).toEqual([]);
    expect(backend.rows.get('uid-ro')!.version).toBe(1);

    // And the edit is still here. Refusing to push is not licence to discard.
    const still = await loadProject('uid-ro');
    expect(read(still!.files.find((f) => f.name === 'Read Only.kicad_sch')!.bytes)).toBe(
      'LOCAL SCRIBBLE',
    );
  });
});

describe('a shared project whose id collides with one of this user’s own', () => {
  it('does not overwrite the local project that already holds that id', async () => {
    // `projects.id` comes from the browser and is unique on one machine only,
    // so this is not a contrived case: two people's stores can independently
    // produce the same id, and one of them then shares that project.
    const mine = await saveProject('My Board', [
      { name: 'My Board.kicad_sch', bytes: text('MINE') },
    ]);
    shareIn(backend, {
      uid: 'uid-theirs',
      id: mine, // the collision
      name: 'Their Board',
      body: 'THEIRS',
      role: 'editor',
      hash: await hashOf('THEIRS'),
    });

    const r = await syncAllProjects(ME);
    expect(r.failures).toEqual([]);

    // Two projects, not one: mine under its own id, theirs under its uid.
    const local = await listProjects();
    expect(new Set(local.map((p) => p.id))).toEqual(new Set([mine, 'uid-theirs']));

    const kept = await loadProject(mine);
    expect(read(kept!.files.find((f) => f.name === 'My Board.kicad_sch')!.bytes)).toBe('MINE');
  });
});

describe('removing a shared project', () => {
  it('gives up the membership instead of deleting somebody else’s project', async () => {
    shareIn(backend, {
      uid: 'uid-shared',
      id: 'proj-a',
      name: 'Owners Board',
      body: 'OWNER BODY',
      role: 'editor',
      hash: await hashOf('OWNER BODY'),
    });
    await syncAllProjects(ME);

    await deleteCloudProject('uid-shared', ME);

    // The project survives; this user is simply no longer on it.
    expect(backend.rows.has('uid-shared')).toBe(true);
    expect(backend.members.has('uid-shared')).toBe(false);
    expect(await backend.listProjects()).toEqual([]);
  });
});

describe('a project pushed before uids existed', () => {
  it('learns its identity from the listing without being pushed again', async () => {
    // A record from before the column existed: it is already in the cloud, and
    // its local copy knows the id it was pushed under and nothing else. Built
    // directly rather than by pushing, because a push now records the identity
    // itself -- which is what the next test pins, and would make this one prove
    // nothing at all.
    const hash = await hashOf('BODY');
    backend.rows.set('uid-1', {
      id: 'legacy-1',
      uid: 'uid-1',
      user_id: ME,
      name: 'Amp',
      created_at: new Date(1000).toISOString(),
      updated_at: new Date(1000).toISOString(),
      version: 1,
      files: [{ name: 'Amp.kicad_sch', hash, size: text('BODY').length }],
    });
    await importProject({
      id: 'legacy-1',
      name: 'Amp',
      createdAt: 1000,
      updatedAt: 1000,
      baseVersion: 1,
      files: [{ name: 'Amp.kicad_sch', gzB64: b64('BODY') }],
    });
    expect((await exportManifest('legacy-1'))!.cloudUid).toBeUndefined();

    const r = await syncAllProjects(ME);
    expect(r.failures).toEqual([]);
    // Matched by id among this user's own rows, and the identity recorded. A
    // pass that failed to match would push a duplicate instead.
    expect(backend.commits).toBe(0);
    expect(backend.rows.size).toBe(1);

    const linked = await exportManifest('legacy-1');
    expect(linked!.cloudUid).toBe('uid-1');
    expect(linked!.cloudOwnerId).toBe(ME);
  });

  it('records its identity on the very first push, not on the next reconcile', async () => {
    const id = await saveProject('Fresh', [{ name: 'Fresh.kicad_sch', bytes: text('NEW') }]);
    // What happens when a project is created and saved in one sitting: a single
    // push, no full reconcile. The server assigns the uid, so the push cannot
    // know it — but everything that names a project across accounts needs one,
    // so without this the Share button would truthfully and uselessly report
    // that a project already in the cloud cannot be shared yet.
    await pushProject(ME, id);

    const after = await exportManifest(id);
    expect(after!.cloudUid).toBe('uid-1');
    expect(after!.cloudOwnerId).toBe(ME);
  });
});
