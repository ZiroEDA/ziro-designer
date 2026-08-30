// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Common — the page's SHAPE, which was wrong three ways.
 *
 * `panel_common_settings_base.cpp` builds two columns:
 *
 *     bPanelSizer->Add( bLeftSizer, 0, wxRIGHT, 35 );   (:325)
 *
 * with Rendering Engine, Helper Applications and User Interface on the left and
 * Scaling, Editing, Session and Project Backup on the right. Ours stacked all of
 * them in one scrolling column.
 *
 * Its group headings are a `wxStaticText` plus a `wxStaticLine`, never a
 * wxStaticBox:
 *
 *     bLeftSizer->Add( m_staticText20, 0, wxTOP|wxRIGHT|wxLEFT|wxEXPAND, 13 );
 *     bLeftSizer->Add( m_staticline3,  0, wxEXPAND|wxTOP|wxBOTTOM, 2 );
 *
 * and NEITHER that file NOR its hand-written `.cpp` calls SetFont anywhere, so a
 * heading is the dialog's own font, weight and foreground. Ours stated 12.5px,
 * 600 and #c7c9cc.
 *
 * And two choices upstream draws as wxRB_GROUP runs — Icon theme (:202-226) and
 * Toolbar icon size (:228-251) — were wxChoices here, which hides two of the
 * three answers behind a click.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

const PANEL = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/PanelCommonSettings.tsx'),
  'utf8',
);
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

describe('the page is two columns, as bPanelSizer makes it', () => {
  it('renders a column container with two columns in it', () => {
    expect(PANEL).toContain('ze-pref-columns');
    expect(PANEL.match(/className="ze-pref-col"/g) ?? []).toHaveLength(2);
  });

  it('the container is a flex row and the gutter is the sizer border', () => {
    expect(rule('.ze-pref-columns')).toMatch(/display:\s*flex/);
    // [data] `wxRIGHT, 35` on the left column.
    expect(rule('.ze-pref-columns > .ze-pref-col:first-child')).toMatch(/margin-right:\s*35px/);
  });

  it('splits the groups the way upstream splits them', () => {
    const left = PANEL.slice(PANEL.indexOf('ze-pref-col'), PANEL.lastIndexOf('ze-pref-col'));
    const right = PANEL.slice(PANEL.lastIndexOf('ze-pref-col'));
    for (const g of ['Rendering Engine', 'User Interface']) expect(left).toContain(g);
    for (const g of ['Editing', 'Session', 'Project Backup']) expect(right).toContain(g);
  });
});

describe('a group heading is a label and a rule, at the dialog font', () => {
  it('states no size, no weight and no colour of its own', () => {
    // Upstream calls SetFont on none of the seven.
    const body = rule('.ze-pref-group-title');
    expect(body).not.toMatch(/font-size\s*:/);
    expect(body).not.toMatch(/font-weight\s*:/);
    expect(body).not.toMatch(/(^|[;\s])color\s*:/);
  });

  it('still draws the wxStaticLine under it', () => {
    expect(rule('.ze-pref-group-title')).toMatch(/border-bottom:\s*1px solid/);
  });
});

describe('the small choices are radio runs, not combos', () => {
  it.each([
    ['Icon theme:', 'pref-icon-theme'],
    ['Toolbar icon size:', 'pref-toolbar-icon-size'],
  ])('%s is a Radio with its own group name', (label, group) => {
    // Each wxRB_GROUP is its own exclusive set; two sharing a name would make
    // picking Dark clear the toolbar size.
    const at = PANEL.indexOf(label);
    expect(at).toBeGreaterThan(-1);
    // The window spans BOTH sides of the label: `<Radio` opens before it and
    // `name` follows it, so a look-behind alone finds the tag and not the name.
    const around = PANEL.slice(Math.max(0, at - 400), at + 400);
    expect(around).toContain('<Radio');
    expect(around).toContain(group);
    // ...and it is not still a combo.
    expect(around).not.toContain('<Sel');
  });

  it('gives the two runs different group names', () => {
    expect(PANEL).toContain('pref-icon-theme');
    expect(PANEL).toContain('pref-toolbar-icon-size');
  });
});

describe('Rendering Engine is a group, and it is the one KiCad has', () => {
  it('offers the accelerated / fallback pair', () => {
    expect(PANEL).toContain('Rendering Engine');
    expect(PANEL).toContain('Accelerated Graphics');
    expect(PANEL).toContain('Fallback Graphics');
  });

  it('has ONE antialiasing choice, not one per engine', () => {
    // `m_antialiasing` is a single wxChoice at gbSizer11(2,1). We had two,
    // "Accelerated graphics:" and "Fallback graphics:", and no engine radio.
    expect(PANEL).toContain('Antialiasing:');
    expect(PANEL).not.toContain('Fallback graphics:');
    expect(PANEL).not.toContain('Accelerated graphics:');
  });

  it('says why the engine cannot be chosen rather than pretending', () => {
    const at = PANEL.indexOf('pref-rendering-engine');
    const block = PANEL.slice(at, at + 500);
    expect(block).toContain('disabled');
    expect(block).toMatch(/title="[^"]*browser/i);
  });
});
