// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `widgets/ui_common.h` / `common/widgets/ui_common.cpp`: `KIUI`, the small
 * helpers the items' descriptions go through. The wx-window ones (fonts,
 * DPI, the reference selector) are UI and not here.
 */

import { unescapeString } from '../string_utils.js';

/**
 * Makes the string a status-bar one: unescaped, line breaks and tabs as spaces.
 * The C++ then ellipsizes to 30% of the first 800 status-bar pixels plus 60% of the
 * rest, which a window measures; without one the text is returned whole.
 */
export function KIUI_EllipsizeStatusText(aWindow: unknown, aString: string): string {
  let msg = unescapeString(aString);

  msg = msg.replaceAll('\n', ' ');
  msg = msg.replaceAll('\r', ' ');
  msg = msg.replaceAll('\t', ' ');

  return msg;
}

export function KIUI_EllipsizeMenuText(aString: string): string {
  let msg = unescapeString(aString);

  msg = msg.replaceAll('\n', ' ');
  msg = msg.replaceAll('\r', ' ');
  msg = msg.replaceAll('\t', ' ');

  if (msg.length > 36) msg = `${msg.slice(0, 34)}...`;

  return msg;
}

/**
 * `KIUI::s_FocusStealableInputName`: widgets carrying this name are never
 * considered focused (a `data-focus-stealable` attribute here).
 */
export const s_FocusStealableInputName = 'KI_FOCUS_STEALABLE';

/**
 * Check if a input control has focus.
 *
 * @param aFocus Control that has focus, if null, wxWidgets will be queried.
 *
 * The wx control classes map onto the editable DOM elements: a text entry,
 * search control, styled text control are `input`/`textarea`; list box and
 * choice are `select`; check box, radio button, spin control and slider are
 * `input` types; a data view control is anything with `role="grid"`/`"tree"`
 * or their rows. A `contenteditable` element is a text entry.
 */
export function KIUI_IsInputControlFocused(aFocus: Element | null = null): boolean {
  if (aFocus === null && typeof document !== 'undefined') aFocus = document.activeElement;

  if (!aFocus) return false;

  // These widgets are never considered focused
  if (aFocus.getAttribute('name') === s_FocusStealableInputName) return false;

  const tag = aFocus.tagName;

  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  if ((aFocus as HTMLElement).isContentEditable) return true;

  const role = aFocus.getAttribute('role');

  if (role === 'listbox' || role === 'combobox' || role === 'spinbutton' || role === 'slider')
    return true;

  // Data view control is annoying, the focus is on a "wxDataViewCtrlMainWindow" class that
  // is not formally exported via the header.
  const parent = aFocus.parentElement;
  const parentRole = parent?.getAttribute('role');

  return (
    role === 'grid' ||
    role === 'tree' ||
    role === 'treegrid' ||
    parentRole === 'grid' ||
    parentRole === 'tree' ||
    parentRole === 'treegrid'
  );
}

/**
 * Check if a input control has focus and is editable.
 *
 * Must return true if we can't determine the state, intentionally true for
 * non inputs as well.
 */
export function KIUI_IsInputControlEditable(aFocus: Element | null): boolean {
  if (aFocus instanceof HTMLInputElement || aFocus instanceof HTMLTextAreaElement)
    return !aFocus.readOnly && !aFocus.disabled;

  return true;
}

/** `PGM_BASE::m_ModalDialogs`, the count a modal dialog registers itself in. */
let s_modalDialogs = 0;

/** `Pgm().m_ModalDialogs.push_back( aDialog )`, as a dialog's ShowModal does. */
export function KIUI_PushModalDialog(): void {
  s_modalDialogs++;
}

/** `Pgm().m_ModalDialogs.pop_back()`, as the dialog's ShowModal returns. */
export function KIUI_PopModalDialog(): void {
  if (s_modalDialogs > 0) s_modalDialogs--;
}

/** `KIUI::IsModalDialogFocused()`: `!Pgm().m_ModalDialogs.empty()`. */
export function KIUI_IsModalDialogFocused(): boolean {
  return s_modalDialogs > 0;
}
