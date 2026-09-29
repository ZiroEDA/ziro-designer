// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `FOOTPRINT_LIBRARY_ADAPTER` (pcbnew/footprint_library_adapter.h), the face
 * of the project's footprint libraries that the board-side code asks: which
 * nicknames exist, whether one loaded, and a footprint out of one.
 *
 * `LIBRARY_MANAGER` and `PROJECT` are not ported; the host (the designer, a
 * test) implements this interface over its own library store and hands it to
 * the BOARD in place of `PROJECT_PCB::FootprintLibAdapter( GetProject() )`.
 */
import type { LIBRARY_TABLE } from '@ziroeda/common/libraries/library_table.js';
import type { FOOTPRINT } from './footprint.js';

/** The `LIBRARY_TABLE_ROW` fields the callers read. */
export interface LIBRARY_TABLE_ROW {
  readonly nickname: string;
  readonly uri: string;
  readonly type: string;
  readonly enabled: boolean;
  /** `LIBRARY_TABLE_ROW::GetOptionsMap()`: the row's options column, parsed. */
  GetOptionsMap(): ReadonlyMap<string, string>;
}

export interface FOOTPRINT_LIBRARY_ADAPTER {
  /**
   * Like LIBRARY_MANAGER::GetRow but filtered to the LIBRARY_TABLE_TYPE of this adapter.
   * A row a nested table failed to load is still found.
   */
  GetRow(aNickname: string): LIBRARY_TABLE_ROW | null;

  /**
   * Test for the existence of \a aNickname in the library tables.
   *
   * @param aCheckEnabled if true will only return true for enabled libraries
   * @return true if a library \a aNickname exists in the loaded tables.
   */
  HasLibrary(aNickname: string, aCheckEnabled?: boolean): boolean;

  IsLibraryLoaded(aNickname: string): boolean;

  /**
   * Load a #FOOTPRINT having @a aName from the library given by @a aNickname.
   *
   * @param aKeepUUID = true to keep initial items UUID, false to set new UUID
   * @return the footprint if found or null if not found.
   * @throw IO_ERROR if the library cannot be found or read.
   */
  LoadFootprint(aNickname: string, aName: string, aKeepUUID: boolean): FOOTPRINT | null;

  /**
   * `FOOTPRINT_LIBRARY_ADAPTER::FootprintExists( aNickname, aName )`
   * (footprint_library_adapter.h:94): whether the loaded library holds a
   * footprint of that name.
   */
  FootprintExists(aNickname: string, aName: string): boolean;

  /** `FOOTPRINT_LIBRARY_ADAPTER::LoadOne( aNickname )` (:55): load one library by nickname. */
  LoadOne(aNickname: string): void;

  /**
   * `LIBRARY_MANAGER_ADAPTER::ProjectTable()`: the project's footprint-library
   * table, null when the project has none.
   */
  ProjectTable(): LIBRARY_TABLE | null;

  /** `LIBRARY_MANAGER::GetFullURI( aRow, aSubstituted )`: the row's URI, expanded when asked. */
  GetFullURI(aRow: LIBRARY_TABLE_ROW, aSubstituted?: boolean): string;
}
