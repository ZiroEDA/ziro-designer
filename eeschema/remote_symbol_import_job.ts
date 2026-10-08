// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `REMOTE_SYMBOL_IMPORT_JOB` (eeschema/remote_symbol_import_job.{h,cpp},
 * KiCad 10): download every asset of a provider's part manifest — footprints
 * first, then 3D models and SPICE models, then the symbols, whose Footprint
 * field must name footprints already on disk — write each under the
 * destination root, register the libraries, and optionally place the symbol.
 *
 * Interactive (a frame given) the libraries are added to the library tables
 * and the symbol is saved through the symbol library; headless the raw
 * payload is written and, when footprint links had to be applied, re-saved
 * through the KiCad symbol-library writer.
 *
 * Asynchronous here, because each download is (see
 * `remote_symbol_download_manager.ts`, which also records the one call a
 * provider's CORS policy can block).
 *
 * Its upstream caller is `PANEL_REMOTE_SYMBOL` (eeschema/widgets/
 * panel_remote_symbol.cpp), the dock that hosts the provider's web UI in a
 * `wxWebView` and hands this job the manifest the page posts back. That panel
 * is not one of the ported files, so nothing in the app starts a job yet.
 */
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import {
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import type { REMOTE_PROVIDER_METADATA } from '@ziroeda/common/remote_provider_metadata.js';
import type { REMOTE_PROVIDER_PART_MANIFEST } from '@ziroeda/common/remote_provider_models.js';
import { currentEeschemaSettings } from './eeschema_settings.js';
import type { LIB_SYMBOL } from './lib_symbol.js';
import {
  REMOTE_SYMBOL_DOWNLOAD_MANAGER,
  REMOTE_SYMBOL_FETCHED_ASSET,
} from './remote_symbol_download_manager.js';
import {
  ApplyFootprintLinks,
  BuildRemoteLibId,
  EnsureRemoteDestinationRoot,
  EnsureRemoteLibraryEntry,
  LoadRemoteSymbolFromPayload,
  PlaceRemoteDownloadedSymbol,
  type REMOTE_LIBRARY_MANAGER,
  type REMOTE_SYMBOL_PLACEMENT_FRAME,
  RemoteLibraryPrefix,
  SanitizeRemoteFileComponent,
  WriteRemoteBinaryFile,
} from './remote_symbol_import_utils.js';
import { SCH_IO_KICAD_SEXPR } from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';

export interface REMOTE_SYMBOL_IMPORT_CONTEXT {
  symbol_name: string;
  library_name: string;
}

/**
 * The schematic editor as an interactive import uses it: the placement
 * (`REMOTE_SYMBOL_PLACEMENT_FRAME`), `PROJECT_SCH::SymbolLibAdapter`'s
 * `SaveSymbol( nickname, symbol, true ) == SAVE_OK`, and `Pgm().GetLibraryManager()`.
 */
export interface REMOTE_SYMBOL_IMPORT_FRAME extends REMOTE_SYMBOL_PLACEMENT_FRAME {
  SaveSymbol(aNickname: string, aSymbol: LIB_SYMBOL, aOverwrite: boolean): boolean;
  GetLibraryManager(): REMOTE_LIBRARY_MANAGER;
}

/**
 * `validateSymbolPayload` (remote_symbol_import_job.cpp:44-77): a KiCad symbol
 * library that contains `(symbol "<expected>"`.
 */
function validateSymbolPayload(
  aPayload: Uint8Array,
  aExpectedSymbolName: string,
  aError: { value: string },
): boolean {
  if (aExpectedSymbolName === '') return true;

  if (aPayload.length === 0) {
    aError.value = 'Downloaded symbol payload was empty.';
    return false;
  }

  const payload = new TextDecoder().decode(aPayload);

  if (!payload.includes('(kicad_symbol_lib')) {
    aError.value = 'Downloaded symbol payload was not a KiCad symbol library.';
    return false;
  }

  if (!payload.includes(`(symbol "${aExpectedSymbolName}"`)) {
    aError.value = `Downloaded symbol payload did not include expected symbol '${aExpectedSymbolName}'.`;
    return false;
  }

  return true;
}

export class REMOTE_SYMBOL_IMPORT_JOB {
  private readonly m_frame: REMOTE_SYMBOL_IMPORT_FRAME | null;
  private readonly m_downloader: REMOTE_SYMBOL_DOWNLOAD_MANAGER;

  constructor(
    aFrame: REMOTE_SYMBOL_IMPORT_FRAME | null,
    aDownloader: REMOTE_SYMBOL_DOWNLOAD_MANAGER | null = null,
  ) {
    this.m_frame = aFrame;
    this.m_downloader = aDownloader ?? new REMOTE_SYMBOL_DOWNLOAD_MANAGER();
  }

  /** `Import` (remote_symbol_import_job.cpp:93-360). */
  async Import(
    aProvider: REMOTE_PROVIDER_METADATA,
    aContext: REMOTE_SYMBOL_IMPORT_CONTEXT,
    aManifest: REMOTE_PROVIDER_PART_MANIFEST,
    aPlaceSymbol: boolean,
    aError: { value: string },
  ): Promise<boolean> {
    aError.value = '';

    const settings = currentEeschemaSettings();

    const baseDirOut = { value: '' };

    if (!EnsureRemoteDestinationRoot(baseDirOut, aError)) return false;

    const baseDir = baseDirOut.value;
    let remainingBudget = aProvider.max_download_bytes;
    const addToGlobal = settings.remote_symbols?.add_to_global_table ?? false;
    const strictLibraryTables = this.m_frame !== null;
    const prefix = RemoteLibraryPrefix();
    const scope = addToGlobal ? LIBRARY_TABLE_SCOPE.GLOBAL : LIBRARY_TABLE_SCOPE.PROJECT;
    let importedSymbol = false;
    let placedNickname = '';
    let placedSymbolName = '';

    // Sort asset indices: footprints first, then 3D/SPICE, then symbols. The symbol's
    // Footprint field references a LIB_ID that must already exist on disk and (when
    // running interactive) be registered in the footprint library table by the time the
    // symbol file is written, otherwise CvPcb / placement-time resolution misses it.
    const footprintIdx: number[] = [];
    const otherIdx: number[] = [];
    const symbolIdx: number[] = [];

    aManifest.assets.forEach((asset, i) => {
      if (asset.asset_type === 'footprint') footprintIdx.push(i);
      else if (asset.asset_type === 'symbol') symbolIdx.push(i);
      else otherIdx.push(i);
    });

    const footprintLinks: LIB_ID[] = [];

    const downloadAsset = async (
      i: number,
      fetched: REMOTE_SYMBOL_FETCHED_ASSET,
    ): Promise<boolean> => {
      if (
        !(await this.m_downloader.DownloadAndVerify(
          aProvider,
          aManifest.assets[i]!,
          remainingBudget,
          fetched,
          aError,
        ))
      )
        return false;

      remainingBudget -= aManifest.assets[i]!.size_bytes;
      return true;
    };

    // --- Footprints ---
    for (const i of footprintIdx) {
      const asset = aManifest.assets[i]!;
      const fetched = new REMOTE_SYMBOL_FETCHED_ASSET();

      if (!(await downloadAsset(i, fetched))) return false;

      const fpRoot = `${baseDir}footprints/`;

      // Resolve logical names with the same fallbacks the original code used.
      const resolvedLib = asset.target_library === '' ? asset.name : asset.target_library;
      const resolvedName = asset.target_name === '' ? asset.name : asset.target_name;

      const fpLibId = BuildRemoteLibId(resolvedLib, resolvedName);
      const nickname = fpLibId.GetUniStringLibNickname();

      const libDir = `${fpRoot}${nickname}.pretty/`;

      let fileName = fpLibId.GetUniStringLibItemName();

      if (!fileName.toLowerCase().endsWith('.kicad_mod')) fileName += '.kicad_mod';

      if (!WriteRemoteBinaryFile(libDir + fileName, fetched.payload, aError)) return false;

      if (strictLibraryTables) {
        const libMgr = this.m_frame!.GetLibraryManager();

        if (
          !EnsureRemoteLibraryEntry(
            libMgr,
            LIBRARY_TABLE_TYPE.FOOTPRINT,
            libDir,
            nickname,
            addToGlobal,
            true,
            aError,
          )
        )
          return false;

        libMgr.ReloadLibraryEntry(LIBRARY_TABLE_TYPE.FOOTPRINT, nickname, scope);
        libMgr.LoadLibraryEntry(LIBRARY_TABLE_TYPE.FOOTPRINT, nickname);
      }

      footprintLinks.push(fpLibId);
    }

    // --- 3D models, SPICE ---
    for (const i of otherIdx) {
      const asset = aManifest.assets[i]!;
      const fetched = new REMOTE_SYMBOL_FETCHED_ASSET();

      if (!(await downloadAsset(i, fetched))) return false;

      if (asset.asset_type === '3dmodel') {
        const modelDir = `${baseDir}${prefix}_3d/`;

        const fileName = SanitizeRemoteFileComponent(
          asset.target_name === '' ? asset.name : asset.target_name,
          `${prefix}_model`,
        );

        if (!WriteRemoteBinaryFile(modelDir + fileName, fetched.payload, aError)) return false;
      } else if (asset.asset_type === 'spice') {
        const spiceDir = `${baseDir}${prefix}_spice/`;

        let fileName = SanitizeRemoteFileComponent(
          asset.target_name === '' ? asset.name : asset.target_name,
          `${prefix}_model.cir`,
        );

        if (!fileName.toLowerCase().endsWith('.cir')) fileName += '.cir';

        if (!WriteRemoteBinaryFile(spiceDir + fileName, fetched.payload, aError)) return false;
      }
    }

    // --- Symbols ---
    for (const i of symbolIdx) {
      const asset = aManifest.assets[i]!;
      const fetched = new REMOTE_SYMBOL_FETCHED_ASSET();

      if (!(await downloadAsset(i, fetched))) return false;

      const symbolDir = `${baseDir}symbols/`;

      const libraryName = SanitizeRemoteFileComponent(
        asset.target_library === '' ? aContext.library_name : asset.target_library,
        'symbols',
        true,
      );
      const symbolName = asset.target_name === '' ? aContext.symbol_name : asset.target_name;
      const nickname = `${prefix}_${libraryName}`;

      const outFile = `${symbolDir}${nickname}.kicad_sym`;

      if (!validateSymbolPayload(fetched.payload, symbolName, aError)) return false;

      // Deserialize → mutate → save so the persisted symbol's Footprint field is
      // already pointing at the local LIB_IDs of the bundle's footprints.
      const loaded = LoadRemoteSymbolFromPayload(fetched.payload, symbolName, aError);

      if (!loaded) return false;

      loaded.SetName(symbolName);
      const savedId = new LIB_ID();
      savedId.SetLibNickname(nickname);
      savedId.SetLibItemName(symbolName);
      loaded.SetLibId(savedId);

      ApplyFootprintLinks(loaded, footprintLinks);

      if (strictLibraryTables) {
        const libMgr = this.m_frame!.GetLibraryManager();

        if (
          !EnsureRemoteLibraryEntry(
            libMgr,
            LIBRARY_TABLE_TYPE.SYMBOL,
            outFile,
            nickname,
            addToGlobal,
            true,
            aError,
          )
        )
          return false;

        if (!this.m_frame!.SaveSymbol(nickname, loaded, true)) {
          aError.value = 'Unable to save the downloaded symbol.';
          return false;
        }

        libMgr.ReloadLibraryEntry(LIBRARY_TABLE_TYPE.SYMBOL, nickname, scope);
        libMgr.LoadLibraryEntry(LIBRARY_TABLE_TYPE.SYMBOL, nickname);
      } else {
        // Headless: write the raw payload to disk so the SCH plugin's library cache
        // has an existing file to load, then re-save through the plugin to replace
        // the symbol entry with the mutated (link-applied) copy. When there are no
        // links to apply, the raw payload on disk is already correct and we skip
        // the second save.
        if (!WriteRemoteBinaryFile(outFile, fetched.payload, aError)) return false;

        if (footprintLinks.length > 0) {
          try {
            const plugin = new SCH_IO_KICAD_SEXPR(); // SCH_IO_MGR::FindPlugin( SCH_KICAD )

            plugin.SaveSymbol(outFile, loaded);
          } catch (e) {
            aError.value = `Unable to save the downloaded symbol: ${e instanceof Error ? e.message : String(e)}`;
            return false;
          }
        }
      }

      importedSymbol = true;
      placedNickname = nickname;
      placedSymbolName = symbolName;
    }

    if (aPlaceSymbol) {
      if (!importedSymbol) {
        aError.value = 'No symbol asset was available to place.';
        return false;
      }

      if (
        !(await PlaceRemoteDownloadedSymbol(this.m_frame, placedNickname, placedSymbolName, aError))
      )
        return false;
    }

    return true;
  }
}
