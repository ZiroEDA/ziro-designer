// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Toolbars, for every frame that has one.
 *
 * Upstream builds `PANEL_TOOLBAR_CUSTOMIZATION` for SEVEN frames, and each gets
 * its own `TOOLBAR_SETTINGS` file:
 *
 *     FRAME_SCH_SYMBOL_EDITOR   "symbol_editor-toolbars"  eeschema.cpp:301
 *     FRAME_SCH                 "eeschema-toolbars"       eeschema.cpp:357
 *     FRAME_PL_EDITOR           "pl_editor-toolbars"      pl_editor.cpp:99
 *     FRAME_FOOTPRINT_EDITOR    "fpedit-toolbars"         pcbnew.cpp:384
 *     FRAME_PCB_EDITOR          "pcbnew-toolbars"         pcbnew.cpp:455
 *     FRAME_PCB_DISPLAY3D       "3d_viewer-toolbars"      pcbnew.cpp:484
 *     FRAME_GERBER              "gerbview-toolbars"       gerbview.cpp:110
 *
 * We had five. The Footprint Editor and the 3D Viewer had no file, no page and
 * no heading, so both frames drew their toolbars straight from the module
 * constant — the exact failure `useToolbarEntries` was written to prevent:
 *
 *     tbConfig = m_toolbarSettings->GetToolbarConfig( TOOLBAR_LOC::LEFT,
 *                                                     config()->m_CustomToolbars );
 *     if( tbConfig.has_value() ) m_tbLeft->ApplyConfiguration( tbConfig.value() );
 *     (`common/eda_base_frame.cpp:1728-1843`)
 *
 * A page that edits the store while the frame reads the constant looks like it
 * works and changes nothing, which is why the first two describes below read
 * the EDITOR's source rather than only exercising the page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  FPEDIT_DEFAULTS,
  SETTINGS_SLICES,
  TOOLBAR_APPS,
  VIEWER3D_DEFAULTS,
  settings,
} from '@ziroeda/designer/src/prefs/settings.js';
import { setStoredToolbarConfig } from '@ziroeda/designer/src/ui/toolbar_config.js';
import type { ToolbarDefaults, ToolbarItemJson } from '@ziroeda/designer/src/ui/toolbar_config.js';
import { PAGES } from '@ziroeda/designer/src/dialogs/prefs/registry.js';
import { toolbarEntries } from '@ziroeda/designer/src/ui/useToolbarEntries.js';
import { FP_DEFAULT_TOOLBARS } from '@ziroeda/designer/src/editors/footprint/footprintToolbars.js';
import { VIEWER3D_DEFAULT_TOOLBARS } from '@ziroeda/designer/src/editors/pcb/viewer3dToolbars.js';

afterEach(cleanup);

const src = (rel: string): string =>
  readFileSync(resolve(process.cwd(), '../designer/src', rel), 'utf8');

describe('every frame with the page has a toolbars file', () => {
  it('names all seven, and no more', () => {
    expect([...TOOLBAR_APPS].sort()).toEqual(
      [
        '3d_viewer',
        'eeschema',
        'fpedit',
        'gerbview',
        'pcbnew',
        'pl_editor',
        'symbol_editor',
      ].sort(),
    );
  });

  it('each is a settings slice, so a customised toolbar follows the account', () => {
    for (const app of TOOLBAR_APPS)
      expect(SETTINGS_SLICES as readonly string[], app).toContain(`${app}-toolbars`);
  });

  /**
   * `GetAppSettings<EDA_3D_VIEWER_SETTINGS>( "3d_viewer" )` — a file of its own,
   * not a corner of `pcbnew.json`, which is what makes the 3D Viewer's
   * "Customize toolbars" independent of the board editor's.
   */
  it('gives the 3D Viewer its own app settings file, as pcbnew.cpp:483 does', () => {
    expect(SETTINGS_SLICES as readonly string[]).toContain('3d_viewer');
    expect(VIEWER3D_DEFAULTS.appearance.custom_toolbars).toBe(false);
    expect(FPEDIT_DEFAULTS.appearance.custom_toolbars).toBe(false);
  });
});

describe('the frame reads the store, not the module constant', () => {
  /*
   * Read as SOURCE. A rendered assertion cannot tell the two apart while the
   * store is empty — `resolveToolbarConfig` falls back to the defaults, so a
   * frame wired to the constant paints exactly the same thing until somebody
   * customises it, which is precisely how this shipped unnoticed.
   */
  const FRAMES: [file: string, app: string][] = [
    ['editors/schematic/SchematicEditor.tsx', 'eeschema'],
    ['editors/symbol/SymbolEditor.tsx', 'symbol_editor'],
    ['editors/pcb/PcbEditor.tsx', 'pcbnew'],
    ['editors/drawingsheet/DrawingSheetEditor.tsx', 'pl_editor'],
    ['editors/gerbview/GerberViewer.tsx', 'gerbview'],
    ['editors/footprint/FootprintEditor.tsx', 'fpedit'],
    ['editors/pcb/Viewer3DFrame.tsx', '3d_viewer'],
  ];

  for (const [file, app] of FRAMES) {
    it(`${app} asks useToolbarEntries`, () => {
      expect(src(file)).toContain(`useToolbarEntries('${app}'`);
    });
  }

  /**
   * EVERY bar, not merely one.
   *
   * `expect(src).toContain("useToolbarEntries('fpedit'")` passes on a frame
   * where two of three toolbars ask the store and the third still reads the
   * module constant — which is exactly what a mutation of the Footprint
   * Editor's TOP_MAIN line proved. `RecreateToolbars` has four identical
   * blocks, one per location, and a frame that wires three of them has the bug
   * in the fourth.
   *
   * So: take every `entries={…}` the file hands a `<Toolbar>` and require that
   * name to have been bound by `useToolbarEntries`.
   */
  for (const [file, app] of FRAMES) {
    it(`${app}: every <Toolbar> takes entries the store answered for`, () => {
      const text = src(file);
      const bound = new Set(
        [...text.matchAll(/const\s+(\w+)\s*=\s*useToolbarEntries\(/g)].map((m) => m[1]),
      );
      const used = [...text.matchAll(/<Toolbar\s[\s\S]{0,200}?entries=\{([^}]+)\}/g)].map((m) =>
        (m[1] ?? '').trim(),
      );
      expect(used.length, `${file} draws no toolbar`).toBeGreaterThan(0);
      expect(used.filter((name) => !bound.has(name))).toEqual([]);
    });
  }
});

describe('the two new default configs are the ones upstream declares', () => {
  /**
   * `FOOTPRINT_EDIT_TOOLBAR_SETTINGS::DefaultToolbarConfig`
   * (`pcbnew/toolbars_footprint_editor.cpp:47-49`):
   *
   *     // No Aux toolbar
   *     case TOOLBAR_LOC::TOP_AUX:
   *         return std::nullopt;
   */
  it('the Footprint Editor has three toolbars and no aux row', () => {
    expect(Object.keys(FP_DEFAULT_TOOLBARS).sort()).toEqual(['LEFT', 'RIGHT', 'TOP_MAIN']);
  });

  /**
   * `EDA_3D_VIEWER_TOOLBAR_SETTINGS::DefaultToolbarConfig`
   * (`3d-viewer/3d_viewer/toolbars_3d.cpp:48-51`): LEFT, RIGHT and TOP_AUX are
   * all `std::nullopt`.
   */
  it('the 3D Viewer has one', () => {
    expect(Object.keys(VIEWER3D_DEFAULT_TOOLBARS)).toEqual(['TOP_MAIN']);
  });

  it('and a location a frame does not have resolves to nothing', () => {
    // `GetToolbarConfig` returns `std::nullopt` and `RecreateToolbars`' `if(
    // tbConfig.has_value() )` skips the bar entirely.
    expect(toolbarEntries('3d_viewer', 'LEFT', VIEWER3D_DEFAULT_TOOLBARS)).toEqual([]);
    expect(toolbarEntries('fpedit', 'TOP_AUX', FP_DEFAULT_TOOLBARS)).toEqual([]);
  });
});

describe('the tree carries the two headings pcbnew’s KIFACE adds', () => {
  /*
   * `common/eda_base_frame.cpp:1657-1697` — three headings from one KIFACE, in
   * this order, each with Toolbars among its rows.
   */
  const labels = PAGES.map((p) => p.label);
  const idx = (label: string): number => labels.indexOf(label);

  it('lists Footprint Editor, PCB Editor and 3D Viewer, in that order', () => {
    expect(idx('Footprint Editor')).toBeGreaterThan(-1);
    expect(idx('3D Viewer')).toBeGreaterThan(-1);
    expect(idx('Footprint Editor')).toBeLessThan(idx('PCB Editor'));
    expect(idx('PCB Editor')).toBeLessThan(idx('3D Viewer'));
    // …and the 3D Viewer still comes before gerbview's heading, which is a
    // different KIFACE and is consulted next.
    expect(idx('3D Viewer')).toBeLessThan(idx('Gerber Viewer'));
  });

  it('gives each a Toolbars row that an owner answers for', () => {
    for (const id of ['fp-toolbars', '3dv-toolbars']) {
      const row = PAGES.find((p) => p.id === id);
      expect(row, id).toBeTruthy();
      expect(row?.label).toBe('Toolbars');
      expect(row?.indent).toBe(true);
      expect(row?.owner, id).toBeTruthy();
    }
  });

  /**
   * The Footprint Editor is its own bundle here, so its page is its own owner
   * for the reason the Symbol Editor's is: routing it through the board
   * editor's factory would pull `editors/pcb` into the dialog for a
   * footprint-editor user.
   */
  it('keeps the footprint page out of the board editor’s bundle', () => {
    expect(PAGES.find((p) => p.id === 'fp-toolbars')?.owner).toBe('footprint');
    expect(PAGES.find((p) => p.id === '3dv-toolbars')?.owner).toBe('pcb');
  });
});

describe('a customised toolbar reaches the frame, which is the whole point', () => {
  /*
   * The claim the page makes. `resolveToolbarConfig` falls back to the module
   * defaults while the store is empty, so nothing below is visible until a
   * toolbar is actually customised — which is why a page can be wired to a file
   * nobody reads and still look correct.
   */
  /**
   * One item taken from that app's OWN defaults, so the stored config names a
   * tool `entriesFromConfig` can resolve — it looks every `TOOL` up in
   * `toolbarTemplates( defaults )` and silently drops one the app does not have,
   * which is `TOOLBAR_CONFIGURATION`'s own behaviour for an action the frame
   * never registered.
   */
  const firstToolOf = (defaults: ToolbarDefaults): ToolbarItemJson => {
    // `toolbarTemplates` keys on the button's `id`, which is what a stored
    // `TOOL` item names.
    const entry = (defaults.TOP_MAIN ?? []).find(
      (e): e is { id: string } => typeof e === 'object' && 'id' in e,
    );
    if (!entry) throw new Error('the defaults name no tool');
    return { type: 'TOOL', name: entry.id };
  };

  for (const [app, defaults] of [
    ['fpedit', FP_DEFAULT_TOOLBARS],
    ['3d_viewer', VIEWER3D_DEFAULT_TOOLBARS],
  ] as const) {
    it(`${app}: the stored config replaces the default once custom is on`, () => {
      const setCustom = (on: boolean): void => {
        if (app === 'fpedit')
          settings.updateFpEdit((s) => {
            s.appearance.custom_toolbars = on;
          });
        else
          settings.updateViewer3d((s) => {
            s.appearance.custom_toolbars = on;
          });
      };

      settings.updateToolbars(app, (s) => {
        setStoredToolbarConfig(s, 'TOP_MAIN', [firstToolOf(defaults)]);
      });

      // `GetToolbarConfig( loc, aAllowCustom )` hands back the DEFAULT while the
      // app's `m_CustomToolbars` is off, whatever is stored.
      expect(toolbarEntries(app, 'TOP_MAIN', defaults).length).toBeGreaterThan(1);

      setCustom(true);
      expect(toolbarEntries(app, 'TOP_MAIN', defaults)).toHaveLength(1);

      // Put it back, so the order of these tests cannot matter.
      setCustom(false);
      settings.updateToolbars(app, (s) => {
        setStoredToolbarConfig(s, 'TOP_MAIN', []);
      });
    });
  }
});
