// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the generic pages — Common, Mouse and
 * Touchpad, Hotkeys — which `EDA_BASE_FRAME::ShowPreferences` adds itself out
 * of `common/dialogs/`.
 *
 * Upstream each of these lives in its panel's own `.cpp`, and so did ours until
 * the reset had to be *tested*: `qa`'s tsconfig sets no `--jsx`, so a test that
 * reached a `.tsx` could not compile at all. This is the same split #549 made
 * between `registry.ts` and `lazy_pages.ts`, and for the same reason — the
 * thing that has to be asserted as behaviour lives where `qa` can import it,
 * and the panel's JSX stays on the other side of the line. `panels/index.ts`
 * pairs each `Panel` with its `reset` again, one file over.
 *
 * The contract these satisfy is `PrefsPanelModule.reset` in `../types.ts`, and
 * the rule is one line long: **a page resets its own fields and no others.**
 */
import { COMMON_DEFAULTS, PRIVACY_DEFAULTS } from '../../../prefs/settings.js';
import { resetKeys } from '../reset.js';
import type { PrefsContext } from '../types.js';

/**
 * `PANEL_COMMON_SETTINGS::ResetPanel` (`common/dialogs/panel_common_settings.cpp`):
 * a default `COMMON_SETTINGS` pushed at *this panel's* widgets via
 * `applySettingsToPanel`. It shares `COMMON_SETTINGS` with
 * `PANEL_MOUSE_SETTINGS`, and resetting this page leaves that one's pan/zoom
 * and drag settings exactly as they were, because those widgets are not here.
 *
 * So the slice is the fields this panel's controls bind to and no more —
 * notably NOT `system.language` (the Set Language menu owns it) and NOT
 * `system.session.pinned_symbol_libs` (the symbol chooser's pins), neither of
 * which appears on this page.
 */
export function resetCommonPanel(ctx: PrefsContext): void {
  ctx.upC((s) => {
    // "User Interface" — every field of `appearance` is on this page.
    resetKeys(s.appearance, COMMON_DEFAULTS.appearance, [
      'use_icons_in_menus',
      'show_scrollbars',
      'grid_striping',
      'use_custom_cursors',
      'icon_theme',
      'toolbar_icon_size',
      'hicontrast_dimming_factor',
      // "Scaling" is one control and one setting, and it sits on this page, so
      // Reset Common to Defaults puts the display back to the assumed PPI.
      'zoom_correction_factor',
    ]);
    // "Editing", plus the two `input` fields User Interface shows.
    // `hotkey_feedback` is drawn under User Interface upstream, not Editing --
    // which changes nothing here, since the slice is the fields this PAGE binds
    // to and both groups are on it.
    resetKeys(s.input, COMMON_DEFAULTS.input, [
      'warp_mouse_on_move',
      'immediate_actions',
      'hotkey_feedback',
      'focus_follow_sch_pcb',
    ]);
    // "Session". `autosave_interval` is NOT here any more: 10.0.5 dropped the
    // `Auto save:` row from this page, and a reset may only touch what the page
    // shows -- that is the whole point of a per-panel slice.
    resetKeys(s.system, COMMON_DEFAULTS.system, ['file_history_size']);
    resetKeys(s.system.session, COMMON_DEFAULTS.system.session, ['remember_open_files']);
    // "Project Backup" — every field of `backup` is on this page.
    resetKeys(s.backup, COMMON_DEFAULTS.backup, [
      'enabled',
      'format',
      'location',
      'limit_total_size',
    ]);
  });
  // No `privacy` here any more. The Privacy group was ours rather than KiCad's
  // and has been taken off the page, and a panel's reset slice is exactly the
  // fields its controls bind to -- resetting one the user cannot see would put
  // crash reporting back on from a button labelled "Reset Common to Defaults".
}

/**
 * `PANEL_MOUSE_SETTINGS::ResetPanel` (`common/dialogs/panel_mouse_settings.cpp`):
 *
 *     COMMON_SETTINGS defaultSettings;
 *     defaultSettings.ResetToDefaults();
 *     applySettingsToPanel( defaultSettings );
 *
 * `applySettingsToPanel` reaches only this panel's controls, so this shares
 * `COMMON_SETTINGS` with `PANEL_COMMON_SETTINGS` and still cannot touch its
 * fields. Ours names the slice instead: everything under `input` except the
 * three checkboxes that live on Common ("Warp mouse to anchor of moved object",
 * "First hotkey selects tool", the hotkey popup indicator).
 *
 * Note this is a different button from the panel's own "Reset to Mouse
 * Defaults" / "Reset to Trackpad Defaults", which set the scroll block to one
 * of two presets (`panel_mouse_settings.cpp` `onMouseDefaults` /
 * `onTrackpadDefaults`) rather than to the stored defaults.
 */
export function resetMousePanel(ctx: PrefsContext): void {
  ctx.upC((s) => {
    resetKeys(s.input, COMMON_DEFAULTS.input, [
      // "Pan and Zoom"
      'center_on_zoom',
      'auto_pan',
      'auto_pan_acceleration',
      'zoom_acceleration',
      'zoom_speed',
      'zoom_speed_auto',
      // "Drag Gestures"
      'mouse_left',
      'mouse_middle',
      'mouse_right',
      // "Scroll Gestures"
      'scroll_modifier_zoom',
      'scroll_modifier_pan_h',
      'scroll_modifier_pan_v',
      'reverse_scroll_zoom',
      'reverse_scroll_pan_h',
      'horizontal_pan',
    ]);
  });
}
