// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's Libraries pane is the SHARED tree widget, and behaves
 * like one.
 *
 * `SYMBOL_TREE_PANE` (`eeschema/widgets/symbol_tree_pane.cpp:34-58`) is a
 * `wxPanel` whose entire body is one `LIB_TREE`:
 *
 *     m_tree = new LIB_TREE( this, wxT( "symbols" ), m_libMgr->GetAdapter(),
 *                            LIB_TREE::SEARCH | LIB_TREE::MULTISELECT );
 *     boxSizer->Add( m_tree, 1, wxEXPAND, 5 );
 *
 * — the same `common/widgets/lib_tree.cpp` the symbol chooser and CvPcb mount,
 * with a different ADAPTER and nothing else different. Ours had a second tree:
 * a `treeRows` memo and about eighty lines of JSX inside `SymbolEditor.tsx`.
 *
 * ---------------------------------------------------------------------------
 * WHY EACH BEHAVIOUR IS ITS OWN TEST
 * ---------------------------------------------------------------------------
 *
 * "A tree appears" passes against either implementation and is worthless here.
 * So each `it` below names one thing the private tree did NOT do — the column
 * header, the search entry's own icons, the sort/expand menu, the virtualised
 * row window — or one thing it DID do that had to survive the swap: single
 * click selects, double click loads, expanding fetches, and a load makes the
 * tree follow the canvas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import { SymbolEditor } from '@ziroeda/designer/src/editors/symbol/SymbolEditor.js';

const LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "R" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (property "Description" "Resistor" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "R_0_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
  (symbol "C" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "C" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "C" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "C_0_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
  (symbol "R_Small" (extends "R")
    (property "Value" "R_Small" (at 0 0 0) (effects (font (size 1.27 1.27))))
  )
)`;

/** A project whose `sym-lib-table` registers one library, as `openProject` in
 *  `sym_ui_conditions_dom.test.tsx` does. */
const PROJECT = [
  {
    name: 'sym-lib-table',
    text: `(sym_lib_table (version 7)
  (lib (name "Device")(type "KiCad")(uri "\${KIPRJMOD}/Device.kicad_sym")(options "")(descr ""))
)`,
  },
  { name: 'Device.kicad_sym', text: LIB },
];

const rows = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll('.ze-libtree-row')) as HTMLElement[];
const itemText = (row: HTMLElement): string =>
  row.querySelector('.col-item')?.textContent?.trim() ?? '';
const rowNamed = (root: HTMLElement, name: string): HTMLElement | undefined =>
  rows(root).find((r) => itemText(r) === name);

/**
 * "A symbol is on the canvas", read off the toolbar: Rotate is
 * `isEditableInAliasCond` (`symbol_edit_frame.cpp:555`), i.e. `m_symbol`.
 * The frame title would say the same thing but `document.title` is not what
 * this frame writes when it is one view among several.
 */
const rotateLive = (root: HTMLElement): boolean =>
  Array.from(root.querySelectorAll('button')).some(
    (b) => b.getAttribute('title') === 'Rotate clockwise' && !b.hasAttribute('disabled'),
  );

let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(String(url));
    return Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }));
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Mount on the project and wait for the tree to have rows. */
const open = async (): Promise<{ container: HTMLElement; unmount: () => void }> => {
  const { container, unmount } = render(
    <SymbolEditor onExitToHome={() => {}} initialProject={PROJECT} />,
  );
  await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
  return { container, unmount };
};

describe('the pane is LIB_TREE, not a tree of its own', () => {
  /**
   * The structural claim, both ways round. `.ze-libtree` is the shared
   * widget's root and `.ze-tree-item` was the private rows' class — asserting
   * only the first would pass with both trees mounted side by side.
   */
  it('mounts the shared widget and no private rows', async () => {
    const { container, unmount } = await open();
    const state = {
      shared: container.querySelectorAll('.ze-libtree').length,
      private: container.querySelectorAll('.ze-tree-item').length,
    };
    unmount();
    expect(state).toEqual({ shared: 1, private: 0 });
  });

  /**
   * `wxDataViewCtrl` column headers. The private pane had none at all, which
   * is the defect a reader notices first: KiCad's Libraries pane is headed
   * "Item", and the columns come from `m_shownColumns`
   * (`lib_tree_model_adapter.cpp:loadColumnConfig`), whose default is
   * Item / Description / Value.
   */
  it('has the column header row, headed Item', async () => {
    const { container, unmount } = await open();
    const header = container.querySelector('.ze-libtree-cols');
    const cols = Array.from(header?.children ?? []).map((c) => c.textContent);
    unmount();
    expect(cols[0]).toBe('Item');
    expect(cols.length).toBeGreaterThan(1);
  });

  /**
   * `m_query_ctrl = new wxSearchCtrl(...)` with `ShowCancelButton( true )`
   * (`lib_tree.cpp:79-81`), which on GTK3 is a `GtkSearchEntry` and draws
   * `edit-find-symbolic` in its primary icon slot. The private pane was a bare
   * `<input className="ze-search">` with no icon in it and no menu beside it —
   * the sort/expand menu is `LIB_TREE`'s own (`:96-105`, which builds it out of
   * `ACTIONS::expandAll` / `ACTIONS::collapseAll`).
   */
  it('has the search entry with its icon and the sort/expand menu button', async () => {
    const { container, unmount } = await open();
    const state = {
      icons: container.querySelectorAll('.ze-libtree-search svg').length > 0,
      menu: container.querySelectorAll('.ze-libtree-sortbtn').length,
    };
    unmount();
    expect(state).toEqual({ icons: true, menu: 1 });
  });
});

describe('what the private tree did, and still happens', () => {
  /**
   * `EVT_LIBITEM_SELECTED` reaching `GetTargetLibId` (`symbol_edit_frame.cpp:1359`).
   * The observable end of it is `symbolProperties`, whose condition is
   * `symbolSelectedInTreeCondition || …` (:634) — the ONLY branch a cold frame
   * with a tree selection can satisfy.
   */
  it('a single click selects the row without loading it', async () => {
    const { container, unmount } = await open();
    const props = (): boolean =>
      Array.from(container.querySelectorAll('button')).some(
        (b) => b.getAttribute('title') === 'Edit symbol properties' && !b.hasAttribute('disabled'),
      );
    const before = props();
    fireEvent.click(rowNamed(container, 'R')!);
    const state = { before, after: props(), loaded: rotateLive(container) };
    unmount();
    // Rotate is `isEditableInAliasCond`, i.e. `m_symbol` — still dead, because
    // selecting a row is not opening it.
    expect(state).toEqual({ before: false, after: true, loaded: false });
  });

  /**
   * `SYMBOL_TREE_PANE::onSymbolSelected`, bound to `EVT_LIBITEM_CHOSEN`
   * (`symbol_tree_pane.cpp:53`) — the double-click that actually loads. The
   * frame title is `SYMBOL_EDIT_FRAME::UpdateTitle`'s, so it names the symbol
   * only once `m_symbol` is set.
   */
  it('a double click loads the symbol', async () => {
    const { container, unmount } = await open();
    expect(rotateLive(container)).toBe(false);
    fireEvent.doubleClick(rowNamed(container, 'R')!);
    await waitFor(() => expect(rotateLive(container)).toBe(true));
    unmount();
  });

  /**
   * Expanding a library fetches it. Upstream has every library resident before
   * the tree appears (`IFACE::PreloadLibraries`); ours fetches the
   * `.kicad_sym` on expand, and that is the one piece of the private tree's
   * `toggleLib` that had to survive — `LIB_TREE` owns the expansion state now,
   * so the frame only hears about it through `onToggleLibrary`.
   */
  it('the twisty collapses and re-expands the library', async () => {
    const { container, unmount } = await open();
    const twisty = (): Element => rowNamed(container, 'Device')!.querySelector('.twisty')!;
    // A lone library is already expanded by `showResults`' last fallback
    // (`UpdateSearchString`), so the first click is the collapse.
    expect(twisty().classList.contains('open')).toBe(true);
    fireEvent.click(twisty());
    const collapsed = rows(container).length;
    fireEvent.click(twisty());
    const expanded = rows(container).length;
    unmount();
    // One library row when collapsed, plus its three symbols when open.
    expect({ collapsed, expanded }).toEqual({ collapsed: 1, expanded: 4 });
  });

  /**
   * `SelectLibId`'s FIRST half:
   *
   *     wxDataViewItem item = m_adapter->FindItem( aLibId );
   *     if( item.IsOk() ) m_tree_ctrl->ExpandAncestors( item );
   *
   * With TWO libraries in the tree neither one opens by itself — `showResults`'
   * lone-library fallback does not fire — so the loaded symbol's row is only
   * reachable if its library was expanded for it. Every other case in this file
   * has a single library, which opens on its own and hides this entirely: a
   * `SelectLibId` that selected without expanding passed all of them.
   */
  it("expands the loaded symbol's library when it is not the only one", async () => {
    const sym = readSymbolLib(parse(LIB)).find((s) => s.libId === 'R')!;
    const { container, unmount } = render(
      <SymbolEditor
        onExitToHome={() => {}}
        initialProject={PROJECT}
        schematicSymbol={{ symbol: sym, unit: 1, bodyStyle: 1, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(rotateLive(container)).toBe(true));
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(2));
    const libs = rows(container)
      .filter((r) => r.classList.contains('lib'))
      .map(itemText);
    const active = rows(container).find((r) => r.classList.contains('active'));
    unmount();
    // Both libraries are present, and the borrowed symbol's row is visible and
    // selected — which it can only be if `Schematic` was expanded.
    expect(libs.sort()).toEqual(['Device', 'Schematic *']);
    expect(active && itemText(active)).toBe('R *');
  });

  /**
   * `LIB_TREE::SelectLibId`, which `SYMBOL_EDIT_FRAME` calls so the tree
   * follows the canvas. Loading `C` from the menu-less side (a double-click on
   * its row) must leave `C` — not `R` — as the tree's selected row, and the
   * selection is `LIB_TREE`'s `.active` class.
   */
  it('the tree follows the canvas after a load', async () => {
    const { container, unmount } = await open();
    fireEvent.doubleClick(rowNamed(container, 'C')!);
    await waitFor(() => expect(rotateLive(container)).toBe(true));
    await waitFor(() =>
      expect(rows(container).find((r) => r.classList.contains('active'))).toBeDefined(),
    );
    const active = itemText(rows(container).find((r) => r.classList.contains('active'))!);
    unmount();
    expect(active).toBe('C');
  });

  /**
   * The Description column, which the private tree showed as dim text after
   * the name. It is a real column now, so a symbol with a Description has it
   * in cell 2 and one without has an empty cell — the difference the old
   * inline `{row.desc && …}` collapsed.
   */
  it('shows a symbol description in the Description column', async () => {
    const { container, unmount } = await open();
    const cell = (name: string): string =>
      rowNamed(container, name)?.querySelectorAll('.col-desc')[0]?.textContent ?? '';
    const state = { R: cell('R'), C: cell('C') };
    unmount();
    expect(state).toEqual({ R: 'Resistor', C: '' });
  });
});

// ---------------------------------------------------------------------------
// The synchronizing adapter, rendered
// ---------------------------------------------------------------------------

describe('the row faces reach the DOM', () => {
  /**
   * `symbol_tree_adapter.test.ts` pins what the adapter ANSWERS; this pins that
   * `LIB_TREE` asks it. Both halves are needed: the widget used to compute the
   * name and the italic itself, so an adapter with the right rules would have
   * changed nothing on screen.
   *
   * The state is reached through `schematicSymbol`, the frame's `MAIL_LIB_EDIT`
   * equivalent: the borrowed symbol goes into a transient library that has no
   * file behind it, so both it and its library are modified from the moment
   * they appear, and the symbol is the one on the canvas. That is three of the
   * four faces at once — `Schematic *` bold, `R *` bold, and `R` MARKED as the
   * canvas item.
   *
   * Marked, not struck through. `LIB_TREE_RENDERER::SetAttr` reads the
   * strikethrough attribute as a flag - upstream's own words, "uses
   * strikethrough as a proxy for is-canvas-item" - and then clears it,
   * `realAttr.SetStrikethrough( false )` (common/lib_tree_model_adapter.cpp:95),
   * so no line is ever drawn. `Render` (:100-116) draws a six-point outline
   * round the cell instead. This asserted the line, which is why the porting
   * bug survived a green suite.
   */
  it('shows the asterisk, the bold and the canvas-item outline the adapter answers', async () => {
    const sym = readSymbolLib(parse(LIB)).find((s) => s.libId === 'R')!;
    const { container, unmount } = render(
      <SymbolEditor
        onExitToHome={() => {}}
        schematicSymbol={{ symbol: sym, unit: 1, bodyStyle: 1, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(rotateLive(container)).toBe(true));
    const cell = (name: string): { text: string; style: string; marked: boolean } => {
      const row = rows(container).find((r) => itemText(r).startsWith(name))!;
      const el = row.querySelector('.col-item') as HTMLElement;
      return {
        text: el.textContent ?? '',
        style: el.getAttribute('style') ?? '',
        // `Render`'s outline, which is what the flag actually produces.
        marked: !!row.querySelector('.ze-libtree-canvasitem'),
      };
    };
    const lib = cell('Schematic');
    const item = cell('R');
    unmount();
    expect({
      libText: lib.text,
      libBold: lib.style.includes('font-weight: 700'),
      // The LIBRARY row is marked only while COLLAPSED, and a lone library
      // opens itself, so this one is not.
      libMarked: lib.marked,
      itemText: item.text,
      itemBold: item.style.includes('font-weight: 700'),
      itemMarked: item.marked,
      // The line upstream never draws, on either row.
      anyLineThrough: lib.style.includes('line-through') || item.style.includes('line-through'),
    }).toEqual({
      libText: 'Schematic *',
      libBold: true,
      libMarked: false,
      itemText: 'R *',
      itemBold: true,
      itemMarked: true,
      anyLineThrough: false,
    });
  });
});

describe('a derived symbol', () => {
  /**
   * `aAttr.SetItalic( !node->m_IsRoot )` (`symbol_tree_synchronizing_adapter.cpp:381`),
   * end to end. `m_IsRoot` is `LIB_SYMBOL::IsRoot()`, which the frame has to
   * read off the symbol as it builds the node — the tree cannot know it
   * otherwise, and a node built with `isRoot` left at its `true` default
   * italicises nothing while every rule-level test still passes.
   */
  it('is italicised, and a root symbol is not', async () => {
    const { container, unmount } = await open();
    const style = (name: string): string =>
      (rowNamed(container, name)?.querySelector('.col-item') as HTMLElement | null)?.getAttribute(
        'style',
      ) ?? '';
    const state = {
      derived: style('R_Small').includes('font-style: italic'),
      root: style('R').includes('font-style: italic'),
      library: style('Device').includes('font-style: italic'),
    };
    unmount();
    expect(state).toEqual({ derived: true, root: false, library: false });
  });
});
