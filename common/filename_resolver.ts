// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FILENAME_RESOLVER` (include/filename_resolver.h, common/filename_resolver.cpp):
 * turns a footprint's `(model "…")` path - `${KICAD10_3DMODEL_DIR}/…`,
 * `${KIPRJMOD}/…`, a bare relative name, `:alias:…`, `kicad-embed://…` - into
 * the full path of a file that exists, and back (`ShortenPath`).
 *
 * It runs exactly as upstream over `wxFileExists` / `wxDirExists`, which the
 * page answers from its mount table (`wx/filefn.ts`): the open project at its
 * directory, the hosted 3D library at `${KICAD10_3DMODEL_DIR}`, embedded files
 * in the temp directory.
 */
import { ExpandEnvVarSubstitutions, type TextVarResolverFn } from './common.js';
import { DisplayErrorMessage } from './confirm.js';
import { KiCadUriPrefix, type EMBEDDED_FILES } from './embedded_files.js';
import { ENV_VAR } from './env_vars.js';
import type { PGM_BASE } from './pgm_base.js';
import type { PROJECT } from './project.js';
import { wxDirExists, wxFileExists, wxNormalizePath } from './wx/filefn.js';

// flag bits used to track different one-off messages to users
const ERRFLG_ALIAS = 1;
const ERRFLG_RELPATH = 2;
const ERRFLG_ENVPATH = 4;

export interface SEARCH_PATH {
  /** Alias to the base path. */
  m_Alias: string;
  /** Base path as stored in the configuration file. */
  m_Pathvar: string;
  /** Expanded base path. */
  m_Pathexp: string;
  /** Description of the aliased path. */
  m_Description: string;
}

const searchPath = (aAlias = '', aPathvar = '', aPathexp = ''): SEARCH_PATH => ({
  m_Alias: aAlias,
  m_Pathvar: aPathvar,
  m_Pathexp: aPathexp,
  m_Description: '',
});

/** `wxString::Matches`: `*` any run, `?` one character. */
const wxMatches = (aText: string, aPattern: string): boolean =>
  new RegExp(
    `^${aPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  ).test(aText);

/** `wxFileName::DirName( p ).GetPathWithSep()`. */
const withSep = (aDir: string): string => (aDir.endsWith('/') ? aDir : `${aDir}/`);

/** `wxFileName::GetForbiddenChars()` on Unix: none but the NUL. */
const FORBIDDEN_CHARS = '\0';

export class FILENAME_RESOLVER {
  /** 3D configuration directory. */
  private m_configDir = '';
  /** List of base paths to search from. */
  private m_paths: SEARCH_PATH[] = [];
  private m_errflags = 0;
  private m_pgm: PGM_BASE | null = null;
  private m_project: PROJECT | null = null;
  private m_curProjDir = '';

  /** The project's text-variable resolver, as `ExpandEnvVarSubstitutions( s, m_project )` takes it. */
  private projectResolver(): TextVarResolverFn | null {
    const project = this.m_project;
    return project ? (aToken) => project.TextVarResolver(aToken) : null;
  }

  private expand(aString: string): string {
    return ExpandEnvVarSubstitutions(aString, this.projectResolver());
  }

  /**
   * Set the user's configuration directory for 3D models.
   *
   * @return true if the call succeeds (directory exists).
   */
  Set3DConfigDir(aConfigDir: string): boolean {
    if (aConfigDir === '') return false;

    const cfgdir = wxNormalizePath(withSep(this.expand(aConfigDir)));

    if (!wxDirExists(cfgdir)) return false;

    this.m_configDir = cfgdir.replace(/\/$/, '');
    this.createPathList();

    return true;
  }

  /**
   * Set the current KiCad project directory as the first entry in the model
   * path list. `aFlgChanged` receives whether the project directory changed.
   */
  SetProject(aProject: PROJECT | null, aFlgChanged?: { value: boolean }): boolean {
    this.m_project = aProject;

    if (!aProject) return false;

    const projdir = wxNormalizePath(withSep(this.expand(aProject.GetProjectPath())));

    if (!wxDirExists(projdir)) return false;

    this.m_curProjDir = projdir.replace(/\/$/, '') || '/';

    if (aFlgChanged) aFlgChanged.value = false;

    if (this.m_paths.length === 0) {
      this.m_paths.push(searchPath('${KIPRJMOD}', '${KIPRJMOD}', this.m_curProjDir));

      if (aFlgChanged) aFlgChanged.value = true;
    } else if (this.m_paths[0]!.m_Pathexp !== this.m_curProjDir) {
      this.m_paths[0]!.m_Pathexp = this.m_curProjDir;

      if (aFlgChanged) aFlgChanged.value = true;
    } else {
      return true;
    }

    return true;
  }

  GetProjectDir(): string {
    return this.m_curProjDir;
  }

  /**
   * Set a pointer to the application's PGM_BASE instance used to extract the
   * local env vars.
   */
  SetProgramBase(aBase: PGM_BASE | null): void {
    this.m_pgm = aBase;

    if (!this.m_pgm || this.m_paths.length === 0) return;

    // recreate the path list
    this.m_paths = [];
    this.createPathList();
  }

  /** Build the path list using available information such as KICAD7_3DMODEL_DIR and the 3d_path_list configuration file. */
  private createPathList(): boolean {
    if (this.m_paths.length > 0) return true;

    // add an entry for the default search path; at this point
    // we cannot set a sensible default so we use an empty string.
    // the user may change this later with a call to SetProjectDir()
    this.m_paths.push(searchPath('${KIPRJMOD}', '${KIPRJMOD}', this.m_curProjDir));

    const epaths: string[] = [];

    if (this.GetKicadPaths(epaths)) {
      for (const currPath of epaths) {
        const currPathVarFormat = `\${${currPath}}`;
        const pathVal = this.expand(currPathVarFormat);
        let pathexp = pathVal === '' ? '' : wxNormalizePath(withSep(pathVal));

        if (pathexp !== '' && pathexp.endsWith('/')) pathexp = pathexp.slice(0, -1);

        // we add it first with the alias set to the non-variable format
        this.m_paths.push(searchPath(currPath, currPath, pathexp));

        // now add it with the "new variable format ${VAR}"
        this.m_paths.push(searchPath(currPathVarFormat, currPath, pathexp));
      }
    }

    return this.m_paths.length > 0;
  }

  /** Clear the current path list and substitutes the given path list and update the path configuration file on success. */
  UpdatePathList(aPathList: readonly SEARCH_PATH[]): boolean {
    const envMarker = '$';

    while (
      this.m_paths.length > 0 &&
      !this.m_paths[this.m_paths.length - 1]!.m_Alias.endsWith(envMarker)
    )
      this.m_paths.pop();

    for (const path of aPathList) this.addPath(path);

    return true;
  }

  /**
   * Determine the full path of the given file name.
   *
   * In the future remote files may be supported, in which case it is best to
   * require a full URI in which case ResolvePath should check that the URI
   * conforms to RFC-2396 and related documents and copies \a aFileName into
   * aResolvedName if the URI is valid.
   *
   * @param aFileName The configured file path to resolve
   * @param aWorkingPath The current working path for relative path resolutions
   * @param aEmbeddedFilesStack a list of pointers to the embedded files list. They will
   *                            be searched from the front of the list.
   */
  ResolvePath(
    aFileName: string,
    aWorkingPath: string,
    aEmbeddedFilesStack: readonly EMBEDDED_FILES[],
  ): string {
    if (aFileName === '') return '';

    if (this.m_paths.length === 0) this.createPathList();

    // first attempt to use the name as specified:
    // Swap separators for non-Windows, in case a Windows path is being passed
    let tname = aFileName.replace(/\\/g, '/');

    // Note: variable expansion must preferably be performed via a threadsafe wrapper for the
    // getenv() system call.
    tname = this.expand(tname);

    // Check to see if the file is a URI for an embedded file.
    if (tname.startsWith(`${KiCadUriPrefix}://`)) {
      if (aEmbeddedFilesStack.length === 0) return '';

      const path = tname.slice(`${KiCadUriPrefix}://`.length);

      let temp_file = aEmbeddedFilesStack[0]!.GetTemporaryFileName(path);
      let ii = 1;

      while (temp_file === '' && ii < aEmbeddedFilesStack.length)
        temp_file = aEmbeddedFilesStack[ii++]!.GetTemporaryFileName(path);

      return temp_file;
    }

    // this case covers full paths, leading expanded vars, and paths relative to the current
    // working directory (which is not necessarily the current project directory)
    if (wxFileExists(tname)) {
      tname = wxNormalizePath(tname);

      // special case: if a path begins with ${ENV_VAR} but is not in the resolver's path list
      // then add it.
      if (aFileName.startsWith('${') || aFileName.startsWith('$(')) this.checkEnvVarPath(aFileName);

      return tname;
    }

    // if a path begins with ${ENV_VAR}/$(ENV_VAR) and is not resolved then either the ENV_VAR is
    // not defined, or this is a user-defined alias that was incorrectly stored in ${} format by
    // older versions of KiCad. Try to match against user-defined aliases before giving up.
    if (aFileName.startsWith('${') || aFileName.startsWith('$(')) {
      // If expansion left the string unchanged, the variable was not found in the environment.
      // Try matching the variable name against user-defined (non-env-var) aliases in m_paths.
      if (tname === aFileName) {
        const useBrace = aFileName.startsWith('${');
        const aliasEnd = aFileName.indexOf(useBrace ? '}' : ')');

        // Require a non-empty variable name (aliasEnd > 2) so ${} / $() fall through.
        if (aliasEnd !== -1 && aliasEnd > 2) {
          const alias = aFileName.substring(2, aliasEnd);

          // Skip the separator if present
          let relStart = aliasEnd + 1;

          if (
            relStart < aFileName.length &&
            (aFileName[relStart] === '/' || aFileName[relStart] === '\\')
          )
            relStart++;

          const relpath = relStart < aFileName.length ? aFileName.slice(relStart) : '';

          for (const path of this.m_paths) {
            if (path.m_Alias.startsWith('${') || path.m_Alias.startsWith('$(')) continue;

            if (path.m_Alias === alias && path.m_Pathexp !== '') {
              const fullPath = this.expand(withSep(path.m_Pathexp) + relpath);

              if (wxFileExists(fullPath)) return wxNormalizePath(fullPath);
            }
          }
        }
      }

      // "[3D File Resolver] No such path; ensure the environment var is defined" -
      // a trace upstream (wxLogTrace), once per resolver.
      if (!(this.m_errflags & ERRFLG_ENVPATH)) this.m_errflags |= ERRFLG_ENVPATH;

      return '';
    }

    // at this point aFileName is:
    // a. an aliased shortened name or
    // b. cannot be determined

    // check the path relative to the current project directory;
    // NB: this is not necessarily the same as the current working directory, which has already
    // been checked. This case accounts for partial paths which do not contain ${KIPRJMOD}.
    // This check is performed before checking the path relative to ${KICAD7_3DMODEL_DIR} so that
    // users can potentially override a model within ${KICAD7_3DMODEL_DIR}.
    if (this.m_paths[0]!.m_Pathexp !== '' && !tname.startsWith(':')) {
      const fullPath = this.expand(withSep(this.m_paths[0]!.m_Pathexp) + tname);

      if (wxFileExists(fullPath)) return wxNormalizePath(fullPath);
    }

    // check path relative to search path
    if (aWorkingPath !== '' && !tname.startsWith(':')) {
      const tmp = wxNormalizePath(`${aWorkingPath}/${tname}`);

      if (wxFileExists(tmp)) return tmp;
    }

    // check the partial path relative to ${KICAD7_3DMODEL_DIR} (legacy behavior)
    if (!tname.startsWith(':')) {
      const fullPath = this.expand(`\${${ENV_VAR.GetVersionedEnvVarName('3DMODEL_DIR')}}/${tname}`);
      const fpath = wxNormalizePath(fullPath);

      if (fpath !== '' && wxFileExists(fpath)) return fpath;
    }

    // at this point the filename must contain an alias or else it is invalid
    const split = this.SplitAlias(tname);

    if (!split) {
      // this can happen if the file was intended to be relative to ${KICAD7_3DMODEL_DIR}
      // but ${KICAD7_3DMODEL_DIR} is not set or is incorrect.
      if (!(this.m_errflags & ERRFLG_RELPATH)) this.m_errflags |= ERRFLG_RELPATH;

      return '';
    }

    for (const path of this.m_paths) {
      // ${ENV_VAR} paths have already been checked; skip them
      if (path.m_Alias.startsWith('${') || path.m_Alias.startsWith('$(')) continue;

      if (path.m_Alias === split.alias && path.m_Pathexp !== '') {
        const fullPath = this.expand(withSep(path.m_Pathexp) + split.relpath);

        if (wxFileExists(fullPath)) return wxNormalizePath(fullPath);
      }
    }

    // "[3D File Resolver] No such path; ensure the path alias is defined" - a trace.
    if (!(this.m_errflags & ERRFLG_ALIAS)) this.m_errflags |= ERRFLG_ALIAS;

    return '';
  }

  /** Check that a path is valid and adds it to the search list. */
  private addPath(aPath: SEARCH_PATH): boolean {
    if (aPath.m_Alias === '' || aPath.m_Pathvar === '') return false;

    const tpath: SEARCH_PATH = { ...aPath };

    while (tpath.m_Pathvar.endsWith('/') && tpath.m_Pathvar.length > 1)
      tpath.m_Pathvar = tpath.m_Pathvar.slice(0, -1);

    const path = wxNormalizePath(withSep(this.expand(tpath.m_Pathvar)));

    if (!wxDirExists(path)) {
      const versionedPath = `\${${ENV_VAR.GetVersionedEnvVarName('3DMODEL_DIR')}}`;

      if (
        aPath.m_Pathvar === versionedPath ||
        aPath.m_Pathvar === '${KIPRJMOD}' ||
        aPath.m_Pathvar === '$(KIPRJMOD)' ||
        aPath.m_Pathvar === '${KISYS3DMOD}' ||
        aPath.m_Pathvar === '$(KISYS3DMOD)'
      ) {
        // suppress the message if the missing pathvar is a system variable
      } else {
        DisplayErrorMessage(`The given path does not exist\n${tpath.m_Pathvar}`);
      }

      tpath.m_Pathexp = '';
    } else {
      tpath.m_Pathexp = path;

      while (tpath.m_Pathexp.endsWith('/') && tpath.m_Pathexp.length > 1)
        tpath.m_Pathexp = tpath.m_Pathexp.slice(0, -1);
    }

    for (const sPL of this.m_paths) {
      if (tpath.m_Alias === sPL.m_Alias) {
        const msg =
          `Alias: ${tpath.m_Alias}\n` +
          `This path: ${tpath.m_Pathvar}\n` +
          `Existing path: ${sPL.m_Pathvar}`;
        DisplayErrorMessage('Bad alias (duplicate name)', msg);
        return false;
      }
    }

    this.m_paths.push(tpath);
    return true;
  }

  /**
   * Check the ${ENV_VAR} component of a path and adds it to the resolver's
   * path list if it is not yet in the list.
   */
  private checkEnvVarPath(aPath: string): void {
    let useParen = false;

    if (aPath.startsWith('$(')) useParen = true;
    else if (!aPath.startsWith('${')) return;

    const pEnd = aPath.indexOf(useParen ? ')' : '}');

    if (pEnd === -1) return;

    const envar = aPath.slice(0, pEnd + 1);

    // check if the alias exists; if not then add it to the end of the
    // env var section of the path list
    let insertAt = 0;

    for (; insertAt < this.m_paths.length; insertAt++) {
      const sPL = this.m_paths[insertAt]!;

      if (sPL.m_Alias === envar) return;

      if (!sPL.m_Alias.startsWith('${')) break;
    }

    const tmp = wxNormalizePath(withSep(this.expand(envar)));

    if (!wxDirExists(tmp)) return;

    let pathexp = tmp;

    if (pathexp !== '' && pathexp.endsWith('/')) pathexp = pathexp.slice(0, -1);

    if (pathexp === '') return;

    this.m_paths.splice(insertAt, 0, searchPath(envar, envar, pathexp));
  }

  /**
   * Produce a relative path based on the existing search directories or
   * returns the same path if the path is not a superset of an existing search
   * path.
   */
  ShortenPath(aFullPathName: string): string {
    let fname = aFullPathName;

    if (this.m_paths.length === 0) this.createPathList();

    for (const sL of this.m_paths) {
      // undefined paths do not participate in the
      // file name shortening procedure
      if (sL.m_Pathexp === '') continue;

      let fps: string;

      // in the case of aliases, ensure that we use the most recent definition
      if (sL.m_Alias.startsWith('${') || sL.m_Alias.startsWith('$(')) {
        const tpath = this.expand(sL.m_Alias);

        if (tpath === '') continue;

        fps = withSep(tpath);
      } else {
        fps = withSep(sL.m_Pathexp);
      }

      if (fname.indexOf(fps) === 0) {
        fname = fname.slice(fps.length);

        if (sL.m_Alias.startsWith('${') || sL.m_Alias.startsWith('$(')) {
          // old style ENV_VAR
          return `${sL.m_Alias}/${fname}`;
        }

        // user-defined alias: use ${alias}/path format
        return `\${${sL.m_Alias}}/${fname}`;
      }
    }

    return fname;
  }

  /** Return a pointer to the internal path list; the items in:load. */
  GetPaths(): readonly SEARCH_PATH[] {
    return this.m_paths;
  }

  /**
   * Return true if the given name contains an alias and populates the string
   * anAlias with the alias and aRelPath with the relative path.
   */
  SplitAlias(aFileName: string): { alias: string; relpath: string } | null {
    let searchStart = 0;

    if (aFileName.startsWith(':')) searchStart = 1;

    const tagpos = aFileName.indexOf(':', searchStart);

    if (tagpos === -1 || tagpos === searchStart) return null;

    if (tagpos + 1 >= aFileName.length) return null;

    return {
      alias: aFileName.substring(searchStart, tagpos),
      relpath: aFileName.slice(tagpos + 1),
    };
  }

  /**
   * Return true if the given path is a valid aliased relative path. If the
   * path contains an alias then hasAlias is set true.
   */
  ValidateFileName(aFileName: string, aHasAlias: { value: boolean }): boolean {
    // Rules:
    // 1. The generic form of an aliased 3D relative path is:
    //    ALIAS:relative/path
    // 2. ALIAS is a UTF string excluding wxT( "{}[]()%~<>\"='`;:.,&?/\\|$" )
    // 3. The relative path must be a valid relative path for the platform
    // 4. We allow a URI for embedded files, but only if it has a name

    aHasAlias.value = false;

    if (aFileName === '') return false;

    if (aFileName.startsWith('file://') || aFileName.startsWith(`${KiCadUriPrefix}://`)) {
      const prefixLength = aFileName.startsWith('file://') ? 7 : 14;

      return aFileName.length > prefixLength && aFileName[prefixLength] !== '/';
    }

    const filename = aFileName.replace(/\\/g, '/');
    let lpath: string;
    const aliasStart = aFileName.startsWith(':') ? 1 : 0;
    let aliasEnd = aFileName.indexOf(':', aliasStart);

    // names may not end with ':'
    if (aliasEnd === aFileName.length - 1) return false;

    if (aliasEnd !== -1) {
      // ensure the alias component is not empty
      if (aliasEnd === aliasStart) return false;

      // (wxString::substr( pos, count ): upstream passes aliasEnd as the COUNT.)
      lpath = filename.substr(aliasStart, aliasEnd);

      // check the alias for restricted characters
      for (const c of '{}[]()%~<>"=\'`;:.,&?/\\|$') {
        if (lpath.includes(c)) return false;
      }

      aHasAlias.value = true;
      lpath = aFileName.slice(aliasEnd + 1);
    } else {
      lpath = aFileName;

      // in the case of ${ENV_VAR}|$(ENV_VAR)/path, strip the
      // environment string before testing
      aliasEnd = -1;

      if (aFileName.startsWith('${')) aliasEnd = aFileName.indexOf('}');
      else if (aFileName.startsWith('$(')) aliasEnd = aFileName.indexOf(')');

      if (aliasEnd !== -1) lpath = aFileName.slice(aliasEnd + 1);
    }

    // Test for forbidden chars in filenames. Should be wxFileName::GetForbiddenChars()
    for (const c of FORBIDDEN_CHARS) {
      if (lpath.includes(c)) return false;
    }

    return true;
  }

  /**
   * Return a list of path environment variables local to KiCad.
   *
   * This list always includes KICAD7_3DMODEL_DIR even if it is not defined
   * locally.
   */
  GetKicadPaths(aPaths: string[]): boolean {
    aPaths.length = 0;

    if (!this.m_pgm) return false;

    let hasKisys3D = false;

    // iterate over the list of internally defined ENV VARs
    // and add them to the paths list
    for (const [key, item] of this.m_pgm.GetLocalEnvVariables()) {
      // filter out URLs, template directories, and known system paths
      if (key === 'KICAD_PTEMPLATES' || wxMatches(key, 'KICAD*_FOOTPRINT_DIR')) continue;

      if (item.GetValue().includes('://')) continue;

      //also add the path without the ${} to act as legacy alias support for older files
      aPaths.push(key);

      if (wxMatches(key, 'KICAD*_3DMODEL_DIR')) hasKisys3D = true;
    }

    if (!hasKisys3D) aPaths.push(ENV_VAR.GetVersionedEnvVarName('3DMODEL_DIR'));

    return true;
  }
}
