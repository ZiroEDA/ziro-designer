// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Global Deletions, the bulk delete behind `Edit → Global Deletions…`.
 * Counterparts: `DIALOG_GLOBAL_DELETION::DoGlobalDeletions`
 * (pcbnew/dialogs/dialog_global_deletion.cpp:121) and the three-line
 * `GLOBAL_EDIT_TOOL::GlobalDeletions` (same file, line 64) that shows it.
 * Upstream carries a `@todo` saying the engine belongs in the tool; here it is.
 *
 * The whole operation is: build a layer mask, walk four board containers in a
 * fixed order, and remove any item whose layer set *intersects* the mask that
 * applies to its container. There is no geometry and no tolerance. Every trap
 * is in which mask applies where, and in the `else if` chaining.
 *
 * ## The five things a rewrite gets wrong
 *
 * 1. **"Graphics" or "Board outlines" suppresses "Text" entirely.** The drawings
 *    loop is `if(delete_all) … else if(delete_shapes) … else if(delete_texts)`,
 *    so with both "Graphics" and "Text" ticked no text is deleted at all. This
 *    reads as an upstream bug. It is reproduced deliberately: a board run
 *    through KiCad and through us has to agree, bug for bug.
 *
 * 2. **Matching is intersection, not containment.** `(GetLayerSet() & mask).any()`
 *    — a through via spans the stack, so "current layer only" on *any* copper
 *    layer deletes it. And a copper `gr_line` that also opens the solder mask is
 *    caught by "Graphics", whose mask is all-non-copper, because `F.Mask` is in
 *    its layer set. Testing only the primary layer would spare it.
 *
 * 3. **"Clear board" ignores the Layer Filter completely.** Every `delete_all`
 *    branch passes `all_layers`, never `layers_filter`.
 *
 * 4. **`all_layers` is `LSET().set()` — every layer bit, enabled or not.** So
 *    the mask cannot be materialised from `board.layers`: an item sitting on a
 *    layer the board never enabled would silently be spared. The masks here are
 *    therefore predicates over layer *names*, never sets built from the board.
 *    The one thing `all_layers` does not match is an *empty* layer set, so an
 *    item with no layer survives even "Clear board".
 *
 * 5. **Markers are cleared outside the undo entry**, and "Clear board" does not
 *    imply them. Undoing a global delete restores the items and leaves the
 *    markers gone. The model has no marker container, so this module returns a
 *    `clearMarkers` flag for the editor to honour rather than inventing one.
 *
 * Nothing here is renumbered, re-netted or repaired: nets, netclasses and the
 * layer table are untouched, and an emptied group survives.
 */

import { boardItemId, deleteBoardItems } from './edit-board.js';
import { viaIsTented } from './export_d356.js';
import { enabledCopperLayers, isCopperLayerName } from './swap_layers.js';
import type { Board, PcbArcTrack, PcbShape, PcbTrack, PcbVia, PcbZone } from './types.js';

/**
 * One field per wxWidgets control, named after it, so the dialog↔engine mapping
 * stays checkable by eye.
 *
 * `currentLayer` stands in for `m_currentLayer`. Its C++ default is `F_Cu`, but
 * `GLOBAL_EDIT_TOOL::GlobalDeletions` always overwrites it with
 * `frame()->GetActiveLayer()` before the dialog is shown, so a caller that
 * forgets to set it is the bug, not the default.
 */
export interface GlobalDeletionOptions {
  // ----- "Items to Delete" -----
  /** m_delZones. Rule areas / keepouts come down this branch too. */
  zones: boolean;
  /** m_delTexts. */
  texts: boolean;
  /** m_delBoardEdges. */
  boardEdges: boolean;
  /** m_delDrawings ("Graphics"). */
  drawings: boolean;
  /** m_delFootprints. */
  footprints: boolean;
  /** m_delTracks ("Tracks && vias") — tracks, arcs AND vias. */
  tracks: boolean;
  /** m_delTeardrops. */
  teardrops: boolean;
  /** m_delMarkers. */
  markers: boolean;
  /** m_delAll ("Clear board"). */
  all: boolean;

  // ----- "Filter Settings" -----
  /** m_drawingFilterLocked. */
  drawingFilterLocked: boolean;
  /** m_drawingFilterUnlocked. */
  drawingFilterUnlocked: boolean;
  /** m_footprintFilterLocked. */
  footprintFilterLocked: boolean;
  /** m_footprintFilterUnlocked. */
  footprintFilterUnlocked: boolean;
  /** m_trackFilterLocked. */
  trackFilterLocked: boolean;
  /** m_trackFilterUnlocked. */
  trackFilterUnlocked: boolean;
  /** m_viaFilterLocked. */
  viaFilterLocked: boolean;
  /** m_viaFilterUnlocked. */
  viaFilterUnlocked: boolean;

  // ----- "Layer Filter" (m_rbLayersOption) -----
  /** Selection 1, "Current layer (%s) only". Selection 0 is all layers. */
  currentLayerOnly: boolean;
  /** The active layer's name; only read when {@link currentLayerOnly}. */
  currentLayer: string;
}

/**
 * `dialog_global_deletion_base.cpp`'s initial control states.
 *
 * All nine item boxes off; the four `*FilterLocked` off and the four
 * `*FilterUnlocked` **on**. The generated base sets the radio box to selection
 * 1, but `SetCurrentLayer()` runs unconditionally before the dialog is shown
 * and forces selection 0, so the effective default is "All layers".
 *
 * The constructor calls `OptOut( this )` — "This is a destructive dialog. Don't
 * save control state; we always want to come up in a benign state." A caller
 * MUST reset to this every time the dialog opens. Remembering the last options
 * on a dialog whose job is to erase the board is a hazard, not a convenience.
 */
export const DEFAULT_GLOBAL_DELETION_OPTIONS: GlobalDeletionOptions = {
  zones: false,
  texts: false,
  boardEdges: false,
  drawings: false,
  footprints: false,
  tracks: false,
  teardrops: false,
  markers: false,
  all: false,
  drawingFilterLocked: false,
  drawingFilterUnlocked: true,
  footprintFilterLocked: false,
  footprintFilterUnlocked: true,
  trackFilterLocked: false,
  trackFilterUnlocked: true,
  viaFilterLocked: false,
  viaFilterUnlocked: true,
  currentLayerOnly: false,
  currentLayer: 'F.Cu',
};

/**
 * The four `onCheck*` handlers as one pure function, for the dialog's greying.
 *
 * Disabled boxes keep their values — upstream only ever calls `Enable()`, never
 * `SetValue()` — so a greyed-out "Unlocked tracks" is still `true`, and the
 * engine must gate on the *item* boxes alone. Nothing here feeds the engine.
 *
 * (The constructor seeds the drawing filters from `m_delDrawings` alone,
 * without the `|| m_delBoardEdges` the handlers use. That is harmless only
 * because both boxes start false, so this reproduces the handlers' rule.)
 */
export function globalDeletionFilterEnabled(opts: GlobalDeletionOptions): {
  drawingFilters: boolean;
  footprintFilters: boolean;
  trackFilters: boolean;
  viaFilters: boolean;
} {
  return {
    drawingFilters: opts.drawings || opts.boardEdges,
    footprintFilters: opts.footprints,
    trackFilters: opts.tracks,
    viaFilters: opts.tracks,
  };
}

/**
 * The Layer Filter radio box's two rows.
 *
 * `SetCurrentLayer` does `SetString( 1, Format( GetString( 1 ), layerName ) )`,
 * which consumes the `%s` in the stored string — calling it twice would lose
 * the placeholder and show the first layer's name forever. Formatting from a
 * constant template each time makes that unreproducible.
 */
export function globalDeletionLayerChoices(layerName: string): [string, string] {
  return ['All layers', `Current layer (${layerName}) only`];
}

// ---------------------------------------------------------------------------
// Layer sets — `BOARD_ITEM::GetLayerSet()` and its overrides

/**
 * `UNDEFINED_LAYER` maps to an empty `LSET`, which intersects nothing. Keep the
 * empty case: such an item is skipped by every branch, "Clear board" included.
 */
const plainLayerSet = (layer: string | undefined): string[] => (layer ? [layer] : []);

/**
 * `PCB_SHAPE::GetLayerSet` (pcb_shape.cpp:382), also used by `PCB_TEXTBOX`,
 * which derives from `PCB_SHAPE`.
 *
 * The two mask tests are **independent `if`s** upstream, not an `if/else if` as
 * on `PCB_TRACK`. Immaterial in practice — a shape has one layer — but the
 * shape of the code is mirrored so the divergence from the track rule below is
 * visible rather than looking like a typo.
 *
 * `PcbTextBox` carries no `maskLayer` field, so a text box reduces to its own
 * layer; that matches `m_hasSolderMask == false`, which is what a `gr_text_box`
 * always parses to today.
 */
function shapeLayerSet(shape: PcbShape): string[] {
  const out = plainLayerSet(shape.layer);

  if (shape.maskLayer) {
    if (shape.layer === 'F.Cu') out.push('F.Mask');
    if (shape.layer === 'B.Cu') out.push('B.Mask');
  }

  return out;
}

/**
 * `PCB_TRACK::GetLayerSet` (pcb_track.cpp:1545).
 *
 * `if( F_Cu ) … else if( B_Cu ) …` — an **`else if`**, unlike `PCB_SHAPE`. An
 * inner-copper track carrying a mask flag therefore gains no mask layer.
 */
function trackLayerSet(track: PcbTrack | PcbArcTrack): string[] {
  const out = plainLayerSet(track.layer);

  if (track.maskLayer) {
    if (track.layer === 'F.Cu') out.push('F.Mask');
    else if (track.layer === 'B.Cu') out.push('B.Mask');
  }

  return out;
}

/**
 * `PCB_VIA::GetLayerSet` (pcb_track.cpp:1561).
 *
 * A through via is every copper layer (`AllCuMask( BoardCopperLayerCount() )`);
 * a blind or micro via is the span between its two endpoints. Upstream walks a
 * `LAYER_RANGE`, whose iterator runs the **physical** stack — F.Cu, In1…, B.Cu
 * — which is `enabledCopperLayers()`'s order and *not* the order layer ids are
 * numbered in (B.Cu is id 2, above every inner layer). Getting that wrong turns
 * a blind via into a one-layer via.
 *
 * The range is capped at `BoardCopperLayerCount()` layers by a `--cnt <= 0`
 * break. A slice of the stack can never exceed the stack, so the cap is
 * unreachable here and is deliberately not written out as dead code.
 *
 * An endpoint that is not in the board's layer table has no upstream-defined
 * behaviour (KiCad would have a real `PCB_LAYER_ID` there). It is clamped to
 * the nearest end of the stack rather than yielding an empty set: an empty set
 * means the via survives "Clear board", which is a data-loss-shaped surprise in
 * reverse.
 *
 * The `Padstack().Drill().start < PCBNEW_LAYER_ID_START → empty set` guard has
 * no counterpart — the model cannot express an unset drill start.
 */
function viaLayerSet(board: Board, via: PcbVia): string[] {
  const stack = enabledCopperLayers(board);
  if (stack.length === 0) return [];

  let out: string[];

  if (via.kind === 'through') {
    out = [...stack];
  } else {
    const a = stack.indexOf(via.layers[0]);
    const b = stack.indexOf(via.layers[1]);
    const lo = a < 0 ? 0 : a;
    const hi = b < 0 ? stack.length - 1 : b;
    out = stack.slice(Math.min(lo, hi), Math.max(lo, hi) + 1);
  }

  // An untented via opens the mask, widening what a mask-layer "current layer
  // only" run deletes. Both board defaults are "tented", so the usual answer is
  // to add nothing.
  if (!viaIsTented(board, via, 'front') && out.includes('F.Cu')) out.push('F.Mask');
  if (!viaIsTented(board, via, 'back') && out.includes('B.Cu')) out.push('B.Mask');

  return out;
}

/**
 * `ZONE::GetLayerSet` returns `m_layerSet` verbatim, but KiCad's parser has
 * already expanded `*.Cu` / `F&B.Cu` into a real `LSET` by then. `read-board.ts`
 * stores a zone's `(layers …)` as written, so the expansion has to happen here
 * or "current layer only" would silently skip exactly the zones most likely to
 * span the layer the user is looking at. `swap_layers.ts` compensates for the
 * same reader gap the same way; fixing the reader is its own change.
 */
function zoneLayerSet(board: Board, zone: PcbZone): string[] {
  const out: string[] = [];

  for (const layer of zone.layers) {
    const expanded =
      layer === '*.Cu'
        ? enabledCopperLayers(board)
        : layer === 'F&B.Cu'
          ? ['F.Cu', 'B.Cu']
          : [layer];
    for (const l of expanded) if (!out.includes(l)) out.push(l);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Masks — expressed as predicates, never as materialised sets (see the docblock)

/**
 * `(GetLayerSet() & layers_filter).any()`.
 *
 * With "All layers" the mask is `LSET().set()`, so the intersection is
 * non-empty exactly when the item has at least one layer — hence `length > 0`
 * and not an unconditional `true`.
 */
export function layerMatchesFilter(
  layers: readonly string[],
  opts: GlobalDeletionOptions,
): boolean {
  return opts.currentLayerOnly ? layers.includes(opts.currentLayer) : layers.length > 0;
}

/**
 * `(GetLayerSet() & drawing_layers_filter).any()`, where
 * ```
 * if( m_delDrawings )   filter  = LSET::AllNonCuMask().set( Edge_Cuts, false );
 * if( m_delBoardEdges ) filter.set( Edge_Cuts );
 * filter &= layers_filter;
 * ```
 * The order is load-bearing: the `Edge_Cuts` reset lives inside the "Graphics"
 * branch and the `set` runs after it, so ticking **both** boxes gives every
 * non-copper layer *including* Edge.Cuts, while "Graphics" alone excludes it.
 *
 * Copper is never in this mask, which is what makes a copper shape with a
 * solder-mask opening the interesting case — it is caught through `F.Mask`.
 *
 * A corollary worth knowing before filing a bug: "Board outlines" plus "current
 * layer only" is a no-op unless the active layer *is* Edge.Cuts, because the
 * mask is then `{Edge.Cuts} & {currentLayer}` and empty.
 */
export function layerMatchesDrawingFilter(
  layers: readonly string[],
  opts: GlobalDeletionOptions,
): boolean {
  return layers.some((l) => {
    const inMask =
      (opts.drawings && !isCopperLayerName(l) && l !== 'Edge.Cuts') ||
      (opts.boardEdges && l === 'Edge.Cuts');

    return inMask && (!opts.currentLayerOnly || l === opts.currentLayer);
  });
}

// ---------------------------------------------------------------------------
// Locking — `BOARD_ITEM::IsLocked` and the footprint override

/**
 * The uuids that a locked group locks.
 *
 * `BOARD_ITEM::IsLocked` (board_item.cpp:133) returns true when the item's
 * parent group is locked, and `PCB_GROUP` does not override `IsLocked`, so the
 * test recurses: an item is locked when **any ancestor group** is locked. That
 * half is load-bearing here — a graphic or track inside a locked group needs
 * "Locked graphics" / "Locked tracks" to be deleted.
 *
 * `edit-board.ts`'s `isBoardItemLocked` reads the item's own flag only, and
 * routes footprint children to the footprint. Extending it would change
 * lock/unlock behaviour across the whole editor, so this stays local.
 */
function groupLockedUuids(board: Board): ReadonlySet<string> {
  const containing = new Map<string, number>(); // member uuid -> group index
  board.groups.forEach((g, i) => {
    for (const m of g.members) containing.set(m, i);
  });

  const memo = new Map<number, boolean>();
  const visiting = new Set<number>();

  // A malformed file can make a group its own ancestor; `visiting` keeps that
  // from becoming an infinite recursion rather than a lock decision.
  const lockedGroup = (i: number): boolean => {
    const seen = memo.get(i);
    if (seen !== undefined) return seen;
    if (visiting.has(i)) return false;

    visiting.add(i);
    const g = board.groups[i]!;
    const parent = g.uuid === undefined ? undefined : containing.get(g.uuid);
    const answer = !!g.locked || (parent !== undefined && lockedGroup(parent));
    visiting.delete(i);

    memo.set(i, answer);
    return answer;
  };

  const out = new Set<string>();
  board.groups.forEach((g, i) => {
    if (lockedGroup(i)) for (const m of g.members) out.add(m);
  });

  return out;
}

/** `BOARD_ITEM::IsLocked`, for the shape / track / via filters. */
const itemLocked = (
  item: { locked?: boolean; uuid?: string },
  lockedByGroup: ReadonlySet<string>,
): boolean => !!item.locked || (item.uuid !== undefined && lockedByGroup.has(item.uuid));

// ---------------------------------------------------------------------------
// The engine

interface StagedDeletion {
  ids: Set<string>;
  rebuildRatsnest: boolean;
}

/**
 * `DoGlobalDeletions`' staging phase: everything up to `commit.Push()`.
 *
 * Walks the containers in upstream's order. Order is immaterial to a set, but
 * it keeps the code readable against the C++.
 */
function stageGlobalDeletion(board: Board, opts: GlobalDeletionOptions): StagedDeletion {
  const ids = new Set<string>();
  let rebuildRatsnest = false;
  const lockedByGroup = groupLockedUuids(board);

  /** `processItem`: stage when the layer sets intersect. */
  const processItem = (id: string, matches: boolean): void => {
    if (matches) ids.add(id);
  };

  /** `processConnectedItem`: the same, plus `gen_rastnest = true`. */
  const processConnectedItem = (id: string, matches: boolean): void => {
    if (!matches) return;
    ids.add(id);
    rebuildRatsnest = true;
  };

  /** `(GetLayerSet() & all_layers).any()` — every bit is set, so: non-empty. */
  const matchesAllLayers = (layers: readonly string[]): boolean => layers.length > 0;

  // ----- 1. zones -----------------------------------------------------------
  // `IsTeardropArea()` is the only split, and the branches are `else if`: with
  // "Zones" ticked and "Teardrops" not, teardrop areas survive. Rule areas are
  // not teardrops, so they follow the "Zones" box — there is no keepout box.
  // Only `board->Zones()` is walked; zones inside footprints are never touched.
  board.zones.forEach((zone, i) => {
    const id = boardItemId('zone', i);
    const layers = zoneLayerSet(board, zone);

    if (opts.all) {
      processConnectedItem(id, matchesAllLayers(layers));
    } else if (zone.teardropType !== undefined) {
      if (opts.teardrops) processConnectedItem(id, layerMatchesFilter(layers, opts));
    } else {
      if (opts.zones) processConnectedItem(id, layerMatchesFilter(layers, opts));
    }
  });

  // ----- 2. drawings --------------------------------------------------------
  const deleteShapes = opts.drawings || opts.boardEdges;
  const deleteTexts = opts.texts;

  if (opts.all || deleteShapes || deleteTexts) {
    if (opts.all) {
      // `board->Drawings()` is one container; everything in it goes.
      board.shapes.forEach((s, i) => {
        processItem(boardItemId('shape', i), matchesAllLayers(shapeLayerSet(s)));
      });
      board.texts.forEach((t, i) => {
        processItem(boardItemId('text', i), matchesAllLayers(plainLayerSet(t.layer)));
      });
      board.textBoxes.forEach((t, i) => {
        processItem(boardItemId('textbox', i), matchesAllLayers(plainLayerSet(t.layer)));
      });
      board.tables.forEach((t, i) => {
        processItem(boardItemId('table', i), matchesAllLayers(plainLayerSet(t.layer)));
      });
      board.images.forEach((im, i) => {
        processItem(boardItemId('image', i), matchesAllLayers(plainLayerSet(im.layer)));
      });
      board.dimensions.forEach((d, i) => {
        processItem(boardItemId('dimension', i), matchesAllLayers(plainLayerSet(d.layer)));
      });
    } else if (deleteShapes) {
      // The branch tests `Type() == PCB_SHAPE_T` twice and has no other case, so
      // "Graphics" never removes a text box, table, dimension or reference image
      // however plainly they are drawings on those layers. Only "Clear board"
      // reaches them.
      board.shapes.forEach((s, i) => {
        const pass = itemLocked(s, lockedByGroup)
          ? opts.drawingFilterLocked
          : opts.drawingFilterUnlocked;

        if (pass)
          processItem(boardItemId('shape', i), layerMatchesDrawingFilter(shapeLayerSet(s), opts));
      });
    } else if (deleteTexts) {
      // Text uses the plain `layers_filter`, so it *is* deleted on copper and
      // ignores the Edge.Cuts carve-out — and it has no lock filter at all, so a
      // locked `gr_text` goes even with "Locked graphics" unticked.
      board.texts.forEach((t, i) => {
        processItem(boardItemId('text', i), layerMatchesFilter(plainLayerSet(t.layer), opts));
      });
      board.textBoxes.forEach((t, i) => {
        processItem(boardItemId('textbox', i), layerMatchesFilter(plainLayerSet(t.layer), opts));
      });
    }
  }

  // ----- 3. footprints ------------------------------------------------------
  // `FOOTPRINT` does not override `GetLayerSet()`, so it is `{F.Cu}` or `{B.Cu}`
  // and nothing else: with "current layer only" on F.SilkS no footprint is
  // deleted, however much silkscreen it has. Its pads and graphics are not in
  // the set — do not union the children.
  //
  // `FOOTPRINT::IsLocked()` (footprint.h:637) is its own `FP_is_LOCKED` test and
  // ignores the parent group, unlike everything else in this dialog.
  if (opts.all || opts.footprints) {
    board.footprints.forEach((fp, i) => {
      const id = boardItemId('footprint', i);
      const layers = plainLayerSet(fp.layer);

      if (opts.all) {
        processConnectedItem(id, matchesAllLayers(layers));
      } else if (fp.locked) {
        if (opts.footprintFilterLocked) processConnectedItem(id, layerMatchesFilter(layers, opts));
      } else {
        if (opts.footprintFilterUnlocked)
          processConnectedItem(id, layerMatchesFilter(layers, opts));
      }
    });
  }

  // ----- 4. tracks, arcs and vias -------------------------------------------
  // `board->Tracks()` is one deque of PCB_TRACE_T | PCB_ARC_T | PCB_VIA_T, and
  // only `Type() == PCB_VIA_T` takes the via filters. **An arc is a track.**
  if (opts.all || opts.tracks) {
    const stageTrack = (id: string, t: PcbTrack | PcbArcTrack): void => {
      const layers = trackLayerSet(t);

      if (opts.all) {
        processConnectedItem(id, matchesAllLayers(layers));
        return;
      }

      const pass = itemLocked(t, lockedByGroup) ? opts.trackFilterLocked : opts.trackFilterUnlocked;
      if (pass) processConnectedItem(id, layerMatchesFilter(layers, opts));
    };

    board.tracks.forEach((t, i) => {
      stageTrack(boardItemId('track', i), t);
    });
    board.arcs.forEach((a, i) => {
      stageTrack(boardItemId('arc', i), a);
    });

    board.vias.forEach((v, i) => {
      const id = boardItemId('via', i);
      const layers = viaLayerSet(board, v);

      if (opts.all) {
        processConnectedItem(id, matchesAllLayers(layers));
        return;
      }

      const pass = itemLocked(v, lockedByGroup) ? opts.viaFilterLocked : opts.viaFilterUnlocked;
      if (pass) processConnectedItem(id, layerMatchesFilter(layers, opts));
    });
  }

  return { ids, rebuildRatsnest };
}

/** The board item ids `DoGlobalDeletions` would stage for removal. */
export function globalDeletionIds(board: Board, opts: GlobalDeletionOptions): Set<string> {
  return stageGlobalDeletion(board, opts).ids;
}

/**
 * `gen_rastnest`.
 *
 * True iff at least one item went through `processConnectedItem` — a zone,
 * footprint, track, arc or via that was **actually removed**. Drawings use
 * `processItem` and never set it, "Clear board" included. It follows the
 * removal, not the checkbox: ticking "Tracks && vias" on a board with no tracks
 * leaves it false, and upstream then skips both `CompileRatsnest()` and the
 * message-panel refresh.
 */
export function globalDeletionRebuildsRatsnest(board: Board, opts: GlobalDeletionOptions): boolean {
  return stageGlobalDeletion(board, opts).rebuildRatsnest;
}

/** The uuid of a staged item, for pruning group membership. */
function stagedUuids(board: Board, ids: ReadonlySet<string>): Set<string> {
  const arrays: Record<string, readonly { uuid?: string }[]> = {
    zone: board.zones,
    shape: board.shapes,
    text: board.texts,
    textbox: board.textBoxes,
    table: board.tables,
    image: board.images,
    dimension: board.dimensions,
    footprint: board.footprints,
    track: board.tracks,
    arc: board.arcs,
    via: board.vias,
  };

  const out = new Set<string>();

  for (const id of ids) {
    const [kind, index] = id.split(':');
    const uuid = arrays[kind ?? '']?.[Number(index)]?.uuid;
    if (uuid) out.add(uuid);
  }

  return out;
}

/**
 * `BOARD_COMMIT::Push` calls `parentGroup->RemoveItem( boardItem )` for every
 * removed item (board_commit.cpp:384-385) — and **does not dissolve** a group
 * that this empties. That differs from `removeFromGroupItems`, which enforces a
 * ">= 2 members" invariant; using it here would delete groups KiCad keeps.
 * An empty group simply is not serialised.
 */
function pruneGroupMembers(board: Board, gone: ReadonlySet<string>): Board {
  if (gone.size === 0) return board;

  let changed = false;
  const groups = board.groups.map((g) => {
    const members = g.members.filter((u) => !gone.has(u));
    if (members.length === g.members.length) return g;
    changed = true;
    return { ...g, members };
  });

  return changed ? { ...board, groups } : board;
}

/**
 * `DIALOG_GLOBAL_DELETION::DoGlobalDeletions`, minus the three things that are
 * not board state.
 *
 * The caller owns them:
 * - **Clear the selection first.** `ACTIONS::selectionClear` is the very first
 *   statement upstream, and it has to happen before the arrays are filtered or
 *   the selection keeps ids whose indices have shifted onto other items.
 * - **One undo entry, labelled exactly `"Global Delete"`** (`commit.Push`).
 * - **Clear every DRC marker when `clearMarkers`**, exclusions included
 *   (`BOARD::DeleteMARKERs()` is the unconditional overload), and do it
 *   *outside* the undo entry — upstream calls it after `commit.Push()`.
 */
export function applyGlobalDeletion(
  board: Board,
  opts: GlobalDeletionOptions,
): { board: Board; deleted: Set<string>; rebuildRatsnest: boolean; clearMarkers: boolean } {
  const { ids, rebuildRatsnest } = stageGlobalDeletion(board, opts);
  const gone = stagedUuids(board, ids);

  return {
    board: pruneGroupMembers(deleteBoardItems(board, ids), gone),
    deleted: ids,
    rebuildRatsnest,
    clearMarkers: opts.markers,
  };
}

/**
 * How many items the current options would delete. **A ZiroEDA addition**, not
 * upstream: the dialog offers no preview and cannot be undone past the markers,
 * so the editor warns with a count. It must never change what is deleted —
 * it is `globalDeletionIds(...).size` and nothing else.
 */
export function countGlobalDeletionTargets(board: Board, opts: GlobalDeletionOptions): number {
  return globalDeletionIds(board, opts).size;
}
