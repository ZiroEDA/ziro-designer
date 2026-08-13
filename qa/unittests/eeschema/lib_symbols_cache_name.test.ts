// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A sheet's `lib_symbols` cache is keyed by the placement's `lib_id`.
 *
 * A `.kicad_sym` does not repeat its own nickname, so a definition read from a
 * library is named bare: `(symbol "R" …)`. The placement that uses it records
 * `lib_id "Device:R"`. Writing the definition's node through unchanged produced
 * a sheet whose cache said "R" while its placements asked for "Device:R", and
 * on the next open every symbol placed that session resolved to nothing: no
 * body, no pins, only the Reference and Value text that lives on the placement
 * itself. Placing the same part again re-cached it under the right name, and
 * both copies appeared at once.
 *
 * KiCad writes the map key — `SCH_IO_KICAD_SEXPR::saveSymbol` over
 * `SCH_SCREEN::m_libSymbols`, which is the full LIB_ID. Its own files read
 * `(symbol "complex_hierarchy:+12V" (symbol "+12V_0_1" …))`: the nickname is on
 * the entry, never on the units inside it.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import {
  placeSymbol,
  readSchematic,
  readSymbolLib,
  schSymbolLibraryName,
  writeSchematic,
} from '@ziroeda/eeschema';

const EMPTY = `(kicad_sch (version 20250114) (generator "eeschema")
  (uuid "0f1e2d3c-0000-0000-0000-000000000000") (lib_symbols)
  (sheet_instances (path "/" (page "1"))))
`;

/** A library file, named the way a real one is: no nickname on the symbol. */
const LIB = `(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor")
  (symbol "R"
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "R_0_1"
      (rectangle (start -1 2.5) (end 1 -2.5)
        (stroke (width 0.254) (type default)) (fill (type none))))
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27))))))))
`;

/** The chooser hands over a definition whose libId carries the nickname. */
function libraryPart(): ReturnType<typeof readSymbolLib>[number] {
  const raw = readSymbolLib(parse(LIB))[0]!;
  return { ...raw, libId: `Device:${raw.libId}` };
}

const savedAndReopened = (
  place: (doc: ReturnType<typeof readSchematic>) => ReturnType<typeof readSchematic>,
) => {
  const doc = place(readSchematic(parse(EMPTY)));
  const text = serialize(writeSchematic(doc));
  return { text, back: readSchematic(parse(text)) };
};

describe('a symbol placed from a library, saved and reopened', () => {
  it('still finds its definition', () => {
    const lib = libraryPart();
    const { back } = savedAndReopened((d) => placeSymbol(lib, { x: 100, y: 100 }).apply(d));

    const cache = new Map(back.libSymbols.map((l) => [l.libId, l]));
    const wanted = schSymbolLibraryName(back.symbols[0]!);
    expect(wanted).toBe('Device:R');
    expect(cache.get(wanted), 'the placement resolves to a definition').toBeDefined();
  });

  it('keeps the body and the pins, not just the text', () => {
    // The visible symptom: the reference and value survive because they are on
    // the placement, so a broken cache looks like a symbol that vanished and
    // left its labels behind.
    const lib = libraryPart();
    const { back } = savedAndReopened((d) => placeSymbol(lib, { x: 100, y: 100 }).apply(d));

    const def = back.libSymbols.find((l) => l.libId === schSymbolLibraryName(back.symbols[0]!))!;
    expect(def.units.reduce((n, u) => n + u.pins.length, 0)).toBe(1);
    expect(def.units.some((u) => (u.graphics?.length ?? 0) > 0)).toBe(true);
  });

  it('writes the nickname on the entry and not on the units inside it', () => {
    const lib = libraryPart();
    const { text } = savedAndReopened((d) => placeSymbol(lib, { x: 100, y: 100 }).apply(d));

    expect(text).toContain('(symbol "Device:R"');
    // The unit sub-symbols keep the bare stem, as KiCad's own files do.
    expect(text).toContain('(symbol "R_0_1"');
    expect(text).not.toContain('(symbol "Device:R_0_1"');
  });

  it('leaves a definition that is already named correctly untouched', () => {
    // A project-local symbol is cached under the name it already has; renaming
    // it would rewrite files that were never wrong.
    const raw = readSymbolLib(parse(LIB))[0]!;
    const already = { ...raw, libId: 'R' };
    const { text } = savedAndReopened((d) => placeSymbol(already, { x: 10, y: 10 }).apply(d));
    expect(text).toContain('(symbol "R"');
    expect(text).not.toContain('(symbol "R:R"');
  });
});
