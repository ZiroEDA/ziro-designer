// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Board Setup > Constraints values that reach DRC only as implicit rules.
 * Counterpart: `DRC_ENGINE::loadImplicitRules` (`drc_engine.cpp:165-260`).
 *
 * Five of that function's constraints had nowhere to arrive: the page edited
 * them, the project file round-tripped them, and no check ever read them.
 *
 *   board setup constraints hole              HOLE_CLEARANCE   m_HoleClearance
 *   board setup constraints silk text height  TEXT_HEIGHT      m_MinSilkTextHeight
 *   … silk text thickness                     TEXT_THICKNESS   m_MinSilkTextThickness
 *   board setup constraints micro-via         VIA_DIAMETER     m_MicroViasMinSize
 *   board setup constraints micro-via         HOLE_SIZE        m_MicroViasMinDrill
 *
 * Two things about that list are easy to get wrong and are what most of these
 * cases pin. The silk rules carry `m_LayerCondition = LSET( { F_SilkS, B_SilkS
 * } )`, so they are silkscreen minimums and must not measure text on F.Fab or
 * a copper layer. And the micro-via rule is loaded AFTER the general one under
 * `A.Via_Type == 'Micro'`, so on a micro via it REPLACES the through-via
 * minimum — including when the micro value is the smaller of the two.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbTextItem, PcbTrack, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'N1'],
    [2, 'N2'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

/** Board Setup with every minimum at zero, so one case turns on one value. */
const BASE: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const codes = (b: Board, opts: Partial<DrcOptions>, code: string): string[] =>
  runDrc(b, { ...BASE, ...opts })
    .filter((v) => v.code === code)
    .map((v) => v.message);

const track = (x0: number, x1: number, net = 1): PcbTrack => ({
  start: { x: MM(x0), y: 0 },
  end: { x: MM(x1), y: 0 },
  width: MM(0.2),
  layer: 'F.Cu',
  net,
  source: EMPTY,
});

const via = (x: number, net = 2, over: Partial<PcbVia> = {}): PcbVia => ({
  at: { x: MM(x), y: 0 },
  size: MM(0.8),
  drill: MM(0.4),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net,
  source: EMPTY,
  ...over,
});

const text = (layer: string, height: number, thickness: number): PcbTextItem => ({
  kind: 'user',
  text: 'R1',
  at: { x: 0, y: 0 },
  angle: 0,
  layer,
  size: { x: MM(height), y: MM(height) },
  thickness: MM(thickness),
  source: EMPTY,
});

// ---------------------------------------------------------------------------
// board setup constraints hole -> HOLE_CLEARANCE_CONSTRAINT

describe('copper to hole clearance', () => {
  // The track's end cap reaches x = 4.6 (its 0.2 mm width is a stadium of
  // radius 0.1) and the via's 0.4 mm drill wall stands at x = 4.8, so the gap
  // to the hole is 0.2 mm.
  const near = board({ tracks: [track(0, 4.5, 1)], vias: [via(5)] });

  it('is clean when Board Setup asks for nothing', () => {
    expect(codes(near, {}, 'hole_clearance')).toHaveLength(0);
  });

  it('reports the gap when Board Setup asks for more than it', () => {
    expect(codes(near, { minHoleClearance: MM(0.25) }, 'hole_clearance')).toEqual([
      'Hole clearance violation (clearance 0.25 mm; actual 0.2 mm)',
    ]);
  });

  it('leaves a gap that satisfies the board minimum alone', () => {
    expect(codes(near, { minHoleClearance: MM(0.05) }, 'hole_clearance')).toHaveLength(0);
  });

  it('lets a .kicad_dru rule override the board minimum, not merely raise it', () => {
    // The rule is looser than Board Setup's 0.25. Last match wins, so the
    // 0.05 stands and the board is clean — a `Math.max` of the two would
    // report.
    const dru = '(version 1)(rule loose (constraint hole_clearance (min 0.05mm)))';
    expect(
      codes(
        near,
        { minHoleClearance: MM(0.25), customRules: parseDrcRules(dru) },
        'hole_clearance',
      ),
    ).toHaveLength(0);
  });

  it('still catches copper laid across the drill with no minimum at all', () => {
    const over = board({ tracks: [track(0, 10, 1)], vias: [via(5)] });
    expect(codes(over, {}, 'hole_clearance')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// board setup constraints silk text height / thickness

describe('silkscreen text minimums', () => {
  const small = board({ texts: [text('F.SilkS', 0.5, 0.05)] });

  it('reports height and thickness under the board minimums', () => {
    const opts = { minSilkTextHeight: MM(0.8), minSilkTextThickness: MM(0.08) };
    expect(codes(small, opts, 'text_height')).toEqual([
      'Text height (min height 0.8 mm; actual 0.5 mm)',
    ]);
    expect(codes(small, opts, 'text_thickness')).toEqual([
      'Text thickness (min thickness 0.08 mm; actual 0.05 mm)',
    ]);
  });

  it('reports nothing when Board Setup asks for nothing', () => {
    expect(codes(small, {}, 'text_height')).toHaveLength(0);
    expect(codes(small, {}, 'text_thickness')).toHaveLength(0);
  });

  it('measures B.SilkS too', () => {
    const back = board({ texts: [text('B.SilkS', 0.5, 0.05)] });
    expect(codes(back, { minSilkTextHeight: MM(0.8) }, 'text_height')).toHaveLength(1);
  });

  it('leaves text on a non-silk layer alone: the rule is LSET( F_SilkS, B_SilkS )', () => {
    const opts = { minSilkTextHeight: MM(0.8), minSilkTextThickness: MM(0.08) };
    for (const layer of ['F.Fab', 'F.Cu', 'F.Mask', 'User.Comments']) {
      const other = board({ texts: [text(layer, 0.5, 0.05)] });
      expect(codes(other, opts, 'text_height'), layer).toHaveLength(0);
      expect(codes(other, opts, 'text_thickness'), layer).toHaveLength(0);
    }
  });

  it('lets a .kicad_dru rule override the silk minimum', () => {
    const dru = '(version 1)(rule tiny (constraint text_height (min 0.2mm)))';
    expect(
      codes(small, { minSilkTextHeight: MM(0.8), customRules: parseDrcRules(dru) }, 'text_height'),
    ).toHaveLength(0);
  });

  it('still reports a rule maximum, which no board setting can express', () => {
    const dru = '(version 1)(rule cap (constraint text_height (max 0.3mm)))';
    expect(codes(small, { customRules: parseDrcRules(dru) }, 'text_height')).toEqual([
      "Text height (max height 0.3 mm (rule 'cap'); actual 0.5 mm)",
    ]);
  });
});

// ---------------------------------------------------------------------------
// board setup constraints micro-via

describe('micro-via minimums', () => {
  const uvia = board({
    vias: [via(0, 1, { kind: 'micro', size: MM(0.3), drill: MM(0.15), layers: ['F.Cu', 'B.Cu'] })],
  });
  const through = board({ vias: [via(0, 1, { size: MM(0.3), drill: MM(0.15) })] });

  it('measures a micro via against the micro minimums', () => {
    const opts = { minMicroViaDiameter: MM(0.5), minMicroViaDrill: MM(0.2) };
    expect(codes(uvia, opts, 'via_diameter')).toEqual([
      'Via diameter (min diameter 0.5 mm; actual 0.3 mm)',
    ]);
    expect(codes(uvia, opts, 'microvia_drill_out_of_range')).toEqual([
      'Hole size out of range (min hole 0.2 mm; actual 0.15 mm)',
    ]);
  });

  it('replaces the through-via minimum rather than raising it', () => {
    // The micro-via rule is loaded after the general one, so a SMALLER micro
    // value wins and the via passes. A Math.max would report both.
    const opts = {
      minViaDiameter: MM(0.6),
      minThroughHole: MM(0.3),
      minMicroViaDiameter: MM(0.2),
      minMicroViaDrill: MM(0.1),
    };
    expect(codes(uvia, opts, 'via_diameter')).toHaveLength(0);
    expect(codes(uvia, opts, 'microvia_drill_out_of_range')).toHaveLength(0);
    // The same via as a through via is measured against the through minimums.
    expect(codes(through, opts, 'via_diameter')).toHaveLength(1);
    expect(codes(through, opts, 'drill_out_of_range')).toHaveLength(1);
  });

  it('falls back to the through-via minimum when no micro value is supplied', () => {
    const opts = { minViaDiameter: MM(0.6), minThroughHole: MM(0.3) };
    expect(codes(uvia, opts, 'via_diameter')).toHaveLength(1);
    expect(codes(uvia, opts, 'microvia_drill_out_of_range')).toHaveLength(1);
  });

  it('leaves a through via out of the micro-via rule entirely', () => {
    const opts = { minMicroViaDiameter: MM(0.5), minMicroViaDrill: MM(0.2) };
    expect(codes(through, opts, 'via_diameter')).toHaveLength(0);
    expect(codes(through, opts, 'drill_out_of_range')).toHaveLength(0);
  });
});
