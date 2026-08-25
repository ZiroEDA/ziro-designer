// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The shared `Toolbar` widget actually pops the menu, on a right-click and on
 * nothing else.
 *
 * The registry is data and its own test asserts it as data. What that cannot
 * see is the half that matters here: `ACTION_TOOLBAR` binds
 * `wxEVT_AUITOOLBAR_RIGHT_CLICK` and hit-tests right-up itself so the whole of
 * a vertical button works (`common/tool/action_toolbar.cpp:215, 821-848`), and
 * both land in `showContextMenu` (`:851-880`). A left click does NOT — it
 * dispatches the button's own action — and a long press opens the group palette
 * instead, which is a different mechanism on the same button.
 *
 * This renders the Drawing Sheet Editor's REAL left toolbar inventory through
 * the real widget, so the assertion covers the inventory, the registry, the
 * label lookup and the event wiring at once. A source-text check could not tell
 * a handler that is attached from one behind an early return.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toolbar } from '@ziroeda/designer/src/ui/Toolbar.js';
import {
  DS_LEFT_TOOLBAR,
  DS_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import { PCB_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';

// `qa` has no testing-library setup file, so the auto-cleanup that ships with
// one is not running: without this every render stays in the document and the
// second `getByRole` finds two of everything.
afterEach(cleanup);

/** The Show Grid button, by the accessible name every button carries. */
const gridButton = (): HTMLElement => screen.getByRole('button', { name: /grid/i });

function renderLeft(onActivate: (id: string) => void = () => {}) {
  return render(
    <Toolbar
      entries={DS_LEFT_TOOLBAR}
      app="pl_editor"
      orientation="vertical"
      side="left"
      onActivate={onActivate}
    />,
  );
}

describe('right-clicking a registered toolbar button', () => {
  it('opens the menu the frame registered for it', () => {
    renderLeft();
    expect(screen.queryByText('Edit Grids...')).toBeNull();
    fireEvent.contextMenu(gridButton());
    expect(screen.getByText('Edit Grids...')).toBeTruthy();
  });

  it('runs that row`s action through the frame`s dispatcher', () => {
    const ran: string[] = [];
    renderLeft((id) => ran.push(id));
    fireEvent.contextMenu(gridButton());
    fireEvent.click(screen.getByText('Edit Grids...'));
    // `gridProperties`, not `toggleGrid`: the row is its own TOOL_ACTION and
    // upstream dispatches it through the same TOOL_MANAGER the button uses.
    expect(ran).toEqual(['gridProperties']);
  });

  it('does not toggle the button on the way', () => {
    const ran: string[] = [];
    renderLeft((id) => ran.push(id));
    fireEvent.contextMenu(gridButton());
    expect(ran).toEqual([]);
  });
});

describe('the other gestures are unaffected', () => {
  it('a left click still runs the button, and opens no menu', () => {
    const ran: string[] = [];
    renderLeft((id) => ran.push(id));
    fireEvent.click(gridButton());
    expect(ran).toEqual(['toggleGrid']);
    expect(screen.queryByText('Edit Grids...')).toBeNull();
  });

  it('a button with nothing registered pops nothing at all', () => {
    // The right toolbar's tools have no `.WithContextMenu(...)` upstream, so a
    // right-click there has to fall through to the browser's own menu rather
    // than open an empty popup.
    render(
      <Toolbar entries={DS_RIGHT_TOOLBAR} app="pl_editor" orientation="vertical" side="right" />,
    );
    const del = screen.getByRole('button', { name: /delete/i });
    const ev = new (globalThis.window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(
      'contextmenu',
      { bubbles: true, cancelable: true },
    );
    del.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.querySelector('.ze-dropdown')).toBeNull();
  });
});

describe('a group button borrows the menu of the action it is showing', () => {
  it('resolves the group id to the displayed action, as showContextMenu does', () => {
    // "Ensure that the ID maps to a proper tool ID. If right-clicked on a group
    // item, this is needed to get the ID of the currently selected action,
    // since the event's ID is that of the group" (action_toolbar.cpp:853-858).
    // The Units group's actions carry no menu, so nothing pops — and that is
    // the group's *displayed action* being asked, not the group name.
    const ran: string[] = [];
    renderLeft((id) => ran.push(id));
    const units = screen.getByRole('button', { name: /millimetres/i });
    fireEvent.contextMenu(units);
    expect(screen.queryByText('Edit Grids...')).toBeNull();
    expect(ran).toEqual([]);
  });
});

describe('a row for an action the frame has greyed out', () => {
  /**
   * Upstream a toolbar button and a menu row for the same action read ONE
   * ACTION_CONDITIONS, so `Toolbar` hands the menu factory its own
   * `disabledIds` rather than letting the frame state it twice. The PCB frames
   * are where that lands today: their menu's second row is
   * `ACTIONS::gridOrigin` (`pcbnew/toolbars_pcb_editor.cpp:150-161`), which is
   * `COMMON_TOOLS::GridOrigin`'s WX_PT_ENTRY_DIALOG
   * (`common/tool/common_tools.cpp:637-651`) and is not implemented here.
   *
   * Rendered rather than asserted on the factory, because the factory taking a
   * predicate and the widget PASSING one are two different things: a sweep
   * found this exact wiring survived every test that only called the factory.
   */
  const renderPcb = (onActivate: (id: string) => void = () => {}) =>
    render(
      <Toolbar
        entries={PCB_LEFT_TOOLBAR}
        app="pcbnew"
        orientation="vertical"
        side="left"
        disabledIds={new Set(['gridOrigin'])}
        onActivate={onActivate}
      />,
    );

  it('renders greyed, while its neighbour does not', () => {
    renderPcb();
    fireEvent.contextMenu(screen.getByRole('button', { name: /show grid/i }));
    const row = (label: string): Element =>
      [...document.querySelectorAll('.ze-mitem')].find((e) => e.textContent === label)!;
    expect(row('Grid Origin...').className).toContain('disabled');
    expect(row('Edit Grids...').className).not.toContain('disabled');
  });

  it('does not run when it is clicked', () => {
    const ran: string[] = [];
    renderPcb((id) => ran.push(id));
    fireEvent.contextMenu(screen.getByRole('button', { name: /show grid/i }));
    fireEvent.click(screen.getByText('Grid Origin...'));
    expect(ran).toEqual([]);
    // and the row that is NOT greyed still runs, so the menu is live
    fireEvent.click(screen.getByText('Edit Grids...'));
    expect(ran).toEqual(['gridProperties']);
  });
});
