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

import type { DialogControlValue } from './settings/common_settings.js';
import { SENTRY } from './app_monitor.js';
import { IO_ERROR } from './exceptions.js';
import type { MOUSE_DRAG_ACTION } from './mouse_drag_action.js';
import { PROJECT_VAR_NAME } from './project.js';
import type { COMMON_SETTINGS_ENVIRONMENT } from './settings/common_settings.js';
import { ENV_VAR_MAP } from './settings/environment.js';
import { wxGetEnv, wxSetEnv } from './wx/utils.js';
import type { COLOR_SETTINGS } from './settings/color_settings.js';

/** `COMMON_SETTINGS`, the slice the GAL, the panel and the view controls read. */
export interface COMMON_SETTINGS_LIKE {
  /** `m_Session` (COMMON_SETTINGS::SESSION): the libraries pinned to the top of the choosers. */
  m_Session?: { pinned_symbol_libs: string[]; pinned_fp_libs: string[] };
  m_Appearance: {
    /** `show_scrollbars`, PARAM<bool> default true. */
    show_scrollbars: boolean;
    zoom_correction_factor: number;
    /** `hicontrast_dimming_factor`, PARAM<double> default 0.8. */
    hicontrast_dimming_factor: number;
    /**
     * `canvas_scale`: a member, not a PARAM in 10.0 (only the legacy
     * `CanvasScale` migrates into it), so 0.0 - "automatic" - unless set.
     */
    canvas_scale: number;
  };
  /** `COMMON_SETTINGS::GRAPHICS`: `graphics.antialiasing_mode`. */
  m_Graphics: { aa_mode: number };
  /** `COMMON_SETTINGS::INPUT`: the modifiers are `WXK_*` codes, 0 for none. */
  m_Input: COMMON_SETTINGS_INPUT;
  /** `COMMON_SETTINGS::m_Env`: the environment variables KiCad knows about. */
  m_Env: COMMON_SETTINGS_ENVIRONMENT;
  /** `COMMON_SETTINGS::m_DoNotShowAgain` (include/settings/common_settings.h:161-169). */
  m_DoNotShowAgain: COMMON_SETTINGS_DO_NOT_SHOW_AGAIN;
  /** `CsInternals()`: the dialogs' remembered state. Absent where nothing persists. */
  CsInternals?(): COMMON_SETTINGS_INTERNALS;
}

/**
 * `COMMON_SETTINGS_INTERNALS::m_dialogControlValues` (common_settings_internals.h:29), read and
 * written through the settings store, since a write here must reach `common.json`.
 */
export interface COMMON_SETTINGS_INTERNALS {
  GetDialogControlValue(aDialogKey: string, aControlKey: string): DialogControlValue | undefined;
  SetDialogControlValue(aDialogKey: string, aControlKey: string, aValue: DialogControlValue): void;
}

/** `COMMON_SETTINGS::DO_NOT_SHOW_AGAIN`: the six persisted "Don't show again" flags. */
export interface COMMON_SETTINGS_DO_NOT_SHOW_AGAIN {
  zone_fill_warning: boolean;
  env_var_overwrite_warning: boolean;
  scaled_3d_models_warning: boolean;
  data_collection_prompt: boolean;
  update_check_prompt: boolean;
  migrate_wrl_prompt: boolean;
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

// SETTINGS_MANAGER is `common/settings/settings_manager.cpp`, and lives at the
// same path here; re-exported for the importers that reached it through Pgm().
export { DEFAULT_THEME, SETTINGS_MANAGER } from './settings/settings_manager.js';
import { SETTINGS_MANAGER } from './settings/settings_manager.js';
import { LIBRARY_MANAGER } from './libraries/library_manager.js';

/** `::GetColorSettings( aName )`: `Pgm().GetSettingsManager().GetColorSettings( aName )`. */
export function GetColorSettings(aName: string): COLOR_SETTINGS {
  return Pgm().GetSettingsManager().GetColorSettings(aName);
}

/**
 * `PGM_BASE::HandleException( aPtr, aUnhandled )` (pgm_base.cpp:833-866): log
 * it, and report it when it escaped. A module function, not only the method,
 * because the browser's global handlers can fire before `Pgm()` exists.
 */
export function HandleException(aError: unknown, aUnhandled: boolean): void {
  if (aError instanceof IO_ERROR) {
    console.error(aError.What());

    // Log this IO_ERROR escaped our usual uses (bad)
    if (aUnhandled) SENTRY.Instance().LogException(aError.What(), aUnhandled, aError);
  } else if (aError instanceof Error) {
    SENTRY.Instance().LogException(aError.message, aUnhandled, aError);

    console.error(`Unhandled exception class: ${aError.name}  what: ${aError.message}`);
  } else {
    // We really shouldn't have these but just in case...
    console.error('Unhandled exception of unknown type');

    if (aUnhandled)
      SENTRY.Instance().LogException('Unhandled exception of unknown type', aUnhandled, aError);
  }
}

/** `PGM_BASE::HandleAssert` (pgm_base.cpp:869-894). */
export function HandleAssert(
  aFile: string,
  aLine: number,
  aFunc: string,
  aCond: string,
  aMsg: string,
): void {
  const assertStr =
    aMsg !== ''
      ? `Assertion failed at ${aFile}:${aLine} in ${aFunc}: ${aCond} - ${aMsg}`
      : `Assertion failed at ${aFile}:${aLine} in ${aFunc}: ${aCond}`;

  SENTRY.Instance().LogAssert({ file: aFile, line: aLine, func: aFunc, cond: aCond }, assertStr);
}

export class PGM_BASE {
  private m_settings: COMMON_SETTINGS_LIKE | null;
  private readonly m_settings_manager: SETTINGS_MANAGER;

  HandleException(aError: unknown, aUnhandled: boolean): void {
    HandleException(aError, aUnhandled);
  }

  HandleAssert(aFile: string, aLine: number, aFunc: string, aCond: string, aMsg: string): void {
    HandleAssert(aFile, aLine, aFunc, aCond, aMsg);
  }

  /**
   * @param aSettingsManager is the manager the application already built its
   *        settings files on (`PGM_BASE::InitPgm` creates it first thing);
   *        a fresh one when none is given.
   */
  constructor(
    aCommonSettings: COMMON_SETTINGS_LIKE | null = null,
    aSettingsManager: SETTINGS_MANAGER = new SETTINGS_MANAGER(),
  ) {
    this.m_settings = aCommonSettings;
    this.m_settings_manager = aSettingsManager;

    // `InitPgm`: "Need to create a project early for now (it can have an
    // empty path for the moment)", so that Prj() always works.
    this.m_settings_manager.LoadProject('');
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

  /** `m_library_manager`: the library tables of every type, global and project. */
  private m_library_manager: LIBRARY_MANAGER | null = null;

  /** `GetLibraryManager()`. */
  GetLibraryManager(): LIBRARY_MANAGER {
    if (!this.m_library_manager) this.m_library_manager = new LIBRARY_MANAGER();

    return this.m_library_manager;
  }

  /**
   * `loadCommonSettings`, its environment half: every variable the settings
   * hold goes into the process environment, except KIPRJMOD (reserved for
   * the project path), an empty name, and one the system environment set.
   */
  loadCommonSettings(): void {
    const settings = this.m_settings;
    if (!settings) return;

    for (const [key, item] of settings.m_Env.vars) {
      // Do not store the env var PROJECT_VAR_NAME ("KIPRJMOD") definition if for some reason
      // it is found in config. (It is reserved and defined as project path)
      if (key === PROJECT_VAR_NAME) continue;

      // Don't set bogus empty entries in the environment
      if (key === '') continue;

      // Do not overwrite vars set by the system environment with values from the settings file
      if (item.GetDefinedExternally()) continue;

      this.SetLocalEnvVariable(key, item.GetValue());
    }
  }

  /**
   * `SetLocalEnvVariable`: set one variable in the process environment, unless
   * it is already set - then succeed only if it already has this value.
   */
  SetLocalEnvVariable(aName: string, aValue: string): boolean {
    if (aName === '') return false;

    // Check to see if the environment variable is already set.
    const env = wxGetEnv(aName);

    if (env !== undefined) return env === aValue;

    return wxSetEnv(aName, aValue);
  }

  /**
   * `SetLocalEnvVariables`: put every variable in the process environment,
   * overwriting externally defined ones until the next time the app runs.
   */
  SetLocalEnvVariables(): void {
    const settings = this.m_settings;
    if (!settings) return;

    for (const [key, item] of settings.m_Env.vars) wxSetEnv(key, item.GetValue());
  }

  /** `GetLocalEnvVariables`: `GetCommonSettings()->m_Env.vars`. */
  GetLocalEnvVariables(): ENV_VAR_MAP {
    return this.m_settings?.m_Env.vars ?? new ENV_VAR_MAP();
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
