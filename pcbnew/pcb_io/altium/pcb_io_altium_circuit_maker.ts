// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/altium/pcb_io_altium_circuit_maker.cpp`: `PCB_IO_ALTIUM_CIRCUIT_MAKER`, the Altium board plugin for
 * `.CMPcbDoc` files — the Altium Designer reader over its own stream
 * directory names (`loadAltiumBoard`, see pcb_io_altium_designer.ts).
 */

import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { BOARD } from '../../board.js';
import {
  LAYER_MAPPABLE_PLUGIN,
  type LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { ALTIUM_PCB_DIR } from './altium_pcb.js';
import { PCB_IO_ALTIUM_DESIGNER, loadAltiumBoard } from './pcb_io_altium_designer.js';

export class PCB_IO_ALTIUM_CIRCUIT_MAKER extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();

  constructor() {
    super('Altium Circuit Maker');

    this.RegisterCallback(PCB_IO_ALTIUM_DESIGNER.DefaultLayerMappingCallback);
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Altium Circuit Maker PCB files', ['CMPcbDoc']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    // No library description for this plugin
    return new IO_FILE_DESC('', []);
  }

  RegisterCallback(aLayerMappingHandler: LAYER_MAPPING_HANDLER): void {
    this.m_layerMappable.RegisterCallback(aLayerMappingHandler);
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    return PCB_IO_ALTIUM_DESIGNER.checkFileHeader(this.m_readFile(aFileName));
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    this.m_props = aProperties;

    const board = aAppendToMe ?? new BOARD();
    this.m_board = board;

    // Give the filename to the board if it's new
    if (!aAppendToMe) board.SetFileName(aFileName);

    const mapping = new Map<ALTIUM_PCB_DIR, string>([
      [ALTIUM_PCB_DIR.FILE_HEADER, 'FileHeader'],
      [ALTIUM_PCB_DIR.ARCS6, '1CEEB63FB33847F8AFC4485F64735E'],
      [ALTIUM_PCB_DIR.BOARD6, '96B09F5C6CEE434FBCE0DEB3E88E70'],
      [ALTIUM_PCB_DIR.BOARDREGIONS, 'E3A544335C30403A991912052C936F'],
      [ALTIUM_PCB_DIR.CLASSES6, '4F71DD45B09143988210841EA1C28D'],
      [ALTIUM_PCB_DIR.COMPONENTS6, 'F9D060ACC7DD4A85BC73CB785BAC81'],
      [ALTIUM_PCB_DIR.COMPONENTBODIES6, '44D9487C98CE4F0EB46AB6E9CDAF40'], // or: A0DB41FBCB0D49CE8C32A271AA7EF5 ?
      [ALTIUM_PCB_DIR.DIMENSIONS6, '068B9422DBB241258BA2DE9A6BA1A6'],
      [ALTIUM_PCB_DIR.FILLS6, '6FFE038462A940E9B422EFC8F5D85E'],
      [ALTIUM_PCB_DIR.MODELS, '0DB009C021D946C88F1B3A32DAE94B'],
      [ALTIUM_PCB_DIR.NETS6, '35D7CF51BB9B4875B3A138B32D80DC'],
      [ALTIUM_PCB_DIR.PADS6, '4F501041A9BC4A06BDBDAB67D3820E'],
      [ALTIUM_PCB_DIR.POLYGONS6, 'A1931C8B0B084A61AA45146575FDD3'],
      [ALTIUM_PCB_DIR.REGIONS6, 'F513A5885418472886D3EF18A09E46'],
      [ALTIUM_PCB_DIR.RULES6, 'C27718A40C94421388FAE5BD7785D7'],
      [ALTIUM_PCB_DIR.SHAPEBASEDREGIONS6, 'BDAA2C70289849078C8EBEEC7F0848'],
      [ALTIUM_PCB_DIR.TEXTS6, 'A34BC67C2A5F408D8F377378C5C5E2'],
      [ALTIUM_PCB_DIR.TRACKS6, '412A754DBB864645BF01CD6A80C358'],
      [ALTIUM_PCB_DIR.VIAS6, 'C87A685A0EFA4A90BEEFD666198B56'],
      [ALTIUM_PCB_DIR.WIDESTRINGS6, 'C1C6540EA23C48D3BF8F9A4ABB9D6D'],
    ]);

    loadAltiumBoard(
      aFileName,
      board,
      mapping,
      this.m_readFile,
      this.m_progressReporter,
      this.m_layerMappable.m_layer_mapping_handler,
      this.m_reporter,
      aProperties,
      aProject,
    );

    return board;
  }
}
