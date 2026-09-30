// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/cadstar/pcb_io_cadstar_archive.cpp` / `.h`: the CADSTAR PCB
 * Archive (`.cpa`) board importer, and a `.cpa` read as a footprint library.
 */

import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { fileStartsWithPrefix } from '@ziroeda/common/io/io_utils.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { atoi } from '@ziroeda/common/libc/stdlib.js';
import { BOARD } from '../../board.js';
import type { FOOTPRINT } from '../../footprint.js';
import {
  type INPUT_LAYER_DESC,
  LAYER_MAPPABLE_PLUGIN,
  type LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { CADSTAR_PCB_ARCHIVE_LOADER } from './cadstar_pcb_archive_loader.js';

export class PCB_IO_CADSTAR_ARCHIVE extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();

  /** Library path to the footprints of that library, by name (the `m_cache`). */
  private m_cache = new Map<string, Map<string, FOOTPRINT>>();
  private m_loaded_footprints: FOOTPRINT[] = [];
  private m_show_layer_mapping_warnings = true;

  constructor() {
    super('CADSTAR PCB Archive');

    this.m_layerMappable.RegisterCallback(PCB_IO_CADSTAR_ARCHIVE.DefaultLayerMappingCallback);
  }

  /**
   * Return the automapped layers: the callback used when none is registered.
   */
  static DefaultLayerMappingCallback(
    aInputLayerDescriptionVector: readonly INPUT_LAYER_DESC[],
  ): Map<string, PCB_LAYER_ID> {
    const retval = new Map<string, PCB_LAYER_ID>();

    // Just return a the auto-mapped layers
    for (const layerDesc of aInputLayerDescriptionVector) {
      // std::map::insert: the first name wins
      if (!retval.has(layerDesc.Name)) retval.set(layerDesc.Name, layerDesc.AutoMapLayer);
    }

    return retval;
  }

  RegisterCallback(aLayerMappingHandler: LAYER_MAPPING_HANDLER): void {
    this.m_layerMappable.RegisterCallback(aLayerMappingHandler);
    this.m_show_layer_mapping_warnings = false; // only show warnings with default callback
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('CADSTAR PCB Archive files', ['cpa']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return this.GetBoardFileDesc();
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    // wxFileName::GetModificationTime: there is no file system here
    return 0;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false;
  }

  override GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    return this.m_loaded_footprints.map((fp) => fp.Clone() as FOOTPRINT);
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    const board = aAppendToMe ?? new BOARD();
    this.m_loaded_footprints = [];

    const tempPCB = new CADSTAR_PCB_ARCHIVE_LOADER(
      aFileName,
      this.m_readFile(aFileName) ?? new Uint8Array(0),
      this.m_layerMappable.m_layer_mapping_handler,
      this.m_show_layer_mapping_warnings,
      this.m_progressReporter,
    );
    tempPCB.Load(board, aProject);

    //center the board:
    if (aProperties) {
      const page_width = aProperties.get('page_width') ?? '';
      const page_height = aProperties.get('page_height') ?? '';

      if (page_width !== '' && page_height !== '') {
        const bbbox = board.GetBoardEdgesBoundingBox();

        const w = atoi(page_width);
        const h = atoi(page_height);

        const desired_x = Math.trunc((w - bbbox.GetWidth()) / 2);
        const desired_y = Math.trunc((h - bbbox.GetHeight()) / 2);

        board.Move({ x: desired_x - bbbox.GetX(), y: desired_y - bbbox.GetY() });
      }
    }

    // Need to set legacy loading so that netclassess and design rules are loaded correctly
    board.m_LegacyNetclassesLoaded = true;
    board.m_LegacyDesignSettingsLoaded = true;

    this.m_loaded_footprints = tempPCB.GetLoadedLibraryFootpints();

    return board;
  }

  private checkBoardHeader(aFileName: string): boolean {
    return fileStartsWithPrefix(this.m_readFile(aFileName), '(CADSTARPCB', true);
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    return this.checkBoardHeader(aFileName);
  }

  override CanReadLibrary(aFileName: string): boolean {
    if (!super.CanReadLibrary(aFileName)) return false;

    return this.checkBoardHeader(aFileName);
  }

  override CanReadFootprint(aFileName: string): boolean {
    if (!super.CanReadFootprint(aFileName)) return false;

    return this.checkBoardHeader(aFileName);
  }

  override FootprintEnumerate(
    aFootprintNames: string[],
    aLibraryPath: string,
    _aBestEfforts: boolean,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    this.ensureLoadedLibrary(aLibraryPath);

    const lib = this.m_cache.get(aLibraryPath);

    if (!lib) return;

    // std::map<const wxString, …>: in name order
    for (const name of [...lib.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      aFootprintNames.push(name);
  }

  override FootprintExists(
    aLibraryPath: string,
    aFootprintName: string,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): boolean {
    this.ensureLoadedLibrary(aLibraryPath);

    return this.m_cache.get(aLibraryPath)?.has(aFootprintName) ?? false;
  }

  override FootprintLoad(
    aLibraryPath: string,
    aFootprintName: string,
    _aKeepUUID = false,
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    this.ensureLoadedLibrary(aLibraryPath);

    const fp = this.m_cache.get(aLibraryPath)?.get(aFootprintName);

    if (!fp) return null;

    return fp.Duplicate(false) as FOOTPRINT;
  }

  private ensureLoadedLibrary(aLibraryPath: string): void {
    if (this.m_cache.has(aLibraryPath)) return;

    const csLoader = new CADSTAR_PCB_ARCHIVE_LOADER(
      aLibraryPath,
      this.m_readFile(aLibraryPath) ?? new Uint8Array(0),
      this.m_layerMappable.m_layer_mapping_handler,
      false /*don't log stackup warnings*/,
      null,
    );

    const footprintMap = new Map<string, FOOTPRINT>();

    for (const fp of csLoader.LoadLibrary(() => new BOARD())) {
      const name = fp.GetFPID().GetLibItemName();

      if (!footprintMap.has(name)) footprintMap.set(name, fp);
    }

    this.m_cache.set(aLibraryPath, footprintMap);
  }
}
