// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup over text fixtures: the board through the parser, the project
 * through a SETTINGS_MANAGER, the panels' transfers over the live objects,
 * and the board back out through the writer.
 */
import { SETTINGS_MANAGER } from '@ziroeda/common/src/pgm_base.js';
import type { PROJECT } from '@ziroeda/common/src/project.js';
import { DumpJson } from '@ziroeda/common/src/settings/json_dump.js';
import type { JsonValue } from '@ziroeda/common/src/settings/json_settings.js';
import {
  BoardSetupFromWindow,
  BoardSetupToWindow,
} from '@ziroeda/designer/src/editors/pcb/dialogs/board_setup_transfer.js';
import type { BoardSetupValues } from '@ziroeda/designer/src/editors/pcb/board_settings.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';

export interface SetupFixture {
  board: BOARD;
  project: PROJECT;
  manager: SETTINGS_MANAGER;
  values: BoardSetupValues;
}

/** `SETTINGS_MANAGER::LoadProject` + `BOARD::SetProject` + every TransferDataToWindow. */
export function readSetup(
  aPcbText: string,
  aPro: JsonValue | null = null,
  aDru = '',
): SetupFixture {
  const board = ParseBoard(aPcbText, '/p/x.kicad_pcb');
  const manager = new SETTINGS_MANAGER();
  manager.LoadProject('/p/x.kicad_pro', aPro);
  const project = manager.Prj();
  board.SetProject(project);
  return { board, project, manager, values: BoardSetupToWindow(board, project, aDru) };
}

/** Every TransferDataFromWindow, then the board as `.kicad_pcb` text. */
export function writeSetup(f: SetupFixture, aValues: BoardSetupValues = f.values): string {
  BoardSetupFromWindow(aValues, f.board, f.project);
  return FormatBoard(f.board);
}

/** Every TransferDataFromWindow, then the project as `.kicad_pro` text. */
export function writeProject(f: SetupFixture, aValues: BoardSetupValues = f.values): string {
  BoardSetupFromWindow(aValues, f.board, f.project);
  return DumpJson(f.manager.SaveProject(f.project)!.pro);
}
