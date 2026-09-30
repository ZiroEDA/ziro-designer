// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The controls of DIALOG_TARGET_PROPERTIES (dialog_target_properties_base.cpp).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { DialogTargetProperties } from '@ziroeda/pcbnew/dialogs/dialog_target_properties_ui.js';
import type { TargetValues } from '@ziroeda/pcbnew/dialogs/dialog_target_properties.js';

afterEach(cleanup);

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const initial: TargetValues = { size: MM(4), thickness: MM(0.2), shape: 1 };
const field = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

describe('DialogTargetProperties', () => {
  it('shows the values in the frame units, and the labels the base file states', () => {
    render(
      <DialogTargetProperties
        initial={initial}
        units="mm"
        onApply={() => ({ ok: true })}
        onClose={() => {}}
      />,
    );
    for (const l of ['Size:', 'Thickness:', 'Shape:']) expect(screen.getByText(l)).toBeTruthy();
    expect(field('ze-tgt-size').value).toBe('4');
    expect(field('ze-tgt-thickness').value).toBe('0.2');
    expect(screen.getByLabelText('Shape').textContent).toContain('X');
  });

  it('OK hands over IU parsed from what was typed, and closes on ok', () => {
    const onApply = vi.fn(() => ({ ok: true }));
    const onClose = vi.fn();
    render(
      <DialogTargetProperties initial={initial} units="mm" onApply={onApply} onClose={onClose} />,
    );
    fireEvent.change(field('ze-tgt-size'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ size: MM(6), thickness: MM(0.2), shape: 1 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a refusal stays open with its message and the cursor back in Size', () => {
    const onClose = vi.fn();
    render(
      <DialogTargetProperties
        initial={initial}
        units="mm"
        onApply={() => ({ ok: false, message: 'Size must be at least 0.0254 mm.' })}
        onClose={onClose}
      />,
    );
    field('ze-tgt-thickness').focus();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText('Size must be at least 0.0254 mm.')).toBeTruthy();
    expect(document.activeElement).toBe(field('ze-tgt-size'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without applying', () => {
    const onApply = vi.fn(() => ({ ok: true }));
    const onClose = vi.fn();
    render(
      <DialogTargetProperties initial={initial} units="mm" onApply={onApply} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
