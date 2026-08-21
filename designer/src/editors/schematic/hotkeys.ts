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

import { browserSafeKey } from '../../ui/browser_reserved.js';

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
  { id: 'open', label: 'Open...', keys: 'Ctrl+O', section: 'File', upstream: 'ACTIONS::open' },
  { id: 'print', label: 'Print...', keys: 'Ctrl+P', section: 'File', upstream: 'ACTIONS::print' },
  {
    id: 'importGraphics',
    label: 'Import Graphics...',
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
    label: 'Preferences...',
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
    // The note here used to read "Ctrl+Y also redoes, which upstream does not
    // bind", which is the source read backwards: actions.cpp:292-302 binds
    // Ctrl+Shift+Z inside `#if defined( __WXMAC__ )` and Ctrl+Y in the `#else`.
    // Off macOS, Ctrl+Y IS the default and Ctrl+Shift+Z is the one upstream
    // does not bind.
    note: 'Ctrl+Shift+Z redoes too, which is upstream’s macOS default rather than this platform’s.',
  },
  { id: 'cut', label: 'Cut', keys: 'Ctrl+X', section: 'Edit', upstream: 'ACTIONS::cut' },
  { id: 'copy', label: 'Copy', keys: 'Ctrl+C', section: 'Edit', upstream: 'ACTIONS::copy' },
  {
    id: 'copyAsText',
    label: 'Copy as Text',
    keys: 'Ctrl+Shift+C',
    section: 'Edit',
    upstream: 'ACTIONS::copyAsText',
  },
  { id: 'paste', label: 'Paste', keys: 'Ctrl+V', section: 'Edit', upstream: 'ACTIONS::paste' },
  {
    id: 'pasteSpecial',
    label: 'Paste Special...',
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
    label: 'Delete',
    keys: 'Del',
    section: 'Edit',
    upstream: 'ACTIONS::doDelete',
    note: 'Backspace deletes too, as upstream binds it (ACTIONS::deleteTool takes Del only).',
  },
  {
    id: 'selectAll',
    label: 'Select All',
    keys: 'Ctrl+A',
    section: 'Edit',
    upstream: 'ACTIONS::selectAll',
  },
  {
    id: 'unselectAll',
    label: 'Unselect All',
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
    label: 'Zoom to Fit',
    keys: 'Home',
    section: 'View',
    upstream: 'ACTIONS::zoomFitScreen',
  },
  {
    id: 'zoomFitObjects',
    label: 'Zoom to All Objects',
    keys: 'Ctrl+Home',
    section: 'View',
    upstream: 'ACTIONS::zoomFitObjects',
  },
  {
    id: 'zoomFitScreenMac',
    label: 'Zoom to Fit',
    keys: 'Ctrl+0',
    section: 'View',
    upstream: 'ACTIONS::zoomFitScreen',
    note: "Upstream's macOS binding, kept on every platform so a Mac user's muscle memory works.",
  },
  { id: 'zoomIn', label: 'Zoom In', keys: 'Ctrl++', section: 'View', upstream: 'ACTIONS::zoomIn' },
  {
    id: 'zoomOut',
    label: 'Zoom Out',
    keys: 'Ctrl+-',
    section: 'View',
    upstream: 'ACTIONS::zoomOut',
  },
  {
    id: 'zoomInCenter',
    label: 'Zoom In at Cursor',
    keys: 'F1',
    section: 'View',
    /*
     * KNOWN WRONG, and deliberately left: this row cites `ACTIONS::zoomInCenter`
     * while its label and key are `ACTIONS::zoomIn`'s.
     *
     *   ACTIONS::zoomIn        FriendlyName "Zoom In at Cursor"  F1 off macOS
     *   ACTIONS::zoomInCenter  FriendlyName "Zoom In"            no hotkey
     *
     * So "Zoom In at Cursor" on F1 is `zoomIn`, and the row two below it —
     * `id: 'zoomIn'`, label "Zoom In", keys Ctrl++ — has the macOS key AND the
     * other action's name. Two actions are spread across two rows with the
     * halves crossed over.
     *
     * Re-citing this one alone is not the fix: `hotkeys_inventory` merges rows
     * by `upstream`, so it silently folds the pair into one row whose PRIMARY
     * key becomes the macOS Ctrl++. Straightening it out means deciding which
     * action F1 actually dispatches here — at the cursor or at the view centre,
     * which are different behaviours — and that is a change to the key handler,
     * not to a citation. Left whole for that change rather than half-done here.
     */
    upstream: 'ACTIONS::zoomInCenter',
  },
  {
    id: 'zoomOutCenter',
    label: 'Zoom Out at Cursor',
    keys: 'F2',
    section: 'View',
    // The same crossed pair as Zoom In above, and left for the same change:
    // "Zoom Out at Cursor" on F2 is `ACTIONS::zoomOut`, while `zoomOutCenter`
    // is FriendlyName "Zoom Out" and carries no hotkey at all.
    upstream: 'ACTIONS::zoomOutCenter',
  },
  {
    id: 'zoomRedraw',
    label: 'Refresh',
    keys: 'F5',
    section: 'View',
    upstream: 'ACTIONS::zoomRedraw',
    // Not "upstream's other default": actions.cpp:705-716 has exactly one per
    // platform, Ctrl+R on macOS and WXK_F5 everywhere else.
    note: 'Ctrl+R refreshes too, which is upstream’s macOS default rather than this platform’s.',
  },
  {
    id: 'zoomTool',
    label: 'Zoom to Selection Area',
    keys: 'Ctrl+F5',
    section: 'View',
    upstream: 'ACTIONS::zoomTool',
  },
  {
    id: 'toggleUnits',
    label: 'Switch units',
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
    label: 'Hierarchy Navigator',
    keys: 'Ctrl+H',
    section: 'View',
    upstream: 'SCH_ACTIONS::showHierarchy',
  },

  // ----- Grid ---------------------------------------------------------------
  {
    id: 'gridNext',
    label: 'Switch to Next Grid',
    keys: 'N',
    section: 'Grid',
    upstream: 'ACTIONS::gridNext',
  },
  {
    id: 'gridPrev',
    label: 'Switch to Previous Grid',
    keys: 'Shift+N',
    section: 'Grid',
    upstream: 'ACTIONS::gridPrev',
  },
  {
    id: 'gridFast1',
    label: 'Fast Grid 1',
    keys: 'Alt+1',
    section: 'Grid',
    upstream: 'ACTIONS::gridFast1',
  },
  {
    id: 'gridFast2',
    label: 'Fast Grid 2',
    keys: 'Alt+2',
    section: 'Grid',
    upstream: 'ACTIONS::gridFast2',
  },
  {
    id: 'gridFastCycle',
    label: 'Cycle Fast Grid',
    keys: 'Alt+4',
    section: 'Grid',
    upstream: 'ACTIONS::gridFastCycle',
  },
  {
    id: 'toggleGridOverrides',
    label: 'Grid Overrides',
    keys: 'Ctrl+Shift+G',
    section: 'Grid',
    upstream: 'ACTIONS::toggleGridOverrides',
  },

  // ----- Place --------------------------------------------------------------
  {
    id: 'placeSymbol',
    label: 'Place Symbols',
    keys: 'A',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeSymbol',
  },
  {
    id: 'placePower',
    label: 'Place Power Symbols',
    keys: 'P',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placePower',
  },
  {
    id: 'drawWire',
    label: 'Draw Wires',
    keys: 'W',
    section: 'Place',
    upstream: 'SCH_ACTIONS::drawWire',
  },
  {
    id: 'drawBus',
    label: 'Draw Buses',
    keys: 'B',
    section: 'Place',
    upstream: 'SCH_ACTIONS::drawBus',
  },
  {
    id: 'busEntry',
    label: 'Place Wire to Bus Entries',
    keys: 'Z',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeBusWireEntry',
  },
  {
    id: 'noConnect',
    label: 'Place/Remove No Connect Flags',
    keys: 'Q',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeNoConnect',
  },
  {
    id: 'junction',
    label: 'Place Junctions',
    keys: 'J',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeJunction',
  },
  {
    id: 'placeLabel',
    label: 'Place Net Labels',
    keys: 'L',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeLabel',
  },
  {
    id: 'placeGlobalLabel',
    label: 'Place Global Labels',
    keys: 'Ctrl+L',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeGlobalLabel',
  },
  {
    id: 'placeHierLabel',
    label: 'Place Hierarchical Labels',
    keys: 'H',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeHierLabel',
  },
  {
    id: 'drawSheet',
    label: 'Draw Hierarchical Sheets',
    keys: 'S',
    section: 'Place',
    upstream: 'SCH_ACTIONS::drawSheet',
  },
  {
    id: 'placeText',
    label: 'Draw Text',
    keys: 'T',
    section: 'Place',
    upstream: 'SCH_ACTIONS::placeSchematicText',
  },
  {
    id: 'lines',
    label: 'Draw Lines',
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
    note: 'F1 repeats too, which is upstream’s macOS default rather than this platform’s.',
  },

  // ----- Editing ------------------------------------------------------------
  {
    id: 'move',
    label: 'Move',
    keys: 'M',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::move',
  },
  {
    id: 'drag',
    label: 'Drag',
    keys: 'G',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::drag',
  },
  {
    id: 'rotateCW',
    label: 'Rotate Clockwise',
    keys: 'R',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::rotateCW',
  },
  {
    id: 'rotateCCW',
    label: 'Rotate Counterclockwise',
    keys: 'Shift+R',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::rotateCCW',
  },
  {
    id: 'mirrorV',
    label: 'Mirror Vertically',
    keys: 'X',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::mirrorV',
  },
  {
    id: 'mirrorH',
    label: 'Mirror Horizontally',
    keys: 'Y',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::mirrorH',
  },
  {
    id: 'properties',
    label: 'Properties...',
    keys: 'E',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::properties',
  },
  {
    id: 'editReference',
    label: 'Edit Reference Designator...',
    keys: 'U',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::editReference',
  },
  {
    id: 'editValue',
    label: 'Edit Value...',
    keys: 'V',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::editValue',
  },
  {
    id: 'editFootprint',
    label: 'Edit Footprint...',
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
    label: 'Swap',
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
    label: 'Cycle Arc Editing Mode',
    keys: 'Ctrl+Space',
    section: 'Editing',
    upstream: 'ACTIONS::cycleArcEditMode',
  },
  {
    id: 'lineModeCycle',
    label: 'Line Mode for Wires and Buses',
    keys: 'Shift+Space',
    section: 'Editing',
    upstream: 'SCH_ACTIONS::lineModeNext',
  },
  {
    id: 'updatePcbFromSch',
    label: 'Update PCB from Schematic...',
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
    label: 'Select/Expand Connection',
    keys: 'Ctrl+4',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::selectConnection',
  },
  {
    id: 'nextNetItem',
    label: 'Next Net Item',
    keys: 'Tab',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::nextNetItem',
  },
  {
    id: 'previousNetItem',
    label: 'Previous Net Item',
    keys: 'Shift+Tab',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::previousNetItem',
  },
  {
    id: 'highlightNet',
    label: 'Highlight Net',
    keys: '`',
    section: 'Selection',
    upstream: 'SCH_ACTIONS::highlightNet',
  },
  {
    id: 'clearHighlight',
    label: 'Clear Net Highlighting',
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
    label: 'Cancel',
    keys: 'Esc',
    section: 'Selection',
    upstream: 'ACTIONS::cancelInteractive',
  },

  // ----- Navigation ---------------------------------------------------------
  {
    id: 'navBack',
    label: 'Navigate Back',
    keys: 'Alt+Left',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::navigateBack',
  },
  {
    id: 'navUp',
    label: 'Navigate Up',
    keys: 'Alt+Up',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::navigateUp',
  },
  {
    id: 'navFwd',
    label: 'Navigate Forward',
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
    label: 'Previous Sheet',
    keys: 'PgUp',
    section: 'Navigation',
    upstream: 'SCH_ACTIONS::navigatePrevious',
  },
  {
    id: 'navNext',
    label: 'Next Sheet',
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
    label: 'Cursor Up',
    keys: 'Up',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorUp',
    note: 'Moves the crosshair, not the OS pointer, which a browser cannot warp.',
  },
  {
    id: 'cursorDown',
    label: 'Cursor Down',
    keys: 'Down',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorDown',
    note: 'Moves the crosshair, not the OS pointer, which a browser cannot warp.',
  },
  {
    id: 'cursorLeft',
    label: 'Cursor Left',
    keys: 'Left',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorLeft',
    note: 'Moves the crosshair, not the OS pointer, which a browser cannot warp.',
  },
  {
    id: 'cursorRight',
    label: 'Cursor Right',
    keys: 'Right',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorRight',
    note: 'Moves the crosshair, not the OS pointer, which a browser cannot warp.',
  },
  {
    id: 'cursorUpFast',
    label: 'Cursor Up Fast',
    keys: 'Ctrl+Up',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorUpFast',
    note: 'Ten grid steps (`gridSize *= 10`).',
  },
  {
    id: 'cursorDownFast',
    label: 'Cursor Down Fast',
    keys: 'Ctrl+Down',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorDownFast',
    note: 'Ten grid steps (`gridSize *= 10`).',
  },
  {
    id: 'cursorLeftFast',
    label: 'Cursor Left Fast',
    keys: 'Ctrl+Left',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorLeftFast',
    note: 'Ten grid steps (`gridSize *= 10`).',
  },
  {
    id: 'cursorRightFast',
    label: 'Cursor Right Fast',
    keys: 'Ctrl+Right',
    section: 'Cursor',
    upstream: 'ACTIONS::cursorRightFast',
    note: 'Ten grid steps (`gridSize *= 10`).',
  },
  { id: 'panUp', label: 'Pan Up', keys: 'Shift+Up', section: 'Cursor', upstream: 'ACTIONS::panUp' },
  {
    id: 'panDown',
    label: 'Pan Down',
    keys: 'Shift+Down',
    section: 'Cursor',
    upstream: 'ACTIONS::panDown',
  },
  {
    id: 'panLeft',
    label: 'Pan Left',
    keys: 'Shift+Left',
    section: 'Cursor',
    upstream: 'ACTIONS::panLeft',
  },
  {
    id: 'panRight',
    label: 'Pan Right',
    keys: 'Shift+Right',
    section: 'Cursor',
    upstream: 'ACTIONS::panRight',
  },

  // ----- Help ---------------------------------------------------------------
  {
    id: 'listHotkeys',
    label: 'List Hotkeys...',
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
