// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Share a project by link.
 *
 * No upstream counterpart: KiCad projects live on a disk, and a disk has no
 * notion of somebody else opening the same one. This is one of the few windows
 * here that is ours rather than a port, so it follows the app's own chrome
 * (`ze-modal`) and the shape people already know from Figma and Google Docs —
 * a switch for what a link is worth, and the link.
 *
 * Three states it has to tell apart, because they need different sentences:
 *
 *  - **not synced yet.** A project only has a global identity once it has
 *    reached the cloud, so there is nothing to link to. Saying "sharing is off"
 *    here would be a lie the user cannot act on.
 *  - **not yours.** Someone shared it with you; deciding who else may reach it
 *    is the owner's, and the database enforces that whatever this dialog does.
 *  - **yours.** The switch, and the link.
 */

import { useEffect, useState, type JSX } from 'react';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { cloudBackend } from '../../cloud/cloudStore.js';
import { shareUrlFor } from '../../cloud/invites.js';

type LinkAccess = 'viewer' | 'editor' | null;

/** What the dialog is looking at, once it knows. */
type State =
  | { kind: 'loading' }
  | { kind: 'unsynced' }
  | { kind: 'not-owner' }
  | { kind: 'ready'; access: LinkAccess }
  | { kind: 'error'; message: string };

const CHOICES: { value: LinkAccess; label: string; hint: string }[] = [
  { value: null, label: 'Off', hint: 'Only people you have added can open it.' },
  {
    value: 'viewer',
    label: 'Anyone with the link can view',
    hint: 'They can open and read the project, but not save changes to it.',
  },
  {
    value: 'editor',
    label: 'Anyone with the link can edit',
    hint: 'They can change the project, and their changes are saved for everyone.',
  },
];

export function ShareProjectDialog({
  projectName,
  uid,
  isOwner,
  onClose,
}: {
  projectName: string;
  /** The project's global id, or undefined when it has never synced. */
  uid?: string;
  isOwner: boolean;
  onClose: () => void;
}): JSX.Element {
  useModalEscape(onClose);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return setState({ kind: 'unsynced' });
    if (!isOwner) return setState({ kind: 'not-owner' });
    let live = true;
    const be = cloudBackend();
    if (!be) return setState({ kind: 'error', message: 'Not connected to the cloud.' });
    void be
      .getProject('', uid)
      .then((row) => {
        if (!live) return;
        setState({ kind: 'ready', access: row?.link_access ?? null });
      })
      .catch((e: unknown) => {
        if (live) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [uid, isOwner]);

  const choose = (access: LinkAccess): void => {
    const be = cloudBackend();
    if (!uid || !be?.setLinkAccess) return;
    // Shown as chosen straight away, and put back if the write is refused. The
    // alternative is a radio that does nothing for a round trip, which reads as
    // a broken control rather than a slow one.
    const previous = state.kind === 'ready' ? state.access : null;
    setState({ kind: 'ready', access });
    setBusy(true);
    void be
      .setLinkAccess(uid, access)
      .catch((e: unknown) => {
        setState({ kind: 'ready', access: previous });
        window.setTimeout(
          () => setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
          0,
        );
      })
      .finally(() => setBusy(false));
  };

  const url = uid ? shareUrlFor(uid) : '';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Share "{projectName}"
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body">
          {state.kind === 'loading' && <p className="ze-auth-note">Checking...</p>}

          {state.kind === 'unsynced' && (
            <p className="ze-auth-note">
              This project has not reached the cloud yet, so there is nothing to link to. Sign in
              and let it sync, then share it.
            </p>
          )}

          {state.kind === 'not-owner' && (
            <p className="ze-auth-note">
              This project was shared with you. Only its owner can change who else can open it.
            </p>
          )}

          {state.kind === 'error' && (
            <div className="ze-auth-error">Could not read the sharing setting: {state.message}</div>
          )}

          {state.kind === 'ready' && (
            <>
              {CHOICES.map((c) => (
                <label key={String(c.value)}>
                  <input
                    type="radio"
                    name="ze-share-access"
                    checked={state.access === c.value}
                    disabled={busy}
                    onChange={() => choose(c.value)}
                  />
                  {c.label}
                  <p className="ze-auth-note">{c.hint}</p>
                </label>
              ))}

              <label className="ze-auth-field">
                <span>Link</span>
                <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              </label>

              {state.access === null && (
                <p className="ze-auth-note">The link only works while sharing is on.</p>
              )}
              {state.access !== null && (
                // Said plainly because the two are easy to conflate and only one
                // of them is what this switch does. Turning the link off stops
                // it letting anybody new in; it does not remove the people who
                // already used it, who hold access in their own right.
                <p className="ze-auth-note">
                  Turning this off later stops new people opening the link. Anyone who has already
                  opened it keeps access until you remove them.
                </p>
              )}
            </>
          )}
        </div>
        <div className="ze-modal-footer">
          {state.kind === 'ready' && (
            <button
              type="button"
              className="ze-btn"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(url)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          )}
          <button type="button" className="ze-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
