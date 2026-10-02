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

/*
 * The item templates are built on first use, not at module load: ERCE_T lives in
 * erc_settings.ts (erc_settings.h upstream), which imports this module for its
 * rule_severities parameter, and a template built at load would read ERCE_T before that
 * module had run.
 */
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

  private static s_heading_connections: ERC_ITEM | undefined;
  static get heading_connections(): ERC_ITEM {
    ERC_ITEM.s_heading_connections ??= new ERC_ITEM(0, 'Connections', '');
    return ERC_ITEM.s_heading_connections;
  }
  private static s_heading_conflicts: ERC_ITEM | undefined;
  static get heading_conflicts(): ERC_ITEM {
    ERC_ITEM.s_heading_conflicts ??= new ERC_ITEM(0, 'Conflicts', '');
    return ERC_ITEM.s_heading_conflicts;
  }
  private static s_heading_misc: ERC_ITEM | undefined;
  static get heading_misc(): ERC_ITEM {
    ERC_ITEM.s_heading_misc ??= new ERC_ITEM(0, 'Miscellaneous', '');
    return ERC_ITEM.s_heading_misc;
  }
  private static s_heading_internal: ERC_ITEM | undefined;
  static get heading_internal(): ERC_ITEM {
    ERC_ITEM.s_heading_internal ??= new ERC_ITEM(0, '', '');
    return ERC_ITEM.s_heading_internal;
  }

  private static s_duplicateSheetName: ERC_ITEM | undefined;
  static get duplicateSheetName(): ERC_ITEM {
    ERC_ITEM.s_duplicateSheetName ??= new ERC_ITEM(
      ERCE_T.ERCE_DUPLICATE_SHEET_NAME,
      'Duplicate sheet names within a given sheet',
      'duplicate_sheet_names',
    );
    return ERC_ITEM.s_duplicateSheetName;
  }
  private static s_endpointOffGrid: ERC_ITEM | undefined;
  static get endpointOffGrid(): ERC_ITEM {
    ERC_ITEM.s_endpointOffGrid ??= new ERC_ITEM(
      ERCE_T.ERCE_ENDPOINT_OFF_GRID,
      'Symbol pin or wire end off connection grid',
      'endpoint_off_grid',
    );
    return ERC_ITEM.s_endpointOffGrid;
  }
  private static s_pinNotConnected: ERC_ITEM | undefined;
  static get pinNotConnected(): ERC_ITEM {
    ERC_ITEM.s_pinNotConnected ??= new ERC_ITEM(
      ERCE_T.ERCE_PIN_NOT_CONNECTED,
      'Pin not connected',
      'pin_not_connected',
    );
    return ERC_ITEM.s_pinNotConnected;
  }
  private static s_pinNotDriven: ERC_ITEM | undefined;
  static get pinNotDriven(): ERC_ITEM {
    ERC_ITEM.s_pinNotDriven ??= new ERC_ITEM(
      ERCE_T.ERCE_PIN_NOT_DRIVEN,
      'Input pin not driven by any Output pins',
      'pin_not_driven',
    );
    return ERC_ITEM.s_pinNotDriven;
  }
  private static s_powerpinNotDriven: ERC_ITEM | undefined;
  static get powerpinNotDriven(): ERC_ITEM {
    ERC_ITEM.s_powerpinNotDriven ??= new ERC_ITEM(
      ERCE_T.ERCE_POWERPIN_NOT_DRIVEN,
      'Input Power pin not driven by any Output Power pins',
      'power_pin_not_driven',
    );
    return ERC_ITEM.s_powerpinNotDriven;
  }
  private static s_duplicatePinError: ERC_ITEM | undefined;
  static get duplicatePinError(): ERC_ITEM {
    ERC_ITEM.s_duplicatePinError ??= new ERC_ITEM(
      ERCE_T.ERCE_DUPLICATE_PIN_ERROR,
      'Duplicate pins with different nets',
      'duplicate_pins',
    );
    return ERC_ITEM.s_duplicatePinError;
  }
  private static s_pinTableWarning: ERC_ITEM | undefined;
  static get pinTableWarning(): ERC_ITEM {
    ERC_ITEM.s_pinTableWarning ??= new ERC_ITEM(
      ERCE_T.ERCE_PIN_TO_PIN_WARNING,
      'Conflict problem between pins',
      'pin_to_pin',
    );
    return ERC_ITEM.s_pinTableWarning;
  }
  private static s_pinTableError: ERC_ITEM | undefined;
  static get pinTableError(): ERC_ITEM {
    ERC_ITEM.s_pinTableError ??= new ERC_ITEM(
      ERCE_T.ERCE_PIN_TO_PIN_ERROR,
      'Conflict problem between pins',
      'pin_to_pin',
    );
    return ERC_ITEM.s_pinTableError;
  }
  private static s_genericWarning: ERC_ITEM | undefined;
  static get genericWarning(): ERC_ITEM {
    ERC_ITEM.s_genericWarning ??= new ERC_ITEM(
      ERCE_T.ERCE_GENERIC_WARNING,
      'Warning',
      'generic-warning',
    );
    return ERC_ITEM.s_genericWarning;
  }
  private static s_genericError: ERC_ITEM | undefined;
  static get genericError(): ERC_ITEM {
    ERC_ITEM.s_genericError ??= new ERC_ITEM(ERCE_T.ERCE_GENERIC_ERROR, 'Error', 'generic-error');
    return ERC_ITEM.s_genericError;
  }
  private static s_hierLabelMismatch: ERC_ITEM | undefined;
  static get hierLabelMismatch(): ERC_ITEM {
    ERC_ITEM.s_hierLabelMismatch ??= new ERC_ITEM(
      ERCE_T.ERCE_HIERACHICAL_LABEL,
      'Mismatch between hierarchical labels and sheet pins',
      'hier_label_mismatch',
    );
    return ERC_ITEM.s_hierLabelMismatch;
  }
  private static s_fourWayJunction: ERC_ITEM | undefined;
  static get fourWayJunction(): ERC_ITEM {
    ERC_ITEM.s_fourWayJunction ??= new ERC_ITEM(
      ERCE_T.ERCE_FOUR_WAY_JUNCTION,
      'Four connection points are joined together',
      'four_way_junction',
    );
    return ERC_ITEM.s_fourWayJunction;
  }
  private static s_labelMultipleWires: ERC_ITEM | undefined;
  static get labelMultipleWires(): ERC_ITEM {
    ERC_ITEM.s_labelMultipleWires ??= new ERC_ITEM(
      ERCE_T.ERCE_LABEL_MULTIPLE_WIRES,
      'Label connects more than one wire',
      'label_multiple_wires',
    );
    return ERC_ITEM.s_labelMultipleWires;
  }
  private static s_noConnectConnected: ERC_ITEM | undefined;
  static get noConnectConnected(): ERC_ITEM {
    ERC_ITEM.s_noConnectConnected ??= new ERC_ITEM(
      ERCE_T.ERCE_NOCONNECT_CONNECTED,
      'A pin with a "no connection" flag is connected',
      'no_connect_connected',
    );
    return ERC_ITEM.s_noConnectConnected;
  }
  private static s_noConnectDangling: ERC_ITEM | undefined;
  static get noConnectDangling(): ERC_ITEM {
    ERC_ITEM.s_noConnectDangling ??= new ERC_ITEM(
      ERCE_T.ERCE_NOCONNECT_NOT_CONNECTED,
      'Unconnected "no connection" flag',
      'no_connect_dangling',
    );
    return ERC_ITEM.s_noConnectDangling;
  }
  private static s_labelDangling: ERC_ITEM | undefined;
  static get labelDangling(): ERC_ITEM {
    ERC_ITEM.s_labelDangling ??= new ERC_ITEM(
      ERCE_T.ERCE_LABEL_NOT_CONNECTED,
      'Label not connected',
      'label_dangling',
    );
    return ERC_ITEM.s_labelDangling;
  }
  private static s_isolatedPinLabel: ERC_ITEM | undefined;
  static get isolatedPinLabel(): ERC_ITEM {
    ERC_ITEM.s_isolatedPinLabel ??= new ERC_ITEM(
      ERCE_T.ERCE_LABEL_SINGLE_PIN,
      'Label connected to only one pin',
      'isolated_pin_label',
    );
    return ERC_ITEM.s_isolatedPinLabel;
  }
  private static s_similarLabels: ERC_ITEM | undefined;
  static get similarLabels(): ERC_ITEM {
    ERC_ITEM.s_similarLabels ??= new ERC_ITEM(
      ERCE_T.ERCE_SIMILAR_LABELS,
      'Labels are similar (lower/upper case difference only)',
      'similar_labels',
    );
    return ERC_ITEM.s_similarLabels;
  }
  private static s_similarPower: ERC_ITEM | undefined;
  static get similarPower(): ERC_ITEM {
    ERC_ITEM.s_similarPower ??= new ERC_ITEM(
      ERCE_T.ERCE_SIMILAR_POWER,
      'Power pins are similar (lower/upper case difference only)',
      'similar_power',
    );
    return ERC_ITEM.s_similarPower;
  }
  private static s_similarLabelAndPower: ERC_ITEM | undefined;
  static get similarLabelAndPower(): ERC_ITEM {
    ERC_ITEM.s_similarLabelAndPower ??= new ERC_ITEM(
      ERCE_T.ERCE_SIMILAR_LABEL_AND_POWER,
      'Power pin and label are similar (lower/upper case difference only)',
      'similar_label_and_power',
    );
    return ERC_ITEM.s_similarLabelAndPower;
  }
  private static s_singleGlobalLabel: ERC_ITEM | undefined;
  static get singleGlobalLabel(): ERC_ITEM {
    ERC_ITEM.s_singleGlobalLabel ??= new ERC_ITEM(
      ERCE_T.ERCE_SINGLE_GLOBAL_LABEL,
      'Global label only appears once in the schematic',
      'single_global_label',
    );
    return ERC_ITEM.s_singleGlobalLabel;
  }
  private static s_sameLocalGlobalLabel: ERC_ITEM | undefined;
  static get sameLocalGlobalLabel(): ERC_ITEM {
    ERC_ITEM.s_sameLocalGlobalLabel ??= new ERC_ITEM(
      ERCE_T.ERCE_SAME_LOCAL_GLOBAL_LABEL,
      'Local and global labels have same name',
      'same_local_global_label',
    );
    return ERC_ITEM.s_sameLocalGlobalLabel;
  }
  private static s_differentUnitFootprint: ERC_ITEM | undefined;
  static get differentUnitFootprint(): ERC_ITEM {
    ERC_ITEM.s_differentUnitFootprint ??= new ERC_ITEM(
      ERCE_T.ERCE_DIFFERENT_UNIT_FP,
      'Different footprint assigned in another unit of the symbol',
      'different_unit_footprint',
    );
    return ERC_ITEM.s_differentUnitFootprint;
  }
  private static s_differentUnitNet: ERC_ITEM | undefined;
  static get differentUnitNet(): ERC_ITEM {
    ERC_ITEM.s_differentUnitNet ??= new ERC_ITEM(
      ERCE_T.ERCE_DIFFERENT_UNIT_NET,
      'Different net assigned to a shared pin in another unit of the symbol',
      'different_unit_net',
    );
    return ERC_ITEM.s_differentUnitNet;
  }
  private static s_busDefinitionConflict: ERC_ITEM | undefined;
  static get busDefinitionConflict(): ERC_ITEM {
    ERC_ITEM.s_busDefinitionConflict ??= new ERC_ITEM(
      ERCE_T.ERCE_BUS_ALIAS_CONFLICT,
      'Conflict between bus alias definitions across schematic sheets',
      'bus_definition_conflict',
    );
    return ERC_ITEM.s_busDefinitionConflict;
  }
  private static s_multipleNetNames: ERC_ITEM | undefined;
  static get multipleNetNames(): ERC_ITEM {
    ERC_ITEM.s_multipleNetNames ??= new ERC_ITEM(
      ERCE_T.ERCE_DRIVER_CONFLICT,
      'More than one name given to this bus or net',
      'multiple_net_names',
    );
    return ERC_ITEM.s_multipleNetNames;
  }
  private static s_netNotBusMember: ERC_ITEM | undefined;
  static get netNotBusMember(): ERC_ITEM {
    ERC_ITEM.s_netNotBusMember ??= new ERC_ITEM(
      ERCE_T.ERCE_BUS_ENTRY_CONFLICT,
      'Net is graphically connected to a bus but not a bus member',
      'net_not_bus_member',
    );
    return ERC_ITEM.s_netNotBusMember;
  }
  private static s_busToBusConflict: ERC_ITEM | undefined;
  static get busToBusConflict(): ERC_ITEM {
    ERC_ITEM.s_busToBusConflict ??= new ERC_ITEM(
      ERCE_T.ERCE_BUS_TO_BUS_CONFLICT,
      'Buses are graphically connected but share no bus members',
      'bus_to_bus_conflict',
    );
    return ERC_ITEM.s_busToBusConflict;
  }
  private static s_busToNetConflict: ERC_ITEM | undefined;
  static get busToNetConflict(): ERC_ITEM {
    ERC_ITEM.s_busToNetConflict ??= new ERC_ITEM(
      ERCE_T.ERCE_BUS_TO_NET_CONFLICT,
      'Invalid connection between bus and net items',
      'bus_to_net_conflict',
    );
    return ERC_ITEM.s_busToNetConflict;
  }
  private static s_groundPinNotGround: ERC_ITEM | undefined;
  static get groundPinNotGround(): ERC_ITEM {
    ERC_ITEM.s_groundPinNotGround ??= new ERC_ITEM(
      ERCE_T.ERCE_GROUND_PIN_NOT_GROUND,
      'Ground pin not connected to ground net',
      'ground_pin_not_ground',
    );
    return ERC_ITEM.s_groundPinNotGround;
  }
  private static s_stackedPinName: ERC_ITEM | undefined;
  static get stackedPinName(): ERC_ITEM {
    ERC_ITEM.s_stackedPinName ??= new ERC_ITEM(
      ERCE_T.ERCE_STACKED_PIN_SYNTAX,
      'Pin name resembles stacked pin',
      'stacked_pin_name',
    );
    return ERC_ITEM.s_stackedPinName;
  }
  private static s_fieldNameWhitespace: ERC_ITEM | undefined;
  static get fieldNameWhitespace(): ERC_ITEM {
    ERC_ITEM.s_fieldNameWhitespace ??= new ERC_ITEM(
      ERCE_T.ERCE_FIELD_NAME_WHITESPACE,
      'Field name has leading or trailing whitespace',
      'field_name_whitespace',
    );
    return ERC_ITEM.s_fieldNameWhitespace;
  }
  private static s_unresolvedVariable: ERC_ITEM | undefined;
  static get unresolvedVariable(): ERC_ITEM {
    ERC_ITEM.s_unresolvedVariable ??= new ERC_ITEM(
      ERCE_T.ERCE_UNRESOLVED_VARIABLE,
      'Unresolved text variable',
      'unresolved_variable',
    );
    return ERC_ITEM.s_unresolvedVariable;
  }
  private static s_undefinedNetclass: ERC_ITEM | undefined;
  static get undefinedNetclass(): ERC_ITEM {
    ERC_ITEM.s_undefinedNetclass ??= new ERC_ITEM(
      ERCE_T.ERCE_UNDEFINED_NETCLASS,
      'Undefined netclass',
      'undefined_netclass',
    );
    return ERC_ITEM.s_undefinedNetclass;
  }
  private static s_simulationModelIssues: ERC_ITEM | undefined;
  static get simulationModelIssues(): ERC_ITEM {
    ERC_ITEM.s_simulationModelIssues ??= new ERC_ITEM(
      ERCE_T.ERCE_SIMULATION_MODEL,
      'SPICE model issue',
      'simulation_model_issue',
    );
    return ERC_ITEM.s_simulationModelIssues;
  }
  private static s_wireDangling: ERC_ITEM | undefined;
  static get wireDangling(): ERC_ITEM {
    ERC_ITEM.s_wireDangling ??= new ERC_ITEM(
      ERCE_T.ERCE_WIRE_DANGLING,
      'Wires not connected to anything',
      'wire_dangling',
    );
    return ERC_ITEM.s_wireDangling;
  }
  private static s_libSymbolIssues: ERC_ITEM | undefined;
  static get libSymbolIssues(): ERC_ITEM {
    ERC_ITEM.s_libSymbolIssues ??= new ERC_ITEM(
      ERCE_T.ERCE_LIB_SYMBOL_ISSUES,
      'Library symbol issue',
      'lib_symbol_issues',
    );
    return ERC_ITEM.s_libSymbolIssues;
  }
  private static s_libSymbolMismatch: ERC_ITEM | undefined;
  static get libSymbolMismatch(): ERC_ITEM {
    ERC_ITEM.s_libSymbolMismatch ??= new ERC_ITEM(
      ERCE_T.ERCE_LIB_SYMBOL_MISMATCH,
      "Symbol doesn't match copy in library",
      'lib_symbol_mismatch',
    );
    return ERC_ITEM.s_libSymbolMismatch;
  }
  private static s_footprintLinkIssues: ERC_ITEM | undefined;
  static get footprintLinkIssues(): ERC_ITEM {
    ERC_ITEM.s_footprintLinkIssues ??= new ERC_ITEM(
      ERCE_T.ERCE_FOOTPRINT_LINK_ISSUES,
      'Footprint link issue',
      'footprint_link_issues',
    );
    return ERC_ITEM.s_footprintLinkIssues;
  }
  private static s_footprintFilters: ERC_ITEM | undefined;
  static get footprintFilters(): ERC_ITEM {
    ERC_ITEM.s_footprintFilters ??= new ERC_ITEM(
      ERCE_T.ERCE_FOOTPRINT_FILTERS,
      "Assigned footprint doesn't match footprint filters",
      'footprint_filter',
    );
    return ERC_ITEM.s_footprintFilters;
  }
  private static s_unannotated: ERC_ITEM | undefined;
  static get unannotated(): ERC_ITEM {
    ERC_ITEM.s_unannotated ??= new ERC_ITEM(
      ERCE_T.ERCE_UNANNOTATED,
      'Symbol is not annotated',
      'unannotated',
    );
    return ERC_ITEM.s_unannotated;
  }
  private static s_extraUnits: ERC_ITEM | undefined;
  static get extraUnits(): ERC_ITEM {
    ERC_ITEM.s_extraUnits ??= new ERC_ITEM(
      ERCE_T.ERCE_EXTRA_UNITS,
      'Symbol has more units than are defined',
      'extra_units',
    );
    return ERC_ITEM.s_extraUnits;
  }
  private static s_missingUnits: ERC_ITEM | undefined;
  static get missingUnits(): ERC_ITEM {
    ERC_ITEM.s_missingUnits ??= new ERC_ITEM(
      ERCE_T.ERCE_MISSING_UNIT,
      'Symbol has units that are not placed',
      'missing_unit',
    );
    return ERC_ITEM.s_missingUnits;
  }
  private static s_missingInputPin: ERC_ITEM | undefined;
  static get missingInputPin(): ERC_ITEM {
    ERC_ITEM.s_missingInputPin ??= new ERC_ITEM(
      ERCE_T.ERCE_MISSING_INPUT_PIN,
      'Symbol has input pins that are not placed',
      'missing_input_pin',
    );
    return ERC_ITEM.s_missingInputPin;
  }
  private static s_missingBidiPin: ERC_ITEM | undefined;
  static get missingBidiPin(): ERC_ITEM {
    ERC_ITEM.s_missingBidiPin ??= new ERC_ITEM(
      ERCE_T.ERCE_MISSING_BIDI_PIN,
      'Symbol has bidirectional pins that are not placed',
      'missing_bidi_pin',
    );
    return ERC_ITEM.s_missingBidiPin;
  }
  private static s_missingPowerInputPin: ERC_ITEM | undefined;
  static get missingPowerInputPin(): ERC_ITEM {
    ERC_ITEM.s_missingPowerInputPin ??= new ERC_ITEM(
      ERCE_T.ERCE_MISSING_POWER_INPUT_PIN,
      'Symbol has power input pins that are not placed',
      'missing_power_pin',
    );
    return ERC_ITEM.s_missingPowerInputPin;
  }
  private static s_differentUnitValue: ERC_ITEM | undefined;
  static get differentUnitValue(): ERC_ITEM {
    ERC_ITEM.s_differentUnitValue ??= new ERC_ITEM(
      ERCE_T.ERCE_DIFFERENT_UNIT_VALUE,
      'Units of same symbol have different values',
      'unit_value_mismatch',
    );
    return ERC_ITEM.s_differentUnitValue;
  }
  private static s_duplicateReference: ERC_ITEM | undefined;
  static get duplicateReference(): ERC_ITEM {
    ERC_ITEM.s_duplicateReference ??= new ERC_ITEM(
      ERCE_T.ERCE_DUPLICATE_REFERENCE,
      'Duplicate reference designators',
      'duplicate_reference',
    );
    return ERC_ITEM.s_duplicateReference;
  }
  private static s_busEntryNeeded: ERC_ITEM | undefined;
  static get busEntryNeeded(): ERC_ITEM {
    ERC_ITEM.s_busEntryNeeded ??= new ERC_ITEM(
      ERCE_T.ERCE_BUS_ENTRY_NEEDED,
      'Bus Entry needed',
      'bus_entry_needed',
    );
    return ERC_ITEM.s_busEntryNeeded;
  }
  private static s_unconnectedWireEndpoint: ERC_ITEM | undefined;
  static get unconnectedWireEndpoint(): ERC_ITEM {
    ERC_ITEM.s_unconnectedWireEndpoint ??= new ERC_ITEM(
      ERCE_T.ERCE_UNCONNECTED_WIRE_ENDPOINT,
      'Unconnected wire endpoint',
      'unconnected_wire_endpoint',
    );
    return ERC_ITEM.s_unconnectedWireEndpoint;
  }

  /// A list of all ERC_ITEM types which are valid error codes
  private static s_allItemTypes: readonly ERC_ITEM[] | undefined;
  private static get allItemTypes(): readonly ERC_ITEM[] {
    ERC_ITEM.s_allItemTypes ??= [
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
    return ERC_ITEM.s_allItemTypes;
  }
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
