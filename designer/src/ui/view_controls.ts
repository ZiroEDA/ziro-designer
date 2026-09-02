// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::WX_VIEW_CONTROLS` — the one canvas view controller every editor
 * frame shares.
 *
 * Upstream this is `common/view/wx_view_controls.cpp`, constructed once by
 * `EDA_DRAW_PANEL_GAL` (`common/draw_panel_gal.cpp:170`) and therefore present
 * on every GAL canvas in the suite: eeschema, pcbnew, the symbol and footprint
 * editors and viewers, gerbview, pl_editor and the preview widgets. It reads
 * `COMMON_SETTINGS::INPUT` in `LoadSettings`
 * (`wx_view_controls.cpp:170-214`), so "Preferences → Mouse and Touchpad"
 * applies everywhere at once. We had five independent wheel handlers instead,
 * of which two honoured the preferences; this module is the single one.
 *
 * The wheel logic is a pure function of the event and the preferences
 * (`wheelAction`), so each canvas keeps its own viewport representation and
 * only has to apply the returned zoom factor or pan delta.
 */
import { type ScrollModifier, settings } from '../prefs/settings.js';

/** Mouse/input behaviour from the Preferences dialog (COMMON_SETTINGS m_Input + eeschema). */
export interface InputPrefs {
  zoomSpeed: number; // 1..10 (input.zoom_speed)
  zoomSpeedAuto: boolean;
  centerOnZoom: boolean;
  reverseZoom: boolean;
  scrollModZoom: ScrollModifier;
  scrollModPanH: ScrollModifier;
  scrollModPanV: ScrollModifier;
  reverseScrollPanH: boolean;
  horizontalPan: boolean;
  mouseLeft: 'select' | 'drag_selected' | 'drag_any';
  mouseMiddle: 'pan' | 'zoom' | 'none';
  mouseRight: 'pan' | 'zoom' | 'none';
  /** eeschema input.drag_is_move: the mouse-drag gesture performs a Move
   *  (leave wires behind) instead of a Drag (rubber-band them along). */
  dragIsMove: boolean;
  autoStartWires: boolean;
  crosshair: 'small' | 'full' | '45';
  alwaysShowCrosshair: boolean;
}

export const DEFAULT_INPUT_PREFS: InputPrefs = {
  zoomSpeed: 1,
  zoomSpeedAuto: true,
  centerOnZoom: true,
  reverseZoom: false,
  scrollModZoom: 'none',
  scrollModPanH: 'ctrl',
  scrollModPanV: 'shift',
  reverseScrollPanH: false,
  horizontalPan: false,
  mouseLeft: 'drag_selected',
  mouseMiddle: 'pan',
  mouseRight: 'pan',
  dragIsMove: false,
  autoStartWires: true,
  // KiCad's defaults (app_settings.cpp): SMALL_CROSS, and the crosshair shown
  // whatever tool is active.
  crosshair: 'small',
  alwaysShowCrosshair: true,
};

/**
 * The mouse settings a canvas uses when its owner passes none: COMMON_SETTINGS
 * m_Input, the same source `WX_VIEW_CONTROLS::LoadSettings` reads
 * (`wx_view_controls.cpp:170-193`). The eeschema-only fields keep their
 * defaults, as they do for every non-eeschema frame upstream.
 */
export function commonInputPrefs(): InputPrefs {
  const input = settings.common.input;
  return {
    ...DEFAULT_INPUT_PREFS,
    zoomSpeed: input.zoom_speed,
    zoomSpeedAuto: input.zoom_speed_auto,
    centerOnZoom: input.center_on_zoom,
    reverseZoom: input.reverse_scroll_zoom,
    scrollModZoom: input.scroll_modifier_zoom,
    scrollModPanH: input.scroll_modifier_pan_h,
    scrollModPanV: input.scroll_modifier_pan_v,
    reverseScrollPanH: input.reverse_scroll_pan_h,
    horizontalPan: input.horizontal_pan,
    mouseLeft: input.mouse_left as InputPrefs['mouseLeft'],
    mouseMiddle: input.mouse_middle as InputPrefs['mouseMiddle'],
    mouseRight: input.mouse_right as InputPrefs['mouseRight'],
  };
}

// ---------------------------------------------------------------------------
// Wheel handling — WX_VIEW_CONTROLS::onWheel (wx_view_controls.cpp:418-545)
// ---------------------------------------------------------------------------

/**
 * `CONSTANT_ZOOM_CONTROLLER::GTK3_SCALE` (view/zoom_controller.h:154).
 *
 * `zoom_speed_auto` does not mean "speed 1": it means "let the platform pick",
 * and `GetZoomControllerForPlatform` (wx_view_controls.cpp:56-71) returns a
 * CONSTANT_ZOOM_CONTROLLER at this scale on GTK3 (0.01 on macOS, 0.005 on
 * MSW). We are a GTK3-equivalent target, so this is the auto scale.
 */
const GTK3_SCALE = 0.002;

/** `CONSTANT_ZOOM_CONTROLLER::MANUAL_SCALE_FACTOR` (zoom_controller.h:163). */
const MANUAL_SCALE_FACTOR = 0.001;

/** `WX_VIEW_CONTROLS::onWheel`'s `wheelPanSpeed` (wx_view_controls.cpp:420). */
const WHEEL_PAN_SPEED = 0.001;

/**
 * One wheel notch in `WheelEvent.deltaY` pixels.
 *
 * No upstream counterpart — wx hands `GetWheelRotation()` a fixed unit per
 * notch, while the DOM reports a notch as ~100 px (`DOM_DELTA_PIXEL`), 3 lines
 * (`DOM_DELTA_LINE`, Firefox) or 1 page. Normalising to pixels is what makes
 * CONSTANT_ZOOM_CONTROLLER's clamp of the rotation to +/-100 mean the same
 * thing here as it does upstream.
 */
const WHEEL_NOTCH_PX = 100;

/** The wheel gesture reduced to what onWheel reads off the wxMouseEvent. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. Defaults to pixels. */
  deltaMode?: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** Cmd on macOS, which we treat as Control the way wx maps it. */
  metaKey?: boolean;
}

/** What the canvas should do with the gesture. */
export type WheelAction =
  /** `VIEW::SetScale( GetScale() * factor, anchor )`, anchor = the cursor. */
  | { kind: 'zoom'; factor: number }
  /** `VIEW::SetCenter( GetCenter() + delta )`, expressed as the screen-space
   *  device-pixel deltas to ADD to the view's tx/ty translation. */
  | { kind: 'pan'; dx: number; dy: number }
  /** `aEvent.Skip()` — the view does nothing and the tools get the event. */
  | { kind: 'none' };

/** deltaY/deltaX in pixels, whatever unit the browser reported them in. */
function toPixels(delta: number, deltaMode: number | undefined): number {
  if (deltaMode === 1) return (delta * WHEEL_NOTCH_PX) / 3; // 3 lines = 1 notch
  if (deltaMode === 2) return delta * WHEEL_NOTCH_PX;
  return delta;
}

/**
 * `CONSTANT_ZOOM_CONTROLLER::GetScaleForRotation`
 * (common/view/zoom_controller.cpp:120-131), with the scale chosen by
 * `WX_VIEW_CONTROLS::LoadSettings` (wx_view_controls.cpp:195-213).
 *
 * `aRotation` is wx's wheel rotation: positive is wheel-up / zoom-in.
 */
export function zoomScaleForRotation(rotation: number, prefs: InputPrefs): number {
  const scale = prefs.zoomSpeedAuto ? GTK3_SCALE : MANUAL_SCALE_FACTOR * prefs.zoomSpeed;
  // aRotation = ( aRotation > 0 ) ? min( aRotation, 100 ) : max( aRotation, -100 )
  const rot = rotation > 0 ? Math.min(rotation, 100) : Math.max(rotation, -100);
  const dscale = rot * scale;
  return rot > 0 ? 1 + dscale : 1 / (1 - dscale);
}

/**
 * Which modifier the gesture carries, by onWheel's own rule: "Shift beats
 * control beats alt, we don't support more than one" (wx_view_controls.cpp:
 * 458-480). More than one modifier is not a view gesture at all — upstream
 * skips the event so the tools can have it.
 */
export function wheelModifier(e: WheelInput): ScrollModifier | 'multiple' {
  let nMods = 0;
  let modifiers: ScrollModifier = 'none';

  if (e.shiftKey) {
    nMods += 1;
    modifiers = 'shift';
  }
  if (e.ctrlKey || e.metaKey) {
    nMods += 1;
    if (modifiers === 'none') modifiers = 'ctrl';
  }
  if (e.altKey) {
    nMods += 1;
    if (modifiers === 'none') modifiers = 'alt';
  }

  return nMods > 1 ? 'multiple' : modifiers;
}

/**
 * `WX_VIEW_CONTROLS::onWheel` (wx_view_controls.cpp:418-545), as a pure
 * function of the event, the preferences and the canvas size.
 *
 * `viewportPx` is the canvas' size in device pixels: upstream a pan step is
 * `ToWorld( GetScreenPixelSize() ) * rotation * 0.001`, i.e. a fixed fraction
 * of the visible viewport rather than a fixed number of pixels, so it has to
 * be told how big the viewport is.
 */
export function wheelAction(
  e: WheelInput,
  prefs: InputPrefs,
  viewportPx: { width: number; height: number },
): WheelAction {
  const deltaY = toPixels(e.deltaY, e.deltaMode);
  const deltaX = toPixels(e.deltaX, e.deltaMode);

  // "Native horizontal wheel events (from mice with tilt wheels, side-button
  // scroll combos, or touchpads) are always handled as horizontal pan"
  // (wx_view_controls.cpp:422-434) — unconditionally, before any modifier is
  // looked at, and NOT gated on the horizontal_pan setting. wx delivers the
  // two axes as separate events with a wheel axis; the DOM puts both on one
  // event, so the dominant axis stands in for wxMOUSE_WHEEL_HORIZONTAL.
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return { kind: 'pan', dx: -viewportPx.width * deltaX * WHEEL_PAN_SPEED, dy: 0 };
  }

  const modifiers = wheelModifier(e);

  // "When we have multiple mods, forward it for tool handling."
  if (modifiers === 'multiple') return { kind: 'none' };

  if (modifiers === prefs.scrollModZoom) {
    // rotation = GetWheelRotation() * ( m_scrollReverseZoom ? -1 : 1 ); wx's
    // rotation is positive for wheel-up, the DOM's deltaY is negative for it.
    const rotation = -deltaY * (prefs.reverseZoom ? -1 : 1);
    return { kind: 'zoom', factor: zoomScaleForRotation(rotation, prefs) };
  }

  // Everything that is not the zoom modifier scrolls: the pan-H modifier pans
  // left/right, and every other case (including a modifier bound to nothing)
  // falls through to a vertical pan, exactly as onWheel's else-branch does.
  const rotation = -deltaY;
  if (modifiers === prefs.scrollModPanH) {
    // scrollX = hReverse ? scrollVec.x : -scrollVec.x
    const scrollX = viewportPx.width * rotation * WHEEL_PAN_SPEED;
    return { kind: 'pan', dx: prefs.reverseScrollPanH ? -scrollX : scrollX, dy: 0 };
  }

  // scrollY = -scrollVec.y — the vertical pan has no reverse setting upstream.
  return { kind: 'pan', dx: 0, dy: viewportPx.height * rotation * WHEEL_PAN_SPEED };
}

// ---------------------------------------------------------------------------
// Button drags — WX_VIEW_CONTROLS::onButton (wx_view_controls.cpp:540-593)
// ---------------------------------------------------------------------------

/** `MOUSE_DRAG_ACTION`, restricted to what a middle or right drag can be. */
export type DragGesture = 'pan' | 'zoom' | 'none';

/**
 * What pressing a mouse button on the canvas starts — Preferences > Mouse and
 * Touchpad > Drag Gestures, for the middle and right buttons.
 *
 * `WX_VIEW_CONTROLS::onButton`'s IDLE branch, whole:
 *
 *     if( ( aEvent.MiddleDown() && m_settings.m_dragMiddle == MOUSE_DRAG_ACTION::PAN )
 *         || ( aEvent.RightDown() && m_settings.m_dragRight == MOUSE_DRAG_ACTION::PAN ) )
 *         setState( DRAG_PANNING );                                     :546-556
 *     else if( ( aEvent.MiddleDown() && m_settings.m_dragMiddle == MOUSE_DRAG_ACTION::ZOOM )
 *              || ( aEvent.RightDown() && m_settings.m_dragRight == MOUSE_DRAG_ACTION::ZOOM ) )
 *         setState( DRAG_ZOOMING );                                     :558-569
 *
 * so the button chooses the setting and the setting chooses the state, and
 * `NONE` is neither branch: the press falls through to the tools untouched.
 *
 * The LEFT button is deliberately absent. `m_dragLeft` is loaded beside the
 * other two (`:188`, `draw_panel_gal.cpp:833`) and `onButton` never looks at
 * it -- a left drag belongs to the selection tool, which reads the same
 * setting through `TOOLS_HOLDER::GetDragAction()` (`include/tool/tools_holder.h:144`,
 * `eeschema/tools/sch_selection_tool.cpp:506`). That is `InputPrefs.mouseLeft`
 * here, and it is a different question with different answers
 * (select / drag_selected / drag_any), which is why it is not this function's.
 *
 * Pure, and given the button number rather than the event, because upstream
 * one `WX_VIEW_CONTROLS` sits in front of every GAL canvas and answers this
 * identically for all of them. Ours are seven React components with seven
 * pointer handlers, and each hardcoded `button === 1` -> pan: the Drag
 * Gestures combos were honoured in the schematic editor and nowhere else.
 */
export function dragGesture(
  /** `PointerEvent.button`: 1 is the middle button, 2 the right. */
  button: number,
  prefs: InputPrefs,
): DragGesture {
  if (button === 1) return prefs.mouseMiddle;
  if (button === 2) return prefs.mouseRight;
  return 'none';
}

/**
 * `WX_VIEW_CONTROLS::onMotion`'s DRAG_ZOOMING step
 * (`wx_view_controls.cpp:379-388`), whole:
 *
 *     VECTOR2D d = m_dragStartPoint - mousePos;
 *     m_dragStartPoint = mousePos;
 *     double scale = exp( d.y * m_settings.m_zoomSpeed * 0.001 );
 *     m_view->SetScale( m_view->GetScale() * scale, m_view->ToWorld( m_zoomStartPoint ) );
 *
 * Two things in that are easy to get wrong, and this port had both.
 *
 * **The speed is the Zoom speed slider**, `cfg->m_Input.zoom_speed`
 * (`:184`), so dragging with the middle button set to Zoom is 10x faster at
 * speed 10 than at speed 1. Ours multiplied by a literal 0.005, which is the
 * factor for zoom_speed 5 and no other -- the slider moved and nothing
 * happened. Note it is `m_zoomSpeed` raw, NOT the zoom CONTROLLER: `Automatic`
 * (`zoom_speed_auto`) chooses a controller for the WHEEL (`:196-214`) and this
 * gesture never asks for one, so the slider governs the drag even while its
 * own control is greyed out by the Automatic box beside it.
 *
 * **`d.y` is previous minus current**, so dragging the mouse UP (a decreasing
 * y) gives a negative d.y and scales DOWN. And the anchor is
 * `m_zoomStartPoint` -- where the button went down, held fixed for the whole
 * gesture -- not the moving pointer and not the centre of the canvas.
 */
export function dragZoomScale(
  /** `d.y`: the previous pointer y minus the current one, in CSS pixels. */
  dy: number,
  prefs: InputPrefs,
): number {
  return Math.exp(dy * prefs.zoomSpeed * DRAG_ZOOM_SPEED);
}

/** The `0.001` of `exp( d.y * m_settings.m_zoomSpeed * 0.001 )` (`:383`). */
const DRAG_ZOOM_SPEED = 0.001;

// ---------------------------------------------------------------------------
// Zoom to Fit — COMMON_TOOLS::doZoomFit (common/tool/common_tools.cpp:322-408)
// ---------------------------------------------------------------------------

/**
 * The frame asking for the fit. `doZoomFit` picks its margin off the frame
 * type (`common_tools.cpp:387-401`), so this is the one thing that legitimately
 * varies per editor — and it varies by upstream's table, not by ours.
 */
export type FitFrame =
  | 'sch' // FRAME_SCH
  | 'sch_viewer' // FRAME_SCH_VIEWER — the symbol browser/preview
  | 'symbol_editor' // FRAME_SCH_SYMBOL_EDITOR
  | 'pcb' // FRAME_PCB_EDITOR
  | 'footprint_editor' // FRAME_FOOTPRINT_EDITOR
  | 'footprint_viewer' // FRAME_FOOTPRINT_VIEWER
  /**
   * FRAME_CVPCB_DISPLAY — CVPCB's footprint viewer (DISPLAY_FOOTPRINTS_FRAME).
   *
   * It is NOT `footprint_viewer`. `doZoomFit` names four frame types for the
   * bigger library-editor margin (`common_tools.cpp:387-399`) and this is not
   * one of them, so it fits on the default 1.04 like the board editor. A
   * window that reads as a viewer therefore frames its footprint *tighter*
   * than pcbnew's own footprint viewer does; that is upstream's choice.
   */
  | 'cvpcb_display'
  | 'gerber' // FRAME_GERBER
  | 'pl_editor'; // FRAME_PL_EDITOR

/** `ZOOM_FIT_TYPE_T` (include/tool/common_tools.h). */
export type FitType = 'all' | 'objects' | 'selection';

/**
 * `doZoomFit`'s `margin_scale_factor` (common_tools.cpp:381-401). The view is
 * scaled by `scale / margin_scale_factor`, so this is a multiplier on the
 * viewport, not an absolute world-space padding: the visible slack stays the
 * same fraction of the window whatever the document's size or units are.
 */
export function fitMarginScaleFactor(
  frame: FitFrame,
  clientHeightPx: number,
  fitType: FitType = 'all',
): number {
  // "Reserve enough margin to limit the amount of the view that might be
  // obscured behind the infobar."
  let margin = 1.04;

  if (clientHeightPx < 768) margin = 1.1;

  if (fitType === 'all') {
    // "Leave a bigger margin for library editors & viewers"
    if (frame === 'footprint_viewer' || frame === 'sch_viewer') margin = 1.3;
    else if (frame === 'symbol_editor' || frame === 'footprint_editor') margin = 1.48;
  }

  return margin;
}

export interface FitBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A canvas transform in device pixels: world -> screen. */
export interface FitView {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * `doZoomFit`'s scale and centre, for a box in world units and a viewport in
 * device pixels.
 *
 * Upstream: `scale = GetScale() / max( |vsize.x / screenSize.x|,
 * |vsize.y / screenSize.y| )` with `GetScale()` forced to 1 and `screenSize`
 * taken `ToWorld` at that scale — which is just `min( W/w, H/h )` — then
 * `SetScale( scale / margin )` and `SetCenter( bBox.Centre() )`.
 *
 * Returns null when the box is degenerate; upstream substitutes
 * `GetDefaultViewBBox()` there, which each canvas owns, and bails to a
 * recentre when the scale is not finite (common_tools.cpp:363-379).
 */
export function zoomFitScale(
  box: FitBox,
  viewportPx: { width: number; height: number },
  frame: FitFrame,
  fitType: FitType = 'all',
): number | null {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  if (!(w > 0) || !(h > 0)) return null;

  const scale =
    Math.min(viewportPx.width / w, viewportPx.height / h) /
    fitMarginScaleFactor(frame, viewportPx.height, fitType);

  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

/**
 * The whole transform, for the canvases whose world->screen map is a plain
 * scale + translate. A mirrored canvas (pcbnew's flip-board view, gerbview's
 * y-up) takes `zoomFitScale` and builds its own translation.
 */
export function zoomFitView(
  box: FitBox,
  viewportPx: { width: number; height: number },
  frame: FitFrame,
  fitType: FitType = 'all',
): FitView | null {
  const scale = zoomFitScale(box, viewportPx, frame, fitType);
  if (scale === null) return null;

  return {
    scale,
    tx: viewportPx.width / 2 - ((box.minX + box.maxX) / 2) * scale,
    ty: viewportPx.height / 2 - ((box.minY + box.maxY) / 2) * scale,
  };
}
