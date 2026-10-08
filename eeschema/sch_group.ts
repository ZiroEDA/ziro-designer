// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_group.h` / `eeschema/sch_group.cpp`: `SCH_GROUP`, a named set of
 * schematic items (`class SCH_GROUP : public SCH_ITEM, public EDA_GROUP`, the EDA_GROUP
 * half mixed in). Membership only; the group owns nothing.
 *
 * Not here: `ViewGetLOD`, `Plot`, `GetMsgPanelInfo`, `GetMenuImage`, `SCH_GROUP_DESC`.
 */

import { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import { PROPERTY, TYPE_CAST, TYPE_STRING } from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import type { EDA_ITEM, INSPECTOR } from '@ziroeda/common/eda_item.js';
import { IGNORE_PARENT_GROUP, INSPECT_RESULT, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { ENDPOINT, STARTPOINT } from '@ziroeda/common/eda_item_flags.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type SCH_COMMIT_LIKE, SCH_ITEM } from './sch_item.js';

export interface SCH_GROUP extends EDA_GROUP {}

/**
 * A set of SCH_ITEMs (i.e., without duplicates).
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: KiCad's multiple inheritance, see libs/core/mixins.ts
export class SCH_GROUP extends SCH_ITEM {
  /** `SCH_GROUP()`, `SCH_GROUP( SCH_ITEM* aParent )` or `SCH_GROUP( SCH_SCREEN* aParent )`. */
  constructor(aParent: EDA_ITEM | null = null) {
    super(aParent, KICAD_T.SCH_GROUP_T);
    this.initEdaGroup();
    this.SetLayer(SCH_LAYER_ID.LAYER_GROUP);
  }

  /** The compiler-generated copy constructor: the UUID and the member set are copied. */
  static copyOf(aOther: SCH_GROUP): SCH_GROUP {
    const copy = SCH_ITEM.copySchItem(new SCH_GROUP(), aOther);
    copy.initEdaGroupFrom(aOther);
    return copy;
  }

  AsEdaItem(): EDA_ITEM {
    return this;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_GROUP_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_GROUP';
  }

  GetSchItems(): Set<SCH_ITEM> {
    const items = new Set<SCH_ITEM>();

    for (const item of this.m_items) {
      if (item.IsSCH_ITEM()) items.add(item as SCH_ITEM);
    }

    return items;
  }

  /**
   * @return the top level group inside the passed in scope, or null if the item is not in
   *         a group within that scope.
   */
  static TopLevelGroup(
    aItem: SCH_ITEM,
    aScope: EDA_GROUP | null,
    isSymbolEditor: boolean,
  ): EDA_GROUP | null {
    return getNestedGroup(aItem, aScope, isSymbolEditor);
  }

  static WithinScope(aItem: SCH_ITEM, aScope: SCH_GROUP | null, isSymbolEditor: boolean): boolean {
    const group = getClosestGroup(aItem, isSymbolEditor);

    if (group && group === aScope) return true;

    const nested = getNestedGroup(aItem, aScope, isSymbolEditor);

    return (
      !!nested &&
      !!nested.AsEdaItem().GetParentGroup() &&
      nested.AsEdaItem().GetParentGroup() === aScope
    );
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as SCH_GROUP;

    let similarity = 0.0;

    for (const item of this.m_items) {
      for (const otherItem of other.m_items)
        similarity += (item as SCH_ITEM).Similarity(otherItem as SCH_ITEM);
    }

    return similarity / this.m_items.size;
  }

  /** `operator==`: the same member uuids. */
  override equals(aSchItem: SCH_ITEM): boolean {
    if (aSchItem.Type() !== this.Type()) return false;

    const other = aSchItem as SCH_GROUP;

    if (this.m_items.size !== other.m_items.size) return false;

    // EDA_ITEM_SET is ordered by uuid
    const ids = [...this.m_items].map((i) => i.m_Uuid).sort();
    const otherIds = [...other.m_items].map((i) => i.m_Uuid).sort();

    return ids.every((id, i) => id === otherIds[i]);
  }

  override GetPosition(): VECTOR2I {
    return this.GetBoundingBox().Centre();
  }

  override SetPosition(aNewpos: VECTOR2I): void {
    const pos = this.GetPosition();
    this.Move({ x: aNewpos.x - pos.x, y: aNewpos.y - pos.y });
  }

  override Clone(): SCH_GROUP {
    // Use copy constructor to get the same uuid and other fields
    return SCH_GROUP.copyOf(this);
  }

  /** @return a copy of this group and its members, all with the same uuids. */
  DeepClone(): SCH_GROUP {
    // Use copy constructor to get the same uuid and other fields
    const newGroup = SCH_GROUP.copyOf(this);
    newGroup.m_items.clear();

    for (const member of this.m_items) {
      if (member.Type() === KICAD_T.SCH_GROUP_T)
        newGroup.AddItem((member as SCH_GROUP).DeepClone());
      else newGroup.AddItem(member.Clone() as SCH_ITEM);
    }

    return newGroup;
  }

  /** @return a copy of this group and its members, all with new uuids. */
  DeepDuplicate(addToParentGroup: boolean, aCommit: SCH_COMMIT_LIKE | null = null): SCH_GROUP {
    const newGroup = this.Duplicate(addToParentGroup, aCommit) as SCH_GROUP;
    newGroup.m_items.clear();

    for (const member of this.m_items) {
      if (member.Type() === KICAD_T.SCH_GROUP_T)
        newGroup.AddItem((member as SCH_GROUP).DeepDuplicate(IGNORE_PARENT_GROUP));
      else newGroup.AddItem((member as SCH_ITEM).Duplicate(IGNORE_PARENT_GROUP));
    }

    return newGroup;
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    _a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    _b?: number | boolean,
    _c?: number,
  ): boolean {
    // Groups are selected by promoting a selection of one of their children
    return false;
  }

  override GetBoundingBox(): BOX2I {
    const bbox = new BOX2I();

    for (const item of this.m_items) bbox.Merge(item.GetBoundingBox());

    bbox.Inflate(schIUScale.milsToIU(10));

    return bbox;
  }

  override Visit(aInspector: INSPECTOR, aTestData: unknown, aScanTypes: readonly KICAD_T[]) {
    for (const scanType of aScanTypes) {
      if (scanType === this.Type()) {
        if (INSPECT_RESULT.QUIT === aInspector(this, aTestData)) return INSPECT_RESULT.QUIT;
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  override ViewGetLayers(): number[] {
    return [SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR];
  }

  /** Apply \a aOp to every member, lines moving both ends. */
  private forEachMember(aOp: (aItem: SCH_ITEM) => void): void {
    for (const member of this.m_items) {
      const flags = member.GetFlags();

      if (member.Type() === KICAD_T.SCH_LINE_T) member.SetFlags(STARTPOINT | ENDPOINT);

      aOp(member as SCH_ITEM);

      // SetFlags ORs: the line's STARTPOINT | ENDPOINT stay set, as they do upstream.
      member.SetFlags(flags);
    }
  }

  override Move(aMoveVector: VECTOR2I): void {
    this.forEachMember((m) => m.Move(aMoveVector));
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    this.forEachMember((m) => m.Rotate(aCenter, aRotateCCW));
  }

  override MirrorHorizontally(aCenter: number): void {
    this.forEachMember((m) => m.MirrorHorizontally(aCenter));
  }

  override MirrorVertically(aCenter: number): void {
    this.forEachMember((m) => m.MirrorVertically(aCenter));
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    if (this.m_name === '') return `Unnamed Group, ${this.m_items.size} members`;
    else return `Group '${this.m_name}', ${this.m_items.size} members`;
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown): boolean {
    // Groups are selected by promoting a selection of one of their children
    return this.matchesText(unescapeString(this.GetName()), aSearchData);
  }

  override RunOnChildren(aFunction: (aItem: SCH_ITEM) => void, aMode: RECURSE_MODE): void {
    for (const item of this.m_items) {
      aFunction(item as SCH_ITEM);

      if (item.Type() === KICAD_T.SCH_GROUP_T && aMode === RECURSE_MODE.RECURSE)
        (item as SCH_GROUP).RunOnChildren(aFunction, RECURSE_MODE.RECURSE);
    }
  }

  protected override swapData(aImage: SCH_ITEM): void {
    const image = aImage as SCH_GROUP;

    [this.m_items, image.m_items] = [image.m_items, this.m_items];
    [this.m_name, image.m_name] = [image.m_name, this.m_name];
    [this.m_designBlockLibId, image.m_designBlockLibId] = [
      image.m_designBlockLibId,
      this.m_designBlockLibId,
    ];

    // A group doesn't own its children (they're owned by the schematic), so undo doesn't do a
    // deep clone when making an image.  However, it's still safest to update the parentGroup
    // pointers of the group's children -- we just have to be careful to do it in the right
    // order in case any of the children are shared (ie: image first, "this" second so that any
    // shared children end up with "this").
    image.RunOnChildren((child) => child.SetParentGroup(image), RECURSE_MODE.NO_RECURSE);

    this.RunOnChildren((child) => child.SetParentGroup(this), RECURSE_MODE.NO_RECURSE);
  }
}

applyMixins(SCH_GROUP, [EDA_GROUP]);

function getClosestGroup(aItem: SCH_ITEM, isSymbolEditor: boolean): EDA_GROUP | null {
  const parent = aItem.GetParent();

  if (!isSymbolEditor && parent && parent.Type() === KICAD_T.SCH_SYMBOL_T)
    return parent.GetParentGroup();
  else if (parent && parent.Type() === KICAD_T.SCH_SHEET_T) return parent.GetParentGroup();
  else return aItem.GetParentGroup();
}

function getNestedGroup(
  aItem: SCH_ITEM,
  aScope: EDA_GROUP | null,
  isSymbolEditor: boolean,
): EDA_GROUP | null {
  let group = getClosestGroup(aItem, isSymbolEditor);

  if (group === aScope) return null;

  while (group?.AsEdaItem().GetParentGroup() && group.AsEdaItem().GetParentGroup() !== aScope) {
    if (group.AsEdaItem().GetParent()?.Type() === KICAD_T.LIB_SYMBOL_T && isSymbolEditor) break;

    group = group.AsEdaItem().GetParentGroup();
  }

  return group;
}

/**
 * `static struct SCH_GROUP_DESC` (eeschema/sch_group.cpp:447).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_GROUP);
  propMgr.AddTypeCast(new TYPE_CAST(SCH_GROUP, SCH_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(SCH_GROUP, EDA_GROUP));
  propMgr.InheritsAfter(SCH_GROUP, SCH_ITEM);
  propMgr.InheritsAfter(SCH_GROUP, EDA_GROUP);

  propMgr.Mask(SCH_GROUP, SCH_ITEM, 'Position X');
  propMgr.Mask(SCH_GROUP, SCH_ITEM, 'Position Y');

  const groupTab = 'Group Properties';

  propMgr.AddProperty(
    new PROPERTY<EDA_GROUP, string>(EDA_GROUP, 'Name', 'SetName', 'GetName', TYPE_STRING),
    groupTab,
  );
})();
