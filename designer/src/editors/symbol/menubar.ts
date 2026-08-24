// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME::doReCreateMenuBar`
 * (`eeschema/symbol_editor/menubar_symbol_editor.cpp:36-194`), transcribed.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * It used to be a `useMemo` inside `SymbolEditor.tsx`, and that is not a style
 * question. **`qa`'s tsconfig compiles `.ts` only**, so a menu built inside a
 * `.tsx` cannot be imported by a test — no test in the suite could name a row,
 * count one, or notice one missing. That is the whole reason the bar had drifted
 * this far: 34 of upstream's rows were absent from it, one was invented, and
 * both of its submenus had been flattened.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE STRINGS COME FROM
 * ---------------------------------------------------------------------------
 *
 * Every label below is a `TOOL_ACTION::FriendlyName` and every accelerator a
 * `DefaultHotkey`, read out of `common/tool/actions.cpp` and
 * `eeschema/tools/sch_actions.cpp`. None is written here twice and none is
 * paraphrased — "Draw Pins", not "Pin"; "Symbol Checker", not "Symbol
 * Checker..."; `SCH_ACTIONS::placeSymbolText` declares **no** hotkey, so the
 * Text row has none.
 *
 * Several actions are `#if defined( __WXMAC__ )`-gated and the FIRST
 * `.DefaultHotkey()` in the source is the Mac one. This is the Linux build:
 * `redo` is Ctrl+Y (`actions.cpp:292`), `doDelete` is Delete (`:399`),
 * `zoomFitScreen` is Home (`:717`), `zoomRedraw` is F5 (`:705`).
 *
 * Rows whose feature does not exist yet are shown **greyed in their upstream
 * position**, so the surface matches KiCad even where the behaviour does not.
 * A greyed row does not dispatch its accelerator (`ui/menu_hotkeys.ts`), which
 * is `ACTION_CONDITIONS`' rule too, so printing the key costs nothing.
 *
 * ---------------------------------------------------------------------------
 * THE THREE HANDLERS
 * ---------------------------------------------------------------------------
 *
 * Same shape as `editors/schematic/menubar.ts`, because it is the same idea:
 *
 *   - `tool(id)`   arms a placement/drawing tool (the RIGHT_TOOLBAR ids);
 *   - `action(id)` runs a one-shot command (save / undo / zoom …);
 *   - `toggle(id)` flips a CHECK setting.
 *
 * An id here is the id the **toolbar** already uses for the same command
 * (`symbolToolbars.ts`), not a second name for it: `ui/hotkeys_inventory.ts`
 * keys on that id the way `HOTKEY_STORE` keys on `TOOL_ACTION::GetName()`, so
 * an action reachable from both the bar and the menu must carry one id or the
 * Hotkey List shows it twice. `MenuItem.icon` is that key, which is why every
 * row's `icon` below IS its action id rather than a picture name.
 */

import type { Menu, MenuItem } from '../../ui/menu_types.js';
import { addClose } from '../../ui/action_menu.js';
import { browserSafeKey } from '../../ui/browser_reserved.js';
import { standardHelpMenu } from '../../ui/help_menu.js';
import { setLanguageMenuItem } from '../../ui/language_menu.js';

const SEP: MenuItem = { sep: true };

export interface SymbolMenuHandlers {
  /** A one-shot command. */
  action: (id: string) => void;
  /** Arm a placement/drawing tool. */
  tool: (id: string) => void;
  /** Flip a CHECK setting. */
  toggle: (id: string) => void;
  /** `COMMON_SETTINGS.system.language`, the row Set Language ticks. */
  language: string;
  /** `EDA_BASE_FRAME::OnLanguageSelectionEvent`. */
  onSelectLanguage: (label: string) => void;
  /** `ACTIONS::listHotKeys`, through the shared Help menu. */
  showHotkeys: () => void;
  /** `ACTIONS::about`, through the shared Help menu. */
  showAbout: () => void;
}

/** `ACTION_MENU::CHECK` state, keyed by toggle id. */
export type SymbolMenuChecks = Readonly<Record<string, boolean>>;

/**
 * The `ENABLE( … )` conditions of `SYMBOL_EDIT_FRAME::setupUIConditions`
 * (`symbol_edit_frame.cpp:448-562`) that this menu bar reads. The names are
 * upstream's lambda names; the frame evaluates them.
 */
export interface SymbolMenuConditions {
  /** `haveSymbolCond` — a symbol is loaded (`m_symbol`). */
  haveSymbol: boolean;
  /** `symbolModifiedCondition` — ENABLE for `ACTIONS::revert`. */
  revert: boolean;
  /** `saveSymbolAsCondition` / `symbolSelectedInTreeCondition`. */
  targetSymbol: boolean;
  /**
   * `IsSymbolFromSchematic()`.
   *
   * Two rows turn on it and they turn opposite ways: File > Save All is only
   * *added* when it is false (`menubar_symbol_editor.cpp:59-60` — the row is
   * absent, not greyed), and Edit Library Symbol is ENABLEd only when it is
   * true (`symbol_edit_frame.cpp:534`). Always false here so far: nothing can
   * open this frame on a schematic's own symbol yet.
   */
  symbolFromSchematic: boolean;
}

/**
 * The whole bar, in `menuBar->Append` order
 * (`menubar_symbol_editor.cpp:184-190`): File, Edit, View, Place, Inspect,
 * Preferences, then `AddStandardHelpMenu`.
 */
export function symbolEditorMenus(
  h: SymbolMenuHandlers,
  checks: SymbolMenuChecks,
  conds: SymbolMenuConditions,
): Menu[] {
  /** `menu->Add( ACTION )` — label, accelerator and id all from the action. */
  const act = (label: string, id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    label,
    icon: id,
    action: () => h.action(id),
    ...extra,
  });
  /** The same, for an action that arms a tool rather than running once. */
  const tool = (label: string, id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    label,
    icon: id,
    action: () => h.tool(id),
    ...extra,
  });
  /** `menu->Add( ACTION, ACTION_MENU::CHECK )` — a `wxITEM_CHECK` row. */
  const chk = (label: string, id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    label,
    icon: id,
    checked: !!checks[id],
    action: () => h.toggle(id),
    ...extra,
  });
  /**
   * A row whose feature does not exist here yet: greyed, in place, keeping the
   * action's own label and accelerator so the surface still matches upstream.
   */
  const stub = (label: string, id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    label,
    icon: id,
    disabled: true,
    ...extra,
  });

  return [
    {
      label: 'File',
      items: [
        act('New Library...', 'newLibrary'),
        act('Add Library...', 'addLibrary'),
        // SCH_ACTIONS::saveLibraryAs (sch_actions.cpp:178), Ctrl+Shift+S.
        stub('Save Library As...', 'saveLibraryAs', { shortcut: 'Ctrl+Shift+S' }),
        act('New Symbol...', 'newSymbol', { shortcut: browserSafeKey('Ctrl+N') }),
        // ENABLE( isSymbolFromSchematicCond ) — greyed unless this frame was
        // opened on a symbol that lives in a schematic, which is never yet.
        act('Edit Library Symbol...', 'editLibSymbolWithLibEdit', {
          shortcut: 'Ctrl+Shift+E',
          disabled: !conds.symbolFromSchematic,
        }),
        SEP,
        act('Save', 'save', { shortcut: 'Ctrl+S' }),
        stub('Save As...', 'saveSymbolAs'),
        stub('Save Copy As...', 'saveSymbolCopyAs'),
        // `if( !IsSymbolFromSchematic() ) fileMenu->Add( ACTIONS::saveAll );`
        // The row DISAPPEARS; it is not greyed.
        ...(conds.symbolFromSchematic ? [] : [act('Save All', 'saveAll')]),
        act('Revert', 'revert', { disabled: !conds.revert }),
        SEP,
        // `submenuImport->Add( action, ACTION_MENU::NORMAL, _( "Symbol..." ) )`
        // — the third argument REPLACES the FriendlyName, so these rows read
        // "Symbol..." and "Graphics...", not "Import Symbol...".
        {
          label: 'Import',
          submenu: [
            act('Symbol...', 'importSymbol'),
            stub('Graphics...', 'importGraphics', { shortcut: 'Ctrl+Shift+F' }),
          ],
        },
        {
          label: 'Export',
          submenu: [
            act('Symbol...', 'exportSymbol', { disabled: !conds.targetSymbol }),
            stub('View as PNG...', 'exportSymbolView'),
            stub('Symbol as SVG...', 'exportSymbolAsSVG'),
          ],
        },
        SEP,
        act('Symbol Properties...', 'symbolProperties', { disabled: !conds.haveSymbol }),
        SEP,
        addClose('Library Editor', () => h.action('close')),
      ],
    },
    {
      label: 'Edit',
      items: [
        act('Undo', 'undo', { shortcut: 'Ctrl+Z' }),
        // actions.cpp:292 — Ctrl+Shift+Z is the `#if __WXMAC__` branch; the
        // `#else` this build takes is Ctrl+Y.
        act('Redo', 'redo', { shortcut: 'Ctrl+Y' }),
        SEP,
        stub('Cut', 'cut', { shortcut: 'Ctrl+X' }),
        stub('Copy', 'copy', { shortcut: 'Ctrl+C' }),
        stub('Copy as Text', 'copyAsText', { shortcut: 'Ctrl+Shift+C' }),
        stub('Paste', 'paste', { shortcut: 'Ctrl+V' }),
        // actions.cpp:399 — WXK_BACK is the Mac branch, WXK_DELETE is ours.
        act('Delete', 'doDelete', { shortcut: 'Delete' }),
        stub('Duplicate', 'duplicate', { shortcut: 'Ctrl+D' }),
        SEP,
        stub('Select All', 'selectAll', { shortcut: 'Ctrl+A' }),
        stub('Unselect All', 'unselectAll', { shortcut: 'Ctrl+Shift+A' }),
        SEP,
        stub('Find', 'find', { shortcut: 'Ctrl+F' }),
        stub('Find and Replace', 'findAndReplace', { shortcut: 'Ctrl+Alt+F' }),
        SEP,
        act('Pin Table...', 'pinTable', { disabled: !conds.haveSymbol }),
        stub('Update Symbol Fields...', 'updateSymbolFields'),
      ],
    },
    {
      label: 'View',
      items: [
        // `showHidePanels->SetTitle( _( "Panels" ) )` (:123-127). Ours had the
        // two rows loose at the bottom of View, under invented names.
        {
          label: 'Panels',
          submenu: [chk('Properties', 'showProperties'), chk('Library Tree', 'showLibraryTree')],
        },
        SEP,
        stub('Symbol Library Browser', 'showSymbolBrowser'),
        SEP,
        act('Zoom In', 'zoomInCenter'),
        act('Zoom Out', 'zoomOutCenter'),
        // actions.cpp:717 — WXK_HOME. (Ctrl+0 is nowhere in this action.)
        act('Zoom to Fit', 'zoomFitScreen', { shortcut: 'Home' }),
        stub('Zoom to Selection Area', 'zoomTool', { shortcut: 'Ctrl+F5' }),
        // actions.cpp:705 — WXK_F5, not Ctrl+R.
        stub('Refresh', 'zoomRedraw', { shortcut: 'F5' }),
        SEP,
        chk('Show Hidden Pins', 'showHiddenPins'),
        chk('Show Hidden Fields', 'showHiddenFields'),
        // SCH_ACTIONS::togglePinAltIcons (sch_actions.cpp:1334). Greyed rather
        // than wired: `SymbolViewOptions` has no such flag, so the tick would
        // be a setting nothing reads. Upstream has it commented out of the
        // toolbar too (`toolbars_symbol_editor.cpp:85`), so there is no button
        // here for a live row to stay consistent with.
        stub('Show Pin Alternate Icons', 'togglePinAltIcons'),
        //
        // NOT here: "Show Pin Electrical Types". SCH_ACTIONS::showElectricalTypes
        // is a left-toolbar TOGGLE (`toolbars_symbol_editor.cpp:82`) and appears
        // in no menu upstream. Ours had invented a View row for it.
      ],
    },
    {
      label: 'Place',
      items: [
        // sch_actions.cpp:376-426 and :682-709. The FriendlyNames are plural
        // imperatives - "Draw Pins", not "Pin" - and only placeSymbolPin
        // carries a DefaultHotkey ('P', :379). The T our Text row printed was
        // invented; `placeSymbolText` declares none.
        tool('Draw Pins', 'placePin', { shortcut: 'P' }),
        tool('Draw Text', 'placeText'),
        stub('Draw Text Boxes', 'drawSymbolTextBox'),
        tool('Draw Rectangles', 'drawRectangle'),
        tool('Draw Circles', 'drawCircle'),
        tool('Draw Arcs', 'drawArc'),
        stub('Draw Bezier Curve', 'bezier'),
        tool('Draw Lines', 'drawSymbolLines'),
        tool('Draw Polygons', 'drawPolygon'),
      ],
    },
    {
      label: 'Inspect',
      items: [
        // actions.cpp:1325 — DefaultHotkey 'D'.
        act('Show Datasheet', 'showDatasheet', {
          shortcut: 'D',
          disabled: !conds.haveSymbol,
        }),
        SEP,
        // sch_actions.cpp:54 — FriendlyName "Symbol Checker", no ellipsis.
        act('Symbol Checker', 'checkSymbol', { disabled: !conds.haveSymbol }),
      ],
    },
    {
      // :172-179. The same three lines fifteen KiCad frames end with, then
      // AddMenuLanguageList. Ours was a single greyed "Preferences...".
      label: 'Preferences',
      items: [
        stub('Configure Paths...', 'configurePaths'),
        stub('Manage Symbol Libraries...', 'showSymbolLibTable'),
        act('Preferences...', 'openPreferences', { shortcut: 'Ctrl+,' }),
        SEP,
        setLanguageMenuItem({ current: h.language, onSelect: h.onSelectLanguage }),
      ],
    },
    standardHelpMenu({ showHotkeys: h.showHotkeys, showAbout: h.showAbout }),
  ];
}
