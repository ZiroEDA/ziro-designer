// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/view/wx_view_controls.h` + `common/view/wx_view_controls.cpp`:
 * `KIGFX::WX_VIEW_CONTROLS`, the VIEW_CONTROLS that reads the panel's mouse
 * events. The panel makes `wxMouseEvent`s out of the DOM's and runs them
 * through the same handler chain wx would.
 */

import { WXK } from '@ziroeda/core/src/wx_keycodes.js';
import { GetClampedCoords } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import {
  EuclideanNorm,
  ResizeD,
  type Vec2 as VECTOR2D,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { FRAME_T } from '../frame_type.js';
import * as KIPLATFORM_UI from '../kiplatform/ui.js';
import { MOUSE_DRAG_ACTION } from '../mouse_drag_action.js';
import { Pgm } from '../pgm_base.js';
import { KIUI_IsInputControlFocused, KIUI_IsModalDialogFocused } from '../widgets/ui_common.js';
import {
  type wxEvent,
  wxEVT_ENTER_WINDOW,
  wxEVT_GESTURE_PAN,
  wxEVT_GESTURE_ZOOM,
  wxEVT_LEAVE_WINDOW,
  wxEVT_LEFT_DOWN,
  wxEVT_LEFT_UP,
  wxEVT_MAGNIFY,
  wxEVT_MIDDLE_DOWN,
  wxEVT_MIDDLE_UP,
  wxEVT_MOTION,
  wxEVT_MOUSEWHEEL,
  wxEVT_RIGHT_DOWN,
  wxEVT_RIGHT_UP,
  wxEVT_SCROLLWIN_BOTTOM,
  wxEVT_SCROLLWIN_LINEDOWN,
  wxEVT_SCROLLWIN_LINEUP,
  wxEVT_SCROLLWIN_PAGEDOWN,
  wxEVT_SCROLLWIN_PAGEUP,
  wxEVT_SCROLLWIN_THUMBRELEASE,
  wxEVT_SCROLLWIN_THUMBTRACK,
  wxEVT_SCROLLWIN_TOP,
  wxEVT_TIMER,
  wxGetKeyState,
  wxMouseEvent,
  wxMouseWheelAxis,
  wxNewEventType,
  wxOrientation,
  type wxPanGestureEvent,
  type wxScrollWinEvent,
  wxTimer,
  type wxTimerEvent,
  type wxZoomGestureEvent,
} from '../wx/wx_event.js';
import type { VIEW } from './view.js';
import { VIEW_CONTROLS } from './view_controls.js';
import {
  ACCELERATING_ZOOM_CONTROLLER,
  CONSTANT_ZOOM_CONTROLLER,
  type ZOOM_CONTROLLER,
} from './zoom_controller.js';

/**
 * `EDA_DRAW_PANEL_GAL` as the view controls reach it: the wx window calls
 * (client size, focus, the event table) and the frame it belongs to.
 */
export interface WX_VIEW_CONTROLS_PANEL extends KIPLATFORM_UI.KIPLATFORM_WINDOW {
  /** `wxWindow::Connect( eventType, handler )`: a dynamic handler, searched most-recent first. */
  Connect(aEventType: number, aHandler: (aEvent: wxEvent) => void): void;
  /** `wxPostEvent( panel, event )`: queue the event for the panel's handler chain. */
  PostEvent(aEvent: wxEvent): void;
  /** `wxWindow::ScreenToClient`. */
  ScreenToClient(aPoint: { x: number; y: number }): { x: number; y: number };
  /** `wxWindow::GetClientSize`. */
  GetClientSize(): VECTOR2I;
  /** `wxWindow::Refresh()`. */
  Refresh(): void;
  /** `wxWindow::GetParent()`: null for a top-level window. */
  GetParent(): unknown;
  /** `EDA_DRAW_PANEL_GAL::GetParentEDAFrame()`. */
  GetParentEDAFrame(): WX_VIEW_CONTROLS_FRAME | null;
  /** `EDA_DRAW_PANEL_GAL::StatusPopupHasFocus()`. */
  StatusPopupHasFocus(): boolean;
  /** `wxWindow::EnableTouchEvents`: true when the platform delivers gestures. */
  EnableTouchEvents(aFlags: number): boolean;
  /** `wxScrolledCanvas::GetScrollThumb( orient )`. */
  GetScrollThumb(aOrientation: wxOrientation): number;
  /** `wxScrolledCanvas::GetScrollRange( orient )`. */
  GetScrollRange(aOrientation: wxOrientation): number;
  /** `wxScrolledCanvas::SetScrollbars( ... )`. */
  SetScrollbars(
    aPixelsPerUnitX: number,
    aPixelsPerUnitY: number,
    aNoUnitsX: number,
    aNoUnitsY: number,
    aXPos: number,
    aYPos: number,
    aNoRefresh: boolean,
  ): void;
  /** `m_MouseCapturedLost`. */
  m_MouseCapturedLost: boolean;
}

/** `EDA_DRAW_FRAME` as `onMotion`'s focus-follow reads it. */
export interface WX_VIEW_CONTROLS_FRAME {
  IsType(aFrameType: FRAME_T): boolean;
  /** `Kiway().Player( aFrameType, false )`: the sibling frame, if open. */
  KiwayPlayer(aFrameType: FRAME_T): unknown;
  Raise(): void;
}

/** `wxTOUCH_ZOOM_GESTURE`, `wxTOUCH_PAN_GESTURES`. */
export const wxTOUCH_ZOOM_GESTURE = 0x0004;
export const wxTOUCH_PAN_GESTURES = 0x0001 | 0x0002;

/** `USE_MOUSE_CAPTURE` is MSW only. */
const USE_MOUSE_CAPTURE = false;

/**
 * `GetZoomControllerForPlatform`: GTK3 is the platform this build mirrors
 * (the designer runs on a GTK3 desktop's metrics throughout).
 */
function GetZoomControllerForPlatform(_aAcceleration: boolean): ZOOM_CONTROLLER {
  // GTK3 is similar, but the scale constant is smaller
  return new CONSTANT_ZOOM_CONTROLLER(CONSTANT_ZOOM_CONTROLLER.GTK3_SCALE);
}

/// Possible states for WX_VIEW_CONTROLS.
enum STATE {
  IDLE = 1, ///< Nothing is happening.
  DRAG_PANNING, ///< Panning with mouse button pressed.
  AUTO_PANNING, ///< Panning on approaching borders of the frame.
  DRAG_ZOOMING, ///< Zooming with mouse button pressed.
}

// `static bool justWarped` in onMotion's DRAG_PANNING and DRAG_ZOOMING branches
let s_justWarpedPanning = false;
let s_justWarpedZooming = false;

/**
 * An implementation of class VIEW_CONTROLS for wxWidgets library.
 */
export class WX_VIEW_CONTROLS extends VIEW_CONTROLS {
  /// Event that forces mouse move event in the dispatcher (eg. used in autopanning, when
  /// mouse cursor does not move in screen coordinates, but does in world coordinates)
  static readonly EVT_REFRESH_MOUSE = wxNewEventType();

  /// Current state of VIEW_CONTROLS.
  private m_state: STATE;

  /// Panel that is affected by VIEW_CONTROLS.
  private m_parentPanel: WX_VIEW_CONTROLS_PANEL;

  /// Store information about point where dragging has started.
  private m_dragStartPoint: VECTOR2D;

  /// Current direction of panning (only autopanning mode).
  private m_panDirection: VECTOR2D;

  /// Timer responsible for handling autopanning.
  private m_panTimer: wxTimer;

  /// Ratio used for scaling world coordinates to scrollbar position.
  private m_scrollScale: VECTOR2D;

  /// Current scrollbar position.
  private m_scrollPos: VECTOR2I;

  /// The mouse position when a drag zoom started.
  private m_zoomStartPoint: VECTOR2D;

  /// Current cursor position (world coordinates).
  private m_cursorPos: VECTOR2D;

  /// Flag deciding whether the cursor position should be calculated using the mouse position.
  private m_updateCursor: boolean;

  /// True if we are panning via the meta key.
  private m_metaPanning: boolean;

  /// Last mouse position when panning via the meta key.
  private m_metaPanStart: VECTOR2D;

  /// Flag to indicate if infinite panning works on this platform.
  private m_infinitePanWorks: boolean;

  /// A #ZOOM_CONTROLLER that determines zoom steps. This is platform-specific.
  private m_zoomController: ZOOM_CONTROLLER | null = null;

  /// Used to track gesture events.
  private m_gestureLastZoomFactor: number;
  private m_gestureLastPos: VECTOR2D;

  /** `PROF_COUNTER( "Mouse motion events" )`. */
  m_MotionEventCounter = 0;

  constructor(aView: VIEW, aParentPanel: WX_VIEW_CONTROLS_PANEL) {
    super(aView);
    this.m_state = STATE.IDLE;
    this.m_parentPanel = aParentPanel;
    this.m_dragStartPoint = { x: 0, y: 0 };
    this.m_panDirection = { x: 0, y: 0 };
    this.m_scrollScale = { x: 1.0, y: 1.0 };
    this.m_scrollPos = { x: 0, y: 0 };
    this.m_zoomStartPoint = { x: 0, y: 0 };
    this.m_cursorPos = { x: 0, y: 0 };
    this.m_updateCursor = true;
    this.m_metaPanning = false;
    this.m_metaPanStart = { x: 0, y: 0 };
    this.m_infinitePanWorks = false;
    this.m_gestureLastZoomFactor = 1.0;
    this.m_gestureLastPos = { x: 0, y: 0 };

    this.LoadSettings();

    const panel = this.m_parentPanel;
    const mouse = (aHandler: (aEvent: wxMouseEvent) => void) => (aEvent: wxEvent) =>
      aHandler(aEvent as wxMouseEvent);
    const scroll = (aEvent: wxEvent) => this.onScroll(aEvent as wxScrollWinEvent);

    panel.Connect(
      wxEVT_MOTION,
      mouse((e) => this.onMotion(e)),
    );
    panel.Connect(
      wxEVT_MAGNIFY,
      mouse((e) => this.onMagnify(e)),
    );
    panel.Connect(
      wxEVT_MOUSEWHEEL,
      mouse((e) => this.onWheel(e)),
    );
    panel.Connect(
      wxEVT_MIDDLE_UP,
      mouse((e) => this.onButton(e)),
    );
    panel.Connect(
      wxEVT_MIDDLE_DOWN,
      mouse((e) => this.onButton(e)),
    );
    panel.Connect(
      wxEVT_LEFT_UP,
      mouse((e) => this.onButton(e)),
    );
    panel.Connect(
      wxEVT_LEFT_DOWN,
      mouse((e) => this.onButton(e)),
    );
    panel.Connect(
      wxEVT_RIGHT_UP,
      mouse((e) => this.onButton(e)),
    );
    panel.Connect(
      wxEVT_RIGHT_DOWN,
      mouse((e) => this.onButton(e)),
    );
    // wxEVT_ENTER_WINDOW is connected on __WXMSW__ only
    panel.Connect(
      wxEVT_LEAVE_WINDOW,
      mouse((e) => this.onLeave(e)),
    );
    panel.Connect(wxEVT_SCROLLWIN_THUMBTRACK, scroll);
    panel.Connect(wxEVT_SCROLLWIN_PAGEUP, scroll);
    panel.Connect(wxEVT_SCROLLWIN_PAGEDOWN, scroll);
    panel.Connect(wxEVT_SCROLLWIN_BOTTOM, scroll);
    panel.Connect(wxEVT_SCROLLWIN_TOP, scroll);
    panel.Connect(wxEVT_SCROLLWIN_LINEUP, scroll);
    panel.Connect(wxEVT_SCROLLWIN_LINEDOWN, scroll);
    // wxEVT_MOUSE_CAPTURE_LOST is connected under USE_MOUSE_CAPTURE only

    if (panel.EnableTouchEvents(wxTOUCH_ZOOM_GESTURE | wxTOUCH_PAN_GESTURES)) {
      panel.Connect(wxEVT_GESTURE_ZOOM, (e) => this.onZoomGesture(e as wxZoomGestureEvent));
      panel.Connect(wxEVT_GESTURE_PAN, (e) => this.onPanGesture(e as wxPanGestureEvent));
    }

    this.m_cursorWarped = false;

    this.m_panTimer = new wxTimer((e) => this.onTimer(e));

    this.m_settings.m_lastKeyboardCursorPositionValid = false;
    this.m_settings.m_lastKeyboardCursorPosition = { x: 0.0, y: 0.0 };
    this.m_settings.m_lastKeyboardCursorCommand = 0;
  }

  /** `~WX_VIEW_CONTROLS`: the pan timer must not outlive the panel. */
  Destroy(): void {
    this.m_panTimer.Stop();
  }

  /// Applies VIEW_CONTROLS settings from the program #COMMON_SETTINGS.
  override LoadSettings(): void {
    const cfg = Pgm().GetCommonSettings()!;

    this.m_settings.m_warpCursor = cfg.m_Input.center_on_zoom;
    this.m_settings.m_focusFollowSchPcb = cfg.m_Input.focus_follow_sch_pcb;
    this.m_settings.m_autoPanSettingEnabled = cfg.m_Input.auto_pan;
    this.m_settings.m_autoPanAcceleration = cfg.m_Input.auto_pan_acceleration;
    this.m_settings.m_horizontalPan = cfg.m_Input.horizontal_pan;
    this.m_settings.m_zoomAcceleration = cfg.m_Input.zoom_acceleration;
    this.m_settings.m_zoomSpeed = cfg.m_Input.zoom_speed;
    this.m_settings.m_zoomSpeedAuto = cfg.m_Input.zoom_speed_auto;
    this.m_settings.m_scrollModifierZoom = cfg.m_Input.scroll_modifier_zoom;
    this.m_settings.m_scrollModifierPanH = cfg.m_Input.scroll_modifier_pan_h;
    this.m_settings.m_scrollModifierPanV = cfg.m_Input.scroll_modifier_pan_v;
    this.m_settings.m_dragLeft = cfg.m_Input.drag_left;
    this.m_settings.m_dragMiddle = cfg.m_Input.drag_middle;
    this.m_settings.m_dragRight = cfg.m_Input.drag_right;
    this.m_settings.m_scrollReverseZoom = cfg.m_Input.reverse_scroll_zoom;
    this.m_settings.m_scrollReversePanH = cfg.m_Input.reverse_scroll_pan_h;
    this.m_settings.m_motionPanModifier = cfg.m_Input.motion_pan_modifier;

    this.m_zoomController = null;

    if (cfg.m_Input.zoom_speed_auto) {
      this.m_zoomController = GetZoomControllerForPlatform(cfg.m_Input.zoom_acceleration);
    } else {
      if (cfg.m_Input.zoom_acceleration) {
        this.m_zoomController = new ACCELERATING_ZOOM_CONTROLLER(cfg.m_Input.zoom_speed);
      } else {
        const scale = CONSTANT_ZOOM_CONTROLLER.MANUAL_SCALE_FACTOR * cfg.m_Input.zoom_speed;
        this.m_zoomController = new CONSTANT_ZOOM_CONTROLLER(scale);
      }
    }
  }

  /// Handler functions
  onMotion(aEvent: wxMouseEvent): void {
    this.m_MotionEventCounter++;

    // Because Weston sends a motion event to previous location after warping the pointer
    const mouseRel = this.m_parentPanel.ScreenToClient(KIPLATFORM_UI.GetMousePosition());

    let isAutoPanning = false;
    const x = mouseRel.x;
    const y = mouseRel.y;
    const mousePos: VECTOR2D = { x, y };

    // Clear keyboard cursor position flag when actual mouse motion is detected
    // (i.e., not from cursor warping and position has changed)
    if (!this.m_cursorWarped && this.m_settings.m_lastKeyboardCursorPositionValid) {
      const screenPos: VECTOR2I = { x, y };
      const kp = this.m_view.ToScreen(this.m_settings.m_lastKeyboardCursorPosition);
      const keyboardScreenPos: VECTOR2I = { x: Math.trunc(kp.x), y: Math.trunc(kp.y) };

      // If mouse has moved to a different position than the keyboard cursor position,
      // clear the keyboard position flag to allow mouse control
      if (screenPos.x !== keyboardScreenPos.x || screenPos.y !== keyboardScreenPos.y) {
        this.m_settings.m_lastKeyboardCursorPositionValid = false;
        this.m_settings.m_lastKeyboardCursorPosition = { x: 0.0, y: 0.0 };
      }
    }

    // Automatic focus switching between SCH and PCB windows on canvas mouse motion
    if (this.m_settings.m_focusFollowSchPcb) {
      const frame = this.m_parentPanel.GetParentEDAFrame();

      if (frame) {
        let otherFrame: unknown = null;

        if (frame.IsType(FRAME_T.FRAME_PCB_EDITOR)) {
          otherFrame = frame.KiwayPlayer(FRAME_T.FRAME_SCH);
        } else if (frame.IsType(FRAME_T.FRAME_SCH)) {
          otherFrame = frame.KiwayPlayer(FRAME_T.FRAME_PCB_EDITOR);
        }

        if (
          otherFrame &&
          KIPLATFORM_UI.IsWindowActive(otherFrame) &&
          !KIPLATFORM_UI.IsWindowActive(frame)
        ) {
          frame.Raise();
        }
      }
    }

    if (
      this.m_settings.m_motionPanModifier !== WXK.WXK_NONE &&
      wxGetKeyState(this.m_settings.m_motionPanModifier)
    ) {
      if (!this.m_metaPanning) {
        this.m_metaPanning = true;
        this.m_metaPanStart = mousePos;
        aEvent.StopPropagation();
      } else {
        const d: VECTOR2D = {
          x: this.m_metaPanStart.x - mousePos.x,
          y: this.m_metaPanStart.y - mousePos.y,
        };
        this.m_metaPanStart = mousePos;

        const delta = this.m_view.ToWorld(d, false);
        const c = this.m_view.GetCenter();
        this.m_view.SetCenter({ x: c.x + delta.x, y: c.y + delta.y });
        aEvent.StopPropagation();
      }

      if (this.m_updateCursor) this.m_cursorPos = GetClampedCoords(this.m_view.ToWorld(mousePos));
      else this.m_updateCursor = true;

      aEvent.Skip();
      return;
    }

    this.m_metaPanning = false;

    if (this.m_state !== STATE.DRAG_PANNING && this.m_state !== STATE.DRAG_ZOOMING)
      this.handleCursorCapture(x, y);

    if (this.m_settings.m_autoPanEnabled && this.m_settings.m_autoPanSettingEnabled)
      isAutoPanning = this.handleAutoPanning(aEvent);

    if (!isAutoPanning && aEvent.Dragging()) {
      if (this.m_state === STATE.DRAG_PANNING) {
        let warpX = 0;
        let warpY = 0;
        const parentSize = this.m_parentPanel.GetClientSize();

        if (x < 0) {
          warpX = parentSize.x;
        } else if (x >= parentSize.x) {
          warpX = -parentSize.x;
        }

        if (y < 0) {
          warpY = parentSize.y;
        } else if (y >= parentSize.y) {
          warpY = -parentSize.y;
        }

        if (!s_justWarpedPanning) {
          const d: VECTOR2D = {
            x: this.m_dragStartPoint.x - mousePos.x,
            y: this.m_dragStartPoint.y - mousePos.y,
          };
          this.m_dragStartPoint = mousePos;
          const delta = this.m_view.ToWorld(d, false);
          const c = this.m_view.GetCenter();
          this.m_view.SetCenter({ x: c.x + delta.x, y: c.y + delta.y });
          aEvent.StopPropagation();
        }

        if (warpX || warpY) {
          if (!s_justWarpedPanning) {
            if (
              this.m_infinitePanWorks &&
              KIPLATFORM_UI.WarpPointer(this.m_parentPanel, x + warpX, y + warpY)
            ) {
              this.m_dragStartPoint = {
                x: this.m_dragStartPoint.x + warpX,
                y: this.m_dragStartPoint.y + warpY,
              };
              s_justWarpedPanning = true;
            }
          } else {
            s_justWarpedPanning = false;
          }
        } else {
          s_justWarpedPanning = false;
        }
      } else if (this.m_state === STATE.DRAG_ZOOMING) {
        let warpY = 0;
        const parentSize = this.m_parentPanel.GetClientSize();

        if (y < 0) {
          warpY = parentSize.y;
        } else if (y >= parentSize.y) {
          warpY = -parentSize.y;
        }

        if (!s_justWarpedZooming) {
          const d: VECTOR2D = {
            x: this.m_dragStartPoint.x - mousePos.x,
            y: this.m_dragStartPoint.y - mousePos.y,
          };
          this.m_dragStartPoint = mousePos;

          const scale = Math.exp(d.y * this.m_settings.m_zoomSpeed * 0.001);

          this.m_view.SetScale(
            this.m_view.GetScale() * scale,
            this.m_view.ToWorld(this.m_zoomStartPoint),
          );
          aEvent.StopPropagation();
        }

        if (warpY) {
          if (!s_justWarpedZooming) {
            KIPLATFORM_UI.WarpPointer(this.m_parentPanel, x, y + warpY);
            this.m_dragStartPoint = {
              x: this.m_dragStartPoint.x,
              y: this.m_dragStartPoint.y + warpY,
            };
            s_justWarpedZooming = true;
          } else s_justWarpedZooming = false;
        } else {
          s_justWarpedZooming = false;
        }
      }
    }

    if (this.m_updateCursor)
      // do not update the cursor position if it was explicitly set
      this.m_cursorPos = GetClampedCoords(this.m_view.ToWorld(mousePos));
    else this.m_updateCursor = true;

    aEvent.Skip();
  }

  onWheel(aEvent: wxMouseEvent): void {
    const wheelPanSpeed = 0.001;
    const axis = aEvent.GetWheelAxis();

    // Native horizontal wheel events (from mice with tilt wheels, side-button scroll combos, or
    // touchpads) are always handled as horizontal pan. The m_horizontalPan setting only controls
    // whether a keyboard modifier can convert vertical scroll into horizontal pan.
    if (axis === wxMouseWheelAxis.wxMOUSE_WHEEL_HORIZONTAL) {
      const ss = this.m_view.ToWorld(this.m_view.GetScreenPixelSize(), false);
      const k = aEvent.GetWheelRotation() * wheelPanSpeed;
      const scrollVec: VECTOR2D = { x: ss.x * k, y: ss.y * k };

      const c = this.m_view.GetCenter();
      this.m_view.SetCenter({ x: c.x + scrollVec.x, y: c.y + 0.0 });
      this.refreshMouse(true);
      return;
    }

    // Pick the modifier, if any.  Shift beats control beats alt, we don't support more than one.
    let nMods = 0;
    let modifiers = 0;

    if (aEvent.ShiftDown()) {
      nMods += 1;
      modifiers = WXK.WXK_SHIFT;
    }

    if (aEvent.ControlDown()) {
      nMods += 1;
      modifiers = modifiers === 0 ? WXK.WXK_CONTROL : modifiers;
    }

    if (aEvent.AltDown()) {
      nMods += 1;
      modifiers = modifiers === 0 ? WXK.WXK_ALT : modifiers;
    }

    // Zero or one modifier is view control
    if (nMods <= 1) {
      // Restrict zoom handling to the vertical axis, otherwise horizontal
      // scrolling events (e.g. touchpads and some mice) end up interpreted
      // as vertical scroll events and confuse the user.
      if (
        modifiers === this.m_settings.m_scrollModifierZoom &&
        axis === wxMouseWheelAxis.wxMOUSE_WHEEL_VERTICAL
      ) {
        const rotation = aEvent.GetWheelRotation() * (this.m_settings.m_scrollReverseZoom ? -1 : 1);
        const zoomScale = this.m_zoomController!.GetScaleForRotation(rotation);

        if (this.IsCursorWarpingEnabled()) {
          this.CenterOnCursor();
          this.m_view.SetScale(this.m_view.GetScale() * zoomScale);
        } else {
          const anchor = this.m_view.ToWorld({ x: aEvent.GetX(), y: aEvent.GetY() });
          this.m_view.SetScale(this.m_view.GetScale() * zoomScale, anchor);
        }

        aEvent.Skip();

        // Refresh the zoom level and mouse position on message panel
        // (mouse position has not changed, only the zoom level has changed):
        this.refreshMouse(true);
      } else {
        // Scrolling
        const ss = this.m_view.ToWorld(this.m_view.GetScreenPixelSize(), false);
        const k = aEvent.GetWheelRotation() * wheelPanSpeed;
        const scrollVec: VECTOR2D = { x: ss.x * k, y: ss.y * k };
        let scrollX = 0.0;
        let scrollY = 0.0;
        const hReverse = this.m_settings.m_scrollReversePanH;

        if (modifiers === this.m_settings.m_scrollModifierPanH) {
          scrollX = hReverse ? scrollVec.x : -scrollVec.x;
        } else {
          scrollY = -scrollVec.y;
        }

        const delta: VECTOR2D = { x: scrollX, y: scrollY };

        const c = this.m_view.GetCenter();
        this.m_view.SetCenter({ x: c.x + delta.x, y: c.y + delta.y });
        this.refreshMouse(true);
      }

      // Do not skip this event, otherwise wxWidgets will fire
      // 3 wxEVT_SCROLLWIN_LINEUP or wxEVT_SCROLLWIN_LINEDOWN (normal wxWidgets behavior)
      // and we do not want that.
    } else {
      // When we have multiple mods, forward it for tool handling
      aEvent.Skip();
    }
  }

  onMagnify(aEvent: wxMouseEvent): void {
    // Scale based on the magnification from our underlying magnification event.
    const anchor = this.m_view.ToWorld({ x: aEvent.GetX(), y: aEvent.GetY() });
    this.m_view.SetScale(
      this.m_view.GetScale() * (Math.fround(aEvent.GetMagnification()) + 1.0),
      anchor,
    );

    aEvent.Skip();
  }

  private setState(aNewState: STATE): void {
    this.m_state = aNewState;
  }

  onButton(aEvent: wxMouseEvent): void {
    switch (this.m_state) {
      case STATE.IDLE:
      case STATE.AUTO_PANNING:
        if (
          (aEvent.MiddleDown() && this.m_settings.m_dragMiddle === MOUSE_DRAG_ACTION.PAN) ||
          (aEvent.RightDown() && this.m_settings.m_dragRight === MOUSE_DRAG_ACTION.PAN)
        ) {
          this.m_dragStartPoint = { x: aEvent.GetX(), y: aEvent.GetY() };
          this.setState(STATE.DRAG_PANNING);
          this.m_infinitePanWorks = KIPLATFORM_UI.InfiniteDragPrepareWindow(this.m_parentPanel);
        } else if (
          (aEvent.MiddleDown() && this.m_settings.m_dragMiddle === MOUSE_DRAG_ACTION.ZOOM) ||
          (aEvent.RightDown() && this.m_settings.m_dragRight === MOUSE_DRAG_ACTION.ZOOM)
        ) {
          this.m_dragStartPoint = { x: aEvent.GetX(), y: aEvent.GetY() };
          this.m_zoomStartPoint = this.m_dragStartPoint;
          this.setState(STATE.DRAG_ZOOMING);
        }

        if (aEvent.LeftUp()) this.setState(STATE.IDLE); // Stop autopanning when user release left mouse button

        break;

      case STATE.DRAG_ZOOMING:
      case STATE.DRAG_PANNING:
        if (aEvent.MiddleUp() || aEvent.LeftUp() || aEvent.RightUp()) {
          this.setState(STATE.IDLE);
          KIPLATFORM_UI.InfiniteDragReleaseWindow();
        }

        break;
    }

    aEvent.Skip();
  }

  onEnter(_aEvent: wxMouseEvent): void {
    // Avoid stealing focus from text controls
    // This is particularly important for users using On-Screen-Keyboards
    // They may move the mouse over the canvas to reach the keyboard
    if (KIUI_IsInputControlFocused()) {
      return;
    }

    // Win32 and some *nix WMs transmit mouse move and wheel events to all controls below the
    // mouse regardless of focus.  Forcing the focus here will cause the EDA FRAMES to immediately
    // become the top level active window.
    if (this.m_parentPanel.GetParent() !== null) {
      // this assumes the parent panel's parent is the eda window
      if (KIPLATFORM_UI.IsWindowActive(this.m_parentPanel.GetParent())) {
        this.m_parentPanel.SetFocus();
      }
    }
  }

  onLeave(aEvent: wxMouseEvent): void {
    if (!USE_MOUSE_CAPTURE) this.onMotion(aEvent);
  }

  onCaptureLost(_aEvent: wxMouseEvent): void {
    // This method must be present to suppress the capture-lost assertion

    // Set the flag to allow calling m_parentPanel->CaptureMouse()
    // Note: One cannot call m_parentPanel->CaptureMouse() twice, this is not accepted
    // by wxWidgets (MSW specific) so we need this guard
    this.m_parentPanel.m_MouseCapturedLost = true;
  }

  onTimer(_aEvent: wxTimerEvent): void {
    switch (this.m_state) {
      case STATE.AUTO_PANNING: {
        if (!this.m_settings.m_autoPanEnabled) {
          this.setState(STATE.IDLE);
          return;
        }

        if (!this.m_parentPanel.HasFocus() && !this.m_parentPanel.StatusPopupHasFocus()) {
          this.setState(STATE.IDLE);
          return;
        }

        const borderSize = Math.min(
          this.m_settings.m_autoPanMargin * this.m_view.GetScreenPixelSize().x,
          this.m_settings.m_autoPanMargin * this.m_view.GetScreenPixelSize().y,
        );

        // When the mouse cursor is outside the area with no pan,
        // m_panDirection is the dist to this area limit ( in pixels )
        // It will be used also as pan value (the pan speed depends on this dist).
        let dir: VECTOR2D = { ...this.m_panDirection };

        // When the mouse cursor is outside the area with no pan, the pan value
        // is accelerated depending on the dist between the area and the cursor
        const accel = Math.fround(0.5 + Math.fround(this.m_settings.m_autoPanAcceleration / 5.0));

        // For a small mouse cursor dist to area, just use the distance.
        // But for a dist > borderSize / 2, use an accelerated pan value
        if (EuclideanNorm(dir) >= borderSize)
          // far from area limits
          dir = ResizeD(dir, borderSize * accel);
        else if (EuclideanNorm(dir) > borderSize / 2)
          // Near from area limits
          dir = ResizeD(dir, borderSize);

        dir = this.m_view.ToWorld(dir, false);
        const c = this.m_view.GetCenter();
        this.m_view.SetCenter({ x: c.x + dir.x, y: c.y + dir.y });

        this.refreshMouse(true);

        this.m_panTimer.Start();
        break;
      }

      case STATE.IDLE: // Just remove unnecessary warnings
      case STATE.DRAG_PANNING:
      case STATE.DRAG_ZOOMING:
        break;
    }
  }

  onZoomGesture(aEvent: wxZoomGestureEvent): void {
    if (aEvent.IsGestureStart()) {
      this.m_gestureLastZoomFactor = 1.0;
      this.m_gestureLastPos = { x: aEvent.GetPosition().x, y: aEvent.GetPosition().y };
    }

    const evtPos: VECTOR2D = { x: aEvent.GetPosition().x, y: aEvent.GetPosition().y };
    const deltaWorld = this.m_view.ToWorld(
      { x: evtPos.x - this.m_gestureLastPos.x, y: evtPos.y - this.m_gestureLastPos.y },
      false,
    );

    const c = this.m_view.GetCenter();
    this.m_view.SetCenter({ x: c.x - deltaWorld.x, y: c.y - deltaWorld.y });

    this.m_view.SetScale(
      (this.m_view.GetScale() * aEvent.GetZoomFactor()) / this.m_gestureLastZoomFactor,
      this.m_view.ToWorld(evtPos),
    );

    this.m_gestureLastZoomFactor = aEvent.GetZoomFactor();
    this.m_gestureLastPos = evtPos;

    this.refreshMouse(true);
  }

  onPanGesture(aEvent: wxPanGestureEvent): void {
    const screenDelta: VECTOR2I = { x: aEvent.GetDelta().x, y: aEvent.GetDelta().y };
    const deltaWorld = this.m_view.ToWorld(screenDelta, false);

    const c = this.m_view.GetCenter();
    this.m_view.SetCenter({ x: c.x - deltaWorld.x, y: c.y - deltaWorld.y });

    this.refreshMouse(true);
  }

  onScroll(aEvent: wxScrollWinEvent): void {
    const linePanDelta = 0.05;
    const pagePanDelta = 0.5;

    const type = aEvent.GetEventType();
    const dir = aEvent.GetOrientation();

    if (type === wxEVT_SCROLLWIN_THUMBTRACK) {
      const center = { ...this.m_view.GetCenter() };
      const boundary = this.m_view.GetBoundary();

      // Flip scroll direction in flipped view
      const xstart = this.m_view.IsMirroredX() ? boundary.GetRight() : boundary.GetLeft();
      const xdelta = this.m_view.IsMirroredX() ? -1 : 1;

      if (dir === wxOrientation.wxHORIZONTAL)
        center.x = xstart + xdelta * (aEvent.GetPosition() / this.m_scrollScale.x);
      else center.y = boundary.GetTop() + aEvent.GetPosition() / this.m_scrollScale.y;

      this.m_view.SetCenter(center);
    } else if (
      type === wxEVT_SCROLLWIN_THUMBRELEASE ||
      type === wxEVT_SCROLLWIN_TOP ||
      type === wxEVT_SCROLLWIN_BOTTOM
    ) {
      // Do nothing on thumb release, we don't care about it.
      // We don't have a concept of top or bottom in our viewport, so ignore those events.
    } else {
      let dist = 0;

      if (type === wxEVT_SCROLLWIN_PAGEUP) {
        dist = pagePanDelta;
      } else if (type === wxEVT_SCROLLWIN_PAGEDOWN) {
        dist = -pagePanDelta;
      } else if (type === wxEVT_SCROLLWIN_LINEUP) {
        dist = linePanDelta;
      } else if (type === wxEVT_SCROLLWIN_LINEDOWN) {
        dist = -linePanDelta;
      } else {
        console.assert(false, 'Unhandled event type');
        return;
      }

      const ss = this.m_view.ToWorld(this.m_view.GetScreenPixelSize(), false);
      const scroll: VECTOR2D = { x: ss.x * dist, y: ss.y * dist };

      let scrollX = 0.0;
      let scrollY = 0.0;

      if (dir === wxOrientation.wxHORIZONTAL) scrollX = -scroll.x;
      else scrollY = -scroll.y;

      const delta: VECTOR2D = { x: scrollX, y: scrollY };

      const c = this.m_view.GetCenter();
      this.m_view.SetCenter({ x: c.x + delta.x, y: c.y + delta.y });
    }

    this.m_parentPanel.Refresh();
  }

  override CaptureCursor(aEnabled: boolean): void {
    // USE_MOUSE_CAPTURE is MSW only
    super.CaptureCursor(aEnabled);
  }

  /// End any mouse drag action still in progress.
  CancelDrag(): void {
    if (this.m_state === STATE.DRAG_PANNING || this.m_state === STATE.DRAG_ZOOMING) {
      this.setState(STATE.IDLE);
    }

    this.m_metaPanning = false;
  }

  /// @copydoc VIEW_CONTROLS::GetMousePosition()
  override GetMousePosition(aWorldCoordinates = true): VECTOR2D {
    const msp = this.getMouseScreenPosition();
    const screenPos: VECTOR2D = { x: msp.x, y: msp.y };

    return aWorldCoordinates ? GetClampedCoords(this.m_view.ToWorld(screenPos)) : screenPos;
  }

  /// @copydoc VIEW_CONTROLS::GetRawCursorPosition()
  override GetRawCursorPosition(aEnableSnapping = true): VECTOR2D {
    const gal = this.m_view.GetGAL();

    if (aEnableSnapping && gal.GetGridSnapping()) {
      return gal.GetGridPoint(this.m_cursorPos);
    }

    return this.m_cursorPos;
  }

  /// @copydoc VIEW_CONTROLS::GetCursorPosition()
  protected override getCursorPosition(aEnableSnapping: boolean): VECTOR2D {
    if (this.m_settings.m_forceCursorPosition) {
      return this.m_settings.m_forcedPosition;
    }

    return GetClampedCoords(this.GetRawCursorPosition(aEnableSnapping));
  }

  override SetCursorPosition(
    aPosition: VECTOR2D,
    aWarpView = true,
    aTriggeredByArrows = false,
    aArrowCommand = 0,
  ): void {
    this.m_updateCursor = false;

    const clampedPosition = GetClampedCoords(aPosition);

    if (aTriggeredByArrows) {
      this.m_settings.m_lastKeyboardCursorPositionValid = true;
      this.m_settings.m_lastKeyboardCursorPosition = clampedPosition;
      this.m_settings.m_lastKeyboardCursorCommand = aArrowCommand;
      this.m_cursorWarped = false;
    } else {
      this.m_settings.m_lastKeyboardCursorPositionValid = false;
      this.m_settings.m_lastKeyboardCursorPosition = { x: 0.0, y: 0.0 };
      this.m_settings.m_lastKeyboardCursorCommand = 0;
      this.m_cursorWarped = true;
    }

    this.WarpMouseCursor(clampedPosition, true, aWarpView);
    this.m_cursorPos = clampedPosition;
  }

  /// @copydoc VIEW_CONTROLS::SetCrossHairCursorPosition()
  override SetCrossHairCursorPosition(aPosition: VECTOR2D, aWarpView = true): void {
    this.m_updateCursor = false;

    const clampedPosition = GetClampedCoords(aPosition);

    const screenSize = this.m_view.GetGAL().GetScreenPixelSize();
    const screen = new BOX2I({ x: 0, y: 0 }, screenSize);
    const screenPos = this.m_view.ToScreen(clampedPosition);

    if (aWarpView && !screen.Contains(screenPos)) this.m_view.SetCenter(clampedPosition);

    this.m_cursorPos = clampedPosition;
  }

  /// @copydoc VIEW_CONTROLS::CursorWarp()
  override WarpMouseCursor(
    aPosition: VECTOR2D,
    aWorldCoordinates = false,
    aWarpView = false,
  ): void {
    if (aWorldCoordinates) {
      const screenSize = this.m_view.GetGAL().GetScreenPixelSize();
      const screen = new BOX2I({ x: 0, y: 0 }, screenSize);
      const clampedPosition = GetClampedCoords(aPosition);
      const screenPos = this.m_view.ToScreen(clampedPosition);

      if (!screen.Contains(screenPos)) {
        if (aWarpView) {
          this.m_view.SetCenter(clampedPosition);
          KIPLATFORM_UI.WarpPointer(
            this.m_parentPanel,
            Math.trunc(screenSize.x / 2),
            Math.trunc(screenSize.y / 2),
          );
        }
      } else {
        KIPLATFORM_UI.WarpPointer(this.m_parentPanel, screenPos.x, screenPos.y);
      }
    } else {
      KIPLATFORM_UI.WarpPointer(this.m_parentPanel, aPosition.x, aPosition.y);
    }

    // If we are not refreshing because of mouse movement, don't set the modifiers because we
    // are refreshing for keyboard movement, which uses the same modifiers for other actions
    this.refreshMouse(this.m_updateCursor);
  }

  /// @copydoc VIEW_CONTROLS::CenterOnCursor()
  override CenterOnCursor(): void {
    const screenSize = this.m_view.GetGAL().GetScreenPixelSize();
    // VECTOR2I / 2, then to VECTOR2D
    const screenCenter: VECTOR2D = {
      x: Math.trunc(screenSize.x / 2),
      y: Math.trunc(screenSize.y / 2),
    };

    const mp = this.GetMousePosition(false);

    if (mp.x !== screenCenter.x || mp.y !== screenCenter.y) {
      const newCenter = this.GetCursorPosition();

      if (KIPLATFORM_UI.WarpPointer(this.m_parentPanel, screenCenter.x, screenCenter.y)) {
        this.m_view.SetCenter(newCenter);
        this.m_dragStartPoint = screenCenter;
      }
    }
  }

  override PinCursorInsideNonAutoscrollArea(aWarpMouseCursor: boolean): void {
    let border = Math.trunc(
      Math.min(
        this.m_settings.m_autoPanMargin * this.m_view.GetScreenPixelSize().x,
        this.m_settings.m_autoPanMargin * this.m_view.GetScreenPixelSize().y,
      ),
    );
    border += 2;

    let topLeft: VECTOR2D = { x: border, y: border };
    let botRight: VECTOR2D = {
      x: this.m_view.GetScreenPixelSize().x - border,
      y: this.m_view.GetScreenPixelSize().y - border,
    };

    topLeft = this.m_view.ToWorld(topLeft);
    botRight = this.m_view.ToWorld(botRight);

    const pos = { ...this.GetMousePosition(true) };

    if (pos.x < topLeft.x) pos.x = topLeft.x;
    else if (pos.x > botRight.x) pos.x = botRight.x;

    if (pos.y < topLeft.y) pos.y = topLeft.y;
    else if (pos.y > botRight.y) pos.y = botRight.y;

    this.SetCursorPosition(pos, false, false, 0);

    if (aWarpMouseCursor) this.WarpMouseCursor(pos, true);
  }

  private handleAutoPanning(aEvent: wxMouseEvent): boolean {
    const p: VECTOR2I = { x: aEvent.GetX(), y: aEvent.GetY() };
    const pk = this.m_view.ToScreen(this.m_settings.m_lastKeyboardCursorPosition);
    const pKey: VECTOR2I = { x: Math.trunc(pk.x), y: Math.trunc(pk.y) };

    if (
      this.m_cursorWarped ||
      (this.m_settings.m_lastKeyboardCursorPositionValid && p.x === pKey.x && p.y === pKey.y)
    ) {
      // last cursor move event came from keyboard cursor control. If auto-panning is enabled
      // and the next position is inside the autopan zone, check if it really came from a mouse
      // event, otherwise disable autopan temporarily. Also temporarily disable autopan if the
      // cursor is in the autopan zone because the application warped the cursor.

      this.m_cursorWarped = false;
      return true;
    }

    this.m_cursorWarped = false;

    // Compute areas where autopanning is active
    let borderStart = Math.trunc(
      Math.min(
        this.m_settings.m_autoPanMargin * this.m_view.GetScreenPixelSize().x,
        this.m_settings.m_autoPanMargin * this.m_view.GetScreenPixelSize().y,
      ),
    );
    borderStart = Math.max(borderStart, 2);
    const borderEndX = this.m_view.GetScreenPixelSize().x - borderStart;
    const borderEndY = this.m_view.GetScreenPixelSize().y - borderStart;

    const panDirection = { ...this.m_panDirection };

    if (p.x < borderStart) panDirection.x = -(borderStart - p.x);
    else if (p.x > borderEndX) panDirection.x = p.x - borderEndX;
    else panDirection.x = 0;

    if (p.y < borderStart) panDirection.y = -(borderStart - p.y);
    else if (p.y > borderEndY) panDirection.y = p.y - borderEndY;
    else panDirection.y = 0;

    this.m_panDirection = panDirection;

    const borderHit = panDirection.x !== 0 || panDirection.y !== 0;

    switch (this.m_state) {
      case STATE.AUTO_PANNING:
        if (!borderHit) {
          this.m_panTimer.Stop();
          this.setState(STATE.IDLE);

          return false;
        }

        return true;

      case STATE.IDLE:
        if (borderHit) {
          this.setState(STATE.AUTO_PANNING);
          this.m_panTimer.Start(Math.trunc(250.0 / 60.0), true);

          return true;
        }

        return false;

      case STATE.DRAG_PANNING:
      case STATE.DRAG_ZOOMING:
        return false;
    }

    console.assert(false, 'This line should never be reached');
    return false;
  }

  private handleCursorCapture(x: number, y: number): void {
    if (this.m_settings.m_cursorCaptured) {
      let warp = false;
      const parentSize = this.m_parentPanel.GetClientSize();

      if (x < 0) {
        x = 0;
        warp = true;
      } else if (x >= parentSize.x) {
        x = parentSize.x - 1;
        warp = true;
      }

      if (y < 0) {
        y = 0;
        warp = true;
      } else if (y >= parentSize.y) {
        y = parentSize.y - 1;
        warp = true;
      }

      if (warp) KIPLATFORM_UI.WarpPointer(this.m_parentPanel, x, y);
    }
  }

  private refreshMouse(aSetModifiers: boolean): void {
    // Notify tools that the cursor position has changed in the world coordinates
    const moveEvent = new wxMouseEvent(WX_VIEW_CONTROLS.EVT_REFRESH_MOUSE);
    const msp = this.getMouseScreenPosition();
    moveEvent.SetX(msp.x);
    moveEvent.SetY(msp.y);

    if (aSetModifiers) {
      // Set the modifiers state
      moveEvent.SetControlDown(wxGetKeyState(WXK.WXK_CONTROL));
      moveEvent.SetShiftDown(wxGetKeyState(WXK.WXK_SHIFT));
      moveEvent.SetAltDown(wxGetKeyState(WXK.WXK_ALT));
    }

    this.m_cursorPos = GetClampedCoords(this.m_view.ToWorld({ x: msp.x, y: msp.y }));
    this.m_parentPanel.PostEvent(moveEvent);
  }

  private getMouseScreenPosition(): { x: number; y: number } {
    const msp = KIPLATFORM_UI.GetMousePosition();
    return this.m_parentPanel.ScreenToClient(msp);
  }

  /// Adjusts the scrollbars position to match the current viewport.
  UpdateScrollbars(): void {
    const viewport = this.m_view.GetViewport();
    const boundary = this.m_view.GetBoundary();

    this.m_scrollScale = {
      x: 2e3 / viewport.GetWidth(), // TODO it does not have to be updated so often
      y: 2e3 / viewport.GetHeight(),
    };
    const newScroll: VECTOR2I = {
      x: Math.trunc((viewport.Centre().x - boundary.GetLeft()) * this.m_scrollScale.x),
      y: Math.trunc((viewport.Centre().y - boundary.GetTop()) * this.m_scrollScale.y),
    };

    // We add the width of the scroll bar thumb to the range because the scroll range is given by
    // the full bar while the position is given by the left/top position of the thumb
    const newRange: VECTOR2I = {
      x: Math.trunc(
        this.m_scrollScale.x * boundary.GetWidth() +
          this.m_parentPanel.GetScrollThumb(wxOrientation.wxHORIZONTAL),
      ),
      y: Math.trunc(
        this.m_scrollScale.y * boundary.GetHeight() +
          this.m_parentPanel.GetScrollThumb(wxOrientation.wxVERTICAL),
      ),
    };

    // Flip scroll direction in flipped view
    if (this.m_view.IsMirroredX())
      newScroll.x = Math.trunc((boundary.GetRight() - viewport.Centre().x) * this.m_scrollScale.x);

    // Adjust scrollbars only if it is needed. Otherwise there are cases when canvas is continuously
    // refreshed (Windows)
    if (
      this.m_scrollPos.x !== newScroll.x ||
      this.m_scrollPos.y !== newScroll.y ||
      newRange.x !== this.m_parentPanel.GetScrollRange(wxOrientation.wxHORIZONTAL) ||
      newRange.y !== this.m_parentPanel.GetScrollRange(wxOrientation.wxVERTICAL)
    ) {
      this.m_parentPanel.SetScrollbars(
        1,
        1,
        newRange.x,
        newRange.y,
        newScroll.x,
        newScroll.y,
        true,
      );
      this.m_scrollPos = newScroll;

      // Trigger a mouse refresh to get the canvas update in GTK (re-draws the scrollbars).
      // Note that this causes an infinite loop on OSX and Windows (in certain cases) as it
      // generates a paint event.
      this.refreshMouse(false);
    }
  }

  override ForceCursorPosition(aEnabled: boolean, aPosition: VECTOR2D = { x: 0, y: 0 }): void {
    const clampedPosition = GetClampedCoords(aPosition);

    this.m_settings.m_forceCursorPosition = aEnabled;
    this.m_settings.m_forcedPosition = clampedPosition;
  }
}
