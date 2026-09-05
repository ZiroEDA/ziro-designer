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
 * So it goes at the foot of the project manager's own left bar, which is where
 * an activity bar puts it — VS Code, Linear, Notion all reach for the same
 * corner. A deliberate divergence rather than an oversight: `KICAD_MANAGER_FRAME`
 * has that bar and has nothing like this in it.
 *
 * It states no size of its own. `.ze-mgrbar` already decides its buttons are
 * 32px on a 34px bar, measured off the real pane, so an avatar that named its
 * own would be a second answer to a question the bar has already answered.
 * `margin-top: auto` is the only placement here, which sinks it to the bottom
 * of the bar's flex column however many tools are above it.
 *
 * The popup is `.ze-dropdown` — the menu bar's own popup — opening to the side
 * and upward, because the bar is 34px wide and at the bottom of the window. Its
 * rows are `.ze-mitem` with the same spans `MenuEntry` writes, so a row here is
 * a menu row rather than something that merely resembles one.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { profileInitial } from '../auth/profile.js';

export function AccountButton({
  email,
  photoUrl,
  onSignOut,
}: {
  email: string;
  /** The provider's picture, when the person signed in with one. */
  photoUrl?: string | null;
  onSignOut: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  /**
   * Set when the picture will not load, which is not hypothetical: a Google
   * avatar is served from a third-party host, and an extension, a blocker or a
   * revoked URL all end the same way. Without this the button would be an empty
   * circle with no clue that it is the account.
   */
  const [photoFailed, setPhotoFailed] = useState(false);
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

  const photo = photoUrl && !photoFailed ? photoUrl : null;

  return (
    <div className="ze-account-fab" ref={root}>
      {open && (
        <div className="ze-dropdown ze-account-menu">
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
        {photo ? (
          <img
            src={photo}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          profileInitial(email)
        )}
      </button>
    </div>
  );
}
