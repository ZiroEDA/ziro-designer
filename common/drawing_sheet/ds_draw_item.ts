// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/drawing_sheet/ds_draw_item.h` + `common/drawing_sheet/ds_draw_item.cpp`:
 * the `DS_DRAW_ITEM_*` graphic items a drawing sheet is drawn, plotted and
 * picked as, and `DS_DRAW_ITEM_LIST`, which builds them from the
 * `DS_DATA_MODEL`. `DS_DRAW_ITEM_LIST::GetTextVars` and `BuildFullText` are
 * defined in `ds_painter.cpp` upstream; they are the list's, so they are here.
 *
 * Each item knows the `DS_DATA_ITEM` it was built from (`GetPeer`) and which
 * of that item's repeats it is (`GetIndexInPeer`). An item built by
 * `DS_PROXY_VIEW_ITEM` from the resolved layout (`layout.ts`) has no peer,
 * like KiCad's `DS_DRAW_ITEM_PAGE`.
 *
 * Every sheet on screen is drawn through the GAL by `DS_PAINTER`;
 * `PrintWsItem` is the wxDC print path pl_editor prints through
 * (`gr_basic.ts`, `wx/dc.ts`).
 */

import { applyMixins } from '@ziroeda/core/mixins.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import type { Color4d } from '../gal/color4d.js';
import { GRLine, GRPoly, GRRect } from '../gr_basic.js';
import type { RENDER_SETTINGS } from '../render_settings.js';
import { ExpandTextVars, type TextVarResolverFn } from '../common.js';
import { EDA_ITEM, type EDA_DRAW_FRAME_LIKE } from '../eda_item.js';
import { EDA_TEXT } from '../eda_text.js';
import { type EdaIuScale, messageTextFromValue, unityScale } from '../eda_units.js';
import type { FONT, OutStr } from '../font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../font/text_attributes.js';
import { METRICS } from '../font/font_metrics.js';
import { GENERATOR_APPLICATION } from '../generator.js';
import {
  LAYER_DRAWINGSHEET,
  LAYER_DRAWINGSHEET_PAGE1,
  LAYER_DRAWINGSHEET_PAGEn,
} from '../layer_id.js';
import type { PAGE_INFO } from '../page_info.js';
import { EXPRESSION_EVALUATOR } from '../text_eval/text_eval_wrapper.js';
import { type PROJECT_TEXT_VARS, TITLE_BLOCK } from '../title_block.js';
import type { UNITS_PROVIDER } from '../units_provider.js';
import { MSG_PANEL_ITEM } from '../widgets/msgpanel.js';
import { KIUI_EllipsizeMenuText, KIUI_EllipsizeStatusText } from '../widgets/ui_common.js';
import {
  type DS_DATA_ITEM,
  type DS_DATA_ITEM_BITMAP,
  DS_ITEM_TYPE,
  PAGE_OPTION,
} from './ds_data_item.js';
import { DS_DATA_MODEL } from './ds_data_model.js';

/** `COLOR4D::UNSPECIFIED`. */
const COLOR4D_UNSPECIFIED: Color4d = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Base class to handle basic graphic items.
 *
 * Used to draw and/or plot:
 *  - title block and frame references
 *  - segments
 *  - rect
 *  - polygons (for logos)
 *  - graphic texts
 *  - bitmaps (also for logos, but they cannot be plot by SVG, GERBER or HPGL plotters
 *    where we just plot the bounding box)
 */

const addV = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });

export abstract class DS_DRAW_ITEM_BASE extends EDA_ITEM {
  protected m_peer: DS_DATA_ITEM | null; // the parent DS_DATA_ITEM item in the DS_DATA_MODEL
  protected m_index: number; // the index in the parent's repeat count
  protected m_penWidth: number;

  protected constructor(aPeer: DS_DATA_ITEM | null, aIndex: number, aType: KICAD_T) {
    super(aType);
    this.m_peer = aPeer;
    this.m_index = aIndex;
    this.m_penWidth = 0;
    this.ClearFlags();
  }

  GetPeer(): DS_DATA_ITEM | null {
    return this.m_peer;
  }

  GetIndexInPeer(): number {
    return this.m_index;
  }

  override ViewGetLayers(): number[] {
    if (this.m_peer === null) return [LAYER_DRAWINGSHEET];

    if (this.m_peer.GetPage1Option() === PAGE_OPTION.FIRST_PAGE_ONLY)
      return [LAYER_DRAWINGSHEET_PAGE1];
    else if (this.m_peer.GetPage1Option() === PAGE_OPTION.SUBSEQUENT_PAGES)
      return [LAYER_DRAWINGSHEET_PAGEn];

    return [LAYER_DRAWINGSHEET];
  }

  SetEnd(_aPos: VECTOR2I): void {
    /* not all types will need this */
  }

  GetPenWidth(): number {
    if (this.m_penWidth > 0) return this.m_penWidth;
    else return 1;
  }

  /** Draws the item to the settings' print DC, at `aOffset` (0,0 by default). */
  abstract PrintWsItem(aSettings: RENDER_SETTINGS, aOffset?: VECTOR2I): void;

  GetFontMetrics(): METRICS {
    return METRICS.Default();
  }

  /**
   * We can't cache bounding boxes because we're recreated for each draw event.  This method
   * can be overridden by items whose real bounding boxes are expensive to calculate.  It is
   * used to determine if we're in the current view, so it can be sloppy.
   */
  GetApproxBBox(): BOX2I {
    return this.GetBoundingBox();
  }

  // Derived types must define GetBoundingBox() as a minimum, and can then override the
  // two HitTest() functions if they need something more specific.
  abstract override GetBoundingBox(): BOX2I;

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    if (!(a instanceof BOX2I)) return super.HitTest(a as VECTOR2I, b as number | undefined);

    const sel = a.Clone();
    const aAccuracy = c ?? 0;

    if (aAccuracy) sel.Inflate(aAccuracy);

    if (b) return sel.Contains(this.GetBoundingBox());

    return sel.Intersects(this.GetBoundingBox());
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    let msg: string;
    const dataItem = this.GetPeer();

    // Is only a pure graphic item used in drawing sheet editor to handle the page limits
    if (dataItem === null) return;

    switch (dataItem.GetType()) {
      case DS_ITEM_TYPE.DS_SEGMENT:
        aList.push(new MSG_PANEL_ITEM('Line', ''));
        break;

      case DS_ITEM_TYPE.DS_RECT:
        aList.push(new MSG_PANEL_ITEM('Rectangle', ''));
        break;

      case DS_ITEM_TYPE.DS_TEXT: {
        const textItem = this as unknown as DS_DRAW_ITEM_TEXT;

        // Don't use GetShownText(); we want to see the variable references here
        aList.push(
          new MSG_PANEL_ITEM('Text', KIUI_EllipsizeStatusText(aFrame, textItem.GetText())),
        );
        break;
      }

      case DS_ITEM_TYPE.DS_POLYPOLYGON:
        aList.push(new MSG_PANEL_ITEM('Imported Shape', ''));
        break;

      case DS_ITEM_TYPE.DS_BITMAP:
        aList.push(new MSG_PANEL_ITEM('Image', ''));
        break;
    }

    switch (dataItem.GetPage1Option()) {
      case PAGE_OPTION.FIRST_PAGE_ONLY:
        msg = 'First Page Only';
        break;
      case PAGE_OPTION.SUBSEQUENT_PAGES:
        msg = 'Subsequent Pages';
        break;
      default:
        msg = 'All Pages';
        break;
    }

    aList.push(new MSG_PANEL_ITEM('First Page Option', msg));

    msg = messageTextFromValue(unityScale, 'unscaled', dataItem.m_RepeatCount);
    aList.push(new MSG_PANEL_ITEM('Repeat Count', msg));

    msg = messageTextFromValue(unityScale, 'unscaled', dataItem.m_IncrementLabel);
    aList.push(new MSG_PANEL_ITEM('Repeat Label Increment', msg));

    msg = `(${aFrame.MessageTextFromValue(dataItem.m_IncrementVector.x)}, ${aFrame.MessageTextFromValue(dataItem.m_IncrementVector.y)})`;

    aList.push(new MSG_PANEL_ITEM('Repeat Position Increment', msg));

    aList.push(new MSG_PANEL_ITEM('Comment', dataItem.m_Info));
  }
}

/** This class draws a thick segment. */
export class DS_DRAW_ITEM_LINE extends DS_DRAW_ITEM_BASE {
  private m_start: VECTOR2I; // start point of line/rect
  private m_end: VECTOR2I; // end point

  constructor(
    aPeer: DS_DATA_ITEM | null,
    aIndex: number,
    aStart: VECTOR2I,
    aEnd: VECTOR2I,
    aPenWidth: number,
  ) {
    super(aPeer, aIndex, KICAD_T.WSG_LINE_T);
    this.m_start = aStart;
    this.m_end = aEnd;
    this.m_penWidth = aPenWidth;
  }

  override GetClass(): string {
    return 'DS_DRAW_ITEM_LINE';
  }

  GetStart(): VECTOR2I {
    return this.m_start;
  }
  SetStart(aPos: VECTOR2I): void {
    this.m_start = aPos;
  }
  GetEnd(): VECTOR2I {
    return this.m_end;
  }
  override SetEnd(aPos: VECTOR2I): void {
    this.m_end = aPos;
  }

  PrintWsItem(aSettings: RENDER_SETTINGS, aOffset: VECTOR2I = { x: 0, y: 0 }): void {
    const DC = aSettings.GetPrintDC()!;
    const color = aSettings.GetLayerColor(LAYER_DRAWINGSHEET);
    const penWidth = Math.max(this.GetPenWidth(), aSettings.GetDefaultPenWidth());

    GRLine(DC, addV(this.GetStart(), aOffset), addV(this.GetEnd(), aOffset), penWidth, color);
  }

  override GetPosition(): VECTOR2I {
    return this.GetStart();
  }
  override SetPosition(aPos: VECTOR2I): void {
    this.SetStart(aPos);
  }

  override GetBoundingBox(): BOX2I {
    const start = this.GetStart();
    const end = this.GetEnd();
    return new BOX2I(start, { x: end.x - start.x, y: end.y - start.y });
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    if (a instanceof BOX2I) return super.HitTest(a, b as boolean, c);

    const mindist = ((b as number | undefined) ?? 0) + Math.trunc(this.GetPenWidth() / 2) + 1;
    return TestSegmentHit(a, this.GetStart(), this.GetEnd(), mindist);
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    const start = this.GetStart();
    const end = this.GetEnd();
    const length = Math.hypot(end.x - start.x, end.y - start.y);

    return `Line, length ${aUnitsProvider!.MessageTextFromValue(length)}`;
  }
}

export class DS_DRAW_ITEM_POLYPOLYGONS extends DS_DRAW_ITEM_BASE {
  m_Polygons = new SHAPE_POLY_SET();

  // position of reference point, from the DS_DATA_ITEM_POLYGONS parent
  // (used only in drawing sheet editor to draw anchors)
  private m_pos: VECTOR2I;

  constructor(aPeer: DS_DATA_ITEM | null, aIndex: number, aPos: VECTOR2I, aPenWidth: number) {
    super(aPeer, aIndex, KICAD_T.WSG_POLY_T);
    this.m_penWidth = aPenWidth;
    this.m_pos = aPos;
  }

  override GetClass(): string {
    return 'DS_DRAW_ITEM_POLYPOLYGONS';
  }

  PrintWsItem(aSettings: RENDER_SETTINGS, aOffset: VECTOR2I = { x: 0, y: 0 }): void {
    const DC = aSettings.GetPrintDC()!;
    const color = aSettings.GetLayerColor(LAYER_DRAWINGSHEET);
    const penWidth = Math.max(this.GetPenWidth(), aSettings.GetDefaultPenWidth());

    for (let idx = 0; idx < this.m_Polygons.OutlineCount(); ++idx) {
      const outline = this.m_Polygons.Outline(idx);
      const points_moved: VECTOR2I[] = [];

      for (let ii = 0; ii < outline.PointCount(); ii++)
        points_moved.push(addV(outline.CPoint(ii), aOffset));

      GRPoly(DC, points_moved.length, points_moved, true, penWidth, color, color);
    }
  }

  GetPolygons(): SHAPE_POLY_SET {
    return this.m_Polygons;
  }

  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  override SetPosition(aPos: VECTOR2I): void {
    // Note: m_pos is the anchor point of the shape.
    const move_vect = { x: aPos.x - this.m_pos.x, y: aPos.y - this.m_pos.y };
    this.m_pos = aPos;

    // Move polygon corners to the new position:
    this.m_Polygons.Move(move_vect);
  }

  override GetBoundingBox(): BOX2I {
    return this.m_Polygons.BBox();
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    if (!(a instanceof BOX2I)) return this.m_Polygons.Collide(a, (b as number | undefined) ?? 0);

    const sel = a.Clone();
    const aAccuracy = c ?? 0;

    if (aAccuracy) sel.Inflate(aAccuracy);

    if (b) return sel.Contains(this.GetBoundingBox());

    // Fast test: if rect is outside the polygon bounding box, then they cannot intersect
    if (!sel.Intersects(this.GetBoundingBox())) return false;

    for (let idx = 0; idx < this.m_Polygons.OutlineCount(); ++idx) {
      const outline = this.m_Polygons.COutline(idx);

      for (let ii = 0; ii < outline.PointCount(); ii++) {
        const corner = outline.CPoint(ii);

        // Test if the point is within aRect
        if (sel.Contains(corner)) return true;

        // Test if this edge intersects aRect
        const ii_next = (ii + 1) % outline.PointCount();
        const next_corner = outline.CPoint(ii_next);

        if (sel.Intersects(corner, next_corner)) return true;
      }
    }

    return false;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Imported shape';
  }
}

export class DS_DRAW_ITEM_RECT extends DS_DRAW_ITEM_BASE {
  private m_start: VECTOR2I; // start point of line/rect
  private m_end: VECTOR2I; // end point

  constructor(
    aPeer: DS_DATA_ITEM | null,
    aIndex: number,
    aStart: VECTOR2I,
    aEnd: VECTOR2I,
    aPenWidth: number,
  ) {
    super(aPeer, aIndex, KICAD_T.WSG_RECT_T);
    this.m_start = aStart;
    this.m_end = aEnd;
    this.m_penWidth = aPenWidth;
  }

  override GetClass(): string {
    return 'DS_DRAW_ITEM_RECT';
  }

  PrintWsItem(aSettings: RENDER_SETTINGS, aOffset: VECTOR2I = { x: 0, y: 0 }): void {
    const DC = aSettings.GetPrintDC()!;
    const color = aSettings.GetLayerColor(LAYER_DRAWINGSHEET);
    const penWidth = Math.max(this.GetPenWidth(), aSettings.GetDefaultPenWidth());

    GRRect(DC, addV(this.GetStart(), aOffset), addV(this.GetEnd(), aOffset), penWidth, color);
  }

  GetStart(): VECTOR2I {
    return this.m_start;
  }
  SetStart(aPos: VECTOR2I): void {
    this.m_start = aPos;
  }
  GetEnd(): VECTOR2I {
    return this.m_end;
  }
  override SetEnd(aPos: VECTOR2I): void {
    this.m_end = aPos;
  }

  override GetPosition(): VECTOR2I {
    return this.GetStart();
  }
  override SetPosition(aPos: VECTOR2I): void {
    this.SetStart(aPos);
  }

  override GetBoundingBox(): BOX2I {
    const start = this.GetStart();
    const end = this.GetEnd();
    return new BOX2I(start, { x: end.x - start.x, y: end.y - start.y });
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    if (!(a instanceof BOX2I)) {
      const dist = ((b as number | undefined) ?? 0) + Math.trunc(this.GetPenWidth() / 2);
      let start = this.GetStart();
      let end: VECTOR2I = { x: this.GetEnd().x, y: start.y };

      // Upper line
      if (TestSegmentHit(a, start, end, dist)) return true;

      // Right line
      start = end;
      end = { x: end.x, y: this.GetEnd().y };

      if (TestSegmentHit(a, start, end, dist)) return true;

      // lower line
      start = end;
      end = { x: this.GetStart().x, y: end.y };

      if (TestSegmentHit(a, start, end, dist)) return true;

      // left line
      start = end;
      end = this.GetStart();

      if (TestSegmentHit(a, start, end, dist)) return true;

      return false;
    }

    const sel = a.Clone();
    const aAccuracy = c ?? 0;

    if (aAccuracy) sel.Inflate(aAccuracy);

    if (b) return sel.Contains(this.GetBoundingBox());

    // For greedy we need to check each side of the rect as we're pretty much always inside the
    // rect which defines the drawing-sheet frame.
    let side = this.GetBoundingBox();
    side.SetHeight(0);

    if (sel.Intersects(side)) return true;

    side.SetY(this.GetBoundingBox().GetBottom());

    if (sel.Intersects(side)) return true;

    side = this.GetBoundingBox();
    side.SetWidth(0);

    if (sel.Intersects(side)) return true;

    side.SetX(this.GetBoundingBox().GetRight());

    if (sel.Intersects(side)) return true;

    return false;
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return `Rectangle, width ${aUnitsProvider!.MessageTextFromValue(Math.abs(this.GetStart().x - this.GetEnd().x))} height ${aUnitsProvider!.MessageTextFromValue(Math.abs(this.GetStart().y - this.GetEnd().y))}`;
  }
}

/**
 * A rectangle with thick segment showing the page limits and a marker showing the coordinate
 * origin.
 *
 * This only a draw item only.  Therefore m_peer ( the parent DS_DATA_ITEM item in the
 * DS_DATA_MODEL) is always a dummy item.
 */
export class DS_DRAW_ITEM_PAGE extends DS_DRAW_ITEM_BASE {
  private m_markerPos: VECTOR2I = { x: 0, y: 0 }; // position of the marker
  private m_pageSize: VECTOR2I = { x: 0, y: 0 }; // full size of the page
  private m_markerSize: number;

  constructor(aPenWidth: number, aMarkerSize: number) {
    super(null, 0, KICAD_T.WSG_PAGE_T);
    this.m_penWidth = aPenWidth;
    this.m_markerSize = aMarkerSize;
  }

  override GetClass(): string {
    return 'DS_DRAW_ITEM_PAGE';
  }

  PrintWsItem(_aSettings: RENDER_SETTINGS, _aOffset?: VECTOR2I): void {
    /* do nothing */
  }

  SetPageSize(aSize: VECTOR2I): void {
    this.m_pageSize = aSize;
  }
  GetPageSize(): VECTOR2I {
    return this.m_pageSize;
  }

  GetMarkerPos(): VECTOR2I {
    return this.m_markerPos;
  }
  SetMarkerPos(aPos: VECTOR2I): void {
    this.m_markerPos = aPos;
  }

  GetMarkerSize(): number {
    return this.m_markerSize;
  }

  override GetPosition(): VECTOR2I {
    return { x: 0, y: 0 };
  }
  override SetPosition(_aPos: VECTOR2I): void {
    /* do nothing */
  }

  override GetBoundingBox(): BOX2I {
    const dummy = new BOX2I();

    // We want this graphic item always visible. So gives the max size to the
    // bounding box to avoid any clamping:
    dummy.SetMaximum();

    return dummy;
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    if (a instanceof BOX2I) return super.HitTest(a, b as boolean, c);

    return false;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Page limits';
  }
}

// `DS_DRAW_ITEM_TEXT` merges EDA_TEXT as KiCad's `public EDA_TEXT` base does;
// the methods named here are overridden on the class or clash with EDA_ITEM's.
export interface DS_DRAW_ITEM_TEXT
  extends Omit<
    EDA_TEXT,
    | 'GetClass'
    | 'GetPosition'
    | 'SetPosition'
    | 'GetBoundingBox'
    | 'HitTest'
    | 'GetItemDescription'
    | 'Replace'
    | 'Matches'
    | 'GetFontMetrics'
  > {}

/**
 * A graphic text.
 *
 * It is derived from an EDA_TEXT, so it handle all characteristics of this graphic text
 * (justification, rotation ... ).
 */
export class DS_DRAW_ITEM_TEXT extends DS_DRAW_ITEM_BASE {
  constructor(
    aIuScale: EdaIuScale,
    aPeer: DS_DATA_ITEM | null,
    aIndex: number,
    aText: string,
    aPos: VECTOR2I,
    aSize: VECTOR2I,
    aPenWidth: number,
    aFont: FONT | null,
    aItalic = false,
    aBold = false,
    aColor: Color4d = COLOR4D_UNSPECIFIED,
  ) {
    super(aPeer, aIndex, KICAD_T.WSG_TEXT_T);
    this.initEdaText(aIuScale, aText);
    this.SetTextPos(aPos);
    this.SetTextSize(aSize);
    this.SetTextThickness(aPenWidth);
    this.SetFont(aFont);
    this.SetItalic(aItalic);
    this.SetBold(aBold);
    this.SetTextColor(aColor);
  }

  override GetClass(): string {
    return 'DS_DRAW_ITEM_TEXT';
  }

  PrintWsItem(aSettings: RENDER_SETTINGS, aOffset: VECTOR2I = { x: 0, y: 0 }): void {
    let color = this.GetTextColor();

    if (color.r === 0 && color.g === 0 && color.b === 0 && color.a === 0)
      color = aSettings.GetLayerColor(LAYER_DRAWINGSHEET);

    this.Print(aSettings, aOffset, color);
  }

  override GetPosition(): VECTOR2I {
    return this.GetTextPos();
  }
  override SetPosition(aPos: VECTOR2I): void {
    this.SetTextPos(aPos);
  }

  /**
   * A really dumb over-approximation because doing it for real (even with the stroke font)
   * shows up large in profiles.
   */
  override GetApproxBBox(): BOX2I {
    const attrs = this.GetAttributes();
    const text = this.GetShownText(true);
    const bbox = new BOX2I(this.GetTextPos(), { x: 0, y: 0 });

    bbox.SetWidth(KiROUND([...text].length * attrs.m_Size.x * 1.3));
    bbox.SetHeight(attrs.m_Size.y);

    switch (attrs.m_Halign) {
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
        break;
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER:
        bbox.Offset(-Math.trunc(bbox.GetWidth() / 2), 0);
        break;
      case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
        bbox.Offset(-bbox.GetWidth(), 0);
        break;
    }

    switch (attrs.m_Valign) {
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
        break;
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
        bbox.Offset(0, -Math.trunc(bbox.GetHeight() / 2));
        break;
      case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
        bbox.Offset(0, -bbox.GetHeight());
        break;
    }

    bbox.Inflate(attrs.m_Size.x, Math.trunc(attrs.m_Size.y / 2));
    return bbox;
  }

  override GetBoundingBox(): BOX2I {
    return this.GetTextBox(null);
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    if (a instanceof BOX2I) return this.TextHitTest(a, b as boolean, c ?? 0);

    return this.TextHitTest(a, (b as number | undefined) ?? 0);
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Text '${aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText())}'`;
  }

  /** `getFontMetrics()` override: `GetFontMetrics()`, the base's default metrics. */
  getFontMetrics(): METRICS {
    return this.GetFontMetrics();
  }
}

applyMixins(DS_DRAW_ITEM_TEXT, [EDA_TEXT]);

/**
 * A bitmap.
 */
export class DS_DRAW_ITEM_BITMAP extends DS_DRAW_ITEM_BASE {
  private m_pos: VECTOR2I; // position of reference point

  constructor(aPeer: DS_DATA_ITEM | null, aIndex: number, aPos: VECTOR2I) {
    super(aPeer, aIndex, KICAD_T.WSG_BITMAP_T);
    this.m_pos = aPos;
  }

  override GetClass(): string {
    return 'DS_DRAW_ITEM_BITMAP';
  }

  PrintWsItem(aSettings: RENDER_SETTINGS, aOffset: VECTOR2I = { x: 0, y: 0 }): void {
    const bitmap = this.GetPeer() as DS_DATA_ITEM_BITMAP | null;

    if (!bitmap?.m_ImageBitmap) return;

    bitmap.m_ImageBitmap.DrawBitmap(
      aSettings.GetPrintDC()!,
      addV(this.m_pos, aOffset),
      aSettings.GetBackgroundColor(),
    );
  }

  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }
  override SetPosition(aPos: VECTOR2I): void {
    this.m_pos = aPos;
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    if (a instanceof BOX2I) return super.HitTest(a, b as boolean, c);

    const bbox = this.GetBoundingBox();
    bbox.Inflate((b as number | undefined) ?? 0);

    return bbox.Contains(a);
  }

  override GetBoundingBox(): BOX2I {
    const bitmap = this.m_peer as DS_DATA_ITEM_BITMAP | null;
    const bbox = new BOX2I();

    if (bitmap?.m_ImageBitmap) {
      const bm_size = bitmap.m_ImageBitmap.GetSize();
      bbox.SetSize(bm_size);
      bbox.SetOrigin({
        x: this.m_pos.x - Math.trunc(bm_size.x / 2),
        y: this.m_pos.y - Math.trunc(bm_size.y / 2),
      });
    }

    return bbox;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Image';
  }
}

/**
 * Store the list of graphic items: rect, lines, polygons and texts to draw/plot
 * the title block and frame references, and parameters to draw/plot them.
 */
export class DS_DRAW_ITEM_LIST {
  protected m_graphicList: DS_DRAW_ITEM_BASE[] = []; // Items to draw/plot
  protected m_iuScale: EdaIuScale; // IU scale for drawing
  protected m_plotterMilsToIu: number; // IU scale for plotting
  protected m_idx: number; // for GetFirst, GetNext functions
  protected m_penSize: number; // The default line width for drawings.
  // used when an item has a pen size = 0
  protected m_isFirstPage: boolean; ///< Is this the first page or not.
  protected m_sheetCount: number; ///< The number of sheets
  // for text variable references, in schematic
  protected m_titleBlock: TITLE_BLOCK | null; // for text variable references
  protected m_paperFormat = ''; // for text variable references
  protected m_fileName = ''; // for text variable references
  protected m_sheetName = ''; // for text variable references
  protected m_sheetPath = ''; // for text variable references
  protected m_pageNumber: string; ///< The actual page number displayed in the title block.
  protected m_sheetLayer = ''; // for text variable references
  protected m_variantName = ''; // for ${VARIANT} text variable reference
  protected m_variantDesc = ''; // for ${VARIANT_DESC} text variable reference
  protected m_project: PROJECT_TEXT_VARS; // for project-based text variable references
  protected m_flags: number;
  protected m_properties: Map<string, string> | null; // for text variable references

  constructor(aIuScale: EdaIuScale, aFlags = 0) {
    this.m_iuScale = aIuScale;
    this.m_idx = 0;
    this.m_plotterMilsToIu = 0.0;
    this.m_penSize = 1;
    this.m_pageNumber = '1';
    this.m_sheetCount = 1;
    this.m_titleBlock = null;
    this.m_project = null;
    this.m_isFirstPage = true;
    this.m_flags = aFlags;
    this.m_properties = null;
  }

  /** Set the project, for its text variables (`PROJECT::TextVarResolver`). */
  SetProject(aProject: PROJECT_TEXT_VARS): void {
    this.m_project = aProject;
  }

  /** Set the title block (mainly for drawing sheet editor). */
  SetTitleBlock(aTblock: TITLE_BLOCK | null): void {
    this.m_titleBlock = aTblock;
  }

  /** Set properties used for text variable resolution. */
  SetProperties(aProps: Map<string, string> | null): void {
    this.m_properties = aProps;
  }

  /** Set the paper format name (mainly for drawing sheet editor). */
  SetPaperFormat(aFormatName: string): void {
    this.m_paperFormat = aFormatName;
  }

  /** Set the filename to draw/plot. */
  SetFileName(aFileName: string): void {
    this.m_fileName = aFileName;
  }

  /** Set the sheet name to draw/plot. */
  SetSheetName(aSheetName: string): void {
    this.m_sheetName = aSheetName;
  }

  /** Set the sheet path to draw/plot. */
  SetSheetPath(aSheetPath: string): void {
    this.m_sheetPath = aSheetPath;
  }

  /** Set the sheet layer to draw/plot. */
  SetSheetLayer(aSheetLayer: string): void {
    this.m_sheetLayer = aSheetLayer;
  }

  SetVariantName(aVariant: string): void {
    this.m_variantName = aVariant;
  }

  SetVariantDesc(aDesc: string): void {
    this.m_variantDesc = aDesc;
  }

  SetDefaultPenSize(aPenSize: number): void {
    this.m_penSize = aPenSize;
  }
  GetDefaultPenSize(): number {
    return this.m_penSize;
  }

  /** Set the scalar to convert pages units (mils) to plot units. */
  SetPlotterMilsToIUfactor(aMils2Iu: number): void {
    this.m_plotterMilsToIu = aMils2Iu;
  }

  /** Get the scalar to convert pages units (mils) to draw/plot units. */
  GetMilsToIUfactor(): number {
    if (this.m_plotterMilsToIu > 0.0) return this.m_plotterMilsToIu;
    else return this.m_iuScale.IU_PER_MILS;
  }

  GetIuScale(): EdaIuScale {
    return this.m_iuScale;
  }

  /** Set the value of the sheet number. */
  SetPageNumber(aPageNumber: string): void {
    this.m_pageNumber = aPageNumber;
  }

  /** Set if the page is the first page. */
  SetIsFirstPage(aIsFirstPage: boolean): void {
    this.m_isFirstPage = aIsFirstPage;
  }

  /** Set the value of the count of sheets, for basic inscriptions. */
  SetSheetCount(aSheetCount: number): void {
    this.m_sheetCount = aSheetCount;
  }

  Append(aItem: DS_DRAW_ITEM_BASE): void {
    this.m_graphicList.push(aItem);
  }

  Remove(aItem: DS_DRAW_ITEM_BASE): void {
    this.m_graphicList = this.m_graphicList.filter((i) => i !== aItem);
  }

  /**
   * Draws the item list created by BuildDrawItemsList, bitmaps first so the
   * lines and text print over them.
   */
  Print(aSettings: RENDER_SETTINGS): void {
    const second_items: DS_DRAW_ITEM_BASE[] = [];

    for (let item = this.GetFirst(); item; item = this.GetNext()) {
      if (item.Type() === KICAD_T.WSG_BITMAP_T) item.PrintWsItem(aSettings);
      else second_items.push(item);
    }

    for (const item of second_items) item.PrintWsItem(aSettings);
  }

  /** @return the first DS_DRAW_ITEM_BASE item in list. */
  GetFirst(): DS_DRAW_ITEM_BASE | null {
    this.m_idx = 0;

    if (this.m_graphicList.length) return this.m_graphicList[0]!;
    else return null;
  }

  /** @return the next DS_DRAW_ITEM_BASE item in list. */
  GetNext(): DS_DRAW_ITEM_BASE | null {
    this.m_idx++;

    if (this.m_graphicList.length > this.m_idx) return this.m_graphicList[this.m_idx]!;
    else return null;
  }

  /**
   * Drawing or plot the drawing sheet.
   *
   * Before calling this function, some parameters should be initialized by calling:
   *   SetPenSize( aPenWidth );
   *   SetMilsToIUfactor( aMils2Iu );
   *   SetSheetNumber( aSheetNumber );
   *   SetSheetCount( aSheetCount );
   *   SetFileName( aFileName );
   *   SetSheetName( aFullSheetName );
   */
  BuildDrawItemsList(aPageInfo: PAGE_INFO, aTitleBlock: TITLE_BLOCK): void {
    const model = DS_DATA_MODEL.GetTheInstance();

    this.m_titleBlock = aTitleBlock;
    this.m_paperFormat = aPageInfo.GetTypeAsString();

    // Build the basic layout shape, if the layout list is empty
    if (model.GetCount() === 0 && !model.VoidListAllowed()) model.LoadDrawingSheet('', null);

    model.SetupDrawEnvironment(aPageInfo, this.GetMilsToIUfactor());

    for (const wsItem of model.GetItems()) {
      // Generate it only if the page option allows this
      if (wsItem.GetPage1Option() === PAGE_OPTION.FIRST_PAGE_ONLY && !this.m_isFirstPage) continue;
      else if (wsItem.GetPage1Option() === PAGE_OPTION.SUBSEQUENT_PAGES && this.m_isFirstPage)
        continue;

      wsItem.SyncDrawItems(this, null);
    }
  }

  /**
   * Return the full list of text variables which can be used in a drawing sheet.
   */
  static GetTextVars(aVars: string[]): void {
    aVars.push('KICAD_VERSION');
    aVars.push('#');
    aVars.push('##');
    aVars.push('SHEETNAME');
    aVars.push('SHEETPATH');
    aVars.push('FILENAME');
    aVars.push('FILEPATH');
    aVars.push('PROJECTNAME');
    aVars.push('PAPER');
    aVars.push('LAYER');
    aVars.push('VARIANT');
    aVars.push('VARIANT_DESC');
    TITLE_BLOCK.GetContextualTextVars(aVars);
  }

  /**
   * @return the full text corresponding to the aTextbase, after replacing format symbols
   *         by the corresponding value.
   */
  BuildFullText(aTextbase: string): string {
    const project = this.m_project;
    const projectResolver: TextVarResolverFn | null = project
      ? (t) => project.TextVarResolver(t)
      : null;

    const wsResolver: TextVarResolverFn = (token: OutStr): boolean => {
      let tokenUpdated = false;

      if (token.value === 'KICAD_VERSION') {
        // `productName GetBaseVersion()` upstream; we must not print KiCad's
        // product name (common/generator.ts), so the application's.
        token.value = GENERATOR_APPLICATION;
        tokenUpdated = true;
      } else if (token.value === '#') {
        token.value = this.m_pageNumber;
        tokenUpdated = true;
      } else if (token.value === '##') {
        token.value = `${this.m_sheetCount}`;
        tokenUpdated = true;
      } else if (token.value === 'SHEETNAME') {
        token.value = this.m_sheetName;
        tokenUpdated = true;
      } else if (token.value === 'SHEETPATH') {
        token.value = this.m_sheetPath;
        tokenUpdated = true;
      } else if (token.value === 'FILENAME') {
        // wxFileName::GetFullName: the name and extension, no directory.
        token.value = this.m_fileName.slice(this.m_fileName.lastIndexOf('/') + 1);
        tokenUpdated = true;
      } else if (token.value === 'FILEPATH') {
        token.value = this.m_fileName;
        return true;
      } else if (token.value === 'PAPER') {
        token.value = this.m_paperFormat;
        tokenUpdated = true;
      } else if (token.value === 'LAYER') {
        token.value = this.m_sheetLayer;
        tokenUpdated = true;
      } else if (token.value === 'VARIANT') {
        token.value = this.m_variantName;
        tokenUpdated = true;
      } else if (token.value === 'VARIANT_DESC') {
        token.value = this.m_variantDesc;
        tokenUpdated = true;
      } else if (this.m_titleBlock) {
        if (this.m_titleBlock.TextVarResolver(token, this.m_project, this.m_flags)) {
          // No need for tokenUpdated; TITLE_BLOCK::TextVarResolver() already goes
          // up to the project.
          //
          // However, the title block may have variables in it itself, so we need
          // to run the worksheet resolver again.
          //
          const savedTitleBlock = this.m_titleBlock;

          this.m_titleBlock = null;
          token.value = ExpandTextVars(token.value, wsResolver, this.m_flags);
          this.m_titleBlock = savedTitleBlock;

          return true;
        }
      } else if (this.m_properties?.has(token.value)) {
        token.value = this.m_properties.get(token.value)!;
        tokenUpdated = true;
      }

      if (tokenUpdated) {
        token.value = ExpandTextVars(token.value, projectResolver, this.m_flags);
        return true;
      }

      if (projectResolver?.(token)) return true;

      return false;
    };

    let retv = ExpandTextVars(aTextbase, wsResolver, this.m_flags);

    if (retv.includes('@{')) {
      // Must not be static. Painting can run on parallel workers and a shared
      // evaluator races on its internal error collector.
      const evaluator = new EXPRESSION_EVALUATOR();
      retv = evaluator.Evaluate(retv);
    }

    return retv;
  }
}
