// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets, copyright the wxWidgets team (wxWindows Library Licence).
/**
 * `wx/dataview.h`'s list-model half: `wxDataViewItem`, the opaque row handle, and
 * `wxDataViewVirtualListModel` (src/common/datavcmn.cpp), whose rows are items numbered from 1 -
 * `GetItem( row )` is `wxUIntToPtr( row + 1 )`, `GetRow( item )` the reverse - so the model holds
 * no per-row objects. A control listens through `AddNotifier`, as wxDataViewModelNotifier does.
 */

/** An opaque row handle; the invalid one (`IsOk()` false) has no id. */
export class wxDataViewItem {
  private readonly m_id: number | null;

  constructor(aId: number | null = null) {
    this.m_id = aId;
  }

  IsOk(): boolean {
    return this.m_id !== null;
  }

  GetID(): number | null {
    return this.m_id;
  }
}

/** `wxDataViewItemArray`. */
export type wxDataViewItemArray = wxDataViewItem[];

/** `wxDataViewItemAttr`: what GetAttrByRow may set on a row. */
export class wxDataViewItemAttr {
  private m_bold = false;

  SetBold(aSet: boolean): void {
    this.m_bold = aSet;
  }

  GetBold(): boolean {
    return this.m_bold;
  }
}

/** `wxDataViewModelNotifier`, the part a list control uses. */
export interface wxDataViewModelNotifier {
  /** `Cleared()`: everything changed. */
  Cleared(): void;
  /** `ItemChanged( item )`. */
  ItemChanged(aItem: wxDataViewItem): void;
}

export abstract class wxDataViewVirtualListModel {
  private m_size: number;
  private readonly m_dataViewNotifiers: wxDataViewModelNotifier[] = [];

  constructor(aInitialSize = 0) {
    this.m_size = aInitialSize;
  }

  /** `GetValueByRow( variant, row, col )`: the cell's value. */
  abstract GetValueByRow(aRow: number, aCol: number): unknown;

  /** `GetAttrByRow( row, col, attr )`: true when \a aAttr was set. */
  GetAttrByRow(_aRow: number, _aCol: number, _aAttr: wxDataViewItemAttr): boolean {
    return false;
  }

  AddNotifier(aNotifier: wxDataViewModelNotifier): void {
    this.m_dataViewNotifiers.push(aNotifier);
  }

  RemoveNotifier(aNotifier: wxDataViewModelNotifier): void {
    const i = this.m_dataViewNotifiers.indexOf(aNotifier);

    if (i >= 0) this.m_dataViewNotifiers.splice(i, 1);
  }

  Reset(aNewSize: number): void {
    this.m_size = aNewSize;

    for (const n of this.m_dataViewNotifiers) n.Cleared();
  }

  ItemChanged(aItem: wxDataViewItem): boolean {
    for (const n of this.m_dataViewNotifiers) n.ItemChanged(aItem);

    return true;
  }

  RowChanged(aRow: number): void {
    this.ItemChanged(this.GetItem(aRow));
  }

  GetRow(aItem: wxDataViewItem): number {
    return (aItem.GetID() ?? 0) - 1;
  }

  GetItem(aRow: number): wxDataViewItem {
    return new wxDataViewItem(aRow + 1);
  }

  GetCount(): number {
    return this.m_size;
  }
}

/**
 * `wxDataViewCtrl`, as far as a dialog's logic reads it: the associated model and the rows the
 * user has selected. The rendering is the form's.
 */
export class wxDataViewCtrl {
  private m_model: wxDataViewVirtualListModel | null = null;
  private m_selections: wxDataViewItemArray = [];

  AssociateModel(aModel: wxDataViewVirtualListModel): boolean {
    this.m_model = aModel;
    return true;
  }

  GetModel(): wxDataViewVirtualListModel | null {
    return this.m_model;
  }

  GetSelections(): wxDataViewItemArray {
    return this.m_selections.filter((i) => i.IsOk());
  }

  /** The single selection; the invalid item when none, or more than one, is selected. */
  GetSelection(): wxDataViewItem {
    const sel = this.GetSelections();
    return sel.length === 1 ? sel[0]! : new wxDataViewItem();
  }

  GetSelectedItemsCount(): number {
    return this.GetSelections().length;
  }

  SetSelections(aSel: wxDataViewItemArray): void {
    this.m_selections = aSel.slice();
  }

  UnselectAll(): void {
    this.m_selections = [];
  }
}
