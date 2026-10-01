// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** DIALOG_ITEMS_LIST (dialog_items_list.cpp). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DialogItemsList } from '@ziroeda/pcbnew/dialogs/dialog_items_list.js';

afterEach(cleanup);

const open = (onSelect = vi.fn(), onResult = vi.fn()) => {
  render(
    <DialogItemsList
      title="Warning"
      message="Items have been found on removed layers."
      detailsLabel="Show Details"
      items={['Track on In2.Cu', 'Pad 1 of U1 on In2.Cu']}
      onSelect={onSelect}
      onResult={onResult}
    />,
  );
  return { onSelect, onResult };
};

describe('DIALOG_ITEMS_LIST', () => {
  it('shows the message and opens with the details pane collapsed', () => {
    open();
    expect(screen.getByText('Items have been found on removed layers.')).toBeTruthy();
    expect(screen.queryByText('Track on In2.Cu')).toBeNull();
  });

  it('Show Details lists every item, and selecting a row reports its index', () => {
    const { onSelect } = open();
    fireEvent.click(screen.getByText('Show Details'));
    expect(screen.getByText('Pad 1 of U1 on In2.Cu')).toBeTruthy();
    fireEvent.mouseDown(screen.getByText('Pad 1 of U1 on In2.Cu'));
    expect(onSelect).toHaveBeenCalledWith(1);
    fireEvent.mouseDown(screen.getByText('Track on In2.Cu'));
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });

  it('OK is wxID_OK and Cancel is not', () => {
    const { onResult } = open();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onResult).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenLastCalledWith(false);
  });
});
