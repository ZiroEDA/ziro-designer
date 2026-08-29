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
 * `GetColorSettingsList()`: the built-in themes, then whatever is installed,
 * then ours — the "User" row, which is where a per-layer override lands.
 */
export function colorThemeOptions(
  installed: readonly { id: string; name: string }[],
): [string, string][] {
  return [
    ...Object.entries(BUILTIN_THEMES).map(([id, t]): [string, string] => [id, t.name]),
    ...installed.map((t): [string, string] => [t.id, t.name]),
    ['user', 'User'],
  ];
}

export function ColorThemeChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}): JSX.Element {
  usePcmVersion();
  return (
    <Sel
      label={label}
      value={value}
      options={colorThemeOptions(pcm.installedThemes())}
      onChange={onChange}
    />
  );
}
