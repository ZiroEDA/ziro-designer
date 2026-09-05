// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The signed-in account, bottom-left, with everything about it behind one
 * button.
 *
 * No upstream counterpart, and that is the whole reason it looks like this. A
 * KiCad frame has no account, so there is no menu row and no toolbar slot for
 * one — and the previous attempt put the email and a Sign out link straight
 * into the menu bar, which is a row that is otherwise upstream's exactly. Three
 * undifferentiated text links crowded next to `Help` is what that produced.
 *
 * So it belongs to the app shell rather than to the frame, the same way the
 * cloud-sync pill and the guest nudge do: fixed to a corner, over the frame,
 * owing nothing to the sizer tree. Bottom-left is where web tools have settled
 * on putting it — VS Code, Linear, Notion — and it is the one corner of this
 * app that carries no KiCad chrome.
 *
 * It sits ABOVE the status bar rather than over it, off `--statusbar-height`,
 * because that bar is a ported `KISTATUSBAR` with a measured height and its
 * own fields; covering the project path with an avatar would be the same
 * mistake in a new corner.
 *
 * The popup is `.ze-dropdown` — the menu bar's own popup, opening upward
 * instead of downward. Its rows are `.ze-mitem` with the same three spans
 * `MenuEntry` writes, so a row here is a menu row rather than something that
 * merely resembles one.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

export function AccountButton({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // A menu closes on Escape and on a click anywhere else, which is what every
  // other popup in the app does and what a WM does to a GTK menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // The first character of the address, which is what a service with no
  // uploaded picture shows. Upper-cased because an avatar is a monogram, and
  // guarded because an empty string is a legitimate value for a session whose
  // user has no email (an OAuth identity that did not release one).
  const initial = (email.trim()[0] ?? '?').toUpperCase();

  return (
    <div className="ze-account-fab" ref={root}>
      {open && (
        <div className="ze-dropdown up">
          {/* The address is what the row identifies, not something to click:
              `disabled` is how `.ze-mitem` already paints a row that is there
              to be read. */}
          <div className="ze-mitem disabled">
            <span className="mico" />
            <span className="lbl">{email}</span>
          </div>
          <div className="ze-msep" />
          <div
            className="ze-mitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <span className="mico" />
            <span className="lbl">Sign out</span>
          </div>
        </div>
      )}
      <button
        type="button"
        className="ze-account-avatar"
        title={email}
        aria-label={`Account: ${email}`}
        onClick={() => setOpen((v) => !v)}
      >
        {initial}
      </button>
    </div>
  );
}
