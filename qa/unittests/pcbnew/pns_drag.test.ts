// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Track dragging, against the rules pcbnew/router/pns_line.cpp and
 * pns_dragger.cpp lay down: which corner or segment a grab picks up, how a
 * corner drag rebuilds the 45° knees, and how a segment drag re-cuts its
 * neighbours.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew';
import { Direction45, Directions } from '@ziroeda/kimath/src/geometry/direction45.js';
import {
  dragCorner,
  dragSegment45,
  simplify,
  segmentCount,
} from '@ziroeda/pcbnew/src/router/pns_line.js';
import {
  assembleLine,
  startTrackDrag,
  updateTrackDrag,
  applyTrackDrag,
  trackDragSegments,
} from '@ziroeda/pcbnew/src/router/pns_drag.js';
import type { Board, PcbTrack, PcbPad, PcbFootprint } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };

const track = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  net = 1,
  width = 200,
  layer = 'F.Cu',
): PcbTrack => ({ start, end, width, layer, net, source: EMPTY });

const pad = (at: { x: number; y: number }, net = 1): PcbPad => ({
  number: '1',
  type: 'thru_hole',
  shape: 'circle',
  at,
  angle: 0,
  size: { x: 600, y: 600 },
  layers: ['*.Cu'],
  net,
  source: EMPTY,
});
const footprint = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'R',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  models: [],
  source: EMPTY,
});

const board = (over: Partial<Board>): Board => ({
  version: 20241229,
  layers: [],
  nets: new Map([[1, 'N1']]),
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
  groups: [],
  source: EMPTY,
  ...over,
});

const pts = (c: { x: number; y: number }[]): [number, number][] => c.map((p) => [p.x, p.y]);

describe('DIRECTION_45', () => {
  it('north is up, which is negative y', () => {
    expect(Direction45.fromVector({ x: 0, y: -1 }).dir).toBe(Directions.N);
    expect(Direction45.fromVector({ x: 0, y: 1 }).dir).toBe(Directions.S);
    expect(Direction45.fromVector({ x: 1, y: 0 }).dir).toBe(Directions.E);
    expect(Direction45.fromVector({ x: 1, y: 1 }).dir).toBe(Directions.SE);
  });

  it('rounds an off-angle vector to the nearest octant', () => {
    expect(Direction45.fromVector({ x: 10, y: -1 }).dir).toBe(Directions.E);
    expect(Direction45.fromVector({ x: 10, y: -9 }).dir).toBe(Directions.NE);
  });

  it('turns left and right by one octant, and knows its angles', () => {
    const e = Direction45.of(Directions.E);
    expect(e.right().dir).toBe(Directions.SE);
    expect(e.left().dir).toBe(Directions.NE);
    expect(e.isObtuse(Direction45.of(Directions.NE))).toBe(true);
    expect(e.isObtuse(Direction45.of(Directions.W))).toBe(false);
    expect(e.isDiagonal()).toBe(false);
    expect(Direction45.of(Directions.SE).isDiagonal()).toBe(true);
  });

  it('BuildInitialTrace: one segment when straight or exactly diagonal', () => {
    const d = Direction45.UNDEFINED;
    expect(pts(d.buildInitialTrace({ x: 0, y: 0 }, { x: 1000, y: 0 }))).toEqual([
      [0, 0],
      [1000, 0],
    ]);
    expect(pts(d.buildInitialTrace({ x: 0, y: 0 }, { x: 1000, y: 1000 }))).toEqual([
      [0, 0],
      [1000, 1000],
    ]);
  });

  it('BuildInitialTrace: straight-then-diagonal, or diagonal-first', () => {
    const d = Direction45.UNDEFINED;
    // w > h: the straight run takes up the slack, then 45° in to the target.
    expect(pts(d.buildInitialTrace({ x: 0, y: 0 }, { x: 1000, y: 300 }))).toEqual([
      [0, 0],
      [700, 0],
      [1000, 300],
    ]);
    expect(pts(d.buildInitialTrace({ x: 0, y: 0 }, { x: 1000, y: 300 }, true))).toEqual([
      [0, 0],
      [300, 300],
      [1000, 300],
    ]);
  });
});

describe('chain simplify', () => {
  it('drops collinear knees and duplicate points', () => {
    expect(
      pts(
        simplify([
          { x: 0, y: 0 },
          { x: 500, y: 0 },
          { x: 1000, y: 0 },
        ]),
      ),
    ).toEqual([
      [0, 0],
      [1000, 0],
    ]);
    expect(
      pts(
        simplify([
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
        ]),
      ),
    ).toEqual([
      [0, 0],
      [1000, 0],
    ]);
  });

  it('keeps a real corner', () => {
    const c = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ];
    expect(simplify(c)).toHaveLength(3);
  });
});

describe('corner drag', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 2000, y: 0 },
  ];

  it('free angle puts the corner exactly on the cursor', () => {
    const out = dragCorner(line, { x: 2500, y: 700 }, 1, true);
    expect(pts(out)).toEqual([
      [0, 0],
      [2500, 700],
    ]);
  });

  it('45° mode reaches the cursor through a knee, never off-angle', () => {
    const out = dragCorner(line, { x: 2500, y: 700 }, 1, false);
    expect(pts(out)[0]).toEqual([0, 0]);
    expect(pts(out).at(-1)).toEqual([2500, 700]);
    // Every segment is axis-aligned or exactly diagonal.
    for (let i = 0; i < segmentCount(out); i++) {
      const dx = Math.abs(out[i + 1]!.x - out[i]!.x);
      const dy = Math.abs(out[i + 1]!.y - out[i]!.y);
      expect(dx === 0 || dy === 0 || dx === dy).toBe(true);
    }
  });

  it('dragging the start corner keeps the far end pinned', () => {
    const out = dragCorner(line, { x: -500, y: -500 }, 0, false);
    expect(pts(out).at(-1)).toEqual([2000, 0]);
    expect(pts(out)[0]).toEqual([-500, -500]);
  });
});

describe('segment drag', () => {
  // A three-segment staircase: E, then the middle run, then E again.
  const line = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1000 },
    { x: 2000, y: 1000 },
  ];

  it('slides the grabbed segment and keeps both ends pinned', () => {
    const out = dragSegment45(line, { x: 1400, y: 500 }, 1);
    expect(pts(out)[0]).toEqual([0, 0]);
    expect(pts(out).at(-1)).toEqual([2000, 1000]);
    // The dragged run moved right, off its original x.
    expect(out.some((p) => p.x > 1000 && p.x < 2000)).toBe(true);
    for (let i = 0; i < segmentCount(out); i++) {
      const dx = Math.abs(out[i + 1]!.x - out[i]!.x);
      const dy = Math.abs(out[i + 1]!.y - out[i]!.y);
      expect(dx === 0 || dy === 0 || dx === dy).toBe(true);
    }
  });
});

describe('assembleLine (NODE::AssembleLine)', () => {
  it('walks the whole run of connected same-net segments', () => {
    const b = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }),
        track({ x: 1000, y: 0 }, { x: 1000, y: 1000 }),
        track({ x: 1000, y: 1000 }, { x: 2000, y: 1000 }),
      ],
    });
    const line = assembleLine(b, 1)!;
    expect(pts(line.chain)).toEqual([
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [2000, 1000],
    ]);
    expect(line.tracks).toEqual([0, 1, 2]);
    expect(line.originSegment).toBe(1); // the seed is the middle segment
  });

  it('stops at a branch, so a tee does not drag the third leg', () => {
    const b = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }),
        track({ x: 1000, y: 0 }, { x: 2000, y: 0 }),
        track({ x: 1000, y: 0 }, { x: 1000, y: 1000 }), // the tee
      ],
    });
    expect(assembleLine(b, 0)!.tracks).toEqual([0]);
  });

  it('stops at a pad and at a via', () => {
    const withPad = board({
      footprints: [footprint([pad({ x: 1000, y: 0 })])],
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }),
        track({ x: 1000, y: 0 }, { x: 2000, y: 0 }),
      ],
    });
    expect(assembleLine(withPad, 0)!.tracks).toEqual([0]);

    const withVia = board({
      vias: [
        {
          at: { x: 1000, y: 0 },
          size: 600,
          drill: 300,
          layers: ['F.Cu', 'B.Cu'],
          kind: 'through',
          net: 1,
          source: EMPTY,
        },
      ],
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }),
        track({ x: 1000, y: 0 }, { x: 2000, y: 0 }),
      ],
    });
    expect(assembleLine(withVia, 0)!.tracks).toEqual([0]);
  });

  it('stops where the width changes or the layer differs', () => {
    const b = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1, 200),
        track({ x: 1000, y: 0 }, { x: 2000, y: 0 }, 1, 400),
      ],
    });
    expect(assembleLine(b, 0)!.tracks).toEqual([0]);

    const layered = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1, 200, 'F.Cu'),
        track({ x: 1000, y: 0 }, { x: 2000, y: 0 }, 1, 200, 'B.Cu'),
      ],
    });
    expect(assembleLine(layered, 0)!.tracks).toEqual([0]);
  });
});

describe('startTrackDrag (DRAGGER::startDragSegment)', () => {
  const b = board({
    tracks: [
      track({ x: 0, y: 0 }, { x: 1000, y: 0 }),
      track({ x: 1000, y: 0 }, { x: 1000, y: 1000 }),
    ],
  });

  it('grabbing within half a width of an end drags that corner', () => {
    const d = startTrackDrag(b, 0, { x: 990, y: 0 })!; // width 200 -> w2 = 100
    expect(d.mode).toBe('corner');
    expect(d.index).toBe(1); // the shared corner
  });

  it('grabbing the middle slides the segment', () => {
    const d = startTrackDrag(b, 0, { x: 500, y: 0 })!;
    expect(d.mode).toBe('segment');
    expect(d.index).toBe(0);
  });

  it('free-angle mode always drags a corner, never a segment', () => {
    const d = startTrackDrag(b, 0, { x: 500, y: 0 }, { freeAngle: true })!;
    expect(d.mode).toBe('corner');
  });

  it('uses width/4 as the snap threshold when smoothing is on', () => {
    expect(startTrackDrag(b, 0, { x: 500, y: 0 })!.snapThreshold).toBe(50);
    expect(
      startTrackDrag(b, 0, { x: 500, y: 0 }, { smoothDraggedSegments: false })!.snapThreshold,
    ).toBe(0);
  });
});

describe('applyTrackDrag', () => {
  it('writes the dragged line back, keeping the untouched tracks', () => {
    const b = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }),
        track({ x: 1000, y: 0 }, { x: 1000, y: 1000 }),
        track({ x: 5000, y: 5000 }, { x: 6000, y: 5000 }, 2), // another net
      ],
    });
    const drag = startTrackDrag(b, 0, { x: 1000, y: 0 })!; // corner grab
    const chain = updateTrackDrag(drag, { x: 1200, y: 200 });
    const out = applyTrackDrag(b, drag, chain);

    // The other net is untouched and the line still runs end to end.
    expect(out.tracks.some((t) => t.net === 2)).toBe(true);
    const line = out.tracks.filter((t) => t.net === 1);
    expect(line[0]!.start).toEqual({ x: 0, y: 0 });
    expect(line.at(-1)!.end).toEqual({ x: 1000, y: 1000 });
    for (const t of line) {
      expect(t.width).toBe(200);
      expect(t.layer).toBe('F.Cu');
    }
  });

  it('drops the segments a shortened line no longer needs', () => {
    const b = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000, y: 0 }),
        track({ x: 1000, y: 0 }, { x: 1000, y: 1000 }),
      ],
    });
    const drag = startTrackDrag(b, 0, { x: 1000, y: 0 })!;
    // Drag the shared corner onto the far end: the line collapses to one segment.
    const chain = updateTrackDrag(drag, { x: 1000, y: 1000 });
    const out = applyTrackDrag(b, drag, chain);
    expect(out.tracks.length).toBeLessThan(2);
  });
});

describe('dragging every line on the ecc83 demo board', () => {
  const demo = (): Board =>
    readBoard(
      parse(
        readFileSync(
          new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url),
          'utf8',
        ),
      ),
    );

  const is45 = (t: PcbTrack): boolean => {
    const dx = Math.abs(t.end.x - t.start.x);
    const dy = Math.abs(t.end.y - t.start.y);
    return dx === 0 || dy === 0 || Math.abs(dx - dy) <= 1;
  };

  it('keeps both ends of the line anchored, whatever is grabbed', () => {
    const b = demo();
    let dragged = 0;

    for (let i = 0; i < b.tracks.length; i++) {
      const line = assembleLine(b, i)!;
      const first = line.chain[0]!;
      const last = line.chain[line.chain.length - 1]!;
      const seed = b.tracks[i]!;
      const mid = { x: (seed.start.x + seed.end.x) / 2, y: (seed.start.y + seed.end.y) / 2 };

      for (const freeAngle of [false, true]) {
        const drag = startTrackDrag(b, i, mid, { freeAngle })!;
        const chain = updateTrackDrag(drag, { x: mid.x + 2000, y: mid.y + 1500 });
        // Every end of the line the drag did not grab stays pinned: a drag re-cuts
        // the middle, so it can only pull the run off a pad or junction when you
        // grabbed that very end corner (which is what dragging an end is for).
        const grabbedFirst = drag.mode === 'corner' && drag.index === 0;
        const grabbedLast = drag.mode === 'corner' && drag.index === drag.line.chain.length - 1;
        if (!grabbedFirst) expect(chain[0]).toEqual(first);
        if (!grabbedLast) expect(chain[chain.length - 1]).toEqual(last);

        const out = applyTrackDrag(b, drag, chain);
        // Same net, same layer, same width throughout, and still routable copper.
        const lineTracks = trackDragSegments(b, drag, chain);
        for (const t of lineTracks) {
          expect(t.net).toBe(line.net);
          expect(t.layer).toBe(line.layer);
          expect(t.width).toBe(line.width);
        }
        expect(out.tracks.length).toBeGreaterThan(0);
        dragged++;
      }
    }
    expect(dragged).toBe(b.tracks.length * 2);
  });

  it('a 45° drag leaves every segment on a 45° angle', () => {
    const b = demo();
    for (let i = 0; i < b.tracks.length; i++) {
      const seed = b.tracks[i]!;
      if (!is45(seed)) continue; // the board itself has a few off-angle segments
      const line = assembleLine(b, i)!;
      if (!line.tracks.every((t) => is45(b.tracks[t]!))) continue;

      const mid = { x: (seed.start.x + seed.end.x) / 2, y: (seed.start.y + seed.end.y) / 2 };
      const drag = startTrackDrag(b, i, mid)!;
      const chain = updateTrackDrag(drag, { x: mid.x + 1270, y: mid.y - 1270 });
      for (const t of trackDragSegments(b, drag, chain)) expect(is45(t)).toBe(true);
    }
  });
});
