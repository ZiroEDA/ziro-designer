// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `qa/pcbnew_utils/board_test_utils.cpp`'s `KI_TEST::LoadBoard`, for the DRC
 * regression suites: KiCad's own `qa/data/pcbnew` boards, read from the
 * pinned reference tree. A suite skips itself when the tree is not on disk.
 */
import { existsSync, readFileSync } from 'node:fs';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { ENUM_MAP } from '@ziroeda/common/src/properties/property.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import '@ziroeda/pcbnew/src/drc/drc_test_providers.js';
import { ParseBoard } from '@ziroeda/pcbnew/src/read-board.js';

/** `GetPcbnewTestDataDir()`: the reference tree's `qa/data/pcbnew/`. */
export const PCBNEW_TEST_DATA_DIR = '/home/akshay/kicad-reference/qa/data/pcbnew/';

export const HAVE_TEST_DATA = existsSync(PCBNEW_TEST_DATA_DIR);

/**
 * `KI_TEST::LoadBoard( aSettingsManager, aRelPath, aBoard )`: the project's
 * settings into the board, the DRC engine on the `.kicad_dru` beside it, the
 * net list and the connectivity built.
 */
export function LoadBoard(aRelPath: string): BOARD {
  const absPath = PCBNEW_TEST_DATA_DIR + aRelPath;
  const projectFile = `${absPath}.kicad_pro`;
  const boardPath = `${absPath}.kicad_pcb`;
  const rulesFile = `${absPath}.kicad_dru`;

  const board = ParseBoard(readFileSync(boardPath, 'utf8'), boardPath);

  // SETTINGS_MANAGER::LoadProject + BOARD::SetProject: the project file's
  // board.design_settings and net_settings become the board's.
  if (existsSync(projectFile)) {
    const pro = JSON.parse(readFileSync(projectFile, 'utf8')) as Record<string, unknown>;
    const boardJ = (pro.board ?? {}) as Record<string, unknown>;

    if (boardJ.design_settings !== undefined)
      board.GetDesignSettings().LoadFromJson(boardJ.design_settings);
    if (pro.net_settings !== undefined)
      board.GetDesignSettings().m_NetSettings.LoadFromJson(pro.net_settings);
  }

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

  // aBoard->GetLengthCalculation()->SynchronizeTuningProfileProperties(): not ported.

  return board;
}
