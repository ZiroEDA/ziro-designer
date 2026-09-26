// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_FILTER` (include/footprint_filter.h, common/footprint_filter.cpp):
 * a view of a FOOTPRINT_LIST that yields only the footprints passing every
 * filter set on it - pin count, library, the symbol's footprint filters, and
 * the text box. CvPcb's footprint list and the symbol chooser's footprint
 * selector both walk one.
 */
import { EDA_PATTERN_MATCH_WILDCARD_ANCHORED, EdaCombinedMatcher } from './eda_pattern_match.js';
import type { FOOTPRINT_INFO, FOOTPRINT_LIST } from './footprint_info.js';

/** Filter setting constants. The filter type is a bitwise OR of these flags. */
export enum FP_FILTER_T {
  UNFILTERED_FP_LIST = 0,
  FILTERING_BY_COMPONENT_FP_FILTER = 0x0001,
  FILTERING_BY_PIN_COUNT = 0x0002,
  FILTERING_BY_LIBRARY = 0x0004,
  FILTERING_BY_TEXT_PATTERN = 0x0008,
}

export class FOOTPRINT_FILTER implements Iterable<FOOTPRINT_INFO> {
  static readonly UNFILTERED_FP_LIST = FP_FILTER_T.UNFILTERED_FP_LIST;
  static readonly FILTERING_BY_COMPONENT_FP_FILTER = FP_FILTER_T.FILTERING_BY_COMPONENT_FP_FILTER;
  static readonly FILTERING_BY_PIN_COUNT = FP_FILTER_T.FILTERING_BY_PIN_COUNT;
  static readonly FILTERING_BY_LIBRARY = FP_FILTER_T.FILTERING_BY_LIBRARY;
  static readonly FILTERING_BY_TEXT_PATTERN = FP_FILTER_T.FILTERING_BY_TEXT_PATTERN;

  private m_list: FOOTPRINT_LIST | null = null;
  private m_lib_name = '';
  private m_filter_pattern = '';
  private m_pin_count = -1;
  private m_filter_type: number = FP_FILTER_T.UNFILTERED_FP_LIST;
  private m_pattern_filters: EdaCombinedMatcher[] = [];
  private m_footprint_filters: EDA_PATTERN_MATCH_WILDCARD_ANCHORED[] = [];

  constructor(aList?: FOOTPRINT_LIST) {
    if (aList) this.SetList(aList);
  }

  /** Set the list to filter. */
  SetList(aList: FOOTPRINT_LIST): void {
    this.m_list = aList;
  }

  /** Clear all filter criteria. */
  ClearFilters(): void {
    this.m_filter_type = FP_FILTER_T.UNFILTERED_FP_LIST;
  }

  /** Add library name to filter criteria. */
  FilterByLibrary(aLibName: string): void {
    this.m_lib_name = aLibName;
    this.m_filter_type |= FP_FILTER_T.FILTERING_BY_LIBRARY;
  }

  /** Set a pin count to filter by. */
  FilterByPinCount(aPinCount: number): void {
    this.m_pin_count = aPinCount;
    this.m_filter_type |= FP_FILTER_T.FILTERING_BY_PIN_COUNT;
  }

  /**
   * Set a list of footprint filters to filter by: each is an anchored,
   * case-insensitive wildcard, the symbol's `ki_fp_filters`.
   */
  FilterByFootprintFilters(aFilters: readonly string[]): void {
    this.m_footprint_filters = [];

    for (const each_pattern of aFilters) {
      const matcher = new EDA_PATTERN_MATCH_WILDCARD_ANCHORED();
      matcher.SetPattern(each_pattern.toLowerCase());
      this.m_footprint_filters.push(matcher);
    }

    this.m_filter_type |= FP_FILTER_T.FILTERING_BY_COMPONENT_FP_FILTER;
  }

  /**
   * Add a pattern to filter by: each whitespace-separated token becomes its
   * own EDA_COMBINED_MATCHER in the CTX_LIBITEM context.
   */
  FilterByTextPattern(aPattern: string): void {
    this.m_filter_pattern = aPattern;

    for (const token of aPattern.toLowerCase().split(/[ \t\r\n]+/)) {
      if (token === '') continue;
      this.m_pattern_filters.push(new EdaCombinedMatcher(token.toLowerCase()));
    }

    this.m_filter_type |= FP_FILTER_T.FILTERING_BY_TEXT_PATTERN;
  }

  GetFilterPattern(): string {
    return this.m_filter_pattern;
  }

  /**
   * `begin()` / `end()`: the ITERATOR's `increment()` - a candidate is yielded
   * once it passes the pin count, library, footprint-filter and text-pattern
   * checks, in that order.
   */
  *[Symbol.iterator](): Iterator<FOOTPRINT_INFO> {
    const list = this.m_list;
    if (!list || list.GetCount() === 0) return;

    const filter_type = this.m_filter_type;

    for (let pos = 0; pos < list.GetCount(); ++pos) {
      const candidate = list.GetItem(pos);

      if (filter_type === FP_FILTER_T.UNFILTERED_FP_LIST) {
        yield candidate;
        continue;
      }

      if (filter_type & FP_FILTER_T.FILTERING_BY_PIN_COUNT) {
        if (!this.PinCountMatch(candidate)) continue;
      }

      if (filter_type & FP_FILTER_T.FILTERING_BY_LIBRARY) {
        if (this.m_lib_name !== '' && !candidate.InLibrary(this.m_lib_name)) continue;
      }

      if (filter_type & FP_FILTER_T.FILTERING_BY_COMPONENT_FP_FILTER) {
        if (!this.FootprintFilterMatch(candidate)) continue;
      }

      if (filter_type & FP_FILTER_T.FILTERING_BY_TEXT_PATTERN) {
        let exclude = false;

        for (const matcher of this.m_pattern_filters) {
          if (!matcher.scoreTerms(candidate.GetSearchTerms()).score) {
            exclude = true;
            break;
          }
        }

        if (exclude) continue;
      }

      // Candidate passed all filters
      yield candidate;
    }
  }

  /** Check if the stored component matches an item by footprint filter. */
  private FootprintFilterMatch(aItem: FOOTPRINT_INFO): boolean {
    if (this.m_footprint_filters.length === 0) return true;

    // The matching is case insensitive
    for (const each_filter of this.m_footprint_filters) {
      let name = '';

      // If the filter contains a ':' character, include the library name in the pattern
      if (each_filter.GetPattern().includes(':')) name = `${aItem.GetLibNickname().toLowerCase()}:`;

      name += aItem.GetFootprintName().toLowerCase();

      if (each_filter.Find(name)) return true;
    }

    return false;
  }

  /** Check if the stored component matches an item by pin count. */
  private PinCountMatch(aItem: FOOTPRINT_INFO): boolean {
    return this.m_pin_count >= 0 && this.m_pin_count === aItem.GetUniquePadCount();
  }
}
