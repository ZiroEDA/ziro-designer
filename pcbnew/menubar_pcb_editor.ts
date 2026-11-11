// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME::doReCreateMenuBar` (`pcbnew/menubar_pcb_editor.cpp:44-491`),
 * transcribed.
 *
 * Split out of `PcbEditor.tsx` for the reason the other five editors' menu
 * modules were: **`qa`'s tsconfig compiles `.ts` only**, so a menu built inside
 * a `.tsx` is unreachable from the test suite by construction. The board
 * editor's bar could only be checked as SOURCE TEXT — a regex over a
 * ten-thousand-line component — which reads the labels and can say nothing
 * about what a row does, whether its condition is right, or whether the
 * accelerator it prints reaches it.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE STRINGS COME FROM
 * ---------------------------------------------------------------------------
 *
 * Every label is a `TOOL_ACTION::FriendlyName` and every accelerator a
 * `DefaultHotkey`, out of `common/tool/actions.cpp` and
 * `pcbnew/tools/pcb_actions.cpp`. `ui/action_catalogue.ts` is NOT the source:
 * it carries the toolbar and hotkey subset, some forty-five of these actions
 * are absent from it, and a few are spelled differently there
 * (`zoneDisplayOutlines` against `zoneDisplayOutline`).
 *
 * Watch the ellipses, because they are upstream's and not a house style:
 * `inspectClearance` is "Clearance Resolution" with none, `boardStatistics` is
 * "Show Board Statistics", `zonesManager` is "Zone Manager...".
 *
 * Several actions are `#if defined( __WXMAC__ )`-gated and the FIRST
 * `.DefaultHotkey()` in the source is the Mac one. This is the Linux build:
 * `redo` is Ctrl+Y, `doDelete` is Delete, `zoomFitScreen` is Home.
 *
 * ---------------------------------------------------------------------------
 * THE THREE HANDLERS
 * ---------------------------------------------------------------------------
 *
 * `tool(id)` arms a placement/drawing tool, `action(id)` runs a one-shot
 * command, `toggle(id)` flips a CHECK setting — the same split the schematic
 * and footprint modules use. An id is the one `pcbToolbars.ts` already uses for
 * the same command where there is one, and `MenuItem.icon` carries it, because
 * `ui/hotkeys_inventory.ts` keys the Hotkey List on that field the way
 * `HOTKEY_STORE` keys on `TOOL_ACTION::GetName()` — two spellings list one
 * action twice.
 *
 * Rows whose feature does not exist here yet are greyed **in their upstream
 * position**. A greyed row does not dispatch its accelerator
 * (`ui/menu_hotkeys.ts`), which is `ACTION_CONDITIONS`' rule too.
 */

import type { Menu } from '@ziroeda/wx/menu.js';
import { browserSafeKey } from '@ziroeda/common/browser_reserved.js';
import { addQuitOrClose } from '@ziroeda/common/tool/action_menu.js';
import { standardHelpMenu } from '@ziroeda/common/eda_base_frame_help_menu.js';
import { setLanguageMenuItem } from '@ziroeda/common/eda_base_frame_language_menu.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PcbMenuHandlers {
  /** A one-shot command. */
  action: (id: string) => void;
  /** Arm a placement/drawing tool (`pcbToolbars.ts`'s ids). */
  tool: (id: string) => void;
  /** Flip a CHECK setting (the left toolbar's toggle ids). */
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

/**
 * The `ACTION_CONDITIONS` a row is gated on — upstream's `.Enable( … )` and
 * `.Check( … )`, as data.
 */
export interface PcbMenuState {
  /** `!Kiface().IsSingle()` — a schematic to update from and switch to. */
  hasSchematic: boolean;
  hasFootprintEditor: boolean;
  /** `ACTIONS::highContrastMode`'s CHECK: on whenever the mode is not NORMAL. */
  highContrast: boolean;
  /** `PCB_ACTIONS::flipBoard`'s CHECK. */
  flipBoard: boolean;
}

/** CHECK state for the toggle rows, keyed by the id `toggle` is called with. */
export type PcbMenuChecks = Readonly<Record<string, boolean>>;

/**
 * A row for a command this frame does not run yet.
 *
 * `true`, always: it is not a condition, it is the absence of a feature, and
 * spelling it this way keeps the greyed rows greppable.
 */
const dis = true;

export function buildPcbMenus(
  h: PcbMenuHandlers,
  st: PcbMenuState,
  checks: PcbMenuChecks = {},
): Menu[] {
  return [
    {
      label: _('File'),
      /*
       * `menubar_pcb_editor.cpp:54-183`, row for row.
       *
       * No New Board, no Open..., no Open Recent: all three are inside
       * `if( Kiface().IsSingle() )` (`:57-85`), and that branch means "launched
       * standalone", not "under a project manager". Every board here belongs to
       * a project — the address is `/p/<uid>/pcb` — so this is always the other
       * branch, which is the same reason the row below is Save a Copy and not
       * Save As (`:95-99`). They were drawn greyed, which said the opposite:
       * that pcbnew has them and we have not built them.
       */
      items: [
        { label: _('Append Board...'), icon: 'appendBoard', disabled: dis },
        { sep: true },
        { label: 'Save', icon: 'save', action: () => h.action('save'), shortcut: 'Ctrl+S' },
        { label: _('Save a Copy...'), icon: 'saveAs', action: () => h.action('saveCopy') },
        // `ACTIONS::revert` — "Throw away changes". No hotkey upstream: a
        // destructive command is given none.
        { label: _('Revert'), icon: 'revert', disabled: dis },
        { sep: true },
        // `PCB_ACTIONS::rescueAutosave` — load the board back from an autosave
        // left by a crashed session. Ours are versions in the project store
        // rather than a `_autosave-` file beside the board, so this is a
        // different mechanism wearing the same name; greyed until it is built.
        { label: 'Rescue', icon: 'rescue', disabled: dis },
        { sep: true },
        // The three submenus (`:107-155`). Their children are upstream's, so
        // the menu says what pcbnew can do rather than hiding it behind one
        // greyed word — and each row is a specific thing to build.
        {
          label: _('Import'),
          icon: 'import',
          submenu: [
            { label: _('Netlist...'), disabled: dis, action: () => h.action('importNetlist') },
            { label: _('Specctra Session...'), action: () => h.action('importSpecctraSession') },
            // `PCB_ACTIONS::placeImportedGraphics`, run non-interactively:
            // `DRAWING_TOOL::PlaceImportedGraphics` is the same handler the
            // Place toolbar button arms; from the menu it opens straight into
            // the dialog with no drawing tool to cancel out of first.
            { label: _('Graphics...'), action: () => h.action('importGraphics') },
            // `PCB_ACTIONS::openNonKicadBoard`, added with no label override: the
            // row reads the action's friendly name.
            {
              label: _('Import Non-KiCad Board File...'),
              icon: 'import_brd_file',
              action: () => h.action('openNonKicadBoard'),
            },
          ],
        },
        {
          label: _('Export'),
          icon: 'export',
          submenu: [
            { label: _('Specctra DSN...'), action: () => h.action('exportSpecctraDSN') },
            { label: _('GenCAD...'), action: () => h.action('exportGenCAD') },
            { label: _('VRML...'), action: () => h.action('exportVRML') },
            { label: _('IDFv3...'), disabled: dis },
            { label: _('STEP/GLB/BREP/XAO/PLY/STL...'), disabled: dis },
            {
              label: _('Footprint Association (.cmp) File...'),
              action: () => h.action('exportCmpFile'),
            },
            { label: _('Hyperlynx...'), action: () => h.action('exportHyperlynx') },
            { sep: true },
            { label: _('Footprints...'), disabled: dis },
          ],
        },
        {
          label: _('Fabrication Outputs'),
          icon: 'fabrication',
          submenu: [
            { label: _('Gerbers (.gbr)...'), disabled: dis },
            { label: _('Drill Files (.drl)...'), action: () => h.action('generateDrillFiles') },
            { label: _('IPC-2581 File (.xml)...'), action: () => h.action('generateIPC2581File') },
            { label: _('ODB++ Output File...'), action: () => h.action('generateODBPPFile') },
            {
              label: _('Component Placement (.pos, .gbr)...'),
              action: () => h.action('generatePosFile'),
            },
            { label: _('Footprint Report (.rpt)...'), disabled: dis },
            { label: _('IPC-D-356 Netlist File...'), action: () => h.action('generateD356File') },
            { label: _('Bill of Materials...'), action: () => h.action('generateBOM') },
          ],
        },
        { sep: true },
        // These four were reachable from the toolbar and from nowhere in the
        // menu bar, which is where a user looks for them.
        { label: _('Board Setup...'), icon: 'setup', action: () => h.action('boardSetup') },
        { sep: true },
        { label: _('Page Settings...'), icon: 'page', action: () => h.action('pageSettings') },
        {
          label: _('Print...'),
          icon: 'print',
          action: () => h.action('print'),
          shortcut: 'Ctrl+P',
        },
        { label: _('Plot...'), icon: 'plot', action: () => h.action('plot') },
        { sep: true },
        addQuitOrClose(_('PCB Editor'), () => h.action('close')),
      ],
    },
    {
      label: _('Edit'),
      /*
       * `menubar_pcb_editor.cpp:180-211`, row for row.
       *
       * Most of what used to be here is not in KiCad's Edit menu at all: every
       * `PCB_ACTIONS` in `edit_tool.cpp` and `pcb_selection_tool.cpp` —
       * Properties, Move Exactly, Position Relative, Create Array, Outset,
       * Change Side, the Convert submenu — hangs off the SELECTION CONTEXT
       * MENU, which is the same reading the Align/Distribute note below already
       * records. Ours drew them in both places and was missing eight rows that
       * upstream does put here.
       */
      items: [
        { label: 'Undo', icon: 'undo', action: () => h.action('undo'), shortcut: 'Ctrl+Z' },
        // `ACTIONS::redo`'s Ctrl+Shift+Z is inside `#if defined( __WXMAC__ )`;
        // the GTK build takes the `#else`, which is Ctrl+Y.
        { label: 'Redo', icon: 'redo', action: () => h.action('redo'), shortcut: 'Ctrl+Y' },
        { sep: true },
        { label: 'Cut', icon: 'cut', action: () => h.action('cut'), shortcut: 'Ctrl+X' },
        { label: 'Copy', icon: 'copy', action: () => h.action('copy'), shortcut: 'Ctrl+C' },
        {
          label: 'Paste',
          icon: 'paste',
          shortcut: 'Ctrl+V',
          // Ctrl+V is the browser's own paste event, not ours — the same
          // `nativeShortcut` the context menu's row carries.
          nativeShortcut: true,
          action: () => h.action('paste'),
        },
        {
          label: _('Paste Special...'),
          icon: 'paste',
          action: () => h.action('pasteSpecial'),
          shortcut: 'Ctrl+Shift+V',
        },
        {
          label: _('Delete'),
          icon: 'delete',
          action: () => h.action('doDelete'),
          shortcut: _('Delete'),
        },
        { sep: true },
        // `selectSubMenu`, titled "&Select" (`:186-190`).
        {
          label: _('Select'),
          submenu: [
            { label: _('Select All'), action: () => h.action('selectAll'), shortcut: 'Ctrl+A' },
            {
              label: _('Unselect All'),
              action: () => h.action('unselectAll'),
              shortcut: 'Ctrl+Shift+A',
            },
          ],
        },
        { sep: true },
        { label: 'Find', icon: 'find', action: () => h.action('find'), shortcut: 'Ctrl+F' },
        { sep: true },
        { label: _('Edit Track & Via Properties...'), action: () => h.action('editTracksAndVias') },
        {
          label: _('Edit Text & Graphics Properties...'),
          action: () => h.action('editTextAndGraphics'),
        },
        { label: _('Edit Teardrops...'), action: () => h.action('editTeardrops') },
        { label: _('Change Footprints...'), action: () => h.action('changeFootprints') },
        { label: _('Swap Layers...'), action: () => h.action('swapLayers') },
        // `ACTIONS::gridOrigin` — the DIALOG ("Grid Origin..."), not
        // `gridSetOrigin`, which is the interactive tool the Place menu has.
        { label: _('Grid Origin...'), icon: 'gridOrigin', action: () => h.action('gridOrigin') },
        { sep: true },
        // `PCB_ACTIONS::zoneFillAll` — B, and the frame has run it since the
        // key was bound; it simply had no row.
        {
          label: _('Fill All Zones'),
          icon: 'zoneFill',
          action: () => h.action('zoneFillAll'),
          shortcut: 'B',
        },
        { label: _('Unfill All Zones'), action: () => h.action('zoneUnfillAll') },
        { label: _('Update All Tuning Patterns'), disabled: dis },
        { sep: true },
        // `ACTIONS::deleteTool` — the interactive one, which keeps deleting
        // what you click until it is cancelled. Not the same command as Delete.
        { label: _('Interactive Delete Tool'), disabled: dis },
        { label: _('Global Deletions...'), action: () => h.action('globalDeletions') },
      ],
    },
    {
      label: _('View'),
      /*
       * `menubar_pcb_editor.cpp:213-281`, row for row. Ours had nine rows
       * against upstream's twenty-eight, and most of the missing ones were
       * commands this frame already runs — the 3D viewer and Flip Board View
       * were drawn GREYED beside a toolbar button that opens them.
       *
       * Every CHECK row is `ACTION_MENU::CHECK`, which draws a tick rather than
       * a radio dot however few of them are on.
       */
      items: [
        {
          label: _('Panels'),
          submenu: [
            {
              label: _('Properties'),
              checked: !!checks.showProperties,
              action: () => h.toggle('showProperties'),
            },
            // `PCB_ACTIONS::showSearch` (ACTIONS::showSearch, Ctrl+G), a CHECK row on
            // `searchPaneCond`: the docked PCB_SEARCH_PANE. Find is the dialog.
            {
              label: 'Search',
              checked: !!checks.showSearch,
              action: () => h.toggle('showSearch'),
              shortcut: 'Ctrl+G',
            },
            {
              label: _('Appearance'),
              checked: !!checks.showLayersManager,
              action: () => h.toggle('showLayersManager'),
            },
            // `PCB_ACTIONS::showNetInspector`, CHECK on `netInspectorCond`.
            {
              label: _('Net Inspector'),
              checked: !!checks.showNetInspector,
              action: () => h.toggle('showNetInspector'),
            },
            // `PCB_ACTIONS::showDesignBlockPanel`, CHECK, labelled "Design Blocks", inside
            // `ADVANCED_CFG::m_EnablePcbDesignBlocks` - true by default (advanced_config.cpp:278).
            {
              label: _('Design Blocks'),
              checked: !!checks.showDesignBlockPanel,
              action: () => h.toggle('showDesignBlockPanel'),
            },
          ],
        },
        { sep: true },
        // `ACTIONS::showFootprintBrowser` (actions.cpp:1291-1297), which
        // COMMON_CONTROL runs as `ShowPlayer( FRAME_FOOTPRINT_VIEWER )`. No
        // hotkey; the icon is `library_browser`, the toolbar button's.
        {
          label: _('Footprint Library Browser'),
          icon: 'footprintBrowser',
          action: () => h.action('footprintBrowser'),
        },
        {
          label: '3D Viewer',
          icon: 'threeDViewer',
          action: () => h.action('threeDViewer'),
          shortcut: 'Alt+3',
        },
        { sep: true },
        // `zoomInCenter` / `zoomOutCenter` — about the VIEW centre, which is
        // what a menu row does; the toolbar's zoom is about the cursor.
        { label: 'Zoom In', icon: 'zoomIn', action: () => h.action('zoomInCenter') },
        { label: 'Zoom Out', icon: 'zoomOut', action: () => h.action('zoomOutCenter') },
        // `ACTIONS::zoomFitScreen` is Ctrl+0 upstream; Home is ours and is what
        // this frame has always dispatched, so both are true and only one can
        // be printed. Left as Home until the key itself moves.
        {
          label: _('Zoom to Fit'),
          icon: 'zoomFit',
          action: () => h.action('zoomFitScreen'),
          shortcut: 'Home',
        },
        {
          label: _('Zoom to All Objects'),
          icon: 'zoomFitObjects',
          action: () => h.action('zoomFitObjects'),
        },
        { label: _('Zoom to Selected Objects'), disabled: dis },
        {
          label: _('Zoom to Selection Area'),
          icon: 'zoomTool',
          action: () => h.tool('zoomTool'),
        },
        {
          label: _('Refresh'),
          icon: 'zoomRedraw',
          action: () => h.action('zoomRedraw'),
          shortcut: 'F5',
        },
        { sep: true },
        {
          label: _('Drawing Mode'),
          submenu: [
            {
              label: _('Draw Zone Fills'),
              checked: !!checks.zoneDisplayFilled,
              action: () => h.toggle('zoneDisplayFilled'),
            },
            {
              label: _('Draw Zone Outlines'),
              checked: !!checks.zoneDisplayOutline,
              action: () => h.toggle('zoneDisplayOutline'),
            },
            { sep: true },
            // `menubar_pcb_editor.cpp:258-264`: the pads, graphics and text are
            // PCB_VIEWER_TOOLS', vias and tracks PCB_CONTROL's; each is checked
            // off `!cond.*FillDisplay()`.
            {
              label: _('Sketch Pads'),
              icon: 'padDisplayMode',
              checked: !!checks.padDisplayMode,
              action: () => h.toggle('padDisplayMode'),
            },
            {
              label: _('Sketch Vias'),
              icon: 'viaDisplayMode',
              checked: !!checks.viaDisplayMode,
              action: () => h.toggle('viaDisplayMode'),
            },
            {
              label: _('Sketch Tracks'),
              icon: 'trackDisplayMode',
              checked: !!checks.trackDisplayMode,
              action: () => h.toggle('trackDisplayMode'),
            },
            { sep: true },
            {
              label: _('Sketch Graphic Items'),
              icon: 'graphicsOutlines',
              checked: !!checks.graphicsOutlines,
              action: () => h.toggle('graphicsOutlines'),
            },
            {
              label: _('Sketch Text Items'),
              icon: 'textOutlines',
              checked: !!checks.textOutlines,
              action: () => h.toggle('textOutlines'),
            },
          ],
        },
        {
          label: _('Contrast Mode'),
          submenu: [
            {
              // `ACTIONS::highContrastMode` cycles NORMAL -> DIM -> HIDDEN and
              // ticks whenever it is not NORMAL.
              label: _('Inactive Layer View Mode'),
              checked: st.highContrast,
              action: () => h.action('highContrastMode'),
            },
            // `layerAlphaDec` / `layerAlphaInc` step the LAYER opacity, which is
            // not the per-object opacity the Appearance panel carries.
            { label: _('Decrease Layer Opacity'), disabled: dis },
            { label: _('Increase Layer Opacity'), disabled: dis },
          ],
        },
        { label: _('Flip Board View'), checked: st.flipBoard, action: () => h.action('flipBoard') },
      ],
    },
    {
      label: _('Place'),
      items: [
        // `menubar_pcb_editor.cpp:288-315`, in that order and under those
        // FriendlyNames. Every row that names a tool this frame runs carries
        // that tool's action AND its `.DefaultHotkey()`, because
        // `ui/menu_hotkeys.ts` dispatches the `shortcut` on a menu row: a tool
        // with no row has no key, and a row with no action is a key that does
        // nothing. Draw Text and Draw Text Boxes were both in that state —
        // Text was a dead label and Text Box had no row at all — which is why
        // the toolbar could arm them and the keyboard could not.
        //
        // The greyed rows are the tools this frame does not run yet, and they
        // print NO accelerator. Upstream they carry one — there the tool exists
        // and the row is only conditionally disabled — but a key printed beside
        // a command we have not built is a promise nothing can keep, which is
        // the whole of what `menu_hotkey_coverage.test.ts` forbids. The key
        // arrives with the tool.
        {
          label: _('Place Footprints'),
          icon: 'placeFootprint',
          // `PCB_ACTIONS::placeFootprint`, `.DefaultHotkey( 'A' )` (pcb_actions.cpp:1464).
          shortcut: 'A',
          action: () => h.tool('placeFootprint'),
        },
        {
          label: _('Place Vias'),
          icon: 'drawVia',
          shortcut: 'Ctrl+Shift+X',
          action: () => h.tool('drawVia'),
        },
        {
          label: _('Draw Filled Zones'),
          icon: 'drawZone',
          // `#ifdef __WXOSX_MAC__ MD_ALT + 'Z' #else MD_CTRL|MD_SHIFT + 'Z'`
          // (`pcb_actions.cpp:318-322`) — the GTK build takes the `#else`.
          shortcut: 'Ctrl+Shift+Z',
          action: () => h.tool('drawZone'),
        },
        {
          label: _('Draw Rule Areas'),
          icon: 'drawRuleArea',
          // `.DefaultHotkey( MD_CTRL + MD_SHIFT + 'K' )` (`pcb_actions.cpp:344`).
          shortcut: 'Ctrl+Shift+K',
          action: () => h.tool('drawRuleArea'),
        },
        // `muwaveSubmenu` (`:296-304`) — MICROWAVE_TOOL's five shapes. None of
        // the five `PCB_ACTIONS::microwaveCreate*` declares a hotkey.
        {
          label: _('Draw Microwave Shapes'),
          submenu: [
            {
              label: _('Draw Microwave Lines'),
              icon: 'microwaveCreateLine',
              action: () => h.tool('microwaveCreateLine'),
            },
            {
              label: _('Draw Microwave Gaps'),
              icon: 'microwaveCreateGap',
              action: () => h.tool('microwaveCreateGap'),
            },
            {
              label: _('Draw Microwave Stubs'),
              icon: 'microwaveCreateStub',
              action: () => h.tool('microwaveCreateStub'),
            },
            {
              label: _('Draw Microwave Arc Stubs'),
              icon: 'microwaveCreateStubArc',
              action: () => h.tool('microwaveCreateStubArc'),
            },
            {
              label: _('Draw Microwave Polygonal Shapes'),
              icon: 'microwaveCreateFunctionShape',
              action: () => h.tool('microwaveCreateFunctionShape'),
            },
          ],
        },
        { sep: true },
        {
          label: _('Draw Lines'),
          icon: 'drawLine',
          shortcut: 'Ctrl+Shift+L',
          action: () => h.tool('drawLine'),
        },
        // Draw Arcs prints no key, and this one is not our omission.
        // Ctrl+Shift+A is double-booked UPSTREAM: `ACTIONS::unselectAll`
        // (`actions.cpp:378`) and `PCB_ACTIONS::drawArc` (`pcb_actions.cpp:147`)
        // both declare it, both AS_GLOBAL, and the installed manual documents
        // it under both names. KiCad resolves that at runtime —
        // `ACTION_MANAGER::RunHotKey` walks the globals sharing the key and
        // runs the first whose `enableCondition` passes and whose `RunAction`
        // returns true — so which one you get depends on tool registration
        // order and on the selection.
        //
        // Ours is a menu walk, so the first row in menu order wins outright,
        // and that is Edit > Unselect All. Printing the key here too would put
        // an accelerator on a row that can never fire it, which is the same lie
        // as a dead row. It goes to whichever row can actually run it.
        {
          label: _('Draw Arcs'),
          icon: 'drawArc',
          action: () => h.tool('drawArc'),
        },
        // No `.DefaultHotkey()` upstream, and none invented here.
        {
          label: _('Draw Rectangles'),
          icon: 'drawRectangle',
          action: () => h.tool('drawRectangle'),
        },
        {
          label: _('Draw Circles'),
          icon: 'drawCircle',
          shortcut: 'Ctrl+Shift+C',
          action: () => h.tool('drawCircle'),
        },
        {
          label: _('Draw Polygons'),
          icon: 'drawPolygon',
          shortcut: 'Ctrl+Shift+P',
          action: () => h.tool('drawPolygon'),
        },
        // `PCB_ACTIONS::drawBezier` declares Ctrl+Shift+B (`pcb_actions.cpp:157`)
        // and it survives the browser: Chromium's bookmark-bar toggle is an
        // ordinary accelerator, not one of the reserved commands, so the page
        // gets the key and `preventDefault` keeps it. Nothing in
        // `browser_reserved.ts` therefore needs to know about it.
        {
          label: _('Draw Bezier Curve'),
          icon: 'drawBezier',
          shortcut: 'Ctrl+Shift+B',
          action: () => h.tool('drawBezier'),
        },
        {
          label: _('Place Reference Images'),
          icon: 'placeReferenceImage',
          action: () => h.tool('placeReferenceImage'),
        },
        {
          label: _('Draw Text'),
          icon: 'placeText',
          // Ctrl+Shift+T upstream (`pcb_actions.cpp:213`), which is the
          // browser's reopen-closed-tab. `browserSafeKey` is what decides what
          // this row carries, so the menu and the dispatcher cannot disagree
          // and the table stays the one place the divergence is written down.
          shortcut: browserSafeKey('Ctrl+Shift+T'),
          action: () => h.tool('placeText'),
        },
        {
          label: _('Draw Text Boxes'),
          icon: 'drawTextBox',
          action: () => h.tool('drawTextBox'),
        },
        {
          label: _('Draw Tables'),
          icon: 'drawTable',
          action: () => h.tool('drawTable'),
        },
        {
          label: _('Place Point'),
          icon: 'placePoint',
          action: () => h.tool('placePoint'),
        },
        {
          label: 'Add Barcode',
          icon: 'placeBarcode',
          action: () => h.tool('placeBarcode'),
        },
        { sep: true },
        // `menubar_pcb_editor.cpp:317-326`: a "Draw Dimensions" submenu after a
        // separator, in this order — orthogonal first. This used to be a dead
        // `{ label: 'Dimension' }` row with no action and no accelerator, which
        // is *why* Ctrl+Shift+H did nothing: `ui/menu_hotkeys.ts` dispatches the
        // `shortcut` on a menu row, so a tool with no row has no key.
        {
          label: _('Draw Dimensions'),
          icon: 'drawAlignedDimension',
          disabled: dis,
          submenu: [
            {
              label: _('Draw Orthogonal Dimensions'),
              icon: 'drawOrthogonalDimension',
              // The only one of the five with a `.DefaultHotkey()`
              // (`pcb_actions.cpp:301`); the other four have none upstream
              // either, so none is invented for them here.
              shortcut: 'Ctrl+Shift+H',
              action: () => h.tool('drawOrthogonalDimension'),
            },
            {
              label: _('Draw Aligned Dimensions'),
              icon: 'drawAlignedDimension',
              action: () => h.tool('drawAlignedDimension'),
            },
            {
              label: _('Draw Center Dimensions'),
              icon: 'drawCenterDimension',
              action: () => h.tool('drawCenterDimension'),
            },
            {
              label: _('Draw Radial Dimensions'),
              icon: 'drawRadialDimension',
              action: () => h.tool('drawRadialDimension'),
            },
            {
              label: _('Draw Leaders'),
              icon: 'drawLeader',
              action: () => h.tool('drawLeader'),
            },
          ],
        },
        { sep: true },
        // `:322-324` — the two tables PCB_ACTIONS drops onto the board.
        // `pcb_actions.cpp`: neither action has an `.Icon()`.
        {
          label: 'Add Board Characteristics',
          action: () => h.tool('placeCharacteristics'),
        },
        { label: 'Add Stackup Table', action: () => h.tool('placeStackup') },
        { sep: true },
        // `menubar_pcb_editor.cpp:333-336`, in this order: the two setters each
        // followed by their reset.
        {
          label: _('Drill/Place File Origin'),
          disabled: dis,
          action: () => h.tool('drillOrigin'),
        },
        {
          label: 'Reset Drill Origin',
          disabled: dis,
          action: () => h.action('drillResetOrigin'),
        },
        { label: _('Grid Origin'), disabled: dis, action: () => h.tool('gridSetOrigin') },
        {
          label: 'Reset Grid Origin',
          disabled: dis,
          action: () => h.action('gridResetOrigin'),
        },
        { sep: true },
        {
          label: _('Auto-Place Footprints'),
          submenu: [
            { label: _('Place Off-Board Footprints'), action: () => h.action('autoplaceOffboard') },
            { label: _('Place Selected Footprints'), action: () => h.action('autoplaceSelected') },
          ],
        },
      ],
    },
    {
      label: _('Route'),
      // `menubar_pcb_editor.cpp:352-368`. The labels are the FriendlyNames:
      // "Route Single Track", not "Single Track".
      items: [
        { label: _('Set Layer Pair...'), action: () => h.action('selectLayerPair') },
        { sep: true },
        // Live in the toolbar and greyed here, which is the state this whole
        // pass exists to end.
        {
          label: _('Route Single Track'),
          icon: 'routeSingleTrack',
          shortcut: 'X',
          action: () => h.tool('routeSingleTrack'),
        },
        {
          label: _('Route Differential Pair'),
          icon: 'routeDiffPair',
          // `PCB_ACTIONS::routeDiffPair`, `.DefaultHotkey( '6' )` (pcb_actions.cpp:2563).
          shortcut: '6',
          action: () => h.tool('routeDiffPair'),
        },
        { sep: true },
        { label: _('Tune Length of a Single Track'), disabled: dis },
        { label: _('Tune Length of a Differential Pair'), disabled: dis },
        { label: _('Tune Skew of a Differential Pair'), disabled: dis },
        { sep: true },
        {
          label: _('Interactive Router Settings...'),
          action: () => h.action('routerSettingsDialog'),
        },
      ],
    },
    {
      label: _('Inspect'),
      // `menubar_pcb_editor.cpp:371-388`. Upstream's FriendlyNames carry no
      // ellipsis on the two resolution rows, and Board Statistics is "Show
      // Board Statistics".
      items: [
        { label: _('Show Board Statistics'), action: () => h.action('boardStatistics') },
        {
          label: _('Measure Tool'),
          icon: 'measureTool',
          shortcut: 'Ctrl+Shift+M',
          action: () => h.tool('measureTool'),
        },
        { sep: true },
        // `PCB_ACTIONS::runDRC` — the toolbar has opened this dialog all along.
        { label: _('Design Rules Checker'), icon: 'runDRC', action: () => h.action('runDRC') },
        { label: _('Previous Marker'), disabled: dis },
        { label: _('Next Marker'), disabled: dis },
        { label: _('Exclude Marker'), disabled: dis },
        { sep: true },
        // PCB_ACTIONS::inspectClearance / inspectConstraints: no enable
        // condition upstream; with the wrong selection the tool picks, or
        // says why in the infobar.
        { label: _('Clearance Resolution'), action: () => h.action('inspectClearance') },
        { label: _('Constraints Resolution'), action: () => h.action('inspectConstraints') },
        {
          label: _('Show Footprint Associations'),
          disabled: dis,
          action: () => h.action('showFootprintAssociations'),
        },
        { label: _('Compare Footprint with Library'), disabled: dis },
      ],
    },
    {
      label: _('Tools'),
      /*
       * `menubar_pcb_editor.cpp:391-459`.
       *
       * Two blocks are left out because upstream leaves them out too unless an
       * advanced-config flag is set, and a stock KiCad shows neither: the
       * generators rows (`m_EnableGenerators`, `:411-417`) and the design-block
       * panel row in View. The Scripting Console (`:432-436`) is inside
       * `SCRIPTING::IsWxAvailable()` and is removed rather than greyed — there
       * is no Python here and there will not be one.
       *
       * "Reveal Plugin Folder in Finder" goes with it: a folder on a disk.
       */
      items: [
        {
          label: _('Update PCB from Schematic...'),
          icon: 'updatePcbFromSchematic',
          action: () => h.action('updatePcbFromSchematic'),
          disabled: !st.hasSchematic,
          shortcut: 'F8',
        },
        {
          label: _('Switch to Schematic Editor'),
          icon: 'showEeschema',
          action: () => h.action('showEeschema'),
          disabled: !st.hasSchematic,
        },
        // `ACTIONS::showProjectManager`, added only when NOT standalone — which
        // is always, here. Leaving the board editor goes back to the project.
        { label: _('Switch to Project Manager'), action: () => h.action('showProjectManager') },
        { label: _('Calculator Tools'), disabled: dis },
        { sep: true },
        { label: _('DRC Rule Editor'), disabled: dis },
        { sep: true },
        {
          label: _('Footprint Editor'),
          icon: 'showFootprintEditor',
          action: () => h.action('showFootprintEditor'),
          disabled: !st.hasFootprintEditor,
        },
        {
          label: _('Update Footprints from Library...'),
          action: () => h.action('updateFootprints'),
        },
        {
          label: _('Migrate 3D Models...'),
          icon: 'migrate3DModels',
          action: () => h.action('migrate3DModels'),
        },
        { sep: true },
        {
          label: _('Zone Manager...'),
          icon: 'zonesManager',
          action: () => h.action('zonesManager'),
        },
        { sep: true },
        { label: _('Cleanup Tracks & Vias...'), action: () => h.action('cleanupTracksAndVias') },
        { label: _('Remove Unused Pads...'), action: () => h.action('removeUnusedPads') },
        { label: _('Cleanup Graphics...'), action: () => h.action('cleanupGraphics') },
        { label: _('Repair Board'), disabled: dis },
        { sep: true },
        { label: _('Collect And Embed 3D Models'), disabled: dis },
        { sep: true },
        { label: _('Geographical Reannotate...'), action: () => h.action('boardReannotate') },
        { label: _('Update Schematic from PCB...'), disabled: dis },
        {
          label: _('Multi-Channel'),
          submenu: [
            {
              label: _('Generate Placement Rule Areas...'),
              icon: 'generatePlacementRuleAreas',
              action: () => h.action('generatePlacementRuleAreas'),
            },
            {
              label: _('Repeat Layout...'),
              icon: 'repeatLayout',
              action: () => h.action('repeatLayout'),
            },
          ],
        },
        { sep: true },
        {
          label: _('External Plugins'),
          submenu: [{ label: _('Refresh Plugins'), disabled: dis }],
        },
      ],
    },
    {
      label: _('Preferences'),
      /*
       * `menubar_pcb_editor.cpp:346-356` — the rows, in order:
       *
       *     configurePaths, showFootprintLibTable, showDesignBlockLibTable,
       *     openPreferences, a separator, then AddMenuLanguageList.
       *
       * This frame had only Preferences..., which is why the board editor's
       * menu was three rows short of every other launcher here — the schematic,
       * symbol, footprint, Gerber and project frames all build the full one.
       *
       * No Configure Paths: it edits the environment substitutions a library
       * path is written against, and there is no disk to point at. See the
       * other five menus for the same note.
       */
      items: [
        // `ACTIONS::showFootprintLibTable` — FP_LIB_TABLE is the board's own
        // business: every footprint on it is stored as `nickname:name`, and
        // this is where a nickname the project references is seen and fixed.
        {
          label: _('Manage Footprint Libraries...'),
          icon: 'library_table',
          action: () => h.action('showFootprintLibTable'),
        },
        // `ACTIONS::showDesignBlockLibTable`, inside `m_EnablePcbDesignBlocks`. The
        // Design Blocks pane is built; PANEL_DESIGN_BLOCK_LIB_TABLE is not, so the
        // row is greyed rather than removed: it is unfinished, not impossible.
        { label: _('Manage Design Block Libraries...'), icon: 'library_table', disabled: true },
        {
          label: _('Preferences...'),
          action: () => h.action('openPreferences'),
          shortcut: 'Ctrl+,',
        },
        { sep: true },
        // `AddMenuLanguageList( prefsMenu, selTool )`, the shared submenu five
        // other frames here already build.
        setLanguageMenuItem({ current: h.language, onSelect: h.onSelectLanguage }),
      ],
    },
    standardHelpMenu({ showHotkeys: h.showHotkeys, showAbout: h.showAbout }),
  ];
}
