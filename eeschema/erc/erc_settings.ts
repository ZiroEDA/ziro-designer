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

import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_UNDEFINED,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/reporter.js';

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

/** `ERCE_T` (erc/erc_settings.h): the ERC error codes. */
export enum ERCE_T {
  ERCE_UNSPECIFIED = 0,
  ERCE_FIRST,
  ERCE_DUPLICATE_SHEET_NAME = ERCE_FIRST, ///< Duplicate sheet names within a given sheet.
  ERCE_ENDPOINT_OFF_GRID, ///< Pin or wire-end off grid.
  ERCE_PIN_NOT_CONNECTED, ///< Pin not connected and not no connect symbol.
  ERCE_PIN_NOT_DRIVEN, ///< Pin connected to some others pins but no pin to drive it.
  ERCE_POWERPIN_NOT_DRIVEN, ///< Power input pin connected to some others pins but no power out pin.
  ERCE_HIERACHICAL_LABEL, ///< Mismatch between hierarchical labels and pins sheets.
  ERCE_NOCONNECT_CONNECTED, ///< A no connect symbol is connected to more than 1 pin.
  ERCE_NOCONNECT_NOT_CONNECTED, ///< A no connect symbol is not connected to anything.
  ERCE_LABEL_NOT_CONNECTED, ///< Label not connected to any pins.
  ERCE_SIMILAR_LABELS, ///< 2 labels are equal for case insensitive comparisons.
  ERCE_SIMILAR_POWER, ///< 2 power pins are equal for case insensitive comparisons.
  ERCE_SIMILAR_LABEL_AND_POWER, ///< label and pin are equal for case insensitive comparisons.
  ERCE_SINGLE_GLOBAL_LABEL, ///< A label only exists once in the schematic.
  ERCE_SAME_LOCAL_GLOBAL_LABEL, ///< 2 labels are equal for case insensitive comparisons.
  ERCE_DIFFERENT_UNIT_FP, ///< Different units of the same symbol have different footprints.
  ERCE_MISSING_POWER_INPUT_PIN, ///< Symbol has power input pins that are not placed.
  ERCE_MISSING_INPUT_PIN, ///< Symbol has input pins that are not placed
  ERCE_MISSING_BIDI_PIN, ///< Symbol has bi-directional pins that are not placed
  ERCE_MISSING_UNIT, ///< Symbol has units that are not placed on the schematic
  ERCE_DIFFERENT_UNIT_NET, ///< Shared pin in a multi-unit symbol is connected to more than one net.
  ERCE_BUS_ALIAS_CONFLICT, ///< Conflicting bus alias definitions across sheets.
  ERCE_DRIVER_CONFLICT, ///< Conflicting drivers (labels, etc) on a subgraph.
  ERCE_BUS_ENTRY_CONFLICT, ///< A wire connected to a bus doesn't match the bus.
  ERCE_BUS_TO_BUS_CONFLICT, ///< A connection between bus objects doesn't share at least one net.
  ERCE_BUS_TO_NET_CONFLICT, ///< A bus wire is graphically connected to a net port/pin.
  ERCE_GROUND_PIN_NOT_GROUND, ///< A ground-labeled pin is not on a ground net.
  ERCE_LABEL_SINGLE_PIN, ///< A label is connected only to a single pin
  ERCE_UNRESOLVED_VARIABLE, ///< A text variable could not be resolved.
  ERCE_UNDEFINED_NETCLASS, ///< A netclass was referenced but not defined.
  ERCE_SIMULATION_MODEL, ///< An error was found in the simulation model.
  ERCE_WIRE_DANGLING, ///< Some wires are not connected to anything else.
  ERCE_LIB_SYMBOL_ISSUES, ///< Symbol not found in active libraries.
  ERCE_LIB_SYMBOL_MISMATCH, ///< Symbol doesn't match copy in library.
  ERCE_FOOTPRINT_LINK_ISSUES, ///< The footprint link is invalid.
  ERCE_FOOTPRINT_FILTERS, ///< The assigned footprint doesn't match the footprint filters
  ERCE_UNANNOTATED, ///< Symbol has not been annotated.
  ERCE_EXTRA_UNITS, ///< Symbol has more units than are defined.
  ERCE_DIFFERENT_UNIT_VALUE, ///< Units of same symbol have different values.
  ERCE_DUPLICATE_REFERENCE, ///< More than one symbol with the same reference.
  ERCE_BUS_ENTRY_NEEDED, ///< Importer failed to auto-place a bus entry.
  ERCE_FOUR_WAY_JUNCTION, ///< A four-way junction was found.
  ERCE_LABEL_MULTIPLE_WIRES, ///< A label is connected to more than one wire.
  ERCE_UNCONNECTED_WIRE_ENDPOINT, ///< A label is connected to more than one wire.
  ERCE_STACKED_PIN_SYNTAX, ///< Pin name resembles stacked pin notation.
  ERCE_FIELD_NAME_WHITESPACE, ///< Field name has leading or trailing whitespace.

  ERCE_LAST = ERCE_FIELD_NAME_WHITESPACE,

  ERCE_DUPLICATE_PIN_ERROR,
  ERCE_PIN_TO_PIN_WARNING, // pin connected to an other pin: warning level
  ERCE_PIN_TO_PIN_ERROR, // pin connected to an other pin: error level
  ERCE_ANNOTATION_ACTION, // Not actually an error; just an action performed during annotation
  ERCE_GENERIC_WARNING,
  ERCE_GENERIC_ERROR,
}

/**
 * `ERC_SETTINGS` (erc_settings.cpp), the live-model class: the per-error-code severity map
 * and its `GetSeverity` special cases. The `.kicad_pro` JSON params (`m_ERCSeverities`'
 * `rule_severities`, the pin map, exclusions) are the record model's `ErcSettings` above
 * until the project file is on the live model.
 */
export class ERC_SETTINGS {
  m_ERCSeverities: Map<number, Severity>;

  /// Serialized excluded ERC markers. A `std::set<wxString>` upstream, so it iterates in
  /// code-point order; read it through `sortedExclusions` wherever the order shows.
  m_ErcExclusions = new Set<string>();

  /// Map from serialization to comment.
  m_ErcExclusionComments = new Map<string, string>();

  constructor() {
    this.m_ERCSeverities = new Map();

    for (let i: number = ERCE_T.ERCE_FIRST; i <= ERCE_T.ERCE_LAST; ++i)
      this.m_ERCSeverities.set(i, RPT_SEVERITY_ERROR);

    // Error is the default setting so set non-error priorities here.
    const s = this.m_ERCSeverities;
    s.set(ERCE_T.ERCE_UNSPECIFIED, RPT_SEVERITY_UNDEFINED);
    s.set(ERCE_T.ERCE_ENDPOINT_OFF_GRID, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_PIN_TO_PIN_WARNING, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_SIMILAR_LABELS, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_SIMILAR_POWER, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_SIMILAR_LABEL_AND_POWER, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_SINGLE_GLOBAL_LABEL, RPT_SEVERITY_IGNORE);
    s.set(ERCE_T.ERCE_SAME_LOCAL_GLOBAL_LABEL, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_GROUND_PIN_NOT_GROUND, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_LABEL_SINGLE_PIN, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_DRIVER_CONFLICT, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_BUS_ENTRY_CONFLICT, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_LIB_SYMBOL_ISSUES, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_LIB_SYMBOL_MISMATCH, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_FOOTPRINT_LINK_ISSUES, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_FOOTPRINT_FILTERS, RPT_SEVERITY_IGNORE);
    s.set(ERCE_T.ERCE_NOCONNECT_CONNECTED, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_NOCONNECT_NOT_CONNECTED, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_MISSING_UNIT, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_MISSING_INPUT_PIN, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_MISSING_BIDI_PIN, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_SIMULATION_MODEL, RPT_SEVERITY_IGNORE);
    s.set(ERCE_T.ERCE_FOUR_WAY_JUNCTION, RPT_SEVERITY_IGNORE);
    s.set(ERCE_T.ERCE_LABEL_MULTIPLE_WIRES, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_UNCONNECTED_WIRE_ENDPOINT, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_STACKED_PIN_SYNTAX, RPT_SEVERITY_WARNING);
    s.set(ERCE_T.ERCE_FIELD_NAME_WHITESPACE, RPT_SEVERITY_WARNING);
  }

  IsTestEnabled(aErrorCode: number): boolean {
    return this.GetSeverity(aErrorCode) !== RPT_SEVERITY_IGNORE;
  }

  GetSeverity(aErrorCode: number): Severity {
    // Special-case duplicate pin error. Multiple pins with the same number are allowed
    // if they share the same net, but having them on different nets is always an error.
    if (aErrorCode === ERCE_T.ERCE_DUPLICATE_PIN_ERROR) {
      return RPT_SEVERITY_ERROR;
    }
    // Special-case pin-to-pin errors:
    // Ignore-or-not is controlled by ERCE_PIN_TO_PIN_WARNING (for both)
    // Warning-or-error is controlled by which errorCode it is
    else if (aErrorCode === ERCE_T.ERCE_PIN_TO_PIN_ERROR) {
      if (this.m_ERCSeverities.get(ERCE_T.ERCE_PIN_TO_PIN_WARNING) === RPT_SEVERITY_IGNORE)
        return RPT_SEVERITY_IGNORE;
      else return RPT_SEVERITY_ERROR;
    } else if (aErrorCode === ERCE_T.ERCE_PIN_TO_PIN_WARNING) {
      if (this.m_ERCSeverities.get(ERCE_T.ERCE_PIN_TO_PIN_WARNING) === RPT_SEVERITY_IGNORE)
        return RPT_SEVERITY_IGNORE;
      else return RPT_SEVERITY_WARNING;
    } else if (aErrorCode === ERCE_T.ERCE_GENERIC_WARNING) {
      return RPT_SEVERITY_WARNING;
    } else if (aErrorCode === ERCE_T.ERCE_GENERIC_ERROR) {
      return RPT_SEVERITY_ERROR;
    }

    // wxCHECK_MSG( m_ERCSeverities.count( aErrorCode ), RPT_SEVERITY_IGNORE, ... )
    return this.m_ERCSeverities.get(aErrorCode) ?? RPT_SEVERITY_IGNORE;
  }

  SetSeverity(aErrorCode: number, aSeverity: Severity): void {
    this.m_ERCSeverities.set(aErrorCode, aSeverity);
  }
}

/** `ERC_SETTINGS::m_ErcExclusions` in `std::set<wxString>` order (by code point). */
export function sortedExclusions(aSettings: ERC_SETTINGS): string[] {
  return [...aSettings.m_ErcExclusions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
