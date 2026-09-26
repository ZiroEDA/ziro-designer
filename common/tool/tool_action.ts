// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_ACTION` (include/tool/tool_action.h, common/tool/tool_action.cpp):
 * a named, hotkey-bound command a tool handles. Every action is registered
 * in `ACTION_MANAGER::GetActionList()` as it is constructed, the way the
 * C++ statics are, and gets its id when an ACTION_MANAGER is built.
 */
import { ACTION_MANAGER } from './action_manager.js';
import { TOOL_EVENT, TOOL_ACTIONS, TOOL_ACTION_SCOPE, TOOL_EVENT_CATEGORY } from './tool_event.js';
import type { BITMAPS } from '../bitmaps_list.js';
import { AddHotkeyName, IS_HOTKEY, KeyNameFromKeyCode } from '../hotkeys_basic.js';

/**
 * Scope of tool actions
 */
// TOOL_ACTION_SCOPE is tool_action.h's, but TOOL_EVENT's statics need it while
// this module is still evaluating (the two import each other), so the enum
// is defined in tool_event.ts and re-exported here under its own header.
export { AS_ACTIVE, AS_CONTEXT, AS_GLOBAL, TOOL_ACTION_SCOPE } from './tool_event.js';

/**
 * Flags for tool actions
 */
export enum TOOL_ACTION_FLAGS {
  AF_NONE = 0,
  AF_ACTIVATE = 1, ///< Action activates a tool
  AF_NOTIFY = 2, ///< Action is a notification (it is by default passed to all tools)
}
export const { AF_NONE, AF_ACTIVATE, AF_NOTIFY } = TOOL_ACTION_FLAGS;

/**
 * Flags for the toolbar state of an action
 */
export enum TOOLBAR_STATE {
  HIDDEN = 0, ///< Action is hidden from the toolbar
  TOGGLE = 1, ///< Action is a toggle button on the toolbar
  CANCEL = 2, ///< Action can be cancelled by clicking the toolbar button again
  ENUM_LENGTH = 3,
}

export const gToolbarStateNumber = TOOLBAR_STATE.ENUM_LENGTH;

/** `std::bitset<gToolbarStateNumber>`. */
export class TOOLBAR_STATE_FLAGS {
  private m_bits = 0;

  set(aState: TOOLBAR_STATE): void {
    this.m_bits |= 1 << aState;
  }
  test(aState: TOOLBAR_STATE): boolean {
    return (this.m_bits & (1 << aState)) !== 0;
  }
  clone(): TOOLBAR_STATE_FLAGS {
    const c = new TOOLBAR_STATE_FLAGS();
    c.m_bits = this.m_bits;
    return c;
  }
  to_string(): string {
    let s = '';
    for (let i = gToolbarStateNumber - 1; i >= 0; i--) s += this.m_bits & (1 << i) ? '1' : '0';
    return s;
  }
}

/**
 * Define a group that can be used to group actions (and their events) of similar operations.
 */
export class TOOL_ACTION_GROUP {
  private static groupIDs = 0;
  private readonly m_groupID: number;
  private readonly m_name: string;

  constructor(aName: string);
  constructor(aOther: TOOL_ACTION_GROUP);
  constructor(a: string | TOOL_ACTION_GROUP) {
    if (typeof a === 'string') {
      this.m_name = a;
      this.m_groupID = ++TOOL_ACTION_GROUP.groupIDs;
    } else {
      this.m_name = a.GetName();
      this.m_groupID = a.GetGroupID();
    }
  }

  GetGroupID(): number {
    return this.m_groupID;
  }
  GetName(): string {
    return this.m_name;
  }

  equals(aOther: TOOL_ACTION_GROUP): boolean {
    return this.m_groupID === aOther.m_groupID;
  }
}

/**
 * The argument builder a TOOL_ACTION is constructed from (`TOOL_ACTION_ARGS`).
 */
export class TOOL_ACTION_ARGS {
  m_name?: string;
  m_friendlyName?: string;
  m_scope?: TOOL_ACTION_SCOPE;
  m_flags?: TOOL_ACTION_FLAGS;
  m_uiid?: number;
  m_defaultHotKey?: number;
  m_defaultHotKeyAlt?: number;
  m_legacyName?: string;
  m_menuText?: string;
  m_tooltip?: string;
  m_description?: string;
  m_icon?: BITMAPS;
  m_group?: TOOL_ACTION_GROUP;
  m_toolbarState?: TOOLBAR_STATE_FLAGS;
  m_param?: unknown;
  private m_hasParam = false;

  /**
   * The name of the action, the form of this name should be:
   *
   *      appName.toolName.actionName
   *
   * The name is used to identify the action, and should be unique.
   */
  Name(aName: string): this {
    this.m_name = aName;
    return this;
  }

  /**
   * The friendly name of the action, used to display in menus and tool bar buttons.
   */
  FriendlyName(aName: string): this {
    this.m_friendlyName = aName;
    return this;
  }

  /**
   * The scope of the action, which controls where the action is available.
   */
  Scope(aScope: TOOL_ACTION_SCOPE): this {
    this.m_scope = aScope;
    return this;
  }

  /**
   * The default hotkey to use for the action
   */
  DefaultHotkey(aDefaultHotkey: number): this {
    this.m_defaultHotKey = aDefaultHotkey;
    return this;
  }

  /**
   * The alternate default hotkey to use for the action
   */
  DefaultHotkeyAlt(aDefaultHotkeyAlt: number): this {
    this.m_defaultHotKeyAlt = aDefaultHotkeyAlt;
    return this;
  }

  /**
   * The legacy hotkey name to use for the action.
   */
  LegacyHotkeyName(aLegacyName: string): this {
    this.m_legacyName = aLegacyName;
    return this;
  }

  /**
   * The text to display in the menu, when different from the friendly name.
   */
  MenuText(aMenuText: string): this {
    this.m_menuText = aMenuText;
    return this;
  }

  /**
   * The tooltip to display when hovering over the action.
   */
  Tooltip(aTooltip: string): this {
    this.m_tooltip = aTooltip;
    return this;
  }

  /**
   * The description to display in the hotkey list.
   */
  Description(aDescription: string): this {
    this.m_description = aDescription;
    return this;
  }

  /**
   * The icon to use for the action.
   */
  Icon(aIcon: BITMAPS): this {
    this.m_icon = aIcon;
    return this;
  }

  /**
   * The flags for the action.
   */
  Flags(aFlags: TOOL_ACTION_FLAGS): this {
    this.m_flags = aFlags;
    return this;
  }

  /**
   * A parameter to use with the action.
   */
  Parameter<T>(aParam: T): this {
    this.m_param = aParam;
    this.m_hasParam = true;
    return this;
  }

  /**
   * The custom UI ID to use for the action.
   */
  UIId(aUIId: number): this {
    this.m_uiid = aUIId;
    return this;
  }

  /**
   * The group the action belongs to.
   */
  Group(aGroup: TOOL_ACTION_GROUP): this {
    this.m_group = aGroup;
    return this;
  }

  /**
   * The toolbar state of the action.
   */
  ToolbarState(aState: TOOLBAR_STATE | TOOLBAR_STATE[]): this {
    this.m_toolbarState = new TOOLBAR_STATE_FLAGS();
    for (const flag of Array.isArray(aState) ? aState : [aState]) this.m_toolbarState.set(flag);
    return this;
  }

  HasParameter(): boolean {
    return this.m_hasParam;
  }
}

/**
 * Represent a single user action.
 *
 * For instance:
 * - changing layer to top by pressing PgUp
 * - selecting drawing tool by clicking on the toolbar
 * - cancelling current tool operation with pressing Esc
 *
 * Each action must have a name of format: [appName.]toolName.actionName. Actions are registered
 * with #ACTION_MANAGER and assigned IDs.
 */
export class TOOL_ACTION {
  static readonly ACTION_BASE_UI_ID = 20000;

  m_name: string; // ACTION_MANAGER, a friend, reads it
  protected m_scope: TOOL_ACTION_SCOPE;
  protected m_group: TOOL_ACTION_GROUP | undefined; ///< Optional group for the action to belong to.

  readonly m_defaultHotKey: number; ///< Default hot key.
  protected readonly m_defaultHotKeyAlt: number; ///< Default hot key alternate.
  m_hotKey!: number; ///< The current hotkey (post-user-settings-application).
  protected m_hotKeyAlt!: number;
  readonly m_legacyName: string; ///< Name for reading legacy hotkey settings.

  protected m_friendlyName: string; ///< User-friendly name.
  protected m_menuLabel: string | undefined; ///< Menu label.
  protected m_tooltip: string; ///< User facing tooltip help text.
  protected m_description: string | undefined; ///< Description of the action.

  protected m_icon: BITMAPS | undefined; ///< Icon for the menu entry

  m_id: number; ///< Unique ID for maps. Assigned by #ACTION_MANAGER.
  protected m_uiid: number | undefined; ///< ID to use when interacting with the UI (if empty, generate one).

  m_toolbarState = new TOOLBAR_STATE_FLAGS(); ///< Toolbar state behavior for the action

  protected m_flags: TOOL_ACTION_FLAGS;
  protected m_param: unknown; ///< Generic parameter.
  protected m_hasParam = false;

  constructor(aArgs: TOOL_ACTION_ARGS);
  constructor(
    aName: string,
    aScope?: TOOL_ACTION_SCOPE,
    aDefaultHotKey?: number,
    aLegacyHotKeyName?: string,
    aMenuText?: string,
    aTooltip?: string,
    aIcon?: BITMAPS,
    aFlags?: TOOL_ACTION_FLAGS,
  );
  constructor(
    a: TOOL_ACTION_ARGS | string,
    aScope: TOOL_ACTION_SCOPE = TOOL_ACTION_SCOPE.AS_CONTEXT,
    aDefaultHotKey = 0,
    aLegacyHotKeyName = '',
    aMenuText = '',
    aTooltip = '',
    aIcon: BITMAPS = 0 as BITMAPS,
    aFlags: TOOL_ACTION_FLAGS = TOOL_ACTION_FLAGS.AF_NONE,
  ) {
    if (typeof a === 'string') {
      this.m_name = a;
      this.m_scope = aScope;
      this.m_group = undefined;
      this.m_defaultHotKey = aDefaultHotKey;
      this.m_defaultHotKeyAlt = 0;
      this.m_legacyName = aLegacyHotKeyName;
      this.m_friendlyName = '';
      this.m_menuLabel = aMenuText;
      this.m_tooltip = aTooltip;
      this.m_description = undefined;
      this.m_icon = aIcon;
      this.m_id = -1;
      this.m_uiid = undefined;
      this.m_flags = aFlags;

      this.SetHotKey(aDefaultHotKey);
      ACTION_MANAGER.GetActionList().push(this);
      return;
    }

    const aArgs = a;
    this.m_name = aArgs.m_name ?? '';
    this.m_scope = aArgs.m_scope ?? TOOL_ACTION_SCOPE.AS_CONTEXT;
    this.m_defaultHotKey = aArgs.m_defaultHotKey ?? 0;
    this.m_defaultHotKeyAlt = aArgs.m_defaultHotKeyAlt ?? 0;
    this.m_hotKey = aArgs.m_defaultHotKey ?? 0;
    this.m_hotKeyAlt = 0;
    this.m_legacyName = aArgs.m_legacyName ?? '';
    this.m_friendlyName = aArgs.m_friendlyName ?? '';
    this.m_tooltip = aArgs.m_tooltip ?? '';
    this.m_id = -1;
    this.m_uiid = undefined;
    this.m_flags = aArgs.m_flags ?? TOOL_ACTION_FLAGS.AF_NONE;

    console.assert(this.m_name !== '');

    if (aArgs.m_menuText !== undefined) this.m_menuLabel = aArgs.m_menuText;

    if (aArgs.m_uiid !== undefined) this.m_uiid = aArgs.m_uiid;

    if (aArgs.HasParameter()) {
      this.m_param = aArgs.m_param;
      this.m_hasParam = true;
    }

    if (aArgs.m_description !== undefined) this.m_description = aArgs.m_description;

    if (aArgs.m_group !== undefined) this.m_group = aArgs.m_group;

    if (aArgs.m_icon !== undefined) this.m_icon = aArgs.m_icon;

    if (aArgs.m_toolbarState !== undefined) this.m_toolbarState = aArgs.m_toolbarState.clone();

    if (this.m_icon === undefined) this.m_toolbarState.set(TOOLBAR_STATE.HIDDEN);

    ACTION_MANAGER.GetActionList().push(this);
  }

  equals(aRhs: TOOL_ACTION): boolean {
    return this.m_id === aRhs.m_id;
  }

  GetName(): string {
    return this.m_name;
  }
  GetDefaultHotKey(): number {
    return this.m_defaultHotKey;
  }
  GetDefaultHotKeyAlt(): number {
    return this.m_defaultHotKeyAlt;
  }
  GetHotKey(): number {
    return this.m_hotKey;
  }
  GetHotKeyAlt(): number {
    return this.m_hotKeyAlt;
  }
  SetHotKey(aKeycode: number, aKeycodeAlt = 0): void {
    this.m_hotKey = aKeycode;
    this.m_hotKeyAlt = aKeycodeAlt;
  }

  GetId(): number {
    return this.m_id;
  }

  HasCustomUIId(): boolean {
    return this.m_uiid !== undefined;
  }

  GetUIId(): number {
    return this.m_uiid ?? this.m_id + TOOL_ACTION.ACTION_BASE_UI_ID;
  }
  static GetBaseUIId(): number {
    return TOOL_ACTION.ACTION_BASE_UI_ID;
  }

  /**
   * Return the event associated with the action (i.e. the event that will be sent after
   * activating the action).
   */
  MakeEvent(): TOOL_EVENT {
    let evt: TOOL_EVENT;

    if (this.IsActivation())
      evt = new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_COMMAND,
        TOOL_ACTIONS.TA_ACTIVATE,
        this.m_name,
        this.m_scope,
      );
    else if (this.IsNotification())
      evt = new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_MESSAGE,
        TOOL_ACTIONS.TA_NONE,
        this.m_name,
        this.m_scope,
      );
    else
      evt = new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_COMMAND,
        TOOL_ACTIONS.TA_ACTION,
        this.m_name,
        this.m_scope,
      );

    if (this.m_group !== undefined) {
      evt.SetActionGroup(this.m_group);
    }

    if (this.m_hasParam) evt.SetParameter(this.m_param);

    return evt;
  }

  GetMenuLabel(): string {
    if (this.m_menuLabel !== undefined) return this.m_menuLabel;

    return this.GetFriendlyName();
  }

  GetMenuItem(): string {
    let label = this.GetMenuLabel();
    label = label.replaceAll('&', '&&');
    return AddHotkeyName(label, this.m_hotKey, IS_HOTKEY);
  }

  GetTooltip(aIncludeHotkey = true): string {
    let tooltip = this.m_tooltip;

    if (aIncludeHotkey && this.GetHotKey())
      tooltip += `  (${KeyNameFromKeyCode(this.GetHotKey())})`;

    return tooltip;
  }

  GetButtonTooltip(): string {
    let tooltip = this.GetFriendlyName();

    if (this.GetHotKey()) tooltip += `\t(${KeyNameFromKeyCode(this.GetHotKey())})`;

    if (this.GetTooltip(false) !== '') tooltip += `\n${this.GetTooltip(false)}`;

    return tooltip;
  }

  GetDescription(): string {
    if (this.m_description === undefined) return this.GetTooltip(false);

    return this.m_description;
  }

  GetFriendlyName(): string {
    if (this.m_friendlyName === '') return '';

    return this.m_friendlyName;
  }

  GetScope(): TOOL_ACTION_SCOPE {
    return this.m_scope;
  }

  /**
   * Return a non-standard parameter assigned to the action.
   */
  GetParam<T>(): T {
    console.assert(
      this.m_hasParam,
      'Attempted to get a parameter from an action with no parameter.',
    );
    return this.m_param as T;
  }

  HasParam(): boolean {
    return this.m_hasParam;
  }

  GetActionGroup(): TOOL_ACTION_GROUP | undefined {
    return this.m_group;
  }

  /**
   * Return name of the tool associated with the action. It is basically the action name
   * stripped of the last part (e.g. for "pcbnew.InteractiveDrawing.drawCircle" it is
   * "pcbnew.InteractiveDrawing").
   */
  GetToolName(): string {
    const dotCount = this.m_name.split('.').length - 1;

    switch (dotCount) {
      case 0:
        console.assert(false); // Invalid action name format
        return '';

      case 1:
        return this.m_name;

      case 2:
        return this.m_name.substring(0, this.m_name.lastIndexOf('.'));

      default:
        console.assert(false); // TODO not implemented
        return '';
    }
  }

  /**
   * Return true if the action is intended to activate a tool.
   */
  IsActivation(): boolean {
    return (this.m_flags & TOOL_ACTION_FLAGS.AF_ACTIVATE) !== 0;
  }

  /**
   * Return true if the action is a notification.
   */
  IsNotification(): boolean {
    return (this.m_flags & TOOL_ACTION_FLAGS.AF_NOTIFY) !== 0;
  }

  /**
   * Return an icon associated with the action.
   *
   * It is used in context menu.
   */
  GetIcon(): BITMAPS {
    return this.m_icon ?? (0 as BITMAPS);
  }

  /**
   * Check if the action has the given toolbar state
   */
  CheckToolbarState(aState: TOOLBAR_STATE): boolean {
    return this.m_toolbarState.test(aState);
  }
}
