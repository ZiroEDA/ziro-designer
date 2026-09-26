// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The wxWidgets event objects KiCad's canvas code handles, as far as it reads
 * them: `wxEvent` (type, `Skip()`, `StopPropagation()`), `wxMouseEvent`
 * (position, buttons, wheel, modifiers) and `wxTimer`. The draw panel makes
 * them from DOM events; the view controls and the tool dispatcher consume
 * them exactly as the C++ does.
 */

/** The `WXK_*` key codes, for the users of these events. */
export { WXK } from '@ziroeda/core/wx_keycodes.js';

/** `wxEventType`: an integer per event kind, `wxNewEventType()` allocates. */
export type wxEventType = number;

let s_nextEventType = 10000;

/** `wxNewEventType()`. */
export function wxNewEventType(): wxEventType {
  return s_nextEventType++;
}

export const wxEVT_NULL: wxEventType = 0;
export const wxEVT_LEFT_DOWN = wxNewEventType();
export const wxEVT_LEFT_UP = wxNewEventType();
export const wxEVT_LEFT_DCLICK = wxNewEventType();
export const wxEVT_MIDDLE_DOWN = wxNewEventType();
export const wxEVT_MIDDLE_UP = wxNewEventType();
export const wxEVT_MIDDLE_DCLICK = wxNewEventType();
export const wxEVT_RIGHT_DOWN = wxNewEventType();
export const wxEVT_RIGHT_UP = wxNewEventType();
export const wxEVT_RIGHT_DCLICK = wxNewEventType();
export const wxEVT_AUX1_DOWN = wxNewEventType();
export const wxEVT_AUX1_UP = wxNewEventType();
export const wxEVT_AUX1_DCLICK = wxNewEventType();
export const wxEVT_AUX2_DOWN = wxNewEventType();
export const wxEVT_AUX2_UP = wxNewEventType();
export const wxEVT_AUX2_DCLICK = wxNewEventType();
export const wxEVT_MOTION = wxNewEventType();
export const wxEVT_ENTER_WINDOW = wxNewEventType();
export const wxEVT_LEAVE_WINDOW = wxNewEventType();
export const wxEVT_MOUSEWHEEL = wxNewEventType();
export const wxEVT_MAGNIFY = wxNewEventType();
export const wxEVT_CHAR = wxNewEventType();
export const wxEVT_CHAR_HOOK = wxNewEventType();
export const wxEVT_KEY_DOWN = wxNewEventType();
export const wxEVT_KEY_UP = wxNewEventType();
export const wxEVT_TIMER = wxNewEventType();
export const wxEVT_SIZE = wxNewEventType();
export const wxEVT_PAINT = wxNewEventType();
export const wxEVT_IDLE = wxNewEventType();
export const wxEVT_KILL_FOCUS = wxNewEventType();
export const wxEVT_SET_FOCUS = wxNewEventType();
export const wxEVT_SHOW = wxNewEventType();
export const wxEVT_MOUSE_CAPTURE_LOST = wxNewEventType();
export const wxEVT_SCROLLWIN_TOP = wxNewEventType();
export const wxEVT_SCROLLWIN_BOTTOM = wxNewEventType();
export const wxEVT_SCROLLWIN_LINEUP = wxNewEventType();
export const wxEVT_SCROLLWIN_LINEDOWN = wxNewEventType();
export const wxEVT_SCROLLWIN_PAGEUP = wxNewEventType();
export const wxEVT_SCROLLWIN_PAGEDOWN = wxNewEventType();
export const wxEVT_SCROLLWIN_THUMBTRACK = wxNewEventType();
export const wxEVT_SCROLLWIN_THUMBRELEASE = wxNewEventType();
export const wxEVT_GESTURE_ZOOM = wxNewEventType();
export const wxEVT_GESTURE_PAN = wxNewEventType();

/** `wxMouseWheelAxis`. */
export enum wxMouseWheelAxis {
  wxMOUSE_WHEEL_VERTICAL = 0,
  wxMOUSE_WHEEL_HORIZONTAL = 1,
}

/** `wxOrientation`, the two the scroll events use. */
export enum wxOrientation {
  wxHORIZONTAL = 0x0004,
  wxVERTICAL = 0x0008,
}

/** `wxMouseButton`. */
export enum wxMouseButton {
  wxMOUSE_BTN_ANY = -1,
  wxMOUSE_BTN_NONE = 0,
  wxMOUSE_BTN_LEFT = 1,
  wxMOUSE_BTN_MIDDLE = 2,
  wxMOUSE_BTN_RIGHT = 3,
  wxMOUSE_BTN_AUX1 = 4,
  wxMOUSE_BTN_AUX2 = 5,
}

/**
 * `wxEvent`: the type, and the two flags the handlers set. A handler that
 * calls `Skip()` lets the next handler (the panel's `OnEvent`, i.e. the tool
 * dispatcher) see the event; one that does not consumes it.
 */
export class wxEvent {
  protected m_eventType: wxEventType;
  protected m_skipped = false;
  protected m_propagationLevel: number;
  /** `wxEvent::m_timeStamp` (ms). */
  protected m_timeStamp: number;

  constructor(aEventType: wxEventType = wxEVT_NULL, aPropagates = false) {
    this.m_eventType = aEventType;
    this.m_propagationLevel = aPropagates ? Number.MAX_SAFE_INTEGER : 0;
    this.m_timeStamp = 0;
  }

  GetEventType(): wxEventType {
    return this.m_eventType;
  }
  SetEventType(aType: wxEventType): void {
    this.m_eventType = aType;
  }

  Skip(aSkip = true): void {
    this.m_skipped = aSkip;
  }
  GetSkipped(): boolean {
    return this.m_skipped;
  }

  ShouldPropagate(): boolean {
    return this.m_propagationLevel !== 0;
  }
  StopPropagation(): number {
    const propagationLevelOld = this.m_propagationLevel;
    this.m_propagationLevel = 0;
    return propagationLevelOld;
  }
  ResumePropagation(aPropagationLevel: number): void {
    this.m_propagationLevel = aPropagationLevel;
  }

  GetTimestamp(): number {
    return this.m_timeStamp;
  }
  SetTimestamp(aTs: number): void {
    this.m_timeStamp = aTs;
  }
}

/** `wxKeyboardState`: the modifier flags. */
export class wxKeyboardState {
  protected m_controlDown = false;
  protected m_shiftDown = false;
  protected m_altDown = false;
  protected m_metaDown = false;
  protected m_rawControlDown = false;

  ControlDown(): boolean {
    return this.m_controlDown;
  }
  RawControlDown(): boolean {
    return this.m_rawControlDown;
  }
  ShiftDown(): boolean {
    return this.m_shiftDown;
  }
  AltDown(): boolean {
    return this.m_altDown;
  }
  MetaDown(): boolean {
    return this.m_metaDown;
  }
  HasAnyModifiers(): boolean {
    return this.m_controlDown || this.m_shiftDown || this.m_altDown || this.m_metaDown;
  }

  SetControlDown(down: boolean): void {
    this.m_controlDown = down;
  }
  SetRawControlDown(down: boolean): void {
    this.m_rawControlDown = down;
  }
  SetShiftDown(down: boolean): void {
    this.m_shiftDown = down;
  }
  SetAltDown(down: boolean): void {
    this.m_altDown = down;
  }
  SetMetaDown(down: boolean): void {
    this.m_metaDown = down;
  }
}

/** `wxMouseState`: the button states and the position. */
export class wxMouseState extends wxKeyboardState {
  protected m_leftDown = false;
  protected m_middleDown = false;
  protected m_rightDown = false;
  protected m_aux1Down = false;
  protected m_aux2Down = false;
  /** `m_x`, `m_y`: the position in the window's client coordinates. */
  protected m_x = 0;
  protected m_y = 0;

  GetX(): number {
    return this.m_x;
  }
  GetY(): number {
    return this.m_y;
  }
  GetPosition(): { x: number; y: number } {
    return { x: this.m_x, y: this.m_y };
  }

  LeftIsDown(): boolean {
    return this.m_leftDown;
  }
  MiddleIsDown(): boolean {
    return this.m_middleDown;
  }
  RightIsDown(): boolean {
    return this.m_rightDown;
  }
  Aux1IsDown(): boolean {
    return this.m_aux1Down;
  }
  Aux2IsDown(): boolean {
    return this.m_aux2Down;
  }

  SetX(x: number): void {
    this.m_x = x;
  }
  SetY(y: number): void {
    this.m_y = y;
  }
  SetPosition(pos: { x: number; y: number }): void {
    this.m_x = pos.x;
    this.m_y = pos.y;
  }
  SetLeftDown(down: boolean): void {
    this.m_leftDown = down;
  }
  SetMiddleDown(down: boolean): void {
    this.m_middleDown = down;
  }
  SetRightDown(down: boolean): void {
    this.m_rightDown = down;
  }
  SetAux1Down(down: boolean): void {
    this.m_aux1Down = down;
  }
  SetAux2Down(down: boolean): void {
    this.m_aux2Down = down;
  }
}

/**
 * `wxMouseEvent`: a `wxEvent` carrying a `wxMouseState`. The wx class
 * inherits both; here the state is composed in and the event API is the
 * union of the two, as the handlers call it.
 */
export class wxMouseEvent extends wxEvent {
  readonly state = new wxMouseState();

  /** `m_clickCount`: -1 for a non-click event. */
  m_clickCount = -1;
  /** `m_wheelAxis`. */
  m_wheelAxis: wxMouseWheelAxis = wxMouseWheelAxis.wxMOUSE_WHEEL_VERTICAL;
  /** `m_wheelRotation`: multiples of `m_wheelDelta`. */
  m_wheelRotation = 0;
  /** `m_wheelDelta`: one notch, 120. */
  m_wheelDelta = 120;
  /** `m_linesPerAction`. */
  m_linesPerAction = 3;
  /** `m_columnsPerAction`. */
  m_columnsPerAction = 3;
  /** `m_wheelInverted`. */
  m_wheelInverted = false;
  /** `m_magnification` (wxEVT_MAGNIFY). */
  m_magnification = 0;

  constructor(aEventType: wxEventType = wxEVT_NULL) {
    super(aEventType, true);
  }

  // wxMouseState pass-through
  GetX(): number {
    return this.state.GetX();
  }
  GetY(): number {
    return this.state.GetY();
  }
  GetPosition(): { x: number; y: number } {
    return this.state.GetPosition();
  }
  SetX(x: number): void {
    this.state.SetX(x);
  }
  SetY(y: number): void {
    this.state.SetY(y);
  }
  SetPosition(pos: { x: number; y: number }): void {
    this.state.SetPosition(pos);
  }
  LeftIsDown(): boolean {
    return this.state.LeftIsDown();
  }
  MiddleIsDown(): boolean {
    return this.state.MiddleIsDown();
  }
  RightIsDown(): boolean {
    return this.state.RightIsDown();
  }
  Aux1IsDown(): boolean {
    return this.state.Aux1IsDown();
  }
  Aux2IsDown(): boolean {
    return this.state.Aux2IsDown();
  }
  ControlDown(): boolean {
    return this.state.ControlDown();
  }
  RawControlDown(): boolean {
    return this.state.RawControlDown();
  }
  ShiftDown(): boolean {
    return this.state.ShiftDown();
  }
  AltDown(): boolean {
    return this.state.AltDown();
  }
  MetaDown(): boolean {
    return this.state.MetaDown();
  }
  SetControlDown(down: boolean): void {
    this.state.SetControlDown(down);
  }
  SetShiftDown(down: boolean): void {
    this.state.SetShiftDown(down);
  }
  SetAltDown(down: boolean): void {
    this.state.SetAltDown(down);
  }
  SetMetaDown(down: boolean): void {
    this.state.SetMetaDown(down);
  }

  // Is this a button event?
  IsButton(): boolean {
    return this.Button(wxMouseButton.wxMOUSE_BTN_ANY);
  }

  // Was it a down event from this (or any) button?
  ButtonDown(but: wxMouseButton = wxMouseButton.wxMOUSE_BTN_ANY): boolean {
    switch (but) {
      case wxMouseButton.wxMOUSE_BTN_ANY:
        return (
          this.m_eventType === wxEVT_LEFT_DOWN ||
          this.m_eventType === wxEVT_MIDDLE_DOWN ||
          this.m_eventType === wxEVT_RIGHT_DOWN ||
          this.m_eventType === wxEVT_AUX1_DOWN ||
          this.m_eventType === wxEVT_AUX2_DOWN
        );
      case wxMouseButton.wxMOUSE_BTN_LEFT:
        return this.m_eventType === wxEVT_LEFT_DOWN;
      case wxMouseButton.wxMOUSE_BTN_MIDDLE:
        return this.m_eventType === wxEVT_MIDDLE_DOWN;
      case wxMouseButton.wxMOUSE_BTN_RIGHT:
        return this.m_eventType === wxEVT_RIGHT_DOWN;
      case wxMouseButton.wxMOUSE_BTN_AUX1:
        return this.m_eventType === wxEVT_AUX1_DOWN;
      case wxMouseButton.wxMOUSE_BTN_AUX2:
        return this.m_eventType === wxEVT_AUX2_DOWN;
      default:
        return false;
    }
  }

  // Was it a double click event from this (or any) button?
  ButtonDClick(but: wxMouseButton = wxMouseButton.wxMOUSE_BTN_ANY): boolean {
    switch (but) {
      case wxMouseButton.wxMOUSE_BTN_ANY:
        return (
          this.m_eventType === wxEVT_LEFT_DCLICK ||
          this.m_eventType === wxEVT_MIDDLE_DCLICK ||
          this.m_eventType === wxEVT_RIGHT_DCLICK ||
          this.m_eventType === wxEVT_AUX1_DCLICK ||
          this.m_eventType === wxEVT_AUX2_DCLICK
        );
      case wxMouseButton.wxMOUSE_BTN_LEFT:
        return this.m_eventType === wxEVT_LEFT_DCLICK;
      case wxMouseButton.wxMOUSE_BTN_MIDDLE:
        return this.m_eventType === wxEVT_MIDDLE_DCLICK;
      case wxMouseButton.wxMOUSE_BTN_RIGHT:
        return this.m_eventType === wxEVT_RIGHT_DCLICK;
      case wxMouseButton.wxMOUSE_BTN_AUX1:
        return this.m_eventType === wxEVT_AUX1_DCLICK;
      case wxMouseButton.wxMOUSE_BTN_AUX2:
        return this.m_eventType === wxEVT_AUX2_DCLICK;
      default:
        return false;
    }
  }

  // Was it a up event from this (or any) button?
  ButtonUp(but: wxMouseButton = wxMouseButton.wxMOUSE_BTN_ANY): boolean {
    switch (but) {
      case wxMouseButton.wxMOUSE_BTN_ANY:
        return (
          this.m_eventType === wxEVT_LEFT_UP ||
          this.m_eventType === wxEVT_MIDDLE_UP ||
          this.m_eventType === wxEVT_RIGHT_UP ||
          this.m_eventType === wxEVT_AUX1_UP ||
          this.m_eventType === wxEVT_AUX2_UP
        );
      case wxMouseButton.wxMOUSE_BTN_LEFT:
        return this.m_eventType === wxEVT_LEFT_UP;
      case wxMouseButton.wxMOUSE_BTN_MIDDLE:
        return this.m_eventType === wxEVT_MIDDLE_UP;
      case wxMouseButton.wxMOUSE_BTN_RIGHT:
        return this.m_eventType === wxEVT_RIGHT_UP;
      case wxMouseButton.wxMOUSE_BTN_AUX1:
        return this.m_eventType === wxEVT_AUX1_UP;
      case wxMouseButton.wxMOUSE_BTN_AUX2:
        return this.m_eventType === wxEVT_AUX2_UP;
      default:
        return false;
    }
  }

  // Was the given button changing state?
  Button(but: wxMouseButton): boolean {
    return this.ButtonUp(but) || this.ButtonDown(but) || this.ButtonDClick(but);
  }

  // Get the button which is changing state (wxMOUSE_BTN_NONE if none)
  GetButton(): wxMouseButton {
    for (let i = wxMouseButton.wxMOUSE_BTN_LEFT; i <= wxMouseButton.wxMOUSE_BTN_AUX2; i++) {
      if (this.Button(i)) return i;
    }

    return wxMouseButton.wxMOUSE_BTN_NONE;
  }

  // Find which event was just generated
  LeftDown(): boolean {
    return this.m_eventType === wxEVT_LEFT_DOWN;
  }
  MiddleDown(): boolean {
    return this.m_eventType === wxEVT_MIDDLE_DOWN;
  }
  RightDown(): boolean {
    return this.m_eventType === wxEVT_RIGHT_DOWN;
  }
  Aux1Down(): boolean {
    return this.m_eventType === wxEVT_AUX1_DOWN;
  }
  Aux2Down(): boolean {
    return this.m_eventType === wxEVT_AUX2_DOWN;
  }

  LeftUp(): boolean {
    return this.m_eventType === wxEVT_LEFT_UP;
  }
  MiddleUp(): boolean {
    return this.m_eventType === wxEVT_MIDDLE_UP;
  }
  RightUp(): boolean {
    return this.m_eventType === wxEVT_RIGHT_UP;
  }
  Aux1Up(): boolean {
    return this.m_eventType === wxEVT_AUX1_UP;
  }
  Aux2Up(): boolean {
    return this.m_eventType === wxEVT_AUX2_UP;
  }

  LeftDClick(): boolean {
    return this.m_eventType === wxEVT_LEFT_DCLICK;
  }
  MiddleDClick(): boolean {
    return this.m_eventType === wxEVT_MIDDLE_DCLICK;
  }
  RightDClick(): boolean {
    return this.m_eventType === wxEVT_RIGHT_DCLICK;
  }
  Aux1DClick(): boolean {
    return this.m_eventType === wxEVT_AUX1_DCLICK;
  }
  Aux2DClick(): boolean {
    return this.m_eventType === wxEVT_AUX2_DCLICK;
  }

  // True if a button is down and the mouse is moving
  Dragging(): boolean {
    return this.m_eventType === wxEVT_MOTION && this.ButtonIsDown(wxMouseButton.wxMOUSE_BTN_ANY);
  }

  // True if the mouse is moving, and no button is down
  Moving(): boolean {
    return this.m_eventType === wxEVT_MOTION && !this.ButtonIsDown(wxMouseButton.wxMOUSE_BTN_ANY);
  }

  // True if the mouse is just entering the window
  Entering(): boolean {
    return this.m_eventType === wxEVT_ENTER_WINDOW;
  }

  // True if the mouse is just leaving the window
  Leaving(): boolean {
    return this.m_eventType === wxEVT_LEAVE_WINDOW;
  }

  // Is the given button down?
  ButtonIsDown(but: wxMouseButton): boolean {
    switch (but) {
      case wxMouseButton.wxMOUSE_BTN_ANY:
        return (
          this.LeftIsDown() ||
          this.MiddleIsDown() ||
          this.RightIsDown() ||
          this.Aux1IsDown() ||
          this.Aux2IsDown()
        );
      case wxMouseButton.wxMOUSE_BTN_LEFT:
        return this.LeftIsDown();
      case wxMouseButton.wxMOUSE_BTN_MIDDLE:
        return this.MiddleIsDown();
      case wxMouseButton.wxMOUSE_BTN_RIGHT:
        return this.RightIsDown();
      case wxMouseButton.wxMOUSE_BTN_AUX1:
        return this.Aux1IsDown();
      case wxMouseButton.wxMOUSE_BTN_AUX2:
        return this.Aux2IsDown();
      default:
        return false;
    }
  }

  GetClickCount(): number {
    return this.m_clickCount;
  }

  // Get wheel rotation, positive or negative indicates direction of rotation.
  // Current devices all send an event when rotation is equal to +/-WheelDelta,
  // but this allows for finer resolution devices to be created in the future.
  // Because of this you shouldn't assume that one event is equal to 1 line or
  // whatever, but you should be able to either do partial line scrolling or
  // wait until +/-WheelDelta rotation values have been accumulated before
  // scrolling.
  GetWheelRotation(): number {
    return this.m_wheelRotation;
  }

  // Get wheel delta, normally 120. This is the threshold for action to be
  // taken, and one such action (for example, scrolling one increment)
  // should occur for each delta.
  GetWheelDelta(): number {
    return this.m_wheelDelta;
  }

  // On Mac, has the user selected "Natural" scrolling in their System
  // Preferences? Currently false on all other platforms.
  IsWheelInverted(): boolean {
    return this.m_wheelInverted;
  }

  // Gets the axis the wheel operation concerns; wxMOUSE_WHEEL_VERTICAL
  // (most common case) or wxMOUSE_WHEEL_HORIZONTAL (for horizontal scrolling
  // using e.g. a trackpad).
  GetWheelAxis(): wxMouseWheelAxis {
    return this.m_wheelAxis;
  }

  // Returns the configured number of lines (or whatever) to be scrolled per
  // wheel action. Defaults to three.
  GetLinesPerAction(): number {
    return this.m_linesPerAction;
  }

  // Returns the configured number of columns (or whatever) to be scrolled per
  // wheel action. Defaults to three.
  GetColumnsPerAction(): number {
    return this.m_columnsPerAction;
  }

  // Is the system set to do page scrolling?
  IsPageScroll(): boolean {
    return this.m_linesPerAction === Number.MAX_SAFE_INTEGER;
  }

  /** `wxEVT_MAGNIFY`'s `GetMagnification()`. */
  GetMagnification(): number {
    return this.m_magnification;
  }
}

/** `wxScrollWinEvent`. */
export class wxScrollWinEvent extends wxEvent {
  m_commandInt = 0;
  m_extraLong: number;

  constructor(
    aEventType: wxEventType = wxEVT_NULL,
    aPos = 0,
    aOrient: wxOrientation = wxOrientation.wxVERTICAL,
  ) {
    super(aEventType, false);
    this.m_commandInt = aPos;
    this.m_extraLong = aOrient;
  }

  GetOrientation(): number {
    return this.m_extraLong;
  }
  GetPosition(): number {
    return this.m_commandInt;
  }
  SetOrientation(aOrient: number): void {
    this.m_extraLong = aOrient;
  }
  SetPosition(aPos: number): void {
    this.m_commandInt = aPos;
  }
}

/** `wxZoomGestureEvent`. */
export class wxZoomGestureEvent extends wxEvent {
  m_pos = { x: 0, y: 0 };
  m_isStart = false;
  m_isEnd = false;
  m_zoomFactor = 1.0;

  constructor() {
    super(wxEVT_GESTURE_ZOOM, true);
  }

  GetPosition(): { x: number; y: number } {
    return this.m_pos;
  }
  IsGestureStart(): boolean {
    return this.m_isStart;
  }
  IsGestureEnd(): boolean {
    return this.m_isEnd;
  }
  GetZoomFactor(): number {
    return this.m_zoomFactor;
  }
}

/** `wxPanGestureEvent`. */
export class wxPanGestureEvent extends wxEvent {
  m_pos = { x: 0, y: 0 };
  m_delta = { x: 0, y: 0 };
  m_isStart = false;
  m_isEnd = false;

  constructor() {
    super(wxEVT_GESTURE_PAN, true);
  }

  GetPosition(): { x: number; y: number } {
    return this.m_pos;
  }
  GetDelta(): { x: number; y: number } {
    return this.m_delta;
  }
  IsGestureStart(): boolean {
    return this.m_isStart;
  }
  IsGestureEnd(): boolean {
    return this.m_isEnd;
  }
}

/** `wxTimerEvent`. */
export class wxTimerEvent extends wxEvent {
  constructor(readonly m_timer: wxTimer) {
    super(wxEVT_TIMER, false);
  }

  GetTimer(): wxTimer {
    return this.m_timer;
  }
}

/**
 * `wxTimer`: a one-shot or repeating timer whose `Notify()` fires the owner's
 * handler. `SetOwner( handler )` here takes the callback the wx owner would
 * `Connect`.
 */
export class wxTimer {
  private m_handle: ReturnType<typeof setTimeout> | null = null;
  private m_milli = 0;
  private m_oneShot = false;
  private m_running = false;
  private m_owner: ((aEvent: wxTimerEvent) => void) | null = null;
  private static s_nextId = 1;
  private readonly m_id: number;

  constructor(aOwner: ((aEvent: wxTimerEvent) => void) | null = null) {
    this.m_owner = aOwner;
    this.m_id = wxTimer.s_nextId++;
  }

  GetId(): number {
    return this.m_id;
  }

  SetOwner(aOwner: ((aEvent: wxTimerEvent) => void) | null): void {
    this.m_owner = aOwner;
  }

  /** `Start( milliseconds = -1, oneShot = false )`: -1 restarts with the previous interval. */
  Start(aMilliseconds = -1, aOneShot = false): boolean {
    this.Stop();

    if (aMilliseconds !== -1) this.m_milli = aMilliseconds;

    if (this.m_milli <= 0) this.m_milli = 1;

    this.m_oneShot = aOneShot;
    this.m_running = true;

    const fire = (): void => {
      if (this.m_oneShot) {
        this.m_running = false;
        this.m_handle = null;
      }

      this.Notify();
    };

    this.m_handle = this.m_oneShot
      ? setTimeout(fire, this.m_milli)
      : setInterval(fire, this.m_milli);

    return true;
  }

  /** `StartOnce( milliseconds )`. */
  StartOnce(aMilliseconds = -1): boolean {
    return this.Start(aMilliseconds, true);
  }

  Stop(): void {
    if (this.m_handle !== null) {
      if (this.m_oneShot) clearTimeout(this.m_handle);
      else clearInterval(this.m_handle);
      this.m_handle = null;
    }

    this.m_running = false;
  }

  /** `Notify()`: the default sends `wxTimerEvent` to the owner. */
  Notify(): void {
    if (this.m_owner) this.m_owner(new wxTimerEvent(this));
  }

  IsRunning(): boolean {
    return this.m_running;
  }

  IsOneShot(): boolean {
    return this.m_oneShot;
  }

  GetInterval(): number {
    return this.m_milli;
  }
}

/**
 * `wxGetKeyState( WXK_* )`: the platform keeps the modifier state; the panel
 * feeds it from every DOM event it sees (there is no synchronous keyboard
 * query in a browser).
 */
const s_keyState = new Map<number, boolean>();

export function wxGetKeyState(aKey: number): boolean {
  return s_keyState.get(aKey) ?? false;
}

/** The platform's half of `wxGetKeyState`: record a key's state. */
export function wxSetKeyState(aKey: number, aDown: boolean): void {
  s_keyState.set(aKey, aDown);
}

/** `wxKeyEvent`: a key code (`WXK_*` or an upper-case ASCII code), its unicode character and the modifiers. */
export class wxKeyEvent extends wxEvent {
  readonly state = new wxKeyboardState();

  /** `m_keyCode`. */
  m_keyCode = 0;
  /** `m_uniChar`: the code point of the printable character, or 0. */
  m_uniChar = 0;
  /** `m_rawCode`. */
  m_rawCode = 0;
  /** `m_x`, `m_y`: the mouse position at the key press. */
  m_x = 0;
  m_y = 0;
  /** `m_isRepeat` (wx 3.1+): the auto-repeat flag. */
  m_isRepeat = false;

  constructor(aEventType: wxEventType = wxEVT_NULL) {
    super(aEventType, true);
  }

  GetKeyCode(): number {
    return this.m_keyCode;
  }
  /** `GetUnicodeKey()`: the character, or WXK_NONE for a non-printable key. */
  GetUnicodeKey(): number {
    return this.m_uniChar;
  }
  GetRawKeyCode(): number {
    return this.m_rawCode;
  }
  GetX(): number {
    return this.m_x;
  }
  GetY(): number {
    return this.m_y;
  }
  GetPosition(): { x: number; y: number } {
    return { x: this.m_x, y: this.m_y };
  }
  IsAutoRepeat(): boolean {
    return this.m_isRepeat;
  }
  ControlDown(): boolean {
    return this.state.ControlDown();
  }
  RawControlDown(): boolean {
    return this.state.RawControlDown();
  }
  ShiftDown(): boolean {
    return this.state.ShiftDown();
  }
  AltDown(): boolean {
    return this.state.AltDown();
  }
  MetaDown(): boolean {
    return this.state.MetaDown();
  }
  HasAnyModifiers(): boolean {
    return this.state.HasAnyModifiers();
  }
  /** `GetModifiers()`: the `wxMOD_*` mask. */
  GetModifiers(): number {
    return (
      (this.state.AltDown() ? wxMOD_ALT : 0) |
      (this.state.ControlDown() ? wxMOD_CONTROL : 0) |
      (this.state.ShiftDown() ? wxMOD_SHIFT : 0) |
      (this.state.MetaDown() ? wxMOD_META : 0)
    );
  }
}

/** `wxKeyModifier`. */
export const wxMOD_NONE = 0x0000;
export const wxMOD_ALT = 0x0001;
export const wxMOD_CONTROL = 0x0002;
export const wxMOD_ALTGR = wxMOD_ALT | wxMOD_CONTROL;
export const wxMOD_SHIFT = 0x0004;
export const wxMOD_META = 0x0008;
export const wxMOD_WIN = wxMOD_META;
export const wxMOD_RAW_CONTROL = wxMOD_CONTROL;
export const wxMOD_CMD = wxMOD_CONTROL;
export const wxMOD_ALL = 0xffff;

/** `wxSizeEvent`. */
export class wxSizeEvent extends wxEvent {
  constructor(readonly m_size: { x: number; y: number }) {
    super(wxEVT_SIZE, false);
  }

  GetSize(): { x: number; y: number } {
    return this.m_size;
  }
}

/** `wxFocusEvent`. */
export class wxFocusEvent extends wxEvent {
  constructor(aEventType: wxEventType = wxEVT_NULL) {
    super(aEventType, false);
  }
}

/** `wxShowEvent`. */
export class wxShowEvent extends wxEvent {
  constructor(readonly m_show: boolean) {
    super(wxEVT_SHOW, false);
  }

  IsShown(): boolean {
    return this.m_show;
  }
}
