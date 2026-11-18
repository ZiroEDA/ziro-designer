// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The account's projects, listed before they are downloaded and fetched when opened.
 *
 * Reported: on a new device the home page showed no projects for minutes - the list was the
 * device's store, and each project appeared only after downloading whole. The rows carry what a
 * list needs, so the list comes from them (cloudOnlyProjects) and a project is pulled when opened
 * (pullProjectNow), sharing one pull with the background sync.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProject,
  exportProject,
  listProjects,
  loadProject,
  saveProject,
} from '@ziroeda/designer/src/home/projectStore.js';
import { cloudUpsert, setCloudBackend } from '@ziroeda/designer/src/cloud/cloudStore.js';
import { pullProjectNow } from '@ziroeda/designer/src/cloud/sync.js';
import { cloudOnlyFrom, cloudOnlyProjects } from '@ziroeda/designer/src/cloud/catalog.js';
import type { CatalogRow, CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('cloudOnlyFrom: which rows the device does not hold, matched as the sync matches', () => {
  const row = (id: string, more: { uid?: string; ownerId?: string } = {}) => ({
    id,
    name: `P-${id}`,
    updatedAt: 1000,
    ...more,
  });

  it('an own row not here is listed, filed under its row id, as its owner', () => {
    expect(cloudOnlyFrom(USER, [row('a', { ownerId: USER })], new Map(), [])).toEqual([
      { localId: 'a', remoteId: 'a', ownerId: USER, role: 'owner', name: 'P-a', updatedAt: 1000 },
    ]);
  });

  it('an own row is here when a local project has its id, or its uid', () => {
    expect(cloudOnlyFrom(USER, [row('a')], new Map(), [{ id: 'a' }])).toEqual([]);
    expect(
      cloudOnlyFrom(USER, [row('a', { uid: 'u1' })], new Map(), [{ id: 'x', cloudUid: 'u1' }]),
    ).toEqual([]);
  });

  it("a shared row is filed under its uid with the user's role, viewer when unknown", () => {
    const shared = row('a', { uid: 'u1', ownerId: 'someone' });
    const [editor] = cloudOnlyFrom(USER, [shared], new Map([['u1', 'editor']]), []);
    expect(editor).toMatchObject({ localId: 'u1', remoteId: 'a', role: 'editor' });
    const [viewer] = cloudOnlyFrom(USER, [shared], new Map(), []);
    expect(viewer?.role).toBe('viewer');
  });

  it("a shared row is not matched by the user's own project of the same id", () => {
    // The owner's browser id may name one of this user's projects: only the uid ties a shared row.
    const shared = row('a', { uid: 'u1', ownerId: 'someone' });
    expect(cloudOnlyFrom(USER, [shared], new Map(), [{ id: 'a' }])).toHaveLength(1);
    expect(cloudOnlyFrom(USER, [shared], new Map(), [{ id: 'u1' }])).toEqual([]);
  });
});

/** sync_roundtrip's fake, with a catalog and a count of how often a project's row is read. */
function fake() {
  const f = {
    objects: new Map<string, Uint8Array>(),
    rows: new Map<string, ProjectRow>(),
    gets: 0,
    async listProjects() {
      return [...f.rows.values()].map((r) => ({ id: r.id, version: r.version ?? 1 }));
    },
    async listCatalog(): Promise<CatalogRow[]> {
      return [...f.rows.values()].map((r) => ({
        id: r.id,
        version: r.version ?? 1,
        name: r.name,
        updated_at: '2026-11-18T12:00:00Z',
      }));
    },
    async getProject(id: string) {
      f.gets++;
      return f.rows.get(id) ?? null;
    },
    async commitProject(row: ProjectRow & { user_id: string }, base: number) {
      const cur = f.rows.get(row.id);
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
  setCloudBackend(backend as unknown as CloudBackend);
});
afterEach(() => setCloudBackend(null));

/** A project that is in the account and not on this device: pushed, then dropped here. */
async function onlyInTheAccount(aName: string): Promise<string> {
  const id = await saveProject(aName, [
    { name: 'amp.kicad_sch', bytes: text('(kicad_sch (version 20250114))') },
  ]);
  await cloudUpsert(USER, (await exportProject(id))!);
  await deleteProject(id);
  return id;
}

describe('the account, listed before anything downloads', () => {
  it('a project only in the account is listed by name from the rows alone', async () => {
    const id = await onlyInTheAccount('Amp');
    backend.gets = 0;
    const list = await cloudOnlyProjects(USER);
    expect(list.map((p) => [p.localId, p.name])).toEqual([[id, 'Amp']]);
    // no project row read, no file fetched: the list cost nothing per project
    expect(backend.gets).toBe(0);
    expect((await listProjects()).some((p) => p.id === id)).toBe(false);
  });

  it('opening it pulls it - once, though asked for twice at the same time', async () => {
    const id = await onlyInTheAccount('Amp');
    const [p] = await cloudOnlyProjects(USER);

    backend.gets = 0;
    await pullProjectNow(USER, p!);
    const one = backend.gets;
    expect(new TextDecoder().decode((await loadProject(id))!.files[0]!.bytes)).toBe(
      '(kicad_sch (version 20250114))',
    );

    await deleteProject(id);
    backend.gets = 0;
    await Promise.all([pullProjectNow(USER, p!), pullProjectNow(USER, p!)]);
    expect(backend.gets).toBe(one);

    // and once here, it is no longer "only in the account"
    expect(await cloudOnlyProjects(USER)).toEqual([]);
  });

  it('a backend without a catalog lists nothing extra, as before', async () => {
    await onlyInTheAccount('Amp');
    (backend as { listCatalog?: unknown }).listCatalog = undefined;
    expect(await cloudOnlyProjects(USER)).toEqual([]);
  });
});
