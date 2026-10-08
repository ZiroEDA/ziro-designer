// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDITOR_CONTROL (tools/sch_editor_control.cpp) on the TOOL_MANAGER, section A: undo and
 * redo, the setup dialogs, annotation increments, the view toggles, the line modes, cross-probing.
 */
import { resolve } from 'node:path';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import {
  EESCHEMA_DEFAULTS,
  type EeschemaSettings,
  setEeschemaSettingsProvider,
  setUpdateEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import type { INCREMENT_ANNOTATIONS_VALUES } from '@ziroeda/eeschema/tools/sch_editor_control.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { SCH_GROUP } from '@ziroeda/eeschema/sch_group.js';
import { SYMBOL_EDIT_FRAME } from '@ziroeda/eeschema/symbol_editor/symbol_edit_frame.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

let cfg: EeschemaSettings;

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  cfg = structuredClone(EESCHEMA_DEFAULTS);
  setEeschemaSettingsProvider(() => cfg);
  setUpdateEeschemaSettingsProvider((mutate) => {
    const next = structuredClone(cfg);
    mutate(next);
    cfg = next;
  });
});
afterEach(() => {
  SetPgm(null);
  setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS);
  setUpdateEeschemaSettingsProvider(() => {});
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  return { ...h, mgr, sel };
}

describe('SCH_EDITOR_CONTROL', () => {
  it('Undo takes back the last commit and Redo puts it back', () => {
    const h = setUp();
    const t = new SCH_TEXT(P(0, 0), 'undo me');
    const commit = new SCH_COMMIT(h.mgr);
    commit.Add(t, h.frame.GetScreen());
    commit.Push('Add Text');
    const onScreen = () => [...h.frame.GetScreen()!.Items()].includes(t);
    expect(onScreen()).toBe(true);

    h.mgr.RunAction(ACTIONS.undo);
    expect(onScreen()).toBe(false);
    expect(h.frame.GetRedoCommandCount()).toBe(1);

    h.mgr.RunAction(ACTIONS.redo);
    expect(onScreen()).toBe(true);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
  });

  it('Undo with nothing to undo does nothing', () => {
    const h = setUp();
    h.frame.ClearUndoRedoList();
    h.mgr.RunAction(ACTIONS.undo);
    expect(h.frame.GetRedoCommandCount()).toBe(0);
  });

  it('Page Settings cancelled rolls the page back; OK keeps it, as one undo step', async () => {
    let answer = wxID_CANCEL;
    const h = setUp({
      showModal: (aDialog) => {
        if (aDialog === 'DIALOG_EESCHEMA_PAGE_SETTINGS')
          h.frame.GetScreen()!.GetTitleBlock().SetTitle('changed');
        return answer;
      },
    });
    const title = () => h.frame.GetScreen()!.GetTitleBlock().GetTitle();
    const before = title();
    const undo = h.frame.GetUndoCommandCount();

    h.mgr.RunAction(ACTIONS.pageSettings);
    await flush();
    expect(title()).toBe(before);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);

    answer = wxID_OK;
    h.mgr.RunAction(ACTIONS.pageSettings);
    await flush();
    expect(title()).toBe('changed');
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('Increment Annotations adds the increment to every matching reference from the first', async () => {
    let values: INCREMENT_ANNOTATIONS_VALUES | null = null;
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog !== 'DIALOG_INCREMENT_ANNOTATIONS_BASE') return wxID_CANCEL;
        values = aArg as INCREMENT_ANNOTATIONS_VALUES;
        values.firstRefDes = 'R5';
        values.allSheets = true;
        values.increment = 100;
        return wxID_OK;
      },
    });
    const sheets = h.frame.Schematic().Hierarchy();
    const refs = () => {
      const out: string[] = [];
      for (const sheet of sheets)
        for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T))
          out.push((item as SCH_SYMBOL).GetRef(sheet));
      return out;
    };
    const before = refs();
    // What the dialog promises: R5 and above move up by 100, everything else stays.
    const expected = before.map((r) => {
      const m = /^R(\d+)$/.exec(r);
      return m && Number(m[1]) >= 5 ? `R${Number(m[1]) + 100}` : r;
    });
    expect(expected).not.toEqual(before);

    h.mgr.RunAction(SCH_ACTIONS.incrementAnnotations);
    await flush();

    expect(values).not.toBeNull();
    // A commit re-inserts what it modified, so the screens' item order moves: compare as sets.
    expect(refs().sort()).toEqual(expected.sort());
  });

  it('the view toggles flip their eeschema.json setting', () => {
    const h = setUp();
    const flips: [TOOL_ACTION, () => boolean][] = [
      [SCH_ACTIONS.toggleHiddenPins, () => cfg.appearance.show_hidden_pins],
      [SCH_ACTIONS.toggleHiddenFields, () => cfg.appearance.show_hidden_fields],
      [SCH_ACTIONS.toggleDirectiveLabels, () => cfg.appearance.show_directive_labels],
      [SCH_ACTIONS.toggleERCWarnings, () => cfg.appearance.show_erc_warnings],
      [SCH_ACTIONS.toggleERCErrors, () => cfg.appearance.show_erc_errors],
      [SCH_ACTIONS.toggleERCExclusions, () => cfg.appearance.show_erc_exclusions],
      [SCH_ACTIONS.togglePinAltIcons, () => cfg.appearance.show_pin_alt_icons],
      [SCH_ACTIONS.toggleAnnotateAuto, () => cfg.annotation.automatic],
    ];

    for (const [action, read] of flips) {
      const before = read();
      h.mgr.RunAction(action);
      expect(read()).toBe(!before);
    }

    // Both ways: the painter's default is true, so one toggle alone could not tell.
    for (const shown of [false, true]) {
      h.mgr.RunAction(SCH_ACTIONS.toggleHiddenFields);
      expect(cfg.appearance.show_hidden_fields).toBe(shown);
      expect(h.frame.GetRenderSettings()!.m_ShowHiddenFields).toBe(shown);
    }
    for (const shown of [true, false]) {
      h.mgr.RunAction(SCH_ACTIONS.togglePinAltIcons);
      expect(cfg.appearance.show_pin_alt_icons).toBe(shown);
      expect(h.frame.GetRenderSettings()!.m_ShowPinAltIcons).toBe(shown);
    }
  });

  it('Next Line Mode cycles free, 90, 45 and selects the matching toolbar button', () => {
    const h = setUp();
    const selected: string[] = [];
    (h.frame as unknown as { SelectToolbarAction(a: TOOL_ACTION): void }).SelectToolbarAction = (
      a,
    ) => selected.push(a.GetName());
    cfg.drawing.line_mode = 0;

    h.mgr.RunAction(SCH_ACTIONS.lineModeNext);
    h.mgr.RunAction(SCH_ACTIONS.lineModeNext);
    h.mgr.RunAction(SCH_ACTIONS.lineModeNext);

    expect(cfg.drawing.line_mode).toBe(0);
    expect(selected).toEqual([
      SCH_ACTIONS.lineMode90.GetName(),
      SCH_ACTIONS.lineMode45.GetName(),
      SCH_ACTIONS.lineModeFree.GetName(),
    ]);

    h.mgr.RunAction(SCH_ACTIONS.lineMode90);
    expect(cfg.drawing.line_mode).toBe(1);
  });

  it('the pane actions toggle the pane KiCad names', () => {
    const panes: string[] = [];
    const h = setUp({ togglePane: (p) => panes.push(p) });

    h.mgr.RunAction(ACTIONS.showSearch);
    h.mgr.RunAction(SCH_ACTIONS.showHierarchy);
    h.mgr.RunAction(SCH_ACTIONS.showNetNavigator);
    h.mgr.RunAction(ACTIONS.showProperties);
    h.mgr.RunAction(SCH_ACTIONS.showDesignBlockPanel);
    h.mgr.RunAction(SCH_ACTIONS.showRemoteSymbolPanel);

    expect(panes).toEqual([
      'Search',
      'SchematicHierarchy',
      'NetNavigator',
      'Properties',
      'DesignBlocks',
      'RemoteSymbol',
    ]);
  });

  it('Edit Symbol Fields and Generate BOM open one Symbol Fields Table on its tab', () => {
    const calls: string[] = [];
    let built = 0;
    const h = setUp({
      symbolFieldsTableDialog: () => {
        built++;
        return {
          Show: () => calls.push('Show'),
          Raise: () => calls.push('Raise'),
          ShowEditTab: () => calls.push('Edit'),
          ShowExportTab: () => calls.push('Export'),
        };
      },
    });

    h.mgr.RunAction(SCH_ACTIONS.editSymbolFields);
    h.mgr.RunAction(SCH_ACTIONS.generateBOM);

    expect(built).toBe(1);
    expect(calls).toEqual(['Show', 'Raise', 'Edit', 'Show', 'Raise', 'Export']);
  });

  it('Schematic Setup on OK marks the schematic modified; cancelled it does not', async () => {
    let answer = wxID_CANCEL;
    const pages: unknown[] = [];
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog === 'DIALOG_SCHEMATIC_SETUP') pages.push(aArg);
        return answer;
      },
    });
    const screen = h.frame.GetScreen()!;
    screen.SetContentModified(false);

    h.mgr.RunAction(SCH_ACTIONS.schematicSetup);
    await flush();
    expect(screen.IsContentModified()).toBe(false);

    answer = wxID_OK;
    h.mgr.RunAction(SCH_ACTIONS.schematicSetup);
    await flush();
    expect(screen.IsContentModified()).toBe(true);
    expect(pages).toEqual(['', '']);
  });

  it('a selection change is sent to the board, unless it came from the board', () => {
    const h = setUp();
    const sent: [readonly EDA_ITEM[], boolean][] = [];
    (h.frame as unknown as Record<string, unknown>).SendSelectItemsToPcb = (
      aItems: readonly EDA_ITEM[],
      aForce: boolean,
    ) => sent.push([aItems, aForce]);
    const t = new SCH_TEXT(P(0, 0), 'x');
    h.frame.AddToScreen(t, h.frame.GetScreen());

    h.sel.AddItemToSel(t);
    expect(sent.length).toBe(1);
    expect(sent[0]![1]).toBe(false);

    h.mgr.RunAction(SCH_ACTIONS.selectOnPCB);
    expect(sent.length).toBe(2);
    expect(sent[1]![1]).toBe(true);
  });

  it('a selection the board sends (MAIL_SELECTION_FORCE) is not sent back to it', () => {
    const h = setUp();
    const sent: unknown[] = [];
    (h.frame as unknown as Record<string, unknown>).SendSelectItemsToPcb = (aItems: unknown) =>
      sent.push(aItems);
    const path = h.frame.GetCurrentSheet();
    const symbol = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)].find(
      (s) => !(s as SCH_SYMBOL).GetRef(path).startsWith('#'),
    ) as SCH_SYMBOL;

    h.frame.KiwayMailIn(
      new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SELECTION_FORCE, {
        value: `$SELECT: 0,F${symbol.GetRef(path)}`,
      }),
    );

    expect(h.sel.GetSelection().Items().includes(symbol)).toBe(true);
    expect(sent).toEqual([]);
    expect(h.frame.IsSyncingSelection()).toBe(false);
  });

  it('a grid change by key pops the grid list at the current grid', () => {
    const h = setUp();
    // KiCad always has COMMON_SETTINGS; hotkey_feedback defaults to true (common_settings.cpp).
    Pgm().SetCommonSettings({ m_Input: { hotkey_feedback: true } } as never);
    const shown: [string, readonly string[], number][] = [];
    h.frame.SetHotkeyPopup({ Popup: (aTitle, aItems, aSel) => shown.push([aTitle, aItems, aSel]) });

    h.mgr.ProcessEvent(EVENTS.GridChangedByKeyEvent);

    const grid = (h.frame.config() as APP_SETTINGS_BASE).m_Window.grid;
    expect(grid.grids.length).toBeGreaterThan(0);
    expect(shown).toEqual([
      ['Grid', grid.grids.map((g) => g.UserUnitsMessageText(h.frame)), grid.last_size_idx],
    ]);

    // With feedback off, nothing pops.
    Pgm().SetCommonSettings({ m_Input: { hotkey_feedback: false } } as never);
    h.mgr.ProcessEvent(EVENTS.GridChangedByKeyEvent);
    expect(shown.length).toBe(1);
  });

  it('Assign Footprints opens CvPcb and mails it the netlist; Show PCB opens the board editor', () => {
    const h = setUp();
    const shown: FRAME_T[] = [];
    const kiway = new KIWAY({
      OnKiCadExit: () => {},
      Player: (t) => {
        shown.push(t);
        return true;
      },
      HasProjectManager: () => true,
      ShowProjectManager: () => {},
      CreateKiWindow: () => false,
    });
    h.frame.SetKiway(kiway);

    h.mgr.RunAction(SCH_ACTIONS.assignFootprints);
    h.mgr.RunAction(SCH_ACTIONS.showPcbNew);

    expect(shown).toEqual([FRAME_T.FRAME_CVPCB, FRAME_T.FRAME_PCB_EDITOR]);

    // CvPcb was not up yet: the netlist waits for it to register.
    const received: [MAIL_T, string][] = [];
    const cvpcb = new (class extends KIWAY_PLAYER {
      override KiwayMailIn(aEvent: KIWAY_MAIL_EVENT): void {
        received.push([aEvent.Command(), aEvent.GetPayload()]);
      }
    })(FRAME_T.FRAME_CVPCB, pcbIUScale, 'mm');
    kiway.SetPlayerFrame(FRAME_T.FRAME_CVPCB, cvpcb);

    expect(received.length).toBe(1);
    expect(received[0]![0]).toBe(MAIL_T.MAIL_EESCHEMA_NETLIST);
    expect(received[0]![1]).toMatch(/^\(export\n\t\(version "E"\)/);
  });

  it('Edit with Symbol Editor hands the selected symbol to the symbol editor; Edit Library Symbol opens its LIB_ID', () => {
    const h = setUp();
    const calls: unknown[][] = [];
    const kiway = new KIWAY({
      OnKiCadExit: () => {},
      Player: () => true,
      HasProjectManager: () => true,
      ShowProjectManager: () => {},
      CreateKiWindow: () => false,
    });
    h.frame.SetKiway(kiway);
    const symEditor = new SYMBOL_EDIT_FRAME({
      libEdit: () => {},
      loadSymbolFromSchematic: (aSymbol) => calls.push(['fromSchematic', aSymbol]),
      loadSymbol: (aLibId, aUnit, aBodyStyle) => {
        calls.push(['library', aLibId.Format(), aUnit, aBodyStyle]);
        return true;
      },
      isLibraryTreeShown: () => false,
      toggleLibraryTree: () => calls.push(['toggleTree']),
    });
    kiway.SetPlayerFrame(FRAME_T.FRAME_SCH_SYMBOL_EDITOR, symEditor);
    const symbol = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)][0] as SCH_SYMBOL;
    h.sel.AddItemToSel(symbol, true);

    h.mgr.RunAction(SCH_ACTIONS.editWithLibEdit);
    h.mgr.RunAction(SCH_ACTIONS.editLibSymbolWithLibEdit);

    expect(calls.length).toBe(3);
    expect(calls[0]![0]).toBe('fromSchematic');
    expect(calls[0]![1] === symbol).toBe(true);
    expect(calls[1]).toEqual([
      'library',
      symbol.GetLibId().Format(),
      symbol.GetUnit(),
      symbol.GetBodyStyle(),
    ]);
    expect(calls[2]).toEqual(['toggleTree']);
  });

  it('Place / Save Linked Design Block need a lone group with a link, and say when the block is gone', () => {
    const h = setUp();
    const messages: string[] = [];
    h.frame.SetInfoBar({
      IsLocked: () => false,
      AddButton: () => {},
      RemoveAllButtons: () => {},
      ShowMessageFor: (m) => {
        messages.push(m);
      },
      Dismiss: () => {},
    });
    h.frame.m_designBlocksPane = { GetDesignBlock: () => null } as never;
    const group = new SCH_GROUP();
    h.frame.AddToScreen(group, h.frame.GetScreen());

    // No link: nothing to do.
    h.sel.ClearSelection(true);
    h.sel.AddItemToSel(group, true);
    h.mgr.RunAction(SCH_ACTIONS.placeLinkedDesignBlock);
    expect(messages).toEqual([]);

    group.SetDesignBlockLibId(new LIB_ID('Blocks', 'amp'));
    h.mgr.RunAction(SCH_ACTIONS.placeLinkedDesignBlock);
    h.mgr.RunAction(SCH_ACTIONS.saveToLinkedDesignBlock);

    expect(messages).toEqual([
      'Could not find design block Blocks:amp.',
      'Could not find design block Blocks:amp.',
    ]);
  });
});
