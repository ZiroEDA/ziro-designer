// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/settings/settings_manager.cpp` + `include/settings/settings_manager.h`:
 * the one object that loads, saves and hands out every settings file, the
 * colour themes, and the open projects.
 *
 * Upstream a settings file is a path under `PATHS::GetUserSettingsPath()` and
 * `registerSettings` / `Load` / `Save` call `LoadFromFile` / `SaveToFile` on
 * it. A browser has no such directory, so the manager is handed a
 * {@link SETTINGS_STORE} - the app's storage, keyed by the file's basename -
 * and reads and writes through that instead. Which storage it is (the
 * browser's, an account's) is the application's business, not this module's.
 */

import { PROJECT, PROJECT_VAR_NAME } from '../project.js';
import { PROJECT_FILE, PROJECT_FILE_EXTENSION } from '../project/project_file.js';
import { PROJECT_LOCAL_SETTINGS } from '../project/project_local_settings.js';
import { wxSetWorkingDirectory } from '../wx/filefn.js';
import { wxSetEnv } from '../wx/utils.js';
import { COLOR_SETTINGS } from './color_settings.js';
import { JSON_SETTINGS } from './json_settings.js';
import type { JsonObject, JsonValue } from './json_settings_internals.js';

/**
 * Where `SETTINGS_LOC::USER` files live: the directory `GetPathForSettingsFile`
 * resolves to upstream. `aFilename` is the file's basename without extension
 * (`"eeschema"`, `"kicad"`, `"colors.user"`); a missing file reads as
 * `undefined`, which a settings object loads as its defaults.
 */
export interface SETTINGS_STORE {
  Read(aFilename: string): unknown;
  Write(aFilename: string, aValue: unknown): void;
}

/**
 * What the manager needs of a registered settings file: its name, and the two
 * halves of `LoadFromFile` / `SaveToFile` that do not touch a disk.
 * `JSON_SETTINGS` is one.
 */
export interface SETTINGS_FILE {
  GetFilename(): string;
  LoadFromJson(aJson: unknown): void;
  SaveToJson(): unknown;
}

/**
 * `SETTINGS_MANAGER`: the registered settings files, loaded from and saved to
 * the {@link SETTINGS_STORE}; the app settings the readers fetch by name
 * (`"pcbnew"`, `"fpedit"`, `"cvpcb"`); the colour themes; and the open
 * PROJECTs. The project half takes and returns parsed JSON - the file system
 * is the app's - and has no lock file.
 */
export class SETTINGS_MANAGER {
  /** `m_settings`: every registered settings file, in registration order. */
  private m_settings: SETTINGS_FILE[] = [];

  /**
   * `m_app_settings_cache`, keyed by name rather than by `typeid`: the object
   * `GetAppSettings` hands out. An editor whose settings object is a view built
   * from its file (`PCBNEW_SETTINGS` from the `pcbnew` file) registers the view
   * here by name; a file that is itself a `JSON_SETTINGS` is found in
   * `m_settings` instead.
   */
  private m_app_settings = new Map<string, object>();

  /** Where the files are read from and written to; null until the app installs one. */
  private m_store: SETTINGS_STORE | null = null;

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

      // set the cwd but don't impact kicad-cli
      if (cut > 0) wxSetWorkingDirectory(fullPath.slice(0, cut));
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

    // SETTINGS_MANAGER::SaveProject (settings_manager.cpp:1234): both files written to the project
    // folder, onto whichever writable mount holds it. The JSON goes back too, for the callers
    // that persist it themselves.
    if (!project.IsReadOnly()) {
      const projectPath = project.GetProjectPath();
      project.GetProjectFile().SaveToFile(projectPath);
      project.GetLocalSettings().SaveToFile(projectPath);
    }

    return {
      pro: project.GetProjectFile().SaveToJson(),
      prl: project.GetLocalSettings().SaveToJson(),
    };
  }

  /** `SaveProjectAs( aFullPath, aProject )` (settings_manager.cpp:1261). */
  SaveProjectAs(aFullPath: string, aProject: PROJECT | null = null): void {
    const project = aProject ?? this.Prj();
    const oldName = project.GetProjectFullName();

    if (aFullPath === oldName) {
      this.SaveProject(project);
      return;
    }

    // Changing this will cause UnloadProject to not save over the "old" project when loading below
    project.setProjectFullName(aFullPath);

    const dir = aFullPath.slice(0, aFullPath.lastIndexOf('/'));
    const name = aFullPath.slice(aFullPath.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

    const file = this.m_project_files.get(oldName)!;

    // Ensure read-only flags are copied; this allows doing a "Save As" on a standalone board/sch
    // without creating project files if the checkbox is turned off
    file.SetReadOnly(project.IsReadOnly());
    project.GetLocalSettings().SetReadOnly(project.IsReadOnly());

    file.SetFilename(name);
    file.SaveToFile(dir);

    project.GetLocalSettings().SetFilename(name);
    project.GetLocalSettings().SaveToFile(dir);

    this.m_project_files.set(aFullPath, file);
    this.m_project_files.delete(oldName);

    this.m_projects.set(aFullPath, this.m_projects.get(oldName)!);
    this.m_projects.delete(oldName);
  }

  /** `SaveProjectCopy( aFullPath, aProject )` (settings_manager.cpp:1300). */
  SaveProjectCopy(aFullPath: string, aProject: PROJECT | null = null): void {
    const project = aProject ?? this.Prj();
    const file = this.m_project_files.get(project.GetProjectFullName())!;
    const oldName = file.GetFilename();
    const dir = aFullPath.slice(0, aFullPath.lastIndexOf('/'));
    const name = aFullPath.slice(aFullPath.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');

    const readOnly = file.IsReadOnly();
    file.SetReadOnly(false);

    file.SetFilename(name);
    file.SaveToFile(dir);
    file.SetFilename(oldName);

    const localSettings = project.GetLocalSettings();

    localSettings.SetFilename(name);
    localSettings.SaveToFile(dir);
    localSettings.SetFilename(oldName);

    file.SetReadOnly(readOnly);
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

    return file.LoadFromFile(aProJson);
  }

  private unloadProjectFile(aProject: PROJECT | null): boolean {
    if (!aProject) return false;

    const name = aProject.GetProjectFullName();

    if (!this.m_project_files.has(name)) return false;

    this.m_project_files.delete(name);

    return true;
  }

  /** The storage the settings files live in; `PATHS::GetUserSettingsPath()`'s directory. */
  SetStore(aStore: SETTINGS_STORE | null): void {
    this.m_store = aStore;
  }

  GetStore(): SETTINGS_STORE | null {
    return this.m_store;
  }

  /**
   * `RegisterSettings( aSettings, aLoadNow )`: take a settings file, and load
   * it from the store now unless told not to.
   *
   * The two-argument `( aName, aSettings )` form registers an app settings
   * object that is not itself a file - a view an editor builds from its file -
   * so `GetAppSettings( aName )` hands it out.
   */
  RegisterSettings<T extends SETTINGS_FILE>(aSettings: T, aLoadNow?: boolean): T;
  RegisterSettings(aName: string, aSettings: object): void;
  RegisterSettings(
    aSettingsOrName: SETTINGS_FILE | string,
    aLoadNowOrSettings: boolean | object = true,
  ): SETTINGS_FILE | undefined {
    if (typeof aSettingsOrName === 'string') {
      this.m_app_settings.set(aSettingsOrName, aLoadNowOrSettings as object);
      return undefined;
    }

    const settings = aSettingsOrName;

    if (settings instanceof JSON_SETTINGS) settings.SetManager(this);

    if (aLoadNowOrSettings !== false) this.loadFromStore(settings);

    this.m_settings.push(settings);
    return settings;
  }

  /**
   * `GetAppSettings<T>( aName )`: the app settings registered under that name,
   * else a registered `JSON_SETTINGS` file of that name; null where the C++
   * would fail its assert.
   */
  GetAppSettings<T extends object>(aName: string): T | null {
    const cached = this.m_app_settings.get(aName);

    if (cached) return cached as T;

    const file = this.m_settings.find(
      (s) => s instanceof JSON_SETTINGS && s.GetFilename() === aName,
    );

    return (file as T | undefined) ?? null;
  }

  /** `Load()`: every registered file, from the store. */
  Load(): void;
  /** `Load( aSettings )`: one registered file, from the store. */
  Load(aSettings: SETTINGS_FILE): void;
  Load(aSettings?: SETTINGS_FILE): void {
    if (aSettings === undefined) {
      // Cache a copy; m_settings may be modified during the load loop
      for (const settings of [...this.m_settings]) this.loadFromStore(settings);
    } else if (this.m_settings.includes(aSettings)) {
      this.loadFromStore(aSettings);
    }
  }

  /** `Save()`: every registered file, to the store. */
  Save(): void;
  /** `Save( aSettings )`: one registered file, to the store. */
  Save(aSettings: SETTINGS_FILE): void;
  Save(aSettings?: SETTINGS_FILE): void {
    if (aSettings === undefined) {
      for (const settings of this.m_settings) {
        // Never automatically save color settings, caller should use SaveColorSettings
        if (settings instanceof COLOR_SETTINGS) continue;

        // Never automatically save project file, caller should use SaveProject or UnloadProject
        if (settings instanceof PROJECT_FILE) continue;

        this.saveToStore(settings);
      }
    } else if (this.m_settings.includes(aSettings)) {
      this.saveToStore(aSettings);
    }
  }

  /** `FlushAndRelease( aSettings, aSave )`: save it (unless told not to) and forget it. */
  FlushAndRelease(aSettings: SETTINGS_FILE, aSave = true): void {
    const i = this.m_settings.indexOf(aSettings);

    if (i < 0) return;

    if (aSave) this.saveToStore(aSettings);

    const name = aSettings.GetFilename();

    if (this.m_app_settings.get(name) === aSettings) this.m_app_settings.delete(name);

    this.m_settings.splice(i, 1);
  }

  /** `LoadFromFile( GetPathForSettingsFile( aSettings ) )`. */
  private loadFromStore(aSettings: SETTINGS_FILE): void {
    aSettings.LoadFromJson(this.m_store ? this.m_store.Read(aSettings.GetFilename()) : undefined);
  }

  /** `SaveToFile( GetPathForSettingsFile( aSettings ) )`. */
  private saveToStore(aSettings: SETTINGS_FILE): void {
    const value = aSettings.SaveToJson();

    this.m_store?.Write(aSettings.GetFilename(), value);
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
