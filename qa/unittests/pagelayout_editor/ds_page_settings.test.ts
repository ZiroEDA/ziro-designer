// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DSP-25 (the paper-size list) and the string half of DSP-24 (the dialog's
 * three pl_editor-only labels).
 *
 * `PAGE_INFO::standardPageSizes` (common/page_info.cpp:46-68) IS the combo:
 * `DIALOG_PAGES_SETTINGS::TransferDataToWindow` (:112-133) appends the whole
 * table in order, with nothing sorting or filtering it. The audit opened both
 * drop-downs and read them off; every difference below is a difference from
 * that table.
 */
import { describe, expect, it } from 'vitest';
import { PAPER_CHOICES, PAPER_MILS, PAPER_MM } from '@ziroeda/common';
import { pageSettingsLabels } from '@ziroeda/common/dialogs/dialog_page_settings.js';

describe('the paper-size combo', () => {
  it('is PAGE_INFO::standardPageSizes, row for row', () => {
    expect(PAPER_CHOICES.map((p) => p.label)).toEqual([
      'A5 148 x 210mm',
      'A4 210 x 297mm',
      'A3 297 x 420mm',
      'A2 420 x 594mm',
      'A1 594 x 841mm',
      'A0 841 x 1189mm',
      'A 8.5 x 11in',
      'B 11 x 17in',
      'C 17 x 22in',
      'D 22 x 34in',
      'E 34 x 44in',
      // PAGE_SIZE_TYPE::GERBER is declared with no _HKI description
      // (page_info.cpp:62), so its row really is blank.
      '',
      'User (Custom)',
      'US Letter 8.5 x 11in',
      'US Legal 8.5 x 14in',
      'US Ledger 11 x 17in',
    ]);
  });

  it('spaces the dimensions around the x', () => {
    // Ours had "148x210mm". Every description in the table has the spaces.
    for (const p of PAPER_CHOICES) {
      if (p.label === '' || p.label.startsWith('User')) continue;
      expect(p.label, p.id).toMatch(/\d x \d/);
    }
  });

  it('puts User (Custom) 13th, not last', () => {
    // The US sizes follow it in the table, so they follow it in the combo.
    expect(PAPER_CHOICES.findIndex((p) => p.id === 'User')).toBe(12);
    expect(PAPER_CHOICES[PAPER_CHOICES.length - 1]?.id).toBe('USLedger');
  });

  it('gives every row a size', () => {
    for (const p of PAPER_CHOICES) expect(PAPER_MM[p.id], p.id).toBeDefined();
  });

  it('has A5 at the mils MMsize( 210, 148 ) rounds to, not at 210 x 148', () => {
    // `MMsize` is `VECTOR2D( Mm2mils( x ), Mm2mils( y ) )` and `Mm2mils`
    // returns an int (page_info.cpp:38, eda_units.cpp:76), so the table's real
    // contents are 8268 x 5827 MILS — 210.0072 x 148.0058 mm. This expectation
    // used to read [210, 148] and was the reason our message panel printed
    // "Page Width 420.0000 mm" against a live pl_editor's "419.9890 mm".
    expect(PAPER_MILS.A5).toEqual([8268, 5827]);
    expect(PAPER_MM.A5![0]).toBeCloseTo((8268 * 25.4) / 1000, 9);
    expect(PAPER_MM.A5![1]).toBeCloseTo((5827 * 25.4) / 1000, 9);
    // …and the millimetres it came from still round back to it.
    expect(Math.round((210 * 1000) / 25.4)).toBe(8268);
    expect(Math.round((148 * 1000) / 25.4)).toBe(5827);
  });
});

describe('DSP-24 — the dialog is "Preview Settings" in this frame', () => {
  /*
   * This used to read the two component files as TEXT and grep them for
   * `>Preview Paper<`, which is CLAUDE.md's "a rule scoped to the directory a
   * bug was found in" twice over: it pinned the SPELLING of one copy of the
   * dialog, and it could only ever check one copy at a time — which is how the
   * schematic's copy went two audits without one.
   *
   * There is one dialog now and one table of labels, and the table is a `.ts`,
   * so the branch itself is run.
   */
  it('re-labels the three strings pl_editor re-labels', () => {
    // dialog_page_settings.cpp:83-88, the PL_EDITOR_FRAME_NAME branch.
    expect(pageSettingsLabels('pl_editor')).toEqual({
      title: 'Preview Settings',
      paper: 'Preview Paper',
      titleBlock: 'Preview Title Block Data',
    });
  });

  it('leaves the other two frames on the else branch’s wording', () => {
    // :90-93 — "Page Settings" / "Paper" / "Title Block", for BOTH of them.
    for (const frame of ['eeschema', 'pcbnew'] as const) {
      expect(pageSettingsLabels(frame), frame).toEqual({
        title: 'Page Settings',
        paper: 'Paper',
        titleBlock: 'Title Block',
      });
    }
  });

  it('never shows the .fbp\u2019s own "Title Block Parameters"', () => {
    // dialog_page_settings_base.cpp:183 sets it, and BOTH arms of the ctor
    // branch overwrite it, so no frame ever renders that string.
    for (const frame of ['eeschema', 'pcbnew', 'pl_editor'] as const)
      expect(pageSettingsLabels(frame).titleBlock).not.toBe('Title Block Parameters');
  });
});
