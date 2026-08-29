// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window `HOTKEY_CYCLE_POPUP` is: `EDA_VIEW_SWITCHER_BASE`'s vertical box
 * sizer with a `wxStaticText` over a borderless `wxListBox`
 * (`common/dialogs/eda_view_switcher_base.cpp:12-32`).
 *
 * The behaviour — the 500 ms timer, its restart, the focus hand-back — is
 * {@link ./hotkey_cycle_popup.js}, which is framework-free so pcbnew's three
 * call sites can share it. This file is only the view and the hook that binds
 * one instance to React.
 */
import type { JSX } from 'react';
import { useEffect, useReducer, useRef } from 'react';
import {
  HotkeyCyclePopup,
  type HotkeyCyclePopupContents,
  type HotkeyCyclePopupFrame,
} from './hotkey_cycle_popup.js';

/**
 * The dialog itself. `wxSTAY_ON_TOP` alone is the whole style
 * (`eda_view_switcher_base.h:40`), so there is no caption and nothing to click:
 * `TryBefore` (`hotkey_cycle_popup.cpp:139-150`) forwards every key straight to
 * the canvas, which is what `pointer-events: none` says here.
 */
export function HotkeyCyclePopupView({
  title,
  items,
  selection,
}: HotkeyCyclePopupContents): JSX.Element {
  return (
    <div className="ze-hkcycle-layer">
      <div className="ze-modal ze-hkcycle" role="presentation">
        {/* `m_stTitle`, `bSizerMain->Add( m_stTitle, 0, wxALL|wxEXPAND, 5 )`. */}
        <div className="ze-hkcycle-title">{title}</div>
        {/* `m_listBox`, `wxBORDER_NONE`, added with wxBOTTOM|wxLEFT|wxRIGHT, 5. */}
        <div className="ze-hkcycle-list">
          {items.map((item, i) => (
            <div
              // The list is a plain string list upstream; duplicates are
              // possible in principle, so the index is part of the key.
              key={`${i}:${item}`}
              className={`ze-hkcycle-item${i === selection ? ' selected' : ''}`}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** What a frame gets back from {@link useHotkeyCyclePopup}. */
export interface HotkeyCyclePopupHandle {
  /** `HOTKEY_CYCLE_POPUP::Popup`. */
  popup: (title: string, items: readonly string[], selection: number) => void;
  /** What to render — `null` while the window is hidden. */
  node: JSX.Element | null;
}

/**
 * One popup per frame, created lazily exactly as `EDA_DRAW_FRAME` does it:
 * every call site is `if( !GetHotkeyPopup() ) CreateHotkeyPopup();`
 * (`common/eda_draw_frame.cpp:1344-1347`).
 *
 * `focusCanvas` is `m_drawFrame->GetCanvas()->SetFocus()`. It is read through a
 * ref so a frame may pass a fresh closure on every render without the popup
 * being rebuilt — rebuilding it would drop a running timer on the floor.
 */
export function useHotkeyCyclePopup(focusCanvas: () => void): HotkeyCyclePopupHandle {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const focusRef = useRef(focusCanvas);
  focusRef.current = focusCanvas;

  const ref = useRef<HotkeyCyclePopup | null>(null);
  if (ref.current === null) {
    const frame: HotkeyCyclePopupFrame = { focusCanvas: () => focusRef.current() };
    ref.current = new HotkeyCyclePopup(frame, redraw);
  }
  const ctl = ref.current;

  useEffect(() => () => ctl.destroy(), [ctl]);

  return {
    popup: (title, items, selection) => ctl.popup(title, items, selection),
    node: ctl.shown && ctl.contents ? <HotkeyCyclePopupView {...ctl.contents} /> : null,
  };
}
