// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ACTIONS` (include/tool/actions.h, common/tool/actions.cpp): the tool
 * actions shared by every editor — file, edit, view, grid, cursor, zoom,
 * help. Each is a static TOOL_ACTION, registered with ACTION_MANAGER as it
 * is built, exactly as the C++ statics are. The strings are the C++'s
 * untranslated `_()` sources; the getters translate in KiCad and do not here.
 *
 * The event set (`EVENTS`) is defined in tool_event.ts (see there) and
 * re-exported under its C++ home.
 */
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import { WXK } from '@ziroeda/wx/wx_keycodes.js';
import { BITMAPS } from '@ziroeda/include/bitmaps/bitmaps_list.js';
import type { EdaUnits } from '../eda_units.js';
import { ARC_EDIT_MODE, FRAME_T, wxID } from '../frame_type.js';
import {
  TOOL_ACTION,
  TOOL_ACTION_ARGS,
  TOOL_ACTION_FLAGS,
  TOOL_ACTION_SCOPE,
  TOOLBAR_STATE,
} from './tool_action.js';
import { EVENTS, MD_ALT, MD_CTRL, MD_SHIFT, setInteractiveActions } from './tool_event.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export { EVENTS };

/** `'N'` in a hotkey: the character's code, as C++ `int` promotion gives it. */
const ch = (c: string): number => c.charCodeAt(0);

/**
 * `CLIENT_SELECTION_FILTER` (actions.h:37): the callback a caller of
 * `selectionCursor` passes to narrow what the cursor picks. The collector and
 * the selection tool are stage 3's; the parameter's shape is theirs.
 */
export type CLIENT_SELECTION_FILTER = (
  aWhere: VECTOR2D,
  aCollector: unknown,
  aTool: unknown,
) => void;

///< Cursor control event types
export enum CURSOR_EVENT_TYPE {
  CURSOR_NONE = 0,
  CURSOR_UP,
  CURSOR_UP_FAST,
  CURSOR_DOWN,
  CURSOR_DOWN_FAST,
  CURSOR_LEFT,
  CURSOR_LEFT_FAST,
  CURSOR_RIGHT,
  CURSOR_RIGHT_FAST,
  CURSOR_CLICK,
  CURSOR_DBL_CLICK,
  CURSOR_RIGHT_CLICK,
}

///< Remove event modifier flags
export enum REMOVE_FLAGS {
  NORMAL = 0x00,
  ALT = 0x01,
  CUT = 0x02,
}

///< Increment event parameters
export interface INCREMENT {
  // Amount to increment
  Delta: number;
  // Which "thing" to increment
  // (what this is depends on the action - a pin might be number, then name)
  Index: number;
}

/**
 * Gather all the actions that are shared by tools.
 *
 * The instance of a subclass of ACTIONS is created inside of ACTION_MANAGER object that
 * registers the actions.
 */
export class ACTIONS {
  static readonly CURSOR_EVENT_TYPE = CURSOR_EVENT_TYPE;
  static readonly REMOVE_FLAGS = REMOVE_FLAGS;

  static readonly doNew = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.new')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('N'))
      .LegacyHotkeyName('New')
      .FriendlyName(_HKI('New...'))
      .Tooltip(_HKI('Create a new document in the editor'))
      .Icon(BITMAPS.new_generic),
  );

  static readonly newLibrary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.newLibrary')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('New Library...'))
      .Tooltip(_HKI('Create a new library folder'))
      .Icon(BITMAPS.new_library),
  );

  static readonly addLibrary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.addLibrary')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Add Library...'))
      .Tooltip(_HKI('Add an existing library folder'))
      .Icon(BITMAPS.add_library),
  );

  static readonly open = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.open')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('O'))
      .LegacyHotkeyName('Open')
      .FriendlyName(_HKI('Open...'))
      .Tooltip(_HKI('Open existing document'))
      .Icon(BITMAPS.directory_open),
  );

  static readonly openWithTextEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.openWithTextEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Edit in a Text Editor...'))
      .Tooltip(_HKI('Open a library file with a text editor'))
      .Icon(BITMAPS.editor),
  );

  static readonly openDirectory = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.openDirectory')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Open in file explorer...'))
      .Tooltip(_HKI('Open a library file with system file explorer'))
      .Icon(BITMAPS.directory_browser),
  );

  static readonly save = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.save')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('S'))
      .LegacyHotkeyName('Save')
      .FriendlyName('Save')
      .Tooltip(_HKI('Save changes'))
      .Icon(BITMAPS.save),
  );

  static readonly saveAs = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.saveAs')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('S'))
      .LegacyHotkeyName('Save As')
      .FriendlyName(_HKI('Save As...'))
      .Tooltip(_HKI('Save current document to another location'))
      .Icon(BITMAPS.save_as),
  );

  static readonly saveCopy = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.saveCopy')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Save a Copy...'))
      .Tooltip(_HKI('Save a copy of the current document to another location'))
      .Icon(BITMAPS.save_as),
  );

  static readonly saveAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.saveAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Save All'))
      .Tooltip(_HKI('Save all changes'))
      .Icon(BITMAPS.save_all),
  );

  static readonly revert = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.revert')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Revert'))
      .Tooltip(_HKI('Throw away changes'))
      .Icon(BITMAPS.restore_from_file),
  );

  static readonly pageSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.pageSettings')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Page Settings...'))
      .Tooltip(_HKI('Settings for paper size and title block info'))
      .Icon(BITMAPS.sheetset),
  );

  static readonly print = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.print')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('P'))
      .LegacyHotkeyName('Print')
      .FriendlyName(_HKI('Print...'))
      .Icon(BITMAPS.print_button),
  );

  static readonly plot = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.plot')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Plot...'))
      .Icon(BITMAPS.plot),
  );

  static readonly quit = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.quit')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Quit'))
      .Tooltip(_HKI('Close the current editor'))
      .Icon(BITMAPS.exit),
  );

  // Selection actions

  static readonly selectionActivate = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  // No description, not shown anywhere

  static readonly selectionCursor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.cursor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Parameter<CLIENT_SELECTION_FILTER | null>(null),
  );

  static readonly selectItem = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.selectItem')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly selectItems = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.selectItems')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly unselectItem = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.unselectItem')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly unselectItems = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.unselectItems')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly reselectItem = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.reselectItem')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly selectionClear = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.clear')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly selectionMenu = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.selectionMenu')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  // Group actions

  static readonly group = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.group')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Group Items'))
      .Tooltip(_HKI('Group the selected items so that they are treated as a single item'))
      .Icon(BITMAPS.group),
  );

  static readonly ungroup = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.ungroup')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Ungroup Items'))
      .Tooltip(_HKI('Ungroup any selected groups'))
      .Icon(BITMAPS.group_ungroup),
  );

  static readonly addToGroup = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.addToGroup')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Add Items'))
      .Tooltip(_HKI('Add items to group'))
      .Icon(BITMAPS.group_remove),
  );

  static readonly removeFromGroup = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.removeFromGroup')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Remove Items'))
      .Tooltip(_HKI('Remove items from group'))
      .Icon(BITMAPS.group_remove),
  );

  static readonly groupEnter = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.groupEnter')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Enter Group'))
      .Tooltip(_HKI('Enter the group to edit items'))
      .Icon(BITMAPS.group_enter),
  );

  static readonly groupLeave = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.groupLeave')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Leave Group'))
      .Tooltip(_HKI('Leave the current group'))
      .Icon(BITMAPS.group_leave),
  );

  // GROUP_TOOL

  static readonly groupProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS().Name('common.Groups.groupProperties').Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly pickNewGroupMember = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Groups.selectNewGroupMember')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  // Generic Edit Actions

  static readonly cancelInteractive = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.cancel')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Cancel'))
      .Tooltip(_HKI('Cancel current tool'))
      .Icon(BITMAPS.cancel)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE),
  );

  // ESC key is handled in the dispatcher

  static readonly finishInteractive = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.finish')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_END)
      .FriendlyName(_HKI('Finish'))
      .Tooltip(_HKI('Finish current tool'))
      .Icon(BITMAPS.checked_ok)
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE),
  );

  static readonly showContextMenu = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showContextMenu')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Show Context Menu'))
      .Tooltip(_HKI('Perform the right-mouse-button action'))
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_RIGHT_CLICK)
      .ToolbarState(TOOLBAR_STATE.HIDDEN),
  );

  static readonly updateMenu = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.updateMenu')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly undo = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.undo')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('Z'))
      .LegacyHotkeyName('Undo')
      .FriendlyName('Undo')
      .Icon(BITMAPS.undo),
  );

  static readonly redo = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.redo')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('Y'))
      .LegacyHotkeyName('Redo')
      .FriendlyName('Redo')
      .Icon(BITMAPS.redo),
  );

  // The following actions need to have a hard-coded UI ID using a wx-specific ID
  // to fix things like search controls in standard file dialogs. If wxWidgets
  // doesn't find these specific IDs somewhere in the menus then it won't enable
  // cut/copy/paste.

  static readonly cut = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.cut')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('X'))
      .LegacyHotkeyName('Cut')
      .FriendlyName('Cut')
      .Tooltip(_HKI('Cut selected item(s) to clipboard'))
      .Icon(BITMAPS.cut)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .UIId(wxID.wxID_CUT),
  );

  static readonly copy = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.copy')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('C'))
      .LegacyHotkeyName('Copy')
      .FriendlyName('Copy')
      .Tooltip(_HKI('Copy selected item(s) to clipboard'))
      .Icon(BITMAPS.copy)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .UIId(wxID.wxID_COPY),
  );

  static readonly copyAsText = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.copyAsText')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('C'))
      .FriendlyName(_HKI('Copy as Text'))
      .Tooltip(_HKI('Copy selected item(s) to clipboard as text'))
      .Icon(BITMAPS.copy)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE),
  );

  static readonly paste = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.paste')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('V'))
      .LegacyHotkeyName('Paste')
      .FriendlyName('Paste')
      .Tooltip(_HKI('Paste item(s) from clipboard'))
      .Icon(BITMAPS.paste)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .UIId(wxID.wxID_PASTE),
  );

  static readonly selectSetRect = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.selectSetRect')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Rectangle'))
      .Tooltip(_HKI('Set selection mode to use rectangle'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.cursor)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly selectSetLasso = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.selectSetLasso')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Lasso'))
      .Tooltip(_HKI('Set selection mode to use polygon lasso'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.lasso)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly selectAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.selectAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('A'))
      .FriendlyName(_HKI('Select All'))
      .Tooltip(_HKI('Select all items on screen')),
  );

  static readonly unselectAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.unselectAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('A'))
      .FriendlyName(_HKI('Unselect All'))
      .Tooltip(_HKI('Unselect all items on screen')),
  );

  static readonly pasteSpecial = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.pasteSpecial')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('V'))
      .FriendlyName(_HKI('Paste Special...'))
      .Tooltip(_HKI('Paste item(s) from clipboard with options'))
      .Icon(BITMAPS.paste_special),
  );

  static readonly duplicate = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.duplicate')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('D'))
      .LegacyHotkeyName('Duplicate')
      .FriendlyName('Duplicate')
      .Tooltip(_HKI('Duplicates the selected item(s)'))
      .Icon(BITMAPS.duplicate),
  );

  static readonly doDelete = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.delete')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_DELETE)
      .LegacyHotkeyName('Delete Item')
      .FriendlyName(_HKI('Delete'))
      .Tooltip(_HKI('Delete selected item(s)'))
      .Icon(BITMAPS.trash)
      .Parameter(REMOVE_FLAGS.NORMAL),
  );

  // differentiation from deleteTool, below

  static readonly deleteTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.deleteTool')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Interactive Delete Tool'))
      .Tooltip(_HKI('Delete clicked items'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.delete_cursor)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly leftJustify = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.leftJustify')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Left Justify'))
      .Tooltip(_HKI('Left-justify fields and text items'))
      .Icon(BITMAPS.text_align_left),
  );

  static readonly centerJustify = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.centerJustify')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Center Justify'))
      .Tooltip(_HKI('Center-justify fields and text items'))
      .Icon(BITMAPS.text_align_center),
  );

  static readonly rightJustify = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.rightJustify')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Right Justify'))
      .Tooltip(_HKI('Right-justify fields and text items'))
      .Icon(BITMAPS.text_align_right),
  );

  static readonly expandAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.expandAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Expand All'))
      .Icon(BITMAPS.up),
  );

  // JEY TODO: need icon

  static readonly collapseAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.collapseAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Collapse All'))
      .Icon(BITMAPS.down),
  );

  // JEY TODO: need icon
  // This is the generic increment action, and will need the parameter
  // to be filled in by the event producer.

  static readonly increment = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('eeschema.Interactive.increment')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Increment'))
      .Tooltip(_HKI('Increment the selected item(s)')),
  );

  static readonly incrementPrimary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('eeschema.Interactive.incrementPrimary')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Increment Primary'))
      .Tooltip(_HKI('Increment the primary field of the selected item(s)'))
      .Parameter<INCREMENT>({ Delta: 1, Index: 0 }),
  );

  static readonly decrementPrimary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('eeschema.Interactive.decrementPrimary')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Decrement Primary'))
      .Tooltip(_HKI('Decrement the primary field of the selected item(s)'))
      .Parameter<INCREMENT>({ Delta: -1, Index: 0 }),
  );

  static readonly incrementSecondary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('eeschema.Interactive.incrementSecondary')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Increment Secondary'))
      .Tooltip(_HKI('Increment the secondary field of the selected item(s)'))
      .Parameter<INCREMENT>({ Delta: 1, Index: 1 }),
  );

  static readonly decrementSecondary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('eeschema.Interactive.decrementSecondary')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Decrement Secondary'))
      .Tooltip(_HKI('Decrement the secondary field of the selected item(s)'))
      .Parameter<INCREMENT>({ Delta: -1, Index: 1 }),
  );

  static readonly selectColumns = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.SelectColumns')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Select Column(s)'))
      .Tooltip(_HKI('Select complete column(s) containing the current selected cell(s)'))
      .Icon(BITMAPS.table_select_column),
  );

  static readonly selectRows = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.Rows')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Select Row(s)'))
      .Tooltip(_HKI('Select complete row(s) containing the current selected cell(s)'))
      .Icon(BITMAPS.table_select_row),
  );

  static readonly selectTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.SelectTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Select Table'))
      .Tooltip(_HKI('Select parent table of selected cell(s)'))
      .Icon(BITMAPS.table_select),
  );

  static readonly addRowAbove = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.addRowAbove')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Add Row Above'))
      .Tooltip(_HKI('Insert a new table row above the selected cell(s)'))
      .Icon(BITMAPS.table_add_row_above),
  );

  static readonly addRowBelow = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.addRowBelow')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Add Row Below'))
      .Tooltip(_HKI('Insert a new table row below the selected cell(s)'))
      .Icon(BITMAPS.table_add_row_below),
  );

  static readonly addColBefore = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.addColBefore')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Add Column Before'))
      .Tooltip(_HKI('Insert a new table column before the selected cell(s)'))
      .Icon(BITMAPS.table_add_column_before),
  );

  static readonly addColAfter = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.addColAfter')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Add Column After'))
      .Tooltip(_HKI('Insert a new table column after the selected cell(s)'))
      .Icon(BITMAPS.table_add_column_after),
  );

  static readonly deleteRows = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.deleteRows')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Delete Row(s)'))
      .Tooltip(_HKI('Delete rows containing the currently selected cell(s)'))
      .Icon(BITMAPS.table_delete_row),
  );

  static readonly deleteColumns = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.deleteColumns')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Delete Column(s)'))
      .Tooltip(_HKI('Delete columns containing the currently selected cell(s)'))
      .Icon(BITMAPS.table_delete_column),
  );

  static readonly mergeCells = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.mergeCells')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Merge Cells'))
      .Tooltip(_HKI('Turn selected table cells into a single cell'))
      .Icon(BITMAPS.table),
  );

  // JEY TODO: need icon

  static readonly unmergeCells = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.unmergeCell')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Unmerge Cells'))
      .Tooltip(_HKI('Turn merged table cells back into separate cells.'))
      .Icon(BITMAPS.table),
  );

  // JEY TODO: need icon

  static readonly editTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.TableEditor.editTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .FriendlyName(_HKI('Edit Table...'))
      .Icon(BITMAPS.table_edit),
  );

  static readonly exportTableCSV = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.TableEditor.exportTableCSV')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export Table to CSV'))
      .MenuText(_HKI('Export Table to CSV...'))
      .Tooltip(_HKI('Export table contents to CSV file with resolved text variables'))
      .Icon(BITMAPS.export_file),
  );

  static readonly activatePointEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.activatePointEditor')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly pointEditorArcKeepCenter = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.arcKeepCenter')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Keep Arc Center, Adjust Radius'))
      .Tooltip(_HKI('Switch arc editing mode to keep center, adjust radius and endpoints'))
      .Parameter(ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS),
  );

  static readonly pointEditorArcKeepEndpoint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.arcKeepEndpoint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Keep Arc Endpoints or Direction of Starting Point'))
      .Tooltip(
        _HKI('Switch arc editing mode to keep endpoints, or to keep direction of the other point'),
      )
      .Parameter(ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION),
  );

  static readonly pointEditorArcKeepRadius = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.arcKeepRadius')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Keep Arc Radius and Center, adjust angle'))
      .Tooltip(_HKI('Switch arc editing mode to maintaining radius when endpoint are moved'))
      .Parameter(ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE),
  );

  static readonly cycleArcEditMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.cycleArcEditMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch(' '))
      .FriendlyName(_HKI('Cycle Arc Editing Mode'))
      .Tooltip(_HKI('Switch to a different method of editing arcs')),
  );

  static readonly showSearch = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.search')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('G'))
      .LegacyHotkeyName('Search')
      .FriendlyName('Search')
      .Tooltip(_HKI('Show/hide the search panel'))
      .Icon(BITMAPS.find),
  );

  static readonly find = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.find')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('F'))
      .LegacyHotkeyName('Find')
      .FriendlyName('Find')
      .Icon(BITMAPS.find),
  );

  static readonly findAndReplace = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.findAndReplace')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_ALT + ch('F'))
      .LegacyHotkeyName('Find and Replace')
      .FriendlyName('Find and Replace')
      .Icon(BITMAPS.find_replace),
  );

  static readonly findNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.findNext')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_F3)
      .LegacyHotkeyName('Find Next')
      .FriendlyName('Find Next')
      .Icon(BITMAPS.find),
  );

  static readonly findPrevious = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.findPrevious')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + WXK.WXK_F3)
      .LegacyHotkeyName('Find Previous')
      .FriendlyName('Find Previous')
      .Icon(BITMAPS.find),
  );

  static readonly findNextMarker = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.findNextMarker')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + WXK.WXK_F3)
      .LegacyHotkeyName('Find Next Marker')
      .FriendlyName('Find Next Marker')
      .Icon(BITMAPS.find),
  );

  static readonly replaceAndFindNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.replaceAndFindNext')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Replace and Find Next'))
      .Icon(BITMAPS.find_replace),
  );

  static readonly replaceAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.replaceAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Replace All'))
      .Icon(BITMAPS.find_replace),
  );

  static readonly updateFind = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.updateFind')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  // Marker Controls

  static readonly prevMarker = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Checker.prevMarker')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Previous Marker'))
      .Icon(BITMAPS.marker_previous),
  );

  static readonly nextMarker = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Checker.nextMarker')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Next Marker'))
      .Icon(BITMAPS.marker_next),
  );

  static readonly excludeMarker = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Checker.excludeMarker')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Exclude Marker'))
      .Tooltip(_HKI('Mark current violation in Checker window as an exclusion'))
      .Icon(BITMAPS.marker_exclude),
  );

  // View Controls

  static readonly zoomRedraw = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomRedraw')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_F5)
      .LegacyHotkeyName('Zoom Redraw')
      .FriendlyName(_HKI('Refresh'))
      .Icon(BITMAPS.refresh),
  );

  static readonly zoomFitScreen = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomFitScreen')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_HOME)
      .LegacyHotkeyName('Zoom Auto')
      .FriendlyName(_HKI('Zoom to Fit'))
      .Tooltip(_HKI('Zoom to worksheet area if exists or edited object'))
      .Icon(BITMAPS.zoom_fit_in_page),
  );

  static readonly zoomFitObjects = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomFitObjects')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + WXK.WXK_HOME)
      .FriendlyName(_HKI('Zoom to All Objects'))
      .Tooltip(_HKI('Zoom to all objects on screen'))
      .Icon(BITMAPS.zoom_fit_to_objects),
  );

  static readonly zoomFitSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomFitSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Tooltip(_HKI('Zoom to items currently selected'))
      .FriendlyName(_HKI('Zoom to Selected Objects'))
      .Icon(BITMAPS.zoom_fit_to_objects),
  );

  static readonly zoomIn = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomIn')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_F1)
      .LegacyHotkeyName('Zoom In')
      .FriendlyName(_HKI('Zoom In at Cursor'))
      .Icon(BITMAPS.zoom_in),
  );

  static readonly zoomOut = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomOut')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_F2)
      .LegacyHotkeyName('Zoom Out')
      .FriendlyName(_HKI('Zoom Out at Cursor'))
      .Icon(BITMAPS.zoom_out),
  );

  static readonly zoomInCenter = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomInCenter')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Zoom In')
      .Icon(BITMAPS.zoom_in),
  );

  static readonly zoomOutCenter = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomOutCenter')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Zoom Out')
      .Icon(BITMAPS.zoom_out),
  );

  static readonly zoomInHorizontally = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomInHorizontally')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Zoom In Horizontally'))
      .Tooltip(_HKI('Zoom in horizontally the plot area'))
      .Icon(BITMAPS.zoom_in_horizontally),
  );

  static readonly zoomOutHorizontally = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomOutHorizontally')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Zoom Out Horizontally'))
      .Tooltip(_HKI('Zoom out horizontally the plot area'))
      .Icon(BITMAPS.zoom_out_horizontally),
  );

  static readonly zoomInVertically = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomInVertically')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Zoom In Vertically'))
      .Tooltip(_HKI('Zoom in vertically the plot area'))
      .Icon(BITMAPS.zoom_in_vertically),
  );

  static readonly zoomOutVertically = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomOutVertically')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Zoom Out Vertically'))
      .Tooltip(_HKI('Zoom out vertically the plot area'))
      .Icon(BITMAPS.zoom_out_vertically),
  );

  static readonly zoomCenter = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomCenter')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_F4)
      .LegacyHotkeyName('Zoom Center')
      .FriendlyName(_HKI('Center on Cursor'))
      .Icon(BITMAPS.zoom_center_on_screen),
  );

  static readonly zoomTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomTool')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + WXK.WXK_F5)
      .LegacyHotkeyName('Zoom to Selection')
      .FriendlyName(_HKI('Zoom to Selection Area'))
      .Tooltip(_HKI('Zoom to an area selection created by a mouse drag'))
      .Icon(BITMAPS.zoom_area)
      .ToolbarState([TOOLBAR_STATE.TOGGLE, TOOLBAR_STATE.CANCEL])
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly zoomUndo = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.undoZoom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Undo Last Zoom'))
      .Tooltip(_HKI('Return zoom to level prior to last zoom action'))
      .Icon(BITMAPS.undo),
  );

  static readonly zoomRedo = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.redoZoom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Redo Last Zoom'))
      .Tooltip(_HKI('Return zoom to level prior to last zoom undo'))
      .Icon(BITMAPS.redo),
  );

  static readonly zoomPreset = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.zoomPreset')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Parameter<number>(0),
  );

  // Default parameter is the 0th item in the list

  static readonly centerContents = new TOOL_ACTION(
    new TOOL_ACTION_ARGS().Name('common.Control.centerContents').Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly centerSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.centerSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Pan to Center Selected Objects')),
  );

  // Cursor control

  static readonly cursorUp = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorUp')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_UP)
      .FriendlyName(_HKI('Cursor Up'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_UP),
  );

  static readonly cursorDown = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorDown')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_DOWN)
      .FriendlyName(_HKI('Cursor Down'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_DOWN),
  );

  static readonly cursorLeft = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorLeft')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_LEFT)
      .FriendlyName(_HKI('Cursor Left'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_LEFT),
  );

  static readonly cursorRight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorRight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_RIGHT)
      .FriendlyName(_HKI('Cursor Right'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_RIGHT),
  );

  static readonly cursorUpFast = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorUpFast')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + WXK.WXK_UP)
      .FriendlyName(_HKI('Cursor Up Fast'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_UP_FAST),
  );

  static readonly cursorDownFast = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorDownFast')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + WXK.WXK_DOWN)
      .FriendlyName(_HKI('Cursor Down Fast'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_DOWN_FAST),
  );

  static readonly cursorLeftFast = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorLeftFast')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + WXK.WXK_LEFT)
      .FriendlyName(_HKI('Cursor Left Fast'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_LEFT_FAST),
  );

  static readonly cursorRightFast = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorRightFast')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + WXK.WXK_RIGHT)
      .FriendlyName(_HKI('Cursor Right Fast'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_RIGHT_FAST),
  );

  static readonly cursorClick = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorClick')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_RETURN)
      .LegacyHotkeyName('Mouse Left Click')
      .FriendlyName(_HKI('Click'))
      .Tooltip(_HKI('Performs left mouse button click'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_CLICK),
  );

  static readonly cursorDblClick = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorDblClick')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_END)
      .LegacyHotkeyName('Mouse Left Double Click')
      .FriendlyName(_HKI('Double-click'))
      .Tooltip(_HKI('Performs left mouse button double-click'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_DBL_CLICK),
  );

  static readonly refreshPreview = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.refreshPreview')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly pinLibrary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.pinLibrary')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Pin Library'))
      .Tooltip(_HKI('Keep the library at the top of the list')),
  );

  static readonly unpinLibrary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.unpinLibrary')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Unpin Library'))
      .Tooltip(_HKI('No longer keep the library at the top of the list')),
  );

  static readonly showLibraryTree = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showLibraryTree')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Library Tree'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.search_tree),
  );

  static readonly hideLibraryTree = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.hideLibraryTree')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Hide Library Tree'))
      .Icon(BITMAPS.search_tree),
  );

  static readonly libraryTreeSearch = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.libraryTreeSearch')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Focus Library Tree Search Field'))
      .DefaultHotkey(MD_CTRL + ch('L'))
      .ToolbarState(TOOLBAR_STATE.HIDDEN),
  );

  static readonly panUp = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.panUp')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + WXK.WXK_UP)
      .FriendlyName(_HKI('Pan Up'))
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_UP),
  );

  static readonly panDown = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.panDown')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + WXK.WXK_DOWN)
      .FriendlyName(_HKI('Pan Down'))
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_DOWN),
  );

  static readonly panLeft = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.panLeft')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + WXK.WXK_LEFT)
      .FriendlyName(_HKI('Pan Left'))
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_LEFT),
  );

  static readonly panRight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.panRight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + WXK.WXK_RIGHT)
      .FriendlyName(_HKI('Pan Right'))
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_RIGHT),
  );

  // Grid control

  static readonly gridFast1 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.gridFast1')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('1'))
      .LegacyHotkeyName('Switch Grid To Fast Grid1')
      .FriendlyName(_HKI('Switch to Fast Grid 1')),
  );

  static readonly gridFast2 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.gridFast2')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('2'))
      .LegacyHotkeyName('Switch Grid To Fast Grid2')
      .FriendlyName(_HKI('Switch to Fast Grid 2')),
  );

  static readonly gridFastCycle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.gridFastCycle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('4'))
      .LegacyHotkeyName('Switch Grid To Next Fast Grid')
      .FriendlyName(_HKI('Cycle Fast Grid')),
  );

  static readonly gridNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.gridNext')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('N'))
      .LegacyHotkeyName('Switch Grid To Next')
      .FriendlyName(_HKI('Switch to Next Grid')),
  );

  static readonly gridPrev = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.gridPrev')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('N'))
      .LegacyHotkeyName('Switch Grid To Previous')
      .FriendlyName(_HKI('Switch to Previous Grid')),
  );

  static readonly gridSetOrigin = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.gridSetOrigin')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Set Grid Origin')
      .FriendlyName(_HKI('Grid Origin'))
      .Tooltip(_HKI('Place the grid origin point'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.grid_select_axis)
      .Parameter<VECTOR2D | null>(null),
  );

  static readonly gridResetOrigin = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.gridResetOrigin')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Reset Grid Origin')
      .FriendlyName('Reset Grid Origin'),
  );

  static readonly gridPreset = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.gridPreset')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Parameter<number>(0),
  );

  // Default to the 1st element of the list

  static readonly toggleGrid = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.toggleGrid')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Show Grid'))
      .Tooltip(_HKI('Display background grid in the edit window'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.grid),
  );

  static readonly toggleGridOverrides = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.toggleGridOverrides')
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('G'))
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Grid Overrides'))
      .Tooltip(_HKI('Enables item-specific grids that override the current grid'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.grid_override),
  );

  static readonly gridProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.editGrids')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Edit Grids...'))
      .Tooltip(_HKI('Edit grid definitions'))
      .Icon(BITMAPS.grid_select),
  );

  static readonly gridOrigin = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.editGridOrigin')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Grid Origin...'))
      .Tooltip(_HKI('Set the grid origin point'))
      .Icon(BITMAPS.grid_select_axis),
  );

  static readonly inchesUnits = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.imperialUnits')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Inches'))
      .Icon(BITMAPS.unit_inch)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter<EdaUnits>('in'),
  );

  static readonly milsUnits = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.mils')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Mils'))
      .Icon(BITMAPS.unit_mil)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter<EdaUnits>('mils'),
  );

  static readonly millimetersUnits = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.metricUnits')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Millimeters'))
      .Icon(BITMAPS.unit_mm)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter<EdaUnits>('mm'),
  );

  static readonly updateUnits = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.updateUnits')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly updatePreferences = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.updatePreferences')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly selectLibTreeColumns = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.selectColumns')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Select Columns...')),
  );

  static readonly toggleUnits = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.toggleUnits')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('U'))
      .LegacyHotkeyName('Switch Units')
      .FriendlyName(_HKI('Switch units'))
      .Tooltip(_HKI('Switch between imperial and metric units'))
      .Icon(BITMAPS.unit_mm),
  );

  static readonly togglePolarCoords = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.togglePolarCoords')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Polar Coordinates'))
      .Tooltip(_HKI('Switch between polar and cartesian coordinate systems'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.polar_coord),
  );

  static readonly resetLocalCoords = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.resetLocalCoords')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch(' '))
      .LegacyHotkeyName('Reset Local Coordinates')
      .FriendlyName('Reset Local Coordinates'),
  );

  static readonly toggleCursor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.toggleCursor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Toggle Cursor Display (Modern Toolset only)')
      .FriendlyName(_HKI('Always Show Crosshairs'))
      .Tooltip(_HKI('Display crosshairs even when not drawing objects'))
      .Icon(BITMAPS.cursor),
  );

  // Don't be tempted to remove "Modern Toolset only".  It's in the legacy property name.

  static readonly cursorSmallCrosshairs = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorSmallCrosshairs')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Small crosshairs'))
      .Tooltip(_HKI('Use small crosshairs aligned at 0 and 90 degrees'))
      .Icon(BITMAPS.cursor_shape),
  );

  static readonly cursorFullCrosshairs = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursorFullCrosshairs')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Full-Window Crosshairs'))
      .Tooltip(_HKI('Display full-window crosshairs aligned at 0 and 90 degrees'))
      .Icon(BITMAPS.cursor_fullscreen),
  );

  static readonly cursor45Crosshairs = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.cursor45Crosshairs')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('45 Degree Crosshairs'))
      .Tooltip(_HKI('Display full-window crosshairs aligned at 45 and 135 degrees'))
      .Icon(BITMAPS.cursor_fullscreen45),
  );

  static readonly highContrastMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.highContrastMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Toggle High Contrast Mode')
      .FriendlyName(_HKI('Inactive Layer View Mode'))
      .Tooltip(_HKI('Toggle inactive layers between normal and dimmed'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.contrast_mode),
  );

  static readonly highContrastModeCycle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.highContrastModeCycle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('H'))
      .FriendlyName(_HKI('Inactive Layer View Mode (3-state)'))
      .Tooltip(_HKI('Cycle inactive layers between normal, dimmed, and hidden'))
      .Icon(BITMAPS.contrast_mode),
  );

  static readonly toggleBoundingBoxes = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.toggleBoundingBoxes')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Bounding Boxes'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.gerbview_show_negative_objects),
  );

  static readonly selectionTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractiveSelection.selectionTool')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Select item(s)'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.cursor)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly measureTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Interactive.measureTool')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('M'))
      .LegacyHotkeyName('Measure Distance (Modern Toolset only)')
      .FriendlyName(_HKI('Measure Tool'))
      .Tooltip(_HKI('Interactively measure distance between points'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.measurement)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  // Don't be tempted to remove "Modern Toolset only".  It's in the legacy property name.

  static readonly pickerTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractivePicker.pickerTool')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly pickerSubTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.InteractivePicker.pickerSubTool')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly showProjectManager = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showProjectManager')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Switch to Project Manager'))
      .Tooltip(_HKI('Show project window'))
      .Icon(BITMAPS.icon_kicad_24),
  );

  static readonly show3DViewer = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.show3DViewer')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('3'))
      .LegacyHotkeyName('3D Viewer')
      .FriendlyName('3D Viewer')
      .Tooltip(_HKI('Show 3D viewer window'))
      .Icon(BITMAPS.three_d),
  );

  static readonly showSymbolBrowser = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showSymbolBrowser')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Symbol Library Browser'))
      .Icon(BITMAPS.library_browser)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(FRAME_T.FRAME_SCH_VIEWER),
  );

  static readonly showSymbolEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showSymbolEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Symbol Editor'))
      .Tooltip(_HKI('Create, delete and edit schematic symbols'))
      .Icon(BITMAPS.libedit)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(FRAME_T.FRAME_SCH_SYMBOL_EDITOR),
  );

  static readonly showFootprintBrowser = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showFootprintBrowser')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Footprint Library Browser'))
      .Icon(BITMAPS.library_browser)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(FRAME_T.FRAME_FOOTPRINT_VIEWER),
  );

  static readonly showFootprintEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showFootprintEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Footprint Editor'))
      .Tooltip(_HKI('Create, delete and edit board footprints'))
      .Icon(BITMAPS.module_editor)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(FRAME_T.FRAME_FOOTPRINT_EDITOR),
  );

  static readonly showCalculatorTools = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showCalculatorTools')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Calculator Tools'))
      .Tooltip(_HKI('Run component calculations, track width calculations, etc.'))
      .Icon(BITMAPS.icon_pcbcalculator_24)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(FRAME_T.FRAME_CALC),
  );

  static readonly showProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showProperties')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Properties'))
      .Tooltip(_HKI('Show/hide the properties manager'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.tools),
  );

  static readonly showDatasheet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.showDatasheet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('D'))
      .LegacyHotkeyName('Show Datasheet')
      .FriendlyName('Show Datasheet')
      .Tooltip(_HKI('Open the datasheet in a browser'))
      .Icon(BITMAPS.datasheet),
  );

  static readonly updatePcbFromSchematic = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.updatePcbFromSchematic')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_F8)
      .LegacyHotkeyName('Update PCB from Schematic')
      .FriendlyName(_HKI('Update PCB from Schematic...'))
      .Tooltip(_HKI('Update PCB with changes made to schematic'))
      .Icon(BITMAPS.update_pcb_from_sch),
  );

  static readonly updateSchematicFromPcb = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.updateSchematicFromPCB')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Update Schematic from PCB...'))
      .Tooltip(_HKI('Update schematic with changes made to PCB'))
      .Icon(BITMAPS.update_sch_from_pcb),
  );

  static readonly openPreferences = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.openPreferences')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch(','))
      .FriendlyName(_HKI('Preferences...'))
      .Tooltip(_HKI('Show preferences for all open tools'))
      .Icon(BITMAPS.preference)
      .UIId(wxID.wxID_PREFERENCES),
  );

  static readonly configurePaths = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.configurePaths')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Configure Paths...'))
      .Tooltip(_HKI('Edit path configuration environment variables'))
      .Icon(BITMAPS.path),
  );

  static readonly showSymbolLibTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.showSymbolLibTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Manage Symbol Libraries...'))
      .Tooltip(_HKI('Edit the global and project symbol library lists'))
      .Icon(BITMAPS.library_table),
  );

  static readonly showFootprintLibTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.showFootprintLibTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Manage Footprint Libraries...'))
      .Tooltip(_HKI('Edit the global and project footprint library lists'))
      .Icon(BITMAPS.library_table),
  );

  static readonly showDesignBlockLibTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.showDesignBLockLibTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Manage Design Block Libraries...'))
      .Tooltip(_HKI('Edit the global and project design block library lists'))
      .Icon(BITMAPS.library_table),
  );

  static readonly gettingStarted = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.gettingStarted')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Getting Started with KiCad'))
      .Tooltip(_HKI('Open "Getting Started in KiCad" guide for beginners'))
      .Icon(BITMAPS.help),
  );

  static readonly help = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.help')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Help'))
      .Tooltip(_HKI('Open product documentation in a web browser'))
      .Icon(BITMAPS.help_online),
  );

  static readonly about = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.about')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('About KiCad'))
      .UIId(wxID.wxID_ABOUT)
      .Icon(BITMAPS.about),
  );

  static readonly listHotKeys = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.listHotKeys')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + WXK.WXK_F1)
      .LegacyHotkeyName('List Hotkeys')
      .FriendlyName(_HKI('List Hotkeys...'))
      .Tooltip(_HKI('Displays current hotkeys table and corresponding commands'))
      .Icon(BITMAPS.hotkeys),
  );

  static readonly getInvolved = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.getInvolved')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Get Involved'))
      .Tooltip(_HKI('Open "Contribute to KiCad" in a web browser'))
      .Icon(BITMAPS.info),
  );

  static readonly donate = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.donate')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Donate'))
      .Tooltip(_HKI('Open "Donate to KiCad" in a web browser')),
  );

  static readonly reportBug = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.SuiteControl.reportBug')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Report Bug'))
      .Tooltip(_HKI('Report a problem with KiCad'))
      .Icon(BITMAPS.bug),
  );

  static readonly ddAddLibrary = new TOOL_ACTION(
    new TOOL_ACTION_ARGS().Name('common.Control.ddaddLibrary').Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  // API

  static readonly pluginsReload = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.API.pluginsReload')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Refresh Plugins'))
      .Tooltip(_HKI('Reload all python plugins and refresh plugin menus'))
      .Icon(BITMAPS.reload),
  );

  // Embedding Files

  static readonly embeddedFiles = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Embed.embededFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Embedded Files'))
      .Tooltip(_HKI('Manage embedded files')),
  );

  static readonly removeFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Embed.removeFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Remove File'))
      .Tooltip(_HKI('Remove an embedded file')),
  );

  static readonly extractFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Embed.extractFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Extract File'))
      .Tooltip(_HKI('Extract an embedded file')),
  );
}

setInteractiveActions(ACTIONS.cancelInteractive, ACTIONS.activatePointEditor);
