// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Swap Pins — `SCH_EDIT_TOOL::SwapPins`.
 *
 * The interesting half is not the swap, it is WHOSE pins move. Upstream a
 * placement owns a flattened copy of its library symbol
 * (`SCH_SYMBOL::m_part`), so swapping one `Device:R`'s pins leaves every other
 * `Device:R` alone. Our `lib_symbols` is genuinely shared, so the port has to
 * mint the private copy KiCad's screen would have minted lazily — `(lib_name
 * "R_1")` — and that copy has to survive a save, or the swap is undone by the
 * next reload without anything saying so.
 */
import { describe, expect, it } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import {
  swapPinsCommand,
  privateLibSymbolName,
  symbolIsShared,
  placedPinRefs,
  type SwapPinsPlan,
} from '@ziroeda/eeschema/src/tools/swap_pins.js';
import { schSymbolLibraryName } from '@ziroeda/eeschema/src/lib_symbol_compare.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB_R = `(symbol "Device:R" (pin_names (offset 0)) (in_bom yes) (on_board yes)
      (property "Reference" "R" (at 0 0 90) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 0 90) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default)) (fill (type none))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 2.54)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27)))))))`;

const sheet = (symbols: string): string =>
  `(kicad_sch (version 20250114) (generator "eeschema")
  (lib_symbols ${LIB_R})
${symbols}
  (sheet_instances (path "/" (page "1"))))`;

const sym = (uuid: string, ref: string, x: number, instances = ''): string =>
  `  (symbol (lib_id "Device:R") (at ${x} 100 0) (unit 1) (uuid "${uuid}")
    (property "Reference" "${ref}" (at ${x} 95 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at ${x} 105 0) (effects (font (size 1.27 1.27))))${instances})`;

const doc = (symbols: string): Schematic => readSchematic(parse(sheet(symbols)));
const libOf = (d: Schematic): Map<string, LibSymbol> =>
  new Map(d.libSymbols.map((l) => [l.libId, l]));

/** The pins of the placement's definition, as (number, y, length). */
const pinsOf = (d: Schematic, symbolId: string): [string, number, number][] => {
  const s = d.symbols.find((_x, i) => (d.symbols[i]!.uuid ?? '') === symbolId)!;
  const lib = libOf(d).get(schSymbolLibraryName(s))!;
  return lib.units.flatMap((u) =>
    u.pins.map((p) => [p.number, p.at.y, p.length] as [string, number, number]),
  );
};

const plan = (r: ReturnType<typeof swapPinsCommand>): SwapPinsPlan => {
  expect('cmd' in r, JSON.stringify(r)).toBe(true);
  return r as SwapPinsPlan;
};

describe('what a swap is allowed to act on', () => {
  const d = doc(sym('r1', 'R1', 100));

  it('needs two pins', () => {
    expect(swapPinsCommand(d, libOf(d), ['r1:pin0'])).toEqual({ kind: 'too_few' });
    expect(swapPinsCommand(d, libOf(d), [])).toEqual({ kind: 'too_few' });
  });

  it('needs them all on ONE symbol', () => {
    // "All pins need to be on the same symbol" (`sch_edit_tool.cpp:1786-1790`).
    const two = doc([sym('r1', 'R1', 100), sym('r2', 'R2', 140)].join('\n'));
    expect(swapPinsCommand(two, libOf(two), ['r1:pin0', 'r2:pin0'])).toEqual({
      kind: 'not_one_symbol',
    });
  });

  it('refuses a pin id that names no pin of that symbol', () => {
    expect(swapPinsCommand(d, libOf(d), ['r1:pin0', 'r1:pin9'])).toEqual({
      kind: 'not_one_symbol',
    });
  });

  /**
   * `SymbolHasSheetInstances` (`sch_tool_utils.cpp:328-370`): one SCH_SYMBOL
   * serving several sheet paths cannot have per-instance geometry, so upstream
   * shows an infobar and does nothing.
   */
  it('refuses a symbol instantiated on more than one sheet path', () => {
    const shared = doc(
      sym(
        'r1',
        'R1',
        100,
        `
    (instances (project "p" (path "/aaa" (reference "R1") (unit 1)) (path "/bbb" (reference "R2") (unit 1))))`,
      ),
    );
    const r = swapPinsCommand(shared, libOf(shared), ['r1:pin0', 'r1:pin1'], 'p');
    expect(r).toMatchObject({ kind: 'shared', sheetPaths: ['/aaa', '/bbb'] });
  });

  it('refuses a symbol another project also instantiates', () => {
    const shared = doc(
      sym(
        'r1',
        'R1',
        100,
        `
    (instances (project "other" (path "/aaa" (reference "R1") (unit 1))))`,
      ),
    );
    expect(swapPinsCommand(shared, libOf(shared), ['r1:pin0', 'r1:pin1'], 'p')).toMatchObject({
      kind: 'shared',
      projectNames: ['other'],
    });
  });

  it('allows one instantiated once in this project', () => {
    const ok = doc(
      sym(
        'r1',
        'R1',
        100,
        `
    (instances (project "p" (path "/aaa" (reference "R1") (unit 1))))`,
      ),
    );
    expect(symbolIsShared(ok.symbols[0]!, 'p')).toBeNull();
  });
});

describe('the swap itself', () => {
  const d = doc(sym('r1', 'R1', 100));

  it('trades position, orientation and length, and not the numbers', () => {
    // A library's Y is up-positive and the schematic's is down-positive, so the
    // reader flips it: `(at 0 3.81 270)` is stored at y = -38100.
    const before = pinsOf(d, 'r1');
    expect(before).toEqual([
      ['1', -3.81 * 10000, 1.27 * 10000],
      ['2', 3.81 * 10000, 2.54 * 10000],
    ]);
    const after = pinsOf(
      plan(swapPinsCommand(d, libOf(d), ['r1:pin0', 'r1:pin1'])).cmd.apply(d),
      'r1',
    );
    // Pin 1 is where pin 2 was, and vice versa — numbers unmoved.
    expect(after).toEqual([
      ['1', 3.81 * 10000, 2.54 * 10000],
      ['2', -3.81 * 10000, 1.27 * 10000],
    ]);
  });

  it('leaves the sheet’s only definition in place, with no private copy', () => {
    const next = plan(swapPinsCommand(d, libOf(d), ['r1:pin0', 'r1:pin1'])).cmd.apply(d);
    expect(next.libSymbols.map((l) => l.libId)).toEqual(['Device:R']);
    expect(next.symbols[0]!.libName).toBeUndefined();
  });

  it('undoes exactly', () => {
    const cmd = plan(swapPinsCommand(d, libOf(d), ['r1:pin0', 'r1:pin1'])).cmd;
    const next = cmd.apply(d);
    expect(pinsOf(cmd.invert(d).apply(next), 'r1')).toEqual(pinsOf(d, 'r1'));
  });

  /**
   * `for( i = 0; i < sorted.size() - 1; i++ ) Swap( sorted[i], sorted[i+1] )` —
   * adjacent pairs, so three pins ROTATE rather than each trading with one
   * partner. Worth pinning because "swap" reads like it should be pairwise.
   */
  it('rotates three pins rather than pairing them', () => {
    const three = `(symbol "Device:Q" (pin_names (offset 0)) (in_bom yes) (on_board yes)
      (property "Reference" "Q" (at 0 0 90) (effects (font (size 1.27 1.27))))
      (symbol "Q_1_1"
        (pin passive line (at 0 1 0) (length 1) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 2 0) (length 2) (name "~" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 3 0) (length 3) (name "~" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))))`;
    const dq = readSchematic(
      parse(`(kicad_sch (version 20250114) (generator "eeschema")
  (lib_symbols ${three})
  (symbol (lib_id "Device:Q") (at 100 100 0) (unit 1) (uuid "q1")
    (property "Reference" "Q1" (at 100 95 0) (effects (font (size 1.27 1.27)))))
  (sheet_instances (path "/" (page "1"))))`),
    );
    const cmd = plan(swapPinsCommand(dq, libOf(dq), ['q1:pin0', 'q1:pin1', 'q1:pin2'])).cmd;
    const lengths = cmd
      .apply(dq)
      .libSymbols[0]!.units.flatMap((u) => u.pins.map((p) => p.length / 10000));
    // 1<->2 then 2<->3: lengths 1,2,3 become 2,3,1.
    expect(lengths).toEqual([2, 3, 1]);
  });
});

/**
 * The part that makes it safe on a sheet with more than one of the same part.
 */
describe('a definition two placements share', () => {
  const two = doc([sym('r1', 'R1', 100), sym('r2', 'R2', 140)].join('\n'));
  const next = plan(swapPinsCommand(two, libOf(two), ['r1:pin0', 'r1:pin1'])).cmd.apply(two);

  it('gets a private copy, named the way KiCad names one', () => {
    expect(next.libSymbols.map((l) => l.libId)).toEqual(['Device:R', 'R_1']);
    expect(next.symbols[0]!.libName).toBe('R_1');
  });

  it('leaves the OTHER placement on the shared definition, unmoved', () => {
    expect(next.symbols[1]!.libName).toBeUndefined();
    const shared = next.libSymbols.find((l) => l.libId === 'Device:R')!;
    expect(shared.units.flatMap((u) => u.pins.map((p) => p.at.y / 10000))).toEqual([-3.81, 3.81]);
  });

  it('renames the copy’s units with it', () => {
    // The unit name's trailing `_<unit>_<style>` is what the reader takes the
    // unit and body style from, and the cache synthesises it from the PARENT's
    // name (`sch_io_kicad_sexpr_lib_cache.cpp:495`).
    const copy = next.libSymbols.find((l) => l.libId === 'R_1')!;
    expect(copy.units.map((u) => u.name).sort()).toEqual(['R_1_0_1', 'R_1_1_1']);
  });

  it('counts up when the first private name is taken', () => {
    expect(privateLibSymbolName('Device:R', new Set(['R_1']))).toBe('R_2');
    expect(privateLibSymbolName('Device:R', new Set(['R_1', 'R_2']))).toBe('R_3');
    expect(privateLibSymbolName('Device:R', new Set())).toBe('R_1');
    // No library prefix: the whole id is the item name.
    expect(privateLibSymbolName('R', new Set())).toBe('R_1');
  });
});

/**
 * A swap that does not survive a save is not a swap. `(lib_name …)` is written
 * by `saveSymbol` only when the placement HAS a private definition, and ours
 * had no way to emit one that the source file did not already carry.
 */
describe('the file it writes', () => {
  const two = doc([sym('r1', 'R1', 100), sym('r2', 'R2', 140)].join('\n'));
  const next = plan(swapPinsCommand(two, libOf(two), ['r1:pin0', 'r1:pin1'])).cmd.apply(two);
  const text = serialize(writeSchematic(next));

  it('carries the lib_name the placement gained', () => {
    expect(text).toContain('(lib_name "R_1")');
  });

  it('carries the private definition beside the shared one', () => {
    expect(text).toContain('(symbol "R_1"');
    expect(text).toContain('(symbol "Device:R"');
  });

  it('reads back with the swap intact, and the other placement untouched', () => {
    const round = readSchematic(parse(text));
    expect(round.symbols[0]!.libName).toBe('R_1');
    expect(pinsOf(round, 'r1').map((p) => [p[0], p[1] / 10000])).toEqual([
      ['1', 3.81],
      ['2', -3.81],
    ]);
    expect(pinsOf(round, 'r2').map((p) => [p[0], p[1] / 10000])).toEqual([
      ['1', -3.81],
      ['2', 3.81],
    ]);
  });

  it('writes no lib_name for a placement that has none', () => {
    const plain = serialize(writeSchematic(two));
    expect(plain).not.toContain('lib_name');
  });
});

describe('which library pin an id names', () => {
  it('numbers across the units the placement selects, in library order', () => {
    const d = doc(sym('r1', 'R1', 100));
    const refs = placedPinRefs(d.symbols[0]!, 'r1', libOf(d).get('Device:R')!);
    // `R_0_1` is the body (unit 0, shared) and carries no pins; `R_1_1` has two.
    expect(refs.map((r) => r.id)).toEqual(['r1:pin0', 'r1:pin1']);
    expect(refs.map((r) => r.pin)).toEqual([0, 1]);
  });
});
