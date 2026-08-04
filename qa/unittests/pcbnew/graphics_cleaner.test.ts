// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Cleanup Graphics: zero-size and duplicated graphics.
 * Counterpart: `GRAPHICS_CLEANER::cleanupShapes`.
 *
 * Most of what is worth pinning is where "equivalent" is *narrower* or *wider*
 * than a careful engineer would make it. The comparison is per-defining-point
 * and not geometric, so a rectangle drawn corner-to-opposite-corner the other
 * way round is not a duplicate — while a minor arc and the major arc over the
 * same chord are, and one gets deleted. The second is an upstream bug, mirrored
 * deliberately: a board cleaned in KiCad and one cleaned here must agree.
 */
import { describe, expect, it } from 'vitest';
import {
  DRC_EPSILON,
  areEquivalent,
  cleanupGraphics,
  equivalentPt,
  isNullShape,
} from '@ziroeda/pcbnew/src/graphics_cleaner.js';
import type { Board, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number) => ({ x, y });

const shape = (over: Partial<PcbShape> = {}): PcbShape => ({
  kind: 'line',
  start: P(0, 0),
  end: P(10_000, 0),
  width: 100,
  fill: false,
  layer: 'F.SilkS',
  source: EMPTY,
  ...over,
});

const board = (shapes: PcbShape[]): Board =>
  ({
    version: 20240108,
    layers: [],
    nets: new Map(),
    footprints: [],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes,
    texts: [],
    dimensions: [],
    textBoxes: [],
    tables: [],
    images: [],
    groups: [],
    source: EMPTY,
  }) as unknown as Board;

describe('what counts as the same point', () => {
  it('is a per-axis box with a strict less-than', () => {
    // Not a Euclidean distance. Exactly the epsilon on one axis is outside;
    // 495 on *both* axes is inside even though those points are ~700 apart.
    expect(equivalentPt(P(0, 0), P(DRC_EPSILON, 0), DRC_EPSILON)).toBe(false);
    expect(equivalentPt(P(0, 0), P(DRC_EPSILON - 1, 0), DRC_EPSILON)).toBe(true);
    expect(equivalentPt(P(0, 0), P(495, 495), DRC_EPSILON)).toBe(true);
  });
});

describe('what counts as a zero-size shape', () => {
  it('catches a segment, rectangle or arc whose ends coincide', () => {
    for (const kind of ['line', 'rect', 'arc'] as const)
      expect(isNullShape(shape({ kind, start: P(0, 0), end: P(10, 0) }))).toBe(true);
  });

  it('leaves one whose ends are a full epsilon apart', () => {
    expect(isNullShape(shape({ start: P(0, 0), end: P(DRC_EPSILON, 0) }))).toBe(false);
  });

  it('never calls a circle null', () => {
    // Upstream tests GetRadius() == 0, which is unreachable because GetRadius
    // clamps with max(1, ...). Measuring the radius here instead would delete
    // circles KiCad keeps.
    expect(isNullShape(shape({ kind: 'circle', center: P(0, 0), end: P(0, 0) }))).toBe(false);
  });

  it('calls a polygon null only when it has no points at all', () => {
    expect(isNullShape(shape({ kind: 'poly', pts: [] }))).toBe(true);
    expect(isNullShape(shape({ kind: 'poly', pts: [P(0, 0)] }))).toBe(false);
  });

  it('flattens a bezier before judging it', () => {
    // A curve that flattens to one segment is judged on its endpoints; one
    // that needs more than two points is never null however short it is.
    const flat = shape({ kind: 'curve', pts: [P(0, 0), P(0, 0), P(0, 0), P(0, 0)] });
    const curved = shape({
      kind: 'curve',
      pts: [P(0, 0), P(0, 5_000_000), P(10_000_000, 5_000_000), P(10_000_000, 0)],
    });

    expect(isNullShape(flat)).toBe(true);
    expect(isNullShape(curved)).toBe(false);
  });
});

describe('what counts as a duplicate', () => {
  it('requires the same kind, layer and width exactly', () => {
    const a = shape();

    expect(areEquivalent(a, shape())).toBe(true);
    expect(areEquivalent(a, shape({ layer: 'B.SilkS' }))).toBe(false);
    expect(areEquivalent(a, shape({ width: 101 }))).toBe(false);
    expect(areEquivalent(a, shape({ kind: 'rect' }))).toBe(false);
  });

  it('ignores fill, stroke type and locked state', () => {
    // So a filled rectangle over an unfilled one is a duplicate, and the
    // filled one can be the copy that goes. Comparing fill as well would
    // quietly refuse removals that KiCad performs.
    const a = shape({ kind: 'rect', fill: false });
    const b = shape({ kind: 'rect', fill: true, strokeType: 'dash', locked: true });

    expect(areEquivalent(a, b)).toBe(true);
  });

  it('is orientation-sensitive for a rectangle', () => {
    // Same area on screen, different defining points.
    const a = shape({ kind: 'rect', start: P(0, 0), end: P(10_000, 10_000) });
    const b = shape({ kind: 'rect', start: P(10_000, 10_000), end: P(0, 0) });

    expect(areEquivalent(a, b)).toBe(false);
  });

  it('compares a circle’s stored point rather than its radius', () => {
    // Two identical circles drawn from different angles are not duplicates.
    const a = shape({ kind: 'circle', center: P(0, 0), end: P(10_000, 0) });
    const b = shape({ kind: 'circle', center: P(0, 0), end: P(0, 10_000) });

    expect(areEquivalent(a, b)).toBe(false);
    expect(areEquivalent(a, shape({ kind: 'circle', center: P(0, 0), end: P(10_000, 0) }))).toBe(
      true,
    );
  });

  it('ignores an arc’s mid point, so the two arcs over one chord collide', () => {
    // A minor arc and the major arc share centre, start and end and differ only
    // in mid — upstream compares the first three, so one is deleted. This is an
    // upstream bug and mirroring it is the point: diverging "for the better"
    // is how a board cleaned in each tool stops matching.
    const minor = shape({
      kind: 'arc',
      center: P(0, 0),
      start: P(10_000, 0),
      end: P(0, 10_000),
      mid: P(7_071, 7_071),
    });
    const major = shape({
      kind: 'arc',
      center: P(0, 0),
      start: P(10_000, 0),
      end: P(0, 10_000),
      mid: P(-7_071, -7_071),
    });

    expect(areEquivalent(minor, major)).toBe(true);
  });

  it('never deduplicates polygons', () => {
    // Upstream's POLY branch is an unimplemented TODO returning false.
    const a = shape({ kind: 'poly', pts: [P(0, 0), P(10, 0), P(10, 10)] });

    expect(areEquivalent(a, { ...a })).toBe(false);
  });
});

describe('running the pass', () => {
  it('keeps the earlier shape and reports the later one', () => {
    // The scan compares each shape against every *later* shape, so which copy
    // survives is decided by drawing order. A reversed scan would remove the
    // same count and keep a different shape.
    const b = board([shape(), shape()]);
    const out = cleanupGraphics(b);

    expect(out.items).toEqual([
      { code: 'duplicate_graphic', id: 'shape:1', message: 'Remove duplicated graphic' },
    ]);
    expect(out.board.shapes).toHaveLength(1);
    expect(out.board.shapes[0]).toBe(b.shapes[0]);
  });

  it('reports three identical shapes as two duplicates, not a chain', () => {
    // The second is marked deleted the moment it is matched, so the third is
    // compared against the first rather than against a shape on its way out.
    const out = cleanupGraphics(board([shape(), shape(), shape()]));

    expect(out.items.map((i) => i.id)).toEqual(['shape:1', 'shape:2']);
    expect(out.board.shapes).toHaveLength(1);
  });

  it('reports two coincident zero-size shapes as null, not as a duplicate', () => {
    // A null shape is skipped without being marked deleted, so it never
    // becomes a duplicate base — and it is never itself reported as a copy.
    const nul = shape({ start: P(0, 0), end: P(0, 0) });
    const out = cleanupGraphics(board([nul, { ...nul }]));

    expect(out.items.map((i) => i.code)).toEqual(['null_graphic', 'null_graphic']);
  });

  it('changes nothing on a dry run but still reports', () => {
    const b = board([shape(), shape()]);
    const out = cleanupGraphics(b, { dryRun: true });

    expect(out.items).toHaveLength(1);
    expect(out.board).toBe(b);
  });

  it('returns the same board when there is nothing to do', () => {
    const b = board([shape(), shape({ layer: 'B.SilkS' })]);

    expect(cleanupGraphics(b).board).toBe(b);
  });

  it('removes a null shape and a duplicate in one pass', () => {
    const out = cleanupGraphics(board([shape({ start: P(0, 0), end: P(0, 0) }), shape(), shape()]));

    expect(out.items.map((i) => i.code)).toEqual(['null_graphic', 'duplicate_graphic']);
    expect(out.board.shapes).toHaveLength(1);
  });
});
