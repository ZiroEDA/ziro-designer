// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eda_shape.h` / `common/eda_shape.cpp`: `EDA_SHAPE`, the graphic-shape
 * geometry shared by board and schematic items. KiCad mixes it into
 * `PCB_SHAPE` and `SCH_SHAPE` beside their item base; see `applyMixins`. A
 * derived constructor calls `initEdaShape( aType, aLineWidth, aFill )`.
 *
 * `EDA_SHAPE_DESC` (the properties-manager registration) is the properties
 * panel's, which the panel port carries.
 *
 * The C++ `protected`/`private` members are public here: the mix-in reaches
 * its host through declaration merging (`interface PCB_X extends Omit<EDA_SHAPE,
 * …>`), and a mapped type carries only public members.
 */

import { longest_common_subset } from '@ziroeda/core/src/kicad_algo.js';
import { type FLIP_DIRECTION, MIRROR } from '@ziroeda/core/src/mirror.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_270,
  ANGLE_360,
  ANGLE_45,
  ANGLE_90,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { ROUNDRECT } from '@ziroeda/kimath/src/geometry/roundrect.js';
import type { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { type SHAPE, SHAPE_TYPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  CornerStrategy,
  SHAPE_POLY_SET,
  TransformArcToPolygon,
  TransformCircleToPolygon,
  TransformOvalToPolygon,
  TransformRingToPolygon,
  TransformRoundChamferedRectToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { INT_MAX, KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  Distance,
  EuclideanNormI,
  type Vec2,
  type VECTOR2I,
  divideI,
} from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcCenterI, RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { type Color4d, COLOR4D_UNSPECIFIED } from './color4d.js';
import { messageTextFromAngle } from './eda_units.js';
import { LINE_STYLE, STROKE_PARAMS } from './stroke_params.js';
import type { UNITS_PROVIDER } from './units_provider.js';
import { MSG_PANEL_ITEM } from './widgets/msgpanel.js';

export enum SHAPE_T {
  UNDEFINED = -1,
  SEGMENT = 0,
  RECTANGLE = 1, ///< Use RECTANGLE instead of RECT to avoid collision in a Windows header.
  ARC = 2,
  CIRCLE = 3,
  POLY = 4,
  BEZIER = 5,
}

// WARNING: Do not change these values without updating dialogs that depend on their position values
export enum FILL_T {
  NO_FILL = 1,
  FILLED_SHAPE = 2, ///< Fill with object color.
  FILLED_WITH_BG_BODYCOLOR = 3, //< Fill with background body color.
  FILLED_WITH_COLOR = 4, //< Fill with a separate color.
  HATCH = 5,
  REVERSE_HATCH = 6,
  CROSS_HATCH = 7,
}

export enum UI_FILL_MODE {
  NONE = 0,
  SOLID = 1,
  HATCH = 2,
  REVERSE_HATCH = 3,
  CROSS_HATCH = 4,
}

/**
 * The file tokens of `UI_FILL_MODE`, in its order; `color` is what the
 * s-expression calls FILLED_WITH_COLOR, whose UI name is "Solid".
 */
export const FILL_MODE_TOKENS = ['none', 'color', 'hatch', 'reverse_hatch', 'cross_hatch'] as const;

/** `ENUM_MAP<UI_FILL_MODE>`'s `_HKI` names, in UI_FILL_MODE order. */
export const FILL_MODE_NAMES = ['None', 'Solid', 'Hatch', 'Reverse Hatch', 'Cross-hatch'] as const;

/// Holding struct to keep originating midpoint
export interface ARC_MID {
  mid: VECTOR2I;
  start: VECTOR2I;
  end: VECTOR2I;
  center: VECTOR2I;
}

export interface EDA_SHAPE_HATCH_CACHE_DATA {
  hatching: SHAPE_POLY_SET;
  hatchLines: SEG[];
}

const V = (x: number, y: number): VECTOR2I => ({ x, y });
const copy = (p: Vec2): VECTOR2I => ({ x: p.x, y: p.y });
const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const sameColor = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
const emptyArcMid = (): ARC_MID => ({
  mid: V(0, 0),
  start: V(0, 0),
  end: V(0, 0),
  center: V(0, 0),
});

/** `UNIMPLEMENTED_FOR( x )`: `wxFAIL_MSG`, a debug assertion; nothing in a release build. */
function UNIMPLEMENTED_FOR(aName: string): void {}

/**
 * `EDA_SHAPE::CalcArcAngles` over the three points: arc start and end angles
 * such that aStartAngle < aEndAngle. Each may be between -360.0 and 360.0.
 * A zero difference is a full circle, not a null arc.
 */
export function CalcArcAngles(aStart: Vec2, aEnd: Vec2, aCenter: Vec2): [EDA_ANGLE, EDA_ANGLE] {
  const startRadial = { x: aStart.x - aCenter.x, y: aStart.y - aCenter.y };
  const endRadial = { x: aEnd.x - aCenter.x, y: aEnd.y - aCenter.y };

  const aStartAngle = EDA_ANGLE.fromVector(startRadial);
  let aEndAngle = EDA_ANGLE.fromVector(endRadial);

  if (aEndAngle.equals(aStartAngle)) aEndAngle = aStartAngle.add(ANGLE_360); // ring, not null

  while (aEndAngle.lt(aStartAngle)) aEndAngle = aEndAngle.add(ANGLE_360);

  return [aStartAngle, aEndAngle];
}

/**
 * `EDA_SHAPE::GetArcAngle()` over the three points: `CalcArcAngles`, then
 * their difference.
 */
export function GetArcAngle(start: Vec2, end: Vec2, center: Vec2): EDA_ANGLE {
  const [startAngle, endAngle] = CalcArcAngles(start, end, center);
  return endAngle.sub(startAngle);
}

export abstract class EDA_SHAPE {
  m_endsSwapped!: boolean; // true if start/end were swapped e.g. SetArcAngleAndEnd
  m_shape!: SHAPE_T; // Shape: line, Circle, Arc
  m_stroke!: STROKE_PARAMS; // Line style, width, etc.
  m_fill!: FILL_T;
  m_fillColor!: Color4d;

  m_hatchingCache!: EDA_SHAPE_HATCH_CACHE_DATA | null;
  m_hatchingDirty!: boolean;

  m_rectangleHeight!: number;
  m_rectangleWidth!: number;
  m_cornerRadius!: number;

  m_start!: VECTOR2I; // Line start point or Circle center
  m_end!: VECTOR2I; // Line end point or Circle 3 o'clock point
  m_arcCenter!: VECTOR2I; // Used only for Arcs: arc end point
  m_arcMidData!: ARC_MID; // Used to store originating data

  m_bezierC1!: VECTOR2I; // Bezier Control Point 1
  m_bezierC2!: VECTOR2I; // Bezier Control Point 2
  m_bezierPoints!: VECTOR2I[];
  m_poly!: SHAPE_POLY_SET | null; // Stores the S_POLYGON shape

  m_editState!: number;
  m_proxyItem!: boolean; // A shape storing proxy information (ie: a pad
  //   number box, thermal spoke template, etc.)

  /** `EDA_SHAPE( SHAPE_T aType, int aLineWidth, FILL_T aFill )`: the mixin's constructor. */
  initEdaShape(aType: SHAPE_T, aLineWidth: number, aFill: FILL_T): void {
    this.m_endsSwapped = false;
    this.m_shape = aType;
    this.m_stroke = new STROKE_PARAMS(aLineWidth, LINE_STYLE.DEFAULT, COLOR4D_UNSPECIFIED);
    this.m_fill = aFill;
    this.m_fillColor = { ...COLOR4D_UNSPECIFIED };
    this.m_hatchingCache = null;
    this.m_hatchingDirty = true;
    this.m_rectangleHeight = 0;
    this.m_rectangleWidth = 0;
    this.m_cornerRadius = 0;
    this.m_start = V(0, 0);
    this.m_end = V(0, 0);
    this.m_arcCenter = V(0, 0);
    this.m_arcMidData = emptyArcMid();
    this.m_bezierC1 = V(0, 0);
    this.m_bezierC2 = V(0, 0);
    this.m_bezierPoints = [];
    this.m_poly = null;
    this.m_editState = 0;
    this.m_proxyItem = false;
  }

  /// Construct an EDA_SHAPE from an abstract SHAPE geometry.
  initEdaShapeFromShape(aShape: SHAPE): void {
    this.initEdaShape(SHAPE_T.UNDEFINED, 0, FILL_T.NO_FILL);
    // `m_fill()`: value-initialised, i.e. 0, which is no FILL_T member
    this.m_fill = 0 as FILL_T;

    switch (aShape.Type()) {
      case SHAPE_TYPE.SH_RECT: {
        const rect = aShape as SHAPE_RECT;
        this.m_shape = SHAPE_T.RECTANGLE;
        this.SetStart(rect.GetPosition());
        this.SetEnd({
          x: rect.GetPosition().x + rect.GetSize().x,
          y: rect.GetPosition().y + rect.GetSize().y,
        });
        break;
      }

      case SHAPE_TYPE.SH_SEGMENT: {
        const seg = aShape as SHAPE_SEGMENT;
        this.m_shape = SHAPE_T.SEGMENT;
        this.SetStart(seg.GetSeg().A);
        this.SetEnd(seg.GetSeg().B);
        this.SetWidth(seg.GetWidth());
        break;
      }

      case SHAPE_TYPE.SH_LINE_CHAIN: {
        const line = aShape as SHAPE_LINE_CHAIN;
        this.m_shape = SHAPE_T.POLY;
        this.m_poly = new SHAPE_POLY_SET();
        this.GetPolyShape().AddOutline(line);
        this.SetWidth(line.Width());
        break;
      }

      case SHAPE_TYPE.SH_CIRCLE: {
        const circle = aShape as SHAPE_CIRCLE;
        this.m_shape = SHAPE_T.CIRCLE;
        this.SetStart(circle.GetCenter());
        // `circle.GetCenter() + circle.GetRadius()`: the scalar adds to both components
        this.SetEnd({
          x: circle.GetCenter().x + circle.GetRadius(),
          y: circle.GetCenter().y + circle.GetRadius(),
        });
        break;
      }

      case SHAPE_TYPE.SH_ARC: {
        const arc = aShape as SHAPE_ARC;
        this.m_shape = SHAPE_T.ARC;
        this.SetArcGeometry(arc.GetP0(), arc.GetArcMid(), arc.GetP1());
        this.SetWidth(arc.GetWidth());
        break;
      }

      case SHAPE_TYPE.SH_SIMPLE: {
        const poly = aShape as SHAPE_SIMPLE;
        this.m_shape = SHAPE_T.POLY;
        poly.TransformToPolygon(this.GetPolyShape(), 0, ERROR_LOC.ERROR_INSIDE);
        break;
      }

      // currently unhandled
      case SHAPE_TYPE.SH_POLY_SET:
      case SHAPE_TYPE.SH_COMPOUND:
      case SHAPE_TYPE.SH_NULL:
      case SHAPE_TYPE.SH_POLY_SET_TRIANGLE:
      default:
        this.m_shape = SHAPE_T.UNDEFINED;
        break;
    }
  }

  /** `EDA_SHAPE( const EDA_SHAPE& aOther )`: the copy constructor, as an init. */
  initEdaShapeFrom(aOther: EDA_SHAPE): void {
    this.m_endsSwapped = aOther.m_endsSwapped;
    this.m_shape = aOther.m_shape;
    this.m_stroke = aOther.m_stroke.clone();
    this.m_fill = aOther.m_fill;
    this.m_fillColor = { ...aOther.m_fillColor };
    this.m_hatchingCache = null;
    this.m_hatchingDirty = true;
    this.m_rectangleHeight = aOther.m_rectangleHeight;
    this.m_rectangleWidth = aOther.m_rectangleWidth;
    this.m_cornerRadius = aOther.m_cornerRadius;
    this.m_start = copy(aOther.m_start);
    this.m_end = copy(aOther.m_end);
    this.m_arcCenter = copy(aOther.m_arcCenter);
    this.m_arcMidData = {
      mid: copy(aOther.m_arcMidData.mid),
      start: copy(aOther.m_arcMidData.start),
      end: copy(aOther.m_arcMidData.end),
      center: copy(aOther.m_arcMidData.center),
    };
    this.m_bezierC1 = copy(aOther.m_bezierC1);
    this.m_bezierC2 = copy(aOther.m_bezierC2);
    this.m_bezierPoints = aOther.m_bezierPoints.map(copy);
    this.m_editState = aOther.m_editState;
    this.m_proxyItem = aOther.m_proxyItem;

    this.m_poly = aOther.m_poly ? new SHAPE_POLY_SET(aOther.m_poly) : null;
  }

  /** `operator=`. */
  assignEdaShape(aOther: EDA_SHAPE): this {
    if (this === aOther) return this;

    this.m_endsSwapped = aOther.m_endsSwapped;
    this.m_shape = aOther.m_shape;
    this.m_stroke = aOther.m_stroke.clone();
    this.m_fill = aOther.m_fill;
    this.m_fillColor = { ...aOther.m_fillColor };
    this.m_hatchingCache = null;
    this.m_hatchingDirty = true;
    this.m_rectangleHeight = aOther.m_rectangleHeight;
    this.m_rectangleWidth = aOther.m_rectangleWidth;
    this.m_cornerRadius = aOther.m_cornerRadius;
    this.m_start = copy(aOther.m_start);
    this.m_end = copy(aOther.m_end);
    this.m_arcCenter = copy(aOther.m_arcCenter);
    this.m_arcMidData = {
      mid: copy(aOther.m_arcMidData.mid),
      start: copy(aOther.m_arcMidData.start),
      end: copy(aOther.m_arcMidData.end),
      center: copy(aOther.m_arcMidData.center),
    };
    this.m_bezierC1 = copy(aOther.m_bezierC1);
    this.m_bezierC2 = copy(aOther.m_bezierC2);
    this.m_bezierPoints = aOther.m_bezierPoints.map(copy);
    if (aOther.m_poly) this.m_poly = new SHAPE_POLY_SET(aOther.m_poly);
    else this.m_poly = null;
    this.m_editState = aOther.m_editState;
    this.m_proxyItem = aOther.m_proxyItem;

    return this;
  }

  SwapShape(aImage: EDA_SHAPE): void {
    const image = aImage;

    // `#define SWAPITEM( x ) std::swap( x, image->x )`
    [this.m_stroke, image.m_stroke] = [image.m_stroke, this.m_stroke];
    [this.m_start, image.m_start] = [image.m_start, this.m_start];
    [this.m_end, image.m_end] = [image.m_end, this.m_end];
    [this.m_arcCenter, image.m_arcCenter] = [image.m_arcCenter, this.m_arcCenter];
    [this.m_shape, image.m_shape] = [image.m_shape, this.m_shape];
    [this.m_bezierC1, image.m_bezierC1] = [image.m_bezierC1, this.m_bezierC1];
    [this.m_bezierC2, image.m_bezierC2] = [image.m_bezierC2, this.m_bezierC2];
    [this.m_bezierPoints, image.m_bezierPoints] = [image.m_bezierPoints, this.m_bezierPoints];
    [this.m_poly, image.m_poly] = [image.m_poly, this.m_poly];
    [this.m_cornerRadius, image.m_cornerRadius] = [image.m_cornerRadius, this.m_cornerRadius];
    [this.m_fill, image.m_fill] = [image.m_fill, this.m_fill];
    [this.m_fillColor, image.m_fillColor] = [image.m_fillColor, this.m_fillColor];
    [this.m_editState, image.m_editState] = [image.m_editState, this.m_editState];
    [this.m_endsSwapped, image.m_endsSwapped] = [image.m_endsSwapped, this.m_endsSwapped];

    this.m_hatchingDirty = true;
  }

  ShowShape(): string {
    if (this.IsProxyItem()) {
      switch (this.m_shape) {
        case SHAPE_T.SEGMENT:
          return 'Thermal Spoke';
        case SHAPE_T.RECTANGLE:
          return 'Number Box';
        default:
          return '??';
      }
    }

    switch (this.m_shape) {
      case SHAPE_T.SEGMENT:
        return 'Line';
      case SHAPE_T.RECTANGLE:
        return 'Rect';
      case SHAPE_T.ARC:
        return 'Arc';
      case SHAPE_T.CIRCLE:
        return 'Circle';
      case SHAPE_T.BEZIER:
        return 'Bezier Curve';
      case SHAPE_T.POLY:
        return 'Polygon';
      default:
        return '??';
    }
  }

  SHAPE_T_asString(): string {
    switch (this.m_shape) {
      case SHAPE_T.SEGMENT:
        return 'S_SEGMENT';
      case SHAPE_T.RECTANGLE:
        return 'S_RECT';
      case SHAPE_T.ARC:
        return 'S_ARC';
      case SHAPE_T.CIRCLE:
        return 'S_CIRCLE';
      case SHAPE_T.POLY:
        return 'S_POLYGON';
      case SHAPE_T.BEZIER:
        return 'S_CURVE';
      case SHAPE_T.UNDEFINED:
        return 'UNDEFINED';
    }

    return ''; // Just to quiet GCC.
  }

  IsProxyItem(): boolean {
    return this.m_proxyItem;
  }
  SetIsProxyItem(aIsProxy = true): void {
    this.m_proxyItem = aIsProxy;
  }

  IsAnyFill(): boolean {
    return this.GetFillMode() !== FILL_T.NO_FILL;
  }

  IsSolidFill(): boolean {
    return (
      this.GetFillMode() === FILL_T.FILLED_SHAPE ||
      this.GetFillMode() === FILL_T.FILLED_WITH_COLOR ||
      this.GetFillMode() === FILL_T.FILLED_WITH_BG_BODYCOLOR
    );
  }

  IsHatchedFill(): boolean {
    return (
      this.GetFillMode() === FILL_T.HATCH ||
      this.GetFillMode() === FILL_T.REVERSE_HATCH ||
      this.GetFillMode() === FILL_T.CROSS_HATCH
    );
  }

  IsFilledForHitTesting(): boolean {
    return this.IsSolidFill();
  }

  SetFilled(aFlag: boolean): void {
    this.setFilled(aFlag);
  }

  SetFillMode(aFill: FILL_T): void {
    this.m_fill = aFill;
    this.m_hatchingDirty = true;
  }
  GetFillMode(): FILL_T {
    return this.m_fill;
  }

  SetFillModeProp(aFill: UI_FILL_MODE): void {
    switch (aFill) {
      case UI_FILL_MODE.NONE:
        this.SetFillMode(FILL_T.NO_FILL);
        break;
      case UI_FILL_MODE.HATCH:
        this.SetFillMode(FILL_T.HATCH);
        break;
      case UI_FILL_MODE.REVERSE_HATCH:
        this.SetFillMode(FILL_T.REVERSE_HATCH);
        break;
      case UI_FILL_MODE.CROSS_HATCH:
        this.SetFillMode(FILL_T.CROSS_HATCH);
        break;
      default:
        this.SetFilled(true);
        break;
    }
  }

  GetFillModeProp(): UI_FILL_MODE {
    switch (this.m_fill) {
      case FILL_T.NO_FILL:
        return UI_FILL_MODE.NONE;
      case FILL_T.HATCH:
        return UI_FILL_MODE.HATCH;
      case FILL_T.REVERSE_HATCH:
        return UI_FILL_MODE.REVERSE_HATCH;
      case FILL_T.CROSS_HATCH:
        return UI_FILL_MODE.CROSS_HATCH;
      default:
        return UI_FILL_MODE.SOLID;
    }
  }

  SetHatchingDirty(): void {
    this.m_hatchingDirty = true;
  }

  GetHatching(): SHAPE_POLY_SET {
    if (!this.m_hatchingCache)
      this.m_hatchingCache = { hatching: new SHAPE_POLY_SET(), hatchLines: [] };

    return this.m_hatchingCache.hatching;
  }

  GetHatchLines(): readonly SEG[] {
    if (!this.m_hatchingCache)
      this.m_hatchingCache = { hatching: new SHAPE_POLY_SET(), hatchLines: [] };

    return this.m_hatchingCache.hatchLines;
  }

  IsClosed(): boolean {
    switch (this.m_shape) {
      case SHAPE_T.CIRCLE:
      case SHAPE_T.RECTANGLE:
        return true;

      case SHAPE_T.ARC:
      case SHAPE_T.SEGMENT:
        return false;

      case SHAPE_T.POLY:
        if (this.GetPolyShape().IsEmpty()) return false;
        return this.GetPolyShape().Outline(0).IsClosed();

      case SHAPE_T.BEZIER:
        if (this.m_bezierPoints.length < 3) return false;
        return samePoint(
          this.m_bezierPoints[0]!,
          this.m_bezierPoints[this.m_bezierPoints.length - 1]!,
        );

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return false;
    }
  }

  GetFillColor(): Color4d {
    return this.m_fillColor;
  }
  SetFillColor(aColor: Color4d): void {
    this.m_fillColor = { ...aColor };
  }

  SetWidth(aWidth: number): void {
    this.m_stroke.SetWidth(aWidth);
    this.m_hatchingDirty = true;
  }

  GetWidth(): number {
    return this.m_stroke.GetWidth();
  }
  GetEffectiveWidth(): number {
    return this.GetWidth();
  }
  GetHatchLineWidth(): number {
    return this.GetEffectiveWidth();
  }
  GetHatchLineSpacing(): number {
    return this.GetHatchLineWidth() * 10;
  }

  SetLineStyle(aStyle: LINE_STYLE): void {
    this.m_stroke.SetLineStyle(aStyle);
  }

  GetLineStyle(): LINE_STYLE {
    if (this.m_stroke.GetLineStyle() !== LINE_STYLE.DEFAULT) return this.m_stroke.GetLineStyle();

    return LINE_STYLE.SOLID;
  }

  SetLineColor(aColor: Color4d): void {
    this.m_stroke.SetColor(aColor);
  }
  GetLineColor(): Color4d {
    return this.m_stroke.GetColor();
  }

  SetShape(aShape: SHAPE_T): void {
    this.m_shape = aShape;
  }
  GetShape(): SHAPE_T {
    return this.m_shape;
  }

  /**
   * Return the starting point of the graphic.
   */
  GetStart(): VECTOR2I {
    return this.m_start;
  }
  GetStartY(): number {
    return this.m_start.y;
  }
  GetStartX(): number {
    return this.m_start.x;
  }

  SetStart(aStart: Vec2): void {
    this.m_start = copy(aStart);
    this.m_endsSwapped = false;
    this.m_hatchingDirty = true;
  }

  SetStartY(y: number): void {
    this.m_start.y = y;
    this.m_endsSwapped = false;
    this.m_hatchingDirty = true;
  }

  SetStartX(x: number): void {
    this.m_start.x = x;
    this.m_endsSwapped = false;
    this.m_hatchingDirty = true;
  }

  SetCenterY(y: number): void {
    this.m_end.y += y - this.m_start.y;
    this.m_start.y = y;
    this.m_hatchingDirty = true;
  }

  SetCenterX(x: number): void {
    this.m_end.x += x - this.m_start.x;
    this.m_start.x = x;
    this.m_hatchingDirty = true;
  }

  /**
   * Return the ending point of the graphic.
   */
  GetEnd(): VECTOR2I {
    return this.m_end;
  }
  GetEndY(): number {
    return this.m_end.y;
  }
  GetEndX(): number {
    return this.m_end.x;
  }

  SetEnd(aEnd: Vec2): void {
    this.m_end = copy(aEnd);
    this.m_endsSwapped = false;
    this.m_hatchingDirty = true;
  }

  SetEndY(aY: number): void {
    this.m_end.y = aY;
    this.m_endsSwapped = false;
    this.m_hatchingDirty = true;
  }

  SetEndX(aX: number): void {
    this.m_end.x = aX;
    this.m_endsSwapped = false;
    this.m_hatchingDirty = true;
  }

  SetRadius(aX: number): void {
    this.m_end = { x: this.m_start.x + aX, y: this.m_start.y };
    this.m_hatchingDirty = true;
  }

  GetTopLeft(): VECTOR2I {
    return this.GetStart();
  }
  GetBotRight(): VECTOR2I {
    return this.GetEnd();
  }

  SetTop(val: number): void {
    this.SetStartY(val);
  }
  SetLeft(val: number): void {
    this.SetStartX(val);
  }
  SetRight(val: number): void {
    this.SetEndX(val);
  }
  SetBottom(val: number): void {
    this.SetEndY(val);
  }

  SetBezierC1(aPt: Vec2): void {
    this.m_bezierC1 = copy(aPt);
  }
  GetBezierC1(): VECTOR2I {
    return this.m_bezierC1;
  }

  SetBezierC2(aPt: Vec2): void {
    this.m_bezierC2 = copy(aPt);
  }
  GetBezierC2(): VECTOR2I {
    return this.m_bezierC2;
  }

  getCenter(): VECTOR2I {
    switch (this.m_shape) {
      case SHAPE_T.ARC:
        return this.m_arcCenter;

      case SHAPE_T.CIRCLE:
        return this.m_start;

      case SHAPE_T.SEGMENT:
        // Midpoint of the line
        return divideI({ x: this.m_start.x + this.m_end.x, y: this.m_start.y + this.m_end.y }, 2);

      case SHAPE_T.POLY:
      case SHAPE_T.RECTANGLE:
      case SHAPE_T.BEZIER:
        return this.getBoundingBox().Centre();

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return V(0, 0);
    }
  }

  SetCenter(aCenter: Vec2): void {
    switch (this.m_shape) {
      case SHAPE_T.ARC:
        this.m_arcCenter = copy(aCenter);
        break;

      case SHAPE_T.CIRCLE:
        this.m_start = copy(aCenter);
        this.m_hatchingDirty = true;
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    }
  }

  /**
   * Set the end point from the angle center and start.
   *
   * aAngle is:
   * - clockwise in right-down coordinate system
   * - counter-clockwise in right-up (libedit) coordinate system.
   */
  SetArcAngleAndEnd(aAngle: EDA_ANGLE, aCheckNegativeAngle = false): void {
    const angle = aAngle.Clone();

    this.m_end = copy(this.m_start);
    this.m_end = RotatePoint(this.m_end, this.m_arcCenter, angle.Normalize720().negate());

    if (aCheckNegativeAngle && aAngle.lt(ANGLE_0)) {
      const t = this.m_start;
      this.m_start = this.m_end;
      this.m_end = t;
      this.m_endsSwapped = true;
    }
  }

  GetArcAngle(): EDA_ANGLE {
    const [startAngle, endAngle] = this.CalcArcAngles();

    return endAngle.sub(startAngle);
  }

  GetSegmentAngle(): EDA_ANGLE {
    const angle = new EDA_ANGLE(
      Math.atan2(this.GetStart().y - this.GetEnd().y, this.GetEnd().x - this.GetStart().x),
      EDA_ANGLE_T.RADIANS_T,
    );

    return angle;
  }

  /**
   * Have the start and end points been swapped since they were set?
   *
   * @return true if they have.
   */
  EndsSwapped(): boolean {
    return this.m_endsSwapped;
  }

  // Some attributes are read only, since they are derived from m_Start, m_End, and m_Angle.
  // No Set...() function for these attributes.

  GetArcMid(): VECTOR2I {
    // If none of the input data have changed since we loaded the arc, keep the original mid point data
    // to minimize churn
    if (
      samePoint(this.m_arcMidData.start, this.m_start) &&
      samePoint(this.m_arcMidData.end, this.m_end) &&
      samePoint(this.m_arcMidData.center, this.m_arcCenter)
    )
      return this.m_arcMidData.mid;

    let mid = copy(this.m_start);
    mid = RotatePoint(mid, this.m_arcCenter, this.GetArcAngle().divide(2.0).negate());
    return mid;
  }

  GetRectCorners(): VECTOR2I[] {
    const pts: VECTOR2I[] = [];
    const topLeft = this.GetStart();
    const botRight = this.GetEnd();

    pts.push(copy(topLeft));
    pts.push(V(botRight.x, topLeft.y));
    pts.push(copy(botRight));
    pts.push(V(topLeft.x, botRight.y));

    return pts;
  }

  GetCornersInSequence(aAngle: EDA_ANGLE): VECTOR2I[] {
    const pts: VECTOR2I[] = [];

    const angle = aAngle.Clone().Normalize();

    const bbox = this.getBoundingBox();
    bbox.Normalize();

    if (angle.IsCardinal()) {
      if (angle.equals(ANGLE_0)) {
        pts.push(V(bbox.GetLeft(), bbox.GetTop()));
        pts.push(V(bbox.GetRight(), bbox.GetTop()));
        pts.push(V(bbox.GetRight(), bbox.GetBottom()));
        pts.push(V(bbox.GetLeft(), bbox.GetBottom()));
      } else if (angle.equals(ANGLE_90)) {
        pts.push(V(bbox.GetLeft(), bbox.GetBottom()));
        pts.push(V(bbox.GetLeft(), bbox.GetTop()));
        pts.push(V(bbox.GetRight(), bbox.GetTop()));
        pts.push(V(bbox.GetRight(), bbox.GetBottom()));
      } else if (angle.equals(ANGLE_180)) {
        pts.push(V(bbox.GetRight(), bbox.GetBottom()));
        pts.push(V(bbox.GetLeft(), bbox.GetBottom()));
        pts.push(V(bbox.GetLeft(), bbox.GetTop()));
        pts.push(V(bbox.GetRight(), bbox.GetTop()));
      } else if (angle.equals(ANGLE_270)) {
        pts.push(V(bbox.GetRight(), bbox.GetTop()));
        pts.push(V(bbox.GetRight(), bbox.GetBottom()));
        pts.push(V(bbox.GetLeft(), bbox.GetBottom()));
        pts.push(V(bbox.GetLeft(), bbox.GetTop()));
      }
    } else {
      // This function was originally located in pcb_textbox.cpp and was later moved to eda_shape.cpp.
      // As a result of this move, access to getCorners was lost, since it is defined in the PCB_SHAPE
      // class within pcb_shape.cpp and is not available in the current context.
      //
      // Additionally, GetRectCorners() cannot be used here, as it assumes the rectangle is rotated by
      // a cardinal angle. In non-cardinal cases, it returns incorrect values (e.g., (0, 0)).
      //
      // To address this, a portion of the getCorners implementation for SHAPE_T::POLY elements
      // has been replicated here to restore the correct behavior.
      const corners: VECTOR2I[] = [];

      for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
        for (const pt of this.GetPolyShape().Outline(ii).CPoints()) corners.push(copy(pt));
      }

      while (corners.length < 4) {
        const back = corners[corners.length - 1]!;
        corners.push(V(back.x + 10, back.y + 10));
      }

      let minX = corners[0]!;
      let maxX = corners[0]!;
      let minY = corners[0]!;
      let maxY = corners[0]!;

      for (const corner of corners) {
        if (corner.x < minX.x) minX = corner;

        if (corner.x > maxX.x) maxX = corner;

        if (corner.y < minY.y) minY = corner;

        if (corner.y > maxY.y) maxY = corner;
      }

      if (angle.lt(ANGLE_90)) {
        pts.push(minX);
        pts.push(minY);
        pts.push(maxX);
        pts.push(maxY);
      } else if (angle.lt(ANGLE_180)) {
        pts.push(maxY);
        pts.push(minX);
        pts.push(minY);
        pts.push(maxX);
      } else if (angle.lt(ANGLE_270)) {
        pts.push(maxX);
        pts.push(maxY);
        pts.push(minX);
        pts.push(minY);
      } else {
        pts.push(minY);
        pts.push(maxX);
        pts.push(maxY);
        pts.push(minX);
      }
    }

    return pts;
  }

  /**
   * Calc arc start and end angles such that aStartAngle < aEndAngle.  Each may be between
   * -360.0 and 360.0.
   */
  CalcArcAngles(): [EDA_ANGLE, EDA_ANGLE] {
    return CalcArcAngles(this.GetStart(), this.GetEnd(), this.getCenter());
  }

  GetRadius(): number {
    let radius = 0.0;

    switch (this.m_shape) {
      case SHAPE_T.ARC:
        radius = Distance(this.m_arcCenter, this.m_start);
        break;

      case SHAPE_T.CIRCLE:
        radius = Distance(this.m_start, this.m_end);
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    }

    // don't allow degenerate circles/arcs
    if (radius > INT_MAX / 2.0) radius = INT_MAX / 2.0;

    return Math.max(1, KiROUND(radius));
  }

  /**
   * Set the three controlling points for an arc.
   *
   * NB: these are NOT what's currently stored, so we have to do some calculations behind
   * the scenes.  However, they are what SHOULD be stored.
   */
  SetArcGeometry(aStart: Vec2, aMid: Vec2, aEnd: Vec2): void {
    this.m_arcMidData = emptyArcMid();
    this.m_start = copy(aStart);
    this.m_end = copy(aEnd);
    this.m_arcCenter = CalcArcCenterI(this.m_start, copy(aMid), this.m_end);
    const new_mid = this.GetArcMid();

    this.m_endsSwapped = false;

    // Watch the ordering here.  GetArcMid above needs to be called prior to initializing the
    // m_arcMidData structure in order to ensure we get the calculated variant, not the cached
    this.SetCachedArcData(aStart, aMid, aEnd, this.m_arcCenter);

    /*
     * If the input winding doesn't match our internal winding, the calculated midpoint will end
     * up on the other side of the arc.  In this case, we need to flip the start/end points and
     * flag this change for the system.
     */
    const dist = { x: new_mid.x - aMid.x, y: new_mid.y - aMid.y };
    const dist2 = { x: new_mid.x - this.m_arcCenter.x, y: new_mid.y - this.m_arcCenter.y };

    if (dist.x * dist.x + dist.y * dist.y > dist2.x * dist2.x + dist2.y * dist2.y) {
      const t = this.m_start;
      this.m_start = this.m_end;
      this.m_end = t;
      this.m_endsSwapped = true;
    }
  }

  /**
   * Set the data used for mid point caching.
   *
   * If the controlling points remain constant, then we keep the midpoint the same as it was
   * when read in.  This minimizes VCS churn.
   *
   * @param aStart Cached start point.
   * @param aMid Cached mid point.
   * @param aEnd Cached end point.
   * @param aCenter Calculated center point using the preceeding three.
   */
  SetCachedArcData(aStart: Vec2, aMid: Vec2, aEnd: Vec2, aCenter: Vec2): void {
    this.m_arcMidData.start = copy(aStart);
    this.m_arcMidData.end = copy(aEnd);
    this.m_arcMidData.center = copy(aCenter);
    this.m_arcMidData.mid = copy(aMid);
  }

  GetBezierPoints(): readonly VECTOR2I[] {
    return this.m_bezierPoints;
  }

  /**
   * Duplicate the polygon outlines into a flat list of VECTOR2I points.
   *
   * Outlines (and holes) are appended in order; primarily intended for legacy
   * callers that expect explicit point buffers rather than SHAPE objects.
   */
  GetPolyPoints(): VECTOR2I[] {
    const points: VECTOR2I[] = [];

    for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
      const outline = this.GetPolyShape().COutline(ii);
      const pointCount = outline.PointCount();

      if (pointCount) {
        for (const pt of outline.CPoints()) points.push(copy(pt));
      }
    }

    return points;
  }

  /**
   * @return the number of corners of the polygonal shape.
   */
  GetPointCount(): number {
    // return the number of corners of the polygonal shape
    // this shape is expected to be only one polygon without hole
    return this.GetPolyShape().OutlineCount() ? this.GetPolyShape().VertexCount(0) : 0;
  }

  GetPolyShape(): SHAPE_POLY_SET {
    if (!this.m_poly) this.m_poly = new SHAPE_POLY_SET();

    return this.m_poly;
  }

  /**
   * @return true if the polygonal shape is valid (has more than 2 points).
   */
  IsPolyShapeValid(): boolean {
    // return true if the polygonal shape is valid (has more than 2 points)
    return (
      this.GetPolyShape().OutlineCount() > 0 && this.GetPolyShape().Outline(0).PointCount() > 2
    );
  }

  SetPolyShape(aShape: SHAPE_POLY_SET): void {
    this.GetPolyShape().assign(aShape);
    for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
      if (this.GetPolyShape().HoleCount(ii)) {
        this.GetPolyShape().Fracture();
        break;
      }
    }
  }

  SetPolyPoints(aPoints: readonly Vec2[]): void {
    this.GetPolyShape().RemoveAllContours();
    this.GetPolyShape().NewOutline();

    for (const p of aPoints) this.GetPolyShape().Append(p.x, p.y);
  }

  /**
   * Rebuild the m_bezierPoints vertex list that approximate the Bezier curve by a list of
   * segments.
   *
   * Has meaning only for #BEZIER shape.
   *
   * @param aMinSegLen is the max deviation between the polyline and the curve.
   */
  RebuildBezierToSegmentsPointsList(aMaxError: number): void {
    // Has meaning only for SHAPE_T::BEZIER
    if (this.m_shape !== SHAPE_T.BEZIER) {
      this.m_bezierPoints = [];
      return;
    }

    // Rebuild the m_BezierPoints vertex list that approximate the Bezier curve
    this.m_bezierPoints = this.buildBezierToSegmentsPointsList(aMaxError);
  }

  /**
   * Make a set of SHAPE objects representing the #EDA_SHAPE.
   *
   * Caller owns the objects.
   *
   * @param aEdgeOnly indicates only edges should be generated (even if 0 width), and no fill
   *                  shapes.
   */
  MakeEffectiveShapes(aEdgeOnly = false): SHAPE[] {
    return this.makeEffectiveShapes(aEdgeOnly);
  }

  MakeEffectiveShapesForHitTesting(): SHAPE[] {
    return this.makeEffectiveShapes(false, false, true);
  }

  ShapeGetMsgPanelInfo(aFrame: UNITS_PROVIDER, aList: MSG_PANEL_ITEM[]): void {
    let msg: string;

    const shape = 'Shape';
    aList.push(new MSG_PANEL_ITEM(shape, this.getFriendlyName()));

    switch (this.m_shape) {
      case SHAPE_T.CIRCLE:
        aList.push(new MSG_PANEL_ITEM('Radius', aFrame.MessageTextFromValue(this.GetRadius())));
        break;

      case SHAPE_T.ARC:
        aList.push(new MSG_PANEL_ITEM('Length', aFrame.MessageTextFromValue(this.GetLength())));

        msg = messageTextFromAngle(this.GetArcAngle().AsDegrees());
        aList.push(new MSG_PANEL_ITEM('Angle', msg));

        aList.push(new MSG_PANEL_ITEM('Radius', aFrame.MessageTextFromValue(this.GetRadius())));
        break;

      case SHAPE_T.BEZIER:
        aList.push(new MSG_PANEL_ITEM('Length', aFrame.MessageTextFromValue(this.GetLength())));
        break;

      case SHAPE_T.POLY:
        msg = `${this.GetPolyShape().Outline(0).PointCount()}`;
        aList.push(new MSG_PANEL_ITEM('Points', msg));
        break;

      case SHAPE_T.RECTANGLE:
        aList.push(
          new MSG_PANEL_ITEM(
            'Width',
            aFrame.MessageTextFromValue(Math.abs(this.GetEnd().x - this.GetStart().x)),
          ),
        );
        aList.push(
          new MSG_PANEL_ITEM(
            'Height',
            aFrame.MessageTextFromValue(Math.abs(this.GetEnd().y - this.GetStart().y)),
          ),
        );
        break;

      case SHAPE_T.SEGMENT: {
        aList.push(
          new MSG_PANEL_ITEM(
            'Length',
            aFrame.MessageTextFromValue(Distance(this.GetStart(), this.GetEnd())),
          ),
        );

        // angle counter-clockwise from 3'o-clock
        const angle = new EDA_ANGLE(
          Math.atan2(this.GetStart().y - this.GetEnd().y, this.GetEnd().x - this.GetStart().x),
          EDA_ANGLE_T.RADIANS_T,
        );
        aList.push(new MSG_PANEL_ITEM('Angle', messageTextFromAngle(angle.AsDegrees())));
        break;
      }

      default:
        break;
    }

    this.m_stroke.GetMsgPanelInfo(aFrame, aList);
  }

  SetRectangleHeight(aHeight: number): void {
    switch (this.m_shape) {
      case SHAPE_T.RECTANGLE:
        this.m_rectangleHeight = aHeight;
        this.SetEndY(this.GetStartY() + this.m_rectangleHeight);
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    }
  }

  SetRectangleWidth(aWidth: number): void {
    switch (this.m_shape) {
      case SHAPE_T.RECTANGLE:
        this.m_rectangleWidth = aWidth;
        this.SetEndX(this.GetStartX() + this.m_rectangleWidth);
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    }
  }

  SetRectangle(aHeight: number, aWidth: number): void {
    switch (this.m_shape) {
      case SHAPE_T.RECTANGLE:
        this.m_rectangleHeight = aHeight;
        this.m_rectangleWidth = aWidth;
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    }
  }

  SetCornerRadius(aRadius: number): void {
    if (this.m_shape === SHAPE_T.RECTANGLE) {
      const width = Math.abs(this.GetRectangleWidth());
      const height = Math.abs(this.GetRectangleHeight());
      const maxRadius = Math.trunc(Math.min(width, height) / 2);

      this.m_cornerRadius = Math.min(Math.max(aRadius, 0), maxRadius);
    } else {
      this.m_cornerRadius = aRadius;
    }
  }

  GetCornerRadius(): number {
    return this.m_cornerRadius;
  }

  IsClockwiseArc(): boolean {
    if (this.m_shape === SHAPE_T.ARC) {
      const mid = this.GetArcMid();

      const orient =
        (mid.x - this.m_start.x) * (this.m_end.y - this.m_start.y) -
        (mid.y - this.m_start.y) * (this.m_end.x - this.m_start.x);

      return orient < 0;
    }

    UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    return false;
  }

  /**
   * @return the length of the segment using the hypotenuse calculation.
   */
  GetLength(): number {
    let length = 0.0;

    switch (this.m_shape) {
      case SHAPE_T.BEZIER:
        for (let ii = 1; ii < this.m_bezierPoints.length; ++ii)
          length += Distance(this.m_bezierPoints[ii - 1]!, this.m_bezierPoints[ii]!);

        return length;

      case SHAPE_T.SEGMENT:
        return Distance(this.GetStart(), this.GetEnd());

      case SHAPE_T.POLY:
        for (let ii = 0; ii < this.GetPolyShape().COutline(0).SegmentCount(); ii++)
          length += this.GetPolyShape().COutline(0).CSegment(ii).Length();

        return length;

      case SHAPE_T.ARC:
        return this.GetRadius() * this.GetArcAngle().AsRadians();

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return 0.0;
    }
  }

  GetRectangleHeight(): number {
    switch (this.m_shape) {
      case SHAPE_T.RECTANGLE:
        return this.GetEndY() - this.GetStartY();

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return 0;
    }
  }

  GetRectangleWidth(): number {
    switch (this.m_shape) {
      case SHAPE_T.RECTANGLE:
        return this.GetEndX() - this.GetStartX();

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return 0;
    }
  }

  UpdateHatching(): void {
    if (!this.m_hatchingDirty) return;

    let slopes: number[];
    const lineWidth = this.GetHatchLineWidth();
    let spacing = this.GetHatchLineSpacing();
    let shapeBuffer = new SHAPE_POLY_SET();

    // Validate state before clearing cached hatching. If we can't regenerate, keep existing cache.
    if (this.isMoving()) return;

    if (this.GetFillMode() === FILL_T.CROSS_HATCH) slopes = [1.0, -1.0];
    else if (this.GetFillMode() === FILL_T.HATCH) slopes = [-1.0];
    else if (this.GetFillMode() === FILL_T.REVERSE_HATCH) slopes = [1.0];
    else return;

    if (spacing === 0) return;

    switch (this.m_shape) {
      case SHAPE_T.ARC:
      case SHAPE_T.SEGMENT:
      case SHAPE_T.BEZIER:
        return;

      case SHAPE_T.RECTANGLE:
        {
          const rr = new ROUNDRECT(
            new SHAPE_RECT(this.getPosition(), this.GetRectangleWidth(), this.GetRectangleHeight()),
            this.GetCornerRadius(),
          );
          rr.TransformToPolygon(shapeBuffer, this.getMaxError());
        }
        break;

      case SHAPE_T.CIRCLE:
        TransformCircleToPolygon(
          shapeBuffer,
          this.getCenter(),
          this.GetRadius(),
          this.getMaxError(),
          ERROR_LOC.ERROR_INSIDE,
        );
        break;

      case SHAPE_T.POLY:
        if (!this.IsClosed()) return;

        shapeBuffer = this.GetPolyShape().CloneDropTriangulation();
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return;
    }

    shapeBuffer.ClearArcs();

    // Clear cached hatching only after all validation passes.
    // This prevents flickering when early returns would otherwise leave empty hatching.
    this.hatching().RemoveAllContours();
    this.hatchLines().length = 0;

    const extents = shapeBuffer.BBox();
    const majorAxis = Math.max(extents.GetWidth(), extents.GetHeight());

    if (Math.trunc(majorAxis / spacing) > 100) spacing = Math.trunc(majorAxis / 100);

    const knockouts = this.getHatchingKnockouts();

    if (!knockouts.IsEmpty()) {
      shapeBuffer.BooleanSubtract(knockouts);
      shapeBuffer.Fracture();
    }

    // Generate hatch lines for stroke-based rendering. All hatch types use line segments.
    const hatchSegs = shapeBuffer.GenerateHatchLines(slopes, spacing, -1);
    this.m_hatchingCache!.hatchLines = hatchSegs;

    // Also generate polygon representation for exports, 3D viewer, and hit testing
    if (this.GetFillMode() === FILL_T.HATCH || this.GetFillMode() === FILL_T.REVERSE_HATCH) {
      for (const seg of hatchSegs) {
        // We don't really need the rounded ends at all, so don't spend any extra time on them
        const maxError = lineWidth;

        TransformOvalToPolygon(
          this.hatching(),
          seg.A,
          seg.B,
          lineWidth,
          maxError,
          ERROR_LOC.ERROR_INSIDE,
        );
      }

      this.hatching().Fracture();
      this.m_hatchingDirty = false;
    } else {
      // Generate a grid of holes for a cross-hatch polygon representation.
      // This is used for exports, 3D viewer, and hit testing.

      const gridsize = spacing;
      const hole_size = gridsize - this.GetHatchLineWidth();

      this.m_hatchingCache!.hatching = shapeBuffer.CloneDropTriangulation();
      this.hatching().Rotate(ANGLE_45.negate());

      // Build hole shape
      const hole_base = new SHAPE_LINE_CHAIN();
      const corner = V(0, 0);
      hole_base.Append(corner);
      corner.x += hole_size;
      hole_base.Append(corner);
      corner.y += hole_size;
      hole_base.Append(corner);
      corner.x = 0;
      hole_base.Append(corner);
      hole_base.SetClosed(true);

      // Build holes
      const bbox = this.GetHatching().BBox(0);
      const holes = new SHAPE_POLY_SET();

      const x_offset = bbox.GetX() - (bbox.GetX() % gridsize) - gridsize;
      const y_offset = bbox.GetY() - (bbox.GetY() % gridsize) - gridsize;

      for (let xx = x_offset; xx <= bbox.GetRight(); xx += gridsize) {
        for (let yy = y_offset; yy <= bbox.GetBottom(); yy += gridsize) {
          const hole = new SHAPE_LINE_CHAIN(hole_base);
          hole.Move(V(xx, yy));
          holes.AddOutline(hole);
        }
      }

      this.hatching().BooleanSubtract(holes);
      this.hatching().Fracture();

      // Must re-rotate after Fracture().  Clipper struggles mightily with fracturing
      // 45-degree holes.
      this.hatching().Rotate(ANGLE_45);

      if (!knockouts.IsEmpty()) {
        this.hatching().BooleanSubtract(knockouts);
        this.hatching().Fracture();
      }

      this.m_hatchingDirty = false;
    }
  }

  /**
   * Convert the shape to a closed polygon.
   *
   * Circles and arcs are approximated by segments.
   *
   * @param aBuffer is a buffer to store the polygon.
   * @param aClearance is the clearance around the pad.
   * @param aError is the maximum deviation from a true arc.
   * @param aErrorLoc whether any approximation error should be placed inside or outside
   * @param ignoreLineWidth is used for edge cut items where the line width is only for
   *                        visualization
   */
  TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    ignoreLineWidth = false,
    includeFill = false,
  ): void {
    const solidFill =
      this.IsSolidFill() || (this.IsHatchedFill() && !includeFill) || this.IsProxyItem();
    let width = ignoreLineWidth ? 0 : this.GetWidth();

    width += 2 * aClearance;

    switch (this.m_shape) {
      case SHAPE_T.CIRCLE: {
        const r = this.GetRadius();

        if (solidFill)
          TransformCircleToPolygon(
            aBuffer,
            this.getCenter(),
            r + Math.trunc(width / 2),
            aError,
            aErrorLoc,
          );
        else TransformRingToPolygon(aBuffer, this.getCenter(), r, width, aError, aErrorLoc);

        break;
      }

      case SHAPE_T.RECTANGLE: {
        if (this.GetCornerRadius() > 0) {
          const size = V(Math.abs(this.GetRectangleWidth()), Math.abs(this.GetRectangleHeight()));
          const bbox = this.getBoundingBox();
          const position = bbox.GetCenter();

          if (solidFill) {
            TransformRoundChamferedRectToPolygon(
              aBuffer,
              position,
              size,
              ANGLE_0,
              this.GetCornerRadius(),
              0.0,
              0,
              Math.trunc(width / 2),
              aError,
              aErrorLoc,
            );
          } else {
            const rr = new ROUNDRECT(
              new SHAPE_RECT(this.GetStart(), this.GetRectangleWidth(), this.GetRectangleHeight()),
              this.GetCornerRadius(),
            );
            const poly = new SHAPE_POLY_SET();
            rr.TransformToPolygon(poly, aError);
            const outline = poly.Outline(0);
            outline.SetClosed(true);

            const arcsHandled = new Set<number>();

            for (let ii = 0; ii < outline.SegmentCount(); ++ii) {
              if (outline.IsArcSegment(ii)) {
                const arcIndex = outline.ArcIndex(ii);

                if (arcsHandled.has(arcIndex)) continue;

                arcsHandled.add(arcIndex);

                const arc = outline.Arc(arcIndex);
                TransformArcToPolygon(
                  aBuffer,
                  arc.GetP0(),
                  arc.GetArcMid(),
                  arc.GetP1(),
                  width,
                  aError,
                  aErrorLoc,
                );
              } else {
                const seg = outline.GetSegment(ii);
                TransformOvalToPolygon(aBuffer, seg.A, seg.B, width, aError, aErrorLoc);
              }
            }
          }
        } else {
          const pts = this.GetRectCorners();

          if (solidFill) {
            aBuffer.NewOutline();

            for (const pt of pts) aBuffer.Append(pt);
          }

          if (width > 0 || !solidFill) {
            // Add in segments
            TransformOvalToPolygon(aBuffer, pts[0]!, pts[1]!, width, aError, aErrorLoc);
            TransformOvalToPolygon(aBuffer, pts[1]!, pts[2]!, width, aError, aErrorLoc);
            TransformOvalToPolygon(aBuffer, pts[2]!, pts[3]!, width, aError, aErrorLoc);
            TransformOvalToPolygon(aBuffer, pts[3]!, pts[0]!, width, aError, aErrorLoc);
          }
        }

        break;
      }

      case SHAPE_T.ARC:
        TransformArcToPolygon(
          aBuffer,
          this.GetStart(),
          this.GetArcMid(),
          this.GetEnd(),
          width,
          aError,
          aErrorLoc,
        );
        break;

      case SHAPE_T.SEGMENT:
        TransformOvalToPolygon(aBuffer, this.GetStart(), this.GetEnd(), width, aError, aErrorLoc);
        break;

      case SHAPE_T.POLY: {
        if (!this.IsPolyShapeValid()) break;

        if (solidFill) {
          for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
            const poly = this.GetPolyShape().Outline(ii);
            const tmp = new SHAPE_POLY_SET();
            tmp.NewOutline();

            for (let jj = 0; jj < poly.GetPointCount(); ++jj) tmp.Append(poly.GetPoint(jj));

            if (width > 0) {
              let inflate = Math.trunc(width / 2);

              if (aErrorLoc === ERROR_LOC.ERROR_OUTSIDE) inflate += aError;

              tmp.Inflate(inflate, CornerStrategy.ROUND_ALL_CORNERS, aError);
            }

            aBuffer.Append(tmp);
          }
        } else {
          for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
            const poly = this.GetPolyShape().Outline(ii);

            for (let jj = 0; jj < poly.SegmentCount(); ++jj) {
              const seg = poly.GetSegment(jj);
              TransformOvalToPolygon(aBuffer, seg.A, seg.B, width, aError, aErrorLoc);
            }
          }
        }

        break;
      }

      case SHAPE_T.BEZIER: {
        const ctrlPts = [this.GetStart(), this.GetBezierC1(), this.GetBezierC2(), this.GetEnd()];
        const converter = new BezierPoly(ctrlPts);
        const poly = converter.getPoly(aError);

        for (let ii = 1; ii < poly.length; ii++)
          TransformOvalToPolygon(aBuffer, poly[ii - 1]!, poly[ii]!, width, aError, aErrorLoc);

        break;
      }

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        break;
    }

    if (this.IsHatchedFill() && includeFill) {
      for (let ii = 0; ii < this.GetHatching().OutlineCount(); ++ii)
        aBuffer.AddOutline(this.GetHatching().COutline(ii));
    }
  }

  Compare(aOther: EDA_SHAPE): number {
    const EPSILON = 2; // Should be enough for rounding errors on calculated items

    // `TEST( a, b )`, `TEST_E( a, b )`, `TEST_PT( a, b )`: each returns from
    // Compare with a - b on a difference; here each yields null when equal.
    const TEST = (a: number, b: number): number | null => (a !== b ? a - b : null);
    const TEST_E = (a: number, b: number): number | null =>
      Math.abs(a - b) > EPSILON ? a - b : null;
    const TEST_PT = (a: Vec2, b: Vec2): number | null => TEST_E(a.x, b.x) ?? TEST_E(a.y, b.y);

    const checks: (() => number | null)[] = [
      () => TEST_PT(this.m_start, aOther.m_start),
      () => TEST_PT(this.m_end, aOther.m_end),
      () => TEST(this.m_shape, aOther.m_shape),
    ];

    if (this.m_shape === SHAPE_T.RECTANGLE) {
      checks.push(() => TEST(this.m_cornerRadius, aOther.m_cornerRadius));
    } else if (this.m_shape === SHAPE_T.ARC) {
      checks.push(() => TEST_PT(this.GetArcMid(), aOther.GetArcMid()));
    } else if (this.m_shape === SHAPE_T.BEZIER) {
      checks.push(() => TEST_PT(this.m_bezierC1, aOther.m_bezierC1));
      checks.push(() => TEST_PT(this.m_bezierC2, aOther.m_bezierC2));
    } else if (this.m_shape === SHAPE_T.POLY) {
      checks.push(() =>
        TEST(this.GetPolyShape().TotalVertices(), aOther.GetPolyShape().TotalVertices()),
      );
    }

    for (let ii = 0; ii < this.m_bezierPoints.length; ++ii)
      checks.push(() => TEST_PT(this.m_bezierPoints[ii]!, aOther.m_bezierPoints[ii] ?? V(0, 0)));

    for (let ii = 0; ii < this.GetPolyShape().TotalVertices(); ++ii)
      checks.push(() =>
        TEST_PT(this.GetPolyShape().CVertex(ii), aOther.GetPolyShape().CVertex(ii)),
      );

    checks.push(() => TEST_E(this.m_stroke.GetWidth(), aOther.m_stroke.GetWidth()));
    checks.push(() => TEST(this.m_stroke.GetLineStyle(), aOther.m_stroke.GetLineStyle()));
    checks.push(() => TEST(this.m_fill, aOther.m_fill));

    for (const check of checks) {
      const r = check();
      if (r !== null) return r;
    }

    return 0;
  }

  Similarity(aOther: EDA_SHAPE): number {
    if (this.GetShape() !== aOther.GetShape()) return 0.0;

    let similarity = 1.0;

    if (this.m_fill !== aOther.m_fill) similarity *= 0.9;

    if (this.m_stroke.GetWidth() !== aOther.m_stroke.GetWidth()) similarity *= 0.9;

    if (this.m_stroke.GetLineStyle() !== aOther.m_stroke.GetLineStyle()) similarity *= 0.9;

    if (!sameColor(this.m_fillColor, aOther.m_fillColor)) similarity *= 0.9;

    if (!samePoint(this.m_start, aOther.m_start)) similarity *= 0.9;

    if (!samePoint(this.m_end, aOther.m_end)) similarity *= 0.9;

    if (!samePoint(this.m_arcCenter, aOther.m_arcCenter)) similarity *= 0.9;

    if (!samePoint(this.m_bezierC1, aOther.m_bezierC1)) similarity *= 0.9;

    if (!samePoint(this.m_bezierC2, aOther.m_bezierC2)) similarity *= 0.9;

    {
      const m = this.m_bezierPoints.length;
      const n = aOther.m_bezierPoints.length;

      const longest = longest_common_subset(this.m_bezierPoints, aOther.m_bezierPoints, samePoint);

      similarity *= 0.9 ** (m + n - 2 * longest);
    }

    {
      const m = this.GetPolyShape().TotalVertices();
      const n = aOther.GetPolyShape().TotalVertices();
      const poly: VECTOR2I[] = [];
      const otherPoly: VECTOR2I[] = [];
      let lastPt = V(0, 0);

      // We look for the longest common subset of the two polygons, but we need to
      // offset each point because we're actually looking for overall similarity, not just
      // exact matches.  So if the zone is moved by 1IU, we only want one point to be
      // considered "moved" rather than the entire polygon.  In this case, the first point
      // will not be a match but the rest of the sequence will.
      for (let ii = 0; ii < m; ++ii) {
        const v = this.GetPolyShape().CVertex(ii);
        poly.push(V(lastPt.x - v.x, lastPt.y - v.y));
        lastPt = v;
      }

      lastPt = V(0, 0);

      for (let ii = 0; ii < n; ++ii) {
        const v = aOther.GetPolyShape().CVertex(ii);
        otherPoly.push(V(lastPt.x - v.x, lastPt.y - v.y));
        lastPt = v;
      }

      const longest = longest_common_subset(poly, otherPoly, samePoint);

      similarity *= 0.9 ** (m + n - 2 * longest);
    }

    return similarity;
  }

  /** `operator==`. */
  equalsEdaShape(aOther: EDA_SHAPE): boolean {
    if (this.GetShape() !== aOther.GetShape()) return false;

    if (this.m_fill !== aOther.m_fill) return false;

    if (this.m_stroke.GetWidth() !== aOther.m_stroke.GetWidth()) return false;

    if (this.m_stroke.GetLineStyle() !== aOther.m_stroke.GetLineStyle()) return false;

    if (!sameColor(this.m_fillColor, aOther.m_fillColor)) return false;

    if (!samePoint(this.m_start, aOther.m_start)) return false;

    if (!samePoint(this.m_end, aOther.m_end)) return false;

    if (!samePoint(this.m_arcCenter, aOther.m_arcCenter)) return false;

    if (!samePoint(this.m_bezierC1, aOther.m_bezierC1)) return false;

    if (!samePoint(this.m_bezierC2, aOther.m_bezierC2)) return false;

    if (
      this.m_bezierPoints.length !== aOther.m_bezierPoints.length ||
      !this.m_bezierPoints.every((p, i) => samePoint(p, aOther.m_bezierPoints[i]!))
    )
      return false;

    for (let ii = 0; ii < this.GetPolyShape().TotalVertices(); ++ii) {
      if (!samePoint(this.GetPolyShape().CVertex(ii), aOther.GetPolyShape().CVertex(ii)))
        return false;
    }

    return true;
  }

  // ---- protected ---------------------------------------------------------

  getFriendlyName(): string {
    if (this.IsProxyItem()) {
      switch (this.m_shape) {
        case SHAPE_T.RECTANGLE:
          return 'Pad Number Box';
        case SHAPE_T.SEGMENT:
          return 'Thermal Spoke Template';
        default:
          return 'Unrecognized';
      }
    }

    switch (this.m_shape) {
      case SHAPE_T.CIRCLE:
        return 'Circle';
      case SHAPE_T.ARC:
        return 'Arc';
      case SHAPE_T.BEZIER:
        return 'Curve';
      case SHAPE_T.POLY:
        return 'Polygon';
      case SHAPE_T.RECTANGLE:
        return 'Rectangle';
      case SHAPE_T.SEGMENT:
        return 'Segment';
      default:
        return 'Unrecognized';
    }
  }

  setPosition(aPos: Vec2): void {
    const p = this.getPosition();
    this.move({ x: aPos.x - p.x, y: aPos.y - p.y });
  }

  getPosition(): VECTOR2I {
    if (this.m_shape === SHAPE_T.ARC) return this.getCenter();
    if (this.m_shape === SHAPE_T.POLY) return this.GetPolyShape().CVertex(0);
    return this.m_start;
  }

  setFilled(aFlag: boolean): void {
    this.m_fill = aFlag ? FILL_T.FILLED_SHAPE : FILL_T.NO_FILL;
  }

  getHatchingKnockouts(): SHAPE_POLY_SET {
    return new SHAPE_POLY_SET();
  }

  move(aMoveVector: Vec2): void {
    const add = (p: VECTOR2I): void => {
      p.x += aMoveVector.x;
      p.y += aMoveVector.y;
    };

    switch (this.m_shape) {
      case SHAPE_T.ARC:
        add(this.m_arcCenter);
        add(this.m_arcMidData.center);
        add(this.m_arcMidData.start);
        add(this.m_arcMidData.end);
        add(this.m_arcMidData.mid);
        add(this.m_start);
        add(this.m_end);
        break;

      case SHAPE_T.SEGMENT:
      case SHAPE_T.RECTANGLE:
      case SHAPE_T.CIRCLE:
        add(this.m_start);
        add(this.m_end);
        break;

      case SHAPE_T.POLY:
        this.GetPolyShape().Move(aMoveVector);
        break;

      case SHAPE_T.BEZIER:
        add(this.m_start);
        add(this.m_end);
        add(this.m_bezierC1);
        add(this.m_bezierC2);

        for (const pt of this.m_bezierPoints) add(pt);

        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        break;
    }

    // Translate the cached hatch geometry instead of leaving it stale. The hatch pattern is
    // invariant under translation, so shifting line endpoints is sufficient and keeps the
    // display correct during interactive moves without hitting GenerateHatchLines().
    if (this.m_hatchingCache) {
      for (const seg of this.m_hatchingCache.hatchLines) {
        add(seg.A);
        add(seg.B);
      }

      this.m_hatchingCache.hatching.Move(aMoveVector);
    }

    this.m_hatchingDirty = true;
  }

  rotate(aRotCentre: Vec2, aAngle: EDA_ANGLE): void {
    switch (this.m_shape) {
      case SHAPE_T.SEGMENT:
      case SHAPE_T.CIRCLE:
        this.m_start = RotatePoint(this.m_start, aRotCentre, aAngle);
        this.m_end = RotatePoint(this.m_end, aRotCentre, aAngle);
        break;

      case SHAPE_T.ARC:
        this.m_start = RotatePoint(this.m_start, aRotCentre, aAngle);
        this.m_end = RotatePoint(this.m_end, aRotCentre, aAngle);
        this.m_arcCenter = RotatePoint(this.m_arcCenter, aRotCentre, aAngle);
        this.m_arcMidData.start = RotatePoint(this.m_arcMidData.start, aRotCentre, aAngle);
        this.m_arcMidData.end = RotatePoint(this.m_arcMidData.end, aRotCentre, aAngle);
        this.m_arcMidData.mid = RotatePoint(this.m_arcMidData.mid, aRotCentre, aAngle);
        this.m_arcMidData.center = RotatePoint(this.m_arcMidData.center, aRotCentre, aAngle);
        break;

      case SHAPE_T.RECTANGLE:
        if (aAngle.IsCardinal()) {
          this.m_start = RotatePoint(this.m_start, aRotCentre, aAngle);
          this.m_end = RotatePoint(this.m_end, aRotCentre, aAngle);
        } else {
          // Convert non-cardinally-rotated rect to a diamond
          const rr = new ROUNDRECT(
            new SHAPE_RECT(this.GetStart(), this.GetRectangleWidth(), this.GetRectangleHeight()),
            this.m_cornerRadius,
          );
          this.m_shape = SHAPE_T.POLY;
          rr.TransformToPolygon(this.GetPolyShape(), this.getMaxError());
          this.GetPolyShape().Rotate(aAngle, aRotCentre);
        }

        break;

      case SHAPE_T.POLY:
        this.GetPolyShape().Rotate(aAngle, aRotCentre);
        break;

      case SHAPE_T.BEZIER:
        this.m_start = RotatePoint(this.m_start, aRotCentre, aAngle);
        this.m_end = RotatePoint(this.m_end, aRotCentre, aAngle);
        this.m_bezierC1 = RotatePoint(this.m_bezierC1, aRotCentre, aAngle);
        this.m_bezierC2 = RotatePoint(this.m_bezierC2, aRotCentre, aAngle);

        for (let i = 0; i < this.m_bezierPoints.length; i++)
          this.m_bezierPoints[i] = RotatePoint(this.m_bezierPoints[i]!, aRotCentre, aAngle);

        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        break;
    }

    this.m_hatchingDirty = true;
  }

  flip(aCentre: Vec2, aFlipDirection: FLIP_DIRECTION): void {
    switch (this.m_shape) {
      case SHAPE_T.SEGMENT:
      case SHAPE_T.RECTANGLE:
        MIRROR(this.m_start, aCentre, aFlipDirection);
        MIRROR(this.m_end, aCentre, aFlipDirection);
        break;

      case SHAPE_T.CIRCLE:
        MIRROR(this.m_start, aCentre, aFlipDirection);
        MIRROR(this.m_end, aCentre, aFlipDirection);
        break;

      case SHAPE_T.ARC: {
        MIRROR(this.m_start, aCentre, aFlipDirection);
        MIRROR(this.m_end, aCentre, aFlipDirection);
        MIRROR(this.m_arcCenter, aCentre, aFlipDirection);

        const t = this.m_start;
        this.m_start = this.m_end;
        this.m_end = t;
        break;
      }

      case SHAPE_T.POLY:
        this.GetPolyShape().Mirror(aCentre, aFlipDirection);
        break;

      case SHAPE_T.BEZIER:
        MIRROR(this.m_start, aCentre, aFlipDirection);
        MIRROR(this.m_end, aCentre, aFlipDirection);
        MIRROR(this.m_bezierC1, aCentre, aFlipDirection);
        MIRROR(this.m_bezierC2, aCentre, aFlipDirection);

        this.RebuildBezierToSegmentsPointsList(this.getMaxError());
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        break;
    }

    this.m_hatchingDirty = true;
  }

  scale(aScale: number): void {
    const scalePt = (pt: VECTOR2I): void => {
      pt.x = KiROUND(pt.x * aScale);
      pt.y = KiROUND(pt.y * aScale);
    };

    switch (this.m_shape) {
      case SHAPE_T.ARC:
        scalePt(this.m_arcCenter);
        scalePt(this.m_start);
        scalePt(this.m_end);
        break;

      case SHAPE_T.SEGMENT:
      case SHAPE_T.RECTANGLE:
      case SHAPE_T.CIRCLE:
        scalePt(this.m_start);
        scalePt(this.m_end);
        break;

      case SHAPE_T.POLY: {
        // polygon
        const pts: VECTOR2I[] = [];

        for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
          for (const pt of this.GetPolyShape().Outline(ii).CPoints()) {
            const p = copy(pt);
            scalePt(p);
            pts.push(p);
          }
        }

        this.SetPolyPoints(pts);
        break;
      }

      case SHAPE_T.BEZIER:
        scalePt(this.m_start);
        scalePt(this.m_end);
        scalePt(this.m_bezierC1);
        scalePt(this.m_bezierC2);
        this.RebuildBezierToSegmentsPointsList(this.getMaxError());
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        break;
    }

    this.m_hatchingDirty = true;
  }

  getDrawRotation(): EDA_ANGLE {
    return ANGLE_0;
  }

  getBoundingBox(): BOX2I {
    const bbox = new BOX2I();

    switch (this.m_shape) {
      case SHAPE_T.RECTANGLE:
        for (const pt of this.GetRectCorners()) bbox.Merge(pt);

        break;

      case SHAPE_T.SEGMENT:
        bbox.SetOrigin(this.GetStart());
        bbox.SetEnd(this.GetEnd());
        break;

      case SHAPE_T.CIRCLE:
        bbox.SetOrigin(this.GetStart());
        bbox.Inflate(this.GetRadius());
        break;

      case SHAPE_T.ARC:
        this.computeArcBBox(bbox);
        break;

      case SHAPE_T.POLY:
        if (this.GetPolyShape().IsEmpty()) break;

        for (const pt of this.GetPolyShape().CIterate()) bbox.Merge(pt);

        break;

      case SHAPE_T.BEZIER:
        // Bezier BBoxes are not trivial to compute, so we approximate it by
        // using the bounding box of the curve (not control!) points.
        for (const pt of this.m_bezierPoints) bbox.Merge(pt);

        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        break;
    }

    bbox.Inflate(Math.trunc(Math.max(0, this.GetWidth()) / 2));
    bbox.Normalize();

    return bbox;
  }

  computeArcBBox(aBBox: BOX2I): void {
    // Start, end, and each inflection point the arc crosses will enclose the entire arc.
    // Only include the center when filled; it's not necessarily inside the BB of an unfilled
    // arc with a small included angle.
    aBBox.SetOrigin(this.m_start);
    aBBox.Merge(this.m_end);

    if (this.IsAnyFill()) aBBox.Merge(this.m_arcCenter);

    const radius = this.GetRadius();

    const [t1, t2] = this.CalcArcAngles();

    t1.Normalize();
    t2.Normalize();

    if (t2.gt(t1)) {
      if (t1.lt(ANGLE_0) && t2.gt(ANGLE_0))
        aBBox.Merge(V(this.m_arcCenter.x + radius, this.m_arcCenter.y)); // right

      if (t1.lt(ANGLE_90) && t2.gt(ANGLE_90))
        aBBox.Merge(V(this.m_arcCenter.x, this.m_arcCenter.y + radius)); // down

      if (t1.lt(ANGLE_180) && t2.gt(ANGLE_180))
        aBBox.Merge(V(this.m_arcCenter.x - radius, this.m_arcCenter.y)); // left

      if (t1.lt(ANGLE_270) && t2.gt(ANGLE_270))
        aBBox.Merge(V(this.m_arcCenter.x, this.m_arcCenter.y - radius)); // up
    } else {
      if (t1.lt(ANGLE_0) || t2.gt(ANGLE_0))
        aBBox.Merge(V(this.m_arcCenter.x + radius, this.m_arcCenter.y)); // right

      if (t1.lt(ANGLE_90) || t2.gt(ANGLE_90))
        aBBox.Merge(V(this.m_arcCenter.x, this.m_arcCenter.y + radius)); // down

      if (t1.lt(ANGLE_180) || t2.gt(ANGLE_180))
        aBBox.Merge(V(this.m_arcCenter.x - radius, this.m_arcCenter.y)); // left

      if (t1.lt(ANGLE_270) || t2.gt(ANGLE_270))
        aBBox.Merge(V(this.m_arcCenter.x, this.m_arcCenter.y - radius)); // up
    }
  }

  /** `hitTest( const VECTOR2I& aPosition, int aAccuracy )`. */
  hitTest(aPosition: Vec2, aAccuracy?: number): boolean;
  /** `hitTest( const BOX2I& aRect, bool aContained, int aAccuracy )`. */
  hitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  /** `hitTest( const SHAPE_LINE_CHAIN& aPoly, bool aContained )`. */
  hitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  hitTest(a: Vec2 | BOX2I | SHAPE_LINE_CHAIN, b?: number | boolean, c?: number): boolean {
    if (a instanceof BOX2I) return this.hitTestRect(a, b as boolean, c ?? 0);
    if (a instanceof SHAPE_LINE_CHAIN) return this.hitTestPoly(a, b as boolean);
    return this.hitTestPoint(a, (b as number | undefined) ?? 0);
  }

  private hitTestPoint(aPosition: Vec2, aAccuracy: number): boolean {
    let maxdist = aAccuracy;

    if (this.GetWidth() > 0) maxdist += this.GetWidth() / 2.0;

    // `maxdist` is a double; the int parameters it reaches truncate it
    const maxdistI = Math.trunc(maxdist);

    switch (this.m_shape) {
      case SHAPE_T.CIRCLE: {
        const radius = this.GetRadius();
        const dist = Distance(aPosition, this.getCenter());

        if (this.IsFilledForHitTesting()) return dist <= radius + maxdist; // Filled circle hit-test
        if (Math.abs(radius - dist) <= maxdist)
          // Ring hit-test
          return true;

        if (this.IsHatchedFill() && this.GetHatching().Collide(aPosition, maxdistI)) return true;

        return false;
      }

      case SHAPE_T.ARC: {
        if (Distance(aPosition, this.m_start) <= maxdist) return true;

        if (Distance(aPosition, this.m_end) <= maxdist) return true;

        const radius = this.GetRadius();
        const center = this.getCenter();
        const relPos = { x: aPosition.x - center.x, y: aPosition.y - center.y };
        const dist = Math.hypot(relPos.x, relPos.y);

        if (this.IsFilledForHitTesting()) {
          // Check distance from arc center
          if (dist > radius + maxdist) return false;
        } else {
          // Check distance from arc circumference
          if (Math.abs(radius - dist) > maxdist) return false;
        }

        // Finally, check to see if it's within arc's swept angle.
        const [startAngle, endAngle] = this.CalcArcAngles();

        const relPosAngle = EDA_ANGLE.fromVector(relPos);

        startAngle.Normalize();
        endAngle.Normalize();
        relPosAngle.Normalize();

        if (endAngle.gt(startAngle)) return relPosAngle.ge(startAngle) && relPosAngle.le(endAngle);
        return relPosAngle.ge(startAngle) || relPosAngle.le(endAngle);
      }

      case SHAPE_T.BEZIER: {
        let pts: readonly VECTOR2I[] = this.m_bezierPoints;

        if (this.m_bezierPoints.length === 0) {
          const converter = new BezierPoly(
            this.m_start,
            this.m_bezierC1,
            this.m_bezierC2,
            this.m_end,
          );
          pts = converter.getPoly(Math.trunc(aAccuracy / 2));
        }

        for (let i = 1; i < pts.length; i++) {
          if (TestSegmentHit(aPosition, pts[i - 1]!, pts[i]!, maxdistI)) return true;
        }

        return false;
      }
      case SHAPE_T.SEGMENT:
        return TestSegmentHit(aPosition, this.GetStart(), this.GetEnd(), maxdistI);

      case SHAPE_T.RECTANGLE:
        if (this.IsProxyItem() || this.IsFilledForHitTesting()) {
          // Filled rect hit-test
          const poly = new SHAPE_POLY_SET();
          poly.NewOutline();

          for (const pt of this.GetRectCorners()) poly.Append(pt);

          return poly.Collide(aPosition, maxdistI);
        }
        if (this.m_cornerRadius > 0) {
          const rr = new ROUNDRECT(
            new SHAPE_RECT(this.GetStart(), this.GetRectangleWidth(), this.GetRectangleHeight()),
            this.m_cornerRadius,
          );
          const poly = new SHAPE_POLY_SET();
          rr.TransformToPolygon(poly, this.getMaxError());

          if (poly.CollideEdge(aPosition, undefined, maxdistI)) return true;
        } else {
          const pts = this.GetRectCorners();

          if (
            TestSegmentHit(aPosition, pts[0]!, pts[1]!, maxdistI) ||
            TestSegmentHit(aPosition, pts[1]!, pts[2]!, maxdistI) ||
            TestSegmentHit(aPosition, pts[2]!, pts[3]!, maxdistI) ||
            TestSegmentHit(aPosition, pts[3]!, pts[0]!, maxdistI)
          ) {
            return true;
          }
        }

        if (this.IsHatchedFill() && this.GetHatching().Collide(aPosition, maxdistI)) return true;

        return false;

      case SHAPE_T.POLY:
        if (this.GetPolyShape().OutlineCount() < 1)
          // empty poly
          return false;

        if (this.IsFilledForHitTesting()) {
          if (!this.GetPolyShape().COutline(0).IsClosed()) {
            // Only one outline is expected
            const copyChain = new SHAPE_LINE_CHAIN(this.GetPolyShape().COutline(0));
            copyChain.SetClosed(true);
            return copyChain.Collide(aPosition, maxdistI);
          }
          return this.GetPolyShape().Collide(aPosition, maxdistI);
        }
        if (this.GetPolyShape().CollideEdge(aPosition, undefined, maxdistI)) return true;

        if (this.IsHatchedFill() && this.GetHatching().Collide(aPosition, maxdistI)) return true;

        return false;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return false;
    }
  }

  private hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    const arect = new BOX2I(aRect.GetOrigin(), aRect.GetSize());
    arect.Normalize();
    arect.Inflate(aAccuracy);

    const bbox = this.getBoundingBox();

    const checkOutline = (outline: SHAPE_LINE_CHAIN): boolean => {
      const count = outline.GetPointCount();

      for (let ii = 0; ii < count; ii++) {
        const vertex = outline.GetPoint(ii);

        // Test if the point is within aRect
        if (arect.Contains(vertex)) return true;

        if (ii + 1 < count) {
          const vertexNext = outline.GetPoint(ii + 1);

          // Test if this edge intersects aRect
          if (arect.Intersects(vertex, vertexNext)) return true;
        } else if (outline.IsClosed()) {
          const vertexNext = outline.GetPoint(0);

          // Test if this edge intersects aRect
          if (arect.Intersects(vertex, vertexNext)) return true;
        }
      }

      return false;
    };

    switch (this.m_shape) {
      case SHAPE_T.CIRCLE:
        // Test if area intersects or contains the circle:
        if (aContained) {
          return arect.Contains(bbox);
        }
        // If the rectangle does not intersect the bounding box, this is a much quicker test
        if (!arect.Intersects(bbox)) return false;
        return arect.IntersectsCircleEdge(this.getCenter(), this.GetRadius(), this.GetWidth());

      case SHAPE_T.ARC:
        // Test for full containment of this arc in the rect
        if (aContained) {
          return arect.Contains(bbox);
        }
        // Test if the rect crosses the arc
        if (!arect.Intersects(bbox)) return false;

        if (this.IsAnyFill()) {
          return (
            arect.Intersects(this.getCenter(), this.GetStart()) ||
            arect.Intersects(this.getCenter(), this.GetEnd()) ||
            arect.IntersectsCircleEdge(this.getCenter(), this.GetRadius(), this.GetWidth())
          );
        }
        return arect.IntersectsCircleEdge(this.getCenter(), this.GetRadius(), this.GetWidth());

      case SHAPE_T.RECTANGLE:
        if (aContained) {
          return arect.Contains(bbox);
        }
        if (this.m_cornerRadius > 0) {
          const rr = new ROUNDRECT(
            new SHAPE_RECT(this.GetStart(), this.GetRectangleWidth(), this.GetRectangleHeight()),
            this.m_cornerRadius,
          );
          const poly = new SHAPE_POLY_SET();
          rr.TransformToPolygon(poly, this.getMaxError());

          // Account for the width of the line
          arect.Inflate(Math.trunc(this.GetWidth() / 2));

          return checkOutline(poly.Outline(0));
        } else {
          const pts = this.GetRectCorners();

          // Account for the width of the lines
          arect.Inflate(Math.trunc(this.GetWidth() / 2));
          return (
            arect.Intersects(pts[0]!, pts[1]!) ||
            arect.Intersects(pts[1]!, pts[2]!) ||
            arect.Intersects(pts[2]!, pts[3]!) ||
            arect.Intersects(pts[3]!, pts[0]!)
          );
        }

      case SHAPE_T.SEGMENT:
        if (aContained) {
          return arect.Contains(this.GetStart()) && aRect.Contains(this.GetEnd());
        }
        // Account for the width of the line
        arect.Inflate(Math.trunc(this.GetWidth() / 2));
        return arect.Intersects(this.GetStart(), this.GetEnd());

      case SHAPE_T.POLY:
        if (aContained) {
          return arect.Contains(bbox);
        }
        // Fast test: if aRect is outside the polygon bounding box,
        // rectangles cannot intersect
        if (!arect.Intersects(bbox)) return false;

        // Account for the width of the line
        arect.Inflate(Math.trunc(this.GetWidth() / 2));

        for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
          if (checkOutline(this.GetPolyShape().Outline(ii))) return true;
        }

        return false;

      case SHAPE_T.BEZIER: {
        if (aContained) {
          return arect.Contains(bbox);
        }
        // Fast test: if aRect is outside the polygon bounding box,
        // rectangles cannot intersect
        if (!arect.Intersects(bbox)) return false;

        // Account for the width of the line
        arect.Inflate(Math.trunc(this.GetWidth() / 2));
        let pts: readonly VECTOR2I[] = this.m_bezierPoints;

        if (this.m_bezierPoints.length === 0) {
          const converter = new BezierPoly(
            this.m_start,
            this.m_bezierC1,
            this.m_bezierC2,
            this.m_end,
          );
          pts = converter.getPoly(Math.trunc(aAccuracy / 2));
        }

        for (let ii = 1; ii < pts.length; ii++) {
          const vertex = pts[ii - 1]!;
          const vertexNext = pts[ii]!;

          // Test if the point is within aRect
          if (arect.Contains(vertex)) return true;

          // Test if this edge intersects aRect
          if (arect.Intersects(vertex, vertexNext)) return true;
        }

        return false;
      }

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return false;
    }
  }

  private hitTestPoly(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean {
    const shape = new SHAPE_COMPOUND(this.MakeEffectiveShapes());

    return KIGEOM_ShapeHitTest(aPoly, shape, aContained);
  }

  buildBezierToSegmentsPointsList(aMaxError: number): VECTOR2I[] {
    // Rebuild the m_BezierPoints vertex list that approximate the Bezier curve
    const ctrlPoints = [this.m_start, this.m_bezierC1, this.m_bezierC2, this.m_end];
    const converter = new BezierPoly(ctrlPoints);
    const bezierPoints = converter.getPoly(aMaxError);

    return bezierPoints;
  }

  beginEdit(aPosition: Vec2): void {
    switch (this.GetShape()) {
      case SHAPE_T.SEGMENT:
      case SHAPE_T.CIRCLE:
      case SHAPE_T.RECTANGLE:
        this.SetStart(aPosition);
        this.SetEnd(aPosition);
        break;

      case SHAPE_T.ARC:
        this.SetArcGeometry(aPosition, aPosition, aPosition);
        this.m_editState = 1;
        break;

      case SHAPE_T.BEZIER:
        this.SetStart(aPosition);
        this.SetEnd(aPosition);
        this.SetBezierC1(aPosition);
        this.SetBezierC2(aPosition);
        this.m_editState = 1;

        this.RebuildBezierToSegmentsPointsList(this.getMaxError());
        break;

      case SHAPE_T.POLY:
        this.GetPolyShape().NewOutline();
        this.GetPolyShape().Outline(0).SetClosed(false);

        // Start and end of the first segment (co-located for now)
        this.GetPolyShape().Outline(0).Append(aPosition);
        this.GetPolyShape().Outline(0).Append(aPosition, true);
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    }
  }

  continueEdit(aPosition: Vec2): boolean {
    switch (this.GetShape()) {
      case SHAPE_T.ARC:
      case SHAPE_T.SEGMENT:
      case SHAPE_T.CIRCLE:
      case SHAPE_T.RECTANGLE:
        return false;

      case SHAPE_T.BEZIER:
        if (this.m_editState === 3) return false;

        this.m_editState++;
        return true;

      case SHAPE_T.POLY: {
        const poly = this.GetPolyShape().Outline(0);

        // do not add zero-length segments
        if (!samePoint(poly.CPoint(poly.GetPointCount() - 2), poly.CLastPoint()))
          poly.Append(aPosition, true);

        return true;
      }

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        return false;
    }
  }

  calcEdit(aPosition: Vec2): void {
    const sq = (x: number): number => x ** 2;

    switch (this.GetShape()) {
      case SHAPE_T.SEGMENT:
      case SHAPE_T.CIRCLE:
      case SHAPE_T.RECTANGLE:
        this.SetEnd(aPosition);
        break;

      case SHAPE_T.BEZIER: {
        switch (this.m_editState) {
          case 0:
            this.SetStart(aPosition);
            this.SetEnd(aPosition);
            this.SetBezierC1(aPosition);
            this.SetBezierC2(aPosition);
            break;

          case 1:
            this.SetBezierC2(aPosition);
            this.SetEnd(aPosition);
            break;

          case 2:
            this.SetBezierC1(aPosition);
            break;

          case 3:
            this.SetBezierC2(aPosition);
            break;
        }

        this.RebuildBezierToSegmentsPointsList(this.getMaxError());
        break;
      }

      case SHAPE_T.ARC: {
        let radius = this.GetRadius();
        const lastAngle = this.GetArcAngle();

        // Edit state 0: drawing: place start
        // Edit state 1: drawing: place end (center calculated for 90-degree subtended angle)
        // Edit state 2: point edit: move start (center calculated for invariant subtended angle)
        // Edit state 3: point edit: move end (center calculated for invariant subtended angle)
        // Edit state 4: point edit: move center
        // Edit state 5: point edit: move arc-mid-point

        switch (this.m_editState) {
          case 0:
            this.SetArcGeometry(aPosition, aPosition, aPosition);
            return;

          case 1:
            this.m_end = copy(aPosition);
            radius = Distance(this.m_start, this.m_end) * Math.SQRT1_2;
            break;

          case 2:
          case 3: {
            let v = { x: this.m_start.x - this.m_end.x, y: this.m_start.y - this.m_end.y };
            const chordBefore = v.x * v.x + v.y * v.y;

            if (this.m_editState === 2) this.m_start = copy(aPosition);
            else this.m_end = copy(aPosition);

            v = { x: this.m_start.x - this.m_end.x, y: this.m_start.y - this.m_end.y };

            const chordAfter = v.x * v.x + v.y * v.y;
            let ratio = 0.0;

            if (chordBefore > 0) ratio = chordAfter / chordBefore;

            if (ratio !== 0)
              radius = Math.max(Math.sqrt(sq(radius) * ratio), Math.sqrt(chordAfter) / 2);
            break;
          }

          case 4: {
            const radialA = Distance(this.m_start, aPosition);
            const radialB = Distance(this.m_end, aPosition);
            radius = (radialA + radialB) / 2.0;
            break;
          }

          case 5:
            this.SetArcGeometry(this.GetStart(), aPosition, this.GetEnd());
            return;
        }

        // Calculate center based on start, end, and radius
        //
        // Let 'l' be the length of the chord and 'm' the middle point of the chord
        const l = Distance(this.m_start, this.m_end);
        // `( m_start + m_end ) / 2`: a VECTOR2I over an int, KiROUND per component, then a VECTOR2D
        const m = divideI(
          { x: this.m_start.x + this.m_end.x, y: this.m_start.y + this.m_end.y },
          2,
        );
        const sqRadDiff = radius * radius - (l * l) / 4.0;

        // Calculate 'd', the vector from the chord midpoint to the center
        const d = { x: 0, y: 0 };

        if (l > 0 && sqRadDiff >= 0) {
          d.x = (Math.sqrt(sqRadDiff) * (this.m_start.y - this.m_end.y)) / l;
          d.y = (Math.sqrt(sqRadDiff) * (this.m_end.x - this.m_start.x)) / l;
        }

        const c1 = V(KiROUND(m.x + d.x), KiROUND(m.y + d.y));
        const c2 = V(KiROUND(m.x - d.x), KiROUND(m.y - d.y));

        // Solution gives us 2 centers; we need to pick one:
        switch (this.m_editState) {
          case 1:
            // Keep arc clockwise while drawing i.e. arc angle = 90 deg.
            // it can be 90 or 270 deg depending on the arc center choice (c1 or c2)
            this.m_arcCenter = c1; // first trial

            if (this.GetArcAngle().gt(ANGLE_180)) this.m_arcCenter = c2;

            break;

          case 2:
          case 3:
            // Pick the one of c1, c2 to keep arc on the same side
            this.m_arcCenter = c1; // first trial

            if (lastAngle.lt(ANGLE_180) !== this.GetArcAngle().lt(ANGLE_180)) this.m_arcCenter = c2;

            break;

          case 4:
            // Pick the one closer to the mouse position
            this.m_arcCenter = Distance(c1, aPosition) < Distance(c2, aPosition) ? c1 : c2;
            break;
        }

        break;
      }

      case SHAPE_T.POLY:
        this.GetPolyShape()
          .Outline(0)
          .SetPoint(this.GetPolyShape().Outline(0).GetPointCount() - 1, aPosition);
        break;

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    }
  }

  /**
   * Finish editing the shape.
   *
   * @param aClosed Should polygon shapes be closed (yes for pcbnew/fpeditor, no for libedit).
   */
  endEdit(aClosed = true): void {
    switch (this.GetShape()) {
      case SHAPE_T.ARC:
      case SHAPE_T.SEGMENT:
      case SHAPE_T.CIRCLE:
      case SHAPE_T.RECTANGLE:
      case SHAPE_T.BEZIER:
        break;

      case SHAPE_T.POLY: {
        const poly = this.GetPolyShape().Outline(0);

        // do not include last point twice
        if (poly.GetPointCount() > 2) {
          if (samePoint(poly.CPoint(poly.GetPointCount() - 2), poly.CLastPoint())) {
            poly.SetClosed(aClosed);
          } else {
            poly.SetClosed(false);
            poly.Remove(poly.GetPointCount() - 1);
          }
        }

        break;
      }

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
    }
  }

  setEditState(aState: number): void {
    this.m_editState = aState;
  }

  isMoving(): boolean {
    return false;
  }

  /**
   * Make a set of #SHAPE objects representing the #EDA_SHAPE.
   *
   * Caller owns the objects.
   *
   * @param aEdgeOnly indicates only edges should be generated (even if 0 width), and no fill
   *                  shapes.
   * @param aLineChainOnly indicates #SHAPE_POLY_SET is being abused slightly to represent a
   *                       lineChain rather than a closed polygon.
   */
  // fixme: move to shape_compound
  makeEffectiveShapes(aEdgeOnly: boolean, aLineChainOnly = false, aHittesting = false): SHAPE[] {
    const effectiveShapes: SHAPE[] = [];
    const width = this.GetEffectiveWidth();
    let solidFill =
      this.IsSolidFill() ||
      this.IsHatchedFill() ||
      this.IsProxyItem() ||
      (aHittesting && this.IsFilledForHitTesting());

    if (aEdgeOnly) solidFill = false;

    switch (this.m_shape) {
      case SHAPE_T.ARC:
        effectiveShapes.push(
          new SHAPE_ARC(this.m_arcCenter, this.m_start, this.GetArcAngle(), width),
        );
        break;

      case SHAPE_T.SEGMENT:
        effectiveShapes.push(new SHAPE_SEGMENT(this.m_start, this.m_end, width));
        break;

      case SHAPE_T.RECTANGLE: {
        if (this.m_cornerRadius > 0) {
          const rr = new ROUNDRECT(
            new SHAPE_RECT(this.GetStart(), this.GetRectangleWidth(), this.GetRectangleHeight()),
            this.m_cornerRadius,
          );
          const poly = new SHAPE_POLY_SET();
          rr.TransformToPolygon(poly, this.getMaxError());
          const outline = poly.Outline(0);

          if (solidFill) effectiveShapes.push(new SHAPE_SIMPLE(outline));

          if (width > 0 || !solidFill) {
            const arcsHandled = new Set<number>();

            for (let ii = 0; ii < outline.SegmentCount(); ++ii) {
              if (outline.IsArcSegment(ii)) {
                const arcIndex = outline.ArcIndex(ii);

                if (!arcsHandled.has(arcIndex)) {
                  arcsHandled.add(arcIndex);
                  effectiveShapes.push(new SHAPE_ARC(outline.Arc(arcIndex), width));
                }
              } else {
                effectiveShapes.push(new SHAPE_SEGMENT(outline.Segment(ii), width));
              }
            }
          }
        } else {
          const pts = this.GetRectCorners();

          if (solidFill) effectiveShapes.push(new SHAPE_SIMPLE(new SHAPE_LINE_CHAIN(pts)));

          if (width > 0 || !solidFill) {
            effectiveShapes.push(new SHAPE_SEGMENT(pts[0]!, pts[1]!, width));
            effectiveShapes.push(new SHAPE_SEGMENT(pts[1]!, pts[2]!, width));
            effectiveShapes.push(new SHAPE_SEGMENT(pts[2]!, pts[3]!, width));
            effectiveShapes.push(new SHAPE_SEGMENT(pts[3]!, pts[0]!, width));
          }
        }
        break;
      }

      case SHAPE_T.CIRCLE: {
        if (solidFill) effectiveShapes.push(new SHAPE_CIRCLE(this.getCenter(), this.GetRadius()));

        if (width > 0 || !solidFill)
          effectiveShapes.push(new SHAPE_ARC(this.getCenter(), this.GetEnd(), ANGLE_360, width));

        break;
      }

      case SHAPE_T.BEZIER: {
        const bezierPoints = this.buildBezierToSegmentsPointsList(this.getMaxError());
        let start_pt = bezierPoints[0]!;

        for (let jj = 1; jj < bezierPoints.length; jj++) {
          const end_pt = bezierPoints[jj]!;
          effectiveShapes.push(new SHAPE_SEGMENT(start_pt, end_pt, width));
          start_pt = end_pt;
        }

        break;
      }

      case SHAPE_T.POLY: {
        if (this.GetPolyShape().OutlineCount() === 0)
          // malformed/empty polygon
          break;

        for (let ii = 0; ii < this.GetPolyShape().OutlineCount(); ++ii) {
          const l = this.GetPolyShape().COutline(ii);

          if (solidFill) effectiveShapes.push(new SHAPE_SIMPLE(l));

          if (width > 0 || !this.IsSolidFill() || aEdgeOnly) {
            let segCount = l.SegmentCount();

            if (aLineChainOnly && l.IsClosed()) segCount--; // Treat closed chain as open

            for (let jj = 0; jj < segCount; jj++)
              effectiveShapes.push(new SHAPE_SEGMENT(l.CSegment(jj), width));
          }
        }
        break;
      }

      default:
        UNIMPLEMENTED_FOR(this.SHAPE_T_asString());
        break;
    }

    return effectiveShapes;
  }

  getMaxError(): number {
    return 100;
  }

  // non-const for PCB_SHAPE
  hatching(): SHAPE_POLY_SET {
    if (!this.m_hatchingCache)
      this.m_hatchingCache = { hatching: new SHAPE_POLY_SET(), hatchLines: [] };

    return this.m_hatchingCache.hatching;
  }

  hatchLines(): SEG[] {
    if (!this.m_hatchingCache)
      this.m_hatchingCache = { hatching: new SHAPE_POLY_SET(), hatchLines: [] };

    return this.m_hatchingCache.hatchLines;
  }
}
