// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @vitest-environment happy-dom
 *
 * A popover closes on a click outside it, and NOT on one inside.
 *
 * The second half is the one that broke, and it broke for a reason no amount of
 * reading the handler would reveal. A control inside a popover may commit on
 * `mousedown` and unmount something in the same event — `ui/Combo` selects an
 * option and closes its own list exactly that way. React runs that handler
 * while the event is still bubbling, so a listener on the *document* is handed
 * a node that has already been detached, and `contains` on a detached node is
 * `false`. The popover decides the click was outside itself and closes.
 *
 * Choosing a role in the share panel shut the whole panel. The fix is the
 * capture phase, and this is the test that tells the two apart: the inner
 * control here removes itself on mousedown, which is the only thing about it
 * that matters.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState, type JSX } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { useDismissOnOutside } from '@ziroeda/designer/src/ui/useDismissOnOutside.js';

function Harness({ dismiss }: { dismiss: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // Stands in for a Combo's option list: present until something inside it is
  // pressed, then gone — during the same event.
  const [listOpen, setListOpen] = useState(true);
  void listOpen;
  useDismissOnOutside(ref, dismiss);
  return (
    <div>
      <div ref={ref} data-testid="pop">
        <span data-testid="plain">plain child</span>
        <div
          data-testid="option"
          onMouseDown={(e) => {
            // Detached HERE, synchronously, rather than by asking React to
            // unmount it. That is deliberate: outside `act()` React defers the
            // flush, so the node is still attached by the time the event
            // reaches the document and a bubble-phase listener passes the test
            // for the wrong reason. What breaks the real thing is a node that
            // is gone before `contains` is asked, and this is that, without
            // depending on the scheduler to produce it.
            e.currentTarget.remove();
            setListOpen(false);
          }}
        >
          an option
        </div>
      </div>
      <button type="button" data-testid="outside">
        elsewhere
      </button>
    </div>
  );
}

// This package does not auto-clean between tests, so a second render would
// otherwise find two of everything.
afterEach(cleanup);

const mousedown = (el: Element): void => {
  el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
};

describe('dismissing a popover', () => {
  it('does not dismiss when the pressed control unmounts itself', () => {
    const dismiss = vi.fn();
    render(<Harness dismiss={dismiss} />);
    mousedown(screen.getByTestId('option'));
    // The bug: by bubble time this node is detached, `contains` says false, and
    // the popover closes on a click that was inside it.
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('does not dismiss on an ordinary click inside', () => {
    const dismiss = vi.fn();
    render(<Harness dismiss={dismiss} />);
    mousedown(screen.getByTestId('plain'));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('dismisses on a click outside', () => {
    const dismiss = vi.fn();
    render(<Harness dismiss={dismiss} />);
    mousedown(screen.getByTestId('outside'));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape', () => {
    const dismiss = vi.fn();
    render(<Harness dismiss={dismiss} />);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
