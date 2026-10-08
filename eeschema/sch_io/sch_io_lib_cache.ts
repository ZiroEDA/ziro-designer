// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_IO_LIB_CACHE` (eeschema/sch_io/sch_io_lib_cache.cpp): the base of the symbol library
 * caches - a library file (or a folder of them) held in memory as a name -> LIB_SYMBOL map, with
 * the modification time it was read at so a changed file is reread.
 *
 * Files live on the mounted file system (common/wx/filefn.ts). A mount has no symlinks, so
 * `GetRealFile` is the library path itself.
 */
import { KiCadSymbolLibFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import { TimestampDir } from '@ziroeda/common/kiplatform/io.js';
import {
  wxDirExists,
  wxFileExists,
  wxFileModificationTime,
  wxIsDirWritable,
  wxIsFileWritable,
} from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import type { SCH_FIELD } from '../sch_field.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { LIB_SYMBOL_MAP } from './kicad_sexpr/sch_io_kicad_sexpr_parser.js';

/** `SCH_LIB_TYPE`. */
export enum SCH_LIB_TYPE {
  LT_EESCHEMA,
  LT_SYMBOL,
}

/**
 * The `wxFileName` the cache keeps for its library: a full path, and whether it names a
 * directory (`AssignDir`) rather than a file.
 */
export class LIB_FILE_NAME {
  constructor(
    private m_path: string,
    private m_isDir = false,
  ) {}

  /** `AssignDir( aPath )`. */
  AssignDir(aPath: string): void {
    this.m_path = aPath.replace(/\/+$/, '');
    this.m_isDir = true;
  }

  /** `operator=( aPath )`: a file name. */
  Assign(aPath: string): void {
    this.m_path = aPath;
    this.m_isDir = false;
  }

  IsDir(): boolean {
    return this.m_isDir;
  }

  /** `GetFullPath()`: a directory's path ends in its separator, as wx writes it. */
  GetFullPath(): string {
    return this.m_isDir ? `${this.m_path}/` : this.m_path;
  }

  /** `GetPath()`: the directory - the path itself for a directory, else the file's folder. */
  GetPath(): string {
    if (this.m_isDir) return this.m_path;

    const slash = this.m_path.lastIndexOf('/');

    return slash <= 0 ? (slash === 0 ? '/' : '') : this.m_path.slice(0, slash);
  }

  /** `GetFullName()`: the file's name and extension; empty for a directory. */
  GetFullName(): string {
    return this.m_isDir ? '' : this.m_path.slice(this.m_path.lastIndexOf('/') + 1);
  }

  /** `GetName()`: the file's name without its extension. */
  GetName(): string {
    const full = this.GetFullName();
    const dot = full.lastIndexOf('.');

    return dot <= 0 ? full : full.slice(0, dot);
  }

  /** `IsAbsolute()`. */
  IsAbsolute(): boolean {
    return this.m_path.startsWith('/');
  }

  FileExists(): boolean {
    return wxFileExists(this.m_path);
  }

  DirExists(): boolean {
    return wxDirExists(this.GetPath());
  }

  Clone(): LIB_FILE_NAME {
    return new LIB_FILE_NAME(this.m_path, this.m_isDir);
  }
}

export abstract class SCH_IO_LIB_CACHE {
  protected m_modHash = 1; // Keep track of the modification status of the library.

  protected m_fileName: string; // Absolute path and file name.
  protected m_libFileName: LIB_FILE_NAME; // Absolute path and file name is required here.
  protected m_fileModTime = -1;
  protected m_symbols: LIB_SYMBOL_MAP = new Map(); // Map of names of #LIB_SYMBOL pointers.

  /// For folder-based libraries, track which source file each symbol was loaded from.
  /// Key is symbol name, value is the full path to the source file.
  /// This allows saving symbols back to their original files rather than creating
  /// individual files for each symbol.
  protected m_symbolSourceFiles = new Map<string, string>();

  protected m_isWritable = true;
  protected m_isModified = false;
  protected m_hasParseError = false; // True if library had parse error during load.
  protected m_libType = SCH_LIB_TYPE.LT_EESCHEMA; // Is this cache a symbol or symbol library.

  constructor(aFullPathAndFileName: string) {
    this.m_fileName = aFullPathAndFileName;
    this.m_libFileName = new LIB_FILE_NAME(aFullPathAndFileName);

    // Normalize the path: if it's a directory on the filesystem, ensure m_libFileName is marked
    // as a directory so that IsDir() checks work correctly.
    if (wxDirExists(aFullPathAndFileName)) this.m_libFileName.AssignDir(aFullPathAndFileName);
  }

  IncrementModifyHash(): void {
    this.m_modHash++;
  }

  GetModifyHash(): number {
    return this.m_modHash;
  }

  /** `m_modHash = …`, which the plugin (a friend upstream) sets after a reload. */
  SetModifyHash(aHash: number): void {
    this.m_modHash = aHash;
  }

  // Most all functions in this class throw IO_ERROR exceptions.  There are no
  // error codes nor user interface calls from here, nor in any SCH_IO objects.
  // Catch these exceptions higher up please.

  /** Save the entire library to file m_libFileName. */
  Save(_aOpt?: boolean): void {
    console.assert(false); // wxCHECK( false, /* void */ )
  }

  abstract Load(): void;

  AddSymbol(aSymbol: LIB_SYMBOL): void {
    // aSymbol is cloned in SYMBOL_LIB::AddSymbol().  The cache takes ownership of aSymbol.
    const name = aSymbol.GetName();
    const existing = this.m_symbols.get(name);

    if (existing) this.removeSymbol(existing);

    this.m_symbols.set(name, aSymbol);
    this.m_isModified = true;
    this.IncrementModifyHash();
  }

  abstract DeleteSymbol(aName: string): void;

  GetSymbol(aName: string): LIB_SYMBOL | null {
    return this.m_symbols.get(aName) ?? null;
  }

  /** If m_libFileName is a symlink follow it to the real source file. */
  GetRealFile(): LIB_FILE_NAME {
    const fn = this.m_libFileName.Clone();

    // Normalize the path: if it's a directory on the filesystem, ensure fn is marked as a
    // directory so that IsDir() checks work correctly. wxFileName::IsDir() only checks if
    // the path string ends with a separator, not if the path is actually a directory.
    if (!fn.IsDir() && wxDirExists(fn.GetFullPath())) fn.AssignDir(fn.GetFullPath());

    return fn;
  }

  GetLibModificationTime(): number {
    const fn = this.GetRealFile();

    // Update the writable flag while we have a wxFileName, in a network this is possibly quite
    // dynamic anyway.
    if (!fn.IsDir()) {
      this.m_isWritable = wxIsFileWritable(fn.GetFullPath());
      return wxFileModificationTime(fn.GetFullPath());
    }

    this.m_isWritable = wxIsDirWritable(fn.GetPath());
    return TimestampDir(fn.GetPath(), `*.${KiCadSymbolLibFileExtension}`);
  }

  IsFile(aFullPathAndFileName: string): boolean {
    return this.m_fileName === aFullPathAndFileName;
  }

  IsFileChanged(): boolean {
    const fn = this.GetRealFile();

    if (this.m_fileModTime < 0) return false;

    if (!fn.IsDir() && fn.FileExists())
      return wxFileModificationTime(fn.GetFullPath()) !== this.m_fileModTime;

    if (fn.IsDir() && fn.DirExists())
      return TimestampDir(fn.GetPath(), `*.${KiCadSymbolLibFileExtension}`) !== this.m_fileModTime;

    return false;
  }

  SetModified(aModified = true): void {
    this.m_isModified = aModified;
  }

  /**
   * @return true if the library had a parse error during loading.
   *
   * When a parse error occurs, only symbols before the error are loaded.
   * Saving a library in this state would permanently lose symbols after the error.
   */
  HasParseError(): boolean {
    return this.m_hasParseError;
  }

  SetParseError(aHasError = true): void {
    this.m_hasParseError = aHasError;
  }

  GetLogicalName(): string {
    return this.m_libFileName.GetName();
  }

  SetFileName(aFileName: string): void {
    // Update both m_fileName and m_libFileName to keep them in sync
    this.m_fileName = aFileName;

    // Normalize the path: if it's a directory on the filesystem, ensure m_libFileName is marked
    // as a directory so that IsDir() checks work correctly.
    if (wxDirExists(aFileName)) this.m_libFileName.AssignDir(aFileName);
    else this.m_libFileName.Assign(aFileName);
  }

  GetFileName(): string {
    return this.m_libFileName.GetFullPath();
  }

  GetSymbolMap(): LIB_SYMBOL_MAP {
    return this.m_symbols;
  }

  /** For folder-based libraries, the source file each symbol was loaded from (by name). */
  GetSymbolSourceFiles(): ReadonlyMap<string, string> {
    return this.m_symbolSourceFiles;
  }

  protected removeSymbol(aSymbol: LIB_SYMBOL | null): LIB_SYMBOL | null {
    if (!aSymbol) return null; // wxCHECK_MSG: "NULL pointer cannot be removed from library."

    let firstChild: LIB_SYMBOL | null = null;
    const mapped = this.m_symbols.get(aSymbol.GetName());

    if (!mapped) return null;

    // If the entry pointer doesn't match the name it is mapped to in the library, we
    // have done something terribly wrong.
    if (mapped !== aSymbol) return null; // wxCHECK_MSG: "Pointer mismatch …"

    // If the symbol is a root symbol used by other symbols find the first derived symbol that
    // uses the root symbol and make it the new root.
    if (aSymbol.IsRoot()) {
      for (const entry of this.m_symbols.values()) {
        if (entry.IsDerived() && entry.GetLibParent() === aSymbol) {
          firstChild = entry;
          break;
        }
      }

      if (firstChild) {
        for (const drawItem of [...aSymbol.GetDrawItems()] as SCH_ITEM[]) {
          if (drawItem.Type() === KICAD_T.SCH_FIELD_T) {
            const field = drawItem as SCH_FIELD;

            if (firstChild.GetField(field.GetCanonicalName())) continue;
          }

          const newItem = drawItem.Clone() as SCH_ITEM;
          drawItem.SetParent(firstChild);
          firstChild.AddDrawItem(newItem);
        }

        // Reparent the remaining derived symbols.
        for (const entry of this.m_symbols.values()) {
          if (entry.IsDerived() && entry.GetLibParent() === aSymbol) entry.SetLibParent(firstChild);
        }
      }
    }

    this.m_symbols.delete(aSymbol.GetName());
    aSymbol.Destroy();
    this.m_isModified = true;
    this.IncrementModifyHash();
    return firstChild;
  }
}
