// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_FRAME::LoadSheetFromFile (sheet.cpp:412) on the live model: a schematic file from the
 * mounted project loaded into a sheet, with the library-link questions and failures upstream has.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import type { KICAD_MESSAGE_DIALOG_ARG } from '@ziroeda/common/confirm.js';
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

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const fs = new MEMORY_FILESYSTEM();
  fs.Write('ampli_ht.kicad_sch', new Uint8Array(readFileSync(join(ORACLE, 'ampli_ht.kicad_sch'))));
  fs.Write('other.kicad_sch', new Uint8Array(readFileSync(join(ORACLE, 'ampli_ht.kicad_sch'))));
  unmounts.push(wxMountFileSystem('/complex_hierarchy', fs));
  return h;
}

const OLD_VERSION =
  'There are hierarchical sheets in the loaded schematic file from an older file version';
const MISSING_LIBS =
  'There are library names in the selected schematic that are missing from the current project library table.';

describe('LoadSheetFromFile', () => {
  it('a schematic already in the project loads after only the old-file-version warning', async () => {
    const asked: string[] = [];
    const h = setUp({
      showModal: (_aDialog, _aItems, aArg) => {
        asked.push((aArg as KICAD_MESSAGE_DIALOG_ARG).message);
        return wxID_OK;
      },
    });
    const sheet = new SCH_SHEET(h.frame.Schematic());

    const ok = await h.frame.LoadSheetFromFile(
      sheet,
      h.frame.GetCurrentSheet(),
      '/complex_hierarchy/ampli_ht.kicad_sch',
      true,
    );

    expect(ok).toBe(true);
    expect([...sheet.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)].length).toBeGreaterThan(0);
    expect(asked.length).toBe(1);
    expect(asked[0]!.startsWith(OLD_VERSION)).toBe(true);
  });

  it('declining the warning loads nothing', async () => {
    const h = setUp({ showModal: () => wxID_CANCEL });
    const sheet = new SCH_SHEET(h.frame.Schematic());

    const ok = await h.frame.LoadSheetFromFile(
      sheet,
      h.frame.GetCurrentSheet(),
      '/complex_hierarchy/ampli_ht.kicad_sch',
      true,
    );

    expect(ok).toBe(false);
    expect(sheet.GetScreen()).toBeNull();
  });

  it('a schematic from outside the project also asks about its missing libraries, unless that check is skipped', async () => {
    const asked: string[] = [];
    const h = setUp({
      showModal: (_aDialog, _aItems, aArg) => {
        asked.push((aArg as KICAD_MESSAGE_DIALOG_ARG).message);
        return wxID_OK;
      },
    });

    await h.frame.LoadSheetFromFile(
      new SCH_SHEET(h.frame.Schematic()),
      h.frame.GetCurrentSheet(),
      '/complex_hierarchy/other.kicad_sch',
      true,
    );
    expect(asked.map((m) => m.slice(0, 40))).toEqual([
      OLD_VERSION.slice(0, 40),
      MISSING_LIBS.slice(0, 40),
    ]);

    asked.length = 0;
    await h.frame.LoadSheetFromFile(
      new SCH_SHEET(h.frame.Schematic()),
      h.frame.GetCurrentSheet(),
      '/complex_hierarchy/other.kicad_sch',
      true,
      true,
    );
    expect(asked.map((m) => m.slice(0, 40))).toEqual([OLD_VERSION.slice(0, 40)]);
  });

  it('a file that cannot be read asks to use a partial schematic; No loads nothing', async () => {
    const errors: { caption: string; extended?: string }[] = [];
    const h = setUp({
      showModal: (_aDialog, _aItems, aArg) => {
        errors.push(aArg as KICAD_MESSAGE_DIALOG_ARG);
        return wxID_CANCEL;
      },
    });
    const sheet = new SCH_SHEET(h.frame.Schematic());

    const ok = await h.frame.LoadSheetFromFile(
      sheet,
      h.frame.GetCurrentSheet(),
      '/complex_hierarchy/missing.kicad_sch',
      true,
    );

    expect(ok).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0]!.caption).toBe('Schematic Load Error');
    expect(errors[0]!.extended).toContain(
      "Failed to open file '/complex_hierarchy/missing.kicad_sch'.",
    );
  });
});
