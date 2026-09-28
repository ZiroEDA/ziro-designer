// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/rc_json_schema.h`: the JSON report structures a DRC/ERC run writes.
 * The `to_json` shapes are these objects' own fields, in this order.
 */

export interface COORDINATE {
  x: number;
  y: number;
}

export interface AFFECTED_ITEM {
  uuid: string;
  description: string;
  pos: COORDINATE;
}

export interface VIOLATION {
  type: string;
  description: string;
  severity: string;
  items: AFFECTED_ITEM[];
  excluded: boolean;
  comment: string; // exclusion comment; if any
}

/** `to_json( nlohmann::json&, const VIOLATION& )`: the key order the report writes. */
export function violationToJson(aViolation: VIOLATION): Record<string, unknown> {
  const aJson: Record<string, unknown> = {};
  aJson.type = aViolation.type;
  aJson.description = aViolation.description;
  aJson.severity = aViolation.severity;
  aJson.items = aViolation.items;

  if (aViolation.excluded) {
    aJson.excluded = aViolation.excluded;
    aJson.comment = aViolation.comment;
  }

  return aJson;
}

/** `from_json( const nlohmann::json&, VIOLATION& )`. */
export function violationFromJson(aJson: Record<string, unknown>): VIOLATION {
  return {
    type: aJson.type as string,
    description: aJson.description as string,
    severity: aJson.severity as string,
    items: aJson.items as AFFECTED_ITEM[],
    excluded: aJson.excluded as boolean,
    comment: aJson.comment as string,
  };
}

export interface IGNORED_CHECK {
  key: string;
  description: string;
}

export interface REPORT_BASE {
  $schema: string;
  source: string;
  date: string;
  kicad_version: string;
  type: string;
  coordinate_units: string;
}

/** `DRC_REPORT() { type = "drc"; }`. */
export interface DRC_REPORT extends REPORT_BASE {
  violations: VIOLATION[];
  unconnected_items: VIOLATION[];
  schematic_parity: VIOLATION[];
  included_severities: string[];
  ignored_checks: IGNORED_CHECK[];
}

export interface ERC_SHEET {
  uuid_path: string;
  path: string;
  violations: VIOLATION[];
}

/** `ERC_REPORT() { type = "erc"; }`. */
export interface ERC_REPORT extends REPORT_BASE {
  sheets: ERC_SHEET[];
  included_severities: string[];
  ignored_checks: IGNORED_CHECK[];
}
