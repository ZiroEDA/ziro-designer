// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sync_sheet_pin/sheet_synchronization_model.h` / `.cpp`: one of the three lists of a
 * Synchronize Sheet Pins page (unmatched labels, unmatched pins, matched pairs), a
 * wxDataViewVirtualListModel of rows. The row the user last clicked shows bold.
 */
import {
  type wxDataViewItem,
  type wxDataViewItemArray,
  type wxDataViewItemAttr,
  type wxDataViewModelNotifier,
  wxDataViewVirtualListModel,
} from '@ziroeda/common/wx/dataview.js';
import { getElectricalTypeLabel, type LABEL_FLAG_SHAPE } from '../sch_label.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SHEET_SYNCHRONIZATION_AGENT } from './sheet_synchronization_agent.js';
import type { SHEET_SYNCHRONIZATION_ITEM } from './sheet_synchronization_item.js';
import type { SHEET_SYNCHRONIZATION_NOTIFIER } from './sheet_synchronization_notifier.js';

export type SHEET_SYNCHRONIZATION_ITE_PTR = SHEET_SYNCHRONIZATION_ITEM;
export type SHEET_SYNCHRONIZATION_ITEM_LIST = SHEET_SYNCHRONIZATION_ITEM[];

/** `wxDataViewIconText`: a NAME cell. */
export interface SHEET_SYNCHRONIZATION_ICON_TEXT {
  text: string;
  bitmap: readonly string[];
}

export class SHEET_SYNCHRONIZATION_MODEL extends wxDataViewVirtualListModel {
  /** `SHEET_SYNCHRONIZATION_COL`. */
  static readonly NAME = 0;
  static readonly SHAPE = 1;
  static readonly COL_COUNT = 2;

  static readonly HIRE_LABEL = 0;
  static readonly SHEET_PIN = 1;
  static readonly ASSOCIATED = 2;
  static readonly MODEL_COUNT = 3;

  static GetColName(aCol: number): string {
    switch (aCol) {
      case SHEET_SYNCHRONIZATION_MODEL.NAME:
        return 'Name';
      case SHEET_SYNCHRONIZATION_MODEL.SHAPE:
        return 'Shape';
      default:
        return '';
    }
  }

  private m_items: SHEET_SYNCHRONIZATION_ITEM_LIST = [];
  private m_selectedIndex: number | null = null;
  private readonly m_notifiers: SHEET_SYNCHRONIZATION_NOTIFIER[] = [];
  private readonly m_agent: SHEET_SYNCHRONIZATION_AGENT;
  private readonly m_sheet: SCH_SHEET;
  private readonly m_path: SCH_SHEET_PATH;

  constructor(aAgent: SHEET_SYNCHRONIZATION_AGENT, aSheet: SCH_SHEET, aPath: SCH_SHEET_PATH) {
    super();
    this.m_agent = aAgent;
    this.m_sheet = aSheet;
    this.m_path = aPath;
  }

  GetValueByRow(aRow: number, aCol: number): SHEET_SYNCHRONIZATION_ICON_TEXT | string | null {
    const item = this.m_items[aRow]!;

    switch (aCol) {
      case SHEET_SYNCHRONIZATION_MODEL.NAME:
        return { text: item.GetName(), bitmap: item.GetBitmap() };
      case SHEET_SYNCHRONIZATION_MODEL.SHAPE:
        return getElectricalTypeLabel(item.GetShape() as LABEL_FLAG_SHAPE);
      default:
        return null;
    }
  }

  SetValueByRow(_aValue: unknown, _aRow: number, _aCol: number): boolean {
    return false;
  }

  override GetAttrByRow(aRow: number, _aCol: number, aAttr: wxDataViewItemAttr): boolean {
    if (this.m_selectedIndex !== null && aRow === this.m_selectedIndex) {
      aAttr.SetBold(true);
      return true;
    }

    return false;
  }

  RemoveItems(aItems: wxDataViewItemArray): void {
    if (aItems.length === 0) return;

    for (const item of this.TakeItems(aItems))
      this.m_agent.RemoveItem(item, this.m_sheet, this.m_path);

    this.DoNotify();
  }

  AppendNewItem(aItem: SHEET_SYNCHRONIZATION_ITEM): boolean {
    this.m_items.push(aItem);
    this.Reset(this.GetCount());
    this.DoNotify();
    return true;
  }

  AppendItem(aItem: SHEET_SYNCHRONIZATION_ITEM): boolean {
    this.m_items.push(aItem);
    this.Reset(this.GetCount());
    return true;
  }

  TakeItems(aItems: wxDataViewItemArray): SHEET_SYNCHRONIZATION_ITEM_LIST {
    if (aItems.length === 1) {
      const item = this.TakeItem(aItems[0]!);
      return item ? [item] : [];
    }

    const rowsToBeRemove = new Set<number>();
    const items_remain: SHEET_SYNCHRONIZATION_ITEM_LIST = [];
    const items_token: SHEET_SYNCHRONIZATION_ITEM_LIST = [];

    for (const item of aItems) {
      if (item.IsOk()) rowsToBeRemove.add(this.GetRow(item));
    }

    for (let i = 0; i < this.m_items.length; i++) {
      if (!rowsToBeRemove.has(i)) items_remain.push(this.m_items[i]!);
      else items_token.push(this.m_items[i]!);
    }

    this.UpdateItems(items_remain);
    this.OnRowSelected(null);
    return items_token;
  }

  TakeItem(aItem: wxDataViewItem): SHEET_SYNCHRONIZATION_ITE_PTR | null {
    const row = this.GetRow(aItem);

    if (row < 0 || row + 1 > this.m_items.length) return null;

    const item = this.m_items[row]!;
    this.m_items.splice(row, 1);
    this.OnRowSelected(null);
    this.Reset(this.GetCount());
    return item;
  }

  /** `GetSynchronizationItem( unsigned )` and `GetSynchronizationItem( wxDataViewItem const& )`. */
  GetSynchronizationItem(aIndex: number | wxDataViewItem): SHEET_SYNCHRONIZATION_ITE_PTR | null {
    const index = typeof aIndex === 'number' ? aIndex : this.GetRow(aIndex);

    if (index >= 0 && index < this.m_items.length) return this.m_items[index]!;

    return null;
  }

  OnRowSelected(aRow: number | null): void {
    this.m_selectedIndex = aRow;

    if (aRow !== null && this.m_items.length > aRow) {
      const item = this.GetItem(aRow);

      if (item.IsOk()) this.ItemChanged(item);
    }
  }

  UpdateItems(aItems: SHEET_SYNCHRONIZATION_ITEM_LIST): void {
    this.m_items = aItems;
    this.Reset(this.GetCount());
  }

  /**
   * `AddNotifier( std::shared_ptr<SHEET_SYNCHRONIZATION_NOTIFIER> )`, beside wxDataViewModel's
   * `AddNotifier( wxDataViewModelNotifier* )` a control registers through - C++ tells the two
   * apart by type.
   */
  override AddNotifier(aNotifier: SHEET_SYNCHRONIZATION_NOTIFIER | wxDataViewModelNotifier): void {
    if ('Notify' in aNotifier) this.m_notifiers.push(aNotifier);
    else super.AddNotifier(aNotifier);
  }

  DoNotify(): void {
    for (const notifier of this.m_notifiers) notifier.Notify();
  }

  HasSelectedIndex(): boolean {
    return this.m_selectedIndex !== null;
  }

  GetSelectedIndex(): number | null {
    return this.m_selectedIndex;
  }

  override GetCount(): number {
    return this.m_items.length;
  }
}
