// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_junction.h` / `eeschema/sch_junction.cpp`: `SCH_JUNCTION`.
 *
 * Not here: `Serialize`/`Deserialize`, `Plot`, `GetMsgPanelInfo`, `GetMenuImage`,
 * `SCH_JUNCTION_DESC`. The net-class diameter and colour (`GetEffectiveNetClass`)
 * wait on the connection graph (E3 part 2).
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import {
  COLOR4D_UNSPECIFIED,
  type Color4d,
  color4dEquals,
  color4dLess,
} from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_270, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_JUNCTION_DIAM, DEFAULT_WIRE_WIDTH_MILS } from './default_values.js';
import { DANGLING_END_ITEM, DANGLING_END_T, SCH_ITEM } from './sch_item.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

export class SCH_JUNCTION extends SCH_ITEM {
  private m_pos: VECTOR2I; ///< Position of the junction.
  private m_diameter: number; ///< Zero is user default.
  private m_color: Color4d; ///< #COLOR4D::UNSPECIFIED is user default.

  // If real-time connectivity gets disabled (due to being too slow on a particular
  // design), we can no longer rely on getting the NetClass to find netclass-specific
  // linestyles, linewidths and colors.
  private m_lastResolvedDiameter: number;
  private m_lastResolvedColor: Color4d;

  constructor(
    aPosition: VECTOR2I = { x: 0, y: 0 },
    aDiameter = 0,
    aLayer: SCH_LAYER_ID = SCH_LAYER_ID.LAYER_JUNCTION,
  ) {
    super(null, KICAD_T.SCH_JUNCTION_T);
    this.m_pos = { x: aPosition.x, y: aPosition.y };
    this.m_color = { ...COLOR4D_UNSPECIFIED };
    this.m_diameter = aDiameter;
    this.m_layer = aLayer;

    this.m_lastResolvedDiameter = KiROUND(schIUScale.milsToIU(DEFAULT_WIRE_WIDTH_MILS) * 1.7);
    this.m_lastResolvedColor = { ...COLOR4D_UNSPECIFIED };
  }

  /** `SCH_JUNCTION( const SCH_JUNCTION& )`: the compiler-generated copy. */
  static copyOf(aOther: SCH_JUNCTION): SCH_JUNCTION {
    const copy = new SCH_JUNCTION(aOther.m_pos, aOther.m_diameter, aOther.m_layer);
    SCH_ITEM.copySchItem(copy, aOther);
    copy.m_color = { ...aOther.m_color };
    copy.m_lastResolvedDiameter = aOther.m_lastResolvedDiameter;
    copy.m_lastResolvedColor = { ...aOther.m_lastResolvedColor };
    return copy;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_JUNCTION_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_JUNCTION';
  }

  protected override swapData(aItem: SCH_ITEM): void {
    if (!(aItem && aItem.Type() === KICAD_T.SCH_JUNCTION_T)) return; // wxCHECK_RET

    const item = aItem as SCH_JUNCTION;
    [this.m_pos, item.m_pos] = [item.m_pos, this.m_pos];
    [this.m_diameter, item.m_diameter] = [item.m_diameter, this.m_diameter];
    [this.m_color, item.m_color] = [item.m_color, this.m_color];
  }

  override SetLastResolvedState(aItem: SCH_ITEM): void {
    if (aItem instanceof SCH_JUNCTION) {
      this.m_lastResolvedDiameter = aItem.m_lastResolvedDiameter;
      this.m_lastResolvedColor = { ...aItem.m_lastResolvedColor };
    }
  }

  override ViewGetLayers(): number[] {
    return [this.m_layer, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS];
  }

  private getEffectiveShape(): SHAPE_CIRCLE {
    if (this.m_diameter !== 0) this.m_lastResolvedDiameter = this.m_diameter;
    else if (this.Schematic())
      this.m_lastResolvedDiameter = this.Schematic()!.Settings().GetJunctionSize();
    else this.m_lastResolvedDiameter = schIUScale.milsToIU(DEFAULT_JUNCTION_DIAM);

    // Diameter 1 means user doesn't want to draw junctions.
    // if( !IsConnectivityDirty() ) m_lastResolvedDiameter = max( .., netclass wire width * 1.7 ):
    // the net class is pending the connection graph (E3 part 2).

    return new SHAPE_CIRCLE(this.m_pos, Math.max(Math.trunc(this.m_lastResolvedDiameter / 2), 1));
  }

  override GetBoundingBox(): BOX2I {
    const bbox = new BOX2I(this.m_pos);
    bbox.Inflate(this.getEffectiveShape().GetRadius());

    return bbox;
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_pos = { x: this.m_pos.x + aMoveVector.x, y: this.m_pos.y + aMoveVector.y };
  }

  override MirrorHorizontally(aCenter: number): void {
    this.m_pos.x = aCenter - (this.m_pos.x - aCenter);
  }

  override MirrorVertically(aCenter: number): void {
    this.m_pos.y = aCenter - (this.m_pos.y - aCenter);
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    this.m_pos = RotatePoint(this.m_pos, aCenter, aRotateCCW ? ANGLE_90 : ANGLE_270);
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    const item = new DANGLING_END_ITEM(DANGLING_END_T.JUNCTION_END, this, this.m_pos);
    aItemList.push(item);
  }

  override IsConnectable(): boolean {
    return true;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    _aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Do not compare to ourself.
    if (aItem === this) return false;

    if (!(aItem instanceof SCH_JUNCTION)) return false; // wxCHECK

    // Check if the position has changed.
    return !samePt(this.GetPosition(), aItem.GetPosition());
  }

  override GetConnectionPoints(): VECTOR2I[] {
    return [{ ...this.m_pos }];
  }

  override CanConnect(aItem: SCH_ITEM): boolean {
    return (
      aItem.IsConnectable() &&
      (aItem.Type() === KICAD_T.SCH_LINE_T ||
        aItem.Type() === KICAD_T.SCH_SYMBOL_T ||
        aItem.Type() === KICAD_T.SCH_LABEL_T ||
        aItem.Type() === KICAD_T.SCH_GLOBAL_LABEL_T ||
        aItem.Type() === KICAD_T.SCH_HIER_LABEL_T ||
        aItem.Type() === KICAD_T.SCH_DIRECTIVE_LABEL_T)
    );
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'Junction';
  }

  override GetPosition(): VECTOR2I {
    return { ...this.m_pos };
  }
  override SetPosition(aPosition: VECTOR2I): void {
    this.m_pos = { x: aPosition.x, y: aPosition.y };
  }

  override IsPointClickableAnchor(_aPos: VECTOR2I): boolean {
    return false;
  }

  GetEffectiveDiameter(): number {
    return this.getEffectiveShape().GetRadius() * 2;
  }

  GetDiameter(): number {
    return this.m_diameter;
  }

  SetDiameter(aDiameter: number): void {
    this.m_diameter = aDiameter;
    this.m_lastResolvedDiameter = aDiameter;
  }

  GetJunctionColor(): Color4d {
    if (!color4dEquals(this.m_color, COLOR4D_UNSPECIFIED))
      this.m_lastResolvedColor = { ...this.m_color };
    // else if( !IsConnectivityDirty() ) -> GetEffectiveNetClass()->GetSchematicColor(): pending.

    return this.m_lastResolvedColor;
  }

  GetColor(): Color4d {
    return this.m_color;
  }

  SetColor(aColor: Color4d): void {
    this.m_color = { ...aColor };
    this.m_lastResolvedColor = { ...aColor };
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
      const aContained = b as boolean;
      const aAccuracy = c ?? 0;

      if (this.m_flags & STRUCT_DELETED || this.m_flags & SKIP_STRUCT) return false;

      if (aContained) {
        const selRect = new BOX2I(a.GetPosition(), a.GetSize());
        return selRect.Inflate(aAccuracy).Contains(this.GetBoundingBox());
      } else {
        const junction = this.getEffectiveShape();
        const selRect = new SHAPE_RECT(a.GetPosition(), a.GetWidth(), a.GetHeight());

        return selRect.Collide(junction, aAccuracy);
      }
    }

    if ('x' in a && 'y' in a) {
      const aAccuracy = (b as number | undefined) ?? 0;

      if (aAccuracy >= 0) return this.getEffectiveShape().Collide(new SEG(a, a), aAccuracy);
      else return samePt(a, this.m_pos);
    }

    if (this.m_flags & STRUCT_DELETED || this.m_flags & SKIP_STRUCT) return false;

    return KIGEOM_ShapeHitTest(a, this.getEffectiveShape(), b as boolean);
  }

  override Clone(): SCH_JUNCTION {
    return SCH_JUNCTION.copyOf(this);
  }

  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    if (this.GetLayer() !== aItem.GetLayer()) return this.GetLayer() < aItem.GetLayer();

    const junction = aItem as SCH_JUNCTION;

    if (this.GetPosition().x !== junction.GetPosition().x)
      return this.GetPosition().x < junction.GetPosition().x;

    if (this.GetPosition().y !== junction.GetPosition().y)
      return this.GetPosition().y < junction.GetPosition().y;

    if (this.GetDiameter() !== junction.GetDiameter())
      return this.GetDiameter() < junction.GetDiameter();

    return color4dLess(this.GetColor(), junction.GetColor());
  }

  override equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    const other = aOther as SCH_JUNCTION;

    if (!samePt(this.m_pos, other.m_pos)) return false;

    if (this.m_diameter !== other.m_diameter) return false;

    if (!color4dEquals(this.m_color, other.m_color)) return false;

    return true;
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as SCH_JUNCTION;

    let similarity = 1.0;

    if (!samePt(this.m_pos, other.m_pos)) similarity *= 0.9;

    if (this.m_diameter !== other.m_diameter) similarity *= 0.9;

    if (!color4dEquals(this.m_color, other.m_color)) similarity *= 0.9;

    return similarity;
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    return samePt(this.m_pos, aPosition);
  }
}
