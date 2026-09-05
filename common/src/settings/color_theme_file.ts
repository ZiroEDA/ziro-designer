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
 * The key table is `color_settings.cpp:55-101` — KiCad's own data, mirrored
 * rather than invented, because the names in a theme file are a format and not
 * a choice. Only the `schematic` section is here: it is the one this app edits,
 * and writing an empty `board` section would tell KiCad to reset colours we
 * never had.
 *
 * Two layers are deliberately absent. `LAYER_INTERSHEET_REFS` and
 * `LAYER_SHAPES_BACKGROUND` have no `CLR()` line and no entry in
 * `s_defaultTheme`, which is why their swatches show the bare checkerboard —
 * a theme file has never carried them.
 */
import { parseColor4d, toCssString } from '../color4d.js';
import { BUILTIN_DEFAULT_THEME } from './builtin_color_themes.js';

/** A `SCH_LAYER_ID` enumerator, which is how a theme's colour table is keyed. */
export type SchLayerId = keyof typeof BUILTIN_DEFAULT_THEME;

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

/** `schematic.override_item_colors` (`color_settings.cpp:48-49`). */
export const OVERRIDE_ITEM_COLORS_KEY = 'override_item_colors';

/** What a theme file carries, as far as this app is concerned. */
export interface ColorThemeContents {
  /** `meta.name` — the name the theme chooser shows. */
  name: string;
  /** Only the layers the file actually named; the rest fall back to defaults,
   *  which is `COLOR_MAP_PARAM::Load`'s `aResetIfMissing`. */
  colors: Partial<Record<SchLayerId, string>>;
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
export function colorThemeToFile(contents: ColorThemeContents): Record<string, unknown> {
  const schematic: Record<string, string | boolean> = {};
  for (const [key, layer] of SCHEMATIC_COLOR_KEYS) {
    // `s_defaultTheme` is a COLOR4D table; a colour this app already holds is a
    // CSS string. Both end up as the string `to_json` would have written.
    const value = contents.colors[layer] ?? BUILTIN_DEFAULT_THEME[layer];
    schematic[key] = toCssString(typeof value === 'string' ? parseColor4d(value) : value);
  }
  schematic[OVERRIDE_ITEM_COLORS_KEY] = contents.override;

  const sorted: Record<string, string | boolean> = {};
  for (const key of Object.keys(schematic).sort()) sorted[key] = schematic[key] as string | boolean;

  return {
    meta: { name: contents.name, version: COLOR_THEME_SCHEMA_VERSION },
    schematic: sorted,
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
export function colorThemeFromFile(parsed: unknown): ColorThemeContents | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const section = root.schematic;
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return null;
  const sch = section as Record<string, unknown>;

  const colors: Partial<Record<SchLayerId, string>> = {};
  for (const [key, layer] of SCHEMATIC_COLOR_KEYS) {
    const v = sch[key];
    if (typeof v === 'string' && v.trim() !== '') colors[layer] = v;
  }

  const meta = root.meta;
  const name =
    typeof meta === 'object' &&
    meta !== null &&
    typeof (meta as { name?: unknown }).name === 'string'
      ? (meta as { name: string }).name
      : 'User';

  return { name, colors, override: sch[OVERRIDE_ITEM_COLORS_KEY] === true };
}
