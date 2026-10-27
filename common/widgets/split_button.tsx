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
import { Button } from '@ziroeda/wx/controls.js';
import { StdBitmapButton } from './std_bitmap_button.js';
import { useRef, useState, type JSX } from 'react';
import { ContextMenu } from '@ziroeda/wx/menu_ui.js';
import type { MenuItem } from '@ziroeda/wx/menu.js';

export interface SplitButtonProps {
  /** The label the wide half carries; `SetLabel( … )`. With a bitmap, its tooltip. */
  label: string;
  /**
   * `SetBitmap( KiBitmapBundle( … ) )`: OnPaint then draws the bitmap in the wide half and not the
   * label (`:290-307`), and the library panels size that half as their bitmap buttons are
   * (`m_browseButton->SetMinSize( m_append_button->GetSize() )`) - so it IS one of them.
   */
  bitmap?: string;
  /** `wxEVT_BUTTON` — the wide half, which never opens the menu. */
  onClick: () => void;
  /** The rows of `GetSplitButtonMenu()`, in order. */
  menu: MenuItem[];
  disabled?: boolean;
  /** The arrow half's accessible name; it has no label of its own. */
  menuLabel?: string;
  /**
   * The wide half opens the menu too. A browser has no directory picker over the project's
   * folders, so where KiCad's wide half opens one, ours lists them.
   */
  clickOpensMenu?: boolean;
}

export function SplitButton({
  label,
  bitmap,
  onClick,
  menu,
  disabled,
  menuLabel = 'More',
  clickOpensMenu,
}: SplitButtonProps): JSX.Element {
  const arrowRef = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const openMenu = (): void => {
    const r = arrowRef.current?.parentElement?.getBoundingClientRect();
    if (r) setAt({ x: r.left, y: r.bottom });
  };

  return (
    <span className={`ze-splitbtn${bitmap ? ' bitmap' : ''}`}>
      {bitmap ? (
        <StdBitmapButton
          bitmap={bitmap}
          title={label}
          disabled={disabled}
          onClick={clickOpensMenu ? openMenu : onClick}
        />
      ) : (
        <Button label={label} disabled={disabled} onClick={clickOpensMenu ? openMenu : onClick} />
      )}
      <button
        ref={arrowRef}
        type="button"
        // Both halves are the same push button (OnPaint draws each with DrawPushButton): with a
        // bitmap that is the bitmap buttons' face and height, the arrow keeping its own width.
        className={`${bitmap ? 'ze-gridbtn' : 'ze-btn'} ze-splitbtn-arrow`}
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
