// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eda_search_data.h`: the find/replace criteria `EDA_ITEM::Matches` and
 * `EDA_ITEM::Replace` read.
 */

export enum EDA_SEARCH_MATCH_MODE {
  PLAIN = 0,
  WHOLEWORD = 1,
  WILDCARD = 2,
  REGEX = 3,
  PERMISSIVE = 4,
}

export class EDA_SEARCH_DATA {
  findString = '';
  replaceString = '';

  /** `mutable wxRegEx regex`: the compiled form, or null when not valid. */
  regex: RegExp | null = null;
  /** `mutable wxString regex_string`: the pattern `regex` was compiled from. */
  regex_string = '';

  searchAndReplace = false;
  searchAllFields = false;
  searchMetadata = false;

  matchCase = false;
  markersOnly = false;
  matchMode: EDA_SEARCH_MATCH_MODE = EDA_SEARCH_MATCH_MODE.PLAIN;

  constructor(other?: EDA_SEARCH_DATA) {
    if (!other) return;

    // Need an explicit copy constructor because wxRegEx is not copyable
    this.findString = other.findString;
    this.replaceString = other.replaceString;
    this.regex_string = other.regex_string;
    this.searchAndReplace = other.searchAndReplace;
    this.searchAllFields = other.searchAllFields;
    this.searchMetadata = other.searchMetadata;
    this.matchCase = other.matchCase;
    this.markersOnly = other.markersOnly;
    this.matchMode = other.matchMode;

    if (this.matchMode === EDA_SEARCH_MATCH_MODE.REGEX) {
      this.regex = compileRegex(this.findString, this.matchCase);
    }
  }
}

/** `wxRegEx::Compile( pattern, flag )`: the compiled expression, or null when it does not compile. */
export function compileRegex(pattern: string, matchCase: boolean): RegExp | null {
  try {
    return new RegExp(pattern, matchCase ? '' : 'i');
  } catch {
    return null;
  }
}

export class SCH_SEARCH_DATA extends EDA_SEARCH_DATA {
  searchAllPins = false;
  searchCurrentSheetOnly = false;
  searchSelectedOnly = false;
  searchNetNames = false;

  replaceReferences = false;
}
