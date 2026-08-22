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
import { TOOLBAR_ACTIONS } from './toolbar_actions.js';
import { DEFAULT_LANGUAGE } from './language_menu.js';
import { browserSafeKey } from './browser_reserved.js';
import { hotkeyListName } from './key_names.js';
import { buildManagerMenus } from '../home/menubar.js';
import { TOOL_HOTKEYS, buildMenus as buildSchMenus } from '../editors/schematic/menubar.js';
import {
  APP_ORDER,
  APP_REGISTRIES,
  SECTION_NAMES,
  qualify,
  type AppKey,
  type RegistryAction,
} from './hotkey_apps.js';
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
  GBR_TOP_AUX_TOOLBAR,
  GBR_LEFT_TOOLBAR,
} from '../editors/gerbview/gerberToolbars.js';
import {
  DS_TOP_TOOLBAR,
  DS_LEFT_TOOLBAR,
  DS_RIGHT_TOOLBAR,
} from '../editors/drawingsheet/drawingSheetToolbars.js';

export interface HotkeyEntry {
  /**
   * `TOOL_ACTION::GetName()` - the key HOTKEY_STORE's map is keyed on, which is
   * what an override, an import and a reset all match a row by.
   *
   * Upstream's is `<app>.<Tool>.<action>`; we have the app and the action id but
   * no tool, so ours is `<app>.<id>` - `kicad.newProject`, `eeschema.drawWire`.
   * What matters is that it is stable and app-qualified, so the same id in two
   * editors is two rows rather than one.
   *
   * '' for a PSEUDO_ACTION - the gestures and the platform commands - which has
   * no name upstream either, and so can be neither rebound nor imported onto.
   */
  name: string;
  /** GetFriendlyName(), with the ellipsis stripped as updateFromClientData does. */
  command: string;
  /** The primary accelerator in force: the override where there is one, else the default. */
  keys: string;
  /** `GetDefaultHotKey()`, which is what "Undo All Changes" and a reset restore. */
  defaultKeys: string;
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
 * A row while it is still being collected, carrying where its name came from.
 *
 * A MenuItem has no action id - only `icon`, the name of the picture it draws -
 * and for most commands the two coincide. For nine they do not: the menu draws
 * `assignFp` where the toolbar declares `assignFootprints`, and the two are the
 * same command under two spellings. A ToolButton's `id` is the declared one, so
 * where a label is claimed by both, the toolbar's wins.
 */
interface Collected extends HotkeyEntry {
  nameFromIcon: boolean;
}

/** Drop the collection bookkeeping, so the exported row is only the row. */
const strip = ({ nameFromIcon: _drop, ...e }: Collected): HotkeyEntry => e;

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

/**
 * Split a toolbar title that carries its accelerator, "Paste (Ctrl+V)".
 *
 * wxWidgets appends the key to a tool's short help for display; the action's
 * `GetFriendlyName()` is the part in front, and the key belongs in the Hotkey
 * column. Fifteen of our titles are written that way, and listing them whole
 * put the key in the Command column and left the Hotkey column empty - the one
 * place a reader looks for it.
 */
const ACCEL_SUFFIX = /\s*\((Ctrl|Alt|Shift|F\d|Del|Esc|Tab|Space)[^)]*\)\s*$/i;

function splitToolTitle(title: string): { name: string; keys: string } {
  const m = ACCEL_SUFFIX.exec(title);
  if (!m) return { name: title, keys: '' };
  return { name: title.slice(0, m.index).trim(), keys: m[0].trim().replace(/^\(|\)$/g, '') };
}

/**
 * What the Hotkey List calls the key a menu row prints.
 *
 * The row's `shortcut` is its *menu* accelerator, which is GTK's name for the
 * key ("Delete"); this column is KiCad's own ("Del", `hotkeyNameList` at
 * `common/hotkeys_basic.cpp:93`). `hotkeyListName` is that translation and an
 * identity for every key the two tables agree about, which is why no existing
 * call site had to change. `MenuItem.hotkeyName` is the per-row escape hatch
 * and is expected to stay unused.
 *
 * Exported because it is the whole of the default: a test that pins the split
 * has to be able to press it with a row of its own, and every row this module
 * collects today is claimed by a registry before it reaches the dialog.
 */
export function menuHotkeyName(item: MenuItem): string {
  return item.hotkeyName ?? hotkeyListName(item.shortcut);
}

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
      for (const a of e.actions) out.push({ title: a.title ?? '', id: a.id });
    } else if ('icon' in e && 'id' in e) {
      out.push({ title: e.title ?? '', id: e.id });
    }
  }
  return out;
}

/**
 * A toolbar button's three columns, preferring the shared TOOL_ACTION
 * transcription over the button's joined `title`.
 *
 * `splitToolTitle` below exists only because a `ToolButton` used to carry one
 * pre-joined string that had to be pulled apart again with a regex. Where
 * `toolbar_actions.ts` has the id, the three fields are already separate and
 * are exactly upstream's: `GetFriendlyName()` for the Command column,
 * `KeyNameFromKeyCode( GetHotKey() )` for the Hotkey column, and the action's
 * own `.Tooltip()` for the Description column — which is what
 * `GetDescription()` returns when no explicit description is set
 * (tool_action.cpp:173-180). The regex path stays for editors whose toolbars
 * have not been transcribed yet.
 */
function toolButtonColumns(
  app: string,
  b: { id: string; title: string },
): { name: string; keys: string; description: string } {
  // Keyed by app because a toolbar id is not globally unique — `placeText` is a
  // different TOOL_ACTION in eeschema and pcbnew, with a different name and a
  // different key.
  const a = TOOLBAR_ACTIONS[app]?.[b.id];
  if (a) return { name: a.name, keys: a.hotkey ?? '', description: a.tip ?? '' };
  const { name, keys } = splitToolTitle(b.title);
  return { name, keys, description: '' };
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
      language: DEFAULT_LANGUAGE,
      setLanguage: noop,
      closeProject: noop,
      restoreLocalHistory: noop,
      hasLocalHistory: false,
      saveAs: noop,
      archiveProject: noop,
      unarchiveProject: noop,
      refresh: noop,
      toggleLocalHistory: noop,
      localHistoryShown: false,
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
  app: AppKey,
  items: readonly MenuItem[],
  toolbars: readonly { title: string; id: string }[],
  extraKeys: Readonly<Record<string, string>> = {},
): Collected[] {
  const byKey = new Map<string, Collected>();

  /**
   * An icon two menu entries share is a picture, not an action id.
   *
   * The schematic's Edit menu draws Copy and Copy as Text with `icon: 'copy'`,
   * and Paste and Paste Special with `icon: 'paste'` - reasonably, they are the
   * same picture. Keying identity on it merged each pair into a single row, so
   * the list showed Copy as Text bound to Ctrl+C and never mentioned Copy at
   * all. Two commands became one, which is worse than the duplicate rows the
   * key was introduced to prevent.
   *
   * So an icon only counts as an id while exactly one label claims it.
   */
  const iconLabels = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.icon || !it.label) continue;
    const seen = iconLabels.get(it.icon) ?? new Set<string>();
    seen.add(stripEllipsis(it.label).toLowerCase());
    iconLabels.set(it.icon, seen);
  }
  const isPicture = (id: string): boolean => (iconLabels.get(id)?.size ?? 0) > 1;

  const keyOf = (id: string | undefined, label: string): string =>
    id && id !== '' && !isPicture(id) ? `#${id}` : label.toLowerCase();

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
      // `#id` where the action has one, so the store key survives a label
      // change; the slugged label only where there is no id to use.
      const slug = key.startsWith('#') ? key.slice(1) : key.replace(/[^a-z0-9]+/g, '-');
      byKey.set(key, {
        name: `${app}.${slug}`,
        command: name,
        keys,
        defaultKeys: keys,
        alt: '',
        description,
        // Provisional: an icon name is a guess at the action id, and stays one
        // until a toolbar declaring the same id confirms it.
        nameFromIcon: fromMenu,
      });
      return;
    }
    // A menu label outranks a toolbar title as the command's name, and each
    // field is filled by whichever side has one.
    if (fromMenu) prev.command = name;
    // A ToolButton's `id` is a declared action id rather than an icon name, so
    // a toolbar reaching this row settles what the command is called.
    else prev.nameFromIcon = false;
    if (prev.keys === '') {
      prev.keys = keys;
      prev.defaultKeys = keys;
    }
    if (prev.description === '' && description !== '') prev.description = description;
    // A description that is just the command again says nothing, and happens
    // whenever a menu label and its toolbar tooltip are the same string.
    if (prev.description === prev.command) prev.description = '';
  };

  for (const it of items) {
    add(keyOf(it.icon, it.label ?? ''), it.label ?? '', menuHotkeyName(it), '', true);
  }
  // A ToolButton carries one string, `title`, as both its name and its tooltip.
  // Upstream's two columns come from GetFriendlyName() and GetDescription(),
  // which differ, so the title is only kept as a description where it is not
  // simply the command again.
  for (const b of toolbars) {
    const { name: title, keys, description } = toolButtonColumns(app, b);
    const key = keyOf(b.id, title);
    const existing = byKey.get(key);
    // Upstream's Description column is `GetDescription()`, which falls back to
    // the action's `.Tooltip()`. Where we have that, use it; otherwise keep the
    // old behaviour of reusing the title, but only when it is not simply the
    // command again.
    add(key, title, extraKeys[b.id] ?? keys, description || (existing ? title : ''), false);
  }

  return [...byKey.values()];
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
  {
    name: '',
    command: 'Accept Autocomplete',
    keys: 'Return',
    defaultKeys: 'Return',
    // `{ wxT( "Num Pad Enter" ), WXK_NUMPAD_ENTER }` — hotkeys_basic.cpp:127.
    // Two words. This read 'Numpad Enter', which is not KiCad's spelling of any
    // key, and it is printed in the Hotkey List's Alternate column.
    // `ui/key_names.ts:86` already had it right, so the two disagreed.
    alt: 'Num Pad Enter',
    description: '',
  },
  {
    name: '',
    command: 'Cancel Autocomplete',
    keys: 'Esc',
    defaultKeys: 'Esc',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Toggle Checkbox',
    keys: 'Space',
    defaultKeys: 'Space',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Pan Left/Right',
    keys: 'Ctrl+Wheel',
    defaultKeys: 'Ctrl+Wheel',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Pan Up/Down',
    keys: 'Shift+Wheel',
    defaultKeys: 'Shift+Wheel',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Finish Drawing',
    keys: 'Double-click',
    defaultKeys: 'Double-click',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Add to Selection',
    keys: 'Shift+Click',
    defaultKeys: 'Shift+Click',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Highlight Net',
    keys: 'Ctrl+Click',
    defaultKeys: 'Ctrl+Click',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Remove from Selection',
    keys: 'Ctrl+Shift+Click',
    defaultKeys: 'Ctrl+Shift+Click',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Ignore Grid Snaps',
    keys: 'Ctrl',
    defaultKeys: 'Ctrl',
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Ignore Other Snaps',
    keys: 'Shift',
    defaultKeys: 'Shift',
    alt: '',
    description: '',
  },
];

/**
 * g_standardPlatformCommands, which Init folds into the Common section:
 *
 *     #ifndef __WINDOWS__
 *         new PSEUDO_ACTION( _( "Close" ), MD_CTRL + 'W' ),
 *     #endif
 *     new PSEUDO_ACTION( _( "Quit" ), MD_CTRL + 'Q' )
 *
 * Both stay, and both carry the key `ACTION_MENU::AddClose` / `AddQuit`
 * actually put on their rows. Quit used to be left out on the grounds that "a
 * browser tab has no Quit and Ctrl+Q belongs to the browser" - but a launcher's
 * Quit here returns to the project manager exactly as its Close does, and
 * BROWSER_REBINDS now moves both keys off the ones the browser keeps. Listing
 * Ctrl+W here while File > Close answers to Ctrl+Alt+W was the worse of the two
 * errors: the Hotkey List is where a user goes to find out.
 */
const PLATFORM_COMMANDS: HotkeyEntry[] = [
  {
    name: '',
    command: 'Close',
    keys: browserSafeKey('Ctrl+W'),
    defaultKeys: browserSafeKey('Ctrl+W'),
    alt: '',
    description: '',
  },
  {
    name: '',
    command: 'Quit',
    keys: browserSafeKey('Ctrl+Q'),
    defaultKeys: browserSafeKey('Ctrl+Q'),
    alt: '',
    description: '',
  },
];

/**
 * The user's overrides, as `user.hotkeys` holds them: a map from a command's
 * name to the key it is bound to, with `null` meaning "bound to nothing".
 *
 * An action with no entry keeps its `DefaultHotkey`, which is why this is a
 * sparse map rather than a full copy of the table - the same reason upstream
 * writes only the changed lines.
 */
export type HotkeyOverrides = Readonly<Record<string, string | null>>;

/**
 * The schematic's action registry, folded into its section.
 *
 * This is the closest thing the app has to a list of `TOOL_ACTION`s, and it is
 * the only source here that is not a menu or a toolbar - which matters, because
 * roughly half of what it holds appears in neither. The cursor keys, the grid
 * keys, pan, Move, Drag, Cancel, Leave Sheet, Select Node: bound by the canvas,
 * dispatched every day, and invisible to a list collected from menus. Upstream
 * has no such gap because a menu entry *is* a TOOL_ACTION there, so walking the
 * actions finds everything whether or not anything points at it.
 *
 * It is also the naming authority. `hotkeys.ts` is what the key handler
 * dispatches on, so where a registry action and a collected row are the same
 * command, the row takes the registry's name - otherwise rebinding it from this
 * window would write an override the dispatcher never reads.
 *
 * Matched by id first. A menu's `icon` is usually the action id and sometimes
 * only a picture, so a registry action whose id matched nothing falls back to
 * its label - which catches Copy as Text, Paste Special, Zoom to Fit and List
 * Hotkeys, four commands the two sides spell differently.
 */
function registryRows(app: AppKey): Collected[] {
  const registry: readonly RegistryAction[] = APP_REGISTRIES[app] ?? [];
  const out: Collected[] = [];
  const byUpstream = new Map<string, Collected>();

  for (const h of registry) {
    // Two entries citing one TOOL_ACTION are one command with two bindings, not
    // two commands: upstream holds that as one action with a DefaultHotkey and
    // a DefaultHotkeyAlt, which is what the Alternate column exists to show.
    // Listed as two rows they read as two commands sharing a name, which is the
    // one thing a hotkey list must not be ambiguous about. They remain two ids
    // because the key handler dispatches on them separately; only the row is
    // one.
    //
    // The pair that motivated this was `zoomFit` on Home and a second entry on
    // Ctrl+0, both ACTIONS::zoomFitScreen. That second entry is gone -- Ctrl+0
    // is the `#if __WXMAC__` branch and we ship the `#else` -- so nothing in
    // the schematic registry folds here today. The fold stays because it is the
    // Alternate column's whole reason to exist, and DefaultHotkeyAlt pairs do
    // occur upstream.
    const same = h.upstream === '' ? undefined : byUpstream.get(h.upstream);
    if (same) {
      if (same.alt === '') same.alt = h.keys;
      continue;
    }
    const row: Collected = {
      name: qualify(app, h.id),
      command: stripEllipsis(h.label),
      keys: h.keys,
      defaultKeys: h.keys,
      alt: '',
      description: '',
      // A declared action id, never an icon name.
      nameFromIcon: false,
    };
    out.push(row);
    if (h.upstream !== '') byUpstream.set(h.upstream, row);
  }

  return out;
}

/**
 * Fold the registry into rows collected from menus and toolbars.
 *
 * The registry wins on identity - its name and its default key - and the
 * collected row wins on presentation, because a menu label is written for a
 * reader and a toolbar title is a tooltip. A registry action nothing points at
 * is added on its own, which is the point.
 */
function withRegistry(app: AppKey, collected: readonly Collected[]): Collected[] {
  const out = [...collected];
  const byName = new Map(out.map((e) => [e.name, e]));
  const byLabel = new Map(out.map((e) => [e.command.toLowerCase(), e]));
  /**
   * A collected row answers to one registry action.
   *
   * Two actions can carry the same FriendlyName, and without this the second to
   * be walked took the row the first had already claimed, renaming it and
   * leaving `eeschema.zoomFit` to be picked up later by whichever toolbar
   * button happened to share the id, unbound. (The case that exposed it was
   * two Zoom to Fit entries, Home and Ctrl+0; the Ctrl+0 one has since gone as
   * a macOS-only binding, but the collision it caused is general.)
   */
  const claimed = new Set<Collected>();

  for (const reg of registryRows(app)) {
    const byNameHit = byName.get(reg.name);
    const byLabelHit = byLabel.get(reg.command.toLowerCase());
    const candidate = byNameHit ?? byLabelHit;
    const hit = candidate && !claimed.has(candidate) ? candidate : undefined;
    if (!hit) {
      out.push(reg);
      claimed.add(reg);
      byName.set(reg.name, reg);
      if (!byLabel.has(reg.command.toLowerCase())) byLabel.set(reg.command.toLowerCase(), reg);
      continue;
    }
    claimed.add(hit);
    // Adopting the registry's name is what joins this row to the dispatcher.
    hit.name = reg.name;
    hit.nameFromIcon = false;
    // A collected row's accelerator comes from a menu, which can be stale; the
    // registry's is the one the key handler actually honours - as is the second
    // binding, which no menu or toolbar has anywhere to put.
    hit.keys = reg.keys;
    hit.defaultKeys = reg.keys;
    hit.alt = reg.alt;
  }

  return out;
}

/**
 * The sections, in HOTKEY_STORE::Init's order, with Gestures last.
 *
 * `HOTKEY_STORE::Init` reads `action->GetHotKey()`, which is the *current*
 * binding - `ReadHotKeyConfigIntoActions` has already overlaid the user's file
 * onto the defaults by the time the store is built. Passing the overrides here
 * is that overlay: the collected accelerator is the default, and an entry in
 * the map replaces it.
 */
export function buildHotkeySections(overrides: HotkeyOverrides = {}): HotkeySection[] {
  const byApp = new Map<AppKey, Collected[]>();
  /**
   * Fold a group of collected rows into an app's section, one row per command.
   *
   * The key is the *name*, because HOTKEY_STORE's is:
   *
   *     std::map<std::string, HOTKEY> m_actions;
   *     ...
   *     m_actions[action->GetName()].m_Actions.push_back( action );
   *
   * so an action reached from two places is one HOTKEY however its two labels
   * are spelled. This deduplicated on the label instead, which held within one
   * toolbar but not across the four groups that share a section: the symbol
   * editor's Zoom In and the schematic's are the same action under labels that
   * differ by a word, and both were listed. Twenty-eight rows in this table
   * were a second copy of a row already in it - and, once a row could be
   * rebound, twenty-eight commands whose override would have been written
   * against one copy and read back by the other.
   *
   * A PSEUDO_ACTION has no name, so the gestures fall back to their label.
   */
  const put = (app: AppKey, rows: readonly (HotkeyEntry | Collected)[]): void => {
    // A PSEUDO_ACTION table is written as plain rows; it has no id to have come
    // from an icon.
    const entries: Collected[] = rows.map((e) =>
      'nameFromIcon' in e ? e : { ...e, nameFromIcon: false },
    );
    const prev = byApp.get(app) ?? [];
    const keyOf = (e: Collected): string => (e.name !== '' ? e.name : `label:${e.command}`);
    const byName = new Map(prev.map((e) => [keyOf(e), e]));

    for (const e of entries) {
      const existing = byName.get(keyOf(e));
      if (!existing) {
        byName.set(keyOf(e), e);
        prev.push(e);
        continue;
      }
      // Whichever copy has a field, the merged row keeps - the same rule the
      // menu/toolbar merge inside a section uses, applied across sections.
      if (existing.keys === '' && e.keys !== '') {
        existing.keys = e.keys;
        existing.defaultKeys = e.defaultKeys;
      }
      if (existing.description === '' && e.description !== '') existing.description = e.description;
    }

    byApp.set(app, prev);
  };

  put('common', PLATFORM_COMMANDS);
  put('kicad', section('kicad', managerItems(), []));
  // The symbol editor's actions are eeschema.*, so they share eeschema's
  // section rather than getting one of their own - as they do upstream.
  put(
    'eeschema',
    section(
      'eeschema',
      schematicItems(),
      [...walkToolbar(TOP_TOOLBAR), ...walkToolbar(LEFT_TOOLBAR), ...walkToolbar(RIGHT_TOOLBAR)],
      TOOL_HOTKEYS,
    ),
  );
  put(
    'eeschema',
    section(
      'eeschema',
      [],
      [
        ...walkToolbar(SYM_TOP_TOOLBAR),
        ...walkToolbar(SYM_LEFT_TOOLBAR),
        ...walkToolbar(SYM_RIGHT_TOOLBAR),
      ],
    ),
  );
  // Likewise the footprint editor's are pcbnew.*.
  put(
    'pcbnew',
    section(
      'pcbnew',
      [],
      [
        ...walkToolbar(PCB_TOP_TOOLBAR),
        ...walkToolbar(PCB_LEFT_TOOLBAR),
        ...walkToolbar(PCB_RIGHT_TOOLBAR),
      ],
    ),
  );
  put(
    'pcbnew',
    section(
      'pcbnew',
      [],
      [
        ...walkToolbar(FP_TOP_TOOLBAR),
        ...walkToolbar(FP_LEFT_TOOLBAR),
        ...walkToolbar(FP_RIGHT_TOOLBAR),
      ],
    ),
  );
  put('3DViewer', section('3DViewer', viewer3dItems(), walkToolbar(VIEWER3D_TOP_TOOLBAR)));
  put(
    'gerbview',
    section(
      'gerbview',
      [],
      [
        ...walkToolbar(GBR_TOP_TOOLBAR),
        ...walkToolbar(GBR_TOP_AUX_TOOLBAR),
        ...walkToolbar(GBR_LEFT_TOOLBAR),
      ],
    ),
  );
  put(
    'plEditor',
    section(
      'plEditor',
      [],
      [
        ...walkToolbar(DS_TOP_TOOLBAR),
        ...walkToolbar(DS_LEFT_TOOLBAR),
        ...walkToolbar(DS_RIGHT_TOOLBAR),
      ],
    ),
  );

  /**
   * The second half of the store's deduplication: one row per *command*, once
   * the name has done what it can.
   *
   * Nine commands are declared with one id in a menu and another in a toolbar -
   * `assignFp` beside `assignFootprints`, `page` beside `pageSettings` - so
   * their two rows have two names and survive the name dedup above. Upstream
   * cannot have this: a MenuItem there *is* a TOOL_ACTION, so the menu and the
   * toolbar cite the same object and there is only ever one name.
   *
   * Where two rows in one section share a label, the toolbar's id wins, because
   * a ToolButton's `id` is a declared action id and a MenuItem's `icon` is the
   * name of a picture that usually - not always - matches it.
   */
  const collapseByLabel = (entries: readonly Collected[]): Collected[] => {
    const byLabel = new Map<string, Collected>();
    const kept: Collected[] = [];
    for (const e of entries) {
      const held = byLabel.get(e.command);
      if (!held) {
        byLabel.set(e.command, e);
        kept.push(e);
        continue;
      }
      // Two rows that both carry a *declared* name are two commands that happen
      // to share a FriendlyName, and upstream lists both, because its store is
      // keyed on the name and never consults the label. Only a name guessed
      // from an icon is worth collapsing away.
      if (!held.nameFromIcon && !e.nameFromIcon) {
        kept.push(e);
        continue;
      }
      const keep = held.nameFromIcon && !e.nameFromIcon ? e : held;
      const drop = keep === held ? e : held;
      if (keep.keys === '' && drop.keys !== '') {
        keep.keys = drop.keys;
        keep.defaultKeys = drop.defaultKeys;
      }
      if (keep.description === '' && drop.description !== '') keep.description = drop.description;
      byLabel.set(e.command, keep);
      // `keep` is already in `kept` when it is the row we held; when the new row
      // wins it takes the held one's place rather than being appended.
      if (keep === e) kept[kept.indexOf(drop)] = e;
    }
    return kept;
  };

  // A PSEUDO_ACTION has no name, so nothing can be bound onto it - which is
  // also why the gestures survive an import untouched.
  const bind = (e: Collected): HotkeyEntry =>
    e.name !== '' && Object.hasOwn(overrides, e.name)
      ? { ...strip(e), keys: overrides[e.name] ?? '' }
      : strip(e);

  const out: HotkeySection[] = [];
  for (const app of APP_ORDER) {
    // The registry is folded in per app rather than at one call site, so an
    // editor that gains one appears here without this function learning its
    // name. Run after everything collected for the app, so a registry action
    // can claim a row from any of its menus or toolbars.
    const entries = withRegistry(app, byApp.get(app) ?? []);
    if (entries.length > 0) {
      out.push({
        name: SECTION_NAMES[app],
        entries: collapseByLabel(entries)
          .map(bind)
          .sort((a, b) => a.command.localeCompare(b.command)),
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

/**
 * Commands already answering to `keys`, ignoring the one being rebound.
 *
 * `WIDGET_HOTKEY_LIST::resolveKeyConflicts` names what holds a combo before
 * assigning it, because "already taken" is the one thing a user cannot see for
 * themselves while typing one into a row. It searches the whole store rather
 * than the section, so a schematic binding that collides with a PCB one is
 * still reported.
 *
 * A PSEUDO_ACTION is skipped: a gesture is not something a key can be taken
 * from, and Ctrl+Click is not a keystroke.
 */
export function hotkeyConflicts(
  sections: readonly HotkeySection[],
  keys: string,
  exceptName: string,
): { command: string; section: string }[] {
  if (keys === '') return [];
  const want = keys.toLowerCase();
  const out: { command: string; section: string }[] = [];
  for (const s of sections) {
    for (const e of s.entries) {
      if (e.name === '' || e.name === exceptName) continue;
      if (e.keys.toLowerCase() === want) out.push({ command: e.command, section: s.name });
    }
  }
  return out;
}
