// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_INTERACTIVE` (include/tool/tool_interactive.h,
 * common/tool/tool_interactive.cpp): a tool with an event loop — it
 * registers state handlers with `Go()` and suspends in `Wait()` until the
 * manager wakes it with a matching event.
 */
import type { COROUTINE_BODY } from './coroutine.js';
import { TOOL_BASE, type TOOL_ID, type TOOL_STATE_FUNC, TOOL_TYPE } from './tool_base.js';
import {
  CONTEXT_MENU_TRIGGER,
  TA_ACTION,
  TA_ANY,
  TC_ANY,
  TC_MESSAGE,
  TOOL_EVENT,
  TOOL_EVENT_LIST,
} from './tool_event.js';
import { TOOL_MANAGER } from './tool_manager.js';
import type { ACTION_MENU } from './action_menu.js';
import { TOOL_MENU } from './tool_menu.js';

/**
 * A C++ handler is a plain `int f( const TOOL_EVENT& )`; a state function
 * here is a coroutine body. A handler that never waits is wrapped in a
 * generator that returns its result at once.
 */
export function SYNC_HANDLER<T extends TOOL_INTERACTIVE>(
  f: (this: T, aEvent: TOOL_EVENT) => number,
): TOOL_STATE_FUNC {
  // biome-ignore lint/correctness/useYield: a plain handler, returned as a finished coroutine
  return function* (this: T, aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return f.call(this, aEvent);
  } as TOOL_STATE_FUNC;
}

export abstract class TOOL_INTERACTIVE extends TOOL_BASE {
  protected m_menu: TOOL_MENU;

  /**
   * Create a tool with given id & name. The name must be unique.
   */
  constructor(aId: TOOL_ID, aName: string);
  /**
   * Create a tool with given name. The name must be unique.
   */
  constructor(aName: string);
  constructor(a: TOOL_ID | string, b?: string) {
    super(
      TOOL_TYPE.INTERACTIVE,
      typeof a === 'string' ? TOOL_MANAGER.MakeToolId(a) : a,
      typeof a === 'string' ? a : b!,
    );
    // if( Pgm().IsGUI() ) m_menu.reset( new TOOL_MENU( *this ) ): a page is always a GUI.
    this.m_menu = new TOOL_MENU(this);
  }

  /**
   * Run the tool.
   *
   * After activation, the tool starts receiving events until it is finished.
   */
  Activate(): void {
    this.m_toolMgr!.InvokeTool(this.m_toolId);
  }

  GetToolMenu(): TOOL_MENU {
    return this.m_menu;
  }

  /**
   * Assign a context menu and tells when it should be activated.
   *
   * @param aMenu is the menu to be assigned.
   * @param aTrigger determines conditions upon which the context menu is activated.
   */
  SetContextMenu(
    aMenu: ACTION_MENU | null,
    aTrigger: CONTEXT_MENU_TRIGGER = CONTEXT_MENU_TRIGGER.CMENU_BUTTON,
  ): void {
    if (aMenu) aMenu.SetTool(this);
    else aTrigger = CONTEXT_MENU_TRIGGER.CMENU_OFF;

    this.m_toolMgr!.ScheduleContextMenu(this, aMenu, aTrigger);
  }

  /**
   * Call a function using the main stack.
   *
   * @param aFunc is the function to be calls.
   */
  RunMainStack(aFunc: () => void): void {
    this.m_toolMgr!.RunMainStack(this, aFunc);
  }

  /**
   * `RunMainStack( [&]() { result = dialog.ShowModal(); } )` for a dialog that
   * answers asynchronously, as every dialog does in a browser. The C++ blocks
   * the coroutine inside the modal loop; here the coroutine waits until the
   * dialog's promise settles, which posts a message to wake it. Nothing reaches
   * the canvas while a modal is up, and any event that does arrive meanwhile is
   * dropped, as the modal loop would have swallowed it. Answers null when the
   * tool is torn down before the dialog closes.
   */
  *RunMainStackModal<T>(aShow: () => Promise<T>): COROUTINE_BODY<T | null> {
    let settled = false;
    let value: T | null = null;

    const wake = new TOOL_EVENT(TC_MESSAGE, TA_ACTION, 'common.Interactive.modalClosed');

    void aShow().then(
      (v) => {
        value = v;
        settled = true;
        this.m_toolMgr!.PostEvent(wake);
      },
      () => {
        settled = true;
        this.m_toolMgr!.PostEvent(wake);
      },
    );

    while (!settled) {
      const evt = yield* this.Wait();

      if (!evt) return null;
    }

    return value;
  }

  /**
   * Define which state (aStateFunc) to go to when a certain event arrives (aConditions).
   *
   * No conditions means any event.
   */
  Go(
    aStateFunc: TOOL_STATE_FUNC,
    aConditions: TOOL_EVENT_LIST | TOOL_EVENT = new TOOL_EVENT(TC_ANY, TA_ANY),
  ): void {
    // std::bind( aStateFunc, static_cast<T*>( this ), _1 )
    const sptr: TOOL_STATE_FUNC = (aEvent: TOOL_EVENT) => aStateFunc.call(this, aEvent);
    this.goInternal(
      sptr,
      aConditions instanceof TOOL_EVENT ? new TOOL_EVENT_LIST(aConditions) : aConditions,
    );
  }

  /**
   * Suspend execution of the tool until an event specified in aEventList arrives.
   *
   * No parameters means waiting for any event. In the C++ this blocks the
   * coroutine; here it is `yield* this.Wait(…)` (see COROUTINE).
   */
  *Wait(
    aEventList: TOOL_EVENT_LIST | TOOL_EVENT = new TOOL_EVENT(TC_ANY, TA_ANY),
  ): COROUTINE_BODY<TOOL_EVENT | null> {
    return yield* this.m_toolMgr!.ScheduleWait(
      this,
      aEventList instanceof TOOL_EVENT ? new TOOL_EVENT_LIST(aEventList) : aEventList,
    );
  }

  /**
   * This method is meant to be overridden in order to specify handlers for events.
   *
   * It is called every time tool is reset or finished.
   */
  protected abstract setTransitions(): void;

  /**
   * Clear the current transition map and restores the default one created by setTransitions().
   */
  resetTransitions(): void {
    this.m_toolMgr!.ClearTransitions(this);
    this.setTransitions();
  }

  private goInternal(aState: TOOL_STATE_FUNC, aConditions: TOOL_EVENT_LIST): void {
    this.m_toolMgr!.ScheduleNextState(this, aState, aConditions);
  }
}
