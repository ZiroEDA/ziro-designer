// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/drawing_sheet/ds_data_model.h` + `common/drawing_sheet/ds_data_model.cpp`:
 * `DS_DATA_MODEL`, the drawing sheet in memory — its `DS_DATA_ITEM`s, the
 * page setup (margins and default sizes), and the draw environment
 * `SetupDrawEnvironment` computes for one page.
 *
 * The members KiCad defines in the parser and writer files keep those files:
 * `SetPageLayout`, `LoadDrawingSheet`, `SetDefaultLayout`, `SetEmptyLayout`,
 * `DefaultLayout` and `EmptyLayout` (`drawing_sheet_parser.cpp`) go through
 * `read.ts`' `DRAWING_SHEET_PARSER_Parse`; `SaveInString` and `Save`
 * (`ds_data_model_io.cpp`) through `write.ts`' `DS_DATA_MODEL_IO_Format`.
 *
 * `LoadDrawingSheet` takes the file's text alongside its name, since a page
 * has no file to open: `null` is a file that does not exist.
 */

import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import type { OutStr } from '../font/font.js';
import type { PAGE_INFO } from '../page_info.js';
import { defaultDrawingSheet, emptyDrawingSheet } from './default-sheet.js';
import { type DS_DATA_ITEM, TB_DEFAULT_TEXTSIZE } from './ds_data_item.js';
import { DRAWING_SHEET_PARSER_Parse, parseDrawingSheet } from './read.js';
import type { WksSheet } from './types.js';
import { DS_DATA_MODEL_IO_Format, serializeDrawingSheet } from './write.js';

/**
 * Handle the graphic items list to draw/plot the frame and title block.
 */
export class DS_DATA_MODEL {
  m_WSunits2Iu: number; // conversion factor between ws units (mils) and draw/plot units
  m_RB_Corner: VECTOR2D = { x: 0, y: 0 }; // coordinates of the right bottom corner (in mm)
  m_LT_Corner: VECTOR2D = { x: 0, y: 0 }; // coordinates of the left top corner (in mm)
  m_DefaultLineWidth: number; // Used when object line width is 0
  m_DefaultTextSize: VECTOR2D; // Used when object text size is 0
  m_DefaultTextThickness: number; // Used when object text stroke width is 0
  // Used in drawing sheet editor to toggle variable substitution
  // In normal mode (m_EditMode = false) the %format is
  // replaced by the corresponding text.
  // In edit mode (m_EditMode = true) the %format is
  // displayed "as this"
  m_EditMode: boolean;

  private m_list: DS_DATA_ITEM[] = [];
  // If false, the default drawing sheet will be loaded the
  // first time DS_DRAW_ITEM_LIST::BuildDrawItemsList is run
  // (useful mainly for drawing sheet editor)
  private m_allowVoidList: boolean;
  private m_fileFormatVersionAtLoad: number;
  private m_leftMargin: number; // the left page margin in mm
  private m_rightMargin: number; // the right page margin in mm
  private m_topMargin: number; // the top page margin in mm
  private m_bottomMargin: number; // the bottom page margin in mm

  // The layout shape used in the application
  // It is accessible by DS_DATA_MODEL::GetTheInstance()
  private static wksTheInstance: DS_DATA_MODEL | null = null;
  private static wksAltInstance: DS_DATA_MODEL | null = null;

  constructor() {
    this.m_WSunits2Iu = 1000.0;
    this.m_DefaultLineWidth = 0.0;
    this.m_DefaultTextSize = { x: TB_DEFAULT_TEXTSIZE, y: TB_DEFAULT_TEXTSIZE };
    this.m_DefaultTextThickness = 0.0;
    this.m_EditMode = false;
    this.m_allowVoidList = false;
    this.m_fileFormatVersionAtLoad = 0;
    this.m_leftMargin = 10.0; // the left page margin in mm
    this.m_rightMargin = 10.0; // the right page margin in mm
    this.m_topMargin = 10.0; // the top page margin in mm
    this.m_bottomMargin = 10.0; // the bottom page margin in mm
  }

  /**
   * Return the instance of DS_DATA_MODEL used in the application.
   */
  static GetTheInstance(): DS_DATA_MODEL {
    if (DS_DATA_MODEL.wksAltInstance) return DS_DATA_MODEL.wksAltInstance;

    DS_DATA_MODEL.wksTheInstance ??= new DS_DATA_MODEL();
    return DS_DATA_MODEL.wksTheInstance;
  }

  /**
   * Set an alternate instance of DS_DATA_MODEL.
   *
   * @param aLayout the alternate drawing sheet; if null restore the basic drawing sheet
   */
  static SetAltInstance(aLayout: DS_DATA_MODEL | null = null): void {
    DS_DATA_MODEL.wksAltInstance = aLayout;
  }

  GetFileFormatVersionAtLoad(): number {
    return this.m_fileFormatVersionAtLoad;
  }
  SetFileFormatVersionAtLoad(aVersion: number): void {
    this.m_fileFormatVersionAtLoad = aVersion;
  }

  GetLeftMargin(): number {
    return this.m_leftMargin;
  }
  SetLeftMargin(aMargin: number): void {
    this.m_leftMargin = aMargin;
  }

  GetRightMargin(): number {
    return this.m_rightMargin;
  }
  SetRightMargin(aMargin: number): void {
    this.m_rightMargin = aMargin;
  }

  GetTopMargin(): number {
    return this.m_topMargin;
  }
  SetTopMargin(aMargin: number): void {
    this.m_topMargin = aMargin;
  }

  GetBottomMargin(): number {
    return this.m_bottomMargin;
  }
  SetBottomMargin(aMargin: number): void {
    this.m_bottomMargin = aMargin;
  }

  SetupDrawEnvironment(aPageInfo: PAGE_INFO, aMilsToIU: number): void {
    const MILS_TO_MM = 25.4 / 1000;

    this.m_WSunits2Iu = aMilsToIU / MILS_TO_MM;

    // Left top corner position
    this.m_LT_Corner = { x: this.GetLeftMargin(), y: this.GetTopMargin() };

    // Right bottom corner position
    const size = aPageInfo.GetSizeMils();
    this.m_RB_Corner = {
      x: size.x * MILS_TO_MM - this.GetRightMargin(),
      y: size.y * MILS_TO_MM - this.GetBottomMargin(),
    };
  }

  /**
   * In KiCad applications, a drawing sheet is needed
   * So if the list is empty, a default drawing sheet is loaded, the first time it is drawn.
   * However, in drawing sheet editor an empty list is acceptable.
   * AllowVoidList allows or not the empty list
   */
  AllowVoidList(Allow: boolean): void {
    this.m_allowVoidList = Allow;
  }

  /**
   * @return true if an empty list is allowed
   */
  VoidListAllowed(): boolean {
    return this.m_allowVoidList;
  }

  /**
   * Erase the list of items.
   */
  ClearList(): void {
    this.m_list = [];
  }

  /**
   * Save the description in a file.
   *
   * The browser writes what `SaveInString` returns; the name is the caller's.
   */
  Save(_aFullFileName: string): string {
    return this.SaveInString();
  }

  /**
   * Save the description in a buffer.
   *
   * @param aItemsList the items to save; the whole model when omitted.
   * @return the S-expression text.
   */
  SaveInString(aItemsList?: readonly DS_DATA_ITEM[]): string {
    return serializeDrawingSheet(DS_DATA_MODEL_IO_Format(this, aItemsList));
  }

  Append(aItem: DS_DATA_ITEM): void {
    this.m_list.push(aItem);
  }

  Remove(aItem: DS_DATA_ITEM): void {
    this.m_list = this.m_list.filter((i) => i !== aItem);
  }

  /**
   * @return the item from its index \a aIdx, or NULL if does not exist.
   */
  GetItem(aIdx: number): DS_DATA_ITEM | null {
    if (aIdx < this.m_list.length) return this.m_list[aIdx]!;
    else return null;
  }

  /**
   * @return a reference to the items.
   */
  GetItems(): DS_DATA_ITEM[] {
    return this.m_list;
  }

  /**
   * @return the item count.
   */
  GetCount(): number {
    return this.m_list.length;
  }

  SetDefaultLayout(): void {
    this.setPageLayoutFrom(defaultDrawingSheet(), false);
  }

  SetEmptyLayout(): void {
    this.setPageLayoutFrom(emptyDrawingSheet(), false);
  }

  /**
   * Return a string containing the empty layout shape.
   */
  static EmptyLayout(): string {
    return serializeDrawingSheet(emptyDrawingSheet());
  }

  /**
   * Return a string containing the empty layout shape.
   */
  static DefaultLayout(): string {
    return serializeDrawingSheet(defaultDrawingSheet());
  }

  /**
   * Populate the list with a custom layout or the default layout if no custom layout
   * is available.
   *
   * @param aFullFileName is the custom drawing sheet file. If empty, load the file defined by
   *                      KICAD_WKSFILE and if its is not defined, the default internal drawing
   *                      sheet.
   * @param aMsg is an out-parameter for the error message, if any.
   * @param aAppend if true: do not delete old layout, and load only \a aFullFileName.
   * @param aContents the file's text, which a browser hands us instead of a path to
   *                  open; null is a file that does not exist.
   */
  LoadDrawingSheet(
    aFullFileName: string,
    aMsg: OutStr | null,
    aAppend = false,
    aContents: string | null = null,
  ): boolean {
    if (!aAppend) {
      if (aFullFileName === '') {
        this.SetDefaultLayout();
        return true; // we assume its fine / default init
      }

      if (aContents === null) {
        if (aMsg) aMsg.value = 'File not found.';

        this.SetDefaultLayout();
        return false;
      }
    }

    if (aContents === null) {
      if (aMsg) aMsg.value = 'File could not be opened.';

      if (!aAppend) this.SetDefaultLayout();

      return false;
    }

    let sheet: WksSheet;

    try {
      sheet = parseDrawingSheet(aContents);
    } catch (ioe) {
      if (!aAppend) this.ClearList();

      if (aMsg) aMsg.value = ioe instanceof Error ? ioe.message : String(ioe);

      return false;
    }

    if (!aAppend) this.ClearList();

    DRAWING_SHEET_PARSER_Parse(sheet, this);

    return true;
  }

  /**
   * Populate the list from a S expr description stored in a string.
   *
   * @param aPageLayout is the S expr string.
   * @param aAppend Do not delete old layout if true and append \a aPageLayout the existing
   *                one.
   * @param aSource is the layout source description.
   */
  SetPageLayout(aPageLayout: string, aAppend = false, _aSource = 'Sexpr_string'): void {
    if (!aAppend) this.ClearList();

    try {
      DRAWING_SHEET_PARSER_Parse(parseDrawingSheet(aPageLayout), this);
    } catch {
      // best efforts
    }
  }

  /** `SetPageLayout` for a layout the app already holds parsed. */
  private setPageLayoutFrom(aSheet: WksSheet, aAppend: boolean): void {
    if (!aAppend) this.ClearList();

    DRAWING_SHEET_PARSER_Parse(aSheet, this);
  }
}
