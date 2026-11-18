// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The project tree's Git status for a linked project (designer/src/github/git_status.ts) against
 * KiCad's: `GIT_STATUS_HANDLER::ConvertStatus` then `LIBGIT_BACKEND::UpdateRemoteStatus`
 * (common/git), the root's `name [branch]` (kicad/project_tree_pane.cpp:2400), and
 * `onGitSyncTimer`'s schedule (:3213-3257). Expectations are the KiCad enum's names, written here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_REMOTE_CHECK_MS,
  GIT_STATE_BITMAP,
  gitFileStatuses,
  headFiles,
  rootLabelWithBranch,
  startRemoteChecks,
} from '@ziroeda/designer/src/github/git_status.js';
import type { PendingCommit } from '@ziroeda/designer/src/github/github_project.js';
import { bitmapNames } from '@ziroeda/bitmaps_png';

const m = (o: Record<string, string>) => new Map(Object.entries(o));
const SYNCED = m({ 'a.kicad_sch': 'A1', 'b.kicad_pcb': 'B1', 'c.txt': 'C1', 'gone.txt': 'G1' });

describe('each file, as KiCad converts its git status', () => {
  it('as the synced commit: CURRENT; edited: MODIFIED; new: ADDED (WT_NEW is ADDED upstream)', () => {
    const s = gitFileStatuses(
      m({ 'a.kicad_sch': 'A1', 'b.kicad_pcb': 'B2', 'new.kicad_sch': 'N1' }),
      SYNCED,
      undefined,
      null,
    );
    expect(Object.fromEntries(s)).toEqual({
      'a.kicad_sch': 'CURRENT',
      'b.kicad_pcb': 'MODIFIED',
      'new.kicad_sch': 'ADDED',
    });
  });

  it('a CURRENT file the remote changed (or deleted) is BEHIND; nothing is BEHIND before a check', () => {
    const working = m({ 'a.kicad_sch': 'A1', 'c.txt': 'C1' });
    const remote = m({ 'a.kicad_sch': 'A9', 'b.kicad_pcb': 'B1', 'gone.txt': 'G1' });
    expect(Object.fromEntries(gitFileStatuses(working, SYNCED, undefined, remote))).toEqual({
      'a.kicad_sch': 'BEHIND',
      'c.txt': 'BEHIND',
    });
    expect(Object.fromEntries(gitFileStatuses(working, SYNCED, undefined, null))).toEqual({
      'a.kicad_sch': 'CURRENT',
      'c.txt': 'CURRENT',
    });
  });

  it('changed here and on the remote, differently: CONFLICTED; the same change is no conflict', () => {
    const remote = m({ 'a.kicad_sch': 'A9', 'b.kicad_pcb': 'B2', 'c.txt': 'C1', 'gone.txt': 'G1' });
    const s = gitFileStatuses(
      m({ 'a.kicad_sch': 'A2', 'b.kicad_pcb': 'B2' }),
      SYNCED,
      undefined,
      remote,
    );
    expect(Object.fromEntries(s)).toEqual({
      'a.kicad_sch': 'CONFLICTED',
      'b.kicad_pcb': 'MODIFIED',
    });
  });

  it('as HEAD after a commit not pushed yet: AHEAD; edited again since: MODIFIED against HEAD', () => {
    const pending: PendingCommit[] = [
      {
        message: 'x',
        author: { login: 'octo' },
        at: '2026-11-19T00:00:00Z',
        changes: [
          { path: 'a.kicad_sch', sha: 'A2' },
          { path: 'b.kicad_pcb', sha: 'B2' },
        ],
      },
    ];
    const s = gitFileStatuses(
      m({ 'a.kicad_sch': 'A2', 'b.kicad_pcb': 'B3', 'c.txt': 'C1' }),
      SYNCED,
      pending,
      null,
    );
    expect(Object.fromEntries(s)).toEqual({
      'a.kicad_sch': 'AHEAD',
      'b.kicad_pcb': 'MODIFIED',
      'c.txt': 'CURRENT',
    });
  });

  it('HEAD is the synced files with each pending commit laid over them, deletions too', () => {
    const { head, ahead } = headFiles(SYNCED, [
      { message: '1', author: { login: 'o' }, at: '', changes: [{ path: 'c.txt', sha: null }] },
      { message: '2', author: { login: 'o' }, at: '', changes: [{ path: 'n.txt', sha: 'N' }] },
    ]);
    expect(head.has('c.txt')).toBe(false);
    expect(head.get('n.txt')).toBe('N');
    expect([...ahead].sort()).toEqual(['c.txt', 'n.txt']);
  });

  it('draws the state images KiCad registers, a blank for UNTRACKED and IGNORED', () => {
    expect(GIT_STATE_BITMAP).toEqual({
      UNTRACKED: null,
      CURRENT: 'git_good_check',
      MODIFIED: 'git_modified',
      ADDED: 'git_add',
      DELETED: 'git_delete',
      BEHIND: 'git_out_of_date',
      AHEAD: 'git_changed_ahead',
      CONFLICTED: 'git_conflict',
      IGNORED: null,
    });
    const vendored = new Set(bitmapNames('manager'));
    for (const name of Object.values(GIT_STATE_BITMAP))
      if (name) expect(vendored.has(`${name}.svg`), name).toBe(true);
  });
});

describe("the root's label", () => {
  it('is name.kicad_pro [branch] once there is a branch', () => {
    expect(rootLabelWithBranch('amp.kicad_pro', 'main')).toBe('amp.kicad_pro [main]');
    expect(rootLabelWithBranch('amp.kicad_pro', null)).toBe('amp.kicad_pro');
    expect(rootLabelWithBranch('amp.kicad_pro', '')).toBe('amp.kicad_pro');
  });
});

describe('the remote check schedule (onGitSyncTimer)', () => {
  afterEach(() => vi.useRealTimers());

  function run(intervalMinutes: number, visible = { now: true }) {
    vi.useFakeTimers();
    let checks = 0;
    const listeners: (() => void)[] = [];
    const stop = startRemoteChecks({
      intervalMinutes,
      check: () => {
        checks += 1;
      },
      isVisible: () => visible.now,
      onVisible: (l) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      },
      setTimer: (f, ms) => setTimeout(f, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    return { stop, checks: () => checks, show: () => listeners.forEach((l) => l()) };
  }

  it('checks 100 ms after the project opens, then every interval minutes', () => {
    const r = run(5);
    expect(FIRST_REMOTE_CHECK_MS).toBe(100);
    vi.advanceTimersByTime(99);
    expect(r.checks()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(r.checks()).toBe(1);
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(r.checks()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(r.checks()).toBe(2);
    r.stop();
    vi.advanceTimersByTime(60 * 60_000);
    expect(r.checks()).toBe(2);
  });

  it('an interval of 0 checks once and never again', () => {
    const r = run(0);
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(r.checks()).toBe(1);
    r.stop();
  });

  it('a check due while the tab is hidden waits for it to be shown', () => {
    const visible = { now: false };
    const r = run(5, visible);
    vi.advanceTimersByTime(10 * 60_000);
    expect(r.checks()).toBe(0);
    visible.now = true;
    r.show();
    expect(r.checks()).toBe(1);
    r.stop();
  });
});
