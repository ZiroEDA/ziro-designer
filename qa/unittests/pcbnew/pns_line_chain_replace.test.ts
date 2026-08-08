// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_LINE_CHAIN::Replace` and the `Remove( int, int )` range underneath it.
 * Counterpart: `libs/kimath/src/geometry/shape_line_chain.cpp:999-1165`.
 *
 * These landed for the diff-pair optimizer, which is the only caller in the
 * port, but the behaviour worth pinning is the part that caller *depends on*
 * without saying so: `Replace` silently narrows its range when the replacement
 * chain already shares an endpoint with the chain it is going into. Every
 * `coupledBypass` candidate hands in a bypass whose two ends are the coupled
 * lane's own vertices, and without the narrowing each of them would come back
 * doubled.
 */
import { describe, expect, it } from 'vitest';
import { PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { constructArcFromStartEndAngle } from '@ziroeda/pcbnew/src/router/shape_arc_ops.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

/** Four points in a row, a thousand apart. */
const straight = (): PnsLineChain =>
  PnsLineChain.fromPoints([V(0, 0), V(1000, 0), V(2000, 0), V(3000, 0)]);

/** A straight run, then a quarter arc, then a straight run. */
function withArc(): PnsLineChain {
  const c = new PnsLineChain();

  c.appendPoint(V(-1000000, 0));
  c.appendArcShape(constructArcFromStartEndAngle(V(0, 0), V(1000000, 1000000), new EDA_ANGLE(90)));
  c.appendPoint(V(2000000, 1000000));

  return c;
}

describe('SHAPE_LINE_CHAIN::Remove( aStartIndex, aEndIndex )', () => {
  it('drops an inclusive vertex range', () => {
    const c = straight();

    c.remove(1, 2);

    expect(c.points()).toEqual([V(0, 0), V(3000, 0)]);
  });

  it('folds negative indices from the end, end before start', () => {
    const c = straight();

    c.remove(-2, -1);

    expect(c.points()).toEqual([V(0, 0), V(1000, 0)]);
  });

  it('does nothing when the range is inverted or off the end', () => {
    // Upstream's three guards, all on one `if`: past the end either way, or
    // start after end. It returns without touching the chain rather than
    // clamping, which is what makes `Replace`'s narrowing safe when it runs the
    // range down to nothing.
    for (const [a, b] of [
      [2, 1],
      [4, 4],
      [0, 4],
    ]) {
      const c = straight();

      c.remove(a as number, b as number);

      expect(c.pointCount()).toBe(4);
    }
  });

  it('converts an arc the range swallows, and keeps the points that survive', () => {
    // Every point of the arc is inside the range, so `convertArc` runs and the
    // chain comes back with no arcs at all — the surviving geometry is plain
    // points. This is the arm that makes a `Remove` across an arc safe without
    // `ConstructFromStartEndCenter`.
    const c = withArc();
    const last = c.pointCount() - 1;

    expect(c.arcCount()).toBe(1);

    c.remove(1, last - 1);

    expect(c.arcCount()).toBe(0);
    expect(c.points()).toEqual([V(-1000000, 0), V(2000000, 1000000)]);
  });

  it('splits an arc the range cuts through and keeps the surviving half', () => {
    // This used to throw: `splitArc` needs `ConstructFromStartEndCenter`, and
    // that is ported now. Vertex 3 is strictly inside the arc, so the arc is
    // cut there into (p0 → vertex 2) and (vertex 3 → p1); the range then
    // swallows the second half, `convertArc` drops it, and what is left is the
    // first half — still an arc, still starting where the original did, but now
    // ending at vertex 2.
    const c = withArc();
    const last = c.pointCount() - 1;
    const cut = { ...c.cPoint(2) };

    c.remove(3, last);

    expect(c.pointCount()).toBe(3);
    expect(c.arcCount()).toBe(1);
    expect(c.arc(0).p0).toEqual(V(0, 0));
    expect(c.arc(0).p1).toEqual(cut);

    // The kept half is still on the original circle, so it is still a genuine
    // arc rather than the chord between its endpoints.
    expect(c.arc(0).arcMid).not.toEqual(V(0, 0));
    expect(c.isArcStart(1)).toBe(true);
  });
});

describe('SHAPE_LINE_CHAIN::Replace( aStartIndex, aEndIndex, aP )', () => {
  it('collapses the range onto one point', () => {
    const c = straight();

    c.replace(1, 2, V(1500, 500));

    expect(c.points()).toEqual([V(0, 0), V(1500, 500), V(3000, 0)]);
  });

  it('appends when the range ran to the very end, and drops a duplicate doing it', () => {
    // The point overload is `Remove` then `Insert`, and `Insert` at exactly
    // `PointCount()` is `Append` — which refuses a point identical to the
    // current last one. So replacing the tail with the point that is already
    // in front of it shortens the chain by the whole range.
    const c = straight();

    c.replace(2, 3, V(1000, 0));

    expect(c.points()).toEqual([V(0, 0), V(1000, 0)]);
  });
});

describe('SHAPE_LINE_CHAIN::Replace( aStartIndex, aEndIndex, aLine )', () => {
  it('splices a chain in and leaves the argument alone', () => {
    const c = straight();
    const ins = PnsLineChain.fromPoints([V(500, 500), V(2500, 500)]);

    c.replace(1, 2, ins);

    expect(c.points()).toEqual([V(0, 0), V(500, 500), V(2500, 500), V(3000, 0)]);
    expect(ins.points()).toEqual([V(500, 500), V(2500, 500)]);
  });

  it('narrows the range at both ends when the replacement shares them', () => {
    // The case the diff-pair optimizer lives on: a bypass from the chain's own
    // vertex 1 to its own vertex 3. Both coincident points are trimmed off the
    // replacement and the range shrinks to just vertex 2, so what actually gets
    // spliced in is the bypass's *interior*.
    const c = straight();
    const bypass = PnsLineChain.fromPoints([V(1000, 0), V(1500, 700), V(3000, 0)]);

    c.replace(1, 3, bypass);

    expect(c.points()).toEqual([V(0, 0), V(1000, 0), V(1500, 700), V(3000, 0)]);
  });

  it('is a plain removal when the replacement is empty', () => {
    const c = straight();

    c.replace(1, 2, new PnsLineChain());

    expect(c.points()).toEqual([V(0, 0), V(3000, 0)]);
  });

  it('removes the narrowed range when trimming the head empties the replacement', () => {
    // A one-point replacement equal to the range's first vertex: the head trim
    // takes that point, the replacement is now empty, and what is left to do is
    // `Remove( start + 1, end )`. So vertex 1 survives and vertex 2 does not.
    const c = straight();

    c.replace(1, 2, PnsLineChain.fromPoints([V(1000, 0)]));

    expect(c.points()).toEqual([V(0, 0), V(1000, 0), V(3000, 0)]);
  });

  it('does not trim a coincident tail at index 0', () => {
    // Upstream guards the tail trim with `aEndIndex > 0`, and the guard is not
    // decoration. Replacing vertex 0 with a chain that *ends* on vertex 0 —
    // prepending, in other words — would otherwise decrement `aEndIndex` to -1,
    // which `Remove` folds back round to the last vertex and erases the entire
    // chain. With the guard the range stays at vertex 0 and the prepend works.
    const c = straight();

    c.replace(0, 0, PnsLineChain.fromPoints([V(-1000, 0), V(0, 0)]));

    expect(c.points()).toEqual([V(-1000, 0), V(0, 0), V(1000, 0), V(2000, 0), V(3000, 0)]);
  });

  it('leaves the chain alone when the head trim empties a replacement at vertex 0', () => {
    // The other way into the same corner: the replacement *is* vertex 0, so the
    // head trim takes its only point and the range that is left (`1..0`) is
    // inverted. `Remove` refuses it and nothing happens.
    const c = straight();

    c.replace(0, 0, PnsLineChain.fromPoints([V(0, 0)]));

    expect(c.points()).toEqual([V(0, 0), V(1000, 0), V(2000, 0), V(3000, 0)]);
  });

  it('rebases the incoming arc indices past the arcs already here', () => {
    // The chain being replaced into already owns arc 0. The replacement owns
    // its own arc 0, and every one of its shape indices is bumped by the host's
    // arc count before the splice, so it lands as arc 1. Get that wrong and
    // both chains claim the same arc and the geometry silently doubles.
    //
    // The replaced range is vertex 0 — the plain point in front of the host's
    // arc — so the removal touches no arc, and the count read after it is still
    // 1.
    const c = withArc();
    const ins = new PnsLineChain();

    ins.appendPoint(V(-3000000, 0));
    ins.appendArcShape(
      constructArcFromStartEndAngle(V(-2000000, 0), V(-1000000, 1000000), new EDA_ANGLE(90)),
    );

    c.replace(0, 0, ins);

    expect(c.arcCount()).toBe(2);
    expect(c.points()[0]).toEqual(V(-3000000, 0));

    // Vertex 1 starts the spliced-in arc; it must point at arc 1, not arc 0.
    expect(c.arcIndex(1)).toBe(1);
    expect(c.arc(1).p0).toEqual(V(-2000000, 0));

    // ...and the host's own arc is still arc 0, unmoved.
    expect(c.arc(0).p0).toEqual(V(0, 0));
  });
});
