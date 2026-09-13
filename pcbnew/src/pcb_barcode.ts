// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_barcode.h` / `pcb_barcode.cpp`: `PCB_BARCODE`, a Zint-encoded
 * symbol with an optional human-readable `PCB_TEXT` under it, kept as three
 * cached polygon sets (the symbol, the text, the assembled result with the
 * knockout, mirror and rotation applied).
 *
 * The Zint encoders are the port in `barcode/`; `ZBarcode_Buffer_Vector`'s
 * rectangle output is `vectorRectangles` here.
 *
 * Not here: `Serialize`/`Deserialize` (the kiapi protobuf surface) and
 * `PCB_BARCODE_DESC`, the `PROPERTY_MANAGER` registration.
 */

import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/src/eda_draw_frame.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/src/eda_item.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { GetPenSizeForNormal } from '@ziroeda/common/src/gr_text.js';
import { FLASHING, GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import { KIUI_EllipsizeStatusText } from '@ziroeda/common/src/widgets/ui_common.js';
import { FLIP_DIRECTION, MIRROR } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_180, EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { type VECTOR2I, add, divideI, equal, sub } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { moduleIsSet, type ZintSymbol } from './barcode/common.js';
import { encodeBarcode } from './barcode/zint.js';
import type { BOARD_DESIGN_SETTINGS } from './board_design_settings.js';
import { BOARD_ITEM } from './board_item.js';
import { PCB_TEXT } from './pcb_text.js';
import type { PCB_VIEW_FOR_LOD } from './pcb_shape.js';
import type { BarcodeEcc, BarcodeKind } from './types.js';

export enum BARCODE_T {
  CODE_39 = 0,
  CODE_128 = 1,
  DATA_MATRIX = 2,
  QR_CODE = 3,
  MICRO_QR_CODE = 4,
}

export enum BARCODE_ECC_T {
  L = 1, // Low
  M = 2, // Medium
  Q = 3, // Quartile
  H = 4, // High
}

const KIND_NAMES: Record<BARCODE_T, BarcodeKind> = {
  [BARCODE_T.CODE_39]: 'code39',
  [BARCODE_T.CODE_128]: 'code128',
  [BARCODE_T.DATA_MATRIX]: 'datamatrix',
  [BARCODE_T.QR_CODE]: 'qr',
  [BARCODE_T.MICRO_QR_CODE]: 'microqr',
};

const ECC_NAMES: Record<BARCODE_ECC_T, BarcodeEcc> = {
  [BARCODE_ECC_T.L]: 'L',
  [BARCODE_ECC_T.M]: 'M',
  [BARCODE_ECC_T.Q]: 'Q',
  [BARCODE_ECC_T.H]: 'H',
};

interface ZINT_VECTOR_RECT {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * `ZBarcode_Buffer_Vector( symbol, 0 )`'s rectangles (Zint `vector.c`): every
 * run of set modules in a row is one rectangle, scaled by `symbol->scale * 2`
 * (the default scale is 1); a linear symbology's rows share `symbol->height`.
 */
function vectorRectangles(aSymbol: ZintSymbol): { rects: ZINT_VECTOR_RECT[]; scale: number } {
  const SCALE = 2; // `symbol->scale * 2.0`, with scale left at its default 1.
  const rects: ZINT_VECTOR_RECT[] = [];

  let zeroRows = 0;
  let fixed = 0;

  for (let r = 0; r < aSymbol.rows; r++) {
    const h = aSymbol.rowHeight[r] ?? 0;

    if (h) fixed += h;
    else zeroRows++;
  }

  const largeBar = zeroRows ? (aSymbol.height - fixed) / zeroRows : 0;

  let yposn = 0;

  for (let r = 0; r < aSymbol.rows; r++) {
    const rowHeight = aSymbol.rowHeight[r] || largeBar;

    for (let i = 0; i < aSymbol.width; ) {
      const fill = moduleIsSet(aSymbol, r, i);
      let blockWidth = 1;

      while (i + blockWidth < aSymbol.width && moduleIsSet(aSymbol, r, i + blockWidth) === fill)
        blockWidth++;

      if (fill)
        rects.push({
          x: i * SCALE,
          y: yposn * SCALE,
          width: blockWidth * SCALE,
          height: rowHeight * SCALE,
        });

      i += blockWidth;
    }

    yposn += rowHeight;
  }

  vector_reduce_rectangles(rects);

  return { rects, scale: 1 }; // `symbol->scale`, the multiplier ComputeBarcode applies again
}

/** Looks for vertically aligned rectangles and merges them together (`vector.c`). */
function vector_reduce_rectangles(aRects: ZINT_VECTOR_RECT[]): void {
  let rectIdx = 0;

  while (rectIdx < aRects.length) {
    const rect = aRects[rectIdx]!;
    let targetIdx = rectIdx + 1;

    while (targetIdx < aRects.length) {
      const target = aRects[targetIdx]!;

      if (rect.x === target.x && rect.width === target.width && rect.y + rect.height === target.y) {
        rect.height += target.height;
        aRects.splice(targetIdx, 1);
      } else {
        targetIdx++;
      }
    }

    rectIdx++;
  }
}

export class PCB_BARCODE extends BOARD_ITEM {
  private m_width: number; ///< Barcode width
  private m_height: number; ///< Barcode height
  private m_pos: VECTOR2I; ///< Position of the barcode
  private m_margin: VECTOR2I; ///< Margin around the barcode (only valid for knockout)
  private m_text: PCB_TEXT;
  private m_kind: BARCODE_T;
  private m_angle: EDA_ANGLE;
  private m_errorCorrection: BARCODE_ECC_T; ///< Error correction level for QR codes

  private m_poly: SHAPE_POLY_SET; ///< Full geometry (barcode + optional text or knockout)
  private m_symbolPoly: SHAPE_POLY_SET; ///< Barcode symbol only (cached, centered at origin)
  private m_textPoly: SHAPE_POLY_SET; ///< Human-readable text only (cached, centered/positioned)
  private m_bbox: BOX2I; ///< BBox of m_poly (ie: barcode + text)
  private m_lastError = '';

  /**
   * Construct a PCB_BARCODE.
   *
   * @param aParent Parent board item (usually the BOARD object).
   */
  constructor(aParent: BOARD_ITEM | null) {
    super(aParent, KICAD_T.PCB_BARCODE_T);
    this.m_width = pcbIUScale.mmToIU(40);
    this.m_height = pcbIUScale.mmToIU(40);
    this.m_pos = { x: 0, y: 0 };
    this.m_margin = { x: 0, y: 0 };
    this.m_text = new PCB_TEXT(this);
    this.m_kind = BARCODE_T.QR_CODE;
    this.m_angle = new EDA_ANGLE(0);
    this.m_errorCorrection = BARCODE_ECC_T.L;
    this.m_poly = new SHAPE_POLY_SET();
    this.m_symbolPoly = new SHAPE_POLY_SET();
    this.m_textPoly = new SHAPE_POLY_SET();
    this.m_bbox = new BOX2I();

    this.m_layer = PCB_LAYER_ID.Dwgs_User;
  }

  /**
   * Copy constructor.
   */
  static copyOf(aOther: PCB_BARCODE): PCB_BARCODE {
    const copy = new PCB_BARCODE(aOther.GetParent());
    BOARD_ITEM.copyBase(copy, aOther);
    copy.m_width = aOther.m_width;
    copy.m_height = aOther.m_height;
    copy.m_pos = { ...aOther.m_pos };
    copy.m_margin = { ...aOther.m_margin };
    copy.m_text = PCB_TEXT.copyOf(aOther.m_text);
    copy.m_kind = aOther.m_kind;
    copy.m_angle = aOther.m_angle.Clone();
    copy.m_errorCorrection = aOther.m_errorCorrection;
    copy.m_poly = new SHAPE_POLY_SET(aOther.m_poly);
    copy.m_symbolPoly = new SHAPE_POLY_SET(aOther.m_symbolPoly);
    copy.m_textPoly = new SHAPE_POLY_SET(aOther.m_textPoly);
    copy.m_bbox = aOther.m_bbox.Clone();
    copy.m_text.SetParent(copy);
    return copy;
  }

  /**
   * Copy assignment operator.
   *
   * Re-parents the embedded m_text object after copying to ensure the parent chain
   * remains correct for text variable resolution.
   */
  assignBarcode(aOther: PCB_BARCODE): this {
    if (this !== aOther) {
      this.assignBoardItem(aOther);
      this.m_width = aOther.m_width;
      this.m_height = aOther.m_height;
      this.m_pos = { ...aOther.m_pos };
      this.m_margin = { ...aOther.m_margin };
      this.m_text.assignPcbText(aOther.m_text);
      this.m_kind = aOther.m_kind;
      this.m_angle = aOther.m_angle.Clone();
      this.m_errorCorrection = aOther.m_errorCorrection;
      this.m_poly = new SHAPE_POLY_SET(aOther.m_poly);
      this.m_symbolPoly = new SHAPE_POLY_SET(aOther.m_symbolPoly);
      this.m_textPoly = new SHAPE_POLY_SET(aOther.m_textPoly);
      this.m_bbox = aOther.m_bbox.Clone();
      this.m_text.SetParent(this);
    }

    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_BARCODE_T)) return; // wxCHECK

    this.assignBarcode(aOther as PCB_BARCODE);
  }

  /**
   * Type-check helper.
   */
  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && KICAD_T.PCB_BARCODE_T === aItem.Type();
  }

  override SetPosition(aPos: VECTOR2I): void {
    const delta = sub(aPos, this.m_pos);
    this.Move(delta);
  }

  /**
   * Get the position (center) of the barcode in internal units.
   */
  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  /**
   * Set the barcode content text to encode.
   *
   * @param aNewText UTF-8 string content for the barcode.
   */
  SetText(aNewText: string): void {
    this.m_text.SetText(aNewText);
  }

  GetText(): string {
    return this.m_text.GetText();
  }

  GetShownText(): string {
    return this.m_text.GetShownText(true);
  }

  /**
   * Set the drawing layer for the barcode and its text.
   */
  override SetLayer(aLayer: PCB_LAYER_ID): void {
    this.m_layer = aLayer;
    this.m_text.SetLayer(aLayer);
    this.AssembleBarcode();
  }

  /**
   * Change the height of the human-readable text displayed below the barcode.
   *
   * @param aTextSize text size in internal units.  Will be used for both x and y.
   */
  SetTextSize(aTextSize: number): void {
    this.m_text.SetTextSize({ x: Math.max(1, aTextSize), y: Math.max(1, aTextSize) });
    this.m_text.SetTextThickness(Math.max(1, GetPenSizeForNormal(this.m_text.GetTextHeight())));
    this.AssembleBarcode();
  }

  GetTextSize(): number {
    return this.m_text.GetTextHeight();
  }

  /**
   * Get the barcode width (in internal units).
   */
  GetWidth(): number {
    return this.m_width;
  }
  SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }

  /**
   * Get the barcode height (in internal units).
   */
  GetHeight(): number {
    return this.m_height;
  }
  SetHeight(aHeight: number): void {
    this.m_height = aHeight;
  }

  /**
   * Get the barcode margin (in internal units).
   */
  GetMargin(): VECTOR2I {
    return this.m_margin;
  }
  SetMargin(aMargin: VECTOR2I): void {
    this.m_margin = { x: aMargin.x, y: aMargin.y };
  }

  /**
   * Access the underlying polygonal representation generated for the barcode.
   */
  GetPolyShape(): SHAPE_POLY_SET {
    return this.m_poly;
  }

  /**
   * Access the cached polygon for the barcode symbol only (no text, no margins/knockout).
   */
  GetSymbolPoly(): SHAPE_POLY_SET {
    return this.m_symbolPoly;
  }

  /**
   * Access the cached polygon for the human-readable text only (already scaled/placed).
   */
  GetTextPoly(): SHAPE_POLY_SET {
    return this.m_textPoly;
  }

  /**
   * Access the internal `PCB_TEXT` object used for showing the human-readable text.
   */
  Text(): PCB_TEXT {
    return this.m_text;
  }

  /**
   * Translate the barcode and its text by the given offset.
   */
  override Move(offset: VECTOR2I): void {
    this.m_pos = add(this.m_pos, offset);
    this.m_symbolPoly.Move(offset);
    this.m_textPoly.Move(offset);
    this.m_poly.Move(offset);
    this.m_text.Move(offset);
    this.m_bbox.Move(offset);
  }

  /**
   * Rotate the barcode around a given centre by the given angle.
   * The underlying polygon and text are rotated; the width/height are updated from the new bounding box.
   */
  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_pos = RotatePoint(this.m_pos, aRotCentre, aAngle);
    this.m_angle = this.m_angle.add(aAngle);
    this.AssembleBarcode();
  }

  /**
   * Flip the barcode horizontally or vertically around a centre point.
   * The layer may be adjusted when flipping.
   */
  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_pos, aCentre, aFlipDirection);

    if (aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM) this.m_angle = this.m_angle.add(ANGLE_180);

    this.SetLayer(this.GetBoard()!.FlipLayer(this.GetLayer()));
    this.AssembleBarcode();
  }

  override StyleFromSettings(settings: BOARD_DESIGN_SETTINGS, aCheckSide: boolean): void {
    this.SetTextSize(settings.GetTextSize(this.GetLayer()).y);
  }

  /**
   * Get the centre of the barcode (alias for GetPosition).
   */
  override GetCenter(): VECTOR2I {
    return this.GetPosition();
  }

  /**
   * Assemble the barcode polygon and text polygons into a single polygonal representation.
   * Optionally apply a knockout and margins.
   */
  AssembleBarcode(): void {
    this.ComputeBarcode();

    // Scale the symbol polygon to the desired barcode width/height (property values) and center it at m_pos
    // Note: SetRect will rescale the symbol-only polygon and then rebuild m_poly
    this.SetRect(
      sub(this.m_pos, { x: Math.trunc(this.m_width / 2), y: Math.trunc(this.m_height / 2) }),
      add(this.m_pos, { x: Math.trunc(this.m_width / 2), y: Math.trunc(this.m_height / 2) }),
    );

    this.ComputeTextPoly();

    // Build full m_poly from symbol + optional text, then apply knockout if requested
    this.m_poly.RemoveAllContours();
    this.m_poly.Append(this.m_symbolPoly);

    if (this.m_text.IsVisible() && this.m_textPoly.OutlineCount())
      this.m_poly.Append(this.m_textPoly);

    this.m_poly.Fracture();

    if (this.IsKnockout()) {
      // Enforce minimum margin: at least 10% of the smallest side of the barcode, rounded up
      // to the nearest 0.1 mm. Use this as a lower bound for both axes.
      const minSide = Math.min(this.m_width, this.m_height);
      const tenPercent = Math.trunc((minSide + 9) / 10); // ceil(minSide * 0.1)
      const step01mm = Math.max(1, pcbIUScale.mmToIU(0.1));
      const tenPercentRounded = Math.trunc((tenPercent + step01mm - 1) / step01mm) * step01mm;

      // Build inversion rectangle based on the local bbox of the current combined geometry
      const bbox = this.m_poly.BBox();
      bbox.Inflate(
        Math.max(this.m_margin.x, tenPercentRounded),
        Math.max(this.m_margin.y, tenPercentRounded),
      );

      const rect = new SHAPE_LINE_CHAIN();
      rect.Append(bbox.GetLeft(), bbox.GetTop());
      rect.Append(bbox.GetRight(), bbox.GetTop());
      rect.Append(bbox.GetRight(), bbox.GetBottom());
      rect.Append(bbox.GetLeft(), bbox.GetBottom());
      rect.SetClosed(true);

      const ko = new SHAPE_POLY_SET();
      ko.AddOutline(rect);
      ko.BooleanSubtract(this.m_poly);
      ko.Fracture();
      this.m_poly = ko;
    }

    if (this.IsSideSpecific() && this.GetBoard() && this.GetBoard()!.IsBackLayer(this.m_layer))
      this.m_poly.Mirror(this.m_pos, FLIP_DIRECTION.LEFT_RIGHT);

    if (!this.m_angle.IsZero()) this.m_poly.Rotate(this.m_angle, this.m_pos);

    this.m_poly.CacheTriangulation(false);
    this.m_bbox = this.m_poly.BBox();
  }

  /**
   * Generate the internal polygon representation for the human-readable text.
   */
  ComputeTextPoly(): void {
    this.m_textPoly.RemoveAllContours();

    if (!this.m_text.IsVisible()) return;

    const textPoly = new SHAPE_POLY_SET();
    this.m_text.TransformTextToPolySet(textPoly, 0, this.GetMaxError(), ERROR_LOC.ERROR_INSIDE);

    if (textPoly.OutlineCount() === 0) return;

    if (this.m_symbolPoly.OutlineCount() === 0) return;

    const textBBox = textPoly.BBox();
    const symbolBBox = this.m_symbolPoly.BBox();

    const textPos: VECTOR2I = { x: 0, y: 0 };
    const textOffset = pcbIUScale.mmToIU(1);
    textPos.x = symbolBBox.GetCenter().x - textBBox.GetCenter().x;
    textPos.y = symbolBBox.GetBottom() - textBBox.GetTop() + textOffset;

    textPoly.Move(textPos);

    this.m_textPoly = textPoly;
    this.m_textPoly.CacheTriangulation();
  }

  /**
   * Generate the internal polygon representation for the current barcode text, kind and error correction.
   *
   * This uses the Zint backend to encode the text and populate @c m_symbolPoly.
   */
  ComputeBarcode(): void {
    this.m_symbolPoly.RemoveAllContours();
    this.m_lastError = '';

    const text = this.GetShownText();

    if (text.length === 0) return;

    // The kind/ECC options, the ECI for non-ASCII QR / Data Matrix text and the error
    // messages are encodeBarcode's (barcode/zint.ts: ZBarcode_Encode's surface).
    const result = encodeBarcode(KIND_NAMES[this.m_kind], ECC_NAMES[this.m_errorCorrection], text);

    if (!result.symbol) {
      this.m_lastError = result.error;
      return;
    }

    const { rects, scale } = vectorRectangles(result.symbol);

    for (const rect of rects) {
      // Round using absolute edges to avoid cumulative rounding drift across modules.
      const x1 = KiROUND(rect.x * scale);
      const x2 = KiROUND((rect.x + rect.width) * scale);
      const y1 = KiROUND(rect.y * scale);
      const y2 = KiROUND((rect.y + rect.height) * scale);

      const shapeline = new SHAPE_LINE_CHAIN();
      shapeline.Append(x1, y1);
      shapeline.Append(x2, y1);
      shapeline.Append(x2, y2);
      shapeline.Append(x1, y2);
      shapeline.SetClosed(true);

      this.m_symbolPoly.AddOutline(shapeline);
    }

    // The hexagon loop is MaxiCode's, which none of BARCODE_T's five produce.

    // Set the position of the barcode to the center of the symbol polygon
    if (this.m_symbolPoly.OutlineCount() > 0) {
      const pos = this.m_symbolPoly.BBox().GetCenter();
      this.m_symbolPoly.Move({ x: -pos.x, y: -pos.y });
    }

    this.m_symbolPoly.CacheTriangulation();
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    const parentFP = this.GetParentFootprint();

    if (parentFP && aFrame.GetName() === PCB_EDIT_FRAME_NAME)
      aList.push(new MSG_PANEL_ITEM('Footprint', parentFP.GetReference()));

    // Don't use GetShownText() here; we want to show the user the variable references
    aList.push(new MSG_PANEL_ITEM('Text', KIUI_EllipsizeStatusText(aFrame, this.GetText())));

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME && this.IsLocked())
      aList.push(new MSG_PANEL_ITEM('Status', 'Locked'));

    aList.push(new MSG_PANEL_ITEM('Layer', this.GetLayerName()));
    aList.push(new MSG_PANEL_ITEM('Angle', `${this.m_angle.AsDegrees()}`));
    aList.push(
      new MSG_PANEL_ITEM('Text Height', aFrame.MessageTextFromValue(this.m_text.GetTextHeight())),
    );
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) {
      const arect = a.Clone();
      arect.Inflate(c ?? 0);

      const rect = this.GetBoundingBox();

      if (c) rect.Inflate(c);

      if (b as boolean) return arect.Contains(rect);

      return arect.Intersects(rect);
    }

    if (a instanceof SHAPE_LINE_CHAIN)
      // Not overridden for a chain in C++: BOARD_ITEM's default.
      return super.HitTest(a, b as boolean);

    const aAccuracy = (b as number | undefined) ?? 0;

    if (!this.GetBoundingBox().Contains(a)) return false;

    const hulls = new SHAPE_POLY_SET();
    this.GetBoundingHull(
      hulls,
      PCB_LAYER_ID.UNDEFINED_LAYER,
      aAccuracy,
      ARC_LOW_DEF,
      ERROR_LOC.ERROR_OUTSIDE,
    );

    return hulls.Collide(a);
  }

  /**
   * Set the bounding rectangle of the barcode. This will scale the internal polygon outlines
   * to fit the given rectangle and update width/height accordingly.  This refers to
   * the size of the barcode symbol excluding margins and text.
   */
  SetRect(aTopLeft: VECTOR2I, aBotRight: VECTOR2I): void {
    // Rescale only the symbol polygon to the requested rectangle; text is rebuilt below
    const bbox = this.m_symbolPoly.BBox();
    const oldW = bbox.GetWidth();
    const oldH = bbox.GetHeight();

    const newPosition = divideI(add(aTopLeft, aBotRight), 2);
    this.SetPosition(newPosition);

    let newW = aBotRight.x - aTopLeft.x;
    let newH = aBotRight.y - aTopLeft.y;

    // Guard against zero/negative sizes from interactive edits; enforce a tiny minimum
    const minIU = Math.max(1, pcbIUScale.mmToIU(0.01));
    newW = Math.max(newW, minIU);
    newH = Math.max(newH, minIU);

    const scaleX = oldW ? newW / oldW : 1.0;
    const scaleY = oldH ? newH / oldH : 1.0;

    const oldCenter = bbox.GetCenter();
    this.m_symbolPoly.Scale(scaleX, scaleY, oldCenter);

    // After scaling, move the symbol polygon to be centered at the new position
    const newCenter = this.m_symbolPoly.BBox().GetCenter();
    const delta = sub(newPosition, newCenter);

    if (!equal(delta, { x: 0, y: 0 })) this.m_symbolPoly.Move(delta);

    // Update intended barcode symbol size (without text/margins)
    this.m_width = newW;
    this.m_height = newH;
  }

  GetClass(): string {
    return 'BARCODE';
  }

  // Virtual function
  override GetBoundingBox(): BOX2I {
    return this.m_bbox.Clone();
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Barcode '${this.GetText()}' on ${this.GetLayerName()}`;
  }

  override GetMenuImage(): string {
    return 'add_barcode'; // BITMAPS::add_barcode
  }

  override ViewBBox(): BOX2I {
    return this.m_bbox.Clone();
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    // Hide the locked shadow when the barcode's own layer is not shown
    if (aLayer === GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW && !aView!.IsLayerVisible(this.m_layer))
      return PCB_BARCODE.LOD_HIDE;

    return PCB_BARCODE.LOD_SHOW;
  }

  /**
   * Convert the barcode (text + symbol shapes) to polygonal geometry suitable for filling/collision tests.
   */
  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC = ERROR_LOC.ERROR_INSIDE,
    ignoreLineWidth = false,
  ): void {
    if (aLayer !== this.m_layer && aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER) return;

    if (aClearance === 0) {
      aBuffer.Append(this.m_poly);
    } else {
      const poly = new SHAPE_POLY_SET(this.m_poly);
      poly.Inflate(aClearance, CornerStrategy.CHAMFER_ACUTE_CORNERS, aMaxError);
      aBuffer.Append(poly);
    }
  }

  // @copydoc BOARD_ITEM::GetEffectiveShape
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    const poly = new SHAPE_POLY_SET();
    this.TransformShapeToPolygon(poly, aLayer, 0, 0, ERROR_LOC.ERROR_INSIDE, true);
    return poly;
  }

  /*
   * Add two rectangular polygons separately bounding the barcode's symbol and the barcode's text.
   */
  GetBoundingHull(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC = ERROR_LOC.ERROR_INSIDE,
  ): void {
    const getBoundingHull = (
      aLocBuffer: SHAPE_POLY_SET,
      aSource: SHAPE_POLY_SET,
      aLocClearance: number,
    ): void => {
      const rect = aSource.BBox(aLocClearance);
      const corners: VECTOR2I[] = [
        { x: rect.GetOrigin().x, y: rect.GetOrigin().y },
        { x: rect.GetRight(), y: rect.GetOrigin().y },
        { x: rect.GetRight(), y: rect.GetBottom() },
        { x: rect.GetOrigin().x, y: rect.GetBottom() },
      ];

      aLocBuffer.NewOutline();

      for (const corner of corners) {
        const rotated = RotatePoint(corner, this.m_pos, this.m_angle);
        aLocBuffer.Append(rotated.x, rotated.y);
      }
    };

    if (aLayer === this.m_layer || aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      getBoundingHull(aBuffer, this.m_symbolPoly, aClearance);
      getBoundingHull(aBuffer, this.m_textPoly, aClearance);
    }
  }

  /**
   * Set the error correction level used for QR codes.
   */
  SetErrorCorrection(aErrorCorrection: BARCODE_ECC_T): void {
    // Micro QR codes do not support High (H) error correction level
    if (this.m_kind === BARCODE_T.MICRO_QR_CODE && aErrorCorrection === BARCODE_ECC_T.H)
      this.m_errorCorrection = BARCODE_ECC_T.Q;
    else this.m_errorCorrection = aErrorCorrection;

    // Don't auto-compute here as it may be called during loading
  }

  GetErrorCorrection(): BARCODE_ECC_T {
    return this.m_errorCorrection;
  }

  /**
   * Returns the type of the barcode (QR, CODE_39, etc.).
   */
  GetKind(): BARCODE_T {
    return this.m_kind;
  }

  SetKind(aKind: BARCODE_T): void {
    this.m_kind = aKind;

    // When switching to Micro QR, validate and adjust ECC if needed
    if (this.m_kind === BARCODE_T.MICRO_QR_CODE && this.m_errorCorrection === BARCODE_ECC_T.H)
      this.m_errorCorrection = BARCODE_ECC_T.Q;

    // Don't auto-compute here as it may be called during loading
  }

  KeepSquare(): boolean {
    return (
      this.m_kind === BARCODE_T.QR_CODE ||
      this.m_kind === BARCODE_T.MICRO_QR_CODE ||
      this.m_kind === BARCODE_T.DATA_MATRIX
    );
  }

  SetBarcodeErrorCorrection(aErrorCorrection: BARCODE_ECC_T): void {
    // Includes re-compute
    this.SetErrorCorrection(aErrorCorrection);
    this.AssembleBarcode();
  }

  SetBarcodeText(aText: string): void {
    this.SetText(aText);
    this.AssembleBarcode();
  }

  SetShowText(aShow: boolean): void {
    this.m_text.SetVisible(aShow);
    this.AssembleBarcode();
  }
  GetShowText(): boolean {
    return this.m_text.IsVisible();
  }

  SetBarcodeWidth(aWidth: number): void {
    this.m_width = aWidth;

    if (this.KeepSquare()) this.m_height = aWidth;

    this.AssembleBarcode();
  }

  SetBarcodeHeight(aHeight: number): void {
    this.m_height = aHeight;

    if (this.KeepSquare()) this.m_width = aHeight;

    this.AssembleBarcode();
  }

  SetBarcodeKind(aKind: BARCODE_T): void {
    // Includes re-compute
    this.SetKind(aKind);
    this.AssembleBarcode();
  }

  GetAngle(): EDA_ANGLE {
    return this.m_angle;
  }
  GetOrientation(): number {
    return this.m_angle.AsDegrees();
  }
  SetOrientation(aDegrees: number): void {
    const newAngle = new EDA_ANGLE(aDegrees, EDA_ANGLE_T.DEGREES_T);
    const oldAngle = this.m_angle;

    if (!newAngle.equals(oldAngle)) {
      this.Rotate(this.GetPosition(), newAngle.sub(oldAngle));
    }
  }

  GetMarginX(): number {
    return this.m_margin.x;
  }
  GetMarginY(): number {
    return this.m_margin.y;
  }
  SetMarginX(aX: number): void {
    aX = Math.max(pcbIUScale.mmToIU(1), aX);
    this.m_margin = { x: aX, y: this.m_margin.y };
    this.AssembleBarcode();
  }
  SetMarginY(aY: number): void {
    aY = Math.max(pcbIUScale.mmToIU(1), aY);
    this.m_margin = { x: this.m_margin.x, y: aY };
    this.AssembleBarcode();
  }

  override IsKnockout(): boolean {
    return BOARD_ITEM.prototype.IsKnockout.call(this);
  }
  override SetIsKnockout(aEnable: boolean): void {
    BOARD_ITEM.prototype.SetIsKnockout.call(this, aEnable);
    this.AssembleBarcode();
  }

  GetLastError(): string {
    return this.m_lastError;
  }

  override Clone(): PCB_BARCODE {
    const item = PCB_BARCODE.copyOf(this);
    item.CopyFrom(this);
    return item;
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    if (!(aImage && aImage.Type() === KICAD_T.PCB_BARCODE_T)) return; // wxCHECK_RET( "Cannot swap data with non-barcode item." )

    const other = aImage as PCB_BARCODE;

    // std::swap( *this, *other ): every member of both classes.
    const mine = PCB_BARCODE.copyOf(this);
    this.assignBarcode(other);
    (this as { m_Uuid: string }).m_Uuid = other.m_Uuid;
    other.assignBarcode(mine);
    (other as { m_Uuid: string }).m_Uuid = mine.m_Uuid;

    this.m_text.SetParent(this);
    other.m_text.SetParent(other);
  }

  /**
   * Compute a simple similarity score between this barcode and another board item.
   */
  Similarity(aItem: BOARD_ITEM): number {
    if (!PCB_BARCODE.ClassOf(aItem)) return 0.0;

    const other = aItem as PCB_BARCODE;

    // Compare text, width, height, text height, position, and kind
    let similarity = 0.0;
    const weight = 1.0 / 6.0;

    if (this.GetText() === other.GetText()) similarity += weight;

    if (this.m_width === other.m_width) similarity += weight;

    if (this.m_height === other.m_height) similarity += weight;

    if (this.GetTextSize() === other.GetTextSize()) similarity += weight;

    if (equal(this.GetPosition(), other.GetPosition())) similarity += weight;

    if (this.m_kind === other.m_kind) similarity += weight;

    return similarity;
  }

  static Compare(aBarcode: PCB_BARCODE, aOther: PCB_BARCODE): number {
    let diff: number;

    diff = aBarcode.GetPosition().x - aOther.GetPosition().x;
    if (diff !== 0) return diff;

    diff = aBarcode.GetPosition().y - aOther.GetPosition().y;
    if (diff !== 0) return diff;

    diff =
      aBarcode.GetText() < aOther.GetText() ? -1 : aBarcode.GetText() > aOther.GetText() ? 1 : 0; // wxString::Cmp
    if (diff !== 0) return diff;

    diff = aBarcode.GetWidth() - aOther.GetWidth();
    if (diff !== 0) return diff;

    diff = aBarcode.GetHeight() - aOther.GetHeight();
    if (diff !== 0) return diff;

    diff = aBarcode.GetTextSize() - aOther.GetTextSize();
    if (diff !== 0) return diff;

    diff = aBarcode.GetKind() - aOther.GetKind();
    if (diff !== 0) return diff;

    diff = aBarcode.m_angle.AsTenthsOfADegree() - aOther.m_angle.AsTenthsOfADegree();
    if (diff !== 0) return diff;

    diff = aBarcode.GetErrorCorrection() - aOther.GetErrorCorrection();
    if (diff !== 0) return diff;

    return 0;
  }

  /**
   * Equality comparison operator for board-level deduplication.
   */
  equals(aItem: BOARD_ITEM): boolean {
    if (!PCB_BARCODE.ClassOf(aItem)) return false;

    const other = aItem as PCB_BARCODE;

    return this.equalsBarcode(other);
  }

  /** `operator==( const PCB_BARCODE& )`. */
  equalsBarcode(aOther: PCB_BARCODE): boolean {
    // Compare text, width, height, text height, position, and kind
    return (
      this.GetText() === aOther.GetText() &&
      this.m_width === aOther.m_width &&
      this.m_height === aOther.m_height &&
      this.GetTextSize() === aOther.GetTextSize() &&
      equal(this.GetPosition(), aOther.GetPosition()) &&
      this.m_kind === aOther.m_kind
    );
  }
}
