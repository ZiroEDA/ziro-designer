// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_INFO` and `FOOTPRINT_LIST` (include/footprint_info.h,
 * common/footprint_info.cpp): what the choosers and CvPcb know about a
 * footprint without loading it - library, name, pad counts, description,
 * keywords - and the list of all of them. The list that loads them is
 * pcbnew's `FOOTPRINT_LIST_IMPL` (pcbnew/footprint_info_impl.ts).
 */
import { searchTerm, type SearchTerm } from './eda_pattern_match.js';
import { LIB_ID } from './lib_id.js';
import { strNumCmp } from './string_utils.js';

export abstract class FOOTPRINT_INFO {
  /** provides access to FP_LIB_TABLE */
  protected m_owner: FOOTPRINT_LIST | null = null;
  protected m_loaded = false;
  /** library as known in FP_LIB_TABLE */
  protected m_nickname = '';
  /** Module name. */
  protected m_fpname = '';
  /** Order number in the display list. */
  protected m_num = 0;
  /** Number of pads */
  protected m_pad_count = 0;
  /** Number of unique pads */
  protected m_unique_pad_count = 0;
  /** Footprint description. */
  protected m_doc = '';
  /** Footprint keywords. */
  protected m_keywords = '';
  protected m_searchTerms: SearchTerm[] = [];

  GetLibNickname(): string {
    return this.m_nickname;
  }

  GetFootprintName(): string {
    return this.m_fpname;
  }

  GetName(): string {
    return this.m_fpname;
  }

  GetPinCount(): number {
    return this.GetUniquePadCount();
  }

  GetLIB_ID(): LIB_ID {
    return new LIB_ID(this.m_nickname, this.m_fpname);
  }

  GetDesc(): string {
    this.ensure_loaded();
    return this.m_doc;
  }

  GetKeywords(): string {
    this.ensure_loaded();
    return this.m_keywords;
  }

  /**
   * `GetSearchTerms`: the nickname (4), the name (8, a name term), the LIB_ID
   * (16, a name term), each keyword token (4), then the whole keywords and the
   * description (1 each).
   */
  GetSearchTerms(): SearchTerm[] {
    this.m_searchTerms = [];

    this.m_searchTerms.push(searchTerm(this.GetLibNickname(), 4));
    this.m_searchTerms.push(searchTerm(this.GetName(), 8, true));
    this.m_searchTerms.push(searchTerm(this.GetLIB_ID().Format(), 16, true));

    // wxStringTokenizer( keywords, " \t\r\n", wxTOKEN_STRTOK )
    for (const token of this.GetKeywords().split(/[ \t\r\n]+/)) {
      if (token !== '') this.m_searchTerms.push(searchTerm(token, 4));
    }

    // Also include keywords as one long string, just in case
    this.m_searchTerms.push(searchTerm(this.GetKeywords(), 1));
    this.m_searchTerms.push(searchTerm(this.GetDesc(), 1));

    return this.m_searchTerms;
  }

  GetPadCount(): number {
    this.ensure_loaded();
    return this.m_pad_count;
  }

  GetUniquePadCount(): number {
    this.ensure_loaded();
    return this.m_unique_pad_count;
  }

  GetOrderNum(): number {
    this.ensure_loaded();
    return this.m_num;
  }

  /** Test if the FOOTPRINT_INFO object was loaded from aLibrary. */
  InLibrary(aLibrary: string): boolean {
    return aLibrary === this.m_nickname;
  }

  /**
   * `operator<`: by nickname, then name, each StrNumCmp without ignoring case
   * ("technically footprint names are not case sensitive because the file name
   * is used as the footprint name").
   */
  static Compare(lhs: FOOTPRINT_INFO, rhs: FOOTPRINT_INFO): number {
    const retv = strNumCmp(lhs.m_nickname, rhs.m_nickname, false);

    if (retv !== 0) return retv;

    return strNumCmp(lhs.m_fpname, rhs.m_fpname, false);
  }

  protected ensure_loaded(): void {
    if (!this.m_loaded) this.load();
  }

  /** Lazily load stuff not filled in by constructor. */
  protected load(): void {}
}

/** An error a footprint library read reported (`IO_ERROR::Problem`). */
export interface FOOTPRINT_LIST_ERROR {
  Problem(): string;
}

/**
 * Holds a list of FOOTPRINT_INFO objects, along with a list of IO_ERRORs or
 * PARSE_ERRORs that were thrown acquiring the FOOTPRINT_INFOs.
 */
export abstract class FOOTPRINT_LIST {
  protected m_list: FOOTPRINT_INFO[] = [];
  /** some can be PARSE_ERRORs also */
  protected m_errors: FOOTPRINT_LIST_ERROR[] = [];

  GetCount(): number {
    return this.m_list.length;
  }

  /** Was forced to add this by modview_frame.cpp */
  GetList(): readonly FOOTPRINT_INFO[] {
    return this.m_list;
  }

  /** Erase the footprint list. */
  abstract Clear(): void;

  /**
   * Get info for a footprint by id (`GetFootprintInfo( aFootprintName )`), or by
   * library nickname and name. An empty name is never found: an unassigned
   * symbol answers as a missing footprint does.
   */
  GetFootprintInfo(aFootprintName: string): FOOTPRINT_INFO | null;
  GetFootprintInfo(aLibNickname: string, aFootprintName: string): FOOTPRINT_INFO | null;
  GetFootprintInfo(a: string, b?: string): FOOTPRINT_INFO | null {
    if (b === undefined) {
      if (a === '') return null;

      const fpid = new LIB_ID();

      if (fpid.Parse(a) >= 0) return null; // "'%s' is not a valid LIB_ID."

      return this.GetFootprintInfo(fpid.GetLibNickname(), fpid.GetLibItemName());
    }

    if (b === '') return null;

    for (const fp of this.m_list) {
      if (a === fp.GetLibNickname() && b === fp.GetFootprintName()) return fp;
    }

    return null;
  }

  /** Get info for a footprint by index. */
  GetItem(aIdx: number): FOOTPRINT_INFO {
    return this.m_list[aIdx]!;
  }

  GetErrorCount(): number {
    return this.m_errors.length;
  }

  PopError(): FOOTPRINT_LIST_ERROR | null {
    return this.m_errors.shift() ?? null;
  }

  PushError(aError: FOOTPRINT_LIST_ERROR): void {
    this.m_errors.push(aError);
  }

  /** Returns all accumulated errors as a newline-separated string. */
  GetErrorMessages(): string {
    let messages = '';

    for (let error = this.PopError(); error; error = this.PopError()) {
      if (messages !== '') messages += '\n';

      messages += error.Problem();
    }

    return messages;
  }
}
