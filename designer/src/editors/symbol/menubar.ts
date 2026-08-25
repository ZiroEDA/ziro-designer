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
import { type SymbolConditions, symbolActionEnabled } from './conditions.js';

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
 * (`symbol_edit_frame.cpp:448-660`) that this menu bar reads.
 *
 * It used to be four booleans invented here — `haveSymbol`, `revert`,
 * `targetSymbol`, `symbolFromSchematic` — and three of the four were the wrong
 * question: `revert` was "a symbol is open" where upstream asks the library
 * manager whether the target symbol is dirty, `targetSymbol` gated File >
 * Export which upstream never gates at all, and `haveSymbol` stood in for
 * `isEditableCond`, `haveDatasheetCond` and `symbolSelectedInTreeCondition`
 * alike. It is now `SymbolConditions` — one field per upstream lambda,
 * computed by `conditions.ts` from the frame's state — and the rows below read
 * it through `symbolActionEnabled`, the same table the toolbars read, so a row
 * and its toolbar button cannot disagree.
 */
export type SymbolMenuConditions = SymbolConditions;

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
  /**
   * `ACTION_MANAGER`'s verdict for `id`, which is what greys a row.
   *
   * Every row goes through this rather than naming a condition of its own:
   * `setupUIConditions` is a table keyed by action, so ours has to be too, or
   * the row and the toolbar button for the same action drift apart — which is
   * how File > Export came to be gated on a condition upstream never gave it.
   */
  const enabled = (id: string): boolean => symbolActionEnabled(id, conds);

  /** `menu->Add( ACTION )` — label, accelerator and id all from the action. */
  const act = (label: string, id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    label,
    icon: id,
    disabled: !enabled(id),
    action: () => h.action(id),
    ...extra,
  });
  /** The same, for an action that arms a tool rather than running once. */
  const tool = (label: string, id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    label,
    icon: id,
    disabled: !enabled(id),
    action: () => h.tool(id),
    ...extra,
  });
  /**
   * `menu->Add( ACTION, ACTION_MENU::CHECK )` — a `wxITEM_CHECK` row. These
   * are the CHECK-only registrations (:541-542, :601-607); none carries an
   * ENABLE, so `enabled` is unconditionally true for them and is applied all
   * the same, so that adding one to the table lights the row up here.
   */
  const chk = (label: string, id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    label,
    icon: id,
    checked: !!checks[id],
    disabled: !enabled(id),
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
        // ENABLE( isSymbolFromSchematicCond ) (:535) — live only when this
        // frame was opened on a symbol that lives in a schematic, which now
        // does happen (the schematic hands one over). The row stays a `stub`
        // all the same: nothing here opens the LIBRARY copy of a borrowed
        // symbol yet, and a row that lights up and does nothing is worse than
        // one that stays greyed. `symbolFromSchematic` is not idle — it is
        // what makes Save All below disappear, exactly as upstream does — so
        // the condition is wired even though this row cannot use it.
        stub('Edit Library Symbol...', 'editLibSymbolWithLibEdit', {
          shortcut: 'Ctrl+Shift+E',
        }),
        SEP,
        act('Save', 'save', { shortcut: 'Ctrl+S' }),
        stub('Save As...', 'saveSymbolAs'),
        stub('Save Copy As...', 'saveSymbolCopyAs'),
        // `if( !IsSymbolFromSchematic() ) fileMenu->Add( ACTIONS::saveAll );`
        // The row DISAPPEARS; it is not greyed.
        ...(conds.symbolFromSchematic ? [] : [act('Save All', 'saveAll')]),
        // ENABLE( symbolModifiedCondition ) (:539). Not "a symbol is open":
        // upstream asks the library manager whether the TARGET symbol — the
        // tree's row when the tree is shown, else the loaded one — is dirty,
        // so a freshly opened symbol cannot be reverted.
        act('Revert', 'revert'),
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
            // `SCH_ACTIONS::exportSymbol` gets NO SetConditions anywhere in
            // this frame, so upstream's row is live even on a cold frame and
            // `SYMBOL_EDITOR_CONTROL::ExportSymbol` returns early when
            // `getTargetSymbol()` is null. Ours used to grey it.
            act('Symbol...', 'exportSymbol'),
            stub('View as PNG...', 'exportSymbolView'),
            stub('Symbol as SVG...', 'exportSymbolAsSVG'),
          ],
        },
        SEP,
        // ENABLE( symbolSelectedInTreeCondition || ( canEditProperties &&
        // haveSymbolCond ) ) (:634) — a tree selection alone is enough, which
        // is the branch `editSymbolPropertiesFromLibrary` serves.
        act('Symbol Properties...', 'symbolProperties'),
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
        // ENABLE( isEditableCond && haveSymbolCond ) (:636) — `isEditableCond`
        // excludes an alias, so Pin Table is dead on a derived symbol.
        act('Pin Table...', 'pinTable'),
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
        // actions.cpp:705 — WXK_F5, not Ctrl+R. `ACTIONS::zoomRedraw` gets no
        // SetConditions, so the row is live; it was a `stub` here while the
        // top toolbar's Redraw View button — the same action, the same id —
        // was live and working, which is the drift a table keyed by action id
        // exists to stop.
        act('Refresh', 'zoomRedraw', { shortcut: 'F5' }),
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
        // ENABLE( haveDatasheetCond ) (:633) — the Datasheet FIELD is
        // non-empty, not "a symbol is open". A symbol without a datasheet
        // greys the row rather than offering a click that says "No datasheet
        // defined".
        act('Show Datasheet', 'showDatasheet', { shortcut: 'D' }),
        SEP,
        // sch_actions.cpp:54 — FriendlyName "Symbol Checker", no ellipsis.
        //
        // And it takes NO condition. `setupUIConditions` registers one on
        // `SCH_ACTIONS::runERC` (:635), which is the *schematic's* Electrical
        // Rules Checker and reaches no row in this frame; `checkSymbol` is a
        // separate action (`sch_actions.cpp:47-59`) that the function never
        // names, so it keeps `ACTION_CONDITIONS()`'s default ShowAlways and is
        // live on a cold frame. Ours greyed it on `haveSymbol`.
        act('Symbol Checker', 'checkSymbol'),
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
