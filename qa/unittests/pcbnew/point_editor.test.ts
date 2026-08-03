// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board point editor.
 * Counterpart: `PCB_POINT_EDITOR` and its `POINT_EDIT_BEHAVIOR`s.
 *
 * The behaviour that separates a real point editor from "move the vertex you
 * grabbed" is that a rectangle's corner **pushes its neighbours**: the shape has
 * to stay axis-aligned, so dragging the top-left also moves the top-right's y
 * and the bottom-left's x. A test that only checks the grabbed corner passes
 * under an implementation that leaves a rectangle as a trapezium.
 *
 * The other half is that a drag is a pure function of (board, handle, cursor),
 * so it is idempotent for a given cursor position — dragging to the same place
 * twice is the same as once. Preview and commit cannot disagree if that holds.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  boardEditHandles,
  dragBoardHandle,
  editablePointItems,
  hasEditPoints,
} from '@ziroeda/pcbnew/src/point_editor.js';
import type { Board, PcbShape, PcbTrack } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const rect = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'rect',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.15),
  fill: false,
  layer: 'F.SilkS',
  source: { kind: 'list', items: [{ kind: 'atom', value: 'gr_rect' }] },
});

const track = (x0: number, y0: number, x1: number, y1: number): PcbTrack => ({
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.25),
  layer: 'F.Cu',
  net: 0,
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
  nets: new Map([[0, '']]),
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

const handle = (b: Board, id: string, kind: 'point' | 'line', index: number) =>
  boardEditHandles(b, id).find((h) => h.kind === kind && h.index === index)!;

describe('which items carry handles', () => {
  it('offers none for a via', () => {
    const b = board({
      vias: [
        {
          at: { x: 0, y: 0 },
          size: MM(0.8),
          drill: MM(0.4),
          layers: ['F.Cu', 'B.Cu'],
          kind: 'through',
          net: 0,
          source: EMPTY,
        },
      ],
    });

    expect(hasEditPoints(b, 'via:0')).toBe(false);
  });

  it('offers two for a track', () => {
    const b = board({ tracks: [track(0, 0, 10, 0)] });

    expect(boardEditHandles(b, 'track:0')).toHaveLength(2);
  });

  it('offers none for an id that resolves to nothing', () => {
    expect(boardEditHandles(board(), 'shape:9')).toEqual([]);
    expect(boardEditHandles(board(), 'nonsense')).toEqual([]);
  });

  it('lists every editable item on the board', () => {
    const b = board({ tracks: [track(0, 0, 10, 0)], shapes: [rect(0, 0, 5, 5)] });

    expect(editablePointItems(b)).toEqual(['track:0', 'shape:0']);
  });
});

describe('a rectangle', () => {
  const b = () => board({ shapes: [rect(0, 0, 10, 10)] });

  it('has four corners, a centre and four edges', () => {
    const hs = boardEditHandles(b(), 'shape:0');

    expect(hs.filter((h) => h.kind === 'point')).toHaveLength(5);
    expect(hs.filter((h) => h.kind === 'line')).toHaveLength(4);
  });

  it('presents its corners top-left first however it was drawn', () => {
    // Dragged bottom-right to top-left, so start is past end. The handle the
    // user grabs must still be the one they see.
    const backwards = board({ shapes: [rect(10, 10, 0, 0)] });

    expect(handle(backwards, 'shape:0', 'point', 0).at).toEqual({ x: 0, y: 0 });
    expect(handle(backwards, 'shape:0', 'point', 2).at).toEqual({ x: MM(10), y: MM(10) });
  });

  it('stays a rectangle when a corner is dragged', () => {
    // Grabbing top-left and pulling it up-left must also carry the top-right's
    // y and the bottom-left's x. Upstream achieves that by *pushing* those two
    // points; here they are derived from the two stored corners, so it holds
    // structurally. The property is worth pinning either way — it is what the
    // user sees, and a future change to how a rectangle is stored could break
    // it without touching this file.
    const out = dragBoardHandle(b(), 'shape:0', handle(b(), 'shape:0', 'point', 0), {
      x: MM(-5),
      y: MM(-3),
    });
    const hs = boardEditHandles(out, 'shape:0');

    expect(hs[0]!.at).toEqual({ x: MM(-5), y: MM(-3) });
    expect(hs[1]!.at).toEqual({ x: MM(10), y: MM(-3) });
    expect(hs[3]!.at).toEqual({ x: MM(-5), y: MM(10) });
  });

  it('drags each of the four corners to the right coordinates', () => {
    // Only the top-left was covered before, which left the other three free to
    // write the wrong stored corner and still pass.
    const drag = (i: number, x: number, y: number) =>
      dragBoardHandle(b(), 'shape:0', handle(b(), 'shape:0', 'point', i), { x: MM(x), y: MM(y) });

    // Top-right to (15,-3): sets the top edge and the right edge.
    expect(drag(1, 15, -3).shapes[0]!.start).toEqual({ x: 0, y: MM(-3) });
    expect(drag(1, 15, -3).shapes[0]!.end).toEqual({ x: MM(15), y: MM(10) });

    // Bottom-right to (14,13): sets both far coordinates.
    expect(drag(2, 14, 13).shapes[0]!.start).toEqual({ x: 0, y: 0 });
    expect(drag(2, 14, 13).shapes[0]!.end).toEqual({ x: MM(14), y: MM(13) });

    // Bottom-left to (-2,14): sets the left edge and the bottom edge.
    expect(drag(3, -2, 14).shapes[0]!.start).toEqual({ x: MM(-2), y: 0 });
    expect(drag(3, -2, 14).shapes[0]!.end).toEqual({ x: MM(10), y: MM(14) });
  });

  it('clamps every corner, not just the first', () => {
    const drag = (i: number, x: number, y: number) =>
      dragBoardHandle(b(), 'shape:0', handle(b(), 'shape:0', 'point', i), { x: MM(x), y: MM(y) });

    for (const [i, x, y] of [
      [0, 50, 50],
      [1, -50, 50],
      [2, -50, -50],
      [3, 50, -50],
    ] as const) {
      const s = drag(i, x, y).shapes[0]!;
      expect(s.start!.x, `corner ${i}`).toBeLessThan(s.end!.x);
      expect(s.start!.y, `corner ${i}`).toBeLessThan(s.end!.y);
    }
  });

  it('will not let a corner cross its opposite', () => {
    // Dragged far past the bottom-right, the rectangle must collapse to the
    // minimum rather than turn inside out.
    const out = dragBoardHandle(b(), 'shape:0', handle(b(), 'shape:0', 'point', 0), {
      x: MM(50),
      y: MM(50),
    });
    const s = out.shapes[0]!;

    expect(s.start!.x).toBeLessThan(s.end!.x);
    expect(s.start!.y).toBeLessThan(s.end!.y);
  });

  it('moves as a whole from the centre handle', () => {
    const out = dragBoardHandle(b(), 'shape:0', handle(b(), 'shape:0', 'point', 4), {
      x: MM(25),
      y: MM(5),
    });
    const s = out.shapes[0]!;

    expect(s.start).toEqual({ x: MM(20), y: 0 });
    expect(s.end).toEqual({ x: MM(30), y: MM(10) });
  });

  it('moves only one side from an edge handle', () => {
    // Grab the top edge and pull it up: the bottom must not follow.
    const out = dragBoardHandle(b(), 'shape:0', handle(b(), 'shape:0', 'line', 0), {
      x: MM(5),
      y: MM(-4),
    });
    const s = out.shapes[0]!;

    expect(s.start!.y).toBe(MM(-4));
    expect(s.end!.y).toBe(MM(10));
    expect(s.start!.x).toBe(0);
  });

  it('ignores the across-edge coordinate of an edge drag', () => {
    // The top edge controls y only; sliding the cursor sideways must not
    // stretch the rectangle horizontally.
    const out = dragBoardHandle(b(), 'shape:0', handle(b(), 'shape:0', 'line', 0), {
      x: MM(999),
      y: MM(-4),
    });

    expect(out.shapes[0]!.start!.x).toBe(0);
    expect(out.shapes[0]!.end!.x).toBe(MM(10));
  });

  it('drops the stale source node so the writer rebuilds it', () => {
    // The parsed node still describes the old corners; keeping it would write
    // the original geometry back out.
    const out = dragBoardHandle(b(), 'shape:0', handle(b(), 'shape:0', 'point', 0), {
      x: MM(-5),
      y: MM(-5),
    });

    expect(out.shapes[0]!.source.items).toEqual([]);
  });

  it('is idempotent for a given cursor position', () => {
    // A drag is a pure function of (board, handle, cursor), so the preview and
    // the committed result cannot disagree.
    const h = handle(b(), 'shape:0', 'point', 0);
    const once = dragBoardHandle(b(), 'shape:0', h, { x: MM(-5), y: MM(-3) });
    const twice = dragBoardHandle(once, 'shape:0', handle(once, 'shape:0', 'point', 0), {
      x: MM(-5),
      y: MM(-3),
    });

    expect(twice.shapes[0]!.start).toEqual(once.shapes[0]!.start);
    expect(twice.shapes[0]!.end).toEqual(once.shapes[0]!.end);
  });
});

describe('a circle', () => {
  const circleBoard = () =>
    board({
      shapes: [
        {
          kind: 'circle',
          center: { x: 0, y: 0 },
          end: { x: MM(5), y: 0 },
          width: MM(0.15),
          fill: false,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

  it('has a centre and a radius handle', () => {
    expect(boardEditHandles(circleBoard(), 'shape:0')).toHaveLength(2);
  });

  it('resizes from the radius handle', () => {
    const b = circleBoard();
    const out = dragBoardHandle(b, 'shape:0', handle(b, 'shape:0', 'point', 1), {
      x: MM(8),
      y: 0,
    });

    expect(out.shapes[0]!.end).toEqual({ x: MM(8), y: 0 });
    expect(out.shapes[0]!.center).toEqual({ x: 0, y: 0 });
  });

  it('keeps its radius when the centre is dragged', () => {
    // The radius point has to travel with the centre, or the circle would
    // resize as it was moved.
    const b = circleBoard();
    const out = dragBoardHandle(b, 'shape:0', handle(b, 'shape:0', 'point', 0), {
      x: MM(20),
      y: MM(20),
    });
    const s = out.shapes[0]!;
    const radius = Math.hypot(s.end!.x - s.center!.x, s.end!.y - s.center!.y);

    expect(s.center).toEqual({ x: MM(20), y: MM(20) });
    expect(radius).toBe(MM(5));
  });
});

describe('a polygon', () => {
  const polyBoard = () =>
    board({
      shapes: [
        {
          kind: 'poly',
          pts: [
            { x: 0, y: 0 },
            { x: MM(10), y: 0 },
            { x: MM(10), y: MM(10) },
          ],
          width: MM(0.15),
          fill: true,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

  it('has a handle per vertex and per edge', () => {
    const hs = boardEditHandles(polyBoard(), 'shape:0');

    expect(hs.filter((h) => h.kind === 'point')).toHaveLength(3);
    expect(hs.filter((h) => h.kind === 'line')).toHaveLength(3);
  });

  it('closes the ring with the last edge handle', () => {
    // The edge from the last vertex back to the first is as real as the others.
    const hs = boardEditHandles(polyBoard(), 'shape:0');

    expect(hs.find((h) => h.kind === 'line' && h.index === 2)!.at).toEqual({
      x: MM(5),
      y: MM(5),
    });
  });

  it('moves one vertex from a point handle', () => {
    const b = polyBoard();
    const out = dragBoardHandle(b, 'shape:0', handle(b, 'shape:0', 'point', 1), {
      x: MM(20),
      y: MM(-5),
    });

    expect(out.shapes[0]!.pts![1]).toEqual({ x: MM(20), y: MM(-5) });
    expect(out.shapes[0]!.pts![0]).toEqual({ x: 0, y: 0 });
  });

  it('carries both ends from an edge handle', () => {
    const b = polyBoard();
    const out = dragBoardHandle(b, 'shape:0', handle(b, 'shape:0', 'line', 0), {
      x: MM(5),
      y: MM(-4),
    });
    const pts = out.shapes[0]!.pts!;

    // The edge's midpoint was (5,0); moving it to (5,-4) shifts both ends by -4.
    expect(pts[0]).toEqual({ x: 0, y: MM(-4) });
    expect(pts[1]).toEqual({ x: MM(10), y: MM(-4) });
    expect(pts[2]).toEqual({ x: MM(10), y: MM(10) });
  });
});

describe('tracks and arcs', () => {
  it('moves a track end', () => {
    const b = board({ tracks: [track(0, 0, 10, 0)] });
    const out = dragBoardHandle(b, 'track:0', handle(b, 'track:0', 'point', 1), {
      x: MM(10),
      y: MM(5),
    });

    expect(out.tracks[0]!.end).toEqual({ x: MM(10), y: MM(5) });
    expect(out.tracks[0]!.start).toEqual({ x: 0, y: 0 });
  });

  it('offers start, mid and end on a track arc', () => {
    const b = board({
      arcs: [
        {
          start: { x: 0, y: 0 },
          mid: { x: MM(5), y: MM(-2) },
          end: { x: MM(10), y: 0 },
          width: MM(0.25),
          layer: 'F.Cu',
          net: 0,
          source: EMPTY,
        },
      ],
    });

    expect(boardEditHandles(b, 'arc:0')).toHaveLength(3);
  });

  it('reshapes a track arc from its midpoint', () => {
    const b = board({
      arcs: [
        {
          start: { x: 0, y: 0 },
          mid: { x: MM(5), y: MM(-2) },
          end: { x: MM(10), y: 0 },
          width: MM(0.25),
          layer: 'F.Cu',
          net: 0,
          source: EMPTY,
        },
      ],
    });
    const out = dragBoardHandle(b, 'arc:0', handle(b, 'arc:0', 'point', 1), {
      x: MM(5),
      y: MM(-6),
    });

    expect(out.arcs[0]!.mid).toEqual({ x: MM(5), y: MM(-6) });
    // The ends stay put: only the bulge changed.
    expect(out.arcs[0]!.start).toEqual({ x: 0, y: 0 });
    expect(out.arcs[0]!.end).toEqual({ x: MM(10), y: 0 });
  });
});

describe('a zone', () => {
  const zoneBoard = () =>
    board({
      zones: [
        {
          net: 0,
          layers: ['F.Cu'],
          fills: [],
          outline: [
            { x: 0, y: 0 },
            { x: MM(10), y: 0 },
            { x: MM(10), y: MM(10) },
            { x: 0, y: MM(10) },
          ],
          source: EMPTY,
        },
      ],
    });

  it('still offers its corners and edges', () => {
    const hs = boardEditHandles(zoneBoard(), 'zone:0');

    expect(hs.filter((h) => h.kind === 'point')).toHaveLength(4);
    expect(hs.filter((h) => h.kind === 'line')).toHaveLength(4);
  });

  it('moves a corner', () => {
    const b = zoneBoard();
    const out = dragBoardHandle(b, 'zone:0', handle(b, 'zone:0', 'point', 0), {
      x: MM(-2),
      y: MM(-2),
    });

    expect(out.zones[0]!.outline![0]).toEqual({ x: MM(-2), y: MM(-2) });
  });

  it('carries both ends of an edge', () => {
    const b = zoneBoard();
    const out = dragBoardHandle(b, 'zone:0', handle(b, 'zone:0', 'line', 0), {
      x: MM(5),
      y: MM(-3),
    });
    const outline = out.zones[0]!.outline!;

    expect(outline[0]).toEqual({ x: 0, y: MM(-3) });
    expect(outline[1]).toEqual({ x: MM(10), y: MM(-3) });
    expect(outline[2]).toEqual({ x: MM(10), y: MM(10) });
  });
});
