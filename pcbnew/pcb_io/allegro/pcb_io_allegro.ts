// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright Quilter and The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/allegro/pcb_io_allegro.h` / `.cpp`: the Cadence Allegro
 * binary `.brd` board importer - phase 1 parses the file into a BRD_DB
 * (convert/allegro_parser.ts), phase 2 builds the BOARD from it
 * (allegro_builder.ts).
 */
import { THROW_IO_ERROR } from '@ziroeda/common/exceptions.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { fileHasBinaryHeader } from '@ziroeda/common/io/io_utils.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RPT_SEVERITY_ERROR, Reporter } from '@ziroeda/common/reporter.js';
import { BOARD } from '../../board.js';
import {
  type INPUT_LAYER_DESC,
  LAYER_MAPPABLE_PLUGIN,
  type LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { BOARD_BUILDER } from './allegro_builder.js';
import { PARSER } from './convert/allegro_parser.js';
import { FILE_STREAM } from './convert/allegro_stream.js';

function checkFileHeader(aData: Uint8Array | null): boolean {
  // Pre-v18 files contain the string "all" at offset 0xF8 (start of version string)
  const allegroVString = [0x61, 0x6c, 0x6c]; // 'a', 'l', 'l'
  const allegroVStringOffset = 0xf8;

  if (fileHasBinaryHeader(aData, allegroVString, allegroVStringOffset)) return true;

  // Files processed by Cadence dbdoctor replace the version string at 0xF8 with a
  // database version string (e.g. "dbd..."), so the "all" check above fails.
  // Detect these by checking the magic number at offset 0. The upper two bytes
  // of the little-endian magic identify the major Allegro format family:
  //   0x0013 = v16.x, 0x0014 = v17.x, 0x0015 = v18+
  const magicMajorOffset = 2;

  if (fileHasBinaryHeader(aData, [0x13, 0x00], magicMajorOffset)) return true;

  if (fileHasBinaryHeader(aData, [0x14, 0x00], magicMajorOffset)) return true;

  return fileHasBinaryHeader(aData, [0x15, 0x00], magicMajorOffset);
}

/**
 * `allegroDefaultLayerMappingCallback`: every layer to its auto-map. The result is a
 * `std::map`, so the first description of a name wins.
 */
function allegroDefaultLayerMappingCallback(
  aInputLayerDescriptionVector: readonly INPUT_LAYER_DESC[],
): Map<string, PCB_LAYER_ID> {
  const retval = new Map<string, PCB_LAYER_ID>();

  for (const layerDesc of aInputLayerDescriptionVector)
    if (!retval.has(layerDesc.Name)) retval.set(layerDesc.Name, layerDesc.AutoMapLayer);

  return retval;
}

export class PCB_IO_ALLEGRO extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();
  /** `&WXLOG_REPORTER::GetInstance()`: a log sink unless SetReporter replaces it. */
  private m_allegroReporter: Reporter = new Reporter();

  constructor() {
    super('Allegro');

    this.m_layerMappable.RegisterCallback(allegroDefaultLayerMappingCallback);
  }

  /** `LAYER_MAPPABLE_PLUGIN::RegisterCallback`. */
  RegisterCallback(aLayerMappingHandler: LAYER_MAPPING_HANDLER): void {
    this.m_layerMappable.RegisterCallback(aLayerMappingHandler);
  }

  override SetReporter(aReporter: Reporter | null): void {
    super.SetReporter(aReporter);
    this.m_allegroReporter = aReporter ?? new Reporter();
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Allegro binary PCB files', ['brd']);
  }

  override GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('', []);
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    return checkFileHeader(this.m_readFile(aFileName));
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  override CanReadLibrary(aFileName: string): boolean {
    if (!super.CanReadLibrary(aFileName)) return false;

    return false;
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    this.m_props = aProperties;
    const board = aAppendToMe ?? new BOARD();
    this.m_board = board;

    if (!aAppendToMe) board.SetFileName(aFileName);

    // KIPLATFORM::IO::MAPPED_FILE: the bytes the caller's reader holds
    const data = this.m_readFile(aFileName);

    if (data === null) THROW_IO_ERROR(`Failed to open file: ${aFileName}`);

    if (data.length === 0) THROW_IO_ERROR(`File is empty: ${aFileName}`);

    // Upstream returns nullptr here; the PCB_IO API returns a BOARD or throws.
    if (!this.LoadBoardFromData(data, data.length, board))
      THROW_IO_ERROR('Failed to build board from Allegro data');

    return board;
  }

  LoadBoardFromData(aData: Uint8Array, aSize: number, aBoard: BOARD): boolean {
    const allegroStream = new FILE_STREAM(aData, aSize);

    const parser = new PARSER(allegroStream, this.m_progressReporter);

    // When parsing a file "for real", encountering an unknown block is fatal, as we then
    // cannot know how long that block is, and thus can't proceed to find any later blocks.
    parser.EndAtUnknownBlock(false);

    // Import phase 1: turn the file into the C++ structs
    const brdDb = parser.Parse();

    // Import Phase 2: turn the C++ structs into the KiCad BOARD
    const builder = new BOARD_BUILDER(
      brdDb,
      aBoard,
      this.m_allegroReporter,
      this.m_progressReporter,
      this.m_layerMappable.m_layer_mapping_handler,
    );

    const phase2Ok = builder.BuildBoard();

    if (!phase2Ok) {
      this.m_allegroReporter.Report('Failed to build board from Allegro data', RPT_SEVERITY_ERROR);
      return false;
    }

    aBoard.m_LegacyNetclassesLoaded = true;
    aBoard.m_LegacyDesignSettingsLoaded = true;

    return true;
  }
}
