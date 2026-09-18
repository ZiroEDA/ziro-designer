// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_track.h` / `pcb_track.cpp`: a single base class (PCB_TRACK)
 * represents both tracks and vias, with subclasses for curved tracks
 * (PCB_ARC) and vias (PCB_VIA).  All told there are three KICAD_Ts:
 * PCB_TRACK_T, PCB_ARC_T, and PCB_VIA_T.
 *
 * For vias there is a further VIATYPE which indicates THROUGH, BLIND, BURIED, or MICROVIA,
 * which are supported by the synthetic KICAD_Ts PCB_LOCATE_STDVIA_T, PCB_LOCATE_BLINDVIA_T,
 * PCB_LOCATE_BURIEDVIA_T and PCB_LOCATE_UVIA_T.
 *
 * Not here: `Serialize`/`Deserialize` (the protobuf API) and the
 * `TRACK_VIA_DESC` property registration. The DRC engine, the connectivity
 * data, the board stackup's `GetLayerDistance`, `LENGTH_DELAY_CALCULATION`
 * and `BOARD::GetTrackLength` are not on BOARD yet (#636); each such branch
 * is left in place as a comment with the answer the C++ gives without them.
 */

import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/src/eda_draw_frame.js';
import type { EDA_DRAW_FRAME_LIKE, INSPECTOR } from '@ziroeda/common/src/eda_item.js';
import { INSPECT_RESULT } from '@ziroeda/common/src/eda_item.js';
import {
  type EDA_ITEM_FLAGS,
  ENDPOINT,
  ROUTER_TRANSIENT,
  STARTPOINT,
} from '@ziroeda/common/src/eda_item_flags.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { OutStr } from '@ziroeda/common/src/font/font.js';
import {
  FLASHING,
  GAL_LAYER_ID,
  GetNetnameLayer,
  IsBackLayer,
  IsCopperLayer,
  IsCopperLayerLowerThan,
  IsFrontLayer,
  IsExternalCopperLayer,
  IsHoleLayer,
  IsNetnameLayer,
  IsSolderMaskLayer,
  MAX_CU_LAYERS,
  NETNAMES_LAYER_ID,
  PCB_LAYER_ID,
  PCBNEW_LAYER_ID_START,
  ToLAYER_ID,
} from '@ziroeda/common/src/layer_ids.js';
import { LAYER_RANGE } from '@ziroeda/common/src/layer_range.js';
import { COORD_TYPES_T } from '@ziroeda/common/src/origin_transforms.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_INT,
  TYPE_OPT_INT,
  type VALIDATOR_RESULT,
} from '@ziroeda/common/src/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/src/properties/property_mgr.js';
import { VALIDATION_ERROR_MSG } from '@ziroeda/common/src/properties/property_validators.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import type { MINOPTMAX } from '@ziroeda/core/src/minoptmax.js';
import { FLIP_DIRECTION, MIRROR } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import type { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, ANGLE_360, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ClipLine, KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  type SHAPE_POLY_SET,
  TransformArcToPolygon,
  TransformCircleToPolygon,
  TransformOvalToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { BOX2I, BOX2ISafe } from '@ziroeda/kimath/src/math/box2.js';
import {
  Distance,
  EuclideanNormI,
  type VECTOR2I,
  add,
  equal,
  sub,
} from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcCenterI, RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { BOARD_ITEM, ZONE_LAYER_OVERRIDE } from './board_item.js';
import {
  BACKDRILL_MODE,
  PAD_DRILL_POST_MACHINING_MODE,
  type PAD_DRILL_SHAPE,
  PAD_SHAPE,
  PADSTACK,
  type PADSTACK_DRILL_PROPS,
  UNCONNECTED_LAYER_MODE,
} from './padstack.js';
import { DRC_CONSTRAINT, DRC_CONSTRAINT_T } from './drc/drc_rule.js';
import type { PCB_VIEW_FOR_LOD } from './pcb_shape.js';
import {
  CAPPING_MODE,
  COVERING_MODE,
  ENDPOINT_T,
  FILLING_MODE,
  PLUGGING_MODE,
  TENTING_MODE,
  UNDEFINED_DRILL_DIAMETER,
  VIATYPE,
} from './pcb_track_types.js';

export * from './pcb_track_types.js';

// Used for tracks and vias for algorithmic safety, not to enforce constraints
export const GEOMETRY_MIN_SIZE = Math.trunc(0.001 * pcbIUScale.IU_PER_MM);

/** `INT_MAX`, which the arc radius is clamped to half of. */
const INT_MAX = 2147483647;

/** The message-panel frame's units, as `PCB_SHAPE` reads them. */
type MSG_PANEL_FRAME = EDA_DRAW_FRAME_LIKE & UNITS_PROVIDER;

export class PCB_TRACK extends BOARD_CONNECTED_ITEM {
  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && KICAD_T.PCB_TRACE_T === aItem.Type();
  }

  protected m_Start: VECTOR2I; ///< Line start point
  protected m_End: VECTOR2I; ///< Line end point

  protected m_hasSolderMask: boolean;
  protected m_solderMaskMargin: number | undefined;

  private m_width: number; ///< Thickness of track (or arc) -- no longer the width of a via

  constructor(aParent: BOARD_ITEM | null, idtype: KICAD_T = KICAD_T.PCB_TRACE_T) {
    super(aParent, idtype);

    this.m_Start = { x: 0, y: 0 };
    this.m_End = { x: 0, y: 0 };
    this.m_width = pcbIUScale.mmToIU(0.2); // Gives a reasonable default width
    this.m_hasSolderMask = false;
    this.m_solderMaskMargin = undefined;
  }

  // Do not create a copy constructor.  The one generated by the compiler is adequate.

  /** `PCB_TRACK( const PCB_TRACK& )`: the compiler-generated copy, as a static. */
  static copyOf(aOther: PCB_TRACK): PCB_TRACK {
    const copy = new PCB_TRACK(null, aOther.Type());
    copy.assignTrack(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** `operator=`: the compiler-generated one over every base and member. */
  assignTrack(aOther: PCB_TRACK): this {
    this.assignConnected(aOther);
    this.m_Start = { ...aOther.m_Start };
    this.m_End = { ...aOther.m_End };
    this.m_hasSolderMask = aOther.m_hasSolderMask;
    this.m_solderMaskMargin = aOther.m_solderMaskMargin;
    this.m_width = aOther.m_width;
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_TRACE_T)) return; // wxCHECK

    this.assignTrack(aOther as PCB_TRACK);
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_Start = add(this.m_Start, aMoveVector);
    this.m_End = add(this.m_End, aMoveVector);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_Start = RotatePoint(this.m_Start, aRotCentre, aAngle);
    this.m_End = RotatePoint(this.m_End, aRotCentre, aAngle);
  }

  override Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_Start, aCentre, aFlipDirection);
    MIRROR(this.m_End, aCentre, aFlipDirection);
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      this.m_Start.x = aCentre.x - (this.m_Start.x - aCentre.x);
      this.m_End.x = aCentre.x - (this.m_End.x - aCentre.x);
    } else {
      this.m_Start.y = aCentre.y - (this.m_Start.y - aCentre.y);
      this.m_End.y = aCentre.y - (this.m_End.y - aCentre.y);
    }

    this.SetLayer(this.GetBoard()!.FlipLayer(this.GetLayer()));
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_Start = { ...aPos };
  }
  override GetPosition(): VECTOR2I {
    return this.m_Start;
  }
  override GetFocusPosition(): VECTOR2I {
    return {
      x: Math.trunc((this.m_Start.x + this.m_End.x) / 2),
      y: Math.trunc((this.m_Start.y + this.m_End.y) / 2),
    };
  }

  SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }
  GetWidth(): number {
    return this.m_width;
  }

  SetEnd(aEnd: VECTOR2I): void {
    this.m_End = { ...aEnd };
  }
  GetEnd(): VECTOR2I {
    return this.m_End;
  }

  SetStart(aStart: VECTOR2I): void {
    this.m_Start = { ...aStart };
  }
  GetStart(): VECTOR2I {
    return this.m_Start;
  }

  SetStartX(aX: number): void {
    this.m_Start.x = aX;
  }
  SetStartY(aY: number): void {
    this.m_Start.y = aY;
  }

  GetStartX(): number {
    return this.m_Start.x;
  }
  GetStartY(): number {
    return this.m_Start.y;
  }

  SetEndX(aX: number): void {
    this.m_End.x = aX;
  }
  SetEndY(aY: number): void {
    this.m_End.y = aY;
  }

  GetEndX(): number {
    return this.m_End.x;
  }
  GetEndY(): number {
    return this.m_End.y;
  }

  /// Return the selected endpoint (start or end)
  GetEndPoint(aEndPoint: ENDPOINT_T): VECTOR2I {
    if (aEndPoint === ENDPOINT_T.ENDPOINT_START) return this.m_Start;
    else return this.m_End;
  }

  SetHasSolderMask(aVal: boolean): void {
    this.m_hasSolderMask = aVal;
  }
  HasSolderMask(): boolean {
    return this.m_hasSolderMask;
  }

  SetLocalSolderMaskMargin(aMargin: number | undefined): void {
    this.m_solderMaskMargin = aMargin;
  }
  GetLocalSolderMaskMargin(): number | undefined {
    return this.m_solderMaskMargin;
  }

  GetSolderMaskExpansion(): number {
    let margin = 0;

    if (
      this.GetBoard() &&
      this.GetBoard()!.GetDesignSettings().m_DRCEngine &&
      this.GetBoard()!
        .GetDesignSettings()
        .m_DRCEngine!.HasRulesForConstraintType(DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT)
    ) {
      const drcEngine = this.GetBoard()!.GetDesignSettings().m_DRCEngine!;

      const constraint = drcEngine.EvalRules(
        DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT,
        this,
        null,
        this.m_layer,
      );

      if (constraint.m_Value.HasOpt()) margin = constraint.m_Value.Opt();
    } else if (this.m_solderMaskMargin !== undefined) {
      margin = this.m_solderMaskMargin;
    } else {
      const board = this.GetBoard();

      if (board) margin = board.GetDesignSettings().m_SolderMaskExpansion;
    }

    // Ensure the resulting mask opening has a non-negative size
    if (margin < 0) margin = Math.max(margin, -Math.trunc(this.m_width / 2));

    return margin;
  }

  // Virtual function
  override IsOnLayer(aLayer: PCB_LAYER_ID): boolean {
    if (aLayer === this.m_layer) {
      return true;
    }

    if (
      this.m_hasSolderMask &&
      ((aLayer === PCB_LAYER_ID.F_Mask && this.m_layer === PCB_LAYER_ID.F_Cu) ||
        (aLayer === PCB_LAYER_ID.B_Mask && this.m_layer === PCB_LAYER_ID.B_Cu))
    ) {
      return true;
    }

    return false;
  }

  override GetLayerSet(): LSET {
    const layermask = new LSET([this.m_layer]);

    if (this.m_hasSolderMask) {
      if (layermask.test(PCB_LAYER_ID.F_Cu)) layermask.set(PCB_LAYER_ID.F_Mask);
      else if (layermask.test(PCB_LAYER_ID.B_Cu)) layermask.set(PCB_LAYER_ID.B_Mask);
    }

    return layermask;
  }

  override SetLayerSet(aLayerSet: LSET): void {
    aLayerSet.RunOnLayers((layer: PCB_LAYER_ID) => {
      if (IsCopperLayer(layer)) this.SetLayer(layer);
      else if (IsSolderMaskLayer(layer)) this.SetHasSolderMask(true);
    });
  }

  override GetBoundingBox(): BOX2I {
    // end of track is round, this is its radius, rounded up
    const radius = Math.trunc((this.m_width + 1) / 2);

    let ymax: number;
    let xmax: number;
    let ymin: number;
    let xmin: number;

    if (this.Type() === KICAD_T.PCB_VIA_T) {
      ymax = this.m_Start.y;
      xmax = this.m_Start.x;

      ymin = this.m_Start.y;
      xmin = this.m_Start.x;
    } else if (this.Type() === KICAD_T.PCB_ARC_T) {
      const arc = this.GetEffectiveShape();
      const bbox = arc.BBox();

      xmin = bbox.GetLeft();
      xmax = bbox.GetRight();
      ymin = bbox.GetTop();
      ymax = bbox.GetBottom();
    } else {
      ymax = Math.max(this.m_Start.y, this.m_End.y);
      xmax = Math.max(this.m_Start.x, this.m_End.x);

      ymin = Math.min(this.m_Start.y, this.m_End.y);
      xmin = Math.min(this.m_Start.x, this.m_End.x);
    }

    ymax += radius;
    xmax += radius;

    ymin -= radius;
    xmin -= radius;

    // return a rectangle which is [pos,dim) in nature.  therefore the +1
    return BOX2ISafe({ x: xmin, y: ymin }, { x: xmax - xmin + 1, y: ymax - ymin + 1 });
  }

  /**
   * Get the length of the track using the hypotenuse calculation.
   *
   * @return the length of the track
   */
  GetLength(): number {
    return Distance(this.m_Start, this.m_End);
  }

  /**
   * Get the time delay of the track
   *
   * @return the delay of the track
   */
  GetDelay(): number {
    const board = this.GetBoard();

    if (!board) return 0.0;

    // const LENGTH_DELAY_CALCULATION* calc = board->GetLengthCalculation();
    // items{ calc->GetLengthCalculationItem( this ) };
    // return (double) calc->CalculateDelay( items, opts );   -- LENGTH_DELAY_CALCULATION pending (#636)
    return 0.0;
  }

  /**
   * Convert the track shape to a closed polygon.
   *
   * Circles (vias) and arcs (ends of tracks) are approximated by segments.
   *
   * @param aBuffer is a buffer to store the polygon
   * @param aClearance is the clearance around the pad
   * @param aError is the maximum deviation from true circle
   * @param ignoreLineWidth is used for edge cut items where the line width is only for
   *                        visualization
   */
  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    ignoreLineWidth = false,
  ): void {
    console.assert(!ignoreLineWidth, 'IgnoreLineWidth has no meaning for tracks.');

    switch (this.Type()) {
      case KICAD_T.PCB_VIA_T: {
        const radius = Math.trunc((this as unknown as PCB_VIA).GetWidth(aLayer) / 2) + aClearance;
        TransformCircleToPolygon(aBuffer, this.m_Start, radius, aError, aErrorLoc);
        break;
      }

      case KICAD_T.PCB_ARC_T: {
        const arc = this as unknown as PCB_ARC;
        let width = this.m_width + 2 * aClearance;

        if (IsSolderMaskLayer(aLayer)) width += 2 * this.GetSolderMaskExpansion();

        TransformArcToPolygon(
          aBuffer,
          arc.GetStart(),
          arc.GetMid(),
          arc.GetEnd(),
          width,
          aError,
          aErrorLoc,
        );
        break;
      }

      default: {
        let width = this.m_width + 2 * aClearance;

        if (IsSolderMaskLayer(aLayer)) width += 2 * this.GetSolderMaskExpansion();

        TransformOvalToPolygon(aBuffer, this.m_Start, this.m_End, width, aError, aErrorLoc);
        break;
      }
    }
  }

  // @copydoc BOARD_ITEM::GetEffectiveShape
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    let width = this.m_width;

    if (IsSolderMaskLayer(aLayer)) width += 2 * this.GetSolderMaskExpansion();

    return new SHAPE_SEGMENT(this.m_Start, this.m_End, width);
  }

  /**
   * Return STARTPOINT if point if near (dist = min_dist) start point, ENDPOINT if
   * point if near (dist = min_dist) end point,STARTPOINT|ENDPOINT if point if near
   * (dist = min_dist) both ends, or 0 if none of the above.
   *
   * If min_dist < 0: min_dist = track_width/2
   */
  IsPointOnEnds(point: VECTOR2I, min_dist = 0): EDA_ITEM_FLAGS {
    let result: EDA_ITEM_FLAGS = 0;

    if (min_dist < 0) min_dist = Math.trunc(this.m_width / 2);

    if (min_dist === 0) {
      if (equal(this.m_Start, point)) result |= STARTPOINT;

      if (equal(this.m_End, point)) result |= ENDPOINT;
    } else {
      let dist = Distance(this.m_Start, point);

      if (min_dist >= dist) result |= STARTPOINT;

      dist = Distance(this.m_End, point);

      if (min_dist >= dist) result |= ENDPOINT;
    }

    return result;
  }

  /**
   * Return true if segment length is zero.
   */
  IsNull(): boolean {
    return this.Type() === KICAD_T.PCB_VIA_T || equal(this.m_Start, this.m_End);
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    const frame = aFrame as MSG_PANEL_FRAME;
    let msg: string;
    const board = this.GetBoard();

    aList.push(new MSG_PANEL_ITEM('Type', this.GetFriendlyName()));

    this.GetMsgPanelInfoBase_Common(aFrame, aList);

    aList.push(new MSG_PANEL_ITEM('Layer', this.LayerMaskDescribe()));

    aList.push(new MSG_PANEL_ITEM('Width', frame.MessageTextFromValue(this.m_width)));

    if (this.Type() === KICAD_T.PCB_ARC_T) {
      const radius = (this as unknown as PCB_ARC).GetRadius();
      aList.push(new MSG_PANEL_ITEM('Radius', frame.MessageTextFromValue(radius)));
      aList.push(
        new MSG_PANEL_ITEM(
          'Angle',
          `${(this as unknown as PCB_ARC).GetAngle().AsDegrees().toFixed(2)}deg`,
        ),
      );
    }

    const segmentLength = this.GetLength();
    const segmentDelay = this.GetDelay();

    if (segmentDelay === 0.0) {
      aList.push(new MSG_PANEL_ITEM('Segment Length', frame.MessageTextFromValue(segmentLength)));
    } else {
      // aFrame->MessageTextFromValue( segmentDelay, true, EDA_DATA_TYPE::TIME )
      //                                    -- EDA_DATA_TYPE::TIME arrives with LENGTH_DELAY_CALCULATION (#636)
      aList.push(new MSG_PANEL_ITEM('Segment Delay', frame.MessageTextFromValue(segmentDelay)));
    }

    // Display full track length (in Pcbnew)
    if (board && this.GetNetCode() > 0) {
      // std::tie( count, trackLen, lenPadToDie, trackDelay, delayPadToDie ) = board->GetTrackLength( *this );
      //                                                   -- BOARD::GetTrackLength pending (connectivity, #636)
    }

    // SHAPE_POLY_SET copper; TransformShapeToPolySet( copper, GetLayer(), 0, ARC_LOW_DEF, ERROR_INSIDE );
    // aList.emplace_back( _( "Copper Area" ), aFrame->MessageTextFromValue( copper.Area(), true, EDA_DATA_TYPE::AREA ) );
    //                                    -- EDA_DATA_TYPE::AREA arrives with the message-panel units port (#636)

    const source: OutStr = { value: '' };
    const clearance = this.GetOwnClearance(this.GetLayer(), source);

    aList.push(
      new MSG_PANEL_ITEM(
        `Min Clearance: ${frame.MessageTextFromValue(clearance)}`,
        `(from ${source.value})`,
      ),
    );

    const constraintValue = this.GetWidthConstraint(source);
    msg = frame.MessageTextFromMinOptMax(constraintValue);

    if (msg !== '') {
      aList.push(new MSG_PANEL_ITEM(`Width Constraints: ${msg}`, `(from ${source.value})`));
    }
  }

  override GetFriendlyName(): string {
    switch (this.Type()) {
      case KICAD_T.PCB_ARC_T:
        return 'Track (arc)';
      case KICAD_T.PCB_VIA_T:
        return 'Via';
      default:
        return 'Track';
    }
  }

  override Visit(
    inspector: INSPECTOR,
    testData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const scanType of aScanTypes) {
      if (scanType === this.Type()) {
        if (INSPECT_RESULT.QUIT === inspector(this, testData)) return INSPECT_RESULT.QUIT;
      }
    }

    return INSPECT_RESULT.CONTINUE;
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

    if ('x' in a && 'y' in a) return this.hitTestPoint(a, (b as number | undefined) ?? 0);

    return this.hitTestChain(a, b as boolean);
  }

  /** `HitTest( const VECTOR2I& aPosition, int aAccuracy )`. */
  protected hitTestPoint(aPosition: VECTOR2I, aAccuracy: number): boolean {
    return TestSegmentHit(
      aPosition,
      this.m_Start,
      this.m_End,
      aAccuracy + Math.trunc(this.m_width / 2),
    );
  }

  /** `HitTest( const BOX2I& aRect, bool aContained, int aAccuracy )`. */
  protected hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    const arect = new BOX2I(aRect.GetPosition(), aRect.GetSize());
    arect.Inflate(aAccuracy);

    if (aContained) return arect.Contains(this.GetStart()) && arect.Contains(this.GetEnd());
    else return arect.Intersects(this.GetStart(), this.GetEnd());
  }

  /** `HitTest( const SHAPE_LINE_CHAIN& aPoly, bool aContained )`. */
  protected hitTestChain(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean {
    return KIGEOM_ShapeHitTest(aPoly, this.GetEffectiveShape(), aContained);
  }

  ApproxCollinear(aTrack: PCB_TRACK): boolean {
    const a = new SEG(this.m_Start, this.m_End);
    const b = new SEG(aTrack.GetStart(), aTrack.GetEnd());

    return a.ApproxCollinear(b);
  }

  GetClass(): string {
    return 'PCB_TRACK';
  }

  GetWidthConstraint(aSource: OutStr | null = null): MINOPTMAX {
    let constraint = new DRC_CONSTRAINT();

    if (this.GetBoard() && this.GetBoard()!.GetDesignSettings().m_DRCEngine) {
      const bds = this.GetBoard()!.GetDesignSettings();

      constraint = bds.m_DRCEngine!.EvalRules(
        DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT,
        this,
        null,
        this.m_layer,
      );
    }

    if (aSource) aSource.value = constraint.GetName();

    return constraint.Value();
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `${this.Type() === KICAD_T.PCB_ARC_T ? 'Track (arc)' : 'Track'} ${this.GetNetnameMsg()} on ${this.GetLayerName()}, length ${aUnitsProvider!.MessageTextFromValue(this.GetLength())}`;
  }

  override GetMenuImage(): string {
    return 'add_tracks';
  }

  override Clone(): PCB_TRACK {
    return PCB_TRACK.copyOf(this);
  }

  override ViewGetLayers(): number[] {
    // Show the track and its netname on different layers
    const layer = this.GetLayer();
    const layers: number[] = [
      layer,
      GetNetnameLayer(layer),
      GAL_LAYER_ID.LAYER_CLEARANCE_START + layer,
    ];

    if (this.m_hasSolderMask) {
      if (this.m_layer === PCB_LAYER_ID.F_Cu) layers.push(PCB_LAYER_ID.F_Mask);
      else if (this.m_layer === PCB_LAYER_ID.B_Cu) layers.push(PCB_LAYER_ID.B_Mask);
    }

    if (this.IsLocked()) layers.push(GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW);

    return layers;
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    if (!aView) return PCB_TRACK.LOD_SHOW;

    const renderSettings = aView.GetPainter().GetSettings();

    if (!aView.IsLayerVisible(GAL_LAYER_ID.LAYER_TRACKS)) return PCB_TRACK.LOD_HIDE;

    if (IsNetnameLayer(aLayer)) {
      if (this.GetNetCode() <= 0 /* NETINFO_LIST::UNCONNECTED */) return PCB_TRACK.LOD_HIDE;

      // Hide netnames on dimmed tracks
      if (renderSettings.GetHighContrast()) {
        if (this.m_layer !== renderSettings.GetPrimaryHighContrastLayer())
          return PCB_TRACK.LOD_HIDE;
      }

      const start = { ...this.GetStart() };
      const end = { ...this.GetEnd() };

      // Calc the approximate size of the netname (assume square chars)
      const nameSize = this.GetDisplayNetname().length * this.GetWidth();

      const d0 = sub(end, start);

      if (d0.x * d0.x + d0.y * d0.y < nameSize * nameSize) return PCB_TRACK.LOD_HIDE;

      const clipBox = BOX2ISafe(aView.GetViewport());
      const ends = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
      ClipLine(clipBox, ends);
      start.x = ends.x1;
      start.y = ends.y1;
      end.x = ends.x2;
      end.y = ends.y2;

      const d1 = sub(end, start);

      if (d1.x * d1.x + d1.y * d1.y === 0) return PCB_TRACK.LOD_HIDE;

      // Netnames will be shown only if zoom is appropriate
      return PCB_TRACK.lodScaleForThreshold(aView, this.m_width, pcbIUScale.mmToIU(4.0));
    }

    if (aLayer === GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW) {
      // Hide shadow if the main layer is not shown
      if (!aView.IsLayerVisible(this.m_layer)) return PCB_TRACK.LOD_HIDE;

      // Hide shadow on dimmed tracks
      if (renderSettings.GetHighContrast()) {
        if (this.m_layer !== renderSettings.GetPrimaryHighContrastLayer())
          return PCB_TRACK.LOD_HIDE;
      }
    }

    // Other layers are shown without any conditions
    return PCB_TRACK.LOD_SHOW;
  }

  override ViewBBox(): BOX2I {
    const bbox = this.GetBoundingBox();
    const board = this.GetBoard();

    if (board) bbox.Inflate(2 * board.GetDesignSettings().GetBiggestClearanceValue());
    else bbox.Inflate(this.GetWidth()); // Add a bit extra for safety

    return bbox;
  }

  /**
   * @return true because a track or a via is always on a copper layer.
   */
  override IsOnCopperLayer(): boolean {
    return true;
  }

  Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_TRACK;

    let similarity = 1.0;

    if (this.m_layer !== other.m_layer) similarity *= 0.9;

    if (this.m_width !== other.m_width) similarity *= 0.9;

    if (!equal(this.m_Start, other.m_Start)) similarity *= 0.9;

    if (!equal(this.m_End, other.m_End)) similarity *= 0.9;

    if (this.m_hasSolderMask !== other.m_hasSolderMask) similarity *= 0.9;

    if (this.m_solderMaskMargin !== other.m_solderMaskMargin) similarity *= 0.9;

    return similarity;
  }

  /** `operator==( const BOARD_ITEM& )`. */
  equals(aBoardItem: BOARD_ITEM): boolean {
    if (aBoardItem.Type() !== this.Type()) return false;

    const other = aBoardItem as PCB_TRACK;

    return this.equalsTrack(other);
  }

  /** `operator==( const PCB_TRACK& )`. */
  equalsTrack(aOther: PCB_TRACK): boolean {
    return (
      equal(this.m_Start, aOther.m_Start) &&
      equal(this.m_End, aOther.m_End) &&
      this.m_layer === aOther.m_layer &&
      this.m_width === aOther.m_width &&
      this.m_hasSolderMask === aOther.m_hasSolderMask &&
      this.m_solderMaskMargin === aOther.m_solderMaskMargin
    );
  }

  /** `struct cmp_tracks`: a strict weak order over tracks by net, layer, type and uuid. */
  static cmp_tracks(a: PCB_TRACK, b: PCB_TRACK): boolean {
    if (a.GetNetCode() !== b.GetNetCode()) return a.GetNetCode() < b.GetNetCode();

    if (a.GetLayer() !== b.GetLayer()) return a.GetLayer() < b.GetLayer();

    if (a.Type() !== b.Type()) return a.Type() < b.Type();

    if (a.m_Uuid !== b.m_Uuid) return a.m_Uuid < b.m_Uuid;

    return false; // a < b on pointers: no address order for objects
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_TRACE_T);

    const image = aImage as PCB_TRACK;
    const mine = PCB_TRACK.copyOf(this);

    this.assignTrack(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;

    image.assignTrack(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
  }

  protected GetMsgPanelInfoBase_Common(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    aList.push(new MSG_PANEL_ITEM('Net', unescapeString(this.GetNetname())));

    aList.push(
      new MSG_PANEL_ITEM(
        'Resolved Netclass',
        unescapeString(this.GetEffectiveNetClass().GetHumanReadableName()),
      ),
    );

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME && this.IsLocked())
      aList.push(new MSG_PANEL_ITEM('Status', 'Locked'));
  }
}

export class PCB_ARC extends PCB_TRACK {
  private m_Mid: VECTOR2I; ///< Arc mid point, halfway between start and end

  constructor(aParent: BOARD_ITEM | null);
  constructor(aParent: BOARD_ITEM | null, aArc: SHAPE_ARC);
  constructor(aParent: BOARD_ITEM | null, aArc?: SHAPE_ARC) {
    super(aParent, KICAD_T.PCB_ARC_T);

    this.m_Mid = { x: 0, y: 0 };

    if (aArc) {
      this.m_Start = { ...aArc.GetP0() };
      this.m_End = { ...aArc.GetP1() };
      this.m_Mid = { ...aArc.GetArcMid() };
    }
  }

  /** `PCB_ARC( const PCB_ARC& )`: the compiler-generated copy, as a static. */
  static copyOfArc(aOther: PCB_ARC): PCB_ARC {
    const copy = new PCB_ARC(null);
    copy.assignArc(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** `operator=`: the compiler-generated one over every base and member. */
  assignArc(aOther: PCB_ARC): this {
    this.assignTrack(aOther);
    this.m_Mid = { ...aOther.m_Mid };
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_ARC_T)) return; // wxCHECK

    this.assignArc(aOther as PCB_ARC);
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && KICAD_T.PCB_ARC_T === aItem.Type();
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_Start = add(this.m_Start, aMoveVector);
    this.m_Mid = add(this.m_Mid, aMoveVector);
    this.m_End = add(this.m_End, aMoveVector);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_Start = RotatePoint(this.m_Start, aRotCentre, aAngle);
    this.m_End = RotatePoint(this.m_End, aRotCentre, aAngle);
    this.m_Mid = RotatePoint(this.m_Mid, aRotCentre, aAngle);
  }

  override Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_Start, aCentre, aFlipDirection);
    MIRROR(this.m_End, aCentre, aFlipDirection);
    MIRROR(this.m_Mid, aCentre, aFlipDirection);
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      this.m_Start.x = aCentre.x - (this.m_Start.x - aCentre.x);
      this.m_End.x = aCentre.x - (this.m_End.x - aCentre.x);
      this.m_Mid.x = aCentre.x - (this.m_Mid.x - aCentre.x);
    } else {
      this.m_Start.y = aCentre.y - (this.m_Start.y - aCentre.y);
      this.m_End.y = aCentre.y - (this.m_End.y - aCentre.y);
      this.m_Mid.y = aCentre.y - (this.m_Mid.y - aCentre.y);
    }

    this.SetLayer(this.GetBoard()!.FlipLayer(this.GetLayer()));
  }

  SetMid(aMid: VECTOR2I): void {
    this.m_Mid = { ...aMid };
  }
  GetMid(): VECTOR2I {
    return this.m_Mid;
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_Start = { ...aPos };
  }

  override GetPosition(): VECTOR2I {
    const center = CalcArcCenterI(this.m_Start, this.m_Mid, this.m_End);
    return center;
  }

  override GetFocusPosition(): VECTOR2I {
    return this.m_Mid;
  }

  override GetCenter(): VECTOR2I {
    return this.GetPosition();
  }

  GetRadius(): number {
    const center = CalcArcCenterI(this.m_Start, this.m_Mid, this.m_End);
    return Math.min(Distance(center, this.m_Start), INT_MAX / 2.0);
  }

  GetAngle(): EDA_ANGLE {
    const center = this.GetPosition();
    const angle1 = EDA_ANGLE.fromVector(sub(this.m_Mid, center)).sub(
      EDA_ANGLE.fromVector(sub(this.m_Start, center)),
    );
    const angle2 = EDA_ANGLE.fromVector(sub(this.m_End, center)).sub(
      EDA_ANGLE.fromVector(sub(this.m_Mid, center)),
    );

    return angle1.Normalize180().add(angle2.Normalize180());
  }

  GetArcAngleStart(): EDA_ANGLE {
    const pos = this.GetPosition();
    const angleStart = EDA_ANGLE.fromVector(sub(this.m_Start, pos));

    return angleStart.Normalize();
  }

  // Note: used in python tests.  Ignore CLion's claim that it's unused....
  GetArcAngleEnd(): EDA_ANGLE {
    const pos = this.GetPosition();
    const angleEnd = EDA_ANGLE.fromVector(sub(this.m_End, pos));

    return angleEnd.Normalize();
  }

  protected override hitTestPoint(aPosition: VECTOR2I, aAccuracy: number): boolean {
    const max_dist = aAccuracy + this.GetWidth() / 2.0;

    // Short-circuit common cases where the arc is connected to a track or via at an endpoint
    if (
      Distance(this.GetStart(), aPosition) <= max_dist ||
      Distance(this.GetEnd(), aPosition) <= max_dist
    ) {
      return true;
    }

    const center = this.GetPosition();
    const relpos = sub(aPosition, center);
    const dist = EuclideanNormI(relpos);
    const radius = this.GetRadius();

    if (Math.abs(dist - radius) > max_dist) return false;

    const arc_angle = this.GetAngle();
    const arc_angle_start = this.GetArcAngleStart(); // Always 0.0 ... 360 deg
    let arc_hittest = EDA_ANGLE.fromVector(relpos);

    // Calculate relative angle between the starting point of the arc, and the test point
    arc_hittest = arc_hittest.sub(arc_angle_start);

    // Normalise arc_hittest between 0 ... 360 deg
    arc_hittest.Normalize();

    if (arc_angle.lt(ANGLE_0)) return arc_hittest.ge(ANGLE_360.add(arc_angle));

    return arc_hittest.le(arc_angle);
  }

  protected override hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    const arect = new BOX2I(aRect.GetPosition(), aRect.GetSize());
    arect.Inflate(aAccuracy);

    const box = new BOX2I(this.GetStart());
    box.Merge(this.GetMid());
    box.Merge(this.GetEnd());

    box.Inflate(Math.trunc(this.GetWidth() / 2));

    if (aContained) return arect.Contains(box);
    else return arect.Intersects(box);
  }

  IsCCW(): boolean {
    const start = this.m_Start;
    const start_end = sub(this.m_End, start);
    const start_mid = sub(this.m_Mid, start);

    return start_end.x * start_mid.y - start_end.y * start_mid.x < 0;
  }

  override GetClass(): string {
    return 'PCB_ARC';
  }

  // @copydoc BOARD_ITEM::GetEffectiveShape
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    let width = this.GetWidth();

    if (IsSolderMaskLayer(aLayer)) width += 2 * this.GetSolderMaskExpansion();

    const arc = new SHAPE_ARC(this.GetStart(), this.GetMid(), this.GetEnd(), width);

    if (arc.IsEffectiveLine()) return new SHAPE_SEGMENT(this.GetStart(), this.GetEnd(), width);

    return new SHAPE_ARC(arc);
  }

  /**
   * Return the length of the arc track.
   *
   * @return double - the length of the track
   */
  override GetLength(): number {
    return this.GetRadius() * Math.abs(this.GetAngle().AsRadians());
  }

  override Clone(): PCB_ARC {
    return PCB_ARC.copyOfArc(this);
  }

  /**
   * @return true if the arc is too small to allow a safe calculation
   * of center position and arc angles i.e if distance between m_Mid and each arc end
   * is only a few internal units.
   * @param aThreshold is the minimal dist in internal units. Default id 5 IU
   */
  IsDegenerated(aThreshold = 5): boolean {
    // We have lots of code that will blow up if the radius overflows an int.
    if (this.GetRadius() >= INT_MAX / 2.0) return true;

    // Too small arcs cannot be really handled: arc center (and arc radius)
    // cannot be safely computed if the distance between mid and end points
    // is too small (a few internal units)

    // len of both segments must be < aThreshold to be a very small degenerated arc
    return (
      EuclideanNormI(sub(this.GetMid(), this.GetStart())) < aThreshold &&
      EuclideanNormI(sub(this.GetMid(), this.GetEnd())) < aThreshold
    );
  }

  override Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_ARC;

    let similarity = 1.0;

    if (this.m_layer !== other.m_layer) similarity *= 0.9;

    if (this.GetWidth() !== other.GetWidth()) similarity *= 0.9;

    if (!equal(this.m_Start, other.m_Start)) similarity *= 0.9;

    if (!equal(this.m_End, other.m_End)) similarity *= 0.9;

    if (!equal(this.m_Mid, other.m_Mid)) similarity *= 0.9;

    if (this.m_hasSolderMask !== other.m_hasSolderMask) similarity *= 0.9;

    if (this.m_solderMaskMargin !== other.m_solderMaskMargin) similarity *= 0.9;

    return similarity;
  }

  /** `operator==( const PCB_ARC& )`. */
  equalsArc(aOther: PCB_ARC): boolean {
    return (
      equal(this.m_Start, aOther.m_Start) &&
      equal(this.m_End, aOther.m_End) &&
      equal(this.m_Mid, aOther.m_Mid) &&
      this.m_layer === aOther.m_layer &&
      this.GetWidth() === aOther.GetWidth() &&
      this.m_hasSolderMask === aOther.m_hasSolderMask &&
      this.m_solderMaskMargin === aOther.m_solderMaskMargin
    );
  }

  /** `operator==( const BOARD_ITEM& )`. */
  override equals(aBoardItem: BOARD_ITEM): boolean {
    if (aBoardItem.Type() !== this.Type()) return false;

    const other = aBoardItem as PCB_ARC;

    return this.equalsArc(other);
  }

  /** `operator==( const PCB_TRACK& )`. */
  override equalsTrack(aOther: PCB_TRACK): boolean {
    if (aOther.Type() !== this.Type()) return false;

    const other = aOther as PCB_ARC;

    return this.equalsArc(other);
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_ARC_T);

    const image = aImage as PCB_ARC;
    const mine = PCB_ARC.copyOfArc(this);

    this.assignArc(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;

    image.assignArc(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
  }
}

/** `PCB_VIA::VIA_PARAMETER_ERROR::FIELD`. */
export enum VIA_PARAMETER_ERROR_FIELD {
  NONE = 0,
  DIAMETER = 1,
  DRILL = 2,
  START_LAYER = 3,
  END_LAYER = 4,
  SECONDARY_DRILL = 5,
  SECONDARY_START_LAYER = 6,
  SECONDARY_END_LAYER = 7,
  TERTIARY_DRILL = 8,
  TERTIARY_START_LAYER = 9,
  TERTIARY_END_LAYER = 10,
}

/** `PCB_VIA::VIA_PARAMETER_ERROR`. */
export class VIA_PARAMETER_ERROR {
  static readonly FIELD = VIA_PARAMETER_ERROR_FIELD;

  m_Message = '';
  m_Field: VIA_PARAMETER_ERROR_FIELD = VIA_PARAMETER_ERROR_FIELD.NONE;
}

/** `std::map<PCB_LAYER_ID, ZONE_LAYER_OVERRIDE>::operator==`: the same keys with the same values. */
function zoneLayerOverridesEqual(
  a: Map<PCB_LAYER_ID, ZONE_LAYER_OVERRIDE>,
  b: Map<PCB_LAYER_ID, ZONE_LAYER_OVERRIDE>,
): boolean {
  if (a.size !== b.size) return false;

  for (const [layer, override] of a) {
    if (!b.has(layer) || b.get(layer) !== override) return false;
  }

  return true;
}

export class PCB_VIA extends PCB_TRACK {
  private m_viaType: VIATYPE; ///< through, blind/buried or micro
  private m_padStack: PADSTACK;
  private m_isFree: boolean; ///< "Free" vias don't get their nets auto-updated

  private m_zoneLayerOverrides: Map<PCB_LAYER_ID, ZONE_LAYER_OVERRIDE>;

  constructor(aParent: BOARD_ITEM | null) {
    super(aParent, KICAD_T.PCB_VIA_T);
    this.m_padStack = new PADSTACK(this);
    this.m_zoneLayerOverrides = new Map();
    this.m_viaType = VIATYPE.NOT_DEFINED;
    this.m_isFree = false;

    this.SetViaType(VIATYPE.THROUGH);
    this.Padstack().Drill().start = PCB_LAYER_ID.F_Cu;
    this.Padstack().Drill().end = PCB_LAYER_ID.B_Cu;
    this.SetDrillDefault();

    this.m_padStack.SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.KEEP_ALL);

    // Padstack layerset is not used for vias right now
    this.m_padStack.LayerSet().reset();

    // For now, vias are always circles
    this.m_padStack.SetShape(PAD_SHAPE.CIRCLE, PADSTACK.ALL_LAYERS);

    for (const layer of new LAYER_RANGE(
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.B_Cu,
      this.BoardCopperLayerCount(),
    ))
      this.m_zoneLayerOverrides.set(layer, ZONE_LAYER_OVERRIDE.ZLO_NONE);

    this.m_isFree = false;
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && KICAD_T.PCB_VIA_T === aItem.Type();
  }

  /** `PCB_VIA( const PCB_VIA& aOther )`. */
  static copyOfVia(aOther: PCB_VIA): PCB_VIA {
    const copy = new PCB_VIA(aOther.GetParent() as BOARD_ITEM | null);

    copy.assignVia(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    copy.m_zoneLayerOverrides = new Map(aOther.m_zoneLayerOverrides);

    return copy;
  }

  /** `operator=( const PCB_VIA& aOther )`. */
  assignVia(aOther: PCB_VIA): this {
    this.assignConnected(aOther);

    this.m_Start = { ...aOther.m_Start };
    this.m_End = { ...aOther.m_End };

    this.m_viaType = aOther.m_viaType;
    this.m_padStack.assign(aOther.m_padStack);
    this.m_isFree = aOther.m_isFree;

    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_VIA_T)) return; // wxCHECK

    this.assignVia(aOther as PCB_VIA);
  }

  override IsType(aScanTypes: readonly KICAD_T[]): boolean {
    if (super.IsType(aScanTypes)) return true;

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.PCB_LOCATE_STDVIA_T && this.m_viaType === VIATYPE.THROUGH)
        return true;
      else if (scanType === KICAD_T.PCB_LOCATE_UVIA_T && this.m_viaType === VIATYPE.MICROVIA)
        return true;
      else if (scanType === KICAD_T.PCB_LOCATE_BLINDVIA_T && this.m_viaType === VIATYPE.BLIND)
        return true;
      else if (scanType === KICAD_T.PCB_LOCATE_BURIEDVIA_T && this.m_viaType === VIATYPE.BURIED)
        return true;
    }

    return false;
  }

  /**
   * @return true if top and bottom layers are valid, depending on the copper layer count
   */
  HasValidLayerPair(aCopperLayerCount: number): boolean {
    // return true if top and bottom layers are valid, depending on the copper layer count
    // aCopperLayerCount is expected >= 2

    const layer_id = aCopperLayerCount * 2;

    if (this.Padstack().Drill().start > PCB_LAYER_ID.B_Cu) {
      if (this.Padstack().Drill().start > layer_id) return false;
    }

    if (this.Padstack().Drill().end > PCB_LAYER_ID.B_Cu) {
      if (this.Padstack().Drill().end > layer_id) return false;
    }

    return true;
  }

  GetViaType(): VIATYPE {
    return this.m_viaType;
  }
  SetViaType(aViaType: VIATYPE): void {
    this.m_viaType = aViaType;

    // If someone updates a VIA to TH, we want to kick out any non-outer layers
    this.SanitizeLayers();
  }

  Padstack(): PADSTACK {
    return this.m_padStack;
  }
  SetPadstack(aPadstack: PADSTACK): void {
    this.m_padStack.assign(aPadstack);
  }

  GetBackdrillMode() {
    return this.m_padStack.GetBackdrillMode();
  }
  SetBackdrillMode(aMode: ReturnType<PADSTACK['GetBackdrillMode']>): void {
    this.m_padStack.SetBackdrillMode(aMode);
  }

  GetBottomBackdrillSize(): number | undefined {
    return this.m_padStack.GetBackdrillSize(false);
  }
  SetBottomBackdrillSize(aSize: number | undefined): void {
    this.m_padStack.SetBackdrillSize(false, aSize);
  }
  GetBottomBackdrillLayer(): PCB_LAYER_ID {
    return this.m_padStack.GetBackdrillEndLayer(false);
  }
  SetBottomBackdrillLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.SetBackdrillEndLayer(false, aLayer);
  }

  GetTopBackdrillSize(): number | undefined {
    return this.m_padStack.GetBackdrillSize(true);
  }
  SetTopBackdrillSize(aSize: number | undefined): void {
    this.m_padStack.SetBackdrillSize(true, aSize);
  }
  GetTopBackdrillLayer(): PCB_LAYER_ID {
    return this.m_padStack.GetBackdrillEndLayer(true);
  }
  SetTopBackdrillLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.SetBackdrillEndLayer(true, aLayer);
  }

  IsMicroVia(): boolean {
    return this.m_viaType === VIATYPE.MICROVIA;
  }

  IsBlindVia(): boolean {
    // We don't actually have an GUI or file tokens to differentiate these, so we have to look at
    // the layers.
    if (this.m_viaType === VIATYPE.BLIND || this.m_viaType === VIATYPE.BURIED) {
      const startOuter =
        this.Padstack().Drill().start === PCB_LAYER_ID.F_Cu ||
        this.Padstack().Drill().start === PCB_LAYER_ID.B_Cu;
      const endOuter =
        this.Padstack().Drill().end === PCB_LAYER_ID.F_Cu ||
        this.Padstack().Drill().end === PCB_LAYER_ID.B_Cu;
      return startOuter !== endOuter;
    }

    return false;
  }

  IsBuriedVia(): boolean {
    // We don't actually have an GUI or file tokens to differentiate these, so we have to look at
    // the layers.
    if (this.m_viaType === VIATYPE.BLIND || this.m_viaType === VIATYPE.BURIED) {
      return (
        this.Padstack().Drill().start !== PCB_LAYER_ID.F_Cu &&
        this.Padstack().Drill().start !== PCB_LAYER_ID.B_Cu &&
        this.Padstack().Drill().end !== PCB_LAYER_ID.F_Cu &&
        this.Padstack().Drill().end !== PCB_LAYER_ID.B_Cu
      );
    }

    return false;
  }

  static ValidateViaParameters(
    aDiameter: number | undefined,
    aPrimaryDrill: number | undefined,
    aPrimaryStartLayer: PCB_LAYER_ID | undefined = undefined,
    aPrimaryEndLayer: PCB_LAYER_ID | undefined = undefined,
    aSecondaryDrill: number | undefined = undefined,
    aSecondaryStartLayer: PCB_LAYER_ID | undefined = undefined,
    aSecondaryEndLayer: PCB_LAYER_ID | undefined = undefined,
    aTertiaryDrill: number | undefined = undefined,
    aTertiaryStartLayer: PCB_LAYER_ID | undefined = undefined,
    aTertiaryEndLayer: PCB_LAYER_ID | undefined = undefined,
    aCopperLayerCount = 0,
  ): VIA_PARAMETER_ERROR | undefined {
    const error = new VIA_PARAMETER_ERROR();

    if (aDiameter !== undefined && aDiameter < GEOMETRY_MIN_SIZE) {
      error.m_Message = 'Via diameter is too small.';
      error.m_Field = VIA_PARAMETER_ERROR_FIELD.DIAMETER;
      return error;
    }

    if (aPrimaryDrill !== undefined && aPrimaryDrill < GEOMETRY_MIN_SIZE) {
      error.m_Message = 'Via drill is too small.';
      error.m_Field = VIA_PARAMETER_ERROR_FIELD.DRILL;
      return error;
    }

    if (aDiameter !== undefined && aPrimaryDrill === undefined) {
      error.m_Message = 'No via hole size defined.';
      error.m_Field = VIA_PARAMETER_ERROR_FIELD.DRILL;
      return error;
    }

    if (aPrimaryDrill !== undefined && aDiameter === undefined) {
      error.m_Message = 'No via diameter defined.';
      error.m_Field = VIA_PARAMETER_ERROR_FIELD.DIAMETER;
      return error;
    }

    if (aDiameter !== undefined && aPrimaryDrill !== undefined && aDiameter <= aPrimaryDrill) {
      error.m_Message = 'Via hole size must be smaller than via diameter';
      error.m_Field = VIA_PARAMETER_ERROR_FIELD.DRILL;
      return error;
    }

    let copperMask: LSET | undefined;

    const validateLayer = (
      aLayer: PCB_LAYER_ID | undefined,
      aField: VIA_PARAMETER_ERROR_FIELD,
    ): boolean => {
      if (aLayer === undefined) return true;

      const layer = aLayer;

      if (layer === PCB_LAYER_ID.UNDEFINED_LAYER) return true;

      if (!IsCopperLayer(layer)) {
        error.m_Message = 'Via layer must be a copper layer.';
        error.m_Field = aField;
        return false;
      }

      if (aCopperLayerCount > 0) {
        if (copperMask === undefined) copperMask = LSET.AllCuMask(aCopperLayerCount);

        if (!copperMask.Contains(layer)) {
          error.m_Message = 'Via layer is outside the board stack.';
          error.m_Field = aField;
          return false;
        }
      }

      return true;
    };

    if (!validateLayer(aPrimaryStartLayer, VIA_PARAMETER_ERROR_FIELD.START_LAYER)) return error;

    if (!validateLayer(aPrimaryEndLayer, VIA_PARAMETER_ERROR_FIELD.END_LAYER)) return error;

    if (
      aPrimaryStartLayer !== undefined &&
      aPrimaryEndLayer !== undefined &&
      aPrimaryStartLayer === aPrimaryEndLayer
    ) {
      error.m_Message = 'Via start layer and end layer cannot be the same';
      error.m_Field = VIA_PARAMETER_ERROR_FIELD.START_LAYER;
      return error;
    }

    if (aSecondaryDrill !== undefined) {
      if (aSecondaryDrill < (aPrimaryDrill ?? GEOMETRY_MIN_SIZE)) {
        error.m_Message = 'Backdrill diameter is too small.';
        error.m_Field = VIA_PARAMETER_ERROR_FIELD.SECONDARY_DRILL;
        return error;
      }

      if (!validateLayer(aSecondaryStartLayer, VIA_PARAMETER_ERROR_FIELD.SECONDARY_START_LAYER))
        return error;

      if (!validateLayer(aSecondaryEndLayer, VIA_PARAMETER_ERROR_FIELD.SECONDARY_END_LAYER))
        return error;
    }

    if (aTertiaryDrill !== undefined) {
      if (aTertiaryDrill < (aPrimaryDrill ?? GEOMETRY_MIN_SIZE)) {
        error.m_Message = 'Tertiary backdrill diameter is too small.';
        error.m_Field = VIA_PARAMETER_ERROR_FIELD.TERTIARY_DRILL;
        return error;
      }

      if (!validateLayer(aTertiaryStartLayer, VIA_PARAMETER_ERROR_FIELD.TERTIARY_START_LAYER))
        return error;

      if (!validateLayer(aTertiaryEndLayer, VIA_PARAMETER_ERROR_FIELD.TERTIARY_END_LAYER))
        return error;
    }

    return undefined;
  }

  /** `GetBoundingBox()` and `GetBoundingBox( PCB_LAYER_ID aLayer )`. */
  override GetBoundingBox(aLayer?: PCB_LAYER_ID): BOX2I {
    let radius = 0;

    if (aLayer === undefined) {
      this.Padstack().ForEachUniqueLayer((layer: PCB_LAYER_ID) => {
        radius = Math.max(radius, this.GetWidth(layer));
      });
    } else {
      radius = this.GetWidth(aLayer);
    }

    // via is round, this is its radius, rounded up
    radius = Math.trunc((radius + 1) / 2);

    const ymax = this.m_Start.y + radius;
    const xmax = this.m_Start.x + radius;

    const ymin = this.m_Start.y - radius;
    const xmin = this.m_Start.x - radius;

    // return a rectangle which is [pos,dim) in nature.  therefore the +1
    return BOX2ISafe({ x: xmin, y: ymin }, { x: xmax - xmin + 1, y: ymax - ymin + 1 });
  }

  /** `SetWidth( int aWidth )` and `SetWidth( PCB_LAYER_ID aLayer, int aWidth )`. */
  override SetWidth(a: number, b?: number): void {
    if (b === undefined) this.m_padStack.SetSize({ x: a, y: a }, PADSTACK.ALL_LAYERS);
    else this.m_padStack.SetSize({ x: b, y: b }, a as PCB_LAYER_ID);
  }

  /** `GetWidth()` and `GetWidth( PCB_LAYER_ID aLayer )`. */
  override GetWidth(aLayer?: PCB_LAYER_ID): number {
    if (aLayer === undefined) {
      // This is present because of the parent class.  It should never be actually called on a via.
      console.assert(false, 'Warning: PCB_VIA::GetWidth called without a layer argument');
      return this.m_padStack.Size(PADSTACK.ALL_LAYERS).x;
    }

    return this.m_padStack.Size(aLayer).x;
  }

  // For properties panel
  SetFrontWidth(aWidth: number): void {
    this.SetWidth(PCB_LAYER_ID.F_Cu, aWidth);
  }
  GetFrontWidth(): number {
    return this.GetWidth(PCB_LAYER_ID.F_Cu);
  }

  override HasHole(): boolean {
    return true;
  }

  override HasDrilledHole(): boolean {
    return (
      this.m_viaType === VIATYPE.THROUGH ||
      this.m_viaType === VIATYPE.BLIND ||
      this.m_viaType === VIATYPE.BURIED
    );
  }

  override GetEffectiveHoleShape(): SHAPE_SEGMENT {
    return new SHAPE_SEGMENT(new SEG(this.m_Start, this.m_Start), this.Padstack().Drill().size.x);
  }

  override GetWidthConstraint(aSource: OutStr | null = null): MINOPTMAX {
    let constraint = new DRC_CONSTRAINT();

    if (this.GetBoard() && this.GetBoard()!.GetDesignSettings().m_DRCEngine) {
      const bds = this.GetBoard()!.GetDesignSettings();

      constraint = bds.m_DRCEngine!.EvalRules(
        DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT,
        this,
        null,
        this.m_layer,
      );
    }

    if (aSource) aSource.value = constraint.GetName();

    return constraint.Value();
  }

  GetDrillConstraint(aSource: OutStr | null = null): MINOPTMAX {
    let constraint = new DRC_CONSTRAINT();

    if (this.GetBoard() && this.GetBoard()!.GetDesignSettings().m_DRCEngine) {
      const bds = this.GetBoard()!.GetDesignSettings();

      constraint = bds.m_DRCEngine!.EvalRules(
        DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT,
        this,
        null,
        this.m_layer,
      );
    }

    if (aSource) aSource.value = constraint.GetName();

    return constraint.Value();
  }

  // clang-format off: the suggestion is slightly less readable
  SetFrontTentingMode(aMode: TENTING_MODE): void {
    switch (aMode) {
      case TENTING_MODE.FROM_BOARD:
        this.m_padStack.FrontOuterLayers().has_solder_mask = undefined;
        break;
      case TENTING_MODE.TENTED:
        this.m_padStack.FrontOuterLayers().has_solder_mask = true;
        break;
      case TENTING_MODE.NOT_TENTED:
        this.m_padStack.FrontOuterLayers().has_solder_mask = false;
        break;
    }
  }

  GetFrontTentingMode(): TENTING_MODE {
    if (this.m_padStack.FrontOuterLayers().has_solder_mask !== undefined) {
      return this.m_padStack.FrontOuterLayers().has_solder_mask
        ? TENTING_MODE.TENTED
        : TENTING_MODE.NOT_TENTED;
    }

    return TENTING_MODE.FROM_BOARD;
  }

  SetBackTentingMode(aMode: TENTING_MODE): void {
    switch (aMode) {
      case TENTING_MODE.FROM_BOARD:
        this.m_padStack.BackOuterLayers().has_solder_mask = undefined;
        break;
      case TENTING_MODE.TENTED:
        this.m_padStack.BackOuterLayers().has_solder_mask = true;
        break;
      case TENTING_MODE.NOT_TENTED:
        this.m_padStack.BackOuterLayers().has_solder_mask = false;
        break;
    }
  }

  GetBackTentingMode(): TENTING_MODE {
    if (this.m_padStack.BackOuterLayers().has_solder_mask !== undefined) {
      return this.m_padStack.BackOuterLayers().has_solder_mask
        ? TENTING_MODE.TENTED
        : TENTING_MODE.NOT_TENTED;
    }

    return TENTING_MODE.FROM_BOARD;
  }

  SetFrontCoveringMode(aMode: COVERING_MODE): void {
    switch (aMode) {
      case COVERING_MODE.FROM_BOARD:
        this.m_padStack.FrontOuterLayers().has_covering = undefined;
        break;
      case COVERING_MODE.COVERED:
        this.m_padStack.FrontOuterLayers().has_covering = true;
        break;
      case COVERING_MODE.NOT_COVERED:
        this.m_padStack.FrontOuterLayers().has_covering = false;
        break;
    }
  }

  GetFrontCoveringMode(): COVERING_MODE {
    if (this.m_padStack.FrontOuterLayers().has_covering !== undefined) {
      return this.m_padStack.FrontOuterLayers().has_covering
        ? COVERING_MODE.COVERED
        : COVERING_MODE.NOT_COVERED;
    }

    return COVERING_MODE.FROM_BOARD;
  }

  SetBackCoveringMode(aMode: COVERING_MODE): void {
    switch (aMode) {
      case COVERING_MODE.FROM_BOARD:
        this.m_padStack.BackOuterLayers().has_covering = undefined;
        break;
      case COVERING_MODE.COVERED:
        this.m_padStack.BackOuterLayers().has_covering = true;
        break;
      case COVERING_MODE.NOT_COVERED:
        this.m_padStack.BackOuterLayers().has_covering = false;
        break;
    }
  }

  GetBackCoveringMode(): COVERING_MODE {
    if (this.m_padStack.BackOuterLayers().has_covering !== undefined) {
      return this.m_padStack.BackOuterLayers().has_covering
        ? COVERING_MODE.COVERED
        : COVERING_MODE.NOT_COVERED;
    }

    return COVERING_MODE.FROM_BOARD;
  }

  SetFrontPluggingMode(aMode: PLUGGING_MODE): void {
    switch (aMode) {
      case PLUGGING_MODE.FROM_BOARD:
        this.m_padStack.FrontOuterLayers().has_plugging = undefined;
        break;
      case PLUGGING_MODE.PLUGGED:
        this.m_padStack.FrontOuterLayers().has_plugging = true;
        break;
      case PLUGGING_MODE.NOT_PLUGGED:
        this.m_padStack.FrontOuterLayers().has_plugging = false;
        break;
    }
  }

  GetFrontPluggingMode(): PLUGGING_MODE {
    if (this.m_padStack.FrontOuterLayers().has_plugging !== undefined) {
      return this.m_padStack.FrontOuterLayers().has_plugging
        ? PLUGGING_MODE.PLUGGED
        : PLUGGING_MODE.NOT_PLUGGED;
    }

    return PLUGGING_MODE.FROM_BOARD;
  }

  SetBackPluggingMode(aMode: PLUGGING_MODE): void {
    switch (aMode) {
      case PLUGGING_MODE.FROM_BOARD:
        this.m_padStack.BackOuterLayers().has_plugging = undefined;
        break;
      case PLUGGING_MODE.PLUGGED:
        this.m_padStack.BackOuterLayers().has_plugging = true;
        break;
      case PLUGGING_MODE.NOT_PLUGGED:
        this.m_padStack.BackOuterLayers().has_plugging = false;
        break;
    }
  }

  GetBackPluggingMode(): PLUGGING_MODE {
    if (this.m_padStack.BackOuterLayers().has_plugging !== undefined) {
      return this.m_padStack.BackOuterLayers().has_plugging
        ? PLUGGING_MODE.PLUGGED
        : PLUGGING_MODE.NOT_PLUGGED;
    }

    return PLUGGING_MODE.FROM_BOARD;
  }

  SetCappingMode(aMode: CAPPING_MODE): void {
    switch (aMode) {
      case CAPPING_MODE.FROM_BOARD:
        this.m_padStack.Drill().is_capped = undefined;
        break;
      case CAPPING_MODE.CAPPED:
        this.m_padStack.Drill().is_capped = true;
        break;
      case CAPPING_MODE.NOT_CAPPED:
        this.m_padStack.Drill().is_capped = false;
        break;
    }
  }

  GetCappingMode(): CAPPING_MODE {
    if (this.m_padStack.Drill().is_capped !== undefined) {
      return this.m_padStack.Drill().is_capped ? CAPPING_MODE.CAPPED : CAPPING_MODE.NOT_CAPPED;
    }

    return CAPPING_MODE.FROM_BOARD;
  }

  SetFillingMode(aMode: FILLING_MODE): void {
    switch (aMode) {
      case FILLING_MODE.FROM_BOARD:
        this.m_padStack.Drill().is_filled = undefined;
        break;
      case FILLING_MODE.FILLED:
        this.m_padStack.Drill().is_filled = true;
        break;
      case FILLING_MODE.NOT_FILLED:
        this.m_padStack.Drill().is_filled = false;
        break;
    }
  }

  GetFillingMode(): FILLING_MODE {
    if (this.m_padStack.Drill().is_filled !== undefined) {
      return this.m_padStack.Drill().is_filled ? FILLING_MODE.FILLED : FILLING_MODE.NOT_FILLED;
    }

    return FILLING_MODE.FROM_BOARD;
  }
  // clang-format on

  override IsTented(aLayer: PCB_LAYER_ID): boolean {
    if (!(IsFrontLayer(aLayer) || IsBackLayer(aLayer))) {
      console.assert(false, 'Invalid layer passed to IsTented'); // wxCHECK_MSG
      return true;
    }

    const front = IsFrontLayer(aLayer);

    if (front && this.m_padStack.FrontOuterLayers().has_solder_mask !== undefined)
      return this.m_padStack.FrontOuterLayers().has_solder_mask!;

    if (!front && this.m_padStack.BackOuterLayers().has_solder_mask !== undefined)
      return this.m_padStack.BackOuterLayers().has_solder_mask!;

    const board = this.GetBoard();

    if (board) {
      return front
        ? board.GetDesignSettings().m_TentViasFront
        : board.GetDesignSettings().m_TentViasBack;
    }

    return true;
  }

  override GetSolderMaskExpansion(): number {
    const board = this.GetBoard();

    if (board) return board.GetDesignSettings().m_SolderMaskExpansion;
    else return 0;
  }

  override GetLayer(): PCB_LAYER_ID {
    return this.Padstack().Drill().start;
  }

  override SetLayer(aLayer: PCB_LAYER_ID): void {
    this.Padstack().Drill().start = aLayer;
  }

  override IsOnLayer(aLayer: PCB_LAYER_ID): boolean {
    // #if 0
    // Nice and simple, but raises its ugly head in performance profiles....
    // return GetLayerSet().test( aLayer );
    // #endif
    if (
      IsCopperLayer(aLayer) &&
      LAYER_RANGE.Contains(this.Padstack().Drill().start, this.Padstack().Drill().end, aLayer)
    ) {
      return true;
    }

    // Test for via on mask layers: a via on on a mask layer if not tented and if
    // it is on the corresponding external copper layer
    if (aLayer === PCB_LAYER_ID.F_Mask)
      return (
        this.Padstack().Drill().start === PCB_LAYER_ID.F_Cu && !this.IsTented(PCB_LAYER_ID.F_Mask)
      );
    else if (aLayer === PCB_LAYER_ID.B_Mask)
      return (
        this.Padstack().Drill().end === PCB_LAYER_ID.B_Cu && !this.IsTented(PCB_LAYER_ID.B_Mask)
      );

    return false;
  }

  override GetLayerSet(): LSET {
    let layermask = new LSET();

    if (this.Padstack().Drill().start < PCBNEW_LAYER_ID_START) return layermask;

    if (this.GetViaType() === VIATYPE.THROUGH) {
      layermask = LSET.AllCuMask(this.BoardCopperLayerCount());
    } else {
      const range = new LAYER_RANGE(
        this.Padstack().Drill().start,
        this.Padstack().Drill().end,
        this.BoardCopperLayerCount(),
      );

      let cnt = this.BoardCopperLayerCount();
      // PCB_LAYER_IDs are numbered from front to back, this is top to bottom.
      for (const id of range) {
        layermask.set(id);

        if (--cnt <= 0) break;
      }
    }

    if (!this.IsTented(PCB_LAYER_ID.F_Mask) && layermask.test(PCB_LAYER_ID.F_Cu))
      layermask.set(PCB_LAYER_ID.F_Mask);

    if (!this.IsTented(PCB_LAYER_ID.B_Mask) && layermask.test(PCB_LAYER_ID.B_Cu))
      layermask.set(PCB_LAYER_ID.B_Mask);

    return layermask;
  }

  /**
   * Note SetLayerSet() initialize the first and last copper layers connected by the via.
   * So currently SetLayerSet ignore non copper layers
   */
  override SetLayerSet(aLayerSet: LSET): void {
    // Vias do not use a LSET, just a top and bottom layer pair
    // So we need to set these 2 layers according to the allowed layers in aLayerSet

    // For via through, only F_Cu and B_Cu are allowed. aLayerSet is ignored
    if (this.GetViaType() === VIATYPE.THROUGH) {
      this.Padstack().Drill().start = PCB_LAYER_ID.F_Cu;
      this.Padstack().Drill().end = PCB_LAYER_ID.B_Cu;
      return;
    }

    // For blind buried vias, find the top and bottom layers
    let top_found = false;
    let bottom_found = false;

    aLayerSet.RunOnLayers((layer: PCB_LAYER_ID) => {
      // tpo layer and bottom Layer are copper layers, so consider only copper layers
      if (IsCopperLayer(layer)) {
        // The top layer is the first layer found in list and
        // cannot the B_Cu
        if (!top_found && layer !== PCB_LAYER_ID.B_Cu) {
          this.Padstack().Drill().start = layer;
          top_found = true;
        }

        // The bottom layer is the last layer found in list or B_Cu
        if (!bottom_found) this.Padstack().Drill().end = layer;

        if (layer === PCB_LAYER_ID.B_Cu) bottom_found = true;
      }
    });
  }

  /**
   * For a via m_layer contains the top layer, the other layer is in m_bottomLayer/
   *
   * @param aTopLayer is the first layer connected by the via.
   * @param aBottomLayer is last layer connected by the via.
   */
  SetLayerPair(aTopLayer: PCB_LAYER_ID, aBottomLayer: PCB_LAYER_ID): void {
    this.Padstack().Drill().start = aTopLayer;
    this.Padstack().Drill().end = aBottomLayer;
    this.SanitizeLayers();

    if (!(this.GetFlags() & ROUTER_TRANSIENT)) {
      // if( BOARD* board = GetBoard() ) board->InvalidateClearanceCache( m_Uuid );
      //                                                   -- BOARD's DRC caches pending (#636)
    }
  }

  SetTopLayer(aLayer: PCB_LAYER_ID): void {
    // refuse invalid via
    if (aLayer === this.Padstack().Drill().end) return;

    this.Padstack().Drill().start = aLayer;
    this.SanitizeLayers();

    if (!(this.GetFlags() & ROUTER_TRANSIENT)) {
      // if( BOARD* board = GetBoard() ) board->InvalidateClearanceCache( m_Uuid );
      //                                                   -- BOARD's DRC caches pending (#636)
    }
  }

  SetBottomLayer(aLayer: PCB_LAYER_ID): void {
    // refuse invalid via
    if (aLayer === this.Padstack().Drill().start) return;

    this.Padstack().Drill().end = aLayer;
    this.SanitizeLayers();

    if (!(this.GetFlags() & ROUTER_TRANSIENT)) {
      // if( BOARD* board = GetBoard() ) board->InvalidateClearanceCache( m_Uuid );
      //                                                   -- BOARD's DRC caches pending (#636)
    }
  }

  /**
   * Return the 2 layers used by the via (the via actually uses all layers between these
   * 2 layers)
   *
   *  @return [top_layer, bottom_layer]: the first and last layer of the via.
   */
  LayerPair(): [PCB_LAYER_ID, PCB_LAYER_ID] {
    let t_layer = PCB_LAYER_ID.F_Cu;
    let b_layer = PCB_LAYER_ID.B_Cu;

    if (this.GetViaType() !== VIATYPE.THROUGH) {
      b_layer = this.Padstack().Drill().end;
      t_layer = this.Padstack().Drill().start;

      if (!IsCopperLayerLowerThan(b_layer, t_layer)) [b_layer, t_layer] = [t_layer, b_layer];
    }

    return [t_layer, b_layer];
  }

  TopLayer(): PCB_LAYER_ID {
    return this.Padstack().Drill().start;
  }

  BottomLayer(): PCB_LAYER_ID {
    return this.Padstack().Drill().end;
  }

  /**
   * Check so that the layers are correct depending on the type of via, and
   * so that the top actually is on top.
   */
  SanitizeLayers(): void {
    if (this.GetViaType() === VIATYPE.THROUGH) {
      this.Padstack().Drill().start = PCB_LAYER_ID.F_Cu;
      this.Padstack().Drill().end = PCB_LAYER_ID.B_Cu;
    }

    if (!IsCopperLayerLowerThan(this.Padstack().Drill().end, this.Padstack().Drill().start)) {
      const drill = this.Padstack().Drill();
      [drill.end, drill.start] = [drill.start, drill.end];
    }

    const copperCount = this.BoardCopperLayerCount();

    const sanitizeBackdrill = (aDrill: PADSTACK_DRILL_PROPS): void => {
      if (aDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER && !IsCopperLayer(aDrill.start))
        aDrill.start = PCB_LAYER_ID.UNDEFINED_LAYER;

      if (aDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER && !IsCopperLayer(aDrill.end))
        aDrill.end = PCB_LAYER_ID.UNDEFINED_LAYER;

      if (copperCount > 0) {
        const cuMask = LSET.AllCuMask(copperCount);

        if (aDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER && !cuMask.Contains(aDrill.start))
          aDrill.start = PCB_LAYER_ID.UNDEFINED_LAYER;

        if (aDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER && !cuMask.Contains(aDrill.end))
          aDrill.end = PCB_LAYER_ID.UNDEFINED_LAYER;
      }

      // A backdrill side with no must-cut layer does not exist.
      if (aDrill.end === PCB_LAYER_ID.UNDEFINED_LAYER) aDrill.size = { x: 0, y: 0 };
    };

    sanitizeBackdrill(this.Padstack().SecondaryDrill());
    sanitizeBackdrill(this.Padstack().TertiaryDrill());
  }

  override GetPosition(): VECTOR2I {
    return this.m_Start;
  }
  override SetPosition(aPoint: VECTOR2I): void {
    this.m_Start = { ...aPoint };
    this.m_End = { ...aPoint };
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    const frame = aFrame as MSG_PANEL_FRAME;
    let msg: string;

    switch (this.GetViaType()) {
      case VIATYPE.MICROVIA:
        msg = 'Micro Via';
        break;
      case VIATYPE.BLIND:
        msg = 'Blind Via';
        break;
      case VIATYPE.BURIED:
        msg = 'Buried Via';
        break;
      case VIATYPE.THROUGH:
        msg = 'Through Via';
        break;
      default:
        msg = 'Via';
        break;
    }

    aList.push(new MSG_PANEL_ITEM('Type', msg));

    this.GetMsgPanelInfoBase_Common(aFrame, aList);

    aList.push(new MSG_PANEL_ITEM('Layer', this.LayerMaskDescribe()));
    // TODO(JE) padstacks
    aList.push(
      new MSG_PANEL_ITEM(
        'Diameter',
        frame.MessageTextFromValue(this.GetWidth(PADSTACK.ALL_LAYERS)),
      ),
    );
    aList.push(new MSG_PANEL_ITEM('Hole', frame.MessageTextFromValue(this.GetDrillValue())));

    const source: OutStr = { value: '' };
    const clearance = this.GetOwnClearance(this.GetLayer(), source);

    aList.push(
      new MSG_PANEL_ITEM(
        `Min Clearance: ${frame.MessageTextFromValue(clearance)}`,
        `(from ${source.value})`,
      ),
    );

    const minAnnulus = this.GetMinAnnulus(this.GetLayer(), source);

    aList.push(
      new MSG_PANEL_ITEM(
        `Min Annular Width: ${frame.MessageTextFromValue(minAnnulus)}`,
        `(from ${source.value})`,
      ),
    );
  }

  protected override hitTestPoint(aPosition: VECTOR2I, aAccuracy: number): boolean {
    let hit = false;

    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      if (hit) return;

      const max_dist = aAccuracy + Math.trunc(this.GetWidth(aLayer) / 2);

      // rel_pos is aPosition relative to m_Start (or the center of the via)
      const rel_pos = sub(aPosition, this.m_Start);
      const dist = rel_pos.x * rel_pos.x + rel_pos.y * rel_pos.y;

      if (dist <= max_dist * max_dist) hit = true;
    });

    return hit;
  }

  protected override hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    const arect = new BOX2I(aRect.GetPosition(), aRect.GetSize());
    arect.Inflate(aAccuracy);

    let hit = false;

    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      if (hit) return;

      const box = new BOX2I(this.GetStart());
      box.Inflate(Math.trunc(this.GetWidth(aLayer) / 2));

      if (aContained) hit = arect.Contains(box);
      else hit = arect.IntersectsCircle(this.GetStart(), Math.trunc(this.GetWidth(aLayer) / 2));
    });

    return hit;
  }

  override GetClass(): string {
    return 'PCB_VIA';
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    let formatStr: (net: string, layers: string) => string;

    switch (this.GetViaType()) {
      case VIATYPE.BLIND:
        formatStr = (net, layers) => `Blind via ${net} on ${layers}`;
        break;
      case VIATYPE.BURIED:
        formatStr = (net, layers) => `Buried via ${net} on ${layers}`;
        break;
      case VIATYPE.MICROVIA:
        formatStr = (net, layers) => `Micro via ${net} on ${layers}`;
        break;
      default:
        formatStr = (net, layers) => `Via ${net} on ${layers}`;
        break;
    }

    return formatStr(this.GetNetnameMsg(), this.LayerMaskDescribe());
  }

  override GetMenuImage(): string {
    return 'via';
  }

  override Clone(): PCB_VIA {
    return PCB_VIA.copyOfVia(this);
  }

  override ViewGetLayers(): number[] {
    const layers = new LAYER_RANGE(
      this.Padstack().Drill().start,
      this.Padstack().Drill().end,
      MAX_CU_LAYERS,
    );
    const ret_layers: number[] = [
      GAL_LAYER_ID.LAYER_VIA_HOLES,
      GAL_LAYER_ID.LAYER_VIA_HOLEWALLS,
      NETNAMES_LAYER_ID.LAYER_VIA_NETNAMES,
    ];

    // TODO(JE) Rendering order issue
    // #if 0
    // Blind/buried vias (and microvias) use a different net name layer
    // #endif
    let cuMask = LSET.AllCuMask();
    const board = this.GetBoard();

    if (board) cuMask = cuMask.and(board.GetEnabledLayers());

    for (const layer of layers) {
      if (!cuMask.Contains(layer)) continue;

      ret_layers.push(GAL_LAYER_ID.LAYER_VIA_COPPER_START + layer);
      ret_layers.push(GAL_LAYER_ID.LAYER_CLEARANCE_START + layer);
    }

    if (this.IsLocked()) ret_layers.push(GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW);

    // Vias can also be on a solder mask layer. They are on these layers or not,
    // depending on the plot and solder mask options
    if (this.IsOnLayer(PCB_LAYER_ID.F_Mask)) ret_layers.push(PCB_LAYER_ID.F_Mask);

    if (this.IsOnLayer(PCB_LAYER_ID.B_Mask)) ret_layers.push(PCB_LAYER_ID.B_Mask);

    return ret_layers;
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    if (!aView) return PCB_VIA.LOD_SHOW;

    const renderSettings = aView.GetPainter().GetSettings();
    const board = this.GetBoard();

    // Meta control for hiding all vias
    if (!aView.IsLayerVisible(GAL_LAYER_ID.LAYER_VIAS)) return PCB_VIA.LOD_HIDE;

    // In high contrast mode don't show vias that don't cross the high-contrast layer
    if (renderSettings.GetHighContrast()) {
      let highContrastLayer = renderSettings.GetPrimaryHighContrastLayer();

      if (LSET.FrontTechMask().Contains(highContrastLayer)) highContrastLayer = PCB_LAYER_ID.F_Cu;
      else if (LSET.BackTechMask().Contains(highContrastLayer))
        highContrastLayer = PCB_LAYER_ID.B_Cu;

      if (IsCopperLayer(highContrastLayer) && this.GetViaType() !== VIATYPE.THROUGH) {
        if (
          IsCopperLayerLowerThan(this.Padstack().Drill().start, highContrastLayer) ||
          IsCopperLayerLowerThan(highContrastLayer, this.Padstack().Drill().end)
        ) {
          return PCB_VIA.LOD_HIDE;
        }
      }
    }

    if (IsHoleLayer(aLayer)) {
      let visible: LSET;

      if (board) {
        visible = board.GetVisibleLayers();
        visible = visible.and(board.GetEnabledLayers());
      } else {
        visible = LSET.AllLayersMask();
      }

      if (this.m_viaType === VIATYPE.THROUGH) {
        // Show a through via's hole if any physical layer is shown
        visible = visible.and(LSET.PhysicalLayersMask());

        if (!visible.any()) return PCB_VIA.LOD_HIDE;
      } else {
        // Show a blind or micro via's hole if it crosses a visible layer
        visible = visible.and(this.GetLayerSet());

        if (!visible.any()) return PCB_VIA.LOD_HIDE;
      }

      // The hole won't be visible anyway at this scale
      return PCB_VIA.lodScaleForThreshold(aView, this.GetDrillValue(), pcbIUScale.mmToIU(0.25));
    } else if (IsNetnameLayer(aLayer)) {
      if (renderSettings.GetHighContrast()) {
        // Hide netnames unless via is flashed to a high-contrast layer
        if (!this.FlashLayer(renderSettings.GetPrimaryHighContrastLayer())) return PCB_VIA.LOD_HIDE;
      } else {
        let visible: LSET;

        if (board) {
          visible = board.GetVisibleLayers();
          visible = visible.and(board.GetEnabledLayers());
        } else {
          visible = LSET.AllLayersMask();
        }

        // Hide netnames unless pad is flashed to a visible layer
        if (!this.FlashLayer(visible)) return PCB_VIA.LOD_HIDE;
      }

      const width = this.GetWidth(ToLAYER_ID(aLayer));

      // Netnames will be shown only if zoom is appropriate
      return PCB_VIA.lodScaleForThreshold(aView, width, pcbIUScale.mmToIU(10));
    }

    if (!IsCopperLayer(aLayer)) {
      const width = this.GetWidth(ToLAYER_ID(aLayer));
      return PCB_VIA.lodScaleForThreshold(aView, width, pcbIUScale.mmToIU(0.6));
    }

    return PCB_VIA.LOD_SHOW;
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      this.m_Start.x = aCentre.x - (this.m_Start.x - aCentre.x);
      this.m_End.x = aCentre.x - (this.m_End.x - aCentre.x);
    } else {
      this.m_Start.y = aCentre.y - (this.m_Start.y - aCentre.y);
      this.m_End.y = aCentre.y - (this.m_End.y - aCentre.y);
    }

    if (this.GetViaType() !== VIATYPE.THROUGH) {
      let [top_layer, bottom_layer] = this.LayerPair();
      top_layer = this.GetBoard()!.FlipLayer(top_layer);
      bottom_layer = this.GetBoard()!.FlipLayer(bottom_layer);
      this.SetLayerPair(top_layer, bottom_layer);
    }
  }

  GetMinAnnulus(aLayer: PCB_LAYER_ID, aSource: OutStr | null): number {
    if (!this.FlashLayer(aLayer)) {
      if (aSource) aSource.value = 'removed annular ring';

      return 0;
    }

    let constraint = new DRC_CONSTRAINT();

    if (this.GetBoard() && this.GetBoard()!.GetDesignSettings().m_DRCEngine) {
      const bds = this.GetBoard()!.GetDesignSettings();

      constraint = bds.m_DRCEngine!.EvalRules(
        DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT,
        this,
        null,
        aLayer,
      );
    }

    if (constraint.Value().HasMin()) {
      if (aSource) aSource.value = constraint.GetName();

      return constraint.Value().Min();
    }

    return 0;
  }

  /**
   * @deprecated - use Padstack().SetUnconnectedLayerMode()
   * Sets the unconnected removal property.  If true, the copper is removed on zone fill
   * or when specifically requested when the via is not connected on a layer.
   */
  SetRemoveUnconnected(aSet: boolean): void {
    this.m_padStack.SetUnconnectedLayerMode(
      aSet ? UNCONNECTED_LAYER_MODE.REMOVE_ALL : UNCONNECTED_LAYER_MODE.KEEP_ALL,
    );
  }

  GetRemoveUnconnected(): boolean {
    return this.m_padStack.UnconnectedLayerMode() !== UNCONNECTED_LAYER_MODE.KEEP_ALL;
  }

  /**
   * @deprecated - use Padstack().SetUnconnectedLayerMode()
   * Sets whether we keep the start and end annular rings even if they are not connected
   */
  SetKeepStartEnd(aSet: boolean): void {
    this.m_padStack.SetUnconnectedLayerMode(
      aSet ? UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END : UNCONNECTED_LAYER_MODE.REMOVE_ALL,
    );
  }

  GetKeepStartEnd(): boolean {
    return (
      this.m_padStack.UnconnectedLayerMode() === UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END
    );
  }

  ConditionallyFlashed(aLayer: PCB_LAYER_ID): boolean {
    switch (this.m_padStack.UnconnectedLayerMode()) {
      case UNCONNECTED_LAYER_MODE.KEEP_ALL:
        return false;

      case UNCONNECTED_LAYER_MODE.REMOVE_ALL:
        return true;

      case UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END:
      case UNCONNECTED_LAYER_MODE.START_END_ONLY:
        return aLayer !== this.m_padStack.Drill().start && aLayer !== this.m_padStack.Drill().end;
    }

    return true;
  }

  /**
   * Check to see whether the via should have a pad on the specific layer.
   *
   * @param aLayer Layer to check for connectivity
   * @return true if connected by pad or track (or optionally zone)
   */
  FlashLayer(aLayer: number): boolean;
  /**
   * Check to see if the via is present on any of the layers in the set.
   *
   * @param aLayers is the set of layers to check the via against.
   * @return true if connected by pad or track (or optionally zone) on any of the associated
   *         layers.
   */
  FlashLayer(aLayers: LSET): boolean;
  FlashLayer(a: number | LSET): boolean {
    if (a instanceof LSET) {
      for (const layer of a) {
        if (this.FlashLayer(layer)) return true;
      }

      return false;
    }

    const aLayer = a;

    // Return the "normal" shape if the caller doesn't specify a particular layer
    if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) return true;

    const board = this.GetBoard();
    const layer = aLayer as PCB_LAYER_ID;

    if (!board) return true;

    if (!this.IsOnLayer(layer)) return false;

    if (!IsCopperLayer(layer)) return true;

    switch (this.Padstack().UnconnectedLayerMode()) {
      case UNCONNECTED_LAYER_MODE.KEEP_ALL:
        return true;

      case UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END:
        if (layer === this.Padstack().Drill().start || layer === this.Padstack().Drill().end)
          return true;

        // Check for removal below
        break;

      case UNCONNECTED_LAYER_MODE.REMOVE_ALL:
        // Check for removal below
        break;

      case UNCONNECTED_LAYER_MODE.START_END_ONLY:
        return layer === this.Padstack().Drill().start || layer === this.Padstack().Drill().end;
    }

    if (this.GetZoneLayerOverride(layer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED) {
      return true;
    } else {
      // static std::initializer_list<KICAD_T> nonZoneTypes = { PCB_TRACE_T, PCB_ARC_T, PCB_VIA_T, PCB_PAD_T };
      // return board->GetConnectivity()->IsConnectedOnLayer( this, layer, nonZoneTypes );
      //                                                   -- CONNECTIVITY_DATA pending (#636 stage 2): flashed
      return true;
    }
  }

  /**
   * Return the top-most and bottom-most connected layers.
   * @return [aTopmost, aBottommost]
   */
  GetOutermostConnectedLayers(): [PCB_LAYER_ID, PCB_LAYER_ID] {
    let aTopmost = PCB_LAYER_ID.UNDEFINED_LAYER;
    let aBottommost = PCB_LAYER_ID.UNDEFINED_LAYER;

    // static std::initializer_list<KICAD_T> nonZoneTypes = { PCB_TRACE_T, PCB_ARC_T, PCB_VIA_T, PCB_PAD_T };

    for (let layer = this.TopLayer(); layer <= this.BottomLayer(); ++layer) {
      let connected = false;

      if (
        this.GetZoneLayerOverride(layer as PCB_LAYER_ID) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED
      ) {
        connected = true;
      } else {
        // else if( GetBoard()->GetConnectivity()->IsConnectedOnLayer( this, layer, nonZoneTypes ) )
        //                                                   -- CONNECTIVITY_DATA pending (#636 stage 2): connected
        connected = true;
      }

      if (connected) {
        if (aTopmost === PCB_LAYER_ID.UNDEFINED_LAYER) aTopmost = ToLAYER_ID(layer);

        aBottommost = ToLAYER_ID(layer);
      }
    }

    return [aTopmost, aBottommost];
  }

  /**
   * Set the drill value for vias.
   *
   * @param aDrill is the new drill diameter
   */
  SetPrimaryDrillSize(aSize: VECTOR2I): void {
    this.m_padStack.Drill().size = { ...aSize };
  }
  GetPrimaryDrillSize(): VECTOR2I {
    return this.m_padStack.Drill().size;
  }

  SetPrimaryDrillShape(aShape: PAD_DRILL_SHAPE): void {
    this.m_padStack.Drill().shape = aShape;
  }
  GetPrimaryDrillShape(): PAD_DRILL_SHAPE {
    return this.m_padStack.Drill().shape;
  }

  SetPrimaryDrillStartLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.Drill().start = aLayer;
  }
  GetPrimaryDrillStartLayer(): PCB_LAYER_ID {
    return this.m_padStack.Drill().start;
  }

  SetPrimaryDrillEndLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.Drill().end = aLayer;
  }
  GetPrimaryDrillEndLayer(): PCB_LAYER_ID {
    return this.m_padStack.Drill().end;
  }

  SetFrontPostMachining(aMode: PAD_DRILL_POST_MACHINING_MODE | undefined): void {
    this.m_padStack.FrontPostMachining().mode = aMode;
  }
  GetFrontPostMachining(): PAD_DRILL_POST_MACHINING_MODE | undefined {
    return this.m_padStack.FrontPostMachining().mode;
  }

  SetFrontPostMachiningMode(aMode: PAD_DRILL_POST_MACHINING_MODE): void {
    this.m_padStack.FrontPostMachining().mode = aMode;
  }
  GetFrontPostMachiningMode(): PAD_DRILL_POST_MACHINING_MODE {
    return (
      this.m_padStack.FrontPostMachining().mode ?? PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED
    );
  }

  SetFrontPostMachiningSize(aSize: number): void {
    this.m_padStack.FrontPostMachining().size = aSize;
  }
  GetFrontPostMachiningSize(): number {
    return this.m_padStack.FrontPostMachining().size;
  }

  SetFrontPostMachiningDepth(aDepth: number): void {
    this.m_padStack.FrontPostMachining().depth = aDepth;
  }
  GetFrontPostMachiningDepth(): number {
    return this.m_padStack.FrontPostMachining().depth;
  }

  SetFrontPostMachiningAngle(aAngle: number): void {
    this.m_padStack.FrontPostMachining().angle = aAngle;
  }
  GetFrontPostMachiningAngle(): number {
    return this.m_padStack.FrontPostMachining().angle;
  }

  SetBackPostMachining(aMode: PAD_DRILL_POST_MACHINING_MODE | undefined): void {
    this.m_padStack.BackPostMachining().mode = aMode;
  }
  GetBackPostMachining(): PAD_DRILL_POST_MACHINING_MODE | undefined {
    return this.m_padStack.BackPostMachining().mode;
  }

  SetBackPostMachiningMode(aMode: PAD_DRILL_POST_MACHINING_MODE): void {
    this.m_padStack.BackPostMachining().mode = aMode;
  }
  GetBackPostMachiningMode(): PAD_DRILL_POST_MACHINING_MODE {
    return (
      this.m_padStack.BackPostMachining().mode ?? PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED
    );
  }

  SetBackPostMachiningSize(aSize: number): void {
    this.m_padStack.BackPostMachining().size = aSize;
  }
  GetBackPostMachiningSize(): number {
    return this.m_padStack.BackPostMachining().size;
  }

  SetBackPostMachiningDepth(aDepth: number): void {
    this.m_padStack.BackPostMachining().depth = aDepth;
  }
  GetBackPostMachiningDepth(): number {
    return this.m_padStack.BackPostMachining().depth;
  }

  SetBackPostMachiningAngle(aAngle: number): void {
    this.m_padStack.BackPostMachining().angle = aAngle;
  }
  GetBackPostMachiningAngle(): number {
    return this.m_padStack.BackPostMachining().angle;
  }

  /**
   * Check if a layer is affected by backdrilling or post-machining operations.
   *
   * This checks both the secondary/tertiary drills (backdrill) and post-machining
   * (counterbore/countersink) settings to determine if the given layer has had copper removed.
   *
   * @param aLayer the copper layer to check
   * @return true if the layer is affected by backdrilling or post-machining
   */
  IsBackdrilledOrPostMachined(aLayer: PCB_LAYER_ID): boolean {
    if (!IsCopperLayer(aLayer)) return false;

    const board = this.GetBoard();

    if (!board) return false;

    // Check secondary drill (backdrill from top)
    const secondaryDrill = this.m_padStack.SecondaryDrill();

    if (
      secondaryDrill.size.x > 0 &&
      secondaryDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      secondaryDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER
    ) {
      // Contains honours copper Z-order; the range iterator instead walks PCB_LAYER_ID enum
      // order, which for a bottom-anchored span spans the wrong (top inner) layers.
      if (LAYER_RANGE.Contains(secondaryDrill.start, secondaryDrill.end, aLayer)) return true;
    }

    // Check tertiary drill (backdrill from bottom)
    const tertiaryDrill = this.m_padStack.TertiaryDrill();

    if (
      tertiaryDrill.size.x > 0 &&
      tertiaryDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      tertiaryDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER
    ) {
      if (LAYER_RANGE.Contains(tertiaryDrill.start, tertiaryDrill.end, aLayer)) return true;
    }

    // Check if the layer is affected by post-machining
    if (this.GetPostMachiningKnockout(aLayer) > 0) return true;

    return false;
  }

  /**
   * Get the knockout diameter for a layer affected by post-machining.
   *
   * @param aLayer the copper layer to check
   * @return the diameter to knockout on this layer, or 0 if layer is not affected
   */
  GetPostMachiningKnockout(aLayer: PCB_LAYER_ID): number {
    if (!IsCopperLayer(aLayer)) return 0;

    const board = this.GetBoard();

    if (!board) return 0;

    // const BOARD_STACKUP& stackup = board->GetDesignSettings().GetStackupDescriptor();
    //                                                   -- BOARD_STACKUP pending (#636): no layer distance,
    //                                                      so no layer is inside a post-machining depth
    return 0;
  }

  SetPrimaryDrillFilled(aFilled: boolean | undefined): void {
    this.m_padStack.Drill().is_filled = aFilled;
  }
  SetPrimaryDrillFilledFlag(aFilled: boolean): void {
    this.m_padStack.Drill().is_filled = aFilled;
  }
  GetPrimaryDrillFilled(): boolean | undefined {
    return this.m_padStack.Drill().is_filled;
  }
  GetPrimaryDrillFilledFlag(): boolean {
    return this.m_padStack.Drill().is_filled ?? false;
  }

  SetPrimaryDrillCapped(aCapped: boolean | undefined): void {
    this.m_padStack.Drill().is_capped = aCapped;
  }
  SetPrimaryDrillCappedFlag(aCapped: boolean): void {
    this.m_padStack.Drill().is_capped = aCapped;
  }
  GetPrimaryDrillCapped(): boolean | undefined {
    return this.m_padStack.Drill().is_capped;
  }
  GetPrimaryDrillCappedFlag(): boolean {
    return this.m_padStack.Drill().is_capped ?? false;
  }

  SetDrill(aDrill: number): void {
    this.SetPrimaryDrillSize({ x: aDrill, y: aDrill });
  }

  /**
   * Return the local drill setting for this PCB_VIA.
   *
   * @note Use GetDrillValue() to get the calculated value.
   */
  GetDrill(): number {
    return this.GetPrimaryDrillSize().x;
  }

  /**
   * Calculate the drill value for vias (m_drill if > 0, or default drill value for the board).
   *
   * @return the calculated drill value.
   */
  GetDrillValue(): number {
    if (this.m_padStack.Drill().size.x > 0)
      // Use the specific value.
      return this.m_padStack.Drill().size.x;

    // Use the default value from the Netclass
    const netclass = this.GetEffectiveNetClass();

    if (this.GetViaType() === VIATYPE.MICROVIA) return netclass.GetuViaDrill();

    return netclass.GetViaDrill();
  }

  /**
   * Set the drill value for vias to the default value #UNDEFINED_DRILL_DIAMETER.
   */
  SetDrillDefault(): void {
    this.m_padStack.Drill().size = { x: UNDEFINED_DRILL_DIAMETER, y: UNDEFINED_DRILL_DIAMETER };
  }

  /** `SetSecondaryDrillSize( const VECTOR2I& )` and `SetSecondaryDrillSize( const std::optional<int>& )`. */
  SetSecondaryDrillSize(aSize: VECTOR2I | number | undefined): void {
    if (typeof aSize === 'object') {
      this.m_padStack.SecondaryDrill().size = { ...aSize };
      return;
    }

    if (aSize !== undefined && aSize > 0) this.SetSecondaryDrillSize({ x: aSize, y: aSize });
    else this.ClearSecondaryDrillSize();
  }

  ClearSecondaryDrillSize(): void {
    this.m_padStack.SecondaryDrill().size = { x: 0, y: 0 };
  }

  GetSecondaryDrillSize(): number | undefined {
    if (this.m_padStack.SecondaryDrill().size.x > 0) return this.m_padStack.SecondaryDrill().size.x;

    return undefined;
  }

  SetSecondaryDrillStartLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.SecondaryDrill().start = aLayer;
  }
  GetSecondaryDrillStartLayer(): PCB_LAYER_ID {
    return this.m_padStack.SecondaryDrill().start;
  }

  SetSecondaryDrillEndLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.SecondaryDrill().end = aLayer;
  }
  GetSecondaryDrillEndLayer(): PCB_LAYER_ID {
    return this.m_padStack.SecondaryDrill().end;
  }

  SetSecondaryDrillShape(aShape: PAD_DRILL_SHAPE): void {
    this.m_padStack.SecondaryDrill().shape = aShape;
  }
  GetSecondaryDrillShape(): PAD_DRILL_SHAPE {
    return this.m_padStack.SecondaryDrill().shape;
  }

  /** `SetTertiaryDrillSize( const VECTOR2I& )` and `SetTertiaryDrillSize( const std::optional<int>& )`. */
  SetTertiaryDrillSize(aSize: VECTOR2I | number | undefined): void {
    if (typeof aSize === 'object') {
      this.m_padStack.TertiaryDrill().size = { ...aSize };
      return;
    }

    if (aSize !== undefined && aSize > 0) this.SetTertiaryDrillSize({ x: aSize, y: aSize });
    else this.ClearTertiaryDrillSize();
  }

  ClearTertiaryDrillSize(): void {
    this.m_padStack.TertiaryDrill().size = { x: 0, y: 0 };
  }

  GetTertiaryDrillSize(): number | undefined {
    if (this.m_padStack.TertiaryDrill().size.x > 0) return this.m_padStack.TertiaryDrill().size.x;

    return undefined;
  }

  SetTertiaryDrillStartLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.TertiaryDrill().start = aLayer;
  }
  GetTertiaryDrillStartLayer(): PCB_LAYER_ID {
    return this.m_padStack.TertiaryDrill().start;
  }

  SetTertiaryDrillEndLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.TertiaryDrill().end = aLayer;
  }
  GetTertiaryDrillEndLayer(): PCB_LAYER_ID {
    return this.m_padStack.TertiaryDrill().end;
  }

  SetTertiaryDrillShape(aShape: PAD_DRILL_SHAPE): void {
    this.m_padStack.TertiaryDrill().shape = aShape;
  }
  GetTertiaryDrillShape(): PAD_DRILL_SHAPE {
    return this.m_padStack.TertiaryDrill().shape;
  }

  /**
   * Check if the via is a free via (as opposed to one created on a track by the router).
   *
   * Free vias don't have their nets automatically updated by the connectivity algorithm.
   *
   * @return true if the via is a free via
   */
  GetIsFree(): boolean {
    return this.m_isFree;
  }
  SetIsFree(aFree = true): void {
    this.m_isFree = aFree;
  }

  // @copydoc BOARD_ITEM::GetEffectiveShape
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    // Check if this layer has copper removed by backdrill or post-machining
    if (aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER && this.IsBackdrilledOrPostMachined(aLayer)) {
      // Return the larger of the backdrill or post-machining hole
      let holeSize = 0;

      const frontPM = this.Padstack().FrontPostMachining();
      const backPM = this.Padstack().BackPostMachining();

      if (
        frontPM.mode !== PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED &&
        frontPM.mode !== PAD_DRILL_POST_MACHINING_MODE.UNKNOWN
      ) {
        holeSize = Math.max(holeSize, frontPM.size);
      }

      if (
        backPM.mode !== PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED &&
        backPM.mode !== PAD_DRILL_POST_MACHINING_MODE.UNKNOWN
      ) {
        holeSize = Math.max(holeSize, backPM.size);
      }

      const secDrill = this.Padstack().SecondaryDrill();

      if (
        secDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
        secDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER
      )
        holeSize = Math.max(holeSize, secDrill.size.x);

      if (holeSize > 0) return new SHAPE_CIRCLE(this.m_Start, Math.trunc(holeSize / 2));
      else return new SHAPE_CIRCLE(this.m_Start, Math.trunc(this.GetDrillValue() / 2));
    }

    if (
      aFlash === FLASHING.ALWAYS_FLASHED ||
      (aFlash === FLASHING.DEFAULT && this.FlashLayer(aLayer))
    ) {
      let width = 0;

      if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
        this.Padstack().ForEachUniqueLayer((layer: PCB_LAYER_ID) => {
          width = Math.max(width, this.GetWidth(layer));
        });

        width = Math.trunc(width / 2);
      } else {
        const cuLayer = this.m_padStack.EffectiveLayerFor(aLayer);
        width = Math.trunc(this.GetWidth(cuLayer) / 2);
      }

      return new SHAPE_CIRCLE(this.m_Start, width);
    } else {
      return new SHAPE_CIRCLE(this.m_Start, Math.trunc(this.GetDrillValue() / 2));
    }
  }

  ClearZoneLayerOverrides(): void {
    for (const layer of new LAYER_RANGE(
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.B_Cu,
      this.BoardCopperLayerCount(),
    ))
      this.m_zoneLayerOverrides.set(layer, ZONE_LAYER_OVERRIDE.ZLO_NONE);
  }

  GetZoneLayerOverride(aLayer: PCB_LAYER_ID): ZONE_LAYER_OVERRIDE {
    const it = this.m_zoneLayerOverrides.get(aLayer);
    return it !== undefined ? it : ZONE_LAYER_OVERRIDE.ZLO_NONE;
  }

  SetZoneLayerOverride(aLayer: PCB_LAYER_ID, aOverride: ZONE_LAYER_OVERRIDE): void {
    this.m_zoneLayerOverrides.set(aLayer, aOverride);
  }

  override Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_VIA;

    let similarity = 1.0;

    if (this.m_layer !== other.m_layer) similarity *= 0.9;

    if (!equal(this.m_Start, other.m_Start)) similarity *= 0.9;

    if (!equal(this.m_End, other.m_End)) similarity *= 0.9;

    if (!this.m_padStack.equals(other.m_padStack)) similarity *= 0.9;

    if (this.m_viaType !== other.m_viaType) similarity *= 0.9;

    if (!zoneLayerOverridesEqual(this.m_zoneLayerOverrides, other.m_zoneLayerOverrides))
      similarity *= 0.9;

    return similarity;
  }

  /** `operator==( const PCB_VIA& )`. */
  equalsVia(aOther: PCB_VIA): boolean {
    return (
      equal(this.m_Start, aOther.m_Start) &&
      equal(this.m_End, aOther.m_End) &&
      this.m_layer === aOther.m_layer &&
      this.m_padStack.equals(aOther.m_padStack) &&
      this.m_viaType === aOther.m_viaType &&
      zoneLayerOverridesEqual(this.m_zoneLayerOverrides, aOther.m_zoneLayerOverrides)
    );
  }

  /** `operator==( const BOARD_ITEM& )`. */
  override equals(aBoardItem: BOARD_ITEM): boolean {
    if (aBoardItem.Type() !== this.Type()) return false;

    const other = aBoardItem as PCB_VIA;

    return this.equalsVia(other);
  }

  /** `operator==( const PCB_TRACK& )`. */
  override equalsTrack(aOther: PCB_TRACK): boolean {
    if (aOther.Type() !== this.Type()) return false;

    const other = aOther as PCB_VIA;

    return this.equalsVia(other);
  }

  override LayerMaskDescribe(): string {
    const board = this.GetBoard()!;

    const [top_layer, bottom_layer] = this.LayerPair();

    return `${board.GetLayerName(top_layer)} - ${board.GetLayerName(bottom_layer)}`;
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_VIA_T);

    const image = aImage as PCB_VIA;
    const mine = PCB_VIA.copyOfVia(this);

    // std::swap moves every member, the ones operator= leaves alone included
    this.assignVia(image);
    this.assignTrackMembersFrom(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    this.m_zoneLayerOverrides = new Map(image.m_zoneLayerOverrides);

    image.assignVia(mine);
    image.assignTrackMembersFrom(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
    image.m_zoneLayerOverrides = new Map(mine.m_zoneLayerOverrides);
  }

  /** The PCB_TRACK members `PCB_VIA::operator=` leaves alone but `std::swap` moves. */
  private assignTrackMembersFrom(aOther: PCB_VIA): void {
    this.m_hasSolderMask = aOther.m_hasSolderMask;
    this.m_solderMaskMargin = aOther.m_solderMaskMargin;
    PCB_TRACK.prototype.SetWidth.call(this, PCB_TRACK.prototype.GetWidth.call(aOther));
  }
}

/**
 * `static struct TRACK_VIA_DESC` (pcbnew/pcb_track.cpp).
 */
(() => {
  // clang-format off: the suggestion is less readable
  ENUM_MAP.Instance<VIATYPE>('VIATYPE')
    .Undefined(VIATYPE.NOT_DEFINED)
    .Map(VIATYPE.THROUGH, 'Through')
    .Map(VIATYPE.BLIND, 'Blind')
    .Map(VIATYPE.BURIED, 'Buried')
    .Map(VIATYPE.MICROVIA, 'Micro');

  ENUM_MAP.Instance<TENTING_MODE>('TENTING_MODE')
    .Undefined(TENTING_MODE.FROM_BOARD)
    .Map(TENTING_MODE.FROM_BOARD, 'From board stackup')
    .Map(TENTING_MODE.TENTED, 'Tented')
    .Map(TENTING_MODE.NOT_TENTED, 'Not tented');

  ENUM_MAP.Instance<COVERING_MODE>('COVERING_MODE')
    .Undefined(COVERING_MODE.FROM_BOARD)
    .Map(COVERING_MODE.FROM_BOARD, 'From board stackup')
    .Map(COVERING_MODE.COVERED, 'Covered')
    .Map(COVERING_MODE.NOT_COVERED, 'Not covered');

  ENUM_MAP.Instance<PLUGGING_MODE>('PLUGGING_MODE')
    .Undefined(PLUGGING_MODE.FROM_BOARD)
    .Map(PLUGGING_MODE.FROM_BOARD, 'From board stackup')
    .Map(PLUGGING_MODE.PLUGGED, 'Plugged')
    .Map(PLUGGING_MODE.NOT_PLUGGED, 'Not plugged');

  ENUM_MAP.Instance<CAPPING_MODE>('CAPPING_MODE')
    .Undefined(CAPPING_MODE.FROM_BOARD)
    .Map(CAPPING_MODE.FROM_BOARD, 'From board stackup')
    .Map(CAPPING_MODE.CAPPED, 'Capped')
    .Map(CAPPING_MODE.NOT_CAPPED, 'Not capped');

  ENUM_MAP.Instance<FILLING_MODE>('FILLING_MODE')
    .Undefined(FILLING_MODE.FROM_BOARD)
    .Map(FILLING_MODE.FROM_BOARD, 'From board stackup')
    .Map(FILLING_MODE.FILLED, 'Filled')
    .Map(FILLING_MODE.NOT_FILLED, 'Not filled');

  // clang-format on: the suggestion is less readable

  const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');

  if (layerEnum.Choices().GetCount() === 0) {
    layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

    for (const layer of LSET.AllLayersMask().Seq()) layerEnum.Map(layer, LSET.Name(layer));
  }

  const viaDiameterPropertyValidator = (
    aValue: unknown,
    aItem: INSPECTABLE_ITEM | null,
  ): VALIDATOR_RESULT => {
    if (!(aItem instanceof PCB_VIA)) return null;

    if (typeof aValue !== 'number') return null;

    const via = aItem;

    const diameter: number | undefined = aValue;
    const drill: number | undefined = via.GetDrillValue();

    let startLayer: PCB_LAYER_ID | undefined;

    if (via.Padstack().Drill().start !== PCB_LAYER_ID.UNDEFINED_LAYER)
      startLayer = via.Padstack().Drill().start;

    let endLayer: PCB_LAYER_ID | undefined;

    if (via.Padstack().Drill().end !== PCB_LAYER_ID.UNDEFINED_LAYER)
      endLayer = via.Padstack().Drill().end;

    const copperLayerCount = via.BoardCopperLayerCount();

    const error = PCB_VIA.ValidateViaParameters(
      diameter,
      drill,
      startLayer,
      endLayer,
      undefined,
      undefined,
      undefined, // secondary drill
      undefined,
      undefined,
      undefined, // tertiary drill
      copperLayerCount,
    );

    if (error) return new VALIDATION_ERROR_MSG(error.m_Message);

    return null;
  };

  const viaDrillPropertyValidator = (
    aValue: unknown,
    aItem: INSPECTABLE_ITEM | null,
  ): VALIDATOR_RESULT => {
    if (!(aItem instanceof PCB_VIA)) return null;

    if (typeof aValue !== 'number') return null;

    const via = aItem;

    const diameter: number | undefined = via.GetFrontWidth();
    const drill: number | undefined = aValue;

    let startLayer: PCB_LAYER_ID | undefined;

    if (via.Padstack().Drill().start !== PCB_LAYER_ID.UNDEFINED_LAYER)
      startLayer = via.Padstack().Drill().start;

    let endLayer: PCB_LAYER_ID | undefined;

    if (via.Padstack().Drill().end !== PCB_LAYER_ID.UNDEFINED_LAYER)
      endLayer = via.Padstack().Drill().end;

    const secondaryDrill: number | undefined = via.GetSecondaryDrillSize();

    let secondaryStart: PCB_LAYER_ID | undefined;

    if (via.GetSecondaryDrillStartLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER)
      secondaryStart = via.GetSecondaryDrillStartLayer();

    let secondaryEnd: PCB_LAYER_ID | undefined;

    if (via.GetSecondaryDrillEndLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER)
      secondaryEnd = via.GetSecondaryDrillEndLayer();

    const tertiaryDrill: number | undefined = via.GetTertiaryDrillSize();

    let tertiaryStart: PCB_LAYER_ID | undefined;

    if (via.GetTertiaryDrillStartLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER)
      tertiaryStart = via.GetTertiaryDrillStartLayer();

    let tertiaryEnd: PCB_LAYER_ID | undefined;

    if (via.GetTertiaryDrillEndLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER)
      tertiaryEnd = via.GetTertiaryDrillEndLayer();

    const copperLayerCount = via.BoardCopperLayerCount();

    const error = PCB_VIA.ValidateViaParameters(
      diameter,
      drill,
      startLayer,
      endLayer,
      secondaryDrill,
      secondaryStart,
      secondaryEnd,
      tertiaryDrill,
      tertiaryStart,
      tertiaryEnd,
      copperLayerCount,
    );

    if (error) return new VALIDATION_ERROR_MSG(error.m_Message);

    return null;
  };

  const viaStartLayerPropertyValidator = (
    aValue: unknown,
    aItem: INSPECTABLE_ITEM | null,
  ): VALIDATOR_RESULT => {
    if (!(aItem instanceof PCB_VIA)) return null;

    let layer: PCB_LAYER_ID;

    if (typeof aValue === 'number') layer = aValue as PCB_LAYER_ID;
    else return null;

    const via = aItem;

    const diameter: number | undefined = via.GetFrontWidth();
    const drill: number | undefined = via.GetDrillValue();

    let endLayer: PCB_LAYER_ID | undefined;

    if (via.BottomLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER) endLayer = via.BottomLayer();

    const secondaryDrill: number | undefined = via.GetSecondaryDrillSize();

    let secondaryStart: PCB_LAYER_ID | undefined;

    if (via.GetSecondaryDrillStartLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER)
      secondaryStart = via.GetSecondaryDrillStartLayer();

    let secondaryEnd: PCB_LAYER_ID | undefined;

    if (via.GetSecondaryDrillEndLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER)
      secondaryEnd = via.GetSecondaryDrillEndLayer();

    const copperLayerCount = via.BoardCopperLayerCount();

    const error = PCB_VIA.ValidateViaParameters(
      diameter,
      drill,
      layer,
      endLayer,
      secondaryDrill,
      secondaryStart,
      secondaryEnd,
      undefined,
      undefined,
      undefined, // tertiary drill
      copperLayerCount,
    );

    if (error) return new VALIDATION_ERROR_MSG(error.m_Message);

    return null;
  };

  const viaEndLayerPropertyValidator = (
    aValue: unknown,
    aItem: INSPECTABLE_ITEM | null,
  ): VALIDATOR_RESULT => {
    if (!(aItem instanceof PCB_VIA)) return null;

    let layer: PCB_LAYER_ID;

    if (typeof aValue === 'number') layer = aValue as PCB_LAYER_ID;
    else return null;

    const via = aItem;

    const diameter: number | undefined = via.GetFrontWidth();
    const drill: number | undefined = via.GetDrillValue();

    let startLayer: PCB_LAYER_ID | undefined;

    if (via.TopLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER) startLayer = via.TopLayer();

    const secondaryDrill: number | undefined = via.GetSecondaryDrillSize();

    let secondaryStart: PCB_LAYER_ID | undefined;

    if (via.GetSecondaryDrillStartLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER)
      secondaryStart = via.GetSecondaryDrillStartLayer();

    let secondaryEnd: PCB_LAYER_ID | undefined;

    if (via.GetSecondaryDrillEndLayer() !== PCB_LAYER_ID.UNDEFINED_LAYER)
      secondaryEnd = via.GetSecondaryDrillEndLayer();

    const copperLayerCount = via.BoardCopperLayerCount();

    const error = PCB_VIA.ValidateViaParameters(
      diameter,
      drill,
      startLayer,
      layer,
      secondaryDrill,
      secondaryStart,
      secondaryEnd,
      undefined,
      undefined,
      undefined, // tertiary drill
      copperLayerCount,
    );

    if (error) return new VALIDATION_ERROR_MSG(error.m_Message);

    return null;
  };

  const propMgr = PROPERTY_MANAGER.Instance();

  // Track
  REGISTER_TYPE(PCB_TRACK);
  propMgr.InheritsAfter(PCB_TRACK, BOARD_CONNECTED_ITEM);

  propMgr.AddProperty(
    new PROPERTY<PCB_TRACK, number>(
      PCB_TRACK,
      'Width',
      'SetWidth',
      'GetWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
  );
  propMgr.ReplaceProperty(
    BOARD_ITEM,
    'Position X',
    new PROPERTY<PCB_TRACK, number>(
      PCB_TRACK,
      'Start X',
      'SetStartX',
      'GetStartX',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_X_COORD,
    ),
  );
  propMgr.ReplaceProperty(
    BOARD_ITEM,
    'Position Y',
    new PROPERTY<PCB_TRACK, number>(
      PCB_TRACK,
      'Start Y',
      'SetStartY',
      'GetStartY',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_Y_COORD,
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<PCB_TRACK, number>(
      PCB_TRACK,
      'End X',
      'SetEndX',
      'GetEndX',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_X_COORD,
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<PCB_TRACK, number>(
      PCB_TRACK,
      'End Y',
      'SetEndY',
      'GetEndY',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_Y_COORD,
    ),
  );

  const groupTechLayers = 'Technical Layers';

  const isExternalLayerTrack = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PCB_TRACK) return IsExternalCopperLayer(aItem.GetLayer());

    return false;
  };

  propMgr
    .AddProperty(
      new PROPERTY<PCB_TRACK, boolean>(
        PCB_TRACK,
        'Soldermask',
        'SetHasSolderMask',
        'HasSolderMask',
        TYPE_BOOL,
      ),
      groupTechLayers,
    )
    .SetAvailableFunc(isExternalLayerTrack);
  propMgr
    .AddProperty(
      new PROPERTY<PCB_TRACK, number | undefined>(
        PCB_TRACK,
        'Soldermask Margin Override',
        'SetLocalSolderMaskMargin',
        'GetLocalSolderMaskMargin',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupTechLayers,
    )
    .SetAvailableFunc(isExternalLayerTrack);

  // Arc
  REGISTER_TYPE(PCB_ARC);
  propMgr.InheritsAfter(PCB_ARC, PCB_TRACK);

  // Via
  REGISTER_TYPE(PCB_VIA);
  propMgr.InheritsAfter(PCB_VIA, BOARD_CONNECTED_ITEM);

  // TODO test drill, use getdrillvalue?
  const groupVia = 'Via Properties';
  const groupBackdrill = 'Backdrill';
  const groupPostMachining = 'Post-machining';

  propMgr.Mask(PCB_VIA, BOARD_CONNECTED_ITEM, 'Layer');

  // clang-format off: the suggestion is less readable
  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number>(
        PCB_VIA,
        'Diameter',
        'SetFrontWidth',
        'GetFrontWidth',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupVia,
    )
    .SetValidator(viaDiameterPropertyValidator);
  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number>(
        PCB_VIA,
        'Hole',
        'SetDrill',
        'GetDrillValue',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupVia,
    )
    .SetValidator(viaDrillPropertyValidator);
  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_VIA, PCB_LAYER_ID>(
        PCB_VIA,
        'Layer Top',
        'SetTopLayer',
        'GetLayer',
        layerEnum,
      ),
      groupVia,
    )
    .SetValidator(viaStartLayerPropertyValidator);
  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_VIA, PCB_LAYER_ID>(
        PCB_VIA,
        'Layer Bottom',
        'SetBottomLayer',
        'BottomLayer',
        layerEnum,
      ),
      groupVia,
    )
    .SetValidator(viaEndLayerPropertyValidator);
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, VIATYPE>(
      PCB_VIA,
      'Via Type',
      'SetViaType',
      'GetViaType',
      ENUM_MAP.Instance<VIATYPE>('VIATYPE'),
    ),
    groupVia,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, TENTING_MODE>(
      PCB_VIA,
      'Front tenting',
      'SetFrontTentingMode',
      'GetFrontTentingMode',
      ENUM_MAP.Instance<TENTING_MODE>('TENTING_MODE'),
    ),
    groupVia,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, TENTING_MODE>(
      PCB_VIA,
      'Back tenting',
      'SetBackTentingMode',
      'GetBackTentingMode',
      ENUM_MAP.Instance<TENTING_MODE>('TENTING_MODE'),
    ),
    groupVia,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, COVERING_MODE>(
      PCB_VIA,
      'Front covering',
      'SetFrontCoveringMode',
      'GetFrontCoveringMode',
      ENUM_MAP.Instance<COVERING_MODE>('COVERING_MODE'),
    ),
    groupVia,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, COVERING_MODE>(
      PCB_VIA,
      'Back covering',
      'SetBackCoveringMode',
      'GetBackCoveringMode',
      ENUM_MAP.Instance<COVERING_MODE>('COVERING_MODE'),
    ),
    groupVia,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, PLUGGING_MODE>(
      PCB_VIA,
      'Front plugging',
      'SetFrontPluggingMode',
      'GetFrontPluggingMode',
      ENUM_MAP.Instance<PLUGGING_MODE>('PLUGGING_MODE'),
    ),
    groupVia,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, PLUGGING_MODE>(
      PCB_VIA,
      'Back plugging',
      'SetBackPluggingMode',
      'GetBackPluggingMode',
      ENUM_MAP.Instance<PLUGGING_MODE>('PLUGGING_MODE'),
    ),
    groupVia,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, CAPPING_MODE>(
      PCB_VIA,
      'Capping',
      'SetCappingMode',
      'GetCappingMode',
      ENUM_MAP.Instance<CAPPING_MODE>('CAPPING_MODE'),
    ),
    groupVia,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, FILLING_MODE>(
      PCB_VIA,
      'Filling',
      'SetFillingMode',
      'GetFillingMode',
      ENUM_MAP.Instance<FILLING_MODE>('FILLING_MODE'),
    ),
    groupVia,
  );

  const canHaveBackdrill = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PCB_VIA) {
      if (aItem.GetViaType() === VIATYPE.THROUGH) return true;

      if (aItem.Padstack().GetBackdrillMode() !== BACKDRILL_MODE.NO_BACKDRILL) return true;
    }

    return false;
  };

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_VIA, BACKDRILL_MODE>(
        PCB_VIA,
        'Backdrill Mode',
        'SetBackdrillMode',
        'GetBackdrillMode',
        ENUM_MAP.Instance<BACKDRILL_MODE>('BACKDRILL_MODE'),
      ),
      groupBackdrill,
    )
    .SetAvailableFunc(canHaveBackdrill);

  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number | undefined>(
        PCB_VIA,
        'Bottom Backdrill Size',
        'SetBottomBackdrillSize',
        'GetBottomBackdrillSize',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupBackdrill,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetBackdrillMode();
        return mode === BACKDRILL_MODE.BACKDRILL_BOTTOM || mode === BACKDRILL_MODE.BACKDRILL_BOTH;
      }
      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_VIA, PCB_LAYER_ID>(
        PCB_VIA,
        'Bottom Backdrill Must-Cut',
        'SetBottomBackdrillLayer',
        'GetBottomBackdrillLayer',
        layerEnum,
      ),
      groupBackdrill,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetBackdrillMode();
        return mode === BACKDRILL_MODE.BACKDRILL_BOTTOM || mode === BACKDRILL_MODE.BACKDRILL_BOTH;
      }
      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number | undefined>(
        PCB_VIA,
        'Top Backdrill Size',
        'SetTopBackdrillSize',
        'GetTopBackdrillSize',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupBackdrill,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetBackdrillMode();
        return mode === BACKDRILL_MODE.BACKDRILL_TOP || mode === BACKDRILL_MODE.BACKDRILL_BOTH;
      }
      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PCB_VIA, PCB_LAYER_ID>(
        PCB_VIA,
        'Top Backdrill Must-Cut',
        'SetTopBackdrillLayer',
        'GetTopBackdrillLayer',
        layerEnum,
      ),
      groupBackdrill,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetBackdrillMode();
        return mode === BACKDRILL_MODE.BACKDRILL_TOP || mode === BACKDRILL_MODE.BACKDRILL_BOTH;
      }
      return false;
    });

  const pmEnum = ENUM_MAP.Instance<PAD_DRILL_POST_MACHINING_MODE>('PAD_DRILL_POST_MACHINING_MODE');

  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, PAD_DRILL_POST_MACHINING_MODE>(
      PCB_VIA,
      'Front Post-machining',
      'SetFrontPostMachiningMode',
      'GetFrontPostMachiningMode',
      pmEnum,
    ),
    groupPostMachining,
  );

  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number>(
        PCB_VIA,
        'Front Post-machining Size',
        'SetFrontPostMachiningSize',
        'GetFrontPostMachiningSize',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPostMachining,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetFrontPostMachining();
        return (
          mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE ||
          mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK
        );
      }
      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number>(
        PCB_VIA,
        'Front Post-machining Depth',
        'SetFrontPostMachiningDepth',
        'GetFrontPostMachiningDepth',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPostMachining,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetFrontPostMachining();
        return mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE;
      }
      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number>(
        PCB_VIA,
        'Front Post-machining Angle',
        'SetFrontPostMachiningAngle',
        'GetFrontPostMachiningAngle',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_DECIDEGREE,
      ),
      groupPostMachining,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetFrontPostMachining();
        return mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;
      }
      return false;
    });

  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_VIA, PAD_DRILL_POST_MACHINING_MODE>(
      PCB_VIA,
      'Back Post-machining',
      'SetBackPostMachiningMode',
      'GetBackPostMachiningMode',
      pmEnum,
    ),
    groupPostMachining,
  );

  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number>(
        PCB_VIA,
        'Back Post-machining Size',
        'SetBackPostMachiningSize',
        'GetBackPostMachiningSize',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPostMachining,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetBackPostMachining();
        return (
          mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE ||
          mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK
        );
      }
      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number>(
        PCB_VIA,
        'Back Post-machining Depth',
        'SetBackPostMachiningDepth',
        'GetBackPostMachiningDepth',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPostMachining,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetBackPostMachining();
        return mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE;
      }
      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PCB_VIA, number>(
        PCB_VIA,
        'Back Post-machining Angle',
        'SetBackPostMachiningAngle',
        'GetBackPostMachiningAngle',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_DECIDEGREE,
      ),
      groupPostMachining,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PCB_VIA) {
        const mode = aItem.GetBackPostMachining();
        return mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;
      }
      return false;
    });
  // clang-format on: the suggestion is less readable
})();
