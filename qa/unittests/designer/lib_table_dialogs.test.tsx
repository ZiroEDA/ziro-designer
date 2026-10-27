// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Manage Symbol / Footprint Libraries (designer/src/widgets/dialog_*_lib_table.tsx)
 * on LIB_TABLE_NOTEBOOK_PANEL, LIB_TABLE_GRID_DATA_MODEL and
 * LIB_TABLE_GRID_TRICKS: the hosted global page is read-only, the project
 * page edits a copy of the project table, "Add Existing" registers a project
 * file, OK writes only a changed table, and a double-click in Options opens
 * DIALOG_PLUGIN_OPTIONS (LIB_TABLE_GRID_TRICKS::handleDoubleClick).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// "Add Existing"'s file dialog onto the computer: the folder the test hands it.
const pickedFolder = vi.hoisted(() => ({
  value: null as null | { name: string; files: { path: string; bytes: Uint8Array }[] },
}));
// "KiCad from Computer...": the files the test hands the browser's picker.
const pickedFiles = vi.hoisted(() => ({ value: [] as File[] }));
vi.mock('@ziroeda/designer/src/fs/open_file_dialog.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openFileDialog: async () => pickedFiles.value,
}));
vi.mock('@ziroeda/wx/dirdlg.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ChooseLocalFolder: async () => pickedFolder.value,
}));
import { DialogFpLibTable } from '@ziroeda/pcbnew/dialogs/panel_fp_lib_table.js';
import { DialogSymLibTable } from '@ziroeda/designer/src/widgets/dialog_sym_lib_table.js';
import { LIBRARY_MANAGER } from '@ziroeda/common/libraries/library_manager.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { PATHS } from '@ziroeda/common/paths.js';
import {
  SetErrorPresenter,
  SetMessageDialogPresenter,
  SetQuestionPresenter,
} from '@ziroeda/common/confirm.js';
import { KICAD_SETTINGS } from '@ziroeda/common/settings/kicad_settings.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { PGM_BASE, Pgm, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { LoadGlobalSymbolTables } from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem, wxReadFileSync } from '@ziroeda/wx/filefn.js';

afterEach(cleanup);

const SYM_TABLE = `(sym_lib_table
  (version 7)
  (lib (name "proj")(type "KiCad")(uri "\${KIPRJMOD}/proj.kicad_sym")(options "")(descr "mine"))
  (lib (name "gone")(type "KiCad")(uri "\${KIPRJMOD}/gone.kicad_sym")(options "")(descr ""))
)`;

const symFiles = [
  { name: 'demo/demo.kicad_pro', text: '{}' },
  { name: 'demo/sym-lib-table', text: SYM_TABLE },
  { name: 'demo/proj.kicad_sym', text: '(kicad_symbol_lib)' },
  { name: 'demo/extra.kicad_sym', text: '(kicad_symbol_lib)' },
];

const cellText = (aRow: number, aCol: number): string =>
  document.querySelector(`td[data-row="${aRow}"][data-col="${aCol}"]`)?.textContent ?? '';

function openSym(onSave = vi.fn(), onClose = vi.fn()) {
  render(
    <DialogSymLibTable
      projectFiles={symFiles}
      globalLibraries={['Device', 'power']}
      globalBase="https://libs"
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
}

describe('Manage Symbol Libraries', () => {
  it('shows both tables, the project one first', () => {
    openSym();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Global Libraries',
      'Project Specific Libraries',
    ]);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    // COL_NICKNAME is 3, COL_URI 4, COL_DESCR 7.
    expect(cellText(0, 3)).toBe('proj');
    expect(cellText(0, 7)).toBe('mine');
    fireEvent.click(tabs[0]!);
    expect(cellText(1, 3)).toBe('power');
    // No Library Path, Library Format or Options: the page is the library's place.
    // COL_STATUS's label is wxS( " " ) (lib_table_grid_data_model.cpp:386); the last is the filler.
    expect([...document.querySelectorAll('th')].map((t) => t.textContent)).toEqual([
      ' ',
      'Enable',
      'Show',
      'Nickname',
      'Description',
      '',
    ]);
  });

  it('puts the warning button on a row whose file is not in the project', () => {
    openSym();
    const status = (r: number) =>
      document.querySelector(`td[data-row="${r}"][data-col="0"] img`) !== null;
    expect(status(0)).toBe(false);
    expect(status(1)).toBe(true);
    // SetTooltipEnable( COL_STATUS ): the error is the cell's tooltip.
    expect(document.querySelector('td[data-row="1"][data-col="0"]')?.getAttribute('title')).toBe(
      "Library '${KIPRJMOD}/gone.kicad_sym' not found.",
    );
  });

  it('closes without saving when nothing changed', () => {
    const { onSave, onClose } = openSym();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('registers a project file through Add Existing, and saves it', () => {
    const { onSave } = openSym();
    fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
    fireEvent.click(screen.getByText('extra.kicad_sym'));
    expect(cellText(2, 3)).toBe('extra');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const rows = onSave.mock.calls[0]![0];
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['proj', 'gone', 'extra']);
    expect(rows[2]).toMatchObject({ type: 'KiCad', uri: '${KIPRJMOD}/extra.kicad_sym' });
  });

  it('adds, moves and removes nothing on the read-only global table', () => {
    openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add empty row to table' }));
    expect(document.querySelector('td[data-row="2"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove library from table' }));
    expect(cellText(0, 3)).toBe('Device');
    expect(cellText(1, 3)).toBe('power');
    expect(document.querySelector('td[data-row="2"]')).toBeNull();
  });

  it('draws no cell of the path, format or options columns', () => {
    openSym();
    // COL_URI 4, COL_TYPE 5, COL_OPTIONS 6: hidden, so nothing to type a path into or
    // double-click for DIALOG_PLUGIN_OPTIONS.
    for (const col of [4, 5, 6])
      expect(document.querySelector(`td[data-col="${col}"]`), `column ${col}`).toBeNull();
    expect(cellText(0, 7)).toBe('mine');
  });
});

/**
 * PANEL_SYM_LIB_TABLE's global page is the library manager's global table - the user's own,
 * chaining the stock one through its "KiCad" row - and OK assigns, saves and re-reads it
 * (TransferDataFromWindow, InvokeSchEditSymbolLibTable's LoadGlobalTables).
 */
describe("Manage Symbol Libraries, with the user's global table", () => {
  let unmounts: (() => void)[] = [];
  const userTablePath = () => LIBRARY_MANAGER.DefaultGlobalTablePath(LIBRARY_TABLE_TYPE.SYMBOL);
  const stored = () => new TextDecoder().decode(wxReadFileSync(userTablePath())!);
  const globalNames = () =>
    Pgm()
      .GetLibraryManager()
      .Rows(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.GLOBAL)
      .map((r) => r.Nickname());

  beforeEach(() => {
    SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
    const cfg = new MEMORY_FILESYSTEM();
    unmounts = [wxMountFileSystem(PATHS.GetUserSettingsPath(), cfg)];
    cfg.Write(
      'sym-lib-table',
      new TextEncoder().encode(`(sym_lib_table
  (version 7)
  (lib (name "KiCad")(type "Table")(uri "${LIBRARY_MANAGER.StockTableReferenceURI(LIBRARY_TABLE_TYPE.SYMBOL)}")(options "")(descr ""))
  (lib (name "Mine")(type "KiCad")(uri "/Symbols/Mine.kicad_sym")(options "")(descr "my parts"))
)
`),
    );
    LoadGlobalSymbolTables(['Device', 'power']);
  });

  afterEach(() => {
    for (const u of unmounts) u();
    SetPgm(null);
    SetMessageDialogPresenter(async () => wxID_CANCEL);
    SetQuestionPresenter(async () => false);
  });

  it("shows the user's table, its chain to the stock table a row of it that opens", () => {
    openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);

    expect([cellText(0, 3), cellText(1, 3), cellText(1, 7)]).toEqual(['KiCad', 'Mine', 'my parts']);
    // LIBRARY_TABLE_OK: a nested table whose file is there gets the button that opens it.
    expect(document.querySelector('td[data-row="0"][data-col="0"]')?.getAttribute('title')).toBe(
      'Open library table',
    );
    expect(document.querySelector('td[data-row="2"]')).toBeNull();
  });

  it('saves a changed global table and reads it back, the project table untouched', () => {
    const { onSave, onClose } = openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.mouseDown(document.querySelector('td[data-row="1"][data-col="3"]')!, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Remove library from table' }));

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(stored()).not.toContain('"Mine"');
    expect(stored()).toContain('"KiCad"');
    expect(globalNames()).toEqual(['Device', 'power']);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // PANEL_SYM_LIB_TABLE's constructor adds the project page only when LIBRARY_MANAGER::Table(
  // PROJECT ) has a value, which it has not with no project open.
  it('shows the global table alone with no project open, and saves it', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <DialogSymLibTable
        projectFiles={null}
        globalLibraries={['Device', 'power']}
        globalBase="https://libs"
        onSave={onSave}
        onClose={onClose}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Global Libraries']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    // Add Existing on the Global page brings a library into the account, project or none.
    expect(screen.getByRole('button', { name: 'Add Existing' }).hasAttribute('disabled')).toBe(
      false,
    );

    fireEvent.mouseDown(document.querySelector('td[data-row="1"][data-col="3"]')!, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Remove library from table' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(stored()).not.toContain('"Mine"');
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // SYMBOL_GRID_TRICKS::openTable / PANEL_SYM_LIB_TABLE::OpenTable: the stock table chained by
  // the "KiCad" row, read-only, on a closable page of its own; its Show kept as an override
  // (LIB_TABLE_NOTEBOOK_PANEL::SaveOverrides) under the table's path, as kicad.json keeps it.
  it('opens the KiCad row as a read-only page, and keeps a library hidden there', async () => {
    const kicad = Pgm().GetSettingsManager().RegisterSettings(new KICAD_SETTINGS());
    const { onClose } = openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.mouseDown(document.querySelector('td[data-row="0"][data-col="0"]')!, { button: 0 });

    const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs()).toEqual(['Global Libraries', 'Project Specific Libraries', 'KiCad (read-only)']);
    expect([cellText(0, 3), cellText(1, 3)]).toEqual(['Device', 'power']);
    // Read-only: rows cannot be added, but Show changes.
    fireEvent.click(screen.getByRole('button', { name: 'Add empty row to table' }));
    expect(document.querySelector('td[data-row="2"]')).toBeNull();
    fireEvent.mouseDown(document.querySelector('td[data-row="0"][data-col="2"]')!, { button: 0 });
    expect(tabs()[2]).toBe('KiCad (read-only) *');

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(
      Object.fromEntries(
        kicad.m_LibOverrides.get(LIBRARY_MANAGER.StockTablePath(LIBRARY_TABLE_TYPE.SYMBOL)) ?? [],
      ),
    ).toEqual({ Device: { disabled: false, hidden: true } });
    // Read again, the global tables carry it.
    const device = Pgm()
      .GetLibraryManager()
      .Rows(LIBRARY_TABLE_TYPE.SYMBOL)
      .find((r) => r.Nickname() === 'Device');
    expect(device?.Hidden()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the KiCad page from its tab, the fixed pages having no close button', () => {
    Pgm().GetSettingsManager().RegisterSettings(new KICAD_SETTINGS());
    openSym();
    expect(screen.queryAllByRole('button', { name: /^Close / })).toEqual([]);
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.mouseDown(document.querySelector('td[data-row="0"][data-col="0"]')!, { button: 0 });

    const close = screen.getAllByRole('button', { name: /^Close / });
    expect(close.map((b) => b.getAttribute('aria-label'))).toEqual(['Close KiCad (read-only)']);
    fireEvent.click(close[0]!);

    return vi.waitFor(() =>
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
        'Global Libraries',
        'Project Specific Libraries',
      ]),
    );
  });

  // PANEL_SYM_LIB_TABLE::onReset: the global table made again with only the stock table chained,
  // and read back - asked first, since the user's rows go.
  it('resets the global table to the KiCad row alone', async () => {
    const asked: string[] = [];
    SetQuestionPresenter(async (aMessage) => {
      asked.push(aMessage);
      return true;
    });
    openSym();
    const reset = screen.getByRole('button', { name: 'Reset Libraries' });
    // m_resetGlobal->Enable( GetSelection() == 0 ): the project page is the one shown first.
    expect(reset.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Libraries' }));

    await vi.waitFor(() => expect(cellText(1, 3)).toBe(''));
    expect(asked).toEqual([
      'This action will reset your global library table on disk and cannot be undone.',
    ]);
    expect(cellText(0, 3)).toBe('KiCad');
    expect(stored()).not.toContain('"Mine"');
    expect(globalNames()).toEqual(['Device', 'power']);
  });

  it('writes nothing for OK on an unchanged global table', () => {
    const { onClose } = openSym();
    const before = stored();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(stored()).toBe(before);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Opened before the hosted index was in, the page showed the hosted set alone: that stand-in is
  // not the user's table, and OK must not write it over the one that has since been read.
  it("leaves the user's table alone when the page showed the hosted set instead", () => {
    const shown: string[] = [];
    SetMessageDialogPresenter(async (aArg) => {
      shown.push(aArg.message);
      return wxID_OK;
    });
    Pgm().GetLibraryManager().SetTable(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.GLOBAL, null);
    openSym();
    LoadGlobalSymbolTables(['Device', 'power']);
    const before = stored();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(stored()).toBe(before);
    expect(globalNames()).toEqual(['Device', 'power', 'Mine']);
    expect(shown).toEqual([]);
  });

  it('says so when the global table cannot be written', () => {
    const shown: [string, string | undefined][] = [];
    SetMessageDialogPresenter(async (aArg) => {
      shown.push([aArg.message, aArg.caption]);
      return wxID_OK;
    });
    const { onClose } = openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.mouseDown(document.querySelector('td[data-row="1"][data-col="3"]')!, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Remove library from table' }));
    // The settings path gone from under the table: nowhere to write it.
    unmounts.shift()!();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(shown.length).toBe(1);
    expect(shown[0]![0]).toMatch(/^Error saving global library table:\n\n/);
    expect(shown[0]![1]).toBe('File Save Error');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('writes nothing on Cancel', () => {
    openSym();
    const before = stored();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.mouseDown(document.querySelector('td[data-row="1"][data-col="3"]')!, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Remove library from table' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(stored()).toBe(before);
    expect(globalNames()).toEqual(['Device', 'power', 'Mine']);
  });
});

describe('Manage Footprint Libraries', () => {
  const FP_TABLE = `(fp_lib_table
  (version 7)
  (lib (name "Footprints")(type "KiCad")(uri "\${KIPRJMOD}/footprints.pretty")(options "")(descr ""))
)`;
  const fpFiles = [
    { name: 'ecc/ecc.kicad_pro', text: '{}' },
    { name: 'ecc/fp-lib-table', text: FP_TABLE },
    { name: 'ecc/footprints.pretty/V.kicad_mod', text: '(footprint "V")' },
    { name: 'ecc/spares.pretty/S.kicad_mod', text: '(footprint "S")' },
  ];

  it('hides Show, and writes a deleted row out of the table', () => {
    const onSave = vi.fn();
    render(
      <DialogFpLibTable
        projectFiles={fpFiles}
        globalLibraries={['Resistor_SMD']}
        globalBase="https://fp"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Show')).toBeNull();
    expect(document.querySelector('td[data-row="0"][data-col="0"] img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
    expect(screen.getByText('spares.pretty')).toBeTruthy();
    expect(screen.queryByText('footprints.pretty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove library from table' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    // No rows, and no library brought in off the computer to write with them.
    expect(onSave).toHaveBeenCalledWith([], []);
  });

  describe('"Add Existing" from the computer', () => {
    const enc = new TextEncoder();
    const open = (onSave: ReturnType<typeof vi.fn>) => {
      pickedFolder.value = {
        name: 'MyParts.pretty',
        files: [
          { path: 'R_0603.kicad_mod', bytes: enc.encode('(footprint "R_0603")') },
          { path: 'notes.txt', bytes: enc.encode('x') },
        ],
      };
      render(
        <DialogFpLibTable
          projectFiles={fpFiles}
          globalLibraries={['Resistor_SMD']}
          globalBase="https://fp"
          onSave={onSave}
          onClose={vi.fn()}
        />,
      );
    };
    const browse = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
      await act(async () => {
        fireEvent.click(screen.getByText('KiCad (folder) from Computer...'));
        await new Promise((r) => setTimeout(r, 0));
      });
    };

    // Footprint libraries have no place in the account yet, so the Global page offers the
    // computer nothing, rather than an item that adds what nothing would keep.
    it("is the Project page's alone", () => {
      open(vi.fn());
      fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
      expect(screen.getByText('KiCad (folder) from Computer...')).toBeTruthy();
      fireEvent.click(screen.getAllByRole('tab')[0]!);
      expect(screen.getByRole('button', { name: 'Add Existing' }).hasAttribute('disabled')).toBe(
        true,
      );
    });

    it('adds the folder as a project row, and OK writes its footprints with the table', async () => {
      const onSave = vi.fn();
      open(onSave);
      await browse();

      expect(cellText(1, 3)).toBe('MyParts');
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(onSave).toHaveBeenCalledWith(
        [
          expect.objectContaining({ name: 'Footprints' }),
          expect.objectContaining({ name: 'MyParts', uri: '${KIPRJMOD}/MyParts.pretty' }),
        ],
        [{ name: 'ecc/MyParts.pretty/R_0603.kicad_mod', text: '(footprint "R_0603")' }],
      );
    });

    it('writes nothing of a folder whose row was removed again before OK', async () => {
      const onSave = vi.fn();
      open(onSave);
      await browse();

      fireEvent.click(screen.getByRole('button', { name: 'Remove library from table' }));
      // Another change, so OK does write the table: without the folder's files.
      fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
      fireEvent.click(screen.getByText('spares.pretty'));
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(onSave).toHaveBeenCalledWith(
        [
          expect.objectContaining({ name: 'Footprints' }),
          expect.objectContaining({ name: 'spares' }),
        ],
        [],
      );
    });
  });
});

/**
 * A library's place is its page: the Global page's is the account's Symbols folder, the Project
 * page's the project. The add button's row becomes a new, empty library there, named by its
 * nickname; "KiCad from Computer..." copies a file there; Add Existing lists the folder's
 * libraries no row names. Each file is written on OK, and only those.
 */
describe('Manage Symbol Libraries, a library in its place', () => {
  let unmounts: (() => void)[] = [];
  let SYMBOLS: MEMORY_FILESYSTEM;
  const userTablePath = () => LIBRARY_MANAGER.DefaultGlobalTablePath(LIBRARY_TABLE_TYPE.SYMBOL);
  const stored = () => new TextDecoder().decode(wxReadFileSync(userTablePath())!);
  /** The stored global table's rows, as nickname and path. */
  const storedRows = () =>
    LIBRARY_TABLE.FromFile(userTablePath(), stored(), LIBRARY_TABLE_SCOPE.GLOBAL)
      .Rows()
      .map((r) => [r.Nickname(), r.URI(), r.Type()]);
  const account = (aName: string) => {
    const bytes = wxReadFileSync(`/Symbols/${aName}`);
    return bytes ? new TextDecoder().decode(bytes) : null;
  };
  const typeNickname = (aRow: number, aName: string) => {
    const input = document.querySelector(
      `td[data-row="${aRow}"][data-col="3"] input`,
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: aName } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  };

  beforeEach(() => {
    SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
    const cfg = new MEMORY_FILESYSTEM();
    SYMBOLS = new MEMORY_FILESYSTEM();
    unmounts = [
      wxMountFileSystem(PATHS.GetUserSettingsPath(), cfg),
      wxMountFileSystem('/Symbols', SYMBOLS),
    ];
    cfg.Write(
      'sym-lib-table',
      new TextEncoder().encode(`(sym_lib_table
  (version 7)
  (lib (name "KiCad")(type "Table")(uri "${LIBRARY_MANAGER.StockTableReferenceURI(LIBRARY_TABLE_TYPE.SYMBOL)}")(options "")(descr ""))
  (lib (name "Mine")(type "KiCad")(uri "/Symbols/Mine.kicad_sym")(options "")(descr "my parts"))
)
`),
    );
    LoadGlobalSymbolTables(['Device', 'power']);
    pickedFiles.value = [];
  });

  afterEach(() => {
    for (const u of unmounts) u();
    SetPgm(null);
    SetMessageDialogPresenter(async () => wxID_CANCEL);
    SetErrorPresenter(() => {});
  });

  it("makes the add button's row a new library in the account", () => {
    openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add empty row to table' }));
    typeNickname(2, 'NewParts');

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(storedRows()).toContainEqual(['NewParts', '/Symbols/NewParts.kicad_sym', 'KiCad']);
    expect(account('NewParts.kicad_sym')).toMatch(/^\(kicad_symbol_lib\s+\(version \d+\)/);
  });

  it('copies a library off the computer into the account, on OK', async () => {
    pickedFiles.value = [new File(['(kicad_symbol_lib)'], 'Picked.kicad_sym')];
    openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
    fireEvent.click(screen.getByText('KiCad from Computer...'));
    await vi.waitFor(() => expect(cellText(2, 3)).toBe('Picked'));
    expect(account('Picked.kicad_sym')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(account('Picked.kicad_sym')).toBe('(kicad_symbol_lib)');
    expect(storedRows()).toContainEqual(['Picked', '/Symbols/Picked.kicad_sym', 'KiCad']);
  });

  it('refuses a library whose name the account already has', async () => {
    const errors: string[] = [];
    SetErrorPresenter((aText) => errors.push(aText));
    SYMBOLS.Write('Mine.kicad_sym', new TextEncoder().encode('(kicad_symbol_lib)'));
    pickedFiles.value = [new File(['(kicad_symbol_lib)'], 'Mine.kicad_sym')];
    openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));
    fireEvent.click(screen.getByText('KiCad from Computer...'));

    await vi.waitFor(() => expect(errors).toEqual(["Library 'Mine' already exists."]));
    expect(document.querySelector('td[data-row="2"]')).toBeNull();
  });

  it("offers the account's libraries no row names", () => {
    SYMBOLS.Write('Mine.kicad_sym', new TextEncoder().encode('(kicad_symbol_lib)'));
    SYMBOLS.Write('Other.kicad_sym', new TextEncoder().encode('(kicad_symbol_lib)'));
    openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add Existing' }));

    expect(screen.queryByText('Mine.kicad_sym')).toBeNull();
    fireEvent.click(screen.getByText('Other.kicad_sym'));
    expect(cellText(2, 3)).toBe('Other');
  });

  it('leaves a row whose file has gone missing as it is, not found', () => {
    openSym();
    fireEvent.click(screen.getAllByRole('tab')[0]!);
    // Mine.kicad_sym is not in the folder.
    expect(document.querySelector('td[data-row="1"][data-col="0"]')?.getAttribute('title')).toBe(
      "Library '/Symbols/Mine.kicad_sym' not found.",
    );
    fireEvent.mouseDown(document.querySelector('td[data-row="1"][data-col="1"]')!, { button: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(account('Mine.kicad_sym')).toBeNull();
  });

  it("makes the add button's row on the Project page a new library in the project", () => {
    const { onSave } = openSym();
    fireEvent.click(screen.getByRole('button', { name: 'Add empty row to table' }));
    typeNickname(2, 'Board');

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [rows, files] = onSave.mock.calls[0]!;
    expect(rows.map((r: { name: string; uri: string }) => [r.name, r.uri])).toEqual([
      ['proj', '${KIPRJMOD}/proj.kicad_sym'],
      ['gone', '${KIPRJMOD}/gone.kicad_sym'],
      ['Board', '${KIPRJMOD}/Board.kicad_sym'],
    ]);
    // Only the new one: "gone" stays missing.
    expect(files.map((f: { name: string }) => f.name)).toEqual(['demo/Board.kicad_sym']);
    expect(files[0].text).toMatch(/^\(kicad_symbol_lib\s+\(version \d+\)/);
  });
});
