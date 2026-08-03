// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Convert to Polygon / Zone.
 * Counterparts: `CONVERT_TOOL::CreatePolys`, `makePolysFromChainedSegs`,
 * `makePolysFromClosedGraphics` and `getStartEndPoints`.
 *
 * The chaining is what needs testing hardest, and the cases that matter are the
 * untidy ones: items given in scrambled order, endpoints that miss each other
 * by a few nanometres, and a selection holding more than one ring. A fixture
 * whose segments are already in drawing order chains under almost any
 * implementation and proves very little.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  CHAINING_EPSILON,
  chainSegmentsToPolygons,
  chainableItem,
  closedShapeRing,
  convertToPoly,
  convertToPolygons,
  convertToZone,
  DEFAULT_RULE_AREA_KEEPOUT,
  resolvedLineWidth,
} from '@ziroeda/pcbnew/src/convert_shapes.js';
import type { Board, PcbShape, PcbTrack } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const line = (x0: number, y0: number, x1: number, y1: number, width = MM(0.1)): PcbShape => ({
  kind: 'line',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
  width,
  fill: false,
  layer: 'Edge.Cuts',
  source: EMPTY,
});

const mmLine = (x0: number, y0: number, x1: number, y1: number, width = MM(0.1)): PcbShape =>
  line(MM(x0), MM(y0), MM(x1), MM(y1), width);

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

/** The four sides of a 10 mm square, as separate line shapes. */
const squareSides = (): PcbShape[] => [
  mmLine(0, 0, 10, 0),
  mmLine(10, 0, 10, 10),
  mmLine(10, 10, 0, 10),
  mmLine(0, 10, 0, 0),
];

const allShapeIds = (b: Board): string[] => b.shapes.map((_, i) => `shape:${i}`);

/** Ring area by the shoelace formula, for checking a ring is the right size. */
const area = (pts: { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

describe('which items can chain', () => {
  it('takes a line shape', () => {
    const b = board({ shapes: [mmLine(0, 0, 10, 0)] });

    expect(chainableItem(b, 'shape:0')).toMatchObject({ start: { x: 0, y: 0 } });
  });

  it('takes a track', () => {
    const b = board({ tracks: [track(1, 2, 3, 4)] });

    expect(chainableItem(b, 'track:0')).toMatchObject({ start: { x: MM(1), y: MM(2) } });
  });

  it('refuses a shape whose ends coincide', () => {
    // getStartEndPoints returns nullopt for these: there is no direction to
    // walk them in.
    const b = board({ shapes: [mmLine(5, 5, 5, 5)] });

    expect(chainableItem(b, 'shape:0')).toBeNull();
  });

  it('refuses a shape that is already an area', () => {
    const b = board({
      shapes: [
        {
          kind: 'rect',
          start: { x: 0, y: 0 },
          end: { x: MM(5), y: MM(5) },
          width: 0,
          fill: true,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

    expect(chainableItem(b, 'shape:0')).toBeNull();
  });

  it('refuses an id that resolves to nothing', () => {
    expect(chainableItem(board(), 'shape:9')).toBeNull();
    expect(chainableItem(board(), 'nonsense')).toBeNull();
  });
});

describe('chaining a ring of segments', () => {
  it('closes a square drawn as four separate lines', () => {
    const b = board({ shapes: squareSides() });
    const rings = chainSegmentsToPolygons(b, allShapeIds(b));

    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(area(rings[0]!)).toBeCloseTo(MM(10) * MM(10), -6);
  });

  it('does not repeat the first point to close the ring', () => {
    // The closing edge is implied, as it is for every other polygon we store;
    // a repeated vertex would be a zero-length edge for anything walking it.
    const b = board({ shapes: squareSides() });
    const ring = chainSegmentsToPolygons(b, allShapeIds(b))[0]!;

    expect(ring[0]).not.toEqual(ring[ring.length - 1]);
  });

  it('does not care what order the segments are given in', () => {
    // Nothing records which segment touches which, and they were not drawn in
    // order — so a fixture in drawing order would prove very little.
    const b = board({ shapes: squareSides() });
    const scrambled = chainSegmentsToPolygons(b, ['shape:2', 'shape:0', 'shape:3', 'shape:1']);

    expect(scrambled).toHaveLength(1);
    expect(area(scrambled[0]!)).toBeCloseTo(MM(10) * MM(10), -6);
  });

  it('recovers the whole ring whichever segment it starts from', () => {
    // The walk goes one way only, which is sound precisely because a ring is a
    // cycle: from any of its items it comes back round to that item. If that
    // were wrong, some starting segments would yield a partial, unclosed chain.
    const b = board({ shapes: squareSides() });

    for (let k = 0; k < 4; k++) {
      const ids = [0, 1, 2, 3].map((i) => `shape:${(i + k) % 4}`);
      const rings = chainSegmentsToPolygons(b, ids);

      expect(rings, `starting from side ${k}`).toHaveLength(1);
      expect(rings[0], `starting from side ${k}`).toHaveLength(4);
    }
  });

  it('closes a ring whose corners miss by less than the epsilon', () => {
    // A hand-drawn outline almost never closes to the nanometre.
    const gap = CHAINING_EPSILON - 1;
    const b = board({
      shapes: [
        line(0, 0, MM(10), 0),
        line(MM(10) + gap, 0, MM(10), MM(10)),
        line(MM(10), MM(10), 0, MM(10)),
        line(0, MM(10), 0, 0),
      ],
    });

    expect(chainSegmentsToPolygons(b, allShapeIds(b))).toHaveLength(1);
  });

  it('refuses a ring whose corners miss by more than the epsilon', () => {
    // The epsilon is deliberately small: a generous one starts swallowing the
    // very short segments a converted bezier is made of.
    const gap = CHAINING_EPSILON * 4;
    const b = board({
      shapes: [
        line(0, 0, MM(10), 0),
        line(MM(10) + gap, 0, MM(10), MM(10)),
        line(MM(10), MM(10), 0, MM(10)),
        line(0, MM(10), 0, 0),
      ],
    });

    expect(chainSegmentsToPolygons(b, allShapeIds(b))).toEqual([]);
  });

  it('drops an open chain rather than failing the whole conversion', () => {
    // Three sides of a square: best-effort, so nothing comes back but no error.
    const b = board({ shapes: squareSides().slice(0, 3) });

    expect(chainSegmentsToPolygons(b, allShapeIds(b))).toEqual([]);
  });

  it('returns both rings when the selection holds two', () => {
    const far = squareSides().map((s) => ({
      ...s,
      start: { x: s.start!.x + MM(50), y: s.start!.y },
      end: { x: s.end!.x + MM(50), y: s.end!.y },
    }));
    const b = board({ shapes: [...squareSides(), ...far] });
    const rings = chainSegmentsToPolygons(b, allShapeIds(b));

    expect(rings).toHaveLength(2);
    for (const r of rings) expect(area(r)).toBeCloseTo(MM(10) * MM(10), -6);
  });

  it('keeps an open chain from consuming the closed ring beside it', () => {
    // The dangling line is walked first and fails to close; its items must be
    // released, or the square it touches would never be found.
    const b = board({ shapes: [mmLine(-20, 0, -10, 0), ...squareSides()] });
    const rings = chainSegmentsToPolygons(b, allShapeIds(b));

    expect(rings).toHaveLength(1);
    expect(area(rings[0]!)).toBeCloseTo(MM(10) * MM(10), -6);
  });

  it('chains tracks as readily as graphics', () => {
    const b = board({
      tracks: [track(0, 0, 10, 0), track(10, 0, 10, 10), track(10, 10, 0, 10), track(0, 10, 0, 0)],
    });

    expect(chainSegmentsToPolygons(b, ['track:0', 'track:1', 'track:2', 'track:3'])).toHaveLength(
      1,
    );
  });

  it('walks an arc as a curve, not as a chord', () => {
    // A half-disc: a straight base and an arc over it. If the arc were treated
    // as a chord the ring would be degenerate rather than half a circle.
    const b = board({
      shapes: [
        mmLine(0, 0, 10, 0),
        {
          kind: 'arc',
          start: { x: MM(10), y: 0 },
          mid: { x: MM(5), y: MM(-5) },
          end: { x: 0, y: 0 },
          width: MM(0.1),
          fill: false,
          layer: 'Edge.Cuts',
          source: EMPTY,
        },
      ],
    });
    const rings = chainSegmentsToPolygons(b, allShapeIds(b));

    expect(rings).toHaveLength(1);
    // Half a circle of radius 5 mm: ~39.3 mm². A chord would give ~0.
    const half = (Math.PI * MM(5) * MM(5)) / 2;
    expect(area(rings[0]!) / half).toBeGreaterThan(0.98);
  });

  it('ignores items that cannot chain', () => {
    const b = board({ shapes: [...squareSides(), mmLine(3, 3, 3, 3)] });

    expect(chainSegmentsToPolygons(b, allShapeIds(b))).toHaveLength(1);
  });

  it('finds nothing in an empty selection', () => {
    expect(chainSegmentsToPolygons(board(), [])).toEqual([]);
  });
});

describe('shapes that are already areas', () => {
  it('turns a rectangle into its four corners', () => {
    const r = closedShapeRing({
      kind: 'rect',
      start: { x: 0, y: 0 },
      end: { x: MM(10), y: MM(4) },
      width: 0,
      fill: true,
      layer: 'F.SilkS',
      source: EMPTY,
    })!;

    expect(r).toHaveLength(4);
    expect(area(r)).toBeCloseTo(MM(10) * MM(4), -6);
  });

  it('turns a circle into a ring of about the right area', () => {
    const r = closedShapeRing({
      kind: 'circle',
      center: { x: 0, y: 0 },
      end: { x: MM(5), y: 0 },
      width: MM(0.1),
      fill: false,
      layer: 'F.SilkS',
      source: EMPTY,
    })!;

    // Tessellated, so slightly inside the true circle — but not by much.
    const exact = Math.PI * MM(5) * MM(5);
    expect(area(r) / exact).toBeGreaterThan(0.99);
    expect(area(r) / exact).toBeLessThanOrEqual(1);
  });

  it('does not close the circle by repeating its first point', () => {
    const r = closedShapeRing({
      kind: 'circle',
      center: { x: 0, y: 0 },
      end: { x: MM(5), y: 0 },
      width: MM(0.1),
      fill: false,
      layer: 'F.SilkS',
      source: EMPTY,
    })!;

    expect(r[0]).not.toEqual(r[r.length - 1]);
  });

  it('passes a polygon through', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: MM(6), y: 0 },
      { x: 0, y: MM(6) },
    ];
    const r = closedShapeRing({
      kind: 'poly',
      pts,
      width: 0,
      fill: true,
      layer: 'F.SilkS',
      source: EMPTY,
    })!;

    expect(r).toEqual(pts);
  });

  it('refuses an open shape', () => {
    expect(closedShapeRing(mmLine(0, 0, 10, 0))).toBeNull();
  });
});

describe('putting the two paths together', () => {
  it('takes a closed shape and a chained ring at once', () => {
    const b = board({
      shapes: [
        ...squareSides(),
        {
          kind: 'rect',
          start: { x: MM(50), y: 0 },
          end: { x: MM(60), y: MM(10) },
          width: 0,
          fill: true,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

    expect(convertToPolygons(b, allShapeIds(b))).toHaveLength(2);
  });

  it('does not both convert and chain the same item', () => {
    // A closed shape is consumed as an area, so it must not be offered to the
    // chainer as well — upstream's SKIP_STRUCT flag.
    const b = board({
      shapes: [
        {
          kind: 'poly',
          pts: [
            { x: 0, y: 0 },
            { x: MM(5), y: 0 },
            { x: 0, y: MM(5) },
          ],
          width: 0,
          fill: true,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

    expect(convertToPolygons(b, ['shape:0'])).toHaveLength(1);
  });

  it('takes a zone outline as an area', () => {
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

    expect(convertToPolygons(b, ['zone:0'])).toHaveLength(1);
  });
});

describe('the line width the result is stroked with', () => {
  const widths = (): Board =>
    board({
      shapes: [
        mmLine(10, 0, 20, 0, MM(0.5)),
        // Further top-left, and this is the one whose width should be copied.
        mmLine(0, 0, 10, 0, MM(0.3)),
      ],
    });

  it('is the given default under the centreline strategy', () => {
    expect(resolvedLineWidth(widths(), allShapeIds(widths()), 'centerline', MM(0.2))).toBe(MM(0.2));
  });

  it('copies the top-left item stroke when asked to', () => {
    expect(resolvedLineWidth(widths(), allShapeIds(widths()), 'copyLineWidth', MM(0.2))).toBe(
      MM(0.3),
    );
  });

  it('falls back to the default when nothing carries a stroke', () => {
    expect(resolvedLineWidth(board(), [], 'copyLineWidth', MM(0.2))).toBe(MM(0.2));
  });
});

describe('convert to polygon', () => {
  it('adds one filled graphic per ring', () => {
    const b = board({ shapes: squareSides() });
    const out = convertToPoly(b, allShapeIds(b), { layer: 'F.SilkS' });

    expect(out.ids).toHaveLength(1);
    const added = out.board.shapes[out.board.shapes.length - 1]!;
    expect(added.kind).toBe('poly');
    expect(added.layer).toBe('F.SilkS');
    expect(added.fill).toBe(true);
  });

  it('leaves the source items on the board', () => {
    // Upstream's convertToPoly adds; deleting the originals is a separate
    // option on the dialog, not part of the conversion.
    const b = board({ shapes: squareSides() });
    const out = convertToPoly(b, allShapeIds(b), { layer: 'F.SilkS' });

    expect(out.board.shapes).toHaveLength(5);
  });

  it('does not fill when copying a line width', () => {
    const b = board({ shapes: squareSides() });
    const out = convertToPoly(b, allShapeIds(b), {
      layer: 'F.SilkS',
      strategy: 'copyLineWidth',
    });
    const added = out.board.shapes[out.board.shapes.length - 1]!;

    expect(added.fill).toBe(false);
    expect(added.width).toBe(MM(0.1));
  });

  it('returns the board untouched when nothing closes', () => {
    const b = board({ shapes: squareSides().slice(0, 2) });

    expect(convertToPoly(b, allShapeIds(b), { layer: 'F.SilkS' }).board).toBe(b);
  });
});

describe('convert to zone', () => {
  it('adds a zone on the chosen layer', () => {
    const b = board({ shapes: squareSides() });
    const out = convertToZone(b, allShapeIds(b), { layer: 'F.Cu', net: 3 });

    expect(out.ids).toEqual(['zone:0']);
    expect(out.board.zones[0]!.layers).toEqual(['F.Cu']);
    expect(out.board.zones[0]!.net).toBe(3);
    // Four corners, not five: the ring does not repeat its first point.
    expect(out.board.zones[0]!.outline).toHaveLength(4);
  });

  it('is a plain zone unless a rule area is asked for', () => {
    const b = board({ shapes: squareSides() });
    const out = convertToZone(b, allShapeIds(b), { layer: 'F.Cu' });

    expect(out.board.zones[0]!.ruleArea).toBeUndefined();
  });

  it('makes a rule area with ZONE_SETTINGS defaults', () => {
    // Every flag is *do not allow*: tracks, vias and pads forbidden, pours and
    // footprints still permitted.
    const b = board({ shapes: squareSides() });
    const out = convertToZone(b, allShapeIds(b), { layer: 'F.Cu', ruleArea: true });

    expect(out.board.zones[0]!.ruleArea).toEqual(DEFAULT_RULE_AREA_KEEPOUT);
    expect(DEFAULT_RULE_AREA_KEEPOUT.tracks).toBe(true);
    expect(DEFAULT_RULE_AREA_KEEPOUT.copperPour).toBe(false);
  });

  it('returns the board untouched when nothing closes', () => {
    const b = board({ shapes: squareSides().slice(0, 2) });

    expect(convertToZone(b, allShapeIds(b), { layer: 'F.Cu' }).board).toBe(b);
  });
});
