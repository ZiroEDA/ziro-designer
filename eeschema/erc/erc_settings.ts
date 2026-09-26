// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ERC settings. Counterpart: `eeschema/erc/erc_settings.cpp` (ERC_SETTINGS),
 * the per-project electrical-rules configuration edited by the Schematic Setup
 * dialog: a severity (error / warning / ignore) for every ERC rule, and the
 * pin-to-pin conflict matrix. `runErc` reads these instead of hard-coded
 * defaults, so overriding a severity or a matrix cell changes the check.
 */

/** ELECTRICAL_PINTYPE order, the ERC matrix rows/columns and the pin-map grid. */
export const PIN_TYPES = [
  'input',
  'output',
  'bidirectional',
  'tri_state',
  'passive',
  'free',
  'unspecified',
  'power_in',
  'power_out',
  'open_collector',
  'open_emitter',
  'no_connect',
] as const;

export type PinTypeToken = (typeof PIN_TYPES)[number];

/** Index of a pin-type token in the matrix (unknown -> unspecified, as KiCad's parser). */
export function typeIndex(token: string): number {
  const i = PIN_TYPES.indexOf(token as PinTypeToken);
  return i === -1 ? 6 : i;
}

/** Short column headers for the Pin Conflicts Map grid (KiCad's abbreviations). */
export const TYPE_ABBREV: readonly string[] = [
  'I',
  'O',
  'Bi',
  '3S',
  'Pas',
  'NIC',
  'UnS',
  'PwrI',
  'PwrO',
  'OC',
  'OE',
  'NC',
];

export const OK = 0;
export const WAR = 1;
export const ERR = 2;
export type PinError = typeof OK | typeof WAR | typeof ERR;

/** ERC_SETTINGS::m_defaultPinMap, the default conflict matrix. */
export const DEFAULT_PIN_MAP: PinError[][] = [
  /*         I,   O,    Bi,   3S,   Pas,  NIC,  UnS,  PwrI, PwrO, OC,   OE,   NC */
  /* I  */ [OK, OK, OK, OK, OK, OK, WAR, OK, OK, OK, OK, ERR],
  /* O  */ [OK, ERR, OK, WAR, OK, OK, WAR, OK, ERR, ERR, ERR, ERR],
  /* Bi */ [OK, OK, OK, OK, OK, OK, WAR, OK, WAR, OK, WAR, ERR],
  /* 3S */ [OK, WAR, OK, OK, OK, OK, WAR, WAR, ERR, WAR, WAR, ERR],
  /*Pas */ [OK, OK, OK, OK, OK, OK, WAR, OK, OK, OK, OK, ERR],
  /*NIC */ [OK, OK, OK, OK, OK, OK, OK, OK, OK, OK, OK, ERR],
  /*UnS */ [WAR, WAR, WAR, WAR, WAR, OK, WAR, WAR, WAR, WAR, WAR, ERR],
  /*PwrI*/ [OK, OK, OK, WAR, OK, OK, WAR, OK, OK, OK, OK, ERR],
  /*PwrO*/ [OK, ERR, WAR, ERR, OK, OK, WAR, OK, ERR, ERR, ERR, ERR],
  /* OC */ [OK, ERR, OK, WAR, OK, OK, WAR, OK, ERR, OK, OK, ERR],
  /* OE */ [OK, ERR, WAR, WAR, OK, OK, WAR, OK, ERR, OK, OK, ERR],
  /* NC */ [ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR, ERR],
];

/**
 * The ERC rules, named by their settings key (`RC_ITEM::GetSettingsKey`, which is
 * what `.kicad_pro` stores). Every type in `ERC_ITEM::allItemTypes` is here, the
 * user-editable ones first, then the internal group, which carries a severity but
 * no Violation-Severity row and is never written to the project file.
 */
export type ErcCode =
  // Connections
  | 'pin_not_connected'
  | 'pin_not_driven'
  | 'power_pin_not_driven'
  | 'no_connect_connected'
  | 'no_connect_dangling'
  | 'label_dangling'
  | 'isolated_pin_label'
  | 'single_global_label'
  | 'same_local_global_label'
  | 'same_local_global_power'
  | 'wire_dangling'
  | 'bus_entry_needed'
  | 'endpoint_off_grid'
  | 'four_way_junction'
  | 'label_multiple_wires'
  | 'unconnected_wire_endpoint'
  // Conflicts
  | 'duplicate_reference'
  | 'pin_to_pin'
  | 'unit_value_mismatch'
  | 'different_unit_footprint'
  | 'different_unit_net'
  | 'duplicate_sheet_names'
  | 'hier_label_mismatch'
  | 'multiple_net_names'
  | 'bus_definition_conflict'
  | 'bus_to_bus_conflict'
  | 'bus_to_net_conflict'
  | 'net_not_bus_member'
  | 'ground_pin_not_ground'
  // Miscellaneous
  | 'stacked_pin_name'
  | 'field_name_whitespace'
  | 'pin_map_bad_pad'
  | 'pin_map_unmapped_pin'
  | 'pin_map_duplicate_pad'
  | 'pin_map_stale_pin'
  | 'unannotated'
  | 'unresolved_variable'
  | 'undefined_netclass'
  | 'simulation_model_issue'
  | 'similar_labels'
  | 'similar_power'
  | 'similar_label_and_power'
  | 'lib_symbol_issues'
  | 'lib_symbol_mismatch'
  | 'footprint_link_issues'
  | 'footprint_filter'
  | 'extra_units'
  | 'missing_unit'
  | 'missing_input_pin'
  | 'missing_bidi_pin'
  | 'missing_power_pin'
  // No user-editable severity (ERC_ITEM::heading_internal and below)
  | 'duplicate_pins'
  | 'pin_to_pin_error';

/** A violation's reported severity (an ignored rule is not emitted at all). */
export type ErcSeverity = 'error' | 'warning';
export type ErcSeverityLevel = ErcSeverity | 'ignore';

/** ERC_ITEM's three severity groups (heading_connections / _conflicts / _misc). */
export type ErcGroup = 'Connections' | 'Conflicts' | 'Miscellaneous';

/**
 * Violation-Severity panel rows: rule, label and group, `ERC_ITEM::allItemTypes`
 * up to `heading_internal` (`ERC_ITEM::GetItemsWithSeverities`), in upstream's
 * order and wording. These are also exactly the keys `.kicad_pro` stores under
 * `erc.rule_severities`; the types below `heading_internal` (duplicate_pins,
 * pin_to_pin_error, the generic ones) have no row and are not written.
 */
export const ERC_ITEMS: { code: ErcCode; title: string; group: ErcGroup }[] = [
  { code: 'pin_not_connected', title: 'Pin not connected', group: 'Connections' },
  {
    code: 'pin_not_driven',
    title: 'Input pin not driven by any Output pins',
    group: 'Connections',
  },
  {
    code: 'power_pin_not_driven',
    title: 'Input Power pin not driven by any Output Power pins',
    group: 'Connections',
  },
  {
    code: 'no_connect_connected',
    title: 'A pin with a "no connection" flag is connected',
    group: 'Connections',
  },
  { code: 'no_connect_dangling', title: 'Unconnected "no connection" flag', group: 'Connections' },
  { code: 'label_dangling', title: 'Label not connected', group: 'Connections' },
  { code: 'isolated_pin_label', title: 'Label connected to only one pin', group: 'Connections' },
  {
    code: 'single_global_label',
    title: 'Global label only appears once in the schematic',
    group: 'Connections',
  },
  {
    code: 'same_local_global_label',
    title: 'Local and global labels have same name',
    group: 'Connections',
  },
  {
    code: 'same_local_global_power',
    title: 'Local and global power symbols have same name',
    group: 'Connections',
  },
  { code: 'wire_dangling', title: 'Wires not connected to anything', group: 'Connections' },
  { code: 'bus_entry_needed', title: 'Bus Entry needed', group: 'Connections' },
  {
    code: 'endpoint_off_grid',
    title: 'Symbol pin or wire end off connection grid',
    group: 'Connections',
  },
  {
    code: 'four_way_junction',
    title: 'Four connection points are joined together',
    group: 'Connections',
  },
  {
    code: 'label_multiple_wires',
    title: 'Label connects more than one wire',
    group: 'Connections',
  },
  { code: 'unconnected_wire_endpoint', title: 'Unconnected wire endpoint', group: 'Connections' },

  { code: 'duplicate_reference', title: 'Duplicate reference designators', group: 'Conflicts' },
  { code: 'pin_to_pin', title: 'Conflict problem between pins', group: 'Conflicts' },
  {
    code: 'unit_value_mismatch',
    title: 'Units of same symbol have different values',
    group: 'Conflicts',
  },
  {
    code: 'different_unit_footprint',
    title: 'Different footprint assigned in another unit of the symbol',
    group: 'Conflicts',
  },
  {
    code: 'different_unit_net',
    title: 'Different net assigned to a shared pin in another unit of the symbol',
    group: 'Conflicts',
  },
  {
    code: 'duplicate_sheet_names',
    title: 'Duplicate sheet names within a given sheet',
    group: 'Conflicts',
  },
  {
    code: 'hier_label_mismatch',
    title: 'Mismatch between hierarchical labels and sheet pins',
    group: 'Conflicts',
  },
  {
    code: 'multiple_net_names',
    title: 'More than one name given to this bus or net',
    group: 'Conflicts',
  },
  {
    code: 'bus_definition_conflict',
    title: 'Conflict between bus alias definitions across schematic sheets',
    group: 'Conflicts',
  },
  {
    code: 'bus_to_bus_conflict',
    title: 'Buses are graphically connected but share no bus members',
    group: 'Conflicts',
  },
  {
    code: 'bus_to_net_conflict',
    title: 'Invalid connection between bus and net items',
    group: 'Conflicts',
  },
  {
    code: 'net_not_bus_member',
    title: 'Net is graphically connected to a bus but not a bus member',
    group: 'Conflicts',
  },
  {
    code: 'ground_pin_not_ground',
    title: 'Ground pin not connected to ground net',
    group: 'Conflicts',
  },

  { code: 'stacked_pin_name', title: 'Pin name resembles stacked pin', group: 'Miscellaneous' },
  {
    code: 'field_name_whitespace',
    title: 'Field name has leading or trailing whitespace',
    group: 'Miscellaneous',
  },
  {
    code: 'pin_map_bad_pad',
    title: 'Pin map references a pad that does not exist on the footprint',
    group: 'Miscellaneous',
  },
  {
    code: 'pin_map_unmapped_pin',
    title: 'Connected pin is not mapped to any footprint pad',
    group: 'Miscellaneous',
  },
  {
    code: 'pin_map_duplicate_pad',
    title: 'Two symbol pins are mapped to the same footprint pad',
    group: 'Miscellaneous',
  },
  {
    code: 'pin_map_stale_pin',
    title: 'Pin map references a pin number that no longer exists on the symbol',
    group: 'Miscellaneous',
  },
  { code: 'unannotated', title: 'Symbol is not annotated', group: 'Miscellaneous' },
  { code: 'unresolved_variable', title: 'Unresolved text variable', group: 'Miscellaneous' },
  { code: 'undefined_netclass', title: 'Undefined netclass', group: 'Miscellaneous' },
  { code: 'simulation_model_issue', title: 'SPICE model issue', group: 'Miscellaneous' },
  {
    code: 'similar_labels',
    title: 'Labels are similar (lower/upper case difference only)',
    group: 'Miscellaneous',
  },
  {
    code: 'similar_power',
    title: 'Power pins are similar (lower/upper case difference only)',
    group: 'Miscellaneous',
  },
  {
    code: 'similar_label_and_power',
    title: 'Power pin and label are similar (lower/upper case difference only)',
    group: 'Miscellaneous',
  },
  { code: 'lib_symbol_issues', title: 'Library symbol issue', group: 'Miscellaneous' },
  {
    code: 'lib_symbol_mismatch',
    title: "Symbol doesn't match copy in library",
    group: 'Miscellaneous',
  },
  { code: 'footprint_link_issues', title: 'Footprint link issue', group: 'Miscellaneous' },
  {
    code: 'footprint_filter',
    title: "Assigned footprint doesn't match footprint filters",
    group: 'Miscellaneous',
  },
  { code: 'extra_units', title: 'Symbol has more units than are defined', group: 'Miscellaneous' },
  { code: 'missing_unit', title: 'Symbol has units that are not placed', group: 'Miscellaneous' },
  {
    code: 'missing_input_pin',
    title: 'Symbol has input pins that are not placed',
    group: 'Miscellaneous',
  },
  {
    code: 'missing_bidi_pin',
    title: 'Symbol has bidirectional pins that are not placed',
    group: 'Miscellaneous',
  },
  {
    code: 'missing_power_pin',
    title: 'Symbol has power input pins that are not placed',
    group: 'Miscellaneous',
  },
];

/**
 * ERC_SETTINGS' constructor: every rule is an error unless it names another
 * default. Listed in ERC_ITEM::allItemTypes order, internal types last.
 */
export const DEFAULT_SEVERITIES: Record<ErcCode, ErcSeverityLevel> = {
  pin_not_connected: 'error',
  pin_not_driven: 'error',
  power_pin_not_driven: 'error',
  no_connect_connected: 'warning',
  no_connect_dangling: 'warning',
  label_dangling: 'error',
  isolated_pin_label: 'warning',
  single_global_label: 'ignore',
  same_local_global_label: 'warning',
  same_local_global_power: 'warning',
  wire_dangling: 'error',
  bus_entry_needed: 'error',
  endpoint_off_grid: 'warning',
  four_way_junction: 'ignore',
  label_multiple_wires: 'warning',
  unconnected_wire_endpoint: 'warning',

  duplicate_reference: 'error',
  pin_to_pin: 'warning',
  unit_value_mismatch: 'error',
  different_unit_footprint: 'error',
  different_unit_net: 'error',
  duplicate_sheet_names: 'error',
  hier_label_mismatch: 'error',
  multiple_net_names: 'warning',
  bus_definition_conflict: 'error',
  bus_to_bus_conflict: 'error',
  bus_to_net_conflict: 'error',
  net_not_bus_member: 'warning',
  ground_pin_not_ground: 'warning',

  stacked_pin_name: 'warning',
  field_name_whitespace: 'warning',
  pin_map_bad_pad: 'error',
  pin_map_unmapped_pin: 'warning',
  pin_map_duplicate_pad: 'error',
  pin_map_stale_pin: 'warning',
  unannotated: 'error',
  unresolved_variable: 'error',
  undefined_netclass: 'error',
  simulation_model_issue: 'ignore',
  similar_labels: 'warning',
  similar_power: 'warning',
  similar_label_and_power: 'warning',
  lib_symbol_issues: 'warning',
  lib_symbol_mismatch: 'warning',
  footprint_link_issues: 'warning',
  footprint_filter: 'ignore',
  extra_units: 'error',
  missing_unit: 'warning',
  missing_input_pin: 'warning',
  missing_bidi_pin: 'warning',
  missing_power_pin: 'error',

  duplicate_pins: 'error',
  pin_to_pin_error: 'error',
};

/** The full ERC configuration (ERC_SETTINGS). */
export interface ErcSettings {
  severities: Record<ErcCode, ErcSeverityLevel>;
  pinMap: PinError[][];
}

/** A fresh copy of the default ERC settings (deep, so edits don't share state). */
export function defaultErcSettings(): ErcSettings {
  return {
    severities: { ...DEFAULT_SEVERITIES },
    pinMap: DEFAULT_PIN_MAP.map((row) => [...row]),
  };
}
