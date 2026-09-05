// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_BASE_FRAME::RecreateToolbars` (`common/eda_base_frame.cpp:1728-1843`).
 *
 * Upstream that method is the only place a frame's four toolbars are filled,
 * and every one of its four blocks is the same two lines:
 *
 *     tbConfig = m_toolbarSettings->GetToolbarConfig( TOOLBAR_LOC::LEFT,
 *                                                     config()->m_CustomToolbars );
 *     if( tbConfig.has_value() ) m_tbLeft->ApplyConfiguration( tbConfig.value() );
 *
 * — so the frame never reads `DefaultToolbarConfig` itself. That indirection is
 * the entire reason Preferences > Toolbars does anything at all: a page that
 * edited the store while the frame kept reading the module constant would look
 * like it worked and change nothing.
 *
 * `RecreateToolbars` is also called on `CommonSettingsChanged`, which is what
 * makes an OK in the dialog show up on the toolbars without reopening the
 * editor. Here that is `useSyncExternalStore` on the settings manager's version
 * counter, which every editor already re-renders through.
 */
import { settings, type ToolbarApp } from '../prefs/settings.js';
import { useSettingsVersion } from '../prefs/useSettings.js';
import { resolveToolbarConfig, type ToolbarDefaults, type ToolbarLoc } from './toolbar_config.js';
import type { ToolEntry } from './toolbar_types.js';

/**
 * `config()->m_CustomToolbars` for one app — the `aAllowCustom` argument.
 *
 * `appearance.custom_toolbars` is an `APP_SETTINGS_BASE` key
 * (`common/settings/app_settings.cpp:285-286`), so every app has it in exactly
 * the same place, and this is the one switch that says so.
 */
export function customToolbarsEnabled(app: ToolbarApp): boolean {
  switch (app) {
    case 'eeschema':
      return settings.eeschema.appearance.custom_toolbars;
    case 'symbol_editor':
      return settings.symbolEditor.appearance.custom_toolbars;
    case 'pcbnew':
      return settings.pcbnew.appearance.custom_toolbars;
    case 'pl_editor':
      return settings.plEditor.appearance.custom_toolbars;
    case 'gerbview':
      return settings.gerbview.appearance.custom_toolbars;
    case 'fpedit':
      return settings.fpEdit.appearance.custom_toolbars;
    case '3d_viewer':
      return settings.viewer3d.appearance.custom_toolbars;
  }
}

/**
 * The entries one toolbar should draw right now: stored if customised,
 * otherwise the module's own list, **by reference**.
 *
 * Exported without the hook so it can be tested from Node, and so a non-React
 * caller can ask the same question the frame asks.
 */
export function toolbarEntries(
  app: ToolbarApp,
  loc: ToolbarLoc,
  defaults: ToolbarDefaults,
): ToolEntry[] {
  return resolveToolbarConfig(defaults, loc, settings.toolbars[app], customToolbarsEnabled(app));
}

/** {@link toolbarEntries}, re-read whenever the settings manager moves. */
export function useToolbarEntries(
  app: ToolbarApp,
  loc: ToolbarLoc,
  defaults: ToolbarDefaults,
): ToolEntry[] {
  useSettingsVersion();
  return toolbarEntries(app, loc, defaults);
}
