// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/env_paths.cpp`: a path written relative to the environment variable or project that
 * holds it (`${KICAD10_SYMBOL_DIR}/…`, `${KIPRJMOD}/…`), and resolved back.
 *
 * Paths here are POSIX (the mounted file system), so there are no volumes.
 */
import type { PROJECT } from './project.js';
import { PROJECT_VAR_NAME } from './project.js';
import type { ENV_VAR_MAP } from './settings/environment.js';
import { wxDirExists, wxFileExists } from './wx/filefn.js';

/** `wxFileName::GetDirs()` of a directory path. */
const dirsOf = (aPath: string): string[] => aPath.split('/').filter((d) => d !== '');

/** `wxFileName::GetPath()` and `GetFullName()` of a file path. */
function splitFile(aPath: string): { path: string; name: string } {
  const slash = aPath.lastIndexOf('/');

  return { path: slash < 0 ? '' : aPath.slice(0, slash), name: aPath.slice(slash + 1) };
}

/**
 * `normalizeAbsolutePaths( aPathA, aPathB, aResultPath )`: whether directory A contains file B's
 * directory, and B's directories below A (each followed by "/").
 */
function normalizeAbsolutePaths(
  aPathA: string,
  aPathB: string,
  aResultPath: { value: string } | null,
): boolean {
  // wxCHECK_MSG: both must be absolute.
  if (!aPathA.startsWith('/') || !aPathB.startsWith('/')) return false;

  const bDir = splitFile(aPathB).path;

  if (dirsOf(aPathA).join('/') === dirsOf(bDir).join('/')) return true;

  const aDirs = dirsOf(aPathA);
  const bDirs = dirsOf(bDir);

  if (aDirs.length > bDirs.length) return false;

  let i = 0;

  while (i < aDirs.length) {
    if (aDirs[i] !== bDirs[i]) return false;

    i++;
  }

  if (aResultPath) {
    while (i < bDirs.length) {
      aResultPath.value += `${bDirs[i]}/`;
      i++;
    }
  }

  return true;
}

/**
 * `NormalizePath( aFilePath, aEnvVars, aProject | aProjectPath )`: the file's path with the
 * deepest environment variable directory that holds it replaced by `${VAR}`, else the project
 * directory by `${KIPRJMOD}`, else the path unchanged.
 */
export function NormalizePath(
  aFilePath: string,
  aEnvVars: ENV_VAR_MAP | null,
  aProject: PROJECT | string | null,
): string {
  const aProjectPath = typeof aProject === 'string' ? aProject : (aProject?.GetProjectPath() ?? '');
  let varName = '';
  let remainingPath = '';
  let pathDepth = 0;

  if (aEnvVars) {
    for (const [key, item] of aEnvVars) {
      // Don't bother normalizing paths that don't exist or the user cannot read.
      if (!wxDirExists(item.GetValue())) continue;

      const tmp = { value: '' };

      if (normalizeAbsolutePaths(item.GetValue(), aFilePath, tmp)) {
        const newDepth = dirsOf(item.GetValue()).length;

        // Only use the variable if it removes more directories than the previous ones
        if (newDepth > pathDepth) {
          pathDepth = newDepth;
          varName = key;
          remainingPath = tmp.value;
        }
      }
    }
  }

  if (
    varName === '' &&
    aProjectPath !== '' &&
    aProjectPath.startsWith('/') &&
    aFilePath.startsWith('/')
  ) {
    const rest = { value: '' };

    if (normalizeAbsolutePaths(aProjectPath, aFilePath, rest)) {
      varName = PROJECT_VAR_NAME;
      remainingPath = rest.value;
    }
  }

  if (varName === '') return aFilePath;

  return `\${${varName}}/${remainingPath}${splitFile(aFilePath).name}`;
}

/**
 * Create file path by appending path and file name. This approach allows the filename to contain
 * a relative path, whereas wxFileName::SetPath() would replace the relative path.
 */
function createFilePath(aPath: string, aFileName: string): string {
  return aPath.endsWith('/') ? aPath + aFileName : `${aPath}/${aFileName}`;
}

/** `ResolveFile( aFileName, aEnvVars, aProject )`: the first existing place a relative name names. */
export function ResolveFile(
  aFileName: string,
  aEnvVars: ENV_VAR_MAP | null,
  aProject: PROJECT | null,
): string {
  if (aFileName.startsWith('/')) return aFileName;

  const exists = (aPath: string) => wxFileExists(aPath) || wxDirExists(aPath);

  if (aProject) {
    const fn = createFilePath(aProject.GetProjectPath(), aFileName);

    if (exists(fn)) return fn;
  }

  if (aEnvVars) {
    for (const item of aEnvVars.values()) {
      const fn = createFilePath(item.GetValue(), aFileName);

      if (exists(fn)) return fn;
    }
  }

  return '';
}

/**
 * `PathIsInsideProject( aFileName, aProject, aSubPath )`: whether the file's directory is inside
 * the project directory, and the directories between.
 */
export function PathIsInsideProject(
  aFileName: string,
  aProject: PROJECT,
  aSubPath: { value: string[] } | null = null,
): boolean {
  const pdirs = dirsOf(aProject.GetProjectPath());
  const fdirs = dirsOf(splitFile(aFileName).path);

  if (fdirs.length < pdirs.length) return false;

  for (let i = 0; i < pdirs.length; i++) {
    if (fdirs[i] !== pdirs[i]) return false;
  }

  // Now we know that fn is inside prj
  if (aSubPath) aSubPath.value = fdirs.slice(pdirs.length);

  return true;
}
