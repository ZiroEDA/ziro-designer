// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A Git pull reaches the editors, and the editors' work reaches a pull - found by the end-to-end
 * test on production, 11-19:
 *
 * A/B. A pull re-read the manager's tree only. The open schematic kept its pre-pull sheet and
 *      wrote it back over the pull at the next save or tab switch; a pull could report success and
 *      leave the project as it was before the commit. Now the editors' work is flushed into the
 *      store before a pull, commit or switch reads it, and a landed pull re-opens the project in
 *      the App (openProjectFiles: edits dropped, openNonce moved, every editor reloads).
 * E.   The schematic's placeholder sheet (untitled.kicad_sch) was handed up as a project file and,
 *      since the host takes new sheet files (U-6), joined the project.
 *
 * App.tsx, HomePage.tsx, use_github_project.tsx and sch_edit_frame_ui.tsx are not renderable here,
 * so each obligation is read at its own call site.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(join(__dirname, '../../..', p), 'utf8');
const HOOK = read('designer/src/github/use_github_project.tsx');
const HOME = read('designer/src/home/HomePage.tsx');
const APP = read('designer/src/App.tsx');
const SCH = read('eeschema/sch_edit_frame_ui.tsx');

/** From `start` to the first line at the given indent that closes it. */
function from(aText: string, aStart: string, aEnd: string): string {
  const at = aText.indexOf(aStart);
  expect(at).toBeGreaterThan(-1);
  return aText.slice(at, aText.indexOf(aEnd, at + aStart.length));
}

describe('the GitHub hook', () => {
  it('flushes the editors before it reads the project from the store', () => {
    const body = from(HOOK, 'const filesOf = async (aId: string) => {', '};');
    const flush = body.indexOf('await hostRef.current.flushEditors();');
    expect(flush).toBeGreaterThan(-1);
    expect(body.indexOf('await loadProject(aId)')).toBeGreaterThan(flush);
  });

  it('reloads the editors after a pull lands, not only the tree', () => {
    const land = from(HOOK, 'const landPull = async (', '} catch (e) {');
    expect(land).toMatch(/await hostRef\.current\.reloadOpenProject\(id\);/);
    expect(land).not.toMatch(/hostRef\.current\.openStored\(id\)/);
  });
});

describe('the host side', () => {
  it("HomePage hands the reloaded files to the App, and the App's flush to the hook", () => {
    expect(HOME).toMatch(
      /reloadOpenProject: async \(id\) => \{\s*const opened = await openStored\(id\);\s*if \(opened\) onProjectReloaded\?\.\(opened\);/,
    );
    expect(HOME).toMatch(/flushEditors: \(\) => flushEditors\?\.\(\) \?\? Promise\.resolve\(\),/);
  });

  it('the App re-opens the project in place when it is the open one, and its flush settles', () => {
    expect(APP).toMatch(/flushEditors=\{flushSaves\}/);
    expect(APP).toMatch(
      /onProjectReloaded=\{\(files\) => \{\s*const cur = projectFilesRef\.current;\s*if \(cur && projectNameOf\(cur\) === projectNameOf\(files\)\) openProjectFiles\(files\);/,
    );
    const flush = from(APP, 'const flushSaves = useCallback((): Promise<void> => {', '}, [');
    expect(flush).toMatch(/const written = writePending\(\);/);
    expect(flush).toMatch(/return written;/);
  });
});

describe("the schematic editor's placeholder sheet", () => {
  it('is never handed up as a project file, by autosave or by an edit', () => {
    const sheets = from(SCH, 'const serializeSheets = useCallback(', '}, [');
    expect(sheets).toMatch(/if \(file === DEFAULT_FILE\) continue;/);
    expect(SCH).toMatch(/const real = files\.filter\(\(f\) => f\.name !== DEFAULT_FILE\);/);
    expect(SCH).toMatch(/onProjectChange\?\.\(real, \{ push: mine \}\);/);
  });
});
