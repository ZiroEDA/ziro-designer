// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_dimension.h` / `pcb_dimension.cpp`: `PCB_DIMENSION_BASE` over
 * `PCB_TEXT`, and the five dimensions — `PCB_DIM_ALIGNED`, `PCB_DIM_ORTHOGONAL`
 * (an aligned one locked to an axis), `PCB_DIM_RADIAL`, `PCB_DIM_LEADER` and
 * `PCB_DIM_CENTER`. A dimension owns a cache of drawn shapes (`m_shapes`)
 * rebuilt by `updateGeometry` from its two feature points and its text.
 *
 * The enums live in `pcb_dimension_types.ts`.
 *
 * Not here: `Serialize`/`Deserialize` (the kiapi protobuf surface) and
 * `DIMENSION_DESC`, the `PROPERTY_MANAGER` registration.
 */

import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  NO_SETTER,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_CAST,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_INT,
  TYPE_OPT_INT,
  TYPE_STRING,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';

import {
  type EdaUnits,
  pcbIUScale,
  toUserUnit,
  unitLabel,
  unitLabelText,
} from '@ziroeda/common/eda_units.js';
import { FLASHING, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import {
  KIUI_EllipsizeMenuText,
  KIUI_EllipsizeStatusText,
} from '@ziroeda/common/widgets/ui_common.js';
import { FLIP_DIRECTION, MIRROR } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { CIRCLE } from '@ziroeda/kimath/src/geometry/circle.js';
import {
  ANGLE_45,
  ANGLE_90,
  ANGLE_135,
  ANGLE_180,
  ANGLE_270,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
  EDA_ANGLE,
  EDA_ANGLE_T,
  FULL_CIRCLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { type OPT_VECTOR2I, SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  SHAPE_POLY_SET,
  TransformCircleToPolygon,
  TransformOvalToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND, toInt } from '@ziroeda/kimath/src/math/util.js';
import {
  EuclideanNorm,
  EuclideanNormI,
  ResizeI,
  SquaredEuclideanNorm,
  type VECTOR2I,
  add,
  divideI,
  equal,
  sub,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD_DESIGN_SETTINGS } from './board_design_settings.js';
import { BOARD_ITEM } from './board_item.js';
import {
  DIM_ARROW_DIRECTION,
  DIM_PRECISION,
  DIM_TEXT_BORDER,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from './pcb_dimension_types.js';
import { PCB_TEXT } from './pcb_text.js';

const INWARD_ARROW_LENGTH_TO_HEAD_RATIO = 2;

const s_arrowAngle = new EDA_ANGLE(27.5, EDA_ANGLE_T.DEGREES_T);

/** `sign( T val )` (math/util.h): -1, 0 or 1. */
const sign = (val: number): number => (val > 0 ? 1 : val < 0 ? -1 : 0);

/** `VECTOR2I * int`. */
const scale = (v: VECTOR2I, k: number): VECTOR2I => ({ x: v.x * k, y: v.y * k });

/**
 * Find the intersection between a given segment and polygon outline.
 *
 * @param aPoly is the polygon to collide.
 * @param aSeg is the segment to collide.
 * @param aStart if true will start from aSeg.A, otherwise aSeg.B.
 * @return a point on aSeg that collides with aPoly closest to the start, if one exists.
 */
function segPolyIntersection(aPoly: SHAPE_POLY_SET, aSeg: SEG, aStart = true): OPT_VECTOR2I {
  const start: VECTOR2I = aStart ? aSeg.A : aSeg.B;
  let endpoint: VECTOR2I = aStart ? aSeg.B : aSeg.A;

  if (aPoly.Contains(start)) return undefined;

  for (const seg of aPoly.CIterateSegments()) {
    const intersection = seg.Intersect(aSeg);

    if (intersection) {
      if (
        SquaredEuclideanNorm(sub(intersection, start)) < SquaredEuclideanNorm(sub(endpoint, start))
      )
        endpoint = intersection;
    }
  }

  if (equal(start, endpoint)) return undefined;

  return endpoint;
}

function segCircleIntersection(aCircle: CIRCLE, aSeg: SEG, aStart = true): OPT_VECTOR2I {
  const start: VECTOR2I = aStart ? aSeg.A : aSeg.B;
  let endpoint: VECTOR2I = aStart ? aSeg.B : aSeg.A;

  if (aCircle.Contains(start)) return undefined;

  for (const intersection of aCircle.Intersect(aSeg)) {
    if (SquaredEuclideanNorm(sub(intersection, start)) < SquaredEuclideanNorm(sub(endpoint, start)))
      endpoint = intersection;
  }

  if (equal(start, endpoint)) return undefined;

  return endpoint;
}

/**
 * Knockout a polygon from a segment. This function will add 0, 1 or 2 segments to the
 * vector, depending on how the polygon intersects the segment.
 */
function CollectKnockedOutSegments(
  aPoly: SHAPE_POLY_SET,
  aSeg: SEG,
  aSegmentsAfterKnockout: SHAPE[],
): void {
  // Now we can draw 0, 1, or 2 crossbar lines depending on how the polygon collides
  const containsA = aPoly.Contains(aSeg.A);
  const containsB = aPoly.Contains(aSeg.B);

  const endpointA = segPolyIntersection(aPoly, aSeg);
  const endpointB = segPolyIntersection(aPoly, aSeg, false);

  if (endpointA) aSegmentsAfterKnockout.push(new SHAPE_SEGMENT(aSeg.A, endpointA));

  if (endpointB) {
    let can_add = true;

    if (endpointA) {
      if (
        (equal(endpointB, aSeg.A) && equal(endpointA, aSeg.B)) ||
        (equal(endpointA, endpointB) && equal(aSeg.A, aSeg.B))
      )
        can_add = false;
    }

    if (can_add) aSegmentsAfterKnockout.push(new SHAPE_SEGMENT(endpointB, aSeg.B));
  }

  if (!containsA && !containsB && !endpointA && !endpointB)
    aSegmentsAfterKnockout.push(new SHAPE_SEGMENT(aSeg));
}

/** The text-box polygon every `updateGeometry` builds: the inflated box rotated about its centre. */
function polyBoxOf(aTextBox: BOX2I, aAngle: EDA_ANGLE): SHAPE_POLY_SET {
  const polyBox = new SHAPE_POLY_SET();
  polyBox.NewOutline();
  polyBox.Append(aTextBox.GetOrigin());
  polyBox.Append({ x: aTextBox.GetOrigin().x, y: aTextBox.GetEnd().y });
  polyBox.Append(aTextBox.GetEnd());
  polyBox.Append({ x: aTextBox.GetEnd().x, y: aTextBox.GetOrigin().y });
  polyBox.Rotate(aAngle, aTextBox.GetCenter());
  return polyBox;
}

/**
 * Abstract dimension API
 */
export abstract class PCB_DIMENSION_BASE extends PCB_TEXT {
  // Value format
  protected m_overrideTextEnabled!: boolean; ///< Manually specify the displayed measurement value
  protected m_valueString!: string; ///< Displayed value when m_overrideValue = true
  protected m_prefix!: string; ///< String prepended to the value
  protected m_suffix!: string; ///< String appended to the value
  protected m_units!: EdaUnits; ///< 0 = inches, 1 = mm
  protected m_autoUnits!: boolean; ///< If true, follow the currently selected UI units
  protected m_unitsFormat!: DIM_UNITS_FORMAT; ///< How to render the units suffix
  protected m_arrowDirection!: DIM_ARROW_DIRECTION; ///< direction of dimension arrow.
  protected m_precision!: DIM_PRECISION; ///< Number of digits to display after decimal
  protected m_suppressZeroes!: boolean; ///< Suppress trailing zeroes

  // Geometry
  protected m_lineThickness!: number; ///< Thickness used for all graphics in the dimension
  protected m_arrowLength!: number; ///< Length of arrow shapes
  protected m_extensionOffset!: number; ///< Distance from feature points to extension line start
  protected m_textPosition!: DIM_TEXT_POSITION; ///< How to position the text
  protected m_keepTextAligned!: boolean; ///< Calculate text orientation to match dimension

  // Internal
  protected m_measuredValue!: number; ///< value of PCB dimensions
  protected m_start!: VECTOR2I;
  protected m_end!: VECTOR2I;

  ///< Internal cache of drawn shapes
  protected m_shapes!: SHAPE[];

  protected m_inClearRenderCache!: boolean; ///< re-entrancy guard

  // a flag to protect against reentrance
  protected m_busy!: boolean;

  constructor(aParent: BOARD_ITEM | null, aType: KICAD_T = KICAD_T.PCB_DIMENSION_T) {
    super(aParent, aType);
    this.m_overrideTextEnabled = false;
    this.m_valueString = '';
    this.m_prefix = '';
    this.m_suffix = '';
    this.m_units = 'in';
    this.m_autoUnits = false;
    this.m_unitsFormat = DIM_UNITS_FORMAT.BARE_SUFFIX;
    this.m_arrowDirection = DIM_ARROW_DIRECTION.OUTWARD;
    this.m_precision = DIM_PRECISION.X_XXXX;
    this.m_suppressZeroes = false;
    this.m_lineThickness = pcbIUScale.mmToIU(0.2);
    this.m_arrowLength = pcbIUScale.milsToIU(50);
    this.m_extensionOffset = 0;
    this.m_textPosition = DIM_TEXT_POSITION.OUTSIDE;
    this.m_keepTextAligned = true;
    this.m_measuredValue = 0;
    this.m_start = { x: 0, y: 0 };
    this.m_end = { x: 0, y: 0 };
    this.m_shapes = [];
    this.m_inClearRenderCache = false;

    this.m_layer = PCB_LAYER_ID.Dwgs_User;
    this.m_busy = false;
  }

  /** The compiler-generated `operator=` for this level; the shapes are copied as references. */
  protected assignDimensionBase(aOther: PCB_DIMENSION_BASE): this {
    this.assignPcbText(aOther);
    this.m_overrideTextEnabled = aOther.m_overrideTextEnabled;
    this.m_valueString = aOther.m_valueString;
    this.m_prefix = aOther.m_prefix;
    this.m_suffix = aOther.m_suffix;
    this.m_units = aOther.m_units;
    this.m_autoUnits = aOther.m_autoUnits;
    this.m_unitsFormat = aOther.m_unitsFormat;
    this.m_arrowDirection = aOther.m_arrowDirection;
    this.m_precision = aOther.m_precision;
    this.m_suppressZeroes = aOther.m_suppressZeroes;
    this.m_lineThickness = aOther.m_lineThickness;
    this.m_arrowLength = aOther.m_arrowLength;
    this.m_extensionOffset = aOther.m_extensionOffset;
    this.m_textPosition = aOther.m_textPosition;
    this.m_keepTextAligned = aOther.m_keepTextAligned;
    this.m_measuredValue = aOther.m_measuredValue;
    this.m_start = { ...aOther.m_start };
    this.m_end = { ...aOther.m_end };
    this.m_shapes = [...aOther.m_shapes];
    this.m_inClearRenderCache = aOther.m_inClearRenderCache;
    this.m_busy = aOther.m_busy;
    return this;
  }

  /**
   * The dimension's origin is the first feature point for the dimension.  Every dimension has
   * one or more feature points, so every dimension has at least an origin.
   * @return the origin point of this dimension
   */
  GetStart(): VECTOR2I {
    return this.m_start;
  }
  SetStart(aPoint: VECTOR2I): void {
    this.m_start = { x: aPoint.x, y: aPoint.y };
  }

  GetEnd(): VECTOR2I {
    return this.m_end;
  }
  SetEnd(aPoint: VECTOR2I): void {
    this.m_end = { x: aPoint.x, y: aPoint.y };
  }

  override GetPosition(): VECTOR2I {
    return this.m_start;
  }
  override SetPosition(aPos: VECTOR2I): void {
    this.m_start = { x: aPos.x, y: aPos.y };
  }

  GetOverrideTextEnabled(): boolean {
    return this.m_overrideTextEnabled;
  }
  SetOverrideTextEnabled(aOverride: boolean): void {
    this.m_overrideTextEnabled = aOverride;
  }

  GetOverrideText(): string {
    return this.m_valueString;
  }
  SetOverrideText(aValue: string): void {
    this.m_valueString = aValue;
  }

  ChangeOverrideText(aValue: string): void {
    this.SetOverrideTextEnabled(true);
    this.SetOverrideText(aValue);
    this.Update();
  }

  GetMeasuredValue(): number {
    return this.m_measuredValue;
  }

  // KiCad normally calculates the measured value but some importers need to set it.
  SetMeasuredValue(aValue: number): void {
    this.m_measuredValue = aValue;
  }

  /**
   * @return the dimension value, rendered with precision / zero suppression but no units, etc
   */
  GetValueText(): string {
    const sep = '.'; // localeconv()->decimal_point

    const val = this.GetMeasuredValue();
    let precision = this.m_precision as number;
    let text: string;

    if (precision >= 6) {
      switch (this.m_units) {
        case 'in':
          precision = precision - 4;
          break;
        case 'mils':
          precision = Math.max(0, precision - 7);
          break;
        case 'mm':
          precision = precision - 5;
          break;
        default:
          precision = precision - 4;
          break;
      }
    }

    // text.Printf( "%.<precision>f", ToUserUnit( pcbIUScale, m_units, val ) )
    text = toUserUnit(pcbIUScale, this.m_units, val).toFixed(precision);

    if (this.m_suppressZeroes) {
      while (text.endsWith('0')) {
        text = text.slice(0, -1);

        if (text.endsWith('.') || text.endsWith(sep)) {
          text = text.slice(0, -1);
          break;
        }
      }
    }

    return text;
  }

  /**
   * Update the dimension's cached text and geometry.
   *
   * Call this whenever you change something in the geometry
   * definition, or the text (which can affect geometry, e.g. by
   * a knockout of a crossbar line or similar)
   */
  Update(): void {
    // Calls updateText internally
    this.updateGeometry();
  }

  UpdateUnits(): void {
    this.SetUnitsMode(this.GetUnitsMode());
    this.Update();
  }

  GetPrefix(): string {
    return this.m_prefix;
  }
  SetPrefix(aPrefix: string): void {
    this.m_prefix = aPrefix;
  }

  ChangePrefix(aPrefix: string): void {
    this.SetPrefix(aPrefix);
    this.Update();
  }

  GetSuffix(): string {
    return this.m_suffix;
  }
  SetSuffix(aSuffix: string): void {
    this.m_suffix = aSuffix;
  }

  ChangeSuffix(aSuffix: string): void {
    this.SetSuffix(aSuffix);
    this.Update();
  }

  GetArrowDirection(): DIM_ARROW_DIRECTION {
    return this.m_arrowDirection;
  }
  SetArrowDirection(aDirection: DIM_ARROW_DIRECTION): void {
    this.m_arrowDirection = aDirection;
  }

  ChangeArrowDirection(aDirection: DIM_ARROW_DIRECTION): void {
    this.SetArrowDirection(aDirection);
    this.updateText();
    this.updateGeometry();
  }

  GetUnits(): EdaUnits {
    return this.m_units;
  }
  SetUnits(aUnits: EdaUnits): void {
    this.m_units = aUnits;
  }

  GetUnitsMode(): DIM_UNITS_MODE {
    if (this.m_autoUnits) {
      return DIM_UNITS_MODE.AUTOMATIC;
    } else {
      switch (this.m_units) {
        case 'mm':
          return DIM_UNITS_MODE.MM;
        case 'mils':
          return DIM_UNITS_MODE.MILS;
        default:
          return DIM_UNITS_MODE.INCH;
      }
    }
  }

  SetUnitsMode(aMode: DIM_UNITS_MODE): void {
    switch (aMode) {
      case DIM_UNITS_MODE.INCH:
        this.m_autoUnits = false;
        this.m_units = 'in';
        break;

      case DIM_UNITS_MODE.MILS:
        this.m_autoUnits = false;
        this.m_units = 'mils';
        break;

      case DIM_UNITS_MODE.MM:
        this.m_autoUnits = false;
        this.m_units = 'mm';
        break;

      case DIM_UNITS_MODE.AUTOMATIC: {
        this.m_autoUnits = true;
        const board = this.GetBoard();
        this.m_units = board ? board.GetUserUnits() : 'mm';
        break;
      }
    }
  }

  ChangeUnitsMode(aMode: DIM_UNITS_MODE): void {
    this.SetUnitsMode(aMode);
    this.Update();
  }

  SetAutoUnits(aAuto = true): void {
    this.m_autoUnits = aAuto;
  }

  GetUnitsFormat(): DIM_UNITS_FORMAT {
    return this.m_unitsFormat;
  }
  SetUnitsFormat(aFormat: DIM_UNITS_FORMAT): void {
    this.m_unitsFormat = aFormat;
  }

  ChangeUnitsFormat(aFormat: DIM_UNITS_FORMAT): void {
    this.SetUnitsFormat(aFormat);
    this.Update();
  }

  GetPrecision(): DIM_PRECISION {
    return this.m_precision;
  }
  SetPrecision(aPrecision: DIM_PRECISION): void {
    this.m_precision = aPrecision;
  }

  ChangePrecision(aPrecision: DIM_PRECISION): void {
    this.SetPrecision(aPrecision);
    this.Update();
  }

  GetSuppressZeroes(): boolean {
    return this.m_suppressZeroes;
  }
  SetSuppressZeroes(aSuppress: boolean): void {
    this.m_suppressZeroes = aSuppress;
  }

  ChangeSuppressZeroes(aSuppress: boolean): void {
    this.SetSuppressZeroes(aSuppress);
    this.Update();
  }

  GetKeepTextAligned(): boolean {
    return this.m_keepTextAligned;
  }
  SetKeepTextAligned(aKeepAligned: boolean): void {
    this.m_keepTextAligned = aKeepAligned;
  }

  GetTextAngleDegreesProp(): number {
    return this.GetTextAngleDegrees();
  }

  ChangeTextAngleDegrees(aDegrees: number): void {
    this.SetTextAngleDegrees(aDegrees);
    // Create or repair any knockouts
    this.Update();
  }

  ChangeKeepTextAligned(aKeepAligned: boolean): void {
    this.SetKeepTextAligned(aKeepAligned);
    // Re-align the text and repair any knockouts
    this.Update();
  }

  SetTextPositionMode(aMode: DIM_TEXT_POSITION): void {
    this.m_textPosition = aMode;
  }
  GetTextPositionMode(): DIM_TEXT_POSITION {
    return this.m_textPosition;
  }

  GetArrowLength(): number {
    return this.m_arrowLength;
  }
  SetArrowLength(aLength: number): void {
    this.m_arrowLength = aLength;
  }

  SetExtensionOffset(aOffset: number): void {
    this.m_extensionOffset = aOffset;
  }
  GetExtensionOffset(): number {
    return this.m_extensionOffset;
  }

  GetLineThickness(): number {
    return this.m_lineThickness;
  }
  SetLineThickness(aWidth: number): void {
    this.m_lineThickness = aWidth;
  }

  override StyleFromSettings(settings: BOARD_DESIGN_SETTINGS, aCheckSide: boolean): void {
    PCB_TEXT.prototype.StyleFromSettings.call(this, settings, aCheckSide);

    this.SetLineThickness(settings.GetLineThickness(this.m_layer));
    this.SetUnitsMode(settings.m_DimensionUnitsMode);
    this.SetUnitsFormat(settings.m_DimensionUnitsFormat);
    this.SetPrecision(settings.m_DimensionPrecision);
    this.SetSuppressZeroes(settings.m_DimensionSuppressZeroes);
    this.SetTextPositionMode(settings.m_DimensionTextPosition);
    this.SetKeepTextAligned(settings.m_DimensionKeepTextAligned);

    this.Update(); // refresh text & geometry
  }

  /**
   * @return a list of line segments that make up this dimension (for drawing, plotting, etc).
   */
  GetShapes(): readonly SHAPE[] {
    return this.m_shapes;
  }

  // BOARD_ITEM overrides

  override Move(offset: VECTOR2I): void {
    PCB_TEXT.prototype.Offset.call(this, offset);

    this.m_start = add(this.m_start, offset);
    this.m_end = add(this.m_end, offset);

    this.Update();
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    const newAngle = this.GetTextAngle().add(aAngle);

    newAngle.Normalize();

    this.SetTextAngle(newAngle);

    let pt = this.GetTextPos();
    pt = RotatePoint(pt, aRotCentre, aAngle);
    this.SetTextPos(pt);

    this.m_start = RotatePoint(this.m_start, aRotCentre, aAngle);
    this.m_end = RotatePoint(this.m_end, aRotCentre, aAngle);

    this.Update();
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.Mirror(aCentre, aFlipDirection);

    this.SetLayer(this.GetBoard()!.FlipLayer(this.GetLayer()));
  }

  /**
   * Mirror the dimension relative to a given horizontal axis.
   *
   * The text is not mirrored.  Only its position (and angle) is mirrored.  The layer is not
   * changed.
   *
   * @param axis_pos is the vertical axis position to mirror around.
   */
  override Mirror(axis_pos: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    const newPos = { ...this.GetTextPos() };

    MIRROR(newPos, axis_pos, aFlipDirection);

    this.SetTextPos(newPos);

    // invert angle
    this.SetTextAngle(this.GetTextAngle().negate());

    MIRROR(this.m_start, axis_pos, aFlipDirection);
    MIRROR(this.m_end, axis_pos, aFlipDirection);

    if (this.IsSideSpecific()) this.SetMirrored(!this.IsMirrored());

    this.Update();
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    // for now, display only the text within the DIMENSION using class PCB_TEXT.
    let msg: string;

    if (this.m_parent === null) return; // wxCHECK_RET( m_parent != nullptr, "PCB_TEXT::GetMsgPanelInfo() m_Parent is NULL." )

    // Don't use GetShownText(); we want to see the variable references here
    aList.push(new MSG_PANEL_ITEM('Dimension', KIUI_EllipsizeStatusText(aFrame, this.GetText())));

    aList.push(new MSG_PANEL_ITEM('Prefix', this.GetPrefix()));

    if (this.GetOverrideTextEnabled()) {
      aList.push(new MSG_PANEL_ITEM('Override Text', this.GetOverrideText()));
    } else {
      aList.push(new MSG_PANEL_ITEM('Value', this.GetValueText()));

      switch (this.GetPrecision()) {
        case DIM_PRECISION.V_VV:
          msg = '0.00 in / 0 mils / 0.0 mm';
          break;
        case DIM_PRECISION.V_VVV:
          msg = '0.000 in / 0 mils / 0.00 mm';
          break;
        case DIM_PRECISION.V_VVVV:
          msg = '0.0000 in / 0.0 mils / 0.000 mm';
          break;
        case DIM_PRECISION.V_VVVVV:
          msg = '0.00000 in / 0.00 mils / 0.0000 mm';
          break;
        default:
          msg = (0.0).toFixed(this.GetPrecision()); // wxString::Format( "%1.<precision>f", 0.0 )
      }

      aList.push(new MSG_PANEL_ITEM('Precision', msg));
    }

    aList.push(new MSG_PANEL_ITEM('Suffix', this.GetSuffix()));

    // Use our own UNITS_PROVIDER to report dimension info in dimension's units rather than
    // in frame's units.
    const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'mm');
    unitsProvider.SetUserUnits(this.GetUnits());

    aList.push(new MSG_PANEL_ITEM('Units', unitLabel(this.GetUnits())));

    aList.push(new MSG_PANEL_ITEM('Font', this.GetFont() ? this.GetFont()!.GetName() : 'Default'));
    aList.push(
      new MSG_PANEL_ITEM(
        'Text Thickness',
        unitsProvider.MessageTextFromValue(this.GetTextThickness()),
      ),
    );
    aList.push(
      new MSG_PANEL_ITEM('Text Width', unitsProvider.MessageTextFromValue(this.GetTextWidth())),
    );
    aList.push(
      new MSG_PANEL_ITEM('Text Height', unitsProvider.MessageTextFromValue(this.GetTextHeight())),
    );

    const originTransforms = aFrame.GetOriginTransforms();

    if (this.Type() === KICAD_T.PCB_DIM_CENTER_T) {
      const startCoord = originTransforms.ToDisplayAbs(this.GetStart());
      const start = `@(${aFrame.MessageTextFromValue(startCoord.x)}, ${aFrame.MessageTextFromValue(startCoord.y)})`;

      aList.push(new MSG_PANEL_ITEM(start, ''));
    } else {
      const startCoord = originTransforms.ToDisplayAbs(this.GetStart());
      const start = `@(${aFrame.MessageTextFromValue(startCoord.x)}, ${aFrame.MessageTextFromValue(startCoord.y)})`;
      const endCoord = originTransforms.ToDisplayAbs(this.GetEnd());
      const end = `@(${aFrame.MessageTextFromValue(endCoord.x)}, ${aFrame.MessageTextFromValue(endCoord.y)})`;

      aList.push(new MSG_PANEL_ITEM(start, end));
    }

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME && this.IsLocked())
      aList.push(new MSG_PANEL_ITEM('Status', 'Locked'));

    aList.push(new MSG_PANEL_ITEM('Layer', this.GetLayerName()));
  }

  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    const effectiveShape = new SHAPE_COMPOUND();
    effectiveShape.AddShape(this.GetEffectiveTextShape().Clone());

    for (const shape of this.GetShapes()) effectiveShape.AddShape(shape.Clone());

    return effectiveShape;
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) return this.hitTestRect(a, b as boolean, c ?? 0);

    if (isPoint(a)) return this.hitTestPoint(a, (b as number | undefined) ?? 0);

    return this.hitTestChain(a, b as boolean);
  }

  /** `HitTest( const VECTOR2I& aPosition, int aAccuracy )`. */
  protected hitTestPoint(aPosition: VECTOR2I, aAccuracy: number): boolean {
    if (this.TextHitTest(aPosition)) return true;

    const dist_max = aAccuracy + Math.trunc(this.m_lineThickness / 2);

    // Locate SEGMENTS
    for (const shape of this.GetShapes()) {
      if (shape.Collide(aPosition, dist_max)) return true;
    }

    return false;
  }

  /** `HitTest( const BOX2I& aRect, bool aContained, int aAccuracy )`. */
  protected hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    const arect = aRect.Clone();
    arect.Inflate(aAccuracy);

    const rect = this.GetBoundingBox();

    if (aAccuracy) rect.Inflate(aAccuracy);

    if (aContained) return arect.Contains(rect);

    return arect.Intersects(rect);
  }

  /** `HitTest( const SHAPE_LINE_CHAIN& aPoly, bool aContained )`. */
  protected hitTestChain(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean {
    // Note: Can't use GetEffectiveShape() because we want text as BoundingBox, not as graphics.
    const effShape = new SHAPE_COMPOUND();

    // Add shapes
    for (const shape of this.GetShapes()) effShape.AddShape(shape);

    if (aContained)
      return (
        this.TextHitTest(aPoly, aContained) && KIGEOM_ShapeHitTest(aPoly, effShape, aContained)
      );
    else
      return (
        this.TextHitTest(aPoly, aContained) || KIGEOM_ShapeHitTest(aPoly, effShape, aContained)
      );
  }

  override GetBoundingBox(): BOX2I {
    let xmin: number;
    let xmax: number;
    let ymin: number;
    let ymax: number;

    const bBox = this.GetTextBox(null);
    xmin = bBox.GetX();
    xmax = bBox.GetRight();
    ymin = bBox.GetY();
    ymax = bBox.GetBottom();

    for (const shape of this.GetShapes()) {
      const shapeBox = shape.BBox();
      shapeBox.Inflate(Math.trunc(this.m_lineThickness / 2));
      xmin = Math.min(xmin, shapeBox.GetOrigin().x);
      xmax = Math.max(xmax, shapeBox.GetEnd().x);
      ymin = Math.min(ymin, shapeBox.GetOrigin().y);
      ymax = Math.max(ymax, shapeBox.GetEnd().y);
    }

    bBox.SetX(xmin);
    bBox.SetY(ymin);
    bBox.SetWidth(xmax - xmin + 1);
    bBox.SetHeight(ymax - ymin + 1);
    bBox.Normalize();

    return bBox;
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Dimension '${aFull ? this.GetShownText(false) : KIUI_EllipsizeMenuText(this.GetText())}' on ${this.GetLayerName()}`;
  }

  override ViewBBox(): BOX2I {
    const dimBBox = new BOX2I(this.GetBoundingBox().GetPosition(), this.GetBoundingBox().GetSize());
    dimBBox.Merge(PCB_TEXT.prototype.ViewBBox.call(this));

    return dimBBox;
  }

  override ClearRenderCache(): void {
    // A C++ base-class constructor dispatches to the base's virtual: the guard field is not
    // set until this constructor has run.
    if (this.m_inClearRenderCache === undefined) {
      PCB_TEXT.prototype.ClearRenderCache.call(this);
      return;
    }

    PCB_TEXT.prototype.ClearRenderCache.call(this);

    // We use EDA_TEXT::ClearRenderCache() as a signal that the properties of the EDA_TEXT
    // have changed and we may need to update the dimension text
    if (!this.m_inClearRenderCache) {
      this.m_inClearRenderCache = true;
      this.Update();
      this.m_inClearRenderCache = false;
    }
  }

  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    aIgnoreLineWidth = false,
  ): void {
    console.assert(!aIgnoreLineWidth, 'IgnoreLineWidth has no meaning for dimensions.');

    for (const shape of this.m_shapes) {
      if (shape instanceof SHAPE_CIRCLE) {
        TransformCircleToPolygon(
          aBuffer,
          shape.GetCenter(),
          shape.GetRadius() + Math.trunc(this.m_lineThickness / 2) + aClearance,
          aError,
          aErrorLoc,
        );
      } else if (shape instanceof SHAPE_SEGMENT) {
        TransformOvalToPolygon(
          aBuffer,
          shape.GetSeg().A,
          shape.GetSeg().B,
          this.m_lineThickness + 2 * aClearance,
          aError,
          aErrorLoc,
        );
      } else {
        console.assert(false, 'PCB_DIMENSION_BASE::TransformShapeToPolygon unknown shape type.');
      }
    }
  }

  override Similarity(aOther: BOARD_ITEM | EDA_TEXT): number {
    if (!isBoardItem(aOther)) return EDA_TEXT.prototype.Similarity.call(this, aOther);

    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    if (this.Type() !== aOther.Type()) return 0.0;

    const other = aOther as PCB_DIMENSION_BASE;

    let similarity = 1.0;

    if (this.m_textPosition !== other.m_textPosition) similarity *= 0.9;

    if (this.m_keepTextAligned !== other.m_keepTextAligned) similarity *= 0.9;

    if (this.m_units !== other.m_units) similarity *= 0.9;

    if (this.m_autoUnits !== other.m_autoUnits) similarity *= 0.9;

    if (this.m_unitsFormat !== other.m_unitsFormat) similarity *= 0.9;

    if (this.m_precision !== other.m_precision) similarity *= 0.9;

    if (this.m_suppressZeroes !== other.m_suppressZeroes) similarity *= 0.9;

    if (this.m_lineThickness !== other.m_lineThickness) similarity *= 0.9;

    if (this.m_arrowLength !== other.m_arrowLength) similarity *= 0.9;

    if (this.m_extensionOffset !== other.m_extensionOffset) similarity *= 0.9;

    if (this.m_measuredValue !== other.m_measuredValue) similarity *= 0.9;

    similarity *= EDA_TEXT.prototype.Similarity.call(this, other as unknown as EDA_TEXT);

    return similarity;
  }

  /** `operator==( const BOARD_ITEM& )`. */
  override equals(aBoardItem: BOARD_ITEM): boolean {
    if (this.Type() !== aBoardItem.Type()) return false;

    const other = aBoardItem as PCB_DIMENSION_BASE;

    return this.equalsDimension(other);
  }

  /** `operator==( const PCB_DIMENSION_BASE& )`. */
  equalsDimension(aOther: PCB_DIMENSION_BASE): boolean {
    if (this.m_textPosition !== aOther.m_textPosition) return false;

    if (this.m_keepTextAligned !== aOther.m_keepTextAligned) return false;

    if (this.m_units !== aOther.m_units) return false;

    if (this.m_autoUnits !== aOther.m_autoUnits) return false;

    if (this.m_unitsFormat !== aOther.m_unitsFormat) return false;

    if (this.m_precision !== aOther.m_precision) return false;

    if (this.m_suppressZeroes !== aOther.m_suppressZeroes) return false;

    if (this.m_lineThickness !== aOther.m_lineThickness) return false;

    if (this.m_arrowLength !== aOther.m_arrowLength) return false;

    if (this.m_extensionOffset !== aOther.m_extensionOffset) return false;

    if (this.m_measuredValue !== aOther.m_measuredValue) return false;

    return this.equalsEdaText(aOther as unknown as EDA_TEXT);
  }

  /**
   * Update the cached geometry of the dimension after changing any of its properties.
   */
  protected abstract updateGeometry(): void;

  /**
   * Update the text field value from the current geometry (called by updateGeometry normally).
   *
   * If you change the text, you should call updateGeometry which will call this,
   * and also handle any text-dependent geoemtry handling (like a knockout)
   */
  protected updateText(): void {
    let text = this.m_overrideTextEnabled ? this.m_valueString : this.GetValueText();

    switch (this.m_unitsFormat) {
      case DIM_UNITS_FORMAT.NO_SUFFIX: // no units
        break;

      case DIM_UNITS_FORMAT.BARE_SUFFIX: // normal
        text += unitLabelText(this.m_units);
        break;

      case DIM_UNITS_FORMAT.PAREN_SUFFIX: // parenthetical
        text += ` (${unitLabelText(this.m_units).trimStart()})`;
        break;
    }

    text = this.m_prefix + text;
    text = text + this.m_suffix;

    this.SetText(text);
  }

  protected addShape(aShape: SHAPE): void {
    this.m_shapes.push(aShape.Clone());
  }

  /**
   * Draws an arrow and updates the shape container.
   * example arrow 0Deg tail:4  (---->)
   *
   * @param startPoint arrow point.
   * @param anAngle arrow angle.
   * @param aLength arrow tail length.
   */
  protected drawAnArrow(aStartPoint: VECTOR2I, anAngle: EDA_ANGLE, aLength: number): void {
    const startPoint = aStartPoint;

    if (aLength) {
      let tailEnd: VECTOR2I = { x: aLength, y: 0 };
      tailEnd = RotatePoint(tailEnd, anAngle.negate());
      this.m_shapes.push(new SHAPE_SEGMENT(startPoint, add(startPoint, tailEnd)));
    }

    let arrowEndPos: VECTOR2I = { x: this.m_arrowLength, y: 0 };
    let arrowEndNeg: VECTOR2I = { x: this.m_arrowLength, y: 0 };

    arrowEndPos = RotatePoint(arrowEndPos, anAngle.negate().add(s_arrowAngle));
    arrowEndNeg = RotatePoint(arrowEndNeg, anAngle.negate().sub(s_arrowAngle));

    this.m_shapes.push(new SHAPE_SEGMENT(startPoint, add(startPoint, arrowEndPos)));
    this.m_shapes.push(new SHAPE_SEGMENT(startPoint, add(startPoint, arrowEndNeg)));
  }
}

/**
 * For better understanding of the points that make a dimension:
 *
 * Note: dimensions are always drawn such that the text is at the top of the dimension line,
 * regardless of the dimension's orientation.
 *
 * The extension lines start at the feature points and extend perpendicular to the crossbar.
 */
export class PCB_DIM_ALIGNED extends PCB_DIMENSION_BASE {
  // Geometry
  protected m_height!: number; ///< Perpendicular distance from features to crossbar
  protected m_extensionHeight!: number; ///< Length of extension lines past the crossbar

  protected m_crossBarStart!: VECTOR2I; ///< Crossbar start control point
  protected m_crossBarEnd!: VECTOR2I; ///< Crossbar end control point

  constructor(aParent: BOARD_ITEM | null, aType: KICAD_T = KICAD_T.PCB_DIM_ALIGNED_T) {
    super(aParent, aType);
    this.m_height = 0;
    this.m_crossBarStart = { x: 0, y: 0 };
    this.m_crossBarEnd = { x: 0, y: 0 };

    // To preserve look of old dimensions, initialize extension height based on default arrow length
    this.m_extensionHeight = toInt(this.m_arrowLength * s_arrowAngle.Sin());
  }

  // Do not create a copy constructor & operator=.
  // The ones generated by the compiler are adequate.

  /** `PCB_DIM_ALIGNED( const PCB_DIM_ALIGNED& )`: the compiler-generated copy, as a static. */
  static copyOfAligned(aOther: PCB_DIM_ALIGNED): PCB_DIM_ALIGNED {
    const copy = new PCB_DIM_ALIGNED(null, aOther.Type());
    copy.assignAligned(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** The compiler-generated `operator=`. */
  assignAligned(aOther: PCB_DIM_ALIGNED): this {
    this.assignDimensionBase(aOther);
    this.m_height = aOther.m_height;
    this.m_extensionHeight = aOther.m_extensionHeight;
    this.m_crossBarStart = { ...aOther.m_crossBarStart };
    this.m_crossBarEnd = { ...aOther.m_crossBarEnd };
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_DIM_ALIGNED_T)) return; // wxCHECK

    this.assignAligned(aOther as PCB_DIM_ALIGNED);
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && aItem.Type() === KICAD_T.PCB_DIM_ALIGNED_T;
  }

  override Clone(): PCB_DIM_ALIGNED {
    return PCB_DIM_ALIGNED.copyOfAligned(this);
  }

  override Mirror(axis_pos: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.m_height = -this.m_height;
    // Call this last for the Update()
    PCB_DIMENSION_BASE.prototype.Mirror.call(this, axis_pos, aFlipDirection);
  }

  override GetMenuImage(): string {
    return 'add_aligned_dimension'; // BITMAPS::add_aligned_dimension
  }

  GetCrossbarStart(): VECTOR2I {
    return this.m_crossBarStart;
  }
  GetCrossbarEnd(): VECTOR2I {
    return this.m_crossBarEnd;
  }

  /**
   * Set the distance from the feature points to the crossbar line.
   *
   * @param aHeight is the new height.
   */
  SetHeight(aHeight: number): void {
    this.m_height = aHeight;
  }
  GetHeight(): number {
    return this.m_height;
  }

  ChangeHeight(aHeight: number): void {
    this.SetHeight(aHeight);
    this.Update();
  }

  /**
   * Update the stored height basing on points coordinates.
   *
   * @param aCrossbarStart is the start point of the crossbar.
   */
  UpdateHeight(aCrossbarStart: VECTOR2I, aCrossbarEnd: VECTOR2I): void {
    const height = sub(aCrossbarStart, this.GetStart()); // VECTOR2D
    const crossBar = sub(aCrossbarEnd, aCrossbarStart); // VECTOR2D

    // height.Cross( crossBar )
    if (height.x * crossBar.y - height.y * crossBar.x > 0)
      this.m_height = toInt(-EuclideanNorm(height));
    else this.m_height = toInt(EuclideanNorm(height));

    this.Update();
  }

  SetExtensionHeight(aHeight: number): void {
    this.m_extensionHeight = aHeight;
  }
  GetExtensionHeight(): number {
    return this.m_extensionHeight;
  }

  ChangeExtensionHeight(aHeight: number): void {
    this.SetExtensionHeight(aHeight);
    this.Update();
  }

  /**
   * Return the angle of the crossbar.
   *
   * @return Angle of the crossbar line expressed in radians.
   */
  GetAngle(): number {
    const delta = sub(this.m_end, this.m_start);

    return Math.atan2(delta.y, delta.x);
  }

  override GetClass(): string {
    return 'PCB_DIM_ALIGNED';
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    PCB_DIMENSION_BASE.prototype.GetMsgPanelInfo.call(this, aFrame, aList);

    // Use our own UNITS_PROVIDER to report dimension info in dimension's units rather than
    // in frame's units.
    const unitsProvider = new UNITS_PROVIDER(pcbIUScale, 'mm');
    unitsProvider.SetUserUnits(this.GetUnits());

    aList.push(new MSG_PANEL_ITEM('Height', unitsProvider.MessageTextFromValue(this.m_height)));
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === this.Type());

    const image = aImage as PCB_DIM_ALIGNED;

    this.m_shapes.length = 0;
    image.m_shapes.length = 0;

    // std::swap( *this, *aImage ): every member of both classes.
    const mine = PCB_DIM_ALIGNED.copyOfAligned(this);
    this.assignAligned(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    image.assignAligned(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;

    this.Update();
  }

  protected override updateGeometry(): void {
    if (this.m_busy)
      // Skeep reentrance that happens sometimes after calling updateText()
      return;

    this.m_busy = true;
    this.m_shapes.length = 0;

    const dimension = sub(this.m_end, this.m_start);

    this.m_measuredValue = KiROUND(EuclideanNormI(dimension));

    let extension: VECTOR2I;

    if (this.m_height > 0) extension = { x: -dimension.y, y: dimension.x };
    else extension = { x: dimension.y, y: -dimension.x };

    // Add extension lines
    const extensionHeight =
      Math.abs(this.m_height) - this.m_extensionOffset + this.m_extensionHeight;

    let extStart: VECTOR2I = { ...this.m_start };
    extStart = add(extStart, ResizeI(extension, this.m_extensionOffset));

    this.addShape(new SHAPE_SEGMENT(extStart, add(extStart, ResizeI(extension, extensionHeight))));

    extStart = { ...this.m_end };
    extStart = add(extStart, ResizeI(extension, this.m_extensionOffset));

    this.addShape(new SHAPE_SEGMENT(extStart, add(extStart, ResizeI(extension, extensionHeight))));

    // Add crossbar
    const crossBarDistance = scale(ResizeI(extension, this.m_height), sign(this.m_height));
    this.m_crossBarStart = add(this.m_start, crossBarDistance);
    this.m_crossBarEnd = add(this.m_end, crossBarDistance);

    // Update text after calculating crossbar position but before adding crossbar lines
    this.updateText();

    // Now that we have the text updated, we can determine how to draw the crossbar.
    // First we need to create an appropriate bounding polygon to collide with
    const textBox = this.GetTextBox(null).Inflate(
      Math.trunc(this.GetTextWidth() / 2),
      -this.GetEffectiveTextPenWidth(),
    );

    const polyBox = polyBoxOf(textBox, this.GetTextAngle());

    // The ideal crossbar, if the text doesn't collide
    const crossbar = new SEG(this.m_crossBarStart, this.m_crossBarEnd);

    CollectKnockedOutSegments(polyBox, crossbar, this.m_shapes);

    if (this.m_arrowDirection === DIM_ARROW_DIRECTION.INWARD) {
      this.drawAnArrow(
        this.m_crossBarStart,
        EDA_ANGLE.fromVector(dimension).add(new EDA_ANGLE(180)),
        this.m_arrowLength * INWARD_ARROW_LENGTH_TO_HEAD_RATIO,
      );
      this.drawAnArrow(
        this.m_crossBarEnd,
        EDA_ANGLE.fromVector(dimension),
        this.m_arrowLength * INWARD_ARROW_LENGTH_TO_HEAD_RATIO,
      );
    } else {
      this.drawAnArrow(this.m_crossBarStart, EDA_ANGLE.fromVector(dimension), 0);
      this.drawAnArrow(
        this.m_crossBarEnd,
        EDA_ANGLE.fromVector(dimension).add(new EDA_ANGLE(180)),
        0,
      );
    }

    this.m_busy = false;
  }

  protected override updateText(): void {
    const crossbarCenter = divideI(sub(this.m_crossBarEnd, this.m_crossBarStart), 2);

    if (this.m_textPosition === DIM_TEXT_POSITION.OUTSIDE) {
      const textOffsetDistance = this.GetEffectiveTextPenWidth() + this.GetTextHeight();
      let rotation: EDA_ANGLE;

      if (crossbarCenter.x === 0)
        rotation = new EDA_ANGLE(ANGLE_90.AsDegrees() * sign(-crossbarCenter.y));
      else if (crossbarCenter.x < 0) rotation = ANGLE_90.negate();
      else rotation = ANGLE_90;

      let textOffset: VECTOR2I = { ...crossbarCenter };
      textOffset = RotatePoint(textOffset, rotation);
      textOffset = add(crossbarCenter, ResizeI(textOffset, textOffsetDistance));

      this.SetTextPos(add(this.m_crossBarStart, textOffset));
    } else if (this.m_textPosition === DIM_TEXT_POSITION.INLINE) {
      this.SetTextPos(add(this.m_crossBarStart, crossbarCenter));
    }

    if (this.m_keepTextAligned) {
      let textAngle = FULL_CIRCLE.sub(EDA_ANGLE.fromVector(crossbarCenter));

      textAngle.Normalize();

      if (textAngle.gt(ANGLE_90) && textAngle.le(ANGLE_270)) textAngle = textAngle.sub(ANGLE_180);

      this.SetTextAngle(textAngle);
    }

    super.updateText();
  }
}

/**
 * An orthogonal dimension is like an aligned but the extension lines are locked to the X or Y
 * axes, and the measurement is only taken in the X or Y direction.
 */
export class PCB_DIM_ORTHOGONAL extends PCB_DIM_ALIGNED {
  static readonly DIR = { HORIZONTAL: 0, VERTICAL: 1 } as const;

  // Geometry
  private m_orientation!: PCB_DIM_ORTHOGONAL_DIR; ///< What axis to lock the dimension line to.

  constructor(aParent: BOARD_ITEM | null) {
    super(aParent, KICAD_T.PCB_DIM_ORTHOGONAL_T);

    // To preserve look of old dimensions, initialize extension height based on default arrow length
    this.m_extensionHeight = toInt(this.m_arrowLength * s_arrowAngle.Sin());
    this.m_orientation = PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL;
  }

  /** `PCB_DIM_ORTHOGONAL( const PCB_DIM_ORTHOGONAL& )`: the compiler-generated copy, as a static. */
  static copyOfOrthogonal(aOther: PCB_DIM_ORTHOGONAL): PCB_DIM_ORTHOGONAL {
    const copy = new PCB_DIM_ORTHOGONAL(null);
    copy.assignOrthogonal(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** The compiler-generated `operator=`. */
  assignOrthogonal(aOther: PCB_DIM_ORTHOGONAL): this {
    this.assignAligned(aOther);
    this.m_orientation = aOther.m_orientation;
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_DIM_ORTHOGONAL_T)) return; // wxCHECK

    this.assignOrthogonal(aOther as PCB_DIM_ORTHOGONAL);
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && aItem.Type() === KICAD_T.PCB_DIM_ORTHOGONAL_T;
  }

  override Clone(): PCB_DIM_ORTHOGONAL {
    return PCB_DIM_ORTHOGONAL.copyOfOrthogonal(this);
  }

  override Mirror(axis_pos: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    // Only reverse the height if the height is aligned with the flip
    if (
      this.m_orientation === PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL &&
      aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM
    )
      this.m_height = -this.m_height;
    else if (
      this.m_orientation === PCB_DIM_ORTHOGONAL.DIR.VERTICAL &&
      aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT
    )
      this.m_height = -this.m_height;

    // Call this last, as we need the Update()
    PCB_DIMENSION_BASE.prototype.Mirror.call(this, axis_pos, aFlipDirection);
  }

  override GetMenuImage(): string {
    return 'add_orthogonal_dimension'; // BITMAPS::add_orthogonal_dimension
  }

  /**
   * Set the orientation of the dimension line (so, perpendicular to the feature lines).
   *
   * @param aOrientation is the orientation the dimension should take.
   */
  SetOrientation(aOrientation: PCB_DIM_ORTHOGONAL_DIR): void {
    this.m_orientation = aOrientation;
  }
  GetOrientation(): PCB_DIM_ORTHOGONAL_DIR {
    return this.m_orientation;
  }

  override GetClass(): string {
    return 'PCB_DIM_ORTHOGONAL';
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    const angle = aAngle.Clone();

    // restrict angle to -179.9 to 180.0 degrees
    angle.Normalize180();

    // adjust orientation and height to new angle
    // we can only handle the cases of -90, 0, 90, 180 degrees exactly;
    // in the other cases we will use the nearest 90 degree angle to
    // choose at least an approximate axis for the target orientation
    // In case of exactly 45 or 135 degrees, we will round towards zero for consistency
    if (angle.gt(ANGLE_45) && angle.le(ANGLE_135)) {
      // about 90 degree
      if (this.m_orientation === PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL) {
        this.m_orientation = PCB_DIM_ORTHOGONAL.DIR.VERTICAL;
      } else {
        this.m_orientation = PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL;
        this.m_height = -this.m_height;
      }
    } else if (angle.lt(ANGLE_45.negate()) && angle.ge(ANGLE_135.negate())) {
      // about -90 degree
      if (this.m_orientation === PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL) {
        this.m_orientation = PCB_DIM_ORTHOGONAL.DIR.VERTICAL;
        this.m_height = -this.m_height;
      } else {
        this.m_orientation = PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL;
      }
    } else if (angle.gt(ANGLE_135) || angle.lt(ANGLE_135.negate())) {
      // about 180 degree
      this.m_height = -this.m_height;
    }

    // this will update m_crossBarStart and m_crossbarEnd
    PCB_DIMENSION_BASE.prototype.Rotate.call(this, aRotCentre, angle);
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === this.Type());

    const image = aImage as PCB_DIM_ORTHOGONAL;

    this.m_shapes.length = 0;
    image.m_shapes.length = 0;

    // std::swap( *this, *aImage ): every member of both classes.
    const mine = PCB_DIM_ORTHOGONAL.copyOfOrthogonal(this);
    this.assignOrthogonal(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    image.assignOrthogonal(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;

    this.Update();
  }

  protected override updateGeometry(): void {
    if (this.m_busy)
      // Skeep reentrance that happens sometimes after calling updateText()
      return;

    this.m_busy = true;
    this.m_shapes.length = 0;

    const HORIZONTAL = PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL;

    const measurement =
      this.m_orientation === HORIZONTAL
        ? this.m_end.x - this.m_start.x
        : this.m_end.y - this.m_start.y;
    this.m_measuredValue = KiROUND(Math.abs(measurement));

    let extension: VECTOR2I;

    if (this.m_orientation === HORIZONTAL) extension = { x: 0, y: this.m_height };
    else extension = { x: this.m_height, y: 0 };

    // Add first extension line
    let extensionHeight = Math.abs(this.m_height) - this.m_extensionOffset + this.m_extensionHeight;

    let extStart: VECTOR2I = { ...this.m_start };
    extStart = add(extStart, ResizeI(extension, this.m_extensionOffset));

    this.addShape(new SHAPE_SEGMENT(extStart, add(extStart, ResizeI(extension, extensionHeight))));

    // Add crossbar
    const crossBarDistance = scale(ResizeI(extension, this.m_height), sign(this.m_height));
    this.m_crossBarStart = add(this.m_start, crossBarDistance);

    if (this.m_orientation === HORIZONTAL)
      this.m_crossBarEnd = { x: this.m_end.x, y: this.m_crossBarStart.y };
    else this.m_crossBarEnd = { x: this.m_crossBarStart.x, y: this.m_end.y };

    // Add second extension line (m_end to crossbar end)
    if (this.m_orientation === HORIZONTAL)
      extension = { x: 0, y: this.m_end.y - this.m_crossBarEnd.y };
    else extension = { x: this.m_end.x - this.m_crossBarEnd.x, y: 0 };

    extensionHeight = EuclideanNormI(extension) - this.m_extensionOffset + this.m_extensionHeight;

    extStart = { ...this.m_crossBarEnd };
    extStart = sub(extStart, ResizeI(extension, this.m_extensionHeight));

    this.addShape(new SHAPE_SEGMENT(extStart, add(extStart, ResizeI(extension, extensionHeight))));

    // Update text after calculating crossbar position but before adding crossbar lines
    this.updateText();

    // Now that we have the text updated, we can determine how to draw the crossbar.
    // First we need to create an appropriate bounding polygon to collide with
    const textBox = this.GetTextBox(null).Inflate(
      Math.trunc(this.GetTextWidth() / 2),
      this.GetEffectiveTextPenWidth(),
    );

    const polyBox = polyBoxOf(textBox, this.GetTextAngle());

    // The ideal crossbar, if the text doesn't collide
    const crossbar = new SEG(this.m_crossBarStart, this.m_crossBarEnd);

    CollectKnockedOutSegments(polyBox, crossbar, this.m_shapes);

    const crossBarAngle = EDA_ANGLE.fromVector(sub(this.m_crossBarEnd, this.m_crossBarStart));

    if (this.m_arrowDirection === DIM_ARROW_DIRECTION.INWARD) {
      // Arrows with fixed length.
      this.drawAnArrow(
        this.m_crossBarStart,
        crossBarAngle.add(new EDA_ANGLE(180)),
        this.m_arrowLength * INWARD_ARROW_LENGTH_TO_HEAD_RATIO,
      );
      this.drawAnArrow(
        this.m_crossBarEnd,
        crossBarAngle,
        this.m_arrowLength * INWARD_ARROW_LENGTH_TO_HEAD_RATIO,
      );
    } else {
      this.drawAnArrow(this.m_crossBarStart, crossBarAngle, 0);
      this.drawAnArrow(this.m_crossBarEnd, crossBarAngle.add(new EDA_ANGLE(180)), 0);
    }

    this.m_busy = false;
  }

  protected override updateText(): void {
    const crossbarCenter = divideI(sub(this.m_crossBarEnd, this.m_crossBarStart), 2);

    if (this.m_textPosition === DIM_TEXT_POSITION.OUTSIDE) {
      const textOffsetDistance = this.GetEffectiveTextPenWidth() + this.GetTextHeight();

      let textOffset: VECTOR2I = { x: 0, y: 0 };

      if (this.m_orientation === PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL)
        textOffset.y = -textOffsetDistance;
      else textOffset.x = -textOffsetDistance;

      textOffset = add(textOffset, crossbarCenter);

      this.SetTextPos(add(this.m_crossBarStart, textOffset));
    } else if (this.m_textPosition === DIM_TEXT_POSITION.INLINE) {
      this.SetTextPos(add(this.m_crossBarStart, crossbarCenter));
    }

    if (this.m_keepTextAligned) {
      if (Math.abs(crossbarCenter.x) > Math.abs(crossbarCenter.y))
        this.SetTextAngle(ANGLE_HORIZONTAL);
      else this.SetTextAngle(ANGLE_VERTICAL);
    }

    super.updateText();
  }
}

/** `PCB_DIM_ORTHOGONAL::DIR`. */
export type PCB_DIM_ORTHOGONAL_DIR =
  (typeof PCB_DIM_ORTHOGONAL.DIR)[keyof typeof PCB_DIM_ORTHOGONAL.DIR];

/**
 * A radial dimension indicates either the radius or diameter of an arc or circle.
 *
 * A guide to the geometry of a radial dimension:
 *
 *  |
 *  |     (c)
 *  |    _____
 *  |    /  \
 *  |   (   +   ) (a)
 *  |    \_____/
 *  |         \_(b)
 *  |         (d)
 *
 * (a) is the center of the arc or circle.
 * (b) is the end of the radial or diameter measurement.
 * (c) is the knee of the leader line.
 * (d) is the end of the leader line, at which the text is attached.
 */
export class PCB_DIM_RADIAL extends PCB_DIMENSION_BASE {
  private m_leaderLength!: number;

  constructor(aParent: BOARD_ITEM | null) {
    super(aParent, KICAD_T.PCB_DIM_RADIAL_T);
    this.m_unitsFormat = DIM_UNITS_FORMAT.NO_SUFFIX;
    this.m_overrideTextEnabled = false;
    this.m_keepTextAligned = true;
    this.m_prefix = 'R ';
    this.m_leaderLength = this.m_arrowLength * 3;
  }

  /** `PCB_DIM_RADIAL( const PCB_DIM_RADIAL& )`: the compiler-generated copy, as a static. */
  static copyOfRadial(aOther: PCB_DIM_RADIAL): PCB_DIM_RADIAL {
    const copy = new PCB_DIM_RADIAL(null);
    copy.assignRadial(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** The compiler-generated `operator=`. */
  assignRadial(aOther: PCB_DIM_RADIAL): this {
    this.assignDimensionBase(aOther);
    this.m_leaderLength = aOther.m_leaderLength;
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_DIM_RADIAL_T)) return; // wxCHECK

    this.assignRadial(aOther as PCB_DIM_RADIAL);
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && aItem.Type() === KICAD_T.PCB_DIM_RADIAL_T;
  }

  override Clone(): PCB_DIM_RADIAL {
    return PCB_DIM_RADIAL.copyOfRadial(this);
  }

  SetLeaderLength(aLength: number): void {
    this.m_leaderLength = aLength;
  }
  GetLeaderLength(): number {
    return this.m_leaderLength;
  }

  ChangeLeaderLength(aLength: number): void {
    this.SetLeaderLength(aLength);
    this.Update();
  }

  // Returns the point (c).
  GetKnee(): VECTOR2I {
    const radial = sub(this.m_end, this.m_start);

    return add(this.m_end, ResizeI(radial, this.m_leaderLength));
  }

  override GetMenuImage(): string {
    return 'add_radial_dimension'; // BITMAPS::add_radial_dimension
  }

  override GetClass(): string {
    return 'PCB_DIM_RADIAL';
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === this.Type());

    const image = aImage as PCB_DIM_RADIAL;

    this.m_shapes.length = 0;
    image.m_shapes.length = 0;

    // std::swap( *this, *aImage ): every member of both classes.
    const mine = PCB_DIM_RADIAL.copyOfRadial(this);
    this.assignRadial(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    image.assignRadial(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;

    this.Update();
  }

  protected override updateText(): void {
    if (this.m_keepTextAligned) {
      const textLine = sub(this.GetTextPos(), this.GetKnee());
      let textAngle = FULL_CIRCLE.sub(EDA_ANGLE.fromVector(textLine));

      textAngle.Normalize();

      if (textAngle.gt(ANGLE_90) && textAngle.le(ANGLE_270)) textAngle = textAngle.sub(ANGLE_180);

      // Round to nearest degree
      textAngle = new EDA_ANGLE(KiROUND(textAngle.AsDegrees()), EDA_ANGLE_T.DEGREES_T);

      this.SetTextAngle(textAngle);
    }

    super.updateText();
  }

  protected override updateGeometry(): void {
    if (this.m_busy)
      // Skeep reentrance that happens sometimes after calling updateText()
      return;

    this.m_busy = true;
    this.m_shapes.length = 0;

    const center: VECTOR2I = { ...this.m_start };
    let centerArm: VECTOR2I = { x: 0, y: this.m_arrowLength };

    this.m_shapes.push(new SHAPE_SEGMENT(sub(center, centerArm), add(center, centerArm)));

    centerArm = RotatePoint(centerArm, ANGLE_90.negate());

    this.m_shapes.push(new SHAPE_SEGMENT(sub(center, centerArm), add(center, centerArm)));

    const radius = sub(this.m_end, this.m_start);

    this.m_measuredValue = KiROUND(EuclideanNormI(radius));

    this.updateText();

    // Now that we have the text updated, we can determine how to draw the second line
    // First we need to create an appropriate bounding polygon to collide with
    const textBox = this.GetTextBox(null).Inflate(
      Math.trunc(this.GetTextWidth() / 2),
      this.GetEffectiveTextPenWidth(),
    );

    const polyBox = polyBoxOf(textBox, this.GetTextAngle());

    let radial = sub(this.m_end, this.m_start);
    radial = ResizeI(radial, this.m_leaderLength);

    const arrowSeg = new SEG(this.m_end, add(this.m_end, radial));
    const textSeg = new SEG(arrowSeg.B, this.GetTextPos());

    CollectKnockedOutSegments(polyBox, arrowSeg, this.m_shapes);
    CollectKnockedOutSegments(polyBox, textSeg, this.m_shapes);

    this.drawAnArrow(this.m_end, EDA_ANGLE.fromVector(radial), 0);

    this.m_busy = false;
  }
}

/**
 * A leader is a dimension-like object pointing to a specific point.
 *
 * A guide to the geometry of a leader:
 *
 *  |
 *  |
 *  |
 *  |   (a)
 *  |    \
 *  |     \
 *  |      \
 *  |       \_______(b)
 *  |               (c)
 *  |_________________________
 *
 * (a) is the start point of the leader.
 * (b) is the end point of the leader, at which the text is attached.
 * (c) is the end of the text area.
 */
export class PCB_DIM_LEADER extends PCB_DIMENSION_BASE {
  private m_textBorder!: DIM_TEXT_BORDER;

  constructor(aParent: BOARD_ITEM | null) {
    super(aParent, KICAD_T.PCB_DIM_LEADER_T);
    this.m_textBorder = DIM_TEXT_BORDER.NONE;
    this.m_unitsFormat = DIM_UNITS_FORMAT.NO_SUFFIX;
    this.m_overrideTextEnabled = true;
    this.m_keepTextAligned = false;

    this.SetOverrideText('Leader');
  }

  /** `PCB_DIM_LEADER( const PCB_DIM_LEADER& )`: the compiler-generated copy, as a static. */
  static copyOfLeader(aOther: PCB_DIM_LEADER): PCB_DIM_LEADER {
    const copy = new PCB_DIM_LEADER(null);
    copy.assignLeader(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** The compiler-generated `operator=`. */
  assignLeader(aOther: PCB_DIM_LEADER): this {
    this.assignDimensionBase(aOther);
    this.m_textBorder = aOther.m_textBorder;
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_DIM_LEADER_T)) return; // wxCHECK

    this.assignLeader(aOther as PCB_DIM_LEADER);
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && aItem.Type() === KICAD_T.PCB_DIM_LEADER_T;
  }

  override Clone(): PCB_DIM_LEADER {
    return PCB_DIM_LEADER.copyOfLeader(this);
  }

  override GetMenuImage(): string {
    return 'add_leader'; // BITMAPS::add_leader
  }

  override GetClass(): string {
    return 'PCB_DIM_LEADER';
  }

  SetTextBorder(aBorder: DIM_TEXT_BORDER): void {
    this.m_textBorder = aBorder;
  }
  GetTextBorder(): DIM_TEXT_BORDER {
    return this.m_textBorder;
  }

  ChangeTextBorder(aBorder: DIM_TEXT_BORDER): void {
    this.SetTextBorder(aBorder);
    this.Update();
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    // Don't use GetShownText(); we want to see the variable references here
    aList.push(new MSG_PANEL_ITEM('Leader', KIUI_EllipsizeStatusText(aFrame, this.GetText())));

    const originTransforms = aFrame.GetOriginTransforms();

    const startCoord = originTransforms.ToDisplayAbs(this.GetStart());
    const start = `@(${aFrame.MessageTextFromValue(startCoord.x)}, ${aFrame.MessageTextFromValue(startCoord.y)})`;

    aList.push(new MSG_PANEL_ITEM(start, ''));

    aList.push(new MSG_PANEL_ITEM('Layer', this.GetLayerName()));
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === this.Type());

    const image = aImage as PCB_DIM_LEADER;

    this.m_shapes.length = 0;
    image.m_shapes.length = 0;

    // std::swap( *this, *aImage ): every member of both classes.
    const mine = PCB_DIM_LEADER.copyOfLeader(this);
    this.assignLeader(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    image.assignLeader(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;

    this.Update();
  }

  protected override updateText(): void {
    // Our geometry is dependent on the size of the text, so just update the whole shebang
    this.updateGeometry();
  }

  protected override updateGeometry(): void {
    if (this.m_busy)
      // Skeep reentrance that happens sometimes after calling updateText()
      return;

    this.m_busy = true;
    this.m_shapes.length = 0;

    super.updateText();

    // Now that we have the text updated, we can determine how to draw the second line
    // First we need to create an appropriate bounding polygon to collide with
    const textBox = this.GetTextBox(null).Inflate(
      Math.trunc(this.GetTextWidth() / 2),
      this.GetEffectiveTextPenWidth() * 2,
    );

    const polyBox = polyBoxOf(textBox, this.GetTextAngle());

    const firstLine = sub(this.m_end, this.m_start);
    let start: VECTOR2I = { ...this.m_start };
    start = add(start, ResizeI(firstLine, this.m_extensionOffset));

    const arrowSeg = new SEG(this.m_start, this.m_end);
    const textSeg = new SEG(this.m_end, this.GetTextPos());
    let arrowSegEnd: OPT_VECTOR2I;
    let textSegEnd: OPT_VECTOR2I;

    if (this.m_textBorder === DIM_TEXT_BORDER.CIRCLE) {
      const penWidth = this.GetEffectiveTextPenWidth() / 2.0;
      const radius = textBox.GetWidth() / 2.0 - penWidth;
      const circle = new CIRCLE(textBox.GetCenter(), radius);

      arrowSegEnd = segCircleIntersection(circle, arrowSeg);
      textSegEnd = segCircleIntersection(circle, textSeg);
    } else {
      arrowSegEnd = segPolyIntersection(polyBox, arrowSeg);
      textSegEnd = segPolyIntersection(polyBox, textSeg);
    }

    if (!arrowSegEnd) arrowSegEnd = this.m_end;

    this.m_shapes.push(new SHAPE_SEGMENT(start, arrowSegEnd));

    this.drawAnArrow(start, EDA_ANGLE.fromVector(firstLine), 0);

    if (this.GetText().length !== 0) {
      switch (this.m_textBorder) {
        case DIM_TEXT_BORDER.RECTANGLE: {
          for (const seg of polyBox.IterateSegments()) this.m_shapes.push(new SHAPE_SEGMENT(seg));

          break;
        }

        case DIM_TEXT_BORDER.CIRCLE: {
          const penWidth = this.GetEffectiveTextPenWidth() / 2.0;
          const radius = textBox.GetWidth() / 2.0 - penWidth;
          this.m_shapes.push(new SHAPE_CIRCLE(textBox.GetCenter(), radius));

          break;
        }

        default:
          break;
      }
    }

    if (textSegEnd && equal(arrowSegEnd, this.m_end))
      this.m_shapes.push(new SHAPE_SEGMENT(this.m_end, textSegEnd));

    this.m_busy = false;
  }
}

/**
 * Mark the center of a circle or arc with a cross shape.
 *
 * The size and orientation of the cross is adjustable.
 * m_start always marks the center being measured; m_end marks the end of one leg of the cross.
 */
export class PCB_DIM_CENTER extends PCB_DIMENSION_BASE {
  constructor(aParent: BOARD_ITEM | null) {
    super(aParent, KICAD_T.PCB_DIM_CENTER_T);
    this.m_unitsFormat = DIM_UNITS_FORMAT.NO_SUFFIX;
    this.m_overrideTextEnabled = true;
  }

  /** `PCB_DIM_CENTER( const PCB_DIM_CENTER& )`: the compiler-generated copy, as a static. */
  static copyOfCenter(aOther: PCB_DIM_CENTER): PCB_DIM_CENTER {
    const copy = new PCB_DIM_CENTER(null);
    copy.assignCenter(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** The compiler-generated `operator=`. */
  assignCenter(aOther: PCB_DIM_CENTER): this {
    this.assignDimensionBase(aOther);
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_DIM_CENTER_T)) return; // wxCHECK

    this.assignCenter(aOther as PCB_DIM_CENTER);
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && aItem.Type() === KICAD_T.PCB_DIM_CENTER_T;
  }

  override Clone(): PCB_DIM_CENTER {
    return PCB_DIM_CENTER.copyOfCenter(this);
  }

  override GetMenuImage(): string {
    return 'add_center_dimension'; // BITMAPS::add_center_dimension
  }

  override GetClass(): string {
    return 'PCB_DIM_CENTER';
  }

  override GetBoundingBox(): BOX2I {
    const bBox = new BOX2I();
    let xmin: number;
    let xmax: number;
    let ymin: number;
    let ymax: number;

    xmin = this.m_start.x;
    xmax = this.m_start.x;
    ymin = this.m_start.y;
    ymax = this.m_start.y;

    for (const shape of this.GetShapes()) {
      const shapeBox = shape.BBox();
      shapeBox.Inflate(Math.trunc(this.m_lineThickness / 2));
      xmin = Math.min(xmin, shapeBox.GetOrigin().x);
      xmax = Math.max(xmax, shapeBox.GetEnd().x);
      ymin = Math.min(ymin, shapeBox.GetOrigin().y);
      ymax = Math.max(ymax, shapeBox.GetEnd().y);
    }

    bBox.SetX(xmin);
    bBox.SetY(ymin);
    bBox.SetWidth(xmax - xmin + 1);
    bBox.SetHeight(ymax - ymin + 1);
    bBox.Normalize();

    return bBox;
  }

  override ViewBBox(): BOX2I {
    return this.GetBoundingBox();
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === this.Type());

    const image = aImage as PCB_DIM_CENTER;

    // std::swap( *this, *aImage ): every member of both classes.
    const mine = PCB_DIM_CENTER.copyOfCenter(this);
    this.assignCenter(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    image.assignCenter(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
  }

  protected override updateText(): void {
    // Even if PCB_DIM_CENTER has no text, we still need to update its text position
    // so GetTextPos() users get a valid value. Required at least for lasso hit-testing.
    this.SetTextPos(this.m_start);
    super.updateText();
  }

  protected override updateGeometry(): void {
    if (this.m_busy)
      // Skeep reentrance that happens sometimes after calling updateText()
      return;

    this.m_busy = true;
    this.m_shapes.length = 0;

    const center: VECTOR2I = { ...this.m_start };
    let arm = sub(this.m_end, this.m_start);

    this.m_shapes.push(new SHAPE_SEGMENT(sub(center, arm), add(center, arm)));

    arm = RotatePoint(arm, ANGLE_90.negate());

    this.m_shapes.push(new SHAPE_SEGMENT(sub(center, arm), add(center, arm)));

    this.updateText();

    this.m_busy = false;
  }
}

function isPoint(a: unknown): a is VECTOR2I {
  return typeof (a as VECTOR2I).x === 'number' && !(a instanceof BOX2I);
}

function isBoardItem(a: unknown): a is BOARD_ITEM {
  return (
    typeof (a as BOARD_ITEM).Type === 'function' && typeof (a as BOARD_ITEM).GetLayer === 'function'
  );
}

/**
 * `static struct DIMENSION_DESC` (pcbnew/pcb_dimension.cpp).
 */
(() => {
  ENUM_MAP.Instance<DIM_PRECISION>('DIM_PRECISION')
    .Map(DIM_PRECISION.X, '0')
    .Map(DIM_PRECISION.X_X, '0.0')
    .Map(DIM_PRECISION.X_XX, '0.00')
    .Map(DIM_PRECISION.X_XXX, '0.000')
    .Map(DIM_PRECISION.X_XXXX, '0.0000')
    .Map(DIM_PRECISION.X_XXXXX, '0.00000')
    .Map(DIM_PRECISION.V_VV, '0.00 in / 0 mils / 0.0 mm')
    .Map(DIM_PRECISION.V_VVV, '0.000 / 0 / 0.00')
    .Map(DIM_PRECISION.V_VVVV, '0.0000 / 0.0 / 0.000')
    .Map(DIM_PRECISION.V_VVVVV, '0.00000 / 0.00 / 0.0000');

  ENUM_MAP.Instance<DIM_UNITS_FORMAT>('DIM_UNITS_FORMAT')
    .Map(DIM_UNITS_FORMAT.NO_SUFFIX, '1234.0')
    .Map(DIM_UNITS_FORMAT.BARE_SUFFIX, '1234.0 mm')
    .Map(DIM_UNITS_FORMAT.PAREN_SUFFIX, '1234.0 (mm)');

  ENUM_MAP.Instance<DIM_UNITS_MODE>('DIM_UNITS_MODE')
    .Map(DIM_UNITS_MODE.INCH, 'Inches')
    .Map(DIM_UNITS_MODE.MILS, 'Mils')
    .Map(DIM_UNITS_MODE.MM, 'Millimeters')
    .Map(DIM_UNITS_MODE.AUTOMATIC, 'Automatic');

  ENUM_MAP.Instance<DIM_ARROW_DIRECTION>('DIM_ARROW_DIRECTION')
    .Map(DIM_ARROW_DIRECTION.INWARD, 'Inward')
    .Map(DIM_ARROW_DIRECTION.OUTWARD, 'Outward');

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_DIMENSION_BASE);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIMENSION_BASE, PCB_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIMENSION_BASE, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIMENSION_BASE, EDA_TEXT));
  propMgr.InheritsAfter(PCB_DIMENSION_BASE, PCB_TEXT);
  propMgr.InheritsAfter(PCB_DIMENSION_BASE, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_DIMENSION_BASE, EDA_TEXT);

  propMgr.Mask(PCB_DIMENSION_BASE, EDA_TEXT, 'Orientation');

  const groupDimension = 'Dimension Properties';

  const isLeader = (aItem: INSPECTABLE_ITEM): boolean => aItem instanceof PCB_DIM_LEADER;

  const isNotLeader = (aItem: INSPECTABLE_ITEM): boolean => !(aItem instanceof PCB_DIM_LEADER);

  const isMultiArrowDirection = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof PCB_DIM_ALIGNED;

  propMgr
    .AddProperty(
      new PROPERTY<PCB_DIMENSION_BASE, string>(
        PCB_DIMENSION_BASE,
        'Prefix',
        'ChangePrefix',
        'GetPrefix',
        TYPE_STRING,
      ),
      groupDimension,
    )
    .SetAvailableFunc(isNotLeader);
  propMgr
    .AddProperty(
      new PROPERTY<PCB_DIMENSION_BASE, string>(
        PCB_DIMENSION_BASE,
        'Suffix',
        'ChangeSuffix',
        'GetSuffix',
        TYPE_STRING,
      ),
      groupDimension,
    )
    .SetAvailableFunc(isNotLeader);
  propMgr
    .AddProperty(
      new PROPERTY<PCB_DIMENSION_BASE, string>(
        PCB_DIMENSION_BASE,
        'Override Text',
        'ChangeOverrideText',
        'GetOverrideText',
        TYPE_STRING,
      ),
      groupDimension,
    )
    .SetAvailableFunc(isNotLeader);

  propMgr
    .AddProperty(
      new PROPERTY<PCB_DIMENSION_BASE, string>(
        PCB_DIMENSION_BASE,
        'Text',
        'ChangeOverrideText',
        'GetOverrideText',
        TYPE_STRING,
      ),
      groupDimension,
    )
    .SetAvailableFunc(isLeader);

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_DIMENSION_BASE, DIM_UNITS_MODE>(
        PCB_DIMENSION_BASE,
        'Units',
        'ChangeUnitsMode',
        'GetUnitsMode',
        ENUM_MAP.Instance<DIM_UNITS_MODE>('DIM_UNITS_MODE'),
      ),
      groupDimension,
    )
    .SetAvailableFunc(isNotLeader);
  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_DIMENSION_BASE, DIM_UNITS_FORMAT>(
        PCB_DIMENSION_BASE,
        'Units Format',
        'ChangeUnitsFormat',
        'GetUnitsFormat',
        ENUM_MAP.Instance<DIM_UNITS_FORMAT>('DIM_UNITS_FORMAT'),
      ),
      groupDimension,
    )
    .SetAvailableFunc(isNotLeader);
  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_DIMENSION_BASE, DIM_PRECISION>(
        PCB_DIMENSION_BASE,
        'Precision',
        'ChangePrecision',
        'GetPrecision',
        ENUM_MAP.Instance<DIM_PRECISION>('DIM_PRECISION'),
      ),
      groupDimension,
    )
    .SetAvailableFunc(isNotLeader);
  propMgr
    .AddProperty(
      new PROPERTY<PCB_DIMENSION_BASE, boolean>(
        PCB_DIMENSION_BASE,
        'Suppress Trailing Zeroes',
        'ChangeSuppressZeroes',
        'GetSuppressZeroes',
        TYPE_BOOL,
      ),
      groupDimension,
    )
    .SetAvailableFunc(isNotLeader);

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_DIMENSION_BASE, DIM_ARROW_DIRECTION>(
        PCB_DIMENSION_BASE,
        'Arrow Direction',
        'ChangeArrowDirection',
        'GetArrowDirection',
        ENUM_MAP.Instance<DIM_ARROW_DIRECTION>('DIM_ARROW_DIRECTION'),
      ),
      groupDimension,
    )
    .SetAvailableFunc(isMultiArrowDirection);

  const groupText = 'Text Properties';

  const isTextOrientationWriteable = (aItem: INSPECTABLE_ITEM): boolean =>
    !(aItem as PCB_DIMENSION_BASE).GetKeepTextAligned();

  propMgr.AddProperty(
    new PROPERTY<PCB_DIMENSION_BASE, boolean>(
      PCB_DIMENSION_BASE,
      'Keep Aligned with Dimension',
      'ChangeKeepTextAligned',
      'GetKeepTextAligned',
      TYPE_BOOL,
    ),
    groupText,
  );

  propMgr
    .AddProperty(
      new PROPERTY<PCB_DIMENSION_BASE, number>(
        PCB_DIMENSION_BASE,
        'Orientation',
        'ChangeTextAngleDegrees',
        'GetTextAngleDegreesProp',
        TYPE_DOUBLE,
        PROPERTY_DISPLAY.PT_DEGREE,
      ),
      groupText,
    )
    .SetWriteableFunc(isTextOrientationWriteable);
})();

/**
 * `static struct ALIGNED_DIMENSION_DESC` (pcbnew/pcb_dimension.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_DIM_ALIGNED);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ALIGNED, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ALIGNED, EDA_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ALIGNED, PCB_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ALIGNED, PCB_DIMENSION_BASE));
  propMgr.InheritsAfter(PCB_DIM_ALIGNED, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_DIM_ALIGNED, EDA_TEXT);
  propMgr.InheritsAfter(PCB_DIM_ALIGNED, PCB_TEXT);
  propMgr.InheritsAfter(PCB_DIM_ALIGNED, PCB_DIMENSION_BASE);

  const groupDimension = 'Dimension Properties';

  propMgr.AddProperty(
    new PROPERTY<PCB_DIM_ALIGNED, number>(
      PCB_DIM_ALIGNED,
      'Crossbar Height',
      'ChangeHeight',
      'GetHeight',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    groupDimension,
  );
  propMgr.AddProperty(
    new PROPERTY<PCB_DIM_ALIGNED, number>(
      PCB_DIM_ALIGNED,
      'Extension Line Overshoot',
      'ChangeExtensionHeight',
      'GetExtensionHeight',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    groupDimension,
  );

  propMgr.OverrideAvailability(PCB_DIM_ALIGNED, EDA_TEXT, 'Text', () => false);
  propMgr.OverrideAvailability(PCB_DIM_ALIGNED, EDA_TEXT, 'Vertical Justification', () => false);
  propMgr.OverrideAvailability(PCB_DIM_ALIGNED, EDA_TEXT, 'Hyperlink', () => false);
  propMgr.OverrideAvailability(PCB_DIM_ALIGNED, BOARD_ITEM, 'Knockout', () => false);
})();

/**
 * `static struct ORTHOGONAL_DIMENSION_DESC` (pcbnew/pcb_dimension.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_DIM_ORTHOGONAL);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ORTHOGONAL, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ORTHOGONAL, EDA_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ORTHOGONAL, PCB_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ORTHOGONAL, PCB_DIMENSION_BASE));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_ORTHOGONAL, PCB_DIM_ALIGNED));
  propMgr.InheritsAfter(PCB_DIM_ORTHOGONAL, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_DIM_ORTHOGONAL, EDA_TEXT);
  propMgr.InheritsAfter(PCB_DIM_ORTHOGONAL, PCB_TEXT);
  propMgr.InheritsAfter(PCB_DIM_ORTHOGONAL, PCB_DIMENSION_BASE);
  propMgr.InheritsAfter(PCB_DIM_ORTHOGONAL, PCB_DIM_ALIGNED);

  propMgr.OverrideAvailability(PCB_DIM_ORTHOGONAL, EDA_TEXT, 'Text', () => false);
  propMgr.OverrideAvailability(PCB_DIM_ORTHOGONAL, EDA_TEXT, 'Vertical Justification', () => false);
  propMgr.OverrideAvailability(PCB_DIM_ORTHOGONAL, EDA_TEXT, 'Hyperlink', () => false);
  propMgr.OverrideAvailability(PCB_DIM_ORTHOGONAL, BOARD_ITEM, 'Knockout', () => false);
})();

/**
 * `static struct RADIAL_DIMENSION_DESC` (pcbnew/pcb_dimension.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_DIM_RADIAL);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_RADIAL, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_RADIAL, EDA_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_RADIAL, PCB_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_RADIAL, PCB_DIMENSION_BASE));
  propMgr.InheritsAfter(PCB_DIM_RADIAL, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_DIM_RADIAL, EDA_TEXT);
  propMgr.InheritsAfter(PCB_DIM_RADIAL, PCB_TEXT);
  propMgr.InheritsAfter(PCB_DIM_RADIAL, PCB_DIMENSION_BASE);

  const groupDimension = 'Dimension Properties';

  propMgr.AddProperty(
    new PROPERTY<PCB_DIM_RADIAL, number>(
      PCB_DIM_RADIAL,
      'Leader Length',
      'ChangeLeaderLength',
      'GetLeaderLength',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    groupDimension,
  );

  propMgr.OverrideAvailability(PCB_DIM_RADIAL, EDA_TEXT, 'Text', () => false);
  propMgr.OverrideAvailability(PCB_DIM_RADIAL, EDA_TEXT, 'Vertical Justification', () => false);
  propMgr.OverrideAvailability(PCB_DIM_RADIAL, EDA_TEXT, 'Hyperlink', () => false);
  propMgr.OverrideAvailability(PCB_DIM_RADIAL, BOARD_ITEM, 'Knockout', () => false);
})();

/**
 * `static struct LEADER_DIMENSION_DESC` (pcbnew/pcb_dimension.cpp).
 */
(() => {
  ENUM_MAP.Instance<DIM_TEXT_BORDER>('DIM_TEXT_BORDER')
    .Map(DIM_TEXT_BORDER.NONE, 'None')
    .Map(DIM_TEXT_BORDER.RECTANGLE, 'Rectangle')
    .Map(DIM_TEXT_BORDER.CIRCLE, 'Circle');

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_DIM_LEADER);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_LEADER, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_LEADER, EDA_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_LEADER, PCB_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_LEADER, PCB_DIMENSION_BASE));
  propMgr.InheritsAfter(PCB_DIM_LEADER, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_DIM_LEADER, EDA_TEXT);
  propMgr.InheritsAfter(PCB_DIM_LEADER, PCB_TEXT);
  propMgr.InheritsAfter(PCB_DIM_LEADER, PCB_DIMENSION_BASE);

  const groupDimension = 'Dimension Properties';

  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_DIM_LEADER, DIM_TEXT_BORDER>(
      PCB_DIM_LEADER,
      'Text Frame',
      'ChangeTextBorder',
      'GetTextBorder',
      ENUM_MAP.Instance<DIM_TEXT_BORDER>('DIM_TEXT_BORDER'),
    ),
    groupDimension,
  );

  propMgr.OverrideAvailability(PCB_DIM_LEADER, EDA_TEXT, 'Text', () => false);
  propMgr.OverrideAvailability(PCB_DIM_LEADER, EDA_TEXT, 'Vertical Justification', () => false);
  propMgr.OverrideAvailability(PCB_DIM_LEADER, EDA_TEXT, 'Hyperlink', () => false);
  propMgr.OverrideAvailability(PCB_DIM_LEADER, BOARD_ITEM, 'Knockout', () => false);
})();

/**
 * `static struct CENTER_DIMENSION_DESC` (pcbnew/pcb_dimension.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_DIM_CENTER);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_CENTER, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_CENTER, EDA_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_CENTER, PCB_TEXT));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_DIM_CENTER, PCB_DIMENSION_BASE));
  propMgr.InheritsAfter(PCB_DIM_CENTER, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_DIM_CENTER, EDA_TEXT);
  propMgr.InheritsAfter(PCB_DIM_CENTER, PCB_TEXT);
  propMgr.InheritsAfter(PCB_DIM_CENTER, PCB_DIMENSION_BASE);

  propMgr.OverrideAvailability(PCB_DIM_CENTER, EDA_TEXT, 'Text', () => false);
  propMgr.OverrideAvailability(PCB_DIM_CENTER, EDA_TEXT, 'Vertical Justification', () => false);
  propMgr.OverrideAvailability(PCB_DIM_CENTER, EDA_TEXT, 'Hyperlink', () => false);
  propMgr.OverrideAvailability(PCB_DIM_CENTER, BOARD_ITEM, 'Knockout', () => false);
})();
