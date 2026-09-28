// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbnew.cpp`, the part of the KIFACE other frames ask across kiway:
 * `filterFootprints`, which the symbol chooser's FOOTPRINT_SELECT_WIDGET
 * sends its request to.
 */
import { EDA_PATTERN_MATCH_WILDCARD_ANCHORED } from '@ziroeda/common/eda_pattern_match.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import type { FootprintIndexLibrary } from './footprint_info_impl.js';

/** `{"pin_count": N, "filters": [...], "zero_filters": bool, "max_results": N}`. */
export interface FootprintFilterRequest {
  pin_count?: number;
  filters?: readonly string[];
  zero_filters?: boolean;
  max_results?: number;
}

/**
 * `filterFootprints` (pcbnew.cpp:106): the preloaded footprints, library by
 * library (`GetLibraryNames()`: StrNumSort, case-insensitive) and each
 * library's in its cache's order (a map by name), kept when their unique pad
 * count equals `pin_count` (if > 0) and their lower-cased name - with
 * `nickname:` when the filter has a colon - matches ANY filter (an anchored
 * wildcard). No filter at all with `zero_filters` gives nothing. Stops at
 * `max_results`. Returns LIB_ID texts.
 *
 * `aLibraries` stands for the adapter's preloaded footprints: the hosted
 * index, whose `pads` is `GetUniquePadCount( DO_NOT_INCLUDE_NPTH )`.
 */
export function filterFootprints(
  aLibraries: readonly FootprintIndexLibrary[],
  aRequest: FootprintFilterRequest,
): string[] {
  const pinCount = aRequest.pin_count ?? 0;
  const zeroFilters = aRequest.zero_filters ?? true;
  const maxResults = aRequest.max_results ?? 400;

  const filterMatchers: EDA_PATTERN_MATCH_WILDCARD_ANCHORED[] = [];

  for (const pattern of aRequest.filters ?? []) {
    const matcher = new EDA_PATTERN_MATCH_WILDCARD_ANCHORED();
    matcher.SetPattern(pattern.toLowerCase());
    filterMatchers.push(matcher);
  }

  const hasFilters = pinCount > 0 || filterMatchers.length > 0;

  if (zeroFilters && !hasFilters) return [];

  const output: string[] = [];
  const libraries = [...aLibraries].sort((a, b) => strNumCmp(a.name, b.name, true));

  for (const lib of libraries) {
    const order = lib.footprints
      .map((name, i) => ({ name, i }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const { name: itemName, i } of order) {
      // Pin count filter
      if (pinCount > 0) {
        const fpPadCount = lib.pads?.[i] ?? 0;

        if (fpPadCount !== pinCount) continue;
      }

      // Footprint filter patterns with case-insensitive matching
      if (filterMatchers.length > 0) {
        let matches = false;

        for (const matcher of filterMatchers) {
          let name = '';

          // If filter contains ':', include library nickname in match string
          if (matcher.GetPattern().includes(':')) name = `${lib.name.toLowerCase()}:`;

          name += itemName.toLowerCase();

          if (matcher.Find(name)) {
            matches = true;
            break;
          }
        }

        if (!matches) continue;
      }

      output.push(`${lib.name}:${itemName}`);

      if (output.length >= maxResults) return output;
    }
  }

  return output;
}
