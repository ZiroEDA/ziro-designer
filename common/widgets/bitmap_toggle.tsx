// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BITMAP_TOGGLE` (`include/widgets/bitmap_toggle.h`,
 * `common/widgets/bitmap_toggle.cpp`): "a checkbox that uses custom bitmaps" -
 * the eye every row of the appearance panels carries. It swaps between TWO of
 * KiCad's own bitmaps; it does not draw one glyph at two opacities.
 *
 * A left button UP toggles it and posts `TOGGLE_CHANGED`, ignoring a second
 * one within 200 ms (`m_debounce`). The click is the toggle's own and does not
 * reach the row it sits in; right-button events are passed on, so a row's
 * context menu still opens over it.
 */

import { type JSX, useRef } from 'react';
import { KiBitmapBundle } from '../bitmap.js';
import type { BITMAPS } from '../bitmaps/bitmaps_list.js';

/** [data] `if( now - m_debounce < 200 )` (bitmap_toggle.cpp:57). */
export const BITMAP_TOGGLE_DEBOUNCE_MS = 200;

export interface BitmapToggleProps {
  /** `GetValue()`. */
  checked: boolean;
  /** `aCheckedBitmap`, a `BITMAPS` value. */
  checkedBitmap: BITMAPS;
  /** `aUncheckedBitmap`. */
  uncheckedBitmap: BITMAPS;
  /** `TOGGLE_CHANGED`, with the new value (`command.SetInt( m_checked )`). */
  onToggle: (aChecked: boolean) => void;
  /** `SetToolTip()`. */
  tooltip?: string;
}

export function BitmapToggle({
  checked,
  checkedBitmap,
  uncheckedBitmap,
  onToggle,
  tooltip,
}: BitmapToggleProps): JSX.Element {
  const m_debounce = useRef(Number.NEGATIVE_INFINITY);
  return (
    <button
      type="button"
      className="ze-eye-btn"
      title={tooltip}
      aria-pressed={checked}
      onClick={(e) => {
        e.stopPropagation();
        const now = Date.now();
        if (now - m_debounce.current < BITMAP_TOGGLE_DEBOUNCE_MS) return;
        m_debounce.current = now;
        onToggle(!checked);
      }}
    >
      <img
        className="ze-eye"
        src={KiBitmapBundle(checked ? checkedBitmap : uncheckedBitmap)}
        width="16"
        height="16"
        alt=""
      />
    </button>
  );
}
