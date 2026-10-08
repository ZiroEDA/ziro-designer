// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The library half of SCH_IO_KICAD_SEXPR (sch_io_kicad_sexpr.cpp:1687-1980) and the file-backed
 * SCH_IO_KICAD_SEXPR_LIB_CACHE / SCH_IO_LIB_CACHE under it, on the mounted file system: a
 * .kicad_sym file or a folder of them, read, cached, reread when changed, and written back.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import {
  MEMORY_FILESYSTEM,
  wxDirEnumerate,
  wxFileExists,
  wxMountFileSystem,
  wxReadFileSync,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import {
  PropPowerSymsOnly,
  SCH_IO_KICAD_SEXPR,
} from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const DATA = resolve(__dirname, '../../data');
const bytes = (aRel: string) => new Uint8Array(readFileSync(resolve(DATA, aRel)));
const text = (aPath: string) => new TextDecoder().decode(wxReadFileSync(aPath)!);
const names = (
  aPlugin: SCH_IO_KICAD_SEXPR,
  aPath: string,
  aProps: ReadonlyMap<string, string> | null = null,
) => {
  const list: string[] = [];
  aPlugin.EnumerateSymbolLib(list, aPath, aProps);
  return list.sort();
};

let unmount: () => void = () => {};

beforeEach(() => {
  const fs = new MEMORY_FILESYSTEM();
  fs.Write('all.kicad_sym', bytes('eeschema/legacy/legacy_all.kicad_sym'));
  fs.Write('folder/R.kicad_sym', bytes('R.kicad_sym'));
  fs.Write('folder/C.kicad_sym', bytes('C.kicad_sym'));
  unmount = wxMountFileSystem('/libs', fs);
});
afterEach(() => unmount());

describe('a .kicad_sym file library', () => {
  it('enumerates its symbols, or only its power symbols when asked', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    expect(names(pi, '/libs/all.kicad_sym')).toEqual([
      'PWRTEST',
      'TESTPART',
      'TESTPART_ALT',
      'TESTPART_ALT2',
    ]);
    expect(names(pi, '/libs/all.kicad_sym', new Map([[PropPowerSymsOnly, '']]))).toEqual([
      'PWRTEST',
    ]);
  });

  it('a missing library is "not found"', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    expect(() => names(pi, '/libs/none.kicad_sym')).toThrow(
      "Library '/libs/none.kicad_sym' not found.",
    );
  });

  it('SaveSymbol adds the symbol and writes the file, which a fresh plugin reads back', () => {
    const pi = new SCH_IO_KICAD_SEXPR();
    const r = new SCH_IO_KICAD_SEXPR().LoadSymbol('/libs/folder/R.kicad_sym', 'R')!;
    const copy = LIB_SYMBOL.copyOf(r);

    pi.SaveSymbol('/libs/all.kicad_sym', copy);

    expect(text('/libs/all.kicad_sym')).toContain('(symbol "R"');
    expect(names(new SCH_IO_KICAD_SEXPR(), '/libs/all.kicad_sym')).toContain('R');
    expect(new SCH_IO_KICAD_SEXPR().LoadSymbol('/libs/all.kicad_sym', 'R')).not.toBeNull();
  });

  it('a buffered SaveSymbol does not write until SaveLibrary', () => {
    const pi = new SCH_IO_KICAD_SEXPR();
    const before = text('/libs/all.kicad_sym');
    const buffering = new Map([[SCH_IO_KICAD_SEXPR.PropBuffering, '']]);
    const r = LIB_SYMBOL.copyOf(
      new SCH_IO_KICAD_SEXPR().LoadSymbol('/libs/folder/R.kicad_sym', 'R')!,
    );

    pi.SaveSymbol('/libs/all.kicad_sym', r, buffering);
    expect(text('/libs/all.kicad_sym')).toBe(before);

    pi.SaveLibrary('/libs/all.kicad_sym');
    expect(text('/libs/all.kicad_sym')).toContain('(symbol "R"');
  });

  it('the file is written root symbols first, then derived ones, each by name', () => {
    const pi = new SCH_IO_KICAD_SEXPR();
    const r = LIB_SYMBOL.copyOf(
      new SCH_IO_KICAD_SEXPR().LoadSymbol('/libs/folder/R.kicad_sym', 'R')!,
    );

    r.SetName('ZZ');
    pi.SaveSymbol('/libs/all.kicad_sym', r);

    const order = [...text('/libs/all.kicad_sym').matchAll(/^\t\(symbol "([^"]+)"/gm)].map(
      (m) => m[1],
    );
    expect(order).toEqual(['PWRTEST', 'TESTPART', 'ZZ', 'TESTPART_ALT', 'TESTPART_ALT2']);
  });

  it('deleting a root symbol deletes the symbols derived from it', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    pi.DeleteSymbol('/libs/all.kicad_sym', 'TESTPART');

    expect(names(new SCH_IO_KICAD_SEXPR(), '/libs/all.kicad_sym')).toEqual(['PWRTEST']);
  });

  it('deleting a derived symbol deletes only it; deleting a missing one throws', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    pi.DeleteSymbol('/libs/all.kicad_sym', 'TESTPART_ALT');
    expect(names(new SCH_IO_KICAD_SEXPR(), '/libs/all.kicad_sym')).toEqual([
      'PWRTEST',
      'TESTPART',
      'TESTPART_ALT2',
    ]);

    expect(() => pi.DeleteSymbol('/libs/all.kicad_sym', 'NOPE')).toThrow(
      'library all.kicad_sym does not contain a symbol named NOPE',
    );
  });

  it('a library changed on disk is reread on the next call; an unchanged one is not', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    names(pi, '/libs/all.kicad_sym');
    const hash = pi.GetModifyHash();
    names(pi, '/libs/all.kicad_sym');
    expect(pi.GetModifyHash()).toBe(hash);

    wxWriteFileSync('/libs/all.kicad_sym', bytes('GND.kicad_sym'));

    expect(names(pi, '/libs/all.kicad_sym')).toEqual(['GND']);
    expect(pi.GetModifyHash()).toBeGreaterThan(hash);
  });

  it('LoadSymbol finds a name written with the old {slash} escape', () => {
    const pi = new SCH_IO_KICAD_SEXPR();
    const r = LIB_SYMBOL.copyOf(
      new SCH_IO_KICAD_SEXPR().LoadSymbol('/libs/folder/R.kicad_sym', 'R')!,
    );
    r.SetName('A/B');
    pi.SaveSymbol('/libs/all.kicad_sym', r);

    expect(new SCH_IO_KICAD_SEXPR().LoadSymbol('/libs/all.kicad_sym', 'A{slash}B')?.GetName()).toBe(
      'A/B',
    );
    expect(new SCH_IO_KICAD_SEXPR().LoadSymbol('/libs/all.kicad_sym', 'nope')).toBeNull();
  });

  it('a library with a symbol that failed to parse loads the rest and refuses to be saved', () => {
    const all = text('/libs/all.kicad_sym');
    // A symbol whose last child is a token the parser does not know: the symbol is skipped.
    const broken = `${all.slice(0, all.lastIndexOf(')'))}(symbol "BAD" (bogus_token 1)))`;
    wxWriteFileSync('/libs/broken.kicad_sym', new TextEncoder().encode(broken));
    const pi = new SCH_IO_KICAD_SEXPR();

    expect(() => names(pi, '/libs/broken.kicad_sym')).toThrow(IO_ERROR);
    expect(() => names(pi, '/libs/broken.kicad_sym')).not.toThrow();
    expect(names(pi, '/libs/broken.kicad_sym')).toEqual([
      'PWRTEST',
      'TESTPART',
      'TESTPART_ALT',
      'TESTPART_ALT2',
    ]);
    expect(() => pi.SaveLibrary('/libs/broken.kicad_sym')).toThrow(
      /because it had a parse error during loading/,
    );
  });

  it('CreateLibrary makes an empty library and refuses an existing one; DeleteLibrary removes it', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    pi.CreateLibrary('/libs/new.kicad_sym');
    expect(text('/libs/new.kicad_sym').startsWith('(kicad_symbol_lib')).toBe(true);
    expect(names(new SCH_IO_KICAD_SEXPR(), '/libs/new.kicad_sym')).toEqual([]);

    expect(() => pi.CreateLibrary('/libs/new.kicad_sym')).toThrow(
      "Symbol library file '/libs/new.kicad_sym' already exists.",
    );

    expect(pi.DeleteLibrary('/libs/new.kicad_sym')).toBe(true);
    expect(wxFileExists('/libs/new.kicad_sym')).toBe(false);
    expect(pi.DeleteLibrary('/libs/new.kicad_sym')).toBe(false);
  });

  it('CanReadLibrary wants an existing .kicad_sym, or a folder holding one', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    expect(pi.CanReadLibrary('/libs/all.kicad_sym')).toBe(true);
    expect(pi.CanReadLibrary('/libs/none.kicad_sym')).toBe(false);
    expect(pi.CanReadLibrary('/libs/folder')).toBe(true);
    wxWriteFileSync('/libs/other/readme.txt', new Uint8Array());
    expect(pi.CanReadLibrary('/libs/other')).toBe(false);
  });
});

describe('a folder library', () => {
  it('reads every .kicad_sym in the folder', () => {
    expect(names(new SCH_IO_KICAD_SEXPR(), '/libs/folder')).toEqual(['C', 'R']);
  });

  it('a new symbol is written to a file of its own; the others stay in theirs', () => {
    const pi = new SCH_IO_KICAD_SEXPR();
    const gnd = new SCH_IO_KICAD_SEXPR();
    wxWriteFileSync('/libs/gnd.kicad_sym', bytes('GND.kicad_sym'));
    const g = LIB_SYMBOL.copyOf(gnd.LoadSymbol('/libs/gnd.kicad_sym', 'GND')!);
    g.SetName('G/1');

    pi.SaveSymbol('/libs/folder', g);

    const files = (wxDirEnumerate('/libs/folder') ?? []).map((e) => e.name).sort();
    expect(files).toEqual(['C.kicad_sym', 'G{slash}1.kicad_sym', 'R.kicad_sym']);
    expect(text('/libs/folder/R.kicad_sym')).not.toContain('"G/1"');
    expect(text('/libs/folder/G{slash}1.kicad_sym')).toContain('(symbol "G/1"');
    expect(names(new SCH_IO_KICAD_SEXPR(), '/libs/folder')).toEqual(['C', 'G/1', 'R']);
  });

  it('deleting the last symbol of a file removes the file', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    pi.DeleteSymbol('/libs/folder', 'C');

    expect(wxFileExists('/libs/folder/C.kicad_sym')).toBe(false);
    expect(wxFileExists('/libs/folder/R.kicad_sym')).toBe(true);
    expect(names(new SCH_IO_KICAD_SEXPR(), '/libs/folder')).toEqual(['R']);
  });

  it('a file added to the folder is picked up on the next call', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    expect(names(pi, '/libs/folder')).toEqual(['C', 'R']);
    wxWriteFileSync('/libs/folder/GND.kicad_sym', bytes('GND.kicad_sym'));
    expect(names(pi, '/libs/folder')).toEqual(['C', 'GND', 'R']);
  });
  it('a file rewritten with the same bytes still counts as a change: its time moved', () => {
    const pi = new SCH_IO_KICAD_SEXPR();

    names(pi, '/libs/folder');
    const hash = pi.GetModifyHash();
    wxWriteFileSync('/libs/folder/R.kicad_sym', bytes('R.kicad_sym'));
    names(pi, '/libs/folder');

    expect(pi.GetModifyHash()).toBeGreaterThan(hash);
  });
});
