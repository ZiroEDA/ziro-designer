// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint position files.
 * Counterpart: `PLACE_FILE_EXPORTER` (pcbnew/exporters/place_file_exporter.cpp).
 *
 * A pick-and-place machine is programmed from this file, so the column layout
 * is the interface. Rows are asserted whole rather than field by field: a
 * width computed from the wrong set still produces plausible-looking output
 * while every column after it has moved.
 *
 * Several of the cases below pin behaviour that reads like a bug — the back
 * side sorts first, `# Ref` is offset inside its own column, "All" is
 * capitalised where every other spelling is lowercase — and each is upstream's.
 */
import { describe, expect, it } from 'vitest';
import {
  decorateFilename,
  formatFixed,
  PLACE_FILE_EXPORTER,
  placeFileName,
} from '@ziroeda/pcbnew/exporters/place_file_exporter.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const P = (x: number, y: number) => ({ x, y });

/** A footprint as the fixtures describe it; written out as board text. */
interface FP {
  lib?: string;
  at?: { x: number; y: number };
  angle?: number;
  layer?: 'F.Cu' | 'B.Cu';
  reference?: string;
  value?: string;
  pads?: { type: 'smd' | 'connect' | 'np_thru_hole' | 'thru_hole' }[];
  attributes?: string[];
  /** `(attr smd)`: on unless false. */
  smd?: boolean;
}

const fp = (over: FP = {}): FP => over;

let uuid = 0;
const U = (): string => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;

function fpText(f: FP): string {
  const at = f.at ?? P(10_000_000, 5_000_000);
  const layer = f.layer ?? 'F.Cu';
  const cu = layer;
  const pads = (f.pads ?? [{ type: 'smd' }])
    .map((p, i) =>
      p.type === 'np_thru_hole'
        ? `(pad "" np_thru_hole circle (at ${i} 0) (size 1 1) (drill 1) (layers "*.Cu") (uuid "${U()}"))`
        : p.type === 'thru_hole'
          ? `(pad "${i + 1}" thru_hole circle (at ${i} 0) (size 1 1) (drill 0.5) (layers "*.Cu") (uuid "${U()}"))`
          : `(pad "${i + 1}" ${p.type} rect (at ${i} 0) (size 1 1) (layers "${cu}") (uuid "${U()}"))`,
    )
    .join(' ');
  const attrs = [...(f.smd === false ? [] : ['smd']), ...(f.attributes ?? [])].join(' ');
  const q = (t: string): string => JSON.stringify(t);
  return `(footprint ${q(f.lib ?? 'Resistor_SMD:R_0805_2012Metric')} (layer "${layer}")
    (at ${at.x / 1e6} ${at.y / 1e6} ${f.angle ?? 0}) (uuid "${U()}")
    (property "Reference" ${q(f.reference ?? 'R1')} (at 0 0 0) (layer "F.SilkS") (uuid "${U()}") (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" ${q(f.value ?? '10k')} (at 0 0 0) (layer "F.Fab") (uuid "${U()}") (effects (font (size 1 1) (thickness 0.15))))
    (attr ${attrs}) ${pads})`;
}

const board = (footprints: FP[], auxOrigin?: { x: number; y: number }): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (35 "F.Fab" user))
  (setup (pad_to_mask_clearance 0)${auxOrigin ? ` (aux_axis_origin ${auxOrigin.x / 1e6} ${auxOrigin.y / 1e6})` : ''})
  (net 0 "")
  ${footprints.map(fpText).join('\n  ')}
)`);

interface Opts {
  unitsMM: boolean;
  frontSide: boolean;
  backSide: boolean;
  formatCSV?: boolean;
  onlySMD?: boolean;
  excludeAllTH?: boolean;
  excludeDNP?: boolean;
  excludeBOM?: boolean;
  negateBottomX?: boolean;
  useAuxOrigin?: boolean;
}

/** PLACE_FILE_EXPORTER's text and the count from that one pass. */
function genPositionData(b: BOARD, o: Opts): { data: string; footprintCount: number } {
  const exporter = new PLACE_FILE_EXPORTER(
    b,
    o.unitsMM,
    o.onlySMD ?? false,
    o.excludeAllTH ?? false,
    o.excludeDNP ?? false,
    o.excludeBOM ?? false,
    o.frontSide,
    o.backSide,
    o.formatCSV ?? false,
    o.useAuxOrigin ?? false,
    o.negateBottomX ?? false,
  );
  const data = exporter.GenPositionData();
  return { data, footprintCount: exporter.GetFootprintCount() };
}

const hasThroughHolePads = (f: FP): boolean =>
  (board([f]).Footprints()[0] as FOOTPRINT).HasThroughHolePads();

const BOTH = { unitsMM: true, frontSide: true, backSide: true };
const rows = (text: string): string[] =>
  text.split('\n').filter((l) => l && !l.startsWith('#') && l !== '## End');

describe('printf-compatible fixed formatting', () => {
  it('breaks exact ties to even, as glibc does', () => {
    // 0.03125 is exactly representable, so this is a genuine tie rather than a
    // rounding artefact. toFixed picks the larger candidate and gives 0.0313.
    expect(formatFixed(0.03125, 4)).toBe('0.0312');
    expect((0.03125).toFixed(4)).toBe('0.0313');
  });

  it('rounds a non-tie normally', () => {
    expect(formatFixed(0.03126, 4)).toBe('0.0313');
    expect(formatFixed(1.5, 0)).toBe('2');
    expect(formatFixed(2.5, 0)).toBe('2');
  });

  it('keeps a negative sign but never emits one for zero', () => {
    expect(formatFixed(-7.5, 4)).toBe('-7.5000');
    expect(formatFixed(-0, 4)).toBe('0.0000');
  });
});

describe('which footprints are excluded', () => {
  it('counts any non-SMD pad as a through-hole pad', () => {
    // The checkbox says "with through hole pads"; upstream tests
    // `!= PAD_ATTRIB::SMD`, so an edge-connector finger with no hole at all,
    // and an NPTH, both trip it.
    expect(hasThroughHolePads(fp({ pads: [{ type: 'smd' }] }))).toBe(false);
    expect(hasThroughHolePads(fp({ pads: [{ type: 'connect' }] }))).toBe(true);
    expect(hasThroughHolePads(fp({ pads: [{ type: 'np_thru_hole' }] }))).toBe(true);
  });

  it('honours each exclusion attribute', () => {
    const b = board([
      fp({ reference: 'R1' }),
      fp({ reference: 'R2', attributes: ['exclude_from_pos_files'] }),
      fp({ reference: 'R3', attributes: ['dnp'] }),
      fp({ reference: 'R4', attributes: ['exclude_from_bom'] }),
    ]);

    expect(genPositionData(b, BOTH).footprintCount).toBe(3);
    expect(genPositionData(b, { ...BOTH, excludeDNP: true }).footprintCount).toBe(2);
    expect(genPositionData(b, { ...BOTH, excludeDNP: true, excludeBOM: true }).footprintCount).toBe(
      1,
    );
  });

  it('keeps only FP_SMD footprints when asked', () => {
    const b = board([fp({ reference: 'R1' }), fp({ reference: 'J1', smd: false })]);

    expect(genPositionData(b, BOTH).footprintCount).toBe(2);
    expect(
      rows(genPositionData(b, { ...BOTH, onlySMD: true }).data).map((r) => r.slice(0, 2)),
    ).toEqual(['R1']);
  });

  it('writes the value unescaped', () => {
    // GetFieldValueForVariant gives the stored form; the exporter unescapes it.
    const out = genPositionData(board([fp({ value: '1{slash}2' })]), BOTH);

    expect(rows(out.data)[0]!.startsWith('R1        1/2')).toBe(true);
  });

  it('reports the count and the text from one pass', () => {
    // The dialog asks for the count to decide whether to say "no footprints",
    // so a second, separately-filtered pass could disagree with the file.
    const out = genPositionData(board([fp(), fp({ reference: 'R2' })]), BOTH);

    expect(out.footprintCount).toBe(2);
    expect(rows(out.data)).toHaveLength(2);
  });
});

describe('the ASCII table', () => {
  it('writes a row with the exact column layout', () => {
    const out = genPositionData(board([fp({ angle: 90 })]), BOTH);

    // Ref and Val at the 8-character minimum, package at its own length,
    // two spaces between columns, PosX/PosY right-aligned in 9 and Rot in 8.
    expect(rows(out.data)).toEqual([
      'R1        10k       R_0805_2012Metric    10.0000    -5.0000   90.0000  top',
    ]);
  });

  it('puts the back side first', () => {
    // sortFPlist is descending layer id and B.Cu is 2, so the back leads. The
    // comment above it upstream says "top layer first" and is a fossil.
    const b = board([fp({ reference: 'R1' }), fp({ reference: 'C2', layer: 'B.Cu' })]);

    expect(rows(genPositionData(b, BOTH).data).map((r) => r.slice(0, 2))).toEqual(['C2', 'R1']);
  });

  it('negates Y so the board sits in the first quadrant', () => {
    const out = genPositionData(board([fp({ at: P(0, 5_000_000) })]), BOTH);

    expect(out.data).toContain('-5.0000');
  });

  it('negates X for the back side only, and only when asked', () => {
    const b = board([fp({ layer: 'B.Cu', at: P(10_000_000, 0) })]);

    expect(rows(genPositionData(b, BOTH).data)[0]).toContain('  10.0000');
    expect(rows(genPositionData(b, { ...BOTH, negateBottomX: true }).data)[0]).toContain(
      ' -10.0000',
    );
  });

  it('leaves the front side alone even when negating bottom X', () => {
    const b = board([fp({ layer: 'F.Cu', at: P(10_000_000, 0) })]);

    expect(rows(genPositionData(b, { ...BOTH, negateBottomX: true }).data)[0]).toContain(
      '  10.0000',
    );
  });

  it('sorts by reference within one side', () => {
    // Same layer, so the layer comparison ties and the reference decides.
    const b = board([fp({ reference: 'R10' }), fp({ reference: 'R2' }), fp({ reference: 'R1' })]);

    // strNumCmp is natural order, so R2 precedes R10.
    expect(rows(genPositionData(b, BOTH).data).map((r) => r.split(' ')[0])).toEqual([
      'R1',
      'R2',
      'R10',
    ]);
  });

  it('takes the aux origin off every coordinate when asked', () => {
    // `BOARD_DESIGN_SETTINGS::GetAuxOrigin()`, `(setup (aux_axis_origin 4 1))`.
    const withOrigin = board([fp({ at: P(10_000_000, 5_000_000) })], P(4_000_000, 1_000_000));

    // Without the flag the origin is (0,0) whatever the board says.
    expect(rows(genPositionData(withOrigin, BOTH).data)[0]).toContain('  10.0000    -5.0000');
    expect(rows(genPositionData(withOrigin, { ...BOTH, useAuxOrigin: true }).data)[0]).toContain(
      '   6.0000    -4.0000',
    );
  });

  it('widens the columns to the longest surviving entry', () => {
    // The widths come from the filtered set, not the board, so front-only and
    // back-only exports of one board legitimately differ.
    const b = board([
      fp({ reference: 'R1' }),
      fp({ reference: 'AVERYLONGREFERENCE', layer: 'B.Cu' }),
    ]);

    const both = rows(genPositionData(b, BOTH).data);
    const frontOnly = rows(genPositionData(b, { ...BOTH, backSide: false }).data);

    // Asserted whole: `startsWith` would pass on an over-wide column too,
    // which is exactly the failure being guarded against.
    expect(both[1]).toBe(
      'R1                  10k       R_0805_2012Metric    10.0000    -5.0000    0.0000  top',
    );
    expect(frontOnly[0]).toBe(
      'R1        10k       R_0805_2012Metric    10.0000    -5.0000    0.0000  top',
    );
  });

  it('replaces spaces with underscores and does not quote', () => {
    const out = genPositionData(board([fp({ value: '10 k', reference: 'R 1' })]), BOTH);

    expect(rows(out.data)[0]!.startsWith('R_1       10_k')).toBe(true);
  });

  it('capitalises All in the header while the rows stay lowercase', () => {
    const out = genPositionData(board([fp()]), BOTH);

    expect(out.data).toContain('## Side : All\n');
    expect(rows(out.data)[0]!.endsWith('top')).toBe(true);
  });

  it('names a single side in lowercase', () => {
    expect(genPositionData(board([]), { ...BOTH, backSide: false }).data).toContain(
      '## Side : top\n',
    );
    expect(genPositionData(board([]), { ...BOTH, frontSide: false }).data).toContain(
      '## Side : bottom\n',
    );
  });

  it('produces a header-only file when neither side is selected', () => {
    // Reachable, and not an error: the dialog can be left with both boxes off.
    const out = genPositionData(board([fp()]), { ...BOTH, frontSide: false, backSide: false });

    expect(out.data).toContain('## Side : ---\n');
    expect(out.footprintCount).toBe(0);
    expect(out.data.endsWith('## End\n')).toBe(true);
  });

  it('offsets the Ref header inside its own column', () => {
    // '# Ref' is padded to the reference width, so the word sits two characters
    // right of where the data starts. A parser keys off the column boundary.
    const out = genPositionData(board([fp()]), BOTH);

    expect(out.data).toContain('# Ref     Val       Package');
  });

  it('names us rather than KiCad', () => {
    const out = genPositionData(board([fp()]), BOTH);

    // One name, not two: the application and the vendor are the same word now.
    expect(out.data).toContain('### Printed by ZiroEDA version');
    expect(out.data).not.toContain('KiCad');
  });
});

describe('the CSV', () => {
  it('quotes the text fields and gives six decimals', () => {
    const out = genPositionData(board([fp({ angle: 90 })]), { ...BOTH, formatCSV: true });

    expect(out.data.split('\n')[0]).toBe('Ref,Val,Package,PosX,PosY,Rot,Side');
    expect(out.data.split('\n')[1]).toBe(
      '"R1","10k","R_0805_2012Metric",10.000000,-5.000000,90.000000,top',
    );
  });

  it('leaves a comma inside a quoted value alone', () => {
    // No escaping at all — the quotes carry it. The ASCII writer does the
    // opposite, so "unifying" the two would break one of them.
    const out = genPositionData(board([fp({ value: '0,1uF/50V' })]), { ...BOTH, formatCSV: true });

    expect(out.data).toContain('"0,1uF/50V"');
  });

  it('has no header or trailer', () => {
    const out = genPositionData(board([fp()]), { ...BOTH, formatCSV: true });

    expect(out.data).not.toContain('## End');
    expect(out.data).not.toContain('## Unit');
  });
});

describe('units', () => {
  it('switches the header and the scale together', () => {
    const mm = genPositionData(board([fp({ at: P(25_400_000, 0) })]), BOTH);
    const inch = genPositionData(board([fp({ at: P(25_400_000, 0) })]), {
      ...BOTH,
      unitsMM: false,
    });

    expect(mm.data).toContain('## Unit = mm, Angle = deg.');
    expect(rows(mm.data)[0]).toContain('  25.4000');
    expect(inch.data).toContain('## Unit = inches, Angle = deg.');
    expect(rows(inch.data)[0]).toContain('   1.0000');
  });
});

describe('file naming', () => {
  it('decorates by the sides selected', () => {
    expect(decorateFilename('board', true, true)).toBe('board-all');
    expect(decorateFilename('board', true, false)).toBe('board-top');
    expect(decorateFilename('board', false, true)).toBe('board-bottom');
    expect(decorateFilename('board', false, false)).toBe('board');
  });

  it('gives a CSV export a second suffix', () => {
    // `<board>-all-pos.csv`, not `<board>-all.csv`.
    expect(placeFileName('board', true, true, false)).toBe('board-all.pos');
    expect(placeFileName('board', true, true, true)).toBe('board-all-pos.csv');
  });
});
