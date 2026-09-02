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
  // "User" theme: the default theme with the stored per-layer overrides.
  return { ...KICAD_DEFAULT, ...settings.userColors } as Theme;
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

export function useSchematicTheme(): Theme {
  useSettingsVersion();
  return resolveTheme();
}
