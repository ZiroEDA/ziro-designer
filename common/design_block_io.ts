// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DESIGN_BLOCK_IO_MGR` and `DESIGN_BLOCK_IO` (common/design_block_io.{h,cpp}):
 * the one design block library format — a `<lib>.kicad_blocks` folder holding a
 * `<name>.kicad_block` folder per design block, each with `<name>.kicad_sch`,
 * `<name>.kicad_pcb` and `<name>.json` (description, keywords, fields).
 *
 * The folders are on common's mounted file system (`wx/filefn.ts`): the
 * project's files where the app mounts them, the temp RAM disk, and whatever
 * else is mounted — so the plugin's code is upstream's, over `wxDir` /
 * `wxCopyFile` / `wxFFile` stand-ins.
 */
import { IO_ERROR } from './exceptions.js';
import { LIB_ID } from './lib_id.js';
import { LIBRARY_TABLE_ROW } from './libraries/library_table.js';
import { LIBRARY_TABLE_PARSER } from './libraries/library_table_parser.js';
import type { DESIGN_BLOCK } from './design_block.js';
import { DESIGN_BLOCK as DESIGN_BLOCK_CLASS } from './design_block.js';
import {
  JsonFileExtension,
  KiCadDesignBlockLibPathExtension,
  KiCadDesignBlockPathExtension,
  KiCadPcbFileExtension,
  KiCadSchematicFileExtension,
} from './wildcards_and_files_ext.js';
import {
  wxCopyFile,
  wxDirEnumerate,
  wxDirExists,
  wxFileExists,
  wxIsDirWritable,
  wxMkdir,
  wxReadFileSync,
  wxRemoveDirTree,
  wxWriteFileSync,
} from './wx/filefn.js';

/** `KICTL_NONKICAD_ONLY` (io_mgr.h): only guess non-KiCad library types. */
export const KICTL_NONKICAD_ONLY = 1 << 0;

export enum DESIGN_BLOCK_FILE_T {
  DESIGN_BLOCK_FILE_UNKNOWN = 0, ///< 0 is not a legal menu id on Mac
  KICAD_SEXP, ///< S-expression KiCad file format.
  FILE_TYPE_NONE,
  NESTED_TABLE,
}

const SEP = '/';

/** `nlohmann::ordered_json::dump( 0 )`: newlines, no indent, keys in insertion order. */
function dump0(aValue: unknown): string {
  if (aValue === null) return 'null';
  if (typeof aValue === 'string') return JSON.stringify(aValue);
  if (typeof aValue === 'number' || typeof aValue === 'boolean') return String(aValue);

  if (aValue instanceof Map) {
    if (aValue.size === 0) return '{}';

    const items = [...aValue.entries()].map(([k, v]) => `${JSON.stringify(k)}: ${dump0(v)}`);
    return `{\n${items.join(',\n')}\n}`;
  }

  const entries = Object.entries(aValue as Record<string, unknown>);

  if (entries.length === 0) return '{}';

  return `{\n${entries.map(([k, v]) => `${JSON.stringify(k)}: ${dump0(v)}`).join(',\n')}\n}`;
}

const readText = (aPath: string): string | null => {
  const bytes = wxReadFileSync(aPath);
  return bytes ? new TextDecoder().decode(bytes) : null;
};

export class DESIGN_BLOCK_IO {
  /** `IO_BASE::GetName()`. */
  GetName(): string {
    return 'KiCad';
  }

  /** `GetLibraryDesc()`: a folder library, `.kicad_blocks`. */
  GetLibraryDesc(): { description: string; extensions: string[]; isFolder: boolean } {
    return {
      description: 'KiCad Design Block folders',
      extensions: [KiCadDesignBlockLibPathExtension],
      isFolder: true,
    };
  }

  /** `IO_BASE::CanReadLibrary`: a directory with the library extension. */
  CanReadLibrary(aLibraryPath: string): boolean {
    return (
      aLibraryPath.replace(/\/+$/, '').endsWith(`.${KiCadDesignBlockLibPathExtension}`) &&
      wxDirExists(aLibraryPath)
    );
  }

  /** `CreateLibrary` (design_block_io.cpp:171-192). */
  CreateLibrary(aLibraryPath: string): void {
    if (wxDirExists(aLibraryPath))
      throw new IO_ERROR(`Cannot overwrite library path '${aLibraryPath}'.`);

    if (!wxMkdir(aLibraryPath)) {
      throw new IO_ERROR(
        `Library path '${aLibraryPath}' could not be created.\n\nMake sure you have write permissions and try again.`,
      );
    }
  }

  /** `DeleteLibrary` (:195-265). */
  DeleteLibrary(aLibraryPath: string): boolean {
    // Return if there is no library path to delete.
    if (!wxDirExists(aLibraryPath)) return false;

    if (!this.IsLibraryWritable(aLibraryPath))
      throw new IO_ERROR(`Insufficient permissions to delete folder '${aLibraryPath}'.`);

    const entries = wxDirEnumerate(aLibraryPath) ?? [];

    // Design block folders should only contain sub-folders for each design block
    if (entries.some((e) => !e.isDir))
      throw new IO_ERROR(`Library folder '${aLibraryPath}' has unexpected files.`);

    // Must delete all sub-directories before deleting the library directory. Upstream
    // tests each one's extension against the LIBRARY extension (`kicad_blocks`), not a
    // block's (`kicad_block`), so a library holding blocks is refused here as it is there.
    for (const e of entries) {
      const dot = e.name.lastIndexOf('.');
      const ext = dot >= 0 ? e.name.slice(dot + 1) : '';

      if (ext !== KiCadDesignBlockLibPathExtension) {
        throw new IO_ERROR(
          `Unexpected folder '${aLibraryPath}${SEP}${e.name}' found in library path '${aLibraryPath}'.`,
        );
      }
    }

    if (!wxRemoveDirTree(aLibraryPath))
      throw new IO_ERROR(`Design block library '${aLibraryPath}' cannot be deleted.`);

    return true;
  }

  /** `DesignBlockEnumerate` (:268-289): every `*.kicad_block` folder, named by what precedes its first dot. */
  DesignBlockEnumerate(
    aDesignBlockNames: string[],
    aLibraryPath: string,
    _aBestEfforts: boolean,
  ): void {
    const entries = wxDirEnumerate(aLibraryPath);

    if (entries === null) throw new IO_ERROR(`Design block '${aLibraryPath}' does not exist.`);

    for (const e of entries) {
      if (e.isDir && e.name.endsWith(`.${KiCadDesignBlockPathExtension}`)) {
        // dirname.Before( '.' )
        const dot = e.name.indexOf('.');
        aDesignBlockNames.push(dot >= 0 ? e.name.slice(0, dot) : e.name);
      }
    }
  }

  /** `GetEnumeratedDesignBlock`: `DesignBlockLoad( …, false )`. */
  GetEnumeratedDesignBlock(aLibraryPath: string, aDesignBlockName: string): DESIGN_BLOCK | null {
    return this.DesignBlockLoad(aLibraryPath, aDesignBlockName, false);
  }

  private dbPath(aLibraryPath: string, aDesignBlockName: string): string {
    return `${aLibraryPath}${SEP}${aDesignBlockName}.${KiCadDesignBlockPathExtension}${SEP}`;
  }

  /** `DesignBlockLoad` (:292-351). */
  DesignBlockLoad(
    aLibraryPath: string,
    aDesignBlockName: string,
    _aKeepUUID = false,
  ): DESIGN_BLOCK {
    const dbPath = this.dbPath(aLibraryPath, aDesignBlockName);
    const dbSchPath = `${dbPath}${aDesignBlockName}.${KiCadSchematicFileExtension}`;
    const dbPcbPath = `${dbPath}${aDesignBlockName}.${KiCadPcbFileExtension}`;
    const dbMetadataPath = `${dbPath}${aDesignBlockName}.${JsonFileExtension}`;

    if (!wxDirExists(dbPath)) throw new IO_ERROR(`Design block '${dbPath}' does not exist.`);

    const newDB = new DESIGN_BLOCK_CLASS();

    // Library name needs to be empty for when we fill it in with the correct library nickname
    // one layer above
    newDB.SetLibId(new LIB_ID('', aDesignBlockName));

    if (wxFileExists(dbSchPath)) newDB.SetSchematicFile(dbSchPath);

    if (wxFileExists(dbPcbPath)) newDB.SetBoardFile(dbPcbPath);

    // Parse the JSON file if it exists
    if (wxFileExists(dbMetadataPath)) {
      try {
        const dbMetadata = JSON.parse(readText(dbMetadataPath) ?? '') as Record<string, unknown>;

        if ('description' in dbMetadata)
          newDB.SetLibDescription(String(asString(dbMetadata.description)));

        if ('keywords' in dbMetadata) newDB.SetKeywords(String(asString(dbMetadata.keywords)));

        // Read the "fields" object from the JSON
        if ('fields' in dbMetadata) {
          for (const [name, value] of Object.entries(dbMetadata.fields as Record<string, unknown>))
            newDB.GetFields().set(name, asString(value));
        }
      } catch {
        throw new IO_ERROR(`Design block metadata file '${dbMetadataPath}' could not be read.`);
      }
    }

    return newDB;
  }

  /** `DesignBlockExists` (:354-362). */
  DesignBlockExists(aLibraryPath: string, aDesignBlockName: string): boolean {
    return wxDirExists(this.dbPath(aLibraryPath, aDesignBlockName));
  }

  /** `DesignBlockSave` (:365-488). */
  DesignBlockSave(aLibraryPath: string, aDesignBlock: DESIGN_BLOCK): void {
    // Make sure we have a valid LIB_ID or we can't save the design block
    if (!aDesignBlock.GetLibId().IsValid())
      throw new IO_ERROR('Design block does not have a valid library ID.');

    if (aDesignBlock.GetSchematicFile() === '' && aDesignBlock.GetBoardFile() === '')
      throw new IO_ERROR('Design block does not have a schematic or board file.');

    const schematicFile = aDesignBlock.GetSchematicFile();
    const boardFile = aDesignBlock.GetBoardFile();

    if (schematicFile !== '' && !wxFileExists(schematicFile))
      throw new IO_ERROR(`Schematic source file '${schematicFile}' does not exist.`);

    if (boardFile !== '' && !wxFileExists(boardFile))
      throw new IO_ERROR(`Board source file '${boardFile}' does not exist.`);

    // Create the design block folder
    const itemName = aDesignBlock.GetLibId().GetLibItemName();
    const dbFolder = this.dbPath(aLibraryPath, itemName);

    if (!wxDirExists(dbFolder)) {
      if (!wxMkdir(dbFolder))
        throw new IO_ERROR(`Design block folder '${dbFolder}' could not be created.`);
    }

    if (schematicFile !== '') {
      // The new schematic file name is based on the design block name, not the source sheet name
      const dbSchematicFile = `${dbFolder}${itemName}.${KiCadSchematicFileExtension}`;

      // If the source and destination files are the same, then we don't need to copy the file
      // as we are just updating the metadata
      if (schematicFile !== dbSchematicFile) {
        if (!wxCopyFile(schematicFile, dbSchematicFile)) {
          throw new IO_ERROR(
            `Schematic file '${schematicFile}' could not be saved as design block at '${dbSchematicFile}'.`,
          );
        }
      }
    }

    if (boardFile !== '') {
      // The new Board file name is based on the design block name, not the source sheet name
      const dbBoardFile = `${dbFolder}${itemName}.${KiCadPcbFileExtension}`;

      if (boardFile !== dbBoardFile) {
        if (!wxCopyFile(boardFile, dbBoardFile)) {
          throw new IO_ERROR(
            `Board file '${boardFile}' could not be saved as design block at '${dbBoardFile}'.`,
          );
        }
      }
    }

    const dbMetadataFile = `${dbFolder}${itemName}.${JsonFileExtension}`;

    // Write the metadata file
    const dbMetadata = new Map<string, unknown>([
      ['description', aDesignBlock.GetLibDescription()],
      ['keywords', aDesignBlock.GetKeywords()],
      ['fields', aDesignBlock.GetFields()],
    ]);

    if (!wxWriteFileSync(dbMetadataFile, new TextEncoder().encode(dump0(dbMetadata))))
      throw new IO_ERROR(`Design block metadata file '${dbMetadataFile}' could not be saved.`);
  }

  /** `DesignBlockDelete` (:491-510). */
  DesignBlockDelete(aLibPath: string, aDesignBlockName: string): void {
    const dbDir = `${aLibPath}${SEP}${aDesignBlockName}.${KiCadDesignBlockPathExtension}`;

    if (!wxDirExists(dbDir))
      throw new IO_ERROR(
        `Design block '${aDesignBlockName}.${KiCadDesignBlockPathExtension}' does not exist.`,
      );

    // Delete the whole design block folder
    if (!wxRemoveDirTree(dbDir))
      throw new IO_ERROR(`Design block folder '${dbDir}' could not be deleted.`);
  }

  /** `IsLibraryWritable` (:513-517): a path on a writable mount. */
  IsLibraryWritable(aLibraryPath: string): boolean {
    return aLibraryPath !== '' && wxIsDirWritable(aLibraryPath);
  }
}

/** `get<std::string>()` on a JSON value: a string, else the conversion throws. */
function asString(aValue: unknown): string {
  if (typeof aValue !== 'string') throw new Error('type must be string');
  return aValue;
}

export const DESIGN_BLOCK_IO_MGR = {
  /**
   * `ShowType` (:47-57): the token written into the design-block-lib-table,
   * locale-independent.
   */
  ShowType(aFileType: DESIGN_BLOCK_FILE_T): string {
    switch (aFileType) {
      case DESIGN_BLOCK_FILE_T.KICAD_SEXP:
        return 'KiCad';
      case DESIGN_BLOCK_FILE_T.NESTED_TABLE:
        return LIBRARY_TABLE_ROW.TABLE_TYPE_NAME;
      default:
        return `UNKNOWN (${aFileType})`;
    }
  },

  /** `EnumFromStr` (:60-77). */
  EnumFromStr(aFileType: string): DESIGN_BLOCK_FILE_T {
    if (aFileType.toLowerCase() === 'kicad') return DESIGN_BLOCK_FILE_T.KICAD_SEXP;
    else if (aFileType === LIBRARY_TABLE_ROW.TABLE_TYPE_NAME)
      return DESIGN_BLOCK_FILE_T.NESTED_TABLE;

    return DESIGN_BLOCK_FILE_T.DESIGN_BLOCK_FILE_UNKNOWN;
  },

  /** `FindPlugin` (:80-87). */
  FindPlugin(aFileType: DESIGN_BLOCK_FILE_T): DESIGN_BLOCK_IO | null {
    switch (aFileType) {
      case DESIGN_BLOCK_FILE_T.KICAD_SEXP:
        return new DESIGN_BLOCK_IO();
      default:
        return null;
    }
  },

  /** `GuessPluginTypeFromLibPath` (:90-105). */
  GuessPluginTypeFromLibPath(aLibPath: string, aCtl = 0): DESIGN_BLOCK_FILE_T {
    const text = readText(aLibPath);

    if (text !== null && new LIBRARY_TABLE_PARSER().Parse(aLibPath, text).ok)
      return DESIGN_BLOCK_FILE_T.NESTED_TABLE;

    if (new DESIGN_BLOCK_IO().CanReadLibrary(aLibPath) && aCtl !== KICTL_NONKICAD_ONLY)
      return DESIGN_BLOCK_FILE_T.KICAD_SEXP;

    return DESIGN_BLOCK_FILE_T.FILE_TYPE_NONE;
  },
};
