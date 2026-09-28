// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PATHS` (include/paths.h, common/paths.cpp): where KiCad's installed
 * libraries and the user's KiCad folders live - the defaults
 * `COMMON_SETTINGS::InitializeEnvironment` gives `${KICAD10_3DMODEL_DIR}` and
 * the rest.
 *
 * The Linux build's branch of every getter. Its install locations are the
 * data this app mirrors: our hosted libraries are mounted at the same paths,
 * so a board that names `/usr/share/kicad/3dmodels/...` resolves as it does
 * on the machine that made it. The user's folders sit under a home the page
 * does not have (see `kiplatform/env.ts`), so nothing reads or writes there.
 * The macOS and Windows helpers are the other builds' and are not here.
 */
import { GetMajorMinorVersion } from './build_version.js';
import * as KIPLATFORM_ENV from './kiplatform/env.js';
import { MEMORY_FILESYSTEM, wxDirExists, wxFindMount, wxNormalizePath } from './wx/filefn.js';
import { wxGetEnv } from './wx/utils.js';
import { wxGetTempDir } from './wx/filefn.js';

/** `KICAD_PATH_STR`: lower case on Linux. */
const KICAD_PATH_STR = 'kicad';

/**
 * [data] `KICAD_LIBRARY_DATA`, the CMake install location of the Linux build
 * this app mirrors (`${CMAKE_INSTALL_PREFIX}/${CMAKE_INSTALL_DATADIR}/kicad`).
 */
const KICAD_LIBRARY_DATA = '/usr/share/kicad';

/** [data] `KICAD_DATA`, the same install's data directory. */
const KICAD_DATA = '/usr/share/kicad';

/** [data] `KICAD_DOCS`, where the installed build keeps its documentation. */
const KICAD_DOCS = '/usr/share/doc/kicad';

/** [data] `KICAD_PLUGINDIR`, `CMAKE_INSTALL_FULL_LIBDIR` of the installed build. */
const KICAD_PLUGINDIR = '/usr/lib/x86_64-linux-gnu';

/** [data] `KICAD_CONFIG_DIR`. */
const KICAD_CONFIG_DIR = 'kicad';

/** [data] `wxStandardPaths::GetExecutablePath()`'s directory for the installed build. */
const EXECUTABLE_DIR = '/usr/bin/';

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

  /** `GetDefaultUserSymbolsPath`: no trailing separator (`GetPath()`). */
  export function GetDefaultUserSymbolsPath(): string {
    return appendDir(getUserDocumentPath(), 'symbols').replace(/\/$/, '');
  }

  export function GetDefaultUserFootprintsPath(): string {
    return appendDir(getUserDocumentPath(), 'footprints').replace(/\/$/, '');
  }

  export function GetDefaultUserDesignBlocksPath(): string {
    return appendDir(getUserDocumentPath(), 'blocks').replace(/\/$/, '');
  }

  export function GetDefaultUser3DModelsPath(): string {
    return appendDir(getUserDocumentPath(), '3dmodels').replace(/\/$/, '');
  }

  export function GetDefaultUserProjectsPath(): string {
    return appendDir(getUserDocumentPath(), 'projects').replace(/\/$/, '');
  }

  export function GetUserPluginsPath(): string {
    return appendDir(getUserDocumentPath(), 'plugins').replace(/\/$/, '');
  }

  export function GetUserScriptingPath(): string {
    return appendDir(getUserDocumentPath(), 'scripting').replace(/\/$/, '');
  }

  export function GetLogsPath(): string {
    return appendDir(getUserDocumentPath(), 'logs').replace(/\/$/, '');
  }

  /**
   * `GetStockDataPath( aRespectRunFromBuildDir )`: `KICAD_STOCK_DATA_HOME`,
   * else the install's data directory. (Run-from-build-dir is a developer's
   * build, not the installed one.)
   */
  export function GetStockDataPath(_aRespectRunFromBuildDir = true): string {
    const path = wxGetEnv('KICAD_STOCK_DATA_HOME');

    if (path !== undefined && path !== '') return path;

    return KICAD_DATA;
  }

  export function GetStockScriptingPath(): string {
    return appendDir(GetStockDataPath(), 'scripting');
  }

  export function GetLocaleDataPath(): string {
    return appendDir(GetStockDataPath(), 'internat');
  }

  export function GetStockPluginsPath(): string {
    return appendDir(GetStockDataPath(false), 'plugins');
  }

  /** `GetStockPlugins3DPath`: `APPDIR`'s for an AppImage, else the install's lib dir. */
  export function GetStockPlugins3DPath(): string {
    const appdir = wxGetEnv('APPDIR');
    const base =
      appdir !== undefined
        ? appendDir(
            appendDir(
              appendDir(appendDir(appendDir(appdir, 'usr'), 'lib'), 'x86_64-linux-gnu'),
              'kicad',
            ),
            'plugins',
          )
        : appendDir(appendDir(KICAD_PLUGINDIR, 'kicad'), 'plugins');

    return appendDir(base, '3d');
  }

  export function GetStockDemosPath(): string {
    return appendDir(GetStockDataPath(false), 'demos');
  }

  export function GetDocumentationPath(): string {
    return KICAD_DOCS;
  }

  export function GetInstanceCheckerPath(): string {
    return appendDir(appendDir(wxGetTempDir(), 'org.kicad.kicad'), 'instances');
  }

  /** `EnsureUserPathsExist`: each user folder, made where it can be. */
  export function EnsureUserPathsExist(): void {
    EnsurePathExists(GetUserCachePath());
    EnsurePathExists(GetUserPluginsPath());
    EnsurePathExists(GetUserScriptingPath());
    EnsurePathExists(GetUserTemplatesPath());
    EnsurePathExists(GetDefaultUserProjectsPath());
    EnsurePathExists(GetDefaultUserSymbolsPath());
    EnsurePathExists(GetDefaultUserFootprintsPath());
    EnsurePathExists(GetDefaultUser3DModelsPath());
    EnsurePathExists(GetDefault3rdPartyPath());
  }

  let s_userSettingsPath = '';

  /** `GetUserSettingsPath`: `CalculateUserSettingsPath()`, once. */
  export function GetUserSettingsPath(): string {
    if (s_userSettingsPath === '') s_userSettingsPath = CalculateUserSettingsPath();

    return s_userSettingsPath;
  }

  /** `CalculateUserSettingsPath( aIncludeVer, aUseEnv )`: `KICAD_CONFIG_HOME`, else `<config>/kicad`. */
  export function CalculateUserSettingsPath(aIncludeVer = true, aUseEnv = true): string {
    const envstr = aUseEnv ? wxGetEnv('KICAD_CONFIG_HOME') : undefined;
    let cfgpath =
      envstr !== undefined && envstr !== ''
        ? appendDir(envstr, '')
        : appendDir(KIPLATFORM_ENV.GetUserConfigPath(), KICAD_CONFIG_DIR);

    if (aIncludeVer) cfgpath = appendDir(cfgpath, GetMajorMinorVersion());

    return cfgpath.replace(/\/+$/, '').replace(/\/\/+/g, '/');
  }

  /** `GetExecutablePath`: `APPDIR/usr/bin/` for an AppImage, else the binary's directory. */
  export function GetExecutablePath(): string {
    const appdir = wxGetEnv('APPDIR');

    if (appdir !== undefined) {
      const env = appdir.replace(/\\/g, '/');
      return `${env.endsWith('/') ? env : `${env}/`}usr/bin/`;
    }

    return EXECUTABLE_DIR;
  }
}
