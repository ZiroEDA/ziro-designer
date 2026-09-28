// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZONE_CONNECTION` — how a pad meets the zone that pours over it.
 * Counterpart: `pcbnew/zones.h:46-53`.
 *
 * One table, because there is one enum: the file's number, the label
 * `ENUM_MAP<ZONE_CONNECTION>` registers (footprint.cpp:4852-4861), and the
 * order that map is built in, which is the order a wxPGChoices combo lists.
 * Two hand-written copies of the numbering had drifted before this file
 * existed — `footprint_properties.ts` and `pad_properties.ts` each carried
 * their own, and both were wrong the same way.
 *
 *     INHERITED = -1, NONE = 0, THERMAL = 1, FULL = 2, THT_THERMAL = 3
 *
 * `(zone_connect N)` is a plain `static_cast<int>` of that enum on the way out
 * (`pcb_io_kicad_sexpr.cpp`) and back in (`parsePAD`/`parseFOOTPRINT`, T_zone_connect),
 * so the number IS the enum value. INHERITED is never written: upstream's
 * writer emits the token only when the value differs from it.
 */

/** ZONE_CONNECTION, spelled as this model spells enums. */
export type ZoneConnection = 'inherited' | 'none' | 'thermal' | 'full' | 'tht_thermal';

/** `static_cast<int>( ZONE_CONNECTION )` — the number `(zone_connect …)` carries. */
export const ZONE_CONNECTION_CODE: Record<ZoneConnection, number> = {
  inherited: -1,
  none: 0,
  thermal: 1,
  full: 2,
  tht_thermal: 3,
};

/** The file's number back to the enum; anything else is "the file said nothing". */
export function zoneConnectionFromCode(code: number | undefined): ZoneConnection | undefined {
  for (const [name, value] of Object.entries(ZONE_CONNECTION_CODE))
    if (value === code) return name as ZoneConnection;
  return undefined;
}

/**
 * `ENUM_MAP<ZONE_CONNECTION>`'s entries, in the order they are Mapped — which is
 * the order the combo lists them, not alphabetical and not the enum's numeric
 * order (Solid is 2 but is listed after Thermal reliefs).
 */
export const ZONE_CONNECTION_CHOICES = [
  ['inherited', 'Inherited'],
  ['none', 'None'],
  ['thermal', 'Thermal reliefs'],
  ['full', 'Solid'],
  ['tht_thermal', 'Thermal reliefs for PTH'],
] as const satisfies readonly (readonly [ZoneConnection, string])[];
