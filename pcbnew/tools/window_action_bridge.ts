// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * TRANSITIONAL (#636 stage 3) - not KiCad code, and deleted piece by piece.
 *
 * `PCB_SELECTION_TOOL` is ported whole and runs on the live BOARD, but some of
 * the actions it runs belong to tools that are not ported yet: a drag starts
 * `PCB_ACTIONS::move` (EDIT_TOOL), a double click `PCB_ACTIONS::properties`
 * (EDIT_TOOL), a Ctrl+click `PCB_ACTIONS::highlightNet` (BOARD_INSPECTION_TOOL),
 * a middle double click `ACTIONS::zoomFitScreen` (COMMON_TOOLS). Until each of
 * those tools lands, this tool answers its actions by handing them to the
 * window, which still implements them.
 *
 * Every action listed here is removed in the commit that ports its tool; when
 * the list is empty, this file is deleted.
 */
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { PCB_ACTIONS } from './pcb_actions.js';

/** The window's implementation of an action whose tool is not ported. */
export type WINDOW_ACTION_HANDLER = (aAction: TOOL_ACTION, aEvent: TOOL_EVENT) => void;

/** The actions the window still answers, by the tool that will take each over. */
export const WINDOW_BRIDGED_ACTIONS: readonly TOOL_ACTION[] = [
  // EDIT_TOOL
  PCB_ACTIONS.move,
  PCB_ACTIONS.moveIndividually,
  PCB_ACTIONS.drag45Degree,
  PCB_ACTIONS.dragFreeAngle,
  PCB_ACTIONS.properties,
  // BOARD_INSPECTION_TOOL
  PCB_ACTIONS.highlightNet,
  // COMMON_TOOLS
  ACTIONS.zoomFitScreen,
  ACTIONS.zoomFitObjects,
];

export class WINDOW_ACTION_BRIDGE extends TOOL_INTERACTIVE {
  private readonly m_handler: WINDOW_ACTION_HANDLER;

  constructor(aHandler: WINDOW_ACTION_HANDLER) {
    super('pcbnew.WindowActionBridge');
    this.m_handler = aHandler;
  }

  override Reset(_aReason: RESET_REASON): void {}

  protected setTransitions(): void {
    for (const action of WINDOW_BRIDGED_ACTIONS) {
      this.Go(
        SYNC_HANDLER((aEvent: TOOL_EVENT): number => {
          this.m_handler(action, aEvent);
          return 0;
        }),
        action.MakeEvent(),
      );
    }
  }
}
