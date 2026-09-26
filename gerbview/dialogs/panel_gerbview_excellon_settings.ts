// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GERBVIEW_EXCELLON_SETTINGS`' data: its two radio groups, the four
 * digit-count choices, and the range those share.
 *
 * A `.ts` and not part of the panel for the reason `dialogs/prefs/gal_options.ts`
 * is: `qa`'s tsconfig sets no `--jsx`, so a table living inside JSX could only
 * be checked by scraping the file as text, and "the right number appears
 * somewhere in the file" is satisfied by a commented-out line.
 *
 * Every string here is `panel_gerbview_excellon_settings_base.cpp`'s and every
 * number is `excellon_defaults.h`'s.
 */

/**
 * `File units:` — `m_rbInches` then `m_rbMM` (`:37-44`), in that order, with
 * `wxRB_GROUP` on the first. The stored value is `m_UnitsMM`, so the labels and
 * the flag run opposite ways round; `false` is Inches.
 *
 * Note the spelling: `_( "Inches" )` capitalised and `_( "mm" )` not. Both are
 * upstream's own.
 */
export type ExcellonUnit = 'inch' | 'mm';

export const EXCELLON_UNIT_CHOICES: readonly (readonly [ExcellonUnit, string])[] = [
  ['inch', 'Inches'],
  ['mm', 'mm'],
];

/** `m_UnitsMM` — the stored flag, which is `true` for the second button. */
export const unitIsMM = (u: ExcellonUnit): boolean => u === 'mm';
export const unitOf = (mm: boolean): ExcellonUnit => (mm ? 'mm' : 'inch');

/**
 * `Zero format:` — `m_rbTZ` then `m_rbLZ` (`:50-56`), `wxRB_GROUP` on TZ. The
 * stored value is `m_LeadingZero`, whose default is TRUE, i.e. the SECOND
 * button — `applySettingsToPanel` reads
 * `if( aSettings.m_LeadingZero ) m_rbLZ->SetValue( true ); else m_rbTZ...`
 * (`panel_gerbview_excellon_settings.cpp:85-88`).
 *
 * The labels look transposed and are not. `LZ` means leading zeros are KEPT and
 * trailing ones dropped, so the button that selects it reads "No trailing
 * zeros (LZ format)". Transcribed rather than tidied.
 */
export type ExcellonZeroFormat = 'tz' | 'lz';

export const EXCELLON_ZERO_CHOICES: readonly (readonly [ExcellonZeroFormat, string])[] = [
  ['tz', 'No leading zeros (TZ format)'],
  ['lz', 'No trailing zeros (LZ format)'],
];

/** `m_LeadingZero` — the stored flag, `true` for LZ. */
export const zeroIsLeading = (z: ExcellonZeroFormat): boolean => z === 'lz';
export const zeroFormatOf = (leading: boolean): ExcellonZeroFormat => (leading ? 'lz' : 'tz');

/**
 * The four `wxChoice`es' items: `{ "2", "3", "4", "5", "6" }` (`:96`, `:106`,
 * `:126`, `:136`).
 *
 * `TransferDataFromWindow` reads them as `GetSelection() + FIRST_VALUE` with
 * `#define FIRST_VALUE 2` (`panel_gerbview_excellon_settings.cpp:62-67`), and
 * the `PARAM`s clamp to 2..6 (`gerbview_settings.cpp:87-97`). So the list is
 * the value, not an index into one.
 */
export const EXCELLON_DIGIT_CHOICES: readonly (readonly [number, string])[] = [
  [2, '2'],
  [3, '3'],
  [4, '4'],
  [5, '5'],
  [6, '6'],
];

/** The `PARAM<int>` bounds those five values are exactly (`gerbview_settings.cpp:87-97`). */
export const EXCELLON_DIGIT_RANGE = { min: 2, max: 6 } as const;

/**
 * The page's headings, help lines and hints, in source order
 * (`panel_gerbview_excellon_settings_base.cpp:18`, `:28`, `:36`, `:47`, `:66`,
 * `:77`, `:81`, `:87`, `:118`, `:146`).
 *
 * The three italic ones are `KIUI::GetInfoFont( this ).Italic()`
 * (`panel_gerbview_excellon_settings.cpp:32-36`) — the same treatment every
 * other explanatory line in the app gets, and the reason they are listed apart
 * from the labels.
 */
export const EXCELLON_STRINGS = {
  fileFormat: 'File Format',
  fileFormatHelp: 'These parameters are usually specified in files, but not always.',
  units: 'File units:',
  zeroFormat: 'Zero format:',
  coordinates: 'Coordinates Format',
  coordinatesHelp: 'The coordinates format is not specified in Excellon format.',
  hint1: '(The decimal format does not use these settings)',
  formatMm: 'Format for mm:',
  formatInch: 'Format for inches:',
  hint2: 'Usually: 3:3 in mm and 2:4 in inches',
  /** `m_staticText8` / `m_staticText9`, the separator between the two choices. */
  separator: ':',
} as const;
