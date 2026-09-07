// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table Properties: one dialog, shared by both editors.
 *
 * Upstream there are two — `eeschema/dialogs/dialog_table_properties.cpp` over
 * `SCH_TABLE : SCH_ITEM`, and `pcbnew/dialogs/dialog_table_properties.cpp` over
 * `PCB_TABLE : BOARD_ITEM_CONTAINER`. Ours are one, which is Akshay's call made
 * with both on screen: the board's copy had drifted badly (four invented
 * groupboxes stacked in a narrow column, so the cell grid became a single file
 * of unusable inputs, and three wrong labels), and the schematic's was good.
 *
 * What this pins is that the merge did not quietly lose the per-editor bits, and
 * that the labels are the ones both upstream dialogs actually use.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const SHARED = read('ui/DialogTableProperties.tsx');
const SCH = read('editors/schematic/dialogs/dialog_table_properties.tsx');
const CSS = read('ui/shell.css');

describe('there is one dialog', () => {
  it('the board editor no longer has a copy of its own', () => {
    let existed = true;
    try {
      read('editors/pcb/dialogs/dialog_table_properties.tsx');
    } catch {
      existed = false;
    }
    expect(existed).toBe(false);
  });

  it('and it lives in ui/, not inside either editor', () => {
    expect(SHARED).toContain('export function DialogTableProperties');
  });

  it('which means it may not import from an editor package', () => {
    // A shared control that reaches into eeschema or pcbnew is not shared; it
    // is one editor's control with a second caller.
    expect(SHARED).not.toMatch(/@ziroeda\/(eeschema|pcbnew)/);
  });
});

describe('the labels both upstream dialogs use', () => {
  it('says "Header border", "Row lines" and "Column lines"', () => {
    for (const label of ['External border', 'Header border', 'Row lines', 'Column lines'])
      expect(SHARED).toContain(`'${label}'`);
  });

  it('and none of the three the board copy had invented', () => {
    // Checked past the file's own header, which names them to explain what was
    // wrong — a comment is not a label.
    const code = SHARED.slice(SHARED.indexOf('*/') + 2);
    for (const wrong of ['Header separator', 'Row separators', 'Column separators'])
      expect(code).not.toContain(wrong);
  });
});

describe('what each editor keeps, because it genuinely differs', () => {
  it('takes the IU scale from the caller — a schematic unit is not a board one', () => {
    expect(SHARED).toContain('iuScale');
    expect(SCH).toContain('schIUScale');
  });

  it('lets the board add Layer and Locked, which a SCH_TABLE has neither of', () => {
    expect(SHARED).toContain('header?:');
    const pcb = read('editors/pcb/PcbEditor.tsx');
    expect(pcb).toContain('tableDialogHeader');
    // …and the schematic passes none.
    expect(SCH).not.toContain('header=');
  });

  it('lets the schematic add the stroke colours a PCB_TABLE takes from its layer', () => {
    expect(SHARED).toContain('renderColor?:');
    expect(SCH).toContain('renderColor=');
    expect(SCH).toContain('ColorSwatch');
    // The shared file must not know about COLOR_SWATCH at all.
    expect(SHARED).not.toContain('ColorSwatch');
  });

  it('lets the schematic grey a switched-off line, which is its own rule', () => {
    expect(SCH).toContain('borderControlsEnabled');
    expect(SCH).toContain('separatorControlsEnabled');
  });
});

describe('the layout is the stylesheet’s, not twenty inline styles', () => {
  it('states no inline style objects for its own boxes', () => {
    // The grid's per-column pixel width is the one exception: it is computed
    // per column from the table's own proportions, so it cannot be a rule.
    const inline = SHARED.match(/style=\{\{/g) ?? [];
    expect(inline.length).toBeLessThanOrEqual(3);
  });

  it('scrolls the cell grid rather than squeezing it', () => {
    const scroll = /\.ze-tableprops-scroll\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(scroll).toMatch(/overflow:\s*auto/);
    // `max-content` is what stops a 100%-wide table dividing itself into
    // columns too narrow to type in.
    const grid = /\.ze-tableprops-grid\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(grid).toMatch(/width:\s*max-content/);
  });

  it('puts Border and Separators side by side, as the grid-bag sizer does', () => {
    const groups = /\.ze-tableprops-groups\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(groups).toMatch(/display:\s*flex/);
  });
});

describe('the standard button row', () => {
  it('is the shared component, not a hand-written footer', () => {
    expect(SHARED).toContain('<StdDialogButtons');
    expect(SHARED).not.toContain('ze-modal-footer');
  });

  it('puts Cancel before OK, which is what GTK Realize() does', () => {
    // `wxStdDialogButtonSizer::Realize` applies the platform convention: the
    // GNOME HIG puts the affirmative last. Settled in the component, once.
    const comp = read('ui/StdDialogButtons.tsx');
    expect(comp.indexOf('{cancelLabel}')).toBeLessThan(comp.indexOf('{okLabel}'));
  });

  it('gives both buttons the shared class and never lets one be a submit', () => {
    const comp = read('ui/StdDialogButtons.tsx');
    const tags = comp.match(/<button[^>]*>/g) ?? [];
    expect(tags).toHaveLength(2);
    for (const tag of tags) expect(tag).toContain('type="button"');
    expect(comp).toContain('className="ze-btn primary"');
  });
});
