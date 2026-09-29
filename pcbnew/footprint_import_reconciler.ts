// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/footprint_import_reconciler.h` / `.cpp` (new in 10.0.6):
 * `FOOTPRINT_IMPORT_RECONCILER`, a frame-independent, non-interactive service
 * that reconciles the footprint-library references of a freshly imported
 * (non-KiCad) board so that every board footprint FPID resolves to a
 * registered project library.
 *
 * A footprint whose definition provably lives in a provenance source library
 * is re-linked there ("prefer source"); anything left over is written into a
 * single manager-chosen generated cache (.pretty) registered in the project
 * footprint-library table ("generate residual"). The service never scans
 * arbitrary loaded/global libraries and never deletes a user library.
 *
 * The footprint-library adapter and project path are injected so the service
 * can be exercised with a temporary project and a locally-owned adapter,
 * without a frame.
 *
 * Browser differences, each forced by the host:
 * - `PCB_IO_MGR::FindPlugin( KICAD_SEXP )`'s `CreateLibrary` / `FootprintSave`
 *   / `DeleteLibrary` are {@link KICAD_SEXPR_FOOTPRINT_LIBRARY_IO} over the wx
 *   file-system mounts (`common/wx/filefn.ts`): a `.pretty` is a directory of
 *   `.kicad_mod` files in whichever in-memory mount holds the project. It is a
 *   parameter of the constructor, the way the adapter is.
 * - `wxDir::Exists` / `wxRenameFile` are `wxDirExists` / `wxRenameFile` of the
 *   same layer.
 */
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { LIBRARY_TABLE_SCOPE } from '@ziroeda/common/libraries/library_table.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_WARNING,
  type Reporter,
  type Severity,
} from '@ziroeda/common/reporter.js';
import {
  wxDirExists,
  wxNormalizePath,
  wxRemoveDirTree,
  wxRenameFile,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import type { BOARD } from './board.js';
import type { FOOTPRINT } from './footprint.js';
import type { FOOTPRINT_LIBRARY_ADAPTER } from './footprint_library_adapter.js';
import {
  FormatFootprintForLibrary,
  footprintSaveClone,
} from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

/** `FILEEXT::KiCadFootprintLibPathExtension` and `KiCadFootprintFileExtension`. */
const KICAD_FOOTPRINT_LIB_PATH_EXTENSION = 'pretty';
const KICAD_FOOTPRINT_FILE_EXTENSION = 'kicad_mod';

/** Outcome of a post-import footprint-library reconciliation pass. */
export class FOOTPRINT_IMPORT_RECONCILE_RESULT {
  m_linkedToSource = 0; ///< board FPIDs re-pointed at a provenance source library
  m_linkedToCache = 0; ///< board FPIDs re-pointed at the generated cache
  m_unresolved = 0; ///< board FPIDs left unresolved
  m_savedToCache = 0; ///< distinct definitions written into the cache library
  m_cacheNickname = ''; ///< nickname of the generated cache, empty if none written
  m_cacheLibraryPath = ''; ///< absolute path to the generated .pretty, empty if none

  Ok(): boolean {
    return this.m_unresolved === 0;
  }
}

/**
 * The three `PCB_IO_KICAD_SEXPR` library calls the reconciler makes, which
 * throw `IO_ERROR` as the plugin does.
 */
export interface FOOTPRINT_LIBRARY_IO {
  CreateLibrary(aLibraryPath: string): void;
  FootprintSave(aLibraryPath: string, aFootprint: FOOTPRINT): void;
  DeleteLibrary(aLibraryPath: string): boolean;
}

/** `ReplaceIllegalFileNameChars( name, '_' )`: the characters no file name may hold. */
function replaceIllegalFileNameChars(aName: string): string {
  return aName.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * `PCB_IO_KICAD_SEXPR`'s `CreateLibrary`, `FootprintSave` and `DeleteLibrary`
 * over the wx file-system mounts.
 *
 * A directory here exists once a file is in it (an in-memory mount keeps paths,
 * not folders), so `CreateLibrary` has nothing to make: it refuses only a path
 * that is already a library, as the plugin does.
 */
export class KICAD_SEXPR_FOOTPRINT_LIBRARY_IO implements FOOTPRINT_LIBRARY_IO {
  CreateLibrary(aLibraryPath: string): void {
    if (wxDirExists(aLibraryPath))
      throw new IO_ERROR(`Cannot overwrite library path '${aLibraryPath}'.`);
  }

  /**
   * `FootprintSave` (pcb_io_kicad_sexpr.cpp:3366-3500): the clone brought to the
   * front at orientation 0, detached and net-free, written as
   * `<library>/<name>.kicad_mod`.
   */
  FootprintSave(aLibraryPath: string, aFootprint: FOOTPRINT): void {
    const fpName = replaceIllegalFileNameChars(aFootprint.GetFPID().GetUniStringLibItemName());
    const fullPath = `${wxNormalizePath(aLibraryPath).replace(/\/+$/, '')}/${fpName}.${KICAD_FOOTPRINT_FILE_EXTENSION}`;

    // "I need my own copy for the cache"
    const footprint = aFootprint.Clone() as FOOTPRINT;
    footprintSaveClone(footprint);
    const text = FormatFootprintForLibrary(footprint);

    if (!wxWriteFileSync(fullPath, new TextEncoder().encode(text)))
      throw new IO_ERROR(`Library '${aLibraryPath}' is read only.`);
  }

  DeleteLibrary(aLibraryPath: string): boolean {
    return wxRemoveDirTree(aLibraryPath);
  }
}

/** `std::wstring` order: by code point. */
const compareCodePoints = (a: string, b: string): number => {
  const ac = [...a];
  const bc = [...b];
  const n = Math.min(ac.length, bc.length);

  for (let i = 0; i < n; i++) {
    const d = ac[i]!.codePointAt(0)! - bc[i]!.codePointAt(0)!;

    if (d !== 0) return d;
  }

  return ac.length - bc.length;
};

const sortedKeys = <V>(aMap: ReadonlyMap<string, V>): string[] =>
  [...aMap.keys()].sort(compareCodePoints);

export class FOOTPRINT_IMPORT_RECONCILER {
  /** `ManagedCacheOption()`: options string identifying a footprint-library table row as a generated import cache. */
  static ManagedCacheOption(): string {
    return 'kicad_import_cache=1';
  }

  private readonly m_adapter: FOOTPRINT_LIBRARY_ADAPTER;
  private readonly m_projectPath: string;
  private readonly m_reporter: Reporter | null;
  private readonly m_libraryIO: FOOTPRINT_LIBRARY_IO;

  constructor(
    aAdapter: FOOTPRINT_LIBRARY_ADAPTER,
    aProjectPath: string,
    aReporter: Reporter | null = null,
    aLibraryIO: FOOTPRINT_LIBRARY_IO = new KICAD_SEXPR_FOOTPRINT_LIBRARY_IO(),
  ) {
    this.m_adapter = aAdapter;
    this.m_projectPath = aProjectPath;
    this.m_reporter = aReporter;
    this.m_libraryIO = aLibraryIO;
  }

  private report(aMsg: string, aSeverity: Severity): void {
    this.m_reporter?.report(aMsg, aSeverity);
  }

  /**
   * Reconcile @p aBoard against the importer definitions and the provenance source libraries.
   *
   * @param aBoard is the imported board whose footprint FPIDs are re-pointed in place.
   * @param aDefinitions are the caller-owned canonical footprint definitions produced by the
   *                     importer (e.g. `PCB_IO::GetImportedCachedLibraryFootprints()`).
   * @param aCacheNickname is the manager-chosen collision-free generated-cache nickname.
   * @param aSourceLibNicknames are the provenance source footprint-library nicknames registered
   *                            for this import.
   */
  Reconcile(
    aBoard: BOARD | null,
    aDefinitions: readonly FOOTPRINT[],
    aCacheNickname: string,
    aSourceLibNicknames: readonly string[],
  ): FOOTPRINT_IMPORT_RECONCILE_RESULT {
    const result = new FOOTPRINT_IMPORT_RECONCILE_RESULT();

    if (!aBoard) return result;

    // index importer defs by FPID item name
    const defByName = new Map<string, FOOTPRINT>();

    for (const def of aDefinitions) {
      const name = def.GetFPID().GetUniStringLibItemName();

      // `emplace`: the first definition of a name wins.
      if (name !== '' && !defByName.has(name)) defByName.set(name, def);
    }

    // preload source libs before membership queries
    for (const nick of aSourceLibNicknames) {
      if (this.m_adapter.GetRow(nick)) this.m_adapter.LoadOne(nick);
    }

    // resolve one source lib, empty if none or ambiguous
    const resolveSource = (aFp: FOOTPRINT, aName: string): string => {
      const candidates: string[] = [];
      const ownNick = aFp.GetFPID().GetUniStringLibNickname();

      if (ownNick !== '') candidates.push(ownNick);

      for (const nick of aSourceLibNicknames) {
        if (nick !== ownNick) candidates.push(nick);
      }

      const matches: string[] = [];

      for (const nick of candidates) {
        if (this.m_adapter.GetRow(nick) && this.m_adapter.FootprintExists(nick, aName))
          matches.push(nick);
      }

      return matches.length === 1 ? matches[0]! : '';
    };

    // per-instance target keyed by nick+name, so same-name parts from different libs stay split
    // empty target = cache-bound
    const targetByKey = new Map<string, string>();
    const cacheNames = new Set<string>();
    const instancesByName = new Map<string, FOOTPRINT[]>();

    const keyOf = (aNick: string, aName: string): string => `${aNick}\x1f${aName}`;

    for (const fp of aBoard.Footprints()) {
      const name = fp.GetFPID().GetUniStringLibItemName();

      if (name === '') continue;

      const instances = instancesByName.get(name);

      if (instances) instances.push(fp);
      else instancesByName.set(name, [fp]);

      const key = keyOf(fp.GetFPID().GetUniStringLibNickname(), name);

      if (targetByKey.has(key)) continue;

      const sourceNick = resolveSource(fp, name);
      targetByKey.set(key, sourceNick);

      if (sourceNick === '') cacheNames.add(name);
    }

    // canonical def per cache name, fall back to unique placed instance if importer gave none
    const cacheDefs = new Map<string, FOOTPRINT>();

    for (const name of [...cacheNames].sort(compareCodePoints)) {
      const def = defByName.get(name);

      if (def) {
        cacheDefs.set(name, def);
        continue;
      }

      const instances = instancesByName.get(name) ?? [];

      if (instances.length === 0) continue;

      const firstSig = placedSignature(instances[0]!);

      for (const inst of instances.slice(1)) {
        if (placedSignature(inst) !== firstSig) {
          this.report(
            `Imported footprint '${name}' has conflicting placed definitions; keeping the first.`,
            RPT_SEVERITY_WARNING,
          );
        }
      }

      cacheDefs.set(name, instances[0]!.Clone() as FOOTPRINT);
    }

    // write residuals to an atomic .pretty and register the row
    if (cacheDefs.size > 0) this.writeAndRegisterCache(aCacheNickname, cacheDefs, result);

    // re-point board FPID nicks to resolved lib, keep item name
    for (const fp of aBoard.Footprints()) {
      const fpid = fp.GetFPID().clone();
      const name = fpid.GetUniStringLibItemName();

      if (name === '') continue;

      const target = targetByKey.get(keyOf(fpid.GetUniStringLibNickname(), name));

      if (target === undefined) {
        result.m_unresolved++;
        continue;
      }

      // empty resolution = cache-bound, resolves only once the cache is published
      if (target === '') {
        if (result.m_cacheNickname === '') {
          result.m_unresolved++;
          continue;
        }

        fpid.SetLibNickname(aCacheNickname);
        fp.SetFPID(fpid);
        result.m_linkedToCache++;
      } else {
        fpid.SetLibNickname(target);
        fp.SetFPID(fpid);
        result.m_linkedToSource++;
      }
    }

    return result;
  }

  /** Write the residual definitions into an atomically-published .pretty and register its row. */
  private writeAndRegisterCache(
    aCacheNickname: string,
    aCacheDefs: ReadonlyMap<string, FOOTPRINT>,
    aResult: FOOTPRINT_IMPORT_RECONCILE_RESULT,
  ): void {
    const dir = this.m_projectPath.replace(/\/+$/, '');
    const cacheDirName = `${aCacheNickname}.${KICAD_FOOTPRINT_LIB_PATH_EXTENSION}`;
    const finalPath = dir === '' ? cacheDirName : `${dir}/${cacheDirName}`;
    const tempPath = `${finalPath}.tmp`;
    const pi = this.m_libraryIO;

    // best-effort cleanup, must not throw
    const safeDelete = (aPath: string): void => {
      try {
        pi.DeleteLibrary(aPath);
      } catch (e) {
        if (!(e instanceof IO_ERROR)) throw e;
      }
    };

    let wrote = false;

    try {
      if (wxDirExists(tempPath)) pi.DeleteLibrary(tempPath);

      pi.CreateLibrary(tempPath);

      for (const name of sortedKeys(aCacheDefs)) {
        const copy = aCacheDefs.get(name)!.Clone() as FOOTPRINT;
        const id = copy.GetFPID().clone();

        id.SetLibNickname(aCacheNickname);
        copy.SetFPID(id);
        copy.SetReference('REF**');
        pi.FootprintSave(tempPath, copy);
      }

      wrote = true;
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      this.report(
        `Error writing imported footprint cache '${aCacheNickname}': ${e.message}`,
        RPT_SEVERITY_ERROR,
      );
    }

    if (!wrote) {
      if (wxDirExists(tempPath)) safeDelete(tempPath);

      return;
    }

    // publish temp->final, replace only a managed cache, never a user lib
    if (wxDirExists(finalPath)) {
      if (this.existingIsManagedCache(aCacheNickname)) {
        safeDelete(finalPath);
      } else {
        this.report(
          `A library already exists at '${finalPath}'; leaving imported footprints unresolved.`,
          RPT_SEVERITY_ERROR,
        );
        safeDelete(tempPath);
        return;
      }
    }

    if (!wxRenameFile(tempPath, finalPath, false)) {
      this.report(
        `Could not publish imported footprint cache to '${finalPath}'.`,
        RPT_SEVERITY_ERROR,
      );
      safeDelete(tempPath);
      return;
    }

    // only claim the cache when its table row is registered, else FPIDs re-point to a dead nickname
    if (!this.registerCacheRow(aCacheNickname)) return;

    aResult.m_cacheNickname = aCacheNickname;
    aResult.m_cacheLibraryPath = finalPath;
    aResult.m_savedToCache = aCacheDefs.size;
  }

  /** reuse existing row/dir only if prior import-managed cache */
  private existingIsManagedCache(aNickname: string): boolean {
    const row = this.m_adapter.GetRow(aNickname);

    if (!row) return false;

    return row.GetOptionsMap().has('kicad_import_cache');
  }

  /**
   * Insert or refresh the project footprint-library-table row for the generated cache.
   * Returns false when no project table exists or the row could not be created.
   */
  private registerCacheRow(aCacheNickname: string): boolean {
    const table = this.m_adapter.ProjectTable();

    if (!table) {
      this.report(
        'Cannot register imported footprint cache: no project library table.',
        RPT_SEVERITY_ERROR,
      );
      return false;
    }

    const cacheFile = `${aCacheNickname}.${KICAD_FOOTPRINT_LIB_PATH_EXTENSION}`;
    const uri = `\${KIPRJMOD}/${cacheFile}`;
    const row = table.HasRow(aCacheNickname)
      ? (table.Row(aCacheNickname) ?? null)
      : table.InsertRow();

    if (!row) return false;

    row.SetNickname(aCacheNickname);
    row.SetURI(uri);
    row.SetType('KiCad');
    row.SetOptions(FOOTPRINT_IMPORT_RECONCILER.ManagedCacheOption());
    row.SetScope(LIBRARY_TABLE_SCOPE.PROJECT);

    if (!table.Save().ok)
      this.report('Error saving project footprint library table.', RPT_SEVERITY_WARNING);

    // load the cache so membership and the updater resolve it
    this.m_adapter.LoadOne(aCacheNickname);
    return true;
  }
}

/** structural signature, flags same-name placed instances that differ */
function placedSignature(aFp: FOOTPRINT): string {
  const bbox = aFp.GetBoundingBox(false);

  return `${aFp.Pads().length}:${aFp.GraphicalItems().length}:${bbox.GetWidth()}:${bbox.GetHeight()}`;
}
