// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Unit menu's data, counterparts LIB_SYMBOL::GetUnitDisplayName and
 * GetUnplacedUnitsForSymbol: what a unit is called, and which units of a part
 * are not on the sheet yet.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  setSymbolUnit,
  symbolUnitCount,
  unitDisplayName,
  unitLetter,
  unplacedUnits,
} from '@ziroeda/eeschema/src/tools/symbol_unit.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

/** A four-unit part; unit 3 carries a name of its own. */
const LIB = `(symbol "Amp:LM324"
  (property "Reference" "U" (at 0 0 0))
  (property "Value" "LM324" (at 0 2 0))
  (symbol "LM324_1_1")
  (symbol "LM324_2_1")
  (symbol "LM324_3_1" (unit_name "Power"))
  (symbol "LM324_4_1"))`;

const place = (uuid: string, ref: string, unit: number, libId = 'Amp:LM324'): string => `
  (symbol (lib_id "${libId}") (at 0 0 0) (unit ${unit}) (uuid "${uuid}")
    (property "Reference" "${ref}" (at 0 0 0))
    (property "Value" "LM324" (at 0 2 0)))`;

const sch = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20231120) (lib_symbols ${LIB}) ${body})`));
const libs = (d: Schematic): Map<string, LibSymbol> =>
  new Map(d.libSymbols.map((l) => [l.libId, l]));

describe('naming a unit', () => {
  it('counts letters past Z the way sub-references do', () => {
    expect(unitLetter(1)).toBe('A');
    expect(unitLetter(4)).toBe('D');
    expect(unitLetter(26)).toBe('Z');
    expect(unitLetter(27)).toBe('AA');
  });

  it('prefers the library’s own name for the unit', () => {
    const d = sch(place('s0', 'U1', 1));
    const lib = libs(d).get('Amp:LM324');
    expect(unitDisplayName(lib, 3)).toBe('Power');
    expect(unitDisplayName(lib, 2)).toBe('B');
  });

  it('falls back to the letter with no library at all', () => {
    expect(unitDisplayName(undefined, 2)).toBe('B');
  });
});

describe('counting units', () => {
  it('is the number of distinct units the part defines', () => {
    const d = sch(place('s0', 'U1', 1));
    expect(symbolUnitCount(libs(d).get('Amp:LM324'))).toBe(4);
  });

  it('is one for a part with no units of its own', () => {
    expect(symbolUnitCount(undefined)).toBe(1);
  });
});

describe('which units are already placed', () => {
  it('leaves out the ones on the sheet', () => {
    const d = sch(`${place('s0', 'U1', 1)} ${place('s1', 'U1', 3)}`);
    expect([...unplacedUnits(d, 0, libs(d))].sort()).toEqual([2, 4]);
  });

  it('counts units by reference, which is what makes them one part', () => {
    // U2 is a different chip, so its unit 2 does not fill U1's.
    const d = sch(`${place('s0', 'U1', 1)} ${place('s1', 'U2', 2)}`);
    expect([...unplacedUnits(d, 0, libs(d))].sort()).toEqual([2, 3, 4]);
  });

  it('separates unannotated parts by library id', () => {
    // Every unannotated symbol is "U?", so the reference alone would collapse
    // two different parts into one. Upstream adds the library id in that case.
    const d = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols ${LIB}
        (symbol "Logic:74HC00"
          (property "Reference" "U" (at 0 0 0))
          (symbol "74HC00_1_1") (symbol "74HC00_2_1")))
        ${place('s0', 'U?', 1)}
        ${place('s1', 'U?', 2, 'Logic:74HC00')})`),
    );
    // The 74HC00's unit 2 must not count as the LM324's unit 2.
    expect([...unplacedUnits(d, 0, libs(d))].sort()).toEqual([2, 3, 4]);
  });

  it('is empty once every unit is down', () => {
    const d = sch(
      `${place('s0', 'U1', 1)} ${place('s1', 'U1', 2)} ${place('s2', 'U1', 3)} ${place('s3', 'U1', 4)}`,
    );
    expect(unplacedUnits(d, 0, libs(d)).size).toBe(0);
  });
});

describe('setting a unit', () => {
  it('changes that symbol only, and undoes', () => {
    const before = sch(`${place('s0', 'U1', 1)} ${place('s1', 'U1', 2)}`);
    const cmd = setSymbolUnit(0, 4);
    const after = cmd.apply(before);
    expect(after.symbols[0]!.unit).toBe(4);
    expect(after.symbols[1]!.unit).toBe(2);
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });
});
