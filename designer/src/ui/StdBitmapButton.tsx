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
  /** The accessible name. An icon-only button must have one; wx gets it free
   *  from the bitmap's context, a bare `<button>` does not. */
  title: string;
  /**
   * `SetToolTip( … )`, which is NOT the same question as the accessible name:
   * a form builder sets it on some of a button row and not others, and putting
   * one where upstream has none invents hover text. Defaults to `title`,
   * because that is what most call sites want; pass `null` for the buttons
   * upstream leaves without one.
   */
  tooltip?: string | null;
  disabled?: boolean;
  onClick: () => void;
}

export function StdBitmapButton({
  bitmap,
  title,
  tooltip,
  disabled,
  onClick,
}: StdBitmapButtonProps): JSX.Element {
  const url = bitmapUrl(bitmap);
  const hover = tooltip === undefined ? title : tooltip;
  return (
    <button
      type="button"
      className="ze-gridbtn"
      {...(hover === null ? {} : { title: hover })}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {url ? <img src={url} alt="" /> : title}
    </button>
  );
}
