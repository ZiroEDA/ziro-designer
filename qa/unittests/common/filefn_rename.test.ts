// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxRenameFile` and the recursive `wxRemoveDir` over the in-memory mounts:
 * the two calls `FOOTPRINT_IMPORT_RECONCILER` publishes a `.pretty` with.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MEMORY_FILESYSTEM,
  wxDirExists,
  wxFileExists,
  wxMountFileSystem,
  wxReadFileSync,
  wxRemoveDirTree,
  wxRenameFile,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (p: string): string => new TextDecoder().decode(wxReadFileSync(p) ?? new Uint8Array());

let unmount: Array<() => void> = [];
const mount = (prefix: string): MEMORY_FILESYSTEM => {
  const fs = new MEMORY_FILESYSTEM();
  unmount.push(wxMountFileSystem(prefix, fs));
  return fs;
};
afterEach(() => {
  for (const u of unmount) u();
  unmount = [];
});

describe('wxRenameFile', () => {
  it('renames a file', () => {
    mount('/rn');
    wxWriteFileSync('/rn/a.txt', bytes('A'));
    expect(wxRenameFile('/rn/a.txt', '/rn/b.txt')).toBe(true);
    expect(wxFileExists('/rn/a.txt')).toBe(false);
    expect(text('/rn/b.txt')).toBe('A');
  });

  it('renames a directory with everything under it, and nothing beside it', () => {
    mount('/rn');
    wxWriteFileSync('/rn/x.pretty.tmp/one.kicad_mod', bytes('1'));
    wxWriteFileSync('/rn/x.pretty.tmp/sub/two.kicad_mod', bytes('2'));
    wxWriteFileSync('/rn/x.pretty.tmpfile', bytes('not under it'));
    expect(wxRenameFile('/rn/x.pretty.tmp', '/rn/x.pretty', false)).toBe(true);
    expect(wxDirExists('/rn/x.pretty.tmp')).toBe(false);
    expect(text('/rn/x.pretty/one.kicad_mod')).toBe('1');
    expect(text('/rn/x.pretty/sub/two.kicad_mod')).toBe('2');
    expect(wxFileExists('/rn/x.pretty.tmpfile')).toBe(true);
  });

  it('refuses to overwrite unless told to', () => {
    mount('/rn');
    wxWriteFileSync('/rn/a.txt', bytes('A'));
    wxWriteFileSync('/rn/b.txt', bytes('B'));
    expect(wxRenameFile('/rn/a.txt', '/rn/b.txt', false)).toBe(false);
    expect(text('/rn/a.txt')).toBe('A');
    expect(text('/rn/b.txt')).toBe('B');
    expect(wxRenameFile('/rn/a.txt', '/rn/b.txt', true)).toBe(true);
    expect(text('/rn/b.txt')).toBe('A');
  });

  it('overwrites by default, as wxRenameFile does', () => {
    mount('/rn');
    wxWriteFileSync('/rn/a.txt', bytes('A'));
    wxWriteFileSync('/rn/b.txt', bytes('B'));
    expect(wxRenameFile('/rn/a.txt', '/rn/b.txt')).toBe(true);
  });

  it('fails for a path that is not there', () => {
    mount('/rn');
    expect(wxRenameFile('/rn/none', '/rn/other')).toBe(false);
  });

  it('fails across two mounts', () => {
    mount('/rn1');
    mount('/rn2');
    wxWriteFileSync('/rn1/a.txt', bytes('A'));
    expect(wxRenameFile('/rn1/a.txt', '/rn2/a.txt')).toBe(false);
    expect(wxFileExists('/rn1/a.txt')).toBe(true);
  });
});

describe('wxRemoveDirTree', () => {
  it('removes a directory and what is under it, only', () => {
    mount('/rn');
    wxWriteFileSync('/rn/d/one', bytes('1'));
    wxWriteFileSync('/rn/d/sub/two', bytes('2'));
    wxWriteFileSync('/rn/dd/three', bytes('3'));
    expect(wxRemoveDirTree('/rn/d')).toBe(true);
    expect(wxDirExists('/rn/d')).toBe(false);
    expect(wxFileExists('/rn/dd/three')).toBe(true);
  });

  it('is false for a directory that is not there, and never removes the mount point', () => {
    mount('/rn');
    wxWriteFileSync('/rn/keep', bytes('k'));
    expect(wxRemoveDirTree('/rn/nothing')).toBe(false);
    expect(wxRemoveDirTree('/rn')).toBe(false);
    expect(wxFileExists('/rn/keep')).toBe(true);
  });
});
