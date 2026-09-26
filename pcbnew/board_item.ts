// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/board_item.h` / `pcbnew/board_item.cpp`: `BOARD_ITEM`, a base
 * class for any item which can be embedded within the #BOARD container
 * class, and `DELETED_BOARD_ITEM`.
 *
 * Not here: `BOARD_ITEM_DESC`, the `PROPERTY_MANAGER` registration, which the
 * properties panel carries.
 */

import { EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { type KIID, newKiid } from '@ziroeda/common/kiid.js';
import {
  FLASHING,
  GAL_LAYER_ID,
  IsCopperLayer,
  LayerName,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  NO_SETTER,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_INT,
  TYPE_STRING,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import type { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import { STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import type { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_LINE_WIDTH } from './board_design_settings_defaults.js';
import { BOARD_USE, LAYER_T } from './board_types.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import type { FOOTPRINT } from './footprint.js';

/**
 * The part of `BOARD_COMMIT` `Duplicate` uses. The class itself is #636 stage 3.
 */
export interface BOARD_COMMIT_LIKE {
  Modify(aItem: EDA_ITEM, aScreen: unknown, aMode: RECURSE_MODE): void;
}

/**
 * Conditionally flashed vias and pads that interact with zones of different priority can be
 * very squirrelly.
 *
 * In particular, when filling a higher-priority zone that does -not- connect to a via/pad, we
 * don't know whether or not a lower-priority zone will subsequently connect -- so we can't
 * determine clearance because we don't know what the final flashing state will be.
 *
 * We therefore force the flashing state if the highest-priority zone with the same net -can-
 * connect (whether or not it does in the end), and otherwise force the zone-connection state
 * to no-connection (even though a lower priority zone -might- have otherwise connected to it.
 */
export enum ZONE_LAYER_OVERRIDE {
  ZLO_NONE = 0,
  ZLO_FORCE_FLASHED = 1,
  ZLO_FORCE_NO_ZONE_CONNECTION = 2,
}

export const { ZLO_NONE, ZLO_FORCE_FLASHED, ZLO_FORCE_NO_ZONE_CONNECTION } = ZONE_LAYER_OVERRIDE;

/**
 * A base class for any item which can be embedded within the #BOARD container class, and
 * therefore instances of derived classes should only be found in Pcbnew or other programs
 * that use class #BOARD and its contents.
 */
export abstract class BOARD_ITEM extends EDA_ITEM {
  protected m_layer: PCB_LAYER_ID;
  protected m_isKnockout: boolean;
  protected m_isLocked: boolean;

  constructor(
    aParent: BOARD_ITEM | null,
    idtype: KICAD_T,
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
  ) {
    super(aParent, idtype, false, true);
    this.m_layer = aLayer;
    this.m_isKnockout = false;
    this.m_isLocked = false;
  }

  /** `EDA_ITEM( const EDA_ITEM& base )` for a derived copy constructor: the UUID is kept. */
  protected static copyBase<T extends BOARD_ITEM>(aInto: T, aOther: BOARD_ITEM): T {
    aInto.assign(aOther);
    (aInto as { m_Uuid: KIID }).m_Uuid = aOther.m_Uuid;
    aInto.m_layer = aOther.m_layer;
    aInto.m_isKnockout = aOther.m_isKnockout;
    aInto.m_isLocked = aOther.m_isLocked;
    return aInto;
  }

  /** `operator=`: the compiler-generated one, which copies every member of the class. */
  assignBoardItem(aOther: BOARD_ITEM): this {
    this.assign(aOther);
    this.m_layer = aOther.m_layer;
    this.m_isKnockout = aOther.m_isKnockout;
    this.m_isLocked = aOther.m_isLocked;
    return this;
  }

  CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!aOther) return; // wxCHECK( aOther, /* void */ )

    this.assignBoardItem(aOther);
  }

  IsGroupableType(): boolean {
    switch (this.Type()) {
      case KICAD_T.PCB_FOOTPRINT_T:
      case KICAD_T.PCB_PAD_T:
      case KICAD_T.PCB_SHAPE_T:
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T:
      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
      case KICAD_T.PCB_GROUP_T:
      case KICAD_T.PCB_GENERATOR_T:
      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_VIA_T:
      case KICAD_T.PCB_ARC_T:
      case KICAD_T.PCB_DIMENSION_T:
      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_ZONE_T:
      case KICAD_T.PCB_BARCODE_T:
        return true;
      default:
        return false;
    }
  }

  // Do not create a copy constructor & operator=.
  // The ones generated by the compiler are adequate.

  GetX(): number {
    const p = this.GetPosition();
    return p.x;
  }

  GetY(): number {
    const p = this.GetPosition();
    return p.y;
  }

  /**
   * This defaults to the center of the bounding box if not overridden.
   *
   * @return center point of the item
   */
  GetCenter(): VECTOR2I {
    return this.GetBoundingBox().GetCenter();
  }

  SetX(aX: number): void {
    const p = { x: aX, y: this.GetY() };
    this.SetPosition(p);
  }

  SetY(aY: number): void {
    const p = { x: this.GetX(), y: aY };
    this.SetPosition(p);
  }

  /**
   * Returns information if the object is derived from BOARD_CONNECTED_ITEM.
   *
   * @return True if the object is of BOARD_CONNECTED_ITEM type, false otherwise.
   */
  IsConnected(): boolean {
    return false;
  }

  /**
   * Return a measure of how likely the other object is to represent the same
   * object.  The scale runs from 0.0 (definitely different objects) to 1.0 (same)
   *
   * This is a pure virtual function.  Derived classes must implement this.
   */
  abstract Similarity(aItem: BOARD_ITEM): number;

  /** `operator==( const BOARD_ITEM& )`. */
  abstract equals(aItem: BOARD_ITEM): boolean;

  /**
   * @return true if the object is on any copper layer, false otherwise.
   */
  IsOnCopperLayer(): boolean {
    return IsCopperLayer(this.GetLayer());
  }

  HasHole(): boolean {
    return false;
  }

  HasDrilledHole(): boolean {
    return false;
  }

  /**
   * Checks if the given object is tented (its copper shape is covered by solder mask) on a given
   * side of the board.
   * @param aLayer is the layer to check tenting mode for: F_Cu and F_Mask are treated identically
   *               as are B_Cu and B_Mask
   * @return true if the object is tented on the given side
   */
  IsTented(aLayer: PCB_LAYER_ID): boolean {
    return false;
  }

  /**
   * A value of wxPoint(0,0) which can be passed to the Draw() functions.
   */
  static ZeroOffset: VECTOR2I = { x: 0, y: 0 };

  /**
   * Some pad shapes can be complex (rounded/chamfered rectangle), even without considering
   * custom shapes.  This routine returns a COMPOUND shape (set of simple shapes which make
   * up the pad for use with routing, collision determination, etc).
   *
   * @note This list can contain a SHAPE_SIMPLE (a simple single-outline non-intersecting
   * polygon), but should never contain a SHAPE_POLY_SET (a complex polygon consisting of
   * multiple outlines and/or holes).
   *
   * @param aLayer in case of items spanning multiple layers, only the shapes belonging to aLayer
   *               will be returned. Pass UNDEFINED_LAYER to return shapes for all layers.
   * @param aFlash optional parameter allowing a caller to force the pad to be flashed (or not
   *               flashed) on the current layer (default is to honour the pad's setting and
   *               the current connections for the given layer).
   */
  GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    throw new Error(`GetEffectiveShape not implemented for ${this.GetClass()}`); // UNIMPLEMENTED_FOR( GetClass() )
  }

  GetEffectiveHoleShape(): SHAPE_SEGMENT | null {
    throw new Error(`GetEffectiveHoleShape not implemented for ${this.GetClass()}`); // UNIMPLEMENTED_FOR( GetClass() )
  }

  /**
   * Invoke a function on all children.
   *
   * @note This function should not add or remove items to the parent.
   */
  RunOnChildren(aFunction: (aItem: BOARD_ITEM) => void, aMode: RECURSE_MODE): void {}

  override GetParent(): BOARD_ITEM_CONTAINER | null {
    return this.m_parent as BOARD_ITEM_CONTAINER | null;
  }

  GetParentFootprint(): FOOTPRINT | null {
    return this.findParent(KICAD_T.PCB_FOOTPRINT_T) as FOOTPRINT | null;
  }

  GetFPRelativePosition(): VECTOR2I {
    let pos = this.GetPosition();

    const parentFP = this.GetParentFootprint();

    if (parentFP) {
      pos = { x: pos.x - parentFP.GetPosition().x, y: pos.y - parentFP.GetPosition().y };
      pos = RotatePoint(pos, parentFP.GetOrientation().negate());
    }

    return pos;
  }

  SetFPRelativePosition(aPos: VECTOR2I): void {
    let pos = { x: aPos.x, y: aPos.y };

    const parentFP = this.GetParentFootprint();

    if (parentFP) {
      pos = RotatePoint(pos, parentFP.GetOrientation());
      pos = { x: pos.x + parentFP.GetPosition().x, y: pos.y + parentFP.GetPosition().y };
    }

    this.SetPosition(pos);
  }

  /**
   * Check if this item has line stoke properties.
   *
   * @see #STROKE_PARAMS
   */
  HasLineStroke(): boolean {
    return false;
  }

  GetStroke(): STROKE_PARAMS {
    // wxFAIL_MSG( wxString( "GetStroke() not defined by " ) + GetClass() );
    return new STROKE_PARAMS(pcbIUScale.mmToIU(DEFAULT_LINE_WIDTH));
  }

  SetStroke(aStroke: STROKE_PARAMS): void {
    // wxFAIL_MSG( wxString( "SetStroke() not defined by " ) + GetClass() );
  }

  GetFontMetrics(): METRICS {
    return METRICS.Default();
  }

  /**
   * Return the primary layer this item is on.
   */
  GetLayer(): PCB_LAYER_ID {
    return this.m_layer;
  }

  /**
   * Return the total number of layers for the board that this item resides on.
   */
  BoardLayerCount(): number {
    const board = this.GetBoard();

    if (board) return board.GetLayerSet().count();

    return 64;
  }

  /**
   * Return the total number of copper layers for the board that this item resides on.
   */
  BoardCopperLayerCount(): number {
    const board = this.GetBoard();

    if (board) return board.GetCopperLayerCount();

    return 32;
  }

  /**
   * Return the LSET for the board that this item resides on.
   */
  BoardLayerSet(): LSET {
    const board = this.GetBoard();

    if (board) return board.GetEnabledLayers();

    return LSET.AllLayersMask();
  }

  /**
   * Return a std::bitset of all layers on which the item physically resides.
   */
  GetLayerSet(): LSET {
    if (this.m_layer === PCB_LAYER_ID.UNDEFINED_LAYER) return new LSET();
    else return new LSET([this.m_layer]);
  }

  SetLayerSet(aLayers: LSET): void {
    if (aLayers.count() === 1) {
      this.SetLayer(aLayers.Seq()[0]!);
      return;
    }

    console.assert(false, 'Attempted to SetLayerSet() on a single-layer object.');

    // Derived classes which support multiple layers must implement this
  }

  IsSideSpecific(): boolean {
    if (this.GetLayerSet().and(LSET.SideSpecificMask()).any()) return true;

    const board = this.GetBoard();

    if (board) {
      const principalLayerType = board.GetLayerType(this.m_layer);

      if (principalLayerType === LAYER_T.LT_FRONT || principalLayerType === LAYER_T.LT_BACK)
        return true;
    }

    return false;
  }

  /**
   * Set the layer this item is on.
   *
   * @param aLayer The layer number.
   */
  SetLayer(aLayer: PCB_LAYER_ID): void {
    this.m_layer = aLayer;
  }

  /**
   * Create a copy of this #BOARD_ITEM.
   *
   * @param addToParentGroup Indicates whether or not the new item is added to the group
   *                         containing the old item.  If true, aCommit must be provided.
   */
  Duplicate(addToParentGroup: boolean, aCommit: BOARD_COMMIT_LIKE | null = null): BOARD_ITEM {
    const dupe = this.Clone() as BOARD_ITEM;
    (dupe as { m_Uuid: KIID }).m_Uuid = newKiid();

    if (addToParentGroup) {
      if (!aCommit) {
        console.assert(false, 'Must supply a commit to update parent group');
        return dupe;
      }

      const group = dupe.GetParentGroup();

      if (group) {
        aCommit.Modify(group.AsEdaItem(), null, RECURSE_MODE.NO_RECURSE);
        group.AddItem(dupe);
      }
    }

    return dupe;
  }

  /**
   * Swap data between \a aItem and \a aImage.
   *
   * \a aItem and \a aImage should have the same type.
   *
   * Used in undo and redo commands to swap values between an item and its copy.
   * Only values like layer, size .. which are modified by editing are swapped.
   *
   * @param aImage the item image which contains data to swap.
   */
  SwapItemData(aImage: BOARD_ITEM | null): void {
    if (aImage === null) return;

    const parent = this.GetParent();
    const group: EDA_GROUP | null = this.GetParentGroup();
    const imageGroup: EDA_GROUP | null = aImage.GetParentGroup();

    this.swapData(aImage);

    this.SetParent(parent);

    // Group membership is a back-reference, not item data, so keep each side's own.
    this.SetParentGroup(group);
    aImage.SetParentGroup(imageGroup);
  }

  /**
   * Test to see if this object is on the given layer.
   *
   * Virtual so objects like #PAD, which reside on multiple layers can do their own form
   * of testing.
   *
   * @param aLayer The layer to test for.
   * @return true if on given layer, else false.
   */
  IsOnLayer(aLayer: PCB_LAYER_ID): boolean {
    return this.m_layer === aLayer;
  }

  IsKnockout(): boolean {
    return this.m_isKnockout;
  }
  SetIsKnockout(aKnockout: boolean): void {
    this.m_isKnockout = aKnockout;
  }

  override IsLocked(): boolean {
    const group = this.GetParentGroup();

    if (group) {
      if (group.AsEdaItem().IsLocked()) return true;
    }

    if (!this.GetBoard() || this.GetBoard()!.GetBoardUse() === BOARD_USE.FPHOLDER) return false;

    return this.m_isLocked;
  }
  override SetLocked(aLocked: boolean): void {
    this.m_isLocked = aLocked;
  }

  GetMaxError(): number {
    const board = this.GetBoard();

    if (board) return board.GetDesignSettings().m_MaxError;

    return ARC_HIGH_DEF;
  }

  StyleFromSettings(settings: unknown, aCheckSide: boolean): void {}

  /**
   * Delete this object after removing from its parent if it has one.
   */
  DeleteStructure(): void {
    const parent = this.GetParent();

    if (parent) parent.Remove(this);

    // delete this;
  }

  /**
   * Move this object.
   *
   * @param aMoveVector the move vector for this object.
   */
  Move(aMoveVector: VECTOR2I): void {
    console.assert(false, `virtual BOARD_ITEM::Move called for ${this.GetClass()}`);
  }

  /**
   * Rotate this object.
   *
   * @param aRotCentre the rotation center point.
   */
  Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    console.assert(false, `virtual BOARD_ITEM::Rotate used, should not occur: ${this.GetClass()}`);
  }

  /**
   * Flip this object, i.e. change the board side for this object.
   *
   * @param aCentre the rotation point.
   * @param aFlipDirection the flip direction
   */
  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    console.assert(false, `virtual BOARD_ITEM::Flip used, should not occur: ${this.GetClass()}`);
  }

  /**
   * Mirror this object relative to a given horizontal axis the layer is not changed.
   *
   * @param aCentre the mirror point.
   * @param aMirrorAroundXAxis mirror across X axis instead of Y (the default).
   */
  Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    console.assert(false, `virtual BOARD_ITEM::Mirror used, should not occur: ${this.GetClass()}`);
  }

  /**
   * Perform any normalization required after a user rotate and/or flip.
   */
  Normalize(): void {}

  /**
   * Perform any normalization required to compare 2 graphics, especially
   * if the can be rotated and/or flipped.
   * Similar to Normalize(), but more changes can be made
   */
  NormalizeForCompare(): void {
    this.Normalize();
  }

  /**
   * Return the #BOARD in which this #BOARD_ITEM resides, or NULL if none.
   */
  GetBoard(): BOARD | null {
    if (this.Type() === KICAD_T.PCB_T) return this as unknown as BOARD;

    return this.findParent(KICAD_T.PCB_T) as BOARD | null;
  }

  /**
   * For "parent" property.
   * @return the parent footprint's ref or the parent item's UUID.
   */
  GetParentAsString(): string {
    const fp = this.m_parent as { Type(): KICAD_T; GetReference?: () => string } | null;

    if (fp && fp.Type() === KICAD_T.PCB_FOOTPRINT_T && fp.GetReference) return fp.GetReference();

    return this.m_parent!.m_Uuid;
  }

  /**
   * Return the name of the PCB layer on which the item resides.
   *
   * @return the layer name associated with this item.
   */
  GetLayerName(): string {
    const board = this.GetBoard();

    if (board) return board.GetLayerName(this.m_layer);

    // If no parent, return standard name
    return LayerName(this.m_layer); // BOARD::GetStandardLayerName( m_layer )
  }

  override ViewGetLayers(): number[] {
    // Basic fallback
    if (this.IsLocked()) return [this.m_layer, GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW];

    return [this.m_layer];
  }

  /**
   * Convert the item shape to a closed polygon. Circles and arcs are approximated by segments.
   *
   * @param aBuffer a buffer to store the polygon.
   * @param aClearance the clearance around the polygonal shape (inflated polygon).
   * @param aError the maximum deviation from true circle.
   * @param aErrorLoc should the approximation error be placed outside or inside the polygon?
   * @param ignoreLineWidth used for edge cut items where the line width is only
   *                        for visualization.
   */
  TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    ignoreLineWidth = false,
  ): void {
    // wxLogDebug( wxT( "%s doesn't implement TransformShapeToPolygon()" ), GetClass() );
  }

  /**
   * Convert the item shape to a polyset. Circles and arcs are approximated by segments; hatched
   * fills and details (if any) will be included.
   *
   * @param aBuffer a buffer to store the polygon.
   * @param aClearance the clearance around the pad.
   * @param aError the maximum deviation from true circle.
   * @param aErrorLoc should the approximation error be placed outside or inside the polygon?
   * @param aRenderSettings used to plot outlines with not solid segments like dashed lines.
   * So it is not used by all BOARD_ITEMS. If null lines like dashed will be converted as SOLID
   */
  TransformShapeToPolySet(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    aRenderSettings: RENDER_SETTINGS | null = null,
  ): void {
    this.TransformShapeToPolygon(aBuffer, aLayer, aClearance, aError, aErrorLoc);
  }

  override GetEmbeddedFonts(): readonly string[] | null {
    const board = this.GetBoard();

    if (board) return board.GetFontFiles();

    return null;
  }

  /**
   * Return a string (to be shown to the user) describing a layer mask.
   */
  LayerMaskDescribe(): string {
    const board = this.GetBoard();
    let layers = this.GetLayerSet();

    if (board) layers = layers.and(board.GetEnabledLayers());

    const copperLayers = layers.and(LSET.AllCuMask());
    const techLayers = layers.and(LSET.AllTechMask());

    // Try to be smart and useful.  Check all copper first.
    if (copperLayers.count() === board!.GetCopperLayerCount()) return 'all copper layers';

    for (const testLayers of [copperLayers, techLayers, layers]) {
      for (let bit: number = PCB_LAYER_ID.F_Cu; bit < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; ++bit) {
        if (testLayers.at(bit)) {
          let layerInfo = board!.GetLayerName(bit as PCB_LAYER_ID);

          if (testLayers.count() > 1) layerInfo += ' and others';

          return layerInfo;
        }
      }
    }

    // No copper, no technicals: no layer
    return 'no layers';
  }

  static readonly COMPARE_FLAGS = {
    DRC: 0x01,
    INSTANCE_TO_INSTANCE: 0x02,
  } as const;

  /** `BOARD_ITEM::ptr_cmp::operator()`: a strict weak order for sets of items. */
  static ptr_cmp(a: BOARD_ITEM, b: BOARD_ITEM): boolean {
    if (a.Type() !== b.Type()) return a.Type() < b.Type();

    if (!a.GetLayerSet().equals(b.GetLayerSet()))
      return lseqLess(a.GetLayerSet().Seq(), b.GetLayerSet().Seq());

    if (a.m_Uuid !== b.m_Uuid)
      // UUIDs *should* always be unique (for valid boards anyway)
      return a.m_Uuid < b.m_Uuid;

    return false; // `a < b` on the pointers: two distinct objects with one UUID have no order here
  }

  protected swapData(aImage: BOARD_ITEM): void {
    throw new Error(`swapData not implemented for ${this.GetClass()}`); // UNIMPLEMENTED_FOR( GetClass() )
  }
}

/** `std::vector<PCB_LAYER_ID>::operator<`: lexicographic. */
function lseqLess(a: readonly PCB_LAYER_ID[], b: readonly PCB_LAYER_ID[]): boolean {
  const n = Math.min(a.length, b.length);

  for (let i = 0; i < n; ++i) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }

  return a.length < b.length;
}

/**
 * A singleton item of this class is returned for a weak reference that no longer exists.
 *
 * Its sole purpose is to flag the item as having been deleted.
 */
export class DELETED_BOARD_ITEM extends BOARD_ITEM {
  private static item: DELETED_BOARD_ITEM | null = null;

  constructor() {
    super(null, KICAD_T.NOT_USED);
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return '(Deleted Item)';
  }

  GetClass(): string {
    return 'DELETED_BOARD_ITEM';
  }

  // pure virtuals:
  override SetPosition(aPos: VECTOR2I): void {}
  override GetPosition(): VECTOR2I {
    return { x: 0, y: 0 };
  }

  static GetInstance(): DELETED_BOARD_ITEM {
    if (!DELETED_BOARD_ITEM.item) DELETED_BOARD_ITEM.item = new DELETED_BOARD_ITEM();

    return DELETED_BOARD_ITEM.item;
  }

  Similarity(aItem: BOARD_ITEM): number {
    return this === aItem ? 1.0 : 0.0;
  }

  equals(aBoardItem: BOARD_ITEM): boolean {
    return this === aBoardItem;
  }
}

/**
 * `static struct BOARD_ITEM_DESC` (pcbnew/board_item.cpp).
 */
(() => {
  const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');

  if (layerEnum.Choices().GetCount() === 0) {
    layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

    for (const layer of LSET.AllLayersMask().Seq()) layerEnum.Map(layer, LSET.Name(layer));
  }

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(BOARD_ITEM);
  propMgr.InheritsAfter(BOARD_ITEM, EDA_ITEM);

  propMgr
    .AddProperty(
      new PROPERTY<BOARD_ITEM, string>(
        BOARD_ITEM,
        'Parent',
        NO_SETTER,
        'GetParentAsString',
        TYPE_STRING,
      ),
    )
    .SetIsHiddenFromLibraryEditors()
    .SetIsHiddenFromPropertiesManager();

  const isNotFootprintHolder = (aItem: INSPECTABLE_ITEM): boolean => {
    const item = aItem instanceof BOARD_ITEM ? aItem : null;
    return !!item && !!item.GetBoard() && !item.GetBoard()!.IsFootprintHolder();
  };

  propMgr.AddProperty(
    new PROPERTY<BOARD_ITEM, number>(
      BOARD_ITEM,
      'Position X',
      'SetX',
      'GetX',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_X_COORD,
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<BOARD_ITEM, number>(
      BOARD_ITEM,
      'Position Y',
      'SetY',
      'GetY',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_Y_COORD,
    ),
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<BOARD_ITEM, PCB_LAYER_ID>(
      BOARD_ITEM,
      'Layer',
      'SetLayer',
      'GetLayer',
      layerEnum,
    ),
  );
  propMgr
    .AddProperty(
      new PROPERTY<BOARD_ITEM, boolean>(BOARD_ITEM, 'Locked', 'SetLocked', 'IsLocked', TYPE_BOOL),
    )
    .SetAvailableFunc(isNotFootprintHolder);
})();
