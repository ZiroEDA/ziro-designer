// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `HOTKEY_CYCLE_POPUP` (`common/dialogs/hotkey_cycle_popup.cpp`) and its one
 * wired caller, `SCH_EDITOR_CONTROL::GridFeedback`
 * (`eeschema/tools/sch_editor_control.cpp:3360-3382`).
 *
 * Every timing assertion here drives the clock explicitly and checks BOTH
 * sides of the boundary — a timer test that only advances past the deadline
 * cannot tell 500 ms from 1 ms, and one that never advances at all cannot fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { schIUScale } from '@ziroeda/common';
import {
  HotkeyCyclePopup,
  SHOW_TIME_MS,
} from '@ziroeda/designer/src/widgets/hotkey_cycle_popup.js';
import {
  HotkeyCyclePopupView,
  useHotkeyCyclePopup,
} from '@ziroeda/designer/src/widgets/HotkeyCyclePopup.js';
import {
  gridEntryOf,
  gridFeedback,
  GRID_SIZE_LIST,
  type GridEntry,
} from '@ziroeda/designer/src/ui/grid_settings.js';

afterEach(cleanup);

/**
 * `#define SHOW_TIME_MS 500` (`common/dialogs/hotkey_cycle_popup.cpp:40`),
 * written out here as a literal ON PURPOSE. Driving the clock by the module's
 * own exported constant would make every boundary below self-consistent at any
 * value — advance `SHOW_TIME_MS - 1`, then 1 — and so unable to fail.
 */
const SHOW_TIME_MS_CPP = 500;

/** eeschema's own `DefaultGridSizeList()` row — what N cycles in the schematic. */
const EESCHEMA_GRIDS: GridEntry[] = GRID_SIZE_LIST.eeschema.map(gridEntryOf);

/** A recording `HOTKEY_CYCLE_POPUP` for the caller-side tests. */
function recorder(): {
  calls: { title: string; items: readonly string[]; selection: number }[];
  popup: (title: string, items: readonly string[], selection: number) => void;
} {
  const calls: { title: string; items: readonly string[]; selection: number }[] = [];
  return {
    calls,
    popup: (title, items, selection) => calls.push({ title, items, selection }),
  };
}

describe('HOTKEY_CYCLE_POPUP: the 500 ms timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('`#define SHOW_TIME_MS 500` (hotkey_cycle_popup.cpp:40) is the whole visible life', () => {
    // Derived from the C++, not from the code under test: the popup is up for
    // half a second after the keystroke and gone on the tick after.
    expect(SHOW_TIME_MS).toBe(SHOW_TIME_MS_CPP);
  });

  it('`Show( true )` on the first Popup(), `Show( false )` when the timer expires', () => {
    const focusCanvas = vi.fn();
    const p = new HotkeyCyclePopup({ focusCanvas });

    expect(p.shown).toBe(false);
    p.popup('Grid', ['100 mils', '50 mils'], 1);
    expect(p.shown).toBe(true);

    // One millisecond short of the deadline it is STILL up. Without this the
    // test cannot distinguish 500 from 1.
    act(() => void vi.advanceTimersByTime(SHOW_TIME_MS_CPP - 1));
    expect(p.shown).toBe(true);
    expect(focusCanvas).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    expect(p.shown).toBe(false);
  });

  it('the expiry hands the keyboard back — `m_drawFrame->GetCanvas()->SetFocus()` (`:48`)', () => {
    const focusCanvas = vi.fn();
    const p = new HotkeyCyclePopup({ focusCanvas });

    p.popup('Grid', ['100 mils'], 0);
    expect(focusCanvas).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(SHOW_TIME_MS_CPP));
    expect(focusCanvas).toHaveBeenCalledTimes(1);
    // `Show( false )` runs first, so by the time focus moves the window is gone.
    expect(p.shown).toBe(false);
  });

  it('a second cycle inside the window RESTARTS the timer (`:100-103`)', () => {
    const focusCanvas = vi.fn();
    const p = new HotkeyCyclePopup({ focusCanvas });

    p.popup('Grid', ['100 mils', '50 mils'], 0);
    act(() => void vi.advanceTimersByTime(400));
    expect(p.shown).toBe(true);

    // Still inside the window, so `IsRunning()` is true and Popup() takes the
    // early return: contents replaced, `StartOnce` called again, no `Show`.
    p.popup('Grid', ['100 mils', '50 mils'], 1);
    expect(p.contents?.selection).toBe(1);

    // 500 ms after the FIRST keystroke. Had the running timer been left alone
    // the panel would tear down here, mid-cycle — which is the bug the early
    // return exists to prevent.
    act(() => void vi.advanceTimersByTime(100));
    expect(p.shown).toBe(true);
    expect(focusCanvas).not.toHaveBeenCalled();

    // 500 ms after the SECOND one.
    act(() => void vi.advanceTimersByTime(399));
    expect(p.shown).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(p.shown).toBe(false);
    expect(focusCanvas).toHaveBeenCalledTimes(1);
  });

  it('`SetSelection( std::min( aSelection, GetCount() - 1 ) )` clamps the TOP only (`:80-81`)', () => {
    const p = new HotkeyCyclePopup({ focusCanvas: () => {} });

    p.popup('Grid', ['a', 'b', 'c'], 9);
    expect(p.contents?.selection).toBe(2);

    // No lower clamp upstream: an empty list selects -1, which is
    // wxListBox's "nothing selected".
    act(() => void vi.advanceTimersByTime(SHOW_TIME_MS_CPP));
    p.popup('Grid', [], 0);
    expect(p.contents?.selection).toBe(-1);
  });

  it('`delete m_showTimer` (`:70`) stops it — an unmount must not steal focus', () => {
    const focusCanvas = vi.fn();
    const p = new HotkeyCyclePopup({ focusCanvas });

    p.popup('Grid', ['100 mils'], 0);
    p.destroy();
    act(() => void vi.advanceTimersByTime(SHOW_TIME_MS_CPP * 4));
    expect(focusCanvas).not.toHaveBeenCalled();
  });
});

describe('SCH_EDITOR_CONTROL::GridFeedback', () => {
  const base = {
    hotkeyFeedback: true,
    grids: EESCHEMA_GRIDS,
    lastSizeIdx: 1,
    units: 'mils' as const,
    iuPerMM: schIUScale.IU_PER_MM,
  };

  it('the title is `_( "Grid" )` (`:3379`)', () => {
    const r = recorder();
    gridFeedback(r, base);
    expect(r.calls[0]?.title).toBe('Grid');
  });

  it('the rows are `UserUnitsMessageText` — one unit, no name (`:3371`)', () => {
    const r = recorder();
    gridFeedback(r, base);
    // Akshay photographed exactly this list in the real eeschema.
    expect(r.calls[0]?.items).toEqual(['100 mils', '50 mils', '25 mils', '10 mils']);
  });

  it('the rows follow the frame’s units, and carry no bracketed second unit', () => {
    const r = recorder();
    gridFeedback(r, { ...base, units: 'mm' });
    expect(r.calls[0]?.items).toEqual(['2.54 mm', '1.27 mm', '0.635 mm', '0.254 mm']);
    // `GRID_MENU::BuildChoiceList`'s `"%s%s (%s)"` is the GRID MENU's format.
    // UserUnitsMessageText has neither the name nor the bracket, and a popup
    // built out of the menu's labels would read "2.54 mm (100 mils)".
    for (const row of r.calls[0]?.items ?? []) expect(row).not.toContain('(');
  });

  it('a named grid still shows only its size — `UserUnitsMessageText` has no name', () => {
    const r = recorder();
    gridFeedback(r, { ...base, grids: [{ name: 'Fine', x: '10 mil', y: '10 mil' }] });
    expect(r.calls[0]?.items).toEqual(['10 mils']);
  });

  it('the highlight is `m_Window.grid.last_size_idx` (`:3367`)', () => {
    const r = recorder();
    gridFeedback(r, { ...base, lastSizeIdx: 3 });
    expect(r.calls[0]?.selection).toBe(3);
    gridFeedback(r, { ...base, lastSizeIdx: 0 });
    expect(r.calls[1]?.selection).toBe(0);
  });

  it('nothing is shown when `m_Input.hotkey_feedback` is off (`:3362`)', () => {
    const r = recorder();
    gridFeedback(r, { ...base, hotkeyFeedback: false });
    expect(r.calls).toEqual([]);
  });
});

describe('the window EDA_VIEW_SWITCHER_BASE lays out', () => {
  it('a title over a list, with the selected row alone highlighted', () => {
    render(
      <HotkeyCyclePopupView
        title="Grid"
        items={['100 mils', '50 mils', '25 mils']}
        selection={1}
      />,
    );

    expect(screen.getByText('Grid').className).toContain('ze-hkcycle-title');

    const rows = Array.from(document.querySelectorAll('.ze-hkcycle-item'));
    expect(rows.map((r) => r.textContent)).toEqual(['100 mils', '50 mils', '25 mils']);
    expect(rows.map((r) => r.className.includes('selected'))).toEqual([false, true, false]);
  });

  it('is a .ze-modal, so its face, border and shadow are the shared dialog ones', () => {
    render(<HotkeyCyclePopupView title="Grid" items={['100 mils']} selection={0} />);
    const frame = document.querySelector('.ze-hkcycle');
    // Restating the dialog chrome locally is the drift CLAUDE.md names; the
    // popup must inherit it instead.
    expect(frame?.classList.contains('ze-modal')).toBe(true);
  });

  it('selection -1 highlights nothing', () => {
    render(<HotkeyCyclePopupView title="Grid" items={['a', 'b']} selection={-1} />);
    expect(document.querySelectorAll('.ze-hkcycle-item.selected')).toHaveLength(0);
  });
});

describe('useHotkeyCyclePopup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function Frame({ focusCanvas }: { focusCanvas: () => void }): React.JSX.Element {
    const hk = useHotkeyCyclePopup(focusCanvas);
    return (
      <div>
        <button type="button" onClick={() => hk.popup('Grid', ['100 mils', '50 mils'], 1)}>
          cycle
        </button>
        {hk.node}
      </div>
    );
  }

  it('renders nothing until Popup(), then clears itself after 500 ms', () => {
    const focusCanvas = vi.fn();
    render(<Frame focusCanvas={focusCanvas} />);
    expect(document.querySelector('.ze-hkcycle')).toBeNull();

    act(() => screen.getByText('cycle').click());
    expect(document.querySelector('.ze-hkcycle')).not.toBeNull();
    expect(document.querySelector('.ze-hkcycle-item.selected')?.textContent).toBe('50 mils');

    act(() => void vi.advanceTimersByTime(SHOW_TIME_MS_CPP - 1));
    expect(document.querySelector('.ze-hkcycle')).not.toBeNull();

    act(() => void vi.advanceTimersByTime(1));
    expect(document.querySelector('.ze-hkcycle')).toBeNull();
    expect(focusCanvas).toHaveBeenCalledTimes(1);
  });

  it('unmounting stops the timer rather than firing into a dead frame', () => {
    const focusCanvas = vi.fn();
    const view = render(<Frame focusCanvas={focusCanvas} />);
    act(() => screen.getByText('cycle').click());
    view.unmount();
    act(() => void vi.advanceTimersByTime(SHOW_TIME_MS_CPP * 4));
    expect(focusCanvas).not.toHaveBeenCalled();
  });
});
