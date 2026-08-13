// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Place all units" steps past the units already on the sheet.
 *
 * `SCH_DRAWING_TOOLS::PlaceSymbol`'s continuation:
 *
 *   while( unit <= unitCount && unitOccupied( unit ) ) unit++;
 *   if( unit > unitCount ) unit = 1;
 *
 * Ours incremented blindly and restarted at 1 whenever the chooser reopened, so
 * placing a 4001, closing the chooser and placing it again put a second unit A
 * on the sheet instead of moving on to B.
 *
 * The occupancy test is the part with a trap in it. Before annotation every
 * symbol reads `U?`, so two different multi-unit parts on one sheet share a
 * reference string; `IsUnannotatedUnitOccupied` matches on the library id as
 * well, which is what stops a 4001 skipping units occupied by a 4011.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import {
  isUnannotatedUnitOccupied,
  makeSymbol,
  nextFreeUnit,
  readSymbolLib,
  type LibSymbol,
  type SchSymbol,
} from '@ziroeda/eeschema';

const part = (name: string, prefix = 'U'): LibSymbol => {
  const raw = readSymbolLib(
    parse(`(kicad_symbol_lib (version 20241209) (generator "x")
      (symbol "${name}"
        (property "Reference" "${prefix}" (at 0 0 0) (effects (font (size 1.27 1.27))))
        (symbol "${name}_1_1"
          (pin passive line (at 0 3.81 270) (length 1.27)
            (name "~" (effects (font (size 1.27 1.27))))
            (number "1" (effects (font (size 1.27 1.27))))))))`),
  )[0]!;
  return { ...raw, libId: `4xxx:${raw.libId}` };
};

/** A placement of `lib` on unit `u`, as the tool would leave it. */
const placed = (lib: LibSymbol, u: number): SchSymbol => ({
  ...makeSymbol(lib, { x: u * 10, y: 0 }),
  unit: u,
});

const UNITS = 5; // a 4001: four gates and a power unit

describe('stepping to the next unit', () => {
  it('takes the first one when the sheet is empty', () => {
    expect(nextFreeUnit([], 'U?', '4xxx:4001', UNITS, 1)).toBe(1);
  });

  it('walks past the units already placed', () => {
    const p = part('4001');
    const sheet = [placed(p, 1), placed(p, 2)];
    // Asked to continue from 2, which is taken, so it lands on 3.
    expect(nextFreeUnit(sheet, 'U?', p.libId, UNITS, 2)).toBe(3);
  });

  it('resumes at the first free unit after the chooser reopens', () => {
    // The reported bug: reopening restarted the count, so this asked from 1.
    const p = part('4001');
    const sheet = [placed(p, 1)];
    expect(nextFreeUnit(sheet, 'U?', p.libId, UNITS, 1)).toBe(2);
  });

  it('wraps to the first unit once they are all placed', () => {
    const p = part('4001');
    const sheet = [1, 2, 3, 4, 5].map((u) => placed(p, u));
    expect(nextFreeUnit(sheet, 'U?', p.libId, UNITS, 1)).toBe(1);
  });

  it('does not count another part that happens to share the reference', () => {
    // Both read U? before annotation. Matching on the reference alone would
    // have the 4001 skip straight to unit 2 because a 4011 occupies unit 1.
    const nor = part('4001');
    const nand = part('4011');
    const sheet = [placed(nand, 1)];

    expect(isUnannotatedUnitOccupied(sheet, 'U?', nor.libId, 1)).toBe(false);
    expect(nextFreeUnit(sheet, 'U?', nor.libId, UNITS, 1)).toBe(1);
  });

  it('does count the same part under the same reference', () => {
    const p = part('4001');
    expect(isUnannotatedUnitOccupied([placed(p, 3)], 'U?', p.libId, 3)).toBe(true);
  });

  it('treats an annotated placement as occupying only its own reference', () => {
    // U1A does not stop U2 being placed on unit A.
    const p = part('4001');
    const u1a: SchSymbol = {
      ...placed(p, 1),
      fields: placed(p, 1).fields.map((f) => (f.key === 'Reference' ? { ...f, value: 'U1' } : f)),
    };
    expect(isUnannotatedUnitOccupied([u1a], 'U2', p.libId, 1)).toBe(false);
    expect(isUnannotatedUnitOccupied([u1a], 'U1', p.libId, 1)).toBe(true);
  });
});
