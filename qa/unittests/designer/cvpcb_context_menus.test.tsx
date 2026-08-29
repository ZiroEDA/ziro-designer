// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two right-click menus of Assign Footprints, and the one action on both of
 * them. Counterparts: `CVPCB_MAINFRAME::setupTools` (cvpcb_mainframe.cpp:271-285),
 * `setupEventHandlers` (`:333-344`), `setupUIConditions` (`:288-330`) and
 * `CVPCB_CONTROL::ShowFootprintViewer` (cvpcb_control.cpp:156-214).
 *
 * The window's header claimed both menus were ported while nothing in the file
 * handled a right-click at all, so what a user saw was the browser's own menu.
 * Every list below is pinned WHOLE and in order: a per-row `toContain` is what
 * let a menu that did not exist read as present.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { DialogAssignFootprints } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_assign_footprints.js';
import {
  cvpcbFootprintsContextMenu,
  cvpcbSymbolsContextMenu,
  type CvpcbContextMenuActions,
} from '@ziroeda/designer/src/editors/schematic/cvpcb_context_menus.js';

beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
  // The frame's canvas is the PCB draw panel; it compiles geometry into Path2D
  // on mount, and happy-dom has neither Path2D nor DOMMatrix. The methods are
  // the ones `renderBoard`'s DOM_PATH_FACTORY calls: the geometry itself is not
  // under test here, only that the window mounts and is assembled correctly.
  class StubPath {
    addPath(): void {}
    arc(): void {}
    arcTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
    ellipse(): void {}
    lineTo(): void {}
    moveTo(): void {}
    quadraticCurveTo(): void {}
    rect(): void {}
    roundRect(): void {}
  }
  class StubMatrix {
    translate(): StubMatrix {
      return this;
    }
    rotate(): StubMatrix {
      return this;
    }
    scale(): StubMatrix {
      return this;
    }
    multiply(): StubMatrix {
      return this;
    }
  }
  vi.stubGlobal('Path2D', StubPath);
  vi.stubGlobal('DOMMatrix', StubMatrix);
});
afterEach(() => cleanup());

const noop = (): void => {};
const ACTIONS: CvpcbContextMenuActions = {
  showFootprintViewer: noop,
  cut: noop,
  copy: noop,
  paste: noop,
  deleteAssoc: noop,
};

/** A menu as `label` per row and `---` per separator. */
const rowsOf = (items: ReturnType<typeof cvpcbSymbolsContextMenu>): string[] =>
  items.map((i) => (i.sep ? '---' : (i.label ?? '')));

describe('the menus are setupTools’, row for row', () => {
  it('the symbols pane: viewer, sep, cut/copy/paste, sep, delete assignment', () => {
    expect(rowsOf(cvpcbSymbolsContextMenu(ACTIONS))).toEqual([
      'View Selected Footprint',
      '---',
      'Cut',
      'Copy',
      'Paste',
      '---',
      'Delete Footprint Assignment',
    ]);
  });

  it('the footprint pane: one row, no separator', () => {
    expect(rowsOf(cvpcbFootprintsContextMenu(ACTIONS))).toEqual(['View Selected Footprint']);
  });

  it('carries each action’s own accelerator, and none where the action has none', () => {
    // `MD_CTRL + 'X' / 'C' / 'V'` (common/tool/actions.cpp:308-348) and
    // `WXK_DELETE` (cvpcb_actions.cpp:129-134); showFootprintViewer declares no
    // DefaultHotkey at all (`:45-49`).
    expect(
      cvpcbSymbolsContextMenu(ACTIONS).map((i) => (i.sep ? '---' : (i.shortcut ?? ''))),
    ).toEqual(['', '---', 'Ctrl+X', 'Ctrl+C', 'Ctrl+V', '---', 'Delete']);
  });

  it('has no disabled row: setupUIConditions gives none of these five a condition', () => {
    // The five are showFootprintViewer, cut, copy, paste and deleteAssoc.
    // `:288-330` names saveAssociationsToSchematic, saveAssociationsToFile,
    // undo, redo and the three filter toggles, and nothing else - so an invented
    // `disabled` here is a row KiCad would have let you click.
    for (const item of [
      ...cvpcbSymbolsContextMenu(ACTIONS),
      ...cvpcbFootprintsContextMenu(ACTIONS),
    ])
      expect(item.disabled).toBeUndefined();
  });

  it('every row runs its own action, and no row runs another’s', () => {
    // A menu of five rows all wired to the same handler passes every list check
    // above; this is what says the wiring is right.
    const seen: string[] = [];
    const spy: CvpcbContextMenuActions = {
      showFootprintViewer: () => seen.push('view'),
      cut: () => seen.push('cut'),
      copy: () => seen.push('copy'),
      paste: () => seen.push('paste'),
      deleteAssoc: () => seen.push('delete'),
    };
    for (const item of cvpcbSymbolsContextMenu(spy)) item.action?.();
    expect(seen).toEqual(['view', 'cut', 'copy', 'paste', 'delete']);
    seen.length = 0;
    for (const item of cvpcbFootprintsContextMenu(spy)) item.action?.();
    expect(seen).toEqual(['view']);
  });
});

// ---------------------------------------------------------------------------
// The window: the right button is bound, and to which panes
// ---------------------------------------------------------------------------

const SHEET = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
  (symbol (lib_id "Device:R") (at 50 50 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 0 0 0)) (property "Value" "1k" (at 0 0 0))
    (property "Footprint" "MyFp:R_0402" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 60 50 0) (unit 1) (uuid "r2")
    (property "Reference" "R2" (at 0 0 0)) (property "Value" "2k2" (at 0 0 0))
    (property "Footprint" "MyFp:R_0805" (at 0 0 0)))
  (symbol (lib_id "Device:R") (at 70 50 0) (unit 1) (uuid "r3")
    (property "Reference" "R3" (at 0 0 0)) (property "Value" "4k7" (at 0 0 0))
    (property "Footprint" "MyFp:R_0603" (at 0 0 0))))`;

const TABLE = `(fp_lib_table
  (version 7)
  (lib (name "MyFp")(type "KiCad")(uri "\${KIPRJMOD}/MyFp.pretty")(options "")(descr ""))
)`;

const fp = (name: string): { name: string; text: string } => ({
  name: `Proj/MyFp.pretty/${name}.kicad_mod`,
  text: `(footprint "${name}" (layer "F.Cu")
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu")))`,
});

const PROJECT = [
  { name: 'Proj/Proj.kicad_pro', text: '{"meta":{"filename":"Proj.kicad_pro"}}' },
  { name: 'Proj/fp-lib-table', text: TABLE },
  fp('R_0402'),
  fp('R_0805'),
  fp('R_0603'),
];

function open_(): HTMLElement {
  const docs = new Map([['a.kicad_sch', readSchematic(parse(SHEET))]]);
  const { container } = render(
    <DialogAssignFootprints
      docs={docs}
      projectFootprints={PROJECT}
      onApply={() => {}}
      onClose={() => {}}
    />,
  );
  return container;
}

/** One of the three panes, by its wxAUI caption. */
function pane(root: HTMLElement, caption: string): HTMLElement {
  const found = Array.from(root.querySelectorAll('.ze-fpassign-pane')).find((p) =>
    p.querySelector('.ze-fpassign-caption')?.textContent?.startsWith(caption),
  );
  if (!found) throw new Error(`no ${caption} pane`);
  return found as HTMLElement;
}

const paneRows = (root: HTMLElement, caption: string): Element[] =>
  Array.from(pane(root, caption).querySelectorAll('.ze-fpassign-row'));

/** The open ContextMenu's rows, or null when none is open. */
function openMenuRows(root: HTMLElement): string[] | null {
  const menu = root.ownerDocument.querySelector('.ze-dropdown.ze-context');
  if (!menu) return null;
  return Array.from(menu.children).map((row) =>
    row.classList.contains('ze-msep') ? '---' : (row.querySelector('.lbl')?.textContent ?? ''),
  );
}

function clickMenuRow(root: HTMLElement, label: string): void {
  const menu = root.ownerDocument.querySelector('.ze-dropdown.ze-context');
  if (!menu) throw new Error('no context menu open');
  const row = Array.from(menu.querySelectorAll('.ze-mitem')).find(
    (m) => m.querySelector('.lbl')?.textContent === label,
  );
  if (!row) throw new Error(`no "${label}" row`);
  fireEvent.click(row);
}

const SYMBOLS = 'Symbol : Footprint Assignments';
const FOOTPRINTS = 'Filtered Footprints';
const LIBRARIES = 'Footprint Libraries';

describe('the right button is bound to the two panes setupEventHandlers binds', () => {
  it('the symbols pane opens the seven-row menu', () => {
    const root = open_();
    fireEvent.contextMenu(paneRows(root, SYMBOLS)[0] as Element);
    expect(openMenuRows(root)).toEqual([
      'View Selected Footprint',
      '---',
      'Cut',
      'Copy',
      'Paste',
      '---',
      'Delete Footprint Assignment',
    ]);
  });

  it('the footprint pane opens the one-row menu', () => {
    const root = open_();
    fireEvent.contextMenu(paneRows(root, FOOTPRINTS)[0] as Element);
    expect(openMenuRows(root)).toEqual(['View Selected Footprint']);
  });

  it('the LIBRARY pane opens nothing: the right button is not bound to it', () => {
    // `setupEventHandlers` binds wxEVT_RIGHT_DOWN on m_footprintListBox and
    // m_symbolsListBox only (`:333-344`).
    const root = open_();
    fireEvent.contextMenu(paneRows(root, LIBRARIES)[0] as Element);
    expect(openMenuRows(root)).toBeNull();
  });

  it('does not move the selection: the handler never calls event.Skip()', () => {
    // Right-clicking an unselected row must leave the highlighted row alone,
    // or every command on the menu would act on something else than the one
    // the user chose it for. The window opens with nothing selected (every
    // symbol here is already assigned), which is why the fixture assigns all
    // three - a fixture with an unassigned symbol opens with it selected and
    // could not tell "kept the selection" from "selected the clicked row".
    const root = open_();
    const before = pane(root, SYMBOLS).querySelectorAll('.ze-fpassign-row.selected').length;
    expect(before).toBe(0);
    fireEvent.contextMenu(paneRows(root, SYMBOLS)[2] as Element);
    expect(pane(root, SYMBOLS).querySelectorAll('.ze-fpassign-row.selected').length).toBe(0);
  });
});

describe('View Selected Footprint shows the viewer and never hides it', () => {
  // `ShowFootprintViewer` opens a DISPLAY_FOOTPRINTS_FRAME — a window of its
  // own, which is why this is a testid on the frame and not a class on a pane
  // of the dialog.
  const viewer = (root: HTMLElement): Element | null =>
    root.querySelector('[data-testid="cvpcb-footprint-viewer"]');

  it('from the symbols pane’s menu', () => {
    const root = open_();
    expect(viewer(root)).toBeNull();
    fireEvent.contextMenu(paneRows(root, SYMBOLS)[0] as Element);
    clickMenuRow(root, 'View Selected Footprint');
    expect(viewer(root)).not.toBeNull();
  });

  it('from the footprint pane’s menu', () => {
    const root = open_();
    fireEvent.contextMenu(paneRows(root, FOOTPRINTS)[0] as Element);
    clickMenuRow(root, 'View Selected Footprint');
    expect(viewer(root)).not.toBeNull();
  });

  it('the toolbar button is never disabled, not even with nothing selected', () => {
    // `setupUIConditions` (cvpcb_mainframe.cpp:288-330) gives
    // showFootprintViewer no condition. This button was greyed whenever the
    // footprint pane had no selection - which is the state the window opens in
    // whenever every symbol is already assigned, i.e. this fixture.
    const root = open_();
    const b = Array.from(root.querySelectorAll('.ze-toolbar .ze-tbtn')).find(
      (x) => x.getAttribute('aria-label') === 'View Selected Footprint',
    ) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
  });

  it('a second press raises it rather than closing it', () => {
    // `CVPCB_CONTROL::ShowFootprintViewer` has no branch that closes the frame
    // (cvpcb_control.cpp:156-214): it creates it, or raises it and re-runs
    // InitDisplay. The toolbar button ran `setViewerOpen(v => !v)`, so the
    // second press hid it.
    const root = open_();
    const toolbarButton = Array.from(root.querySelectorAll('.ze-toolbar .ze-tbtn')).find(
      (b) => b.getAttribute('aria-label') === 'View Selected Footprint',
    ) as HTMLButtonElement;
    fireEvent.click(toolbarButton);
    expect(viewer(root)).not.toBeNull();
    fireEvent.click(toolbarButton);
    expect(viewer(root)).not.toBeNull();
  });

  it('and choosing it twice FROM THE MENU leaves it open too', () => {
    // Same rule, the other call site. The toolbar case above cannot cover it:
    // the menu row and the button are two separate handlers, and only one of
    // them was a toggle when this was written.
    const root = open_();
    fireEvent.contextMenu(paneRows(root, SYMBOLS)[0] as Element);
    clickMenuRow(root, 'View Selected Footprint');
    expect(viewer(root)).not.toBeNull();
    fireEvent.contextMenu(paneRows(root, SYMBOLS)[0] as Element);
    clickMenuRow(root, 'View Selected Footprint');
    expect(viewer(root)).not.toBeNull();
  });

  it('and the frame’s own ✕ is what closes it — EVT_CLOSE', () => {
    const root = open_();
    fireEvent.contextMenu(paneRows(root, SYMBOLS)[0] as Element);
    clickMenuRow(root, 'View Selected Footprint');
    fireEvent.click(
      root.querySelector('[data-testid="cvpcb-footprint-viewer"] .ze-modal-header .x') as Element,
    );
    expect(viewer(root)).toBeNull();
  });
});

describe('the menu’s commands act on the current selection', () => {
  it('Delete Footprint Assignment clears the selected symbol’s footprint', () => {
    const root = open_();
    fireEvent.click(paneRows(root, SYMBOLS)[1] as Element);
    expect(paneRows(root, SYMBOLS)[1]?.textContent).toContain('MyFp:R_0805');
    fireEvent.contextMenu(paneRows(root, SYMBOLS)[1] as Element);
    clickMenuRow(root, 'Delete Footprint Assignment');
    expect(paneRows(root, SYMBOLS)[1]?.textContent).not.toContain('MyFp:R_0805');
    // and only that one
    expect(paneRows(root, SYMBOLS)[0]?.textContent).toContain('MyFp:R_0402');
  });

  it('Copy takes the SELECTED symbol\u2019s footprint, not the right-clicked row\u2019s', () => {
    // The handler never calls event.Skip(), so the right button leaves the
    // selection alone and every command reads the row that WAS selected.
    const writes: string[] = [];
    const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          writes.push(t);
        },
      },
    });
    try {
      const root = open_();
      fireEvent.click(paneRows(root, SYMBOLS)[0] as Element);
      fireEvent.contextMenu(paneRows(root, SYMBOLS)[2] as Element);
      clickMenuRow(root, 'Copy');
      expect(writes).toEqual(['MyFp:R_0402']);
    } finally {
      if (previous) Object.defineProperty(globalThis.navigator, 'clipboard', previous);
      else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
    }
  });
});
