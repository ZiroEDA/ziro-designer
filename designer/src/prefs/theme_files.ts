// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What `SETTINGS_MANAGER::GetColorSettingsPath()` holds, as this app holds it.
 *
 * "Open Theme Folder" is `PANEL_COLOR_SETTINGS`' button, so every Colors page
 * offers it and every one of them opens the SAME folder — a theme file is one
 * `COLOR_SETTINGS` covering every app, not a per-editor thing. That is the
 * whole reason this is here and not on a page: the footprint editor's page
 * would otherwise write a `user.json` with no `schematic` section and the
 * schematic page one with no `board` section, and each would silently reset the
 * other editor's colours the next time KiCad read it.
 *
 * The folder never holds the two built-ins: they are compiled in and have no
 * file (`COLOR_BUILTIN_DEFAULT`, `color_settings.cpp:34-35`).
 */
import { pcm } from '../pcm/pcmStore.js';
import { KICAD_DEFAULT, type Theme } from '../editors/schematic/theme.js';
import { themeByLayer } from '../editors/schematic/prefs/schColorLayers.js';
import type { ThemeFile } from '../dialogs/prefs/dialog_theme_folder.js';
import {
  BOARD_COLOR_KEYS,
  type ThemeLayerId,
} from '@ziroeda/common/src/settings/color_theme_file.js';

/**
 * The `board` section of the writable theme.
 *
 * `colors/user.json` is stored flat and namespaced — `board.copper.f`,
 * `schematic.wire` — which is exactly how `COLOR_SETTINGS` names its params, so
 * the board half is a lookup and not a translation. A key nobody has changed is
 * absent, and `colorThemeToFile` fills it from `s_defaultTheme`, which is what
 * `COLOR_MAP_PARAM`'s default does.
 */
export function boardColorsFor(
  userColors: Readonly<Record<string, string>>,
): Partial<Record<ThemeLayerId, string>> {
  const out: Partial<Record<ThemeLayerId, string>> = {};
  for (const [key, layer] of BOARD_COLOR_KEYS) {
    const css = userColors[`board.${key}`];
    if (css !== undefined) out[layer] = css;
  }
  return out;
}

/**
 * The theme files the folder dialog offers, whichever Colors page opened it.
 *
 * `override` is `schematic.override_item_colors`, which lives in the FILE
 * (`color_settings.cpp:47-48`) and so belongs to the theme rather than to the
 * page that is showing it.
 */
export function themeFilesFor(
  userColors: Readonly<Record<string, string>>,
  override: boolean,
): readonly ThemeFile[] {
  return [
    {
      fileName: 'user.json',
      name: 'User',
      contents: {
        name: 'User',
        colors: themeByLayer({ ...KICAD_DEFAULT, ...userColors } as Theme),
        board: boardColorsFor(userColors),
        override,
      },
      writable: true,
    },
    // A theme the PCM installed lands in the third-party colours directory and
    // is read-only. Ours carry schematic colours alone, so no `board` section
    // is written for one — an empty section is not neutral, it would name every
    // board layer at its default.
    ...pcm.installedThemes().map(({ id, name, theme }) => ({
      fileName: `${id.replace(/^pcm:/, '')}.json`,
      name,
      contents: { name, colors: themeByLayer(theme), override: false },
      writable: false,
    })),
  ];
}
