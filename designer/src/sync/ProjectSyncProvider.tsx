// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { createProjectSyncTransport } from './createProjectSyncTransport.js';
import type { EditorKind, ProjectSyncTransport } from './ProjectSyncTransport.js';

const Ctx = createContext<ProjectSyncTransport | null>(null);

/**
 * The tab's live connection, or null when there is nothing to connect to
 * (no project open). Every editor reads the same one.
 */
export function useProjectSync(): ProjectSyncTransport | null {
  return useContext(Ctx);
}

/**
 * One connection per tab, not one per editor.
 *
 * The schematic and board editors both stay mounted once opened -- App hides
 * the inactive one with `display: none` so switching back is instant and keeps
 * its state -- and each used to build its own transport. Two transports in one
 * tab are two peers: the tab counted itself as "1 other viewer", listed itself
 * in its own presence panel, and, worst of the three, its second transport won
 * the owner election against its first, so the actual user showed up as an
 * editor in their own project and never saw the owner's role controls.
 *
 * A peer is a *person looking at a project*, which is the tab. Which editor
 * they happen to be in is a property of that peer, not a second peer, and
 * `updatePresence` exists to say so without dropping the connection -- so
 * switching editors re-announces rather than reconnecting, and nobody watching
 * sees you blink out and back in.
 *
 * Deliberately not keyed on `view`: the connection outlives every editor
 * switch, and only identity (which project, which account) may restart it.
 */
export function ProjectSyncProvider({
  projectName,
  projectUid,
  view,
  children,
}: {
  /** Null or empty when no project is open; nothing connects. */
  projectName: string | null | undefined;
  /** `projects.uid`, when the project has synced. Decides which transport the
   *  factory hands back; see createProjectSyncTransport.ts. */
  projectUid: string | null | undefined;
  /** Which editor the user is actually looking at right now. */
  view: EditorKind;
  children: ReactNode;
}): React.JSX.Element {
  const { session } = useAuth();
  const displayName = session?.user.email ?? null;
  const userId = session?.user.id ?? null;

  const [transport, setTransport] = useState<ProjectSyncTransport | null>(null);
  const live = useRef<ProjectSyncTransport | null>(null);
  /** The view to announce on connect, read through a ref so that changing
   *  editors does not re-run the effect that owns the connection. */
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!projectName) {
      setTransport(null);
      return undefined;
    }
    const t = createProjectSyncTransport(projectName, { uid: projectUid, userId });
    live.current = t;
    t.connect(viewRef.current, null, { displayName });
    setTransport(t);
    return () => {
      live.current = null;
      setTransport(null);
      t.disconnect();
    };
  }, [projectName, projectUid, userId, displayName]);

  // A switch between editors is a re-announcement, never a reconnect. The
  // sheet path is left to the schematic editor, which is the only thing that
  // knows one; it re-announces when it becomes the active view.
  useEffect(() => {
    if (view === 'schematic') return; // the schematic announces its own sheet
    live.current?.updatePresence(view, null);
  }, [view]);

  return <Ctx.Provider value={transport}>{children}</Ctx.Provider>;
}
