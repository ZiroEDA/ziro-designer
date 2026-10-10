// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/sch_io.cpp` / `.h`: `SCH_IO`, the base the schematic
 * importers derive from (EasyEDA, EAGLE, Altium, ...). The virtuals a plugin
 * does not implement throw "Plugin … does not implement …", as upstream's
 * `NOT_IMPLEMENTED`.
 *
 * Paths are read through `IO_BASE::m_readFile` (`SetFileReader`, see
 * common/io/io_base.ts), as `PCB_IO`'s are.
 *
 * `SCH_IO_KICAD_SEXPR` predates this file and stands on its own (its
 * `LoadSchematicFile` takes the project path and a reader); it is not
 * re-parented here.
 */
import { IO_BASE, IO_FILE_DESC, fileNameExt } from '@ziroeda/common/io/io_base.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCHEMATIC } from '../schematic.js';

/** `std::map<std::string, UTF8>`: a plugin's properties. */
export type SCH_IO_PROPERTIES = ReadonlyMap<string, string>;

/** `#define NOT_IMPLEMENTED( aCaller )` of sch_io.cpp. */
function NOT_IMPLEMENTED(aName: string, aCaller: string): never {
  throw new IO_ERROR(`Plugin "${aName}" does not implement the "${aCaller}" function.`);
}

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
   * If not overridden, extension check is used.
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
   * @note This is temporary until the new s-expr file format is implement.
   */
  abstract GetModifyHash(): number;

  /**
   * Load information from some input file format that this #SCH_IO implementation knows
   * about, into either a new #SCH_SHEET or an existing one.
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
   * `EnumerateSymbolLib( wxArrayString& aSymbolNameList, … )`: the alias names in the library
   * at @a aLibraryPath, appended to @a aSymbolNameList.
   */
  EnumerateSymbolLib(
    _aSymbolNameList: string[],
    _aLibraryPath: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    NOT_IMPLEMENTED(this.m_name, 'EnumerateSymbolLib');
  }

  /**
   * `EnumerateSymbolLib( std::vector<LIB_SYMBOL*>& aSymbolList, … )`, the overload TypeScript
   * cannot share a name with - spelled as SCH_IO_KICAD_SEXPR spells it.
   */
  EnumerateSymbolLibSymbols(
    _aSymbolList: LIB_SYMBOL[],
    _aLibraryPath: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    NOT_IMPLEMENTED(this.m_name, 'EnumerateSymbolLib');
  }

  /** Load a #LIB_SYMBOL object having @a aPartName from the @a aLibraryPath containing a library. */
  LoadSymbol(
    _aLibraryPath: string,
    _aPartName: string,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): LIB_SYMBOL | null {
    NOT_IMPLEMENTED(this.m_name, 'LoadSymbol');
  }

  /** Write @a aSymbol to an existing library located at @a aLibraryPath. */
  SaveSymbol(
    _aLibraryPath: string,
    _aSymbol: LIB_SYMBOL,
    _aProperties: SCH_IO_PROPERTIES | null = null,
  ): void {
    NOT_IMPLEMENTED(this.m_name, 'SaveSymbol');
  }

  /**
   * Retrieves a list of (custom) field names that are present on symbols in this library.
   * Not pure virtual upstream, and empty: `{}`.
   */
  GetAvailableSymbolFields(_aNames: string[]): void {}

  /** `SupportsSubLibraries()`: `false` unless a plugin says otherwise. */
  SupportsSubLibraries(): boolean {
    return false;
  }

  /** Return an error string to the caller. */
  GetError(): string {
    NOT_IMPLEMENTED(this.m_name, 'GetError');
  }
}
