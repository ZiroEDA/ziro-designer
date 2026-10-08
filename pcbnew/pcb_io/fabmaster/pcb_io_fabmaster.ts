// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/fabmaster/pcb_io_fabmaster.cpp` / `.h`: the Fabmaster
 * (Cadence Allegro extracta, `.txt` / `.fab`) board importer.
 */

import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { BOARD } from '../../board.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';
import { FABMASTER } from './import_fabmaster.js';

export class PCB_IO_FABMASTER extends PCB_IO {
  private readonly m_fabmaster = new FABMASTER();

  constructor() {
    super('Fabmaster');
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Fabmaster PCB files', ['txt', 'fab']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    // No library description for this plugin
    return new IO_FILE_DESC('', []);
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    const data = this.m_readFile(aFileName);

    if (!data) return false;

    const keywords = [
      'REFDES',
      'COMPCLASS',
      'NETNAME',
      'SUBCLASS',
      'GRAPHICDATANAME',
      'SYMNAME',
      'PINNAME',
      'VIAX',
      'PADSHAPENAME',
      'PADNAME',
      'LAYERSORT',
    ];

    // std::getline over the first 100 lines
    let linesRead = 0;
    let pos = 0;

    while (pos < data.length && linesRead < 100) {
      let end = data.indexOf(0x0a, pos);

      if (end < 0) end = data.length;

      let line = '';

      for (let i = pos; i < end; i++) line += String.fromCharCode(data[i]!);

      pos = end + 1;
      linesRead++;

      let delimCount = 0;

      for (const ch of line) if (ch === '!') delimCount++;

      if (delimCount < 2) continue;

      // ::toupper in the C locale
      const upper = line.replace(/[a-z]/g, (c) => c.toUpperCase());

      for (const kw of keywords) if (upper.includes(kw)) return true;
    }

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

    // Give the filename to the board if it's new
    if (!aAppendToMe) board.SetFileName(aFileName);

    if (this.m_progressReporter) {
      this.m_progressReporter.Report(`Loading ${aFileName}...`);

      if (!this.m_progressReporter.KeepRefreshing())
        throw new IO_ERROR('File import canceled by user.');
    }

    if (!this.m_fabmaster.Read(this.m_readFile(aFileName), aFileName))
      throw new IO_ERROR(`Could not read file ${aFileName}`);

    this.m_fabmaster.Process();
    this.m_fabmaster.LoadBoard(board, this.m_progressReporter);

    return board;
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }
}
