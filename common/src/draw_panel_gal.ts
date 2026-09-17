// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/class_draw_panel_gal.h` + `common/draw_panel_gal.cpp`:
 * `EDA_DRAW_PANEL_GAL`, the canvas that owns the GAL, the VIEW, the PAINTER
 * and the VIEW_CONTROLS, repaints them and forwards its events to the tool
 * dispatcher.
 *
 * The wxScrolledCanvas is an `HTMLCanvasElement` here: the panel adopts the
 * element, binds the DOM events and turns them into the `wxEvent`s the
 * handler chain reads (`wx/dom_events.ts`), runs its timers on the browser's
 * and its idle handler on `requestAnimationFrame`.
 */

import type { BITMAP_BASE } from './bitmap_base.js';
import type { EDA_DRAW_FRAME } from './eda_draw_frame.js';
import { FRAME_T } from './frame_type.js';
import { KICURSOR } from './gal/cursors.js';
import { RENDER_TARGET } from './gal/definitions.js';
import type { GAL_DISPLAY_OPTIONS } from './gal/gal_display_options.js';
import { GAL, GAL_CONTEXT_LOCKER, GAL_DRAWING_CONTEXT } from './gal/graphics_abstraction_layer.js';
import { OPENGL_GAL, type OPENGL_GAL_CANVAS } from './gal/opengl/opengl_gal.js';
import type { PAINTER } from './gal/painter.js';
import * as KIPLATFORM_UI from './kiplatform/ui.js';
import { Pgm } from './pgm_base.js';
import { VIEW } from './view/view.js';
import { VC_SETTINGS } from './view/view_controls.js';
import { VIEW_OVERLAY } from './view/view_overlay.js';
import { WX_VIEW_CONTROLS, type WX_VIEW_CONTROLS_FRAME } from './view/wx_view_controls.js';
import { KIUI_IsInputControlFocused, KIUI_IsModalDialogFocused } from './widgets/ui_common.js';
import type { MSG_PANEL_ITEM } from './widgets/msgpanel.js';
import {
  clientPosition,
  wxKeyEventFromDom,
  wxMouseEventFromDom,
  wxWheelEventFromDom,
} from './wx/dom_events.js';
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
  wxEVT_ENTER_WINDOW,
  wxEVT_IDLE,
  wxEVT_KILL_FOCUS,
  wxEVT_LEAVE_WINDOW,
  wxEVT_LEFT_DCLICK,
  wxEVT_LEFT_DOWN,
  wxEVT_LEFT_UP,
  wxEVT_MAGNIFY,
  wxEVT_MIDDLE_DCLICK,
  wxEVT_MIDDLE_DOWN,
  wxEVT_MIDDLE_UP,
  wxEVT_MOTION,
  wxEVT_MOUSEWHEEL,
  wxEVT_PAINT,
  wxEVT_RIGHT_DCLICK,
  wxEVT_RIGHT_DOWN,
  wxEVT_RIGHT_UP,
  wxEVT_SHOW,
  wxEVT_SIZE,
  wxEVT_TIMER,
  type wxEventType,
  wxFocusEvent,
  type wxOrientation,
  wxShowEvent,
  wxSizeEvent,
  wxTimer,
  type wxTimerEvent,
} from './wx/wx_event.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2 as VECTOR2D, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * `TOOL_DISPATCHER` as the panel drives it (`common/tool/tool_dispatcher.h`):
 * every canvas event goes through `DispatchWxEvent`, and a lost focus resets
 * its button state. The class is stage 3's; this is its surface.
 */
export interface TOOL_DISPATCHER {
  DispatchWxEvent(aEvent: wxEvent): void;
  ResetState(): void;
}

/**
 * What the application supplies with the canvas element: the platform pieces
 * a wxWindow has and a browser canvas does not — the cursor art
 * (`CURSOR_STORE::GetCursor` as a CSS value), the bitmap font atlas and
 * the decoded images for `DrawBitmap`.
 */
export interface DRAW_PANEL_GAL_WINDOW {
  /** The element the panel adopts. */
  readonly canvas: HTMLCanvasElement;
  /** `wxWindow::SetCursor( CURSOR_STORE::GetCursor( aCursor, aHiDPI ) )`: the CSS `cursor` value. */
  GetCursorCss(aCursor: KICURSOR, aHiDPI: boolean): string;
  /** `font_image.pixels`, decoded and ready to upload. */
  GetBitmapFontImage(): TexImageSource;
  /** `wxImage`s for DrawBitmap, decoded from the BITMAP_BASE's data. */
  GetBitmapImage?(aBitmap: BITMAP_BASE): TexImageSource | null;
}

/** `wxWindow` as the panel walks its parents: the frame, or a dialog with a parent. */
export interface DRAW_PANEL_GAL_PARENT {
  GetParent(): DRAW_PANEL_GAL_PARENT | null;
}

/** `GAL_TYPE`. */
export enum GAL_TYPE {
  GAL_TYPE_UNKNOWN = -1, ///< not specified: a GAL engine must be set by the client
  GAL_TYPE_NONE = 0, ///< GAL not used (the legacy wxDC engine is used)
  GAL_TYPE_OPENGL, ///< OpenGL implementation
  GAL_TYPE_CAIRO, ///< Cairo implementation
  GAL_TYPE_LAST, ///< Sentinel, do not use as a parameter
}

/** The DOM's `pointerType` for a mouse. */
const POINTER_MOUSE = 'mouse';

/**
 * `wxGetLocalTimeMillis()`.
 */
function wxGetLocalTimeMillis(): number {
  return Date.now();
}

/**
 * The GAL-based canvas.
 */
export class EDA_DRAW_PANEL_GAL implements OPENGL_GAL_CANVAS {
  // Cairo doesn't work on OSX so we really have no fallback available.
  // (there is no Cairo GAL in the browser either)
  static readonly GAL_FALLBACK = GAL_TYPE.GAL_TYPE_OPENGL;
  static readonly GAL_FALLBACK_AVAILABLE =
    EDA_DRAW_PANEL_GAL.GAL_FALLBACK !== GAL_TYPE.GAL_TYPE_OPENGL;

  m_MouseCapturedLost: boolean;

  /** `PROF_COUNTER( "Draw panel paint events" )`. */
  m_PaintEventCounter = 0;

  /// The wxScrolledCanvas: the element the panel adopted.
  readonly window: DRAW_PANEL_GAL_WINDOW;
  readonly gl: WebGL2RenderingContext;

  /// Pointer to the parent window
  protected m_parent: DRAW_PANEL_GAL_PARENT | EDA_DRAW_FRAME | null;

  /// Parent EDA_DRAW_FRAME (if available)
  protected m_edaFrame: EDA_DRAW_FRAME | null;

  /// Timestamp of the last repaint start
  protected m_lastRepaintStart: number;

  /// Timestamp of the last repaint end
  protected m_lastRepaintEnd: number;

  /// Timer to prevent too-frequent refreshing
  protected m_refreshTimer: wxTimer;

  /// Blocks multiple calls to the draw
  protected m_refreshMutex = false;

  /// True if GAL is currently redrawing the view
  protected m_drawing: boolean;

  /// Flag that determines if VIEW may use GAL for redrawing the screen.
  protected m_drawingEnabled: boolean;

  /// True when canvas needs to be refreshed from idle handler
  protected m_needIdleRefresh: boolean;

  /// Last cursor position sent to GAL for drawing
  protected m_lastCursorPosition: VECTOR2D;

  /// Interface for drawing objects on a 2D-surface
  protected m_gal: GAL | null;

  /// Stores view settings (scale, center, etc.) and items to be drawn
  protected m_view: VIEW | null;

  /// Contains information about how to draw items using GAL
  protected m_painter: PAINTER | null;

  /// Control for VIEW (moving, zooming, etc.)
  protected m_viewControls: WX_VIEW_CONTROLS | null;

  /// Currently used GAL
  protected m_backend: GAL_TYPE;
  protected m_options: GAL_DISPLAY_OPTIONS;

  /// Processes and forwards events to tools
  protected m_eventDispatcher: TOOL_DISPATCHER | null;

  /// Flag to indicate that focus should be regained on the next mouse event. It is a workaround
  /// for cases when the panel loses keyboard focus, so it does not react to hotkeys anymore.
  protected m_lostFocus: boolean;

  /// Set after an OpenGL recovery attempt to prevent infinite retry loops
  protected m_glRecoveryAttempted: boolean;

  /// Flag to indicate whether the panel should take focus at certain times (when moused over,
  /// and on various mouse/key events)
  protected m_stealsFocus: boolean;

  protected m_statusPopup: { HasFocus(): boolean } | null;

  /// Optional overlay for drawing transient debug objects
  protected m_debugOverlay: VIEW_OVERLAY | null = null;

  /// The dynamic event table: `wxEvtHandler::Connect`, searched most-recent first.
  private readonly m_handlers = new Map<wxEventType, ((aEvent: wxEvent) => void)[]>();

  /// The paint and idle handlers are connected by ForceRefresh and disconnected by StopDrawing.
  private m_paintConnected = false;

  /// The DOM listeners installed on the element, for the destructor.
  private m_domListeners: (() => void)[] = [];

  /// `wxEVT_IDLE`: one animation frame per request.
  private m_idleHandle: number | null = null;

  /// `wxEVT_SIZE`: the element's size observer.
  private m_resizeObserver: ResizeObserver | null = null;

  /// Whether the element is shown (`IsShownOnScreen`), tracked by an intersection observer.
  private m_shown = true;

  /// `wxScrolledCanvas` scrollbar state, for UpdateScrollbars.
  private m_scrollRange: VECTOR2I = { x: 0, y: 0 };
  private m_scrollThumb: VECTOR2I = { x: 0, y: 0 };
  private m_scrollPos: VECTOR2I = { x: 0, y: 0 };

  constructor(
    aParentWindow: DRAW_PANEL_GAL_PARENT | EDA_DRAW_FRAME | null,
    aWindow: DRAW_PANEL_GAL_WINDOW,
    aOptions: GAL_DISPLAY_OPTIONS,
    aGalType: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL,
  ) {
    this.window = aWindow;
    this.m_MouseCapturedLost = false;
    this.m_parent = aParentWindow;
    this.m_edaFrame = null;
    this.m_lastRepaintStart = 0;
    this.m_lastRepaintEnd = 0;
    this.m_drawing = false;
    this.m_drawingEnabled = false;
    this.m_needIdleRefresh = false;
    this.m_lastCursorPosition = { x: 0, y: 0 };
    this.m_gal = null;
    this.m_view = null;
    this.m_painter = null;
    this.m_viewControls = null;
    this.m_backend = GAL_TYPE.GAL_TYPE_NONE;
    this.m_options = aOptions;
    this.m_eventDispatcher = null;
    this.m_lostFocus = false;
    this.m_glRecoveryAttempted = false;
    this.m_stealsFocus = true;
    this.m_statusPopup = null;

    // wxGLCanvas: the context with depth, stencil and no premultiplied alpha
    const gl = aWindow.canvas.getContext('webgl2', {
      depth: true,
      stencil: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) throw new Error('Could not use OpenGL: WebGL2 is unavailable');

    this.gl = gl;

    // ShowScrollbars( show_scrollbars ? wxSHOW_SB_ALWAYS : wxSHOW_SB_NEVER ): the element
    // has none; the scroll state is kept for the view controls.

    this.m_edaFrame = isEdaDrawFrame(this.m_parent) ? this.m_parent : null;

    // If we're in a dialog, we have to go looking for our parent frame
    if (!this.m_edaFrame) {
      let ancestor = this.m_parent ? (this.m_parent as DRAW_PANEL_GAL_PARENT).GetParent?.() : null;

      while (ancestor && !isEdaDrawFrame(ancestor)) ancestor = ancestor.GetParent();

      if (ancestor) this.m_edaFrame = isEdaDrawFrame(ancestor) ? ancestor : null;
    }

    this.SwitchBackend(aGalType);
    // SetBackgroundStyle( wxBG_STYLE_CUSTOM )
    // EnableScrolling( false, false ); // otherwise Zoom Auto disables GAL canvas
    KIPLATFORM_UI.SetOverlayScrolling(this, false); // Prevent excessive repaint on GTK
    KIPLATFORM_UI.ImmControl(this, false); // Ensure our panel can't suck in IME events

    this.Connect(wxEVT_SIZE, (e) => this.onSize(e as wxSizeEvent));
    this.Connect(wxEVT_ENTER_WINDOW, (e) => this.onEnter(e));
    this.Connect(wxEVT_KILL_FOCUS, (e) => this.onLostFocus(e as wxFocusEvent));

    const events: wxEventType[] = [
      // Binding both EVT_CHAR and EVT_CHAR_HOOK ensures that all key events,
      // especially special key like arrow keys, are handled by the GAL event dispatcher,
      // and not sent to GUI without filtering, because they have a default action (scroll)
      // that must not be called.
      wxEVT_LEFT_UP,
      wxEVT_LEFT_DOWN,
      wxEVT_LEFT_DCLICK,
      wxEVT_RIGHT_UP,
      wxEVT_RIGHT_DOWN,
      wxEVT_RIGHT_DCLICK,
      wxEVT_MIDDLE_UP,
      wxEVT_MIDDLE_DOWN,
      wxEVT_MIDDLE_DCLICK,
      wxEVT_AUX1_UP,
      wxEVT_AUX1_DOWN,
      wxEVT_AUX1_DCLICK,
      wxEVT_AUX2_UP,
      wxEVT_AUX2_DOWN,
      wxEVT_AUX2_DCLICK,
      wxEVT_MOTION,
      wxEVT_MOUSEWHEEL,
      wxEVT_CHAR,
      wxEVT_CHAR_HOOK,
      wxEVT_MAGNIFY,
      WX_VIEW_CONTROLS.EVT_REFRESH_MOUSE,
    ];

    for (const eventType of events) this.Connect(eventType, (e) => this.OnEvent(e));

    // Set up timer to detect when drawing starts
    this.m_refreshTimer = new wxTimer((e) => this.onRefreshTimer(e));

    this.Connect(wxEVT_SHOW, (e) => this.onShowEvent(e as wxShowEvent));

    this.bindDomEvents();
  }

  /** `~EDA_DRAW_PANEL_GAL`. */
  Destroy(): void {
    // Ensure EDA_DRAW_PANEL_GAL::onShowEvent is not fired during Dtor process
    this.Disconnect(wxEVT_SHOW);

    this.StopDrawing();

    console.assert(!this.m_drawing);

    for (const off of this.m_domListeners) off();
    this.m_domListeners = [];
    this.m_resizeObserver?.disconnect();
    this.m_resizeObserver = null;

    this.m_viewControls?.Destroy();
    this.m_viewControls = null;
    this.m_view = null;
    this.m_gal = null; // Ensure OnShow is not called
  }

  // ------------------------------------------------------------------
  // wxEvtHandler: the dynamic event table
  // ------------------------------------------------------------------

  /** `wxWindow::Connect( eventType, handler )`. */
  Connect(aEventType: wxEventType, aHandler: (aEvent: wxEvent) => void): void {
    let list = this.m_handlers.get(aEventType);

    if (!list) {
      list = [];
      this.m_handlers.set(aEventType, list);
    }

    list.push(aHandler);
  }

  /** `wxWindow::Disconnect( eventType, handler? )`: all of the type when no handler is given. */
  Disconnect(aEventType: wxEventType, aHandler?: (aEvent: wxEvent) => void): void {
    if (!aHandler) {
      this.m_handlers.delete(aEventType);
      return;
    }

    const list = this.m_handlers.get(aEventType);

    if (list) {
      const i = list.lastIndexOf(aHandler);

      if (i >= 0) list.splice(i, 1);
    }
  }

  /**
   * `wxEvtHandler::ProcessEvent`: the dynamically connected handlers, most
   * recently connected first; a handler that does not `Skip()` consumes the
   * event.
   *
   * @return true if the event was processed (not skipped by every handler).
   */
  ProcessEvent(aEvent: wxEvent): boolean {
    const list = this.m_handlers.get(aEvent.GetEventType());

    if (!list || list.length === 0) return false;

    for (let i = list.length - 1; i >= 0; --i) {
      aEvent.Skip(false);
      list[i]!(aEvent);

      if (!aEvent.GetSkipped()) return true;
    }

    return false;
  }

  /** `wxPostEvent( this, event )`: queued, processed from the event loop. */
  PostEvent(aEvent: wxEvent): void {
    setTimeout(() => {
      if (this.m_gal) this.ProcessEvent(aEvent);
    }, 0);
  }

  // ------------------------------------------------------------------
  // wxWindow
  // ------------------------------------------------------------------

  /** `wxWindow::GetHandle()`. */
  GetHandle(): HTMLElement {
    return this.window.canvas;
  }

  GetParent(): DRAW_PANEL_GAL_PARENT | EDA_DRAW_FRAME | null {
    return this.m_parent;
  }

  /**
   * `wxWindow::GetClientSize()`, in logical pixels: the panel is the element
   * the canvas sits in (the wxScrolledCanvas), the canvas its wxGLCanvas
   * child, which `ResizeScreen` sizes one pixel larger.
   */
  GetClientSize(): VECTOR2I {
    const c = this.window.canvas.parentElement ?? this.window.canvas;
    return { x: Math.trunc(c.clientWidth), y: Math.trunc(c.clientHeight) };
  }

  /** `wxWindow::ScreenToClient`: page coordinates into the element's. */
  ScreenToClient(aPoint: { x: number; y: number }): { x: number; y: number } {
    const rect = this.window.canvas.getBoundingClientRect();
    const sx = typeof window !== 'undefined' ? window.scrollX : 0;
    const sy = typeof window !== 'undefined' ? window.scrollY : 0;
    return { x: Math.trunc(aPoint.x - sx - rect.left), y: Math.trunc(aPoint.y - sy - rect.top) };
  }

  SetFocus(): void {
    KIPLATFORM_UI.ImeNotifyCancelComposition(this);
    this.window.canvas.focus({ preventScroll: true });
    this.m_lostFocus = false;
  }

  HasFocus(): boolean {
    return typeof document !== 'undefined' && document.activeElement === this.window.canvas;
  }

  StatusPopupHasFocus(): boolean {
    return !!this.m_statusPopup && this.m_statusPopup.HasFocus();
  }

  SetStatusPopup(aPopup: { HasFocus(): boolean } | null): void {
    this.m_statusPopup = aPopup;
  }

  /** `wxWindow::EnableTouchEvents`: the browser delivers no wx gesture events. */
  EnableTouchEvents(_aFlags: number): boolean {
    return false;
  }

  GetScrollThumb(aOrientation: wxOrientation): number {
    return aOrientation === 0x0004 ? this.m_scrollThumb.x : this.m_scrollThumb.y;
  }

  GetScrollRange(aOrientation: wxOrientation): number {
    return aOrientation === 0x0004 ? this.m_scrollRange.x : this.m_scrollRange.y;
  }

  SetScrollbars(
    _aPixelsPerUnitX: number,
    _aPixelsPerUnitY: number,
    aNoUnitsX: number,
    aNoUnitsY: number,
    aXPos: number,
    aYPos: number,
    _aNoRefresh: boolean,
  ): void {
    this.m_scrollRange = { x: aNoUnitsX, y: aNoUnitsY };
    this.m_scrollPos = { x: aXPos, y: aYPos };
    const size = this.GetClientSize();
    this.m_scrollThumb = { x: size.x, y: size.y };
  }

  // ------------------------------------------------------------------
  // OPENGL_GAL_CANVAS (HIDPI_GL_CANVAS / wxGLCanvas)
  // ------------------------------------------------------------------

  GetScaleFactor(): number {
    return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  }

  GetNativePixelSize(): VECTOR2I {
    return { x: this.window.canvas.width, y: this.window.canvas.height };
  }

  IsShownOnScreen(): boolean {
    const c = this.window.canvas;
    return this.m_shown && c.isConnected && c.clientWidth > 0 && c.clientHeight > 0;
  }

  SetCursor(aCursor: KICURSOR, aHiDPI: boolean): void {
    this.window.canvas.style.cursor = this.window.GetCursorCss(aCursor, aHiDPI);
  }

  PostPaint(): void {
    // wxPostEvent( m_paintListener, wxPaintEvent )
    setTimeout(() => {
      if (this.m_gal) this.onPaint();
    }, 0);
  }

  GetBitmapFontImage(): TexImageSource {
    return this.window.GetBitmapFontImage();
  }

  GetBitmapImage(aBitmap: BITMAP_BASE): TexImageSource | null {
    return this.window.GetBitmapImage ? this.window.GetBitmapImage(aBitmap) : null;
  }

  // ------------------------------------------------------------------

  /**
   * Switch method of rendering graphics.
   *
   * @param aGalType is the new rendering backend.
   * @return true if switch was successful, false otherwise.
   */
  SwitchBackend(aGalType: GAL_TYPE): boolean {
    // Do not do anything if the currently used GAL is correct
    if (aGalType === this.m_backend && this.m_gal !== null) return true;

    const grid_size: VECTOR2D = this.m_gal ? this.m_gal.GetGridSize() : { x: 0, y: 0 };
    const grid_visibility = this.m_gal ? this.m_gal.GetGridVisibility() : true;
    let result = true; // assume everything will be fine

    // Prevent refreshing canvas during backend switch
    this.StopDrawing();

    let new_gal: GAL | null = null;

    try {
      switch (aGalType) {
        case GAL_TYPE.GAL_TYPE_OPENGL: {
          const errormsg = OPENGL_GAL.CheckFeatures(this.m_options, this);

          if (errormsg.length === 0) {
            new_gal = new OPENGL_GAL(this.m_options, this);
          } else {
            // We're well and truly banjaxed if we get here without a fallback.
            console.warn(`Could not use OpenGL: ${errormsg}`);
          }

          break;
        }

        case GAL_TYPE.GAL_TYPE_CAIRO:
          // There is no Cairo in the browser.
          console.warn('Could not use Cairo: no software renderer');
          break;

        // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH in the C++
        default:
          console.assert(false);
        // warn about unhandled GAL canvas type, but continue with the fallback option
        case GAL_TYPE.GAL_TYPE_NONE:
          // KIGFX::GAL is a stub - it actually does cannot display anything,
          // but prevents code relying on GAL canvas existence from crashing
          new_gal = new GAL(this.m_options);
          break;
      }
    } catch (err) {
      // Create a dummy GAL
      new_gal = new GAL(this.m_options);
      aGalType = GAL_TYPE.GAL_TYPE_NONE;
      console.error(`Error switching GAL backend: ${(err as Error).message}`);
      result = false;
    }

    if (!new_gal) {
      new_gal = new GAL(this.m_options);
      aGalType = GAL_TYPE.GAL_TYPE_NONE;
    }

    // trigger update of the gal options in case they differ from the defaults
    this.m_options.NotifyChanged();

    this.m_gal = new_gal;

    const clientSize = this.GetClientSize();
    clientSize.x = Math.max(10, clientSize.x);
    clientSize.y = Math.max(10, clientSize.y);
    this.resizeBackingStore(clientSize.x, clientSize.y);
    this.m_gal.ResizeScreen(clientSize.x, clientSize.y);

    if (grid_size.x > 0 && grid_size.y > 0) this.m_gal.SetGridSize(grid_size);

    this.m_gal.SetGridVisibility(grid_visibility);

    // Make sure the cursor is set on the new canvas
    this.SetCurrentCursor(KICURSOR.ARROW);

    if (this.m_painter) this.m_painter.SetGAL(this.m_gal);

    if (this.m_view) {
      this.m_view.SetGAL(this.m_gal);
      // Note: OpenGL requires reverse draw order when draw priority is enabled
      this.m_view.ReverseDrawOrder(aGalType === GAL_TYPE.GAL_TYPE_OPENGL);
    }

    this.m_backend = aGalType;

    return result;
  }

  /**
   * Return the type of backend currently used by GAL canvas.
   */
  GetBackend(): GAL_TYPE {
    return this.m_backend;
  }

  /**
   * Return a pointer to the GAL instance used in the panel.
   */
  GetGAL(): GAL {
    return this.m_gal!;
  }

  /**
   * Return a pointer to the #VIEW instance used in the panel.
   */
  GetView(): VIEW {
    return this.m_view!;
  }

  /**
   * Return a pointer to the #VIEW_CONTROLS instance used in the panel.
   */
  GetViewControls(): WX_VIEW_CONTROLS {
    return this.m_viewControls!;
  }

  /// @copydoc wxWindow::Refresh()
  Refresh(_aEraseBackground = true, _aRect: BOX2I | null = null): void {
    const now = wxGetLocalTimeMillis();
    const delta = now - this.m_lastRepaintEnd;
    const galInitialized = !!this.m_gal && this.m_gal.IsInitialized();

    // When vsync is available the driver throttles SwapBuffers, so we only need
    // a small guard to avoid queueing work faster than the GPU can consume it.
    // Without vsync, enforce a 60 FPS ceiling to prevent saturating the GPU.
    let minPeriodMs = 3;

    if (galInitialized && this.m_gal!.GetSwapInterval() === 0) minPeriodMs = 16;

    if (delta >= minPeriodMs) {
      if (!this.DoRePaint()) this.RequestRefresh();
    } else if (!this.m_refreshTimer.IsRunning()) {
      this.m_refreshTimer.StartOnce(minPeriodMs - delta);
    }
  }

  /**
   * Force a redraw.
   */
  ForceRefresh(): void {
    if (!this.m_drawingEnabled) {
      if (this.m_gal && this.m_gal.IsInitialized()) {
        this.Connect(wxEVT_PAINT, () => this.onPaint());
        this.Connect(wxEVT_IDLE, () => this.onIdle());
        this.m_paintConnected = true;
        this.m_drawingEnabled = true;
      } else {
        // Try again soon
        this.m_refreshTimer.StartOnce(100);
        return;
      }
    }

    this.DoRePaint(false);
  }

  /**
   * Request a redraw of the canvas on the next idle event.
   */
  RequestRefresh(): void {
    this.m_needIdleRefresh = true;
    this.scheduleIdle();
  }

  /**
   * Set a dispatcher that processes events and forwards them to tools.
   *
   * #DRAW_PANEL_GAL does not take over the ownership. Passing NULL disconnects all event
   * handlers from the #DRAW_PANEL_GAL and disables event processing.
   *
   * @param aEventDispatcher is the object that will be used for dispatching events.
   */
  SetEventDispatcher(aEventDispatcher: TOOL_DISPATCHER | null): void {
    this.m_eventDispatcher = aEventDispatcher;
  }

  /**
   * Begin drawing if it was stopped previously.
   */
  StartDrawing(): void {
    // Start querying GAL if it is ready
    this.m_refreshTimer.StartOnce(100);
  }

  /**
   * Prevent the GAL canvas from further drawing until it is recreated or #StartDrawing()
   * is called.
   */
  StopDrawing(): void {
    this.m_refreshTimer.Stop();
    this.m_drawingEnabled = false;
    this.Disconnect(wxEVT_PAINT);
    this.Disconnect(wxEVT_IDLE);
    this.m_paintConnected = false;
  }

  /**
   * Take care of display settings for the given layer to be displayed in high contrast mode.
   */
  SetHighContrastLayer(aLayer: number): void {
    // Set display settings for high contrast mode
    const rSettings = this.m_view!.GetPainter().GetSettings();

    this.SetTopLayer(aLayer);

    rSettings.ClearHighContrastLayers();
    rSettings.SetLayerIsHighContrast(aLayer);

    this.m_view!.UpdateAllLayersColor();
  }

  /**
   * Move the selected layer to the top, so it is displayed above all others.
   */
  SetTopLayer(aLayer: number): void {
    this.m_view!.ClearTopLayers();
    this.m_view!.SetTopLayer(aLayer);
    this.m_view!.UpdateAllLayersOrder();
  }

  GetMsgPanelInfo(_aFrame: EDA_DRAW_FRAME, _aList: MSG_PANEL_ITEM[]): void {
    console.assert(false);
  }

  /**
   * Return parent EDA_DRAW_FRAME, if available or NULL otherwise.
   */
  GetParentEDAFrame(): EDA_DRAW_FRAME | null {
    return this.m_edaFrame;
  }

  IsDialogPreview(): boolean {
    return this.m_parent !== this.m_edaFrame;
  }

  /**
   * Called when the window is shown for the first time.
   */
  OnShow(): void {}

  /**
   * Set whether focus is taken on certain events (mouseover, keys, etc).
   *
   * This should be true (and is by default) for any primary canvas, but can be false to make
   * well-behaved preview panes.
   */
  SetStealsFocus(aStealsFocus: boolean): void {
    this.m_stealsFocus = aStealsFocus;
  }

  /**
   * Set the current cursor shape for this panel.
   */
  SetCurrentCursor(aCursor: KICURSOR): void {
    if (!this.m_gal) return;

    const hidpi = false;

    // Cursor scaling factor cannot be set for a wxCursor on GTK and OSX (at least before wx 3.3),
    // resulting in 4x rendered size on 2x window scale.
    // MSW renders the bitmap as-is, without scaling, so this works here.

    this.m_gal.SetNativeCursorStyle(aCursor, hidpi);
  }

  /**
   * Return the bounding box of the view that should be used if model is not valid.
   * For example, the drawing sheet bounding box for an empty PCB
   *
   * @return the default bounding box for the panel.
   */
  GetDefaultViewBBox(): BOX2I | null {
    return null;
  }

  /**
   * Used to forward events to the canvas from popups, etc.
   */
  OnEvent(aEvent: wxEvent): void {
    const shouldSetFocus =
      this.m_lostFocus &&
      this.m_stealsFocus &&
      !KIUI_IsInputControlFocused() && // Don't steal from input controls
      !KIUI_IsModalDialogFocused() && // Don't steal from dialogs
      KIPLATFORM_UI.IsWindowActive(this.m_edaFrame); // Don't steal from other windows

    if (shouldSetFocus) this.SetFocus();

    if (!this.m_eventDispatcher) aEvent.Skip();
    else this.m_eventDispatcher.DispatchWxEvent(aEvent);

    this.Refresh();
  }

  /**
   * Repaint the canvas, and fix scrollbar cursors
   *
   * Usually called by a OnPaint event, but because it does not use a wxPaintDC,
   * it can be called outside a wxPaintEvent.
   *
   * @param aAllowSkip if true, the repaint is skipped when nothing has changed since the
   *                   previous frame.
   * @return true if the repaint attempt was made, false if it was blocked by the refresh mutex.
   */
  DoRePaint(aAllowSkip = true): boolean {
    if (this.m_refreshMutex) return false;

    this.m_refreshMutex = true;

    try {
      return this.doRePaint(aAllowSkip);
    } finally {
      this.m_refreshMutex = false;
    }
  }

  private doRePaint(aAllowSkip: boolean): boolean {
    if (!this.m_drawingEnabled) return false;

    if (!this.m_gal!.IsInitialized() || !this.m_gal!.IsVisible() || this.m_gal!.IsContextLocked())
      return false;

    if (this.m_drawing) return false;

    this.m_lastRepaintStart = wxGetLocalTimeMillis();

    // Repaint the canvas, and fix scrollbar cursors
    // Usually called by a OnPaint event, but because it does not use a wxPaintDC,
    // it can be called outside a wxPaintEvent.

    // Update current zoom settings if the canvas is managed by a EDA frame
    // (i.e. not by a preview panel in a dialog)
    if (
      !this.IsDialogPreview() &&
      this.GetParentEDAFrame() &&
      this.GetParentEDAFrame()!.GetScreen()
    )
      this.GetParentEDAFrame()!.GetScreen()!.m_ScrollCenter = this.GetView().GetCenter();

    if (Pgm().GetCommonSettings()!.m_Appearance.show_scrollbars)
      this.m_viewControls!.UpdateScrollbars();

    // SCOPED_SET_RESET<bool> drawing( m_drawing, true );
    this.m_drawing = true;

    try {
      this.m_PaintEventCounter++;

      console.assert(this.m_painter !== null);

      const settings = this.m_painter!.GetSettings();

      let isDirty = false;

      try {
        const cursorPos = this.m_viewControls!.GetCursorPosition();
        let viewDirty = this.m_view!.IsDirty();
        const cursorMoved =
          cursorPos.x !== this.m_lastCursorPosition.x ||
          cursorPos.y !== this.m_lastCursorPosition.y;
        const hasPendingItemUpdates = this.m_view!.HasPendingItemUpdates();

        // Skip all update work when nothing has changed since the previous frame.
        // Never skip when responding to a native paint event or explicit ForceRefresh
        // because the window content may have been invalidated by the OS.
        if (aAllowSkip && !viewDirty && !cursorMoved && !hasPendingItemUpdates) {
          this.m_lastRepaintEnd = wxGetLocalTimeMillis();
          return true;
        }

        if (hasPendingItemUpdates) {
          try {
            this.m_view!.UpdateItems();
          } catch (err) {
            if (err instanceof RangeError) {
              // Don't do anything here but don't fail
              // This can happen when we don't catch `at()` calls
              console.debug(`Out of Range error: ${err.message}`);
            } else {
              // Handle GL errors (e.g. glMapBuffer failure) that surface during UpdateItems().
              // These can occur on macOS under memory pressure when embedding large 3D models.
              // Log and continue so the outer handler can decide whether to switch backends.
              console.debug(`Runtime error during UpdateItems: ${(err as Error).message}`);
              throw err;
            }
          }

          viewDirty = this.m_view!.IsDirty();
        }

        // After processing item updates, skip the GL cycle when neither the
        // view targets nor the cursor position have changed.
        if (aAllowSkip && !viewDirty && !cursorMoved) {
          this.m_lastRepaintEnd = wxGetLocalTimeMillis();
          return true;
        }

        this.m_lastCursorPosition = cursorPos;

        // GAL_DRAWING_CONTEXT can throw in the dtor, so we need to scope
        // the full lifetime inside the try block
        GAL_DRAWING_CONTEXT(this.m_gal!, () => {
          if (
            this.m_view!.IsTargetDirty(RENDER_TARGET.TARGET_OVERLAY) &&
            !this.m_gal!.HasTarget(RENDER_TARGET.TARGET_OVERLAY)
          ) {
            this.m_view!.MarkDirty();
          }

          this.m_gal!.SetClearColor(settings.GetBackgroundColor());
          this.m_gal!.SetGridColor(settings.GetGridColor());
          this.m_gal!.SetCursorColor(settings.GetCursorColor());

          // OpenGL double-buffering leaves the back buffer undefined after
          // SwapBuffers, so a full clear is always required before compositing.
          // Cairo only needs to clear when NONCACHED content changed.
          if (this.m_backend === GAL_TYPE.GAL_TYPE_OPENGL) this.m_gal!.ClearScreen();

          if (this.m_view!.IsDirty()) {
            if (
              this.m_backend !== GAL_TYPE.GAL_TYPE_OPENGL && // Already called in opengl
              this.m_view!.IsTargetDirty(RENDER_TARGET.TARGET_NONCACHED)
            ) {
              this.m_gal!.ClearScreen();
            }

            this.m_view!.ClearTargets();

            // Grid has to be redrawn only when the NONCACHED target is redrawn
            if (this.m_view!.IsTargetDirty(RENDER_TARGET.TARGET_NONCACHED)) this.m_gal!.DrawGrid();

            this.m_view!.Redraw();
            isDirty = true;
          }

          this.m_gal!.DrawCursor(cursorPos);
        });

        // OpenGL frame completed successfully, allow future recovery attempts
        this.m_glRecoveryAttempted = false;
      } catch (err) {
        console.debug(`DoRePaint exception: ${(err as Error).message}`);

        if (this.recoverFromGalError(err as Error)) return true;

        this.StopDrawing();
      }

      void isDirty;
    } finally {
      this.m_drawing = false;
    }

    this.m_lastRepaintEnd = wxGetLocalTimeMillis();

    return true;
  }

  /**
   * Returns the bounding box of the view that should be used if model is not valid.
   */
  DebugOverlay(): VIEW_OVERLAY {
    if (!this.m_debugOverlay) {
      this.m_debugOverlay = new VIEW_OVERLAY();
      this.m_view!.Add(this.m_debugOverlay);
    }

    return this.m_debugOverlay;
  }

  /**
   * Clear the contents of the debug overlay and removes it from the VIEW.
   */
  ClearDebugOverlay(): void {
    if (this.m_debugOverlay) {
      this.m_view!.Remove(this.m_debugOverlay);
      this.m_debugOverlay = null;
    }
  }

  /**
   * Gets a populated View Controls settings object dervived from our program settings
   */
  static GetVcSettings(): VC_SETTINGS {
    const cfg = Pgm().GetCommonSettings()!;
    const vcSettings = new VC_SETTINGS();

    vcSettings.m_warpCursor = cfg.m_Input.center_on_zoom;
    vcSettings.m_focusFollowSchPcb = cfg.m_Input.focus_follow_sch_pcb;
    vcSettings.m_autoPanSettingEnabled = cfg.m_Input.auto_pan;
    vcSettings.m_autoPanAcceleration = cfg.m_Input.auto_pan_acceleration;
    vcSettings.m_horizontalPan = cfg.m_Input.horizontal_pan;
    vcSettings.m_zoomAcceleration = cfg.m_Input.zoom_acceleration;
    vcSettings.m_zoomSpeed = cfg.m_Input.zoom_speed;
    vcSettings.m_zoomSpeedAuto = cfg.m_Input.zoom_speed_auto;
    vcSettings.m_scrollModifierZoom = cfg.m_Input.scroll_modifier_zoom;
    vcSettings.m_scrollModifierPanH = cfg.m_Input.scroll_modifier_pan_h;
    vcSettings.m_scrollModifierPanV = cfg.m_Input.scroll_modifier_pan_v;
    vcSettings.m_motionPanModifier = cfg.m_Input.motion_pan_modifier;
    vcSettings.m_dragLeft = cfg.m_Input.drag_left;
    vcSettings.m_dragMiddle = cfg.m_Input.drag_middle;
    vcSettings.m_dragRight = cfg.m_Input.drag_right;
    vcSettings.m_scrollReverseZoom = cfg.m_Input.reverse_scroll_zoom;
    vcSettings.m_scrollReversePanH = cfg.m_Input.reverse_scroll_pan_h;

    return vcSettings;
  }

  // ------------------------------------------------------------------

  protected onPaint(): void {
    this.DoRePaint(false);
  }

  protected onSize(_aEvent: wxSizeEvent): void {
    // If we get a second wx update call before the first finishes, don't crash
    if (this.m_gal!.IsContextLocked()) return;

    GAL_CONTEXT_LOCKER(this.m_gal!, () => {
      const clientSize = this.GetClientSize();
      const infobar = this.GetParentEDAFrame() ? this.GetParentEDAFrame()!.GetInfoBar() : null;

      const screen = this.m_gal!.GetScreenPixelSize();

      if (clientSize.x === screen.x && clientSize.y === screen.y) return;

      // Note: ( +1, +1 ) prevents an ugly black line on right and bottom on Mac
      clientSize.x = Math.max(10, clientSize.x + 1);
      clientSize.y = Math.max(10, clientSize.y + 1);

      let bottom: VECTOR2D = { x: 0, y: 0 };

      if (this.m_view) bottom = this.m_view.ToWorld(this.m_gal!.GetScreenPixelSize(), true);

      this.resizeBackingStore(clientSize.x, clientSize.y);
      this.m_gal!.ResizeScreen(clientSize.x, clientSize.y);

      if (this.m_view) {
        if (infobar?.IsLocked()) {
          const halfScreen: VECTOR2D = {
            x: Math.ceil(0.5 * clientSize.x),
            y: Math.ceil(0.5 * clientSize.y),
          };
          const hw = this.m_view.ToWorld(halfScreen, false);
          this.m_view.SetCenter({ x: bottom.x - hw.x, y: bottom.y - hw.y });
        }

        this.m_view.MarkTargetDirty(RENDER_TARGET.TARGET_CACHED);
        this.m_view.MarkTargetDirty(RENDER_TARGET.TARGET_NONCACHED);
      }
    });
  }

  protected onEnter(aEvent: wxEvent): void {
    const shouldSetFocus =
      this.m_stealsFocus &&
      !KIUI_IsInputControlFocused() && // Don't steal from input controls
      !KIUI_IsModalDialogFocused() && // Don't steal from dialogs
      KIPLATFORM_UI.IsWindowActive(this.m_edaFrame); // Don't steal from other windows

    // Getting focus is necessary in order to receive key events properly
    if (shouldSetFocus) this.SetFocus();

    aEvent.Skip();
  }

  protected onLostFocus(aEvent: wxFocusEvent): void {
    this.m_lostFocus = true;

    this.m_viewControls!.CancelDrag();

    // Reset the tool dispatcher's button state when focus is lost. This prevents
    // the dispatcher from thinking the button is still pressed when focus returns,
    // which can cause selection and drag operations to stop working.
    if (this.m_eventDispatcher) this.m_eventDispatcher.ResetState();

    aEvent.Skip();
  }

  protected onIdle(): void {
    if (this.m_needIdleRefresh) {
      this.m_needIdleRefresh = false;
      this.Refresh();
    }
  }

  protected onRefreshTimer(_aEvent: wxTimerEvent): void {
    this.ForceRefresh();
  }

  protected onShowEvent(_aEvent: wxShowEvent): void {
    if (this.m_gal && this.m_gal.IsInitialized() && this.m_gal.IsVisible()) {
      this.OnShow();
    }
  }

  protected recoverFromGalError(aError: Error): boolean {
    try {
      // Sleep/wake and GPU resets can invalidate the entire GL context.
      // Try a full reinit of the current backend before falling back.
      if (!this.m_glRecoveryAttempted) {
        this.m_glRecoveryAttempted = true;

        const prevBackend = this.m_backend;
        this.m_backend = GAL_TYPE.GAL_TYPE_NONE;

        if (this.SwitchBackend(prevBackend)) {
          this.StartDrawing();
          return true;
        }
      }

      if (
        EDA_DRAW_PANEL_GAL.GAL_FALLBACK_AVAILABLE &&
        EDA_DRAW_PANEL_GAL.GAL_FALLBACK !== this.m_backend
      ) {
        this.m_glRecoveryAttempted = false;
        this.SwitchBackend(EDA_DRAW_PANEL_GAL.GAL_FALLBACK);
        console.info(`Could not use OpenGL, falling back to software rendering: ${aError.message}`);
        this.StartDrawing();
        return true;
      }

      console.error(`Graphics error: ${aError.message}`);
    } catch (recoveryErr) {
      console.error(`Graphics error during recovery: ${(recoveryErr as Error).message}`);
    }

    return false;
  }

  // ------------------------------------------------------------------
  // The DOM side of the wxScrolledCanvas
  // ------------------------------------------------------------------

  /**
   * `wxGLCanvas::SetSize`: the element's size, and its backing store at the
   * display's scale.
   */
  private resizeBackingStore(aWidth: number, aHeight: number): void {
    const c = this.window.canvas;
    const sf = this.GetScaleFactor();
    const w = Math.round(aWidth * sf);
    const h = Math.round(aHeight * sf);

    if (c.style) {
      c.style.width = `${aWidth}px`;
      c.style.height = `${aHeight}px`;
    }

    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }

  /** `wxEVT_IDLE`: the next animation frame. */
  private scheduleIdle(): void {
    if (this.m_idleHandle !== null || typeof requestAnimationFrame === 'undefined') return;

    this.m_idleHandle = requestAnimationFrame(() => {
      this.m_idleHandle = null;

      if (this.m_paintConnected) this.onIdle();
    });
  }

  private bindDomEvents(): void {
    const canvas = this.window.canvas;

    if (typeof canvas.addEventListener !== 'function') return;

    // A canvas takes keyboard focus only with a tabindex.
    if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;

    const on = <K extends keyof HTMLElementEventMap>(
      aType: K,
      aHandler: (e: HTMLElementEventMap[K]) => void,
      aOptions?: AddEventListenerOptions,
    ): void => {
      canvas.addEventListener(aType, aHandler, aOptions);
      this.m_domListeners.push(() => canvas.removeEventListener(aType, aHandler, aOptions));
    };

    const mouse = (e: PointerEvent, aKind: 'down' | 'up' | 'move' | 'enter' | 'leave'): void => {
      if (e.pointerType !== POINTER_MOUSE && e.pointerType !== 'pen') return;

      const ev = wxMouseEventFromDom(canvas, e, aKind);

      if (this.ProcessEvent(ev)) e.preventDefault();
    };

    on('pointerdown', (e) => {
      // wx captures the mouse for the window on a button press
      canvas.setPointerCapture(e.pointerId);
      mouse(e, 'down');
    });
    on('pointerup', (e) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      mouse(e, 'up');
    });
    on('pointermove', (e) => mouse(e, 'move'));
    on('pointerenter', (e) => mouse(e, 'enter'));
    on('pointerleave', (e) => mouse(e, 'leave'));
    on(
      'wheel',
      (e) => {
        const ev = wxWheelEventFromDom(canvas, e);
        this.ProcessEvent(ev);
        // The canvas never scrolls the page.
        e.preventDefault();
      },
      { passive: false },
    );
    // The context menu is the tools'.
    on('contextmenu', (e) => e.preventDefault());
    on('keydown', (e) => {
      const pos = clientPosition(canvas, {
        clientX: KIPLATFORM_UI.GetMousePosition().x,
        clientY: KIPLATFORM_UI.GetMousePosition().y,
      });
      // wxEVT_CHAR_HOOK first, then wxEVT_CHAR, as wx sends them
      const hook = wxKeyEventFromDom(canvas, e, wxEVT_CHAR_HOOK, pos);

      if (this.ProcessEvent(hook)) {
        e.preventDefault();
        return;
      }

      const ch = wxKeyEventFromDom(canvas, e, wxEVT_CHAR, pos);

      if (this.ProcessEvent(ch)) e.preventDefault();
    });
    on('blur', () => this.ProcessEvent(new wxFocusEvent(wxEVT_KILL_FOCUS)));

    if (typeof ResizeObserver !== 'undefined') {
      this.m_resizeObserver = new ResizeObserver(() => {
        this.ProcessEvent(new wxSizeEvent(this.GetClientSize()));
      });
      this.m_resizeObserver.observe(canvas.parentElement ?? canvas);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const shown = entry.isIntersecting;

          if (shown !== this.m_shown) {
            this.m_shown = shown;
            this.ProcessEvent(new wxShowEvent(shown));
          }
        }
      });
      io.observe(canvas);
      this.m_domListeners.push(() => io.disconnect());
    }
  }
}

function isEdaDrawFrame(aWindow: unknown): aWindow is EDA_DRAW_FRAME {
  return (
    !!aWindow &&
    typeof (aWindow as EDA_DRAW_FRAME).GetCanvas === 'function' &&
    typeof (aWindow as EDA_DRAW_FRAME).IsType === 'function'
  );
}
