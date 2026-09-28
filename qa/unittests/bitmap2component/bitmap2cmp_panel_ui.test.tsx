// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BITMAP2CMP_PANEL`'s window (`bitmap2cmp_panel_ui.tsx`), rendered.
 *
 * `BITMAP2CMP_PANEL`'s constructor disables exactly two controls,
 * `m_buttonExportFile` and `m_buttonExportClipboard`; the tabs, both size
 * fields, the unit choice and the slider are live from the first frame, and
 * the Layer choice greys off the FORMAT (`OnFormatChange`), never off the
 * image. Each control must call the panel's own handler, so the window can
 * decide nothing the panel did not.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { YesNoResult } from '@ziroeda/common/confirm_types.js';
import {
  CreateKiWindow,
  FOOTPRINT_FMT,
  SYMBOL_FMT,
  type BITMAP2CMP_FRAME,
  type BITMAP2CMP_FRAME_UI,
  type IMAGE_FILE,
} from '@ziroeda/bitmap2component';
import { Bitmap2cmpPanel } from '@ziroeda/bitmap2component/bitmap2cmp_panel_ui.js';

afterEach(cleanup);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function square(): IMAGE_FILE {
  const data = new Uint8ClampedArray(24 * 24 * 4);
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const on = x >= 6 && x < 18 && y >= 6 && y < 18;
      data.set(on ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * 24 + x) * 4);
    }
  return { name: 'logo.png', bytes: PNG, rgba: { data, width: 24, height: 24 } };
}

/** The window, as ImageConverter.tsx hosts it: a frame and a version counter. */
function mount(lastFormat: number): { frame: () => BITMAP2CMP_FRAME } {
  let frameRef: BITMAP2CMP_FRAME | null = null;

  function Host(): JSX.Element {
    const [version, setVersion] = useState(0);
    const [frame] = useState(() => {
      const ui: BITMAP2CMP_FRAME_UI = {
        MessageBox: () => {},
        AskYesNo: () => Promise.resolve<YesNoResult>('yes'),
        SetClipboardText: () => Promise.resolve(true),
        Refresh: () => setVersion((v) => v + 1),
        ChooseImageFile: () => Promise.resolve(null),
        SaveFile: () => true,
        SetTitle: () => {},
        SetStatusText: () => {},
        UpdateFileHistory: () => {},
        Close: () => {},
      };
      return CreateKiWindow(ui, { last_format: lastFormat });
    });
    frameRef = frame;
    return (
      <Bitmap2cmpPanel
        panel={frame.GetPanel()}
        dropTarget={frame.GetDropTarget()}
        version={version}
      />
    );
  }

  render(<Host />);
  return { frame: () => frameRef! };
}

const button = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement;
const sizeFields = (): HTMLInputElement[] =>
  [...document.querySelectorAll('.imgc-sizerow input')] as HTMLInputElement[];

describe('before any image is loaded', () => {
  it('disables exactly the two export buttons', () => {
    mount(SYMBOL_FMT);
    expect(button('Export to File...').disabled).toBe(true);
    expect(button('Export to Clipboard').disabled).toBe(true);
    expect(button('Load Source Image').disabled).toBe(false);
    for (const tab of screen.getAllByRole('tab'))
      expect((tab as HTMLButtonElement).disabled).toBe(false);
    for (const f of sizeFields()) expect(f.disabled).toBe(false);
    expect((document.querySelector('.imgc-slider input') as HTMLInputElement).disabled).toBe(false);
  });

  it('shows "0.0" in both size fields and "0000" in the image information', () => {
    mount(SYMBOL_FMT);
    expect(sizeFields().map((f) => f.value)).toEqual(['0.0', '0.0']);
    expect(document.querySelectorAll('.imgc-info .v')[0]!.textContent).toBe('0000');
  });

  it('opens on the Black & White page, the one AddPage selects', () => {
    mount(SYMBOL_FMT);
    const selected = screen
      .getAllByRole('tab')
      .filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.map((t) => t.textContent)).toEqual(['Black & White Picture']);
  });
});

describe('the Layer choice follows the format', () => {
  it('is grey, label and all, while Symbol is chosen, and live once Footprint is', () => {
    mount(SYMBOL_FMT);
    const row = document.querySelector('.imgc-layerrow')!;
    expect(row.classList.contains('disabled')).toBe(true);
    const footprint = screen.getByLabelText('Footprint (.kicad_mod file)') as HTMLInputElement;
    act(() => {
      fireEvent.click(footprint);
    });
    expect(document.querySelector('.imgc-layerrow')!.classList.contains('disabled')).toBe(false);
  });

  it('is live on a restored Footprint format', () => {
    mount(FOOTPRINT_FMT);
    expect(document.querySelector('.imgc-layerrow')!.classList.contains('disabled')).toBe(false);
    expect((screen.getByLabelText('Footprint (.kicad_mod file)') as HTMLInputElement).checked).toBe(
      true,
    );
  });
});

describe('the controls drive the panel', () => {
  it('a load fills the information and enables the exports', () => {
    const { frame } = mount(SYMBOL_FMT);
    act(() => {
      frame().OpenProjectFiles([square()]);
      frame().GetPanel().OnThresholdChange(50); // any handler's Refresh()
    });
    expect([...document.querySelectorAll('.imgc-info .v')].map((v) => v.textContent)).toEqual([
      '24',
      '24',
      '300',
      '300',
      '24',
    ]);
    expect(button('Export to File...').disabled).toBe(false);
    expect(sizeFields().map((f) => f.value)).toEqual(['2.0', '2.0']);
  });

  it('typing in a size field goes through OnSizeChangeX', () => {
    const { frame } = mount(SYMBOL_FMT);
    act(() => {
      frame().OpenProjectFiles([square()]);
    });
    act(() => {
      fireEvent.change(sizeFields()[0]!, { target: { value: '4' } });
    });
    // locked, square: Y = 4 / 1, printed %.1f
    expect(sizeFields().map((f) => f.value)).toEqual(['4', '4.0']);
    expect(frame().GetPanel().GetOutputSizeX().GetOutputDPI()).toBe(152);
  });

  it('a tab click only selects a page', () => {
    const { frame } = mount(SYMBOL_FMT);
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Original Picture' }));
    });
    expect(frame().GetPanel().GetCurrentPage()).toBe(0);
    expect(document.querySelectorAll('.imgc-view.active')).toHaveLength(1);
  });
});
