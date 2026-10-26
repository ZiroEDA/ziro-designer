// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The account, bottom-left, with everything about it behind one button - there signed out too.
 * An account is optional (auth/explore.ts), so its button is not a sign-in prompt in the title bar
 * but this one place, the same whether or not anyone is signed in: signed out it is a person glyph
 * whose menu offers the source, the community chat, then Sign in; signed in, the avatar and the account's rows.
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

import { useCallback, useRef, useState, type JSX } from 'react';
import {
  deleteAccountGlyph,
  discordGlyph,
  githubGlyph,
  recoveryKeyGlyph,
  signInGlyph,
  signOutGlyph,
} from './account_menu_icons.js';
import { avatarColorFor } from '../auth/avatar_color.js';
import { profileInitial } from '../auth/profile.js';
import { useDismissOnOutside } from '@ziroeda/common/widgets/use_dismiss_on_outside.js';

export function AccountButton({
  email,
  photoUrl,
  onSignIn,
  onSignOut,
  onRecoveryKey,
  onDeleteAccount,
  chatUrl,
  sourceUrl,
}: {
  /** The signed-in address; null signed out. */
  email: string | null;
  /** The provider's picture, when the person signed in with one. */
  photoUrl?: string | null;
  /** Signed out: open sign-in (a new tab, auth/explore.ts `goToAuth`); absent, no row. */
  onSignIn?: () => void;
  onSignOut?: () => void;
  /**
   * Show the account's recovery key again, for whoever chose "Do this later"
   * at sign-up. The reference design offers exactly this from its settings;
   * absent (a build without auth) the row is not drawn.
   */
  onRecoveryKey?: () => void;
  /**
   * Delete the account. The reference's sidebar has it last, in a group of
   * its own, in the critical colour; absent, the row is not drawn.
   */
  onDeleteAccount?: () => void;
  /** The community chat, opened in a new tab; absent, no row. */
  chatUrl?: string;
  /** The public source repository, opened in a new tab; absent, no row. */
  sourceUrl?: string;
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
  // other popup in the app does and what a WM does to a GTK menu. Shared, and
  // in the capture phase: see `useDismissOnOutside`.
  useDismissOnOutside(
    root,
    useCallback(() => setOpen(false), []),
    open,
  );

  const photo = photoUrl && !photoFailed ? photoUrl : null;
  const row = (aLabel: string, aIcon: JSX.Element, aAction: () => void, aClass = '') => (
    <div
      className={`ze-mitem${aClass}`}
      onClick={() => {
        setOpen(false);
        aAction();
      }}
    >
      <span className="mico">{aIcon}</span>
      <span className="lbl">{aLabel}</span>
    </div>
  );
  const sourceRow =
    sourceUrl && row('GitHub', githubGlyph, () => window.open(sourceUrl, '_blank', 'noopener'));
  const chatRow =
    chatUrl && row('Discord chat', discordGlyph, () => window.open(chatUrl, '_blank', 'noopener'));

  return (
    <div className="ze-account-fab" ref={root}>
      {open && (
        <div className="ze-dropdown ze-account-menu">
          {email === null ? (
            <>
              {sourceRow}
              {chatRow}
              {onSignIn && row('Sign in', signInGlyph, onSignIn)}
            </>
          ) : (
            <>
              {/* The address is what the row identifies, not something to click:
                  `disabled` is how `.ze-mitem` already paints a row that is there
                  to be read. */}
              <div className="ze-mitem disabled">
                <span className="mico" />
                <span className="lbl">{email}</span>
              </div>
              <div className="ze-msep" />
              {onRecoveryKey && row('Recovery key', recoveryKeyGlyph, onRecoveryKey)}
              {onSignOut && row('Sign out', signOutGlyph, onSignOut)}
              {(sourceRow || chatRow) && (
                <>
                  <div className="ze-msep" />
                  {sourceRow}
                  {chatRow}
                </>
              )}
              {onDeleteAccount && (
                <>
                  <div className="ze-msep" />
                  {row('Delete account', deleteAccountGlyph, onDeleteAccount, ' ze-critical')}
                </>
              )}
            </>
          )}
        </div>
      )}
      <button
        type="button"
        className={`ze-account-avatar${email === null ? ' guest' : ''}`}
        title={email ?? 'Account'}
        aria-label={email === null ? 'Account' : `Account: ${email}`}
        // The reference's avatar: a disc in a colour picked from the address,
        // the initial in white on it. Only when there is no picture to show;
        // signed out, a ring with a person glyph in it and no fill.
        style={photo || email === null ? undefined : { background: avatarColorFor(email) }}
        onClick={() => setOpen((v) => !v)}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setPhotoFailed(true)}
          />
        ) : email === null ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            {/* [data] a head and shoulders, in the bar's ink */}
            <circle cx="12" cy="8" r="4" fill="currentColor" />
            <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" />
          </svg>
        ) : (
          profileInitial(email)
        )}
      </button>
    </div>
  );
}
