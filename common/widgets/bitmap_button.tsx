// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BITMAP_BUTTON` (`include/widgets/bitmap_button.h`,
 * `common/widgets/bitmap_button.cpp`): a borderless bitmap-only button KiCad
 * paints itself. The text-format bars, the label dialog's field buttons and
 * the footprint chooser's view toggles are all this one class.
 *
 * - `SetIsCheckButton()` / `SetIsRadioButton()` + `Check()`: pass `checked`.
 *   The widget is controlled; a radio group un-checks its siblings in the
 *   owner's handler exactly as the dialogs' `onHAlignButton` do.
 * - `SetIsSeparator()`: `BitmapButtonSeparator`, which `OnPaint` draws as one
 *   `wxSYS_COLOUR_GRAYTEXT` line (`bitmap_button.cpp:279-284`).
 * - `Enable( false )`: `disabled`; the disabled bitmap is the shared filter.
 *
 * The badge (`SetShowBadge`) and `AcceptDragInAsClick` are toolbar-only and
 * not ported; the toolbars draw their own buttons.
 *
 * The metrics are the `.ze-lp-iconbtn` / `.ze-lp-sep` rules in `shell.css`.
 */

import type { JSX } from 'react';
import { bitmapUrl } from '../bitmap_store.js';

export interface BitmapButtonProps {
  /** `SetBitmap( KiBitmapBundle( BITMAPS::<name> ) )`, by name. */
  bitmap: string;
  /** `SetToolTip()`. */
  tooltip: string;
  /**
   * `Check()` state of a check or radio button. Leave undefined for a plain
   * push button, which reports no pressed state.
   */
  checked?: boolean;
  /** `Enable( false )`. */
  disabled?: boolean;
  /** `wxEVT_BUTTON`. */
  onClick: () => void;
}

export function BitmapButton({
  bitmap,
  tooltip,
  checked,
  disabled,
  onClick,
}: BitmapButtonProps): JSX.Element {
  const url = bitmapUrl(bitmap);
  return (
    <button
      type="button"
      className={`ze-lp-iconbtn${checked ? ' checked' : ''}`}
      title={tooltip}
      aria-pressed={checked}
      disabled={disabled}
      onClick={onClick}
    >
      {url ? <img src={url} alt={tooltip} /> : tooltip}
    </button>
  );
}

/** A `BITMAP_BUTTON` with `SetIsSeparator()`. */
export function BitmapButtonSeparator(): JSX.Element {
  return <span className="ze-lp-sep" />;
}
