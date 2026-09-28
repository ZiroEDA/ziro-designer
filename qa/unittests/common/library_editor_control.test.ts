// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * LIBRARY_EDITOR_CONTROL (`common/tool/library_editor_control.cpp`): the
 * actions run through a TOOL_MANAGER against a frame's LIB_TREE, the tree-menu
 * rows `AddContextMenuItems` adds, RENAME_DIALOG's trimmed validation, and
 * `KIWAY::KifaceType`, which picks the project's pinned-library list.
 */
import { describe, expect, it } from 'vitest';
import { EDA_BASE_FRAME } from '@ziroeda/common/eda_base_frame.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { FACE_T, KIWAY } from '@ziroeda/common/kiway.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import { LIB_TYPE_T } from '@ziroeda/common/project.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import {
  CheckPinnedStatus,
  LIBRARY_EDITOR_CONTROL,
  RENAME_DIALOG,
  SetRenameDialogPresenter,
} from '@ziroeda/common/tool/library_editor_control.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';

function node(type: LibTreeNodeType, lib: string, pinned = false): LibTreeNode {
  const n = new LibTreeNode();
  n.type = type;
  n.libNickname = lib;
  n.pinned = pinned;
  return n;
}
const LIB = (lib: string, pinned = false) => node(LibTreeNodeType.LIBRARY, lib, pinned);
const ITEM = (lib: string) => node(LibTreeNodeType.ITEM, lib);

function setup(frameType: FRAME_T, selection: LibTreeNode[], hasTree = true) {
  const log: string[] = [];
  let shown = false;
  const tree = {
    GetSelectedTreeNodes: (out: LibTreeNode[]) => {
      out.push(...selection);
      return selection.length;
    },
    Regenerate: (keep: boolean) => log.push(`regenerate ${keep}`),
    CenterLibId: (id: LIB_ID) => log.push(`center ${id.GetLibNickname()}`),
  };
  const prj = {
    PinLibrary: (n: string, t: LIB_TYPE_T) => log.push(`pin ${n} ${LIB_TYPE_T[t]}`),
    UnpinLibrary: (n: string, t: LIB_TYPE_T) => log.push(`unpin ${n} ${LIB_TYPE_T[t]}`),
  };
  class TEST_FRAME extends EDA_BASE_FRAME {
    GetLibTree() {
      return hasTree ? tree : null;
    }
    GetTargetLibId() {
      return new LIB_ID('Target', 'Item');
    }
    IsLibraryTreeShown() {
      return shown;
    }
    ToggleLibraryTree() {
      shown = !shown;
      log.push('toggle');
    }
    FocusLibraryTreeInput() {
      log.push('focus');
    }
    override Prj() {
      return prj as never;
    }
  }
  const frame = new TEST_FRAME(frameType, pcbIUScale, 'mm');
  const mgr = new TOOL_MANAGER();
  mgr.SetEnvironment(null, null, null, null, frame);
  const tool = new LIBRARY_EDITOR_CONTROL();
  mgr.RegisterTool(tool);
  mgr.InitTools();
  mgr.ResetTools(0);
  return { mgr, tool, log, setShown: (v: boolean) => (shown = v) };
}

describe('LIBRARY_EDITOR_CONTROL', () => {
  it('is common.LibraryEditorControl', () => {
    expect(new LIBRARY_EDITOR_CONTROL().GetName()).toBe('common.LibraryEditorControl');
  });

  it('Pin Library pins the selected unpinned libraries in the footprint list', () => {
    const a = LIB('A');
    const b = LIB('B', true);
    const { mgr, log } = setup(FRAME_T.FRAME_FOOTPRINT_EDITOR, [a, b, ITEM('C')]);
    mgr.RunAction(ACTIONS.pinLibrary);

    expect(log).toEqual(['pin A FOOTPRINT_LIB', 'regenerate true', 'center Target']);
    expect(a.pinned).toBe(true);
  });

  it('Unpin Library in the symbol editor goes to the symbol list', () => {
    const b = LIB('B', true);
    const { mgr, log } = setup(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, [b]);
    mgr.RunAction(ACTIONS.unpinLibrary);

    expect(log).toEqual(['unpin B SYMBOL_LIB', 'regenerate true', 'center Target']);
    expect(b.pinned).toBe(false);
  });

  it('a footprint row repins nothing but still regenerates', () => {
    const { mgr, log } = setup(FRAME_T.FRAME_FOOTPRINT_EDITOR, [ITEM('A')]);
    mgr.RunAction(ACTIONS.pinLibrary);
    expect(log).toEqual(['regenerate true', 'center Target']);
  });

  it('show / hide toggle the tree; search shows it only when hidden, then focuses', () => {
    const { mgr, log, setShown } = setup(FRAME_T.FRAME_FOOTPRINT_EDITOR, []);
    mgr.RunAction(ACTIONS.showLibraryTree);
    mgr.RunAction(ACTIONS.hideLibraryTree);
    expect(log).toEqual(['toggle', 'toggle']);

    log.length = 0;
    setShown(true);
    mgr.RunAction(ACTIONS.libraryTreeSearch);
    expect(log).toEqual(['focus']);

    log.length = 0;
    setShown(false);
    mgr.RunAction(ACTIONS.libraryTreeSearch);
    expect(log).toEqual(['toggle', 'focus']);
  });

  it('CheckPinnedStatus fails only on a LIBRARY node of the other state', () => {
    expect(CheckPinnedStatus([], true)).toBe(true);
    expect(CheckPinnedStatus([], false)).toBe(true);
    expect(CheckPinnedStatus([ITEM('A')], true)).toBe(true);
    expect(CheckPinnedStatus([ITEM('A')], false)).toBe(true);
    expect(CheckPinnedStatus([LIB('A', true)], true)).toBe(true);
    expect(CheckPinnedStatus([LIB('A', true)], false)).toBe(false);
    expect(CheckPinnedStatus([LIB('A'), LIB('B', true)], true)).toBe(false);
  });

  it('AddContextMenuItems: pin rows at order 1, Hide Library Tree at 400', () => {
    const { tool } = setup(FRAME_T.FRAME_FOOTPRINT_EDITOR, [LIB('A', true)]);
    const menu = new CONDITIONAL_MENU(tool);
    tool.AddContextMenuItems(menu);
    menu.Evaluate(new SELECTION());

    const labels = menu.GetMenuItems().map((i) => (i.IsSeparator() ? '---' : i.GetItemLabelText()));
    expect(labels).toEqual(['Unpin Library', '---', 'Hide Library Tree']);
  });

  it('no tree fails both pin conditions', () => {
    const { tool } = setup(FRAME_T.FRAME_FOOTPRINT_EDITOR, [], false);
    expect(tool.checkPinnedStatus(true)).toBe(false);
    expect(tool.checkPinnedStatus(false)).toBe(false);
  });

  it('RENAME_DIALOG validates the text trimmed at both ends', async () => {
    const seen: string[] = [];
    const dlg = new RENAME_DIALOG('Change Footprint Name', 'R_0603', (n) => {
      seen.push(n);
      return n !== '';
    });
    expect(dlg.TransferDataFromWindow('  R_0805\t\n')).toBe(true);
    expect(dlg.TransferDataFromWindow('   ')).toBe(false);
    expect(seen).toEqual(['R_0805', '']);

    const { tool } = setup(FRAME_T.FRAME_FOOTPRINT_EDITOR, []);
    SetRenameDialogPresenter(async (d) => d.TransferDataFromWindow(' x '));
    await expect(tool.RenameLibrary('T', 'N', (n) => n === 'x')).resolves.toBe(true);
    SetRenameDialogPresenter(null);
    await expect(tool.RenameLibrary('T', 'N', () => true)).resolves.toBe(false);
  });
});

describe('KIWAY::KifaceType', () => {
  it('maps the frames kiway.cpp:345-386 names', () => {
    expect(KIWAY.KifaceType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR)).toBe(FACE_T.FACE_SCH);
    expect(KIWAY.KifaceType(FRAME_T.FRAME_SIMULATOR)).toBe(FACE_T.FACE_SCH);
    expect(KIWAY.KifaceType(FRAME_T.FRAME_FOOTPRINT_EDITOR)).toBe(FACE_T.FACE_PCB);
    expect(KIWAY.KifaceType(FRAME_T.FRAME_PCB_DISPLAY3D)).toBe(FACE_T.FACE_PCB);
    expect(KIWAY.KifaceType(FRAME_T.FRAME_CVPCB_DISPLAY)).toBe(FACE_T.FACE_CVPCB);
    expect(KIWAY.KifaceType(FRAME_T.FRAME_GERBER)).toBe(FACE_T.FACE_GERBVIEW);
    expect(KIWAY.KifaceType(FRAME_T.FRAME_CALC)).toBe(FACE_T.FACE_PCB_CALCULATOR);
    expect(KIWAY.KifaceType(FRAME_T.FRAME_BM2CMP)).toBe(FACE_T.FACE_BMP2CMP);
    expect(KIWAY.KifaceType(FRAME_T.FRAME_PL_EDITOR)).toBe(FACE_T.FACE_PL_EDITOR);
  });
});
