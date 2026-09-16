// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/collector.h`: an abstract class that will find and hold all the
 * objects according to an inspection done by the Inspect() function which
 * must be implemented by any derived class.
 */
import type { EDA_ITEM, INSPECTOR_FUNC } from './eda_item.js';
import { INSPECT_RESULT } from './eda_item.js';
import type { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

export class COLLECTOR {
  m_Threshold = 0; // Hit-test threshold in internal units.

  m_MenuTitle = ''; // The title of selection disambiguation menu (if needed)
  m_MenuCancelled = false; // Indicates selection disambiguation menu was canceled

  protected m_list: EDA_ITEM[] = []; // Primary list of most likely items
  protected m_backupList: EDA_ITEM[] = []; // Secondary list with items removed by heuristics

  protected m_scanTypes: KICAD_T[] = [];
  protected m_inspector: INSPECTOR_FUNC;

  protected m_refPos: VECTOR2I = { x: 0, y: 0 }; // Reference pos used to generate the collection.

  constructor() {
    // Inspect() is virtual so calling it from a class common inspector preserves
    // polymorphism.
    this.m_inspector = (aItem: EDA_ITEM, aTestData: unknown) => this.Inspect(aItem, aTestData);
  }

  Inspect(_aTestItem: EDA_ITEM, _aTestData: unknown): INSPECT_RESULT {
    return INSPECT_RESULT.QUIT;
  }

  [Symbol.iterator](): IterableIterator<EDA_ITEM> {
    return this.m_list[Symbol.iterator]();
  }

  /**
   * Return the number of objects in the list.
   */
  GetCount(): number {
    return this.m_list.length;
  }

  /**
   * Clear the list.
   */
  Empty(): void {
    this.m_list.length = 0;
  }

  /**
   * Add an item to the end of the list.
   *
   * @param item An EDA_ITEM* to add.
   */
  Append(item: EDA_ITEM): void {
    this.m_list.push(item);
  }

  /**
   * Remove the item at \a aIndex (first position is 0), or the item aItem (if exists in
   * the collector).
   */
  Remove(a: number | EDA_ITEM): void {
    if (typeof a === 'number') this.m_list.splice(a, 1);
    else this.m_list = this.m_list.filter((aCandidate) => aCandidate !== a);
  }

  /**
   * Test if the collector has heuristic backup items.
   *
   * @return true if Combine() can run to bring secondary items into the list.
   */
  HasAdditionalItems(): boolean {
    return this.m_backupList.length !== 0;
  }

  /**
   * Re-combine the backup list into the main list of the collector.
   */
  Combine(): void {
    this.m_list.push(...this.m_backupList);
    this.m_backupList.length = 0;
  }

  /**
   * Move the item at \a aIndex (first position is 0), or \a aItem (if exists in the
   * collector), to the backup list.
   */
  Transfer(a: number | EDA_ITEM): void {
    if (typeof a === 'number') {
      this.m_backupList.push(this.m_list[a]!);
      this.m_list.splice(a, 1);
      return;
    }

    for (let i = 0; i < this.m_list.length; i++) {
      if (this.m_list[i] === a) {
        this.m_list.splice(i, 1);
        this.m_backupList.push(a);
        return;
      }
    }
  }

  /**
   * Used for read only access and returns the object at \a aIndex.
   *
   * @param aIndex The index into the list.
   * @return the object at \a aIndex something derived from it or NULL.
   */
  at(aIndex: number): EDA_ITEM | null {
    if (aIndex >= 0 && aIndex < this.GetCount()) return this.m_list[aIndex]!;

    return null;
  }

  /**
   * Tests if \a aItem has already been collected.
   *
   * @param aItem The EDA_ITEM* to be tested.
   * @return True if \a aItem is already collected.
   */
  HasItem(aItem: EDA_ITEM): boolean {
    for (let i = 0; i < this.m_list.length; i++) {
      if (this.m_list[i] === aItem) return true;
    }

    return false;
  }

  /**
   * Record the list of #KICAD_T types to consider for collection by the Inspect() function.
   *
   * @param aScanTypes A list of KICAD_Ts.
   */
  SetScanTypes(aTypes: readonly KICAD_T[]): void {
    this.m_scanTypes = [...aTypes];
  }

  GetScanTypes(): readonly KICAD_T[] {
    return this.m_scanTypes;
  }

  SetRefPos(aRefPos: VECTOR2I): void {
    this.m_refPos = aRefPos;
  }

  /**
   * Count the number of items matching \a aType.
   *
   * @param aType type we are interested in.
   * @return number of occurrences.
   */
  CountType(aType: KICAD_T): number {
    let cnt = 0;

    for (let i = 0; i < this.m_list.length; i++) {
      if (this.m_list[i]!.Type() === aType) cnt++;
    }

    return cnt;
  }
}
