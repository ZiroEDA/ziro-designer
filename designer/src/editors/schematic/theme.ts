// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic's view of KiCad's built-in colour themes.
 *
 * The colours themselves are NOT defined here. They live once, for every
 * editor, in `@ziroeda/common/src/settings/builtin_color_themes.ts` — a
 * mechanical port of `common/settings/builtin_color_themes.h`, which is
 * likewise the single place KiCad defines them. This module only names the
 * schematic layers eeschema's renderer cares about (`SCH_LAYER_ID`) and
 * renders each one to a CSS string, the way `SCH_RENDER_SETTINGS::LoadColors`
 * pulls `m_layerColors[aLayer]` out of the shared `COLOR_SETTINGS`.
 *
 * Adding a colour here means adding a layer to `SCH_LAYERS` below, never
 * typing an RGB value.
 */
import {
  BUILTIN_CLASSIC_THEME,
  BUILTIN_DEFAULT_THEME,
  type Color4d,
  toCssColor,
} from '@ziroeda/common';

/**
 * Which `SCH_LAYER_ID` each field of `Theme` reads, so that the mapping from
 * our renderer's vocabulary to KiCad's is stated once and can be checked
 * against `layer_ids.h`.
 */
const SCH_LAYERS = {
  background: 'LAYER_SCHEMATIC_BACKGROUND',
  grid: 'LAYER_SCHEMATIC_GRID',
  // `SCH_BASE_FRAME::UpdateGridColors` hands this one straight to the GAL:
  // `GetGAL()->SetAxesColor( colorSettings->GetColor( LAYER_SCHEMATIC_GRID_AXES ) )`
  // (`eeschema/sch_base_frame.cpp:612`). Only the Symbol Editor paints with it,
  // because it is the frame that turns the axes ON
  // (`symbol_edit_frame.cpp:265`, `GetCanvas()->GetGAL()->SetAxesEnabled( true )`).
  gridAxes: 'LAYER_SCHEMATIC_GRID_AXES',
  wire: 'LAYER_WIRE',
  bus: 'LAYER_BUS',
  busJunction: 'LAYER_BUS_JUNCTION',
  junction: 'LAYER_JUNCTION',
  symbolOutline: 'LAYER_DEVICE',
  symbolFill: 'LAYER_DEVICE_BACKGROUND',
  pin: 'LAYER_PIN',
  pinName: 'LAYER_PINNAM',
  pinNumber: 'LAYER_PINNUM',
  reference: 'LAYER_REFERENCEPART',
  value: 'LAYER_VALUEPART',
  fields: 'LAYER_FIELDS',
  label: 'LAYER_LOCLABEL',
  globalLabel: 'LAYER_GLOBLABEL',
  hierLabel: 'LAYER_HIERLABEL',
  netclassFlag: 'LAYER_NETCLASS_REFS',
  netHighlight: 'LAYER_BRIGHTENED',
  selectionShadow: 'LAYER_SELECTION_SHADOWS',
  brightened: 'LAYER_BRIGHTENED',
  noteLine: 'LAYER_NOTES',
  noText: 'LAYER_NOTES',
  ruleArea: 'LAYER_RULE_AREAS',
  privateNote: 'LAYER_PRIVATE_NOTES',
  noConnect: 'LAYER_NOCONNECT',
  ercError: 'LAYER_ERC_ERR',
  ercWarning: 'LAYER_ERC_WARN',
  ercExclusion: 'LAYER_ERC_EXCLUSION',
  sheetBorder: 'LAYER_SHEET',
  sheetBackground: 'LAYER_SHEET_BACKGROUND',
  sheetName: 'LAYER_SHEETNAME',
  sheetFile: 'LAYER_SHEETFILENAME',
  sheetLabel: 'LAYER_SHEETLABEL',
  sheetFields: 'LAYER_SHEETFIELDS',
  pageFrame: 'LAYER_SCHEMATIC_DRAWINGSHEET',
  pageLimits: 'LAYER_SCHEMATIC_PAGE_LIMITS',
  anchor: 'LAYER_SCHEMATIC_ANCHOR',
  hidden: 'LAYER_HIDDEN',
  cursor: 'LAYER_SCHEMATIC_CURSOR',
  auxItems: 'LAYER_SCHEMATIC_AUX_ITEMS',
} as const satisfies Record<string, keyof typeof BUILTIN_DEFAULT_THEME>;

export interface Theme {
  background: string;
  grid: string;
  /** LAYER_SCHEMATIC_GRID_AXES: the two lines through the world origin. */
  gridAxes: string;
  wire: string;
  bus: string;
  busJunction: string;
  junction: string;
  symbolOutline: string;
  symbolFill: string;
  pin: string;
  pinName: string;
  pinNumber: string;
  reference: string;
  value: string;
  /** User fields (LAYER_FIELDS). */
  fields: string;
  label: string;
  globalLabel: string;
  hierLabel: string;
  /** LAYER_NETCLASS_REFS, netclass directive labels. */
  netclassFlag: string;
  netHighlight: string;
  selectionShadow: string;
  /** LAYER_BRIGHTENED: what a cross-probed item turns while it is focused. */
  brightened: string;
  noteLine: string;
  noText: string;
  /** LAYER_RULE_AREAS: the outline of a schematic rule area. */
  ruleArea: string;
  privateNote: string;
  noConnect: string;
  ercError: string;
  ercWarning: string;
  /** LAYER_ERC_EXCLUSION, the colour of an excluded marker. */
  ercExclusion: string;
  sheetBorder: string;
  sheetBackground: string;
  sheetName: string;
  sheetFile: string;
  sheetLabel: string;
  sheetFields: string;
  pageFrame: string;
  /** LAYER_SCHEMATIC_PAGE_LIMITS: the paper-edge lines when "Show page limits" is on. */
  pageLimits: string;
  /** LAYER_SCHEMATIC_ANCHOR: text/origin anchor crosses. */
  anchor: string;
  /** LAYER_HIDDEN: hidden pins/fields when shown. */
  hidden: string;
  /** LAYER_SCHEMATIC_CURSOR: the crosshair cursor. */
  cursor: string;
  /** LAYER_SCHEMATIC_AUX_ITEMS: what EDIT_POINTS derives its colours from. */
  auxItems: string;
}

/**
 * Project one built-in `COLOR_SETTINGS` onto the fields the renderer reads.
 *
 * A layer absent from a theme falls back to "KiCad Default". Upstream it would
 * not: `COLOR_SETTINGS::GetColor()` returns `COLOR4D::UNSPECIFIED` — fully
 * transparent — for a layer the theme never set, and the classic theme sets no
 * `LAYER_SCHEMATIC_PAGE_LIMITS`, so KiCad Classic draws no page limits at all.
 * The fallback stays because it is what this module has always rendered;
 * matching upstream's invisible page limits is a behaviour change, not a
 * transcription fix, so it is left for a deliberate one.
 */
const project = (colors: Partial<Record<string, Color4d>>): Theme =>
  Object.fromEntries(
    Object.entries(SCH_LAYERS).map(([field, layer]) => [
      field,
      toCssColor(colors[layer] ?? BUILTIN_DEFAULT_THEME[layer], ', '),
    ]),
  ) as unknown as Theme;

/** "KiCad Default", `s_defaultTheme` (the beige theme KiCad ships as default). */
export const KICAD_DEFAULT: Theme = project(BUILTIN_DEFAULT_THEME);

/** "KiCad Classic", `s_classicTheme` (the white legacy theme). */
export const KICAD_CLASSIC: Theme = project(BUILTIN_CLASSIC_THEME);

/** Builtin themes by their KiCad settings ids. */
export const BUILTIN_THEMES: Record<string, { name: string; theme: Theme }> = {
  _builtin_default: { name: 'KiCad Default', theme: KICAD_DEFAULT },
  _builtin_classic: { name: 'KiCad Classic', theme: KICAD_CLASSIC },
};
