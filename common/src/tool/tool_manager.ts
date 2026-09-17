// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_MANAGER` (include/tool/tool_manager.h, common/tool/tool_manager.cpp):
 * registers the tools, owns their execution state, and dispatches every
 * event and action to them. A tool's handler runs in a COROUTINE (a
 * generator here), suspended in `ScheduleWait` and resumed on the event it
 * waits for.
 *
 * What a browser has no counterpart for: `RunSynchronousAction`'s
 * `wxYield()` spin (there is no nested event loop, so a synchronous action
 * that waits for input cannot block its caller), and `DispatchContextMenu`'s
 * modal `PopupMenu` — the context menu is a promise the designer's menu
 * resolves, which is stage 3's `ACTION_MENU`.
 */
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import type { COMMIT } from '../commit.js';
import type { EDA_ITEM } from '../eda_item.js';
import type { VIEW } from '../view/view.js';
import type { VC_SETTINGS, VIEW_CONTROLS } from '../view/view_controls.js';
import { ACTION_MANAGER } from './action_manager.js';
import { COROUTINE } from './coroutine.js';
import {
  RESET_REASON,
  type TOOL_BASE,
  type TOOL_ID,
  type TOOL_STATE_FUNC,
  TOOL_TYPE,
} from './tool_base.js';
import { TOOL_INTERACTIVE, type ACTION_MENU } from './tool_interactive.js';
import type { TOOL_ACTION } from './tool_action.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  CONTEXT_MENU_TRIGGER,
  SYNCRONOUS_TOOL_STATE,
  type SYNCRONOUS_TOOL_STATE_CELL,
  TA_ACTIVATE,
  TA_ANY,
  TA_CANCEL_TOOL,
  TA_CHOICE_MENU_CHOICE,
  TA_CHOICE_MENU_CLOSED,
  TA_KEY_PRESSED,
  TA_PRIME,
  TC_ANY,
  TC_COMMAND,
  TC_MESSAGE,
  TC_MOUSE,
  TOOL_EVENT,
  TOOL_EVENT_LIST,
} from './tool_event.js';
import type { TOOLS_HOLDER } from './tools_holder.js';

/** `KIGFX::VIEW_CONTROLS` as the manager drives it. */
export type TOOL_MANAGER_VIEW_CONTROLS = Pick<
  VIEW_CONTROLS,
  | 'GetMousePosition'
  | 'GetCursorPosition'
  | 'GetSettings'
  | 'ApplySettings'
  | 'ForceCursorPosition'
  | 'WarpMouseCursor'
>;

/** `APP_SETTINGS_BASE`: the application's settings object, opaque to the manager. */
export type APP_SETTINGS_BASE_LIKE = object;

/** `EDA_BASE_FRAME::UpdateStatusBar`, the one frame call `UpdateUI` makes. */
export interface TOOL_MANAGER_FRAME_WITH_STATUS_BAR {
  UpdateStatusBar(): void;
}

type TRANSITION = [TOOL_EVENT_LIST, TOOL_STATE_FUNC];

/// Struct describing the current execution state of a TOOL
class TOOL_STATE {
  /// The tool itself
  theTool: TOOL_BASE;

  /// Is the tool active (pending execution) or disabled at the moment
  idle!: boolean;

  /// Should the tool shutdown during next execution
  shutdown!: boolean;

  /// Flag defining if the tool is waiting for any event (i.e. if it
  /// issued a Wait() call).
  pendingWait!: boolean;

  /// Is there a context menu being displayed
  pendingContextMenu!: boolean;

  /// Context menu currently used by the tool
  contextMenu!: ACTION_MENU | null;

  /// Defines when the context menu is opened
  contextMenuTrigger!: CONTEXT_MENU_TRIGGER;

  /// Tool execution context
  cofunc!: COROUTINE<number, TOOL_EVENT> | null;

  /// The first event that triggered activation of the tool.
  initialEvent: TOOL_EVENT = new TOOL_EVENT();

  /// The event that triggered the execution/wakeup of the tool after Wait() call
  wakeupEvent: TOOL_EVENT = new TOOL_EVENT();

  /// List of events the tool is currently waiting for
  waitEvents = new TOOL_EVENT_LIST();

  /// List of possible transitions (ie. association of events and state handlers that are executed
  /// upon the event reception
  transitions: TRANSITION[] = [];

  /// VIEW_CONTROLS settings to preserve settings when the tools are switched
  vcSettings: VC_SETTINGS;

  /// Stack preserving previous states of a TOOL.
  private stateStack: TOOL_STATE[] = [];

  constructor(aTool: TOOL_BASE, aVcSettings: VC_SETTINGS);
  constructor(aState: TOOL_STATE);
  constructor(a: TOOL_BASE | TOOL_STATE, aVcSettings?: VC_SETTINGS) {
    if (a instanceof TOOL_STATE) {
      const aState = a;
      this.theTool = aState.theTool;
      this.idle = aState.idle;
      this.shutdown = aState.shutdown;
      this.pendingWait = aState.pendingWait;
      this.pendingContextMenu = aState.pendingContextMenu;
      this.contextMenu = aState.contextMenu;
      this.contextMenuTrigger = aState.contextMenuTrigger;
      this.cofunc = aState.cofunc;
      this.initialEvent = aState.initialEvent.clone();
      this.wakeupEvent = aState.wakeupEvent.clone();
      this.waitEvents = new TOOL_EVENT_LIST(aState.waitEvents);
      this.transitions = [...aState.transitions];
      this.vcSettings = aState.vcSettings.clone();
      // do not copy stateStack
      return;
    }

    this.theTool = a;
    this.vcSettings = aVcSettings!;
    this.clear();
  }

  /** `operator=( const TOOL_STATE& )`. */
  assign(aState: TOOL_STATE): this {
    this.theTool = aState.theTool;
    this.idle = aState.idle;
    this.shutdown = aState.shutdown;
    this.pendingWait = aState.pendingWait;
    this.pendingContextMenu = aState.pendingContextMenu;
    this.contextMenu = aState.contextMenu;
    this.contextMenuTrigger = aState.contextMenuTrigger;
    this.cofunc = aState.cofunc;
    this.initialEvent = aState.initialEvent.clone();
    this.wakeupEvent = aState.wakeupEvent.clone();
    this.waitEvents = new TOOL_EVENT_LIST(aState.waitEvents);
    this.transitions = [...aState.transitions];
    this.vcSettings = aState.vcSettings.clone();
    // do not copy stateStack
    return this;
  }

  equals(aRhs: TOOL_STATE): boolean {
    return aRhs.theTool === this.theTool;
  }

  /**
   * Store the current state of the tool on stack. Stacks are stored internally and are not
   * shared between different TOOL_STATE objects.
   */
  Push(): void {
    const state = new TOOL_STATE(this);
    this.stateStack.push(state);
    this.clear();
  }

  /**
   * Restore state of the tool from stack. Stacks are stored internally and are not
   * shared between different TOOL_STATE objects.
   *
   * @return True if state was restored, false if the stack was empty.
   */
  Pop(): boolean {
    this.cofunc = null; // delete cofunc

    if (this.stateStack.length !== 0) {
      this.assign(this.stateStack.pop()!);
      return true;
    }

    this.resetRuntimeState();
    return false;
  }

  /// Resets runtime-only state that must not leak across tool activations.
  private resetRuntimeState(): void {
    this.cofunc = null;
    this.shutdown = false;
    this.pendingWait = false;
    this.pendingContextMenu = false;
    this.contextMenu = null;
    this.contextMenuTrigger = CONTEXT_MENU_TRIGGER.CMENU_OFF;
  }

  /// Restores the initial state.
  private clear(): void {
    this.idle = true;
    this.resetRuntimeState();
    this.vcSettings.Reset();
    this.transitions = [];
  }
}

export class TOOL_MANAGER {
  /// List of tools in the order they were registered
  private m_toolOrder: TOOL_BASE[] = [];

  /// Index of registered tools current states, associated by tools' objects.
  private m_toolState = new Map<TOOL_BASE, TOOL_STATE>();

  /// Index of the registered tools current states, associated by tools' names.
  private m_toolNameIndex = new Map<string, TOOL_STATE>();

  /// Index of the registered tools current states, associated by tools' ID numbers.
  private m_toolIdIndex = new Map<TOOL_ID, TOOL_STATE>();

  /// Index of the registered tools to easily lookup by their type.
  private m_toolTypes = new Map<Function, TOOL_BASE>();

  /// Stack of the active tools
  private m_activeTools: TOOL_ID[] = [];

  /// Instance of ACTION_MANAGER that handles TOOL_ACTIONs
  private m_actionMgr: ACTION_MANAGER;

  /// Original cursor position, if overridden by the context menu handler
  private m_cursorSettings = new Map<TOOL_ID, VECTOR2D | undefined>();

  private m_model: EDA_ITEM | null;
  private m_view: VIEW | null;
  private m_viewControls: TOOL_MANAGER_VIEW_CONTROLS | null;
  private m_frame: TOOLS_HOLDER | null;
  private m_settings: APP_SETTINGS_BASE_LIKE | null;

  /// Queue that stores events to be processed at the end of the event processing cycle.
  private m_eventQueue: TOOL_EVENT[] = [];

  /// Right click context menu position.
  private m_menuCursor: VECTOR2D = { x: 0, y: 0 };

  private m_warpMouseAfterContextMenu: boolean;

  /// Flag indicating whether a context menu is currently displayed.
  private m_menuActive: boolean;

  /// Tool currently displaying a popup menu. It is negative when there is no menu displayed.
  private m_menuOwner: TOOL_ID;

  /// Pointer to the state object corresponding to the currently executed tool.
  private m_activeState: TOOL_STATE | null;

  /// True if the tool manager is shutting down (don't process additional events)
  private m_shuttingDown: boolean;

  /** `static int currentId` of `MakeToolId()`. */
  private static currentId = 0;

  constructor() {
    this.m_model = null;
    this.m_view = null;
    this.m_viewControls = null;
    this.m_frame = null;
    this.m_settings = null;
    this.m_warpMouseAfterContextMenu = true;
    this.m_menuActive = false;
    this.m_menuOwner = -1;
    this.m_activeState = null;
    this.m_shuttingDown = false;

    this.m_actionMgr = new ACTION_MANAGER(this);
  }

  /**
   * Generate a unique ID from for a tool with given name.
   */
  static MakeToolId(_aToolName: string): TOOL_ID {
    return TOOL_MANAGER.currentId++;
  }

  /**
   * Add a tool to the manager set and sets it up. Called once for each tool during
   * application initialization.
   *
   * @param aTool: tool to be added. Ownership is transferred.
   */
  RegisterTool(aTool: TOOL_BASE): void {
    console.assert(
      !this.m_toolNameIndex.has(aTool.GetName()),
      'Adding two tools with the same name may result in unexpected behavior.',
    );
    console.assert(
      !this.m_toolIdIndex.has(aTool.GetId()),
      'Adding two tools with the same ID may result in unexpected behavior.',
    );
    console.assert(
      !this.m_toolTypes.has(aTool.constructor),
      'Adding two tools of the same type may result in unexpected behavior.',
    );

    this.m_toolOrder.push(aTool);

    const st = new TOOL_STATE(aTool, this.newVcSettings());

    this.m_toolState.set(aTool, st);
    this.m_toolNameIndex.set(aTool.GetName(), st);
    this.m_toolIdIndex.set(aTool.GetId(), st);
    this.m_toolTypes.set(aTool.constructor, st.theTool);

    aTool.attachManager(this);
  }

  /**
   * Call a tool by sending a tool activation event to tool of given ID.
   *
   * @param aToolId is the ID number of the requested tool.
   * @return True if the requested tool was invoked successfully.
   */
  InvokeTool(aToolId: TOOL_ID): boolean;
  /**
   * Call a tool by sending a tool activation event to tool of given name.
   *
   * @param aToolName is the name of the requested tool.
   * @return True if the requested tool was invoked successfully.
   */
  InvokeTool(aToolName: string): boolean;
  InvokeTool(a: TOOL_ID | string): boolean {
    const tool = typeof a === 'string' ? this.FindTool(a) : this.FindTool(a);

    if (tool && tool.GetType() === TOOL_TYPE.INTERACTIVE) return this.invokeTool(tool);

    return false; // there is no tool with the given id / name
  }

  /**
   * Shutdown all tools with a currently registered event loop in this tool manager
   * by waking them up with a null event.
   */
  ShutdownAllTools(): void {
    this.m_shuttingDown = true;

    // Create a temporary list of tools to iterate over since when the tools shutdown
    // they remove themselves from the list automatically (invalidating the iterator)
    const tmpList = [...this.m_activeTools];

    // Make sure each tool knows that it is shutting down, so that loops get shut down
    // at the dispatcher
    for (const id of tmpList) {
      const st = this.m_toolIdIndex.get(id);
      if (!st) continue;

      st.shutdown = true;
    }

    for (const id of tmpList) {
      this.ShutdownTool(id);
    }
  }

  /**
   * Shutdown the specified tool by waking it up with a null event to terminate
   * the processing loop.
   *
   * @param aTool is the tool to shutdown
   */
  ShutdownTool(aTool: TOOL_BASE): void;
  ShutdownTool(aToolId: TOOL_ID): void;
  ShutdownTool(aToolName: string): void;
  ShutdownTool(a: TOOL_BASE | TOOL_ID | string): void {
    if (typeof a === 'number' || typeof a === 'string') {
      const tool = typeof a === 'string' ? this.FindTool(a) : this.FindTool(a);

      if (tool && tool.GetType() === TOOL_TYPE.INTERACTIVE) this.ShutdownTool(tool);

      return;
    }

    const aTool = a;
    const id = aTool.GetId();

    if (this.isActive(aTool)) {
      const st = this.m_toolIdIndex.get(id);

      // the tool state handler is waiting for events (i.e. called Wait() method)
      if (st && st.pendingWait) {
        // Wake up the tool and tell it to shutdown
        st.shutdown = true;
        st.pendingWait = false;
        st.waitEvents.clear();

        if (st.cofunc) {
          this.setActiveState(st);
          const end = !st.cofunc.Resume();

          if (end) this.finishTool(st);
        }
      }
    }
  }

  /**
   * Run the specified action immediately, pausing the current action to run the new one.
   *
   * The common format for action names is "application.ToolName.Action".
   *
   * @note The type of the optional parameter must match exactly with the type the consuming
   *       action is expecting, otherwise an assert will occur when reading the paramter.
   *
   * @param aActionName is the name of action to be invoked.
   * @param aParam is an optional parameter that might be used by the invoked action. Its meaning
   *               depends on the action.
   *
   * @return True if the action finished successfully, false otherwise.
   */
  RunAction<T = never>(aActionName: string, aParam?: T): boolean;
  RunAction<T = never>(aAction: TOOL_ACTION, aParam?: T): boolean;
  RunAction<T>(a: string | TOOL_ACTION, ...aParam: [T?]): boolean {
    const param = aParam.length > 0 ? { value: aParam[0] } : null;

    if (typeof a === 'string') return this.doRunActionByName(a, true, param, null);

    return this.doRunAction(a, true, param, null);
  }

  /**
   * Run the specified action immediately, pausing the current action to run the new one.
   *
   * The common format for action names is "application.ToolName.Action".
   *
   * @note The type of the optional parameter must match exactly with the type the consuming
   *       action is expecting, otherwise an assert will occur when reading the paramter.
   *
   * @param aAction is the action to be invoked.
   * @param aCommit is the commit object the tool handling the action should add the new edits to
   * @param aParam is an optional parameter that might be used by the invoked action. Its meaning
   *               depends on the action.
   *
   * @return True if the action finished successfully, false otherwise.
   */
  RunSynchronousAction<T = never>(
    aAction: TOOL_ACTION,
    aCommit: COMMIT | null,
    aParam?: T,
  ): boolean {
    const param = arguments.length > 2 ? { value: aParam } : null;
    return this.doRunAction(aAction, true, param, aCommit);
  }

  /**
   * Run the specified action after the current action (coroutine) ends.
   *
   * The common format for action names is "application.ToolName.Action".
   *
   * @note The type of the optional parameter must match exactly with the type the consuming
   *       action is expecting, otherwise an assert will occur when reading the paramter.
   *
   * @param aActionName is the name of action to be invoked.
   * @param aParam is an optional parameter that might be used by the invoked action. Its meaning
   *               depends on the action.
   *
   * @return False if the action was not found.
   */
  PostAction<T = never>(aActionName: string, aParam?: T): boolean;
  PostAction<T = never>(aAction: TOOL_ACTION, aParam?: T): boolean;
  PostAction<T>(a: string | TOOL_ACTION, ...aParam: [T?]): boolean {
    const param = aParam.length > 0 ? { value: aParam[0] } : null;

    if (typeof a === 'string') return this.doRunActionByName(a, false, param, null);

    return this.doRunAction(a, false, param, null);
  }

  PostAPIAction(aAction: TOOL_ACTION, aCommit: COMMIT | null): boolean {
    return this.doRunAction(aAction, false, null, aCommit, true);
  }

  /**
   * Send a cancel event to the tool currently at the top of the tool stack.
   */
  CancelTool(): void {
    const evt = new TOOL_EVENT(TC_COMMAND, TA_CANCEL_TOOL);

    this.processEvent(evt);
  }

  /**
   * "Prime" a tool by sending a cursor left-click event with the mouse position set
   * to the passed in position.
   *
   * @param aPosition is the mouse position to use in the event
   */
  PrimeTool(aPosition: VECTOR2D): void {
    const modifiers = 0;

    const evt = new TOOL_EVENT(TC_MOUSE, TA_PRIME, BUT_LEFT | modifiers, this.globalScope());
    evt.SetMousePosition(aPosition);

    this.PostEvent(evt);
  }

  ///< @copydoc ACTION_MANAGER::GetHotKey()
  GetHotKey(aAction: TOOL_ACTION): number {
    return this.m_actionMgr.GetHotKey(aAction);
  }

  GetActionManager(): ACTION_MANAGER {
    return this.m_actionMgr;
  }

  /**
   * Search for a tool with given ID.
   *
   * @param aId is the ID number of the requested tool.
   * @return Pointer to the requested tool or NULL in case of failure.
   */
  FindTool(aId: number): TOOL_BASE | null;
  /**
   * Search for a tool with given name.
   *
   * @param aName is the name of the requested tool.
   * @return Pointer to the requested tool or NULL in case of failure.
   */
  FindTool(aName: string): TOOL_BASE | null;
  FindTool(a: number | string): TOOL_BASE | null {
    const st = typeof a === 'string' ? this.m_toolNameIndex.get(a) : this.m_toolIdIndex.get(a);

    return st ? st.theTool : null;
  }

  /*
   * Return the tool of given type or nullptr if there is no such tool registered.
   */
  GetTool<T extends TOOL_BASE>(aType: abstract new (...args: never[]) => T): T | null {
    const tool = this.m_toolTypes.get(aType);

    if (tool) return tool as T;

    return null;
  }

  /**
   * Return all registered tools.
   */
  Tools(): TOOL_BASE[] {
    return [...this.m_toolOrder];
  }

  /**
   * Deactivate the currently active tool.
   */
  DeactivateTool(): void {
    // Deactivate the active tool, but do not run anything new
    const evt = new TOOL_EVENT(TC_COMMAND, TA_CANCEL_TOOL);
    this.processEvent(evt);
  }

  /**
   * Return true if a tool with given id is active (executing)
   */
  IsToolActive(aId: TOOL_ID): boolean {
    const it = this.m_toolIdIndex.get(aId);

    if (!it) return false;

    return !it.idle;
  }

  /**
   * Reset all tools (i.e. calls their Reset() method).
   */
  ResetTools(aReason: RESET_REASON): void {
    if (aReason !== RESET_REASON.REDRAW) this.DeactivateTool();

    for (const [tool, state] of this.m_toolState) {
      this.setActiveState(state);
      tool.Reset(aReason);

      if (tool.GetType() === TOOL_TYPE.INTERACTIVE) (tool as TOOL_INTERACTIVE).resetTransitions();
    }
  }

  /**
   * Initializes all registered tools.
   *
   * If a tool fails during the initialization, it is deactivated and becomes unavailable
   * for further use. Initialization should be done only once.
   */
  InitTools(): void {
    for (const tool of [...this.m_toolOrder]) {
      console.assert(this.m_toolState.has(tool));

      const state = this.m_toolState.get(tool)!;
      this.setActiveState(state);

      if (!tool.Init()) {
        // Unregister the tool
        this.setActiveState(null);
        this.m_toolState.delete(tool);
        this.m_toolNameIndex.delete(tool.GetName());
        this.m_toolIdIndex.delete(tool.GetId());
        this.m_toolTypes.delete(tool.constructor);
      }
    }

    this.m_actionMgr.UpdateHotKeys(true);

    this.ResetTools(RESET_REASON.RUN);
  }

  /**
   * Propagate an event to tools that requested events of matching type(s).
   *
   * @param aEvent is the event to be processed.
   * @return true if the event is a managed hotkey
   */
  ProcessEvent(aEvent: TOOL_EVENT): boolean {
    // Once the tool manager is shutting down, don't start
    // activating more tools
    if (this.m_shuttingDown) return true;

    const handled = this.processEvent(aEvent);

    const activeTool = this.GetCurrentToolState();

    if (activeTool) this.setActiveState(activeTool);

    // if( m_view && m_view->IsDirty() ) wxTheApp->ProcessPendingEvents();   -- no wx event loop here

    this.UpdateUI(aEvent);

    return handled;
  }

  /**
   * Put an event to the event queue to be processed at the end of event processing cycle.
   *
   * @param aEvent is the event to be put into the queue.
   */
  PostEvent(aEvent: TOOL_EVENT): void {
    // Horrific hack, but it's a crash bug.  Don't let inter-frame commands stack up
    // waiting to be processed.
    if (
      aEvent.IsSimulator() &&
      this.m_eventQueue.length > 0 &&
      this.m_eventQueue[this.m_eventQueue.length - 1]!.IsSimulator()
    )
      this.m_eventQueue.pop();

    this.m_eventQueue.push(aEvent.clone());
  }

  /**
   * Set the work environment (model, view, view controls and the parent window).
   *
   * These are made available to the tool. Called by the parent frame when it is set up.
   */
  SetEnvironment(
    aModel: EDA_ITEM | null,
    aView: VIEW | null,
    aViewControls: TOOL_MANAGER_VIEW_CONTROLS | null,
    aSettings: APP_SETTINGS_BASE_LIKE | null,
    aFrame: TOOLS_HOLDER | null,
  ): void {
    this.m_model = aModel;
    this.m_view = aView;
    this.m_viewControls = aViewControls;
    this.m_frame = aFrame;
    this.m_settings = aSettings;
  }

  /* Accessors for the environment objects (view, model, etc.) */
  GetView(): VIEW | null {
    return this.m_view;
  }

  GetViewControls(): TOOL_MANAGER_VIEW_CONTROLS | null {
    return this.m_viewControls;
  }

  GetMousePosition(): VECTOR2D {
    if (this.m_viewControls) return this.m_viewControls.GetMousePosition();
    else return { x: 0, y: 0 }; // KIPLATFORM::UI::GetMousePosition(): no screen to ask here
  }

  GetCursorPosition(): VECTOR2D {
    if (this.m_viewControls) return this.m_viewControls.GetCursorPosition();
    else return { x: 0, y: 0 }; // KIPLATFORM::UI::GetMousePosition(): no screen to ask here
  }

  GetModel(): EDA_ITEM | null {
    return this.m_model;
  }
  ClearModel(): void {
    this.m_model = null;
  }

  GetSettings(): APP_SETTINGS_BASE_LIKE | null {
    return this.m_settings;
  }

  GetToolHolder(): TOOLS_HOLDER | null {
    return this.m_frame;
  }

  /**
   * Return id of the tool that is on the top of the active tools stack (was invoked the
   * most recently).
   *
   * @return Id of the currently used tool.
   */
  GetCurrentToolId(): number {
    return this.m_activeTools.length === 0 ? -1 : this.m_activeTools[0]!;
  }

  /**
   * Return the tool that is on the top of the active tools stack (was invoked the most
   * recently).
   *
   * @return Pointer to the currently used tool.
   */
  GetCurrentTool(): TOOL_BASE | null {
    return this.FindTool(this.GetCurrentToolId());
  }

  /**
   * Return the #TOOL_STATE object representing the state of the active tool. If there are no
   * tools active, it returns nullptr.
   */
  GetCurrentToolState(): TOOL_STATE | null {
    return this.m_toolIdIndex.get(this.GetCurrentToolId()) ?? null;
  }

  /**
   * Return priority of a given tool.
   *
   * Higher number means that the tool is closer to the beginning of the active tool
   * queue.
   *
   * @param aToolId is the id of queried tool.
   * @return The priority of a given tool. If returned number is negative, then it means that
   *         the tool id is invalid or the tool is not active.
   */
  GetPriority(aToolId: number): number {
    let priority = 0;

    for (const tool of this.m_activeTools) {
      if (tool === aToolId) return priority;

      ++priority;
    }

    return -1;
  }

  /**
   * Define a state transition.
   *
   * The events that cause a given handler method in the tool to be called. Called by
   * TOOL_INTERACTIVE::Go().
   */
  ScheduleNextState(
    aTool: TOOL_BASE,
    aHandler: TOOL_STATE_FUNC,
    aConditions: TOOL_EVENT_LIST,
  ): void {
    const st = this.m_toolState.get(aTool)!;

    st.transitions.push([aConditions, aHandler]);
  }

  /**
   * Clear the state transition map for a tool.
   *
   * @param aTool is the tool that should have the transition map cleared.
   */
  ClearTransitions(aTool: TOOL_BASE): void {
    this.m_toolState.get(aTool)!.transitions = [];
  }

  RunMainStack(aTool: TOOL_BASE, aFunc: () => void): void {
    const st = this.m_toolState.get(aTool)!;
    this.setActiveState(st);
    if (!st.cofunc) return; // wxCHECK( st->cofunc, /* void */ )
    st.cofunc.RunMainStack(aFunc);
  }

  /**
   * Update the status bar and synchronizes toolbars.
   */
  UpdateUI(_aEvent: TOOL_EVENT): void {
    const frame = this.GetToolHolder() as TOOL_MANAGER_FRAME_WITH_STATUS_BAR | null;

    if (frame && typeof frame.UpdateStatusBar === 'function') frame.UpdateStatusBar();
  }

  /**
   * Pause execution of a given tool until one or more events matching aConditions arrives.
   *
   * The pause/resume operation is done through COROUTINE object. Called only from coroutines.
   * Here it is the generator the tool's `Wait()` delegates to: it registers the
   * wait, yields to the dispatcher, and hands back the wakeup event (or null on
   * shutdown) when resumed.
   */
  *ScheduleWait(
    aTool: TOOL_BASE,
    aConditions: TOOL_EVENT_LIST,
  ): Generator<void, TOOL_EVENT | null, void> {
    const st = this.m_toolState.get(aTool)!;

    if (st.pendingWait) {
      // everything collapses on two KiYield() in a row
      console.assert(false, 'TOOL_MANAGER::ScheduleWait: pending wait already');
      return null;
    }

    // indicate to the manager that we are going to sleep and we shall be
    // woken up when an event matching aConditions arrive
    st.pendingWait = true;
    st.waitEvents = aConditions;

    if (!st.cofunc) {
      console.assert(false, 'TOOL_MANAGER::ScheduleWait: no coroutine');
      return null;
    }

    // switch context back to event dispatcher loop
    yield; // st->cofunc->KiYield()

    // If the tool should shutdown, it gets a null event to break the loop
    if (st.shutdown) return null;
    else return st.wakeupEvent;
  }

  /**
   * Set behavior of the tool's context popup menu.
   *
   * @param aTool is the parent tool.
   * @param aMenu is the menu structure, defined by the tool.
   * @param aTrigger determines when the menu is activated:
   *  CMENU_NOW: opens the menu right now
   *  CMENU_BUTTON: opens the menu when RMB is pressed
   *  CMENU_OFF: menu is disabled.
   * May be called from a coroutine context.
   */
  ScheduleContextMenu(
    aTool: TOOL_BASE,
    aMenu: ACTION_MENU | null,
    aTrigger: CONTEXT_MENU_TRIGGER,
  ): void {
    const st = this.m_toolState.get(aTool)!;

    st.contextMenu = aMenu;
    st.contextMenuTrigger = aTrigger;
  }

  /**
   * Store an information to the system clipboard.
   * (the clipboard is the designer's, `PCB_CONTROL` reaches it in stage 3)
   */

  /**
   * Return the view controls settings for the current tool or the general settings if there is
   * no active tool.
   */
  GetCurrentToolVC(): VC_SETTINGS {
    const active = this.GetCurrentToolState();
    if (active) return active.vcSettings;

    return this.m_viewControls!.GetSettings();
  }

  /**
   * True while processing a context menu.
   */
  IsContextMenuActive(): boolean {
    return this.m_menuActive;
  }

  /**
   * Disable mouse warping after the current context menu is closed.
   *
   * This must be called before invoking each context menu.  It's a good idea to call this
   * from non-modal dialogs (e.g. DRC window).
   */
  VetoContextMenuMouseWarp(): void {
    this.m_warpMouseAfterContextMenu = false;
  }

  /**
   * Handle context menu related events.
   *
   * The C++ pops the wx menu here and blocks until it is closed; a browser
   * menu is asynchronous, so the tools' ACTION_MENU (stage 3) resolves it and
   * hands the choice back through `dispatchInternal` — this half is pending.
   */
  WarpAfterContextMenu(): void {
    if (this.m_viewControls && this.m_warpMouseAfterContextMenu)
      this.m_viewControls.WarpMouseCursor(this.m_menuCursor, true, false);

    // Don't warp again when the menu is closed
    this.m_warpMouseAfterContextMenu = false;
  }

  DispatchContextMenu(aEvent: TOOL_EVENT): void {
    for (const toolId of this.m_activeTools) {
      const st = this.m_toolIdIndex.get(toolId)!;

      // the tool requested a context menu. The menu is activated on RMB click (CMENU_BUTTON mode)
      // or immediately (CMENU_NOW) mode. The latter is used for clarification lists.
      if (st.contextMenuTrigger === CONTEXT_MENU_TRIGGER.CMENU_OFF) continue;

      if (st.contextMenuTrigger === CONTEXT_MENU_TRIGGER.CMENU_BUTTON && !aEvent.IsClick(BUT_RIGHT))
        break;

      if (st.cofunc) {
        st.pendingWait = true;
        st.waitEvents = new TOOL_EVENT_LIST(new TOOL_EVENT(TC_ANY, TA_ANY));
      }

      // Store the menu pointer in case it is changed by the TOOL when handling menu events
      const m = st.contextMenu;

      if (st.contextMenuTrigger === CONTEXT_MENU_TRIGGER.CMENU_NOW)
        st.contextMenuTrigger = CONTEXT_MENU_TRIGGER.CMENU_OFF;

      // Store the cursor position, so the tools could execute actions
      // using the point where the user has invoked a context menu
      if (this.m_viewControls) this.m_menuCursor = this.m_viewControls.GetCursorPosition();

      // Save all tools cursor settings, as they will be overridden
      for (const [id, s] of this.m_toolIdIndex) {
        const vc = s.vcSettings;

        if (vc.m_forceCursorPosition) this.m_cursorSettings.set(id, { ...vc.m_forcedPosition });
        else this.m_cursorSettings.set(id, undefined);
      }

      if (this.m_viewControls) this.m_viewControls.ForceCursorPosition(true, this.m_menuCursor);

      this.m_menuOwner = toolId;
      this.m_menuActive = true;

      throw new Error(
        'TOOL_MANAGER::DispatchContextMenu: the popup menu is ACTION_MENU, pending (#636 stage 3)',
      );
    }
  }

  /**
   * Handle specific events, that are intended for TOOL_MANAGER rather than tools.
   *
   * @param aEvent is the event to be processed.
   * @return true if the event was processed and should not go any further.
   */
  DispatchHotKey(aEvent: TOOL_EVENT): boolean {
    if (aEvent.Action() === TA_KEY_PRESSED)
      return this.m_actionMgr.RunHotKey(aEvent.Modifier() | aEvent.KeyCode());

    return false;
  }

  GetMenuCursorPos(): VECTOR2D {
    return this.m_menuCursor;
  }

  /**
   * Helper function to actually run an action.
   */
  private doRunAction(
    aAction: TOOL_ACTION,
    aNow: boolean,
    aParam: { value: unknown } | null,
    aCommit: COMMIT | null,
    aFromAPI = false,
  ): boolean {
    if (this.m_shuttingDown) return true;

    let retVal = false;
    const event = aAction.MakeEvent();

    if (event.Category() === TC_COMMAND) event.SetMousePosition(this.GetCursorPosition());

    // Allow to override the action parameter
    if (aParam) event.SetParameter(aParam.value);

    if (aNow) {
      const current = this.m_activeState;

      // An event with a commit must be run synchronously
      if (aCommit) {
        // We initialize the SYNCHRONOUS state to finished so that tools that don't have an
        // event loop won't hang if someone forgets to set the state.
        const synchronousControl: SYNCRONOUS_TOOL_STATE_CELL = {
          value: SYNCRONOUS_TOOL_STATE.STS_FINISHED,
        };

        event.SetSynchronous(synchronousControl);
        event.SetCommit(aCommit);

        this.processEvent(event);

        // while( synchronousControl == STS_RUNNING ) { wxYield(); wxMilliSleep( 1 ); }
        // A browser has no nested event loop to spin: a tool that is still
        // running here is waiting for input this call cannot block for.
        console.assert(
          synchronousControl.value !== SYNCRONOUS_TOOL_STATE.STS_RUNNING,
          'TOOL_MANAGER::RunSynchronousAction: the tool is still waiting for events',
        );

        retVal = synchronousControl.value !== SYNCRONOUS_TOOL_STATE.STS_CANCELLED;
      } else {
        retVal = this.processEvent(event);
      }

      this.setActiveState(current);
      this.UpdateUI(event);
    } else {
      // It is really dangerous to pass a commit (whose lifetime we can't guarantee) to
      // deferred event processing.  There is a possibility that user actions will get run
      // in between, which might either affect the lifetime of the commit or push or pop
      // other commits.  However, we don't currently have a better solution for the API.
      if (aCommit) {
        console.assert(
          aFromAPI,
          'Deferred actions have no way of guaranteeing the lifetime of the COMMIT object',
        );

        event.SetCommit(aCommit);
      }

      this.PostEvent(event);
    }

    return retVal;
  }

  private doRunActionByName(
    aActionName: string,
    aNow: boolean,
    aParam: { value: unknown } | null,
    aCommit: COMMIT | null,
  ): boolean {
    const action = this.m_actionMgr.FindAction(aActionName);

    if (!action) {
      console.assert(false, `Could not find action ${aActionName}.`);
      return false;
    }

    this.doRunAction(action, aNow, aParam, aCommit);

    return true;
  }

  /**
   * Pass an event at first to the active tools, then to all others.
   */
  private dispatchInternal(aEvent: TOOL_EVENT): boolean {
    let handled = false;

    // iterate over active tool stack
    let i = 0;
    while (i < this.m_activeTools.length) {
      const st = this.m_toolIdIndex.get(this.m_activeTools[i]!) ?? null;
      let increment = true;

      // forward context menu events to the tool that created the menu
      if (aEvent.IsChoiceMenu()) {
        if (this.m_activeTools[i] !== this.m_menuOwner) {
          ++i;
          continue;
        }
      }

      // If we're pendingWait then we had better have a cofunc to process the wait.
      console.assert(!st || !st.pendingWait || st.cofunc !== null);

      // the tool state handler is waiting for events (i.e. called Wait() method)
      if (st && st.cofunc && st.pendingWait && st.waitEvents.Matches(aEvent)) {
        if (!aEvent.FirstResponder()) aEvent.SetFirstResponder(st.theTool);

        // got matching event? clear wait list and wake up the coroutine
        st.wakeupEvent = aEvent.clone();
        st.pendingWait = false;
        st.waitEvents.clear();

        this.setActiveState(st);
        const end = !st.cofunc.Resume();

        if (end) {
          i = this.finishTool(st);
          increment = false;
        }

        // If the tool did not request the event be passed to other tools, we're done
        if (!st.wakeupEvent.PassEvent()) return true;
      }

      if (increment) ++i;
    }

    for (const st of this.m_toolState.values()) {
      let finished = false;

      // no state handler in progress - check if there are any transitions (defined by
      // Go() method that match the event.
      if (st.transitions.length !== 0) {
        for (const tr of st.transitions) {
          if (tr[0].Matches(aEvent)) {
            const func_copy = tr[1];

            if (!aEvent.FirstResponder()) aEvent.SetFirstResponder(st.theTool);

            // if there is already a context, then push it on the stack
            // and transfer the previous view control settings to the new context
            if (st.cofunc) {
              const viewControlSettings = st.vcSettings;
              st.Push();
              st.vcSettings = viewControlSettings;
            }

            st.cofunc = new COROUTINE<number, TOOL_EVENT>(func_copy);

            // got match? Run the handler.
            this.setActiveState(st);
            st.idle = false;
            st.initialEvent = aEvent.clone();
            st.cofunc.Call(st.initialEvent);
            handled = true;

            if (!st.cofunc.Running()) this.finishTool(st); // The coroutine has finished immediately?

            // if it is a message, continue processing
            finished = !(aEvent.Category() === TC_MESSAGE);

            // there is no point in further checking, as transitions got cleared
            break;
          }
        }
      }

      if (finished) break; // only the first tool gets the event
    }

    return handled;
  }

  /**
   * Check if it is a valid activation event and invokes a proper tool.
   *
   * @param aEvent is an event to be tested.
   * @return True if a tool was invoked, false otherwise.
   */
  private dispatchActivation(aEvent: TOOL_EVENT): boolean {
    if (aEvent.IsActivate()) {
      const tool = this.m_toolNameIndex.get(aEvent.getCommandStr());

      if (tool) {
        this.runTool(tool.theTool);
        return true;
      }
    }

    return false;
  }

  /**
   * Invoke a tool by sending a proper event (in contrary to runTool, which makes the tool run
   * for real).
   *
   * @param aTool is the tool to be invoked.
   */
  private invokeTool(aTool: TOOL_BASE): boolean {
    console.assert(aTool !== null);

    const evt = new TOOL_EVENT(TC_COMMAND, TA_ACTIVATE, aTool.GetName());
    evt.SetMousePosition(this.GetCursorPosition());
    this.processEvent(evt);

    const active = this.GetCurrentToolState();
    if (active) this.setActiveState(active);

    return true;
  }

  /**
   * Make a tool active, so it can receive events and react to them.
   *
   * The activated tool is pushed on the active tools stack, so the last activated tool
   * receives events first.
   *
   * @param aTool is the tool to be run.
   */
  private runTool(aTool: TOOL_BASE): boolean {
    console.assert(aTool !== null);

    if (!this.isRegistered(aTool)) {
      console.assert(false, 'You cannot run unregistered tools');
      return false;
    }

    const id = aTool.GetId();

    if (aTool.GetType() === TOOL_TYPE.INTERACTIVE) (aTool as TOOL_INTERACTIVE).resetTransitions();

    // If the tool is already active, bring it to the top of the active tools stack
    if (this.isActive(aTool) && this.m_activeTools.length > 1) {
      const it = this.m_activeTools.indexOf(id);

      if (it >= 0) {
        if (it !== 0) {
          this.m_activeTools.splice(it, 1);
          this.m_activeTools.unshift(id);
        }

        return false;
      }
    }

    this.setActiveState(this.m_toolIdIndex.get(id)!);
    aTool.Reset(RESET_REASON.RUN);

    // Add the tool on the front of the processing queue (it gets events first)
    this.m_activeTools.unshift(id);

    return true;
  }

  /**
   * Deactivate a tool and does the necessary clean up.
   *
   * @param aState is the state variable of the tool to be stopped.
   * @return m_activeTools iterator. If the tool has been completely deactivated, it points
   *         on the next active tool on the list. Otherwise it is an iterator pointing to
   *         aState.
   */
  private finishTool(aState: TOOL_STATE): number {
    let it = this.m_activeTools.indexOf(aState.theTool.GetId());

    if (!aState.Pop()) {
      // Deactivate the tool if there are no other contexts saved on the stack
      if (it >= 0) this.m_activeTools.splice(it, 1);
      else it = this.m_activeTools.length;

      aState.idle = true;
    }

    if (it < 0) it = this.m_activeTools.length;

    if (aState === this.m_activeState) this.setActiveState(null);

    return it;
  }

  /**
   * Return information about a tool registration status.
   *
   * @param aTool is the tool to be checked.
   * @return true if the tool is in the registered tools list, false otherwise.
   */
  private isRegistered(aTool: TOOL_BASE): boolean {
    return this.m_toolState.has(aTool);
  }

  /**
   * Return information about a tool activation status.
   *
   * @param aTool is the tool to be checked.
   * @return True if the tool is on the active tools stack, false otherwise.
   */
  private isActive(aTool: TOOL_BASE): boolean {
    if (!this.isRegistered(aTool)) return false;

    // Just check if the tool is on the active tools stack
    return this.m_activeTools.includes(aTool.GetId());
  }

  /**
   * Save the #VIEW_CONTROLS settings to the tool state object.
   *
   * If #VIEW_CONTROLS settings are affected by #TOOL_MANAGER, the original settings are saved.
   */
  private saveViewControls(aState: TOOL_STATE): void {
    aState.vcSettings = this.m_viewControls!.GetSettings().clone();

    if (this.m_menuActive) {
      // Context menu is active, so the cursor settings are overridden (see DispatchContextMenu())
      if (this.m_cursorSettings.has(aState.theTool.GetId())) {
        const curr = this.m_viewControls!.GetSettings();

        // Tool has overridden the cursor position, so store the new settings
        if (
          !curr.m_forceCursorPosition ||
          curr.m_forcedPosition.x !== this.m_menuCursor.x ||
          curr.m_forcedPosition.y !== this.m_menuCursor.y
        ) {
          if (!curr.m_forceCursorPosition)
            this.m_cursorSettings.set(aState.theTool.GetId(), undefined);
          else this.m_cursorSettings.set(aState.theTool.GetId(), { ...curr.m_forcedPosition });
        } else {
          const cursor = this.m_cursorSettings.get(aState.theTool.GetId());

          if (cursor) {
            aState.vcSettings.m_forceCursorPosition = true;
            aState.vcSettings.m_forcedPosition = { ...cursor };
          } else {
            aState.vcSettings.m_forceCursorPosition = false;
          }
        }
      }
    }
  }

  /**
   * Apply #VIEW_CONTROLS settings stored in a #TOOL_STATE object.
   */
  private applyViewControls(aState: TOOL_STATE): void {
    this.m_viewControls!.ApplySettings(aState.vcSettings);
  }

  /**
   * Main function for event processing.
   *
   * @return true if a hotkey was handled.
   */
  private processEvent(aEvent: TOOL_EVENT): boolean {
    // First try to dispatch the action associated with the event if it is a key press event
    let handled = this.DispatchHotKey(aEvent);

    if (!handled) {
      const mod_event = aEvent.clone();

      // Only immediate actions get the position.  Otherwise clear for tool activation
      if (this.GetToolHolder() && !this.GetToolHolder()!.GetDoImmediateActions()) {
        // An tool-selection-event has no position
        if (
          mod_event.getCommandStr() !== '' &&
          mod_event.getCommandStr() !== this.GetToolHolder()!.CurrentToolName() &&
          !mod_event.ForceImmediate()
        ) {
          mod_event.SetHasPosition(false);
        }
      }

      // If the event is not handled through a hotkey activation, pass it to the currently
      // running tool loops
      handled = this.dispatchInternal(mod_event) || handled;
      handled = this.dispatchActivation(mod_event) || handled;

      // Open the context menu if requested by a tool
      this.DispatchContextMenu(mod_event);

      // Dispatch any remaining events in the event queue
      while (this.m_eventQueue.length !== 0) {
        const event = this.m_eventQueue.shift()!;
        this.processEvent(event);
      }
    }

    return handled;
  }

  /**
   * Save the previous active state and sets a new one.
   *
   * @param aState is the new active state. Might be null to indicate there is no new
   *               active state.
   */
  private setActiveState(aState: TOOL_STATE | null): void {
    if (this.m_activeState && this.m_viewControls) this.saveViewControls(this.m_activeState);

    this.m_activeState = aState;

    if (this.m_activeState && this.m_viewControls) this.applyViewControls(aState!);
  }

  /** A fresh VC_SETTINGS for a tool's state (`KIGFX::VC_SETTINGS vcSettings` member). */
  private newVcSettings(): VC_SETTINGS {
    return new VcSettingsCtor();
  }

  private globalScope(): number {
    return 3; // TOOL_ACTION_SCOPE.AS_GLOBAL, the int-param constructor's default
  }
}

import { VC_SETTINGS as VcSettingsCtor } from '../view/view_controls.js';
