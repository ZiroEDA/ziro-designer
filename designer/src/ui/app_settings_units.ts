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
 * The same answer as the id of the Units toolbar group's checked action —
 * `ACTIONS::millimetersUnits` / `ACTIONS::milsUnits`, which is how a frame's
 * `DEFAULT_TOGGLES` spells its starting unit.
 */
export function defaultUnitsToggle(app: AppSettingsName): 'unitsMm' | 'unitsMils' {
  return defaultUnits(app) === 'mils' ? 'unitsMils' : 'unitsMm';
}
