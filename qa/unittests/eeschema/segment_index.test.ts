// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SegmentIndex (eeschema/connectivity/segment_index.ts), the point-on-segment
 * lookup the connectivity pass leans on.
 *
 * It exists only to make `onSegment` scans cheap, so the contract it has to
 * keep is total equivalence with the scan it replaces: the same segments, in
 * the same order. These tests assert exactly that, including the cases the
 * bucketing could plausibly get wrong, degenerate (zero-length) segments,
 * genuinely diagonal ones, endpoints, and points that share a row or column
 * with a segment without touching it.
 */
import { describe, it, expect } from 'vitest';
import { SegmentIndex, onSegment } from '@ziroeda/eeschema/src/connectivity/segment_index.js';
import type { Vec2 } from '@ziroeda/eeschema/src/types.js';

interface Seg {
  item: number;
  a: Vec2;
  b: Vec2;
}

/** The scan the index replaces. */
const scan = (segs: readonly Seg[], p: Vec2): number[] =>
  segs.filter((s) => onSegment(p, s.a, s.b)).map((s) => s.item);

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('SegmentIndex', () => {
  it('matches a full scan over a random axis-aligned mesh', () => {
    const r = rng(0xc0ffee);
    const grid = (n: number) => Math.round(n * 8) * 1270; // on a 50 mil lattice
    const segs: Seg[] = [];
    for (let i = 0; i < 400; i++) {
      const x = grid(r());
      const y = grid(r());
      const len = grid(r()) + 1270;
      segs.push(
        r() < 0.5
          ? { item: i, a: { x, y }, b: { x: x + len, y } } // horizontal
          : { item: i, a: { x, y }, b: { x, y: y + len } }, // vertical
      );
    }
    const index = new SegmentIndex(segs);
    for (let k = 0; k < 3000; k++) {
      const p = { x: grid(r()), y: grid(r()) };
      expect(index.hits(p)).toEqual(scan(segs, p));
      expect(index.any(p)).toBe(scan(segs, p).length > 0);
    }
  });

  it('matches a full scan when diagonals and degenerate segments are mixed in', () => {
    const r = rng(0x5eed);
    const segs: Seg[] = [];
    for (let i = 0; i < 200; i++) {
      const x = Math.round(r() * 10) * 1000;
      const y = Math.round(r() * 10) * 1000;
      const d = Math.round(r() * 4) * 1000;
      const kind = i % 4;
      segs.push(
        kind === 0
          ? { item: i, a: { x, y }, b: { x: x + d, y } }
          : kind === 1
            ? { item: i, a: { x, y }, b: { x, y: y + d } }
            : kind === 2
              ? { item: i, a: { x, y }, b: { x: x + d, y: y + d } } // 45 degrees
              : { item: i, a: { x, y }, b: { x, y } }, // zero length
      );
    }
    const index = new SegmentIndex(segs);
    for (let x = 0; x <= 10000; x += 1000) {
      for (let y = 0; y <= 10000; y += 1000) {
        const p = { x, y };
        expect(index.hits(p)).toEqual(scan(segs, p));
      }
    }
  });

  it('includes endpoints and excludes collinear points beyond the span', () => {
    const seg: Seg = { item: 1, a: { x: 100, y: 50 }, b: { x: 400, y: 50 } };
    const index = new SegmentIndex([seg]);
    expect(index.hits({ x: 100, y: 50 })).toEqual([1]); // start
    expect(index.hits({ x: 400, y: 50 })).toEqual([1]); // end
    expect(index.hits({ x: 250, y: 50 })).toEqual([1]); // mid-span
    expect(index.hits({ x: 99, y: 50 })).toEqual([]); // just before
    expect(index.hits({ x: 401, y: 50 })).toEqual([]); // just past
    expect(index.hits({ x: 250, y: 51 })).toEqual([]); // off the row
  });

  it('returns overlapping segments in insertion order', () => {
    // Three wires crossing one point, as a junction sees them.
    const segs: Seg[] = [
      { item: 10, a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, // horizontal through
      { item: 20, a: { x: 50, y: -50 }, b: { x: 50, y: 50 } }, // vertical through
      { item: 30, a: { x: 0, y: -50 }, b: { x: 100, y: 50 } }, // diagonal through
    ];
    const index = new SegmentIndex(segs);
    expect(index.hits({ x: 50, y: 0 })).toEqual([10, 20, 30]);
    expect(index.hits({ x: 50, y: 0 })).toEqual(scan(segs, { x: 50, y: 0 }));
  });

  it('handles an empty index', () => {
    const index = new SegmentIndex<number>([]);
    expect(index.hits({ x: 0, y: 0 })).toEqual([]);
    expect(index.any({ x: 0, y: 0 })).toBe(false);
  });
});
