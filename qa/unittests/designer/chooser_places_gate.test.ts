// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The places sidebar, and where a save is allowed to land.
 *
 * This replaced a version pinning Recent/Projects/Demos/Templates with a
 * per-place `writable` flag. Two things were wrong with that design and both
 * were caught by looking at a real KiCad beside ours:
 *
 * - Demos and Templates were rows. Upstream has neither in this window: its
 *   sidebar is a `GtkPlacesSidebar` of the COMPUTER's places plus the one
 *   shortcut `openProject` adds,
 *   `dlg.AddShortcut( PATHS::GetDefaultUserProjectsPath() )`
 *   (kicad/tools/kicad_manager_control.cpp:493). Demos are reached through
 *   `File > Open Demo Project` and templates through the template selector.
 *   Ours were served from the CDN, identical for every account and never
 *   writable, so the file manager showed folders nobody can change.
 *
 * - `writable` is per-ROW, and the rule is per-FOLDER. Projects is one row
 *   holding every project the account has; a save from inside board A may land
 *   in A but not in board B.
 *
 * What replaced it is KiCad's own user-data layout — one folder per kind of
 * thing a user makes, every one a real `PATHS::` function:
 *
 *     projects     GetDefaultUserProjectsPath()     paths.cpp:137
 *     template     GetUserTemplatesPath()           paths.cpp:355
 *     symbols      GetDefaultUserSymbolsPath()      paths.cpp:82
 *     footprints   GetDefaultUserFootprintsPath()   paths.cpp:93
 *     3dmodels     GetDefaultUser3DModelsPath()     paths.cpp:115
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type AssetKind,
  USER_DIRS,
  chooserPlacesFor,
} from '@ziroeda/designer/src/fs/chooser_places.js';

const ids = (places: readonly { id: string }[]): string[] => places.map((p) => p.id);

describe('the folders are KiCad’s own, by name', () => {
  it('has one per kind a user makes, and no others', () => {
    expect(Object.keys(USER_DIRS).sort()).toStrictEqual([
      'footprints',
      'models3d',
      'symbols',
      'templates',
    ]);
  });

  it('holds no folder for anything DERIVED from one project', () => {
    // Gerbers plot into the project's own `gerbers/` or they download
    // (dialog_plot_pcb.tsx:93,121-133), which is KiCad's model too: the plot
    // directory is made relative to the project (dialog_plot.cpp:827-832) and
    // there is no outputs root anywhere. A shared one would pool every board's
    // gerbers into a single bucket.
    const names = Object.values(USER_DIRS).join(' ').toLowerCase();
    for (const derived of ['output', 'gerber', 'plot', 'export'])
      expect(names, `${derived} is not a shared folder`).not.toContain(derived);
  });
});

describe('saving offers this project or the shared folder, and nothing else', () => {
  const places = chooserPlacesFor({ mode: 'save', kind: 'templates', projectDir: '/MyBoard' });

  it('is exactly two rows', () => {
    expect(ids(places)).toStrictEqual(['projects', 'templates']);
  });

  it('names the row after the project, because the row IS that project', () => {
    expect(places[0]?.label).toBe('MyBoard');
    expect(places[0]?.path).toBe('/MyBoard');
  });

  it('CLAMPS it, so the breadcrumb cannot climb to a sibling board', () => {
    // `path` alone is only where the dialog LANDS; one click on the crumb above
    // it would be the account root with every project writable again.
    expect(places[0]?.root).toBe('/MyBoard');
    expect(places[1]?.root).toBe(USER_DIRS.templates);
  });

  it('shows no OTHER kind’s folder', () => {
    // A drawing sheet has no reason to see Footprints.
    expect(ids(places)).not.toContain('symbols');
    expect(ids(places)).not.toContain('footprints');
    expect(ids(places)).not.toContain('models3d');
  });

  it('has no Recent row', () => {
    // GTK has one because its sidebar is the only ordering a file dialog
    // offers. Ours sorts the project list by any column, in the place a person
    // is already looking.
    expect(ids(places)).not.toContain('recent');
  });
});

describe('saving with no project open', () => {
  it('offers the shared folder alone - there is no project to save INTO', () => {
    // Left out rather than offered and refused.
    const places = chooserPlacesFor({ mode: 'save', kind: 'symbols', projectDir: null });
    expect(ids(places)).toStrictEqual(['symbols']);
  });

  it('...unless there is no shared folder either, which is a project itself', () => {
    // The project manager's own Save As has nowhere else to go.
    expect(ids(chooserPlacesFor({ mode: 'save', projectDir: null }))).toStrictEqual(['projects']);
  });
});

describe('opening is not gated at all', () => {
  const places = chooserPlacesFor({ mode: 'open', kind: 'templates' });

  it('lists EVERY project, with or without one open', () => {
    expect(ids(places)).toStrictEqual(['projects', 'templates']);
    expect(places[0]?.root, 'the project list is clamped when opening').toBeUndefined();
    expect(places[0]?.path, 'the project list starts inside one project').toBeUndefined();
  });

  it('ignores projectDir, which only narrows a SAVE', () => {
    const withProject = chooserPlacesFor({ mode: 'open', kind: 'templates', projectDir: '/A' });
    expect(withProject[0]?.root).toBeUndefined();
    expect(withProject[0]?.label).toBe('Projects');
  });

  it('still hides the other kinds', () => {
    expect(ids(places)).not.toContain('footprints');
  });
});

describe('every kind gets its own row', () => {
  it('offers the right folder for each editor', () => {
    const expected: Record<AssetKind, string> = {
      templates: '/Templates',
      symbols: '/Symbols',
      footprints: '/Footprints',
      models3d: '/3D Models',
    };
    for (const kind of Object.keys(expected) as AssetKind[]) {
      const places = chooserPlacesFor({ mode: 'save', kind, projectDir: '/B' });
      expect(ids(places), kind).toStrictEqual(['projects', kind]);
      expect(places[1]?.path, kind).toBe(expected[kind]);
    }
  });
});

const CHOOSER = readFileSync(
  fileURLToPath(new URL('../../../designer/src/fs/FileChooser.tsx', import.meta.url)),
  'utf8',
);

describe('the widget half: the clamp is enforced, not merely declared', () => {
  it('refuses to navigate above the place’s root', () => {
    expect(CHOOSER).toContain('if (to === dir || !withinPlace(to)) return;');
  });

  it('refuses to go BACK above it either', () => {
    // History outlives a place change, so Back is a second way out.
    expect(CHOOSER).toContain('if (prev === undefined || !withinPlace(prev)) return h;');
  });

  it('drops the crumbs above it, so there is nothing to click', () => {
    expect(CHOOSER).toContain('.filter(withinPlace)');
  });

  it('defaults to the whole tree when a place sets no root', () => {
    // Every dialog that is not narrowing a save must be unaffected.
    expect(CHOOSER).toContain('const placeRoot = place?.root ?? ROOT;');
    expect(CHOOSER).toContain('placeRoot === ROOT ||');
  });
});
