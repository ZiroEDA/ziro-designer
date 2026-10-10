// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/sch_io.h` / `.cpp`: `SCH_IO`, the base every schematic and symbol library
 * loading and saving plugin derives from. The virtuals a plugin does not implement throw
 * "Plugin … does not implement …", as upstream's `NOT_IMPLEMENTED`.
 *
 * Paths are read through `IO_BASE::m_readFile` (see `common/io/io_base.ts`).
 *
 * `SCH_IO_KICAD_SEXPR` does not derive from it yet: its load and save take the project path
 * and a text reader, and return the text, where these take the file name (the same state as
 * pcbnew's `PCB_IO_KICAD_SEXPR` beside `PCB_IO`).
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { IO_BASE, IO_FILE_DESC, fileNameExt } from '@ziroeda/common/io/io_base.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import type { SYMBOL_LIBRARY_ADAPTER } from '../libraries/symbol_library_adapter.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCHEMATIC } from '../schematic.js';

/** `std::map<std::string, UTF8>`: a plugin's properties. */
export type SCH_IO_PROPERTIES = ReadonlyMap<string, string>;

/** `#define NOT_IMPLEMENTED( aCaller )` of sch_io.cpp. */
function NOT_IMPLEMENTED(aName: string, aCaller: string): never {
  throw new IO_ERROR(`Plugin "${aName}" does not implement the "${aCaller}" function.`);
}

/**
 * Base class that schematic file and library loading and saving plugins should derive from.
 * Implementations can provide either LoadSchematicFile() or SaveSchematicFile() functions,
 * or both. SCH_IOs written for the SCH_IO_MGR need not support both.
 */
export abstract class SCH_IO extends IO_BASE {
  protected constructor(aName: string) {
    super(aName);
  }

  /** Returns schematic file description for the #SCH_IO. */
  GetSchematicFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('', []);
  }

  /**
   * Checks if this SCH_IO can read the specified schematic file.
   * If not overriden, extension check is used.
   */
  CanReadSchematicFile(aFileName: string): boolean {
    const exts = this.GetSchematicFileDesc().m_FileExtensions;

    const fileExt = fileNameExt(aFileName).toLowerCase();

    for (const ext of exts) {
      if (fileExt === ext.toLowerCase()) return true;
    }

    return false;
  }

  /**
   * Return the modification hash from the library cache.
   *
   * @note This is temporary until the new s-expr file format is implement. The new file
   *       format will embed symbols instead of referencing them from the library. This
   *       function can be removed when the new file format is implemented.
   */
  abstract GetModifyHash(): number;

  SaveLibrary(_aFileName: string, _aProperties: SCH_IO_PROPERTIES | null = null): void {
    NOT_IMPLEMENTED(this.m_name, 'SaveLibrary');
  }

  /**
   * Load information from some input file format that this #SCH_IO implementation knows
   * about, into either a new #SCH_SHEET or an existing one. This may be used to load an
   * entire new #SCH_SHEET, or to augment an existing one if \a aAppendToMe is not NULL.
   */
  LoadSchematicFile(
    _aFileName: string,
    _aSchematic: SCHEMATIC,
    _aAppendToMe: SCH_SHEET | null = null,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): SCH_SHEET {
    NOT_IMPLEMENTED(this.m_name, 'LoadSchematicFile');
  }

  /**
   * Write \a aSchematic to a storage file in a format that this #SCH_IO implementation knows
   * about, or it can be used to write a portion of \a aSchematic to a special kind of export
   * file.
   */
  SaveSchematicFile(
    _aFileName: string,
    _aSheet: SCH_SHEET,
    _aSchematic: SCHEMATIC,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the SCH_IO interface.
    NOT_IMPLEMENTED(this.m_name, 'SaveSchematicFile');
  }

  /** Populate a list of #LIB_SYMBOL alias names contained within the library \a aLibraryPath. */
  EnumerateSymbolLib(
    _aSymbolNameList: string[],
    _aLibraryPath: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the SCH_IO interface.
    NOT_IMPLEMENTED(this.m_name, 'EnumerateSymbolLib');
  }

  /**
   * Populate a list of #LIB_SYMBOL aliases contained within the library \a aLibraryPath.
   * Upstream's second `EnumerateSymbolLib` overload, by its own name here (one name cannot
   * take both list types).
   */
  EnumerateSymbolLibSymbols(
    _aSymbolList: LIB_SYMBOL[],
    _aLibraryPath: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the SCH_IO interface.
    NOT_IMPLEMENTED(this.m_name, 'EnumerateSymbolLib');
  }

  /** Load a #LIB_SYMBOL object having \a aPartName from the \a aLibraryPath containing a library format that this #SCH_IO knows about. */
  LoadSymbol(
    _aLibraryPath: string,
    _aPartName: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): LIB_SYMBOL | null {
    // not pure virtual so that plugins only have to implement subset of the SCH_IO interface.
    NOT_IMPLEMENTED(this.m_name, 'LoadSymbol');
  }

  /** Write \a aSymbol to an existing library located at \a aLibraryPath. */
  SaveSymbol(
    _aLibraryPath: string,
    _aSymbol: LIB_SYMBOL,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the SCH_IO interface.
    NOT_IMPLEMENTED(this.m_name, 'SaveSymbol');
  }

  /** Delete the entire #LIB_SYMBOL associated with \a aAliasName from the library \a aLibraryPath. */
  DeleteSymbol(
    _aLibraryPath: string,
    _aSymbolName: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the SCH_IO interface.
    NOT_IMPLEMENTED(this.m_name, 'DeleteSymbol');
  }

  override GetLibraryOptions(aListToAppendTo: Map<string, string>): void {
    // Get base options first
    super.GetLibraryOptions(aListToAppendTo);

    // Empty for most plugins
  }

  /** @return true if this plugin supports libraries that contain sub-libraries. */
  SupportsSubLibraries(): boolean {
    return false;
  }

  /** Retrieves a list of sub-libraries in this library. */
  GetSubLibraryNames(_aNames: string[]): void {}

  /** Gets a description of a sublibrary. */
  GetSubLibraryDescription(_aName: string): string {
    return '';
  }

  /** Retrieves a list of (custom) field names that are present on symbols in this library. */
  GetAvailableSymbolFields(_aNames: string[]): void {}

  /** Retrieves a list of (custom) field names that should be shown by default for this library in the symbol chooser. */
  GetDefaultSymbolFields(aNames: string[]): void {
    this.GetAvailableSymbolFields(aNames);
  }

  /** Return an error string to the caller. */
  GetError(): string {
    // not pure virtual so that plugins only have to implement subset of the SCH_IO interface.
    NOT_IMPLEMENTED(this.m_name, 'GetError');
  }

  /** Some library plugins need to have access to their parent library table. */
  SetLibraryManagerAdapter(_aAdapter: SYMBOL_LIBRARY_ADAPTER): void {}
}
