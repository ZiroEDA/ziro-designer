// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIBRARY_MANAGER_ADAPTER` (common/libraries/library_manager.cpp,
 * include/libraries/library_manager.h), as far as the library-table dialogs
 * reach it: the load status of a library, `CheckTableRow` (which a grid's
 * status column shows), `LibraryError`, and the per-library configuration
 * dialog hooks.
 *
 * Not here: `LIBRARY_MANAGER` itself (the table loading, `Rows` / `GetRow`,
 * the async loads). How libraries load and preload is the editors' own and
 * stays so; pcbnew's `fp_lib_table.ts` keeps `Rows` / `GetRow` / `ExpandURI`
 * over its plain table record. Upstream keeps a second, process-wide map for
 * the global libraries (`globalLibs()`); an adapter here has the one map,
 * which is where both scopes' statuses are looked up in the same order.
 */
import {
  type LIBRARY_ERROR,
  type LIBRARY_RESULT,
  LIBRARY_TABLE_OK,
  type LIBRARY_TABLE_ROW,
  type LIBRARY_TABLE_TYPE,
} from './library_table.js';

/** `LOAD_STATUS`: the status of a library load managed by an adapter. */
export enum LOAD_STATUS {
  INVALID,
  LOADING,
  LOADED,
  LOAD_ERROR,
}

/** `LIB_STATUS`: the overall status of a loaded or loading library. */
export interface LIB_STATUS {
  load_status: LOAD_STATUS;
  error?: LIBRARY_ERROR;
}

/** `LIB_DATA`: a loaded library - the row it came from and how it went. */
export interface LIB_DATA {
  /** The IO plugin that loaded it (opaque here; the editor's). */
  plugin: unknown;
  row: LIBRARY_TABLE_ROW;
  status: LIB_STATUS;
}

/** `LIBRARY_MANAGER_ADAPTER`. */
export abstract class LIBRARY_MANAGER_ADAPTER {
  /** `m_libraries`, keyed by nickname. */
  protected m_libraries = new Map<string, LIB_DATA>();

  /** The type of library table this adapter works with. */
  abstract Type(): LIBRARY_TABLE_TYPE;

  /**
   * `LoadOne( aLib )`: load one library through its plugin; undefined when
   * nothing could be tried.
   */
  abstract LoadOne(aLib: LIB_DATA): LIB_STATUS | undefined;

  /**
   * `createPlugin( aRow )`: the IO plugin for a row's type, or the error.
   * `LIBRARY_TABLE_OK` is the "error" for a row that names a nested table.
   */
  protected abstract createPlugin(aRow: LIBRARY_TABLE_ROW): LIBRARY_RESULT<unknown>;

  /** `abortLoad()`: stop a background load; there is none to stop by default. */
  protected abortLoad(): void {}

  /**
   * `CheckTableRow( aRow )`: try the row the way a load would and write the
   * answer onto it (`SetOk`, `SetErrorDescription`). Skipped when a library of
   * the same nickname, URI and type is already loaded - its answer is reused.
   */
  CheckTableRow(aRow: LIBRARY_TABLE_ROW): void {
    // Testing is expensive; skip it if we already have a library with the same
    // nickname and URI as the row under test
    const libData = this.fetchIfLoaded(aRow.Nickname());

    if (libData) {
      const loadedRow = libData.row;

      if (loadedRow.URI() === aRow.URI() && loadedRow.Type() === aRow.Type()) {
        aRow.SetOk(loadedRow.IsOk());
        return;
      }
    }

    this.abortLoad();

    const plugin = this.createPlugin(aRow);

    if (plugin.ok) {
      const lib: LIB_DATA = {
        plugin: plugin.value,
        row: aRow,
        status: { load_status: LOAD_STATUS.INVALID },
      };
      const status = this.LoadOne(lib);

      if (status !== undefined) {
        aRow.SetOk(status.load_status === LOAD_STATUS.LOADED);

        if (status.error !== undefined) aRow.SetErrorDescription(status.error.message);
      }
    } else if (plugin.error.message === new LIBRARY_TABLE_OK().message) {
      aRow.SetOk(true);
      aRow.SetErrorDescription('');
    } else {
      aRow.SetOk(false);
      aRow.SetErrorDescription(plugin.error.message);
    }
  }

  /** `GetLibraryStatus( aNickname )`: undefined when not loaded (yet). */
  GetLibraryStatus(aNickname: string): LIB_STATUS | undefined {
    return this.m_libraries.get(aNickname)?.status;
  }

  /** `IsLibraryLoaded( aNickname )`. */
  IsLibraryLoaded(aNickname: string): boolean {
    return this.GetLibraryStatus(aNickname)?.load_status === LOAD_STATUS.LOADED;
  }

  SupportsConfigurationDialog(_aNickname: string): boolean {
    return false;
  }

  ShowConfigurationDialog(_aNickname: string): void {}

  /** `LibraryError( aNickname )`: the load error of a library, if it has one. */
  LibraryError(aNickname: string): LIBRARY_ERROR | undefined {
    return this.m_libraries.get(aNickname)?.status.error;
  }

  /** `fetchIfLoaded`: the library, only when it loaded. */
  protected fetchIfLoaded(aNickname: string): LIB_DATA | undefined {
    const lib = this.m_libraries.get(aNickname);

    return lib?.status.load_status === LOAD_STATUS.LOADED ? lib : undefined;
  }
}
