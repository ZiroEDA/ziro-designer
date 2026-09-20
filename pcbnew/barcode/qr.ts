// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause), copyright Robin Stuart and
// contributors, and from Project Nayuki's QR generator (MIT). See NOTICE.md.
/**
 * QR Code, from Zint's `backend/qr.c`.
 *
 * ISO/IEC 18004:2015. Four encoding modes with different densities, forty
 * symbol versions, four error-correction levels and eight data masks — and
 * almost all of the code is choosing between them rather than encoding.
 *
 * The mode choice is a dynamic program adapted from Project Nayuki, run once
 * per candidate version because the character-count indicator widens with
 * version and can change which mode is cheapest. The mask choice is a
 * brute-force score over all eight, by ISO's four penalty rules.
 *
 * What `PCB_BARCODE::ComputeBarcode` cannot reach is left out: GS1 mode,
 * Structured Append, `FAST_MODE`, a user-chosen mask or version, multiple
 * segments, and Kanji mode — which needs `ZINT_FULL_MULTIBYTE` in `option_3`
 * to produce a code point above 0xFF, and nothing here sets it.
 */
import { setModule, type ZintSymbol } from './common.js';
import { GF_QR, ReedSolomon } from './reedsol.js';
import {
  QR_ALIGN_LOOPSIZE,
  QR_ALPHANUMERIC,
  QR_ANNEX_C,
  QR_ANNEX_D,
  QR_BLOCKS,
  QR_DATA_CODEWORDS,
  QR_SIZES,
  QR_TABLE_E1,
  QR_TOTAL_CODEWORDS,
} from './qr_tables.js';

/**
 * `MICROQR_VERSION` (`qr.c:53`). Zint packs the symbology into the version
 * number so that one set of helpers serves QR, rMQR and Micro QR: 1-40 is QR,
 * 41-72 is rMQR (not ported), and 73-76 is Micro QR M1-M4. Every
 * version-dependent helper below switches on that, exactly as upstream does.
 */
export const MICROQR_VERSION = 73;

/** `QR_LEVEL_L` … `QR_LEVEL_H` — the index into the per-level tables. */
export const QR_LEVEL_L = 0;
export const QR_LEVEL_M = 1;
export const QR_LEVEL_Q = 2;
const QR_LEVEL_H = 3;

/** Indexes into the mode arrays; `qr_mode_types` is "NABK" in this order. */
const QR_N = 0;
const QR_A = 1;
const QR_B = 2;
const QR_K = 3;
const NUM_MODES = 4;
const MODE_TYPES = 'NABK';

/**
 * `QR_MULT` (`qr.c:129`): costs are held in sixths of a bit so that the
 * fractional per-character costs — 10/3 bits for a numeric run, 11/2 for an
 * alphanumeric pair — stay integers.
 */
const QR_MULT = 6;

/**
 * `QR_MICROQR_MAX` (`qr.c:176`): the cost given to a mode M1 or M2 cannot use,
 * chosen as "(128 + 1) * QR_MULT" — one more bit than M4-L's whole capacity —
 * so the minimisation can never pick it and no separate validity flag is needed.
 */
const MICROQR_MAX = 774;

/** `QR_ALPHA` (`common.h`), the alphanumeric mode's own character set. */
const QR_ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
export const isAlpha = (c: number): boolean => QR_ALPHA.includes(String.fromCharCode(c));

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

/** Mutable state threaded through the two `qr_in_*` probes. */
interface ModeState {
  numericEnd: number;
  numericCost: number;
  alphaEnd: number;
  alphaCost: number;
}

/**
 * `qr_in_numeric(…)` (`qr.c:71-94`). Numeric mode packs three digits into ten
 * bits, so a run of three costs 10/3 bits each, a pair 7/2 and a single 4 —
 * which is the whole reason costs are multiplied by six.
 */
function inNumeric(ddata: readonly number[], length: number, posn: number, st: ModeState): boolean {
  if (posn < st.numericEnd) return true;

  let i = posn;
  while (i < length && i < posn + 3 && isDigit(ddata[i]!)) i++;

  const digitCnt = i - posn;
  if (digitCnt === 0) {
    st.numericEnd = 0;
    return false;
  }

  st.numericEnd = i;
  st.numericCost = digitCnt === 1 ? 24 : digitCnt === 2 ? 21 : 20;
  return true;
}

/**
 * `qr_in_alpha(…)` (`qr.c:98-160`), with the GS1 percent-doubling arms gone —
 * they only run in GS1 mode. Alphanumeric packs two characters into eleven
 * bits, so a pair costs 11/2 each and a lone trailing character 6.
 */
function inAlpha(ddata: readonly number[], length: number, posn: number, st: ModeState): boolean {
  const last = posn + 1 === length;

  if (posn < st.alphaEnd) {
    st.alphaCost = !last ? 33 : 36;
    return true;
  }

  if (!isAlpha(ddata[posn]!)) {
    st.alphaEnd = 0;
    return false;
  }

  const twoAlphas = !last && isAlpha(ddata[posn + 1]!);
  st.alphaEnd = twoAlphas ? posn + 2 : posn + 1;
  st.alphaCost = twoAlphas ? 33 : 36;
  return true;
}

/**
 * `qr_head_costs(…)` (`qr.c:179-216`), QR arm only: the cost of *starting* a
 * segment in each mode, which is the mode indicator plus the character-count
 * indicator and so depends on the version band.
 */
function headCosts(version: number): number[] {
  const rows = [
    [(10 + 4) * QR_MULT, (9 + 4) * QR_MULT, (8 + 4) * QR_MULT, (8 + 4) * QR_MULT],
    [(12 + 4) * QR_MULT, (11 + 4) * QR_MULT, (16 + 4) * QR_MULT, (10 + 4) * QR_MULT],
    [(14 + 4) * QR_MULT, (13 + 4) * QR_MULT, (16 + 4) * QR_MULT, (12 + 4) * QR_MULT],
    [3 * QR_MULT, MICROQR_MAX, MICROQR_MAX, MICROQR_MAX], // M1
    [(4 + 1) * QR_MULT, (3 + 1) * QR_MULT, MICROQR_MAX, MICROQR_MAX], // M2
    [(5 + 2) * QR_MULT, (4 + 2) * QR_MULT, (4 + 2) * QR_MULT, (3 + 2) * QR_MULT], // M3
    [(6 + 3) * QR_MULT, (5 + 3) * QR_MULT, (5 + 3) * QR_MULT, (4 + 3) * QR_MULT], // M4
  ];
  if (version >= MICROQR_VERSION) return [...rows[3 + (version - MICROQR_VERSION)]!];
  return [...rows[version < 10 ? 0 : version < 27 ? 1 : 2]!];
}

/**
 * `qr_define_mode(…)` (`qr.c:218-336`) — "Adapted from Project Nayuki".
 *
 * `charModes[i][j]` is the mode that encodes code point `i` when the segment
 * containing it ends in mode `j` and the total is minimal; tracing that
 * backwards from the cheapest ending mode gives the optimal assignment.
 *
 * Switching mid-string costs a fresh header, which is why the switch cost and
 * the head cost are the same number.
 */
export function defineMode(
  mode: string[],
  ddata: readonly number[],
  length: number,
  version: number,
): void {
  const st: ModeState = { numericEnd: 0, numericCost: 0, alphaEnd: 0, alphaCost: 0 };
  const head = headCosts(version);
  const charModes: string[][] = Array.from({ length }, () => new Array<string>(NUM_MODES).fill(''));

  let prevCosts = [...head];

  for (let i = 0; i < length; i++) {
    const curCosts = new Array<number>(NUM_MODES).fill(0);

    // M1 holds digits only and M2 adds alphanumeric; byte mode starts at M3.
    const m1 = version === MICROQR_VERSION;
    const m2 = version === MICROQR_VERSION + 1;

    // Kanji is unreachable without ZINT_FULL_MULTIBYTE — nothing here produces
    // a code point above 0xFF — so the `ddata[i] > 0xFF` arm is gone and QR_K
    // is simply never given a mode.
    if (inNumeric(ddata, length, i, st)) {
      curCosts[QR_N] = prevCosts[QR_N]! + st.numericCost;
      charModes[i]![QR_N] = 'N';
    }
    if (inAlpha(ddata, length, i, st)) {
      curCosts[QR_A] = prevCosts[QR_A]! + (m1 ? MICROQR_MAX : st.alphaCost);
      charModes[i]![QR_A] = 'A';
    }
    curCosts[QR_B] = prevCosts[QR_B]! + (m1 || m2 ? MICROQR_MAX : 48); // 8 * QR_MULT
    charModes[i]![QR_B] = 'B';

    // "Start new segment at the end to switch modes."
    for (let j = 0; j < NUM_MODES; j++) {
      for (let k = 0; k < NUM_MODES; k++) {
        if (j !== k && charModes[i]![k]) {
          const newCost = curCosts[k]! + head[j]!;
          if (!charModes[i]![j] || newCost < curCosts[j]!) {
            curCosts[j] = newCost;
            charModes[i]![j] = MODE_TYPES[k]!;
          }
        }
      }
    }

    prevCosts = curCosts;
  }

  // "Find optimal ending mode."
  let minCost = prevCosts[0]!;
  let curMode = MODE_TYPES[0]!;
  for (let i = 1; i < NUM_MODES; i++) {
    if (prevCosts[i]! < minCost) {
      minCost = prevCosts[i]!;
      curMode = MODE_TYPES[i]!;
    }
  }

  // "Get optimal mode for each code point by tracing backwards."
  for (let i = length - 1; i >= 0; i--) {
    curMode = charModes[i]![MODE_TYPES.indexOf(curMode)]!;
    mode[i] = curMode;
  }
}

/** `qr_mode_indicator(…)` (`qr.c:341-362`). QR is N=1, A=2, B=4, K=8. */
function modeIndicator(version: number, m: string): number {
  const rows = [
    [1, 2, 4, 8], // QR
    [0, 0, 0, 0], // M1
    [0, 1, 0, 0], // M2
    [0, 1, 2, 3], // M3
    [0, 1, 2, 3], // M4
  ];
  const row = version >= MICROQR_VERSION ? 1 + (version - MICROQR_VERSION) : 0;
  return rows[row]![MODE_TYPES.indexOf(m)]!;
}

/**
 * `qr_mode_bits(…)` (`qr.c:364-373`): four for QR, and for Micro QR the
 * version index itself — so M1 writes NO mode indicator at all, which is why
 * it can only ever be numeric.
 */
const modeBits = (version: number): number =>
  version >= MICROQR_VERSION ? version - MICROQR_VERSION : 4;

/** `qr_terminator_bits(…)` (`qr.c:407-416`). */
const terminatorBits = (version: number): number =>
  version >= MICROQR_VERSION ? 3 + (version - MICROQR_VERSION) * 2 : 4;

/** `qr_cci_bits(…)` (`qr.c:375-405`). */
function cciBits(version: number, m: string): number {
  const rows = [
    [10, 9, 8, 8],
    [12, 11, 16, 10],
    [14, 13, 16, 12],
    [3, 0, 0, 0], // M1
    [4, 3, 0, 0], // M2
    [5, 4, 4, 3], // M3
    [6, 5, 5, 4], // M4
  ];
  if (version >= MICROQR_VERSION)
    return rows[3 + (version - MICROQR_VERSION)]![MODE_TYPES.indexOf(m)]!;
  return rows[version < 10 ? 0 : version < 27 ? 1 : 2]![MODE_TYPES.indexOf(m)]!;
}

// ---------------------------------------------------------------------------
// Bit stream
// ---------------------------------------------------------------------------

/** `bin_append_posn( value, bits, binary, bp )` (`common.c`). */
export function binAppend(binary: number[], value: number, bits: number): void {
  for (let i = bits - 1; i >= 0; i--) binary.push((value >> i) & 1);
}

/**
 * `qr_binary(…)` (`qr.c:418-672`), with the GS1 and Kanji arms removed.
 *
 * `mode` has already assigned every code point a mode, so this walks runs of
 * equal mode, writes each run's header, and encodes its characters.
 */
function qrBinary(
  binary: number[],
  version: number,
  mode: readonly string[],
  ddata: readonly number[],
  length: number,
  eci: number,
): void {
  if (eci !== 0) {
    binAppend(binary, 7, 4); // ECI mode indicator (Table 4)
    if (eci <= 127) binAppend(binary, eci, 8);
    else if (eci <= 16383) binAppend(binary, 0x8000 + eci, 16);
    else binAppend(binary, 0xc00000 + eci, 24);
  }

  let position = 0;

  do {
    const dataBlock = mode[position]!;
    let blockLength = 0;
    do {
      blockLength++;
    } while (position + blockLength < length && mode[position + blockLength] === dataBlock);

    const mb = modeBits(version);
    if (mb) binAppend(binary, modeIndicator(version, dataBlock), mb);
    binAppend(binary, blockLength, cciBits(version, dataBlock));

    if (dataBlock === 'B') {
      for (let i = 0; i < blockLength; i++) binAppend(binary, ddata[position + i]!, 8);
    } else if (dataBlock === 'A') {
      let i = 0;
      while (i < blockLength) {
        const first = QR_ALPHANUMERIC[ddata[position + i]! - 32]!;
        i++;
        if (i < blockLength && mode[position + i] === 'A') {
          const second = QR_ALPHANUMERIC[ddata[position + i]! - 32]!;
          i++;
          binAppend(binary, first * 45 + second, 11);
        } else {
          binAppend(binary, first, 6);
        }
      }
    } else {
      // 'N'
      let i = 0;
      while (i < blockLength) {
        let prod = ddata[position + i]! - 0x30;
        let count = 1;
        if (i + 1 < blockLength && mode[position + i + 1] === 'N') {
          prod = prod * 10 + (ddata[position + i + 1]! - 0x30);
          count = 2;
          if (i + 2 < blockLength && mode[position + i + 2] === 'N') {
            prod = prod * 10 + (ddata[position + i + 2]! - 0x30);
            count = 3;
          }
        }
        binAppend(binary, prod, 1 + 3 * count);
        i += count;
      }
    }

    position += blockLength;
  } while (position < length);
}

/**
 * `qr_binary_segs(…)` (`qr.c:674-772`) for one segment: terminate, pad to a
 * byte, pack into codewords, then fill to `targetCodewords` with the
 * alternating 0xEC / 0x11 pad pattern ISO/IEC 18004 specifies.
 */
function qrBinarySegs(
  version: number,
  targetCodewords: number,
  mode: readonly string[],
  ddata: readonly number[],
  eci: number,
): Uint8Array {
  const binary: number[] = [];
  qrBinary(binary, version, mode, ddata, ddata.length, eci);

  // Terminator.
  let termbits = 8 - (binary.length % 8);
  if (termbits === 8) termbits = 0;
  let currentBytes = (binary.length + termbits) / 8;
  if (termbits || currentBytes < targetCodewords) {
    const maxTermbits = terminatorBits(version);
    termbits = termbits < maxTermbits && currentBytes === targetCodewords ? termbits : maxTermbits;
    binAppend(binary, 0, termbits);
  }

  // Padding bits, to reach a byte boundary.
  let padbits = 8 - (binary.length % 8);
  if (padbits === 8) padbits = 0;
  if (padbits) {
    currentBytes = (binary.length + padbits) / 8;
    binAppend(binary, 0, padbits);
  }

  const datastream = new Uint8Array(targetCodewords);
  for (let i = 0; i < currentBytes; i++) {
    let b = 0;
    for (let p = 0; p < 8; p++) if (binary[i * 8 + p]) b |= 0x80 >> p;
    datastream[i] = b;
  }

  // Pad codewords.
  let toggle = 0;
  for (let i = currentBytes; i < targetCodewords; i++) {
    datastream[i] = toggle === 0 ? 0xec : 0x11;
    toggle ^= 1;
  }

  return datastream;
}

/**
 * The bit stream before terminating and padding — `qr_binary_segs`'s early
 * return for Micro QR (`qr.c:711-715`), which "does its own terminating and
 * padding" in `microqr_end`.
 */
export function qrBinaryBits(
  version: number,
  mode: readonly string[],
  ddata: readonly number[],
): number[] {
  const binary: number[] = [];
  qrBinary(binary, version, mode, ddata, ddata.length, 0);
  return binary;
}

/**
 * `qr_add_ecc(…)` (`qr.c:776-878`): split into blocks, Reed-Solomon each, then
 * interleave — data column-wise across the blocks, then the ECC likewise.
 *
 * The long blocks are the LAST ones and their extra codeword goes after every
 * short block's, which is why the `i >= qty_short_blocks` write is separate.
 */
function qrAddEcc(
  datastream: Uint8Array,
  version: number,
  dataCw: number,
  blocks: number,
): Uint8Array {
  const eccCw = QR_TOTAL_CODEWORDS[version - 1]! - dataCw;
  const shortDataBlockLength = Math.floor(dataCw / blocks);
  const qtyLongBlocks = dataCw % blocks;
  const qtyShortBlocks = blocks - qtyLongBlocks;
  const eccBlockLength = eccCw / blocks;

  const interleavedData = new Uint8Array(dataCw);
  const interleavedEcc = new Uint8Array(eccCw);
  // `rs_init_code( &rs, ecc_block_length, 0 )` — index 0 here, not the 1 that
  // Data Matrix uses.
  const rs = new ReedSolomon(GF_QR, eccBlockLength, 0);

  let inPosn = 0;

  for (let i = 0; i < blocks; i++) {
    const lengthThisBlock = i < qtyShortBlocks ? shortDataBlockLength : shortDataBlockLength + 1;
    const dataBlock = datastream.subarray(inPosn, inPosn + lengthThisBlock);
    const eccBlock = rs.encode(dataBlock);

    for (let j = 0; j < shortDataBlockLength; j++) interleavedData[j * blocks + i] = dataBlock[j]!;

    if (i >= qtyShortBlocks)
      interleavedData[shortDataBlockLength * blocks + (i - qtyShortBlocks)] =
        dataBlock[shortDataBlockLength]!;

    for (let j = 0; j < eccBlockLength; j++) interleavedEcc[j * blocks + i] = eccBlock[j]!;

    inPosn += lengthThisBlock;
  }

  const fullstream = new Uint8Array(dataCw + eccCw);
  fullstream.set(interleavedData, 0);
  fullstream.set(interleavedEcc, dataCw);
  return fullstream;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
//
// The grid holds one byte per module, and the high nibble is what makes the
// rest of the algorithm work:
//
//   0x01  the module is dark
//   0x10  fixed pattern — never carries data, never masked
//   0x20  reserved for format or version information
//
// so `grid[i] & 0xf0` asks "is this module unavailable", and the mask step
// tests exactly that.

export function placeFinder(grid: Uint8Array, size: number, x: number, y: number): void {
  const finder = [0x7f, 0x41, 0x5d, 0x5d, 0x5d, 0x41, 0x7f];
  for (let xp = 0; xp < 7; xp++)
    for (let yp = 0; yp < 7; yp++)
      grid[(yp + y) * size + (xp + x)] = finder[yp]! & (0x40 >> xp) ? 0x11 : 0x10;
}

function placeAlign(grid: Uint8Array, size: number, cx: number, cy: number): void {
  const alignment = [0x1f, 0x11, 0x15, 0x11, 0x1f];
  const x = cx - 2;
  const y = cy - 2; // "Input values represent centre of pattern"
  for (let xp = 0; xp < 5; xp++)
    for (let yp = 0; yp < 5; yp++)
      grid[(yp + y) * size + (xp + x)] = alignment[yp]! & (0x10 >> xp) ? 0x11 : 0x10;
}

/** `qr_setup_grid(…)` (`qr.c:913-996`). */
function setupGrid(grid: Uint8Array, size: number, version: number): void {
  // Timing patterns.
  let toggle = true;
  for (let i = 0; i < size; i++) {
    grid[6 * size + i] = toggle ? 0x21 : 0x20;
    grid[i * size + 6] = toggle ? 0x21 : 0x20;
    toggle = !toggle;
  }

  placeFinder(grid, size, 0, 0);
  placeFinder(grid, size, 0, size - 7);
  placeFinder(grid, size, size - 7, 0);

  // Separators.
  for (let i = 0; i < 7; i++) {
    grid[7 * size + i] = 0x10;
    grid[i * size + 7] = 0x10;
    grid[7 * size + (size - 1 - i)] = 0x10;
    grid[i * size + (size - 8)] = 0x10;
    grid[(size - 8) * size + i] = 0x10;
    grid[(size - 1 - i) * size + 7] = 0x10;
  }
  grid[7 * size + 7] = 0x10;
  grid[7 * size + (size - 8)] = 0x10;
  grid[(size - 8) * size + 7] = 0x10;

  // Alignment patterns. Version 1 has none, and a coordinate pair that lands
  // on a finder is skipped by the `& 0x10` test rather than by a table.
  if (version !== 1) {
    const loopsize = QR_ALIGN_LOOPSIZE[version - 1]!;
    for (let x = 0; x < loopsize; x++) {
      for (let y = 0; y < loopsize; y++) {
        const xcoord = QR_TABLE_E1[(version - 2) * 7 + x]!;
        const ycoord = QR_TABLE_E1[(version - 2) * 7 + y]!;
        if (!(grid[ycoord * size + xcoord]! & 0x10)) placeAlign(grid, size, xcoord, ycoord);
      }
    }
  }

  // Reserve space for format information.
  for (let i = 0; i < 8; i++) {
    grid[8 * size + i]! |= 0x20;
    grid[i * size + 8]! |= 0x20;
    grid[8 * size + (size - 1 - i)] = 0x20;
    grid[(size - 1 - i) * size + 8] = 0x20;
  }
  grid[8 * size + 8]! |= 0x20;
  grid[(size - 1 - 7) * size + 8] = 0x21; // "Dark Module from Figure 25"

  // Reserve space for version information.
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      grid[(size - 9) * size + i] = 0x20;
      grid[(size - 10) * size + i] = 0x20;
      grid[(size - 11) * size + i] = 0x20;
      grid[i * size + (size - 9)] = 0x20;
      grid[i * size + (size - 10)] = 0x20;
      grid[i * size + (size - 11)] = 0x20;
    }
  }
}

/**
 * `qr_populate_grid(…)` (`qr.c:1007-1056`): the codeword bits snake up and
 * down the symbol in two-module-wide columns, right to left, skipping the
 * vertical timing pattern at column 6 and every module already claimed.
 */
function populateGrid(grid: Uint8Array, size: number, fullstream: Uint8Array, cw: number): void {
  const cwbit = (i: number): number => (fullstream[i >> 3]! & (0x80 >> (i & 7)) ? 1 : 0);

  const n = cw * 8;
  let direction = 1; // up
  let row = 0; // right hand side
  let y = size - 1;
  let i = 0;

  while (i < n) {
    let x = size - 2 - row * 2;
    const r = y * size;

    if (x < 6) x--; // skip over vertical timing pattern

    if (!(grid[r + x + 1]! & 0xf0)) grid[r + x + 1] = cwbit(i++);

    if (i < n && !(grid[r + x]! & 0xf0)) grid[r + x] = cwbit(i++);

    if (direction) {
      y--;
      if (y === -1) {
        row++;
        y = 0;
        direction = 0;
      }
    } else {
      y++;
      if (y === size) {
        row++;
        y = size - 1;
        direction = 1;
      }
    }
  }
}

/**
 * `qr_evaluate(…)` (`qr.c:1078-1288`), ISO/IEC 18004 section 7.8.3's four
 * penalty rules: runs of five or more, 2x2 blocks, the 1:1:3:1:1 finder-like
 * pattern with four light modules beside it, and the dark-module proportion.
 */
function evaluate(local: Uint8Array, size: number): number {
  let result = 0;

  // Test 1, vertical.
  for (let x = 0; x < size; x++) {
    let block = 0;
    let state = 0;
    for (let y = 0; y < size; y++) {
      if (local[y * size + x] === state) block++;
      else {
        if (block >= 5) result += block - 2;
        block = 1;
        state = local[y * size + x]!;
      }
    }
    if (block >= 5) result += block - 2;
  }

  // Test 1, horizontal — and the dark-module count for Test 4, taken here
  // because the loop is already walking every module.
  let darkMods = 0;
  for (let y = 0; y < size; y++) {
    const r = y * size;
    let block = 0;
    let state = 0;
    for (let x = 0; x < size; x++) {
      if (local[r + x] === state) block++;
      else {
        if (block >= 5) result += block - 2;
        block = 1;
        state = local[r + x]!;
      }
      if (state) darkMods++;
    }
    if (block >= 5) result += block - 2;
  }

  // Test 2: 2x2 blocks of one colour.
  for (let x = 0; x < size - 1; x++) {
    for (let y = 0; y < size - 1; y++) {
      const k = local[y * size + x];
      if (
        k === local[(y + 1) * size + x] &&
        k === local[y * size + x + 1] &&
        k === local[(y + 1) * size + x + 1]
      )
        result += 3;
    }
  }

  // Test 3, vertical: 1:1:3:1:1 with four light modules before or after.
  for (let x = 0; x < size; x++) {
    for (let y = 0; y <= size - 7; y++) {
      if (
        local[y * size + x] &&
        !local[(y + 1) * size + x] &&
        local[(y + 2) * size + x] &&
        local[(y + 3) * size + x] &&
        local[(y + 4) * size + x] &&
        !local[(y + 5) * size + x] &&
        local[(y + 6) * size + x]
      ) {
        let beforeCount = 0;
        for (let b = y - 1; b >= y - 4; b--) {
          if (b < 0) {
            beforeCount = 4; // "Count < edge as whitespace"
            break;
          }
          if (local[b * size + x]) break;
          beforeCount++;
        }
        if (beforeCount === 4) result += 40;
        else {
          let afterCount = 0;
          for (let a = y + 7; a <= y + 10; a++) {
            if (a >= size) {
              afterCount = 4;
              break;
            }
            if (local[a * size + x]) break;
            afterCount++;
          }
          if (afterCount === 4) result += 40;
        }
        y += 3; // "Skip to next possible match"
      }
    }
  }

  // Test 3, horizontal.
  for (let y = 0; y < size; y++) {
    const r = y * size;
    for (let x = 0; x <= size - 7; x++) {
      if (
        local[r + x] === 1 &&
        local[r + x + 1] === 0 &&
        local[r + x + 2] === 1 &&
        local[r + x + 3] === 1 &&
        local[r + x + 4] === 1 &&
        local[r + x + 5] === 0 &&
        local[r + x + 6] === 1
      ) {
        let beforeCount = 0;
        for (let b = x - 1; b >= x - 4; b--) {
          if (b < 0) {
            beforeCount = 4;
            break;
          }
          if (local[r + b]) break;
          beforeCount++;
        }
        if (beforeCount === 4) result += 40;
        else {
          let afterCount = 0;
          for (let a = x + 7; a <= x + 10; a++) {
            if (a >= size) {
              afterCount = 4;
              break;
            }
            if (local[r + a]) break;
            afterCount++;
          }
          if (afterCount === 4) result += 40;
        }
        x += 3;
      }
    }
  }

  // Test 4: how far the dark proportion is from 50%, in 5% steps.
  const percentage = (100 * darkMods) / (size * size);
  result += 10 * Math.trunc(Math.abs(percentage - 50) / 5);

  return result;
}

/** `qr_add_format_info(…)` (`qr.c:1290-1321`). */
function addFormatInfo(grid: Uint8Array, size: number, eccLevel: number, pattern: number): void {
  let format = pattern;
  if (eccLevel === QR_LEVEL_L) format |= 0x08;
  else if (eccLevel === QR_LEVEL_Q) format |= 0x18;
  else if (eccLevel === QR_LEVEL_H) format |= 0x10;

  const seq = QR_ANNEX_C[format]!;

  for (let i = 0; i < 6; i++) grid[i * size + 8]! |= (seq >> i) & 1;
  for (let i = 0; i < 8; i++) grid[8 * size + (size - i - 1)]! |= (seq >> i) & 1;
  for (let i = 0; i < 6; i++) grid[8 * size + (5 - i)]! |= (seq >> (i + 9)) & 1;
  for (let i = 0; i < 7; i++) grid[(size - 7 + i) * size + 8]! |= (seq >> (i + 8)) & 1;

  grid[7 * size + 8]! |= (seq >> 6) & 1;
  grid[8 * size + 8]! |= (seq >> 7) & 1;
  grid[8 * size + 7]! |= (seq >> 8) & 1;
}

/**
 * `qr_apply_bitmask(…)` (`qr.c:1324-1435`), without `FAST_MODE` or a
 * user-chosen mask: build all eight masks into the bits of one byte per
 * module, score each, keep the lowest.
 *
 * Ties go to the LOWER pattern number — `<`, not `<=` — and that matters: the
 * eight are often close and the wrong comparison silently picks a different
 * symbol from KiCad's for the same data.
 */
function applyBitmask(grid: Uint8Array, size: number, eccLevel: number): number {
  const sizeSquared = size * size;
  const mask = new Uint8Array(sizeSquared);
  const local = new Uint8Array(sizeSquared);

  for (let y = 0; y < size; y++) {
    const r = y * size;
    for (let x = 0; x < size; x++) {
      if (grid[r + x]! & 0xf0) continue; // "exclude areas not to be masked"
      let m = 0;
      if (((y + x) & 1) === 0) m |= 0x01;
      if ((y & 1) === 0) m |= 0x02;
      if (x % 3 === 0) m |= 0x04;
      if ((y + x) % 3 === 0) m |= 0x08;
      if (((Math.floor(y / 2) + Math.floor(x / 3)) & 1) === 0) m |= 0x10;
      if ((y * x) % 6 === 0) m |= 0x20; // "(y * x) % 2 + (y * x) % 3 == 0"
      if (((((y * x) & 1) + ((y * x) % 3)) & 1) === 0) m |= 0x40;
      if ((((y + x) & 1) + ((y * x) % 3)) % 2 === 0) m |= 0x80;
      mask[r + x] = m;
    }
  }

  const penalty = new Array<number>(8).fill(0);
  let bestPattern = 0;

  for (let pattern = 0; pattern < 8; pattern++) {
    const bit = 1 << pattern;
    for (let k = 0; k < sizeSquared; k++)
      local[k] = mask[k]! & bit ? grid[k]! ^ 0x01 : grid[k]! & 0x0f;

    addFormatInfo(local, size, eccLevel, pattern);
    penalty[pattern] = evaluate(local, size);

    if (penalty[pattern]! < penalty[bestPattern]!) bestPattern = pattern;
  }

  // Upstream reuses `local` when the best is pattern 7, because that is the
  // one still in the buffer. Same result, and the copy is cheap here.
  const bit = 1 << bestPattern;
  for (let k = 0; k < sizeSquared; k++) if (mask[k]! & bit) grid[k]! ^= 0x01;

  return bestPattern;
}

/** `qr_add_version_info(…)` (`qr.c:1443-1456`), for version 7 and up. */
function addVersionInfo(grid: Uint8Array, size: number, version: number): void {
  const versionData = QR_ANNEX_D[version - 7]!;
  for (let i = 0; i < 6; i++) {
    grid[(size - 11) * size + i]! |= (versionData >> (i * 3)) & 1;
    grid[(size - 10) * size + i]! |= (versionData >> (i * 3 + 1)) & 1;
    grid[(size - 9) * size + i]! |= (versionData >> (i * 3 + 2)) & 1;
    grid[i * size + (size - 11)]! |= (versionData >> (i * 3)) & 1;
    grid[i * size + (size - 10)]! |= (versionData >> (i * 3 + 1)) & 1;
    grid[i * size + (size - 9)]! |= (versionData >> (i * 3 + 2)) & 1;
  }
}

/** `qr_blockLength(…)` (`qr.c:1458-1471`). */
function blockLength(start: number, mode: readonly string[], length: number): number {
  const startMode = mode[start];
  let count = 0;
  do {
    count++;
  } while (start + count < length && mode[start + count] === startMode);
  return count;
}

/**
 * `qr_calc_binlen(…)` (`qr.c:1473-1557`): the exact bit length the chosen
 * modes will produce at this version. It re-runs `defineMode` first, because
 * the version changes the header widths and so the optimum.
 */
export function calcBinlen(
  version: number,
  mode: string[],
  ddata: readonly number[],
  length: number,
  eci: number,
): number {
  defineMode(mode, ddata, length, version);

  let count = 0;
  let currentMode = ' ';

  if (eci !== 0) {
    count += 4;
    if (eci <= 127) count += 8;
    else if (eci <= 16383) count += 16;
    else count += 24;
  }

  for (let i = 0; i < length; i++) {
    if (mode[i] === currentMode) continue;

    count += modeBits(version) + cciBits(version, mode[i]!);
    const bl = blockLength(i, mode, length);

    if (mode[i] === 'B') {
      count += bl * 8;
    } else if (mode[i] === 'A') {
      count += Math.floor(bl / 2) * 11 + (bl % 2 ? 6 : 0);
    } else {
      // 'N'
      const rem = bl % 3;
      count += Math.floor(bl / 3) * 10 + (rem === 1 ? 4 : rem === 2 ? 7 : 0);
    }

    currentMode = mode[i]!;
  }

  return count;
}

/**
 * `qrcode(…)` (`qr.c:1643-1884`) for one segment with no GS1, no Structured
 * Append, no user mask and no user version.
 *
 * `ddata` is code points: ISO 8859-1 values when `eci` is 0, and the raw UTF-8
 * bytes when it is 26 — which is exactly the choice `ComputeBarcode` makes
 * (`pcb_barcode.cpp:602-605`).
 *
 * Returns the error message, or the empty string.
 */
export function qrcode(
  symbol: ZintSymbol,
  ddata: readonly number[],
  eci: number,
  optionEcc: number,
): string {
  const length = ddata.length;
  const mode = new Array<string>(length).fill('');
  const prevMode = new Array<string>(length).fill('');

  let estBinlen = calcBinlen(40, mode, ddata, length, eci);

  let eccLevel = optionEcc >= 1 && optionEcc <= 4 ? optionEcc - 1 : QR_LEVEL_L;
  const maxCw = QR_DATA_CODEWORDS[eccLevel]![39]!;

  if (estBinlen > 8 * maxCw) {
    const need = Math.ceil(estBinlen / 8);
    return eccLevel === QR_LEVEL_L
      ? `Error 567: Input too long, requires ${need} codewords (maximum ${maxCw})`
      : `Error 561: Input too long for ECC level ${'LMQH'[eccLevel]}, requires ${need} codewords ` +
          `(maximum ${maxCw})`;
  }

  // The smallest version whose capacity covers the version-40 estimate…
  let autosize = 40;
  for (let i = 39; i >= 0; i--)
    if (8 * QR_DATA_CODEWORDS[eccLevel]![i]! >= estBinlen) autosize = i + 1;

  if (autosize !== 40) estBinlen = calcBinlen(autosize, mode, ddata, length, eci);

  // …then shrink while re-optimising, because a narrower character-count
  // indicator can free up enough bits to drop another version.
  let canShrink = true;
  while (canShrink) {
    if (autosize === 1) {
      canShrink = false;
    } else {
      const prevEstBinlen = estBinlen;
      prevMode.splice(0, length, ...mode);
      estBinlen = calcBinlen(autosize - 1, mode, ddata, length, eci);

      if (8 * QR_DATA_CODEWORDS[eccLevel]![autosize - 2]! < estBinlen) canShrink = false;

      if (canShrink) autosize--;
      else {
        estBinlen = prevEstBinlen;
        mode.splice(0, length, ...prevMode);
      }
    }
  }

  const version = autosize;

  // "Ensure maximum error correction capacity unless user-specified": a symbol
  // sized for L often has room for H at no extra cost, and Zint takes it.
  // `option_1` IS specified here — `ComputeBarcode` always sets it — so this
  // runs only when the requested level was overridden above.
  if (optionEcc - 1 !== eccLevel) {
    if (estBinlen <= QR_DATA_CODEWORDS[QR_LEVEL_H]![version - 1]! * 8) eccLevel = QR_LEVEL_H;
    else if (estBinlen <= QR_DATA_CODEWORDS[QR_LEVEL_Q]![version - 1]! * 8) eccLevel = QR_LEVEL_Q;
    else if (estBinlen <= QR_DATA_CODEWORDS[QR_LEVEL_M]![version - 1]! * 8) eccLevel = QR_LEVEL_M;
  }

  const targetCodewords = QR_DATA_CODEWORDS[eccLevel]![version - 1]!;
  const blocks = QR_BLOCKS[eccLevel]![version - 1]!;

  const datastream = qrBinarySegs(version, targetCodewords, mode, ddata, eci);
  const fullstream = qrAddEcc(datastream, version, targetCodewords, blocks);

  const size = QR_SIZES[version - 1]!;
  const grid = new Uint8Array(size * size);

  setupGrid(grid, size, version);
  populateGrid(grid, size, fullstream, QR_TOTAL_CODEWORDS[version - 1]!);

  if (version >= 7) addVersionInfo(grid, size, version);

  const bitmask = applyBitmask(grid, size, eccLevel);
  addFormatInfo(grid, size, eccLevel, bitmask);

  symbol.width = size;
  symbol.rows = size;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) if (grid[i * size + j]! & 0x01) setModule(symbol, i, j);
    symbol.rowHeight[i] = 1;
  }
  symbol.height = size;

  return '';
}
