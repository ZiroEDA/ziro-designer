// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic editor menu bar. Counterpart: `eeschema/menubar.cpp`
 * (SCH_EDIT_FRAME::doReCreateMenuBar), transcribed exactly: same menus, same
 * item order, same separators and submenus, with labels and default hotkeys
 * taken from the action definitions (`common/tool/actions.cpp`,
 * `eeschema/tools/sch_actions.cpp`).
 *
 * Items whose feature is not implemented yet are `disabled` (shown but
 * greyed, so the surface always matches upstream). Upstream items that only
 * exist under the standalone/project-manager split (Kiface().IsSingle()) keep
 * the project-manager variant, since our editors always live in one app.
 *
 * Each enabled item routes to one of three handlers:
 *   - `tool(id)`   selects a placement/drawing tool (RIGHT_TOOLBAR ids);
 *   - `action(id)` runs a one-shot command (save/undo/zoom…);
 *   - `toggle(id)` flips a CHECK setting (View toggles).
 */

import type { Menu, MenuItem } from '@ziroeda/wx/menu.js';
import { addQuitOrClose } from '@ziroeda/common/tool/action_menu.js';
import { standardHelpMenu } from '@ziroeda/common/eda_base_frame_help_menu.js';
import { setLanguageMenuItem } from '@ziroeda/common/eda_base_frame_language_menu.js';
import { showHotkeyList } from '@ziroeda/common/hotkeys_basic.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export interface MenuHandlers {
  tool: (id: string) => void;
  action: (id: string) => void;
  toggle: (id: string) => void;
  /** `COMMON_SETTINGS.system.language`, the row Set Language ticks. */
  language: string;
  /** `EDA_BASE_FRAME::OnLanguageSelectionEvent` — pick a language. */
  onSelectLanguage: (label: string) => void;
}

/** Check state for ACTION_MENU::CHECK items, keyed by toggle id. */
export type MenuChecks = Readonly<Record<string, boolean>>;

/** KiCad's eeschema default single-key tool hotkeys (sch_actions.cpp
 *  DefaultHotkey): A, P, W, B, Z, Q, J, L, H, S, T, I. */
export const TOOL_HOTKEYS: Readonly<Record<string, string>> = {
  a: 'placeSymbol',
  p: 'placePower',
  w: 'drawWire',
  b: 'drawBus',
  z: 'busEntry',
  q: 'noConnect',
  j: 'junction',
  l: 'placeLabel',
  h: 'placeHierLabel',
  s: 'drawSheet',
  t: 'placeText',
  i: 'lines',
};

const SEP: MenuItem = { sep: true };

export function buildMenus(h: MenuHandlers, checks: MenuChecks = {}): Menu[] {
  const tool = (label: string, icon: string, id: string, shortcut?: string): MenuItem => ({
    label,
    icon,
    shortcut,
    action: () => h.tool(id),
  });
  const act = (label: string, icon: string, id: string, shortcut?: string): MenuItem => ({
    label,
    icon,
    shortcut,
    action: () => h.action(id),
  });
  const chk = (label: string, id: string, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    checked: !!checks[id],
    action: () => h.toggle(id),
  });
  /**
   * An action that also shows a check mark, for a tool that keeps running.
   * Upstream's `SetConditions( …, CHECK( cond.CurrentTool( … ) ) )` drives the
   * menu item and the toolbar button from the one condition, so the tick and
   * the highlight cannot disagree.
   */
  const actChecked = (label: string, icon: string, id: string, shortcut?: string): MenuItem => ({
    label,
    icon,
    shortcut,
    checked: !!checks[id],
    action: () => h.action(id),
  });
  /** Not implemented yet, greyed out, exactly where upstream puts it. */
  /** An action with no icon of its own (upstream's Inspect entries have none). */
  const actNoIcon = (label: string, id: string, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    action: () => h.action(id),
  });
  const stub = (label: string, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    disabled: true,
  });
  const stubChk = (label: string, shortcut?: string): MenuItem => ({
    label,
    shortcut,
    disabled: true,
  });

  return [
    // File: the project-manager variant (Kiface().IsSingle() == false), New/
    // Open/Open Recent belong to the launcher, and the menu starts at Save.
    {
      label: _('File'),
      items: [
        act('Save', 'save', 'save', 'Ctrl+S'),
        // SCH_ACTIONS::saveCurrSheetCopyAs (sch_actions.cpp:1620-1625):
        // FriendlyName "Save Current Sheet Copy As...", BITMAPS::save_as, and
        // no default hotkey.
        act(_('Save Current Sheet Copy As...'), 'saveAs', 'saveCurrSheetCopyAs'),
        // ACTIONS::revert (common/tool/actions.cpp:120-126): FriendlyName
        // "Revert", tooltip "Throw away changes", BITMAPS::restore_from_file,
        // and no default hotkey - a destructive command upstream gives no key.
        act(_('Revert'), 'revert', 'revert'),
        SEP,
        {
          label: _('Import'),
          items: [
            stub(_('Non-KiCad Schematic...')),
            stub(_('Footprint Assignments...')),
            actNoIcon(_('Graphics...'), 'importGraphics', 'Ctrl+Shift+F'),
          ],
        },
        {
          label: _('Export'),
          items: [
            stub(_('Drawing to Clipboard')),
            act(_('Netlist...'), 'netlist', 'exportNetlist'),
            stub(_('Symbols...')),
          ],
        },
        SEP,
        act(_('Schematic Setup...'), 'setup', 'schematicSetup'),
        SEP,
        act(_('Page Settings...'), 'page', 'pageSettings'),
        act(_('Print...'), 'print', 'print', 'Ctrl+P'),
        act(_('Plot...'), 'plot', 'plot'),
        SEP,
        // AddQuitOrClose: under the project manager the frame closes back to it.
        { ...addQuitOrClose(_('Schematic Editor'), () => h.action('close')), icon: 'close' },
      ],
    },
    {
      label: _('Edit'),
      items: [
        act('Undo', 'undo', 'undo', 'Ctrl+Z'),
        // ACTIONS::redo (common/tool/actions.cpp:292-302) is Ctrl+Shift+Z only
        // inside `#if defined( __WXMAC__ )`; the `#else` branch — ours — is
        // Ctrl+Y. Both keys are bound here and always were; it was the printed
        // one that came from the wrong branch.
        act('Redo', 'redo', 'redo', 'Ctrl+Y'),
        SEP,
        act('Cut', 'cut', 'cut', 'Ctrl+X'),
        act('Copy', 'copy', 'copy', 'Ctrl+C'),
        act(_('Copy as Text'), 'copy', 'copyAsText', 'Ctrl+Shift+C'),
        act('Paste', 'paste', 'paste', 'Ctrl+V'),
        act(_('Paste Special...'), 'paste', 'pasteSpecial', 'Ctrl+Shift+V'),
        act(_('Delete'), 'delete', 'delete', _('Delete')),
        SEP,
        act(_('Select All'), 'selectAll', 'selectAll', 'Ctrl+A'),
        act(_('Unselect All'), 'unselectAll', 'unselectAll', 'Ctrl+Shift+A'),
        SEP,
        act('Find', 'find', 'find', 'Ctrl+F'),
        act('Find and Replace', 'replace', 'findReplace', 'Ctrl+Alt+F'),
        SEP,
        tool(_('Interactive Delete Tool'), 'delete', 'delete'),
        act(_('Edit Text & Graphics Properties...'), 'properties', 'globalEditTextAndGraphics'),
        act(_('Change Symbols...'), 'properties', 'changeSymbols'),
        act(_('Edit Sheet Page Number...'), 'editPageNumber', 'editPageNumber'),
        {
          label: _('Attributes'),
          items: [
            chk('Exclude from Simulation', 'attrSim'),
            chk(_('Exclude from Bill of Materials'), 'attrBom'),
            chk('Exclude from Board', 'attrBoard'),
            chk('Exclude from Position Files', 'attrPosFiles'),
            chk(_HKI('Do not Populate'), 'attrDnp'),
          ],
        },
      ],
    },
    {
      label: _('View'),
      items: [
        {
          label: _('Panels'),
          items: [
            chk(_('Properties'), 'showProperties'),
            chk('Search', 'showSearch', 'Ctrl+G'),
            chk(_('Hierarchy Navigator'), 'showHierarchy', 'Ctrl+H'),
            // Upstream gates this on the m_IncrementalConnectivity advanced
            // config, which is off by default — so its absence here was not
            // drift. We always have connectivity, so it is always offered.
            chk(_('Net Navigator'), 'showNetNavigator'),
            // SCH_ACTIONS::showDesignBlockPanel (menubar.cpp:187): the Design Blocks dock.
            chk(_('Design Blocks'), 'showDesignBlocks'),
            stubChk(_('Remote Symbols')),
          ],
        },
        SEP,
        act(_('Symbol Library Browser'), 'symbolBrowser', 'symbolBrowser'),
        SEP,
        act('Zoom In', 'zoomIn', 'zoomIn'),
        act('Zoom Out', 'zoomOut', 'zoomOut'),
        act(_('Zoom to Fit'), 'zoomFit', 'zoomFit', 'Home'),
        act(_('Zoom to All Objects'), 'zoomFitObjects', 'zoomFitObjects', 'Ctrl+Home'),
        act(_('Zoom to Selected Objects'), 'zoomFitSelection', 'zoomFitSelection'),
        actChecked(_('Zoom to Selection Area'), 'zoomTool', 'zoomTool', 'Ctrl+F5'),
        // ACTIONS::zoomRedraw (actions.cpp:705-716), same split: Ctrl+R is the
        // macOS branch, WXK_F5 is ours. F5 has been the working key all along.
        act(_('Refresh'), 'zoomRedraw', 'zoomRedraw', 'F5'),
        SEP,
        act(_('Navigate Back'), 'navBack', 'navBack', 'Alt+Left'),
        act(_('Navigate Up'), 'navUp', 'navUp', 'Alt+Up'),
        act(_('Navigate Forward'), 'navFwd', 'navFwd', 'Alt+Right'),
        act(_('Previous Sheet'), 'navPrev', 'navPrev', 'Page Up'),
        act(_('Next Sheet'), 'navNext', 'navNext', 'Page Down'),
        SEP,
        chk(_('Show Hidden Pins'), 'toggleHiddenPins'),
        chk(_('Show Hidden Fields'), 'toggleHiddenFields'),
        stubChk(_('Show Directive Labels')),
        stubChk(_('Show ERC Errors')),
        stubChk(_('Show ERC Warnings')),
        stubChk(_('Show ERC Exclusions')),
        stubChk(_('Mark items excluded from simulation')),
        stubChk(_('Show OP Voltages')),
        stubChk(_('Show OP Currents')),
        stubChk(_('Show Pin Alternate Icons')),
      ],
    },
    {
      label: _('Place'),
      items: [
        tool(_('Place Symbols'), 'symbol', 'placeSymbol', 'A'),
        tool(_('Place Power Symbols'), 'power', 'placePower', 'P'),
        tool(_('Draw Wires'), 'wire', 'drawWire', 'W'),
        tool(_('Draw Buses'), 'bus', 'drawBus', 'B'),
        tool(_('Place Wire to Bus Entries'), 'busEntry', 'busEntry', 'Z'),
        tool(_('Place No Connect Flags'), 'noConnect', 'noConnect', 'Q'),
        tool(_('Place Junctions'), 'junction', 'junction', 'J'),
        tool(_('Place Net Labels'), 'labelLocal', 'placeLabel', 'L'),
        tool(_('Place Global Labels'), 'labelGlobal', 'placeGlobalLabel', 'Ctrl+L'),
        tool(_('Place Directive Labels'), 'labelClass', 'placeClassLabel'),
        tool(_('Draw Rule Areas'), 'ruleArea', 'drawRuleArea'),
        SEP,
        tool(_('Place Hierarchical Labels'), 'labelHier', 'placeHierLabel', 'H'),
        tool(_('Draw Hierarchical Sheets'), 'sheet', 'drawSheet', 'S'),
        tool(_('Place Pins from Sheet'), 'sheetPin', 'sheetPin'),
        actNoIcon(_('Sync All Sheet Pins...'), 'syncAllSheetPins'),
        actNoIcon(_('Import Sheet...'), 'importSheet'),
        SEP,
        tool(_('Draw Text'), 'text', 'placeText', 'T'),
        tool(_('Draw Text Boxes'), 'textBox', 'textBox'),
        tool(_('Draw Tables'), 'table', 'table'),
        tool(_('Draw Rectangles'), 'rectangle', 'rectangle'),
        tool(_('Draw Circles'), 'circle', 'circle'),
        tool(_('Draw Arcs'), 'arc', 'arc'),
        tool(_('Draw Bezier Curve'), 'bezier', 'bezier'),
        tool(_('Draw Lines'), 'lines', 'lines', 'I'),
        tool(_('Place Images'), 'image', 'image'),
      ],
    },
    {
      label: _('Inspect'),
      items: [
        stub(_('Show Bus Syntax Help')),
        SEP,
        act(_('Electrical Rules Checker'), 'erc', 'erc'),
        // SCH_INSPECTION_TOOL::PrevMarker / NextMarker / ExcludeMarker all
        // raise the ERC dialog and act on it, since it owns the marker tree.
        actNoIcon(_('Previous Marker'), 'ercPrevMarker'),
        actNoIcon(_('Next Marker'), 'ercNextMarker'),
        actNoIcon(_('Exclude Marker'), 'ercExcludeMarker'),
        SEP,
        stub(_('Compare Symbol with Library')),
        SEP,
        stub(_('Simulator')),
      ],
    },
    {
      label: _('Tools'),
      items: [
        act(_('Update PCB from Schematic...'), 'updatePcbFromSch', 'updatePcbFromSch', 'F8'),
        act(_('Switch to PCB Editor'), 'pcb', 'showPcbNew'),
        // `ACTIONS::showProjectManager`, which upstream adds here when running
        // under the project manager (`!Kiface().IsSingle()`, menubar.cpp:310) —
        // our situation, since the launcher is always there.
        //
        // Single-window delta: KiCad *raises* the manager and leaves the editor
        // open behind it. There is one page here, so this goes back to it the
        // same way File > Close does, guard and all.
        // `ACTIONS::showProjectManager`'s FriendlyName is the whole label
        // (actions.cpp:1258): "Switch to Project Manager", not "Project Manager".
        actNoIcon(_('Switch to Project Manager'), 'showProjectManager'),
        act(_('Calculator Tools'), 'calculator', 'showCalculator'),
        SEP,
        act(_('Symbol Editor'), 'symbolEditor', 'symbolEditor'),
        act(_('Update Symbols from Library...'), 'properties', 'updateSymbolsFromLibrary'),
        SEP,
        act(_('Rescue Symbols...'), 'rescue', 'rescueSymbols'),
        stub(_('Remap Legacy Library Symbols...')),
        SEP,
        act(_('Bulk Edit Symbol Fields...'), 'fields', 'editSymbolFields'),
        act(_('Bulk Edit Symbol Library Links...'), 'properties', 'editSymbolLibraryLinks'),
        SEP,
        act(_('Annotate Schematic...'), 'annotate', 'annotate'),
        act(_('Increment Annotations From...'), 'annotate', 'incrementAnnotations'),
        SEP,
        act(_('Assign Footprints...'), 'assignFp', 'assignFootprints'),
        act(_('Generate Bill of Materials...'), 'bom', 'bom'),
        stub(_('Generate Legacy Bill of Materials...')),
        SEP,
        actNoIcon(_('Update Schematic from PCB...'), 'updateSchFromPcb'),
        SEP,
        {
          label: _('Variants'),
          items: [
            // menubar.cpp:328-330 — exactly these three actions
            // (sch_actions.cpp:1778, 1784, 1790). Rename and Copy are real, but
            // they are BUTTONS in DIALOG_SYMBOL_FIELDS_TABLE
            // (dialog_symbol_fields_table.cpp:214-215, onRenameVariant :2859,
            // onCopyVariant :2933), never TOOL_ACTIONs and never on this menu.
            stub(_('Add Design Variant...')),
            stub(_('Remove Design Variant...')),
            stub(_('Edit Variant Description...')),
          ],
        },
      ],
    },
    {
      label: _('Preferences'),
      items: [
        /* No "Configure Paths...". `DIALOG_CONFIGURE_PATHS` edits the
           environment substitutions a library path is written against --
           `KICAD10_SYMBOL_DIR`, `KICAD10_FOOTPRINT_DIR`, `KIPRJMOD` -- so that
           a `.kicad_sym` on one machine's disk is found on another's. There is
           no disk here and no second machine: a library is a URL or a file in
           the project, and the tables below name it directly.

           Removed rather than greyed, like every other control this application
           cannot have. Greying says "not ready yet"; this one is not a promise
           the app can keep. */
        actNoIcon(_('Manage Symbol Libraries...'), 'manageSymbolLibraries'),
        stub(_('Manage Design Block Libraries...')),
        act(_('Preferences...'), 'preferences', 'openPreferences', 'Ctrl+,'),
        // menubar.cpp:347-348 — `prefsMenu->AppendSeparator()` then
        // `AddMenuLanguageList( prefsMenu, selTool )`. The submenu is titled
        // "Set Language" and every row is a wxITEM_CHECK
        // (eda_base_frame.cpp:2062-2087). Five other launchers here already
        // call the shared `setLanguageMenuItem`; the schematic was the one
        // that did not, so its Preferences menu simply ended early.
        SEP,
        setLanguageMenuItem({ current: h.language, onSelect: h.onSelectLanguage }),
      ],
    },
    // EDA_BASE_FRAME::AddStandardHelpMenu, the same seven entries every KiCad
    // frame appends last. This one had drifted to three of its own, with About
    // disabled.
    standardHelpMenu({
      showHotkeys: showHotkeyList,
      showAbout: () => h.action('about'),
    }),
  ];
}
