// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Synchronize Sheet Pins (`eeschema/sync_sheet_pin/`) on a live hierarchy, through
 * SCH_DRAWING_TOOLS::SyncAllSheetsPins: one page per sheet instance, labels and pins sorted into
 * matched and unmatched, a pair matched with one side as the template, an item removed, and a
 * sheet pin placed from a label while the dialog stands aside.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LABEL_FLAG_SHAPE, SCH_HIERLABEL } from '@ziroeda/eeschema/sch_label.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SHEET_PIN } from '@ziroeda/eeschema/sch_sheet_pin.js';
import { SYNC_SHEET_PIN_PREFERENCE } from '@ziroeda/eeschema/sync_sheet_pin/sync_sheet_pin_preference.js';
import { SHEET_SYNCHRONIZATION_MODEL } from '@ziroeda/eeschema/sync_sheet_pin/sheet_synchronization_model.js';
import type { PANEL_SYNC_SHEET_PINS } from '@ziroeda/eeschema/sync_sheet_pin/panel_sync_sheet_pins.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_DRAWING_TOOLS } from '@ziroeda/eeschema/tools/sch_drawing_tools.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, mouse, openProject, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function label(aText: string, aShape: LABEL_FLAG_SHAPE, aAt: number): SCH_HIERLABEL {
  const l = new SCH_HIERLABEL({ x: aAt * G, y: 0 }, aText);
  l.SetShape(aShape);
  return l;
}

function setUp() {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const root = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 1)!;
  h.frame.SetCurrentSheet(root);
  const sheets = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)] as SCH_SHEET[];
  const sheet = sheets[0]!;
  const sub = sheet.GetScreen()!;

  // The sub-sheet file (both instances share it): IN and OUT; the first instance: pins IN, OUTX.
  for (const l of [
    label('IN', LABEL_FLAG_SHAPE.L_INPUT, 1),
    label('OUT', LABEL_FLAG_SHAPE.L_OUTPUT, 2),
  ])
    h.frame.AddToScreen(l, sub);

  const pin = (aText: string, aShape: LABEL_FLAG_SHAPE, aDy: number) => {
    const p = new SCH_SHEET_PIN(
      sheet,
      { x: sheet.GetPosition().x, y: sheet.GetPosition().y + aDy * G },
      aText,
    );
    p.SetShape(aShape);
    sheet.AddPin(p);
    return p;
  };
  pin('IN', LABEL_FLAG_SHAPE.L_INPUT, 2);
  const outx = pin('OUTX', LABEL_FLAG_SHAPE.L_OUTPUT, 4);

  const mgr = h.frame.GetToolManager()!;
  mgr.RunAction(SCH_ACTIONS.syncAllSheetsPins);
  const dlg = mgr.GetTool(SCH_DRAWING_TOOLS)!.m_dialogSyncSheetPin!;
  const book = dlg.m_notebook;
  const panelOf = (s: SCH_SHEET): PANEL_SYNC_SHEET_PINS => {
    for (let i = 0; i < book.GetPageCount(); i++)
      if (book.GetPage(i).GetSheetPath().Last() === s) return book.GetPage(i);
    throw new Error('no page');
  };
  return { h, mgr, dlg, book, sheets, sheet, sub, outx, panel: panelOf(sheet) };
}

const names = (aPanel: PANEL_SYNC_SHEET_PINS, aKind: number): string[] => {
  const m = aPanel.GetModel(aKind);
  return Array.from({ length: m.GetCount() }, (_, r) => m.GetSynchronizationItem(r)!.GetName());
};

/** Select row \a aRow of a list as a click on it does. */
function pick(aPanel: PANEL_SYNC_SHEET_PINS, aKind: number, aRow: number): void {
  const view =
    aKind === SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL
      ? aPanel.m_viewSheetLabels
      : aKind === SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN
        ? aPanel.m_viewSheetPins
        : aPanel.m_viewAssociated;
  const item = aPanel.GetModel(aKind).GetItem(aRow);
  view.SetSelections([item]);
  if (aKind === SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL) aPanel.OnViewSheetLabelCellClicked(item);
  else if (aKind === SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN) aPanel.OnViewSheetPinCellClicked(item);
  else aPanel.OnViewMatchedCellClicked(item);
}

describe('Synchronize Sheet Pins', () => {
  it('opens one page per sheet instance, sorted into matched and unmatched', () => {
    const { dlg, book, sheets, panel } = setUp();

    expect(dlg.IsShown()).toBe(true);
    expect(book.GetPageCount()).toBe(sheets.length);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED)).toEqual(['IN']);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)).toEqual(['OUT']);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)).toEqual(['OUTX']);
    // Something is left to match on this page: upstream shows it as ALL_MATCHED (ercwarn).
    const page = [...Array(book.GetPageCount()).keys()].find((i) => book.GetPage(i) === panel)!;
    expect(book.GetPageImage(page)).toBe(SYNC_SHEET_PIN_PREFERENCE.ALL_MATCHED);
  });

  it('matches a label and a pin only when the name and the shape both agree', () => {
    const { h, sheet, sub, panel } = setUp();
    h.frame.AddToScreen(label('MIX', LABEL_FLAG_SHAPE.L_OUTPUT, 3), sub);
    // SetLabelShape carries a parented pin's shape to its labels (sch_label.cpp:319); a
    // mismatch comes from a file, so the shape is set before the pin joins its sheet.
    const pin = new SCH_SHEET_PIN(null, sheet.GetPosition(), 'MIX');
    pin.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
    sheet.AddPin(pin);

    panel.UpdateForms();

    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED)).toEqual(['IN']);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)).toContain('MIX');
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)).toContain('MIX');
  });

  it('lists the labels once each, in natural order', () => {
    const { h, sub, panel } = setUp();
    for (const [t, x] of [
      ['Z10', 5],
      ['Z9', 6],
      ['A', 7],
      ['Z9', 8],
    ] as const)
      h.frame.AddToScreen(label(t, LABEL_FLAG_SHAPE.L_BIDI, x), sub);

    panel.UpdateForms();

    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)).toEqual(['A', 'OUT', 'Z9', 'Z10']);
  });

  it('enables the template buttons only once a label and a pin are both picked', () => {
    const { panel } = setUp();

    expect(panel.m_btnUseLabelAsTemplate.IsEnabled()).toBe(false);
    pick(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL, 0);
    expect(panel.m_btnUseLabelAsTemplate.IsEnabled()).toBe(false);
    expect(panel.m_btnAddSheetPins.IsEnabled()).toBe(true);
    pick(panel, SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN, 0);
    expect(panel.m_btnUseLabelAsTemplate.IsEnabled()).toBe(true);
    expect(panel.m_btnUsePinAsTemplate.IsEnabled()).toBe(true);
  });

  it('renames the pin after the label, in one undo step on the parent sheet', () => {
    const { h, book, panel, outx } = setUp();
    const undo = h.frame.GetUndoCommandCount();

    pick(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL, 0);
    pick(panel, SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN, 0);
    panel.OnBtnUseLabelAsTemplateClicked();

    expect(outx.GetText()).toBe('OUT');
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED)).toEqual(['IN', 'OUT']);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)).toEqual([]);
    expect(panel.HasUndefinedSheetPing()).toBe(true);
    const page = [...Array(book.GetPageCount()).keys()].find((i) => book.GetPage(i) === panel)!;
    expect(book.GetPageImage(page)).toBe(SYNC_SHEET_PIN_PREFERENCE.HAS_UNMATCHED);
  });

  it('renames the label after the pin when the pin is the template', () => {
    const { sub, panel } = setUp();

    pick(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL, 0);
    pick(panel, SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN, 0);
    panel.OnBtnUsePinAsTemplateClicked();

    const texts = ([...sub.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)] as SCH_HIERLABEL[]).map((l) =>
      l.GetText(),
    );
    expect(texts.sort()).toEqual(['IN', 'OUTX']);
  });

  it('puts an unmatched pair back with Undo', () => {
    const { panel } = setUp();

    pick(panel, SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED, 0);
    expect(panel.m_btnUndo.IsEnabled()).toBe(true);
    panel.OnBtnUndoClicked();

    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.ASSOCIATED)).toEqual([]);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL)).toEqual(['OUT', 'IN']);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)).toEqual(['OUTX', 'IN']);
  });

  it('deletes a removed pin from its sheet', () => {
    const { sheet, panel, outx } = setUp();

    pick(panel, SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN, 0);
    panel.OnBtnRmPinsClicked();

    expect(sheet.GetPins()).not.toContain(outx);
    expect(names(panel, SHEET_SYNCHRONIZATION_MODEL.SHEET_PIN)).toEqual([]);
  });

  it('places a sheet pin from a label while the dialog stands aside, then comes back', async () => {
    const { h, mgr, dlg, sheet, panel } = setUp();

    pick(panel, SHEET_SYNCHRONIZATION_MODEL.HIRE_LABEL, 0);
    h.h.mouse = { ...sheet.GetPosition() };
    panel.OnBtnAddSheetPinsClicked();
    await flush();

    expect(dlg.IsShown()).toBe(false);
    expect(dlg.GetPlacementTemplate()?.GetText()).toBe('OUT');

    const at = { x: sheet.GetPosition().x, y: sheet.GetPosition().y + 6 * G };
    mouse(h, TA_MOUSE_MOTION, at);
    click(h, at);
    await flush();
    click(h, at);
    await flush();

    const placed = sheet.GetPins().filter((p) => p.GetText() === 'OUT');
    expect(placed).toHaveLength(1);
    expect(placed[0]!.GetShape()).toBe(LABEL_FLAG_SHAPE.L_OUTPUT);
    expect(dlg.CanPlaceMore()).toBe(false);
    expect(dlg.IsShown()).toBe(true);
    mgr.RunAction(ACTIONS.cancelInteractive);
  });
});
