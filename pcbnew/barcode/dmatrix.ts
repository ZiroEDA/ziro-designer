// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause), copyright Robin Stuart and
// contributors, and from Alex Geller's minimal encoder. See NOTICE.md.
/**
 * Data Matrix ECC 200, from Zint's `backend/dmatrix.c`.
 *
 * ISO/IEC 16022. Six encoding modes — ASCII, C40, TEXT, X12, EDIFACT and
 * Base 256 — with different densities and different alphabets, and, as with
 * Code 128 and QR, most of the work is deciding between them.
 *
 * Zint's default is *minimal* encoding: a shortest-path search over a graph
 * whose vertices are input positions paired with the mode they were reached
 * in, and whose edges are "encode the next 1-4 characters in mode M". Annex
 * J's look-ahead heuristic is the other path (`dm_isoenc`) and runs only under
 * `FAST_MODE`, which `ComputeBarcode` does not set.
 *
 * Left out because `ComputeBarcode` cannot reach it: GS1 mode, Structured
 * Append, Reader Initialisation, the Macro05/06 headers, `FAST_MODE`, DMRE and
 * square-only size selection, and a user-chosen version.
 */
import { setModule, type ZintSymbol } from './common.js';
import { GF_DATAMATRIX, ReedSolomon } from './reedsol.js';
import {
  DM_C40_SHIFT,
  DM_C40_VALUE,
  DM_INTSYMBOL,
  DM_IS_DMRE,
  DM_MATRIX_BYTES,
  DM_MATRIX_DATABLOCK,
  DM_MATRIX_FH,
  DM_MATRIX_FW,
  DM_MATRIX_H,
  DM_MATRIX_RSBLOCK,
  DM_MATRIX_W,
  DM_TEXT_SHIFT,
  DM_TEXT_VALUE,
} from './dmatrix_tables.js';

/** The six modes (`dmatrix.h:42-47`); 0 means "no edge here". */
const DM_ASCII = 1;
const DM_C40 = 2;
const DM_TEXT = 3;
const DM_X12 = 4;
const DM_EDIFACT = 5;
const DM_BASE256 = 6;
const DM_NUM_MODES = 6;

const DMSIZESCOUNT = 48;
/** `DMINTSYMBOL144` — the 144x144 symbol, the only one with the skew. */
const DMINTSYMBOL144 = 47;

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isUpper = (c: number): boolean => c >= 0x41 && c <= 0x5a;
const isLower = (c: number): boolean => c >= 0x61 && c <= 0x7a;

/** `dm_isc40` (`dmatrix.c:202-207`): digits, space and upper case. */
const isC40 = (c: number): boolean => (c <= 0x39 ? c >= 0x30 || c === 0x20 : isUpper(c));
/** `dm_istext`: digits, space and lower case. */
const isText = (c: number): boolean => (c <= 0x39 ? c >= 0x30 || c === 0x20 : isLower(c));
const isC40Text = (mode: number, c: number): boolean => (mode === DM_C40 ? isC40(c) : isText(c));
/** `dm_isX12`: C40's set plus CR, `*` and `>`. */
const isX12 = (c: number): boolean => isC40(c) || c === 13 || c === 0x2a || c === 0x3e;
/** `dm_isedifact`: space to `^`. */
const isEdifact = (c: number): boolean => c >= 0x20 && c <= 0x5e;

const isTwoDigits = (source: readonly number[], length: number, sp: number): boolean =>
  isDigit(source[sp]!) && sp + 1 < length && isDigit(source[sp + 1]!);

// ---------------------------------------------------------------------------
// Symbol size
// ---------------------------------------------------------------------------

/**
 * `dm_get_symbolsize(…)` (`dmatrix.c:582-605`) with no user version and no
 * DMRE or square-only option: the smallest table entry holding `minimum`
 * codewords, skipping the rectangular extensions.
 *
 * The `minimum >= 62 ? 23 : 0` start is not an optimisation — the table is not
 * sorted by capacity across the whole range, and 23 is where the second run
 * begins.
 */
function getSymbolSize(minimum: number): number {
  if (minimum > 1304) return minimum <= 1558 ? DMSIZESCOUNT - 1 : 0;

  let i = minimum >= 62 ? 23 : 0;
  while (minimum > DM_MATRIX_BYTES[i]!) i++;

  while (DM_IS_DMRE[i]) i++; // "Skip DMRE symbols in no dmre mode"
  return i;
}

/** `dm_codewords_remaining(…)` (`dmatrix.c:607-612`). May be negative. */
const codewordsRemaining = (tp: number, processP: number): number =>
  DM_MATRIX_BYTES[getSymbolSize(tp + processP)]! - tp;

// ---------------------------------------------------------------------------
// Minimal encoding: the edge graph
// ---------------------------------------------------------------------------

interface Edge {
  mode: number;
  /** The mode `dm_getEndMode` reports — EDIFACT reports ASCII when not full. */
  endMode: number;
  from: number;
  len: number;
  /** Cumulative codeword count. */
  size: number;
  /** Base 256 byte count, cached to avoid recomputing. */
  bytes: number;
  /** Index into the edges array; 0 means none, since row 0 is never a previous. */
  previous: number;
}

const newEdgeSlot = (): Edge => ({
  mode: 0,
  endMode: 0,
  from: 0,
  len: 0,
  size: 0,
  bytes: 0,
  previous: 0,
});

/**
 * `dm_last_ascii(…)` (`dmatrix.c:707-742`): can the last 1-4 characters be
 * finished in one or two ASCII codewords? Returns how many, or 0.
 */
function lastAscii(source: readonly number[], length: number, from: number): number {
  if (length - from > 4 || from >= length) return 0;

  if (length - from === 1) return source[from]! & 0x80 ? 0 : 1;

  if (length - from === 2) {
    if (source[from]! & 0x80 || source[from + 1]! & 0x80) return 0;
    return isDigit(source[from]!) && isDigit(source[from + 1]!) ? 1 : 2;
  }

  if (length - from === 3) {
    if (isDigit(source[from]!) && isDigit(source[from + 1]!) && !(source[from + 2]! & 0x80))
      return 2;
    if (isDigit(source[from + 1]!) && isDigit(source[from + 2]!) && !(source[from]! & 0x80))
      return 2;
    return 0;
  }

  return isDigit(source[from]!) &&
    isDigit(source[from + 1]!) &&
    isDigit(source[from + 2]!) &&
    isDigit(source[from + 3]!)
    ? 2
    : 0;
}

/**
 * `dm_getEndMode(…)` (`dmatrix.c:744-765`).
 *
 * A partial EDIFACT edge (fewer than four characters) reports ASCII, because
 * it cannot be left latched; so does a full one at the end of the data when
 * the remainder fits in the codewords that are left. That is what makes
 * EDIFACT's end-of-data rules tractable in a shortest-path search.
 */
function getEndMode(
  source: readonly number[],
  length: number,
  mode: number,
  from: number,
  len: number,
  size: number,
): number {
  if (mode !== DM_EDIFACT) return mode;
  if (len < 4) return DM_ASCII;

  const la = lastAscii(source, length, from + len);
  if (la && codewordsRemaining(size + la, 0) <= 2 - la) return DM_ASCII;

  return mode;
}

/**
 * `dm_getNumberOfC40Words(…)` (`dmatrix.c:774-802`): how many codewords a
 * C40/TEXT run of whole triplets costs, and how many characters that covers.
 *
 * A native character is one third of a codeword pair, a shifted one two
 * thirds, an upper-shifted one a whole, and an upper-shifted-and-shifted one
 * four thirds — which is why the count is kept in thirds.
 */
function numberOfC40Words(
  source: readonly number[],
  length: number,
  from: number,
  mode: number,
): { cwds: number; len: number } {
  let thirdsCount = 0;

  for (let i = from; i < length; i++) {
    const ci = source[i]!;

    if (isC40Text(mode, ci))
      thirdsCount++; // Native
    else if (!(ci & 0x80))
      thirdsCount += 2; // Shift
    else if (isC40Text(mode, ci & 0x7f))
      thirdsCount += 3; // Shift, Upper shift
    else thirdsCount += 4; // Shift, Upper shift, shift

    const remainder = thirdsCount % 3;
    if (remainder === 0 || (remainder === 2 && i + 1 === length))
      return { cwds: Math.floor((thirdsCount + 2) / 3) * 2, len: i - from + 1 };
  }

  return { cwds: 0, len: 0 };
}

/**
 * `dm_new_Edge(…)` (`dmatrix.c:804-912`): the cumulative codeword cost of
 * reaching `from + len` by encoding in `mode`, including whatever latch or
 * unlatch the transition needs.
 */
function newEdge(
  source: readonly number[],
  length: number,
  edges: Edge[],
  mode: number,
  from: number,
  len: number,
  previousIdx: number,
  edge: Edge,
  cwds: number,
): number {
  const previous = previousIdx ? edges[previousIdx]! : null;

  edge.mode = mode;
  edge.endMode = mode;
  edge.from = from;
  edge.len = len;
  edge.bytes = 0;
  edge.previous = previousIdx;

  const previousMode = previous ? previous.endMode : DM_ASCII;
  let size = previous ? previous.size : 0;

  switch (mode) {
    case DM_ASCII:
      size++;
      if (source[from]! & 0x80) size++; // FNC4 + value
      if (previousMode !== DM_ASCII && previousMode !== DM_BASE256) size++; // Unlatch
      break;

    case DM_BASE256:
      size++;
      if (previousMode !== DM_BASE256) {
        size += 2; // Byte count + latch
        if (previousMode !== DM_ASCII) size++; // Unlatch to ASCII first
        edge.bytes = 1;
      } else {
        edge.bytes = 1 + previous!.bytes;
        // The length field grows to two codewords at 250 bytes.
        if (edge.bytes === 250) size++;
      }
      break;

    case DM_C40:
    case DM_TEXT:
      size += cwds;
      if (previousMode !== mode) {
        size++; // Latch
        if (previousMode !== DM_ASCII && previousMode !== DM_BASE256) size++; // Unlatch
      }
      if (from + len + 2 >= length) {
        // "If less than batch of 3 away from EOD"
        const la = lastAscii(source, length, from + len);
        if (codewordsRemaining(size + la, 0) > 0) size++; // Extra unlatch at the end
      }
      break;

    case DM_X12:
      size += 2;
      if (previousMode !== DM_X12) {
        size++;
        if (previousMode !== DM_ASCII && previousMode !== DM_BASE256) size++;
      }
      if (from + len + 2 >= length) {
        const la = lastAscii(source, length, from + len);
        // "Only 1 ASCII-encodable allowed at EOD for X12, unlike C40/TEXT"
        if (la === 2) size++;
        else if (codewordsRemaining(size + la, 0) > 0) size++;
      }
      break;

    case DM_EDIFACT:
      size += 3;
      if (previousMode !== DM_EDIFACT) {
        size++;
        if (previousMode !== DM_ASCII && previousMode !== DM_BASE256) size++;
      }
      edge.endMode = getEndMode(source, length, mode, from, len, size);
      break;
  }

  edge.size = size;
  return edge.endMode;
}

/** `dm_addEdge(…)` (`dmatrix.c:914-929`): keep the cheaper of the two. */
function addEdge(
  source: readonly number[],
  length: number,
  edges: Edge[],
  mode: number,
  from: number,
  len: number,
  previousIdx: number,
  cwds: number,
): void {
  const edge = newEdgeSlot();
  const endMode = newEdge(source, length, edges, mode, from, len, previousIdx, edge, cwds);
  const vIj = (from + len) * DM_NUM_MODES + endMode - 1;

  if (edges[vIj]!.mode === 0 || edges[vIj]!.size > edge.size) edges[vIj] = edge;
}

/** `dm_addEdges(…)` (`dmatrix.c:931-975`). */
function addEdges(
  source: readonly number[],
  length: number,
  edges: Edge[],
  from: number,
  previousIdx: number,
): void {
  const previous = previousIdx ? edges[previousIdx]! : null;

  // "Not possible to unlatch a full EDF edge to something else".
  if (!previous || previous.endMode !== DM_EDIFACT) {
    if (isDigit(source[from]!) && from + 1 < length && isDigit(source[from + 1]!)) {
      addEdge(source, length, edges, DM_ASCII, from, 2, previousIdx, 0);
      // "If ASCII vertex, don't bother adding other edges as this will be
      // optimal; suggested by Alex Geller".
      if (previous && previous.mode === DM_ASCII) return;
    } else {
      addEdge(source, length, edges, DM_ASCII, from, 1, previousIdx, 0);
    }

    for (const m of [DM_C40, DM_TEXT]) {
      const { cwds, len } = numberOfC40Words(source, length, from, m);
      if (cwds) addEdge(source, length, edges, m, from, len, previousIdx, cwds);
    }

    if (
      from + 2 < length &&
      isX12(source[from]!) &&
      isX12(source[from + 1]!) &&
      isX12(source[from + 2]!)
    )
      addEdge(source, length, edges, DM_X12, from, 3, previousIdx, 0);

    addEdge(source, length, edges, DM_BASE256, from, 1, previousIdx, 0);
  }

  if (isEdifact(source[from]!)) {
    // "We create 3 EDF edges, 2, 3 or 4 characters length."
    for (let i = 1, pos = from + i; i < 4 && pos < length && isEdifact(source[pos]!); i++, pos++)
      addEdge(source, length, edges, DM_EDIFACT, from, i + 1, previousIdx, 0);
  }
}

/**
 * `dm_define_mode(…)` (`dmatrix.c:977-1049`): build the graph, take the
 * cheapest edge at the final vertex, and trace back to a per-character mode.
 */
function defineMode(source: readonly number[], length: number): number[] {
  const edges: Edge[] = Array.from({ length: (length + 1) * DM_NUM_MODES }, newEdgeSlot);
  const modes = new Array<number>(length).fill(0);

  addEdges(source, length, edges, 0, 0);

  for (let i = 1; i < length; i++) {
    const vI = i * DM_NUM_MODES;
    for (let j = 0; j < DM_NUM_MODES; j++)
      if (edges[vI + j]!.mode) addEdges(source, length, edges, i, vI + j);
  }

  const vI = length * DM_NUM_MODES;
  let minimalJ = -1;
  let minimalSize = Number.MAX_SAFE_INTEGER;
  for (let j = 0; j < DM_NUM_MODES; j++) {
    const e = edges[vI + j]!;
    if (e.mode && e.size < minimalSize) {
      minimalSize = e.size;
      minimalJ = j;
    }
  }

  let edge: Edge | null = edges[vI + minimalJ]!;
  let modeLen = 0;
  let modeEnd = length;

  while (edge) {
    const currentMode = edge.mode;
    modeLen += edge.len;
    edge = edge.previous ? edges[edge.previous]! : null;
    if (!edge || edge.mode !== currentMode) {
      for (let i = modeEnd - modeLen; i < modeEnd; i++) modes[i] = currentMode;
      modeEnd -= modeLen;
      modeLen = 0;
    }
  }

  return modes;
}

// ---------------------------------------------------------------------------
// Minimal encoding: emitting codewords
// ---------------------------------------------------------------------------

/**
 * `dm_ctx_buffer_xfer(…)` (`dmatrix.c:500-527`): C40/TEXT/X12 triplets pack
 * three values into `1600a + 40b + c + 1`, a 16-bit number written as two
 * codewords.
 */
function ctxBufferXfer(buffer: number[], target: number[]): void {
  const processE = Math.floor(buffer.length / 3) * 3;
  for (let i = 0; i < processE; i += 3) {
    const iv = 1600 * buffer[i]! + 40 * buffer[i + 1]! + buffer[i + 2]! + 1;
    target.push(iv >> 8, iv & 0xff);
  }
  buffer.splice(0, processE);
}

/**
 * `dm_edi_buffer_xfer(…)` (`dmatrix.c:529-580`): EDIFACT packs four six-bit
 * values into three codewords. `empty` flushes a partial quadruplet, padding
 * the unused low bits with zero.
 */
function ediBufferXfer(buffer: number[], target: number[], empty: boolean): void {
  const processE = Math.floor(buffer.length / 4) * 4;
  for (let i = 0; i < processE; i += 4) {
    target.push(
      (buffer[i]! << 2) | ((buffer[i + 1]! & 0x30) >> 4),
      ((buffer[i + 1]! & 0x0f) << 4) | ((buffer[i + 2]! & 0x3c) >> 2),
      ((buffer[i + 2]! & 0x03) << 6) | buffer[i + 3]!,
    );
  }
  buffer.splice(0, processE);

  if (buffer.length && empty) {
    if (buffer.length === 3) {
      target.push(
        (buffer[0]! << 2) | ((buffer[1]! & 0x30) >> 4),
        ((buffer[1]! & 0x0f) << 4) | ((buffer[2]! & 0x3c) >> 2),
        (buffer[2]! & 0x03) << 6,
      );
    } else if (buffer.length === 2) {
      target.push((buffer[0]! << 2) | ((buffer[1]! & 0x30) >> 4), (buffer[1]! & 0x0f) << 4);
    } else {
      target.push(buffer[0]! << 2);
    }
    buffer.length = 0;
  }
}

/** `dm_c40text_cnt(…)` (`dmatrix.c:614-631`). */
function c40TextCnt(currentMode: number, input: number): number {
  let cnt = 1;
  let ch = input;
  if (ch & 0x80) {
    cnt += 2;
    ch -= 128;
  }
  if (
    (currentMode === DM_C40 && DM_C40_SHIFT[ch]) ||
    (currentMode === DM_TEXT && DM_TEXT_SHIFT[ch])
  )
    cnt += 1;
  return cnt;
}

/**
 * `dm_update_b256_field_length(…)` (`dmatrix.c:633-647`): a Base 256 run
 * declares its own length, in one codeword up to 249 bytes and two beyond.
 */
function updateB256FieldLength(target: number[], b256Start: number): void {
  const b256Count = target.length - (b256Start + 1);
  if (b256Count <= 249) {
    target[b256Start] = b256Count;
  } else {
    target.splice(b256Start + 1, 0, 0); // "Insert extra codeword"
    target[b256Start] = 249 + Math.floor(b256Count / 250);
    target[b256Start + 1] = b256Count % 250;
  }
}

/** `dm_switch_mode(…)` (`dmatrix.c:649-686`). Returns the new `b256Start`. */
function switchMode(nextMode: number, target: number[], b256Start: number): number {
  switch (nextMode) {
    case DM_C40:
      target.push(230);
      break;
    case DM_TEXT:
      target.push(239);
      break;
    case DM_X12:
      target.push(238);
      break;
    case DM_EDIFACT:
      target.push(240);
      break;
    case DM_BASE256: {
      target.push(231);
      const start = target.length;
      target.push(0); // "Byte count holder (may be expanded to 2 codewords)"
      return start;
    }
  }
  return b256Start;
}

interface EncodeState {
  target: number[];
  buffer: number[];
  currentMode: number;
  b256Start: number;
  sp: number;
}

/** `dm_minimalenc(…)` (`dmatrix.c:1053-1237`). */
function minimalEnc(source: readonly number[], length: number, st: EncodeState): string {
  const modes = defineMode(source, length);
  const { target, buffer } = st;

  while (st.sp < length) {
    if (modes[st.sp] !== st.currentMode) {
      switch (st.currentMode) {
        case DM_C40:
        case DM_TEXT:
        case DM_X12:
          buffer.length = 0; // "Throw away buffer if any"
          target.push(254); // Unlatch
          break;
        case DM_EDIFACT: {
          const la = lastAscii(source, length, st.sp);
          if (!la)
            buffer.push(31); // Unlatch
          else if (codewordsRemaining(target.length + la, buffer.length) > 2 - la) buffer.push(31);
          ediBufferXfer(buffer, target, true);
          break;
        }
        case DM_BASE256:
          updateB256FieldLength(target, st.b256Start);
          randomiseB256(target, st.b256Start);
          break;
      }
      st.b256Start = switchMode(modes[st.sp]!, target, st.b256Start);
    }

    st.currentMode = modes[st.sp]!;

    if (st.currentMode === DM_ASCII) {
      if (isTwoDigits(source, length, st.sp)) {
        target.push(10 * (source[st.sp]! - 0x30) + (source[st.sp + 1]! - 0x30) + 130);
        st.sp += 2;
      } else {
        if (source[st.sp]! & 0x80) {
          target.push(235); // FNC4
          target.push(source[st.sp]! - 128 + 1);
        } else {
          target.push(source[st.sp]! + 1);
        }
        st.sp++;
      }
    } else if (st.currentMode === DM_C40 || st.currentMode === DM_TEXT) {
      const ctShift = st.currentMode === DM_C40 ? DM_C40_SHIFT : DM_TEXT_SHIFT;
      const ctValue = st.currentMode === DM_C40 ? DM_C40_VALUE : DM_TEXT_VALUE;
      let shiftSet: number;
      let value: number;

      if (source[st.sp]! & 0x80) {
        buffer.push(1);
        buffer.push(30); // Upper Shift
        shiftSet = ctShift[source[st.sp]! - 128]!;
        value = ctValue[source[st.sp]! - 128]!;
      } else {
        shiftSet = ctShift[source[st.sp]!]!;
        value = ctValue[source[st.sp]!]!;
      }

      if (shiftSet !== 0) buffer.push(shiftSet - 1);
      buffer.push(value);

      if (buffer.length >= 3) ctxBufferXfer(buffer, target);
      st.sp++;
    } else if (st.currentMode === DM_X12) {
      const c = source[st.sp]!;
      let value: number;
      if (isDigit(c)) value = c - 0x30 + 4;
      else if (isUpper(c)) value = c - 0x41 + 14;
      else value = '\r*> '.indexOf(String.fromCharCode(c)); // "\015*> "

      buffer.push(value);
      if (buffer.length >= 3) ctxBufferXfer(buffer, target);
      st.sp++;
    } else if (st.currentMode === DM_EDIFACT) {
      let value = source[st.sp]!;
      if (value >= 64) value -= 64; // '@'
      buffer.push(value);
      st.sp++;
      if (buffer.length >= 4) ediBufferXfer(buffer, target, false);
    } else if (st.currentMode === DM_BASE256) {
      target.push(source[st.sp]!);
      st.sp++;
    }

    if (target.length > 1558)
      return 'Error 729: Input too long, requires too many codewords (maximum 1558)';
  }

  return '';
}

/**
 * "B.2.1 255-state randomising algorithm" — Base 256 bytes are offset by a
 * position-dependent pseudo-random number so that a run of identical bytes
 * does not produce a run of identical modules.
 */
function randomiseB256(target: number[], b256Start: number): void {
  for (let i = b256Start; i < target.length; i++) {
    const prn = ((149 * (i + 1)) % 255) + 1;
    target[i] = (target[i]! + prn) & 0xff;
  }
}

/**
 * `dm_encode(…)`'s tail (`dmatrix.c:1536-1645`): close whatever mode the data
 * ended in.
 *
 * These are ISO/IEC 16022 section 5.2.5.2's end-of-data rules, and they are
 * the fiddliest part of the symbology — the C40/TEXT case can even BACKTRACK,
 * undoing already-emitted triplets to re-encode the tail in ASCII.
 */
function encodeTail(source: readonly number[], length: number, st: EncodeState): void {
  const { target, buffer } = st;
  const symbolsLeft = codewordsRemaining(target.length, buffer.length);

  if (st.currentMode === DM_C40 || st.currentMode === DM_TEXT) {
    if (buffer.length === 0) {
      if (symbolsLeft > 0) target.push(254); // Unlatch
    } else if (buffer.length === 2 && symbolsLeft === 2) {
      buffer.push(0); // 5.2.5.2 (b): Shift 1
      ctxBufferXfer(buffer, target);
    } else if (
      buffer.length === 1 &&
      symbolsLeft <= 2 &&
      isC40Text(st.currentMode, source[length - 1]!)
    ) {
      // 5.2.5.2 (c)/(d)
      if (symbolsLeft > 1) target.push(254); // Unlatch, then ASCII
      target.push(source[length - 1]! + 1);
    } else {
      // "Backtrack to last complete triplet (same technique as BWIPP)".
      let totalCnt = 0;
      while (st.sp > 0 && buffer.length % 3) {
        st.sp--;
        const cnt = c40TextCnt(st.currentMode, source[st.sp]!);
        totalCnt += cnt;
        buffer.length -= cnt;
      }
      target.length -= Math.floor(totalCnt / 3) * 2;

      target.push(254); // Unlatch
      for (; st.sp < length; st.sp++) {
        if (isTwoDigits(source, length, st.sp)) {
          target.push(10 * (source[st.sp]! - 0x30) + (source[st.sp + 1]! - 0x30) + 130);
          st.sp++;
        } else if (source[st.sp]! & 0x80) {
          target.push(235);
          target.push(source[st.sp]! - 128 + 1);
        } else {
          target.push(source[st.sp]! + 1);
        }
      }
    }
  } else if (st.currentMode === DM_X12) {
    if (symbolsLeft === 1 && buffer.length === 1) {
      target.push(source[length - 1]! + 1); // "Unlatch not required!"
    } else {
      if (symbolsLeft > 0) target.push(254); // Unlatch
      if (buffer.length === 1) {
        target.push(source[length - 1]! + 1);
      } else if (buffer.length === 2) {
        target.push(source[length - 2]! + 1);
        target.push(source[length - 1]! + 1);
      }
    }
  } else if (st.currentMode === DM_EDIFACT) {
    // "Unlatch not required!" — the buffered characters are written as plain
    // ASCII when there is room for exactly them and nothing else, which is the
    // promise `dm_getEndMode` made to the search when it reported ASCII for a
    // full EDIFACT edge at the end of the data.
    if (symbolsLeft <= 2 && buffer.length <= symbolsLeft) {
      if (buffer.length === 1) {
        target.push(source[length - 1]! + 1);
      } else if (buffer.length === 2) {
        target.push(source[length - 2]! + 1);
        target.push(source[length - 1]! + 1);
      }
      buffer.length = 0;
    } else {
      if (buffer.length <= 3) buffer.push(31); // Unlatch
      ediBufferXfer(buffer, target, true);
    }
  } else if (st.currentMode === DM_BASE256) {
    if (symbolsLeft > 0) updateB256FieldLength(target, st.b256Start);
    randomiseB256(target, st.b256Start);
  }
}

/**
 * `dm_add_tail(…)` (`dmatrix.c:1835-1849`): pad codeword 129 then the
 * "B.1.1 253-state randomising algorithm" for the rest.
 */
function addTail(target: number[], tailLength: number): void {
  target.push(129); // Pad
  for (let i = 1; i < tailLength; i++) {
    const prn = ((149 * (target.length + 1)) % 253) + 1;
    const temp = 129 + prn;
    target.push(temp <= 254 ? temp : temp - 254);
  }
}

/**
 * `dm_ecc(…)` (`dmatrix.c:168-200`): split into interleaved blocks, encode
 * each, and write the check codewords back interleaved the same way.
 *
 * `skew` is the 144x144 symbol's, and only its: its ECC is rotated so that
 * readers written against the pre-2006 wording still decode it.
 */
function dmEcc(
  binary: number[],
  bytes: number,
  datablock: number,
  rsblock: number,
  skew: boolean,
): void {
  const blocks = Math.floor((bytes + 2) / datablock);
  const rsblocks = rsblock * blocks;
  // `rs_init_code( &rs, rsblock, 1 )` — index 1 here, where QR uses 0.
  const rs = new ReedSolomon(GF_DATAMATRIX, rsblock, 1);

  for (let b = 0; b < blocks; b++) {
    const buf: number[] = [];
    for (let n = b; n < bytes; n += blocks) buf.push(binary[n]!);
    const ecc = rs.encode(buf);

    if (skew) {
      for (let n = b, p = 0; n < rsblocks; n += blocks, p++) {
        if (b < 8) binary[bytes + n + 2] = ecc[p]!;
        else binary[bytes + n - 8] = ecc[p]!;
      }
    } else {
      for (let n = b, p = 0; n < rsblocks; n += blocks, p++) binary[bytes + n] = ecc[p]!;
    }
  }
}

// ---------------------------------------------------------------------------
// Annex F placement
// ---------------------------------------------------------------------------

/**
 * `dm_placementbit(…)` (`dmatrix.c:49-68`): where one bit of one codeword
 * goes, with ISO/IEC 16022 Annex F's wrap-around for indices off the edge.
 *
 * `array[r * NC + c]` holds `(codeword << 3) + bit`, which is why the caller
 * can test `v > 7` for "a data module" and `v === 1` for the fixed corner.
 */
function placementBit(
  array: number[],
  NR: number,
  NC: number,
  r0: number,
  c0: number,
  p: number,
  b: number,
): void {
  let r = r0;
  let c = c0;
  if (r < 0) {
    r += NR;
    c += 4 - ((NR + 4) % 8);
  }
  if (c < 0) {
    c += NC;
    r += 4 - ((NC + 4) % 8);
  }
  if (r >= NR) r -= NR; // "Necessary for DMRE"
  array[r * NC + c] = (p << 3) + b;
}

function placementBlock(
  array: number[],
  NR: number,
  NC: number,
  r: number,
  c: number,
  p: number,
): void {
  placementBit(array, NR, NC, r - 2, c - 2, p, 7);
  placementBit(array, NR, NC, r - 2, c - 1, p, 6);
  placementBit(array, NR, NC, r - 1, c - 2, p, 5);
  placementBit(array, NR, NC, r - 1, c - 1, p, 4);
  placementBit(array, NR, NC, r - 1, c - 0, p, 3);
  placementBit(array, NR, NC, r - 0, c - 2, p, 2);
  placementBit(array, NR, NC, r - 0, c - 1, p, 1);
  placementBit(array, NR, NC, r - 0, c - 0, p, 0);
}

function cornerA(array: number[], NR: number, NC: number, p: number): void {
  placementBit(array, NR, NC, NR - 1, 0, p, 7);
  placementBit(array, NR, NC, NR - 1, 1, p, 6);
  placementBit(array, NR, NC, NR - 1, 2, p, 5);
  placementBit(array, NR, NC, 0, NC - 2, p, 4);
  placementBit(array, NR, NC, 0, NC - 1, p, 3);
  placementBit(array, NR, NC, 1, NC - 1, p, 2);
  placementBit(array, NR, NC, 2, NC - 1, p, 1);
  placementBit(array, NR, NC, 3, NC - 1, p, 0);
}

function cornerB(array: number[], NR: number, NC: number, p: number): void {
  placementBit(array, NR, NC, NR - 3, 0, p, 7);
  placementBit(array, NR, NC, NR - 2, 0, p, 6);
  placementBit(array, NR, NC, NR - 1, 0, p, 5);
  placementBit(array, NR, NC, 0, NC - 4, p, 4);
  placementBit(array, NR, NC, 0, NC - 3, p, 3);
  placementBit(array, NR, NC, 0, NC - 2, p, 2);
  placementBit(array, NR, NC, 0, NC - 1, p, 1);
  placementBit(array, NR, NC, 1, NC - 1, p, 0);
}

function cornerC(array: number[], NR: number, NC: number, p: number): void {
  placementBit(array, NR, NC, NR - 3, 0, p, 7);
  placementBit(array, NR, NC, NR - 2, 0, p, 6);
  placementBit(array, NR, NC, NR - 1, 0, p, 5);
  placementBit(array, NR, NC, 0, NC - 2, p, 4);
  placementBit(array, NR, NC, 0, NC - 1, p, 3);
  placementBit(array, NR, NC, 1, NC - 1, p, 2);
  placementBit(array, NR, NC, 2, NC - 1, p, 1);
  placementBit(array, NR, NC, 3, NC - 1, p, 0);
}

function cornerD(array: number[], NR: number, NC: number, p: number): void {
  placementBit(array, NR, NC, NR - 1, 0, p, 7);
  placementBit(array, NR, NC, NR - 1, NC - 1, p, 6);
  placementBit(array, NR, NC, 0, NC - 3, p, 5);
  placementBit(array, NR, NC, 0, NC - 2, p, 4);
  placementBit(array, NR, NC, 0, NC - 1, p, 3);
  placementBit(array, NR, NC, 1, NC - 3, p, 2);
  placementBit(array, NR, NC, 1, NC - 2, p, 1);
  placementBit(array, NR, NC, 1, NC - 1, p, 0);
}

/** `dm_placement(…)` (`dmatrix.c:127-166`), Annex F's diagonal walk. */
function placement(array: number[], NR: number, NC: number): void {
  let p = 1;
  let r = 4;
  let c = 0;

  do {
    if (r === NR && !c) cornerA(array, NR, NC, p++);
    if (r === NR - 2 && !c && NC % 4) cornerB(array, NR, NC, p++);
    if (r === NR - 2 && !c && NC % 8 === 4) cornerC(array, NR, NC, p++);
    if (r === NR + 4 && c === 2 && !(NC % 8)) cornerD(array, NR, NC, p++);

    // up/right
    do {
      if (r < NR && c >= 0 && !array[r * NC + c]) placementBlock(array, NR, NC, r, c, p++);
      r -= 2;
      c += 2;
    } while (r >= 0 && c < NC);
    r++;
    c += 3;

    // down/left
    do {
      if (r >= 0 && c < NC && !array[r * NC + c]) placementBlock(array, NR, NC, r, c, p++);
      r += 2;
      c -= 2;
    } while (r < NR && c >= 0);
    r += 3;
    c++;
  } while (r < NR || c < NC);

  // "unfilled corner"
  if (!array[NR * NC - 1]) {
    array[NR * NC - 1] = 1;
    array[NR * NC - NC - 2] = 1;
  }
}

/**
 * `dm_ecc200(…)` (`dmatrix.c:1851-1972`) for one segment with none of the
 * options `ComputeBarcode` can set.
 *
 * `ddata` is bytes: ISO 8859-1 values when `eci` is 0, and raw UTF-8 bytes
 * when it is 26.
 */
export function datamatrix(symbol: ZintSymbol, ddata: readonly number[], eci: number): string {
  const length = ddata.length;

  if (length > 3116) return `Error 719: Input length ${length} too long (maximum 3116)`;

  const target: number[] = [];

  if (eci > 0) {
    // "Encode ECI numbers according to Table 6" (`dmatrix.c:1508-1522`).
    target.push(241); // ECI Character
    if (eci <= 126) {
      target.push(eci + 1);
    } else if (eci <= 16382) {
      target.push(Math.floor((eci - 127) / 254) + 128);
      target.push(((eci - 127) % 254) + 1);
    } else {
      target.push(Math.floor((eci - 16383) / 64516) + 192);
      target.push((Math.floor((eci - 16383) / 254) % 254) + 1);
      target.push(((eci - 16383) % 254) + 1);
    }
  }

  const st: EncodeState = {
    target,
    buffer: [],
    currentMode: DM_ASCII,
    b256Start: 0,
    sp: 0,
  };

  const error = minimalEnc(ddata, length, st);
  if (error) return error;

  encodeTail(ddata, length, st);

  const binlen = target.length;
  const symbolsize = getSymbolSize(binlen);

  if (binlen > DM_MATRIX_BYTES[symbolsize]!)
    return `Error 523: Input too long, requires ${binlen} codewords (maximum 1558)`;

  const H = DM_MATRIX_H[symbolsize]!;
  const W = DM_MATRIX_W[symbolsize]!;
  const FH = DM_MATRIX_FH[symbolsize]!;
  const FW = DM_MATRIX_FW[symbolsize]!;
  const bytes = DM_MATRIX_BYTES[symbolsize]!;
  const datablock = DM_MATRIX_DATABLOCK[symbolsize]!;
  const rsblock = DM_MATRIX_RSBLOCK[symbolsize]!;

  const taillength = bytes - binlen;
  if (taillength !== 0) addTail(target, taillength);

  const binary = target.slice();
  binary.length = bytes + rsblock * Math.floor((bytes + 2) / datablock);
  binary.fill(0, bytes);

  dmEcc(binary, bytes, datablock, rsblock, symbolsize === DMINTSYMBOL144);

  // Placement: the alignment pattern first — a solid line down the left and
  // along the bottom of every data region, and a dashed one along the top and
  // right — then the data modules inside the regions.
  const NC = W - 2 * Math.floor(W / FW);
  const NR = H - 2 * Math.floor(H / FH);
  const places = new Array<number>(NC * NR).fill(0);

  placement(places, NR, NC);

  for (let y = 0; y < H; y += FH) {
    for (let x = 0; x < W; x++) setModule(symbol, H - y - 1, x);
    for (let x = 0; x < W; x += 2) setModule(symbol, y, x);
  }
  for (let x = 0; x < W; x += FW) {
    for (let y = 0; y < H; y++) setModule(symbol, H - y - 1, x);
    for (let y = 0; y < H; y += 2) setModule(symbol, H - y - 1, x + FW - 1);
  }

  for (let y = 0; y < NR; y++) {
    for (let x = 0; x < NC; x++) {
      const v = places[(NR - y - 1) * NC + x]!;
      if (v === 1 || (v > 7 && binary[(v >> 3) - 1]! & (1 << (v & 7))))
        setModule(
          symbol,
          H - (1 + y + 2 * Math.floor(y / (FH - 2))) - 1,
          1 + x + 2 * Math.floor(x / (FW - 2)),
        );
    }
  }

  symbol.rows = H;
  symbol.width = W;
  symbol.height = H;
  for (let y = 0; y < H; y++) symbol.rowHeight[y] = 1;

  return '';
}
