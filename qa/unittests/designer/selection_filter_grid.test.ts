// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Selection Filter's grid geometry.
 *
 * `PANEL_SCH_SELECTION_FILTER` and pcbnew's `PANEL_SELECTION_FILTER` are the
 * same widget twice: a `wxGridBagSizer( 0, 0 )` whose every item carries a 5px
 * border, and `KIUI::GetInfoFont` on every checkbox. Nothing about that had
 * ever been pinned, so ours drifted to a 27px row pitch against KiCad's 21 and
 * to columns that split the pane (`1fr 1fr`) instead of sizing to their widest
 * label — the two indicator columns landed 148px apart where a running
 * eeschema has them 90 apart.
 *
 * WHERE THE NUMBERS COME FROM. Not from our CSS, and not from a screenshot
 * alone. `qa/probes/selfilter_grid_probe.cpp` builds the real grid — the same
 * sizer, borders and `Hide()` calls as the generated base — and asks wx for the
 * result; Gtk.CheckButton was asked separately for its own style properties and
 * its label child's allocation; and a capture of a running eeschema was
 * measured. The three agree, and they are independent: one asks wx, one asks
 * GTK, one reads the shipped application's pixels.
 *
 *   row height, info font   21px   (22 at the GUI font, which is --check-row)
 *   row gap                 0      wxGridBagSizer( 0, 0 )
 *   column 0 width          90px   "Graphics" at 80, plus wxLEFT+wxRIGHT
 *   item border             5px    on every Add()
 *   indicator lead-in       4px    focus-padding 1 + line-width 1 + spacing 2
 *   indicator -> label ink  20px   = 16px indicator + that same 4
 *
 * These assertions are per-declaration rather than per-file: a bare
 * `expect(SHELL).toContain(...)` would pass on a stylesheet that stated the
 * right value in some unrelated rule, which is a test that cannot fail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SHELL = read('../../../designer/src/ui/shell.css');

/** shell.css quotes braces inside its prose, so comments go before slicing. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const ruleBody = (css: string, selector: string): string => {
  const bare = stripComments(css);
  const at = bare.indexOf(`\n${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThanOrEqual(0);
  const end = bare.indexOf('}', at);
  expect(end, `${selector} is unterminated`).toBeGreaterThan(at);
  return bare.slice(at, end);
};

/**
 * Every value a rule gives one property.
 *
 * Assertions read values, not patterns: `not.toMatch(/gap:\s*(?!0\s*;)/)` looks
 * like it forbids a non-zero gap and does not, because `\s*` backtracks to
 * empty and satisfies the lookahead against the very declaration it is meant to
 * accept. A property with no declaration returns [], so `toEqual([...])` pins
 * absence and presence in the one assertion.
 */
const decls = (body: string, prop: string): string[] =>
  [...body.matchAll(new RegExp(`(?:^|[;{\\s])${prop}:\\s*([^;]+);`, 'g'))].map((m) =>
    // The group always participates when the pattern matches, so the fallback
    // is unreachable; it is here because the capture is typed as optional.
    (m[1] ?? '').trim(),
  );

const token = (name: string): string => {
  const m = stripComments(SHELL).match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(m?.[1], `--${name} is missing`).toBeDefined();
  return (m?.[1] ?? '').trim();
};

describe('the two metrics the panel is built out of', () => {
  // Both measured off the realized widget. A checkbox and a radio return the
  // same height, and it moves with the font: 22 at 11pt, 21 at 10pt. So
  // --check-row is not wrong, it is the GUI-font answer; this is the info-font
  // one, and the filter panels set the info font on every checkbox
  // (panel_sch_selection_filter.cpp:36-47, panel_selection_filter.cpp:36-49).
  it('the info-font check row is 21px', () => {
    expect(token('check-row-info')).toBe('21px');
  });

  it('and the GUI-font one it sits beside is still 22px', () => {
    expect(token('check-row')).toBe('22px');
  });

  // focus-padding 1 + focus-line-width 1 + indicator-spacing 2, asked of
  // Gtk.CheckButton. It is one number applied three times, which is why the
  // widget's width comes out at text + 28 for all ten labels.
  it('GTK’s inset around the indicator is 4px', () => {
    expect(token('check-inset')).toBe('4px');
  });

  it('and the indicator itself is the 16px GTK draws', () => {
    expect(token('check-size')).toBe('16px');
  });
});

describe('wxGridBagSizer( 0, 0 ): no gap anywhere', () => {
  const GRID = ruleBody(SHELL, '.ze-selfilter');

  // The regression this replaces was `gap: 1px 12px` — a row gap AND a column
  // gap, neither of which the sizer has. Pinning the value, not the presence:
  // exactly one gap declaration, and it is zero.
  it('states one gap and it is zero', () => {
    expect(decls(GRID, 'gap')).toEqual(['0']);
  });

  // A gridbag column is as wide as its widest item. `1fr 1fr` divided the pane
  // instead, so the columns moved whenever the pane did.
  it('sizes its columns to their content, not to the pane', () => {
    expect(decls(GRID, 'grid-template-columns')).toEqual(['max-content max-content']);
  });
});

describe('the 5px border on every Add(), and only where it is added', () => {
  const LABEL = ruleBody(SHELL, '.ze-selfilter label');

  // wxLEFT|wxRIGHT, 5 on every item. A wx border sits outside the item, so it
  // is margin — which is also what lets the max-content column above measure
  // what the sizer measures.
  // 5px on the sides and nothing top or bottom, in one expectation: vgap is 0,
  // so a vertical margin here would reopen the row pitch this test exists for.
  it('every cell carries wxLEFT|wxRIGHT as a 5px side margin, and nothing vertical', () => {
    expect(decls(LABEL, 'margin')).toEqual(['0 5px']);
  });

  // wxTOP, 5 — on row 0, which is the first two cells in both panels.
  it('row 0 alone carries wxTOP', () => {
    expect(decls(ruleBody(SHELL, '.ze-selfilter > :nth-child(-n + 2)'), 'margin-top')).toEqual([
      '5px',
    ]);
  });

  // wxBOTTOM, 5 — on the single cell that closes the grid: "Other items" (4,1)
  // in eeschema, "Points" (6,0) in pcbnew. Both panels emit their cells in the
  // sizer's row-major order, so :last-child is that cell in each.
  it('the closing cell alone carries wxBOTTOM', () => {
    expect(decls(ruleBody(SHELL, '.ze-selfilter > :last-child'), 'margin-bottom')).toEqual(['5px']);
  });

  // (0,0) is added wxLEFT|wxTOP with no wxRIGHT — the one asymmetric cell.
  it('(0,0) is the one cell added without wxRIGHT', () => {
    expect(decls(ruleBody(SHELL, '.ze-selfilter > :first-child'), 'margin-right')).toEqual(['0']);
  });
});

describe('the row is the control, and the control is GTK’s', () => {
  const LABEL = ruleBody(SHELL, '.ze-selfilter label');

  // Each of these pins the value, so it fails both ways: if the declaration
  // goes missing, and if it is restated as the literal the token holds. The
  // central-value rule is the point — GTK decides all three of these.
  it('takes its height from the info-font row token', () => {
    expect(decls(LABEL, 'height')).toEqual(['var(--check-row-info)']);
  });

  it('takes the indicator gap from the GTK inset token', () => {
    expect(decls(LABEL, 'gap')).toEqual(['var(--check-inset)']);
  });

  it('takes its own edge inset from the same token', () => {
    expect(decls(LABEL, 'padding')).toEqual(['0 var(--check-inset)']);
  });

  // KIUI::GetInfoFont, the same token the rest of the pane asks for.
  it('asks for the info font rather than sizing one', () => {
    expect(decls(LABEL, 'font-size')).toEqual(['var(--ui-font-size-info)']);
  });
});

describe('the panel is the pane, so nothing insets it but the sizer', () => {
  // m_gridSizer->Fit( this ): the panel IS the sizer's size, and the AUI pane's
  // client area is the panel. Our generic .ze-panel-body inset stacked on top
  // of the sizer's 5, putting the indicator 12px from the pane edge where a
  // running eeschema has it at 5 + 4 = 9.
  it('the filter body drops the generic pane padding', () => {
    expect(decls(ruleBody(SHELL, '.ze-panel-body:has(> .ze-selfilter)'), 'padding')).toEqual(['0']);
  });

  it('and the generic body it overrides still has its own', () => {
    expect(decls(ruleBody(SHELL, '.ze-panel-body'), 'padding')).toEqual(['6px 8px']);
  });
});
