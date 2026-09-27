// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/settings/bom_settings.cpp` + `include/settings/bom_settings.h`:
 * the BOM view presets (`BOM_PRESET`) and output-format presets
 * (`BOM_FMT_PRESET`) that PANEL_BOM_PRESETS lists and the Symbol Fields Table
 * applies.
 *
 * Each struct is an interface; its statics (`BuiltInPresets()` and the named
 * built-ins) hang off a value of the same name, so a call reads as upstream's
 * `BOM_PRESET::BuiltInPresets()` does. The built-in tables are DATA — KiCad
 * hardcodes them in bom_settings.cpp, and these mirror that table.
 */

/** A single field within a BOM, e.g. Reference, Value, Footprint. */
export interface BOM_FIELD {
  name: string;
  label: string;
  show: boolean;
  groupBy: boolean;
}

/**
 * A complete preset defining a BOM "View" with a list of all the fields to
 * show, group by, order, filtering settings, etc.
 */
export interface BOM_PRESET {
  name: string;
  /** Built-ins only; read-only presets are never persisted, like upstream. */
  readOnly?: boolean;
  fieldsOrdered: BOM_FIELD[];
  sortField: string;
  sortAsc: boolean;
  filterString: string;
  groupSymbols: boolean;
  excludeDNP: boolean;
  includeExcludedFromBOM: boolean;
}

/** A formatting preset, like CSV (Comma Separated Values). */
export interface BOM_FMT_PRESET {
  name: string;
  readOnly?: boolean;
  fieldDelimiter: string;
  stringDelimiter: string;
  refDelimiter: string;
  refRangeDelimiter: string;
  keepTabs: boolean;
  keepLineBreaks: boolean;
}

const field = (name: string, label: string, show: boolean, groupBy: boolean): BOM_FIELD => ({
  name,
  label,
  show,
  groupBy,
});

/** `BOM_PRESET{ name, true, {}, _( "Reference" ), true, "", true, false, <incl> }`. */
function builtIn(
  name: string,
  includeExcludedFromBOM: boolean,
  fieldsOrdered: BOM_FIELD[],
): BOM_PRESET {
  return {
    name,
    readOnly: true,
    fieldsOrdered,
    sortField: 'Reference',
    sortAsc: true,
    filterString: '',
    groupSymbols: true,
    excludeDNP: false,
    includeExcludedFromBOM,
  };
}

export const BOM_PRESET = {
  DefaultEditing(): BOM_PRESET {
    return builtIn('Default Editing', true, [
      field('Reference', 'Reference', true, false),
      field('${QUANTITY}', 'Qty', true, false),
      field('Value', 'Value', true, true),
      field('${DNP}', 'DNP', true, true),
      field('${EXCLUDE_FROM_BOM}', 'Exclude from BOM', true, true),
      field('${EXCLUDE_FROM_BOARD}', 'Exclude from Board', true, true),
      field('${EXCLUDE_FROM_SIM}', 'Exclude from Simulation', true, true),
      field('${EXCLUDE_FROM_POS_FILES}', 'Exclude from Position Files', true, true),
      field('Footprint', 'Footprint', true, true),
      field('Datasheet', 'Datasheet', true, false),
    ]);
  },

  GroupedByValue(): BOM_PRESET {
    return builtIn('Grouped By Value', false, [
      field('Reference', 'Reference', true, false),
      field('Value', 'Value', true, true),
      field('Datasheet', 'Datasheet', true, false),
      field('Footprint', 'Footprint', true, false),
      field('${QUANTITY}', 'Qty', true, false),
      field('${DNP}', 'DNP', true, true),
    ]);
  },

  GroupedByValueFootprint(): BOM_PRESET {
    return builtIn('Grouped By Value and Footprint', false, [
      field('Reference', 'Reference', true, false),
      field('Value', 'Value', true, true),
      field('Datasheet', 'Datasheet', true, false),
      field('Footprint', 'Footprint', true, true),
      field('${QUANTITY}', 'Qty', true, false),
      field('${DNP}', 'DNP', true, true),
    ]);
  },

  Attributes(): BOM_PRESET {
    return builtIn('Attributes', true, [
      field('Reference', 'Reference', true, false),
      field('Value', 'Value', true, true),
      field('Datasheet', 'Datasheet', false, false),
      field('Footprint', 'Footprint', false, true),
      field('${DNP}', 'Do Not Place', true, false),
      field('${EXCLUDE_FROM_BOM}', 'Exclude from BOM', true, false),
      field('${EXCLUDE_FROM_BOARD}', 'Exclude from Board', true, false),
      field('${EXCLUDE_FROM_SIM}', 'Exclude from Simulation', true, false),
      field('${EXCLUDE_FROM_POS_FILES}', 'Exclude from Position Files', true, false),
    ]);
  },

  BuiltInPresets(): BOM_PRESET[] {
    return [
      BOM_PRESET.DefaultEditing(),
      BOM_PRESET.GroupedByValue(),
      BOM_PRESET.GroupedByValueFootprint(),
      BOM_PRESET.Attributes(),
    ];
  },
};

/** `BOM_FMT_PRESET{ name, true, field, string, ref, refRange, false, false }`. */
function fmt(
  name: string,
  fieldDelimiter: string,
  stringDelimiter: string,
  refDelimiter: string,
  refRangeDelimiter: string,
): BOM_FMT_PRESET {
  return {
    name,
    readOnly: true,
    fieldDelimiter,
    stringDelimiter,
    refDelimiter,
    refRangeDelimiter,
    keepTabs: false,
    keepLineBreaks: false,
  };
}

export const BOM_FMT_PRESET = {
  CSV(): BOM_FMT_PRESET {
    return fmt('CSV', ',', '"', ',', '');
  },

  TSV(): BOM_FMT_PRESET {
    return fmt('TSV', '\t', '', ',', '');
  },

  Semicolons(): BOM_FMT_PRESET {
    return fmt('Semicolons', ';', "'", ',', '');
  },

  BuiltInPresets(): BOM_FMT_PRESET[] {
    return [BOM_FMT_PRESET.CSV(), BOM_FMT_PRESET.TSV(), BOM_FMT_PRESET.Semicolons()];
  },
};
