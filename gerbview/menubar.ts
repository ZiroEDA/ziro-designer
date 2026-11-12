// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBVIEW_FRAME::doReCreateMenuBar` (`gerbview/menubar.cpp:40-240`).
 *
 * A data module rather than JSX inside the frame, for the reason
 * `eeschema/menubar.ts` is one: `qa`'s tsconfig compiles `.ts` only,
 * so a menu built inside a `.tsx` cannot be pinned by a test.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL: KiCad's menus are SHARED, and ours were not
 * ---------------------------------------------------------------------------
 *
 * Every KiCad frame ends its menu bar with three calls into `common/`, and that
 * is the whole reason its eight launchers feel like one program:
 *
 *   EDA_BASE_FRAME::AddStandardHelpMenu   common/eda_base_frame.cpp:900-916
 *   EDA_BASE_FRAME::AddMenuLanguageList   common/eda_base_frame.cpp:2062-2090
 *   ACTION_MENU::AddQuitOrClose           common/tool/action_menu.cpp:236-252
 *
 * Fifteen frames call the first two. Every one of them closes Preferences with
 * the identical three lines —
 *
 *     prefsMenu->Add( ACTIONS::openPreferences );
 *     prefsMenu->AppendSeparator();
 *     AddMenuLanguageList( prefsMenu, tool );
 *
 * — and appends the identical seven-entry Help menu, because in each case there
 * is only one place the entries are written.
 *
 * GerbView was the one launcher here that had joined none of it. It had **no
 * Help menu at all** (the only editor without one), no language list, no
 * Preferences entry, and its menu bar read File / View / **Preferences** /
 * Tools against upstream's File / View / **Tools** / Preferences / Help
 * (`menubar.cpp:222-227`). Its "Preferences" menu held the nine display
 * toggles, which upstream puts in **View** (`:190-198`). `ABOUT_TITLES.gerbview`
 * had sat defined and unreferenced.
 *
 * So the labels below are not new strings. They are `ACTIONS::` and
 * `GERBVIEW_ACTIONS::` FriendlyNames, and the Help and language rows come from
 * `ui/help_menu.ts` and `ui/language_menu.ts`, which are our
 * `AddStandardHelpMenu` and `AddMenuLanguageList`.
 */

import type { Menu, MenuItem } from '@ziroeda/wx/menu.js';
import { addQuitOrClose } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import {
  standardHelpMenu,
  type HelpMenuToolManager,
} from '@ziroeda/common/eda_base_frame_help_menu.js';
import { setLanguageMenuItem } from '@ziroeda/common/eda_base_frame_language_menu.js';
import { _ } from '@ziroeda/wx/translation.js';

const SEP: MenuItem = { sep: true };

/** The display toggles the View menu drives, by our own toggle id. */
export type GerbviewToggleId =
  | 'toggleGrid'
  | 'togglePolar'
  | 'unitsMm'
  | 'unitsInches'
  | 'unitsMils'
  | 'flashedSketch'
  | 'linesSketch'
  | 'polygonsSketch'
  | 'showDcodes'
  | 'showNegativeObjects'
  | 'forceOpacityMode'
  | 'xorMode'
  | 'highContrast'
  | 'flipView'
  | 'showLayerManager';

export interface GerbviewMenuHandlers {
  /**
   * The frame's TOOL_MANAGER, where COMMON_CONTROL answers Preferences... and
   * the Help menu (`gerbview_frame.cpp:1092`).
   */
  toolManager: HelpMenuToolManager;

  /** GERBVIEW_ACTIONS::openAutodetected — one dialog, any of the four types. */
  openAutodetected: () => void;
  openGerber: () => void;
  openDrillFile: () => void;
  openJobFile: () => void;
  openZipFile: () => void;
  clearAllLayers: () => void;
  reloadAllLayers: () => void;
  exportToPcbnew: () => void;
  print: () => void;
  /** ACTION_MENU::AddQuitOrClose's target. */
  quit: () => void;

  zoomInCenter: () => void;
  zoomOutCenter: () => void;
  zoomFitScreen: () => void;
  /** ACTIONS::zoomTool - arms the shared ZOOM_TOOL. */
  zoomTool: () => void;
  zoomRedraw: () => void;

  /** One of the View menu's CHECK rows was picked. */
  toggle: (id: GerbviewToggleId) => void;
  /** Which of those rows currently carry a checkmark. */
  checked: ReadonlySet<string>;

  showDCodes: () => void;
  measureTool: () => void;
  clearLayer: () => void;

  language: string;
  onSelectLanguage: (label: string) => void;
}

/**
 * `viewMenu->Add( action, ACTION_MENU::CHECK )` — a checkable row. The label is
 * the action's FriendlyName and the tooltip its Tooltip, both verbatim.
 */
function check(
  h: GerbviewMenuHandlers,
  id: GerbviewToggleId,
  label: string,
  extra: Partial<MenuItem> = {},
): MenuItem {
  return {
    label,
    checked: h.checked.has(id),
    action: () => h.toggle(id),
    ...extra,
  };
}

/**
 * The File menu, `menubar.cpp:47-158`.
 *
 * Each of the four openers is followed by its own "Open Recent" submenu, and
 * each of those is wrapped in
 *
 *     #define FileHistoryCond( x ) ACTION_CONDITIONS().Enable( FILE_HISTORY::FileHistoryNotEmpty( x ) )
 *
 * so an empty history greys the submenu rather than hiding it (`:78-80` and
 * the three that follow). We hold no history yet, so all four are greyed —
 * which is exactly what a first-run GerbView shows.
 */
function fileMenu(h: GerbviewMenuHandlers): Menu {
  // No `icon`: menus draw no bitmap (see MenuBar.tsx), and the field's only
  // live use is as an identity key in `ui/hotkeys_inventory.ts`, which these
  // rows do not need because they carry no hotkey. Naming a bitmap we do not
  // ship would only imply we do.
  const recent = (label: string): MenuItem => ({ label, disabled: true, submenu: [] });

  return {
    label: _('File'),
    items: [
      {
        label: _('Open Autodetected File(s)...'),
        icon: 'gerbOpen',
        tooltip: _('Open Autodetected file(s) on a new layer.'),
        action: h.openAutodetected,
        shortcut: 'Ctrl+O',
      },
      {
        label: _('Open Gerber Plot File(s)...'),
        icon: 'gerbOpen',
        tooltip: _('Open Gerber plot file(s) on a new layer.'),
        action: h.openGerber,
      },
      recent(_('Open Recent Gerber File')),
      {
        label: _('Open Excellon Drill File(s)...'),
        icon: 'gerbOpenDrill',
        tooltip: _('Open Excellon drill file(s) on a new layer.'),
        action: h.openDrillFile,
      },
      recent(_('Open Recent Drill File')),
      {
        label: _('Open Gerber Job File...'),
        icon: 'gerbOpenJob',
        tooltip: _('Open a Gerber job file and its associated gerber plot files'),
        action: h.openJobFile,
      },
      recent(_('Open Recent Job File')),
      {
        label: _('Open Zip Archive File...'),
        icon: 'gerbOpenZip',
        tooltip: _('Open a zipped archive (Gerber and Drill) file'),
        action: h.openZipFile,
      },
      recent(_('Open Recent Zip File')),
      SEP,
      { label: _('Clear All Layers'), icon: 'gerbClear', action: h.clearAllLayers },
      { label: _('Reload All Layers'), icon: 'gerbReload', action: h.reloadAllLayers },
      SEP,
      {
        label: _('Export to PCB Editor...'),
        icon: 'gerbExportToPcb',
        tooltip: _('Export data as a KiCad PCB file'),
        action: h.exportToPcbnew,
      },
      SEP,
      { label: _('Print...'), icon: 'print', action: h.print, shortcut: 'Ctrl+P' },
      SEP,
      addQuitOrClose(_('Gerber Viewer'), h.quit),
    ],
  };
}

/**
 * The View menu, `menubar.cpp:160-200`. Nine of its rows are the display
 * toggles our menu bar had filed under "Preferences", where upstream has no
 * such thing.
 */
function viewMenu(h: GerbviewMenuHandlers): Menu {
  return {
    label: _('View'),
    items: [
      { label: 'Zoom In', icon: 'zoomIn', action: h.zoomInCenter },
      { label: 'Zoom Out', icon: 'zoomOut', action: h.zoomOutCenter },
      {
        label: _('Zoom to Fit'),
        icon: 'zoomFit',
        action: h.zoomFitScreen,
        shortcut: 'Home',
        tooltip: _('Zoom to worksheet area if exists or edited object'),
      },
      {
        label: _('Zoom to Selection Area'),
        icon: 'zoomTool',
        action: h.zoomTool,
        shortcut: 'Ctrl+F5',
        tooltip: _('Zoom to an area selection created by a mouse drag'),
      },
      { label: _('Refresh'), icon: 'zoomRedraw', action: h.zoomRedraw, shortcut: 'F5' },
      SEP,
      check(h, 'toggleGrid', _('Show Grid'), {
        icon: 'toggleGrid',
        tooltip: _('Display background grid in the edit window'),
      }),
      check(h, 'togglePolar', _('Polar Coordinates'), {
        icon: 'gerbTogglePolar',
        tooltip: _('Switch between polar and cartesian coordinate systems'),
      }),
      {
        // `unitsSubMenu->SetTitle( _( "&Units" ) )` (`menubar.cpp:180`).
        label: 'Units',
        mnemonic: 'U',
        icon: 'unitsMm',
        submenu: [
          check(h, 'unitsInches', 'Inches', { icon: 'unitsInches' }),
          check(h, 'unitsMils', 'Mils', { icon: 'unitsMils' }),
          check(h, 'unitsMm', 'Millimeters', { icon: 'unitsMm' }),
        ],
      },
      SEP,
      check(h, 'flashedSketch', _('Sketch Flashed Items'), {
        icon: 'gerbFlashedSketch',
        shortcut: 'F',
        tooltip: _('Show flashed items in outline mode'),
      }),
      check(h, 'linesSketch', _('Sketch Lines'), {
        icon: 'gerbLinesSketch',
        shortcut: 'L',
        tooltip: _('Show lines in outline mode'),
      }),
      check(h, 'polygonsSketch', _('Sketch Polygons'), {
        icon: 'gerbPolygonsSketch',
        shortcut: 'P',
        tooltip: _('Show polygons in outline mode'),
      }),
      check(h, 'showDcodes', _('Show DCodes'), {
        icon: 'gerbShowDcodes',
        shortcut: 'D',
        tooltip: _('Show dcode numbers'),
      }),
      check(h, 'showNegativeObjects', _('Ghost Negative Objects'), {
        icon: 'gerbNegativeObjects',
        tooltip: _('Show negative objects in ghost color'),
      }),
      // GERBVIEW_ACTIONS::toggleForceOpacityMode, live since the renderer
      // stopped compositing at a permanent 0.8 and started drawing opaque:
      // `GerberRenderOptions.layerOpacity` is 1 unless this is checked, and
      // then it is `m_Display.m_OpacityModeAlphaValue`, the alpha
      // `GERBVIEW_RENDER_SETTINGS::LoadColors` pushes into every gerber
      // layer's COLOR4D (`gerbview_painter.cpp:63-66`). The value is the
      // `Forced opacity:` spin control on Preferences > Gerber Viewer >
      // Display Options.
      check(h, 'forceOpacityMode', _('Show with Forced Opacity Mode'), {
        icon: 'gerbDiffMode',
        tooltip: _('Show layers using opacity color forced mode'),
      }),
      check(h, 'xorMode', _('Show in XOR Mode'), {
        icon: 'gerbDiffMode',
        tooltip: _('Show layers in exclusive-or compare mode'),
      }),
      check(h, 'highContrast', _('Inactive Layer View Mode'), {
        icon: 'gerbHighContrast',
        tooltip: _('Toggle inactive layers between normal and dimmed'),
      }),
      check(h, 'flipView', _('Flip Gerber View'), {
        icon: 'gerbFlipView',
        tooltip: _('Show as mirror image'),
      }),
      SEP,
      check(h, 'showLayerManager', _('Show Layers Manager'), { icon: 'gerbLayerManager' }),
    ],
  };
}

/**
 * The Tools menu, `menubar.cpp:203-208`. Note there is no separator between
 * Show Source and Measure Tool upstream, and one before Clear Current Layer.
 */
function toolsMenu(h: GerbviewMenuHandlers): Menu {
  return {
    label: _('Tools'),
    items: [
      {
        label: _('List DCodes...'),
        icon: 'gerbDcodeList',
        tooltip: _('List D-codes defined in Gerber files'),
        action: h.showDCodes,
      },
      // GERBVIEW_ACTIONS::showSource shells out to the user's text editor -
      // `Pgm().GetTextEditor()`, then ExecuteFile on the layer's own file
      // (`tools/gerbview_inspection_tool.cpp:154-190`). A browser tab has no
      // text editor to hand a path to, so this is greyed in its upstream
      // position rather than replaced with something upstream does not do.
      {
        label: _('Show Source...'),
        disabled: true,
        tooltip: _('Show source file for the current layer'),
      },
      {
        label: _('Measure Tool'),
        icon: 'measureTool',
        action: h.measureTool,
        shortcut: 'Ctrl+Shift+M',
        tooltip: _('Interactively measure distance between points'),
      },
      SEP,
      { label: _('Clear Current Layer...'), action: h.clearLayer },
    ],
  };
}

/**
 * The Preferences menu, `menubar.cpp:210-214` — the same three lines every
 * other frame ends with. GerbView does put a separator between the two, unlike
 * pl_editor.
 */
function preferencesMenu(h: GerbviewMenuHandlers): Menu {
  return {
    label: _('Preferences'),
    items: [
      {
        label: _('Preferences...'),
        icon: 'preferences',
        shortcut: 'Ctrl+,',
        tooltip: _('Show preferences for all open tools'),
        action: () => h.toolManager.RunAction(ACTIONS.openPreferences),
      },
      SEP,
      setLanguageMenuItem({ current: h.language, onSelect: h.onSelectLanguage }),
    ],
  };
}

/**
 * The whole bar, in `menuBar->Append` order (`menubar.cpp:222-227`):
 * File, View, Tools, Preferences, then AddStandardHelpMenu.
 */
export function gerbviewMenus(h: GerbviewMenuHandlers): Menu[] {
  return [
    fileMenu(h),
    viewMenu(h),
    toolsMenu(h),
    preferencesMenu(h),
    standardHelpMenu(h.toolManager),
  ];
}
