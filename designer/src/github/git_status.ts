// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the project tree shows of a linked project's Git state: each file's status, drawn as its
 * state image, and the branch after the project's name - `PROJECT_TREE_PANE::updateGitStatusIcons`
 * and `updateGitStatusIconMap` (kicad/project_tree_pane.cpp:2350-2565) - and the timer that keeps
 * the remote side fresh (`onGitSyncTimer`, :3213-3257).
 *
 * KiCad asks libgit2 for the working tree's status against HEAD (`GIT_STATUS_HANDLER::
 * ConvertStatus`) and then marks the CURRENT files that differ between HEAD and the remote
 * branch: AHEAD where local commits changed them, BEHIND where the remote did
 * (`LIBGIT_BACKEND::UpdateRemoteStatus`). Here HEAD is the last-synced commit's files (the link's)
 * with the commits not pushed yet laid over them, and the remote branch is what the last remote
 * check found; the rest is the same comparison, file by file, by git's blob id.
 */
import type { GitLink } from './github_project.js';

/** `KIGIT_COMMON::GIT_STATUS` (common/git/kicad_git_common.h:73-84), in its order. */
export type GitFileStatus =
  | 'UNTRACKED'
  | 'CURRENT'
  | 'MODIFIED'
  | 'ADDED'
  | 'DELETED'
  | 'BEHIND'
  | 'AHEAD'
  | 'CONFLICTED'
  | 'IGNORED';

/**
 * The state image of each status (`PROJECT_TREE::LoadIcons`, kicad/project_tree.cpp:147-158), as
 * vendored under bitmaps_png's `manager/`. UNTRACKED and IGNORED are a blank bitmap upstream: null.
 */
export const GIT_STATE_BITMAP: Readonly<Record<GitFileStatus, string | null>> = {
  UNTRACKED: null,
  CURRENT: 'git_good_check',
  MODIFIED: 'git_modified',
  ADDED: 'git_add',
  DELETED: 'git_delete',
  BEHIND: 'git_out_of_date',
  AHEAD: 'git_changed_ahead',
  CONFLICTED: 'git_conflict',
  IGNORED: null,
};

/** A file's blob id by its path in the project. */
export type BlobMap = ReadonlyMap<string, string>;

/** The link's own record of the synced commit's files, when it carries one. */
export function syncedFiles(link: Pick<GitLink, 'files'>): BlobMap | null {
  return link.files ? new Map(Object.entries(link.files)) : null;
}

/**
 * HEAD: the synced commit's files with every commit not pushed yet laid over them, in order - and
 * the paths those commits changed, which is what makes a file AHEAD.
 */
export function headFiles(
  synced: BlobMap,
  pending: GitLink['pending'],
): { head: Map<string, string>; ahead: Set<string> } {
  const head = new Map(synced);
  for (const c of pending ?? [])
    for (const ch of c.changes) {
      if (ch.sha === null) head.delete(ch.path);
      else head.set(ch.path, ch.sha);
    }
  const ahead = new Set<string>();
  for (const p of new Set([...synced.keys(), ...head.keys()]))
    if (synced.get(p) !== head.get(p)) ahead.add(p);
  return { head, ahead };
}

/**
 * Each synced file's status, KiCad's way:
 *
 *  - not in HEAD: ADDED (libgit2's WT_NEW, which ConvertStatus makes ADDED; nothing here is ever
 *    UNTRACKED, and IGNORED files - outside what syncs - are not listed, as git status does not
 *    list them without INCLUDE_IGNORED);
 *  - different from HEAD: MODIFIED;
 *  - as HEAD: CURRENT, then AHEAD where a commit not pushed yet changed it, else BEHIND where the
 *    remote branch changed it since the synced commit.
 *
 * And CONFLICTED where the file changed here - edited, or in a commit not pushed - AND on the
 * remote branch, differently: what Pull would refuse as a conflict. KiCad shows CONFLICTED only
 * for a merge that stopped on one, a state this model never enters (a pull that would conflict
 * changes nothing); the file it is about to collide on is the nearest thing, and the one worth
 * flagging. DELETED never shows: a deleted file has no row in the tree, upstream's either.
 *
 * `remote` is the remote branch's files from the last check, or null before there was one.
 */
export function gitFileStatuses(
  working: BlobMap,
  synced: BlobMap,
  pending: GitLink['pending'],
  remote: BlobMap | null,
): Map<string, GitFileStatus> {
  const { head, ahead } = headFiles(synced, pending);
  const remoteChanged = (p: string): boolean => remote !== null && remote.get(p) !== synced.get(p);
  const out = new Map<string, GitFileStatus>();
  for (const [path, sha] of working) {
    const h = head.get(path);
    const changedHere = h !== sha || ahead.has(path);
    if (changedHere && remoteChanged(path) && remote!.get(path) !== sha) {
      out.set(path, 'CONFLICTED');
      continue;
    }
    if (h === undefined) out.set(path, 'ADDED');
    else if (h !== sha) out.set(path, 'MODIFIED');
    else if (ahead.has(path)) out.set(path, 'AHEAD');
    else if (remoteChanged(path)) out.set(path, 'BEHIND');
    else out.set(path, 'CURRENT');
  }
  return out;
}

/**
 * KiCad's tree root reads `name.kicad_pro [branch]` once it knows the branch
 * (`updateGitStatusIcons`: `SetItemText( kid, filename + " [" + m_gitCurrentBranchName + "]" )`).
 */
export function rootLabelWithBranch(aLabel: string, aBranch: string | null | undefined): string {
  return aBranch ? `${aLabel} [${aBranch}]` : aLabel;
}

// --- the remote check ------------------------------------------------------------

/**
 * `onGitSyncTimer`'s schedule: once, 100 ms after the project is shown (`ReCreateTreePrj` starts
 * `m_gitSyncTimer` with 100), then again every `git.updatInterval` minutes - Preferences > Version
 * Control's "Remote update interval", 5 by default - and never again when that is 0
 * (`if( gitSettings.updatInterval > 0 ) m_gitSyncTimer.Start( ... )`).
 *
 * A browser tab that is not being looked at has no use for it, so a check that falls due while
 * the tab is hidden waits for it to be shown.
 */
export interface RemoteCheckDeps {
  intervalMinutes: number;
  check: () => Promise<void> | void;
  isVisible: () => boolean;
  /** Called with the listener to run when the tab is shown again; returns the unsubscribe. */
  onVisible: (aListener: () => void) => () => void;
  setTimer: (aRun: () => void, aMs: number) => unknown;
  clearTimer: (aHandle: unknown) => void;
}

/** `m_gitSyncTimer.Start( 100, wxTIMER_ONE_SHOT )` (kicad/project_tree_pane.cpp:798). */
export const FIRST_REMOTE_CHECK_MS = 100;

/** Start the schedule; returns the stop. */
export function startRemoteChecks(deps: RemoteCheckDeps): () => void {
  let timer: unknown = null;
  let due = false;
  let stopped = false;
  const fire = (): void => {
    timer = null;
    if (stopped) return;
    if (!deps.isVisible()) {
      due = true;
      return;
    }
    due = false;
    void Promise.resolve(deps.check()).catch(() => undefined);
    if (deps.intervalMinutes > 0) timer = deps.setTimer(fire, deps.intervalMinutes * 60_000);
  };
  const offVisible = deps.onVisible(() => {
    if (due && !stopped) fire();
  });
  timer = deps.setTimer(fire, FIRST_REMOTE_CHECK_MS);
  return () => {
    stopped = true;
    if (timer !== null) deps.clearTimer(timer);
    offVisible();
  };
}
