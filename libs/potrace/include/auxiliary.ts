// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2001-2017 Peter Selinger. Ported by ZiroEDA and contributors.
/**
 * `thirdparty/potrace/include/auxiliary.h`: the point types and the small
 * integer helpers every stage shares.
 *
 * The C helpers work on `int` / `long`, whose `/` and `%` truncate toward
 * zero. JavaScript's `/` does not truncate at all and `%` keeps the dividend's
 * sign, which is C's; so each division here is `Math.trunc` of the quotient,
 * and `mod` / `floordiv` are spelled exactly as the header spells them.
 */
import type { potrace_dpoint_t } from '../src/potracelib.js';

/** `point_t`: an integer lattice point (`long x, y`). */
export interface point_t {
  x: number;
  y: number;
}

/** `dpoint_t` is `potrace_dpoint_t`. */
export type dpoint_t = potrace_dpoint_t;

/** C's integer `/` for two ints: truncate toward zero. */
export function idiv(a: number, n: number): number {
  return Math.trunc(a / n);
}

/** `dpoint( p )`: an integer point as a double point. */
export function dpoint(p: point_t): dpoint_t {
  return { x: p.x, y: p.y };
}

/** `interval( lambda, a, b )`: the point `a + lambda (b - a)`. */
export function interval(lambda: number, a: dpoint_t, b: dpoint_t): dpoint_t {
  return { x: a.x + lambda * (b.x - a.x), y: a.y + lambda * (b.y - a.y) };
}

/**
 * `mod( a, n )`: `a` modulo `n`, in `[0, n)` for any `a`. The header's own
 * spelling, `n - 1 - ( -1 - a ) % n` for a negative `a`, is kept because it is
 * what the C computes; `%` of two ints is the same in both languages.
 */
export function mod(a: number, n: number): number {
  return a >= n ? a % n : a >= 0 ? a : n - 1 - ((-1 - a) % n);
}

/** `floordiv( a, n )`: `a / n` rounded toward minus infinity, for `n > 0`. */
export function floordiv(a: number, n: number): number {
  return a >= 0 ? idiv(a, n) : -1 - idiv(-1 - a, n);
}

/** `sign( x )`. */
export function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** `abs( a )`. */
export function abs(a: number): number {
  return a > 0 ? a : -a;
}

/** `min( a, b )`. */
export function min(a: number, b: number): number {
  return a < b ? a : b;
}

/** `max( a, b )`. */
export function max(a: number, b: number): number {
  return a > b ? a : b;
}

/** `sq( a )`. */
export function sq(a: number): number {
  return a * a;
}

/** `cu( a )`. */
export function cu(a: number): number {
  return a * a * a;
}
