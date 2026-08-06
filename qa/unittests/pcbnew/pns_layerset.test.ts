// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The layer span a router item occupies. Counterpart: `PNS_LAYER_RANGE`.
 *
 * Two rules carry the weight and are tested first:
 *
 * - **The empty range overlaps nothing**, not even another empty range. A joint
 *   that has lost its last link is set to `(-1, -1)`, and that is the entire
 *   mechanism by which dangling joints stop being found and stop merging. If an
 *   empty range overlapped an empty range, every dead joint on the board would
 *   connect to every other one.
 * - **`intersection` does not follow that rule.** It reads a negative *end* as
 *   unbounded and takes the other side's, while the start is a plain maximum
 *   with no such escape. The asymmetry is upstream's and the two predicates
 *   cannot be written in terms of each other.
 */
import { describe, expect, it } from 'vitest';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';

describe('PnsLayerRange construction', () => {
  it('defaults to the empty range', () => {
    const r = new PnsLayerRange();
    expect(r.start()).toBe(-1);
    expect(r.end()).toBe(-1);
  });

  it('one argument makes a single-layer range', () => {
    const r = new PnsLayerRange(4);
    expect(r.start()).toBe(4);
    expect(r.end()).toBe(4);
    expect(r.isMultilayer()).toBe(false);
  });

  it('sorts its two endpoints, so (5,2) and (2,5) are the same range', () => {
    const a = new PnsLayerRange(5, 2);
    const b = new PnsLayerRange(2, 5);
    expect(a.start()).toBe(2);
    expect(a.end()).toBe(5);
    expect(a.equals(b)).toBe(true);
    expect(a.isMultilayer()).toBe(true);
  });

  it('all() is 0..256', () => {
    const r = PnsLayerRange.all();
    expect(r.start()).toBe(0);
    expect(r.end()).toBe(256);
  });

  it('clone is independent of the original', () => {
    const a = new PnsLayerRange(0, 1);
    const b = a.clone();
    b.merge(new PnsLayerRange(9));
    expect(a.end()).toBe(1);
    expect(b.end()).toBe(9);
  });
});

describe('PnsLayerRange.overlaps', () => {
  it('is true for touching spans and false for disjoint ones', () => {
    expect(new PnsLayerRange(0, 3).overlaps(new PnsLayerRange(3, 7))).toBe(true);
    expect(new PnsLayerRange(0, 3).overlaps(new PnsLayerRange(4, 7))).toBe(false);
  });

  it('the empty range overlaps nothing, not even another empty range', () => {
    const empty = new PnsLayerRange();
    expect(empty.overlaps(new PnsLayerRange(0, 31))).toBe(false);
    expect(new PnsLayerRange(0, 31).overlaps(empty)).toBe(false);
    expect(empty.overlaps(empty)).toBe(false);
  });

  it('a half-empty range — one endpoint negative — also overlaps nothing', () => {
    const half = new PnsLayerRange(-1, 5);
    expect(half.overlaps(new PnsLayerRange(0, 3))).toBe(false);
  });

  it('the single-layer overload matches inside the span and nowhere else', () => {
    const r = new PnsLayerRange(2, 6);
    expect(r.overlaps(2)).toBe(true);
    expect(r.overlaps(6)).toBe(true);
    expect(r.overlaps(7)).toBe(false);
    expect(r.overlaps(1)).toBe(false);
  });

  it('a negative layer never overlaps, even inside a range that includes -1', () => {
    expect(new PnsLayerRange(-1, 5).overlaps(-1)).toBe(false);
    expect(new PnsLayerRange(0, 5).overlaps(-1)).toBe(false);
  });
});

describe('PnsLayerRange.merge', () => {
  it('takes the other range wholesale when empty, rather than stretching from -1', () => {
    const r = new PnsLayerRange();
    r.merge(new PnsLayerRange(4, 9));
    expect(r.start()).toBe(4);
    expect(r.end()).toBe(9);
  });

  it('widens on both sides and is a no-op when already covering', () => {
    const r = new PnsLayerRange(4, 6);
    r.merge(new PnsLayerRange(2, 5));
    expect([r.start(), r.end()]).toEqual([2, 6]);
    r.merge(new PnsLayerRange(3, 4));
    expect([r.start(), r.end()]).toEqual([2, 6]);
    r.merge(new PnsLayerRange(3, 11));
    expect([r.start(), r.end()]).toEqual([2, 11]);
  });

  it('merging an *empty* range into a real one drags its start down to -1', () => {
    // Not a typo and not a nicety: the empty-source shortcut only guards the
    // receiver being empty, so -1 goes through the ordinary `min` on the way in
    // and the result is a half-empty range that now overlaps nothing at all.
    // Upstream's, and callers guard by testing `overlaps` before merging —
    // which is exactly what `JOINT::Merge` does.
    const r = new PnsLayerRange(3, 8);
    r.merge(new PnsLayerRange());
    expect([r.start(), r.end()]).toEqual([-1, 8]);
    expect(r.overlaps(new PnsLayerRange(3, 8))).toBe(false);
  });
});

describe('PnsLayerRange.intersection', () => {
  it('is the overlapping span', () => {
    const r = new PnsLayerRange(0, 9).intersection(new PnsLayerRange(4, 20));
    expect([r.start(), r.end()]).toEqual([4, 9]);
  });

  it('reads a negative end as unbounded and takes the other side, unlike overlaps', () => {
    const mine = new PnsLayerRange();
    const r = mine.intersection(new PnsLayerRange(2, 7));
    expect(r.end()).toBe(7);

    const s = new PnsLayerRange(2, 7).intersection(new PnsLayerRange());
    expect(s.end()).toBe(7);
  });

  it('gives the start no such escape: it is a plain maximum', () => {
    const r = new PnsLayerRange().intersection(new PnsLayerRange(2, 7));
    expect(r.start()).toBe(2);

    const s = new PnsLayerRange(2, 7).intersection(new PnsLayerRange());
    expect(s.start()).toBe(2);
  });
});
