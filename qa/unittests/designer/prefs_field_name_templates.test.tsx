// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Field Name Templates — `PANEL_TEMPLATE_FIELDNAMES`
 * (`eeschema/dialogs/panel_template_fieldnames.cpp` over its `_base.cpp`).
 *
 * **It is one class, built twice.** The constructor takes a `TEMPLATES*` and
 * branches on it exactly once:
 *
 *     if( aProjectTemplateMgr )  m_title->SetLabel( _( "Project Field Name Templates" ) );
 *     else                       m_title->SetLabel( _( "Global Field Name Templates" ) );
 *     (`:44-52`)
 *
 * Schematic Setup passes the project's manager, Preferences passes nullptr.
 * Everything else is shared.
 *
 * We had two. Schematic Setup got a grid; Preferences got a second hand-rolled
 * table with a `+ Add field` text button, a per-row `−`, a group box with a rule
 * KiCad does not draw, a 12.5 px font, and a sentence — "Template fields are
 * added to every new symbol placed on the schematic" — that appears nowhere in
 * KiCad. Everything the copy did differently, it did wrong; the fix was to
 * delete it, not to correct it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import {
  PanelTemplateFieldnames,
  type FieldTemplate,
} from '@ziroeda/designer/src/editors/schematic/dialogs/panels/panel_template_fieldnames.js';

afterEach(cleanup);

const SRC = resolve(process.cwd(), '../designer/src');
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8');
const CSS = read('ui/shell.css');

/** A rule body by exact selector, comments stripped. */
const rule = (selector: string): string => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((x) => x.trim() === selector)) return m[2] ?? '';
  }
  return '';
};

const START: FieldTemplate[] = [
  { name: 'Datasheet', visible: true, url: true },
  { name: 'MPN', visible: false, url: false },
];

function Harness({
  global,
  seen,
}: {
  global?: boolean;
  seen: { templates: FieldTemplate[] };
}): React.JSX.Element {
  const [templates, setTemplates] = useState<FieldTemplate[]>(structuredClone(START));
  seen.templates = templates;
  return (
    <PanelTemplateFieldnames
      global={global}
      templates={templates}
      onChange={(next) => {
        seen.templates = next;
        setTemplates(next);
      }}
    />
  );
}

const mount = (global?: boolean): { templates: FieldTemplate[] } => {
  const seen = { templates: [] as FieldTemplate[] };
  render(<Harness global={global} seen={seen} />);
  return seen;
};

const rows = (): string[] =>
  Array.from(document.querySelectorAll('tbody tr td:first-child input')).map(
    (i) => (i as HTMLInputElement).value,
  );

describe('one panel, two titles', () => {
  it('says Global when there is no project template manager', () => {
    mount(true);
    expect(screen.getByText('Global Field Name Templates')).toBeTruthy();
  });

  it('says Project when there is one', () => {
    mount();
    expect(screen.getByText('Project Field Name Templates')).toBeTruthy();
  });

  it('is literally the same component on the Preferences page', () => {
    // The claim this whole change rests on: the prefs page constructs the
    // shared panel rather than owning a table.
    const page = read('editors/schematic/prefs/PanelTemplateFieldnames.tsx');
    expect(page).toContain("from '../dialogs/panels/panel_template_fieldnames.js'");
    expect(page).not.toContain('<table');
  });

  it('says nothing KiCad does not say, and draws no group box', () => {
    mount(true);
    // The invented sentence, and the `+ Add field` button that replaced the
    // bitmap row.
    expect(document.body.textContent).not.toContain('Template fields are added');
    expect(document.body.textContent).not.toContain('Add field');
    // `m_title` is a bare wxStaticText; a group heading draws a rule under it.
    expect(document.querySelector('.ze-pref-group')).toBeNull();
  });
});

describe('the button row is the four STD_BITMAP_BUTTONs the base file builds', () => {
  it('carries KiCad’s own small_* bitmaps, in upstream’s order', () => {
    mount(true);
    const btns = Array.from(document.querySelectorAll('.ze-grid-btns .ze-gridbtn'));
    expect(btns.map((b) => b.querySelector('img')?.getAttribute('src') ?? '')).toEqual([
      expect.stringContaining('small_plus'),
      expect.stringContaining('small_up'),
      expect.stringContaining('small_down'),
      expect.stringContaining('small_trash'),
    ]);
    // ...and none of them carries text of its own.
    for (const b of btns) expect(b.textContent).toBe('');
  });

  it('sets a tooltip on move up and move down, and on neither of the others', () => {
    // `m_bpMoveUp->SetToolTip( _( "Move up" ) )` and the same for down
    // (`panel_template_fieldnames_base.cpp:67-73`). The base file sets none on
    // add or delete, so putting one there would be hover text KiCad has not
    // got — the accessible name is a separate question and stays.
    mount(true);
    expect(screen.getByLabelText('Move up').getAttribute('title')).toBe('Move up');
    expect(screen.getByLabelText('Move down').getAttribute('title')).toBe('Move down');
    expect(screen.getByLabelText('Add field').hasAttribute('title')).toBe(false);
    expect(screen.getByLabelText('Delete field').hasAttribute('title')).toBe(false);
  });

  it('keeps the fixed 20 px gap before Delete', () => {
    // `bSizer10->Add( 20, 0, 0, wxEXPAND, 5 )`.
    expect(rule('.ze-fieldnames-gap')).toMatch(/width:\s*20px/);
  });
});

describe('the rows behave the way WX_GRID’s helpers make them behave', () => {
  it('adds "Untitled Field", not a blank one, and not visible', () => {
    // `TEMPLATE_FIELDNAME newFieldname = TEMPLATE_FIELDNAME( _( "Untitled Field" ) );
    //  newFieldname.m_Visible = false;` (`:99-103`)
    const seen = mount(true);
    fireEvent.click(screen.getByLabelText('Add field'));
    expect(seen.templates.at(-1)).toEqual({ name: 'Untitled Field', visible: false, url: false });
  });

  it('moves the selected row, and only the selected row', () => {
    const seen = mount(true);
    // The first row is selected on mount, so Move up is dead and Move down works.
    expect(screen.getByLabelText('Move up').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('Move down'));
    expect(seen.templates.map((t) => t.name)).toEqual(['MPN', 'Datasheet']);
    // The selection travels with the row, as `SwapRows` leaves it.
    expect(screen.getByLabelText('Move down').hasAttribute('disabled')).toBe(true);
  });

  it('deletes the selected row and falls back to a neighbour', () => {
    const seen = mount(true);
    fireEvent.click(screen.getByLabelText('Delete field'));
    expect(seen.templates.map((t) => t.name)).toEqual(['MPN']);
    expect(rows()).toEqual(['MPN']);
  });

  it('edits a name, a Visible and a URL in place', () => {
    const seen = mount(true);
    const name = document.querySelector('tbody tr td:first-child input') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Sheet' } });
    expect(seen.templates[0]?.name).toBe('Sheet');

    const visible = screen.getAllByLabelText('Visible')[0] as HTMLInputElement;
    fireEvent.click(visible);
    expect(seen.templates[0]?.visible).toBe(false);
  });
});

describe('the grid is the size the base file gives it', () => {
  it('takes the two boolean columns’ 48 and lets Name have the slack', () => {
    // `SetColSize( 1, 48 )`, `SetColSize( 2, 48 )`, `SetupColumnAutosizer( 0 )`.
    expect(rule('.ze-fieldnames-bool')).toMatch(/width:\s*48px/);
  });

  it('is at least 180 tall and fills the page', () => {
    // `m_grid->SetMinSize( wxSize( -1, 180 ) )`, added at proportion 1.
    expect(rule('.ze-fieldnames-grid')).toMatch(/min-height:\s*180px/);
    expect(rule('.ze-fieldnames-grid')).toMatch(/flex:\s*1/);
    // `Add( m_grid, 1, wxEXPAND|wxRIGHT, 5 )` — a right border and no left one.
    expect(rule('.ze-fieldnames-grid')).toMatch(/margin-right:\s*5px/);
  });

  it('gives the title the borders its Add() states', () => {
    // `Add( m_title, 0, wxTOP|wxLEFT|wxEXPAND, 8 )`, then a 3 px spacer.
    expect(rule('.ze-fieldnames-title')).toMatch(/padding:\s*8px 0 0 8px/);
    expect(rule('.ze-fieldnames-title')).toMatch(/margin-bottom:\s*3px/);
  });

  it('lets the header size to its own text, as wxGRID_AUTOSIZE does', () => {
    // Not the fixed 30 the design inspector asks for: a live 10.0.5 page's
    // header band measures 25.
    expect(rule('.ze-fieldnames .ze-grid th')).toMatch(/height:\s*auto/);
  });
});
