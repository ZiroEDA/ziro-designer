// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pgm_base.h`: the process-wide `PGM_BASE`, reached through `Pgm()` /
 * `PgmOrNull()`. Only the part the ported common code reads is here — the
 * common settings — and the application installs the object at start-up
 * (`SetPgm`), as `PGM_BASE::InitPgm` would; before that `PgmOrNull()` is
 * null, which the readers already handle.
 */

import type { MOUSE_DRAG_ACTION } from './mouse_drag_action.js';
import { COLOR_SETTINGS } from './settings/color_settings.js';

/** `COMMON_SETTINGS`, the slice the GAL, the panel and the view controls read. */
export interface COMMON_SETTINGS_LIKE {
  m_Appearance: {
    /** `show_scrollbars`, PARAM<bool> default true. */
    show_scrollbars: boolean;
    zoom_correction_factor: number;
    /** `hicontrast_dimming_factor`, PARAM<double> default 0.8. */
    hicontrast_dimming_factor: number;
  };
  /** `COMMON_SETTINGS::INPUT`: the modifiers are `WXK_*` codes, 0 for none. */
  m_Input: COMMON_SETTINGS_INPUT;
}

/** `COMMON_SETTINGS::INPUT` (include/settings/common_settings.h). */
export interface COMMON_SETTINGS_INPUT {
  focus_follow_sch_pcb: boolean;
  auto_pan: boolean;
  auto_pan_acceleration: number;
  center_on_zoom: boolean;
  immediate_actions: boolean;
  warp_mouse_on_move: boolean;
  horizontal_pan: boolean;
  hotkey_feedback: boolean;

  zoom_acceleration: boolean;
  zoom_speed: number;
  zoom_speed_auto: boolean;

  scroll_modifier_zoom: number;
  scroll_modifier_pan_h: number;
  scroll_modifier_pan_v: number;

  motion_pan_modifier: number;

  drag_left: MOUSE_DRAG_ACTION;
  drag_middle: MOUSE_DRAG_ACTION;
  drag_right: MOUSE_DRAG_ACTION;

  reverse_scroll_zoom: boolean;
  reverse_scroll_pan_h: boolean;
}

/**
 * `SETTINGS_MANAGER`, the part `GetAppSettings<T>( "pcbnew" )` needs: the
 * application registers each editor's settings object under its name
 * (`"pcbnew"`, `"fpedit"`, `"cvpcb"`), and the readers fetch it.
 */
export class SETTINGS_MANAGER {
  private m_app_settings = new Map<string, object>();

  /// Loaded color settings map (filename, settings). Filename may be a full path.
  private m_color_settings = new Map<string, COLOR_SETTINGS>();

  /**
   * `loadColorSettingsByName`'s file: the application stores its themes and
   * hands the manager a loader that returns the theme's contents, or null
   * when no such theme file exists.
   */
  private m_colorSettingsLoader: ((aName: string) => COLOR_SETTINGS | null) | null = null;

  constructor() {
    this.registerBuiltinColorSettings();
  }

  /** `RegisterSettings( aSettings )`: the app settings under their filename. */
  RegisterSettings(aName: string, aSettings: object): void {
    this.m_app_settings.set(aName, aSettings);
  }

  /** `GetAppSettings<T>( aName )`: null where the C++ would create one from its defaults. */
  GetAppSettings<T extends object>(aName: string): T | null {
    return (this.m_app_settings.get(aName) as T | undefined) ?? null;
  }

  /**
   * Retrieve a color settings object that applications can read colors from.
   *
   * If the given settings file cannot be found, the default color settings will be returned.
   *
   * @param aName is the name of the color scheme to load.
   * @return a loaded COLOR_SETTINGS object.
   */
  GetColorSettings(aName: string = DEFAULT_THEME): COLOR_SETTINGS {
    // Find settings the fast way
    const fast = this.m_color_settings.get(aName);

    if (fast) return fast;

    // Maybe it's the display name (cli is one method of invoke)
    for (const settings of this.m_color_settings.values()) {
      if (settings.GetName().toLowerCase() === aName.toLowerCase()) return settings;
    }

    // No match? See if we can load it
    if (aName.length > 0) {
      let ret = this.loadColorSettingsByName(aName);

      if (!ret) {
        ret = this.registerColorSettings(aName);
        ret.assign(this.m_color_settings.get(COLOR_SETTINGS.COLOR_BUILTIN_DEFAULT)!);
        ret.SetFilename(DEFAULT_THEME);
        ret.SetReadOnly(false);
      }

      return ret;
    }

    // This had better work
    return this.m_color_settings.get(COLOR_SETTINGS.COLOR_BUILTIN_DEFAULT)!;
  }

  GetColorSettingsList(): COLOR_SETTINGS[] {
    const ret = [...this.m_color_settings.values()];

    ret.sort((a, b) => (a.GetName() < b.GetName() ? -1 : a.GetName() > b.GetName() ? 1 : 0));

    return ret;
  }

  /** The application's theme store: `loadColorSettingsByName` reads through it. */
  SetColorSettingsLoader(aLoader: ((aName: string) => COLOR_SETTINGS | null) | null): void {
    this.m_colorSettingsLoader = aLoader;
  }

  private loadColorSettingsByName(aName: string): COLOR_SETTINGS | null {
    const settings = this.m_colorSettingsLoader ? this.m_colorSettingsLoader(aName) : null;

    if (!settings) return null;

    if (settings.GetFilename() !== aName)
      console.warn(`Warning: stored filename is actually ${settings.GetFilename()}, `);

    this.m_color_settings.set(aName, settings);

    return settings;
  }

  private registerColorSettings(aName: string): COLOR_SETTINGS {
    if (!this.m_color_settings.has(aName)) {
      const colorSettings = new COLOR_SETTINGS(aName);
      this.m_color_settings.set(aName, colorSettings);
    }

    return this.m_color_settings.get(aName)!;
  }

  /**
   * Register a new color settings object with the given filename.
   */
  AddNewColorSettings(aName: string): COLOR_SETTINGS {
    if (aName.endsWith('.json')) return this.registerColorSettings(aName.slice(0, -'.json'.length));

    return this.registerColorSettings(aName);
  }

  private registerBuiltinColorSettings(): void {
    for (const settings of COLOR_SETTINGS.CreateBuiltinColorSettings())
      this.m_color_settings.set(settings.GetFilename(), settings);
  }
}

/** `DEFAULT_THEME`. */
export const DEFAULT_THEME = 'user';

/** `::GetColorSettings( aName )`: `Pgm().GetSettingsManager().GetColorSettings( aName )`. */
export function GetColorSettings(aName: string): COLOR_SETTINGS {
  return Pgm().GetSettingsManager().GetColorSettings(aName);
}

export class PGM_BASE {
  private m_settings: COMMON_SETTINGS_LIKE | null;
  private readonly m_settings_manager = new SETTINGS_MANAGER();

  constructor(aCommonSettings: COMMON_SETTINGS_LIKE | null = null) {
    this.m_settings = aCommonSettings;
  }

  GetCommonSettings(): COMMON_SETTINGS_LIKE | null {
    return this.m_settings;
  }

  SetCommonSettings(aCommonSettings: COMMON_SETTINGS_LIKE | null): void {
    this.m_settings = aCommonSettings;
  }

  GetSettingsManager(): SETTINGS_MANAGER {
    return this.m_settings_manager;
  }
}

let g_pgm: PGM_BASE | null = null;

/** `PgmOrNull()`: the program object, or null before it is set up. */
export function PgmOrNull(): PGM_BASE | null {
  return g_pgm;
}

/** `Pgm()`: the program object; throws before it is set up, as the reference would. */
export function Pgm(): PGM_BASE {
  if (!g_pgm) throw new Error('Pgm() called before the PGM_BASE was set');
  return g_pgm;
}

/** `SetPgm( PGM_BASE* )`: the application installs its program object. */
export function SetPgm(aPgm: PGM_BASE | null): void {
  g_pgm = aPgm;
}
