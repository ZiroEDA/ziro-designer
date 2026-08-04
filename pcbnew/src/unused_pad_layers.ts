// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Remove Unused Pads, the engine behind `Tools → Remove Unused Pads…`.
 * Counterparts: `DIALOG_UNUSED_PAD_LAYERS::updatePadsAndVias`
 * (pcbnew/dialogs/dialog_unused_pad_layers.cpp:87) for the bulk edit, and
 * `PAD::FlashLayer` / `PCB_VIA::FlashLayer` (pad.cpp:650, pcb_track.cpp:1949)
 * for the rule the edit arms.
 *
 * ## The dialog does not delete anything
 *
 * "Remove Unused Layers" writes one enum — `UNCONNECTED_LAYER_MODE` — onto
 * every through-hole pad and via in scope. Nothing is recomputed, no annular
 * ring is measured, and no copper is dropped at save time: the *renderer*, the
 * zone filler and the plotters each ask `FlashLayer()` afresh, so the answer
 * follows the routing around. That is why "Restore All Layers" is a one-field
 * reset rather than an undo — and why a pad that gains a track next week grows
 * its ring back with no further user action.
 *
 * ## Which layers count as "used"
 *
 * A layer is used when the item is **connected on it by a track, arc, via or
 * pad** — a zone touching it does not count, because a zone that only reaches
 * the pad *because* the pad is flashed there would make the rule circular.
 * (Upstream passes an explicit `{ PCB_TRACE_T, PCB_ARC_T, PCB_VIA_T, PCB_PAD_T }`
 * type list to `IsConnectedOnLayer` for exactly that reason, then re-admits
 * zones through the `ZLO_FORCE_FLASHED` override the filler writes back after
 * a fill.) This port has no connectivity graph, so {@link padFlashState} and
 * {@link viaFlashState} return `'if-connected'` for that case instead of
 * guessing: every branch that upstream decides *without* consulting
 * connectivity is decided here, and the one that needs it is named.
 *
 * ## The outer layers are kept — but "outer" means two different things
 *
 * The dialog's "Keep outside layers" checkbox is on by default (a through-hole
 * pad with no ring on the outside cannot be soldered), and it picks
 * `REMOVE_EXCEPT_START_AND_END` over `REMOVE_ALL`. Under that one mode:
 *
 * - a **pad** keeps `IsExternalCopperLayer( layer )` — literally F.Cu and B.Cu;
 * - a **via** keeps `Drill().start` and `Drill().end` — its *own* endpoints.
 *
 * So the same checkbox spares the board's outer layers on a pad and the via's
 * own outer layers on a blind via, whose endpoints may both be inner layers.
 * The names ("keep top/bottom" vs "keep start/end") record the difference; the
 * code is easy to unify by mistake, and unifying it changes real boards.
 *
 * A second trap in the same family: `ConditionallyFlashed` — the predicate the
 * zone filler and the connectivity engine use — tests `Drill().start/end` for
 * *both* item kinds, so it disagrees with `PAD::FlashLayer` for a pad whose
 * drill does not span F.Cu→B.Cu. Our pad model has no per-pad drill layer pair
 * (KiCad's `PADSTACK` defaults it to F.Cu/B.Cu and only backdrills change it),
 * so the two coincide here; the divergence is documented rather than removed.
 */

import { layerNameToId, viaIsTented } from './export_d356.js';
import { enabledCopperLayers, isCopperLayerName } from './swap_layers.js';
import { dropChild, patchChild } from './edit-board.js';
import { atom } from '@ziroeda/sexpr/src/index.js';
import type { SList } from '@ziroeda/sexpr/src/types.js';
import type { Board, PcbFootprint, PcbPad, PcbVia, UnconnectedLayerMode } from './types.js';

const F_CU = 0;
const B_CU = 2;

/** `LSET::FrontBoardTechMask()` (common/lset.cpp:665) — the *board* tech mask,
 *  which excludes courtyard and fab. `PAD::FlashLayer` folds these onto F.Cu. */
const FRONT_BOARD_TECH = new Set(['F.SilkS', 'F.Mask', 'F.Adhes', 'F.Paste']);
/** `LSET::BackBoardTechMask()` (common/lset.cpp:651). */
const BACK_BOARD_TECH = new Set(['B.SilkS', 'B.Mask', 'B.Adhes', 'B.Paste']);

/** `IsExternalCopperLayer` (layer_ids.h:694): F.Cu or B.Cu, nothing else. */
export const isExternalCopperLayer = (layer: string): boolean =>
  layer === 'F.Cu' || layer === 'B.Cu';

/** `PADSTACK::UnconnectedLayerMode()`; an absent field is KiCad's default. */
export const unconnectedLayerModeOf = (item: PcbPad | PcbVia): UnconnectedLayerMode =>
  item.unconnectedLayerMode ?? 'keep_all';

/** `GetRemoveUnconnected()` (pad.h:862) — *any* mode but `keep_all`, so a
 *  `start_end_only` via reads as "removing", which is what the writer keys on. */
export const getRemoveUnconnected = (item: PcbPad | PcbVia): boolean =>
  unconnectedLayerModeOf(item) !== 'keep_all';

/** `GetKeepTopBottom()` / `GetKeepStartEnd()` — the one specific mode. */
export const getKeepEndLayers = (item: PcbPad | PcbVia): boolean =>
  unconnectedLayerModeOf(item) === 'remove_except_start_and_end';

// ---------------------------------------------------------------------------
// The board's stack

/** `BOARD::GetCopperLayerCount()`, taken from the board's own layer table. */
export const boardCopperLayerCount = (board: Board): number => enabledCopperLayers(board).length;

/**
 * `BOARD::LayerDepth` (board.cpp:1031), verbatim — including the unit mix-up
 * at its heart, which is why it takes raw `PCB_LAYER_ID`s rather than names.
 *
 * The subtraction happens in *layer id* space, where copper ids run
 * F.Cu = 0, B.Cu = 2, In1.Cu = 4, In2.Cu = 6 … — adjacent inner layers are two
 * apart, so a one-layer step scores 2. But when the deeper endpoint is B.Cu it
 * is first replaced by `F_Cu + GetCopperLayerCount() - 1`, a value in *stack
 * index* space. On a four-layer board F.Cu→B.Cu therefore scores 3, not 2 and
 * not 62. Normalising either side to a consistent space would change which
 * vias the dialog considers, so the mix-up is reproduced.
 */
export function boardLayerDepth(board: Board, aStartLayer: number, aEndLayer: number): number {
  let start = aStartLayer;
  let end = aEndLayer;

  if (start > end) [start, end] = [end, start];

  if (end === B_CU) end = F_CU + boardCopperLayerCount(board) - 1;

  return end - start;
}

// ---------------------------------------------------------------------------
// Eligibility: which items the dialog will even touch

/**
 * The `viaHasPotentiallyUnusedLayers` lambda (dialog:89).
 *
 * A through via on a two-layer board is skipped — there is no third layer to
 * take copper off, and clearing the flag on it would be a silent no-op that
 * still dirties the file. Everything else goes through {@link boardLayerDepth},
 * where the threshold is `> 1`: since a one-inner-layer step already scores 2,
 * the only spans that fail are a degenerate start == end via and F.Cu→B.Cu on a
 * two-layer board. Micro vias are **not** special-cased; upstream tests only
 * `VIATYPE::THROUGH`, so a micro via takes the depth branch and passes.
 *
 * An endpoint the board's layer table does not name stands in for upstream's
 * `startLayer < 0` (`UNDEFINED_LAYER`) and falls back to the layer-count test.
 */
export function viaHasPotentiallyUnusedLayers(board: Board, via: PcbVia): boolean {
  if (via.kind === 'through') return boardCopperLayerCount(board) > 2;

  const start = layerNameToId(via.layers[0]);
  const end = layerNameToId(via.layers[1]);

  if (start === undefined || end === undefined) return boardCopperLayerCount(board) > 2;

  return boardLayerDepth(board, start, end) > 1;
}

/**
 * The `padHasPotentiallyUnusedLayers` lambda (dialog:102): plated through-hole
 * only. An NPTH pad is excluded even though it too spans the stack — it has no
 * net, so "unused" has no meaning for it — and so are SMD and edge-connector
 * pads, which live on one layer already.
 */
export const padHasPotentiallyUnusedLayers = (pad: PcbPad): boolean => pad.type === 'thru_hole';

// ---------------------------------------------------------------------------
// Writing the mode onto an item (model + source, so it persists)

const boolNode = (name: string, value: boolean): SList => ({
  kind: 'list',
  items: [atom(name), atom(value ? 'yes' : 'no')],
});

/**
 * `PCB_IO_KICAD_SEXPR::format( const PAD* )` (pcb_io_kicad_sexpr.cpp:1990).
 *
 * The pad spelling is a *pair of booleans*, not the enum: `remove_unused_layers`
 * is written both ways, and `keep_end_layers` only when the first is yes. There
 * is no pad token for `start_end_only` — neither writer nor parser has one — so
 * that mode cannot round-trip on a pad. The dialog never produces it, and this
 * function refuses to invent a spelling for it.
 *
 * `zone_layer_connections` is the filler's cache of which layers a zone forced
 * flashed. Upstream emits it only alongside a yes, so restoring all layers has
 * to drop it or the next reader would resurrect overrides for a pad that no
 * longer removes anything.
 */
export function withPadUnconnectedLayerMode(pad: PcbPad, mode: UnconnectedLayerMode): PcbPad {
  const remove = mode !== 'keep_all';
  let src = patchChild(
    pad.source,
    'remove_unused_layers',
    boolNode('remove_unused_layers', remove),
  );

  if (remove) {
    src = patchChild(
      src,
      'keep_end_layers',
      boolNode('keep_end_layers', mode === 'remove_except_start_and_end'),
    );
  } else {
    src = dropChild(src, 'keep_end_layers');
    src = dropChild(src, 'zone_layer_connections');
  }

  return { ...pad, unconnectedLayerMode: mode, source: src };
}

/**
 * `PCB_IO_KICAD_SEXPR::format( const PCB_TRACK* )` for a via
 * (pcb_io_kicad_sexpr.cpp:2974), which spells the enum properly:
 * `keep_all` writes nothing at all, and `start_end_only` has its own token.
 *
 * Note the asymmetry with the pad above — a via in `remove_all` writes
 * `(keep_end_layers no)` explicitly, whereas `keep_all` writes neither token.
 * The via *parser* ignores a `no` on either token entirely (it only acts when
 * the value is true), so the explicit `no` is decoration; dropping the tokens
 * is what actually clears the mode.
 */
export function withViaUnconnectedLayerMode(via: PcbVia, mode: UnconnectedLayerMode): PcbVia {
  let src = via.source;

  if (mode === 'keep_all') {
    src = dropChild(src, 'remove_unused_layers');
    src = dropChild(src, 'keep_end_layers');
    src = dropChild(src, 'start_end_only');
    src = dropChild(src, 'zone_layer_connections');
  } else if (mode === 'start_end_only') {
    src = dropChild(src, 'remove_unused_layers');
    src = dropChild(src, 'keep_end_layers');
    src = patchChild(src, 'start_end_only', boolNode('start_end_only', true));
  } else {
    src = dropChild(src, 'start_end_only');
    src = patchChild(src, 'remove_unused_layers', boolNode('remove_unused_layers', true));
    src = patchChild(
      src,
      'keep_end_layers',
      boolNode('keep_end_layers', mode === 'remove_except_start_and_end'),
    );
  }

  return { ...via, unconnectedLayerMode: mode, source: src };
}

// ---------------------------------------------------------------------------
// The dialog

/** One field per checkbox, named after it. */
export interface UnusedPadLayersOptions {
  /** m_cbVias. */
  vias: boolean;
  /** m_cbPads. */
  pads: boolean;
  /** m_cbSelectedOnly. */
  selectedOnly: boolean;
  /** m_cbPreserveExternalLayers ("Keep outside layers"). */
  preserveExternalLayers: boolean;
}

/** Hooks for the board facts this module does not model itself. */
export interface UnusedPadLayersContext {
  /**
   * Whether an item is in the `PCB_SELECTION` the tool handed the dialog.
   * A selected *footprint* covers all of its pads; a selected pad covers only
   * itself. Both are asked, exactly as upstream's two independent `if`s do,
   * because a selection can hold either. Without this hook "selected only"
   * matches nothing, which is the safe reading of an empty selection.
   */
  isSelected?: (item: PcbVia | PcbPad | PcbFootprint) => boolean;
}

/**
 * `dialog_unused_pad_layers_base.fbp`: every checkbox ships unchecked, and the
 * constructor then ticks "Keep outside layers" alone (dialog:44) — "because
 * such a pad does not allow soldering/unsoldering, disable this option is
 * probably not frequent".
 *
 * So the out-of-the-box press of "Remove Unused Layers" changes **nothing**:
 * neither Vias nor Pads is in scope until the user says so.
 */
export const DEFAULT_UNUSED_PAD_LAYERS_OPTIONS: UnusedPadLayersOptions = {
  vias: false,
  pads: false,
  selectedOnly: false,
  preserveExternalLayers: true,
};

/**
 * The mode the two buttons write. `wxID_OK` ("Remove Unused Layers") calls with
 * `aRemoveLayers = true`, `wxID_APPLY` ("Restore All Layers") with false.
 *
 * Restoring ignores the "Keep outside layers" checkbox: upstream guards the
 * keep-flag setter with `if( aRemoveLayers )`, and `SetRemoveUnconnected(false)`
 * has already collapsed the enum to `keep_all` on its own. The consequence
 * worth knowing is that either button *destroys* a `start_end_only` mode set
 * from the Pad Properties dialog — there is no button that preserves it.
 */
export const unusedPadLayersMode = (
  aRemoveLayers: boolean,
  preserveExternalLayers: boolean,
): UnconnectedLayerMode =>
  !aRemoveLayers
    ? 'keep_all'
    : preserveExternalLayers
      ? 'remove_except_start_and_end'
      : 'remove_all';

/** What {@link updateUnusedPadLayers} changed, for the editor's status line. */
export interface UnusedPadLayersResult {
  board: Board;
  /** Pads whose mode was written (including writes of the value it already had). */
  pads: number;
  /** Vias whose mode was written. */
  vias: number;
}

/**
 * `DIALOG_UNUSED_PAD_LAYERS::updatePadsAndVias` (dialog:87).
 *
 * Two disjoint walks, chosen by "Selected only". They are not quite mirror
 * images and the differences are upstream's, not a simplification:
 *
 * - the selected walk visits **vias first, then footprints, then pads**, and
 *   calls `m_commit.Modify( item )` on every selected item whatever its type;
 *   the whole-board walk does **pads first, then vias**, and modifies each
 *   footprint whether or not any of its pads qualified. Neither ordering is
 *   observable in the result, so this port keeps the containers' own order;
 *   the commit bookkeeping has no counterpart in an immutable model.
 * - a pad is filtered only by `PAD_ATTRIB::PTH` in both walks, while a via is
 *   additionally filtered by {@link viaHasPotentiallyUnusedLayers}. A through
 *   via on a two-layer board is therefore left alone even by "Restore All
 *   Layers", so a `remove_all` flag on one survives the restore.
 */
export function updateUnusedPadLayers(
  board: Board,
  aRemoveLayers: boolean,
  opts: UnusedPadLayersOptions,
  ctx: UnusedPadLayersContext = {},
): UnusedPadLayersResult {
  const mode = unusedPadLayersMode(aRemoveLayers, opts.preserveExternalLayers);
  const selected = (item: PcbVia | PcbPad | PcbFootprint): boolean =>
    ctx.isSelected?.(item) ?? false;

  let pads = 0;
  let vias = 0;

  const nextVias = board.vias.map((via) => {
    if (!opts.vias) return via;
    if (opts.selectedOnly && !selected(via)) return via;
    if (!viaHasPotentiallyUnusedLayers(board, via)) return via;

    vias++;
    return withViaUnconnectedLayerMode(via, mode);
  });

  const nextFootprints = board.footprints.map((fp) => {
    if (!opts.pads) return fp;

    // In "selected only" mode a footprint's pads are in scope when the
    // footprint is selected OR when that individual pad is.
    const wholeFootprint = !opts.selectedOnly || selected(fp);
    let changed = false;

    const nextPads = fp.pads.map((pad) => {
      if (!wholeFootprint && !selected(pad)) return pad;
      if (!padHasPotentiallyUnusedLayers(pad)) return pad;

      pads++;
      changed = true;
      return withPadUnconnectedLayerMode(pad, mode);
    });

    return changed ? { ...fp, pads: nextPads } : fp;
  });

  return { board: { ...board, vias: nextVias, footprints: nextFootprints }, pads, vias };
}

// ---------------------------------------------------------------------------
// The rule the mode arms

/**
 * Whether flashing on `aLayer` depends on connectivity at all.
 *
 * `PAD::ConditionallyFlashed` (pad.h:892) and `PCB_VIA::ConditionallyFlashed`
 * (pcb_track.h:615) are character-for-character the same function, and both
 * test the *drill* endpoints — including for `remove_except_start_and_end`,
 * where `PAD::FlashLayer` instead tests `IsExternalCopperLayer`. See the file
 * docblock: on our model the two agree, and this is the one to use when asking
 * "may this layer disappear?" rather than "is it there now?".
 */
export function conditionallyFlashed(
  mode: UnconnectedLayerMode,
  aLayer: string,
  startLayer: string,
  endLayer: string,
): boolean {
  switch (mode) {
    case 'keep_all':
      return false;
    case 'remove_all':
      return true;
    case 'remove_except_start_and_end':
    case 'start_end_only':
      return aLayer !== startLayer && aLayer !== endLayer;
  }
}

/**
 * The outcome of `FlashLayer` split three ways.
 *
 * `'if-connected'` is precisely where upstream consults
 * `CONNECTIVITY_DATA::IsConnectedOnLayer` (or the zone-fill override that
 * stands in for it): copper is present iff a track, arc, via or pad on the same
 * net touches the item on that layer. This port has no connectivity graph, so
 * the caller must answer it; every other branch is decided here.
 */
export type FlashState = 'flashed' | 'removed' | 'if-connected';

/** A pad's `(layers …)` tokens, including the wildcards the reader keeps raw. */
function padIsOnLayer(pad: PcbPad, layer: string): boolean {
  for (const token of pad.layers) {
    if (token === layer) return true;
    if (token === '*.Cu' && isCopperLayerName(layer)) return true;
    if (token === '*In.Cu' && isCopperLayerName(layer) && !isExternalCopperLayer(layer))
      return true;
    if (token === 'F&B.Cu' && isExternalCopperLayer(layer)) return true;
    if (token === '*.Mask' && (layer === 'F.Mask' || layer === 'B.Mask')) return true;
  }

  return false;
}

/**
 * `PAD::FlashLayer( int aLayer, bool aOnlyCheckIfPermitted )` (pad.cpp:650).
 *
 * Two steps that are easy to drop and both change results:
 *
 * 1. **The NPTH hole-swallows-the-pad rule.** A round NPTH pad with no offset
 *    whose drill is at least as wide as the pad has no copper anywhere — the
 *    annulus is zero or negative. Upstream compares `>=`, so a drill exactly
 *    equal to the pad still removes it. The oval case needs *both* axes to
 *    swallow the pad, and only when the drill is oblong: a round drill in an
 *    oval pad keeps its copper however large it is.
 * 2. **Front/back tech layers fold onto F.Cu/B.Cu** before the PTH block. So
 *    asking about F.Mask on a through-hole pad answers for F.Cu, and a pad
 *    whose front ring has been removed reports no mask opening either.
 *
 * `aOnlyCheckIfPermitted` (i.e. `CanFlashLayer`) is the same call with
 * `'if-connected'` read as flashed.
 */
export function padFlashState(pad: PcbPad, aLayer: string): FlashState {
  if (!padIsOnLayer(pad, aLayer)) return 'removed';

  if (pad.type === 'np_thru_hole' && isCopperLayerName(aLayer)) {
    const drill = pad.drill;
    const offset = drill?.offset;
    const centred = !offset || (offset.x === 0 && offset.y === 0);

    if (drill && centred) {
      if (pad.shape === 'circle' && !drill.oblong && drill.w >= pad.size.x) return 'removed';

      if (pad.shape === 'oval' && drill.oblong && drill.w >= pad.size.x && drill.h >= pad.size.y)
        return 'removed';
    }
  }

  let layer = aLayer;
  if (FRONT_BOARD_TECH.has(layer)) layer = 'F.Cu';
  else if (BACK_BOARD_TECH.has(layer)) layer = 'B.Cu';

  if (pad.type === 'thru_hole' && isCopperLayerName(layer)) {
    const mode = unconnectedLayerModeOf(pad);

    if (mode === 'keep_all') return 'flashed';

    // The drill endpoints, which our model fixes at the PADSTACK defaults.
    if (mode === 'start_end_only')
      return layer === 'F.Cu' || layer === 'B.Cu' ? 'flashed' : 'removed';

    if (mode === 'remove_except_start_and_end' && isExternalCopperLayer(layer)) return 'flashed';

    return 'if-connected';
  }

  return 'flashed';
}

/**
 * `PCB_VIA::IsOnLayer` (pcb_track.cpp:1475): the copper span between the via's
 * endpoints, plus an outer mask layer when that end is untented. The span is
 * walked in *physical* stack order (F.Cu, inners, B.Cu) — layer ids put B.Cu
 * second, and using them here collapses a blind via to one layer.
 */
function viaIsOnLayer(board: Board, via: PcbVia, layer: string): boolean {
  if (isCopperLayerName(layer)) {
    const stack = enabledCopperLayers(board);

    if (via.kind === 'through') return stack.includes(layer);

    const a = stack.indexOf(via.layers[0]);
    const b = stack.indexOf(via.layers[1]);
    const i = stack.indexOf(layer);

    if (a < 0 || b < 0 || i < 0) return false;

    return i >= Math.min(a, b) && i <= Math.max(a, b);
  }

  if (layer === 'F.Mask') return via.layers[0] === 'F.Cu' && !viaIsTented(board, via, 'front');
  if (layer === 'B.Mask') return via.layers[1] === 'B.Cu' && !viaIsTented(board, via, 'back');

  return false;
}

/**
 * `PCB_VIA::FlashLayer( int aLayer )` (pcb_track.cpp:1949).
 *
 * Shorter than the pad's — no NPTH case, no tech-layer folding — and it differs
 * in the one place that matters: `remove_except_start_and_end` keeps the via's
 * **own** endpoints, so on a blind In1→In2 via the two kept layers are inner
 * ones and both outer layers may lose their (non-existent) copper. Substituting
 * `isExternalCopperLayer` here, to match the pad, silently changes blind and
 * micro vias.
 */
export function viaFlashState(board: Board, via: PcbVia, aLayer: string): FlashState {
  if (!viaIsOnLayer(board, via, aLayer)) return 'removed';
  if (!isCopperLayerName(aLayer)) return 'flashed';

  const mode = unconnectedLayerModeOf(via);
  const isEnd = aLayer === via.layers[0] || aLayer === via.layers[1];

  switch (mode) {
    case 'keep_all':
      return 'flashed';
    case 'start_end_only':
      return isEnd ? 'flashed' : 'removed';
    case 'remove_except_start_and_end':
      if (isEnd) return 'flashed';
      break;
    case 'remove_all':
      break;
  }

  return 'if-connected';
}
