// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Empty property values are valid": before 20250318 a file wrote an empty
 * property as "~", and the parser reads it back as "" (m_requiredVersion <
 * 20250318, sch_io_kicad_sexpr_parser.cpp:1105 for library symbols, :2327
 * for schematic fields). From 20250318 on, "~" is a literal tilde.
 */
import { parse } from '@ziroeda/sexpr/index.js';
import { serialize } from '@ziroeda/sexpr/serializer.js';
import { readSchematic, readSymbolLib, writeSchematic } from '@ziroeda/eeschema';
import { describe, expect, it } from 'vitest';

const sheet = (version: number): string => `(kicad_sch (version ${version}) (generator eeschema)
  (lib_symbols)
  (symbol (lib_id "Device:R") (at 0 0 0) (unit 1)
    (property "Reference" "R1" (at 0 0 0))
    (property "Value" "~" (at 0 0 0))
    (uuid "aaaaaaaa-0000-4000-8000-000000000001")))`;

const value = (version: number): string | undefined =>
  readSchematic(parse(sheet(version))).symbols[0]!.fields.find((f) => f.key === 'Value')?.value;

describe('m_requiredVersion and "~"', () => {
  it('a schematic field "~" is empty before 20250318, a tilde after', () => {
    expect(value(20231120)).toBe('');
    expect(value(20250317)).toBe('');
    expect(value(20250318)).toBe('~');
  });

  it('a library symbol property follows the library file version', () => {
    const lib = (v: number) =>
      readSymbolLib(
        parse(`(kicad_symbol_lib (version ${v}) (generator kicad_symbol_editor)
          (symbol "R" (property "Reference" "R" (at 0 0 0)) (property "Datasheet" "~" (at 0 0 0))))`),
      )[0]!.properties.find((p) => p.key === 'Datasheet')?.value;
    expect(lib(20241209)).toBe('');
    expect(lib(20250318)).toBe('~');
  });

  it('saving an old file does not rewrite an untouched "~"', () => {
    // The writer keeps the file's version, so it re-reads its nodes at that
    // version: the field is unchanged and its bytes stay.
    const doc = readSchematic(parse(sheet(20231120)));
    expect(serialize(writeSchematic(doc))).toContain('(property "Value" "~"');
  });
});
