// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_item.h` / `eeschema/sch_item.cpp`: `SCH_ITEM`, the base class
 * for any item which can be embedded within the `SCHEMATIC` container class
 * (and `LIB_SYMBOL`), plus `DANGLING_END_ITEM` and its helper.
 *
 * This is the live-model half of eeschema stage E3: it stands beside the
 * plain records in `types.ts` and nothing in the editor reads it yet.
 *
 * The per-sheet `SCH_CONNECTION` map (`Connection`, `InitializeConnection`,
 * `GetOrInitConnection`, `SetConnectionGraph`, `GetEffectiveNetClass`) is here;
 * `SCH_CONNECTION` itself is created through {@link SCH_ITEM.s_newConnection}, which
 * `sch_connection.ts` sets when it loads (a value import of it here would be a module
 * cycle: it needs `SCH_SHEET_PATH`, whose module extends `SCH_ITEM`).
 *
 * Not here (pending, marked in place): `CONNECTION_GRAPH::RemoveItem` in the destructor,
 * `GetMsgPanelInfo`, `Plot`, the `SCH_ITEM_DESC` property registration and
 * `EESCHEMA_SETTINGS`' default font (the render settings' font or
 * `KICAD_FONT_NAME` is used).
 */

import { ResolveTextVars } from '@ziroeda/common/common.js';
import { EDA_ITEM, type OutStr, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  BRIGHTENED,
  type EDA_ITEM_FLAGS,
  SELECTED,
  SKIP_STRUCT,
  STRUCT_DELETED,
} from '@ziroeda/common/eda_item_flags.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { type KIID, newKiid } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { NETCLASS } from '@ziroeda/common/netclass.js';
import type { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import type { STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_LOW_DEF_MM } from '@ziroeda/kimath/src/base_units.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_CONNECTION, SCH_CONNECTION_GRAPH } from './sch_connection.js';
import type { SCH_RULE_AREA } from './sch_rule_area.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCHEMATIC } from './schematic.js';
import type { SYMBOL } from './symbol.js';

/** `KICAD_FONT_NAME` (font/kicad_font_name.h). */
const KICAD_FONT_NAME = 'KiCad Font';

/**
 * Rendering fonts is expensive (particularly when using outline fonts).  At small effective
 * sizes (ie: zoomed out) the visual differences between outline and/or stroke fonts and the
 * bitmap font becomes immaterial, and there's often more to draw when zoomed out so the
 * performance gain becomes more significant.
 */
const BITMAP_FONT_SIZE_THRESHOLD = 3;

/** `BODY_STYLE`. */
export enum BODY_STYLE {
  BASE = 1,
  DEMORGAN = 2,
}

/** `MINIMUM_SELECTION_DISTANCE`: minimum selection distance in mils. */
export const MINIMUM_SELECTION_DISTANCE = 2;

/** `AUTOPLACE_ALGO`. */
export enum AUTOPLACE_ALGO {
  AUTOPLACE_NONE, // No autoplacement
  AUTOPLACE_AUTO, // A minimalist placement algorithm.
  AUTOPLACE_MANUAL, // A more involved routine that can be annoying if done from the get go.
}

/** `DANGLING_END_T`. */
export enum DANGLING_END_T {
  DANGLING_END_UNKNOWN = 0,
  WIRE_END,
  BUS_END,
  JUNCTION_END,
  PIN_END,
  LABEL_END,
  BUS_ENTRY_END,
  WIRE_ENTRY_END,
  SHEET_LABEL_END,
  NO_CONNECT_END,
}

/**
 * Helper class used to store the state of schematic items that can be connected to
 * other schematic items.
 */
export class DANGLING_END_ITEM {
  private m_item: EDA_ITEM | null; ///< A pointer to the connectable object.
  private m_pos: VECTOR2I; ///< The position of the connection point.
  private m_type: DANGLING_END_T; ///< The type of connection of #m_item.
  private m_parent: EDA_ITEM | null; ///< A pointer to the parent object (in the case of pins).

  constructor(
    aType: DANGLING_END_T,
    aItem: EDA_ITEM | null,
    aPosition: VECTOR2I,
    aParent?: EDA_ITEM | null,
  ) {
    this.m_item = aItem;
    this.m_type = aType;
    this.m_pos = { x: aPosition.x, y: aPosition.y };
    this.m_parent = aParent === undefined ? aItem : aParent;
  }

  equals(aB: DANGLING_END_ITEM): boolean {
    return (
      this.GetItem() === aB.GetItem() &&
      this.GetPosition().x === aB.GetPosition().x &&
      this.GetPosition().y === aB.GetPosition().y &&
      this.GetType() === aB.GetType() &&
      this.GetParent() === aB.GetParent()
    );
  }

  GetPosition(): VECTOR2I {
    return this.m_pos;
  }
  GetItem(): EDA_ITEM | null {
    return this.m_item;
  }
  GetParent(): EDA_ITEM | null {
    return this.m_parent;
  }
  GetType(): DANGLING_END_T {
    return this.m_type;
  }
}

function lessYX(a: DANGLING_END_ITEM, b: DANGLING_END_ITEM): boolean {
  const aPos = a.GetPosition();
  const bPos = b.GetPosition();
  return aPos.y < bPos.y ? true : aPos.y > bPos.y ? false : aPos.x < bPos.x;
}

function lessType(a: DANGLING_END_ITEM, b: DANGLING_END_ITEM): boolean {
  return a.GetType() < b.GetType();
}

/** `std::lower_bound` over a sorted array with a strict-weak `less`. */
function lowerBound<T>(aList: readonly T[], aNeedle: T, aLess: (a: T, b: T) => boolean): number {
  let lo = 0;
  let hi = aList.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (aLess(aList[mid]!, aNeedle)) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

/** `DANGLING_END_ITEM_HELPER`: iterators are indices into the vectors here. */
export const DANGLING_END_ITEM_HELPER = {
  get_lower_pos(aItemListByPos: readonly DANGLING_END_ITEM[], aPos: VECTOR2I): number {
    const needle = new DANGLING_END_ITEM(DANGLING_END_T.PIN_END, null, aPos);
    return lowerBound(aItemListByPos, needle, lessYX);
  },

  get_lower_type(aItemListByType: readonly DANGLING_END_ITEM[], aType: DANGLING_END_T): number {
    const needle = new DANGLING_END_ITEM(aType, null, { x: 0, y: 0 });
    return lowerBound(aItemListByType, needle, lessType);
  },

  sort_dangling_end_items(
    aItemListByType: DANGLING_END_ITEM[],
    aItemListByPos: DANGLING_END_ITEM[],
  ): void {
    // WIRE_END pairs must be kept together. Hence stable sort (Array.prototype.sort is stable).
    aItemListByType.sort((a, b) => (lessType(a, b) ? -1 : lessType(b, a) ? 1 : 0));

    // Sort by y first, pins are more likely to share x than y.
    aItemListByPos.sort((a, b) => (lessYX(a, b) ? -1 : lessYX(b, a) ? 1 : 0));
  },
};

export type SCH_ITEM_VEC = SCH_ITEM[];

/** The parts of `SCH_RENDER_SETTINGS` `GetEffectivePenWidth` reads. */
export interface SCH_RENDER_SETTINGS_LIKE extends RENDER_SETTINGS {
  m_SymbolLineWidth: number;
}

/** The commit `Duplicate` hands the parent group to (`SCH_COMMIT`). */
export interface SCH_COMMIT_LIKE {
  Modify(aItem: EDA_ITEM, aScreen: unknown, aMode: RECURSE_MODE): void;
}

const labelTypes: readonly KICAD_T[] = [KICAD_T.SCH_LABEL_LOCATE_ANY_T];

/**
 * Base class for any item which can be embedded within the #SCHEMATIC container class,
 * and therefore instances of derived classes should only be found in EESCHEMA or other
 * programs that use class SCHEMATIC and its contents.
 *
 * The corresponding class in Pcbnew is #BOARD_ITEM.
 */
export abstract class SCH_ITEM extends EDA_ITEM {
  protected m_layer: SCH_LAYER_ID;
  protected m_unit: number; // set to 0 if common to all units
  protected m_bodyStyle: number; // set to 0 if common to all body styles
  protected m_private: boolean; // only shown in Symbol Editor
  protected m_fieldsAutoplaced: AUTOPLACE_ALGO; // indicates status of field autoplacement
  protected m_storedPos: VECTOR2I; // temp variable used in some move commands to store
  // an initial position of the item or mouse cursor

  /** Store pointers to other items that are connected to this one, per sheet. */
  protected m_connected_items: Map<string, SCH_ITEM_VEC>;
  /** Store connectivity information, per sheet. */
  protected m_connection_map: Map<string, SCH_CONNECTION>;
  protected m_connectivity_dirty: boolean;
  /** Store pointers to rule areas which this item is contained within. */
  protected m_rule_areas_cache: Set<SCH_RULE_AREA>;

  constructor(aParent: EDA_ITEM | null, aType: KICAD_T, aUnit = 0, aBodyStyle = 0) {
    super(aParent, aType, true, false);
    this.m_unit = aUnit;
    this.m_bodyStyle = aBodyStyle;
    this.m_private = false;
    this.m_layer = SCH_LAYER_ID.LAYER_WIRE; // It's only a default, in fact
    this.m_fieldsAutoplaced = AUTOPLACE_ALGO.AUTOPLACE_NONE;
    this.m_storedPos = { x: 0, y: 0 };
    this.m_connected_items = new Map();
    this.m_connection_map = new Map();
    this.m_connectivity_dirty = false; // Item is unconnected until it is placed, so it's clean
    this.m_rule_areas_cache = new Set();
  }

  /**
   * `SCH_ITEM( const SCH_ITEM& aItem )` for a derived copy constructor: `EDA_ITEM`'s copy
   * (the UUID is kept) then this class's members. The connection maps start empty.
   */
  protected static copySchItem<T extends SCH_ITEM>(aInto: T, aItem: SCH_ITEM): T {
    aInto.assign(aItem);
    (aInto as { m_Uuid: KIID }).m_Uuid = aItem.m_Uuid;
    aInto.SetForceVisible(aItem.IsForceVisible());
    aInto.m_layer = aItem.m_layer;
    aInto.m_unit = aItem.m_unit;
    aInto.m_bodyStyle = aItem.m_bodyStyle;
    aInto.m_private = aItem.m_private;
    aInto.m_fieldsAutoplaced = aItem.m_fieldsAutoplaced;
    aInto.m_connectivity_dirty = aItem.m_connectivity_dirty;
    return aInto;
  }

  /** `SCH_ITEM& operator=( const SCH_ITEM& aPin )`: EDA_ITEM's part is not assigned. */
  assignSchItem(aItem: SCH_ITEM): this {
    this.m_layer = aItem.m_layer;
    this.m_unit = aItem.m_unit;
    this.m_bodyStyle = aItem.m_bodyStyle;
    this.m_private = aItem.m_private;
    this.m_fieldsAutoplaced = aItem.m_fieldsAutoplaced;
    this.m_connectivity_dirty = aItem.m_connectivity_dirty;

    return this;
  }

  /**
   * `~SCH_ITEM()`: drop the connections and remove this item from any rule areas that
   * contain it. The connection graph's `RemoveItem` is not called yet (see the header).
   */
  Destroy(): void {
    for (const ruleArea of this.m_rule_areas_cache) ruleArea.RemoveItem(this);

    this.m_connection_map.clear();
  }

  override GetClass(): string {
    return 'SCH_ITEM';
  }

  override IsType(aScanTypes: readonly KICAD_T[]): boolean {
    if (super.IsType(aScanTypes)) return true;

    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.SCH_ITEM_LOCATE_WIRE_T && this.m_layer === SCH_LAYER_ID.LAYER_WIRE)
        return true;

      if (scanType === KICAD_T.SCH_ITEM_LOCATE_BUS_T && this.m_layer === SCH_LAYER_ID.LAYER_BUS)
        return true;

      if (
        scanType === KICAD_T.SCH_ITEM_LOCATE_GRAPHIC_LINE_T &&
        this.Type() === KICAD_T.SCH_LINE_T &&
        this.m_layer === SCH_LAYER_ID.LAYER_NOTES
      ) {
        return true;
      }
    }

    return false;
  }

  IsGroupableType(): boolean {
    switch (this.Type()) {
      case KICAD_T.SCH_SYMBOL_T:
      case KICAD_T.SCH_PIN_T:
      case KICAD_T.SCH_SHAPE_T:
      case KICAD_T.SCH_BITMAP_T:
      case KICAD_T.SCH_FIELD_T:
      case KICAD_T.SCH_TEXT_T:
      case KICAD_T.SCH_TEXTBOX_T:
      case KICAD_T.SCH_TABLE_T:
      case KICAD_T.SCH_GROUP_T:
      case KICAD_T.SCH_LINE_T:
      case KICAD_T.SCH_JUNCTION_T:
      case KICAD_T.SCH_NO_CONNECT_T:
      case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
      case KICAD_T.SCH_BUS_BUS_ENTRY_T:
      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
      case KICAD_T.SCH_RULE_AREA_T:
      case KICAD_T.SCH_DIRECTIVE_LABEL_T:
      case KICAD_T.SCH_SHEET_T:
        return true;

      // Don't group sheet pins directly, they go along with an SCH_SHEET, and all operations
      // should be performed on that sheet.
      default:
        return false;
    }
  }

  /**
   * Swap data with \a aImage: the items' common members here, then `swapData` for the
   * derived class's. The parent is restored afterwards.
   */
  SwapItemData(aImage: SCH_ITEM | null): void {
    if (aImage === null) return;

    const parent = this.GetParent();

    this.SwapFlags(aImage);
    [this.m_layer, aImage.m_layer] = [aImage.m_layer, this.m_layer];
    [this.m_unit, aImage.m_unit] = [aImage.m_unit, this.m_unit];
    [this.m_bodyStyle, aImage.m_bodyStyle] = [aImage.m_bodyStyle, this.m_bodyStyle];
    [this.m_private, aImage.m_private] = [aImage.m_private, this.m_private];
    [this.m_fieldsAutoplaced, aImage.m_fieldsAutoplaced] = [
      aImage.m_fieldsAutoplaced,
      this.m_fieldsAutoplaced,
    ];

    // Don't swap m_group. Group membership is restored by SCH_GROUP::swapData, and the undo copy
    // has no group, so swapping it here would drop the item out of its group.
    this.swapData(aImage);

    this.SetParent(parent);
  }

  /** Swap the non-temp and non-edit flags. */
  SwapFlags(aItem: SCH_ITEM): void {
    const editFlags = this.GetEditFlags();
    const tempFlags = this.GetTempFlags();
    const aItem_editFlags = aItem.GetEditFlags();
    const aItem_tempFlags = aItem.GetTempFlags();

    const mine = this.GetFlags();
    this.ClearFlags();
    this.SetFlags(aItem.GetFlags());
    aItem.ClearFlags();
    aItem.SetFlags(mine);

    this.ClearEditFlags();
    this.SetFlags(editFlags);
    this.ClearTempFlags();
    this.SetFlags(tempFlags);

    aItem.ClearEditFlags();
    aItem.SetFlags(aItem_editFlags);
    aItem.ClearTempFlags();
    aItem.SetFlags(aItem_tempFlags);
  }

  /**
   * Routine to create a new copy of given item.  The new object is not put in draw list
   * (not linked).
   *
   * @param addToParentGroup Indicates whether or not the new item is added to the group
   *                         (if any) containing the old item.
   * @param aCommit The commit to add the new item's parent group to.
   * @param doClone (default = false) indicates unique values (such as timestamp and
   *                sheet name) should be duplicated.  Use only for undo/redo operations.
   */
  Duplicate(addToParentGroup: boolean, aCommit: SCH_COMMIT_LIKE | null = null, doClone = false) {
    const newItem = this.Clone() as SCH_ITEM;

    if (!doClone) (newItem as { m_Uuid: KIID }).m_Uuid = newKiid();

    newItem.ClearFlags(SELECTED | BRIGHTENED);

    newItem.RunOnChildren((aChild: SCH_ITEM) => {
      aChild.ClearFlags(SELECTED | BRIGHTENED);
    }, RECURSE_MODE.NO_RECURSE);

    if (addToParentGroup) {
      if (!aCommit) return newItem; // wxCHECK_MSG: "Must supply a commit to update parent group"

      const group = newItem.GetParentGroup();

      if (group) {
        aCommit.Modify(group.AsEdaItem(), null, RECURSE_MODE.NO_RECURSE);
        group.AddItem(newItem);
      }
    }

    return newItem;
  }

  SetUnit(aUnit: number): void {
    this.m_unit = aUnit;
  }
  GetUnit(): number {
    return this.m_unit;
  }

  SetUnitString(aUnit: string): void {
    if (aUnit === 'All units') {
      this.m_unit = 0;
      return;
    }

    const symbol = this.GetParentSymbol();

    if (symbol) {
      for (let ii = 1; ii <= symbol.GetUnitCount(); ii++) {
        if (symbol.GetUnitDisplayName(ii, false) === aUnit) {
          this.m_unit = ii;
          return;
        }
      }
    }
  }

  GetUnitString(): string {
    return this.GetUnitDisplayName(this.m_unit, false);
  }

  GetUnitDisplayName(aUnit: number, aLabel: boolean): string {
    if (aUnit === 0) return aLabel ? 'All units' : 'All units';

    const symbol = this.GetParentSymbol();

    if (symbol) return symbol.GetUnitDisplayName(aUnit, aLabel);

    return '';
  }

  GetBodyStyleDescription(aBodyStyle: number, aLabel: boolean): string {
    if (aBodyStyle === 0) return aLabel ? 'All body styles' : 'All body styles';

    const symbol = this.GetParentSymbol();

    if (symbol) return symbol.GetBodyStyleDescription(aBodyStyle, aLabel);

    return '';
  }

  SetBodyStyle(aBodyStyle: number): void {
    this.m_bodyStyle = aBodyStyle;
  }
  GetBodyStyle(): number {
    return this.m_bodyStyle;
  }

  SetBodyStyleProp(aBodyStyle: string): void {
    if (aBodyStyle === 'All body styles') {
      this.m_bodyStyle = 0;
      return;
    }

    const symbol = this.GetParentSymbol();

    if (symbol) {
      for (const bodyStyle of [BODY_STYLE.BASE, BODY_STYLE.DEMORGAN]) {
        if (symbol.GetBodyStyleDescription(bodyStyle, false) === aBodyStyle) {
          this.m_bodyStyle = bodyStyle;
          return;
        }
      }
    }
  }

  GetBodyStyleProp(): string {
    return this.GetBodyStyleDescription(this.m_bodyStyle, false);
  }

  SetPrivate(aPrivate: boolean): void {
    this.m_private = aPrivate;
  }
  IsPrivate(): boolean {
    return this.m_private;
  }

  SetExcludedFromSim(
    _aExclude: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {}
  GetExcludedFromSim(_aInstance: SCH_SHEET_PATH | null = null, _aVariantName = ''): boolean {
    return false;
  }

  ResolveExcludedFromSim(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    if (this.GetExcludedFromSim(aInstance, aVariantName)) return true;

    for (const area of this.m_rule_areas_cache) {
      if (area.GetExcludedFromSim(aInstance, aVariantName)) return true;
    }

    return false;
  }

  SetExcludedFromBOM(
    _aExcludeFromBOM: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {}
  GetExcludedFromBOM(_aInstance: SCH_SHEET_PATH | null = null, _aVariantName = ''): boolean {
    return false;
  }

  ResolveExcludedFromBOM(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    if (this.GetExcludedFromBOM(aInstance, aVariantName)) return true;

    for (const area of this.m_rule_areas_cache) {
      if (area.GetExcludedFromBOM(aInstance, aVariantName)) return true;
    }

    return false;
  }

  SetExcludedFromBoard(
    _aExclude: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {}
  GetExcludedFromBoard(_aInstance: SCH_SHEET_PATH | null = null, _aVariantName = ''): boolean {
    return false;
  }

  ResolveExcludedFromBoard(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    if (this.GetExcludedFromBoard(aInstance, aVariantName)) return true;

    for (const area of this.m_rule_areas_cache) {
      if (area.GetExcludedFromBoard(aInstance, aVariantName)) return true;
    }

    return false;
  }

  SetExcludedFromPosFiles(
    _aExclude: boolean,
    _aInstance: SCH_SHEET_PATH | null = null,
    _aVariantName = '',
  ): void {}
  GetExcludedFromPosFiles(_aInstance: SCH_SHEET_PATH | null = null, _aVariantName = ''): boolean {
    return false;
  }

  ResolveExcludedFromPosFiles(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    if (this.GetExcludedFromPosFiles(aInstance, aVariantName)) return true;

    for (const area of this.m_rule_areas_cache) {
      if (area.GetExcludedFromPosFiles(aInstance, aVariantName)) return true;
    }

    return false;
  }

  SetDNP(_aDNP: boolean, _aInstance: SCH_SHEET_PATH | null = null, _aVariantName = ''): void {}
  GetDNP(_aInstance: SCH_SHEET_PATH | null = null, _aVariantName = ''): boolean {
    return false;
  }

  ResolveDNP(aInstance: SCH_SHEET_PATH | null = null, aVariantName = ''): boolean {
    if (this.GetDNP(aInstance, aVariantName)) return true;

    for (const area of this.m_rule_areas_cache) {
      if (area.GetDNP(aInstance, aVariantName)) return true;
    }

    return false;
  }

  /**
   * Resolve `${…}` variables in \a aText against this item's parent: a library symbol, a
   * placed symbol, a sheet, a label, or else the project and the schematic.
   */
  ResolveText(aText: string, aPath: SCH_SHEET_PATH | null, aDepth = 0): string {
    // Use aDepth to track recursion across nested GetShownText/ResolveText calls
    const depth = aDepth;
    const parent = this.m_parent as unknown as {
      Type(): KICAD_T;
      IsType(t: readonly KICAD_T[]): boolean;
      ResolveTextVar(...args: unknown[]): boolean;
    } | null;

    const libSymbolResolver = (token: OutStr): boolean => parent!.ResolveTextVar(token, depth + 1);

    const symbolResolver = (token: OutStr): boolean =>
      parent!.ResolveTextVar(aPath, token, depth + 1);

    const schematicResolver = (token: OutStr): boolean => {
      if (!aPath) return false;

      const schematic = this.Schematic();

      if (schematic) return schematic.ResolveTextVar(aPath, token, depth + 1);

      return false;
    };

    const sheetResolver = (token: OutStr): boolean => {
      if (!aPath) return false;

      const schematic = this.Schematic();
      const path = aPath.Clone();
      path.push_back(parent as never);

      let retval = parent!.ResolveTextVar(path, token, depth + 1);

      if (schematic) retval = schematic.ResolveTextVar(path, token, depth + 1) || retval;

      return retval;
    };

    const labelResolver = (token: OutStr): boolean => {
      if (!aPath) return false;

      return parent!.ResolveTextVar(aPath, token, depth + 1);
    };

    // Create a unified resolver that delegates to the appropriate resolver based on parent type
    const fieldResolver = (token: OutStr): boolean => {
      let resolved = false;

      if (parent && parent.Type() === KICAD_T.LIB_SYMBOL_T) resolved = libSymbolResolver(token);
      else if (parent && parent.Type() === KICAD_T.SCH_SYMBOL_T) resolved = symbolResolver(token);
      else if (parent && parent.Type() === KICAD_T.SCH_SHEET_T) resolved = sheetResolver(token);
      else if (parent?.IsType(labelTypes)) resolved = labelResolver(token);
      else if (this.Schematic()) {
        // Project-level and schematic-level variables
        const schematic = this.Schematic()!;
        resolved = schematic.Project().TextVarResolver(token);
        resolved = schematicResolver(token) || resolved;
      }

      return resolved;
    };

    return ResolveTextVars(aText, fieldResolver, { value: depth });
  }

  /**
   * @return true for items which are moved with the anchor point at mouse cursor
   *         and false for items moved with no reference to anchor.
   */
  IsMovableFromAnchorPoint(): boolean {
    return true;
  }

  GetStoredPos(): VECTOR2I {
    return this.m_storedPos;
  }
  SetStoredPos(aPos: VECTOR2I): void {
    this.m_storedPos = { x: aPos.x, y: aPos.y };
  }

  /**
   * Search the item hierarchy to find a #SCHEMATIC.
   *
   * Every #SCH_ITEM that lives on a #SCH_SCREEN should be parented to either that screen
   * or another #SCH_ITEM on the same screen (for example, pins to their symbols).
   *
   * Every #SCH_SCREEN should be parented to the #SCHEMATIC.
   *
   * @note This hierarchy is not the same as the sheet hierarchy!
   * @return the parent schematic this item lives on, or nullptr.
   */
  Schematic(): SCHEMATIC | null {
    return this.findParent(KICAD_T.SCHEMATIC_T) as unknown as SCHEMATIC | null;
  }

  GetParentSymbol(): SYMBOL | null {
    const sch_symbol = this.findParent(KICAD_T.SCH_SYMBOL_T);

    if (sch_symbol) return sch_symbol as unknown as SYMBOL;

    const lib_symbol = this.findParent(KICAD_T.LIB_SYMBOL_T);

    if (lib_symbol) return lib_symbol as unknown as SYMBOL;

    return null;
  }

  /** Indicates that the item has at least one hypertext action. */
  HasHypertext(): boolean {
    return false;
  }

  /** Indicates that a hypertext link is currently active. */
  HasHoveredHypertext(): boolean {
    return this.HasHypertext() && this.IsRollover();
  }

  DoHypertextAction(_aFrame: unknown, _aMousePos: VECTOR2I): void {}

  /** Return the layer this item is on. */
  GetLayer(): SCH_LAYER_ID {
    return this.m_layer;
  }

  /** Set the layer this item is on. */
  SetLayer(aLayer: SCH_LAYER_ID): void {
    this.m_layer = aLayer;
  }

  /** Return the layers the item is drawn on (which may be more than its "home" layer) */
  override ViewGetLayers(): number[] {
    // Basic fallback
    return [
      SCH_LAYER_ID.LAYER_DEVICE,
      SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ];
  }

  /** The maximum error the schematic's settings allow when approximating arcs. */
  GetMaxError(): number {
    const schematic = this.Schematic();

    if (schematic) return schematic.Settings().m_MaxError;

    return schIUScale.mmToIU(ARC_LOW_DEF_MM);
  }

  /** Return the size of the "pen" that be used to draw or plot this item. */
  GetPenWidth(): number {
    return 0;
  }

  GetEffectivePenWidth(aSettings: SCH_RENDER_SETTINGS_LIKE): number {
    // For historical reasons, a stored value of 0 means "default width" and negative
    // numbers meant "don't stroke".

    if (this.GetPenWidth() < 0) {
      return 0;
    } else if (this.GetPenWidth() === 0) {
      if (this.GetParent() && this.GetParent()!.Type() === KICAD_T.LIB_SYMBOL_T)
        return Math.max(aSettings.m_SymbolLineWidth, aSettings.GetMinPenWidth());
      else return Math.max(aSettings.GetDefaultPenWidth(), aSettings.GetMinPenWidth());
    } else {
      return Math.max(this.GetPenWidth(), aSettings.GetMinPenWidth());
    }
  }

  GetDefaultFont(aSettings: RENDER_SETTINGS | null): string {
    if (aSettings) return aSettings.GetDefaultFont();

    // EESCHEMA_SETTINGS' m_Appearance.default_font is pending (settings are stage E6).
    return KICAD_FONT_NAME;
  }

  GetFontMetrics(): METRICS {
    const schematic = this.Schematic();

    if (schematic) return schematic.Settings().m_FontMetrics;

    return METRICS.Default();
  }

  override RenderAsBitmap(aWorldScale: number): boolean {
    if (this.HasHypertext()) return false;

    const text = this as unknown as Partial<EDA_TEXT>;

    if (typeof text.GetTextHeight === 'function' && typeof text.GetTextPos === 'function')
      return text.GetTextHeight() * aWorldScale < BITMAP_FONT_SIZE_THRESHOLD;

    return false;
  }

  /**
   * Return a measure of how likely the other object is to represent the same
   * object.  The scale runs from 0.0 (definitely different objects) to 1.0 (same)
   */
  Similarity(_aItem: SCH_ITEM): number {
    // wxCHECK_MSG( false, 0.0, "Similarity not implemented in " + GetClass() )
    return 0.0;
  }

  /**
   * Calculate the boilerplate similarity for all LIB_ITEMs without preventing the use above
   * of a pure virtual function that catches at compile time when a new object has not been
   * fully implemented
   */
  SimilarityBase(aItem: SCH_ITEM): number {
    let similarity = 1.0;

    if (this.m_unit !== aItem.m_unit) similarity *= 0.9;

    if (this.m_bodyStyle !== aItem.m_bodyStyle) similarity *= 0.9;

    if (this.m_private !== aItem.m_private) similarity *= 0.9;

    return similarity;
  }

  /** Move the item by \a aMoveVector to a new position. */
  Move(_aMoveVector: VECTOR2I): void {
    // wxCHECK_MSG( false, "Move not implemented in " + GetClass() )
  }

  /** Mirror item horizontally about \a aCenter. */
  MirrorHorizontally(_aCenter: number): void {
    // wxCHECK_MSG( false, "MirrorHorizontally not implemented in " + GetClass() )
  }

  /** Mirror item vertically about \a aCenter. */
  MirrorVertically(_aCenter: number): void {
    // wxCHECK_MSG( false, "MirrorVertically not implemented in " + GetClass() )
  }

  /** Rotate the item around \a aCenter 90 degrees in the clockwise direction. */
  Rotate(_aCenter: VECTOR2I, _aRotateCCW: boolean): void {
    // wxCHECK_MSG( false, "Rotate not implemented in " + GetClass() )
  }

  /** Begin drawing a symbol library draw item at \a aPosition. */
  BeginEdit(_aPosition: VECTOR2I): void {}

  /** Continue an edit in progress at \a aPosition. */
  ContinueEdit(_aPosition: VECTOR2I): boolean {
    return false;
  }

  /** End an object editing action. */
  EndEdit(_aClosed = false): void {}

  /** Calculate the attributes of an item at \a aPosition when it is being edited. */
  CalcEdit(_aPosition: VECTOR2I): void {}

  /**
   * Add the schematic item end points to \a aItemList if the item has end points.
   *
   * The default version doesn't do anything since many of the schematic object cannot
   * be tested for dangling ends.  If you add a new schematic item that can have a
   * dangling end ( no connect ), override this method to provide the correct end
   * points.
   */
  GetEndPoints(_aItemList: DANGLING_END_ITEM[]): void {}

  /**
   * Test the schematic item to \a aItemList to check if it's dangling state has changed.
   *
   * Note that the return value only true when the state of the test has changed.  Use
   * the IsDangling() method to get the current dangling state of the item.  Some of
   * the schematic objects cannot be tested for a dangling state, the default method
   * always returns false.  Only override the method if the item can be tested for a
   * dangling state.
   *
   * If aSheet is passed a non-null pointer to a SCH_SHEET_PATH, the overridden method can
   * optionally use it to update sheet-local connectivity information
   */
  UpdateDanglingState(
    _aItemListByType: DANGLING_END_ITEM[],
    _aItemListByPos: DANGLING_END_ITEM[],
    _aSheet: SCH_SHEET_PATH | null = null,
  ): boolean {
    return false;
  }

  IsEndPoint(_aPt: VECTOR2I): boolean {
    return false;
  }

  IsDangling(): boolean {
    return false;
  }

  CanConnect(aItem: SCH_ITEM): boolean {
    return this.m_layer === aItem.GetLayer();
  }

  /** @return true if the schematic item can connect to another schematic item. */
  IsConnectable(): boolean {
    return false;
  }

  /**
   * @return true if the given point can start drawing (usually means the anchor is
   *         unused/free/dangling).
   */
  IsPointClickableAnchor(_aPos: VECTOR2I): boolean {
    return false;
  }

  /**
   * Add all the connection points for this item to \a aPoints.
   *
   * Not all schematic items have connection points so the default method does nothing.
   */
  GetConnectionPoints(): VECTOR2I[] {
    return [];
  }

  /**
   * Test the item to see if it is connected to \a aPoint.
   *
   * @param aPoint A reference to a VECTOR2I object containing the coordinates to test.
   * @return True if connection to \a aPoint exists.
   */
  IsConnected(aPosition: VECTOR2I): boolean {
    if (this.m_flags & STRUCT_DELETED || this.m_flags & SKIP_STRUCT) return false;

    return this.doIsConnected(aPosition);
  }

  /**
   * `new SCH_CONNECTION( aParent )`: set by `sch_connection.ts` when it loads (see the
   * header note on the module cycle).
   */
  static s_newConnection: ((aParent: SCH_ITEM) => SCH_CONNECTION) | null = null;

  /**
   * Retrieve the connection associated with this object in the given sheet.
   *
   * @note The returned value can be null.
   */
  Connection(aSheet: SCH_SHEET_PATH | null = null): SCH_CONNECTION | null {
    if (!this.IsConnectable()) return null;

    if (!aSheet) {
      const sch = this.Schematic();

      if (!sch) return null; // Item has been removed from schematic (e.g. SCH_PIN during symbol deletion)

      aSheet = sch.CurrentSheet();
    }

    return this.m_connection_map.get(aSheet.PathAsString()) ?? null;
  }

  /**
   * The per-sheet connections, keyed by `SCH_SHEET_PATH::PathAsString()` (`m_connection_map`,
   * which `CONNECTION_GRAPH` reads as a friend upstream).  Each connection's `LocalSheet()`
   * is the sheet it is keyed by.
   */
  ConnectionMap(): ReadonlyMap<string, SCH_CONNECTION> {
    return this.m_connection_map;
  }

  /** Update the connection graph for all connections in this item. */
  SetConnectionGraph(aGraph: SCH_CONNECTION_GRAPH | null): void {
    for (const conn of this.m_connection_map.values()) {
      conn.SetGraph(aGraph);

      for (const member of conn.AllMembers()) member.SetGraph(aGraph);
    }
  }

  /** The net class of this item's connection on \a aSheet (the current sheet if null). */
  GetEffectiveNetClass(aSheet: SCH_SHEET_PATH | null = null): NETCLASS | null {
    // static std::shared_ptr<NETCLASS> nullNetclass: null here, the callers' "no class".
    const schematic = this.Schematic();

    if (!schematic || !schematic.IsValid()) return null;

    const netSettings = schematic.Project().GetProjectFile().m_NetSettings;

    if (!netSettings) return null;

    const connection = this.Connection(aSheet);

    if (connection) return netSettings.GetEffectiveNetClass(connection.Name());

    return netSettings.GetDefaultNetclass() ?? null;
  }

  /**
   * Create a new connection object associated with this object.
   *
   * @param aPath is the sheet path to initialize.
   */
  InitializeConnection(
    aSheet: SCH_SHEET_PATH,
    aGraph: SCH_CONNECTION_GRAPH | null,
  ): SCH_CONNECTION {
    let connection = this.Connection(aSheet);

    // N.B. Do not clear the dirty connectivity flag here because we may need
    // to create a connection for a different sheet, and we don't want to
    // skip the connection creation because the flag is cleared.
    if (connection) {
      connection.Reset();
    } else {
      if (!SCH_ITEM.s_newConnection) throw new Error('sch_connection.ts is not loaded');

      connection = SCH_ITEM.s_newConnection(this);
      this.m_connection_map.set(aSheet.PathAsString(), connection);
    }

    connection.SetGraph(aGraph);
    connection.SetSheet(aSheet);
    return connection;
  }

  /**
   * Return the existing connection or initialize a new one.
   */
  GetOrInitConnection(
    aSheet: SCH_SHEET_PATH,
    aGraph: SCH_CONNECTION_GRAPH | null,
  ): SCH_CONNECTION | null {
    if (!this.IsConnectable()) return null;

    const connection = this.Connection(aSheet);

    if (connection) return connection;
    else return this.InitializeConnection(aSheet, aGraph);
  }

  /** Retrieve the set of items connected to this item on the given sheet. */
  ConnectedItems(aPath: SCH_SHEET_PATH): SCH_ITEM_VEC {
    const key = aPath.PathAsString();
    let vec = this.m_connected_items.get(key);

    if (!vec) {
      vec = [];
      this.m_connected_items.set(key, vec);
    }

    return vec;
  }

  /** Add a connection link between this item and another. */
  AddConnectionTo(aPath: SCH_SHEET_PATH, aItem: SCH_ITEM): void {
    const vec = this.ConnectedItems(aPath);

    // Add item to the correct place in the sorted vector if it is not already there.
    // Upstream sorts by pointer; creation order (the KIID-independent m_Uuid is not
    // monotonic) stands in, and membership is what callers read.
    if (!vec.includes(aItem)) vec.push(aItem);
  }

  /** Clear all connections to this item. */
  ClearConnectedItems(aPath: SCH_SHEET_PATH): void {
    const vec = this.m_connected_items.get(aPath.PathAsString());

    if (vec) vec.length = 0;
  }

  /** @return true if connections propagate through this item (defaults to true). */
  ConnectionPropagatesTo(_aItem: EDA_ITEM): boolean {
    return true;
  }

  IsConnectivityDirty(): boolean {
    return this.m_connectivity_dirty;
  }

  SetConnectivityDirty(aDirty = true): void {
    this.m_connectivity_dirty = aDirty;
  }

  /**
   * Check if \a aItem has connectivity changes against this object.
   *
   * @warning This is only valid for #SCH_SYMBOL, #SCH_SHEET_PIN, and #SCH_LABEL objects.
   */
  HasConnectivityChanges(_aItem: SCH_ITEM, _aInstance: SCH_SHEET_PATH | null = null): boolean {
    return false;
  }

  HasCachedDriverName(): boolean {
    return false;
  }

  GetCachedDriverName(): string {
    return '';
  }

  SetLastResolvedState(_aItem: SCH_ITEM): void {}

  GetFieldsAutoplaced(): AUTOPLACE_ALGO {
    return this.m_fieldsAutoplaced;
  }

  SetFieldsAutoplaced(aAlgo: AUTOPLACE_ALGO): void {
    this.m_fieldsAutoplaced = aAlgo;
  }

  AutoplaceFields(_aScreen: unknown, _aAlgo: AUTOPLACE_ALGO): void {}

  RunOnChildren(_aFunction: (aItem: SCH_ITEM) => void, _aMode: RECURSE_MODE): void {}

  ClearCaches(): void {
    const clearTextCaches = (aItem: SCH_ITEM): void => {
      const text = aItem as unknown as Partial<EDA_TEXT>;

      if (
        typeof text.ClearBoundingBoxCache === 'function' &&
        typeof text.ClearRenderCache === 'function'
      ) {
        text.ClearBoundingBoxCache();
        text.ClearRenderCache();
      }
    };

    clearTextCaches(this);

    this.RunOnChildren(clearTextCaches, RECURSE_MODE.NO_RECURSE);
  }

  /**
   * Check if this schematic item has line stoke properties.
   *
   * @see #STROKE_PARAMS
   */
  HasLineStroke(): boolean {
    return false;
  }

  GetStroke(): STROKE_PARAMS {
    throw new Error(`GetStroke not implemented in ${this.GetClass()}`); // wxCHECK( false )
  }

  SetStroke(_aStroke: STROKE_PARAMS): void {
    // wxCHECK( false, void )
  }

  ClearRuleAreasCache(): void {
    this.m_rule_areas_cache.clear();
  }
  AddRuleAreaToCache(aRuleArea: SCH_RULE_AREA): void {
    this.m_rule_areas_cache.add(aRuleArea);
  }
  RemoveRuleAreaFromCache(aRuleArea: SCH_RULE_AREA): void {
    this.m_rule_areas_cache.delete(aRuleArea);
  }
  GetRuleAreaCache(): ReadonlySet<SCH_RULE_AREA> {
    return this.m_rule_areas_cache;
  }

  /**
   * The schematic's (else the parent symbol's) embedded font files. `EMBEDDED_FILES`'
   * fontconfig cache (`GetFontFiles` / `UpdateFontFiles`) is not ported - there is no disk
   * here - so there is no list to answer with.
   */
  override GetEmbeddedFonts(): readonly string[] | null {
    return null;
  }

  /**
   * `operator==`: same type and `compare( …, EQUALITY ) == 0`.
   */
  equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    return this.compare(aOther, SCH_ITEM.COMPARE_FLAGS.EQUALITY) === 0;
  }

  /** `operator<`: the ordering the library writer sorts a unit's draw items by. */
  lessThan(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return this.Type() < aOther.Type();

    return this.compare(aOther) < 0;
  }

  /** `SCH_ITEM::cmp_items`. */
  static cmp_items(aFirst: SCH_ITEM, aSecond: SCH_ITEM): boolean {
    return aFirst.compare(aSecond, SCH_ITEM.COMPARE_FLAGS.EQUALITY) < 0;
  }

  /**
   * The list of flags used by the #compare function.
   *
   * UNIT ignores the unit and body style comparison.  EQUALITY is used to compare
   * two items for equality, ERC is used for ERC comparisons (not all properties),
   * SKIP_TST_POS skips the position test.
   */
  static readonly COMPARE_FLAGS = {
    UNIT: 0x01,
    EQUALITY: 0x02,
    ERC: 0x04,
    SKIP_TST_POS: 0x08,
  } as const;

  /** Swap the internal data structures \a aItem with the schematic item. */
  protected swapData(_aItem: SCH_ITEM): void {
    // UNIMPLEMENTED_FOR( GetClass() )
    throw new Error(`swapData not implemented in ${this.GetClass()}`);
  }

  /**
   * Provide the draw object specific comparison called by the == and < operators.
   *
   * The base object sort order which always proceeds the derived object sort order
   * is as follows:
   *      - Symbol unit if applicable (UNIT flag not set)
   *      - Symbol body style if applicable (UNIT flag not set)
   *      - Private (private first)
   *      - Position (SKIP_TST_POS not set)
   *      - Uuid (neither EQUALITY nor ERC set)
   */
  compare(aOther: SCH_ITEM, aCompareFlags = 0): number {
    if (this.Type() !== aOther.Type()) return this.Type() - aOther.Type();

    if (!(aCompareFlags & SCH_ITEM.COMPARE_FLAGS.UNIT) && this.m_unit !== aOther.m_unit)
      return this.m_unit - aOther.m_unit;

    if (!(aCompareFlags & SCH_ITEM.COMPARE_FLAGS.UNIT) && this.m_bodyStyle !== aOther.m_bodyStyle)
      return this.m_bodyStyle - aOther.m_bodyStyle;

    if (this.IsPrivate() !== aOther.IsPrivate()) return this.IsPrivate() ? 1 : -1;

    if (!(aCompareFlags & SCH_ITEM.COMPARE_FLAGS.SKIP_TST_POS)) {
      if (this.GetPosition().x !== aOther.GetPosition().x)
        return this.GetPosition().x - aOther.GetPosition().x;

      if (this.GetPosition().y !== aOther.GetPosition().y)
        return this.GetPosition().y - aOther.GetPosition().y;
    }

    if (
      aCompareFlags & SCH_ITEM.COMPARE_FLAGS.EQUALITY ||
      aCompareFlags & SCH_ITEM.COMPARE_FLAGS.ERC
    ) {
      return 0;
    }

    // KIID::operator< compares the 16 bytes; the canonical lower-case text orders the same.
    if (this.m_Uuid < aOther.m_Uuid) return -1;

    if (this.m_Uuid > aOther.m_Uuid) return 1;

    return 0;
  }

  protected doIsConnected(_aPosition: VECTOR2I): boolean {
    return false;
  }
}

/** Helper for the typed flag argument some callers pass. */
export type { EDA_ITEM_FLAGS };
