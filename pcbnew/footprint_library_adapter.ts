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
import {
  type HOSTED_LIBRARY,
  hostedLibraryTable,
  LIBRARY_MANAGER,
  SetStockLibraryTable,
} from '@ziroeda/common/libraries/library_manager.js';
import {
  type LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import { Pgm, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import {
  wxDirEnumerate,
  wxDirExists,
  wxIsDirWritable,
  wxReadFileSync,
  wxRemoveFile,
  wxWriteFileSync,
} from '@ziroeda/wx/filefn.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { projectFpLibTable, projectLibraryNickname } from '@ziroeda/common/fp_lib_table.js';
import { DO_NOT_INCLUDE_NPTH, FOOTPRINT } from './footprint.js';
import type { FootprintIndexLibrary } from './footprint_info_impl.js';
import {
  FLIP_DIRECTION,
  FormatFootprintForLibrary,
  footprintSaveClone,
  ParseFootprintFile,
} from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

/** The `LIBRARY_TABLE_ROW` fields the callers read. */
export interface LIBRARY_TABLE_ROW {
  readonly nickname: string;
  readonly uri: string;
  readonly type: string;
  readonly enabled: boolean;
  /** `LIBRARY_TABLE_ROW::GetOptionsMap()`: the row's options column, parsed. */
  GetOptionsMap(): ReadonlyMap<string, string>;
  /** `LIBRARY_TABLE_ROW::Description()`; a host that has none omits it. */
  Description?(): string;
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

  /**
   * `FOOTPRINT_LIBRARY_ADAPTER::GetFootprintNames( aNickname, aBestEfforts )`
   * (footprint_library_adapter.h): the names a loaded library holds. Optional:
   * a host whose store cannot list a library omits it, and `CreateNewFootprint`
   * then infers no attributes, as its own `catch( ... )` does.
   */
  GetFootprintNames?(aNickname: string, aBestEfforts?: boolean): string[];

  /** `FOOTPRINT_LIBRARY_ADAPTER::LoadOne( aNickname )` (:55): load one library by nickname. */
  LoadOne(aNickname: string): void;

  /**
   * `LIBRARY_MANAGER_ADAPTER::ProjectTable()`: the project's footprint-library
   * table, null when the project has none.
   */
  ProjectTable(): LIBRARY_TABLE | null;

  /** `LIBRARY_MANAGER::GetFullURI( aRow, aSubstituted )`: the row's URI, expanded when asked. */
  GetFullURI(aRow: LIBRARY_TABLE_ROW, aSubstituted?: boolean): string;

  /**
   * `SaveFootprint( aNickname, aFootprint, aOverwrite )` (footprint_library_adapter.h:157):
   * SAVE_OK, or SAVE_SKIPPED when it was not written. Optional: a host that
   * only reads its libraries omits the write half.
   */
  SaveFootprint?(aNickname: string, aFootprint: FOOTPRINT, aOverwrite?: boolean): SAVE_T;

  /** `DeleteFootprint( aNickname, aFootprintName )` (:167). */
  DeleteFootprint?(aNickname: string, aFootprintName: string): void;

  /** `IsFootprintLibWritable( aNickname )` (:178). */
  IsFootprintLibWritable?(aNickname: string): boolean;

  /**
   * {@link LoadFootprint} for a library whose files are fetched on demand:
   * upstream every row is read when the adapter loads it, here a hosted
   * library's `.kicad_mod` arrives over the network the first time it is asked.
   */
  LoadFootprintAsync?(
    aNickname: string,
    aName: string,
    aKeepUUID: boolean,
  ): Promise<FOOTPRINT | null>;
}

/**
 * What a {@link FOOTPRINT_LIBRARY_STORE} asks of the program it runs in: the
 * hosted libraries' file text (the resident catalogue, else the hosted set —
 * `designer/`'s storage, which `pcbnew` never imports), `PCBNEW_SETTINGS::
 * m_FlipDirection`, and where a saved or deleted `.kicad_mod` goes.
 */
export interface FOOTPRINT_LIBRARY_STORE_IO {
  /** One hosted footprint's file text; rejects when it cannot be had. */
  footprintText(aNickname: string, aName: string): Promise<string>;
  /** `pcbnew.json`'s `editing.flip_left_right`, which `FootprintSave` reads. */
  flipLeftRight(): boolean;
  /** `PCB_IO_KICAD_SEXPR::FootprintSave`'s file write: `<dir>/<name>.kicad_mod`. */
  writeFootprintFile?(aLibraryDir: string, aFileName: string, aText: string): void;
  /** `PCB_IO_KICAD_SEXPR::FootprintDelete`'s `wxRemoveFile`. */
  removeFootprintFile?(aLibraryDir: string, aFileName: string): void;
}

/** One library row the store knows: its nickname, its `.pretty` and its files. */
export interface FOOTPRINT_LIBRARY_STORE_LIB {
  readonly nickname: string;
  /** The `.pretty` directory (the row's URI). */
  readonly dir: string;
  /**
   * Hosted libraries are read only (`FP_CACHE::IsWritable` is false for a
   * directory the user cannot write, as an installed library's is); the
   * project's and the ones made with New Library are not. A `user` library is
   * a row of the user's own global table naming a `.pretty` folder on a mounted
   * file system - the account's Footprints folder - read and written there.
   */
  readonly scope: 'global' | 'project' | 'user';
  /** Footprint names, known before any file is fetched (from index.json). */
  readonly names: string[];
  /** `.kicad_mod` text by footprint name, for the files fetched or written so far. */
  readonly texts: Map<string, string>;
}

/**
 * The browser's FOOTPRINT_LIBRARY_ADAPTER: the hosted global libraries and the
 * open project's `.pretty` folders, each a set of `.kicad_mod` files, read
 * with `PCB_IO_KICAD_SEXPR::FootprintLoad` and written with `FootprintSave`.
 *
 * Upstream the adapter sits over `LIBRARY_MANAGER`'s rows and a plugin per
 * row that reads the directory; here a row's files are text the host fetched
 * or the project carried. There is no buffer: a footprint is what its file
 * says, and the footprint editor's frame holds the one being edited.
 */
export class FOOTPRINT_LIBRARY_STORE implements FOOTPRINT_LIBRARY_ADAPTER {
  private readonly m_libs = new Map<string, FOOTPRINT_LIBRARY_STORE_LIB>();
  /**
   * `Prj().PinLibrary( nickname, PROJECT::LIB_TYPE_T::FOOTPRINT_LIB )` —
   * `LIBRARY_EDITOR_CONTROL::changeSelectedPinStatus`.
   */
  private readonly m_pinned = new Set<string>();
  /** The global libraries a project library of the same nickname hides, until it goes. */
  private readonly m_shadowed = new Map<string, FOOTPRINT_LIBRARY_STORE_LIB>();
  /** The hosted libraries' footprint names, from the index: the stock table's libraries. */
  private readonly m_hosted = new Map<string, readonly string[]>();
  /** The library manager's global footprint table the global libraries were last read from. */
  private m_globalTable: LIBRARY_TABLE | null | undefined = undefined;
  /** Bumped on every change, so a window can re-read the rows. */
  revision = 0;

  constructor(private readonly m_io: FOOTPRINT_LIBRARY_STORE_IO) {}

  private touch(): void {
    this.revision++;
  }

  /**
   * A hosted library by name, its files fetched on demand: one of the stock table's. Whether it is
   * listed is the global table's say (an unticked KiCad row, a disabled library), read in
   * {@link syncGlobal}; with no global table loaded, every hosted library is.
   */
  AddGlobalLibrary(aNickname: string, aNames: readonly string[]): void {
    if (this.m_hosted.has(aNickname)) return;

    this.m_hosted.set(aNickname, [...aNames]);
    // Read the global libraries again, with this one among the hosted.
    this.m_globalTable = undefined;
    this.touch();
  }

  /**
   * The global libraries, as `LIBRARY_MANAGER::Rows( FOOTPRINT, GLOBAL )` has them: read again
   * whenever the manager's global table is another (LoadGlobalTables replaces it, as the
   * library table dialog's OK does). A hosted row is listed with the index's names; a user row
   * naming a `.pretty` folder on a mounted file system is listed with the files in it. A disabled
   * row - or every row under a disabled KiCad chain row - is not listed at all.
   */
  private syncGlobal(): void {
    const manager = PgmOrNull()?.GetLibraryManager();
    const table = manager?.Table(LIBRARY_TABLE_TYPE.FOOTPRINT, LIBRARY_TABLE_SCOPE.GLOBAL) ?? null;

    if (table === this.m_globalTable) return;

    this.m_globalTable = table;

    const wanted = new Map<string, FOOTPRINT_LIBRARY_STORE_LIB>();
    const hosted = (aNickname: string, aNames: readonly string[]): FOOTPRINT_LIBRARY_STORE_LIB => {
      // A library already read keeps the files it fetched.
      const had = this.m_libs.get(aNickname) ?? this.m_shadowed.get(aNickname);

      return had?.scope === 'global'
        ? had
        : {
            nickname: aNickname,
            dir: `${aNickname}.pretty`,
            scope: 'global',
            names: [...aNames],
            texts: new Map(),
          };
    };

    if (!table || !manager) {
      for (const [nickname, names] of this.m_hosted) wanted.set(nickname, hosted(nickname, names));
    } else {
      for (const row of manager.Rows(LIBRARY_TABLE_TYPE.FOOTPRINT, LIBRARY_TABLE_SCOPE.GLOBAL)) {
        if (row.Disabled()) continue;

        const nickname = row.Nickname();

        if (isHostedFootprintLibraryRow(row)) {
          const names = this.m_hosted.get(nickname);

          if (names) wanted.set(nickname, hosted(nickname, names));
        } else if (row.Type() === 'KiCad' && wxDirExists(row.URI())) {
          const names = (wxDirEnumerate(row.URI()) ?? [])
            .filter((e) => !e.isDir && /\.kicad_mod$/i.test(e.name))
            .map((e) => fpNameOf(e.name));

          wanted.set(nickname, {
            nickname,
            dir: row.URI(),
            scope: 'user',
            names,
            texts: new Map(),
          });
        }
      }
    }

    // Out with the global libraries no row lists now, in with the ones listed, under any project
    // library of the same nickname.
    for (const [name, lib] of this.m_libs)
      if (lib.scope !== 'project' && !wanted.has(name)) this.m_libs.delete(name);

    for (const name of [...this.m_shadowed.keys()])
      if (!wanted.has(name)) this.m_shadowed.delete(name);

    for (const [name, lib] of wanted) {
      if (this.m_libs.get(name)?.scope === 'project') this.m_shadowed.set(name, lib);
      else this.m_libs.set(name, lib);
    }

    this.touch();
  }

  /** A footprint's file text if the store can read it now: held, or in a user library's folder. */
  private textNow(aLib: FOOTPRINT_LIBRARY_STORE_LIB, aName: string): string | undefined {
    let text = aLib.texts.get(aName);

    if (text === undefined && aLib.scope === 'user') {
      const data = wxReadFileSync(`${aLib.dir}/${aName}.kicad_mod`);

      if (data) {
        text = new TextDecoder().decode(data);
        aLib.texts.set(aName, text);
      }
    }

    return text;
  }

  /** A project library, from the `.kicad_mod` files of one of its `.pretty` folders. */
  AddProjectLibrary(
    aNickname: string,
    aDir: string,
    aEntries: readonly { fileName: string; text: string }[],
  ): void {
    const texts = new Map<string, string>();

    // FP_CACHE::Load: each file's name is the footprint's (`fn.GetName()`).
    for (const e of aEntries) texts.set(fpNameOf(e.fileName), e.text);

    // The project table's row is the one the nickname finds (LIBRARY_MANAGER::GetRow looks in
    // the project table first); the global library it shadows comes back with the project gone.
    const shadowed = this.m_libs.get(aNickname);
    if (shadowed?.scope === 'global') this.m_shadowed.set(aNickname, shadowed);

    this.m_libs.set(aNickname, {
      nickname: aNickname,
      dir: aDir,
      scope: 'project',
      names: [...texts.keys()],
      texts,
    });
    this.touch();
  }

  /**
   * The project's libraries, as `ProjectChanged` re-reads them: the closed project's go, and each
   * row of \a aFiles' `fp-lib-table` naming a `${KIPRJMOD}` `.pretty` is a library, with the
   * `.kicad_mod` files the project holds in that folder - none yet for a new one, which the
   * table's add button made and its first saved footprint fills.
   */
  SetProjectLibraries(aFiles: readonly { name: string; text: string }[]): void {
    this.DropProjectLibraries();

    const byDir = new Map<string, { fileName: string; text: string }[]>();

    for (const f of aFiles) {
      if (!/\.kicad_mod$/i.test(f.name)) continue;

      const norm = f.name.replace(/\\/g, '/');
      const m = /([^/]+)\.pretty\//i.exec(norm);
      const dir = m ? `${m[1]}.pretty` : norm.split('/').slice(0, -1).join('/') || 'Project';
      const list = byDir.get(dir) ?? [];
      list.push({ fileName: norm.split('/').pop()!, text: f.text });
      byDir.set(dir, list);
    }

    const libRows = projectFpLibTable(aFiles);

    for (const [dir, entries] of byDir) {
      const name = projectLibraryNickname(libRows, `${dir}/x.kicad_mod`);
      if (name) this.AddProjectLibrary(name, dir, entries);
    }

    for (const row of libRows) {
      const dir = /^\$[{(]KIPRJMOD[})]\/(?:.*\/)?([^/]+\.pretty)\/?$/i.exec(row.uri)?.[1];
      if (dir && !this.m_libs.has(row.name)) this.AddProjectLibrary(row.name, dir, []);
    }
  }

  /**
   * The libraries the store reads itself - the project's, and the user's own global ones - as the
   * chooser's index lists a library: each footprint's name, and the unique pad count, description
   * and keywords `FOOTPRINT_LIST::ReadFootprintFiles` reads off it (`FOOTPRINT_INFO_IMPL::load`).
   * Their footprints are files in hand, so all are read; the hosted set has its own index.
   */
  OwnIndex(): FootprintIndexLibrary[] {
    this.syncGlobal();

    const index: FootprintIndexLibrary[] = [];

    for (const lib of this.m_libs.values()) {
      if (lib.scope === 'global') continue;

      const footprints: string[] = [];
      const pads: number[] = [];
      const descr: string[] = [];
      const tags: string[] = [];

      for (const name of lib.names) {
        let fp: FOOTPRINT | null = null;

        try {
          fp = this.LoadFootprint(lib.nickname, name, false);
        } catch {
          // A file that does not parse is listed by name, as a failed load is.
        }

        footprints.push(name);
        pads.push(fp?.GetUniquePadCount(DO_NOT_INCLUDE_NPTH) ?? 0);
        descr.push(fp?.GetLibDescription() ?? '');
        tags.push(fp?.GetKeywords() ?? '');
      }

      index.push({ name: lib.nickname, footprints, pads, descr, tags });
    }

    return index;
  }

  /** `FOOTPRINT_EDIT_FRAME::ProjectChanged`: the closed project's rows go. */
  DropProjectLibraries(): void {
    for (const [name, lib] of this.m_libs) if (lib.scope === 'project') this.m_libs.delete(name);

    for (const [name, lib] of this.m_shadowed) this.m_libs.set(name, lib);

    this.m_shadowed.clear();

    this.touch();
  }

  /** `PCB_IO_KICAD_SEXPR::CreateLibrary`: an empty, writable `.pretty`. */
  CreateLibrary(aNickname: string): void {
    this.m_libs.set(aNickname, {
      nickname: aNickname,
      dir: `${aNickname}.pretty`,
      scope: 'project',
      names: [],
      texts: new Map(),
    });
    this.touch();
  }

  /** `GetLibraryNames()`: pinned libraries first, then the rest, each by name. */
  GetLibraryNames(): string[] {
    this.syncGlobal();

    const byName = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase());
    const all = [...this.m_libs.keys()];

    return [
      ...all.filter((n) => this.m_pinned.has(n)).sort(byName),
      ...all.filter((n) => !this.m_pinned.has(n)).sort(byName),
    ];
  }

  Library(aNickname: string): FOOTPRINT_LIBRARY_STORE_LIB | undefined {
    this.syncGlobal();
    return this.m_libs.get(aNickname);
  }

  IsPinned(aNickname: string): boolean {
    return this.m_pinned.has(aNickname);
  }

  SetPinned(aNickname: string, aPin: boolean): void {
    if (aPin) this.m_pinned.add(aNickname);
    else this.m_pinned.delete(aNickname);

    this.touch();
  }

  GetRow(aNickname: string): LIBRARY_TABLE_ROW | null {
    this.syncGlobal();

    const lib = this.m_libs.get(aNickname);

    if (!lib) return null;

    return {
      nickname: lib.nickname,
      uri: lib.dir,
      type: 'KiCad',
      enabled: true,
      GetOptionsMap: () => new Map(),
    };
  }

  HasLibrary(aNickname: string, _aCheckEnabled = false): boolean {
    this.syncGlobal();
    return this.m_libs.has(aNickname);
  }

  IsLibraryLoaded(aNickname: string): boolean {
    this.syncGlobal();
    return this.m_libs.has(aNickname);
  }

  /** Every library's names are known when it is added, so there is nothing to load. */
  LoadOne(_aNickname: string): void {}

  ProjectTable(): LIBRARY_TABLE | null {
    return null;
  }

  GetFullURI(aRow: LIBRARY_TABLE_ROW, _aSubstituted = false): string {
    return aRow.uri;
  }

  GetFootprintNames(aNickname: string, _aBestEfforts = false): string[] {
    this.syncGlobal();
    return [...(this.m_libs.get(aNickname)?.names ?? [])];
  }

  FootprintExists(aNickname: string, aName: string): boolean {
    this.syncGlobal();
    return this.m_libs.get(aNickname)?.names.includes(aName) ?? false;
  }

  /** The footprint's file text, fetching a hosted one the first time. */
  async FootprintText(aNickname: string, aName: string): Promise<string | null> {
    this.syncGlobal();

    const lib = this.m_libs.get(aNickname);

    if (!lib || !lib.names.includes(aName)) return null;

    let text = this.textNow(lib, aName);

    if (text === undefined && lib.scope === 'global') {
      try {
        text = await this.m_io.footprintText(aNickname, aName);
      } catch {
        return null;
      }

      lib.texts.set(aName, text);
    }

    return text ?? null;
  }

  /**
   * `LoadFootprint( aNickname, aName, aKeepUUID )`, for a file already in
   * hand: `FootprintLoad` parses it, the nickname is the row's, and a copy
   * that does not keep its UUIDs is a `Duplicate`.
   */
  LoadFootprint(aNickname: string, aName: string, aKeepUUID: boolean): FOOTPRINT | null {
    this.syncGlobal();

    const lib = this.m_libs.get(aNickname);
    const text = lib ? this.textNow(lib, aName) : undefined;

    if (text === undefined) return null;

    return this.footprintOf(aNickname, aName, text, aKeepUUID);
  }

  /** {@link LoadFootprint}, fetching a hosted file first. */
  async LoadFootprintAsync(
    aNickname: string,
    aName: string,
    aKeepUUID: boolean,
  ): Promise<FOOTPRINT | null> {
    const text = await this.FootprintText(aNickname, aName);

    if (text === null) return null;

    return this.footprintOf(aNickname, aName, text, aKeepUUID);
  }

  private footprintOf(
    aNickname: string,
    aName: string,
    aText: string,
    aKeepUUID: boolean,
  ): FOOTPRINT | null {
    let footprint: FOOTPRINT;

    try {
      footprint = ParseFootprintFile(aText, `${aNickname}:${aName}`);
    } catch {
      return null;
    }

    if (!aKeepUUID) footprint = footprint.Duplicate(false) as FOOTPRINT;

    footprint.SetParent(null);

    const id = footprint.GetFPID();
    footprint.SetFPID(new LIB_ID(aNickname, id.GetLibItemName() || aName));

    return footprint;
  }

  /** `IsFootprintLibWritable( aNickname )`. */
  IsFootprintLibWritable(aNickname: string): boolean {
    this.syncGlobal();

    const lib = this.m_libs.get(aNickname);

    if (lib?.scope === 'user') return wxIsDirWritable(lib.dir);

    return lib?.scope === 'project';
  }

  /**
   * `SaveFootprint( aNickname, aFootprint, aOverwrite )` ->
   * `PCB_IO_KICAD_SEXPR::FootprintSave`: a clone, at orientation zero on the
   * front, detached, written as `<item name>.kicad_mod`. SAVE_SKIPPED when
   * the library is unknown or read only, or `!aOverwrite` and it exists.
   */
  SaveFootprint(aNickname: string, aFootprint: FOOTPRINT, aOverwrite = true): SAVE_T {
    this.syncGlobal();

    const lib = this.m_libs.get(aNickname);

    if (!lib) return SAVE_T.SAVE_SKIPPED;

    const footprintName = aFootprint.GetFPID().GetLibItemName();

    if (!aOverwrite && lib.names.includes(footprintName)) return SAVE_T.SAVE_SKIPPED;

    // FootprintSave throws "Library '%s' is read only."; the adapter catches
    // every IO_ERROR it raises and answers SAVE_SKIPPED.
    if (!this.IsFootprintLibWritable(aNickname)) return SAVE_T.SAVE_SKIPPED;

    // I need my own copy for the cache
    const footprint = FOOTPRINT.copyOfFootprint(aFootprint);
    footprintSaveClone(
      footprint,
      this.m_io.flipLeftRight() ? FLIP_DIRECTION.LEFT_RIGHT : FLIP_DIRECTION.TOP_BOTTOM,
    );

    const text = FormatFootprintForLibrary(footprint);

    lib.texts.set(footprintName, text);

    if (!lib.names.includes(footprintName)) lib.names.push(footprintName);

    // A user library's folder is a mounted one: FootprintSave's write, there.
    if (lib.scope === 'user')
      wxWriteFileSync(`${lib.dir}/${footprintName}.kicad_mod`, new TextEncoder().encode(text));
    else this.m_io.writeFootprintFile?.(lib.dir, `${footprintName}.kicad_mod`, text);

    this.touch();

    return SAVE_T.SAVE_OK;
  }

  /** `DeleteFootprint( aNickname, aFootprintName )` -> `FootprintDelete`. */
  DeleteFootprint(aNickname: string, aFootprintName: string): void {
    this.syncGlobal();

    const lib = this.m_libs.get(aNickname);

    if (!lib) return;

    // FootprintDelete throws "Library '%s' is read only." and FP_CACHE::Remove
    // "Library '%s' has no footprint '%s'."; the adapter catches both.
    if (!this.IsFootprintLibWritable(aNickname) || !lib.names.includes(aFootprintName)) return;

    lib.names.splice(lib.names.indexOf(aFootprintName), 1);
    lib.texts.delete(aFootprintName);

    if (lib.scope === 'user') wxRemoveFile(`${lib.dir}/${aFootprintName}.kicad_mod`);
    else this.m_io.removeFootprintFile?.(lib.dir, `${aFootprintName}.kicad_mod`);
    this.touch();
  }
}

/**
 * The stock table's row URI for a hosted library. Its files are fetched by nickname, never read
 * at a path; the folder only marks the row as the hosted set's.
 */
export const FOOTPRINT_HOSTED_DIR = '/.kicad-footprints';

export function hostedFootprintLibraryUri(aNickname: string): string {
  return `${FOOTPRINT_HOSTED_DIR}/${aNickname}.pretty`;
}

/** Whether \a aRow is a hosted library's: its URI is in the hosted folder. */
export function isHostedFootprintLibraryRow(aRow: { URI(): string }): boolean {
  return aRow.URI().startsWith(`${FOOTPRINT_HOSTED_DIR}/`);
}

/**
 * The program's global footprint table, as PGM_BASE has it from the start (`LoadGlobalTables`,
 * kicad.cpp): the hosted set is the stock table, and the user's global table chains it - written
 * with that one row the first time, the first-run dialog's default (`CreateGlobalTable( FOOTPRINT,
 * true )`). With nowhere to keep a user table (no settings path mounted), the stock table is the
 * global one. LoadGlobalSymbolTables' footprint twin.
 */
export function LoadGlobalFootprintTables(aHosted: readonly HOSTED_LIBRARY[]): void {
  const FOOTPRINT = LIBRARY_TABLE_TYPE.FOOTPRINT;
  const manager = Pgm().GetLibraryManager();

  // The index lists every hosted library; one the user's tables already name is theirs.
  const ownRows = new Set(
    manager
      .Rows(FOOTPRINT)
      .filter((r) => !isHostedFootprintLibraryRow(r))
      .map((r) => r.Nickname()),
  );
  const stock = hostedLibraryTable(
    FOOTPRINT,
    aHosted.filter((l) => !ownRows.has(l.name)),
    hostedFootprintLibraryUri,
  );

  SetStockLibraryTable(FOOTPRINT, stock);

  if (!LIBRARY_MANAGER.IsTableValid(LIBRARY_MANAGER.DefaultGlobalTablePath(FOOTPRINT)))
    LIBRARY_MANAGER.CreateGlobalTable(FOOTPRINT, true);

  manager.LoadGlobalTables([FOOTPRINT]);

  if (!manager.Table(FOOTPRINT, LIBRARY_TABLE_SCOPE.GLOBAL))
    manager.SetTable(FOOTPRINT, LIBRARY_TABLE_SCOPE.GLOBAL, stock);
}

/** `FOOTPRINT_LIBRARY_ADAPTER::SAVE_T`. */
export enum SAVE_T {
  SAVE_OK,
  SAVE_SKIPPED,
}

/** A footprint's name is the `.kicad_mod` basename (its FPID item name). */
export const fpNameOf = (aPath: string): string =>
  aPath
    .split('/')
    .pop()!
    .split('\\')
    .pop()!
    .replace(/\.kicad_mod$/i, '');
