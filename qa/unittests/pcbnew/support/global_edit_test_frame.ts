// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A TEST_PCB_FRAME answering GLOBAL_EDIT_TOOL_FRAME: every dialog cancelled
 * and every modeless one ignored. Tests override the hook they drive.
 */
import type { DIALOG_CLEANUP_GRAPHICS } from '@ziroeda/pcbnew/dialogs/dialog_cleanup_graphics.js';
import type { DIALOG_UNUSED_PAD_LAYERS } from '@ziroeda/pcbnew/dialogs/dialog_unused_pad_layers.js';
import type { DIALOG_CLEANUP_TRACKS_AND_VIAS } from '@ziroeda/pcbnew/dialogs/dialog_cleanup_tracks_and_vias.js';
import type { DIALOG_SWAP_LAYERS } from '@ziroeda/pcbnew/dialogs/dialog_swap_layers.js';
import type { GLOBAL_EDIT_TOOL_FRAME } from '@ziroeda/pcbnew/tools/global_edit_tool.js';
import { TEST_PCB_FRAME } from './test_pcb_frame.js';

export class GLOBAL_EDIT_TEST_FRAME extends TEST_PCB_FRAME implements GLOBAL_EDIT_TOOL_FRAME {
  ShowSwapLayersDialog(_aDialog: DIALOG_SWAP_LAYERS): Promise<boolean> {
    return Promise.resolve(false);
  }

  ShowZoneManagerDialog(): Promise<{ ok: boolean; repour: boolean }> {
    return Promise.resolve({ ok: false, repour: false });
  }

  ShowCleanupTracksAndViasDialog(_aDialog: DIALOG_CLEANUP_TRACKS_AND_VIAS): void {}

  ShowCleanupGraphicsDialog(_aDialog: DIALOG_CLEANUP_GRAPHICS): void {}

  ShowUnusedPadLayersDialog(_aDialog: DIALOG_UNUSED_PAD_LAYERS): void {}
}
