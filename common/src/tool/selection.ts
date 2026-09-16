// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SELECTION` (include/tool/selection.h, common/tool/selection.cpp): the
 * items a selection tool holds, as a VIEW_GROUP the overlay draws.
 *
 * The C++ keeps `m_items` sorted by pointer so that `Add`, `Remove` and
 * `Contains` can bisect; the order that gives the list is the allocator's.
 * Here the list is in insertion order and a Set answers membership — the
 * ordered views (`GetItemsSortedBySelectionOrder`, `…ByTypeAndXY`) are the
 * ones the C++ callers rely on.
 */
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { EDA_ITEM } from '../eda_item.js';
import { VIEW_GROUP } from '../view/view_group.js';
import type { VIEW_ITEM } from '../view/view_item.js';

export class SELECTION extends VIEW_GROUP {
  protected m_referencePoint: VECTOR2I | undefined;
  protected m_items: EDA_ITEM[] = [];
  protected m_itemsOrders: number[] = [];
  protected m_orderCounter = 0;
  protected m_lastAddedItem: EDA_ITEM | null = null;
  protected m_isHover = false;
  private readonly m_itemSet = new Set<EDA_ITEM>();

  constructor();
  constructor(aOther: SELECTION);
  constructor(aOther?: SELECTION) {
    super();

    if (aOther) this.assign(aOther);
  }

  /** `operator=( const SELECTION& )`. */
  assign(aOther: SELECTION): this {
    this.m_items = [...aOther.m_items];
    this.m_itemsOrders = [...aOther.m_itemsOrders];
    this.m_isHover = aOther.m_isHover;
    this.m_lastAddedItem = aOther.m_lastAddedItem;
    this.m_orderCounter = aOther.m_orderCounter;
    this.m_itemSet.clear();
    for (const item of this.m_items) this.m_itemSet.add(item);
    return this;
  }

  override GetClass(): string {
    return 'SELECTION';
  }

  equals(aOther: SELECTION): boolean {
    return (
      this.m_items.length === aOther.m_items.length &&
      this.m_items.every((item, i) => item === aOther.m_items[i]) &&
      this.m_itemsOrders.every((order, i) => order === aOther.m_itemsOrders[i]) &&
      this.m_isHover === aOther.m_isHover &&
      this.m_lastAddedItem === aOther.m_lastAddedItem &&
      this.m_orderCounter === aOther.m_orderCounter
    );
  }

  [Symbol.iterator](): IterableIterator<EDA_ITEM> {
    return this.m_items[Symbol.iterator]();
  }

  SetIsHover(aIsHover: boolean): void {
    this.m_isHover = aIsHover;
  }

  IsHover(): boolean {
    return this.m_isHover;
  }

  override Add(aItem: EDA_ITEM | null): void {
    if (!aItem) return;

    if (!this.m_itemSet.has(aItem)) {
      this.m_itemSet.add(aItem);
      this.m_itemsOrders.push(this.m_orderCounter);
      this.m_items.push(aItem);
      this.m_orderCounter++;
      this.m_lastAddedItem = aItem;
    }
  }

  override Remove(aItem: EDA_ITEM): void {
    if (this.m_itemSet.has(aItem)) {
      const i = this.m_items.indexOf(aItem);
      this.m_itemsOrders.splice(i, 1);
      this.m_items.splice(i, 1);
      this.m_itemSet.delete(aItem);

      if (aItem === this.m_lastAddedItem) this.m_lastAddedItem = null;
    }
  }

  override Clear(): void {
    this.m_items = [];
    this.m_itemsOrders = [];
    this.m_itemSet.clear();
    this.m_orderCounter = 0;
  }

  override GetSize(): number {
    return this.m_items.length;
  }

  override GetItem(aIdx: number): VIEW_ITEM | null {
    if (aIdx < this.m_items.length) return this.m_items[aIdx]!;

    return null;
  }

  Contains(aItem: EDA_ITEM): boolean {
    return this.m_itemSet.has(aItem);
  }

  /// Checks if there is anything selected
  Empty(): boolean {
    return this.m_items.length === 0;
  }

  /// Returns the number of selected parts
  Size(): number {
    return this.m_items.length;
  }

  GetItems(): EDA_ITEM[] {
    return [...this.m_items];
  }

  GetLastAddedItem(): EDA_ITEM | null {
    return this.m_lastAddedItem;
  }

  GetItemsSortedByTypeAndXY(leftBeforeRight = true, topBeforeBottom = true): EDA_ITEM[] {
    const sorted_items = [...this.m_items];

    sorted_items.sort((a, b) => {
      const less = (): boolean => {
        if (a.Type() === b.Type()) {
          const aPos = a.GetSortPosition();
          const bPos = b.GetSortPosition();

          if (aPos.x === bPos.x) {
            // Ensure deterministic sort
            if (aPos.y === bPos.y) return a.m_Uuid < b.m_Uuid;

            if (topBeforeBottom) return aPos.y < bPos.y;
            else return aPos.y > bPos.y;
          } else if (leftBeforeRight) {
            return aPos.x < bPos.x;
          } else {
            return aPos.x > bPos.x;
          }
        } else {
          return a.Type() < b.Type();
        }
      };
      return less() ? -1 : 1;
    });

    return sorted_items;
  }

  GetItemsSortedBySelectionOrder(): EDA_ITEM[] {
    // Create a vector of all {selection item, selection order} pairs
    const pairs = this.m_items.map((item, i) => ({ item, order: this.m_itemsOrders[i]! }));

    // Sort the pairs by the selection order
    pairs.sort((a, b) => a.order - b.order);

    // Make a vector of just the sortedItems
    return pairs.map((p) => p.item);
  }

  /// Returns the center point of the selection area bounding box.
  GetCenter(): VECTOR2I {
    const textTypes: readonly KICAD_T[] = [KICAD_T.SCH_TEXT_T, KICAD_T.SCH_LABEL_LOCATE_ANY_T];
    let hasOnlyText = true;

    // If the selection contains only texts calculate the center as the mean of all positions
    // instead of using the center of the total bounding box. Otherwise rotating the selection will
    // also translate it.

    for (const item of this.m_items) {
      if (!item.IsType(textTypes)) {
        hasOnlyText = false;
        break;
      }
    }

    const bbox = new BOX2I();

    if (hasOnlyText) {
      const center = { x: 0, y: 0 };

      for (const item of this.m_items) {
        center.x += item.GetPosition().x;
        center.y += item.GetPosition().y;
      }

      // center / static_cast<int>( m_items.size() ): int division
      return {
        x: Math.trunc(center.x / this.m_items.length),
        y: Math.trunc(center.y / this.m_items.length),
      };
    }

    for (const item of this.m_items) {
      if (!item.IsType([KICAD_T.SCH_TEXT_T, KICAD_T.SCH_LABEL_LOCATE_ANY_T]))
        bbox.Merge(item.GetBoundingBox());
    }

    return bbox.GetCenter();
  }

  override ViewBBox(): BOX2I {
    const r = new BOX2I();
    r.SetMaximum();
    return r;
  }

  /// Returns the top left point of the selection area bounding box.
  GetPosition(): VECTOR2I {
    return this.GetBoundingBox().GetPosition();
  }

  GetBoundingBox(): BOX2I {
    const bbox = new BOX2I();

    for (const item of this.m_items) bbox.Merge(item.GetBoundingBox());

    return bbox;
  }

  GetTopLeftItem(_onlyModules = false): EDA_ITEM | null {
    return null;
  }

  /** `operator[]( aIdx )`. */
  at(aIdx: number): EDA_ITEM | null {
    if (aIdx < this.m_items.length) return this.m_items[aIdx]!;

    return null;
  }

  Front(): EDA_ITEM | null {
    return this.m_items.length ? this.m_items[0]! : null;
  }

  Items(): EDA_ITEM[] {
    return this.m_items;
  }

  /** `FirstOfKind<T>()`: the first item the predicate (the class's `ClassOf`) accepts. */
  FirstOfKind<T extends EDA_ITEM>(aIsA: (aItem: EDA_ITEM) => aItem is T): T | null {
    for (const item of this.m_items) {
      if (aIsA(item)) return item;
    }

    return null;
  }

  /**
   * Checks if there is at least one item of requested kind.
   *
   * @param aType is the type to check for.
   * @return True if there is at least one item of such kind.
   */
  HasType(aType: KICAD_T): boolean {
    for (const item of this.m_items) {
      if (item.IsType([aType])) return true;
    }

    return false;
  }

  CountType(aType: KICAD_T): number {
    let count = 0;

    for (const item of this.m_items) {
      if (item.IsType([aType])) count++;
    }

    return count;
  }

  protected override updateDrawList(): VIEW_ITEM[] {
    const items: VIEW_ITEM[] = [];

    for (const item of this.m_items) items.push(item);

    return items;
  }

  HasReferencePoint(): boolean {
    return this.m_referencePoint !== undefined;
  }

  GetReferencePoint(): VECTOR2I {
    if (this.m_referencePoint) return this.m_referencePoint;
    else return this.GetBoundingBox().Centre();
  }

  SetReferencePoint(aP: VECTOR2I): void {
    this.m_referencePoint = { x: aP.x, y: aP.y };
  }

  ClearReferencePoint(): void {
    this.m_referencePoint = undefined;
  }

  /**
   * Checks if all items in the selection are the same type.
   *
   * @return True if all items are the same type
   */
  AreAllItemsIdentical(): boolean {
    return this.m_items.slice(1).every((r) => r.Type() === this.m_items[0]!.Type());
  }

  /**
   * Checks if all items in the selection have a type in aList
   *
   * @return False if any item in the selection has a type not included in aList
   */
  OnlyContains(aList: readonly KICAD_T[]): boolean {
    return this.m_items.every((r) => r.IsType(aList));
  }
}
