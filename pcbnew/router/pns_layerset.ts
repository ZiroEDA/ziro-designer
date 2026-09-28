// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The contiguous span of copper layers a router item occupies.
 * Counterpart: `PNS_LAYER_RANGE` (pcbnew/router/pns_layerset.h), ported whole.
 *
 * This is a *class* rather than the plain-data-plus-functions idiom the rest of
 * `router/` uses, for one reason: upstream mutates a range in place — `JOINT`
 * widens its own layer span when two joints merge, and empties it back to the
 * "nothing" range when its last link goes away. A value type would make those
 * two operations return new objects, and every holder of a range would then
 * need to be taught to reassign. The identity is real, so the class is real.
 *
 * ## -1 is not a layer, and that is load-bearing
 *
 * A default-constructed range is `(-1, -1)`, which upstream uses to mean "no
 * layers at all" — a joint that has just lost its last link, a hole whose layer
 * span has not been assigned yet. Every `Overlaps` test therefore begins by
 * rejecting negative endpoints, so an empty range overlaps *nothing*, not even
 * another empty range. Getting that backwards would make dangling joints
 * connect to each other.
 *
 * `Intersection` deliberately does *not* follow that rule: it treats a negative
 * end as "unbounded" and takes the other side's. That asymmetry is upstream's
 * and it is why the two must not be written in terms of each other.
 */

/** `PNS_LAYER_RANGE`: a contiguous, inclusive span of layer indices. */
export class PnsLayerRange {
  private mStart: number;
  private mEnd: number;

  /**
   * No arguments gives the empty range `(-1, -1)`; one argument gives the
   * single layer `(l, l)`; two are sorted, so `(5, 2)` and `(2, 5)` are the
   * same range. All three of upstream's constructors.
   */
  constructor(start?: number, end?: number) {
    if (start === undefined) {
      this.mStart = -1;
      this.mEnd = -1;
      return;
    }

    if (end === undefined) {
      this.mStart = start;
      this.mEnd = start;
      return;
    }

    if (start > end) {
      this.mStart = end;
      this.mEnd = start;
    } else {
      this.mStart = start;
      this.mEnd = end;
    }
  }

  /** C++ copy construction; TS has to ask for it. */
  clone(): PnsLayerRange {
    const r = new PnsLayerRange();
    r.mStart = this.mStart;
    r.mEnd = this.mEnd;
    return r;
  }

  start(): number {
    return this.mStart;
  }

  end(): number {
    return this.mEnd;
  }

  /**
   * Both of upstream's `Overlaps` overloads. Either endpoint being negative —
   * on either side — means no overlap, so the empty range touches nothing.
   */
  overlaps(other: PnsLayerRange | number): boolean {
    if (typeof other === 'number') {
      if (this.mStart < 0 || this.mEnd < 0 || other < 0) return false;
      return other >= this.mStart && other <= this.mEnd;
    }

    if (this.mStart < 0 || this.mEnd < 0 || other.mStart < 0 || other.mEnd < 0) return false;
    return this.mEnd >= other.mStart && this.mStart <= other.mEnd;
  }

  isMultilayer(): boolean {
    return this.mStart !== this.mEnd;
  }

  /**
   * Widen in place to cover `other` as well. An empty range takes `other`
   * wholesale rather than stretching from -1, which is what lets a freshly
   * emptied joint be re-linked without dragging a phantom layer -1 along.
   */
  merge(other: PnsLayerRange): void {
    if (this.mStart < 0 || this.mEnd < 0) {
      this.mStart = other.mStart;
      this.mEnd = other.mEnd;
      return;
    }

    if (other.mStart < this.mStart) this.mStart = other.mStart;
    if (other.mEnd > this.mEnd) this.mEnd = other.mEnd;
  }

  /**
   * The overlapping span. Note that unlike `overlaps`, a negative *end* is read
   * as unbounded here and the other side's end is taken; the start is a plain
   * max with no such escape. Upstream's asymmetry, kept.
   */
  intersection(other: PnsLayerRange): PnsLayerRange {
    const overlap = new PnsLayerRange();
    overlap.mStart = Math.max(this.mStart, other.mStart);

    if (this.mEnd < 0) overlap.mEnd = other.mEnd;
    else if (other.mEnd < 0) overlap.mEnd = this.mEnd;
    else overlap.mEnd = Math.min(this.mEnd, other.mEnd);

    return overlap;
  }

  /** Shortcut for comparisons/overlap tests. Upstream's `fixme: use layer IDs`. */
  static all(): PnsLayerRange {
    return new PnsLayerRange(0, 256);
  }

  equals(other: PnsLayerRange): boolean {
    return this.mStart === other.mStart && this.mEnd === other.mEnd;
  }
}
