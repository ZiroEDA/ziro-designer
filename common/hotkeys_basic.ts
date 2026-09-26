// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `hotkeys_basic` (include/hotkeys_basic.h, common/hotkeys_basic.cpp): the
 * key-code ↔ key-name conversions of the hotkey system, and the hotkey
 * config file read into a set of TOOL_ACTIONs. The file I/O works on text
 * the caller hands over — a browser has no `PATHS::GetUserSettingsPath()`.
 *
 * This is the GTK build: `MODIFIER_CTRL` is "Ctrl+" (on macOS it is "Cmd+").
 */
import { WXK } from '@ziroeda/core/wx_keycodes.js';
// The named constants, not a destructure of TOOL_MODIFIERS at load: this module
// sits on the tool_event -> tool_action -> action_manager -> here cycle, so it
// can load before tool_event has finished, and only a live binding read at call
// time survives that.
import {
  MD_ALT,
  MD_ALTGR,
  MD_CTRL,
  MD_META,
  MD_MODIFIER_MASK,
  MD_SHIFT,
  MD_SUPER,
} from './tool/tool_event.js';
import type { TOOL_ACTION } from './tool/tool_action.js';

export const DEFAULT_HOTKEY_FILENAME_EXT = 'hotkeys';

export const EESCHEMA_HOTKEY_NAME = 'Schematic Editor';
export const PCBNEW_HOTKEY_NAME = 'PCB Editor';

// A define to allow keys to go further than just ASCII, to use modifier keys.
// (see TOOL_MODIFIERS in tool_event.h)
export const PSEUDO_WXK_CLICK = 400;
export const PSEUDO_WXK_DBLCLICK = 401;
export const PSEUDO_WXK_WHEEL = 402;

interface hotkey_name_descr {
  m_Name: string;
  m_KeyCode: number;
}

const KEY_NON_FOUND = -1;

const hotkeyNameList: readonly hotkey_name_descr[] = [
  { m_Name: 'F1', m_KeyCode: WXK.WXK_F1 },
  { m_Name: 'F2', m_KeyCode: WXK.WXK_F2 },
  { m_Name: 'F3', m_KeyCode: WXK.WXK_F3 },
  { m_Name: 'F4', m_KeyCode: WXK.WXK_F4 },
  { m_Name: 'F5', m_KeyCode: WXK.WXK_F5 },
  { m_Name: 'F6', m_KeyCode: WXK.WXK_F6 },
  { m_Name: 'F7', m_KeyCode: WXK.WXK_F7 },
  { m_Name: 'F8', m_KeyCode: WXK.WXK_F8 },
  { m_Name: 'F9', m_KeyCode: WXK.WXK_F9 },
  { m_Name: 'F10', m_KeyCode: WXK.WXK_F10 },
  { m_Name: 'F11', m_KeyCode: WXK.WXK_F11 },
  { m_Name: 'F12', m_KeyCode: WXK.WXK_F12 },
  { m_Name: 'F13', m_KeyCode: WXK.WXK_F13 },
  { m_Name: 'F14', m_KeyCode: WXK.WXK_F14 },
  { m_Name: 'F15', m_KeyCode: WXK.WXK_F15 },
  { m_Name: 'F16', m_KeyCode: WXK.WXK_F16 },
  { m_Name: 'F17', m_KeyCode: WXK.WXK_F17 },
  { m_Name: 'F18', m_KeyCode: WXK.WXK_F18 },
  { m_Name: 'F19', m_KeyCode: WXK.WXK_F19 },
  { m_Name: 'F20', m_KeyCode: WXK.WXK_F20 },
  { m_Name: 'F21', m_KeyCode: WXK.WXK_F21 },
  { m_Name: 'F22', m_KeyCode: WXK.WXK_F22 },
  { m_Name: 'F23', m_KeyCode: WXK.WXK_F23 },
  { m_Name: 'F24', m_KeyCode: WXK.WXK_F24 },

  { m_Name: 'Esc', m_KeyCode: WXK.WXK_ESCAPE },
  { m_Name: 'Del', m_KeyCode: WXK.WXK_DELETE },
  { m_Name: 'Tab', m_KeyCode: WXK.WXK_TAB },
  { m_Name: 'Back', m_KeyCode: WXK.WXK_BACK },
  { m_Name: 'Ins', m_KeyCode: WXK.WXK_INSERT },

  { m_Name: 'Home', m_KeyCode: WXK.WXK_HOME },
  { m_Name: 'End', m_KeyCode: WXK.WXK_END },
  { m_Name: 'PgUp', m_KeyCode: WXK.WXK_PAGEUP },
  { m_Name: 'PgDn', m_KeyCode: WXK.WXK_PAGEDOWN },

  { m_Name: 'Up', m_KeyCode: WXK.WXK_UP },
  { m_Name: 'Down', m_KeyCode: WXK.WXK_DOWN },
  { m_Name: 'Left', m_KeyCode: WXK.WXK_LEFT },
  { m_Name: 'Right', m_KeyCode: WXK.WXK_RIGHT },

  { m_Name: 'Return', m_KeyCode: WXK.WXK_RETURN },

  { m_Name: 'Space', m_KeyCode: WXK.WXK_SPACE },

  { m_Name: 'Num Pad 0', m_KeyCode: WXK.WXK_NUMPAD0 },
  { m_Name: 'Num Pad 1', m_KeyCode: WXK.WXK_NUMPAD1 },
  { m_Name: 'Num Pad 2', m_KeyCode: WXK.WXK_NUMPAD2 },
  { m_Name: 'Num Pad 3', m_KeyCode: WXK.WXK_NUMPAD3 },
  { m_Name: 'Num Pad 4', m_KeyCode: WXK.WXK_NUMPAD4 },
  { m_Name: 'Num Pad 5', m_KeyCode: WXK.WXK_NUMPAD5 },
  { m_Name: 'Num Pad 6', m_KeyCode: WXK.WXK_NUMPAD6 },
  { m_Name: 'Num Pad 7', m_KeyCode: WXK.WXK_NUMPAD7 },
  { m_Name: 'Num Pad 8', m_KeyCode: WXK.WXK_NUMPAD8 },
  { m_Name: 'Num Pad 9', m_KeyCode: WXK.WXK_NUMPAD9 },
  { m_Name: 'Num Pad +', m_KeyCode: WXK.WXK_NUMPAD_ADD },
  { m_Name: 'Num Pad -', m_KeyCode: WXK.WXK_NUMPAD_SUBTRACT },
  { m_Name: 'Num Pad *', m_KeyCode: WXK.WXK_NUMPAD_MULTIPLY },
  { m_Name: 'Num Pad /', m_KeyCode: WXK.WXK_NUMPAD_DIVIDE },
  { m_Name: 'Num Pad .', m_KeyCode: WXK.WXK_NUMPAD_SEPARATOR },
  { m_Name: 'Num Pad Enter', m_KeyCode: WXK.WXK_NUMPAD_ENTER },
  { m_Name: 'Num Pad F1', m_KeyCode: WXK.WXK_NUMPAD_F1 },
  { m_Name: 'Num Pad F2', m_KeyCode: WXK.WXK_NUMPAD_F2 },
  { m_Name: 'Num Pad F3', m_KeyCode: WXK.WXK_NUMPAD_F3 },
  { m_Name: 'Num Pad F4', m_KeyCode: WXK.WXK_NUMPAD_F4 },

  { m_Name: '', m_KeyCode: 0 },

  { m_Name: 'Click', m_KeyCode: PSEUDO_WXK_CLICK },
  { m_Name: 'DblClick', m_KeyCode: PSEUDO_WXK_DBLCLICK },
  { m_Name: 'Wheel', m_KeyCode: PSEUDO_WXK_WHEEL },

  // Do not change this line: end of list
  { m_Name: '', m_KeyCode: KEY_NON_FOUND },
];

// name of modifier keys.
// Note: the Ctrl key is Cmd key on Mac OS X.
// However, in wxWidgets defs, the key WXK_CONTROL is the Cmd key,
// so the code using WXK_CONTROL should be ok on any system.
// (on Mac OS X the actual Ctrl key code is WXK_RAW_CONTROL)
const MODIFIER_CTRL = 'Ctrl+';
const MODIFIER_ALT = 'Alt+';
const MODIFIER_CMD_MAC = 'Cmd+';
const MODIFIER_CTRL_BASE = 'Ctrl+';
const MODIFIER_SHIFT = 'Shift+';
const MODIFIER_META = 'Meta+';
const MODIFIER_WIN = 'Win+';
const MODIFIER_SUPER = 'Super+';
const MODIFIER_ALTGR = 'AltGr+';

/**
 * Return the key name from the key code.
 *
 * Only some wxWidgets key values are handled for function key ( see hotkeyNameList[] )
 *
 * @param aKeycode key code (ASCII value, or wxWidgets value for function keys).
 * @param aIsFound a pointer to a bool to return true if found, or false. an be nullptr default).
 * @return the key name in a wxString.
 */
export function KeyNameFromKeyCode(aKeycode: number, aIsFound?: { value: boolean }): string {
  let keyname = '';
  let modifier = '';
  let found = false;

  if (aKeycode === WXK.WXK_CONTROL) return MODIFIER_CTRL.split('+')[0]!;
  else if (aKeycode === WXK.WXK_RAW_CONTROL) return MODIFIER_CTRL_BASE.split('+')[0]!;
  else if (aKeycode === WXK.WXK_SHIFT) return MODIFIER_SHIFT.split('+')[0]!;
  else if (aKeycode === WXK.WXK_ALT) return MODIFIER_ALT.split('+')[0]!;
  else if (aKeycode === WXK.WXK_WINDOWS_LEFT || aKeycode === WXK.WXK_WINDOWS_RIGHT)
    return MODIFIER_WIN.split('+')[0]!;

  // Assume keycode of 0 is "unassigned"
  if ((aKeycode & MD_CTRL) !== 0) modifier += MODIFIER_CTRL;

  if ((aKeycode & MD_ALT) !== 0) modifier += MODIFIER_ALT;

  if ((aKeycode & MD_SHIFT) !== 0) modifier += MODIFIER_SHIFT;

  if ((aKeycode & MD_META) !== 0) modifier += MODIFIER_META;

  if ((aKeycode & MD_SUPER) !== 0) modifier += MODIFIER_WIN;

  if ((aKeycode & MD_ALTGR) !== 0) modifier += MODIFIER_ALTGR;

  aKeycode &= ~MD_MODIFIER_MASK;

  if (aKeycode > 32 && aKeycode < 0x7f) {
    found = true;
    keyname += String.fromCharCode(aKeycode);
  } else {
    for (let ii = 0; ; ii++) {
      if (hotkeyNameList[ii]!.m_KeyCode === KEY_NON_FOUND) {
        // End of list
        keyname = '<unknown>';
        break;
      }

      if (hotkeyNameList[ii]!.m_KeyCode === aKeycode) {
        keyname = hotkeyNameList[ii]!.m_Name;
        found = true;
        break;
      }
    }
  }

  if (aIsFound) aIsFound.value = found;

  return modifier + keyname;
}

export enum HOTKEY_ACTION_TYPE {
  IS_HOTKEY,
  IS_COMMENT,
}
export const { IS_HOTKEY, IS_COMMENT } = HOTKEY_ACTION_TYPE;

/**
 * @param aText the base text on which to append the hotkey.
 * @param aHotKey the hotkey keycode.
 * @param aStyle #IS_HOTKEY to add <tab><keyname> (shortcuts in menus, same as hotkeys).
 *               #IS_COMMENT to add <spaces><(keyname)> mainly in tool tips.
 */
export function AddHotkeyName(
  aText: string,
  aHotKey: number,
  aStyle: HOTKEY_ACTION_TYPE = IS_HOTKEY,
): string {
  let msg = aText;
  const keyname = KeyNameFromKeyCode(aHotKey);

  if (keyname !== '') {
    switch (aStyle) {
      case IS_HOTKEY: {
        // Don't add a suffix for unassigned hotkeys:
        // WX spews debug from wxAcceleratorEntry::ParseAccel if it doesn't
        // recognize the keyname, which is the case for <unassigned>.
        if (aHotKey !== 0) {
          msg += `\t${keyname}`;
        }
        break;
      }
      case IS_COMMENT: {
        msg += ` (${keyname})`;
        break;
      }
    }
  }

  return msg;
}

/**
 * Return the key code from its user-friendly key name (ie: "Ctrl+M").
 */
export function KeyCodeFromKeyName(keyname: string): number {
  let keycode = KEY_NON_FOUND;

  // Search for modifiers: Ctrl+ Alt+ Shift+ and others
  // Note: on Mac OSX, the Cmd key is equiv here to Ctrl
  let key = keyname;
  let prefix: string;
  let modifier = 0;

  while (true) {
    prefix = '';

    if (key.startsWith(MODIFIER_CTRL_BASE)) {
      modifier |= MD_CTRL;
      prefix = MODIFIER_CTRL_BASE;
    } else if (key.startsWith(MODIFIER_CMD_MAC)) {
      modifier |= MD_CTRL;
      prefix = MODIFIER_CMD_MAC;
    } else if (key.startsWith(MODIFIER_ALT)) {
      modifier |= MD_ALT;
      prefix = MODIFIER_ALT;
    } else if (key.startsWith(MODIFIER_SHIFT)) {
      modifier |= MD_SHIFT;
      prefix = MODIFIER_SHIFT;
    } else if (key.startsWith(MODIFIER_META)) {
      modifier |= MD_META;
      prefix = MODIFIER_META;
    } else if (key.startsWith(MODIFIER_WIN)) {
      modifier |= MD_SUPER;
      prefix = MODIFIER_WIN;
    } else if (key.startsWith(MODIFIER_SUPER)) {
      modifier |= MD_SUPER;
      prefix = MODIFIER_SUPER;
    } else if (key.startsWith(MODIFIER_ALTGR)) {
      modifier |= MD_ALTGR;
      prefix = MODIFIER_ALTGR;
    } else {
      break;
    }

    if (prefix !== '') key = key.slice(prefix.length);
  }

  if (key.length === 1 && key.charCodeAt(0) > 32 && key.charCodeAt(0) < 0x7f) {
    keycode = key.charCodeAt(0);
    keycode += modifier;
    return keycode;
  }

  for (let ii = 0; hotkeyNameList[ii]!.m_KeyCode !== KEY_NON_FOUND; ii++) {
    if (key.toLowerCase() === hotkeyNameList[ii]!.m_Name.toLowerCase()) {
      keycode = hotkeyNameList[ii]!.m_KeyCode + modifier;
      break;
    }
  }

  return keycode;
}

/**
 * Reads a hotkey config file into a map.  If aFileName is empty it will read in the
 * default hotkeys file. Here the file is its text, `user.hotkeys` as the settings
 * store holds it.
 */
export function ReadHotKeyConfig(aFileText: string, aHotKeys: Map<string, [number, number]>): void {
  const input = aFileText.replaceAll('\r\n', '\n'); // Convert Windows files to Unix line-ends

  for (const line of input.split('\n')) {
    if (line === '') continue; // wxTOKEN_STRTOK

    const [cmdName = '', primary = '', secondary = ''] = line.split('\t');

    if (cmdName !== '')
      aHotKeys.set(cmdName, [KeyCodeFromKeyName(primary), KeyCodeFromKeyName(secondary)]);
  }
}

/**
 * Read a hotkey config file into a list of actions.
 */
export function ReadHotKeyConfigIntoActions(aFileText: string, aActions: TOOL_ACTION[]): void {
  const hotkeys = new Map<string, [number, number]>();

  // Read the existing config (all hotkeys)
  ReadHotKeyConfig(aFileText, hotkeys);

  // Set each tool action hotkey to the config file hotkey if present
  for (const action of aActions) {
    const keys = hotkeys.get(action.GetName());
    if (keys) action.SetHotKey(keys[0], keys[1]);
  }
}

/**
 * Update the hotkeys config file with the hotkeys from the given actions: the
 * existing config text is overlaid with the actions' hotkeys and the whole set
 * is returned as the file's new text (a `std::map` writes its keys sorted).
 */
export function WriteHotKeyConfig(
  aExistingFileText: string,
  aActions: readonly TOOL_ACTION[],
): string {
  const hotkeys = new Map<string, [number, number]>();

  // Read the existing config (all hotkeys)
  ReadHotKeyConfig(aExistingFileText, hotkeys);

  // Overlay the current app's hotkey definitions onto the map
  for (const action of aActions)
    hotkeys.set(action.GetName(), [action.GetHotKey(), action.GetHotKeyAlt()]);

  // Write entire hotkey set
  let out = '';

  for (const name of [...hotkeys.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [primary, secondary] = hotkeys.get(name)!;
    out += `${name}\t${KeyNameFromKeyCode(primary)}\t${KeyNameFromKeyCode(secondary)}\n`;
  }

  return out;
}
