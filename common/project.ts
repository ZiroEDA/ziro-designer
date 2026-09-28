// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/project.h` + `common/project.cpp`: the container for a project's
 * two settings files and the per-session objects (the BOARD, the SCHEMATIC)
 * that hang off it.
 *
 * Not here: the lock file, the library adapters, `SaveToHistory`, and the
 * `libTableName` temp-folder fallback — all need a file system. `PinLibrary`
 * updates only the project file; the `COMMON_SETTINGS` half is the
 * settings-manager's, which the app keeps in its own store.
 */
import type { OutStr } from './font/font.js';
import type { KIID } from './kiid.js';
import { type PROJECT_FILE, PROJECT_FILE_EXTENSION } from './project/project_file.js';
import type { PROJECT_LOCAL_SETTINGS } from './project/project_local_settings.js';
import { TITLE_BLOCK } from './title_block.js';

/** `PROJECT_VAR_NAME` (include/project.h): the variable naming the project's directory. */
export const PROJECT_VAR_NAME = 'KIPRJMOD';

/** The set of `_ELEM`s that a `PROJECT` can hold. */
export enum PROJECT_ELEM {
  LEGACY_SYMBOL_LIBS,
  SCH_SEARCH_STACK,
  S3DCACHE,
  SEARCH_STACK,

  SCHEMATIC,
  BOARD,

  COUNT,
}

/**
 * A `PROJECT` can hold stuff it knows nothing about, in the form of `_ELEM`
 * derivatives. Derive PROJECT elements from this; the PROJECT keeps knowledge
 * of derived classes opaque.
 */
export interface PROJECT_ELEM_HOLDER {
  ProjectElementType(): PROJECT_ELEM; // Sanity-checking for returned values.
}

/** Retain a number of project specific strings, enumerated here: */
export enum RSTRING_T {
  DOC_PATH,
  SCH_LIB_PATH,
  SCH_LIB_SELECT, // eeschema/selpart.cpp
  SCH_LIBEDIT_CUR_LIB,
  SCH_LIBEDIT_CUR_SYMBOL, // eeschema/libeditframe.cpp
  VIEWER_3D_PATH,
  VIEWER_3D_FILTER_INDEX,
  PCB_LIB_PATH,
  PCB_LIB_NICKNAME,
  PCB_FOOTPRINT,
  PCB_FOOTPRINT_EDITOR_FP_NAME,
  PCB_FOOTPRINT_EDITOR_LIB_NICKNAME,
  PCB_FOOTPRINT_VIEWER_FP_NAME,
  PCB_FOOTPRINT_VIEWER_LIB_NICKNAME,
  RSTRING_COUNT,
}

export enum LIB_TYPE_T {
  SYMBOL_LIB,
  FOOTPRINT_LIB,
  DESIGN_BLOCK_LIB,

  LIB_TYPE_COUNT,
}

/** `FILEEXT::SymbolLibraryTableFileName` and friends. */
const SYMBOL_LIBRARY_TABLE_FILE_NAME = 'sym-lib-table';
const FOOTPRINT_LIBRARY_TABLE_FILE_NAME = 'fp-lib-table';
const DESIGN_BLOCK_LIBRARY_TABLE_FILE_NAME = 'design-block-lib-table';

/** `wxFileName`, the three parts a PROJECT reads: path, name and extension. */
function splitPath(aFullPath: string): { dir: string; name: string; ext: string } {
  const slash = aFullPath.lastIndexOf('/');
  const dir = slash < 0 ? '' : aFullPath.slice(0, slash);
  const file = aFullPath.slice(slash + 1);
  const dot = file.lastIndexOf('.');

  // wxFileName: a leading dot is part of the name, not an extension.
  if (dot <= 0) return { dir, name: file, ext: '' };

  return { dir, name: file.slice(0, dot), ext: file.slice(dot + 1) };
}

/**
 * Container for project specific data. Because some of the data is being
 * used in only one application, it is only retained in that application, and
 * this class has the ability to hold an `_ELEM` for each.
 */
export class PROJECT {
  private m_project_name = ''; ///< <fullpath>/<basename>.pro
  private m_readOnly: boolean; ///< No project files will be written to disk
  private m_lockOverrideGranted: boolean; ///< User granted override at project level
  private m_textVarsTicker: number; ///< Update counter on text vars
  private m_netclassesTicker: number; ///< Update counter on netclasses

  /// Backing store for project data -- owned by SETTINGS_MANAGER
  private m_projectFile: PROJECT_FILE | null;

  /// Backing store for project local settings -- owned by SETTINGS_MANAGER
  private m_localSettings: PROJECT_LOCAL_SETTINGS | null;

  private m_sheetNames = new Map<KIID, string>();

  /// @see this::SetRString(), GetRString(), and enum RSTRING_T.
  private m_rstrings: string[] = new Array<string>(RSTRING_T.RSTRING_COUNT).fill('');

  /// @see this::Elem() and enum ELEM_T.
  private m_elems: (PROJECT_ELEM_HOLDER | null)[] = new Array<PROJECT_ELEM_HOLDER | null>(
    PROJECT_ELEM.COUNT,
  ).fill(null);

  constructor() {
    this.m_readOnly = false;
    this.m_lockOverrideGranted = false;
    this.m_textVarsTicker = 0;
    this.m_netclassesTicker = 0;
    this.m_projectFile = null;
    this.m_localSettings = null;
  }

  /**
   * Text variables resolution: the project's own tokens, then the project
   * file's `text_variables`. `VCSHASH` is "no hash", what upstream answers
   * when the project is not in a git checkout.
   */
  TextVarResolver(aToken: OutStr): boolean {
    if (!this.m_projectFile) return false;

    if (aToken.value === 'PROJECTNAME') {
      aToken.value = this.GetProjectName();
      return true;
    }

    if (aToken.value === 'CURRENT_DATE') {
      aToken.value = TITLE_BLOCK.GetCurrentDate();
      return true;
    }

    if (aToken.value === 'CURRENT_TIME_HH_MM_SS') {
      aToken.value = TITLE_BLOCK.GetCurrentTimeHHMMSS();
      return true;
    }

    if (aToken.value === 'CURRENT_TIME_LOCALE') {
      aToken.value = TITLE_BLOCK.GetCurrentTimeLocale();
      return true;
    }

    if (aToken.value === 'VCSHASH' || aToken.value === 'VCSSHORTHASH') {
      aToken.value = 'no hash';
      return true;
    }

    const vars = this.GetTextVars();

    if (vars.has(aToken.value)) {
      aToken.value = vars.get(aToken.value)!;
      return true;
    }

    return false;
  }

  /** Return the map of `text_variables` from the project file. */
  GetTextVars(): Map<string, string> {
    return this.GetProjectFile().m_TextVars;
  }

  /** Create or update the existing vars. */
  ApplyTextVars(aVarsMap: ReadonlyMap<string, string>): void {
    if (aVarsMap.size === 0) return;

    const existingVarsMap = this.GetTextVars();

    for (const [name, value] of aVarsMap) existingVarsMap.set(name, value);
  }

  GetTextVarsTicker(): number {
    return this.m_textVarsTicker;
  }

  IncrementTextVarsTicker(): void {
    this.m_textVarsTicker++;
  }

  GetNetclassesTicker(): number {
    return this.m_netclassesTicker;
  }

  IncrementNetclassesTicker(): void {
    this.m_netclassesTicker++;
  }

  /** Return the full path and name of the project. */
  GetProjectFullName(): string {
    return this.m_project_name;
  }

  /** Return the full path of the project, with a trailing separator. */
  GetProjectPath(): string {
    // wxFileName::GetPathWithSep(): the separator only follows a path there is -
    // a bare name ("" or "board.kicad_pro") has none, "/x.kicad_pro" has "/".
    if (!this.m_project_name.includes('/')) return '';

    const { dir } = splitPath(this.m_project_name);

    return `${dir}/`;
  }

  /** Return the full path of the project directory, without a trailing separator. */
  GetProjectDirectory(): string {
    return splitPath(this.m_project_name).dir;
  }

  /** Return the short name of the project: the file name without path or extension. */
  GetProjectName(): string {
    return splitPath(this.m_project_name).name;
  }

  /** Check if this project is a null project (i.e. the default project object created when
   * no real project is open). */
  IsNullProject(): boolean {
    return this.GetProjectName() === '';
  }

  IsReadOnly(): boolean {
    return this.m_readOnly || this.IsNullProject();
  }

  SetReadOnly(aReadOnly = true): void {
    this.m_readOnly = aReadOnly;
  }

  IsLockOverrideGranted(): boolean {
    return this.m_lockOverrideGranted;
  }

  SetLockOverrideGranted(aGranted = true): void {
    this.m_lockOverrideGranted = aGranted;
  }

  /** Return the name of the sheet identified by the given UUID. */
  GetSheetName(aSheetID: KIID): string {
    if (this.m_sheetNames.size === 0) {
      for (const pair of this.GetProjectFile().GetSheets())
        this.m_sheetNames.set(pair.first, pair.second);
    }

    return this.m_sheetNames.get(aSheetID) ?? aSheetID;
  }

  /** Return the path and file name of this project's footprint library table. */
  FootprintLibTblName(): string {
    return this.libTableName(FOOTPRINT_LIBRARY_TABLE_FILE_NAME);
  }

  /** Return the path and file name of this project's symbol library table. */
  SymbolLibTableName(): string {
    return this.libTableName(SYMBOL_LIBRARY_TABLE_FILE_NAME);
  }

  /** Return the path and file name of this project's design block library table. */
  DesignBlockLibTblName(): string {
    return this.libTableName(DESIGN_BLOCK_LIBRARY_TABLE_FILE_NAME);
  }

  PinLibrary(aLibrary: string, aLibType: LIB_TYPE_T): void {
    const pinnedLibsFile = this.pinnedLibsFor(aLibType);

    if (!pinnedLibsFile) return;

    if (!pinnedLibsFile.includes(aLibrary)) pinnedLibsFile.push(aLibrary);
  }

  UnpinLibrary(aLibrary: string, aLibType: LIB_TYPE_T): void {
    const pinnedLibsFile = this.pinnedLibsFor(aLibType);

    if (!pinnedLibsFile) return;

    const i = pinnedLibsFile.indexOf(aLibrary);

    if (i >= 0) pinnedLibsFile.splice(i, 1);
  }

  private pinnedLibsFor(aLibType: LIB_TYPE_T): string[] | null {
    const file = this.m_projectFile;

    if (!file) return null;

    switch (aLibType) {
      case LIB_TYPE_T.SYMBOL_LIB:
        return file.m_PinnedSymbolLibs;
      case LIB_TYPE_T.FOOTPRINT_LIB:
        return file.m_PinnedFootprintLibs;
      case LIB_TYPE_T.DESIGN_BLOCK_LIB:
        return file.m_PinnedDesignBlockLibs;
      default:
        console.assert(false, 'Cannot pin library: invalid library type');
        return null;
    }
  }

  GetProjectFile(): PROJECT_FILE {
    console.assert(this.m_projectFile !== null);
    return this.m_projectFile!;
  }

  GetLocalSettings(): PROJECT_LOCAL_SETTINGS {
    console.assert(this.m_localSettings !== null);
    return this.m_localSettings!;
  }

  /**
   * Return a "retained string", which is any session and project specific string
   * identified in enum #RSTRING_T. Retained strings are not written to disk.
   */
  GetRString(aStringId: RSTRING_T): string {
    const ndx = aStringId as number;

    if (ndx < this.m_rstrings.length) return this.m_rstrings[ndx]!;

    console.assert(false); // bad index
    return '';
  }

  SetRString(aStringId: RSTRING_T, aString: string): void {
    const ndx = aStringId as number;

    if (ndx < this.m_rstrings.length) this.m_rstrings[ndx] = aString;
    else console.assert(false); // bad index
  }

  /**
   * Get and set the elements for this project. PROJECT knows nothing about
   * `_ELEM` objects except how to hold them.
   */
  GetElem(aIndex: PROJECT_ELEM): PROJECT_ELEM_HOLDER | null {
    if ((aIndex as number) < this.m_elems.length) return this.m_elems[aIndex]!;

    return null;
  }

  SetElem(aIndex: PROJECT_ELEM, aElem: PROJECT_ELEM_HOLDER | null): void {
    if ((aIndex as number) < this.m_elems.length) this.m_elems[aIndex] = aElem;
  }

  /** Delete all the _ELEMs and set their pointers to NULL. */
  Clear(): void {
    this.elemsClear();

    for (let i = 0; i < RSTRING_T.RSTRING_COUNT; ++i) this.SetRString(i as RSTRING_T, '');
  }

  /**
   * Fix up a file name if it is relative to the project directory. A name
   * starting with an unresolved variable reference is more likely absolute
   * than relative and is returned as is.
   */
  AbsolutePath(aFileName: string): string {
    if (aFileName.startsWith('${')) return aFileName;

    if (!aFileName.startsWith('/')) {
      const pro_dir = this.GetProjectDirectory();

      return pro_dir === '' ? aFileName : `${pro_dir}/${aFileName}`;
    }

    return aFileName;
  }

  protected elemsClear(): void {
    for (let i = 0; i < this.m_elems.length; ++i) this.SetElem(i as PROJECT_ELEM, null);
  }

  /**
   * Set the full directory, basename and extension of the project. This is
   * the aggregate of the project's file and directory.
   */
  setProjectFullName(aFullPathAndName: string): void {
    // Edge transitions only.  This is what clears the project
    // data using the Clear() function.
    if (this.m_project_name !== aFullPathAndName) {
      this.Clear(); // clear the data when the project changes.

      this.m_project_name = aFullPathAndName;

      const { dir, name, ext } = splitPath(this.m_project_name);

      if (ext !== '' && ext !== PROJECT_FILE_EXTENSION)
        this.m_project_name = `${dir === '' ? '' : `${dir}/`}${name}.${PROJECT_FILE_EXTENSION}`;
    }
  }

  /** Set the backing store file for this project. */
  setProjectFile(aFile: PROJECT_FILE | null): void {
    this.m_projectFile = aFile;

    if (this.m_projectFile) this.m_projectFile.SetProject(this);
  }

  /** Set the local settings backing store. */
  setLocalSettings(aSettings: PROJECT_LOCAL_SETTINGS | null): void {
    this.m_localSettings = aSettings;
  }

  /**
   * Return the full path and file name of a library table. Upstream falls back
   * to a temp-folder `prj-<table>` when the project has no writable path;
   * every browser project has one.
   */
  protected libTableName(aLibTableName: string): string {
    const dir = this.GetProjectDirectory();

    return dir === '' ? aLibTableName : `${dir}/${aLibTableName}`;
  }
}
