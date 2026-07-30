// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Crash recovery, getting the open project out of a broken session
 * (designer/src/home/recovery.ts).
 *
 * Unlike Archive Project, recovery deliberately ignores KiCad's archive
 * allow-list: when the app has already failed, the user's stray files are not
 * ours to judge.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  getRecoverySnapshot,
  recoveryZip,
  setRecoveryProvider,
  type RecoverySnapshot,
} from '@ziroeda/designer/src/home/recovery.js';
import { expandArchive } from '@ziroeda/designer/src/home/project_archiver.js';
import { inArchiveAllowList } from '@ziroeda/designer/src/home/project_tree.js';

const dec = new TextDecoder();

/** Zip a snapshot and read it back through the app's own unzip path. */
function roundTrip(snap: RecoverySnapshot): Record<string, Uint8Array> {
  const entries = expandArchive(recoveryZip(snap));
  if (!entries) throw new Error('recoveryZip produced an unreadable archive');
  return Object.fromEntries(entries.map((e) => [e.name, e.data]));
}

/** One entry, failing loudly rather than yielding `undefined`. */
function at(zip: Record<string, Uint8Array>, name: string): Uint8Array {
  const data = zip[name];
  if (!data) throw new Error(`missing "${name}", archive holds: ${Object.keys(zip).join(', ')}`);
  return data;
}

afterEach(() => setRecoveryProvider(null));

describe('getRecoverySnapshot', () => {
  it('returns null when nothing is registered', () => {
    expect(getRecoverySnapshot()).toBeNull();
  });

  it('returns null for an empty project rather than offering an empty zip', () => {
    setRecoveryProvider(() => ({ name: 'proj', files: [] }));
    expect(getRecoverySnapshot()).toBeNull();
  });

  it('survives a provider that throws, the app is already broken', () => {
    setRecoveryProvider(() => {
      throw new Error('state is gone');
    });
    expect(getRecoverySnapshot()).toBeNull();
  });

  it('returns the live project', () => {
    setRecoveryProvider(() => ({ name: 'proj', files: [{ name: 'proj/a.kicad_sch', text: 'x' }] }));
    expect(getRecoverySnapshot()?.name).toBe('proj');
  });
});

describe('recoveryZip', () => {
  it('writes text files under a folder named for the project', () => {
    const zip = roundTrip({
      name: 'board',
      files: [{ name: 'board/board.kicad_sch', text: '(kicad_sch)' }],
    });
    expect(Object.keys(zip)).toEqual(['board/board.kicad_sch']);
    expect(dec.decode(at(zip, 'board/board.kicad_sch'))).toBe('(kicad_sch)');
  });

  it('preserves binary files byte-exactly', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const zip = roundTrip({ name: 'board', files: [{ name: 'board/plot.png', text: '', bytes }] });
    expect([...at(zip, 'board/plot.png')]).toEqual([...bytes]);
  });

  it('re-nests nested paths relative to the project folder', () => {
    const zip = roundTrip({
      name: 'board',
      files: [{ name: 'board/sub/page2.kicad_sch', text: 'p2' }],
    });
    expect(Object.keys(zip)).toEqual(['board/sub/page2.kicad_sch']);
  });

  it('includes files the archive allow-list would drop', () => {
    // A .bak is not archivable, but on a crash path it may be the only copy.
    expect(inArchiveAllowList('board/board.kicad_sch.bak')).toBe(false);
    const zip = roundTrip({
      name: 'board',
      files: [
        { name: 'board/board.kicad_sch', text: 'live' },
        { name: 'board/board.kicad_sch.bak', text: 'backup' },
      ],
    });
    expect(Object.keys(zip).sort()).toEqual(['board/board.kicad_sch', 'board/board.kicad_sch.bak']);
  });

  it('skips genuinely empty files', () => {
    // Asserted against the raw archive: a zip stores entry names uncompressed
    // in each local header, and expandArchive would drop empties on read anyway.
    const raw = recoveryZip({
      name: 'board',
      files: [
        { name: 'board/board.kicad_sch', text: 'x' },
        { name: 'board/empty.txt', text: '' },
      ],
    });
    expect(dec.decode(raw)).not.toContain('empty.txt');
  });

  it('prefers bytes over text when a file carries both', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const zip = roundTrip({ name: 'b', files: [{ name: 'b/f.bin', text: 'ignored', bytes }] });
    expect([...at(zip, 'b/f.bin')]).toEqual([1, 2, 3]);
  });
});
