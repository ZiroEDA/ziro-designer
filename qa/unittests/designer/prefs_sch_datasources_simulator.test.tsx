// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two Schematic Editor pages this port did not have: Data Sources
 * (`PANEL_SCH_DATA_SOURCES`) and Simulator (`PANEL_SIMULATOR_PREFERENCES`),
 * both built by eeschema's `CreateWindow` (`eeschema/eeschema.cpp:367-381`).
 *
 * They are opposites, and that is the point of testing them together. Data
 * Sources holds no settings at all — it reads the Plugin and Content Manager —
 * so every control on it is LIVE. Simulator is nothing but settings, and we
 * ship no simulator, so every control on it is greyed. Neither was deleted the
 * way the browser-irrelevant groups were: one works, the other is drawn and
 * dead, which is the rule this dialog is built on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PanelSchDataSources } from '@ziroeda/designer/src/editors/schematic/prefs/PanelSchDataSources.js';
import {
  HORIZONTAL_ACTIONS,
  MOUSE_DEFAULTS,
  TRACKPAD_DEFAULTS,
  VERTICAL_ACTIONS,
} from '@ziroeda/designer/src/editors/schematic/prefs/PanelSimulatorPreferences.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import { OMITTED_PAGES, PAGES } from '@ziroeda/designer/src/dialogs/prefs/registry.js';
import { pcm } from '@ziroeda/designer/src/pcm/pcmStore.js';
import type { RepoPackage } from '@ziroeda/designer/src/pcm/types.js';

afterEach(cleanup);

describe('the two pages are in the book, and no longer declared absent', () => {
  it('shows Data Sources and Simulator under Schematic Editor, after Field Name Templates', () => {
    const ids = PAGES.map((p) => p.id);
    expect(ids).toContain('sch-datasources');
    expect(ids).toContain('sch-simulator');
    // `ShowPreferences`' own add order for eeschema.
    expect(ids.indexOf('sch-datasources')).toBeGreaterThan(ids.indexOf('sch-fields'));
    expect(ids.indexOf('sch-simulator')).toBeGreaterThan(ids.indexOf('sch-datasources'));
  });

  it('leaves the Schematic Editor with nothing omitted', () => {
    expect(OMITTED_PAGES['Schematic Editor']).toEqual([]);
  });
});

/**
 * `SIM_MOUSE_WHEEL_ACTION` and the two choice lists
 * (`panel_simulator_preferences.cpp:39-66`).
 */
describe('the Simulator page’s two choice lists are not the same list', () => {
  it('offers all seven actions vertically, in enum order', () => {
    expect(VERTICAL_ACTIONS).toEqual([
      'No action',
      'Pan left/right',
      'Pan right/left',
      'Pan up/down',
      'Zoom',
      'Zoom horizontally',
      'Zoom vertically',
    ]);
  });

  it('offers three horizontally, and their values are NOT their positions', () => {
    // `horizontalScrollSelectionToAction` maps 0/1/2 to NONE, PAN_LEFT_RIGHT
    // and ZOOM_HORIZONTALLY (`:127-150`) — and ZOOM_HORIZONTALLY is ordinal 5,
    // not 2. Storing the choice's index here would write PAN_RIGHT_LEFT.
    expect(HORIZONTAL_ACTIONS.map(([v]) => v)).toEqual([0, 1, 5]);
    expect(HORIZONTAL_ACTIONS.map(([, l]) => l)).toEqual([
      'No action',
      'Pan left/right',
      'Zoom horizontally',
    ]);
  });
});

describe('the Simulator page’s two default sets', () => {
  it('is GetMouseDefaults: zoom, pan L/R, pan U/D, none, none', () => {
    // `SIM_MOUSE_WHEEL_ACTION_SET::GetMouseDefaults()` (`sim_preferences.h:65-76`).
    expect(MOUSE_DEFAULTS).toEqual({
      vertical_unmodified: 4,
      vertical_with_ctrl: 1,
      vertical_with_shift: 3,
      vertical_with_alt: 0,
      horizontal: 0,
    });
  });

  it('is GetTrackpadDefaults, which differs on four of the five', () => {
    // `:78-89`. A trackpad pans where a mouse zooms.
    expect(TRACKPAD_DEFAULTS).toEqual({
      vertical_unmodified: 3,
      vertical_with_ctrl: 4,
      vertical_with_shift: 1,
      vertical_with_alt: 0,
      horizontal: 1,
    });
    expect(TRACKPAD_DEFAULTS).not.toEqual(MOUSE_DEFAULTS);
  });

  it('seeds the settings from the PARAMs, which agree with the mouse set', () => {
    // `eeschema_settings.cpp:587-609`. They agree today; the panel still
    // resets through `GetMouseDefaults()`, because that is what ResetPanel
    // calls and the two are separate answers.
    expect(EESCHEMA_DEFAULTS.simulator.mouse_wheel_actions).toEqual(MOUSE_DEFAULTS);
  });
});

/** `PANEL_SCH_DATA_SOURCES::populateInstalledSources` (`:96-138`). */
describe('Data Sources lists what the PCM has installed', () => {
  const pkg = (id: string, name: string, kind: RepoPackage['kind']): RepoPackage => ({
    id,
    kind,
    name,
    description: '',
    author: { name: 'a' },
    license: 'MIT',
    // `preparePackage` marks a version compatible; `latestVersion` then takes
    // the first compatible non-deprecated one, and the store records THAT as
    // `currentVersion`. A fixture that skips it installs version "0".
    versions: [{ version: '1.2.0', status: 'stable', kicadVersion: '9.0', compatible: true }],
  });

  const installed: string[] = [];
  const install = (id: string, name: string, kind: RepoPackage['kind'], repo: string): void => {
    pcm.install(pkg(id, name, kind), repo);
    installed.push(id);
  };

  beforeEach(() => {
    for (const id of [...installed]) pcm.uninstall(id);
    installed.length = 0;
  });

  afterEach(() => {
    for (const id of [...installed]) pcm.uninstall(id);
    installed.length = 0;
  });

  it('says so, in upstream’s words, when there are none', () => {
    render(<PanelSchDataSources />);
    // `_( "No data sources are currently installed." )` (`:122`).
    expect(screen.getByText('No data sources are currently installed.')).toBeTruthy();
    expect(document.querySelectorAll('.ze-datasources-row')).toHaveLength(0);
  });

  it('labels a row "name (version) — repository", and sorts case-insensitively', () => {
    install('org.z', 'Zeta parts', 'datasource', 'Ziro');
    install('org.a', 'alpha parts', 'datasource', 'Ziro');
    render(<PanelSchDataSources />);
    expect(
      Array.from(document.querySelectorAll('.ze-datasources-row')).map((r) => r.textContent),
    ).toEqual(['alpha parts (1.2.0) — Ziro', 'Zeta parts (1.2.0) — Ziro']);
    // `_( "Installed data sources are listed above." )` (`:136`).
    expect(screen.getByText('Installed data sources are listed above.')).toBeTruthy();
  });

  it('shows only the data sources, not every installed package', () => {
    // `if( type != PT_DATASOURCE ) continue;`
    install('org.ds', 'A source', 'datasource', 'Ziro');
    install('org.lib', 'A library', 'library', 'Ziro');
    install('org.plug', 'A plugin', 'plugin', 'Ziro');
    render(<PanelSchDataSources />);
    const rows = Array.from(document.querySelectorAll('.ze-datasources-row')).map(
      (r) => r.textContent ?? '',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('A source');
  });

  it('opens the manager on the Data Sources tab, not on its default one', () => {
    // `dialog.SetActivePackageType( PT_DATASOURCE ); dialog.ShowModal();` (`:148-150`).
    render(<PanelSchDataSources />);
    fireEvent.click(screen.getByText('Manage Data Sources...'));
    const active = document.querySelector('.ze-pcm-tabs .active, .ze-tabbar .active');
    expect(active?.textContent).toBe('Data Sources');
  });
});
