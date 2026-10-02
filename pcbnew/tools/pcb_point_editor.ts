// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/pcb_point_editor.cpp`: PCB_POINT_EDITOR and the
 * POINT_EDIT_BEHAVIORs for board items. The generic behaviours (segment,
 * circle, arc, polygon, bezier, table cell) are common's.
 *
 * KiCad 10.0.6 has no point editing for tracks and track arcs; neither does this.
 */
import type { COMMIT } from '@ziroeda/common/commit.js';
import { CHANGE_TYPE } from '@ziroeda/common/commit.js';
import { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { IS_MOVING } from '@ziroeda/common/eda_item_flags.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { type EdaIuScale, type EdaUnits, pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { ARC_EDIT_MODE, FRAME_T } from '@ziroeda/common/frame_type.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import {
  IsCopperLayer,
  IsFrontLayer,
  LAYER_GP_OVERLAY,
  LAYER_SELECT_OVERLAY,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ANGLE_ITEM } from '@ziroeda/common/preview_items/angle_item.js';
import {
  DimensionLabel,
  DrawTextNextToCursor,
} from '@ziroeda/common/preview_items/preview_utils.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  EC_45DEGREE,
  EC_90DEGREE,
  EC_CONVERGING,
  EC_HORIZONTAL,
  EC_LINE,
  EC_PERPLINE,
  EC_VERTICAL,
  type EDIT_CONSTRAINT,
  GRID_CONSTRAINT_TYPE,
  POLYGON_LINE_MODE,
  SNAP_CONSTRAINT_TYPE,
} from '@ziroeda/common/tool/edit_constraints.js';
import { EDIT_LINE, EDIT_POINT, EDIT_POINTS } from '@ziroeda/common/tool/edit_points.js';
import {
  EDA_ARC_POINT_EDIT_BEHAVIOR,
  EDA_BEZIER_POINT_EDIT_BEHAVIOR,
  EDA_CIRCLE_POINT_EDIT_BEHAVIOR,
  EDA_POLYGON_POINT_EDIT_BEHAVIOR,
  EDA_SEGMENT_POINT_EDIT_BEHAVIOR,
  EDA_TABLECELL_POINT_EDIT_BEHAVIOR,
  IncrementArcEditMode,
  POINT_EDIT_BEHAVIOR,
  POLYGON_POINT_EDIT_BEHAVIOR,
} from '@ziroeda/common/tool/point_editor_behavior.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  BUT_LEFT,
  EVENTS,
  MD_CTRL,
  MD_SHIFT,
  TOOL_ACTIONS,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { TOOL_STATE_FUNC } from '@ziroeda/common/tool/tool_base.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { EDA_SHAPE } from '@ziroeda/common/eda_shape.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetClampedCoords } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { type OPT_VECTOR2I, SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { SHAPE_POLY_SET, VERTEX_INDEX } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  KIGEOM_GetLengthRatioFromStart,
  KIGEOM_GetNearestEndpoint,
  KIGEOM_PointIsInDirection,
  KIGEOM_PointProjectsOntoSegment,
} from '@ziroeda/kimath/src/geometry/vector_utils.js';
import { chamferLinePair } from '@ziroeda/kimath/src/geometry/corner_operations.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { INT_MAX, KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  add,
  divideI,
  EuclideanNorm,
  EuclideanNormI,
  sub,
  toVECTOR2I,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { GetRotated, RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PAD } from '../pad.js';
import { PAD_SHAPE, PADSTACK } from '../padstack.js';
import type { PCB_BARCODE } from '../pcb_barcode.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import {
  type PCB_DIM_ALIGNED,
  type PCB_DIM_CENTER,
  type PCB_DIM_LEADER,
  PCB_DIM_ORTHOGONAL,
  type PCB_DIM_RADIAL,
} from '../pcb_dimension.js';
import { DIM_TEXT_POSITION } from '../pcb_dimension_types.js';
import type { PCB_GENERATOR } from '../pcb_generator.js';
import type { PCB_GROUP } from '../pcb_group.js';
import type { PCB_REFERENCE_IMAGE } from '../pcb_reference_image.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TABLE } from '../pcb_table.js';
import type { PCB_TABLECELL } from '../pcb_tablecell.js';
import { PCB_TEXTBOX } from '../pcb_textbox.js';
import type { ZONE } from '../zone.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';
import { PCB_SELECTION } from './pcb_selection.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';

export const COORDS_PADDING = pcbIUScale.mmToIU(20);

function appendDirection(aDirections: VECTOR2I[], aDirection: VECTOR2I): void {
  if (aDirection.x !== 0 || aDirection.y !== 0) aDirections.push(aDirection);
}

/** `getConstraintDirections`: the snap directions a point's constraint allows. */
export function getConstraintDirections(
  aConstraint: EDIT_CONSTRAINT<EDIT_POINT> | null,
): VECTOR2I[] {
  const directions: VECTOR2I[] = [];

  if (!aConstraint) return directions;

  if (aConstraint instanceof EC_90DEGREE) {
    appendDirection(directions, { x: 1, y: 0 });
    appendDirection(directions, { x: 0, y: 1 });
  } else if (aConstraint instanceof EC_45DEGREE) {
    appendDirection(directions, { x: 1, y: 0 });
    appendDirection(directions, { x: 0, y: 1 });
    appendDirection(directions, { x: 1, y: 1 });
    appendDirection(directions, { x: 1, y: -1 });
  } else if (aConstraint instanceof EC_VERTICAL) {
    appendDirection(directions, { x: 0, y: 1 });
  } else if (aConstraint instanceof EC_HORIZONTAL) {
    appendDirection(directions, { x: 1, y: 0 });
  } else if (aConstraint instanceof EC_LINE) {
    appendDirection(directions, aConstraint.GetLineVector());
  }

  return directions;
}

// Few constants to avoid using bare numbers for point indices
export enum RECT_POINTS {
  RECT_TOP_LEFT,
  RECT_TOP_RIGHT,
  RECT_BOT_RIGHT,
  RECT_BOT_LEFT,
  RECT_CENTER,
  RECT_RADIUS,

  RECT_MAX_POINTS, // Must be last
}

export enum RECT_LINES {
  RECT_TOP,
  RECT_RIGHT,
  RECT_BOT,
  RECT_LEFT,
}

export enum DIMENSION_POINTS {
  DIM_START = 0,
  DIM_END = 1,
  DIM_TEXT = 2,
  DIM_CROSSBARSTART = 3,
  DIM_CROSSBAREND = 4,
  DIM_KNEE = DIM_CROSSBARSTART,

  DIM_ALIGNED_MAX = DIM_CROSSBAREND + 1,
  DIM_CENTER_MAX = DIM_END + 1,
  DIM_RADIAL_MAX = DIM_KNEE + 1,
  DIM_LEADER_MAX = DIM_TEXT + 1,
}

const {
  RECT_TOP_LEFT,
  RECT_TOP_RIGHT,
  RECT_BOT_RIGHT,
  RECT_BOT_LEFT,
  RECT_CENTER,
  RECT_RADIUS,
  RECT_MAX_POINTS,
} = RECT_POINTS;
const { RECT_TOP, RECT_RIGHT, RECT_BOT, RECT_LEFT } = RECT_LINES;
const {
  DIM_START,
  DIM_END,
  DIM_TEXT,
  DIM_CROSSBARSTART,
  DIM_CROSSBAREND,
  DIM_KNEE,
  DIM_ALIGNED_MAX,
  DIM_CENTER_MAX,
  DIM_RADIAL_MAX,
  DIM_LEADER_MAX,
} = DIMENSION_POINTS;

/** `wxCHECK( aPoints.PointsSize() == n, ... )`. */
function CHECK_POINT_COUNT(aPoints: EDIT_POINTS, aExpected: number): boolean {
  const ok = aPoints.PointsSize() === aExpected;
  console.assert(ok, `EDIT_POINTS has ${aPoints.PointsSize()} points, expected ${aExpected}`);
  return ok;
}

/** `CHECK_POINT_COUNT_GE`. */
function CHECK_POINT_COUNT_GE(aPoints: EDIT_POINTS, aExpected: number): boolean {
  const ok = aPoints.PointsSize() >= aExpected;
  console.assert(ok, `EDIT_POINTS has ${aPoints.PointsSize()} points, expected >= ${aExpected}`);
  return ok;
}

/**
 * PCB_SHAPE carries EDA_SHAPE as a mixin (pcb_shape.ts), so the common
 * behaviours, typed on EDA_SHAPE, take it through this cast.
 */
const asEdaShape = (aShape: PCB_SHAPE): EDA_SHAPE => aShape as unknown as EDA_SHAPE;

/** `sign`: -1, 0 or +1. */
const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** `VECTOR2<int> / 2` (`operator/( double )`): KiROUND each component. */
const half = (v: VECTOR2I): VECTOR2I => divideI(v, 2);

/** `RECT_RADIUS_TEXT_ITEM`: the "r" label beside a rectangle's corner-radius handle. */
export class RECT_RADIUS_TEXT_ITEM extends EDA_ITEM {
  private readonly m_iuScale: EdaIuScale;
  private m_units: EdaUnits;
  private m_radius = 0;
  private m_corner: VECTOR2I = { x: 0, y: 0 };
  private m_quadrant: VECTOR2I = { x: -1, y: 1 };
  private m_visible = false;

  constructor(aIuScale: EdaIuScale, aUnits: EdaUnits) {
    super(null, KICAD_T.NOT_USED);
    this.m_iuScale = aIuScale;
    this.m_units = aUnits;
  }

  override ViewBBox(): BOX2I {
    const tmp = new BOX2I();
    tmp.SetMaximum();
    return tmp;
  }

  override ViewGetLayers(): number[] {
    return [LAYER_SELECT_OVERLAY, LAYER_GP_OVERLAY];
  }

  override ViewDraw(aLayer: number, aView: VIEW): void {
    if (!this.m_visible) return;

    const strings = [DimensionLabel('r', this.m_radius, this.m_iuScale, this.m_units)];
    DrawTextNextToCursor(
      aView,
      this.m_corner,
      this.m_quadrant,
      strings,
      aLayer === LAYER_SELECT_OVERLAY,
    );
  }

  /** `Set( aRadius, aCorner, aQuadrant, aUnits )`; renamed, EDA_ITEM.Set is the property setter. */
  SetRadius(aRadius: number, aCorner: VECTOR2I, aQuadrant: VECTOR2I, aUnits: EdaUnits): void {
    this.m_radius = aRadius;
    this.m_corner = aCorner;
    this.m_quadrant = aQuadrant;
    this.m_units = aUnits;
    this.m_visible = true;
  }

  Hide(): void {
    this.m_visible = false;
  }

  override GetClass(): string {
    return 'RECT_RADIUS_TEXT_ITEM';
  }
}

export class RECTANGLE_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_rectangle: PCB_SHAPE;

  constructor(aRectangle: PCB_SHAPE) {
    super();
    this.m_rectangle = aRectangle;
    console.assert(aRectangle.GetShape() === SHAPE_T.RECTANGLE);
  }

  /** Standard rectangle points construction utility (other shapes may use this as well). */
  static MakeRectPoints(aRectangle: PCB_SHAPE, aPoints: EDIT_POINTS): void {
    if (aRectangle.GetShape() !== SHAPE_T.RECTANGLE) return;

    const topLeft = { ...aRectangle.GetTopLeft() };
    const botRight = { ...aRectangle.GetBotRight() };

    aPoints.SetSwapX(topLeft.x > botRight.x);
    aPoints.SetSwapY(topLeft.y > botRight.y);

    if (aPoints.SwapX()) [topLeft.x, botRight.x] = [botRight.x, topLeft.x];

    if (aPoints.SwapY()) [topLeft.y, botRight.y] = [botRight.y, topLeft.y];

    aPoints.AddPoint(topLeft);
    aPoints.AddPoint({ x: botRight.x, y: topLeft.y });
    aPoints.AddPoint(botRight);
    aPoints.AddPoint({ x: topLeft.x, y: botRight.y });
    aPoints.AddPoint(aRectangle.GetCenter());
    aPoints.AddPoint({ x: botRight.x - aRectangle.GetCornerRadius(), y: topLeft.y });
    aPoints.Point(RECT_RADIUS).SetDrawCircle();

    aPoints.AddLine(aPoints.Point(RECT_TOP_LEFT), aPoints.Point(RECT_TOP_RIGHT));
    aPoints.Line(RECT_TOP).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_TOP)));
    aPoints.AddLine(aPoints.Point(RECT_TOP_RIGHT), aPoints.Point(RECT_BOT_RIGHT));
    aPoints.Line(RECT_RIGHT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_RIGHT)));
    aPoints.AddLine(aPoints.Point(RECT_BOT_RIGHT), aPoints.Point(RECT_BOT_LEFT));
    aPoints.Line(RECT_BOT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_BOT)));
    aPoints.AddLine(aPoints.Point(RECT_BOT_LEFT), aPoints.Point(RECT_TOP_LEFT));
    aPoints.Line(RECT_LEFT).SetConstraint(new EC_PERPLINE(aPoints.Line(RECT_LEFT)));
  }

  static UpdateRectItem(
    aRectangle: PCB_SHAPE,
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aMinSize: VECTOR2I = { x: 0, y: 0 },
  ): void {
    // You can have more points if your item wants to have more points
    // (this class assumes the rect points come first, but that can be changed)
    CHECK_POINT_COUNT_GE(aPoints, RECT_MAX_POINTS);

    const setLeft = (left: number): void =>
      aPoints.SwapX() ? aRectangle.SetRight(left) : aRectangle.SetLeft(left);
    const setRight = (right: number): void =>
      aPoints.SwapX() ? aRectangle.SetLeft(right) : aRectangle.SetRight(right);
    const setTop = (top: number): void =>
      aPoints.SwapY() ? aRectangle.SetBottom(top) : aRectangle.SetTop(top);
    const setBottom = (bottom: number): void =>
      aPoints.SwapY() ? aRectangle.SetTop(bottom) : aRectangle.SetBottom(bottom);

    const c = {
      topLeft: { ...aPoints.Point(RECT_TOP_LEFT).GetPosition() },
      topRight: { ...aPoints.Point(RECT_TOP_RIGHT).GetPosition() },
      botLeft: { ...aPoints.Point(RECT_BOT_LEFT).GetPosition() },
      botRight: { ...aPoints.Point(RECT_BOT_RIGHT).GetPosition() },
    };

    RECTANGLE_POINT_EDIT_BEHAVIOR.PinEditedCorner(
      aEditedPoint,
      aPoints,
      c,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      aMinSize,
    );

    const { topLeft, botRight } = c;

    if (
      POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_TOP_LEFT)) ||
      POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_TOP_RIGHT)) ||
      POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_BOT_RIGHT)) ||
      POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_BOT_LEFT))
    ) {
      setTop(topLeft.y);
      setLeft(topLeft.x);
      setRight(botRight.x);
      setBottom(botRight.y);
    } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_CENTER))) {
      const moveVector = sub(aPoints.Point(RECT_CENTER).GetPosition(), aRectangle.GetCenter());
      aRectangle.Move(moveVector);
    } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_RADIUS))) {
      const width = Math.abs(botRight.x - topLeft.x);
      const height = Math.abs(botRight.y - topLeft.y);
      const maxRadius = Math.trunc(Math.min(width, height) / 2);
      let x = aPoints.Point(RECT_RADIUS).GetX();
      x = Math.min(Math.max(x, botRight.x - maxRadius), botRight.x);
      aPoints.Point(RECT_RADIUS).SetPosition({ x, y: topLeft.y });
      aRectangle.SetCornerRadius(botRight.x - x);
    } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Line(RECT_TOP))) {
      // Only top changes; keep others from previous full-local bbox
      setTop(topLeft.y);
    } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Line(RECT_LEFT))) {
      setLeft(topLeft.x);
    } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Line(RECT_BOT))) {
      setBottom(botRight.y);
    } else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Line(RECT_RIGHT))) {
      setRight(botRight.x);
    }

    for (let i = 0; i < aPoints.LinesSize(); ++i) {
      if (!POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Line(i)))
        aPoints.Line(i).SetConstraint(new EC_PERPLINE(aPoints.Line(i)));
    }
  }

  static UpdateRectPoints(aRectangle: PCB_SHAPE, aPoints: EDIT_POINTS): void {
    if (aPoints.PointsSize() < RECT_MAX_POINTS) return;

    const topLeft = { ...aRectangle.GetTopLeft() };
    const botRight = { ...aRectangle.GetBotRight() };

    aPoints.SetSwapX(topLeft.x > botRight.x);
    aPoints.SetSwapY(topLeft.y > botRight.y);

    if (aPoints.SwapX()) [topLeft.x, botRight.x] = [botRight.x, topLeft.x];

    if (aPoints.SwapY()) [topLeft.y, botRight.y] = [botRight.y, topLeft.y];

    aPoints.Point(RECT_TOP_LEFT).SetPosition(topLeft);
    aPoints
      .Point(RECT_RADIUS)
      .SetPosition({ x: botRight.x - aRectangle.GetCornerRadius(), y: topLeft.y });
    aPoints.Point(RECT_TOP_RIGHT).SetPosition({ x: botRight.x, y: topLeft.y });
    aPoints.Point(RECT_BOT_RIGHT).SetPosition(botRight);
    aPoints.Point(RECT_BOT_LEFT).SetPosition({ x: topLeft.x, y: botRight.y });
    aPoints.Point(RECT_CENTER).SetPosition(aRectangle.GetCenter());
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    // Just call the static helper
    RECTANGLE_POINT_EDIT_BEHAVIOR.MakeRectPoints(this.m_rectangle, aPoints);
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    // Careful; rectangle shape is mutable between cardinal and non-cardinal rotations...
    if (this.m_rectangle.GetShape() !== SHAPE_T.RECTANGLE || aPoints.PointsSize() === 0)
      return false;

    RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectPoints(this.m_rectangle, aPoints);
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectItem(this.m_rectangle, aEditedPoint, aPoints);
  }

  /**
   * Update the coordinates of 4 corners of a rectangle, according to constraints and the
   * moved corner. `aCorners` holds the four in/out corners.
   *
   * @param aHole the location of the pad's hole
   * @param aHoleSize the pad's hole size (or {0,0} if it has no hole)
   */
  static PinEditedCorner(
    aEditedPoint: EDIT_POINT,
    aEditPoints: EDIT_POINTS,
    aCorners: { topLeft: VECTOR2I; topRight: VECTOR2I; botLeft: VECTOR2I; botRight: VECTOR2I },
    aHole: VECTOR2I = { x: 0, y: 0 },
    aHoleSize: VECTOR2I = { x: 0, y: 0 },
    aMinSize: VECTOR2I = { x: 0, y: 0 },
  ): void {
    const {
      topLeft: aTopLeft,
      topRight: aTopRight,
      botLeft: aBotLeft,
      botRight: aBotRight,
    } = aCorners;
    const minWidth = Math.max(pcbIUScale.milsToIU(1), aMinSize.x);
    const minHeight = Math.max(pcbIUScale.milsToIU(1), aMinSize.y);
    const halfHoleX = Math.trunc(aHoleSize.x / 2);
    const halfHoleY = Math.trunc(aHoleSize.y / 2);
    const isMod = (p: EDIT_POINT): boolean => POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, p);

    if (isMod(aEditPoints.Point(RECT_TOP_LEFT))) {
      if (aHoleSize.x) {
        // pin edited point to the top/left of the hole
        aTopLeft.x = Math.min(aTopLeft.x, aHole.x - halfHoleX - minWidth);
        aTopLeft.y = Math.min(aTopLeft.y, aHole.y - halfHoleY - minHeight);
      } else {
        // pin edited point within opposite corner
        aTopLeft.x = Math.min(aTopLeft.x, aBotRight.x - minWidth);
        aTopLeft.y = Math.min(aTopLeft.y, aBotRight.y - minHeight);
      }

      // push edited point edges to adjacent corners
      aTopRight.y = aTopLeft.y;
      aBotLeft.x = aTopLeft.x;
    } else if (isMod(aEditPoints.Point(RECT_TOP_RIGHT))) {
      if (aHoleSize.x) {
        aTopRight.x = Math.max(aTopRight.x, aHole.x + halfHoleX + minWidth);
        aTopRight.y = Math.min(aTopRight.y, aHole.y - halfHoleY - minHeight);
      } else {
        aTopRight.x = Math.max(aTopRight.x, aBotLeft.x + minWidth);
        aTopRight.y = Math.min(aTopRight.y, aBotLeft.y - minHeight);
      }

      aTopLeft.y = aTopRight.y;
      aBotRight.x = aTopRight.x;
    } else if (isMod(aEditPoints.Point(RECT_BOT_LEFT))) {
      if (aHoleSize.x) {
        aBotLeft.x = Math.min(aBotLeft.x, aHole.x - halfHoleX - minWidth);
        aBotLeft.y = Math.max(aBotLeft.y, aHole.y + halfHoleY + minHeight);
      } else {
        aBotLeft.x = Math.min(aBotLeft.x, aTopRight.x - minWidth);
        aBotLeft.y = Math.max(aBotLeft.y, aTopRight.y + minHeight);
      }

      aBotRight.y = aBotLeft.y;
      aTopLeft.x = aBotLeft.x;
    } else if (isMod(aEditPoints.Point(RECT_BOT_RIGHT))) {
      if (aHoleSize.x) {
        aBotRight.x = Math.max(aBotRight.x, aHole.x + halfHoleX + minWidth);
        aBotRight.y = Math.max(aBotRight.y, aHole.y + halfHoleY + minHeight);
      } else {
        aBotRight.x = Math.max(aBotRight.x, aTopLeft.x + minWidth);
        aBotRight.y = Math.max(aBotRight.y, aTopLeft.y + minHeight);
      }

      aBotLeft.y = aBotRight.y;
      aTopRight.x = aBotRight.x;
    } else if (isMod(aEditPoints.Line(RECT_TOP))) {
      aTopLeft.y = Math.min(aTopLeft.y, aBotRight.y - minHeight);
    } else if (isMod(aEditPoints.Line(RECT_LEFT))) {
      aTopLeft.x = Math.min(aTopLeft.x, aBotRight.x - minWidth);
    } else if (isMod(aEditPoints.Line(RECT_BOT))) {
      aBotRight.y = Math.max(aBotRight.y, aTopLeft.y + minHeight);
    } else if (isMod(aEditPoints.Line(RECT_RIGHT))) {
      aBotRight.x = Math.max(aBotRight.x, aTopLeft.x + minWidth);
    }
  }
}

export class ZONE_POINT_EDIT_BEHAVIOR extends POLYGON_POINT_EDIT_BEHAVIOR {
  private readonly m_zone: ZONE;

  constructor(aZone: ZONE) {
    super(aZone.Outline());
    this.m_zone = aZone;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    this.m_zone.UnFill();

    // Defer to the base class to update the polygon
    super.UpdateItem(aEditedPoint, aPoints, aCommit, aUpdatedItems);

    this.m_zone.HatchBorder();
  }
}

export class REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  /** `REFIMG_ORIGIN`: reuse the center point for the transform origin. */
  private static readonly REFIMG_ORIGIN = RECT_CENTER;
  private static readonly REFIMG_MAX_POINTS = RECT_CENTER + 1;

  private readonly m_refImage: PCB_REFERENCE_IMAGE;

  constructor(aRefImage: PCB_REFERENCE_IMAGE) {
    super();
    this.m_refImage = aRefImage;
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    const refImage = this.m_refImage.GetReferenceImage();

    const topLeft = sub(refImage.GetPosition(), half(refImage.GetSize()));
    const botRight = add(refImage.GetPosition(), half(refImage.GetSize()));

    aPoints.AddPoint(topLeft);
    aPoints.AddPoint({ x: botRight.x, y: topLeft.y });
    aPoints.AddPoint(botRight);
    aPoints.AddPoint({ x: topLeft.x, y: botRight.y });

    aPoints.AddPoint(add(refImage.GetPosition(), refImage.GetTransformOriginOffset()));
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (aPoints.PointsSize() !== REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR.REFIMG_MAX_POINTS)
      return false;

    const refImage = this.m_refImage.GetReferenceImage();

    const topLeft = sub(refImage.GetPosition(), half(refImage.GetSize()));
    const botRight = add(refImage.GetPosition(), half(refImage.GetSize()));

    aPoints.Point(RECT_TOP_LEFT).SetPosition(topLeft);
    aPoints.Point(RECT_TOP_RIGHT).SetPosition({ x: botRight.x, y: topLeft.y });
    aPoints.Point(RECT_BOT_RIGHT).SetPosition(botRight);
    aPoints.Point(RECT_BOT_LEFT).SetPosition({ x: topLeft.x, y: botRight.y });
    aPoints
      .Point(REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR.REFIMG_ORIGIN)
      .SetPosition(add(refImage.GetPosition(), refImage.GetTransformOriginOffset()));
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    CHECK_POINT_COUNT(aPoints, REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR.REFIMG_MAX_POINTS);

    const refImage = this.m_refImage.GetReferenceImage();
    const isMod = (p: EDIT_POINT): boolean => POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, p);

    const topLeft = aPoints.Point(RECT_TOP_LEFT).GetPosition();
    const topRight = aPoints.Point(RECT_TOP_RIGHT).GetPosition();
    const botRight = aPoints.Point(RECT_BOT_RIGHT).GetPosition();
    const botLeft = aPoints.Point(RECT_BOT_LEFT).GetPosition();
    const xfrmOrigin = aPoints
      .Point(REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR.REFIMG_ORIGIN)
      .GetPosition();

    if (isMod(aPoints.Point(REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR.REFIMG_ORIGIN))) {
      // Moving the transform origin
      // As the other points didn't move, we can get the image extent from them
      const newOffset = sub(xfrmOrigin, half(add(topLeft, botRight)));
      refImage.SetTransformOriginOffset(newOffset);
    } else {
      const oldOrigin = add(this.m_refImage.GetPosition(), refImage.GetTransformOriginOffset());
      const oldSize = refImage.GetSize();
      const pos = refImage.GetPosition();

      let newCorner: VECTOR2I | undefined;
      let oldCorner = pos;

      if (isMod(aPoints.Point(RECT_TOP_LEFT))) {
        newCorner = topLeft;
        oldCorner = sub(oldCorner, half(oldSize));
      } else if (isMod(aPoints.Point(RECT_TOP_RIGHT))) {
        newCorner = topRight;
        oldCorner = sub(oldCorner, half({ x: -oldSize.x, y: oldSize.y }));
      } else if (isMod(aPoints.Point(RECT_BOT_LEFT))) {
        newCorner = botLeft;
        oldCorner = sub(oldCorner, half({ x: oldSize.x, y: -oldSize.y }));
      } else if (isMod(aPoints.Point(RECT_BOT_RIGHT))) {
        newCorner = botRight;
        oldCorner = add(oldCorner, half(oldSize));
      }

      if (newCorner) {
        // Turn in the respective vectors from the origin
        newCorner = sub(newCorner, xfrmOrigin);
        oldCorner = sub(oldCorner, oldOrigin);

        // If we tried to cross the origin, clamp it to stop it
        if (sign(newCorner.x) !== sign(oldCorner.x) || sign(newCorner.y) !== sign(oldCorner.y))
          newCorner = { x: 0, y: 0 };

        const newLength = EuclideanNorm(newCorner);
        const oldLength = EuclideanNorm(oldCorner);

        let ratio = oldLength > 0 ? newLength / oldLength : 1.0;

        // Clamp the scaling to a minimum of 50 mils
        const newSize = { x: KiROUND(oldSize.x * ratio), y: KiROUND(oldSize.y * ratio) };
        const newWidth = Math.max(newSize.x, pcbIUScale.milsToIU(50));
        const newHeight = Math.max(newSize.y, pcbIUScale.milsToIU(50));
        ratio = Math.min(newWidth / oldSize.x, newHeight / oldSize.y);

        // Also handles the origin offset
        refImage.SetImageScale(refImage.GetImageScale() * ratio);
      }
    }
  }
}

export class BARCODE_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_barcode: PCB_BARCODE;

  constructor(aBarcode: PCB_BARCODE) {
    super();
    this.m_barcode = aBarcode;
  }

  private makeDummyRect(): PCB_SHAPE {
    const dummy = new PCB_SHAPE(null, SHAPE_T.RECTANGLE);
    dummy.SetStart(
      sub(this.m_barcode.GetCenter(), {
        x: Math.trunc(this.m_barcode.GetWidth() / 2),
        y: Math.trunc(this.m_barcode.GetHeight() / 2),
      }),
    );
    dummy.SetEnd(
      add(dummy.GetStart(), { x: this.m_barcode.GetWidth(), y: this.m_barcode.GetHeight() }),
    );
    dummy.Rotate(this.m_barcode.GetPosition(), this.m_barcode.GetAngle());
    return dummy;
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    // Non-cardinal barcode point-editing isn't useful enough to support.
    if (!this.m_barcode.GetAngle().IsCardinal()) return;

    const set45Constraint = (a: number, b: number): void => {
      aPoints.Point(a).SetConstraint(new EC_45DEGREE(aPoints.Point(a), aPoints.Point(b)));
    };

    RECTANGLE_POINT_EDIT_BEHAVIOR.MakeRectPoints(this.makeDummyRect(), aPoints);

    if (this.m_barcode.KeepSquare()) {
      set45Constraint(RECT_TOP_LEFT, RECT_BOT_RIGHT);
      set45Constraint(RECT_TOP_RIGHT, RECT_BOT_LEFT);
      set45Constraint(RECT_BOT_RIGHT, RECT_TOP_LEFT);
      set45Constraint(RECT_BOT_LEFT, RECT_TOP_RIGHT);
    }
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    const target = this.m_barcode.GetAngle().IsCardinal() ? RECT_MAX_POINTS : 0;

    if (aPoints.PointsSize() !== target) return false;

    RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectPoints(this.makeDummyRect(), aPoints);
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    if (this.m_barcode.GetAngle().IsCardinal()) {
      const dummy = this.makeDummyRect();
      RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectItem(dummy, aEditedPoint, aPoints);
      dummy.Rotate(dummy.GetCenter(), this.m_barcode.GetAngle().negate());

      this.m_barcode.SetPosition(dummy.GetCenter());
      this.m_barcode.SetWidth(dummy.GetRectangleWidth());
      this.m_barcode.SetHeight(dummy.GetRectangleHeight());
      this.m_barcode.AssembleBarcode();
    }
  }
}

export class PCB_TABLECELL_POINT_EDIT_BEHAVIOR extends EDA_TABLECELL_POINT_EDIT_BEHAVIOR {
  private readonly m_tableCell: PCB_TABLECELL;

  constructor(aCell: PCB_TABLECELL) {
    super(asEdaShape(aCell));
    this.m_tableCell = aCell;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    const COL_WIDTH = EDA_TABLECELL_POINT_EDIT_BEHAVIOR.COL_WIDTH;
    const ROW_HEIGHT = EDA_TABLECELL_POINT_EDIT_BEHAVIOR.ROW_HEIGHT;
    CHECK_POINT_COUNT(aPoints, EDA_TABLECELL_POINT_EDIT_BEHAVIOR.TABLECELL_MAX_POINTS);

    const cell = this.m_tableCell;
    const table = cell.GetParent() as unknown as PCB_TABLE;
    aCommit.Modify(table);
    aUpdatedItems.push(table);
    const isMod = (p: EDIT_POINT): boolean => POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, p);

    if (!cell.GetTextAngle().IsHorizontal()) {
      if (isMod(aPoints.Point(ROW_HEIGHT))) {
        cell.SetEnd({ x: cell.GetEndX(), y: aPoints.Point(ROW_HEIGHT).GetY() });

        let colWidth = Math.abs(cell.GetRectangleHeight());

        for (let ii = 0; ii < cell.GetColSpan() - 1; ++ii)
          colWidth -= table.GetColWidth(cell.GetColumn() + ii);

        table.SetColWidth(cell.GetColumn() + cell.GetColSpan() - 1, colWidth);
      } else if (isMod(aPoints.Point(COL_WIDTH))) {
        cell.SetEnd({ x: aPoints.Point(COL_WIDTH).GetX(), y: cell.GetEndY() });

        let rowHeight = cell.GetRectangleWidth();

        for (let ii = 0; ii < cell.GetRowSpan() - 1; ++ii)
          rowHeight -= table.GetRowHeight(cell.GetRow() + ii);

        table.SetRowHeight(cell.GetRow() + cell.GetRowSpan() - 1, rowHeight);
      }
    } else {
      if (isMod(aPoints.Point(COL_WIDTH))) {
        cell.SetEnd({ x: aPoints.Point(COL_WIDTH).GetX(), y: cell.GetEndY() });

        let colWidth = cell.GetRectangleWidth();

        for (let ii = 0; ii < cell.GetColSpan() - 1; ++ii)
          colWidth -= table.GetColWidth(cell.GetColumn() + ii);

        table.SetColWidth(cell.GetColumn() + cell.GetColSpan() - 1, colWidth);
      } else if (isMod(aPoints.Point(ROW_HEIGHT))) {
        cell.SetEnd({ x: cell.GetEndX(), y: aPoints.Point(ROW_HEIGHT).GetY() });

        let rowHeight = cell.GetRectangleHeight();

        for (let ii = 0; ii < cell.GetRowSpan() - 1; ++ii)
          rowHeight -= table.GetRowHeight(cell.GetRow() + ii);

        table.SetRowHeight(cell.GetRow() + cell.GetRowSpan() - 1, rowHeight);
      }
    }

    table.Normalize();
  }
}

export class PAD_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_pad: PAD;
  private readonly m_layer: PCB_LAYER_ID;

  constructor(aPad: PAD, aLayer: PCB_LAYER_ID) {
    super();
    this.m_pad = aPad;
    this.m_layer = aLayer;
  }

  private halfSize(): VECTOR2I {
    const size = this.m_pad.GetSize(this.m_layer);
    return { x: Math.trunc(size.x / 2), y: Math.trunc(size.y / 2) };
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    const shapePos = this.m_pad.ShapePos(this.m_layer);
    let halfSize = this.halfSize();

    if (this.m_pad.IsLocked()) return;

    switch (this.m_pad.GetShape(this.m_layer)) {
      case PAD_SHAPE.CIRCLE:
        aPoints.AddPoint({ x: shapePos.x + halfSize.x, y: shapePos.y });
        break;

      case PAD_SHAPE.OVAL:
      case PAD_SHAPE.TRAPEZOID:
      case PAD_SHAPE.RECTANGLE:
      case PAD_SHAPE.ROUNDRECT:
      case PAD_SHAPE.CHAMFERED_RECT: {
        if (!this.m_pad.GetOrientation().IsCardinal()) break;

        if (this.m_pad.GetOrientation().IsVertical()) halfSize = { x: halfSize.y, y: halfSize.x };

        // It's important to fill these according to the RECT indices
        aPoints.AddPoint(sub(shapePos, halfSize));
        aPoints.AddPoint({ x: shapePos.x + halfSize.x, y: shapePos.y - halfSize.y });
        aPoints.AddPoint(add(shapePos, halfSize));
        aPoints.AddPoint({ x: shapePos.x - halfSize.x, y: shapePos.y + halfSize.y });
        break;
      }

      default: // suppress warnings
        break;
    }
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    const locked = this.m_pad.GetParent() !== null && this.m_pad.IsLocked();
    const shapePos = { ...this.m_pad.ShapePos(this.m_layer) };
    let halfSize = this.halfSize();

    switch (this.m_pad.GetShape(this.m_layer)) {
      case PAD_SHAPE.CIRCLE: {
        const target = locked ? 0 : 1;

        // Careful; pad shape is mutable...
        if (aPoints.PointsSize() !== target) {
          aPoints.Clear();
          this.MakePoints(aPoints);
        } else if (target === 1) {
          shapePos.x += halfSize.x;
          aPoints.Point(0).SetPosition(shapePos);
        }

        break;
      }

      case PAD_SHAPE.OVAL:
      case PAD_SHAPE.TRAPEZOID:
      case PAD_SHAPE.RECTANGLE:
      case PAD_SHAPE.ROUNDRECT:
      case PAD_SHAPE.CHAMFERED_RECT: {
        // Careful; pad shape and orientation are mutable...
        const target = locked || !this.m_pad.GetOrientation().IsCardinal() ? 0 : 4;

        if (aPoints.PointsSize() !== target) {
          aPoints.Clear();
          this.MakePoints(aPoints);
        } else if (target === 4) {
          if (this.m_pad.GetOrientation().IsVertical()) halfSize = { x: halfSize.y, y: halfSize.x };

          aPoints.Point(RECT_TOP_LEFT).SetPosition(sub(shapePos, halfSize));
          aPoints
            .Point(RECT_TOP_RIGHT)
            .SetPosition({ x: shapePos.x + halfSize.x, y: shapePos.y - halfSize.y });
          aPoints.Point(RECT_BOT_RIGHT).SetPosition(add(shapePos, halfSize));
          aPoints
            .Point(RECT_BOT_LEFT)
            .SetPosition({ x: shapePos.x - halfSize.x, y: shapePos.y + halfSize.y });
        }

        break;
      }

      default: // suppress warnings
        break;
    }

    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    const pad = this.m_pad;
    const isMod = (p: EDIT_POINT): boolean => POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, p);

    switch (pad.GetShape(this.m_layer)) {
      case PAD_SHAPE.CIRCLE: {
        const end = aPoints.Point(0).GetPosition();
        const diameter = 2 * EuclideanNormI(sub(end, pad.GetPosition()));

        pad.SetSize(this.m_layer, { x: diameter, y: diameter });
        break;
      }

      case PAD_SHAPE.OVAL:
      case PAD_SHAPE.TRAPEZOID:
      case PAD_SHAPE.RECTANGLE:
      case PAD_SHAPE.ROUNDRECT:
      case PAD_SHAPE.CHAMFERED_RECT: {
        const c = {
          topLeft: { ...aPoints.Point(RECT_TOP_LEFT).GetPosition() },
          topRight: { ...aPoints.Point(RECT_TOP_RIGHT).GetPosition() },
          botLeft: { ...aPoints.Point(RECT_BOT_LEFT).GetPosition() },
          botRight: { ...aPoints.Point(RECT_BOT_RIGHT).GetPosition() },
        };
        const holeCenter = pad.GetPosition();
        const holeSize = pad.GetDrillSize();

        RECTANGLE_POINT_EDIT_BEHAVIOR.PinEditedCorner(
          aEditedPoint,
          aPoints,
          c,
          holeCenter,
          holeSize,
        );

        const { topLeft, topRight, botLeft, botRight } = c;
        const offset = pad.GetOffset(this.m_layer);

        if (offset.x || offset.y || (pad.GetDrillSize().x && pad.GetDrillSize().y)) {
          // Keep hole pinned at the current location; adjust the pad around the hole
          const center = pad.GetPosition();
          let dist: [number, number, number, number];

          if (isMod(aPoints.Point(RECT_TOP_LEFT)) || isMod(aPoints.Point(RECT_BOT_RIGHT))) {
            dist = [
              center.x - topLeft.x,
              center.y - topLeft.y,
              botRight.x - center.x,
              botRight.y - center.y,
            ];
          } else {
            dist = [
              center.x - botLeft.x,
              center.y - topRight.y,
              topRight.x - center.x,
              botLeft.y - center.y,
            ];
          }

          let padSize = { x: dist[0] + dist[2], y: dist[1] + dist[3] };
          const deltaOffset = {
            x: Math.trunc(padSize.x / 2) - dist[2],
            y: Math.trunc(padSize.y / 2) - dist[3],
          };

          if (pad.GetOrientation().IsVertical()) padSize = { x: padSize.y, y: padSize.x };

          const rotated = RotatePoint(deltaOffset, pad.GetOrientation().negate());

          pad.SetSize(this.m_layer, padSize);
          pad.SetOffset(this.m_layer, { x: -rotated.x, y: -rotated.y });
        } else {
          // Keep pad position at the center of the pad shape
          let left: number;
          let top: number;
          let right: number;
          let bottom: number;

          if (isMod(aPoints.Point(RECT_TOP_LEFT)) || isMod(aPoints.Point(RECT_BOT_RIGHT))) {
            left = topLeft.x;
            top = topLeft.y;
            right = botRight.x;
            bottom = botRight.y;
          } else {
            left = botLeft.x;
            top = topRight.y;
            right = topRight.x;
            bottom = botLeft.y;
          }

          let padSize = { x: Math.abs(right - left), y: Math.abs(bottom - top) };

          if (pad.GetOrientation().IsVertical()) padSize = { x: padSize.y, y: padSize.x };

          pad.SetSize(this.m_layer, padSize);
          pad.SetPosition({ x: Math.trunc((left + right) / 2), y: Math.trunc((top + bottom) / 2) });
        }

        break;
      }

      default: // suppress warnings
        break;
    }
  }
}

/**
 * Point editor behavior for the PCB_GENERATOR class.
 *
 * This just delegates to the PCB_GENERATOR's own methods.
 */
export class GENERATOR_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_generator: PCB_GENERATOR;

  constructor(aGenerator: PCB_GENERATOR) {
    super();
    this.m_generator = aGenerator;
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    this.m_generator.MakeEditPoints(aPoints);
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    this.m_generator.UpdateEditPoints(aPoints);
    return true;
  }

  override UpdateItem(
    _aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    this.m_generator.UpdateFromEditPoints(aPoints);
  }
}

/**
 * Class to help update the text position of a dimension when the crossbar changes.
 *
 * Choosing the right way to update the text position requires some care, and
 * needs to hold some state from the original dimension position so the text can be placed
 * in a similar position relative to the new crossbar. This class handles that state
 * and the logic to find the new text position.
 */
export class DIM_ALIGNED_TEXT_UPDATER {
  private readonly m_dimension: PCB_DIM_ALIGNED;
  private readonly m_originalTextPos: VECTOR2I;
  private readonly m_oldCrossBar: SEG;

  constructor(aDimension: PCB_DIM_ALIGNED) {
    this.m_dimension = aDimension;
    this.m_originalTextPos = { ...aDimension.GetTextPos() };
    this.m_oldCrossBar = new SEG(aDimension.GetCrossbarStart(), aDimension.GetCrossbarEnd());
  }

  UpdateTextAfterChange(): void {
    const newCrossBar = new SEG(
      this.m_dimension.GetCrossbarStart(),
      this.m_dimension.GetCrossbarEnd(),
    );

    // Crossbar didn't change, text doesn't need to change
    if (newCrossBar.equals(this.m_oldCrossBar)) return;

    const newTextPos = this.getDimensionNewTextPosition();
    this.m_dimension.SetTextPos(newTextPos);

    const oldJustify = this.m_dimension.GetHorizJustify();

    // We may need to update the justification if we go past vertical.
    if (
      oldJustify === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT ||
      oldJustify === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
    ) {
      const oldProject = this.m_oldCrossBar.LineProject(this.m_originalTextPos);
      const newProject = newCrossBar.LineProject(newTextPos);

      const oldProjectedOffset = sub(oldProject, this.m_oldCrossBar.NearestPoint(oldProject));
      const newProjectedOffset = sub(newProject, newCrossBar.NearestPoint(newProject));

      const textWasLeftOf =
        oldProjectedOffset.x < 0 || (oldProjectedOffset.x === 0 && oldProjectedOffset.y > 0);
      const textIsLeftOf =
        newProjectedOffset.x < 0 || (newProjectedOffset.x === 0 && newProjectedOffset.y > 0);

      if (textWasLeftOf !== textIsLeftOf) {
        // Flip whatever the user had set
        this.m_dimension.SetHorizJustify(
          oldJustify === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
            ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
            : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT,
        );
      }
    }

    // Update the dimension (again) to ensure the text knockouts are correct
    this.m_dimension.Update();
  }

  private getDimensionNewTextPosition(): VECTOR2I {
    const newCrossBar = new SEG(
      this.m_dimension.GetCrossbarStart(),
      this.m_dimension.GetCrossbarEnd(),
    );
    const oldCB = this.m_oldCrossBar;

    const oldAngle = EDA_ANGLE.fromVector(sub(oldCB.B, oldCB.A));
    const newAngle = EDA_ANGLE.fromVector(sub(newCrossBar.B, newCrossBar.A));
    const rotation = oldAngle.sub(newAngle);

    // There are two modes - when the text is between the crossbar points, and when it's not.
    if (!KIGEOM_PointProjectsOntoSegment(this.m_originalTextPos, oldCB)) {
      const cbNearestEndToText = KIGEOM_GetNearestEndpoint(oldCB, this.m_originalTextPos);
      const rotTextOffsetFromCbCenter = GetRotated(
        sub(this.m_originalTextPos, oldCB.Center()),
        rotation,
      );
      const rotTextOffsetFromCbEnd = GetRotated(
        sub(this.m_originalTextPos, cbNearestEndToText),
        rotation,
      );

      // Which of the two crossbar points is now in the right direction? They could be swapped
      // over now. If zero-length, doesn't matter, they're the same thing
      const startIsInOffsetDirection = KIGEOM_PointIsInDirection(
        this.m_dimension.GetCrossbarStart(),
        rotTextOffsetFromCbCenter,
        newCrossBar.Center(),
      );

      const newCbRefPt = startIsInOffsetDirection
        ? this.m_dimension.GetCrossbarStart()
        : this.m_dimension.GetCrossbarEnd();

      // Apply the new offset to the correct crossbar point
      return add(newCbRefPt, rotTextOffsetFromCbEnd);
    }

    // If the text was between the crossbar points, it should stay there, but we need to find a
    // good place for it. Keep it the same distance from the crossbar line, but rotated as needed.
    const origTextPointProjected = oldCB.NearestPoint(this.m_originalTextPos);
    const oldRatio = KIGEOM_GetLengthRatioFromStart(origTextPointProjected, oldCB);

    // Perpendicular from the crossbar line to the text position
    // We need to keep this length constant
    const rotCbNormalToText = GetRotated(
      sub(this.m_originalTextPos, origTextPointProjected),
      rotation,
    );

    const d = sub(newCrossBar.B, newCrossBar.A);
    const newProjected = {
      x: KiROUND(newCrossBar.A.x + d.x * oldRatio),
      y: KiROUND(newCrossBar.A.y + d.y * oldRatio),
    };
    return add(newProjected, rotCbNormalToText);
  }
}

/** `VECTOR2D::Cross`. */
const cross = (a: VECTOR2I, b: VECTOR2I): number => a.x * b.y - a.y * b.x;

/** `VECTOR2<T>::operator<`: compares squared lengths. */
const lessThan = (a: VECTOR2I, b: VECTOR2I): boolean =>
  a.x * a.x + a.y * a.y < b.x * b.x + b.y * b.y;

/** This covers both aligned and the orthogonal sub-type. */
export class ALIGNED_DIMENSION_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_dimension: PCB_DIM_ALIGNED;

  constructor(aDimension: PCB_DIM_ALIGNED) {
    super();
    this.m_dimension = aDimension;
  }

  private setFeatureLineConstraints(aPoints: EDIT_POINTS): void {
    aPoints
      .Point(DIM_CROSSBARSTART)
      .SetConstraint(new EC_LINE(aPoints.Point(DIM_CROSSBARSTART), aPoints.Point(DIM_START)));
    aPoints
      .Point(DIM_CROSSBAREND)
      .SetConstraint(new EC_LINE(aPoints.Point(DIM_CROSSBAREND), aPoints.Point(DIM_END)));
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    aPoints.AddPoint(this.m_dimension.GetStart());
    aPoints.AddPoint(this.m_dimension.GetEnd());
    aPoints.AddPoint(this.m_dimension.GetTextPos());
    aPoints.AddPoint(this.m_dimension.GetCrossbarStart());
    aPoints.AddPoint(this.m_dimension.GetCrossbarEnd());

    aPoints.Point(DIM_START).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.ALL_LAYERS);
    aPoints.Point(DIM_END).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.ALL_LAYERS);

    // Dimension height setting - edit points should move only along the feature lines
    if (this.m_dimension.Type() === KICAD_T.PCB_DIM_ALIGNED_T)
      this.setFeatureLineConstraints(aPoints);
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (aPoints.PointsSize() !== DIM_ALIGNED_MAX) return false;

    aPoints.Point(DIM_START).SetPosition(this.m_dimension.GetStart());
    aPoints.Point(DIM_END).SetPosition(this.m_dimension.GetEnd());
    aPoints.Point(DIM_TEXT).SetPosition(this.m_dimension.GetTextPos());
    aPoints.Point(DIM_CROSSBARSTART).SetPosition(this.m_dimension.GetCrossbarStart());
    aPoints.Point(DIM_CROSSBAREND).SetPosition(this.m_dimension.GetCrossbarEnd());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    CHECK_POINT_COUNT(aPoints, DIM_ALIGNED_MAX);

    if (this.m_dimension.Type() === KICAD_T.PCB_DIM_ALIGNED_T)
      this.updateAlignedDimension(aEditedPoint, aPoints);
    else this.updateOrthogonalDimension(aEditedPoint, aPoints);
  }

  override Get45DegreeConstrainer(aEditedPoint: EDIT_POINT, aPoints: EDIT_POINTS): OPT_VECTOR2I {
    // Constraint for crossbar
    if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(DIM_START)))
      return aPoints.Point(DIM_END).GetPosition();
    else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(DIM_END)))
      return aPoints.Point(DIM_START).GetPosition();

    // No constraint
    return aEditedPoint.GetPosition();
  }

  /** Update non-orthogonal dimension points. */
  private updateAlignedDimension(aEditedPoint: EDIT_POINT, aPoints: EDIT_POINTS): void {
    const dim = this.m_dimension;
    const textPositionUpdater = new DIM_ALIGNED_TEXT_UPDATER(dim);
    const isMod = (p: EDIT_POINT): boolean => POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, p);

    // Check which point is currently modified and updated dimension's points respectively
    if (isMod(aPoints.Point(DIM_CROSSBARSTART)) || isMod(aPoints.Point(DIM_CROSSBAREND))) {
      const from = isMod(aPoints.Point(DIM_CROSSBARSTART)) ? dim.GetStart() : dim.GetEnd();
      const featureLine = sub(aEditedPoint.GetPosition(), from);
      const crossBar = sub(dim.GetEnd(), dim.GetStart());

      // `SetHeight( int )` from a double: truncated.
      if (cross(featureLine, crossBar) > 0) dim.SetHeight(Math.trunc(-EuclideanNorm(featureLine)));
      else dim.SetHeight(Math.trunc(EuclideanNorm(featureLine)));

      dim.Update();
    } else if (isMod(aPoints.Point(DIM_START))) {
      dim.SetStart(aEditedPoint.GetPosition());
      dim.Update();

      this.setFeatureLineConstraints(aPoints);
    } else if (isMod(aPoints.Point(DIM_END))) {
      dim.SetEnd(aEditedPoint.GetPosition());
      dim.Update();

      this.setFeatureLineConstraints(aPoints);
    } else if (isMod(aPoints.Point(DIM_TEXT))) {
      // Force manual mode if we weren't already in it
      dim.SetTextPositionMode(DIM_TEXT_POSITION.MANUAL);
      dim.SetTextPos(aEditedPoint.GetPosition());
      dim.Update();
    }

    textPositionUpdater.UpdateTextAfterChange();
  }

  /** Update orthogonal dimension points. */
  private updateOrthogonalDimension(aEditedPoint: EDIT_POINT, aPoints: EDIT_POINTS): void {
    const dim = this.m_dimension;
    const textPositionUpdater = new DIM_ALIGNED_TEXT_UPDATER(dim);
    const orthDimension = dim as PCB_DIM_ORTHOGONAL;
    const isMod = (p: EDIT_POINT): boolean => POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, p);

    if (isMod(aPoints.Point(DIM_CROSSBARSTART)) || isMod(aPoints.Point(DIM_CROSSBAREND))) {
      const bounds = new BOX2I(dim.GetStart(), sub(dim.GetEnd(), dim.GetStart()));

      const cursorPos = aEditedPoint.GetPosition();

      // Find vector from nearest dimension point to edit position
      const directionA = sub(cursorPos, dim.GetStart());
      const directionB = sub(cursorPos, dim.GetEnd());
      const direction = lessThan(directionA, directionB) ? directionA : directionB;

      let vert: boolean;
      const featureLine = sub(cursorPos, dim.GetStart());

      // Only change the orientation when we move outside the bounds
      if (!bounds.Contains(cursorPos)) {
        // If the dimension is horizontal or vertical, set correct orientation
        // otherwise, test if we're left/right of the bounding box or above/below it
        if (bounds.GetWidth() === 0) vert = true;
        else if (bounds.GetHeight() === 0) vert = false;
        else if (cursorPos.x > bounds.GetLeft() && cursorPos.x < bounds.GetRight()) vert = false;
        else if (cursorPos.y > bounds.GetTop() && cursorPos.y < bounds.GetBottom()) vert = true;
        else vert = Math.abs(direction.y) < Math.abs(direction.x);

        orthDimension.SetOrientation(
          vert ? PCB_DIM_ORTHOGONAL.DIR.VERTICAL : PCB_DIM_ORTHOGONAL.DIR.HORIZONTAL,
        );
      } else {
        vert = orthDimension.GetOrientation() === PCB_DIM_ORTHOGONAL.DIR.VERTICAL;
      }

      dim.SetHeight(vert ? featureLine.x : featureLine.y);
    } else if (isMod(aPoints.Point(DIM_START))) {
      dim.SetStart(aEditedPoint.GetPosition());
    } else if (isMod(aPoints.Point(DIM_END))) {
      dim.SetEnd(aEditedPoint.GetPosition());
    } else if (isMod(aPoints.Point(DIM_TEXT))) {
      // Force manual mode if we weren't already in it
      dim.SetTextPositionMode(DIM_TEXT_POSITION.MANUAL);
      dim.SetTextPos(aEditedPoint.GetPosition());
    }

    dim.Update();

    // After recompute, find the new text position
    textPositionUpdater.UpdateTextAfterChange();
  }
}

export class DIM_CENTER_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_dimension: PCB_DIM_CENTER;

  constructor(aDimension: PCB_DIM_CENTER) {
    super();
    this.m_dimension = aDimension;
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    aPoints.AddPoint(this.m_dimension.GetStart());
    aPoints.AddPoint(this.m_dimension.GetEnd());

    aPoints.Point(DIM_START).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.ALL_LAYERS);

    aPoints
      .Point(DIM_END)
      .SetConstraint(new EC_45DEGREE(aPoints.Point(DIM_END), aPoints.Point(DIM_START)));
    aPoints.Point(DIM_END).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.IGNORE_SNAPS);
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (aPoints.PointsSize() !== DIM_CENTER_MAX) return false;

    aPoints.Point(DIM_START).SetPosition(this.m_dimension.GetStart());
    aPoints.Point(DIM_END).SetPosition(this.m_dimension.GetEnd());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    CHECK_POINT_COUNT(aPoints, DIM_CENTER_MAX);

    if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(DIM_START)))
      this.m_dimension.SetStart(aEditedPoint.GetPosition());
    else if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(DIM_END)))
      this.m_dimension.SetEnd(aEditedPoint.GetPosition());

    this.m_dimension.Update();
  }

  override Get45DegreeConstrainer(aEditedPoint: EDIT_POINT, aPoints: EDIT_POINTS): OPT_VECTOR2I {
    if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(DIM_END)))
      return aPoints.Point(DIM_START).GetPosition();

    return undefined;
  }
}

export class DIM_RADIAL_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_dimension: PCB_DIM_RADIAL;

  constructor(aDimension: PCB_DIM_RADIAL) {
    super();
    this.m_dimension = aDimension;
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    aPoints.AddPoint(this.m_dimension.GetStart());
    aPoints.AddPoint(this.m_dimension.GetEnd());
    aPoints.AddPoint(this.m_dimension.GetTextPos());
    aPoints.AddPoint(this.m_dimension.GetKnee());

    aPoints.Point(DIM_START).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.ALL_LAYERS);
    aPoints.Point(DIM_END).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.ALL_LAYERS);

    aPoints
      .Point(DIM_KNEE)
      .SetConstraint(new EC_LINE(aPoints.Point(DIM_START), aPoints.Point(DIM_END)));
    aPoints.Point(DIM_KNEE).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.IGNORE_SNAPS);

    aPoints
      .Point(DIM_TEXT)
      .SetConstraint(new EC_45DEGREE(aPoints.Point(DIM_TEXT), aPoints.Point(DIM_KNEE)));
    aPoints.Point(DIM_TEXT).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.IGNORE_SNAPS);
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (aPoints.PointsSize() !== DIM_RADIAL_MAX) return false;

    aPoints.Point(DIM_START).SetPosition(this.m_dimension.GetStart());
    aPoints.Point(DIM_END).SetPosition(this.m_dimension.GetEnd());
    aPoints.Point(DIM_TEXT).SetPosition(this.m_dimension.GetTextPos());
    aPoints.Point(DIM_KNEE).SetPosition(this.m_dimension.GetKnee());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    CHECK_POINT_COUNT(aPoints, DIM_RADIAL_MAX);

    const dim = this.m_dimension;
    const isMod = (p: EDIT_POINT): boolean => POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, p);

    if (isMod(aPoints.Point(DIM_START))) {
      dim.SetStart(aEditedPoint.GetPosition());
      dim.Update();

      aPoints
        .Point(DIM_KNEE)
        .SetConstraint(new EC_LINE(aPoints.Point(DIM_START), aPoints.Point(DIM_END)));
    } else if (isMod(aPoints.Point(DIM_END))) {
      const oldKnee = dim.GetKnee();

      dim.SetEnd(aEditedPoint.GetPosition());
      dim.Update();

      const kneeDelta = sub(dim.GetKnee(), oldKnee);
      dim.SetTextPos(add(dim.GetTextPos(), kneeDelta));
      dim.Update();

      aPoints
        .Point(DIM_KNEE)
        .SetConstraint(new EC_LINE(aPoints.Point(DIM_START), aPoints.Point(DIM_END)));
    } else if (isMod(aPoints.Point(DIM_KNEE))) {
      const oldKnee = dim.GetKnee();
      const arrowVec = sub(
        aPoints.Point(DIM_KNEE).GetPosition(),
        aPoints.Point(DIM_END).GetPosition(),
      );

      dim.SetLeaderLength(EuclideanNormI(arrowVec));
      dim.Update();

      const kneeDelta = sub(dim.GetKnee(), oldKnee);
      dim.SetTextPos(add(dim.GetTextPos(), kneeDelta));
      dim.Update();
    } else if (isMod(aPoints.Point(DIM_TEXT))) {
      dim.SetTextPos(aEditedPoint.GetPosition());
      dim.Update();
    }
  }

  override Get45DegreeConstrainer(aEditedPoint: EDIT_POINT, aPoints: EDIT_POINTS): OPT_VECTOR2I {
    if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(DIM_TEXT)))
      return aPoints.Point(DIM_KNEE).GetPosition();

    return undefined;
  }
}

export class DIM_LEADER_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_dimension: PCB_DIM_LEADER;

  constructor(aDimension: PCB_DIM_LEADER) {
    super();
    this.m_dimension = aDimension;
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    aPoints.AddPoint(this.m_dimension.GetStart());
    aPoints.AddPoint(this.m_dimension.GetEnd());
    aPoints.AddPoint(this.m_dimension.GetTextPos());

    aPoints.Point(DIM_START).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.ALL_LAYERS);
    aPoints.Point(DIM_END).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.ALL_LAYERS);

    aPoints
      .Point(DIM_TEXT)
      .SetConstraint(new EC_45DEGREE(aPoints.Point(DIM_TEXT), aPoints.Point(DIM_END)));
    aPoints.Point(DIM_TEXT).SetSnapConstraint(SNAP_CONSTRAINT_TYPE.IGNORE_SNAPS);
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    if (aPoints.PointsSize() !== DIM_LEADER_MAX) return false;

    aPoints.Point(DIM_START).SetPosition(this.m_dimension.GetStart());
    aPoints.Point(DIM_END).SetPosition(this.m_dimension.GetEnd());
    aPoints.Point(DIM_TEXT).SetPosition(this.m_dimension.GetTextPos());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    CHECK_POINT_COUNT(aPoints, DIM_LEADER_MAX);

    const dim = this.m_dimension;
    const isMod = (p: EDIT_POINT): boolean => POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, p);

    if (isMod(aPoints.Point(DIM_START))) {
      dim.SetStart(aEditedPoint.GetPosition());
    } else if (isMod(aPoints.Point(DIM_END))) {
      const newPoint = aEditedPoint.GetPosition();
      const delta = sub(newPoint, dim.GetEnd());

      dim.SetEnd(newPoint);
      dim.SetTextPos(add(dim.GetTextPos(), delta));
    } else if (isMod(aPoints.Point(DIM_TEXT))) {
      dim.SetTextPos(aEditedPoint.GetPosition());
    }

    dim.Update();
  }
}

/** A textbox is edited as a rectangle when it is orthogonally aligned. */
export class TEXTBOX_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_textbox: PCB_TEXTBOX;

  constructor(aTextbox: PCB_TEXTBOX) {
    super();
    this.m_textbox = aTextbox;
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    // Rotated textboxes are implemented as polygons and these aren't currently editable.
    if (this.m_textbox.GetShape() === SHAPE_T.RECTANGLE)
      RECTANGLE_POINT_EDIT_BEHAVIOR.MakeRectPoints(this.m_textbox, aPoints);
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    // Careful; textbox shape is mutable between cardinal and non-cardinal rotations...
    const target = this.m_textbox.GetShape() === SHAPE_T.RECTANGLE ? RECT_MAX_POINTS : 0;

    if (aPoints.PointsSize() !== target) return false;

    RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectPoints(this.m_textbox, aPoints);
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    _aCommit: COMMIT,
    _aUpdatedItems: EDA_ITEM[],
  ): void {
    if (this.m_textbox.GetShape() === SHAPE_T.RECTANGLE) {
      this.m_textbox.ClearBoundingBoxCache();
      const minSize = this.m_textbox.GetMinSize();
      RECTANGLE_POINT_EDIT_BEHAVIOR.UpdateRectItem(this.m_textbox, aEditedPoint, aPoints, minSize);
    }
  }
}

export class SHAPE_GROUP_POINT_EDIT_BEHAVIOR extends POINT_EDIT_BEHAVIOR {
  private readonly m_group: PCB_GROUP | null;
  private readonly m_shapes: PCB_SHAPE[];
  private readonly m_parent: BOARD_ITEM;
  private readonly m_originalWidths = new Map<PCB_SHAPE, number>();

  constructor(aGroup: PCB_GROUP);
  constructor(aShapes: PCB_SHAPE[], aParent: BOARD_ITEM);
  constructor(aGroupOrShapes: PCB_GROUP | PCB_SHAPE[], aParent?: BOARD_ITEM) {
    super();

    if (Array.isArray(aGroupOrShapes)) {
      this.m_group = null;
      this.m_shapes = aGroupOrShapes;
      this.m_parent = aParent!;
    } else {
      this.m_group = aGroupOrShapes;
      this.m_parent = aGroupOrShapes;
      this.m_shapes = [];

      for (const item of aGroupOrShapes.GetBoardItems()) {
        if (item.Type() === KICAD_T.PCB_SHAPE_T) this.m_shapes.push(item as PCB_SHAPE);
      }
    }

    for (const shape of this.m_shapes) this.m_originalWidths.set(shape, shape.GetWidth());
  }

  override MakePoints(aPoints: EDIT_POINTS): void {
    const bbox = this.getBoundingBox();
    const tl = bbox.GetOrigin();
    const br = bbox.GetEnd();

    aPoints.AddPoint(tl);
    aPoints.AddPoint({ x: br.x, y: tl.y });
    aPoints.AddPoint(br);
    aPoints.AddPoint({ x: tl.x, y: br.y });
    aPoints.AddPoint(bbox.Centre());

    aPoints.AddIndicatorLine(aPoints.Point(RECT_TOP_LEFT), aPoints.Point(RECT_TOP_RIGHT));
    aPoints.AddIndicatorLine(aPoints.Point(RECT_TOP_RIGHT), aPoints.Point(RECT_BOT_RIGHT));
    aPoints.AddIndicatorLine(aPoints.Point(RECT_BOT_RIGHT), aPoints.Point(RECT_BOT_LEFT));
    aPoints.AddIndicatorLine(aPoints.Point(RECT_BOT_LEFT), aPoints.Point(RECT_TOP_LEFT));
  }

  override UpdatePoints(aPoints: EDIT_POINTS): boolean {
    const bbox = this.getBoundingBox();
    const tl = bbox.GetOrigin();
    const br = bbox.GetEnd();

    aPoints.Point(RECT_TOP_LEFT).SetPosition(tl);
    aPoints.Point(RECT_TOP_RIGHT).SetPosition({ x: br.x, y: tl.y });
    aPoints.Point(RECT_BOT_RIGHT).SetPosition(br);
    aPoints.Point(RECT_BOT_LEFT).SetPosition({ x: tl.x, y: br.y });
    aPoints.Point(RECT_CENTER).SetPosition(bbox.Centre());
    return true;
  }

  override UpdateItem(
    aEditedPoint: EDIT_POINT,
    aPoints: EDIT_POINTS,
    aCommit: COMMIT,
    aUpdatedItems: EDA_ITEM[],
  ): void {
    const oldBox = this.getBoundingBox();
    const oldCenter = oldBox.Centre();

    if (POINT_EDIT_BEHAVIOR.isModified(aEditedPoint, aPoints.Point(RECT_CENTER))) {
      const delta = sub(aPoints.Point(RECT_CENTER).GetPosition(), oldCenter);

      if (this.m_group) {
        aCommit.Modify(this.m_group, null, RECURSE_MODE.RECURSE);
        this.m_group.Move(delta);
      } else {
        for (const shape of this.m_shapes) {
          aCommit.Modify(shape);
          shape.Move(delta);
        }
      }

      for (const shape of this.m_shapes) aUpdatedItems.push(shape);

      this.UpdatePoints(aPoints);
      return;
    }

    const c = {
      topLeft: { ...aPoints.Point(RECT_TOP_LEFT).GetPosition() },
      topRight: { ...aPoints.Point(RECT_TOP_RIGHT).GetPosition() },
      botLeft: { ...aPoints.Point(RECT_BOT_LEFT).GetPosition() },
      botRight: { ...aPoints.Point(RECT_BOT_RIGHT).GetPosition() },
    };

    RECTANGLE_POINT_EDIT_BEHAVIOR.PinEditedCorner(aEditedPoint, aPoints, c);

    const sx = (c.botRight.x - c.topLeft.x) / oldBox.GetWidth();
    const sy = (c.botRight.y - c.topLeft.y) / oldBox.GetHeight();
    let scale = (sx + sy) / 2.0;

    // Prevent scaling below a minimum threshold to avoid precision loss when shapes
    // are scaled to near-zero size. Also prevent negative scaling which would flip
    // shapes when dragging past the center point.
    const MIN_SCALE = 0.01;

    if (scale < MIN_SCALE) scale = MIN_SCALE;

    for (const shape of this.m_shapes) {
      aCommit.Modify(shape);
      shape.Move({ x: -oldCenter.x, y: -oldCenter.y });
      shape.Scale(scale);
      shape.Move(oldCenter);

      const width = this.m_originalWidths.get(shape);

      if (width !== undefined) {
        this.m_originalWidths.set(shape, width * scale);
        shape.SetWidth(KiROUND(width * scale));
      } else {
        shape.SetWidth(KiROUND(shape.GetWidth() * scale));
      }

      aUpdatedItems.push(shape);
    }

    this.UpdatePoints(aPoints);
  }

  GetParent(): BOARD_ITEM {
    return this.m_parent;
  }

  private getBoundingBox(): BOX2I {
    const bbox = new BOX2I();

    for (const shape of this.m_shapes) bbox.Merge(shape.GetBoundingBox());

    return bbox;
  }
}

/** `snapCorner`: the point at `aAngleDeg` between aPrev and aNext nearest aGuess. */
function snapCorner(
  aPrev: VECTOR2I,
  aNext: VECTOR2I,
  aGuess: VECTOR2I,
  aAngleDeg: number,
): VECTOR2I {
  const angleRad = (aAngleDeg * Math.PI) / 180.0;
  const chord = Math.hypot(aNext.x - aPrev.x, aNext.y - aPrev.y);
  const sinA = Math.sin(angleRad);

  if (chord === 0.0 || Math.abs(sinA) < 1e-9) return aGuess;

  const radius = chord / (2.0 * sinA);
  const mid = { x: (aPrev.x + aNext.x) / 2.0, y: (aPrev.y + aNext.y) / 2.0 };
  const dir = { x: aNext.x - aPrev.x, y: aNext.y - aPrev.y };
  const nLen = Math.hypot(dir.y, dir.x);
  const normal = { x: -dir.y / nLen, y: dir.x / nLen };
  const hSq = radius * radius - (chord * chord) / 4.0;
  const h = hSq > 0.0 ? Math.sqrt(hSq) : 0.0;

  const center1 = { x: mid.x + normal.x * h, y: mid.y + normal.y * h };
  const center2 = { x: mid.x - normal.x * h, y: mid.y - normal.y * h };

  const project = (center: { x: number; y: number }): VECTOR2I => {
    let v = { x: aGuess.x - center.x, y: aGuess.y - center.y };

    if (Math.hypot(v.x, v.y) === 0.0) v = { x: aPrev.x - center.x, y: aPrev.y - center.y };

    const l = Math.hypot(v.x, v.y);
    v = { x: v.x / l, y: v.y / l };
    return { x: KiROUND(center.x + v.x * radius), y: KiROUND(center.y + v.y * radius) };
  };

  const p1 = project(center1);
  const p2 = project(center2);

  const d1 = Math.hypot(aGuess.x - p1.x, aGuess.y - p1.y);
  const d2 = Math.hypot(aGuess.x - p2.x, aGuess.y - p2.y);

  return d1 < d2 ? p1 : p2;
}

/** `findVertex`: the vertex of a polygon set at an edit point's position. */
function findVertex(aPolySet: SHAPE_POLY_SET, aPoint: EDIT_POINT): VERTEX_INDEX | null {
  const pos = aPoint.GetPosition();

  for (const it = aPolySet.IterateWithHoles(); it.valid(); it.Advance()) {
    const vertexIdx = it.GetIndex();
    const v = aPolySet.CVertex(vertexIdx);

    if (v.x === pos.x && v.y === pos.y) return vertexIdx;
  }

  return null;
}

/** A zone or a polygon PCB_SHAPE: the items whose edges are EC_CONVERGING lines. */
function isPolygonItem(aItem: EDA_ITEM | null): boolean {
  if (!aItem) return false;

  if (aItem.Type() === KICAD_T.PCB_ZONE_T) return true;

  return aItem.Type() === KICAD_T.PCB_SHAPE_T && (aItem as PCB_SHAPE).GetShape() === SHAPE_T.POLY;
}

/** The outline a zone or polygon shape edits, or null. */
function polygonOf(aItem: EDA_ITEM): SHAPE_POLY_SET | null {
  if (aItem.Type() === KICAD_T.PCB_ZONE_T) return (aItem as ZONE).Outline();

  if (aItem.Type() === KICAD_T.PCB_SHAPE_T && (aItem as PCB_SHAPE).GetShape() === SHAPE_T.POLY)
    return (aItem as PCB_SHAPE).GetPolyShape();

  return null;
}

/**
 * `PCB_POINT_EDITOR` (pcb_point_editor.cpp): edit points (handles) on the one
 * selected item, or on a multi-selection of graphic shapes, and the commands
 * that add, remove and chamfer polygon corners.
 */
export class PCB_POINT_EDITOR extends PCB_TOOL_BASE {
  static readonly COORDS_PADDING = COORDS_PADDING;

  private m_frame: PCB_BASE_FRAME | null = null;
  private m_selectionTool: PCB_SELECTION_TOOL | null = null;
  private m_editPoints: EDIT_POINTS | null = null;
  /** `EDIT_POINT* m_editedPoint`: currently edited point, null if there is none. */
  private m_editedPoint: EDIT_POINT | null = null;
  private m_hoveredPoint: EDIT_POINT | null = null;
  /** Original position for the current drag point. */
  private m_original = new EDIT_POINT({ x: 0, y: 0 });
  /** `m_arcEditMode`, a cell the arc behaviour reads live. */
  private readonly m_arcEditMode = { value: ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS };
  private m_editorBehavior: POINT_EDIT_BEHAVIOR | null = null;
  private m_angleItem: ANGLE_ITEM | null = null;
  private readonly m_preview = new PCB_SELECTION();
  private m_radiusHelper: RECT_RADIUS_TEXT_ITEM | null = null;
  private m_altConstraint: EDIT_CONSTRAINT<EDIT_POINT> | null = null;
  private m_altConstrainer = new EDIT_POINT({ x: 0, y: 0 });
  private m_inPointEditorTool = false;
  private m_angleSnapPos: VECTOR2I = { x: 0, y: 0 };
  private m_stickyDisplacement: VECTOR2I = { x: 0, y: 0 };
  private m_angleSnapActive = false;

  constructor() {
    super('pcbnew.PointEditor');
  }

  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<PCB_BASE_FRAME>();

    const view = this.getView();

    if (view) {
      if (this.m_angleItem && view.HasItem(this.m_angleItem)) view.Remove(this.m_angleItem);

      if (this.m_editPoints && view.HasItem(this.m_editPoints)) view.Remove(this.m_editPoints);

      if (view.HasItem(this.m_preview)) view.Remove(this.m_preview);
    }

    this.m_angleItem = null;
    this.m_editPoints = null;
    this.m_altConstraint = null;
    this.getViewControls() && this.controls().SetAutoPan(false);
    this.m_angleSnapActive = false;
    this.m_stickyDisplacement = { x: 0, y: 0 };
  }

  override Init(): boolean {
    // Find the selection tool, so they can cooperate
    this.m_selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as PCB_SELECTION_TOOL | null;

    console.assert(
      this.m_selectionTool !== null,
      'pcbnew.InteractiveSelection tool is not available',
    );

    if (!this.m_selectionTool) return true;

    const arcIsEdited = (aSelection: SELECTION): boolean => {
      const item = aSelection.Front();
      return (
        item !== null &&
        item !== undefined &&
        item.Type() === KICAD_T.PCB_SHAPE_T &&
        (item as PCB_SHAPE).GetShape() === SHAPE_T.ARC
      );
    };

    const menu = this.m_selectionTool.GetToolMenu().GetMenu();

    menu.AddItem(
      PCB_ACTIONS.cycleArcEditMode,
      SELECTION_CONDITIONS.And(SELECTION_CONDITIONS.Count(1), arcIsEdited),
    );

    return true;
  }

  /** The canvas's VIEW_CONTROLS (`getViewControls()`). */
  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /** Indicate the cursor is over an edit point. Used to coordinate cursor shapes with other tools. */
  HasPoint(): boolean {
    return this.m_editedPoint !== null;
  }

  /** `HasMidpoint()`: the edited point is an EDIT_LINE. */
  HasMidpoint(): boolean {
    return this.HasPoint() && this.m_editedPoint instanceof EDIT_LINE;
  }

  /** `HasCorner()`. */
  HasCorner(): boolean {
    return this.HasPoint() && !this.HasMidpoint();
  }

  /** The current handles, for the window's TRANSITIONAL cursor and tests. */
  GetEditPoints(): EDIT_POINTS | null {
    return this.m_editPoints;
  }

  /** `CanAddCorner( const EDA_ITEM& )` (pcb_point_editor.cpp:1848). */
  static CanAddCorner(aItem: EDA_ITEM): boolean {
    const type = aItem.Type();

    if (type === KICAD_T.PCB_ZONE_T) return true;

    if (type === KICAD_T.PCB_SHAPE_T) {
      const shapeType = (aItem as PCB_SHAPE).GetShape();
      return (
        shapeType === SHAPE_T.SEGMENT || shapeType === SHAPE_T.POLY || shapeType === SHAPE_T.ARC
      );
    }

    return false;
  }

  /** `CanChamferCorner( const EDA_ITEM& )` (pcb_point_editor.cpp:1866). */
  static CanChamferCorner(aItem: EDA_ITEM): boolean {
    const type = aItem.Type();

    if (type === KICAD_T.PCB_ZONE_T) return true;

    if (type === KICAD_T.PCB_SHAPE_T) return (aItem as PCB_SHAPE).GetShape() === SHAPE_T.POLY;

    return false;
  }

  /** `CanRemoveCorner( const SELECTION& )` (pcb_point_editor.cpp:3150). */
  CanRemoveCorner(_aSelection: SELECTION): boolean {
    if (!this.m_editPoints || !this.m_editedPoint) return false;

    const item = this.m_editPoints.GetParent();

    if (!item) return false;

    const polyset = polygonOf(item);

    if (!polyset) return false;

    const vertexIdx = findVertex(polyset, this.m_editedPoint);

    if (!vertexIdx) return false;

    // Check if there are enough vertices so one can be removed without degenerating the
    // polygon. The first condition allows one to remove all corners from holes (when there
    // are only 2 vertices left, a hole is removed).
    if (
      vertexIdx.m_contour === 0 &&
      polyset.Polygon(vertexIdx.m_polygon)[vertexIdx.m_contour]!.PointCount() <= 3
    )
      return false;

    // Remove corner does not work with lines
    if (this.m_editedPoint instanceof EDIT_LINE) return false;

    return this.m_editedPoint !== null;
  }

  private makePoints(aItem: EDA_ITEM | null): EDIT_POINTS | null {
    const points = new EDIT_POINTS(aItem);

    if (!aItem) return points;

    // Reset the behaviour and we'll make a new one
    this.m_editorBehavior = null;
    let keep = true;

    switch (aItem.Type()) {
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        this.m_editorBehavior = new REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR(
          aItem as PCB_REFERENCE_IMAGE,
        );
        break;

      case KICAD_T.PCB_BARCODE_T:
        this.m_editorBehavior = new BARCODE_POINT_EDIT_BEHAVIOR(aItem as PCB_BARCODE);
        break;

      case KICAD_T.PCB_TEXTBOX_T:
        this.m_editorBehavior = new TEXTBOX_POINT_EDIT_BEHAVIOR(aItem as PCB_TEXTBOX);
        break;

      case KICAD_T.PCB_SHAPE_T: {
        const shape = aItem as PCB_SHAPE;

        switch (shape.GetShape()) {
          case SHAPE_T.SEGMENT:
            this.m_editorBehavior = new EDA_SEGMENT_POINT_EDIT_BEHAVIOR(asEdaShape(shape));
            break;

          case SHAPE_T.RECTANGLE:
            this.m_editorBehavior = new RECTANGLE_POINT_EDIT_BEHAVIOR(shape);
            break;

          case SHAPE_T.ARC:
            this.m_editorBehavior = new EDA_ARC_POINT_EDIT_BEHAVIOR(
              asEdaShape(shape),
              this.m_arcEditMode,
              this.controls(),
              pcbIUScale,
            );
            break;

          case SHAPE_T.CIRCLE:
            this.m_editorBehavior = new EDA_CIRCLE_POINT_EDIT_BEHAVIOR(asEdaShape(shape));
            break;

          case SHAPE_T.POLY:
            this.m_editorBehavior = new EDA_POLYGON_POINT_EDIT_BEHAVIOR(asEdaShape(shape));
            break;

          case SHAPE_T.BEZIER:
            this.m_editorBehavior = new EDA_BEZIER_POINT_EDIT_BEHAVIOR(
              asEdaShape(shape),
              shape.GetMaxError(),
            );
            break;

          default: // suppress warnings
            break;
        }

        break;
      }

      case KICAD_T.PCB_GROUP_T: {
        const group = aItem as PCB_GROUP;
        let shapesOnly = true;

        for (const child of group.GetBoardItems()) {
          if (child.Type() !== KICAD_T.PCB_SHAPE_T) {
            shapesOnly = false;
            break;
          }
        }

        if (shapesOnly) this.m_editorBehavior = new SHAPE_GROUP_POINT_EDIT_BEHAVIOR(group);
        else keep = false;

        break;
      }

      case KICAD_T.PCB_TABLECELL_T: {
        const cell = aItem as PCB_TABLECELL;

        // No support for point-editing of a rotated table
        if (cell.GetShape() === SHAPE_T.RECTANGLE)
          this.m_editorBehavior = new PCB_TABLECELL_POINT_EDIT_BEHAVIOR(cell);

        break;
      }

      case KICAD_T.PCB_PAD_T: {
        // Pad edit only for the footprint editor
        if (this.m_isFootprintEditor) {
          let activeLayer = this.m_frame ? this.m_frame.GetActiveLayer() : PADSTACK.ALL_LAYERS;

          // Point editor only handles copper shape changes
          if (!IsCopperLayer(activeLayer))
            activeLayer = IsFrontLayer(activeLayer) ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu;

          this.m_editorBehavior = new PAD_POINT_EDIT_BEHAVIOR(aItem as PAD, activeLayer);
        }

        break;
      }

      case KICAD_T.PCB_ZONE_T:
        this.m_editorBehavior = new ZONE_POINT_EDIT_BEHAVIOR(aItem as ZONE);
        break;

      case KICAD_T.PCB_GENERATOR_T:
        this.m_editorBehavior = new GENERATOR_POINT_EDIT_BEHAVIOR(aItem as PCB_GENERATOR);
        break;

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
        this.m_editorBehavior = new ALIGNED_DIMENSION_POINT_EDIT_BEHAVIOR(aItem as PCB_DIM_ALIGNED);
        break;

      case KICAD_T.PCB_DIM_CENTER_T:
        this.m_editorBehavior = new DIM_CENTER_POINT_EDIT_BEHAVIOR(aItem as PCB_DIM_CENTER);
        break;

      case KICAD_T.PCB_DIM_RADIAL_T:
        this.m_editorBehavior = new DIM_RADIAL_POINT_EDIT_BEHAVIOR(aItem as PCB_DIM_RADIAL);
        break;

      case KICAD_T.PCB_DIM_LEADER_T:
        this.m_editorBehavior = new DIM_LEADER_POINT_EDIT_BEHAVIOR(aItem as PCB_DIM_LEADER);
        break;

      default:
        keep = false;
        break;
    }

    if (!keep) return null;

    if (this.m_editorBehavior) this.m_editorBehavior.MakePoints(points);

    return points;
  }

  private updateEditedPoint(aEvent: TOOL_EVENT): void {
    const view = this.getView()!;
    let point: EDIT_POINT | null;
    let hovered: EDIT_POINT | null = null;

    if (aEvent.IsMotion()) {
      point = this.m_editPoints!.FindPoint(aEvent.Position(), view);
      hovered = point;
    } else if (aEvent.IsDrag(BUT_LEFT)) {
      point = this.m_editPoints!.FindPoint(aEvent.DragOrigin(), view);
    } else {
      point = this.m_editPoints!.FindPoint(this.controls().GetCursorPosition(), view);
    }

    if (hovered) {
      if (this.m_hoveredPoint !== hovered) {
        if (this.m_hoveredPoint) this.m_hoveredPoint.SetHover(false);

        this.m_hoveredPoint = hovered;
        this.m_hoveredPoint.SetHover();
      }
    } else if (this.m_hoveredPoint) {
      this.m_hoveredPoint.SetHover(false);
      this.m_hoveredPoint = null;
    }

    if (this.m_editedPoint !== point) this.setEditedPoint(point);
  }

  private arcEditModeSetting(aFrame: PCB_BASE_EDIT_FRAME): ARC_EDIT_MODE {
    if (aFrame.IsType(FRAME_T.FRAME_PCB_EDITOR)) return aFrame.GetPcbNewSettings().m_ArcEditMode;

    return (
      aFrame.GetFootprintEditorSettings().m_ArcEditMode ??
      ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS
    );
  }

  *OnSelectionChange(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_selectionTool || aEvent.Matches(EVENTS.InhibitSelectionEditing)) return 0;

    // A frame with no canvas (headless, as in a script or a test) has no VIEW to
    // draw points in; KiCad's frames always have one.
    if (!this.getView() || !this.getViewControls()) return 0;

    if (this.m_inPointEditorTool) return 0;

    // REENTRANCY_GUARD guard( &m_inPointEditorTool )
    this.m_inPointEditorTool = true;

    try {
      return yield* this.onSelectionChange(aEvent);
    } finally {
      this.m_inPointEditorTool = false;
    }
  }

  private *onSelectionChange(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const editFrame = this.getEditFrame<PCB_BASE_EDIT_FRAME>();
    const selection = this.m_selectionTool!.GetSelection();
    const controls = this.controls();
    const view = this.getView()!;

    if (selection.Size() === 0) return 0;

    for (const selItem of selection) {
      if (selItem.GetEditFlags() || !selItem.IsBOARD_ITEM()) return 0;
    }

    const item = selection.Front() as BOARD_ITEM | null;

    if (!item || item.IsLocked()) return 0;

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);

    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, editFrame.GetMagneticItemsSettings());

    this.m_editorBehavior = null;

    if (selection.Size() > 1) {
      // Multi-selection: check if all items are shapes
      const shapes: PCB_SHAPE[] = [];
      let allShapes = true;
      let anyLocked = false;

      for (const selItem of selection) {
        if (selItem.Type() === KICAD_T.PCB_SHAPE_T) {
          const shape = selItem as PCB_SHAPE;
          shapes.push(shape);

          if (shape.IsLocked()) anyLocked = true;
        } else {
          allShapes = false;
        }
      }

      if (allShapes && shapes.length > 1 && !anyLocked) {
        this.m_editorBehavior = new SHAPE_GROUP_POINT_EDIT_BEHAVIOR(shapes, item);
        this.m_editPoints = new EDIT_POINTS(item);
        this.m_editorBehavior.MakePoints(this.m_editPoints);
      } else {
        return 0;
      }
    } else {
      // Single selection: use existing makePoints logic
      this.m_editPoints = this.makePoints(item);
    }

    if (!this.m_editPoints) return 0;

    // Only add the angle_item if we are editing a polygon or zone
    if (isPolygonItem(item)) this.m_angleItem = new ANGLE_ITEM(this.m_editPoints);

    this.m_preview.FreeItems();
    this.m_radiusHelper = null;
    view.Add(this.m_preview);

    this.m_radiusHelper = new RECT_RADIUS_TEXT_ITEM(pcbIUScale, editFrame.GetUserUnits());
    this.m_preview.Add(this.m_radiusHelper);

    view.Add(this.m_editPoints);

    if (this.m_angleItem) view.Add(this.m_angleItem);

    this.setEditedPoint(null);
    this.updateEditedPoint(aEvent);
    let inDrag = false;
    let isConstrained = false;
    let haveSnapLineDirections = false;

    const updateSnapLineDirections = (): void => {
      let directions: VECTOR2I[] = [];

      if (inDrag && this.m_editedPoint) {
        let constraint: EDIT_CONSTRAINT<EDIT_POINT> | null = null;

        if (this.m_altConstraint) constraint = this.m_altConstraint;
        else if (this.m_editedPoint.IsConstrained())
          constraint = this.m_editedPoint.GetConstraint();

        directions = getConstraintDirections(constraint);
      }

      if (directions.length === 0) {
        grid.SetSnapLineDirections([]);
        grid.SetSnapLineEnd(null);
        haveSnapLineDirections = false;
      } else {
        const origin = this.m_altConstraint
          ? this.m_altConstrainer.GetPosition()
          : this.m_original.GetPosition();

        grid.SetSnapLineDirections(directions);
        grid.SetSnapLineOrigin(origin);
        grid.SetSnapLineEnd(null);
        haveSnapLineDirections = true;
      }
    };

    const commit = new BOARD_COMMIT(editFrame);

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      grid.SetUseGrid(view.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

      this.m_arcEditMode.value = this.arcEditModeSetting(editFrame);

      if (
        !this.m_editPoints ||
        evt.IsSelectionEvent() ||
        evt.Matches(EVENTS.InhibitSelectionEditing)
      )
        break;

      const prevHover = this.m_hoveredPoint;

      if (!inDrag) this.updateEditedPoint(evt);

      if (prevHover !== this.m_hoveredPoint) {
        view.Update(this.m_editPoints!);

        if (this.m_angleItem) view.Update(this.m_angleItem);
      }

      if (evt.IsDrag(BUT_LEFT) && this.m_editedPoint) {
        const editedPoint: EDIT_POINT = this.m_editedPoint;

        if (!inDrag) {
          this.frame().UndoRedoBlock(true);

          if (item.Type() === KICAD_T.PCB_GENERATOR_T) {
            this.m_toolMgr!.RunSynchronousAction(PCB_ACTIONS.genStartEdit, commit, item);
          }

          controls.ForceCursorPosition(false);
          this.m_original = new EDIT_POINT(editedPoint.GetPosition()); // Save the original position
          controls.SetAutoPan(true);
          inDrag = true;

          if (editedPoint.GetGridConstraint() !== GRID_CONSTRAINT_TYPE.SNAP_BY_GRID)
            grid.SetAuxAxes(true, this.m_original.GetPosition());

          editedPoint.SetActive();

          for (let ii = 0; ii < this.m_editPoints!.PointsSize(); ++ii) {
            const point = this.m_editPoints!.Point(ii);

            if (point !== editedPoint) point.SetActive(false);
          }

          // When we start dragging, the item's own geometry is the reference
          // (e.g. for intersections and extensions). KiCad proposes a clone so
          // the reference holds still while the item moves; the live grid
          // helper builds its drawables now, from the item as it is.
          if (item.Type() === KICAD_T.PCB_SHAPE_T || item instanceof PCB_SHAPE) {
            const shape = item as PCB_SHAPE;
            shape.SetFlags(IS_MOVING);
            shape.UpdateHatching();
          }

          grid.AddConstructionItems([item], false, true);

          updateSnapLineDirections();
        }

        const line = editedPoint instanceof EDIT_LINE ? editedPoint : null;
        const ctrlHeld = evt.Modifier(MD_CTRL);

        const needConstraint = (this.Is45Limited() || this.Is90Limited()) && !ctrlHeld;

        if (isConstrained !== needConstraint) {
          this.setAltConstraint(needConstraint);
          isConstrained = needConstraint;
          updateSnapLineDirections();
        }

        // For polygon lines, Ctrl temporarily toggles between CONVERGING and FIXED_LENGTH modes
        if (line && isPolygonItem(item)) {
          const constraint = line.GetConstraint();

          if (constraint instanceof EC_CONVERGING) {
            const targetMode = ctrlHeld
              ? POLYGON_LINE_MODE.FIXED_LENGTH
              : POLYGON_LINE_MODE.CONVERGING;

            if (constraint.GetMode() !== targetMode) constraint.SetMode(targetMode);
          }
        }

        // Keep point inside of limits with some padding
        let pos = toVECTOR2I(GetClampedCoords(evt.Position(), COORDS_PADDING));
        let snapLayers = new LSET();

        switch (editedPoint.GetSnapConstraint()) {
          case SNAP_CONSTRAINT_TYPE.IGNORE_SNAPS:
            break;
          case SNAP_CONSTRAINT_TYPE.OBJECT_LAYERS:
            snapLayers = item.GetLayerSet();
            break;
          case SNAP_CONSTRAINT_TYPE.ALL_LAYERS:
            snapLayers = LSET.AllLayersMask();
            break;
        }

        if (editedPoint.GetGridConstraint() === GRID_CONSTRAINT_TYPE.SNAP_BY_GRID) {
          if (grid.GetUseGrid()) {
            const convergingConstraint =
              line && line.GetConstraint() instanceof EC_CONVERGING
                ? (line.GetConstraint() as EC_CONVERGING)
                : null;

            let snappedAlongPerp = false;

            if (convergingConstraint) {
              // For a polygon edge, the line moves only perpendicular to itself. Quantize the
              // perpendicular displacement directly so each grid step produces one stable line
              // position.
              const origCenter = convergingConstraint.GetOriginalCenter();
              const perpVec = convergingConstraint.GetPerpVector();
              const perpLen = Math.hypot(perpVec.x, perpVec.y);

              if (perpLen > 0) {
                const perpUnit = { x: perpVec.x / perpLen, y: perpVec.y / perpLen };
                const gridSize = grid.GetGridSize(grid.GetItemGrid(item));

                // Effective grid spacing along the perpendicular direction. For an
                // axis-aligned edge this reduces to the grid pitch on that axis.
                const step = Math.hypot(gridSize.x * perpUnit.x, gridSize.y * perpUnit.y);

                if (step > 0) {
                  const offset =
                    (pos.x - origCenter.x) * perpUnit.x + (pos.y - origCenter.y) * perpUnit.y;
                  const snapped = Math.round(offset / step) * step;
                  pos = {
                    x: KiROUND(origCenter.x + perpUnit.x * snapped),
                    y: KiROUND(origCenter.y + perpUnit.y * snapped),
                  };
                  snappedAlongPerp = true;
                }
              }
            }

            if (!snappedAlongPerp) {
              const gridPt = grid.BestSnapAnchor(pos, new LSET(), grid.GetItemGrid(item), [item]);

              const last = editedPoint.GetPosition();
              const delta = sub(pos, last);
              const deltaGrid = sub(
                gridPt,
                grid.BestSnapAnchor(last, new LSET(), grid.GetItemGrid(item), [item]),
              );

              if (Math.abs(delta.x) > grid.GetGrid().x / 2) pos.x = last.x + deltaGrid.x;
              else pos.x = last.x;

              if (Math.abs(delta.y) > grid.GetGrid().y / 2) pos.y = last.y + deltaGrid.y;
              else pos.y = last.y;
            }
          }
        }

        if (this.m_angleSnapActive) {
          this.m_stickyDisplacement = sub(evt.Position(), this.m_angleSnapPos);
          const stickyLimit = KiROUND(view.ToWorld(5));

          if (EuclideanNorm(this.m_stickyDisplacement) > stickyLimit || evt.Modifier(MD_SHIFT))
            this.m_angleSnapActive = false;
          else pos = this.m_angleSnapPos;
        }

        const isFreePolygon = isPolygonItem(item);

        if (
          isFreePolygon &&
          !this.m_angleSnapActive &&
          this.m_editPoints!.PointsSize() > 2 &&
          !evt.Modifier(MD_SHIFT)
        ) {
          const idx = this.getEditedPointIndex();

          if (idx !== -1) {
            const size = this.m_editPoints!.PointsSize();
            const prevIdx = (idx + size - 1) % size;
            const nextIdx = (idx + 1) % size;
            const prev = this.m_editPoints!.Point(prevIdx).GetPosition();
            const next = this.m_editPoints!.Point(nextIdx).GetPosition();
            const segA = new SEG(pos, prev);
            const segB = new SEG(pos, next);
            const ang = segA.Angle(segB).AsDegrees();
            const snapAng = 45.0 * Math.round(ang / 45.0);

            if (Math.abs(ang - snapAng) < 2.0) {
              let snapped = snapCorner(prev, next, pos, snapAng);

              if (
                editedPoint.GetGridConstraint() === GRID_CONSTRAINT_TYPE.SNAP_TO_GRID &&
                grid.GetSnap()
              ) {
                const gridded = grid.BestSnapAnchor(snapped, new LSET(), grid.GetItemGrid(item), [
                  item,
                ]);
                const griddedAng = new SEG(gridded, prev).Angle(new SEG(gridded, next)).AsDegrees();

                snapped = Math.abs(griddedAng - snapAng) < 2.0 ? gridded : pos;
              }

              if (snapped.x !== pos.x || snapped.y !== pos.y) {
                this.m_angleSnapPos = snapped;
                this.m_angleSnapActive = true;
                this.m_stickyDisplacement = sub(evt.Position(), this.m_angleSnapPos);
                pos = this.m_angleSnapPos;
              }
            }
          }
        }

        let constraintSnapped = false;
        const snapTolerance = KiROUND(view.ToWorld(5));

        // For constrained lines (like zone edges), try to snap to nearby anchors that lie on
        // the constraint line: get the constrained position, look for a snap anchor, and keep
        // it only if re-applying the constraint lands close to it.
        const snapOnConstraint = (aApply: () => void): void => {
          // `!snapLayers.empty()`: sul::dynamic_bitset::empty() is size() == 0, never
          // true of an LSET, so this runs for every snap constraint, IGNORE_SNAPS too.
          if (grid.GetSnap() && snapLayers.size() !== 0) {
            const constrainedPos = editedPoint.GetPosition();
            const snapPos = grid.BestSnapAnchor(
              constrainedPos,
              snapLayers,
              grid.GetItemGrid(item),
              [item],
            );

            if (snapPos.x !== constrainedPos.x || snapPos.y !== constrainedPos.y) {
              editedPoint.SetPosition(snapPos);
              aApply();
              const projectedPos = editedPoint.GetPosition();

              if (EuclideanNorm(sub(projectedPos, snapPos)) > snapTolerance)
                editedPoint.SetPosition(constrainedPos);
            }
          }
        };

        // Apply 45 degree or other constraints
        if (!this.m_angleSnapActive && this.m_altConstraint) {
          const altConstraint = this.m_altConstraint;
          editedPoint.SetPosition(pos);
          altConstraint.Apply(grid);
          constraintSnapped = true;
          snapOnConstraint(() => altConstraint.Apply(grid));
        } else if (!this.m_angleSnapActive && editedPoint.IsConstrained()) {
          editedPoint.SetPosition(pos);
          editedPoint.ApplyConstraint(grid);
          constraintSnapped = true;
          snapOnConstraint(() => editedPoint.ApplyConstraint(grid));
        } else if (
          !this.m_angleSnapActive &&
          editedPoint.GetGridConstraint() === GRID_CONSTRAINT_TYPE.SNAP_TO_GRID
        ) {
          editedPoint.SetPosition(
            grid.BestSnapAnchor(pos, snapLayers, grid.GetItemGrid(item), [item]),
          );
        } else {
          editedPoint.SetPosition(pos);
        }

        if (haveSnapLineDirections) {
          const snapOrigin = this.m_altConstraint
            ? this.m_altConstrainer.GetPosition()
            : this.m_original.GetPosition();
          grid.SetSnapLineOrigin(snapOrigin);

          if (constraintSnapped) grid.SetSnapLineEnd(editedPoint.GetPosition());
          else grid.SetSnapLineEnd(null);
        }

        this.updateItem(commit);
        controls.ForceCursorPosition(true, editedPoint.GetPosition());
        this.updatePoints();

        if (this.m_radiusHelper) {
          if (
            this.m_editPoints!.PointsSize() > RECT_RADIUS &&
            this.m_editedPoint === this.m_editPoints!.Point(RECT_RADIUS) &&
            item instanceof PCB_SHAPE
          ) {
            const rect = item;
            const radius = rect.GetCornerRadius();
            // `int offset = radius - M_SQRT1_2 * radius`: truncated.
            const offset = Math.trunc(radius - Math.SQRT1_2 * radius);
            const topLeft = rect.GetTopLeft();
            const botRight = rect.GetBotRight();
            const topRight = { x: botRight.x, y: topLeft.y };
            const center = { x: topRight.x - offset, y: topRight.y + offset };
            this.m_radiusHelper.SetRadius(
              radius,
              center,
              { x: 1, y: -1 },
              editFrame.GetUserUnits(),
            );
          } else {
            this.m_radiusHelper.Hide();
          }
        }

        view.Update(this.m_preview);
      } else if (
        this.m_editedPoint &&
        evt.Action() === TOOL_ACTIONS.TA_MOUSE_DOWN &&
        evt.Buttons() === BUT_LEFT
      ) {
        this.m_editedPoint.SetActive();

        for (let ii = 0; ii < this.m_editPoints!.PointsSize(); ++ii) {
          const point = this.m_editPoints!.Point(ii);

          if (point !== this.m_editedPoint) point.SetActive(false);
        }

        view.Update(this.m_editPoints!);

        if (this.m_angleItem) view.Update(this.m_angleItem);
      } else if (inDrag && evt.IsMouseUp(BUT_LEFT)) {
        if (this.m_editedPoint) {
          this.m_editedPoint.SetActive(false);
          view.Update(this.m_editPoints!);

          if (this.m_angleItem) view.Update(this.m_angleItem);
        }

        if (this.m_radiusHelper) this.m_radiusHelper.Hide();

        view.Update(this.m_preview);

        controls.SetAutoPan(false);
        this.setAltConstraint(false);
        updateSnapLineDirections();

        if (this.m_editorBehavior) this.m_editorBehavior.FinalizeItem(this.m_editPoints!, commit);

        if (item.Type() === KICAD_T.PCB_GENERATOR_T) {
          const generator = item as PCB_GENERATOR;

          this.m_preview.FreeItems();
          this.m_radiusHelper = null;
          this.m_toolMgr!.RunSynchronousAction(PCB_ACTIONS.genFinishEdit, commit, generator);

          commit.Push(generator.GetCommitMessage());
        } else if (item.Type() === KICAD_T.PCB_TABLECELL_T) {
          commit.Push('Resize Table Cells');
        } else {
          commit.Push('Move Point');
        }

        if (item instanceof PCB_SHAPE) {
          item.ClearFlags(IS_MOVING);
          item.UpdateHatching();
        }

        inDrag = false;
        this.frame().UndoRedoBlock(false);
        updateSnapLineDirections();

        // FIXME: Needed for generators
        this.m_toolMgr!.PostAction(ACTIONS.reselectItem, item);
      } else if (evt.IsCancelInteractive() || evt.IsActivate()) {
        // Restore the last change
        if (inDrag) {
          if (item.Type() === KICAD_T.PCB_GENERATOR_T)
            this.m_toolMgr!.RunSynchronousAction(PCB_ACTIONS.genCancelEdit, commit, item);

          commit.Revert();

          if (item instanceof PCB_SHAPE) {
            item.ClearFlags(IS_MOVING);
            item.UpdateHatching();
          }

          inDrag = false;
          this.frame().UndoRedoBlock(false);
          updateSnapLineDirections();
        }

        // Only cancel point editor when activating a new tool. Otherwise, allow the points
        // to persist when moving up the tool stack
        if (evt.IsActivate() && !evt.IsMoveTool()) break;
      } else if (evt.IsAction(PCB_ACTIONS.layerChanged)) {
        // Re-create the points for items which can have different behavior on different layers
        if (item.Type() === KICAD_T.PCB_PAD_T && this.m_isFootprintEditor) {
          if (this.m_editPoints && view.HasItem(this.m_editPoints)) view.Remove(this.m_editPoints);

          if (this.m_angleItem && view.HasItem(this.m_angleItem)) view.Remove(this.m_angleItem);

          this.m_editPoints = this.makePoints(item);

          if (this.m_angleItem) {
            this.m_angleItem.SetEditPoints(this.m_editPoints);
            view.Add(this.m_angleItem);
          }

          if (this.m_editPoints) view.Add(this.m_editPoints);
        }
      } else if (evt.Action() === TOOL_ACTIONS.TA_UNDO_REDO_POST) {
        break;
      } else {
        evt.SetPassEvent();
      }
    }

    if (item instanceof PCB_SHAPE) {
      item.ClearFlags(IS_MOVING);
      item.UpdateHatching();
    }

    this.m_preview.FreeItems();
    this.m_radiusHelper = null;

    if (view.HasItem(this.m_preview)) view.Remove(this.m_preview);

    if (this.m_editPoints) {
      if (view.HasItem(this.m_editPoints)) view.Remove(this.m_editPoints);

      if (this.m_angleItem && view.HasItem(this.m_angleItem)) view.Remove(this.m_angleItem);

      this.m_editPoints = null;
      this.m_angleItem = null;
    }

    this.m_editedPoint = null;
    grid.SetSnapLineDirections([]);

    return 0;
  }

  /** `movePoint`: Move Corner / Midpoint to Location, through the frame's point entry dialog. */
  *movePoint(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_editPoints?.GetParent() || !this.HasPoint()) return 0;

    const editFrame = this.getEditFrame<PCB_BASE_EDIT_FRAME>();
    const editedPoint = this.m_editedPoint!;

    const commit = new BOARD_COMMIT(editFrame);
    commit.Stage(this.m_editPoints.GetParent()!, CHANGE_TYPE.CHT_MODIFY);

    const pt = editedPoint.GetPosition();
    let title: string;
    let msg: string;

    if (editedPoint instanceof EDIT_LINE) {
      title = 'Move Midpoint to Location';
      msg = 'Move Midpoint';
    } else {
      title = 'Move Corner to Location';
      msg = 'Move Corner';
    }

    const value = yield* this.RunMainStackModal(() =>
      editFrame.ShowPointEntryDialog(title, 'X:', 'Y:', pt, false),
    );

    if (value) {
      editedPoint.SetPosition(value);
      this.updateItem(commit);
      commit.Push(msg);
    }

    return 0;
  }

  private updateItem(aCommit: BOARD_COMMIT): void {
    if (!this.m_editPoints) return;

    const item = this.m_editPoints.GetParent();

    if (!item) return;

    // item is always updated
    const updatedItems: EDA_ITEM[] = [item];
    aCommit.Modify(item);

    if (this.m_editorBehavior) {
      if (!this.m_editedPoint) return;

      this.m_editorBehavior.UpdateItem(
        this.m_editedPoint,
        this.m_editPoints,
        aCommit,
        updatedItems,
      );
    }

    // Perform any post-edit actions that the item may require
    switch (item.Type()) {
      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_SHAPE_T: {
        const shape = item as PCB_SHAPE;

        if (shape.IsProxyItem()) {
          for (const pad of shape.GetParentFootprint()!.Pads()) {
            if (pad.IsEntered()) this.view()!.Update(pad);
          }
        }

        // Nuke outline font render caches
        if (item instanceof PCB_TEXTBOX) item.ClearRenderCache();

        break;
      }

      case KICAD_T.PCB_GENERATOR_T: {
        const generatorItem = item as PCB_GENERATOR;

        this.m_toolMgr!.RunSynchronousAction(PCB_ACTIONS.genUpdateEdit, aCommit, generatorItem);

        // Note: POINT_EDITOR::m_preview holds only the canvas-draw status "popup"; the meanders
        // themselves (ROUTER_PREVIEW_ITEMs) are owned by the router.
        this.m_preview.FreeItems();
        this.m_radiusHelper = null;

        // `for( EDA_ITEM* previewItem : generatorItem->GetPreviewItems( generatorTool, frame(),
        // STATUS_ITEMS_ONLY ) ) m_preview.Add( previewItem )`: PCB_GENERATOR::GetPreviewItems
        // (the tuning status popup) is not ported yet, so the preview stays empty.
        this.getView()!.Update(this.m_preview);
        break;
      }

      default:
        break;
    }

    // Update the item and any affected items
    for (const updatedItem of updatedItems) this.getView()!.Update(updatedItem);

    this.frame().SetMsgPanel(item);
  }

  private updatePoints(): void {
    if (!this.m_editPoints) return;

    const item = this.m_editPoints.GetParent();

    if (!item) return;

    if (!this.m_editorBehavior) return;

    const view = this.getView()!;
    let editedIndex = -1;
    let editingLine = false;

    if (this.m_editedPoint) {
      // Check if we're editing a point (vertex)
      for (let ii = 0; ii < this.m_editPoints.PointsSize(); ++ii) {
        if (this.m_editPoints.Point(ii) === this.m_editedPoint) {
          editedIndex = ii;
          break;
        }
      }

      // If not found in points, check if we're editing a line (midpoint)
      if (editedIndex === -1) {
        for (let ii = 0; ii < this.m_editPoints.LinesSize(); ++ii) {
          if (this.m_editPoints.Line(ii) === this.m_editedPoint) {
            editedIndex = ii;
            editingLine = true;
            break;
          }
        }
      }
    }

    if (!this.m_editorBehavior.UpdatePoints(this.m_editPoints)) {
      if (view.HasItem(this.m_editPoints)) view.Remove(this.m_editPoints);

      this.m_editPoints = this.makePoints(item);

      if (this.m_editPoints) view.Add(this.m_editPoints);
    }

    const points = this.m_editPoints;

    if (editedIndex >= 0 && points) {
      if (editingLine && editedIndex < points.LinesSize())
        this.m_editedPoint = points.Line(editedIndex);
      else if (!editingLine && editedIndex < points.PointsSize())
        this.m_editedPoint = points.Point(editedIndex);
      else this.m_editedPoint = null;
    } else {
      this.m_editedPoint = null;
    }

    if (points) view.Update(points);

    if (this.m_angleItem) view.Update(this.m_angleItem);
  }

  /** The index of the edited point, or -1 (`getEditedPointIndex`). */
  private getEditedPointIndex(): number {
    if (!this.m_editPoints || !this.m_editedPoint) return -1;

    for (let ii = 0; ii < this.m_editPoints.PointsSize(); ++ii) {
      if (this.m_editPoints.Point(ii) === this.m_editedPoint) return ii;
    }

    return -1;
  }

  private setEditedPoint(aPoint: EDIT_POINT | null): void {
    const controls = this.controls();

    if (aPoint) {
      this.frame().GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
      controls.ForceCursorPosition(true, aPoint.GetPosition());
      controls.ShowCursor(true);
    } else {
      if (this.frame().ToolStackIsEmpty()) controls.ShowCursor(false);

      controls.ForceCursorPosition(false);
    }

    this.m_editedPoint = aPoint;
  }

  private setAltConstraint(aEnabled: boolean): void {
    const parent = this.m_editPoints ? this.m_editPoints.GetParent() : null;
    const line = this.m_editedPoint instanceof EDIT_LINE ? this.m_editedPoint : null;
    const isPoly = isPolygonItem(parent);

    if (aEnabled) {
      if (line && isPoly) {
        // For polygon lines, toggle the mode on the existing constraint rather than creating a
        // new one. This preserves the original reference positions.
        const constraint = line.GetConstraint();

        if (constraint instanceof EC_CONVERGING) constraint.SetMode(POLYGON_LINE_MODE.FIXED_LENGTH);

        // Don't set m_altConstraint - we're modifying the line's own constraint
      } else {
        // Find a proper constraining point for angle snapping mode
        this.m_altConstrainer = this.get45DegConstrainer();

        if (this.Is90Limited())
          this.m_altConstraint = new EC_90DEGREE(this.m_editedPoint!, this.m_altConstrainer);
        else this.m_altConstraint = new EC_45DEGREE(this.m_editedPoint!, this.m_altConstrainer);
      }
    } else {
      if (line && isPoly) {
        // Restore the line's constraint to CONVERGING mode
        const constraint = line.GetConstraint();

        if (constraint instanceof EC_CONVERGING) constraint.SetMode(POLYGON_LINE_MODE.CONVERGING);
      }

      this.m_altConstraint = null;
    }
  }

  private get45DegConstrainer(): EDIT_POINT {
    // If there's a behaviour and it provides a constrainer, use that
    if (this.m_editorBehavior) {
      const constrainer = this.m_editorBehavior.Get45DegreeConstrainer(
        this.m_editedPoint!,
        this.m_editPoints!,
      );

      if (constrainer) return new EDIT_POINT(constrainer);
    }

    // In any other case we may align item to its original position
    return this.m_original;
  }

  addCorner(_aEvent: TOOL_EVENT): number {
    if (!this.m_editPoints) return 0;

    const item = this.m_editPoints.GetParent();
    const frame = this.getEditFrame<PCB_BASE_EDIT_FRAME>();
    const cursorPos = this.controls().GetCursorPosition();

    // called without an active edited polygon
    if (!item || !PCB_POINT_EDITOR.CanAddCorner(item)) return 0;

    const graphicItem = item instanceof PCB_SHAPE ? item : null;
    const commit = new BOARD_COMMIT(frame);

    if (isPolygonItem(item)) {
      let nearestIdx = 0;
      let nextNearestIdx = 0;
      let nearestDist = INT_MAX;
      let firstPointInContour = 0;
      let zoneOutline: SHAPE_POLY_SET;

      if (item.Type() === KICAD_T.PCB_ZONE_T) {
        const zone = item as ZONE;
        zoneOutline = zone.Outline();
        zone.SetNeedRefill(true);
      } else {
        zoneOutline = graphicItem!.GetPolyShape();
      }

      commit.Modify(item);

      // Search the best outline segment to add a new corner, and therefore break this
      // segment into two segments. Iterate through all the corners of the outlines (main
      // contour and its holes).
      let currIdx = 0;

      for (
        const iterator = zoneOutline.Iterate(0, zoneOutline.OutlineCount() - 1, true);
        iterator.valid();
        iterator.Advance(), currIdx++
      ) {
        let jj = currIdx + 1;

        if (iterator.IsEndContour()) {
          // We reach the last point of the current contour (main or hole)
          jj = firstPointInContour;
          firstPointInContour = currIdx + 1; // Prepare next contour analysis
        }

        const currSegment = new SEG(zoneOutline.CVertex(currIdx), zoneOutline.CVertex(jj));
        // `unsigned int distance = curr_segment.Distance( cursorPos )`.
        const distance = Math.trunc(currSegment.Distance(cursorPos));

        if (distance < nearestDist) {
          nearestDist = distance;
          nearestIdx = currIdx;
          nextNearestIdx = jj;
        }
      }

      // Find the point on the closest segment
      const sideOrigin = zoneOutline.CVertex(nearestIdx);
      const sideEnd = zoneOutline.CVertex(nextNearestIdx);
      const nearestSide = new SEG(sideOrigin, sideEnd);
      let nearestPoint = nearestSide.NearestPoint(cursorPos);

      // Do not add points that have the same coordinates as ones that already belong to
      // polygon; instead, add a point in the middle of the side
      if (
        (nearestPoint.x === sideOrigin.x && nearestPoint.y === sideOrigin.y) ||
        (nearestPoint.x === sideEnd.x && nearestPoint.y === sideEnd.y)
      )
        nearestPoint = divideI(add(sideOrigin, sideEnd), 2);

      zoneOutline.InsertVertex(nextNearestIdx, nearestPoint);

      if (item.Type() === KICAD_T.PCB_ZONE_T) (item as ZONE).HatchBorder();

      commit.Push('Add Zone Corner');
    } else if (graphicItem) {
      switch (graphicItem.GetShape()) {
        case SHAPE_T.SEGMENT: {
          commit.Modify(graphicItem);

          const seg = new SEG(graphicItem.GetStart(), graphicItem.GetEnd());
          const nearestPoint = seg.NearestPoint(cursorPos);

          // Move the end of the line to the break point..
          graphicItem.SetEnd(nearestPoint);

          // and add another one starting from the break point
          const newSegment = graphicItem.Duplicate(true, commit) as PCB_SHAPE;
          newSegment.ClearSelected();
          newSegment.SetStart(nearestPoint);
          newSegment.SetEnd({ x: seg.B.x, y: seg.B.y });

          commit.Add(newSegment);
          commit.Push('Split Segment');
          break;
        }

        case SHAPE_T.ARC: {
          commit.Modify(graphicItem);

          const arc = new SHAPE_ARC(
            graphicItem.GetStart(),
            graphicItem.GetArcMid(),
            graphicItem.GetEnd(),
            0,
          );
          const nearestPoint = arc.NearestPoint(cursorPos);

          // Move the end of the arc to the break point..
          graphicItem.SetEnd(nearestPoint);

          // and add another one starting from the break point
          const newArc = graphicItem.Duplicate(true, commit) as PCB_SHAPE;

          newArc.ClearSelected();
          newArc.SetEnd(arc.GetP1());
          newArc.SetStart(nearestPoint);

          commit.Add(newArc);
          commit.Push('Split Arc');
          break;
        }

        default:
          // No split implemented for other shapes
          break;
      }
    }

    this.updatePoints();
    return 0;
  }

  removeCorner(_aEvent: TOOL_EVENT): number {
    if (!this.m_editPoints || !this.m_editedPoint) return 0;

    const item = this.m_editPoints.GetParent();

    if (!item) return 0;

    const polygon = polygonOf(item);

    if (item.Type() === KICAD_T.PCB_ZONE_T) (item as ZONE).SetNeedRefill(true);

    if (!polygon) return 0;

    const frame = this.getEditFrame<PCB_BASE_FRAME>();
    const commit = new BOARD_COMMIT(frame);
    const vertexIdx = findVertex(polygon, this.m_editedPoint);

    if (vertexIdx) {
      const outline = polygon.Polygon(vertexIdx.m_polygon)[vertexIdx.m_contour]!;

      if (outline.PointCount() > 3) {
        // the usual case: remove just the corner when there are >3 vertices
        commit.Modify(item);
        polygon.RemoveVertex(vertexIdx);
      } else {
        // either remove a hole or the polygon when there are <= 3 corners
        if (vertexIdx.m_contour > 0) {
          // remove hole
          commit.Modify(item);
          polygon.RemoveContour(vertexIdx.m_contour);
        } else {
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
          commit.Remove(item);
        }
      }

      this.setEditedPoint(null);

      if (item.Type() === KICAD_T.PCB_ZONE_T) commit.Push('Remove Zone Corner');
      else commit.Push('Remove Polygon Corner');

      if (item.Type() === KICAD_T.PCB_ZONE_T) (item as ZONE).HatchBorder();

      this.updatePoints();
    }

    return 0;
  }

  chamferCorner(_aEvent: TOOL_EVENT): number {
    if (!this.m_editPoints || !this.m_editedPoint) return 0;

    const item = this.m_editPoints.GetParent();

    if (!item) return 0;

    const polygon = polygonOf(item);

    if (item.Type() === KICAD_T.PCB_ZONE_T) (item as ZONE).SetNeedRefill(true);

    if (!polygon) return 0;

    // Search the best outline corner to break
    const frame = this.getEditFrame<PCB_BASE_FRAME>();
    const commit = new BOARD_COMMIT(frame);
    const cursorPos = this.controls().GetCursorPosition();

    let nearestIdx = 0;
    let nearestDist = INT_MAX;
    let currIdx = 0;

    // Iterate through all the corners of the outlines (main contour and its holes)
    for (
      const iterator = polygon.Iterate(0, polygon.OutlineCount() - 1, true);
      iterator.valid();
      iterator.Advance(), currIdx++
    ) {
      // `unsigned int distance = CVertex( curr_idx ).Distance( cursorPos )`.
      const v = polygon.CVertex(currIdx);
      const distance = Math.trunc(Math.hypot(v.x - cursorPos.x, v.y - cursorPos.y));

      if (distance < nearestDist) {
        nearestDist = distance;
        nearestIdx = currIdx;
      }
    }

    const prev = { value: 0 };
    const next = { value: 0 };

    if (polygon.GetNeighbourIndexes(nearestIdx, prev, next)) {
      const prevIdx = prev.value;
      const nextIdx = next.value;
      const segA = { a: polygon.CVertex(prevIdx), b: polygon.CVertex(nearestIdx) };
      const segB = { a: polygon.CVertex(nextIdx), b: polygon.CVertex(nearestIdx) };

      // A plausible setback that won't consume a whole edge
      let setback = pcbIUScale.mmToIU(5);
      setback = Math.min(setback, Math.trunc(new SEG(segA.a, segA.b).Length() * 0.25));
      setback = Math.min(setback, Math.trunc(new SEG(segB.a, segB.b).Length() * 0.25));

      const chamferResult = chamferLinePair(segA, segB, setback, setback);

      if (chamferResult?.updatedA && chamferResult.updatedB) {
        commit.Modify(item);
        polygon.RemoveVertex(nearestIdx);

        // The two end points of the chamfer are the new corners
        polygon.InsertVertex(nearestIdx, chamferResult.updatedB.b);
        polygon.InsertVertex(nearestIdx, chamferResult.updatedA.b);
      }
    }

    this.setEditedPoint(null);

    if (item.Type() === KICAD_T.PCB_ZONE_T) commit.Push('Break Zone Corner');
    else commit.Push('Break Polygon Corner');

    if (item.Type() === KICAD_T.PCB_ZONE_T) (item as ZONE).HatchBorder();

    this.updatePoints();

    return 0;
  }

  modifiedSelection(_aEvent: TOOL_EVENT): number {
    this.updatePoints();
    return 0;
  }

  changeArcEditMode(aEvent: TOOL_EVENT): number {
    const editFrame = this.getEditFrame<PCB_BASE_EDIT_FRAME>();

    if (aEvent.Matches(ACTIONS.cycleArcEditMode.MakeEvent())) {
      this.m_arcEditMode.value = IncrementArcEditMode(this.arcEditModeSetting(editFrame));
    } else {
      this.m_arcEditMode.value = aEvent.Parameter<ARC_EDIT_MODE>();
    }

    if (editFrame.IsType(FRAME_T.FRAME_PCB_EDITOR))
      editFrame.GetPcbNewSettings().m_ArcEditMode = this.m_arcEditMode.value;
    else editFrame.GetFootprintEditorSettings().m_ArcEditMode = this.m_arcEditMode.value;

    return 0;
  }

  protected override setTransitions(): void {
    const onSel = this.OnSelectionChange as TOOL_STATE_FUNC;

    this.Go(onSel, ACTIONS.activatePointEditor.MakeEvent());
    this.Go(this.movePoint as TOOL_STATE_FUNC, PCB_ACTIONS.pointEditorMoveCorner.MakeEvent());
    this.Go(this.movePoint as TOOL_STATE_FUNC, PCB_ACTIONS.pointEditorMoveMidpoint.MakeEvent());
    this.Go(
      SYNC_HANDLER<PCB_POINT_EDITOR>(this.addCorner),
      PCB_ACTIONS.pointEditorAddCorner.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_POINT_EDITOR>(this.removeCorner),
      PCB_ACTIONS.pointEditorRemoveCorner.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_POINT_EDITOR>(this.chamferCorner),
      PCB_ACTIONS.pointEditorChamferCorner.MakeEvent(),
    );
    const arcMode = SYNC_HANDLER<PCB_POINT_EDITOR>(this.changeArcEditMode);
    this.Go(arcMode, ACTIONS.pointEditorArcKeepCenter.MakeEvent());
    this.Go(arcMode, ACTIONS.pointEditorArcKeepEndpoint.MakeEvent());
    this.Go(arcMode, ACTIONS.pointEditorArcKeepRadius.MakeEvent());
    this.Go(arcMode, ACTIONS.cycleArcEditMode.MakeEvent());
    const modified = SYNC_HANDLER<PCB_POINT_EDITOR>(this.modifiedSelection);
    this.Go(modified, EVENTS.SelectedItemsModified);
    this.Go(modified, EVENTS.SelectedItemsMoved);
    this.Go(onSel, EVENTS.PointSelectedEvent);
    this.Go(onSel, EVENTS.SelectedEvent);
    this.Go(onSel, EVENTS.UnselectedEvent);
    this.Go(onSel, EVENTS.InhibitSelectionEditing);
    this.Go(onSel, EVENTS.UninhibitSelectionEditing);
  }
}
