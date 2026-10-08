// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * assign_footprints.cpp on the live model: SCH_EDITOR_CONTROL::AssignFootprints (CvPcb's
 * MAIL_ASSIGN_FOOTPRINTS) and ImportFPAssignments over a `.cmp` file; common/ptree.cpp's Scan.
 */
import { resolve } from 'node:path';
import { DSNLEXER } from '@ziroeda/common/dsnlexer.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { PTREE, PTREE_ERROR, Scan } from '@ziroeda/common/ptree.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import type { SINGLE_CHOICE_ARG } from '@ziroeda/eeschema/tools/assign_footprints.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_EDITOR_CONTROL } from '@ziroeda/eeschema/tools/sch_editor_control.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

const unmounts: (() => void)[] = [];
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  SetPgm(null);
  for (const u of unmounts.splice(0)) u();
});

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const mgr = h.frame.GetToolManager()!;
  const sheet = h.frame.Schematic().Hierarchy()[0]!;
  h.frame.SetCurrentSheet(sheet);
  const symbol = [...sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)].find(
    (s) => !(s as SCH_SYMBOL).GetRef(sheet).startsWith('#'),
  ) as SCH_SYMBOL;
  const ref = symbol.GetRef(sheet);
  const footprint = () => symbol.GetField(FIELD_T.FOOTPRINT)!.GetText();
  return { ...h, mgr, symbol, ref, footprint, editor: mgr.GetTool(SCH_EDITOR_CONTROL)! };
}

describe('ptree Scan', () => {
  it('reads lists into nodes keyed by their first token, atoms into empty nodes', () => {
    const doc = new PTREE();
    Scan(doc, new DSNLEXER('(cvpcb_netlist (ref "R1" (fpid "Lib:A")) (ref "R2" (fpid)))'));

    const anno = doc.get_child('cvpcb_netlist');
    const refs = [...anno].map(([k, t]) => [k, t.front()[0], t.get_child('fpid').size()]);
    expect(refs).toEqual([
      ['ref', 'R1', 1],
      ['ref', 'R2', 0],
    ]);
    expect(() => doc.get_child('nope')).toThrow(PTREE_ERROR);
  });
});

describe('Assign Footprints from CvPcb', () => {
  it('sets the footprint on the reference, as one undo step', () => {
    const h = setUp();
    const undo = h.frame.GetUndoCommandCount();

    h.editor.AssignFootprints(`(cvpcb_netlist (ref "${h.ref}" (fpid "Lib:Assigned")))`);

    expect(h.footprint()).toBe('Lib:Assigned');
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('a footprint field that was empty and shown is hidden when assigned', () => {
    const h = setUp();
    const field = h.symbol.GetField(FIELD_T.FOOTPRINT)!;
    field.SetText('');
    field.SetVisible(true);

    h.editor.AssignFootprints(`(cvpcb_netlist (ref "${h.ref}" (fpid "Lib:New")))`);

    expect(h.footprint()).toBe('Lib:New');
    expect(field.IsVisible()).toBe(false);
  });

  it('an unchanged footprint is no commit', () => {
    const h = setUp();
    h.editor.AssignFootprints(`(cvpcb_netlist (ref "${h.ref}" (fpid "Lib:Assigned")))`);
    const undo = h.frame.GetUndoCommandCount();

    h.editor.AssignFootprints(`(cvpcb_netlist (ref "${h.ref}" (fpid "Lib:Assigned")))`);

    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });

  it('a payload that is no cvpcb_netlist is an IO_ERROR', () => {
    const h = setUp();
    expect(() => h.editor.AssignFootprints('(something_else)')).toThrow(IO_ERROR);
  });

  it('MAIL_ASSIGN_FOOTPRINTS runs it', () => {
    const h = setUp();
    h.frame.KiwayMailIn(
      new KIWAY_MAIL_EVENT(FRAME_T.FRAME_SCH, MAIL_T.MAIL_ASSIGN_FOOTPRINTS, {
        value: `(cvpcb_netlist (ref "${h.ref}" (fpid "Lib:ByMail")))`,
      }),
    );
    expect(h.footprint()).toBe('Lib:ByMail');
  });
});

describe('Import Footprint Assignments', () => {
  function cmpDisk(aRef: string, aFootprint: string) {
    const fs = new MEMORY_FILESYSTEM();
    unmounts.push(wxMountFileSystem('/complex_hierarchy', fs));
    const text = [
      'Cmp-Mod V01 Created by CvPcb',
      '',
      'BeginCmp',
      'TimeStamp = /32307DE2/AA450F67;',
      `Reference = ${aRef};`,
      'ValeurCmp = 47uF;',
      `IdModule  = ${aFootprint};`,
      'EndCmp',
      '',
    ].join('\n');
    fs.Write('links.cmp', new TextEncoder().encode(text));
  }

  it('applies the .cmp footprints and the chosen visibility', async () => {
    const choices: SINGLE_CHOICE_ARG[] = [];
    const h = setUp({
      fileDialog: () => '/complex_hierarchy/links.cmp',
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog !== 'wxSingleChoiceDialog') return wxID_CANCEL;
        const arg = aArg as SINGLE_CHOICE_ARG;
        choices.push(arg);
        arg.selection = 1; // Show all footprint fields
        return wxID_OK;
      },
    });
    cmpDisk(h.ref, 'Lib:FromCmp');

    h.mgr.RunAction(SCH_ACTIONS.importFPAssignments);
    await flush();

    expect(choices[0]!.choices.length).toBe(3);
    expect(h.footprint()).toBe('Lib:FromCmp');
    expect(h.symbol.GetField(FIELD_T.FOOTPRINT)!.IsVisible()).toBe(true);
  });

  it('a file that cannot be read says so', async () => {
    const errors: string[] = [];
    const h = setUp({
      fileDialog: () => '/nowhere/links.cmp',
      showModal: () => wxID_OK,
      displayError: (m) => errors.push(m),
    });

    h.mgr.RunAction(SCH_ACTIONS.importFPAssignments);
    await flush();

    expect(errors).toEqual(["Failed to open symbol-footprint link file '/nowhere/links.cmp'."]);
  });
});
