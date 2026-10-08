// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_FRAME::saveSchematicFile / SaveProject (files-io.cpp:991, :1155) and
 * SCH_EDITOR_CONTROL's Save, Save As, Save Current Sheet Copy As and Revert, onto a mounted
 * project folder.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;

const unmounts: (() => void)[] = [];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  SetPgm(null);
  for (const u of unmounts.splice(0)) u();
});

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

function mount(aAt: string) {
  const fs = new MEMORY_FILESYSTEM();
  unmounts.push(wxMountFileSystem(aAt, fs));
  return {
    text: (aRel: string) => {
      const b = fs.Read(aRel);
      return b ? new TextDecoder().decode(b) : null;
    },
    list: () => (fs.List('') ?? []).map((e) => e.name).sort(),
  };
}

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  return { ...h, mgr: h.frame.GetToolManager()! };
}

/** A visible edit on the current sheet: a text far from everything. */
function edit(h: ReturnType<typeof setUp>, aText = 'ZQX edit') {
  const t = new SCH_TEXT({ x: FAR, y: FAR }, aText);
  h.frame.AddToScreen(t, h.frame.GetScreen());
  h.frame.OnModify();
  return t;
}

describe('saving the schematic', () => {
  it('Save writes every sheet and the project file into the project folder', async () => {
    const disk = mount('/complex_hierarchy');
    const h = setUp();
    edit(h);

    h.mgr.RunAction(ACTIONS.save);
    await flush();

    expect(disk.list()).toEqual([
      'ampli_ht.kicad_sch',
      'complex_hierarchy.kicad_prl',
      'complex_hierarchy.kicad_pro',
      'complex_hierarchy.kicad_sch',
    ]);
    expect(disk.text('complex_hierarchy.kicad_sch')).toContain('ZQX edit');
    expect(disk.text('complex_hierarchy.kicad_sch')).toMatch(/^\(kicad_sch/);
    expect(h.frame.GetScreen()!.IsContentModified()).toBe(false);
  });

  it('an unmodified schematic is not written again', async () => {
    const disk = mount('/complex_hierarchy');
    const h = setUp();
    for (const sheet of h.frame.Schematic().Hierarchy())
      sheet.LastScreen()!.SetContentModified(false);

    h.mgr.RunAction(ACTIONS.save);
    await flush();

    // The file did not exist in the mount, so this one save does happen; then nothing more.
    const first = disk.list();
    h.mgr.RunAction(ACTIONS.save);
    await flush();
    expect(disk.list()).toEqual(first);
  });

  it('a folder no writable mount covers is an error, and the sheet stays modified', async () => {
    const errors: string[] = [];
    const h = setUp({ displayError: (m) => errors.push(m) });
    edit(h);

    h.mgr.RunAction(ACTIONS.save);
    await flush();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/^Error saving schematic file '\/complex_hierarchy\//);
    expect(h.frame.GetScreen()!.IsContentModified()).toBe(true);
  });

  it('Save As (under the project manager, a copy) writes the copy and leaves the project as it was', async () => {
    mount('/complex_hierarchy');
    const copy = mount('/copy');
    const h = setUp({ fileDialog: () => '/copy/newname' });
    edit(h);
    const rootBefore = h.frame.Schematic().RootScreen()!.GetFileName();

    h.mgr.RunAction(ACTIONS.saveAs);
    await flush();

    expect(copy.text('newname.kicad_sch')).toContain('ZQX edit');
    expect(h.frame.Schematic().RootScreen()!.GetFileName()).toBe(rootBefore);
    expect(h.frame.Prj().GetProjectFullName()).toBe(
      '/complex_hierarchy/complex_hierarchy.kicad_pro',
    );
  });

  it('a cancelled Save As writes nothing', async () => {
    const copy = mount('/copy');
    const h = setUp({ fileDialog: () => null });
    edit(h);

    h.mgr.RunAction(ACTIONS.saveAs);
    await flush();

    expect(copy.list()).toEqual([]);
  });

  it('Save Current Sheet Copy As writes only that sheet, and the editor keeps the original', async () => {
    const copy = mount('/copy');
    const h = setUp({ fileDialog: () => '/copy/sheet' });
    edit(h);
    const before = h.frame.GetScreen()!.GetFileName();

    h.mgr.RunAction(SCH_ACTIONS.saveCurrSheetCopyAs);
    await flush();

    expect(copy.list()).toEqual(['sheet.kicad_sch']);
    expect(copy.text('sheet.kicad_sch')).toContain('ZQX edit');
    expect(h.frame.GetScreen()!.GetFileName()).toBe(before);
  });

  it('Revert reloads the saved files, dropping the unsaved edit', async () => {
    mount('/complex_hierarchy');
    const h = setUp({ isOK: () => true });
    edit(h, 'ZQX saved');
    h.mgr.RunAction(ACTIONS.save);
    await flush();

    edit(h, 'ZQX unsaved');
    h.mgr.RunAction(ACTIONS.revert);
    await flush();

    const texts = [...h.frame.GetScreen()!.Items()]
      .filter((i) => i instanceof SCH_TEXT)
      .map((i) => (i as SCH_TEXT).GetText());
    expect(texts).toContain('ZQX saved');
    expect(texts).not.toContain('ZQX unsaved');
  });

  it('Revert answered No keeps the edit', async () => {
    mount('/complex_hierarchy');
    const h = setUp({ isOK: () => false });
    const t = edit(h, 'ZQX kept');

    h.mgr.RunAction(ACTIONS.revert);
    await flush();

    expect([...h.frame.GetScreen()!.Items()].includes(t)).toBe(true);
  });
});
