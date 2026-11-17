// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Archive / Unarchive: allow-list filtering, project-folder re-nesting, and
 * byte-exact zip round-trips (the compatibility promise applies to archives
 * too, what goes in must come out identical).
 */
import { describe, it, expect } from 'vitest';
import {
  archiveEntries,
  zipArchive,
  expandArchive,
  relPath,
} from '@ziroeda/designer/src/home/project_archiver.js';
import type { PickedHomeFile } from '@ziroeda/designer/src/home/files.js';

const enc = new TextEncoder();
const f = (name: string, text = 'x'): PickedHomeFile => ({ name, text, bytes: enc.encode(text) });

describe('relPath', () => {
  it('strips the project folder and normalises separators', () => {
    expect(relPath('proj/proj.kicad_sch')).toBe('proj.kicad_sch');
    expect(relPath('proj/sub/a.kicad_sch')).toBe('sub/a.kicad_sch');
    expect(relPath('proj\\sub\\a.kicad_sch')).toBe('sub/a.kicad_sch');
    expect(relPath('loose.kicad_pcb')).toBe('loose.kicad_pcb');
  });
});

describe('archiveEntries', () => {
  it('re-nests allow-listed files under the project name and skips the rest', () => {
    const entries = archiveEntries(
      [f('proj/proj.kicad_pcb'), f('proj/out/top.gbr'), f('proj/node_modules/x.tgz')],
      'proj',
    );
    expect(Object.keys(entries!)).toEqual(['proj/proj.kicad_pcb', 'proj/out/top.gbr']);
  });

  it('archives a file an editor saved, which carries its text and no bytes (blinky555, I-14)', () => {
    // App hands every saved file back as { name, text }; skipping those emptied the
    // archive of exactly the files that had been worked on.
    const pcb = '(kicad_pcb (version 20260206))\n';
    const entries = archiveEntries(
      [{ name: 'proj/proj.kicad_pcb', text: pcb }, f('proj/proj.kicad_pro', '{}')],
      'proj',
    );
    expect(Object.keys(entries!).sort()).toEqual(['proj/proj.kicad_pcb', 'proj/proj.kicad_pro']);
    expect(new TextDecoder().decode(entries!['proj/proj.kicad_pcb'])).toBe(pcb);
  });

  it('keeps the bytes as read when a file has them, not a re-encoding of its text', () => {
    const crlf = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]);
    const entries = archiveEntries([{ name: 'proj/notes.txt', text: 'a\n', bytes: crlf }], 'proj');
    expect(entries!['proj/notes.txt']).toEqual(crlf);
  });

  it('skips empty files and returns null when nothing qualifies', () => {
    expect(archiveEntries([{ name: 'proj/empty.kicad_sch', text: '' }], 'proj')).toBeNull();
    expect(archiveEntries([f('readme.docx')], 'proj')).toBeNull();
  });
});

describe('zip round-trip', () => {
  it('expandArchive(zipArchive(x)) is byte-exact', () => {
    const entries = archiveEntries([f('proj/proj.kicad_pcb', '(kicad_pcb)')], 'proj')!;
    const out = expandArchive(zipArchive(entries));
    expect(out).toHaveLength(1);
    expect(out![0]!.name).toBe('proj/proj.kicad_pcb');
    expect(new TextDecoder().decode(out![0]!.data)).toBe('(kicad_pcb)');
  });

  it('returns null for bytes that are not a zip', () => {
    expect(expandArchive(enc.encode('not a zip'))).toBeNull();
  });
});
