// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/base_screen.h` + `common/base_screen.cpp`: `BASE_SCREEN`, the
 * per-document view state a frame keeps (scroll centre, page numbers, the
 * modified flag).
 */

import type { Vec2 as VECTOR2D, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { EDA_ITEM } from './eda_item.js';

/**
 * Handles how to draw a screen (a board, a schematic ...).
 */
export class BASE_SCREEN extends EDA_ITEM {
  /** the name of the drawing sheet file, or empty to use the default drawing sheet */
  static m_DrawingSheetFileName = '';

  m_DrawOrg: VECTOR2I; ///< offsets for drawing the circuit on the screen

  m_LocalOrigin: VECTOR2D; ///< Relative Screen cursor coordinate (on grid)
  ///< in user units. (coordinates from last reset position)

  m_StartVisu: VECTOR2I; ///< Coordinates in drawing units of the current
  ///< view position (upper left corner of device)

  m_Center: boolean; ///< Center on screen.  If true (0.0) is centered on screen
  ///< coordinates can be < 0 and > 0 except for schematics.
  ///< false: when coordinates can only be >= 0 (schematics).

  m_ScrollCenter: VECTOR2D; ///< Current scroll center point in logical units.

  protected m_pageCount: number;
  protected m_virtualPageNumber: number;
  protected m_pageNumber: string;

  private m_flagModified: boolean; ///< Indicates current drawing has been modified.

  constructor(aParent?: EDA_ITEM | null, aType?: KICAD_T);
  constructor(aPageSizeIU: VECTOR2I, aType?: KICAD_T);
  constructor(a: EDA_ITEM | VECTOR2I | null = null, aType: KICAD_T = KICAD_T.SCREEN_T) {
    super(a instanceof EDA_ITEM ? a : null, aType);

    this.m_DrawOrg = { x: 0, y: 0 };
    this.m_LocalOrigin = { x: 0, y: 0 };
    this.m_StartVisu = { x: 0, y: 0 };
    this.m_ScrollCenter = { x: 0, y: 0 };
    this.m_pageNumber = '';

    this.m_virtualPageNumber = 1;
    this.m_pageCount = 1; // Hierarchy: Root: ScreenNumber = 1
    this.m_Center = true;
    this.m_flagModified = false; // Set when any change is made on board.

    if (a && !(a instanceof EDA_ITEM)) this.InitDataPoints(a);
  }

  InitDataPoints(aPageSizeIU: VECTOR2I): void {
    if (this.m_Center) {
      this.m_DrawOrg = { x: Math.trunc(-aPageSizeIU.x / 2), y: Math.trunc(-aPageSizeIU.y / 2) };
    } else {
      this.m_DrawOrg = { x: 0, y: 0 };
    }

    this.m_LocalOrigin = { x: 0, y: 0 };
  }

  SetContentModified(aModified = true): void {
    this.m_flagModified = aModified;
  }
  IsContentModified(): boolean {
    return this.m_flagModified;
  }

  override GetClass(): string {
    return 'BASE_SCREEN';
  }

  GetPageCount(): number {
    return this.m_pageCount;
  }
  SetPageCount(aPageCount: number): void {
    if (aPageCount > 0) this.m_pageCount = aPageCount;
  }

  GetVirtualPageNumber(): number {
    return this.m_virtualPageNumber;
  }
  SetVirtualPageNumber(aPageNumber: number): void {
    this.m_virtualPageNumber = aPageNumber;
  }

  GetPageNumber(): string {
    if (this.m_pageNumber.length === 0) return `${this.m_virtualPageNumber}`;

    return this.m_pageNumber;
  }
  SetPageNumber(aPageNumber: string): void {
    this.m_pageNumber = aPageNumber;
  }
}
