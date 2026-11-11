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

import type { Menu, MenuItem } from '@ziroeda/wx/menu.js';
import { addClose } from '@ziroeda/common/tool/action_menu.js';
import { browserSafeKey } from '@ziroeda/common/browser_reserved.js';
import { standardHelpMenu } from '@ziroeda/common/eda_base_frame_help_menu.js';
import { setLanguageMenuItem } from '@ziroeda/common/eda_base_frame_language_menu.js';
import { _ } from '@ziroeda/wx/translation.js';

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
      label: _('File'),
      items: [
        act(_('New Library...'), 'newLibrary'),
        act(_('Add Library...'), 'addLibrary'),
        // pcb_actions.cpp:868 — FriendlyName "New Footprint", no ellipsis.
        //
        // Upstream sets NO condition on this action, so the menu row is always
        // live: `NewFootprint` (`footprint_editor_control.cpp:212-244`) creates
        // the footprint on the canvas either way and only
        // `tryToSaveFootprintInLibrary` (:174-208) checks the target, doing
        // nothing when the nickname is empty. We cannot hold a library-less
        // footprint — every buffer here is keyed by library — so the row is
        // greyed rather than made to do nothing. Deliberate deviation.
        act(_('New Footprint'), 'newFootprint', {
          shortcut: browserSafeKey('Ctrl+N'),
          disabled: !conds.targetLib,
        }),
        stub(_('Create Footprint...'), 'createFootprint'),
        stub(_('Edit Library Footprint...'), 'editLibFpInFpEditor', { shortcut: 'Ctrl+Shift+E' }),
        SEP,
        // `ENABLE( SELECTION_CONDITIONS::ShowAlways )` (:1353). Save is live
        // even with nothing modified and nothing loaded — this frame's Save
        // reaches the *library*, not only the open footprint, so upstream never
        // gates it. Ours greyed it on "anything unsaved anywhere".
        act('Save', 'save', { shortcut: 'Ctrl+S' }),
        stub(_('Save As...'), 'saveAs', { shortcut: 'Ctrl+Shift+S' }),
        // `ENABLE( cond.ContentModified() )` (:1352).
        act(_('Revert'), 'revert', { disabled: !conds.contentModified }),
        //
        // NOT here: "Save All". `ACTIONS::saveAll` appears nowhere in
        // `menubar_footprint_editor.cpp` — the footprint editor has no such
        // row. Ours had invented one.
        SEP,
        // `submenuImport->Add( action, ACTION_MENU::NORMAL, _( "Footprint..." ) )`
        // — the third argument REPLACES the FriendlyName, so the row reads
        // "Footprint...", not "Import Footprint...".
        {
          label: _('Import'),
          submenu: [
            act(_('Footprint...'), 'importFootprint'),
            stub(_('Graphics...'), 'placeImportedGraphics', { shortcut: 'Ctrl+Shift+F' }),
          ],
        },
        {
          label: _('Export'),
          submenu: [
            // `ENABLE( haveFootprintCond )` (:1428) — the loaded footprint, not
            // the tree's target FPID, which is what ours used to read.
            act(_('Footprint...'), 'exportFootprint', { disabled: !conds.haveFootprint }),
            // :78-81 — not an action at all but a raw
            // `Add( label, help, ID_FPEDIT_SAVE_PNG, BITMAPS::export_png )`,
            // so the help string is upstream's own and the `&` marks P. No
            // update-UI handler: always live, and OnSaveFootprintAsPng says
            // "No footprint selected." itself.
            {
              label: _('View as PNG...'),
              mnemonic: 'P',
              tooltip: _('Create a PNG file from the current view'),
              action: () => h.action('saveFootprintAsPng'),
            },
          ],
        },
        SEP,
        // `ENABLE( footprintSelectedInTreeCond || haveFootprintCond )` (:1431).
        // A tree row on its own opens it — `editFootprintPropertiesFromLibrary`
        // (`footprint_editor_control.cpp:794`) is the branch for that.
        act(_('Footprint Properties...'), 'footprintProperties', {
          disabled: !(conds.footprintSelectedInTree || conds.haveFootprint),
        }),
        SEP,
        stub(_('Print...'), 'print', { shortcut: 'Ctrl+P' }),
        SEP,
        addClose(_('Footprint Editor'), () => h.action('close')),
      ],
    },
    {
      label: _('Edit'),
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
        act(_('Delete'), 'doDelete', { shortcut: _('Delete'), disabled: !conds.hasItems }),
        stub('Duplicate', 'duplicate', { shortcut: 'Ctrl+D' }),
        SEP,
        // `selectSubMenu->SetTitle( _( "&Select" ) )` (:112-117). Two rows in a
        // submenu, not loose in Edit.
        {
          label: _('Select'),
          mnemonic: 'S',
          submenu: [
            stub(_('Select All'), 'selectAll', { shortcut: 'Ctrl+A' }),
            stub(_('Unselect All'), 'unselectAll', { shortcut: 'Ctrl+Shift+A' }),
          ],
        },
        SEP,
        // `ENABLE( haveFootprintCond )` (:1436).
        act(_('Edit Text & Graphics Properties...'), 'editTextAndGraphics', {
          disabled: !conds.haveFootprint,
        }),
        // `ENABLE( haveFootprintCond )` (:1435).
        act(_('Pad Table...'), 'padTable', { disabled: !conds.haveFootprint }),
        act(_('Default Pad Properties...'), 'defaultPadProperties'),
        // pcb_actions.cpp:1152 — FriendlyName "Renumber Pads...", not
        // "Enumerate Pads".
        act(_('Renumber Pads...'), 'enumeratePads'),
        // ACTIONS::gridOrigin (actions.cpp:1102) — the DIALOG. Distinct from
        // Place's `gridSetOrigin`, which is the click-to-place tool.
        act(_('Grid Origin...'), 'gridOrigin'),
      ],
    },
    {
      label: _('View'),
      items: [
        // `showHidePanels->SetTitle( _( "Panels" ) )` (:131-137). Ours had the
        // three rows loose in View under invented names — "Footprint Tree" for
        // ACTIONS::showLibraryTree, "Appearance Manager" for
        // PCB_ACTIONS::showLayersManager ("Appearance").
        {
          label: _('Panels'),
          submenu: [
            chk(_('Properties'), 'showProperties'),
            chk(_('Library Tree'), 'showLibraryTree'),
            chk(_('Appearance'), 'showLayersManager'),
          ],
        },
        SEP,
        // `ACTIONS::showFootprintBrowser` (menubar_footprint_editor.cpp:140).
        act(_('Footprint Library Browser'), 'showFootprintBrowser'),
        stub('3D Viewer', 'show3DViewer', { shortcut: 'Alt+3' }),
        SEP,
        act('Zoom In', 'zoomInCenter'),
        act('Zoom Out', 'zoomOutCenter'),
        // actions.cpp:717 — WXK_HOME. The F this row used to print is
        // PCB_ACTIONS::flip's key, not this action's.
        act(_('Zoom to Fit'), 'zoomFitScreen', { shortcut: 'Home' }),
        stub(_('Zoom to Selection Area'), 'zoomTool', { shortcut: 'Ctrl+F5' }),
        stub(_('Refresh'), 'zoomRedraw', { shortcut: 'F5' }),
        SEP,
        // `drawingModeSubMenu->SetTitle( _( "&Drawing Mode" ) )` (:151-159).
        {
          label: _('Drawing Mode'),
          mnemonic: 'D',
          submenu: [
            chk(_('Sketch Pads'), 'padDisplayMode'),
            chk(_('Sketch Graphic Items'), 'graphicsOutlines'),
            chk(_('Sketch Text Items'), 'textOutlines'),
          ],
        },
        // `contrastModeSubMenu->SetTitle( _( "&Contrast Mode" ) )` (:161-169).
        {
          label: _('Contrast Mode'),
          mnemonic: 'C',
          submenu: [
            chk(_('Inactive Layer View Mode'), 'highContrast'),
            stub(_('Decrease Layer Opacity'), 'layerAlphaDec', { shortcut: '{' }),
            stub(_('Increase Layer Opacity'), 'layerAlphaInc', { shortcut: '}' }),
          ],
        },
        stub(_('Flip Board View'), 'flipBoard'),
      ],
    },
    {
      label: _('Place'),
      items: [
        tool(_('Add Pad'), 'placePad', { disabled: !conds.haveFootprint }),
        stub(_('Draw Rule Areas'), 'drawRuleArea', { shortcut: 'Ctrl+Shift+K' }),
        SEP,
        tool(_('Draw Lines'), 'drawLine', {
          shortcut: 'Ctrl+Shift+L',
          disabled: !conds.haveFootprint,
        }),
        stub(_('Draw Arcs'), 'drawArc', { shortcut: 'Ctrl+Shift+A' }),
        tool(_('Draw Rectangles'), 'drawRectangle', { disabled: !conds.haveFootprint }),
        tool(_('Draw Circles'), 'drawCircle', {
          shortcut: 'Ctrl+Shift+C',
          disabled: !conds.haveFootprint,
        }),
        stub(_('Draw Polygons'), 'drawPolygon', { shortcut: 'Ctrl+Shift+P' }),
        stub(_('Draw Bezier Curve'), 'drawBezier', { shortcut: 'Ctrl+Shift+B' }),
        stub(_('Place Reference Images'), 'placeReferenceImage'),
        // Ctrl+Shift+T is BROWSER_RESERVED with no substitution declared - see
        // `ui/browser_reserved.ts`, which names this exact action as the one
        // reserved combo deliberately left alone. `browserSafeKey` is still
        // what decides, so when that table changes this row changes with it.
        stub(_('Draw Text'), 'placeText', { shortcut: browserSafeKey('Ctrl+Shift+T') }),
        stub(_('Draw Text Boxes'), 'drawTextBox'),
        stub(_('Draw Tables'), 'drawTable'),
        // `DRAWING_TOOL::PlacePoint` opens with
        // `if( m_isFootprintEditor && !m_frame->GetModel() ) return 0`
        // (`drawing_tool.cpp:916-917`) — the same "a footprint is loaded"
        // guard the other placement rows carry as `haveFootprintCond`.
        tool(_('Place Point'), 'placePoint', { disabled: !conds.haveFootprint }),
        // `PCB_ACTIONS::placeBarcode` (`menubar_footprint_editor.cpp:193`),
        // behind the same "a footprint is loaded" guard the other placement
        // rows carry.
        tool('Add Barcode', 'placeBarcode', { disabled: !conds.haveFootprint }),
        SEP,
        stub(_('Draw Orthogonal Dimensions'), 'drawOrthogonalDimension', {
          shortcut: 'Ctrl+Shift+H',
        }),
        stub(_('Draw Aligned Dimensions'), 'drawAlignedDimension'),
        stub(_('Draw Center Dimensions'), 'drawCenterDimension'),
        stub(_('Draw Radial Dimensions'), 'drawRadialDimension'),
        stub(_('Draw Leaders'), 'drawLeader'),
        SEP,
        stub('Place the Footprint Anchor', 'setAnchor', {
          shortcut: browserSafeKey('Ctrl+Shift+N'),
        }),
        // ACTIONS::gridSetOrigin (actions.cpp:1057) — "Grid Origin", the tool.
        tool(_('Grid Origin'), 'gridSetOrigin'),
        SEP,
        // `ACTIONS::gridResetOrigin` — not a tool: `COMMON_TOOLS::GridResetOrigin`
        // sets it to (0, 0) outright, so this is an `act` row.
        act('Reset Grid Origin', 'gridResetOrigin'),
      ],
    },
    {
      label: _('Inspect'),
      items: [
        // `ACTIONS::measureTool` — the same tool the right toolbar arms, and a
        // real item rather than a stub now that the canvas hears it.
        {
          label: _('Measure Tool'),
          icon: 'measureTool',
          action: () => h.tool('measureTool'),
          shortcut: 'Ctrl+Shift+M',
          tooltip: _('Interactively measure distance between points'),
        },
        SEP,
        // pcb_actions.cpp:954 — FriendlyName "Footprint Checker", no ellipsis.
        act(_('Footprint Checker'), 'checkFootprint'),
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
      label: _('Tools'),
      items: [
        // pcb_actions.cpp:961/968 — the FriendlyNames say "PCB", and only the
        // Tooltips say "board".
        stub(_('Load footprint from current PCB'), 'loadFpFromBoard'),
        stub(_('Insert footprint into PCB'), 'saveFpToBoard'),
        SEP,
        stub(_('Cleanup Graphics...'), 'cleanupGraphics'),
        stub(_('Repair Footprint'), 'repairFootprint'),
      ],
    },
    {
      // :234-243. The same three lines fifteen KiCad frames end with, then
      // AddMenuLanguageList. Ours was a single greyed "Preferences...".
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
        act(_('Manage Footprint Libraries...'), 'showFootprintLibTable'),
        act(_('Preferences...'), 'openPreferences', { shortcut: 'Ctrl+,' }),
        SEP,
        setLanguageMenuItem({ current: h.language, onSelect: h.onSelectLanguage }),
      ],
    },
    standardHelpMenu({ showHotkeys: h.showHotkeys, showAbout: h.showAbout }),
  ];
}
