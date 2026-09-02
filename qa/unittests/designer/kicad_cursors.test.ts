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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const SRC = readFileSync(path('../../../designer/src/ui/kicursors.ts'), 'utf8');

/**
 * `cursors_defs`, quoted from `common/gal/cursors.cpp:114-322`. [data]
 *
 * MOVING and PLACE are the `#else` half of their `#ifdef __WINDOWS__`, which
 * is what a Linux KiCad compiles.
 *
 * This is the WHOLE of what the app points with, in one table, because
 * upstream `CURSOR_STORE` is one table in front of every canvas. It used to
 * be six entries here and fifteen more in `editors/schematic/cursors_data.ts`,
 * hand-copied as XPM text; two tables is how ZOOM_IN came to carry hotspot
 * (7, 7) in this one and the correct (6, 6) in the other, with a test on each
 * agreeing with its own table.
 */
const CURSORS_CPP: Record<string, { file: string; x: number; y: number }> = {
  PENCIL: { file: 'cursor-pencil', x: 4, y: 27 },
  MOVING: { file: 'cursor-select-m-black', x: 1, y: 1 },
  REMOVE: { file: 'cursor-eraser', x: 4, y: 4 },
  TEXT: { file: 'cursor-text', x: 7, y: 7 },
  // `{ cursor_measure_xpm, { 4, 4 } }` (cursors.cpp:200-206) — the Measure
  // Tool's, which arrived with the PCB ruler. The 64x64 entry's { 8, 8 } is
  // the same hotspot doubled, so only the 32x32 pair is stored, as above.
  MEASURE: { file: 'cursor-measure', x: 4, y: 4 },
  // { 6, 6 }: the centre of the lens, not the tip of the handle.
  ZOOM_IN: { file: 'cursor-zoom-in', x: 6, y: 6 },
  LABEL_NET: { file: 'cursor-label-net', x: 7, y: 7 },
  LABEL_GLOBAL: { file: 'cursor-label-global', x: 7, y: 7 },
  LABEL_HIER: { file: 'cursor-label-hier', x: 7, y: 7 },
  COMPONENT: { file: 'cursor-component', x: 7, y: 7 },
  SELECT_LASSO: { file: 'cursor-select-lasso', x: 7, y: 7 },
  // The one entry whose hotspot is not on the diagonal.
  SELECT_WINDOW: { file: 'cursor-select-window', x: 7, y: 10 },
  LINE_WIRE: { file: 'cursor-line-wire', x: 5, y: 26 },
  LINE_BUS: { file: 'cursor-line-bus', x: 5, y: 26 },
  LINE_GRAPHIC: { file: 'cursor-line-graphic', x: 5, y: 26 },
  PLACE: { file: 'cursor-place-black', x: 1, y: 1 },
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

  it('every cursor value still ends in a keyword', () => {
    // A `cursor` value whose image cannot load falls through to the next in
    // the list, and a value with nothing after the comma is invalid CSS and is
    // dropped WHOLE. There is one keyword now rather than a field per entry:
    // upstream's only analogous branch answers `wxCURSOR_ARROW` (`GetCursor`,
    // `cursors.cpp:417-418`), so anything else here would be invented.
    expect(SRC).toMatch(/export const STOCK_CURSOR = 'default';/);
    for (const tail of ['${hot}, ${STOCK_CURSOR}`', '2x) ${hot}, ${STOCK_CURSOR}`']) {
      expect(SRC, tail).toContain(tail);
    }
    // …and no entry carries a keyword of its own any more.
    expect(SRC).not.toMatch(/fallback:/);
  });
});

/**
 * There is ONE cursor store, and every canvas points through it.
 *
 * Upstream this needs no test: `cursors_defs` is a file-static map,
 * `CURSOR_STORE::GetCursor` holds the only instance of it (`cursors.cpp:405`),
 * and `SetCurrentCursor( KICURSOR )` is the only call a tool can make. Ours
 * are React components that each set a CSS `cursor` string, so a second table
 * is one file away — and there WAS one, `editors/schematic/cursors_data.ts`,
 * for long enough that the same KiCad pencil shipped as a vendored PNG on one
 * canvas and a browser-rasterised data URI on another, with the Preferences
 * checkbox reaching only the first.
 *
 * Walked as text, the way `view_controls_coverage.test.ts` walks the wheel.
 */
describe('one CURSOR_STORE, like KiCad', () => {
  const SRCDIR = fileURLToPath(new URL('../../../designer/src', import.meta.url));

  /** Every file that sets a canvas cursor from KiCad art. */
  const CALLERS = [
    'editors/schematic/cursors.ts',
    'editors/schematic/components/SchematicCanvas.tsx',
    'editors/symbol/SymbolCanvas.tsx',
    'editors/footprint/FootprintCanvas.tsx',
    'editors/drawingsheet/DrawingSheetCanvas.tsx',
  ];

  it.each(CALLERS)('%s imports the store rather than declaring one', (rel) => {
    const src = readFileSync(join(SRCDIR, rel), 'utf8');
    expect(src).toMatch(/from '[./]+ui\/kicursors\.js'/);
  });

  it('the deleted second table has not come back', () => {
    expect(existsSync(join(SRCDIR, 'editors/schematic/cursors_data.ts'))).toBe(false);
  });

  it('nothing paints a cursor bitmap at run time any more', () => {
    // `cssCursor` built `url("data:image/png;base64,…")` off a <canvas>, which
    // is how the schematic's cursors escaped both the hotspot table and the
    // preference. An XPM converts to a PNG exactly; there is no reason to
    // rasterise one in a browser.
    for (const rel of CALLERS) {
      const src = readFileSync(join(SRCDIR, rel), 'utf8');
      expect(src, rel).not.toMatch(/toDataURL\(/);
    }
  });
});
