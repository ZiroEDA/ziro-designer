// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DRAWING_TOOLS::ImportSheet (sch_drawing_tools.cpp:729) on the live model: another
 * schematic's contents placed under the cursor through the move tool, or a click that starts
 * drawing the sheet that will hold it.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_GROUP } from '@ziroeda/eeschema/sch_group.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import type { FILEDLG_IMPORT_SHEET_CONTENTS } from '@ziroeda/eeschema/widgets/sch_design_block_pane.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

let unmount: () => void = () => {};

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  const fs = new MEMORY_FILESYSTEM();
  fs.Write('piece.kicad_sch', new Uint8Array(readFileSync(join(ORACLE, 'ampli_ht.kicad_sch'))));
  unmount = wxMountFileSystem('/complex_hierarchy', fs);
});
afterEach(() => {
  unmount();
  SetPgm(null);
});

const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

function setUp(
  aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {},
  aOptions: Partial<FILEDLG_IMPORT_SHEET_CONTENTS> = {},
) {
  const h = schToolHarness(schFrame({ showModal: () => wxID_OK, ...aHooks }));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  // KiCad always has COMMON_SETTINGS; ImportSheet returns without them. immediate_actions defaults
  // to true (common_settings.cpp).
  Pgm().SetCommonSettings({ m_Input: { immediate_actions: true } } as never);
  const chooser = h.frame.config()!.m_DesignBlockChooserPanel;
  chooser.place_as_sheet = aOptions.place_as_sheet ?? false;
  chooser.place_as_group = aOptions.place_as_group ?? false;
  chooser.repeated_placement = aOptions.repeated_placement ?? false;
  chooser.keep_annotations = aOptions.keep_annotations ?? false;
  const symbols = () =>
    [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[];
  return { ...h, mgr: h.frame.GetToolManager()!, symbols };
}

describe('ImportSheet', () => {
  it("places the file's contents under the cursor, and a click commits them as one undo step", async () => {
    const h = setUp();
    const before = new Set(h.symbols());
    const undo = h.frame.GetUndoCommandCount();
    h.h.mouse = P(10, 10);

    h.mgr.RunAction(SCH_ACTIONS.importSheet, '/complex_hierarchy/piece.kicad_sch');
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(20, 20));
    click(h, P(20, 20));
    await flush();

    const added = h.symbols().filter((s) => !before.has(s));
    expect(added.length).toBeGreaterThan(5);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);

    // Automatic annotation gave them references not already used in the root sheet.
    const path = h.frame.GetCurrentSheet();
    const oldRefs = new Set([...before].map((s) => s.GetRef(path)));
    const newRefs = added.filter((s) => !s.GetLibSymbolRef()?.IsPower()).map((s) => s.GetRef(path));
    expect(newRefs.every((r) => !r.endsWith('?') && !oldRefs.has(r))).toBe(true);
  });

  it('Escape during the move takes the imported contents back out', async () => {
    const h = setUp();
    const count = h.symbols().length;

    h.mgr.RunAction(SCH_ACTIONS.importSheet, '/complex_hierarchy/piece.kicad_sch');
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(5, 5));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    await flush();

    expect(h.symbols().length).toBe(count);
  });

  it('as a group, the contents land in one group named after the file', async () => {
    const h = setUp({}, { place_as_group: true });

    h.mgr.RunAction(SCH_ACTIONS.importSheet, '/complex_hierarchy/piece.kicad_sch');
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(20, 20));
    click(h, P(20, 20));
    await flush();

    const groups = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_GROUP_T)] as SCH_GROUP[];
    expect(groups.map((g) => g.GetName())).toEqual(['piece']);
    expect(groups[0]!.GetItems().size).toBeGreaterThan(5);
  });

  it('with no file given it asks for one; the dialog check boxes become the placement settings', async () => {
    let asked = false;
    const h = setUp({
      fileDialog: (aTitle, _aDir, _aFile, _aWildcard, _aStyle, aHook) => {
        asked = aTitle === 'Choose Schematic';
        const hook = aHook as FILEDLG_IMPORT_SHEET_CONTENTS;
        hook.attached = true;
        hook.keep_annotations = true;
        return '/complex_hierarchy/piece.kicad_sch';
      },
    });

    h.mgr.RunAction(SCH_ACTIONS.importSheet);
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(20, 20));
    click(h, P(20, 20));
    await flush();

    expect(asked).toBe(true);
    expect(h.frame.config()!.m_DesignBlockChooserPanel.keep_annotations).toBe(true);
  });

  it('as a sheet, a click hands the file to the sheet drawing tool', async () => {
    const h = setUp({}, { place_as_sheet: true });
    let posted: unknown = null;
    const post = h.mgr.PostAction.bind(h.mgr);
    h.mgr.PostAction = ((aAction: unknown, aParam?: unknown) => {
      if (aAction === SCH_ACTIONS.drawSheetFromFile) posted = aParam;
      return post(aAction as never, aParam as never);
    }) as typeof h.mgr.PostAction;

    h.mgr.RunAction(SCH_ACTIONS.importSheet, '/complex_hierarchy/piece.kicad_sch');
    await flush();
    click(h, P(3, 3));
    await flush();

    expect(posted).toBe('/complex_hierarchy/piece.kicad_sch');
  });
});
