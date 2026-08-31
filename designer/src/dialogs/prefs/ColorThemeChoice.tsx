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
export function colorThemeOptions(
  installed: readonly { id: string; name: string }[],
  markReadOnly = false,
): [string, string][] {
  const name = (n: string, readOnly: boolean): string =>
    markReadOnly ? dropdownName(n, readOnly) : n;
  return [
    ...Object.entries(BUILTIN_THEMES).map(([id, t]): [string, string] => [id, name(t.name, true)]),
    // A PCM theme lands in the third-party colours directory, which
    // `registerColorSettings( …, true )` marks read-only.
    ...installed.map((t): [string, string] => [t.id, name(t.name, true)]),
    ['user', name('User', false)],
  ];
}

export function ColorThemeChoice({
  label,
  value,
  onChange,
  markReadOnly,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  /** See `colorThemeOptions`: only `PANEL_COLOR_SETTINGS` names them that way. */
  markReadOnly?: boolean;
}): JSX.Element {
  usePcmVersion();
  return (
    <Sel
      label={label}
      value={value}
      options={colorThemeOptions(pcm.installedThemes(), markReadOnly)}
      onChange={onChange}
    />
  );
}
