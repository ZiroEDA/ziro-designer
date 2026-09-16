// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_EVENT` and `TOOL_EVENT_LIST` (include/tool/tool_event.h,
 * common/tool/tool_event.cpp): what the TOOL_MANAGER dispatches to tools —
 * a mouse or keyboard event, a command, a message, a view change.
 *
 * `EVENTS` (the system-wide selection and undo/redo events, actions.h:341)
 * lives here rather than in actions.ts: the C++ has tool_event.cpp and
 * actions.cpp include each other, and an ES module cycle cannot build an
 * event at load time in a module the other has not finished evaluating.
 * `actions.ts` re-exports it under its own name.
 */
import type { COMMIT } from '../commit.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import { type TOOL_ACTION, TOOL_ACTION_GROUP } from './tool_action.js';

/**
 * Scope of tool actions (tool_action.h). Defined here rather than in
 * tool_action.ts because the EVENTS statics below construct TOOL_EVENTs
 * while tool_action.ts may still be evaluating; tool_action.ts re-exports it.
 */
export enum TOOL_ACTION_SCOPE {
  AS_CONTEXT = 1, ///< Action belongs to a particular tool (i.e. a part of a pop-up menu)
  AS_ACTIVE, ///< All active tools
  AS_GLOBAL, ///< Global action (toolbar/main menu event, global shortcut)
}
export const { AS_CONTEXT, AS_ACTIVE, AS_GLOBAL } = TOOL_ACTION_SCOPE;
import type { TOOL_BASE } from './tool_base.js';

/**
 * Internal (GUI-independent) event definitions.
 */
export enum TOOL_EVENT_CATEGORY {
  TC_NONE = 0x00,
  TC_MOUSE = 0x01,
  TC_KEYBOARD = 0x02,
  TC_COMMAND = 0x04,
  TC_MESSAGE = 0x08,
  TC_VIEW = 0x10,
  TC_ANY = 0xffffffff,
}
export const { TC_NONE, TC_MOUSE, TC_KEYBOARD, TC_COMMAND, TC_MESSAGE, TC_VIEW, TC_ANY } =
  TOOL_EVENT_CATEGORY;

export enum TOOL_ACTIONS {
  // UI input events
  TA_NONE = 0x0000,
  TA_MOUSE_CLICK = 0x0001,
  TA_MOUSE_DBLCLICK = 0x0002,
  TA_MOUSE_UP = 0x0004,
  TA_MOUSE_DOWN = 0x0008,
  TA_MOUSE_DRAG = 0x0010,
  TA_MOUSE_MOTION = 0x0020,
  TA_MOUSE_WHEEL = 0x0040,
  TA_MOUSE = 0x007f,

  TA_KEY_PRESSED = 0x0080,
  TA_KEYBOARD = TA_KEY_PRESSED,

  // View related events
  TA_VIEW_REFRESH = 0x0100,
  TA_VIEW_ZOOM = 0x0200,
  TA_VIEW_PAN = 0x0400,
  TA_VIEW_DIRTY = 0x0800,
  TA_VIEW = 0x0f00,

  TA_CHANGE_LAYER = 0x1000,

  // Tool cancel event. Issued automagically when the user hits escape or selects End Tool from
  // the context menu.
  TA_CANCEL_TOOL = 0x2000,

  // Context menu update. Issued whenever context menu is open and the user hovers the mouse
  // over one of choices. Used in dynamic highlighting in disambiguation menu
  TA_CHOICE_MENU_UPDATE = 0x4000,

  // Context menu choice. Sent if the user picked something from the context menu or
  // closed it without selecting anything.
  TA_CHOICE_MENU_CHOICE = 0x8000,

  // Context menu is closed, no matter whether anything has been chosen or not.
  TA_CHOICE_MENU_CLOSED = 0x10000,

  TA_CHOICE_MENU = TA_CHOICE_MENU_UPDATE | TA_CHOICE_MENU_CHOICE | TA_CHOICE_MENU_CLOSED,

  // This event is sent *before* undo/redo command is performed.
  TA_UNDO_REDO_PRE = 0x20000,

  // This event is sent *after* undo/redo command is performed.
  TA_UNDO_REDO_POST = 0x40000,

  // Tool action (allows one to control tools).
  TA_ACTION = 0x80000,

  // Tool activation event.
  TA_ACTIVATE = 0x100000,

  // Tool re-activation event for tools already on the stack
  TA_REACTIVATE = 0x200000,

  // Model has changed (partial update).
  TA_MODEL_CHANGE = 0x400000,

  // Tool priming event (a special mouse click)
  TA_PRIME = 0x800001,

  TA_ANY = 0xffffffff,
}
export const {
  TA_NONE,
  TA_MOUSE_CLICK,
  TA_MOUSE_DBLCLICK,
  TA_MOUSE_UP,
  TA_MOUSE_DOWN,
  TA_MOUSE_DRAG,
  TA_MOUSE_MOTION,
  TA_MOUSE_WHEEL,
  TA_MOUSE,
  TA_KEY_PRESSED,
  TA_KEYBOARD,
  TA_VIEW_REFRESH,
  TA_VIEW_ZOOM,
  TA_VIEW_PAN,
  TA_VIEW_DIRTY,
  TA_VIEW,
  TA_CHANGE_LAYER,
  TA_CANCEL_TOOL,
  TA_CHOICE_MENU_UPDATE,
  TA_CHOICE_MENU_CHOICE,
  TA_CHOICE_MENU_CLOSED,
  TA_CHOICE_MENU,
  TA_UNDO_REDO_PRE,
  TA_UNDO_REDO_POST,
  TA_ACTION,
  TA_ACTIVATE,
  TA_REACTIVATE,
  TA_MODEL_CHANGE,
  TA_PRIME,
  TA_ANY,
} = TOOL_ACTIONS;

export enum TOOL_MOUSE_BUTTONS {
  BUT_NONE = 0x0,
  BUT_LEFT = 0x1,
  BUT_RIGHT = 0x2,
  BUT_MIDDLE = 0x4,
  BUT_AUX1 = 0x8,
  BUT_AUX2 = 0x10,
  BUT_BUTTON_MASK = BUT_LEFT | BUT_RIGHT | BUT_MIDDLE | BUT_AUX1 | BUT_AUX2,
  BUT_ANY = 0xffffffff,
}
export const {
  BUT_NONE,
  BUT_LEFT,
  BUT_RIGHT,
  BUT_MIDDLE,
  BUT_AUX1,
  BUT_AUX2,
  BUT_BUTTON_MASK,
  BUT_ANY,
} = TOOL_MOUSE_BUTTONS;

export enum TOOL_MODIFIERS {
  MD_SHIFT = 0x1000,
  MD_CTRL = 0x2000,
  MD_ALT = 0x4000,
  MD_SUPER = 0x8000,
  MD_META = 0x10000,
  MD_ALTGR = 0x20000,
  MD_MODIFIER_MASK = MD_SHIFT | MD_CTRL | MD_ALT | MD_SUPER | MD_META | MD_ALTGR,
}
export const { MD_SHIFT, MD_CTRL, MD_ALT, MD_SUPER, MD_META, MD_ALTGR, MD_MODIFIER_MASK } =
  TOOL_MODIFIERS;

/// Defines when a context menu is opened.
export enum CONTEXT_MENU_TRIGGER {
  CMENU_BUTTON = 0, ///< On the right button.
  CMENU_NOW, ///< Right now (after TOOL_INTERACTIVE::SetContextMenu).
  CMENU_OFF, ///< Never.
}

export enum SYNCRONOUS_TOOL_STATE {
  STS_RUNNING,
  STS_FINISHED,
  STS_CANCELLED,
}

/** `std::atomic<SYNCRONOUS_TOOL_STATE>*`: a shared cell the waiter reads. */
export interface SYNCRONOUS_TOOL_STATE_CELL {
  value: SYNCRONOUS_TOOL_STATE;
}

interface FlagString {
  flag: number;
  str: string;
}

function flag2string(aFlag: number, aExps: readonly FlagString[]): string {
  let rv = '';

  for (let i = 0; aExps[i]!.str.length; i++) {
    if (aExps[i]!.flag & aFlag) rv += `${aExps[i]!.str} `;
  }

  return rv;
}

/**
 * The names the C++ compares against in `IsCancelInteractive()` and
 * `IsPointEditor()` are those of `ACTIONS::cancelInteractive` and
 * `ACTIONS::activatePointEditor`; `actions.ts` hands the two actions over
 * once it has built them (see the module comment).
 */
let g_cancelInteractive: TOOL_ACTION | null = null;
let g_activatePointEditor: TOOL_ACTION | null = null;

export function setInteractiveActions(
  aCancelInteractive: TOOL_ACTION,
  aActivatePointEditor: TOOL_ACTION,
): void {
  g_cancelInteractive = aCancelInteractive;
  g_activatePointEditor = aActivatePointEditor;
}

/**
 * Generic, UI-independent tool event.
 */
export class TOOL_EVENT {
  private m_category: TOOL_EVENT_CATEGORY;
  private m_actions: TOOL_ACTIONS;
  private m_scope: TOOL_ACTION_SCOPE;
  private m_passEvent!: boolean;
  private m_hasPosition!: boolean;
  private m_forceImmediate!: boolean;

  /// Optional group that the parent action for the event belongs to
  private m_actionGroup: TOOL_ACTION_GROUP | undefined;

  /// True when the tool is being re-activated from the stack
  private m_reactivate!: boolean;

  /// Difference between mouse cursor position and the point where dragging event has started
  private m_mouseDelta: VECTOR2D = { x: 0, y: 0 };

  /// Current mouse cursor position
  private m_mousePos: VECTOR2D = { x: 0, y: 0 };

  /// Point where dragging has started
  private m_mouseDragOrigin: VECTOR2D = { x: 0, y: 0 };

  /// State of mouse buttons
  private m_mouseButtons: number;

  /// Stores code of pressed/released key
  private m_keyCode: number;

  /// State of key modifiers (Ctrl/Alt/etc.)
  private m_modifiers: number;

  /// State of an asynchronous tool
  private m_synchronousState: SYNCRONOUS_TOOL_STATE_CELL | null;

  /// Commit the tool has been invoked with
  private m_commit: COMMIT | null;

  /// Generic parameter used for passing non-standard data.
  private m_param: unknown;
  private m_hasParam = false;

  /// The first tool to receive the event
  private m_firstResponder: TOOL_BASE | null;

  private m_commandId: number | undefined;
  private m_commandStr = '';

  constructor(aCategory?: TOOL_EVENT_CATEGORY, aAction?: TOOL_ACTIONS, aScope?: TOOL_ACTION_SCOPE);
  constructor(
    aCategory: TOOL_EVENT_CATEGORY,
    aAction: TOOL_ACTIONS,
    aExtraParam: number,
    aScope: TOOL_ACTION_SCOPE,
  );
  constructor(
    aCategory: TOOL_EVENT_CATEGORY,
    aAction: TOOL_ACTIONS,
    aExtraParam: string,
    aScope?: TOOL_ACTION_SCOPE,
  );
  constructor(
    aCategory: TOOL_EVENT_CATEGORY = TC_NONE,
    aAction: TOOL_ACTIONS = TA_NONE,
    c: number | string | TOOL_ACTION_SCOPE = TOOL_ACTION_SCOPE.AS_GLOBAL,
    d: TOOL_ACTION_SCOPE = TOOL_ACTION_SCOPE.AS_GLOBAL,
  ) {
    this.m_category = aCategory;
    this.m_actions = aAction;
    this.m_mouseButtons = 0;
    this.m_keyCode = 0;
    this.m_modifiers = 0;
    this.m_synchronousState = null;
    this.m_commit = null;
    this.m_firstResponder = null;

    if (typeof c === 'string') {
      // TOOL_EVENT( aCategory, aAction, const std::string& aExtraParam, aScope )
      this.m_scope = d;

      if (aCategory === TC_COMMAND || aCategory === TC_MESSAGE) this.m_commandStr = c;

      this.init();
      return;
    }

    if (arguments.length >= 4) {
      // TOOL_EVENT( aCategory, aAction, int aExtraParam, aScope ): the C++ overloads on
      // int versus TOOL_ACTION_SCOPE; here both are numbers, so this form always names
      // its scope (a third number alone is the scope form below).
      const aExtraParam = c;
      this.m_scope = d;

      if (aCategory === TC_MOUSE) {
        this.setMouseButtons(aExtraParam & BUT_BUTTON_MASK);
      } else if (aCategory === TC_KEYBOARD) {
        this.m_keyCode = aExtraParam & ~MD_MODIFIER_MASK; // Filter out modifiers
      } else if (aCategory === TC_COMMAND) {
        this.m_commandId = aExtraParam;
      }

      if (aCategory & (TC_MOUSE | TC_KEYBOARD)) {
        this.m_modifiers = aExtraParam & MD_MODIFIER_MASK;
      }

      this.init();
      return;
    }

    // TOOL_EVENT( aCategory, aAction, aScope )
    this.m_scope = c as TOOL_ACTION_SCOPE;
    this.init();
  }

  /** The copy `std::optional<TOOL_EVENT>` / a deque of events makes. */
  clone(): TOOL_EVENT {
    const c = new TOOL_EVENT(this.m_category, this.m_actions, this.m_scope);
    c.m_passEvent = this.m_passEvent;
    c.m_hasPosition = this.m_hasPosition;
    c.m_forceImmediate = this.m_forceImmediate;
    c.m_actionGroup = this.m_actionGroup;
    c.m_reactivate = this.m_reactivate;
    c.m_mouseDelta = { ...this.m_mouseDelta };
    c.m_mousePos = { ...this.m_mousePos };
    c.m_mouseDragOrigin = { ...this.m_mouseDragOrigin };
    c.m_mouseButtons = this.m_mouseButtons;
    c.m_keyCode = this.m_keyCode;
    c.m_modifiers = this.m_modifiers;
    c.m_synchronousState = this.m_synchronousState;
    c.m_commit = this.m_commit;
    c.m_param = this.m_param;
    c.m_hasParam = this.m_hasParam;
    c.m_firstResponder = this.m_firstResponder;
    c.m_commandId = this.m_commandId;
    c.m_commandStr = this.m_commandStr;
    return c;
  }

  ///< Returns the category (eg. mouse/keyboard/action) of an event..
  Category(): TOOL_EVENT_CATEGORY {
    return this.m_category;
  }

  ///< Returns more specific information about the type of an event.
  Action(): TOOL_ACTIONS {
    return this.m_actions;
  }

  ///< Returns if it this event has a valid position (true for mouse events and context-menu
  ///< or hotkey-based command events)
  PassEvent(): boolean {
    return this.m_passEvent;
  }
  SetPassEvent(aPass = true): void {
    this.m_passEvent = aPass;
  }

  ///< Returns information about difference between current mouse cursor position and the place
  ///< where dragging has started.
  HasPosition(): boolean {
    return this.m_hasPosition;
  }
  SetHasPosition(aHasPosition: boolean): void {
    this.m_hasPosition = aHasPosition;
  }

  ForceImmediate(): boolean {
    return this.m_forceImmediate;
  }
  SetForceImmediate(aForceImmediate = true): void {
    this.m_forceImmediate = aForceImmediate;
  }

  FirstResponder(): TOOL_BASE | null {
    return this.m_firstResponder;
  }
  SetFirstResponder(aTool: TOOL_BASE | null): void {
    this.m_firstResponder = aTool;
  }

  ///< Controls whether the tool is first being pushed to the stack or being reactivated after
  ///< a pause
  IsReactivate(): boolean {
    return this.m_reactivate;
  }
  SetReactivate(aReactivate = true): void {
    this.m_reactivate = aReactivate;
  }

  SetSynchronous(aState: SYNCRONOUS_TOOL_STATE_CELL | null): void {
    this.m_synchronousState = aState;
  }
  SynchronousState(): SYNCRONOUS_TOOL_STATE_CELL | null {
    return this.m_synchronousState;
  }

  SetCommit(aCommit: COMMIT | null): void {
    this.m_commit = aCommit;
  }
  Commit(): COMMIT | null {
    return this.m_commit;
  }

  ///< Returns information about difference between current mouse cursor position and the place
  ///< where dragging has started.
  Delta(): VECTOR2D {
    return this.returnCheckedPosition(this.m_mouseDelta);
  }

  ///< Returns mouse cursor position in world coordinates.
  Position(): VECTOR2D {
    return this.returnCheckedPosition(this.m_mousePos);
  }

  ///< Returns the point where dragging has started.
  DragOrigin(): VECTOR2D {
    return this.returnCheckedPosition(this.m_mouseDragOrigin);
  }

  ///< Returns information about mouse buttons state.
  Buttons(): number {
    console.assert(this.m_category === TC_MOUSE); // this should be used only with mouse events
    return this.m_mouseButtons;
  }

  IsClick(aButtonMask: number = BUT_ANY): boolean {
    return (
      (this.m_actions & TA_MOUSE_CLICK) !== 0 &&
      (this.m_mouseButtons & aButtonMask) === this.m_mouseButtons
    );
  }

  IsDblClick(aButtonMask: number = BUT_ANY): boolean {
    return (
      this.m_actions === TA_MOUSE_DBLCLICK &&
      (this.m_mouseButtons & aButtonMask) === this.m_mouseButtons
    );
  }

  IsDrag(aButtonMask: number = BUT_ANY): boolean {
    return (
      this.m_actions === TA_MOUSE_DRAG &&
      (this.m_mouseButtons & aButtonMask) === this.m_mouseButtons
    );
  }

  IsMouseDown(aButtonMask: number = BUT_ANY): boolean {
    return (
      this.m_actions === TA_MOUSE_DOWN &&
      (this.m_mouseButtons & aButtonMask) === this.m_mouseButtons
    );
  }

  IsMouseUp(aButtonMask: number = BUT_ANY): boolean {
    return (
      this.m_actions === TA_MOUSE_UP && (this.m_mouseButtons & aButtonMask) === this.m_mouseButtons
    );
  }

  IsMotion(): boolean {
    return this.m_actions === TA_MOUSE_MOTION;
  }

  IsMouseAction(): boolean {
    return (this.m_actions & TA_MOUSE) !== 0;
  }

  IsCancel(): boolean {
    return this.m_actions === TA_CANCEL_TOOL;
  }

  IsActivate(): boolean {
    return this.m_actions === TA_ACTIVATE;
  }

  IsUndoRedo(): boolean {
    return (this.m_actions & (TA_UNDO_REDO_PRE | TA_UNDO_REDO_POST)) !== 0;
  }

  IsChoiceMenu(): boolean {
    return (this.m_actions & TA_CHOICE_MENU) !== 0;
  }

  IsPrime(): boolean {
    return this.m_actions === TA_PRIME;
  }

  ///< Returns information about key modifiers state (Ctrl, Alt, etc.)
  Modifier(aMask: number = MD_MODIFIER_MASK): number {
    return this.m_modifiers & aMask;
  }

  ///< Returns true if the event is from the keyboard and any modifier key is disabled.
  DisableGridSnapping(): boolean {
    return this.Modifier(MD_CTRL) !== 0;
  }

  KeyCode(): number {
    return this.m_keyCode;
  }

  IsKeyPressed(): boolean {
    return this.m_actions === TA_KEY_PRESSED;
  }

  /**
   * Test whether two events match in terms of category & action or command.
   *
   * @param aEvent is the event to test against.
   * @return True if two events match, false otherwise.
   */
  Matches(aEvent: TOOL_EVENT): boolean {
    if (!(this.m_category & aEvent.m_category)) return false;

    if (this.m_category === TC_COMMAND || this.m_category === TC_MESSAGE) {
      if (this.m_commandStr !== '' && aEvent.getCommandStr() !== '')
        return this.m_commandStr === aEvent.m_commandStr;

      if (this.m_commandId !== undefined && aEvent.m_commandId !== undefined)
        return this.m_commandId === aEvent.m_commandId;
    }

    // BUGFIX: TA_ANY should match EVERYTHING, even TA_NONE (for TC_MESSAGE)
    if (
      this.m_actions === TA_ANY &&
      aEvent.m_actions === TA_NONE &&
      aEvent.m_category === TC_MESSAGE
    )
      return true;

    // BUGFIX: This check must happen after the TC_COMMAND check because otherwise events of
    // the form { TC_COMMAND, TA_NONE } will be incorrectly skipped
    if (!(this.m_actions & aEvent.m_actions)) return false;

    return true;
  }

  /**
   * Test if the event contains an action (i.e. the event is a command/message that
   * is being performed on a tool).
   *
   * @param aAction is the action to be checked against.
   * @return True if it matches, false otherwise.
   */
  IsAction(aAction: TOOL_ACTION): boolean {
    return this.Matches(aAction.MakeEvent());
  }

  /**
   * Indicate the event should restart/end an ongoing interactive tool's event loop (eg esc key,
   * click cancel, start different tool).
   */
  IsCancelInteractive(): boolean {
    return (
      (g_cancelInteractive !== null && this.m_commandStr === g_cancelInteractive.GetName()) ||
      (g_cancelInteractive !== null &&
        this.m_commandId !== undefined &&
        this.m_commandId === g_cancelInteractive.GetId()) ||
      this.m_actions === TA_CANCEL_TOOL
    );
  }

  /**
   * Indicate an selection-changed notification event.
   */
  IsSelectionEvent(): boolean {
    return (
      this.Matches(EVENTS.ClearedEvent) ||
      this.Matches(EVENTS.UnselectedEvent) ||
      this.Matches(EVENTS.SelectedEvent) ||
      this.Matches(EVENTS.PointSelectedEvent)
    );
  }

  /**
   * Indicate if the event is from one of the point editors.
   *
   * Usually used to allow the point editor to activate itself without de-activating the
   * current drawing tool.
   */
  IsPointEditor(): boolean {
    return (
      this.m_commandStr.includes('PointEditor') ||
      (g_activatePointEditor !== null &&
        this.m_commandId !== undefined &&
        this.m_commandId === g_activatePointEditor.GetId())
    );
  }

  /**
   * Indicate if the event is from one of the move tools.
   *
   * Usually used to allow move to be done without de-activating the current drawing tool.
   */
  IsMoveTool(): boolean {
    return this.m_commandStr.includes('InteractiveMove');
  }

  /**
   * Indicate if the event is from one of the editor tools.
   *
   * Usually used to allow the editor tools to activate themselves without de-activating the
   * current drawing tool.
   */
  IsEditorTool(): boolean {
    return this.m_commandStr.includes('InteractiveEdit');
  }

  /**
   * Indicate if the event is from the simulator.
   */
  IsSimulator(): boolean {
    return this.m_commandStr.includes('Simulation');
  }

  /**
   * Return a non-standard parameter assigned to the event. Its meaning depends on the
   * target tool.
   */
  HasParameter(): boolean {
    return this.m_hasParam;
  }

  Parameter<T>(): T {
    console.assert(
      this.m_hasParam,
      'Attempted to get a parameter from an event with no parameter.',
    );
    return this.m_param as T;
  }

  /**
   * Set a non-standard parameter assigned to the event. Its meaning depends on the
   * target tool.
   *
   * @param aParam is the new parameter.
   */
  SetParameter<T>(aParam: T): void {
    this.m_param = aParam;
    this.m_hasParam = true;
  }

  GetCommandId(): number | undefined {
    return this.m_commandId;
  }

  SetMousePosition(aP: VECTOR2D): void {
    this.m_mousePos = { ...aP };
  }

  SetActionGroup(aGroup: TOOL_ACTION_GROUP): void {
    this.m_actionGroup = new TOOL_ACTION_GROUP(aGroup);
  }

  IsActionInGroup(aGroup: TOOL_ACTION_GROUP): boolean {
    if (this.m_actionGroup !== undefined) return this.m_actionGroup.equals(aGroup);

    return false;
  }

  Format(): string {
    let ev: string;

    const categories: FlagString[] = [
      { flag: TC_MOUSE, str: 'mouse' },
      { flag: TC_KEYBOARD, str: 'keyboard' },
      { flag: TC_COMMAND, str: 'command' },
      { flag: TC_MESSAGE, str: 'message' },
      { flag: TC_VIEW, str: 'view' },
      { flag: 0, str: '' },
    ];

    const actions: FlagString[] = [
      { flag: TA_MOUSE_CLICK, str: 'click' },
      { flag: TA_MOUSE_DBLCLICK, str: 'double click' },
      { flag: TA_MOUSE_UP, str: 'button-up' },
      { flag: TA_MOUSE_DOWN, str: 'button-down' },
      { flag: TA_MOUSE_DRAG, str: 'drag' },
      { flag: TA_MOUSE_MOTION, str: 'motion' },
      { flag: TA_MOUSE_WHEEL, str: 'wheel' },
      { flag: TA_KEY_PRESSED, str: 'key-pressed' },
      { flag: TA_VIEW_REFRESH, str: 'view-refresh' },
      { flag: TA_VIEW_ZOOM, str: 'view-zoom' },
      { flag: TA_VIEW_PAN, str: 'view-pan' },
      { flag: TA_VIEW_DIRTY, str: 'view-dirty' },
      { flag: TA_CHANGE_LAYER, str: 'change-layer' },
      { flag: TA_CANCEL_TOOL, str: 'cancel-tool' },
      { flag: TA_CHOICE_MENU_UPDATE, str: 'choice-menu-update' },
      { flag: TA_CHOICE_MENU_CHOICE, str: 'choice-menu-choice' },
      { flag: TA_UNDO_REDO_PRE, str: 'undo-redo-pre' },
      { flag: TA_UNDO_REDO_POST, str: 'undo-redo-post' },
      { flag: TA_ACTION, str: 'action' },
      { flag: TA_ACTIVATE, str: 'activate' },
      { flag: 0, str: '' },
    ];

    const buttons: FlagString[] = [
      { flag: BUT_NONE, str: 'none' },
      { flag: BUT_LEFT, str: 'left' },
      { flag: BUT_RIGHT, str: 'right' },
      { flag: BUT_MIDDLE, str: 'middle' },
      { flag: BUT_AUX1, str: 'aux1' },
      { flag: BUT_AUX2, str: 'aux2' },
      { flag: 0, str: '' },
    ];

    const modifiers: FlagString[] = [
      { flag: MD_SHIFT, str: 'shift' },
      { flag: MD_CTRL, str: 'ctrl' },
      { flag: MD_ALT, str: 'alt' },
      { flag: MD_SUPER, str: 'super' },
      { flag: MD_META, str: 'meta' },
      { flag: MD_ALTGR, str: 'altgr' },
      { flag: 0, str: '' },
    ];

    ev = `category: ${flag2string(this.m_category, categories)} `;
    ev += `action: ${flag2string(this.m_actions, actions)} `;

    ev += 'action-group: ';

    if (this.m_actionGroup !== undefined) {
      ev += `${this.m_actionGroup.GetName()}(${this.m_actionGroup.GetGroupID()}) `;
    } else {
      ev += 'none ';
    }

    if (this.m_actions & TA_MOUSE) ev += `btns: ${flag2string(this.m_mouseButtons, buttons)} `;

    if (this.m_actions & TA_KEYBOARD) ev += `key: ${this.m_keyCode} `;

    if (this.m_actions & (TA_MOUSE | TA_KEYBOARD))
      ev += `mods: ${flag2string(this.m_modifiers, modifiers)} `;

    if (this.m_commandId !== undefined) ev += `cmd-id: ${this.m_commandId} `;

    ev += `cmd-str: ${this.m_commandStr}`;

    return ev;
  }

  // The C++ friends (TOOL_EVENT_LIST, TOOL_DISPATCHER, TOOL_MANAGER, TOOLS_HOLDER).
  init(): void {
    // By default only MESSAGEs and Cancels are passed to multiple recipients
    this.m_passEvent =
      this.m_category === TC_MESSAGE || this.IsCancelInteractive() || this.IsActivate();

    this.m_hasPosition = this.m_category === TC_MOUSE || this.m_category === TC_COMMAND;

    // Cancel tool doesn't contain a position
    if (this.IsCancel()) this.m_hasPosition = false;

    this.m_forceImmediate = false;
    this.m_reactivate = false;
  }

  getCommandStr(): string {
    return this.m_commandStr;
  }

  setMouseDragOrigin(aP: VECTOR2D): void {
    this.m_mouseDragOrigin = { ...aP };
  }

  setMouseDelta(aP: VECTOR2D): void {
    this.m_mouseDelta = { ...aP };
  }

  setMouseButtons(aButtons: number): void {
    console.assert((aButtons & ~BUT_BUTTON_MASK) === 0);
    this.m_mouseButtons = aButtons;
  }

  setModifiers(aMods: number): void {
    console.assert((aMods & ~MD_MODIFIER_MASK) === 0);
    this.m_modifiers = aMods;
  }

  /**
   * Ensure that the event is a type that has a position before returning a
   * position, otherwise return a null-constructed position.
   *
   * Used to defend the position accessors from runtime access when the event
   * does not have a valid position.
   *
   * @param aPos the position to return if the event is valid
   * @return the checked position
   */
  private returnCheckedPosition(aPos: VECTOR2D): VECTOR2D {
    if (!this.HasPosition()) {
      console.assert(false, 'Attempted to get position from non-position event');
      return { x: 0, y: 0 };
    }

    return aPos;
  }
}

export type OPT_TOOL_EVENT = TOOL_EVENT | undefined;

/**
 * A list of TOOL_EVENTs, with overloaded || operators allowing for concatenating TOOL_EVENTs
 * with little code.
 */
export class TOOL_EVENT_LIST {
  private m_events: TOOL_EVENT[] = [];

  constructor();
  constructor(aSingleEvent: TOOL_EVENT);
  constructor(aEventList: TOOL_EVENT_LIST);
  constructor(a?: TOOL_EVENT | TOOL_EVENT_LIST) {
    if (a instanceof TOOL_EVENT) this.m_events.push(a);
    else if (a instanceof TOOL_EVENT_LIST) {
      this.m_events = [];
      for (const event of a.m_events) this.m_events.push(event);
    }
  }

  Format(): string {
    let s = '';

    for (const e of this.m_events) s += `${e.Format()} `;

    return s;
  }

  Names(): string {
    let s = '';

    for (const e of this.m_events) s += `${e.getCommandStr()} `;

    return s;
  }

  Matches(aEvent: TOOL_EVENT): OPT_TOOL_EVENT {
    for (const event of this.m_events) {
      if (event.Matches(aEvent)) return event;
    }

    return undefined;
  }

  /**
   * Add a tool event to the list.
   *
   * @param aEvent is the tool event to be added.
   */
  Add(aEvent: TOOL_EVENT): void {
    this.m_events.push(aEvent);
  }

  [Symbol.iterator](): IterableIterator<TOOL_EVENT> {
    return this.m_events[Symbol.iterator]();
  }

  size(): number {
    return this.m_events.length;
  }

  clear(): void {
    this.m_events = [];
  }

  /** `operator=( const TOOL_EVENT_LIST& )` / `operator=( const TOOL_EVENT& )`. */
  assign(a: TOOL_EVENT | TOOL_EVENT_LIST): this {
    this.m_events = [];

    if (a instanceof TOOL_EVENT) this.m_events.push(a);
    else for (const event of a.m_events) this.m_events.push(event);

    return this;
  }

  /** `operator||( const TOOL_EVENT& )` / `operator||( const TOOL_EVENT_LIST& )`. */
  or(a: TOOL_EVENT | TOOL_EVENT_LIST): this {
    if (a instanceof TOOL_EVENT) this.Add(a);
    else this.m_events.push(...a.m_events);

    return this;
  }
}

/** `aEventA || aEventB` on two events, or an event and a list: a new list of both. */
export function eventsOr(
  aEventA: TOOL_EVENT,
  aEventB: TOOL_EVENT | TOOL_EVENT_LIST,
): TOOL_EVENT_LIST {
  if (aEventB instanceof TOOL_EVENT) {
    const l = new TOOL_EVENT_LIST();
    l.Add(aEventA);
    l.Add(aEventB);
    return l;
  }

  const l = new TOOL_EVENT_LIST(aEventB);
  l.Add(aEventA);
  return l;
}

/**
 * Gather all the events that are needed for the system-wide selection and
 * undo/redo notifications (actions.h:341, actions.cpp:1470).
 */
export class EVENTS {
  static readonly PointSelectedEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.pointSelected',
  );
  static readonly SelectedEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.selected',
  );
  static readonly UnselectedEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.unselected',
  );
  static readonly ClearedEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.cleared',
  );

  static readonly ConnectivityChangedEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.connectivityChanged',
  );

  ///< Selected items were moved, this can be very high frequency on the canvas, use with care
  static readonly SelectedItemsModified = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.modified',
  );
  ///< Selected items were moved, this can be very high frequency on the canvas, use with care
  static readonly SelectedItemsMoved = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.moved',
  );

  ///< Used to inform tools that the selection should temporarily be non-editable
  static readonly InhibitSelectionEditing = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.inhibit',
  );
  static readonly UninhibitSelectionEditing = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.uninhibit',
  );

  ///< Used to inform tool that it should display the disambiguation menu
  static readonly DisambiguatePoint = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.disambiguate',
  );

  static readonly GridChangedByKeyEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.gridChangedByKey',
  );
  static readonly ContrastModeChangedByKeyEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_ACTION,
    'common.Interactive.contrastModeChangedByKeyEvent',
  );

  static readonly UndoRedoPreEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_UNDO_REDO_POST,
    TOOL_ACTION_SCOPE.AS_GLOBAL,
  );
  static readonly UndoRedoPostEvent = new TOOL_EVENT(
    TC_MESSAGE,
    TA_UNDO_REDO_POST,
    TOOL_ACTION_SCOPE.AS_GLOBAL,
  );
}
