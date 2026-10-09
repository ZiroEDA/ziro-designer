// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `hash_fp_item` (`common/hash_eda.cpp`): which differences change a hash and
 * which do not, under GenCAD's flags (HASH_POS | REL_COORD | HASH_ROT |
 * HASH_LAYER), and the GenCAD `$SHAPES` naming it drives. Each case is read
 * off the C++: a field that upstream folds in must split two items, one it
 * leaves out must not.
 */
import { describe, expect, it } from 'vitest';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { hashFootprint, writeGenCad } from '@ziroeda/pcbnew/exporters/export_gencad_writer.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { HASH_FLAGS, hash_fp_item } from '@ziroeda/pcbnew/hash_eda.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const GENCAD =
  HASH_FLAGS.HASH_POS | HASH_FLAGS.REL_COORD | HASH_FLAGS.HASH_ROT | HASH_FLAGS.HASH_LAYER;

let n = 100;
const U = (): string => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;

/** A board of footprints "Lib:FP" at the given places, each with `aBody` inside. */
function board(aBodies: { at: string; body: string; layer?: string }[]): FOOTPRINT[] {
  const fps = aBodies
    .map(
      (b) => `(footprint "Lib:FP" (layer "${b.layer ?? 'F.Cu'}") (at ${b.at}) (uuid "${U()}")
    (property "Reference" "R${n}" (at 0 0 0) (layer "F.SilkS") (uuid "${U()}"))
    ${b.body})`,
    )
    .join('\n');
  return ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (7 "B.SilkS" user)
    (31 "F.CrtYd" user) (37 "F.Fab" user))
  (setup)
  (net 0 "")
  ${fps}
)`).Footprints();
}

const pad = (extra = '', drill = '0.8', at = '0 0'): string =>
  `(pad "1" thru_hole circle (at ${at}) (size 1.6 1.6) (drill ${drill}) (layers "*.Cu" "*.Mask") ${extra} (uuid "${U()}"))`;
const line = (s: string, e: string, extra = '(stroke (width 0.12) (type solid))'): string =>
  `(fp_line (start ${s}) (end ${e}) ${extra} (layer "F.SilkS") (uuid "${U()}"))`;

/** GenCAD's hashFootprint: the children under GENCAD's flags, not the footprint's own place. */
const fpHash = (fp: FOOTPRINT): string => hashFootprint(fp);
const same = (a: string, b: string): boolean => {
  const [x, y] = board([
    { at: '10 10', body: a },
    { at: '30 10', body: b },
  ]);
  return fpHash(x!) === fpHash(y!);
};

describe('hash_fp_item of a FOOTPRINT', () => {
  it('folds in its own position under HASH_POS', () => {
    const [a, b] = board([
      { at: '10 10', body: pad() },
      { at: '30 10', body: pad() },
    ]);
    const h = (fp: FOOTPRINT, f: number): string => hash_fp_item(fp as unknown as EDA_ITEM, f);

    expect(h(a!, GENCAD)).not.toBe(h(b!, GENCAD));
    expect(h(a!, GENCAD & ~HASH_FLAGS.HASH_POS)).toBe(h(b!, GENCAD & ~HASH_FLAGS.HASH_POS));
  });
});

describe('GenCAD hashFootprint: the children, under GenCAD flags', () => {
  it('ignores where the footprint sits (REL_COORD), and the order of its children', () => {
    expect(same(`${pad()} ${line('-1 -1', '1 -1')}`, `${line('-1 -1', '1 -1')} ${pad()}`)).toBe(
      true,
    );
  });

  it('a pad drill splits two footprints', () => {
    expect(same(pad('', '0.8'), pad('', '1.0'))).toBe(false);
  });

  it('a pad moved inside the footprint splits them', () => {
    expect(same(pad('', '0.8', '0 0'), pad('', '0.8', '0.5 0'))).toBe(false);
  });

  it('a line width, or its style, splits them', () => {
    expect(
      same(line('-1 -1', '1 -1'), line('-1 -1', '1 -1', '(stroke (width 0.2) (type solid))')),
    ).toBe(false);
    expect(
      same(line('-1 -1', '1 -1'), line('-1 -1', '1 -1', '(stroke (width 0.12) (type dash))')),
    ).toBe(false);
  });

  it('a line drawn the other way hashes alike when x and y both order it...', () => {
    expect(same(line('-1 -1', '1 1'), line('1 1', '-1 -1'))).toBe(true);
  });

  it("...and differently when only one of them does: the swap is upstream's, not a sort", () => {
    // (1,-1)->(-1,1): x is greater, so it swaps to (-1,1)->(1,-1); drawn the
    // other way, (-1,1)->(1,-1): y is greater, so it swaps back to (1,-1)->(-1,1).
    expect(same(line('1 -1', '-1 1'), line('-1 1', '1 -1'))).toBe(false);
  });

  it('a text item joins in (its string), the reference field does not', () => {
    const txt = (t: string): string =>
      `(fp_text user "${t}" (at 0 2) (layer "F.Fab") (uuid "${U()}") (effects (font (size 1 1) (thickness 0.15))))`;
    expect(same(txt('A'), txt('B'))).toBe(false);
    // Each footprint of `board` has its own reference, R<n>: not hashed.
    expect(same(pad(), pad())).toBe(true);
  });

  it('a circle radius splits them', () => {
    const circle = (r: string): string =>
      `(fp_circle (center 0 0) (end ${r} 0) (stroke (width 0.12) (type solid)) (fill no) (layer "F.SilkS") (uuid "${U()}"))`;
    expect(same(circle('1'), circle('1.5'))).toBe(false);
  });

  it('a pad on the back layers splits them (HASH_LAYER)', () => {
    const smd = (layer: string): string =>
      `(pad "1" smd rect (at 0 0) (size 1 1) (layers "${layer}") (uuid "${U()}"))`;
    expect(same(smd('F.Cu'), smd('B.Cu'))).toBe(false);
  });
});

describe('hash_fp_item of single items', () => {
  it('two graphic items in either order give the same footprint hash (the sum)', () => {
    const a = line('-1 -1', '1 -1');
    const b = line('-1 1', '1 1');
    expect(same(`${a} ${b}`, `${b} ${a}`)).toBe(true);
    const [x, y] = board([
      { at: '10 10', body: `${a} ${b}` },
      { at: '10 10', body: `${b} ${a}` },
    ]);
    const h = (fp: FOOTPRINT): string => hash_fp_item(fp as unknown as EDA_ITEM, GENCAD);
    expect(h(x!)).toBe(h(y!));
  });

  it('a circle radius counts without HASH_POS, where no point carries it', () => {
    const circle = (r: string): string =>
      `(fp_circle (center 0 0) (end ${r} 0) (stroke (width 0.12) (type solid)) (fill no) (layer "F.SilkS") (uuid "${U()}"))`;
    const [x, y] = board([
      { at: '10 10', body: circle('1') },
      { at: '30 10', body: circle('1.5') },
    ]);
    const h = (fp: FOOTPRINT): string =>
      hash_fp_item(fp.GraphicalItems()[0] as unknown as EDA_ITEM, HASH_FLAGS.HASH_LAYER);
    expect(h(x!)).not.toBe(h(y!));
  });

  it('the reference field is 0 without HASH_REF, its text with it', () => {
    const [x, y] = board([
      { at: '10 10', body: '' },
      { at: '30 10', body: '' },
    ]);
    const ref = (fp: FOOTPRINT): EDA_ITEM => fp.Reference() as unknown as EDA_ITEM;

    expect(hash_fp_item(ref(x!), 0)).toBe('0');
    expect(hash_fp_item(ref(x!), HASH_FLAGS.HASH_REF)).not.toBe(
      hash_fp_item(ref(y!), HASH_FLAGS.HASH_REF),
    );
  });
});

describe('hash_fp_item flags', () => {
  it('HASH_ROT folds a pad orientation in; without it the same pads match', () => {
    const [a, b] = board([
      { at: '10 10', body: pad() },
      // A pad's angle in the file is its own, absolute orientation.
      { at: '30 10', body: pad('', '0.8', '0 0 90') },
    ]);
    const padOf = (fp: FOOTPRINT): EDA_ITEM => fp.Pads()[0] as unknown as EDA_ITEM;

    expect(hash_fp_item(padOf(a!), HASH_FLAGS.HASH_ROT)).not.toBe(
      hash_fp_item(padOf(b!), HASH_FLAGS.HASH_ROT),
    );
    expect(hash_fp_item(padOf(a!), 0)).toBe(hash_fp_item(padOf(b!), 0));
  });
});

describe('GenCAD $SHAPES naming', () => {
  it('a modified copy of a footprint gets <name>_0; an identical one reuses the shape', () => {
    const fps = board([
      { at: '10 10', body: `${pad()} ${line('-1 -1', '1 -1')}` },
      { at: '30 10', body: `${pad()} ${line('-1 -1', '1 -1')}` },
      { at: '50 10', body: `${pad()} ${line('-1 -1', '2 -1')}` },
    ]);
    const text = writeGenCad(fps[0]!.GetBoard()!, {});
    const shapes = [...text.matchAll(/^SHAPE "([^"]*)"$/gm)].map((m) => m[1]);

    expect(shapes).toEqual(['Lib:FP', 'Lib:FP_0']);
  });
});
