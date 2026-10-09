// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_FIELD_PROPERTIES (dialog_field_properties.cpp) on live fields, opened by
 * SCH_EDIT_TOOL::editFieldText: the caption the tool builds, UpdateField on the tool's commit (one
 * undo step), the reference set per sheet, the FIELD_VALIDATOR refusal, positioning clearing the
 * autoplaced flag, and the symbol netlist handed to the footprint chooser.
 */
import { resolve } from 'node:path';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { DIALOG_FIELD_PROPERTIES } from '@ziroeda/eeschema/dialogs/dialog_field_properties.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { AUTOPLACE_ALGO } from '@ziroeda/eeschema/sch_item.js';
import { SCH_LABEL } from '@ziroeda/eeschema/sch_label.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

const HOST: GRID_TEXT_BUTTON_HOST = {
  ChooseFootprint: () => Promise.resolve(null),
  OpenFile: () => Promise.resolve(null),
  OpenDocument: () => {},
};

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const sub = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 2)!;
  h.frame.SetCurrentSheet(sub);
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  const select = (...items: EDA_ITEM[]) => {
    sel.ClearSelection(true);
    for (const i of items) sel.AddItemToSel(i, true);
  };
  const sym = ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]).find(
    (s) => !s.GetLibSymbolRef()?.IsPower(),
  )!;
  return { ...h, mgr, select, sym, screen: h.frame.GetScreen()! };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** What the window does on OK: TransferDataFromWindow, then UpdateField on the tool's commit. */
function answer(
  h: { frame: ReturnType<typeof schFrame> },
  aEdit: (v: ReturnType<DIALOG_FIELD_PROPERTIES['TransferDataToWindow']>) => object,
  aSeen: string[] = [],
): NonNullable<SCH_EDIT_FRAME_HOOKS['showModal']> {
  return (aDialog, aItems, aArg) => {
    const { caption, commit } = aArg as { caption: string; commit: SCH_COMMIT };
    aSeen.push(`${aDialog} ${caption}`);
    const field = aItems[0] as SCH_FIELD;
    const dlg = new DIALOG_FIELD_PROPERTIES(h.frame, caption, field, HOST);
    const shown = dlg.TransferDataToWindow();
    if (!dlg.TransferDataFromWindow({ ...shown, ...aEdit(shown) })) return 0;
    dlg.UpdateField(commit, field, h.frame.GetCurrentSheet());
    return wxID_OK;
  };
}

describe('DIALOG_FIELD_PROPERTIES', () => {
  it('opens on Edit Value with the title-cased caption and writes the value as one undo step', async () => {
    const seen: string[] = [];
    let show: NonNullable<SCH_EDIT_FRAME_HOOKS['showModal']> = () => 0;
    const h = setUp({ showModal: (d, i, a) => show(d, i, a) });
    show = answer(h, () => ({ text: '22k' }), seen);
    const undo = h.frame.GetUndoCommandCount();

    h.select(h.sym);
    h.mgr.RunAction(SCH_ACTIONS.editValue);
    await flush();

    expect(seen).toEqual(['DIALOG_FIELD_PROPERTIES Edit Value Field']);
    expect(h.sym.GetField(FIELD_T.VALUE)!.GetText()).toBe('22k');
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('quotes a user field’s name in the caption, and labels the entry with it', async () => {
    const seen: string[] = [];
    let show: NonNullable<SCH_EDIT_FRAME_HOOKS['showModal']> = () => 0;
    const h = setUp({ showModal: (d, i, a) => show(d, i, a) });
    const label = new SCH_LABEL({ x: 0, y: 0 }, 'L');
    const mpn = new SCH_FIELD(label, FIELD_T.USER, 'MPN');
    label.SetFields([mpn]);
    h.frame.AddToScreen(label, h.screen);
    show = answer(h, () => ({ text: 'RC0402' }), seen);

    h.select(label.GetFields()[0]!);
    h.mgr.RunAction(SCH_ACTIONS.properties);
    await flush();

    expect(seen).toEqual(["DIALOG_FIELD_PROPERTIES Edit 'MPN' Field"]);
    expect(label.GetFields()[0]!.GetText()).toBe('RC0402');
    expect(new DIALOG_FIELD_PROPERTIES(h.frame, '', label.GetFields()[0]!, HOST).m_label).toBe(
      'MPN:',
    );
  });

  it('sets the reference for the current sheet only', async () => {
    let show: NonNullable<SCH_EDIT_FRAME_HOOKS['showModal']> = () => 0;
    const h = setUp({ showModal: (d, i, a) => show(d, i, a) });
    show = answer(h, () => ({ text: 'R99' }));
    const sheet = h.frame.GetCurrentSheet();
    const other = h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2 && p.Path().AsString() !== sheet.Path().AsString());
    const otherRef = other ? h.sym.GetRef(other) : null;

    h.select(h.sym);
    h.mgr.RunAction(SCH_ACTIONS.editReference);
    await flush();

    expect(h.sym.GetRef(sheet)).toBe('R99');
    if (other) expect(h.sym.GetRef(other)).toBe(otherRef);
  });

  it('refuses an empty reference with FIELD_VALIDATOR’s message and changes nothing', async () => {
    const error = vi.fn();
    SetErrorPresenter(error);
    let show: NonNullable<SCH_EDIT_FRAME_HOOKS['showModal']> = () => 0;
    const h = setUp({ showModal: (d, i, a) => show(d, i, a) });
    show = answer(h, () => ({ text: '' }));
    const before = h.sym.GetRef(h.frame.GetCurrentSheet());
    const undo = h.frame.GetUndoCommandCount();

    h.select(h.sym);
    h.mgr.RunAction(SCH_ACTIONS.editReference);
    await flush();

    expect(error).toHaveBeenCalledWith('The value of the field cannot be empty.', '');
    expect(h.sym.GetRef(h.frame.GetCurrentSheet())).toBe(before);
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });

  it('moving a field clears its parent’s autoplaced flag; leaving it alone does not', () => {
    const h = setUp();
    const field = h.sym.GetField(FIELD_T.VALUE)!;
    h.sym.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_AUTO);

    const keep = new DIALOG_FIELD_PROPERTIES(h.frame, '', field, HOST);
    keep.TransferDataFromWindow(keep.TransferDataToWindow());
    keep.UpdateField(new SCH_COMMIT(h.frame), field, h.frame.GetCurrentSheet());
    expect(h.sym.GetFieldsAutoplaced()).toBe(AUTOPLACE_ALGO.AUTOPLACE_AUTO);

    const move = new DIALOG_FIELD_PROPERTIES(h.frame, '', field, HOST);
    const shown = move.TransferDataToWindow();
    move.TransferDataFromWindow({ ...shown, posX: '1000' });
    move.UpdateField(new SCH_COMMIT(h.frame), field, h.frame.GetCurrentSheet());
    expect(h.sym.GetFieldsAutoplaced()).toBe(AUTOPLACE_ALGO.AUTOPLACE_NONE);
    expect(field.GetPosition().x).toBe(10000000);
  });

  it('shows the footprint button only on the footprint field, and hands the chooser the netlist', async () => {
    const h = setUp();
    const chosen: [string, string][] = [];
    const host = {
      ...HOST,
      ChooseFootprint: (aFpid: string, aNetlist: string) => {
        chosen.push([aFpid, aNetlist]);
        return Promise.resolve('Lib:Fp');
      },
    };
    const fp = new DIALOG_FIELD_PROPERTIES(h.frame, '', h.sym.GetField(FIELD_T.FOOTPRINT)!, host);

    expect(fp.m_showSelectButton).toBe(true);
    expect(
      new DIALOG_FIELD_PROPERTIES(h.frame, '', h.sym.GetField(FIELD_T.VALUE)!, host)
        .m_showSelectButton,
    ).toBe(false);
    expect(await fp.OnTextValueSelectButtonClick('x')).toBe('Lib:Fp');
    // D_Small in the fixture: pins 1 "K" and 2 "A", and its ki_fp_filters joined by spaces.
    expect(chosen).toEqual([
      ['x', '1 K\t2 A\rDiode_* D-Pak_TO252AA *SingleDiode *SingleDiode* *_Diode_*\r'],
    ]);
  });
});
