// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Share a project: the button, and the panel that hangs off it.
 *
 * ### A popover, not a dialog
 *
 * It used to be a centred modal, which meant clicking a control in the top
 * right and then moving the pointer to the middle of the screen to use what it
 * opened. Every tool that does this well — Canva, Figma, Google Docs — anchors
 * the panel under the button, and the reason is exactly that: the thing you
 * asked for appears where you asked for it.
 *
 * So the button owns the panel rather than raising one somewhere else, and the
 * panel is positioned against the button. There is no upstream counterpart to
 * follow here: a KiCad project is a directory on a disk and cannot be shared
 * with anybody, so nothing about this is a port.
 *
 * ### Two halves, in this order
 *
 * **People** first, because naming somebody is the specific act and the link is
 * the general one. **The link** second, and off by default.
 *
 * Nothing here sends mail. There is no mail path in this app, so an invitation
 * is a row that becomes real the next time that person signs in and opens the
 * link — and the panel says so, in those words. An invitation the sender
 * believes was emailed and the recipient never sees is worse than no invitation
 * at all, so "Invited" is shown as a state rather than as a confirmation.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Combo } from '../ui/Combo.js';
import { Icon } from '../ui/icons.js';
import { cloudBackend } from '../cloud/cloudStore.js';
import { shareUrlFor } from '../cloud/invites.js';
import { profileInitial } from '../auth/profile.js';
import { cloudIdentityOf } from './projectStore.js';

type Role = 'viewer' | 'editor';
type LinkAccess = Role | null;

interface Person {
  user_id: string;
  email: string;
  role: string;
}

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'can view' },
  { value: 'editor', label: 'can edit' },
] as const;

const LINK_OPTIONS = [
  { value: 'off', label: 'Only people invited' },
  { value: 'viewer', label: 'Anyone with the link can view' },
  { value: 'editor', label: 'Anyone with the link can edit' },
] as const;

export function ShareButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const [uid, setUid] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<{ token: string; email: string; role: string }[]>([]);
  const [linkAccess, setLinkAccess] = useState<LinkAccess>(null);
  const [invitee, setInvitee] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('editor');
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const load = useCallback(async (): Promise<void> => {
    setNote(null);
    setLoading(true);
    try {
      // Read at open time rather than held from the project list: a project's
      // identity arrives on its first push, so a value captured when the list
      // was built is stale for exactly the project just created and now being
      // shared.
      const id = await cloudIdentityOf(projectId);
      setUid(id?.uid ?? null);
      setIsOwner(!id?.role || id.role === 'owner');
      const be = cloudBackend();
      if (!id?.uid || !be) return;
      const [row, roster, invites] = await Promise.all([
        be.getProject('', id.uid),
        be.projectRoster ? be.projectRoster(id.uid) : Promise.resolve([]),
        be.pendingInvites ? be.pendingInvites(id.uid) : Promise.resolve([]),
      ]);
      setLinkAccess(row?.link_access ?? null);
      setPeople(roster);
      setPending(invites);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const url = uid ? shareUrlFor(uid) : '';

  /** Run a change, then re-read: the server is what decides, not this panel. */
  const act = (what: Promise<unknown> | undefined): void => {
    if (!what) return;
    setNote(null);
    void what.then(
      () => void load(),
      (e: unknown) => setNote(e instanceof Error ? e.message : String(e)),
    );
  };

  const invite = (): void => {
    const email = invitee.trim();
    if (!email || !uid) return;
    setInvitee('');
    act(cloudBackend()?.inviteByEmail?.(uid, email, inviteRole));
  };

  return (
    <div className="ze-share-anchor" ref={root}>
      <button
        type="button"
        className="ze-account-signout"
        title="Share this project"
        aria-label="Share this project"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
      >
        <Icon name="share" />
      </button>

      {open && (
        <div className="ze-share-pop">
          <div className="ze-share-title">Share "{projectName}"</div>

          {!uid && !loading && (
            <p className="ze-auth-note">
              This project has not reached the cloud yet, so there is nothing to share. Let it sync,
              then share it.
            </p>
          )}

          {uid && (
            <>
              {isOwner && (
                <div className="ze-share-invite">
                  <input
                    type="email"
                    value={invitee}
                    placeholder="Invite by email"
                    aria-label="Invite by email"
                    onChange={(e) => setInvitee(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') invite();
                    }}
                  />
                  <Combo
                    value={inviteRole}
                    options={ROLE_OPTIONS}
                    ariaLabel="What the invited person may do"
                    onChange={(v) => setInviteRole(v as Role)}
                  />
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={!invitee.trim()}
                    onClick={invite}
                  >
                    Invite
                  </button>
                </div>
              )}

              <div className="ze-share-people">
                {people.map((p) => (
                  <div className="ze-share-person" key={p.user_id}>
                    <span className="ze-share-monogram">{profileInitial(p.email)}</span>
                    <span className="lbl">{p.email}</span>
                    {p.role === 'owner' || !isOwner ? (
                      <span className="ze-auth-note">{p.role === 'owner' ? 'Owner' : p.role}</span>
                    ) : (
                      <>
                        <Combo
                          value={p.role}
                          options={ROLE_OPTIONS}
                          ariaLabel={`What ${p.email} may do`}
                          onChange={(v) =>
                            act(cloudBackend()?.setMemberRole?.(uid, p.user_id, v as Role))
                          }
                        />
                        <button
                          type="button"
                          className="ze-share-remove"
                          title={`Remove ${p.email}`}
                          aria-label={`Remove ${p.email}`}
                          onClick={() => act(cloudBackend()?.removeMember?.(uid, p.user_id))}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                ))}

                {pending.map((i) => (
                  <div className="ze-share-person" key={i.token}>
                    <span className="ze-share-monogram">{profileInitial(i.email)}</span>
                    <span className="lbl">{i.email}</span>
                    {/* Said plainly. Nothing has been emailed, so an invitation
                        shown as sent would be a claim this app cannot keep. */}
                    <span className="ze-auth-note">Invited &mdash; not signed in yet</span>
                    <button
                      type="button"
                      className="ze-share-remove"
                      title={`Withdraw the invitation to ${i.email}`}
                      aria-label={`Withdraw the invitation to ${i.email}`}
                      onClick={() => act(cloudBackend()?.revokeInvite?.(i.token))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="ze-share-link">
                <Combo
                  value={linkAccess ?? 'off'}
                  options={LINK_OPTIONS}
                  disabled={!isOwner}
                  ariaLabel="What a link to this project is worth"
                  onChange={(v) =>
                    act(cloudBackend()?.setLinkAccess?.(uid, v === 'off' ? null : (v as Role)))
                  }
                />
                <div className="ze-share-linkrow">
                  <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
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
                </div>
                {linkAccess !== null && (
                  // The two are easy to conflate and only one of them is what
                  // this control does. Closing a link stops it letting anybody
                  // NEW in; the people who already used it hold membership in
                  // their own right and are removed above.
                  <p className="ze-auth-note">
                    Closing the link later stops new people opening it. Anyone already on the list
                    keeps access until you remove them.
                  </p>
                )}
              </div>
            </>
          )}

          {note && <div className="ze-auth-error">{note}</div>}
        </div>
      )}
    </div>
  );
}
