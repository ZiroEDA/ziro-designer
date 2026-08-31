// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The book's TAIL: three top-level pages that come after the last heading.
 *
 * `ShowPreferences` closes its KIFACE loop and then keeps adding at the top
 * level (`common/eda_base_frame.cpp`):
 *
 *     book->AddLazySubPage( LAZY_CTOR( PANEL_DS_TOOLBARS ), _( "Toolbars" ) );
 *     book->AddLazyPage( … PANEL_PACKAGES_AND_UPDATES …, _( "Packages and Updates" ) );
 *     }  // end of the try block
 *     book->AddPage( new PANEL_PLUGIN_SETTINGS( book ), _( "Plugins" ) );
 *     book->AddPage( new PANEL_MAINTENANCE( book, this ), _( "Maintenance" ) );
 *
 * `AddPage`/`AddLazyPage`, not `AddLazySubPage` — so all three are siblings of
 * Drawing Sheet Editor, not its children. The capture of the installed 10.0.5
 * shows them unindented at the bottom of a fully collapsed tree.
 *
 * Ours grouped the tree by POSITION — every page since the last heading belongs
 * to it — which is right for every other page in the book and wrong for exactly
 * these three. It put all three inside Drawing Sheet Editor: indented under it,
 * and gone entirely whenever it was collapsed, which is its default state.
 *
 * The same rule is written twice more, in `shippedUnder` and in the expansion
 * test's `expectedRows`, and the position reading was wrong in all three. So
 * this asserts the rendered tree, which is the only one of the three a user
 * can see.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import { shippedUnder } from '@ziroeda/designer/src/dialogs/prefs/registry.js';

afterEach(cleanup);

/**
 * Upstream's tail is three rows. Two of them, Packages and Updates and Plugins,
 * were built here and then removed — every control on either names a desktop
 * concept, and a page that can only explain its own emptiness is worse than an
 * absent row. Maintenance stayed: it edits the settings store.
 *
 * One row is still enough to catch the bug this file exists for, because the
 * bug was positional: ANY top-level page after the last heading was swept into
 * it.
 */
const TAIL = ['Maintenance'];

/** Rows drawn at the tree's top level: direct children, plus section headings. */
const topLevelRows = (): string[] =>
  [...document.querySelectorAll('.ze-paged-tree > .ze-tree-item, .ze-paged-tree > div')].flatMap(
    (el) =>
      el.classList.contains('ze-tree-item')
        ? [el.textContent?.trim() ?? '']
        : [el.querySelector(':scope > .ze-tree-item.root')?.textContent?.trim() ?? ''],
  );

describe('the tail of the book is top-level, not the last section’s children', () => {
  it('draws all three with the tree fully collapsed', () => {
    render(<PreferencesDialog onClose={() => {}} />);
    const drawn = [...document.querySelectorAll('.ze-paged-tree .ze-tree-item')].map(
      (el) => el.textContent?.trim() ?? '',
    );
    for (const label of TAIL) expect(drawn).toContain(label);
  });

  it('draws them at the top level, after Drawing Sheet Editor', () => {
    render(<PreferencesDialog onClose={() => {}} />);
    const rows = topLevelRows();
    const ds = rows.indexOf('Drawing Sheet Editor');
    expect(ds).toBeGreaterThan(-1);
    expect(rows.slice(ds + 1)).toStrictEqual(TAIL);
  });

  it('and they survive collapsing Drawing Sheet Editor, being no child of it', () => {
    // The tree opens collapsed, so this is the default state: if they were its
    // children they would not be on screen at all.
    render(<PreferencesDialog onClose={() => {}} />);
    expect(shippedUnder('Drawing Sheet Editor')).toStrictEqual([
      'Display Options',
      'Grids',
      'Colors',
      'Toolbars',
    ]);
    for (const label of TAIL) expect(shippedUnder('Drawing Sheet Editor')).not.toContain(label);
  });
});
