// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every KiCad bitmap we ship comes from `sources/dark/`, byte for byte.
 *
 * KiCad keeps two of each — `resources/bitmaps_png/sources/light/` and
 * `.../dark/` — differing only in ink: `stroke_solid` fills `#545454` in the
 * light set and `#DED3DD` in the dark. It picks by theme, and our shell is the
 * dark one, which is why all 264 assets that were already here came from
 * `dark/`.
 *
 * I vendored the five stroke bitmaps from `light/` and they rendered as a faint
 * grey smudge on a dark dialog — the ink was for a white background. Nothing
 * caught it: an SVG that loads and paints *something* looks fine to every test
 * we have, and to a build.
 *
 * So this compares each vendored file against BOTH KiCad directories and
 * insists it matches the dark one. Copying from the wrong directory is then a
 * failure rather than a thing to notice in a screenshot.
 *
 * It skips silently when the reference tree is absent, so a checkout without
 * KiCad beside it still runs the suite.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDORED = fileURLToPath(new URL('../../../designer/src/assets/toolbar', import.meta.url));
const KICAD = '/home/akshay/kicad-reference/resources/bitmaps_png/sources';

const haveReference = existsSync(join(KICAD, 'dark'));
const files = readdirSync(VENDORED).filter((f) => f.endsWith('.svg'));

describe.skipIf(!haveReference)('the vendored KiCad bitmaps', () => {
  it('are not empty — the scan is really finding them', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  /**
   * The INK, not the bytes. Some assets here came from a different KiCad
   * revision and carry extra Inkscape namespace declarations, which is
   * cosmetic; the thing that actually breaks is the palette, because the light
   * set is drawn for a white background and we are dark. So this compares the
   * set of colours each file paints with.
   */
  const inks = (text: string): string[] =>
    // A SET: KiCad's own files spell the same colour in both cases within one
    // file, and how many times a colour appears is not the palette.
    [
      ...new Set(
        [...text.matchAll(/(?:fill|stroke):\s*(#[0-9a-fA-F]{3,6})/g)]
          .map((m) => (m[1] ?? '').toLowerCase())
          .filter((c) => c !== '#000' && c !== '#000000' && c !== '#fff' && c !== '#ffffff'),
      ),
    ].sort();

  it.each(files)('%s is the dark variant', (name) => {
    const dark = join(KICAD, 'dark', name);
    const light = join(KICAD, 'light', name);
    // A bitmap KiCad does not ship under this name is ours, and out of scope.
    if (!existsSync(dark) || !existsSync(light)) return;
    const ourInk = inks(readFileSync(join(VENDORED, name), 'utf8'));
    const darkInk = inks(readFileSync(dark, 'utf8'));
    const lightInk = inks(readFileSync(light, 'utf8'));
    // Where the two variants paint the same, there is nothing to get wrong.
    if (JSON.stringify(darkInk) === JSON.stringify(lightInk)) return;
    expect(
      ourInk,
      `${name} is painted in the LIGHT palette. Our shell is dark; copy from ` +
        `sources/dark/ — the two differ only in ink, and the light one reads as ` +
        `a grey smudge on a dark dialog.`,
    ).toStrictEqual(darkInk);
  });
});
