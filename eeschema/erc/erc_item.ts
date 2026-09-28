// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/erc/erc_item.h` / `erc_item.cpp`: `ERC_ITEM`, an `RC_ITEM` for ERC
 * violations that also remembers the sheet paths it applies to, with the
 * static table of every ERC error type.
 *
 * The static items are the DATA table KiCad itself hardcodes (title and
 * settings key per code). `erc_settings.ts`' `ERC_ITEMS` is the record
 * model's copy of the same table (keys only); both mirror `allItemTypes`.
 * `ERCE_T` lives in `erc_settings.ts`, beside `ERC_SETTINGS`, as upstream.
 *
 * Not here: `ERC_TREE_MODEL::GetValue` (the dialog's per-sheet description;
 * the ERC dialog is not on the live model yet).
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RC_ITEM } from '@ziroeda/common/rc_item.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import { ERCE_T } from './erc_settings.js';

export class ERC_ITEM extends RC_ITEM {
  private m_mainItemSheet: SCH_SHEET_PATH | null = null;
  private m_auxItemSheet: SCH_SHEET_PATH | null = null;

  /// True if this item is specific to a sheet instance (as opposed to applying to all instances)
  private m_sheetSpecificPath: SCH_SHEET_PATH | null = null;

  /** `ERC_ITEM( int aErrorCode, const wxString& aTitle, const wxString& aSettingsKey )`. */
  private constructor(aErrorCode = 0, aTitle = '', aSettingsKey = '') {
    super();
    this.m_errorCode = aErrorCode;
    this.m_errorTitle = aTitle;
    this.m_settingsKey = aSettingsKey;
  }

  /** `std::make_shared<ERC_ITEM>( item )`: the compiler-generated copy of a template. */
  private static copyOf(aItem: ERC_ITEM): ERC_ITEM {
    const item = new ERC_ITEM();
    item.m_errorCode = aItem.m_errorCode;
    item.m_errorMessage = aItem.m_errorMessage;
    item.m_errorTitle = aItem.m_errorTitle;
    item.m_settingsKey = aItem.m_settingsKey;
    item.m_parent = aItem.m_parent;
    item.m_ids = [...aItem.m_ids];
    item.m_mainItemSheet = aItem.m_mainItemSheet?.Clone() ?? null;
    item.m_auxItemSheet = aItem.m_auxItemSheet?.Clone() ?? null;
    item.m_sheetSpecificPath = aItem.m_sheetSpecificPath?.Clone() ?? null;
    return item;
  }

  /**
   * Constructs an ERC_ITEM for the given error code, or from a settings key (the untranslated
   * string that names an error code in settings files and ERC exclusions).
   * @see ERCE_T
   */
  static Create(aErrorCode: number): ERC_ITEM | null;
  static Create(aErrorKey: string): ERC_ITEM | null;
  static Create(a: number | string): ERC_ITEM | null {
    if (typeof a === 'string') {
      for (const item of ERC_ITEM.allItemTypes) {
        if (a === item.GetSettingsKey()) return ERC_ITEM.copyOf(item);
      }

      return null;
    }

    const template = ERC_ITEM.byCode().get(a);

    if (template === undefined) {
      console.assert(false, 'Unknown ERC error code'); // wxFAIL_MSG
      return null;
    }

    return ERC_ITEM.copyOf(template);
  }

  static GetItemsWithSeverities(): RC_ITEM[] {
    if (ERC_ITEM.itemsWithSeverities.length === 0) {
      for (const item of ERC_ITEM.allItemTypes) {
        if (item === ERC_ITEM.heading_internal) break;

        ERC_ITEM.itemsWithSeverities.push(item);
      }
    }

    return ERC_ITEM.itemsWithSeverities;
  }

  private static itemsWithSeverities: RC_ITEM[] = [];

  /**
   * Determines whether the ERC item is bound to a specific sheet, or is common across multiple
   * sheets (e.g. whether the error is internal to a hierarchical sheet, or is due to an enclosing
   * context interacting with the hierarchical sheet)
   */
  IsSheetSpecific(): boolean {
    return this.m_sheetSpecificPath !== null;
  }

  SetSheetSpecificPath(aSpecificSheet: SCH_SHEET_PATH): void {
    this.m_sheetSpecificPath = aSpecificSheet.Clone();
  }

  GetSpecificSheetPath(): SCH_SHEET_PATH {
    console.assert(this.m_sheetSpecificPath !== null);
    return this.m_sheetSpecificPath!;
  }

  /**
   * Sets the SCH_SHEET_PATH of the main (and auxiliary) items causing this ERC violation. This
   * allows violations to be specific to particular uses of shared hierarchical schematics.
   */
  SetItemsSheetPaths(mainItemSheet: SCH_SHEET_PATH, auxItemSheet?: SCH_SHEET_PATH): void {
    this.m_mainItemSheet = mainItemSheet.Clone();

    if (auxItemSheet) this.m_auxItemSheet = auxItemSheet.Clone();
  }

  GetMainItemSheetPath(): SCH_SHEET_PATH {
    console.assert(this.MainItemHasSheetPath());
    return this.m_mainItemSheet!;
  }

  GetAuxItemSheetPath(): SCH_SHEET_PATH {
    console.assert(this.AuxItemHasSheetPath());
    return this.m_auxItemSheet!;
  }

  MainItemHasSheetPath(): boolean {
    return this.m_mainItemSheet !== null;
  }

  AuxItemHasSheetPath(): boolean {
    return this.m_auxItemSheet !== null;
  }

  /**
   * Resolve the affected-item description in the per-instance SCH_SHEET_PATH context stored on
   * this marker, so headless callers show the same per-sheet symbol references the GUI ERC
   * dialog shows on hierarchical schematics.
   */
  protected override getItemDescription(
    aItem: EDA_ITEM,
    aIndex: number,
    aUnitsProvider: UNITS_PROVIDER,
  ): string {
    const schItem = aItem as unknown as Partial<SCH_ITEM>; // dynamic_cast<SCH_ITEM*>
    const sch = typeof schItem.Schematic === 'function' ? schItem.Schematic() : null;

    const itemSheet = aIndex === 0 ? this.m_mainItemSheet : this.m_auxItemSheet;

    if (!sch || !itemSheet || sch.CurrentSheet().equals(itemSheet))
      return super.getItemDescription(aItem, aIndex, aUnitsProvider);

    // Temporarily point the schematic at the affected item's sheet so per-instance
    // fields (notably the symbol reference) resolve to the same text the GUI ERC
    // dialog shows.  Mirrors the lambda in ERC_TREE_MODEL::GetValue.
    const savedSheet = sch.CurrentSheet().Clone();
    const targetSheet = itemSheet.Clone();

    sch.SetCurrentSheet(targetSheet);
    targetSheet.UpdateAllScreenReferences();

    const desc = super.getItemDescription(aItem, aIndex, aUnitsProvider);

    sch.SetCurrentSheet(savedSheet);
    savedSheet.UpdateAllScreenReferences();

    return desc;
  }

  // These, being statically-defined, require specialized I18N handling.
  // NOTE: Avoid changing the settings key for an ERC item after it has been created

  static readonly heading_connections = new ERC_ITEM(0, 'Connections', '');
  static readonly heading_conflicts = new ERC_ITEM(0, 'Conflicts', '');
  static readonly heading_misc = new ERC_ITEM(0, 'Miscellaneous', '');
  static readonly heading_internal = new ERC_ITEM(0, '', '');

  static readonly duplicateSheetName = new ERC_ITEM(
    ERCE_T.ERCE_DUPLICATE_SHEET_NAME,
    'Duplicate sheet names within a given sheet',
    'duplicate_sheet_names',
  );
  static readonly endpointOffGrid = new ERC_ITEM(
    ERCE_T.ERCE_ENDPOINT_OFF_GRID,
    'Symbol pin or wire end off connection grid',
    'endpoint_off_grid',
  );
  static readonly pinNotConnected = new ERC_ITEM(
    ERCE_T.ERCE_PIN_NOT_CONNECTED,
    'Pin not connected',
    'pin_not_connected',
  );
  static readonly pinNotDriven = new ERC_ITEM(
    ERCE_T.ERCE_PIN_NOT_DRIVEN,
    'Input pin not driven by any Output pins',
    'pin_not_driven',
  );
  static readonly powerpinNotDriven = new ERC_ITEM(
    ERCE_T.ERCE_POWERPIN_NOT_DRIVEN,
    'Input Power pin not driven by any Output Power pins',
    'power_pin_not_driven',
  );
  static readonly duplicatePinError = new ERC_ITEM(
    ERCE_T.ERCE_DUPLICATE_PIN_ERROR,
    'Duplicate pins with different nets',
    'duplicate_pins',
  );
  static readonly pinTableWarning = new ERC_ITEM(
    ERCE_T.ERCE_PIN_TO_PIN_WARNING,
    'Conflict problem between pins',
    'pin_to_pin',
  );
  static readonly pinTableError = new ERC_ITEM(
    ERCE_T.ERCE_PIN_TO_PIN_ERROR,
    'Conflict problem between pins',
    'pin_to_pin',
  );
  static readonly genericWarning = new ERC_ITEM(
    ERCE_T.ERCE_GENERIC_WARNING,
    'Warning',
    'generic-warning',
  );
  static readonly genericError = new ERC_ITEM(ERCE_T.ERCE_GENERIC_ERROR, 'Error', 'generic-error');
  static readonly hierLabelMismatch = new ERC_ITEM(
    ERCE_T.ERCE_HIERACHICAL_LABEL,
    'Mismatch between hierarchical labels and sheet pins',
    'hier_label_mismatch',
  );
  static readonly fourWayJunction = new ERC_ITEM(
    ERCE_T.ERCE_FOUR_WAY_JUNCTION,
    'Four connection points are joined together',
    'four_way_junction',
  );
  static readonly labelMultipleWires = new ERC_ITEM(
    ERCE_T.ERCE_LABEL_MULTIPLE_WIRES,
    'Label connects more than one wire',
    'label_multiple_wires',
  );
  static readonly noConnectConnected = new ERC_ITEM(
    ERCE_T.ERCE_NOCONNECT_CONNECTED,
    'A pin with a "no connection" flag is connected',
    'no_connect_connected',
  );
  static readonly noConnectDangling = new ERC_ITEM(
    ERCE_T.ERCE_NOCONNECT_NOT_CONNECTED,
    'Unconnected "no connection" flag',
    'no_connect_dangling',
  );
  static readonly labelDangling = new ERC_ITEM(
    ERCE_T.ERCE_LABEL_NOT_CONNECTED,
    'Label not connected',
    'label_dangling',
  );
  static readonly isolatedPinLabel = new ERC_ITEM(
    ERCE_T.ERCE_LABEL_SINGLE_PIN,
    'Label connected to only one pin',
    'isolated_pin_label',
  );
  static readonly similarLabels = new ERC_ITEM(
    ERCE_T.ERCE_SIMILAR_LABELS,
    'Labels are similar (lower/upper case difference only)',
    'similar_labels',
  );
  static readonly similarPower = new ERC_ITEM(
    ERCE_T.ERCE_SIMILAR_POWER,
    'Power pins are similar (lower/upper case difference only)',
    'similar_power',
  );
  static readonly similarLabelAndPower = new ERC_ITEM(
    ERCE_T.ERCE_SIMILAR_LABEL_AND_POWER,
    'Power pin and label are similar (lower/upper case difference only)',
    'similar_label_and_power',
  );
  static readonly singleGlobalLabel = new ERC_ITEM(
    ERCE_T.ERCE_SINGLE_GLOBAL_LABEL,
    'Global label only appears once in the schematic',
    'single_global_label',
  );
  static readonly sameLocalGlobalLabel = new ERC_ITEM(
    ERCE_T.ERCE_SAME_LOCAL_GLOBAL_LABEL,
    'Local and global labels have same name',
    'same_local_global_label',
  );
  static readonly differentUnitFootprint = new ERC_ITEM(
    ERCE_T.ERCE_DIFFERENT_UNIT_FP,
    'Different footprint assigned in another unit of the symbol',
    'different_unit_footprint',
  );
  static readonly differentUnitNet = new ERC_ITEM(
    ERCE_T.ERCE_DIFFERENT_UNIT_NET,
    'Different net assigned to a shared pin in another unit of the symbol',
    'different_unit_net',
  );
  static readonly busDefinitionConflict = new ERC_ITEM(
    ERCE_T.ERCE_BUS_ALIAS_CONFLICT,
    'Conflict between bus alias definitions across schematic sheets',
    'bus_definition_conflict',
  );
  static readonly multipleNetNames = new ERC_ITEM(
    ERCE_T.ERCE_DRIVER_CONFLICT,
    'More than one name given to this bus or net',
    'multiple_net_names',
  );
  static readonly netNotBusMember = new ERC_ITEM(
    ERCE_T.ERCE_BUS_ENTRY_CONFLICT,
    'Net is graphically connected to a bus but not a bus member',
    'net_not_bus_member',
  );
  static readonly busToBusConflict = new ERC_ITEM(
    ERCE_T.ERCE_BUS_TO_BUS_CONFLICT,
    'Buses are graphically connected but share no bus members',
    'bus_to_bus_conflict',
  );
  static readonly busToNetConflict = new ERC_ITEM(
    ERCE_T.ERCE_BUS_TO_NET_CONFLICT,
    'Invalid connection between bus and net items',
    'bus_to_net_conflict',
  );
  static readonly groundPinNotGround = new ERC_ITEM(
    ERCE_T.ERCE_GROUND_PIN_NOT_GROUND,
    'Ground pin not connected to ground net',
    'ground_pin_not_ground',
  );
  static readonly stackedPinName = new ERC_ITEM(
    ERCE_T.ERCE_STACKED_PIN_SYNTAX,
    'Pin name resembles stacked pin',
    'stacked_pin_name',
  );
  static readonly fieldNameWhitespace = new ERC_ITEM(
    ERCE_T.ERCE_FIELD_NAME_WHITESPACE,
    'Field name has leading or trailing whitespace',
    'field_name_whitespace',
  );
  static readonly unresolvedVariable = new ERC_ITEM(
    ERCE_T.ERCE_UNRESOLVED_VARIABLE,
    'Unresolved text variable',
    'unresolved_variable',
  );
  static readonly undefinedNetclass = new ERC_ITEM(
    ERCE_T.ERCE_UNDEFINED_NETCLASS,
    'Undefined netclass',
    'undefined_netclass',
  );
  static readonly simulationModelIssues = new ERC_ITEM(
    ERCE_T.ERCE_SIMULATION_MODEL,
    'SPICE model issue',
    'simulation_model_issue',
  );
  static readonly wireDangling = new ERC_ITEM(
    ERCE_T.ERCE_WIRE_DANGLING,
    'Wires not connected to anything',
    'wire_dangling',
  );
  static readonly libSymbolIssues = new ERC_ITEM(
    ERCE_T.ERCE_LIB_SYMBOL_ISSUES,
    'Library symbol issue',
    'lib_symbol_issues',
  );
  static readonly libSymbolMismatch = new ERC_ITEM(
    ERCE_T.ERCE_LIB_SYMBOL_MISMATCH,
    "Symbol doesn't match copy in library",
    'lib_symbol_mismatch',
  );
  static readonly footprintLinkIssues = new ERC_ITEM(
    ERCE_T.ERCE_FOOTPRINT_LINK_ISSUES,
    'Footprint link issue',
    'footprint_link_issues',
  );
  static readonly footprintFilters = new ERC_ITEM(
    ERCE_T.ERCE_FOOTPRINT_FILTERS,
    "Assigned footprint doesn't match footprint filters",
    'footprint_filter',
  );
  static readonly unannotated = new ERC_ITEM(
    ERCE_T.ERCE_UNANNOTATED,
    'Symbol is not annotated',
    'unannotated',
  );
  static readonly extraUnits = new ERC_ITEM(
    ERCE_T.ERCE_EXTRA_UNITS,
    'Symbol has more units than are defined',
    'extra_units',
  );
  static readonly missingUnits = new ERC_ITEM(
    ERCE_T.ERCE_MISSING_UNIT,
    'Symbol has units that are not placed',
    'missing_unit',
  );
  static readonly missingInputPin = new ERC_ITEM(
    ERCE_T.ERCE_MISSING_INPUT_PIN,
    'Symbol has input pins that are not placed',
    'missing_input_pin',
  );
  static readonly missingBidiPin = new ERC_ITEM(
    ERCE_T.ERCE_MISSING_BIDI_PIN,
    'Symbol has bidirectional pins that are not placed',
    'missing_bidi_pin',
  );
  static readonly missingPowerInputPin = new ERC_ITEM(
    ERCE_T.ERCE_MISSING_POWER_INPUT_PIN,
    'Symbol has power input pins that are not placed',
    'missing_power_pin',
  );
  static readonly differentUnitValue = new ERC_ITEM(
    ERCE_T.ERCE_DIFFERENT_UNIT_VALUE,
    'Units of same symbol have different values',
    'unit_value_mismatch',
  );
  static readonly duplicateReference = new ERC_ITEM(
    ERCE_T.ERCE_DUPLICATE_REFERENCE,
    'Duplicate reference designators',
    'duplicate_reference',
  );
  static readonly busEntryNeeded = new ERC_ITEM(
    ERCE_T.ERCE_BUS_ENTRY_NEEDED,
    'Bus Entry needed',
    'bus_entry_needed',
  );
  static readonly unconnectedWireEndpoint = new ERC_ITEM(
    ERCE_T.ERCE_UNCONNECTED_WIRE_ENDPOINT,
    'Unconnected wire endpoint',
    'unconnected_wire_endpoint',
  );

  /// A list of all ERC_ITEM types which are valid error codes
  private static readonly allItemTypes: readonly ERC_ITEM[] = [
    ERC_ITEM.heading_connections,
    ERC_ITEM.pinNotConnected,
    ERC_ITEM.pinNotDriven,
    ERC_ITEM.powerpinNotDriven,
    ERC_ITEM.noConnectConnected,
    ERC_ITEM.noConnectDangling,
    ERC_ITEM.labelDangling,
    ERC_ITEM.isolatedPinLabel,
    ERC_ITEM.singleGlobalLabel,
    ERC_ITEM.sameLocalGlobalLabel,
    ERC_ITEM.wireDangling,
    ERC_ITEM.busEntryNeeded,
    ERC_ITEM.endpointOffGrid,
    ERC_ITEM.fourWayJunction,
    ERC_ITEM.labelMultipleWires,
    ERC_ITEM.unconnectedWireEndpoint,

    ERC_ITEM.heading_conflicts,
    ERC_ITEM.duplicateReference,
    ERC_ITEM.pinTableWarning,
    ERC_ITEM.differentUnitValue,
    ERC_ITEM.differentUnitFootprint,
    ERC_ITEM.differentUnitNet,
    ERC_ITEM.duplicateSheetName,
    ERC_ITEM.hierLabelMismatch,
    ERC_ITEM.multipleNetNames,
    ERC_ITEM.busDefinitionConflict,
    ERC_ITEM.busToBusConflict,
    ERC_ITEM.busToNetConflict,
    ERC_ITEM.netNotBusMember,
    ERC_ITEM.groundPinNotGround,

    ERC_ITEM.heading_misc,
    ERC_ITEM.stackedPinName,
    ERC_ITEM.fieldNameWhitespace,
    ERC_ITEM.unannotated,
    ERC_ITEM.unresolvedVariable,
    ERC_ITEM.undefinedNetclass,
    ERC_ITEM.simulationModelIssues,
    ERC_ITEM.similarLabels,
    ERC_ITEM.similarPower,
    ERC_ITEM.similarLabelAndPower,
    // Commented out until the logic for this element is coded
    // TODO: Add bus label syntax checking
    //                 ERC_ITEM::busLabelSyntax,
    ERC_ITEM.libSymbolIssues,
    ERC_ITEM.libSymbolMismatch,
    ERC_ITEM.footprintLinkIssues,
    ERC_ITEM.footprintFilters,
    ERC_ITEM.extraUnits,
    ERC_ITEM.missingUnits,
    ERC_ITEM.missingInputPin,
    ERC_ITEM.missingBidiPin,
    ERC_ITEM.missingPowerInputPin,

    // ERC_ITEM types with no user-editable severities
    // NOTE: this MUST be the last grouping in the list!
    ERC_ITEM.heading_internal,
    ERC_ITEM.duplicatePinError,
    ERC_ITEM.pinTableWarning,
    ERC_ITEM.pinTableError,
    ERC_ITEM.genericWarning,
    ERC_ITEM.genericError,
  ];

  /** `ERC_ITEM::Create( int )`'s switch, as a lookup. */
  private static byCode(): Map<number, ERC_ITEM> {
    if (ERC_ITEM.s_byCode) return ERC_ITEM.s_byCode;

    const m = new Map<number, ERC_ITEM>();

    for (const item of [
      ERC_ITEM.duplicateSheetName,
      ERC_ITEM.endpointOffGrid,
      ERC_ITEM.pinNotConnected,
      ERC_ITEM.pinNotDriven,
      ERC_ITEM.powerpinNotDriven,
      ERC_ITEM.duplicatePinError,
      ERC_ITEM.pinTableWarning,
      ERC_ITEM.pinTableError,
      ERC_ITEM.genericWarning,
      ERC_ITEM.genericError,
      ERC_ITEM.hierLabelMismatch,
      ERC_ITEM.noConnectConnected,
      ERC_ITEM.noConnectDangling,
      ERC_ITEM.fourWayJunction,
      ERC_ITEM.labelMultipleWires,
      ERC_ITEM.labelDangling,
      ERC_ITEM.similarLabels,
      ERC_ITEM.similarPower,
      ERC_ITEM.similarLabelAndPower,
      ERC_ITEM.singleGlobalLabel,
      ERC_ITEM.sameLocalGlobalLabel,
      ERC_ITEM.differentUnitFootprint,
      ERC_ITEM.differentUnitNet,
      ERC_ITEM.busDefinitionConflict,
      ERC_ITEM.multipleNetNames,
      ERC_ITEM.netNotBusMember,
      ERC_ITEM.busToBusConflict,
      ERC_ITEM.busToNetConflict,
      ERC_ITEM.groundPinNotGround,
      ERC_ITEM.isolatedPinLabel,
      ERC_ITEM.unresolvedVariable,
      ERC_ITEM.undefinedNetclass,
      ERC_ITEM.simulationModelIssues,
      ERC_ITEM.wireDangling,
      ERC_ITEM.libSymbolIssues,
      ERC_ITEM.libSymbolMismatch,
      ERC_ITEM.footprintLinkIssues,
      ERC_ITEM.footprintFilters,
      ERC_ITEM.unannotated,
      ERC_ITEM.extraUnits,
      ERC_ITEM.differentUnitValue,
      ERC_ITEM.duplicateReference,
      ERC_ITEM.busEntryNeeded,
      ERC_ITEM.missingUnits,
      ERC_ITEM.missingInputPin,
      ERC_ITEM.missingPowerInputPin,
      ERC_ITEM.missingBidiPin,
      ERC_ITEM.unconnectedWireEndpoint,
      ERC_ITEM.stackedPinName,
      ERC_ITEM.fieldNameWhitespace,
    ]) {
      m.set(item.GetErrorCode(), item);
    }

    ERC_ITEM.s_byCode = m;
    return m;
  }

  private static s_byCode: Map<number, ERC_ITEM> | null = null;
}
