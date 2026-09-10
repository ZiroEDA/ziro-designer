/**
 * The libm KiCad's Clipper2 links against is glibc 2.39's. Where V8's
 * `Math.*` is not the same bits, the glibc routine is ported here so the
 * offsetter rounds the same integer nanometre KiCad does.
 */

const SCALE = 2 ** -600;
const LARGE_VAL = 2 ** 511;
const TINY_VAL = 2 ** -459;
const EPS = 2 ** -54;

/** `e_hypot.c` kernel, the non-FMA path (Ubuntu's baseline x86-64 build). */
function kernel(ax: number, ay: number): number {
  let h = Math.sqrt(ax * ax + ay * ay);
  let t1: number;
  let t2: number;
  if (h <= 2.0 * ay) {
    const delta = h - ay;
    t1 = ax * (2.0 * delta - ax);
    t2 = (delta - 2.0 * (ax - ay)) * delta;
  } else {
    const delta = h - ax;
    t1 = 2.0 * delta * (ax - 2.0 * ay);
    t2 = (4.0 * delta - ay) * ay + delta * delta;
  }
  h -= (t1 + t2) / (2.0 * h);
  return h;
}

/** glibc 2.39 `__hypot` (Borges' MyHypot3), finite inputs. */
export function hypot(x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    if (Math.abs(x) === Number.POSITIVE_INFINITY || Math.abs(y) === Number.POSITIVE_INFINITY)
      return Number.POSITIVE_INFINITY;
    return x + y;
  }
  x = Math.abs(x);
  y = Math.abs(y);
  const ax = x < y ? y : x;
  const ay = x < y ? x : y;

  /* If ax is huge, scale both inputs down.  */
  if (ax > LARGE_VAL) {
    if (ay <= ax * EPS) return ax + ay;
    return kernel(ax * SCALE, ay * SCALE) / SCALE;
  }

  /* If ay is tiny, scale both inputs up.  */
  if (ay < TINY_VAL) {
    if (ax >= ay / EPS) return ax + ay;
    return kernel(ax / SCALE, ay / SCALE) * SCALE;
  }

  /* Common case: ax is not huge and ay is not tiny.  */
  if (ay <= ax * EPS) return ax + ay;

  return kernel(ax, ay);
}

export const cos = Math.cos;
export const sin = Math.sin;
export const acos = Math.acos;
export const atan2 = Math.atan2;
export const log10 = Math.log10;
export const asin = Math.asin;
export const tan = Math.tan;
