// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PATHS` (common/paths.cpp), the Linux build's branches, over a page with no
 * home: the documents folder is `/.local/share`, the config one `/.config`.
 * Each expectation is the C++ walked with the installed build's CMake values.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PATHS } from '@ziroeda/common/paths.js';
import { wxSetEnv, wxUnsetEnv } from '@ziroeda/common/wx/utils.js';

afterEach(() => {
  for (const v of ['KICAD_STOCK_DATA_HOME', 'KICAD_CONFIG_HOME', 'APPDIR']) wxUnsetEnv(v);
});

describe('PATHS', () => {
  it('puts the user folders under <documents>/kicad/10.0, with no separator', () => {
    expect(PATHS.GetDefaultUserSymbolsPath()).toBe('/.local/share/kicad/10.0/symbols');
    expect(PATHS.GetDefaultUserFootprintsPath()).toBe('/.local/share/kicad/10.0/footprints');
    expect(PATHS.GetDefaultUser3DModelsPath()).toBe('/.local/share/kicad/10.0/3dmodels');
    expect(PATHS.GetDefaultUserProjectsPath()).toBe('/.local/share/kicad/10.0/projects');
    expect(PATHS.GetDefaultUserDesignBlocksPath()).toBe('/.local/share/kicad/10.0/blocks');
    expect(PATHS.GetUserPluginsPath()).toBe('/.local/share/kicad/10.0/plugins');
    expect(PATHS.GetUserScriptingPath()).toBe('/.local/share/kicad/10.0/scripting');
    expect(PATHS.GetLogsPath()).toBe('/.local/share/kicad/10.0/logs');
  });

  it('reads the stock data from the install, or KICAD_STOCK_DATA_HOME', () => {
    expect(PATHS.GetStockDataPath()).toBe('/usr/share/kicad');
    expect(PATHS.GetStockDemosPath()).toBe('/usr/share/kicad/demos/');
    expect(PATHS.GetStockScriptingPath()).toBe('/usr/share/kicad/scripting/');
    expect(PATHS.GetLocaleDataPath()).toBe('/usr/share/kicad/internat/');
    expect(PATHS.GetStockPluginsPath()).toBe('/usr/share/kicad/plugins/');
    expect(PATHS.GetDocumentationPath()).toBe('/usr/share/doc/kicad');
    wxSetEnv('KICAD_STOCK_DATA_HOME', '/opt/kd');
    expect(PATHS.GetStockDataPath()).toBe('/opt/kd');
  });

  it('finds the 3D plugins in the install, or inside an AppImage', () => {
    expect(PATHS.GetStockPlugins3DPath()).toBe('/usr/lib/x86_64-linux-gnu/kicad/plugins/3d/');
    wxSetEnv('APPDIR', '/tmp/.mount_k');
    expect(PATHS.GetStockPlugins3DPath()).toBe(
      '/tmp/.mount_k/usr/lib/x86_64-linux-gnu/kicad/plugins/3d/',
    );
    expect(PATHS.GetExecutablePath()).toBe('/tmp/.mount_k/usr/bin/');
    wxUnsetEnv('APPDIR');
    expect(PATHS.GetExecutablePath()).toBe('/usr/bin/');
  });

  it('keeps settings in <config>/kicad/10.0, or KICAD_CONFIG_HOME', () => {
    expect(PATHS.CalculateUserSettingsPath()).toBe('/.config/kicad/10.0');
    expect(PATHS.CalculateUserSettingsPath(false)).toBe('/.config/kicad');
    wxSetEnv('KICAD_CONFIG_HOME', '/cfg');
    expect(PATHS.CalculateUserSettingsPath()).toBe('/cfg/10.0');
    expect(PATHS.CalculateUserSettingsPath(true, false)).toBe('/.config/kicad/10.0');
  });

  it('puts the instance checker in the temp folder', () => {
    expect(PATHS.GetInstanceCheckerPath()).toBe('/tmp/org.kicad.kicad/instances/');
  });
});
