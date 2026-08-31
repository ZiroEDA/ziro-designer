// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The page tree opens with at most ONE section expanded.
 *
 * `EDA_BASE_FRAME::ShowPreferences` builds an `expand` vector, and every push
 * into it carries the same guard (`common/eda_base_frame.cpp`):
 *
 *     if( GetFrameType() == FRAME_SCH )
 *         expand.push_back( (int) book->GetPageCount() );
 *     book->AddPage( new wxPanel( book ), _( "Schematic Editor" ) );
 *     ...
 *     for( int page : expand )
 *         book->ExpandNode( page );
 *
 * Seven guards on mutually exclusive frame types, so the vector holds one entry
 * or none: the section belonging to the window you opened Preferences from.
 * Open it from the project manager, whose type matches no guard, and the whole
 * tree is shut — which is what a capture of the installed 10.0.5 shows, fifteen
 * closed top-level rows.
 *
 * Ours read that loop as running over every node and started fully expanded.
 * The comment saying so was the bug: "All expanded by default, as `ExpandNode`
 * on every node leaves it."
 *
 * Rendered, not grepped, and asserted on the ROWS rather than on the state: a
 * source check cannot tell an initial `collapsed` set that reaches the tree
 * from one the tree ignores, and `collapsed` is not what a user sees.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import { PAGES } from '@ziroeda/designer/src/dialogs/prefs/registry.js';

afterEach(cleanup);

/** Every row the tree is actually drawing, in order. */
const rows = (): string[] =>
  [...document.querySelectorAll('.ze-paged-tree .ze-tree-item')].map(
    (el) => el.textContent?.trim() ?? '',
  );

/** The headings, and the sub-page labels each carries, straight from the book. */
const HEADINGS = PAGES.filter((p) => p.id === null).map((p) => p.label);

/**
 * The rows the tree should draw with exactly `expanded` open, in tree order.
 *
 * The whole sequence, not a set of `toContain`s: "Display Options" is the label
 * of three different pages - Schematic, PCB and Drawing Sheet each have one -
 * so asking whether it is absent cannot distinguish which section opened. The
 * first version of this test did exactly that and failed against correct code.
 *
 * `PAGES` is already in tree order (the parentless run, then each heading
 * followed by its sub-pages), so filtering it in place IS the expected render.
 */
function expectedRows(expanded: readonly string[]): string[] {
  const out: string[] = [];
  let section = '';
  for (const p of PAGES) {
    if (p.id === null) {
      section = p.label;
      out.push(p.label);
    } else if (p.indent !== true) {
      // A top-level page. `AddPage` rather than `AddLazySubPage`, so it does
      // not belong to the heading above it and is never hidden by collapsing
      // that heading -- which matters at the tail of the book, where Packages
      // and Updates, Plugins and Maintenance follow the last KIFACE's section.
      section = '';
      out.push(p.label);
    } else if (expanded.includes(section)) {
      out.push(p.label);
    }
  }
  return out;
}

describe('opened from a frame with no section of its own', () => {
  it('draws every heading and not one sub-page', () => {
    render(<PreferencesDialog onClose={() => {}} />);
    expect(rows()).toStrictEqual(expectedRows([]));
    // Not vacuous: the book carries sub-pages, so "nothing collapsed" would
    // give a longer list than this one.
    expect(expectedRows(HEADINGS).length).toBeGreaterThan(expectedRows([]).length);
  });
});

describe('opened from an editor', () => {
  it.each([
    ['schematic', 'Schematic Editor'],
    ['pcb', 'PCB Editor'],
    ['drawingsheet', 'Drawing Sheet Editor'],
  ] as const)('%s expands %s and nothing else', (owner, heading) => {
    render(<PreferencesDialog onClose={() => {}} frameOwner={owner} />);
    expect(rows()).toStrictEqual(expectedRows([heading]));
    // The section really does carry rows, so the assertion is not the same
    // list as the fully-collapsed one.
    expect(expectedRows([heading]).length).toBeGreaterThan(expectedRows([]).length);
  });
});

describe('opened at a named page', () => {
  it('reveals it, and leaves the other sections shut', () => {
    // `m_treebook->SetSelection( lastPageIndex )` (paged_dialog.cpp:251) after
    // the hierarchy search for the page SetInitialPage recorded. This is the
    // whole of COMMON_TOOLS::GridProperties, so a Grids row hidden inside a
    // shut node would be that action failing.
    render(<PreferencesDialog onClose={() => {}} initialPage="sch-grids" />);
    expect(rows()).toStrictEqual(expectedRows(['Schematic Editor']));
    expect(document.querySelector('.ze-tree-item.active')?.textContent).toBe('Grids');
  });
});

/**
 * Every top-level row's LABEL starts at the same x.
 *
 * A wxTreeCtrl reserves one expander-button column per level and draws a button
 * only where the node has children, so a parentless page and a section parent —
 * both level 0 — put their text in the same place. Measured on the installed
 * 10.0.5, first ink per row: Common 491 (its selection band, which begins a few
 * px before the text), Mouse and Touchpad 495, SpaceMouse 494, Hotkeys 495,
 * Version Control 494, Packages and Updates 495, Plugins 495, Maintenance 495 —
 * against Symbol Editor 494, Schematic Editor 494, PCB Editor 495. The twistys
 * sit out at 474, in the gutter.
 *
 * Ours gave the parentless rows no gutter at all, so they hung left of every
 * section name. The fix is the same empty box rather than a padding restating
 * its width, so this asserts the BOX is there — a padding of the wrong size
 * would still align by accident at one font size and drift at another.
 */
describe('top-level rows all reserve the expander gutter', () => {
  it('gives a parentless page the same twisty box a section has', () => {
    render(<PreferencesDialog onClose={() => {}} />);
    const items = [...document.querySelectorAll('.ze-paged-tree > .ze-tree-item')];
    // The parentless run is the direct children of the tree; sections wrap
    // theirs in a div. So these are exactly Common, Mouse and Touchpad, Hotkeys.
    expect(items.length).toBeGreaterThan(0);
    for (const el of items) {
      const twisty = el.querySelector(':scope > .twisty');
      expect(twisty, el.textContent ?? '').not.toBeNull();
      // Reserved, not drawn: no chevron on a row with no children.
      expect(twisty?.classList.contains('expandable'), el.textContent ?? '').toBe(false);
    }
  });

  it('and a section still draws its chevron in that gutter', () => {
    render(<PreferencesDialog onClose={() => {}} />);
    const headings = [...document.querySelectorAll('.ze-tree-item.root')];
    expect(headings.length).toBeGreaterThan(0);
    for (const el of headings) {
      expect(el.querySelector(':scope > .twisty.expandable'), el.textContent ?? '').not.toBeNull();
    }
  });
});
