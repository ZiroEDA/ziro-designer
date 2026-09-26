// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_generator.h` / `pcb_generator.cpp`: `PCB_GENERATOR`, a
 * `PCB_GROUP` whose members are produced by a generator (the tuning
 * patterns), with an origin and a property bag. Abstract: the tool hooks
 * (`EditStart`/`Update`/`EditFinish`/`EditCancel`/`Remove`) and the names
 * are the concrete generator's (`PCB_TUNING_PATTERN`, #636 stage 3 with the
 * GENERATOR_TOOL).
 *
 * Not here: `GetPreviewItems`/`ShowPropertiesDialog` (the frame surface,
 * stage 3/6) and the `GENERATOR_ORDER` property registration, which is
 * compiled out upstream.
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { STRING_ANY_MAP } from '@ziroeda/common/string_any_map.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { FLIP_DIRECTION, MIRRORVAL } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { type VECTOR2I, add } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from './board.js';
import { type BOARD_COMMIT_LIKE, BOARD_ITEM } from './board_item.js';
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

import { PCB_GROUP } from './pcb_group.js';

/** The `GENERATOR_TOOL` the hooks take. -- GENERATOR_TOOL pending (#636 stage 3) */
export type GENERATOR_TOOL_LIKE = object;

/** The `EDIT_POINTS` the edit-point hooks take. -- EDIT_POINTS pending (#636 stage 3) */
export type EDIT_POINTS_LIKE = object;

export abstract class PCB_GENERATOR extends PCB_GROUP {
  protected m_generatorType = '';
  protected m_origin: VECTOR2I = { x: 0, y: 0 };
  protected m_updateOrder = 0;

  constructor(aParent: BOARD_ITEM | null, aLayer: PCB_LAYER_ID) {
    super(aParent, KICAD_T.PCB_GENERATOR_T, aLayer);
  }

  /** The compiler-generated `operator=` for this level. */
  assignGenerator(aOther: PCB_GENERATOR): this {
    this.assignPcbGroup(aOther);
    this.m_generatorType = aOther.m_generatorType;
    this.m_origin = { ...aOther.m_origin };
    this.m_updateOrder = aOther.m_updateOrder;
    return this;
  }

  /*
   * Clone() this and all descendants
   */
  override DeepClone(): PCB_GENERATOR {
    // Use copy constructor to get the same uuid and other fields
    const newGenerator = this.Clone() as PCB_GENERATOR;
    newGenerator.m_items.clear();

    for (const member of this.m_items) {
      if (member.Type() === KICAD_T.PCB_GROUP_T)
        newGenerator.AddItem((member as PCB_GROUP).DeepClone());
      else if (member.Type() === KICAD_T.PCB_GENERATOR_T)
        newGenerator.AddItem((member as PCB_GENERATOR).DeepClone());
      else newGenerator.AddItem(member.Clone() as BOARD_ITEM);
    }

    return newGenerator;
  }

  abstract EditStart(aTool: GENERATOR_TOOL_LIKE, aBoard: BOARD, aCommit: BOARD_COMMIT_LIKE): void;

  abstract Update(aTool: GENERATOR_TOOL_LIKE, aBoard: BOARD, aCommit: BOARD_COMMIT_LIKE): boolean;

  abstract EditFinish(aTool: GENERATOR_TOOL_LIKE, aBoard: BOARD, aCommit: BOARD_COMMIT_LIKE): void;

  abstract EditCancel(aTool: GENERATOR_TOOL_LIKE, aBoard: BOARD, aCommit: BOARD_COMMIT_LIKE): void;

  abstract Remove(aTool: GENERATOR_TOOL_LIKE, aBoard: BOARD, aCommit: BOARD_COMMIT_LIKE): void;

  MakeEditPoints(aEditPoints: EDIT_POINTS_LIKE): boolean {
    return true;
  }

  UpdateFromEditPoints(aEditPoints: EDIT_POINTS_LIKE): boolean {
    return true;
  }

  UpdateEditPoints(aEditPoints: EDIT_POINTS_LIKE): boolean {
    return true;
  }

  override GetBoundingBox(): BOX2I {
    const bbox = new BOX2I();
    return bbox;
  }

  override GetPosition(): VECTOR2I {
    return this.m_origin;
  }
  override SetPosition(aPos: VECTOR2I): void {
    this.m_origin = { x: aPos.x, y: aPos.y };
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.m_origin = add(this.m_origin, aMoveVector);

    PCB_GROUP.prototype.Move.call(this, aMoveVector);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_origin = RotatePoint(this.m_origin, aRotCentre, aAngle);

    PCB_GROUP.prototype.Rotate.call(this, aRotCentre, aAngle);
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.baseMirror(aCentre, aFlipDirection);

    this.SetLayer(this.GetBoard()!.FlipLayer(this.GetLayer()));

    PCB_GROUP.prototype.Flip.call(this, aCentre, aFlipDirection);
  }

  override Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.baseMirror(aCentre, aFlipDirection);

    PCB_GROUP.prototype.Mirror.call(this, aCentre, aFlipDirection);
  }

  protected baseMirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    if (aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM)
      this.m_origin = { x: this.m_origin.x, y: MIRRORVAL(this.m_origin.y, aCentre.y) };
    else this.m_origin = { x: MIRRORVAL(this.m_origin.x, aCentre.x), y: this.m_origin.y };
  }

  override GetLayerSet(): LSET {
    return PCB_GROUP.prototype.GetLayerSet.call(this).or(new LSET([this.GetLayer()]));
  }

  override SetLayer(aLayer: PCB_LAYER_ID): void {
    this.m_layer = aLayer;
  }

  GetGeneratorType(): string {
    return this.m_generatorType;
  }

  GetProperties(): STRING_ANY_MAP {
    const props = new STRING_ANY_MAP(pcbIUScale.IU_PER_MM);

    // #ifdef GENERATOR_ORDER: props.set( "update_order", m_updateOrder ) — compiled out
    props.set_('origin', { ...this.m_origin });

    return props;
  }

  SetProperties(aProps: STRING_ANY_MAP): void {
    // #ifdef GENERATOR_ORDER: aProps.get_to( "update_order", m_updateOrder ) — compiled out
    const origin = aProps.get_to<VECTOR2I>('origin', 'object');

    if (origin !== undefined) this.m_origin = { x: origin.x, y: origin.y };
  }

  GetRowData(): [string, string][] {
    // #ifdef GENERATOR_ORDER ... #else
    return [['', '']];
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return 'Generator';
  }

  abstract GetPluralName(): string;

  abstract GetCommitMessage(): string;

  override GetClass(): string {
    return 'PCB_GENERATOR';
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && KICAD_T.PCB_GENERATOR_T === aItem.Type();
  }

  GetUpdateOrder(): number {
    return this.m_updateOrder;
  }
  SetUpdateOrder(aValue: number): void {
    this.m_updateOrder = aValue;
  }
}

/**
 * `static struct PCB_GENERATOR_DESC` (pcbnew/pcb_generator.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_GENERATOR);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_GENERATOR, BOARD_ITEM));
  propMgr.InheritsAfter(PCB_GENERATOR, BOARD_ITEM);

  const groupTab = 'Generator Properties';

  propMgr.AddProperty(
    new PROPERTY<PCB_GENERATOR, number>(
      PCB_GENERATOR,
      'Update Order',
      'SetUpdateOrder',
      'GetUpdateOrder',
      TYPE_INT,
    ),
    groupTab,
  );
})();
