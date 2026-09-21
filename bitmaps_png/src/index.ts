// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KiCad's `bitmaps_png/`: the artwork, and `BITMAP_STORE`'s job of turning a
 * name into something a widget can draw. KiCad compiles the SVGs into the
 * binary and hands out `wxBitmapBundle`s; here they are files under
 * `sources/<group>/` and the answer is a URL.
 *
 * `sources/toolbar/` is `bitmaps_png/sources/dark/` — the dark set only, since
 * dark is our identity. The other groups are KiCad's dialog artwork
 * (`calculator/`, `constraints/`, `teardrops/`, `tuning/`, `theme/`), the
 * cursor PNGs (`cursors/`), and ours (`launcher/`, `manager/`).
 */
const URLS = import.meta.glob('../sources/*/*.{svg,png}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export type BitmapGroup =
  | 'calculator'
  | 'constraints'
  | 'cursors'
  | 'launcher'
  | 'manager'
  | 'teardrops'
  | 'theme'
  | 'toolbar'
  | 'tuning';

/** The URL of `sources/<group>/<file>`, or undefined when no such bitmap exists. */
export function bitmapUrl(group: BitmapGroup, file: string): string | undefined {
  return URLS[`../sources/${group}/${file}`];
}

/** `bitmapUrl( group, name + '.svg' )`. */
export function svgUrl(group: BitmapGroup, name: string): string | undefined {
  return bitmapUrl(group, `${name}.svg`);
}

/** Every file name in a group, for the inventories that walk a set. */
export function bitmapNames(group: BitmapGroup): string[] {
  const prefix = `../sources/${group}/`;
  return Object.keys(URLS)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

export { default as kicadIconUrl } from '../sources/icon_kicad.png';
