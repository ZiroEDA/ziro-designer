// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel`'s missing half: a way for a panel to say which
 * fields are *its own*.
 *
 * Upstream never has to say it. A preferences panel resets itself by
 * default-constructing the settings object and pushing it at its own widgets —
 *
 *     void PANEL_MOUSE_SETTINGS::ResetPanel()
 *     {
 *         COMMON_SETTINGS defaultSettings;
 *         defaultSettings.ResetToDefaults();
 *         applySettingsToPanel( defaultSettings );
 *     }
 *     (common/dialogs/panel_mouse_settings.cpp)
 *
 * — and `applySettingsToPanel` can only reach the controls that exist on this
 * panel. `TransferDataFromWindow` then writes back exactly those. So although
 * `PANEL_COMMON_SETTINGS` and `PANEL_MOUSE_SETTINGS` share one `COMMON_SETTINGS`,
 * resetting Mouse and Touchpad cannot disturb Common's fields: the widgets that
 * hold them are on the other panel.
 *
 * Our panels have no widget tree standing between them and the settings object;
 * they write into a plain working copy. `ctx.setCommon(structuredClone(
 * COMMON_DEFAULTS))` therefore looks like the same thing and is not — it resets
 * the whole object, and OK commits all of it. So each panel names its slice, and
 * this is what it names it with. `keyof` makes a typo a type error; a key left
 * out is a field that silently never resets, which is what
 * `qa/unittests/designer/prefs_reset_slices.test.ts` exists to catch.
 */

/**
 * Copy `keys` from `defaults` onto `target`, and nothing else — one panel's
 * `applySettingsToPanel`.
 *
 * Values are cloned, so a panel that resets an array or a nested record cannot
 * end up aliasing the shared defaults object and mutating it on the next edit.
 */
export function resetKeys<T extends object, K extends keyof T>(
  target: T,
  defaults: T,
  keys: readonly K[],
): void {
  for (const key of keys) target[key] = structuredClone(defaults[key]);
}
