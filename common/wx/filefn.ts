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

/**
 * A mount whose bytes can be read and written: the temp RAM disk, and the
 * open project's files where the app mounts them writable.
 */
export interface wxWritableFileSystemMount extends wxFileSystemMount {
  Read(aRelPath: string): Uint8Array | null;
  Write(aRelPath: string, aData: Uint8Array): void;
  Remove(aRelPath: string): boolean;
  RemoveTree(aRelPath: string): boolean;
  Rename(aFrom: string, aTo: string, aOverwrite: boolean): boolean;
  /** `wxDir::GetFirst`/`GetNext` over one directory: its entries, or null when it does not exist. */
  List(aRelDir: string): { name: string; isDir: boolean }[] | null;
  /** `wxFileName::Mkdir( wxPATH_MKDIR_FULL )`: an (empty) directory. */
  Mkdir(aRelDir: string): boolean;
  /** `wxFileModificationTime`: when the file was last written, or -1 when there is no file. */
  ModificationTime?(aRelPath: string): number;
}

/** Whether a mount keeps bytes: read, written and listed through the helpers below. */
export function IsWritableMount(aMount: wxFileSystemMount): aMount is wxWritableFileSystemMount {
  const m = aMount as Partial<wxWritableFileSystemMount>;
  return (
    typeof m.Read === 'function' && typeof m.Write === 'function' && typeof m.List === 'function'
  );
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

/**
 * `wxFileName::MakeRelativeTo( aBase )` on a file path (filename.cpp): both normalised against the
 * working directory, the leading directories they share dropped, a `..` for each of the base's
 * that is left. One volume here, so it always succeeds.
 */
export function wxMakeRelativeTo(aPath: string, aBase: string): string {
  const dirs = wxNormalizePath(aPath)
    .split('/')
    .filter((d) => d !== '');
  const name = aPath.endsWith('/') ? '' : (dirs.pop() ?? '');
  const baseDirs = wxNormalizePath(aBase)
    .split('/')
    .filter((d) => d !== '');

  // remove common directories starting at the top
  while (dirs.length > 0 && baseDirs.length > 0 && dirs[0] === baseDirs[0]) {
    dirs.shift();
    baseDirs.shift();
  }

  // add as many ".." as needed
  for (let i = 0; i < baseDirs.length; i++) dirs.unshift('..');

  // a directory made relative with respect to itself is '.' under Unix
  if (dirs.length === 0 && name === '') dirs.push('.');

  return [...dirs, name].filter((d, i, a) => d !== '' || i === a.length - 1).join('/');
}

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
/**
 * The clock a RAM disk stamps its writes with: one tick per write, so two writes in the same
 * second still read as a change - KiCad only ever compares a stamp for equality.
 */
let s_writeClock = 0;

export class MEMORY_FILESYSTEM implements wxWritableFileSystemMount {
  private readonly m_files = new Map<string, Uint8Array>();
  private readonly m_mtimes = new Map<string, number>();
  private m_writeListener: ((aRelPath: string, aData: Uint8Array) => void) | null = null;
  /** Directories made with `Mkdir`, which exist even while empty. */
  private readonly m_dirs = new Set<string>();

  FileExists(aRelPath: string): boolean {
    return this.m_files.has(aRelPath);
  }

  DirExists(aRelPath: string): boolean {
    const bare = aRelPath.replace(/\/+$/, '');
    const dir = `${bare}/`;

    if (this.m_dirs.has(bare)) return true;

    for (const k of this.m_files.keys()) if (k.startsWith(dir)) return true;

    for (const d of this.m_dirs) if (d.startsWith(dir)) return true;

    return false;
  }

  Mkdir(aRelDir: string): boolean {
    const bare = aRelDir.replace(/\/+$/, '');

    if (bare !== '') this.m_dirs.add(bare);

    return true;
  }

  List(aRelDir: string): { name: string; isDir: boolean }[] | null {
    const bare = aRelDir.replace(/\/+$/, '');

    if (bare !== '' && !this.DirExists(bare)) return null;

    const prefix = bare === '' ? '' : `${bare}/`;
    const out = new Map<string, boolean>();

    const visit = (aPath: string, aIsDir: boolean): void => {
      if (!aPath.startsWith(prefix) || aPath === bare) return;

      const rest = aPath.slice(prefix.length);
      const slash = rest.indexOf('/');

      if (slash < 0) out.set(rest, out.get(rest) || aIsDir);
      else out.set(rest.slice(0, slash), true);
    };

    for (const k of this.m_files.keys()) visit(k, false);
    for (const d of this.m_dirs) visit(d, true);

    return [...out.entries()].map(([name, isDir]) => ({ name, isDir }));
  }

  Write(aRelPath: string, aData: Uint8Array): void {
    this.m_files.set(aRelPath, aData);
    this.m_mtimes.set(aRelPath, ++s_writeClock);
    this.m_writeListener?.(aRelPath, aData);
  }

  /**
   * Be told of every write after it lands - how a page keeps the files a mount holds (the open
   * project's) in its own store. A disk has no such thing; this is the RAM disk's way of being the
   * project folder.
   */
  SetWriteListener(aListener: ((aRelPath: string, aData: Uint8Array) => void) | null): void {
    this.m_writeListener = aListener;
  }

  ModificationTime(aRelPath: string): number {
    return this.m_mtimes.get(aRelPath) ?? -1;
  }

  Read(aRelPath: string): Uint8Array | null {
    return this.m_files.get(aRelPath) ?? null;
  }

  Remove(aRelPath: string): boolean {
    this.m_mtimes.delete(aRelPath);
    return this.m_files.delete(aRelPath);
  }

  /** `wxRemoveDir` and everything under it (`wxFileName::Rmdir( wxPATH_RMDIR_RECURSIVE )`). */
  RemoveTree(aRelPath: string): boolean {
    const bare = aRelPath.replace(/\/+$/, '');
    const dir = `${bare}/`;
    let removed = false;

    for (const d of [...this.m_dirs]) {
      if (d === bare || d.startsWith(dir)) {
        this.m_dirs.delete(d);
        removed = true;
      }
    }

    for (const k of [...this.m_files.keys()]) {
      if (k.startsWith(dir)) {
        this.m_files.delete(k);
        this.m_mtimes.delete(k);
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

    if (moves.length === 0 && !this.m_dirs.has(aFrom.replace(/\/+$/, ''))) return false;

    if (!aOverwrite && moves.some(([, to]) => this.m_files.has(to))) return false;

    for (const [from, to] of moves) {
      const data = this.m_files.get(from)!;
      const mtime = this.m_mtimes.get(from) ?? -1;
      this.m_files.delete(from);
      this.m_mtimes.delete(from);
      this.m_files.set(to, data);
      this.m_mtimes.set(to, mtime); // a rename keeps the file's time
    }

    const fromBare = aFrom.replace(/\/+$/, '');
    const toBare = aTo.replace(/\/+$/, '');

    for (const d of [...this.m_dirs]) {
      if (d === fromBare || d.startsWith(fromDir)) {
        this.m_dirs.delete(d);
        this.m_dirs.add(toBare + d.slice(fromBare.length));
      }
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

  if (!hit || !IsWritableMount(hit.mount)) return null;

  return (hit.mount as wxWritableFileSystemMount).Read(hit.rel);
}

/**
 * Write a file into whichever in-memory mount holds its directory.
 * @return false when no writable mount covers the path.
 */
export function wxWriteFileSync(aPath: string, aData: Uint8Array): boolean {
  const hit = wxFindMount(wxNormalizePath(aPath));

  if (!hit || !IsWritableMount(hit.mount)) return false;

  (hit.mount as wxWritableFileSystemMount).Write(hit.rel, aData);
  return true;
}

/** `wxRemoveFile( path )`: drop a file from its in-memory mount. */
export function wxRemoveFile(aPath: string): boolean {
  const hit = wxFindMount(wxNormalizePath(aPath));

  if (!hit || !IsWritableMount(hit.mount)) return false;

  return (hit.mount as wxWritableFileSystemMount).Remove(hit.rel);
}

/** `wxRemoveDir` recursively: a `.pretty` and its footprints. False when there was nothing to remove. */
export function wxRemoveDirTree(aPath: string): boolean {
  const hit = wxFindMount(trimDir(wxNormalizePath(aPath)));

  if (!hit || !IsWritableMount(hit.mount) || hit.rel === '') return false;

  return (hit.mount as wxWritableFileSystemMount).RemoveTree(hit.rel);
}

/**
 * `wxRenameFile( aOld, aNew, aOverwrite )`: a file or a directory, inside one
 * in-memory mount. False when the two paths are on different mounts.
 */
export function wxRenameFile(aOld: string, aNew: string, aOverwrite = true): boolean {
  const from = wxFindMount(trimDir(wxNormalizePath(aOld)));
  const to = wxFindMount(trimDir(wxNormalizePath(aNew)));

  if (!from || !to || from.mount !== to.mount || !IsWritableMount(from.mount)) return false;

  if (from.rel === '' || to.rel === '') return false;

  return (from.mount as wxWritableFileSystemMount).Rename(from.rel, to.rel, aOverwrite);
}

/**
 * `wxDir( aPath )` + `GetFirst` / `GetNext` with no filter: the entries of one
 * directory, or null when it cannot be opened.
 */
export function wxDirEnumerate(aPath: string): { name: string; isDir: boolean }[] | null {
  const hit = wxFindMount(trimDir(wxNormalizePath(aPath)));

  if (!hit || !IsWritableMount(hit.mount)) return null;

  return hit.mount.List(hit.rel);
}

/** `wxFileName::Mkdir( aPath, wxS_DIR_DEFAULT, wxPATH_MKDIR_FULL )`: on a writable mount. */
export function wxMkdir(aPath: string): boolean {
  const hit = wxFindMount(trimDir(wxNormalizePath(aPath)));

  if (!hit || !IsWritableMount(hit.mount)) return false;

  return hit.rel === '' || hit.mount.Mkdir(hit.rel);
}

/** `wxFileName::IsDirWritable()`: the directory is on a mount that can be written. */
export function wxIsDirWritable(aPath: string): boolean {
  const hit = wxFindMount(trimDir(wxNormalizePath(aPath)));

  return !!hit && IsWritableMount(hit.mount);
}

/** `wxCopyFile( aSrc, aDest )`: the bytes of one file at another path (either mount). */
export function wxCopyFile(aSrc: string, aDest: string): boolean {
  const data = wxReadFileSync(aSrc);

  return data !== null && wxWriteFileSync(aDest, data);
}

/** `wxFileModificationTime( path )`: the file's last write, or -1 when there is no such file. */
export function wxFileModificationTime(aPath: string): number {
  const hit = wxFindMount(wxNormalizePath(aPath));

  if (!hit || !IsWritableMount(hit.mount) || !hit.mount.FileExists(hit.rel)) return -1;

  return hit.mount.ModificationTime?.(hit.rel) ?? -1;
}

/** `wxFileName::IsFileWritable()`: the file exists on a mount that can be written. */
export function wxIsFileWritable(aPath: string): boolean {
  const hit = wxFindMount(wxNormalizePath(aPath));

  return !!hit && IsWritableMount(hit.mount) && hit.mount.FileExists(hit.rel);
}

let s_tempFileCounter = 0;

/**
 * `wxFileName::CreateTempFileName( aPrefix )`: a new, empty file in the temp directory whose
 * name starts with \a aPrefix, or "" when it cannot be made.
 */
export function wxCreateTempFileName(aPrefix: string): string {
  let path: string;

  do path = `${wxGetTempDir()}/${aPrefix}${(++s_tempFileCounter).toString(36).padStart(6, '0')}`;
  while (wxFileExists(path));

  return wxWriteFileSync(path, new Uint8Array()) ? path : '';
}
