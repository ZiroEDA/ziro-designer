// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * End-to-end encryption of a project on its way to the cloud and back:
 * docs/encryption-plan.md P0 and P1, against an in-memory backend that
 * records exactly what a server would have seen.
 *
 * The questions, in order: does the server see anything; does the owner get
 * it all back; does one edit upload one blob; can a member with a sealed key
 * read it; can anyone without a key. The plaintext path of cloud_store.test.ts
 * is unchanged and keeps running beside this one with no account open.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CloudBackend,
  ProjectKeyRow,
  ProjectRow,
} from '@ziroeda/designer/src/cloud/backend.js';
import {
  cloudGet,
  cloudGetRow,
  cloudUpsert,
  setCloudBackend,
  rotateProjectKey,
} from '@ziroeda/designer/src/cloud/cloudStore.js';
import { sha256Hex } from '@ziroeda/designer/src/cloud/blobStore.js';
import { createAccount, decryptBlob } from '@ziroeda/designer/src/cloud/crypto.js';
import { openMeta, unwrapFileKey } from '@ziroeda/designer/src/cloud/enc_meta.js';
import {
  createProjectKeyFor,
  forgetCachedProjectKey,
  projectKeyFor,
  setSessionKeys,
  shareProjectKeyWith,
} from '@ziroeda/designer/src/cloud/session_keys.js';
import { sweepPlaintextBlobs } from '@ziroeda/designer/src/cloud/sync.js';

const FAST = { opsLimit: 1, memLimitKiB: 1024 };
const OWNER = 'user-owner';
const MEMBER = 'user-member';
const UID = '11111111-1111-4111-8111-111111111111';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const text = (b64s: string): string => Buffer.from(b64s, 'base64').toString('utf8');

/** A project in the shape sync passes around, with its identity minted. */
const project = (
  files: Record<string, string>,
  over: Partial<{ name: string; role: 'owner' | 'editor' }> = {},
) => ({
  id: 'p1',
  name: over.name ?? 'Amp',
  createdAt: 1_000,
  updatedAt: 2_000,
  cloudUid: UID,
  cloudOwnerId: OWNER,
  cloudRole: over.role ?? ('owner' as const),
  files: Object.entries(files).map(([name, t]) => ({ name, gzB64: b64(t) })),
});

/** A backend that is also the server's memory: every object and row it was given. */
interface Fake extends CloudBackend {
  objects: Map<string, Uint8Array>;
  rows: Map<string, ProjectRow>;
  keys: Map<string, ProjectKeyRow & { user_id: string }>;
  uploads: number;
  /** Whose keys `getProjectKey` answers for (the server reads it off the JWT). */
  asUser: string;
}

function fake(): Fake {
  const f: Fake = {
    objects: new Map(),
    rows: new Map(),
    keys: new Map(),
    uploads: 0,
    asUser: OWNER,
    async listProjects() {
      return [...f.rows.values()].map((r) => ({
        id: r.id,
        version: r.version ?? 1,
        uid: r.uid,
        user_id: r.user_id,
      }));
    },
    async getProject(id, uid) {
      const row = uid ? [...f.rows.values()].find((r) => r.uid === uid) : f.rows.get(id);
      return row ?? null;
    },
    async commitProject(row, base) {
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
    async deleteProject(id) {
      f.rows.delete(id);
    },
    async putObject(path, bytes) {
      f.uploads++;
      f.objects.set(path, bytes);
    },
    async getObject(path) {
      const b = f.objects.get(path);
      if (!b) throw new Error(`no such object ${path}`);
      return b;
    },
    async hasObject(path) {
      return f.objects.has(path);
    },
    async removeObjects(paths) {
      for (const p of paths) f.objects.delete(p);
    },
    async getProjectKey(projectUid) {
      const r = f.keys.get(`${projectUid}:${f.asUser}`);
      return r ? { enc_key: r.enc_key, how: r.how } : null;
    },
    async putProjectKey(projectUid, userId, encKey, how) {
      // `project_keys.project_uid` references `projects.uid`, so the database
      // refuses a key row for a project that does not exist yet. The fake used
      // to accept anything, and that gap is the whole reason a first push of a
      // new project passed every test here and failed against a real Postgres:
      // the key was written before the row it points at was committed. Worded
      // as Postgres words it, so a failure here is recognisable as that failure.
      if (![...f.rows.values()].some((r) => r.uid === projectUid)) {
        throw new Error(
          'insert or update on table "project_keys" violates foreign key constraint "project_keys_project_uid_fkey"',
        );
      }
      f.keys.set(`${projectUid}:${userId}`, { user_id: userId, enc_key: encKey, how });
    },
    async deleteProjectKey(projectUid, userId) {
      f.keys.delete(`${projectUid}:${userId}`);
    },
  };
  return f;
}

let f: Fake;
let owner: Awaited<ReturnType<typeof createAccount>>;
let member: Awaited<ReturnType<typeof createAccount>>;

beforeEach(async () => {
  f = fake();
  setCloudBackend(f);
  owner = await createAccount('owner pw', FAST);
  member = await createAccount('member pw', FAST);
  setSessionKeys(owner.keys, OWNER);
});
afterEach(() => {
  setSessionKeys(null);
  setCloudBackend(null);
});

/** Everything the server holds, as one string, to search for a leak in. */
const serverSees = (): string =>
  [
    ...[...f.rows.values()].map((r) => JSON.stringify({ ...r, plain: undefined })),
    ...[...f.objects.entries()].map(([p, b]) => `${p}=${Buffer.from(b).toString('latin1')}`),
    ...[...f.keys.values()].map((k) => k.enc_key),
  ].join('\n');

describe('what the server sees', () => {
  it('is not the name, not a path, not a byte of a file, not a plaintext hash', async () => {
    await cloudUpsert(
      OWNER,
      project({ 'amp.kicad_sch': 'SCHEMATIC BYTES', 'amp.kicad_pcb': 'BOARD BYTES' }),
    );
    const seen = serverSees();
    expect(seen).not.toContain('Amp');
    expect(seen).not.toContain('kicad_sch');
    expect(seen).not.toContain('SCHEMATIC');
    expect(seen).not.toContain('BOARD');
    expect(seen).not.toContain(await sha256Hex(Buffer.from('SCHEMATIC BYTES')));
    const row = f.rows.get('p1')!;
    expect(row.name).toBe('');
    expect(typeof row.enc_meta).toBe('string');
    // The blob index still gets what it keys on: an id shaped like a hash, and a size.
    for (const e of row.files as { hash: string; size: number; name: string }[]) {
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.size).toBeGreaterThan('SCHEMATIC BYTES'.length); // the tag and IV are in it
      expect(e.name).toBe('');
      expect(f.objects.has(`${OWNER}/blobs/${e.hash.slice(0, 2)}/${e.hash}`)).toBe(true);
    }
  });

  it("the owner's key row is master-wrapped, and holds neither the key nor anything the server could use", async () => {
    await cloudUpsert(OWNER, project({ a: 'A' }));
    const k = f.keys.get(`${UID}:${OWNER}`)!;
    expect(k.how).toBe('master');
    const key = await projectKeyFor(f, OWNER, UID);
    expect(k.enc_key).not.toBe(Buffer.from(key!).toString('base64'));
  });
});

describe('the owner gets it all back', () => {
  it('names, paths and bytes, verified against the hash the manifest recorded', async () => {
    await cloudUpsert(
      OWNER,
      project({ 'amp.kicad_sch': 'SCHEMATIC BYTES', 'sub/amp.kicad_pcb': 'BOARD BYTES' }),
    );
    const back = await cloudGet('p1', UID);
    expect(back?.name).toBe('Amp');
    expect(back?.files.map((x) => [x.name, text(x.gzB64!)])).toEqual([
      ['amp.kicad_sch', 'SCHEMATIC BYTES'],
      ['sub/amp.kicad_pcb', 'BOARD BYTES'],
    ]);
    // The row carries its decrypted view for the client, and only there.
    const row = await cloudGetRow('p1', UID);
    expect(row?.plain?.name).toBe('Amp');
    expect(row?.plain?.files.map((x) => x.name)).toEqual(['amp.kicad_sch', 'sub/amp.kicad_pcb']);
    expect(f.rows.get('p1')!.plain).toBeUndefined();
  });

  it('a tampered blob is refused, before any bytes are handed over', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAAA' }));
    const [path, bytes] = [...f.objects.entries()][0]!;
    const bad = new Uint8Array(bytes);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    f.objects.set(path, bad);
    await expect(cloudGet('p1', UID)).rejects.toThrow();
  });
});

describe('per-file keys, as the reference design has them', () => {
  it('every file has a key of its own, wrapped under the project key, and none of them is the project key', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA', b: 'BBB' }));
    const key = (await projectKeyFor(f, OWNER, UID))!;
    const meta = await openMeta(key, f.rows.get('p1')!.enc_meta!);
    expect(meta.files).toHaveLength(2);
    const [ka, kb] = await Promise.all(meta.files.map((e) => unwrapFileKey(key, e.encFileKey)));
    expect(Buffer.from(ka!).equals(Buffer.from(kb!))).toBe(false);
    expect(Buffer.from(ka!).equals(Buffer.from(key))).toBe(false);
    // And the blob is under the file key, not the project key.
    const e = meta.files[0]!;
    const stored = f.objects.get(`${OWNER}/blobs/${e.blobId.slice(0, 2)}/${e.blobId}`)!;
    await expect(decryptBlob(key, stored, e.hash)).rejects.toThrow();
    expect(Buffer.from(await decryptBlob(ka!, stored, e.hash)).toString()).toBe('AAA');
  });
});

describe('one edit uploads one blob', () => {
  it('reuses every unchanged file: same blob, same file key, under a re-sealed manifest', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA', b: 'BBB', c: 'CCC' }));
    const before = f.uploads;
    const idsBefore = (f.rows.get('p1')!.files as { hash: string }[]).map((e) => e.hash);
    const second = { ...project({ a: 'AAA', b: 'BBB changed', c: 'CCC' }), baseVersion: 1 };
    await cloudUpsert(OWNER, second, new Set(), 1);
    expect(f.uploads - before).toBe(1);
    const idsAfter = (f.rows.get('p1')!.files as { hash: string }[]).map((e) => e.hash);
    // a and c keep their ids; b has a new one.
    expect(idsAfter[0]).toBe(idsBefore[0]);
    expect(idsAfter[2]).toBe(idsBefore[2]);
    expect(idsAfter[1]).not.toBe(idsBefore[1]);
    expect(f.rows.get('p1')!.version).toBe(2);
    const back = await cloudGet('p1', UID);
    expect(text(back!.files[1]!.gzB64!)).toBe('BBB changed');
  });

  it('a rename is metadata only: no upload at all', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    const before = f.uploads;
    await cloudUpsert(
      OWNER,
      { ...project({ renamed: 'AAA' }, { name: 'Amp v2' }), baseVersion: 1 },
      new Set(),
      1,
    );
    expect(f.uploads).toBe(before);
    const back = await cloudGet('p1', UID);
    expect(back?.name).toBe('Amp v2');
    expect(back?.files[0]?.name).toBe('renamed');
  });
});

describe('sharing, on keys', () => {
  it('a member with a sealed key opens the project; the row re-wraps under their master key', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    const key = (await projectKeyFor(f, OWNER, UID))!;
    await shareProjectKeyWith(f, UID, key, { userId: MEMBER, publicKey: member.keys.publicKey });
    expect(f.keys.get(`${UID}:${MEMBER}`)?.how).toBe('sealed');

    // The member, on their own device.
    setSessionKeys(member.keys, MEMBER);
    f.asUser = MEMBER;
    const back = await cloudGet('p1', UID);
    expect(back?.name).toBe('Amp');
    expect(text(back!.files[0]!.gzB64!)).toBe('AAA');
    expect(f.keys.get(`${UID}:${MEMBER}`)?.how).toBe('master');
  });

  it('a member with no key is told so, not shown an empty project', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    setSessionKeys(member.keys, MEMBER);
    f.asUser = MEMBER;
    await expect(cloudGet('p1', UID)).rejects.toThrow(/no key to project/);
  });

  it('never pushes a tooling directory, even from a record that still lists one', async () => {
    // Fixing the folder walker does not rewrite records already imported, and
    // five such projects meant thousands of uploads per push, none of it the
    // design. A push that cannot finish before the next reload never commits,
    // so every reload started again and orphaned what the last one wrote.
    const withJunk = project({
      'board.kicad_pcb': '(kicad_pcb)',
      '.git/HEAD': 'ref: refs/heads/main',
      '.history/.git/refs/tags/Save_pcb_4': 'junk',
      '3d_shapes/part.wrl': 'wrl',
    });
    await cloudUpsert(OWNER, withJunk);
    const back = await cloudGet('p1', UID);
    expect(back!.files.map((f) => f.name).sort()).toEqual([
      '3d_shapes/part.wrl',
      'board.kicad_pcb',
    ]);
  });

  it('skips a file whose bytes vanished, instead of failing every push forever', async () => {
    // The manifest is read from the store, the bytes from a later read, so a
    // file can be listed and then be gone. That used to fail the whole push --
    // and sync retries on every load from the same record, so it failed the
    // same way every time. Four real projects retried this on every refresh.
    const p = project({ a: 'AAA', b: 'BBB' });
    const vanishing = { ...p, files: [...p.files] };
    let asked = 0;
    const withGap = {
      ...vanishing,
      bytesOf: async (name: string) => {
        asked++;
        if (name === 'b') throw new Error(`"b" is no longer in project ${vanishing.id}`);
        return new Uint8Array(Buffer.from('AAA', 'utf8'));
      },
    };
    // No inline bytes, so the push goes through bytesOf -- but a size, or
    // `isHollow` reads the whole project as damaged and refuses before it
    // reaches the part under test.
    withGap.files = withGap.files.map((f) => ({ name: f.name, size: 3 }));

    const { version } = await cloudUpsert(OWNER, withGap as never);
    expect(version).toBe(1);
    expect(asked).toBeGreaterThan(0);

    // The push landed, carrying the file that still exists and not the one
    // that does not.
    const back = await cloudGet('p1', UID);
    expect(back!.files.map((x) => x.name)).toEqual(['a']);
  });

  it('replaces a row whose key is gone instead of failing on it forever', async () => {
    // The state a crash between commitProject and saveProjectKeyFor leaves: a
    // row sealed under a key nothing holds any more. Observed for real, on
    // three projects, when a browser ran out of memory mid-sync.
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    expect(f.rows.get('p1')?.enc_meta).toBeTruthy();

    // Lose the key exactly as that crash did: the row stays, the key does not.
    f.keys.delete(`${UID}:${OWNER}`);
    forgetCachedProjectKey(UID);

    // The next push mints a fresh key, which cannot open the old enc_meta. It
    // must overwrite rather than strand the project: reading the old metadata
    // is an upload optimisation, not something worth losing a project over.
    await cloudUpsert(OWNER, { ...project({ a: 'AAA', b: 'BBB' }), baseVersion: 1 }, new Set(), 1);

    const row = f.rows.get('p1')!;
    expect(row.version).toBe(2);
    // And the result is readable again, under the key that now exists.
    const back = await cloudGet('p1', UID);
    expect(back).not.toBeNull();
    expect(text(back!.files.find((x) => x.name === 'b')!.gzB64!)).toBe('BBB');
  });

  it("an editor pushes under the owner's key and into the owner's namespace", async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    const key = (await projectKeyFor(f, OWNER, UID))!;
    await shareProjectKeyWith(f, UID, key, { userId: MEMBER, publicKey: member.keys.publicKey });
    setSessionKeys(member.keys, MEMBER);
    f.asUser = MEMBER;
    await cloudUpsert(
      MEMBER,
      { ...project({ a: 'AAA', b: 'from member' }, { role: 'editor' }), baseVersion: 1 },
      new Set(),
      1,
    );
    expect([...f.objects.keys()].every((p) => p.startsWith(`${OWNER}/blobs/`))).toBe(true);
    // The owner reads what the member wrote.
    setSessionKeys(owner.keys, OWNER);
    f.asUser = OWNER;
    const back = await cloudGet('p1', UID);
    expect(text(back!.files[1]!.gzB64!)).toBe('from member');
  });

  it('a locked account cannot read an encrypted row', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    setSessionKeys(null);
    await expect(cloudGet('p1', UID)).rejects.toThrow(/locked/);
  });
});

describe('rotation: whoever leaves keeps nothing, whoever stays keeps reading', () => {
  it('after a member is removed and the key rotated, their old key opens nothing and the rest read on', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    const key = (await projectKeyFor(f, OWNER, UID))!;
    const third = await createAccount('third pw', FAST);
    await shareProjectKeyWith(f, UID, key, { userId: MEMBER, publicKey: member.keys.publicKey });
    await shareProjectKeyWith(f, UID, key, {
      userId: 'user-third',
      publicKey: third.keys.publicKey,
    });
    const versionBefore = f.rows.get('p1')!.version!;

    await f.deleteProjectKey!(UID, MEMBER);
    await rotateProjectKey(UID, [{ userId: 'user-third', publicKey: third.keys.publicKey }]);
    expect(f.rows.get('p1')!.version).toBe(versionBefore + 1);
    expect(f.uploads).toBe(1); // no blob was touched by the rotation

    setSessionKeys(member.keys, MEMBER);
    f.asUser = MEMBER;
    await expect(cloudGet('p1', UID)).rejects.toThrow(/no key to project/);
    await expect(openMeta(key, f.rows.get('p1')!.enc_meta!)).rejects.toThrow();

    setSessionKeys(third.keys, 'user-third');
    f.asUser = 'user-third';
    expect(text((await cloudGet('p1', UID))!.files[0]!.gzB64!)).toBe('AAA');

    setSessionKeys(owner.keys, OWNER);
    f.asUser = OWNER;
    expect((await cloudGet('p1', UID))?.name).toBe('Amp');
  });
});

describe('the sweep: the last plaintext goes only when nothing refers to it', () => {
  const list = async (prefix: string): Promise<string[]> =>
    [...f.objects.keys()].filter((k) => k.startsWith(prefix));

  it('refuses while any project of the owner is still plaintext', async () => {
    f.listObjects = list;
    // A plaintext row from before, with its blob under its hash.
    setSessionKeys(null);
    await cloudUpsert(OWNER, {
      ...project({ old: 'OLD' }),
      id: 'p0',
      cloudUid: '00000000-0000-4000-8000-000000000000',
    });
    setSessionKeys(owner.keys, OWNER);
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    const before = f.objects.size;
    expect(await sweepPlaintextBlobs(OWNER)).toBeNull();
    expect(f.objects.size).toBe(before);
  });

  it('removes exactly the objects no encrypted row names, and nothing under another owner', async () => {
    f.listObjects = list;
    // What a plaintext era leaves behind: a hash-named blob and a legacy path.
    f.objects.set(`${OWNER}/blobs/ab/abcdef0123`, new Uint8Array([1]));
    f.objects.set(`${OWNER}/p-old/board.kicad_pcb.gz`, new Uint8Array([2]));
    f.objects.set(`someone-else/blobs/ab/abcdef0123`, new Uint8Array([3]));
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    const live = (f.rows.get('p1')!.files as { hash: string }[]).map((e) => e.hash);
    expect(await sweepPlaintextBlobs(OWNER)).toBe(2);
    expect(f.objects.has(`${OWNER}/blobs/ab/abcdef0123`)).toBe(false);
    expect(f.objects.has(`${OWNER}/p-old/board.kicad_pcb.gz`)).toBe(false);
    expect(f.objects.has(`someone-else/blobs/ab/abcdef0123`)).toBe(true);
    for (const id of live)
      expect(f.objects.has(`${OWNER}/blobs/${id.slice(0, 2)}/${id}`)).toBe(true);
    // Nothing left to do next time.
    expect(await sweepPlaintextBlobs(OWNER)).toBe(0);
  });

  it('does nothing on a store that cannot list', async () => {
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    expect(await sweepPlaintextBlobs(OWNER)).toBeNull();
  });
});

describe('with no account open, the store is the plaintext one it always was', () => {
  it('commits names and hashes in the clear, as cloud_store.test.ts pins', async () => {
    setSessionKeys(null);
    await cloudUpsert(OWNER, project({ a: 'AAA' }));
    const row = f.rows.get('p1')!;
    expect(row.name).toBe('Amp');
    expect(row.enc_meta).toBeUndefined();
    expect((row.files[0] as { hash: string }).hash).toBe(await sha256Hex(Buffer.from('AAA')));
  });

  it('createProjectKeyFor refuses with the account locked', async () => {
    setSessionKeys(null);
    await expect(createProjectKeyFor(f, OWNER, UID)).rejects.toThrow(/locked/);
  });
});
