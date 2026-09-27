// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Solder Mask/Paste: KiCad 10 enters the paste clearance and its
 * ratio in ONE field through MARGIN_OFFSET_BINDER, and hides the old ratio row
 * (pcbnew/dialogs/panel_setup_mask_and_paste.cpp:38-56, 68-69, 86-87).
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultMaskPaste,
  type MaskPaste,
  PanelPcbMaskPaste,
} from '@ziroeda/designer/src/editors/pcb/dialogs/panels/panel_pcb_mask_paste.js';

afterEach(cleanup);

const field = (): HTMLInputElement => {
  const row = Array.from(document.querySelectorAll('.ze-pref-row')).find((r) =>
    r.textContent?.includes('Solder paste clearance:'),
  );
  return row?.querySelector('input') as HTMLInputElement;
};

describe('the solder paste clearance field', () => {
  it('is one field; there is no relative-clearance row', () => {
    render(<PanelPcbMaskPaste value={defaultMaskPaste()} onChange={() => {}} />);
    expect(field()).toBeTruthy();
    expect(document.body.textContent).not.toContain('relative clearance');
  });

  it('shows the margin and the ratio together', () => {
    const value: MaskPaste = {
      ...defaultMaskPaste(),
      pasteClearanceMM: -0.1,
      pasteRelativePct: -5,
    };
    render(<PanelPcbMaskPaste value={value} onChange={() => {}} />);
    expect(field().value).toBe('-0.1 - 5%');
  });

  it('writes both halves back from what was typed', () => {
    let last: MaskPaste | null = null;
    render(<PanelPcbMaskPaste value={defaultMaskPaste()} onChange={(v) => (last = v)} />);
    fireEvent.change(field(), { target: { value: '0.05mm+2%' } });
    fireEvent.blur(field());
    expect(field().value).toBe('0.05 + 2%');
    expect(last!.pasteClearanceMM).toBeCloseTo(0.05);
    expect(last!.pasteRelativePct).toBeCloseTo(2);
  });
});
