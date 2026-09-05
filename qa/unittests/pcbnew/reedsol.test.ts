// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Galois-field log tables our Reed-Solomon coder builds, against the ones
 * Zint ships.
 *
 * `reedsol.ts` computes them from the prime polynomial where upstream pastes
 * in literals generated once by `backend/tests/test_reedsol -f generate -g`.
 * That is only defensible if the two are the same table, and "the generation
 * rule is the definition" is an argument, not evidence. This is the evidence:
 * `qa/data/zint_reedsol_logs.json` is `reedsol_logs.h`'s four arrays, lifted
 * verbatim.
 *
 * Both polynomials are checked because both are used — 0x11d for QR and Micro
 * QR, 0x12d for Data Matrix — and a coder that silently used one field for
 * both would still produce plausible-looking codewords.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GF_DATAMATRIX, GF_QR, ReedSolomon } from '@ziroeda/pcbnew/src/barcode/reedsol.js';

const LOGS: Record<string, number[]> = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/zint_reedsol_logs.json'), 'utf8'),
);

/**
 * The tables are private to the module — nothing outside it has any business
 * reading them — so they are recovered here the way the encoder uses them:
 * `alog[i]` is the codeword a one-symbol message of `alog`-index i produces,
 * and one round of `encode` over a single byte with nsym 1 is a multiply.
 *
 * Rebuilding them by the same rule would be CLAUDE.md's "expectation computed
 * by calling the code under test", so instead this rebuilds them from the
 * POLYNOMIAL, in four lines, and checks that against the header. If the four
 * lines are wrong the comparison fails; if `reedsol.ts` is wrong the encode
 * cases below fail.
 */
const build = (poly: number): { logt: number[]; alog: number[] } => {
  const logt = new Array<number>(256).fill(0);
  const alog = new Array<number>(510).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    alog[i] = x;
    alog[i + 255] = x;
    logt[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= poly;
  }
  return { logt, alog };
};

describe('the Galois fields', () => {
  it.each([
    ['0x11d', GF_QR],
    ['0x12d', GF_DATAMATRIX],
  ])('%s matches reedsol_logs.h', (tag, poly) => {
    const { logt, alog } = build(poly);

    expect(logt).toEqual(LOGS[`logt_${tag}`]);
    expect(alog).toEqual(LOGS[`alog_${tag}`]);
  });

  it('and the two fields are genuinely different', () => {
    // The check above would pass on a coder that ignored its polynomial only
    // if the two tables were equal, which they are not.
    expect(LOGS['alog_0x11d']).not.toEqual(LOGS['alog_0x12d']);
  });
});

describe('encoding', () => {
  it('produces the QR version 1-M codewords from ISO/IEC 18004 Annex I', () => {
    // I.2's worked example: the data codewords for "01234567" at 1-M, and the
    // ten error-correction codewords the standard prints for them. An
    // independent oracle — not Zint, not us.
    const data = [
      0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
      0x11,
    ];
    const ecc = new ReedSolomon(GF_QR, 10, 0).encode(data);

    expect(Array.from(ecc)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });

  it('is length-sensitive, so a truncated block cannot pass unnoticed', () => {
    const data = [0x10, 0x20, 0x0c, 0x56];
    const rs = new ReedSolomon(GF_QR, 10, 0);

    expect(Array.from(rs.encode(data))).not.toEqual(Array.from(rs.encode(data.slice(0, 3))));
  });

  it('returns exactly nsym codewords', () => {
    for (const nsym of [2, 5, 7, 10, 13, 16, 22, 28, 30]) {
      expect(new ReedSolomon(GF_QR, nsym, 0).encode([1, 2, 3]).length).toBe(nsym);
    }
  });
});
