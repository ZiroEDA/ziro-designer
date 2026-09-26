// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/gal/opengl/gl_resources.h` + `.cpp`: `KIGFX::BUILTIN_FONT`, the
 * bitmap font's lookup over the generated tables (bitmap_font_desc.ts).
 */

import {
  type FONT_GLYPH_TYPE,
  font_codepoint_infos,
  font_codepoint_spans,
} from './bitmap_font_desc.js';

export { font_image, font_information } from './bitmap_font_desc.js';
export type { FONT_GLYPH_TYPE, FONT_INFO_TYPE, FONT_SPAN_TYPE } from './bitmap_font_desc.js';

/** The glyph rows decoded once, on first use. */
let g_glyphs: FONT_GLYPH_TYPE[] | null = null;

function glyphs(): FONT_GLYPH_TYPE[] {
  if (!g_glyphs) {
    g_glyphs = font_codepoint_infos.map((g) => ({
      atlas_x: g[0]!,
      atlas_y: g[1]!,
      atlas_w: g[2]!,
      atlas_h: g[3]!,
      minx: g[4]!,
      maxx: g[5]!,
      miny: g[6]!,
      maxy: g[7]!,
      advance: g[8]!,
    }));
  }
  return g_glyphs;
}

/** `LookupGlyph`: the span holding the codepoint (BITMAP_FONT_USE_SPANS), or null. */
export function LookupGlyph(aCodepoint: number): FONT_GLYPH_TYPE | null {
  // std::upper_bound( spans, end, aCodepoint, []( cp, span ) { return cp < span.end; } )
  let lo = 0;
  let hi = font_codepoint_spans.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;

    if (aCodepoint < font_codepoint_spans[mid]![1]) hi = mid;
    else lo = mid + 1;
  }

  const ptr = lo;

  if (ptr !== font_codepoint_spans.length && font_codepoint_spans[ptr]![0] <= aCodepoint) {
    const index = aCodepoint - font_codepoint_spans[ptr]![0] + font_codepoint_spans[ptr]![2];
    return glyphs()[index]!;
  }

  return null;
}
