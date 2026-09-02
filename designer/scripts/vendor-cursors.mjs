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
 * This is `cursors_defs` (`common/gal/cursors.cpp:114-322`) minus the entries
 * whose tools do not exist in this port. Upstream has ONE table and one
 * `CURSOR_STORE` in front of every canvas, which is why a pencil in
 * pl_editor, in eeschema and in pcbnew is the same pencil; the list here is
 * the vendoring half of that single table and `ui/kicursors.ts` is the rest.
 *
 * Both variants of every entry: a 32x32 and the 64x64 KiCad swaps in on a
 * HiDPI display, which is what `image-set`'s `2x` descriptor asks the browser
 * for.
 *
 * MOVING and PLACE take the `#else` (non-Windows) branch of the
 * `#ifdef __WINDOWS__` in that table -- the `*_black` variants -- because that
 * is the branch a Linux KiCad compiles, and Linux is the parity target.
 *
 * Not vendored, because no tool in this port asks for them: VOLTAGE_PROBE,
 * CURRENT_PROBE and TUNE (the simulator's), WARNING, ADD, SUBTRACT, XOR
 * (pcbnew's zone boolean pickers) and ZOOM_OUT. Add the pair here when the
 * tool arrives -- not one of the pair.
 */
const WANTED = [
  // KICURSOR::PENCIL
  'cursor-pencil',
  'cursor-pencil64',
  // KICURSOR::REMOVE
  'cursor-eraser',
  'cursor-eraser64',
  // KICURSOR::TEXT
  'cursor-text',
  'cursor-text64',
  // KICURSOR::MOVING
  'cursor-select-m-black',
  'cursor-select-m-black64',
  // KICURSOR::PLACE
  'cursor-place-black',
  'cursor-place-black64',
  // KICURSOR::COMPONENT
  'cursor-component',
  'cursor-component64',
  // KICURSOR::MEASURE
  'cursor-measure',
  'cursor-measure64',
  // KICURSOR::ZOOM_IN
  'cursor-zoom-in',
  'cursor-zoom-in64',
  // KICURSOR::LABEL_NET
  'cursor-label-net',
  'cursor-label-net64',
  // KICURSOR::LABEL_GLOBAL
  'cursor-label-global',
  'cursor-label-global64',
  // KICURSOR::LABEL_HIER
  'cursor-label-hier',
  'cursor-label-hier64',
  // KICURSOR::LINE_WIRE
  'cursor-line-wire',
  'cursor-line-wire64',
  // KICURSOR::LINE_BUS
  'cursor-line-bus',
  'cursor-line-bus64',
  // KICURSOR::LINE_GRAPHIC
  'cursor-line-graphic',
  'cursor-line-graphic64',
  // KICURSOR::SELECT_LASSO
  'cursor-select-lasso',
  'cursor-select-lasso64',
  // KICURSOR::SELECT_WINDOW
  'cursor-select-window',
  'cursor-select-window64',
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
