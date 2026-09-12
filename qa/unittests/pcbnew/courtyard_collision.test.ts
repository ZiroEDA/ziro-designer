// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live courtyard-collision feedback during a move.
 * Counterpart: `pcbnew/drc/drc_interactive_courtyard_clearance.cpp`.
 *
 * This is the red wash a footprint gets while you drag another one on top of
 * it. It is NOT the `courtyards_overlap` DRC violation: it runs per frame, it
 * collides at a hardcoded zero clearance, it marks BOTH sides including the
 * footprint under the cursor, and it also fires on a pad hole inside the other
 * courtyard and on a rule area that disallows footprints.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  beginCourtyardConflicts,
  conflictShadowRings,
  courtyardConflictsAt,
} from '@ziroeda/pcbnew/src/courtyard_collision.js';
import type { Board, PcbFootprint, PcbPad, PcbShape, PcbZone } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

const line = (x0: number, y0: number, x1: number, y1: number, layer: string): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.05),
  fillMode: 'none',
  layer,
});

/** Four hand-drawn lines closing into a box, which is what a courtyard is. */
const courtyard = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  layer = 'F.CrtYd',
): PcbShape[] => [
  line(x0, y0, x1, y0, layer),
  line(x1, y0, x1, y1, layer),
  line(x1, y1, x0, y1, layer),
  line(x0, y1, x0, y0, layer),
];

const drilledPad = (x: number, y: number): PcbPad => ({
  number: '1',
  type: 'thru_hole',
  shape: 'circle',
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  size: { x: MM(1.5), y: MM(1.5) },
  drill: { oblong: false, w: MM(0.8), h: MM(0.8) },
  layers: ['*.Cu'],
  net: 0,
});

const footprint = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads: [],
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  ...over,
});

const board = (footprints: PcbFootprint[], zones: PcbZone[] = []): Board => ({
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
  zones,
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
});

/** fp 0 static at 0..10 mm, fp 1 moving at 20..30 mm — 10 mm of clear air. */
const twoBoxes = (): Board =>
  board([
    footprint({ reference: 'A', shapes: courtyard(0, 0, 10, 10), pads: [drilledPad(5, 5)] }),
    footprint({ reference: 'B', shapes: courtyard(20, 0, 30, 10), pads: [drilledPad(25, 5)] }),
  ]);

const at = (b: Board, moving: number[], dx: number, dy = 0) => {
  const s = beginCourtyardConflicts(b, moving);
  const c = courtyardConflictsAt(s, { x: MM(dx), y: MM(dy) });
  return { session: s, fps: [...c.footprints].sort(), zones: [...c.zones].sort() };
};

describe('courtyard collisions while moving', () => {
  it('reports nothing until the courtyards actually touch', () => {
    expect(at(twoBoxes(), [1], 0).fps).toEqual([]);
    // 9 mm still leaves a millimetre between 10 and 11.
    expect(at(twoBoxes(), [1], -9).fps).toEqual([]);
  });

  it('marks BOTH footprints, the moving one included', () => {
    // -12 mm puts B's box at 8..18, two millimetres into A's.
    // `UpdateConflicts( view, aHighlightMoved = true )` — the move tool passes
    // true, so the part under the cursor is shaded too, not just the victim.
    expect(at(twoBoxes(), [1], -12).fps).toEqual([0, 1]);
  });

  it('clears again when the part is dragged back off', () => {
    const s = beginCourtyardConflicts(twoBoxes(), [1]);
    expect([...courtyardConflictsAt(s, { x: MM(-12), y: 0 }).footprints]).toEqual([0, 1]);
    expect([...courtyardConflictsAt(s, { x: 0, y: 0 }).footprints]).toEqual([]);
  });

  it('never lights up a footprint that draws no courtyard', () => {
    // "No courtyards defined and no hole testing against other footprint's
    // courtyards" — fpA is `continue`d before anything is tested, so a
    // footprint with no F.CrtYd graphics is invisible to this even when the
    // moving part lands right on top of it.
    const b = board([
      footprint({ reference: 'A', pads: [drilledPad(5, 5)] }),
      footprint({ reference: 'B', shapes: courtyard(20, 0, 30, 10) }),
    ]);
    expect(at(b, [1], -20).fps).toEqual([]);
  });

  it('fires on a pad hole of the moving part inside the static courtyard', () => {
    // B draws no courtyard at all, so nothing here is a courtyard-to-courtyard
    // hit; it is `testPadAgainstCourtyards` on B's drilled pad.
    const b = board([
      footprint({ reference: 'A', shapes: courtyard(0, 0, 10, 10) }),
      footprint({ reference: 'B', pads: [drilledPad(25, 5)] }),
    ]);
    expect(at(b, [1], 0).fps).toEqual([]);
    expect(at(b, [1], -20).fps).toEqual([0, 1]);
  });

  it('fires the other way too — a static pad hole inside the moving courtyard', () => {
    // A's pad sits OUTSIDE A's own courtyard, and B stops 2 mm short of it, so
    // the only thing that can match is the second direction of the pad test.
    const b = board([
      footprint({ reference: 'A', shapes: courtyard(0, 0, 10, 10), pads: [drilledPad(14, 5)] }),
      footprint({ reference: 'B', shapes: courtyard(20, 0, 30, 10) }),
    ]);
    expect(at(b, [1], -8).fps).toEqual([0, 1]);
  });

  it('only collides a side with its own side', () => {
    // A's courtyard is on the BACK, B's on the front. Courtyards "only collide
    // with their own side of the board", so laying one over the other is not a
    // conflict — and A has no front courtyard to test B's hole against either.
    const b = board([
      footprint({ reference: 'A', shapes: courtyard(0, 0, 10, 10, 'B.CrtYd') }),
      footprint({ reference: 'B', shapes: courtyard(20, 0, 30, 10) }),
    ]);
    expect(at(b, [1], -20).fps).toEqual([]);
  });

  it('fires on a rule area that disallows footprints, and shades the zone', () => {
    const keepout = (footprints: boolean, layers = ['F.Cu']): PcbZone => ({
      net: 0,
      layers,
      fills: [],
      outline: [
        { x: MM(0), y: MM(0) },
        { x: MM(10), y: MM(0) },
        { x: MM(10), y: MM(10) },
        { x: MM(0), y: MM(10) },
      ],
      ruleArea: { tracks: false, vias: false, pads: false, copperPour: false, footprints },
    });

    const moving = footprint({ reference: 'B', shapes: courtyard(20, 0, 30, 10) });

    const hit = at(board([moving], [keepout(true)]), [0], -12);
    expect(hit.fps).toEqual([0]);
    expect(hit.zones).toEqual([0]);

    // A rule area that allows footprints is not one of these at all.
    expect(at(board([moving], [keepout(false)]), [0], -12).zones).toEqual([]);
    // …nor is one whose layers are all on the other side.
    expect(at(board([moving], [keepout(true, ['B.Cu'])]), [0], -12).zones).toEqual([]);
  });

  it('hands the painter the courtyard at its MOVED position', () => {
    // `PCB_PAINTER::draw( FOOTPRINT*, LAYER_CONFLICTS_SHADOW )` fills
    // `GetCourtyard()`, and during a move the footprint has already moved. The
    // static one has not, so only one of the two rings shifts.
    const { session } = at(twoBoxes(), [1], -12);
    const d = { x: MM(-12), y: 0 };
    const staticRing = conflictShadowRings(session, 0, d);
    const movedRing = conflictShadowRings(session, 1, d);
    const xs = (rings: { x: number; y: number }[][]) => rings[0]!.map((p) => p.x / MM(1));

    // The deflation by maxError (0.005 mm) pulls each edge in, so compare to
    // three decimals rather than pretending the box is exactly 0..10.
    expect(Math.min(...xs(staticRing))).toBeCloseTo(0.005, 3);
    expect(Math.max(...xs(staticRing))).toBeCloseTo(9.995, 3);
    expect(Math.min(...xs(movedRing))).toBeCloseTo(8.005, 3);
    expect(Math.max(...xs(movedRing))).toBeCloseTo(17.995, 3);
  });
});
