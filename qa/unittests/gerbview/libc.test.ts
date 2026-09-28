// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The C library the gerbview readers stand on (`gerbview/libc.ts`): each
 * expectation is what glibc does, from the C standard's definition.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAR_PTR,
  FILE,
  isspace,
  LINE_BUFFER,
  StrPurge,
  strtodPrefix,
  strtol10,
} from '@ziroeda/gerbview/libc.js';

describe('fgets', () => {
  it('reads one line, keeping its newline', () => {
    const f = new FILE('G04 a*\nM02*\n');
    const b = new LINE_BUFFER();
    expect(f.fgets(b, 100)?.s).toBe('G04 a*\n');
    expect(f.fgets(b, 100)?.s).toBe('M02*\n');
    expect(f.fgets(b, 100)).toBe(null);
  });

  it('reads at most aSize - 1 characters, leaving room for the NUL', () => {
    // "reads in at most one less than size characters" - fgets(3).
    const f = new FILE('ABCDEFGH\n');
    const b = new LINE_BUFFER();
    expect(f.fgets(b, 5)?.s).toBe('ABCD');
    // and the rest of the line is the next read
    expect(f.fgets(b, 5)?.s).toBe('EFGH');
    expect(f.fgets(b, 5)?.s).toBe('\n');
  });

  it('returns a last line with no newline', () => {
    const f = new FILE('M02*');
    const b = new LINE_BUFFER();
    expect(f.fgets(b, 100)?.s).toBe('M02*');
  });
});

describe('strtod / strtol prefixes', () => {
  it('stops at the first character that cannot continue the number', () => {
    expect(strtodPrefix('3x4')).toStrictEqual({ value: 3, end: 1 });
    expect(strtodPrefix('-2.5B')).toStrictEqual({ value: -2.5, end: 4 });
    expect(strtol10('12X')).toStrictEqual({ value: 12, end: 2 });
  });

  it('converts nothing from a non-number', () => {
    expect(strtodPrefix('X1')).toBe(null);
  });
});

describe('StrPurge and isspace', () => {
  it('skips leading and cuts trailing whitespace', () => {
    const b = new LINE_BUFFER();
    b.s = '  %FSLAX46Y46*%\r\n';
    expect(StrPurge(new CHAR_PTR(b)).rest()).toBe('%FSLAX46Y46*%');
  });

  it('is the C locale set', () => {
    expect([' ', '\t', '\n', '\r', '\f', '\v'].every(isspace)).toBe(true);
    expect(isspace('\0')).toBe(false);
    expect(isspace('X')).toBe(false);
  });
});
