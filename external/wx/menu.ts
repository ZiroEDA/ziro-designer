// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxMenu` / `wxMenuItem` (`wx/menu.h`, `wx/menuitem.h`) as KiCad's
 * ACTION_MENU builds on them: an ordered list of items - normal, check,
 * separator or submenu - with ids, labels, help strings, check and enable
 * state. The page draws a menu through `ContextMenu`
 * (`menu_ui.tsx`); this is its model.
 */

/**
 * `wxBitmapBundle`: what a menu item shows. wx only holds it; KiCad builds it with
 * `KiBitmapBundle( BITMAPS::… )`, so here it is the caller's bitmap id, passed back unchanged.
 */
export type wxBitmapBundle = number;

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
/** `wxID_OK` / `wxID_CANCEL` (wx/defs.h): what a dialog's ShowModal returns. */
export const wxID_OK = 5100;
/** `wxID_HIGHEST` (wx/defs.h): every predefined id is below it. */
export const wxID_HIGHEST = 5999;
export const wxID_CANCEL = 5101;
/** `wxID_YES` / `wxID_NO` (wx/defs.h): a wxYES_NO message box's answers. */
export const wxID_YES = 5103;
export const wxID_NO = 5104;

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
  private m_bitmap: wxBitmapBundle | null = null;
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

  IsRadio(): boolean {
    return this.m_kind === wxItemKind.wxITEM_RADIO;
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

  /**
   * `Check( check )`. A radio item takes its group with it: checking one unchecks the rest of the
   * run of radio items it sits in, as a GTK radio group does (unchecking one alone is refused).
   */
  Check(aCheck = true): void {
    if (!this.IsCheckable()) return;

    if (this.m_kind !== wxItemKind.wxITEM_RADIO) {
      this.m_isChecked = aCheck;
      return;
    }

    if (!aCheck) return;

    const items = this.m_parentMenu?.GetMenuItems() ?? [this];
    const at = items.indexOf(this);
    let first = at;
    let last = at;

    while (first > 0 && items[first - 1]!.m_kind === wxItemKind.wxITEM_RADIO) first--;
    while (last < items.length - 1 && items[last + 1]!.m_kind === wxItemKind.wxITEM_RADIO) last++;

    for (let i = first; i <= last; i++) items[i]!.m_isChecked = i === at;
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

  SetBitmap(aBitmap: wxBitmapBundle | null): void {
    this.m_bitmap = aBitmap;
  }

  GetBitmap(): wxBitmapBundle | null {
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

  /** `AppendCheckItem( id, text, help )`. */
  AppendCheckItem(aId: number, aText: string, aHelp = ''): wxMenuItem {
    return this.Append(aId, aText, aHelp, wxItemKind.wxITEM_CHECK);
  }

  /**
   * `AppendRadioItem( id, text, help )`. The first item of a radio run starts checked, as wx
   * starts a new group checked.
   */
  AppendRadioItem(aId: number, aText: string, aHelp = ''): wxMenuItem {
    const previous = this.m_items.at(-1);
    const item = this.Append(aId, aText, aHelp, wxItemKind.wxITEM_RADIO);

    if (!previous?.IsRadio()) item.Check(true);

    return item;
  }

  /** `Enable( id, enable )`. */
  Enable(aId: number, aEnable: boolean): void {
    this.FindItem(aId)?.Enable(aEnable);
  }

  /** `IsEnabled( id )`. */
  IsEnabled(aId: number): boolean {
    return this.FindItem(aId)?.IsEnabled() ?? false;
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

// ---- the rows a menu is drawn from (was common/tool/action_menu_types.ts) ----
/**
 * The menu *data* types, split out of `MenuBar.tsx` so the modules that build
 * menus can be reached from the test suite.
 *
 * `qa`'s tsconfig compiles `.ts` only. Every menubar and toolbar data module
 * imported `Menu` / `MenuItem` from `MenuBar.tsx`, which made the whole of the
 * menu inventory — every editor's entries, their ids, their shortcuts and their
 * enabled state — untestable by construction, however pure the module itself
 * was. Nothing about these two interfaces needs React; only the component that
 * renders them does.
 *
 * `MenuBar.tsx` re-exports both, so existing importers are unaffected.
 */

export interface MenuItem {
  /**
   * The row's text, in English: the menu translates it when it draws the row
   * (`menu_ui.tsx`), so a table of rows built once still follows the language.
   */
  label?: string;
  /**
   * The label is data, not interface text - a file name, a net, a language's
   * own name (`LANGUAGE_DESCR::m_DoNotTranslate`) - and is drawn as given even
   * if a catalog happens to hold a message spelled the same.
   */
  noTranslate?: boolean;
  /** Tool/action id, its KiCad icon is shown if one is mapped. */
  icon?: string;
  action?: () => void;
  sep?: boolean;
  disabled?: boolean;
  /** Keyboard hint shown right-aligned (e.g. "Ctrl+S"). A single-character
   *  hint is also live while a ContextMenu is open, the way wx treats the
   *  `\tA` half of an ACTION_MENU label.
   *
   *  This is the **menu accelerator**, spelled as the menu draws it, and it is
   *  what `ui/menu_hotkeys.ts` dispatches on. Upstream never writes this text:
   *  `ACTION_MENU::updateHotKeys` attaches a `wxAcceleratorEntry`
   *  (`common/tool/action_menu.cpp:382-383`) and wxGTK lets GTK label it, so
   *  the row reads `Delete`, `Escape`, `Page Up`. The Hotkey List spells
   *  several of those differently - see {@link hotkeyName}. */
  shortcut?: string;
  /**
   * What the **Hotkey List** calls this key, where that differs from
   * {@link shortcut}.
   *
   * Two pieces of upstream code name the same keystroke and they disagree. The
   * menu's name comes from GTK (`Delete`); the list's comes from KiCad's own
   * `hotkeyNameList`, where `{ wxT( "Del" ), WXK_DELETE }` sits at
   * `common/hotkeys_basic.cpp:93`. `ui/hotkeys_inventory.ts` derives the whole
   * Hotkey List dialog from these rows, so one string cannot be right in both.
   *
   * **Almost nothing should set this.** The default is
   * `hotkeyListName( shortcut )` from `ui/key_names.ts`, which is an identity
   * for every key the two tables agree about and consults a single table for
   * the handful they do not. A per-call-site spelling is how the two drift
   * apart again; set this only for a row whose list name is not a function of
   * its accelerator at all.
   */
  hotkeyName?: string;
  /**
   * The row prints {@link shortcut}, but the *browser's* default action is what
   * carries the command out, so `ui/menu_hotkeys.ts` must not claim the key.
   *
   * There is exactly one reason to set this today, and it is Paste. Reading the
   * system clipboard is only reliable from inside a `paste` event; the async
   * `navigator.clipboard.read()` needs a permission the user has to grant. A
   * dispatcher that matched Ctrl+V would `preventDefault()` the keydown, the
   * browser would then never raise `paste`, and Paste would degrade from
   * "works" to "asks". Upstream has no equivalent, because `TOOL_DISPATCHER`
   * owns the key outright - `ACTIONS::paste` is dispatched like anything else -
   * so this marks a browser seam, not a KiCad behaviour.
   *
   * It is *not* a licence for a frame to hand-write a key comparison. The row
   * still declares the accelerator; what runs it is the browser, not a second
   * `if` beside the menu.
   */
  nativeShortcut?: boolean;
  /** The character wx underlines — what the `&` marks in a KiCad menu string
   *  ("Select &All"). The first occurrence in the label is underlined. */
  mnemonic?: string;
  /**
   * Pointer entering or leaving the row (`TA_CHOICE_MENU_UPDATE`).
   *
   * KiCad's selection menu uses this to brighten the item a row refers to
   * while you point at it, which is the only way to tell three stacked pours
   * apart — their descriptions differ by a layer name, but the board is what
   * you are actually looking at.
   */
  onHover?: (over: boolean) => void;
  /** ACTION_MENU::CHECK items, shows a checkmark when true. */
  checked?: boolean;
  /** The help string of `ACTION_MENU::Add( label, tooltip, id, icon )` -
   *  upstream shows it in the status bar while the row is highlighted, and it
   *  is where "Quit Image Converter" lives while the row itself reads "Quit". */
  tooltip?: string;
  /** Nested items rendered as a flyout submenu (KiCad ACTION_MENU submenus:
   *  Import, Export, Attributes, Open Recent…). `items` and `submenu` are
   *  accepted interchangeably so callers from either editor keep working. */
  submenu?: MenuItem[];
  items?: MenuItem[];
}

export interface Menu {
  label: string;
  items: MenuItem[];
}
