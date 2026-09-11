// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SETTINGS_MANAGER::GetColorSettingsList()`, minus the two built-ins and the
 * writable user theme, which the chooser adds itself (`ColorThemeChoice.tsx`).
 *
 * `loadAllColorSettings` (`settings_manager.cpp:410-450`) reads three
 * directories, and the first two with a `readOnlyLoader` that calls
 * `SetReadOnly( true )` on every file it finds:
 *
 *     wxDir system_colors_dir( PATHS::GetStockDataPath( false ) + "/colors" );
 *     wxDir third_party_colors_dir( <3rdparty>/colors );     // what the PCM installs
 *     wxDir colors_dir( GetColorSettingsPath() );            // the user's own
 *
 * The STOCK directory is the one this module fills. KiCad's own packaging
 * ships nothing in it -- `/usr/share/kicad/colors` does not exist on this
 * machine -- but the loader is there, and it is the only shelf a theme can sit
 * on without the Plugin and Content Manager, which this app does not launch.
 * The seven files under `designer/src/assets/color_schemes/` are the colour
 * themes KiCad's repository offers, Thomas Pointhuber's `kicad-color-schemes`
 * (https://github.com/pointhi/kicad-color-schemes, CC0-1.0), each the one
 * theme file its PCM zip carries under `colors/`, byte for byte at commit
 * `68ea0402`. Nothing here is edited: "Nord" on our canvas is the same 37
 * schematic and 52 board colours it is on KiCad's, which is the whole reason
 * for shipping the files rather than a palette written from the name. (The
 * real Nord sheet is light, `rgb(236, 239, 244)`; the theme this replaced
 * said dark.)
 *
 * They are version-3 files; `colorThemeFromFile` migrates them to 5 on read
 * the way `COLOR_SETTINGS` does on load, so `page_limits` takes each theme's
 * grid colour.
 *
 * To refresh: fetch that repository's `packages.json`, unzip each
 * `download_url`, copy `colors/<stem>.json` over the file here. A new theme is
 * one more row in `FILES`.
 */

import { type ColorThemeContents, colorThemeFromFile } from '@ziroeda/common';
import { pcm } from '../pcm/pcmStore.js';

import blackWhite from '../assets/color_schemes/black-white.json?raw';
import eagleDark from '../assets/color_schemes/eagle-dark.json?raw';
import nord from '../assets/color_schemes/nord.json?raw';
import solarizedDark from '../assets/color_schemes/solarized-dark.json?raw';
import solarizedLight from '../assets/color_schemes/solarized-light.json?raw';
import wdark from '../assets/color_schemes/wdark.json?raw';
import wlight from '../assets/color_schemes/wlight.json?raw';

/** One `COLOR_SETTINGS` the manager holds that is not a built-in. */
export interface ColorSettingsEntry {
  /** `COLOR_SETTINGS::GetFilename()`, the id `appearance.color_theme` stores. */
  id: string;
  /** `COLOR_SETTINGS::GetName()`: the file's `meta.name`. */
  name: string;
  theme: ColorThemeContents;
}

/**
 * The stock directory's `wxDir::Traverse` order is the filesystem's, which
 * `GetColorSettingsList` then sorts by name -- so the order here is only the
 * repository's `packages.json` order and decides nothing.
 */
const FILES: readonly (readonly [stem: string, text: string])[] = [
  ['black-white', blackWhite],
  ['eagle-dark', eagleDark],
  ['nord', nord],
  ['solarized-dark', solarizedDark],
  ['solarized-light', solarizedLight],
  ['wdark', wdark],
  ['wlight', wlight],
];

/**
 * A system theme's id. Upstream it is the file's absolute path -- the
 * `readOnlyLoader` registers `aFilename.GetFullPath()`, and that is what
 * `eeschema.json` ends up storing -- which no other install could read either.
 * Ours is the stem under a namespace, beside `pcm:` for a third-party one,
 * so a user theme "New Theme..." made under the same stem cannot shadow it.
 */
export const stockThemeId = (stem: string): string => `stock:${stem}`;

/** The system colours directory, read. */
export const STOCK_COLOR_THEMES: readonly ColorSettingsEntry[] = FILES.map(([stem, text]) => {
  const theme = colorThemeFromFile(JSON.parse(text));
  if (!theme) throw new Error(`assets/color_schemes/${stem}.json is not a colour theme`);
  return { id: stockThemeId(stem), name: theme.name, theme };
});

/**
 * Every theme with a file: the stock directory, then what the PCM installed.
 * Both read-only. The chooser sorts, so this order decides nothing.
 */
export function colorSettingsList(): readonly ColorSettingsEntry[] {
  return [...STOCK_COLOR_THEMES, ...pcm.installedThemes()];
}

/** `SETTINGS_MANAGER::GetColorSettings( aName )`'s lookup, for a theme with a file. */
export function colorSettingsById(id: string): ColorThemeContents | undefined {
  return colorSettingsList().find((t) => t.id === id)?.theme;
}
