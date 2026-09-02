// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SPLIT_BUTTON` (`common/widgets/split_button.cpp`) — a labelled button with a
 * narrow arrow half that drops a menu.
 *
 * It is one widget upstream and it is reached from several places (the toolbar
 * customisation page's "Insert Separator", the library browse buttons), so it
 * is one component here for the same reason: the two halves have to be the same
 * two halves everywhere, and they cannot be if each call site draws its own.
 *
 * `OnPaint` (`:225-327`) is the whole specification, and the shape is less
 * obvious than the name suggests — it is **two** push buttons, not one box with
 * a divider:
 *
 *     wxRect r1{ 0, 0, width, h };
 *     wxRendererNative::Get().DrawPushButton( this, dc, r1, m_stateButton );
 *     ...
 *     wxRect r2{ width, 0, m_arrowButtonWidth, h };
 *     r2.x -= 2;
 *     wxRendererNative::Get().DrawPushButton( this, dc, r2, m_stateMenu );
 *     wxRendererNative::Get().DrawDropArrow( this, dc, r2, m_stateMenu );
 *
 * so each half keeps its own border and its own rounded corners, they overlap
 * by two pixels, and each lights independently under the pointer — which is
 * what a capture of the real page shows and what our first attempt got wrong by
 * flattening the seam into one slab.
 */
import { useRef, useState, type JSX } from 'react';
import { ContextMenu } from './MenuBar.js';
import type { MenuItem } from './menu_types.js';

export interface SplitButtonProps {
  /** The label the wide half carries; `SetLabel( … )`. */
  label: string;
  /** `wxEVT_BUTTON` — the wide half, which never opens the menu. */
  onClick: () => void;
  /** The rows of `GetSplitButtonMenu()`, in order. */
  menu: MenuItem[];
  disabled?: boolean;
  /** The arrow half's accessible name; it has no label of its own. */
  menuLabel?: string;
}

export function SplitButton({
  label,
  onClick,
  menu,
  disabled,
  menuLabel = 'More',
}: SplitButtonProps): JSX.Element {
  const arrowRef = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  return (
    <span className="ze-splitbtn">
      <button type="button" className="ze-btn" disabled={disabled} onClick={onClick}>
        {label}
      </button>
      <button
        ref={arrowRef}
        type="button"
        className="ze-btn ze-splitbtn-arrow"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        disabled={disabled}
        onClick={() => {
          const r = arrowRef.current?.getBoundingClientRect();
          if (r) setAt({ x: r.left, y: r.bottom });
        }}
      >
        {/* `DrawDropArrow` — GTK's own pan-down, which is the chevron every
            other arrow in this app already draws. */}
        <span className="twisty expandable open" />
      </button>
      {at && <ContextMenu items={menu} x={at.x} y={at.y} onClose={() => setAt(null)} />}
    </span>
  );
}
