// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `Color theme:` / `Theme:` choice, written once.
 *
 * Upstream the *list* in this control is app-wide, not any editor's:
 * `Pgm().GetSettingsManager().GetColorSettingsList()`, walked identically by
 * `PANEL_COLOR_SETTINGS::TransferDataToWindow` and by
 * `PANEL_PL_EDITOR_COLOR_SETTINGS::TransferDataToWindow`
 * (`pagelayout_editor/dialogs/panel_pl_editor_color_settings.cpp:44-58`), which
 * is the whole of pl_editor's Colors page — that page has this row and nothing
 * else (`panel_pl_editor_color_settings_base.cpp:19-27`).
 *
 * Only the label differs: `PANEL_COLOR_SETTINGS_BASE` says `Theme:`, pl_editor's
 * own base file says `Color theme:`.
 *
 * That `BUILTIN_THEMES` still lives under `editors/schematic/` is pre-existing
 * debt of the same kind `types.ts` records for `HotkeyOverrides`: upstream it is
 * `COLOR_SETTINGS` in `common/settings/`, owned by no app. It is imported here,
 * above both consumers, rather than a second time inside each of them.
 */
import type { JSX } from 'react';
import { Sel } from './widgets.js';
import { BUILTIN_THEMES } from '../../editors/schematic/theme.js';
import { pcm, usePcmVersion } from '../../pcm/pcmStore.js';

/**
 * `PANEL_COLOR_SETTINGS::GetSettingsDropdownName`
 * (`common/dialogs/panel_color_settings.cpp:391-398`):
 *
 *     wxString name = aSettings->GetName();
 *     if( aSettings->IsReadOnly() )
 *         name += wxS( " " ) + _( "(read-only)" );
 *
 * and `IsReadOnly()` is `!m_writeFile` (`json_settings.h:105`). The two
 * built-ins set `m_writeFile = false` in `CreateBuiltinColorSettings`
 * (`color_settings.cpp:445-455`) and everything under the system and
 * third-party colour directories gets `SetReadOnly( true )`
 * (`settings_manager.cpp:434-438`) — so every theme a user cannot save into
 * says so in the choice itself. Only the writable one, ours, does not.
 */
const dropdownName = (name: string, readOnly: boolean): string =>
  readOnly ? `${name} (read-only)` : name;

/**
 * `GetColorSettingsList()`: the built-in themes, then whatever is installed,
 * then ours — the "User" row, which is where a per-layer override lands.
 *
 * `aMarkReadOnly` is not a preference: `PANEL_COLOR_SETTINGS` fills its choice
 * through `GetSettingsDropdownName` (`panel_color_settings.cpp:340`) while
 * `PANEL_PL_EDITOR_COLOR_SETTINGS` appends `settings->GetName()` raw
 * (`panel_pl_editor_color_settings.cpp:46`). One list, named two ways, and the
 * difference is upstream's.
 */
/**
 * `createThemeList`'s last two rows (`panel_color_settings.cpp:238-239`):
 *
 *     m_cbTheme->Append( wxT( "---" ) );
 *     m_cbTheme->Append( _( "New Theme..." ) );
 *
 * They belong to `PANEL_COLOR_SETTINGS` alone — `PANEL_PL_EDITOR_COLOR_SETTINGS`
 * fills its own choice from `GetColorSettingsList()` and appends neither
 * (`panel_pl_editor_color_settings.cpp:44-58`), which is why they are a
 * parameter here and not part of the list.
 */
export const THEME_SEPARATOR = '---';
export const NEW_THEME = 'New Theme...';

export function colorThemeOptions(
  installed: readonly { id: string; name: string }[],
  markReadOnly = false,
  /** Themes made with "New Theme...", keyed by file stem. */
  userThemes: Readonly<Record<string, { name: string }>> = {},
  /** Append `---` and `New Theme...`. Only `PANEL_COLOR_SETTINGS` does. */
  allowNew = false,
): [string, string][] {
  const name = (n: string, readOnly: boolean): string =>
    markReadOnly ? dropdownName(n, readOnly) : n;
  // `SETTINGS_MANAGER::GetColorSettingsList` (`settings_manager.cpp:292-303`)
  // sorts the whole list by NAME before anyone displays it:
  //
  //     std::sort( ret.begin(), ret.end(), []( COLOR_SETTINGS* a, COLOR_SETTINGS* b )
  //                                        { return a->GetName() < b->GetName(); } );
  //
  // so a real KiCad lists "KiCad Classic" BEFORE "KiCad Default", and an
  // installed theme lands alphabetically among them rather than after them. We
  // listed the built-ins in declaration order and appended the rest, which put
  // Default first and every PCM theme at the end.
  //
  // The sort key is the RAW name — `GetName()`, not `GetSettingsDropdownName()`
  // — so " (read-only)" is appended after ordering and cannot affect it. A
  // plain `<` rather than `localeCompare`, because `wxString::operator<` is
  // what upstream compares with.
  const raw: [id: string, name: string, readOnly: boolean][] = [
    ...Object.entries(BUILTIN_THEMES).map(([id, t]): [string, string, boolean] => [
      id,
      t.name,
      true,
    ]),
    // A PCM theme lands in the third-party colours directory, which
    // `registerColorSettings( …, true )` marks read-only.
    ...installed.map((t): [string, string, boolean] => [t.id, t.name, true]),
    // The user theme's name is NOT a literal "User". It is `colors/user.json`'s
    // `meta.name`, whose PARAM default is "KiCad Default"
    // (`color_settings.cpp:45-46`) — `SetName( "User" )` runs only in
    // `GetMigratedColorSettings` when that file has to be CREATED
    // (`settings_manager.cpp:385-389`), so an installed KiCad that already has
    // one shows the file's name. This machine's does, and it says
    // "KiCad Default". We store colours for this theme and no name, so the
    // PARAM default is the whole of the answer.
    ['user', BUILTIN_THEMES._builtin_default?.name ?? 'KiCad Default', false],
    // `AddNewColorSettings( themeName )` writes `<themeName>.json` into the
    // colours directory and `SetReadOnly( false )` on it, so a theme the user
    // made is in the list beside the rest and carries no "(read-only)".
    ...Object.entries(userThemes).map(([id, t]): [string, string, boolean] => [id, t.name, false]),
  ];

  // `SETTINGS_MANAGER::loadAllColorSettings`' last pass
  // (`settings_manager.cpp:452-475`):
  //
  //     // Built-ins own their names, so disambiguate any colliding user theme
  //     // by appending its filename.
  //     settings->SetName( wxString::Format( wxS( "%s (%s)" ), settings->GetName(),
  //                                          wxFileName( settings->GetFilename() ).GetName() ) );
  //
  // which is why a real KiCad lists "KiCad Default (user)" and not "User".
  // Only the two BUILT-INS are exempt; a PCM theme that happens to be called
  // "KiCad Classic" gets its own filename appended the same way.
  const builtinNames = new Set(Object.values(BUILTIN_THEMES).map((t) => t.name));
  for (const row of raw) {
    const [id, n] = row;
    if (id in BUILTIN_THEMES) continue;
    if (builtinNames.has(n)) row[1] = `${n} (${id})`;
  }
  raw.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const out = raw.map(([id, n, readOnly]): [string, string] => [id, name(n, readOnly)]);
  // Appended AFTER the sort, because `createThemeList` appends them after its
  // loop over the already-sorted list.
  if (allowNew) out.push([THEME_SEPARATOR, THEME_SEPARATOR], [NEW_THEME, NEW_THEME]);
  return out;
}

export function ColorThemeChoice({
  label,
  value,
  onChange,
  markReadOnly,
  userThemes,
  onNewTheme,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  /** See `colorThemeOptions`: only `PANEL_COLOR_SETTINGS` names them that way. */
  markReadOnly?: boolean;
  userThemes?: Readonly<Record<string, { name: string }>>;
  /** Given, the list ends in `---` and `New Theme...`. */
  onNewTheme?: () => void;
}): JSX.Element {
  usePcmVersion();
  return (
    <Sel
      label={label}
      value={value}
      options={colorThemeOptions(
        pcm.installedThemes(),
        markReadOnly,
        userThemes ?? {},
        onNewTheme !== undefined,
      )}
      onChange={(id) => {
        /*
         * `OnThemeChanged` (`panel_color_settings.cpp:122-137`) reads the two
         * trailing rows by INDEX: the separator puts the selection back —
         *
         *     m_cbTheme->SetStringSelection( GetSettingsDropdownName( m_currentSettings ) );
         *     return;
         *
         * — and the last row runs New Theme instead of selecting anything.
         */
        if (id === THEME_SEPARATOR) return;
        if (id === NEW_THEME) {
          onNewTheme?.();
          return;
        }
        onChange(id);
      }}
    />
  );
}
