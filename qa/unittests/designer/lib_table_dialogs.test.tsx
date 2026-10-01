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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogFpLibTable } from '@ziroeda/pcbnew/dialogs/panel_fp_lib_table.js';
import { DialogSymLibTable } from '@ziroeda/designer/src/widgets/dialog_sym_lib_table.js';

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
    expect(cellText(1, 4)).toBe('https://libs/power.kicad_sym');
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

  it('opens the options editor on a double-click in Options', () => {
    openSym();
    const options = document.querySelector('td[data-row="0"][data-col="6"]')!;
    fireEvent.mouseDown(options, { button: 0, detail: 2 });
    expect(screen.getByText("Options for Library 'proj'")).toBeTruthy();
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
    expect(onSave).toHaveBeenCalledWith([]);
  });
});
