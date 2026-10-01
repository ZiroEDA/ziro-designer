// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcb_io_pcad.cpp` / `.h`: the P-CAD 200x ASCII (`.pcb`)
 * board importer.
 */

import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { fileStartsWithPrefix } from '@ziroeda/common/io/io_utils.js';
import { BOARD } from '../../board.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { PCAD_PCB } from './pcad_pcb.js';
import { LoadInputFile } from './s_expr_loader.js';

export class PCB_IO_PCAD extends PCB_IO {
  constructor() {
    super('P-Cad');
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('P-Cad 200x ASCII PCB files', ['pcb']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    // No library description for this plugin
    return new IO_FILE_DESC('', []);
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    return fileStartsWithPrefix(this.m_readFile(aFileName), 'ACCEL_ASCII', false);
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    this.m_props = aProperties;

    const board = aAppendToMe ?? new BOARD();

    // Give the filename to the board if it's new
    if (!aAppendToMe) board.SetFileName(aFileName);

    const pcb = new PCAD_PCB(board);

    const root = LoadInputFile(this.m_readFile(aFileName), aFileName);
    pcb.ParseBoard(root, 'PCB');
    pcb.AddToBoard();

    return board;
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }
}
