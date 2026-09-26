// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::VC_SETTINGS` and `KIGFX::VIEW_CONTROLS` (include/view/view_controls.h,
 * common/view/view_controls.cpp): the abstract interface for the controls of
 * a view (cursor, panning, zooming), which a tool's state saves and restores
 * through the TOOL_MANAGER. The canvas-bound `WX_VIEW_CONTROLS` sits on it.
 */
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import { MOUSE_DRAG_ACTION } from '../mouse_drag_action.js';
import type { VIEW } from './view.js';

/** `ACTIONS::CURSOR_NONE`: the cursor command a fresh VC_SETTINGS remembers. */
const CURSOR_NONE = 0;

/**
 * Structure to keep VIEW_CONTROLS settings for easy store/restore operations.
 */
export class VC_SETTINGS {
  /// Flag determining the cursor visibility.
  m_showCursor!: boolean;

  /// Forced cursor position (world coordinates).
  m_forcedPosition!: VECTOR2D;

  /// Is the forced cursor position enabled.
  m_forceCursorPosition!: boolean;

  /// Should the cursor be locked within the parent window area.
  m_cursorCaptured!: boolean;

  /// Should the cursor snap to grid or move freely.
  m_snappingEnabled!: boolean;

  /// Flag for grabbing the mouse cursor.
  m_grabMouse!: boolean;

  /// Flag for turning on autopanning.
  m_focusFollowSchPcb!: boolean;

  /// Flag for turning on autopanning.
  m_autoPanEnabled!: boolean;

  /// Flag for turning on autopanning.
  m_autoPanSettingEnabled!: boolean;

  /// Distance from cursor to VIEW edge when panning is active.
  m_autoPanMargin!: number;

  /// How fast is panning when in auto mode.
  m_autoPanSpeed!: number;

  /// How fast does panning accelerate when approaching the window boundary.
  m_autoPanAcceleration!: number;

  /// If the cursor is allowed to be warped.
  m_warpCursor!: boolean;

  /// Enable horizontal panning with the horizontal scroll/trackpad input.
  m_horizontalPan!: boolean;

  /// Enable the accelerating zoom controller.
  m_zoomAcceleration!: boolean;

  /// Zoom speed for the non-accelerating zoom controller.
  m_zoomSpeed!: number;

  /// When true, ignore zoom_speed and pick a platform-specific default.
  m_zoomSpeedAuto!: boolean;

  /// What modifier key to enable zoom with the (vertical) scroll wheel.
  m_scrollModifierZoom!: number;

  /// What modifier key to enable horizontal pan with the (vertical) scroll wheel.
  m_scrollModifierPanH!: number;

  /// What modifier key to enable vertical with the (vertical) scroll wheel.
  m_scrollModifierPanV!: number;

  /// What modifier key to enable pan with the mouse motion.
  m_motionPanModifier!: number;

  m_dragLeft!: MOUSE_DRAG_ACTION;
  m_dragMiddle!: MOUSE_DRAG_ACTION;
  m_dragRight!: MOUSE_DRAG_ACTION;

  /// Is last cursor motion event coming from keyboard arrow cursor control.
  m_lastKeyboardCursorPositionValid!: boolean;

  /// ACTIONS::CURSOR_UP, ACTIONS::CURSOR_DOWN, etc.
  m_lastKeyboardCursorCommand!: number;

  /// Position of the above event.
  m_lastKeyboardCursorPosition!: VECTOR2D;

  /// Whether to invert the scroll wheel zoom direction.
  m_scrollReverseZoom!: boolean;

  /// Whether to invert the scroll wheel pan direction.
  m_scrollReversePanH!: boolean;

  constructor() {
    this.Reset();
  }

  /// Restore the default settings.
  Reset(): void {
    this.m_showCursor = false;
    this.m_forcedPosition = { x: 0.0, y: 0.0 };
    this.m_forceCursorPosition = false;
    this.m_cursorCaptured = false;
    this.m_snappingEnabled = true;
    this.m_grabMouse = false;
    this.m_focusFollowSchPcb = false;
    this.m_autoPanEnabled = false;
    this.m_autoPanSettingEnabled = false;
    this.m_autoPanMargin = 0.02;
    this.m_autoPanSpeed = 0.15;
    this.m_autoPanAcceleration = 5.0;
    this.m_warpCursor = false;
    this.m_horizontalPan = false;
    this.m_zoomAcceleration = false;
    this.m_zoomSpeed = 5;
    this.m_zoomSpeedAuto = true;
    this.m_scrollModifierZoom = 0;
    this.m_scrollModifierPanH = WXK.WXK_CONTROL;
    this.m_scrollModifierPanV = WXK.WXK_SHIFT;
    this.m_motionPanModifier = 0;
    this.m_dragLeft = MOUSE_DRAG_ACTION.NONE;
    this.m_dragMiddle = MOUSE_DRAG_ACTION.PAN;
    this.m_dragRight = MOUSE_DRAG_ACTION.PAN;
    this.m_lastKeyboardCursorPositionValid = false;
    this.m_lastKeyboardCursorPosition = { x: 0.0, y: 0.0 };
    this.m_lastKeyboardCursorCommand = CURSOR_NONE;
    this.m_scrollReverseZoom = false;
    this.m_scrollReversePanH = false;
  }

  /** The copy a `VC_SETTINGS` assignment makes. */
  clone(): VC_SETTINGS {
    const c = new VC_SETTINGS();
    c.assign(this);
    return c;
  }

  assign(aOther: VC_SETTINGS): this {
    Object.assign(this, aOther);
    this.m_forcedPosition = { ...aOther.m_forcedPosition };
    this.m_lastKeyboardCursorPosition = { ...aOther.m_lastKeyboardCursorPosition };
    return this;
  }
}

/**
 * An interface for classes handling user events controlling the view behavior
 * (such as zooming, panning, mouse grab, etc.)
 */
export abstract class VIEW_CONTROLS {
  protected m_view: VIEW;

  /// Application warped the cursor, not the user (keyboard).
  protected m_cursorWarped: boolean;

  /// Current VIEW_CONTROLS settings.
  protected m_settings = new VC_SETTINGS();

  constructor(aView: VIEW) {
    this.m_view = aView;
    this.m_cursorWarped = false;
  }

  /**
   * Turn on/off mouse grabbing.
   *
   * When the mouse is grabbed, it cannot go outside the VIEW.
   *
   * @param aEnabled tells if mouse should be grabbed or not.
   */
  SetGrabMouse(aEnabled: boolean): void {
    this.m_settings.m_grabMouse = aEnabled;
  }

  /**
   * Turn on/off auto panning (this feature is used when there is a tool active (eg. drawing a
   * track) and user moves mouse to the VIEW edge - then the view can be translated or not).
   *
   * @param aEnabled tells if the autopanning should be active.
   */
  SetAutoPan(aEnabled: boolean): void {
    this.m_settings.m_autoPanEnabled = aEnabled;
  }

  /**
   * Turn on/off auto panning (user setting to disable it entirely).
   *
   * @param aEnabled tells if the autopanning should be enabled.
   */
  EnableAutoPan(aEnabled: boolean): void {
    this.m_settings.m_autoPanSettingEnabled = aEnabled;
  }

  /**
   * Set the speed of autopanning.
   *
   * @param aSpeed is a new speed for autopanning.
   */
  SetAutoPanSpeed(aSpeed: number): void {
    this.m_settings.m_autoPanSpeed = aSpeed;
  }

  /**
   * Set the speed of autopanning.
   *
   * @param aSpeed is a new speed for autopanning.
   */
  SetAutoPanAcceleration(aAcceleration: number): void {
    this.m_settings.m_autoPanAcceleration = aAcceleration;
  }

  /**
   * Set the margin for autopanning (ie. the area when autopanning becomes active).
   *
   * @param aMargin is a new margin for autopanning.
   */
  SetAutoPanMargin(aMargin: number): void {
    this.m_settings.m_autoPanMargin = aMargin;
  }

  /**
   * If enabled (@see SetEnableCursorWarping(), warps the cursor to the specified position,
   * expressed in world coordinates.
   */
  abstract PinCursorInsideNonAutoscrollArea(aWarpMouseCursor: boolean): void;

  /**
   * Return the current mouse pointer position.
   *
   * @note The position may be different from the cursor position if snapping is enabled
   *       (@see GetCursorPosition()).
   *
   * @param aWorldCoordinates if true, the result is given in world coordinates, otherwise
   *                          it is given in screen coordinates.
   * @return The current mouse pointer position in either world or screen coordinates.
   */
  abstract GetMousePosition(aWorldCoordinates?: boolean): VECTOR2D;

  /**
   * Return the current cursor position in world coordinates.
   *
   * @note The position may be different from the mouse pointer position if snapping is
   *       enabled or cursor position is forced to a specific point.
   *
   * @return The current cursor position in world coordinates.
   */
  GetCursorPosition(): VECTOR2D;
  GetCursorPosition(aEnableSnapping: boolean): VECTOR2D;
  GetCursorPosition(aEnableSnapping?: boolean): VECTOR2D {
    return this.getCursorPosition(aEnableSnapping ?? this.m_settings.m_snappingEnabled);
  }

  /**
   * Return the current cursor position in world coordinates ignoring the cursorUp
   * position force mode.
   */
  abstract GetRawCursorPosition(aSnappingEnabled?: boolean): VECTOR2D;

  /** `GetCursorPosition( bool aEnableSnapping )`, the pure virtual half. */
  protected abstract getCursorPosition(aEnableSnapping: boolean): VECTOR2D;

  /**
   * Place the cursor immediately at a given point. Mouse movement is ignored.
   *
   * @param aEnabled enable forced cursor position
   * @param aPosition the position (world coordinates).
   */
  ForceCursorPosition(aEnabled: boolean, aPosition: VECTOR2D = { x: 0, y: 0 }): void {
    this.m_settings.m_forceCursorPosition = aEnabled;
    this.m_settings.m_forcedPosition = { ...aPosition };
  }

  /**
   * Move cursor to the requested position expressed in world coordinates.
   *
   * The position is not forced and will be overridden with the next mouse motion event.
   * Mouse cursor follows the world cursor.
   *
   * @param aPosition is the requested cursor position in the world coordinates.
   * @param aWarpView enables/disables view warp if the cursor is outside the current viewport.
   */
  abstract SetCursorPosition(
    aPosition: VECTOR2D,
    aWarpView?: boolean,
    aTriggeredByArrows?: boolean,
    aArrowCommand?: number,
  ): void;

  /**
   * Move the graphic crosshair cursor to the requested position expressed in world coordinates.
   *
   * @param aPosition is the requested cursor position, expressed in world coordinates.
   * @param aWarpView enables/disables view warp if the cursor is outside the current viewport.
   */
  abstract SetCrossHairCursorPosition(aPosition: VECTOR2D, aWarpView?: boolean): void;

  /**
   * Enable or disables display of cursor.
   *
   * @param aEnabled decides if the cursor should be shown.
   */
  ShowCursor(aEnabled: boolean): void {
    this.m_settings.m_showCursor = aEnabled;
    this.m_view.GetGAL().SetCursorEnabled(aEnabled);
  }

  /**
   * Return true when cursor is visible.
   *
   * @return True if cursor is visible.
   */
  IsCursorShown(): boolean {
    // this only says if the VIEW_CONTROLS say the cursor should be
    // shown: m_view->GetGAL()->IsCursorEnabled() will say if the GAL is
    // actually going to do show the cursor or not
    return this.m_settings.m_showCursor;
  }

  /**
   * Force the cursor to stay within the drawing panel area.
   *
   * @param aEnabled determines if the cursor should be captured.
   */
  CaptureCursor(aEnabled: boolean): void {
    this.m_settings.m_cursorCaptured = aEnabled;
  }

  /**
   * If enabled (@see SetEnableCursorWarping(), warps the cursor to the specified position,
   * expressed either in the screen coordinates or the world coordinates.
   *
   * @param aPosition is the position where the cursor should be warped.
   * @param aWorldCoordinates if true treats aPosition as the world coordinates, otherwise it
   *                          uses it as the screen coordinates.
   * @param aWarpView determines if the view can be warped too (only matters if the position is
   *                  specified in the world coordinates and its not visible in the current
   *                  viewport).
   */
  abstract WarpMouseCursor(
    aPosition: VECTOR2D,
    aWorldCoordinates?: boolean,
    aWarpView?: boolean,
  ): void;

  /**
   * Enable or disable warping the cursor.
   *
   * @param aEnable is true if the cursor is allowed to be warped.
   */
  EnableCursorWarping(aEnable: boolean): void {
    this.m_settings.m_warpCursor = aEnable;
  }

  /**
   * @return the current setting for cursor warping.
   */
  IsCursorWarpingEnabled(): boolean {
    return this.m_settings.m_warpCursor;
  }

  /**
   * Set the viewport center to the current cursor position and warps the cursor to the
   * screen center.
   */
  abstract CenterOnCursor(): void;

  /**
   * Restore the default VIEW_CONTROLS settings.
   */
  Reset(): void {
    // Get the default settings from the default constructor
    const dummy = new VC_SETTINGS();
    this.ApplySettings(dummy);
  }

  ///< Return the current VIEW_CONTROLS settings.
  GetSettings(): VC_SETTINGS {
    return this.m_settings;
  }

  ///< Apply VIEW_CONTROLS settings.
  ApplySettings(aSettings: VC_SETTINGS): void {
    this.ShowCursor(aSettings.m_showCursor);
    this.CaptureCursor(aSettings.m_cursorCaptured);
    this.SetGrabMouse(aSettings.m_grabMouse);
    this.SetAutoPan(aSettings.m_autoPanEnabled);
    this.SetAutoPanMargin(aSettings.m_autoPanMargin);
    this.SetAutoPanSpeed(aSettings.m_autoPanSpeed);
    this.ForceCursorPosition(aSettings.m_forceCursorPosition, aSettings.m_forcedPosition);
  }

  ///< Load new settings from program common settings.
  LoadSettings(): void {}
}
