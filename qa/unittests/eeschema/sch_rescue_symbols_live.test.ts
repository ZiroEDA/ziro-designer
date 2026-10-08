// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rescue Symbols on the live model: SCH_EDITOR_CONTROL::RescueSymbols (sch_editor_control.cpp:533)
 * and project_rescue.cpp's RESCUER, SYMBOL_LIB_TABLE_RESCUER and RESCUE_SYMBOL_LIB_TABLE_CANDIDATE,
 * with the project's library table and libraries on the mounted file system.
 *
 * Every candidate upstream finds needs the project's legacy `-cache.lib` (a library cannot even
 * hold the illegal names the other arm looks for - the parser refuses them), and that cache is
 * not a PROJECT element here yet, so the finder finds nothing. The rescue itself is driven with
 * the cache candidate the finder would make.
 */
import { resolve } from 'node:path';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { MEMORY_FILESYSTEM, wxFileExists, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import {
  type DIALOG_RESCUE_EACH_ARG,
  RESCUE_SYMBOL_LIB_TABLE_CANDIDATE,
  RESCUER,
  SYMBOL_LIB_TABLE_RESCUER,
} from '@ziroeda/eeschema/project_rescue.js';
import type { SCH_EDIT_FRAME, SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import type { KICAD_MESSAGE_DIALOG_ARG } from '@ziroeda/common/confirm.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

let unmount: () => void = () => {};

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  unmount = wxMountFileSystem('/complex_hierarchy', new MEMORY_FILESYSTEM());
});
afterEach(() => {
  unmount();
  SetPgm(null);
});

const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A project library table with 'mylib' and the project's schematic open. */
function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);

  new SCH_IO_KICAD_SEXPR().CreateLibrary('/complex_hierarchy/mylib.kicad_sym');

  Pgm()
    .GetLibraryManager()
    .SetTable(
      LIBRARY_TABLE_TYPE.SYMBOL,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE.FromFile(
        '/complex_hierarchy/sym-lib-table',
        '(sym_lib_table (version 7) (lib (name "mylib")(type "KiCad")(uri "${KIPRJMOD}/mylib.kicad_sym")(options "")(descr "")))',
        LIBRARY_TABLE_SCOPE.PROJECT,
        LIBRARY_TABLE_TYPE.SYMBOL,
      ),
    );

  const symbol = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)][0] as SCH_SYMBOL;
  return { ...h, mgr: h.frame.GetToolManager()!, symbol };
}

/**
 * The rescuer as the cache would feed it: the symbol's id found only in `-cache.lib`, so
 * FindRescues makes the "found only in cache library" candidate.
 */
class CACHED_RESCUER extends SYMBOL_LIB_TABLE_RESCUER {
  constructor(
    aFrame: SCH_EDIT_FRAME,
    private readonly m_requested: LIB_ID,
    private readonly m_cached: LIB_SYMBOL,
  ) {
    super(aFrame.Prj(), aFrame.Schematic(), aFrame.GetCurrentSheet());
  }

  override FindCandidates(): void {
    const newId = new LIB_ID(
      'complex_hierarchy-rescue',
      `${this.m_requested.GetLibItemName()}-mylib`,
    );
    this.m_all_candidates.push(
      new RESCUE_SYMBOL_LIB_TABLE_CANDIDATE(this.m_requested, newId, this.m_cached, null, 1, 1),
      // A duplicate of the same request: RemoveDuplicates keeps the first.
      new RESCUE_SYMBOL_LIB_TABLE_CANDIDATE(this.m_requested, newId, this.m_cached, null, 1, 1),
    );
  }
}

function rescuer(h: ReturnType<typeof setUp>) {
  const requested = new LIB_ID('mylib', 'GONE');
  h.symbol.SetLibId(requested);
  const cached = LIB_SYMBOL.copyOf(h.symbol.GetLibSymbolRef()!);
  return new CACHED_RESCUER(h.frame, requested, cached);
}

describe('Rescue Symbols', () => {
  it('with no -cache.lib there is nothing to rescue, and on demand it says so', async () => {
    const messages: string[] = [];
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog === 'KICAD_MESSAGE_DIALOG')
          messages.push((aArg as KICAD_MESSAGE_DIALOG_ARG).message);
        return wxID_OK;
      },
    });
    h.symbol.SetLibId(new LIB_ID('mylib', 'GONE'));

    h.mgr.RunAction(SCH_ACTIONS.rescueSymbols);
    await flush();

    expect(messages).toEqual(['This project has nothing to rescue.']);
    expect(h.symbol.GetLibId().Format()).toBe('mylib:GONE');
  });

  it('a cache-only symbol is offered once, rescued into <project>-rescue, added to the table and relinked', async () => {
    let offered: string[] = [];
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog === 'DIALOG_RESCUE_EACH')
          offered = (aArg as DIALOG_RESCUE_EACH_ARG).candidates.map((c) =>
            c.GetActionDescription(),
          );
        return wxID_OK;
      },
    });
    const r = rescuer(h);

    expect(await RESCUER.RescueProject(h.frame, r, true)).toBe(true);

    expect(offered).toEqual([
      'Rescue symbol mylib:GONE found only in cache library to complex_hierarchy-rescue:GONE-mylib.',
    ]);
    expect(h.symbol.GetLibId().Format()).toBe('complex_hierarchy-rescue:GONE-mylib');
    expect(wxFileExists('/complex_hierarchy/complex_hierarchy-rescue.kicad_sym')).toBe(true);

    const table = Pgm()
      .GetLibraryManager()
      .Table(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.PROJECT)!;
    expect(table.Row('complex_hierarchy-rescue')?.URI()).toBe(
      '${KIPRJMOD}/complex_hierarchy-rescue.kicad_sym',
    );
    expect(table.Row('complex_hierarchy-rescue')?.Type()).toBe('KiCad');

    // The relinked symbol found its library symbol in the rescue library.
    expect(h.symbol.GetLibSymbolRef()?.GetName()).toBe('GONE-mylib');
  });

  it('unchecking the candidate rescues nothing and says so', async () => {
    const messages: string[] = [];
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog === 'DIALOG_RESCUE_EACH') {
          (aArg as DIALOG_RESCUE_EACH_ARG).chosen[0] = false;
          return wxID_OK;
        }
        messages.push((aArg as KICAD_MESSAGE_DIALOG_ARG).message);
        return wxID_OK;
      },
    });
    const r = rescuer(h);

    expect(await RESCUER.RescueProject(h.frame, r, true)).toBe(true);

    expect(messages).toEqual(['No symbols were rescued.']);
    expect(h.symbol.GetLibId().Format()).toBe('mylib:GONE');
    expect(wxFileExists('/complex_hierarchy/complex_hierarchy-rescue.kicad_sym')).toBe(false);
  });

  it('Cancel rescues nothing', async () => {
    const h = setUp({
      showModal: (aDialog) => (aDialog === 'DIALOG_RESCUE_EACH' ? wxID_CANCEL : wxID_OK),
    });
    const r = rescuer(h);

    await RESCUER.RescueProject(h.frame, r, true);

    expect(h.symbol.GetLibId().Format()).toBe('mylib:GONE');
    expect(r.GetChosenCandidateCount()).toBe(0);
  });

  it('a second rescue keeps what the rescue library already held', async () => {
    const h = setUp({ showModal: () => wxID_OK });

    await RESCUER.RescueProject(h.frame, rescuer(h), true);

    const other = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)][1] as SCH_SYMBOL;
    const requested = new LIB_ID('mylib', 'LOST');
    other.SetLibId(requested);
    const second = new CACHED_RESCUER(
      h.frame,
      requested,
      LIB_SYMBOL.copyOf(other.GetLibSymbolRef()!),
    );

    expect(await RESCUER.RescueProject(h.frame, second, true)).toBe(true);

    const names: string[] = [];
    new SCH_IO_KICAD_SEXPR().EnumerateSymbolLib(
      names,
      '/complex_hierarchy/complex_hierarchy-rescue.kicad_sym',
    );
    expect(names.sort()).toEqual(['GONE-mylib', 'LOST-mylib']);
  });

  it('with nothing to rescue, RescueSymbolLibTableProject leaves the schematic unmodified', async () => {
    const h = setUp({ showModal: () => wxID_OK });
    h.symbol.SetLibId(new LIB_ID('mylib', 'GONE'));
    h.frame.GetScreen()!.SetContentModified(false);

    const control = h.mgr.GetTool(
      (await import('@ziroeda/eeschema/tools/sch_editor_control.js')).SCH_EDITOR_CONTROL,
    )!;
    expect(await control.RescueSymbolLibTableProject(true)).toBe(true);
    expect(h.frame.GetScreen()!.IsContentModified()).toBe(false);
  });
});
