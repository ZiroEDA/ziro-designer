// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DESIGN_BLOCK_LIBRARY_ADAPTER` (common/design_block_library_adapter.{h,cpp}):
 * the design block libraries of the project's and the global
 * `design-block-lib-table`, through `LIBRARY_MANAGER_ADAPTER` — which rows are
 * loaded, and the design blocks in each, read and written through
 * `DESIGN_BLOCK_IO`.
 *
 * Upstream keeps the global libraries in a second, process-wide map; this
 * port's adapter base keeps one map and looks a nickname up project-first, as
 * `loadIfNeeded` does.
 */
import type { DESIGN_BLOCK } from './design_block.js';
import {
  DESIGN_BLOCK_FILE_T,
  type DESIGN_BLOCK_IO,
  DESIGN_BLOCK_IO_MGR,
} from './design_block_io.js';
import { IO_ERROR } from './exceptions.js';
import type { LIB_ID } from './lib_id.js';
import {
  type LIB_DATA,
  type LIB_STATUS,
  LIBRARY_MANAGER_ADAPTER,
  type LIBRARY_MANAGER,
  LOAD_STATUS,
} from './libraries/library_manager.js';
import {
  LIBRARY_ERROR,
  type LIBRARY_RESULT,
  LIBRARY_TABLE_OK,
  type LIBRARY_TABLE_ROW,
  LIBRARY_TABLE_TYPE,
} from './libraries/library_table.js';
import { Pgm } from './pgm_base.js';
import { PROJECT } from './project.js';
import { wxFileExists } from './wx/filefn.js';

export enum SAVE_T {
  SAVE_OK,
  SAVE_SKIPPED,
}

export class DESIGN_BLOCK_LIBRARY_ADAPTER extends LIBRARY_MANAGER_ADAPTER {
  static readonly SAVE_OK = SAVE_T.SAVE_OK;
  static readonly SAVE_SKIPPED = SAVE_T.SAVE_SKIPPED;

  constructor(aManager: LIBRARY_MANAGER) {
    super(aManager);
  }

  Type(): LIBRARY_TABLE_TYPE {
    return LIBRARY_TABLE_TYPE.DESIGN_BLOCK;
  }

  /** `GlobalPathEnvVariableName()`: `ENV_VAR::GetVersionedEnvVarName( "DESIGN_BLOCK_DIR" )`. [data] */
  static GlobalPathEnvVariableName(): string {
    return 'KICAD10_DESIGN_BLOCK_DIR';
  }

  /** `dbplugin( aRow )`: the row's plugin as a `DESIGN_BLOCK_IO`. */
  private static dbplugin(aRow: LIB_DATA): DESIGN_BLOCK_IO {
    return aRow.plugin as DESIGN_BLOCK_IO;
  }

  /** `createPlugin( row )` (design_block_library_adapter.cpp:50-78). */
  protected createPlugin(row: LIBRARY_TABLE_ROW): LIBRARY_RESULT<unknown> {
    const type = DESIGN_BLOCK_IO_MGR.EnumFromStr(row.Type());

    if (type === DESIGN_BLOCK_FILE_T.NESTED_TABLE) {
      if (wxFileExists(this.m_manager!.GetFullURI(row, true)))
        return { ok: false, error: new LIBRARY_TABLE_OK() };

      return { ok: false, error: new LIBRARY_ERROR(`Nested table '${row.URI()}' not found.`) };
    } else if (type === DESIGN_BLOCK_FILE_T.DESIGN_BLOCK_FILE_UNKNOWN) {
      return { ok: false, error: new LIBRARY_ERROR(`Unknown library type ${row.Type()} `) };
    }

    const plugin = DESIGN_BLOCK_IO_MGR.FindPlugin(type);

    if (!plugin) return { ok: false, error: new LIBRARY_ERROR('Internal error') };

    return { ok: true, value: plugin };
  }

  /** `LoadOne( LIB_DATA* )` (:94-117): enumerate the library; LOADED, or LOAD_ERROR with why. */
  LoadOne(aLib: LIB_DATA): LIB_STATUS {
    aLib.status.load_status = LOAD_STATUS.LOADING;

    try {
      const dummyList: string[] = [];
      DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(aLib).DesignBlockEnumerate(
        dummyList,
        this.getUri(aLib.row),
        false,
      );
      aLib.status.load_status = LOAD_STATUS.LOADED;
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      aLib.status.load_status = LOAD_STATUS.LOAD_ERROR;
      aLib.status.error = new LIBRARY_ERROR(e.message);
    }

    return aLib.status;
  }

  /** `LoadOne( nickname )` (:120-131). */
  LoadOneByName(aNickname: string): LIB_STATUS {
    const result = this.loadIfNeeded(aNickname);

    if (result.ok) return this.LoadOne(result.value);

    return { load_status: LOAD_STATUS.LOAD_ERROR, error: result.error };
  }

  /** `GetDesignBlocks( aNickname )` (:134-166): every block of a loaded library, or none. */
  GetDesignBlocks(aNickname: string): DESIGN_BLOCK[] {
    const blocks: DESIGN_BLOCK[] = [];
    const lib = this.fetchIfLoaded(aNickname);

    if (!lib) return blocks;

    const blockNames: string[] = [];

    try {
      DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib).DesignBlockEnumerate(
        blockNames,
        this.getUri(lib.row),
        false,
      );
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
    }

    for (const blockName of blockNames) {
      try {
        blocks.push(
          DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib).DesignBlockLoad(
            this.getUri(lib.row),
            blockName,
          ),
        );
      } catch (e) {
        if (!(e instanceof IO_ERROR)) throw e;
      }
    }

    return blocks;
  }

  /** `GetDesignBlockNames( aNickname )` (:169-186). */
  GetDesignBlockNames(aNickname: string): string[] {
    const names: string[] = [];
    const lib = this.fetchIfLoaded(aNickname);

    if (lib)
      DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib).DesignBlockEnumerate(
        names,
        this.getUri(lib.row),
        true,
      );

    return names;
  }

  /** `LoadDesignBlock` (:189-215): with the nickname filled in; null when missing or unreadable. */
  LoadDesignBlock(
    aNickname: string,
    aDesignBlockName: string,
    aKeepUUID = false,
  ): DESIGN_BLOCK | null {
    const lib = this.fetchIfLoaded(aNickname);

    if (lib) {
      try {
        const db = DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib).DesignBlockLoad(
          this.getUri(lib.row),
          aDesignBlockName,
          aKeepUUID,
        );

        db.GetLibId().SetLibNickname(aNickname);
        return db;
      } catch (e) {
        if (!(e instanceof IO_ERROR)) throw e;
      }
    }

    return null;
  }

  /** `DesignBlockExists` (:218-228). */
  DesignBlockExists(aNickname: string, aDesignBlockName: string): boolean {
    const lib = this.fetchIfLoaded(aNickname);

    if (lib)
      return DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib).DesignBlockExists(
        this.getUri(lib.row),
        aDesignBlockName,
      );

    return false;
  }

  /** `GetEnumeratedDesignBlock` (:231-242). */
  GetEnumeratedDesignBlock(aNickname: string, aDesignBlockName: string): DESIGN_BLOCK | null {
    const lib = this.fetchIfLoaded(aNickname);

    if (lib)
      return DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib).GetEnumeratedDesignBlock(
        this.getUri(lib.row),
        aDesignBlockName,
      );

    return null;
  }

  /** `SaveDesignBlock` (:245-262). Throws the plugin's `IO_ERROR`. */
  SaveDesignBlock(aNickname: string, aDesignBlock: DESIGN_BLOCK, aOverwrite = true): SAVE_T {
    const lib = this.fetchIfLoaded(aNickname);

    if (lib) {
      const plugin = DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib);

      if (!aOverwrite && plugin.DesignBlockExists(this.getUri(lib.row), aDesignBlock.GetName()))
        return SAVE_T.SAVE_SKIPPED;

      plugin.DesignBlockSave(this.getUri(lib.row), aDesignBlock);
    }

    return SAVE_T.SAVE_OK;
  }

  /** `DeleteDesignBlock` (:265-276). Throws the plugin's `IO_ERROR`. */
  DeleteDesignBlock(aNickname: string, aDesignBlockName: string): void {
    const lib = this.fetchIfLoaded(aNickname);

    if (lib)
      DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib).DesignBlockDelete(
        this.getUri(lib.row),
        aDesignBlockName,
      );
  }

  /** `IsDesignBlockLibWritable` (:279-288). */
  IsDesignBlockLibWritable(aNickname: string): boolean {
    const lib = this.fetchIfLoaded(aNickname);

    if (lib)
      return DESIGN_BLOCK_LIBRARY_ADAPTER.dbplugin(lib).IsLibraryWritable(this.getUri(lib.row));

    return false;
  }

  /**
   * `DesignBlockLoadWithOptionalNickname` (:291-310): by nickname when the id
   * has one, else the first library (alphabetically) that has the block.
   */
  DesignBlockLoadWithOptionalNickname(
    aDesignBlockId: LIB_ID,
    aKeepUUID = false,
  ): DESIGN_BLOCK | null {
    const nickname = aDesignBlockId.GetLibNickname();
    const designBlockName = aDesignBlockId.GetLibItemName();

    if (nickname !== '') return this.LoadDesignBlock(nickname, designBlockName, aKeepUUID);

    // nickname is empty, sequentially search (alphabetically) all libs/nicks for first match:
    for (const library of this.GetLibraryNames()) {
      const ret = this.LoadDesignBlock(library, designBlockName, aKeepUUID);

      if (ret) return ret;
    }

    return null;
  }
}

// `PROJECT::DesignBlockLibs()` makes one of these over the program's library manager.
PROJECT.s_designBlockLibsFactory = () =>
  new DESIGN_BLOCK_LIBRARY_ADAPTER(Pgm().GetLibraryManager());
