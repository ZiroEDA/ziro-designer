// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Local History records what a USER does, not only what the app opens.
 *
 * `LOCAL_HISTORY::CommitSnapshot` runs from the same place a save does
 * upstream. Ours had exactly one call site — HomePage's open/import path — so
 * every row in the pane was a project being opened, an hour of editing with
 * Ctrl+S throughout produced no history at all, and the pane looked like it
 * worked. These are the properties that made that possible.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../../designer/src');
const APP = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const STORE = readFileSync(join(SRC, 'home/local_history_store.ts'), 'utf8');
const HOME = readFileSync(join(SRC, 'home/HomePage.tsx'), 'utf8');
const SCH = readFileSync(join(SRC, 'editors/schematic/SchematicEditor.tsx'), 'utf8');

/** The body of a named `const x = useCallback(` / `= async (` binding. */
function body(src: string, name: string): string {
  const start = src.indexOf(`const ${name} =`);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n  }, [', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('an explicit Save records a history point', () => {
  it('App has a save path that commits a snapshot', () => {
    expect(body(APP, 'saveProjectFiles')).toMatch(/recordSnapshot\(/);
  });

  it("it is kind 'save', the row the pane draws in the normal foreground", () => {
    expect(body(APP, 'saveProjectFiles')).toMatch(/recordSnapshot\([^)]*'save'/s);
  });

  it('the schematic Save routes through it', () => {
    expect(body(SCH, 'save')).toMatch(/onSaveFiles\(/);
  });
});

describe('the snapshot is the whole project, at its current content', () => {
  /*
   * The two ways to get this silently wrong. Both would produce a snapshot the
   * store is perfectly happy with — it is content-addressed, so a partial or a
   * stale set hashes and stores exactly like a correct one.
   */
  it('reads the record back rather than snapshotting the changed subset', () => {
    // `files` is only what the editor just wrote.
    const b = body(APP, 'saveProjectFiles');
    expect(b).toMatch(/loadProject\(rec\.id\)/);
    expect(b).not.toMatch(/recordSnapshot\(\s*rec\.id,\s*files/);
  });

  it('never snapshots projectFilesRef, which holds the project as OPENED', () => {
    const b = body(APP, 'saveProjectFiles');
    expect(b).not.toMatch(/recordSnapshot\([^)]*projectFilesRef/s);
  });

  it('writes before it snapshots, so the point is the saved content', () => {
    const b = body(APP, 'saveProjectFiles');
    expect(b.indexOf('updateProjectFiles')).toBeLessThan(b.indexOf('loadProject'));
    expect(b.indexOf('loadProject')).toBeLessThan(b.indexOf('recordSnapshot'));
  });

  it('awaits the write, rather than racing it', () => {
    expect(body(APP, 'saveProjectFiles')).toMatch(/await updateProjectFiles\(/);
  });
});

describe('autosave does not forge save points', () => {
  /*
   * The distinction Revert depends on: a 'save' row must mean the user chose
   * that point. These are per-occurrence checks on the two autosave functions,
   * not a file-level search, because App.tsx legitimately contains
   * `recordSnapshot` elsewhere.
   */
  it('writePending commits no snapshot', () => {
    expect(body(APP, 'writePending')).not.toMatch(/recordSnapshot|commitSnapshot/);
  });

  it('onProjectChange commits no snapshot', () => {
    expect(body(APP, 'onProjectChange')).not.toMatch(/recordSnapshot|commitSnapshot/);
  });

  it('persistFilesNow commits no snapshot - it is for incidental writes', () => {
    expect(body(APP, 'persistFilesNow')).not.toMatch(/recordSnapshot|commitSnapshot/);
  });
});

describe('commit-then-settle has one home, now that two callers want it', () => {
  it('the store pairs them, and owns the budget', () => {
    expect(STORE).toMatch(/export async function recordSnapshot\(/);
    expect(STORE).toMatch(/export const HISTORY_MAX_BYTES/);
  });

  it('HomePage no longer repeats the pairing or the budget', () => {
    expect(HOME).not.toMatch(/enforceSizeLimit\(/);
    expect(HOME).not.toMatch(/const HISTORY_MAX_BYTES/);
    expect(HOME).toMatch(/recordSnapshot\(/);
  });

  it('and neither does App', () => {
    expect(APP).not.toMatch(/enforceSizeLimit\(/);
    expect(APP).not.toMatch(/HISTORY_MAX_BYTES/);
  });
});
