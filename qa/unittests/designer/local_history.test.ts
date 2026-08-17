// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Local History's model - what a snapshot is and how the pane reads one.
 *
 * Upstream keeps a git repository and lets libgit2 answer these questions, so
 * the interesting tests here are the ones where we had to reimplement something
 * git was doing: what counts as changed, what a snapshot costs once files are
 * shared between them, and the Time column's oddly specific thresholds.
 */
import { describe, expect, it } from 'vitest';
import {
  changedAgainst,
  isEmptySnapshot,
  kindOfTitle,
  relativeTime,
  snapshotTitle,
  snapshotTooltip,
  snapshotsToEvict,
  storedBytes,
  type Snapshot,
  type SnapshotFile,
} from '@ziroeda/designer/src/home/local_history.js';

const f = (name: string, hash: string, size = 100): SnapshotFile => ({ name, hash, size });

const snap = (id: string, at: number, files: SnapshotFile[], changed: string[] = []): Snapshot => ({
  id,
  at,
  title: 'Save',
  kind: 'save',
  files,
  changed,
});

describe('the Time column (LOCAL_HISTORY_PANE::RefreshHistory)', () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const ago = (ms: number): string => relativeTime(now - ms, now);

  it('says "Moments ago" under a minute', () => {
    //   if( elapsed.GetMinutes() < 1 ) timeStr = _( "Moments ago" );
    expect(ago(0)).toBe('Moments ago');
    expect(ago(59_000)).toBe('Moments ago');
  });

  it('counts minutes from one', () => {
    expect(ago(60_000)).toBe('1 minutes ago');
    expect(ago(45 * 60_000)).toBe('45 minutes ago');
  });

  it('keeps counting minutes to ninety, not to sixty', () => {
    // `else if( elapsed.GetMinutes() < 91 )`. The 91 is not a typo for 90 and
    // not a rounding artefact: it means the list reads "90 minutes ago" and
    // never "1 hours ago". Tidying it to 60 would make our list disagree with a
    // desktop KiCad open beside it.
    expect(ago(89 * 60_000)).toBe('89 minutes ago');
    expect(ago(90 * 60_000)).toBe('90 minutes ago');
    expect(ago(91 * 60_000)).toBe('1 hours ago');
  });

  it('counts hours up to a day', () => {
    expect(ago(23 * 3_600_000)).toBe('23 hours ago');
  });

  it('falls back to the locale date and time past a day', () => {
    //   else timeStr = info.date.Format();  // the locale default
    const out = ago(25 * 3_600_000);
    expect(out).not.toMatch(/ago/);
    expect(out).toBe(new Date(now - 25 * 3_600_000).toLocaleString());
  });

  it('does not go negative on a snapshot stamped in the future', () => {
    // Two machines syncing a project can hand us one; a row reading "-3 minutes
    // ago" is worse than one reading "Moments ago".
    expect(relativeTime(now + 60_000, now)).toBe('Moments ago');
  });
});

describe('what counts as changed', () => {
  it('names a file whose content moved', () => {
    expect(changedAgainst([f('a.kicad_sch', 'h1')], [f('a.kicad_sch', 'h2')])).toEqual([
      'a.kicad_sch',
    ]);
  });

  it('says nothing when nothing moved', () => {
    const files = [f('a.kicad_sch', 'h1'), f('b.kicad_pcb', 'h2')];
    expect(changedAgainst(files, files)).toEqual([]);
  });

  it('names an added file', () => {
    expect(changedAgainst([f('a', 'h1')], [f('a', 'h1'), f('b', 'h2')])).toEqual(['b']);
  });

  it('names a deleted file, which git reports too', () => {
    expect(changedAgainst([f('a', 'h1'), f('b', 'h2')], [f('a', 'h1')])).toEqual(['b']);
  });

  it('names both halves of a rename, as a git diff does', () => {
    // git reports a rename as a delete and an add unless asked to detect it,
    // and the pane shows what git reports.
    expect(changedAgainst([f('old', 'h1')], [f('new', 'h1')])).toEqual(['new', 'old']);
  });

  it('treats the first snapshot as all-new', () => {
    expect(changedAgainst(undefined, [f('a', 'h1'), f('b', 'h2')])).toEqual(['a', 'b']);
  });

  it('is what makes a snapshot empty', () => {
    expect(isEmptySnapshot(snap('1', 0, [f('a', 'h1')], []))).toBe(true);
    expect(isEmptySnapshot(snap('1', 0, [f('a', 'h1')], ['a']))).toBe(false);
  });
});

describe('what the history costs', () => {
  it('counts a file shared between snapshots once', () => {
    // The property that makes snapshotting every save affordable: a board
    // project is mostly footprints and 3D models that do not change while you
    // edit a schematic.
    const shared = f('big.step', 'h1', 1000);
    const history = [
      snap('1', 1, [shared, f('a.kicad_sch', 'ha', 10)]),
      snap('2', 2, [shared, f('a.kicad_sch', 'hb', 10)]),
      snap('3', 3, [shared, f('a.kicad_sch', 'hc', 10)]),
    ];
    // 1000 once, plus three distinct versions of the schematic.
    expect(storedBytes(history)).toBe(1030);
  });

  it('counts nothing for an empty history', () => {
    expect(storedBytes([])).toBe(0);
  });
});

describe('evicting to a size limit (EnforceSizeLimit)', () => {
  const big = (id: string, at: number, hash: string): Snapshot =>
    snap(id, at, [f('board.kicad_pcb', hash, 100)]);

  it('drops nothing when the history already fits', () => {
    expect(snapshotsToEvict([big('1', 1, 'a'), big('2', 2, 'b')], 1000)).toEqual([]);
  });

  it('drops the oldest first, and only as many as it must', () => {
    const history = [big('1', 1, 'a'), big('2', 2, 'b'), big('3', 3, 'c')];
    // 300 stored; a 200 budget needs one gone, not two.
    expect(snapshotsToEvict(history, 200)).toEqual(['1']);
  });

  it('never drops the newest, whatever the budget', () => {
    // A history whose limit is smaller than one snapshot should hold one
    // snapshot, not none. Deleting the last copy of the current state to
    // satisfy a size cap is the one outcome nobody wants from a feature called
    // history.
    const history = [big('1', 1, 'a'), big('2', 2, 'b')];
    expect(snapshotsToEvict(history, 0)).toEqual(['1']);
    expect(snapshotsToEvict([big('1', 1, 'a')], 0)).toEqual([]);
  });

  it('measures what survives, not what goes', () => {
    // Dropping a snapshot frees only the hashes no surviving snapshot still
    // references. Here every snapshot shares one 1000-byte model, so evicting
    // the oldest frees its 10 bytes and nothing else - and no amount of
    // eviction gets under 1000.
    const shared = f('big.step', 'shared', 1000);
    const history = [
      snap('1', 1, [shared, f('a', 'h1', 10)]),
      snap('2', 2, [shared, f('a', 'h2', 10)]),
      snap('3', 3, [shared, f('a', 'h3', 10)]),
    ];
    // Everything evictable goes and it still does not fit; the newest stays.
    expect(snapshotsToEvict(history, 500)).toEqual(['1', '2']);
  });
});

describe('the title, which the pane reads a colour back out of', () => {
  it('starts an autosave with the word the pane greys on', () => {
    //   if( info.summary.StartsWith( wxS( "Autosave" ) ) ) ...GRAYTEXT
    expect(snapshotTitle('autosave')).toMatch(/^Autosave/);
    expect(kindOfTitle(snapshotTitle('autosave', 'board.kicad_pcb'))).toBe('autosave');
  });

  it('starts a backup with the word the pane tints blue', () => {
    //   else if( info.summary.StartsWith( wxS( "Backup" ) ) ) ...wxColour( 80, 120, 200 )
    expect(snapshotTitle('backup')).toMatch(/^Backup/);
    expect(kindOfTitle(snapshotTitle('backup'))).toBe('backup');
  });

  it('leaves a manual save in the normal foreground', () => {
    expect(kindOfTitle(snapshotTitle('save'))).toBe('save');
    expect(kindOfTitle('Anything else entirely')).toBe('save');
  });
});

describe('the hover tooltip', () => {
  it('is the message, the changed files, then a local ISO stamp', () => {
    //   wxString tip = info.message;
    //   ... tip << wxS( "\n" ) << info.date.FormatISOCombined();
    const at = new Date(2026, 7, 17, 9, 5, 3).getTime();
    const s: Snapshot = { ...snap('1', at, [f('a', 'h1')], ['a']), title: 'Save: a' };
    expect(snapshotTooltip(s)).toBe('Save: a\na\n2026-08-17T09:05:03');
  });

  it('uses local time, not UTC', () => {
    // FormatISOCombined is local. toISOString() is UTC and would read out of
    // step with the relative time on the same row.
    const at = new Date(2026, 0, 2, 23, 30, 0).getTime();
    const out = snapshotTooltip(snap('1', at, []));
    expect(out).toContain('2026-01-02T23:30:00');
  });
});
