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
