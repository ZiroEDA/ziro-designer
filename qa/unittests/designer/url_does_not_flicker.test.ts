// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Coming back from an editor must not bounce the address through `/`.
 *
 * The manager is mounted only while it is the view, so returning remounts it
 * with an empty project list; it reported "no open project" for one render,
 * the app forgot the open project, the address fell to `/`, and came back to
 * `/p/<uid>` when the list arrived. Source-level, like the other pins on the
 * manager, which qa cannot compile.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOME = readFileSync(
  fileURLToPath(new URL('../../../designer/src/home/HomePage.tsx', import.meta.url)),
  'utf8',
);

describe('the manager reports the open project only once it can know it', () => {
  it('waits for the saved list to have loaded before reporting an id off it', () => {
    const effect = HOME.slice(
      HOME.indexOf('if (!savedLoaded && projName) return;'),
      HOME.indexOf('onProjectIdChange?.(openProjectId);'),
    );
    expect(effect.length).toBeGreaterThan(0);
    expect(HOME).toContain('}, [openProjectId, onProjectIdChange, savedLoaded, projName]);');
  });

  it('and the flag is set by the same read that fills the list', () => {
    const refresh = HOME.slice(
      HOME.indexOf('const refreshSaved = '),
      HOME.indexOf('useEffect(refreshSaved, []);'),
    );
    expect(refresh).toContain('setSaved(list);');
    expect(refresh).toContain('setSavedLoaded(true);');
  });
});
