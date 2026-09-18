// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pad.h` / `pad.cpp`: `PAD`, a footprint pad over a `PADSTACK`.
 *
 * Not here: `Serialize`/`Deserialize` (the protobuf API), `parsePinType`
 * (only they use it) and the `PAD_DESC` property registration. The DRC engine,
 * the connectivity data, the board stackup's `GetLayerDistance`, the
 * `PCBNEW_SETTINGS` display flags and `BOARD::GetMaxClearanceValue` are not
 * on BOARD yet (#636); each such branch is left in place as a comment with
 * the answer the C++ gives without them.
 */

import {
  FOOTPRINT_EDIT_FRAME_NAME,
  PCB_EDIT_FRAME_NAME,
} from '@ziroeda/common/src/eda_draw_frame.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/src/eda_item.js';
import { IGNORE_PARENT_GROUP } from '@ziroeda/common/src/eda_item.js';
import { ENTERED, ROUTER_TRANSIENT, SKIP_STRUCT } from '@ziroeda/common/src/eda_item_flags.js';
import { type EDA_SHAPE, FILL_T, SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { OutStr } from '@ziroeda/common/src/font/font.js';
import {
  FLASHING,
  GAL_LAYER_ID,
  IsBackLayer,
  IsCopperLayer,
  IsExternalCopperLayer,
  IsFrontLayer,
  IsHoleLayer,
  IsNetnameLayer,
  NETNAMES_LAYER_ID,
  PCB_LAYER_ID,
} from '@ziroeda/common/src/layer_ids.js';
import { LAYER_RANGE } from '@ziroeda/common/src/layer_range.js';
import { ELECTRICAL_PINTYPES } from '@ziroeda/common/src/pin_type.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_DOUBLE,
  TYPE_INT,
  TYPE_OPT_DOUBLE,
  TYPE_OPT_INT,
  TYPE_STRING,
  TYPE_CAST,
} from '@ziroeda/common/src/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/src/properties/property_mgr.js';
import { PROPERTY_VALIDATORS } from '@ziroeda/common/src/properties/property_validators.js';
import { INT_MAX } from '@ziroeda/kimath/src/math/util.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { formatG, unescapeString } from '@ziroeda/common/src/string_utils.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/src/stroke_params.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import { FLIP_DIRECTION, MIRROR } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import {
  ERROR_LOC,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
  RECT_NO_CHAMFER,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_NULL } from '@ziroeda/kimath/src/geometry/shape_null.js';
import {
  CornerStrategy,
  SHAPE_POLY_SET,
  TransformCircleToPolygon,
  TransformOvalToPolygon,
  TransformRoundChamferedRectToPolygon,
  TransformTrapezoidToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { type VECTOR2I, add, equal, sub } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { BOARD_ITEM, ZONE_LAYER_OVERRIDE } from './board_item.js';
import { BOARD_USE } from './board_types.js';
import { DRCE_PAD_TH_WITH_NO_HOLE, DRCE_PADSTACK, DRCE_PADSTACK_INVALID } from './drc/drc_item.js';
import { NETINFO_LIST } from './netinfo.js';
import {
  BACKDRILL_MODE,
  type CUSTOM_SHAPE_ZONE_MODE,
  PAD_ATTRIB,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_DRILL_SHAPE,
  PAD_PROP,
  PAD_SHAPE,
  PADSTACK,
  PADSTACK_MODE,
  UNCONNECTED_LAYER_MODE,
} from './padstack.js';
import { GetDefaultIpcRoundingRatio, PadHasMeaningfulRoundingRadius } from './pad_utils.js';
import { PCB_SHAPE, type PCB_VIEW_FOR_LOD } from './pcb_shape.js';
import type { DRC_ENGINE } from './drc/drc_engine.js';
import { type DRC_CONSTRAINT, DRC_CONSTRAINT_T } from './drc/drc_rule.js';
import { ZONE_CONNECTION, ZONE_THICKNESS_MIN_VALUE_MM } from './zones.js';
import type { FOOTPRINT } from './footprint.js';

export { PAD_ATTRIB, PAD_PROP, PAD_SHAPE } from './padstack.js';

/** The message-panel frame's units, as `PCB_SHAPE` reads them. */
type MSG_PANEL_FRAME = EDA_DRAW_FRAME_LIKE & UNITS_PROVIDER;

/** `PAD::PAD_DRAW_CACHE_DATA`. */
class PAD_DRAW_CACHE_DATA {
  // Must be set to true to force rebuild shapes to draw (after geometry change for instance)
  m_effectiveBoundingBox = new BOX2I();
  m_effectiveShapes = new Map<PCB_LAYER_ID, SHAPE_COMPOUND>();
  m_effectiveHoleShape: SHAPE_SEGMENT | null = null;
  m_effectivePolygons = new Map<PCB_LAYER_ID, [SHAPE_POLY_SET | null, SHAPE_POLY_SET | null]>();
  m_lastGalZoomLevel = 0.0;
}

export type PAD_ERROR_HANDLER = (aErrorCode: number, aMsg: string) => void;

export class PAD extends BOARD_CONNECTED_ITEM {
  private m_number: string; // Pad name (pin number in schematic)
  private m_pinFunction: string; // Pin name in schematic
  private m_pinType: string; // Pin electrical type in schematic

  private m_pos: VECTOR2I; // Pad Position on board

  private m_padStack: PADSTACK;

  private m_drawCache: PAD_DRAW_CACHE_DATA | null = null;
  private m_effectiveBoundingRadius: number;

  private m_subRatsnest: number; // Variable used to handle subnet (block) number in
  //   ratsnest computations

  private m_attribute: PAD_ATTRIB = PAD_ATTRIB.PTH;
  private m_property: PAD_PROP; // Property in fab files (BGA, FIDUCIAL, TESTPOINT, etc.)

  private m_lengthPadToDie: number; // Length net from pad to die, inside the package
  private m_delayPadToDie: number; // Propagation delay from pad to die

  // Bools at the end for better memory layout
  private m_polyDirty: [boolean, boolean];
  private m_shapesDirty: boolean;

  private m_zoneLayerOverrides: Map<PCB_LAYER_ID, ZONE_LAYER_OVERRIDE>;

  constructor(parent: BOARD_ITEM | null) {
    super(parent, KICAD_T.PCB_PAD_T);
    this.m_padStack = new PADSTACK(this);
    this.m_number = '';
    this.m_pinFunction = '';
    this.m_pinType = '';
    this.m_pos = { x: 0, y: 0 };
    this.m_subRatsnest = 0;
    this.m_property = PAD_PROP.NONE;
    this.m_lengthPadToDie = 0;
    this.m_delayPadToDie = 0;
    this.m_polyDirty = [false, false];
    this.m_shapesDirty = false;
    this.m_zoneLayerOverrides = new Map();
    this.m_effectiveBoundingRadius = 0;

    const drill = this.m_padStack.Drill().size;
    this.m_padStack.SetSize(
      { x: pcbIUScale.milsToIU(60), y: pcbIUScale.milsToIU(60) },
      PADSTACK.ALL_LAYERS,
    );
    drill.x = drill.y = pcbIUScale.milsToIU(30); // Default drill size 30 mils.

    this.m_lengthPadToDie = 0;
    this.m_delayPadToDie = 0;

    if (this.m_parent && this.m_parent.Type() === KICAD_T.PCB_FOOTPRINT_T)
      this.m_pos = { ...(this.GetParent() as FOOTPRINT).GetPosition() };

    this.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.CIRCLE); // Default pad shape is PAD_CIRCLE.
    this.SetAnchorPadShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.CIRCLE); // Default anchor shape for custom shaped pads is PAD_CIRCLE.
    this.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE); // Default pad drill shape is a circle.
    this.m_attribute = PAD_ATTRIB.PTH; // Default pad type is plated through hole
    this.SetProperty(PAD_PROP.NONE); // no special fabrication property

    // Parameters for round rect only:
    this.m_padStack.SetRoundRectRadiusRatio(0.25, PCB_LAYER_ID.F_Cu); // from IPC-7351C standard

    // Parameters for chamfered rect only:
    this.m_padStack.SetChamferRatio(0.2, PCB_LAYER_ID.F_Cu);
    this.m_padStack.SetChamferPositions(RECT_NO_CHAMFER, PCB_LAYER_ID.F_Cu);

    // Set layers mask to default for a standard thru hole pad.
    this.m_padStack.SetLayerSet(PAD.PTHMask());

    this.SetSubRatsnest(0); // used in ratsnest calculations

    this.SetDirty();
    this.m_effectiveBoundingRadius = 0;

    for (const layer of new LAYER_RANGE(
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.B_Cu,
      this.BoardCopperLayerCount(),
    ))
      this.m_zoneLayerOverrides.set(layer, ZONE_LAYER_OVERRIDE.ZLO_NONE);
  }

  // Copy constructor & operator= are needed because the list of basic shapes
  // must be duplicated in copy.

  /** `PAD( const PAD& aPad )`. */
  static copyOfPad(aOther: PAD): PAD {
    const copy = new PAD(aOther.GetParent() as BOARD_ITEM | null);
    copy.assignPad(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** `operator=( const PAD& aOther )`. */
  assignPad(aOther: PAD): this {
    this.assignConnected(aOther);

    this.ImportSettingsFrom(aOther);
    this.SetPadToDieLength(aOther.GetPadToDieLength());
    this.SetPadToDieDelay(aOther.GetPadToDieDelay());
    this.SetPosition(aOther.GetPosition());
    this.SetNumber(aOther.GetNumber());
    this.SetPinType(aOther.GetPinType());
    this.SetPinFunction(aOther.GetPinFunction());
    this.SetSubRatsnest(aOther.GetSubRatsnest());
    this.m_effectiveBoundingRadius = aOther.m_effectiveBoundingRadius;

    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_PAD_T)) return; // wxCHECK

    this.assignPad(aOther as PAD);
  }

  /*
   * Default layers used for pads, according to the pad type.
   *
   * This is default values only, they can be changed for a given pad.
   */
  static PTHMask(): LSET {
    ///< layer set for a through hole pad
    return LSET.AllCuMask().or(new LSET([PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask]));
  }

  static SMDMask(): LSET {
    ///< layer set for a SMD pad on Front layer
    return new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.F_Mask]);
  }

  static ConnSMDMask(): LSET {
    ///< layer set for a SMD pad on Front layer used for edge board connectors
    return new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Mask]);
  }

  static UnplatedHoleMask(): LSET {
    ///< layer set for a mechanical unplated through hole pad
    return new LSET([
      PCB_LAYER_ID.F_Cu,
      PCB_LAYER_ID.B_Cu,
      PCB_LAYER_ID.F_Mask,
      PCB_LAYER_ID.B_Mask,
    ]);
  }

  static ApertureMask(): LSET {
    ///< layer set for an aperture pad
    return new LSET([PCB_LAYER_ID.F_Paste]);
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && KICAD_T.PCB_PAD_T === aItem.Type();
  }

  override IsType(aScanTypes: readonly KICAD_T[]): boolean {
    if (super.IsType(aScanTypes)) return true;

    for (const scanType of aScanTypes) {
      if (this.HasHole()) {
        if (scanType === KICAD_T.PCB_LOCATE_HOLE_T) return true;
        else if (scanType === KICAD_T.PCB_LOCATE_PTH_T && this.m_attribute !== PAD_ATTRIB.NPTH)
          return true;
        else if (scanType === KICAD_T.PCB_LOCATE_NPTH_T && this.m_attribute === PAD_ATTRIB.NPTH)
          return true;
      }
    }

    return false;
  }

  override HasHole(): boolean {
    return this.GetDrillSizeX() > 0 && this.GetDrillSizeY() > 0;
  }

  override HasDrilledHole(): boolean {
    return this.HasHole() && this.GetDrillSizeX() === this.GetDrillSizeY();
  }

  override IsLocked(): boolean {
    if (this.GetParent() && this.GetParent()!.IsLocked()) return true;

    return BOARD_ITEM.prototype.IsLocked.call(this);
  }

  /**
   * Import the pad settings from \a aMasterPad.
   *
   * The result is "this" has the same settings (sizes, shapes ... ) as \a aMasterPad.
   *
   * @param aMasterPad the template pad.
   */
  ImportSettingsFrom(aMasterPad: PAD): void {
    this.SetPadstack(aMasterPad.Padstack());

    // Layer Set should be updated before calling SetAttribute()
    this.SetLayerSet(aMasterPad.GetLayerSet());
    this.SetAttribute(aMasterPad.GetAttribute());
    // Unfortunately, SetAttribute() can change m_layerMask.
    // Be sure we keep the original mask by calling SetLayerSet() after SetAttribute()
    this.SetLayerSet(aMasterPad.GetLayerSet());
    this.SetProperty(aMasterPad.GetProperty());

    // Must be after setting attribute and layerSet
    if (!this.CanHaveNumber()) this.SetNumber('');

    // I am not sure the m_LengthPadToDie should be imported, because this is a parameter
    // really specific to a given pad (JPC).
    // #if 0
    // SetPadToDieLength( aMasterPad.GetPadToDieLength() );
    // SetPadToDieDelay( aMasterPad.GetPadToDieDelay() );
    // #endif

    // The pad orientation, for historical reasons is the pad rotation + parent rotation.
    let pad_rot = aMasterPad.GetOrientation();

    if (aMasterPad.GetParentFootprint())
      pad_rot = pad_rot.sub((aMasterPad.GetParentFootprint() as FOOTPRINT).GetOrientation());

    if (this.GetParentFootprint())
      pad_rot = pad_rot.add((this.GetParentFootprint() as FOOTPRINT).GetOrientation());

    this.SetOrientation(pad_rot);

    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      // Ensure that circles are circles
      if (aMasterPad.GetShape(aLayer) === PAD_SHAPE.CIRCLE)
        this.SetSize(aLayer, { x: this.GetSize(aLayer).x, y: this.GetSize(aLayer).x });
    });

    switch (aMasterPad.GetAttribute()) {
      case PAD_ATTRIB.SMD:
      case PAD_ATTRIB.CONN:
        // These pads do not have a hole (they are expected to be on one external copper layer)
        this.SetDrillSize({ x: 0, y: 0 });
        break;

      default:
    }

    // copy also local settings:
    this.SetLocalClearance(aMasterPad.GetLocalClearance());
    this.SetLocalSolderMaskMargin(aMasterPad.GetLocalSolderMaskMargin());
    this.SetLocalSolderPasteMargin(aMasterPad.GetLocalSolderPasteMargin());
    this.SetLocalSolderPasteMarginRatio(aMasterPad.GetLocalSolderPasteMarginRatio());

    this.SetLocalZoneConnection(aMasterPad.GetLocalZoneConnection());
    this.SetLocalThermalSpokeWidthOverride(aMasterPad.GetLocalThermalSpokeWidthOverride());
    this.SetThermalSpokeAngle(aMasterPad.GetThermalSpokeAngle());
    this.SetLocalThermalGapOverride(aMasterPad.GetLocalThermalGapOverride());

    this.SetCustomShapeInZoneOpt(aMasterPad.GetCustomShapeInZoneOpt());

    this.m_teardropParams = aMasterPad.m_teardropParams.clone();

    this.SetDirty();
  }

  /**
   * @return true if the pad has a footprint parent flipped on the back/bottom layer.
   */
  IsFlipped(): boolean {
    const parent = this.GetParentFootprint() as FOOTPRINT | null;
    return !!parent && parent.GetLayer() === PCB_LAYER_ID.B_Cu;
  }

  /**
   * Set the pad number (note that it can be alphanumeric, such as the array reference "AA12").
   */
  SetNumber(aNumber: string): void {
    this.m_number = aNumber;
  }
  GetNumber(): string {
    return this.m_number;
  }

  /**
   * Indicates whether or not the pad can have a number.  (NPTH and SMD aperture pads can not.)
   */
  CanHaveNumber(): boolean {
    // Aperture pads don't get a number
    if (this.IsAperturePad()) return false;

    // NPTH pads don't get numbers
    if (this.GetAttribute() === PAD_ATTRIB.NPTH) return false;

    return true;
  }

  /**
   * Set the pad function (pin name in schematic)
   */
  SetPinFunction(aName: string): void {
    this.m_pinFunction = aName;
  }
  GetPinFunction(): string {
    return this.m_pinFunction;
  }

  /**
   * Set the pad electrical type
   */
  SetPinType(aType: string): void {
    this.m_pinType = aType;
  }
  GetPinType(): string {
    return this.m_pinType;
  }

  /**
   * Before we had custom pad shapes it was common to have multiple overlapping pads to
   * represent a more complex shape.
   */
  SameLogicalPadAs(aOther: PAD): boolean {
    // hide tricks behind sensible API
    return (
      this.GetParentFootprint() === aOther.GetParentFootprint() &&
      this.m_number !== '' &&
      this.m_number === aOther.m_number
    );
  }

  /**
   * @return true if this and \param aOther represent a net-tie.
   */
  SharesNetTieGroup(aOther: PAD): boolean {
    const parentFp = this.GetParentFootprint() as FOOTPRINT | null;

    if (parentFp && parentFp.IsNetTie() && aOther.GetParentFootprint() === parentFp) {
      const padToNetTieGroupMap = parentFp.MapPadNumbersToNetTieGroups();
      const thisNetTieGroup = padToNetTieGroupMap.get(this.GetNumber()) ?? 0; // operator[] default-inserts 0
      const otherNetTieGroup = padToNetTieGroupMap.get(aOther.GetNumber()) ?? 0;

      return thisNetTieGroup >= 0 && thisNetTieGroup === otherNetTieGroup;
    }

    return false;
  }

  /**
   * @return true if the pad is associated with an "unconnected" pin (or a no-connect symbol)
   * and has no net.
   */
  IsNoConnectPad(): boolean {
    return this.m_pinType.includes('no_connect');
  }

  /**
   * @return true if the pad is associated with a "free" pin (not-internally-connected) and has
   * not yet been assigned another net (ie: by being routed to).
   */
  IsFreePad(): boolean {
    return this.GetShortNetname().startsWith('unconnected-(') && this.m_pinType === 'free';
  }

  /**
   * Set the new shape of this pad.
   */
  SetShape(aLayer: PCB_LAYER_ID, aShape: PAD_SHAPE): void {
    this.m_padStack.SetShape(aShape, aLayer);
    this.SetDirty();
  }

  /**
   * @return the shape of this pad.
   */
  GetShape(aLayer: PCB_LAYER_ID): PAD_SHAPE {
    return this.m_padStack.Shape(aLayer);
  }

  // Used for the properties panel, which does not support padstacks at the moment
  SetFrontShape(aShape: PAD_SHAPE): void {
    const wasRoundable = PadHasMeaningfulRoundingRadius(this, PCB_LAYER_ID.F_Cu);
    this.m_padStack.SetShape(aShape, PCB_LAYER_ID.F_Cu);
    const isRoundable = PadHasMeaningfulRoundingRadius(this, PCB_LAYER_ID.F_Cu);

    // If we have become roundable, set a sensible rounding default using the IPC rules.
    if (!wasRoundable && isRoundable) {
      const ipcRadiusRatio = GetDefaultIpcRoundingRatio(this, PCB_LAYER_ID.F_Cu);
      this.m_padStack.SetRoundRectRadiusRatio(ipcRadiusRatio, PCB_LAYER_ID.F_Cu);
    }

    this.SetDirty();
  }

  GetFrontShape(): PAD_SHAPE {
    return this.m_padStack.Shape(PCB_LAYER_ID.F_Cu);
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_pos = { ...aPos };
    this.SetDirty();
  }

  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  /**
   * @return the shape of the anchor pad shape, for custom shaped pads.
   */
  GetAnchorPadShape(aLayer: PCB_LAYER_ID): PAD_SHAPE {
    return this.m_padStack.AnchorShape(aLayer);
  }

  /**
   * @return the option for the custom pad shape to use as clearance area in copper zones.
   */
  GetCustomShapeInZoneOpt(): CUSTOM_SHAPE_ZONE_MODE {
    return this.m_padStack.CustomShapeInZoneMode();
  }

  /**
   * Set the option for the custom pad shape to use as clearance area in copper zones.
   *
   * @param aOption is the clearance area shape CUST_PAD_SHAPE_IN_ZONE option
   */
  SetCustomShapeInZoneOpt(aOption: CUSTOM_SHAPE_ZONE_MODE): void {
    this.m_padStack.SetCustomShapeInZoneMode(aOption);
  }

  /**
   * Set the shape of the anchor pad for custom shaped pads.
   *
   * @param aShape is the shape of the anchor pad shape( currently, only #PAD_SHAPE::RECTANGLE or
   *               #PAD_SHAPE::CIRCLE.
   */
  SetAnchorPadShape(aLayer: PCB_LAYER_ID, aShape: PAD_SHAPE): void {
    this.m_padStack.SetAnchorShape(
      aShape === PAD_SHAPE.RECTANGLE ? PAD_SHAPE.RECTANGLE : PAD_SHAPE.CIRCLE,
      aLayer,
    );
    this.SetDirty();
  }

  /**
   * @return true if the pad is on any copper layer, false otherwise.
   */
  override IsOnCopperLayer(): boolean {
    if (this.GetAttribute() === PAD_ATTRIB.NPTH) {
      // NPTH pads have no plated hole cylinder.  If their annular ring size is 0 or
      // negative, then they have no annular ring either.
      let hasAnnularRing = true;

      this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
        switch (this.GetShape(aLayer)) {
          case PAD_SHAPE.CIRCLE:
            if (
              equal(this.m_padStack.Offset(aLayer), { x: 0, y: 0 }) &&
              this.m_padStack.Size(aLayer).x <= this.m_padStack.Drill().size.x
            ) {
              hasAnnularRing = false;
            }

            break;

          case PAD_SHAPE.OVAL:
            if (
              equal(this.m_padStack.Offset(aLayer), { x: 0, y: 0 }) &&
              this.m_padStack.Size(aLayer).x <= this.m_padStack.Drill().size.x &&
              this.m_padStack.Size(aLayer).y <= this.m_padStack.Drill().size.y
            ) {
              hasAnnularRing = false;
            }

            break;

          default:
            // We could subtract the hole polygon from the shape polygon for these, but it
            // would be expensive and we're probably well out of the common use cases....
            break;
        }
      });

      if (!hasAnnularRing) return false;
    }

    return this.m_padStack.LayerSet().and(LSET.AllCuMask()).any();
  }

  override SetY(y: number): void {
    this.m_pos.y = y;
    this.SetDirty();
  }
  override SetX(x: number): void {
    this.m_pos.x = x;
    this.SetDirty();
  }

  SetSize(aLayer: PCB_LAYER_ID, aSize: VECTOR2I): void {
    this.m_padStack.SetSize(aSize, aLayer);
    this.SetDirty();
  }
  GetSize(aLayer: PCB_LAYER_ID): VECTOR2I {
    return this.m_padStack.Size(aLayer);
  }

  HasExplicitDefinitionForLayer(aLayer: PCB_LAYER_ID): boolean {
    return this.m_padStack.HasExplicitDefinitionForLayer(aLayer);
  }

  // These accessors are for the properties panel, which does not have the ability to deal with
  // custom padstacks where the properties can vary by layer.  The properties should be disabled
  // in the GUI when the padstack mode is set to anything other than NORMAL, but so that the code
  // compiles, these are set up to work with the front layer (in other words, assume the mode is
  // NORMAL, where F_Cu stores the whole padstack data)
  SetSizeX(aX: number): void {
    if (aX > 0) {
      let y = this.m_padStack.Size(PADSTACK.ALL_LAYERS).y;

      if (this.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE) y = aX;

      this.m_padStack.SetSize({ x: aX, y }, PADSTACK.ALL_LAYERS);
      this.SetDirty();
    }
  }

  GetSizeX(): number {
    return this.m_padStack.Size(PADSTACK.ALL_LAYERS).x;
  }

  SetSizeY(aY: number): void {
    if (aY > 0) {
      let x = this.m_padStack.Size(PADSTACK.ALL_LAYERS).x;

      if (this.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE) x = aY;

      this.m_padStack.SetSize({ x, y: aY }, PADSTACK.ALL_LAYERS);
      this.SetDirty();
    }
  }

  GetSizeY(): number {
    return this.m_padStack.Size(PADSTACK.ALL_LAYERS).y;
  }

  SetDelta(aLayer: PCB_LAYER_ID, aSize: VECTOR2I): void {
    this.m_padStack.SetTrapezoidDeltaSize(aSize, aLayer);
    this.SetDirty();
  }
  GetDelta(aLayer: PCB_LAYER_ID): VECTOR2I {
    return this.m_padStack.TrapezoidDeltaSize(aLayer);
  }

  SetPrimaryDrillSize(aSize: VECTOR2I): void {
    this.m_padStack.Drill().size = { ...aSize };
    this.SetDirty();
  }
  GetPrimaryDrillSize(): VECTOR2I {
    return this.m_padStack.Drill().size;
  }
  SetPrimaryDrillSizeX(aX: number): void {
    this.m_padStack.Drill().size.x = aX;

    if (this.GetPrimaryDrillShape() === PAD_DRILL_SHAPE.CIRCLE) this.m_padStack.Drill().size.y = aX;

    this.SetDirty();
  }
  GetPrimaryDrillSizeX(): number {
    return this.m_padStack.Drill().size.x;
  }
  SetPrimaryDrillSizeY(aY: number): void {
    this.m_padStack.Drill().size.y = aY;
    this.SetDirty();
  }
  GetPrimaryDrillSizeY(): number {
    return this.m_padStack.Drill().size.y;
  }

  SetDrillSize(aSize: VECTOR2I): void {
    this.SetPrimaryDrillSize(aSize);
  }
  GetDrillSize(): VECTOR2I {
    return this.GetPrimaryDrillSize();
  }
  SetDrillSizeX(aX: number): void {
    this.SetPrimaryDrillSizeX(aX);
  }
  GetDrillSizeX(): number {
    return this.GetPrimaryDrillSizeX();
  }
  SetDrillSizeY(aY: number): void {
    this.SetPrimaryDrillSizeY(aY);
  }
  GetDrillSizeY(): number {
    return this.GetPrimaryDrillSizeY();
  }

  SetOffset(aLayer: PCB_LAYER_ID, aOffset: VECTOR2I): void {
    this.m_padStack.SetOffset(aOffset, aLayer);
    this.SetDirty();
  }
  GetOffset(aLayer: PCB_LAYER_ID): VECTOR2I {
    return this.m_padStack.Offset(aLayer);
  }

  override GetCenter(): VECTOR2I {
    return this.GetPosition();
  }

  Padstack(): PADSTACK {
    return this.m_padStack;
  }
  SetPadstack(aPadstack: PADSTACK): void {
    this.m_padStack.assign(aPadstack);
  }

  /**
   * Has meaning only for custom shape pads.
   * add a free shape to the shape list.
   * the shape can be
   *  - a polygon (outline can have a thickness)
   *  - a thick segment
   *  - a filled circle (thickness == 0) or ring
   *  - a filled rect (thickness == 0) or rectangular outline
   *  - a arc
   *  - a bezier curve
   */
  AddPrimitivePoly(
    aLayer: PCB_LAYER_ID,
    aPoly: SHAPE_POLY_SET | readonly VECTOR2I[],
    aThickness: number,
    aFilled: boolean,
  ): void {
    if (!(aPoly instanceof SHAPE_POLY_SET)) {
      const item = new PCB_SHAPE(null, SHAPE_T.POLY);
      item.SetFilled(aFilled);
      item.SetPolyPoints(aPoly);
      item.SetStroke(new STROKE_PARAMS(aThickness, LINE_STYLE.SOLID));
      item.SetParent(this);
      this.m_padStack.AddPrimitive(item, aLayer);
      this.SetDirty();
      return;
    }

    // If aPoly has holes, convert it to a polygon with no holes.
    const poly_no_hole = new SHAPE_POLY_SET();
    poly_no_hole.Append(aPoly);

    if (poly_no_hole.HasHoles()) poly_no_hole.Fracture();

    // There should never be multiple shapes, but if there are, we split them into
    // primitives so that we can edit them both.
    for (let ii = 0; ii < poly_no_hole.OutlineCount(); ++ii) {
      const poly_outline = new SHAPE_POLY_SET(poly_no_hole.COutline(ii));
      const item = new PCB_SHAPE();
      item.SetShape(SHAPE_T.POLY);
      item.SetFilled(aFilled);
      item.SetPolyShape(poly_outline);
      item.SetStroke(new STROKE_PARAMS(aThickness, LINE_STYLE.SOLID));
      item.SetParent(this);
      this.m_padStack.AddPrimitive(item, aLayer);
    }

    this.SetDirty();
  }

  /**
   * Merge all basic shapes to a #SHAPE_POLY_SET.
   *
   * @note The results are relative to the pad position, orientation 0.
   *
   * @param aLayer is the copper layer to merge shapes for
   * @param aMergedPolygon will store the final polygon
   * @param aErrorLoc is used when a circle (or arc) is approximated by segments
   *  = ERROR_INSIDE to build a polygon inside the arc/circle (usual shape to raw/plot)
   *  = ERROR_OUIDE to build a polygon outside the arc/circle
   * (for instance when building a clearance area)
   */
  MergePrimitivesAsPolygon(
    aLayer: PCB_LAYER_ID,
    aMergedPolygon: SHAPE_POLY_SET,
    aErrorLoc: ERROR_LOC = ERROR_LOC.ERROR_INSIDE,
  ): void {
    aMergedPolygon.RemoveAllContours();

    // Add the anchor pad shape in aMergedPolygon, others in aux_polyset:
    // The anchor pad is always at 0,0
    const padSize = this.GetSize(aLayer);

    switch (this.GetAnchorPadShape(aLayer)) {
      case PAD_SHAPE.RECTANGLE: {
        const rect = new SHAPE_RECT(
          -Math.trunc(padSize.x / 2),
          -Math.trunc(padSize.y / 2),
          padSize.x,
          padSize.y,
        );
        aMergedPolygon.AddOutline(rect.Outline());
        break;
      }

      default:
      case PAD_SHAPE.CIRCLE:
        TransformCircleToPolygon(
          aMergedPolygon,
          { x: 0, y: 0 },
          Math.trunc(padSize.x / 2),
          this.GetMaxError(),
          aErrorLoc,
        );
        break;
    }

    const polyset = new SHAPE_POLY_SET();

    for (const primitive of this.m_padStack.Primitives(aLayer)) {
      if (!primitive.IsProxyItem())
        primitive.TransformShapeToPolygon(
          polyset,
          PCB_LAYER_ID.UNDEFINED_LAYER,
          0,
          this.GetMaxError(),
          aErrorLoc,
        );
    }

    polyset.Simplify();

    // Merge all polygons with the initial pad anchor shape
    if (polyset.OutlineCount()) {
      aMergedPolygon.BooleanAdd(polyset);
      aMergedPolygon.Fracture();
    }
  }

  /**
   * Clear the basic shapes list.
   * @param aLayer is the layer to clear, or UNDEFINED_LAYER to clear all layers
   */
  DeletePrimitivesList(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER): void {
    if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      this.m_padStack.ForEachUniqueLayer((l: PCB_LAYER_ID) => {
        this.m_padStack.ClearPrimitives(l);
      });
    } else {
      this.m_padStack.ClearPrimitives(aLayer);
    }

    this.SetDirty();
  }

  /**
   * Accessor to the basic shape list for custom-shaped pads.
   */
  GetPrimitives(aLayer: PCB_LAYER_ID): PCB_SHAPE[] {
    return this.m_padStack.Primitives(aLayer);
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    MIRROR(this.m_pos, aCentre, aFlipDirection);

    this.m_padStack.ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      const offset = { ...this.m_padStack.Offset(aLayer) };
      MIRROR(offset, { x: 0, y: 0 }, aFlipDirection);
      this.m_padStack.SetOffset(offset, aLayer);

      const delta = { ...this.m_padStack.TrapezoidDeltaSize(aLayer) };
      MIRROR(delta, { x: 0, y: 0 }, aFlipDirection);
      this.m_padStack.SetTrapezoidDeltaSize(delta, aLayer);
    });

    this.SetFPRelativeOrientation(this.GetFPRelativeOrientation().negate());

    const mirrorBitFlags = (aBitfield: number, a: number, b: number): number => {
      const temp = !!(aBitfield & a);

      if (aBitfield & b) aBitfield |= a;
      else aBitfield &= ~a;

      if (temp) aBitfield |= b;
      else aBitfield &= ~b;

      return aBitfield;
    };

    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      let positions = this.m_padStack.ChamferPositions(aLayer);

      if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
        positions = mirrorBitFlags(positions, RECT_CHAMFER_TOP_LEFT, RECT_CHAMFER_TOP_RIGHT);
        positions = mirrorBitFlags(positions, RECT_CHAMFER_BOTTOM_LEFT, RECT_CHAMFER_BOTTOM_RIGHT);
      } else {
        positions = mirrorBitFlags(positions, RECT_CHAMFER_TOP_LEFT, RECT_CHAMFER_BOTTOM_LEFT);
        positions = mirrorBitFlags(positions, RECT_CHAMFER_TOP_RIGHT, RECT_CHAMFER_BOTTOM_RIGHT);
      }

      this.m_padStack.SetChamferPositions(positions, aLayer);
    });

    this.m_padStack.FlipLayers(this.GetBoard()!);

    // Flip pads layers after padstack geometry
    const flipped = new LSET();

    for (const layer of this.m_padStack.LayerSet()) flipped.set(this.GetBoard()!.FlipLayer(layer));

    this.SetLayerSet(flipped);

    // Flip the basic shapes, in custom pads
    this.FlipPrimitives(aFlipDirection);

    this.SetDirty();
  }

  /**
   * Flip (mirror) the primitives left to right or top to bottom, around the anchor position
   * in custom pads.
   */
  FlipPrimitives(aFlipDirection: FLIP_DIRECTION): void {
    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      for (const primitive of this.m_padStack.Primitives(aLayer)) {
        // Ensure the primitive parent is up to date. Flip uses GetBoard() that
        // imply primitive parent is valid
        primitive.SetParent(this);
        primitive.Flip({ x: 0, y: 0 }, aFlipDirection);
      }
    });

    this.SetDirty();
  }

  /**
   * Clear the current custom shape primitives list and import a new list.  Copies the input,
   * which is not altered.
   */
  ReplacePrimitives(aLayer: PCB_LAYER_ID, aPrimitivesList: readonly PCB_SHAPE[]): void {
    // clear old list
    this.DeletePrimitivesList(aLayer);

    // Import to the given shape list
    if (aPrimitivesList.length) this.AppendPrimitives(aLayer, aPrimitivesList);

    this.SetDirty();
  }

  /**
   * Import a custom shape primitive list (composed of basic shapes) and add items to the
   * current list.  Copies the input, which is not altered.
   */
  AppendPrimitives(aLayer: PCB_LAYER_ID, aPrimitivesList: readonly PCB_SHAPE[]): void {
    // Add duplicates of aPrimitivesList to the pad primitives list:
    for (const prim of aPrimitivesList) this.AddPrimitive(aLayer, PCB_SHAPE.copyOf(prim));

    this.SetDirty();
  }

  /**
   * Add item to the custom shape primitives list
   */
  AddPrimitive(aLayer: PCB_LAYER_ID, aPrimitive: PCB_SHAPE): void {
    aPrimitive.SetParent(this);
    this.m_padStack.AddPrimitive(aPrimitive, aLayer);

    this.SetDirty();
  }

  /**
   * Set the rotation angle of the pad.
   *
   * If \a aAngle is outside of 0 - 360, then it will be normalized.
   */
  SetOrientation(aAngle: EDA_ANGLE): void {
    this.m_padStack.SetOrientation(aAngle);
    this.SetDirty();
  }

  SetFPRelativeOrientation(aAngle: EDA_ANGLE): void {
    const parentFP = this.GetParentFootprint() as FOOTPRINT | null;

    if (parentFP) this.SetOrientation(aAngle.add(parentFP.GetOrientation()));
    else this.SetOrientation(aAngle);
  }

  /**
   * Return the rotation angle of the pad.
   */
  GetOrientation(): EDA_ANGLE {
    return this.m_padStack.GetOrientation();
  }

  GetFPRelativeOrientation(): EDA_ANGLE {
    const parentFP = this.GetParentFootprint() as FOOTPRINT | null;

    if (parentFP) return this.GetOrientation().sub(parentFP.GetOrientation());
    else return this.GetOrientation();
  }

  // For property system
  SetOrientationDegrees(aOrientation: number): void {
    this.SetOrientation(new EDA_ANGLE(aOrientation));
  }
  GetOrientationDegrees(): number {
    return this.m_padStack.GetOrientation().AsDegrees();
  }

  SetPrimaryDrillShape(aShape: PAD_DRILL_SHAPE): void {
    this.m_padStack.Drill().shape = aShape;

    if (aShape === PAD_DRILL_SHAPE.CIRCLE)
      this.m_padStack.Drill().size.y = this.m_padStack.Drill().size.x;

    this.m_shapesDirty = true;
    this.SetDirty();
  }
  GetPrimaryDrillShape(): PAD_DRILL_SHAPE {
    return this.m_padStack.Drill().shape;
  }
  SetDrillShape(aShape: PAD_DRILL_SHAPE): void {
    this.SetPrimaryDrillShape(aShape);
  }
  GetDrillShape(): PAD_DRILL_SHAPE {
    return this.GetPrimaryDrillShape();
  }

  SetPrimaryDrillStartLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.Drill().start = aLayer;
    this.SetDirty();
  }
  GetPrimaryDrillStartLayer(): PCB_LAYER_ID {
    return this.m_padStack.Drill().start;
  }
  SetPrimaryDrillEndLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.Drill().end = aLayer;
    this.SetDirty();
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
   * This checks both the secondary drill (backdrill) and post-machining (counterbore/countersink)
   * settings to determine if the given layer has had copper removed.
   *
   * @param aLayer the copper layer to check
   * @return true if the layer is affected by backdrilling or post-machining
   */
  IsBackdrilledOrPostMachined(aLayer: PCB_LAYER_ID): boolean {
    if (!IsCopperLayer(aLayer)) return false;

    const board = this.GetBoard();

    if (!board) return false;

    const F_Cu = PCB_LAYER_ID.F_Cu;
    const B_Cu = PCB_LAYER_ID.B_Cu;

    const layerOrdinalOf = (layer: PCB_LAYER_ID, isStart: boolean): number =>
      board.IsLayerEnabled(layer)
        ? board.IsLayerEnabled(F_Cu)
          ? layer === F_Cu
            ? 0
            : !isStart && layer === B_Cu
              ? board.GetCopperLayerCount() - 1
              : Math.trunc(layer / 2) + 1
          : Math.trunc(layer / 2)
        : -1;

    // Check secondary drill (backdrill from top)
    const secondaryDrill = this.m_padStack.SecondaryDrill();

    if (
      secondaryDrill.size.x > 0 &&
      secondaryDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      secondaryDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER
    ) {
      // Secondary drill goes from start to end layer, removing copper on those layers
      let startOrdinal = layerOrdinalOf(secondaryDrill.start, true);
      let endOrdinal = layerOrdinalOf(secondaryDrill.end, false);
      const layerOrdinal = layerOrdinalOf(aLayer, false);

      if (layerOrdinal >= 0 && startOrdinal >= 0 && endOrdinal >= 0) {
        if (startOrdinal > endOrdinal) [startOrdinal, endOrdinal] = [endOrdinal, startOrdinal];

        if (layerOrdinal >= startOrdinal && layerOrdinal <= endOrdinal) return true;
      }
    }

    // Check tertiary drill (backdrill from bottom)
    const tertiaryDrill = this.m_padStack.TertiaryDrill();

    if (
      tertiaryDrill.size.x > 0 &&
      tertiaryDrill.start !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      tertiaryDrill.end !== PCB_LAYER_ID.UNDEFINED_LAYER
    ) {
      let startOrdinal = layerOrdinalOf(tertiaryDrill.start, true);
      let endOrdinal = layerOrdinalOf(tertiaryDrill.end, false);
      const layerOrdinal = layerOrdinalOf(aLayer, false);

      if (layerOrdinal >= 0 && startOrdinal >= 0 && endOrdinal >= 0) {
        if (startOrdinal > endOrdinal) [startOrdinal, endOrdinal] = [endOrdinal, startOrdinal];

        if (layerOrdinal >= startOrdinal && layerOrdinal <= endOrdinal) return true;
      }
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
    this.SetDirty();
  }
  SetPrimaryDrillFilledFlag(aFilled: boolean): void {
    this.m_padStack.Drill().is_filled = aFilled;
    this.SetDirty();
  }
  GetPrimaryDrillFilled(): boolean | undefined {
    return this.m_padStack.Drill().is_filled;
  }
  GetPrimaryDrillFilledFlag(): boolean {
    return this.m_padStack.Drill().is_filled ?? false;
  }

  SetPrimaryDrillCapped(aCapped: boolean | undefined): void {
    this.m_padStack.Drill().is_capped = aCapped;
    this.SetDirty();
  }
  SetPrimaryDrillCappedFlag(aCapped: boolean): void {
    this.m_padStack.Drill().is_capped = aCapped;
    this.SetDirty();
  }
  GetPrimaryDrillCapped(): boolean | undefined {
    return this.m_padStack.Drill().is_capped;
  }
  GetPrimaryDrillCappedFlag(): boolean {
    return this.m_padStack.Drill().is_capped ?? false;
  }

  SetSecondaryDrillSize(aSize: VECTOR2I): void {
    this.m_padStack.SecondaryDrill().size = { ...aSize };
    this.SetDirty();
  }
  GetSecondaryDrillSize(): VECTOR2I {
    return this.m_padStack.SecondaryDrill().size;
  }
  ClearSecondaryDrillSize(): void {
    this.m_padStack.SecondaryDrill().size = { x: 0, y: 0 };
    this.SetDirty();
  }
  SetSecondaryDrillSizeX(aX: number): void {
    this.m_padStack.SecondaryDrill().size.x = aX;

    if (this.GetSecondaryDrillShape() === PAD_DRILL_SHAPE.CIRCLE)
      this.m_padStack.SecondaryDrill().size.y = aX;

    this.SetDirty();
  }
  GetSecondaryDrillSizeX(): number {
    return this.m_padStack.SecondaryDrill().size.x;
  }
  SetSecondaryDrillSizeY(aY: number): void {
    this.m_padStack.SecondaryDrill().size.y = aY;
    this.SetDirty();
  }
  GetSecondaryDrillSizeY(): number {
    return this.m_padStack.SecondaryDrill().size.y;
  }
  SetSecondaryDrillShape(aShape: PAD_DRILL_SHAPE): void {
    this.m_padStack.SecondaryDrill().shape = aShape;
    this.SetDirty();
  }
  GetSecondaryDrillShape(): PAD_DRILL_SHAPE {
    return this.m_padStack.SecondaryDrill().shape;
  }
  SetSecondaryDrillStartLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.SecondaryDrill().start = aLayer;
    this.SetDirty();
  }
  GetSecondaryDrillStartLayer(): PCB_LAYER_ID {
    return this.m_padStack.SecondaryDrill().start;
  }
  SetSecondaryDrillEndLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.SecondaryDrill().end = aLayer;
    this.SetDirty();
  }
  GetSecondaryDrillEndLayer(): PCB_LAYER_ID {
    return this.m_padStack.SecondaryDrill().end;
  }

  SetTertiaryDrillSize(aSize: VECTOR2I): void {
    this.m_padStack.TertiaryDrill().size = { ...aSize };
    this.SetDirty();
  }
  GetTertiaryDrillSize(): VECTOR2I {
    return this.m_padStack.TertiaryDrill().size;
  }
  ClearTertiaryDrillSize(): void {
    this.m_padStack.TertiaryDrill().size = { x: 0, y: 0 };
    this.SetDirty();
  }
  SetTertiaryDrillSizeX(aX: number): void {
    this.m_padStack.TertiaryDrill().size.x = aX;

    if (this.GetTertiaryDrillShape() === PAD_DRILL_SHAPE.CIRCLE)
      this.m_padStack.TertiaryDrill().size.y = aX;

    this.SetDirty();
  }
  GetTertiaryDrillSizeX(): number {
    return this.m_padStack.TertiaryDrill().size.x;
  }
  SetTertiaryDrillSizeY(aY: number): void {
    this.m_padStack.TertiaryDrill().size.y = aY;
    this.SetDirty();
  }
  GetTertiaryDrillSizeY(): number {
    return this.m_padStack.TertiaryDrill().size.y;
  }
  SetTertiaryDrillShape(aShape: PAD_DRILL_SHAPE): void {
    this.m_padStack.TertiaryDrill().shape = aShape;
    this.SetDirty();
  }
  GetTertiaryDrillShape(): PAD_DRILL_SHAPE {
    return this.m_padStack.TertiaryDrill().shape;
  }
  SetTertiaryDrillStartLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.TertiaryDrill().start = aLayer;
    this.SetDirty();
  }
  GetTertiaryDrillStartLayer(): PCB_LAYER_ID {
    return this.m_padStack.TertiaryDrill().start;
  }
  SetTertiaryDrillEndLayer(aLayer: PCB_LAYER_ID): void {
    this.m_padStack.TertiaryDrill().end = aLayer;
    this.SetDirty();
  }
  GetTertiaryDrillEndLayer(): PCB_LAYER_ID {
    return this.m_padStack.TertiaryDrill().end;
  }

  IsDirty(): boolean {
    return (
      this.m_shapesDirty ||
      this.m_polyDirty[ERROR_LOC.ERROR_INSIDE] ||
      this.m_polyDirty[ERROR_LOC.ERROR_OUTSIDE]
    );
  }

  SetDirty(): void {
    this.m_shapesDirty = true;
    this.m_polyDirty[ERROR_LOC.ERROR_INSIDE] = true;
    this.m_polyDirty[ERROR_LOC.ERROR_OUTSIDE] = true;
  }

  override SetLayerSet(aLayers: LSET): void {
    this.m_padStack.SetLayerSet(aLayers);
    this.SetDirty();

    if (!(this.GetFlags() & ROUTER_TRANSIENT)) {
      // if( BOARD* board = GetBoard() ) board->InvalidateClearanceCache( m_Uuid );
      //                                                   -- BOARD's DRC caches pending (#636)
    }
  }

  override GetLayerSet(): LSET {
    return this.m_padStack.LayerSet();
  }

  SetAttribute(aAttribute: PAD_ATTRIB): void {
    if (this.m_attribute !== aAttribute) {
      this.m_attribute = aAttribute;

      const layerMask = this.m_padStack.LayerSet();

      switch (aAttribute) {
        case PAD_ATTRIB.PTH:
          // Plump up to all copper layers
          layerMask.orAssign(LSET.AllCuMask());
          break;

        case PAD_ATTRIB.SMD:
        case PAD_ATTRIB.CONN: {
          // Trim down to no more than one copper layer
          const copperLayers = layerMask.and(LSET.AllCuMask());

          if (copperLayers.count() > 1) {
            layerMask.andAssign(LSET.AllCuMask().not());

            if (copperLayers.test(PCB_LAYER_ID.B_Cu)) layerMask.set(PCB_LAYER_ID.B_Cu);
            else layerMask.set(copperLayers.Seq()[0]!);
          }

          // No hole
          this.m_padStack.Drill().size = { x: 0, y: 0 };
          break;
        }

        case PAD_ATTRIB.NPTH:
          // No number; no net
          this.m_number = '';
          this.SetNetCode(NETINFO_LIST.UNCONNECTED);
          break;
      }

      if (!(this.GetFlags() & ROUTER_TRANSIENT)) {
        // if( BOARD* board = GetBoard() ) board->InvalidateClearanceCache( m_Uuid );
        //                                                   -- BOARD's DRC caches pending (#636)
      }
    }

    this.SetDirty();
  }

  GetAttribute(): PAD_ATTRIB {
    return this.m_attribute;
  }

  SetProperty(aProperty: PAD_PROP): void {
    this.m_property = aProperty;
    this.SetDirty();
  }

  GetProperty(): PAD_PROP {
    return this.m_property;
  }

  // We don't currently have an attribute for APERTURE, and adding one will change the file
  // format, so for now just infer a copper-less pad to be an APERTURE pad.
  IsAperturePad(): boolean {
    return this.m_padStack.LayerSet().and(LSET.AllCuMask()).none();
  }

  IsNPTHWithNoCopper(): boolean {
    if (this.GetAttribute() !== PAD_ATTRIB.NPTH) return false;

    let hasCopper = false;

    this.Padstack().ForEachUniqueLayer((layer: PCB_LAYER_ID) => {
      if (this.GetShape(layer) === PAD_SHAPE.CIRCLE) {
        if (this.GetSize(layer).x > this.GetDrillSize().x) hasCopper = true;
      } else if (this.GetShape(layer) === PAD_SHAPE.OVAL) {
        if (
          this.GetSize(layer).x > this.GetDrillSize().x ||
          this.GetSize(layer).y > this.GetDrillSize().y
        )
          hasCopper = true;
      } else {
        hasCopper = true;
      }
    });

    return !hasCopper;
  }

  SetPadToDieLength(aLength: number): void {
    this.m_lengthPadToDie = aLength;
  }
  GetPadToDieLength(): number {
    return this.m_lengthPadToDie;
  }

  SetPadToDieDelay(aDelay: number): void {
    this.m_delayPadToDie = aDelay;
  }
  GetPadToDieDelay(): number {
    return this.m_delayPadToDie;
  }

  /**
   * `GetLocalClearance()` (the padstack's own value) and `GetLocalClearance( wxString* aSource )`,
   * which also reports the source.
   */
  override GetLocalClearance(aSource?: OutStr | null): number | undefined {
    if (aSource === undefined) return this.m_padStack.Clearance();

    if (this.m_padStack.Clearance() !== undefined && aSource) aSource.value = 'pad';

    return this.m_padStack.Clearance();
  }

  SetLocalClearance(aClearance: number | undefined): void {
    this.m_padStack.SetClearance(aClearance);
  }

  GetLocalSolderMaskMargin(): number | undefined {
    return this.m_padStack.SolderMaskMargin();
  }
  SetLocalSolderMaskMargin(aMargin: number | undefined): void {
    this.m_padStack.SetSolderMaskMargin(aMargin, PCB_LAYER_ID.F_Mask);
    this.m_padStack.SetSolderMaskMargin(aMargin, PCB_LAYER_ID.B_Mask);
  }

  GetLocalSolderPasteMargin(): number | undefined {
    return this.m_padStack.SolderPasteMargin();
  }
  SetLocalSolderPasteMargin(aMargin: number | undefined): void {
    this.m_padStack.SetSolderPasteMargin(aMargin, PCB_LAYER_ID.F_Paste);
    this.m_padStack.SetSolderPasteMargin(aMargin, PCB_LAYER_ID.B_Paste);
  }

  GetLocalSolderPasteMarginRatio(): number | undefined {
    return this.m_padStack.SolderPasteMarginRatio();
  }
  SetLocalSolderPasteMarginRatio(aRatio: number | undefined): void {
    this.m_padStack.SetSolderPasteMarginRatio(aRatio, PCB_LAYER_ID.F_Paste);
    this.m_padStack.SetSolderPasteMarginRatio(aRatio, PCB_LAYER_ID.B_Paste);
  }

  SetLocalZoneConnection(aType: ZONE_CONNECTION): void {
    this.m_padStack.SetZoneConnection(aType);
  }
  GetLocalZoneConnection(): ZONE_CONNECTION {
    return this.m_padStack.ZoneConnection() ?? ZONE_CONNECTION.INHERITED;
  }

  /**
   * Return the pad's "own" clearance in internal units.
   *
   * @param aLayer the layer in question.
   * @param aSource [out] optionally reports the source as a user-readable string.
   * @return the clearance in internal units.
   */
  override GetOwnClearance(aLayer: PCB_LAYER_ID, aSource: OutStr | null = null): number {
    // The NPTH vs regular pad logic is handled in DRC_ENGINE::GetCachedOwnClearance
    return super.GetOwnClearance(aLayer, aSource);
  }

  /**
   * Convert the pad shape to a closed polygon. Circles and arcs are approximated by segments.
   *
   * @param aBuffer a buffer to store the polygon.
   * @param aClearance the clearance around the pad.
   * @param aMaxError maximum error from true when converting arcs.
   * @param aErrorLoc should the approximation error be placed outside or inside the polygon?
   * @param ignoreLineWidth used for edge cuts where the line width is only for visualization.
   */
  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC = ERROR_LOC.ERROR_INSIDE,
    ignoreLineWidth = false,
  ): void {
    console.assert(
      aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER,
      'UNDEFINED_LAYER is no longer allowed for PAD::TransformShapeToPolygon',
    );

    // minimal segment count to approximate a circle to create the polygonal pad shape
    // This minimal value is mainly for very small pads, like SM0402.
    // Most of time pads are using the segment count given by aError value.
    const pad_min_seg_per_circle_count = 16;
    const dx = Math.trunc(this.m_padStack.Size(aLayer).x / 2);
    const dy = Math.trunc(this.m_padStack.Size(aLayer).y / 2);

    const padShapePos = this.ShapePos(aLayer); // Note: for pad having a shape offset, the pad
    // position is NOT the shape position

    const shape = this.GetShape(aLayer);

    switch (shape) {
      case PAD_SHAPE.CIRCLE:
      case PAD_SHAPE.OVAL:
        // Note: dx == dy is not guaranteed for circle pads in legacy boards
        if (dx === dy || shape === PAD_SHAPE.CIRCLE) {
          TransformCircleToPolygon(
            aBuffer,
            padShapePos,
            dx + aClearance,
            aMaxError,
            aErrorLoc,
            pad_min_seg_per_circle_count,
          );
        } else {
          const half_width = Math.min(dx, dy);
          let delta: VECTOR2I = { x: dx - half_width, y: dy - half_width };

          delta = RotatePoint(delta, this.GetOrientation());

          TransformOvalToPolygon(
            aBuffer,
            sub(padShapePos, delta),
            add(padShapePos, delta),
            (half_width + aClearance) * 2,
            aMaxError,
            aErrorLoc,
            pad_min_seg_per_circle_count,
          );
        }

        break;

      case PAD_SHAPE.TRAPEZOID:
      case PAD_SHAPE.RECTANGLE: {
        const trapDelta = this.m_padStack.TrapezoidDeltaSize(aLayer);
        const ddx = shape === PAD_SHAPE.TRAPEZOID ? Math.trunc(trapDelta.x / 2) : 0;
        const ddy = shape === PAD_SHAPE.TRAPEZOID ? Math.trunc(trapDelta.y / 2) : 0;

        const outline = new SHAPE_POLY_SET();
        TransformTrapezoidToPolygon(
          outline,
          padShapePos,
          this.m_padStack.Size(aLayer),
          this.GetOrientation(),
          ddx,
          ddy,
          aClearance,
          aMaxError,
          aErrorLoc,
        );
        aBuffer.Append(outline);
        break;
      }

      case PAD_SHAPE.CHAMFERED_RECT:
      case PAD_SHAPE.ROUNDRECT: {
        const doChamfer = shape === PAD_SHAPE.CHAMFERED_RECT;

        const outline = new SHAPE_POLY_SET();
        TransformRoundChamferedRectToPolygon(
          outline,
          padShapePos,
          this.m_padStack.Size(aLayer),
          this.GetOrientation(),
          this.GetRoundRectCornerRadius(aLayer),
          doChamfer ? this.GetChamferRectRatio(aLayer) : 0,
          doChamfer ? this.GetChamferPositions(aLayer) : 0,
          aClearance,
          aMaxError,
          aErrorLoc,
        );
        aBuffer.Append(outline);
        break;
      }

      case PAD_SHAPE.CUSTOM: {
        const outline = new SHAPE_POLY_SET();
        this.MergePrimitivesAsPolygon(aLayer, outline, aErrorLoc);
        outline.Rotate(this.GetOrientation());
        outline.Move(padShapePos);

        if (aClearance > 0 || aErrorLoc === ERROR_LOC.ERROR_OUTSIDE) {
          if (aErrorLoc === ERROR_LOC.ERROR_OUTSIDE) aClearance += aMaxError;

          outline.Inflate(aClearance, CornerStrategy.ROUND_ALL_CORNERS, aMaxError);
          outline.Fracture();
        } else if (aClearance < 0) {
          // Negative clearances are primarily for drawing solder paste layer, so we don't
          // worry ourselves overly about which side the error is on.

          // aClearance is negative so this is actually a deflate
          outline.Inflate(aClearance, CornerStrategy.ALLOW_ACUTE_CORNERS, aMaxError);
          outline.Fracture();
        }

        aBuffer.Append(outline);
        break;
      }

      default:
        console.assert(
          false,
          `PAD::TransformShapeToPolygon no implementation for ${PAD_SHAPE[shape]}`,
        );
        break;
    }
  }

  /**
   * Build the corner list of the polygonal drill shape in the board coordinate system.
   *
   * @param aBuffer a buffer to fill.
   * @param aClearance the clearance or margin value.
   * @param aError maximum deviation of an arc from the polygon approximation.
   * @param aErrorLoc = should the approximation error be placed outside or inside the polygon?
   * @return false if the pad has no hole, true otherwise.
   */
  TransformHoleToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC = ERROR_LOC.ERROR_INSIDE,
  ): boolean {
    const drillsize = this.GetDrillSize();

    if (!drillsize.x || !drillsize.y) return false;

    const slot = this.GetEffectiveHoleShape();

    TransformOvalToPolygon(
      aBuffer,
      slot.GetSeg().A,
      slot.GetSeg().B,
      slot.GetWidth() + aClearance * 2,
      aError,
      aErrorLoc,
    );

    return true;
  }

  /**
   * Some pad shapes can be complex (rounded/chamfered rectangle), even without considering
   * custom shapes.  This routine returns a COMPOUND shape (set of simple shapes which make
   * up the pad for use with routing, collision determination, etc).
   *
   * @note This list can contain a SHAPE_SIMPLE (a simple single-outline non-intersecting
   * polygon), but should never contain a SHAPE_POLY_SET (a complex polygon consisting of
   * multiple outlines and/or holes).
   *
   * @param aLayer determines which layer to query for shape
   * @param aFlash optional parameter allowing a caller to force the pad to be flashed (or not
   *               flashed) on the current layer (default is to honour the pad's setting and
   *               the current connections for the given layer).
   */
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    flashPTHPads: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    if (aLayer === PCB_LAYER_ID.Edge_Cuts) {
      const effective_compund = new SHAPE_COMPOUND();

      if (this.GetAttribute() === PAD_ATTRIB.PTH || this.GetAttribute() === PAD_ATTRIB.NPTH) {
        effective_compund.AddShape(this.GetEffectiveHoleShape());
        return effective_compund;
      } else {
        effective_compund.AddShape(new SHAPE_NULL());
        return effective_compund;
      }
    }

    // Check if this layer has copper removed by backdrill or post-machining
    if (this.IsBackdrilledOrPostMachined(aLayer)) {
      const effective_compound = new SHAPE_COMPOUND();

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

      if (holeSize > 0) {
        effective_compound.AddShape(new SHAPE_CIRCLE(this.GetPosition(), Math.trunc(holeSize / 2)));
      } else {
        effective_compound.AddShape(this.GetEffectiveHoleShape());
      }

      return effective_compound;
    }

    if (this.GetAttribute() === PAD_ATTRIB.PTH) {
      let flash: boolean;
      const effective_compund = new SHAPE_COMPOUND();

      if (flashPTHPads === FLASHING.NEVER_FLASHED) flash = false;
      else if (flashPTHPads === FLASHING.ALWAYS_FLASHED) flash = true;
      else flash = this.FlashLayer(aLayer);

      if (!flash) {
        if (this.GetAttribute() === PAD_ATTRIB.PTH) {
          effective_compund.AddShape(this.GetEffectiveHoleShape());
          return effective_compund;
        } else {
          effective_compund.AddShape(new SHAPE_NULL());
          return effective_compund;
        }
      }
    }

    if (this.m_shapesDirty) this.BuildEffectiveShapes();

    aLayer = this.Padstack().EffectiveLayerFor(aLayer);

    const drawCache = this.getDrawCache();

    const shape = drawCache.m_effectiveShapes.get(aLayer);

    if (!shape)
      throw new Error(`Missing shape in PAD::GetEffectiveShape for layer ${PCB_LAYER_ID[aLayer]}.`); // wxCHECK_MSG

    return shape;
  }

  GetEffectivePolygon(
    aLayer: PCB_LAYER_ID,
    aErrorLoc: ERROR_LOC = ERROR_LOC.ERROR_INSIDE,
  ): SHAPE_POLY_SET {
    if (this.m_polyDirty[aErrorLoc]) this.BuildEffectivePolygon(aErrorLoc);

    aLayer = this.Padstack().EffectiveLayerFor(aLayer);

    const drawCache = this.getDrawCache();
    const polygons = drawCache.m_effectivePolygons.get(aLayer);

    if (!polygons || !polygons[aErrorLoc])
      throw new Error(`PAD::GetEffectivePolygon: no polygon for layer ${PCB_LAYER_ID[aLayer]}`); // .at() throws

    return polygons[aErrorLoc]!;
  }

  /**
   * Return a SHAPE_SEGMENT object representing the pad's hole.
   */
  override GetEffectiveHoleShape(): SHAPE_SEGMENT {
    if (this.m_shapesDirty) this.BuildEffectiveShapes();

    return this.getDrawCache().m_effectiveHoleShape!;
  }

  /**
   * Return the radius of a minimum sized circle which fully encloses this pad.
   *
   * The center is the pad position NOT THE SHAPE POS!
   */
  GetBoundingRadius(): number {
    if (this.m_polyDirty[ERROR_LOC.ERROR_OUTSIDE])
      this.BuildEffectivePolygon(ERROR_LOC.ERROR_OUTSIDE);

    return this.m_effectiveBoundingRadius;
  }

  /**
   * Return any clearance overrides set in the "classic" (ie: pre-rule) system.
   *
   * @param aSource [out] optionally reports the source as a user-readable string.
   * @return the clearance in internal units.
   */
  override GetClearanceOverrides(aSource: OutStr | null): number | undefined {
    if (this.m_padStack.Clearance() !== undefined) return this.GetLocalClearance(aSource);

    const parentFootprint = this.GetParentFootprint() as FOOTPRINT | null;

    if (parentFootprint) return parentFootprint.GetClearanceOverrides(aSource);

    return undefined;
  }

  /**
   * @return the expansion for the solder mask layer
   *
   * Usually > 0 (mask shape bigger than pad).  For pads **not** on copper layers, the value
   * is the local value because there is no default shape to build.  For pads also on copper
   * layers, the value (used to build a default shape) is:
   *  1 the local value
   *  2 if 0, the parent footprint value
   *  3 if 0, the global value
   */
  GetSolderMaskExpansion(aLayer: PCB_LAYER_ID): number {
    // Pads defined only on mask layers (and perhaps on other tech layers) use the shape
    // defined by the pad settings only.  ALL other pads, even those that don't actually have
    // any copper (such as NPTH pads with holes the same size as the pad) get mask expansion.
    if (this.m_padStack.LayerSet().and(LSET.AllCuMask()).none()) return 0;

    if (IsFrontLayer(aLayer)) aLayer = PCB_LAYER_ID.F_Mask;
    else if (IsBackLayer(aLayer)) aLayer = PCB_LAYER_ID.B_Mask;
    else return 0;

    let margin: number | undefined;

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
        aLayer,
      );

      if (constraint.m_Value.HasOpt()) margin = constraint.m_Value.Opt();
    } else {
      margin = this.m_padStack.SolderMaskMargin(aLayer);

      if (margin === undefined) {
        const parentFootprint = this.GetParentFootprint() as FOOTPRINT | null;

        if (parentFootprint) margin = parentFootprint.GetLocalSolderMaskMargin();
      }

      if (margin === undefined) {
        const brd = this.GetBoard();

        if (brd) margin = brd.GetDesignSettings().m_SolderMaskExpansion;
      }
    }

    let marginValue = margin ?? 0;

    const cuLayer = aLayer === PCB_LAYER_ID.B_Mask ? PCB_LAYER_ID.B_Cu : PCB_LAYER_ID.F_Cu;

    // ensure mask have a size always >= 0
    if (marginValue < 0) {
      const minsize = -Math.trunc(
        Math.min(this.m_padStack.Size(cuLayer).x, this.m_padStack.Size(cuLayer).y) / 2,
      );

      if (marginValue < minsize) marginValue = minsize;
    }

    return marginValue;
  }

  /**
   * Usually < 0 (mask shape smaller than pad)because the margin can be dependent on the pad
   * size, the margin has a x and a y value.  For pads **not** on copper layers, the value is
   * the local value because there is no default shape to build.  For pads also on copper
   * layers, the value (used to build a default shape) is:
   *  1 the local value
   *  2 if 0, the parent footprint value
   *  3 if 0, the global value
   *
   * @return the margin for the solder mask layer.
   */
  GetSolderPasteMargin(aLayer: PCB_LAYER_ID): VECTOR2I {
    // Pads defined only on mask layers (and perhaps on other tech layers) use the shape
    // defined by the pad settings only.  ALL other pads, even those that don't actually have
    // any copper (such as NPTH pads with holes the same size as the pad) get paste expansion.
    if (this.m_padStack.LayerSet().and(LSET.AllCuMask()).none()) return { x: 0, y: 0 };

    if (IsFrontLayer(aLayer)) aLayer = PCB_LAYER_ID.F_Paste;
    else if (IsBackLayer(aLayer)) aLayer = PCB_LAYER_ID.B_Paste;
    else return { x: 0, y: 0 };

    let margin: number | undefined;
    let mratio: number | undefined;

    let drcEngine: DRC_ENGINE | null = null;

    if (this.GetBoard()) drcEngine = this.GetBoard()!.GetDesignSettings().m_DRCEngine;

    const hasAbsRules =
      drcEngine !== null &&
      drcEngine.HasRulesForConstraintType(DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT);
    const hasRelRules =
      drcEngine !== null &&
      drcEngine.HasRulesForConstraintType(DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT);

    if (hasAbsRules || hasRelRules) {
      let constraint: DRC_CONSTRAINT;

      if (hasAbsRules) {
        constraint = drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT,
          this,
          null,
          aLayer,
        );

        if (constraint.m_Value.HasOpt()) margin = constraint.m_Value.Opt();
      }

      if (hasRelRules) {
        constraint = drcEngine!.EvalRules(
          DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT,
          this,
          null,
          aLayer,
        );

        if (constraint.m_Value.HasOpt()) mratio = constraint.m_Value.Opt() / 1000.0;
      }
    }

    if (margin === undefined) {
      margin = this.m_padStack.SolderPasteMargin(aLayer);

      if (margin === undefined) {
        const parentFootprint = this.GetParentFootprint() as FOOTPRINT | null;

        if (parentFootprint) margin = parentFootprint.GetLocalSolderPasteMargin();
      }

      if (margin === undefined) {
        const brd = this.GetBoard();

        if (brd) margin = brd.GetDesignSettings().m_SolderPasteMargin;
      }
    }

    if (mratio === undefined) {
      mratio = this.m_padStack.SolderPasteMarginRatio(aLayer);

      if (mratio === undefined) {
        const parentFootprint = this.GetParentFootprint() as FOOTPRINT | null;

        if (parentFootprint) mratio = parentFootprint.GetLocalSolderPasteMarginRatio();
      }

      if (mratio === undefined) {
        const brd = this.GetBoard();

        if (brd) mratio = brd.GetDesignSettings().m_SolderPasteMarginRatio;
      }
    }

    const cuLayer = aLayer === PCB_LAYER_ID.B_Paste ? PCB_LAYER_ID.B_Cu : PCB_LAYER_ID.F_Cu;
    const padSize = this.m_padStack.Size(cuLayer);
    const pad_margin: VECTOR2I = { x: 0, y: 0 };
    pad_margin.x = (margin ?? 0) + KiROUND(padSize.x * (mratio ?? 0));
    pad_margin.y = (margin ?? 0) + KiROUND(padSize.y * (mratio ?? 0));

    // ensure paste have a size always >= 0
    if (this.m_padStack.Shape(aLayer) !== PAD_SHAPE.CUSTOM) {
      if (pad_margin.x < -Math.trunc(padSize.x / 2)) pad_margin.x = -Math.trunc(padSize.x / 2);

      if (pad_margin.y < -Math.trunc(padSize.y / 2)) pad_margin.y = -Math.trunc(padSize.y / 2);
    }

    return pad_margin;
  }

  GetZoneConnectionOverrides(aSource: OutStr | null = null): ZONE_CONNECTION {
    let connection = this.m_padStack.ZoneConnection() ?? ZONE_CONNECTION.INHERITED;

    if (connection !== ZONE_CONNECTION.INHERITED) {
      if (aSource) aSource.value = 'pad';
    }

    if (connection === ZONE_CONNECTION.INHERITED) {
      const parentFootprint = this.GetParentFootprint() as FOOTPRINT | null;

      if (parentFootprint) connection = parentFootprint.GetZoneConnectionOverrides(aSource);
    }

    return connection;
  }

  /**
   * Set the width of the thermal spokes connecting the pad to a zone.  If != 0 this will
   * override similar settings in the parent footprint and zone.
   */
  SetLocalThermalSpokeWidthOverride(aWidth: number | undefined): void {
    this.m_padStack.SetThermalSpokeWidth(aWidth);
  }
  GetLocalThermalSpokeWidthOverride(): number | undefined {
    return this.m_padStack.ThermalSpokeWidth();
  }

  GetLocalSpokeWidthOverride(aSource: OutStr | null = null): number {
    if (this.m_padStack.ThermalSpokeWidth() !== undefined && aSource) aSource.value = 'pad';

    return this.m_padStack.ThermalSpokeWidth() ?? 0;
  }

  /**
   * The orientation of the thermal spokes.  45° will produce an X (the default for circular
   * pads and circular-anchored custom shaped pads), while 90° will produce a + (the default
   * for all other shapes).
   */
  SetThermalSpokeAngle(aAngle: EDA_ANGLE): void {
    this.m_padStack.SetThermalSpokeAngle(aAngle);
  }
  GetThermalSpokeAngle(): EDA_ANGLE {
    return this.m_padStack.ThermalSpokeAngle();
  }

  // For property system
  SetThermalSpokeAngleDegrees(aAngle: number): void {
    this.m_padStack.SetThermalSpokeAngle(new EDA_ANGLE(aAngle));
  }
  GetThermalSpokeAngleDegrees(): number {
    return this.m_padStack.ThermalSpokeAngle().AsDegrees();
  }

  SetThermalGap(aGap: number): void {
    this.m_padStack.SetThermalGap(aGap);
  }
  GetThermalGap(): number {
    return this.m_padStack.ThermalGap() ?? 0;
  }

  /** `GetLocalThermalGapOverride( wxString* aSource )` (a value) and `GetLocalThermalGapOverride()` (an optional). */
  GetLocalThermalGapOverride(aSource: OutStr | null): number;
  GetLocalThermalGapOverride(): number | undefined;
  GetLocalThermalGapOverride(aSource?: OutStr | null): number | undefined {
    if (aSource === undefined) return this.m_padStack.ThermalGap();

    if (this.m_padStack.ThermalGap() !== undefined && aSource) aSource.value = 'pad';

    return this.GetLocalThermalGapOverride() ?? 0;
  }

  SetLocalThermalGapOverride(aOverride: number | undefined): void {
    this.m_padStack.SetThermalGap(aOverride);
  }

  /**
   * Has meaning only for rounded rectangle pads.
   *
   * @return The radius of the rounded corners for this pad.
   */
  SetRoundRectCornerRadius(aLayer: PCB_LAYER_ID, aRadius: number): void {
    this.m_padStack.SetRoundRectRadius(aRadius, aLayer);
  }
  GetRoundRectCornerRadius(aLayer: PCB_LAYER_ID): number {
    return this.m_padStack.RoundRectRadius(aLayer);
  }

  ShapePos(aLayer: PCB_LAYER_ID): VECTOR2I {
    let loc_offset = this.m_padStack.Offset(aLayer);

    if (loc_offset.x === 0 && loc_offset.y === 0) return this.m_pos;

    loc_offset = RotatePoint(loc_offset, this.GetOrientation());

    const shape_pos = add(this.m_pos, loc_offset);

    return shape_pos;
  }

  /**
   * Swap the visible shape positions of two pads, preserving each pad's own shape offset.
   *
   * Using SetPosition() directly would swap anchor (hole) positions, which leaves each pad's
   * copper shape displaced by its own offset after the swap.  This helper computes the new
   * anchor for each pad so the visible shape centers (ShapePos) are exchanged.
   */
  static SwapShapePositions(aLhs: PAD | null, aRhs: PAD | null): void {
    if (!(aLhs && aRhs)) return; // wxCHECK

    const lhsShapePos = aLhs.ShapePos(PADSTACK.ALL_LAYERS);
    const rhsShapePos = aRhs.ShapePos(PADSTACK.ALL_LAYERS);

    let lhsOffset = aLhs.GetOffset(PADSTACK.ALL_LAYERS);
    let rhsOffset = aRhs.GetOffset(PADSTACK.ALL_LAYERS);

    lhsOffset = RotatePoint(lhsOffset, aLhs.GetOrientation());
    rhsOffset = RotatePoint(rhsOffset, aRhs.GetOrientation());

    aLhs.SetPosition(sub(rhsShapePos, lhsOffset));
    aRhs.SetPosition(sub(lhsShapePos, rhsOffset));
  }

  /**
   * Has meaning only for rounded rectangle pads.
   *
   * Set the ratio between the smaller X or Y size and the rounded corner radius.
   * Cannot be > 0.5; the normalized IPC-7351C value is 0.25
   */
  SetRoundRectRadiusRatio(aLayer: PCB_LAYER_ID, aRadiusScale: number): void {
    this.m_padStack.SetRoundRectRadiusRatio(Math.min(Math.max(aRadiusScale, 0.0), 0.5), aLayer);

    this.SetDirty();
  }
  GetRoundRectRadiusRatio(aLayer: PCB_LAYER_ID): number {
    return this.m_padStack.RoundRectRadiusRatio(aLayer);
  }

  // For properties panel, which only supports normal padstacks
  SetFrontRoundRectRadiusRatio(aRadiusScale: number): void {
    console.assert(
      this.m_padStack.Mode() === PADSTACK_MODE.NORMAL,
      'Set front radius only meaningful for normal padstacks',
    );
    this.m_padStack.SetRoundRectRadiusRatio(
      Math.min(Math.max(aRadiusScale, 0.0), 0.5),
      PCB_LAYER_ID.F_Cu,
    );

    this.SetDirty();
  }
  GetFrontRoundRectRadiusRatio(): number {
    return this.m_padStack.RoundRectRadiusRatio(PCB_LAYER_ID.F_Cu);
  }

  // For properties panel, which only supports normal padstacks
  SetFrontRoundRectRadiusSize(aRadius: number): void {
    const size = this.m_padStack.Size(PCB_LAYER_ID.F_Cu);
    const minSize = Math.min(size.x, size.y);
    const newRatio = aRadius / minSize;

    this.SetFrontRoundRectRadiusRatio(newRatio);
  }
  GetFrontRoundRectRadiusSize(): number {
    const size = this.m_padStack.Size(PCB_LAYER_ID.F_Cu);
    const minSize = Math.min(size.x, size.y);
    const ratio = this.GetFrontRoundRectRadiusRatio();

    return KiROUND(ratio * minSize);
  }

  /**
   * Has meaning only for chamfered rectangular pads.
   *
   * Set the ratio between the smaller X or Y size and chamfered corner size.
   * Cannot be < 0.5.
   */
  SetChamferRectRatio(aLayer: PCB_LAYER_ID, aChamferScale: number): void {
    this.m_padStack.SetChamferRatio(aChamferScale, aLayer);

    this.SetDirty();
  }
  GetChamferRectRatio(aLayer: PCB_LAYER_ID): number {
    return this.m_padStack.ChamferRatio(aLayer);
  }

  /**
   * Has meaning only for chamfered rectangular pads.
   *
   * Set the position of the chamfers for orientation 0.
   *
   * @param aPositions a bit-set of #RECT_CHAMFER_POSITIONS.
   */
  SetChamferPositions(aLayer: PCB_LAYER_ID, aPositions: number): void {
    this.m_padStack.SetChamferPositions(aPositions, aLayer);
  }
  GetChamferPositions(aLayer: PCB_LAYER_ID): number {
    return this.m_padStack.ChamferPositions(aLayer);
  }

  /**
   * @return the netcode.
   */
  GetSubRatsnest(): number {
    return this.m_subRatsnest;
  }
  SetSubRatsnest(aSubRatsnest: number): void {
    this.m_subRatsnest = aSubRatsnest;
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
  SetKeepTopBottom(aSet: boolean): void {
    this.m_padStack.SetUnconnectedLayerMode(
      aSet ? UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END : UNCONNECTED_LAYER_MODE.REMOVE_ALL,
    );
  }

  GetKeepTopBottom(): boolean {
    return (
      this.m_padStack.UnconnectedLayerMode() === UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END
    );
  }

  SetUnconnectedLayerMode(aMode: UNCONNECTED_LAYER_MODE): void {
    this.m_padStack.SetUnconnectedLayerMode(aMode);
  }

  GetUnconnectedLayerMode(): UNCONNECTED_LAYER_MODE {
    return this.m_padStack.UnconnectedLayerMode();
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

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    const frame = aFrame as MSG_PANEL_FRAME;
    let msg: string;
    const parentFootprint = this.m_parent as FOOTPRINT | null;

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME) {
      if (parentFootprint)
        aList.push(new MSG_PANEL_ITEM('Footprint', parentFootprint.GetReference()));
    }

    aList.push(new MSG_PANEL_ITEM('Pad', this.m_number));

    if (this.GetPinFunction() !== '')
      aList.push(new MSG_PANEL_ITEM('Pin Name', this.GetPinFunction()));

    if (this.GetPinType() !== '') aList.push(new MSG_PANEL_ITEM('Pin Type', this.GetPinType()));

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME) {
      aList.push(new MSG_PANEL_ITEM('Net', unescapeString(this.GetNetname())));
      aList.push(
        new MSG_PANEL_ITEM(
          'Resolved Netclass',
          unescapeString(this.GetEffectiveNetClass().GetHumanReadableName()),
        ),
      );

      if (this.IsLocked()) aList.push(new MSG_PANEL_ITEM('Status', 'Locked'));
    }

    if (this.GetAttribute() === PAD_ATTRIB.SMD || this.GetAttribute() === PAD_ATTRIB.CONN)
      aList.push(new MSG_PANEL_ITEM('Layer', this.LayerMaskDescribe()));

    if (aFrame.GetName() === FOOTPRINT_EDIT_FRAME_NAME) {
      if (this.GetAttribute() === PAD_ATTRIB.SMD) {
        // TOOD(JE) padstacks
        const poly = this.GetEffectivePolygon(PADSTACK.ALL_LAYERS);
        const area = poly.Area();
        aList.push(new MSG_PANEL_ITEM('Area', frame.MessageTextFromValue(area, true, 'area')));
      }
    }

    // Show the pad shape, attribute and property
    let props = this.ShowPadAttr();

    if (this.GetProperty() !== PAD_PROP.NONE) props += ',';

    switch (this.GetProperty()) {
      case PAD_PROP.NONE:
        break;
      case PAD_PROP.BGA:
        props += 'BGA';
        break;
      case PAD_PROP.FIDUCIAL_GLBL:
        props += 'Fiducial global';
        break;
      case PAD_PROP.FIDUCIAL_LOCAL:
        props += 'Fiducial local';
        break;
      case PAD_PROP.TESTPOINT:
        props += 'Test point';
        break;
      case PAD_PROP.HEATSINK:
        props += 'Heat sink';
        break;
      case PAD_PROP.CASTELLATED:
        props += 'Castellated';
        break;
      case PAD_PROP.MECHANICAL:
        props += 'Mechanical';
        break;
      case PAD_PROP.PRESSFIT:
        props += 'Press-fit';
        break;
    }

    // TODO(JE) How to show complex padstack info in the message panel
    aList.push(new MSG_PANEL_ITEM(this.ShowPadShape(PADSTACK.ALL_LAYERS), props));

    const padShape = this.GetShape(PADSTACK.ALL_LAYERS);
    const padSize = this.m_padStack.Size(PADSTACK.ALL_LAYERS);

    if ((padShape === PAD_SHAPE.CIRCLE || padShape === PAD_SHAPE.OVAL) && padSize.x === padSize.y) {
      aList.push(new MSG_PANEL_ITEM('Diameter', frame.MessageTextFromValue(padSize.x)));
    } else {
      aList.push(new MSG_PANEL_ITEM('Width', frame.MessageTextFromValue(padSize.x)));
      aList.push(new MSG_PANEL_ITEM('Height', frame.MessageTextFromValue(padSize.y)));
    }

    const fp_orient = parentFootprint ? parentFootprint.GetOrientation() : ANGLE_0;
    const pad_orient = this.GetOrientation().sub(fp_orient);
    pad_orient.Normalize180();

    // wxT( "%g" ): six significant digits
    if (!fp_orient.IsZero())
      msg = `${formatG(pad_orient.AsDegrees(), 6)}(+ ${formatG(fp_orient.AsDegrees(), 6)})`;
    else msg = formatG(this.GetOrientation().AsDegrees(), 6);

    aList.push(new MSG_PANEL_ITEM('Rotation', msg));

    if (this.GetPadToDieLength()) {
      aList.push(
        new MSG_PANEL_ITEM(
          'Length in Package',
          frame.MessageTextFromValue(this.GetPadToDieLength()),
        ),
      );
    }

    const drill = this.m_padStack.Drill().size;

    if (drill.x > 0 || drill.y > 0) {
      if (this.GetDrillShape() === PAD_DRILL_SHAPE.CIRCLE) {
        aList.push(new MSG_PANEL_ITEM('Hole', `${frame.MessageTextFromValue(drill.x)}`));
      } else {
        aList.push(
          new MSG_PANEL_ITEM(
            'Hole X / Y',
            `${frame.MessageTextFromValue(drill.x)} / ${frame.MessageTextFromValue(drill.y)}`,
          ),
        );
      }
    }

    const source: OutStr = { value: '' };
    const clearance = this.GetOwnClearance(PCB_LAYER_ID.UNDEFINED_LAYER, source);

    if (source.value !== '') {
      aList.push(
        new MSG_PANEL_ITEM(
          `Min Clearance: ${frame.MessageTextFromValue(clearance)}`,
          `(from ${source.value})`,
        ),
      );
    }

    // #if 0
    // useful for debug only
    // aList.emplace_back( wxT( "UUID" ), m_Uuid.AsString() );
    // #endif
  }

  override IsOnLayer(aLayer: PCB_LAYER_ID): boolean {
    return this.m_padStack.LayerSet().test(aLayer);
  }

  /**
   * Check to see whether the pad should be flashed on the specific layer.
   *
   * @param aLayer Layer to check for connectivity
   * @param aOnlyCheckIfPermitted indicates that the routine should just return whether or not
   *        a flashed connection is permitted on this layer (without checking for a connection)
   * @return true if connected by pad or track (or optionally zone)
   */
  FlashLayer(aLayer: number, aOnlyCheckIfPermitted?: boolean): boolean;
  /**
   * Check to see if the pad should be flashed to any of the layers in the set.
   *
   * @param aLayers set of layers to check the via against
   * @return true if connected by pad or track (or optionally zone) on any of the associated
   *         layers
   */
  FlashLayer(aLayers: LSET): boolean;
  FlashLayer(a: number | LSET, aOnlyCheckIfPermitted = false): boolean {
    if (a instanceof LSET) {
      for (const layer of a) {
        if (this.FlashLayer(layer)) return true;
      }

      return false;
    }

    let aLayer = a;

    if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) return true;

    // Sometimes this is called with GAL layers and should just return true
    if (aLayer > PCB_LAYER_ID.PCB_LAYER_ID_COUNT) return true;

    const layer = aLayer as PCB_LAYER_ID;

    if (!this.IsOnLayer(layer)) return false;

    if (this.GetAttribute() === PAD_ATTRIB.NPTH && IsCopperLayer(aLayer)) {
      if (
        this.GetShape(layer) === PAD_SHAPE.CIRCLE &&
        this.GetDrillShape() === PAD_DRILL_SHAPE.CIRCLE
      ) {
        if (
          equal(this.GetOffset(layer), { x: 0, y: 0 }) &&
          this.GetDrillSize().x >= this.GetSize(layer).x
        )
          return false;
      } else if (
        this.GetShape(layer) === PAD_SHAPE.OVAL &&
        this.GetDrillShape() === PAD_DRILL_SHAPE.OBLONG
      ) {
        if (
          equal(this.GetOffset(layer), { x: 0, y: 0 }) &&
          this.GetDrillSize().x >= this.GetSize(layer).x &&
          this.GetDrillSize().y >= this.GetSize(layer).y
        ) {
          return false;
        }
      }
    }

    if (LSET.FrontBoardTechMask().test(aLayer)) aLayer = PCB_LAYER_ID.F_Cu;
    else if (LSET.BackBoardTechMask().test(aLayer)) aLayer = PCB_LAYER_ID.B_Cu;

    if (this.GetAttribute() === PAD_ATTRIB.PTH && IsCopperLayer(aLayer)) {
      const mode = this.m_padStack.UnconnectedLayerMode();

      if (mode === UNCONNECTED_LAYER_MODE.KEEP_ALL) return true;

      // Plated through hole pads need copper on the top/bottom layers for proper soldering
      // Unless the user has removed them in the pad dialog
      if (mode === UNCONNECTED_LAYER_MODE.START_END_ONLY) {
        return aLayer === this.m_padStack.Drill().start || aLayer === this.m_padStack.Drill().end;
      }

      if (
        mode === UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END &&
        IsExternalCopperLayer(aLayer)
      ) {
        return true;
      }

      const board = this.GetBoard();

      if (board) {
        if (this.GetZoneLayerOverride(layer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED) {
          return true;
        } else if (aOnlyCheckIfPermitted) {
          return true;
        } else {
          // static std::initializer_list<KICAD_T> nonZoneTypes = { PCB_TRACE_T, PCB_ARC_T, PCB_VIA_T, PCB_PAD_T };
          // return board->GetConnectivity()->IsConnectedOnLayer( this, aLayer, nonZoneTypes );
          //                                                   -- CONNECTIVITY_DATA pending (#636 stage 2): flashed
          return true;
        }
      }
    }

    return true;
  }

  CanFlashLayer(aLayer: number): boolean {
    return this.FlashLayer(aLayer, true);
  }

  override GetLayer(): PCB_LAYER_ID {
    return BOARD_ITEM.prototype.GetLayer.call(this);
  }

  /**
   * @return the principal copper layer for SMD and CONN pads.
   */
  GetPrincipalLayer(): PCB_LAYER_ID {
    if (
      this.m_attribute === PAD_ATTRIB.SMD ||
      this.m_attribute === PAD_ATTRIB.CONN ||
      this.GetLayerSet().none()
    )
      return this.m_layer;
    else return this.GetLayerSet().Seq()[0]!;
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  /**
   * return true if hit test on the specified layer
   */
  override HitTest(aPosition: VECTOR2I, aAccuracy: number, aLayer: PCB_LAYER_ID): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) return this.hitTestRect(a, b as boolean, c ?? 0);

    if ('x' in a && 'y' in a) {
      if (c !== undefined) return this.hitTestPointOnLayer(a, b as number, c as PCB_LAYER_ID);

      return this.hitTestPoint(a, (b as number | undefined) ?? 0);
    }

    return this.hitTestChain(a, b as boolean);
  }

  /** `HitTest( const VECTOR2I& aPosition, int aAccuracy, PCB_LAYER_ID aLayer )`. */
  private hitTestPointOnLayer(
    aPosition: VECTOR2I,
    aAccuracy: number,
    aLayer: PCB_LAYER_ID,
  ): boolean {
    if (!this.IsOnLayer(aLayer)) return false;

    const delta = sub(aPosition, this.GetPosition());
    const boundingRadius = this.GetBoundingRadius() + aAccuracy;

    if (delta.x * delta.x + delta.y * delta.y > SEG.Square(boundingRadius)) return false;

    const contains = this.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_INSIDE).Contains(
      aPosition,
      -1,
      aAccuracy,
    );

    return contains;
  }

  /** `HitTest( const VECTOR2I& aPosition, int aAccuracy )`. */
  private hitTestPoint(aPosition: VECTOR2I, aAccuracy: number): boolean {
    const delta = sub(aPosition, this.GetPosition());
    const boundingRadius = this.GetBoundingRadius() + aAccuracy;

    if (delta.x * delta.x + delta.y * delta.y > SEG.Square(boundingRadius)) return false;

    let contains = false;

    this.Padstack().ForEachUniqueLayer((l: PCB_LAYER_ID) => {
      if (contains) return;

      if (this.GetEffectivePolygon(l, ERROR_LOC.ERROR_INSIDE).Contains(aPosition, -1, aAccuracy))
        contains = true;
    });

    contains ||= this.GetEffectiveHoleShape().Collide(aPosition, aAccuracy);

    return contains;
  }

  /** `HitTest( const BOX2I& aRect, bool aContained, int aAccuracy )`. */
  private hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    const arect = new BOX2I(aRect.GetPosition(), aRect.GetSize());
    arect.Normalize();
    arect.Inflate(aAccuracy);

    const bbox = this.GetBoundingBox();

    if (aContained) {
      return arect.Contains(bbox);
    } else {
      // Fast test: if aRect is outside the polygon bounding box,
      // rectangles cannot intersect
      if (!arect.Intersects(bbox)) return false;

      let hit = false;

      this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
        if (hit) return;

        const poly = this.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_INSIDE);

        const count = poly.TotalVertices();

        for (let ii = 0; ii < count; ii++) {
          const vertex = poly.CVertex(ii);
          const vertexNext = poly.CVertex((ii + 1) % count);

          // Test if the point is within aRect
          if (arect.Contains(vertex)) {
            hit = true;
            break;
          }

          // Test if this edge intersects aRect
          if (arect.Intersects(vertex, vertexNext)) {
            hit = true;
            break;
          }
        }
      });

      if (!hit) {
        const rect = new SHAPE_RECT(arect);
        hit ||= this.GetEffectiveHoleShape().Collide(rect);
      }

      return hit;
    }
  }

  /** `HitTest( const SHAPE_LINE_CHAIN& aPoly, bool aContained )`. */
  private hitTestChain(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean {
    const effectiveShape = new SHAPE_COMPOUND();

    // Add padstack shapes
    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      effectiveShape.AddShape(this.GetEffectiveShape(aLayer));
    });

    // Add hole shape
    effectiveShape.AddShape(this.GetEffectiveHoleShape());

    return KIGEOM_ShapeHitTest(aPoly, effectiveShape, aContained);
  }

  /**
   * Recombines the pad with other graphical shapes in the footprint
   *
   * @param aIsDryRun if true, the pad will not be recombined but the operation will still be logged
   * @param aMaxError the maximum error to allow for converting arcs to polygons
   * @return a list of shapes that were recombined
   */
  Recombine(aIsDryRun: boolean, maxError: number): PCB_SHAPE[] {
    const footprint = this.GetParentFootprint() as FOOTPRINT;

    for (const item of footprint.GraphicalItems()) item.ClearFlags(SKIP_STRUCT);

    const findNext = (aLayer: PCB_LAYER_ID): PCB_SHAPE | null => {
      const padPoly = new SHAPE_POLY_SET();
      this.TransformShapeToPolygon(padPoly, aLayer, 0, maxError, ERROR_LOC.ERROR_INSIDE);

      for (const item of footprint.GraphicalItems()) {
        const shape = item instanceof PCB_SHAPE ? item : null;

        if (!shape || shape.GetFlags() & SKIP_STRUCT) continue;

        if (shape.GetLayer() !== aLayer) continue;

        if (shape.IsProxyItem())
          // Pad number (and net name) box
          return shape;

        const drawPoly = new SHAPE_POLY_SET();
        shape.TransformShapeToPolygon(drawPoly, aLayer, 0, maxError, ERROR_LOC.ERROR_INSIDE);
        drawPoly.BooleanIntersection(padPoly);

        if (!drawPoly.IsEmpty()) return shape;
      }

      return null;
    };

    const findMatching = (aShape: PCB_SHAPE): PCB_SHAPE[] => {
      const matching: PCB_SHAPE[] = [];

      for (const item of footprint.GraphicalItems()) {
        const other = item instanceof PCB_SHAPE ? item : null;

        if (!other || other.GetFlags() & SKIP_STRUCT) continue;

        if (
          this.GetLayerSet().test(other.GetLayer()) &&
          aShape.Compare(other as unknown as EDA_SHAPE) === 0
        )
          matching.push(other);
      }

      return matching;
    };

    let layer: PCB_LAYER_ID;
    const mergedShapes: PCB_SHAPE[] = [];

    if (this.IsOnLayer(PCB_LAYER_ID.F_Cu)) layer = PCB_LAYER_ID.F_Cu;
    else if (this.IsOnLayer(PCB_LAYER_ID.B_Cu)) layer = PCB_LAYER_ID.B_Cu;
    else layer = this.GetLayerSet().UIOrder()[0]!;

    const origShape = this.GetShape(layer);

    // If there are intersecting items to combine, we need to first make sure the pad is a
    // custom-shape pad.
    if (!aIsDryRun && findNext(layer) && origShape !== PAD_SHAPE.CUSTOM) {
      if (origShape === PAD_SHAPE.CIRCLE || origShape === PAD_SHAPE.RECTANGLE) {
        // Use the existing pad as an anchor
        this.SetAnchorPadShape(layer, origShape);
        this.SetShape(layer, PAD_SHAPE.CUSTOM);
      } else {
        // Create a new circular anchor and convert existing pad to a polygon primitive
        const existingOutline = new SHAPE_POLY_SET();
        this.TransformShapeToPolygon(existingOutline, layer, 0, maxError, ERROR_LOC.ERROR_INSIDE);

        const minExtent = Math.min(this.GetSize(layer).x, this.GetSize(layer).y);
        this.SetAnchorPadShape(layer, PAD_SHAPE.CIRCLE);
        this.SetSize(layer, { x: minExtent, y: minExtent });
        this.SetShape(layer, PAD_SHAPE.CUSTOM);

        const shape = new PCB_SHAPE(null, SHAPE_T.POLY);
        shape.SetFilled(true);
        shape.SetStroke(new STROKE_PARAMS(0, LINE_STYLE.SOLID));
        shape.SetPolyShape(existingOutline);
        shape.Move({ x: -this.ShapePos(layer).x, y: -this.ShapePos(layer).y });
        shape.Rotate({ x: 0, y: 0 }, this.GetOrientation().negate());
        this.AddPrimitive(layer, shape);
      }
    }

    for (let fpShape = findNext(layer); fpShape; fpShape = findNext(layer)) {
      fpShape.SetFlags(SKIP_STRUCT);
      mergedShapes.push(fpShape);

      if (!aIsDryRun) {
        // If the editor was inside a group when the pad was exploded, the added exploded shapes
        // will be part of the group.  Remove them here before duplicating; we don't want the
        // primitives to wind up in a group.
        const group = fpShape.GetParentGroup();

        if (group) group.RemoveItem(fpShape);

        const primitive = fpShape.Duplicate(IGNORE_PARENT_GROUP) as PCB_SHAPE;
        primitive.SetParent(null);

        // Convert any hatched fills to solid
        if (primitive.IsAnyFill()) primitive.SetFillMode(FILL_T.FILLED_SHAPE);

        primitive.Move({ x: -this.ShapePos(layer).x, y: -this.ShapePos(layer).y });
        primitive.Rotate({ x: 0, y: 0 }, this.GetOrientation().negate());

        this.AddPrimitive(layer, primitive);
      }

      // See if there are other shapes that match and mark them for delete.  (KiCad won't
      // produce these, but old footprints from other vendors have them.)
      for (const other of findMatching(fpShape)) {
        other.SetFlags(SKIP_STRUCT);
        mergedShapes.push(other);
      }
    }

    for (const item of footprint.GraphicalItems()) item.ClearFlags(SKIP_STRUCT);

    if (!aIsDryRun) this.ClearFlags(ENTERED);

    return mergedShapes;
  }

  GetClass(): string {
    return 'PAD';
  }

  /**
   * The bounding box is cached, so this will be efficient most of the time.
   */
  override GetBoundingBox(aLayer?: PCB_LAYER_ID): BOX2I {
    // Thermal spokes are built on the bounding box, so we must have a layer-specific version
    if (aLayer !== undefined) return this.buildEffectiveShape(aLayer).BBox();

    if (this.m_shapesDirty) this.BuildEffectiveShapes();

    return this.getDrawCache().m_effectiveBoundingBox;
  }

  /**
   * Compare two pads and return 0 if they are equal.
   *
   * @return less than 0 if left less than right, 0 if equal, or greater than 0 if left
   *         greater than right.
   */
  static Compare(aPadRef: PAD, aPadCmp: PAD): number {
    let diff: number;

    diff = aPadRef.m_attribute - aPadCmp.m_attribute;
    if (diff !== 0) return diff;

    return PADSTACK.Compare(aPadRef.Padstack(), aPadCmp.Padstack());
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_pos = add(this.m_pos, aMoveVector);
    this.SetDirty();
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_pos = RotatePoint(this.m_pos, aRotCentre, aAngle);
    this.m_padStack.SetOrientation(this.m_padStack.GetOrientation().add(aAngle));
    this.SetDirty();
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    let parentFP = this.GetParentFootprint() as FOOTPRINT | null;

    // Don't report parent footprint info from footprint editor, viewer, etc.
    if (this.GetBoard() && this.GetBoard()!.GetBoardUse() === BOARD_USE.FPHOLDER) parentFP = null;

    if (this.GetAttribute() === PAD_ATTRIB.NPTH) {
      if (parentFP) return `NPTH pad of ${parentFP.GetReference()}`;
      else return 'NPTH pad';
    } else if (this.GetNumber() === '') {
      if (this.GetAttribute() === PAD_ATTRIB.SMD || this.GetAttribute() === PAD_ATTRIB.CONN) {
        if (parentFP) {
          return `Pad ${this.GetNetnameMsg()} of ${parentFP.GetReference()} on ${this.LayerMaskDescribe()}`;
        } else {
          return `Pad on ${this.LayerMaskDescribe()}`;
        }
      } else {
        if (parentFP) {
          return `PTH pad ${this.GetNetnameMsg()} of ${parentFP.GetReference()}`;
        } else {
          return 'PTH pad';
        }
      }
    } else {
      if (this.GetAttribute() === PAD_ATTRIB.SMD || this.GetAttribute() === PAD_ATTRIB.CONN) {
        if (parentFP) {
          return `Pad ${this.GetNumber()} ${this.GetNetnameMsg()} of ${parentFP.GetReference()} on ${this.LayerMaskDescribe()}`;
        } else {
          return `Pad ${this.GetNumber()} on ${this.LayerMaskDescribe()}`;
        }
      } else {
        if (parentFP) {
          return `PTH pad ${this.GetNumber()} ${this.GetNetnameMsg()} of ${parentFP.GetReference()}`;
        } else {
          return `PTH pad ${this.GetNumber()}`;
        }
      }
    }
  }

  override GetMenuImage(): string {
    return 'pad';
  }

  /**
   * @return the GUI-appropriate name of the shape.
   */
  static ShowPadShape(aShape: PAD_SHAPE): string {
    switch (aShape) {
      case PAD_SHAPE.CIRCLE:
        return 'Circle';
      case PAD_SHAPE.OVAL:
        return 'Oval';
      case PAD_SHAPE.RECTANGLE:
        return 'Rectangle';
      case PAD_SHAPE.TRAPEZOID:
        return 'Trapezoid';
      case PAD_SHAPE.ROUNDRECT:
        return 'Rounded rectangle';
      case PAD_SHAPE.CHAMFERED_RECT:
        return 'Chamfered rectangle';
      case PAD_SHAPE.CUSTOM:
        return 'Custom shape';
      default:
        return '???';
    }
  }

  ShowPadShape(aLayer: PCB_LAYER_ID): string {
    return PAD.ShowPadShape(this.GetShape(aLayer));
  }

  /**
   * An older version still used by place file writer and SWIG interface.
   */
  ShowLegacyPadShape(aLayer: PCB_LAYER_ID): string {
    switch (this.GetShape(aLayer)) {
      case PAD_SHAPE.CIRCLE:
        return 'Circle';
      case PAD_SHAPE.OVAL:
        return 'Oval';
      case PAD_SHAPE.RECTANGLE:
        return 'Rect';
      case PAD_SHAPE.TRAPEZOID:
        return 'Trap';
      case PAD_SHAPE.ROUNDRECT:
        return 'Roundrect';
      case PAD_SHAPE.CHAMFERED_RECT:
        return 'Chamferedrect';
      case PAD_SHAPE.CUSTOM:
        return 'CustomShape';
      default:
        return '???';
    }
  }

  /**
   * @return the GUI-appropriate description of the pad type (attribute) : Std, SMD ...
   */
  ShowPadAttr(): string {
    switch (this.GetAttribute()) {
      case PAD_ATTRIB.PTH:
        return 'PTH';
      case PAD_ATTRIB.SMD:
        return 'SMD';
      case PAD_ATTRIB.CONN:
        return 'Conn';
      case PAD_ATTRIB.NPTH:
        return 'NPTH';
      default:
        return '???';
    }
  }

  override Clone(): PAD {
    const cloned = PAD.copyOfPad(this);

    // Ensure the cloned primitives of the pad stack have the right parent
    cloned.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      for (const primitive of cloned.m_padStack.Primitives(aLayer)) primitive.SetParent(cloned);
    });

    return cloned;
  }

  /**
   * Same as Clone, but returns a PAD item.
   *
   * Useful mainly for python scripts, because Clone returns an EDA_ITEM.
   */
  ClonePad(): PAD {
    return this.Clone();
  }

  /**
   * Rebuild the effective shape cache (and bounding box and radius) for the pad and clears
   * the dirty bit.
   */
  BuildEffectiveShapes(): void {
    // If we had to wait for the lock then we were probably waiting for someone else to
    // finish rebuilding the shapes.  So check to see if they're clean now.
    if (!this.m_shapesDirty) return;

    const drawCache = this.getDrawCache();

    drawCache.m_effectiveBoundingBox = new BOX2I();
    drawCache.m_effectiveShapes.clear();

    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      const layerShape = this.buildEffectiveShape(aLayer);
      drawCache.m_effectiveBoundingBox.Merge(layerShape.BBox());
    });

    // Hole shape
    drawCache.m_effectiveHoleShape = null;

    const half_size: VECTOR2I = {
      x: Math.trunc(this.m_padStack.Drill().size.x / 2),
      y: Math.trunc(this.m_padStack.Drill().size.y / 2),
    };
    let half_width: number;
    let half_len: VECTOR2I = { x: 0, y: 0 };

    if (this.m_padStack.Drill().shape === PAD_DRILL_SHAPE.CIRCLE) {
      half_width = half_size.x;
    } else {
      half_width = Math.min(half_size.x, half_size.y);
      half_len = { x: half_size.x - half_width, y: half_size.y - half_width };
    }

    half_len = RotatePoint(half_len, this.GetOrientation());

    drawCache.m_effectiveHoleShape = new SHAPE_SEGMENT(
      sub(this.m_pos, half_len),
      add(this.m_pos, half_len),
      half_width * 2,
    );
    drawCache.m_effectiveBoundingBox.Merge(drawCache.m_effectiveHoleShape.BBox());

    // All done
    this.m_shapesDirty = false;
  }

  private buildEffectiveShape(aLayer: PCB_LAYER_ID): SHAPE_COMPOUND {
    const drawCache = this.getDrawCache();
    const compound = new SHAPE_COMPOUND();
    drawCache.m_effectiveShapes.set(aLayer, compound);

    const add_ = (aShape: SHAPE): void => {
      this.getDrawCache().m_effectiveShapes.get(aLayer)!.AddShape(aShape);
    };

    const shapePos = this.ShapePos(aLayer); // Fetch only once; rotation involves trig
    let effectiveShape = this.GetShape(aLayer);
    const size = this.m_padStack.Size(aLayer);

    if (effectiveShape === PAD_SHAPE.CUSTOM) effectiveShape = this.GetAnchorPadShape(aLayer);

    switch (effectiveShape) {
      case PAD_SHAPE.CIRCLE:
        add_(new SHAPE_CIRCLE(shapePos, Math.trunc(size.x / 2)));
        break;

      case PAD_SHAPE.OVAL:
        if (size.x === size.y) {
          // the oval pad is in fact a circle
          add_(new SHAPE_CIRCLE(shapePos, Math.trunc(size.x / 2)));
        } else {
          const half_size: VECTOR2I = { x: Math.trunc(size.x / 2), y: Math.trunc(size.y / 2) };
          const half_width = Math.min(half_size.x, half_size.y);
          let half_len: VECTOR2I = { x: half_size.x - half_width, y: half_size.y - half_width };
          half_len = RotatePoint(half_len, this.GetOrientation());
          add_(new SHAPE_SEGMENT(sub(shapePos, half_len), add(shapePos, half_len), half_width * 2));
        }

        break;

      case PAD_SHAPE.RECTANGLE:
      case PAD_SHAPE.TRAPEZOID:
      case PAD_SHAPE.ROUNDRECT: {
        const r =
          effectiveShape === PAD_SHAPE.ROUNDRECT ? this.GetRoundRectCornerRadius(aLayer) : 0;
        const half_size: VECTOR2I = { x: Math.trunc(size.x / 2), y: Math.trunc(size.y / 2) };
        let trap_delta: VECTOR2I = { x: 0, y: 0 };

        if (r) {
          half_size.x -= r;
          half_size.y -= r;

          // Avoid degenerated shapes (0 length segments) that always create issues
          // For roundrect pad very near a circle, use only a circle
          const min_len = pcbIUScale.mmToIU(0.0001);

          if (half_size.x < min_len && half_size.y < min_len) {
            add_(new SHAPE_CIRCLE(shapePos, r));
            break;
          }
        } else if (effectiveShape === PAD_SHAPE.TRAPEZOID) {
          const d = this.m_padStack.TrapezoidDeltaSize(aLayer);
          trap_delta = { x: Math.trunc(d.x / 2), y: Math.trunc(d.y / 2) };
        }

        const corners = new SHAPE_LINE_CHAIN();

        corners.Append(-half_size.x - trap_delta.y, half_size.y + trap_delta.x);
        corners.Append(half_size.x + trap_delta.y, half_size.y - trap_delta.x);
        corners.Append(half_size.x - trap_delta.y, -half_size.y + trap_delta.x);
        corners.Append(-half_size.x + trap_delta.y, -half_size.y - trap_delta.x);

        corners.Rotate(this.GetOrientation());
        corners.Move(shapePos);

        // GAL renders rectangles faster than 4-point polygons so it's worth checking if our
        // body shape is a rectangle.
        if (
          corners.PointCount() === 4 &&
          ((corners.CPoint(0).y === corners.CPoint(1).y &&
            corners.CPoint(1).x === corners.CPoint(2).x &&
            corners.CPoint(2).y === corners.CPoint(3).y &&
            corners.CPoint(3).x === corners.CPoint(0).x) ||
            (corners.CPoint(0).x === corners.CPoint(1).x &&
              corners.CPoint(1).y === corners.CPoint(2).y &&
              corners.CPoint(2).x === corners.CPoint(3).x &&
              corners.CPoint(3).y === corners.CPoint(0).y))
        ) {
          const width = Math.abs(corners.CPoint(2).x - corners.CPoint(0).x);
          const height = Math.abs(corners.CPoint(2).y - corners.CPoint(0).y);
          const pos: VECTOR2I = {
            x: Math.min(corners.CPoint(2).x, corners.CPoint(0).x),
            y: Math.min(corners.CPoint(2).y, corners.CPoint(0).y),
          };

          add_(new SHAPE_RECT(pos, width, height));
        } else {
          add_(new SHAPE_SIMPLE(corners));
        }

        if (r) {
          add_(new SHAPE_SEGMENT(corners.CPoint(0), corners.CPoint(1), r * 2));
          add_(new SHAPE_SEGMENT(corners.CPoint(1), corners.CPoint(2), r * 2));
          add_(new SHAPE_SEGMENT(corners.CPoint(2), corners.CPoint(3), r * 2));
          add_(new SHAPE_SEGMENT(corners.CPoint(3), corners.CPoint(0), r * 2));
        }

        break;
      }

      case PAD_SHAPE.CHAMFERED_RECT: {
        const outline = new SHAPE_POLY_SET();

        TransformRoundChamferedRectToPolygon(
          outline,
          shapePos,
          this.GetSize(aLayer),
          this.GetOrientation(),
          this.GetRoundRectCornerRadius(aLayer),
          this.GetChamferRectRatio(aLayer),
          this.GetChamferPositions(aLayer),
          0,
          this.GetMaxError(),
          ERROR_LOC.ERROR_INSIDE,
        );

        add_(new SHAPE_SIMPLE(outline.COutline(0)));
        break;
      }

      default:
        console.assert(
          false,
          `PAD::buildEffectiveShapes: Unsupported pad shape: PAD_SHAPE::${PAD_SHAPE[effectiveShape]}`,
        );
        break;
    }

    if (this.GetShape(aLayer) === PAD_SHAPE.CUSTOM) {
      for (const primitive of this.m_padStack.Primitives(aLayer)) {
        if (!primitive.IsProxyItem()) {
          for (const shape of primitive.MakeEffectiveShapes()) {
            shape.Rotate(this.GetOrientation());
            shape.Move(shapePos);
            add_(shape);
          }
        }
      }
    }

    return drawCache.m_effectiveShapes.get(aLayer)!;
  }

  BuildEffectivePolygon(aErrorLoc: ERROR_LOC = ERROR_LOC.ERROR_INSIDE): void {
    // Only calculate this once, not for both ERROR_INSIDE and ERROR_OUTSIDE
    const doBoundingRadius = aErrorLoc === ERROR_LOC.ERROR_OUTSIDE;

    // If we had to wait for the lock then we were probably waiting for someone else to
    // finish rebuilding the shapes.  So check to see if they're clean now.
    if (!this.m_polyDirty[aErrorLoc]) return;

    const drawCache = this.getDrawCache();

    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      // Polygon
      let entry = drawCache.m_effectivePolygons.get(aLayer);

      if (!entry) {
        entry = [null, null];
        drawCache.m_effectivePolygons.set(aLayer, entry);
      }

      const effectivePolygon = new SHAPE_POLY_SET();
      entry[aErrorLoc] = effectivePolygon;
      this.TransformShapeToPolygon(effectivePolygon, aLayer, 0, this.GetMaxError(), aErrorLoc);
    });

    if (doBoundingRadius) {
      this.m_effectiveBoundingRadius = 0;

      this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
        const effectivePolygon = drawCache.m_effectivePolygons.get(aLayer)![aErrorLoc]!;

        for (let cnt = 0; cnt < effectivePolygon.OutlineCount(); ++cnt) {
          const poly = effectivePolygon.COutline(cnt);

          for (let ii = 0; ii < poly.PointCount(); ++ii) {
            const d = sub(poly.CPoint(ii), this.m_pos);
            const dist = KiROUND(Math.hypot(d.x, d.y)); // VECTOR2I::EuclideanNorm() is a double for the KiROUND
            this.m_effectiveBoundingRadius = Math.max(this.m_effectiveBoundingRadius, dist);
          }
        }
      });

      this.m_effectiveBoundingRadius = Math.max(
        this.m_effectiveBoundingRadius,
        KiROUND(this.GetDrillSizeX() / 2.0),
      );
      this.m_effectiveBoundingRadius = Math.max(
        this.m_effectiveBoundingRadius,
        KiROUND(this.GetDrillSizeY() / 2.0),
      );
    }

    // All done
    this.m_polyDirty[aErrorLoc] = false;
  }

  override ViewGetLayers(): number[] {
    const layers: number[] = [];

    // These 2 types of pads contain a hole
    if (this.m_attribute === PAD_ATTRIB.PTH) {
      layers.push(GAL_LAYER_ID.LAYER_PAD_PLATEDHOLES);
      layers.push(GAL_LAYER_ID.LAYER_PAD_HOLEWALLS);
    }

    if (this.m_attribute === PAD_ATTRIB.NPTH) layers.push(GAL_LAYER_ID.LAYER_NON_PLATEDHOLES);

    if (this.IsLocked() || (this.GetParentFootprint() && this.GetParentFootprint()!.IsLocked()))
      layers.push(GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW);

    let cuLayers = this.m_padStack.LayerSet().and(LSET.AllCuMask());

    // Don't spend cycles rendering layers that aren't visible
    const board = this.GetBoard();

    if (board) cuLayers = cuLayers.and(board.GetEnabledLayers());

    if (cuLayers.count() > 1) {
      // Multi layer pad
      for (const layer of cuLayers.Seq()) {
        layers.push(GAL_LAYER_ID.LAYER_PAD_COPPER_START + layer);
        layers.push(GAL_LAYER_ID.LAYER_CLEARANCE_START + layer);
      }

      layers.push(NETNAMES_LAYER_ID.LAYER_PAD_NETNAMES);
    } else if (this.IsOnLayer(PCB_LAYER_ID.F_Cu)) {
      layers.push(GAL_LAYER_ID.LAYER_PAD_COPPER_START);
      layers.push(GAL_LAYER_ID.LAYER_CLEARANCE_START);

      // Is this a PTH pad that has only front copper?  If so, we need to also display the
      // net name on the PTH netname layer so that it isn't blocked by the drill hole.
      if (this.m_attribute === PAD_ATTRIB.PTH) layers.push(NETNAMES_LAYER_ID.LAYER_PAD_NETNAMES);
      else layers.push(NETNAMES_LAYER_ID.LAYER_PAD_FR_NETNAMES);
    } else if (this.IsOnLayer(PCB_LAYER_ID.B_Cu)) {
      layers.push(GAL_LAYER_ID.LAYER_PAD_COPPER_START + PCB_LAYER_ID.B_Cu);
      layers.push(GAL_LAYER_ID.LAYER_CLEARANCE_START + PCB_LAYER_ID.B_Cu);

      // Is this a PTH pad that has only back copper?  If so, we need to also display the
      // net name on the PTH netname layer so that it isn't blocked by the drill hole.
      if (this.m_attribute === PAD_ATTRIB.PTH) layers.push(NETNAMES_LAYER_ID.LAYER_PAD_NETNAMES);
      else layers.push(NETNAMES_LAYER_ID.LAYER_PAD_BK_NETNAMES);
    } else if (cuLayers.count() === 1) {
      const layer = cuLayers.Seq()[0]!;
      layers.push(GAL_LAYER_ID.LAYER_PAD_COPPER_START + layer);
      layers.push(GAL_LAYER_ID.LAYER_CLEARANCE_START + layer);
      layers.push(NETNAMES_LAYER_ID.LAYER_PAD_NETNAMES);
    }

    // Check non-copper layers. This list should include all the layers that the
    // footprint editor allows a pad to be placed on.
    const layers_mech: PCB_LAYER_ID[] = [
      PCB_LAYER_ID.F_Mask,
      PCB_LAYER_ID.B_Mask,
      PCB_LAYER_ID.F_Paste,
      PCB_LAYER_ID.B_Paste,
      PCB_LAYER_ID.F_Adhes,
      PCB_LAYER_ID.B_Adhes,
      PCB_LAYER_ID.F_SilkS,
      PCB_LAYER_ID.B_SilkS,
      PCB_LAYER_ID.Dwgs_User,
      PCB_LAYER_ID.Eco1_User,
      PCB_LAYER_ID.Eco2_User,
    ];

    for (const each_layer of layers_mech) {
      if (this.IsOnLayer(each_layer)) layers.push(each_layer);
    }

    return layers;
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    if (!aView) return PAD.LOD_SHOW;

    const renderSettings = aView.GetPainter().GetSettings();
    const board = this.GetBoard()!;

    // Meta control for hiding all pads
    if (!aView.IsLayerVisible(GAL_LAYER_ID.LAYER_PADS)) return PAD.LOD_HIDE;

    // Handle Render tab switches
    //const PCB_LAYER_ID& pcbLayer = static_cast<PCB_LAYER_ID>( aLayer );
    {
      const padLayers = this.GetLayerSet();
      const onFront = padLayers.and(LSET.FrontMask()).any();
      const onBack = padLayers.and(LSET.BackMask()).any();
      const frVis = aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_FR);
      const bkVis = aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_BK);

      if (onFront && !onBack && !frVis) return PAD.LOD_HIDE;

      if (onBack && !onFront && !bkVis) return PAD.LOD_HIDE;

      if (onFront && onBack && !frVis && !bkVis) return PAD.LOD_HIDE;
    }

    if (IsHoleLayer(aLayer)) {
      let visiblePhysical = board.GetVisibleLayers();
      visiblePhysical = visiblePhysical.and(board.GetEnabledLayers());
      visiblePhysical = visiblePhysical.and(LSET.PhysicalLayersMask());

      if (!visiblePhysical.any()) return PAD.LOD_HIDE;
    } else if (IsNetnameLayer(aLayer)) {
      if (renderSettings.GetHighContrast()) {
        // Hide netnames unless pad is flashed to a high-contrast layer
        if (!this.FlashLayer(renderSettings.GetPrimaryHighContrastLayer())) return PAD.LOD_HIDE;
      } else {
        let visible = board.GetVisibleLayers();
        visible = visible.and(board.GetEnabledLayers());

        // Hide netnames unless pad is flashed to a visible layer
        if (!this.FlashLayer(visible)) return PAD.LOD_HIDE;
      }

      // Netnames will be shown only if zoom is appropriate
      const minSize = Math.min(this.GetBoundingBox().GetWidth(), this.GetBoundingBox().GetHeight());

      return PAD.lodScaleForThreshold(aView, minSize, pcbIUScale.mmToIU(0.5));
    }

    const padSize = this.GetBoundingBox().GetSize();
    const minSide = Math.min(padSize.x, padSize.y);

    if (minSide > 0)
      return Math.min(PAD.lodScaleForThreshold(aView, minSide, pcbIUScale.mmToIU(0.2)), 3.5);

    return PAD.LOD_SHOW;
  }

  override ViewBBox(): BOX2I {
    // Bounding box includes soldermask too. Remember mask and/or paste margins can be < 0
    let solderMaskMargin = 0;
    const solderPasteMargin: VECTOR2I = { x: 0, y: 0 };

    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      solderMaskMargin = Math.max(
        solderMaskMargin,
        Math.max(this.GetSolderMaskExpansion(aLayer), 0),
      );
      const layerMargin = this.GetSolderPasteMargin(aLayer);
      solderPasteMargin.x = Math.max(solderPasteMargin.x, layerMargin.x);
      solderPasteMargin.y = Math.max(solderPasteMargin.y, layerMargin.y);
    });

    const bbox = this.GetBoundingBox();
    const clearance = 0;

    // If we're drawing clearance lines then get the biggest possible clearance
    // if( PCBNEW_SETTINGS* cfg = ... Kiface().KifaceSettings() )
    //     if( cfg->m_Display.m_PadClearance && GetBoard() ) clearance = GetBoard()->GetMaxClearanceValue();
    //                                                   -- PCBNEW_SETTINGS / BOARD::GetMaxClearanceValue pending (#636)

    // Look for the biggest possible bounding box
    const xMargin = Math.max(solderMaskMargin, solderPasteMargin.x) + clearance;
    const yMargin = Math.max(solderMaskMargin, solderPasteMargin.y) + clearance;

    return new BOX2I(
      { x: bbox.GetOrigin().x - xMargin, y: bbox.GetOrigin().y - yMargin },
      { x: bbox.GetSize().x + 2 * xMargin, y: bbox.GetSize().y + 2 * yMargin },
    );
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

  CheckPad(
    aUnitsProvider: UNITS_PROVIDER,
    aForPadProperties: boolean,
    aErrorHandler: PAD_ERROR_HANDLER,
  ): void {
    this.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      this.doCheckPad(aLayer, aUnitsProvider, aForPadProperties, aErrorHandler);
    });

    const padlayers_mask = this.GetLayerSet();
    const drill_size = this.GetDrillSize();

    if (!padlayers_mask.test(PCB_LAYER_ID.F_Cu) && !padlayers_mask.test(PCB_LAYER_ID.B_Cu)) {
      if ((drill_size.x || drill_size.y) && this.GetAttribute() !== PAD_ATTRIB.NPTH) {
        aErrorHandler(
          DRCE_PADSTACK,
          '(plated through holes normally have a copper pad on at least one outer layer)',
        );
      }
    }

    if (
      (this.GetProperty() === PAD_PROP.FIDUCIAL_GLBL ||
        this.GetProperty() === PAD_PROP.FIDUCIAL_LOCAL) &&
      this.GetAttribute() === PAD_ATTRIB.NPTH
    ) {
      aErrorHandler(DRCE_PADSTACK, "('fiducial' pads are normally plated)");
    }

    if (this.GetProperty() === PAD_PROP.TESTPOINT && this.GetAttribute() === PAD_ATTRIB.NPTH)
      aErrorHandler(DRCE_PADSTACK, "('testpoint' pads are normally plated)");

    if (this.GetProperty() === PAD_PROP.HEATSINK && this.GetAttribute() === PAD_ATTRIB.NPTH)
      aErrorHandler(DRCE_PADSTACK, "('heatsink' pads are normally plated)");

    if (this.GetProperty() === PAD_PROP.CASTELLATED && this.GetAttribute() !== PAD_ATTRIB.PTH)
      aErrorHandler(DRCE_PADSTACK, "('castellated' pads are normally PTH)");

    if (this.GetProperty() === PAD_PROP.BGA && this.GetAttribute() !== PAD_ATTRIB.SMD)
      aErrorHandler(DRCE_PADSTACK, "('BGA' property is for SMD pads)");

    if (this.GetProperty() === PAD_PROP.MECHANICAL && this.GetAttribute() !== PAD_ATTRIB.PTH)
      aErrorHandler(DRCE_PADSTACK, "('mechanical' pads are normally PTH)");

    if (
      this.GetProperty() === PAD_PROP.PRESSFIT &&
      (this.GetAttribute() !== PAD_ATTRIB.PTH || !this.HasDrilledHole())
    ) {
      aErrorHandler(DRCE_PADSTACK, "('press-fit' pads are normally PTH with round holes)");
    }

    switch (this.GetAttribute()) {
      case PAD_ATTRIB.NPTH: // Not plated, but through hole, a hole is expected
      case PAD_ATTRIB.PTH: // Pad through hole, a hole is also expected
        if (
          drill_size.x <= 0 ||
          (drill_size.y <= 0 && this.GetDrillShape() === PAD_DRILL_SHAPE.OBLONG)
        ) {
          aErrorHandler(DRCE_PAD_TH_WITH_NO_HOLE, '');
        }

        break;

      // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH
      case PAD_ATTRIB.CONN: // Connector pads are smd pads, just they do not have solder paste.
        if (
          padlayers_mask.test(PCB_LAYER_ID.B_Paste) ||
          padlayers_mask.test(PCB_LAYER_ID.F_Paste)
        ) {
          aErrorHandler(
            DRCE_PADSTACK,
            '(connector pads normally have no solder paste; use a SMD pad instead)',
          );
        }

      // KI_FALLTHROUGH;

      case PAD_ATTRIB.SMD: {
        // SMD and Connector pads (One external copper layer only)
        if (drill_size.x > 0 || drill_size.y > 0)
          aErrorHandler(DRCE_PADSTACK_INVALID, '(SMD pad has a hole)');

        const innerlayers_mask = padlayers_mask.and(LSET.InternalCuMask());

        if (this.IsOnLayer(PCB_LAYER_ID.F_Cu) && this.IsOnLayer(PCB_LAYER_ID.B_Cu)) {
          aErrorHandler(DRCE_PADSTACK, '(SMD pad has copper on both sides of the board)');
        } else if (this.IsOnLayer(PCB_LAYER_ID.F_Cu)) {
          if (this.IsOnLayer(PCB_LAYER_ID.B_Mask)) {
            aErrorHandler(
              DRCE_PADSTACK,
              '(SMD pad has copper and mask layers on different sides of the board)',
            );
          } else if (this.IsOnLayer(PCB_LAYER_ID.B_Paste)) {
            aErrorHandler(
              DRCE_PADSTACK,
              '(SMD pad has copper and paste layers on different sides of the board)',
            );
          }
        } else if (this.IsOnLayer(PCB_LAYER_ID.B_Cu)) {
          if (this.IsOnLayer(PCB_LAYER_ID.F_Mask)) {
            aErrorHandler(
              DRCE_PADSTACK,
              '(SMD pad has copper and mask layers on different sides of the board)',
            );
          } else if (this.IsOnLayer(PCB_LAYER_ID.F_Paste)) {
            aErrorHandler(
              DRCE_PADSTACK,
              '(SMD pad has copper and paste layers on different sides of the board)',
            );
          }
        } else if (innerlayers_mask.count() !== 0) {
          aErrorHandler(DRCE_PADSTACK, '(SMD pad has no outer layers)');
        }

        break;
      }
    }
  }

  private doCheckPad(
    aLayer: PCB_LAYER_ID,
    aUnitsProvider: UNITS_PROVIDER,
    aForPadProperties: boolean,
    aErrorHandler: PAD_ERROR_HANDLER,
  ): void {
    let msg: string;

    let pad_size = this.GetSize(aLayer);

    if (this.GetShape(aLayer) === PAD_SHAPE.CUSTOM) pad_size = this.GetBoundingBox().GetSize();
    else if (pad_size.x <= 0 || (pad_size.y <= 0 && this.GetShape(aLayer) !== PAD_SHAPE.CIRCLE))
      aErrorHandler(DRCE_PADSTACK_INVALID, '(Pad must have a positive size)');

    // Test hole against pad shape
    if (this.IsOnCopperLayer() && this.GetDrillSize().x > 0) {
      // Ensure the drill size can be handled in next calculations.
      // Use min size = 4 IU to be able to build a polygon from a hole shape
      const min_drill_size = 4;

      if (this.GetDrillSizeX() <= min_drill_size || this.GetDrillSizeY() <= min_drill_size) {
        msg = `(PTH pad hole size must be larger than ${aUnitsProvider.StringFromValue(min_drill_size, true)})`;
        aErrorHandler(DRCE_PADSTACK_INVALID, msg);
      }

      const padOutline = new SHAPE_POLY_SET();
      this.TransformShapeToPolygon(
        padOutline,
        aLayer,
        0,
        this.GetMaxError(),
        ERROR_LOC.ERROR_INSIDE,
      );

      if (this.GetAttribute() === PAD_ATTRIB.PTH) {
        // Test if there is copper area outside hole
        const hole = this.GetEffectiveHoleShape();
        const holeOutline = new SHAPE_POLY_SET();

        TransformOvalToPolygon(
          holeOutline,
          hole.GetSeg().A,
          hole.GetSeg().B,
          hole.GetWidth(),
          this.GetMaxError(),
          ERROR_LOC.ERROR_OUTSIDE,
        );

        const copper = new SHAPE_POLY_SET(padOutline);
        copper.BooleanSubtract(holeOutline);

        if (copper.IsEmpty()) {
          aErrorHandler(DRCE_PADSTACK, '(PTH pad hole leaves no copper)');
        } else if (aForPadProperties) {
          // Test if the pad hole is fully inside the copper area.  Note that we only run
          // this check for pad properties because we run the more complete annular ring
          // checker on the board (which handles multiple pads with the same name).
          holeOutline.BooleanSubtract(padOutline);

          if (!holeOutline.IsEmpty())
            aErrorHandler(DRCE_PADSTACK, '(PTH pad hole not fully inside copper)');
        }
      } else {
        // Test only if the pad hole's centre is inside the copper area
        if (!padOutline.Collide(this.GetPosition()))
          aErrorHandler(DRCE_PADSTACK, '(pad hole not inside pad shape)');
      }
    }

    if ((this.GetLocalClearance() ?? 0) < 0)
      aErrorHandler(DRCE_PADSTACK, '(negative local clearance values have no effect)');

    // Some pads need a negative solder mask clearance (mainly for BGA with small pads)
    // However the negative solder mask clearance must not create negative mask size
    // Therefore test for minimal acceptable negative value
    const solderMaskMargin = this.GetLocalSolderMaskMargin();

    if (solderMaskMargin !== undefined && solderMaskMargin < 0) {
      const absMargin = Math.abs(solderMaskMargin);

      if (this.GetShape(aLayer) === PAD_SHAPE.CUSTOM) {
        for (const shape of this.GetPrimitives(aLayer)) {
          const shapeBBox = shape.GetBoundingBox();

          if (absMargin > shapeBBox.GetWidth() || absMargin > shapeBBox.GetHeight()) {
            aErrorHandler(
              DRCE_PADSTACK,
              '(negative solder mask clearance is larger than some shape primitives; results may be surprising)',
            );

            break;
          }
        }
      } else if (absMargin > pad_size.x || absMargin > pad_size.y) {
        aErrorHandler(
          DRCE_PADSTACK,
          '(negative solder mask clearance is larger than pad; no solder mask will be generated)',
        );
      }
    }

    // Some pads need a positive solder paste clearance (mainly for BGA with small pads)
    // However, a positive value can create issues if the resulting shape is too big.
    // (like a solder paste creating a solder paste area on a neighbor pad or on the solder mask)
    // So we could ask for user to confirm the choice
    // For now we just check for disappearing paste
    const paste_size: VECTOR2I = { x: 0, y: 0 };
    const paste_margin = this.GetLocalSolderPasteMargin() ?? 0;
    const mratio = this.GetLocalSolderPasteMarginRatio();

    paste_size.x = pad_size.x + paste_margin + KiROUND(pad_size.x * (mratio ?? 0));
    paste_size.y = pad_size.y + paste_margin + KiROUND(pad_size.y * (mratio ?? 0));

    if (paste_size.x <= 0 || paste_size.y <= 0) {
      aErrorHandler(
        DRCE_PADSTACK,
        '(negative solder paste margin is larger than pad; no solder paste mask will be generated)',
      );
    }

    if (this.GetShape(aLayer) === PAD_SHAPE.ROUNDRECT) {
      if (this.GetRoundRectRadiusRatio(aLayer) < 0.0)
        aErrorHandler(DRCE_PADSTACK_INVALID, '(negative corner radius is not allowed)');
      else if (this.GetRoundRectRadiusRatio(aLayer) > 50.0)
        aErrorHandler(DRCE_PADSTACK, '(corner size will make pad circular)');
    } else if (this.GetShape(aLayer) === PAD_SHAPE.CHAMFERED_RECT) {
      if (this.GetChamferRectRatio(aLayer) < 0.0)
        aErrorHandler(DRCE_PADSTACK_INVALID, '(negative corner chamfer is not allowed)');
      else if (this.GetChamferRectRatio(aLayer) > 50.0)
        aErrorHandler(DRCE_PADSTACK_INVALID, '(corner chamfer is too large)');
    } else if (this.GetShape(aLayer) === PAD_SHAPE.TRAPEZOID) {
      if (
        (this.GetDelta(aLayer).x < 0 && this.GetDelta(aLayer).x < -this.GetSize(aLayer).y) ||
        (this.GetDelta(aLayer).x > 0 && this.GetDelta(aLayer).x > this.GetSize(aLayer).y) ||
        (this.GetDelta(aLayer).y < 0 && this.GetDelta(aLayer).y < -this.GetSize(aLayer).x) ||
        (this.GetDelta(aLayer).y > 0 && this.GetDelta(aLayer).y > this.GetSize(aLayer).x)
      ) {
        aErrorHandler(DRCE_PADSTACK_INVALID, '(trapezoid delta is too large)');
      }
    }

    if (this.GetShape(aLayer) === PAD_SHAPE.CUSTOM) {
      const mergedPolygon = new SHAPE_POLY_SET();
      this.MergePrimitivesAsPolygon(aLayer, mergedPolygon);

      if (mergedPolygon.OutlineCount() > 1)
        aErrorHandler(DRCE_PADSTACK_INVALID, '(custom pad shape must resolve to a single polygon)');
    }
  }

  GetBackdrillMode(): BACKDRILL_MODE {
    return this.m_padStack.GetBackdrillMode();
  }
  SetBackdrillMode(aMode: BACKDRILL_MODE): void {
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

  Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    if (this.m_parent!.m_Uuid !== aOther.GetParent()!.m_Uuid) return 0.0;

    const other = aOther as PAD;

    let similarity = 1.0;

    if (!equal(this.GetPosition(), other.GetPosition())) similarity *= 0.9;

    if (this.GetAttribute() !== other.GetAttribute()) similarity *= 0.9;

    similarity *= this.Padstack().Similarity(other.Padstack());

    return similarity;
  }

  /** `operator==( const PAD& aOther )`. */
  equalsPad(aOther: PAD): boolean {
    if (!this.Padstack().equals(aOther.Padstack())) return false;

    if (!equal(this.GetPosition(), aOther.GetPosition())) return false;

    if (this.GetAttribute() !== aOther.GetAttribute()) return false;

    return true;
  }

  /** `operator==( const BOARD_ITEM& aBoardItem )`. */
  equals(aBoardItem: BOARD_ITEM): boolean {
    if (this.Type() !== aBoardItem.Type()) return false;

    if (
      this.m_parent &&
      aBoardItem.GetParent() &&
      this.m_parent.m_Uuid !== aBoardItem.GetParent()!.m_Uuid
    )
      return false;

    const other = aBoardItem as PAD;

    return this.equalsPad(other);
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_PAD_T);

    const image = aImage as PAD;
    const mine = PAD.copyOfPad(this);
    const mineOverrides = new Map(this.m_zoneLayerOverrides);

    // std::swap moves every member, the ones operator= leaves alone included
    this.assignPad(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    this.m_zoneLayerOverrides = new Map(image.m_zoneLayerOverrides);

    image.assignPad(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
    image.m_zoneLayerOverrides = mineOverrides;
  }

  private getDrawCache(): PAD_DRAW_CACHE_DATA {
    if (!this.m_drawCache) this.m_drawCache = new PAD_DRAW_CACHE_DATA();

    return this.m_drawCache;
  }
}

/**
 * `static struct PAD_DESC` (pcbnew/pad.cpp).
 */
(() => {
  ENUM_MAP.Instance<PAD_ATTRIB>('PAD_ATTRIB')
    .Map(PAD_ATTRIB.PTH, 'Through-hole')
    .Map(PAD_ATTRIB.SMD, 'SMD')
    .Map(PAD_ATTRIB.CONN, 'Edge connector')
    .Map(PAD_ATTRIB.NPTH, 'NPTH, mechanical');

  ENUM_MAP.Instance<PAD_SHAPE>('PAD_SHAPE')
    .Map(PAD_SHAPE.CIRCLE, 'Circle')
    .Map(PAD_SHAPE.RECTANGLE, 'Rectangle')
    .Map(PAD_SHAPE.OVAL, 'Oval')
    .Map(PAD_SHAPE.TRAPEZOID, 'Trapezoid')
    .Map(PAD_SHAPE.ROUNDRECT, 'Rounded rectangle')
    .Map(PAD_SHAPE.CHAMFERED_RECT, 'Chamfered rectangle')
    .Map(PAD_SHAPE.CUSTOM, 'Custom');

  ENUM_MAP.Instance<PAD_PROP>('PAD_PROP')
    .Map(PAD_PROP.NONE, 'None')
    .Map(PAD_PROP.BGA, 'BGA pad')
    .Map(PAD_PROP.FIDUCIAL_GLBL, 'Fiducial, global to board')
    .Map(PAD_PROP.FIDUCIAL_LOCAL, 'Fiducial, local to footprint')
    .Map(PAD_PROP.TESTPOINT, 'Test point pad')
    .Map(PAD_PROP.HEATSINK, 'Heatsink pad')
    .Map(PAD_PROP.CASTELLATED, 'Castellated pad')
    .Map(PAD_PROP.MECHANICAL, 'Mechanical pad')
    .Map(PAD_PROP.PRESSFIT, 'Press-fit pad');

  ENUM_MAP.Instance<PAD_DRILL_SHAPE>('PAD_DRILL_SHAPE')
    .Map(PAD_DRILL_SHAPE.UNDEFINED, 'Undefined')
    .Map(PAD_DRILL_SHAPE.CIRCLE, 'Round')
    .Map(PAD_DRILL_SHAPE.OBLONG, 'Oblong');

  // Ensure post-machining mode enum choices are defined before properties use them
  {
    const pmMap = ENUM_MAP.Instance<PAD_DRILL_POST_MACHINING_MODE>('PAD_DRILL_POST_MACHINING_MODE');

    if (pmMap.Choices().GetCount() === 0) {
      pmMap
        .Undefined(PAD_DRILL_POST_MACHINING_MODE.UNKNOWN)
        .Map(PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED, 'Not post-machined')
        .Map(PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE, 'Counterbore')
        .Map(PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK, 'Countersink');
    }
  }

  // Ensure backdrill mode enum choices are defined before properties use them
  {
    const bdMap = ENUM_MAP.Instance<BACKDRILL_MODE>('BACKDRILL_MODE');

    if (bdMap.Choices().GetCount() === 0) {
      bdMap
        .Undefined(BACKDRILL_MODE.NO_BACKDRILL)
        .Map(BACKDRILL_MODE.NO_BACKDRILL, 'No backdrill')
        .Map(BACKDRILL_MODE.BACKDRILL_BOTTOM, 'Backdrill bottom')
        .Map(BACKDRILL_MODE.BACKDRILL_TOP, 'Backdrill top')
        .Map(BACKDRILL_MODE.BACKDRILL_BOTH, 'Backdrill both');
    }
  }

  const zcMap = ENUM_MAP.Instance<ZONE_CONNECTION>('ZONE_CONNECTION');

  if (zcMap.Choices().GetCount() === 0) {
    zcMap.Undefined(ZONE_CONNECTION.INHERITED);
    zcMap
      .Map(ZONE_CONNECTION.INHERITED, 'Inherited')
      .Map(ZONE_CONNECTION.NONE, 'None')
      .Map(ZONE_CONNECTION.THERMAL, 'Thermal reliefs')
      .Map(ZONE_CONNECTION.FULL, 'Solid')
      .Map(ZONE_CONNECTION.THT_THERMAL, 'Thermal reliefs for PTH');
  }

  ENUM_MAP.Instance<UNCONNECTED_LAYER_MODE>('UNCONNECTED_LAYER_MODE')
    .Map(UNCONNECTED_LAYER_MODE.KEEP_ALL, 'All copper layers')
    .Map(UNCONNECTED_LAYER_MODE.REMOVE_ALL, 'Connected layers only')
    .Map(UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END, 'Front, back and connected layers')
    .Map(UNCONNECTED_LAYER_MODE.START_END_ONLY, 'Start and end layers only');

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PAD);
  propMgr.AddTypeCast(new TYPE_CAST(PAD, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PAD, BOARD_CONNECTED_ITEM));
  propMgr.InheritsAfter(PAD, BOARD_ITEM);
  propMgr.InheritsAfter(PAD, BOARD_CONNECTED_ITEM);

  propMgr.Mask(PAD, BOARD_CONNECTED_ITEM, 'Layer');
  propMgr.Mask(PAD, BOARD_ITEM, 'Locked');

  const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');

  propMgr.AddProperty(
    new PROPERTY<PAD, number>(
      PAD,
      'Orientation',
      'SetOrientationDegrees',
      'GetOrientationDegrees',
      TYPE_DOUBLE,
      PROPERTY_DISPLAY.PT_DEGREE,
    ),
  );

  const isCopperPad = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PAD) return aItem.GetAttribute() !== PAD_ATTRIB.NPTH;

    return false;
  };

  const padCanHaveHole = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PAD)
      return aItem.GetAttribute() === PAD_ATTRIB.PTH || aItem.GetAttribute() === PAD_ATTRIB.NPTH;

    return false;
  };

  const hasNormalPadstack = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PAD) return aItem.Padstack().Mode() === PADSTACK_MODE.NORMAL;

    return true;
  };

  propMgr.OverrideAvailability(PAD, BOARD_CONNECTED_ITEM, 'Net', isCopperPad);
  propMgr.OverrideAvailability(PAD, BOARD_CONNECTED_ITEM, 'Net Class', isCopperPad);

  const groupPad = 'Pad Properties';
  const groupPostMachining = 'Post-machining Properties';
  const groupBackdrill = 'Backdrill Properties';

  propMgr.AddProperty(
    new PROPERTY_ENUM<PAD, PAD_ATTRIB>(
      PAD,
      'Pad Type',
      'SetAttribute',
      'GetAttribute',
      ENUM_MAP.Instance<PAD_ATTRIB>('PAD_ATTRIB'),
    ),
    groupPad,
  );

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PAD, PAD_SHAPE>(
        PAD,
        'Pad Shape',
        'SetFrontShape',
        'GetFrontShape',
        ENUM_MAP.Instance<PAD_SHAPE>('PAD_SHAPE'),
      ),
      groupPad,
    )
    .SetAvailableFunc(hasNormalPadstack);

  propMgr
    .AddProperty(
      new PROPERTY<PAD, string>(PAD, 'Pad Number', 'SetNumber', 'GetNumber', TYPE_STRING),
      groupPad,
    )
    .SetAvailableFunc(isCopperPad);

  propMgr
    .AddProperty(
      new PROPERTY<PAD, string>(PAD, 'Pin Name', 'SetPinFunction', 'GetPinFunction', TYPE_STRING),
      groupPad,
    )
    .SetIsHiddenFromLibraryEditors();
  propMgr
    .AddProperty(
      new PROPERTY<PAD, string>(PAD, 'Pin Type', 'SetPinType', 'GetPinType', TYPE_STRING),
      groupPad,
    )
    .SetIsHiddenFromLibraryEditors()
    .SetChoicesFunc((_aItem: INSPECTABLE_ITEM): PG_CHOICES => {
      const choices = new PG_CHOICES();

      // for( int ii = 0; ii < ELECTRICAL_PINTYPES_TOTAL; ii++ ) GetCanonicalElectricalTypeName( ii )
      for (const name of ELECTRICAL_PINTYPES) choices.Add(name);

      return choices;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Size X',
        'SetSizeX',
        'GetSizeX',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPad,
    )
    .SetAvailableFunc(hasNormalPadstack);
  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Size Y',
        'SetSizeY',
        'GetSizeY',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPad,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PAD) {
        // Custom padstacks can't have size modified through panel
        if (aItem.Padstack().Mode() !== PADSTACK_MODE.NORMAL) return false;

        // Circle pads have no usable y-size
        return aItem.GetShape(PADSTACK.ALL_LAYERS) !== PAD_SHAPE.CIRCLE;
      }

      return true;
    });

  const hasRoundRadius = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof PAD) {
      // Custom padstacks can't have this property modified through panel
      if (aItem.Padstack().Mode() !== PADSTACK_MODE.NORMAL) return false;

      return PadHasMeaningfulRoundingRadius(aItem, PCB_LAYER_ID.F_Cu);
    }

    return false;
  };

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Corner Radius Ratio',
        'SetFrontRoundRectRadiusRatio',
        'GetFrontRoundRectRadiusRatio',
        TYPE_DOUBLE,
      ),
      groupPad,
    )
    .SetAvailableFunc(hasRoundRadius);

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Corner Radius Size',
        'SetFrontRoundRectRadiusSize',
        'GetFrontRoundRectRadiusSize',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPad,
    )
    .SetAvailableFunc(hasRoundRadius);

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PAD, PAD_DRILL_SHAPE>(
        PAD,
        'Hole Shape',
        'SetDrillShape',
        'GetDrillShape',
        ENUM_MAP.Instance<PAD_DRILL_SHAPE>('PAD_DRILL_SHAPE'),
      ),
      groupPad,
    )
    .SetWriteableFunc(padCanHaveHole);

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Hole Size X',
        'SetDrillSizeX',
        'GetDrillSizeX',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPad,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetValidator(PROPERTY_VALIDATORS.PositiveIntValidator);

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Hole Size Y',
        'SetDrillSizeY',
        'GetDrillSizeY',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPad,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetValidator(PROPERTY_VALIDATORS.PositiveIntValidator)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      // Circle holes have no usable y-size
      if (aItem instanceof PAD) return aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE;

      return true;
    });

  const pmEnum = ENUM_MAP.Instance<PAD_DRILL_POST_MACHINING_MODE>('PAD_DRILL_POST_MACHINING_MODE');

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PAD, PAD_DRILL_POST_MACHINING_MODE>(
        PAD,
        'Top Post-machining',
        'SetFrontPostMachiningMode',
        'GetFrontPostMachiningMode',
        pmEnum,
      ),
      groupPostMachining,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PAD) {
        return aItem.GetDrillShape() === PAD_DRILL_SHAPE.CIRCLE;
      }

      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Top Post-machining Size',
        'SetFrontPostMachiningSize',
        'GetFrontPostMachiningSize',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPostMachining,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

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
      new PROPERTY<PAD, number>(
        PAD,
        'Top Counterbore Depth',
        'SetFrontPostMachiningDepth',
        'GetFrontPostMachiningDepth',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPostMachining,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

        const mode = aItem.GetFrontPostMachining();
        return mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE;
      }

      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Top Countersink Angle',
        'SetFrontPostMachiningAngle',
        'GetFrontPostMachiningAngle',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_DECIDEGREE,
      ),
      groupPostMachining,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

        const mode = aItem.GetFrontPostMachining();
        return mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;
      }

      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PAD, PAD_DRILL_POST_MACHINING_MODE>(
        PAD,
        'Bottom Post-machining',
        'SetBackPostMachiningMode',
        'GetBackPostMachiningMode',
        pmEnum,
      ),
      groupPostMachining,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PAD) {
        return aItem.GetDrillShape() === PAD_DRILL_SHAPE.CIRCLE;
      }

      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Bottom Post-machining Size',
        'SetBackPostMachiningSize',
        'GetBackPostMachiningSize',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPostMachining,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

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
      new PROPERTY<PAD, number>(
        PAD,
        'Bottom Counterbore Depth',
        'SetBackPostMachiningDepth',
        'GetBackPostMachiningDepth',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPostMachining,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

        const mode = aItem.GetBackPostMachining();
        return mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE;
      }

      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Bottom Countersink Angle',
        'SetBackPostMachiningAngle',
        'GetBackPostMachiningAngle',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_DECIDEGREE,
      ),
      groupPostMachining,
    )
    .SetWriteableFunc(padCanHaveHole)
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM) => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

        const mode = aItem.GetBackPostMachining();
        return mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;
      }

      return false;
    });

  propMgr.AddProperty(
    new PROPERTY_ENUM<PAD, BACKDRILL_MODE>(
      PAD,
      'Backdrill Mode',
      'SetBackdrillMode',
      'GetBackdrillMode',
      ENUM_MAP.Instance<BACKDRILL_MODE>('BACKDRILL_MODE'),
    ),
    groupBackdrill,
  );

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number | undefined>(
        PAD,
        'Bottom Backdrill Size',
        'SetBottomBackdrillSize',
        'GetBottomBackdrillSize',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupBackdrill,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

        const mode = aItem.GetBackdrillMode();
        return mode === BACKDRILL_MODE.BACKDRILL_BOTTOM || mode === BACKDRILL_MODE.BACKDRILL_BOTH;
      }

      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PAD, PCB_LAYER_ID>(
        PAD,
        'Bottom Backdrill Must-Cut',
        'SetBottomBackdrillLayer',
        'GetBottomBackdrillLayer',
        layerEnum,
      ),
      groupBackdrill,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

        const mode = aItem.GetBackdrillMode();
        return mode === BACKDRILL_MODE.BACKDRILL_BOTTOM || mode === BACKDRILL_MODE.BACKDRILL_BOTH;
      }

      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number | undefined>(
        PAD,
        'Top Backdrill Size',
        'SetTopBackdrillSize',
        'GetTopBackdrillSize',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupBackdrill,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

        const mode = aItem.GetBackdrillMode();
        return mode === BACKDRILL_MODE.BACKDRILL_TOP || mode === BACKDRILL_MODE.BACKDRILL_BOTH;
      }

      return false;
    });

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<PAD, PCB_LAYER_ID>(
        PAD,
        'Top Backdrill Must-Cut',
        'SetTopBackdrillLayer',
        'GetTopBackdrillLayer',
        layerEnum,
      ),
      groupBackdrill,
    )
    .SetAvailableFunc((aItem: INSPECTABLE_ITEM): boolean => {
      if (aItem instanceof PAD) {
        if (aItem.GetDrillShape() !== PAD_DRILL_SHAPE.CIRCLE) return false;

        const mode = aItem.GetBackdrillMode();
        return mode === BACKDRILL_MODE.BACKDRILL_TOP || mode === BACKDRILL_MODE.BACKDRILL_BOTH;
      }

      return false;
    });

  propMgr.AddProperty(
    new PROPERTY_ENUM<PAD, PAD_PROP>(
      PAD,
      'Fabrication Property',
      'SetProperty',
      'GetProperty',
      ENUM_MAP.Instance<PAD_PROP>('PAD_PROP'),
    ),
    groupPad,
  );

  propMgr.AddProperty(
    new PROPERTY_ENUM<PAD, UNCONNECTED_LAYER_MODE>(
      PAD,
      'Copper Layers',
      'SetUnconnectedLayerMode',
      'GetUnconnectedLayerMode',
      ENUM_MAP.Instance<UNCONNECTED_LAYER_MODE>('UNCONNECTED_LAYER_MODE'),
    ),
    groupPad,
  );

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Pad To Die Length',
        'SetPadToDieLength',
        'GetPadToDieLength',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupPad,
    )
    .SetAvailableFunc(isCopperPad);

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number>(
        PAD,
        'Pad To Die Delay',
        'SetPadToDieDelay',
        'GetPadToDieDelay',
        TYPE_INT,
        PROPERTY_DISPLAY.PT_TIME,
      ),
      groupPad,
    )
    .SetAvailableFunc(isCopperPad);

  const groupOverrides = 'Overrides';

  propMgr.AddProperty(
    new PROPERTY<PAD, number | undefined>(
      PAD,
      'Clearance Override',
      'SetLocalClearance',
      'GetLocalClearance',
      TYPE_OPT_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    groupOverrides,
  );

  propMgr.AddProperty(
    new PROPERTY<PAD, number | undefined>(
      PAD,
      'Soldermask Margin Override',
      'SetLocalSolderMaskMargin',
      'GetLocalSolderMaskMargin',
      TYPE_OPT_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    groupOverrides,
  );

  propMgr.AddProperty(
    new PROPERTY<PAD, number | undefined>(
      PAD,
      'Solderpaste Margin Override',
      'SetLocalSolderPasteMargin',
      'GetLocalSolderPasteMargin',
      TYPE_OPT_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    groupOverrides,
  );

  propMgr.AddProperty(
    new PROPERTY<PAD, number | undefined>(
      PAD,
      'Solderpaste Margin Ratio Override',
      'SetLocalSolderPasteMarginRatio',
      'GetLocalSolderPasteMarginRatio',
      TYPE_OPT_DOUBLE,
      PROPERTY_DISPLAY.PT_RATIO,
    ),
    groupOverrides,
  );

  propMgr.AddProperty(
    new PROPERTY_ENUM<PAD, ZONE_CONNECTION>(
      PAD,
      'Zone Connection Style',
      'SetLocalZoneConnection',
      'GetLocalZoneConnection',
      zcMap,
    ),
    groupOverrides,
  );

  const minZoneWidth = pcbIUScale.mmToIU(ZONE_THICKNESS_MIN_VALUE_MM);

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number | undefined>(
        PAD,
        'Thermal Relief Spoke Width',
        'SetLocalThermalSpokeWidthOverride',
        'GetLocalThermalSpokeWidthOverride',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupOverrides,
    )
    .SetValidator(PROPERTY_VALIDATORS.RangeIntValidator(minZoneWidth, INT_MAX));

  propMgr.AddProperty(
    new PROPERTY<PAD, number>(
      PAD,
      'Thermal Relief Spoke Angle',
      'SetThermalSpokeAngleDegrees',
      'GetThermalSpokeAngleDegrees',
      TYPE_DOUBLE,
      PROPERTY_DISPLAY.PT_DEGREE,
    ),
    groupOverrides,
  );

  propMgr
    .AddProperty(
      new PROPERTY<PAD, number | undefined>(
        PAD,
        'Thermal Relief Gap',
        'SetLocalThermalGapOverride',
        'GetLocalThermalGapOverride',
        TYPE_OPT_INT,
        PROPERTY_DISPLAY.PT_SIZE,
      ),
      groupOverrides,
    )
    .SetValidator(PROPERTY_VALIDATORS.PositiveIntValidator);

  // TODO delta, drill shape offset, layer set
})();
