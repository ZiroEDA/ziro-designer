// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/altium/pcb_io_altium_circuit_studio.cpp`: `PCB_IO_ALTIUM_CIRCUIT_STUDIO`, the Altium board plugin for
 * `.CSPcbDoc` files — the Altium Designer reader over its own stream
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

export class PCB_IO_ALTIUM_CIRCUIT_STUDIO extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();

  constructor() {
    super('Altium Circuit Studio');

    this.RegisterCallback(PCB_IO_ALTIUM_DESIGNER.DefaultLayerMappingCallback);
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Altium Circuit Studio PCB files', ['CSPcbDoc']);
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
      [ALTIUM_PCB_DIR.ARCS6, '00C595EB90524FFC8C3BD9670020A2'],
      [ALTIUM_PCB_DIR.BOARD6, '88857D7F1DF64F7BBB61848C965636'],
      [ALTIUM_PCB_DIR.BOARDREGIONS, '8957CF30F167408D9D263D23FE7C89'],
      [ALTIUM_PCB_DIR.CLASSES6, '847EFBF87A5149B1AA326A52AD6357'],
      [ALTIUM_PCB_DIR.COMPONENTS6, '465416896A15486999A39C643935D2'],
      [ALTIUM_PCB_DIR.COMPONENTBODIES6, '1849D9B5512D452A93EABF4E40B122'], // or B6AD30D75241498BA2536EBF001752 ?
      [ALTIUM_PCB_DIR.DIMENSIONS6, '16C81DBC13C447FF8B42A426677F3C'],
      [ALTIUM_PCB_DIR.FILLS6, '4E83BDC3253747F08E9006D7F57020'],
      [ALTIUM_PCB_DIR.MODELS, 'C0F7599ECC6A4D648DF5BB557679AF'],
      [ALTIUM_PCB_DIR.NETS6, 'D95A0DA2FE9047779A5194C127F30B'],
      [ALTIUM_PCB_DIR.PADS6, '47D69BC5107A4B8DB8DAA23E39C238'],
      [ALTIUM_PCB_DIR.POLYGONS6, 'D7038392280E4E229B9D9B5426B295'],
      [ALTIUM_PCB_DIR.REGIONS6, 'FFDDC21382BB42FE8A7D0C328D272C'],
      [ALTIUM_PCB_DIR.RULES6, '48B2FA96DB7546818752B34373D6C6'],
      [ALTIUM_PCB_DIR.SHAPEBASEDREGIONS6, 'D5F54B536E124FB89E2D51B1121508'],
      [ALTIUM_PCB_DIR.TEXTS6, '349ABBB211DB4F5B8AE41B1B49555A'],
      [ALTIUM_PCB_DIR.TRACKS6, '530C20C225354B858B2578CAB8C08D'],
      [ALTIUM_PCB_DIR.VIAS6, 'CA5F5989BCDB404DA70A9D1D3D5758'],
      [ALTIUM_PCB_DIR.WIDESTRINGS6, '87FBF0C5BC194B909FF42199450A76'],
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
