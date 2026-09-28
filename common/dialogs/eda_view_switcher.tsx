// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_VIEW_SWITCHER` (common/dialogs/eda_view_switcher.cpp): the popup the
 * board editor raises on Ctrl+Tab (layer presets) and Shift+Tab (viewports),
 * listing them most-recently-used first (PCB_BASE_EDIT_FRAME::TryBefore,
 * pcb_base_edit_frame.cpp:117-190).
 *
 * The window is EDA_VIEW_SWITCHER_BASE, which it shares with
 * HOTKEY_CYCLE_POPUP: its title keeps the base's own label, "View Preset
 * Switcher" - EDA_VIEW_SWITCHER never sets it - over the list.
 *
 * `TryBefore`'s state machine, as key events: each Tab press moves the
 * selection (Shift+Tab back, unless Shift is the held key), releasing the held
 * key accepts, and Escape cancels. It opens on the Tab that raised it, and
 * because `m_tabState` starts "up" that press has already advanced the
 * selection - so the first row offered is the SECOND most recent, which is the
 * one a quick Ctrl+Tab tap returns to.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { HotkeyCyclePopupView } from './hotkey_cycle_popup_ui.js';

/** `m_ctrlKey`: PRESET_SWITCH_KEY / VIEWPORT_SWITCH_KEY off macOS. */
export type VIEW_SWITCH_KEY = 'Control' | 'Shift';

/** The selection after the opening Tab (`m_tabState` starts false). */
export function initialSwitcherSelection(aCount: number): number {
  return aCount > 1 ? 1 : 0;
}

/** One Tab press: forward, or back on Shift+Tab when Shift is not the held key. */
export function stepSwitcherSelection(
  aSel: number,
  aCount: number,
  aShift: boolean,
  aCtrlKey: VIEW_SWITCH_KEY,
): number {
  if (aCount === 0) return 0;
  if (aShift && aCtrlKey !== 'Shift') return aSel - 1 < 0 ? aCount - 1 : aSel - 1;
  return aSel + 1 >= aCount ? 0 : aSel + 1;
}

export function EDA_VIEW_SWITCHER({
  items,
  heldKey,
  onResult,
}: {
  /** The MRU list, most recent first. */
  items: readonly string[];
  /** `m_ctrlKey`: the key held while Tab cycles; releasing it accepts. */
  heldKey: VIEW_SWITCH_KEY;
  /** `GetSelection()` on wxID_OK (the key released), `null` on Escape. */
  onResult: (index: number | null) => void;
}): JSX.Element {
  const [sel, setSel] = useState(() => initialSwitcherSelection(items.length));
  const selRef = useRef(sel);
  selRef.current = sel;
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key and the list are fixed for the popup's life; the rest is read through refs
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        setSel((s) => stepSwitcherSelection(s, items.length, e.shiftKey, heldKey));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resultRef.current(null);
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.key === heldKey) resultRef.current(selRef.current);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, []);

  return <HotkeyCyclePopupView title="View Preset Switcher" items={items} selection={sel} />;
}
