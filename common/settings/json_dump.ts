// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `buffer << std::setw( 2 ) << json << std::endl` — how `JSON_SETTINGS::SaveToFile`
 * writes a settings file, byte for byte: nlohmann's `dump( 2 )`.
 *
 * Objects are `std::map`, so keys come out sorted by code point; arrays put
 * one element per line; an empty container is `[]` / `{}`; a `double` that
 * holds an integer prints with `.0` (`1.0`, not `1`). JavaScript has one
 * number type, so which keys hold a `double` in KiCad is a table here
 * ([data], the param types of project_file.cpp, board_design_settings.cpp,
 * net_settings.cpp, tuning_profiles.cpp and project_local_settings.cpp).
 */
import type { JsonValue } from './json_settings.js';

/**
 * [data] Keys whose value is a C++ `double` in the project and local-settings
 * files: every `PARAM_SCALED`, `PARAM<double>`, and the lambda-written mm
 * values. A key not listed prints as an integer when integral.
 */
const DOUBLE_KEYS: ReadonlySet<string> = new Set([
  // board_design_settings.cpp: rules.* (PARAM_SCALED) and defaults.*
  'min_clearance',
  'min_connection',
  'min_track_width',
  'min_via_annular_width',
  'min_via_diameter',
  'min_through_hole_diameter',
  'min_microvia_diameter',
  'min_microvia_drill',
  'min_hole_to_hole',
  'min_hole_clearance',
  'min_silk_clearance',
  'min_groove_width',
  'min_text_height',
  'min_text_thickness',
  'min_copper_edge_clearance',
  'max_error',
  'solder_mask_to_copper_clearance',
  'silk_line_width',
  'silk_text_size_v',
  'silk_text_size_h',
  'silk_text_thickness',
  'copper_line_width',
  'copper_text_size_v',
  'copper_text_size_h',
  'copper_text_thickness',
  'board_outline_line_width',
  'courtyard_line_width',
  'fab_line_width',
  'fab_text_size_v',
  'fab_text_size_h',
  'fab_text_thickness',
  'other_line_width',
  'other_text_size_v',
  'other_text_size_h',
  'other_text_thickness',
  'min_thickness',
  'hatch_thickness',
  'hatch_gap',
  'hatch_orientation',
  'hatch_smoothing_value',
  'border_hatch_pitch',
  'thermal_relief_gap',
  'thermal_relief_spoke_width',
  'corner_radius',
  'min_island_area',
  'width',
  'height',
  'drill',
  'diameter',
  'gap',
  'via_gap',
  'td_maxlen',
  'td_maxheight',
  'td_length_ratio',
  'td_height_ratio',
  'td_width_to_size_filter_ratio',
  'min_amplitude',
  'max_amplitude',
  'spacing',
  // net_settings.cpp: saveNetclass's pcb-unit values (IUTomm)
  'clearance',
  'track_width',
  'via_diameter',
  'via_drill',
  'microvia_diameter',
  'microvia_drill',
  'diff_pair_width',
  'diff_pair_gap',
  'diff_pair_via_gap',
  // tuning_profiles.cpp
  'target_impedance',
  // project_local_settings.cpp: PARAM<double>
  'tracks',
  'vias',
  'pads',
  'zones',
  'images',
  'shapes',
  // board_project_settings.cpp: VIEWPORT (BOX2D) and VIEWPORT3D (glm::mat4)
  'x',
  'y',
  'w',
  'h',
  // schematic_settings.cpp / erc settings written into the same file
  'dashed_lines_dash_length_ratio',
  'dashed_lines_gap_length_ratio',
  'default_line_thickness',
  'default_text_size',
  'label_size_ratio',
  'overbar_offset_ratio',
  'pin_symbol_size',
  'text_offset_ratio',
  'connection_grid_size',
]);

/** The 3D viewport matrix keys, `xx` … `ww`. */
const MAT4_KEY = /^[xyzw][xyzw]$/;

/** Arrays whose elements are doubles (`track_widths`: `IUTomm` per entry). */
const DOUBLE_ARRAYS: ReadonlySet<string> = new Set(['track_widths']);

/**
 * Objects whose numbers are all integers whatever the key says: a tuning
 * profile's `layer_entries` (`width`, `diff_pair_gap`, `delay` in IU) and
 * `via_overrides` (`delay`).
 */
const INT_OBJECTS: ReadonlySet<string> = new Set(['layer_entries', 'via_overrides']);

/**
 * `nlohmann::detail::serializer::dump_float`: the shortest round-trip form
 * (`std::to_chars`), then `.0` appended when nothing marks it as a float.
 * `to_chars` spells an exponent `1e-07`; JavaScript spells it `1e-7`.
 */
export function DumpDouble(aValue: number): string {
  if (!Number.isFinite(aValue)) return 'null';

  let s = String(aValue);

  if (s.includes('e')) {
    // 1e-7 -> 1e-07, 1.5e+21 -> 1.5e+21
    s = s.replace(/e([+-]?)(\d)$/, (_m, sign: string, d: string) => `e${sign || '+'}0${d}`);
    return s;
  }

  if (!s.includes('.')) s += '.0';

  return s;
}

function dumpNumber(
  aValue: number,
  aKey: string | null,
  aInDoubleArray: boolean,
  aIntObject: boolean,
): string {
  if (aInDoubleArray) return DumpDouble(aValue);

  if (!aIntObject && aKey !== null && (DOUBLE_KEYS.has(aKey) || MAT4_KEY.test(aKey)))
    return DumpDouble(aValue);

  if (!Number.isFinite(aValue)) return 'null';

  return Number.isInteger(aValue) ? String(aValue) : DumpDouble(aValue);
}

function dumpValue(
  aValue: JsonValue,
  aIndent: number,
  aDepth: number,
  aKey: string | null,
  aInDoubleArray: boolean,
  aIntObject: boolean,
): string {
  if (aValue === null) return 'null';
  if (typeof aValue === 'boolean') return aValue ? 'true' : 'false';
  if (typeof aValue === 'number') return dumpNumber(aValue, aKey, aInDoubleArray, aIntObject);
  if (typeof aValue === 'string') return JSON.stringify(aValue);

  const pad = ' '.repeat(aIndent * (aDepth + 1));
  const close = ' '.repeat(aIndent * aDepth);

  if (Array.isArray(aValue)) {
    if (aValue.length === 0) return '[]';

    const inDoubles = aKey !== null && DOUBLE_ARRAYS.has(aKey);
    const intObject = aKey !== null && INT_OBJECTS.has(aKey);
    const items = aValue.map(
      (v) => pad + dumpValue(v, aIndent, aDepth + 1, null, inDoubles, intObject),
    );

    return `[\n${items.join(',\n')}\n${close}]`;
  }

  const keys = Object.keys(aValue).sort(codepointCompare);

  if (keys.length === 0) return '{}';

  const items = keys.map(
    (k) =>
      `${pad}${JSON.stringify(k)}: ${dumpValue(aValue[k]!, aIndent, aDepth + 1, k, false, aIntObject)}`,
  );

  return `{\n${items.join(',\n')}\n${close}}`;
}

/** `std::map<std::string, …>`: `operator<` on `std::string`, i.e. by code unit. */
function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `json.dump( 2 )` + the `std::endl`. */
export function DumpJson(aValue: JsonValue): string {
  return `${dumpValue(aValue, 2, 0, null, false, false)}\n`;
}
