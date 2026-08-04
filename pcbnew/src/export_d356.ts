// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * IPC-D-356 bare-board test netlist.
 * Counterpart: `IPC356D_WRITER` (pcbnew/exporters/export_d356.cpp).
 *
 * A fixed-column ASCII format that a bare-board test house feeds straight into
 * a flying-probe or bed-of-nails machine. Every field is at a fixed offset, so
 * "close enough" is worthless here: a column out by one is a file the test
 * house rejects, and the failure surfaces at the fab, not at export time. The
 * tests therefore assert whole records byte for byte rather than field values.
 *
 * ## Two things that read as bugs and are reproduced anyway
 *
 * The access code for the same physical situation is computed by two different
 * formulas — pads use `layerId + 1`, vias use `(topLayerId / 2) + 1` — and they
 * disagree for inner layers. Upstream is inconsistent here and a test house
 * consumes what KiCad emits, so unifying them would make us the odd one out.
 *
 * Soldermask polarity is inverted between the two paths: a pad starts at 3 and
 * *clears* bits when a mask layer is present, a via starts at 0 and *sets* them
 * when the side is tented. Both end up meaning "this side is not accessible",
 * but the code reads backwards depending on which loop you are in.
 *
 * ## Record order is load-bearing
 *
 * Vias are built before pads, and net names are interned in record order, so
 * vias get first claim on the unsuffixed canonical names. Emitting pads first
 * silently changes the net names on any board with long or colliding names.
 */
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { boardAuxOrigin } from './plot_gerber.js';
import type { SList, SNode } from '@ziroeda/sexpr/src/types.js';
import type { Board, PcbPad, PcbVia } from './types.js';

/** `PCB_LAYER_ID` for the layers this exporter cares about (layer_ids.h). */
const F_CU = 0;
const F_MASK = 1;
const B_CU = 2;
const B_MASK = 3;

/** One row of the netlist, `D356_RECORD`. */
export interface D356Record {
  smd: boolean;
  hole: boolean;
  mechanical: boolean;
  midpoint: boolean;
  netname: string;
  refdes: string;
  pin: string;
  drill: number;
  access: number;
  xLocation: number;
  yLocation: number;
  xSize: number;
  ySize: number;
  rotation: number;
  soldermask: number;
}

/**
 * `iu_to_d356`: internal units to decimils, clamped **symmetrically**.
 *
 * `KiROUND` is round-half-away-from-zero. `Math.round` rounds half toward
 * positive infinity, so every coordinate sitting exactly on a half-decimil
 * *below* the origin would come out one unit off — a whole-board offset that
 * only shows on one side of the aux origin.
 */
export function iuToD356(iu: number, clamp: number): number {
  const val = KiROUND(iu / 2540);
  if (val > clamp) return clamp;
  if (val < -clamp) return -clamp;
  return val;
}

/** Canonical layer name to `PCB_LAYER_ID`; undefined for anything not copper or mask. */
export function layerNameToId(name: string): number | undefined {
  if (name === 'F.Cu') return F_CU;
  if (name === 'F.Mask') return F_MASK;
  if (name === 'B.Cu') return B_CU;
  if (name === 'B.Mask') return B_MASK;
  const m = /^In(\d+)\.Cu$/.exec(name);
  if (!m) return undefined;
  const k = Number(m[1]);
  return k >= 1 && k <= 30 ? 2 * k + 2 : undefined;
}

const isCopperId = (id: number): boolean => id === F_CU || id === B_CU || (id >= 4 && id <= 62);

/**
 * A pad's raw `(layers …)` tokens as a set of layer ids, mirroring the
 * parser's `m_layerMasks` table.
 *
 * `*.Cu` expands to **all 32** copper layers regardless of how many the board
 * actually has, which is why a `*.Cu` pad on a two-layer board still reports
 * both outer layers and gets access code 0.
 */
export function expandLayerTokens(tokens: readonly string[]): Set<number> {
  const out = new Set<number>();
  const inners = (): number[] => Array.from({ length: 30 }, (_, i) => 2 * (i + 1) + 2);

  for (const token of tokens) {
    if (token === '*.Cu') {
      out.add(F_CU);
      out.add(B_CU);
      for (const id of inners()) out.add(id);
    } else if (token === '*In.Cu') {
      for (const id of inners()) out.add(id);
    } else if (token === 'F&B.Cu') {
      out.add(F_CU);
      out.add(B_CU);
    } else if (token === '*.Mask') {
      out.add(F_MASK);
      out.add(B_MASK);
    } else {
      const id = layerNameToId(token);
      if (id !== undefined) out.add(id);
    }
  }

  return out;
}

/**
 * `compute_pad_access_code`. Returns -1 when the pad has no copper at all,
 * which the caller treats as "skip this pad entirely" — a mask-only aperture
 * is not a test point.
 */
export function computePadAccessCode(
  copperLayerCount: number,
  layerIds: ReadonlySet<number>,
): number {
  const copper = [...layerIds].filter(isCopperId);
  if (copper.length === 0) return -1;

  const has = (id: number): boolean => copper.includes(id);

  if (has(F_CU) && has(B_CU)) return 0;
  if (has(F_CU)) return 1;
  if (has(B_CU)) return copperLayerCount;

  // Inner-layer-only pad. The loop is bounded by the board's copper count;
  // upstream's LAYER_RANGE would walk off the end of the LSET here, and only
  // gets away with it because a board with no inner layers never reaches this.
  for (let k = 1; k <= Math.max(copperLayerCount - 2, 0); k++) {
    const id = 2 * k + 2;
    if (has(id)) return id + 1;
  }

  return -1;
}

/**
 * `via_access_code`. Deliberately **not** unified with the pad version: for an
 * inner layer the two disagree, and matching KiCad matters more than being
 * self-consistent.
 */
export function viaAccessCode(
  copperLayerCount: number,
  topLayerId: number,
  bottomLayerId: number,
): number {
  if (topLayerId === F_CU && bottomLayerId === B_CU) return 0;
  if (topLayerId === F_CU) return 1;
  if (bottomLayerId === B_CU) return copperLayerCount;
  return Math.trunc(topLayerId / 2) + 1;
}

/** Physical depth, for ordering a via's layer pair (`IsCopperLayerLowerThan`). */
const depth = (id: number): number =>
  id === F_CU ? 0 : id === B_CU ? Number.POSITIVE_INFINITY : id;

/**
 * `PCB_VIA::LayerPair` plus `SanitizeLayers`.
 *
 * A through via is **always** (F.Cu, B.Cu) whatever the file's `(layers …)`
 * token said, so a through via with a nonsense pair still gets access code 0.
 */
export function viaLayerPair(via: PcbVia): { top: number; bottom: number } {
  if (via.kind === 'through') return { top: F_CU, bottom: B_CU };

  const a = layerNameToId(via.layers[0]) ?? F_CU;
  const b = layerNameToId(via.layers[1]) ?? B_CU;

  return depth(a) <= depth(b) ? { top: a, bottom: b } : { top: b, bottom: a };
}

// ---------------------------------------------------------------------------
// Tenting

const childList = (src: SList | undefined, name: string): SList | undefined => {
  if (!src) return undefined;
  for (const item of src.items) {
    if (item.kind === 'list' && item.items[0]?.kind === 'atom' && item.items[0].value === name)
      return item;
  }
  return undefined;
};

const atomsOf = (l: SList | undefined): string[] =>
  l
    ? l.items
        .slice(1)
        .filter((n): n is SNode & { value: string } => 'value' in n)
        .map((n) => n.value)
    : [];

const yesNo = (v: string | undefined): boolean | undefined =>
  v === 'yes' || v === 'true' ? true : v === 'no' || v === 'false' ? false : undefined;

/** `(tenting …)` on a node, in both the modern and legacy spellings. */
function tentingOf(src: SList | undefined): { front?: boolean; back?: boolean } {
  const t = childList(src, 'tenting');
  if (!t) return {};

  const front = childList(t, 'front');
  const back = childList(t, 'back');
  if (front || back) return { front: yesNo(atomsOf(front)[0]), back: yesNo(atomsOf(back)[0]) };

  // Legacy bare form: `(tenting front back)`, `(tenting front)`, `(tenting none)`.
  const words = atomsOf(t);
  if (words.includes('none')) return { front: false, back: false };
  return { front: words.includes('front'), back: words.includes('back') };
}

/**
 * `BOARD_DESIGN_SETTINGS::m_TentViasFront/Back`, which both default to **true**.
 * Tented means covered by mask, i.e. *not* probeable.
 */
export function boardTentVias(board: Board): { front: boolean; back: boolean } {
  const t = tentingOf(childList(board.source, 'setup'));
  return { front: t.front ?? true, back: t.back ?? true };
}

/** `PCB_VIA::IsTented`: the via's own setting wins, else the board default. */
export function viaIsTented(board: Board, via: PcbVia, side: 'front' | 'back'): boolean {
  const own = tentingOf(via.source)[side];
  return own ?? boardTentVias(board)[side];
}

// ---------------------------------------------------------------------------
// Records

const netNameOf = (board: Board, net: number | undefined): string =>
  net === undefined ? '' : (board.nets.get(net) ?? '');

const copperLayerCount = (board: Board): number =>
  board.layers.filter(
    (l) => layerNameToId(l.name) !== undefined && isCopperId(layerNameToId(l.name)!),
  ).length;

/** `build_via_testpoints`. */
export function buildViaTestpoints(board: Board): D356Record[] {
  const origin = boardAuxOrigin(board);
  const count = copperLayerCount(board);

  return board.vias.map((via) => {
    const { top, bottom } = viaLayerPair(via);

    // `hole` is unconditionally true for a via, even one whose drill is 0 —
    // the D0000P field is still emitted.
    return {
      smd: false,
      hole: true,
      mechanical: false,
      midpoint: true,
      netname: netNameOf(board, via.net),
      refdes: 'VIA',
      pin: '',
      drill: via.drill,
      access: viaAccessCode(count, top, bottom),
      xLocation: via.at.x - origin.x,
      yLocation: origin.y - via.at.y,
      xSize: via.size,
      ySize: 0,
      rotation: 0,
      soldermask:
        (viaIsTented(board, via, 'front') ? 1 : 0) | (viaIsTented(board, via, 'back') ? 2 : 0),
    };
  });
}

/**
 * The drill upstream would see.
 *
 * `np_thru_hole` diverges: our reader leaves a missing `(drill …)` as 1 nm,
 * mirroring what the parser does for `thru_hole`, but upstream's NPTH pads keep
 * the `PAD` constructor default of 30 mils because the NPTH branch never
 * overwrites it. Compensating here rather than in `read-board` keeps a shared
 * reader out of an exporter change.
 */
function padDrill(pad: PcbPad): number {
  if (pad.type === 'smd' || pad.type === 'connect') return 0;

  const stated = childList(pad.source, 'drill') !== undefined;
  if (!stated && pad.type === 'np_thru_hole') return 762_000;
  if (!pad.drill) return stated ? 0 : 1;

  return Math.min(pad.drill.w, pad.drill.h);
}

/** `build_pad_testpoints`. */
export function buildPadTestpoints(board: Board, doNotExportUnconnectedPads = false): D356Record[] {
  const origin = boardAuxOrigin(board);
  const count = copperLayerCount(board);
  const out: D356Record[] = [];

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      const layerIds = expandLayerTokens(pad.layers);
      const access = computePadAccessCode(count, layerIds);
      if (access === -1) continue;

      // `SetAttribute(NPTH)` clears the pad number and net at parse time
      // upstream; our reader keeps whatever the file said, so force both.
      const npth = pad.type === 'np_thru_hole';
      const net = npth ? 0 : (pad.net ?? 0);
      const pin = npth ? '' : pad.number;

      if (doNotExportUnconnectedPads && net === 0) continue;

      const drill = padDrill(pad);
      // Truncates toward zero rather than rounding — a C++ double assigned to
      // an int — so 30.7 deg gives -30, not -31. The += 360 runs exactly once.
      let rotation = Math.trunc(-(((pad.angle % 360) + 360) % 360));
      if (rotation < 0) rotation += 360;

      out.push({
        smd: pad.type === 'smd' || pad.type === 'connect',
        hole: drill !== 0,
        mechanical: npth,
        // A named pad is a component terminal; an unnamed copper feature is
        // only reachable mid-net, so it is a midpoint per IPC-D-356A.
        midpoint: pin === '',
        netname: netNameOf(board, net),
        refdes: fp.reference ?? '',
        pin,
        drill,
        access,
        xLocation: pad.at.x - origin.x,
        yLocation: origin.y - pad.at.y,
        xSize: pad.size.x,
        // An explicit IPC rule, not an optimisation: a round pad has no second
        // dimension. Only `circle` — oval and roundrect keep their real y.
        ySize: pad.shape === 'circle' ? 0 : pad.size.y,
        rotation,
        soldermask: 3 & ~(layerIds.has(F_MASK) ? 1 : 0) & ~(layerIds.has(B_MASK) ? 2 : 0),
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Formatting

/**
 * `%-N.Ns`: truncate and pad to N **bytes**, as `TO_UTF8` does.
 *
 * Refdes and pin are not sanitised the way net names are, so a non-ASCII
 * reference can be cut mid-sequence. Counting UTF-16 units instead would shift
 * every following column on exactly the boards where that happens.
 */
function fixedBytes(value: string, width: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= width) return value + ' '.repeat(width - bytes.length);
  return new TextDecoder().decode(bytes.slice(0, width)).replace(/�+$/, '').padEnd(width, ' ');
}

/** `%0Nd` on a possibly negative value. */
const pad0 = (v: number, width: number): string =>
  (v < 0 ? '-' : '') + String(Math.abs(v)).padStart(v < 0 ? width - 1 : width, '0');

/** `%+07d`: the sign counts toward the width. */
const signed7 = (v: number): string => (v < 0 ? '-' : '+') + String(Math.abs(v)).padStart(6, '0');

/**
 * `intern_new_d356_netname`.
 *
 * Truncation keeps the **tail**, not the head, so two long names sharing a
 * suffix collide and go through the `#N` path. That path can itself push a name
 * past 14 characters, which `%-14.14s` then truncates back — so two distinct
 * interned names can print identically. Upstream does not guard it and neither
 * does this.
 */
export function internNewD356Netname(
  rawName: string,
  map: Map<string, string>,
  used: Set<string>,
): string {
  let canon = '';
  for (const ch of rawName) {
    const code = ch.codePointAt(0) ?? 0;
    // `ch > 126 || !isgraph(ch)` under the C locale: space and controls too.
    canon += code > 126 || code <= 32 ? '?' : ch;
  }
  canon = canon.toUpperCase();
  if (canon.length > 14) canon = canon.slice(-14);

  if (used.has(canon)) {
    const base = canon.length > 10 ? canon.slice(-10) : canon;
    let ctr = 0;
    do {
      ctr++;
      canon = `${base}#${ctr}`;
    } while (used.has(canon));
  }

  map.set(rawName, canon);
  used.add(canon);
  return canon;
}

/** `write_D356_records`. */
export function writeD356Records(records: readonly D356Record[]): string {
  const map = new Map<string, string>();
  const used = new Set<string>();
  let out = '';

  for (const rk of records) {
    // An empty net is the literal N/C and is never interned — so a real net
    // that canonicalises to N/C collides with it. Reproduced, not fixed.
    const net =
      rk.netname === ''
        ? 'N/C'
        : (map.get(rk.netname) ?? internNewD356Netname(rk.netname, map, used));

    const rktype = rk.smd ? 327 : rk.mechanical ? 367 : rk.access === 0 ? 317 : 307;

    out += `${pad0(rktype, 3)}${fixedBytes(net, 14)}   ${fixedBytes(rk.refdes, 6)}`;
    out += `${rk.pin === '' ? ' ' : '-'}${fixedBytes(rk.pin, 4)}${rk.midpoint ? 'M' : ' '}`;

    out += rk.hole ? `D${pad0(iuToD356(rk.drill, 9999), 4)}${rk.mechanical ? 'U' : 'P'}` : '      ';

    out += `A${pad0(rk.access, 2)}X${signed7(iuToD356(rk.xLocation, 999999))}`;
    out += `Y${signed7(iuToD356(rk.yLocation, 999999))}`;
    out += `X${pad0(iuToD356(rk.xSize, 9999), 4)}Y${pad0(iuToD356(rk.ySize, 9999), 4)}`;
    out += `R${pad0(rk.rotation, 3)}`;

    out += `S${rk.soldermask}\n`;
  }

  return out;
}

/**
 * `IPC356D_WRITER::Write`, minus the file I/O.
 *
 * Vias first, then pads — see the note at the top of the file; the order
 * decides which record wins an ambiguous net name.
 */
export function exportD356(
  board: Board,
  opts: { doNotExportUnconnectedPads?: boolean } = {},
): string {
  const records = [
    ...buildViaTestpoints(board),
    ...buildPadTestpoints(board, opts.doNotExportUnconnectedPads ?? false),
  ];

  return `P  CODE 00\nP  UNITS CUST 0\nP  arrayDim   N\n${writeD356Records(records)}999\n`;
}
