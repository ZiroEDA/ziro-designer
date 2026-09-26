// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Which segments pass through this point?", the lookup at the heart of
 * KiCad's connectivity pass (CONNECTION_GRAPH::updateItemConnectivity, and the
 * junction / label rules that tie wires crossing a point).
 *
 * Answering it by scanning every wire makes the pass quadratic: a sheet with
 * 900 wires and 190 labels spends most of its time in `onSegment`. Schematic
 * wires are overwhelmingly axis-aligned and their coordinates are exact integer
 * IU, so bucketing horizontals by y and verticals by x turns the scan into a
 * hash lookup plus a range test over the few segments that share that row or
 * column. Anything genuinely diagonal (bus entries, sketch lines) stays on a
 * linear scan, which is what upstream's SEG::Contains does anyway.
 *
 * The answers are identical to scanning, this is an index, not an
 * approximation. Callers get the same set, in the same order they inserted.
 */

import type { Vec2 } from '../types.js';

/** True if point p lies on the segment a-b (exact, integer IU coordinates). */
export function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

export interface Segment<T> {
  readonly item: T;
  readonly a: Vec2;
  readonly b: Vec2;
}

/** A segment reduced to the span it occupies on its row or column. */
interface Span<T> {
  readonly item: T;
  readonly order: number;
  readonly lo: number;
  readonly hi: number;
}

export class SegmentIndex<T> {
  /** Horizontal (and degenerate) segments, bucketed by y; spans are in x. */
  private readonly byRow = new Map<number, Span<T>[]>();
  /** Strictly vertical segments, bucketed by x; spans are in y. */
  private readonly byCol = new Map<number, Span<T>[]>();
  /** Everything else, scanned exactly as before. */
  private readonly diagonal: (Segment<T> & { order: number })[] = [];

  constructor(segments: Iterable<Segment<T>>) {
    let order = 0;
    for (const s of segments) {
      const n = order++;
      if (s.a.y === s.b.y) {
        push(this.byRow, s.a.y, {
          item: s.item,
          order: n,
          lo: Math.min(s.a.x, s.b.x),
          hi: Math.max(s.a.x, s.b.x),
        });
      } else if (s.a.x === s.b.x) {
        push(this.byCol, s.a.x, {
          item: s.item,
          order: n,
          lo: Math.min(s.a.y, s.b.y),
          hi: Math.max(s.a.y, s.b.y),
        });
      } else {
        this.diagonal.push({ ...s, order: n });
      }
    }
  }

  /** Every segment passing through `p` (endpoints included), in insertion order. */
  hits(p: Vec2): T[] {
    const found: { item: T; order: number }[] = [];
    for (const s of this.byRow.get(p.y) ?? []) {
      if (p.x >= s.lo && p.x <= s.hi) found.push(s);
    }
    for (const s of this.byCol.get(p.x) ?? []) {
      if (p.y >= s.lo && p.y <= s.hi) found.push(s);
    }
    for (const s of this.diagonal) {
      if (onSegment(p, s.a, s.b)) found.push(s);
    }
    if (found.length > 1) found.sort((l, r) => l.order - r.order);
    return found.map((f) => f.item);
  }

  /** True if any segment passes through `p`, the same test, without building a list. */
  any(p: Vec2): boolean {
    for (const s of this.byRow.get(p.y) ?? []) {
      if (p.x >= s.lo && p.x <= s.hi) return true;
    }
    for (const s of this.byCol.get(p.x) ?? []) {
      if (p.y >= s.lo && p.y <= s.hi) return true;
    }
    for (const s of this.diagonal) {
      if (onSegment(p, s.a, s.b)) return true;
    }
    return false;
  }
}

function push<T>(map: Map<number, Span<T>[]>, key: number, span: Span<T>): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(span);
  else map.set(key, [span]);
}
