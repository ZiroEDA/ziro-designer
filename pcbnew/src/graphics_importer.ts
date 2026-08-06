// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GRAPHICS_IMPORTER and GRAPHICS_IMPORTER_BUFFER, the half of the DXF/SVG
 * import path that is independent of the file format. Counterparts:
 * common/import_gfx/graphics_importer.{h,cpp} and
 * common/import_gfx/graphics_importer_buffer.{h,cpp}.
 *
 * A parser calls `AddLine`/`AddArc`/… with coordinates **in millimetres**; the
 * importer is what turns those into board items. Two things live here rather
 * than in a parser, and both are the reason this module exists at all.
 *
 * 1. The placement model. `m_scale` (the user's import ratio), `m_offsetCoordmm`
 *    (where on the board the drawing lands) and `m_millimeterToIu` compose into
 *    one factor, `ImportScalingFactor()`. Nothing else is allowed to scale: a
 *    parser that pre-multiplied its own coordinates would double-apply the
 *    user's ratio.
 *
 * 2. The buffer's `ImportTo`, which is the only place the whole drawing is
 *    visible at once. A DXF in metres or an SVG the size of a football pitch
 *    overflows KiCad's 32-bit internal units, and the *shape* of the guard is
 *    load-bearing: too-large is refused outright, a drawing that merely sits
 *    outside the coordinate range is recentred **only when the user has not
 *    chosen an offset**, and a user-chosen offset is nudged instead. Reordering
 *    those three branches changes which drawings import at all.
 *
 * The buffer exists because a parser cannot know the drawing's extent until it
 * has read the whole file, and because DXF blocks are read once and then
 * stamped out repeatedly by INSERT — hence `clone()` and `Transform` on every
 * shape.
 *
 * Faithfully reproduced oddities, none of which is to be "fixed":
 * `IMPORTED_ARC::GetBoundingBox` adds the stroke *width* to a point as a scalar
 * and then sweeps a rotation that is not a rotation, and its loop runs from 0
 * towards a positive angle only — a pcbnew-convention negative arc angle skips
 * it entirely; the too-large message quotes the **max** of the two candidate
 * scales, which for any non-square drawing is the one that still would not fit;
 * and `BOX2D::Merge( BOX2D )` treats an uninitialised argument as a zero-size
 * box at the origin whenever the receiver is initialised.
 */

import { LINE_STYLE, type Color4d } from './plot_dxf.js';
import type { PcbShape, PcbTextItem, StrokeType } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';

/** `COLOR4D::UNSPECIFIED`, the fully transparent black the importer treats as "no colour". */
export const COLOR4D_UNSPECIFIED: Color4d = { r: 0, g: 0, b: 0, a: 0 };

/** A point this module writes through. `Vec2` is deliberately read-only. */
type MutPoint = { x: number; y: number };

/** `std::numeric_limits<int>::max()`, the ceiling every board coordinate has to clear. */
const INT_MAX = 2147483647;
/** `std::numeric_limits<int>::min()`. */
const INT_MIN = -2147483648;

/**
 * `IMPORTED_STROKE` — a `STROKE_PARAMS` whose width is still floating point,
 * because it is in millimetres and has not met the internal-unit grid yet.
 *
 * A width of exactly -1 is the parsers' "no stroke at all"; any other
 * non-positive width means "use the importer's default". The two are not
 * interchangeable, see `GRAPHICS_IMPORTER_PCBNEW.MapStrokeParams`.
 */
export class IMPORTED_STROKE {
  constructor(
    private m_width = 0,
    private m_plotstyle: LINE_STYLE = LINE_STYLE.DEFAULT,
    private m_color: Color4d = COLOR4D_UNSPECIFIED,
  ) {}

  GetWidth(): number {
    return this.m_width;
  }
  SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }
  GetPlotStyle(): LINE_STYLE {
    return this.m_plotstyle;
  }
  SetPlotStyle(aPlotStyle: LINE_STYLE): void {
    this.m_plotstyle = aPlotStyle;
  }
  GetColor(): Color4d {
    return this.m_color;
  }
  SetColor(aColor: Color4d): void {
    this.m_color = aColor;
  }
}

/** `GRAPHICS_IMPORTER::POLY_FILL_RULE`. */
export enum POLY_FILL_RULE {
  PF_NONZERO = 0,
  PF_EVEN_ODD = 1,
}

/**
 * `MATRIX3x3D` reduced to what a DXF INSERT needs: rotate, scale and the
 * translation column. Row-major, so `m[row][col]` as upstream's `m_data` is.
 */
export type MATRIX3x3D = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/** The identity, upstream's default-constructed matrix with a 1 diagonal. */
export const matrixIdentity = (): MATRIX3x3D => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * `operator*( MATRIX3x3<T>, VECTOR2<T> )`.
 *
 * The third column is added unconditionally: a 2D vector is treated as a point
 * with an implied w of 1, so a matrix carrying a translation translates it.
 */
export const matrixMulVec2 = (m: MATRIX3x3D, v: Vec2): Vec2 => ({
  x: m[0][0] * v.x + m[0][1] * v.y + m[0][2],
  y: m[1][0] * v.x + m[1][1] * v.y + m[1][2],
});

/** `MATRIX3x3<T>::GetScale`: the diagonal, which is all a pure scale sets. */
export const matrixGetScale = (m: MATRIX3x3D): Vec2 => ({ x: m[0][0], y: m[1][1] });

/**
 * `BOX2D`, only as much of it as `ImportTo` uses.
 *
 * The `m_init` flag is the point: a default-constructed box is *not* the origin
 * with zero size, it is "no box yet", and merging into it adopts the merged
 * value outright. Without that, an import whose drawing lies away from the
 * origin would be measured from (0, 0) and judged too large.
 */
export class BOX2D {
  private m_pos: MutPoint = { x: 0, y: 0 };
  private m_size: MutPoint = { x: 0, y: 0 };
  private m_init = false;

  IsValid(): boolean {
    return this.m_init;
  }
  GetPosition(): Vec2 {
    return { ...this.m_pos };
  }
  GetOrigin(): Vec2 {
    return { ...this.m_pos };
  }
  GetSize(): Vec2 {
    return { ...this.m_size };
  }
  GetLeft(): number {
    return this.m_pos.x;
  }
  GetTop(): number {
    return this.m_pos.y;
  }
  GetRight(): number {
    return this.m_pos.x + this.m_size.x;
  }
  GetBottom(): number {
    return this.m_pos.y + this.m_size.y;
  }

  SetOrigin(x: number, y: number): void {
    this.m_pos = { x, y };
    this.m_init = true;
  }
  SetSize(x: number, y: number): void {
    this.m_size = { x, y };
    this.m_init = true;
  }
  private SetEnd(x: number, y: number): void {
    this.m_size = { x: x - this.m_pos.x, y: y - this.m_pos.y };
    this.m_init = true;
  }

  /** `BOX2::Normalize`: fold a negative extent back onto the position. */
  Normalize(): void {
    if (this.m_size.y < 0) {
      this.m_pos.y += this.m_size.y;
      this.m_size.y = -this.m_size.y;
    }
    if (this.m_size.x < 0) {
      this.m_pos.x += this.m_size.x;
      this.m_size.x = -this.m_size.x;
    }
  }

  /** `BOX2::Merge( const Vec& )`. */
  MergePoint(p: Vec2): this {
    if (!this.m_init) {
      this.m_pos = { ...p };
      this.m_size = { x: 0, y: 0 };
      this.m_init = true;
      return this;
    }

    this.Normalize();
    const end = { x: this.GetRight(), y: this.GetBottom() };
    this.m_pos.x = Math.min(this.m_pos.x, p.x);
    this.m_pos.y = Math.min(this.m_pos.y, p.y);
    this.SetEnd(Math.max(end.x, p.x), Math.max(end.y, p.y));
    return this;
  }

  /**
   * `BOX2::Merge( const BOX2& )`.
   *
   * The argument's init flag is consulted only when `this` has none of its
   * own — so merging an *invalid* box into a valid one stretches it to include
   * the origin, because an uninitialised box reads as zero-size at (0, 0).
   * `ImportTo` is written around that: it tests each shape's box itself.
   */
  MergeBox(other: BOX2D): this {
    if (!this.m_init) {
      if (other.m_init) {
        this.m_pos = other.GetPosition();
        this.m_size = other.GetSize();
        this.m_init = true;
      }
      return this;
    }

    this.Normalize();
    const rect = new BOX2D();
    rect.m_pos = other.GetPosition();
    rect.m_size = other.GetSize();
    rect.m_init = other.m_init;
    rect.Normalize();

    const end = { x: this.GetRight(), y: this.GetBottom() };
    const rectEnd = { x: rect.GetRight(), y: rect.GetBottom() };
    this.m_pos.x = Math.min(this.m_pos.x, rect.m_pos.x);
    this.m_pos.y = Math.min(this.m_pos.y, rect.m_pos.y);
    this.SetEnd(Math.max(end.x, rectEnd.x), Math.max(end.y, rectEnd.y));
    return this;
  }
}

/**
 * One board item the importer produced.
 *
 * KiCad's importer hands back `EDA_ITEM`s — `PCB_SHAPE` or `PCB_TEXT` — that
 * already know their parent container. Ours hands back the board model's plain
 * records, without a `source` node: whoever commits them (`addBoardShape`,
 * `addBoardText`) supplies that.
 */
export type IMPORTED_ITEM =
  | { type: 'shape'; shape: Omit<PcbShape, 'source'> }
  | { type: 'text'; text: Omit<PcbTextItem, 'source'> };

/**
 * `GRAPHICS_IMPORTER`, the interface a parser feeds and the placement model it
 * feeds through.
 *
 * Everything a parser passes in is millimetres in the *source* drawing's frame.
 * The conversion to board coordinates happens once, in the concrete importer's
 * `MapCoordinate`, out of `GetScale()`, `GetImportOffsetMM()` and
 * `GetMillimeterToIuFactor()` — in that order, because the offset is expressed
 * in millimetres of the *scaled* drawing.
 */
export abstract class GRAPHICS_IMPORTER {
  /** `DEFAULT_LINE_WIDTH_DFX`, in mm. Upstream's spelling of DXF, kept. */
  static readonly DEFAULT_LINE_WIDTH_DFX = 1;

  /** Factor to convert millimetres to internal units. */
  protected m_millimeterToIu = 1.0;
  /** Offset in mm added to imported coordinates. */
  protected m_offsetCoordmm: Vec2 = { x: 0, y: 0 };
  /** One entry per `NewShape` call, in call order. */
  protected m_shapeFillRules: POLY_FILL_RULE[] = [];

  private m_items: IMPORTED_ITEM[] = [];
  private m_scale: Vec2 = { x: 1.0, y: 1.0 };
  private m_lineWidth: number = GRAPHICS_IMPORTER.DEFAULT_LINE_WIDTH_DFX;

  /**
   * Messages about entities that could not be imported.
   *
   * Upstream forwards these to the plugin, which is the only thing that owns a
   * message list; no plugin is ported here, so the importer holds them itself.
   * The contract callers see is unchanged: every message ends in a newline.
   */
  private m_messages = '';

  ReportMsg(aMessage: string): void {
    this.m_messages += aMessage;
    this.m_messages += '\n';
  }

  GetMessages(): string {
    return this.m_messages;
  }

  SetLineWidthMM(aWidth: number): void {
    this.m_lineWidth = aWidth;
  }
  GetLineWidthMM(): number {
    return this.m_lineWidth;
  }

  GetScale(): Vec2 {
    return { ...this.m_scale };
  }
  SetScale(aScale: Vec2): void {
    this.m_scale = { ...aScale };
  }

  GetImportOffsetMM(): Vec2 {
    return { ...this.m_offsetCoordmm };
  }
  SetImportOffsetMM(aOffset: Vec2): void {
    this.m_offsetCoordmm = { ...aOffset };
  }

  GetMillimeterToIuFactor(): number {
    return this.m_millimeterToIu;
  }

  /** The single factor from source millimetres to board internal units. */
  ImportScalingFactor(): Vec2 {
    return { x: this.m_scale.x * this.m_millimeterToIu, y: this.m_scale.y * this.m_millimeterToIu };
  }

  GetItems(): IMPORTED_ITEM[] {
    return this.m_items;
  }
  ClearItems(): void {
    this.m_items = [];
  }

  /** Open a new source shape, recording the fill rule its sub-paths share. */
  NewShape(aFillRule: POLY_FILL_RULE = POLY_FILL_RULE.PF_NONZERO): void {
    this.m_shapeFillRules.push(aFillRule);
  }

  /** Whether shapes from a given source-format layer should be imported. */
  // biome-ignore lint/correctness/noUnusedFunctionParameters: upstream's base takes and ignores it
  CanImportSourceLayer(aSourceLayer: string): boolean {
    return true;
  }

  /** Set the source-format layer the next buffered shape came from. */
  // biome-ignore lint/correctness/noUnusedFunctionParameters: upstream's base takes and ignores it
  SetCurrentSourceLayer(aSourceLayer: string): void {}

  protected addItem(aItem: IMPORTED_ITEM): void {
    this.m_items.push(aItem);
  }

  abstract AddLine(aOrigin: Vec2, aEnd: Vec2, aStroke: IMPORTED_STROKE): void;

  abstract AddCircle(
    aCenter: Vec2,
    aRadius: number,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d,
  ): void;

  abstract AddArc(aCenter: Vec2, aStart: Vec2, aAngle: EDA_ANGLE, aStroke: IMPORTED_STROKE): void;

  abstract AddPolygon(
    aVertices: Vec2[],
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d,
  ): void;

  abstract AddText(
    aOrigin: Vec2,
    aText: string,
    aHeight: number,
    aWidth: number,
    aThickness: number,
    aOrientation: number,
    aHJustify: GR_TEXT_H_ALIGN_T,
    aVJustify: GR_TEXT_V_ALIGN_T,
    aColor: Color4d,
  ): void;

  abstract AddSpline(
    aStart: Vec2,
    aBezierControl1: Vec2,
    aBezierControl2: Vec2,
    aEnd: Vec2,
    aStroke: IMPORTED_STROKE,
  ): void;
}

/**
 * `IMPORTED_SHAPE`, one buffered entity.
 *
 * `clone` and `Transform` are what let a DXF block be read once and placed many
 * times; `GetBoundingBox` is consulted only by `ImportTo`, before any of the
 * shapes have been converted to internal units.
 */
export abstract class IMPORTED_SHAPE {
  protected m_parentShapeIndex = -1;
  protected m_sourceLayer = '';

  abstract ImportTo(aImporter: GRAPHICS_IMPORTER): void;
  abstract clone(): IMPORTED_SHAPE;
  abstract Transform(aTransform: MATRIX3x3D, aTranslation: Vec2): void;
  abstract GetBoundingBox(): BOX2D;

  SetParentShapeIndex(aIndex: number): void {
    this.m_parentShapeIndex = aIndex;
  }
  GetParentShapeIndex(): number {
    return this.m_parentShapeIndex;
  }
  SetSourceLayer(aSourceLayer: string): void {
    this.m_sourceLayer = aSourceLayer;
  }
  GetSourceLayer(): string {
    return this.m_sourceLayer;
  }

  /** Copy the bookkeeping every `clone()` has to carry across. */
  protected copyMetaTo(aOther: IMPORTED_SHAPE): IMPORTED_SHAPE {
    aOther.m_parentShapeIndex = this.m_parentShapeIndex;
    aOther.m_sourceLayer = this.m_sourceLayer;
    return aOther;
  }
}

export class IMPORTED_LINE extends IMPORTED_SHAPE {
  constructor(
    private m_start: Vec2,
    private m_end: Vec2,
    private m_stroke: IMPORTED_STROKE,
  ) {
    super();
  }

  ImportTo(aImporter: GRAPHICS_IMPORTER): void {
    aImporter.AddLine(this.m_start, this.m_end, this.m_stroke);
  }

  clone(): IMPORTED_SHAPE {
    return this.copyMetaTo(
      new IMPORTED_LINE({ ...this.m_start }, { ...this.m_end }, this.m_stroke),
    );
  }

  Transform(aTransform: MATRIX3x3D, aTranslation: Vec2): void {
    this.m_start = addVec(matrixMulVec2(aTransform, this.m_start), aTranslation);
    this.m_end = addVec(matrixMulVec2(aTransform, this.m_end), aTranslation);
  }

  GetBoundingBox(): BOX2D {
    return new BOX2D().MergePoint(this.m_start).MergePoint(this.m_end);
  }
}

export class IMPORTED_CIRCLE extends IMPORTED_SHAPE {
  constructor(
    private m_center: Vec2,
    private m_radius: number,
    private m_stroke: IMPORTED_STROKE,
    private m_filled: boolean,
    private m_fillColor: Color4d,
  ) {
    super();
  }

  ImportTo(aImporter: GRAPHICS_IMPORTER): void {
    aImporter.AddCircle(
      this.m_center,
      this.m_radius,
      this.m_stroke,
      this.m_filled,
      this.m_fillColor,
    );
  }

  clone(): IMPORTED_SHAPE {
    return this.copyMetaTo(
      new IMPORTED_CIRCLE(
        { ...this.m_center },
        this.m_radius,
        this.m_stroke,
        this.m_filled,
        this.m_fillColor,
      ),
    );
  }

  /**
   * A transformed circle stays a circle: the radius travels as a vector along
   * +X, so a non-uniform scale gives it the *horizontal* factor and the shape
   * silently stops matching the source. Upstream's simplification, kept.
   */
  Transform(aTransform: MATRIX3x3D, aTranslation: Vec2): void {
    const newCenter = addVec(matrixMulVec2(aTransform, this.m_center), aTranslation);
    const newRadius = matrixMulVec2(aTransform, { x: this.m_radius, y: 0 });

    this.m_center = newCenter;
    this.m_radius = Math.hypot(newRadius.x, newRadius.y);
  }

  GetBoundingBox(): BOX2D {
    return new BOX2D()
      .MergePoint({ x: this.m_center.x - this.m_radius, y: this.m_center.y - this.m_radius })
      .MergePoint({ x: this.m_center.x + this.m_radius, y: this.m_center.y + this.m_radius });
  }
}

export class IMPORTED_ARC extends IMPORTED_SHAPE {
  constructor(
    private m_center: Vec2,
    private m_start: Vec2,
    private m_angle: EDA_ANGLE,
    private m_stroke: IMPORTED_STROKE,
  ) {
    super();
  }

  ImportTo(aImporter: GRAPHICS_IMPORTER): void {
    aImporter.AddArc(this.m_center, this.m_start, this.m_angle, this.m_stroke);
  }

  clone(): IMPORTED_SHAPE {
    return this.copyMetaTo(
      new IMPORTED_ARC({ ...this.m_center }, { ...this.m_start }, this.m_angle, this.m_stroke),
    );
  }

  Transform(aTransform: MATRIX3x3D, aTranslation: Vec2): void {
    this.m_start = addVec(matrixMulVec2(aTransform, this.m_start), aTranslation);
    this.m_center = addVec(matrixMulVec2(aTransform, this.m_center), aTranslation);
  }

  /**
   * Upstream's, verbatim, and it is not the arc's bounding box: the stroke
   * width is added to a point as a scalar, the sweep adds the centre to the
   * start rather than subtracting it, and the sampled point mixes a rotation
   * with a reflection. The loop counts *up* from zero, so the negative angles
   * pcbnew arcs normally carry never enter it at all.
   */
  GetBoundingBox(): BOX2D {
    const box = new BOX2D();
    const w = this.m_stroke.GetWidth();

    box.MergePoint({ x: this.m_start.x + w, y: this.m_start.y + w });
    box.MergePoint({ x: this.m_start.x - w, y: this.m_start.y - w });

    for (let angle = 0; angle < this.m_angle.AsDegrees(); angle += 5) {
      const ang = new EDA_ANGLE(angle);
      const start = addVec(this.m_center, this.m_start);
      box.MergePoint({
        x: start.x * ang.Cos() + start.y * ang.Sin(),
        y: start.x * ang.Sin() - start.y * ang.Cos(),
      });
    }

    return box;
  }
}

export class IMPORTED_POLYGON extends IMPORTED_SHAPE {
  constructor(
    private m_vertices: Vec2[],
    private m_stroke: IMPORTED_STROKE,
    private m_filled: boolean,
    private m_fillColor: Color4d,
  ) {
    super();
  }

  ImportTo(aImporter: GRAPHICS_IMPORTER): void {
    aImporter.AddPolygon(this.m_vertices, this.m_stroke, this.m_filled, this.m_fillColor);
  }

  clone(): IMPORTED_SHAPE {
    return this.copyMetaTo(
      new IMPORTED_POLYGON(
        this.m_vertices.map((v) => ({ ...v })),
        this.m_stroke,
        this.m_filled,
        this.m_fillColor,
      ),
    );
  }

  Transform(aTransform: MATRIX3x3D, aTranslation: Vec2): void {
    this.m_vertices = this.m_vertices.map((v) =>
      addVec(matrixMulVec2(aTransform, v), aTranslation),
    );
  }

  Vertices(): Vec2[] {
    return this.m_vertices;
  }
  IsFilled(): boolean {
    return this.m_filled;
  }
  GetFillColor(): Color4d {
    return this.m_fillColor;
  }
  GetStroke(): IMPORTED_STROKE {
    return this.m_stroke;
  }

  GetBoundingBox(): BOX2D {
    const box = new BOX2D();
    for (const vert of this.m_vertices) box.MergePoint(vert);
    return box;
  }
}

export class IMPORTED_TEXT extends IMPORTED_SHAPE {
  constructor(
    private m_origin: Vec2,
    private m_text: string,
    private m_height: number,
    private m_width: number,
    private m_thickness: number,
    private m_orientation: number,
    private m_hJustify: GR_TEXT_H_ALIGN_T,
    private m_vJustify: GR_TEXT_V_ALIGN_T,
    private m_color: Color4d,
  ) {
    super();
  }

  ImportTo(aImporter: GRAPHICS_IMPORTER): void {
    aImporter.AddText(
      this.m_origin,
      this.m_text,
      this.m_height,
      this.m_width,
      this.m_thickness,
      this.m_orientation,
      this.m_hJustify,
      this.m_vJustify,
      this.m_color,
    );
  }

  clone(): IMPORTED_SHAPE {
    return this.copyMetaTo(
      new IMPORTED_TEXT(
        { ...this.m_origin },
        this.m_text,
        this.m_height,
        this.m_width,
        this.m_thickness,
        this.m_orientation,
        this.m_hJustify,
        this.m_vJustify,
        this.m_color,
      ),
    );
  }

  /**
   * The glyph box is transformed as a *vector*, so the translation column of a
   * block placement stretches the text as well as moving it. Upstream's.
   */
  Transform(aTransform: MATRIX3x3D, aTranslation: Vec2): void {
    this.m_origin = addVec(matrixMulVec2(aTransform, this.m_origin), aTranslation);

    const textSize = matrixMulVec2(aTransform, { x: this.m_width, y: this.m_height });
    this.m_width = textSize.x;
    this.m_height = textSize.y;
  }

  GetBoundingBox(): BOX2D {
    return new BOX2D().MergePoint(this.m_origin).MergePoint({
      x: this.m_origin.x + this.m_width * this.m_text.length,
      y: this.m_origin.y + this.m_height,
    });
  }
}

export class IMPORTED_SPLINE extends IMPORTED_SHAPE {
  constructor(
    private m_start: Vec2,
    private m_bezierControl1: Vec2,
    private m_bezierControl2: Vec2,
    private m_end: Vec2,
    private m_stroke: IMPORTED_STROKE,
  ) {
    super();
  }

  ImportTo(aImporter: GRAPHICS_IMPORTER): void {
    aImporter.AddSpline(
      this.m_start,
      this.m_bezierControl1,
      this.m_bezierControl2,
      this.m_end,
      this.m_stroke,
    );
  }

  clone(): IMPORTED_SHAPE {
    return this.copyMetaTo(
      new IMPORTED_SPLINE(
        { ...this.m_start },
        { ...this.m_bezierControl1 },
        { ...this.m_bezierControl2 },
        { ...this.m_end },
        this.m_stroke,
      ),
    );
  }

  Transform(aTransform: MATRIX3x3D, aTranslation: Vec2): void {
    this.m_start = addVec(matrixMulVec2(aTransform, this.m_start), aTranslation);
    this.m_bezierControl1 = addVec(matrixMulVec2(aTransform, this.m_bezierControl1), aTranslation);
    this.m_bezierControl2 = addVec(matrixMulVec2(aTransform, this.m_bezierControl2), aTranslation);
    this.m_end = addVec(matrixMulVec2(aTransform, this.m_end), aTranslation);
  }

  /** Only the endpoints, so a curve that bulges outside them measures short. */
  GetBoundingBox(): BOX2D {
    return new BOX2D().MergePoint(this.m_start).MergePoint(this.m_end);
  }
}

/**
 * `GRAPHICS_IMPORTER_BUFFER`: an importer that records instead of converting,
 * then replays into a real one.
 *
 * Every parser writes here first. That is what makes the whole-drawing checks
 * in `ImportTo` possible, and it is what a DXF BLOCK is stored in so that each
 * INSERT can clone and transform it.
 */
export class GRAPHICS_IMPORTER_BUFFER extends GRAPHICS_IMPORTER {
  protected m_shapes: IMPORTED_SHAPE[] = [];
  protected m_currentSourceLayer = '';

  override SetCurrentSourceLayer(aSourceLayer: string): void {
    this.m_currentSourceLayer = aSourceLayer;
  }
  GetCurrentSourceLayer(): string {
    return this.m_currentSourceLayer;
  }

  private push(aShape: IMPORTED_SHAPE): IMPORTED_SHAPE {
    this.m_shapes.push(aShape);
    aShape.SetSourceLayer(this.m_currentSourceLayer);
    return aShape;
  }

  AddLine(aStart: Vec2, aEnd: Vec2, aStroke: IMPORTED_STROKE): void {
    this.push(new IMPORTED_LINE(aStart, aEnd, aStroke));
  }

  AddCircle(
    aCenter: Vec2,
    aRadius: number,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    this.push(new IMPORTED_CIRCLE(aCenter, aRadius, aStroke, aFilled, aFillColor));
  }

  AddArc(aCenter: Vec2, aStart: Vec2, aAngle: EDA_ANGLE, aStroke: IMPORTED_STROKE): void {
    this.push(new IMPORTED_ARC(aCenter, aStart, aAngle, aStroke));
  }

  /**
   * The parent index is `NewShape` calls so far, minus one — so a polygon that
   * arrives before any `NewShape` gets -1, which is exactly the "not part of a
   * nested shape" marker. Upstream reaches the same -1 by unsigned underflow.
   */
  AddPolygon(
    aVertices: Vec2[],
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const shape = this.push(new IMPORTED_POLYGON(aVertices, aStroke, aFilled, aFillColor));
    shape.SetParentShapeIndex(this.m_shapeFillRules.length - 1);
  }

  AddText(
    aOrigin: Vec2,
    aText: string,
    aHeight: number,
    aWidth: number,
    aThickness: number,
    aOrientation: number,
    aHJustify: GR_TEXT_H_ALIGN_T,
    aVJustify: GR_TEXT_V_ALIGN_T,
    aColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    this.push(
      new IMPORTED_TEXT(
        aOrigin,
        aText,
        aHeight,
        aWidth,
        aThickness,
        aOrientation,
        aHJustify,
        aVJustify,
        aColor,
      ),
    );
  }

  AddSpline(
    aStart: Vec2,
    aBezierControl1: Vec2,
    aBezierControl2: Vec2,
    aEnd: Vec2,
    aStroke: IMPORTED_STROKE,
  ): void {
    this.push(new IMPORTED_SPLINE(aStart, aBezierControl1, aBezierControl2, aEnd, aStroke));
  }

  /**
   * File a shape built elsewhere — a DXF block instance, already transformed.
   *
   * A shape that already knows its source layer keeps it; only an unlabelled
   * one inherits the buffer's current layer.
   */
  AddShape(aShape: IMPORTED_SHAPE): void {
    if (aShape.GetSourceLayer() === '') aShape.SetSourceLayer(this.m_currentSourceLayer);

    this.m_shapes.push(aShape);
  }

  GetShapes(): IMPORTED_SHAPE[] {
    return this.m_shapes;
  }
  ClearShapes(): void {
    this.m_shapes = [];
  }

  /** Every distinct source-format layer seen, in first-appearance order. */
  GetSourceLayers(): string[] {
    const sourceLayers: string[] = [];

    for (const shape of this.m_shapes) {
      const sourceLayer = shape.GetSourceLayer();

      if (sourceLayer === '') continue;
      if (!sourceLayers.includes(sourceLayer)) sourceLayers.push(sourceLayer);
    }

    return sourceLayers;
  }

  /**
   * Replay the buffer into a real importer, having first checked the drawing
   * fits in 32-bit board coordinates.
   *
   * The three outcomes are mutually exclusive and ordered:
   *
   *  - the *scaled* drawing is wider or taller than the coordinate range: give
   *    up, and report the largest scale that would have worked;
   *  - the user never chose an offset, and the drawing lies outside the range:
   *    move it so its top-left corner is the origin;
   *  - the user did choose an offset, and it pushes the drawing out of range:
   *    walk the offset back by exactly as much as overflows, and say so.
   *
   * The middle branch tests the drawing's *edges*, not its size, so a small
   * drawing at huge coordinates is recentred while a small one near the origin
   * is left alone — the offset the user did not set stays unset.
   */
  ImportTo(aImporter: GRAPHICS_IMPORTER): void {
    let boundingBox = new BOX2D();

    for (const shape of this.m_shapes) {
      if (!aImporter.CanImportSourceLayer(shape.GetSourceLayer())) continue;

      const box = shape.GetBoundingBox();

      if (box.IsValid()) boundingBox = boundingBox.MergeBox(box);
    }

    if (!boundingBox.IsValid()) return;

    const scale = aImporter.GetScale();
    boundingBox.SetOrigin(
      boundingBox.GetPosition().x * scale.x,
      boundingBox.GetPosition().y * scale.y,
    );
    boundingBox.SetSize(boundingBox.GetSize().x * scale.x, boundingBox.GetSize().y * scale.y);

    const iuFactor = aImporter.GetMillimeterToIuFactor();
    const size = boundingBox.GetSize();

    if (size.x * iuFactor > INT_MAX || size.y * iuFactor > INT_MAX) {
      const scale_factor = INT_MAX / (iuFactor + 100);
      const max_scale = Math.max(scale_factor / size.x, scale_factor / size.y);
      aImporter.ReportMsg(`Imported graphic is too large. Maximum scale is ${fmtF(max_scale)}`);
      return;
    } else if (aImporter.GetImportOffsetMM().x === 0 && aImporter.GetImportOffsetMM().y === 0) {
      if (
        boundingBox.GetRight() * iuFactor > INT_MAX ||
        boundingBox.GetBottom() * iuFactor > INT_MAX ||
        boundingBox.GetLeft() * iuFactor < INT_MIN ||
        boundingBox.GetTop() * iuFactor < INT_MIN
      ) {
        const offset = boundingBox.GetOrigin();
        aImporter.SetImportOffsetMM({ x: -offset.x, y: -offset.y });
      }
    } else {
      const total_scale_x = scale.x * iuFactor;
      const total_scale_y = scale.y * iuFactor;

      const max_offset_x =
        (aImporter.GetImportOffsetMM().x + boundingBox.GetRight()) * total_scale_x;
      const max_offset_y =
        (aImporter.GetImportOffsetMM().y + boundingBox.GetBottom()) * total_scale_y;
      const min_offset_x =
        (aImporter.GetImportOffsetMM().x + boundingBox.GetLeft()) * total_scale_x;
      const min_offset_y = (aImporter.GetImportOffsetMM().y + boundingBox.GetTop()) * total_scale_y;

      const newOffset: MutPoint = { ...aImporter.GetImportOffsetMM() };
      let needsAdjustment = false;

      if (max_offset_x >= INT_MAX) {
        newOffset.x -= (max_offset_x - INT_MAX + 100.0) / total_scale_x;
        needsAdjustment = true;
      } else if (min_offset_x <= INT_MIN) {
        newOffset.x -= (min_offset_x - INT_MIN - 100) / total_scale_x;
        needsAdjustment = true;
      }

      if (max_offset_y >= INT_MAX) {
        newOffset.y -= (max_offset_y - INT_MAX + 100) / total_scale_y;
        needsAdjustment = true;
      } else if (min_offset_y <= INT_MIN) {
        newOffset.y -= (min_offset_y - INT_MIN - 100) / total_scale_y;
        needsAdjustment = true;
      }

      if (needsAdjustment) {
        aImporter.ReportMsg(
          `Import offset adjusted to (${fmtF(newOffset.x)}, ${fmtF(newOffset.y)}) to fit within numeric limits`,
        );
        aImporter.SetImportOffsetMM(newOffset);
      }
    }

    for (const shape of this.m_shapes) {
      if (!aImporter.CanImportSourceLayer(shape.GetSourceLayer())) continue;

      aImporter.SetCurrentSourceLayer(shape.GetSourceLayer());
      shape.ImportTo(aImporter);
    }

    aImporter.SetCurrentSourceLayer('');
  }
}

/** `wxString::Format`'s `%f`: six decimals, always. */
const fmtF = (v: number): string => v.toFixed(6);

const addVec = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

/** `LINE_STYLE` as the board file spells it. */
export function lineStyleToStrokeType(aStyle: LINE_STYLE): StrokeType {
  switch (aStyle) {
    case LINE_STYLE.DEFAULT:
      return 'default';
    case LINE_STYLE.SOLID:
      return 'solid';
    case LINE_STYLE.DASH:
      return 'dash';
    case LINE_STYLE.DOT:
      return 'dot';
    case LINE_STYLE.DASHDOT:
      return 'dash_dot';
    case LINE_STYLE.DASHDOTDOT:
      return 'dash_dot_dot';
  }
}
