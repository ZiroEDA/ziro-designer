// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * JSON_SETTINGS::SaveToFile (json_settings.cpp:422) and SETTINGS_MANAGER::SaveProject,
 * SaveProjectAs and SaveProjectCopy (settings_manager.cpp:1234-1323), onto a mounted project
 * folder.
 */
import { SETTINGS_MANAGER } from '@ziroeda/common/settings/settings_manager.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { afterEach, describe, expect, it } from 'vitest';

const unmounts: (() => void)[] = [];
afterEach(() => {
  for (const u of unmounts.splice(0)) u();
});

/** A writable folder that counts its writes. */
function mount(aAt: string) {
  const fs = new MEMORY_FILESYSTEM();
  let writes = 0;
  const write = fs.Write.bind(fs);
  fs.Write = (aRel, aData) => {
    writes++;
    write(aRel, aData);
  };
  unmounts.push(wxMountFileSystem(aAt, fs));
  return {
    text: (aRel: string) => {
      const b = fs.Read(aRel);
      return b ? new TextDecoder().decode(b) : null;
    },
    writes: () => writes,
  };
}

describe('saving a project to its folder', () => {
  it('SaveProject writes the .kicad_pro and .kicad_prl, and does not rewrite unchanged files', () => {
    const disk = mount('/proj');
    const mgr = new SETTINGS_MANAGER();
    mgr.LoadProject('/proj/p.kicad_pro', {}, {});

    mgr.SaveProject();

    const pro = JSON.parse(disk.text('p.kicad_pro')!);
    expect(pro.meta.filename).toBe('p.kicad_pro');
    expect(disk.text('p.kicad_prl')).not.toBeNull();
    expect(disk.text('p.kicad_pro')!.endsWith('\n')).toBe(true);

    const writes = disk.writes();
    mgr.SaveProject();
    expect(disk.writes()).toBe(writes);
  });

  it('a read-only project is not written', () => {
    const disk = mount('/proj');
    const mgr = new SETTINGS_MANAGER();
    mgr.LoadProject('/proj/p.kicad_pro', {}, {});
    mgr.Prj().SetReadOnly(true);

    mgr.SaveProject();

    expect(disk.text('p.kicad_pro')).toBeNull();
  });

  it('a folder no writable mount covers is not written, and nothing throws', () => {
    const mgr = new SETTINGS_MANAGER();
    mgr.LoadProject('/elsewhere/p.kicad_pro', {}, {});

    expect(() => mgr.SaveProject()).not.toThrow();
  });

  it('SaveProjectAs renames the project and writes it under the new name', () => {
    const disk = mount('/proj');
    const mgr = new SETTINGS_MANAGER();
    mgr.LoadProject('/proj/p.kicad_pro', {}, {});

    mgr.SaveProjectAs('/proj/q.kicad_pro');

    expect(mgr.Prj().GetProjectFullName()).toBe('/proj/q.kicad_pro');
    expect(mgr.GetProject('/proj/q.kicad_pro')).toBe(mgr.Prj());
    expect(mgr.GetProject('/proj/p.kicad_pro')).toBeNull();
    expect(JSON.parse(disk.text('q.kicad_pro')!).meta.filename).toBe('q.kicad_pro');
    expect(disk.text('q.kicad_prl')).not.toBeNull();
  });

  it('SaveProjectCopy writes a copy and keeps the project as it was', () => {
    const disk = mount('/proj');
    const mgr = new SETTINGS_MANAGER();
    mgr.LoadProject('/proj/p.kicad_pro', {}, {});
    mgr.Prj().GetProjectFile().SetReadOnly(true);

    mgr.SaveProjectCopy('/proj/copy.kicad_pro');

    expect(disk.text('copy.kicad_pro')).not.toBeNull();
    expect(disk.text('copy.kicad_prl')).not.toBeNull();
    expect(mgr.Prj().GetProjectFullName()).toBe('/proj/p.kicad_pro');
    expect(mgr.Prj().GetProjectFile().GetFilename()).toBe('p');
    expect(mgr.Prj().GetProjectFile().IsReadOnly()).toBe(true);
  });
});
