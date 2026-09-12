// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `core/kicad_algo.h`: the `alg::` helpers.
 */

/**
 * `alg::longest_common_subset`: the length of the longest common contiguous
 * run of two sequences, under `aEqual`.
 */
export function longest_common_subset<T>(
  c1: readonly T[],
  c2: readonly T[],
  aEqual: (a: T, b: T) => boolean,
): number {
  const c1_size = c1.length;
  const c2_size = c2.length;

  if (c1_size === 0 || c2_size === 0) return 0;

  // Create a 2D table to store the lengths of common subsets
  const table: number[][] = [];
  for (let i = 0; i <= c1_size; ++i) table.push(new Array<number>(c2_size + 1).fill(0));

  let longest = 0;

  for (let i = 1; i <= c1_size; ++i) {
    for (let j = 1; j <= c2_size; ++j) {
      if (aEqual(c1[i - 1]!, c2[j - 1]!)) {
        table[i]![j] = table[i - 1]![j - 1]! + 1;
        longest = Math.max(longest, table[i]![j]!);
      }
    }
  }

  return longest;
}
