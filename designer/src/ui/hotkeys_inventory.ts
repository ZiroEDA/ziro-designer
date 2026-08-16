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
  name: string;
  entries: HotkeyEntry[];
}

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

/** Merge menu items and toolbar buttons into one row per command. */
function section(
  name: string,
  items: readonly MenuItem[],
  toolbars: readonly { title: string; id: string }[],
  extraKeys: Readonly<Record<string, string>> = {},
): HotkeySection {
  const byName = new Map<string, HotkeyEntry>();

  const add = (rawName: string, keys: string, description: string): void => {
    const command = stripEllipsis(rawName);
    if (command === '') return;
    const prev = byName.get(command);
    if (prev) {
      // First non-empty wins for each field, so a toolbar's description fills
      // in a menu row and a menu's accelerator fills in a toolbar row.
      if (prev.keys === '') prev.keys = keys;
      if (prev.description === '') prev.description = description;
      return;
    }
    byName.set(command, { command, keys, alt: '', description });
  };

  for (const it of items) add(it.label ?? '', it.shortcut ?? '', '');
  // A ToolButton carries one string, `title`, which is both its name and its
  // tooltip. Upstream's two columns come from GetFriendlyName() and
  // GetDescription(), which differ - "Annotate Schematic" against "Fill in
  // schematic symbol reference designators". Repeating the name in the
  // description column would fill it without saying anything, so a description
  // is only kept where it is not simply the command again.
  for (const b of toolbars) {
    const command = stripEllipsis(b.title);
    add(b.title, extraKeys[b.id] ?? '', b.title === command ? '' : b.title);
  }

  return {
    name,
    entries: [...byName.values()].sort((a, b) => a.command.localeCompare(b.command)),
  };
}

/**
 * The sections, named as HOTKEY_STORE::GetSectionName names them:
 *
 *     { "common",   _( "Common" ) },       { "kicad",    _( "Project Manager" ) },
 *     { "eeschema", _( "Schematic Editor" ) }, { "pcbnew", _( "PCB Editor" ) },
 *     { "plEditor", _( "Drawing Sheet Editor" ) }, { "3DViewer", _( "3D Viewer" ) },
 *     { "gerbview", _( "Gerber Viewer" ) }
 */
export function buildHotkeySections(): HotkeySection[] {
  const sections: HotkeySection[] = [
    section('Project Manager', managerItems(), []),
    section(
      'Schematic Editor',
      schematicItems(),
      [...walkToolbar(TOP_TOOLBAR), ...walkToolbar(LEFT_TOOLBAR), ...walkToolbar(RIGHT_TOOLBAR)],
      TOOL_HOTKEYS,
    ),
    section(
      'PCB Editor',
      [],
      [
        ...walkToolbar(PCB_TOP_TOOLBAR),
        ...walkToolbar(PCB_LEFT_TOOLBAR),
        ...walkToolbar(PCB_RIGHT_TOOLBAR),
      ],
    ),
    section('3D Viewer', [], walkToolbar(VIEWER3D_TOP_TOOLBAR)),
    section(
      'Symbol Editor',
      [],
      [
        ...walkToolbar(SYM_TOP_TOOLBAR),
        ...walkToolbar(SYM_LEFT_TOOLBAR),
        ...walkToolbar(SYM_RIGHT_TOOLBAR),
      ],
    ),
    section(
      'Footprint Editor',
      [],
      [
        ...walkToolbar(FP_TOP_TOOLBAR),
        ...walkToolbar(FP_LEFT_TOOLBAR),
        ...walkToolbar(FP_RIGHT_TOOLBAR),
      ],
    ),
    section(
      'Gerber Viewer',
      [],
      [
        ...walkToolbar(GBR_TOP_TOOLBAR),
        ...walkToolbar(GBR_LEFT_TOOLBAR),
        ...walkToolbar(GBR_RIGHT_TOOLBAR),
      ],
    ),
    section(
      'Drawing Sheet Editor',
      [],
      [
        ...walkToolbar(DS_TOP_TOOLBAR),
        ...walkToolbar(DS_LEFT_TOOLBAR),
        ...walkToolbar(DS_RIGHT_TOOLBAR),
      ],
    ),
  ];
  return sections.filter((s) => s.entries.length > 0);
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
