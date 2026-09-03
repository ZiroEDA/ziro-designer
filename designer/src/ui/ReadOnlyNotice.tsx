// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { type JSX, useState } from 'react';
// The desktop theme's own files, vendored — see the note below on why these
// are not KiCad bitmaps.
import warningIcon from '../assets/theme/dialog-warning.png';
import closeIcon from '../assets/theme/window-close.png';

/**
 * `WX_INFOBAR` (common/widgets/wx_infobar.cpp), the strip above the canvas.
 *
 * The read-only case upstream is three calls (eeschema/files-io.cpp:844-847,
 * and pcbnew/pcb_edit_frame.cpp:2016 for the board):
 *
 *     m_infoBar->RemoveAllButtons();
 *     m_infoBar->AddCloseButton();
 *     m_infoBar->ShowMessage( _( "Schematic is read only." ),
 *                             wxICON_WARNING, MESSAGE_TYPE::OUTDATED_SAVE );
 *
 * so: icon, message, then buttons at the far right — the close button last,
 * because `AddButton` adds "in the right-most position" (wx_infobar.h:115).
 *
 * **The two glyphs are the desktop theme's, not KiCad's**, which is the one
 * place in this app where that is true and is worth explaining.
 *
 * `wxICON_WARNING` and `wxBitmapButton::NewCloseButton` do not draw KiCad
 * bitmaps: they ask the ART PROVIDER, so what appears is whatever the GTK icon
 * theme supplies. Vendoring KiCad's own `dialog_warning.svg` therefore looked
 * right by convention and was visibly wrong — an amber triangle where KiCad on
 * this desktop draws a red disc. Proven rather than argued: sampling KiCad's
 * own window gives #e41f3b for the icon and #c7162b x126 with #ffffff x12 for
 * the close button, and Yaru's `16x16/status/dialog-warning.png` and
 * `16x16/actions/window-close.png` have exactly those counts.
 *
 * So these are Yaru's files, byte-identical, at 16x16 because that is the
 * `wxART_BUTTON` size hint GTK reports. They are **CC-BY-SA-4.0**, which is
 * one-way compatible with this project's GPL-3.0-or-later; the attribution is
 * in NOTICE.md. They live under `assets/theme/` rather than `assets/toolbar/`
 * so their provenance is obvious: everything in `toolbar/` is KiCad's.
 *
 * Dismissal is local and re-arms on a new message, which is what upstream does
 * by construction: closing hides the bar, the next `ShowMessage` shows it again.
 */
export function ReadOnlyNotice({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): JSX.Element | null {
  // Keyed on the message so a different one re-opens a bar the user closed,
  // rather than staying hidden for the life of the frame.
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  if (hiddenFor === message) return null;

  return (
    <div className="ze-infobar ze-readonly-infobar" role="status">
      <img className="ze-infobar-icon" src={warningIcon} alt="" aria-hidden="true" />
      {/* `margin-right: auto` lives on this, so everything after it is pushed
          to the right edge the way the sizer's spacer pushes the buttons. */}
      <span className="msg">{message}</span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {/* `AddCloseButton()` (wx_infobar.cpp:375-382), rightmost, and it only
          hides the bar. The tooltip is upstream's own default string. */}
      <button
        type="button"
        className="ze-infobar-close"
        title="Hide this message."
        aria-label="Hide this message."
        onClick={() => setHiddenFor(message)}
      >
        <img src={closeIcon} alt="" aria-hidden="true" />
      </button>
    </div>
  );
}
