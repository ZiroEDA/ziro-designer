// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME::doReCreateMenuBar`
 * (`pcbnew/menubar_footprint_editor.cpp:38-258`), transcribed.
 *
 * Split out of `FootprintEditor.tsx` because **`qa`'s tsconfig compiles `.ts`
 * only**: a menu built inside a `.tsx` is unreachable from the test suite by
 * construction, so nothing could have noticed that 28 of upstream's rows were
 * missing from this bar, that six were invented, or that four submenus had been
 * flattened away. Place was the worst of it — 9 rows against 22, every label
 * paraphrased, and not one of its nine accelerators.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE STRINGS COME FROM
 * ---------------------------------------------------------------------------
 *
 * Every label is a `TOOL_ACTION::FriendlyName` and every accelerator a
 * `DefaultHotkey`, out of `common/tool/actions.cpp` and
 * `pcbnew/tools/pcb_actions.cpp`. "Add Pad", not "Pad"; "Place the Footprint
 * Anchor", not "Set Anchor"; "New Footprint" carries no ellipsis and
 * "Footprint Checker" carries none either.
 *
 * Several actions are `#if defined( __WXMAC__ )`-gated and the FIRST
 * `.DefaultHotkey()` in the source is the Mac one. This is the Linux build:
 * `redo` is Ctrl+Y, `doDelete` is Delete, `zoomFitScreen` is Home, `zoomRedraw`
 * is F5.
 *
 * Rows whose feature does not exist here yet are greyed **in their upstream
 * position**. A greyed row does not dispatch its accelerator
 * (`ui/menu_hotkeys.ts`), which is `ACTION_CONDITIONS`' rule too.
 *
 * The three handlers are the schematic module's: `tool(id)` arms a
 * placement/drawing tool, `action(id)` runs a one-shot command, `toggle(id)`
 * flips a CHECK setting. An id is the one `footprintToolbars.ts` already uses
 * for the same command, and `MenuItem.icon` carries it, because
 * `ui/hotkeys_inventory.ts` keys the Hotkey List on that field the way
 * `HOTKEY_STORE` keys on `TOOL_ACTION::GetName()` — two spellings list one
 * action twice.
 */

import type { Menu, MenuItem } from '../../ui/menu_types.js';
import { addClose } from '../../ui/action_menu.js';
import { browserSafeKey } from '../../ui/browser_reserved.js';
import { standardHelpMenu } from '../../ui/help_menu.js';
import { setLanguageMenuItem } from '../../ui/language_menu.js';

const SEP: MenuItem = { sep: true };

export interface FootprintMenuHandlers {
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
export type FootprintMenuChecks = Readonly<Record<string, boolean>>;

/**
 * The `ENABLE( … )` conditions of `FOOTPRINT_EDIT_FRAME::setupUIConditions`
 * (`pcbnew/footprint_edit_frame.cpp:1400-1470`) that this menu bar reads. The
 * frame evaluates them; the names are upstream's.
 */
export interface FootprintMenuConditions {
  /** `haveFootprintCond` (:1291-1295) — `GetBoard()->GetFirstFootprint() != nullptr`. */
  haveFootprint: boolean;
  /** A library is selected to create the new footprint in. See `New Footprint`. */
  targetLib: boolean;
  /** `footprintTargettedCond` (:1297-1301) — `!GetTargetFPID().GetLibItemName().empty()`. */
  targetFootprint: boolean;
  /**
   * `footprintSelectedInTreeCond` (:1303-1308) — the tree's selected LIB_ID
   * names both a nickname and an item.
   */
  footprintSelectedInTree: boolean;
  /**
   * `cond.ContentModified()` — `FOOTPRINT_EDIT_FRAME::IsContentModified()`
   * (`footprint_edit_frame.cpp:368-372`), which is the **loaded footprint's**
   * dirty bit and not "anything unsaved anywhere".
   */
  contentModified: boolean;
  /**
   * `cond.HasItems()` — `PCB_EDITOR_CONDITIONS::hasItemsFunc`
   * (`pcb_editor_conditions.cpp:140-145`): `board && !board->IsEmpty()`. Note
   * what it is NOT: a *selection* condition. Upstream's Delete row is live
   * whenever the board holds anything at all.
   */
  hasItems: boolean;
  /** `cond.UndoAvailable()` — `GetUndoCommandCount() > 0`. */
  undoAvailable: boolean;
  /** `cond.RedoAvailable()` — `GetRedoCommandCount() > 0`. */
  redoAvailable: boolean;
}

/**
 * The whole bar, in `menuBar->Append` order
 * (`menubar_footprint_editor.cpp:247-254`): File, Edit, View, Place, Inspect,
 * Tools, Preferences, then `AddStandardHelpMenu`.
 */
export function footprintEditorMenus(
  h: FootprintMenuHandlers,
  checks: FootprintMenuChecks,
  conds: FootprintMenuConditions,
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
        // pcb_actions.cpp:868 — FriendlyName "New Footprint", no ellipsis.
        //
        // Upstream sets NO condition on this action, so the menu row is always
        // live: `NewFootprint` (`footprint_editor_control.cpp:212-244`) creates
        // the footprint on the canvas either way and only
        // `tryToSaveFootprintInLibrary` (:174-208) checks the target, doing
        // nothing when the nickname is empty. We cannot hold a library-less
        // footprint — every buffer here is keyed by library — so the row is
        // greyed rather than made to do nothing. Deliberate deviation.
        act('New Footprint', 'newFootprint', {
          shortcut: browserSafeKey('Ctrl+N'),
          disabled: !conds.targetLib,
        }),
        stub('Create Footprint...', 'createFootprint'),
        stub('Edit Library Footprint...', 'editLibFpInFpEditor', { shortcut: 'Ctrl+Shift+E' }),
        SEP,
        // `ENABLE( SELECTION_CONDITIONS::ShowAlways )` (:1353). Save is live
        // even with nothing modified and nothing loaded — this frame's Save
        // reaches the *library*, not only the open footprint, so upstream never
        // gates it. Ours greyed it on "anything unsaved anywhere".
        act('Save', 'save', { shortcut: 'Ctrl+S' }),
        stub('Save As...', 'saveAs', { shortcut: 'Ctrl+Shift+S' }),
        // `ENABLE( cond.ContentModified() )` (:1352).
        act('Revert', 'revert', { disabled: !conds.contentModified }),
        //
        // NOT here: "Save All". `ACTIONS::saveAll` appears nowhere in
        // `menubar_footprint_editor.cpp` — the footprint editor has no such
        // row. Ours had invented one.
        SEP,
        // `submenuImport->Add( action, ACTION_MENU::NORMAL, _( "Footprint..." ) )`
        // — the third argument REPLACES the FriendlyName, so the row reads
        // "Footprint...", not "Import Footprint...".
        {
          label: 'Import',
          submenu: [
            act('Footprint...', 'importFootprint'),
            stub('Graphics...', 'placeImportedGraphics', { shortcut: 'Ctrl+Shift+F' }),
          ],
        },
        {
          label: 'Export',
          submenu: [
            // `ENABLE( haveFootprintCond )` (:1428) — the loaded footprint, not
            // the tree's target FPID, which is what ours used to read.
            act('Footprint...', 'exportFootprint', { disabled: !conds.haveFootprint }),
            // :78-81 — not an action at all but a raw
            // `Add( label, help, ID_FPEDIT_SAVE_PNG, BITMAPS::export_png )`,
            // so the help string is upstream's own and the `&` marks P.
            {
              label: 'View as PNG...',
              mnemonic: 'P',
              tooltip: 'Create a PNG file from the current view',
              disabled: true,
            },
          ],
        },
        SEP,
        // `ENABLE( footprintSelectedInTreeCond || haveFootprintCond )` (:1431).
        // A tree row on its own opens it — `editFootprintPropertiesFromLibrary`
        // (`footprint_editor_control.cpp:794`) is the branch for that.
        act('Footprint Properties...', 'footprintProperties', {
          disabled: !(conds.footprintSelectedInTree || conds.haveFootprint),
        }),
        SEP,
        stub('Print...', 'print', { shortcut: 'Ctrl+P' }),
        SEP,
        addClose('Footprint Editor', () => h.action('close')),
      ],
    },
    {
      label: 'Edit',
      items: [
        // `ENABLE( cond.UndoAvailable() )` / `RedoAvailable()` (:1361-1362).
        // Both were unconditionally live here.
        act('Undo', 'undo', { shortcut: 'Ctrl+Z', disabled: !conds.undoAvailable }),
        act('Redo', 'redo', { shortcut: 'Ctrl+Y', disabled: !conds.redoAvailable }),
        SEP,
        stub('Cut', 'cut', { shortcut: 'Ctrl+X' }),
        stub('Copy', 'copy', { shortcut: 'Ctrl+C' }),
        stub('Paste', 'paste', { shortcut: 'Ctrl+V' }),
        // `ENABLE( cond.HasItems() )` (:1370) — the BOARD, not the selection.
        act('Delete', 'doDelete', { shortcut: 'Delete', disabled: !conds.hasItems }),
        stub('Duplicate', 'duplicate', { shortcut: 'Ctrl+D' }),
        SEP,
        // `selectSubMenu->SetTitle( _( "&Select" ) )` (:112-117). Two rows in a
        // submenu, not loose in Edit.
        {
          label: 'Select',
          mnemonic: 'S',
          submenu: [
            stub('Select All', 'selectAll', { shortcut: 'Ctrl+A' }),
            stub('Unselect All', 'unselectAll', { shortcut: 'Ctrl+Shift+A' }),
          ],
        },
        SEP,
        stub('Edit Text & Graphics Properties...', 'editTextAndGraphics'),
        stub('Pad Table...', 'padTable'),
        stub('Default Pad Properties...', 'defaultPadProperties'),
        // pcb_actions.cpp:1152 — FriendlyName "Renumber Pads...", not
        // "Enumerate Pads".
        stub('Renumber Pads...', 'enumeratePads'),
        // ACTIONS::gridOrigin (actions.cpp:1102) — the DIALOG. Distinct from
        // Place's `gridSetOrigin`, which is the click-to-place tool.
        stub('Grid Origin...', 'gridOrigin'),
      ],
    },
    {
      label: 'View',
      items: [
        // `showHidePanels->SetTitle( _( "Panels" ) )` (:131-137). Ours had the
        // three rows loose in View under invented names — "Footprint Tree" for
        // ACTIONS::showLibraryTree, "Appearance Manager" for
        // PCB_ACTIONS::showLayersManager ("Appearance").
        {
          label: 'Panels',
          submenu: [
            chk('Properties', 'showProperties'),
            chk('Library Tree', 'showLibraryTree'),
            chk('Appearance', 'showLayersManager'),
          ],
        },
        SEP,
        stub('Footprint Library Browser', 'showFootprintBrowser'),
        stub('3D Viewer', 'show3DViewer', { shortcut: 'Alt+3' }),
        SEP,
        act('Zoom In', 'zoomInCenter'),
        act('Zoom Out', 'zoomOutCenter'),
        // actions.cpp:717 — WXK_HOME. The F this row used to print is
        // PCB_ACTIONS::flip's key, not this action's.
        act('Zoom to Fit', 'zoomFitScreen', { shortcut: 'Home' }),
        stub('Zoom to Selection Area', 'zoomTool', { shortcut: 'Ctrl+F5' }),
        stub('Refresh', 'zoomRedraw', { shortcut: 'F5' }),
        SEP,
        // `drawingModeSubMenu->SetTitle( _( "&Drawing Mode" ) )` (:151-159).
        {
          label: 'Drawing Mode',
          mnemonic: 'D',
          submenu: [
            chk('Sketch Pads', 'padDisplayMode'),
            chk('Sketch Graphic Items', 'graphicsOutlines'),
            chk('Sketch Text Items', 'textOutlines'),
          ],
        },
        // `contrastModeSubMenu->SetTitle( _( "&Contrast Mode" ) )` (:161-169).
        {
          label: 'Contrast Mode',
          mnemonic: 'C',
          submenu: [
            chk('Inactive Layer View Mode', 'highContrast'),
            stub('Decrease Layer Opacity', 'layerAlphaDec', { shortcut: '{' }),
            stub('Increase Layer Opacity', 'layerAlphaInc', { shortcut: '}' }),
          ],
        },
        stub('Flip Board View', 'flipBoard'),
      ],
    },
    {
      label: 'Place',
      items: [
        tool('Add Pad', 'placePad', { disabled: !conds.haveFootprint }),
        stub('Draw Rule Areas', 'drawRuleArea', { shortcut: 'Ctrl+Shift+K' }),
        SEP,
        tool('Draw Lines', 'drawLine', {
          shortcut: 'Ctrl+Shift+L',
          disabled: !conds.haveFootprint,
        }),
        stub('Draw Arcs', 'drawArc', { shortcut: 'Ctrl+Shift+A' }),
        tool('Draw Rectangles', 'drawRectangle', { disabled: !conds.haveFootprint }),
        tool('Draw Circles', 'drawCircle', {
          shortcut: 'Ctrl+Shift+C',
          disabled: !conds.haveFootprint,
        }),
        stub('Draw Polygons', 'drawPolygon', { shortcut: 'Ctrl+Shift+P' }),
        stub('Draw Bezier Curve', 'drawBezier', { shortcut: 'Ctrl+Shift+B' }),
        stub('Place Reference Images', 'placeReferenceImage'),
        // Ctrl+Shift+T is BROWSER_RESERVED with no substitution declared - see
        // `ui/browser_reserved.ts`, which names this exact action as the one
        // reserved combo deliberately left alone. `browserSafeKey` is still
        // what decides, so when that table changes this row changes with it.
        stub('Draw Text', 'placeText', { shortcut: browserSafeKey('Ctrl+Shift+T') }),
        stub('Draw Text Boxes', 'drawTextBox'),
        stub('Draw Tables', 'drawTable'),
        stub('Place Point', 'placePoint'),
        stub('Add Barcode', 'placeBarcode'),
        SEP,
        stub('Draw Orthogonal Dimensions', 'drawOrthogonalDimension', {
          shortcut: 'Ctrl+Shift+H',
        }),
        stub('Draw Aligned Dimensions', 'drawAlignedDimension'),
        stub('Draw Center Dimensions', 'drawCenterDimension'),
        stub('Draw Radial Dimensions', 'drawRadialDimension'),
        stub('Draw Leaders', 'drawLeader'),
        SEP,
        stub('Place the Footprint Anchor', 'setAnchor', {
          shortcut: browserSafeKey('Ctrl+Shift+N'),
        }),
        // ACTIONS::gridSetOrigin (actions.cpp:1057) — "Grid Origin", the tool.
        stub('Grid Origin', 'gridSetOrigin'),
        SEP,
        stub('Reset Grid Origin', 'gridResetOrigin'),
      ],
    },
    {
      label: 'Inspect',
      items: [
        stub('Measure Tool', 'measureTool', { shortcut: 'Ctrl+Shift+M' }),
        SEP,
        // pcb_actions.cpp:954 — FriendlyName "Footprint Checker", no ellipsis.
        stub('Footprint Checker', 'checkFootprint'),
        SEP,
        // `PCB_ACTIONS::showDatasheet` is inherited: PCB_ACTIONS derives from
        // ACTIONS (`pcb_actions.h:50`) and defines no showDatasheet of its own,
        // so this is ACTIONS::showDatasheet, DefaultHotkey 'D'.
        act('Show Datasheet', 'showDatasheet', {
          shortcut: 'D',
          disabled: !conds.haveFootprint,
        }),
      ],
    },
    {
      label: 'Tools',
      items: [
        // pcb_actions.cpp:961/968 — the FriendlyNames say "PCB", and only the
        // Tooltips say "board".
        stub('Load footprint from current PCB', 'loadFpFromBoard'),
        stub('Insert footprint into PCB', 'saveFpToBoard'),
        SEP,
        stub('Cleanup Graphics...', 'cleanupGraphics'),
        stub('Repair Footprint', 'repairFootprint'),
      ],
    },
    {
      // :234-243. The same three lines fifteen KiCad frames end with, then
      // AddMenuLanguageList. Ours was a single greyed "Preferences...".
      label: 'Preferences',
      items: [
        stub('Configure Paths...', 'configurePaths'),
        stub('Manage Footprint Libraries...', 'showFootprintLibTable'),
        act('Preferences...', 'openPreferences', { shortcut: 'Ctrl+,' }),
        SEP,
        setLanguageMenuItem({ current: h.language, onSelect: h.onSelectLanguage }),
      ],
    },
    standardHelpMenu({ showHotkeys: h.showHotkeys, showAbout: h.showAbout }),
  ];
}
