// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SEG` answers from doubles whenever it can prove the double is the exact
 * integer, and from BigInt otherwise. The two paths must not disagree by one
 * IU anywhere, because a DRC violation is a comparison against a clearance and
 * a single IU either way is a violation appearing or vanishing.
 *
 * The reference below is `seg.cpp`'s own arithmetic in BigInt - `ecoord` is
 * `int64_t` and every product is formed in it. It is written from the C++, not
 * from `seg.ts`, and it is NOT the fallback body: if someone deletes the
 * fallback and always takes the fast path, these cases still have to agree.
 *
 * The coordinates are deliberately drawn across the whole int32 range as well
 * as the small deltas DRC actually meets, so both paths are exercised: a
 * segment a metre long puts every product past 2^53 and must fall back.
 */
import { describe, expect, it } from 'vitest';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * `KiROUND` (`math/util.h`): `v < 0 ? ceil( v - 0.5 ) : floor( v + 0.5 )`,
 * half away from zero. `big()` applies it to each coordinate BEFORE
 * subtracting, and the fast path has to agree with that, not with "subtract
 * the raw doubles" - the two differ whenever a fraction is present.
 *
 * Written out rather than imported, and written out THIS way rather than as
 * `Math.round`: past 2^52 a double's neighbours are a whole unit apart, so
 * `v + 0.5` is itself rounded and `floor` can land one above `Math.round`.
 * That quirk is in every coordinate KiCad rounds, and a reference that
 * "improved" on it would fail the code for matching upstream.
 */
const r = (v: number): bigint => BigInt(v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/** `SEG::SquaredDistance( VECTOR2I )` (seg.cpp), in ecoord. */
function refSquaredDistance(seg: SEG, p: VECTOR2I): bigint {
  const abx = r(seg.B.x) - r(seg.A.x);
  const aby = r(seg.B.y) - r(seg.A.y);
  const apx = r(p.x) - r(seg.A.x);
  const apy = r(p.y) - r(seg.A.y);

  const e = apx * abx + apy * aby;

  if (e <= 0n) return apx * apx + apy * apy;

  const f = abx * abx + aby * aby;

  if (e >= f) {
    const bpx = r(p.x) - r(seg.B.x);
    const bpy = r(p.y) - r(seg.B.y);
    return bpx * bpx + bpy * bpy;
  }

  const eD = Number(e);
  const g = Number(apx * apx + apy * apy) - (eD * eD) / Number(f);

  if (g < 0 || g > 2 ** 63) return 0n;

  return r(g);
}

/**
 * `isqrt` (seg.cpp:57): the largest integer whose square does not exceed x -
 * capped at `sqrt_max`, as upstream's second loop caps it (`r > sqrt_max`).
 */
function refIsqrt(x: bigint): bigint {
  const SQRT_INT64_MAX = 3037000499n;

  if (x < 0n) return SQRT_INT64_MAX;

  let r = BigInt(Math.trunc(Math.sqrt(Number(x))));

  // Upstream's seed cannot exceed sqrt_max because its x is an int64; clamp
  // rather than walk a billion steps down to the cap.
  if (r > SQRT_INT64_MAX) r = SQRT_INT64_MAX;

  while (r > 0n && r * r > x) r--;
  while (r < SQRT_INT64_MAX && (r + 1n) * (r + 1n) <= x) r++;

  return r > SQRT_INT64_MAX ? SQRT_INT64_MAX : r;
}

/** `SEG::NearestPoint( VECTOR2I )`, the two endpoint answers. */
function refNearestIsEndpoint(seg: SEG, p: VECTOR2I): 'A' | 'B' | 'interior' {
  const dx = r(seg.B.x) - r(seg.A.x);
  const dy = r(seg.B.y) - r(seg.A.y);
  const l = dx * dx + dy * dy;

  if (l === 0n) return 'A';

  const t = dx * (r(p.x) - r(seg.A.x)) + dy * (r(p.y) - r(seg.A.y));

  if (t < 0n) return 'A';
  if (t > l) return 'B';

  return 'interior';
}

/** A xorshift, so a failure is reproducible from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;

  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Three scales: DRC-sized deltas, board-sized, and the metre that is the far
 * edge of KiCad's design space. Not the whole int32 range: a coordinate there
 * squares past `int64`, which is outside `ecoord`'s domain and outside
 * `isqrt`'s (its seed is `sqrt( (double) x )` for an int64 x).
 */
const SCALES = [1_000, 300_000_000, 1_000_000_000];

/**
 * A `VECTOR2I` in this port is a `{x, y}` of numbers, and one that has been
 * through a floating-point transform carries a fraction - which `big()`
 * rounds and a raw subtraction would not. So every scale runs twice.
 *
 * The two variants have to be SEPARATE runs, not one run whose coordinates
 * are sometimes fractional: the fast path needs all six coordinates whole, so
 * a mixed run never takes it at all, and every check passes by never
 * exercising the thing it is here to check. (It was written that way first,
 * and a mutant that widened the exactness limit to 2^63 survived it.)
 */
const VARIANTS = [
  { name: 'whole', fractions: [0] },
  { name: 'fractional', fractions: [0.4, 0.5, -0.5, 0.75] },
] as const;

describe('SEG: the exact-double fast path answers what the BigInt body answers', () => {
  for (const scale of SCALES)
    for (const variant of VARIANTS) {
      it(`agrees on squared distance and distance to a point (${variant.name}, ±${scale} IU)`, () => {
        const next = rng(0x5eed + scale);
        let f = 0;
        const coord = (): number =>
          Math.trunc((next() * 2 - 1) * scale) + variant.fractions[f++ % variant.fractions.length]!;

        for (let i = 0; i < 4000; i++) {
          const seg = new SEG(coord(), coord(), coord(), coord());
          const p = { x: coord(), y: coord() };
          const want = refSquaredDistance(seg, p);

          // `SquaredDistance` returns a number, so past 2^53 both paths land on
          // the same rounded double rather than on the exact integer; comparing
          // as doubles is the equivalence that exists to check.
          expect(seg.SquaredDistance(p), `${JSON.stringify({ seg, p })}`).toBe(Number(want));
          expect(seg.Distance(p), `${JSON.stringify({ seg, p })}`).toBe(Number(refIsqrt(want)));
        }
      });

      it(`agrees on which endpoint is nearest (${variant.name}, ±${scale} IU)`, () => {
        const next = rng(0xb0a7 + scale);
        let f = 0;
        const coord = (): number =>
          Math.trunc((next() * 2 - 1) * scale) + variant.fractions[f++ % variant.fractions.length]!;

        for (let i = 0; i < 4000; i++) {
          const seg = new SEG(coord(), coord(), coord(), coord());
          const p = { x: coord(), y: coord() };
          const got = seg.NearestPoint(p);
          const where = refNearestIsEndpoint(seg, p);
          const at = (q: VECTOR2I): boolean => got.x === q.x && got.y === q.y;

          if (where === 'A') expect(at(seg.A), `${JSON.stringify({ seg, p, got })}`).toBe(true);
          else if (where === 'B')
            expect(at(seg.B), `${JSON.stringify({ seg, p, got })}`).toBe(true);
        }
      });

      it(`agrees on segment collision and the actual distance (${variant.name}, ±${scale} IU)`, () => {
        const next = rng(0xc011 + scale);
        let f = 0;
        const coord = (): number =>
          Math.trunc((next() * 2 - 1) * scale) + variant.fractions[f++ % variant.fractions.length]!;

        for (let i = 0; i < 4000; i++) {
          const a = new SEG(coord(), coord(), coord(), coord());
          const b = new SEG(coord(), coord(), coord(), coord());
          // A clearance in the neighbourhood of the two, so both answers happen.
          const clearance = Math.trunc(next() * scale);
          const actual = { value: -1 };
          const hit = a.Collide(b, clearance, actual);

          // The reference: the four endpoint distances, exactly as seg.cpp's
          // Collide forms them, plus its exact-intersection short circuit.
          const four = [
            refSquaredDistance(a, b.A),
            refSquaredDistance(a, b.B),
            refSquaredDistance(b, a.A),
            refSquaredDistance(b, a.B),
          ];
          const min = four.reduce((m, v) => (v < m ? v : m));
          const why = `${JSON.stringify({ a, b, clearance })}`;

          if (a.Intersects(b)) {
            expect(hit, why).toBe(true);
            continue;
          }

          if (min === 0n) {
            expect(hit, why).toBe(true);
            expect(actual.value, why).toBe(0);
            continue;
          }

          expect(hit, why).toBe(min < BigInt(clearance) * BigInt(clearance));
          expect(actual.value, why).toBe(Number(refIsqrt(min)));
        }
      });
    }
});

/**
 * The cases random sampling will not find. Each is constructed so that one
 * specific guard is the only thing standing between the fast path and a wrong
 * answer - a random segment meets them with probability ~0.
 */
describe('SEG: the fast path on the cases that are built to break it', () => {
  /**
   * `isqrt` is the FLOOR of the square root, and `Math.sqrt` is the nearest
   * double to it. Just below a perfect square the two disagree: for
   * `x = k² - 1`, `sqrt( x )` is `k - 1/(2k)`, and past `k ≈ 2^26.5` that sits
   * inside half an ulp of `k`, so it rounds UP to `k` and the floor is one too
   * many. Hence the correction loops.
   *
   * `k = 2t² + 1` with `x = k - 1, y = 2t` gives `x² + y² = k² - 1` exactly,
   * and a zero-length segment makes the squared distance to that point be
   * exactly `x² + y²` (`e <= 0`, the first arm).
   */
  it('takes the floor of the square root just below a perfect square', () => {
    for (let t = 6800; t <= 6888; t++) {
      const k = 2 * t * t + 1;
      const p = { x: k - 1, y: 2 * t };
      const seg = new SEG({ x: 0, y: 0 }, { x: 0, y: 0 });

      expect(seg.SquaredDistance(p), `t=${t}`).toBe(k * k - 1);
      expect(seg.Distance(p), `t=${t}`).toBe(k - 1);
    }
  });
});
