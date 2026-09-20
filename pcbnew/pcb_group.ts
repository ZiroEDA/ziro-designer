// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_group.h` / `pcb_group.cpp`: a set of BOARD_ITEMs (i.e., without
 * duplicates).
 *
 * The group parent is always board, not logical parent group. The group is
 * transparent container - e.g., its position is derived from the position of
 * its members. A selection containing a group implicitly contains its members.
 * However other operations on sets of items, like committing, updating the
 * view, etc the set is explicit.
 *
 * `EDA_GROUP` is the second base, mixed in with `applyMixins`.
 *
 * Not here: `Serialize`/`Deserialize` (the kiapi protobuf surface) and
 * `PCB_GROUP_DESC`, the `PROPERTY_MANAGER` registration.
 */

import { EDA_GROUP } from '@ziroeda/common/src/eda_group.js';
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
} from '@ziroeda/common/src/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/src/properties/property_mgr.js';

import {
  CompareByUuid,
  type EDA_DRAW_FRAME_LIKE,
  type EDA_ITEM,
  IGNORE_PARENT_GROUP,
  type INSPECTOR,
  INSPECT_RESULT,
  RECURSE_MODE,
} from '@ziroeda/common/src/eda_item.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/src/eda_draw_frame.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/src/eda_search_data.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { KIID } from '@ziroeda/common/src/kiid.js';
import { FLASHING, GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import { applyMixins } from '@ziroeda/core/src/mixins.js';
import type { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_ITEM, type BOARD_COMMIT_LIKE } from './board_item.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_VIEW_FOR_LOD } from './pcb_shape.js';

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (EDA_GROUP mixin)
export interface PCB_GROUP extends EDA_GROUP {}

/**
 * A set of BOARD_ITEMs (i.e., without duplicates).
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (EDA_GROUP mixin)
export class PCB_GROUP extends BOARD_ITEM {
  constructor(aParent: BOARD_ITEM | null);
  /** The protected `PCB_GROUP( BOARD_ITEM* aParent, KICAD_T idtype, PCB_LAYER_ID aLayer )` for `PCB_GENERATOR`. */
  constructor(aParent: BOARD_ITEM | null, idtype: KICAD_T, aLayer?: PCB_LAYER_ID);
  constructor(
    aParent: BOARD_ITEM | null,
    idtype: KICAD_T = KICAD_T.PCB_GROUP_T,
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
  ) {
    super(aParent, idtype, aLayer);
    this.initEdaGroup();
  }

  /** The compiler-generated copy constructor: the UUID and the member set are copied. */
  static copyOf(aOther: PCB_GROUP): PCB_GROUP {
    const copy = new PCB_GROUP(null, aOther.Type(), aOther.m_layer);
    BOARD_ITEM.copyBase(copy, aOther);
    copy.initEdaGroupFrom(aOther);
    return copy;
  }

  /** The compiler-generated `operator=`. */
  assignPcbGroup(aOther: PCB_GROUP): this {
    if (this === aOther) return this;

    this.assignBoardItem(aOther);
    this.assignEdaGroup(aOther);
    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_GROUP_T)) return; // wxCHECK

    this.assignPcbGroup(aOther as PCB_GROUP);
  }

  AsEdaItem(): EDA_ITEM {
    return this;
  }

  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && aItem.Type() === KICAD_T.PCB_GROUP_T;
  }

  GetClass(): string {
    return 'PCB_GROUP';
  }

  GetBoardItems(): Set<BOARD_ITEM> {
    const items = new Set<BOARD_ITEM>();

    for (const item of this.m_items) {
      if (item.IsBOARD_ITEM()) items.add(item as BOARD_ITEM);
    }

    return items;
  }

  /**
   * Check if the proposed item is in the scope of the group.
   *
   * @param aItem item to check
   * @param aScope scope group
   * @param isFootprintEditor
   */
  static TopLevelGroup(
    aItem: BOARD_ITEM,
    aScope: EDA_GROUP | null,
    isFootprintEditor: boolean,
  ): EDA_GROUP | null {
    return getNestedGroup(aItem, aScope, isFootprintEditor);
  }

  static WithinScope(
    aItem: BOARD_ITEM,
    aScope: PCB_GROUP | null,
    isFootprintEditor: boolean,
  ): boolean {
    const group = getClosestGroup(aItem, isFootprintEditor);

    if (group && group === (aScope as EDA_GROUP | null)) return true;

    const nested = getNestedGroup(aItem, aScope, isFootprintEditor);

    return (
      !!nested &&
      !!nested.AsEdaItem().GetParentGroup() &&
      nested.AsEdaItem().GetParentGroup() === (aScope as EDA_GROUP | null)
    );
  }

  Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_GROUP;

    let similarity = 0.0;

    for (const item of this.m_items) {
      for (const otherItem of other.m_items) {
        similarity += (item as BOARD_ITEM).Similarity(otherItem as BOARD_ITEM);
      }
    }

    return similarity / this.m_items.size;
  }

  /** `operator==( const BOARD_ITEM& )`. */
  equals(aBoardItem: BOARD_ITEM): boolean {
    if (aBoardItem.Type() !== this.Type()) return false;

    const other = aBoardItem as PCB_GROUP;

    return this.equalsGroup(other);
  }

  /** `operator==( const PCB_GROUP& )`. */
  equalsGroup(aOther: PCB_GROUP): boolean {
    if (this.m_items.size !== aOther.m_items.size) return false;

    // The items in groups are in unordered sets hashed by the pointer value, so we need to
    // order them by UUID (EDA_ITEM_SET) to compare
    const itemSet = edaItemSet(this.m_items);
    const otherItemSet = edaItemSet(aOther.m_items);

    for (let i = 0; i < itemSet.length; ++i) {
      // Compare UUID instead of the items themselves because we only care if the contents
      // of the group has changed, not which elements in the group have changed
      if (itemSet[i]!.m_Uuid !== otherItemSet[i]!.m_Uuid) return false;
    }

    return true;
  }

  override GetPosition(): VECTOR2I {
    return this.GetBoundingBox().Centre();
  }

  override SetPosition(aNewpos: VECTOR2I): void {
    const pos = this.GetPosition();
    const delta = { x: aNewpos.x - pos.x, y: aNewpos.y - pos.y };

    this.Move(delta);
  }

  override GetLayerSet(): LSET {
    const aSet = new LSET();

    for (const item of this.m_items) aSet.orAssign((item as BOARD_ITEM).GetLayerSet());

    return aSet;
  }

  override SetLayer(aLayer: PCB_LAYER_ID): void {
    // NOP
  }

  override IsOnCopperLayer(): boolean {
    // Don't select groups in eeschema, and don't select groups in pcbnew
    return false;
  }

  override SetLocked(aLockState: boolean): void {
    super.SetLocked(aLockState);

    this.RunOnChildren((child: BOARD_ITEM) => {
      child.SetLocked(aLockState);
    }, RECURSE_MODE.NO_RECURSE);
  }

  override Clone(): EDA_ITEM {
    // Use copy constructor to get the same uuid and other fields
    const newGroup = PCB_GROUP.copyOf(this);
    return newGroup;
  }

  /**
   * Make a deep copy of the group, including all its member items.
   */
  DeepClone(): PCB_GROUP {
    // Use copy constructor to get the same uuid and other fields
    const newGroup = PCB_GROUP.copyOf(this);
    newGroup.m_items.clear();

    for (const member of this.m_items) {
      if (member.Type() === KICAD_T.PCB_GROUP_T)
        newGroup.AddItem((member as PCB_GROUP).DeepClone());
      else if (member.Type() === KICAD_T.PCB_GENERATOR_T)
        newGroup.AddItem((member as PCB_GROUP).DeepClone()); // PCB_GENERATOR::DeepClone, a PCB_GROUP override
      else newGroup.AddItem(member.Clone() as BOARD_ITEM);
    }

    return newGroup;
  }

  /**
   * Make a deep duplicate of the group, including all its member items. The new group and
   * its members all have new UUIDs.
   */
  DeepDuplicate(addToParentGroup: boolean, aCommit: BOARD_COMMIT_LIKE | null = null): PCB_GROUP {
    const newGroup = this.Duplicate(addToParentGroup, aCommit) as PCB_GROUP;
    newGroup.m_items.clear();

    for (const member of this.m_items) {
      // A PCB_GENERATOR owns member items that are not in this group's m_items, so a shallow
      // copy would leave the duplicate referencing the original's members.
      if (member.Type() === KICAD_T.PCB_GROUP_T || member.Type() === KICAD_T.PCB_GENERATOR_T)
        newGroup.AddItem((member as PCB_GROUP).DeepDuplicate(IGNORE_PARENT_GROUP));
      else newGroup.AddItem((member as BOARD_ITEM).Duplicate(IGNORE_PARENT_GROUP));
    }

    return newGroup;
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_GROUP_T);

    const image = aImage as PCB_GROUP;

    // std::swap( *this, *image ): every member of both classes.
    const mine = PCB_GROUP.copyOf(this);
    this.assignPcbGroup(image);
    (this as { m_Uuid: KIID }).m_Uuid = image.m_Uuid;
    image.assignPcbGroup(mine);
    (image as { m_Uuid: KIID }).m_Uuid = mine.m_Uuid;

    // A group doesn't own its children (they're owned by the board), so undo doesn't do a
    // deep clone when making an image.  However, it's still safest to update the parentGroup
    // pointers of the group's children. We must do it in the right order in case any of the
    // children are shared (ie: image first, "this" second so that any shared children end up
    // with "this").
    image.RunOnChildren((child: BOARD_ITEM) => {
      child.SetParentGroup(image);
    }, RECURSE_MODE.NO_RECURSE);

    this.RunOnChildren((child: BOARD_ITEM) => {
      child.SetParentGroup(this);
    }, RECURSE_MODE.NO_RECURSE);
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(): boolean {
    // Groups are selected by promoting a selection of one of their children
    return false;
  }

  override GetBoundingBox(): BOX2I {
    const bbox = new BOX2I();

    for (const item of this.m_items) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T)
        bbox.Merge((item as FOOTPRINT).GetBoundingBox(true));
      else bbox.Merge(item.GetBoundingBox());
    }

    bbox.Inflate(pcbIUScale.mmToIU(0.25)); // Give a min size to the bbox

    return bbox;
  }

  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    const shape = new SHAPE_COMPOUND();

    for (const item of this.GetBoardItems())
      shape.AddShape(item.GetEffectiveShape(aLayer, aFlash).Clone());

    return shape;
  }

  override Visit(
    aInspector: INSPECTOR,
    aTestData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const scanType of aScanTypes) {
      if (scanType === this.Type()) {
        if (INSPECT_RESULT.QUIT === aInspector(this, aTestData)) return INSPECT_RESULT.QUIT;
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  override IsOnLayer(aLayer: PCB_LAYER_ID): boolean {
    // A group is on a layer if any item is on the layer
    for (const item of this.m_items) {
      if ((item as BOARD_ITEM).IsOnLayer(aLayer)) return true;
    }

    return false;
  }

  override ViewGetLayers(): number[] {
    return [GAL_LAYER_ID.LAYER_ANCHOR];
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    if (aView!.IsLayerVisible(GAL_LAYER_ID.LAYER_ANCHOR)) return PCB_GROUP.LOD_SHOW;

    return PCB_GROUP.LOD_HIDE;
  }

  override Move(aMoveVector: VECTOR2I): void {
    for (const member of this.m_items) (member as BOARD_ITEM).Move(aMoveVector);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    for (const item of this.m_items) (item as BOARD_ITEM).Rotate(aRotCentre, aAngle);
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    for (const item of this.m_items) (item as BOARD_ITEM).Flip(aCentre, aFlipDirection);
  }

  override Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    // Footprints have no mirror, only flip. If the group holds one, leave the whole group alone
    // rather than mirror the rest and tear it apart.
    let hasFootprint = false;

    this.RunOnChildren((aChild: BOARD_ITEM) => {
      if (aChild.Type() === KICAD_T.PCB_FOOTPRINT_T) hasFootprint = true;
    }, RECURSE_MODE.RECURSE);

    if (hasFootprint) return;

    for (const item of this.m_items) (item as BOARD_ITEM).Mirror(aCentre, aFlipDirection);
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    if (this.m_name.length === 0) return `Unnamed Group, ${this.m_items.size} members`;
    else return `Group '${this.m_name}', ${this.m_items.size} members`;
  }

  override GetMenuImage(): string {
    return 'module'; // BITMAPS::module
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    aList.push(new MSG_PANEL_ITEM('Group', this.m_name.length === 0 ? '<unnamed>' : this.m_name));
    aList.push(new MSG_PANEL_ITEM('Members', `${this.m_items.size}`));

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME && this.IsLocked())
      aList.push(new MSG_PANEL_ITEM('Status', 'Locked'));
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    return this.matchesText(unescapeString(this.GetName()), aSearchData);
  }

  /**
   * Invoke a function on all members of the group.
   *
   * @note This function should not add or remove items to the group.
   *
   * @param aFunction is the function to be invoked.
   */
  override RunOnChildren(aFunction: (aItem: BOARD_ITEM) => void, aMode: RECURSE_MODE): void {
    for (const item of this.GetBoardItems()) {
      aFunction(item);

      if (
        aMode === RECURSE_MODE.RECURSE &&
        (item.Type() === KICAD_T.PCB_GROUP_T || item.Type() === KICAD_T.PCB_GENERATOR_T)
      ) {
        item.RunOnChildren(aFunction, RECURSE_MODE.RECURSE);
      }
    }
  }
}

applyMixins(PCB_GROUP, [EDA_GROUP]);

/*
 * @return if not in the footprint editor and aItem is in a footprint, returns the
 * footprint's parent group. Otherwise, returns the aItem's parent group.
 */
function getClosestGroup(aItem: BOARD_ITEM, isFootprintEditor: boolean): EDA_GROUP | null {
  const parent = aItem.GetParent();

  if (!isFootprintEditor && parent && parent.Type() === KICAD_T.PCB_FOOTPRINT_T)
    return parent.GetParentGroup();
  else return aItem.GetParentGroup();
}

/// Returns the top level group inside the aScope group, or nullptr
function getNestedGroup(
  aItem: BOARD_ITEM,
  aScope: EDA_GROUP | null,
  isFootprintEditor: boolean,
): EDA_GROUP | null {
  let group = getClosestGroup(aItem, isFootprintEditor);

  if (group === aScope) return null;

  while (
    group &&
    group.AsEdaItem().GetParentGroup() &&
    group.AsEdaItem().GetParentGroup() !== aScope
  )
    group = group.AsEdaItem().GetParentGroup();

  return group;
}

/** `EDA_ITEM_SET`: `std::set<EDA_ITEM*, CompareByUuid>`, the items ordered by UUID. */
function edaItemSet(aItems: Set<EDA_ITEM>): EDA_ITEM[] {
  return [...aItems].sort((a, b) => (CompareByUuid(a, b) ? -1 : CompareByUuid(b, a) ? 1 : 0));
}

/**
 * `static struct PCB_GROUP_DESC` (pcbnew/pcb_group.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_GROUP);
  propMgr.AddTypeCast(new TYPE_CAST(PCB_GROUP, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_GROUP, EDA_GROUP));
  propMgr.InheritsAfter(PCB_GROUP, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_GROUP, EDA_GROUP);

  propMgr.Mask(PCB_GROUP, BOARD_ITEM, 'Position X');
  propMgr.Mask(PCB_GROUP, BOARD_ITEM, 'Position Y');
  propMgr.Mask(PCB_GROUP, BOARD_ITEM, 'Layer');

  const groupTab = 'Group Properties';

  propMgr.AddProperty(
    new PROPERTY<EDA_GROUP, string>(EDA_GROUP, 'Name', 'SetName', 'GetName', TYPE_STRING),
    groupTab,
  );
})();
