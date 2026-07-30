// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Embedded-files summary: names/types and the embed-fonts flag list from the
 * schematic's lossless AST (the zstd data blobs pass through untouched).
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { listEmbeddedFiles } from '@ziroeda/eeschema/src/tools/embedded.js';

const SCH = `(kicad_sch (version 20250114) (generator "eeschema")
  (uuid "00000000-0000-0000-0000-000000000000")
  (embedded_fonts yes)
  (embedded_files
    (file (name "logo.png") (type other)
      (data |KLUv/QBYbQAAEAAA|)
      (checksum "abc123"))
    (file (name "notes.pdf") (type datasheet)
      (data |KLUv/QBYbQAAEAAB|)
      (checksum "def456"))))`;

describe('listEmbeddedFiles', () => {
  it('lists names, kicad-embed references, types and the fonts flag', () => {
    const doc = readSchematic(parse(SCH));
    const { files, embedFonts } = listEmbeddedFiles(doc);
    expect(embedFonts).toBe(true);
    expect(files).toEqual([
      { name: 'logo.png', reference: 'kicad-embed://logo.png', type: 'other' },
      { name: 'notes.pdf', reference: 'kicad-embed://notes.pdf', type: 'datasheet' },
    ]);
  });

  it('returns empty for schematics without an embedded_files section', () => {
    const doc = readSchematic(parse('(kicad_sch (version 20250114) (generator "x"))'));
    expect(listEmbeddedFiles(doc)).toEqual({ files: [], embedFonts: false });
  });

  it('preserves the section byte-for-byte through a round-trip', () => {
    const doc = readSchematic(parse(SCH));
    const out = serializeSchematic(doc);
    expect(out).toContain('embedded_files');
    expect(out).toContain('KLUv/QBYbQAAEAAA');
    expect(out).toContain('(checksum "def456")');
    expect(out).toContain('embedded_fonts');
  });
});

// ----- write side (EMBEDDED_FILES::AddFile / RemoveFile / CompressAndEncode) --

import {
  addEmbeddedFile,
  compressAndEncode,
  decompressAndDecode,
  embeddedFileType,
  getEmbeddedFileData,
  removeEmbeddedFile,
  setEmbedFonts,
  EMBEDDED_FILES_SEED,
} from '@ziroeda/eeschema/src/tools/embedded.js';
import { mmh3HashToStringV1 } from '@ziroeda/kimath';

const BLANK = '(kicad_sch (version 20250114) (generator "eeschema") (uuid "u1"))';

describe('embedded file write side', () => {
  const payload = new TextEncoder().encode('The quick brown fox jumps over the lazy dog\n');

  it('compresses to a zstd frame with an MMH3 checksum, and round-trips', async () => {
    const { data, checksum } = await compressAndEncode(payload);
    // zstd magic 28 B5 2F FD encodes to base64 'KLUv/…', like KiCad's files.
    expect(data.startsWith('KLUv/')).toBe(true);
    expect(checksum).toMatch(/^[0-9A-F]{32}$/);
    const back = await decompressAndDecode(data, checksum);
    expect(back.isValid).toBe(true);
    expect([...back.bytes]).toEqual([...payload]);
  });

  it('flags checksum mismatches but still returns the bytes', async () => {
    const { data } = await compressAndEncode(payload);
    const back = await decompressAndDecode(data, '0'.repeat(32));
    expect(back.isValid).toBe(false);
    expect(back.bytes.length).toBe(payload.length);
  });

  it('accepts the pre-fix V1 tail hash (files saved before the alignment fix)', async () => {
    // 12-byte tail: V1 pads len to a full block and the tail bytes vanish.
    const twelve = new TextEncoder().encode('abcdefghijkl');
    const { data } = await compressAndEncode(twelve);
    const v1 = mmh3HashToStringV1(twelve, EMBEDDED_FILES_SEED);
    const back = await decompressAndDecode(data, v1);
    expect(back.isValid).toBe(true);
  });

  it('detects file types from the extension like AddFile', () => {
    expect(embeddedFileType('a.step')).toBe('model');
    expect(embeddedFileType('B.WRL')).toBe('model');
    expect(embeddedFileType('font.woff2')).toBe('font');
    expect(embeddedFileType('ds.pdf')).toBe('datasheet');
    expect(embeddedFileType('sheet.kicad_wks')).toBe('worksheet');
    expect(embeddedFileType('logo.png')).toBe('other');
  });

  it('adds files name-sorted, wraps base64 at 76 columns between | delimiters', async () => {
    let doc = readSchematic(parse(BLANK));
    doc = await addEmbeddedFile(doc, 'zzz.txt', payload);
    doc = await addEmbeddedFile(doc, 'aaa.pdf', payload);
    const { files } = listEmbeddedFiles(doc);
    expect(files.map((f) => f.name)).toEqual(['aaa.pdf', 'zzz.txt']);
    expect(files[0]!.type).toBe('datasheet');

    const out = serializeSchematic(doc);
    const m = out.match(/\(data ([^)]*)\)/);
    expect(m).not.toBeNull();
    const atoms = m![1]!.split(/\s+/).filter(Boolean);
    expect(atoms[0]!.startsWith('|')).toBe(true);
    expect(atoms[atoms.length - 1]!.endsWith('|')).toBe(true);
    for (const a of atoms) expect(a.replace(/\|/g, '').length).toBeLessThanOrEqual(76);
  });

  it('reads back exactly what was added, and overwrites same-name entries', async () => {
    let doc = readSchematic(parse(BLANK));
    doc = await addEmbeddedFile(doc, 'note.txt', payload);
    const v2 = new TextEncoder().encode('replaced');
    doc = await addEmbeddedFile(doc, 'note.txt', v2);
    expect(listEmbeddedFiles(doc).files).toHaveLength(1);
    const got = await getEmbeddedFileData(doc, 'note.txt');
    expect(got?.isValid).toBe(true);
    expect(new TextDecoder().decode(got!.bytes)).toBe('replaced');
  });

  it('removes files, dropping the section when the last one goes', async () => {
    let doc = readSchematic(parse(BLANK));
    doc = await addEmbeddedFile(doc, 'a.txt', payload);
    doc = await addEmbeddedFile(doc, 'b.txt', payload);
    doc = removeEmbeddedFile(doc, 'a.txt');
    expect(listEmbeddedFiles(doc).files.map((f) => f.name)).toEqual(['b.txt']);
    doc = removeEmbeddedFile(doc, 'b.txt');
    expect(serializeSchematic(doc)).not.toContain('embedded_files');
  });

  it('sets the embedded_fonts flag, created before embedded_files when missing', async () => {
    let doc = readSchematic(parse(BLANK));
    doc = await addEmbeddedFile(doc, 'f.ttf', payload);
    doc = setEmbedFonts(doc, true);
    const out = serializeSchematic(doc);
    expect(out.indexOf('embedded_fonts')).toBeGreaterThan(-1);
    expect(out.indexOf('embedded_fonts')).toBeLessThan(out.indexOf('embedded_files'));
    expect(listEmbeddedFiles(doc).embedFonts).toBe(true);
    expect(listEmbeddedFiles(setEmbedFonts(doc, false)).embedFonts).toBe(false);
  });

  it('decodes a KiCad-style multi-line | data block', async () => {
    // Build a >76-char base64 payload and re-read it through the parser.
    const big = new Uint8Array(300).map((_, i) => i % 251);
    let doc = readSchematic(parse(BLANK));
    doc = await addEmbeddedFile(doc, 'big.bin', big);
    const reparsed = readSchematic(parse(serializeSchematic(doc)));
    const got = await getEmbeddedFileData(reparsed, 'big.bin');
    expect(got?.isValid).toBe(true);
    expect([...got!.bytes]).toEqual([...big]);
  });
});
