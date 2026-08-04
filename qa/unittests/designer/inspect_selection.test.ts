// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Turning the PCB editor's selection into a resolution report.
 * Counterpart: the selection handling at the top of
 * `BOARD_INSPECTION_TOOL::InspectClearance`.
 *
 * This lives in its own module rather than inside PcbEditor so it can be
 * tested — which items a selection resolves to, and which report that
 * produces, is logic; the dialog around it is not.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { parseDrcRules } from '@ziroeda/pcbnew';
import type { Board } from '@ziroeda/pcbnew';
import {
  describeSelected,
  inspectSelection,
} from '@ziroeda/designer/src/editors/pcb/inspect_selection.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const board = (): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'GND'],
  ]),
  footprints: [
    {
      lib: 'L:R',
      reference: 'R1',
      at: { x: MM(5), y: MM(5) },
      angle: 0,
      layer: 'F.Cu',
      pads: [
        {
          number: '1',
          type: 'smd',
          shape: 'rect',
          at: { x: MM(5), y: MM(5) },
          angle: 0,
          size: { x: MM(1), y: MM(1) },
          layers: ['F.Cu'],
          net: 1,
          source: EMPTY,
        },
      ],
      shapes: [],
      texts: [],
      models: [],
      source: EMPTY,
    },
  ],
  tracks: [
    {
      start: { x: 0, y: 0 },
      end: { x: MM(10), y: 0 },
      width: MM(0.2),
      layer: 'F.Cu',
      net: 1,
      source: EMPTY,
    },
  ],
  arcs: [],
  vias: [
    {
      at: { x: MM(3), y: MM(3) },
      size: MM(0.6),
      drill: MM(0.3),
      layers: ['F.Cu', 'B.Cu'],
      kind: 'through',
      net: 1,
      source: EMPTY,
    },
  ],
  zones: [
    {
      net: 1,
      name: 'GNDPOUR',
      layers: ['F.Cu'],
      fills: [],
      outline: [
        { x: 0, y: 0 },
        { x: MM(20), y: 0 },
        { x: MM(20), y: MM(20) },
      ],
      source: EMPTY,
    },
  ],
  shapes: [
    {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: MM(5), y: 0 },
      width: MM(0.1),
      fill: false,
      layer: 'F.SilkS',
      source: EMPTY,
    },
  ],
  texts: [],
  dimensions: [],
  textBoxes: [],
  groups: [],
  source: EMPTY,
});

const RULES = parseDrcRules(`(version 1) (rule "wide" (constraint clearance (min 0.5mm)))`);
const noClasses = () => [];

describe('describeSelected', () => {
  const b = board();

  it('names a track by its net and layer', () => {
    expect(describeSelected(b, 'track:0')?.desc).toBe('Track [GND] on F.Cu');
  });

  it('names a pad by its number and footprint', () => {
    expect(describeSelected(b, 'pad:0:0')?.desc).toBe('Pad 1 of R1');
  });

  it('prefers a zone’s name over its net', () => {
    expect(describeSelected(b, 'zone:0')?.desc).toBe("Zone 'GNDPOUR'");
  });

  it('takes a via’s layer from its span', () => {
    expect(describeSelected(b, 'via:0')?.layer).toBe('F.Cu');
  });

  it('returns nothing for a kind with no copper to resolve against', () => {
    // A silkscreen graphic has no clearance question to answer, so it yields
    // no section rather than an empty one.
    expect(describeSelected(b, 'shape:0')).toBeNull();
  });

  it('returns nothing for an id that does not resolve', () => {
    expect(describeSelected(b, 'track:99')).toBeNull();
    expect(describeSelected(b, 'nonsense')).toBeNull();
  });
});

describe('inspectSelection', () => {
  const b = board();

  it('gives a clearance report for two items', () => {
    const s = inspectSelection(b, ['track:0', 'pad:0:0'], RULES, noClasses);

    expect(s).toHaveLength(1);
    expect(s[0]!.title).toBe('Clearance resolution for:');
    expect(s[0]!.subjects).toContain('Track [GND] on F.Cu');
    expect(s[0]!.subjects).toContain('Pad 1 of R1');
  });

  it('gives the thermal sections for a pad and a zone', () => {
    const s = inspectSelection(b, ['pad:0:0', 'zone:0'], RULES, noClasses);

    expect(s.map((x) => x.title)).toContain('Zone connection resolution for:');
  });

  it('gives a constraints report for one item', () => {
    const s = inspectSelection(b, ['via:0'], RULES, noClasses);

    expect(s.map((x) => x.title)).toEqual([
      'via_diameter resolution for:',
      'hole_size resolution for:',
      'annular_width resolution for:',
    ]);
  });

  it('gives nothing for an empty selection', () => {
    expect(inspectSelection(b, [], RULES, noClasses)).toHaveLength(0);
  });

  it('gives nothing for three items', () => {
    // Upstream's picker asks for exactly two; more than that has no question.
    expect(inspectSelection(b, ['track:0', 'via:0', 'pad:0:0'], RULES, noClasses)).toHaveLength(0);
  });

  it('ignores selected items that resolve to nothing', () => {
    // A track plus a silkscreen line is a one-item selection as far as the
    // report is concerned, not a pair.
    const s = inspectSelection(b, ['track:0', 'shape:0'], RULES, noClasses);

    expect(s.map((x) => x.title)).toEqual([
      'track_width resolution for:',
      'track_segment_length resolution for:',
      'track_angle resolution for:',
    ]);
  });

  it('carries the netclasses through to the rule walk', () => {
    const hv = inspectSelection(
      b,
      ['track:0', 'pad:0:0'],
      parseDrcRules(`(version 1)
        (rule "hv" (constraint clearance (min 2mm)) (condition "A.NetClass == 'HV'"))`),
      () => ['HV'],
    );

    expect(hv[0]!.lines.join('\n')).toContain(`Resolved clearance: min ${MM(2)}.`);
  });
});
