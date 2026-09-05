// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * React bindings for the settings manager: subscribe components to the
 * settings snapshots and derive the active schematic colour theme.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { settings } from './settings.js';
import { BUILTIN_THEMES, KICAD_DEFAULT, type Theme } from '../editors/schematic/theme.js';
import { dsLoadColors, type DsRenderColors } from '@ziroeda/common';
import { pcm } from '../pcm/pcmStore.js';

export function useSettingsVersion(): number {
  return useSyncExternalStore(settings.subscribe, () => settings.version);
}

export function useCommonSettings(): typeof settings.common {
  useSettingsVersion();
  return settings.common;
}

export function useEeschemaSettings(): typeof settings.eeschema {
  useSettingsVersion();
  return settings.eeschema;
}

/** `symbol_editor.json`, so the Symbol Editor re-renders when it changes. */
export function useSymbolEditorSettings(): typeof settings.symbolEditor {
  useSettingsVersion();
  return settings.symbolEditor;
}

/**
 * `fpedit.json`, so the Footprint Editor re-renders when it changes.
 *
 * `FOOTPRINT_EDIT_FRAME` is handed
 * `GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" )` and never pcbnew's
 * (`pcbnew/pcbnew.cpp:305-399`), which is the whole reason this editor's five
 * settings pages are its own and not the board editor's.
 */
export function useFpEditSettings(): typeof settings.fpEdit {
  useSettingsVersion();
  return settings.fpEdit;
}

/** `pl_editor.json`, so the Drawing Sheet Editor re-renders when it changes. */
export function usePlEditorSettings(): typeof settings.plEditor {
  useSettingsVersion();
  return settings.plEditor;
}

/**
 * `colors/user.json` — the editable "User" theme's per-layer overrides.
 *
 * One file upstream, holding every app's colours under its own namespace:
 * `PANEL_COLOR_SETTINGS` announces which by setting `m_colorNamespace`
 * (`panel_gerbview_color_settings.cpp:33` sets `"gerbview"`), and a
 * `COLOR_SETTINGS` file carries them all. Ours is one flat map with the
 * namespace in the key, which is why a frame subscribing to it sees only its
 * own rows move.
 */
export function useUserColors(): typeof settings.userColors {
  useSettingsVersion();
  return settings.userColors;
}

/** `gerbview.json`, so the Gerber Viewer re-renders when it changes. */
export function useGerbviewSettings(): typeof settings.gerbview {
  useSettingsVersion();
  return settings.gerbview;
}

/** The user's hotkey overrides, so menus relabel the moment one is rebound. */
export function useHotkeyOverrides(): typeof settings.hotkeys {
  useSettingsVersion();
  return settings.hotkeys;
}

/**
 * `::GetColorSettings( aThemeName )` — the free function every frame calls to
 * turn the `appearance.color_theme` it stored into a live `COLOR_SETTINGS`
 * (`pl_draw_panel_gal.cpp:59`, `pl_editor_frame.cpp:642`,
 * `panel_pl_editor_color_settings.cpp:36` all call exactly this).
 *
 * It takes the theme id rather than reading one app's settings, because
 * upstream's does: each frame passes its OWN `cfg->m_ColorTheme`, which is why
 * the Drawing Sheet Editor and eeschema can be on different themes at once.
 */
export function resolveThemeById(id: string): Theme {
  const builtin = BUILTIN_THEMES[id];
  if (builtin) return builtin.theme;
  // A colour theme installed via the Plugin and Content Manager.
  const installed = pcm.themeById(id);
  if (installed) return installed;
  // A theme "New Theme..." made, which carries a colour table of its own.
  const made = settings.userThemes[id];
  if (made) return { ...KICAD_DEFAULT, ...made.colors } as Theme;
  // "User" theme: the default theme with the stored per-layer overrides.
  return { ...KICAD_DEFAULT, ...settings.userColors } as Theme;
}

/**
 * `COLOR_SETTINGS::GetOverrideSchItemColors()` for one theme id.
 *
 * Both built-ins and everything the PCM installs leave it at
 * `color_settings.cpp:49`'s false — they are read-only, and nothing can write
 * one. Only a theme with a file of its own carries a true.
 */
export function overrideItemColorsFor(id: string): boolean {
  if (BUILTIN_THEMES[id] || pcm.themeById(id)) return false;
  const made = settings.userThemes[id];
  if (made) return made.override;
  return settings.eeschema.appearance.override_item_colors;
}

/** Resolve the active theme (COLOR_SETTINGS lookup): builtin id, a PCM-installed
 *  theme, or the User theme. */
export function resolveTheme(): Theme {
  return resolveThemeById(settings.eeschema.appearance.color_theme);
}

/**
 * `DS_RENDER_SETTINGS::LoadColors( ::GetColorSettings( cfg->m_ColorTheme ) )`,
 * the line `PL_DRAW_PANEL_GAL`'s constructor runs on its own painter
 * (`pagelayout_editor/pl_draw_panel_gal.cpp:57-59`):
 *
 *     PL_EDITOR_SETTINGS* cfg = GetAppSettings<PL_EDITOR_SETTINGS>( "pl_editor" );
 *     m_painter->GetSettings()->LoadColors(
 *             ::GetColorSettings( cfg ? cfg->m_ColorTheme : DEFAULT_THEME ) );
 *
 * The DRAW PANEL asks, not the frame — which is why this is a hook the canvas
 * calls rather than a prop the editor threads down. `PL_EDITOR_FRAME::CommonSettingsChanged`
 * (`pl_editor_frame.cpp:637-655`) then re-runs the same two calls and follows
 * them with `UpdateAllItems( KIGFX::COLOR )` and `ForceRefresh()`; subscribing
 * to the settings version is what gives us that repaint.
 */
export function usePlEditorColors(): DsRenderColors {
  // Memoised on the theme id and the settings version so the returned object is
  // reference-stable between settings writes: the canvas lists it in `draw`'s
  // dependencies, and a fresh object every render would re-arm the redraw
  // effect on every render.
  const version = useSettingsVersion();
  const id = settings.plEditor.appearance.color_theme;
  return useMemo(() => dsLoadColors(resolveThemeById(id)), [id, version]);
}

/**
 * `SYMBOL_EDIT_FRAME::GetColorSettings` (`eeschema/symbol_editor/symbol_edit_frame.cpp:402-410`):
 *
 *     APP_SETTINGS_BASE* cfg = GetSettings();
 *     if( cfg && static_cast<SYMBOL_EDITOR_SETTINGS*>( cfg )->m_UseEeschemaColorSettings )
 *         cfg = GetAppSettings<EESCHEMA_SETTINGS>( "eeschema" );
 *     return ::GetColorSettings( cfg ? cfg->m_ColorTheme : DEFAULT_THEME );
 *
 * — the whole of what the two radio buttons on Preferences > Symbol Editor >
 * Colors decide, and the reason that page is not simply a second copy of the
 * schematic's theme choice. It is a *swap of which settings object is asked*,
 * so with "Use schematic editor color theme" set the symbol editor follows
 * eeschema and the symbol editor's own `appearance.color_theme` is not read at
 * all — which is also why the page's `TransferDataFromWindow` writes that key
 * only on the other branch (`panel_sym_color_settings.cpp:74-86`).
 *
 * The Symbol Editor called `useSchematicTheme()` before this, i.e. it took the
 * first branch unconditionally and the choice could not exist.
 */
export function useSymbolEditorTheme(): Theme {
  useSettingsVersion();
  const cfg = settings.symbolEditor;
  return resolveThemeById(
    cfg.use_eeschema_color_settings
      ? settings.eeschema.appearance.color_theme
      : cfg.appearance.color_theme,
  );
}

export function useSchematicTheme(): Theme {
  useSettingsVersion();
  return resolveTheme();
}
