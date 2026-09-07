// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Text & Graphics > Defaults — `PANEL_SETUP_TEXT_AND_GRAPHICS`
 * with `panel_setup_text_and_graphics_base.cpp` for the grid.
 *
 * The grid is six columns of stated width and six rows, and every number below
 * is upstream's:
 *
 *     m_grid->SetColSize( 0, 140 ); … ( 3, 140 ); ( 4, 80 ); ( 5, 120 );
 *     m_grid->SetColLabelValue( 0, _( "Line Thickness" ) ); …
 *
 * Two things went wrong together and the second hid behind the first: the
 * labels had "(mm)" appended — which upstream does not, because the unit lives
 * in each CELL — and the table had no column widths at all, so every column
 * stretched to fit the longest header. Once pages stopped being allowed to
 * shrink below their content, that width reached the dialog and made Board
 * Setup ~260 px wider the moment this page was opened.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, type JSX } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PanelPcbTextGraphics } from '@ziroeda/designer/src/editors/pcb/dialogs/panels/panel_pcb_text_graphics.js';
import {
  defaultTextGraphics,
  type TextGfxDefaults,
} from '@ziroeda/designer/src/editors/pcb/board_settings.js';

afterEach(cleanup);

function Harness(): JSX.Element {
  const [v, setV] = useState<TextGfxDefaults>(defaultTextGraphics());
  return <PanelPcbTextGraphics value={v} onChange={setV} />;
}

const headers = (): string[] =>
  [...document.querySelectorAll('.ze-grid thead th')].map((t) => t.textContent ?? '');

describe('the column labels', () => {
  it('carry no unit, because the cells do', () => {
    // `SetColLabelValue( 0, _( "Line Thickness" ) )` — no "(mm)". This is not
    // cosmetic: "Line Thickness (mm)" is the longest string on the page and it
    // was setting the column's width.
    render(<Harness />);
    expect(headers()).toEqual([
      '',
      'Line Thickness',
      'Text Width',
      'Text Height',
      'Text Thickness',
      'Italic',
      'Keep Upright',
    ]);
    for (const h of headers()) expect(h).not.toContain('(mm)');
  });
});

describe('the column widths', () => {
  it('are upstream’s 140/140/140/140/80/120', () => {
    render(<Harness />);
    const cols = [...document.querySelectorAll('.ze-grid colgroup col')];
    // The first <col> is the row-label column, which takes what its labels need.
    expect(cols).toHaveLength(7);
    expect(cols.slice(1).map((c) => (c as HTMLElement).style.width)).toEqual([
      '140px',
      '140px',
      '140px',
      '140px',
      '80px',
      '120px',
    ]);
  });

  it('total 760px, so the page cannot be the widest thing in the dialog', () => {
    // 140 + 140 + 140 + 140 + 80 + 120 = 760, from the base's SetColSize calls.
    // Board Setup states 980 and a real one settles near 1070, so 760 fits
    // beside the 220 px tree; the unbounded version did not, which is the bug.
    render(<Harness />);
    const total = [...document.querySelectorAll('.ze-grid colgroup col')]
      .slice(1)
      .reduce((a, c) => a + Number.parseInt((c as HTMLElement).style.width, 10), 0);
    expect(total).toBe(140 * 4 + 80 + 120);
  });
});

describe('the cells carry the unit', () => {
  it('shows a thickness as "0.1 mm", not "0.1"', () => {
    // `StringFromValue( …, true )`, the same rule as every other wx value field.
    render(<Harness />);
    const inputs = [...document.querySelectorAll('.ze-grid tbody input[type="text"]')];
    expect(inputs.length).toBeGreaterThan(0);
    for (const i of inputs) expect((i as HTMLInputElement).value).toMatch(/^-?[\d.]+ mm$/);
  });

  it('reads a typed value back through the unit parser', () => {
    render(<Harness />);
    const first = document.querySelector('.ze-grid tbody input[type="text"]') as HTMLInputElement;
    // A wx numeric cell accepts the value with or without its unit.
    fireEvent.change(first, { target: { value: '0.25 mm' } });
    expect(first.value).toBe('0.25 mm');
    fireEvent.change(first, { target: { value: '0.4' } });
    expect(first.value).toBe('0.4 mm');
  });
});

describe('a WX_GRID never dictates the dialog width', () => {
  const css = readFileSync(join(__dirname, '../../../designer/src/ui/shell.css'), 'utf8');
  const ruleFor = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    if (at === -1) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };

  it('contains THIS pane’s inline size, and not the shared one’s', () => {
    // Containment is only correct for a pane the layout stretches. The shared
    // class also serves content-sized panes — Zone Hatch Offsets' grid is
    // `align-self: flex-start`, because upstream adds it with proportion 0 —
    // and a content-sized box that may not read its content collapses to zero
    // width. Putting it on `.ze-grid-pane` blanked that page.
    expect(ruleFor('.ze-grid-pane')).not.toMatch(/contain:\s*inline-size/);
    expect(ruleFor('.ze-grid-pane')).toMatch(/overflow:\s*auto/);
    expect(ruleFor('.ze-tg-grid-pane')).toMatch(/contain:\s*inline-size/);
  });

  it('puts that class on the grid pane it renders', () => {
    render(<Harness />);
    expect(document.querySelector('.ze-grid-pane.ze-tg-grid-pane')).not.toBeNull();
  });

  it('does not let the table stretch to fill instead of using its columns', () => {
    render(<Harness />);
    const table = document.querySelector('.ze-grid') as HTMLElement;
    expect(table.style.width).not.toBe('100%');
  });
});
