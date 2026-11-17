// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_BARCODE_PROPERTIES's window (dialog_barcode_properties.cpp) on its base: OnUpdateUI's
 * Error Correction box (live for QR codes only, with Level H greyed for Micro QR), the margins
 * following Knockout, and OK raising the commit error as an error dialog.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BarcodeValues,
  DialogBarcodeProperties,
} from '@ziroeda/pcbnew/dialogs/dialog_barcode_properties.js';

afterEach(cleanup);

const VALUES: BarcodeValues = {
  text: 'ABC',
  locked: false,
  layer: 'F.SilkS',
  at: { x: 0, y: 0 },
  width: 5_000_000,
  height: 5_000_000,
  textHeight: 1_000_000,
  angle: 0,
  knockout: false,
  margin: { x: 0, y: 0 },
  showText: false,
  kind: 'qr',
  ecc: 'M',
};

function show(aCommitError = '') {
  const onApply = vi.fn();
  render(
    <DialogBarcodeProperties
      units="mm"
      preview={() => ({ rings: [], bbox: { x1: 0, y1: 0, x2: 0, y2: 0 } })}
      commitError={() => aCommitError}
      initial={VALUES}
      layers={['F.SilkS']}
      layerColor={() => '#fff'}
      layerLabel={(l: string) => l}
      background="#000"
      onApply={onApply}
      onClose={() => {}}
    />,
  );
  return { onApply };
}

const radio = (aLabel: string) => screen.getByLabelText(aLabel) as HTMLInputElement;

describe('DIALOG_BARCODE_PROPERTIES window', () => {
  it('Error Correction is live for QR, greys Level H for Micro QR, and dies for Code 39', () => {
    show();
    expect(radio('~65% (Level H)').disabled).toBe(false);
    fireEvent.click(radio('Micro QR Code'));
    expect(radio('~65% (Level H)').disabled).toBe(true);
    expect(radio('~37% (Level M)').disabled).toBe(false);
    fireEvent.click(radio('Code 39 (ISO 16388)'));
    expect(radio('~37% (Level M)').disabled).toBe(true);
  });

  it('the margins follow Knockout', () => {
    show();
    const margin = () => screen.getByRole('textbox', { name: 'Min margin X' }) as HTMLInputElement;
    expect(margin().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Knockout'));
    expect(margin().disabled).toBe(false);
  });

  it('OK with a commit error raises it and does not apply', () => {
    const { onApply } = show('Invalid barcode text.');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText('Invalid barcode text.')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });
});
