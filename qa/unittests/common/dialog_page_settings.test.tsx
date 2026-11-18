// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DIALOG_PAGES_SETTINGS over its _base, for the three frames that open it: eeschema shows the
 * sheet tallies and the fourteen "Export to other sheets" boxes, pcbnew hides both, pl_editor
 * relabels the headings; the custom size enables by paper; "<<<" copies the picker's date into
 * Issue Date; OK hands back the edited title block and the export ticks.
 */
import {
  DialogPageSettings,
  type PageSettingsFrame,
  type PageSettingsValue,
} from '@ziroeda/common/dialogs/dialog_page_settings.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const VALUE: PageSettingsValue = {
  paper: 'A4',
  portrait: false,
  customWidthMM: 431.8,
  customHeightMM: 279.4,
  date: '2026-01-01',
  rev: 'A',
  title: 'Board',
  company: 'Co',
  comments: ['', '', '', '', '', '', '', '', ''],
};

function open(aFrame: PageSettingsFrame, aValue: PageSettingsValue = VALUE) {
  const onOk = vi.fn();
  render(
    <DialogPageSettings
      value={aValue}
      frame={aFrame}
      units="mm"
      sheetCount={3}
      sheetNumber={2}
      onOk={onOk}
      onCancel={() => {}}
    />,
  );
  return { onOk };
}

describe('DIALOG_PAGES_SETTINGS_BASE', () => {
  it('eeschema: the sheet tallies and the fourteen export boxes', () => {
    open('eeschema');
    expect(screen.getByText('Number of sheets: 3')).toBeTruthy();
    expect(screen.getByText('Sheet number: 2')).toBeTruthy();
    expect(screen.getAllByLabelText('Export to other sheets').length).toBe(14);
  });

  it('pcbnew: no tallies, no export boxes', () => {
    open('pcbnew');
    expect(screen.queryByText(/Number of sheets/)).toBeNull();
    expect(screen.queryAllByLabelText('Export to other sheets').length).toBe(0);
    expect(screen.getByRole('dialog', { name: 'Page Settings' })).toBeTruthy();
  });

  it('pl_editor: the Preview headings', () => {
    open('pl_editor');
    expect(screen.getByRole('dialog', { name: 'Preview Settings' })).toBeTruthy();
    expect(screen.getByText('Preview Paper')).toBeTruthy();
    expect(screen.getByText('Preview Title Block Data')).toBeTruthy();
  });

  it('a standard paper disables the custom size; User enables it', () => {
    open('eeschema');
    expect((screen.getByTitle('Custom paper height.') as HTMLInputElement).disabled).toBe(true);
    // UNIT_BINDER::Enable( false ) greys the labels with the entries.
    expect(screen.getByText('Custom paper size:').className).toMatch(/disabled/);
    cleanup();
    open('eeschema', { ...VALUE, paper: 'User' });
    expect((screen.getByTitle('Custom paper height.') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText('Custom paper size:').className).not.toMatch(/disabled/);
  });

  it('Title: is the one label fgSizer2 adds with a 4 px border', () => {
    open('eeschema');
    const margin = (l: string) =>
      (screen.getByText(l).closest('.ze-szi') as HTMLElement).style.marginBottom;
    expect(margin('Title:')).toBe('4px');
    expect(margin('Company:')).toBe('5px');
  });

  it('<<< copies the picker date into Issue Date, and OK hands the title block back', () => {
    const { onOk } = open('eeschema');
    fireEvent.change(screen.getByLabelText('Pick date'), { target: { value: '2030-05-06' } });
    fireEvent.click(screen.getByText('<<<'));
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByText('OK'));
    const v = onOk.mock.calls[0]![0] as PageSettingsValue;
    expect(v.date).toBe('2030-05-06');
    expect(v.company).toBe('Acme');
  });

  it('a comment row carries its export box to OK', () => {
    const { onOk } = open('eeschema');
    const boxes = screen.getAllByLabelText('Export to other sheets');
    // [paper, date, rev, title, company, comment1..9]
    fireEvent.click(boxes[5]!);
    fireEvent.click(screen.getByText('OK'));
    expect(onOk.mock.calls[0]![1].comments[0]).toBe(true);
  });
});

describe('the custom paper size fields', () => {
  it("are wxDefaultSize text controls: the shell's measured entry width, not shrunk to fit", () => {
    // dialog_page_settings_base.cpp builds both with wxDefaultSize and wxEXPAND in fgSizer1, so
    // their column is a default entry's best width (--ctl-entry-width, measured). `size: 1` let
    // them shrink to 68 px, the mils value filling the field to the last pixel (uartbridge, U-4).
    open('eeschema');
    for (const tip of ['Custom paper height.', 'Custom paper width.']) {
      const field = screen.getByTitle(tip) as HTMLInputElement;
      expect(field.style.width).toBe('var(--ctl-entry-width)');
    }
  });
});
