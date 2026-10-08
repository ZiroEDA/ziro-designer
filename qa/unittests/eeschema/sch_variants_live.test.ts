// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Design variants on the live model: the toolbar's variant choice (toolbars_sch_editor.cpp:
 * UpdateVariantSelectionCtrl, onVariantSelected, ShowAddVariantDialog, SetCurrentVariant) and
 * SCH_EDITOR_CONTROL's Add / Remove / Edit Description (sch_edit_frame.cpp:3060-3170).
 */
import { resolve } from 'node:path';
import type { WX_INFOBAR } from '@ziroeda/common/eda_base_frame.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { GetDefaultVariantName } from '@ziroeda/common/string_utils.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import type {
  NEW_VARIANT_DIALOG_ARG,
  SCH_EDIT_FRAME_HOOKS,
  VARIANT_CHOICE,
  VARIANT_DESCRIPTION_DIALOG_ARG,
} from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SINGLE_CHOICE_ARG } from '@ziroeda/eeschema/tools/assign_footprints.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A wxChoice: its items and its selection. */
function choice(): VARIANT_CHOICE & { items: string[] } {
  let selection = -1;
  const c = {
    items: [] as string[],
    GetSelection: () => selection,
    SetSelection: (i: number) => {
      selection = i;
    },
    GetString: (i: number) => c.items[i] ?? '',
    GetCount: () => c.items.length,
    FindString: (s: string) => c.items.indexOf(s),
    Set: (aItems: readonly string[]) => {
      c.items = [...aItems];
      selection = -1;
    },
  };
  return c;
}

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const messages: string[] = [];
  const infoBar: WX_INFOBAR = {
    IsLocked: () => false,
    AddButton: () => {},
    RemoveAllButtons: () => {},
    ShowMessageFor: (m) => {
      messages.push(m);
    },
    Dismiss: () => {},
  };
  h.frame.SetInfoBar(infoBar);
  const ctrl = choice();
  h.frame.SetVariantSelectCtrl(ctrl);
  h.frame.UpdateVariantSelectionCtrl(h.frame.Schematic().GetVariantNamesForUI());
  return { ...h, mgr: h.frame.GetToolManager()!, ctrl, messages };
}

describe('design variants', () => {
  it('the control lists the variants, a separator and "Add New Design Variant..."', () => {
    const h = setUp();
    expect(h.ctrl.items).toEqual([GetDefaultVariantName(), '---', 'Add New Design Variant...']);
    expect(h.ctrl.GetSelection()).toBe(0);
  });

  it('Add Variant asks for a name and description, adds it and selects it', async () => {
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog !== 'NEW_DESIGN_VARIANT') return wxID_CANCEL;
        const arg = aArg as NEW_VARIANT_DIALOG_ARG;
        arg.name = '  Low cost ';
        arg.description = ' no LEDs ';
        return wxID_OK;
      },
    });

    h.mgr.RunAction(SCH_ACTIONS.addVariant);
    await flush();

    const s = h.frame.Schematic();
    expect(s.GetVariantNames()).toEqual(['Low cost']);
    expect(s.GetVariantDescription('Low cost')).toBe('no LEDs');
    expect(s.GetCurrentVariant()).toBe('Low cost');
    expect(h.ctrl.GetString(h.ctrl.GetSelection())).toBe('Low cost');
    expect(h.frame.GetScreen()!.IsContentModified()).toBe(true);
  });

  it('an empty, reserved or duplicate name is refused with a message', async () => {
    let name = '';
    const h = setUp({
      showModal: (_aDialog, _aItems, aArg) => {
        (aArg as NEW_VARIANT_DIALOG_ARG).name = name;
        return wxID_OK;
      },
    });

    for (const n of ['   ', GetDefaultVariantName().toUpperCase(), 'A', 'a']) {
      name = n;
      expect(await h.frame.ShowAddVariantDialog()).toBe(n === 'A');
    }

    expect(h.messages).toEqual([
      'Variant name cannot be empty.',
      `'${GetDefaultVariantName()}' is a reserved variant name.`,
      "Variant 'A' already exists.",
    ]);
  });

  it('choosing a variant in the control makes it current; the separator changes nothing', async () => {
    const h = setUp();
    h.frame.Schematic().AddVariant('B');
    h.frame.UpdateVariantSelectionCtrl(h.frame.Schematic().GetVariantNamesForUI());

    h.ctrl.SetSelection(h.ctrl.FindString('B'));
    await h.frame.onVariantSelected();
    expect(h.frame.Schematic().GetCurrentVariant()).toBe('B');

    h.ctrl.SetSelection(h.ctrl.GetCount() - 2);
    await h.frame.onVariantSelected();
    expect(h.frame.Schematic().GetCurrentVariant()).toBe('B');
    expect(h.ctrl.GetString(h.ctrl.GetSelection())).toBe('B');
  });

  it('Remove Variant offers every variant but the default, and removes the chosen one', async () => {
    let offered: readonly string[] = [];
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog !== 'wxSingleChoiceDialog') return wxID_CANCEL;
        const arg = aArg as SINGLE_CHOICE_ARG;
        offered = arg.choices;
        arg.selection = arg.choices.indexOf('B');
        return wxID_OK;
      },
    });
    const s = h.frame.Schematic();
    s.AddVariant('A');
    s.AddVariant('B');
    h.frame.UpdateVariantSelectionCtrl(s.GetVariantNamesForUI());
    h.frame.SetCurrentVariant('B');

    h.mgr.RunAction(SCH_ACTIONS.removeVariant);
    await flush();

    expect(offered).toEqual(['A', 'B']);
    expect(s.GetVariantNames()).toEqual(['A']);
    expect(s.GetCurrentVariant()).toBe('');
    expect(h.ctrl.items).toEqual([
      GetDefaultVariantName(),
      'A',
      '---',
      'Add New Design Variant...',
    ]);
  });

  it('Edit Variant Description edits the chosen one; with no variants it says so', async () => {
    let titles: string[] = [];
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog === 'wxSingleChoiceDialog') {
          (aArg as SINGLE_CHOICE_ARG).selection = 0;
          return wxID_OK;
        }
        const arg = aArg as VARIANT_DESCRIPTION_DIALOG_ARG;
        titles.push(arg.title);
        arg.description = ' updated ';
        return wxID_OK;
      },
    });

    h.mgr.RunAction(SCH_ACTIONS.editVariantDescription);
    await flush();
    expect(h.messages).toEqual(['No design variants to edit.']);

    h.frame.Schematic().AddVariant('A');
    titles = [];
    h.mgr.RunAction(SCH_ACTIONS.editVariantDescription);
    await flush();

    expect(titles).toEqual(["Edit Description for 'A'"]);
    expect(h.frame.Schematic().GetVariantDescription('A')).toBe('updated');
  });
});
