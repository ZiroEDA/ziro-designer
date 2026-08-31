// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The click that dismisses a context menu is the MENU's, not the canvas's.
 *
 * `TOOL_MANAGER::DispatchContextMenu` shows the menu with
 * `frame->PopupMenu( menu.get(), ... )` (tool_manager.cpp:978-980). That is a
 * blocking call: wx runs a nested modal loop with a pointer grab, so from the
 * moment the menu is up every button event belongs to the menu shell. The first
 * click outside dismisses it and goes no further; the canvas never sees it, and
 * the selection the menu was opened on is still there afterwards. Only the NEXT
 * click reaches `PCB_SELECTION_TOOL::Main`, where `selectPoint()` hits nothing
 * and clears the selection (pcb_selection_tool.cpp:326-347).
 *
 * Ours ran both off the same click: right-click a footprint, click on empty
 * board, and the menu closed AND the footprint was deselected in one gesture.
 *
 * The reason it has to be `pointerdown` in the capture phase, and why a
 * source-text check would not have caught this: the canvases are wired with
 * `onPointerDown`, and `pointerdown` fires BEFORE `mousedown`. The dismissal
 * listener was a bubble-phase `mousedown` one — attached, correct-looking, and
 * strictly too late. So this drives the real widget with the real event order.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu } from '@ziroeda/designer/src/ui/MenuBar.js';

afterEach(cleanup);

/** A frame: a canvas wired the way the editors wire theirs, and a menu on it. */
function Frame({ log }: { log: string[] }): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        data-testid="canvas"
        style={{ width: 400, height: 400 }}
        onPointerDown={() => log.push('pointerdown')}
        onMouseDown={() => log.push('mousedown')}
        onClick={() => log.push('click')}
      />
      {open && (
        <ContextMenu
          items={[{ label: 'Move', shortcut: 'M' }, { sep: true }, { label: 'Properties...' }]}
          x={10}
          y={10}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** One full press-release on the canvas, in the browser's own order. */
function clickCanvas(): void {
  const canvas = screen.getByTestId('canvas');
  fireEvent.pointerDown(canvas, { bubbles: true });
  fireEvent.mouseDown(canvas, { bubbles: true });
  fireEvent.pointerUp(canvas, { bubbles: true });
  fireEvent.mouseUp(canvas, { bubbles: true });
  fireEvent.click(canvas, { bubbles: true });
}

describe('clicking the canvas while a context menu is open', () => {
  it('closes the menu', () => {
    render(<Frame log={[]} />);
    expect(screen.getByText('Move')).toBeTruthy();
    clickCanvas();
    expect(screen.queryByText('Move')).toBeNull();
  });

  it('does not let that click reach the canvas at all', () => {
    const log: string[] = [];
    render(<Frame log={log} />);
    clickCanvas();
    // Not one event of the dismissing gesture — the press, the compatibility
    // mouse events, or the click — is the canvas's.
    expect(log).toEqual([]);
  });

  it('gives the canvas the SECOND click, which is the one that deselects', () => {
    const log: string[] = [];
    render(<Frame log={log} />);
    clickCanvas();
    clickCanvas();
    expect(log).toEqual(['pointerdown', 'mousedown', 'click']);
  });

  it('leaves the canvas alone once the menu has been dismissed', () => {
    // The grab is released, not left armed: a third and fourth click must be
    // as ordinary as the second.
    const log: string[] = [];
    render(<Frame log={log} />);
    clickCanvas();
    clickCanvas();
    clickCanvas();
    expect(log.filter((e) => e === 'pointerdown')).toHaveLength(2);
  });

  it('still runs a row that IS clicked, rather than swallowing that too', () => {
    // The grab only covers clicks OUTSIDE the menu; a row is the menu's own.
    const ran: string[] = [];
    render(
      <ContextMenu
        items={[{ label: 'Move', action: () => ran.push('Move') }]}
        x={10}
        y={10}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Move'));
    expect(ran).toEqual(['Move']);
  });
});
