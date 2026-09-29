// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_IMPORT_RECONCILER` (`pcbnew/footprint_import_reconciler.cpp`, new
 * in 10.0.6), after `qa/tests/pcbnew/test_footprint_import_reconciler.cpp`.
 *
 * KiCad's test imports an Eagle and an Altium board to get footprints whose
 * FPIDs have empty or unregistered nicknames; those importers are not ported,
 * so the boards here are `.kicad_pcb` text with the same FPID shapes, and the
 * adapter is a real one over a real `LIBRARY_TABLE` and an in-memory
 * project directory: `.pretty` folders are `.kicad_mod` files under the mount,
 * `FootprintExists` looks there, and the project table is saved through the
 * same mount.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { IMPORT_PROJ_PROPS } from '@ziroeda/common/import_proj_properties.js';
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_WARNING, Reporter } from '@ziroeda/common/reporter.js';
import {
  MEMORY_FILESYSTEM,
  wxDirExists,
  wxFileExists,
  wxMountFileSystem,
  wxReadFileSync,
} from '@ziroeda/common/wx/filefn.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import {
  FOOTPRINT_IMPORT_RECONCILER,
  type FOOTPRINT_LIBRARY_IO,
  KICAD_SEXPR_FOOTPRINT_LIBRARY_IO,
} from '@ziroeda/pcbnew/footprint_import_reconciler.js';
import type {
  FOOTPRINT_LIBRARY_ADAPTER,
  LIBRARY_TABLE_ROW,
} from '@ziroeda/pcbnew/footprint_library_adapter.js';
import {
  ParseBoard,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const DIR = '/fpreconcile-qa';
const TABLE_PATH = `${DIR}/fp-lib-table`;

let seq = 0;
const U = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;

/** A footprint of `pads` pads, named `fpid` (`Lib:Name` or a bare name). */
const footprintText = (fpid: string, ref = 'R1', pads = 2): string =>
  `(footprint "${fpid}" (layer "F.Cu") (uuid "${U()}") (at 10 10)
    (property "Reference" "${ref}" (at 0 -2 0) (layer "F.SilkS") (uuid "${U()}"))
    (property "Value" "v" (at 0 2 0) (layer "F.Fab") (uuid "${U()}"))
    ${Array.from({ length: pads }, (_, i) => `(pad "${i + 1}" smd rect (at ${i * 2} 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste") (uuid "${U()}"))`).join('\n    ')})`;

const boardOf = (...fpids: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
    (31 "F.CrtYd" user "F.Courtyard") (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  ${fpids.map((f, i) => footprintText(f, `R${i + 1}`)).join('\n  ')}
)`);

const def = (fpid: string, pads = 2): FOOTPRINT =>
  ParseFootprintFile(footprintText(fpid, 'REF', pads));

/** The adapter the reconciler asks: a real table, and a mount for the `.pretty` folders. */
class ProjectAdapter implements FOOTPRINT_LIBRARY_ADAPTER {
  readonly table: LIBRARY_TABLE;
  readonly loaded: string[] = [];
  hasTable = true;

  constructor(aTableText = '(fp_lib_table (version 7))') {
    this.table = LIBRARY_TABLE.FromFile(
      TABLE_PATH,
      aTableText,
      LIBRARY_TABLE_SCOPE.PROJECT,
      LIBRARY_TABLE_TYPE.FOOTPRINT,
    );
  }

  GetRow(aNickname: string): LIBRARY_TABLE_ROW | null {
    const row = this.table.Row(aNickname);

    if (!row) return null;

    return {
      nickname: row.Nickname(),
      uri: row.URI(),
      type: row.Type(),
      enabled: !row.Disabled(),
      GetOptionsMap: () => row.GetOptionsMap(),
    };
  }

  HasLibrary(aNickname: string): boolean {
    return this.table.HasRow(aNickname);
  }

  IsLibraryLoaded(aNickname: string): boolean {
    return this.loaded.includes(aNickname);
  }

  /** The row's `${KIPRJMOD}/x.pretty` under the project directory. */
  private libDir(aNickname: string): string | null {
    const row = this.table.Row(aNickname);

    return row ? row.URI().replace('${KIPRJMOD}', DIR) : null;
  }

  FootprintExists(aNickname: string, aName: string): boolean {
    const dir = this.libDir(aNickname);

    return dir !== null && wxFileExists(`${dir}/${aName}.kicad_mod`);
  }

  LoadOne(aNickname: string): void {
    this.loaded.push(aNickname);
  }

  ProjectTable(): LIBRARY_TABLE | null {
    return this.hasTable ? this.table : null;
  }

  LoadFootprint(): FOOTPRINT | null {
    return null;
  }

  GetFullURI(aRow: LIBRARY_TABLE_ROW): string {
    return aRow.uri.replace('${KIPRJMOD}', DIR);
  }
}

let unmount: (() => void) | null = null;
let fs: MEMORY_FILESYSTEM;

function project(aTableText?: string): ProjectAdapter {
  fs = new MEMORY_FILESYSTEM();
  // a project directory exists once a file is in it
  fs.Write('fp-lib-table', new Uint8Array([32]));
  unmount?.();
  unmount = wxMountFileSystem(DIR, fs);

  return new ProjectAdapter(aTableText);
}

/** A source library `aNick` holding footprints `aNames` (a `.pretty` under the project). */
function addSourceLibrary(aAdapter: ProjectAdapter, aNick: string, aNames: string[]): void {
  const row = aAdapter.table.InsertRow();
  row.SetNickname(aNick);
  row.SetURI(`\${KIPRJMOD}/${aNick}.pretty`);
  row.SetType('KiCad');

  for (const name of aNames)
    fs.Write(
      `${aNick}.pretty/${name}.kicad_mod`,
      new TextEncoder().encode(`(footprint "${name}")`),
    );
}

const fpids = (aBoard: BOARD): string[] => aBoard.Footprints().map((f) => f.GetFPIDAsString());

const readMod = (aPath: string): string =>
  new TextDecoder().decode(wxReadFileSync(aPath) ?? new Uint8Array());

afterEach(() => {
  unmount?.();
  unmount = null;
  SetPgm(null);
});

describe('FOOTPRINT_IMPORT_RECONCILER, generate residual', () => {
  it('writes the residual definitions to a published .pretty and re-points every FPID at it', () => {
    const adapter = project();
    const board = boardOf('R_0805', 'R_0805', 'C_0603');
    const reporter = new Reporter();
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, `${DIR}/`, reporter).Reconcile(
      board,
      [def('R_0805'), def('C_0603')],
      'eagle_test-import-fps',
      [],
    );

    expect(result.m_cacheNickname).toBe('eagle_test-import-fps');
    expect(result.m_cacheLibraryPath).toBe(`${DIR}/eagle_test-import-fps.pretty`);
    expect(result.m_savedToCache).toBe(2);
    expect(result.m_linkedToCache).toBe(3);
    expect(result.m_linkedToSource).toBe(0);
    expect(result.m_unresolved).toBe(0);
    expect(result.Ok()).toBe(true);
    expect(reporter.lines).toEqual([]);

    expect(wxDirExists(`${DIR}/eagle_test-import-fps.pretty`)).toBe(true);
    // atomically published: no temp directory left
    expect(wxDirExists(`${DIR}/eagle_test-import-fps.pretty.tmp`)).toBe(false);
    expect(wxFileExists(`${DIR}/eagle_test-import-fps.pretty/R_0805.kicad_mod`)).toBe(true);
    expect(wxFileExists(`${DIR}/eagle_test-import-fps.pretty/C_0603.kicad_mod`)).toBe(true);
    expect(fpids(board)).toEqual([
      'eagle_test-import-fps:R_0805',
      'eagle_test-import-fps:R_0805',
      'eagle_test-import-fps:C_0603',
    ]);
    // "every board FPID resolves via the adapter"
    for (const fpid of fpids(board)) {
      const [nick, name] = fpid.split(':') as [string, string];
      expect(adapter.FootprintExists(nick, name)).toBe(true);
    }
  });

  it('writes each library footprint under the cache nickname with the reference REF**', () => {
    const adapter = project();
    new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      boardOf('R_0805'),
      [def('R_0805')],
      'x-import-fps',
      [],
    );
    const text = readMod(`${DIR}/x-import-fps.pretty/R_0805.kicad_mod`);
    expect(text).toContain('(footprint "R_0805"');
    expect(text).toContain('"REF**"');
    expect(text).not.toContain('"R1"');
  });

  it('registers the managed row in the project table, saves it, and loads the cache', () => {
    const adapter = project();
    new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      boardOf('R_0805'),
      [def('R_0805')],
      'x-import-fps',
      [],
    );

    const row = adapter.table.Row('x-import-fps')!;
    expect(row.URI()).toBe('${KIPRJMOD}/x-import-fps.pretty');
    expect(row.Type()).toBe('KiCad');
    expect(row.Options()).toBe(FOOTPRINT_IMPORT_RECONCILER.ManagedCacheOption());
    expect(row.Scope()).toBe(LIBRARY_TABLE_SCOPE.PROJECT);
    expect(adapter.loaded).toContain('x-import-fps');

    const saved = readMod(TABLE_PATH);
    expect(saved).toContain('(name "x-import-fps")');
    expect(saved).toContain('kicad_import_cache=1');
  });

  it('falls back to the first placed instance when the importer gave no definition', () => {
    const adapter = project();
    const board = boardOf('Odd_Part');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [],
      'x-import-fps',
      [],
    );
    expect(result.m_savedToCache).toBe(1);
    const text = readMod(`${DIR}/x-import-fps.pretty/Odd_Part.kicad_mod`);
    // a library file names its footprint by item name alone, whatever the FPID's nickname
    expect(text).toContain('(footprint "Odd_Part"');
    expect(text).not.toContain('x-import-fps');
    expect(text).toContain('"REF**"');
  });

  it('warns when same-name placed instances differ structurally, and keeps the first', () => {
    const adapter = project();
    const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6)) (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (setup) (net 0 "")
  ${footprintText('Odd_Part', 'R1', 2)}
  ${footprintText('Odd_Part', 'R2', 4)})`);
    const reporter = new Reporter();
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR, reporter).Reconcile(
      board,
      [],
      'x-import-fps',
      [],
    );

    expect(reporter.lines).toEqual([
      {
        message:
          "Imported footprint 'Odd_Part' has conflicting placed definitions; keeping the first.",
        severity: RPT_SEVERITY_WARNING,
        location: 'body',
      },
    ]);
    expect(result.m_savedToCache).toBe(1);
    // the first instance (2 pads) is the one written
    expect(readMod(`${DIR}/x-import-fps.pretty/Odd_Part.kicad_mod`).match(/\(pad /g)).toHaveLength(
      2,
    );
  });

  it('no warning when same-name placed instances match', () => {
    const adapter = project();
    const reporter = new Reporter();
    new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR, reporter).Reconcile(
      boardOf('Same', 'Same'),
      [],
      'x-import-fps',
      [],
    );
    expect(reporter.lines).toEqual([]);
  });

  it('the first importer definition of a name wins', () => {
    const adapter = project();
    new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      boardOf('R_0805'),
      [def('R_0805', 2), def('R_0805', 6)],
      'x-import-fps',
      [],
    );
    expect(readMod(`${DIR}/x-import-fps.pretty/R_0805.kicad_mod`).match(/\(pad /g)).toHaveLength(2);
  });
});

describe('FOOTPRINT_IMPORT_RECONCILER, prefer source', () => {
  it('re-links a footprint to the one source library that holds it, and writes only the rest', () => {
    const adapter = project();
    addSourceLibrary(adapter, 'HiFive', ['R_0805']);
    const board = boardOf('HiFive:R_0805', 'HiFive:C_0603');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [def('R_0805'), def('C_0603')],
      'x-import-fps',
      ['HiFive'],
    );

    expect(fpids(board)).toEqual(['HiFive:R_0805', 'x-import-fps:C_0603']);
    expect(result.m_linkedToSource).toBe(1);
    expect(result.m_linkedToCache).toBe(1);
    expect(result.m_savedToCache).toBe(1);
    expect(adapter.loaded).toContain('HiFive');
    expect(wxFileExists(`${DIR}/x-import-fps.pretty/R_0805.kicad_mod`)).toBe(false);
  });

  it('an unregistered source nickname on the footprint is not a match', () => {
    const adapter = project();
    const board = boardOf('Unregistered:R_0805');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [def('R_0805')],
      'x-import-fps',
      [],
    );
    expect(fpids(board)).toEqual(['x-import-fps:R_0805']);
    expect(result.m_linkedToSource).toBe(0);
  });

  it('two source libraries that both hold the name are ambiguous, so it goes to the cache', () => {
    const adapter = project();
    addSourceLibrary(adapter, 'A', ['R_0805']);
    addSourceLibrary(adapter, 'B', ['R_0805']);
    const board = boardOf('R_0805');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [def('R_0805')],
      'x-import-fps',
      ['A', 'B'],
    );
    expect(fpids(board)).toEqual(['x-import-fps:R_0805']);
    expect(result.m_linkedToSource).toBe(0);
    expect(result.m_linkedToCache).toBe(1);
  });

  it("the footprint's own nickname counts as a candidate even when it is not a listed source", () => {
    const adapter = project();
    addSourceLibrary(adapter, 'Own', ['R_0805']);
    const board = boardOf('Own:R_0805');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [],
      'x-import-fps',
      [],
    );
    expect(fpids(board)).toEqual(['Own:R_0805']);
    expect(result.m_linkedToSource).toBe(1);
    expect(result.m_cacheNickname).toBe('');
    expect(wxDirExists(`${DIR}/x-import-fps.pretty`)).toBe(false);
  });

  it('same-name parts from different libraries are resolved independently', () => {
    const adapter = project();
    addSourceLibrary(adapter, 'A', ['R_0805']);
    const board = boardOf('A:R_0805', 'B:R_0805');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [def('R_0805')],
      'x-import-fps',
      [],
    );
    // A is registered and holds it; B is not registered anywhere
    expect(fpids(board)).toEqual(['A:R_0805', 'x-import-fps:R_0805']);
    expect(result.m_linkedToSource).toBe(1);
    expect(result.m_linkedToCache).toBe(1);
  });

  it('a listed source library is a candidate for every footprint, whatever its own nickname', () => {
    const adapter = project();
    addSourceLibrary(adapter, 'A', ['R_0805']);
    const board = boardOf('A:R_0805', 'B:R_0805');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [],
      'x-import-fps',
      ['A'],
    );
    expect(fpids(board)).toEqual(['A:R_0805', 'A:R_0805']);
    expect(result.m_linkedToSource).toBe(2);
    expect(result.m_cacheNickname).toBe('');
  });
});

describe('FOOTPRINT_IMPORT_RECONCILER, edges', () => {
  it('a null board is an empty result', () => {
    const result = new FOOTPRINT_IMPORT_RECONCILER(project(), DIR).Reconcile(null, [], 'x', []);
    expect(result.m_unresolved).toBe(0);
    expect(result.m_cacheNickname).toBe('');
  });

  it('never replaces a library it did not generate', () => {
    const adapter = project();
    // a user's library already sits at the cache's path
    fs.Write('x-import-fps.pretty/Mine.kicad_mod', new TextEncoder().encode('(footprint "Mine")'));
    const row = adapter.table.InsertRow();
    row.SetNickname('x-import-fps');
    row.SetURI('${KIPRJMOD}/x-import-fps.pretty');
    row.SetType('KiCad');

    const board = boardOf('R_0805');
    const reporter = new Reporter();
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR, reporter).Reconcile(
      board,
      [def('R_0805')],
      'x-import-fps',
      [],
    );

    expect(reporter.lines.map((l) => [l.message, l.severity])).toEqual([
      [
        `A library already exists at '${DIR}/x-import-fps.pretty'; leaving imported footprints unresolved.`,
        RPT_SEVERITY_ERROR,
      ],
    ]);
    expect(result.m_unresolved).toBe(1);
    expect(result.m_cacheNickname).toBe('');
    expect(readMod(`${DIR}/x-import-fps.pretty/Mine.kicad_mod`)).toBe('(footprint "Mine")');
    expect(wxDirExists(`${DIR}/x-import-fps.pretty.tmp`)).toBe(false);
    expect(fpids(board)).toEqual(['R_0805']);
  });

  it('replaces a cache it generated earlier', () => {
    const adapter = project();
    new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      boardOf('Old'),
      [def('Old')],
      'x-import-fps',
      [],
    );
    expect(wxFileExists(`${DIR}/x-import-fps.pretty/Old.kicad_mod`)).toBe(true);

    const board = boardOf('New');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [def('New')],
      'x-import-fps',
      [],
    );
    expect(result.m_cacheNickname).toBe('x-import-fps');
    expect(wxFileExists(`${DIR}/x-import-fps.pretty/New.kicad_mod`)).toBe(true);
    expect(wxFileExists(`${DIR}/x-import-fps.pretty/Old.kicad_mod`)).toBe(false);
    // one row, refreshed
    expect(adapter.table.Rows().filter((r) => r.Nickname() === 'x-import-fps')).toHaveLength(1);
  });

  it('with no project table the cache is not claimed and its FPIDs stay unresolved', () => {
    const adapter = project();
    adapter.hasTable = false;
    const board = boardOf('R_0805');
    const reporter = new Reporter();
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR, reporter).Reconcile(
      board,
      [def('R_0805')],
      'x-import-fps',
      [],
    );
    expect(reporter.lines.map((l) => l.message)).toEqual([
      'Cannot register imported footprint cache: no project library table.',
    ]);
    expect(result.m_cacheNickname).toBe('');
    expect(result.m_unresolved).toBe(1);
    expect(result.Ok()).toBe(false);
    expect(fpids(board)).toEqual(['R_0805']);
  });

  it('a table that cannot be saved is a warning, and the cache is still claimed', () => {
    const adapter = project();
    adapter.table.SetReadOnly(true);
    const reporter = new Reporter();
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR, reporter).Reconcile(
      boardOf('R_0805'),
      [def('R_0805')],
      'x-import-fps',
      [],
    );
    expect(reporter.lines.map((l) => [l.message, l.severity])).toEqual([
      ['Error saving project footprint library table.', RPT_SEVERITY_WARNING],
    ]);
    expect(result.m_cacheNickname).toBe('x-import-fps');
  });

  it('a writer that fails leaves nothing behind and the FPIDs unresolved', () => {
    const adapter = project();
    const io: FOOTPRINT_LIBRARY_IO = {
      CreateLibrary: () => {},
      FootprintSave: () => {
        throw new IO_ERROR('disk full');
      },
      DeleteLibrary: (p) => new KICAD_SEXPR_FOOTPRINT_LIBRARY_IO().DeleteLibrary(p),
    };
    const board = boardOf('R_0805');
    const reporter = new Reporter();
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR, reporter, io).Reconcile(
      board,
      [def('R_0805')],
      'x-import-fps',
      [],
    );
    expect(reporter.lines.map((l) => [l.message, l.severity])).toEqual([
      ["Error writing imported footprint cache 'x-import-fps': disk full", RPT_SEVERITY_ERROR],
    ]);
    expect(result.m_unresolved).toBe(1);
    expect(wxDirExists(`${DIR}/x-import-fps.pretty`)).toBe(false);
    expect(adapter.table.HasRow('x-import-fps')).toBe(false);
  });

  it('a footprint with no item name is skipped, not counted unresolved', () => {
    const adapter = project();
    const board = boardOf('R_0805');
    board.Footprints()[0]!.SetFPIDAsString('');
    const result = new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      board,
      [],
      'x-import-fps',
      [],
    );
    expect(result.m_unresolved).toBe(0);
    expect(result.m_savedToCache).toBe(0);
  });

  it('a temp directory left by a crashed earlier run is cleared first', () => {
    const adapter = project();
    fs.Write('x-import-fps.pretty.tmp/Stale.kicad_mod', new TextEncoder().encode('stale'));
    new FOOTPRINT_IMPORT_RECONCILER(adapter, DIR).Reconcile(
      boardOf('R_0805'),
      [def('R_0805')],
      'x-import-fps',
      [],
    );
    expect(wxFileExists(`${DIR}/x-import-fps.pretty/Stale.kicad_mod`)).toBe(false);
    expect(wxFileExists(`${DIR}/x-import-fps.pretty/R_0805.kicad_mod`)).toBe(true);
  });
});

describe('PCB_EDIT_FRAME::reconcileImportedFootprintLibraries (files.cpp:1208)', () => {
  function frameOn(aAdapter: ProjectAdapter | null, aBoard: BOARD) {
    const manager = new SETTINGS_MANAGER();
    SetPgm(new PGM_BASE(null, manager));
    manager.LoadProject(`${DIR}/x.kicad_pro`, {});
    const warnings: [string, string][] = [];
    const frame = new PCB_EDIT_FRAME({
      settings: () => new PCBNEW_SETTINGS(),
      onModify: () => {},
      onUndoRedoIncomplete: () => {},
      createDrcDialog: () => {
        throw new Error('no DRC dialog here');
      },
      isSingle: () => true,
      fetchNetlistFromSchematic: () => false,
      schematicNetlistText: () => null,
      projectText: () => null,
      onEditItemRequest: () => {},
      showExchangeFootprintsDialog: () => {},
      findDialogRects: () => [],
      setViewCenter: () => {},
      setHighlightNets: () => {},
      syncSelection: () => {},
      editZoneParams: () => {},
      selectCopperLayerPair: () => {},
      updatePcbFromSchematic: () => {},
      addStatusBarWarnings: (k, m) => warnings.push([k, m]),
    });
    frame.SetBoard(aBoard, false);
    aBoard.SetFootprintLibAdapter(aAdapter);
    return { frame, warnings };
  }

  it("uses the manager's cache nickname and source libraries from the import properties", () => {
    const adapter = project();
    addSourceLibrary(adapter, 'Src', ['R_0805']);
    const board = boardOf('Src:R_0805', 'C_0603');
    const { frame } = frameOn(adapter, board);
    frame.m_importProperties = new Map([
      [IMPORT_PROJ_PROPS.FP_CACHE_NICKNAME, 'managed-import-fps'],
      [IMPORT_PROJ_PROPS.SOURCE_FP_LIBS, 'Src'],
    ]);
    frame.reconcileImportedFootprintLibraries([def('C_0603')], '/anywhere/board.kicad_pcb');
    expect(fpids(board)).toEqual(['Src:R_0805', 'managed-import-fps:C_0603']);
    expect(wxFileExists(`${DIR}/managed-import-fps.pretty/C_0603.kicad_mod`)).toBe(true);
  });

  it('a standalone import derives the nickname from the board file name', () => {
    const adapter = project();
    const board = boardOf('R_0805');
    const { frame } = frameOn(adapter, board);
    frame.reconcileImportedFootprintLibraries([def('R_0805')], '/some/dir/my.board.kicad_pcb');
    expect(fpids(board)).toEqual(['my.board-import-fps:R_0805']);
  });

  it('does nothing when the host gave the board no library adapter', () => {
    const board = boardOf('R_0805');
    const { frame } = frameOn(null, board);
    frame.reconcileImportedFootprintLibraries([def('R_0805')], '/d/b.kicad_pcb');
    expect(fpids(board)).toEqual(['R_0805']);
  });

  it("hands the reconciler's messages to the status bar's warning list", () => {
    const adapter = project();
    adapter.hasTable = false;
    const board = boardOf('R_0805');
    const { frame, warnings } = frameOn(adapter, board);
    frame.reconcileImportedFootprintLibraries([def('R_0805')], '/d/b.kicad_pcb');
    expect(warnings).toEqual([
      ['load', 'Cannot register imported footprint cache: no project library table.\n'],
    ]);
  });

  it('a reconciler failure does not abort the import', () => {
    const adapter = project();
    // an IO_ERROR out of the adapter is caught and reported, as the C++ catch does
    adapter.LoadOne = () => {
      throw new IO_ERROR('table unreadable');
    };
    addSourceLibrary(adapter, 'Src', ['R_0805']);
    const board = boardOf('R_0805');
    const { frame, warnings } = frameOn(adapter, board);
    frame.m_importProperties = new Map([[IMPORT_PROJ_PROPS.SOURCE_FP_LIBS, 'Src']]);
    expect(() =>
      frame.reconcileImportedFootprintLibraries([def('R_0805')], '/d/b.kicad_pcb'),
    ).not.toThrow();
    expect(warnings).toEqual([
      ['load', 'Could not reconcile imported footprint libraries: table unreadable\n'],
    ]);
  });
});
