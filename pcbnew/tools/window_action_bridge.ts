// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * TRANSITIONAL (#636 stage 3) - not KiCad code, and deleted piece by piece.
 *
 * PCB_SELECTION_TOOL and EDIT_TOOL are ported whole and run on the live
 * BOARD, but some of the actions they run belong to tools that are not ported
 * yet: a router drag `PCB_ACTIONS::routerInlineDrag` (ROUTER_TOOL), a middle
 * double click `ACTIONS::zoomFitScreen` (COMMON_TOOLS). Until each of
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
import {
  type wxEvent,
  wxEVT_AUX1_UP,
  wxEVT_AUX2_UP,
  wxEVT_LEFT_UP,
  wxEVT_MIDDLE_UP,
  wxEVT_RIGHT_UP,
} from '@ziroeda/common/wx/wx_event.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import type { ROUTER_TOOL_LIKE } from './edit_tool.js';

/** The window's implementation of an action whose tool is not ported. */
export type WINDOW_ACTION_HANDLER = (aAction: TOOL_ACTION, aEvent: TOOL_EVENT) => void;

/** The actions the window still answers, by the tool that will take each over. */
export const WINDOW_BRIDGED_ACTIONS: readonly TOOL_ACTION[] = [
  // ROUTER_TOOL: EDIT_TOOL::invokeInlineRouter's drag
  PCB_ACTIONS.routerInlineDrag,
  // BOARD_EDITOR_CONTROL::PageSettings
  ACTIONS.pageSettings,
  // ARRAY_TOOL::CreateArray, run from CONVERT_TOOL's "Create from Selection"
  PCB_ACTIONS.createArray,
  // COMMON_TOOLS
  ACTIONS.zoomFitScreen,
  ACTIONS.zoomFitObjects,
];

export class WINDOW_ACTION_BRIDGE extends TOOL_INTERACTIVE {
  private readonly m_handler: WINDOW_ACTION_HANDLER;
  private readonly m_router: () => ROUTER_TOOL_LIKE | null;

  constructor(
    aHandler: WINDOW_ACTION_HANDLER,
    aRouter: () => ROUTER_TOOL_LIKE | null = () => null,
  ) {
    super('pcbnew.WindowActionBridge');
    this.m_handler = aHandler;
    this.m_router = aRouter;
  }

  /** ROUTER_TOOL's state, as EDIT_TOOL asks it, while the router is the window's. */
  Router(): ROUTER_TOOL_LIKE | null {
    return this.m_router();
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

/**
 * TRANSITIONAL (#636 stage 3): the frame's TOOL_DISPATCHER, with the window's
 * own tools' events kept off it (`aToWindow`).
 *
 * A gesture the window takes over can start in the middle of a press the
 * dispatcher saw begin: the selection tool's drag branch runs
 * `PCB_ACTIONS::move`, the window's move then owns the pointer, and the
 * button's release goes to the window. The dispatcher, never seeing that
 * release, would keep the button pressed and dragging - its next press is then
 * not a press at all, the pointer's motion is a drag, and the selection tool
 * sits in SelectRectArea for good. So a release the window takes also resets
 * the dispatcher's button state, as `TOOL_DISPATCHER::ResetState` does when
 * the canvas loses the focus.
 */
export function makeGatedDispatcher(
  aDispatcher: { DispatchWxEvent(aEvent: wxEvent): void; ResetState(): void },
  aToWindow: (aEvent: wxEvent) => boolean,
  aAfter: () => void = () => {},
): { DispatchWxEvent(aEvent: wxEvent): void; ResetState(): void } {
  return {
    DispatchWxEvent: (aEvent: wxEvent): void => {
      if (aToWindow(aEvent)) {
        if (BUTTON_UP_EVENTS.includes(aEvent.GetEventType())) aDispatcher.ResetState();

        aEvent.Skip();
        return;
      }

      aDispatcher.DispatchWxEvent(aEvent);
      aAfter();
    },
    ResetState: (): void => aDispatcher.ResetState(),
  };
}

const BUTTON_UP_EVENTS = [
  wxEVT_LEFT_UP,
  wxEVT_RIGHT_UP,
  wxEVT_MIDDLE_UP,
  wxEVT_AUX1_UP,
  wxEVT_AUX2_UP,
];
