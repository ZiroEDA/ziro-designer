// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/altium/pcb_io_solidworks.cpp`: `PCB_IO_SOLIDWORKS`, the Altium board plugin for
 * `.SWPcbDoc` files — the Altium Designer reader over its own stream
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

export class PCB_IO_SOLIDWORKS extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();

  constructor() {
    super('Solidworks PCB');

    this.RegisterCallback(PCB_IO_ALTIUM_DESIGNER.DefaultLayerMappingCallback);
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Solidworks PCB files', ['SWPcbDoc']);
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
      [ALTIUM_PCB_DIR.ARCS6, 'D2864697BB2D411B857EBD69D74447'],
      [ALTIUM_PCB_DIR.BOARD6, '21CE7E3D9BFF41679BACA1184CAF54'],
      [ALTIUM_PCB_DIR.BOARDREGIONS, '67075A4119214CE4AB174F9B1A9A41'],
      [ALTIUM_PCB_DIR.CLASSES6, '1122D4F14A924F9CA5C2060AF370E0'],
      [ALTIUM_PCB_DIR.COMPONENTS6, '208CAE8E44BD43D5B3CCA426D9331B'],
      [ALTIUM_PCB_DIR.COMPONENTBODIES6, '6DDF94E6CB364893BED31C189F9AF3'],
      [ALTIUM_PCB_DIR.DIMENSIONS6, '6148AE8C77B042798B46830E96BB24'],
      [ALTIUM_PCB_DIR.FILLS6, '5944DE0E258C41E2B0B382AC964048'],
      [ALTIUM_PCB_DIR.MODELS, '874F98A7E25A48EDAD394EB891E503'],
      [ALTIUM_PCB_DIR.NETS6, '0201837ACD434D55B34BBC68B75BAB'],
      [ALTIUM_PCB_DIR.PADS6, 'E4D0C33E25824886ABC7FEEAE7B521'],
      [ALTIUM_PCB_DIR.POLYGONS6, '7ABD4252549749DD8DB16804819AC3'],
      [ALTIUM_PCB_DIR.REGIONS6, '6B3892541AB94CD999291D590B5C86'], // probably wrong; in as a placeholder
      [ALTIUM_PCB_DIR.RULES6, '7009830ADF65423FA6CCB73A77E710'],
      [ALTIUM_PCB_DIR.SHAPEBASEDREGIONS6, '91241C66300E4490965070BA56F6F7'],
      [ALTIUM_PCB_DIR.TEXTS6, '4AF3D139533041489C2A57BBF9890D'],
      [ALTIUM_PCB_DIR.TRACKS6, '5D0C6E18E16A4BBFAA256C24B79EAE'],
      [ALTIUM_PCB_DIR.VIAS6, '2AF5387F097242D3A1095B6FAC3397'],
      [ALTIUM_PCB_DIR.WIDESTRINGS6, '9B378679AF85466C8673A41EE46393'],
      // Understood but not needed:
      // 04A8F96E0E4C478C813AE57CACCD0F - Legacy text storage
      // 01F1BD1AA06E4D6A9D1ABF0BBFF4A4 - Fwd/Back compatibility messages
      //
      // Not yet used by KiCad:
      // 7C01505E39124E67BCCAB1883B8FB7 - Design Rule Checker Options6
      // 63B31A3709B54882BFA96424906BE8 - EmbeddedFonts6
      // 8B83C7E94C1D419B9B2D5505479820 - Pin Swap Options6
      // F78C10230A794F5C93ACB50AC693B2 - Advanced Placer Options6
      //
      // No data yet on:
      // 1C0DB1ED572645BEB65D029D20406C
      // 2AA5C1C72BF14315A47DD931B84A79
      // 6468C28D32CC4867AB374091CC8431
      // 6B3892541AB94CD999291D590B5C86
      // 8675F4105E444E6D9B2BEE6273769D
      // B983FCC2B6DE46E0B94006B6393235
      // D6551D22B6DB44659C3F32F7E1949D
      //
      // Not yet identified:
      // D06DD2E4A51C4A3EA96D9ED8C8F3F3
      // F9C465994DE840579ED19E820C19C2
      //
      // Region-like objects that don't map cleanly (maybe Solidworks sketches?)
      // 84958494F3F54075975C4E199DB8EB
      // 2E731D36D1F049428744F0661F3E44
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
