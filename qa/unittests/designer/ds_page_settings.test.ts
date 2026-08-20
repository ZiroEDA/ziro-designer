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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAPER_CHOICES, PAPER_MM } from '@ziroeda/common';
import {
  previewPageMM,
  defaultPreviewSettings,
} from '@ziroeda/designer/src/editors/drawingsheet/preview_settings.js';

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

  it('has A5 at 210 x 148, as the C++ declares it', () => {
    // MMsize( 210, 148 ) — ours had 148.5.
    expect(PAPER_MM.A5).toEqual([210, 148]);
  });

  it('swaps width and height for portrait', () => {
    const s = { ...defaultPreviewSettings(), paper: 'A3', portrait: true };
    expect(previewPageMM(s)).toEqual([297, 420]);
    expect(previewPageMM({ ...s, portrait: false })).toEqual([420, 297]);
  });
});

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('DSP-24 — the dialog is "Preview Settings" in this frame', () => {
  const DIALOG = read('../../../designer/src/editors/drawingsheet/PageSettingsDialog.tsx');

  it('re-labels the three strings pl_editor re-labels', () => {
    // dialog_page_settings.cpp:82-88, the PL_EDITOR_FRAME_NAME branch.
    expect(DIALOG).toContain('Preview Settings');
    expect(DIALOG).toContain('>Preview Paper<');
    expect(DIALOG).toContain('Preview Title Block Data');
  });

  it('leaves the other frames on the else branch’s wording', () => {
    // :90-92 — "Page Settings" / "Paper" / "Title Block".
    const SCH = read('../../../designer/src/editors/schematic/dialogs/dialog_page_settings.tsx');
    expect(SCH).toContain('Page Settings');
    expect(SCH).toContain('>Paper</div>');
    expect(SCH).toContain('>Title Block</div>');
    expect(SCH).not.toContain('Title Block Parameters');
  });
});
