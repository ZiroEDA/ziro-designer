// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Hotkeys — the page's CHROME (its contents are
 * `hotkey_list.test.ts`).
 *
 * `PANEL_HOTKEYS_EDITOR` is a filter box, a `WIDGET_HOTKEY_LIST` and a button
 * row (`common/dialogs/panel_hotkeys_editor.cpp:66-105`), and the list is a
 * `wxTreeListCtrl` whose four columns are declared with widths
 * (`common/widgets/widget_hotkey_list.cpp:541-544`):
 *
 *     AppendColumn( "Command (double-click to edit)", 450, … );
 *     AppendColumn( "Hotkey",      120, … );
 *     AppendColumn( "Alternate",   120, … );
 *     AppendColumn( "Description", 900, … );
 *
 * Two things followed from that here and neither was upstream's:
 *
 *   * those widths total 1590, and a scroll container still offers its
 *     content's max-content width to its parent's intrinsic sizing, so this
 *     page alone stretched the dialog to its 1500 px cap. A wxTreeListCtrl's
 *     best size is its own — it scrolls — and KiCad's Preferences is the same
 *     width on every page.
 *   * every row carried a "Double-click to edit" tooltip. `WIDGET_HOTKEY_LIST`
 *     calls `SetToolTip` nowhere at all: the instruction is in the column
 *     header, met once.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/PanelHotkeysEditor.tsx'),
  'utf8',
);
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
/** The panel with its comments stripped: prose ABOUT a row is not that row. */
const CODE = PANEL.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

describe('the list is the wxTreeListCtrl, at its declared widths', () => {
  it.each([
    ['.ze-hotkeys-head .cmd', '450px'],
    ['.ze-hotkeys-head .key', '120px'],
    ['.ze-hotkeys-head .desc', '900px'],
  ])('%s is %s wide', (selector, width) => {
    // [data] `AppendColumn( …, 450 / 120 / 120 / 900 )`.
    expect(rule(selector)).toContain(width);
  });

  it('names the columns as upstream names them', () => {
    expect(CODE).toContain('Command (double-click to edit)');
    // `readOnly` drops the instruction: `command_header = _( "Command" )`.
    expect(CODE).toContain("readOnly ? 'Command'");
    for (const h of ['Hotkey', 'Alternate', 'Description']) expect(CODE).toContain(h);
  });

  /**
   * The columns total 1590 and the control scrolls; its best size is its own.
   * Without this the page hands 1590 to the dialog's intrinsic width and the
   * dialog opens at its cap on this page and narrower on every other, where
   * KiCad's `PAGED_DIALOG` is one width throughout.
   */
  it('offers the dialog neither its 1590 px of columns nor its 200 rows', () => {
    const body = rule('.ze-hotkeys-list');
    // A scrolled control's best size is its own, in BOTH axes: those columns
    // put the dialog at its 1500 px width cap and the rows at its 900 px
    // height cap, where KiCad's is 1095 x 713 on every page.
    expect(body).toMatch(/contain:\s*size/);
    expect(body).toMatch(/overflow:\s*auto/);
    // Containment states it; these are what every engine acts on — a definite
    // width, and a flex BASIS of 0 rather than `auto`, which is what handed the
    // whole list's height up as the item's hypothetical main size.
    expect(body).toMatch(/width:\s*0/);
    expect(body).toMatch(/min-width:\s*100%/);
    expect(body).toMatch(/flex:\s*1 1 0/);
  });
});

/**
 * The list's TYPE, which is the theme's and not ours. From the Yaru dark
 * stylesheet, which is what this desktop is running:
 *
 *     .view, iconview, .view text        { color: white; background: #272727 }
 *     treeview.view header button        { color: #8f8f8f; font-weight: bold;
 *                                          background-color: #272727;
 *                                          padding: 0 6px }
 *     treeview.view:selected             { background-color: #E95420 }
 *       ...that rule's colour             { color: #FFFFFF }
 *     treeview.view:disabled             { color: #929292 }
 *
 * and `wxTreeListCtrl` calls SetFont nowhere, so every row is the GUI font —
 * 11 pt / 14.67 px. Ours stated 10 pt for the rows, 9 pt for the import note,
 * #9a9a9a for the whole Description column, #ffe6d9 for a selected one, and
 * drew the header light and unbolded on #373737.
 */
describe("the list takes the theme's type, not its own", () => {
  it('states no font size on a row', () => {
    expect(rule('.ze-hotkeys-row')).not.toMatch(/font-size/);
    expect(rule('.ze-hotkeys-empty')).not.toMatch(/font-size/);
    expect(rule('.ze-hotkeys-imported')).not.toMatch(/font-size/);
  });

  it('draws a row in the view foreground', () => {
    expect(rule('.ze-hotkeys-row')).toContain('var(--view-fg)');
  });

  it("gives the column header the header button's weight and ink", () => {
    const head = rule('.ze-hotkeys-head');
    expect(head).toMatch(/font-weight:\s*bold/);
    expect(head).toContain('var(--tree-header-fg)');
    // ...on the same ground as the rows, not on the dialog face.
    expect(head).toContain('var(--panel-bg)');
    expect(head).not.toMatch(/font-size/);
  });

  it('leaves the Description column the colour of every other cell', () => {
    expect(rule('.ze-hotkeys-head .desc')).not.toMatch(/(^|[;\s])color\s*:/);
  });

  it('paints a selected row in one foreground', () => {
    expect(rule('.ze-hotkeys-row.selected')).toContain('var(--view-fg)');
    expect(rule('.ze-hotkeys-row.selected .desc')).toBe('');
  });

  it('names no colour of its own for a key the browser holds', () => {
    expect(rule('.ze-hotkeys-row .key.taken')).toContain('var(--ctl-fg-disabled)');
  });
});

describe('the page says nothing KiCad does not say', () => {
  it('puts no tooltip on a row', () => {
    // `WIDGET_HOTKEY_LIST` calls SetToolTip on nothing.
    expect(CODE).not.toContain('Double-click to edit');
    // ...and the header still carries the instruction.
    expect(CODE).toContain('Command (double-click to edit)');
  });
});

/**
 * `CreateTextFilterBox` builds a `wxSearchCtrl`
 * (`panel_hotkeys_editor.cpp:48-64`): one framed box with the magnifier and the
 * cancel button drawn INSIDE it. GTK rings the frame on focus, not the text
 * area within it — ours drew a second ring inset inside the wrapper's, because
 * the shell's focus rule did not exclude `.ze-bare`, the class that says "this
 * entry is inside a frame someone else draws".
 */
describe('the filter box is one framed control', () => {
  it('rings the frame on focus', () => {
    expect(rule('.ze-tplsel-searchwrap:focus-within')).toMatch(/border-color/);
  });

  it('leaves a bare entry unringed, since its wrapper carries the frame', () => {
    const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const focusRule = /\.ze-app\s+input:not\(\[type="checkbox"\]\)[^{]*:focus,/.exec(bare);
    expect(focusRule, 'the shell focus rule moved').not.toBeNull();
    expect(focusRule?.[0]).toContain('.ze-bare');
  });

  it('carries the placeholder upstream sets', () => {
    // `SetDescriptiveText( _( "Type filter text" ) )`.
    expect(CODE).toContain('Type filter text');
  });
});
