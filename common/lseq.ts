// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/lseq.h` / `common/lseq.cpp`: `LSEQ`, a sequence (and therefore
 * also a set) of PCB_LAYER_IDs. A sequence provides a certain order. It is a
 * `std::vector<PCB_LAYER_ID>` with one member function, which is a free
 * function here.
 */

import type { PCB_LAYER_ID } from './layer_id.js';

export type LSEQ = PCB_LAYER_ID[];

/** `LSEQ::TestLayers`: the signed distance from `aRhs` to `aLhs` in the sequence. */
export function LSEQ_TestLayers(
  aSeq: readonly PCB_LAYER_ID[],
  aRhs: PCB_LAYER_ID,
  aLhs: PCB_LAYER_ID,
): number {
  if (aRhs === aLhs) return 0;

  const itRhs = aSeq.indexOf(aRhs);
  const itLhs = aSeq.indexOf(aLhs);

  // std::distance( find(), find() ): a miss is end(), one past the last element.
  const posRhs = itRhs < 0 ? aSeq.length : itRhs;
  const posLhs = itLhs < 0 ? aSeq.length : itLhs;

  return posLhs - posRhs;
}
