// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** PANEL_BOM_PRESETS on two read-only WX_GRIDs (panel_bom_presets.cpp). */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type BomPresets,
  PanelBomPresets,
} from '@ziroeda/eeschema/dialogs/panel_bom_presets.js';

afterEach(cleanup);

const VALUE = {
  presets: [{ name: 'Grouped' }, { name: 'Flat' }],
  fmtPresets: [{ name: 'CSV' }],
} as unknown as BomPresets;

describe('BOM Presets', () => {
  it('lists both preset sets, read-only', () => {
    render(<PanelBomPresets value={VALUE} onChange={() => {}} />);
    expect(screen.getByText('Grouped')).toBeTruthy();
    expect(screen.getByText('CSV')).toBeTruthy();
    const td = screen.getByText('Flat').closest('td') as HTMLElement;
    fireEvent.mouseDown(td, { button: 0 });
    fireEvent.mouseUp(td);
    fireEvent.doubleClick(td);
    expect(td.querySelector('input')).toBeNull();
  });

  it('deletes the cursor row of the grid its button is under', () => {
    let next: BomPresets | null = null;
    render(<PanelBomPresets value={VALUE} onChange={(v) => (next = v)} />);
    const td = screen.getByText('Flat').closest('td') as HTMLElement;
    fireEvent.mouseDown(td, { button: 0 });
    fireEvent.click(screen.getByLabelText('Delete preset'));
    expect(next!.presets.map((p) => p.name)).toEqual(['Grouped']);
    expect(next!.fmtPresets.map((p) => p.name)).toEqual(['CSV']);
  });
});
