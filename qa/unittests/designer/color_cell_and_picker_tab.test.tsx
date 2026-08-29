// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two things about the colour cell in the Properties panel and the picker it
 * opens, both reported off a side-by-side against a live 10.0.5.
 *
 * 1. The cell's swatch was `SWATCH_SMALL` and sat in the cell at 16 x 14.
 *    `PG_COLOR_EDITOR::CreateControls` (common/properties/pg_editors.cpp:336-351)
 *    builds it `SWATCH_LARGE` and then hands it the grid's editor rectangle —
 *    `editor->SetPosition( aPos ); editor->SetSize( aSize );` — so it is not a
 *    swatch beside the value, it IS the value cell, filled edge to edge.
 *
 * 2. `DIALOG_COLOR_PICKER`'s page is not a constant. The constructor selects
 *    `cfg->m_ColorPicker.default_tab` (dialog_color_picker.cpp:89) and the
 *    destructor writes `m_notebook->GetSelection()` back (`:114`), so it
 *    reopens where it was left; only a fresh profile opens on page 0, which is
 *    "Color Picker" (dialog_color_picker_base.cpp:140).
 *
 * The persistence assertion is the one most easily written so it cannot fail.
 * Setting the stored value and reading it back through the same object proves
 * nothing about the dialog, so the round trip below goes through the COMPONENT
 * both ways: it renders the picker, clicks the other page, unmounts it — which
 * is the destructor — and renders a fresh one, asserting on what that second
 * dialog shows.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PropertiesPanel } from '@ziroeda/designer/src/widgets/properties_panel.js';
import type { PropertyGridRow } from '@ziroeda/designer/src/widgets/properties_panel.js';
import { DialogColorPicker } from '@ziroeda/designer/src/ui/DialogColorPicker.js';
import {
  COLOR_PICKER_TABS,
  loadColorPickerTab,
  saveColorPickerTab,
} from '@ziroeda/designer/src/ui/color_picker_tab.js';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';

afterEach(cleanup);

type Cmd = { readonly what: string };

const COLOR_ROW: PropertyGridRow<Cmd>[] = [
  { group: '', name: 'Color', kind: 'color', value: '#ff0000', set: () => ({ what: 'c' }) },
];

const panel = () =>
  render(
    <PropertiesPanel<Cmd>
      selectionCount={1}
      friendlyName="Symbol"
      rows={COLOR_ROW}
      fmt={(iu) => `${iu}`}
      parse={() => null}
      onCommand={() => {}}
    />,
  );

describe("PG_COLOR_EDITOR's swatch", () => {
  /**
   * `SWATCH_LARGE`, not the `SWATCH_SMALL` the row used to ask for. The three
   * DU pairs are SMALL (8,6), MEDIUM (24,10), LARGE (24,16)
   * (include/widgets/color_swatch.h:46-48); `.ze-swatch.large` is that pair.
   */
  it('is built at the large size', () => {
    const { container } = panel();
    const swatch = container.querySelector('.ze-pgrid-value .ze-swatch');
    expect(swatch).toBeTruthy();
    expect(Array.from(swatch?.classList ?? [])).toContain('large');
    expect(Array.from(swatch?.classList ?? [])).not.toContain('small');
  });

  /** `editor->SetSize( aSize )`: the swatch takes the whole editor rectangle. */
  it('fills the value cell rather than sitting in it', () => {
    const { container } = panel();
    const swatch = container.querySelector('.ze-pgrid-value .ze-swatch');
    expect(Array.from(swatch?.classList ?? [])).toContain('ze-pgrid-colorcell');

    // happy-dom computes no var() and paints nothing, so the rule itself is
    // what says the cell is filled: a fixed width and height would not be.
    const css = readFileSync(
      resolve(process.cwd(), '../designer/src/widgets/properties_panel.css'),
      'utf8',
    );
    const start = css.indexOf('.ze-pgrid-colorcell {');
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('flex: 1 1 auto');
    expect(rule).toContain('align-self: stretch');
    expect(rule).toContain('width: auto');
    expect(rule).toContain('height: auto');
  });

  /**
   * `RenderToDC` draws with `*wxTRANSPARENT_PEN` (color_swatch.cpp:72), and
   * `PG_COLOR_EDITOR` puts no wxBORDER_SIMPLE panel round it the way the item
   * dialogs do (dialog_field_properties_base.cpp:277-286). So the cell's
   * swatch has no border, which is what `.ze-swatch.large` states.
   */
  it('draws no border, because nothing upstream draws one there', () => {
    const css = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
    const start = css.indexOf('.ze-swatch.large {');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf('}', start))).toContain('border: none');
  });
});

describe('DIALOG_COLOR_PICKER: the remembered page', () => {
  beforeEach(() => {
    settings.updateCommon((s) => {
      s.color_picker.default_tab = 0;
    });
  });

  /** The notebook's own order: page 0 "Color Picker", page 1 "Defined Colors". */
  it('numbers the pages the way AddPage adds them', () => {
    expect(COLOR_PICKER_TABS).toStrictEqual(['free', 'defined']);
  });

  /** `PARAM<int>( "color_picker.default_tab", …, 0 )`, app_settings.cpp:137-138. */
  it('defaults to page 0 on a fresh profile', () => {
    expect(loadColorPickerTab()).toBe('free');
    const { container } = render(
      <DialogColorPicker value={{ r: 1, g: 0, b: 0, a: 1 }} onDone={() => {}} />,
    );
    const active = container.querySelector('.ze-nb-tabs .active');
    expect(active?.textContent).toBe('Color Picker');
  });

  /**
   * The round trip, through the component at both ends: open, switch page,
   * close (the destructor's write), open again.
   */
  it('reopens on the page the last one was closed on', () => {
    const first = render(
      <DialogColorPicker value={{ r: 1, g: 0, b: 0, a: 1 }} onDone={() => {}} />,
    );
    fireEvent.click(first.getByText('Defined Colors'));
    first.unmount();

    const second = render(
      <DialogColorPicker value={{ r: 1, g: 0, b: 0, a: 1 }} onDone={() => {}} />,
    );
    expect(second.container.querySelector('.ze-nb-tabs .active')?.textContent).toBe(
      'Defined Colors',
    );
    // And it is the notebook INDEX that was stored, not the page's name.
    expect(settings.common.color_picker.default_tab).toBe(1);
  });

  /**
   * The write is in the destructor, not in TransferDataFromWindow, so it runs
   * after Cancel as well — closing with the X remembers the page too.
   */
  it('remembers the page after a cancel', () => {
    const dlg = render(<DialogColorPicker value={{ r: 1, g: 0, b: 0, a: 1 }} onDone={() => {}} />);
    fireEvent.click(dlg.getByText('Defined Colors'));
    fireEvent.click(dlg.getByText('Cancel'));
    dlg.unmount();
    expect(loadColorPickerTab()).toBe('defined');
  });

  /**
   * An index the notebook has no page for cannot be selected, so a settings
   * file holding one opens on page 0 rather than on neither page. This is the
   * only clamp: the way OUT cannot go out of range, because the argument is
   * the two-member union itself.
   */
  it('falls back to page 0 for a stored index out of range', () => {
    settings.updateCommon((s) => {
      s.color_picker.default_tab = 7;
    });
    expect(loadColorPickerTab()).toBe('free');
  });

  /** Both pages round-trip through the index the notebook uses. */
  it('stores each page as its own index', () => {
    saveColorPickerTab('defined');
    expect(settings.common.color_picker.default_tab).toBe(1);
    saveColorPickerTab('free');
    expect(settings.common.color_picker.default_tab).toBe(0);
  });
});
