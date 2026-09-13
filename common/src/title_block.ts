// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/title_block.h` / `common/title_block.cpp`: `TITLE_BLOCK`, the
 * title, date, revision, company and comments of a drawing.
 *
 * `PROJECT` is not ported; `TextVarResolver` takes the one thing it reads
 * from it, `PROJECT::TextVarResolver`, as a resolver function (or null).
 */

import { ExpandTextVars, type TextVarResolverFn } from './common.js';
import type { OutStr } from './font/font.js';
import type { OUTPUTFORMATTER } from './richio.js';

// Texts are stored in wxArraystring.
// TEXTS_IDX gives the index of known texts in this array
enum TEXTS_IDX {
  TITLE_IDX = 0,
  DATE_IDX = 1,
  REVISION_IDX = 2,
  COMPANY_IDX = 3,
  COMMENT1_IDX = 4, // idx of the first comment: one can have more than 1 comment
}

/** The `PROJECT` half of `TextVarResolver( aToken, aProject )`: its own resolver. */
export type PROJECT_TEXT_VARS = { TextVarResolver: TextVarResolverFn } | null;

/**
 * Hold the information related to the title block.
 */
export class TITLE_BLOCK {
  private m_tbTexts: string[] = [];

  SetTitle(aTitle: string): void {
    this.setTbText(TEXTS_IDX.TITLE_IDX, aTitle);
  }

  GetTitle(): string {
    return this.getTbText(TEXTS_IDX.TITLE_IDX);
  }

  /**
   * Set the date field, and defaults to the current time and date.
   */
  SetDate(aDate: string): void {
    this.setTbText(TEXTS_IDX.DATE_IDX, aDate);
  }

  GetDate(): string {
    return this.getTbText(TEXTS_IDX.DATE_IDX);
  }

  SetRevision(aRevision: string): void {
    this.setTbText(TEXTS_IDX.REVISION_IDX, aRevision);
  }

  GetRevision(): string {
    return this.getTbText(TEXTS_IDX.REVISION_IDX);
  }

  SetCompany(aCompany: string): void {
    this.setTbText(TEXTS_IDX.COMPANY_IDX, aCompany);
  }

  GetCompany(): string {
    return this.getTbText(TEXTS_IDX.COMPANY_IDX);
  }

  SetComment(aIdx: number, aComment: string): void {
    aIdx += TEXTS_IDX.COMMENT1_IDX;
    this.setTbText(aIdx, aComment);
  }

  GetComment(aIdx: number): string {
    aIdx += TEXTS_IDX.COMMENT1_IDX;
    return this.getTbText(aIdx);
  }

  Clear(): void {
    this.m_tbTexts = [];
  }

  /** The copy the C++ value semantics give. */
  clone(): TITLE_BLOCK {
    const c = new TITLE_BLOCK();
    c.m_tbTexts = [...this.m_tbTexts];
    return c;
  }

  static GetContextualTextVars(aVars: string[]): void {
    if (!aVars.includes('ISSUE_DATE')) {
      aVars.push('ISSUE_DATE');
      aVars.push('CURRENT_DATE');
      aVars.push('CURRENT_TIME_LOCALE');
      aVars.push('CURRENT_TIME_HH_MM_SS');
      aVars.push('REVISION');
      aVars.push('TITLE');
      aVars.push('COMPANY');
      aVars.push('COMMENT1');
      aVars.push('COMMENT2');
      aVars.push('COMMENT3');
      aVars.push('COMMENT4');
      aVars.push('COMMENT5');
      aVars.push('COMMENT6');
      aVars.push('COMMENT7');
      aVars.push('COMMENT8');
      aVars.push('COMMENT9');
    }
  }

  TextVarResolver(aToken: OutStr, aProject: PROJECT_TEXT_VARS, aFlags = 0): boolean {
    let tokenUpdated = false;
    const originalToken = aToken.value;

    if (aToken.value === 'ISSUE_DATE') {
      aToken.value = this.GetDate();
      tokenUpdated = true;
    } else if (aToken.value === 'CURRENT_DATE') {
      aToken.value = TITLE_BLOCK.GetCurrentDate();
      tokenUpdated = true;
    } else if (aToken.value === 'CURRENT_TIME_HH_MM_SS') {
      aToken.value = TITLE_BLOCK.GetCurrentTimeHHMMSS();
      tokenUpdated = true;
    } else if (aToken.value === 'CURRENT_TIME_LOCALE') {
      aToken.value = TITLE_BLOCK.GetCurrentTimeLocale();
      tokenUpdated = true;
    } else if (aToken.value === 'REVISION') {
      aToken.value = this.GetRevision();
      tokenUpdated = true;
    } else if (aToken.value === 'TITLE') {
      aToken.value = this.GetTitle();
      tokenUpdated = true;
    } else if (aToken.value === 'COMPANY') {
      aToken.value = this.GetCompany();
      tokenUpdated = true;
    } else if (aToken.value.slice(0, aToken.value.length - 1) === 'COMMENT') {
      const c = aToken.value.charAt(aToken.value.length - 1);

      switch (c) {
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          aToken.value = this.GetComment(c.charCodeAt(0) - '1'.charCodeAt(0));
          tokenUpdated = true;
      }
    }

    if (tokenUpdated) {
      if (aToken.value === 'CURRENT_DATE') aToken.value = TITLE_BLOCK.GetCurrentDate();
      else if (aProject)
        aToken.value = ExpandTextVars(aToken.value, aProject.TextVarResolver, aFlags);

      // This is the default fallback, so don't claim we resolved it
      if (aToken.value === `\${${originalToken}}`) return false;

      return true;
    }

    return false;
  }

  Format(aFormatter: OUTPUTFORMATTER): void {
    // Don't write the title block information if there is nothing to write.
    let isempty = true;

    for (let idx = 0; idx < this.m_tbTexts.length; idx++) {
      if (this.m_tbTexts[idx] !== '') {
        isempty = false;
        break;
      }
    }

    if (!isempty) {
      aFormatter.Print('(title_block');

      if (this.GetTitle() !== '') aFormatter.Print(`(title ${aFormatter.Quotew(this.GetTitle())})`);

      if (this.GetDate() !== '') aFormatter.Print(`(date ${aFormatter.Quotew(this.GetDate())})`);

      if (this.GetRevision() !== '')
        aFormatter.Print(`(rev ${aFormatter.Quotew(this.GetRevision())})`);

      if (this.GetCompany() !== '')
        aFormatter.Print(`(company ${aFormatter.Quotew(this.GetCompany())})`);

      for (let ii = 0; ii < 9; ii++) {
        if (this.GetComment(ii) !== '') {
          aFormatter.Print(`(comment ${ii + 1} ${aFormatter.Quotew(this.GetComment(ii))})`);
        }
      }

      aFormatter.Print(')');
    }
  }

  static GetCurrentDate(): string {
    // We can choose different formats. Should probably be kept in sync with ISSUE_DATE
    // formatting in DIALOG_PAGES_SETTINGS.
    //
    //  return wxDateTime::Now().Format( wxLocale::GetInfo( wxLOCALE_SHORT_DATE_FMT ) );
    //  return wxDateTime::Now().Format( wxLocale::GetInfo( wxLOCALE_LONG_DATE_FMT ) );
    //  return wxDateTime::Now().Format( wxT("%Y-%b-%d") );
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');

    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; // FormatISODate
  }

  static GetCurrentTimeHHMMSS(): string {
    // Returns time in HHhMMmSSs format (e.g., "19h23m42s").
    // Uses letters as separators to be safe for filenames (':' can't be used as a separator).
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');

    return `${pad(now.getHours())}h${pad(now.getMinutes())}m${pad(now.getSeconds())}s`;
  }

  static GetCurrentTimeLocale(): string {
    // Returns time formatted according to the current locale (e.g., "7:23:42 PM" or "19:23:42").
    return new Date().toLocaleTimeString();
  }

  private setTbText(aIdx: number, aText: string): void {
    if (this.m_tbTexts.length <= aIdx) {
      const add = aIdx + 1 - this.m_tbTexts.length;

      for (let i = 0; i < add; ++i) this.m_tbTexts.push('');
    }

    this.m_tbTexts[aIdx] = aText;
  }

  private getTbText(aIdx: number): string {
    if (this.m_tbTexts.length > aIdx) return this.m_tbTexts[aIdx]!;
    else return '';
  }
}
