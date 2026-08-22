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
import { PAPER_CHOICES, PAPER_MILS, PAPER_MM } from '@ziroeda/common';
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

  it('swaps width and height for portrait', () => {
    const s = { ...defaultPreviewSettings(), paper: 'A3', portrait: true };
    const land = previewPageMM({ ...s, portrait: false });
    expect(previewPageMM(s)).toEqual([land[1], land[0]]);
    // A3 landscape is 16535 x 11693 mils, which is what the swap is swapping.
    expect(land[0]).toBeCloseTo((16535 * 25.4) / 1000, 9);
    expect(land[1]).toBeCloseTo((11693 * 25.4) / 1000, 9);
  });
});

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('DSP-24 — the dialog is "Preview Settings" in this frame', () => {
  const DIALOG = read('../../../designer/src/editors/drawingsheet/PageSettingsDialog.tsx');

  it('re-labels the three strings pl_editor re-labels', () => {
    // dialog_page_settings.cpp:82-88, the PL_EDITOR_FRAME_NAME branch.
    //
    // `>Preview Paper<` used to be matched against the raw source, which pinned
    // the LABEL and the FORMATTER together: biome puts a heading on its own
    // line as soon as its opening tag grows, and the assertion then failed for
    // a change that touched no string. Collapsing the tag boundaries first
    // checks the element's text and not how it happens to be wrapped.
    const flat = DIALOG.replace(/>\s+/g, '>').replace(/\s+</g, '<');
    expect(flat).toContain('Preview Settings');
    expect(flat).toContain('>Preview Paper<');
    expect(flat).toContain('>Preview Title Block Data<');
  });

  it('leaves the other frames on the else branch’s wording', () => {
    // :90-92 — "Page Settings" / "Paper" / "Title Block".
    const SCH = read('../../../designer/src/dialogs/dialog_page_settings.tsx');
    expect(SCH).toContain('Page Settings');
    expect(SCH).toContain('>Paper</div>');
    expect(SCH).toContain('>Title Block</div>');
    expect(SCH).not.toContain('Title Block Parameters');
  });
});

/**
 * The Drawing Sheet Editor's page defaults are pl_editor's own, not the
 * schematic's.
 *
 *     PARAM<wxString>( "last_paper_size",   &m_LastPaperSize,   "A3" )
 *     PARAM<int>(      "last_custom_width",  &m_LastCustomWidth,  17000 )
 *     PARAM<int>(      "last_custom_height", &m_LastCustomHeight, 11000 )
 *                             pagelayout_editor/pl_editor_settings.cpp:52-56
 *
 * `LoadSettings` feeds `m_LastPaperSize` into `SetPageSettings`
 * (`pl_editor_frame.cpp:543-548`), so this IS what a fresh profile opens on.
 *
 * Ours opened on A4 and it was visible with the two windows side by side: the
 * border's coordinate band repeats every 50 mm, so A3's 420 mm runs 1..8 across
 * the top where A4's 297 runs 1..6. The margin was never wrong — measured off
 * both windows it is 9.93 mm on KiCad's and 9.95 mm on ours, the 10 mm the
 * sheet declares.
 */
describe('the editor opens on pl_editor’s page, not the schematic’s', () => {
  it('defaults to A3', () => {
    expect(defaultPreviewSettings().paper).toBe('A3');
  });

  it('and A3 is the size that makes the band run to 8', () => {
    // 420 mm / 50 mm per mark. Derived here rather than transcribed, so the
    // number and the reason cannot drift apart.
    const [w] = previewPageMM(defaultPreviewSettings());
    expect(w).toBeCloseTo(419.989, 3); // 16535 mils, not a round 420
    expect(Math.floor(w / 50)).toBe(8);
    // A4 would give 5 full marks — a visibly different band.
    expect(Math.floor(297 / 50)).toBe(5);
  });

  it('keeps the custom size at 17000 x 11000 mils', () => {
    const s = defaultPreviewSettings();
    expect(s.customWidthMM).toBeCloseTo(17000 * 0.0254, 4);
    expect(s.customHeightMM).toBeCloseTo(11000 * 0.0254, 4);
  });

  it('opens landscape', () => {
    expect(defaultPreviewSettings().portrait).toBe(false);
  });
});
