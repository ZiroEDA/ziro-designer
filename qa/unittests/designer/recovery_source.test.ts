// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The crash-recovery snapshot.
 *
 * What this closes: `recovery.ts` asks the app to register a provider, and
 * **nothing ever did**. The module was written, tested and never connected, so
 * the crash screen always found no project — and rather than a dead button,
 * that path renders *"No open project was in memory, so nothing was lost"* and
 * offers a reload. A user who crashed mid-edit was told the opposite of the truth and
 * invited to discard their work.
 */
import { describe, it, expect } from 'vitest';
import { recoverySnapshotFrom } from '@ziroeda/designer/src/home/recovery_source.js';
import { recoveryZip } from '@ziroeda/designer/src/home/recovery.js';
import { expandArchive } from '@ziroeda/designer/src/home/project_archiver.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const opened = [
  { name: 'proj/a.kicad_sch', text: 'A from storage' },
  { name: 'proj/b.kicad_sch', text: 'B from storage' },
];

describe('what ends up in the zip', () => {
  it('is null when nothing is open, so "nothing was lost" can be true', () => {
    expect(recoverySnapshotFrom('proj', null, new Map(), new Map())).toBeNull();
    expect(recoverySnapshotFrom('proj', [], new Map(), new Map())).toBeNull();
  });

  it('takes the opened project when there is nothing newer', () => {
    const snap = recoverySnapshotFrom('proj', opened, new Map(), new Map())!;
    expect(snap.name).toBe('proj');
    expect(snap.files.map((f) => f.name).sort()).toEqual(['proj/a.kicad_sch', 'proj/b.kicad_sch']);
  });

  it('prefers a live edit over what storage had', () => {
    const snap = recoverySnapshotFrom(
      'proj',
      opened,
      new Map([['proj/a.kicad_sch', 'A edited']]),
      new Map(),
    )!;
    expect(snap.files.find((f) => f.name === 'proj/a.kicad_sch')!.text).toBe('A edited');
  });

  it('prefers the autosave queue over everything', () => {
    // Queued bytes were serialised on the edit and are only waiting for the
    // 1.2 s debounce — they are the newest form of the file. Taking them last
    // would hand the user a zip a minute older than the work they just lost.
    const snap = recoverySnapshotFrom(
      'proj',
      opened,
      new Map([['proj/a.kicad_sch', 'A edited']]),
      new Map([['proj/a.kicad_sch', enc.encode('A queued')]]),
    )!;
    const file = snap.files.find((f) => f.name === 'proj/a.kicad_sch')!;
    expect(dec.decode(file.bytes!)).toBe('A queued');
  });

  it('keeps files that only exist in the queue', () => {
    const snap = recoverySnapshotFrom(
      'proj',
      opened,
      new Map(),
      new Map([['proj/c.kicad_sch', enc.encode('C queued')]]),
    )!;
    expect(snap.files.map((f) => f.name)).toContain('proj/c.kicad_sch');
  });

  it('falls back to a name when the project has none', () => {
    expect(recoverySnapshotFrom(null, opened, new Map(), new Map())!.name).toBe('project');
  });
});

describe('the zip the user actually gets', () => {
  it('carries the newest content of every file', () => {
    const snap = recoverySnapshotFrom(
      'proj',
      opened,
      new Map([['proj/b.kicad_sch', 'B edited']]),
      new Map([['proj/a.kicad_sch', enc.encode('A queued')]]),
    )!;
    const entries = expandArchive(recoveryZip(snap));
    if (!entries) throw new Error('recoveryZip produced an unreadable archive');
    expect(entries).toHaveLength(2);
    const byTail = (tail: string): string =>
      dec.decode(entries.find((e) => e.name.endsWith(tail))!.data);
    expect(byTail('a.kicad_sch')).toBe('A queued');
    expect(byTail('b.kicad_sch')).toBe('B edited');
  });
});
