// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_no_connect.h` / `eeschema/sch_no_connect.cpp`: `SCH_NO_CONNECT`.
 *
 * Not here: `Plot`, `GetMenuImage`.
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_270, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_NOCONNECT_SIZE } from './default_values.js';
import { DANGLING_END_ITEM, DANGLING_END_T, SCH_ITEM } from './sch_item.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

export class SCH_NO_CONNECT extends SCH_ITEM {
  private m_pos: VECTOR2I; ///< Position of the no connect object.
  private m_size: number; ///< Size of the no connect object.

  constructor(pos: VECTOR2I = { x: 0, y: 0 }) {
    super(null, KICAD_T.SCH_NO_CONNECT_T);

    this.m_pos = { x: pos.x, y: pos.y };
    this.m_size = schIUScale.milsToIU(DEFAULT_NOCONNECT_SIZE); // Default no-connect symbol size.

    this.SetLayer(SCH_LAYER_ID.LAYER_NOCONNECT);
  }

  /** `SCH_NO_CONNECT( const SCH_NO_CONNECT& )`: the compiler-generated copy. */
  static copyOf(aOther: SCH_NO_CONNECT): SCH_NO_CONNECT {
    const copy = new SCH_NO_CONNECT(aOther.m_pos);
    SCH_ITEM.copySchItem(copy, aOther);
    copy.m_size = aOther.m_size;
    return copy;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_NO_CONNECT_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_NO_CONNECT';
  }

  GetSize(): number {
    return this.m_size;
  }

  override GetPenWidth(): number {
    if (!this.Schematic()) return 1;

    return Math.max(this.Schematic()!.Settings().m_DefaultLineWidth, 1);
  }

  override ViewGetLayers(): number[] {
    return [SCH_LAYER_ID.LAYER_NOCONNECT, SCH_LAYER_ID.LAYER_SELECTION_SHADOWS];
  }

  override GetEndPoints(aItemList: DANGLING_END_ITEM[]): void {
    const item = new DANGLING_END_ITEM(DANGLING_END_T.NO_CONNECT_END, this, this.m_pos);
    aItemList.push(item);
  }

  override GetBoundingBox(): BOX2I {
    const delta = Math.trunc((this.GetPenWidth() + this.GetSize()) / 2);
    const bbox = new BOX2I(this.m_pos);

    bbox.Inflate(delta);

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

  override IsConnectable(): boolean {
    return true;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    _aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Do not compare to ourself.
    if (aItem === this) return false;

    if (!(aItem instanceof SCH_NO_CONNECT)) return false; // wxCHECK

    // Check if the position has changed.
    return !samePt(this.GetPosition(), aItem.GetPosition());
  }

  override CanConnect(aItem: SCH_ITEM): boolean {
    return (
      (aItem.Type() === KICAD_T.SCH_LINE_T && aItem.GetLayer() === SCH_LAYER_ID.LAYER_WIRE) ||
      aItem.Type() === KICAD_T.SCH_SYMBOL_T ||
      aItem.Type() === KICAD_T.SCH_SHEET_T
    );
  }

  override GetConnectionPoints(): VECTOR2I[] {
    return [{ ...this.m_pos }];
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return 'No Connect';
  }

  override GetPosition(): VECTOR2I {
    return { ...this.m_pos };
  }
  override SetPosition(aPosition: VECTOR2I): void {
    this.m_pos = { x: aPosition.x, y: aPosition.y };
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
      const rect = new BOX2I(a.GetPosition(), a.GetSize());

      rect.Inflate(c ?? 0);

      if (b as boolean) return rect.Contains(this.GetBoundingBox());

      return rect.Intersects(this.GetBoundingBox());
    }

    if ('x' in a && 'y' in a) {
      const delta =
        Math.trunc((this.GetPenWidth() + this.GetSize()) / 2) + ((b as number | undefined) ?? 0);
      const dist = { x: a.x - this.m_pos.x, y: a.y - this.m_pos.y };

      if (Math.abs(dist.x) <= delta && Math.abs(dist.y) <= delta) return true;

      return false;
    }

    return KIGEOM_BoxHitTestChain(a, this.GetBoundingBox(), b as boolean);
  }

  override Clone(): SCH_NO_CONNECT {
    return SCH_NO_CONNECT.copyOf(this);
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (this.m_Uuid === aOther.m_Uuid) return 1.0;

    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as SCH_NO_CONNECT;

    if (!samePt(this.m_pos, other.m_pos)) return 0.0;

    return 1.0;
  }

  override equals(aOther: SCH_ITEM): boolean {
    if (aOther.Type() !== this.Type()) return false;

    const other = aOther as SCH_NO_CONNECT;

    if (!samePt(this.m_pos, other.m_pos)) return false;

    return true;
  }

  protected override swapData(aItem: SCH_ITEM): void {
    if (!(aItem && aItem.Type() === KICAD_T.SCH_NO_CONNECT_T)) return; // wxCHECK_RET

    const item = aItem as SCH_NO_CONNECT;
    [this.m_pos, item.m_pos] = [item.m_pos, this.m_pos];
    [this.m_size, item.m_size] = [item.m_size, this.m_size];
  }

  protected override doIsConnected(aPosition: VECTOR2I): boolean {
    return samePt(this.m_pos, aPosition);
  }
}
