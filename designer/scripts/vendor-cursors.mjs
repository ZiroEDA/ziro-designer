// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Vendor KiCad's cursor art, verbatim, as PNGs.
 *
 * KiCad's mouse cursors are XPM bitmaps under
 * `resources/bitmaps_png/cursors/`, registered in `common/gal/cursors.cpp`
 * together with their hotspots. An XPM is a bitmap, so there is no path to
 * trace and no reason to redraw one: the pixels convert exactly. This script
 * reads the XPMs from the pinned reference tree and writes byte-faithful PNGs
 * into `src/assets/cursors/`, which `ui/kicursors.ts` then globs.
 *
 *   node designer/scripts/vendor-cursors.mjs [path-to-kicad-source]
 *
 * Re-run it rather than hand-editing the PNGs; that is the whole point of
 * keeping it. Deflate is stored-block only, so this needs no dependencies.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KICAD = process.argv[2] ?? '/home/akshay/kicad-reference';
const SRC = join(KICAD, 'resources/bitmaps_png/cursors');
const OUT = join(HERE, '../src/assets/cursors');

/**
 * The cursors ZiroEDA uses, by their `common/gal/cursors.cpp` file name.
 *
 * MOVING takes the `#else` (non-Windows) branch of the `#ifdef __WINDOWS__` in
 * that table — the `*_black` variant — because that is the branch a Linux
 * KiCad compiles, and the browser is not Windows-themed.
 *
 * Not vendored yet, because nothing reads them: PLACE (`cursor-place-black`),
 * SELECT_WINDOW and SELECT_LASSO. KiCad shows the last two during a
 * box/lasso drag (`pl_selection_tool.cpp:361-362`); ours tracks that drag in a
 * ref and never re-renders on it, so wiring them is a change to the canvas's
 * state, not to this list. Add the names here when that happens.
 */
const WANTED = [
  'cursor-pencil',
  'cursor-pencil64',
  'cursor-eraser',
  'cursor-eraser64',
  'cursor-text',
  'cursor-text64',
  'cursor-select-m-black',
  'cursor-select-m-black64',
  'cursor-zoom-in',
  'cursor-zoom-in64',
];

/** Named XPM colours that appear in these files alongside the #RRGGBB ones. */
const NAMED = { none: null, black: [0, 0, 0], white: [255, 255, 255] };

/** Parse an XPM into { width, height, rgba } — no palette guessing. */
function parseXpm(text) {
  const rows = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const [w, h, ncolors, cpp] = rows[0].trim().split(/\s+/).map(Number);
  const palette = new Map();
  for (let i = 1; i <= ncolors; i++) {
    const line = rows[i];
    const key = line.slice(0, cpp);
    const spec = line.slice(cpp).trim();
    const m = /c\s+(\S+)/i.exec(spec);
    if (!m) throw new Error(`no colour key in ${JSON.stringify(line)}`);
    const value = m[1];
    if (value.startsWith('#')) {
      const hex = value.slice(1);
      palette.set(key, [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ]);
    } else {
      const named = NAMED[value.toLowerCase()];
      if (named === undefined) throw new Error(`unknown colour name ${value}`);
      palette.set(key, named);
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const line = rows[1 + ncolors + y];
    for (let x = 0; x < w; x++) {
      const key = line.slice(x * cpp, x * cpp + cpp);
      const c = palette.get(key);
      const o = (y * w + x) * 4;
      if (c) {
        rgba[o] = c[0];
        rgba[o + 1] = c[1];
        rgba[o + 2] = c[2];
        rgba[o + 3] = 255;
      }
    }
  }
  return { width: w, height: h, rgba };
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Truecolour-with-alpha PNG, filter 0 on every row. */
function png({ width, height, rgba }) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const name of WANTED) {
  const image = parseXpm(readFileSync(join(SRC, `${name}.xpm`), 'utf8'));
  writeFileSync(join(OUT, `${name}.png`), png(image));
  console.log(`${name}.png  ${image.width}x${image.height}`);
}
