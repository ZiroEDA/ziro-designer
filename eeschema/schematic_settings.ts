// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Project-scoped schematic settings: the data model edited by the Schematic
 * Setup dialog. Counterpart: `eeschema/schematic_settings.h`
 * (SCHEMATIC_SETTINGS) plus the NET_SETTINGS / project-file slices the dialog's
 * pages edit, kept apart from the panel components (KiCad's data/UI split, and
 * a plain .ts module so the engine, the .kicad_pro serializer and tests can
 * import it without pulling in React panels).
 *
 * Each panel re-exports its slice from here, so panel modules remain the
 * conventional import site for panel-specific types.
 */

import { netclassPatternMatches } from '@ziroeda/common/eda_pattern_match.js';
import { LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { defaultErcSettings, type ErcSettings } from './erc/erc_settings.js';

// ---------------------------------------------------------------------------
// Formatting (PANEL_SETUP_FORMATTING / SCHEMATIC_SETTINGS drawing defaults).

/** Junction-dot size choices (m_JunctionSizeChoice). */
export const JUNCTION_DOT_SIZES = ['None', 'Smallest', 'Small', 'Default', 'Large', 'Largest'];
/** Hop-over size choices (m_HopOverSizeChoice). */
export const HOP_OVER_SIZES = ['None', 'Smallest', 'Small', 'Medium', 'Large', 'Largest'];
/** Operating-point overlay voltage-range choices (m_OPO_VRange). */
export const OPO_V_RANGES = [
  'Auto',
  'fV',
  'pV',
  'nV',
  'uV',
  'mV',
  'V',
  'KV',
  'MV',
  'GV',
  'TV',
  'PV',
];
/** Operating-point overlay current-range choices (m_OPO_IRange). */
export const OPO_I_RANGES = [
  'Auto',
  'fA',
  'pA',
  'nA',
  'uA',
  'mA',
  'A',
  'KA',
  'MA',
  'GA',
  'TA',
  'PA',
];

/** SCHEMATIC_SETTINGS formatting subset edited by the Formatting panel. */
export interface FormattingSettings {
  /** Default text size (mils) for new text/labels (m_DefaultTextSize). */
  defaultTextSizeMils: number;
  /** Overbar vertical offset as a % of text size (m_FontMetrics.m_OverbarHeight). */
  overbarOffsetRatio: number;
  /** Label offset above a wire/pin as a % of text size (m_TextOffsetRatio). */
  labelOffsetRatio: number;
  /** Global-label box margin as a % of text size (m_LabelSizeRatio). */
  labelSizeRatio: number;
  /** Default graphic line width (mils) for new items (m_DefaultLineWidth). */
  defaultLineWidthMils: number;
  /** Pin symbol size (mils) for decorations like clocks (m_PinSymbolSize). */
  pinSymbolSizeMils: number;
  /** Junction dot size choice index (m_JunctionSizeChoice). */
  junctionDotChoice: number;
  /** Hop-over size choice index (m_HopOverSizeChoice). */
  hopOverChoice: number;
  /** Connection grid (mils) (m_ConnectionGridSize). */
  connectionGridMils: number;
  /** Show inter-sheet references (m_IntersheetRefsShow). */
  intersheetRefsShow: boolean;
  /** Show own page in the reference list (m_IntersheetRefsListOwnPage). */
  intersheetRefsOwnPage: boolean;
  /** Abbreviated (1..3) vs standard (1,2,3) format (m_IntersheetRefsFormatShort). */
  intersheetRefsAbbreviated: boolean;
  /** Reference list prefix / suffix (m_IntersheetRefsPrefix / Suffix). */
  intersheetRefsPrefix: string;
  intersheetRefsSuffix: string;
  /** Dashed-line dash / gap lengths as ratios of the line width. */
  dashLengthRatio: number;
  gapLengthRatio: number;
  /** Operating-point overlay significant digits, voltages (m_OPO_VPrecision). */
  opoVPrecision: number;
  /** Operating-point overlay voltage range label (m_OPO_VRange); 'Auto' = ~V. */
  opoVRange: string;
  /** Operating-point overlay significant digits, currents (m_OPO_IPrecision). */
  opoIPrecision: number;
  /** Operating-point overlay current range label (m_OPO_IRange); 'Auto' = ~A. */
  opoIRange: string;
}

/** SCHEMATIC_SETTINGS defaults (schematic_settings.cpp). */
export function defaultFormatting(): FormattingSettings {
  return {
    defaultTextSizeMils: 50,
    overbarOffsetRatio: 1.23,
    labelOffsetRatio: 15,
    labelSizeRatio: 37.5,
    defaultLineWidthMils: 6,
    pinSymbolSizeMils: 25,
    junctionDotChoice: 3, // "Default"
    hopOverChoice: 0, // "None"
    connectionGridMils: 50,
    intersheetRefsShow: false,
    intersheetRefsOwnPage: true,
    intersheetRefsAbbreviated: false,
    intersheetRefsPrefix: '[', // DEFAULT_IREF_PREFIX
    intersheetRefsSuffix: ']', // DEFAULT_IREF_SUFFIX
    dashLengthRatio: 12,
    gapLengthRatio: 3,
    opoVPrecision: 3,
    opoVRange: 'Auto',
    opoIPrecision: 3,
    opoIRange: 'Auto',
  };
}

// ---------------------------------------------------------------------------
// Annotation (PANEL_EESCHEMA_ANNOTATION_OPTIONS).

/** Symbol unit notation choices (m_choiceSeparatorRefId). */
export const SYMBOL_UNIT_NOTATIONS = ['A', '.A', '-A', '_A', '.1', '-1', '_1'];

/** Notation index -> (subpart_id_separator, subpart_first_id) char codes, in
 *  SYMBOL_UNIT_NOTATIONS order (dialog_annotate/panel handling upstream). */
export const UNIT_NOTATION_IDS: readonly (readonly [number, number])[] = [
  [0, 65],
  [46, 65],
  [45, 65],
  [95, 65],
  [46, 49],
  [45, 49],
  [95, 49],
];

/** The SubReference inputs for the chosen unit notation. */
export function subpartSettings(a: AnnotationSettings): { separator: number; firstId: number } {
  const [separator, firstId] = UNIT_NOTATION_IDS[a.symbolUnitNotation] ?? UNIT_NOTATION_IDS[0]!;
  return { separator, firstId };
}

export type AnnotateSortOrder = 'x' | 'y';
export type AnnotateNumbering = 'firstFree' | 'sheetX100' | 'sheetX1000';

/** Annotation defaults edited by the Annotation panel. */
export interface AnnotationSettings {
  /** Symbol unit notation choice index (m_choiceSeparatorRefId). */
  symbolUnitNotation: number;
  /** Sort symbols by X (down-then-right) or Y (right-then-down) position. */
  sortOrder: AnnotateSortOrder;
  /** How the first assigned number is chosen. */
  numbering: AnnotateNumbering;
  /** "Use first free number after:" starting value (m_textNumberAfter). */
  firstFreeAfter: number;
  /** Allow reference reuse (m_checkReuseRefdes). */
  allowReuse: boolean;
}

/** Annotation defaults (eeschema settings). */
export function defaultAnnotation(): AnnotationSettings {
  return {
    symbolUnitNotation: 0, // "A"
    sortOrder: 'x',
    numbering: 'firstFree',
    firstFreeAfter: 0,
    allowReuse: true, // reuse_designators PARAM default
  };
}

// ---------------------------------------------------------------------------
// Field name templates (TEMPLATES / PANEL_TEMPLATE_FIELDNAMES).

export interface FieldTemplate {
  name: string;
  visible: boolean;
  url: boolean;
}

// ---------------------------------------------------------------------------
// Text variables (PANEL_TEXT_VARIABLES / project text_variables).

// PROJECT_FILE::m_TextVars' rows; declared beside it in
// common/project/project_file.ts and re-exported here.
export type { TextVar } from '@ziroeda/common/project/project_file.js';
import type { TextVar } from '@ziroeda/common/project/project_file.js';

// ---------------------------------------------------------------------------
// BOM presets (bom_settings.h BOM_PRESET / BOM_FMT_PRESET; PANEL_BOM_PRESETS
// lists them, the Generate BOM dialog applies and saves them).

// BOM_FIELD / BOM_PRESET / BOM_FMT_PRESET are common/settings/bom_settings.ts,
// as upstream's are common/settings/bom_settings.cpp; the old names are kept
// as aliases for this module's callers.
import {
  type BOM_FIELD,
  BOM_FMT_PRESET,
  BOM_PRESET,
} from '@ziroeda/common/settings/bom_settings.js';
export {
  type BOM_FIELD,
  BOM_FMT_PRESET,
  BOM_PRESET,
} from '@ziroeda/common/settings/bom_settings.js';

/** One BOM column (BOM_FIELD): a symbol field or a `${...}` virtual field. */
export type BomField = BOM_FIELD;
/** A named view of the BOM table (BOM_PRESET). */
export type BomPreset = BOM_PRESET;
/** A named output format (BOM_FMT_PRESET). */
export type BomFmtPreset = BOM_FMT_PRESET;

export interface BomPresets {
  presets: BomPreset[];
  fmtPresets: BomFmtPreset[];
  /** schematic.bom_settings, the view the fields table last had
   *  (SCHEMATIC_SETTINGS::m_BomSettings, default "Default Editing"). */
  settings: BomPreset;
  /** schematic.bom_fmt_settings, the last output format (default CSV). */
  fmtSettings: BomFmtPreset;
  /** schematic.bom_export_filename, the Export tab's output file. */
  exportFileName: string;
}

export function defaultBomPresets(): BomPresets {
  // The current view/format start as copies of the built-ins, but they are the
  // user's own state (and are persisted), so they carry no read-only flag.
  const { readOnly: _ro, ...settings } = bomBuiltInPresets()[0]!;
  const { readOnly: _fro, ...fmtSettings } = bomFmtBuiltInPresets()[0]!;
  return { presets: [], fmtPresets: [], settings, fmtSettings, exportFileName: '' };
}

/** BOM_PRESET::BuiltInPresets(). */
export function bomBuiltInPresets(): BomPreset[] {
  return BOM_PRESET.BuiltInPresets();
}

/** BOM_FMT_PRESET::BuiltInPresets(). */
export function bomFmtBuiltInPresets(): BomFmtPreset[] {
  return BOM_FMT_PRESET.BuiltInPresets();
}

// ---------------------------------------------------------------------------
// Bus aliases (PANEL_SETUP_BUSES).

export interface BusAlias {
  name: string;
  members: string[];
}

export function defaultBusAliases(): BusAlias[] {
  return [];
}

// ---------------------------------------------------------------------------
// Net classes are NOT here: they are `NET_SETTINGS`, which lives
// in `common/project/net_settings.ts` because upstream's is
// `common/project/net_settings.cpp` — part of PROJECT_FILE, read by pcbnew as
// well as by eeschema. Re-exported below so this module's own callers are
// unaffected, while pcbnew asks common/ for them rather than asking eeschema.
export * from '@ziroeda/common/project/net_settings.js';
// `export *` re-exports without binding, so the names this module still
// USES are imported as well.
import { defaultNetClasses, type NetClassesData } from '@ziroeda/common/project/net_settings.js';

// ---------------------------------------------------------------------------
// Embedded files (PANEL_EMBEDDED_FILES).

// The panel's rows are EMBEDDED_FILES' data, so they live beside it in
// common/embedded_files.ts; re-exported for this module's callers.
export {
  defaultEmbeddedFiles,
  type EmbeddedFile,
  type EmbeddedFilesData,
} from '@ziroeda/common/embedded_files.js';
import { defaultEmbeddedFiles, type EmbeddedFilesData } from '@ziroeda/common/embedded_files.js';

// ---------------------------------------------------------------------------
// Derived drawing defaults (SCHEMATIC_SETTINGS helpers).

/** Internal units per mil (schIUScale: 12700 IU = 1.27 mm = 50 mils). */
export const IU_PER_MILS = 254;
/** DEFAULT_WIRE_WIDTH_MILS (eeschema/default_values.h). */
export const DEFAULT_WIRE_WIDTH_MILS = 6;
/** junction_size_mult_list (schematic_settings.cpp): junction-dot diameter as a
 *  multiple of the Default netclass wire width, indexed by junctionDotChoice
 *  (None, Smallest, Small, Default, Large, Largest). */
export const JUNCTION_SIZE_MULT = [0, 1.7, 4, 6, 9, 12] as const;

/** SCHEMATIC_SETTINGS::GetJunctionSize, the effective dot diameter (IU) for
 *  junctions without an explicit diameter: Default-netclass wire width × the
 *  choice multiplier, floored at 1 IU ("None" → 1 = draw no dot). */
export function junctionDotDiameterIU(s: SchematicSetup): number {
  const wireMils =
    parseFloat(s.netClasses.classes[0]?.wireThickness ?? '') || DEFAULT_WIRE_WIDTH_MILS;
  const mult = JUNCTION_SIZE_MULT[s.formatting.junctionDotChoice] ?? 6;
  return Math.max(Math.round(wireMils * IU_PER_MILS * mult), 1);
}

/** hopover_size_mult_list (schematic_settings.cpp): wire hop-over arc radius as
 *  a multiple of the default line width, indexed by hopOverChoice
 *  (None, Smallest, Small, Medium, Large, Largest). */
export const HOP_OVER_SIZE_MULT = [0, 1.7, 4, 6, 9, 12] as const;

/** SCHEMATIC_SETTINGS::GetHopOverScale × m_DefaultLineWidth, the painter's
 *  hop-over arc radius in IU (sch_painter.cpp draw(SCH_LINE): arcRadius =
 *  defaultLineWidth × hopOverScale). 0 = hop-overs off ("None"). */
export function hopOverArcRadiusIU(s: SchematicSetup): number {
  const mult = HOP_OVER_SIZE_MULT[s.formatting.hopOverChoice] ?? 0;
  return s.formatting.defaultLineWidthMils * IU_PER_MILS * mult;
}

// ---------------------------------------------------------------------------
// The dialog's full working set.

/** Project-scoped schematic settings edited by the dialog (SCHEMATIC_SETTINGS subset). */
export interface SchematicSetup {
  erc: ErcSettings;
  textVars: TextVar[];
  fieldTemplates: FieldTemplate[];
  /** Formatting defaults (PANEL_SETUP_FORMATTING). */
  formatting: FormattingSettings;
  /** Annotation defaults (PANEL_EESCHEMA_ANNOTATION_OPTIONS). */
  annotation: AnnotationSettings;
  /** BOM + BOM-formatting presets (PANEL_BOM_PRESETS). */
  bomPresets: BomPresets;
  /** Bus alias definitions (PANEL_SETUP_BUSES). */
  busAliases: BusAlias[];
  /** Net classes + assignments (PANEL_SETUP_NETCLASSES). */
  netClasses: NetClassesData;
  /** Embedded files + embed-fonts flag (PANEL_EMBEDDED_FILES). */
  embeddedFiles: EmbeddedFilesData;
  /** ERC exclusion signatures (SCHEMATIC::m_ercExclusions), persisted like the
   *  project file's stored exclusions so an excluded marker stays excluded. */
  ercExclusions: string[];
  /** The comment stored with each exclusion (MARKER_BASE::GetComment); the
   *  project file holds `[signature, comment]` pairs. */
  ercExclusionComments: Record<string, string>;
  /** REFDES_TRACKER state (schematic.used_designators): every designator ever
   *  assigned, so reuse_designators=false never re-issues a freed number. */
  usedDesignators: string;
}

export function defaultSchematicSetup(): SchematicSetup {
  return {
    erc: defaultErcSettings(),
    textVars: [],
    fieldTemplates: [],
    formatting: defaultFormatting(),
    annotation: defaultAnnotation(),
    bomPresets: defaultBomPresets(),
    busAliases: defaultBusAliases(),
    netClasses: defaultNetClasses(),
    embeddedFiles: defaultEmbeddedFiles(),
    ercExclusions: [],
    ercExclusionComments: {},
    usedDesignators: '',
  };
}

// ---------------------------------------------------------------------------
// `SCHEMATIC_SETTINGS`, the live-model class (eeschema stage E3): the constructor's
// defaults, with no EESCHEMA_SETTINGS app config (KiCad's answer when there is none).
// Everything above is the record model's settings, untouched.
//
// Not here: NGSPICE_SETTINGS (no simulator), and the EESCHEMA_SETTINGS app config the
// constructor reads its defaults from (none here, so upstream's no-config constants stand).
// ---------------------------------------------------------------------------

import { schIUScale as schIUScaleE3 } from '@ziroeda/common/eda_units.js';
import { METRICS as METRICS_E3 } from '@ziroeda/common/font/font_metrics.js';
import {
  DEFAULT_IREF_PREFIX as DEFAULT_IREF_PREFIX_E3,
  DEFAULT_IREF_SUFFIX as DEFAULT_IREF_SUFFIX_E3,
  DEFAULT_LABEL_SIZE_RATIO as DEFAULT_LABEL_SIZE_RATIO_E3,
  DEFAULT_LINE_WIDTH_MILS as DEFAULT_LINE_WIDTH_MILS_E3,
  DEFAULT_TEXT_OFFSET_RATIO as DEFAULT_TEXT_OFFSET_RATIO_E3,
  DEFAULT_TEXT_SIZE as DEFAULT_TEXT_SIZE_E3,
} from './default_values.js';
import { LIB_SYMBOL as LIB_SYMBOL_E3 } from './lib_symbol.js';
import { REFDES_TRACKER } from './refdes_tracker.js';
import { TEMPLATES } from '@ziroeda/common/template_fieldnames.js';
import { NESTED_SETTINGS } from '@ziroeda/common/settings/nested_settings.js';
import type { JSON_SETTINGS } from '@ziroeda/common/settings/json_settings.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings_internals.js';
import { PARAM, PARAM_LAMBDA, PARAM_SCALED, ref } from '@ziroeda/common/settings/parameters.js';
import {
  BOM_FMT_PRESET_from_json,
  BOM_FMT_PRESET_to_json,
  BOM_PRESET_from_json,
  BOM_PRESET_to_json,
} from '@ziroeda/common/settings/bom_settings.js';

/** `DEFAULT_CONNECTION_GRID_MILS` (schematic_settings.h). */
export const DEFAULT_CONNECTION_GRID_MILS = 50;

/** `MIN_CONNECTION_GRID_MILS` (schematic_settings.h). */
export const MIN_CONNECTION_GRID_MILS = 25;

/** `ARC_LOW_DEF_MM` (include/base_units.h). */
const ARC_LOW_DEF_MM_E3 = 0.02;

export type { TEMPLATE_FIELDNAME } from '@ziroeda/common/template_fieldnames.js';

const schSettingsSchemaVersion = 1;

/**
 * These are loaded from Eeschema settings but then overwritten by the project settings.
 * All of the values are stored in IU, but the backing file stores in mils.
 */
export class SCHEMATIC_SETTINGS extends NESTED_SETTINGS {
  m_DefaultLineWidth = Math.trunc(DEFAULT_LINE_WIDTH_MILS_E3 * schIUScaleE3.IU_PER_MILS);
  m_DefaultTextSize = Math.trunc(DEFAULT_TEXT_SIZE_E3 * schIUScaleE3.IU_PER_MILS);
  m_LabelSizeRatio = DEFAULT_LABEL_SIZE_RATIO_E3;
  m_TextOffsetRatio = DEFAULT_TEXT_OFFSET_RATIO_E3;
  m_PinSymbolSize = Math.trunc((DEFAULT_TEXT_SIZE_E3 * schIUScaleE3.IU_PER_MILS) / 2);

  m_JunctionSizeChoice = 3; // none = 0, smallest = 1, small = 2, etc.
  m_HopOverSizeChoice = 0; // none = 0, smallest = 1, etc.

  m_ConnectionGridSize = Math.trunc(DEFAULT_CONNECTION_GRID_MILS * schIUScaleE3.IU_PER_MILS);

  m_AnnotateStartNum = 0; // Starting value for annotation
  m_AnnotateSortOrder = 0; // Annotation sort order
  m_AnnotateMethod = 0; // Annotation numbering method (linear, sheet * 100, etc)

  m_SubpartIdSeparator = 0; // the separator char between the subpart id and the reference
  // 0 (no separator) or '.' or some other character
  m_SubpartFirstId = 'A'.charCodeAt(0); // the ASCII char value to calculate the subpart symbol
  // id from the symbol number: 'A', 'a' or '1' usually

  m_IntersheetRefsShow = false;
  m_IntersheetRefsListOwnPage = true;
  m_IntersheetRefsFormatShort = false;
  m_IntersheetRefsPrefix = DEFAULT_IREF_PREFIX_E3;
  m_IntersheetRefsSuffix = DEFAULT_IREF_SUFFIX_E3;

  m_DashedLineDashRatio = 12.0; // Dash length as ratio of the lineWidth
  m_DashedLineGapRatio = 3.0; // Gap length as ratio of the lineWidth

  m_OPO_VPrecision = 3; // Operating-point overlay voltage significant digits
  m_OPO_VRange = '~V'; // Operating-point overlay voltage range
  m_OPO_IPrecision = 3; // Operating-point overlay current significant digits
  m_OPO_IRange = '~A'; // Operating-point overlay current range

  m_SchDrawingSheetFileName = '';
  m_PlotDirectoryName = '';

  m_TemplateFieldNames = new TEMPLATES();

  /// List of stored BOM presets
  m_BomSettings: BOM_PRESET = BOM_PRESET.DefaultEditing();
  m_BomPresets: BOM_PRESET[] = [];

  /// List of stored BOM format presets
  m_BomFmtSettings: BOM_FMT_PRESET = BOM_FMT_PRESET.CSV();
  m_BomFmtPresets: BOM_FMT_PRESET[] = [];

  m_BomExportFileName = '';

  m_FontMetrics = METRICS_E3.Default();

  m_MaxError = Math.trunc(ARC_LOW_DEF_MM_E3 * schIUScaleE3.IU_PER_MM);

  m_VariantDescriptions = new Map<string, string>();

  /// A list of previously used schematic reference designators.
  m_refDesTracker: REFDES_TRACKER | null = null;

  constructor(aParent: JSON_SETTINGS | null = null, aPath = 'schematic') {
    super('schematic', schSettingsSchemaVersion, aParent, aPath, false);

    const mils = (v: number) => schIUScaleE3.milsToIU(v);
    const perMil = 1 / schIUScaleE3.IU_PER_MILS;

    this.addParam(
      new PARAM<boolean>('drawing.intersheets_ref_show', ref(this, 'm_IntersheetRefsShow'), false),
    );
    this.addParam(
      new PARAM<boolean>(
        'drawing.intersheets_ref_own_page',
        ref(this, 'm_IntersheetRefsListOwnPage'),
        true,
      ),
    );
    this.addParam(
      new PARAM<boolean>(
        'drawing.intersheets_ref_short',
        ref(this, 'm_IntersheetRefsFormatShort'),
        false,
      ),
    );
    this.addParam(
      new PARAM<string>(
        'drawing.intersheets_ref_prefix',
        ref(this, 'm_IntersheetRefsPrefix'),
        DEFAULT_IREF_PREFIX_E3,
      ),
    );
    this.addParam(
      new PARAM<string>(
        'drawing.intersheets_ref_suffix',
        ref(this, 'm_IntersheetRefsSuffix'),
        DEFAULT_IREF_SUFFIX_E3,
      ),
    );
    // Default from ISO 128-2
    this.addParam(
      new PARAM<number>(
        'drawing.dashed_lines_dash_length_ratio',
        ref(this, 'm_DashedLineDashRatio'),
        12.0,
      ),
    );
    // Default from ISO 128-2
    this.addParam(
      new PARAM<number>(
        'drawing.dashed_lines_gap_length_ratio',
        ref(this, 'm_DashedLineGapRatio'),
        3.0,
      ),
    );
    this.addParam(
      new PARAM<number>(
        'drawing.operating_point_overlay_v_precision',
        ref(this, 'm_OPO_VPrecision'),
        3,
      ),
    );
    this.addParam(
      new PARAM<string>('drawing.operating_point_overlay_v_range', ref(this, 'm_OPO_VRange'), '~V'),
    );
    this.addParam(
      new PARAM<number>(
        'drawing.operating_point_overlay_i_precision',
        ref(this, 'm_OPO_IPrecision'),
        3,
      ),
    );
    this.addParam(
      new PARAM<string>('drawing.operating_point_overlay_i_range', ref(this, 'm_OPO_IRange'), '~A'),
    );
    this.addParam(
      new PARAM_SCALED(
        'drawing.default_line_thickness',
        ref(this, 'm_DefaultLineWidth'),
        mils(DEFAULT_LINE_WIDTH_MILS_E3),
        mils(5),
        mils(1000),
        perMil,
      ),
    );
    this.addParam(
      new PARAM_SCALED(
        'drawing.default_text_size',
        ref(this, 'm_DefaultTextSize'),
        mils(DEFAULT_TEXT_SIZE_E3),
        mils(5),
        mils(1000),
        perMil,
      ),
    );
    this.addParam(
      new PARAM<number>(
        'drawing.text_offset_ratio',
        ref(this, 'm_TextOffsetRatio'),
        DEFAULT_TEXT_OFFSET_RATIO_E3,
        0.0,
        2.0,
      ),
    );
    this.addParam(
      new PARAM<number>(
        'drawing.label_size_ratio',
        ref(this, 'm_LabelSizeRatio'),
        DEFAULT_LABEL_SIZE_RATIO_E3,
        0.0,
        2.0,
      ),
    );
    this.addParam(
      new PARAM<number>(
        'drawing.overbar_offset_ratio',
        ref(this.m_FontMetrics, 'm_OverbarHeight'),
        this.m_FontMetrics.m_OverbarHeight,
      ),
    );
    this.addParam(
      new PARAM_SCALED(
        'drawing.pin_symbol_size',
        ref(this, 'm_PinSymbolSize'),
        mils(DEFAULT_TEXT_SIZE_E3 / 2),
        mils(0),
        mils(1000),
        perMil,
      ),
    );
    this.addParam(
      new PARAM_SCALED(
        'connection_grid_size',
        ref(this, 'm_ConnectionGridSize'),
        mils(DEFAULT_CONNECTION_GRID_MILS),
        mils(MIN_CONNECTION_GRID_MILS),
        mils(10000),
        perMil,
      ),
    );
    // User choice for junction dot size ( e.g. none = 0, smallest = 1, small = 2, etc )
    this.addParam(
      new PARAM<number>('drawing.junction_size_choice', ref(this, 'm_JunctionSizeChoice'), 3),
    );
    this.addParam(
      new PARAM<number>('drawing.hop_over_size_choice', ref(this, 'm_HopOverSizeChoice'), 0),
    );

    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'drawing.field_names',
        () =>
          this.m_TemplateFieldNames.GetTemplateFieldNames(false).map((field) => ({
            name: field.m_Name,
            visible: field.m_Visible,
            url: field.m_URL,
          })),
        (aJson) => {
          if (Array.isArray(aJson) && aJson.length > 0) {
            this.m_TemplateFieldNames.DeleteAllFieldNameTemplates(false);

            for (const entry of aJson) {
              if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
              if (!('name' in entry) || !('url' in entry) || !('visible' in entry)) continue;

              this.m_TemplateFieldNames.AddTemplateFieldName(
                {
                  m_Name: String(entry.name),
                  m_URL: Boolean(entry.url),
                  m_Visible: Boolean(entry.visible),
                },
                false,
              );
            }
          }

          // Read global fieldname templates: no EESCHEMA_SETTINGS here.
        },
        [],
      ),
    );

    this.addParam(
      new PARAM<string>(
        'bom_export_filename',
        ref(this, 'm_BomExportFileName'),
        '${PROJECTNAME}.csv',
      ),
    );

    // PARAM<BOM_PRESET> / PARAM_LIST<BOM_PRESET> through bom_settings.cpp's to_json/from_json.
    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'bom_settings',
        () => BOM_PRESET_to_json(this.m_BomSettings) as JsonValue,
        (j) => {
          this.m_BomSettings = BOM_PRESET_from_json(j);
        },
        BOM_PRESET_to_json(BOM_PRESET.DefaultEditing()) as JsonValue,
      ),
    );
    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'bom_presets',
        () => this.m_BomPresets.map(BOM_PRESET_to_json) as JsonValue,
        (j) => {
          this.m_BomPresets = Array.isArray(j) ? j.map(BOM_PRESET_from_json) : [];
        },
        [],
      ),
    );
    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'bom_fmt_settings',
        () => BOM_FMT_PRESET_to_json(this.m_BomFmtSettings) as JsonValue,
        (j) => {
          this.m_BomFmtSettings = BOM_FMT_PRESET_from_json(j);
        },
        BOM_FMT_PRESET_to_json(BOM_FMT_PRESET.CSV()) as JsonValue,
      ),
    );
    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'bom_fmt_presets',
        () => this.m_BomFmtPresets.map(BOM_FMT_PRESET_to_json) as JsonValue,
        (j) => {
          this.m_BomFmtPresets = Array.isArray(j) ? j.map(BOM_FMT_PRESET_from_json) : [];
        },
        [],
      ),
    );

    this.addParam(
      new PARAM<string>('page_layout_descr_file', ref(this, 'm_SchDrawingSheetFileName'), ''),
    );
    this.addParam(new PARAM<string>('plot_directory', ref(this, 'm_PlotDirectoryName'), ''));
    this.addParam(
      new PARAM<number>('subpart_id_separator', ref(this, 'm_SubpartIdSeparator'), 0, 0, 126),
    );
    this.addParam(
      new PARAM<number>(
        'subpart_first_id',
        ref(this, 'm_SubpartFirstId'),
        'A'.charCodeAt(0),
        '1'.charCodeAt(0),
        'z'.charCodeAt(0),
      ),
    );
    this.addParam(new PARAM<number>('annotate_start_num', ref(this, 'm_AnnotateStartNum'), 0));
    this.addParam(
      new PARAM<number>('annotation.sort_order', ref(this, 'm_AnnotateSortOrder'), 0, 0, 1),
    );
    this.addParam(new PARAM<number>('annotation.method', ref(this, 'm_AnnotateMethod'), 0, 0, 2));

    this.addParam(
      new PARAM_LAMBDA<boolean>(
        'reuse_designators',
        () => (this.m_refDesTracker ? this.m_refDesTracker.GetReuseRefDes() : false),
        (aReuse) => {
          if (!this.m_refDesTracker) this.m_refDesTracker = new REFDES_TRACKER();

          this.m_refDesTracker.SetReuseRefDes(aReuse);
        },
        true,
      ),
    );
    this.addParam(
      new PARAM_LAMBDA<string>(
        'used_designators',
        () => (this.m_refDesTracker ? this.m_refDesTracker.Serialize() : ''),
        (aData) => {
          if (!this.m_refDesTracker) this.m_refDesTracker = new REFDES_TRACKER();

          this.m_refDesTracker.Deserialize(aData);
        },
        '',
      ),
    );

    this.addParam(
      new PARAM_LAMBDA<JsonValue>(
        'variants',
        () => {
          const ret: JsonValue[] = [];

          // std::map<wxString, wxString>: key order.
          for (const [name, description] of [...this.m_VariantDescriptions].sort((a, b) =>
            a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
          )) {
            const entry: { [k: string]: JsonValue } = { name };

            if (description !== '') entry.description = description;

            ret.push(entry);
          }

          return ret;
        },
        (aJson) => {
          this.m_VariantDescriptions.clear();

          if (Array.isArray(aJson)) {
            for (const entry of aJson) {
              if (
                entry !== null &&
                typeof entry === 'object' &&
                !Array.isArray(entry) &&
                'name' in entry
              ) {
                const name = String(entry.name);
                const desc = 'description' in entry ? String(entry.description) : '';

                this.m_VariantDescriptions.set(name, desc);
              }
            }
          }
        },
        [],
      ),
    );

    this.registerMigration(0, 1, () => {
      const tor = this.Get<number>('drawing.text_offset_ratio');

      if (tor !== undefined) this.Set('drawing.label_size_ratio', tor);

      return true;
    });
  }

  /**
   * Return the sub-reference of a unit: the separator (when set and asked for) and the
   * unit as a number or a letter sequence.
   */
  SubReference(aUnit: number, aAddSeparator = true): string {
    let subRef = '';

    if (aUnit < 1) return subRef;

    if (this.m_SubpartIdSeparator !== 0 && aAddSeparator)
      subRef += String.fromCharCode(this.m_SubpartIdSeparator);

    if (this.m_SubpartFirstId >= '0'.charCodeAt(0) && this.m_SubpartFirstId <= '9'.charCodeAt(0))
      subRef += String(aUnit);
    else
      subRef += LIB_SYMBOL_E3.LetterSubReference(aUnit, String.fromCharCode(this.m_SubpartFirstId));

    return subRef;
  }

  /**
   * `GetJunctionSize`: the default netclass wire width times the size choice's
   * multiplier, never below 1.  The project's default netclass is pending, so its
   * default wire width (6 mils) stands.
   */
  GetJunctionSize(): number {
    const multiplier = JUNCTION_SIZE_MULT[this.m_JunctionSizeChoice] ?? 0;
    const wireWidth = DEFAULT_WIRE_WIDTH_MILS * IU_PER_MILS;
    const dotSize = Math.round(wireWidth * multiplier);

    return Math.max(dotSize, 1);
  }

  GetHopOverScale(): number {
    return HOP_OVER_SIZE_MULT[this.m_HopOverSizeChoice] ?? 0;
  }
}
