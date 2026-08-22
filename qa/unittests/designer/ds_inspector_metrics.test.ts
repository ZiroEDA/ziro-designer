// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_INSPECTOR's size comes from its content, and its grid from the UI font.
 *
 * Measured off Akshay's side-by-side capture of the same default sheet:
 * pl_editor's dialog is ~543 x 898 and shows all 31 rows; ours was 720 x 734
 * and scrolled at 27. Two literals did that — a fixed width and a 60vh cap —
 * and a third, `font-size: 12.5px` on the grid, made the text smaller and
 * therefore every row shorter too.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const INSPECTOR = read('../../../designer/src/editors/drawingsheet/DesignInspector.tsx');
const CSS = read('../../../designer/src/ui/shell.css');

/** The `.ze-grid { … }` block, which is where the shared grid metrics live. */
function gridBlock(): string {
  const at = CSS.indexOf('.ze-grid {');
  return CSS.slice(at, CSS.indexOf('}', at));
}

describe('the grid is drawn in the UI font', () => {
  it('takes --ui-font-size, not a literal', () => {
    // WX_GRID sets SetDefaultCellFont and SetLabelFont to KIUI::GetControlFont
    // (wx_grid.cpp:217-218) = getGUIFont( win, 0 ) off macOS, which is the same
    // font as the menu bar. A raw wxGrid inherits it from its panel.
    expect(gridBlock()).toContain('font-size: var(--ui-font-size)');
  });

  it('and no longer says 12.5px anywhere in that block', () => {
    // Per-occurrence rather than file-wide: other rules legitimately carry
    // their own sizes, and a file-level scan would pass while this one drifted.
    expect(gridBlock()).not.toMatch(/font-size:\s*[\d.]+px/);
  });
});

describe('the header row is wx’s fixed 30', () => {
  it('is SetColLabelSize( 30 ), not sized by its text', () => {
    // dialog_design_inspector_base.cpp:41. The DATA rows are content-sized;
    // only the label row is pinned, which is why this is on `th` alone.
    const th = CSS.slice(CSS.indexOf('.ze-grid th {'));
    expect(th.slice(0, th.indexOf('}'))).toContain('height: 30px');
  });
});

describe('the dialog is sized by its content', () => {
  it('has no fixed pixel width', () => {
    // `bSizerMain->Fit( this )` with wxSize( -1, -1 ), and every column
    // AutoSizeColumn'd (design_inspector.cpp:295-313).
    expect(INSPECTOR).toContain("width: 'max-content'");
    expect(INSPECTOR).not.toMatch(/style=\{\{ width: \d+, maxWidth/);
  });

  it('does not cap the list at 60vh, which hid four of the rows', () => {
    expect(INSPECTOR).not.toContain("maxHeight: '60vh'");
  });

  it('still bounds itself to the viewport, as Fit() is bounded by the screen', () => {
    // Not unbounded: a dialog taller than the display is not what wx produces
    // either. The cap is a screen limit, not a row limit.
    expect(INSPECTOR).toMatch(/maxHeight: '\d+vh'/);
    expect(INSPECTOR).toContain("maxWidth: '92vw'");
  });
});

describe('the metrics that were already right stay right', () => {
  it('keeps the 40px row-label gutter', () => {
    // `SetRowLabelSize( 40 )` — dialog_design_inspector_base.cpp:46.
    expect(INSPECTOR).toContain('width: 40');
  });

  it('keeps the bitmap column’s floor at BITMAP_SIZE * 2', () => {
    // design_inspector.cpp:303-304.
    expect(INSPECTOR).toContain('DS_INSPECTOR_BITMAP_SIZE * 2');
  });
});
