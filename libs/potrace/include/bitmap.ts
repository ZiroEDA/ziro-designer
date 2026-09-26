// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2001-2017 Peter Selinger. Ported by ZiroEDA and contributors.
/**
 * `thirdparty/potrace/include/bitmap.h`: making, copying and addressing a
 * `potrace_bitmap_t`.
 *
 * **One divergence of representation, none of behaviour.** potrace packs a
 * scanline into `potrace_word`s (`unsigned long`, 64 bits on the Linux build
 * KiCad 10.0.5 ships), MSB first, and `dy` counts words. Here `map` holds one
 * byte per pixel and `dy` is `w`. Every pixel-level macro (`BM_GET`, `BM_PUT`,
 * ...) reads and writes the same pixels. The word-level tricks in
 * `decompose.cpp` are ported as the pixel ranges they cover: `xor_to_ref`
 * inverts `[min(x, xa), max(x, xa))`, `clear_bm_with_bbox` clears the bbox's
 * word-aligned span, and `findnext` tests pixels where it tested words — which
 * finds the same first set pixel, since a zero word holds no set pixel. The
 * excess padding `bm_clearexcess` zeroes does not exist.
 */
import type { potrace_bitmap_t } from '../src/potracelib.js';

/** `BM_WORDBITS`: `8 * sizeof( unsigned long )` on LP64. [data] */
export const BM_WORDBITS = 64;

/** `bm_range( x, a )`. */
function bm_range(x: number, a: number): boolean {
  return x >= 0 && x < a;
}

/** `bm_safe( bm, x, y )`. */
export function bm_safe(bm: potrace_bitmap_t, x: number, y: number): boolean {
  return bm_range(x, bm.w) && bm_range(y, bm.h);
}

/** `BM_UGET( bm, x, y )`. */
export function BM_UGET(bm: potrace_bitmap_t, x: number, y: number): boolean {
  return bm.map[y * bm.dy + x] !== 0;
}

/** `BM_UPUT( bm, x, y, b )`. */
export function BM_UPUT(bm: potrace_bitmap_t, x: number, y: number, b: unknown): void {
  bm.map[y * bm.dy + x] = b ? 1 : 0;
}

/** `BM_UINV( bm, x, y )`. */
export function BM_UINV(bm: potrace_bitmap_t, x: number, y: number): void {
  bm.map[y * bm.dy + x] = bm.map[y * bm.dy + x]! ^ 1;
}

/** `BM_GET( bm, x, y )`: 0 outside the bitmap. */
export function BM_GET(bm: potrace_bitmap_t, x: number, y: number): boolean {
  return bm_safe(bm, x, y) ? BM_UGET(bm, x, y) : false;
}

/** `BM_PUT( bm, x, y, b )`: a no-op outside the bitmap. */
export function BM_PUT(bm: potrace_bitmap_t, x: number, y: number, b: unknown): void {
  if (bm_safe(bm, x, y)) BM_UPUT(bm, x, y, b);
}

/** `BM_SET( bm, x, y )`. */
export function BM_SET(bm: potrace_bitmap_t, x: number, y: number): void {
  BM_PUT(bm, x, y, 1);
}

/** `BM_CLR( bm, x, y )`. */
export function BM_CLR(bm: potrace_bitmap_t, x: number, y: number): void {
  BM_PUT(bm, x, y, 0);
}

/** `BM_INV( bm, x, y )`. */
export function BM_INV(bm: potrace_bitmap_t, x: number, y: number): void {
  if (bm_safe(bm, x, y)) BM_UINV(bm, x, y);
}

/**
 * `bm_new( w, h )`: a new all-clear bitmap. The C returns NULL (errno ENOMEM)
 * when `dy * h * sizeof( word )` overflows `ptrdiff_t`; a typed array that
 * large throws a `RangeError` instead, which is where this returns null.
 */
export function bm_new(w: number, h: number): potrace_bitmap_t | null {
  try {
    return { w, h, dy: w, map: new Uint8Array(Math.max(1, w * h)) };
  } catch {
    return null;
  }
}

/** `bm_dup( bm )`. */
export function bm_dup(bm: potrace_bitmap_t): potrace_bitmap_t | null {
  const bm1 = bm_new(bm.w, bm.h);

  if (!bm1) return null;

  bm1.map.set(bm.map.subarray(0, bm.w * bm.h));
  return bm1;
}

/** `bm_clear( bm, c )`: set every pixel to `c`. */
export function bm_clear(bm: potrace_bitmap_t, c: number): void {
  bm.map.fill(c ? 1 : 0, 0, bm.w * bm.h);
}

/** `bm_invert( bm )`. */
export function bm_invert(bm: potrace_bitmap_t): void {
  for (let i = 0; i < bm.w * bm.h; i++) bm.map[i] = bm.map[i]! ^ 1;
}

/** `bm_free( bm )`: the garbage collector's; kept so the call sites read as the C's. */
export function bm_free(_bm: potrace_bitmap_t | null): void {}
