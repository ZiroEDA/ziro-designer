// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** PROJECT and the project half of SETTINGS_MANAGER. */
import { describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import { LIB_TYPE_T, PROJECT, PROJECT_ELEM, RSTRING_T } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';

describe('PROJECT', () => {
  it('splits its full name the way wxFileName does', () => {
    const p = new PROJECT();
    p.setProjectFullName('/home/u/boards/amp/amp.kicad_pro');
    expect(p.GetProjectFullName()).toBe('/home/u/boards/amp/amp.kicad_pro');
    expect(p.GetProjectPath()).toBe('/home/u/boards/amp/');
    expect(p.GetProjectDirectory()).toBe('/home/u/boards/amp');
    expect(p.GetProjectName()).toBe('amp');
    expect(p.IsNullProject()).toBe(false);
    expect(p.FootprintLibTblName()).toBe('/home/u/boards/amp/fp-lib-table');
    expect(p.SymbolLibTableName()).toBe('/home/u/boards/amp/sym-lib-table');
    expect(p.AbsolutePath('rules.kicad_dru')).toBe('/home/u/boards/amp/rules.kicad_dru');
    expect(p.AbsolutePath('/abs/x')).toBe('/abs/x');
    expect(p.AbsolutePath('${KIPRJMOD}/x')).toBe('${KIPRJMOD}/x');
  });

  it('a board or schematic path becomes the project file path', () => {
    const p = new PROJECT();
    p.setProjectFullName('/a/b.kicad_pcb');
    expect(p.GetProjectFullName()).toBe('/a/b.kicad_pro');
  });

  it('the null project is read-only and has an empty name', () => {
    const p = new PROJECT();
    expect(p.IsNullProject()).toBe(true);
    expect(p.IsReadOnly()).toBe(true);
    p.setProjectFullName('/a/b.kicad_pro');
    expect(p.IsReadOnly()).toBe(false);
    p.SetReadOnly();
    expect(p.IsReadOnly()).toBe(true);
  });

  it('changing the project name clears the elems and the retained strings', () => {
    const p = new PROJECT();
    p.setProjectFullName('/a/b.kicad_pro');
    const elem = { ProjectElementType: () => PROJECT_ELEM.BOARD };
    p.SetElem(PROJECT_ELEM.BOARD, elem);
    p.SetRString(RSTRING_T.PCB_LIB_NICKNAME, 'Lib');
    expect(p.GetElem(PROJECT_ELEM.BOARD)).toBe(elem);
    expect(p.GetRString(RSTRING_T.PCB_LIB_NICKNAME)).toBe('Lib');

    p.setProjectFullName('/a/b.kicad_pro'); // same name: nothing moves
    expect(p.GetElem(PROJECT_ELEM.BOARD)).toBe(elem);

    p.setProjectFullName('/a/c.kicad_pro');
    expect(p.GetElem(PROJECT_ELEM.BOARD)).toBeNull();
    expect(p.GetRString(RSTRING_T.PCB_LIB_NICKNAME)).toBe('');
  });

  it('resolves its own tokens, then the file text variables', () => {
    const p = new PROJECT();
    p.setProjectFullName('/a/amp.kicad_pro');
    const t = { value: 'PROJECTNAME' };
    expect(p.TextVarResolver(t)).toBe(false); // no file yet

    const f = new PROJECT_FILE('amp');
    f.LoadFromJson({ text_variables: { REV: 'B' } });
    p.setProjectFile(f);
    expect(f.GetOwningProject()).toBe(p);

    expect(p.TextVarResolver(t)).toBe(true);
    expect(t.value).toBe('amp');
    const r = { value: 'REV' };
    expect(p.TextVarResolver(r)).toBe(true);
    expect(r.value).toBe('B');
    const d = { value: 'CURRENT_DATE' };
    expect(p.TextVarResolver(d)).toBe(true);
    expect(d.value).not.toBe('CURRENT_DATE');
    const h = { value: 'VCSHASH' };
    expect(p.TextVarResolver(h)).toBe(true);
    expect(h.value).toBe('no hash');
    expect(p.TextVarResolver({ value: 'NOPE' })).toBe(false);

    p.ApplyTextVars(
      new Map([
        ['REV', 'C'],
        ['NEW', '1'],
      ]),
    );
    expect([...p.GetTextVars()]).toEqual([
      ['REV', 'C'],
      ['NEW', '1'],
    ]);
  });

  it('GetSheetName reads the file sheet list once; an unknown id is itself', () => {
    const p = new PROJECT();
    const f = new PROJECT_FILE('x');
    f.LoadFromJson({
      sheets: [
        ['1111', 'Root'],
        ['2222', 'Power'],
      ],
    });
    p.setProjectFile(f);
    expect(p.GetSheetName('2222')).toBe('Power');
    expect(p.GetSheetName('3333')).toBe('3333');
  });

  it('pins and unpins libraries in the project file', () => {
    const p = new PROJECT();
    const f = new PROJECT_FILE('x');
    p.setProjectFile(f);
    p.PinLibrary('Device', LIB_TYPE_T.SYMBOL_LIB);
    p.PinLibrary('Device', LIB_TYPE_T.SYMBOL_LIB);
    p.PinLibrary('Resistor_SMD', LIB_TYPE_T.FOOTPRINT_LIB);
    expect(f.m_PinnedSymbolLibs).toEqual(['Device']);
    expect(f.m_PinnedFootprintLibs).toEqual(['Resistor_SMD']);
    p.UnpinLibrary('Device', LIB_TYPE_T.SYMBOL_LIB);
    expect(f.m_PinnedSymbolLibs).toEqual([]);
  });
});

describe('SETTINGS_MANAGER projects', () => {
  it('LoadProject makes the project active with its file and local settings', () => {
    const m = new SETTINGS_MANAGER();
    expect(m.IsProjectOpen()).toBe(false);
    expect(m.Prj().IsNullProject()).toBe(true);

    expect(m.LoadProject('/a/amp.kicad_pcb', { text_variables: { K: 'v' } })).toBe(true);
    expect(m.IsProjectOpen()).toBe(true);
    expect(m.IsProjectOpenNotDummy()).toBe(true);
    expect(m.Prj().GetProjectFullName()).toBe('/a/amp.kicad_pro');
    expect(m.Prj().GetProjectFile().m_TextVars.get('K')).toBe('v');
    expect(m.Prj().GetLocalSettings().m_ActiveLayer).toBe(0);
    expect(m.GetProject('/a/amp.kicad_pro')).toBe(m.Prj());
    expect(m.GetOpenProjects()).toEqual(['/a/amp.kicad_pro']);

    // a missing file loads the defaults and says so
    expect(m.LoadProject('/a/amp.kicad_pro')).toBe(true); // already loaded
    expect(m.LoadProject('/b/other.kicad_pro')).toBe(false);
    // no MDI: the old one is gone
    expect(m.GetProject('/a/amp.kicad_pro')).toBeNull();
    expect(m.Prj().GetProjectName()).toBe('other');
  });

  it('UnloadProject drops it and falls back to the null project', () => {
    const m = new SETTINGS_MANAGER();
    m.LoadProject('/a/amp.kicad_pro');
    const p = m.Prj();
    expect(m.UnloadProject(p)).toBe(true);
    expect(m.UnloadProject(p)).toBe(false);
    expect(m.Prj().IsNullProject()).toBe(true);
    expect(m.IsProjectOpen()).toBe(true);
    expect(m.IsProjectOpenNotDummy()).toBe(false);
  });

  it('SaveProject hands back both trees, the project file named after the project', () => {
    const m = new SETTINGS_MANAGER();
    m.LoadProject(
      '/a/amp.kicad_pro',
      { text_variables: { K: 'v' } },
      { board: { active_layer: 2 } },
    );
    const out = m.SaveProject()!;
    expect((out.pro.meta as { filename: string }).filename).toBe('amp.kicad_pro');
    expect(out.pro.text_variables).toEqual({ K: 'v' });
    expect((out.prl.board as { active_layer: number }).active_layer).toBe(2);
    expect(m.SaveProject(new PROJECT())).toBeNull();
  });

  it('PGM_BASE starts with the null project loaded, so Prj() always works', () => {
    const pgm = new PGM_BASE();
    expect(pgm.GetSettingsManager().IsProjectOpen()).toBe(true);
    expect(pgm.GetSettingsManager().Prj().IsNullProject()).toBe(true);
    expect(pgm.GetSettingsManager().Prj().GetProjectFile()).toBeInstanceOf(PROJECT_FILE);
  });
});
