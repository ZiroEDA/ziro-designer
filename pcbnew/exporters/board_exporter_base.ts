// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/exporters/board_exporter_base.h`: `BOARD_EXPORTER_BASE`, what an exporter that is not a
 * PCB_IO plugin (HyperLynx) is handed before `Run()`.
 *
 * `m_outputFilePath` names the file; the bytes go through `m_writeFile`, as IO_BASE's do, since
 * there is no filesystem to open it on.
 */
import type { IO_FILE_WRITER } from '@ziroeda/common/io/io_base.js';
import type { Reporter } from '@ziroeda/common/reporter.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import type { BOARD } from '../board.js';

export abstract class BOARD_EXPORTER_BASE {
  protected m_properties = new Map<string, string>();
  protected m_board: BOARD | null = null;
  protected m_outputFilePath = '';
  protected m_reporter: Reporter | null = null;
  protected m_progressReporter: PROGRESS_REPORTER | null = null;
  protected m_writeFile: IO_FILE_WRITER = () => {};

  SetOutputFilename(aPath: string): void {
    this.m_outputFilePath = aPath;
  }

  SetBoard(aBoard: BOARD): void {
    this.m_board = aBoard;
  }

  SetReporter(aReporter: Reporter | null): void {
    this.m_reporter = aReporter;
  }

  SetProgressReporter(aProgressReporter: PROGRESS_REPORTER | null): void {
    this.m_progressReporter = aProgressReporter;
  }

  /** Where `Run()` writes `m_outputFilePath`'s bytes. */
  SetFileWriter(aWriter: IO_FILE_WRITER): void {
    this.m_writeFile = aWriter;
  }

  abstract Run(): boolean;
}
