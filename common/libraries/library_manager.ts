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
import { ExpandEnvVarSubstitutions } from '../common.js';
import { strNumCmp } from '../string_utils.js';
import { PgmOrNull } from '../pgm_base.js';
import type { PROJECT } from '../project.js';
import {
  LIBRARY_ERROR,
  type LIBRARY_RESULT,
  type LIBRARY_TABLE,
  LIBRARY_TABLE_OK,
  type LIBRARY_TABLE_ROW,
  LIBRARY_TABLE_SCOPE,
  type LIBRARY_TABLE_TYPE,
} from './library_table.js';

/**
 * `LIBRARY_MANAGER` (common/libraries/library_manager.{h,cpp}), the part an
 * adapter asks: the global and project tables by type, their rows merged
 * (`Rows`, a project row overriding a global one of the same nickname), one
 * row by nickname, and a row's URI expanded. The tables themselves are loaded
 * by the host (a page reads the project's and the hosted global tables),
 * handed over with `SetTable`; nested tables are not followed.
 */
export class LIBRARY_MANAGER {
  private readonly m_tables = new Map<LIBRARY_TABLE_TYPE, LIBRARY_TABLE>();
  private readonly m_projectTables = new Map<LIBRARY_TABLE_TYPE, LIBRARY_TABLE>();

  /** Install (or with null, drop) the table of \a aType in \a aScope. */
  SetTable(
    aType: LIBRARY_TABLE_TYPE,
    aScope: LIBRARY_TABLE_SCOPE,
    aTable: LIBRARY_TABLE | null,
  ): void {
    const map = aScope === LIBRARY_TABLE_SCOPE.PROJECT ? this.m_projectTables : this.m_tables;

    if (aTable) map.set(aType, aTable);
    else map.delete(aType);
  }

  /** `Table( aType, aScope )`: the table itself, or null. */
  Table(aType: LIBRARY_TABLE_TYPE, aScope: LIBRARY_TABLE_SCOPE): LIBRARY_TABLE | null {
    const map = aScope === LIBRARY_TABLE_SCOPE.PROJECT ? this.m_projectTables : this.m_tables;
    return map.get(aType) ?? null;
  }

  /**
   * `Rows( aType, aScope, aIncludeInvalid )` (library_manager.cpp:756-833):
   * global then project rows, a later row replacing an earlier one of the same
   * nickname in place; rows (and tables) that are not OK only when asked.
   */
  Rows(
    aType: LIBRARY_TABLE_TYPE,
    aScope: LIBRARY_TABLE_SCOPE = LIBRARY_TABLE_SCOPE.BOTH,
    aIncludeInvalid = false,
  ): LIBRARY_TABLE_ROW[] {
    const rows = new Map<string, LIBRARY_TABLE_ROW>();
    const rowOrder: string[] = [];
    const tables: (LIBRARY_TABLE | undefined)[] =
      aScope === LIBRARY_TABLE_SCOPE.GLOBAL
        ? [this.m_tables.get(aType)]
        : aScope === LIBRARY_TABLE_SCOPE.PROJECT
          ? [this.m_projectTables.get(aType)]
          : [this.m_tables.get(aType), this.m_projectTables.get(aType)];

    for (const table of tables) {
      if (!table || table.Type() !== aType) continue;

      if (!table.IsOk() && !aIncludeInvalid) continue;

      for (const row of table.Rows()) {
        if (!row.IsOk() && !aIncludeInvalid) continue;

        // A nested table's libraries are not followed here.
        if (row.Type() === 'Table') continue;

        if (!rows.has(row.Nickname())) rowOrder.push(row.Nickname());

        rows.set(row.Nickname(), row);
      }
    }

    return rowOrder.map((n) => rows.get(n)!);
  }

  /** `GetRow( aType, aNickname, aScope )` (:836-859), invalid rows included. */
  GetRow(
    aType: LIBRARY_TABLE_TYPE,
    aNickname: string,
    aScope: LIBRARY_TABLE_SCOPE = LIBRARY_TABLE_SCOPE.BOTH,
  ): LIBRARY_TABLE_ROW | null {
    return this.Rows(aType, aScope, true).find((r) => r.Nickname() === aNickname) ?? null;
  }

  /** `ExpandURI( aShortURI, aProject )` (:972-979): variables expanded against the project. */
  static ExpandURI(aShortURI: string, aProject: PROJECT | null): string {
    return ExpandEnvVarSubstitutions(
      aShortURI,
      aProject ? (token) => aProject.TextVarResolver(token) : null,
    );
  }

  /** `GetFullURI( aRow, aSubstituted )`. */
  GetFullURI(aRow: LIBRARY_TABLE_ROW, aSubstituted = false): string {
    if (!aSubstituted) return aRow.URI();

    return LIBRARY_MANAGER.ExpandURI(aRow.URI(), PgmOrNull()?.GetSettingsManager().Prj() ?? null);
  }
}

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

  /** `m_manager`: the tables this adapter's rows come from (null for the table dialogs' use). */
  protected readonly m_manager: LIBRARY_MANAGER | null;

  constructor(aManager: LIBRARY_MANAGER | null = null) {
    this.m_manager = aManager;
  }

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

  /**
   * `GetLibraryNames()` (library_manager.cpp:1294-1314): the nicknames of the
   * loaded libraries among this type's rows, `StrNumCmp` case-insensitive.
   */
  GetLibraryNames(): string[] {
    const ret: string[] = [];

    for (const row of this.m_manager?.Rows(this.Type()) ?? []) {
      if (this.fetchIfLoaded(row.Nickname())) ret.push(row.Nickname());
    }

    return ret.sort((a, b) => strNumCmp(a, b, true));
  }

  /** `HasLibrary( aNickname, aCheckEnabled )` (:1317-1325). */
  HasLibrary(aNickname: string, aCheckEnabled = false): boolean {
    const r = this.fetchIfLoaded(aNickname);

    if (r) return !aCheckEnabled || !r.row.Disabled();

    return false;
  }

  /** `GetLibraryDescription( aNickname )`: the loaded row's description. */
  GetLibraryDescription(aNickname: string): string | undefined {
    return this.fetchIfLoaded(aNickname)?.row.Description();
  }

  /**
   * `DeleteLibrary( aNickname )` (:1328-1350): the plugin's `DeleteLibrary` on
   * the row's URI; false on any failure.
   */
  DeleteLibrary(aNickname: string): boolean {
    const result = this.loadIfNeeded(aNickname);

    if (result.ok) {
      const plugin = result.value.plugin as { DeleteLibrary(aPath: string): boolean };

      try {
        return plugin.DeleteLibrary(this.getUri(result.value.row));
      } catch {
        return false;
      }
    }

    return false;
  }

  /** `getUri( aRow )` (:1643-1646): the row's URI, expanded against the open project. */
  protected getUri(aRow: LIBRARY_TABLE_ROW): string {
    return LIBRARY_MANAGER.ExpandURI(aRow.URI(), PgmOrNull()?.GetSettingsManager().Prj() ?? null);
  }

  /**
   * `loadIfNeeded( aNickname )` (:1753-1770, with `loadFromScope`): the library
   * already known, or its row (project first, then global) with a new plugin,
   * marked LOADING; "Library %s not found" when no table has it.
   */
  protected loadIfNeeded(aNickname: string): LIBRARY_RESULT<LIB_DATA> {
    const known = this.m_libraries.get(aNickname);

    if (known?.plugin) return { ok: true, value: known };

    for (const scope of [LIBRARY_TABLE_SCOPE.PROJECT, LIBRARY_TABLE_SCOPE.GLOBAL]) {
      const row = this.m_manager?.GetRow(this.Type(), aNickname, scope);

      if (row) {
        const plugin = this.createPlugin(row);

        if (!plugin.ok) return plugin;

        const lib: LIB_DATA = {
          plugin: plugin.value,
          row,
          status: { load_status: LOAD_STATUS.LOADING },
        };
        this.m_libraries.set(row.Nickname(), lib);
        return { ok: true, value: lib };
      }
    }

    return { ok: false, error: new LIBRARY_ERROR(`Library ${aNickname} not found`) };
  }

  /** `fetchIfLoaded`: the library, only when it loaded. */
  protected fetchIfLoaded(aNickname: string): LIB_DATA | undefined {
    const lib = this.m_libraries.get(aNickname);

    return lib?.status.load_status === LOAD_STATUS.LOADED ? lib : undefined;
  }
}
