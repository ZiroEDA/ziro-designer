// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A wxPropertyGrid CELL is `GetRowHeight()` tall, not as tall as what is in it.
 *
 * That matters for exactly one kind of row. Every other row's value is TEXT,
 * which brings a height with it; the Color row's is a COLOR_SWATCH, which
 * brings none.
 *
 * Do not re-derive this cell from the headers — it has been got wrong twice
 * that way, once as plain text and once as a filled cell. What a live 10.0.5
 * draws, measured, is 48 x 24 at the LEFT of the cell: the width is the
 * swatch's own (`ConvertDialogToPixels( SWATCH_SIZE_LARGE_DU )` = 48 x 36,
 * per qa/probes/swatch_probe.cpp) and the height is the row's, because 36 does
 * not fit a row that is 25 tall. This file guards the height half — that the
 * cell has a height for the swatch to take.
 *
 * Ours had `.ze-pgrid-row { align-items: center }` and nothing making the cell
 * fill the row, so the cell took the height of its content. On a colour row the
 * content is a swatch with no content of its own, and the two sized each other:
 * the cell from the swatch, the swatch from the cell. Measured in the real
 * panel through the dev server, a Line Color row rendered a 164 x 0 swatch
 * inside a 170 x 2 cell — the colour rectangle was missing from the Properties
 * panel entirely, while the same swatch drew correctly in Graphic Properties,
 * because there it sits in a dialog row that has a height.
 *
 * happy-dom has no layout engine, so this reads the stylesheet. The invariant
 * is not "the row centres" or "the cell stretches" on its own — either one is a
 * legitimate way to write it — it is that the two cannot BOTH leave the cell
 * sized by its content.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../../../designer/src/widgets/properties_panel.css', import.meta.url)),
  'utf8',
);

/** Every rule body, by selector, comments stripped. */
function rules(): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sel: (m[1] ?? '').trim().replace(/\s+/g, ' '), body: m[2] ?? '' });
  }
  return out;
}

/** The last declaration of `prop` to reach `sel`, or undefined. */
function declared(sel: string, prop: string): string | undefined {
  let found: string | undefined;
  for (const r of rules()) {
    if (!r.sel.split(',').some((s) => s.trim() === sel)) continue;
    const m = r.body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`));
    if (m?.[1]) found = m[1].trim();
  }
  return found;
}

describe('the value cell is as tall as its row', () => {
  it('the row states a height at all, so there is one to fill', () => {
    // [px] GetRowHeight() = 25. If this stops being stated the rest is moot.
    expect(declared('.ze-pgrid-row', 'height')).toBe('var(--pgrid-row-height)');
  });

  it('the cell is never left sized by its content', () => {
    const rowAlign = declared('.ze-pgrid-row', 'align-items') ?? 'stretch';
    const cellSelf = declared('.ze-pgrid-value', 'align-self') ?? 'auto';
    const cellHeight = declared('.ze-pgrid-value', 'height');

    // Any ONE of these three fills the row; what may not happen is none of
    // them, which is the state that rendered a zero-height colour swatch.
    const fills = rowAlign === 'stretch' || cellSelf === 'stretch' || cellHeight === '100%';
    expect(fills, 'nothing gives .ze-pgrid-value the row height').toBe(true);
  });

  it('the colour editor takes the cell height rather than stating one', () => {
    // The swatch does not choose its height: `.ze-swatch.large`'s 36 inside a
    // 25px row is what made the cell spill over its neighbours, and the capture
    // shows 24 — the row less its separator. Its WIDTH it does choose, which is
    // color_cell_and_picker_tab.test.tsx's half of this.
    expect(declared('.ze-pgrid-colorcell', 'height')).toBe('auto');
    expect(declared('.ze-pgrid-colorcell', 'align-self')).toBe('stretch');
  });

  it('the colour editor still outranks .ze-swatch.large', () => {
    // `.ze-swatch.large` is (0,2,0) and states a 48 x 36 — a size for a
    // DIALOG's swatch. A lone `.ze-pgrid-colorcell` is (0,1,0) and loses the
    // tie whichever stylesheet is loaded last, so the paired selector is what
    // makes the rule above take effect at all.
    const paired = rules().some((r) =>
      r.sel.split(',').some((s) => s.trim() === '.ze-pgrid-value .ze-swatch.ze-pgrid-colorcell'),
    );
    expect(paired, 'the (0,3,0) selector that beats .ze-swatch.large is gone').toBe(true);
  });
});
