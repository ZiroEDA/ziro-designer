// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/drawing_sheet/ds_data_item.h` + `common/drawing_sheet/ds_data_item.cpp`:
 * the items of a `DS_DATA_MODEL` — `DS_DATA_ITEM` (a segment or a rectangle),
 * `DS_DATA_ITEM_POLYGONS`, `DS_DATA_ITEM_TEXT` and `DS_DATA_ITEM_BITMAP` —
 * each corner-anchored in millimetres and turned into `DS_DRAW_ITEM_*`s, one
 * per repeat, by `SyncDrawItems`.
 */

import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 as VECTOR2D, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint, RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import type { BITMAP_BASE } from '../bitmap_base.js';
import type { Color4d } from '../gal/color4d.js';
import { EdaIuScale, unityScale } from '../eda_units.js';
import type { FONT } from '../font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../font/text_attributes.js';
import { GetPenSizeForBold } from '../gr_text.js';
import { STRING_INCREMENTER } from '../increment.js';
import type { VIEW } from '../view/view.js';
import {
  type DS_DRAW_ITEM_BASE,
  DS_DRAW_ITEM_BITMAP,
  DS_DRAW_ITEM_LINE,
  type DS_DRAW_ITEM_LIST,
  DS_DRAW_ITEM_POLYPOLYGONS,
  DS_DRAW_ITEM_RECT,
  DS_DRAW_ITEM_TEXT,
} from './ds_draw_item.js';
import { DS_DATA_MODEL } from './ds_data_model.js';

/** `#define TB_DEFAULT_TEXTSIZE 1.5`: default drawing sheet text size in mm. [data] */
export const TB_DEFAULT_TEXTSIZE = 1.5;

/** `COLOR4D::UNSPECIFIED`. */
const COLOR4D_UNSPECIFIED: Color4d = { r: 0, g: 0, b: 0, a: 0 };

/**
 * A coordinate is relative to a page corner.
 *
 * Any of the 4 corners can be a reference.  The default is the right bottom corner.
 */
export enum CORNER_ANCHOR {
  RB_CORNER, // right bottom corner
  RT_CORNER, // right top corner
  LB_CORNER, // left bottom corner
  LT_CORNER, // left top corner
}

export const { RB_CORNER, RT_CORNER, LB_CORNER, LT_CORNER } = CORNER_ANCHOR;

export enum PAGE_OPTION {
  ALL_PAGES,
  FIRST_PAGE_ONLY,
  SUBSEQUENT_PAGES,
}

export const { ALL_PAGES, FIRST_PAGE_ONLY, SUBSEQUENT_PAGES } = PAGE_OPTION;

/**
 * A coordinate point.
 *
 * The position is always relative to the corner anchor.
 *
 * @note The coordinate is from the anchor point to the opposite corner.
 */
export class POINT_COORD {
  m_Pos: VECTOR2D;
  m_Anchor: number;

  constructor(aPos: VECTOR2D = { x: 0, y: 0 }, aAnchor: CORNER_ANCHOR = RB_CORNER) {
    this.m_Pos = { x: aPos.x, y: aPos.y };
    this.m_Anchor = aAnchor;
  }
}

/** `DS_DATA_ITEM::DS_ITEM_TYPE`. */
export enum DS_ITEM_TYPE {
  DS_TEXT,
  DS_SEGMENT,
  DS_RECT,
  DS_POLYPOLYGON,
  DS_BITMAP,
}

/**
 * Drawing sheet structure type definitions.
 *
 * Basic items are:
 * * segment and rect (defined by 2 points)
 * * text (defined by a coordinate), the text and its justifications
 * * poly polygon defined by a coordinate, and a set of list of corners
 *   ( because we use it for logos, there are more than one polygon
 *   in this description
 */
export class DS_DATA_ITEM {
  static readonly DS_TEXT = DS_ITEM_TYPE.DS_TEXT;
  static readonly DS_SEGMENT = DS_ITEM_TYPE.DS_SEGMENT;
  static readonly DS_RECT = DS_ITEM_TYPE.DS_RECT;
  static readonly DS_POLYPOLYGON = DS_ITEM_TYPE.DS_POLYPOLYGON;
  static readonly DS_BITMAP = DS_ITEM_TYPE.DS_BITMAP;

  m_Name = ''; // a name used in drawing sheet editor to identify items
  m_Info = ''; // a comment, only useful in drawing sheet editor
  m_Pos = new POINT_COORD();
  m_End = new POINT_COORD();
  m_LineWidth: number;
  m_RepeatCount: number; // repeat count for duplicate items
  m_IncrementVector: VECTOR2D = { x: 0, y: 0 }; // for duplicate items: move vector for position increment
  m_IncrementLabel: number;

  protected m_type: DS_ITEM_TYPE;
  protected m_pageOption: PAGE_OPTION;
  protected m_drawItems: DS_DRAW_ITEM_BASE[] = [];

  constructor(aType: DS_ITEM_TYPE) {
    this.m_pageOption = ALL_PAGES;
    this.m_type = aType;
    this.m_RepeatCount = 1;
    this.m_IncrementLabel = 1;
    this.m_LineWidth = 0;
  }

  GetDrawItems(): readonly DS_DRAW_ITEM_BASE[] {
    return this.m_drawItems;
  }

  /**
   * Remove this item's draw items from the collector and the view and forget
   * them, keeping each one's flags by its index (the first half of every
   * `SyncDrawItems`).
   */
  protected clearDrawItems(
    aCollector: DS_DRAW_ITEM_LIST | null,
    aView: VIEW | null,
  ): Map<number, number> {
    const itemFlags = new Map<number, number>();

    for (let i = 0; i < this.m_drawItems.length; ++i) {
      const item = this.m_drawItems[i]!;
      itemFlags.set(i, item.GetFlags());

      if (aCollector) aCollector.Remove(item);

      if (aView) aView.Remove(item);
    }

    return itemFlags;
  }

  SyncDrawItems(aCollector: DS_DRAW_ITEM_LIST | null, aView: VIEW | null): void {
    let pensize = this.GetPenSizeIU();

    if (pensize === 0) pensize = aCollector ? aCollector.GetDefaultPenSize() : 0;

    const itemFlags = this.clearDrawItems(aCollector, aView);

    this.m_drawItems = [];

    for (let j = 0; j < this.m_RepeatCount; j++) {
      if (j > 0 && !this.IsInsidePage(j)) continue;

      let item: DS_DRAW_ITEM_BASE;

      if (this.m_type === DS_ITEM_TYPE.DS_SEGMENT)
        item = new DS_DRAW_ITEM_LINE(this, j, this.GetStartPosIU(j), this.GetEndPosIU(j), pensize);
      else if (this.m_type === DS_ITEM_TYPE.DS_RECT)
        item = new DS_DRAW_ITEM_RECT(this, j, this.GetStartPosIU(j), this.GetEndPosIU(j), pensize);
      else {
        // wxFAIL_MSG( "Unknown drawing sheet item type" )
        continue;
      }

      item.SetFlags(itemFlags.get(j) ?? 0);
      this.m_drawItems.push(item);

      if (aCollector) aCollector.Append(item);

      if (aView) aView.Add(item);
    }
  }

  SetStart(aPosx: number, aPosy: number, aAnchor: CORNER_ANCHOR = RB_CORNER): void {
    this.m_Pos.m_Pos = { x: aPosx, y: aPosy };
    this.m_Pos.m_Anchor = aAnchor;
  }

  SetEnd(aPosx: number, aPosy: number, aAnchor: CORNER_ANCHOR = RB_CORNER): void {
    this.m_End.m_Pos = { x: aPosx, y: aPosy };
    this.m_End.m_Anchor = aAnchor;
  }

  GetType(): DS_ITEM_TYPE {
    return this.m_type;
  }

  GetPage1Option(): PAGE_OPTION {
    return this.m_pageOption;
  }
  SetPage1Option(aChoice: PAGE_OPTION): void {
    this.m_pageOption = aChoice;
  }

  GetPenSizeIU(): number {
    const model = DS_DATA_MODEL.GetTheInstance();

    if (this.m_LineWidth !== 0) return KiROUND(this.m_LineWidth * model.m_WSunits2Iu);
    else return KiROUND(model.m_DefaultLineWidth * model.m_WSunits2Iu);
  }

  /**
   * Move item to a new position.
   *
   * @param aPosition the new position of the starting point in graphic units.
   */
  MoveToIU(aPosition: VECTOR2I): void {
    const pos_mm = {
      x: aPosition.x / DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu,
      y: aPosition.y / DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu,
    };

    this.MoveTo(pos_mm);
  }

  /**
   * Move item to a new position.
   *
   * @param aPosition the new position of item, in mm.
   */
  MoveTo(aPosition: VECTOR2D): void {
    const start = this.GetStartPos();
    const end = this.GetEndPos();
    const vector = { x: aPosition.x - start.x, y: aPosition.y - start.y };
    const endpos = { x: vector.x + end.x, y: vector.y + end.y };

    this.MoveStartPointTo(aPosition);
    this.MoveEndPointTo(endpos);

    for (const drawItem of this.m_drawItems) {
      drawItem.SetPosition(this.GetStartPosIU(drawItem.GetIndexInPeer()));
      drawItem.SetEnd(this.GetEndPosIU(drawItem.GetIndexInPeer()));
    }
  }

  /** The anchor-relative position of `aPosition` (mm, from the paper's top left). */
  private static toAnchor(aAnchor: number, aPosition: VECTOR2D): VECTOR2D {
    const model = DS_DATA_MODEL.GetTheInstance();

    // Calculate the position of the starting point
    // relative to the reference corner
    // aPosition is the position relative to the right top paper corner
    switch (aAnchor) {
      case RB_CORNER:
        return { x: model.m_RB_Corner.x - aPosition.x, y: model.m_RB_Corner.y - aPosition.y };

      case RT_CORNER:
        return { x: model.m_RB_Corner.x - aPosition.x, y: aPosition.y - model.m_LT_Corner.y };

      case LB_CORNER:
        return { x: aPosition.x - model.m_LT_Corner.x, y: model.m_RB_Corner.y - aPosition.y };

      case LT_CORNER:
        return { x: aPosition.x - model.m_LT_Corner.x, y: aPosition.y - model.m_LT_Corner.y };
    }

    return { x: 0, y: 0 };
  }

  /**
   * Move the starting point of the item to a new position.
   *
   * @param aPosition the new position of the starting point, in mm.
   */
  MoveStartPointTo(aPosition: VECTOR2D): void {
    this.m_Pos.m_Pos = DS_DATA_ITEM.toAnchor(this.m_Pos.m_Anchor, aPosition);
  }

  /**
   * Move the starting point of the item to a new position.
   *
   * @param aPosition is the new position of item in graphic units.
   */
  MoveStartPointToIU(aPosition: VECTOR2I): void {
    const pos_mm = {
      x: aPosition.x / DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu,
      y: aPosition.y / DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu,
    };

    this.MoveStartPointTo(pos_mm);
  }

  /**
   * Move the ending point of the item to a new position.
   *
   * This has meaning only for items defined by 2 points (segments and rectangles).
   *
   * @param aPosition is the new position of the ending point, in mm.
   */
  MoveEndPointTo(aPosition: VECTOR2D): void {
    const position = DS_DATA_ITEM.toAnchor(this.m_End.m_Anchor, aPosition);

    // Modify m_End only for items having 2 coordinates
    switch (this.GetType()) {
      case DS_ITEM_TYPE.DS_SEGMENT:
      case DS_ITEM_TYPE.DS_RECT:
        this.m_End.m_Pos = position;
        break;

      default:
        break;
    }
  }

  /**
   * Move the ending point of the item to a new position.
   *
   * This has meaning only for items defined by 2 points (segments and rectangles).
   *
   * @param aPosition is the new position of the ending point in graphic units
   */
  MoveEndPointToIU(aPosition: VECTOR2I): void {
    const pos_mm = {
      x: aPosition.x / DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu,
      y: aPosition.y / DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu,
    };

    this.MoveEndPointTo(pos_mm);
  }

  /** The page position (mm) of `aCoord` for repeat `ii`. */
  private static fromAnchor(aCoord: POINT_COORD, aIncr: VECTOR2D, ii: number): VECTOR2D {
    const model = DS_DATA_MODEL.GetTheInstance();
    const pos = { x: aCoord.m_Pos.x + aIncr.x * ii, y: aCoord.m_Pos.y + aIncr.y * ii };

    switch (aCoord.m_Anchor) {
      case RB_CORNER: // right bottom corner
        return { x: model.m_RB_Corner.x - pos.x, y: model.m_RB_Corner.y - pos.y };

      case RT_CORNER: // right top corner
        return { x: model.m_RB_Corner.x - pos.x, y: model.m_LT_Corner.y + pos.y };

      case LB_CORNER: // left bottom corner
        return { x: model.m_LT_Corner.x + pos.x, y: model.m_RB_Corner.y - pos.y };

      case LT_CORNER: // left top corner
        return { x: model.m_LT_Corner.x + pos.x, y: model.m_LT_Corner.y + pos.y };
    }

    return pos;
  }

  GetStartPos(ii = 0): VECTOR2D {
    return DS_DATA_ITEM.fromAnchor(this.m_Pos, this.m_IncrementVector, ii);
  }

  GetStartPosIU(ii = 0): VECTOR2I {
    const pos = this.GetStartPos(ii);
    const k = DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu;
    return { x: KiROUND(pos.x * k), y: KiROUND(pos.y * k) };
  }

  GetEndPos(ii = 0): VECTOR2D {
    return DS_DATA_ITEM.fromAnchor(this.m_End, this.m_IncrementVector, ii);
  }

  GetEndPosIU(ii = 0): VECTOR2I {
    const pos = this.GetEndPos(ii);
    const k = DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu;
    return { x: KiROUND(pos.x * k), y: KiROUND(pos.y * k) };
  }

  /**
   * @return true if the item is inside the rectangle defined by the 4 corners, false otherwise.
   */
  IsInsidePage(ii: number): boolean {
    const model = DS_DATA_MODEL.GetTheInstance();

    const corners: VECTOR2D[] = [this.GetStartPos(ii)];

    // Text and bitmap have no real end point, so only test it for lines and rects.
    if (this.GetType() === DS_ITEM_TYPE.DS_SEGMENT || this.GetType() === DS_ITEM_TYPE.DS_RECT)
      corners.push(this.GetEndPos(ii));

    for (const pos of corners) {
      if (model.m_RB_Corner.x < pos.x || model.m_LT_Corner.x > pos.x) return false;

      if (model.m_RB_Corner.y < pos.y || model.m_LT_Corner.y > pos.y) return false;
    }

    return true;
  }

  GetClassName(): string {
    switch (this.GetType()) {
      case DS_ITEM_TYPE.DS_TEXT:
        return 'Text';
      case DS_ITEM_TYPE.DS_SEGMENT:
        return 'Line';
      case DS_ITEM_TYPE.DS_RECT:
        return 'Rectangle';
      case DS_ITEM_TYPE.DS_POLYPOLYGON:
        return 'Imported Shape';
      case DS_ITEM_TYPE.DS_BITMAP:
        return 'Image';
    }

    return '';
  }
}

export class DS_DATA_ITEM_POLYGONS extends DS_DATA_ITEM {
  m_Orient: EDA_ANGLE = new EDA_ANGLE(0); // Orientation
  m_Corners: VECTOR2D[] = []; // corner list

  private m_polyIndexEnd: number[] = []; // index of the last point of each polygon
  private m_minCoord: { x: number; y: number } = { x: 0, y: 0 }; // min coord of corners, relative to m_Pos
  private m_maxCoord: { x: number; y: number } = { x: 0, y: 0 }; // max coord of corners, relative to m_Pos

  constructor() {
    super(DS_ITEM_TYPE.DS_POLYPOLYGON);
  }

  override SyncDrawItems(aCollector: DS_DRAW_ITEM_LIST | null, aView: VIEW | null): void {
    const itemFlags = this.clearDrawItems(aCollector, aView);

    this.m_drawItems = [];

    for (let j = 0; j < this.m_RepeatCount; j++) {
      if (j > 0 && !this.IsInsidePage(j)) continue;

      const pensize = this.GetPenSizeIU();
      const poly_shape = new DS_DRAW_ITEM_POLYPOLYGONS(this, j, this.GetStartPosIU(j), pensize);
      poly_shape.SetFlags(itemFlags.get(j) ?? 0);
      this.m_drawItems.push(poly_shape);

      // Transfer all outlines (basic polygons)
      const polygons = poly_shape.GetPolygons();

      for (let kk = 0; kk < this.GetPolyCount(); kk++) {
        // Create new outline
        let ist = this.GetPolyIndexStart(kk);
        const iend = this.GetPolyIndexEnd(kk);

        polygons.NewOutline();

        while (ist <= iend) polygons.Append(this.GetCornerPositionIU(ist++, j));
      }

      if (aCollector) aCollector.Append(poly_shape);

      if (aView) aView.Add(poly_shape);
    }
  }

  override GetPenSizeIU(): number {
    return KiROUND(this.m_LineWidth * DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu);
  }

  /**
   * Add a corner in corner list.
   *
   * @param aCorner is the item to append.
   */
  AppendCorner(aCorner: VECTOR2D): void {
    this.m_Corners.push({ x: aCorner.x, y: aCorner.y });
  }

  /**
   * Close the current contour, by storing the index of the last corner of the current
   * polygon in m_polyIndexEnd.
   */
  CloseContour(): void {
    this.m_polyIndexEnd.push(this.m_Corners.length - 1);
  }

  /**
   * @return the count of contours in the poly polygon.
   */
  GetPolyCount(): number {
    return this.m_polyIndexEnd.length;
  }

  /**
   * @param aContour is the index of the contour.
   * @return the index of the first corner of the contour \a aCountour.
   */
  GetPolyIndexStart(aContour: number): number {
    if (aContour === 0) return 0;
    else return this.m_polyIndexEnd[aContour - 1]! + 1;
  }

  /**
   * @param aContour is the index of the contour.
   * @return the index of the last corner of the contour \a aCountour.
   */
  GetPolyIndexEnd(aContour: number): number {
    return this.m_polyIndexEnd[aContour]!;
  }

  /**
   * @return the coordinate (in mm) of the corner \a aIdx and the repeated item \a aRepeat
   */
  GetCornerPosition(aIdx: number, aRepeat = 0): VECTOR2D {
    let pos = this.m_Corners[aIdx]!;

    // Rotation:
    pos = RotatePointD(pos, this.m_Orient);
    const start = this.GetStartPos(aRepeat);
    return { x: pos.x + start.x, y: pos.y + start.y };
  }

  /**
   * @return the coordinate (in draw/plot units) of the corner \a aIdx and the repeated
   *         item \a aRepeat
   */
  GetCornerPositionIU(aIdx: number, aRepeat = 0): VECTOR2I {
    const pos = this.GetCornerPosition(aIdx, aRepeat);
    const k = DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu;
    return { x: Math.trunc(pos.x * k), y: Math.trunc(pos.y * k) };
  }

  /**
   * Calculate the bounding box of the set polygons.
   *
   * [data] The corners are millimetres held in a `VECTOR2I` here, as upstream
   * holds them: `pos = m_Corners[ii]` truncates each to a whole millimetre
   * (the converting constructor is a `static_cast`) before the integer
   * `RotatePoint`, so the box is whole millimetres.
   */
  SetBoundingBox(): void {
    if (this.m_Corners.length === 0) {
      this.m_minCoord = { x: 0.0, y: 0.0 };
      this.m_maxCoord = { x: 0.0, y: 0.0 };
      return;
    }

    const asInt = (p: VECTOR2D): VECTOR2I => ({ x: Math.trunc(p.x), y: Math.trunc(p.y) });

    let pos = RotatePoint(asInt(this.m_Corners[0]!), this.m_Orient);
    this.m_minCoord = { x: pos.x, y: pos.y };
    this.m_maxCoord = { x: pos.x, y: pos.y };

    for (let ii = 1; ii < this.m_Corners.length; ii++) {
      pos = RotatePoint(asInt(this.m_Corners[ii]!), this.m_Orient);

      if (this.m_minCoord.x > pos.x) this.m_minCoord.x = pos.x;

      if (this.m_minCoord.y > pos.y) this.m_minCoord.y = pos.y;

      if (this.m_maxCoord.x < pos.x) this.m_maxCoord.x = pos.x;

      if (this.m_maxCoord.y < pos.y) this.m_maxCoord.y = pos.y;
    }
  }

  override IsInsidePage(ii: number): boolean {
    const model = DS_DATA_MODEL.GetTheInstance();

    let pos = this.GetStartPos(ii);
    pos = { x: pos.x + this.m_minCoord.x, y: pos.y + this.m_minCoord.y }; // left top pos of bounding box

    if (model.m_LT_Corner.x > pos.x || model.m_LT_Corner.y > pos.y) return false;

    pos = this.GetStartPos(ii);
    pos = { x: pos.x + this.m_maxCoord.x, y: pos.y + this.m_maxCoord.y }; // right bottom pos of bounding box

    if (model.m_RB_Corner.x < pos.x || model.m_RB_Corner.y < pos.y) return false;

    return true;
  }
}

export class DS_DATA_ITEM_TEXT extends DS_DATA_ITEM {
  m_TextBase: string; // The basic text, with format symbols
  m_FullText = ''; // The expanded text, shown on screen
  m_Orient: number; // Orientation in degrees
  m_Hjustify: GR_TEXT_H_ALIGN_T;
  m_Vjustify: GR_TEXT_V_ALIGN_T;
  m_Italic: boolean;
  m_Bold: boolean;
  m_Font: FONT | null;
  m_TextSize: VECTOR2D = { x: 0, y: 0 };
  m_TextColor: Color4d;
  // When not null, this is the max size of the full text.  The text size will be modified
  // to keep the full text inside this bound.
  m_BoundingBoxSize: VECTOR2D = { x: 0, y: 0 };
  // Actual text size, if constrained by the m_BoundingBoxSize constraint
  m_ConstrainedTextSize: { x: number; y: number } = { x: 0, y: 0 };

  constructor(aTextBase: string) {
    super(DS_ITEM_TYPE.DS_TEXT);
    this.m_TextBase = aTextBase;
    this.m_IncrementLabel = 1;
    this.m_Hjustify = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
    this.m_Vjustify = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
    this.m_Italic = false;
    this.m_Bold = false;
    this.m_Font = null;
    this.m_TextColor = COLOR4D_UNSPECIFIED;
    this.m_Orient = 0.0;
    this.m_LineWidth = 0.0; // 0 means use default value
  }

  override SyncDrawItems(aCollector: DS_DRAW_ITEM_LIST | null, aView: VIEW | null): void {
    let pensize = this.GetPenSizeIU();
    let multilines = false;

    if (DS_DATA_MODEL.GetTheInstance().m_EditMode) {
      this.m_FullText = this.m_TextBase;
    } else {
      this.m_FullText = aCollector ? aCollector.BuildFullText(this.m_TextBase) : '';
      multilines = this.ReplaceAntiSlashSequence();
    }

    if (pensize === 0) pensize = aCollector ? aCollector.GetDefaultPenSize() : 1;

    this.SetConstrainedTextSize();
    const k = DS_DATA_MODEL.GetTheInstance().m_WSunits2Iu;
    const textsize: VECTOR2I = {
      x: KiROUND(this.m_ConstrainedTextSize.x * k),
      y: KiROUND(this.m_ConstrainedTextSize.y * k),
    };

    if (this.m_Bold) pensize = GetPenSizeForBold(Math.min(textsize.x, textsize.y));

    const itemFlags = this.clearDrawItems(aCollector, aView);

    this.m_drawItems = [];

    for (let j = 0; j < this.m_RepeatCount; ++j) {
      if (j > 0 && !this.IsInsidePage(j)) continue;

      const iuscale = aCollector ? aCollector.GetIuScale() : new EdaIuScale(k);

      const text = new DS_DRAW_ITEM_TEXT(
        iuscale,
        this,
        j,
        this.m_FullText,
        this.GetStartPosIU(j),
        textsize,
        pensize,
        this.m_Font,
        this.m_Italic,
        this.m_Bold,
        this.m_TextColor,
      );

      text.SetFlags(itemFlags.get(j) ?? 0);
      this.m_drawItems.push(text);

      if (aCollector) aCollector.Append(text);

      if (aView) aView.Add(text);

      text.SetHorizJustify(this.m_Hjustify);
      text.SetVertJustify(this.m_Vjustify);
      text.SetTextAngle(new EDA_ANGLE(this.m_Orient));
      text.SetMultilineAllowed(multilines);

      // Increment label for the next text (has no meaning for multiline texts)
      if (this.m_RepeatCount > 1 && !multilines)
        this.IncrementLabel((j + 1) * this.m_IncrementLabel);
    }
  }

  override GetPenSizeIU(): number {
    const model = DS_DATA_MODEL.GetTheInstance();

    if (this.m_LineWidth !== 0) return KiROUND(this.m_LineWidth * model.m_WSunits2Iu);
    else return KiROUND(model.m_DefaultTextThickness * model.m_WSunits2Iu);
  }

  /**
   * Build an incremented copy of m_TextBase into m_FullText.
   * The rightmost letter or number is stepped by aIncr, carrying within its
   * own type (a letter rolls z -> aa, a number counts up). If nothing can be
   * stepped, m_FullText is left equal to m_TextBase.
   * @param aIncr = the increment value
   */
  IncrementLabel(aIncr: number): void {
    const incrementer = new STRING_INCREMENTER();
    incrementer.SetSkipIOSQXZ(false); // step through every letter
    incrementer.SetAlphabeticMaxIndex(-1); // no upper bound on label length

    // Step the rightmost letter or number, carrying within its own type so a
    // letter rolls z -> aa instead of running into punctuation.
    const stepped = incrementer.Increment(this.m_TextBase, aIncr, 0);

    if (stepped !== undefined) this.m_FullText = stepped;
    else this.m_FullText = this.m_TextBase;
  }

  /**
   * Calculate m_ConstrainedTextSize from m_TextSize
   * to keep the X size and the full Y size of the text
   * smaller than m_BoundingBoxSize
   * if m_BoundingBoxSize.x or m_BoundingBoxSize.y > 0
   * if m_BoundingBoxSize.x or m_BoundingBoxSize.y == 0
   * the corresponding text size is not constrained
   */
  SetConstrainedTextSize(): void {
    this.m_ConstrainedTextSize = { x: this.m_TextSize.x, y: this.m_TextSize.y };

    if (this.m_ConstrainedTextSize.x === 0)
      this.m_ConstrainedTextSize.x = DS_DATA_MODEL.GetTheInstance().m_DefaultTextSize.x;

    if (this.m_ConstrainedTextSize.y === 0)
      this.m_ConstrainedTextSize.y = DS_DATA_MODEL.GetTheInstance().m_DefaultTextSize.y;

    if (this.m_BoundingBoxSize.x > 0 || this.m_BoundingBoxSize.y > 0) {
      // to know the X and Y size of the line, we should use EDA_TEXT::GetTextBox()
      // but this function uses integers
      // So, to avoid truncations with our unit in mm, use microns.
      const FSCALE = 1000.0;

      const linewidth = 0;
      const size_micron: VECTOR2I = {
        x: KiROUND(this.m_ConstrainedTextSize.x * FSCALE),
        y: KiROUND(this.m_ConstrainedTextSize.y * FSCALE),
      };
      const dummy = new DS_DRAW_ITEM_TEXT(
        unityScale,
        this,
        0,
        this.m_FullText,
        { x: 0, y: 0 },
        size_micron,
        linewidth,
        this.m_Font,
        this.m_Italic,
        this.m_Bold,
        this.m_TextColor,
      );
      dummy.SetMultilineAllowed(true);
      dummy.SetHorizJustify(this.m_Hjustify);
      dummy.SetVertJustify(this.m_Vjustify);
      dummy.SetTextAngle(new EDA_ANGLE(this.m_Orient));

      const rect = dummy.GetTextBox(null);
      // [data] `KiROUND( (int) rect.GetWidth() / FSCALE )`: the measured box is
      // rounded to a WHOLE millimetre before the ratio is taken.
      const size: VECTOR2D = {
        x: KiROUND(Math.trunc(rect.GetWidth()) / FSCALE),
        y: KiROUND(Math.trunc(rect.GetHeight()) / FSCALE),
      };

      if (this.m_BoundingBoxSize.x > 0 && size.x > this.m_BoundingBoxSize.x)
        this.m_ConstrainedTextSize.x *= this.m_BoundingBoxSize.x / size.x;

      if (this.m_BoundingBoxSize.y > 0 && size.y > this.m_BoundingBoxSize.y)
        this.m_ConstrainedTextSize.y *= this.m_BoundingBoxSize.y / size.y;
    }
  }

  /**
   * Replace the '\''n' sequence by EOL and the sequence  '\''\' by only one '\'
   * inside m_FullText
   * @return true if the EOL symbol is found or is inserted (multiline text).
   */
  ReplaceAntiSlashSequence(): boolean {
    let multiline = false;
    const text = [...this.m_FullText];

    for (let ii = 0; ii < text.length; ii++) {
      if (text[ii] === '\n') multiline = true;
      else if (text[ii] === '\\') {
        if (++ii >= text.length) break;

        if (text[ii] === '\\') {
          // a double \\ sequence is replaced by a single \ char
          text.splice(ii, 1);
          ii--;
        } else if (text[ii] === 'n') {
          // Replace the "\n" sequence by a EOL char
          multiline = true;
          text[ii] = '\n';
          text.splice(ii - 1, 1);
          ii--;
        }
      }
    }

    this.m_FullText = text.join('');

    return multiline;
  }
}

export class DS_DATA_ITEM_BITMAP extends DS_DATA_ITEM {
  m_ImageBitmap: BITMAP_BASE | null;

  constructor(aImage: BITMAP_BASE | null) {
    super(DS_ITEM_TYPE.DS_BITMAP);
    this.m_ImageBitmap = aImage;
  }

  override SyncDrawItems(aCollector: DS_DRAW_ITEM_LIST | null, aView: VIEW | null): void {
    const itemFlags = this.clearDrawItems(aCollector, aView);

    if (aCollector) {
      const pix_size_iu = (aCollector.GetMilsToIUfactor() * 1000) / this.m_ImageBitmap!.GetPPI();
      this.m_ImageBitmap!.SetPixelSizeIu(pix_size_iu);
    }

    // Upstream returns here WITHOUT clearing m_drawItems, whose items it has
    // just deleted; nothing reads them before the next sync, which clears them.
    if (!this.m_ImageBitmap!.GetOriginalImageData()) return;

    this.m_drawItems = [];

    for (let j = 0; j < this.m_RepeatCount; j++) {
      if (j > 0 && !this.IsInsidePage(j)) continue;

      const bitmap = new DS_DRAW_ITEM_BITMAP(this, j, this.GetStartPosIU(j));

      bitmap.SetFlags(itemFlags.get(j) ?? 0);
      this.m_drawItems.push(bitmap);

      if (aCollector) aCollector.Append(bitmap);

      if (aView) aView.Add(bitmap);
    }
  }

  /** `int GetPPI() const`: the image's PPI over its scale, as an int. */
  GetPPI(): number {
    if (this.m_ImageBitmap)
      return Math.trunc(this.m_ImageBitmap.GetPPI() / this.m_ImageBitmap.GetScale());

    return 300;
  }

  SetPPI(aBitmapPPI: number): void {
    if (this.m_ImageBitmap) this.m_ImageBitmap.SetScale(this.m_ImageBitmap.GetPPI() / aBitmapPPI);
  }
}
