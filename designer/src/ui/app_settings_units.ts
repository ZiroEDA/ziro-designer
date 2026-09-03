// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `system.units`' default, per app.
 *
 * `APP_SETTINGS_BASE::APP_SETTINGS_BASE` registers the parameter once, with a
 * default chosen by ONE branch on the settings filename
 * (`common/settings/app_settings.cpp:228-238`):
 *
 * ```cpp
 * if( m_filename == wxS( "pl_editor" )
 *     || ( m_filename == wxS( "eeschema" ) || m_filename == wxS( "symbol_editor" ) ) )
 * {
 *     m_params.emplace_back( new PARAM<int>( "system.units",
 *             &m_System.units, static_cast<int>( EDA_UNITS::MILS ) ) );
 * }
 * else
 * {
 *     m_params.emplace_back( new PARAM<int>( "system.units",
 *             &m_System.units, static_cast<int>( EDA_UNITS::MM ) ) );
 * }
 * ```
 *
 * That branch is the reason a fresh Symbol Editor opens reading `grid 50` /
 * `mils` while a fresh pcbnew opens reading `mm` — and it is a value KiCad gets
 * from one shared place, so we must too. Every frame that used to write its own
 * `'unitsMm'` or `'unitsMils'` into a local `DEFAULT_TOGGLES` had restated this
 * branch from memory, and the Symbol Editor had restated it **wrong**: it
 * booted in mm against upstream's mils.
 *
 * [data] The app names are KiCad's own settings filenames
 * (`APP_SETTINGS_BASE( "symbol_editor", … )`, `symbol_editor_settings.cpp:38`),
 * not our invention, so they are spelled the way upstream spells them.
 */
import type { EdaUnits } from '@ziroeda/common/src/eda_units.js';

/** The three units a drawing frame's Units toolbar group offers. */
export type DefaultUnits = 'mm' | 'mils';

/**
 * A KiCad settings filename — `JSON_SETTINGS::m_filename`, the string each
 * `APP_SETTINGS_BASE` subclass passes to its base constructor.
 */
export type AppSettingsName =
  | 'eeschema'
  | 'symbol_editor'
  | 'pcbnew'
  | 'fpedit'
  | 'gerbview'
  | 'pl_editor'
  | 'bitmap2component'
  | 'pcb_calculator';

/**
 * `system.units`' default for one app (`app_settings.cpp:228-238`).
 *
 * The imperial side of the branch is exactly three names; everything else is
 * millimetres.
 */
export function defaultUnits(app: AppSettingsName): DefaultUnits {
  return app === 'pl_editor' || app === 'eeschema' || app === 'symbol_editor' ? 'mils' : 'mm';
}

/**
 * `EDA_UNITS` as stored in `system.units`, narrowed to the three a drawing
 * frame can display.
 *
 * `EDA_UNITS` has nine members and a settings file can hold any of them, but a
 * frame's Units toolbar group offers three (`ACTIONS::millimetersUnits`,
 * `inchesUnits`, `milsUnits`) and every `UNITS_PROVIDER` consumer here is typed
 * to those. Anything else — `um`, `cm`, `degrees` — is not a length a grid or a
 * coordinate is ever shown in, so it reads as millimetres, which is the branch
 * `EDA_DRAW_FRAME::GetUnitPair` treats as the metric side
 * (`common/eda_draw_frame.cpp:1400-1421`).
 */
export function toStatusUnits(units: string): 'mm' | 'in' | 'mils' {
  return units === 'mils' ? 'mils' : units === 'in' ? 'in' : 'mm';
}

/**
 * The same answer as the id of the Units toolbar group's checked action —
 * `ACTIONS::millimetersUnits` / `ACTIONS::milsUnits`, which is how a frame's
 * `DEFAULT_TOGGLES` spells its starting unit.
 */
export function defaultUnitsToggle(app: AppSettingsName): 'unitsMm' | 'unitsMils' {
  return defaultUnits(app) === 'mils' ? 'unitsMils' : 'unitsMm';
}

// ---------------------------------------------------------------------------
// `COMMON_TOOLS`' unit actions
// ---------------------------------------------------------------------------

/**
 * The `system.*` slice every `APP_SETTINGS_BASE` carries
 * (`app_settings.cpp:228-244`). Taken structurally rather than per app, because
 * `COMMON_TOOLS` is one tool on the TOOL_MANAGER every frame shares — it does
 * not know which settings file it is looking at, and neither should this.
 */
export interface UnitsSlice {
  units: EdaUnits;
  last_metric_units: EdaUnits;
  last_imperial_units: EdaUnits;
}

/** The toolbar/menu id for a stored unit. */
export function unitsToggleId(units: EdaUnits): 'unitsMm' | 'unitsInches' | 'unitsMils' {
  switch (units) {
    case 'in':
      return 'unitsInches';
    case 'mils':
      return 'unitsMils';
    default:
      return 'unitsMm';
  }
}

/** The inverse, for writing a toolbar choice back to `system.units`. */
export function toggleIdUnits(id: string): EdaUnits {
  switch (id) {
    case 'unitsInches':
      return 'in';
    case 'unitsMils':
      return 'mils';
    default:
      return 'mm';
  }
}

/**
 * `EDA_UNIT_UTILS::IsImperialUnit` (`common/eda_units.cpp`) for the three a
 * frame can be in: INCH and MILS are imperial, MM is metric.
 */
export function isImperialUnits(units: EdaUnits): boolean {
  return units === 'in' || units === 'mils';
}

/**
 * `COMMON_TOOLS::SwitchUnits` (`common_tools.cpp:656-668`): picking a unit sets
 * the frame's unit **and** remembers it as the last of its own family, which is
 * what `ACTIONS::toggleUnits` (Ctrl+U) flips back to. Only one of the two
 * `last_*` fields moves, because the incoming unit belongs to one family.
 */
export function switchUnits(cfg: UnitsSlice, id: string): void {
  const units = toggleIdUnits(id);
  if (isImperialUnits(units)) cfg.last_imperial_units = units;
  else cfg.last_metric_units = units;
  cfg.units = units;
}

/**
 * `COMMON_TOOLS::ToggleUnits` (`common_tools.cpp:671-677`): Ctrl+U swaps
 * families, landing on whichever member of the other family was used last.
 */
export function toggleUnitsId(cfg: UnitsSlice): string {
  return unitsToggleId(
    isImperialUnits(cfg.units) ? cfg.last_metric_units : cfg.last_imperial_units,
  );
}
