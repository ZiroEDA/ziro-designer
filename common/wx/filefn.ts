// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The part of `<wx/filefn.h>` and `wxFileName` KiCad's path code asks:
 * `wxFileExists`, `wxDirExists`, the working directory, and `Normalize`.
 *
 * A page has no file system, so this is a mount table standing in for one:
 * the app mounts what exists - the open project's files at its directory,
 * the hosted libraries at the Linux install paths - and `/tmp` is a RAM disk,
 * as every desktop has a temp directory. KiCad's code above this layer
 * (`FILENAME_RESOLVER`, `EMBEDDED_FILES::GetTemporaryFileName`) runs
 * unchanged against it.
 */

/** One mounted tree: answers for paths RELATIVE to its mount point. */
export interface wxFileSystemMount {
  FileExists(aRelPath: string): boolean;
  DirExists(aRelPath: string): boolean;
}

interface MountEntry {
  prefix: string;
  mount: wxFileSystemMount;
}

/** Newest first, so a later mount of the same prefix shadows an earlier one. */
const s_mounts: MountEntry[] = [];

/** Strip trailing separators, keeping a lone "/". */
const trimDir = (aPath: string): string => aPath.replace(/\/+$/, '') || '/';

/**
 * Mount `aMount` at the absolute directory `aPrefix`. Returns the unmount,
 * which removes exactly this mount wherever it sits.
 */
export function wxMountFileSystem(aPrefix: string, aMount: wxFileSystemMount): () => void {
  const entry: MountEntry = { prefix: trimDir(aPrefix), mount: aMount };
  s_mounts.unshift(entry);

  return () => {
    const i = s_mounts.indexOf(entry);
    if (i >= 0) s_mounts.splice(i, 1);
  };
}

/**
 * The mount holding `aPath` (absolute, normalised) and the path inside it:
 * the LONGEST mount point that is a directory prefix of the path wins.
 */
export function wxFindMount(
  aPath: string,
): { prefix: string; mount: wxFileSystemMount; rel: string } | null {
  let best: MountEntry | null = null;

  for (const m of s_mounts) {
    const inside = m.prefix === '/' || aPath === m.prefix || aPath.startsWith(`${m.prefix}/`);
    if (inside && (!best || m.prefix.length > best.prefix.length)) best = m;
  }

  if (!best) return null;

  const rel = best.prefix === '/' ? aPath.slice(1) : aPath.slice(best.prefix.length + 1);

  return { prefix: best.prefix, mount: best.mount, rel };
}

let s_cwd = '/';

/** `wxGetCwd()`. */
export function wxGetCwd(): string {
  return s_cwd;
}

/** `wxSetWorkingDirectory()`. */
export function wxSetWorkingDirectory(aDir: string): boolean {
  if (!aDir.startsWith('/')) return false;
  s_cwd = trimDir(wxNormalizePath(aDir));
  return true;
}

/**
 * `wxFileName::Normalize( FN_NORMALIZE_FLAGS )` on a path: made absolute
 * against the working directory, `.` and `..` folded, repeated separators
 * collapsed, backslashes read as separators. A trailing separator is kept -
 * it is what makes a name a directory.
 */
export function wxNormalizePath(aPath: string): string {
  if (aPath === '') return '';

  let p = aPath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `${s_cwd === '/' ? '' : s_cwd}/${p}`;

  const isDir = p.endsWith('/');
  const out: string[] = [];

  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }

  const joined = `/${out.join('/')}`;

  return isDir && joined !== '/' ? `${joined}/` : joined;
}

/** `wxFileExists` / `wxFileName::FileExists`. */
export function wxFileExists(aPath: string): boolean {
  if (aPath === '') return false;

  const p = wxNormalizePath(aPath);
  if (p.endsWith('/')) return false;

  const hit = wxFindMount(p);

  return !!hit && hit.rel !== '' && hit.mount.FileExists(hit.rel);
}

/** `wxDirExists` / `wxFileName::DirExists`. */
export function wxDirExists(aPath: string): boolean {
  if (aPath === '') return false;

  const p = trimDir(wxNormalizePath(aPath));
  const hit = wxFindMount(p);

  if (!hit) return false;

  // A mount point is a directory.
  return hit.rel === '' || hit.mount.DirExists(hit.rel);
}

/** A writable tree held in memory: the temp directory, and anything else the app needs. */
export class MEMORY_FILESYSTEM implements wxFileSystemMount {
  private readonly m_files = new Map<string, Uint8Array>();

  FileExists(aRelPath: string): boolean {
    return this.m_files.has(aRelPath);
  }

  DirExists(aRelPath: string): boolean {
    const dir = `${aRelPath.replace(/\/+$/, '')}/`;

    for (const k of this.m_files.keys()) if (k.startsWith(dir)) return true;

    return false;
  }

  Write(aRelPath: string, aData: Uint8Array): void {
    this.m_files.set(aRelPath, aData);
  }

  Read(aRelPath: string): Uint8Array | null {
    return this.m_files.get(aRelPath) ?? null;
  }

  Remove(aRelPath: string): boolean {
    return this.m_files.delete(aRelPath);
  }

  /** `wxRemoveDir` and everything under it (`wxFileName::Rmdir( wxPATH_RMDIR_RECURSIVE )`). */
  RemoveTree(aRelPath: string): boolean {
    const dir = `${aRelPath.replace(/\/+$/, '')}/`;
    let removed = false;

    for (const k of [...this.m_files.keys()]) {
      if (k.startsWith(dir)) {
        this.m_files.delete(k);
        removed = true;
      }
    }

    return removed;
  }

  /**
   * `wxRenameFile` inside one mount: a file, or a directory with everything
   * under it. False when there is nothing at `aFrom`, or `aTo` is taken and
   * `aOverwrite` is not set.
   */
  Rename(aFrom: string, aTo: string, aOverwrite: boolean): boolean {
    const fromDir = `${aFrom.replace(/\/+$/, '')}/`;
    const toDir = `${aTo.replace(/\/+$/, '')}/`;
    const moves: [string, string][] = [];

    if (this.m_files.has(aFrom)) moves.push([aFrom, aTo]);

    for (const k of this.m_files.keys()) {
      if (k.startsWith(fromDir)) moves.push([k, toDir + k.slice(fromDir.length)]);
    }

    if (moves.length === 0) return false;

    if (!aOverwrite && moves.some(([, to]) => this.m_files.has(to))) return false;

    for (const [from, to] of moves) {
      const data = this.m_files.get(from)!;
      this.m_files.delete(from);
      this.m_files.set(to, data);
    }

    return true;
  }
}

/** `wxFileName::GetTempDir()`. */
export function wxGetTempDir(): string {
  return '/tmp';
}

/** The temp directory's RAM disk, mounted for the life of the page. */
export const s_tempFileSystem = new MEMORY_FILESYSTEM();
wxMountFileSystem(wxGetTempDir(), s_tempFileSystem);

/** Read a file from whichever mount holds it, when that mount keeps bytes in memory. */
export function wxReadFileSync(aPath: string): Uint8Array | null {
  const hit = wxFindMount(wxNormalizePath(aPath));

  if (!hit || !(hit.mount instanceof MEMORY_FILESYSTEM)) return null;

  return hit.mount.Read(hit.rel);
}

/**
 * Write a file into whichever in-memory mount holds its directory.
 * @return false when no writable mount covers the path.
 */
export function wxWriteFileSync(aPath: string, aData: Uint8Array): boolean {
  const hit = wxFindMount(wxNormalizePath(aPath));

  if (!hit || !(hit.mount instanceof MEMORY_FILESYSTEM)) return false;

  hit.mount.Write(hit.rel, aData);
  return true;
}

/** `wxRemoveFile( path )`: drop a file from its in-memory mount. */
export function wxRemoveFile(aPath: string): boolean {
  const hit = wxFindMount(wxNormalizePath(aPath));

  if (!hit || !(hit.mount instanceof MEMORY_FILESYSTEM)) return false;

  return hit.mount.Remove(hit.rel);
}

/** `wxRemoveDir` recursively: a `.pretty` and its footprints. False when there was nothing to remove. */
export function wxRemoveDirTree(aPath: string): boolean {
  const hit = wxFindMount(trimDir(wxNormalizePath(aPath)));

  if (!hit || !(hit.mount instanceof MEMORY_FILESYSTEM) || hit.rel === '') return false;

  return hit.mount.RemoveTree(hit.rel);
}

/**
 * `wxRenameFile( aOld, aNew, aOverwrite )`: a file or a directory, inside one
 * in-memory mount. False when the two paths are on different mounts.
 */
export function wxRenameFile(aOld: string, aNew: string, aOverwrite = true): boolean {
  const from = wxFindMount(trimDir(wxNormalizePath(aOld)));
  const to = wxFindMount(trimDir(wxNormalizePath(aNew)));

  if (!from || !to || from.mount !== to.mount || !(from.mount instanceof MEMORY_FILESYSTEM))
    return false;

  if (from.rel === '' || to.rel === '') return false;

  return from.mount.Rename(from.rel, to.rel, aOverwrite);
}
