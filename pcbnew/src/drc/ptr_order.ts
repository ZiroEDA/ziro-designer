// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `static_cast<void*>( a ) > static_cast<void*>( b )`: several test providers
 * dedup a pair (or build a `PTR_PTR_CACHE_KEY`) by pointer order, which only
 * has to be *some* strict order. Objects have no address here, so each one is
 * numbered the first time it is compared.
 */
const s_ptrOrdinal = new WeakMap<object, number>();
let s_nextOrdinal = 0;

export const ptrOrdinal = (a: object): number => {
  let n = s_ptrOrdinal.get(a);

  if (n === undefined) {
    n = s_nextOrdinal++;
    s_ptrOrdinal.set(a, n);
  }

  return n;
};

export const ptrGreater = (a: object, b: object): boolean => ptrOrdinal(a) > ptrOrdinal(b);

/** `PTR_PTR_CACHE_KEY` in canonical (pointer) order, as a map key. */
export const ptrPairKey = (a: object, b: object): string => {
  if (ptrGreater(a, b)) [a, b] = [b, a];

  return `${ptrOrdinal(a)}:${ptrOrdinal(b)}`;
};
