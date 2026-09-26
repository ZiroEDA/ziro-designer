// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DIALOG_PRINT_GENERIC (common/dialogs/dialog_print_generic.cpp), the base the
 * board's print dialog derives from.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIALOG_PRINT_GENERIC,
  getScaleValue,
  MAX_SCALE,
  MIN_SCALE,
  setScaleValue,
} from '@ziroeda/common/dialogs/dialog_print_generic.js';

afterEach(cleanup);

describe('getScaleValue / setScaleValue (:128-196)', () => {
  it('keeps upstream’s clamps', () => {
    expect([MIN_SCALE, MAX_SCALE]).toEqual([0.01, 100.0]);
  });

  it('1:1 is 1 and Fit to page is 0', () => {
    expect(getScaleValue('1:1', 'x').scale).toBe(1);
    expect(getScaleValue('fit', 'x').scale).toBe(0);
  });

  it('a custom text that is not a number becomes 1:1, with the info message', () => {
    expect(getScaleValue('custom', 'abc')).toEqual({
      scale: 1,
      reset: { mode: '1:1' },
      info: 'Warning: custom scale is not a number.',
    });
  });

  it('clamps a large custom scale and writes it back with %f', () => {
    expect(getScaleValue('custom', '250')).toEqual({
      scale: 100,
      reset: { mode: 'custom', text: '100.000000' },
      info: 'Warning: custom scale is too large.\nIt will be clamped to 100.000000.',
    });
  });

  it('clamps a small one the same way', () => {
    expect(getScaleValue('custom', '0.001')).toEqual({
      scale: 0.01,
      reset: { mode: 'custom', text: '0.010000' },
      info: 'Warning: custom scale is too small.\nIt will be clamped to 0.010000.',
    });
  });

  it('passes a good custom scale through untouched', () => {
    expect(getScaleValue('custom', '2.5')).toEqual({ scale: 2.5 });
  });

  it('setScaleValue: 0 is Fit, 1 is 1:1, anything else Custom, silently clamped', () => {
    expect(setScaleValue(0)).toEqual({ mode: 'fit' });
    expect(setScaleValue(1)).toEqual({ mode: '1:1' });
    expect(setScaleValue(500)).toEqual({ mode: 'custom', text: '100.000000' });
  });
});

describe('DIALOG_PRINT_GENERIC', () => {
  const dlg = (extra: Partial<Parameters<typeof DIALOG_PRINT_GENERIC>[0]> = {}) =>
    render(
      <DIALOG_PRINT_GENERIC
        blackWhite={false}
        onBlackWhite={() => {}}
        titleBlock
        onTitleBlock={() => {}}
        scaleMode="1:1"
        onScaleMode={() => {}}
        customScale="1"
        onCustomScale={() => {}}
        onPrint={() => {}}
        onClose={() => {}}
        {...extra}
      />,
    );

  it('has Close and Print; Print Preview is hidden on GTK, and Page Setup is the browser’s', () => {
    dlg();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Print Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Page Setup/ })).toBeNull();
  });

  it('has the base’s Options and Scale boxes', () => {
    dlg();
    expect(screen.getByText('Options')).toBeTruthy();
    expect(screen.getByText('Output mode:')).toBeTruthy();
    expect(screen.getByText('Print drawing sheet')).toBeTruthy();
    expect(screen.getByText('Scale')).toBeTruthy();
    for (const r of ['1:1', 'Fit to page', 'Custom:']) expect(screen.getByText(r)).toBeTruthy();
  });

  it('puts the derived dialog’s pane first and its rows after Print drawing sheet', () => {
    const { container } = dlg({
      leading: <div data-testid="lead">Include Layers</div>,
      extraOptions: <span data-testid="extra">Print mirrored</span>,
    });
    const upper = container.ownerDocument.querySelector('.ze-printdlg-upper')!;
    expect(upper.firstElementChild?.getAttribute('data-testid')).toBe('lead');
    const grid = container.ownerDocument.querySelector('.ze-printdlg-optgrid')!;
    expect(grid.lastElementChild?.getAttribute('data-testid')).toBe('extra');
  });
});
