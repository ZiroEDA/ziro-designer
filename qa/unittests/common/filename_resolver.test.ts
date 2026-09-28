// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FILENAME_RESOLVER` (common/filename_resolver.cpp) over the page's mount
 * table, set up as KiCad's 3D cache does: the environment from
 * `InitializeEnvironment`, the project at an absolute directory, the stock
 * library at `/usr/share/kicad/3dmodels`. Every expectation is read off the
 * C++'s order of attempts (`ResolvePath` :246-510) - not off our output.
 */
import { EMBEDDED_FILE, EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { type COMMON_SETTINGS_LIKE, PGM_BASE } from '@ziroeda/common/pgm_base.js';
import { InitializeEnvironment } from '@ziroeda/common/settings/common_settings.js';
import { ENV_VAR_MAP } from '@ziroeda/common/settings/environment.js';
import {
  MEMORY_FILESYSTEM,
  wxMountFileSystem,
  wxReadFileSync,
  wxSetWorkingDirectory,
} from '@ziroeda/common/wx/filefn.js';
import { wxUnsetEnv } from '@ziroeda/common/wx/utils.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIB = '/usr/share/kicad/3dmodels';
const PRJ = '/Proj';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

let pgm: PGM_BASE;
const unmounts: (() => void)[] = [];

beforeAll(() => {
  const env = { vars: new ENV_VAR_MAP() };
  pgm = new PGM_BASE({ m_Env: env } as unknown as COMMON_SETTINGS_LIKE);
  InitializeEnvironment(env);
  pgm.loadCommonSettings();

  const lib = new MEMORY_FILESYSTEM();
  lib.Write('Resistor_SMD.3dshapes/R_0402_1005Metric.wrl', bytes('lib'));
  lib.Write('Connector.3dshapes/Jack.wrl', bytes('lib jack'));
  unmounts.push(wxMountFileSystem(LIB, lib));

  const prj = new MEMORY_FILESYSTEM();
  prj.Write('board.kicad_pro', bytes('{}'));
  prj.Write('models/part.step', bytes('prj step'));
  // Same relative name as a library model: the project must win.
  prj.Write('Connector.3dshapes/Jack.wrl', bytes('prj jack'));
  unmounts.push(wxMountFileSystem(PRJ, prj));

  pgm.GetSettingsManager().LoadProject(`${PRJ}/board.kicad_pro`);
});

afterAll(() => {
  for (const u of unmounts) u();
  wxSetWorkingDirectory('/');
  for (const n of [...new ENV_VAR_MAP().keys(), 'KIPRJMOD']) wxUnsetEnv(n);
  for (const n of [
    'KICAD10_FOOTPRINT_DIR',
    'KICAD10_3DMODEL_DIR',
    'KICAD10_TEMPLATE_DIR',
    'KICAD_USER_TEMPLATE_DIR',
    'KICAD10_3RD_PARTY',
    'KICAD10_SYMBOL_DIR',
    'KICAD10_DESIGN_BLOCK_DIR',
  ])
    wxUnsetEnv(n);
});

/** `PROJECT::Get3DCacheManager`'s set-up. */
const resolver = (): FILENAME_RESOLVER => {
  const r = new FILENAME_RESOLVER();
  r.Set3DConfigDir('/tmp');
  r.SetProgramBase(pgm);
  r.SetProject(pgm.GetSettingsManager().Prj());
  return r;
};

const resolve = (path: string): string => resolver().ResolvePath(path, '', []);

describe('FILENAME_RESOLVER::ResolvePath', () => {
  it('the project directory is the absolute one LoadProject was given', () => {
    expect(resolver().GetProjectDir()).toBe(PRJ);
  });

  it('${KICAD10_3DMODEL_DIR} expands to the install path', () => {
    expect(resolve('${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl')).toBe(
      `${LIB}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl`,
    );
  });

  it('an older version, and the legacy KISYS3DMOD, map to this version (KIwxExpandEnvVars)', () => {
    const want = `${LIB}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl`;
    expect(resolve('${KICAD8_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl')).toBe(want);
    expect(resolve('${KISYS3DMOD}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl')).toBe(want);
  });

  it('${KIPRJMOD} is the project; a miss fails, with no library fallback', () => {
    expect(resolve('${KIPRJMOD}/models/part.step')).toBe(`${PRJ}/models/part.step`);
    expect(resolve('${KIPRJMOD}/models/missing.step')).toBe('');
  });

  it('a bare relative name tries the project first, then the 3D model dir', () => {
    // Relative to the working directory (the project, since LoadProject) wins first.
    expect(resolve('Connector.3dshapes/Jack.wrl')).toBe(`${PRJ}/Connector.3dshapes/Jack.wrl`);
    // Not in the project: the legacy ${KICAD7_3DMODEL_DIR}-relative step.
    expect(resolve('Resistor_SMD.3dshapes/R_0402_1005Metric.wrl')).toBe(
      `${LIB}/Resistor_SMD.3dshapes/R_0402_1005Metric.wrl`,
    );
  });

  it('the project directory is tried even when the working directory is elsewhere', () => {
    // kicad-cli does not chdir into the project: the first FileExists (relative
    // to the cwd) misses, and the explicit project-directory step still finds it
    // before the library - the order that lets a project override a model.
    wxSetWorkingDirectory('/tmp');
    try {
      expect(resolve('Connector.3dshapes/Jack.wrl')).toBe(`${PRJ}/Connector.3dshapes/Jack.wrl`);
    } finally {
      wxSetWorkingDirectory(PRJ);
    }
  });

  it('an undefined ${VAR} fails', () => {
    expect(resolve('${MY_MODELS}/foo.wrl')).toBe('');
  });

  it('an absolute path from another machine fails, as it does in KiCad', () => {
    // No basename or `.3dshapes/` rescue: upstream checks FileExists and stops.
    expect(resolve('C:\\work\\proj\\models\\part.step')).toBe('');
    expect(resolve('/Users/pico/KiCad/Connector.3dshapes/Jack.wrl')).toBe('');
  });

  it(':alias: resolves through a user alias, and only through one', () => {
    const r = resolver();
    expect(r.ResolvePath(':myalias:part.step', '', [])).toBe('');
    r.UpdatePathList([
      { m_Alias: 'myalias', m_Pathvar: `${PRJ}/models`, m_Pathexp: '', m_Description: '' },
    ]);
    expect(r.ResolvePath(':myalias:part.step', '', [])).toBe(`${PRJ}/models/part.step`);
    // The same alias written the old ${} way (resolved against user aliases).
    expect(r.ResolvePath('${myalias}/part.step', '', [])).toBe(`${PRJ}/models/part.step`);
  });

  it('kicad-embed:// is written to the temp directory, named by its hash', () => {
    const files = new EMBEDDED_FILES();
    const f = new EMBEDDED_FILE();
    f.name = 'model.step';
    f.decompressedData = bytes('embedded step');
    f.data_hash = 'abc123';
    files.AddFile(f);

    expect(resolver().ResolvePath('kicad-embed://model.step', '', [])).toBe('');
    const path = resolver().ResolvePath('kicad-embed://model.step', '', [files]);
    expect(path).toBe('/tmp/kicad_embedded_abc123.step');
    expect(new TextDecoder().decode(wxReadFileSync(path)!)).toBe('embedded step');
  });
});

describe('FILENAME_RESOLVER::ShortenPath', () => {
  it('writes a path under a search path back with its variable', () => {
    const r = resolver();
    expect(r.ShortenPath(`${PRJ}/models/part.step`)).toBe('${KIPRJMOD}/models/part.step');
    expect(r.ShortenPath(`${LIB}/Connector.3dshapes/Jack.wrl`)).toBe(
      '${KICAD10_3DMODEL_DIR}/Connector.3dshapes/Jack.wrl',
    );
    expect(r.ShortenPath('/elsewhere/x.wrl')).toBe('/elsewhere/x.wrl');
  });
});

describe('FILENAME_RESOLVER::GetKicadPaths', () => {
  it('lists the local variables in key order, minus footprint dirs, templates and URLs', () => {
    const paths: string[] = [];
    expect(resolver().GetKicadPaths(paths)).toBe(true);
    expect(paths).toEqual([
      'KICAD10_3DMODEL_DIR',
      'KICAD10_3RD_PARTY',
      'KICAD10_DESIGN_BLOCK_DIR',
      'KICAD10_SYMBOL_DIR',
      'KICAD10_TEMPLATE_DIR',
      'KICAD_USER_TEMPLATE_DIR',
    ]);
    expect(new FILENAME_RESOLVER().GetKicadPaths(paths)).toBe(false);
  });
});

describe('FILENAME_RESOLVER::SplitAlias / ValidateFileName', () => {
  it('splits ALIAS:path, with or without the leading colon', () => {
    const r = new FILENAME_RESOLVER();
    expect(r.SplitAlias(':lib:a/b.wrl')).toEqual({ alias: 'lib', relpath: 'a/b.wrl' });
    expect(r.SplitAlias('lib:a.wrl')).toEqual({ alias: 'lib', relpath: 'a.wrl' });
    expect(r.SplitAlias('::a.wrl')).toBeNull();
    expect(r.SplitAlias('lib:')).toBeNull();
    expect(r.SplitAlias('plain/a.wrl')).toBeNull();
  });

  it('validates names by the four rules', () => {
    const r = new FILENAME_RESOLVER();
    const has = { value: false };
    expect(r.ValidateFileName('lib:a.wrl', has)).toBe(true);
    expect(has.value).toBe(true);
    expect(r.ValidateFileName('${KIPRJMOD}/a.wrl', has)).toBe(true);
    expect(has.value).toBe(false);
    expect(r.ValidateFileName('a.b:x.wrl', has)).toBe(false); // '.' in the alias
    expect(r.ValidateFileName('lib:', has)).toBe(false); // ends with ':'
    expect(r.ValidateFileName('kicad-embed://m.step', has)).toBe(true);
    expect(r.ValidateFileName('kicad-embed:///m.step', has)).toBe(false);
    expect(r.ValidateFileName('', has)).toBe(false);
  });
});
