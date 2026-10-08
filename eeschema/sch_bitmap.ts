// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_bitmap.h` / `eeschema/sch_bitmap.cpp`: `SCH_BITMAP`, a reference image
 * placed on a schematic; the image and its geometry live in the common `REFERENCE_IMAGE`.
 *
 * Not here: `Plot`, `GetMsgPanelInfo`, `GetMenuImage`, `SCH_BITMAP_DESC`.
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import {
  PROPERTY,
  PROPERTY_DISPLAY,
  TYPE_DOUBLE,
  TYPE_INT,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { GAL_LAYER_ID, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { REFERENCE_IMAGE } from '@ziroeda/common/reference_image.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_270, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  KIGEOM_BoxHitTestBox,
  KIGEOM_BoxHitTestChain,
  KIGEOM_BoxHitTestPoint,
} from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SCH_ITEM } from './sch_item.js';

/**
 * Object to handle a bitmap image that can be inserted in a schematic.
 */
export class SCH_BITMAP extends SCH_ITEM {
  private m_referenceImage: REFERENCE_IMAGE;

  constructor(pos: VECTOR2I = { x: 0, y: 0 }) {
    super(null, KICAD_T.SCH_BITMAP_T);
    this.m_referenceImage = new REFERENCE_IMAGE(schIUScale);
    this.m_referenceImage.SetPosition(pos);
    this.m_layer = SCH_LAYER_ID.LAYER_NOTES; // used only to draw/plot a rectangle,
    // when a bitmap cannot be drawn or plotted
  }

  /** `SCH_BITMAP( const SCH_BITMAP& aSchBitmap )`. */
  static copyOf(aSchBitmap: SCH_BITMAP): SCH_BITMAP {
    const copy = SCH_ITEM.copySchItem(new SCH_BITMAP(), aSchBitmap);
    copy.m_referenceImage = new REFERENCE_IMAGE(aSchBitmap.m_referenceImage);
    return copy;
  }

  /** `SCH_BITMAP& operator=( const SCH_ITEM& aItem )`. */
  assignBitmap(aItem: SCH_ITEM): this {
    if (this.Type() !== aItem.Type()) return this; // wxCHECK_MSG

    if (aItem !== this) {
      this.assignSchItem(aItem);

      const bitmap = aItem as SCH_BITMAP;
      this.m_referenceImage = new REFERENCE_IMAGE(bitmap.m_referenceImage);
    }

    return this;
  }

  GetReferenceImage(): REFERENCE_IMAGE {
    return this.m_referenceImage;
  }

  GetX(): number {
    return this.GetPosition().x;
  }
  SetX(aX: number): void {
    this.SetPosition({ x: aX, y: this.GetY() });
  }
  GetY(): number {
    return this.GetPosition().y;
  }
  SetY(aY: number): void {
    this.SetPosition({ x: this.GetX(), y: aY });
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_BITMAP_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_BITMAP';
  }

  override GetBoundingBox(): BOX2I {
    return this.m_referenceImage.GetBoundingBox();
  }

  override ViewGetLayers(): number[] {
    return [GAL_LAYER_ID.LAYER_DRAW_BITMAPS, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS];
  }

  override Move(aMoveVector: VECTOR2I): void {
    const pos = this.GetPosition();
    this.SetPosition({ x: pos.x + aMoveVector.x, y: pos.y + aMoveVector.y });
  }

  override IsMovableFromAnchorPoint(): boolean {
    return false;
  }

  override MirrorHorizontally(aCenter: number): void {
    this.m_referenceImage.Flip({ x: aCenter, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
  }

  override MirrorVertically(aCenter: number): void {
    this.m_referenceImage.Flip({ x: 0, y: aCenter }, FLIP_DIRECTION.TOP_BOTTOM);
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    this.m_referenceImage.Rotate(aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Image';
  }

  override GetPosition(): VECTOR2I {
    return this.m_referenceImage.GetPosition();
  }

  override SetPosition(aPosition: VECTOR2I): void {
    this.m_referenceImage.SetPosition(aPosition);
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I)
      return KIGEOM_BoxHitTestBox(a, this.GetBoundingBox(), b as boolean, c ?? 0);

    if ('x' in a && 'y' in a)
      return KIGEOM_BoxHitTestPoint(a, this.GetBoundingBox(), (b as number | undefined) ?? 0);

    return KIGEOM_BoxHitTestChain(a, this.GetBoundingBox(), b as boolean);
  }

  override Clone(): SCH_BITMAP {
    return SCH_BITMAP.copyOf(this);
  }

  override Similarity(aItem: SCH_ITEM): number {
    if (this.Type() !== aItem.Type()) return 0.0;

    if (this.m_Uuid === aItem.m_Uuid) return 1.0;

    const bitmap = aItem as SCH_BITMAP;
    return this.m_referenceImage.Similarity(bitmap.m_referenceImage);
  }

  override equals(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return false;

    const bitmap = aItem as SCH_BITMAP;
    return this.m_referenceImage.equals(bitmap.m_referenceImage);
  }

  protected override swapData(aItem: SCH_ITEM): void {
    if (aItem.Type() !== KICAD_T.SCH_BITMAP_T) return; // wxCHECK_RET

    const item = aItem as SCH_BITMAP;
    this.m_referenceImage.SwapData(item.m_referenceImage);
  }

  GetWidth(): number {
    return this.m_referenceImage.GetImage().GetSize().x;
  }
  SetWidth(aWidth: number): void {
    this.m_referenceImage.SetWidth(aWidth);
  }
  GetHeight(): number {
    return this.m_referenceImage.GetImage().GetSize().y;
  }
  SetHeight(aHeight: number): void {
    this.m_referenceImage.SetHeight(aHeight);
  }

  GetTransformOriginOffsetX(): number {
    return this.m_referenceImage.GetTransformOriginOffset().x;
  }
  SetTransformOriginOffsetX(aX: number): void {
    const offset = this.m_referenceImage.GetTransformOriginOffset();
    this.m_referenceImage.SetTransformOriginOffset({ x: aX, y: offset.y });
  }
  GetTransformOriginOffsetY(): number {
    return this.m_referenceImage.GetTransformOriginOffset().y;
  }
  SetTransformOriginOffsetY(aY: number): void {
    const offset = this.m_referenceImage.GetTransformOriginOffset();
    this.m_referenceImage.SetTransformOriginOffset({ x: offset.x, y: aY });
  }

  GetImageScale(): number {
    return this.m_referenceImage.GetImageScale();
  }
  SetImageScale(aScale: number): void {
    this.m_referenceImage.SetImageScale(aScale);
  }
}

/**
 * `static struct SCH_BITMAP_DESC` (eeschema/sch_bitmap.cpp:300).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_BITMAP);
  propMgr.InheritsAfter(SCH_BITMAP, SCH_ITEM);

  const coord = (
    aName: string,
    aSetter: keyof SCH_BITMAP & string,
    aGetter: keyof SCH_BITMAP & string,
    aType = COORD_TYPES_T.NOT_A_COORD,
  ) =>
    new PROPERTY<SCH_BITMAP, number>(
      SCH_BITMAP,
      aName,
      aSetter,
      aGetter,
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      aType,
    );

  propMgr.AddProperty(coord('Position X', 'SetX', 'GetX'));
  propMgr.AddProperty(coord('Position Y', 'SetY', 'GetY'));

  const groupImage = 'Image Properties';

  propMgr.AddProperty(
    new PROPERTY<SCH_BITMAP, number>(
      SCH_BITMAP,
      'Scale',
      'SetImageScale',
      'GetImageScale',
      TYPE_DOUBLE,
    ),
    groupImage,
  );

  propMgr.AddProperty(
    coord(
      'Transform Offset X',
      'SetTransformOriginOffsetX',
      'GetTransformOriginOffsetX',
      COORD_TYPES_T.ABS_X_COORD,
    ),
    groupImage,
  );
  propMgr.AddProperty(
    coord(
      'Transform Offset Y',
      'SetTransformOriginOffsetY',
      'GetTransformOriginOffsetY',
      COORD_TYPES_T.ABS_Y_COORD,
    ),
    groupImage,
  );

  propMgr.AddProperty(coord('Width', 'SetWidth', 'GetWidth'), groupImage);
  propMgr.AddProperty(coord('Height', 'SetHeight', 'GetHeight'), groupImage);
})();
