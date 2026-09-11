// SPDX-License-Identifier: LGPL-2.1-or-later
// Portions derived from the GNU C Library 2.39, copyright (C) 2001-2024 Free
// Software Foundation, Inc. (the IBM Accurate Mathematical Library:
// s_sin.c, branred.c, e_atan2.c, e_asin.c, e_hypot.c). See NOTICE.md.
/**
 * The libm KiCad links against is Ubuntu 24.04's glibc 2.39, and on any CPU
 * with FMA + AVX2 the ifunc resolver hands `sin`, `cos`, `atan2`, `asin` and
 * `acos` to the `*_fma` builds of the dbl-64 sources — the same C compiled
 * with `-mfma -mavx2`, where GCC contracts every `a * b ± c` whose product
 * feeds nothing but adds (and `dla.h`'s `EMULV` asks for one outright).
 * V8's `Math.*` is fdlibm; on random arguments it disagrees with glibc in
 * the last bit 2.5% of the time for sin/cos, 16% for atan2, 4% for acos —
 * enough to move a vertex of an inflated polygon by a nanometre now and then.
 *
 * So every routine here is transcribed from GCC's own GIMPLE of that build
 * (`-fdump-tree-widening_mul`, which prints each contraction as `.FMA` /
 * `.FMS` / `.FNMA`), not from the C, and the build it was read from
 * reproduces the installed libm bit for bit over 20 million samples of
 * every input class. `__branred` is not in the FMA list and is compiled
 * plain; so is `__hypot`, whose FMA path is a `#ifdef` the baseline build
 * does not take. The tables come straight out of the C in `libm_tables.ts`.
 *
 * `fma` itself is emulated exactly (Boldo–Melquiond, rounding to odd), with
 * a BigInt fallback where that emulation's no-underflow premise fails.
 */

import {
  as_hp0,
  as_hp1,
  asncs,
  big,
  big1,
  br_hp0,
  br_hp1,
  br_mp1,
  br_mp2,
  cij,
  cs2,
  cs4,
  cs6,
  d3,
  d5,
  d7,
  d9,
  d11,
  d13,
  f1,
  f2,
  f3,
  f4,
  f5,
  f6,
  hpi,
  hpi1,
  hpinv,
  inroot,
  inv16,
  mhpi,
  mopi,
  mqpi,
  mtqpi,
  opi,
  opi1,
  powtwo,
  pp3,
  pp4,
  qpi,
  rt0,
  rt1,
  rt2,
  rt3,
  s1,
  s2,
  s3,
  s4,
  s5,
  sincostab,
  sn_big,
  sn_hp0,
  sn_hp1,
  sn_mp1,
  sn_mp2,
  sn3,
  sn5,
  split,
  t24,
  t27,
  t576,
  tm24,
  tm600,
  toint,
  toverp,
  tqpi,
  two500,
  twom500,
} from './libm_tables.js';

/* ------------------------------------------------------------------ */
/* Word access: `mynumber.i[HIGH_HALF]` / `[LOW_HALF]` on little-endian.  */

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
// Every platform we run on stores doubles little-endian; the word indices
// below are HIGH_HALF = 1, LOW_HALF = 0 as glibc's `endian.h` sets them.
F64[0] = 1;
if (U32[1] !== 0x3ff00000) throw new Error('libm: big-endian double storage');

/** `u.i[HIGH_HALF]` as a signed int (`int4`). */
function hiWord(x: number): number {
  F64[0] = x;
  return U32[1]! | 0;
}

/** `u.i[LOW_HALF]` as a signed int. */
function loWord(x: number): number {
  F64[0] = x;
  return U32[0]! | 0;
}

function fromWords(hi: number, lo: number): number {
  U32[1] = hi >>> 0;
  U32[0] = lo >>> 0;
  return F64[0]!;
}

/** C `copysign`. */
function copysign(x: number, y: number): number {
  const ax = Math.abs(x);
  return y < 0 || (y === 0 && 1 / y < 0) ? -ax : ax;
}

/* ------------------------------------------------------------------ */
/* Exact fused multiply-add.                                             */

const SPLITTER = 134217729; // 2^27 + 1, Veltkamp
const FMA_BIG = 2 ** 995;
const FMA_TINY = 2 ** -968;

/** Round-to-odd sum of two doubles (Boldo–Melquiond). */
function addRoundToOdd(a: number, b: number): number {
  const s = a + b;
  const bv = s - a;
  const err = a - (s - bv) + (b - bv);
  if (err === 0) return s;
  F64[0] = s;
  if ((U32[0]! & 1) !== 0) return s; // already odd
  // Step to the neighbour on `err`'s side; that one is odd.
  const up = err > 0 === s > 0;
  let lo = U32[0]!;
  let hi = U32[1]!;
  if (up) {
    lo = (lo + 1) >>> 0;
    if (lo === 0) hi = (hi + 1) >>> 0;
  } else {
    if (lo === 0) hi = (hi - 1) >>> 0;
    lo = (lo - 1) >>> 0;
  }
  U32[0] = lo;
  U32[1] = hi;
  return F64[0]!;
}

/** Exact `a * b` as a double pair, no overflow/underflow. */
function twoProductErr(a: number, b: number, p: number): number {
  const ta = SPLITTER * a;
  const ah = ta - (ta - a);
  const al = a - ah;
  const tb = SPLITTER * b;
  const bh = tb - (tb - b);
  const bl = b - bh;
  return ah * bh - p + ah * bl + al * bh + al * bl;
}

/* BigInt exact path: value = mant * 2^exp. */
function decompose(x: number): { m: bigint; e: number } {
  F64[0] = x;
  const hi = U32[1]!;
  const lo = U32[0]!;
  const sign = hi >>> 31 ? -1n : 1n;
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (bexp === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = bexp - 1075;
  }
  return { m: sign * m, e };
}

function bitLength(n: bigint): number {
  return n === 0n ? 0 : n.toString(2).length;
}

/** Round the exact value `n * 2^e` to the nearest double, ties to even. */
function roundExact(n: bigint, e: number): number {
  if (n === 0n) return 0;
  const neg = n < 0n;
  let a = neg ? -n : n;
  const len = bitLength(a);
  let shift = len - 53;
  if (e + shift < -1074) shift = -1074 - e; // subnormal grid
  if (shift > 0) {
    const half = 1n << BigInt(shift - 1);
    const rem = a & ((1n << BigInt(shift)) - 1n);
    a >>= BigInt(shift);
    if (rem > half || (rem === half && (a & 1n) === 1n)) a += 1n;
    e += shift;
  }
  let r = Number(a); // < 2^54, exact
  // Scale by 2^e in steps that stay finite and exact.
  while (e > 0) {
    const step = Math.min(e, 1000);
    r *= 2 ** step;
    e -= step;
  }
  while (e < 0) {
    const step = Math.max(e, -1000);
    r *= 2 ** step;
    e -= step;
  }
  return neg ? -r : r;
}

function fmaExact(a: number, b: number, c: number): number {
  const A = decompose(a);
  const B = decompose(b);
  const C = decompose(c);
  const pe = A.e + B.e;
  const pm = A.m * B.m;
  const e = Math.min(pe, C.e);
  const n = (pm << BigInt(pe - e)) + (C.m << BigInt(C.e - e));
  if (n === 0n) {
    // Exact zero: the sign is that of an IEEE sum of two signed zeros.
    const pz = pm === 0n ? (a < 0 !== b < 0 ? -0 : 0) : pm < 0n ? -0 : 0;
    const cz = C.m === 0n ? c : C.m < 0n ? -0 : 0;
    return pz + cz;
  }
  return roundExact(n, e);
}

/** IEEE `fma(a, b, c)`: `a * b + c` with a single rounding. */
export function fma(a: number, b: number, c: number): number {
  if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c))) return a * b + c;
  const p = a * b;
  if (a === 0 || b === 0) return p + c;
  const ap = Math.abs(p);
  if (
    !(ap >= FMA_TINY && ap <= FMA_BIG) ||
    Math.abs(a) > FMA_BIG ||
    Math.abs(b) > FMA_BIG ||
    Math.abs(c) > FMA_BIG
  )
    return fmaExact(a, b, c);
  const pl = twoProductErr(a, b, p);
  // TwoSum(c, p)
  const th = c + p;
  const bv = th - c;
  const tl = c - (th - bv) + (p - bv);
  const v = addRoundToOdd(tl, pl);
  const z = th + v;
  if (z === 0) return fmaExact(a, b, c); // the sign of an exact zero
  return z;
}

/** GCC's `.FMS (a, b, c)` = `a * b - c`. */
function fms(a: number, b: number, c: number): number {
  return fma(a, b, -c);
}

/** GCC's `.FNMA (a, b, c)` = `c - a * b`. */
function fnma(a: number, b: number, c: number): number {
  return fma(-a, b, c);
}

/* ------------------------------------------------------------------ */
/* e_hypot.c                                                             */

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

/* ------------------------------------------------------------------ */
/* s_sin.c (__sin_fma / __cos_fma)                                       */

/** `TAYLOR_SIN (xx, x, dx)` as contracted. */
function taylorSin(xx: number, x: number, dx: number): number {
  let p = fma(xx, s5, s4);
  p = fma(xx, p, s3);
  p = fma(xx, p, s2);
  p = fma(xx, p, s1);
  const q = fms(p, x, dx * 0.5);
  const t = fma(xx, q, dx);
  return x + t;
}

/** `do_cos (x, dx)`. */
function doCos(x: number, dx: number): number {
  if (x < 0) dx = -dx;
  const ax = Math.abs(x);
  const u = sn_big + ax;
  x = ax - (u - sn_big) + dx;
  const xx = x * x;
  const x3 = x * xx;
  const s = fma(x3, fma(xx, sn5, sn3), x);
  const c = xx * fma(xx, fma(xx, cs6, cs4), cs2);
  const k = loWord(u) << 2;
  const sn = sincostab[k]!;
  const ssn = sincostab[k + 1]!;
  const cs = sincostab[k + 2]!;
  const ccs = sincostab[k + 3]!;
  let cor = fnma(s, ssn, ccs);
  cor = fnma(c, cs, cor);
  cor = fnma(s, sn, cor);
  return cs + cor;
}

/** `do_sin (x, dx)`. */
function doSin(x: number, dx: number): number {
  const xold = x;
  if (Math.abs(x) < 0.126) return taylorSin(x * x, x, dx);
  if (x <= 0) dx = -dx;
  const ax = Math.abs(x);
  const u = sn_big + ax;
  x = ax - (u - sn_big);
  const xx = x * x;
  const x3 = x * xx;
  const s = x + fma(x3, fma(xx, sn5, sn3), dx);
  const c = fma(x, dx, xx * fma(xx, fma(xx, cs6, cs4), cs2));
  const k = loWord(u) << 2;
  const sn = sincostab[k]!;
  const ssn = sincostab[k + 1]!;
  const cs = sincostab[k + 2]!;
  const ccs = sincostab[k + 3]!;
  let cor = fma(s, ccs, ssn);
  cor = fnma(c, sn, cor);
  cor = fma(s, cs, cor);
  return copysign(sn + cor, xold);
}

/** `reduce_sincos`: |x| < 105414350 to within pi/4 as a + da; returns n. */
function reduceSincos(x: number): { a: number; da: number; n: number } {
  const t = fma(x, hpinv, toint);
  const xn = t - toint;
  const y = fnma(xn, sn_mp2, fnma(xn, sn_mp1, x));
  const n = loWord(t) & 3;
  const t2 = fnma(xn, pp3, y);
  let db = fnma(xn, pp3, y - t2);
  const b = fnma(xn, pp4, t2);
  db += fnma(xn, pp4, t2 - b);
  return { a: b, da: db, n };
}

function doSincos(a: number, da: number, n: number): number {
  const r = n & 1 ? doCos(a, da) : doSin(a, da);
  return n & 2 ? -r : r;
}

/* branred.c — compiled without FMA. */

/** `__branred`: x = n*pi/2 + (a + aa), |a + aa| < pi/4; returns n mod 4. */
function branred(x: number): { a: number; aa: number; n: number } {
  const r = new Float64Array(6);
  x *= tm600;
  let t = x * split;
  const x1 = t - (t - x);
  const x2 = x - x1;

  const half = (xp: number): { b: number; bb: number; sum: number } => {
    let sum = 0;
    let k = (hiWord(xp) >> 20) & 2047;
    k = Math.trunc((k - 450) / 24);
    if (k < 0) k = 0;
    let gor = fromWords(hiWord(t576) - ((k * 24) << 20), 0);
    for (let i = 0; i < 6; i++) {
      r[i] = xp * toverp[k + i]! * gor;
      gor *= tm24;
    }
    for (let i = 0; i < 3; i++) {
      const s = r[i]! + big - big;
      sum += s;
      r[i] = r[i]! - s;
    }
    let tt = 0;
    for (let i = 0; i < 6; i++) tt += r[5 - i]!;
    let bb = r[0]! - tt + r[1]! + r[2]! + r[3]! + r[4]! + r[5]!;
    let s = tt + big - big;
    sum += s;
    tt -= s;
    const b = tt + bb;
    bb = tt - b + bb;
    s = sum + big1 - big1;
    sum -= s;
    return { b, bb, sum };
  };

  const h1 = half(x1);
  const h2 = half(x2);
  let sum = h1.sum + h2.sum;
  let b = h1.b + h2.b;
  let bb = Math.abs(h1.b) > Math.abs(h2.b) ? h1.b - b + h2.b : h2.b - b + h1.b;
  if (b > 0.5) {
    b -= 1.0;
    sum += 1.0;
  } else if (b < -0.5) {
    b += 1.0;
    sum -= 1.0;
  }
  let s = b + (bb + h1.bb + h2.bb);
  t = b - s + bb + (h1.bb + h2.bb);
  b = s * split;
  const t1 = b - (b - s);
  const t2 = s - t1;
  b = s * br_hp0;
  bb = t1 * br_mp1 - b + t1 * br_mp2 + t2 * br_mp1 + (t2 * br_mp2 + s * br_hp1 + t * br_hp0);
  s = b + bb;
  t = b - s + bb;
  return { a: s, aa: t, n: Math.trunc(sum) & 3 };
}

/** glibc 2.39 `sin`, the `__sin_fma` build. */
export function sin(x: number): number {
  const k = hiWord(x) & 0x7fffffff;
  if (k < 0x3e500000) return x;
  if (k < 0x3feb6000) return doSin(x, 0);
  if (k < 0x400368fd) {
    const t = sn_hp0 - Math.abs(x);
    return copysign(doCos(t, sn_hp1), x);
  }
  if (k < 0x419921fb) {
    const { a, da, n } = reduceSincos(x);
    return doSincos(a, da, n);
  }
  if (k < 0x7ff00000) {
    const { a, aa, n } = branred(x);
    return doSincos(a, aa, n);
  }
  return x / x;
}

/** glibc 2.39 `cos`, the `__cos_fma` build. */
export function cos(x: number): number {
  const k = hiWord(x) & 0x7fffffff;
  if (k < 0x3e400000) return 1.0;
  if (k < 0x3feb6000) return doCos(x, 0);
  if (k < 0x400368fd) {
    const y = sn_hp0 - Math.abs(x);
    const a = y + sn_hp1;
    const da = y - a + sn_hp1;
    return doSin(a, da);
  }
  if (k < 0x419921fb) {
    const { a, da, n } = reduceSincos(x);
    return doSincos(a, da, n + 1);
  }
  if (k < 0x7ff00000) {
    const { a, aa, n } = branred(x);
    return doSincos(a, aa, n + 1);
  }
  return x / x;
}

/* ------------------------------------------------------------------ */
/* e_atan2.c (__ieee754_atan2_fma)                                       */

const TWO52 = 2 ** 52;
const EP = 59768832; /*  57*16**5 */
const EM = -59768832; /* -57*16**5 */

/** The odd polynomial `d3 + v*(d5 + v*(... + v*d13))`, as contracted. */
function atanPoly(v: number): number {
  let p = fma(v, d13, d11);
  p = fma(p, v, d9);
  p = fma(p, v, d7);
  p = fma(p, v, d5);
  return fma(p, v, d3);
}

/** `cij[i][2] + v*(cij[i][3] + v*(... + v*cij[i][6]))`, as contracted. */
function cijPoly(i: number, v: number, from: number): number {
  const base = i * 7;
  let p = fma(cij[base + 6]!, v, cij[base + 5]!);
  p = fma(p, v, cij[base + 4]!);
  p = fma(p, v, cij[base + 3]!);
  if (from === 2) p = fma(p, v, cij[base + 2]!);
  return p;
}

/** glibc 2.39 `atan2(y, x)`, the `__ieee754_atan2_fma` build. */
export function atan2(y: number, x: number): number {
  const ux = hiWord(x);
  const dx = loWord(x);
  if ((ux & 0x7ff00000) === 0x7ff00000) {
    if (((ux & 0x000fffff) | dx) !== 0) return x + y;
  }
  const uy = hiWord(y);
  const dy = loWord(y);
  if ((uy & 0x7ff00000) === 0x7ff00000) {
    if (((uy & 0x000fffff) | dy) !== 0) return y + y;
  }

  /* y=+-0 */
  if (uy === 0) {
    if (dy === 0) return (ux & 0x80000000) === 0 ? 0 : opi;
  } else if (uy === (0x80000000 | 0)) {
    if (dy === 0) return (ux & 0x80000000) === 0 ? -0.0 : mopi;
  }

  /* x=+-0 */
  if (x === 0) return (uy & 0x80000000) === 0 ? hpi : mhpi;

  /* x=+-INF */
  if (ux === 0x7ff00000) {
    if (dx === 0) {
      if (uy === 0x7ff00000) {
        if (dy === 0) return qpi;
      } else if (uy === (0xfff00000 | 0)) {
        if (dy === 0) return mqpi;
      } else {
        return (uy & 0x80000000) === 0 ? 0 : -0.0;
      }
    }
  } else if (ux === (0xfff00000 | 0)) {
    if (dx === 0) {
      if (uy === 0x7ff00000) {
        if (dy === 0) return tqpi;
      } else if (uy === (0xfff00000 | 0)) {
        if (dy === 0) return mtqpi;
      } else {
        return (uy & 0x80000000) === 0 ? opi : mopi;
      }
    }
  }

  /* y=+-INF */
  if (uy === 0x7ff00000) {
    if (dy === 0) return hpi;
  } else if (uy === (0xfff00000 | 0)) {
    if (dy === 0) return mhpi;
  }

  /* either x/y or y/x is very close to zero */
  let ax = x < 0 ? -x : x;
  let ay = y < 0 ? -y : y;
  const de = (uy & 0x7ff00000) - (ux & 0x7ff00000);
  if (de >= EP) return y > 0 ? hpi : mhpi;
  if (de <= EM) {
    if (x > 0) {
      const z = ay / ax;
      // (`math_force_eval` of the square only raises the underflow flag.)
      return copysign(z, y);
    }
    return y > 0 ? opi : mopi;
  }

  /* if either x or y is extremely close to zero, scale abs(x), abs(y). */
  if (ax < twom500 || ay < twom500) {
    ax *= two500;
    ay *= two500;
  }
  /* Likewise for large x and y.  */
  if (ax > two500 || ay > two500) {
    ax *= twom500;
    ay *= twom500;
  }

  /* x,y which are neither special nor extreme */
  let u: number;
  let du: number;
  if (ay < ax) {
    u = ay / ax;
    const v = u * ax;
    const vv = fms(u, ax, v);
    du = (ay - v - vv) / ax;
  } else {
    u = ax / ay;
    const v = u * ay;
    const vv = fms(u, ay, v);
    du = (ax - v - vv) / ay;
  }

  if (x > 0) {
    /* (i)   x>0, abs(y)< abs(x):  atan(ay/ax) */
    if (ay < ax) {
      if (u < inv16) {
        const v = u * u;
        const zz = fma(u * v, atanPoly(v), du);
        return copysign(u + zz, y);
      }
      let i = fma(u, 256, TWO52) - TWO52;
      i -= 16;
      const t3 = u - cij[i * 7]!;
      // EADD (t3, du, v, dv)
      const v = du + t3;
      const dv = Math.abs(t3) > Math.abs(du) ? t3 - v + du : du - v + t3;
      const t1 = cij[i * 7 + 1]!;
      const t2 = cij[i * 7 + 2]!;
      let zz = v * v * cijPoly(i, v, 3);
      zz = fma(dv, t2, zz);
      zz = fma(v, t2, zz);
      return copysign(t1 + zz, y);
    }
    /* (ii)  x>0, abs(x)<=abs(y):  pi/2-atan(ax/ay) */
    if (u < inv16) {
      const v = u * u;
      const zz = u * v * atanPoly(v);
      // ESUB (hpi, u, t2, cor)
      const t2 = hpi - u;
      const cor = Math.abs(hpi) > Math.abs(u) ? hpi - t2 - u : hpi - (u + t2);
      const t3 = hpi1 + cor - du - zz;
      return copysign(t2 + t3, y);
    }
    let i = fma(u, 256, TWO52) - TWO52;
    i -= 16;
    const v = u - cij[i * 7]! + du;
    const zz = fnma(cijPoly(i, v, 2), v, hpi1);
    const t1 = hpi - cij[i * 7 + 1]!;
    return copysign(zz + t1, y);
  }

  /* (iii) x<0, abs(x)< abs(y):  pi/2+atan(ax/ay) */
  if (ax < ay) {
    if (u < inv16) {
      const v = u * u;
      const zz = u * v * atanPoly(v);
      // EADD (hpi, u, t2, cor)
      const t2 = u + hpi;
      const cor = Math.abs(hpi) > Math.abs(u) ? hpi - t2 + u : u - t2 + hpi;
      const t3 = hpi1 + cor + du + zz;
      return copysign(t2 + t3, y);
    }
    let i = fma(u, 256, TWO52) - TWO52;
    i -= 16;
    const v = u - cij[i * 7]! + du;
    const zz = fma(cijPoly(i, v, 2), v, hpi1);
    const t1 = cij[i * 7 + 1]! + hpi;
    return copysign(zz + t1, y);
  }

  /* (iv)  x<0, abs(y)<=abs(x):  pi-atan(ax/ay) */
  if (u < inv16) {
    const v = u * u;
    const zz = u * v * atanPoly(v);
    // ESUB (opi, u, t2, cor)
    const t2 = opi - u;
    const cor = Math.abs(opi) > Math.abs(u) ? opi - t2 - u : opi - (u + t2);
    const t3 = opi1 + cor - du - zz;
    return copysign(t2 + t3, y);
  }
  let i = fma(u, 256, TWO52) - TWO52;
  i -= 16;
  const v = u - cij[i * 7]! + du;
  const zz = fnma(cijPoly(i, v, 2), v, opi1);
  const t1 = opi - cij[i * 7 + 1]!;
  return copysign(zz + t1, y);
}

/* ------------------------------------------------------------------ */
/* e_asin.c (__ieee754_asin_fma / __ieee754_acos_fma)                    */

/** `(((((f6*z+f5)*z+f4)*z+f3)*z+f2)*z+f1)` as contracted. */
function asinPoly(z: number): number {
  let p = fma(z, f6, f5);
  p = fma(p, z, f4);
  p = fma(p, z, f3);
  p = fma(p, z, f2);
  return fma(p, z, f1);
}

/**
 * The table segment shared by asin and acos for 0.125 <= |x| < 0.96875:
 * returns `t` (the polynomial part) and the table's angle for the segment.
 * `n` indexes `asncs`, `deg` is the polynomial degree the segment uses.
 */
function asncsSegment(x: number, m: number, n: number, deg: number): { t: number; ang: number } {
  const xx = m > 0 ? x - asncs[n]! : -x - asncs[n]!;
  const a1 = asncs[n + 1]!;
  const xx2 = xx * xx;
  let p = fma(asncs[n + deg + 1]!, xx, asncs[n + deg]!);
  for (let j = deg - 1; j >= 2; j--) p = fma(p, xx, asncs[n + j]!);
  p = fma(xx2, p, asncs[n + deg + 2]!);
  const t = fma(a1, xx, p);
  return { t, ang: asncs[n + deg + 3]! };
}

function asinSegment(k: number, m: number): { n: number; deg: number } {
  if (k < 0x3fe00000) {
    const n = k < 0x3fd00000 ? 11 * ((k & 0x000fffff) >> 15) : 11 * ((k & 0x000fffff) >> 14) + 352;
    return { n, deg: 5 };
  }
  if (k < 0x3fe80000) return { n: 1056 + ((k & 0x000fe000) >> 11) * 3, deg: 6 };
  if (k < 0x3fed8000) return { n: 992 + ((k & 0x000fe000) >> 13) * 13, deg: 7 };
  if (k < 0x3fee8000) return { n: 884 + ((k & 0x000fe000) >> 13) * 14, deg: 8 };
  return { n: 768 + ((k & 0x000fe000) >> 13) * 15, deg: 9 };
}

/** glibc 2.39 `asin`, the `__ieee754_asin_fma` build. */
export function asin(x: number): number {
  const m = hiWord(x);
  const k = 0x7fffffff & m;
  if (k < 0x3e500000) return x;
  /* 2^-26 <= |x| < 2^-3 */
  if (k < 0x3fc00000) {
    const x2 = x * x;
    return fma(asinPoly(x2), x * x2, x);
  }
  /* 0.125 <= |x| < 0.96875 */
  if (k < 0x3fef0000) {
    const { n, deg } = asinSegment(k, m);
    const { t, ang } = asncsSegment(x, m, n, deg);
    const res = ang + t;
    return m > 0 ? res : -res;
  }
  /* 0.96875 <= |x| < 1 */
  if (k < 0x3ff00000) {
    const z = (m > 0 ? 1.0 - x : x + 1.0) * 0.5;
    const kv = hiWord(z);
    let t = inroot[(kv & 0x001fffff) >> 14]! * powtwo[511 - (kv >> 21)]!;
    const r = fnma(t * t, z, 1.0);
    t = fma(fma(fma(r, rt3, rt2), r, rt1), r, rt0) * t;
    const c = z * t;
    const q = fnma(t * 0.5, c, 1.5);
    const y = c + t24 - t24;
    const cc = fnma(y, y, z) / fma(q, c, y);
    const p = asinPoly(z) * z;
    let cor = fnma(cc, 2.0, as_hp1);
    cor = fnma((y + cc) * 2.0, p, cor);
    const res1 = fnma(y, 2.0, as_hp0);
    const res = cor + res1;
    return m > 0 ? res : -res;
  }
  /* |x|>=1 */
  if (k === 0x3ff00000 && loWord(x) === 0) return m > 0 ? as_hp0 : -as_hp0;
  return (x - x) / (x - x);
}

/** glibc 2.39 `acos`, the `__ieee754_acos_fma` build. */
export function acos(x: number): number {
  const m = hiWord(x);
  const k = 0x7fffffff & m;
  /* |x|<2.77556*10^-17 */
  if (k < 0x3c880000) return as_hp0;
  /* 2.77556*10^-17 <= |x| < 2^-3 */
  if (k < 0x3fc00000) {
    const x2 = x * x;
    const r = as_hp0 - x;
    const cor = fnma(asinPoly(x2), x * x2, as_hp0 - r - x + as_hp1);
    return r + cor;
  }
  /* 0.125 <= |x| < 0.96875 */
  if (k < 0x3fef0000) {
    const { n, deg } = asinSegment(k, m);
    const { t, ang } = asncsSegment(x, m, n, deg);
    const y = m > 0 ? as_hp0 - ang : ang + as_hp0;
    const tt = m > 0 ? as_hp1 - t : t + as_hp1;
    return tt + y;
  }
  /* 0.96875 <= |x| < 1 */
  if (k < 0x3ff00000) {
    const z = (m > 0 ? 1.0 - x : x + 1.0) * 0.5;
    const kv = hiWord(z);
    let t = inroot[(kv & 0x001fffff) >> 14]! * powtwo[511 - (kv >> 21)]!;
    const r = fnma(t * t, z, 1.0);
    t = fma(fma(fma(r, rt3, rt2), r, rt1), r, rt0) * t;
    const c = z * t;
    const q = fnma(t * 0.5, c, 1.5);
    const y = fnma(c, t27, fma(c, t27, c));
    const cc = fnma(y, y, z) / fma(q, c, y);
    const p = asinPoly(z) * z;
    const pyc = p * (y + cc);
    if (m < 0) {
      const cor = as_hp1 - cc - pyc;
      const res1 = as_hp0 - y;
      const res = cor + res1;
      return res * 2.0;
    }
    const cor = cc + pyc;
    const res = y + cor;
    return res * 2.0;
  }
  /* |x|>=1 */
  if (k === 0x3ff00000 && loWord(x) === 0) return m > 0 ? 0 : 2.0 * as_hp0;
  return (x - x) / (x - x);
}

/* Not on any fill path: Clipper's `log10` only runs with a zero arc
 * tolerance, which KiCad never passes, and nothing calls `tan`. */
export const log10 = Math.log10;
export const tan = Math.tan;
