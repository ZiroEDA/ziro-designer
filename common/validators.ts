// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/validators.cpp`: KiCad's text validators. Each is a
 * `wxTextValidator` with a character filter; ours carries the same filter and
 * applies it to what a field would hold, since a DOM input has no validator of
 * its own.
 *
 * Only the ones a ported dialog uses are here so far.
 */

/** `wxTextValidator( wxFILTER_EXCLUDE_CHAR_LIST )`, as far as KiCad uses it. */
export class wxTextValidator {
  private m_charExcludes = '';

  SetCharExcludes(aChars: string): void {
    this.m_charExcludes = aChars;
  }

  GetCharExcludes(): string {
    return this.m_charExcludes;
  }

  /** The text with every excluded character dropped, as typing it would. */
  Filter(aText: string): string {
    return [...aText].filter((c) => !this.m_charExcludes.includes(c)).join('');
  }
}

/**
 * `FOOTPRINT_NAME_VALIDATOR` (validators.cpp:45-53): the characters that
 * would stop a file being created on any platform. Used for footprint names
 * and, by PANEL_COLOR_SETTINGS, for a new theme's name, which is also its file
 * name.
 */
export class FOOTPRINT_NAME_VALIDATOR extends wxTextValidator {
  constructor() {
    super();
    // This list of characters follows the string from footprint.cpp which, in
    // turn mimics the strings from lib_id.cpp
    this.SetCharExcludes('%$<>\t\n\r"\\/:');
  }
}
