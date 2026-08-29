// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Editor's Libraries pane is the SHARED tree widget, and behaves
 * like one.
 *
 * `FOOTPRINT_TREE_PANE` (`pcbnew/footprint_tree_pane.cpp:30-52`) is a `wxPanel`
 * whose entire body is one `LIB_TREE`:
 *
 *     m_tree = new LIB_TREE( this, wxT( "footprints" ),
 *                            m_frame->GetLibTreeAdapter(), LIB_TREE::SEARCH );
 *     boxSizer->Add( m_tree, 1, wxEXPAND, 5 );
 *
 * — the same `common/widgets/lib_tree.cpp` the symbol editor, the symbol
 * chooser and CvPcb mount, with a different ADAPTER and nothing else different.
 * Ours had a third tree: a `treeRows` memo and about a hundred lines of JSX
 * inside `FootprintEditor.tsx`.
 *
 * ---------------------------------------------------------------------------
 * WHY EACH BEHAVIOUR IS ITS OWN TEST
 * ---------------------------------------------------------------------------
 *
 * "A tree appears" passes against either implementation and is worthless here.
 * Each `it` below names one thing the private tree did NOT do — the column
 * header, the search entry's own icons, the sort/expand menu, the Description
 * column — or one thing it DID do that had to survive the swap: single click
 * selects, double click loads, the twisty expands, filtering, the right-click
 * menu, and the empty state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { FootprintEditor } from '@ziroeda/designer/src/editors/footprint/FootprintEditor.js';
import { mergeFpEdit, settings, SETTINGS_SLICES } from '@ziroeda/designer/src/prefs/settings.js';

afterEach(cleanup);

const mod = (name: string, descr: string, tags: string): string =>
  `(footprint "${name}" (version 20240108) (generator "qa") (layer "F.Cu")
     (descr "${descr}") (tags "${tags}")
     (fp_text reference "REF**" (at 0 1) (layer "F.SilkS")
       (effects (font (size 1 1) (thickness 0.15))))
     (fp_text value "${name}" (at 0 -1) (layer "F.Fab")
       (effects (font (size 1 1) (thickness 0.15))))
   )`;

/**
 * Two registered libraries, so neither opens by itself: `showResults`' last
 * fallback expands a LONE library (`UpdateSearchString`), and a single-library
 * project hides every expand/collapse question behind it.
 */
const PROJECT = [
  {
    name: 'fp-lib-table',
    text: `(fp_lib_table (version 7)
  (lib (name "Resistor_SMD")(type "KiCad")(uri "\${KIPRJMOD}/Resistor_SMD.pretty")(options "")(descr ""))
  (lib (name "Capacitor_SMD")(type "KiCad")(uri "\${KIPRJMOD}/Capacitor_SMD.pretty")(options "")(descr ""))
)`,
  },
  { name: 'Resistor_SMD.pretty/R_0805.kicad_mod', text: mod('R_0805', 'Resistor SMD 0805', 'r') },
  { name: 'Resistor_SMD.pretty/R_0603.kicad_mod', text: mod('R_0603', '', 'r') },
  { name: 'Capacitor_SMD.pretty/C_0805.kicad_mod', text: mod('C_0805', 'Capacitor SMD 0805', 'c') },
];

const rows = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll('.ze-libtree-row')) as HTMLElement[];
const itemText = (row: HTMLElement): string =>
  row.querySelector('.col-item')?.textContent?.trim() ?? '';
const rowNamed = (root: HTMLElement, name: string): HTMLElement | undefined =>
  rows(root).find((r) => itemText(r) === name);
const twistyOf = (row: HTMLElement): Element => row.querySelector('.twisty')!;

/**
 * "A footprint is on the canvas", read off the placeholder the frame draws over
 * an empty canvas: `{!workFp && …}` in `FootprintEditor.tsx`, which is the one
 * DOM fact that says `m_footprint` is set without going through the canvas.
 */
const loaded = (root: HTMLElement): boolean =>
  !root.textContent?.includes('Double-click a footprint in the library tree');

/**
 * `Path2D` and `DOMMatrix`, which happy-dom does not implement and
 * `renderBoard.ts`'s `DOM_PATH_FACTORY` constructs for every board item. The
 * canvas is not what this file is about — the tree beside it is — so they
 * record nothing.
 */
class FakePath2D {
  addPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  arcTo(): void {}
  rect(): void {}
  roundRect(): void {}
}
class FakeDOMMatrix {
  translate(): FakeDOMMatrix {
    return this;
  }
  rotate(): FakeDOMMatrix {
    return this;
  }
  transformPoint(p: unknown): unknown {
    return p;
  }
}

beforeEach(() => {
  // `fpedit.json` is a singleton here, and this frame now WRITES to it — the
  // libraries it left open, its column widths and its dock width. Without this
  // each test would open on the last one's state.
  settings.updateFpEdit((s) => {
    s.window.lib_width = 250;
    s.lib_tree = { columns: [], column_widths: {}, open_libs: [] };
  });
  vi.stubGlobal('Path2D', FakePath2D);
  vi.stubGlobal('DOMMatrix', FakeDOMMatrix);
  // The global footprint index; 404 keeps the tree to the project's two.
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' })),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** Mount on the project and wait for the tree to have rows. */
const open = async (): Promise<HTMLElement> => {
  const { container } = render(
    <FootprintEditor onExitToHome={() => {}} initialProject={PROJECT} />,
  );
  await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
  return container;
};

describe('the pane is LIB_TREE, not a tree of its own', () => {
  /**
   * The structural claim, both ways round. `.ze-libtree` is the shared
   * widget's root and `.ze-tree-item` was the private rows' class — asserting
   * only the first would pass with both trees mounted side by side.
   */
  it('mounts the shared widget and no private rows', async () => {
    const container = await open();
    expect({
      shared: container.querySelectorAll('.ze-libtree').length,
      private: container.querySelectorAll('.ze-tree-item').length,
    }).toEqual({ shared: 1, private: 0 });
  });

  /**
   * `wxDataViewCtrl` column headers, which the private pane had none of. The
   * columns are `m_shownColumns`, and for a footprint tree that is the base
   * adapter's two — `FP_TREE_MODEL_ADAPTER` adds neither Value nor Footprint,
   * so this header is SHORTER than the symbol editor's three.
   */
  it('has the column header row: Item and Description, and no more', async () => {
    const container = await open();
    const header = container.querySelector('.ze-libtree-cols');
    expect(Array.from(header?.children ?? []).map((c) => c.textContent)).toEqual([
      'Item',
      'Description',
    ]);
  });

  /**
   * `m_query_ctrl = new wxSearchCtrl(...)` with `ShowCancelButton( true )`
   * (`lib_tree.cpp:79-81`), which on GTK3 draws `edit-find-symbolic` in its
   * primary icon slot, plus the sort/expand menu `LIB_TREE` hangs beside it
   * (`:86-105`). The private pane was a bare `<input className="ze-search">`
   * with no icon in it and no button beside it.
   */
  it('has the search entry with its icon and the sort/expand menu button', async () => {
    const container = await open();
    expect({
      icons: container.querySelectorAll('.ze-libtree-search svg').length > 0,
      menu: container.querySelectorAll('.ze-libtree-sortbtn').length,
    }).toEqual({ icons: true, menu: 1 });
  });

  /**
   * The private tree drew `toolbarIconUrl('library')` on every library row.
   * `LIB_TREE_RENDERER` draws text and the dataview's own expander, and nothing
   * else — there is no bitmap column in this control at all.
   */
  it('draws no library glyph, because LIB_TREE_RENDERER draws text', async () => {
    const container = await open();
    expect(container.querySelectorAll('.ze-libtree-row img').length).toBe(0);
  });
});

describe('what the private tree did, and still happens', () => {
  /**
   * `EVT_LIBITEM_SELECTED` reaching `GetTargetFPID`. The observable end of it is
   * File > Footprint Properties…, whose condition is
   * `ENABLE( footprintSelectedInTreeCond || haveFootprintCond )`
   * (`footprint_edit_frame.cpp:1431`) — the only branch a cold frame with a
   * tree selection can satisfy.
   */
  it('a single click selects the row without loading it', async () => {
    const container = await open();
    const propsEnabled = (): boolean => {
      const file = Array.from(container.querySelectorAll('.ze-menu')).find((m) =>
        m.textContent?.startsWith('File'),
      )!;
      fireEvent.click(file);
      const item = Array.from(container.querySelectorAll('.ze-mitem')).find((i) =>
        i.textContent?.includes('Footprint Properties'),
      )!;
      const enabled = !item.classList.contains('disabled');
      fireEvent.click(file); // close it again
      return enabled;
    };
    const before = propsEnabled();
    fireEvent.click(rowNamed(container, 'Resistor_SMD')!);
    fireEvent.click(twistyOf(rowNamed(container, 'Resistor_SMD')!));
    fireEvent.click(rowNamed(container, 'R_0805')!);
    expect({ before, after: propsEnabled(), loaded: loaded(container) }).toEqual({
      before: false,
      after: true,
      // Selecting a row is not opening it.
      loaded: false,
    });
  });

  /**
   * `FOOTPRINT_TREE_PANE::onComponentSelected`, bound to `EVT_LIBITEM_CHOSEN`
   * (`footprint_tree_pane.cpp:48, 86-93`) — the double-click that actually
   * loads.
   */
  it('a double click loads the footprint', async () => {
    const container = await open();
    fireEvent.click(twistyOf(rowNamed(container, 'Resistor_SMD')!));
    expect(loaded(container)).toBe(false);
    fireEvent.doubleClick(rowNamed(container, 'R_0805')!);
    await waitFor(() => expect(loaded(container)).toBe(true));
  });

  /**
   * The second half of `onComponentSelected`:
   *
   *     m_frame->LoadFootprintFromLibrary( GetLibTree()->GetSelectedLibId() );
   *     // Make sure current-part highlighting doesn't get lost in seleciton highlighting
   *     m_tree->Unselect();
   *
   * The current part is drawn STRUCK THROUGH by the adapter, and a selected row
   * would paint the highlight band over it. The symbol editor does the
   * opposite — it calls `SelectLibId` after a load — so this is the one place
   * the two panes disagree, and a shared widget has to be able to do both.
   */
  it('and then unselects the tree, leaving the row struck through instead', async () => {
    const container = await open();
    fireEvent.click(twistyOf(rowNamed(container, 'Resistor_SMD')!));
    // The click that SELECTS it, first. `fireEvent.doubleClick` does not fire a
    // preceding click, so without this the row was never selected and
    // "unselected afterwards" was a claim about nothing — a mutation sweep
    // found it by deleting the Unselect and watching this pass anyway.
    fireEvent.click(rowNamed(container, 'R_0805')!);
    expect(rowNamed(container, 'R_0805')!.classList.contains('active')).toBe(true);
    fireEvent.doubleClick(rowNamed(container, 'R_0805')!);
    await waitFor(() => expect(loaded(container)).toBe(true));
    const row = rowNamed(container, 'R_0805')!;
    expect({
      selected: rows(container).some((r) => r.classList.contains('active')),
      struck: (row.querySelector('.col-item') as HTMLElement).style.textDecoration,
    }).toEqual({ selected: false, struck: 'line-through' });
  });

  /**
   * Expanding a library. `LIB_TREE` owns the expansion state now, so the frame
   * only hears about it through `onToggleLibrary` — which is where the lazy
   * `ensureLoaded` that the private tree's `toggleLib` did had to move.
   */
  it('the twisty expands and collapses the library', async () => {
    const container = await open();
    const collapsed = rows(container).length;
    fireEvent.click(twistyOf(rowNamed(container, 'Resistor_SMD')!));
    const expanded = rows(container).length;
    fireEvent.click(twistyOf(rowNamed(container, 'Resistor_SMD')!));
    // Two library rows on their own, plus Resistor_SMD's two footprints.
    expect({ collapsed, expanded, again: rows(container).length }).toEqual({
      collapsed: 2,
      expanded: 4,
      again: 2,
    });
  });

  /**
   * Filtering. The private pane ran a `String.includes` over the names and
   * capped each library at 200 rows; this is `LIB_TREE_MODEL_ADAPTER::UpdateSearchString`
   * scoring every node and `GetChildren` handing the control only the survivors
   * — which is also why the matching library expands itself.
   */
  it('the filter box prunes the tree to what matches', async () => {
    const container = await open();
    const box = container.querySelector('.ze-libtree-search input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'C_0805' } });
    await waitFor(() => expect(rows(container).map(itemText)).toEqual(['Capacitor_SMD', 'C_0805']));
    fireEvent.change(box, { target: { value: '' } });
    // Clearing brings the pruned library back. The one the search expanded
    // STAYS open — `showResults` expands a match's ancestors and nothing
    // collapses them again — so this is not just the opening state.
    await waitFor(() =>
      expect(rows(container).map(itemText)).toEqual(['Capacitor_SMD', 'C_0805', 'Resistor_SMD']),
    );
  });

  /**
   * `m_adapter->GetContextMenuTool()` returning `FOOTPRINT_EDITOR_CONTROL`
   * (`fp_tree_synchronizing_adapter.cpp:62-65`), which is the branch
   * `LIB_TREE::onItemContextMenu` takes when the adapter names a tool
   * (`lib_tree.cpp:1056-1066`). The frame's fifteen-row menu is what opens —
   * NOT the Pin/Unpin pair in upstream's `else`, which is the chooser's menu
   * and was all the shared widget could draw before this.
   */
  it('a right-click opens the frame’s tree menu, not LIB_TREE’s pin fallback', async () => {
    const container = await open();
    fireEvent.click(twistyOf(rowNamed(container, 'Resistor_SMD')!));
    fireEvent.contextMenu(rowNamed(container, 'R_0805')!);
    const labels = Array.from(container.querySelectorAll('.ze-context .ze-mitem')).map(
      (i) => i.textContent ?? '',
    );
    expect(labels).toContain('Delete Footprint from Library');
    expect(labels).toContain('Hide Library Tree');
    // The row was selected before the menu opened ("Select the item under the
    // cursor before showing the context menu", `lib_tree.cpp:1041-1053`), which
    // is what makes the fp-only rows present at all.
    expect(labels).toContain('Rename Footprint...');
    // And the widget's own fallback did not also open.
    expect(container.querySelectorAll('.ze-libtree-menu.ctx').length).toBe(0);
  });

  /**
   * Pin Library, all the way through: `LIBRARY_EDITOR_CONTROL::changeSelectedPinStatus`
   * writes it, `LIB_TREE_MODEL_ADAPTER::GetValue` prefixes `GetPinningSymbol()`
   * and `LIB_TREE_NODE::Compare` sorts pinned libraries above the rest.
   *
   * The private tree drew neither the mark nor that order, so this is new — and
   * it is the one thing the frame has to tell the tree about outside a load:
   * pinning changes no library's NAME and no footprint's, so the adapter's Sync
   * signature has to carry the pin state or the star never appears.
   */
  const pin = (root: HTMLElement, library: string): void => {
    fireEvent.contextMenu(rowNamed(root, library)!);
    fireEvent.click(
      Array.from(root.querySelectorAll('.ze-context .ze-mitem')).find(
        (i) => i.textContent === 'Pin Library',
      )!,
    );
  };

  /**
   * The MARK, on a library that is already first.
   *
   * Pinning changes no library's name and no footprint's, so the only thing
   * that can tell the adapter to rebuild is the pin state itself. Pinning
   * `Resistor_SMD` would also reorder the two rows, and the reordering alone
   * moves the Sync signature — which is why that case cannot pin this: a
   * signature that ignored the pin flag entirely still passed it.
   */
  it('Pin Library marks the row, even when the order does not change', async () => {
    const container = await open();
    expect(rows(container).map(itemText)).toEqual(['Capacitor_SMD', 'Resistor_SMD']);
    pin(container, 'Capacitor_SMD');
    await waitFor(() =>
      expect(rows(container).map(itemText)).toEqual(['☆ Capacitor_SMD', 'Resistor_SMD']),
    );
  });

  /** And `LIB_TREE_NODE::Compare` — "Pinned nodes go next", above every
   *  unpinned library whatever its name. */
  it('and floats the pinned library above the rest', async () => {
    const container = await open();
    pin(container, 'Resistor_SMD');
    await waitFor(() =>
      expect(rows(container).map(itemText)).toEqual(['☆ Resistor_SMD', 'Capacitor_SMD']),
    );
  });

  /**
   * The Description column, which the private tree did not have at all — a
   * footprint's `(descr …)` was nowhere in that pane. A footprint with one has
   * it in cell 2 and one without has an empty cell.
   */
  it('shows a footprint description in the Description column', async () => {
    const container = await open();
    fireEvent.click(twistyOf(rowNamed(container, 'Resistor_SMD')!));
    const cell = (name: string): string =>
      rowNamed(container, name)?.querySelectorAll('.col-desc')[0]?.textContent ?? '';
    expect({ withDescr: cell('R_0805'), without: cell('R_0603') }).toEqual({
      withDescr: 'Resistor SMD 0805',
      without: '',
    });
  });

  /**
   * The empty state. `LIB_TREE` has none — by the time it is shown upstream
   * every library is resident — so the pane keeps the `LibraryLoadingPanel`
   * the private tree showed, on the frame's own "no libraries" condition.
   */
  it('shows the loading panel while the frame has no libraries', () => {
    const { container } = render(<FootprintEditor onExitToHome={() => {}} initialProject={[]} />);
    expect({
      // `LibraryLoadingPanel`'s fallback, shown when no fetch is in flight.
      panel: container.textContent?.includes('No footprint libraries loaded.'),
      // And the tree is still the shared widget underneath it, saying what
      // upstream says about an empty tree — nothing but its own empty row.
      tree: container.querySelectorAll('.ze-libtree').length,
      rows: container.querySelectorAll('.ze-libtree-row').length,
    }).toEqual({ panel: true, tree: 1, rows: 0 });
  });
});

describe('the row faces reach the DOM', () => {
  /**
   * `fp_tree_adapter.test.ts` pins what the adapter ANSWERS; this pins that
   * `LIB_TREE` asks it. Both halves are needed: the widget used to compute the
   * name and the face itself, so an adapter with the right rules would have
   * changed nothing on screen.
   *
   * A newly created footprint is modified from the moment it exists, and it is
   * the one on the canvas, so this is three faces at once — the item's " *",
   * its bold, and its strikethrough as "is canvas item".
   */
  it('shows the asterisk, the bold and the strikethrough the adapter answers', async () => {
    const container = await open();
    fireEvent.click(rowNamed(container, 'Resistor_SMD')!);
    // File > New Footprint…, which creates it in the selected library.
    const file = Array.from(container.querySelectorAll('.ze-menu')).find((m) =>
      m.textContent?.startsWith('File'),
    )!;
    fireEvent.click(file);
    const newFp = Array.from(container.querySelectorAll('.ze-mitem')).find((i) =>
      i.textContent?.startsWith('New Footprint'),
    )!;
    fireEvent.click(newFp);
    const input = document.querySelector('.ze-modal input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'NEW_FP' } });
    fireEvent.click(
      Array.from(document.querySelectorAll('.ze-modal button')).find(
        (b) => b.textContent === 'Create',
      )!,
    );
    await waitFor(() => expect(rowNamed(container, 'NEW_FP *')).toBeDefined());
    const cell = rowNamed(container, 'NEW_FP *')!.querySelector('.col-item') as HTMLElement;
    expect({
      bold: cell.style.fontWeight,
      struck: cell.style.textDecoration,
    }).toEqual({ bold: '700', struck: 'line-through' });
  });
});

// ---------------------------------------------------------------------------
// The dock's width, which is a setting upstream and was not one here
// ---------------------------------------------------------------------------

describe('the Footprints pane remembers how wide it was', () => {
  const dock = (root: HTMLElement): HTMLElement =>
    root.querySelector('.ze-leftdock') as HTMLElement;

  /**
   * `PARAM<int>( "window.lib_width", &m_LibWidth, 250 )`
   * (`pcbnew/footprint_editor_settings.cpp:69-70`), which is the same 250 the
   * pane's `.MinSize( FromDIP( 250 ), FromDIP( 80 ) ).BestSize( FromDIP( 250 ), -1 )`
   * declares (`footprint_edit_frame.cpp:228-232`).
   */
  it('opens at the default when nothing is stored', async () => {
    const container = await open();
    expect(dock(container).style.width).toBe('250px');
  });

  /**
   * `if( libWidth > 0 ) SetAuiPaneSize( m_auimgr, treePane, libWidth, -1 )`
   * (`footprint_edit_frame.cpp:279-280`). We never read a stored width at all,
   * so every session opened at the default however the user had left it.
   */
  it('opens at the stored width when there is one', async () => {
    settings.updateFpEdit((s) => {
      s.window.lib_width = 331;
    });
    const container = await open();
    expect(dock(container).style.width).toBe('331px');
  });

  /**
   * `cfg->m_LibWidth = m_treePane->GetSize().x` (`:837`) — the write half. The
   * sash has stopped moving, so the width it left behind is what the next
   * session opens at.
   */
  it('writes the width back when the sash is let go', async () => {
    const container = await open();
    const splitter = container.querySelector('.ze-splitter') as HTMLElement;
    fireEvent.mouseDown(splitter, { clientX: 250 });
    fireEvent.mouseMove(document, { clientX: 310 });
    // Still un-persisted mid-drag: upstream writes the file once, not per frame.
    expect(settings.fpEdit.window.lib_width).toBe(250);
    fireEvent.mouseUp(document);
    expect({
      onScreen: dock(container).style.width,
      stored: settings.fpEdit.window.lib_width,
    }).toEqual({ onScreen: '310px', stored: 310 });
  });

  /**
   * `FOOTPRINT_EDIT_FRAME::ToggleLibraryTree` (`:402-419`): hiding the pane
   * writes its width out FIRST, because once it is hidden `GetSize().x` is no
   * longer the width to come back to.
   */
  it('and writes it back when the pane is hidden', async () => {
    const container = await open();
    const splitter = container.querySelector('.ze-splitter') as HTMLElement;
    fireEvent.mouseDown(splitter, { clientX: 250 });
    fireEvent.mouseMove(document, { clientX: 290 });
    fireEvent.mouseUp(document);
    settings.updateFpEdit((s) => {
      s.window.lib_width = 250; // scrub the drag's own write
    });
    const hide = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Show footprint tree',
    )!;
    fireEvent.click(hide);
    expect({
      gone: container.querySelectorAll('.ze-leftdock').length,
      stored: settings.fpEdit.window.lib_width,
    }).toEqual({ gone: 0, stored: 290 });
  });

  /**
   * `fpedit.json` is a settings FILE upstream — `PCB_VIEWERS_SETTINGS_BASE( "fpedit", … )`
   * (`footprint_editor_settings.cpp:46`) — and the slice list is what the
   * account sync works in. A slice that is not named here is written to
   * localStorage and never leaves the browser.
   */
  it('and the file it lives in is one of the synced slices', () => {
    expect([...SETTINGS_SLICES]).toContain('fpedit');
  });

  /**
   * `loadColumnConfig`, the read half (`common/lib_tree_model_adapter.cpp:184-197`),
   * end to end: a width in the settings file is the width the header opens at.
   *
   * Without this the write half could pass on its own — the callback fires, the
   * file is written — while nothing ever read it back, which is a value nothing
   * reads.
   */
  it('and opens its columns at the stored widths', async () => {
    settings.updateFpEdit((s) => {
      s.lib_tree.column_widths = { Item: 412 };
    });
    const container = await open();
    const head = container.querySelectorAll('.ze-libtree-cols > span');
    expect((head[0] as HTMLElement).style.width).toBe('412px');
    // The column it does not name keeps the adapter's own default.
    expect((head[1] as HTMLElement).style.width).toBe('600px');
  });

  /**
   * `m_cfg.open_libs = GetOpenLibs()` (`common/lib_tree_model_adapter.cpp:246`)
   * and `OpenLibs( … )` on the way back in (`:220-232`), both halves.
   *
   * `LIB_TREE` owns the expansion state now, so the frame cannot walk the
   * control the way `GetOpenLibs` does — it hears every change through
   * `onToggleLibrary` and keeps the set for the settings file alone. Which
   * means the write half is easy to have and the READ half easy to forget, and
   * a stored list nothing re-opens is a value nothing reads.
   */
  it('and re-opens the libraries that were open last time', async () => {
    const first = await open();
    fireEvent.click(twistyOf(rowNamed(first, 'Resistor_SMD')!));
    expect(settings.fpEdit.lib_tree.open_libs).toEqual(['Resistor_SMD']);
    cleanup();

    // A second session, same settings file.
    const second = await open();
    expect(rows(second).map(itemText)).toEqual([
      'Capacitor_SMD',
      'Resistor_SMD',
      'R_0603',
      'R_0805',
    ]);
  });

  /**
   * `lib_tree.column_widths` is a free-form `{ column: px }` object upstream —
   * a `PARAM_LAMBDA<nlohmann::json>` that reads the stored object back a key at
   * a time (`common/settings/app_settings.cpp:142-168`).
   *
   * `deepMerge` keeps only keys the DEFAULTS already have, and the default here
   * is `{}`, so a plain `load()` would write every width and silently discard
   * it on reload. That is the `colors.user` bug, twice repeated, which is why
   * this slice goes through `mergeFpEdit`.
   */
  it('and a stored column width survives the round trip', () => {
    const stored = mergeFpEdit({
      window: { lib_width: 300 },
      lib_tree: { column_widths: { Item: 412, Description: 480 } },
    });
    expect(stored.lib_tree.column_widths).toEqual({ Item: 412, Description: 480 });
    expect(stored.window.lib_width).toBe(300);
    // The file is hand-editable, so a non-number is dropped rather than stored.
    expect(
      mergeFpEdit({ lib_tree: { column_widths: { Item: 'wide' } } }).lib_tree.column_widths,
    ).toEqual({});
  });
});
