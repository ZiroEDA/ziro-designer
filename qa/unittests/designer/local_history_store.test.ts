// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Local History's store, run against a real IndexedDB.
 *
 * Upstream lets libgit2 answer all of this, so the parts worth executing here
 * are the ones we had to write: that a snapshot with nothing new in it is
 * declined, that blobs are shared between snapshots rather than copied, and
 * that deleting a snapshot frees only what nothing else still points at. Each
 * of those is silent when wrong - the pane looks fine and the origin fills up.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitSnapshot,
  deleteProjectHistory,
  deleteSnapshots,
  enforceSizeLimit,
  listSnapshots,
  readSnapshot,
} from '@ziroeda/designer/src/home/local_history_store.js';
import type { StoredFile } from '@ziroeda/designer/src/home/projectStore.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const file = (name: string, text: string): StoredFile => ({ name, bytes: enc.encode(text) });

const PRJ = 'prj-1';

async function wipe(): Promise<void> {
  await deleteProjectHistory(PRJ);
  await deleteProjectHistory('other');
}

beforeEach(wipe);
afterEach(wipe);

describe('committing a snapshot', () => {
  it('records the files and what changed', async () => {
    const s = await commitSnapshot(PRJ, [file('a.kicad_sch', 'v1'), file('b.kicad_pcb', 'x')]);
    expect(s).not.toBeNull();
    expect(s?.files.map((f) => f.name)).toEqual(['a.kicad_sch', 'b.kicad_pcb']);
    // The first snapshot is all-new.
    expect(s?.changed).toEqual(['a.kicad_sch', 'b.kicad_pcb']);
  });

  it('declines a snapshot with nothing new in it', async () => {
    // git declines an empty commit, and a history full of identical entries
    // would be useless exactly when it is needed.
    const files = [file('a.kicad_sch', 'v1')];
    expect(await commitSnapshot(PRJ, files)).not.toBeNull();
    expect(await commitSnapshot(PRJ, files)).toBeNull();
    expect(await listSnapshots(PRJ)).toHaveLength(1);
  });

  it('names only the file that moved on a later save', async () => {
    await commitSnapshot(PRJ, [file('a.kicad_sch', 'v1'), file('b.kicad_pcb', 'x')]);
    const s = await commitSnapshot(PRJ, [file('a.kicad_sch', 'v2'), file('b.kicad_pcb', 'x')]);
    expect(s?.changed).toEqual(['a.kicad_sch']);
  });

  it('lists newest first, as the pane shows them', async () => {
    await commitSnapshot(PRJ, [file('a', '1')]);
    await commitSnapshot(PRJ, [file('a', '2')]);
    await commitSnapshot(PRJ, [file('a', '3')]);
    const list = await listSnapshots(PRJ);
    expect(list).toHaveLength(3);
    expect(list[0]!.at).toBeGreaterThanOrEqual(list[1]!.at);
    expect(list[1]!.at).toBeGreaterThanOrEqual(list[2]!.at);
  });

  it('keeps one project’s history out of another’s', async () => {
    await commitSnapshot(PRJ, [file('a', '1')]);
    await commitSnapshot('other', [file('a', '1')]);
    expect(await listSnapshots(PRJ)).toHaveLength(1);
    expect(await listSnapshots('other')).toHaveLength(1);
  });

  it('carries the kind through, which is how the pane tints the row', async () => {
    const s = await commitSnapshot(PRJ, [file('a', '1')], 'autosave', 'a');
    expect(s?.kind).toBe('autosave');
    expect(s?.title).toMatch(/^Autosave/);
  });
});

describe('reading a snapshot back', () => {
  it('returns the bytes exactly as they went in', async () => {
    const s = await commitSnapshot(PRJ, [file('a.kicad_sch', 'hello'), file('b.txt', 'world')]);
    const back = await readSnapshot(s!.id);
    expect(back?.map((f) => f.name).sort()).toEqual(['a.kicad_sch', 'b.txt']);
    expect(dec.decode(back?.find((f) => f.name === 'a.kicad_sch')?.bytes)).toBe('hello');
  });

  it('round-trips bytes that are not text', async () => {
    // Projects carry 3D models and images; gzip is transparent but a store that
    // assumed UTF-8 anywhere would corrupt them silently.
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 0, 128]);
    const s = await commitSnapshot(PRJ, [{ name: 'm.step', bytes }]);
    const back = await readSnapshot(s!.id);
    expect(Array.from(back?.[0]?.bytes ?? [])).toEqual(Array.from(bytes));
  });

  it('returns an old version after the file has moved on', async () => {
    // The whole point of the feature.
    const first = await commitSnapshot(PRJ, [file('a.kicad_sch', 'v1')]);
    await commitSnapshot(PRJ, [file('a.kicad_sch', 'v2')]);
    const back = await readSnapshot(first!.id);
    expect(dec.decode(back?.[0]?.bytes)).toBe('v1');
  });

  it('is null for a snapshot that is not there', async () => {
    expect(await readSnapshot('no-such-id')).toBeNull();
  });
});

describe('blobs are shared, not copied', () => {
  it('leaves an unchanged file readable from every snapshot that names it', async () => {
    // Ten snapshots of a board where one file changed must cost one copy of
    // everything else - the property that makes snapshotting each save
    // affordable. If a later commit had overwritten or skipped the shared blob,
    // this read would come back short or wrong.
    const big = file('big.step', 'a very large model');
    const a = await commitSnapshot(PRJ, [big, file('s.kicad_sch', 'v1')]);
    const b = await commitSnapshot(PRJ, [big, file('s.kicad_sch', 'v2')]);

    for (const s of [a, b]) {
      const back = await readSnapshot(s!.id);
      expect(dec.decode(back?.find((f) => f.name === 'big.step')?.bytes)).toBe(
        'a very large model',
      );
    }
  });

  it('still reads a file that reverted to an earlier version', async () => {
    // The revert re-uses the original blob rather than storing a third copy,
    // so this is the case where a naive "delete blobs from the old snapshot"
    // would have destroyed live data.
    await commitSnapshot(PRJ, [file('a', 'v1')]);
    await commitSnapshot(PRJ, [file('a', 'v2')]);
    const third = await commitSnapshot(PRJ, [file('a', 'v1')]);
    expect(dec.decode((await readSnapshot(third!.id))?.[0]?.bytes)).toBe('v1');
  });
});

describe('deleting', () => {
  it('leaves the surviving snapshots readable', async () => {
    // The collection pass frees only blobs nothing still points at; a shared
    // file must survive its first snapshot being deleted.
    const shared = file('big.step', 'model');
    const first = await commitSnapshot(PRJ, [shared, file('a', 'v1')]);
    const second = await commitSnapshot(PRJ, [shared, file('a', 'v2')]);

    await deleteSnapshots([first!.id]);

    expect(await listSnapshots(PRJ)).toHaveLength(1);
    const back = await readSnapshot(second!.id);
    expect(dec.decode(back?.find((f) => f.name === 'big.step')?.bytes)).toBe('model');
    expect(dec.decode(back?.find((f) => f.name === 'a')?.bytes)).toBe('v2');
  });

  it('takes a project’s whole history without touching another’s', async () => {
    await commitSnapshot(PRJ, [file('a', '1')]);
    await commitSnapshot('other', [file('a', '1')]);
    await deleteProjectHistory(PRJ);
    expect(await listSnapshots(PRJ)).toHaveLength(0);
    expect(await listSnapshots('other')).toHaveLength(1);
  });
});

describe('the size limit (EnforceSizeLimit)', () => {
  it('drops the oldest and keeps the newest readable', async () => {
    const big = 'x'.repeat(4000);
    await commitSnapshot(PRJ, [file('a', `${big}1`)]);
    await commitSnapshot(PRJ, [file('a', `${big}2`)]);
    const newest = await commitSnapshot(PRJ, [file('a', `${big}3`)]);

    await enforceSizeLimit(PRJ, 5000);

    const left = await listSnapshots(PRJ);
    expect(left.length).toBeLessThan(3);
    expect(left.some((s) => s.id === newest!.id)).toBe(true);
    expect(await readSnapshot(newest!.id)).not.toBeNull();
  });

  it('keeps the last snapshot even under an impossible budget', async () => {
    // Deleting the last copy of the current state to satisfy a size cap is the
    // one outcome nobody wants from a feature called history.
    await commitSnapshot(PRJ, [file('a', 'v1')]);
    await commitSnapshot(PRJ, [file('a', 'v2')]);
    await enforceSizeLimit(PRJ, 0);
    expect((await listSnapshots(PRJ)).length).toBe(1);
  });
});
