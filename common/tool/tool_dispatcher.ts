// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/tool_dispatcher.h` + `.cpp`: `TOOL_DISPATCHER`, which turns
 * the canvas's wx events into TOOL_EVENTs for the TOOL_MANAGER - clicks
 * versus drags by the system drag threshold, double clicks, the motion
 * events, the key events and ESC as the cancel command.
 *
 * Built for wxGTK, as the installed KiCad is: the `__APPLE__` and `_WIN32`
 * branches are not here, and `CAN_USE_ALTGR_KEY` is unset upstream.
 * The `wxEVT_MENU_*` branch forwards native menu events to ACTION_MENU;
 * our menus are drawn by `action_menu_bar.tsx` and send no such events, so
 * that branch has nothing to receive.
 */

import { WXK } from '@ziroeda/core/wx_keycodes.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import type { VIEW } from '../view/view.js';
import { WX_VIEW_CONTROLS } from '../view/wx_view_controls.js';
import { KIUI_IsInputControlEditable, KIUI_IsInputControlFocused } from '../widgets/ui_common.js';
import {
  type wxEvent,
  wxEVT_AUX1_DCLICK,
  wxEVT_AUX1_DOWN,
  wxEVT_AUX1_UP,
  wxEVT_AUX2_DCLICK,
  wxEVT_AUX2_DOWN,
  wxEVT_AUX2_UP,
  wxEVT_CHAR,
  wxEVT_CHAR_HOOK,
  wxEVT_LEFT_DCLICK,
  wxEVT_LEFT_DOWN,
  wxEVT_LEFT_UP,
  wxEVT_MAGNIFY,
  wxEVT_MIDDLE_DCLICK,
  wxEVT_MIDDLE_DOWN,
  wxEVT_MIDDLE_UP,
  wxEVT_MOTION,
  wxEVT_MOUSEWHEEL,
  wxEVT_RIGHT_DCLICK,
  wxEVT_RIGHT_DOWN,
  wxEVT_RIGHT_UP,
  type wxEventType,
  wxGetKeyState,
  wxGetMouseState,
  type wxKeyboardState,
  wxKeyEvent,
  type wxMouseEvent,
  wxMOD_ALT,
  wxMOD_CONTROL,
  wxMOD_META,
  wxMOD_SHIFT,
  wxMOD_WIN,
} from '../wx/wx_event.js';
import {
  AS_GLOBAL,
  BUT_AUX1,
  BUT_AUX2,
  BUT_LEFT,
  BUT_MIDDLE,
  BUT_RIGHT,
  MD_ALT,
  MD_CTRL,
  MD_META,
  MD_MODIFIER_MASK,
  MD_SHIFT,
  MD_SUPER,
  TA_CANCEL_TOOL,
  TA_KEY_PRESSED,
  TA_MOUSE_CLICK,
  TA_MOUSE_DBLCLICK,
  TA_MOUSE_DOWN,
  TA_MOUSE_DRAG,
  TA_MOUSE_MOTION,
  TA_MOUSE_UP,
  TA_MOUSE_WHEEL,
  TC_COMMAND,
  TC_KEYBOARD,
  TC_MOUSE,
  TOOL_EVENT,
  type TOOL_MOUSE_BUTTONS,
} from './tool_event.js';
import type { TOOL_MANAGER } from './tool_manager.js';

/** `wxGetLocalTimeMillis()`. */
function wxGetLocalTimeMillis(): number {
  return Date.now();
}

/**
 * `wxSystemSettings::GetMetric( wxSYS_DRAG_X / wxSYS_DRAG_Y )`. wxGTK
 * answers both from the one `gtk-dnd-drag-threshold` setting, whose
 * default is 8 (GtkSettings); the platform has no other answer to give.
 */
const wxSYS_DRAG = 8;

/** `std::popcount`. */
function popcount(aBits: number): number {
  let n = 0;

  for (let v = aBits >>> 0; v; v &= v - 1) n++;

  return n;
}

/// Store information about a mouse button state.
class BUTTON_STATE {
  /// Flag indicating that dragging is active for the given button.
  dragging = false;

  /// Flag indicating that the given button is pressed.
  pressed = false;

  /// Point where dragging has started (in world coordinates).
  dragOrigin: VECTOR2D = { x: 0, y: 0 };

  /// Point where dragging has started (in screen coordinates).
  dragOriginScreen: VECTOR2D = { x: 0, y: 0 };

  /// Point where click event has occurred.
  downPosition: VECTOR2D = { x: 0, y: 0 };

  /// Time stamp for the last mouse button press event.
  downTimestamp = 0;

  constructor(
    /// Determines the mouse button for which information are stored.
    readonly button: TOOL_MOUSE_BUTTONS,
    /// The type of wxEvent that determines mouse button press.
    readonly downEvent: wxEventType,
    /// The type of wxEvent that determines mouse button release.
    readonly upEvent: wxEventType,
    /// The type of wxEvent that determines mouse button double click.
    readonly dblClickEvent: wxEventType,
  ) {}

  /// Restores initial state.
  Reset(): void {
    this.dragging = false;
    this.pressed = false;
  }

  /// Checks the current state of the button.
  GetState(): boolean {
    const mouseState = wxGetMouseState();

    switch (this.button) {
      case BUT_LEFT:
        return mouseState.LeftIsDown();

      case BUT_MIDDLE:
        return mouseState.MiddleIsDown();

      case BUT_RIGHT:
        return mouseState.RightIsDown();

      case BUT_AUX1:
        return mouseState.Aux1IsDown();

      case BUT_AUX2:
        return mouseState.Aux2IsDown();

      default:
        console.assert(false, 'unknown button');
        return false;
    }
  }
}

/**
 * Helper to know if a special key ( see key list ) should be captured.
 *
 * If the event can be skipped on Linux, the event must be passed to the GUI if they are not
 * used by KiCad, especially the wxEVENT_CHAR_HOOK, if it is not handled.  Some keys have a
 * predefined action in wxWidgets so, even if not used, the even will be not skipped the unused
 * keys listed in isKeySpecialCode() will be not skipped.
 */
export function isKeySpecialCode(aKeyCode: number): boolean {
  // These keys have predefined actions (like move thumbtrack cursor),
  // and we do not want these actions executed
  const special_keys = [
    WXK.WXK_PAGEUP,
    WXK.WXK_PAGEDOWN,
    WXK.WXK_NUMPAD_PAGEUP,
    WXK.WXK_NUMPAD_PAGEDOWN,
  ];

  return special_keys.includes(aKeyCode);
}

/**
 * Helper to know if a key should be managed by DispatchWxEvent() or if the event can be ignored
 * and skipped because the key is only a modifier that is not used alone in KiCad.
 */
function isKeyModifierOnly(aKeyCode: number): boolean {
  // wxGTK: WXK_RAW_CONTROL and WXK_COMMAND are WXK_CONTROL; there is no WXK_META.
  const special_keys = [
    WXK.WXK_CONTROL,
    WXK.WXK_RAW_CONTROL,
    WXK.WXK_SHIFT,
    WXK.WXK_ALT,
    WXK.WXK_WINDOWS_LEFT,
    WXK.WXK_WINDOWS_RIGHT,
    WXK.WXK_MENU,
    WXK.WXK_COMMAND,
  ];

  return special_keys.includes(aKeyCode);
}

function isMouseClick(type: wxEventType): boolean {
  return (
    type === wxEVT_LEFT_DOWN ||
    type === wxEVT_LEFT_UP ||
    type === wxEVT_LEFT_DCLICK ||
    type === wxEVT_MIDDLE_DOWN ||
    type === wxEVT_MIDDLE_UP ||
    type === wxEVT_MIDDLE_DCLICK ||
    type === wxEVT_RIGHT_DOWN ||
    type === wxEVT_RIGHT_UP ||
    type === wxEVT_RIGHT_DCLICK ||
    type === wxEVT_AUX1_DOWN ||
    type === wxEVT_AUX1_UP ||
    type === wxEVT_AUX1_DCLICK ||
    type === wxEVT_AUX2_DOWN ||
    type === wxEVT_AUX2_UP ||
    type === wxEVT_AUX2_DCLICK
  );
}

/**
 * Convert some special key codes to an equivalent.
 *
 *  - WXK_NUMPAD_UP to WXK_UP
 *  - WXK_NUMPAD_DOWN to WXK_DOWN
 *  - WXK_NUMPAD_LEFT to WXK_LEFT
 *  - WXK_NUMPAD_RIGHT to WXK_RIGHT
 *  - WXK_NUMPAD_PAGEUP to WXK_PAGEUP
 *  - WXK_NUMPAD_PAGEDOWN to WXK_PAGEDOWN
 *
 * @note wxEVT_CHAR_HOOK does this conversion when it is skipped by firing a wxEVT_CHAR
 *       with this converted code, but we do not skip these key events because they also
 *       have default action (scroll the panel).
 */
export function translateSpecialCode(aKeyCode: number): number {
  switch (aKeyCode) {
    case WXK.WXK_NUMPAD_UP:
      return WXK.WXK_UP;
    case WXK.WXK_NUMPAD_DOWN:
      return WXK.WXK_DOWN;
    case WXK.WXK_NUMPAD_LEFT:
      return WXK.WXK_LEFT;
    case WXK.WXK_NUMPAD_RIGHT:
      return WXK.WXK_RIGHT;
    case WXK.WXK_NUMPAD_PAGEUP:
      return WXK.WXK_PAGEUP;
    case WXK.WXK_NUMPAD_PAGEDOWN:
      return WXK.WXK_PAGEDOWN;
    default:
      break;
  }

  return aKeyCode;
}

/** The focus holder, as the canvas's `HasFocus` / `SetFocus` reach it. */
interface FOCUSABLE {
  HasFocus(): boolean;
  SetFocus(): void;
}

function isFocusable(aWindow: unknown): aWindow is FOCUSABLE {
  return (
    aWindow !== null &&
    typeof aWindow === 'object' &&
    typeof (aWindow as FOCUSABLE).HasFocus === 'function' &&
    typeof (aWindow as FOCUSABLE).SetFocus === 'function'
  );
}

/**
 * - takes wx events,
 * - fixes all wx quirks (mouse warping, panning, ordering problems, etc)
 * - translates coordinates to world space
 * - low-level input conditioning (drag/click threshold), updating mouse position during
 *   view auto-scroll/pan.
 * - issues TOOL_EVENTS to the tool manager
 */
export class TOOL_DISPATCHER {
  /// The maximum gap (ms) between two events of the same key for them to count as one OS
  /// auto-repeat burst rather than two deliberate key presses.
  static readonly AutoRepeatWindowMs = 250;

  /// The time threshold for a mouse button press that distinguishes between a single mouse
  /// click and a beginning of drag event (expressed in milliseconds).
  static readonly DragTimeThreshold = 300;

  /// The distance threshold for mouse cursor that distinguishes between a single mouse click
  /// and a beginning of drag event (expressed in screen pixels).
  /// System drag preferences take precedence if available
  static readonly DragDistanceThreshold = 8;

  private m_sysDragMinX: number; ///< Minimum distance before drag is activated in the X axis
  private m_sysDragMinY: number; ///< Maximum distance before drag is activated in the Y axis

  private m_lastMousePos: VECTOR2D = { x: 0, y: 0 }; ///< The last mouse cursor position (in world coordinates).
  private m_lastMousePosScreen: VECTOR2D = { x: 0, y: 0 }; ///< The last mouse cursor position (in screen coordinates).

  /// State of mouse buttons.
  private m_buttons: BUTTON_STATE[] = [];

  /// Key code of the key that was last processed, or 0 when no key is armed.
  private m_lastKeyCode: number;

  /// Local time (ms) at which m_lastKeyCode was last processed.
  private m_lastKeyTime: number;

  /// Instance of tool manager that cooperates with the dispatcher.
  private m_toolMgr: TOOL_MANAGER;

  constructor(aToolMgr: TOOL_MANAGER) {
    this.m_lastKeyCode = 0;
    this.m_lastKeyTime = 0;
    this.m_toolMgr = aToolMgr;

    this.m_sysDragMinX = wxSYS_DRAG;
    this.m_sysDragMinY = wxSYS_DRAG;

    this.m_sysDragMinX =
      this.m_sysDragMinX !== -1 ? this.m_sysDragMinX : TOOL_DISPATCHER.DragDistanceThreshold;
    this.m_sysDragMinY =
      this.m_sysDragMinY !== -1 ? this.m_sysDragMinY : TOOL_DISPATCHER.DragDistanceThreshold;

    this.m_buttons.push(
      new BUTTON_STATE(BUT_LEFT, wxEVT_LEFT_DOWN, wxEVT_LEFT_UP, wxEVT_LEFT_DCLICK),
    );
    this.m_buttons.push(
      new BUTTON_STATE(BUT_RIGHT, wxEVT_RIGHT_DOWN, wxEVT_RIGHT_UP, wxEVT_RIGHT_DCLICK),
    );
    this.m_buttons.push(
      new BUTTON_STATE(BUT_MIDDLE, wxEVT_MIDDLE_DOWN, wxEVT_MIDDLE_UP, wxEVT_MIDDLE_DCLICK),
    );
    this.m_buttons.push(
      new BUTTON_STATE(BUT_AUX1, wxEVT_AUX1_DOWN, wxEVT_AUX1_UP, wxEVT_AUX1_DCLICK),
    );
    this.m_buttons.push(
      new BUTTON_STATE(BUT_AUX2, wxEVT_AUX2_DOWN, wxEVT_AUX2_UP, wxEVT_AUX2_DCLICK),
    );

    this.ResetState();
  }

  /**
   * Returns the state of key modifiers (Alt, Ctrl and so on) as OR'ed list
   * of bits (MD_CTRL, MD_ALT ...)
   */
  private static decodeModifiers(aState: wxKeyboardState): number {
    let mods = 0;
    const wxmods = aState.GetModifiers();

    // Returns the state of key modifiers (Alt, Ctrl and so on). Be carefull:
    // the flag wxMOD_ALTGR is defined in wxWidgets as wxMOD_CONTROL|wxMOD_ALT
    // So AltGr key cannot used as modifier key because it is the same as Alt key + Ctrl key.
    if (wxmods & wxMOD_CONTROL) mods |= MD_CTRL;

    if (wxmods & wxMOD_ALT) mods |= MD_ALT;

    if (wxmods & wxMOD_SHIFT) mods |= MD_SHIFT;

    if (wxmods & wxMOD_META) mods |= MD_META;

    if (wxmods & wxMOD_WIN) mods |= MD_SUPER;

    return mods;
  }

  /// Bring the dispatcher to its initial state.
  ResetState(): void {
    for (const st of this.m_buttons) st.Reset();

    this.m_lastKeyCode = 0;
    this.m_lastKeyTime = 0;
  }

  /// Returns the instance of VIEW, used by the application.
  private getView(): VIEW | null {
    return this.m_toolMgr.GetView();
  }

  /// Handles mouse related events (click, motion, dragging).
  private handleMouseButton(aEvent: wxEvent, aIndex: number, aMotion: boolean): boolean {
    const st = this.m_buttons[aIndex]!;
    const type = aEvent.GetEventType();
    let evt: TOOL_EVENT | null = null;
    let isClick = false;

    let up = false;
    let down = false;
    const dblClick = type === st.dblClickEvent;
    const state = st.GetState();

    if (!dblClick) {
      // Sometimes the dispatcher does not receive mouse button up event, so it stays
      // in the dragging mode even if the mouse button is not held anymore
      if (st.pressed && !state) up = true;
      // Don't apply same logic to down events as it kills touchpad tapping
      else if (!st.pressed && type === st.downEvent) down = true;
    }

    const mods = TOOL_DISPATCHER.decodeModifiers((aEvent as wxMouseEvent).state);
    const args = st.button | mods;

    if (down) {
      // Handle mouse button press
      st.downTimestamp = wxGetLocalTimeMillis();

      if (!st.pressed) {
        // save the drag origin on the first click only
        st.dragOrigin = { ...this.m_lastMousePos };
        st.dragOriginScreen = { ...this.m_lastMousePosScreen };
      }

      st.downPosition = { ...this.m_lastMousePos };
      st.pressed = true;
      evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DOWN, args, AS_GLOBAL);
    } else if (up) {
      // Handle mouse button release
      st.pressed = false;

      if (st.dragging) evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_UP, args, AS_GLOBAL);
      else isClick = true;

      if (isClick) evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_CLICK, args, AS_GLOBAL);

      st.dragging = false;
    } else if (dblClick) {
      evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DBLCLICK, args, AS_GLOBAL);
    }

    if (st.pressed && aMotion) {
      if (!st.dragging) {
        const offset = {
          x: this.m_lastMousePosScreen.x - st.dragOriginScreen.x,
          y: this.m_lastMousePosScreen.y - st.dragOriginScreen.y,
        };

        if (Math.abs(offset.x) > this.m_sysDragMinX || Math.abs(offset.y) > this.m_sysDragMinY)
          st.dragging = true;
      }

      if (st.dragging) {
        evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_DRAG, args, AS_GLOBAL);
        evt.setMouseDragOrigin(st.dragOrigin);
        evt.setMouseDelta({
          x: this.m_lastMousePos.x - st.dragOrigin.x,
          y: this.m_lastMousePos.y - st.dragOrigin.y,
        });
      }
    }

    if (evt) {
      evt.SetMousePosition(isClick ? st.downPosition : this.m_lastMousePos);
      this.m_toolMgr.ProcessEvent(evt);

      return true;
    }

    return false;
  }

  /**
   * Map a wxKeyEvent to a TOOL_EVENT.
   *
   * @param aKeyEvent is the wxKeyEvent to be mapped.
   * @return the TOOL_EVENT, or null for a modifier-only key; and whether the
   *         key is a special one (the C++'s `aSpecialKeyFlag` out-parameter).
   */
  GetToolEvent(aKeyEvent: wxKeyEvent): { evt: TOOL_EVENT | null; keyIsSpecial: boolean } {
    let evt: TOOL_EVENT | null = null;
    let key = aKeyEvent.GetKeyCode();

    // This wxEVT_CHAR_HOOK event can be ignored: not useful in KiCad
    if (isKeyModifierOnly(key)) {
      aKeyEvent.Skip();
      return { evt, keyIsSpecial: false };
    }

    // if the key event must be skipped, skip it here if the event is a wxEVT_CHAR_HOOK
    // and do nothing.
    const keyIsSpecial = isKeySpecialCode(key);

    if (aKeyEvent.GetEventType() === wxEVT_CHAR_HOOK) key = translateSpecialCode(key);

    const mods = TOOL_DISPATCHER.decodeModifiers(aKeyEvent.state);

    if (mods & MD_CTRL) {
      // wxWidgets maps key codes related to Ctrl+letter handled by CHAR_EVT
      // (http://docs.wxwidgets.org/trunk/classwx_key_event.html):
      // char events for ASCII letters in this case carry codes corresponding to the ASCII
      // value of Ctrl-Latter, i.e. 1 for Ctrl-A, 2 for Ctrl-B and so on until 26 for Ctrl-Z.
      // They are remapped here to be more easy to handle in code
      if (key >= WXK.WXK_CONTROL_A && key <= WXK.WXK_CONTROL_Z) key += 'A'.charCodeAt(0) - 1;
    }

    if (key === WXK.WXK_ESCAPE)
      // ESC is the special key for canceling tools
      evt = new TOOL_EVENT(TC_COMMAND, TA_CANCEL_TOOL, WXK.WXK_ESCAPE, AS_GLOBAL);
    else evt = new TOOL_EVENT(TC_KEYBOARD, TA_KEY_PRESSED, key | mods, AS_GLOBAL);

    return { evt, keyIsSpecial };
  }

  /**
   * Processes any pending mouse clicks that have been physically completed but not yet
   * dispatched. This ensures clicks are processed before cancel events when both happen
   * in quick succession.
   */
  private flushPendingClicks(): void {
    // When an escape key event arrives, keyboard events can be processed before mouse button
    // events due to wxWidgets event queue ordering. If a mouse button was pressed and has since
    // been released (detected via polling), we need to process that click before handling the
    // escape to maintain proper event ordering.
    for (const st of this.m_buttons) {
      if (st.pressed && !st.GetState()) {
        st.pressed = false;

        const clickEvt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_CLICK, st.button, AS_GLOBAL);
        clickEvt.SetMousePosition(st.downPosition);
        this.m_toolMgr.ProcessEvent(clickEvt);

        st.dragging = false;
      }
    }
  }

  /**
   * Decide whether a key event is a backlogged OS auto-repeat. The first
   * event of a burst always runs; later ones only while the key is held.
   * `aLast` is the C++'s pair of in/out references.
   */
  static ShouldDropAutoRepeat(
    aKeyCode: number,
    aNowMs: number,
    aKeyIsDown: boolean,
    aLast: { key: number; timeMs: number },
  ): boolean {
    const sameBurst =
      aKeyCode === aLast.key && aNowMs - aLast.timeMs < TOOL_DISPATCHER.AutoRepeatWindowMs;

    aLast.key = aKeyCode;
    aLast.timeMs = aNowMs;

    return sameBurst && !aKeyIsDown;
  }

  /**
   * Decide whether a keyboard event must be dropped because it is a backlogged OS key
   * auto-repeat event delivered after the key was physically released.
   */
  private isStaleAutoRepeat(aKeyEvent: wxKeyEvent): boolean {
    const key = aKeyEvent.GetKeyCode();

    // wxGetKeyState answers reliably for letters, digits and the named WXK_ codes used as
    // hotkeys; modifier-only keys never reach here.
    const keyIsDown = wxGetKeyState(key);
    const last = { key: this.m_lastKeyCode, timeMs: this.m_lastKeyTime };
    const drop = TOOL_DISPATCHER.ShouldDropAutoRepeat(key, wxGetLocalTimeMillis(), keyIsDown, last);

    this.m_lastKeyCode = last.key;
    this.m_lastKeyTime = last.timeMs;

    return drop;
  }

  /**
   * Process wxEvents (mostly UI events), translate them to TOOL_EVENTs, and make tools
   * handle those.
   *
   * @param aEvent is the wxWidgets event to be processed.
   */
  DispatchWxEvent(aEvent: wxEvent): void {
    let motion = false;
    let buttonEvents = false;
    let pos: VECTOR2D = { x: 0, y: 0 };
    let evt: TOOL_EVENT | null = null;
    let keyIsEscape = false; // True if the keypress was the escape key
    let keyIsSpecial = false; // True if the key is a special key code
    let droppedStaleAutoRepeat = false; // True if a backlogged repeat was discarded
    const focus = typeof document !== 'undefined' ? document.activeElement : null;

    const type = aEvent.GetEventType();

    // Sometimes there is no window that has the focus (it happens when another PCB_BASE_FRAME
    // is opened and is iconized on Windows). A page always has a focused element (the body at
    // least), so the C++'s "give the focus to the parent frame" has no case here.

    if (isMouseClick(type)) {
      const canvas = this.m_toolMgr.GetToolHolder()?.GetToolCanvas();

      if (isFocusable(canvas) && !canvas.HasFocus()) canvas.SetFocus();
    }

    // Mouse handling
    // Note: wxEVT_LEFT_DOWN event must always be skipped.
    if (
      type === wxEVT_MOTION ||
      type === wxEVT_MOUSEWHEEL ||
      type === wxEVT_MAGNIFY ||
      isMouseClick(type) ||
      // Event issued when mouse retains position in screen coordinates,
      // but changes in world coordinates (e.g. autopanning)
      type === WX_VIEW_CONTROLS.EVT_REFRESH_MOUSE
    ) {
      const me = aEvent as wxMouseEvent;
      const mods = TOOL_DISPATCHER.decodeModifiers(me.state);
      const viewControls = this.m_toolMgr.GetViewControls();

      if (viewControls) {
        pos = viewControls.GetMousePosition();
        this.m_lastMousePosScreen = viewControls.GetMousePosition(false);

        if (pos.x !== this.m_lastMousePos.x || pos.y !== this.m_lastMousePos.y) {
          motion = true;
          this.m_lastMousePos = pos;
        }
      }

      for (let i = 0; i < this.m_buttons.length; i++)
        buttonEvents = this.handleMouseButton(aEvent, i, motion) || buttonEvents;

      if (viewControls) {
        if (!buttonEvents && motion) {
          evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_MOTION, mods, AS_GLOBAL);
          evt.SetMousePosition(pos);
        }
      }

      // We only handle wheel events that aren't for the view control.
      // Events with zero or one modifier are reserved for view control.
      // When using WX_VIEW_CONTROLS, these will already be handled, but
      // we still shouldn't consume such events if we get them (e.g. for
      // when WX_VIEW_CONTROLS is not in use, like in the 3D viewer)
      if (!evt && me.GetWheelRotation() !== 0) {
        const modBits = mods & MD_MODIFIER_MASK;
        const shouldHandle = popcount(modBits) > 1;

        if (shouldHandle) {
          evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_WHEEL, mods, AS_GLOBAL);
          evt.SetParameter<number>(me.GetWheelRotation());
        }
      }
    } else if (type === wxEVT_CHAR_HOOK || type === wxEVT_CHAR) {
      const ke = aEvent as wxKeyEvent;

      // Do not process wxEVT_CHAR_HOOK for a shift-modified key, as ACTION_MANAGER::RunHotKey
      // will run the un-shifted key and that's not what we want.  Wait to get the translated
      // key from wxEVT_CHAR.
      // See https://gitlab.com/kicad/code/kicad/-/issues/1809
      if (type === wxEVT_CHAR_HOOK && ke.GetModifiers() === wxMOD_SHIFT) {
        aEvent.Skip();
        return;
      }

      keyIsEscape = ke.GetKeyCode() === WXK.WXK_ESCAPE;

      // When escape is pressed shortly after a mouse click, the keyboard event can be
      // processed before the mouse button release event. Flush any pending clicks first
      // to ensure proper event ordering.
      if (keyIsEscape) this.flushPendingClicks();

      if (KIUI_IsInputControlFocused(focus)) {
        const enabled = KIUI_IsInputControlEditable(focus);

        // Never process key events for tools when a text entry has focus
        if (enabled) {
          aEvent.Skip();
          return;
        }
        // Even if not enabled, allow a copy out
        else if (ke.GetModifiers() === wxMOD_CONTROL && ke.GetKeyCode() === 'C'.charCodeAt(0)) {
          aEvent.Skip();
          return;
        }
      }

      const result = this.GetToolEvent(ke);
      evt = result.evt;
      keyIsSpecial = result.keyIsSpecial;

      // Drop backlogged OS key auto-repeat events that arrive after the key was released so a
      // slow hotkey action (e.g. Rotate on a large selection) stops when the key is let go
      // instead of running the whole queued burst. Only ordinary hotkey presses are filtered;
      // cancel (escape) is always honoured.
      if (evt && !evt.IsCancel() && !keyIsEscape && this.isStaleAutoRepeat(ke)) {
        evt = null;
        droppedStaleAutoRepeat = true;
      }
    }

    let handled = false;

    if (evt) handled = this.m_toolMgr.ProcessEvent(evt);

    // pass the event to the GUI, it might still be interested in it
    // Note wxEVT_CHAR_HOOK event is already skipped for special keys not used by KiCad
    // and wxEVT_LEFT_DOWN must be always Skipped.

    // A dropped stale auto-repeat must be fully swallowed; skipping it would let wx menu
    // accelerators re-run the same hotkey after the key was released.
    if ((!evt && !droppedStaleAutoRepeat) || type === wxEVT_LEFT_DOWN) aEvent.Skip();

    // Not handled wxEVT_CHAR must be Skipped (sent to GUI).
    // Otherwise accelerators and shortcuts in main menu or toolbars are not seen.
    // Escape key presses are never skipped by the handler since they correspond to tool cancel
    // events, and if they aren't skipped then they are propagated to other frames (which we
    // don't want).
    if (
      (type === wxEVT_CHAR || type === wxEVT_CHAR_HOOK) &&
      !keyIsSpecial &&
      !handled &&
      !keyIsEscape &&
      !droppedStaleAutoRepeat
    ) {
      aEvent.Skip();
    }

    void this.getView;
  }
}
