// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PATHS` (include/paths.h, common/paths.cpp): where KiCad's installed
 * libraries and the user's KiCad folders live - the defaults
 * `COMMON_SETTINGS::InitializeEnvironment` gives `${KICAD10_3DMODEL_DIR}` and
 * the rest.
 *
 * Only the getters those defaults use are here. The Linux build's install
 * location is the data this app mirrors: our hosted libraries are mounted at
 * the same paths, so a board that names `/usr/share/kicad/3dmodels/...`
 * resolves as it does on the machine that made it. The rest of paths.cpp
 * (settings, plugin, scripting and log folders) is n/a: a page has none of
 * those directories.
 */
import { GetMajorMinorVersion } from './build_version.js';
import * as KIPLATFORM_ENV from './kiplatform/env.js';
import { MEMORY_FILESYSTEM, wxDirExists, wxFindMount, wxNormalizePath } from './wx/filefn.js';
import { wxGetEnv } from './wx/utils.js';

/** `KICAD_PATH_STR`: lower case on Linux. */
const KICAD_PATH_STR = 'kicad';

/**
 * [data] `KICAD_LIBRARY_DATA`, the CMake install location of the Linux build
 * this app mirrors (`${CMAKE_INSTALL_PREFIX}/${CMAKE_INSTALL_DATADIR}/kicad`).
 */
const KICAD_LIBRARY_DATA = '/usr/share/kicad';

/** `wxFileName::AssignDir( a ); AppendDir( b ); GetPathWithSep()`. */
function appendDir(aDir: string, aSub: string): string {
  if (aDir === '') return `${aSub}/`;
  return `${aDir.replace(/\/+$/, '')}/${aSub}/`;
}

export namespace PATHS {
  /** `getUserDocumentPath`: `<documents>/kicad/<major.minor>/`. */
  function getUserDocumentPath(): string {
    const envPath = wxGetEnv('KICAD_DOCUMENTS_HOME');
    const base = envPath !== undefined ? envPath : KIPLATFORM_ENV.GetDocumentsPath();

    return appendDir(appendDir(base, KICAD_PATH_STR), GetMajorMinorVersion());
  }

  /** `GetUserTemplatesPath`: with the separator. */
  export function GetUserTemplatesPath(): string {
    return appendDir(getUserDocumentPath(), 'template');
  }

  /** `GetDefault3rdPartyPath`: `GetAbsolutePath()`, also with the separator. */
  export function GetDefault3rdPartyPath(): string {
    return appendDir(getUserDocumentPath(), '3rdparty');
  }

  /** `GetUserCachePath`: `<cache>/kicad/<major.minor>/`, or `KICAD_CACHE_HOME`'s. */
  export function GetUserCachePath(): string {
    let base = KIPLATFORM_ENV.GetUserCachePath();

    // Use KICAD_CACHE_HOME to allow the user to force a specific cache path.
    const envPath = wxGetEnv('KICAD_CACHE_HOME');
    if (envPath !== undefined && envPath !== '') base = envPath;

    return appendDir(appendDir(base, KICAD_PATH_STR), GetMajorMinorVersion());
  }

  /**
   * `EnsurePathExists`: the directory exists, or is made. Only a tree held in
   * memory can be written, so a directory elsewhere (the unmounted home
   * folders) exists only if it already does.
   */
  export function EnsurePathExists(aPath: string, aPathToFile = false): boolean {
    let dir = wxNormalizePath(aPathToFile ? aPath : `${aPath}/`);
    if (aPathToFile) dir = dir.slice(0, dir.lastIndexOf('/') + 1);

    if (wxDirExists(dir)) return true;

    // wxFileName::Mkdir( wxPATH_MKDIR_FULL ): a RAM disk makes directories implicitly.
    return wxFindMount(dir.replace(/\/+$/, ''))?.mount instanceof MEMORY_FILESYSTEM;
  }

  /** `GetStockEDALibraryPath`: `$APPDIR/share/kicad`, else `KICAD_LIBRARY_DATA`. */
  export function GetStockEDALibraryPath(): string {
    const appdir = wxGetEnv('APPDIR');

    return appdir !== undefined ? `${appdir}/share/kicad` : KICAD_LIBRARY_DATA;
  }

  export function GetStockSymbolsPath(): string {
    return appendDir(GetStockEDALibraryPath(), 'symbols');
  }

  export function GetStockFootprintsPath(): string {
    return appendDir(GetStockEDALibraryPath(), 'footprints');
  }

  export function GetStockDesignBlocksPath(): string {
    return appendDir(GetStockEDALibraryPath(), 'blocks');
  }

  export function GetStock3dmodelsPath(): string {
    return appendDir(GetStockEDALibraryPath(), '3dmodels');
  }

  export function GetStockTemplatesPath(): string {
    return appendDir(GetStockEDALibraryPath(), 'template');
  }
}
