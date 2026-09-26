// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `qa/pcbnew_utils/board_test_utils.cpp`'s `KI_TEST::LoadBoard`, for the DRC
 * regression suites: KiCad's own `qa/data/pcbnew` boards, read from the
 * pinned reference tree. A suite skips itself when the tree is not on disk.
 */
import { existsSync, readFileSync } from 'node:fs';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PgmOrNull, SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import { ENUM_MAP } from '@ziroeda/common/properties/property.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import '@ziroeda/pcbnew/drc/drc_test_providers.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';

/** `GetPcbnewTestDataDir()`: the reference tree's `qa/data/pcbnew/`. */
export const PCBNEW_TEST_DATA_DIR = '/home/akshay/kicad-reference/qa/data/pcbnew/';

export const HAVE_TEST_DATA = existsSync(PCBNEW_TEST_DATA_DIR);

/**
 * `KI_TEST::LoadBoard( aSettingsManager, aRelPath, aBoard )`: the project's
 * settings into the board, the DRC engine on the `.kicad_dru` beside it, the
 * net list and the connectivity built.
 */
export function LoadBoard(
  aRelPath: string,
  aSettingsManager: SETTINGS_MANAGER = PgmOrNull()?.GetSettingsManager() ?? new SETTINGS_MANAGER(),
): BOARD {
  const absPath = PCBNEW_TEST_DATA_DIR + aRelPath;
  const projectFile = `${absPath}.kicad_pro`;
  const boardPath = `${absPath}.kicad_pcb`;
  const rulesFile = `${absPath}.kicad_dru`;

  // `qa/pcbnew_utils/board_test_utils.cpp` LoadBoard: the project through the
  // manager first, then the board, then `SetProject( &aSettingsManager.Prj() )`
  // - only when there IS a project file. The legacy `.pro` branch is not here.
  const hasProject = existsSync(projectFile);

  if (hasProject)
    aSettingsManager.LoadProject(
      projectFile,
      JSON.parse(readFileSync(projectFile, 'utf8')) as JsonValue,
    );

  const board = ParseBoard(readFileSync(boardPath, 'utf8'), boardPath);

  if (hasProject) board.SetProject(aSettingsManager.Prj());

  // PCB_EDIT_FRAME::OnBoardLoaded's layer enum, which the rule language reads.
  const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');
  layerEnum.Choices().Clear();
  layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

  for (const layer of LSET.AllLayersMask()) {
    layerEnum.Map(layer, LSET.Name(layer));
    layerEnum.Map(layer, board.GetLayerName(layer));
  }

  const engine = new DRC_ENGINE(board, board.GetDesignSettings());

  if (existsSync(rulesFile)) engine.InitEngine(readFileSync(rulesFile, 'utf8'), rulesFile);
  else engine.InitEngine(null);

  board.GetDesignSettings().m_DRCEngine = engine;

  board.BuildListOfNets();
  board.BuildConnectivity();

  board.GetLengthCalculation().SynchronizeTuningProfileProperties();

  return board;
}
