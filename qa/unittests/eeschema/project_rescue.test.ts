// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Project Rescue Helper's candidate finder.
 *
 * `RESCUE_SYMBOL_LIB_TABLE_CANDIDATE::FindRescues` (`project_rescue.cpp:344-436`)
 * is the whole of the decision: which of a schematic's symbols the library can
 * no longer be trusted to supply. Every arm of it is pinned here, including the
 * one that is live without a cache library.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema';
import { unescapeString } from '@ziroeda/common';
import {
  findRescues,
  pinsConflictWith,
  rescueActionDescription,
  rescueLibraryNickname,
  rescueLibraryFileName,
  rescuedDefinition,
  rescueDocumentCommand,
  repointSymbols,
  RESCUE_PIN_TESTS,
  type RescueSources,
} from '@ziroeda/eeschema/src/tools/project_rescue.js';
import type { LibSymbol, Schematic, SchSymbol } from '@ziroeda/eeschema/src/types.js';

const BODY = `
  (property "Reference" "R" (at 0 0 0))
  (property "Value" "R" (at 0 0 0))
  (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54)))
  (symbol "R_1_1"
    (pin passive line (at 0 3.81 270) (length 1.27)
      (name "~" (effects (font (size 1.27 1.27))))
      (number "1" (effects (font (size 1.27 1.27)))))
    (pin passive line (at 0 -3.81 90) (length 1.27)
      (name "~" (effects (font (size 1.27 1.27))))
      (number "2" (effects (font (size 1.27 1.27))))))`;

/** One symbol, named as it would be in a library file. */
const symbol = (name: string, body = BODY): LibSymbol =>
  readSymbolLib(
    parse(`(kicad_symbol_lib (version 20231120) (generator test)
      (symbol "${name}" (pin_names (offset 1.016)) ${body}))`),
  )[0]!;

/** A placement asking for a library id. */
const placed = (libId: string, ref = 'R1'): SchSymbol =>
  ({
    libId,
    at: { x: 0, y: 0 },
    angle: 0,
    unit: 1,
    bodyStyle: 1,
    inBom: true,
    onBoard: true,
    dnp: false,
    fields: [
      { key: 'Reference', value: ref, angle: 0 },
      { key: 'Value', value: 'R', angle: 0 },
    ],
    pins: [],
    source: { kind: 'list', items: [] },
  }) as unknown as SchSymbol;

const sources = (over: Partial<RescueSources> = {}): RescueSources => ({
  cache: new Map(),
  lib: () => null,
  schematicFileName: 'board.kicad_sch',
  ...over,
});

describe('the rescue library is named after the schematic', () => {
  /**
   * `GetRescueLibraryFileName` takes `aSchematic->GetFileName()`, not the
   * project's name — the two differ whenever the root sheet was renamed.
   */
  it('is the root sheet’s name with -rescue appended', () => {
    expect(rescueLibraryNickname('board.kicad_sch')).toBe('board-rescue');
    expect(rescueLibraryNickname('/home/me/proj/power.kicad_sch')).toBe('power-rescue');
  });

  it('is written as a modern library, whatever the old row said', () => {
    // `fn.SetExt( FILEEXT::KiCadSymbolLibFileExtension )` in WriteRescueLibrary.
    expect(rescueLibraryFileName('board.kicad_sch')).toBe('board-rescue.kicad_sym');
  });
});

describe('what makes a symbol a rescue candidate', () => {
  it('is nothing at all when the library still has it and the pins agree', () => {
    const lib = symbol('R');
    const cache = symbol('R');
    const found = findRescues(
      [placed('Device:R')],
      sources({ cache: new Map([['Device:R', cache]]), lib: () => lib }),
    );
    expect(found).toEqual([]);
  });

  it('is a symbol the library has lost but the cache still holds', () => {
    const found = findRescues(
      [placed('Device:R')],
      sources({ cache: new Map([['Device:R', symbol('R')]]) }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.newId).toBe('board-rescue:R-Device');
    expect(found[0]!.lib).toBeNull();
  });

  it('is a symbol whose library copy has moved a pin', () => {
    const moved = symbol('R', BODY.replace('(at 0 3.81 270)', '(at 0 5.08 270)'));
    const found = findRescues(
      [placed('Device:R')],
      sources({ cache: new Map([['Device:R', symbol('R')]]), lib: () => moved }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.cache).not.toBeNull();
    expect(found[0]!.lib).not.toBeNull();
  });

  /**
   * `if( !cache_match && lib_match ) continue;` — the ordinary healthy case on
   * a project with no cache library at all, which is every project written by
   * KiCad 6 or later. Without this arm, Rescue would offer to rescue every
   * symbol on every modern schematic.
   */
  it('is not a symbol with a legal name the library can still supply', () => {
    const found = findRescues([placed('Device:R')], sources({ lib: () => symbol('R') }));
    expect(found).toEqual([]);
  });

  it('is not a symbol nobody has — there is nothing to rescue it from', () => {
    // `if( !cache_match && !lib_match ) continue;`
    expect(findRescues([placed('Device:R')], sources())).toEqual([]);
  });

  /**
   * The arm that is live with no cache library at all. Both `continue`s sit
   * INSIDE `if( HasIllegalChars( … ) == -1 )`, so an id the library can still
   * supply is a candidate purely because its name cannot be written as a LIB_ID.
   */
  it('is a symbol whose name holds characters a LIB_ID may not', () => {
    const found = findRescues(
      [placed('Device:Conn<1>')],
      sources({ lib: () => symbol('Conn<1>') }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.newId).toBe('board-rescue:Conn{lt}1{gt}-Device');
    expect(found[0]!.cache).toBeNull();
  });

  it('escapes every character the id forbids, and only those', () => {
    const found = findRescues([placed('Lib:a<b>c"d\\e')], sources({ lib: () => symbol('x') }));
    expect(found[0]!.newId).toBe('board-rescue:a{lt}b{gt}c{dblquote}d{backslash}e-Lib');
  });

  it('leaves a slash alone, since LIB_IDs stopped escaping it', () => {
    // CTX_LIBID vs CTX_LEGACY_LIBID — the one difference between them.
    const found = findRescues([placed('Lib:a<b/c')], sources({ lib: () => symbol('x') }));
    expect(found[0]!.newId).toBe('board-rescue:a{lt}b/c-Lib');
  });

  it('finds the cache entry a V5 library filed under nickname-name', () => {
    // The second `findSymbol` attempt, `wxString::Format( "%s-%s", nickname, item )`.
    const found = findRescues(
      [placed('Device:R')],
      sources({ cache: new Map([['Device-R', symbol('R')]]) }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.cache).not.toBeNull();
  });
});

describe('the candidate list', () => {
  it('reports one row per library id, not one per placement', () => {
    const found = findRescues(
      [placed('Device:R', 'R1'), placed('Device:R', 'R2'), placed('Device:R', 'R3')],
      sources({ cache: new Map([['Device:R', symbol('R')]]) }),
    );
    expect(found).toHaveLength(1);
  });

  it('is sorted by library id, as the std::map it is dumped from', () => {
    const cache = new Map([
      ['Zed:A', symbol('A')],
      ['Device:R', symbol('R')],
      ['Device:C', symbol('C')],
    ]);
    const found = findRescues(
      [placed('Zed:A'), placed('Device:R'), placed('Device:C')],
      sources({ cache }),
    );
    expect(found.map((c) => c.requestedId)).toEqual(['Device:C', 'Device:R', 'Zed:A']);
  });

  it('carries the first placement’s unit and body style, for the preview', () => {
    const two = { ...placed('Device:R'), unit: 2, bodyStyle: 2 } as SchSymbol;
    const found = findRescues([two], sources({ cache: new Map([['Device:R', symbol('R')]]) }));
    expect(found[0]!.unit).toBe(2);
    expect(found[0]!.bodyStyle).toBe(2);
  });

  /**
   * The FIRST of the group, not the last. Upstream only builds a candidate when
   * `old_symbol_id != symbol_id`, so the placement that opens each run of the
   * id-sorted list is the one whose unit the preview shows; every later
   * placement of the same id is skipped entirely.
   */
  it('takes them from the first placement of the id, not the last', () => {
    const first = { ...placed('Device:R'), unit: 1, bodyStyle: 1 } as SchSymbol;
    const later = { ...placed('Device:R'), unit: 3, bodyStyle: 2 } as SchSymbol;
    const found = findRescues(
      [first, later],
      sources({ cache: new Map([['Device:R', symbol('R')]]) }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.unit).toBe(1);
    expect(found[0]!.bodyStyle).toBe(1);
  });
});

describe('pinsConflictWith', () => {
  it('finds no conflict between a symbol and its own copy', () => {
    expect(pinsConflictWith(symbol('R'), symbol('R'), RESCUE_PIN_TESTS)).toBe(false);
  });

  it('conflicts on a moved pin', () => {
    const moved = symbol('R', BODY.replace('(at 0 3.81 270)', '(at 0 5.08 270)'));
    expect(pinsConflictWith(symbol('R'), moved, RESCUE_PIN_TESTS)).toBe(true);
  });

  it('conflicts on a renumbered pin, a renamed one and a retyped one', () => {
    const renumbered = symbol('R', BODY.replace('(number "1"', '(number "9"'));
    const renamed = symbol('R', BODY.replace('(name "~"', '(name "A"'));
    const retyped = symbol(
      'R',
      BODY.replace('(pin passive line (at 0 3.81', '(pin input line (at 0 3.81'),
    );
    expect(pinsConflictWith(symbol('R'), renumbered, RESCUE_PIN_TESTS)).toBe(true);
    expect(pinsConflictWith(symbol('R'), renamed, RESCUE_PIN_TESTS)).toBe(true);
    expect(pinsConflictWith(symbol('R'), retyped, RESCUE_PIN_TESTS)).toBe(true);
  });

  /** `aTestLength` is the one the rescuer passes false. */
  it('does not conflict on a pin that only got longer', () => {
    const longer = symbol(
      'R',
      BODY.replace('(at 0 3.81 270) (length 1.27)', '(at 0 3.81 270) (length 2.54)'),
    );
    expect(pinsConflictWith(symbol('R'), longer, RESCUE_PIN_TESTS)).toBe(false);
    expect(pinsConflictWith(symbol('R'), longer, { ...RESCUE_PIN_TESTS, length: true })).toBe(true);
  });

  /**
   * The asymmetry is upstream's: only `a`'s pins are walked, so a library that
   * GAINED a pin the cache never had is not by itself a conflict.
   */
  it('ignores a pin the other symbol has spare', () => {
    const extra = symbol(
      'R',
      BODY.replace(
        '(number "2" (effects (font (size 1.27 1.27))))))',
        `(number "2" (effects (font (size 1.27 1.27)))))
         (pin passive line (at 5.08 0 180) (length 1.27)
           (name "~" (effects (font (size 1.27 1.27))))
           (number "3" (effects (font (size 1.27 1.27))))))`,
      ),
    );
    expect(pinsConflictWith(symbol('R'), extra, RESCUE_PIN_TESTS)).toBe(false);
    // ...and the other way round it is one, because now a pin has no partner.
    expect(pinsConflictWith(extra, symbol('R'), RESCUE_PIN_TESTS)).toBe(true);
  });
});

describe('the Action Taken column', () => {
  const found = (over: Partial<RescueSources>) =>
    findRescues([placed('Device:R')], sources(over))[0]!;

  it('says the library has lost it when only the cache has it', () => {
    const c = found({ cache: new Map([['Device:R', symbol('R')]]) });
    expect(rescueActionDescription(c)).toBe(
      'Rescue symbol Device:R found only in cache library to board-rescue:R-Device.',
    );
  });

  it('says it was modified when both have it', () => {
    const moved = symbol('R', BODY.replace('(at 0 3.81 270)', '(at 0 5.08 270)'));
    const c = found({ cache: new Map([['Device:R', symbol('R')]]), lib: () => moved });
    expect(rescueActionDescription(c)).toBe(
      'Rescue modified symbol Device:R to board-rescue:R-Device',
    );
  });

  it('reads the escaped name back out for the user', () => {
    const c = findRescues([placed('Device:Conn<1>')], sources({ lib: () => symbol('C') }))[0]!;
    expect(rescueActionDescription(c)).toContain('board-rescue:Conn<1>-Device');
  });
});

describe('performing the rescue', () => {
  const candidate = () =>
    findRescues([placed('Device:R')], sources({ cache: new Map([['Device:R', symbol('R')]]) }))[0]!;

  it('files the cached copy under the new id', () => {
    const def = rescuedDefinition(candidate())!;
    expect(def.libId).toBe('board-rescue:R-Device');
    // The cached copy is what is kept — that is the whole point of a rescue.
    expect(
      def.units
        .flatMap((u) => u.pins)
        .map((p) => p.number)
        .sort(),
    ).toEqual(['1', '2']);
  });

  /**
   * `LIB_SYMBOL* tmp = ( m_cache_candidate ) ? m_cache_candidate : m_lib_candidate;`
   * — the CACHE copy wins when there is one, and that is the whole point of a
   * rescue. Taking the library's copy would keep the very change the user was
   * being offered a way out of.
   */
  it('keeps the cache’s geometry, not the library’s, when the two differ', () => {
    const moved = symbol('R', BODY.replace('(at 0 3.81 270)', '(at 0 5.08 270)'));
    const c = findRescues(
      [placed('Device:R')],
      sources({ cache: new Map([['Device:R', symbol('R')]]), lib: () => moved }),
    )[0]!;
    const pin = rescuedDefinition(c)!
      .units.flatMap((u) => u.pins)
      .find((p) => p.number === '1')!;
    // The reader inverts Y for library pins, so the cache's 3.81 mm is -38100 IU
    // and the library's 5.08 would be -50800.
    expect(pin.at.y).toBe(-38100);
  });

  it('renames the units so the definition stands on its own', () => {
    const def = rescuedDefinition(candidate())!;
    expect(def.units.map((u) => u.name)).toEqual(['R-Device_0_1', 'R-Device_1_1']);
    expect(def.extends).toBeUndefined();
  });

  it('prefers the cache over the library, and falls back when there is none', () => {
    const libOnly = findRescues(
      [placed('Device:Conn<1>')],
      sources({ lib: () => symbol('Conn<1>') }),
    )[0]!;
    expect(rescuedDefinition(libOnly)).not.toBeNull();
  });

  it('repoints every placement of the old id and logs each one', () => {
    const c = candidate();
    const { symbols, log } = repointSymbols(
      [placed('Device:R', 'R1'), placed('Device:R', 'R2'), placed('Device:C', 'C1')],
      [c],
    );
    expect(symbols.map((s) => s.libId)).toEqual([
      'board-rescue:R-Device',
      'board-rescue:R-Device',
      'Device:C',
    ]);
    expect(log.map((l) => l.reference)).toEqual(['R1', 'R2']);
    expect(log[0]!.oldId).toBe('Device:R');
    expect(log[0]!.newId).toBe('board-rescue:R-Device');
  });

  /**
   * Ours has to do this and upstream does not: `lib_name` points a placement at
   * an entry in the sheet's own `lib_symbols`, filed under the OLD id. Left in
   * place it would win over the new library id and the rescued symbol would
   * never be reached.
   */
  it('drops a private-copy pointer that named the old definition', () => {
    const withPrivate = { ...placed('Device:R'), libName: 'R_1' } as SchSymbol;
    const { symbols } = repointSymbols([withPrivate], [candidate()]);
    expect(symbols[0]!.libName).toBeUndefined();
    expect(symbols[0]!.libId).toBe('board-rescue:R-Device');
  });

  it('leaves a symbol nobody chose exactly as it was', () => {
    const one = placed('Device:R');
    const { symbols, log } = repointSymbols([one], []);
    expect(symbols[0]).toBe(one);
    expect(log).toEqual([]);
  });
});

describe('the rescue applied to a document', () => {
  const sheet = (libId: string): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (generator "eeschema")
  (lib_symbols
    (symbol "${libId}" (pin_names (offset 1.016))
      (property "Reference" "R" (at 0 0 0))
      (property "Value" "R" (at 0 0 0))
      (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54)))))
  (symbol (lib_id "${libId}") (at 100 100 0) (unit 1)
    (property "Reference" "R1" (at 0 0 0))
    (property "Value" "R" (at 0 0 0))
    (uuid "s1"))
  (sheet_instances (path "/" (page "1"))))`),
    );

  const candidate = () =>
    findRescues([placed('Device:R')], sources({ cache: new Map([['Device:R', symbol('R')]]) }))[0]!;

  it('repoints the placement and files the rescued definition beside it', () => {
    const next = rescueDocumentCommand([candidate()]).apply(sheet('Device:R'));
    expect(next.symbols[0]!.libId).toBe('board-rescue:R-Device');
    expect(next.libSymbols.map((l) => l.libId)).toContain('board-rescue:R-Device');
  });

  /** `SCH_SCREEN` keeps `lib_symbols` to what the sheet still resolves through. */
  it('drops the definition nothing on the sheet resolves through any more', () => {
    const next = rescueDocumentCommand([candidate()]).apply(sheet('Device:R'));
    expect(next.libSymbols.map((l) => l.libId)).not.toContain('Device:R');
  });

  /**
   * A sheet gets the definitions IT places and no others. `lib_symbols` is the
   * sheet's own cache, and filing a rescued symbol into a sheet that never
   * placed it would put a definition in the file that nothing there resolves
   * through — the same fault as leaving the stale one behind, from the other
   * direction.
   */
  it('files only the definitions this sheet actually places', () => {
    const both = [
      findRescues(
        [placed('Device:R')],
        sources({ cache: new Map([['Device:R', symbol('R')]]) }),
      )[0]!,
      findRescues(
        [placed('Device:C')],
        sources({ cache: new Map([['Device:C', symbol('C')]]) }),
      )[0]!,
    ];
    const next = rescueDocumentCommand(both).apply(sheet('Device:R'));
    expect(next.libSymbols.map((l) => l.libId)).toEqual(['board-rescue:R-Device']);
  });

  it('leaves a sheet that places none of them exactly as it was', () => {
    const other = sheet('Device:C');
    expect(rescueDocumentCommand([candidate()]).apply(other)).toBe(other);
  });

  it('puts the sheet back whole when inverted', () => {
    const before = sheet('Device:R');
    const cmd = rescueDocumentCommand([candidate()]);
    const after = cmd.apply(before);
    expect(cmd.invert(before).apply(after)).toBe(before);
  });
});
