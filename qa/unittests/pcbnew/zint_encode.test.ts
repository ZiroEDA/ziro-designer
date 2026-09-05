// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Our Zint port against Zint itself.
 *
 * `PCB_BARCODE::ComputeBarcode` implements no encoder: it creates a
 * `zint_symbol`, sets `symbology` and `option_1`, and calls `ZBarcode_Encode`
 * on the copy of Zint vendored in KiCad's own tree
 * (`thirdparty/zint/backend`). So "what should our encoder produce" has one
 * correct answer and it is not a judgement call — it is whatever that library
 * produces, module for module.
 *
 * `qa/probes/zint_probe` links that library, sets the same four fields
 * `ComputeBarcode` sets, and prints the module grid; `qa/data/zint_vectors.json`
 * is its output. This compares ours against it.
 *
 * A published test vector would pin the SYMBOLOGY. It would not pin the
 * library's choices — Code 128's code-set switching is a minimisation with
 * ties, and two conforming encoders can disagree on a symbol that both scan.
 * Only the oracle pins the symbol KiCad actually draws.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeBarcode } from '@ziroeda/pcbnew/src/barcode/zint.js';
import type { BarcodeEcc, BarcodeKind } from '@ziroeda/pcbnew/src/types.js';

interface Case {
  kind: BarcodeKind;
  ecc: BarcodeEcc;
  text: string;
  rows?: number;
  width?: number;
  grid?: string[];
  error?: string;
}

const VECTORS: { cases: Case[] } = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/zint_vectors.json'), 'utf8'),
);

/** The grid as the probe prints it: one '0'/'1' line per row. */
const gridOf = (kind: BarcodeKind, ecc: BarcodeEcc, text: string): string[] => {
  const { symbol, error } = encodeBarcode(kind, ecc, text);
  expect(error, `unexpected encode error for ${kind} "${text}"`).toBe('');
  expect(symbol).not.toBeNull();
  const s = symbol!;
  return Array.from({ length: s.rows }, (_, r) =>
    Array.from({ length: s.width }, (_, i) => (s.encoded[r]?.[i] ? '1' : '0')).join(''),
  );
};

// Only the symbologies that are ported. The remaining three fall through
// `encodeBarcode`'s default arm and produce nothing, which would read as a
// silent pass here rather than as the gap it is.
const PORTED: ReadonlySet<string> = new Set(['code39', 'code128']);

describe('every vector Zint gave us', () => {
  const cases = VECTORS.cases.filter((c) => PORTED.has(c.kind));

  it('covers both ported symbologies, so a filter typo cannot empty this file', () => {
    expect(cases.length).toBeGreaterThan(10);
    expect(new Set(cases.map((c) => c.kind))).toEqual(new Set(['code39', 'code128']));
  });

  it.each(cases.map((c) => [`${c.kind} ${JSON.stringify(c.text)}`, c] as const))(
    '%s',
    (_name, c) => {
      expect(c.error, 'the probe itself failed on this case').toBeUndefined();
      expect(gridOf(c.kind, c.ecc, c.text)).toEqual(c.grid);
    },
  );
});

describe('the shape of the answer', () => {
  it('Code 39 brackets the data with the start/stop pattern', () => {
    // `C39Table[43]`, the `*` character, at both ends: ten elements at the
    // start and the same row's first nine at the stop (`code.c:153-172`). The
    // asymmetry is the trailing inter-character space, which a symbol that has
    // just ended does not need.
    //
    // Widths 1,2,1,1,2,1,2,1,1 from a bar are 12 modules — `100101101101` —
    // and the tenth element adds the one space that separates characters, so
    // the start is those 12 plus a `0`.
    const grid = gridOf('code39', 'L', 'A')[0]!;

    expect(grid.startsWith('1001011011010')).toBe(true);
    expect(grid.endsWith('100101101101')).toBe(true);
  });

  it('Code 39 folds lower case, because its alphabet has none', () => {
    // `to_upper( source, length )` (`code.c:147`): Zint folds rather than
    // rejecting, so "abc" and "ABC" are the same symbol.
    expect(gridOf('code39', 'L', 'abc')).toEqual(gridOf('code39', 'L', 'ABC'));
  });

  it('Code 39 rejects a character outside its alphabet', () => {
    const { symbol, error } = encodeBarcode('code39', 'L', 'A*B');

    expect(symbol).toBeNull();
    expect(error).toContain('Invalid character at position 2');
  });

  it('Code 128 packs digit pairs two to a symbol character', () => {
    // Code Set C is the whole reason the encoder has a cost function: ten
    // digits cost five symbol characters in C and ten in B. Each character is
    // eleven modules, so the saving is visible as a narrower symbol.
    const digits = gridOf('code128', 'L', '1234567890')[0]!;
    const letters = gridOf('code128', 'L', 'ABCDEFGHIJ')[0]!;

    expect(digits.length).toBeLessThan(letters.length);
    expect(letters.length - digits.length).toBe(5 * 11);
  });

  it('Code 128 carries Latin-1 through FNC4', () => {
    // The extended-ASCII states A1/B1. Nothing else in KiCad's five can do
    // this: Code 39 has no such character and would reject it.
    expect(() => gridOf('code128', 'L', 'éèê')).not.toThrow();
    expect(encodeBarcode('code39', 'L', 'éèê').error).toContain(
      'does not support international characters',
    );
  });

  it('refuses a code point Latin-1 cannot hold, with the message KiCad shows', () => {
    // `ComputeBarcode` replaces Zint's `errtxt` with this whenever the text is
    // not ASCII (`pcb_barcode.cpp:610-615`): "invalid character at position 3"
    // does not tell a user to switch symbology, and this does.
    const { symbol, error } = encodeBarcode('code128', 'L', '日本');

    expect(symbol).toBeNull();
    expect(error).toBe(
      'This barcode type does not support international characters. ' +
        'Use QR Code or Data Matrix instead.',
    );
  });

  it('encodes nothing for empty text, and calls it no error', () => {
    // `if( text.empty() ) return;` (`pcb_barcode.cpp:600`) — before the encode
    // and after `m_lastError.clear()`, so a barcode with no text draws nothing
    // and reports nothing. A new one placed from the tool is in exactly that
    // state until the dialog is filled in.
    expect(encodeBarcode('qr', 'L', '')).toEqual({ symbol: null, error: '' });
  });
});
