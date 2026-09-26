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
import { PROJECT, PROJECT_VAR_NAME } from './project.js';
import { PROJECT_FILE, PROJECT_FILE_EXTENSION } from './project/project_file.js';
import { PROJECT_LOCAL_SETTINGS } from './project/project_local_settings.js';
import type { COMMON_SETTINGS_ENVIRONMENT } from './settings/common_settings.js';
import { ENV_VAR_MAP } from './settings/environment.js';
import { wxGetEnv, wxSetEnv } from './wx/utils.js';
import { COLOR_SETTINGS } from './settings/color_settings.js';
import type { JsonObject, JsonValue } from './settings/json_settings.js';

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
  /** `COMMON_SETTINGS::m_Env`: the environment variables KiCad knows about. */
  m_Env: COMMON_SETTINGS_ENVIRONMENT;
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
 * `SETTINGS_MANAGER`: the application registers each editor's settings
 * object under its name (`"pcbnew"`, `"fpedit"`, `"cvpcb"`) and the readers
 * fetch it; and it owns the open PROJECTs. The project half takes and returns
 * parsed JSON — the file system is the app's — and has no lock file.
 */
export class SETTINGS_MANAGER {
  private m_app_settings = new Map<string, object>();

  /// Loaded projects (ownership here)
  private m_projects_list: PROJECT[] = [];

  /// Loaded projects, mapped according to project full name
  private m_projects = new Map<string, PROJECT>();

  /// Loaded project files, mapped according to project full name
  private m_project_files = new Map<string, PROJECT_FILE>();

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

  /**
   * Loads a project or sets up a new project with a specified path.
   *
   * @param aFullPath is the full path to the project; a `.kicad_sch` or
   *                  `.kicad_pcb` is normalised to the `.kicad_pro`.
   * @param aProJson is the parsed `.kicad_pro`, or null when the file does not exist.
   * @param aPrlJson is the parsed `.kicad_prl`, or null when the file does not exist.
   * @param aSetActive if true will set the new project as the active project.
   * @return true if the PROJECT_FILE was loaded, false when it was created from defaults.
   */
  LoadProject(
    aFullPath: string,
    aProJson: JsonValue | null = null,
    aPrlJson: JsonValue | null = null,
    aSetActive = true,
  ): boolean {
    // Normalize path to current project extension. Users may open legacy .pro files,
    // or the OS may hand us a .kicad_sch/.kicad_pcb via file association or drag-and-drop.
    const fullPath = normalizeProjectPath(aFullPath);

    // If already loaded, we are all set.  This might be called more than once over a project's
    // lifetime in case the project is first loaded by the KiCad manager and then Eeschema or
    // Pcbnew try to load it again when they are launched.
    if (this.m_projects.has(fullPath)) return true;

    // No MDI yet
    if (aSetActive && this.m_projects_list.length > 0) {
      const oldProject = this.m_projects_list[0]!;
      this.unloadProjectFile(oldProject);
      this.m_projects.delete(oldProject.GetProjectFullName());
      this.m_projects_list.splice(0, 1);
    }

    const project = new PROJECT();

    project.setProjectFullName(fullPath);

    if (aSetActive) {
      // until multiple projects are in play, set an environment variable for the
      // the project pointer. (wxFileName::GetPath: the directory, no trailing separator.)
      const cut = fullPath.lastIndexOf('/');
      wxSetEnv(PROJECT_VAR_NAME, cut > 0 ? fullPath.slice(0, cut) : cut === 0 ? '/' : '');
    }

    const success = this.loadProjectFile(project, aProJson);

    if (success) project.SetReadOnly(project.GetProjectFile().IsReadOnly());

    this.m_projects_list.push(project);
    this.m_projects.set(fullPath, project);

    const settings = new PROJECT_LOCAL_SETTINGS(project.GetProjectName());

    if (aPrlJson !== null) settings.LoadFromJson(aPrlJson);

    project.setLocalSettings(settings);

    return success;
  }

  /**
   * Saves, unloads and unregisters the given PROJECT.
   *
   * @return true if the project was removed from the manager.
   */
  UnloadProject(aProject: PROJECT | null): boolean {
    if (!aProject || !this.m_projects.has(aProject.GetProjectFullName())) return false;

    const projectPath = aProject.GetProjectFullName();
    const toRemove = this.m_projects.get(projectPath)!;
    const wasActiveProject = this.m_projects_list[0] === toRemove;

    if (!this.unloadProjectFile(aProject)) return false;

    this.m_projects_list.splice(this.m_projects_list.indexOf(toRemove), 1);
    this.m_projects.delete(projectPath);

    if (wasActiveProject) {
      // Immediately reload a null project; this is required until the rest of the application
      // is refactored to not assume that Prj() always works
      if (this.m_projects_list.length === 0) this.LoadProject('');

      // Remove the reference in the environment to the previous project
      wxSetEnv(PROJECT_VAR_NAME, '');
    }

    return true;
  }

  /** A helper while we are not MDI-capable -- return the one and only project. */
  Prj(): PROJECT {
    // No MDI yet:  First project in the list is the active project
    if (this.m_projects_list.length === 0) return SETTINGS_MANAGER.s_emptyProject;

    return this.m_projects_list[0]!;
  }

  private static readonly s_emptyProject = new PROJECT();

  /** Checks if a given path is probably a valid KiCad project loaded here. */
  IsProjectOpen(): boolean {
    return this.m_projects.size > 0;
  }

  IsProjectOpenNotDummy(): boolean {
    return (
      this.m_projects.size > 1 ||
      (this.m_projects.size === 1 && this.m_projects_list[0]!.GetProjectFullName() !== '')
    );
  }

  /** Retrieves a loaded project by full path. */
  GetProject(aFullPath: string): PROJECT | null {
    return this.m_projects.get(aFullPath) ?? null;
  }

  /** Returns a list of open projects; not the empty default project. */
  GetOpenProjects(): string[] {
    const ret: string[] = [];

    for (const [path] of this.m_projects) {
      // Don't save empty projects (these are the default project settings)
      if (path !== '') ret.push(path);
    }

    return ret;
  }

  /**
   * `SaveProject`: the two files' JSON, for the app to write. The project
   * file is what `PROJECT_FILE::SaveToFile` produces (`meta.filename` set),
   * the local settings what `PROJECT_LOCAL_SETTINGS::SaveToFile` does.
   */
  SaveProject(aProject: PROJECT | null = null): { pro: JsonObject; prl: JsonObject } | null {
    const project = aProject ?? this.Prj();

    if (!this.m_projects.has(project.GetProjectFullName())) return null;

    return {
      pro: project.GetProjectFile().SaveToJson(),
      prl: project.GetLocalSettings().SaveToJson(),
    };
  }

  private loadProjectFile(aProject: PROJECT, aProJson: JsonValue | null): boolean {
    const file = new PROJECT_FILE(aProject.GetProjectName());

    this.m_project_files.set(aProject.GetProjectFullName(), file);

    aProject.setProjectFile(file);
    file.SetProject(aProject);

    if (aProJson === null) {
      // JSON_SETTINGS::LoadFromFile on a missing file: the defaults.
      file.LoadFromJson({});
      return false;
    }

    file.LoadFromJson(aProJson);
    return true;
  }

  private unloadProjectFile(aProject: PROJECT | null): boolean {
    if (!aProject) return false;

    const name = aProject.GetProjectFullName();

    if (!this.m_project_files.has(name)) return false;

    this.m_project_files.delete(name);

    return true;
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

/** `wxFileName::SetExt( ProjectFileExtension )` when the name has another. */
function normalizeProjectPath(aFullPath: string): string {
  const slash = aFullPath.lastIndexOf('/');
  const file = aFullPath.slice(slash + 1);
  const dot = file.lastIndexOf('.');

  if (file === '' || dot <= 0) return aFullPath;

  if (file.slice(dot + 1) === PROJECT_FILE_EXTENSION) return aFullPath;

  return `${aFullPath.slice(0, slash + 1)}${file.slice(0, dot)}.${PROJECT_FILE_EXTENSION}`;
}

/** `::GetColorSettings( aName )`: `Pgm().GetSettingsManager().GetColorSettings( aName )`. */
export function GetColorSettings(aName: string): COLOR_SETTINGS {
  return Pgm().GetSettingsManager().GetColorSettings(aName);
}

export class PGM_BASE {
  private m_settings: COMMON_SETTINGS_LIKE | null;
  private readonly m_settings_manager = new SETTINGS_MANAGER();

  constructor(aCommonSettings: COMMON_SETTINGS_LIKE | null = null) {
    this.m_settings = aCommonSettings;

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
