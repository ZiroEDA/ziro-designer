// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/eda_doc.ts`: `GetAssociatedDocument`, branch by branch as
 * `common/eda_doc.cpp` takes them - a URL, a `kicad-embed://` name, a file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { GetAssociatedDocument, ResolveUriByEnvVars } from '@ziroeda/common/eda_doc.js';
import { EMBEDDED_FILE, EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { MEMORY_FILESYSTEM, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';

const DOCS = '/docs-test';
let unmount: () => void;
let errors: string[];
let opened: string[];
let blobs: Blob[];

beforeEach(() => {
  const fs = new MEMORY_FILESYSTEM();
  fs.Write('sheet.pdf', new Uint8Array([1, 2, 3]));
  fs.Write('notes.xyz', new Uint8Array([4]));
  fs.Write('sub/page.HTML', new Uint8Array([5]));
  unmount = wxMountFileSystem(DOCS, fs);

  errors = [];
  SetErrorPresenter((aText) => errors.push(aText));
  opened = [];
  vi.spyOn(window, 'open').mockImplementation((aUrl) => {
    opened.push(String(aUrl));
    return null;
  });
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((aBlob) => {
    blobs.push(aBlob as Blob);
    return `blob:doc-${blobs.length}`;
  });
});

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
});

/** A project resolving `${ID}` to "BAT54". */
const project = (aToken: { value: string }): boolean => {
  if (aToken.value !== 'ID') return false;
  aToken.value = 'BAT54';
  return true;
};

describe('GetAssociatedDocument', () => {
  it('launches the browser for a URL, after resolving text variables', () => {
    expect(GetAssociatedDocument('https://example.com/${ID}.pdf', project)).toBe(true);
    expect(opened).toEqual(['https://example.com/BAT54.pdf']);
    expect(errors).toEqual([]);
  });

  it('takes any scheme but kicad-embed as a URL, whatever its case', () => {
    expect(GetAssociatedDocument('Mailto:x@example.com', null)).toBe(true);
    expect(opened).toEqual(['Mailto:x@example.com']);
  });

  it('opens a file in a tab, typed by its extension (a PDF is OpenPDF)', () => {
    expect(GetAssociatedDocument(`${DOCS}/sheet.pdf`, null)).toBe(true);
    expect(opened).toEqual(['blob:doc-1']);
    expect(blobs[0]!.type).toBe('application/pdf');
    expect(blobs[0]!.size).toBe(3);
  });

  it('turns backslashes into slashes and resolves "..", and the extension is case-blind', () => {
    expect(GetAssociatedDocument('\\docs-test\\x\\..\\sub\\page.HTML', null)).toBe(true);
    expect(blobs[0]!.type).toBe('text/html');
  });

  it('reports a file that is not there, by the name it was given', () => {
    expect(GetAssociatedDocument(`${DOCS}/missing.pdf`, null)).toBe(false);
    expect(errors).toEqual([`Documentation file '${DOCS}/missing.pdf' not found.`]);
    expect(opened).toEqual([]);
  });

  it('reports a file of a type it cannot open', () => {
    expect(GetAssociatedDocument(`${DOCS}/notes.xyz`, null)).toBe(false);
    expect(errors).toEqual([`Unknown MIME type for documentation file '${DOCS}/notes.xyz'`]);
    expect(opened).toEqual([]);
  });

  it('opens a kicad-embed:// file from the first stack that has it', () => {
    const empty = new EMBEDDED_FILES();
    const files = new EMBEDDED_FILES();
    const f = new EMBEDDED_FILE();
    f.name = 'ds.pdf';
    f.decompressedData = new Uint8Array([7, 7]);
    f.data_hash = 'eda0doc';
    files.AddFile(f);

    expect(GetAssociatedDocument('kicad-embed://ds.pdf', null, [empty, files])).toBe(true);
    expect(blobs[0]!.type).toBe('application/pdf');
    expect(blobs[0]!.size).toBe(2);
  });

  it('is false, silently, for a kicad-embed name it cannot place', () => {
    const files = new EMBEDDED_FILES();

    expect(GetAssociatedDocument('kicad-embed://ds.pdf', null)).toBe(false);
    expect(GetAssociatedDocument('kicad-embed:ds.pdf', null, [files])).toBe(false);
    expect(GetAssociatedDocument('kicad-embed://none.pdf', null, [files])).toBe(false);
    expect(errors).toEqual([]);
    expect(opened).toEqual([]);
  });
});

describe('ResolveUriByEnvVars', () => {
  it('expands text variables, then environment ones', () => {
    expect(ResolveUriByEnvVars('${ID}/x', project)).toBe('BAT54/x');
    expect(ResolveUriByEnvVars('${ID}/x', null)).toBe('${ID}/x');
  });
});
