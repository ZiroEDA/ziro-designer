// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Even distribution: the deltas that space a row of items out evenly.
 * Counterpart: `libs/kimath/src/geometry/distribute.cpp`.
 *
 * Two senses, and they are genuinely different operations rather than two
 * spellings of one. Distributing by *gaps* makes the empty space between items
 * equal, so items of different sizes end up unevenly spaced but evenly
 * separated. Distributing by *points* makes the chosen reference points —
 * centres, usually — equally spaced, so items of different sizes end up with
 * unequal gaps. Which one is wanted depends on whether the eye is meant to
 * follow the objects or the space between them.
 *
 * Both leave the first and last items alone: they define the span, and moving
 * them would make the operation depend on how many times it had been run.
 */

/** KiCad's KiROUND: half away from zero, not JavaScript's half-up. */
const kiRound = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

/**
 * `GetDeltasForDistributeByGaps`: equalise the space *between* items.
 *
 * `extents` are [start, end] pairs along the axis, sorted by start. The result
 * is one delta per item, in the same order.
 */
export function deltasForDistributeByGaps(
  extents: readonly (readonly [number, number])[],
): number[] {
  const deltas = new Array<number>(extents.length).fill(0);

  // Fewer than three items have no interior to distribute.
  if (extents.length < 3) return deltas;

  // The space between the first and last items' *inner* edges, less what the
  // middle items themselves occupy: what is left is gap to share out.
  let totalGap = extents[extents.length - 1]![0] - extents[0]![1];

  for (let i = 1; i < extents.length - 1; i++) {
    const [start, end] = extents[i]!;
    totalGap -= end - start;
  }

  const perItemGap = totalGap / (extents.length - 1);

  // Walk from the end of the first item, stepping over each item's own span.
  let targetPos = extents[0]![1];

  // Stopping before the last item states the intent — end caps do not move —
  // rather than doing work. `totalGap` was derived so that the last item is
  // already where equal gaps put it, so the formula yields zero for it anyway;
  // extending the loop changes no output. Upstream writes the bound for the
  // same reason, and says so in a comment.
  for (let i = 1; i < extents.length - 1; i++) {
    const [start, end] = extents[i]!;

    // The accumulator stays integer and the fractional gap is re-multiplied
    // each time, so rounding error cannot stack across a long row.
    deltas[i] = targetPos - start + kiRound(i * perItemGap);
    targetPos += end - start;
  }

  return deltas;
}

/**
 * `GetDeltasForDistributeByPoints`: equalise the spacing of reference points.
 *
 * `positions` are the points — item centres, for the Distribute Centers
 * actions — sorted ascending.
 */
export function deltasForDistributeByPoints(positions: readonly number[]): number[] {
  const deltas = new Array<number>(positions.length).fill(0);

  if (positions.length < 3) return deltas;

  const startPos = positions[0]!;
  const totalGaps = positions[positions.length - 1]! - startPos;
  const itemGap = totalGaps / (positions.length - 1);

  for (let i = 1; i < positions.length - 1; i++)
    deltas[i] = startPos + kiRound(i * itemGap) - positions[i]!;

  return deltas;
}
