// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ACTION_MANAGER` (include/tool/action_manager.h, common/tool/action_manager.cpp):
 * the registry of every TOOL_ACTION, their ids, hotkeys and UI conditions.
 */
import { KeyCodeFromKeyName, ReadHotKeyConfig } from '../hotkeys_basic.js';
import { SELECTION_CONDITIONS, type SELECTION_CONDITION } from './selection_conditions.js';
import { AS_GLOBAL, TOOL_ACTION } from './tool_action.js';
import { MD_MODIFIER_MASK, MD_SHIFT } from './tool_event.js';
import type { TOOL_MANAGER } from './tool_manager.js';

/**
 * Functors that can be used to figure out how the action controls should be displayed in the UI
 * and if an action should be enabled given the current selection.
 */
export class ACTION_CONDITIONS {
  checkCondition: SELECTION_CONDITION; ///< Returns true if the UI control should be checked
  enableCondition: SELECTION_CONDITION; ///< Returns true if the UI control should be enabled
  showCondition: SELECTION_CONDITION; ///< Returns true if the UI control should be shown

  constructor() {
    this.checkCondition = SELECTION_CONDITIONS.ShowNever; // Never check by default
    this.enableCondition = SELECTION_CONDITIONS.ShowAlways; // Always enable by default
    this.showCondition = SELECTION_CONDITIONS.ShowAlways; // Always show by default
  }

  Check(aCondition: SELECTION_CONDITION): this {
    this.checkCondition = aCondition;
    return this;
  }

  Enable(aCondition: SELECTION_CONDITION): this {
    this.enableCondition = aCondition;
    return this;
  }

  Show(aCondition: SELECTION_CONDITION): this {
    this.showCondition = aCondition;
    return this;
  }
}

/**
 * Manage #TOOL_ACTION objects.
 *
 * Registering them and allows one to run them using associated hot keys, names or some other
 * events (in the future there will be even more ways to call an action).  Registering and
 * unregistering is done via the RegisterAction() and UnregisterAction() methods.
 */
export class ACTION_MANAGER {
  ///< Tool manager needed to run actions
  private m_toolMgr: TOOL_MANAGER | null;

  ///< Map for indexing actions by their names
  private m_actionNameIndex = new Map<string, TOOL_ACTION>();

  ///< Map for recording actions that have custom UI IDs
  private m_customUIIdIndex = new Map<number, TOOL_ACTION>();

  ///< Map for indexing actions by their hotkeys
  private m_actionHotKeys = new Map<number, TOOL_ACTION[]>();

  ///< Quick action<->hot key lookup
  private m_hotkeys = new Map<number, number>();

  /// Map the command ID that wx uses for the action to the UI conditions for the
  /// menu/toolbar items
  private m_uiConditions = new Map<number, ACTION_CONDITIONS>();

  /** `static std::list<TOOL_ACTION*> actionList` of `GetActionList()`. */
  private static readonly actionList: TOOL_ACTION[] = [];

  /** `static int currentActionId = 1` of `MakeActionId()`. */
  private static currentActionId = 1;

  /** The `static` maps of `UpdateHotKeys()`. */
  private static readonly legacyHotKeyMap = new Map<string, number>();
  private static readonly userHotKeyMap = new Map<string, [number, number]>();
  private static mapsInitialized = false;

  /**
   * The hotkey file texts `UpdateHotKeys( true )` reads: the C++ opens
   * `user.hotkeys` and the legacy `<app>.hotkeys` from the settings path; a
   * browser has them from its settings store, so they are handed to the
   * manager here.
   */
  static SetHotKeyConfigFiles(aUserHotkeys: string, aLegacyHotkeys = ''): void {
    ACTION_MANAGER.userHotkeysText = aUserHotkeys;
    ACTION_MANAGER.legacyHotkeysText = aLegacyHotkeys;
    ACTION_MANAGER.mapsInitialized = false;
  }
  private static userHotkeysText = '';
  private static legacyHotkeysText = '';

  constructor(aToolManager: TOOL_MANAGER | null) {
    this.m_toolMgr = aToolManager;

    // Register known actions
    const actionList = ACTION_MANAGER.GetActionList();

    for (const action of actionList) {
      if (action.m_id === -1) action.m_id = ACTION_MANAGER.MakeActionId(action.m_name);

      this.RegisterAction(action);
    }
  }

  /**
   * Add a tool action to the manager and sets it up. After that is is possible to invoke
   * the action using hotkeys or sending a command event with its name.
   *
   * @param aAction: action to be added. Ownership is not transferred.
   */
  RegisterAction(aAction: TOOL_ACTION): void {
    // TOOL_ACTIONs are supposed to be named [appName.]toolName.actionName (with dots between)
    // action name without specifying at least toolName is not valid
    console.assert(aAction.GetName().includes('.'));

    // TOOL_ACTIONs must have unique names & ids
    console.assert(
      !this.m_actionNameIndex.has(aAction.m_name),
      `Action '${aAction.m_name}' already registered`,
    );

    this.m_actionNameIndex.set(aAction.m_name, aAction);

    if (aAction.HasCustomUIId()) this.m_customUIIdIndex.set(aAction.GetUIId(), aAction);
  }

  /**
   * Set the conditions the UI elements for activating a specific tool action should use
   * for determining the current UI state (e.g. checked, enabled, shown)
   *
   * @param aAction is the tool action using these conditions.
   * @param aConditions are the conditions to use for the action.
   */
  SetConditions(aAction: TOOL_ACTION, aConditions: ACTION_CONDITIONS): void {
    // Remove any existing handlers with the old conditions to ensure the UI layer doesn't
    // keep stale ones
    if (this.m_uiConditions.has(aAction.GetId())) {
      if (this.m_toolMgr) this.m_toolMgr.GetToolHolder()?.UnregisterUIUpdateHandler(aAction);

      this.m_uiConditions.delete(aAction.GetId());
    }

    this.m_uiConditions.set(aAction.GetId(), aConditions);

    // Register a new handler with the new conditions
    if (this.m_toolMgr)
      this.m_toolMgr.GetToolHolder()?.RegisterUIUpdateHandler(aAction, aConditions);
  }

  /**
   * Get the conditions to use for a specific tool action.
   *
   * @param aAction is the action to get the conditions for.
   * @return the action conditions, returns nullptr if no conditions are registered.
   */
  GetCondition(aAction: TOOL_ACTION): ACTION_CONDITIONS | null {
    // If the action doesn't have something registered, then return null
    return this.m_uiConditions.get(aAction.GetId()) ?? null;
  }

  /**
   * Generate an unique ID from for an action with given name.
   */
  static MakeActionId(_aActionName: string): number {
    return ACTION_MANAGER.currentActionId++;
  }

  /**
   * Get a list of currently-registered actions mapped by their name.
   */
  GetActions(): ReadonlyMap<string, TOOL_ACTION> {
    return this.m_actionNameIndex;
  }

  /**
   * Check if the given ID is a valid action ID (i.e. is between the base ID and
   * the largest currently-registered ID)
   */
  IsActionUIId(aId: number): boolean {
    // Automatically assigned IDs are always in this range
    if (aId >= TOOL_ACTION.GetBaseUIId()) return true;

    // Search the custom assigned UI IDs
    return this.m_customUIIdIndex.has(aId);
  }

  /**
   * Find an action with a given name (if there is one available).
   *
   * @param aActionName is the searched action.
   * @return Pointer to a TOOL_ACTION object or NULL if there is no such action.
   */
  FindAction(aActionName: string): TOOL_ACTION | null {
    return this.m_actionNameIndex.get(aActionName) ?? null;
  }

  /**
   * Run an action associated with a hotkey (if there is one available).
   *
   * @param aHotKey is the hotkey to be handled.
   * @return True if there was an action associated with the hotkey, false otherwise.
   */
  RunHotKey(aHotKey: number): boolean {
    let key = aHotKey & ~MD_MODIFIER_MASK;
    const mod = aHotKey & MD_MODIFIER_MASK;

    if (key >= 0x61 && key <= 0x7a) key = key - 0x20; // std::toupper

    let it = this.m_actionHotKeys.get(key | mod);

    // If no luck, try without Shift, to handle keys that require it
    // e.g. to get ? you need to press Shift+/ without US keyboard layout
    // Hardcoding ? as Shift+/ is a bad idea, as on another layout you may need to press a
    // different combination.
    // This doesn't apply for letters, as we already handled case normalisation.
    if (it === undefined && !isalpha(key)) {
      it = this.m_actionHotKeys.get(key | (mod & ~MD_SHIFT));
    }

    // Still no luck, we're done without a match
    if (it === undefined) return false; // no appropriate action found for the hotkey

    const actions = it;

    // Choose the action that has the highest priority on the active tools stack
    // If there is none, run the global action associated with the hot key
    let highestPriority = -1;
    let priority = -1;
    let context: TOOL_ACTION | null = null; // pointer to context action of the highest priority tool
    const global: TOOL_ACTION[] = []; // pointers to global actions
    // if there is no context action

    for (const action of actions) {
      if (action.GetScope() === AS_GLOBAL) {
        // Store the global action in case there are no context actions to run
        global.push(action);
        continue;
      }

      const tool = this.m_toolMgr!.FindTool(action.GetToolName());

      if (tool) {
        // Choose the action that goes to the tool with highest priority
        // (i.e. is on the top of active tools stack)
        priority = this.m_toolMgr!.GetPriority(tool.GetId());

        if (priority >= 0 && priority > highestPriority) {
          highestPriority = priority;
          context = action;
        }
      }
    }

    // Get the selection to use to test if the action is enabled
    const sel = this.m_toolMgr!.GetToolHolder()!.GetCurrentSelection();

    if (context) {
      let runAction = true;

      const aCond = this.GetCondition(context);
      if (aCond) runAction = aCond.enableCondition(sel);

      if (runAction) return this.m_toolMgr!.RunAction(context);
    } else if (global.length !== 0) {
      for (const act of global) {
        let runAction = true;

        const aCond = this.GetCondition(act);
        if (aCond) runAction = aCond.enableCondition(sel);

        if (runAction && this.m_toolMgr!.RunAction(act)) return true;
      }
    }

    return false;
  }

  /**
   * Return the hot key associated with a given action or 0 if there is none.
   *
   * @param aAction is the queried action.
   */
  GetHotKey(aAction: TOOL_ACTION): number {
    return this.m_hotkeys.get(aAction.GetId()) ?? 0;
  }

  /**
   * Optionally read the hotkey config files and then rerun all the action hotkey
   * assignments.
   *
   * @param aFullUpdate to read the hotkey config files, else just recalc.
   */
  UpdateHotKeys(aFullUpdate: boolean): void {
    this.m_actionHotKeys.clear();
    this.m_hotkeys.clear();

    if (this.m_toolMgr!.GetToolHolder() && (aFullUpdate || !ACTION_MANAGER.mapsInitialized)) {
      ACTION_MANAGER.legacyHotKeyMap.clear();
      ReadLegacyHotkeyConfigText(ACTION_MANAGER.legacyHotkeysText, ACTION_MANAGER.legacyHotKeyMap);
      ACTION_MANAGER.userHotKeyMap.clear();
      ReadHotKeyConfig(ACTION_MANAGER.userHotkeysText, ACTION_MANAGER.userHotKeyMap);
      ACTION_MANAGER.mapsInitialized = true;
    }

    for (const action of this.m_actionNameIndex.values()) {
      let hotkey = 0;
      let alt = 0;

      if (aFullUpdate)
        this.processHotKey(action, ACTION_MANAGER.legacyHotKeyMap, ACTION_MANAGER.userHotKeyMap);

      hotkey = action.GetHotKey();
      alt = action.GetHotKeyAlt();

      if (hotkey > 0) mapListPush(this.m_actionHotKeys, hotkey, action);

      if (alt > 0) mapListPush(this.m_actionHotKeys, alt, action);

      this.m_hotkeys.set(action.GetId(), hotkey);
    }
  }

  /**
   * Return list of TOOL_ACTIONs.
   *
   * #TOOL_ACTIONs add themselves to the list upon their creation.
   *
   * @return List of TOOL_ACTIONs.
   */
  static GetActionList(): TOOL_ACTION[] {
    return ACTION_MANAGER.actionList;
  }

  // Resolve a hotkey by applying legacy and current settings over the action's
  // default hotkey.
  private processHotKey(
    aAction: TOOL_ACTION,
    aLegacyMap: ReadonlyMap<string, number>,
    aHotKeyMap: ReadonlyMap<string, [number, number]>,
  ): void {
    aAction.m_hotKey = aAction.m_defaultHotKey;

    if (aAction.m_legacyName !== '' && aLegacyMap.has(aAction.m_legacyName))
      aAction.SetHotKey(aLegacyMap.get(aAction.m_legacyName)!);

    const keys = aHotKeyMap.get(aAction.m_name);
    if (keys) aAction.SetHotKey(keys[0], keys[1]);
  }
}

function isalpha(key: number): boolean {
  return (key >= 0x41 && key <= 0x5a) || (key >= 0x61 && key <= 0x7a);
}

function mapListPush(aMap: Map<number, TOOL_ACTION[]>, aKey: number, aAction: TOOL_ACTION): void {
  let list = aMap.get(aKey);
  if (!list) {
    list = [];
    aMap.set(aKey, list);
  }
  list.push(aAction);
}

/**
 * `ReadLegacyHotkeyConfigFile` (hotkeys_basic.cpp): the pre-6.0 `<app>.hotkeys`
 * text — `shortcut "<key>": "<action>"` lines — into a name → key map.
 */
export function ReadLegacyHotkeyConfigText(aText: string, aMap: Map<string, number>): number {
  if (aText === '') return 0;

  let data = aText;

  // Is this the wxConfig format? If so, remove "Keys=" and parse the newlines.
  if (data.startsWith('Keys=')) data = data.slice('Keys='.length).replaceAll('\\n', '\n');

  // parse
  for (const line of data.split(/[\r\n]+/)) {
    if (line === '') continue;

    const tokens = line.split(/[ \t\r\n]+/).filter((t) => t !== '');
    const line_type = tokens[0] ?? '';

    if (line_type === '') continue;

    if (line_type[0] === '#')
      // comment
      continue;

    if (line_type[0] === '[')
      // tags ignored reading legacy hotkeys
      continue;

    if (line_type === '$Endlist') break;

    if (line_type !== 'shortcut') continue;

    // Get the key name
    const rest = line.slice(line.indexOf('shortcut') + 'shortcut'.length);
    const parts = rest.split(/["\r\n\t ]+/).filter((t) => t !== '');
    const keyname = parts[0] ?? '';

    // Get the command name
    const remainder = rest.slice(rest.indexOf(keyname) + keyname.length);
    const q1 = remainder.indexOf('"');
    const fctname = q1 >= 0 ? remainder.slice(q1 + 1).split('"')[0]! : '';

    // Add the pair to the map
    aMap.set(fctname, KeyCodeFromKeyName(keyname));
  }

  return 1;
}
