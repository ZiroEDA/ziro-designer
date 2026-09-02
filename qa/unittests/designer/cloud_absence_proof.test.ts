// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "The store says absent" is not the same as "the store cannot see anything",
 * and this is where the difference is enforced.
 *
 * A Supabase Storage listing runs under row-level security: an unauthorised
 * request returns *no rows and no error*. So a session that lapses mid-pass
 * makes every blob of every project read as missing, which the repair path took
 * as fact — it condemned a project whose 138 versions were all intact, and
 * offered to delete it. Nothing was wrong with the data at all.
 *
 * The guard is a positive control: a fixed tiny object written and read back
 * before any "missing" answer is acted on. If a blob we just wrote reads as
 * absent, absence carries no information and the caller must not proceed.
 */
import { describe, it, expect } from 'vitest';
import {
  assertStoreAnswers,
  cloudDelete,
  setCloudBackend,
} from '@ziroeda/designer/src/cloud/cloudStore.js';
import type { CloudBackend, ProjectRow } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';

/** A backend over an in-memory object map, with the failure modes dialled in. */
function fakeBackend(opts: {
  /** Listings answer "absent" for everything, as an unauthorised one does. */
  blind?: boolean;
  rows?: ProjectRow[];
  versions?: Record<string, { name: string; committed_at: string; files: unknown[] }[]>;
}): CloudBackend & { objects: Map<string, Uint8Array>; removed: string[] } {
  const objects = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const rows = new Map((opts.rows ?? []).map((r) => [r.id, r]));
  return {
    objects,
    removed,
    async putObject(path: string, bytes: Uint8Array) {
      objects.set(path, bytes);
    },
    async getObject(path: string) {
      const b = objects.get(path);
      if (!b) throw new Error(`no such object ${path}`);
      return b;
    },
    async hasObject(path: string) {
      return opts.blind ? false : objects.has(path);
    },
    async removeObjects(paths: string[]) {
      for (const p of paths) {
        removed.push(p);
        objects.delete(p);
      }
    },
    async listProjects() {
      return [...rows.values()].map((r) => ({ id: r.id, version: r.version ?? 1 }));
    },
    async getProject(id: string) {
      return rows.get(id) ?? null;
    },
    async commitProject(row: ProjectRow, base: number) {
      const cur = rows.get(row.id);
      // The rule the RPC enforces: base 0 asserts the row is new, any other
      // base asserts the row is still exactly at that version.
      if (base <= 0 ? cur !== undefined : (cur?.version ?? 1) !== base) return null;
      const version = base <= 0 ? 1 : base + 1;
      rows.set(row.id, { ...row, version });
      return version;
    },
    async deleteProject(id: string) {
      rows.delete(id);
    },
    async listVersions(_userId: string, id: string) {
      return (opts.versions?.[id] ?? []) as never;
    },
  } as unknown as CloudBackend & { objects: Map<string, Uint8Array>; removed: string[] };
}

describe('the store-answers probe', () => {
  it('passes when a written object reads back', async () => {
    setCloudBackend(fakeBackend({}));
    await expect(assertStoreAnswers(USER)).resolves.toBeUndefined();
  });

  it('throws when a blob just written reads as absent', async () => {
    // The lapsed-session shape: writes accepted, listings blind.
    setCloudBackend(fakeBackend({ blind: true }));
    await expect(assertStoreAnswers(USER)).rejects.toThrow(/not answering reliably/);
  });

  it('leaves exactly one probe object behind, however often it runs', async () => {
    // Content-addressed and fixed, so it cannot accumulate.
    const be = fakeBackend({});
    setCloudBackend(be);
    await assertStoreAnswers(USER);
    await assertStoreAnswers(USER);
    await assertStoreAnswers(USER);
    expect([...be.objects.keys()].filter((k) => k.startsWith(`${USER}/blobs/`))).toHaveLength(1);
  });

  it('propagates a write failure rather than reporting a verdict', async () => {
    const be = fakeBackend({});
    be.putObject = async () => {
      throw new Error('403 not authorised');
    };
    setCloudBackend(be);
    await expect(assertStoreAnswers(USER)).rejects.toThrow(/not authorised/);
  });
});

const manifest = (hashes: string[]) =>
  hashes.map((h) => ({ name: `${h}.kicad_sch`, hash: h, size: 10 }));

const row = (id: string, hashes: string[]): ProjectRow =>
  ({
    id,
    user_id: USER,
    name: id,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    files: manifest(hashes),
  }) as ProjectRow;

describe('collecting blobs when a project is deleted', () => {
  it('keeps the ones another project still names', async () => {
    const be = fakeBackend({ rows: [row('a', ['h1', 'h2']), row('b', ['h2'])] });
    setCloudBackend(be);
    await cloudDelete('a');
    expect(be.removed.some((p) => p.endsWith('h1'))).toBe(true);
    expect(be.removed.some((p) => p.endsWith('h2'))).toBe(false);
  });

  it('keeps the ones a past version of another project names', async () => {
    // The recovery path walks history back to a manifest whose objects are all
    // still there. Counting only current rows collected exactly those objects,
    // so deleting one project silently took every other project's history with
    // it — discovered on the day someone needed it, which is far too late.
    const be = fakeBackend({
      rows: [row('a', ['h1']), row('b', ['h9'])],
      versions: {
        b: [{ name: 'b', committed_at: '2026-01-01T00:00:00Z', files: manifest(['h1']) }],
      },
    });
    setCloudBackend(be);
    await cloudDelete('a');
    expect(be.removed.some((p) => p.endsWith('h1'))).toBe(false);
  });

  it('keeps everything when the still-referenced set cannot be established', async () => {
    const be = fakeBackend({ rows: [row('a', ['h1'])] });
    be.listProjects = async () => {
      throw new Error('network');
    };
    setCloudBackend(be);
    await cloudDelete('a');
    expect(be.removed).toHaveLength(0);
  });

  it('collects nothing at all when asked to keep the blobs', async () => {
    // What "Remove damaged" uses. If the damage report was ever wrong, this is
    // the step that would have made it true.
    const be = fakeBackend({ rows: [row('a', ['h1'])] });
    setCloudBackend(be);
    await cloudDelete('a', { keepBlobs: true });
    expect(be.removed).toHaveLength(0);
  });
});
