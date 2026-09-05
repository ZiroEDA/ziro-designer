// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A footprint whose declared type contradicts its pads.
 * Counterparts: `FOOTPRINT::CheckFootprintAttributes` and
 * `FOOTPRINT::GetLikelyAttribute`.
 *
 * Not cosmetic: the position file feeds a pick-and-place machine, and a part
 * marked SMD that it cannot actually place should not be in it.
 *
 * The two rules that give the check its shape are that through-hole wins any
 * mix — such a part "might not be auto-placed" — and that four pad properties
 * abstain from the vote entirely.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbFootprint, PcbPad } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const smdPad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: { x: MM(5), y: MM(5) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  net: 0,
  source: EMPTY,
  ...over,
});

const thtPad = (over: Partial<PcbPad> = {}): PcbPad =>
  smdPad({
    type: 'thru_hole',
    shape: 'circle',
    layers: ['*.Cu'],
    drill: { oblong: false, w: MM(0.6), h: MM(0.6) },
    ...over,
  });

const fp = (attrs: string[], pads: PcbPad[]): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: MM(5), y: MM(5) },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  attributes: [...attrs, 'allow_missing_courtyard'],
  source: EMPTY,
});

const board = (footprints: PcbFootprint[]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints,
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
});

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const mismatch = (f: PcbFootprint) =>
  runDrc(board([f]), OPTS).filter((v) => v.code === 'footprint_type_mismatch');

describe('footprint type vs pads', () => {
  it('reports an SMD footprint carrying a through-hole pad', () => {
    const v = mismatch(fp(['smd'], [thtPad()]));

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("expected 'Through hole'");
    expect(v[0]!.message).toContain("actual 'SMD'");
  });

  it('reports a through-hole footprint with only SMD pads', () => {
    const v = mismatch(fp(['through_hole'], [smdPad()]));

    expect(v[0]!.message).toContain("expected 'SMD'");
  });

  it('accepts each type matching its pads', () => {
    expect(mismatch(fp(['smd'], [smdPad()]))).toHaveLength(0);
    expect(mismatch(fp(['through_hole'], [thtPad()]))).toHaveLength(0);
  });

  it('lets through-hole win a mixed footprint', () => {
    // "Footprints with plated through-hole pads should usually be marked
    // through hole even if they also have SMD."
    const mixed = [thtPad(), smdPad({ number: '2' })];

    expect(mismatch(fp(['through_hole'], mixed))).toHaveLength(0);
    expect(mismatch(fp(['smd'], mixed))).toHaveLength(1);
  });

  it('says nothing about a footprint that declares no type', () => {
    // Unspecified is not wrong, so it cannot contradict anything.
    expect(mismatch(fp([], [thtPad()]))).toHaveLength(0);
  });

  it('says nothing about a footprint with no pads to vote', () => {
    expect(mismatch(fp(['smd'], []))).toHaveLength(0);
  });

  it('lets a mechanical hole abstain rather than vote', () => {
    // A mounting hole in an SMD part must not turn it through-hole.
    const pads = [smdPad(), thtPad({ number: '2', padProperty: 'pad_prop_mechanical' })];

    expect(mismatch(fp(['smd'], pads))).toHaveLength(0);
  });

  it('lets fiducial, heatsink and castellated pads abstain too', () => {
    for (const prop of ['pad_prop_fiducial_glob', 'pad_prop_heatsink', 'pad_prop_castellated']) {
      const pads = [smdPad(), thtPad({ number: '2', padProperty: prop })];

      expect(mismatch(fp(['smd'], pads))).toHaveLength(0);
    }
  });

  it('still counts a testpoint or BGA pad, which do not abstain', () => {
    const pads = [smdPad(), thtPad({ number: '2', padProperty: 'pad_prop_testpoint' })];

    expect(mismatch(fp(['smd'], pads))).toHaveLength(1);
  });

  it('does not count an SMD pad that is not on copper', () => {
    // A paste-only pad is not a surface-mount connection.
    const pasteOnly = smdPad({ layers: ['F.Paste'] });

    expect(mismatch(fp(['through_hole'], [pasteOnly]))).toHaveLength(0);
  });
});
