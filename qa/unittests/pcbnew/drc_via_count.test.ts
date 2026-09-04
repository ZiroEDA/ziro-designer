// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Too many or too few vias on a connection.
 * Counterpart: `DRC_TEST_PROVIDER_MATCHED_LENGTH::checkViaCounts`.
 *
 * The one constraint of that provider that does not need KiCad's length
 * calculator, so it is the one ported. Rule-driven: no `via_count` constraint,
 * no check.
 *
 * Known limit, stated in the engine too: upstream counts vias on the
 * *optimised connection path* and can drop a via contributing nothing to the
 * route; we count the vias on the net. For an ordinary point-to-point net the
 * two agree.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const via = (x: number, net = 1): PcbVia => ({
  at: { x: MM(x), y: MM(5) },
  size: MM(0.6),
  drill: MM(0.3),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net,
  source: EMPTY,
});

const board = (vias: PcbVia[]): Board => ({
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
  vias,
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  groups: [],
  source: EMPTY,
});

const BASE: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const counts = (b: Board, dru?: string) =>
  runDrc(b, { ...BASE, ...(dru ? { customRules: parseDrcRules(dru) } : {}) }).filter(
    (v) => v.code === 'too_many_vias',
  );

const rule = (body: string) => `(version 1) (rule "vias" (constraint via_count ${body}))`;

describe('via count', () => {
  it('is not checked at all without a rule', () => {
    expect(counts(board([via(0), via(5), via(10)]))).toHaveLength(0);
  });

  it('reports a net with more vias than the maximum', () => {
    const v = counts(board([via(0), via(5), via(10)]), rule('(max 2)'));

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('Too many vias');
    expect(v[0]!.message).toContain('actual 3');
  });

  it('reports a net with fewer vias than the minimum', () => {
    const v = counts(board([via(0)]), rule('(min 2)'));

    expect(v[0]!.message).toContain('Too few vias');
  });

  it('accepts a count inside the range', () => {
    expect(counts(board([via(0), via(5)]), rule('(min 1) (max 3)'))).toHaveLength(0);
  });

  it('counts each net separately', () => {
    // Three on net 1, one on net 2: only net 1 exceeds a maximum of two.
    const b = board([via(0), via(5), via(10), via(20, 2)]);

    expect(counts(b, rule('(max 2)'))).toHaveLength(1);
  });

  it('names the rule that set the limit', () => {
    expect(counts(board([via(0), via(5)]), rule('(max 1)'))[0]!.message).toContain("rule 'vias'");
  });

  it('ignores vias with no net', () => {
    // A netless via is not part of any connection to count.
    expect(counts(board([via(0, 0), via(5, 0), via(10, 0)]), rule('(max 1)'))).toHaveLength(0);
  });

  it('reports a net once, not once per via', () => {
    const b = board([via(0), via(5), via(10), via(15), via(20)]);

    expect(counts(b, rule('(max 2)'))).toHaveLength(1);
  });

  it('reports once under a contradictory rule, taking the maximum', () => {
    // min 5 / max 2 is user error, and the only way the two branches can both
    // be true at once — which is what upstream's else-if is there for. Three
    // vias are over the max *and* under the min; one marker, saying "too many".
    const v = counts(board([via(0), via(5), via(10)]), rule('(min 5) (max 2)'));

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('Too many');
  });
});
