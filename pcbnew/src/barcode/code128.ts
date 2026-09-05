// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause), copyright Robin Stuart and
// contributors. See NOTICE.md.
/**
 * Code 128, from Zint's `backend/code128.c`.
 *
 * ISO/IEC 15417:2007. Three code sets — A (control codes and upper case), B
 * (printable ASCII) and C (digit pairs, two per symbol character) — and the
 * encoder's real work is choosing when to switch between them, because the
 * cheapest choice at one character depends on every character after it.
 *
 * Zint solves that exactly, with divide-and-conquer plus memoisation over
 * (position, prior code set), and this is a transcription of it. An encoder
 * that made a *reasonable* greedy choice would still scan; it would simply not
 * be the symbol KiCad draws, and the whole point of the port is that it is.
 *
 * What is not here is what `PCB_BARCODE::ComputeBarcode` cannot reach:
 * `EXTRA_ESCAPE_MODE`'s manual code-set escapes, `READER_INIT`, GS1-128's FNC1
 * handling, CODE128AB, HIBC and the human-readable text (KiCad sets
 * `show_hrt = 0` and draws its own). With those gone, `manuals` and `fncs` are
 * all zero and `start_idx` is 0, so their branches collapse.
 */
import { expand, setHeight, type ZintSymbol } from './common.js';

/**
 * `C128Table` (`code128.c:47-...`), ISO/IEC 15417:2007 Table 1: six element
 * widths per symbol character, bar first. Index 106 is CODE16K's only, but it
 * is in the table upstream and the check-digit modulo can never reach it.
 */
const C128_TABLE: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '211133',
];

/** Code Set states (`code128.c:139-145`). 0 is "no code set yet". */
const A0 = 1;
const B0 = 2;
const A1 = 3;
const B1 = 4;
const C0 = 5;
const C1 = 6;
const STATES = 7;

/** `C128_A0B0`: an ASCII (rather than extended-ASCII) state. */
const isA0B0 = (cset: number): boolean => cset <= B0;
/** `C128_C0C1`: one of the two Code Set C states. */
const isC0C1 = (cset: number): boolean => cset >= C0;
/** `C128_A0A1`, "assuming !C": 1 for A, 0 for B. */
const isA = (cset: number): number => cset & 1;
/** `C128_AB`, "assuming !C": folds A1/B1 back onto A0/B0. */
const toAB = (cset: number): number => cset >> (cset > B0 ? 1 : 0);

/**
 * `c128_latch_seq` (`code128.c:151-160`) — the codewords that move from the
 * prior state (row) to the current one (column) — and `c128_latch_len`, their
 * lengths. 100 is CODE B / FNC4-in-A, 101 is CODE A / FNC4-in-B, 99 is CODE C.
 *
 * A `null` entry is upstream's `{0}`: unreachable, never indexed.
 */
const LATCH_SEQ: readonly (readonly (readonly number[])[])[] = [
  [],
  [[], [], [100], [101, 101], [100, 100, 100], [99], [101, 101, 99]], // A0
  [[], [101], [], [101, 101, 101], [100, 100], [99], [100, 100, 99]], // B0
  [[], [101, 101], [100, 100, 100], [], [100], [101, 101, 99], [99]], // A1
  [[], [101, 101, 101], [100, 100], [101], [], [100, 100, 99], [99]], // B1
  [[], [101], [100], [101, 101, 101], [100, 100, 100], [], []], // C0
  [[], [101, 101, 101], [100, 100, 100], [101], [100], [], []], // C1
];

/**
 * `c128_latch_len`. Not `LATCH_SEQ[a][b].length`: the C0<->C1 pair is 64 here
 * against an empty sequence, a deliberate poison value that makes the cost
 * function reject a transition it must never take (an extended-ASCII flag has
 * no meaning inside Code Set C, so the two states are the same place).
 */
const LATCH_LEN: readonly (readonly number[])[] = [
  [0],
  [0, 0, 1, 2, 3, 1, 3], // A0
  [0, 1, 0, 3, 2, 1, 3], // B0
  [0, 2, 3, 0, 1, 3, 1], // A1
  [0, 3, 2, 1, 0, 3, 1], // B1
  [0, 1, 1, 3, 3, 0, 64], // C0
  [0, 3, 3, 1, 1, 64, 0], // C1
];

/**
 * `c128_start_latch_seq[0]` and `c128_start_latch_len[0]` — the "Normal" row.
 * GS1_MODE and READER_INIT are the other two, and `ComputeBarcode` uses
 * neither. 103/104/105 are START A / START B / START C.
 */
const START_LATCH_SEQ: readonly (readonly number[])[] = [
  [],
  [103],
  [104],
  [103, 101, 101],
  [104, 100, 100],
  [105],
  [],
];
const START_LATCH_LEN: readonly number[] = [0, 1, 1, 3, 3, 1, 64];

const isDigit = (ch: number): boolean => ch >= 0x30 && ch <= 0x39;
const isAscii = (ch: number): boolean => ch <= 0x7f;

/**
 * `c128_cost_ab( cset, ch, p_mode )` (`code128.c:131-152`): what one character
 * costs in Code Set A or B, and which of SHIFT (0x10) and FNC4 (0x20) it needs.
 *
 * SHIFT borrows one character from the other set: A can reach the `>= 96`
 * range and B the `< 32` range for one character without latching. FNC4 does
 * the same for the top bit — the extended-ASCII states A1/B1 are "FNC4 is
 * currently latched", so a plain ASCII character costs an extra FNC4 there.
 */
function costAb(cset: number, ch: number, mode: { v: number }): number {
  const mask0x60 = ch & 0x60; // 0 for (ch & 0x7F) < 32, 0x60 for >= 96
  const ga = isA(cset);
  let cost = 1;

  // SHIFT: A and (ch & 0x7F) >= 96, or B and (ch & 0x7F) < 32.
  if ((ga && mask0x60 === 0x60) || (!ga && !mask0x60)) {
    cost++;
    mode.v |= 0x10;
  }

  // FNC4: if A0/B0 and extended ASCII, or A1/B1 and ASCII.
  if (isA0B0(cset) === !isAscii(ch)) {
    cost++;
    mode.v |= 0x20;
  }

  return cost;
}

/**
 * `c128_cost(…)` (`code128.c:154-219`): the cost of encoding from `i` onwards
 * given that we arrive in `priorCset`, memoised in `costs[i][priorCset]`.
 *
 * Zint credits the shape to Alex Geller's minimal encoder in zxing and BWIPP's
 * extended-ASCII handling. `modes[i][priorCset]` records the winning code set
 * in its low nibble and the SHIFT/FNC4 flags in its high one, which is what
 * the second pass reads back.
 */
function cost(
  source: readonly number[],
  length: number,
  i: number,
  priorCset: number,
  startIdx: number,
  priority: readonly number[],
  costs: Int16Array,
  modes: Int8Array,
): number {
  const ch = source[i]!;
  const latchLen = priorCset === 0 ? START_LATCH_LEN : LATCH_LEN[priorCset]!;
  // "Assumes source NUL-terminated": past the end reads as not a digit.
  const canC = isDigit(ch) && i + 1 < length && isDigit(source[i + 1]!);
  let minCost = 999999; // "Max possible cost less than 2 * 256"
  let minMode = 0;

  for (const cset of priority) {
    if (isC0C1(cset)) {
      if (canC) {
        let mode = priorCset;
        let c = 1;
        if (priorCset !== cset) {
          c += latchLen[cset]!;
          mode = cset;
        }
        if (i + 2 < length) {
          const memo = costs[(i + 2) * STATES + cset]!;
          c += memo
            ? memo
            : cost(source, length, i + 2, cset, 0, priority, costs, modes);
        }
        if (c < minCost) {
          minCost = c;
          minMode = mode;
        }
      }
    } else {
      const mode = { v: cset };
      let c = costAb(cset, ch, mode);
      if (priorCset !== cset) c += latchLen[cset]!;
      if (i + 1 < length) {
        const memo = costs[(i + 1) * STATES + cset]!;
        c += memo ? memo : cost(source, length, i + 1, cset, 0, priority, costs, modes);
      }
      if (c < minCost) {
        minCost = c;
        minMode = mode.v;
      }
    }
  }

  costs[i * STATES + priorCset] = minCost;
  modes[i * STATES + priorCset] = minMode;

  return minCost;
}

/**
 * `c128_set_values(…)` (`code128.c:227-297`): run the cost pass, then walk the
 * recorded modes forward emitting latches, shifts and codewords.
 */
function setValues(
  source: readonly number[],
  startIdx: number,
  priority: readonly number[],
): number[] | null {
  const length = source.length;
  const costs = new Int16Array(length * STATES);
  const modes = new Int8Array(length * STATES);
  const values: number[] = [];

  cost(source, length, 0, 0, startIdx, priority, costs, modes);

  // "Total minimal cost (glyph count)" — checked before emitting anything.
  if (costs[0]! > 102) return null;

  let cset = 0;
  for (let i = 0; i < length; i++) {
    const ch = source[i]!;
    const mode = modes[i * STATES + cset]!;
    const priorCset = cset;

    cset = mode & 0x0f;

    if (cset !== priorCset) {
      const seq = priorCset === 0 ? START_LATCH_SEQ[cset]! : LATCH_SEQ[priorCset]![cset]!;
      const len = priorCset === 0 ? START_LATCH_LEN[cset]! : LATCH_LEN[priorCset]![cset]!;
      for (let j = 0; j < len; j++) values.push(seq[j]!);
    }

    if (mode >= 0x30) {
      values.push(100 + isA(cset)); // FNC4
      values.push(98); // SHIFT
    } else if (mode >= 0x20) {
      values.push(100 + isA(cset)); // FNC4
    } else if (mode >= 0x10) {
      values.push(98); // SHIFT
    }

    if (isC0C1(cset)) {
      values.push((ch - 0x30) * 10 + source[++i]! - 0x30);
    } else {
      // (ch & 0x7F) < 32 ? (ch & 0x7F) + 64 : (ch & 0x7F) - 32
      values.push((ch & 0x7f) + 96 * (ch & 0x60 ? 0 : 1) - 32);
    }
  }

  return values;
}

/**
 * `c128_expand( symbol, values, glyph_count )` (`code128.c:299-341`): the
 * weighted modulo-103 check digit, then the fixed seven-element stop pattern.
 *
 * The first codeword's weight is 1, not 0 — `total_sum = values[0]` before the
 * loop that adds `values[i] * i`.
 */
function c128Expand(symbol: ZintSymbol, values: readonly number[]): void {
  let dest = C128_TABLE[values[0]!]!;
  let totalSum = values[0]!;

  for (let i = 1; i < values.length; i++) {
    dest += C128_TABLE[values[i]!]!;
    totalSum += values[i]! * i;
  }

  totalSum %= 103;
  dest += C128_TABLE[totalSum]!;
  dest += '2331112'; // Stop character

  expand(symbol, dest);
}

/**
 * `c128_set_priority(…)` (`code128.c:343-368`): the order the cost function
 * tries code sets in. It is a filter, not a preference — a state the data
 * cannot need is left out so the search never considers it — except that ties
 * are broken by this order, which is why C comes first and B before A.
 */
function setPriority(haveA: boolean, haveB: boolean, haveC: boolean, haveExt: boolean): number[] {
  const priority: number[] = [];
  if (haveC) priority.push(C0);
  if (haveB || !haveA) priority.push(B0);
  if (haveA) priority.push(A0);
  if (haveExt) {
    if (haveC) priority.push(C1);
    if (haveB || !haveA) priority.push(B1);
    if (haveA) priority.push(A1);
  }
  return priority;
}

/**
 * `code128( symbol, source, length )` (`code128.c:370-503`) for
 * `symbology == BARCODE_CODE128`.
 *
 * `source` is bytes, not characters: `ZBarcode_Encode` has already folded the
 * UTF-8 input down to ISO 8859-1, which is the only extended set Code 128 can
 * carry (through FNC4). Returns an error message, or the empty string.
 *
 * No `set_height` call, and that is upstream's: "ISO/IEC 15417:2007 leaves
 * dimensions/height as application specification".
 */
export function code128(symbol: ZintSymbol, source: readonly number[]): string {
  const length = source.length;

  if (length > 170) return `Input length ${length} too long (maximum 170)`;

  // "Classify data to detect which Code Set states are needed."
  let haveA = false;
  let haveB = false;
  let haveC = false;
  let haveExt = false;
  let digit = false;

  for (let i = 0; i < length; i++) {
    const ch = source[i]!;
    const mask0x60 = ch & 0x60;
    if (ch & 0x80) haveExt = true;
    if (!mask0x60) haveA = true;
    if (mask0x60 === 0x60) haveB = true;
    const prevDigit = digit;
    digit = isDigit(ch);
    if (prevDigit && digit) haveC = true;
  }

  const values = setValues(source, 0, setPriority(haveA, haveB, haveC, haveExt));

  if (!values)
    return 'Input too long, requires more than 102 symbol characters (maximum 102)';

  c128Expand(symbol, values);

  // `code128()` calls no `set_height` — "ISO/IEC 15417:2007 leaves
  // dimensions/height as application specification" (:484) — and `library.c`
  // applies the same 50 that Code 39 asks for outright. The probe confirms it:
  // both come back `height 50`.
  setHeight(symbol, 50);

  return '';
}
