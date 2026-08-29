// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The shared LIB_TREE's chrome, and the Symbol Editor dock that mounts it.
 *
 * `common/widgets/lib_tree.cpp` is ONE widget with three consumers — the Symbol
 * Editor's `SYMBOL_TREE_PANE`, the symbol chooser's `PANEL_SYMBOL_CHOOSER` and
 * CvPcb — so every value below belongs to the widget and none of them belongs
 * to a call site. That is also the failure this file is here to catch: a
 * launcher-local rule at (0,2,0) silently beats the shared one at (0,1,0), and
 * the tree then looks right in the chooser and wrong in the dock.
 *
 * Three kinds of assertion, failing for different reasons on purpose:
 *
 *  - RENDERED, through the Symbol Editor. It is the consumer qa can actually
 *    mount (the chooser's preview is WebGL), so the structural claims — the
 *    header row exists, the entry owns its icons, a row draws a twisty and text
 *    and nothing else — are made against a real dock.
 *  - RENDERED, through the bare widget, which is what the other two consumers
 *    mount. Same claims, so "right in one, wrong in another" needs two edits to
 *    hide rather than one.
 *  - DECLARED, against shell.css's text, for the values a browser would have to
 *    paint for us to read them back. Every one of those was measured by
 *    `qa/probes/libtree_selection_probe.cpp`, which builds the control LIB_TREE
 *    builds — a wxDataViewCtrl over LIB_TREE_RENDERER with
 *    `SetRowHeight( FromDIP( 6 ) + GetTextExtent( "pdI" ).y )` — and reads the
 *    mapped window back out of the display server.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { SymbolEditor } from '@ziroeda/designer/src/editors/symbol/SymbolEditor.js';
import { LibTree } from '@ziroeda/designer/src/widgets/lib_tree.js';
import {
  LibTreeModelAdapter,
  LIB_TREE_DEFAULT_COL_WIDTHS,
  LIB_TREE_INDENT,
} from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { makeItemNode } from '@ziroeda/designer/src/widgets/lib_tree_model.js';

afterEach(cleanup);

const SHELL = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

/** One rule's body, by its exact selector text — per rule, never per file. */
function rule(selector: string): string {
  // Anchored at a line start: `.ze-libtree-row {` is a SUBSTRING of
  // `.ze-libtree-list > .ze-libtree-row {`, and an unanchored search reads the
  // wrong rule's body and then reports the right value as missing.
  const at = SHELL.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule in shell.css for \`${selector}\``);
  const end = SHELL.indexOf('\n}', at);
  return SHELL.slice(at + selector.length + 3, end).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** One declaration of a rule, comments stripped so a var() in prose cannot count. */
function decl(selector: string, prop: string): string | undefined {
  const m = rule(selector).match(new RegExp(`(?:^|;|\\{)\\s*${prop}\\s*:\\s*([^;]+);`));
  return m?.[1]?.trim();
}

/**
 * The same declaration across EVERY rule that carries this selector, not just
 * the first.
 *
 * `decl` reads one rule, so "shell.css does not say this any more" is a claim it
 * cannot make: a second `.ze-libtree-list { row-gap: … }` further down the file
 * restores the property and the first rule still reads clean. A mutation sweep
 * found exactly that.
 */
function declsEverywhere(selector: string, prop: string): string[] {
  const out: string[] = [];
  let at = SHELL.indexOf(`\n${selector} {`);
  while (at >= 0) {
    const end = SHELL.indexOf('\n}', at);
    const body = SHELL.slice(at + selector.length + 3, end).replace(/\/\*[\s\S]*?\*\//g, '');
    const m = body.match(new RegExp(`(?:^|;|\\{)\\s*${prop}\\s*:\\s*([^;]+);`));
    if (m?.[1]) out.push(m[1].trim());
    at = SHELL.indexOf(`\n${selector} {`, end);
  }
  return out;
}

const LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "R" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Description" "Resistor" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "R_0_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
)`;

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

/** Mount the Symbol Editor on that project and wait for the tree to have rows. */
async function openEditor(): Promise<HTMLElement> {
  const { container } = render(<SymbolEditor onExitToHome={() => {}} initialProject={PROJECT} />);
  await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
  return container;
}

/** What the chooser and CvPcb mount: the widget on its own. */
function openWidget(): HTMLElement {
  const adapter = new LibTreeModelAdapter();
  const lib = adapter.addLibrary('Device', '', false);
  makeItemNode(lib, 'Device', 'R');
  adapter.finishLibrary(lib);
  const { container } = render(
    <LibTree adapter={adapter} onSelect={() => {}} onChoose={() => {}} />,
  );
  return container;
}

describe('the filter row is a wxSearchCtrl and a BITMAP_BUTTON, in both consumers', () => {
  /**
   * `LIB_TREE`'s SEARCH block (lib_tree.cpp:74-91): one `wxSearchCtrl` with
   * `ShowCancelButton( true )`, a `wxStaticLine` beside it, and a
   * `BITMAP_BUTTON` carrying `KiBitmapBundle( BITMAPS::config )`. The magnifier
   * is the entry's own primary icon and so sits INSIDE it; the gear is a
   * separate control outside it.
   */
  const assertFilterRow = (root: HTMLElement) => {
    const entry = root.querySelector('.ze-libtree-entry');
    expect(entry).not.toBeNull();
    // Inside the entry, not beside it.
    expect(entry?.querySelector('.ze-entry-icon.left svg')).not.toBeNull();
    expect(root.querySelector('.ze-libtree-sep')).not.toBeNull();
    const gear = root.querySelector('.ze-libtree-sortbtn img') as HTMLImageElement | null;
    expect(gear).not.toBeNull();
    expect(gear?.getAttribute('src')).toMatch(/config/);
    // …and the gear is NOT inside the entry, which is the arrangement that
    // makes the two icons a pair of buttons in a row instead.
    expect(entry?.querySelector('.ze-libtree-sortbtn')).toBeNull();
  };

  it('in the Symbol Editor dock', async () => assertFilterRow(await openEditor()));
  it('in the bare widget the chooser mounts', () => assertFilterRow(openWidget()));
});

describe('the column header is part of the tree, in both consumers', () => {
  /**
   * `recreateColumns` (common/lib_tree_model_adapter.cpp:403-414): "The Item
   * column is always shown", added before any other. The header is drawn inside
   * the wxDataViewCtrl's own frame, so it is a child of `.ze-libtree-tree` and
   * a sibling of the row list.
   */
  const assertHeader = (root: HTMLElement) => {
    const header = root.querySelector('.ze-libtree-tree > .ze-libtree-cols');
    expect(header).not.toBeNull();
    expect(header?.firstElementChild?.textContent).toBe('Item');
  };

  it('in the Symbol Editor dock', async () => assertHeader(await openEditor()));
  it('in the bare widget the chooser mounts', () => assertHeader(openWidget()));
});

describe('a row is a twisty and text, in both consumers', () => {
  /**
   * `LIB_TREE_RENDERER::Render` (common/lib_tree_model_adapter.cpp:100-131)
   * draws the cell background, the is-canvas-item outline and `RenderText`.
   * There is no bitmap in it and no icon column beside it, so a library row is
   * an expander and a name. The Symbol Editor's own tree used to put a blue
   * library glyph on every row.
   */
  const assertNoIcons = (root: HTMLElement) => {
    const row = rows(root)[0];
    expect(row).toBeDefined();
    expect(row?.querySelector('img')).toBeNull();
    expect(row?.querySelector('svg')).toBeNull();
    // The children are the expander and the cells, in that order and no others.
    const kinds = Array.from(row?.children ?? []).map((el) => el.className.split(' ')[0]);
    expect(kinds[0]).toBe('twisty');
    expect(kinds.slice(1).every((k) => k === 'col-item' || k === 'col-desc')).toBe(true);
  };

  it('in the Symbol Editor dock', async () => assertNoIcons(await openEditor()));
  it('in the bare widget the chooser mounts', () => assertNoIcons(openWidget()));
});

describe("the columns take the adapter's own widths", () => {
  /**
   * `LIB_TREE_MODEL_ADAPTER::LIB_TREE_MODEL_ADAPTER` (:157-160) writes both
   * numbers itself, under its own comment "Default column widths. Do not
   * translate these names." They are DATA, mirrored rather than derived, and
   * they are why the Symbol Editor's 250 px dock shows a name column and no
   * description: the Item column alone is wider than the pane.
   */
  it('300 and 600, from the table upstream hardcodes', () => {
    expect(LIB_TREE_DEFAULT_COL_WIDTHS.Item).toBe(300);
    expect(LIB_TREE_DEFAULT_COL_WIDTHS.Description).toBe(600);
  });

  it('and a column the table does not name has no width of its own', () => {
    // `doAddColumn` computes that one from the header's text extent, which
    // needs a font: the adapter answers null and the widget measures.
    expect(new LibTreeModelAdapter().getColumnWidth('Value')).toBeNull();
    expect(new LibTreeModelAdapter().getColumnWidth('Item')).toBe(300);
  });

  const assertColumnWidths = (root: HTMLElement) => {
    const header = root.querySelector('.ze-libtree-cols');
    const spans = Array.from(header?.children ?? []) as HTMLElement[];
    expect(spans[0]?.style.width).toBe('300px');
    expect(spans[1]?.style.width).toBe('600px');
    // A top-level row's Item cell is the column minus what the row spends
    // before it — the 4px lead-in, the 12px expander and the 4px gap on each
    // side of it — so the second column starts under its own header at 300.
    const cell = rows(root)[0]?.querySelector('.col-item') as HTMLElement | undefined;
    expect(cell?.style.width).toBe(`${300 - 4 - 12 - 4 - 4}px`);
  };

  it('in the Symbol Editor dock', async () => assertColumnWidths(await openEditor()));
  it('in the bare widget the chooser mounts', () => assertColumnWidths(openWidget()));

  it('and no column may shrink to fit the pane instead', () => {
    expect(decl('.ze-libtree-cols .col-item', 'flex')).toBe('0 0 auto');
    expect(decl('.ze-libtree-cols .col-desc', 'flex')).toBe('0 0 auto');
    expect(decl('.ze-libtree-row .col-item', 'flex')).toBe('0 0 auto');
    expect(decl('.ze-libtree-row .col-desc', 'flex')).toBe('0 0 auto');
  });

  it('and the header follows the rows sideways, because they are one control', () => {
    // The header clips its columns...
    expect(decl('.ze-libtree-cols', 'overflow')).toBe('hidden');
    // ...and the widget hands it the list's scroll position. Rendered, not
    // declared: a stylesheet cannot express "these two scroll together", and
    // the header staying put while the rows move is the whole bug.
    const root = openWidget();
    const list = root.querySelector('.ze-libtree-list') as HTMLElement;
    const header = root.querySelector('.ze-libtree-cols') as HTMLElement;
    expect(header.scrollLeft).toBe(0);
    list.scrollLeft = 120;
    fireEvent.scroll(list);
    expect(header.scrollLeft).toBe(120);
  });
});

describe('a child row is indented by kDataViewIndent', () => {
  /** `aDataViewCtrl->SetIndent( kDataViewIndent )` with `kDataViewIndent = 20`
   *  (common/lib_tree_model_adapter.cpp:40, 397). Ours indented by 16. */
  it('which is 20, not a round number of our own', () => {
    expect(LIB_TREE_INDENT).toBe(20);
  });

  it('and the widget spends it per level, in the dock', async () => {
    // A lone library is already expanded by `showResults`' last fallback, so
    // row 0 is the library and row 1 one of its symbols.
    const root = await openEditor();
    expect(rows(root).length).toBeGreaterThan(1);
    expect(rows(root)[0]?.style.paddingLeft).toBe('4px');
    expect(rows(root)[1]?.style.paddingLeft).toBe(`${4 + LIB_TREE_INDENT}px`);
  });

  it('and in the bare widget the chooser mounts', () => {
    const root = openWidget();
    expect(rows(root).length).toBeGreaterThan(1);
    expect(rows(root)[0]?.style.paddingLeft).toBe('4px');
    expect(rows(root)[1]?.style.paddingLeft).toBe(`${4 + LIB_TREE_INDENT}px`);
  });
});

describe('a selected row is the band GTK paints, not a pill', () => {
  /**
   * [px] `qa/probes/libtree_selection_probe.cpp`, on the rendered window:
   *
   *   background_area(row) = 26   cell_area(row) = 24, offset by 1
   *   the highlight is 26 px tall, flat #e95420, and spans x=1..416 of a
   *   420 px control — the whole client width inside the 1 px frame
   *   its corners are painted, so there is no radius
   *
   * wxSYS_COLOUR_HIGHLIGHT is #E95420 and wxSYS_COLOUR_HIGHLIGHTTEXT #FFFFFF,
   * which the same probe reports and which `--selection-bg` / `--selection-fg`
   * already hold under those names.
   */
  it('takes the SELECTION tokens, by their own names', () => {
    expect(decl('.ze-libtree-row.active', 'background')).toBe('var(--selection-bg)');
    expect(decl('.ze-libtree-row.active', 'color')).toBe('var(--selection-fg)');
  });

  it('has square corners and reaches both edges', () => {
    expect(declsEverywhere('.ze-libtree-row', 'border-radius')).toEqual([]);
    // The list inset every band by 4px when it had horizontal padding.
    expect(declsEverywhere('.ze-libtree-list', 'padding')).toEqual([]);
    expect(decl('.ze-libtree-list > .ze-libtree-row', 'min-width')).toBe('100%');
  });

  it('and the vertical-separator is inside the band, so no gap splits it', () => {
    // background_area = cell_area + the separator, half at each end. As a
    // `row-gap` it fell BETWEEN two bands instead, leaving a stripe of
    // unhighlighted face through a selection.
    expect(declsEverywhere('.ze-libtree-list', 'row-gap')).toEqual([]);
    expect(decl('.ze-libtree-row', 'padding-top')).toBe(
      'calc(var(--libtree-row-pad) + var(--libtree-row-sep) / 2)',
    );
    expect(decl('.ze-libtree-row', 'padding-bottom')).toBe(
      'calc(var(--libtree-row-pad) + var(--libtree-row-sep) / 2)',
    );
  });

  it('and clicking a row is what puts it in that state, in the dock', async () => {
    const root = await openEditor();
    const row = rows(root)[0] as HTMLElement;
    expect(row.className).not.toContain('active');
    fireEvent.click(row);
    expect(rows(root)[0]?.className).toContain('active');
  });
});

describe('no consumer restates the tree locally', () => {
  /**
   * The trap CLAUDE.md names: a rule scoped to one launcher outranks the shared
   * one, so fixing the widget changes nothing at that call site. Upstream has
   * exactly one thing to say about a mounted LIB_TREE — `treeSizer->Add( m_tree,
   * 1, wxALL | wxEXPAND, 5 )` in the chooser — and nothing at all in the dock.
   */
  it('only the chooser scopes anything, and only its wxALL border', () => {
    const scoped = Array.from(SHELL.matchAll(/^([^{}\n][^{\n]*)\{/gm))
      .map((m) => (m[1] ?? '').trim())
      .filter((sel) => sel.includes('.ze-libtree'))
      .filter((sel) =>
        /\.(ze-leftdock|sch-leftdock|ze-chooser[\w-]*|ze-lib-viewer-pane)\b/.test(sel),
      );

    expect(scoped).toEqual(['.ze-chooser-treepane > .ze-libtree']);
    expect(decl('.ze-chooser-treepane > .ze-libtree', 'margin')).toBe('5px');
  });
});

describe('every column is drag-resizable, in both consumers', () => {
  /**
   * `doAddColumn` (`common/lib_tree_model_adapter.cpp:490-495`):
   *
   *     wxDataViewColumn* col = new wxDataViewColumn( translatedHeader, …,
   *             m_colWidths[aHeader], wxALIGN_NOT,
   *             wxDATAVIEW_CELL_INERT | (int) wxDATAVIEW_COL_RESIZABLE );
   *     col->SetMinWidth( headerMinWidth.x );
   *
   * Every column in this tree carries `wxDATAVIEW_COL_RESIZABLE`, and none of
   * them may go below its own header's extent plus three Ms. Ours had fixed
   * columns and no grip at all, so a 250 px dock showed the Item column and
   * nothing else with no way to trade one against the other.
   */
  const assertGrips = (root: HTMLElement) => {
    const spans = Array.from(root.querySelectorAll('.ze-libtree-cols > span'));
    expect(spans.length).toBeGreaterThan(1);
    // Every column, not just the first: `wxDATAVIEW_COL_RESIZABLE` is passed
    // per column and a grip on the Item column alone would still let the
    // header "be resizable" by a careless test.
    expect(spans.map((c) => c.querySelectorAll('.ze-libtree-colgrip').length)).toEqual(
      spans.map(() => 1),
    );
  };

  it('in the Symbol Editor dock', async () => assertGrips(await openEditor()));
  it('in the bare widget the chooser mounts', () => assertGrips(openWidget()));

  /** Dragging the Item column's edge moves the header AND the rows' cells,
   *  because upstream they are the same column. */
  it('a drag on the grip widens the column and the cells under it', () => {
    const root = openWidget();
    const head = root.querySelectorAll('.ze-libtree-cols > span')[0] as HTMLElement;
    const cell = root.querySelector('.ze-libtree-row .col-item') as HTMLElement;
    const before = { head: head.style.width, cell: cell.style.width };
    fireEvent.mouseDown(head.querySelector('.ze-libtree-colgrip')!, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 360 });
    fireEvent.mouseUp(document);
    expect(before).toEqual({ head: '300px', cell: '276px' });
    expect({
      head: (root.querySelectorAll('.ze-libtree-cols > span')[0] as HTMLElement).style.width,
      cell: (root.querySelector('.ze-libtree-row .col-item') as HTMLElement).style.width,
    }).toEqual({ head: '360px', cell: '336px' });
  });

  /**
   * `SaveSettings`' `m_cfg.column_widths` (`:240-245`), which is what makes a
   * drag outlive the frame. The callback fires on the mouse UP, not on every
   * frame of the drag — upstream writes the file when the frame closes, not
   * while the pointer moves.
   */
  it('and reports the new widths once, when the drag ends', () => {
    const adapter = new LibTreeModelAdapter();
    const lib = adapter.addLibrary('Device', '', false);
    makeItemNode(lib, 'Device', 'R');
    adapter.finishLibrary(lib);
    const seen: Record<string, number>[] = [];
    const { container } = render(
      <LibTree
        adapter={adapter}
        onSelect={() => {}}
        onChoose={() => {}}
        onColumnWidthsChanged={(w) => seen.push(w)}
      />,
    );
    const head = container.querySelectorAll('.ze-libtree-cols > span')[0] as HTMLElement;
    fireEvent.mouseDown(head.querySelector('.ze-libtree-colgrip')!, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 320 });
    fireEvent.mouseMove(document, { clientX: 340 });
    expect(seen).toEqual([]);
    fireEvent.mouseUp(document);
    expect(seen.length).toBe(1);
    // The adapter is where the number lives now, not a module constant —
    // `getColumnWidth` used to read `LIB_TREE_DEFAULT_COL_WIDTHS` directly, so
    // a dragged width had nowhere to go.
    expect(seen[0]?.Item).toBe(340);
    expect(adapter.getColumnWidth('Item')).toBe(340);
    // Untouched columns keep the table's own number.
    expect(seen[0]?.Description).toBe(LIB_TREE_DEFAULT_COL_WIDTHS.Description);
  });

  /**
   * `loadColumnConfig` (`:184-197`), the read half, and `IsValidColumnWidth`
   * guarding it (`:41-49`): "anything outside a width that could legitimately
   * fit on a display is treated as corrupt rather than a resize".
   */
  it('and a stored width is taken back, unless it is corrupt', () => {
    const adapter = new LibTreeModelAdapter();
    adapter.loadColumnConfig({ widths: { Item: 412, Description: 0, Value: 1e9 } });
    expect(adapter.getColumnWidth('Item')).toBe(412);
    expect(adapter.getColumnWidth('Description')).toBe(LIB_TREE_DEFAULT_COL_WIDTHS.Description);
    expect(adapter.getColumnWidth('Value')).toBeNull();
  });
});

describe("the row menu is the adapter's tool's, and Pin/Unpin is the fallback", () => {
  /**
   * `LIB_TREE::onItemContextMenu` (`common/widgets/lib_tree.cpp:1056-1086`):
   *
   *     if( TOOL_INTERACTIVE* tool = m_adapter->GetContextMenuTool() )
   *         … tool->GetToolMenu().ShowContextMenu();
   *     else
   *         … ACTIONS::pinLibrary / unpinLibrary on a library row …
   *
   * `LIB_TREE_MODEL_ADAPTER::GetContextMenuTool` returns `nullptr`
   * (`include/lib_tree_model_adapter.h:362`), so the chooser gets the else
   * branch — which is all our widget could draw before the Footprint Editor
   * needed the other one.
   */
  it('the chooser gets the pin pair, because its adapter names no tool', () => {
    const root = openWidget();
    const libRow = rows(root).find((r) => r.classList.contains('lib'))!;
    fireEvent.contextMenu(libRow);
    const menu = root.querySelector('.ze-libtree-menu.ctx');
    expect(menu?.textContent).toContain('Pin Library');
  });

  it('and a consumer that names one gets its menu instead, on the selected row', () => {
    const adapter = new LibTreeModelAdapter();
    const lib = adapter.addLibrary('Device', '', false);
    makeItemNode(lib, 'Device', 'R');
    adapter.finishLibrary(lib);
    const calls: { name: string; x: number; y: number }[] = [];
    const { container } = render(
      <LibTree
        adapter={adapter}
        onSelect={() => {}}
        onChoose={() => {}}
        onItemContextMenu={(node, x, y) => calls.push({ name: node.name, x, y })}
      />,
    );
    const libRow = rows(container).find((r) => r.classList.contains('lib'))!;
    fireEvent.contextMenu(libRow, { clientX: 11, clientY: 22 });
    expect(calls).toEqual([{ name: 'Device', x: 11, y: 22 }]);
    // "Select the item under the cursor before showing the context menu"
    // (`:1041-1053`) — the frame's menu is evaluated against the selection, so
    // the row must already be selected when the handler runs.
    expect(libRow.classList.contains('active')).toBe(true);
    // And the fallback did not also open.
    expect(container.querySelectorAll('.ze-libtree-menu.ctx').length).toBe(0);
  });
});

describe('LIB_TREE::Unselect', () => {
  /**
   * `lib_tree.cpp:393`, driven as a nonce. `FOOTPRINT_TREE_PANE::onComponentSelected`
   * is the caller (`pcbnew/footprint_tree_pane.cpp:88-93`); the symbol editor
   * never calls it, which is why it has to be a prop the widget only acts on
   * when it changes and not a state it holds.
   */
  it('clears the selection when the nonce moves, and not before', () => {
    const adapter = new LibTreeModelAdapter();
    const lib = adapter.addLibrary('Device', '', false);
    makeItemNode(lib, 'Device', 'R');
    adapter.finishLibrary(lib);
    const tree = (nonce: number): JSX.Element => (
      <LibTree adapter={adapter} onSelect={() => {}} onChoose={() => {}} unselectNonce={nonce} />
    );
    const { container, rerender } = render(tree(0));
    const libRow = rows(container).find((r) => r.classList.contains('lib'))!;
    fireEvent.click(libRow);
    expect(libRow.classList.contains('active')).toBe(true);
    // A re-render that does NOT move the nonce leaves the selection alone.
    rerender(tree(0));
    expect(rows(container).some((r) => r.classList.contains('active'))).toBe(true);
    rerender(tree(1));
    expect(rows(container).some((r) => r.classList.contains('active'))).toBe(false);
  });
});

describe("the Symbol Editor's pane captions carry the close box their pane asks for", () => {
  const caption = (root: HTMLElement, title: string): HTMLElement | undefined =>
    (Array.from(root.querySelectorAll('.ze-panel-header')) as HTMLElement[]).find(
      (h) => h.textContent?.startsWith(title) ?? false,
    );

  /**
   * `defaultPropertiesPaneInfo` and `defaultSchSelectionFilterPaneInfo`
   * (eeschema/eeschema_settings.cpp:99, :120) both say `.CloseButton( true )`.
   * The library tree does not: it is an `EDA_PANE`, whose constructor sets
   * `CloseButton( false )` and whose `Palette()` does not undo it
   * (include/eda_base_frame.h:927-932, 963-968).
   */
  it('Properties and Selection Filter have one; Libraries does not', async () => {
    const root = await openEditor();
    expect(caption(root, 'Properties')?.querySelector('.ze-pane-close')).not.toBeNull();
    expect(caption(root, 'Selection Filter')?.querySelector('.ze-pane-close')).not.toBeNull();
    expect(caption(root, 'Libraries')?.querySelector('.ze-pane-close')).toBeNull();
  });

  it('and the box closes its own pane', async () => {
    const root = await openEditor();
    fireEvent.click(caption(root, 'Properties')?.querySelector('.ze-pane-close') as Element);
    await waitFor(() => expect(caption(root, 'Properties')).toBeUndefined());
    // The other two are untouched — closing Properties is not closing the dock.
    expect(caption(root, 'Libraries')).toBeDefined();

    fireEvent.click(caption(root, 'Selection Filter')?.querySelector('.ze-pane-close') as Element);
    await waitFor(() => expect(caption(root, 'Selection Filter')).toBeUndefined());
    expect(caption(root, 'Libraries')).toBeDefined();
  });
});
