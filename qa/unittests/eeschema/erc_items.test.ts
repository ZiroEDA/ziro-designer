/**
 * The Violation Severity list must stay identical to KiCad's — the same rules,
 * in the same order, under the same headings, with the same settings keys
 * (which is what `.kicad_pro` stores) and the same default severities.
 *
 * The table below is `ERC_ITEM::allItemTypes` (eeschema/erc/erc_item.cpp) up to
 * `heading_internal`, i.e. `ERC_ITEM::GetItemsWithSeverities()`, transcribed
 * with each item's `_HKI` title and `wxT` settings key; the severities are
 * `ERC_SETTINGS`'s constructor (erc_settings.cpp), which starts every rule at
 * error and then names the exceptions.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SEVERITIES,
  ERC_ITEMS,
  type ErcCode,
} from '@ziroeda/eeschema/src/erc/erc_settings.js';

const UPSTREAM: [group: string, key: string, title: string, severity: string][] = [
  ['Connections', 'pin_not_connected', 'Pin not connected', 'error'],
  ['Connections', 'pin_not_driven', 'Input pin not driven by any Output pins', 'error'],
  [
    'Connections',
    'power_pin_not_driven',
    'Input Power pin not driven by any Output Power pins',
    'error',
  ],
  [
    'Connections',
    'no_connect_connected',
    'A pin with a "no connection" flag is connected',
    'warning',
  ],
  ['Connections', 'no_connect_dangling', 'Unconnected "no connection" flag', 'warning'],
  ['Connections', 'label_dangling', 'Label not connected', 'error'],
  ['Connections', 'isolated_pin_label', 'Label connected to only one pin', 'warning'],
  [
    'Connections',
    'single_global_label',
    'Global label only appears once in the schematic',
    'ignore',
  ],
  ['Connections', 'same_local_global_label', 'Local and global labels have same name', 'warning'],
  [
    'Connections',
    'same_local_global_power',
    'Local and global power symbols have same name',
    'warning',
  ],
  ['Connections', 'wire_dangling', 'Wires not connected to anything', 'error'],
  ['Connections', 'bus_entry_needed', 'Bus Entry needed', 'error'],
  ['Connections', 'endpoint_off_grid', 'Symbol pin or wire end off connection grid', 'warning'],
  ['Connections', 'four_way_junction', 'Four connection points are joined together', 'ignore'],
  ['Connections', 'label_multiple_wires', 'Label connects more than one wire', 'warning'],
  ['Connections', 'unconnected_wire_endpoint', 'Unconnected wire endpoint', 'warning'],

  ['Conflicts', 'duplicate_reference', 'Duplicate reference designators', 'error'],
  ['Conflicts', 'pin_to_pin', 'Conflict problem between pins', 'warning'],
  ['Conflicts', 'unit_value_mismatch', 'Units of same symbol have different values', 'error'],
  [
    'Conflicts',
    'different_unit_footprint',
    'Different footprint assigned in another unit of the symbol',
    'error',
  ],
  [
    'Conflicts',
    'different_unit_net',
    'Different net assigned to a shared pin in another unit of the symbol',
    'error',
  ],
  ['Conflicts', 'duplicate_sheet_names', 'Duplicate sheet names within a given sheet', 'error'],
  [
    'Conflicts',
    'hier_label_mismatch',
    'Mismatch between hierarchical labels and sheet pins',
    'error',
  ],
  ['Conflicts', 'multiple_net_names', 'More than one name given to this bus or net', 'warning'],
  [
    'Conflicts',
    'bus_definition_conflict',
    'Conflict between bus alias definitions across schematic sheets',
    'error',
  ],
  [
    'Conflicts',
    'bus_to_bus_conflict',
    'Buses are graphically connected but share no bus members',
    'error',
  ],
  ['Conflicts', 'bus_to_net_conflict', 'Invalid connection between bus and net items', 'error'],
  [
    'Conflicts',
    'net_not_bus_member',
    'Net is graphically connected to a bus but not a bus member',
    'warning',
  ],
  ['Conflicts', 'ground_pin_not_ground', 'Ground pin not connected to ground net', 'warning'],

  ['Miscellaneous', 'stacked_pin_name', 'Pin name resembles stacked pin', 'warning'],
  [
    'Miscellaneous',
    'field_name_whitespace',
    'Field name has leading or trailing whitespace',
    'warning',
  ],
  [
    'Miscellaneous',
    'pin_map_bad_pad',
    'Pin map references a pad that does not exist on the footprint',
    'error',
  ],
  [
    'Miscellaneous',
    'pin_map_unmapped_pin',
    'Connected pin is not mapped to any footprint pad',
    'warning',
  ],
  [
    'Miscellaneous',
    'pin_map_duplicate_pad',
    'Two symbol pins are mapped to the same footprint pad',
    'error',
  ],
  [
    'Miscellaneous',
    'pin_map_stale_pin',
    'Pin map references a pin number that no longer exists on the symbol',
    'warning',
  ],
  ['Miscellaneous', 'unannotated', 'Symbol is not annotated', 'error'],
  ['Miscellaneous', 'unresolved_variable', 'Unresolved text variable', 'error'],
  ['Miscellaneous', 'undefined_netclass', 'Undefined netclass', 'error'],
  ['Miscellaneous', 'simulation_model_issue', 'SPICE model issue', 'ignore'],
  [
    'Miscellaneous',
    'similar_labels',
    'Labels are similar (lower/upper case difference only)',
    'warning',
  ],
  [
    'Miscellaneous',
    'similar_power',
    'Power pins are similar (lower/upper case difference only)',
    'warning',
  ],
  [
    'Miscellaneous',
    'similar_label_and_power',
    'Power pin and label are similar (lower/upper case difference only)',
    'warning',
  ],
  ['Miscellaneous', 'lib_symbol_issues', 'Library symbol issue', 'warning'],
  ['Miscellaneous', 'lib_symbol_mismatch', "Symbol doesn't match copy in library", 'warning'],
  ['Miscellaneous', 'footprint_link_issues', 'Footprint link issue', 'warning'],
  [
    'Miscellaneous',
    'footprint_filter',
    "Assigned footprint doesn't match footprint filters",
    'ignore',
  ],
  ['Miscellaneous', 'extra_units', 'Symbol has more units than are defined', 'error'],
  ['Miscellaneous', 'missing_unit', 'Symbol has units that are not placed', 'warning'],
  ['Miscellaneous', 'missing_input_pin', 'Symbol has input pins that are not placed', 'warning'],
  [
    'Miscellaneous',
    'missing_bidi_pin',
    'Symbol has bidirectional pins that are not placed',
    'warning',
  ],
  [
    'Miscellaneous',
    'missing_power_pin',
    'Symbol has power input pins that are not placed',
    'error',
  ],
];

describe('ERC_ITEM::GetItemsWithSeverities', () => {
  it('lists exactly KiCad 10 rules, in order, with the same titles and groups', () => {
    expect(ERC_ITEMS.map((i) => [i.group, i.code, i.title])).toEqual(
      UPSTREAM.map(([group, key, title]) => [group, key, title]),
    );
  });

  it('starts every rule at ERC_SETTINGS default severity', () => {
    for (const [, key, , severity] of UPSTREAM) {
      expect([key, DEFAULT_SEVERITIES[key as ErcCode]]).toEqual([key, severity]);
    }
  });

  it('keeps the internal types out of the list but severity-bearing', () => {
    // heading_internal and below: no Violation Severity row, never written to
    // the project file, but still consulted when a violation is raised.
    expect(ERC_ITEMS.some((i) => i.code === 'duplicate_pins')).toBe(false);
    expect(ERC_ITEMS.some((i) => i.code === 'pin_to_pin_error')).toBe(false);
    expect(DEFAULT_SEVERITIES.duplicate_pins).toBe('error');
    expect(DEFAULT_SEVERITIES.pin_to_pin_error).toBe('error');
  });
});
