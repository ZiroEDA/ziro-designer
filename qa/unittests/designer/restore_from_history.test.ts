// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The last place to look before calling a project lost.
 *
 * A row whose blobs are gone is unreadable, but blobs are only collected when no
 * row references them, so the objects of a version that was replaced routinely
 * outlive it. Walking the project's history back to the newest manifest whose
 * blobs are all still there recovers the most recent state that can actually be
 * read, which for a project damaged before the commit protocol existed may be
 * the only copy left anywhere.
 *
 * This is the branch eleven projects in one account are sitting in: cloud copy
 * unreadable, nothing on the machine to restore from.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  deleteProject,
  listProjects,
  loadProject,
} from '@ziroeda/designer/src/home/projectStore.js';
import { setCloudBackend, restoreFromHistory } from '@ziroeda/designer/src/cloud/cloudStore.js';
import { syncAllProjects } from '@ziroeda/designer/src/cloud/sync.js';
import { sha256Hex } from '@ziroeda/designer/src/cloud/blobStore.js';
import type { CloudBackend, ProjectRow, RowFile } from '@ziroeda/designer/src/cloud/backend.js';

const USER = 'user-1';
const ID = 'p-damaged';
const gz = (s: string): Uint8Array => new TextEncoder().encode(s);

interface Version {
  name: string;
  files: RowFile[];
  committed_at: string;
}

function fake(): CloudBackend & {
  objects: Map<string, Uint8Array>;
  rows: Map<string, ProjectRow>;
  versions: Version[];
} {
  const f = {
    objects: new Map<string, Uint8Array>(),
    rows: new Map<string, ProjectRow>(),
    versions: [] as Version[],
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
      return f.objects.has(path);
    },
    async removeObjects(paths: string[]) {
      for (const p of paths) f.objects.delete(p);
    },
    async listVersions(_userId: string, projectId: string) {
      return projectId === ID ? f.versions : [];
    },
  };
  return f;
}

let backend: ReturnType<typeof fake>;
beforeEach(async () => {
  for (const p of await listProjects()) await deleteProject(p.id);
  backend = fake();
  setCloudBackend(backend);
});
afterEach(() => setCloudBackend(null));

/** Put a blob in the store and return a manifest entry for it. */
async function blob(name: string, text: string): Promise<RowFile> {
  const bytes = gz(text);
  const hash = await sha256Hex(bytes);
  backend.objects.set(`${USER}/blobs/${hash}`, bytes);
  return { name, hash, size: bytes.length };
}

/** A manifest entry whose blob is deliberately not stored. */
async function ghost(name: string, text: string): Promise<RowFile> {
  const bytes = gz(text);
  return { name, hash: await sha256Hex(bytes), size: bytes.length };
}

/** The damaged row: newer than anything local, referencing nothing that exists. */
function damagedRow(files: RowFile[]): void {
  backend.rows.set(ID, {
    id: ID,
    user_id: USER,
    name: 'Class-D',
    created_at: new Date(1_000).toISOString(),
    updated_at: new Date(Date.now() + 60_000).toISOString(),
    files,
  });
}

describe('restoring a damaged project from its history', () => {
  it('rolls back to the newest version whose blobs are all still there', async () => {
    damagedRow([await ghost('amp.kicad_sch', 'CURRENT')]);
    // Newest first, as the backend returns them. The newest is also broken.
    backend.versions = [
      { name: 'Class-D', files: [await ghost('amp.kicad_sch', 'ALSO GONE')], committed_at: 'c' },
      { name: 'Class-D', files: [await blob('amp.kicad_sch', 'INTACT')], committed_at: 'b' },
      { name: 'Class-D', files: [await blob('amp.kicad_sch', 'OLDER')], committed_at: 'a' },
    ];

    const restored = await restoreFromHistory(USER, ID);

    expect(restored).toMatchObject({ committedAt: 'b', files: 1 });
    // And the row now names blobs that exist, so any client can read it.
    const row = backend.rows.get(ID)!;
    for (const f of row.files as { hash: string }[]) {
      expect(backend.objects.has(`${USER}/blobs/${f.hash}`)).toBe(true);
    }
  });

  it('gives up when no version is intact', async () => {
    damagedRow([await ghost('amp.kicad_sch', 'CURRENT')]);
    backend.versions = [
      { name: 'Class-D', files: [await ghost('amp.kicad_sch', 'GONE')], committed_at: 'b' },
    ];
    expect(await restoreFromHistory(USER, ID)).toBeNull();
  });

  it('gives up when there is no history at all', async () => {
    damagedRow([await ghost('amp.kicad_sch', 'CURRENT')]);
    expect(await restoreFromHistory(USER, ID)).toBeNull();
  });

  it('skips a version that names no blobs to check', async () => {
    // The legacy shapes carry no hashes, so nothing about them can be proven.
    damagedRow([await ghost('amp.kicad_sch', 'CURRENT')]);
    backend.versions = [
      { name: 'Class-D', files: [{ name: 'amp.kicad_sch' }], committed_at: 'legacy' },
      { name: 'Class-D', files: [await blob('amp.kicad_sch', 'INTACT')], committed_at: 'b' },
    ];

    expect(await restoreFromHistory(USER, ID)).toMatchObject({ committedAt: 'b' });
  });

  it('recovers the project through a full sync, and lands it on this device', async () => {
    // End to end, in the state the account is actually in: a damaged cloud row,
    // no local copy, and one intact version behind it.
    damagedRow([await ghost('amp.kicad_sch', 'CURRENT')]);
    backend.versions = [
      { name: 'Class-D', files: [await blob('amp.kicad_sch', 'INTACT')], committed_at: 'b' },
    ];

    const result = await syncAllProjects(USER);

    expect(result.failures).toEqual([]);
    expect(result.healed).toBe(1);
    const local = await loadProject(ID);
    expect(new TextDecoder().decode(local!.files[0]!.bytes)).toBe('INTACT');
  });

  it('reports an unrecoverable project as such, so it can be cleared out', async () => {
    damagedRow([await ghost('amp.kicad_sch', 'CURRENT')]);

    const result = await syncAllProjects(USER);

    expect(result.healed).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.unrecoverable).toBe(true);
    expect(result.failures[0]!.message).toContain('Class-D');
    expect(result.failures[0]!.message).toContain('no earlier version is intact');
  });
});
