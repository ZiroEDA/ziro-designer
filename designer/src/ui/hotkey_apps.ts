// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The apps a hotkey can belong to, and which of them have an action registry.
 *
 * `ACTION_MANAGER` upstream is one object per frame holding every `TOOL_ACTION`
 * that frame knows, and everything else - the Hotkey List, the Preferences
 * page, `ReadHotKeyConfig`, dispatch - is a walk over it. There is no single
 * such object here, so this file is the table that stands in for it: an app
 * prefix maps to that editor's registry, and everything downstream reads the
 * table rather than naming an editor.
 *
 * ## Adding an editor
 *
 * Only the schematic has a registry today. When the next editor is worked on,
 * the whole of the hotkey machinery - the Hotkey List, rebinding from
 * Preferences, "Import Hotkeys...", "Undo All Changes", conflict reporting,
 * persistence - starts working for it in three steps:
 *
 *  1. Write `editors/<editor>/hotkeys.ts` exporting `HOTKEYS: RegistryAction[]`,
 *     one entry per command the editor dispatches. Copy the schematic's: the
 *     fields are the ones a `TOOL_ACTION` carries, and `upstream` is the
 *     `ACTIONS::` or `<APP>_ACTIONS::` constant it is ported from.
 *  2. Add it to {@link APP_REGISTRIES} below - one line.
 *  3. In that editor's key handler, put the event through
 *     `remapEvent( e, settings.hotkeys, '<app>' )` and act on what comes back,
 *     the way `SchematicEditor` and `SchematicCanvas` do.
 *
 * Nothing else needs touching. The list, the sections, the names, the store and
 * the file format are all keyed on the app prefix already.
 *
 * The point of writing this down is that the machinery was built while only one
 * editor could use it, and the cost of the second one should be a registry file
 * rather than a rediscovery of how any of this fits together.
 *
 * Issue #525 tracks the rest: a registry per editor, the five frames whose
 * menus are still declared inline and so cannot be collected, and the smaller
 * gaps (the row context menu, Restore All to Defaults, writing `.hotkeys`).
 * One decision there is worth making before the *second* registry rather than
 * after: whether a name carries upstream's tool segment
 * (`eeschema.InteractiveDrawing.drawWire`) or stays `<app>.<id>` as it is here.
 * Adopting it is the parity answer and it costs nothing while one registry
 * exists.
 */
import { HOTKEYS as EESCHEMA_HOTKEYS } from '../editors/schematic/hotkeys.js';

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
 * are named `eeschema.*` and `pcbnew.*`, so they fold into those two - as they
 * do upstream, and as their toolbars already do here.
 */
export const APP_ORDER = [
  '3DViewer',
  'common',
  'eeschema',
  'gerbview',
  'kicad',
  'pcbnew',
  'plEditor',
] as const;

export type AppKey = (typeof APP_ORDER)[number];

/** HOTKEY_STORE::GetSectionName's s_AppNames, verbatim. */
export const SECTION_NAMES: Record<AppKey, string> = {
  '3DViewer': '3D Viewer',
  common: 'Common',
  eeschema: 'Schematic Editor',
  gerbview: 'Gerber Viewer',
  kicad: 'Project Manager',
  pcbnew: 'PCB Editor',
  plEditor: 'Drawing Sheet Editor',
};

/**
 * `TOOL_ACTION::GetName()`.
 *
 * Upstream's is `<app>.<Tool>.<action>`; we have the app and the action id but
 * no tool, so ours is `<app>.<id>`. What matters is that it is app-qualified,
 * because it is the key for all four of the store, the settings map, the
 * `.hotkeys` file and dispatch - and `save` means two different things in two
 * editors while `eeschema.save` means one.
 */
export const qualify = (app: AppKey, id: string): string => `${app}.${id}`;

/**
 * One row of an editor's registry: the fields a `TOOL_ACTION` carries that
 * anything here needs.
 *
 * Deliberately structural, so an editor's own table can carry whatever else it
 * wants - the schematic's has a `section` and a `note` - and still satisfy
 * this without inheriting from it.
 */
export interface RegistryAction {
  /** The action id the editor dispatches on; unique within the app. */
  id: string;
  /** `FriendlyName` of the upstream action. */
  label: string;
  /** The default key combination, spelled as the menus spell it. */
  keys: string;
  /**
   * The upstream `TOOL_ACTION` this comes from.
   *
   * Load-bearing, not a comment: two entries citing one action are one command
   * with two bindings, and the second becomes the row's Alternate rather than a
   * second row claiming the same name.
   */
  upstream: string;
}

/**
 * App prefix -> that editor's action registry.
 *
 * An app absent from here still gets a section in the Hotkey List, built from
 * its menus and toolbars; what it does not get is the commands that appear in
 * neither. For the schematic that was 46 of 98 - the cursor keys, the grid
 * keys, pan, Move, Drag, Cancel, Leave Sheet - so the gap is not a rounding
 * error, and it is largest for exactly the bindings a user cannot discover by
 * looking at the screen.
 */
export const APP_REGISTRIES: Partial<Record<AppKey, readonly RegistryAction[]>> = {
  eeschema: EESCHEMA_HOTKEYS,
  // pcbnew: PCBNEW_HOTKEYS,        <- editors/pcb/hotkeys.ts
  // gerbview: GERBVIEW_HOTKEYS,    <- editors/gerbview/hotkeys.ts
  // plEditor: PL_EDITOR_HOTKEYS,   <- editors/drawingsheet/hotkeys.ts
  // '3DViewer': VIEWER3D_HOTKEYS,  <- editors/pcb/viewer3dHotkeys.ts
  // kicad: MANAGER_HOTKEYS,        <- home/hotkeys.ts
};

/** Whether an editor's key handler can be driven from the store yet. */
export const hasRegistry = (app: AppKey): boolean => APP_REGISTRIES[app] !== undefined;
