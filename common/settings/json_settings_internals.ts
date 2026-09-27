// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/settings/json_settings_internals.h`: the JSON document a
 * `JSON_SETTINGS` wraps (`nlohmann::json` upstream) and the path helper.
 */

/** A JSON value as `nlohmann::json` would hold it. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** `JSON_SETTINGS_INTERNALS::PointerFromString`: dots to a segment list. */
export function PointerFromString(aPath: string): string[] {
  return aPath === '' ? [] : aPath.split('.');
}

/** `nlohmann::json::operator==`: structural equality. */
export function jsonEquals(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => jsonEquals(v, b[i]!));

  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) || Array.isArray(b)) return false;

    const ka = Object.keys(a);
    const kb = Object.keys(b);

    return (
      ka.length === kb.length && ka.every((k) => k in b && jsonEquals(a[k]!, (b as JsonObject)[k]!))
    );
  }

  return false;
}
