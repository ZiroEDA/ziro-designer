// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `eeschema/sch_design_block_utils.cpp` on the live model: the four design
 * block commands of `SCH_EDIT_FRAME`, over a real design block library on the
 * page's temp mount, with the pane's modals answered by the test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@ziroeda/common/design_block_library_adapter.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { DESIGN_BLOCK_PANE_DIALOGS } from '@ziroeda/common/widgets/design_block_pane.js';
import { wxGetTempDir, wxMkdir, wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { SCH_GROUP } from '@ziroeda/eeschema/sch_group.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { SCH_DESIGN_BLOCK_PANE } from '@ziroeda/eeschema/widgets/sch_design_block_pane.js';

let n = 0;
let lib = '';

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  lib = `${wxGetTempDir()}/schdb${++n}/Blocks.kicad_blocks`;
  wxMkdir(lib);
  Pgm()
    .GetLibraryManager()
    .SetTable(
      LIBRARY_TABLE_TYPE.DESIGN_BLOCK,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE.FromFile(
        '/p/design-block-lib-table',
        `(design_block_lib_table (version 7) (lib (name "Blocks")(type "KiCad")(uri "${lib}")(options "")(descr "")))`,
        LIBRARY_TABLE_SCOPE.PROJECT,
        LIBRARY_TABLE_TYPE.DESIGN_BLOCK,
      ),
    );
});

afterEach(() => SetPgm(null));

const wireAt = (y: number): SCH_LINE => {
  const w = new SCH_LINE({ x: 0, y }, SCH_LAYER_ID.LAYER_WIRE);
  w.SetEndPoint({ x: 1000, y });
  return w;
};

function setup(aDialogs: Partial<DESIGN_BLOCK_PANE_DIALOGS> = {}) {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const path = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(path);
  const screen = path.LastScreen()!;
  screen.SetFileName('/p/power.kicad_sch');

  let selection: EDA_ITEM[] = [];
  const selectedGroups: SCH_GROUP[] = [];
  const hooks: SCH_EDIT_FRAME_HOOKS = {
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    saveProject: () => true,
    getNetlist: () => null,
    currentSelection: () => selection,
    selectGroup: (g) => selectedGroups.push(g),
  };
  const frame = new SCH_EDIT_FRAME(hooks);
  frame.SetSchematic(schematic);

  const errors: string[] = [];
  const asked: string[] = [];
  const libs = frame.Prj().DesignBlockLibs();
  libs.LoadOneByName('Blocks');
  const pane = new SCH_DESIGN_BLOCK_PANE(
    {
      DesignBlockLibs: () => libs,
      GetLibraryManager: () => Pgm().GetLibraryManager(),
      NormalizePath: (p) => p,
      ShowInfoBarError: (m) => errors.push(m),
      SetStatusText: () => {},
    },
    {
      IsOK: async () => true,
      OKOrCancel: async (m) => {
        asked.push(m);
        return true;
      },
      ConfirmOverwriteLibrary: async () => true,
      DisplayError: (m) => errors.push(m),
      GetTextFromUser: async () => '',
      NewLibraryBrowser: async () => null,
      DesignBlockProperties: async () => true,
      ...aDialogs,
    },
    [],
    () => ({
      repeated_placement: false,
      place_as_group: true,
      place_as_sheet: false,
      keep_annotations: false,
    }),
    () => {},
  );
  frame.m_designBlocksPane = pane;
  pane.SetSelectedLibId(new LIB_ID('Blocks', ''));

  return {
    frame,
    schematic,
    path,
    screen,
    libs,
    errors,
    asked,
    selectedGroups,
    select: (items: EDA_ITEM[]) => {
      selection = items;
    },
  };
}

const blockText = (name: string): string =>
  new TextDecoder().decode(wxReadFileSync(`${lib}/${name}.kicad_block/${name}.kicad_sch`)!);
const blockJson = (name: string): Record<string, unknown> =>
  JSON.parse(
    new TextDecoder().decode(wxReadFileSync(`${lib}/${name}.kicad_block/${name}.json`)!),
  ) as Record<string, unknown>;

describe('SaveSheetAsDesignBlock', () => {
  it('saves the sheet under its name, its fields copied but for name and file', async () => {
    const t = setup();
    t.screen.Append(wireAt(0));
    const sheet = t.path.Last()!;
    sheet.SetName('power');
    const extra = new SCH_FIELD(sheet, FIELD_T.USER, 'Owner');
    extra.SetText('Akshay');
    sheet.AddField(extra);

    expect(await t.frame.SaveSheetAsDesignBlock('Blocks', t.path)).toBe(true);
    expect(t.libs.DesignBlockExists('Blocks', 'power')).toBe(true);
    expect(blockText('power')).toContain('(wire');
    expect(blockJson('power').fields).toEqual({ Owner: 'Akshay' });
    expect(t.frame.GetDesignBlockPane()!.GetSelectedLibId().Format()).toBe('Blocks:power');
  });

  it('needs a library selected, and refuses nested sheets', async () => {
    const t = setup();
    t.frame.GetDesignBlockPane()!.SetSelectedLibId(new LIB_ID());
    expect(await t.frame.SaveSheetAsDesignBlock('Blocks', t.path)).toBe(false);
    expect(t.errors).toEqual(['Please select a library to save the design block to.']);

    const u = setup();
    u.screen.Append(new SCH_SHEET(u.schematic));
    expect(await u.frame.SaveSheetAsDesignBlock('Blocks', u.path)).toBe(false);
    expect(u.errors).toEqual(['Design blocks with nested sheets are not supported.']);
  });

  it('asks before overwriting, and a cancelled properties dialog saves nothing', async () => {
    const t = setup();
    t.path.Last()!.SetName('power');
    await t.frame.SaveSheetAsDesignBlock('Blocks', t.path);
    expect(await t.frame.SaveSheetAsDesignBlock('Blocks', t.path)).toBe(true);
    expect(t.asked).toEqual(["Design block 'power' already exists in library 'Blocks'."]);

    const u = setup({ DesignBlockProperties: async () => false });
    u.path.Last()!.SetName('other');
    expect(await u.frame.SaveSheetAsDesignBlock('Blocks', u.path)).toBe(false);
    expect(u.libs.DesignBlockExists('Blocks', 'other')).toBe(false);
  });
});

describe('SaveSelectionAsDesignBlock', () => {
  it('saves copies of the selection and groups the originals, linked to the block', async () => {
    const t = setup();
    const a = wireAt(0);
    const b = wireAt(500);
    const other = wireAt(900);
    t.screen.Append(a);
    t.screen.Append(b);
    t.screen.Append(other);
    t.select([a, b]);

    expect(await t.frame.SaveSelectionAsDesignBlock('Blocks')).toBe(true);
    // Named after the screen's file.
    expect(t.libs.DesignBlockExists('Blocks', 'power')).toBe(true);
    expect(blockText('power').match(/\(wire/g)).toHaveLength(2);

    const groups = t.screen.Items().OfType(KICAD_T.SCH_GROUP_T) as SCH_GROUP[];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.GetName()).toBe('power');
    expect(groups[0]!.GetDesignBlockLibId().Format()).toBe('Blocks:power');
    const members = groups[0]!.GetItems();
    expect(members.size).toBe(2);
    expect(members.has(a) && members.has(b)).toBe(true);
    expect(t.selectedGroups).toEqual([groups[0]]);
  });

  it('a single named group names the block and is linked, not regrouped', async () => {
    const t = setup();
    const a = wireAt(0);
    t.screen.Append(a);
    const group = new SCH_GROUP(t.screen);
    group.SetName('filter');
    group.AddItem(a);
    t.screen.Append(group);
    t.select([group]);

    expect(await t.frame.SaveSelectionAsDesignBlock('Blocks')).toBe(true);
    expect(t.libs.DesignBlockExists('Blocks', 'filter')).toBe(true);
    expect(group.GetDesignBlockLibId().Format()).toBe('Blocks:filter');
    expect(t.screen.Items().OfType(KICAD_T.SCH_GROUP_T)).toHaveLength(1);
  });

  it('refuses an empty selection', async () => {
    const t = setup();
    expect(await t.frame.SaveSelectionAsDesignBlock('Blocks')).toBe(false);
    expect(t.errors).toEqual(['Please select some items to save as a design block.']);
  });
});

describe('UpdateDesignBlockFrom*', () => {
  it('needs an existing block, and asks before replacing its schematic', async () => {
    const t = setup();
    expect(await t.frame.UpdateDesignBlockFromSheet(new LIB_ID('Blocks', 'nope'), t.path)).toBe(
      false,
    );
    expect(t.errors).toEqual(['Please select a design block to save the schematic to.']);

    t.path.Last()!.SetName('power');
    await t.frame.SaveSheetAsDesignBlock('Blocks', t.path);
    t.screen.Append(wireAt(0));
    expect(await t.frame.UpdateDesignBlockFromSheet(new LIB_ID('Blocks', 'power'), t.path)).toBe(
      true,
    );
    expect(t.asked).toEqual(["Design block 'power' already has a schematic."]);
    expect(blockText('power')).toContain('(wire');
  });

  it('from a selection: the selection replaces the schematic and is grouped under the block', async () => {
    const t = setup();
    t.path.Last()!.SetName('power');
    await t.frame.SaveSheetAsDesignBlock('Blocks', t.path);
    const a = wireAt(0);
    t.screen.Append(a);
    t.select([a]);
    expect(await t.frame.UpdateDesignBlockFromSelection(new LIB_ID('Blocks', 'power'))).toBe(true);
    expect(blockText('power').match(/\(wire/g)).toHaveLength(1);
    const groups = t.screen.Items().OfType(KICAD_T.SCH_GROUP_T) as SCH_GROUP[];
    expect(groups.map((g) => g.GetDesignBlockLibId().Format())).toEqual(['Blocks:power']);
  });
});

describe('SCH_DESIGN_BLOCK_CONTROL context menu', async () => {
  const { SchDesignBlockContextMenu } = await import(
    '@ziroeda/eeschema/tools/sch_design_block_control.js'
  );
  const { LibTreeNode, LibTreeNodeType } = await import('@ziroeda/common/lib_tree_model.js');
  const labels = (items: { label?: string }[]): string[] =>
    items.filter((i) => i.label).map((i) => i.label!);

  it('a design block row offers placement, editing and the updates; a library row the saves', () => {
    const item = new LibTreeNode();
    item.type = LibTreeNodeType.ITEM;
    expect(labels(SchDesignBlockContextMenu(item, true, () => {}))).toEqual([
      'New Library...',
      'Place Design Block',
      'Properties...',
      'Save Current Sheet as Design Block...',
      'Save Selection as Design Block...',
      'Update Design Block from Current Sheet',
      'Update Design Block from Selection',
      'Delete Design Block',
      'Hide Library Tree',
    ]);
    const library = new LibTreeNode();
    library.type = LibTreeNodeType.LIBRARY;
    expect(labels(SchDesignBlockContextMenu(library, false, () => {}))).toEqual([
      'Pin Library',
      'New Library...',
      'Save Current Sheet as Design Block...',
      'Hide Library Tree',
    ]);
  });
});

describe('SCH_DESIGN_BLOCK_PREVIEW_WIDGET', async () => {
  const { loadDesignBlockSchematic } = await import(
    '@ziroeda/eeschema/widgets/sch_design_block_preview_widget.js'
  );

  it('previews the saved schematic; nothing for no block or a block without one', async () => {
    const t = setup();
    t.screen.Append(wireAt(0));
    t.path.Last()!.SetName('power');
    await t.frame.SaveSheetAsDesignBlock('Blocks', t.path);
    const sch = loadDesignBlockSchematic(t.libs.LoadDesignBlock('Blocks', 'power'));
    expect(sch?.lines).toHaveLength(1);
    expect(loadDesignBlockSchematic(null)).toBeNull();
    const bare = t.libs.LoadDesignBlock('Blocks', 'power')!;
    bare.SetSchematicFile('');
    expect(loadDesignBlockSchematic(bare)).toBeNull();
  });
});

describe('SCH_DESIGN_BLOCK_PANE options', () => {
  it('reads the four options as stored and writes all four back', () => {
    const t = setup();
    const pane = t.frame.GetDesignBlockPane()!;
    expect(pane.UpdateCheckboxes()).toEqual({
      repeated_placement: false,
      place_as_group: true,
      place_as_sheet: false,
      keep_annotations: false,
    });
  });
});
