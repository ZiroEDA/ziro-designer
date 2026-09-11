// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `libm.ts` against the libm KiCad actually runs on: glibc 2.39 as Ubuntu
 * 24.04 ships it, on an FMA + AVX2 machine where the ifunc resolver picks the
 * `__sin_fma` / `__cos_fma` / `__ieee754_atan2_fma` / `__ieee754_asin_fma`
 * / `__ieee754_acos_fma` builds. Each answer in the fixture was written by
 * that libm (`qa/data/libm/glibc_samples.mjs` says how), as raw IEEE bits.
 *
 * Half of every set is inputs where V8's `Math.*` — or, for `fma`, a plain
 * `a * b + c` — gives a different last bit; the other half is random, in
 * every input class the C oracle samples (angles, degree multiples, integer
 * coordinates, 1e9 coordinates, random bit patterns, huge arguments through
 * `__branred`, near ±1 for acos/asin).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { acos, asin, atan2, cos, fma, sin } from '@ziroeda/kimath/src/math/libm.js';
import { describe, expect, it } from 'vitest';

type Fixture = Record<string, { differ: string[][]; random: string[][]; targeted?: string[][] }>;
const fixture: Fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../data/libm/glibc_2_39_samples.json'), 'utf8'),
);

const dv = new DataView(new ArrayBuffer(8));
const fromHex = (h: string): number => {
  dv.setBigUint64(0, BigInt(`0x${h}`));
  return dv.getFloat64(0);
};
const toHex = (x: number): string => {
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16).padStart(16, '0');
};

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  sin: (x) => sin(x!),
  cos: (x) => cos(x!),
  atan2: (y, x) => atan2(y!, x!),
  acos: (x) => acos(x!),
  asin: (x) => asin(x!),
  fma: (a, b, c) => fma(a!, b!, c!),
};

describe('libm is glibc 2.39, bit for bit', () => {
  for (const [name, fn] of Object.entries(FUNCTIONS)) {
    for (const set of ['differ', 'random'] as const) {
      it(`${name}: ${set === 'differ' ? '250 inputs V8 gets a different bit on' : '250 random inputs'}`, () => {
        const rows = fixture[name]![set];
        expect(rows).toHaveLength(250);
        const wrong: string[] = [];
        for (const row of rows) {
          const args = row.slice(0, -1).map(fromHex);
          const want = row[row.length - 1]!;
          const got = toHex(fn(...args));
          // NaN payloads are not pinned; every other bit is.
          if (got !== want && !(Number.isNaN(fromHex(got)) && Number.isNaN(fromHex(want))))
            wrong.push(`${name}(${args.join(', ')}) = ${got}, glibc ${want}`);
        }
        expect(wrong).toEqual([]);
      });
    }
  }

  it('and on the inputs a mutant of the port was caught by', () => {
    // Found by searching 20 million inputs per mutant for a disagreement with
    // the port, then asking glibc (qa/data/libm/targeted.c):
    //  - M2: `s = x + (x3 * poly + dx)` in do_sin, the contraction undone —
    //    one input in 20 million, because the product's rounding error sits
    //    2^-19 below the ulp of s;
    //  - M9: cos returning 1.0 below 2^-26 instead of 2^-27;
    //  - M12: the two branches of `EADD (t3, du, v, dv)` swapped in atan2.
    // (Two more contraction mutants, in reduce_sincos's `db` and acos's
    // 26-bit split of `c`, survived 20 million: the first shifts a term
    // 2^-35 below anything the result can see, the second multiplies by a
    // power of two, which rounds nowhere.)
    const seen = new Set<string>();
    for (const [name, fn] of Object.entries(FUNCTIONS)) {
      for (const row of fixture[name]!.targeted ?? []) {
        const [mutant, ...rest] = row;
        seen.add(mutant!);
        const args = rest.slice(0, -1).map(fromHex);
        expect(toHex(fn(...args)), `${mutant} ${name}(${args.join(', ')})`).toBe(
          rest[rest.length - 1],
        );
      }
    }
    expect([...seen].sort()).toEqual(['M12', 'M2', 'M9']);
  });

  it('the Math.* fallbacks really are different answers (the fixture pins something)', () => {
    const naive: Record<string, (...a: number[]) => number> = {
      sin: (x) => Math.sin(x!),
      cos: (x) => Math.cos(x!),
      atan2: (y, x) => Math.atan2(y!, x!),
      acos: (x) => Math.acos(x!),
      asin: (x) => Math.asin(x!),
      fma: (a, b, c) => a! * b! + c!,
    };
    for (const [name, fn] of Object.entries(naive)) {
      const rows = fixture[name]!.differ;
      const agree = rows.filter(
        (row) => toHex(fn(...row.slice(0, -1).map(fromHex))) === row[row.length - 1],
      );
      expect(agree, name).toEqual([]);
    }
  });
});

describe('fma edge cases', () => {
  it('keeps the product exact where a * b would round', () => {
    const a = 1 + 2 ** -30;
    const b = 1 + 2 ** -30;
    // a*b = 1 + 2^-29 + 2^-60; minus (1 + 2^-29) leaves 2^-60 exactly.
    expect(fma(a, b, -(1 + 2 ** -29))).toBe(2 ** -60);
    expect(a * b - (1 + 2 ** -29)).toBe(0);
  });

  it('rounds to odd in between, so a midpoint carried in the product tail is not lost', () => {
    // a*b = (2^57 + 1) * 2^-110 = 2^-53 + 2^-110 exactly, split as
    // 524289 * (2^38 - 2^19 + 1). With c = 1 the exact sum sits 2^-110 above
    // the midpoint 1 + 2^-53, so the answer is 1 + 2^-52 — C fma agrees
    // (0x1.0000000000001p+0). A plain a*b+c lands on the midpoint and ties to
    // 1.0; so does the emulation without rounding to odd.
    const a = 524289 * 2 ** -55;
    const b = (2 ** 38 - 2 ** 19 + 1) * 2 ** -55;
    expect(fma(a, b, 1)).toBe(1 + 2 ** -52);
    expect(a * b + 1).toBe(1);
  });

  it('signs an exact zero the IEEE way', () => {
    expect(Object.is(fma(1, 1, -1), 0)).toBe(true);
    expect(Object.is(fma(-1, 1, 1), 0)).toBe(true);
    expect(Object.is(fma(-0, 1, -0), -0)).toBe(true);
    expect(Object.is(fma(0, 1, -0), 0)).toBe(true);
  });

  it('takes the exact path for tiny products and huge operands', () => {
    // 2^-600 * 2^-600 = 2^-1200 underflows to 0 as a product; with c = 2^-1074
    // the exact sum rounds to 2^-1074 (the product is far below half a unit).
    expect(fma(2 ** -600, 2 ** -600, 2 ** -1074)).toBe(2 ** -1074);
    // Ties on the subnormal grid go to even: 1.5 and 2.5 units both to 2, 3.5 to 4.
    // (C `fma` on this machine: 0x0.0000000000002p-1022 twice, then ...4p-1022.)
    expect(fma(1.5, 2 ** -1074, 0)).toBe(2 ** -1073);
    expect(fma(2.5, 2 ** -1074, 0)).toBe(2 ** -1073);
    expect(fma(3.5, 2 ** -1074, 0)).toBe(2 ** -1072);
    expect(fma(2 ** 1000, 2 ** 1000, -Number.MAX_VALUE)).toBe(Number.POSITIVE_INFINITY);
    expect(fma(2 ** 1000, 2 ** -1000, 1)).toBe(2);
  });
});
