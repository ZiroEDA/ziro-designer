// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DRC_TOOL + DIALOG_DRC on the live engine: the dialog's own code
 * (`dialog_drc_model.ts`) driven the way the window drives it, over a frame
 * with no canvas. KiCad's creepage board (1 violation) is the fixture.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_IGNORE,
} from '@ziroeda/common/src/reporter.js';
import { RC_TREE_NODE_TYPE } from '@ziroeda/common/src/rc_item.js';
import type { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import {
  DIALOG_DRC,
  type DIALOG_DRC_WINDOW,
} from '@ziroeda/designer/src/editors/pcb/dialogs/dialog_drc_model.js';
import { PCB_EDIT_FRAME } from '@ziroeda/designer/src/editors/pcb/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/src/pcbnew_settings.js';
import { PCB_DRC_CODE } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/src/tools/pcb_actions.js';
import { DRC_TOOL } from '@ziroeda/pcbnew/src/tools/drc_tool.js';
import { readFileSync } from 'node:fs';
import { HAVE_TEST_DATA, LoadBoard, PCBNEW_TEST_DATA_DIR } from './drc_test_utils.js';

const suite = HAVE_TEST_DATA ? describe : describe.skip;

interface Harness {
  frame: PCB_EDIT_FRAME;
  dialogs: DIALOG_DRC[];
  shown: boolean[];
  saved: { name: string; text: string }[];
  window: DIALOG_DRC_WINDOW;
}

function makeHarness(): Harness {
  const settings = new PCBNEW_SETTINGS();
  settings.m_DRCDialog.crossprobe = false; // no canvas to focus

  const h: Partial<Harness> = { dialogs: [], shown: [], saved: [] };

  const window: DIALOG_DRC_WINDOW = {
    textEntry: async () => 'a comment',
    askDeleteExclusions: async () => 'no',
    saveReport: async (name, write) => {
      const text = write(`/tmp/${name}`);
      if (text !== null) h.saved!.push({ name, text });
      return `/tmp/${name}`;
    },
    displayError: () => {},
    showBoardSetupDialog: () => {},
    setLayerVisible: () => {},
    show: (aShow) => {
      h.shown!.push(aShow);
    },
    raise: () => {},
    isShownOnScreen: () => h.shown!.at(-1) === true,
    destroy: () => {
      h.shown!.push(false);
    },
    saveDrcDialogSettings: () => {},
  };

  const frame: PCB_EDIT_FRAME = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
    onUndoRedoIncomplete: () => {},
    createDrcDialog: (_tool: DRC_TOOL): DIALOG_DRC => {
      const d: DIALOG_DRC = new DIALOG_DRC(frame, window);
      h.dialogs!.push(d);
      return d;
    },
    isSingle: () => true,
    fetchNetlistFromSchematic: () => false,
    onEditItemRequest: () => {},
    showExchangeFootprintsDialog: () => {},
    findDialogRects: (): BOX2D[] => [],
    setViewCenter: (_aPos: Vec2) => {},
  });

  h.frame = frame;
  h.window = window;
  return h as Harness;
}

const runDialog = (dialog: DIALOG_DRC): Promise<void> =>
  new Promise((resolve) => {
    dialog.OnRunDRCClick();
    // OnRunDRCClick runs the tests on a timer, then shows the results page 500 ms later
    const poll = (): void => {
      if (!dialog.IsRunning() && dialog.m_runningResultsBook === 1) resolve();
      else setTimeout(poll, 20);
    };
    setTimeout(poll, 20);
  });

suite('DRC_TOOL + DIALOG_DRC on the live engine', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('runDRC opens the dialog; Run DRC puts the markers on the board and in the tree', async () => {
    const h = makeHarness();
    const board = LoadBoard('creepage/creepage');
    h.frame.SetBoard(board, false);
    // OnRunDRCClick re-reads the project's rules: the frame must know them
    const dru = `${PCBNEW_TEST_DATA_DIR}creepage/creepage.kicad_dru`;
    h.frame.OnBoardLoaded(readFileSync(dru, 'utf8'), dru);

    const bds = board.GetDesignSettings();

    for (let ii = PCB_DRC_CODE.DRCE_FIRST; ii <= PCB_DRC_CODE.DRCE_LAST; ++ii)
      bds.m_DRCSeverities.set(ii, RPT_SEVERITY_IGNORE);

    bds.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_CREEPAGE, RPT_SEVERITY_ERROR);

    // PCB_ACTIONS::runDRC -> DRC_TOOL::ShowDRCDialog -> the frame's CreateDrcDialog
    expect(h.frame.GetToolManager()!.RunAction(PCB_ACTIONS.runDRC)).toBe(true);
    expect(h.dialogs.length).toBe(1);
    expect(h.shown.at(-1)).toBe(true);

    const dialog = h.dialogs[0]!;
    const tool = h.frame.GetToolManager()!.GetTool(DRC_TOOL)!;
    expect(tool.GetDRCDialog()).toBe(dialog);
    expect(tool.IsDRCDialogShown()).toBe(true);

    // Before a run: the page titles carry no counts, the badges are hidden
    expect(dialog.m_pageTitles).toEqual([
      'Violations ',
      'Unconnected Items ',
      'Schematic Parity ',
      'Ignored Tests ',
    ]);
    expect(dialog.m_errorsBadge.number).toBe(-1);

    await runDialog(dialog);

    expect(dialog.IsDrcRun()).toBe(true);
    expect(dialog.m_messages.at(-1)).toBe('Done.<br><br>');
    expect(dialog.m_statusText).toMatch(/^Completed in /);

    // The violation is a PCB_MARKER on the board (BOARD_COMMIT::Push)
    expect(board.Markers().length).toBe(1);
    expect(board.Markers()[0]!.GetRCItem()!.GetErrorCode()).toBe(PCB_DRC_CODE.DRCE_CREEPAGE);

    // ...and one marker row with its two item children in the Violations tree
    const tree = dialog.m_markersTreeModel.GetTree();
    expect(tree.length).toBe(1);
    expect(tree[0]!.m_Type).toBe(RC_TREE_NODE_TYPE.MARKER);
    expect(tree[0]!.m_Children.map((c) => c.m_Type)).toEqual([
      RC_TREE_NODE_TYPE.MAIN_ITEM,
      RC_TREE_NODE_TYPE.AUX_ITEM,
    ]);
    expect(dialog.m_markersTreeModel.GetValue(tree[0]!)).toBe(
      "Error: Creepage violation (rule 'GND-HV_CRE' creepage 8.0000 mm; actual 3.9263 mm)",
    );
    expect(dialog.m_markersTreeModel.GetValue(tree[0]!.m_Children[0]!)).toMatch(
      /^Track \[.*\] on F\.Cu/,
    );

    // updateDisplayedCounts: the titles and badges
    expect(dialog.m_pageTitles[0]).toBe('Violations (1)');
    expect(dialog.m_pageTitles[1]).toBe('Unconnected Items (0)');
    expect(dialog.m_pageTitles[2]).toBe('Schematic Parity (not run)');
    expect(dialog.m_pageTitles[3]).toMatch(/^Ignored Tests \(\d+\)$/);
    expect(dialog.m_errorsBadge).toEqual({ number: 1, max: 1 });
    expect(dialog.m_warningsBadge).toEqual({ number: 0, max: 0 });
    expect(dialog.m_ignoredList.length).toBeGreaterThan(50);
    expect(dialog.m_ignoredList.some((r) => r.text === ' • Clearance violation')).toBe(true);

    // The report writers
    await dialog.OnSaveReport();
    expect(h.saved.length).toBe(1);
    expect(h.saved[0]!.text).toContain('** Found 1 DRC violations **');
    expect(h.saved[0]!.text).toContain('** Report includes: Errors, Warnings **');
    expect(h.saved[0]!.text).toContain(
      "[creepage]: Creepage violation (rule 'GND-HV_CRE' creepage 8.0000 mm; actual 3.9263 mm)",
    );

    // ExcludeMarker on the selected row: the marker becomes an exclusion, hidden
    // from the tree while "Exclusions" is off, remembered in the design settings
    dialog.m_markerDataView.Select(tree[0]!);
    dialog.ExcludeMarker();
    expect(board.Markers()[0]!.GetSeverity()).toBe(RPT_SEVERITY_EXCLUSION);
    expect(bds.m_DrcExclusions.size).toBe(1);
    expect(dialog.m_markersTreeModel.GetTree().length).toBe(0);
    expect(dialog.m_pageTitles[0]).toBe('Violations (0)');
    expect(dialog.m_exclusionsBadge).toEqual({ number: 1, max: 1 });

    // Show exclusions: the row is back, labelled as one
    dialog.OnSeverity('exclusions', true);
    expect(dialog.m_markersTreeModel.GetTree().length).toBe(1);
    expect(dialog.m_markersTreeModel.GetValue(dialog.m_markersTreeModel.GetTree()[0]!)).toMatch(
      /^Excluded error: /,
    );

    // The row menu: "Remove exclusion for this violation" is first for an excluded marker
    const rows = dialog.OnDRCItemRClick(
      dialog.m_markersTreeModel,
      dialog.m_markersTreeModel.GetTree()[0]!,
    );
    expect(rows[0]!.label).toBe('Remove exclusion for this violation');
    expect(
      rows.some((r) => r.label === "Remove all exclusions for violations of rule 'GND-HV_CRE'"),
    ).toBe(true);
    await rows[0]!.action!();
    expect(bds.m_DrcExclusions.size).toBe(0);
    expect(board.Markers()[0]!.GetSeverity()).not.toBe(RPT_SEVERITY_EXCLUSION);

    // Delete All Markers: the board is clear and the counts read "not run"
    await dialog.OnDeleteAllClick();
    expect(board.Markers().length).toBe(0);
    expect(dialog.IsDrcRun()).toBe(false);
    expect(dialog.m_pageTitles[0]).toBe('Violations ');

    // Close: DRC_TOOL::DestroyDRCDialog
    dialog.OnCancelClick();
    expect(tool.GetDRCDialog()).toBe(null);
    expect(h.shown.at(-1)).toBe(false);
  });
});
