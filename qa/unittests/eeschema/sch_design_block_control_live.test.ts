// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DESIGN_BLOCK_CONTROL (tools/sch_design_block_control.cpp) on DESIGN_BLOCK_CONTROL
 * (common/tool/design_block_control.cpp), on the TOOL_MANAGER: every command acts on the tree's
 * current node.
 */
import { resolve } from 'node:path';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_DESIGN_BLOCK_PANE } from '@ziroeda/eeschema/widgets/sch_design_block_pane.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function node(aType: LibTreeNodeType, aLib: string, aItem = '', aPinned = false): LibTreeNode {
  const n = new LibTreeNode();
  n.type = aType;
  n.libNickname = aLib;
  n.libItemName = aItem;
  n.pinned = aPinned;
  return n;
}

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const mgr = h.frame.GetToolManager()!;

  let refreshed = 0;
  const pane = new SCH_DESIGN_BLOCK_PANE(
    {
      DesignBlockLibs: () => h.frame.Prj().DesignBlockLibs(),
      GetLibraryManager: () => {
        throw new Error('unused');
      },
      NormalizePath: (p) => p,
      ShowInfoBarError: () => {},
      SetStatusText: () => {},
    },
    {
      IsOK: async () => true,
      OKOrCancel: async () => true,
      ConfirmOverwriteLibrary: async () => true,
      DisplayError: () => {},
      GetTextFromUser: async () => '',
      NewLibraryBrowser: async () => null,
      DesignBlockProperties: async () => true,
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
  pane.OnRefresh(() => refreshed++);
  h.frame.m_designBlocksPane = pane;

  // The frame's design block commands, recorded rather than run: they are sch_design_block_utils'.
  const calls: unknown[][] = [];
  const frame = h.frame as unknown as Record<string, unknown>;
  frame.SaveSheetAsDesignBlock = async (aLib: string, aSheet: SCH_SHEET_PATH) => {
    calls.push(['SaveSheetAsDesignBlock', aLib, aSheet === h.frame.GetCurrentSheet()]);
    return true;
  };
  frame.SaveSelectionAsDesignBlock = async (aLib: string) => {
    calls.push(['SaveSelectionAsDesignBlock', aLib]);
    return true;
  };
  frame.UpdateDesignBlockFromSheet = async (aLibId: LIB_ID) => {
    calls.push(['UpdateDesignBlockFromSheet', aLibId.Format()]);
    return true;
  };
  frame.UpdateDesignBlockFromSelection = async (aLibId: LIB_ID) => {
    calls.push(['UpdateDesignBlockFromSelection', aLibId.Format()]);
    return false;
  };
  let toggled = 0;
  frame.ToggleLibraryTree = () => toggled++;

  return { ...h, mgr, pane, calls, refreshed: () => refreshed, toggled: () => toggled };
}

describe('SCH_DESIGN_BLOCK_CONTROL', () => {
  it('pins and unpins the current library in the project, refreshing the tree', () => {
    const h = setUp();
    const lib = node(LibTreeNodeType.LIBRARY, 'Blocks');
    h.pane.SetCurrentTreeNode(lib);

    h.mgr.RunAction(ACTIONS.pinLibrary);
    expect(lib.pinned).toBe(true);
    expect(h.frame.Prj().GetProjectFile().m_PinnedDesignBlockLibs).toEqual(['Blocks']);
    expect(h.refreshed()).toBe(1);

    // Pinning a pinned library does nothing.
    h.mgr.RunAction(ACTIONS.pinLibrary);
    expect(h.refreshed()).toBe(1);

    h.mgr.RunAction(ACTIONS.unpinLibrary);
    expect(lib.pinned).toBe(false);
    expect(h.frame.Prj().GetProjectFile().m_PinnedDesignBlockLibs).toEqual([]);
    expect(h.refreshed()).toBe(2);
  });

  it('saves the current sheet and the selection into the current node’s library', async () => {
    const h = setUp();
    h.pane.SetCurrentTreeNode(node(LibTreeNodeType.ITEM, 'Blocks', 'amp'));

    h.mgr.RunAction(SCH_ACTIONS.saveSheetAsDesignBlock);
    await flush();
    h.mgr.RunAction(SCH_ACTIONS.saveSelectionAsDesignBlock);
    await flush();

    expect(h.calls).toEqual([
      ['SaveSheetAsDesignBlock', 'Blocks', true],
      ['SaveSelectionAsDesignBlock', 'Blocks'],
    ]);
  });

  it('updates the current design block from the sheet or the selection by its LIB_ID', async () => {
    const h = setUp();
    h.pane.SetCurrentTreeNode(node(LibTreeNodeType.ITEM, 'Blocks', 'amp'));

    h.mgr.RunAction(SCH_ACTIONS.updateDesignBlockFromSheet);
    await flush();
    h.mgr.RunAction(SCH_ACTIONS.updateDesignBlockFromSelection);
    await flush();

    expect(h.calls).toEqual([
      ['UpdateDesignBlockFromSheet', 'Blocks:amp'],
      ['UpdateDesignBlockFromSelection', 'Blocks:amp'],
    ]);
  });

  it('with no current node nothing runs', async () => {
    const h = setUp();
    h.pane.SetCurrentTreeNode(null);

    h.mgr.RunAction(SCH_ACTIONS.saveSheetAsDesignBlock);
    h.mgr.RunAction(ACTIONS.pinLibrary);
    await flush();

    expect(h.calls).toEqual([]);
    expect(h.refreshed()).toBe(0);
  });

  it('Hide Library Tree toggles the frame’s tree', () => {
    const h = setUp();
    h.mgr.RunAction(ACTIONS.hideLibraryTree);
    expect(h.toggled()).toBe(1);
  });
});
