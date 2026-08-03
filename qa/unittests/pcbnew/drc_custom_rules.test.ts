// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `.kicad_dru` rule changing a DRC result.
 *
 * #225 parsed the rules and #227 resolved them; this is the step where they
 * reach the checks. Everything here asserts the *difference* a rule makes,
 * because a rule that parses and resolves but never reaches a provider looks
 * exactly like a board that passed.
 */
import { describe, it, expect } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { runDrc, type DrcOptions } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbTrack, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const track = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  net = 1,
): PcbTrack => ({ start, end, width, layer: 'F.Cu', net, source: EMPTY });

const via = (at: { x: number; y: number }, size: number, drill: number, net = 1): PcbVia => ({
  at,
  size,
  drill,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net,
  source: EMPTY,
});

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
  groups: [],
  source: EMPTY,
  ...over,
});

/** Board-setup values loose enough that nothing trips without a rule. */
const BASE: DrcOptions = {
  minClearance: MM(0.1),
  minTrackWidth: MM(0.1),
  minViaDiameter: MM(0.4),
  minViaAnnulus: MM(0.05),
  minThroughHole: MM(0.2),
  minHoleToHole: MM(0.2),
};

const withRules = (dru: string, extra: Partial<DrcOptions> = {}): DrcOptions => ({
  ...BASE,
  ...extra,
  customRules: parseDrcRules(dru),
});

describe('clearance', () => {
  // Two different-net tracks 0.3 mm apart.
  const b = board({
    tracks: [
      track({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(0.2), 1),
      track({ x: 0, y: MM(0.5) }, { x: MM(10), y: MM(0.5) }, MM(0.2), 2),
    ],
  });

  it('passes at the board default', () => {
    expect(runDrc(b, BASE).filter((v) => v.code === 'clearance')).toHaveLength(0);
  });

  it('a tighter custom rule makes it fail', () => {
    const v = runDrc(b, withRules(`(version 1) (rule "wide" (constraint clearance (min 0.5mm)))`));
    const c = v.filter((x) => x.code === 'clearance');

    expect(c).toHaveLength(1);
    expect(c[0]!.message).toContain('0.5 mm');
    // The message says which rule imposed it, as upstream's marker does.
    expect(c[0]!.message).toContain("rule 'wide'");
  });

  it('a rule whose condition does not match leaves it passing', () => {
    const v = runDrc(
      b,
      withRules(`(version 1)
        (rule "hv" (constraint clearance (min 0.5mm)) (condition "A.NetClass == 'HV'"))`),
    );
    expect(v.filter((x) => x.code === 'clearance')).toHaveLength(0);
  });

  it('fires once the netclass matches', () => {
    const v = runDrc(
      b,
      withRules(
        `(version 1)
         (rule "hv" (constraint clearance (min 0.5mm)) (condition "A.NetClass == 'HV'"))`,
        { netClassesOf: (net) => (net === 1 ? ['HV'] : ['Default']) },
      ),
    );
    expect(v.filter((x) => x.code === 'clearance')).toHaveLength(1);
  });

  it('a looser custom rule silences a board-default failure', () => {
    const strict: DrcOptions = { ...BASE, minClearance: MM(1) };
    expect(runDrc(b, strict).filter((x) => x.code === 'clearance')).toHaveLength(1);

    const relaxed = runDrc(b, {
      ...strict,
      customRules: parseDrcRules(`(version 1) (rule "loose" (constraint clearance (min 0.1mm)))`),
    });
    expect(relaxed.filter((x) => x.code === 'clearance')).toHaveLength(0);
  });

  it('a user rule overrides the netclass clearance, in both directions', () => {
    const withNetclass: DrcOptions = { ...BASE, clearanceOf: () => MM(1) };
    expect(runDrc(b, withNetclass).filter((x) => x.code === 'clearance')).toHaveLength(1);

    // The netclass says 1 mm; the user rule says 0.1 mm and wins.
    const overridden = runDrc(b, {
      ...withNetclass,
      customRules: parseDrcRules(`(version 1) (rule "loose" (constraint clearance (min 0.1mm)))`),
    });
    expect(overridden.filter((x) => x.code === 'clearance')).toHaveLength(0);
  });
});

describe('track width', () => {
  const b = board({ tracks: [track({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(0.2))] });

  it('a custom min makes a passing track fail', () => {
    const v = runDrc(b, withRules(`(version 1) (rule "fat" (constraint track_width (min 0.5mm)))`));
    const t = v.filter((x) => x.code === 'track_width');

    expect(t).toHaveLength(1);
    expect(t[0]!.message).toContain("rule 'fat'");
  });

  it('a custom max catches a track that is too wide', () => {
    // Nothing in Board Setup can express a maximum; only a rule can.
    const v = runDrc(
      b,
      withRules(`(version 1) (rule "thin" (constraint track_width (max 0.1mm)))`),
    );
    const t = v.filter((x) => x.code === 'track_width');

    expect(t).toHaveLength(1);
    expect(t[0]!.message).toContain('max width');
  });

  it('applies a rule only on the layer it names', () => {
    const v = runDrc(
      b,
      withRules(`(version 1)
        (rule "innerFat" (layer inner) (constraint track_width (min 0.5mm)))`),
    );
    // The track is on F.Cu, so an inner-layer rule must not touch it.
    expect(v.filter((x) => x.code === 'track_width')).toHaveLength(0);
  });
});

describe('vias', () => {
  const b = board({ vias: [via({ x: 0, y: 0 }, MM(0.6), MM(0.3))] });

  it('a custom via diameter fires', () => {
    const v = runDrc(
      b,
      withRules(`(version 1) (rule "bigvia" (constraint via_diameter (min 1mm)))`),
    );
    expect(v.filter((x) => x.code === 'via_diameter')).toHaveLength(1);
  });

  it('a custom hole size fires', () => {
    const v = runDrc(
      b,
      withRules(`(version 1) (rule "bighole" (constraint hole_size (min 0.5mm)))`),
    );
    expect(v.filter((x) => x.code === 'drill_out_of_range')).toHaveLength(1);
  });

  it('a custom annular width fires', () => {
    const v = runDrc(
      b,
      withRules(`(version 1) (rule "ring" (constraint annular_width (min 0.4mm)))`),
    );
    expect(v.filter((x) => x.code === 'annular_width')).toHaveLength(1);
  });

  it('a rule keyed on Type == Via matches a via and not a track', () => {
    const mixed = board({
      vias: [via({ x: 0, y: 0 }, MM(0.6), MM(0.3))],
      tracks: [track({ x: MM(20), y: 0 }, { x: MM(30), y: 0 }, MM(0.2))],
    });
    const v = runDrc(
      mixed,
      withRules(`(version 1)
        (rule "viaOnly" (constraint via_diameter (min 1mm)) (condition "A.Type == 'Via'"))
        (rule "notTracks" (constraint track_width (min 0.5mm)) (condition "A.Type == 'Via'"))`),
    );

    expect(v.filter((x) => x.code === 'via_diameter')).toHaveLength(1);
    // The second rule targets vias, so the track must be left alone.
    expect(v.filter((x) => x.code === 'track_width')).toHaveLength(0);
  });
});

describe('hole to hole', () => {
  it('a custom minimum fires', () => {
    const b = board({
      vias: [
        via({ x: 0, y: 0 }, MM(0.6), MM(0.3), 1),
        via({ x: MM(0.8), y: 0 }, MM(0.6), MM(0.3), 2),
      ],
    });

    expect(runDrc(b, BASE).filter((x) => x.code === 'hole_to_hole')).toHaveLength(0);

    const v = runDrc(b, withRules(`(version 1) (rule "far" (constraint hole_to_hole (min 1mm)))`));
    expect(v.filter((x) => x.code === 'hole_to_hole')).toHaveLength(1);
  });
});

describe('no rules', () => {
  it('behaves exactly as before when no .kicad_dru is supplied', () => {
    const b = board({
      tracks: [track({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(0.05))],
      vias: [via({ x: MM(20), y: 0 }, MM(0.3), MM(0.1))],
    });

    const before = runDrc(b, BASE);
    const after = runDrc(b, { ...BASE, customRules: parseDrcRules('') });

    expect(after).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it('a rule file that will not parse changes nothing', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(0.05))] });

    expect(runDrc(b, withRules('this is not a rule file ((('))).toEqual(runDrc(b, BASE));
  });
});
