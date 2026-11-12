// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every hotkey the schematic editor binds, in one table.
 *
 * Counterpart: the `TOOL_ACTION` definitions in `eeschema/tools/sch_actions.cpp`
 * and `common/tool/actions.cpp`, each carrying a `FriendlyName` and a
 * `DefaultHotkey`. Upstream's `ACTION_MANAGER` *is* that registry, so
 * `DisplayHotkeyList` and `PANEL_HOTKEYS_EDITOR` can both walk it.
 *
 * We had no such registry. The key handler was one long `else if` chain and the
 * Hotkey List was assembled from the **menu tree**, so every binding that is not
 * also a menu item — R, X, Y, M, G, E, U, V, F, O, C, D, N, Tab, Escape, Space,
 * the grid keys — was bound and completely invisible in the dialog. It listed 42
 * of roughly 65.
 *
 * This is the single source of truth for what the dialog shows. It is data only,
 * with no React and no editor imports, so it can be tested and so the dispatcher
 * can adopt it without a cycle.
 *
 * **Labels and keys are upstream's**, taken from the `FriendlyName` and
 * `DefaultHotkey` of the action named in `upstream`. Where we deliberately
 * differ — a binding upstream resolves by tool scope that we resolve by
 * modifier, or a key that belongs to the browser — the entry says so.
 */

import { browserSafeKey } from '@ziroeda/common/browser_reserved.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A section of the Hotkey List, matching how upstream groups the editor's actions. */
export type HotkeySection =
  | 'File'
  | 'Edit'
  | 'View'
  | 'Grid'
  | 'Place'
  | 'Editing'
  | 'Selection'
  | 'Navigation'
  | 'Cursor'
  | 'Help';

export interface Hotkey {
  /** The action id the editor dispatches on; unique. */
  id: string;
  /** `FriendlyName` of the upstream action. */
  label: string;
  /** The default key combination, spelled as the menus spell it. */
  keys: string;
  section: HotkeySection;
  /** The upstream `TOOL_ACTION` this comes from, for anyone checking parity. */
  upstream: string;
  /** Why this entry differs from upstream, when it does. */
  note?: string;
}

/**
 * The table. Order inside a section is upstream's menu order where there is one,
 * otherwise the order a user would read them in.
 */
export const HOTKEYS: readonly Hotkey[] = [
  // ----- File ---------------------------------------------------------------
  { id: 'save', label: 'Save', keys: 'Ctrl+S', section: 'File', upstream: 'ACTIONS::save' },
  {
    id: 'open',
    label: _HKI('Open...'),
    keys: 'Ctrl+O',
    section: 'File',
    upstream: 'ACTIONS::open',
  },
  {
    id: 'print',
    label: _HKI('Print...'),
    keys: 'Ctrl+P',
    section: 'File',
    upstream: 'ACTIONS::print',
  },
  {
    id: 'importGraphics',
    label: _HKI('Import Graphics...'),
    keys: 'Ctrl+Shift+F',
    section: 'File',
    upstream: 'SCH_ACTIONS::importGraphics',
  },
  {
    id: 'close',
    label: 'Close',
    keys: browserSafeKey('Ctrl+W'),
    section: 'File',
    upstream: 'ACTIONS::quit',
    note: 'ACTION_MENU::AddClose spells this Ctrl+W; a browser keeps that key for closing the tab, so BROWSER_REBINDS moves it.',
  },
  {
    id: 'preferences',
    label: _HKI('Preferences...'),
    keys: 'Ctrl+,',
    section: 'File',
    upstream: 'ACTIONS::openPreferences',
  },

  // ----- Edit ---------------------------------------------------------------
  { id: 'undo', label: 'Undo', keys: 'Ctrl+Z', section: 'Edit', upstream: 'ACTIONS::undo' },
  {
    id: 'redo',
    label: 'Redo',
    keys: 'Ctrl+Y',
    section: 'Edit',
    upstream: 'ACTIONS::redo',
    // actions.cpp:292-302 binds Ctrl+Shift+Z inside `#if defined( __WXMAC__ )`
    // and Ctrl+Y in the `#else`. We are the `#else`, so Ctrl+Y is the whole
    // answer and Ctrl+Shift+Z is bound nowhere. (The note that used to sit here
    // said Ctrl+Shift+Z "redoes too" -- it never did; no handler read it.)
  },
  { id: 'cut', label: 'Cut', keys: 'Ctrl+X', section: 'Edit', upstream: 'ACTIONS::cut' },
  { id: 'copy', label: 'Copy', keys: 'Ctrl+C', section: 'Edit', upstream: 'ACTIONS::copy' },
  {
    id: 'copyAsText',
    label: _HKI('Copy as Text'),
    keys: 'Ctrl+Shift+C',
    section: 'Edit',
    upstream: 'ACTIONS::copyAsText',
  },
  { id: 'paste', label: 'Paste', keys: 'Ctrl+V', section: 'Edit', upstream: 'ACTIONS::paste' },
  {
    id: 'pasteSpecial',
    label: _HKI('Paste Special...'),
    keys: 'Ctrl+Shift+V',
    section: 'Edit',
    upstream: 'ACTIONS::pasteSpecial',
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    keys: 'Ctrl+D',
    section: 'Edit',
    upstream: 'ACTIONS::duplicate',
  },
  {
    id: 'delete',
    label: _HKI('Delete'),
    keys: 'Del',
    section: 'Edit',
    upstream: 'ACTIONS::doDelete',
    // actions.cpp:401-406 binds WXK_BACK inside `#if defined( __WXMAC__ )` and
    // WXK_DELETE in the `#else`, so Del is the whole answer here. The note that
    // used to sit here said "Backspace deletes too, as upstream binds it" --
    // upstream binds it on macOS only, and we are not macOS.
  },
  {
    id: 'selectAll',
    label: _HKI('Select All'),
    keys: 'Ctrl+A',
    section: 'Edit',
    upstream: 'ACTIONS::selectAll',
  },
  {
    id: 'unselectAll',
    label: _HKI('Unselect All'),
    keys: 'Ctrl+Shift+A',
    section: 'Edit',
    upstream: 'ACTIONS::unselectAll',
  },
  { id: 'find', label: 'Find', keys: 'Ctrl+F', section: 'Edit', upstream: 'ACTIONS::find' },
  {
    id: 'findReplace',
    label: 'Find and Replace',
    keys: 'Ctrl+Alt+F',
    section: 'Edit',
    upstream: 'ACTIONS::findAndReplace',
  },
  {
    id: 'findNext',
    label: 'Find Next',
    keys: 'F3',
    section: 'Edit',
    upstream: 'ACTIONS::findNext',
  },
  {
    id: 'findPrevious',
    label: 'Find Previous',
    keys: 'Shift+F3',
    section: 'Edit',
    upstream: 'ACTIONS::findPrevious',
  },

  // ----- View ---------------------------------------------------------------
  {
    id: 'zoomFit',
    label: _HKI('Zoom to Fit'),
    keys: 'Home',
    section: 'View',
    upstream: 'ACTIONS::zoomFitScreen',
  },
  {
    id: 'zoomFitObjects',
    label: _HKI('Zoom to All Objects'),
    keys: 'Ctrl+Home',
    section: 'View',
    upstream: 'ACTIONS::zoomFitObjects',
  },
  {
    id: 'zoomIn',
    label: _HKI('Zoom In at Cursor'),
    keys: 'F1',
    section: 'View',
    upstream: 'ACTIONS::zoomIn',
  },
  {
    id: 'zoomOut',
    label: _HKI('Zoom Out at Cursor'),
    keys: 'F2',
    section: 'View',
    upstream: 'ACTIONS::zoomOut',
  },
  {
    id: 'zoomInCenter',
    label: 'Zoom In',
    keys: '',
    section: 'View',
    /*
     * No hotkey, and that is upstream's: `ACTIONS::zoomInCenter`
     * (`actions.cpp:769-773`) declares a Name, a Scope, a FriendlyName and an
     * Icon, and no `DefaultHotkey` on any platform.
     *
     * This row and `zoomIn` above used to be crossed: the halves of two actions
     * were split across them, so "Zoom In at Cursor" on F1 was filed under
     * `zoomInCenter` while `zoomIn` carried the label "Zoom In" and the macOS
     * key Ctrl++. They differ in behaviour, not only in name -- `zoomIn` zooms
     * about the cursor, `zoomInCenter` about the viewport centre -- and the key
     * handler was already dispatching F1 to the cursor one. Only the table was
     * wrong.
     */
    upstream: 'ACTIONS::zoomInCenter',
  },
  {
    id: 'zoomOutCenter',
    label: 'Zoom Out',
    keys: '',
    section: 'View',
    // The other half of the same pair, and unbound for the same reason:
    // `ACTIONS::zoomOutCenter` (`actions.cpp:775-779`) carries no DefaultHotkey.
    upstream: 'ACTIONS::zoomOutCenter',
  },
  {
    id: 'zoomRedraw',
    label: _HKI('Refresh'),
    keys: 'F5',
    section: 'View',
    upstream: 'ACTIONS::zoomRedraw',
    // actions.cpp:705-716 has exactly one key per platform: Ctrl+R on macOS,
    // WXK_F5 everywhere else. Ctrl+R is bound nowhere here.
  },
  {
    id: 'zoomTool',
    label: _HKI('Zoom to Selection Area'),
    keys: 'Ctrl+F5',
    section: 'View',
    upstream: 'ACTIONS::zoomTool',
  },
  {
    id: 'toggleUnits',
    label: _HKI('Switch units'),
    keys: 'Ctrl+U',
    section: 'View',
    upstream: 'ACTIONS::toggleUnits',
  },
  {
    id: 'showSearch',
    label: 'Search',
    keys: 'Ctrl+G',
    section: 'View',
    upstream: 'ACTIONS::showSearch',
  },
  {
    id: 'showHierarchy',
    label: _HKI('Hierarchy Navigator'),
    keys: 'Ctrl+H',
    section: 'View',
    upstream: 'SCH_ACTIONS::showHierarchy',
  },

  // ----- Grid ---------------------------------------------------------------
  {
    id: 'gridNext',
    label: _HKI('Switch to Next Grid'),
    keys: 'N',
    section: 'Grid',
    upstream: 'ACTIONS::gridNext',
  },
  {
    id: 'gridPrev',
    label: _HKI('Switch to Previous Grid'),
    keys: 'Shift+N',
    section: 'Grid',
    upstream: 'ACTIONS::gridPrev',
  },
  {
    id: 'gridFast1',
    label: _HKI('Fast Grid 1'),
    keys: 'Alt+1',
    section: 'Grid',
    upstream: 'ACTIONS::gridFast1',
  },
  {
    id: 'gridFast2',
    label: _HKI('Fast Grid 2'),
    keys: 'Alt+2',
    section: 'Grid',
    upstream: 'ACTIONS::gridFast2',
  },
  {
    id: 'gridFastCycle',
    label: _HKI('Cycle Fast Grid'),
    keys: 'Alt+4',
    section: 'Grid',
    upstream: 'ACTIONS::gridFastCycle',
  },
  {
    id: 'toggleGridOverrides',
    label: _HKI('Grid Overrides'),
    keys: 'Ctrl+Shift+G',
    section: 'Grid',
    upstream: 'ACTIONS::toggleGridOverrides',
  },

  // ----- Place --------------------------------------------------------------
  {
    id: 'placeSymbol',
    label: _HKI('Place Symbols'),
    keys: 'A',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeSymbol',
  },
  {
    id: 'placePower',
    label: _HKI('Place Power Symbols'),
    keys: 'P',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placePower',
  },
  {
    id: 'drawWire',
    label: _HKI('Draw Wires'),
    keys: 'W',
    section: 'Place',
    upstream: 'SCH_ACTIONS::drawWire',
  },
  {
    id: 'drawBus',
    label: _HKI('Draw Buses'),
    keys: 'B',
    section: 'Place',
    upstream: 'SCH_ACTIONS::drawBus',
  },
  {
    id: 'busEntry',
    label: _HKI('Place Wire to Bus Entries'),
    keys: 'Z',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeBusWireEntry',
  },
  {
    id: 'noConnect',
    label: _HKI('Place/Remove No Connect Flags'),
    keys: 'Q',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeNoConnect',
  },
  {
    id: 'junction',
    label: _HKI('Place Junctions'),
    keys: 'J',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeJunction',
  },
  {
    id: 'placeLabel',
    label: _HKI('Place Net Labels'),
    keys: 'L',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeLabel',
  },
  {
    id: 'placeGlobalLabel',
    label: _HKI('Place Global Labels'),
    keys: 'Ctrl+L',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeGlobalLabel',
  },
  {
    id: 'placeHierLabel',
    label: _HKI('Place Hierarchical Labels'),
    keys: 'H',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeHierLabel',
  },
  {
    id: 'drawSheet',
    label: _HKI('Draw Hierarchical Sheets'),
    keys: 'S',
    section: 'Place',
    upstream: 'SCH_ACTIONS::drawSheet',
  },
  {
    id: 'placeText',
    label: _HKI('Draw Text'),
    keys: 'T',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeSchematicText',
  },
  {
    id: 'lines',
    label: _HKI('Draw Lines'),
    keys: 'I',
    section: 'Place',
    upstream: 'SCH_ACTIONS::drawLines',
  },
  {
    id: 'unfoldBus',
    label: 'Unfold from Bus',
    keys: 'C',
    section: 'Place',
    upstream: 'SCH_ACTIONS::unfoldBus',
  },
  {
    id: 'repeatDrawItem',
    label: 'Repeat Last Item',
    keys: 'Ins',
    section: 'Place',
    upstream: 'SCH_ACTIONS::repeatDrawItem',
    // sch_actions.cpp:757-759: F1 is the `#if defined( __WXMAC__ )` branch,
    // WXK_INSERT the `#else`. The old note claimed this shares F1 with Zoom In
    // "as upstream does" — upstream has no such collision on either platform.
    // On macOS repeat is F1 and zoom in is Ctrl++; here repeat is Ins and zoom
    // in is F1. The clash was ours, made by mixing the two branches.
  },

  // ----- Editing ------------------------------------------------------------
  {
    id: 'move',
    label: _HKI('Move'),
    keys: 'M',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::move',
  },
  {
    id: 'drag',
    label: _HKI('Drag'),
    keys: 'G',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::drag',
  },
  {
    id: 'rotateCW',
    label: _HKI('Rotate Clockwise'),
    keys: 'R',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::rotateCW',
  },
  {
    id: 'rotateCCW',
    label: _HKI('Rotate Counterclockwise'),
    keys: 'Shift+R',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::rotateCCW',
  },
  {
    id: 'mirrorV',
    label: _HKI('Mirror Vertically'),
    keys: 'X',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::mirrorV',
  },
  {
    id: 'mirrorH',
    label: _HKI('Mirror Horizontally'),
    keys: 'Y',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::mirrorH',
  },
  {
    id: 'properties',
    label: _HKI('Properties...'),
    keys: 'E',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::properties',
  },
  {
    id: 'editReference',
    label: _HKI('Edit Reference Designator...'),
    keys: 'U',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::editReference',
  },
  {
    id: 'editValue',
    label: _HKI('Edit Value...'),
    keys: 'V',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::editValue',
  },
  {
    id: 'editFootprint',
    label: _HKI('Edit Footprint...'),
    keys: 'F',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::editFootprint',
  },
  {
    id: 'autoplaceFields',
    label: 'Autoplace Fields',
    keys: 'O',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::autoplaceFields',
  },
  {
    id: 'showDatasheet',
    label: 'Show Datasheet',
    keys: 'D',
    section: 'Editing',
    upstream: 'ACTIONS::showDatasheet',
  },
  {
    id: 'swap',
    label: _HKI('Swap'),
    keys: 'Alt+S',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::swap',
  },
  {
    id: 'editWithLibEdit',
    label: 'Edit with Symbol Editor',
    keys: 'Ctrl+E',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::editWithLibEdit',
  },
  {
    id: 'cycleArcEditMode',
    label: _HKI('Cycle Arc Editing Mode'),
    keys: 'Ctrl+Space',
    section: 'Editing',
    upstream: 'ACTIONS::cycleArcEditMode',
  },
  {
    id: 'lineModeCycle',
    label: _HKI('Line Mode for Wires and Buses'),
    keys: 'Shift+Space',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::lineModeNext',
  },
  {
    id: 'updatePcbFromSch',
    label: _HKI('Update PCB from Schematic...'),
    keys: 'F8',
    section: 'Editing',
    upstream: 'ACTIONS::updatePcbFromSchematic',
  },

  // ----- Selection ----------------------------------------------------------
  {
    id: 'selectNode',
    label: 'Select Node',
    keys: 'Alt+3',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::selectNode',
  },
  {
    id: 'selectConnection',
    label: _HKI('Select/Expand Connection'),
    keys: 'Ctrl+4',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::selectConnection',
  },
  {
    id: 'nextNetItem',
    label: _HKI('Next Net Item'),
    keys: 'Tab',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::nextNetItem',
  },
  {
    id: 'previousNetItem',
    label: _HKI('Previous Net Item'),
    keys: 'Shift+Tab',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::previousNetItem',
  },
  {
    id: 'highlightNet',
    label: _HKI('Highlight Net'),
    keys: '`',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::highlightNet',
  },
  {
    id: 'clearHighlight',
    label: _HKI('Clear Net Highlighting'),
    keys: '~',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::clearHighlight',
  },
  {
    id: 'resetLocalCoord',
    label: 'Reset Local Coordinates',
    keys: 'Space',
    section: 'Selection',
    upstream: 'ACTIONS::resetLocalCoords',
  },
  {
    id: 'cancel',
    label: _HKI('Cancel'),
    keys: 'Esc',
    section: 'Selection',
    upstream: 'ACTIONS::cancelInteractive',
  },

  // ----- Navigation ---------------------------------------------------------
  {
    id: 'navBack',
    label: _HKI('Navigate Back'),
    keys: 'Alt+Left',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::navigateBack',
  },
  {
    id: 'navUp',
    label: _HKI('Navigate Up'),
    keys: 'Alt+Up',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::navigateUp',
  },
  {
    id: 'navFwd',
    label: _HKI('Navigate Forward'),
    keys: 'Alt+Right',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::navigateForward',
  },
  {
    id: 'leaveSheet',
    label: 'Leave Sheet',
    // `Back`, not `Backspace`: hotkeyNameList spells WXK_BACK that way
    // (hotkeys_basic.cpp:95), and this column is the Hotkey List's. The menu
    // row prints GTK's `Alt+BackSpace` - see `ui/key_names.ts`.
    keys: 'Alt+Back',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::leaveSheet',
  },
  {
    id: 'navPrev',
    label: _HKI('Previous Sheet'),
    keys: 'PgUp',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::navigatePrevious',
  },
  {
    id: 'navNext',
    label: _HKI('Next Sheet'),
    keys: 'PgDn',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::navigateNext',
  },

  // ----- Cursor -------------------------------------------------------------
  // `COMMON_TOOLS::CursorControl` / `PanControl`. Upstream finishes each of
  // these with `SetCursorPosition( cursor, /* warpMouse */ true )`; a page
  // cannot move the OS pointer, so the crosshair moves and the pointer does
  // not, and the next real mouse move snaps it back. Noted on each entry.
  {
    id: 'cursorUp',
    label: _HKI('Cursor Up'),
    keys: 'Up',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorUp',
    note: 'Moves the crosshair, not the OS pointer, which a browser cannot warp.',
  },
  {
    id: 'cursorDown',
    label: _HKI('Cursor Down'),
    keys: 'Down',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorDown',
    note: 'Moves the crosshair, not the OS pointer, which a browser cannot warp.',
  },
  {
    id: 'cursorLeft',
    label: _HKI('Cursor Left'),
    keys: 'Left',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorLeft',
    note: 'Moves the crosshair, not the OS pointer, which a browser cannot warp.',
  },
  {
    id: 'cursorRight',
    label: _HKI('Cursor Right'),
    keys: 'Right',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorRight',
    note: 'Moves the crosshair, not the OS pointer, which a browser cannot warp.',
  },
  {
    id: 'cursorUpFast',
    label: _HKI('Cursor Up Fast'),
    keys: 'Ctrl+Up',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorUpFast',
    note: 'Ten grid steps (`gridSize *= 10`).',
  },
  {
    id: 'cursorDownFast',
    label: _HKI('Cursor Down Fast'),
    keys: 'Ctrl+Down',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorDownFast',
    note: 'Ten grid steps (`gridSize *= 10`).',
  },
  {
    id: 'cursorLeftFast',
    label: _HKI('Cursor Left Fast'),
    keys: 'Ctrl+Left',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorLeftFast',
    note: 'Ten grid steps (`gridSize *= 10`).',
  },
  {
    id: 'cursorRightFast',
    label: _HKI('Cursor Right Fast'),
    keys: 'Ctrl+Right',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorRightFast',
    note: 'Ten grid steps (`gridSize *= 10`).',
  },
  {
    id: 'panUp',
    label: _HKI('Pan Up'),
    keys: 'Shift+Up',
    section: 'Cursor',
    upstream: 'ACTIONS::panUp',
  },
  {
    id: 'panDown',
    label: _HKI('Pan Down'),
    keys: 'Shift+Down',
    section: 'Cursor',
    upstream: 'ACTIONS::panDown',
  },
  {
    id: 'panLeft',
    label: _HKI('Pan Left'),
    keys: 'Shift+Left',
    section: 'Cursor',
    upstream: 'ACTIONS::panLeft',
  },
  {
    id: 'panRight',
    label: _HKI('Pan Right'),
    keys: 'Shift+Right',
    section: 'Cursor',
    upstream: 'ACTIONS::panRight',
  },

  // ----- Help ---------------------------------------------------------------
  {
    id: 'listHotkeys',
    label: _HKI('List Hotkeys...'),
    keys: 'Ctrl+F1',
    section: 'Help',
    upstream: 'ACTIONS::listHotKeys',
  },
];

/**
 * The app prefix every one of these actions is named with.
 *
 * `TOOL_ACTION::GetName()` is app-qualified - `eeschema.InteractiveDrawing.
 * drawWire` - and that name is the key for all three of the store, the settings
 * file and `ACTION_MANAGER`'s dispatch. The `id`s above are short because this
 * table was the schematic's alone; the moment a second editor's commands are
 * listed beside them, `save` is ambiguous and `eeschema.save` is not.
 *
 * This is the one place the two are joined, so the id stays readable in the
 * table and the *name* is what leaves this module. Nothing outside should key
 * anything on a bare id.
 */
export const HOTKEY_APP = 'eeschema';

/**
 * `TOOL_ACTION::GetName()` for a row of this table.
 *
 * Spelled out rather than calling `qualify` from ui/hotkey_apps.ts, which is
 * the general form: that module imports this one for the registry table, and
 * importing it back would close a cycle around the file whose whole point is
 * being data with no imports.
 */
export const actionName = (id: string): string => `${HOTKEY_APP}.${id}`;

/** The sections in the order the dialog shows them. */
export const HOTKEY_SECTIONS: readonly HotkeySection[] = [
  'File',
  'Edit',
  'View',
  'Grid',
  'Place',
  'Editing',
  'Selection',
  'Navigation',
  'Cursor',
  'Help',
];
