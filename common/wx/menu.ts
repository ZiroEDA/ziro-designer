// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxMenu` / `wxMenuItem` (`wx/menu.h`, `wx/menuitem.h`) as KiCad's
 * ACTION_MENU builds on them: an ordered list of items - normal, check,
 * separator or submenu - with ids, labels, help strings, check and enable
 * state. The page draws a menu through `ContextMenu`
 * (`common/tool/action_menu_bar.tsx`); this is its model.
 */

import type { BITMAPS } from '../bitmaps_list.js';

/** `wxItemKind`. */
export enum wxItemKind {
  wxITEM_SEPARATOR = -1,
  wxITEM_NORMAL,
  wxITEM_CHECK,
  wxITEM_RADIO,
  wxITEM_DROPDOWN,
}

/** `wxID_NONE` / `wxID_ANY` / `wxID_SEPARATOR`. */
export const wxID_NONE = -3;
export const wxID_ANY = -1;
export const wxID_SEPARATOR = -2;

let s_autoId = -1000;

export class wxMenuItem {
  private m_parentMenu: wxMenu | null;
  private m_id: number;
  private m_text: string;
  private m_help: string;
  private m_kind: wxItemKind;
  private m_subMenu: wxMenu | null;
  private m_isChecked = false;
  private m_isEnabled = true;
  /** The bitmap `KIUI::AddBitmapToMenuItem` gives it. */
  private m_bitmap: BITMAPS | null = null;
  /** `SetAccel( &accel )`: the accelerator as GTK labels it. */
  private m_accel = '';

  constructor(
    aParentMenu: wxMenu | null = null,
    aId: number = wxID_SEPARATOR,
    aText = '',
    aHelp = '',
    aKind: wxItemKind = wxItemKind.wxITEM_NORMAL,
    aSubMenu: wxMenu | null = null,
  ) {
    this.m_parentMenu = aParentMenu;
    // wxID_ANY asks wx for a fresh id, as NewControlId does.
    this.m_id = aId === wxID_ANY ? s_autoId-- : aId;
    this.m_text = aText;
    this.m_help = aHelp;
    this.m_kind = aId === wxID_SEPARATOR ? wxItemKind.wxITEM_SEPARATOR : aKind;
    this.m_subMenu = aSubMenu;
  }

  GetMenu(): wxMenu | null {
    return this.m_parentMenu;
  }

  SetMenu(aMenu: wxMenu | null): void {
    this.m_parentMenu = aMenu;
  }

  GetId(): number {
    return this.m_id;
  }

  GetKind(): wxItemKind {
    return this.m_kind;
  }

  IsSeparator(): boolean {
    return this.m_kind === wxItemKind.wxITEM_SEPARATOR;
  }

  IsCheckable(): boolean {
    return this.m_kind === wxItemKind.wxITEM_CHECK || this.m_kind === wxItemKind.wxITEM_RADIO;
  }

  IsSubMenu(): boolean {
    return this.m_subMenu !== null;
  }

  GetSubMenu(): wxMenu | null {
    return this.m_subMenu;
  }

  SetSubMenu(aMenu: wxMenu): void {
    this.m_subMenu = aMenu;
  }

  /** `GetItemLabel()`: the label with its mnemonic `&` and `\t` accelerator. */
  GetItemLabel(): string {
    return this.m_text;
  }

  /** `GetItemLabelText()`: the label without `&` and without the accelerator. */
  GetItemLabelText(): string {
    return wxMenuItem.GetLabelText(this.m_text);
  }

  SetItemLabel(aText: string): void {
    this.m_text = aText;
  }

  GetHelp(): string {
    return this.m_help;
  }

  SetHelp(aHelp: string): void {
    this.m_help = aHelp;
  }

  Check(aCheck = true): void {
    if (this.IsCheckable()) this.m_isChecked = aCheck;
  }

  IsChecked(): boolean {
    return this.m_isChecked;
  }

  Enable(aEnable = true): void {
    this.m_isEnabled = aEnable;
  }

  IsEnabled(): boolean {
    return this.m_isEnabled;
  }

  SetBitmap(aBitmap: BITMAPS | null): void {
    this.m_bitmap = aBitmap;
  }

  GetBitmap(): BITMAPS | null {
    return this.m_bitmap;
  }

  /** `wxMenuItem::GetLabelText( text )`: strip mnemonics and the accelerator. */
  static GetLabelText(aText: string): string {
    const tab = aText.indexOf('\t');
    const label = tab === -1 ? aText : aText.slice(0, tab);

    return label.replace(/&(.)/g, '$1');
  }

  /**
   * The accelerator the item shows: one set with SetAccel, else the part of
   * the label after the `\t`, as wx parses it.
   */
  GetAccelString(): string {
    if (this.m_accel !== '') return this.m_accel;

    const tab = this.m_text.indexOf('\t');

    return tab === -1 ? '' : this.m_text.slice(tab + 1);
  }

  /** `SetAccel( wxAcceleratorEntry* )`, as the entry's display text. */
  SetAccel(aAccel: string): void {
    this.m_accel = aAccel;
  }
}

export class wxMenu {
  protected m_items: wxMenuItem[] = [];
  private m_menuParent: wxMenu | null = null;

  GetParent(): wxMenu | null {
    return this.m_menuParent;
  }

  SetParent(aParent: wxMenu | null): void {
    this.m_menuParent = aParent;
  }

  GetMenuItemCount(): number {
    return this.m_items.length;
  }

  GetMenuItems(): readonly wxMenuItem[] {
    return this.m_items;
  }

  FindItemByPosition(aPos: number): wxMenuItem {
    return this.m_items[aPos]!;
  }

  /** `FindItem( id )`: this menu and its submenus. */
  FindItem(aId: number): wxMenuItem | null {
    for (const item of this.m_items) {
      if (item.GetId() === aId) return item;

      const sub = item.GetSubMenu();

      if (sub) {
        const found = sub.FindItem(aId);

        if (found) return found;
      }
    }

    return null;
  }

  /** `FindChildItem( id )`: this menu only. */
  FindChildItem(aId: number): wxMenuItem | null {
    return this.m_items.find((i) => i.GetId() === aId) ?? null;
  }

  /** `Append( item )`, or `Append( id, text, help, kind )`. */
  Append(aItem: wxMenuItem): wxMenuItem;
  Append(aId: number, aText: string, aHelp?: string, aKind?: wxItemKind): wxMenuItem;
  Append(
    a: wxMenuItem | number,
    aText = '',
    aHelp = '',
    aKind = wxItemKind.wxITEM_NORMAL,
  ): wxMenuItem {
    const aItem = typeof a === 'number' ? new wxMenuItem(this, a, aText, aHelp, aKind) : a;

    aItem.SetMenu(this);
    this.m_items.push(aItem);

    const sub = aItem.GetSubMenu();

    if (sub) sub.SetParent(this);

    return aItem;
  }

  AppendSeparator(): wxMenuItem {
    return this.Append(new wxMenuItem(this, wxID_SEPARATOR));
  }

  AppendSubMenu(aSubMenu: wxMenu, aText: string, aHelp = ''): wxMenuItem {
    return this.Append(
      new wxMenuItem(this, wxID_ANY, aText, aHelp, wxItemKind.wxITEM_NORMAL, aSubMenu),
    );
  }

  Insert(aPos: number, aItem: wxMenuItem): wxMenuItem {
    aItem.SetMenu(this);
    this.m_items.splice(aPos, 0, aItem);

    return aItem;
  }

  InsertSeparator(aPos: number): wxMenuItem {
    return this.Insert(aPos, new wxMenuItem(this, wxID_SEPARATOR));
  }

  /** `Destroy( item )`: remove and delete the item. */
  Destroy(aItem: wxMenuItem): void {
    const i = this.m_items.indexOf(aItem);

    if (i !== -1) this.m_items.splice(i, 1);
  }

  /** `Delete( item )`: remove the item (a submenu is detached, not deleted). */
  Delete(aItem: wxMenuItem): void {
    this.Destroy(aItem);
  }

  /** `Check( id, check )`. */
  Check(aId: number, aCheck: boolean): void {
    this.FindItem(aId)?.Check(aCheck);
  }

  GetLabelText(aId: number): string {
    return this.FindItem(aId)?.GetItemLabelText() ?? '';
  }

  GetHelpString(aId: number): string {
    return this.FindItem(aId)?.GetHelp() ?? '';
  }
}

/** The menu event types ACTION_MENU handles. */
export enum wxMenuEventType {
  wxEVT_MENU_OPEN,
  wxEVT_MENU_CLOSE,
  wxEVT_MENU_HIGHLIGHT,
  wxEVT_COMMAND_MENU_SELECTED,
}

/** `wxMenuEvent`: the type, the item id and the menu it came from. */
export class wxMenuEvent {
  constructor(
    private readonly m_type: wxMenuEventType,
    private readonly m_id = 0,
    private readonly m_menu: wxMenu | null = null,
  ) {}

  GetEventType(): wxMenuEventType {
    return this.m_type;
  }

  GetId(): number {
    return this.m_id;
  }

  GetMenu(): wxMenu | null {
    return this.m_menu;
  }
}
