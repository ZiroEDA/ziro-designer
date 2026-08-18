// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The launcher's menu bar (upstream counterpart: kicad/menubar.cpp,
 * KICAD_MANAGER_FRAME::doReCreateMenuBar, transcribed from the 10.0 branch).
 * Item order, grouping, hotkeys and wording follow upstream exactly; items
 * whose subsystem does not exist yet are present but disabled, and
 * desktop-only items are reinterpreted for the web (see the notes inline).
 */

import type { Menu, MenuItem } from '../ui/menu_types.js';
import { standardHelpMenu } from '../ui/help_menu.js';
import { DEFAULT_FILE_HISTORY_SIZE, openRecentMenuItem } from '../ui/file_history.js';
import { setLanguageMenuItem } from '../ui/language_menu.js';
import type { ProjectMeta } from './projectStore.js';
import type { DemoMeta } from './demos.js';

const SEP: MenuItem = { sep: true };

export interface ManagerMenuHandlers {
  newProject: () => void;
  openProject: () => void;
  selectProjectFiles: () => void; // web-only fallback for blocked folder pickers
  openRecent: (id: string) => void;
  clearRecent: () => void;
  /** COMMON_SETTINGS system.language, the stored LANGUAGE_DESCR::m_Lang_Label. */
  language: string;
  /** AddMenuLanguageList's handler; PGM_BASE::SetLanguageIdentifier upstream. */
  setLanguage: (label: string) => void;
  /**
   * COMMON_SETTINGS system.file_history_size — how many rows Open Recent shows.
   * KICAD_MANAGER_FRAME's FILE_HISTORY is capped by it like every other frame's
   * (eda_base_frame.cpp:1282-1286); ours listed every stored project.
   */
  fileHistorySize?: number;
  closeProject: () => void;
  saveAs: () => void;
  archiveProject: () => void;
  unarchiveProject: () => void;
  refresh: () => void;
  /** KICAD_MANAGER_ACTIONS::showLocalHistory, a CHECK item. */
  toggleLocalHistory: () => void;
  localHistoryShown: boolean;
  openTextViewer: () => void; // reinterprets "Open Text Editor"
  editSchematic: () => void;
  editSymbols: () => void;
  editPcb: () => void;
  editFootprints: () => void;
  openImageConverter: () => void;
  openGerberViewer: () => void;
  openCalculator: () => void;
  openDrawingSheetEditor: () => void;
  openPreferences: () => void;
  showAbout: () => void;
  /** ACTIONS::listHotKeys. */
  showHotkeys: () => void;
  openDemo: (id: string) => void;
  hasProject: boolean;
  hasTextFileSelected: boolean;
  recent: readonly ProjectMeta[];
  demos: readonly DemoMeta[];
}

/** kicad/menubar.cpp: the Import Non-KiCad Project submenu, verbatim.
 * All disabled until the corresponding importer engines exist. */
const IMPORT_SUBMENU: MenuItem[] = [
  { label: 'Altium Project…', disabled: true },
  { label: 'CADSTAR Project…', disabled: true },
  { label: 'EAGLE Project…', disabled: true },
  { label: 'EasyEDA (JLCEDA) Std Backup…', disabled: true },
  { label: 'EasyEDA (JLCEDA) Pro Project…', disabled: true },
  { label: 'PADS Project…', disabled: true },
  { label: 'gEDA / Lepton EDA Project…', disabled: true },
];

/** The bundled demos as a submenu; simulation examples group under their own
 * flyout so the list stays scannable (32 demos ship today). */
function buildDemoSubmenu(h: ManagerMenuHandlers): MenuItem[] {
  if (h.demos.length === 0) return [{ label: '(no demos bundled)', disabled: true }];
  const entry = (d: DemoMeta): MenuItem => ({ label: d.title, action: () => h.openDemo(d.id) });
  const sims = h.demos.filter((d) => d.id.startsWith('simulation/'));
  const rest = h.demos.filter((d) => !d.id.startsWith('simulation/'));
  const items: MenuItem[] = rest.map(entry);
  if (sims.length > 0) items.push({ label: 'Simulation', submenu: sims.map(entry) });
  return items;
}

export function buildManagerMenus(h: ManagerMenuHandlers): Menu[] {
  // File > Open Recent, KiCad's FILE_HISTORY menu, fed from our project store.
  // The submenu itself is the shared ui/file_history.ts port, so the greyed-out
  // parent row and the "No Files" placeholder are the same here as in every
  // other frame; this file used to invent a "(no recent projects)" child.
  // kicad/menubar.cpp:64 is the one frame that overrides m_clearText.
  const shown = h.recent.slice(0, h.fileHistorySize ?? DEFAULT_FILE_HISTORY_SIZE);
  const openRecentItem = openRecentMenuItem({
    files: shown,
    onOpen: (i) => {
      const project = shown[i];
      if (project) h.openRecent(project.id);
    },
    onClear: () => h.clearRecent(),
    clearText: 'Clear Recent Projects',
  });

  return [
    {
      label: 'File',
      items: [
        // KICAD_MANAGER_ACTIONS::newProject is .DefaultHotkey( MD_CTRL + 'N' ),
        // which a browser will not give up - Ctrl+N is its new window, handled
        // before the page sees the key. BROWSER_REBINDS in ui/browser_hotkeys.ts
        // holds the substitution and the reasoning.
        { label: 'New Project…', shortcut: 'Ctrl+Alt+N', action: h.newProject },
        // "Clone Project from Repository…" is git-gated upstream and hidden
        // when git is off, omitted until version control lands.
        // Upstream shows this only when the stock demos path exists; ours
        // lists the bundled demos as a submenu (the web take on its picker).
        {
          label: 'Open Demo Project',
          submenu: buildDemoSubmenu(h),
        },
        { label: 'Open Project…', icon: 'open', shortcut: 'Ctrl+O', action: h.openProject },
        // Web-only: fallback when the browser blocks the folder picker.
        { label: 'Select Project Files…', action: h.selectProjectFiles },
        openRecentItem,
        SEP,
        { label: 'New Jobset File…', disabled: true }, // jobs system not yet built
        { label: 'Open Jobset File…', disabled: true },
        SEP,
        { label: 'Close Project', action: h.closeProject, disabled: !h.hasProject },
        SEP,
        // Upstream disables this when no local history exists; ours is
        // disabled until the snapshot subsystem lands (tracked issue).
        { label: 'Restore Project from Local History…', disabled: true },
        SEP,
        { label: 'Save As…', shortcut: 'Shift+Ctrl+S', action: h.saveAs, disabled: !h.hasProject },
        SEP,
        { label: 'Import Non-KiCad Project…', submenu: IMPORT_SUBMENU },
        SEP,
        { label: 'Archive Project…', action: h.archiveProject, disabled: !h.hasProject },
        { label: 'Unarchive Project…', action: h.unarchiveProject },
        // "Quit" is not applicable in a browser tab.
      ],
    },
    {
      /**
       * All three are permanently greyed out, which is what upstream does and
       * not an oversight.
       *
       * kicad/menubar.cpp adds them with a comment saying why they are there:
       *
       *     // While we don't presently use these, they need to be here so that
       *     // cut/copy/paste work in things like search boxes in file open
       *     // dialogs.
       *     editMenu->Add( ACTIONS::cut );
       *     editMenu->Add( ACTIONS::copy );
       *     editMenu->Add( ACTIONS::paste );
       *
       * and kicad_manager_frame.cpp then disables all three outright:
       *
       *     #define ENABLE( x ) ACTION_CONDITIONS().Enable( x )
       *     ...
       *     // These are just here for text boxes, search boxes, etc. in places
       *     // such as the standard file dialogs.
       *     manager->SetConditions( ACTIONS::cut,   ENABLE( SELECTION_CONDITIONS::ShowNever ) );
       *     manager->SetConditions( ACTIONS::copy,  ENABLE( SELECTION_CONDITIONS::ShowNever ) );
       *     manager->SetConditions( ACTIONS::paste, ENABLE( SELECTION_CONDITIONS::ShowNever ) );
       *
       * `ShowNever` is `return false`, so the enable condition never holds. The
       * project manager has no selection to cut and nowhere to paste to; the
       * entries exist so the accelerators are registered, because
       * `ACTIONS::cut` carries `.UIId( wxID_CUT )` and wxWidgets routes that
       * standard id to whichever text control has focus. The menu row itself is
       * never meant to be clicked.
       *
       * Ours ran `document.execCommand('cut' | 'copy' | 'paste')`, which was
       * both wrong and dead. Wrong, because it made three rows look like
       * commands the project manager offers. Dead, because by the time a menu
       * click lands the field that held the selection has lost it, and because
       * no browser has permitted `execCommand('paste')` from page script for
       * years - it fails silently and returns false.
       *
       * A browser needs no help with the *keys*: Ctrl+X/C/V in a focused input
       * are handled by the browser itself, and nothing here intercepts them. So
       * the entries carry exactly what upstream's carry - a label, an
       * accelerator, and no way to invoke them.
       */
      label: 'Edit',
      items: [
        { label: 'Cut', shortcut: 'Ctrl+X', disabled: true },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: true },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: true },
      ],
    },
    {
      label: 'View',
      items: [
        {
          // panelsMenu->Add( KICAD_MANAGER_ACTIONS::showLocalHistory,
          //                  ACTION_MENU::CHECK );
          // A check item, so the row shows whether the pane is up.
          label: 'Panels',
          submenu: [
            {
              label: 'Local History',
              checked: h.localHistoryShown,
              action: h.toggleLocalHistory,
            },
          ],
        },
        SEP,
        // ACTIONS::zoomRedraw. FriendlyName "Refresh", and F5 everywhere except
        // macOS, where it is Ctrl+R:
        //     #if defined( __WXMAC__ )
        //         .DefaultHotkey( MD_CTRL + 'R' )
        //     #else
        //         .DefaultHotkey( WXK_F5 )
        //     #endif
        { label: 'Refresh', shortcut: 'F5', action: h.refresh },
        // There *is* a rule here. kicad/menubar.cpp:
        //     viewMenu->Add( ACTIONS::zoomRedraw );
        //
        //     viewMenu->AppendSeparator();
        //     viewMenu->Add( KICAD_MANAGER_ACTIONS::openTextEditor );
        //     viewMenu->Add( KICAD_MANAGER_ACTIONS::openProjectDirectory );
        // A comment here used to claim the opposite - that Refresh ran straight
        // into the next group - which is not what the source does. The two
        // groups are separate: one redraws the tree, the other leaves the app.
        SEP,
        // KICAD_MANAGER_ACTIONS::openTextEditor, "Open Text Editor", whose
        // tooltip is "Launch preferred text editor". There is no preferred
        // external editor to launch from a tab, so this opens the selected file
        // in the viewer we have - the one deliberate reinterpretation here.
        {
          label: 'Open Text Viewer',
          action: h.openTextViewer,
          disabled: !h.hasTextFileSelected,
        },
        // KICAD_MANAGER_ACTIONS::openProjectDirectory is deliberately absent.
        // Its FriendlyName is platform-conditional - "Reveal Project in Finder"
        // on macOS, "Browse Project Files" elsewhere - and both open the OS
        // file manager on the project folder. A browser tab cannot, and there
        // is no folder to open: the project lives in the file pane already on
        // screen. Carried as a permanently greyed row it would be worse than
        // absent, because upstream's is live and useful.
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Schematic Editor', shortcut: 'Ctrl+E', action: h.editSchematic },
        { label: 'Symbol Editor', shortcut: 'Ctrl+L', action: h.editSymbols },
        { label: 'PCB Editor', shortcut: 'Ctrl+P', action: h.editPcb, disabled: !h.hasProject },
        { label: 'Footprint Editor', shortcut: 'Ctrl+F', action: h.editFootprints },
        SEP,
        // These three were left disabled from before their editors existed, and
        // stayed that way after they shipped - the launcher tiles beside this
        // menu have been opening them the whole time. Upstream has all three
        // enabled and so do we now.
        { label: 'Gerber Viewer', shortcut: 'Ctrl+G', action: h.openGerberViewer },
        { label: 'Image Converter', shortcut: 'Ctrl+B', action: h.openImageConverter },
        { label: 'Calculator Tools', action: h.openCalculator },
        { label: 'Drawing Sheet Editor', shortcut: 'Ctrl+Y', action: h.openDrawingSheetEditor },
        // Upstream ends this menu with a separator and
        //     toolsMenu->Add( _( "Edit Local File..." ),
        //                     _( "Edit local file in text editor" ),
        //                     ID_EDIT_LOCAL_FILE_IN_TEXT_EDITOR, BITMAPS::editor );
        // which picks a file and hands it to the OS text editor. Dropped rather
        // than carried greyed: there is no external editor to hand a file to,
        // and View > Open Text Viewer already opens the selected file in the
        // one we have. The separator goes with it - a rule below the last row
        // is a group boundary with nothing after it.
      ],
    },
    {
      label: 'Preferences',
      items: [
        { label: 'Configure Paths…', disabled: true },
        { label: 'Manage Symbol Libraries…', disabled: true },
        { label: 'Manage Footprint Libraries…', disabled: true },
        { label: 'Manage Design Block Libraries…', disabled: true },
        { label: 'Preferences…', shortcut: 'Ctrl+,', action: h.openPreferences },
        SEP,
        setLanguageMenuItem({ current: h.language, onSelect: h.setLanguage }),
      ],
    },
    // EDA_BASE_FRAME::AddStandardHelpMenu - see ui/help_menu.ts. Shared with
    // every editor, because upstream has exactly one of these.
    standardHelpMenu({ showHotkeys: h.showHotkeys, showAbout: h.showAbout }),
  ];
}
