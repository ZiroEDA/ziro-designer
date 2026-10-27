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
 * Not here: the global tables' loading and the async loads. Project tables
 * load through `LoadProjectTables`; footprint and symbol libraries still
 * resolve through the editors' own stores (`common/fp_lib_table.ts`'s plain
 * records), not through this class (design blocks are the one caller of `Rows`). Upstream keeps a second, process-wide map for
 * the global libraries (`globalLibs()`); an adapter here has the one map,
 * which is where both scopes' statuses are looked up in the same order.
 */
import { ExpandEnvVarSubstitutions } from '../common.js';
import { strNumCmp } from '../string_utils.js';
import { PgmOrNull } from '../pgm_base.js';
import {
  MEMORY_FILESYSTEM,
  wxFileExists,
  wxMountFileSystem,
  wxNormalizePath,
  wxReadFileSync,
  wxWriteFileSync,
} from '@ziroeda/wx/filefn.js';
import { PATHS } from '../paths.js';
import type { PROJECT } from '../project.js';
import type { KICAD_SETTINGS } from '../settings/kicad_settings.js';
import {
  LIBRARY_ERROR,
  type LIBRARY_RESULT,
  LIBRARY_TABLE,
  LIBRARY_TABLE_OK,
  LIBRARY_TABLE_ROW,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from './library_table.js';

/**
 * `LIBRARY_MANAGER` (common/libraries/library_manager.{h,cpp}), the part an
 * adapter asks: the global and project tables by type, their rows merged
 * (`Rows`, a project row overriding a global one of the same nickname), one
 * row by nickname, and a row's URI expanded. The tables themselves are loaded
 * by the host (a page reads the project's and the hosted global tables),
 * handed over with `SetTable`.
 *
 * A `Table` row names another table file, whose libraries count as the row's
 * table's own (`loadNestedTables`, `Rows`): how KiCad 10's global table chains
 * the stock one.
 */
/** `GetAppSettings<KICAD_SETTINGS>( "kicad" )`. */
const kicadSettings = (): KICAD_SETTINGS | null =>
  PgmOrNull()?.GetSettingsManager().GetAppSettings<KICAD_SETTINGS>('kicad') ?? null;

export class LIBRARY_MANAGER {
  private readonly m_tables = new Map<LIBRARY_TABLE_TYPE, LIBRARY_TABLE>();
  private readonly m_projectTables = new Map<LIBRARY_TABLE_TYPE, LIBRARY_TABLE>();
  private readonly m_adapters = new Map<LIBRARY_TABLE_TYPE, LIBRARY_MANAGER_ADAPTER>();
  /** `m_childTables`: each nested table, by the URI of the `Table` row that names it. */
  private readonly m_childTables = new Map<string, LIBRARY_TABLE>();

  /** `RegisterAdapter( aType, aAdapter )`: once per type. */
  RegisterAdapter(aType: LIBRARY_TABLE_TYPE, aAdapter: LIBRARY_MANAGER_ADAPTER): void {
    // wxCHECK_MSG: "You should only register an adapter once!"
    if (this.m_adapters.has(aType)) return;

    this.m_adapters.set(aType, aAdapter);
  }

  /** `RemoveAdapter( aType, aAdapter )`: only the adapter registered for the type. */
  RemoveAdapter(aType: LIBRARY_TABLE_TYPE, aAdapter: LIBRARY_MANAGER_ADAPTER): boolean {
    if (this.m_adapters.get(aType) !== aAdapter) return false;

    this.m_adapters.delete(aType);
    return true;
  }

  /** `Adapter( aType )`: the registered adapter, if any. */
  Adapter(aType: LIBRARY_TABLE_TYPE): LIBRARY_MANAGER_ADAPTER | undefined {
    return this.m_adapters.get(aType);
  }

  /** `tableFileName( aType )` (library_manager.cpp:268-283): the FILEEXT table file name. [data] */
  static TableFileName(aType: LIBRARY_TABLE_TYPE): string {
    switch (aType) {
      case LIBRARY_TABLE_TYPE.SYMBOL:
        return 'sym-lib-table';
      case LIBRARY_TABLE_TYPE.FOOTPRINT:
        return 'fp-lib-table';
      case LIBRARY_TABLE_TYPE.DESIGN_BLOCK:
        return 'design-block-lib-table';
      default:
        return '';
    }
  }

  /**
   * `LoadProjectTables( aProjectPath, aTablesToLoad )` (library_manager.cpp:893-935): each
   * named table (all three when none is named) read from the project directory, replacing the
   * project table of that type; a table file that is missing, or of another type, leaves none.
   * The adapters drop their project libraries first and reconcile after, as upstream's two
   * phases do. Nested tables are not followed (see the class comment).
   */
  LoadProjectTables(aProjectPath: string, aTablesToLoad: readonly LIBRARY_TABLE_TYPE[] = []): void {
    for (const adapter of this.m_adapters.values()) adapter.ProjectTablesChanged(aTablesToLoad);

    const types =
      aTablesToLoad.length === 0
        ? [LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_TYPE.FOOTPRINT, LIBRARY_TABLE_TYPE.DESIGN_BLOCK]
        : aTablesToLoad;

    this.loadTables(aProjectPath, LIBRARY_TABLE_SCOPE.PROJECT, types);

    for (const adapter of this.m_adapters.values()) adapter.ProjectTablesReloaded(aTablesToLoad);
  }

  /**
   * `loadTables( aTablePath, aScope, aTablesToLoad )` (library_manager.cpp:85-136): each named table
   * read from \a aTablePath into the scope's tables, replacing the one there; a missing file leaves
   * none, and a table of another type is skipped. Each loaded table's nested tables follow.
   */
  private loadTables(
    aTablePath: string,
    aScope: LIBRARY_TABLE_SCOPE,
    aTablesToLoad: readonly LIBRARY_TABLE_TYPE[],
  ): void {
    const target = aScope === LIBRARY_TABLE_SCOPE.PROJECT ? this.m_projectTables : this.m_tables;

    for (const type of aTablesToLoad) {
      target.delete(type);

      const fn = `${aTablePath.replace(/\/+$/, '')}/${LIBRARY_MANAGER.TableFileName(type)}`;

      if (!wxFileExists(fn)) continue;

      const bytes = wxReadFileSync(fn);

      if (!bytes) continue;

      const table = LIBRARY_TABLE.FromFile(fn, new TextDecoder().decode(bytes), aScope);

      // "Library table '%s' has type %s but expected %s; skipping"
      if (table.Type() !== type) {
        console.warn(
          `Library table '${fn}' has type ${table.Type()} but expected ${type}; skipping`,
        );
        continue;
      }

      target.set(type, table);
      this.loadNestedTables(table);
    }
  }

  /** `DefaultGlobalTablePath( aType )` (:437-445): the user's global table, in the settings path. */
  static DefaultGlobalTablePath(aType: LIBRARY_TABLE_TYPE): string {
    return `${PATHS.GetUserSettingsPath().replace(/\/+$/, '')}/${LIBRARY_MANAGER.TableFileName(aType)}`;
  }

  /** `StockTablePath( aType )` (:448-456): the table installed with the stock libraries. */
  static StockTablePath(aType: LIBRARY_TABLE_TYPE): string {
    return `${PATHS.GetStockTemplatesPath().replace(/\/+$/, '')}/${LIBRARY_MANAGER.TableFileName(aType)}`;
  }

  /**
   * `StockTableReferenceURI( aType )` (:467-484): how a global table names the stock one. Only a
   * relocatable install stores the template-dir token; this one is never relocated, so the path.
   */
  static StockTableReferenceURI(aType: LIBRARY_TABLE_TYPE): string {
    return LIBRARY_MANAGER.StockTablePath(aType);
  }

  /** `IsTableValid( aPath )` (:487-500): a readable table that parses. */
  static IsTableValid(aPath: string): boolean {
    const bytes = wxReadFileSync(aPath);

    if (!bytes) return false;

    return LIBRARY_TABLE.FromFile(
      aPath,
      new TextDecoder().decode(bytes),
      LIBRARY_TABLE_SCOPE.GLOBAL,
    ).IsOk();
  }

  /**
   * `CreateGlobalTable( aType, aPopulateDefaultLibraries )` (:526-563): the user's global table
   * written fresh - empty, or with one row, "KiCad", chained to the stock table.
   */
  static CreateGlobalTable(aType: LIBRARY_TABLE_TYPE, aPopulateDefaultLibraries: boolean): boolean {
    const fn = LIBRARY_MANAGER.DefaultGlobalTablePath(aType);
    const table = LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.GLOBAL, aType);
    table.SetPath(fn);

    if (!wxFileExists(LIBRARY_MANAGER.StockTablePath(aType)))
      console.debug(
        `Warning: couldn't read default library table for ${aType} at '${LIBRARY_MANAGER.StockTablePath(aType)}'`,
      );

    if (aPopulateDefaultLibraries) {
      const chained = table.InsertRow();
      chained.SetType(LIBRARY_TABLE_ROW.TABLE_TYPE_NAME);
      chained.SetNickname('KiCad');
      chained.SetDescription('KiCad Default Libraries');
      chained.SetURI(LIBRARY_MANAGER.StockTableReferenceURI(aType));
    }

    return wxWriteFileSync(fn, new TextEncoder().encode(table.FormatForSave()));
  }

  /**
   * `LoadGlobalTables( aTablesToLoad )` (:566-580): the user's global tables read from the settings
   * path (all three when none is named), their nested tables with them.
   */
  LoadGlobalTables(aTablesToLoad: readonly LIBRARY_TABLE_TYPE[] = []): void {
    this.loadTables(
      PATHS.GetUserSettingsPath(),
      LIBRARY_TABLE_SCOPE.GLOBAL,
      aTablesToLoad.length === 0
        ? [LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_TYPE.FOOTPRINT, LIBRARY_TABLE_TYPE.DESIGN_BLOCK]
        : aTablesToLoad,
    );
  }

  /**
   * `ProjectChanged()` (library_manager.cpp:655-668): the active project changed, so its tables
   * are read from its directory and every adapter drops what it had loaded from the old one.
   * `SETTINGS_MANAGER::LoadProject` calls it for an active project.
   */
  ProjectChanged(): void {
    // Abort any running async library loads before reloading project tables.
    this.AbortAsyncLoads();

    const pgm = PgmOrNull();

    if (pgm) this.LoadProjectTables(pgm.GetSettingsManager().Prj().GetProjectDirectory());

    for (const adapter of this.m_adapters.values()) adapter.ProjectChanged();
  }

  /** `AbortAsyncLoads()` (:671-677). */
  AbortAsyncLoads(): void {
    for (const adapter of this.m_adapters.values()) adapter.AbortAsyncLoad();
  }

  /** Install (or with null, drop) the table of \a aType in \a aScope. */
  SetTable(
    aType: LIBRARY_TABLE_TYPE,
    aScope: LIBRARY_TABLE_SCOPE,
    aTable: LIBRARY_TABLE | null,
  ): void {
    const map = aScope === LIBRARY_TABLE_SCOPE.PROJECT ? this.m_projectTables : this.m_tables;

    if (aTable) {
      map.set(aType, aTable);
      this.loadNestedTables(aTable);
    } else {
      map.delete(aType);
    }
  }

  /**
   * `loadNestedTables( aRootTable )` (library_manager.cpp:139-189): every `Table` row's file read
   * into m_childTables, and theirs in turn. A table already met on the way marks the row that
   * names it again, and a child that does not load marks its row with the child's error.
   */
  private loadNestedTables(aRootTable: LIBRARY_TABLE): void {
    const seenTables = new Set<string>();

    const processOneTable = (aTable: LIBRARY_TABLE): void => {
      seenTables.add(aTable.Path());

      if (!aTable.IsOk()) return;

      for (const row of aTable.Rows()) {
        if (row.Type() !== LIBRARY_TABLE_ROW.TABLE_TYPE_NAME) continue;

        let file = LIBRARY_MANAGER.ExpandURI(
          row.URI(),
          PgmOrNull()?.GetSettingsManager().Prj() ?? null,
        );

        // URI may be relative to parent
        if (!file.startsWith('/')) {
          const parent = aTable.Path();
          file = `${parent.slice(0, parent.lastIndexOf('/'))}/${file}`;
        }

        if (seenTables.has(file)) {
          row.SetOk(false);
          row.SetErrorDescription('A reference to this library table already exists');
          continue;
        }

        const bytes = wxReadFileSync(file);
        const child = LIBRARY_TABLE.FromFile(
          file,
          bytes ? new TextDecoder().decode(bytes) : null,
          aRootTable.Scope(),
        );

        processOneTable(child);

        if (!child.IsOk()) {
          row.SetOk(false);
          row.SetErrorDescription(child.ErrorDescription());
        }

        this.applyLibOverrides(child);

        this.m_childTables.set(row.URI(), child);
      }
    };

    processOneTable(aRootTable);
  }

  /**
   * `ApplyLibOverrides( aTable )`: the Enable / Show the user gave a read-only table's rows,
   * from the `kicad` settings' `libraries.overrides`, keyed by the table's path.
   */
  ApplyLibOverrides(aTable: LIBRARY_TABLE): void {
    if (!aTable.IsReadOnly()) return;

    const settings = kicadSettings();

    if (!settings) return;

    const overrides = settings.m_LibOverrides.get(aTable.Path());

    if (!overrides) return;

    for (const row of aTable.Rows()) {
      const over = overrides.get(row.Nickname());

      if (over) {
        row.SetDisabled(over.disabled);
        row.SetHidden(over.hidden);
      }
    }
  }

  private applyLibOverrides(aTable: LIBRARY_TABLE): void {
    this.ApplyLibOverrides(aTable);
  }

  /** `SetLibOverride( aTablePath, aNickname, aDisabled, aHidden )`. */
  SetLibOverride(
    aTablePath: string,
    aNickname: string,
    aDisabled: boolean,
    aHidden: boolean,
  ): void {
    const settings = kicadSettings();

    if (!settings) return; // wxCHECK

    if (!aDisabled && !aHidden) {
      this.ClearLibOverride(aTablePath, aNickname);
      return;
    }

    let libs = settings.m_LibOverrides.get(aTablePath);

    if (!libs) {
      libs = new Map();
      settings.m_LibOverrides.set(aTablePath, libs);
    }

    libs.set(aNickname, { disabled: aDisabled, hidden: aHidden });
  }

  /** `ClearLibOverride( aTablePath, aNickname )`. */
  ClearLibOverride(aTablePath: string, aNickname: string): void {
    const settings = kicadSettings();

    if (!settings) return; // wxCHECK

    const libs = settings.m_LibOverrides.get(aTablePath);

    if (!libs) return;

    libs.delete(aNickname);
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

    // The tables on the current path. Upstream recurses without one, so a row loadNestedTables
    // marked for naming a table already met - which keeps that table's URI in m_childTables, under
    // the row that loaded it - leads back into it forever once invalid rows are asked for.
    const onPath = new Set<LIBRARY_TABLE>();

    const processTable = (aTable: LIBRARY_TABLE | undefined, parentHidden: boolean): void => {
      if (!aTable || aTable.Type() !== aType || onPath.has(aTable)) return;

      if (!aTable.IsOk() && !aIncludeInvalid) return;

      onPath.add(aTable);

      for (const row of aTable.Rows()) {
        if (!row.IsOk() && !aIncludeInvalid) continue;

        // Hide child row if parent is hidden
        if (parentHidden) row.SetHidden(true);

        if (row.Type() === LIBRARY_TABLE_ROW.TABLE_TYPE_NAME) {
          const child = this.m_childTables.get(row.URI());

          if (!child) continue;

          // Don't include libraries from disabled nested tables
          if (row.Disabled()) continue;

          processTable(child, row.Hidden());
        } else {
          if (!rows.has(row.Nickname())) rowOrder.push(row.Nickname());

          rows.set(row.Nickname(), row);
        }
      }

      onPath.delete(aTable);
    };

    for (const table of tables) processTable(table, false);

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

  /**
   * `FindRowByURI( aType, aUri, aScope )` (:861-872): the row, invalid ones included, whose
   * substituted URI names the same library as \a aUri.
   */
  FindRowByURI(
    aType: LIBRARY_TABLE_TYPE,
    aUri: string,
    aScope: LIBRARY_TABLE_SCOPE = LIBRARY_TABLE_SCOPE.BOTH,
  ): LIBRARY_TABLE_ROW | null {
    for (const row of this.Rows(aType, aScope, true)) {
      if (LIBRARY_MANAGER.UrisAreEquivalent(this.GetFullURI(row, true), aUri)) return row;
    }

    return null;
  }

  /** `ExpandURI( aShortURI, aProject )` (:972-979): variables expanded against the project. */
  static ExpandURI(aShortURI: string, aProject: PROJECT | null): string {
    return ExpandEnvVarSubstitutions(
      aShortURI,
      aProject ? (token) => aProject.TextVarResolver(token) : null,
    );
  }

  /**
   * `GetFullURI( aType, aNickname, aSubstituted )` (:953): the URI of \a aNickname's row, or null
   * when there is none; and `GetFullURI( aRow, aSubstituted )` (:963).
   */
  GetFullURI(aType: LIBRARY_TABLE_TYPE, aNickname: string, aSubstituted?: boolean): string | null;
  GetFullURI(aRow: LIBRARY_TABLE_ROW, aSubstituted?: boolean): string;
  GetFullURI(
    a: LIBRARY_TABLE_TYPE | LIBRARY_TABLE_ROW,
    b: string | boolean = false,
    c = false,
  ): string | null {
    if (typeof b === 'string') {
      const result = this.GetRow(a as LIBRARY_TABLE_TYPE, b);

      if (result) return this.GetFullURI(result, c);

      return null;
    }

    const aRow = a as LIBRARY_TABLE_ROW;
    const aSubstituted = b;

    if (!aSubstituted) return aRow.URI();

    return LIBRARY_MANAGER.ExpandURI(aRow.URI(), PgmOrNull()?.GetSettingsManager().Prj() ?? null);
  }

  /**
   * `UrisAreEquivalent( aURI1, aURI2 )` (:1058-1078): a URL compared as text, a file name as
   * `wxFileName ==` compares one - both normalized against the working directory.
   */
  static UrisAreEquivalent(aURI1: string, aURI2: string): boolean {
    // Avoid comparing filenames as wxURIs
    if (aURI1.includes('://')) {
      // found as full path
      return aURI1 === aURI2;
    }

    // found as full path and file name
    return wxNormalizePath(aURI1) === wxNormalizePath(aURI2);
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
  /** The plugin's modify hash when `available_fields_cache` was filled. */
  modify_hash?: number;
  available_fields_cache?: string[];
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

  /**
   * `ProjectTablesChanged( aChangedTables )` (library_manager.cpp:1157-1174): before the
   * project tables are replaced, `resetProjectCache` drops the libraries loaded from them.
   */
  ProjectTablesChanged(aChangedTables: readonly LIBRARY_TABLE_TYPE[]): void {
    if (aChangedTables.length > 0 && !aChangedTables.includes(this.Type())) return;

    for (const nickname of [...this.m_libraries.keys()]) {
      if (this.m_manager?.GetRow(this.Type(), nickname, LIBRARY_TABLE_SCOPE.PROJECT))
        this.m_libraries.delete(nickname);
    }
  }

  /**
   * `ProjectChanged()` (library_manager.cpp:1103-1106): `resetProjectCache()`, which drops the
   * libraries loaded from the project tables. Upstream resets them in place and keeps the
   * global libraries in a second map; this adapter has one map, so the project's entries are
   * erased, as `ProjectTablesChanged` does.
   */
  ProjectChanged(): void {
    this.abortLoad();

    for (const nickname of [...this.m_libraries.keys()]) {
      if (this.m_manager?.GetRow(this.Type(), nickname, LIBRARY_TABLE_SCOPE.PROJECT))
        this.m_libraries.delete(nickname);
    }
  }

  /** `AbortAsyncLoad()` (:1126-1129). */
  AbortAsyncLoad(): void {
    this.abortLoad();
  }

  /**
   * `AsyncLoad()` (library_manager.cpp:1796-1960): load every row of this adapter's type that is
   * not disabled and not already LOADED or LOADING, which is what `IFACE::PreloadLibraries` runs
   * when a project opens and what `fetchIfLoaded` (so `LoadSymbol`) then depends on.
   *
   * Upstream resolves each row's URI on the calling thread and hands the loads to the thread
   * pool, reporting progress through `AsyncLoadProgress`. Here they run in turn on the caller's
   * thread: the rows reach this adapter as files already in memory (a project's own libraries),
   * and the hosted set loads through its own worker preload.
   */
  AsyncLoad(): void {
    if (!this.m_manager) return;

    for (const row of this.m_manager.Rows(this.Type())) {
      // Disabled libraries must never be contacted
      if (row.Disabled()) continue;

      const status = this.m_libraries.get(row.Nickname())?.status.load_status;

      if (status === LOAD_STATUS.LOADED || status === LOAD_STATUS.LOADING) continue;

      const result = this.loadIfNeeded(row.Nickname());

      if (result.ok) this.LoadOne(result.value);
    }
  }

  /**
   * `ProjectTablesReloaded( aChangedTables )` (:1177-1209): upstream erases the sentinels
   * `resetProjectCache` left; this adapter keeps one map and leaves none, so there is nothing
   * to reconcile.
   */
  ProjectTablesReloaded(_aChangedTables: readonly LIBRARY_TABLE_TYPE[]): void {}

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

  /**
   * `FindRowByURI( aUri, aScope )` (:1376-1381): LIBRARY_MANAGER::FindRowByURI filtered to this
   * adapter's type.
   */
  FindRowByURI(
    aUri: string,
    aScope: LIBRARY_TABLE_SCOPE = LIBRARY_TABLE_SCOPE.BOTH,
  ): LIBRARY_TABLE_ROW | null {
    return this.m_manager?.FindRowByURI(this.Type(), aUri, aScope) ?? null;
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

  /** `ProjectTable()`: this type's project library table, if there is one. */
  ProjectTable(): LIBRARY_TABLE | null {
    return this.m_manager?.Table(this.Type(), LIBRARY_TABLE_SCOPE.PROJECT) ?? null;
  }

  /** `GetRow( aNickname, aScope )` (:1369-1373): this type's row of that nickname. */
  GetRow(
    aNickname: string,
    aScope: LIBRARY_TABLE_SCOPE = LIBRARY_TABLE_SCOPE.BOTH,
  ): LIBRARY_TABLE_ROW | null {
    return this.m_manager?.GetRow(this.Type(), aNickname, aScope) ?? null;
  }

  /** `IsWritable( aNickname )` (:1592-1606): the loaded library's plugin says it can be written. */
  IsWritable(aNickname: string): boolean {
    const rowData = this.fetchIfLoaded(aNickname);

    if (rowData) {
      const plugin = rowData.plugin as { IsLibraryWritable(aPath: string): boolean };

      return plugin.IsLibraryWritable(this.getUri(rowData.row));
    }

    return false;
  }

  /** `CreateLibrary( aNickname )` (:1609-1640): the plugin makes the row's (empty) library. */
  CreateLibrary(aNickname: string): boolean {
    const result = this.loadIfNeeded(aNickname);

    if (result.ok) {
      const data = result.value;
      const options = data.row.GetOptionsMap();
      const plugin = data.plugin as {
        CreateLibrary(aPath: string, aProperties: ReadonlyMap<string, string>): void;
      };

      try {
        plugin.CreateLibrary(this.getUri(data.row), options);
        return true;
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

  /**
   * `ReloadLibraryEntry( aNickname, aScope )` (library_manager.cpp:1537): forget a library
   * that had been loaded and make its entry again from the table, so the next use reads the
   * library afresh (after its file was rewritten). Upstream keeps the project and global
   * libraries in two maps and reloads from the scope asked; ours are one map, so the entry is
   * remade from the first of the asked scopes that has the row.
   */
  ReloadLibraryEntry(
    aNickname: string,
    aScope: LIBRARY_TABLE_SCOPE = LIBRARY_TABLE_SCOPE.BOTH,
  ): void {
    // Drain the async load before erasing.
    this.abortLoad();

    const known = this.m_libraries.get(aNickname);

    if (!known?.plugin) return; // nothing was loaded: nothing to reload

    this.m_libraries.delete(aNickname);

    const scopes =
      aScope === LIBRARY_TABLE_SCOPE.GLOBAL
        ? [LIBRARY_TABLE_SCOPE.GLOBAL]
        : aScope === LIBRARY_TABLE_SCOPE.PROJECT
          ? [LIBRARY_TABLE_SCOPE.PROJECT]
          : [LIBRARY_TABLE_SCOPE.PROJECT, LIBRARY_TABLE_SCOPE.GLOBAL];

    for (const scope of scopes) {
      const row = this.m_manager?.GetRow(this.Type(), aNickname, scope);

      if (!row) continue;

      const plugin = this.createPlugin(row);

      if (!plugin.ok) return; // wxLogTrace: failed to reload

      this.m_libraries.set(row.Nickname(), {
        plugin: plugin.value,
        row,
        status: { load_status: LOAD_STATUS.LOADING },
      });
      return;
    }
  }

  /** `fetchIfLoaded`: the library, only when it loaded. */
  protected fetchIfLoaded(aNickname: string): LIB_DATA | undefined {
    const lib = this.m_libraries.get(aNickname);

    return lib?.status.load_status === LOAD_STATUS.LOADED ? lib : undefined;
  }
}

/**
 * The stock library tables: what a KiCad install puts at `PATHS::GetStockTemplatesPath()`
 * (StockTablePath above), the tables of the libraries that ship with it, which a user's global
 * table chains (`CreateGlobalTable`). Here the libraries that ship are the hosted set, known once the
 * program has fetched its index; the program writes each stock table then, into a read-only memory
 * file system at that path, and the global tables read them from there.
 */
let s_stock: MEMORY_FILESYSTEM | null = null;

/** The hosted library set as a LIBRARY_TABLE: read-only, "KiCad" rows. */
export function hostedLibraryTable(
  aType: LIBRARY_TABLE_TYPE,
  aNames: readonly string[],
  aUriOf: (aName: string) => string,
): LIBRARY_TABLE {
  const table = LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.GLOBAL, aType);

  for (const name of aNames) {
    const row = table.InsertRow();
    row.SetNickname(name);
    row.SetType('KiCad');
    row.SetURI(aUriOf(name));
  }

  table.SetReadOnly();
  return table;
}

/** The stock table of \a aType, as the install would have it: \a aTable's text at its path. */
export function SetStockLibraryTable(aType: LIBRARY_TABLE_TYPE, aTable: LIBRARY_TABLE): void {
  if (!s_stock) {
    s_stock = new MEMORY_FILESYSTEM();
    // An install path: KiCad's code reads it and never writes it.
    s_stock.ReadOnly = true;
    wxMountFileSystem(PATHS.GetStockTemplatesPath(), s_stock);
  }

  s_stock.Write(
    LIBRARY_MANAGER.TableFileName(aType),
    new TextEncoder().encode(aTable.FormatForSave()),
  );
}
