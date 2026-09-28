// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_PROPERTIES_PANEL on a board read from text, for a test that asks what
 * the Properties pane shows for one item and what an edit does to it.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  PCB_PROPERTIES_PANEL,
  type PCB_GRID_ROW,
} from '@ziroeda/pcbnew/widgets/pcb_properties_panel.js';
import { TEST_PCB_FRAME } from './test_pcb_frame.js';

export interface LIVE_PANEL {
  board: BOARD;
  frame: TEST_PCB_FRAME;
  /** The grid for the item, re-read (UpdateData) on every call. */
  rows(): PCB_GRID_ROW[];
  /** Commit `aValue` to the named row; false when the grid refused it. */
  set(aName: string, aValue: string | number | boolean): boolean;
  /** The board as the writer formats it now. */
  written(): string;
}

export function livePanel(aText: string, aPick: (aBoard: BOARD) => EDA_ITEM): LIVE_PANEL {
  const board = ParseBoard(aText);
  const frame = new TEST_PCB_FRAME(board);
  const item = aPick(board);
  const panel = new PCB_PROPERTIES_PANEL(frame);
  panel.SetSelectionProvider(() => [item]);

  const rows = (): PCB_GRID_ROW[] => {
    panel.UpdateData();
    return panel.GridRows({ units: 'mm', iuScale: pcbIUScale });
  };

  return {
    board,
    frame,
    rows,
    set(aName, aValue) {
      const edit = rows()
        .find((r) => r.name === aName)
        ?.set?.(aValue);
      if (!edit) return false;
      edit();
      return true;
    },
    written: () => FormatBoard(board),
  };
}
