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

// All five of `BARCODE_T`. This set exists so that a symbology that stops
// being ported cannot quietly drop out of the run.
const PORTED: ReadonlySet<string> = new Set(['code39', 'code128', 'qr', 'microqr', 'datamatrix']);

describe('every vector Zint gave us', () => {
  const cases = VECTORS.cases.filter((c) => PORTED.has(c.kind));

  it('covers all five of BARCODE_T, so a filter typo cannot empty this file', () => {
    expect(cases.length).toBeGreaterThan(400);
    expect(new Set(cases.map((c) => c.kind))).toEqual(PORTED);
    // …and that the error cases are actually exercised: they are a third of
    // Micro QR's, which has four small versions and rejects a lot.
    expect(cases.filter((c) => c.error).length).toBeGreaterThan(20);
  });

  it.each(
    cases.map((c) => [`${c.kind} ${c.ecc} ${JSON.stringify(c.text)}`, c] as const),
  )('%s', (_name, c) => {
    const { symbol, error } = encodeBarcode(c.kind, c.ecc, c.text);

    if (c.error) {
      // The message matters as much as the grid: `ComputeBarcode` copies
      // `symbol->errtxt` straight into `m_lastError`, and the dialog shows
      // it. Zint's own "Error <id>: " prefix comes from `error_tag`
      // (`library.c:277`), so it is part of what the user reads.
      expect(symbol).toBeNull();
      expect(error).toBe(c.error);
      return;
    }

    expect(error).toBe('');
    expect(symbol).not.toBeNull();
    expect(gridOf(c.kind, c.ecc, c.text)).toEqual(c.grid);
  });
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
    expect(error).toBe(
      'Error 324: Invalid character at position 2 in input (alphanumerics, space and "-.$/+%" only)',
    );
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

  it('encodes every kind BARCODE_T offers', () => {
    // The five arms of `ComputeBarcode`'s switch (`pcb_barcode.cpp:568-594`).
    // A kind that fell through to nothing would draw an empty barcode, and the
    // fixture above cannot catch that on its own — a missing arm would simply
    // stop producing cases to compare.
    for (const kind of ['code39', 'code128', 'datamatrix', 'qr', 'microqr'] as const) {
      const { symbol, error } = encodeBarcode(kind, 'L', 'ZIRO1');

      expect(error, kind).toBe('');
      expect(symbol, kind).not.toBeNull();
      expect(symbol!.width, kind).toBeGreaterThan(0);
    }
  });

  it('encodes nothing for empty text, and calls it no error', () => {
    // `if( text.empty() ) return;` (`pcb_barcode.cpp:600`) — before the encode
    // and after `m_lastError.clear()`, so a barcode with no text draws nothing
    // and reports nothing. A new one placed from the tool is in exactly that
    // state until the dialog is filled in.
    expect(encodeBarcode('qr', 'L', '')).toEqual({ symbol: null, error: '' });
  });
});

describe('the two-dimensional symbologies', () => {
  it('QR grows through the version table rather than stretching', () => {
    // ISO/IEC 18004 Table 1: version 1 is 21 modules, and each version adds
    // four. Nothing between those sizes exists, so a symbol whose side is not
    // 21 + 4n means the version search went wrong.
    for (const text of ['A', 'A'.repeat(50), 'A'.repeat(400), 'A'.repeat(1000)]) {
      const grid = gridOf('qr', 'L', text);
      expect(grid.length).toBe(grid[0]!.length);
      expect((grid.length - 21) % 4).toBe(0);
    }
  });

  it('QR puts a finder pattern in three corners and not the fourth', () => {
    // The one structural feature no amount of mask or data can move.
    const g = gridOf('qr', 'M', 'ZIROEDA');
    const n = g.length;
    const finderAt = (r: number, c: number): boolean =>
      g[r]!.slice(c, c + 7) === '1111111' && g[r + 6]!.slice(c, c + 7) === '1111111';

    expect(finderAt(0, 0)).toBe(true);
    expect(finderAt(0, n - 7)).toBe(true);
    expect(finderAt(n - 7, 0)).toBe(true);
    expect(finderAt(n - 7, n - 7)).toBe(false);
  });

  it('a higher ECC level costs capacity at the same version', () => {
    // The reason the level is a user choice at all. Same text, and H needs a
    // bigger symbol than L.
    const text = 'A'.repeat(120);

    expect(gridOf('qr', 'H', text).length).toBeGreaterThan(gridOf('qr', 'L', text).length);
  });

  it('Micro QR has one finder, and is 11, 13, 15 or 17 across', () => {
    // M1-M4 (`microqr_sizes`). The single finder is what makes it small: the
    // other three corners carry data.
    //
    // The four texts also pin the version restrictions: M1 is digits only, M2
    // adds alphanumeric, and lower case forces byte mode, which starts at M3.
    for (const [text, size] of [
      ['1', 11],
      ['123456', 13],
      ['hello', 15],
      ['abcdefghijkl', 17],
    ] as const) {
      const g = gridOf('microqr', 'L', text);
      expect(g.length).toBe(size);
      expect(g[0]!.slice(0, 7)).toBe('1111111');
    }
  });

  it('Micro QR refuses ECC level H, which QR accepts', () => {
    // `PCB_BARCODE`'s dialog offers the same four levels for both kinds, and
    // Micro QR has only three (`qr.c:2199-2201`). A user who picks H and
    // switches kind gets this, and it is Zint's own wording.
    expect(encodeBarcode('microqr', 'H', 'ZIRO').error).toBe(
      'Error 566: Error correction level H not available',
    );
    expect(encodeBarcode('qr', 'H', 'ZIRO').error).toBe('');
  });

  it('Micro QR takes 35 characters at most', () => {
    expect(encodeBarcode('microqr', 'L', '9'.repeat(35)).error).toBe('');
    expect(encodeBarcode('microqr', 'L', '9'.repeat(36)).error).toBe(
      'Error 562: Input length 36 too long (maximum 35)',
    );
  });

  it('QR declares UTF-8 through ECI where Micro QR cannot', () => {
    // `ComputeBarcode` sets `symbol->eci = ECI_UTF8` for QR and Data Matrix
    // only (`pcb_barcode.cpp:602-605`) — Micro QR has no ECI field at all.
    expect(encodeBarcode('qr', 'L', 'Ω unicode ✓').error).toBe('');
    expect(encodeBarcode('microqr', 'L', 'Ω').error).toContain(
      'does not support international characters',
    );
  });
});

describe('Data Matrix', () => {
  it('picks a size from ISO/IEC 16022 Table 7, square or oblong', () => {
    // Twenty-four sizes: 24 square from 10x10 to 144x144, and six oblong.
    // The oblong ones are the standard's, not DMRE — those are the other
    // twenty-four table entries and `ComputeBarcode` never asks for one
    // (`option_3` stays zero, so `dm_get_symbolsize` skips them).
    const STANDARD = new Set([
      '10x10',
      '12x12',
      '14x14',
      '16x16',
      '18x18',
      '20x20',
      '22x22',
      '24x24',
      '26x26',
      '32x32',
      '36x36',
      '40x40',
      '44x44',
      '48x48',
      '52x52',
      '64x64',
      '72x72',
      '80x80',
      '88x88',
      '96x96',
      '104x104',
      '120x120',
      '132x132',
      '144x144',
      '8x18',
      '8x32',
      '12x26',
      '12x36',
      '16x36',
      '16x48',
    ]);

    for (const text of ['A', 'A'.repeat(20), 'A'.repeat(100), 'A'.repeat(600)]) {
      const g = gridOf('datamatrix', 'L', text);

      expect(STANDARD, `${text.length} chars`).toContain(`${g.length}x${g[0]!.length}`);
    }
  });

  it('does use the oblong sizes, which is easy to get wrong by skipping them', () => {
    // 20 characters land on 12x26. A size search that filtered to squares —
    // Zint's `DM_SQUARE` option, which we must NOT set — would give 18x18
    // instead, and both scan, so only a differential test would notice.
    const g = gridOf('datamatrix', 'L', 'A'.repeat(20));

    expect([g.length, g[0]!.length]).toEqual([12, 26]);
  });

  it('draws the L-shaped finder: solid left and bottom, dashed top and right', () => {
    // The one feature no data can move, and the reason a Data Matrix scans in
    // any orientation.
    const g = gridOf('datamatrix', 'L', 'ZIROEDA');
    const n = g.length;

    expect(g.map((row) => row[0]).join('')).toBe('1'.repeat(n));
    expect(g[n - 1]).toBe('1'.repeat(g[0]!.length));
    expect(g[0]).toBe('10'.repeat(g[0]!.length / 2));
    expect(g.map((row) => row[g[0]!.length - 1]).join('')).toBe('01'.repeat(n / 2));
  });

  it('packs digit pairs into one codeword, as ASCII mode does', () => {
    // 30 digits fit a symbol that 30 letters do not: ASCII mode encodes a
    // digit pair in a single codeword and a letter in one each.
    expect(gridOf('datamatrix', 'L', '1'.repeat(30)).length).toBeLessThan(
      gridOf('datamatrix', 'L', 'Z'.repeat(30)).length,
    );
  });

  it('carries UTF-8 through ECI, like QR and unlike the rest', () => {
    expect(encodeBarcode('datamatrix', 'L', 'Ω unicode ✓').error).toBe('');
  });
});
