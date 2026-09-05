// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause), copyright Robin Stuart and
// contributors, and from KiCad. See NOTICE.md.
/**
 * The pieces of Zint's `backend/common.c` the five symbologies KiCad offers
 * actually use.
 *
 * KiCad does not implement any barcode encoder. `PCB_BARCODE::ComputeBarcode`
 * (`pcbnew/pcb_barcode.cpp:412-537`) creates a `zint_symbol`, sets its
 * `symbology` and `option_1`, and calls `ZBarcode_Encode` — the library is
 * vendored in KiCad's own tree at `thirdparty/zint`. So the faithful port of
 * that function is a port of Zint, the same way the rest of this repository is
 * a port of KiCad: the module pattern has to be Zint's, bit for bit, or a
 * board we save draws a different symbol from the one KiCad drew.
 *
 * Only what the five kinds need is here — Code 39, Code 128, Data Matrix, QR
 * and Micro QR. Zint supports around a hundred more.
 */

/**
 * `struct zint_symbol`, cut down to the fields the encoders read and write.
 *
 * `encoded_data` upstream is a `[row][byte]` bitmap addressed through
 * `set_module`/`module_is_set`; a boolean grid is the same thing without the
 * bit twiddling, and nothing here depends on the packing.
 */
export interface ZintSymbol {
  /** `symbol->rows`, grown by `expand()` and set outright by the 2D encoders. */
  rows: number;
  /** `symbol->width`, the module count across. */
  width: number;
  /** `symbol->encoded_data[row][col]`. */
  encoded: boolean[][];
  /** `symbol->row_height[row]`, in X (module) units. */
  rowHeight: number[];
  /** `symbol->option_1` — the ECC level, for QR and Micro QR. */
  option1: number;
  /**
   * `symbol->height`, the whole symbol's height in X units. The output stage
   * divides it among the rows whose own `rowHeight` is zero, which for a
   * linear symbology is all of them.
   */
  height: number;
  /** `symbol->errtxt`, the message `ComputeBarcode` copies into `m_lastError`. */
  errtxt: string;
}

export const newSymbol = (): ZintSymbol => ({
  rows: 0,
  width: 0,
  encoded: [],
  rowHeight: [],
  option1: -1,
  height: 0,
  errtxt: '',
});

/** `set_module( symbol, row, col )` (`common.h`). */
export function setModule(symbol: ZintSymbol, row: number, col: number): void {
  let r = symbol.encoded[row];
  if (!r) {
    r = [];
    symbol.encoded[row] = r;
  }
  r[col] = true;
}

/** `module_is_set( symbol, row, col )`. Out of range reads as clear. */
export const moduleIsSet = (symbol: ZintSymbol, row: number, col: number): boolean =>
  symbol.encoded[row]?.[col] === true;

/**
 * `expand( symbol, data, length )` (`common.c:211-237`).
 *
 * The linear encoders build a string of bar/space *widths* — `"1112212111…"`,
 * one digit per element — and this paints it into the module grid, starting
 * with a bar and alternating. `symbol->width` is the running maximum rather
 * than an assignment, because a stacked symbology calls this once per row.
 */
export function expand(symbol: ZintSymbol, data: string): void {
  let writer = 0;
  let latch = true;
  const row = symbol.rows;

  symbol.rows++;

  for (const ch of data) {
    const num = ch.charCodeAt(0) - 0x30;
    for (let i = 0; i < num; i++) {
      if (latch) setModule(symbol, row, writer);
      writer++;
    }
    latch = !latch;
  }

  if (writer > symbol.width) symbol.width = writer;
}

/**
 * `set_height( symbol, min_row_height, default_height, max_height, no_errtxt )`
 * (`common.c:1056-1110`), reduced to the branch `ComputeBarcode` reaches.
 *
 * The surprise is that it does NOT write `row_height[]` — it only totals the
 * rows that already have a height and puts the result in `symbol->height`.
 * A linear symbol leaves every `row_height` at zero, and the output stage
 * shares `symbol->height` out over them (`out_large_bar_height`,
 * `output.c:822-848`). Verified against the probe: Code 39 and Code 128 both
 * come back `height 50`, `heights 0`.
 *
 * `symbol->height` is left at 0 by `ComputeBarcode` and `COMPLIANT_HEIGHT` is
 * never in its `output_options`, so the call is always
 * `set_height( symbol, 0, 50, 0, 1 )` — a flat 50 X units.
 */
export function setHeight(symbol: ZintSymbol, defaultHeight: number): void {
  const rows = symbol.rows ? symbol.rows : 1; // "Sometimes called before expand()"
  let fixedHeight = 0;
  let zeroCount = 0;

  for (let i = 0; i < rows; i++) {
    if (symbol.rowHeight[i]) fixedHeight += symbol.rowHeight[i]!;
    else zeroCount++;
  }

  if (!zeroCount) {
    symbol.height = fixedHeight; // "Ignore any given height"
    return;
  }

  let rowHeight = defaultHeight ? defaultHeight / zeroCount : 0;
  if (rowHeight < 0.5) rowHeight = 0.5; // "Absolute minimum"

  symbol.height = rowHeight * zeroCount + fixedHeight;
}

/**
 * `not_sane_lookup( test_string, test_length, source, length, posns )`
 * (`common.c`): 0 when every character of `source` is in `test`, otherwise the
 * ONE-BASED position of the first that is not. `posns` receives each
 * character's index in `test`, which is what the encoders actually consume.
 */
export function notSaneLookup(
  test: string,
  testLength: number,
  source: string,
  posns: number[],
): number {
  for (let i = 0; i < source.length; i++) {
    const p = test.slice(0, testLength).indexOf(source[i]!);
    if (p < 0) return i + 1;
    posns[i] = p;
  }
  return 0;
}
