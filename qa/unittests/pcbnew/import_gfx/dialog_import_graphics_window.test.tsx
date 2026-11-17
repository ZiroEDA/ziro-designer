// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_IMPORT_GRAPHICS's window (dialog_import_graphics.cpp) on its base: onUpdateUI's
 * greying, onFilename's DXF controls, and TransferDataFromWindow's refusals.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogImportGraphics } from '@ziroeda/pcbnew/import_gfx/dialog_import_graphics.js';

afterEach(cleanup);

function show() {
  const onOk = vi.fn();
  render(
    <DialogImportGraphics
      units="mm"
      layers={['Dwgs.User', 'F.SilkS']}
      layerColor={() => '#fff'}
      layerLabel={(l: string) => l}
      activeLayer="F.SilkS"
      parent={null}
      invertX={false}
      invertY={false}
      onOk={onOk}
      onCancel={() => {}}
    />,
  );
  return { onOk };
}

const textbox = (aName: string) => screen.getByRole('textbox', { name: aName }) as HTMLInputElement;

describe('DIALOG_IMPORT_GRAPHICS window', () => {
  it('OK with no file says so and imports nothing', () => {
    const { onOk } = show();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText('Please select a file to import.')).toBeTruthy();
    expect(onOk).not.toHaveBeenCalled();
  });

  it('X and Y follow Place at, and Tolerance follows Fix discontinuities', () => {
    show();
    expect(textbox('X').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Place at:'));
    expect(textbox('X').disabled).toBe(false);
    expect(textbox('Y').disabled).toBe(false);
    expect(textbox('Tolerance').disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Fix discontinuities'));
    expect(textbox('Tolerance').disabled).toBe(true);
  });

  it('the DXF line width is live for a DXF name and dead for an SVG one', () => {
    show();
    fireEvent.change(textbox('File'), { target: { value: 'board.svg' } });
    expect(textbox('DXF default line width').disabled).toBe(true);
    fireEvent.change(textbox('File'), { target: { value: 'board.dxf' } });
    expect(textbox('DXF default line width').disabled).toBe(false);
  });

  it('the layer box follows the Layer: check', () => {
    show();
    const layer = () => screen.getByRole('button', { name: 'Layer' }) as HTMLButtonElement;
    expect(layer().disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Layer:'));
    expect(layer().disabled).toBe(true);
  });
});
