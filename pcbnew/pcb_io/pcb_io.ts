// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcb_io.cpp` / `.h`: `PCB_IO`, the base every board loading
 * and saving plugin derives from. The virtuals a plugin does not implement
 * throw "Plugin … does not implement …", as upstream's `NOT_IMPLEMENTED`.
 *
 * Paths are read through `IO_BASE::m_readFile` (see `common/io/io_base.ts`).
 */

import { IO_BASE, IO_FILE_DESC, fileNameExt } from '@ziroeda/common/io/io_base.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { BOARD } from '../board.js';
import type { FOOTPRINT } from '../footprint.js';

/** `std::map<std::string, UTF8>`: a plugin's properties. */
export type PCB_IO_PROPERTIES = ReadonlyMap<string, string>;

/** `PROJECT*`, as far as an importer uses it: the text variables. */
export interface PCB_IO_PROJECT {
  GetTextVars(): Map<string, string>;
  IncrementTextVarsTicker?(): void;
}

/** `#define NOT_IMPLEMENTED( aCaller )` of pcb_io.cpp. */
function NOT_IMPLEMENTED(aName: string, aCaller: string): never {
  throw new IO_ERROR(`Plugin "${aName}" does not implement the "${aCaller}" function.`);
}

export abstract class PCB_IO extends IO_BASE {
  /** The board BOARD being worked on, no ownership here */
  protected m_board: BOARD | null = null;

  /** Properties passed via Save() or Load(), no ownership, may be NULL. */
  protected m_props: PCB_IO_PROPERTIES | null = null;

  protected constructor(aName: string) {
    super(aName);
  }

  /** Returns board file description for the PCB_IO. */
  GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('', []);
  }

  /** Work-around for lack of dynamic_cast across compile units on Mac */
  override IsPCB_IO(): boolean {
    return true;
  }

  /**
   * Checks if this PCB_IO can read the specified board file.
   * If not overriden, extension check is used.
   */
  CanReadBoard(aFileName: string): boolean {
    const exts = this.GetBoardFileDesc().m_FileExtensions;

    const fileExt = fileNameExt(aFileName).toLowerCase();

    for (const ext of exts) {
      if (fileExt === ext.toLowerCase()) return true;
    }

    return false;
  }

  /**
   * Checks if this PCB_IO can read a footprint from specified file or directory.
   * If not overriden, extension check is used.
   */
  CanReadFootprint(aFileName: string): boolean {
    const exts = this.GetLibraryFileDesc().m_FileExtensions;

    const fileExt = fileNameExt(aFileName).toLowerCase();

    for (const ext of exts) {
      if (fileExt === ext.toLowerCase()) return true;
    }

    return false;
  }

  /**
   * Load information from some input file format that this PCB_IO implementation
   * knows about into either a new BOARD or an existing one.
   */
  LoadBoard(
    _aFileName: string,
    _aAppendToMe: BOARD | null,
    _aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    NOT_IMPLEMENTED(this.m_name, 'LoadBoard');
  }

  /**
   * Return a container with the cached library footprints generated in the last call to
   * #Load. This function is intended to be used ONLY by the non-KiCad board importers for the
   * purpose of obtaining the footprint library of the design and creating a project-specific
   * library.
   */
  GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    NOT_IMPLEMENTED(this.m_name, 'GetImportedCachedLibraryFootprints');
  }

  SaveBoard(
    _aFileName: string,
    _aBoard: BOARD,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the PLUGIN interface.
    NOT_IMPLEMENTED(this.m_name, 'SaveBoard');
  }

  FootprintEnumerate(
    _aFootprintNames: string[],
    _aLibraryPath: string,
    _aBestEfforts: boolean,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the PLUGIN interface.
    NOT_IMPLEMENTED(this.m_name, 'FootprintEnumerate');
  }

  /** Generate a timestamp representing all the files in the library (including the library directory). */
  abstract GetLibraryTimestamp(aLibraryPath: string): number;

  /**
   * Load a single footprint from \a aFootprintPath and put its name in \a aFootprintNameOut.
   * If this is a footprint library, the first footprint should be loaded.
   */
  ImportFootprint(
    aFootprintPath: string,
    aFootprintNameOut: { value: string },
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    const footprintNames: string[] = [];

    this.FootprintEnumerate(footprintNames, aFootprintPath, true, aProperties);

    if (footprintNames.length === 0) return null;

    if (footprintNames.length > 1) {
      console.warn(
        'Selected file contains multiple footprints. Only the first one will be imported.\nTo load all footprints, add it as a library using Preferences -> Manage Footprint Libraries...',
      );
    }

    aFootprintNameOut.value = footprintNames[0]!;

    return this.FootprintLoad(aFootprintPath, aFootprintNameOut.value, false, aProperties);
  }

  FootprintLoad(
    _aLibraryPath: string,
    _aFootprintName: string,
    _aKeepUUID = false,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    // not pure virtual so that plugins only have to implement subset of the PLUGIN interface.
    NOT_IMPLEMENTED(this.m_name, 'FootprintLoad');
  }

  /** A version of FootprintLoad() for use after FootprintEnumerate() for more efficient cache management. */
  GetEnumeratedFootprint(
    aLibraryPath: string,
    aFootprintName: string,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    // default implementation
    return this.FootprintLoad(aLibraryPath, aFootprintName, false, aProperties);
  }

  CachesEnumeratedFootprints(): boolean {
    return false;
  }

  FootprintExists(
    aLibraryPath: string,
    aFootprintName: string,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): boolean {
    // default implementation
    return this.FootprintLoad(aLibraryPath, aFootprintName, true, aProperties) !== null;
  }

  FootprintSave(
    _aLibraryPath: string,
    _aFootprint: FOOTPRINT,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the PLUGIN interface.
    NOT_IMPLEMENTED(this.m_name, 'FootprintSave');
  }

  FootprintDelete(
    _aLibraryPath: string,
    _aFootprintName: string,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    // not pure virtual so that plugins only have to implement subset of the PLUGIN interface.
    NOT_IMPLEMENTED(this.m_name, 'FootprintDelete');
  }

  ClearCachedFootprints(_aLibraryPath: string): void {}
}
