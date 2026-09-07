// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Choose Symbol dialog's shell: the two icons its search box owns, the
 * frame round its tree, the faces of its four regions, and the geometry of the
 * details table.
 *
 * Every number here was MEASURED, and by a probe rather than off a picture:
 * `qa/probes/chooser_shell_probe.cpp` builds the widgets PANEL_SYMBOL_CHOOSER
 * builds and reads the mapped window back out of the display server, and
 * `qa/probes/libtree_details_probe.cpp` lays out the real details template and
 * reports where every cell lands. A screenshot cannot settle any of it: Yaru
 * declares `theme_unfocused_bg_color #343434` and `theme_unfocused_base_color
 * #2f2f2f` against `#2c2c2c` and `#272727` focused, and the shell's capture UI
 * holds the focus while it shoots - so every window in a screenshot is in GTK's
 * `:backdrop` state and every face in it reads one step light.
 *
 * Three halves, and they fail for different reasons on purpose:
 *
 *  - the RENDERED half asks the real component. A structural claim - that the
 *    magnifier is inside the entry rather than a button beside it, that the
 *    header and the rows share one frame - is about the tree the component
 *    builds, and a source scan cannot tell a moved element from a renamed one.
 *  - the DECLARED half pins the values. qa cannot mount the dialog (the preview
 *    is WebGL), so for colours and lengths this is a check on shell.css's TEXT:
 *    it pins spelling, not what a browser paints. That is the seam, and it is
 *    the same one `editor_default_toggles.test.ts` documents.
 *  - the ABSENCES half pins what upstream does NOT draw. Every value assertion
 *    above still passes with a spurious border added, so without this half the
 *    boxing Akshay complained about could come straight back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { LibTree } from '@ziroeda/designer/src/widgets/lib_tree.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

afterEach(cleanup);

// `import.meta.url` is not a file: URL under happy-dom, so the path is
// resolved from vitest's root (`qa/`) instead.
const SHELL = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

/** A token's declared value, or undefined when it is not declared at all. */
function token(name: string): string | undefined {
  const m = SHELL.match(new RegExp(`^\\s*--${name}\\s*:\\s*([^;]+);`, 'm'));
  return m?.[1]?.trim();
}

/**
 * One rule's body, by its exact selector text.
 *
 * Per rule, not per file: `SHELL.includes('--splitter-sash')` would pass while
 * the token sat in a comment or on some unrelated selector, which is the shape
 * of check that cannot fail.
 */
function rule(selector: string): string {
  const at = SHELL.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule in shell.css for \`${selector}\``);
  const end = SHELL.indexOf('\n}', at);
  return SHELL.slice(at + selector.length + 2, end).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** One declaration of a rule, comments stripped so a var() in prose cannot count. */
function decl(selector: string, prop: string): string | undefined {
  const m = rule(selector).match(new RegExp(`(?:^|;|\\{)\\s*${prop}\\s*:\\s*([^;]+);`));
  return m?.[1]?.trim();
}

/**
 * The two glyphs, verbatim from the ICON THEME.
 *
 * /usr/share/icons/Yaru/scalable/actions/edit-find-symbolic.svg and
 * edit-clear-symbolic.svg - the files GTK hands a GtkSearchEntry for its
 * primary and secondary icon slots, which is where KiCad's come from too
 * (chooser_shell_probe reports exactly those two names). Copied here so a
 * "tidy-up" of the path data has something to fail against; the file on disk is
 * the authority, not this string.
 */
const EDIT_FIND_SYMBOLIC =
  'M7 1C3.69 1 1 3.69 1 7s2.69 6 6 6a5.948 5.948 0 0 0 3.664-1.273l2.863 2.863 1.063-1.063-2.863-2.863A5.949 5.949 0 0 0 13 7c0-3.31-2.69-6-6-6zm0 1a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5z';
const EDIT_CLEAR_SYMBOLIC =
  'm4.9336 3-4.2227 4.2227-0.0039062-0.0039062-0.70703 0.70703 0.0039063 0.0039063-0.0039063 0.0039063 0.70703 0.70703 0.0039062-0.0039062 3.0469 3.0488 1.2422 1.2402v2e-3l0.072266 0.072219h10.928v-10h-11zm0.41406 1h9.6523v8h-9.5117l-4.0703-4.0703zm2.3594 1-0.70703 0.70703 2.2969 2.2969-2.2969 2.2988 0.70703 0.70703 2.2969-2.2988 2.2988 2.2988 0.70703-0.70703-2.2988-2.2988 2.2988-2.2969-0.70703-0.70703-2.2988 2.2969z';

function tree(initialSearch = ''): HTMLElement {
  const adapter = new LibTreeModelAdapter();
  adapter.addGroup('-- Recently Used --');
  adapter.addGroup('-- Already Placed --');
  const { container } = render(
    <LibTree
      adapter={adapter}
      initialSearch={initialSearch}
      onSelect={() => {}}
      onChoose={() => {}}
    />,
  );
  return container;
}

describe("the search box owns both of its icons, because a wxSearchCtrl's entry does", () => {
  it('puts the magnifier inside the entry, beside the input and not before it', () => {
    const entry = tree().querySelector('.ze-libtree-entry');
    expect(entry).not.toBeNull();
    // Both children of the same box. When the magnifier was a button in the row
    // it was a SIBLING of the entry, and the box drew its own border round the
    // input alone - which is the thing that read as "not KiCad" at a glance.
    expect(entry?.querySelector('input.ze-search')).not.toBeNull();
    expect(entry?.querySelector('.ze-entry-icon.left')).not.toBeNull();
  });

  it("draws the icon theme's edit-find-symbolic, not a magnifier of our own", () => {
    const icon = tree().querySelector('.ze-entry-icon.left path');
    expect(icon?.getAttribute('d')).toBe(EDIT_FIND_SYMBOLIC);
    // Symbolic: GTK recolours it, so the fill has to follow the CSS colour.
    expect(icon?.getAttribute('fill')).toBe('currentColor');
  });

  it('shows the cancel icon only while there is something to cancel', () => {
    // GtkSearchEntry hangs the secondary icon off a non-empty value, so an
    // always-present ✕ is one control too many on an empty box.
    const empty = tree('');
    // The control: `toBeNull()` on an empty container passes for the wrong
    // reason, so prove the box rendered and is genuinely empty first.
    expect((empty.querySelector('input.ze-search') as HTMLInputElement).value).toBe('');
    expect(empty.querySelector('.ze-entry-icon.right')).toBeNull();
    expect(tree('terminal').querySelector('.ze-entry-icon.right')).not.toBeNull();
  });

  it("draws the icon theme's edit-clear-symbolic, which is not an ✕", () => {
    const container = tree('terminal');
    const icon = container.querySelector('.ze-entry-icon.right path');
    expect(icon?.getAttribute('d')).toBe(EDIT_CLEAR_SYMBOLIC);
    // And it is a glyph, not text: a bare "✕" is what this used to be.
    expect(container.querySelector('.ze-entry-icon.right')?.textContent).toBe('');
  });

  it('clears the filter when it is pressed', () => {
    const container = tree('terminal');
    const input = container.querySelector('input.ze-search') as HTMLInputElement;
    expect(input.value).toBe('terminal');
    fireEvent.click(container.querySelector('.ze-entry-icon.right') as Element);
    expect(input.value).toBe('');
    expect(container.querySelector('.ze-entry-icon.right')).toBeNull();
  });

  it('keeps the wxStaticLine between the entry and the sort button', () => {
    // search_sizer is entry | wxStaticLine wxLI_VERTICAL | BITMAP_BUTTON
    // (lib_tree.cpp:83-88). Ours had no separator at all.
    const container = tree();
    // Array.from, not a spread: qa's tsc has no downlevel iteration.
    const kids = Array.from(container.querySelector('.ze-libtree-search')?.children ?? []);
    expect(kids.map((k) => k.className)).toStrictEqual([
      'ze-libtree-entry',
      'ze-libtree-sep',
      'ze-libtree-sortbtn-wrap',
    ]);
  });
});

describe('the wxDataViewCtrl is one control', () => {
  it('puts the column header and the rows inside one frame', () => {
    // A dataview's frame wraps its header AND its rows. While the header and
    // the list were siblings of the search row, any border had to go round one
    // or the other, and ours went round the whole LIB_TREE - which is built
    // wxNO_BORDER (lib_tree.cpp:56-57) and has no frame at all.
    const control = tree().querySelector('.ze-libtree-tree');
    expect(control).not.toBeNull();
    expect(control?.querySelector(':scope > .ze-libtree-cols')).not.toBeNull();
    expect(control?.querySelector(':scope > .ze-libtree-list')).not.toBeNull();
  });
});

describe('the values, as the probes measured them', () => {
  it('gives the splitter sash wxSplitterWindow::GetSashSize and its own grey', () => {
    expect(token('splitter-sash')).toBe('#181818');
    expect(token('splitter-sash-size')).toBe('5px');
    expect(decl('.ze-sash', 'background')).toBe('var(--splitter-sash)');
    expect(decl('.ze-sash.v', 'width')).toBe('var(--splitter-sash-size)');
    expect(decl('.ze-sash.h', 'height')).toBe('var(--splitter-sash-size)');
  });

  it("gives the column header Yaru's treeview header button", () => {
    expect(token('libtree-header-fg')).toBe('#8f8f8f');
    expect(token('libtree-header-height')).toBe('24px');
    expect(decl('.ze-libtree-cols', 'color')).toBe('var(--libtree-header-fg)');
    expect(decl('.ze-libtree-cols', 'height')).toBe('var(--libtree-header-height)');
    // Not --panel-header (#2e2e2e): that is the wxAUI pane caption bar.
    expect(decl('.ze-libtree-cols', 'background')).toBe('var(--chrome-bg2)');
    expect(decl('.ze-libtree-cols', 'font-weight')).toBe('bold');
    // `border-style: none solid solid none; border-color: #2c2c2c`, which is
    // the window background showing through rather than a border colour.
    expect(decl('.ze-libtree-cols', 'border-bottom')).toBe('1px solid var(--chrome-bg)');
    expect(decl('.ze-libtree-cols > span', 'padding')).toBe('0 6px');
  });

  it('paints the tree and the details pane on wxSYS_COLOUR_LISTBOX / _WINDOW', () => {
    // Both #272727, and both were taking the dialog's own #2c2c2c.
    expect(decl('.ze-libtree-tree', 'background')).toBe('var(--chrome-bg2)');
    expect(decl('.ze-libtree-tree', 'border')).toBe('1px solid var(--ctl-border)');
    expect(decl('.ze-libtree-details', 'background')).toBe('var(--chrome-bg2)');
    expect(decl('.ze-libtree-details', 'color')).toBe('var(--view-fg)');
    // wxHtmlWindow's own 10px border, and LIB_TREE's 5:2 sizer split with
    // `wxTOP, 5` above (lib_tree.cpp:181, 193-197).
    expect(decl('.ze-libtree-details', 'padding')).toBe('10px');
    expect(decl('.ze-libtree-details', 'margin-top')).toBe('5px');
    expect(decl('.ze-libtree-details', 'flex')).toBe('2');
    expect(decl('.ze-libtree-tree', 'flex')).toBe('5');
  });

  it('colours the entry icons and the separator the way GTK does', () => {
    expect(token('entry-icon-fg')).toBe('#cdcdcd');
    expect(decl('.ze-entry-icon', 'color')).toBe('var(--entry-icon-fg)');
    expect(decl('.ze-entry-icon', 'width')).toBe('16px');
    expect(decl('.ze-entry-icon', 'height')).toBe('16px');
    expect(decl('.ze-entry-icon.left', 'left')).toBe('9px');
    expect(decl('.ze-entry-icon.right', 'right')).toBe('9px');
    // The text starts clear of the icon: 9 inset + 16 icon + Yaru's 6px
    // `entry image.left` margin-right = 31.
    //
    // Delivered by FEEDING the shared entry rule its token, not by restating
    // the padding here. `.ze-app input:not([type=checkbox])…:not(.ze-bare)` is
    // (0,6,1) -- every :not() contributes its argument -- so a local
    // padding-left at (0,2,0) lost to it and the magnifier drew on top of the
    // placeholder. Measured in the live dialog: it computed 8px, not 31.
    expect(decl('.ze-libtree-entry', '--field-pad-x')).toBe('31px');
    // An overlay, not a grey: `separator { background: rgba(0,0,0,0.1) }`, and
    // wx reports the same widget's background as #0000001A.
    expect(token('gtk-separator')).toBe('rgb(0 0 0 / 10%)');
    expect(decl('.ze-libtree-sep', 'background')).toBe('var(--gtk-separator)');
    expect(decl('.ze-libtree-sep', 'flex')).toBe('0 0 2px');
  });

  it('does not restate that padding on the input, where it would lose', () => {
    // The control beside the token assertion above. Re-adding
    // `.ze-libtree-entry .ze-search { padding-left: … }` would look like a fix,
    // pass a naive test, and change nothing on screen.
    expect(SHELL).not.toMatch(/\.ze-libtree-entry \.ze-search\s*\{/);
  });

  it("lays the details table out on wxHtml's own cellpadding and cellspacing", () => {
    // 3 and 2, which is the one pair that explains all three measurements:
    // label column at x 15, value column at x 99 behind a 76px label, rows 29
    // apart (21px line box + 3 + 3 + 2).
    expect(decl('.ze-libtree-details table', 'border-spacing')).toBe('2px');
    expect(decl('.ze-libtree-details table', 'border-collapse')).toBe('separate');
    expect(decl('.ze-libtree-details td', 'padding')).toBe('3px');
    // The <hr> is 1px with one line box of air above and below it.
    expect(decl('.ze-libtree-details hr', 'height')).toBe('1px');
    expect(decl('.ze-libtree-details hr', 'margin')).toBe('var(--libtree-details-line) 0');
    // wxSYS_COLOUR_HOTLIGHT, which is where HTML_WINDOW::SetPage gets `link`.
    expect(token('link-fg')).toBe('#f08762');
    expect(decl('.ze-libtree-details a', 'color')).toBe('var(--link-fg)');
  });

  it('opens at horizPixelsFromDU( 440 ) by horizPixelsFromDU( 340 )', () => {
    // 880 x 680 measured by chooser_shell_probe. The height carries the title
    // bar we draw ourselves and GTK does not put in SetSize.
    expect(decl('.ze-modal.ze-symbol-chooser', 'width')).toBe('880px');
    expect(decl('.ze-modal.ze-symbol-chooser', 'height')).toBe('calc(680px + 37px)');
    expect(decl('.ze-modal-header', 'height')).toBe('37px');
  });

  it('seeds both sashes off the dialog units FinishSetup uses', () => {
    // Upstream stores the FIRST pane; ours store the second, so each is the
    // container less the 5px sash less upstream's number.
    expect(EESCHEMA_DEFAULTS.sym_chooser.sash_pos_h).toBe(880 - 440 - 5);
    expect(EESCHEMA_DEFAULTS.sym_chooser.sash_pos_v).toBe(631 - 460 - 5);
  });
});

describe('and what upstream does not draw', () => {
  it('puts no frame round the LIB_TREE, which is built wxNO_BORDER', () => {
    expect(decl('.ze-chooser-treepane > .ze-libtree', 'border')).toBeUndefined();
    expect(decl('.ze-chooser-treepane > .ze-libtree', 'border-radius')).toBeUndefined();
    // rule() throws on a selector that is not in the file, so reaching this
    // line at all proves those two are absences and not a missing rule.
    // treeSizer's wxALL is four sides, and this used to give it three.
    expect(decl('.ze-chooser-treepane > .ze-libtree', 'margin')).toBe('5px');
  });

  it('puts no frame round the preview panes, which are bare wxPanels', () => {
    // The control: an absence read off a rule that does not exist, or off a
    // prop name decl() cannot see, is undefined for the wrong reason. One
    // declaration we know IS there proves the reader is pointed at the rule.
    expect(decl('.ze-chooser-right > div', 'overflow')).toBe('hidden');
    expect(decl('.ze-chooser-right > div', 'border')).toBeUndefined();
    expect(decl('.ze-chooser-right > div', 'border-radius')).toBeUndefined();
  });

  it('puts no padding and no rule on the search row', () => {
    // `sizer->Add( search_sizer, 0, wxEXPAND, 5 )` - wxEXPAND with no direction
    // flag, so that 5 is never applied to anything.
    expect(decl('.ze-libtree-search', 'display')).toBe('flex'); // the control
    expect(decl('.ze-libtree-search', 'padding')).toBeUndefined();
    expect(decl('.ze-libtree-search', 'border-bottom')).toBeUndefined();
    expect(decl('.ze-libtree-search', 'gap')).toBeUndefined();
  });

  it('leaves no gap between the footprint selector and the footprint preview', () => {
    // constructRightPanel gives the selector wxLEFT|wxRIGHT and the preview
    // wxLEFT|wxRIGHT|wxBOTTOM: neither states a wxTOP, so they touch.
    expect(decl('.ze-chooser-right', 'padding')).toBe('5px'); // the control
    expect(decl('.ze-chooser-right', 'gap')).toBeUndefined();
    expect(decl('.ze-chooser-preview', 'margin-bottom')).toBe('5px');
  });

  it('dims nothing in the tree, because GetAttr sets only italic', () => {
    // LIB_TREE_MODEL_ADAPTER::GetAttr (lib_tree_model_adapter.cpp:781-801)
    // touches one attribute on one cell and never a colour or a weight.
    // The control was `flex: 1` until the columns took the adapter's own widths
    // (`m_colWidths`: Item 300, Description 600) and stopped dividing the pane
    // between themselves; `overflow` is the declaration on this selector that
    // has nothing to do with either change.
    expect(decl('.ze-libtree-row .col-desc', 'overflow')).toBe('hidden'); // the control
    expect(decl('.ze-libtree-row .col-desc', 'color')).toBeUndefined();
    expect(decl('.ze-libtree-row.lib', 'font-weight')).toBe('400');
  });
});
