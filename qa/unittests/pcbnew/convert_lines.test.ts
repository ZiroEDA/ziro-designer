// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Convert to Lines / Tracks, and Convert to Arc.
 * Counterparts: `CONVERT_TOOL::CreateLines` and `CONVERT_TOOL::SegmentToArc`.
 *
 * Two things are easy to get wrong here and invisible on a canvas: the closing
 * edge of a ring (drop it and the outline has a gap exactly one edge wide), and
 * zero-length edges (keep them and the file gains degenerate items that DRC
 * sees but nobody can click).
 *
 * `SegmentToArc` looks like one operation and is really four, because it
 * crosses the graphic/copper divide in both directions as well as bowing
 * straight items — so each of the four is pinned separately.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  ARC_BOW_RATIO,
  bowedMidpoint,
  convertToLines,
  itemRings,
  segmentToArc,
} from '@ziroeda/pcbnew/src/convert_lines.js';
import type { Board, PcbShape, PcbTrack } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const rect = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'rect',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.15),
  fill: true,
  layer: 'F.SilkS',
  source: EMPTY,
});

const poly = (pts: { x: number; y: number }[]): PcbShape => ({
  kind: 'poly',
  pts,
  width: MM(0.15),
  fill: true,
  layer: 'F.SilkS',
  source: EMPTY,
});

const lineShape = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.2),
  fill: false,
  layer: 'F.SilkS',
  source: EMPTY,
});

const arcShape = (): PcbShape => ({
  kind: 'arc',
  start: { x: 0, y: 0 },
  mid: { x: MM(5), y: MM(-2) },
  end: { x: MM(10), y: 0 },
  width: MM(0.2),
  fill: false,
  layer: 'F.SilkS',
  source: EMPTY,
});

const track = (x0: number, y0: number, x1: number, y1: number, net = 0): PcbTrack => ({
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.25),
  layer: 'F.Cu',
  net,
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
  textBoxes: [],
  tables: [],
  groups: [],
  source: EMPTY,
  ...over,
});

describe('the rings an item decomposes into', () => {
  it('gives a rectangle its four corners', () => {
    const r = itemRings(board({ shapes: [rect(0, 0, 10, 4)] }), 'shape:0');

    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(4);
  });

  it('gives a polygon its own points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: MM(5), y: 0 },
      { x: 0, y: MM(5) },
    ];

    expect(itemRings(board({ shapes: [poly(pts)] }), 'shape:0')[0]).toEqual(pts);
  });

  it('gives a zone its outline', () => {
    const outline = [
      { x: 0, y: 0 },
      { x: MM(8), y: 0 },
      { x: 0, y: MM(8) },
    ];
    const b = board({
      zones: [{ net: 0, layers: ['F.Cu'], fills: [], outline, source: EMPTY }],
    });

    expect(itemRings(b, 'zone:0')[0]).toEqual(outline);
  });

  it('refuses a circle, which has no vertices to make edges from', () => {
    const b = board({
      shapes: [
        {
          kind: 'circle',
          center: { x: 0, y: 0 },
          end: { x: MM(5), y: 0 },
          width: MM(0.2),
          fill: false,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

    expect(itemRings(b, 'shape:0')).toEqual([]);
  });

  it('refuses an id that resolves to nothing', () => {
    expect(itemRings(board(), 'shape:9')).toEqual([]);
  });
});

describe('breaking an area into lines', () => {
  it('gives a rectangle four edges, closing edge included', () => {
    // Four corners means four edges, not three: the last vertex joins back to
    // the first, and dropping that leaves a gap exactly one edge wide.
    const b = board({ shapes: [rect(0, 0, 10, 4)] });
    const out = convertToLines(b, ['shape:0'], { layer: 'F.SilkS' });

    expect(out.ids).toHaveLength(4);
  });

  it('produces edges that actually join up end to end', () => {
    const b = board({ shapes: [rect(0, 0, 10, 4)] });
    const out = convertToLines(b, ['shape:0'], { layer: 'F.SilkS' });
    const added = out.board.shapes.slice(1);

    for (let i = 0; i < added.length; i++) {
      const next = added[(i + 1) % added.length]!;
      expect(added[i]!.end).toEqual(next.start);
    }
  });

  it('skips zero-length edges', () => {
    // A polygon carrying its closing point explicitly has a repeated vertex;
    // the edge between the two is invisible on the canvas but real in the file.
    const b = board({
      shapes: [
        poly([
          { x: 0, y: 0 },
          { x: MM(5), y: 0 },
          { x: 0, y: MM(5) },
          { x: 0, y: 0 },
        ]),
      ],
    });
    const out = convertToLines(b, ['shape:0'], { layer: 'F.SilkS' });

    // Four vertices, but the repeated one contributes nothing.
    expect(out.ids).toHaveLength(3);
  });

  it('makes tracks instead when asked to', () => {
    const b = board({ shapes: [rect(0, 0, 10, 4)] });
    const out = convertToLines(b, ['shape:0'], { layer: 'F.Cu', target: 'track', net: 2 });

    expect(out.board.tracks).toHaveLength(4);
    expect(out.board.shapes).toHaveLength(1); // the original only
    expect(out.board.tracks[0]!.net).toBe(2);
    expect(out.board.tracks[0]!.layer).toBe('F.Cu');
  });

  it('carries a lone segment across the graphic/copper divide', () => {
    const b = board({ shapes: [lineShape(0, 0, 10, 0)] });
    const out = convertToLines(b, ['shape:0'], { layer: 'F.Cu', target: 'track' });

    expect(out.board.tracks).toHaveLength(1);
    expect(out.board.tracks[0]!.start).toEqual({ x: 0, y: 0 });
  });

  it('keeps an arc curved rather than decomposing it', () => {
    // Turning an arc into straight edges would throw its curve away.
    const b = board({ shapes: [arcShape()] });
    const out = convertToLines(b, ['shape:0'], { layer: 'F.Cu', target: 'track' });

    expect(out.board.arcs).toHaveLength(1);
    expect(out.board.arcs[0]!.mid).toEqual({ x: MM(5), y: MM(-2) });
    expect(out.board.tracks).toHaveLength(0);
  });

  it('takes the source width unless told otherwise', () => {
    const b = board({ shapes: [rect(0, 0, 10, 4)] });

    expect(convertToLines(b, ['shape:0'], { layer: 'F.SilkS' }).board.shapes[1]!.width).toBe(
      MM(0.15),
    );
    expect(
      convertToLines(b, ['shape:0'], { layer: 'F.SilkS', width: MM(0.5) }).board.shapes[1]!.width,
    ).toBe(MM(0.5));
  });

  it('leaves the original in place by default', () => {
    const b = board({ shapes: [rect(0, 0, 10, 4)] });
    const out = convertToLines(b, ['shape:0'], { layer: 'F.SilkS' });

    expect(out.board.shapes[0]!.kind).toBe('rect');
  });

  it('removes the original when asked', () => {
    const b = board({ shapes: [rect(0, 0, 10, 4)] });
    const out = convertToLines(b, ['shape:0'], { layer: 'F.SilkS', deleteOriginals: true });

    expect(out.board.shapes).toHaveLength(4);
    expect(out.board.shapes.every((s) => s.kind === 'line')).toBe(true);
  });

  it('removes a source zone when asked', () => {
    const b = board({
      zones: [
        {
          net: 0,
          layers: ['F.Cu'],
          fills: [],
          outline: [
            { x: 0, y: 0 },
            { x: MM(8), y: 0 },
            { x: 0, y: MM(8) },
          ],
          source: EMPTY,
        },
      ],
    });
    const out = convertToLines(b, ['zone:0'], { layer: 'F.Cu', deleteOriginals: true });

    expect(out.board.zones).toHaveLength(0);
    expect(out.board.shapes).toHaveLength(3);
  });

  it('does not delete a new item that a stale source id happens to name', () => {
    // The sources are dropped by index, and the new edges are appended to the
    // same array. A selected id that does not resolve — a stale selection — can
    // name an index the new edges now occupy, and must not take one with it.
    const b = board({ shapes: [rect(0, 0, 10, 4)] });
    const out = convertToLines(b, ['shape:0', 'shape:2'], {
      layer: 'F.SilkS',
      deleteOriginals: true,
    });

    // Four edges from the rectangle, all of them still here.
    expect(out.board.shapes).toHaveLength(4);
  });

  it('returns the board untouched when nothing converts', () => {
    const b = board({ shapes: [rect(0, 0, 10, 4)] });

    expect(convertToLines(b, ['shape:9'], { layer: 'F.SilkS' }).board).toBe(b);
  });
});

describe('the bow a straight edge gains', () => {
  it('sits off the chord by a tenth of its length', () => {
    const m = bowedMidpoint({ x: 0, y: 0 }, { x: MM(10), y: 0 });

    // Chord centre is (5, 0); the normal of (+x) is (0, +x), so it bows to +y.
    // Stated as a literal, not derived from ARC_BOW_RATIO — an expectation
    // computed from the constant cannot notice the constant changing.
    expect(m.x).toBe(MM(5));
    expect(m.y).toBe(MM(1));
    expect(ARC_BOW_RATIO).toBe(0.1);
  });

  it('is proportional to the chord, not a fixed distance', () => {
    // What makes the arc look the same on a 1 mm edge and a 100 mm one.
    const short = bowedMidpoint({ x: 0, y: 0 }, { x: MM(1), y: 0 });
    const long = bowedMidpoint({ x: 0, y: 0 }, { x: MM(100), y: 0 });

    expect(long.y / short.y).toBeCloseTo(100, 6);
  });

  it('bows to a fixed side, not an arbitrary one', () => {
    // The normal is (−y, x): reversing the chord puts the bow on the other
    // side, which is what makes converting twice visibly undo itself.
    const forward = bowedMidpoint({ x: 0, y: 0 }, { x: MM(10), y: 0 });
    const backward = bowedMidpoint({ x: MM(10), y: 0 }, { x: 0, y: 0 });

    expect(forward.y).toBe(-backward.y);
  });

  it('is the point itself for a zero-length chord', () => {
    expect(bowedMidpoint({ x: MM(3), y: MM(4) }, { x: MM(3), y: MM(4) })).toEqual({
      x: MM(3),
      y: MM(4),
    });
  });
});

describe('convert to arc', () => {
  it('turns a graphic segment into a bowed graphic arc', () => {
    const b = board({ shapes: [lineShape(0, 0, 10, 0)] });
    const out = segmentToArc(b, 'shape:0');
    const arc = out.board.shapes[1]!;

    expect(out.id).toBe('shape:1');
    expect(arc.kind).toBe('arc');
    expect(arc.mid).toEqual(bowedMidpoint({ x: 0, y: 0 }, { x: MM(10), y: 0 }));
    expect(arc.width).toBe(MM(0.2));
  });

  it('turns a track into a bowed track arc, keeping its net', () => {
    const b = board({ tracks: [track(0, 0, 10, 0, 7)] });
    const out = segmentToArc(b, 'track:0');

    expect(out.id).toBe('arc:0');
    expect(out.board.arcs[0]!.net).toBe(7);
    expect(out.board.arcs[0]!.width).toBe(MM(0.25));
  });

  it('turns a graphic arc into a track arc, geometry unchanged', () => {
    // Already curved, so this crosses the graphic/copper divide rather than
    // bowing anything.
    const b = board({ shapes: [arcShape()] });
    const out = segmentToArc(b, 'shape:0');

    expect(out.id).toBe('arc:0');
    expect(out.board.arcs[0]!.mid).toEqual({ x: MM(5), y: MM(-2) });
  });

  it('turns a track arc into a graphic arc, geometry unchanged', () => {
    const b = board({
      arcs: [
        {
          start: { x: 0, y: 0 },
          mid: { x: MM(5), y: MM(-2) },
          end: { x: MM(10), y: 0 },
          width: MM(0.25),
          layer: 'F.Cu',
          net: 4,
          source: EMPTY,
        },
      ],
    });
    const out = segmentToArc(b, 'arc:0');

    expect(out.id).toBe('shape:0');
    expect(out.board.shapes[0]!.kind).toBe('arc');
    expect(out.board.shapes[0]!.mid).toEqual({ x: MM(5), y: MM(-2) });
    // A graphic carries no net, so the net is simply gone.
    expect(out.board.shapes[0]!.fill).toBe(false);
  });

  it('refuses a zero-length segment', () => {
    const b = board({ shapes: [lineShape(5, 5, 5, 5)] });

    expect(segmentToArc(b, 'shape:0')).toEqual({ board: b, id: null });
  });

  it('refuses something that is not a line at all', () => {
    const b = board({ shapes: [rect(0, 0, 10, 4)] });

    expect(segmentToArc(b, 'shape:0')).toEqual({ board: b, id: null });
  });

  it('refuses an id that resolves to nothing', () => {
    const b = board();

    expect(segmentToArc(b, 'nonsense')).toEqual({ board: b, id: null });
  });
});
