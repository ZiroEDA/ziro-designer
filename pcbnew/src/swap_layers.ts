// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Moving board items from one copper layer to another.
 * Counterparts: `DIALOG_SWAP_LAYERS` (pcbnew/dialogs/dialog_swap_layers.cpp)
 * and `GLOBAL_EDIT_TOOL::SwapLayers` (pcbnew/tools/global_edit_tool.cpp:133).
 *
 * ## It is a one-way map, not a swap
 *
 * There is no swap operator anywhere in the upstream code, and the name is
 * misleading. The dialog is a grid with one row per *enabled copper layer* —
 * "move items on X to layer Y" — so the result is an arbitrary function from
 * the enabled copper layers onto themselves. It need not be injective: mapping
 * two layers onto one merges them, silently and without confirmation.
 *
 * A genuine swap is just two rows (F.Cu→B.Cu, B.Cu→F.Cu). That works because
 * the map is applied to a *snapshot* of each item's layers — the new set is
 * built from the original in one pass, so the mapping is simultaneous and can
 * never be applied twice to the same item.
 *
 * ## What it deliberately does not touch
 *
 * Footprints and pads are not in the four collections upstream visits, so
 * swapping F.Cu and B.Cu moves the tracks and leaves every pad where it was.
 * The board ends up electrically inconsistent. That is upstream's behaviour and
 * this port reproduces it rather than improving on it: a "helpful" port that
 * also moved footprints would silently do something KiCad does not, and a board
 * round-tripped through both would differ.
 *
 * Items on non-copper layers never move either — silk, mask, paste, Edge.Cuts
 * and user layers are neither keys nor values of the map.
 */
import { dropChild, patchChild } from './edit-board.js';
import type { SList, SNode } from '@ziroeda/sexpr/src/types.js';
import type { Board, PcbShape, PcbTrack, PcbArcTrack, PcbVia, PcbZone } from './types.js';

const atom = (value: string): SNode => ({ kind: 'atom', value });
const str = (value: string): SNode => ({ kind: 'string', value });
const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** `IsCopperLayer` (layer_ids.h), by name: the front, the back, or an inner. */
export function isCopperLayerName(name: string): boolean {
  return /^(F|B|In\d+)\.Cu$/.test(name);
}

/**
 * Physical depth in the stack, used to order a via's layer pair.
 *
 * Note this is *not* the ordinal a layer is written with. KiCad has three
 * different orders in play here and confusing them is the easy mistake: the
 * dialog's rows run F.Cu, In1…, B.Cu (back last); a written layer list runs by
 * `PCB_LAYER_ID`, where B.Cu is *second*; and the via comparator wants physical
 * depth, where the back is deepest. This is the third one.
 */
export function copperRank(name: string): number {
  if (name === 'F.Cu') return 0;
  if (name === 'B.Cu') return Number.POSITIVE_INFINITY;
  const m = /^In(\d+)\.Cu$/.exec(name);
  return m ? Number(m[1]) : Number.NaN;
}

/**
 * The dialog's rows: `LSET::AllCuMask(copperLayerCount).UIOrder()`.
 *
 * Upstream's `CuStack()` iterator runs front, then the inners in order, then
 * the back — so **B.Cu is last, not second**. Taking the board's own layer
 * table rather than synthesising names means a board whose inner layers are
 * disabled does not get rows for layers it does not have.
 */
export function enabledCopperLayers(board: Board): string[] {
  const copper = board.layers.map((l) => l.name).filter(isCopperLayerName);
  return copper.sort((a, b) => copperRank(a) - copperRank(b));
}

/**
 * `TransferDataToWindow` + `TransferDataFromWindow`.
 *
 * The map upstream builds is **total**: every enabled copper layer gets an
 * entry, identity rows included, because each row is seeded with its own layer
 * as the default destination. A sparse map of "only what the user changed"
 * behaves identically for items — the lookup falls back to identity either way
 * — but *not* for vias, whose change test reads the map directly. Building it
 * total keeps the via branch honest.
 *
 * A destination that is not an enabled copper layer is dropped and the row
 * stays identity, matching upstream's
 * `if (dest >= 0 && dest < PCB_LAYER_ID_COUNT && enabled.test(dest))`.
 */
export function buildSwapLayerMap(
  board: Board,
  chosen: ReadonlyMap<string, string>,
): Map<string, string> {
  const enabled = enabledCopperLayers(board);
  const valid = new Set(enabled);
  const map = new Map<string, string>();

  for (const layer of enabled) {
    const dest = chosen.get(layer);
    map.set(layer, dest !== undefined && valid.has(dest) ? dest : layer);
  }

  return map;
}

/**
 * One item's layer set through the map: `swapBoardItem`'s core.
 *
 * Upstream's `LSET` is a bitset, so the result is a *set* — mapping two layers
 * onto one leaves one layer, not two. Duplicates must collapse here too, or a
 * merged zone would be written with the same layer twice.
 */
export function swapItemLayers(
  layers: readonly string[],
  map: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const layer of layers) {
    const next = map.get(layer) ?? layer;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

/**
 * Zone layer sets can hold the wildcards the file format allows.
 *
 * `read-board.ts` stores a zone's `(layers …)` verbatim, so `*.Cu` and `F&B.Cu`
 * survive into the model as literal strings where KiCad's parser would already
 * have expanded them into a real `LSET`. Neither spelling is a key in the map,
 * so without this a zone on `F&B.Cu` would not move at all — the swap would
 * appear to work everywhere else and silently skip exactly the zones most
 * likely to be on both sides.
 */
function expandLayerWildcards(layers: readonly string[], board: Board): string[] {
  const copper = enabledCopperLayers(board);
  const out: string[] = [];

  for (const layer of layers) {
    const expanded = layer === '*.Cu' ? copper : layer === 'F&B.Cu' ? ['F.Cu', 'B.Cu'] : [layer];
    for (const l of expanded) if (!out.includes(l)) out.push(l);
  }

  return out;
}

/**
 * The `PCB_VIA` branch. Returns null when the via must be left alone.
 *
 * A **through via is skipped before its layers are even read** — upstream
 * `continue`s on `VIATYPE::THROUGH` at the top of the loop. That is correct
 * rather than an oversight: a through via spans the whole stack, so swapping
 * front and back cannot change it, and remapping its endpoints would invent a
 * blind via the user never asked for.
 *
 * Upstream calls `LayerPair()` first, which normalises so the shallower layer
 * comes first. That step is deliberately **not** reproduced: the result is
 * normalised on the way out anyway, and mapping is applied to each endpoint
 * independently, so ordering the inputs cannot change either the returned pair
 * or the "did anything move" test. Mutation testing confirms it — removing the
 * input normalisation changes no answer. Keeping it would be a line that looks
 * load-bearing and is not.
 */
export function swapViaLayerPair(
  via: PcbVia,
  map: ReadonlyMap<string, string>,
): [string, string] | null {
  if (via.kind === 'through') return null;

  const [a, b] = via.layers;
  const na = map.get(a) ?? a;
  const nb = map.get(b) ?? b;

  if (na === a && nb === b) return null;

  return copperRank(na) <= copperRank(nb) ? [na, nb] : [nb, na];
}

/** `(layer …)` / `(layers …)` are exclusive spellings; switching drops the other. */
function patchLayerChild(src: SList, layers: readonly string[]): SList {
  if (layers.length === 1)
    return patchChild(dropChild(src, 'layers'), 'layer', list(atom('layer'), str(layers[0]!)));
  return patchChild(dropChild(src, 'layer'), 'layers', {
    kind: 'list',
    items: [atom('layers'), ...layers.map(str)],
  });
}

/** A copper item that also opens the solder mask keeps the mask entry alongside. */
function patchCopperLayerChild(src: SList, layer: string, maskLayer?: string): SList {
  if (!maskLayer)
    return patchChild(dropChild(src, 'layers'), 'layer', list(atom('layer'), str(layer)));
  return patchChild(dropChild(src, 'layer'), 'layers', {
    kind: 'list',
    items: [atom('layers'), str(layer), str(maskLayer)],
  });
}

/** Every board collection is written from `source` when it has one, so a model-only change is lost on save. */
const hasSource = (s: SList): boolean => s.items.length > 0;

function movedTrack<T extends PcbTrack | PcbArcTrack>(t: T, map: ReadonlyMap<string, string>): T {
  const next = map.get(t.layer) ?? t.layer;
  if (next === t.layer) return t;

  // The mask layer is deliberately carried across unchanged. Upstream keeps a
  // *boolean* `m_hasSolderMask` that survives a trip through an inner layer,
  // while our model stores the mask layer's name; closing that gap means adding
  // a field to PcbTrack, which is its own change (see #318, where a Board field
  // added by sweep was silently wiped). Carrying the name is the conservative
  // half of the divergence — nothing is lost, only kept where upstream would
  // stop emitting it.
  return {
    ...t,
    layer: next,
    source: hasSource(t.source) ? patchCopperLayerChild(t.source, next, t.maskLayer) : t.source,
  };
}

function movedShape(s: PcbShape, map: ReadonlyMap<string, string>): PcbShape {
  const next = map.get(s.layer) ?? s.layer;
  if (next === s.layer) return s;
  return {
    ...s,
    layer: next,
    source: hasSource(s.source) ? patchCopperLayerChild(s.source, next, s.maskLayer) : s.source,
  };
}

function movedZone(z: PcbZone, map: ReadonlyMap<string, string>, board: Board): PcbZone {
  const original = expandLayerWildcards(z.layers, board);
  const next = swapItemLayers(original, map);

  const same = next.length === original.length && next.every((l, i) => l === original[i]);
  if (same) return z;

  // ZONE::SetLayerSet drops the filled polygons, the hashes and the island
  // lists whenever the set actually changes, and flags a refill. Keeping the
  // old fill would leave copper drawn on a layer the zone no longer occupies —
  // visually convincing and completely wrong.
  return {
    ...z,
    layers: next,
    fills: [],
    source: hasSource(z.source)
      ? patchLayerChild(dropChild(z.source, 'filled_polygon'), next)
      : z.source,
  };
}

/**
 * `GLOBAL_EDIT_TOOL::SwapLayers`.
 *
 * Returns the **same board reference** when nothing moved. Upstream guards its
 * commit with `if (hasChanges)`, so an all-identity map pushes no undo entry
 * and does not mark the board modified; returning a fresh object here would
 * dirty the editor for a no-op. That is the contract `applyZoneValues` and
 * `applyDimensionValues` already keep.
 */
export function swapBoardLayers(board: Board, map: ReadonlyMap<string, string>): Board {
  const tracks = board.tracks.map((t) => movedTrack(t, map));
  const arcs = board.arcs.map((a) => movedTrack(a, map));
  const shapes = board.shapes.map((s) => movedShape(s, map));
  const zones = board.zones.map((z) => movedZone(z, map, board));

  const vias = board.vias.map((v) => {
    const pair = swapViaLayerPair(v, map);
    if (!pair) return v;
    return {
      ...v,
      layers: pair,
      source: hasSource(v.source)
        ? patchChild(v.source, 'layers', {
            kind: 'list',
            items: [atom('layers'), str(pair[0]), str(pair[1])],
          })
        : v.source,
    };
  });

  const changed =
    tracks.some((t, i) => t !== board.tracks[i]) ||
    arcs.some((a, i) => a !== board.arcs[i]) ||
    shapes.some((s, i) => s !== board.shapes[i]) ||
    zones.some((z, i) => z !== board.zones[i]) ||
    vias.some((v, i) => v !== board.vias[i]);

  if (!changed) return board;

  return { ...board, tracks, arcs, shapes, zones, vias };
}
