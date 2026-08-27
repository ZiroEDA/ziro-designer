// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `STD_BITMAP_BUTTON` (common/widgets/std_bitmap_button.cpp), the small
 * icon-only button KiCad puts under every `WX_GRID`.
 *
 * It is one class upstream, used by every dialog that has an add / move-up /
 * move-down / delete row: `dialog_symbol_properties_base.cpp:87-108` builds
 * four of them, and so do the label, sheet, text-and-graphics and setup
 * dialogs. The point of a shared component here is the same as the point of
 * the shared class there — a grid's button row must look identical wherever it
 * appears, and it cannot if each dialog draws its own.
 *
 * The chrome is `.ze-gridbtn` in `ui/shell.css`, which is also what the other
 * ported grid button rows use; this states nothing of its own.
 */
import type { JSX } from 'react';
import { bitmapUrl } from './toolbarIcons.js';

export interface StdBitmapButtonProps {
  /** A `BITMAPS::` name, e.g. `small_plus`; resolved out of KiCad's own SVGs. */
  bitmap: string;
  /** `SetToolTip( … )` — and the accessible name, since there is no label. */
  title: string;
  disabled?: boolean;
  onClick: () => void;
}

export function StdBitmapButton({
  bitmap,
  title,
  disabled,
  onClick,
}: StdBitmapButtonProps): JSX.Element {
  const url = bitmapUrl(bitmap);
  return (
    <button
      type="button"
      className="ze-gridbtn"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {url ? <img src={url} alt="" /> : title}
    </button>
  );
}
