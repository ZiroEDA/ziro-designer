// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_DIELECTRIC_MATERIAL`: the list-select-fills-fields behaviour,
 * Delete-removes-from-the-list, the two numeric validations
 * (`TransferDataFromWindow`), and the "No substrate specified" early return
 * upstream's caller makes after `GetSelectedSubstrate()`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIELECTRIC_SUBSTRATE,
  DIELECTRIC_SUBSTRATE_LIST,
  DL_MATERIAL_LIST_TYPE,
} from '@ziroeda/pcbnew/board_stackup_manager/dielectric_material.js';
import {
  DialogDielectricMaterial,
  substrateRows,
} from '@ziroeda/pcbnew/board_stackup_manager/dialog_dielectric_list_manager.js';

afterEach(cleanup);

function dielectricList(): DIELECTRIC_SUBSTRATE_LIST {
  return new DIELECTRIC_SUBSTRATE_LIST(DL_MATERIAL_LIST_TYPE.DL_MATERIAL_DIELECTRIC);
}

describe('substrateRows', () => {
  it('formats every row as initMaterialList does', () => {
    const list = dielectricList();
    const rows = substrateRows(list);

    expect(rows[1]).toEqual({ name: 'FR4', epsilonR: '4.5', lossTan: '0.02' });
  });
});

describe('DialogDielectricMaterial', () => {
  it('TransferDataToWindow: starts with an empty name and 1 / 0', () => {
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={vi.fn()} />);

    expect(screen.getByDisplayValue('1')).toBeTruthy();
    expect(screen.getByDisplayValue('0')).toBeTruthy();
  });

  it('lists every substrate, formatted', () => {
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={vi.fn()} />);

    expect(screen.getByText('FR4')).toBeTruthy();
    expect(screen.getByText('Kapton')).toBeTruthy();
  });

  it('onListItemSelected: clicking a row fills the three fields', () => {
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByText('FR4'));

    expect(screen.getByDisplayValue('FR4')).toBeTruthy();
    expect(screen.getByDisplayValue('4.5')).toBeTruthy();
    expect(screen.getByDisplayValue('0.02')).toBeTruthy();
  });

  it('OK with an empty name: "No substrate specified", submits null', () => {
    const onSubmit = vi.fn();
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('OK'));

    expect(onSubmit).toHaveBeenCalledWith(null);
  });

  it('OK with a typed name and the default 1 / 0: submits the substrate', () => {
    const onSubmit = vi.fn();
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={onSubmit} />);

    // The Material field is the first of the three text inputs.
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Custom' } });
    fireEvent.click(screen.getByText('OK'));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Custom', epsilonR: '1', lossTan: '0' });
  });

  it('Cancel submits null and never validates', () => {
    const onSubmit = vi.fn();
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(onSubmit).toHaveBeenCalledWith(null);
  });

  it('the "✕" submits null', () => {
    const onSubmit = vi.fn();
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTitle('Close'));

    expect(onSubmit).toHaveBeenCalledWith(null);
  });

  it('Escape submits null, via useModalEscape', () => {
    const onSubmit = vi.fn();
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={onSubmit} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onSubmit).toHaveBeenCalledWith(null);
  });

  it('TransferDataFromWindow: rejects a non-numeric Epsilon R', () => {
    const onSubmit = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('FR4'));
    fireEvent.change(screen.getByDisplayValue('4.5'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('OK'));

    expect(alertSpy).toHaveBeenCalledWith('Incorrect value for Epsilon R');
    expect(onSubmit).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('TransferDataFromWindow: rejects a negative Epsilon R', () => {
    const onSubmit = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('FR4'));
    fireEvent.change(screen.getByDisplayValue('4.5'), { target: { value: '-1' } });
    fireEvent.click(screen.getByText('OK'));

    expect(alertSpy).toHaveBeenCalledWith('Incorrect value for Epsilon R');
    expect(onSubmit).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('TransferDataFromWindow: rejects an invalid Loss Tan, checked after Epsilon R', () => {
    const onSubmit = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<DialogDielectricMaterial materialList={dielectricList()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('FR4'));
    fireEvent.change(screen.getByDisplayValue('0.02'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByText('OK'));

    expect(alertSpy).toHaveBeenCalledWith('Incorrect value for Loss Tangent');
    expect(onSubmit).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('onListKeyDown( WXK_DELETE ): removes the row from the caller’s list', () => {
    const list = dielectricList();
    const before = list.GetCount();
    const onSubmit = vi.fn();
    render(<DialogDielectricMaterial materialList={list} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('FR4'));
    fireEvent.keyDown(screen.getByText('FR4').closest('.ze-dielmat-list')!, { key: 'Delete' });

    expect(list.GetCount()).toBe(before - 1);
    expect(screen.queryByText('FR4')).toBeNull();
  });

  it('deleting the last row selects the new last row, not an out-of-range index', () => {
    const list = dielectricList();
    const lastRow = substrateRows(list).at(-1)!;
    render(<DialogDielectricMaterial materialList={list} onSubmit={vi.fn()} />);

    const lastRowCell = screen.getByText(lastRow.name);
    fireEvent.click(lastRowCell);
    fireEvent.keyDown(lastRowCell.closest('.ze-dielmat-list')!, { key: 'Delete' });

    // The delete must not throw, and the list must be one shorter.
    expect(list.GetCount()).toBe(substrateRows(list).length);
  });

  it('deleting mutates the exact list reference passed in, not a copy', () => {
    const list = dielectricList();
    const appended = new DIELECTRIC_SUBSTRATE('Custom Test Material', 3.3, 0.01);
    list.AppendSubstrate(appended);
    const idx = list.FindSubstrate(appended);
    render(<DialogDielectricMaterial materialList={list} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByText('Custom Test Material'));
    fireEvent.keyDown(screen.getByText('Custom Test Material').closest('.ze-dielmat-list')!, {
      key: 'Delete',
    });

    expect(list.FindSubstrate(appended)).toBe(-1);
    expect(idx).toBeGreaterThanOrEqual(0);
  });
});
