// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `lib_id.h` / `common/lib_id.cpp`: a logical library item identifier, the
 * pair of a library nickname and an item name, formatted `nickname:name`.
 */

import { PARSE_ERROR } from './dsnlexer.js';

/** `checkLibNickname`: -1 when the field holds no ':', else its offset. */
function checkLibNickname(aField: string): number {
  // std::string::npos is largest positive number, casting to int makes it -1.
  // Returning that means success.
  return aField.indexOf(':');
}

export class LIB_ID {
  private m_libraryName = ''; ///< The nickname of the library or empty.
  private m_itemName = ''; ///< The name of the entry in the logical library.
  private m_subLibraryName = ''; ///< Optional sub-library name used for grouping within a library

  constructor();
  constructor(aLibraryName: string, aItemName: string);
  constructor(aLibraryName?: string, aItemName?: string) {
    if (aLibraryName !== undefined) {
      this.m_libraryName = aLibraryName;
      this.m_itemName = aItemName ?? '';
    }
  }

  /**
   * Parse LIB_ID with the information from @a aId.
   *
   * A typical LIB_ID string consists of a library nickname followed by a library item name.
   * e.g.: "smt:R_0805", or
   * e.g.: "mylib:R_0805", or
   * e.g.: "ttl:7400"
   *
   * @param aId is the string to populate the #LIB_ID object.
   * @param aFix indicates invalid chars should be replaced with '_'.
   *
   * @return minus 1 (i.e. -1) means success, >= 0 indicates the character offset into
   *         aId at which an error was detected.
   */
  /** The copy the C++ value semantics give. */
  clone(): LIB_ID {
    const c = new LIB_ID();
    c.m_libraryName = this.m_libraryName;
    c.m_itemName = this.m_itemName;
    c.m_subLibraryName = this.m_subLibraryName;
    return c;
  }

  Parse(aId: string, aFix = false): number {
    this.clear();

    let partNdx: number = aId.indexOf(':');
    let offset = -1;

    //=====<library nickname>=============================
    if (partNdx !== -1) {
      offset = this.SetLibNickname(aId.substring(0, partNdx));

      if (offset > -1) return offset;

      ++partNdx; // skip ':'
    } else {
      partNdx = 0;
    }

    //=====<item name>====================================
    let fpname = aId.substring(partNdx);

    // Be sure the item name is valid.
    // Some chars can be found in legacy files converted files from other EDA tools.
    if (aFix) fpname = LIB_ID.FixIllegalChars(fpname, false);
    else offset = LIB_ID.HasIllegalChars(fpname);

    if (offset > -1) return offset;

    this.SetLibItemName(fpname);

    return -1;
  }

  /**
   * Return the logical library name portion of a LIB_ID.
   */
  GetLibNickname(): string {
    return this.m_libraryName;
  }
  GetUniStringLibNickname(): string {
    return this.m_libraryName;
  }

  /**
   * Override the logical library name portion of the LIB_ID to @a aLibNickname.
   *
   * @return int - minus 1 (i.e. -1) means success, >= 0 indicates the character offset
   *               into the parameter at which an error was detected, usually because it
   *               contained '/' or ':'.
   */
  SetLibNickname(aLibNickname: string): number {
    const offset = checkLibNickname(aLibNickname);

    if (offset === -1) this.m_libraryName = aLibNickname;

    return offset;
  }

  /**
   * @return the library item name, i.e. footprintName, in UTF8.
   */
  GetLibItemName(): string {
    return this.m_itemName;
  }

  /**
   * Get strings for display messages in dialogs.
   *
   * Equivalent to m_itemName.wx_str(), but more explicit when building a Unicode string
   * in messages.
   *
   * @return the library item name, i.e. footprintName in a wxString (UTF16 or 32).
   */
  GetUniStringLibItemName(): string {
    return this.m_itemName;
  }

  /**
   * Override the library item name portion of the LIB_ID to @a aLibItemName
   *
   * @return int - minus 1 (i.e. -1) means success, >= 0 indicates the  character offset
   *               into the parameter at which an error was detected, usually because it
   *               contained '/'.
   */
  SetLibItemName(aLibItemName: string): number {
    this.m_itemName = aLibItemName;

    return -1;
  }

  /**
   * Some LIB_IDs can have a sub-library identifier in addition to a library nickname.
   * This identifier is *not* part of the canonical LIB_ID and is not written out / parsed.
   * It is only used for internal sorting/grouping, if present.
   *
   * @return the sub-library name for this LIB_ID, if one exists
   */
  GetSubLibraryName(): string {
    return this.m_subLibraryName;
  }
  SetSubLibraryName(aName: string): void {
    this.m_subLibraryName = aName;
  }
  GetUniStringSubLibraryName(): string {
    return this.m_subLibraryName;
  }

  /**
   * @return a string in the proper format as an LIB_ID for a combination of
   *         aLibraryName, aLibItemName
   */
  GetFullLibraryName(): string {
    if (this.m_subLibraryName === '') return this.m_libraryName;

    return `${this.m_libraryName} - ${this.m_subLibraryName}`;
  }

  /**
   * @return the fully formatted text of the LIB_ID in a UTF8 string.
   */
  Format(): string {
    let ret = '';

    if (this.m_libraryName.length) {
      ret += this.m_libraryName;
      ret += ':';
    }

    ret += this.m_itemName;

    return ret;
  }

  /**
   * @return the fully formatted text of the LIB_ID in a wxString (UTF16 or UTF32),
   *         suitable to display the LIB_ID in dialogs.
   */
  GetUniStringLibId(): string {
    return this.Format();
  }

  /**
   * @return a string in the proper format as an LIB_ID for a combination of
   *         aLibraryName, aLibItemName
   *
   * @throw PARSE_ERROR if any of the pieces are illegal.
   */
  static FormatParts(aLibraryName: string, aLibItemName: string): string {
    let ret = '';
    let offset: number;

    if (aLibraryName.length) {
      offset = checkLibNickname(aLibraryName);

      if (offset !== -1) {
        throw new PARSE_ERROR(
          'Illegal character found in library nickname',
          aLibraryName,
          aLibraryName,
          0,
          offset,
        );
      }

      ret += aLibraryName;
      ret += ':';
    }

    ret += aLibItemName;

    return ret;
  }

  /**
   * Check if this LID_ID is valid.
   *
   * A valid #LIB_ID must have both the library nickname and the library item name not empty.
   *
   * @note A return value of true does not indicated that the #LIB_ID is a valid #LIB_TABLE
   *       entry.
   *
   * @return true is the #LIB_ID is valid.
   */
  IsValid(): boolean {
    return this.m_libraryName !== '' && this.m_itemName !== '';
  }

  /**
   * @return true if the #LIB_ID only has the #m_itemName name defined.
   */
  IsLegacy(): boolean {
    return this.m_libraryName === '' && this.m_itemName !== '';
  }

  /**
   * Clear the contents of the library nickname, library entry name
   */
  clear(): void {
    this.m_libraryName = '';
    this.m_itemName = '';
    this.m_subLibraryName = '';
  }

  /**
   * @return a boolean true value if the LIB_ID is empty.  Otherwise return false.
   */
  empty(): boolean {
    return this.m_libraryName === '' && this.m_itemName === '';
  }

  /**
   * Compare the contents of LIB_ID objects by performing a std::string comparison of the
   * library nickname, library entry name
   *
   * @param aLibId is the LIB_ID to compare against.
   * @return -1 if less than \a aLibId, 1 if greater than \a aLibId, and 0 if equal to \a aLibId.
   */
  compare(aLibId: LIB_ID): number {
    // Don't bother comparing the same object.
    if (this === aLibId) return 0;

    const retv = stringCompare(this.m_libraryName, aLibId.m_libraryName);

    if (retv !== 0) return retv;

    return stringCompare(this.m_itemName, aLibId.m_itemName);
  }

  lt(aLibId: LIB_ID): boolean {
    return this.compare(aLibId) < 0;
  }
  gt(aLibId: LIB_ID): boolean {
    return this.compare(aLibId) > 0;
  }
  equals(aLibId: LIB_ID): boolean {
    return this.compare(aLibId) === 0;
  }

  /**
   * Examine \a aLibItemName for invalid #LIB_ID item name characters.
   *
   * @param aLibItemName is the #LIB_ID name to test for illegal characters.
   * @return offset of first illegal character otherwise -1.
   */
  static HasIllegalChars(aLibItemName: string): number {
    let offset = 0;

    // `for( auto& ch : aLibItemName )` walks the UTF8 bytes; a non-ASCII
    // byte is never illegal, so the code points walk the same way here.
    for (const ch of aLibItemName) {
      if (!LIB_ID.isLegalChar(ch.codePointAt(0)!)) return offset;
      ++offset;
    }

    return -1;
  }

  /**
   * Replace illegal #LIB_ID item name characters with underscores '_'.
   *
   * @param aLibItemName is the #LIB_ID item name to replace illegal characters.
   * @param aLib True if we are checking library names, false if we are checking item names
   * @return the corrected #LIB_ID item name.
   */
  static FixIllegalChars(aLibItemName: string, aLib: boolean): string {
    let fixedName = '';

    for (const ch of aLibItemName) {
      const cp = ch.codePointAt(0)!;
      if (aLib) fixedName += LIB_ID.isLegalLibraryNameChar(cp) ? ch : '_';
      else fixedName += LIB_ID.isLegalChar(cp) ? ch : '_';
    }

    return fixedName;
  }

  /**
   * Looks for characters that are illegal in library nicknames.
   *
   * @param aLibraryName is the logical library name to be tested.
   * @return Invalid character if any or 0 if the library name is valid.
   */
  static FindIllegalLibraryNameChar(aLibraryName: string): number {
    for (const ch of aLibraryName) {
      const cp = ch.codePointAt(0)!;
      if (!LIB_ID.isLegalLibraryNameChar(cp)) return cp;
    }

    return 0;
  }

  /**
   * Tests whether a unicode character is a legal LIB_ID item name character.
   *
   * The criteria for legal LIB_ID item name character is as follows:
   * - For both symbol and footprint names, neither '/' or '\' are legal.  They are
   *   reserved characters used by #LIB_ID::Parse.
   * - Spaces are allowed in footprint names as they are a common naming convention
   *   and the underlying file name is escaped.
   */
  protected static isLegalChar(aUniChar: number): boolean {
    const space_allowed = true;
    const illegal_filename_chars_allowed = false;

    switch (aUniChar) {
      case 0x3a: // ':'
      case 0x09: // '\t'
      case 0x0a: // '\n'
      case 0x0d: // '\r'
        return false;

      case 0x5c: // '\\'
      case 0x3c: // '<'
      case 0x3e: // '>'
      case 0x22: // '"'
        return illegal_filename_chars_allowed;

      case 0x20: // ' '
        return space_allowed;

      default:
        return true;
    }
  }

  /**
   * Tests whether a unicode character is a legal LIB_ID library nickname character
   *
   * The criteria for legal LIB_ID library nickname character is as follows:
   * - For both symbol and footprint library nicknames, neither '/' or '\' are legal.  They
   *   are reserved characters used by #LIB_ID::Parse.
   */
  protected static isLegalLibraryNameChar(aUniChar: number): boolean {
    const space_allowed = true;

    if (aUniChar < 0x20) return false;

    switch (aUniChar) {
      case 0x5c: // '\\'
      case 0x3a: // ':'
        return false;

      case 0x20: // ' '
        return space_allowed;

      default:
        return true;
    }
  }
}

/** `std::string::compare` over UTF8: a byte-wise ordering, which code-point order preserves. */
function stringCompare(a: string, b: string): number {
  if (a === b) return 0;
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done && y.done) return 0;
    if (x.done) return -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}
