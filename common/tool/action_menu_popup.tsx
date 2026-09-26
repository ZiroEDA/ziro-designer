// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The page's `wxWindow::PopupMenu` for an ACTION_MENU: the frame's context
 * menu drawn with the same `ContextMenu` the menu-bar drop-downs use, and each
 * wx menu event - open, highlight, selection - handed to the menu's
 * `OnMenuEvent` in the order wxGTK sends them.
 *
 * Not KiCad code: the wxMenu/GtkMenu half of the toolkit.
 */

import { type JSX, useEffect, useState } from 'react';
import type { EDA_BASE_FRAME } from '../eda_base_frame.js';
import * as KIPLATFORM_UI from '../kiplatform/ui.js';
import { wxMenuEvent, wxMenuEventType, wxMenuItem } from '../wx/menu.js';
import type { ACTION_MENU } from './action_menu.js';
import { ContextMenu } from './action_menu_bar.js';
import type { MenuItem } from './action_menu_types.js';

/** The first `&x` of a wx label: the mnemonic GTK underlines. */
function mnemonicOf(aLabel: string): string | undefined {
  const m = /&([^&])/.exec(aLabel);
  return m ? m[1] : undefined;
}

/**
 * The rows of an ACTION_MENU (and its submenus), each wired back to the menu
 * that owns it: a pointed row is `wxEVT_MENU_HIGHLIGHT`, a chosen one
 * `wxEVT_COMMAND_MENU_SELECTED`.
 */
export function actionMenuItems(aMenu: ACTION_MENU): MenuItem[] {
  return aMenu.GetMenuItems().map((item: wxMenuItem): MenuItem => {
    if (item.IsSeparator()) return { sep: true };

    const label = wxMenuItem.GetLabelText(item.GetItemLabel());
    const sub = item.GetSubMenu() as ACTION_MENU | null;

    if (sub)
      return { label, submenu: actionMenuItems(sub), mnemonic: mnemonicOf(item.GetItemLabel()) };

    const shortcut = item.GetAccelString();

    return {
      label,
      mnemonic: mnemonicOf(item.GetItemLabel()),
      ...(shortcut ? { shortcut } : {}),
      ...(item.GetHelp() ? { tooltip: item.GetHelp() } : {}),
      ...(item.IsCheckable() ? { checked: item.IsChecked() } : {}),
      disabled: !item.IsEnabled(),
      onHover: (over: boolean) => {
        if (over)
          aMenu.OnMenuEvent(
            new wxMenuEvent(wxMenuEventType.wxEVT_MENU_HIGHLIGHT, item.GetId(), aMenu),
          );
      },
      action: () =>
        aMenu.OnMenuEvent(
          new wxMenuEvent(wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED, item.GetId(), aMenu),
        ),
    };
  });
}

interface OpenMenu {
  menu: ACTION_MENU;
  onClose: () => void;
  x: number;
  y: number;
}

/**
 * Installs itself as the frame's popup presenter and draws the menu the tool
 * manager asks for, at the pointer.
 */
export function ActionMenuPopup({ frame }: { frame: EDA_BASE_FRAME }): JSX.Element | null {
  const [open, setOpen] = useState<OpenMenu | null>(null);

  useEffect(() => {
    frame.SetPopupMenuPresenter((aMenu, aOnClose) => {
      const at = KIPLATFORM_UI.GetMousePosition();

      aMenu.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_MENU_OPEN, 0, aMenu));
      setOpen({ menu: aMenu, onClose: aOnClose, x: at.x, y: at.y });
    });

    return () => frame.SetPopupMenuPresenter(null);
  }, [frame]);

  if (!open) return null;

  return (
    <ContextMenu
      items={actionMenuItems(open.menu)}
      x={open.x}
      y={open.y}
      onClose={() => {
        setOpen(null);
        // ContextMenu closes before it runs the chosen row; wx handles the
        // selection while PopupMenu is still open and returns after. So the
        // close half runs once the row's handler has.
        queueMicrotask(open.onClose);
      }}
    />
  );
}
