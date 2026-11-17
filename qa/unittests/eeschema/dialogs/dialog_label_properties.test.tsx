// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DIALOG_LABEL_PROPERTIES over its _base: what the constructor shows per label type - the combo
 * for a label, no text entry / Orientation: / Pin length: / Dot .. Rectangle for a directive,
 * Input .. Passive for a global label, no Shape box for a local label; Multiple label input only
 * for a new label, swapping to the multi-line entry; Syntax help opening the frame's window.
 */
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import {
  DIALOG_LABEL_PROPERTIES,
  DialogLabelProperties,
} from '@ziroeda/eeschema/dialogs/dialog_label_properties.js';
import {
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_LABEL,
  type SCH_LABEL_BASE,
} from '@ziroeda/eeschema/sch_label.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schFrame, schToolHarness } from '../support/sch_tool_harness.js';
import { hiddenTakesNoFocus } from '../../common/support/hidden_takes_no_focus.js';

const HOST: GRID_TEXT_BUTTON_HOST = {
  ChooseFootprint: () => Promise.resolve(null),
  OpenFile: () => Promise.resolve(null),
  OpenDocument: () => {},
};

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  cleanup();
  SetPgm(null);
});

function open(aLabel: SCH_LABEL_BASE, aNew = false) {
  const h = schToolHarness(schFrame({}));
  if (aNew) aLabel.SetFlags(IS_NEW);
  else h.frame.AddToScreen(aLabel, h.frame.GetScreen());
  aLabel.SetParent(h.frame.Schematic());
  const help = vi.fn();
  h.frame.SetBusSyntaxHelpPresenter(help);
  const dlg = new DIALOG_LABEL_PROPERTIES(h.frame, aLabel, aNew, HOST);
  render(
    <DialogLabelProperties
      dlg={dlg}
      initial={dlg.TransferDataToWindow()}
      units="mils"
      onOk={() => {}}
      onCancel={() => {}}
    />,
  );
  return { help };
}

const shown = (l: string) => screen.queryByLabelText(l);

describe('DIALOG_LABEL_PROPERTIES_BASE', () => {
  it('a local label: the combo entry, no Shape box, Text size', () => {
    open(new SCH_LABEL({ x: 0, y: 0 }, 'A'));
    expect(screen.getByRole('dialog', { name: 'Label Properties' })).toBeTruthy();
    expect(screen.getAllByLabelText('Label').length).toBeGreaterThan(0);
    expect(shown('Input')).toBeNull();
    expect(screen.getByText('Text size:')).toBeTruthy();
  });

  it("a new label's text entry has the focus, so typing after L goes into it (blinky555, I-5)", () => {
    // SetInitialFocus( m_valueCombo->GetTextCtrl() ) (dialog_label_properties.cpp:67). The combo
    // focused itself on mount with autoFocus, while the window is still hidden for its first
    // layout - and a hidden control takes no focus.
    const restore = hiddenTakesNoFocus();
    try {
      open(new SCH_LABEL({ x: 0, y: 0 }, ''), true);
      const entry = document.activeElement as HTMLInputElement;
      expect(entry.tagName).toBe('INPUT');
      expect(entry.getAttribute('aria-label')).toBe('Label');
    } finally {
      restore();
    }
  });

  it('a global label: Input .. Passive, not the flag shapes', () => {
    open(new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'G'));
    expect(shown('Passive')).toBeTruthy();
    expect(shown('Diamond')).toBeNull();
  });

  it('a directive: no text entry, Orientation:, Pin length:, Dot .. Rectangle', () => {
    open(new SCH_DIRECTIVE_LABEL({ x: 0, y: 0 }));
    expect(screen.getByRole('dialog', { name: 'Directive Label Properties' })).toBeTruthy();
    expect(screen.queryByText('Syntax help')).toBeNull();
    expect(screen.getByText('Orientation:')).toBeTruthy();
    // m_fontCtrl, m_bold, m_italic and the separators hide.
    expect(screen.queryByTitle('Bold')).toBeNull();
    expect(screen.queryByText('Default Font')).toBeNull();
    expect(screen.getByText('Pin length:')).toBeTruthy();
    expect(shown('Diamond')).toBeTruthy();
    expect(shown('Input')).toBeNull();
  });

  it('Multiple label input only for a new label, and it swaps in the multi-line entry', () => {
    open(new SCH_LABEL({ x: 0, y: 0 }, 'A'));
    expect(shown('Multiple label input')).toBeNull();
    cleanup();
    open(new SCH_LABEL({ x: 0, y: 0 }, 'A'), true);
    fireEvent.click(screen.getByLabelText('Multiple label input'));
    expect(document.querySelector('textarea[aria-label="Label"]')).toBeTruthy();
  });

  it('Syntax help opens the frame syntax help, and the size is in the frame units', () => {
    const { help } = open(new SCH_LABEL({ x: 0, y: 0 }, 'A'));
    fireEvent.click(screen.getByText('Syntax help'));
    expect(help).toHaveBeenCalledTimes(1);
    expect(screen.getByText('mils')).toBeTruthy();
  });
});
