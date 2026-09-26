// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The wxGTK side of `src/gtk/window.cpp`, for the browser: how a DOM pointer,
 * wheel or keyboard event becomes the `wxMouseEvent` / `wxKeyEvent` KiCad's
 * canvas handlers read. The rules are GTK's (a wheel notch is 120, a smooth
 * scroll delta of 1.0 is one notch, `GDK_SCROLL_RIGHT` is +120).
 */

import { WXK } from '@ziroeda/core/wx_keycodes.js';
import * as KIPLATFORM_UI from '../kiplatform/ui.js';
import {
  wxEVT_AUX1_DCLICK,
  wxEVT_AUX1_DOWN,
  wxEVT_AUX1_UP,
  wxEVT_AUX2_DCLICK,
  wxEVT_AUX2_DOWN,
  wxEVT_AUX2_UP,
  wxEVT_CHAR,
  wxEVT_ENTER_WINDOW,
  wxEVT_KEY_DOWN,
  wxEVT_KEY_UP,
  wxEVT_LEAVE_WINDOW,
  wxEVT_LEFT_DCLICK,
  wxEVT_LEFT_DOWN,
  wxEVT_LEFT_UP,
  wxEVT_MIDDLE_DCLICK,
  wxEVT_MIDDLE_DOWN,
  wxEVT_MIDDLE_UP,
  wxEVT_MOTION,
  wxEVT_MOUSEWHEEL,
  wxEVT_RIGHT_DCLICK,
  wxEVT_RIGHT_DOWN,
  wxEVT_RIGHT_UP,
  type wxEventType,
  wxKeyEvent,
  wxMouseEvent,
  wxMouseWheelAxis,
  wxSetKeyState,
  wxSetMouseButtons,
} from './wx_event.js';

/**
 * One wheel notch in `WheelEvent.deltaY` pixels: Chrome reports a notch as
 * 100 px (`DOM_DELTA_PIXEL`), Firefox as 3 lines (`DOM_DELTA_LINE`), and a
 * page as one page. GTK's smooth-scroll delta of 1.0 is that same notch.
 */
const WHEEL_NOTCH_PX = 100;

/** deltaY/deltaX in notches, whatever unit the browser reported them in. */
function toNotches(aDelta: number, aDeltaMode: number): number {
  if (aDeltaMode === 1) return aDelta / 3; // 3 lines = 1 notch
  if (aDeltaMode === 2) return aDelta;
  return aDelta / WHEEL_NOTCH_PX;
}

/** The DOM's `buttons` mask into the wxMouseState button flags. */
function setButtonState(aEvent: wxMouseEvent, aButtons: number): void {
  aEvent.state.SetLeftDown((aButtons & 1) !== 0);
  aEvent.state.SetRightDown((aButtons & 2) !== 0);
  aEvent.state.SetMiddleDown((aButtons & 4) !== 0);
  aEvent.state.SetAux1Down((aButtons & 8) !== 0);
  aEvent.state.SetAux2Down((aButtons & 16) !== 0);
}

function setModifiers(
  aEvent: wxMouseEvent | wxKeyEvent,
  aDom: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean },
): void {
  aEvent.state.SetControlDown(aDom.ctrlKey);
  aEvent.state.SetShiftDown(aDom.shiftKey);
  aEvent.state.SetAltDown(aDom.altKey);
  aEvent.state.SetMetaDown(aDom.metaKey);
  // On GTK WXK_RAW_CONTROL is WXK_CONTROL
  aEvent.state.SetRawControlDown(aDom.ctrlKey);
  KIPLATFORM_UI.RecordModifierState(aDom);
}

/**
 * The client-relative position of a DOM mouse event in the window `aTarget`,
 * in logical pixels (`wxMouseEvent::GetX()`/`GetY()`).
 */
export function clientPosition(
  aTarget: HTMLElement,
  aDom: { clientX: number; clientY: number },
): { x: number; y: number } {
  const rect = aTarget.getBoundingClientRect();
  return { x: Math.trunc(aDom.clientX - rect.left), y: Math.trunc(aDom.clientY - rect.top) };
}

const BUTTON_DOWN: readonly wxEventType[] = [
  wxEVT_LEFT_DOWN,
  wxEVT_MIDDLE_DOWN,
  wxEVT_RIGHT_DOWN,
  wxEVT_AUX1_DOWN,
  wxEVT_AUX2_DOWN,
];
const BUTTON_UP: readonly wxEventType[] = [
  wxEVT_LEFT_UP,
  wxEVT_MIDDLE_UP,
  wxEVT_RIGHT_UP,
  wxEVT_AUX1_UP,
  wxEVT_AUX2_UP,
];
const BUTTON_DCLICK: readonly wxEventType[] = [
  wxEVT_LEFT_DCLICK,
  wxEVT_MIDDLE_DCLICK,
  wxEVT_RIGHT_DCLICK,
  wxEVT_AUX1_DCLICK,
  wxEVT_AUX2_DCLICK,
];

/**
 * A `wxMouseEvent` from a DOM pointer event. `aKind` is what happened:
 * a press (the second press of a double click is the DCLICK, as GTK sends
 * `GDK_2BUTTON_PRESS` in place of the second `GDK_BUTTON_PRESS`), a release,
 * a move, or the pointer entering / leaving the window.
 */
export function wxMouseEventFromDom(
  aTarget: HTMLElement,
  aDom: PointerEvent | MouseEvent,
  aKind: 'down' | 'up' | 'move' | 'enter' | 'leave',
): wxMouseEvent {
  let type: wxEventType;
  const button = Math.min(Math.max(aDom.button, 0), 4);

  switch (aKind) {
    case 'down':
      type = aDom.detail === 2 ? BUTTON_DCLICK[button]! : BUTTON_DOWN[button]!;
      break;
    case 'up':
      type = BUTTON_UP[button]!;
      break;
    case 'move':
      type = wxEVT_MOTION;
      break;
    case 'enter':
      type = wxEVT_ENTER_WINDOW;
      break;
    case 'leave':
      type = wxEVT_LEAVE_WINDOW;
      break;
  }

  const ev = new wxMouseEvent(type);
  const pos = clientPosition(aTarget, aDom);
  ev.SetX(pos.x);
  ev.SetY(pos.y);
  ev.SetTimestamp(aDom.timeStamp);

  // The button state AFTER the event, as wx reports it: a press has the
  // button down, a release has it up.
  setButtonState(ev, aDom.buttons);
  setModifiers(ev, aDom);

  if (aKind === 'down') ev.m_clickCount = aDom.detail === 2 ? 2 : 1;
  else if (aKind === 'up') ev.m_clickCount = 1;

  KIPLATFORM_UI.SetMousePosition(aDom.pageX, aDom.pageY);

  return ev;
}

/**
 * A `wxEVT_MOUSEWHEEL` event from a DOM wheel event: one notch is a rotation
 * of 120; a horizontal delta is a horizontal-axis event, as GTK reports a
 * tilt wheel or a two-finger horizontal scroll.
 */
export function wxWheelEventFromDom(aTarget: HTMLElement, aDom: WheelEvent): wxMouseEvent {
  const ev = new wxMouseEvent(wxEVT_MOUSEWHEEL);
  const pos = clientPosition(aTarget, aDom);
  ev.SetX(pos.x);
  ev.SetY(pos.y);
  ev.SetTimestamp(aDom.timeStamp);
  setButtonState(ev, aDom.buttons);
  setModifiers(ev, aDom);

  const dx = toNotches(aDom.deltaX, aDom.deltaMode);
  const dy = toNotches(aDom.deltaY, aDom.deltaMode);

  if (dy === 0 && dx !== 0) {
    // GDK_SCROLL_SMOOTH with delta_x: event.m_wheelRotation = int( delta_x * 120 )
    ev.m_wheelAxis = wxMouseWheelAxis.wxMOUSE_WHEEL_HORIZONTAL;
    ev.m_wheelRotation = Math.trunc(dx * 120);
  } else {
    // event.m_wheelRotation = int( -delta_y * 120 )
    ev.m_wheelAxis = wxMouseWheelAxis.wxMOUSE_WHEEL_VERTICAL;
    ev.m_wheelRotation = Math.trunc(-dy * 120);
  }

  ev.m_wheelDelta = 120;

  KIPLATFORM_UI.SetMousePosition(aDom.pageX, aDom.pageY);

  return ev;
}

/** `KeyboardEvent.key` names that are `WXK_*` codes. */
const NAMED_KEYS: Readonly<Record<string, WXK>> = {
  Backspace: WXK.WXK_BACK,
  Tab: WXK.WXK_TAB,
  Enter: WXK.WXK_RETURN,
  Escape: WXK.WXK_ESCAPE,
  ' ': WXK.WXK_SPACE,
  Delete: WXK.WXK_DELETE,
  Clear: WXK.WXK_CLEAR,
  Shift: WXK.WXK_SHIFT,
  Alt: WXK.WXK_ALT,
  Control: WXK.WXK_CONTROL,
  ContextMenu: WXK.WXK_MENU,
  Pause: WXK.WXK_PAUSE,
  CapsLock: WXK.WXK_CAPITAL,
  End: WXK.WXK_END,
  Home: WXK.WXK_HOME,
  ArrowLeft: WXK.WXK_LEFT,
  ArrowUp: WXK.WXK_UP,
  ArrowRight: WXK.WXK_RIGHT,
  ArrowDown: WXK.WXK_DOWN,
  Select: WXK.WXK_SELECT,
  Print: WXK.WXK_PRINT,
  Execute: WXK.WXK_EXECUTE,
  PrintScreen: WXK.WXK_SNAPSHOT,
  Insert: WXK.WXK_INSERT,
  Help: WXK.WXK_HELP,
  NumLock: WXK.WXK_NUMLOCK,
  ScrollLock: WXK.WXK_SCROLL,
  PageUp: WXK.WXK_PAGEUP,
  PageDown: WXK.WXK_PAGEDOWN,
  Meta: WXK.WXK_WINDOWS_LEFT,
  OS: WXK.WXK_WINDOWS_LEFT,
};

/** The numpad's `KeyboardEvent.code` names, when `location` is the numpad. */
const NUMPAD_CODES: Readonly<Record<string, WXK>> = {
  Numpad0: WXK.WXK_NUMPAD0,
  Numpad1: WXK.WXK_NUMPAD1,
  Numpad2: WXK.WXK_NUMPAD2,
  Numpad3: WXK.WXK_NUMPAD3,
  Numpad4: WXK.WXK_NUMPAD4,
  Numpad5: WXK.WXK_NUMPAD5,
  Numpad6: WXK.WXK_NUMPAD6,
  Numpad7: WXK.WXK_NUMPAD7,
  Numpad8: WXK.WXK_NUMPAD8,
  Numpad9: WXK.WXK_NUMPAD9,
  NumpadEnter: WXK.WXK_NUMPAD_ENTER,
  NumpadMultiply: WXK.WXK_NUMPAD_MULTIPLY,
  NumpadAdd: WXK.WXK_NUMPAD_ADD,
  NumpadSubtract: WXK.WXK_NUMPAD_SUBTRACT,
  NumpadDecimal: WXK.WXK_NUMPAD_DECIMAL,
  NumpadDivide: WXK.WXK_NUMPAD_DIVIDE,
  NumpadEqual: WXK.WXK_NUMPAD_EQUAL,
  NumpadComma: WXK.WXK_NUMPAD_SEPARATOR,
};

/**
 * `wxKeyEvent::m_keyCode` for a DOM keyboard event: `WXK_*` for the named
 * keys, the function keys and the numpad; the upper-cased character code for
 * a printable key (wx reports letters as their upper-case ASCII, whatever
 * the shift state).
 */
export function wxKeyCodeFromDom(aDom: KeyboardEvent): number {
  const key = aDom.key;

  if (aDom.location === 3) {
    const np = NUMPAD_CODES[aDom.code];

    if (np !== undefined) return np;
  }

  const named = NAMED_KEYS[key];

  if (named !== undefined) return named;

  const fn = /^F(\d{1,2})$/.exec(key);

  if (fn) {
    const n = Number(fn[1]);

    if (n >= 1 && n <= 24) return WXK.WXK_F1 + (n - 1);
  }

  if ([...key].length === 1) {
    const cp = key.codePointAt(0)!;

    // wx reports an ASCII letter as its upper-case code
    if (cp < 128) return key.toUpperCase().codePointAt(0)!;

    return cp;
  }

  return WXK.WXK_NONE;
}

/**
 * A `wxKeyEvent` from a DOM keyboard event. `wxEVT_CHAR` carries the
 * character (`GetUnicodeKey`), `wxEVT_KEY_DOWN`/`wxEVT_CHAR_HOOK` the key.
 */
export function wxKeyEventFromDom(
  aTarget: HTMLElement,
  aDom: KeyboardEvent,
  aType: wxEventType,
  aMousePos: { x: number; y: number },
): wxKeyEvent {
  const ev = new wxKeyEvent(aType);
  ev.m_keyCode = wxKeyCodeFromDom(aDom);
  ev.m_rawCode = aDom.keyCode;
  ev.m_isRepeat = aDom.repeat;
  ev.m_x = aMousePos.x;
  ev.m_y = aMousePos.y;
  ev.SetTimestamp(aDom.timeStamp);
  setModifiers(ev, aDom);

  if (aType === wxEVT_CHAR || aType === wxEVT_KEY_DOWN || aType === wxEVT_KEY_UP) {
    // GetUnicodeKey(): the printable character, else WXK_NONE
    ev.m_uniChar = [...aDom.key].length === 1 ? aDom.key.codePointAt(0)! : WXK.WXK_NONE;
  }

  void aTarget;

  return ev;
}

/**
 * The display server's view of the pointer buttons and the keys, which
 * `wxGetMouseState` and `wxGetKeyState` answer from on GTK. Watched at the
 * window, capture phase, so an up that lands outside the canvas - or on
 * something that stops propagation - still clears the state; TOOL_DISPATCHER
 * relies on that to end a drag whose button-up it never received.
 */
if (typeof window !== 'undefined') {
  const buttons = (e: PointerEvent | MouseEvent): void => wxSetMouseButtons(e.buttons);

  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel'] as const)
    window.addEventListener(type, buttons, { capture: true, passive: true });

  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => wxSetKeyState(wxKeyCodeFromDom(e), true),
    { capture: true, passive: true },
  );
  window.addEventListener(
    'keyup',
    (e: KeyboardEvent) => wxSetKeyState(wxKeyCodeFromDom(e), false),
    { capture: true, passive: true },
  );
  // A button released after the page lost focus never sends its pointerup.
  window.addEventListener('blur', () => wxSetMouseButtons(0));
}
