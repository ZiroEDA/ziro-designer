// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `pcbnew/pcb_design_block_utils.cpp` on the live BOARD: the four design block
 * commands of `PCB_EDIT_FRAME`, over a real design block library on the page's
 * temp mount, with the pane's modals answered by the test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@ziroeda/common/design_block_library_adapter.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { DESIGN_BLOCK_PANE_DIALOGS } from '@ziroeda/common/widgets/design_block_pane.js';
import { wxGetTempDir, wxMkdir, wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_GROUP } from '@ziroeda/pcbnew/pcb_group.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import {
  designBlockItemBBox,
  fitDesignBlockView,
  loadDesignBlockBoard,
} from '@ziroeda/pcbnew/widgets/pcb_design_block_preview_widget.js';
import { PCB_DESIGN_BLOCK_PANE } from '@ziroeda/pcbnew/widgets/pcb_design_block_pane.js';

let seq = 0;
const U = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;
let n = 0;
let lib = '';

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  lib = `${wxGetTempDir()}/pcbdb${++n}/Blocks.kicad_blocks`;
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

const track = (x: number, net: number, name: string): string =>
  `(segment (start ${x} 0) (end ${x + 5} 0) (width 0.25) (layer "F.Cu") (net "${name}") (uuid "${U()}"))`;

const footprint = (): string =>
  `(footprint "L:R" (layer "F.Cu") (uuid "${U()}") (at 20 0)
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS") (uuid "${U()}")
      (effects (font (size 1.27 1.27) (thickness 0.15))))
    (property "Value" "v" (at 0 2 0) (layer "F.Fab") (uuid "${U()}")
      (effects (font (size 1.27 1.27) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste") (net "VCC") (uuid "${U()}")))`;

const board = (): BOARD => {
  const b = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (7 "F.Fab" user))
  (setup)
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  ${track(0, 1, 'GND')}
  ${track(10, 1, 'GND')}
  ${track(30, 2, 'VCC')}
  ${footprint()}
)`);
  b.SetFileName('/p/power.kicad_pcb');
  return b;
};

function setup(aDialogs: Partial<DESIGN_BLOCK_PANE_DIALOGS> = {}) {
  const hooks: PCB_EDIT_FRAME_HOOKS = {
    settings: () => new PCBNEW_SETTINGS(),
    onModify: () => {},
    onUndoRedoIncomplete: () => {},
    createDrcDialog: () => {
      throw new Error('no DRC dialog here');
    },
    isSingle: () => true,
    fetchNetlistFromSchematic: () => false,
    schematicNetlistText: () => null,
    projectText: () => null,
    onEditItemRequest: () => {},
    showExchangeFootprintsDialog: () => {},
    findDialogRects: () => [],
    setViewCenter: () => {},
    editZoneParams: () => {},
    selectCopperLayerPair: () => {},
    updatePcbFromSchematic: () => {},
  };
  const frame = new PCB_EDIT_FRAME(hooks);
  const b = board();
  frame.SetBoard(b, false);
  frame.SetScreen(new PCB_SCREEN({ x: 297000000, y: 210000000 }));

  const errors: string[] = [];
  const asked: string[] = [];
  const written: unknown[] = [];
  const libs = frame.Prj().DesignBlockLibs();
  libs.LoadOneByName('Blocks');
  const pane = new PCB_DESIGN_BLOCK_PANE(
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
    () => ({ repeated_placement: false, place_as_group: true, keep_annotations: false }),
    (o) => written.push(o),
  );
  frame.m_designBlocksPane = pane;
  pane.SetSelectedLibId(new LIB_ID('Blocks', ''));

  return {
    frame,
    board: b,
    libs,
    errors,
    asked,
    written,
    /** What the selection tool holds after the command (`selectionClear`, `selectItem`). */
    selected: (): EDA_ITEM[] => frame.GetSelectionTool().GetSelection().GetItems(),
    select: (items: EDA_ITEM[]) => {
      frame.GetSelectionTool().ClearSelection(true);
      frame.GetSelectionTool().AddItemsToSel(items, true);
    },
  };
}

const blockPath = (name: string): string => `${lib}/${name}.kicad_block/${name}.kicad_pcb`;
const blockText = (name: string): string =>
  new TextDecoder().decode(wxReadFileSync(blockPath(name))!);

describe('SaveBoardAsDesignBlock', () => {
  it('saves the board under its file name and selects the new block', async () => {
    const t = setup();
    expect(await t.frame.SaveBoardAsDesignBlock('Blocks')).toBe(true);
    expect(t.libs.DesignBlockExists('Blocks', 'power')).toBe(true);
    expect(blockText('power').match(/\(segment/g)).toHaveLength(3);
    expect(blockText('power')).toContain('(footprint "L:R"');
    expect(t.frame.GetDesignBlockPane()!.GetSelectedLibId().Format()).toBe('Blocks:power');
  });

  it('needs a library selected', async () => {
    const t = setup();
    t.frame.GetDesignBlockPane()!.SetSelectedLibId(new LIB_ID());
    expect(await t.frame.SaveBoardAsDesignBlock('Blocks')).toBe(false);
    expect(t.errors).toEqual(['Please select a library to save the design block to.']);
  });

  it('asks before overwriting, and a cancelled properties dialog saves nothing', async () => {
    const t = setup();
    await t.frame.SaveBoardAsDesignBlock('Blocks');
    expect(await t.frame.SaveBoardAsDesignBlock('Blocks')).toBe(true);
    expect(t.asked).toEqual(["Design block 'power' already exists in library 'Blocks'."]);
  });

  it('a cancelled properties dialog saves nothing', async () => {
    const u = setup({ DesignBlockProperties: async () => false });
    expect(await u.frame.SaveBoardAsDesignBlock('Blocks')).toBe(false);
    expect(u.libs.DesignBlockExists('Blocks', 'power')).toBe(false);
  });
});

describe('UpdateDesignBlockFromBoard', () => {
  it('needs an existing block, and asks before replacing its layout', async () => {
    const t = setup();
    expect(await t.frame.UpdateDesignBlockFromBoard(new LIB_ID('Blocks', 'nope'))).toBe(false);
    expect(t.errors).toEqual(["Design block 'nope' does not exist."]);

    await t.frame.SaveBoardAsDesignBlock('Blocks');
    t.board.Remove(t.board.Tracks()[0]!);
    expect(await t.frame.UpdateDesignBlockFromBoard(new LIB_ID('Blocks', 'power'))).toBe(true);
    expect(t.asked).toEqual(["Design block 'power' already has a layout."]);
    expect(blockText('power').match(/\(segment/g)).toHaveLength(2);
  });
});

describe('SaveSelectionAsDesignBlock', () => {
  it('saves copies of the selection with its nets, and groups the originals under the block', async () => {
    const t = setup();
    const [a, b, other] = t.board.Tracks();
    t.select([a!, b!]);

    expect(await t.frame.SaveSelectionAsDesignBlock('Blocks')).toBe(true);
    expect(t.libs.DesignBlockExists('Blocks', 'power')).toBe(true);
    const text = blockText('power');
    expect(text.match(/\(segment/g)).toHaveLength(2);
    expect(text).toContain('(net "GND")');
    expect(text).not.toContain('VCC');
    expect(text).not.toContain('(footprint');

    const groups = t.board.Groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.GetName()).toBe('power');
    expect(groups[0]!.GetDesignBlockLibId().Format()).toBe('Blocks:power');
    expect(groups[0]!.GetItems().size).toBe(2);
    expect(groups[0]!.GetItems().has(a!) && groups[0]!.GetItems().has(b!)).toBe(true);
    expect(other!.GetParentGroup()).toBeNull();
    expect(t.selected()).toEqual([groups[0]]);
  });

  it('a footprint saves with the nets of its pads and is grouped whole', async () => {
    const t = setup();
    const fp = t.board.Footprints()[0]!;
    t.select([fp]);

    expect(await t.frame.SaveSelectionAsDesignBlock('Blocks')).toBe(true);
    expect(blockText('power')).toContain('(net "VCC")');
    const group = t.board.Groups()[0]!;
    expect([...group.GetItems()].map((i) => i === fp)).toEqual([true]);
  });

  it('a single named group names the block and is linked, not regrouped', async () => {
    const t = setup();
    const a = t.board.Tracks()[0]!;
    const group = new PCB_GROUP(t.board);
    group.SetName('filter');
    group.AddItem(a);
    t.board.Add(group);
    t.select([group]);

    expect(await t.frame.SaveSelectionAsDesignBlock('Blocks')).toBe(true);
    expect(t.libs.DesignBlockExists('Blocks', 'filter')).toBe(true);
    expect(blockText('filter').match(/\(segment/g)).toHaveLength(1);
    expect(group.GetDesignBlockLibId().Format()).toBe('Blocks:filter');
    expect(t.board.Groups()).toHaveLength(1);
  });

  it('refuses an empty selection, and needs a library', async () => {
    const t = setup();
    expect(await t.frame.SaveSelectionAsDesignBlock('Blocks')).toBe(false);
    expect(t.errors).toEqual(['Please select some items to save as a design block.']);

    const u = setup();
    u.frame.GetDesignBlockPane()!.SetSelectedLibId(new LIB_ID());
    u.select([u.board.Tracks()[0]!]);
    expect(await u.frame.SaveSelectionAsDesignBlock('Blocks')).toBe(false);
    expect(u.errors).toEqual(['Please select a library to save the design block to.']);
  });
});

describe('UpdateDesignBlockFromSelection', () => {
  it('replaces the layout with the selection and groups it under the block', async () => {
    const t = setup();
    await t.frame.SaveBoardAsDesignBlock('Blocks');
    t.select([t.board.Tracks()[2]!]);
    expect(await t.frame.UpdateDesignBlockFromSelection(new LIB_ID('Blocks', 'power'))).toBe(true);
    expect(t.asked).toEqual(["Design block 'power' already has a layout."]);
    expect(blockText('power').match(/\(segment/g)).toHaveLength(1);
    expect(blockText('power')).toContain('(net "VCC")');
    expect(t.board.Groups().map((g) => g.GetDesignBlockLibId().Format())).toEqual(['Blocks:power']);
  });

  it('a selected group is stripped to its children, then reselected and linked', async () => {
    const t = setup();
    await t.frame.SaveBoardAsDesignBlock('Blocks');
    const [a, b] = t.board.Tracks();
    const group = new PCB_GROUP(t.board);
    group.AddItem(a!);
    group.AddItem(b!);
    t.board.Add(group);
    t.select([group]);
    expect(await t.frame.UpdateDesignBlockFromSelection(new LIB_ID('Blocks', 'power'))).toBe(true);
    expect(blockText('power').match(/\(segment/g)).toHaveLength(2);
    expect(group.GetDesignBlockLibId().Format()).toBe('Blocks:power');
    expect(t.selected()).toEqual([group]);
    expect(t.board.Groups()).toHaveLength(1);
  });

  it('refuses an invalid id and an empty selection', async () => {
    const t = setup();
    expect(await t.frame.UpdateDesignBlockFromSelection(new LIB_ID())).toBe(false);
    expect(await t.frame.UpdateDesignBlockFromSelection(new LIB_ID('Blocks', 'x'))).toBe(false);
    expect(t.errors).toEqual([
      'Please select a library to save the design block to.',
      'Please select some items to save as a design block.',
    ]);
  });
});

describe('PCB_DESIGN_BLOCK_PREVIEW_WIDGET', () => {
  it('previews the saved board; nothing for no block or a block without one', async () => {
    const t = setup();
    await t.frame.SaveBoardAsDesignBlock('Blocks');
    const blk = t.libs.LoadDesignBlock('Blocks', 'power')!;
    expect(loadDesignBlockBoard(blk)?.Tracks()).toHaveLength(3);
    expect(loadDesignBlockBoard(null)).toBeNull();
    blk.SetBoardFile('');
    expect(loadDesignBlockBoard(blk)).toBeNull();
  });

  it('fits the items with a fifth of whitespace, centred on their box', () => {
    const b = board();
    const box = designBlockItemBBox(b);
    expect(box.GetWidth()).toBeGreaterThan(0);
    const v = fitDesignBlockView({ x: 600, y: 300 }, box);
    const fit = Math.min(600 / box.GetWidth(), 300 / box.GetHeight());
    expect(v.scale).toBeCloseTo(fit / 1.2, 12);
    expect(v.center).toEqual(box.Centre());
  });
});

describe('PCB_DESIGN_BLOCK_PANE options', () => {
  it('reads the three options as stored', () => {
    const t = setup();
    const pane = t.frame.GetDesignBlockPane()!;
    expect(pane.UpdateCheckboxes()).toEqual({
      repeated_placement: false,
      place_as_group: true,
      keep_annotations: false,
    });
  });

  it('writes all three options back at once', () => {
    const t = setup();
    const o = { repeated_placement: true, place_as_group: false, keep_annotations: true };
    t.frame.GetDesignBlockPane()!.OnCheckBox(o);
    expect(t.written).toEqual([o]);
  });
});
