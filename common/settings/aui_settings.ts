// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/settings/aui_settings.cpp` + `include/settings/aui_settings.h`: how
 * wx's geometry types are written into a settings file.
 *
 * Only the `wxPoint` and `wxSize` halves are here, because only they are
 * stored by anything in this port (`KICAD_SETTINGS`' `template.window.*`).
 * The `wxRect` and `wxAuiPaneInfo` serializers upstream exist for a saved AUI
 * perspective, which nothing here writes as JSON.
 */

import type { wxPoint } from '../wx/dc.js';
import type { JsonValue } from './json_settings_internals.js';

/** `wxSize`: `x` is the width and `y` the height, as wx's own members are. */
export interface wxSize {
  x: number;
  y: number;
}

/** `wxDefaultPosition`. */
export const wxDefaultPosition: Readonly<wxPoint> = { x: -1, y: -1 };

/** `wxDefaultSize`. */
export const wxDefaultSize: Readonly<wxSize> = { x: -1, y: -1 };

/** `to_json( nlohmann::json&, const wxPoint& )`. */
export function wxPointToJson(aPoint: wxPoint): JsonValue {
  return { x: aPoint.x, y: aPoint.y };
}

/**
 * `from_json( const nlohmann::json&, wxPoint& )`: `at( "x" ).get<int>()`
 * throws on a missing or non-numeric key, and so does this.
 */
export function wxPointFromJson(aJson: JsonValue): wxPoint {
  return { x: intAt(aJson, 'x'), y: intAt(aJson, 'y') };
}

/** `to_json( nlohmann::json&, const wxSize& )`. */
export function wxSizeToJson(aSize: wxSize): JsonValue {
  return { width: aSize.x, height: aSize.y };
}

/** `from_json( const nlohmann::json&, wxSize& )`. */
export function wxSizeFromJson(aJson: JsonValue): wxSize {
  return { x: intAt(aJson, 'width'), y: intAt(aJson, 'height') };
}

/** `aJson.at( aKey ).get<int>()`. */
function intAt(aJson: JsonValue, aKey: string): number {
  if (aJson === null || typeof aJson !== 'object' || Array.isArray(aJson))
    throw new TypeError(`type must be object, but is ${aJson === null ? 'null' : typeof aJson}`);

  const v = aJson[aKey];

  if (v === undefined) throw new RangeError(`key '${aKey}' not found`);

  if (typeof v !== 'number') throw new TypeError(`type must be number, but is ${typeof v}`);

  return Math.trunc(v);
}
