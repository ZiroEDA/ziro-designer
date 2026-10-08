// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_shape.h` / `eeschema/sch_shape.cpp`: `SCH_SHAPE`, a graphic shape in a
 * schematic or a symbol (`class SCH_SHAPE : public SCH_ITEM, public EDA_SHAPE`, the
 * EDA_SHAPE half mixed in).
 *
 * Not here: `Plot`, `Print`, `GetMsgPanelInfo`, `GetMenuImage`, `Serialize` /
 * `Deserialize`, `SCH_SHAPE_DESC`.
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  PROPERTY_ENUM,
  TYPE_CAST,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import { SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { EDA_SHAPE, FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE, type STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_270, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { DEFAULT_LINE_WIDTH_MILS } from './default_values.js';
import { SCH_ITEM } from './sch_item.js';

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

// The EDA_SHAPE virtuals SCH_SHAPE (or a subclass) overrides are re-declared as methods,
// because a mapped type carries them as properties, which a method cannot override.
export interface SCH_SHAPE
  extends Omit<
    EDA_SHAPE,
    | 'Similarity'
    | 'Compare'
    | 'GetEffectiveWidth'
    | 'GetHatchLineWidth'
    | 'GetHatchLineSpacing'
    | 'SetFilled'
    | 'setFilled'
    | 'isMoving'
    | 'getMaxError'
    | 'MakeEffectiveShapes'
    | 'getFriendlyName'
    | 'IsFilledForHitTesting'
  > {
  Compare(aOther: EDA_SHAPE): number;
  IsFilledForHitTesting(): boolean;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance, see libs/core/mixins.ts
export class SCH_SHAPE extends SCH_ITEM {
  constructor(
    aShape: SHAPE_T = SHAPE_T.UNDEFINED,
    aLayer: SCH_LAYER_ID = SCH_LAYER_ID.LAYER_NOTES,
    aLineWidth = 0,
    aFillType: FILL_T = FILL_T.NO_FILL,
    aType: KICAD_T = KICAD_T.SCH_SHAPE_T,
  ) {
    super(null, aType);
    this.initEdaShape(aShape, aLineWidth, aFillType);
    this.SetLayer(aLayer);
  }

  /** `SCH_SHAPE( const SCH_SHAPE& )` as a derived copy's step: both bases, uuid kept. */
  protected static copyShape<T extends SCH_SHAPE>(aInto: T, aOther: SCH_SHAPE): T {
    SCH_ITEM.copySchItem(aInto, aOther);
    aInto.initEdaShapeFrom(aOther as unknown as EDA_SHAPE);
    return aInto;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_SHAPE_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_SHAPE';
  }

  override GetFriendlyName(): string {
    return this.getFriendlyName();
  }

  /** `EDA_SHAPE::getFriendlyName`, the shape's own name ("Rectangle", "Arc" …). */
  getFriendlyName(): string {
    return EDA_SHAPE.prototype.getFriendlyName.call(this);
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
      if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

      return this.hitTest(a, b as boolean, c ?? 0);
    }

    if ('x' in a && 'y' in a) return this.hitTest(a, (b as number | undefined) ?? 0);

    if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

    for (const shape of this.MakeEffectiveShapes(false)) {
      if (KIGEOM_ShapeHitTest(a, shape, b as boolean)) return true;
    }

    return false;
  }

  override IsEndPoint(aPt: VECTOR2I): boolean {
    const shape = this.GetShape();

    if (shape === SHAPE_T.ARC || shape === SHAPE_T.BEZIER || shape === SHAPE_T.SEGMENT)
      return samePt(aPt, this.GetStart()) || samePt(aPt, this.GetEnd());

    if (shape === SHAPE_T.RECTANGLE) {
      for (const corner of this.GetRectCorners()) {
        if (samePt(corner, aPt)) return true;
      }

      return false;
    }

    if (shape === SHAPE_T.POLY) {
      for (const pt of this.GetPolyPoints()) {
        if (samePt(pt, aPt)) return true;
      }

      return false;
    }

    return false;
  }

  override GetPenWidth(): number {
    return this.GetStroke().GetWidth();
  }

  override HasLineStroke(): boolean {
    return true;
  }

  override GetStroke(): STROKE_PARAMS {
    return this.m_stroke.clone();
  }

  override SetStroke(aStroke: STROKE_PARAMS): void {
    this.m_stroke = aStroke.clone();
  }

  GetEffectiveWidth(): number {
    if (this.GetPenWidth() > 0) return this.GetPenWidth();

    // Historically 0 meant "default width" and negative numbers meant "don't stroke".
    if (this.GetPenWidth() < 0) return 0;

    const schematic = this.Schematic();

    if (schematic) return schematic.Settings().m_DefaultLineWidth;

    return schIUScale.milsToIU(DEFAULT_LINE_WIDTH_MILS);
  }

  GetEffectiveLineStyle(): LINE_STYLE {
    if (this.m_stroke.GetLineStyle() === LINE_STYLE.DEFAULT) return LINE_STYLE.SOLID;
    else return this.m_stroke.GetLineStyle();
  }

  GetHatchLineWidth(): number {
    return Math.trunc(this.GetEffectiveWidth() / 2);
  }

  GetHatchLineSpacing(): number {
    return this.GetHatchLineWidth() * 40;
  }

  SetFilled(aFilled: boolean): void {
    if (!aFilled) this.m_fill = FILL_T.NO_FILL;
    else if (this.GetParentSymbol()) this.m_fill = FILL_T.FILLED_SHAPE;
    else this.m_fill = FILL_T.FILLED_WITH_COLOR;
  }

  override GetBoundingBox(): BOX2I {
    return this.getBoundingBox();
  }

  override GetPosition(): VECTOR2I {
    return this.getPosition();
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.setPosition(aPos);
  }

  GetCenter(): VECTOR2I {
    return this.getCenter();
  }

  override BeginEdit(aStartPoint: VECTOR2I): void {
    this.beginEdit(aStartPoint);
  }

  override ContinueEdit(aPosition: VECTOR2I): boolean {
    return this.continueEdit(aPosition);
  }

  override CalcEdit(aPosition: VECTOR2I): void {
    this.calcEdit(aPosition);
  }

  override EndEdit(_aClosed = false): void {
    this.endEdit();
  }

  SetEditState(aState: number): void {
    this.setEditState(aState);
  }

  override Move(aOffset: VECTOR2I): void {
    this.move(aOffset);
  }

  /** Make a rectangle's start the top-left corner and its end the bottom-right. */
  Normalize(): void {
    if (this.GetShape() === SHAPE_T.RECTANGLE) {
      const size = {
        x: this.GetEnd().x - this.GetPosition().x,
        y: this.GetEnd().y - this.GetPosition().y,
      };

      if (size.y < 0) {
        this.SetStartY(this.GetStartY() + size.y);
        this.SetEndY(this.GetStartY() - size.y);
      }

      if (size.x < 0) {
        this.SetStartX(this.GetStartX() + size.x);
        this.SetEndX(this.GetStartX() - size.x);
      }
    }
  }

  override MirrorHorizontally(aCenter: number): void {
    this.flip({ x: aCenter, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
  }

  override MirrorVertically(aCenter: number): void {
    this.flip({ x: 0, y: aCenter }, FLIP_DIRECTION.TOP_BOTTOM);
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    this.rotate(aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
  }

  AddPoint(aPosition: VECTOR2I): void {
    if (this.GetShape() === SHAPE_T.POLY) {
      if (this.GetPolyShape().IsEmpty()) {
        this.GetPolyShape().NewOutline();
        this.GetPolyShape().Outline(0).SetClosed(false);
      }

      this.GetPolyShape().Outline(0).Append(aPosition, true);
    } else {
      // UNIMPLEMENTED_FOR( SHAPE_T_asString() )
    }
  }

  MakeEffectiveShapes(aEdgeOnly = false): SHAPE[] {
    return this.makeEffectiveShapes(aEdgeOnly, true);
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    const fmt = (v: number): string =>
      aUnitsProvider ? aUnitsProvider.MessageTextFromValue(v) : String(v);

    switch (this.GetShape()) {
      case SHAPE_T.ARC:
        return `Arc, radius ${fmt(this.GetRadius())}`;

      case SHAPE_T.CIRCLE:
        return `Circle, radius ${fmt(this.GetRadius())}`;

      case SHAPE_T.RECTANGLE:
        return `Rectangle, width ${fmt(Math.abs(this.m_start.x - this.m_end.x))} height ${fmt(
          Math.abs(this.m_start.y - this.m_end.y),
        )}`;

      case SHAPE_T.POLY:
        return `Polyline, ${this.GetPolyShape().Outline(0).GetPointCount()} points`;

      case SHAPE_T.BEZIER:
        return `Bezier Curve, ${this.m_bezierPoints.length} points`;

      default:
        return '';
    }
  }

  override Clone(): SCH_SHAPE {
    return SCH_SHAPE.copyShape(new SCH_SHAPE(), this);
  }

  override ViewGetLayers(): number[] {
    const layers = [0, 0, 0];

    layers[0] = this.IsPrivate() ? SCH_LAYER_ID.LAYER_PRIVATE_NOTES : this.m_layer;

    if (this.m_layer === SCH_LAYER_ID.LAYER_DEVICE) {
      if (this.m_fill === FILL_T.FILLED_WITH_BG_BODYCOLOR)
        layers[1] = SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND;
      else layers[1] = SCH_LAYER_ID.LAYER_SHAPES_BACKGROUND;
    } else {
      layers[1] = SCH_LAYER_ID.LAYER_SHAPES_BACKGROUND;
    }

    layers[2] = SCH_LAYER_ID.LAYER_SELECTION_SHADOWS;

    return layers;
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as SCH_SHAPE;

    let similarity = this.SimilarityBase(other);

    similarity *= EDA_SHAPE.prototype.Similarity.call(this, other as unknown as EDA_SHAPE);

    return similarity;
  }

  override equals(aOther: SCH_ITEM): boolean {
    if (aOther.Type() !== this.Type()) return false;

    const other = aOther as SCH_SHAPE;

    return super.equals(aOther) && this.equalsEdaShape(other as unknown as EDA_SHAPE);
  }

  protected override swapData(aItem: SCH_ITEM): void {
    const shape = aItem as SCH_SHAPE;

    this.SwapShape(shape as unknown as EDA_SHAPE);
  }

  setFilled(aFlag: boolean): void {
    this.m_fill = aFlag ? FILL_T.FILLED_WITH_COLOR : FILL_T.NO_FILL;
  }

  isMoving(): boolean {
    return this.IsMoving();
  }

  getMaxError(): number {
    return this.GetMaxError();
  }

  override compare(aOther: SCH_ITEM, aCompareFlags = 0): number {
    let cmpFlags = aCompareFlags;

    // The object UUIDs must be compared after the shape coordinates because shapes do not
    // have immutable UUIDs.
    if (!(cmpFlags & (SCH_ITEM.COMPARE_FLAGS.EQUALITY | SCH_ITEM.COMPARE_FLAGS.ERC)))
      cmpFlags |= SCH_ITEM.COMPARE_FLAGS.EQUALITY;

    let retv = super.compare(aOther, cmpFlags);

    if (retv) return retv;

    retv = EDA_SHAPE.prototype.Compare.call(this, aOther as unknown as EDA_SHAPE);

    if (retv) return retv;

    if (
      aCompareFlags & SCH_ITEM.COMPARE_FLAGS.EQUALITY ||
      aCompareFlags & SCH_ITEM.COMPARE_FLAGS.ERC
    ) {
      return 0;
    }

    if (this.m_Uuid < aOther.m_Uuid) return -1;

    if (this.m_Uuid > aOther.m_Uuid) return 1;

    return 0;
  }
}

applyMixins(SCH_SHAPE, [EDA_SHAPE]);

/**
 * `static struct SCH_SHAPE_DESC` (eeschema/sch_shape.cpp:540).
 */
(() => {
  const fillEnum = ENUM_MAP.Instance<FILL_T>('FILL_T');

  if (fillEnum.Choices().GetCount() === 0) {
    fillEnum
      .Map(FILL_T.NO_FILL, 'None')
      .Map(FILL_T.FILLED_SHAPE, 'Body outline color')
      .Map(FILL_T.FILLED_WITH_BG_BODYCOLOR, 'Body background color')
      .Map(FILL_T.FILLED_WITH_COLOR, 'Fill color');
  }

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_SHAPE);
  propMgr.AddTypeCast(new TYPE_CAST(SCH_SHAPE, SCH_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(SCH_SHAPE, EDA_SHAPE));
  propMgr.InheritsAfter(SCH_SHAPE, SCH_ITEM);
  propMgr.InheritsAfter(SCH_SHAPE, EDA_SHAPE);

  // Only polygons have meaningful Position properties.
  // On other shapes, these are duplicates of the Start properties.
  const isPolygon = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof SCH_SHAPE ? aItem.GetShape() === SHAPE_T.POLY : false;

  const isSymbolItem = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof SCH_SHAPE ? aItem.GetLayer() === SCH_LAYER_ID.LAYER_DEVICE : false;

  const isSchematicItem = (aItem: INSPECTABLE_ITEM): boolean =>
    aItem instanceof SCH_SHAPE ? aItem.GetLayer() !== SCH_LAYER_ID.LAYER_DEVICE : false;

  const isFillColorEditable = (aItem: INSPECTABLE_ITEM): boolean => {
    if (aItem instanceof SCH_SHAPE) {
      if (aItem.GetParentSymbol()) return aItem.GetFillMode() === FILL_T.FILLED_WITH_COLOR;

      return aItem.IsSolidFill();
    }

    return true;
  };

  propMgr.OverrideAvailability(SCH_SHAPE, SCH_ITEM, 'Position X', isPolygon);
  propMgr.OverrideAvailability(SCH_SHAPE, SCH_ITEM, 'Position Y', isPolygon);

  propMgr.OverrideAvailability(SCH_SHAPE, EDA_SHAPE, 'Filled', isSchematicItem);

  propMgr.OverrideWriteability(SCH_SHAPE, EDA_SHAPE, 'Fill Color', isFillColorEditable);

  propMgr
    .AddProperty(
      new PROPERTY_ENUM<SCH_SHAPE, FILL_T>(
        SCH_SHAPE,
        'Fill Mode',
        'SetFillMode',
        'GetFillMode',
        fillEnum,
      ),
      'Shape Properties',
    )
    .SetAvailableFunc(isSymbolItem);
})();
