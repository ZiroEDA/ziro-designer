// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_FRAME's sheet operations on the live model (sheet.cpp): InitSheet, ChangeSheetFile,
 * CheckSheetForRecursion and AllowCaseSensitiveFileNameClashes, on KiCad's complex_hierarchy.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  EESCHEMA_DEFAULTS,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  SetPgm(null);
  setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS);
});

function openFrame(hooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const asked: string[] = [];
  const errors: string[] = [];
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    highlightNet: () => {},
    syncSelection: () => {},
    assignFootprints: () => {},
    saveProject: () => true,
    isOK: (m) => {
      asked.push(m);
      return true;
    },
    displayError: (m) => errors.push(m),
    ...hooks,
  });
  frame.OpenProjectFiles([`/complex_hierarchy/${SHEETS[0]}`], 0, (p) => {
    const n = SHEETS.find((s) => p === `/complex_hierarchy/${s}`);
    return n ? readFileSync(join(ORACLE, n), 'utf8') : null;
  });
  return { frame, asked, errors };
}

/** A sheet just drawn: no screen yet, as SCH_DRAWING_TOOLS::DrawSheet makes it. */
const drawnSheet = (frame: SCH_EDIT_FRAME) => {
  const sheet = new SCH_SHEET(frame.GetCurrentSheet().Last(), { x: 0, y: 0 });
  sheet.SetScreen(null);
  return sheet;
};

describe('SCH_EDIT_FRAME::ChangeSheetFile', () => {
  it('gives a new sheet a new, empty screen for a new file beside its parent', () => {
    const { frame, asked } = openFrame();
    const sheet = drawnSheet(frame);
    expect(frame.ChangeSheetFile(sheet, 'power.kicad_sch')).toBe(true);
    expect(sheet.GetScreen()!.GetFileName()).toBe('/complex_hierarchy/power.kicad_sch');
    expect(sheet.GetScreen()!.Items().size()).toBe(0);
    expect(asked).toEqual([]);
  });

  it('copies only what the export settings ask for into the new title block (InitSheet)', () => {
    const { frame } = openFrame();
    frame.GetScreen()!.GetTitleBlock().SetTitle('Parent title');
    setEeschemaSettingsProvider(() => ({
      ...EESCHEMA_DEFAULTS,
      page_settings: { ...EESCHEMA_DEFAULTS.page_settings, export_title: true },
    }));
    const sheet = drawnSheet(frame);
    frame.ChangeSheetFile(sheet, 'power.kicad_sch');
    const tb = sheet.GetScreen()!.GetTitleBlock();
    expect(tb.GetTitle()).toBe(frame.GetScreen()!.GetTitleBlock().GetTitle());
    expect(tb.GetRevision()).toBe('');
  });

  it('asks before linking a file the hierarchy already has, then shares its screen', () => {
    const { frame, asked } = openFrame();
    const existing = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!
      .LastScreen()!;
    const sheet = drawnSheet(frame);
    expect(frame.ChangeSheetFile(sheet, 'ampli_ht.kicad_sch')).toBe(true);
    expect(asked[0]).toMatch(
      /^'ampli_ht\.kicad_sch' already exists\.\n\nLink '\/complex_hierarchy\/ampli_ht\.kicad_sch' to this file\?$/,
    );
    expect(sheet.GetScreen()).toBe(existing);
  });

  it('does nothing when the user declines to link the existing file', () => {
    const { frame } = openFrame({ isOK: () => false });
    const sheet = drawnSheet(frame);
    expect(frame.ChangeSheetFile(sheet, 'ampli_ht.kicad_sch')).toBe(false);
    expect(sheet.GetScreen()).toBe(null);
  });

  it('refuses to link a parent file into its own subsheet (recursion)', () => {
    const { frame, errors } = openFrame();
    const sub = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!;
    frame.Schematic().SetCurrentSheet(sub);
    const sheet = drawnSheet(frame);
    expect(frame.ChangeSheetFile(sheet, 'complex_hierarchy.kicad_sch')).toBe(false);
    expect(errors[0]).toMatch(
      /^The sheet changes cannot be made because the destination sheet already has the sheet/,
    );
  });

  it('asks about a name that differs only in case from one beside it', () => {
    const { frame, asked } = openFrame();
    const sheet = drawnSheet(frame);
    frame.ChangeSheetFile(sheet, 'Ampli_HT.kicad_sch');
    expect(asked[0]).toMatch(
      /^The file name 'Ampli_HT' can cause issues with an existing file name\n/,
    );
  });

  it('does not ask about case when that warning is turned off', () => {
    setEeschemaSettingsProvider(() => ({
      ...EESCHEMA_DEFAULTS,
      appearance: {
        ...EESCHEMA_DEFAULTS.appearance,
        show_sheet_filename_case_sensitivity_dialog: false,
      },
    }));
    const { frame, asked } = openFrame();
    const sheet = drawnSheet(frame);
    expect(frame.ChangeSheetFile(sheet, 'Ampli_HT.kicad_sch')).toBe(true);
    expect(asked).toEqual([]);
  });

  it('renames an existing, unshared sheet file in place and marks it not undoable', () => {
    const { frame } = openFrame();
    const sheet = drawnSheet(frame);
    frame.ChangeSheetFile(sheet, 'power.kicad_sch');
    const undoable = { value: true };
    expect(frame.ChangeSheetFile(sheet, 'supply.kicad_sch', null, undoable)).toBe(true);
    expect(sheet.GetScreen()!.GetFileName()).toBe('/complex_hierarchy/supply.kicad_sch');
    expect(undoable.value).toBe(false);
    expect(sheet.Type()).toBe(KICAD_T.SCH_SHEET_T);
  });
});

describe('SCH_SHEET_PATH::TestForRecursion', () => {
  it('compares a relative sheet file name with an absolute screen path (sch_sheet_path.cpp:700)', () => {
    const { frame } = openFrame();
    const sub = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!;
    // The sub-sheet's own file field is relative ("ampli_ht.kicad_sch"); the destination is the
    // absolute screen path. Linking the root's file under it recurses.
    expect(sub.Last()!.GetFileName()).toBe('ampli_ht.kicad_sch');
    expect(
      sub.TestForRecursion('complex_hierarchy.kicad_sch', '/complex_hierarchy/ampli_ht.kicad_sch'),
    ).toBe(true);
    // A file that is not a parent does not.
    expect(sub.TestForRecursion('other.kicad_sch', '/complex_hierarchy/ampli_ht.kicad_sch')).toBe(
      false,
    );
  });
});
