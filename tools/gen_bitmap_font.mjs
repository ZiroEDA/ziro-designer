// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Regenerate the bitmap-font atlas from a KiCad checkout.
 *
 * KiCad's OpenGL GAL draws pad numbers, pad/via net names and track net names
 * with `BitmapText`, which samples a multi-channel signed distance field baked
 * by msdf-atlasgen into two generated C files:
 *
 *   common/gal/opengl/bitmap_font_img.c   1024 x 1107 RGB, ~3.4 MB raw
 *   common/gal/opengl/bitmap_font_desc.c  ~1100 glyphs, spans + metrics
 *
 * Shipping all of it to a browser is not on, and almost none of it is reachable
 * from a net name, so this repacks the glyphs we keep into the smallest atlas
 * that holds them. The *pixels* are copied verbatim — a glyph's texels and its
 * metrics are untouched, only its address in the sheet changes — so a repacked
 * glyph rasterizes to exactly what pcbnew draws.
 *
 * Usage:
 *   node tools/gen_bitmap_font.mjs [path-to-kicad-source]
 *
 * Writes designer/src/render/gl/bitmap_font.ts (metrics) and
 * designer/src/render/gl/bitmap_font.png (the sheet — in src rather than
 * public, so the bundler fingerprints it and it resolves under any base path).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const KICAD = resolve(process.argv[2] ?? '/home/akshay/kicad-reference');
const DESC = join(KICAD, 'common/gal/opengl/bitmap_font_desc.c');
const IMG = join(KICAD, 'common/gal/opengl/bitmap_font_img.c');

/**
 * Codepoints we keep. KiCad's own first span is 33..126 — printable ASCII, and
 * the whole of what a net name, a pad number or a via layer pair can be spelled
 * with in practice. Anything outside it falls back to '?', which is what
 * `OPENGL_GAL::drawBitmapChar` does for a glyph the atlas has no entry for.
 */
const FIRST = 33;
const LAST = 126;

const num = (s) => Number(s.trim().replace(/f$/, ''));

function parseDesc() {
  const src = readFileSync(DESC, 'utf8');

  const info = /FONT_INFO_TYPE font_information = \{([^}]*)\}/.exec(src);
  const [smooth, minY, maxY] = info[1].split(',').map(num);

  const spanBlock = /FONT_SPAN_TYPE \w+\[\] = \{([\s\S]*?)\n\};/.exec(src)[1];
  const spans = [...spanBlock.matchAll(/\{([^}]*)\}/g)].map((m) => m[1].split(',').map(num));

  const glyphBlock = /FONT_GLYPH_TYPE \w+\[\] = \{([\s\S]*?)\n\};/.exec(src)[1];
  const glyphs = [...glyphBlock.matchAll(/\{([^}]*)\}/g)].map((m) => {
    const p = m[1].split(',').map(num);
    return {
      x: p[0],
      y: p[1],
      w: p[2],
      h: p[3],
      minx: p[4],
      maxx: p[5],
      miny: p[6],
      maxy: p[7],
      adv: p[8],
    };
  });

  // The spans map a codepoint to an index in the flat glyph array: within a
  // span, index = cumulative + (cp - start).
  const lookup = (cp) => {
    for (const [start, end, cumulative] of spans)
      if (cp >= start && cp < end) return glyphs[cumulative + (cp - start)];
    return undefined;
  };
  return { smooth, minY, maxY, lookup, count: glyphs.length };
}

/** The pixel array is ~10 MB of decimal text; scan it rather than split it. */
function parseImage() {
  const src = readFileSync(IMG, 'utf8');
  const head = /FONT_IMAGE_TYPE \w+ = \{([^{]*)\{/.exec(src);
  const [width, height, charBorder, spacing] = head[1].split(',').map(num);

  const start = src.indexOf('{', head.index + head[0].length - 1) + 1;
  const px = new Uint8Array(width * height * 3);
  let n = 0;
  let acc = 0;
  let inNumber = false;
  for (let i = start; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      acc = acc * 10 + (c - 48);
      inNumber = true;
    } else if (inNumber) {
      px[n++] = acc;
      acc = 0;
      inNumber = false;
      if (n === px.length) break;
    }
  }
  if (n !== px.length) throw new Error(`read ${n} of ${px.length} texels`);
  return { width, height, charBorder, spacing, px };
}

/** Shelf-pack the kept glyphs into a power-of-two-wide sheet. */
function pack(boxes, width) {
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const b of boxes) {
    if (x + b.w > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    b.px = x;
    b.py = y;
    x += b.w;
    shelf = Math.max(shelf, b.h);
  }
  return y + shelf;
}

/** Minimal PNG writer: 8-bit RGB, one filter-0 scanline per row. */
function png(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let r = 0; r < height; r++) {
    raw[r * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + r * width * 3, width * 3).copy(
      raw,
      r * (width * 3 + 1) + 1,
    );
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const desc = parseDesc();
const img = parseImage();
console.log(`atlas ${img.width}x${img.height}, ${desc.count} glyphs, smooth=${desc.smooth}`);

const kept = [];
for (let cp = FIRST; cp <= LAST; cp++) {
  const g = desc.lookup(cp);
  if (!g) throw new Error(`no glyph for U+${cp.toString(16)}`);
  kept.push({ cp, ...g });
}
// Tallest first, so the shelves stay tight.
const order = [...kept].sort((a, b) => b.h - a.h);
const WIDTH = 512;
const height = pack(order, WIDTH);
console.log(`packed ${kept.length} glyphs into ${WIDTH}x${height}`);

const out = new Uint8Array(WIDTH * height * 3);
for (const g of order) {
  for (let r = 0; r < g.h; r++) {
    const src = ((g.y + r) * img.width + g.x) * 3;
    out.set(img.px.subarray(src, src + g.w * 3), ((g.py + r) * WIDTH + g.px) * 3);
  }
}

const PNG = join(HERE, '..', 'designer/src/render/gl/bitmap_font.png');
const bytes = png(WIDTH, height, out);
writeFileSync(PNG, bytes);
console.log(`wrote ${PNG} (${(bytes.length / 1024).toFixed(1)} kB)`);

// One flat table, five numbers of geometry and four of metrics per glyph, in
// codepoint order from FIRST — the lookup is then a subtraction.
const flat = [];
for (const g of kept) flat.push(g.px, g.py, g.w, g.h, g.minx, g.miny, g.maxy, g.adv);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, ''));

const ts = `// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
// The font itself is Ubuntu, under the Ubuntu Font Licence 1.0.
//
// GENERATED by tools/gen_bitmap_font.mjs from KiCad's bitmap_font_desc.c and
// bitmap_font_img.c. Do not edit; re-run the generator instead.
//
// KiCad's OpenGL GAL draws pad numbers and net names from an MSDF atlas rather
// than from the stroke font, which is why those labels do not thicken with the
// pen width the painter sets. These are that atlas's metrics, for the printable
// ASCII range, repacked into bitmap_font.png beside this file.

/** \`font_information\` from bitmap_font_desc.c. */
export const FONT_SMOOTH_PIXELS = ${desc.smooth};
export const FONT_MIN_Y = ${desc.minY};
export const FONT_MAX_Y = ${desc.maxY};

/** The repacked sheet, alongside this file. */
export const ATLAS_WIDTH = ${WIDTH};
export const ATLAS_HEIGHT = ${height};

/** First and last codepoint in {@link GLYPHS}; anything else renders as '?'. */
export const FIRST_CODEPOINT = ${FIRST};
export const LAST_CODEPOINT = ${LAST};

/** Fields per glyph in {@link GLYPHS}. */
export const GLYPH_STRIDE = 8;

/**
 * atlas_x, atlas_y, atlas_w, atlas_h, minx, miny, maxy, advance — the subset of
 * \`FONT_GLYPH_TYPE\` that \`drawBitmapChar\` and \`computeBitmapTextSize\` read.
 * Indexed by (codepoint - FIRST_CODEPOINT) * GLYPH_STRIDE.
 */
export const GLYPHS = new Float32Array([
  ${flat
    .map(fmt)
    .join(', ')
    .replace(/(.{1,92}) /g, '$1\n  ')}
]);
`;
const TS = join(HERE, '..', 'designer/src/render/gl/bitmap_font.ts');
writeFileSync(TS, ts);
console.log(`wrote ${TS} (${kept.length} glyphs)`);
