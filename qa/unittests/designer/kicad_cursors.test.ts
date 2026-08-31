// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The canvas cursors are KiCad's art, at KiCad's hotspots.
 *
 * `common/gal/cursors.cpp` is one table: a `KICURSOR`, the XPM file for it at
 * 32x32 and at 64x64, and a hotspot for each. Everything KiCad points with
 * comes from there. We had drawn our own pencil and eraser as inline SVG on
 * the reasoning that an XPM "gives no path" — true, and no obstacle: an XPM is
 * a bitmap and converts to a PNG exactly, which is what
 * `designer/scripts/vendor-cursors.mjs` does.
 *
 * The hotspots below are quoted from that table. They are the load-bearing
 * half: art with the wrong hotspot puts the click somewhere other than where
 * the pencil tip is, and no screenshot comparison would show it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const SRC = readFileSync(path('../../../designer/src/ui/kicursors.ts'), 'utf8');

/**
 * `CURSOR_STORE`, quoted from `common/gal/cursors.cpp`. [data]
 *
 * MOVING is the `#else` half of that entry's `#ifdef __WINDOWS__`, which is
 * what a Linux KiCad compiles.
 */
const CURSORS_CPP: Record<string, { file: string; x: number; y: number }> = {
  PENCIL: { file: 'cursor-pencil', x: 4, y: 27 },
  REMOVE: { file: 'cursor-eraser', x: 4, y: 4 },
  TEXT: { file: 'cursor-text', x: 7, y: 7 },
  MOVING: { file: 'cursor-select-m-black', x: 1, y: 1 },
  ZOOM_IN: { file: 'cursor-zoom-in', x: 7, y: 7 },
  // `{ cursor_measure_xpm, { 4, 4 } }` (cursors.cpp:199-205) — the Measure
  // Tool's, which arrived with the PCB ruler. The 64x64 entry's { 8, 8 } is
  // the same hotspot doubled, so only the 32x32 pair is stored, as above.
  MEASURE: { file: 'cursor-measure', x: 4, y: 4 },
};

/** What `kicursors.ts` declares, parsed out of its STORE literal. */
const declared = (() => {
  const at = SRC.indexOf('const STORE = {');
  expect(at, 'kicursors.ts has no STORE').toBeGreaterThanOrEqual(0);
  const body = SRC.slice(at, SRC.indexOf('} as const', at));
  const out: Record<string, { file: string; x: number; y: number }> = {};
  for (const m of body.matchAll(
    /(\w+):\s*\{\s*file:\s*'([^']+)',\s*x:\s*(-?\d+),\s*y:\s*(-?\d+)/g,
  )) {
    out[m[1]!] = { file: m[2]!, x: Number(m[3]), y: Number(m[4]) };
  }
  return out;
})();

describe('every cursor we point with', () => {
  // One `it` per cursor, not one loop assertion over the table: a per-cursor
  // rule checked once per file passes as soon as any single entry is right.
  for (const [name, want] of Object.entries(CURSORS_CPP)) {
    it(`${name} takes ${want.file} at hotspot ${want.x},${want.y}`, () => {
      expect(declared[name]).toEqual(want);
    });

    it(`${name}'s art is vendored at both sizes`, () => {
      const one = path(`../../../designer/src/assets/cursors/${want.file}.png`);
      const two = path(`../../../designer/src/assets/cursors/${want.file}64.png`);
      expect(existsSync(one), `${want.file}.png not vendored`).toBe(true);
      expect(existsSync(two), `${want.file}64.png not vendored`).toBe(true);
      // A PNG, not an SVG someone drew: the first eight bytes are the signature.
      expect([...readFileSync(one).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    });
  }

  it('declares nothing KiCad does not have', () => {
    expect(Object.keys(declared).sort()).toEqual(Object.keys(CURSORS_CPP).sort());
  });
});

describe('the hotspot the browser is given', () => {
  it('is the 32x32 one even when image-set serves the 64x64 file', () => {
    // A CSS hotspot is in CSS pixels, and image-set lays the 2x image out at
    // the 1x image's CSS size — so the 64x64 art must NOT bring its doubled
    // hotspot with it. Halving KiCad's 64x64 values gives the 32x32 ones back,
    // which is why only one pair is stored.
    expect(SRC).not.toMatch(/x:\s*8,\s*y:\s*54/); // cursor-pencil64's { 8, 54 }
    expect(SRC).toMatch(/image-set\(url\(\$\{one\}\) 1x, url\(\$\{two\}\) 2x\) \$\{hot\}/);
  });

  it('keeps a stock fallback after the comma on every entry', () => {
    // A `cursor` value whose image cannot load falls through to the next in
    // the list; an entry with no fallback would leave the canvas with the
    // default arrow while a tool is active.
    const entries = [...SRC.matchAll(/fallback:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(entries).toHaveLength(Object.keys(CURSORS_CPP).length);
    for (const f of entries) expect(f).not.toBe('');
  });
});
