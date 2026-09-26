// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KiCad's environment variables end to end: `ENV_VAR_ITEM` / `ENV_VAR_MAP`
 * (settings/environment.h), `COMMON_SETTINGS::InitializeEnvironment`
 * (common_settings.cpp:840), `PGM_BASE::loadCommonSettings` /
 * `SetLocalEnvVariable` (pgm_base.cpp:537, :770) and the KIPRJMOD that
 * `SETTINGS_MANAGER::LoadProject` / `UnloadProject` set and clear
 * (settings_manager.cpp:1053, :1161). Expected paths are the Linux build's
 * `PATHS` getters: `KICAD_LIBRARY_DATA` plus the subdirectory, with the
 * trailing separator `GetPathWithSep` gives.
 */
import { PGM_BASE, type COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import {
  type COMMON_SETTINGS_ENVIRONMENT,
  InitializeEnvironment,
} from '@ziroeda/common/settings/common_settings.js';
import { ENV_VAR_ITEM, ENV_VAR_MAP } from '@ziroeda/common/settings/environment.js';
import { SetEnvVarLookup, wxGetEnv, wxSetEnv, wxUnsetEnv } from '@ziroeda/common/wx/utils.js';
import { afterEach, describe, expect, it } from 'vitest';

const NAMES = [
  'KICAD10_FOOTPRINT_DIR',
  'KICAD10_3DMODEL_DIR',
  'KICAD10_TEMPLATE_DIR',
  'KICAD_USER_TEMPLATE_DIR',
  'KICAD10_3RD_PARTY',
  'KICAD10_SYMBOL_DIR',
  'KICAD10_DESIGN_BLOCK_DIR',
  'KIPRJMOD',
  'MY_LIBS',
];

afterEach(() => {
  SetEnvVarLookup(() => undefined);
  for (const n of NAMES) wxUnsetEnv(n);
});

const pgmWith = (env: COMMON_SETTINGS_ENVIRONMENT): PGM_BASE =>
  new PGM_BASE({ m_Env: env } as unknown as COMMON_SETTINGS_LIKE);

describe('ENV_VAR_MAP', () => {
  it('walks in key order, as a std::map does', () => {
    const m = new ENV_VAR_MAP();
    m.set('b', new ENV_VAR_ITEM('b', '2'));
    m.set('a', new ENV_VAR_ITEM('a', '1'));
    m.set('B', new ENV_VAR_ITEM('B', '0'));
    expect([...m.keys()]).toEqual(['B', 'a', 'b']);
    expect([...m].map(([k]) => k)).toEqual(['B', 'a', 'b']);
  });
});

describe('COMMON_SETTINGS::InitializeEnvironment', () => {
  it('gives the seven built-ins their stock defaults', () => {
    const env = { vars: new ENV_VAR_MAP() };
    InitializeEnvironment(env);

    expect([...env.vars.keys()]).toEqual([
      'KICAD10_3DMODEL_DIR',
      'KICAD10_3RD_PARTY',
      'KICAD10_DESIGN_BLOCK_DIR',
      'KICAD10_FOOTPRINT_DIR',
      'KICAD10_SYMBOL_DIR',
      'KICAD10_TEMPLATE_DIR',
      'KICAD_USER_TEMPLATE_DIR',
    ]);
    const model = env.vars.get('KICAD10_3DMODEL_DIR')!;
    expect(model.GetValue()).toBe('/usr/share/kicad/3dmodels/');
    expect(model.GetDefault()).toBe('/usr/share/kicad/3dmodels/');
    expect(model.IsDefault()).toBe(true);
    expect(model.GetDefinedExternally()).toBe(false);
    expect(env.vars.get('KICAD10_SYMBOL_DIR')!.GetValue()).toBe('/usr/share/kicad/symbols/');
    expect(env.vars.get('KICAD10_DESIGN_BLOCK_DIR')!.GetValue()).toBe('/usr/share/kicad/blocks/');
    // <documents>/kicad/10.0/template/; with no home, GLib's documents are /.local/share.
    expect(env.vars.get('KICAD_USER_TEMPLATE_DIR')!.GetValue()).toBe(
      '/.local/share/kicad/10.0/template/',
    );
  });

  it('lets the process environment override one, and says so', () => {
    SetEnvVarLookup((n) => (n === 'KICAD10_3DMODEL_DIR' ? '/opt/models' : undefined));
    const env = { vars: new ENV_VAR_MAP() };
    InitializeEnvironment(env);

    const model = env.vars.get('KICAD10_3DMODEL_DIR')!;
    expect(model.GetValue()).toBe('/opt/models');
    expect(model.GetDefault()).toBe('/usr/share/kicad/3dmodels/');
    expect(model.GetDefinedExternally()).toBe(true);
    expect(model.IsDefault()).toBe(false);
  });
});

describe('PGM_BASE environment', () => {
  it('loadCommonSettings puts the variables into the environment', () => {
    const env = { vars: new ENV_VAR_MAP() };
    InitializeEnvironment(env);
    pgmWith(env).loadCommonSettings();
    expect(wxGetEnv('KICAD10_3DMODEL_DIR')).toBe('/usr/share/kicad/3dmodels/');
  });

  it('skips KIPRJMOD, an empty name, and one the system defined', () => {
    const env = { vars: new ENV_VAR_MAP() };
    env.vars.set('KIPRJMOD', new ENV_VAR_ITEM('KIPRJMOD', '/from/settings'));
    const ext = new ENV_VAR_ITEM('MY_LIBS', '/external');
    ext.SetDefinedExternally();
    env.vars.set('MY_LIBS', ext);
    pgmWith(env).loadCommonSettings();
    // The empty project PGM_BASE starts with set it to "" (LoadProject( "" ));
    // the settings' value never lands.
    expect(wxGetEnv('KIPRJMOD')).toBe('');
    expect(wxGetEnv('MY_LIBS')).toBeUndefined();
  });

  it('SetLocalEnvVariable never overwrites; it reports whether the value agrees', () => {
    const pgm = pgmWith({ vars: new ENV_VAR_MAP() });
    expect(pgm.SetLocalEnvVariable('MY_LIBS', '/a')).toBe(true);
    expect(pgm.SetLocalEnvVariable('MY_LIBS', '/b')).toBe(false);
    expect(wxGetEnv('MY_LIBS')).toBe('/a');
    expect(pgm.SetLocalEnvVariable('', '/x')).toBe(false);
  });

  it('SetLocalEnvVariables does overwrite', () => {
    wxSetEnv('MY_LIBS', '/old');
    const env = { vars: new ENV_VAR_MAP([['MY_LIBS', new ENV_VAR_ITEM('MY_LIBS', '/new')]]) };
    pgmWith(env).SetLocalEnvVariables();
    expect(wxGetEnv('MY_LIBS')).toBe('/new');
  });

  it('the active project sets KIPRJMOD to its directory, and unloading clears it', () => {
    const pgm = pgmWith({ vars: new ENV_VAR_MAP() });
    const mgr = pgm.GetSettingsManager();
    expect(mgr.LoadProject('/work/board/board.kicad_pro')).toBeDefined();
    expect(wxGetEnv('KIPRJMOD')).toBe('/work/board');
    mgr.UnloadProject(mgr.Prj());
    expect(wxGetEnv('KIPRJMOD')).toBe('');
  });

  it('unloading the active project clears KIPRJMOD even while another stays loaded', () => {
    // No empty project is reloaded here (the list is not empty), so only the
    // explicit wxSetEnv( PROJECT_VAR_NAME, "" ) clears it.
    const mgr = pgmWith({ vars: new ENV_VAR_MAP() }).GetSettingsManager();
    mgr.LoadProject('/work/a/a.kicad_pro');
    mgr.LoadProject('/work/b/b.kicad_pro', null, null, false);
    expect(wxGetEnv('KIPRJMOD')).toBe('/work/a');
    mgr.UnloadProject(mgr.Prj());
    expect(wxGetEnv('KIPRJMOD')).toBe('');
  });
});

describe('PROJECT::GetProjectPath', () => {
  it('is the directory with its separator, and "" for a bare name (GetPathWithSep)', () => {
    const mgr = pgmWith({ vars: new ENV_VAR_MAP() }).GetSettingsManager();
    expect(mgr.Prj().GetProjectPath()).toBe(''); // the empty project PGM_BASE starts with
    mgr.LoadProject('board.kicad_pro');
    expect(mgr.Prj().GetProjectPath()).toBe('');
    mgr.LoadProject('/work/board/board.kicad_pro');
    expect(mgr.Prj().GetProjectPath()).toBe('/work/board/');
    mgr.LoadProject('/top.kicad_pro');
    expect(mgr.Prj().GetProjectPath()).toBe('/');
  });
});
