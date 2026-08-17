// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every command the app has, collected the way DIALOG_LIST_HOTKEYS collects
 * KiCad's - from the things that define them, not from a list somebody typed.
 *
 * Upstream asks the manager's ACTION_MANAGER for its actions and then each
 * kiface in turn, so its Hotkey List is every TOOL_ACTION that exists: 809 of
 * them in 10.0.5, of which 276 declare a DefaultHotkey and the rest show an
 * empty Hotkey cell. There is no registry here to ask, but there are the
 * modules that *are* our registry - the menu builders and the toolbar tables -
 * and those are plain data with type-only imports, so they can be read without
 * dragging an editor into the project manager's bundle.
 *
 * What each source contributes:
 *
 *   menu builders    the command's name and its accelerator (MenuItem.shortcut)
 *   toolbar tables   the command's name and its description (ToolButton.title,
 *                    which is the tooltip, and so is upstream's GetDescription)
 *   TOOL_HOTKEYS     eeschema's single-key tool bindings, which live in a map
 *                    of their own rather than in the menu
 *
 * A command reached by both a menu and a toolbar is one row: the menu supplies
 * the accelerator, the toolbar the description. That merge is by name, which is
 * the only key the two sides share.
 *
 * This replaced a hand-written table of 61 rows. The number is worth recording
 * because it is the reason the table was wrong rather than merely incomplete: a
 * transcription cannot be kept honest, and this one had drifted from the menus
 * it claimed to describe within a day of being written.
 */
import type { Menu, MenuItem } from './menu_types.js';
import type { ToolEntry } from './toolbar_types.js';
import { buildManagerMenus } from '../home/menubar.js';
import { TOOL_HOTKEYS, buildMenus as buildSchMenus } from '../editors/schematic/menubar.js';
import {
  TOP_TOOLBAR,
  LEFT_TOOLBAR,
  RIGHT_TOOLBAR,
} from '../editors/schematic/toolbars_sch_editor.js';
import {
  PCB_TOP_TOOLBAR,
  PCB_LEFT_TOOLBAR,
  PCB_RIGHT_TOOLBAR,
} from '../editors/pcb/pcbToolbars.js';
import { VIEWER3D_TOP_TOOLBAR } from '../editors/pcb/viewer3dToolbars.js';
import { buildViewer3DMenus } from '../editors/pcb/viewer3dMenus.js';
import {
  SYM_TOP_TOOLBAR,
  SYM_LEFT_TOOLBAR,
  SYM_RIGHT_TOOLBAR,
} from '../editors/symbol/symbolToolbars.js';
import {
  FP_TOP_TOOLBAR,
  FP_LEFT_TOOLBAR,
  FP_RIGHT_TOOLBAR,
} from '../editors/footprint/footprintToolbars.js';
import {
  GBR_TOP_TOOLBAR,
  GBR_LEFT_TOOLBAR,
  GBR_RIGHT_TOOLBAR,
} from '../editors/gerbview/gerberToolbars.js';
import {
  DS_TOP_TOOLBAR,
  DS_LEFT_TOOLBAR,
  DS_RIGHT_TOOLBAR,
} from '../editors/drawingsheet/drawingSheetToolbars.js';

export interface HotkeyEntry {
  /** GetFriendlyName(), with the ellipsis stripped as updateFromClientData does. */
  command: string;
  /** The primary accelerator, or '' where the command has none. */
  keys: string;
  /** m_EditKeycodeAlt. Nothing here binds a second key yet, so always ''. */
  alt: string;
  /** GetDescription(), flattened to one line. */
  description: string;
}

export interface HotkeySection {
  /** GetSectionName( action ) - what the tree row says. */
  name: string;
  entries: HotkeyEntry[];
}

/**
 * HOTKEY_STORE::Init walks a `std::map<std::string, HOTKEY>` keyed by the
 * action's *name*, so it is sorted by that key, and a section is created the
 * first time a new app prefix appears in that walk. The section order is
 * therefore the app prefixes in ASCII order:
 *
 *     3DViewer  common  eeschema  gerbview  kicad  pcbnew  plEditor
 *
 * which is why a real Hotkey List reads 3D Viewer, Common, Schematic Editor,
 * Gerber Viewer, Project Manager, PCB Editor, Drawing Sheet Editor - not
 * alphabetically by the names shown, and not in the order the editors appear
 * anywhere else. Gestures is appended after the loop, so it is always last.
 *
 * The symbol and footprint editors get no section of their own: their actions
 * are named `eeschema.*` and `pcbnew.*`, so they fold into those two.
 */
const APP_ORDER = [
  '3DViewer',
  'common',
  'eeschema',
  'gerbview',
  'kicad',
  'pcbnew',
  'plEditor',
] as const;
type AppKey = (typeof APP_ORDER)[number];

/** HOTKEY_STORE::GetSectionName's s_AppNames, verbatim. */
const SECTION_NAMES: Record<AppKey, string> = {
  '3DViewer': '3D Viewer',
  common: 'Common',
  eeschema: 'Schematic Editor',
  gerbview: 'Gerber Viewer',
  kicad: 'Project Manager',
  pcbnew: 'PCB Editor',
  plEditor: 'Drawing Sheet Editor',
};

/**
 * updateFromClientData:
 *
 *     label.Replace( wxT( "..." ), wxEmptyString );
 *     label.Replace( wxT( "…" ), wxEmptyString );
 *
 * so "Open Project…" is listed as "Open Project". The row is a command, not a
 * menu entry, and the ellipsis is a menu convention meaning "this one asks you
 * something first".
 */
const stripEllipsis = (s: string): string => s.replace(/\.\.\.|…/g, '').trim();

/**
 * A parenthesised label is this app's empty-state text - "(no recent projects)",
 * "(no demos bundled)" - not a command. Upstream has no equivalent because its
 * menus are built from actions and an empty FILE_HISTORY simply has no rows.
 */
const isPlaceholder = (label: string): boolean => /^\(.*\)$/.test(label.trim());

/** Every leaf item of a built menu, submenus included. */
function walkMenus(menus: readonly Menu[]): MenuItem[] {
  const out: MenuItem[] = [];
  const walk = (items: readonly MenuItem[]): void => {
    for (const it of items) {
      if (it.submenu) walk(it.submenu);
      else if (it.label && !it.sep && !isPlaceholder(it.label)) out.push(it);
    }
  };
  for (const m of menus) walk(m.items);
  return out;
}

/** Every button of a toolbar, including the ones inside an ACTION_GROUP. */
function walkToolbar(entries: readonly ToolEntry[]): { title: string; id: string }[] {
  const out: { title: string; id: string }[] = [];
  for (const e of entries) {
    if (e === 'sep') continue;
    if ('group' in e) {
      for (const a of e.actions) out.push({ title: a.title, id: a.id });
    } else if ('title' in e && 'icon' in e) {
      out.push({ title: e.title, id: e.id });
    }
  }
  return out;
}

/** A no-op stands in for every handler: the builders are being read, not run. */
const noop = (): void => undefined;

function managerItems(): MenuItem[] {
  return walkMenus(
    buildManagerMenus({
      newProject: noop,
      openProject: noop,
      selectProjectFiles: noop,
      openRecent: noop,
      clearRecent: noop,
      closeProject: noop,
      saveAs: noop,
      archiveProject: noop,
      unarchiveProject: noop,
      refresh: noop,
      openTextViewer: noop,
      editSchematic: noop,
      editSymbols: noop,
      editPcb: noop,
      editFootprints: noop,
      openImageConverter: noop,
      openGerberViewer: noop,
      openCalculator: noop,
      openDrawingSheetEditor: noop,
      openPreferences: noop,
      showAbout: noop,
      showHotkeys: noop,
      openDemo: noop,
      hasProject: true,
      hasTextFileSelected: true,
      recent: [],
      demos: [],
    }),
  );
}

/**
 * The 3D viewer's menus, which is where its accelerators are - the toolbar has
 * the buttons but no keys, so reading only that left every 3D Viewer row
 * blank while a real KiCad lists D, P, V, S, T, F, Home and the four arrows.
 */
function viewer3dItems(): MenuItem[] {
  try {
    return walkMenus(
      buildViewer3DMenus(
        {
          grid: 'none' as never,
          ortho: false,
          showMissingModels: false,
          raytracing: false,
          showAppearanceManager: false,
        },
        new Proxy({} as Record<string, unknown>, { get: () => noop }) as never,
      ),
    );
  } catch {
    return [];
  }
}

function schematicItems(): MenuItem[] {
  // Every handler is the same no-op; the builder only stores them on the items.
  const h = new Proxy({} as Record<string, unknown>, {
    get: () => noop,
  }) as never;
  try {
    return walkMenus(buildSchMenus(h, {}));
  } catch {
    // A builder that needs more than a callable from its handlers is not worth
    // failing the whole dialog over; its toolbar entries still come through.
    return [];
  }
}

/**
 * Merge menu items and toolbar buttons into one row per *action*.
 *
 * HOTKEY_STORE::Init keys its map on `action->GetName()`, so a command reached
 * from both a menu and a toolbar is one HOTKEY with one row, however the two
 * spell its label. We have the same key: a MenuItem's `icon` and a ToolButton's
 * `id` are both the action id - `copyToClipboard3d`, `rotateXCW` - so they
 * merge on that and fall back to the label only when there is no id.
 *
 * Keying on the label instead left the 3D viewer listing "Copy 3D image to
 * clipboard" and "Copy 3D Image to Clipboard" as two commands, and "Move Board
 * Down" beside "Move down".
 *
 * When the two sides meet, the menu supplies the command name - it is the
 * friendly name, the toolbar's is a tooltip - and the toolbar supplies the
 * description, which is what fills a column that was otherwise empty.
 */
function section(
  items: readonly MenuItem[],
  toolbars: readonly { title: string; id: string }[],
  extraKeys: Readonly<Record<string, string>> = {},
): HotkeySection {
  const byKey = new Map<string, HotkeyEntry>();
  const keyOf = (id: string | undefined, label: string): string =>
    id && id !== '' ? `#${id}` : label.toLowerCase();

  const add = (
    key: string,
    command: string,
    keys: string,
    description: string,
    fromMenu: boolean,
  ): void => {
    const name = stripEllipsis(command);
    if (name === '') return;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { command: name, keys, alt: '', description });
      return;
    }
    // A menu label outranks a toolbar title as the command's name, and each
    // field is filled by whichever side has one.
    if (fromMenu) prev.command = name;
    if (prev.keys === '') prev.keys = keys;
    if (prev.description === '' && description !== '') prev.description = description;
    // A description that is just the command again says nothing, and happens
    // whenever a menu label and its toolbar tooltip are the same string.
    if (prev.description === prev.command) prev.description = '';
  };

  for (const it of items) {
    add(keyOf(it.icon, it.label ?? ''), it.label ?? '', it.shortcut ?? '', '', true);
  }
  // A ToolButton carries one string, `title`, as both its name and its tooltip.
  // Upstream's two columns come from GetFriendlyName() and GetDescription(),
  // which differ, so the title is only kept as a description where it is not
  // simply the command again.
  for (const b of toolbars) {
    const key = keyOf(b.id, b.title);
    const existing = byKey.get(key);
    add(key, b.title, extraKeys[b.id] ?? '', existing ? b.title : '', false);
  }

  return { name: '', entries: [...byKey.values()] };
}

/**
 * g_gesturePseudoActions, verbatim. HOTKEY_STORE::Init appends these as a
 * "Gestures" section after every app section, when the list is read-only - which
 * this dialog's is. They are PSEUDO_ACTIONs: things the canvas does that have no
 * TOOL_ACTION behind them, so nothing else in the app could report them.
 *
 *     new PSEUDO_ACTION( _( "Accept Autocomplete" ), WXK_RETURN, WXK_NUMPAD_ENTER ),
 *     new PSEUDO_ACTION( _( "Cancel Autocomplete" ), WXK_ESCAPE ),
 *     ...
 *
 * The second key of a PSEUDO_ACTION is its *alternate*, which is why Accept
 * Autocomplete is the one row here with the Alternate column filled.
 */
const GESTURES: HotkeyEntry[] = [
  { command: 'Accept Autocomplete', keys: 'Return', alt: 'Numpad Enter', description: '' },
  { command: 'Cancel Autocomplete', keys: 'Esc', alt: '', description: '' },
  { command: 'Toggle Checkbox', keys: 'Space', alt: '', description: '' },
  { command: 'Pan Left/Right', keys: 'Ctrl+Wheel', alt: '', description: '' },
  { command: 'Pan Up/Down', keys: 'Shift+Wheel', alt: '', description: '' },
  { command: 'Finish Drawing', keys: 'Double-click', alt: '', description: '' },
  { command: 'Add to Selection', keys: 'Shift+Click', alt: '', description: '' },
  { command: 'Highlight Net', keys: 'Ctrl+Click', alt: '', description: '' },
  { command: 'Remove from Selection', keys: 'Ctrl+Shift+Click', alt: '', description: '' },
  { command: 'Ignore Grid Snaps', keys: 'Ctrl', alt: '', description: '' },
  { command: 'Ignore Other Snaps', keys: 'Shift', alt: '', description: '' },
];

/**
 * g_standardPlatformCommands, which Init folds into the Common section:
 *
 *     #ifndef __WINDOWS__
 *         new PSEUDO_ACTION( _( "Close" ), MD_CTRL + 'W' ),
 *     #endif
 *     new PSEUDO_ACTION( _( "Quit" ), MD_CTRL + 'Q' )
 *
 * Quit is left out: a browser tab has no Quit, and Ctrl+Q belongs to the
 * browser. Close stays, because closing a project back to the manager is a
 * thing here.
 */
const PLATFORM_COMMANDS: HotkeyEntry[] = [
  { command: 'Close', keys: 'Ctrl+W', alt: '', description: '' },
];

/** The sections, in HOTKEY_STORE::Init's order, with Gestures last. */
export function buildHotkeySections(): HotkeySection[] {
  const byApp = new Map<AppKey, HotkeyEntry[]>();
  const put = (app: AppKey, entries: readonly HotkeyEntry[]): void => {
    const prev = byApp.get(app) ?? [];
    const seen = new Set(prev.map((e) => e.command));
    for (const e of entries) {
      if (seen.has(e.command)) continue;
      seen.add(e.command);
      prev.push(e);
    }
    byApp.set(app, prev);
  };

  put('common', PLATFORM_COMMANDS);
  put('kicad', section(managerItems(), []).entries);
  // The symbol editor's actions are eeschema.*, so they share eeschema's
  // section rather than getting one of their own - as they do upstream.
  put(
    'eeschema',
    section(
      schematicItems(),
      [...walkToolbar(TOP_TOOLBAR), ...walkToolbar(LEFT_TOOLBAR), ...walkToolbar(RIGHT_TOOLBAR)],
      TOOL_HOTKEYS,
    ).entries,
  );
  put(
    'eeschema',
    section(
      [],
      [
        ...walkToolbar(SYM_TOP_TOOLBAR),
        ...walkToolbar(SYM_LEFT_TOOLBAR),
        ...walkToolbar(SYM_RIGHT_TOOLBAR),
      ],
    ).entries,
  );
  // Likewise the footprint editor's are pcbnew.*.
  put(
    'pcbnew',
    section(
      [],
      [
        ...walkToolbar(PCB_TOP_TOOLBAR),
        ...walkToolbar(PCB_LEFT_TOOLBAR),
        ...walkToolbar(PCB_RIGHT_TOOLBAR),
      ],
    ).entries,
  );
  put(
    'pcbnew',
    section(
      [],
      [
        ...walkToolbar(FP_TOP_TOOLBAR),
        ...walkToolbar(FP_LEFT_TOOLBAR),
        ...walkToolbar(FP_RIGHT_TOOLBAR),
      ],
    ).entries,
  );
  put('3DViewer', section(viewer3dItems(), walkToolbar(VIEWER3D_TOP_TOOLBAR)).entries);
  put(
    'gerbview',
    section(
      [],
      [
        ...walkToolbar(GBR_TOP_TOOLBAR),
        ...walkToolbar(GBR_LEFT_TOOLBAR),
        ...walkToolbar(GBR_RIGHT_TOOLBAR),
      ],
    ).entries,
  );
  put(
    'plEditor',
    section(
      [],
      [
        ...walkToolbar(DS_TOP_TOOLBAR),
        ...walkToolbar(DS_LEFT_TOOLBAR),
        ...walkToolbar(DS_RIGHT_TOOLBAR),
      ],
    ).entries,
  );

  const out: HotkeySection[] = [];
  for (const app of APP_ORDER) {
    const entries = byApp.get(app);
    if (entries && entries.length > 0) {
      out.push({
        name: SECTION_NAMES[app],
        entries: [...entries].sort((a, b) => a.command.localeCompare(b.command)),
      });
    }
  }
  out.push({ name: 'Gestures', entries: GESTURES });
  return out;
}

/**
 * WIDGET_HOTKEY_LIST's filter, which tests the command name and the key text,
 * so searching "ctrl+z" finds Undo. The description is searched too - upstream
 * added that column and there is no reason to make it dead weight.
 */
export function filterHotkeys(sections: readonly HotkeySection[], filter: string): HotkeySection[] {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return sections as HotkeySection[];
  return sections
    .map((s) => ({
      name: s.name,
      entries: s.entries.filter(
        (e) =>
          e.command.toLowerCase().includes(needle) ||
          e.keys.toLowerCase().includes(needle) ||
          e.description.toLowerCase().includes(needle),
      ),
    }))
    .filter((s) => s.entries.length > 0);
}
