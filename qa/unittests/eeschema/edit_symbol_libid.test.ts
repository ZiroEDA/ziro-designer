// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Symbol Library Links, counterpart dialog_edit_symbols_libid.cpp: the
 * grouped grid, what counts as an orphan, what a valid library id is, and the
 * two things that travel with a re-pointed link.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  applyLibIdChanges,
  isValidLibId,
  libIdChangeCommand,
  libItemName,
  libNickname,
  orphanCandidates,
  symbolLibIdRows,
} from '@ziroeda/eeschema/src/tools/edit_symbol_libid.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

/**
 * Two symbols on Device:R, one on Device:C, and one on a library that is not
 * loaded at all — the orphan.
 */
const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (symbol "R_0_1"))
    (symbol "Device:C" (property "Reference" "C" (at 0 0 0)) (symbol "C_0_1")))
  (symbol (lib_id "Device:R") (at 10 10 0) (unit 1) (uuid "s0")
    (property "Reference" "R1" (at 10 10 0))
    (property "Value" "10k" (at 10 12 0)))
  (symbol (lib_id "Device:R") (at 20 10 0) (unit 1) (uuid "s1")
    (property "Reference" "R2" (at 20 10 0))
    (property "Value" "R" (at 20 12 0)))
  (symbol (lib_id "Device:C") (at 30 10 0) (unit 1) (uuid "s2")
    (property "Reference" "C1" (at 30 10 0))
    (property "Value" "100n" (at 30 12 0)))
  (symbol (lib_id "OldLib:R" ) (at 40 10 0) (unit 1) (uuid "s3")
    (property "Reference" "R3" (at 40 10 0))
    (property "Value" "1k" (at 40 12 0))))`;

const doc = (): Schematic => readSchematic(parse(SCH));
/** The loaded libraries: the two Device parts, and nothing called OldLib. */
const libs = (): Map<string, LibSymbol> =>
  new Map(
    doc()
      .libSymbols.filter((l) => l.libId !== 'OldLib:R')
      .map((l) => [l.libId, l]),
  );
const rowFor = (id: string) => symbolLibIdRows(doc(), libs()).find((r) => r.current === id);

describe('library ids', () => {
  it('splits a nickname from an item name', () => {
    expect(libNickname('Device:R_Small')).toBe('Device');
    expect(libItemName('Device:R_Small')).toBe('R_Small');
    expect(libNickname('R')).toBe('');
    expect(libItemName('R')).toBe('R');
  });

  it('needs both halves to be valid', () => {
    expect(isValidLibId('Device:R')).toBe(true);
    expect(isValidLibId('R')).toBe(false);
    expect(isValidLibId('Device:')).toBe(false);
    expect(isValidLibId(':R')).toBe(false);
    expect(isValidLibId('')).toBe(false);
  });

  it('rejects a second colon, because the first one is the separator', () => {
    expect(isValidLibId('Device:Sub:R')).toBe(false);
  });

  it('rejects the forbidden characters', () => {
    expect(isValidLibId('Device:R<1>')).toBe(false);
    expect(isValidLibId('Dev"ice:R')).toBe(false);
    expect(isValidLibId('Device:R\\1')).toBe(false);
    // …and allows what is merely unusual.
    expect(isValidLibId('My Lib:R 0805')).toBe(true);
  });
});

describe('the grid', () => {
  it('is one row per library id, sorted', () => {
    const rows = symbolLibIdRows(doc(), libs());
    expect(rows.map((r) => r.current)).toEqual(['Device:C', 'Device:R', 'OldLib:R']);
  });

  it('lists every reference using that id', () => {
    expect(rowFor('Device:R')?.references).toEqual(['R1', 'R2']);
  });

  it('marks a symbol with no library part behind it', () => {
    expect(rowFor('OldLib:R')?.orphan).toBe(true);
    expect(rowFor('Device:R')?.orphan).toBe(false);
  });

  it('lists a reference once even when it appears twice', () => {
    // Two placements sharing a reference (a hierarchy shows one per instance).
    const twice = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (symbol (lib_id "Device:R") (at 0 0 0) (unit 1) (uuid "a")
          (property "Reference" "R1" (at 0 0 0)))
        (symbol (lib_id "Device:R") (at 5 0 0) (unit 1) (uuid "b")
          (property "Reference" "R1" (at 5 0 0))))`),
    );
    const rows = symbolLibIdRows(twice, new Map());
    expect(rows[0]?.references).toEqual(['R1']);
    expect(rows[0]?.symbolIds).toHaveLength(2);
  });
});

describe('mapping orphans', () => {
  it('finds a part of the same name in another library', () => {
    expect(orphanCandidates('OldLib:R', libs())).toEqual(['Device:R']);
  });

  it('offers every candidate when the name is ambiguous', () => {
    const many = new Map(libs());
    const r = many.get('Device:R')!;
    many.set('Spare:R', { ...r, libId: 'Spare:R' });
    expect(orphanCandidates('OldLib:R', many)).toEqual(['Device:R', 'Spare:R']);
  });

  it('finds nothing when the part really is gone', () => {
    expect(orphanCandidates('OldLib:Widget', libs())).toEqual([]);
  });
});

describe('applying a change', () => {
  it('re-points every symbol on that library id', () => {
    const r = applyLibIdChanges(doc(), libs(), new Map([['OldLib:R', 'Device:R']]));
    expect(r.changed).toBe(1);
    expect(r.doc.symbols[3]!.libId).toBe('Device:R');
    // The others are untouched.
    expect(r.doc.symbols[2]!.libId).toBe('Device:C');
  });

  it('carries a Value that was only echoing the part name', () => {
    // R2's value is "R", which is what Device:R is called — it follows the
    // rename. R1's "10k" is a real value and does not.
    const withSpare = new Map(libs());
    const r0 = withSpare.get('Device:R')!;
    withSpare.set('Device:R_Small', { ...r0, libId: 'Device:R_Small' });
    const r = applyLibIdChanges(doc(), withSpare, new Map([['Device:R', 'Device:R_Small']]));
    const value = (i: number) => r.doc.symbols[i]!.fields.find((f) => f.key === 'Value')?.value;
    expect(value(1)).toBe('R_Small');
    expect(value(0)).toBe('10k');
  });

  it('takes the new part into the schematic and drops the part nothing uses', () => {
    const r = applyLibIdChanges(doc(), libs(), new Map([['Device:C', 'Device:R']]));
    expect(r.doc.libSymbols.some((l) => l.libId === 'Device:R')).toBe(true);
    expect(r.doc.libSymbols.some((l) => l.libId === 'Device:C')).toBe(false);
  });

  it('refuses an invalid identifier and says so', () => {
    const before = doc();
    const r = applyLibIdChanges(before, libs(), new Map([['Device:R', 'nonsense']]));
    expect(r.doc).toBe(before);
    expect(r.errors[0]).toContain('is not valid');
  });

  it('refuses an id that resolves to no library part', () => {
    const before = doc();
    const r = applyLibIdChanges(before, libs(), new Map([['Device:R', 'Ghost:R']]));
    expect(r.doc).toBe(before);
    expect(r.errors[0]).toContain('Error loading symbol R from library Ghost');
  });

  it('ignores a row left blank or unchanged', () => {
    const before = doc();
    expect(
      applyLibIdChanges(
        before,
        libs(),
        new Map([
          ['Device:R', ''],
          ['Device:C', 'Device:C'],
        ]),
      ).doc,
    ).toBe(before);
  });

  it('undoes cleanly', () => {
    const before = doc();
    const { command } = libIdChangeCommand(before, libs(), new Map([['OldLib:R', 'Device:R']]));
    const after = command!.apply(before);
    expect(command!.invert(before).apply(after)).toEqual(before);
  });

  it('gives a null command when nothing was re-pointed', () => {
    expect(libIdChangeCommand(doc(), libs(), new Map()).command).toBeNull();
  });
});
