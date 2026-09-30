// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DESIGN_BLOCK` (common/design_block.{h,cpp}, KiCad 9+): a reusable piece of a
 * design — a schematic and/or a board file with a description, keywords and
 * fields — kept in a design block library as one `<name>.kicad_block` folder.
 * It is a `LIB_TREE_ITEM`, so the design block chooser lists it like a symbol.
 *
 * `m_fields` is an ordered map upstream (`nlohmann::ordered_map`): insertion
 * order is the order the metadata file writes them in; a `Map` keeps it.
 */
import { searchTerm, type SearchTerm } from './eda_pattern_match.js';
import { LIB_ID } from './lib_id.js';

export class DESIGN_BLOCK {
  private m_lib_id = new LIB_ID();
  private m_schematicFile = ''; ///< File name and path for schematic file.
  private m_boardFile = ''; ///< File name and path for board file
  private m_libDescription = ''; ///< File name and path for documentation file.
  private m_keywords = ''; ///< Search keywords to find design block in library.
  private readonly m_fields = new Map<string, string>();
  private m_searchTerms: SearchTerm[] = [];

  // LIB_TREE_ITEM interface
  GetLIB_ID(): LIB_ID {
    return this.GetLibId();
  }

  GetName(): string {
    return this.m_lib_id.GetLibItemName();
  }

  GetLibNickname(): string {
    return this.m_lib_id.GetLibNickname();
  }

  GetDesc(): string {
    return this.GetLibDescription();
  }

  /**
   * `GetSearchTerms()` (design_block.cpp:26-44): nickname 4, name 8, LIB_ID 16,
   * each space-separated keyword 4, the whole keyword string 1, the description 1.
   */
  GetSearchTerms(): SearchTerm[] {
    this.m_searchTerms = [];

    this.m_searchTerms.push(searchTerm(this.GetLibNickname(), 4));
    this.m_searchTerms.push(searchTerm(this.GetName(), 8, true));
    this.m_searchTerms.push(searchTerm(this.GetLIB_ID().Format(), 16, true));

    // wxStringTokenizer( GetKeywords(), " ", wxTOKEN_STRTOK )
    for (const token of this.GetKeywords()
      .split(' ')
      .filter((t) => t !== ''))
      this.m_searchTerms.push(searchTerm(token, 4));

    // Also include keywords as one long string, just in case
    this.m_searchTerms.push(searchTerm(this.GetKeywords(), 1));
    this.m_searchTerms.push(searchTerm(this.GetDesc(), 1));

    return this.m_searchTerms;
  }

  SetLibId(aName: LIB_ID): void {
    this.m_lib_id = aName;
  }

  GetLibId(): LIB_ID {
    return this.m_lib_id;
  }

  GetLibDescription(): string {
    return this.m_libDescription;
  }

  SetLibDescription(aDesc: string): void {
    this.m_libDescription = aDesc;
  }

  GetKeywords(): string {
    return this.m_keywords;
  }

  SetKeywords(aKeywords: string): void {
    this.m_keywords = aKeywords;
  }

  GetSchematicFile(): string {
    return this.m_schematicFile;
  }

  SetSchematicFile(aFile: string): void {
    this.m_schematicFile = aFile;
  }

  GetBoardFile(): string {
    return this.m_boardFile;
  }

  SetBoardFile(aFile: string): void {
    this.m_boardFile = aFile;
  }

  GetFields(): Map<string, string> {
    return this.m_fields;
  }
}
