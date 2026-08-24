// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Buffered symbol-library manager, the web port of KiCad's
 * LIB_SYMBOL_LIBRARY_MANAGER (eeschema/symbol_editor/symbol_library_manager.*).
 *
 * Libraries come from two places, mirroring KiCad's global/project split:
 *   - the bundled global libraries under `public/symbols` (fetched lazily, with
 *     names known up front from index.json, like KiCad's on-demand lib loads),
 *   - the open project's `.kicad_sym` files.
 *
 * Every library buffers working copies of its symbols; edits mark the symbol
 * and library modified (SYMBOL_BUFFER/LIB_BUFFER's IsModified) until saved.
 * "Saving" serializes with the lossless writer and hands the bytes to the
 * caller (a browser download replaces writing to disk).
 */

import { parse } from '@ziroeda/sexpr';
import { readSymbolLib, serializeSymbolLib, type LibSymbol } from '@ziroeda/eeschema';
import { libraryBase } from '../../libraryHosts.js';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';

export interface ManagedLibrary {
  /** Library nickname shown in the tree (file basename without extension). */
  name: string;
  /** Display path/filename (project-relative for project libs). */
  fileName: string;
  scope: 'global' | 'project';
  loaded: boolean;
  /** Names known before load (from index.json) so the tree can show them. */
  pendingNames: string[];
  /** Working (buffered) symbols by name, in file order. */
  symbols: Map<string, LibSymbol>;
  /** As-loaded copies for revert / modified checks. */
  original: Map<string, LibSymbol>;
  /** Symbol names with unsaved edits. */
  modified: Set<string>;
  /** Library-level structural change (added/deleted/renamed symbols). */
  libModified: boolean;
}

// The hosted symbol library set, or the bundled subset when it is unreachable.
const symbolsBase = (): string => libraryBase.symbols;

export class SymbolLibraryManager {
  private libs = new Map<string, ManagedLibrary>();
  /** Bumped on every mutation so React can subscribe cheaply. */
  revision = 0;

  private touch(): void {
    this.revision++;
  }

  libraryNames(): string[] {
    return [...this.libs.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  library(name: string): ManagedLibrary | undefined {
    return this.libs.get(name);
  }
  libraryExists(name: string): boolean {
    return this.libs.has(name);
  }

  /** Register a bundled global library by name (content fetched on demand). */
  addGlobalLibrary(name: string, symbolNames: string[]): void {
    if (this.libs.has(name)) return;
    this.libs.set(name, {
      name,
      fileName: `${name}.kicad_sym`,
      scope: 'global',
      loaded: false,
      pendingNames: symbolNames,
      symbols: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    });
    this.touch();
  }

  /** Add a project library from already-loaded file text. */
  addProjectLibrary(name: string, fileName: string, text: string): void {
    const lib: ManagedLibrary = {
      name,
      fileName,
      scope: 'project',
      loaded: true,
      pendingNames: [],
      symbols: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    };
    for (const sym of readSymbolLib(parse(text))) {
      lib.symbols.set(sym.libId, sym);
      lib.original.set(sym.libId, sym);
    }
    this.libs.set(name, lib);
    this.touch();
  }

  /**
   * Add a global library from already-loaded file text, used for libraries
   * installed through the Plugin and Content Manager (their `.kicad_sym` text
   * lives in the PCM store rather than at a URL, so it is loaded eagerly).
   */
  addInstalledLibrary(name: string, text: string): void {
    if (this.libs.has(name)) return;
    const lib: ManagedLibrary = {
      name,
      fileName: `${name}.kicad_sym`,
      scope: 'global',
      loaded: true,
      pendingNames: [],
      symbols: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    };
    for (const sym of readSymbolLib(parse(text))) {
      lib.symbols.set(sym.libId, sym);
      lib.original.set(sym.libId, sym);
    }
    this.libs.set(name, lib);
    this.touch();
  }

  /** Create a new, empty library (ACTIONS::newLibrary). */
  createLibrary(name: string): ManagedLibrary {
    const lib: ManagedLibrary = {
      name,
      fileName: `${name}.kicad_sym`,
      scope: 'project',
      loaded: true,
      pendingNames: [],
      symbols: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: true,
    };
    this.libs.set(name, lib);
    this.touch();
    return lib;
  }

  /** Fetch + parse a lazy global library. */
  async ensureLoaded(name: string): Promise<ManagedLibrary | undefined> {
    const lib = this.libs.get(name);
    if (!lib || lib.loaded) return lib;
    const text = await fetch(`${symbolsBase()}/${name}.kicad_sym`).then((r) => r.text());
    for (const sym of readSymbolLib(parse(text))) {
      lib.symbols.set(sym.libId, sym);
      lib.original.set(sym.libId, sym);
    }
    lib.loaded = true;
    lib.pendingNames = [];
    this.touch();
    return lib;
  }

  symbolNames(libName: string): string[] {
    const lib = this.libs.get(libName);
    if (!lib) return [];
    return lib.loaded ? [...lib.symbols.keys()] : [...lib.pendingNames];
  }

  getSymbol(libName: string, symName: string): LibSymbol | undefined {
    return this.libs.get(libName)?.symbols.get(symName);
  }

  /**
   * `SYMBOL_LIBRARY_MANAGER::SymbolNameInUse`
   * (`eeschema/symbol_library_manager.cpp:653-669`).
   *
   * Upstream compares with `CmpNoCase` against `UnescapeString( aName )`, and
   * says why in its own comment: "GetSymbolNames() is mostly used for GUI
   * stuff, so it returns unescaped names". Ours was an exact `Map.has` on the
   * ESCAPED name, so `r` did not collide with `R` and neither did a name whose
   * only difference was an escape sequence — every caller that asks "is this
   * taken?" (New Symbol, Rename, Import, Duplicate) missed those.
   */
  symbolExists(libName: string, symName: string): boolean {
    const lib = this.libs.get(libName);
    if (!lib) return false;
    const wanted = unescapeString(symName).toLowerCase();
    const names = lib.loaded ? [...lib.symbols.keys()] : lib.pendingNames;
    return names.some((n) => unescapeString(n).toLowerCase() === wanted);
  }

  /**
   * `SYMBOL_EDIT_FRAME::ensureUniqueName`
   * (`eeschema/symbol_editor/symbol_editor.cpp:1400-1413`):
   *
   * ```cpp
   * int      i = 1;
   * wxString newName = aSymbol->GetName();
   *
   * while( m_libMgr->SymbolNameInUse( newName, aLibrary ) )
   *     newName.Printf( "%s_%d", aSymbol->GetName(), i++ );
   * ```
   *
   * The counter is appended to the ORIGINAL name every time, so a third copy of
   * `R` is `R_2` — not `R_1_1`, which is what a loop that appends to its own
   * previous answer produces, and which is what both of our call sites did
   * ("R_1_1_1" on import, "R_copy_copy" on duplicate).
   */
  ensureUniqueName(libName: string, name: string): string {
    let candidate = name;
    let i = 1;
    while (this.symbolExists(libName, candidate)) candidate = `${name}_${i++}`;
    return candidate;
  }

  /** Buffer an updated working copy (UpdateSymbol): marks it modified. */
  updateSymbol(libName: string, sym: LibSymbol): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    if (!lib.symbols.has(sym.libId)) lib.libModified = true;
    lib.symbols.set(sym.libId, sym);
    lib.modified.add(sym.libId);
    this.touch();
  }

  /**
   * `UpdateSymbolAfterRename` (`symbol_library_manager.cpp:472-509`): re-key the
   * buffer and keep the modified mark.
   *
   * The `original` map is re-keyed TOO. Upstream has no such problem to solve —
   * a SYMBOL_BUFFER holds its working copy and its original side by side, so
   * renaming the buffer carries the original with it. Ours are two Maps keyed
   * by name, and only one of them was being re-keyed, which meant a renamed
   * symbol's original became unreachable and `revertSymbol` DELETED the symbol
   * instead of restoring it.
   *
   * The original's own `libId` is deliberately left at the old name: that is
   * what `RevertSymbol` compares against to decide it must rename back
   * (`symbol_library_manager.cpp:524`).
   */
  renameSymbol(libName: string, oldName: string, sym: LibSymbol): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    // Preserve file order through the rename.
    const entries = [...lib.symbols.entries()].map(
      ([k, v]) => (k === oldName ? [sym.libId, sym] : [k, v]) as [string, LibSymbol],
    );
    lib.symbols = new Map(entries);
    const orig = lib.original.get(oldName);
    if (orig !== undefined) {
      lib.original.delete(oldName);
      lib.original.set(sym.libId, orig);
    }
    lib.modified.delete(oldName);
    lib.modified.add(sym.libId);
    lib.libModified = true;
    this.touch();
  }

  /**
   * Every symbol in the library that `extends` `symName`, directly or through
   * another derived symbol.
   *
   * `LIB_BUFFER::GetDerivedSymbolNames` (`symbol_library_manager.cpp:1238-1274`)
   * walks the buffer looking for symbols whose parent resolves to this one.
   */
  derivedSymbolNames(libName: string, symName: string): string[] {
    const lib = this.libs.get(libName);
    if (!lib) return [];
    const out: string[] = [];
    const frontier = [symName];
    while (frontier.length > 0) {
      const parent = frontier.pop()!;
      for (const [name, sym] of lib.symbols) {
        if (sym.extends === parent && !out.includes(name)) {
          out.push(name);
          frontier.push(name);
        }
      }
    }
    return out;
  }

  /**
   * `RemoveSymbol` (`symbol_library_manager.cpp:579-591`), which calls
   * `LIB_BUFFER::DeleteSymbol` (`:979-1003`) — and that starts with
   * `removeChildSymbols( *symbolBuf )` (`:1276-1300`) when the symbol being
   * deleted is a root:
   *
   * ```cpp
   * m_deleted.emplace_back( *it );
   * m_symbols.erase( it );
   * ```
   *
   * for every name `GetDerivedSymbolNames` returns. Ours deleted only the base
   * and left its children behind with an `extends` pointing at nothing, at
   * which point `flattenAgainst` stops resolving them and they render as empty
   * symbols. Deleting a base symbol deletes its children, upstream and here.
   */
  removeSymbol(libName: string, symName: string): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    for (const child of this.derivedSymbolNames(libName, symName)) {
      lib.symbols.delete(child);
      lib.modified.delete(child);
    }
    lib.symbols.delete(symName);
    lib.modified.delete(symName);
    lib.libModified = true;
    this.touch();
  }

  /**
   * `RevertSymbol` (`symbol_library_manager.cpp:512-536`).
   *
   * ```cpp
   * LIB_SYMBOL original( symbolBuf->GetOriginal() );
   *
   * if( original.GetName() != aSymbolName )
   *     UpdateSymbolAfterRename( &original, aSymbolName, aLibrary );
   * else
   *     symbolBuf->GetSymbol() = original;
   *
   * return LIB_ID( aLibrary, original.GetName() );
   * ```
   *
   * The rename branch is the whole point: reverting a symbol that was RENAMED
   * has to put the name back too, and upstream returns the LIB_ID it reverted
   * to so the frame can follow it. Ours had no such branch — it looked the
   * original up under the NEW name, found nothing, and fell through to
   * `lib.symbols.delete()`. Renaming a symbol and then reverting destroyed it.
   *
   * Returns the restored symbol, whose `libId` is the name to show; `undefined`
   * for a symbol that was never saved, which upstream drops.
   */
  revertSymbol(libName: string, symName: string): LibSymbol | undefined {
    const lib = this.libs.get(libName);
    if (!lib) return undefined;
    const orig = lib.original.get(symName);
    if (!orig) {
      lib.symbols.delete(symName);
      lib.modified.delete(symName);
      this.touch();
      return undefined;
    }
    if (orig.libId !== symName) {
      // `original.GetName() != aSymbolName` — rename the buffer BACK.
      const entries = [...lib.symbols.entries()].map(
        ([k, v]) => (k === symName ? [orig.libId, orig] : [k, v]) as [string, LibSymbol],
      );
      lib.symbols = new Map(entries);
      lib.original.delete(symName);
      lib.original.set(orig.libId, orig);
      lib.modified.delete(symName);
      lib.modified.delete(orig.libId);
      this.touch();
      return orig;
    }
    lib.symbols.set(symName, orig);
    lib.modified.delete(symName);
    this.touch();
    return orig;
  }

  isSymbolModified(libName: string, symName: string): boolean {
    return this.libs.get(libName)?.modified.has(symName) ?? false;
  }

  isLibraryModified(libName: string): boolean {
    const lib = this.libs.get(libName);
    return !!lib && (lib.libModified || lib.modified.size > 0);
  }

  hasModifications(): boolean {
    for (const name of this.libs.keys()) {
      if (this.isLibraryModified(name)) return true;
    }
    return false;
  }

  /**
   * Serialize the library with the lossless writer (the buffered state becomes
   * the new baseline, clearing the modified marks) and return the file text.
   */
  saveLibraryText(libName: string): string | undefined {
    const lib = this.libs.get(libName);
    if (!lib?.loaded) return undefined;
    const text = serializeSymbolLib([...lib.symbols.values()]);
    lib.original = new Map(lib.symbols);
    lib.modified.clear();
    lib.libModified = false;
    this.touch();
    return text;
  }
}
