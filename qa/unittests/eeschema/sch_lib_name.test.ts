// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `(lib_name …)` on a placement: the key its definition is filed under.
 *
 * A sheet can file a symbol under a name that is not its library id, and KiCad
 * writes one whenever a cached definition has diverged from the library, so a
 * single lib_id can have two definitions in one sheet. Every lookup goes through
 * `SCH_SYMBOL::GetSchSymbolLibraryName`, which prefers it.
 *
 * We ignored the token, so the lookup by id found nothing and the placement
 * resolved to no definition: no body, and no pins. It vanished from the canvas
 * and stopped contributing to the netlist, with nothing reported. That is the
 * state one symbol of KiCad's own multichannel mixer demo was in.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, schSymbolLibraryName, writeSchematic } from '@ziroeda/eeschema';

const sheet = (extra: string): string => `(kicad_sch
  (version 20250114)
  (generator "eeschema")
  (uuid "0f1e2d3c-0000-0000-0000-000000000000")
  (lib_symbols
    (symbol "Bare-Name"
      (symbol "Bare-Name_0_1"
        (rectangle (start -2.54 2.54) (end 2.54 -2.54)
          (stroke (width 0.254) (type default)) (fill (type background))))
      (symbol "Bare-Name_1_1"
        (pin passive line (at -5.08 0 0) (length 2.54)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))))
  )
  (symbol
    ${extra}
    (lib_id "someproject:Bare-Name")
    (at 100 100 0)
    (unit 1)
    (uuid "11111111-2222-3333-4444-555555555555")
    (property "Reference" "J1" (at 100 95 0) (effects (font (size 1.27 1.27))))
  )
)
`;

describe('a placement whose definition is filed under another name', () => {
  it('resolves through lib_name, not the lib id', () => {
    const doc = readSchematic(parse(sheet('(lib_name "Bare-Name")')));
    const sym = doc.symbols[0]!;

    expect(sym.libId).toBe('someproject:Bare-Name');
    expect(sym.libName).toBe('Bare-Name');
    expect(schSymbolLibraryName(sym)).toBe('Bare-Name');

    // Which is the difference between a symbol and an empty space: looked up by
    // id there is nothing, and the placement has no body and no pins.
    const byId = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    expect(byId.get(sym.libId)).toBeUndefined();
    const resolved = byId.get(schSymbolLibraryName(sym));
    expect(resolved).toBeDefined();
    expect(resolved!.units.reduce((n, u) => n + u.pins.length, 0)).toBe(1);
  });

  it('falls back to the lib id when there is no lib_name', () => {
    const doc = readSchematic(parse(sheet('')));
    expect(doc.symbols[0]!.libName).toBeUndefined();
    expect(schSymbolLibraryName(doc.symbols[0]!)).toBe('someproject:Bare-Name');
  });

  it('ignores a lib_name that only repeats the id', () => {
    // KiCad writes it only when it differs; carrying a redundant one would make
    // every round trip add a token the source did not have.
    const doc = readSchematic(parse(sheet('(lib_name "someproject:Bare-Name")')));
    expect(doc.symbols[0]!.libName).toBeUndefined();
  });

  it('survives a save', () => {
    const src = sheet('(lib_name "Bare-Name")');
    const out = serialize(writeSchematic(readSchematic(parse(src))));
    expect(out).toContain('(lib_name "Bare-Name")');
    // And still resolves after the round trip.
    const again = readSchematic(parse(out));
    expect(schSymbolLibraryName(again.symbols[0]!)).toBe('Bare-Name');
  });
});
