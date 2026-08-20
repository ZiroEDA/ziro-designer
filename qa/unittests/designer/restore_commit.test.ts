// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `Restore Commit` — `LOCAL_HISTORY::RestoreCommit`
 * (common/local_history.cpp:2192-2382), reached from the Local History pane's
 * one context-menu item (kicad/local_history_pane.cpp:183-189).
 *
 * This runs against a real IndexedDB rather than reading source text, because
 * the thing worth pinning is an ORDER OF OPERATIONS on stored data and the ways
 * it goes wrong are all silent:
 *
 *   - a restore that replaces the project instead of overlaying it DELETES
 *     every file the snapshot does not mention. Upstream calls this out in a
 *     comment because it is the dangerous case: restoring a board-only autosave
 *     would otherwise take the schematic with it.
 *   - a restore with no pre-restore backup is not undoable, which makes the
 *     confirmation's promise ("your current files are backed up first") a lie.
 *   - a restore that does not re-commit afterwards leaves the newest snapshot
 *     disagreeing with the bytes on disk, so the next save reports every
 *     restored file as a fresh change.
 *
 * None of the three shows up in the pane. All three show up here.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitSnapshot,
  listSnapshots,
  readSnapshot,
  restoreSnapshot,
} from '@ziroeda/designer/src/home/local_history_store.js';
import {
  PRE_RESTORE_TITLE,
  RESTORE_CAPTION,
  RESTORE_EXTENDED,
  RESTORE_NO_LABEL,
  RESTORE_YES_LABEL,
  restoreConfirmMessage,
  restoredFromTitle,
} from '@ziroeda/designer/src/home/local_history.js';
import { yesNoButtons } from '@ziroeda/designer/src/ui/message_dialog.js';
import {
  deleteProject,
  loadProject,
  saveProject,
  updateProjectFiles,
} from '@ziroeda/designer/src/home/projectStore.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const file = (name: string, text: string) => ({ name, bytes: enc.encode(text) });

/** The project's files as a name -> text map, whatever order they come back in. */
async function contents(id: string): Promise<Record<string, string>> {
  const p = await loadProject(id);
  const out: Record<string, string> = {};
  for (const f of p?.files ?? []) out[f.name] = dec.decode(f.bytes);
  return out;
}

let id = '';

beforeEach(async () => {
  id = await saveProject('demo', [
    file('demo.kicad_pro', '{v:1}'),
    file('demo.kicad_sch', 'sch v1'),
  ]);
});

afterEach(async () => {
  await deleteProject(id);
});

describe('the snapshot is overlaid onto the project, never swapped for it', () => {
  it('brings back the files it holds', async () => {
    const snap = await commitSnapshot(id, (await loadProject(id))!.files);
    expect(snap).not.toBeNull();

    await updateProjectFiles(id, [file('demo.kicad_sch', 'sch v2')]);
    expect((await contents(id))['demo.kicad_sch']).toBe('sch v2');

    await restoreSnapshot(id, snap!.id);
    expect((await contents(id))['demo.kicad_sch']).toBe('sch v1');
  });

  it('leaves a file the snapshot never mentioned exactly where it was', async () => {
    // The case upstream writes a comment about (local_history.cpp:2334-2338):
    // "Restore never removes files that are absent from the snapshot, so
    // restoring a partial per-editor commit ... cannot delete the schematic,
    // project file, outputs, or libraries."
    const snap = await commitSnapshot(id, [file('demo.kicad_sch', 'sch v1')]);
    expect(snap).not.toBeNull();

    await updateProjectFiles(id, [file('demo.kicad_pcb', 'pcb v1')]);
    await restoreSnapshot(id, snap!.id);

    const after = await contents(id);
    expect(after['demo.kicad_sch']).toBe('sch v1');
    // The board was not in that snapshot. A swap would have deleted it.
    expect(after['demo.kicad_pcb']).toBe('pcb v1');
    expect(after['demo.kicad_pro']).toBe('{v:1}');
  });
});

describe('the restore is undoable, because the backup is taken first', () => {
  it('commits the pre-restore backup, and it holds the state being replaced', async () => {
    const snap = await commitSnapshot(id, (await loadProject(id))!.files);
    await updateProjectFiles(id, [file('demo.kicad_sch', 'sch v2')]);

    await restoreSnapshot(id, snap!.id);

    const history = await listSnapshots(id);
    const backup = history.find((s) => s.title === PRE_RESTORE_TITLE);
    expect(backup, 'no "Pre-restore backup" commit was made').toBeDefined();

    // Load it and check it is the state that got overwritten, not the restored
    // one. A backup taken AFTER the overlay would pass a mere existence check
    // and still be useless, which is why this reads the bytes.
    const saved = await readSnapshot(backup!.id);
    const sch = saved?.find((f) => f.name === 'demo.kicad_sch');
    expect(dec.decode(sch!.bytes)).toBe('sch v2');
  });

  it('backs up the WHOLE project, even when the snapshot being restored is partial', async () => {
    // The scenario that separates a real undo point from a plausible-looking
    // one: restoring a board-only autosave. If the backup stores only the files
    // the snapshot mentions, the undo point silently loses the schematic and
    // the project file - and this branch has already shipped that bug once in
    // the other direction, because `persistFilesNow` receives only the CHANGED
    // files and a snapshot taken from it stores a partial project. Content
    // addressing makes a wrong snapshot hash exactly like a right one, so
    // nothing downstream can notice.
    const snap = await commitSnapshot(id, [file('demo.kicad_sch', 'sch v1')]);
    await updateProjectFiles(id, [
      file('demo.kicad_sch', 'sch v2'),
      file('demo.kicad_pcb', 'pcb v1'),
    ]);

    await restoreSnapshot(id, snap!.id);

    const backup = (await listSnapshots(id)).find((s) => s.title === PRE_RESTORE_TITLE);
    expect(backup, 'no "Pre-restore backup" commit was made').toBeDefined();
    const saved = await readSnapshot(backup!.id);
    expect(saved?.map((f) => f.name).sort()).toStrictEqual([
      'demo.kicad_pcb',
      'demo.kicad_pro',
      'demo.kicad_sch',
    ]);
  });

  it('re-commits the result, so the newest snapshot is what is on disk', async () => {
    const snap = await commitSnapshot(id, (await loadProject(id))!.files);
    await updateProjectFiles(id, [file('demo.kicad_sch', 'sch v2')]);

    await restoreSnapshot(id, snap!.id);

    const history = await listSnapshots(id);
    expect(history[0]!.title).toBe(restoredFromTitle(snap!.id));
    // ...and it really is the disk, not just a label.
    const newest = await readSnapshot(history[0]!.id);
    const sch = newest?.find((f) => f.name === 'demo.kicad_sch');
    expect(dec.decode(sch!.bytes)).toBe('sch v1');
  });

  it('orders the two: backup first, restored-from second', async () => {
    const snap = await commitSnapshot(id, (await loadProject(id))!.files);
    await updateProjectFiles(id, [file('demo.kicad_sch', 'sch v2')]);
    await restoreSnapshot(id, snap!.id);

    const history = await listSnapshots(id); // newest first
    const iRestored = history.findIndex((s) => s.title === restoredFromTitle(snap!.id));
    const iBackup = history.findIndex((s) => s.title === PRE_RESTORE_TITLE);
    expect(iRestored, 'no restored-from commit').toBeGreaterThanOrEqual(0);
    expect(iBackup, 'no pre-restore backup').toBeGreaterThanOrEqual(0);
    expect(iRestored).toBeLessThan(iBackup);
  });
});

describe('a snapshot that is gone changes nothing', () => {
  it('returns null and leaves the project alone', async () => {
    const before = await contents(id);
    expect(await restoreSnapshot(id, 'no-such-snapshot')).toBeNull();
    expect(await contents(id)).toStrictEqual(before);
    expect(await listSnapshots(id)).toStrictEqual([]);
  });
});

describe("the confirmation is RestoreCommit's, word for word", () => {
  it('asks with the commit time, formatted the way wxDateTime::Format does', () => {
    // `_( "Restore the project to the version from %s?" )` with
    // `when.Format( wxS( "%Y-%m-%d %H:%M:%S" ) )`, which is LOCAL time.
    const at = new Date(2026, 7, 21, 9, 4, 5).getTime();
    expect(restoreConfirmMessage(at)).toBe(
      'Restore the project to the version from 2026-08-21 09:04:05?',
    );
  });

  it('carries the caption, the labels and the extended message upstream sets', () => {
    expect(RESTORE_CAPTION).toBe('Restore Version');
    expect(RESTORE_YES_LABEL).toBe('Restore');
    expect(RESTORE_NO_LABEL).toBe('Cancel');
    expect(RESTORE_EXTENDED).toBe(
      'Your current files are backed up first so you can undo the restore. ' +
        'Files that are not part of this version are left untouched.',
    );
  });

  it('puts the focus ring on Cancel, because the style word says wxNO_DEFAULT', () => {
    // The destructive answer must never be the one Enter picks.
    const row = yesNoButtons('no', { yes: RESTORE_YES_LABEL, no: RESTORE_NO_LABEL });
    // GTK order: negative first, affirmative last.
    expect(row.map((b) => b.label)).toStrictEqual(['Cancel', 'Restore']);
    expect(row.find((b) => b.isDefault)!.id).toBe('no');
  });

  it('SetYesNoLabels renames the buttons without moving which one is affirmative', () => {
    const row = yesNoButtons('no', { yes: RESTORE_YES_LABEL, no: RESTORE_NO_LABEL });
    expect(row.find((b) => b.id === 'yes')!.label).toBe('Restore');
    // ...and with no labels given, GTK's stock pair is still what appears.
    expect(yesNoButtons('no').map((b) => b.label)).toStrictEqual(['No', 'Yes']);
  });
});
