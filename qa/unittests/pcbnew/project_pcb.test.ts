// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROJECT_PCB::Get3DFilenameResolver` (pcbnew/project_pcb.cpp:93-96): builds
 * a `FILENAME_RESOLVER` the way `Get3DCacheManager` sets one up the first
 * time it creates the cache - `Set3DConfigDir`, `SetProgramBase( &Pgm() )`,
 * `SetProject( aProject )`.
 */
import { PROJECT_PCB } from '@ziroeda/pcbnew/project_pcb.js';
import { PGM_BASE, PgmOrNull, SetPgm } from '@ziroeda/common/pgm_base.js';
import { InitializeEnvironment } from '@ziroeda/common/settings/common_settings.js';
import { ENV_VAR_MAP } from '@ziroeda/common/settings/environment.js';
import {
  MEMORY_FILESYSTEM,
  wxMountFileSystem,
  wxSetWorkingDirectory,
} from '@ziroeda/common/wx/filefn.js';
import { wxUnsetEnv } from '@ziroeda/common/wx/utils.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import { afterAll, describe, expect, it } from 'vitest';

const PRJ = '/PPProj';
const unmounts: (() => void)[] = [];

afterAll(() => {
  for (const u of unmounts) u();
  unmounts.length = 0;
  wxSetWorkingDirectory('/');
  SetPgm(null);
  for (const n of [...new ENV_VAR_MAP().keys(), 'KIPRJMOD']) wxUnsetEnv(n);
});

describe('PROJECT_PCB.Get3DFilenameResolver', () => {
  it('has an empty project dir and no program base when nothing is set up', () => {
    SetPgm(null);
    const resolver = PROJECT_PCB.Get3DFilenameResolver();
    expect(resolver.GetProjectDir()).toBe('');
  });

  it('wires the temp dir as the 3D config dir (Set3DConfigDir)', () => {
    SetPgm(null);
    const resolver = PROJECT_PCB.Get3DFilenameResolver();
    // Set3DConfigDir only succeeds (and only then does GetPaths() list model
    // search paths at all) when the config dir it was given actually exists;
    // '/tmp' is auto-mounted (common/wx/filefn.ts's s_tempFileSystem).
    expect(resolver.GetPaths().length).toBeGreaterThan(0);
  });

  it("wires the loaded project as the resolver's project (SetProject)", () => {
    const env = { vars: new ENV_VAR_MAP() };
    const pgm = new PGM_BASE({ m_Env: env } as unknown as COMMON_SETTINGS_LIKE);
    InitializeEnvironment(env);
    pgm.loadCommonSettings();

    const prj = new MEMORY_FILESYSTEM();
    prj.Write('board.kicad_pro', new TextEncoder().encode('{}'));
    unmounts.push(wxMountFileSystem(PRJ, prj));

    pgm.GetSettingsManager().LoadProject(`${PRJ}/board.kicad_pro`);
    SetPgm(pgm);

    const resolver = PROJECT_PCB.Get3DFilenameResolver();
    expect(resolver.GetProjectDir()).toBe(PRJ);
  });

  it('reads PgmOrNull(), not a stashed reference: a later SetPgm is picked up', () => {
    SetPgm(null);
    expect(PROJECT_PCB.Get3DFilenameResolver().GetProjectDir()).toBe('');

    const env = { vars: new ENV_VAR_MAP() };
    const pgm = new PGM_BASE({ m_Env: env } as unknown as COMMON_SETTINGS_LIKE);
    InitializeEnvironment(env);
    pgm.loadCommonSettings();
    pgm.GetSettingsManager().LoadProject(`${PRJ}/board.kicad_pro`);
    SetPgm(pgm);

    expect(PgmOrNull()).toBe(pgm);
    expect(PROJECT_PCB.Get3DFilenameResolver().GetProjectDir()).toBe(PRJ);
  });
});
