// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A PCB_EDIT_FRAME without the window: the model, the settings, the colour
 * theme and the tool manager — what a BOARD_COMMIT and a dialog's transfer
 * ask the frame for.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/board_item_container.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

export class TEST_PCB_FRAME extends PCB_BASE_EDIT_FRAME {
  readonly settings = new PCBNEW_SETTINGS();
  /** The theme, without a PGM_BASE to ask for it. */
  readonly colors = new COLOR_SETTINGS('test');
  /** PCB_EDIT_FRAME's cross-probe guard, which BOARD_EDITOR_CONTROL reads. */
  m_ProbingSchToPcb = false;
  /** What BOARD_EDITOR_CONTROL::doCrossProbePcbToSch would have mailed. */
  readonly sentToSch: { items: EDA_ITEM[]; focus: EDA_ITEM | null; force: boolean }[] = [];

  constructor(board: BOARD, type = FRAME_T.FRAME_PCB_EDITOR) {
    super(type);
    this.SetBoard(board);
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(board, null, null, this.settings, this);
  }

  GetName(): string {
    return 'PcbFrame';
  }
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.settings;
  }
  override GetColorSettings(): COLOR_SETTINGS {
    return this.colors;
  }
  /** `PCB_EDIT_FRAME::SendSelectItemsToSch`, recorded: there is no schematic. */
  SendSelectItemsToSch(
    aItems: Iterable<EDA_ITEM>,
    aFocusItem: EDA_ITEM | null,
    aForce: boolean,
  ): void {
    this.sentToSch.push({ items: [...aItems], focus: aFocusItem, force: aForce });
  }
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }
}
