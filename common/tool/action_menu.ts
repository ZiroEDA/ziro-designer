// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ACTION_MENU::AddClose` / `AddQuit` / `AddQuitOrClose`, ported —
 * `common/tool/action_menu.cpp:220-262`.
 *
 * These three are why every KiCad File menu ends the same way. The label, the
 * accelerator and the status-bar help string are written **once** upstream and
 * every frame calls the function:
 *
 *     void ACTION_MENU::AddClose( const wxString& aAppname )
 *     {
 *     #ifdef __WINDOWS__
 *         Add( _( "Close" ), wxString::Format( _( "Close %s" ), aAppname ),
 *              wxID_CLOSE, BITMAPS::exit );
 *     #else
 *         Add( _( "Close" ) + wxS( "\tCtrl+W" ), ... );
 *     #endif
 *     }
 *
 *     void ACTION_MENU::AddQuit( const wxString& aAppname )
 *     {
 *         Add( _( "Quit" ) + wxS( "\tCtrl+Q" ),
 *              wxString::Format( _( "Quit %s" ), aAppname ),
 *              wxID_EXIT, BITMAPS::exit );
 *     }
 *
 * Note what the app name is *for*: it goes in the help string, never in the
 * label. The row reads "Close"; the status bar reads "Close Footprint Editor".
 * Eleven frames here had written the row by hand and ten of them had put the
 * app name in the label instead — "Close Footprint Editor" as the menu text —
 * with no accelerator at all, which is what a per-frame copy of a shared thing
 * always decays into. `MenuItem.tooltip` is the help string's home.
 *
 * `AddQuitOrClose` is the third: a frame that can run standalone offers Quit,
 * and the same frame under the project manager offers Close, because closing
 * it returns you to the manager rather than ending the process. eeschema,
 * pcbnew and gerbview all call it. Everything here runs under the project
 * manager, so {@link addQuitOrClose} resolves to Close unless told otherwise —
 * but it is spelled as the upstream call so the two branches stay visible.
 *
 * ## Why the accelerators are not the ones in the C++
 *
 * Ctrl+W and Ctrl+Q are both in {@link BROWSER_RESERVED}: a tab cannot take
 * them, and `preventDefault()` on them is ignored. Ctrl+W closes the tab, which
 * with an unsaved board open is the most expensive keystroke in the app.
 *
 * So the row declares {@link browserSafeKey}'s substitution — Ctrl+Alt+W and
 * Ctrl+Alt+Q — and the menu therefore *prints* the key that will actually reach
 * us. That matters more now than it did before `ui/menu_hotkeys.ts`: a printed
 * accelerator used to be decoration, and a raw `Ctrl+W` in a row was merely a
 * lie. It is now a declaration the dispatcher reads, so a row spelling the raw
 * key advertises a keystroke whose only effect is to destroy the user's tab.
 *
 * The upstream spelling is still what appears in the source below, passed
 * through `browserSafeKey`, so the divergence is legible at the point of use
 * and lives in exactly one table.
 */
import { browserSafeKey } from '../browser_reserved.js';
import type { MenuItem } from './action_menu_types.js';
import { BITMAPS } from '../bitmaps_list.js';
import { main_id } from '../id.js';
import {
  wxID_ANY,
  wxID_NONE,
  wxItemKind,
  wxMenu,
  type wxMenuEvent,
  wxMenuEventType,
  wxMenuItem,
} from '../wx/menu.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import { ACTIONS } from './actions.js';
import type { TOOL_ACTION } from './tool_action.js';
import {
  AS_GLOBAL,
  MD_ALT,
  MD_CTRL,
  MD_MODIFIER_MASK,
  MD_SHIFT,
  TA_CHOICE_MENU_CHOICE,
  TA_CHOICE_MENU_UPDATE,
  TC_COMMAND,
  TOOL_EVENT,
} from './tool_event.js';
import { KeyNameFromKeyCode } from '../hotkeys_basic.js';
import { DIVERGENT_KEY_NAMES } from './action_menu_key_names.js';

/** GTK's label for a key KiCad's own key-name table spells another way. */
const GTK_KEY_NAMES = new Map(DIVERGENT_KEY_NAMES.map(([gtk, kicad]) => [kicad, gtk]));
import type { TOOL_MANAGER } from './tool_manager.js';

/** What ACTION_MENU asks of its tool: `m_tool->GetManager()`. */
export interface TOOL_INTERACTIVE_LIKE {
  GetManager(): TOOL_MANAGER | null;
}

type TOOL_MANAGER_FOR_MENU = TOOL_MANAGER;

/** The upstream key of `AddClose`, before the browser has its say. */
export const UPSTREAM_CLOSE_KEY = 'Ctrl+W';

/** The upstream key of `AddQuit`, before the browser has its say. */
export const UPSTREAM_QUIT_KEY = 'Ctrl+Q';

/**
 * `ACTION_MENU::AddClose( aAppname )`.
 *
 * The row reads "Close"; `aAppname` is the help string only.
 */
export function addClose(appName: string, action: () => void): MenuItem {
  return {
    label: 'Close',
    shortcut: browserSafeKey(UPSTREAM_CLOSE_KEY),
    tooltip: `Close ${appName}`,
    action,
  };
}

/**
 * `ACTION_MENU::AddQuit( aAppname )`.
 *
 * The row reads "Quit"; `aAppname` is the help string only.
 */
export function addQuit(appName: string, action: () => void): MenuItem {
  return {
    label: 'Quit',
    shortcut: browserSafeKey(UPSTREAM_QUIT_KEY),
    tooltip: `Quit ${appName}`,
    action,
  };
}

/**
 * `ACTION_MENU::AddQuitOrClose( aKiface, aAppname )`.
 *
 * `isSingle` is `!aKiface || aKiface->IsSingle()` — the frame is running on its
 * own rather than under the project manager. Every frame here is launched from
 * the project manager and returns to it, so the default is the Close branch.
 */
export function addQuitOrClose(appName: string, action: () => void, isSingle = false): MenuItem {
  return isSingle ? addQuit(appName, action) : addClose(appName, action);
}

// ---- ACTION_MENU -------------------------------------------------------------

/**
 * `ACTION_MENU` (`common/tool/action_menu.cpp` + `include/tool/action_menu.h`):
 * a wxMenu that turns item selections into TOOL_EVENTs - an item added with
 * a TOOL_ACTION runs that action, any other item reports TA_CHOICE_MENU_CHOICE
 * with its id - and that knows its tool, its submenus and its title.
 *
 * wx delivers menu events by itself; here the page's popup calls
 * {@link ACTION_MENU.OnMenuEvent} for the open, each highlight and the
 * selection, which is the same sequence.
 */
export class ACTION_MENU extends wxMenu {
  static readonly NORMAL = false;
  static readonly CHECK = true;

  ///< Flag indicating that the menu title should be set up.
  protected m_isForcedPosition = false;
  protected m_dirty = true;
  protected m_titleDisplayed = false;
  protected m_isContextMenu: boolean;
  ///< Menu title
  protected m_title = '';
  protected m_untranslatedTitle = '';
  ///< Optional icon
  protected m_icon: BITMAPS = BITMAPS.INVALID_BITMAP;
  ///< Stores the id number of selected item.
  protected m_selected = -1;
  ///< Creator of the menu
  protected m_tool: TOOL_INTERACTIVE_LIKE | null;
  ///< Associates tool actions with menu item IDs. Non-owning.
  protected m_toolActions = new Map<number, TOOL_ACTION>();
  ///< List of submenus.
  protected m_submenus: ACTION_MENU[] = [];

  constructor(isContextMenu: boolean, aTool: TOOL_INTERACTIVE_LIKE | null = null) {
    super();
    this.m_isContextMenu = isContextMenu;
    this.m_tool = aTool;
  }

  /**
   * Set title for the menu. The title is shown as a text label shown on the top of
   * the menu.
   */
  SetTitle(aTitle: string): void {
    // Unfortunately wxMenu::SetTitle() does not work very well, so this is an alternative version
    this.m_title = aTitle;

    // Update the menu title
    if (this.m_titleDisplayed) this.DisplayTitle(true);
  }

  SetUntranslatedTitle(aTitle: string): void {
    this.m_untranslatedTitle = aTitle;
  }

  GetTitle(): string {
    return this.m_title;
  }

  /**
   * Decide whether a title for a pop up menu should be displayed.
   */
  DisplayTitle(aDisplay = true): void {
    if ((!aDisplay || this.m_title === '') && this.m_titleDisplayed) {
      // Destroy the menu entry keeping the title..
      this.Destroy(this.FindItemByPosition(0));

      // ..and separator
      this.Destroy(this.FindItemByPosition(0));
      this.m_titleDisplayed = false;
    } else if (aDisplay && this.m_title !== '') {
      if (this.m_titleDisplayed) {
        // Simply update the title
        this.FindItemByPosition(0).SetItemLabel(this.m_title);
      } else {
        // Add a separator and a menu entry to display the title
        this.InsertSeparator(0);
        const title = this.Insert(
          0,
          new wxMenuItem(this, wxID_NONE, this.m_title, '', wxItemKind.wxITEM_NORMAL),
        );

        if (this.m_icon !== BITMAPS.INVALID_BITMAP) title.SetBitmap(this.m_icon);

        this.m_titleDisplayed = true;
      }
    }
  }

  /**
   * Assign an icon for the entry.
   */
  SetIcon(aIcon: BITMAPS): void {
    this.m_icon = aIcon;
  }

  GetIcon(): BITMAPS {
    return this.m_icon;
  }

  /**
   * Add a wxWidgets-style entry to the menu.
   *
   * After highlighting/selecting the entry, a wxWidgets event is generated.
   */
  Add(aLabel: string, aId: number, aIcon: BITMAPS): wxMenuItem;
  Add(
    aLabel: string,
    aToolTip: string,
    aId: number,
    aIcon: BITMAPS,
    aIsCheckmarkEntry?: boolean,
  ): wxMenuItem;
  /**
   * Add an entry to the menu, basing on the TOOL_ACTION object.
   *
   * After selecting the entry, a TOOL_EVENT command containing name of the action is sent.
   */
  Add(aAction: TOOL_ACTION, aIsCheckmarkEntry?: boolean, aOverrideLabel?: string): wxMenuItem;
  /**
   * Add a submenu to the menu.
   */
  Add(aMenu: ACTION_MENU): wxMenuItem;
  Add(
    a: string | TOOL_ACTION | ACTION_MENU,
    b?: number | string | boolean,
    c?: number | string | BITMAPS,
    d?: BITMAPS,
    e?: boolean,
  ): wxMenuItem {
    if (a instanceof ACTION_MENU) {
      const aMenu = a;
      this.m_submenus.push(aMenu);
      aMenu.SetParent(this);

      console.assert(aMenu.m_title !== '', 'Set a title for ACTION_MENU using SetTitle()');

      if (aMenu.m_icon !== BITMAPS.INVALID_BITMAP) {
        const newItem = new wxMenuItem(this, wxID_ANY, aMenu.m_title);
        newItem.SetBitmap(aMenu.m_icon);
        newItem.SetSubMenu(aMenu);
        return this.Append(newItem);
      }

      return this.AppendSubMenu(aMenu, aMenu.m_title);
    }

    if (typeof a !== 'string') {
      const aAction = a;
      const aIsCheckmarkEntry = (b as boolean | undefined) ?? false;
      const aOverrideLabel = (c as string | undefined) ?? '';
      // ID numbers for tool actions are assigned above ACTION_BASE_UI_ID inside TOOL_EVENT
      const icon = aAction.GetIcon();

      // Allow the label to be overridden at point of use
      const menuLabel = aOverrideLabel === '' ? aAction.GetMenuItem() : aOverrideLabel;

      const item = new wxMenuItem(
        this,
        aAction.GetUIId(),
        menuLabel,
        aAction.GetTooltip(),
        aIsCheckmarkEntry ? wxItemKind.wxITEM_CHECK : wxItemKind.wxITEM_NORMAL,
      );

      if (icon !== BITMAPS.INVALID_BITMAP) item.SetBitmap(icon);

      this.m_toolActions.set(aAction.GetUIId(), aAction);

      return this.Append(item);
    }

    if (typeof b === 'number') {
      // Add( aLabel, aId, aIcon )
      console.assert(this.FindItem(b) === null, 'Duplicate menu IDs!');

      const item = new wxMenuItem(this, b, a, '', wxItemKind.wxITEM_NORMAL);

      if (c !== undefined && c !== BITMAPS.INVALID_BITMAP) item.SetBitmap(c as BITMAPS);

      return this.Append(item);
    }

    // Add( aLabel, aTooltip, aId, aIcon, aIsCheckmarkEntry )
    const aId = c as number;
    console.assert(this.FindItem(aId) === null, 'Duplicate menu IDs!');

    const item = new wxMenuItem(
      this,
      aId,
      a,
      b as string,
      e ? wxItemKind.wxITEM_CHECK : wxItemKind.wxITEM_NORMAL,
    );

    if (d !== undefined && d !== BITMAPS.INVALID_BITMAP) item.SetBitmap(d);

    return this.Append(item);
  }

  /**
   * Remove all the entries from the menu (as well as its title). It leaves the
   * menu in the initial state.
   */
  Clear(): void {
    this.m_titleDisplayed = false;

    for (let i = this.GetMenuItemCount() - 1; i >= 0; --i) this.Destroy(this.FindItemByPosition(i));

    this.m_toolActions.clear();
    this.m_submenus = [];
  }

  /**
   * Returns true if the menu has any enabled items
   */
  HasEnabledItems(): boolean {
    for (const item of this.GetMenuItems()) {
      if (item.IsEnabled() && !item.IsSeparator()) return true;
    }

    return false;
  }

  /**
   * Return the position of selected item. If the returned value is negative, that means
   * that menu was dismissed.
   */
  GetSelected(): number {
    return this.m_selected;
  }

  /**
   * Run update handlers for the menu and its submenus.
   */
  UpdateAll(): void {
    try {
      this.update();
    } catch {
      // swallowed, as upstream
    }

    if (this.m_tool) this.updateHotKeys();

    this.runOnSubmenus((m) => m.UpdateAll());
  }

  UpdateTitle(): void {
    if (this.m_untranslatedTitle !== '') this.m_title = this.m_untranslatedTitle;
  }

  /**
   * Clear the dirty flag on the menu and all descendants.
   */
  ClearDirty(): void {
    this.m_dirty = false;
    this.runOnSubmenus((m) => m.ClearDirty());
  }

  SetDirty(): void {
    this.m_dirty = true;
    this.runOnSubmenus((m) => m.SetDirty());
  }

  /**
   * Set a tool that is the creator of the menu.
   */
  SetTool(aTool: TOOL_INTERACTIVE_LIKE): void {
    this.m_tool = aTool;
    this.runOnSubmenus((m) => m.SetTool(aTool));
  }

  /**
   * Create a deep, recursive copy of this ACTION_MENU.
   */
  Clone(): ACTION_MENU {
    const clone = this.create();
    clone.Clear();
    clone.copyFrom(this);
    return clone;
  }

  /** The submenus, for the page's popup. */
  GetSubmenus(): readonly ACTION_MENU[] {
    return this.m_submenus;
  }

  IsContextMenu(): boolean {
    return this.m_isContextMenu;
  }

  PassHelpTextToHandler(): boolean {
    return false;
  }

  /**
   * Return an instance of this class. It has to be overridden in inheriting classes.
   */
  protected create(): ACTION_MENU {
    const menu = new ACTION_MENU(false);

    console.assert(
      Object.getPrototypeOf(this) === ACTION_MENU.prototype,
      `You need to override create() method for class ${this.constructor.name}`,
    );

    return menu;
  }

  /**
   * Return an instance of TOOL_MANAGER class.
   */
  protected getToolManager(): TOOL_MANAGER_FOR_MENU | null {
    return this.m_tool ? this.m_tool.GetManager() : null;
  }

  /**
   * Update hot key settings for TOOL_ACTIONs in this menu.
   */
  protected updateHotKeys(): void {
    const toolMgr = this.getToolManager();

    console.assert(toolMgr !== null);

    if (!toolMgr) return;

    for (const [id, action] of this.m_toolActions) {
      const key = toolMgr.GetHotKey(action) & ~MD_MODIFIER_MASK;

      if (key > 0) {
        const mod = toolMgr.GetHotKey(action) & MD_MODIFIER_MASK;
        const item = this.FindChildItem(id);

        if (item) {
          // wxAcceleratorEntry( flags, key, id, item ), as GTK labels it:
          // Ctrl, then Alt, then Shift, then the key.
          let accel = '';

          if (mod & MD_CTRL) accel += 'Ctrl+';
          if (mod & MD_ALT) accel += 'Alt+';
          if (mod & MD_SHIFT) accel += 'Shift+';

          const name = KeyNameFromKeyCode(key);
          item.SetAccel(accel + (GTK_KEY_NAMES.get(name) ?? name));
        }
      }
    }
  }

  /**
   * Update menu state stub. It is called before a menu is shown, in order to update its state.
   * Here you can tick current settings, enable/disable entries, etc.
   */
  protected update(): void {}

  /**
   * Event handler stub.
   *
   * It should be used if you want to generate a TOOL_EVENT from a wxMenuEvent.
   * It will be called when a menu entry is clicked.
   */
  protected eventHandler(_aEvent: wxMenuEvent): TOOL_EVENT | null {
    return null;
  }

  /**
   * Copy another menus data to this instance. Old entries are preserved and ones form aMenu
   * are copied.
   */
  protected copyFrom(aMenu: ACTION_MENU): void {
    this.m_icon = aMenu.m_icon;
    this.m_title = aMenu.m_title;
    this.m_titleDisplayed = aMenu.m_titleDisplayed;
    this.m_selected = -1; // aMenu.m_selected;
    this.m_tool = aMenu.m_tool;
    this.m_toolActions = new Map(aMenu.m_toolActions);

    // Copy all menu entries
    for (let i = 0; i < aMenu.GetMenuItemCount(); ++i) {
      const item = aMenu.FindItemByPosition(i);
      this.appendCopy(item);
    }
  }

  /**
   * Append a copy of wxMenuItem.
   */
  protected appendCopy(aSource: wxMenuItem): wxMenuItem {
    const newItem = new wxMenuItem(
      this,
      aSource.GetId(),
      aSource.GetItemLabel(),
      aSource.GetHelp(),
      aSource.IsSeparator() ? wxItemKind.wxITEM_NORMAL : aSource.GetKind(),
    );

    if (aSource.IsSeparator()) return this.AppendSeparator();

    const bitmap = aSource.GetBitmap();

    if (bitmap !== null) newItem.SetBitmap(bitmap);

    if (aSource.IsSubMenu()) {
      const menu = aSource.GetSubMenu();
      console.assert(menu instanceof ACTION_MENU, 'Submenus are expected to be a ACTION_MENU');

      if (menu instanceof ACTION_MENU) {
        const menuCopy = menu.Clone();
        newItem.SetSubMenu(menuCopy);
        this.m_submenus.push(menuCopy);
      }
    }

    // wxMenuItem has to be added before enabling/disabling or checking
    this.Append(newItem);

    if (aSource.IsCheckable()) newItem.Check(aSource.IsChecked());

    newItem.Enable(aSource.IsEnabled());

    return newItem;
  }

  /**
   * The default menu event handler.
   */
  OnMenuEvent(aEvent: wxMenuEvent): void {
    let evt: TOOL_EVENT | null = null;
    let menuText: string;
    const type = aEvent.GetEventType();
    const toolMgr = this.getToolManager();

    if (type === wxMenuEventType.wxEVT_MENU_OPEN) {
      if (this.m_dirty && toolMgr) toolMgr.RunAction<ACTION_MENU>(ACTIONS.updateMenu, this);

      const parent = this.GetParent();

      // Don't update the position if this menu has a parent or is a menubar menu
      if (!parent && toolMgr) g_menu_open_position = toolMgr.GetMousePosition();

      g_last_menu_highlighted_id = 0;
    } else if (type === wxMenuEventType.wxEVT_MENU_HIGHLIGHT) {
      if (aEvent.GetId() > 0) g_last_menu_highlighted_id = aEvent.GetId();

      evt = new TOOL_EVENT(TC_COMMAND, TA_CHOICE_MENU_UPDATE, aEvent.GetId(), AS_GLOBAL);
    } else if (type === wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED) {
      // The C++ recovers a hotkey wx turned into a menu command while a text
      // entry had focus; a page's menu only ever sends real selections.

      // Store the selected position, so it can be checked by the tools
      this.m_selected = aEvent.GetId();

      let parent = this.GetParent();

      while (parent instanceof ACTION_MENU) {
        parent.m_selected = this.m_selected;
        parent = parent.GetParent();
      }

      // Check if there is a TOOL_ACTION for the given UI ID
      if (toolMgr?.GetActionManager().IsActionUIId(this.m_selected))
        evt = this.findToolAction(this.m_selected);

      if (!evt) {
        evt = this.runEventHandlers(aEvent);

        // Handling non-ACTION menu entries.  Two ranges of ids are supported:
        //   between 0 and ID_CONTEXT_MENU_ID_MAX
        //   between ID_POPUP_MENU_START and ID_POPUP_MENU_END

        if (
          !evt &&
          ((this.m_selected >= 0 && this.m_selected < ID_CONTEXT_MENU_ID_MAX) ||
            (this.m_selected >= main_id.ID_POPUP_MENU_START &&
              this.m_selected <= main_id.ID_POPUP_MENU_END))
        ) {
          const actionMenu = this.GetParent();

          if (
            this.PassHelpTextToHandler() ||
            (actionMenu instanceof ACTION_MENU && actionMenu.PassHelpTextToHandler())
          )
            menuText = this.GetHelpString(aEvent.GetId());
          else menuText = this.GetLabelText(aEvent.GetId());

          evt = new TOOL_EVENT(TC_COMMAND, TA_CHOICE_MENU_CHOICE, this.m_selected, AS_GLOBAL);
          evt.SetParameter(menuText);
        }
      }
    }

    // forward the action/update event to the TOOL_MANAGER
    // clients that don't supply a tool will have to check GetSelected() themselves
    if (evt && toolMgr) {
      // If it's a context menu then fetch the mouse position from our context-menu-position
      // hack.
      if (this.m_isContextMenu) {
        evt.SetMousePosition(g_menu_open_position);
      }
      // Check if it is a menubar event, and don't get any position if it is.
      else if (g_last_menu_highlighted_id === aEvent.GetId()) {
        evt.SetHasPosition(false);
      }
      // Otherwise it's a command-key-event and we need to get the mouse position from the tool
      // manager so that immediate actions work.
      else {
        evt.SetMousePosition(toolMgr.GetMousePosition());
      }

      toolMgr.ProcessEvent(evt);
    }
  }

  /** `OnIdle`: forget the highlight and the open position. */
  OnIdle(): void {
    g_last_menu_highlighted_id = 0;
    g_menu_open_position = { x: 0, y: 0 };
  }

  /**
   * Traverse the submenus tree looking for a submenu capable of handling a particular menu
   * event. In case it is handled, it is returned the aToolEvent parameter.
   */
  protected runEventHandlers(aMenuEvent: wxMenuEvent): TOOL_EVENT | null {
    let aToolEvent = this.eventHandler(aMenuEvent);

    if (!aToolEvent) {
      for (const m of this.m_submenus) {
        aToolEvent = m.runEventHandlers(aMenuEvent);

        if (aToolEvent) break;
      }
    }

    return aToolEvent;
  }

  /**
   * Run a function on the menu and all its submenus.
   */
  protected runOnSubmenus(aFunction: (aMenu: ACTION_MENU) => void): void {
    try {
      for (const m of this.m_submenus) {
        aFunction(m);
        m.runOnSubmenus(aFunction);
      }
    } catch {
      // swallowed, as upstream
    }
  }

  /**
   * Check if any of submenus contains a TOOL_ACTION with a specific ID.
   */
  protected findToolAction(aId: number): TOOL_EVENT | null {
    let evt: TOOL_EVENT | null = null;

    const findFunc = (m: ACTION_MENU): void => {
      if (evt) return;

      const action = m.m_toolActions.get(aId);

      if (action) evt = action.MakeEvent();
    };

    findFunc(this);

    if (!evt) this.runOnSubmenus(findFunc);

    return evt;
  }
}

/// `#define ID_CONTEXT_MENU_ID_MAX wxID_LOWEST` ( = 100 )
const ID_CONTEXT_MENU_ID_MAX = 100;

// wxWidgets doesn't tell us when a menu command was generated from a hotkey or from
// a menu selection.  It's important to us because a hotkey can be an immediate action
// while the menu selection can not (as it has no associated position).
//
// We get around this by storing the last highlighted menuId.  If it matches the command
// id then we know this is a menu selection.
let g_last_menu_highlighted_id = 0;

// We need to store the position of the mouse when the menu was opened so it can be passed
// to the command event generated when the menu item is selected.
let g_menu_open_position: VECTOR2D = { x: 0, y: 0 };
