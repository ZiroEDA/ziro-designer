// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A COLOR_SETTINGS file — one `.json` out of KiCad's colour-theme folder.
 *
 * `SETTINGS_MANAGER::GetColorSettingsPath()` is a real directory on a KiCad
 * install, and "Open Theme Folder" opens it in the file manager so a user can
 * copy a theme out, drop one in, or mail one to somebody. A browser has no such
 * folder, so the two halves of what that folder is FOR are these two functions:
 * a theme goes out as the file KiCad would have written, and a file KiCad wrote
 * comes back in.
 *
 * The key tables are `color_settings.cpp:55-101` and `:124-244` — KiCad's own
 * data, mirrored rather than invented, because the names in a theme file are a
 * format and not a choice. Two of the three namespaces are here, `schematic`
 * and `board`, because two of our Colors pages write them; `gerbview` is not,
 * for the reason the board one was not until the footprint editor's page could
 * write it. A section is emitted only when the theme HAS colours in it: an
 * empty one is not neutral, it tells KiCad to reset every layer it names.
 *
 * Two layers are deliberately absent. `LAYER_INTERSHEET_REFS` and
 * `LAYER_SHAPES_BACKGROUND` have no `CLR()` line and no entry in
 * `s_defaultTheme`, which is why their swatches show the bare checkerboard —
 * a theme file has never carried them.
 */
import { parseColor4d, toCssString } from '../color4d.js';
import { BUILTIN_DEFAULT_THEME } from './builtin_color_themes.js';

/**
 * A layer id, which is how a theme's colour table is keyed. The table is one
 * map over every app's layers -- `COLOR_SETTINGS::m_colors` is a single
 * `std::map<int, COLOR4D>` and the namespaces are only how the FILE is
 * sectioned -- so a board layer and a schematic layer are the same kind of key.
 */
export type ThemeLayerId = keyof typeof BUILTIN_DEFAULT_THEME;

/** `ThemeLayerId` under the name the schematic half has always used it by. */
export type SchLayerId = ThemeLayerId;

/** `colorsSchemaVersion` (`color_settings.cpp:33`). */
export const COLOR_THEME_SCHEMA_VERSION = 5;

/**
 * `"schematic.<key>"` -> `SCH_LAYER_ID`, in `color_settings.cpp`'s own order.
 *
 * The order matters for reading this against the C++ and for nothing else: the
 * file is written with its keys sorted, because that is what nlohmann::json's
 * object does and therefore what every theme file on disk looks like.
 */
export const SCHEMATIC_COLOR_KEYS: readonly (readonly [string, SchLayerId])[] = [
  ['anchor', 'LAYER_SCHEMATIC_ANCHOR'],
  ['aux_items', 'LAYER_SCHEMATIC_AUX_ITEMS'],
  ['background', 'LAYER_SCHEMATIC_BACKGROUND'],
  ['hovered', 'LAYER_HOVERED'],
  ['brightened', 'LAYER_BRIGHTENED'],
  ['bus', 'LAYER_BUS'],
  ['bus_junction', 'LAYER_BUS_JUNCTION'],
  ['component_body', 'LAYER_DEVICE_BACKGROUND'],
  ['component_outline', 'LAYER_DEVICE'],
  ['cursor', 'LAYER_SCHEMATIC_CURSOR'],
  ['dnp_marker', 'LAYER_DNP_MARKER'],
  ['excluded_from_sim', 'LAYER_EXCLUDED_FROM_SIM'],
  ['erc_error', 'LAYER_ERC_ERR'],
  ['erc_warning', 'LAYER_ERC_WARN'],
  ['erc_exclusion', 'LAYER_ERC_EXCLUSION'],
  ['fields', 'LAYER_FIELDS'],
  ['grid', 'LAYER_SCHEMATIC_GRID'],
  ['grid_axes', 'LAYER_SCHEMATIC_GRID_AXES'],
  ['hidden', 'LAYER_HIDDEN'],
  ['junction', 'LAYER_JUNCTION'],
  ['label_global', 'LAYER_GLOBLABEL'],
  ['label_hier', 'LAYER_HIERLABEL'],
  ['label_local', 'LAYER_LOCLABEL'],
  ['netclass_flag', 'LAYER_NETCLASS_REFS'],
  ['drag_net_collision', 'LAYER_DRAG_NET_COLLISION'],
  ['rule_area', 'LAYER_RULE_AREAS'],
  ['no_connect', 'LAYER_NOCONNECT'],
  ['note', 'LAYER_NOTES'],
  ['private_note', 'LAYER_PRIVATE_NOTES'],
  ['note_background', 'LAYER_NOTES_BACKGROUND'],
  ['pin', 'LAYER_PIN'],
  ['pin_name', 'LAYER_PINNAM'],
  ['pin_number', 'LAYER_PINNUM'],
  ['reference', 'LAYER_REFERENCEPART'],
  ['shadow', 'LAYER_SELECTION_SHADOWS'],
  ['sheet', 'LAYER_SHEET'],
  ['sheet_background', 'LAYER_SHEET_BACKGROUND'],
  ['sheet_filename', 'LAYER_SHEETFILENAME'],
  ['sheet_fields', 'LAYER_SHEETFIELDS'],
  ['sheet_label', 'LAYER_SHEETLABEL'],
  ['sheet_name', 'LAYER_SHEETNAME'],
  ['value', 'LAYER_VALUEPART'],
  ['wire', 'LAYER_WIRE'],
  ['worksheet', 'LAYER_SCHEMATIC_DRAWINGSHEET'],
  ['page_limits', 'LAYER_SCHEMATIC_PAGE_LIMITS'],
  ['op_voltages', 'LAYER_OP_VOLTAGES'],
  ['op_currents', 'LAYER_OP_CURRENTS'],
];

/**
 * The `board` section's keys -> the layer id, `color_settings.cpp:124-244`, in
 * that file's own order and with the `board.` namespace stripped, exactly as
 * {@link SCHEMATIC_COLOR_KEYS} is.
 *
 * A dot inside a key is a NESTED object in the file, not a dotted name:
 * `JSON_SETTINGS` addresses a param by a `json_pointer` built from the path, so
 * `board.copper.f` is `{"board":{"copper":{"f": … }}}`. `~/.config/kicad/10.0/
 * colors/user.json` on this machine is that shape -- 86 flat keys and one
 * `copper` object of 32 -- and it is the ground truth this table was checked
 * against, not the C++ alone.
 *
 * The board namespace is what `PANEL_PCBNEW_COLOR_SETTINGS` and
 * `PANEL_FP_EDITOR_COLOR_SETTINGS` both write — `m_colorNamespace = "board"` —
 * so one section carries the colours of both those pages. Every key is here and
 * not only the ones a page shows a swatch for: `SaveToFile` stores every
 * registered param, so a real theme file names all 118 whichever page wrote it.
 *
 * The runs are written out rather than looped for the same reason the C++
 * writes them out: `board.copper.in13` is `In13_Cu` because the table says so,
 * and a loop would be asserting a pattern instead of mirroring a table.
 */
export const BOARD_COLOR_KEYS: readonly (readonly [string, ThemeLayerId])[] = [
  ['anchor', 'LAYER_ANCHOR'],
  ['locked_shadow', 'LAYER_LOCKED_ITEM_SHADOW'],
  ['conflicts_shadow', 'LAYER_CONFLICTS_SHADOW'],
  ['aux_items', 'LAYER_AUX_ITEMS'],
  ['background', 'LAYER_PCB_BACKGROUND'],
  ['cursor', 'LAYER_CURSOR'],
  ['drc_error', 'LAYER_DRC_ERROR'],
  ['drc_warning', 'LAYER_DRC_WARNING'],
  ['drc_exclusion', 'LAYER_DRC_EXCLUSION'],
  ['grid', 'LAYER_GRID'],
  ['grid_axes', 'LAYER_GRID_AXES'],
  ['pad_plated_hole', 'LAYER_PAD_PLATEDHOLES'],
  ['plated_hole', 'LAYER_NON_PLATEDHOLES'],
  ['ratsnest', 'LAYER_RATSNEST'],
  ['via_hole', 'LAYER_VIA_HOLES'],
  ['via_hole_walls', 'LAYER_VIA_HOLEWALLS'],
  ['worksheet', 'LAYER_DRAWINGSHEET'],
  ['page_limits', 'LAYER_PAGE_LIMITS'],
  ['outline_area', 'LAYER_BOARD_OUTLINE_AREA'],
  ['track_net_names', 'NETNAMES_LAYER_ID_START'],
  ['pad_net_names', 'LAYER_PAD_NETNAMES'],
  ['via_net_names', 'LAYER_VIA_NETNAMES'],
  ['points', 'LAYER_POINTS'],
  ['copper.f', 'F_Cu'],
  ['copper.in1', 'In1_Cu'],
  ['copper.in2', 'In2_Cu'],
  ['copper.in3', 'In3_Cu'],
  ['copper.in4', 'In4_Cu'],
  ['copper.in5', 'In5_Cu'],
  ['copper.in6', 'In6_Cu'],
  ['copper.in7', 'In7_Cu'],
  ['copper.in8', 'In8_Cu'],
  ['copper.in9', 'In9_Cu'],
  ['copper.in10', 'In10_Cu'],
  ['copper.in11', 'In11_Cu'],
  ['copper.in12', 'In12_Cu'],
  ['copper.in13', 'In13_Cu'],
  ['copper.in14', 'In14_Cu'],
  ['copper.in15', 'In15_Cu'],
  ['copper.in16', 'In16_Cu'],
  ['copper.in17', 'In17_Cu'],
  ['copper.in18', 'In18_Cu'],
  ['copper.in19', 'In19_Cu'],
  ['copper.in20', 'In20_Cu'],
  ['copper.in21', 'In21_Cu'],
  ['copper.in22', 'In22_Cu'],
  ['copper.in23', 'In23_Cu'],
  ['copper.in24', 'In24_Cu'],
  ['copper.in25', 'In25_Cu'],
  ['copper.in26', 'In26_Cu'],
  ['copper.in27', 'In27_Cu'],
  ['copper.in28', 'In28_Cu'],
  ['copper.in29', 'In29_Cu'],
  ['copper.in30', 'In30_Cu'],
  ['copper.b', 'B_Cu'],
  ['b_adhes', 'B_Adhes'],
  ['f_adhes', 'F_Adhes'],
  ['b_paste', 'B_Paste'],
  ['f_paste', 'F_Paste'],
  ['b_silks', 'B_SilkS'],
  ['f_silks', 'F_SilkS'],
  ['b_mask', 'B_Mask'],
  ['f_mask', 'F_Mask'],
  ['dwgs_user', 'Dwgs_User'],
  ['cmts_user', 'Cmts_User'],
  ['eco1_user', 'Eco1_User'],
  ['eco2_user', 'Eco2_User'],
  ['edge_cuts', 'Edge_Cuts'],
  ['margin', 'Margin'],
  ['b_crtyd', 'B_CrtYd'],
  ['f_crtyd', 'F_CrtYd'],
  ['b_fab', 'B_Fab'],
  ['f_fab', 'F_Fab'],
  ['user_1', 'User_1'],
  ['user_2', 'User_2'],
  ['user_3', 'User_3'],
  ['user_4', 'User_4'],
  ['user_5', 'User_5'],
  ['user_6', 'User_6'],
  ['user_7', 'User_7'],
  ['user_8', 'User_8'],
  ['user_9', 'User_9'],
  ['user_10', 'User_10'],
  ['user_11', 'User_11'],
  ['user_12', 'User_12'],
  ['user_13', 'User_13'],
  ['user_14', 'User_14'],
  ['user_15', 'User_15'],
  ['user_16', 'User_16'],
  ['user_17', 'User_17'],
  ['user_18', 'User_18'],
  ['user_19', 'User_19'],
  ['user_20', 'User_20'],
  ['user_21', 'User_21'],
  ['user_22', 'User_22'],
  ['user_23', 'User_23'],
  ['user_24', 'User_24'],
  ['user_25', 'User_25'],
  ['user_26', 'User_26'],
  ['user_27', 'User_27'],
  ['user_28', 'User_28'],
  ['user_29', 'User_29'],
  ['user_30', 'User_30'],
  ['user_31', 'User_31'],
  ['user_32', 'User_32'],
  ['user_33', 'User_33'],
  ['user_34', 'User_34'],
  ['user_35', 'User_35'],
  ['user_36', 'User_36'],
  ['user_37', 'User_37'],
  ['user_38', 'User_38'],
  ['user_39', 'User_39'],
  ['user_40', 'User_40'],
  ['user_41', 'User_41'],
  ['user_42', 'User_42'],
  ['user_43', 'User_43'],
  ['user_44', 'User_44'],
  ['user_45', 'User_45'],
];

/** `schematic.override_item_colors` (`color_settings.cpp:48-49`). */
export const OVERRIDE_ITEM_COLORS_KEY = 'override_item_colors';

/** What a theme file carries, as far as this app is concerned. */
export interface ColorThemeContents {
  /** `meta.name` — the name the theme chooser shows. */
  name: string;
  /** The `schematic` section. Only the layers the file actually named; the rest
   *  fall back to defaults, which is `COLOR_MAP_PARAM::Load`'s
   *  `aResetIfMissing`. */
  colors: Partial<Record<ThemeLayerId, string>>;
  /**
   * The `board` section, keyed the same way.
   *
   * Absent means the theme carries no board colours at all and the section is
   * left out of the file — which is not the same as an EMPTY one: a `board`
   * section present with default values tells KiCad to reset those layers, and
   * writing one from a page that never edited them is how a schematic theme
   * would quietly flatten a user's board palette.
   */
  board?: Partial<Record<ThemeLayerId, string>>;
  override: boolean;
}

/**
 * The theme as KiCad would have written it.
 *
 * Every layer is emitted, not only the ones that were changed: `Store()` runs
 * over every registered param, so a KiCad theme file always names all 47.
 * Each colour is re-spelled through `COLOR4D::ToCSSString` so that a colour
 * this app happens to hold as `rgba(0,0,0,0.5)` lands in the file as
 * `rgba(0, 0, 0, 0.502)`, the way KiCad writes it.
 */
/** nlohmann's object sorts its keys, at every level. */
function sortKeys(section: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(section).sort()) {
    const v = section[key];
    sorted[key] = typeof v === 'object' && v !== null ? sortKeys(v as Record<string, unknown>) : v;
  }
  return sorted;
}

/** Write one value at a `a.b.c` path, creating the objects on the way. */
function putAt(root: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.');
  let at = root;
  for (const part of parts.slice(0, -1)) {
    if (typeof at[part] !== 'object' || at[part] === null) at[part] = {};
    at = at[part] as Record<string, unknown>;
  }
  at[parts[parts.length - 1] as string] = value;
}

/** Read one value at a `a.b.c` path, or undefined if the path is not there. */
function getAt(root: Record<string, unknown>, path: string): unknown {
  let at: unknown = root;
  for (const part of path.split('.')) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

/** One namespace's worth of `CLR()` lines, every key emitted. */
function section(
  table: readonly (readonly [string, ThemeLayerId])[],
  colors: Partial<Record<ThemeLayerId, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, layer] of table) {
    // `s_defaultTheme` is a COLOR4D table; a colour this app already holds is a
    // CSS string. Both end up as the string `to_json` would have written.
    const value = colors[layer] ?? BUILTIN_DEFAULT_THEME[layer];
    putAt(out, key, toCssString(typeof value === 'string' ? parseColor4d(value) : value));
  }
  return out;
}

export function colorThemeToFile(contents: ColorThemeContents): Record<string, unknown> {
  const schematic = section(SCHEMATIC_COLOR_KEYS, contents.colors);
  schematic[OVERRIDE_ITEM_COLORS_KEY] = contents.override;

  return {
    meta: { name: contents.name, version: COLOR_THEME_SCHEMA_VERSION },
    ...(contents.board ? { board: sortKeys(section(BOARD_COLOR_KEYS, contents.board)) } : {}),
    schematic: sortKeys(schematic),
  };
}

/** `JSON.stringify` at nlohmann's `dump( 2 )`, with the trailing newline a
 *  `JSON_SETTINGS` file ends on. */
export function colorThemeFileText(contents: ColorThemeContents): string {
  return `${JSON.stringify(colorThemeToFile(contents), null, 2)}\n`;
}

/**
 * Read a theme file back. Returns null for anything that is not one — a
 * `.kicad_sch`, a truncated download — rather than throwing, because the caller
 * is a file the user picked and a bad pick is not an error condition.
 *
 * A key the file does not carry is simply absent from `colors`: that is
 * `aResetIfMissing`, which leaves the layer at its default rather than at
 * whatever the previous theme had.
 */
/** One section of the file back into a layer table, or null if it has none. */
function readSection(
  root: Record<string, unknown>,
  name: string,
  table: readonly (readonly [string, ThemeLayerId])[],
): { raw: Record<string, unknown>; colors: Partial<Record<ThemeLayerId, string>> } | null {
  const found = root[name];
  if (typeof found !== 'object' || found === null || Array.isArray(found)) return null;
  const raw = found as Record<string, unknown>;
  const colors: Partial<Record<ThemeLayerId, string>> = {};
  for (const [key, layer] of table) {
    const v = getAt(raw, key);
    if (typeof v === 'string' && v.trim() !== '') colors[layer] = v;
  }
  return { raw, colors };
}

export function colorThemeFromFile(parsed: unknown): ColorThemeContents | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const schematic = readSection(root, 'schematic', SCHEMATIC_COLOR_KEYS);
  const board = readSection(root, 'board', BOARD_COLOR_KEYS);
  // A real KiCad file carries both sections, but one this app wrote carries
  // only the namespaces the page that wrote it edits -- so either alone is a
  // theme, and neither is not.
  if (!schematic && !board) return null;
  const sch: Record<string, unknown> = schematic?.raw ?? {};
  const colors = schematic?.colors ?? {};

  const meta = root.meta;
  const name =
    typeof meta === 'object' &&
    meta !== null &&
    typeof (meta as { name?: unknown }).name === 'string'
      ? (meta as { name: string }).name
      : 'User';

  return {
    name,
    colors,
    ...(board ? { board: board.colors } : {}),
    override: sch[OVERRIDE_ITEM_COLORS_KEY] === true,
  };
}
