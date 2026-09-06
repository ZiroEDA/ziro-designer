// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Track & Via Properties, headless.
 * Counterpart: `pcbnew/dialogs/dialog_track_via_properties.cpp`
 * (`TransferDataToWindow` / `TransferDataFromWindow`).
 *
 * The dialog edits a whole selection at once, so every field is three-state:
 * the first item seeds it, any later item that disagrees blanks it to
 * INDETERMINATE, and apply writes back only the fields that still hold a value.
 * That is the entire reason this is not a simple form — a blank width box means
 * "leave each track's own width alone", not "set the width to zero".
 *
 * The decision logic lives here so it can be tested without a UI.
 */

import { atom, isList, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { dropChild, mm, parseBoardItemId, patchChild } from './edit-board.js';
import { defaultTeardropParameters } from './teardrop.js';
import { buildTeardropParamsNode, isDefaultTeardropParams } from './write-footprint.js';
import type {
  Board,
  FrontBackOptBool,
  PcbArcTrack,
  PcbTrack,
  PcbVia,
  TeardropParams,
} from './types.js';
import { viaOuterLayerNodes } from './write-board.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });
const numNode = (name: string, iu: number): SList => list(atom(name), atom(mm(iu)));
const xyNode = (name: string, p: { x: number; y: number }): SList =>
  list(atom(name), atom(mm(p.x)), atom(mm(p.y)));

/**
 * `(locked yes)` is present-or-absent upstream, not a `no` value, so unlocking
 * drops the child rather than writing `(locked no)`.
 */
const patchLocked = (src: SList, locked: boolean): SList =>
  locked ? patchChild(src, 'locked', list(atom('locked'), atom('yes'))) : dropChild(src, 'locked');

/**
 * A copper item's layer children: `(layer …)` alone, or `(layers "F.Cu"
 * "F.Mask")` when it also opens the solder mask. Swapping between the two forms
 * means dropping the other spelling, or the file would carry both.
 */
function patchCopperLayers(src: SList, layer: string, maskLayer: string | undefined): SList {
  if (!maskLayer) {
    return patchChild(dropChild(src, 'layers'), 'layer', list(atom('layer'), str(layer)));
  }
  return patchChild(dropChild(src, 'layer'), 'layers', {
    kind: 'list',
    items: [atom('layers'), str(layer), str(maskLayer)],
  });
}

/**
 * The via type is a *positional* atom right after the head (`(via micro …)`),
 * so it cannot be patched like a child: the old one has to be removed and the
 * new one inserted in place.
 */
function patchViaKind(src: SList, kind: PcbVia['kind']): SList {
  const items = src.items.filter(
    (it) => isList(it) || it.kind !== 'atom' || !['micro', 'blind'].includes(it.value),
  );
  if (kind === 'through') return { kind: 'list', items };
  return { kind: 'list', items: [items[0]!, atom(kind), ...items.slice(1)] };
}

/** The mask layer that pairs with a copper layer, F.Cu -> F.Mask. */
const maskSideOf = (layer: string): string | undefined =>
  layer === 'F.Cu' ? 'F.Mask' : layer === 'B.Cu' ? 'B.Mask' : undefined;

/** The tracks, arcs and vias a selection names, in board order. */
export interface TrackViaSelection {
  tracks: { index: number; item: PcbTrack }[];
  arcs: { index: number; item: PcbArcTrack }[];
  vias: { index: number; item: PcbVia }[];
}

/**
 * Every field the dialog edits. `undefined` is INDETERMINATE — the selection
 * disagrees, or the field does not apply — and apply leaves it alone.
 */
export interface TrackViaValues {
  // ----- Common -----
  net?: number;
  locked?: boolean;

  // ----- Tracks -----
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  trackWidth?: number;
  layer?: string;
  /** Whether the track opens the solder mask (PCB_TRACK::HasSolderMask). */
  hasMask?: boolean;
  /** `(solder_mask_margin …)`; null means "use the Board Setup value". */
  maskMargin?: number | null;

  // ----- Vias -----
  viaX?: number;
  viaY?: number;
  viaDiameter?: number;
  viaDrill?: number;
  viaType?: PcbVia['kind'];
  startLayer?: string;
  endLayer?: string;
  /**
   * The PADSTACK outer-layer flags. `undefined` here is "not being edited";
   * the flag's own third state — take the board stackup's — is the `front`/`back`
   * field being absent inside the object.
   */
  tenting?: FrontBackOptBool;
  covering?: FrontBackOptBool;
  plugging?: FrontBackOptBool;
  /** `null` is the third state (`none`): follow the board. */
  capping?: boolean | null;
  filling?: boolean | null;

  // ----- Teardrops (per item, `(teardrops …)`) -----
  tdEnabled?: boolean;
  tdAllowTwoTracks?: boolean;
  tdCurvedEdges?: boolean;
  tdMaxLen?: number;
  tdMaxWidth?: number;
  /** Percentages, as the dialog shows them (ratio x 100). */
  tdBestLengthPct?: number;
  tdBestWidthPct?: number;
  tdFilterPct?: number;
}

/** Resolve `track:N` / `arc:N` / `via:N` ids against the board. */
export function trackViaSelection(board: Board, selection: Iterable<string>): TrackViaSelection {
  const out: TrackViaSelection = { tracks: [], arcs: [], vias: [] };

  for (const id of selection) {
    const ref = parseBoardItemId(id);
    if (!ref) continue;

    if (ref.kind === 'track') {
      const item = board.tracks[ref.index];
      if (item) out.tracks.push({ index: ref.index, item });
    } else if (ref.kind === 'arc') {
      const item = board.arcs[ref.index];
      if (item) out.arcs.push({ index: ref.index, item });
    } else if (ref.kind === 'via') {
      const item = board.vias[ref.index];
      if (item) out.vias.push({ index: ref.index, item });
    }
  }

  return out;
}

/** Is this selection something the dialog can edit at all? */
export const hasTrackOrVia = (sel: TrackViaSelection): boolean =>
  sel.tracks.length > 0 || sel.arcs.length > 0 || sel.vias.length > 0;

/**
 * Fold a value into a field: the first item seeds it, a disagreement blanks it.
 *
 * `seeded` tracks whether the field has been written yet, because `undefined`
 * cannot distinguish "not seeded" from "already indeterminate" — and a field
 * that has gone indeterminate must stay that way even if a later item happens
 * to match the seed.
 */
class Folder<T> {
  private seeded = false;
  private indeterminate = false;
  private value: T | undefined;

  add(v: T | undefined): void {
    if (!this.seeded) {
      this.seeded = true;
      this.value = v;
      return;
    }
    if (this.indeterminate) return;
    if (v !== this.value) {
      this.indeterminate = true;
      this.value = undefined;
    }
  }

  get(): T | undefined {
    return this.indeterminate ? undefined : this.value;
  }
}

const paramsOf = (via: PcbVia): TeardropParams => via.teardrops ?? defaultTeardropParameters();

/**
 * DIALOG_TRACK_VIA_PROPERTIES::TransferDataToWindow: seed the form from the
 * selection, blanking anything the items disagree on.
 */
export function collectTrackViaValues(sel: TrackViaSelection): TrackViaValues {
  const net = new Folder<number>();
  const locked = new Folder<boolean>();

  const startX = new Folder<number>();
  const startY = new Folder<number>();
  const endX = new Folder<number>();
  const endY = new Folder<number>();
  const trackWidth = new Folder<number>();
  const layer = new Folder<string>();
  const hasMask = new Folder<boolean>();
  const maskMargin = new Folder<number | null>();

  const viaX = new Folder<number>();
  const viaY = new Folder<number>();
  const viaDiameter = new Folder<number>();
  const viaDrill = new Folder<number>();
  const viaType = new Folder<PcbVia['kind']>();
  const startLayer = new Folder<string>();
  const endLayer = new Folder<string>();

  const tdEnabled = new Folder<boolean>();
  const tdAllowTwoTracks = new Folder<boolean>();
  const tdCurvedEdges = new Folder<boolean>();
  const tdMaxLen = new Folder<number>();
  const tdMaxWidth = new Folder<number>();
  const tdBestLengthPct = new Folder<number>();
  const tdBestWidthPct = new Folder<number>();
  const tdFilterPct = new Folder<number>();

  // Straight tracks own the Start/End boxes; an arc's endpoints are driven by
  // its mid point, so upstream leaves them out of the geometry fields.
  for (const { item } of sel.tracks) {
    net.add(item.net);
    locked.add(item.locked ?? false);
    startX.add(item.start.x);
    startY.add(item.start.y);
    endX.add(item.end.x);
    endY.add(item.end.y);
    trackWidth.add(item.width);
    layer.add(item.layer);
    hasMask.add(item.maskLayer !== undefined);
    maskMargin.add(item.solderMaskMargin ?? null);
  }

  for (const { item } of sel.arcs) {
    net.add(item.net);
    locked.add(item.locked ?? false);
    trackWidth.add(item.width);
    layer.add(item.layer);
    hasMask.add(item.maskLayer !== undefined);
    maskMargin.add(item.solderMaskMargin ?? null);
    // Blank the endpoint boxes: an arc in the selection makes them meaningless.
    startX.add(undefined);
    startY.add(undefined);
    endX.add(undefined);
    endY.add(undefined);
  }

  for (const { item } of sel.vias) {
    net.add(item.net);
    locked.add(item.locked ?? false);
    viaX.add(item.at.x);
    viaY.add(item.at.y);
    viaDiameter.add(item.size);
    viaDrill.add(item.drill);
    viaType.add(item.kind);
    startLayer.add(item.layers[0]);
    endLayer.add(item.layers[1]);

    const td = paramsOf(item);
    tdEnabled.add(td.enabled);
    tdAllowTwoTracks.add(td.allowUseTwoTracks);
    tdCurvedEdges.add(td.curvedEdges);
    tdMaxLen.add(td.tdMaxLen);
    tdMaxWidth.add(td.tdMaxWidth);
    tdBestLengthPct.add(td.bestLengthRatio * 100);
    tdBestWidthPct.add(td.bestWidthRatio * 100);
    tdFilterPct.add(td.widthtoSizeFilterRatio * 100);
  }

  return {
    net: net.get(),
    locked: locked.get(),
    startX: startX.get(),
    startY: startY.get(),
    endX: endX.get(),
    endY: endY.get(),
    trackWidth: trackWidth.get(),
    layer: layer.get(),
    hasMask: hasMask.get(),
    maskMargin: maskMargin.get(),
    viaX: viaX.get(),
    viaY: viaY.get(),
    viaDiameter: viaDiameter.get(),
    viaDrill: viaDrill.get(),
    viaType: viaType.get(),
    startLayer: startLayer.get(),
    endLayer: endLayer.get(),
    tdEnabled: tdEnabled.get(),
    tdAllowTwoTracks: tdAllowTwoTracks.get(),
    tdCurvedEdges: tdCurvedEdges.get(),
    tdMaxLen: tdMaxLen.get(),
    tdMaxWidth: tdMaxWidth.get(),
    tdBestLengthPct: tdBestLengthPct.get(),
    tdBestWidthPct: tdBestWidthPct.get(),
    tdFilterPct: tdFilterPct.get(),
  };
}

/**
 * Apply the fields that still hold a value, patching the item's source node in
 * step. A model change without the matching patch is invisible on save: the
 * writer emits the item's stored source verbatim.
 */
function applyToTrack<T extends PcbTrack | PcbArcTrack>(item: T, v: TrackViaValues): T {
  let next: T = { ...item };
  let src = item.source;
  let changed = false;

  if (v.net !== undefined && v.net !== item.net) {
    next.net = v.net;
    src = patchChild(src, 'net', list(atom('net'), atom(String(v.net))));
    changed = true;
  }

  if (v.trackWidth !== undefined && v.trackWidth !== item.width) {
    next.width = v.trackWidth;
    src = patchChild(src, 'width', numNode('width', v.trackWidth));
    changed = true;
  }

  if (v.locked !== undefined && v.locked !== (item.locked ?? false)) {
    next.locked = v.locked;
    src = patchLocked(src, v.locked);
    changed = true;
  }

  // Layer and mask are one decision: the file spells them as `(layer …)` or
  // `(layers copper mask)`, never both.
  const layer = v.layer ?? item.layer;
  const wantsMask = v.hasMask ?? item.maskLayer !== undefined;
  const maskLayer = wantsMask ? maskSideOf(layer) : undefined;

  if (layer !== item.layer || maskLayer !== item.maskLayer) {
    next.layer = layer;
    next.maskLayer = maskLayer;
    src = patchCopperLayers(src, layer, maskLayer);
    changed = true;
  }

  if (v.maskMargin !== undefined) {
    const margin = v.maskMargin === null ? undefined : v.maskMargin;
    if (margin !== item.solderMaskMargin) {
      next.solderMaskMargin = margin;
      src =
        margin === undefined
          ? dropChild(src, 'solder_mask_margin')
          : patchChild(src, 'solder_mask_margin', numNode('solder_mask_margin', margin));
      changed = true;
    }
  }

  if (!changed) return item;

  next = { ...next, source: src };
  return next;
}

/** Move one endpoint of a straight track, patching `(start …)` / `(end …)`. */
function applyTrackGeometry(track: PcbTrack, v: TrackViaValues): PcbTrack {
  const start = { x: v.startX ?? track.start.x, y: v.startY ?? track.start.y };
  const end = { x: v.endX ?? track.end.x, y: v.endY ?? track.end.y };

  const movedStart = start.x !== track.start.x || start.y !== track.start.y;
  const movedEnd = end.x !== track.end.x || end.y !== track.end.y;

  if (!movedStart && !movedEnd) return track;

  let src = track.source;
  if (movedStart) src = patchChild(src, 'start', xyNode('start', start));
  if (movedEnd) src = patchChild(src, 'end', xyNode('end', end));

  return { ...track, start, end, source: src };
}

/** Apply the via half, patching `(at …)`, `(size …)`, `(drill …)`, … */
function applyToVia(via: PcbVia, v: TrackViaValues): PcbVia {
  const next: PcbVia = { ...via };
  let src = via.source;
  let changed = false;

  const at = { x: v.viaX ?? via.at.x, y: v.viaY ?? via.at.y };
  if (at.x !== via.at.x || at.y !== via.at.y) {
    next.at = at;
    src = patchChild(src, 'at', xyNode('at', at));
    changed = true;
  }

  if (v.net !== undefined && v.net !== via.net) {
    next.net = v.net;
    src = patchChild(src, 'net', list(atom('net'), atom(String(v.net))));
    changed = true;
  }

  if (v.locked !== undefined && v.locked !== (via.locked ?? false)) {
    next.locked = v.locked;
    src = patchLocked(src, v.locked);
    changed = true;
  }

  if (v.viaDiameter !== undefined && v.viaDiameter !== via.size) {
    next.size = v.viaDiameter;
    src = patchChild(src, 'size', numNode('size', v.viaDiameter));
    changed = true;
  }

  if (v.viaDrill !== undefined && v.viaDrill !== via.drill) {
    next.drill = v.viaDrill;
    src = patchChild(src, 'drill', numNode('drill', v.viaDrill));
    changed = true;
  }

  if (v.viaType !== undefined && v.viaType !== via.kind) {
    next.kind = v.viaType;
    src = patchViaKind(src, v.viaType);
    changed = true;
  }

  const layers: [string, string] = [v.startLayer ?? via.layers[0], v.endLayer ?? via.layers[1]];
  if (layers[0] !== via.layers[0] || layers[1] !== via.layers[1]) {
    next.layers = layers;
    src = patchChild(src, 'layers', {
      kind: 'list',
      items: [atom('layers'), str(layers[0]), str(layers[1])],
    });
    changed = true;
  }

  for (const key of ['tenting', 'covering', 'plugging'] as const) {
    const want = v[key];
    if (want === undefined) continue;
    const have = via[key] ?? {};
    if (want.front === have.front && want.back === have.back) continue;
    next[key] = want;
    src =
      want.front === undefined && want.back === undefined
        ? dropChild(src, key)
        : patchChild(src, key, viaOuterLayerNodes({ ...next, [key]: want })[0] ?? src);
    changed = true;
  }

  for (const key of ['capping', 'filling'] as const) {
    const want = v[key];
    if (want === undefined) continue;
    const value = want === null ? undefined : want;
    if (value === via[key]) continue;
    next[key] = value;
    src =
      value === undefined
        ? dropChild(src, key)
        : patchChild(src, key, list(atom(key), atom(value ? 'yes' : 'no')));
    changed = true;
  }

  const td = paramsOf(via);
  const nextTd: TeardropParams = {
    ...td,
    enabled: v.tdEnabled ?? td.enabled,
    allowUseTwoTracks: v.tdAllowTwoTracks ?? td.allowUseTwoTracks,
    curvedEdges: v.tdCurvedEdges ?? td.curvedEdges,
    tdMaxLen: v.tdMaxLen ?? td.tdMaxLen,
    tdMaxWidth: v.tdMaxWidth ?? td.tdMaxWidth,
    bestLengthRatio: v.tdBestLengthPct === undefined ? td.bestLengthRatio : v.tdBestLengthPct / 100,
    bestWidthRatio: v.tdBestWidthPct === undefined ? td.bestWidthRatio : v.tdBestWidthPct / 100,
    widthtoSizeFilterRatio:
      v.tdFilterPct === undefined ? td.widthtoSizeFilterRatio : v.tdFilterPct / 100,
  };

  if ((Object.keys(nextTd) as (keyof TeardropParams)[]).some((k) => nextTd[k] !== td[k])) {
    next.teardrops = nextTd;
    src = isDefaultTeardropParams(nextTd)
      ? dropChild(src, 'teardrops')
      : patchChild(src, 'teardrops', buildTeardropParamsNode(nextTd));
    changed = true;
  }

  return changed ? { ...next, source: src } : via;
}

/**
 * DIALOG_TRACK_VIA_PROPERTIES::TransferDataFromWindow.
 *
 * Editing a coordinate box moves that endpoint on every selected track, which
 * is upstream's behaviour and only makes sense because the box is blank unless
 * the whole selection already shared the value.
 */
export function applyTrackViaValues(
  board: Board,
  sel: TrackViaSelection,
  v: TrackViaValues,
): Board {
  const trackIdx = new Set(sel.tracks.map((t) => t.index));
  const arcIdx = new Set(sel.arcs.map((a) => a.index));
  const viaIdx = new Set(sel.vias.map((x) => x.index));

  let changed = false;

  const tracks = board.tracks.map((t, i) => {
    if (!trackIdx.has(i)) return t;
    const next = applyTrackGeometry(applyToTrack(t, v), v);
    if (next !== t) changed = true;
    return next;
  });

  const arcs = board.arcs.map((a, i) => {
    if (!arcIdx.has(i)) return a;
    const next = applyToTrack(a, v);
    if (next !== a) changed = true;
    return next;
  });

  const vias = board.vias.map((via, i) => {
    if (!viaIdx.has(i)) return via;
    const next = applyToVia(via, v);
    if (next !== via) changed = true;
    return next;
  });

  return changed ? { ...board, tracks, arcs, vias } : board;
}
