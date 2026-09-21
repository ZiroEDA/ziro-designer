// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Who else is in this project right now, and — for the session's owner —
 * a way to move someone between Editor and Viewer. No upstream KiCad
 * counterpart, same as the presence badge this opens from: KiCad has no
 * notion of another viewer on the same document.
 *
 * See docs/proposals/multiplayer-architecture.md ("Who is allowed to do
 * what") for the design this is the UI half of, and
 * designer/src/sync/ProjectSyncTransport.ts for `PeerRole` itself: `owner`
 * is never assigned here, only decided by the transport on connect.
 */
import { useEffect, useRef, type JSX } from 'react';
import type { PeerRole, PresenceInfo } from '../sync/ProjectSyncTransport.js';
import { peerColor } from '../sync/peerColor.js';

const ROLE_LABEL: Record<PeerRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

/** A short, stable label for a peer with no known display name. */
const fallbackName = (peerId: string): string => `Peer ${peerId.slice(0, 4)}`;

export interface PresencePanelProps {
  /** This tab's own identity, shown first, never given role controls. */
  me: { peerId: string; role: PeerRole; displayName: string | null };
  /** Every other connected peer (the existing `syncPeers` state). */
  peers: readonly PresenceInfo[];
  /** Only called when `me.role === 'owner'` — the panel never renders the
   *  controls that would call this otherwise. */
  onSetRole: (peerId: string, role: 'editor' | 'viewer') => void;
  onClose: () => void;
}

function PresenceRow({
  label,
  color,
  role,
  isSelf,
  onSetRole,
}: {
  label: string;
  color: string;
  role: PeerRole;
  isSelf: boolean;
  onSetRole: ((role: 'editor' | 'viewer') => void) | null;
}): JSX.Element {
  return (
    <div className="ze-presence-row">
      <span className="ze-presence-dot" style={{ background: color }} />
      <span className="ze-presence-name">
        {label}
        {isSelf ? ' (you)' : ''}
      </span>
      {onSetRole ? (
        <select
          className="ze-presence-role-select"
          value={role}
          onChange={(e) => onSetRole(e.target.value as 'editor' | 'viewer')}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      ) : (
        <span className="ze-presence-role">{ROLE_LABEL[role]}</span>
      )}
    </div>
  );
}

export function PresencePanel({ me, peers, onSetRole, onClose }: PresencePanelProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // Same dismiss rule as BackgroundJobList: focus itself, close on the next
  // outside press or on losing focus.
  useEffect(() => {
    ref.current?.focus();
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const amOwner = me.role === 'owner';

  return (
    <div
      ref={ref}
      className="ze-presence-panel"
      aria-label="Who's here"
      data-testid="presence-panel"
      tabIndex={-1}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      <PresenceRow
        label={me.displayName ?? 'You'}
        color={peerColor(me.peerId)}
        role={me.role}
        isSelf
        onSetRole={null}
      />
      {peers.map((p) => (
        <PresenceRow
          key={p.peerId}
          label={p.displayName ?? fallbackName(p.peerId)}
          color={peerColor(p.peerId)}
          role={p.role}
          isSelf={false}
          onSetRole={amOwner && p.role !== 'owner' ? (role) => onSetRole(p.peerId, role) : null}
        />
      ))}
    </div>
  );
}
