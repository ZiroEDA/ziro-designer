// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/tool_menu.cpp` + `include/tool/tool_menu.h`: `TOOL_MENU`, a
 * tool's context menu - one CONDITIONAL_MENU, the submenus it owns, and
 * ShowContextMenu, which evaluates it for the selection and asks the manager
 * to pop it up now.
 */

import type { ACTION_MENU } from './action_menu.js';
import { CONDITIONAL_MENU } from './conditional_menu.js';
import type { SELECTION } from './selection.js';
import { CONTEXT_MENU_TRIGGER } from './tool_event.js';
import type { TOOL_INTERACTIVE } from './tool_interactive.js';

export class TOOL_MENU {
  ///< The actual menu displayed by this instance.
  private m_menu: CONDITIONAL_MENU;
  ///< The tool that owns this menu.
  private m_tool: TOOL_INTERACTIVE;
  ///< List of submenus.
  private m_subMenus: ACTION_MENU[] = [];

  /**
   * Construct a new TOOL_MENU for a specific tool.
   *
   * This menu will be empty - it's up to the caller to add the relevant items. This can
   * be done directly, using the reference returned by TOOL_MENU::GetMenu(), or the helpers
   * for common command sets can be used, or a combination of the two.
   */
  constructor(aTool: TOOL_INTERACTIVE) {
    this.m_menu = new CONDITIONAL_MENU(aTool);
    this.m_tool = aTool;
  }

  /**
   * @return the CONDITIONAL_MENU model for this TOOL_MENU.
   */
  GetMenu(): CONDITIONAL_MENU {
    return this.m_menu;
  }

  /**
   * Store a submenu of this menu model. This can be shared with other menu models.
   *
   * It is the callers responsibility to add the submenu to m_menu (via GetMenu()) in the
   * right way, as well as to set the tool with SetTool(), since it's not a given that the
   * menu's tool is the tool that directly owns this TOOL_MENU.
   */
  RegisterSubMenu(aSubMenu: ACTION_MENU): void {
    // store a copy of the menu (keeps a reference)
    this.m_subMenus.push(aSubMenu);
  }

  /**
   * Helper function to set and immediately show a CONDITIONAL_MENU in concert with the given
   * SELECTION.
   *
   * You don't have to use this function, if the caller has a different way to show the
   * menu, it can create one from the reference returned by TOOL_MENU::GetMenu(), but it
   * will have to be populated externally.
   */
  ShowContextMenu(aSelection?: SELECTION): void {
    if (aSelection) {
      this.m_menu.Evaluate(aSelection);
      this.m_menu.UpdateAll();
      this.m_menu.ClearDirty();
    } else {
      this.m_menu.SetDirty();
    }

    this.m_tool.SetContextMenu(this.m_menu, CONTEXT_MENU_TRIGGER.CMENU_NOW);
  }
}
