// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * WX_UNIT_ENTRY_DIALOG / WX_PT_ENTRY_DIALOG (dialog_unit_entry.cpp) and
 * WX_MULTI_ENTRY_DIALOG (dialog_multi_unit_entry.cpp).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import {
  WX_PT_ENTRY_DIALOG,
  WX_UNIT_ENTRY_DIALOG,
} from '@ziroeda/common/dialogs/dialog_unit_entry.js';
import { WX_MULTI_ENTRY_DIALOG } from '@ziroeda/common/dialogs/dialog_multi_unit_entry.js';

afterEach(cleanup);

const MM = 1_000_000;

describe('WX_UNIT_ENTRY_DIALOG', () => {
  it('shows the value in the frame’s units and hands back IU', () => {
    const onResult = vi.fn();
    render(
      <WX_UNIT_ENTRY_DIALOG
        caption="Fillet Lines"
        label="Radius:"
        defaultValue={MM}
        units="mm"
        iuScale={pcbIUScale}
        onResult={onResult}
      />,
    );
    expect(screen.getByText('Fillet Lines')).toBeTruthy();
    expect(screen.getByText('mm')).toBeTruthy();
    const entry = screen.getByLabelText('Radius:') as HTMLInputElement;
    expect(Number(entry.value)).toBe(1);
    fireEvent.change(entry, { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onResult).toHaveBeenCalledWith(2.5 * MM);
  });

  it('Cancel is null', () => {
    const onResult = vi.fn();
    render(
      <WX_UNIT_ENTRY_DIALOG
        caption="C"
        label="L:"
        defaultValue={MM}
        units="mm"
        iuScale={pcbIUScale}
        onResult={onResult}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenCalledWith(null);
  });
});

describe('WX_PT_ENTRY_DIALOG', () => {
  it('returns both coordinates, and Reset zeroes them', () => {
    const onResult = vi.fn();
    render(
      <WX_PT_ENTRY_DIALOG
        caption="C"
        labelX="X:"
        labelY="Y:"
        defaultValue={{ x: MM, y: 2 * MM }}
        showResetButton
        units="mm"
        iuScale={pcbIUScale}
        onResult={onResult}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onResult).toHaveBeenCalledWith({ x: 0, y: 0 });
  });
});

describe('WX_MULTI_ENTRY_DIALOG', () => {
  it('returns IU for a unit-bound entry and the state for a checkbox, in order', () => {
    const onResult = vi.fn();
    render(
      <WX_MULTI_ENTRY_DIALOG
        caption="Dogbone Corner Settings"
        entries={[
          { label: 'Arc radius:', value: { UNIT_BOUND: MM } },
          { label: 'Add slots in acute corners', value: { CHECKBOX: true } },
        ]}
        units="mm"
        iuScale={pcbIUScale}
        onResult={onResult}
      />,
    );
    fireEvent.click(screen.getByLabelText('Add slots in acute corners'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onResult).toHaveBeenCalledWith([MM, false]);
  });
});

describe('the board editor asks as edit_tool.cpp does', () => {
  const src = readFileSync(
    resolve(process.cwd(), '../designer/src/editors/pcb/PcbEditor.tsx'),
    'utf8',
  );

  it('Fillet / Chamfer through WX_UNIT_ENTRY_DIALOG, with upstream’s labels', () => {
    expect(src).toContain('<WX_UNIT_ENTRY_DIALOG');
    expect(src).toContain("'Chamfer setback:'");
    expect(src).toContain('if (v === null || v === 0) return;');
  });

  it('Dogbone through WX_MULTI_ENTRY_DIALOG, and the slots answer reaches the engine', () => {
    expect(src).toContain('caption="Dogbone Corner Settings"');
    expect(src).toContain("label: 'Add slots in acute corners'");
    expect(src).not.toMatch(/addSlots:\s*true/);
  });
});
