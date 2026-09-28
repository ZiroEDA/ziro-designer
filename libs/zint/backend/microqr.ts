// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause), copyright Robin Stuart and
// contributors. See NOTICE.md.
/**
 * Micro QR Code, from Zint's `backend/qr.c` (`microqr`, :2170-2394).
 *
 * ISO/IEC 18004:2015 section 7. Four versions M1-M4, one finder pattern
 * instead of three, and no version information — a much smaller symbol whose
 * cost is that each version restricts what it can hold: M1 is digits only and
 * writes no mode indicator at all, M2 adds alphanumeric, and byte mode starts
 * at M3.
 *
 * The mode-selection, bit-stream and grid-walk code is shared with QR and
 * lives in `qr.ts` — upstream shares it too, by packing the symbology into the
 * version number (`MICROQR_VERSION + version`). What is not shared is the
 * terminator and padding, the mask set (four, not eight) and how the mask is
 * chosen: Micro QR scores by how many dark modules land on the two outer edges
 * and takes the HIGHEST, where QR minimises a penalty.
 */
import { setModule, type ZintSymbol } from './common.js';
import { GF_QR, ReedSolomon } from './reedsol.js';
import { MICROQR_DATA, MICROQR_SIZES, QR_ANNEX_C1 } from './qr_tables.js';
import {
  MICROQR_VERSION,
  QR_LEVEL_L,
  QR_LEVEL_M,
  QR_LEVEL_Q,
  binAppend,
  calcBinlen,
  defineMode,
  isAlpha,
  isDigit,
  placeFinder,
  qrBinaryBits,
} from './qr.js';

/**
 * `microqr_end(…)` (`qr.c:1886-1974`): terminate, pad, pack and append the
 * Reed-Solomon codewords.
 *
 * `bits_end` is the catch. M1 and M3 end on a FOUR-bit codeword rather than a
 * byte (`version == 0 || version == 2`), so the last data codeword is half
 * width and the padding has to stop four bits early. Getting that wrong shifts
 * every ECC codeword.
 */
function microqrEnd(binary: number[], eccLevel: number, version: number): number[] {
  const terminatorBits = 3 + version * 2;
  const bitsTotal = MICROQR_DATA[eccLevel]![version]![0]!;
  const dataCodewords = MICROQR_DATA[eccLevel]![version]![1]!;
  const eccCodewords = MICROQR_DATA[eccLevel]![version]![2]!;
  const bitsEnd = version === 0 || version === 2 ? 4 : 8;

  let bitsLeft = bitsTotal - binary.length;

  if (bitsLeft <= terminatorBits) {
    if (bitsLeft) {
      binAppend(binary, 0, bitsLeft);
      bitsLeft = 0;
    }
  } else {
    binAppend(binary, 0, terminatorBits);
    bitsLeft -= terminatorBits;
  }

  // "Manage last (4-bit) block".
  if (bitsEnd === 4 && bitsLeft && bitsLeft <= 4) {
    binAppend(binary, 0, bitsLeft);
    bitsLeft = 0;
  }

  if (bitsLeft) {
    // Complete the current byte.
    let remainder = 8 - (binary.length % 8);
    if (remainder !== 8) {
      binAppend(binary, 0, remainder);
      bitsLeft -= remainder;
    }

    // Pad, leaving the half codeword for the versions that end on one.
    if (bitsEnd === 4 && bitsLeft > 4) bitsLeft -= 4;
    remainder = Math.floor(bitsLeft / 8);
    for (let i = 0; i < remainder; i++) binAppend(binary, i & 1 ? 0x11 : 0xec, 8);
    if (bitsEnd === 4) binAppend(binary, 0, 4);
  }

  const dataBlocks = new Uint8Array(dataCodewords);
  for (let i = 0; i < dataCodewords; i++) {
    const bits = i + 1 === dataCodewords ? bitsEnd : 8;
    let b = 0;
    for (let j = 0; j < bits; j++) if (binary[i * 8 + j]) b |= 0x80 >> j;
    dataBlocks[i] = b;
  }

  const eccBlocks = new ReedSolomon(GF_QR, eccCodewords, 0).encode(dataBlocks);
  for (let i = 0; i < eccCodewords; i++) binAppend(binary, eccBlocks[i]!, 8);

  return binary;
}

/** `microqr_setup_grid(…)` (`qr.c:1977-2010`). */
function setupGrid(grid: Uint8Array, size: number): void {
  // Timing patterns — along the top row and the left column, not through the
  // middle as in QR.
  let toggle = true;
  for (let i = 0; i < size; i++) {
    grid[i] = toggle ? 0x21 : 0x20;
    grid[i * size] = toggle ? 0x21 : 0x20;
    toggle = !toggle;
  }

  placeFinder(grid, size, 0, 0);

  for (let i = 0; i < 7; i++) {
    grid[7 * size + i] = 0x10;
    grid[i * size + 7] = 0x10;
  }
  grid[7 * size + 7] = 0x10;

  for (let i = 0; i < 8; i++) {
    grid[8 * size + i]! |= 0x20;
    grid[i * size + 8]! |= 0x20;
  }
  // Upstream writes `|= 20` here — decimal twenty, 0x14 — where every other
  // line of the function writes `0x20`. It is a typo, and it is harmless: the
  // module at (8, 8) is inside the format-information area that the two loops
  // above have already flagged 0x20, so the extra bits change nothing that is
  // read. Mirrored rather than corrected, because `grid[k] & 0xf0` is what the
  // mask step tests and 0x14 sets no bit there that 0x20 did not.
  grid[8 * size + 8]! |= 20;
}

/**
 * `microqr_populate_grid(…)` (`qr.c:2012-2061`): the same up-and-down snake as
 * QR, but with no vertical timing pattern to step over and the turn made at
 * row 1 rather than row 0 — the top row is the horizontal timing pattern.
 */
function populateGrid(grid: Uint8Array, size: number, binary: readonly number[]): void {
  const bp = binary.length;
  let direction = 1;
  let row = 0;
  let y = size - 1;
  let i = 0;

  do {
    const x = size - 2 - row * 2;

    if (!(grid[y * size + x + 1]! & 0xf0)) grid[y * size + x + 1] = binary[i++] ? 0x01 : 0x00;

    if (i < bp && !(grid[y * size + x]! & 0xf0)) grid[y * size + x] = binary[i++] ? 0x01 : 0x00;

    if (direction) y--;
    else y++;

    if (y === 0) {
      row++;
      y = 1;
      direction = 0;
    }
    if (y === size) {
      row++;
      y = size - 1;
      direction = 1;
    }
  } while (i < bp);
}

/**
 * `microqr_evaluate(…)` (`qr.c:2063-2091`): count the dark modules the mask
 * would leave on the right-hand column and the bottom row, and combine them
 * smaller-first into one number.
 *
 * Unlike QR's four penalty rules this is a SCORE, not a penalty — the caller
 * keeps the highest.
 */
function evaluate(evalGrid: Uint8Array, size: number, pattern: number): number {
  const filter = 1 << pattern;
  let sum1 = 0;
  let sum2 = 0;

  for (let i = 1; i < size; i++) {
    if (evalGrid[i * size + size - 1]! & filter) sum1++;
    if (evalGrid[(size - 1) * size + i]! & filter) sum2++;
  }

  return sum1 <= sum2 ? sum1 * 16 + sum2 : sum2 * 16 + sum1;
}

/** `microqr_apply_bitmask(…)` (`qr.c:2093-2168`): four masks, highest score wins. */
function applyBitmask(grid: Uint8Array, size: number): number {
  const sizeSquared = size * size;
  const mask = new Uint8Array(sizeSquared);
  const evalGrid = new Uint8Array(sizeSquared);

  for (let y = 0; y < size; y++) {
    const r = y * size;
    for (let x = 0; x < size; x++) {
      if (grid[r + x]! & 0xf0) continue;
      let m = 0;
      if ((y & 1) === 0) m |= 0x01;
      if (((Math.floor(y / 2) + Math.floor(x / 3)) & 1) === 0) m |= 0x02;
      if (((((y * x) & 1) + ((y * x) % 3)) & 1) === 0) m |= 0x04;
      if ((((y + x) & 1) + ((y * x) % 3)) % 2 === 0) m |= 0x08;
      mask[r + x] = m;
    }
  }

  for (let k = 0; k < sizeSquared; k++) evalGrid[k] = grid[k]! & 0x01 ? mask[k]! ^ 0xff : mask[k]!;

  let bestPattern = 0;
  const value = new Array<number>(4).fill(0);
  for (let pattern = 0; pattern < 4; pattern++) {
    value[pattern] = evaluate(evalGrid, size, pattern);
    if (value[pattern]! > value[bestPattern]!) bestPattern = pattern;
  }

  const bit = 1 << bestPattern;
  for (let k = 0; k < sizeSquared; k++) if (mask[k]! & bit) grid[k]! ^= 0x01;

  return bestPattern;
}

/**
 * `microqr( symbol, source, length )` (`qr.c:2170-2394`), for the options
 * `ComputeBarcode` sets: no user version, no user mask, no `DATA_MODE`.
 *
 * `ddata` is ISO 8859-1 code points. Upstream falls back to Shift JIS when the
 * text will not fit ISO 8859-1 — Micro QR carries no ECI, so there is nowhere
 * to declare UTF-8 — and that conversion table is not ported; `zint.ts` turns
 * such input into KiCad's own "does not support international characters"
 * message rather than encoding something different from what KiCad would draw.
 */
export function microqr(symbol: ZintSymbol, ddata: readonly number[], optionEcc: number): string {
  const length = ddata.length;

  if (length > 35) return `Error 562: Input length ${length} too long (maximum 35)`;

  let eccLevel = QR_LEVEL_L;
  if (optionEcc >= 1 && optionEcc <= 4) {
    // `PCB_BARCODE` offers H in its dropdown for both QR kinds; Micro QR has
    // no H at all (`qr.c:2199-2201`), and this is the message KiCad shows.
    if (optionEcc === 4) return 'Error 566: Error correction level H not available';
    eccLevel = optionEcc - 1;
  }

  // "Determine if alpha (excluding numerics), byte or kanji used".
  let alphaUsed = false;
  let byteUsed = false;
  for (let i = 0; i < length; i++) {
    if (isDigit(ddata[i]!)) continue;
    if (isAlpha(ddata[i]!)) alphaUsed = true;
    else byteUsed = true;
  }

  const versionValid = [true, true, true, true];

  // Eliminate versions by content…
  if (byteUsed) {
    versionValid[0] = false;
    versionValid[1] = false;
  } else if (alphaUsed) {
    versionValid[0] = false;
  }

  // …and by requested error-correction level.
  if (eccLevel === QR_LEVEL_Q) {
    versionValid[0] = false;
    versionValid[1] = false;
    versionValid[2] = false;
  } else if (eccLevel === QR_LEVEL_M) {
    versionValid[0] = false;
  }

  const mode = new Array<string>(length).fill('');
  const binaryCount = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    binaryCount[i] = versionValid[i]
      ? calcBinlen(MICROQR_VERSION + i, mode, ddata, length, 0)
      : 129; // "128 + 1", one past M4-L's capacity
  }

  if (binaryCount[3]! > MICROQR_DATA[eccLevel]![3]![0]!) {
    const need = Math.ceil(binaryCount[3]! / 8);
    return (
      `Error 565: Input too long for Version M4-${'LMQH'[eccLevel]}, requires ${need} codewords ` +
      `(maximum ${MICROQR_DATA[eccLevel]![3]![1]})`
    );
  }
  for (let i = 0; i < 3; i++)
    if (binaryCount[i]! > MICROQR_DATA[eccLevel]![i]![0]!) versionValid[i] = false;

  // "Auto-select lowest valid size".
  let version = 3;
  if (versionValid[2]) version = 2;
  if (versionValid[1]) version = 1;
  if (versionValid[0]) version = 0;

  // "If there is enough unused space then increase the error correction
  // level, unless user-specified." M1 (version 0) is excluded — it has no
  // level to raise to.
  if (version && optionEcc - 1 !== eccLevel) {
    if (binaryCount[version]! <= MICROQR_DATA[QR_LEVEL_Q]![version]![0]!) eccLevel = QR_LEVEL_Q;
    else if (binaryCount[version]! <= MICROQR_DATA[QR_LEVEL_M]![version]![0]!)
      eccLevel = QR_LEVEL_M;
  }

  defineMode(mode, ddata, length, MICROQR_VERSION + version);

  const binary = microqrEnd(
    qrBinaryBits(MICROQR_VERSION + version, mode, ddata),
    eccLevel,
    version,
  );

  const size = MICROQR_SIZES[version]!;
  const grid = new Uint8Array(size * size);

  setupGrid(grid, size);
  populateGrid(grid, size, binary);
  const bitmask = applyBitmask(grid, size);

  // Format data: M1 is 0, and every later version contributes two entries per
  // available level (`qr.c:2378`).
  const format = version ? (version - 1) * 2 + eccLevel + 1 : 0;
  const formatFull = QR_ANNEX_C1[(format << 2) + bitmask]!;

  for (let i = 1; i <= 8; i++) grid[8 * size + i]! |= (formatFull >> (15 - i)) & 1;
  for (let i = 7; i >= 1; i--) grid[i * size + 8]! |= (formatFull >> (i - 1)) & 1;

  symbol.width = size;
  symbol.rows = size;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) if (grid[i * size + j]! & 0x01) setModule(symbol, i, j);
    symbol.rowHeight[i] = 1;
  }
  symbol.height = size;

  return '';
}
