// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The colour themes the KiCad Plugin and Content Manager offers, bundled.
 *
 * KiCad's own repository carries exactly one family of colour-theme packages:
 * Thomas Pointhuber's `kicad-color-schemes`
 * (https://github.com/pointhi/kicad-color-schemes, CC0-1.0). The seven files
 * under `designer/src/assets/color_schemes/` are that repository's `packages.json` entries, taken
 * verbatim at commit `68ea0402` -- each package's `metadata.json` and the one
 * theme file its zip carries under `colors/`. Nothing here is edited: a theme
 * is data KiCad's ecosystem defines, and the point of shipping it is that
 * "Nord" on our canvas is the same 37 schematic and 52 board colours it is on
 * KiCad's.
 *
 * Which is also why the previous set went. It had a "Nord" whose sheet was
 * dark; the real one's is `rgb(236, 239, 244)`. Colours we invented under a
 * palette's name are a drift the central-value rule exists to catch.
 *
 * The files are version-3 themes; `colorThemeFromFile` migrates them to 5 the
 * way `COLOR_SETTINGS` does on load, so `page_limits` takes the grid colour.
 *
 * To refresh: fetch `packages.json` from that repository, unzip each
 * `download_url`, and copy `metadata.json` and `colors/<name>.json` over the
 * pair here. A new theme is one more row in the table below.
 */

import { normalizePackage } from './package_schema.js';
import type { RepoPackage } from './types.js';

import blackWhite from '../assets/color_schemes/black-white.json?raw';
import blackWhiteMeta from '../assets/color_schemes/black-white.metadata.json?raw';
import eagleDark from '../assets/color_schemes/eagle-dark.json?raw';
import eagleDarkMeta from '../assets/color_schemes/eagle-dark.metadata.json?raw';
import nord from '../assets/color_schemes/nord.json?raw';
import nordMeta from '../assets/color_schemes/nord.metadata.json?raw';
import solarizedDark from '../assets/color_schemes/solarized-dark.json?raw';
import solarizedDarkMeta from '../assets/color_schemes/solarized-dark.metadata.json?raw';
import solarizedLight from '../assets/color_schemes/solarized-light.json?raw';
import solarizedLightMeta from '../assets/color_schemes/solarized-light.metadata.json?raw';
import wdark from '../assets/color_schemes/wdark.json?raw';
import wdarkMeta from '../assets/color_schemes/wdark.metadata.json?raw';
import wlight from '../assets/color_schemes/wlight.json?raw';
import wlightMeta from '../assets/color_schemes/wlight.metadata.json?raw';

/** `[metadata.json, colors/<name>.json]`, in `packages.json`'s order. */
const FILES: readonly (readonly [meta: string, theme: string])[] = [
  [blackWhiteMeta, blackWhite],
  [eagleDarkMeta, eagleDark],
  [nordMeta, nord],
  [solarizedDarkMeta, solarizedDark],
  [solarizedLightMeta, solarizedLight],
  [wdarkMeta, wdark],
  [wlightMeta, wlight],
];

/**
 * The seven packages, read through the same `normalizePackage` a fetched
 * repository goes through, with the theme file inline as `theme` -- which is
 * where a package's payload lives in this app's repository model, the zip
 * being the part of the PCM a browser has no use for.
 */
export const KICAD_COLOR_SCHEMES: readonly RepoPackage[] = FILES.map(([meta, theme]) =>
  normalizePackage({
    ...(JSON.parse(meta) as Record<string, unknown>),
    theme: JSON.parse(theme) as unknown,
  }),
);
