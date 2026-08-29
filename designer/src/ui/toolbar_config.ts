// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * TOOLBAR_CONFIGURATION and TOOLBAR_SETTINGS — the *stored* form of a toolbar,
 * and the two conversions between it and the `ToolEntry[]` the renderer takes.
 *
 * Upstream (`include/tool/ui/toolbar_configuration.h`,
 * `common/tool/ui/toolbar_configuration.cpp`) a toolbar has two forms:
 *
 *   - the **default**, built in code by the app's `TOOLBAR_SETTINGS` subclass —
 *     `PL_EDITOR_TOOLBAR_SETTINGS::DefaultToolbarConfig`
 *     (`pagelayout_editor/toolbars_pl_editor.cpp:35`), and one per frame;
 *   - the **stored** one, an `<app>-toolbars.json` file that Preferences >
 *     Toolbars writes.
 *
 * `TOOLBAR_SETTINGS::GetToolbarConfig( aToolbar, aAllowCustom )`
 * (`toolbar_configuration.cpp:192-204`) picks between them: the stored one when
 * the app's `appearance.custom_toolbars` is on *and* a configuration for that
 * toolbar exists, otherwise the default. That is the whole of the customisation
 * mechanism, and {@link resolveToolbarConfig} is it.
 *
 * Here the default is each editor's existing `…Toolbars.ts` module — this
 * port's `DefaultToolbarConfig` — so this module carries no toolbar inventory
 * of its own. What it adds is the JSON, whose keys mirror upstream's so a
 * stored file reads like KiCad's:
 *
 *     { "toolbars": [ { "name": "TOP_MAIN",
 *                       "contents": [ { "type": "TOOL", "name": "undo" },
 *                                     { "type": "SEPARATOR" },
 *                                     { "type": "SPACER", "size": 5 },
 *                                     { "type": "CONTROL", "name": "gridSelect" },
 *                                     { "type": "TB_GROUP", "group_name": "Units",
 *                                       "group_items": [ … ] } ] } ] }
 *
 * `type` and `name` are `magic_enum::enum_name` of `TOOLBAR_ITEM_TYPE` and
 * `TOOLBAR_LOC` — the C++ identifiers, upper case, exactly as
 * `to_json( json&, const TOOLBAR_ITEM& )` writes them (`:35-68`), and read back
 * case-insensitively as `magic_enum::enum_cast( …, case_insensitive )` does.
 *
 * **What a stored item does not carry, and where it comes back from.**
 * Upstream a `TOOL` item is one string, and everything the button needs — its
 * icon, its friendly name, whether it is a check item — is looked up from the
 * `TOOL_ACTION` in `ACTION_MANAGER`'s registry. This port has no such registry:
 * a button's icon and tooltip live on the `ToolButton` literal in the editor's
 * own toolbar module. So the lookup table here is built from the app's own
 * default toolbars ({@link toolbarTemplates}) — the same buttons upstream's
 * panel offers, minus any action that is on none of that app's toolbars. That
 * reduction is real; it is stated on the Toolbars page itself and in
 * `docs/editor-status.md`.
 */
import type { ToolButton, ToolEntry, ToolGroup } from './toolbar_types.js';

/**
 * `TOOLBAR_LOC` (`toolbar_configuration.h:266-272`), in declaration order.
 *
 * The order is load-bearing: `magic_enum::enum_values<TOOLBAR_LOC>()` is what
 * both `ResetPanel` and `TransferDataToWindow` iterate to build the "Toolbar:"
 * choice (`panel_toolbar_customization.cpp:243`, `:277`), so this is the order
 * that choice lists them in.
 */
export const TOOLBAR_LOCS = ['LEFT', 'RIGHT', 'TOP_MAIN', 'TOP_AUX'] as const;

export type ToolbarLoc = (typeof TOOLBAR_LOCS)[number];

/** `s_toolbarNameMap` (`panel_toolbar_customization.cpp:51-56`). */
export const TOOLBAR_LOC_NAMES: Readonly<Record<ToolbarLoc, string>> = {
  LEFT: 'Left',
  RIGHT: 'Right',
  TOP_MAIN: 'Top main',
  TOP_AUX: 'Top auxiliary',
};

/** `TOOLBAR_ITEM_TYPE` (`toolbar_configuration.h:37-44`), in declaration order. */
export const TOOLBAR_ITEM_TYPES = ['TOOL', 'TB_GROUP', 'SPACER', 'CONTROL', 'SEPARATOR'] as const;

export type ToolbarItemType = (typeof TOOLBAR_ITEM_TYPES)[number];

/** One `TOOLBAR_ITEM`, as `to_json` writes it (`toolbar_configuration.cpp:35-68`). */
export interface ToolbarItemJson {
  type: ToolbarItemType;
  /** `TOOL`: the action name. `CONTROL`: the control name. Nothing else has one. */
  name?: string;
  /** `SPACER` only. Raw pixels — `wxAuiToolBar::AddSpacer` takes them unscaled. */
  size?: number;
  /** `TB_GROUP` only. */
  group_name?: string;
  /** `TB_GROUP` only; every entry is a `TOOL` (`parseToolbarTree` asserts it). */
  group_items?: ToolbarItemJson[];
}

/** `TOOLBAR_CONFIGURATION`: `to_json` writes it as a bare array (`:124-131`). */
export type ToolbarConfigJson = ToolbarItemJson[];

/**
 * `TOOLBAR_SETTINGS`' one parameter, `"toolbars"` — a *list* of
 * `{ name, contents }`, not a map, because that is what the `PARAM_LAMBDA`
 * serialises (`toolbar_configuration.cpp:148-190`).
 */
export interface ToolbarSettings {
  toolbars: { name: ToolbarLoc; contents: ToolbarConfigJson }[];
}

/** An app that has never been customised: `m_toolbars` empty. */
export const TOOLBAR_SETTINGS_DEFAULTS: ToolbarSettings = { toolbars: [] };

/**
 * One app's `DefaultToolbarConfig`, as that editor's own `…Toolbars.ts` states
 * it. A location absent from this map is upstream's `std::nullopt` — pl_editor
 * and eeschema both `return std::nullopt` for `TOOLBAR_LOC::TOP_AUX`
 * (`toolbars_pl_editor.cpp:42-43`, `toolbars_sch_editor.cpp:67-68`) — and gets
 * neither a row in the "Toolbar:" choice nor a toolbar on the frame.
 */
export type ToolbarDefaults = Partial<Record<ToolbarLoc, ToolEntry[]>>;

/** The locations an app actually has, in `TOOLBAR_LOCS` order. */
export function toolbarLocsOf(defaults: ToolbarDefaults): ToolbarLoc[] {
  return TOOLBAR_LOCS.filter((loc) => defaults[loc] !== undefined);
}

// ----- from_json ---------------------------------------------------------------

function asItem(raw: unknown): ToolbarItemJson | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  // `TOOLBAR_ITEM()`'s own initialiser is `m_Type( TOOLBAR_ITEM_TYPE::TOOL )`
  // (`toolbar_configuration.h:48-51`) and `from_json` overwrites it only when
  // the enum cast succeeds (`:76-84`) — so an item with a missing or unknown
  // `type` IS a TOOL, and is then dropped downstream for naming no action.
  const wanted = typeof o.type === 'string' ? o.type.toUpperCase() : '';
  const type = (TOOLBAR_ITEM_TYPES as readonly string[]).includes(wanted)
    ? (wanted as ToolbarItemType)
    : 'TOOL';
  const item: ToolbarItemJson = { type };
  switch (type) {
    case 'SEPARATOR':
      break;
    case 'SPACER':
      // `m_Size` is 0 from the constructor and only assigned when the key is
      // present (`:92-95`).
      item.size = typeof o.size === 'number' ? o.size : 0;
      break;
    case 'CONTROL':
    case 'TOOL':
      if (typeof o.name === 'string') item.name = o.name;
      break;
    case 'TB_GROUP':
      if (typeof o.group_name === 'string') item.group_name = o.group_name;
      item.group_items = Array.isArray(o.group_items)
        ? o.group_items.map(asItem).filter((i): i is ToolbarItemJson => i !== null)
        : [];
      break;
  }
  return item;
}

/**
 * The `"toolbars"` reader (`toolbar_configuration.cpp:166-189`).
 *
 * Free-form the way `common.json`'s `dialog.controls` is, so it loads through
 * the settings manager's `loadFreeForm` rather than `deepMerge`: a stored
 * toolbar *replaces* the default, and merging one over the other would produce
 * a toolbar neither side ever asked for.
 */
export function normalizeToolbarSettings(parsed: unknown): ToolbarSettings {
  const out: ToolbarSettings = { toolbars: [] };
  const raw =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).toolbars
      : undefined;
  if (!Array.isArray(raw)) return out;

  const seen = new Set<ToolbarLoc>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    const wanted = typeof o.name === 'string' ? o.name.toUpperCase() : '';
    if (!(TOOLBAR_LOCS as readonly string[]).includes(wanted)) continue;
    const loc = wanted as ToolbarLoc;
    // `m_toolbars.emplace` on a `std::map` (`:184-187`): the first entry for a
    // location wins, and a later duplicate is discarded rather than replacing it.
    if (seen.has(loc)) continue;
    seen.add(loc);
    const contents = Array.isArray(o.contents)
      ? o.contents.map(asItem).filter((i): i is ToolbarItemJson => i !== null)
      : [];
    out.toolbars.push({ name: loc, contents });
  }
  return out;
}

/** `TOOLBAR_SETTINGS::GetStoredToolbarConfig` — nullopt when never customised. */
export function storedToolbarConfig(
  store: ToolbarSettings,
  loc: ToolbarLoc,
): ToolbarConfigJson | undefined {
  return store.toolbars.find((t) => t.name === loc)?.contents;
}

/** `TOOLBAR_SETTINGS::SetStoredToolbarConfig` (`toolbar_configuration.h:305-308`). */
export function setStoredToolbarConfig(
  store: ToolbarSettings,
  loc: ToolbarLoc,
  config: ToolbarConfigJson,
): void {
  const row = store.toolbars.find((t) => t.name === loc);
  if (row) row.contents = config;
  else store.toolbars.push({ name: loc, contents: config });
}

// ----- ToolEntry <-> TOOLBAR_ITEM ----------------------------------------------

/** The `Append*` chain of a `DefaultToolbarConfig`, run over an editor's list. */
export function configFromEntries(entries: readonly ToolEntry[]): ToolbarConfigJson {
  const out: ToolbarConfigJson = [];
  for (const e of entries) {
    if (e === 'sep') out.push({ type: 'SEPARATOR' });
    else if ('spacer' in e) out.push({ type: 'SPACER', size: e.spacer });
    else if ('control' in e) out.push({ type: 'CONTROL', name: e.control });
    else if ('group' in e)
      out.push({
        type: 'TB_GROUP',
        group_name: e.group,
        group_items: e.actions.map((a) => ({ type: 'TOOL' as const, name: a.id })),
      });
    else out.push({ type: 'TOOL', name: e.id });
  }
  return out;
}

/**
 * Every button an app's Toolbars page can offer, and the literal it renders
 * from: `PANEL_TOOLBAR_CUSTOMIZATION`'s `m_availableTools`.
 *
 * Upstream that map is `ACTION_MANAGER::GetActionList()` filtered by
 * `isActionSupported` — every action of the app, on a toolbar or not. Ours is
 * the union of the app's own default toolbars, for the reason in this module's
 * header: the icon and tooltip a button needs exist only on the `ToolButton`
 * literal, and an action on no default toolbar has no literal to take them from.
 *
 * First declaration wins, so a button that appears on two of an app's toolbars
 * keeps the earlier one's fields.
 */
export function toolbarTemplates(defaults: ToolbarDefaults): Map<string, ToolButton> {
  const out = new Map<string, ToolButton>();
  const add = (b: ToolButton): void => {
    if (!out.has(b.id)) out.set(b.id, b);
  };
  for (const loc of TOOLBAR_LOCS) {
    for (const e of defaults[loc] ?? []) {
      if (e === 'sep' || 'spacer' in e || 'control' in e) continue;
      if ('group' in e) for (const a of e.actions) add(a);
      else add(e);
    }
  }
  return out;
}

/** Every control the app's default toolbars place: `m_availableControls`. */
export function toolbarControlNames(defaults: ToolbarDefaults): Set<string> {
  const out = new Set<string>();
  for (const loc of TOOLBAR_LOCS)
    for (const e of defaults[loc] ?? []) if (e !== 'sep' && 'control' in e) out.add(e.control);
  return out;
}

/**
 * Which of the app's groups cycle on click, so a stored group keeps its kind.
 *
 * `cycleOnClick` is our name for upstream's "none of these actions is an
 * activation" test in `ACTION_TOOLBAR::onToolEvent`, which is a property of the
 * actions and not of the stored row — the JSON carries only the group's name
 * and its members. Looking it up by name is the closest this port can get
 * without an action registry, and it is exact for every group the user has not
 * renamed.
 */
function groupCycles(defaults: ToolbarDefaults): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const loc of TOOLBAR_LOCS)
    for (const e of defaults[loc] ?? [])
      if (e !== 'sep' && 'group' in e && !out.has(e.group))
        out.set(e.group, e.cycleOnClick ?? false);
  return out;
}

/** A group member never carries the top-level option-button flag. See below. */
function asGroupMember(b: ToolButton): ToolButton {
  if (b.toggle === undefined) return b;
  const out: ToolButton = { id: b.id, icon: b.icon };
  if (b.title !== undefined) out.title = b.title;
  if (b.disabled !== undefined) out.disabled = b.disabled;
  return out;
}

/**
 * `populateToolbarTree`'s materialisation, minus the tree: one stored
 * configuration back into the entries the renderer draws.
 *
 * The three drops are upstream's, in upstream's order
 * (`panel_toolbar_customization.cpp:439-565`): a `TOOL` whose action is not in
 * `m_availableTools` is skipped, a `CONTROL` whose name is not in
 * `m_availableControls` is skipped, and a `TB_GROUP` left with no visible items
 * is `Delete`d rather than drawn empty (`:558-559`).
 */
export function entriesFromConfig(
  config: readonly ToolbarItemJson[],
  defaults: ToolbarDefaults,
): ToolEntry[] {
  const tools = toolbarTemplates(defaults);
  const controls = toolbarControlNames(defaults);
  const cycles = groupCycles(defaults);
  const out: ToolEntry[] = [];

  for (const item of config) {
    switch (item.type) {
      case 'SEPARATOR':
        out.push('sep');
        break;
      case 'SPACER':
        out.push({ spacer: item.size ?? 0 });
        break;
      case 'CONTROL':
        if (item.name !== undefined && controls.has(item.name)) out.push({ control: item.name });
        break;
      case 'TOOL': {
        const t = item.name === undefined ? undefined : tools.get(item.name);
        if (t) out.push(t);
        break;
      }
      case 'TB_GROUP': {
        const actions: ToolButton[] = [];
        for (const g of item.group_items ?? []) {
          const t = g.name === undefined ? undefined : tools.get(g.name);
          // `toggle` is a *top-level* option button's lit state. Inside a group
          // the check-item question is `groupIsCheckItem` over the actions
          // themselves (`ACTION_TOOLBAR::AddGroup`'s `isToggleEntry`), and
          // `toolbar_types.ts` says in as many words never to set the flag on a
          // group member — so a button moved into a group loses it.
          if (t) actions.push(asGroupMember(t));
        }
        if (actions.length === 0) break;
        const group: ToolGroup = { group: item.group_name ?? '', actions };
        if (cycles.get(group.group)) group.cycleOnClick = true;
        out.push(group);
        break;
      }
    }
  }
  return out;
}

/**
 * `TOOLBAR_SETTINGS::GetToolbarConfig( aToolbar, aAllowCustom )`
 * (`toolbar_configuration.cpp:192-204`) in the port's terms: the entries a
 * toolbar should draw, given the app's store and its `custom_toolbars` flag.
 *
 * The default list is returned **by reference** when nothing is customised, so
 * the overwhelmingly common case allocates nothing and `<Toolbar>` keeps seeing
 * the array identity it always did.
 */
export function resolveToolbarConfig(
  defaults: ToolbarDefaults,
  loc: ToolbarLoc,
  store: ToolbarSettings | undefined,
  allowCustom: boolean,
): ToolEntry[] {
  if (allowCustom && store) {
    const stored = storedToolbarConfig(store, loc);
    if (stored) return entriesFromConfig(stored, defaults);
  }
  return defaults[loc] ?? [];
}
