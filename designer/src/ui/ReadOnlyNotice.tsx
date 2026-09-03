// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { type JSX, useState } from 'react';

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
 * so: an icon, a message, and a close button — in that order, the close button
 * rightmost because `AddButton` adds "in the right-most position" (:115).
 *
 * [chrome, measured] The icon is `wxICON_WARNING` at the `wxART_BUTTON` size
 * hint, which GTK reports as **16x16**, resolving through the icon theme to
 * Yaru's `dialog-warning`. That file is not the amber triangle the name
 * suggests: at 16px it is a **plain filled circle**, no glyph inside, and its
 * fill sampled off the PNG is **#e01c39**. Drawn rather than vendored, because
 * a browser cannot read the GTK icon theme and copying Yaru's art into a
 * GPL-3 tree is a licence question this does not need to ask.
 *
 * The close button is `wxBitmapButton::NewCloseButton` (:377) with the tooltip
 * `_( "Hide this message." )` (wx_infobar.h:111) — both taken verbatim.
 *
 * Dismissal is local and re-arms on a new message, which is what upstream does
 * by construction: closing hides the bar, and the next `ShowMessage` shows it
 * again.
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
      {/* wxICON_WARNING, drawn at the size GTK hints for wxART_BUTTON. */}
      <svg
        className="ze-infobar-icon"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="8" r="8" fill="#e01c39" />
      </svg>
      <span className="msg">{message}</span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {/* `AddCloseButton()`: rightmost, and it only hides the bar. */}
      <button
        type="button"
        className="ze-infobar-close"
        title="Hide this message."
        aria-label="Hide this message."
        onClick={() => setHiddenFor(message)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          {/* Yaru's own `window-close-symbolic` path, so the glyph is the
              theme's rather than an approximation of it. */}
          <path
            d="M4.795 3.912l-.883.883.147.146L7.117 8 4.06 11.059l-.147.146.883.883.146-.147L8 8.883l3.059 3.058.146.147.883-.883-.147-.146L8.883 8l3.058-3.059.147-.146-.883-.883-.146.147L8 7.117 4.941 4.06z"
            fill="currentColor"
            fillRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
