// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_LIBRARY_MANAGER` (eeschema/symbol_editor/symbol_library_manager.{h,cpp}) with its
 * `LIB_BUFFER` and `SYMBOL_BUFFER`: the symbol editor's working copies of library symbols over the
 * program's library tables, each buffer marked modified until its library is saved through the
 * library's SCH_IO plugin.
 */

import { unescapeString } from '@ziroeda/common/string_utils.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { NormalizePath } from '@ziroeda/common/env_paths.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { KICTL_CREATE } from '@ziroeda/common/kiway_player.js';
import {
  type LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { SymbolLibAdapter } from './project_sch.js';
import type { SCH_BASE_FRAME } from './sch_base_frame.js';
import { SCH_FILE_T, SCH_IO_MGR } from './sch_io/sch_io_mgr.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { EMBEDDED_FILE } from '@ziroeda/common/embedded_files.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { LIB_SYMBOL } from './lib_symbol.js';
import { SCH_SCREEN } from './sch_screen.js';
import type { SCH_IO_PROPERTIES } from './sch_io/sch_io.js';
import type { SCH_IO } from './sch_io/sch_io_mgr.js';
import { SCH_IO_KICAD_SEXPR } from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `SYMBOL_NAME_FILTER` (symbol_library_manager.h). */
export enum SYMBOL_NAME_FILTER {
  ALL,
  ROOT_ONLY,
  DERIVED_ONLY,
}

/** The properties that keep the plugin from writing the file on every symbol it is given. */
const bufferingProperties = (): SCH_IO_PROPERTIES =>
  new Map([[SCH_IO_KICAD_SEXPR.PropBuffering, '']]);

/**
 * Copy the embedded files of \a aSrc onto \a aDst, file by file, as upstream does it by hand
 * rather than with EMBEDDED_FILES' assignment.
 */
function copyEmbeddedFiles(aDst: LIB_SYMBOL, aSrc: LIB_SYMBOL): void {
  aDst.ClearEmbeddedFiles();

  for (const file of aSrc.EmbeddedFileMap().values()) aDst.AddFile(EMBEDDED_FILE.copyOf(file));

  aDst.SetAreFontsEmbedded(aSrc.GetAreFontsEmbedded());
  aDst.SetFileAddedCallback(aSrc.GetFileAddedCallback());
}

/** `SYMBOL_BUFFER` (symbol_library_manager.h): a symbol being edited, its original, its screen. */
export class SYMBOL_BUFFER {
  private readonly m_screen: SCH_SCREEN | null;
  private m_symbol: LIB_SYMBOL;
  private m_original: LIB_SYMBOL;

  constructor(aSymbol: LIB_SYMBOL, aScreen: SCH_SCREEN | null = null) {
    this.m_screen = aScreen;
    this.m_symbol = aSymbol;
    this.m_original = LIB_SYMBOL.copyOf(aSymbol);
  }

  GetSymbol(): LIB_SYMBOL {
    return this.m_symbol;
  }

  SetSymbol(aSymbol: LIB_SYMBOL): void {
    if (this.m_symbol === aSymbol) return; // wxCHECK

    this.m_symbol = aSymbol;

    // If the symbol moves libraries then the original moves with it
    const nick = this.m_symbol.GetLibId().GetLibNickname();

    if (this.m_original.GetLibId().GetLibNickname() !== nick)
      this.m_original.SetLibId(new LIB_ID(nick, this.m_original.GetLibId().GetLibItemName()));
  }

  GetOriginal(): LIB_SYMBOL {
    return this.m_original;
  }

  SetOriginal(aSymbol: LIB_SYMBOL): void {
    if (this.m_original === aSymbol) return; // wxCHECK

    this.m_original = aSymbol;

    // The original is not allowed to have a different library than its symbol
    const nick = this.m_symbol.GetLibId().GetLibNickname();

    if (this.m_original.GetLibId().GetLibNickname() !== nick)
      this.m_original.SetLibId(new LIB_ID(nick, this.m_original.GetLibId().GetLibItemName()));
  }

  IsModified(): boolean {
    return this.m_screen !== null && this.m_screen.IsContentModified();
  }

  GetScreen(): SCH_SCREEN | null {
    return this.m_screen;
  }
}

/** Name of the parent a buffered symbol inherits from, or empty if it is a root symbol. */
function getParentName(aSymbolBuf: SYMBOL_BUFFER): string {
  return aSymbolBuf.GetSymbol().GetLibParent()?.GetName() ?? '';
}

/** `LIB_BUFFER` (symbol_library_manager.h): the buffered symbols of one library. */
export class LIB_BUFFER {
  private readonly m_libName: string;
  private m_hash = 1;
  private m_symbols: SYMBOL_BUFFER[] = [];
  /** Buffers removed from the library, deleted from the file on the next save. */
  private m_deleted: SYMBOL_BUFFER[] = [];

  constructor(aLibrary: string) {
    this.m_libName = aLibrary;
  }

  IsModified(): boolean {
    if (this.m_deleted.length > 0) return true;

    for (const symbolBuf of this.m_symbols) {
      if (symbolBuf.IsModified()) return true;
    }

    return false;
  }

  GetHash(): number {
    return this.m_hash;
  }

  /** Return the working copy of a #LIB_SYMBOL root object with specified alias. */
  GetSymbol(aAlias: string): LIB_SYMBOL | null {
    return this.GetBuffer(aAlias)?.GetSymbol() ?? null;
  }

  /** Create a new buffer to store a symbol. #LIB_BUFFER takes ownership of aCopy. */
  CreateBuffer(aCopy: LIB_SYMBOL, aScreen: SCH_SCREEN): boolean {
    // Set the parent library name,
    // otherwise it is empty as no library has been given as the owner during object construction
    const libId = aCopy.GetLibId();
    libId.SetLibNickname(this.m_libName);
    aCopy.SetLibId(libId);

    this.m_symbols.push(new SYMBOL_BUFFER(aCopy, aScreen));

    ++this.m_hash;

    return true;
  }

  /** Update the buffered symbol with the contents of \a aCopy. */
  UpdateBuffer(aSymbolBuf: SYMBOL_BUFFER, aCopy: LIB_SYMBOL): boolean {
    aSymbolBuf.GetSymbol().Assign(aCopy);
    ++this.m_hash;

    return true;
  }

  /** Delete the given symbol buffer from the library buffer. */
  DeleteBuffer(aSymbolBuf: SYMBOL_BUFFER): boolean {
    const at = this.m_symbols.indexOf(aSymbolBuf);

    if (at < 0) return false; // wxCHECK

    let retv = true;

    // Remove all derived symbols to prevent broken inheritance.
    if (
      this.HasDerivedSymbols(aSymbolBuf.GetSymbol().GetName()) &&
      this.removeChildSymbols(aSymbolBuf) === 0
    ) {
      retv = false;
    }

    this.m_deleted.push(aSymbolBuf);
    this.m_symbols.splice(this.m_symbols.indexOf(aSymbolBuf), 1);
    ++this.m_hash;

    return retv;
  }

  GetDeletedBuffers(): readonly SYMBOL_BUFFER[] {
    return this.m_deleted;
  }

  ClearDeletedBuffer(): void {
    this.m_deleted = [];
  }

  /** Save stored modifications using a plugin. aBuffer decides whether the changes should be cached. */
  SaveBuffer(
    aSymbolBuf: SYMBOL_BUFFER,
    aFileName: string,
    aPlugin: SCH_IO,
    aBuffer: boolean,
  ): boolean {
    if (aFileName === '') return false; // wxCHECK

    const errorMsg = (aName: string, aError: unknown) =>
      console.error(
        `Error saving symbol ${unescapeString(aName)} to library '${aFileName}'.\n${
          aError instanceof Error ? aError.message : String(aError)
        }`,
      );

    // Set properties to prevent saving the file on every symbol save.
    const properties = bufferingProperties();
    const libSymbol = aSymbolBuf.GetSymbol();

    {
      const originalSymbol = aSymbolBuf.GetOriginal();
      const originalName = originalSymbol.GetName();

      // Delete the original symbol if the symbol name has been changed.
      if (libSymbol.GetName() !== originalSymbol.GetName()) {
        try {
          if (aPlugin.LoadSymbol(aFileName, originalName))
            aPlugin.DeleteSymbol(aFileName, originalName, properties);
        } catch (ioe) {
          if (!(ioe instanceof IO_ERROR)) throw ioe;

          errorMsg(originalName, ioe);
          return false;
        }
      }
    }

    let parentSymbol: LIB_SYMBOL | null = null;

    if (libSymbol.IsDerived()) {
      const newCachedSymbol = LIB_SYMBOL.copyOf(libSymbol);
      const bufferedParent = libSymbol.GetLibParent();
      parentSymbol = newCachedSymbol;

      if (!bufferedParent) return false; // wxCHECK

      let cachedParent: LIB_SYMBOL | null = null;

      try {
        cachedParent = aPlugin.LoadSymbol(aFileName, bufferedParent.GetName());
      } catch (ioe) {
        if (!(ioe instanceof IO_ERROR)) throw ioe;

        return false;
      }

      if (!cachedParent) {
        cachedParent = LIB_SYMBOL.copyOf(bufferedParent);
        newCachedSymbol.SetLibParent(cachedParent);

        try {
          aPlugin.SaveSymbol(aFileName, cachedParent, aBuffer ? properties : null);
        } catch (ioe) {
          if (!(ioe instanceof IO_ERROR)) throw ioe;

          errorMsg(cachedParent.GetName(), ioe);
          return false;
        }

        try {
          aPlugin.SaveSymbol(aFileName, newCachedSymbol, aBuffer ? properties : null);
        } catch (ioe) {
          if (!(ioe instanceof IO_ERROR)) throw ioe;

          errorMsg(newCachedSymbol.GetName(), ioe);
          return false;
        }

        const originalParent = LIB_SYMBOL.copyOf(bufferedParent);
        aSymbolBuf.SetOriginal(originalParent);

        const newSymbol = LIB_SYMBOL.copyOf(libSymbol);
        newSymbol.SetLibParent(originalParent);
        aSymbolBuf.SetOriginal(newSymbol);
      } else {
        // Copy embedded files from the buffered parent to the cached parent, so that any
        // embedded files added to the parent are preserved.
        copyEmbeddedFiles(cachedParent, bufferedParent);

        newCachedSymbol.SetLibParent(cachedParent);

        try {
          aPlugin.SaveSymbol(aFileName, newCachedSymbol, aBuffer ? properties : null);
        } catch (ioe) {
          if (!(ioe instanceof IO_ERROR)) throw ioe;

          errorMsg(newCachedSymbol.GetName(), ioe);
          return false;
        }

        const originalBufferedParent = this.GetBuffer(bufferedParent.GetName());

        if (!originalBufferedParent) return false; // wxCHECK

        const newSymbol = LIB_SYMBOL.copyOf(libSymbol);
        newSymbol.SetLibParent(originalBufferedParent.GetSymbol());
        aSymbolBuf.SetOriginal(newSymbol);
      }
    } else {
      parentSymbol = LIB_SYMBOL.copyOf(libSymbol);

      try {
        aPlugin.SaveSymbol(aFileName, parentSymbol, aBuffer ? properties : null);
      } catch (ioe) {
        if (!(ioe instanceof IO_ERROR)) throw ioe;

        errorMsg(libSymbol.GetName(), ioe);
        return false;
      }

      aSymbolBuf.SetOriginal(LIB_SYMBOL.copyOf(libSymbol));
    }

    const derivedSymbols: string[] = [];

    // Reparent all symbols derived from the saved symbol.
    if (this.GetDerivedSymbolNames(libSymbol.GetName(), derivedSymbols) !== 0) {
      // Save the derived symbols.
      for (const entry of derivedSymbols) {
        const symbol = this.GetBuffer(entry);

        if (!symbol) continue; // wxCHECK2

        const derivedSymbol = LIB_SYMBOL.copyOf(symbol.GetSymbol());
        derivedSymbol.SetLibParent(parentSymbol);

        try {
          aPlugin.SaveSymbol(
            aFileName,
            LIB_SYMBOL.copyOf(derivedSymbol),
            aBuffer ? properties : null,
          );
        } catch (ioe) {
          if (!(ioe instanceof IO_ERROR)) throw ioe;

          errorMsg(derivedSymbol.GetName(), ioe);
          return false;
        }
      }
    }

    ++this.m_hash;
    return true;
  }

  /** Return a symbol buffer with #LIB_SYMBOL holding a symbolic alias. */
  GetBuffer(aSymbolName: string): SYMBOL_BUFFER | null {
    return this.m_symbols.find((entry) => entry.GetSymbol().GetName() === aSymbolName) ?? null;
  }

  GetBuffers(): readonly SYMBOL_BUFFER[] {
    return this.m_symbols;
  }

  /** Check to see any symbols in the buffer are derived from a parent named \a aParentName. */
  HasDerivedSymbols(aParentName: string): boolean {
    if (aParentName === '') return false; // wxCHECK

    return this.m_symbols.some((entry) => getParentName(entry) === aParentName);
  }

  /** Fetch a list of root symbols names from the library buffer. */
  GetSymbolNames(aSymbolNames: string[], aFilter = SYMBOL_NAME_FILTER.ALL): void {
    for (const entry of this.m_symbols) {
      const symbol = entry.GetSymbol();

      if (
        (symbol.IsDerived() && aFilter === SYMBOL_NAME_FILTER.ROOT_ONLY) ||
        (symbol.IsRoot() && aFilter === SYMBOL_NAME_FILTER.DERIVED_ONLY)
      )
        continue;

      aSymbolNames.push(unescapeString(symbol.GetName()));
    }
  }

  /** Fetch all of the symbols derived from a \a aSymbolName into \a aList. */
  GetDerivedSymbolNames(aSymbolName: string, aList: string[]): number {
    if (aSymbolName === '') return 0; // wxCHECK

    // Links resolve by parent name rather than by parent object, because a buffered child can
    // still point at an unbuffered copy of its parent
    const derivedMap = new Map<string, string[]>();

    // Resolve every parent link up front so the walk below is only map lookups
    for (const entry of this.m_symbols) {
      const parentName = getParentName(entry);

      if (parentName !== '') {
        const list = derivedMap.get(parentName) ?? [];
        list.push(entry.GetSymbol().GetName());
        derivedMap.set(parentName, list);
      }
    }

    // Seeded with the query so that a name cycle in a corrupt library neither recurses forever nor
    // reports the root as its own descendant, which would have removeChildSymbols() delete it
    const visited = new Set<string>([aSymbolName]);

    const getDerived = (aParentName: string): void => {
      for (const derivedName of derivedMap.get(aParentName) ?? []) {
        if (visited.has(derivedName)) continue;

        visited.add(derivedName);
        aList.push(derivedName);

        // Recurse to get symbols derived from this one
        getDerived(derivedName);
      }
    };

    // A name that is not buffered simply has no children here
    getDerived(aSymbolName);

    return aList.length;
  }

  /** Remove all symbols derived from \a aSymbolBuf from the library buffer. */
  private removeChildSymbols(aSymbolBuf: SYMBOL_BUFFER): number {
    let cnt = 0;
    const derivedSymbolNames: string[] = [];

    if (this.GetDerivedSymbolNames(aSymbolBuf.GetSymbol().GetName(), derivedSymbolNames)) {
      for (const symbolName of derivedSymbolNames) {
        const at = this.m_symbols.findIndex((buf) => buf.GetSymbol().GetName() === symbolName);

        if (at < 0) continue; // wxCHECK2

        this.m_deleted.push(this.m_symbols[at]!);
        this.m_symbols.splice(at, 1);
        cnt += 1;
      }
    }

    return cnt;
  }
}

/** `SYMBOL_LIBRARY_MANAGER` (eeschema/symbol_library_manager.cpp). */
export class SYMBOL_LIBRARY_MANAGER {
  protected readonly m_frame: SCH_BASE_FRAME;

  /** `m_libs`: the edit buffers by library nickname. */
  protected readonly m_libs = new Map<string, LIB_BUFFER>();

  constructor(aFrame: SCH_BASE_FRAME) {
    this.m_frame = aFrame;
  }

  private adapter() {
    return SymbolLibAdapter(this.m_frame.Prj());
  }

  /** `GetFullURI( LIBRARY_TABLE_TYPE::SYMBOL, aLibrary, true )`. */
  private fullUri(aLibrary: string): string | null {
    const manager = Pgm().GetLibraryManager();
    const row = manager.GetRow(LIBRARY_TABLE_TYPE.SYMBOL, aLibrary);

    return row ? manager.GetFullURI(row, true) : null;
  }

  HasModifications(): boolean {
    for (const buffer of this.m_libs.values()) {
      if (buffer.IsModified()) return true;
    }

    return false;
  }

  GetHash(): number {
    return this.adapter().GetModifyHash();
  }

  /**
   * Return a library hash value to determine if it has changed.
   *
   * Upstream mixes the file's modification time in, so that changes made outside (a git branch
   * switch) reach the tree; a library here changes only through its adapter, whose modify hash
   * stands for the time.
   */
  GetLibraryHash(aLibrary: string): number {
    const libBuf = this.m_libs.get(aLibrary);

    if (libBuf) return libBuf.GetHash();

    const uri = this.fullUri(aLibrary);

    if (uri !== null) {
      let base = 0;

      for (const ch of aLibrary + uri) base = (Math.imul(base, 31) + ch.charCodeAt(0)) | 0;

      return base ^ (this.adapter().GetLibraryModifyHash(aLibrary) ?? 0);
    }

    return -1;
  }

  /** Return the array of library names. */
  GetLibraryNames(): string[] {
    const res: string[] = [];

    for (const row of Pgm().GetLibraryManager().Rows(LIBRARY_TABLE_TYPE.SYMBOL)) {
      // Database libraries are hidden from the symbol editor at the moment
      if (row.Type() === SCH_IO_MGR.ShowType(SCH_FILE_T.SCH_DATABASE)) continue;

      res.push(row.Nickname());
    }

    return res.sort((lhs, rhs) => strNumCmp(lhs, rhs, true));
  }

  EnumerateSymbols(aLibrary: string): LIB_SYMBOL[] {
    const libBuf = this.m_libs.get(aLibrary);

    if (libBuf) return libBuf.GetBuffers().map((symbolBuf) => symbolBuf.GetSymbol());

    return this.adapter().GetSymbols(aLibrary);
  }

  /**
   * Update the symbol buffer with a new version of the symbol.
   *
   * The library buffer creates a copy of the symbol.  It is required to save the library to
   * use the updated symbol in the schematic editor.
   */
  UpdateSymbol(aSymbol: LIB_SYMBOL, aLibrary: string): boolean {
    const libBuf = this.getLibraryBuffer(aLibrary);
    const symbolBuf = libBuf.GetBuffer(aSymbol.GetName());

    if (symbolBuf) {
      // Existing symbol.
      const bufferedSymbol = symbolBuf.GetSymbol();

      // If we are coming from a different library, the library ID needs to be preserved
      const libId = bufferedSymbol.GetLibId();
      bufferedSymbol.Assign(aSymbol);
      bufferedSymbol.SetLibId(libId);

      symbolBuf.GetScreen()!.SetContentModified();
    } else {
      // New symbol
      // new LIB_SYMBOL( *aSymbol, nullptr ): the nullptr is the LEGACY_SYMBOL_LIB*, not the
      // parent - a derived symbol stays derived.
      const symbolCopy = LIB_SYMBOL.copyOf(aSymbol);

      symbolCopy.SetLibId(new LIB_ID(aLibrary, aSymbol.GetLibId().GetLibItemName()));

      const screen = new SCH_SCREEN();
      libBuf.CreateBuffer(symbolCopy, screen);
      screen.SetContentModified();
    }

    return true;
  }

  /** Update the symbol buffer with a new version of the symbol when the name has changed. */
  UpdateSymbolAfterRename(aSymbol: LIB_SYMBOL, aOldName: string, aLibrary: string): boolean {
    const libBuf = this.getLibraryBuffer(aLibrary);
    const symbolBuf = libBuf.GetBuffer(aOldName);

    if (!symbolBuf) return false; // wxCHECK

    libBuf.UpdateBuffer(symbolBuf, aSymbol);
    this.OnDataChanged();

    return true;
  }

  /** Update the library buffer with a new version of the library. */
  UpdateLibraryBuffer(aLibrary: string): boolean {
    try {
      this.m_libs.delete(aLibrary);
      this.getLibraryBuffer(aLibrary);
    } catch (e) {
      console.error(`Error updating library buffer: ${e instanceof Error ? e.message : e}`);
      return false;
    }

    this.getLibraryBuffer(aLibrary);

    return true;
  }

  /** Remove the symbol from the symbol buffer. */
  RemoveSymbol(aSymbolName: string, aLibrary: string): boolean {
    const libBuf = this.getLibraryBuffer(aLibrary);
    const symbolBuf = libBuf.GetBuffer(aSymbolName);

    if (!symbolBuf) return false; // wxCHECK

    const retv = libBuf.DeleteBuffer(symbolBuf);
    this.OnDataChanged();

    return retv;
  }

  /** Return either an alias of a working #LIB_SYMBOL copy, or alias of the original symbol. */
  GetSymbol(aSymbolName: string, aLibrary: string): LIB_SYMBOL | null {
    // Try the library buffers first
    const symbol = this.m_libs.get(aLibrary)?.GetSymbol(aSymbolName);

    if (symbol) return symbol;

    // Get the original symbol
    try {
      return this.adapter().LoadSymbol(aLibrary, aSymbolName);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      DisplayErrorMessage(
        `Cannot load symbol '${aSymbolName}' from library '${aLibrary}'.`,
        e.message,
      );
      return null;
    }
  }

  /** Return the symbol copy from the buffer.  In case it does not exist yet, the copy is created. */
  GetBufferedSymbol(aSymbolName: string, aLibrary: string): LIB_SYMBOL | null {
    // try the library buffers first
    const libBuf = this.getLibraryBuffer(aLibrary);
    let bufferedSymbol = libBuf.GetSymbol(aSymbolName);

    if (!bufferedSymbol) {
      // no buffer symbol found: create a copy of the symbol
      try {
        const symbol = this.adapter().LoadSymbol(aLibrary, aSymbolName);

        if (symbol === null) throw new IO_ERROR(_('Symbol not found.'));

        let bufferedParent: LIB_SYMBOL | null = null;

        // Create parent symbols on demand so parent symbol can be set.
        if (symbol.IsDerived()) {
          const parent = symbol.GetLibParent();

          if (!parent) return null; // wxCHECK_MSG: derived symbol found with undefined parent

          // Check if the parent symbol buffer has already be created.
          bufferedParent = libBuf.GetSymbol(parent.GetName());

          if (!bufferedParent) {
            const newParent = LIB_SYMBOL.copyOf(parent);
            bufferedParent = newParent;
            libBuf.CreateBuffer(newParent, new SCH_SCREEN());
          }
        }

        const newSymbol = LIB_SYMBOL.copyOf(symbol);
        bufferedSymbol = newSymbol;

        if (bufferedParent) newSymbol.SetLibParent(bufferedParent);

        libBuf.CreateBuffer(newSymbol, new SCH_SCREEN());
      } catch (e) {
        if (!(e instanceof IO_ERROR)) throw e;

        DisplayErrorMessage(
          `Error loading symbol ${aSymbolName} from library '${aLibrary}'.`,
          e.message,
        );
        bufferedSymbol = null;
      }
    }

    return bufferedSymbol;
  }

  /** Return the screen used to edit a specific symbol. */
  GetScreen(aSymbolName: string, aLibrary: string): SCH_SCREEN | null {
    const buf = this.m_libs.get(aLibrary);

    if (!buf) return null; // wxCHECK

    return buf.GetBuffer(aSymbolName)?.GetScreen() ?? null;
  }

  /** Return true if symbol with a specific alias exists in library (either original one or buffered). */
  SymbolExists(aSymbolName: string, aLibrary: string): boolean {
    const libBuf = this.m_libs.get(aLibrary);

    if (libBuf) return libBuf.GetBuffer(aSymbolName) !== null;

    let symbol: LIB_SYMBOL | null = null;

    try {
      symbol = this.adapter().LoadSymbol(aLibrary, aSymbolName);
    } catch (e) {
      // checking if certain symbol exists, so its absence is perfectly fine
      if (!(e instanceof IO_ERROR)) throw e;
    }

    return symbol !== null;
  }

  /** Return true if the symbol name is already in use in the specified library. */
  SymbolNameInUse(aName: string, aLibrary: string): boolean {
    const existing: string[] = [];

    // NB: GetSymbolNames() is mostly used for GUI stuff, so it returns unescaped names
    this.GetSymbolNames(aLibrary, existing);

    const unescapedName = unescapeString(aName).toLowerCase();

    return existing.some((candidate) => candidate.toLowerCase() === unescapedName);
  }

  /** Return true if library has been loaded. */
  IsLibraryLoaded(aLibrary: string): boolean {
    return this.adapter().IsLibraryLoaded(aLibrary);
  }

  /** Return true if library has unsaved modifications. */
  IsLibraryModified(aLibrary: string): boolean {
    return this.m_libs.get(aLibrary)?.IsModified() ?? false;
  }

  /** Return true if symbol has unsaved modifications. */
  IsSymbolModified(aSymbolName: string, aLibrary: string): boolean {
    return this.m_libs.get(aLibrary)?.GetBuffer(aSymbolName)?.IsModified() ?? false;
  }

  SetSymbolModified(aSymbolName: string, aLibrary: string): void {
    const symbolBuf = this.m_libs.get(aLibrary)?.GetBuffer(aSymbolName);

    if (!this.m_libs.has(aLibrary)) return;

    if (!symbolBuf) return; // wxCHECK

    symbolBuf.GetScreen()!.SetContentModified();
  }

  /** Clear the modified flag for all symbols in a library. */
  ClearLibraryModified(aLibrary: string): boolean {
    const libBuf = this.m_libs.get(aLibrary);

    if (!libBuf) return false;

    for (const symbolBuf of libBuf.GetBuffers()) symbolBuf.GetScreen()?.SetContentModified(false);

    return true;
  }

  /** Clear the modified flag for a symbol. */
  ClearSymbolModified(aSymbolName: string, aLibrary: string): boolean {
    const libBuf = this.m_libs.get(aLibrary);

    if (!libBuf) return false;

    const symbolBuf = libBuf.GetBuffer(aSymbolName);

    if (!symbolBuf) return false; // wxCHECK

    symbolBuf.GetScreen()!.SetContentModified(false);
    return true;
  }

  /** Return true if the library is stored in a read-only file. */
  IsLibraryReadOnly(aLibrary: string): boolean {
    return !this.adapter().IsSymbolLibWritable(aLibrary);
  }

  /**
   * Save library to a file, including unsaved changes.
   *
   * @param aLibrary is the library name.
   * @param aFileName is the target file name.
   * @return True on success, false otherwise.
   */
  SaveLibrary(aLibrary: string, aFileName: string, aFileType = SCH_FILE_T.SCH_KICAD): boolean {
    if (aFileType === SCH_FILE_T.SCH_LEGACY) return false; // wxCHECK

    const pi = SCH_IO_MGR.FindPlugin(aFileType);

    if (!pi) return false;

    let res = true; // assume all libraries are successfully saved
    const properties = bufferingProperties();
    const libBuf = this.m_libs.get(aLibrary);

    if (libBuf) {
      // Handle buffered library
      for (const symbolBuf of libBuf.GetBuffers()) {
        if (!libBuf.SaveBuffer(symbolBuf, aFileName, pi, true)) {
          // Something went wrong, but try to save other libraries
          res = false;
        }
      }

      // clear the deleted symbols buffer only if data is saved to the original file
      if (res && this.fullUri(aLibrary) === aFileName) {
        // Delete symbols that were removed from the buffer before clearing the deleted list
        for (const deletedBuf of libBuf.GetDeletedBuffers()) {
          const originalName = deletedBuf.GetOriginal().GetName();

          try {
            if (pi.LoadSymbol(aFileName, originalName))
              pi.DeleteSymbol(aFileName, originalName, properties);
          } catch (ioe) {
            if (!(ioe instanceof IO_ERROR)) throw ioe;

            console.error(
              `Error deleting symbol ${unescapeString(originalName)} from library '${aFileName}'.\n${ioe.message}`,
            );
            res = false;
          }
        }

        libBuf.ClearDeletedBuffer();
      }
    } else {
      // Handle original library
      for (const symbol of this.getOriginalSymbols(aLibrary)) {
        try {
          if (symbol.IsDerived()) {
            const oldParent = symbol.GetLibParent();

            if (!oldParent) return false; // wxCHECK_MSG: derived symbol found with undefined parent

            let libParent = pi.LoadSymbol(aFileName, oldParent.GetName(), properties);

            if (!libParent) {
              libParent = LIB_SYMBOL.copyOf(oldParent);
              pi.SaveSymbol(aFileName, libParent, properties);
            } else {
              // Copy embedded files from the in-memory parent to the loaded parent
              copyEmbeddedFiles(libParent, oldParent);
            }

            const newSymbol = LIB_SYMBOL.copyOf(symbol);
            newSymbol.SetLibParent(libParent);
            pi.SaveSymbol(aFileName, newSymbol, properties);
          } else if (!pi.LoadSymbol(aFileName, symbol.GetName(), properties)) {
            pi.SaveSymbol(aFileName, LIB_SYMBOL.copyOf(symbol), properties);
          }
        } catch {
          res = false;
          break;
        }
      }
    }

    try {
      pi.SaveLibrary(aFileName);
    } catch {
      // return false because something happens.
      // The library is not successfully saved
      res = false;
    }

    return res;
  }

  /** Revert unsaved changes for a symbol. */
  RevertSymbol(aSymbolName: string, aLibrary: string): LIB_ID {
    const libBuf = this.m_libs.get(aLibrary);

    // no items to flush
    if (!libBuf) return new LIB_ID(aLibrary, aSymbolName);

    const symbolBuf = libBuf.GetBuffer(aSymbolName);

    if (!symbolBuf) return new LIB_ID(aLibrary, aSymbolName); // wxCHECK

    const original = LIB_SYMBOL.copyOf(symbolBuf.GetOriginal());

    if (original.GetName() !== aSymbolName) {
      this.UpdateSymbolAfterRename(original, aSymbolName, aLibrary);
    } else {
      // copy the initial data to the current symbol to restore
      symbolBuf.GetSymbol().Assign(original);
      this.OnDataChanged();
    }

    return new LIB_ID(aLibrary, original.GetName());
  }

  /** Revert unsaved changes for a symbol library. */
  RevertLibrary(aLibrary: string): boolean {
    // nothing to reverse
    if (!this.m_libs.has(aLibrary)) return false;

    this.m_libs.delete(aLibrary);
    this.OnDataChanged();

    return true;
  }

  /** Revert all pending changes. */
  RevertAll(): boolean {
    const retv = true;

    // Nothing to revert.
    if (this.GetHash() === 0) return true;

    for (const [name, lib] of this.m_libs) {
      if (!lib.IsModified()) continue;

      for (const buffer of lib.GetBuffers()) {
        if (!buffer.IsModified()) continue;

        // Upstream passes these two the other way round (library first); kept, as they are.
        this.RevertSymbol(name, buffer.GetOriginal().GetName());
      }
    }

    return retv;
  }

  /** Return a library name that is not currently in use. */
  GetUniqueLibraryName(): string {
    let name = 'New_Library';

    if (!this.LibraryExists(name)) return name;

    name += '_';

    for (let i = 0; ; ++i) {
      if (!this.LibraryExists(`${name}${i}`)) return `${name}${i}`;
    }
  }

  GetSymbolNames(aLibName: string, aSymbolNames: string[], aFilter = SYMBOL_NAME_FILTER.ALL): void {
    this.getLibraryBuffer(aLibName).GetSymbolNames(aSymbolNames, aFilter);
  }

  /** Fetch all of the symbols derived from a \a aSymbolName into \a aList. */
  GetDerivedSymbolNames(aSymbolName: string, aLibraryName: string, aList: string[]): number {
    return this.getLibraryBuffer(aLibraryName).GetDerivedSymbolNames(aSymbolName, aList);
  }

  /** Check if symbol \a aSymbolName in library \a aLibraryName is a root symbol that has derived symbols. */
  HasDerivedSymbols(aSymbolName: string, aLibraryName: string): boolean {
    return this.getLibraryBuffer(aLibraryName).HasDerivedSymbols(aSymbolName);
  }

  GetLibraryCount(): number {
    return this.adapter().GetLibraryNames().length;
  }

  /** Return a set of #LIB_SYMBOL objects belonging to the original library. */
  protected getOriginalSymbols(aLibrary: string): Set<LIB_SYMBOL> {
    const symbols = new Set<LIB_SYMBOL>();

    if (!this.LibraryExists(aLibrary)) return symbols; // wxCHECK

    for (const symbol of this.adapter().GetSymbols(aLibrary)) symbols.add(symbol);

    return symbols;
  }

  /**
   * Return an existing library buffer or creates one to using symbol library table to get the
   * original data.
   */
  protected getLibraryBuffer(aLibrary: string): LIB_BUFFER {
    const existing = this.m_libs.get(aLibrary);

    if (existing) return existing;

    // The requested buffer does not exist yet, so create one
    const buf = new LIB_BUFFER(aLibrary);
    this.m_libs.set(aLibrary, buf);

    for (const symbol of this.getOriginalSymbols(aLibrary)) {
      if (symbol.IsDerived()) {
        const oldParent = symbol.GetLibParent();

        if (!oldParent) return buf; // wxCHECK_MSG: derived symbol found with undefined parent

        let libParent = buf.GetSymbol(oldParent.GetName());

        if (!libParent) {
          const newParent = LIB_SYMBOL.copyOf(oldParent);
          libParent = newParent;
          buf.CreateBuffer(newParent, new SCH_SCREEN());
        }

        const newSymbol = LIB_SYMBOL.copyOf(symbol);
        newSymbol.SetLibParent(libParent);
        buf.CreateBuffer(newSymbol, new SCH_SCREEN());
      } else if (!buf.GetSymbol(symbol.GetName())) {
        buf.CreateBuffer(LIB_SYMBOL.copyOf(symbol), new SCH_SCREEN());
      }
    }

    return buf;
  }

  /** Create an empty library and adds it to the library table.  The library file is created. */
  CreateLibrary(aFilePath: string, aScope: LIBRARY_TABLE_SCOPE): boolean {
    return this.addLibrary(aFilePath, true, aScope);
  }

  /** Add an existing library.  The library is added to the library table as well. */
  AddLibrary(aFilePath: string, aScope: LIBRARY_TABLE_SCOPE): boolean {
    return this.addLibrary(aFilePath, false, aScope);
  }

  /** `LibraryExists( aLibrary, aCheckEnabled )`: buffered, or loaded by the adapter. */
  LibraryExists(aLibrary: string, aCheckEnabled = false): boolean {
    if (aLibrary === '') return false;

    if (this.m_libs.has(aLibrary)) return true;

    return SymbolLibAdapter(this.m_frame.Prj()).HasLibrary(aLibrary, aCheckEnabled);
  }

  /** Called whenever the library data changes; the symbol editor's tree overrides it. */
  OnDataChanged(): void {}

  /** `getLibraryName( aFilePath )`: the file's name without its extension. */
  protected static getLibraryName(aFilePath: string): string {
    const full = aFilePath.slice(aFilePath.lastIndexOf('/') + 1);
    const dot = full.lastIndexOf('.');

    return dot <= 0 ? full : full.slice(0, dot);
  }

  /** `addLibrary( aFilePath, aCreate, aScope )` (symbol_library_manager.cpp:748). */
  protected addLibrary(aFilePath: string, aCreate: boolean, aScope: LIBRARY_TABLE_SCOPE): boolean {
    const libName = SYMBOL_LIBRARY_MANAGER.getLibraryName(aFilePath);

    if (this.LibraryExists(libName)) return false; // wxCHECK: either create or add an existing one

    // try to use path normalized to an environmental variable or project path
    const relPath = NormalizePath(aFilePath, Pgm().GetLocalEnvVariables(), this.m_frame.Prj());

    let schFileType = SCH_IO_MGR.GuessPluginTypeFromLibPath(aFilePath, aCreate ? KICTL_CREATE : 0);

    if (schFileType === SCH_FILE_T.SCH_FILE_UNKNOWN) schFileType = SCH_FILE_T.SCH_LEGACY;

    const adapter = SymbolLibAdapter(this.m_frame.Prj());
    const table = Pgm().GetLibraryManager().Table(LIBRARY_TABLE_TYPE.SYMBOL, aScope);

    if (!table) return false; // wxCHECK

    let success = true;

    try {
      const row = table.InsertRow();

      row.SetNickname(libName);
      row.SetURI(relPath);
      row.SetType(SCH_IO_MGR.ShowType(schFileType));

      const saved = table.Save();

      if (!saved.ok) {
        // wxMessageBox( …, _( "File Save Error" ), wxOK | wxICON_ERROR )
        DisplayErrorMessage(`Error saving library table:\n\n${saved.error.message}`);
        success = false;
      }
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(ioe.message);
      return false;
    }

    if (success) {
      if (aCreate) {
        if (schFileType === SCH_FILE_T.SCH_LEGACY) return false; // wxCHECK

        if (!adapter.CreateLibrary(libName)) {
          table.Rows().pop();
          return false;
        }
      }

      adapter.LoadOne(libName);
      this.OnDataChanged();
    }

    return success;
  }
}
