// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Types for `fp_index.mjs`, so the qa suite can check the index fields the
 * hosted footprint list is built from against the parsed-board code that has to
 * agree with them. The pipeline scripts are plain ESM (they run under bare
 * node, with no build step); this is the only part of them a typed caller
 * reaches into.
 */

/** The FOOTPRINT_INFO fields the browser filter engine reads. */
export interface FootprintIndexInfo {
  /** `FOOTPRINT::GetUniquePadCount( DO_NOT_INCLUDE_NPTH )`. */
  pads: number;
  /** `(descr …)`, FOOTPRINT::GetLibDescription; '' when absent. */
  descr: string;
  /** `(tags …)`, FOOTPRINT::GetKeywords; '' when absent. */
  tags: string;
}

export function uniquePadNumbers(text: string, includeNpth?: boolean): Set<string>;
export function footprintIndexInfo(text: string): FootprintIndexInfo;
