// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Filter Selection: narrow a selection to chosen item kinds.
 * Counterparts: `itemIsIncludedByFilter` and
 * `PCB_SELECTION_TOOL::filterSelection` in `pcbnew/tools/pcb_selection_tool.cpp`,
 * driven by `DIALOG_FILTER_SELECTION`.
 *
 * The filter is **inclusive, not exclusive**: an item kind the dialog does not
 * offer is dropped rather than kept. Upstream says so in a comment on the
 * default branch, and it is the behaviour that makes the dialog predictable —
 * "keep only what I ticked" rather than "remove what I unticked".
 */

import { parseBoardItemId } from './edit-board.js';
import type { Board } from './types.js';

/** DIALOG_FILTER_SELECTION::OPTIONS. All default to true but locked footprints. */
export interface SelectionFilter {
  footprints: boolean;
  /** Only consulted when `footprints` is on, as the dialog's checkbox is. */
  lockedFootprints: boolean;
  tracks: boolean;
  vias: boolean;
  zones: boolean;
  /** Graphics and dimensions on Edge.Cuts. */
  boardOutline: boolean;
  /** Graphics and dimensions on any other non-copper layer. */
  techLayers: boolean;
  text: boolean;
}

export const DEFAULT_SELECTION_FILTER: SelectionFilter = {
  footprints: true,
  lockedFootprints: false,
  tracks: true,
  vias: true,
  zones: true,
  boardOutline: true,
  techLayers: true,
  text: true,
};

/**
 * `itemIsIncludedByFilter`: does this item survive the filter?
 *
 * Pads and groups are deliberately absent from upstream's switch and so fall
 * to its default of false. A pad is normally selected through its footprint,
 * and the dialog offers no checkbox for either — under an inclusive filter
 * that means they are dropped.
 */
export function itemPassesFilter(board: Board, id: string, filter: SelectionFilter): boolean {
  const ref = parseBoardItemId(id);
  if (!ref) return false;

  switch (ref.kind) {
    case 'footprint': {
      const fp = board.footprints[ref.index];
      if (!fp) return false;
      return filter.footprints && (filter.lockedFootprints || !fp.locked);
    }

    // Upstream is handed live BOARD_ITEMs, so it never meets an id that
    // resolves to nothing. Ours can — a selection outliving an undo, say — and
    // a stale id is dropped rather than kept, so filtering cannot leave a
    // dangling entry behind.
    case 'track':
      return filter.tracks && board.tracks[ref.index] !== undefined;

    case 'arc':
      return filter.tracks && board.arcs[ref.index] !== undefined;

    case 'via':
      return filter.vias && board.vias[ref.index] !== undefined;

    case 'zone':
      return filter.zones && board.zones[ref.index] !== undefined;

    case 'shape': {
      const s = board.shapes[ref.index];
      if (!s) return false;
      return s.layer === 'Edge.Cuts' ? filter.boardOutline : filter.techLayers;
    }

    case 'text':
      return filter.text && board.texts[ref.index] !== undefined;

    // `PCB_TEXTBOX_T` sits with `PCB_TEXT_T` in upstream's switch and returns
    // `includePcbTexts` — a text box follows the *text* checkbox, not the
    // layer-based graphics split a dimension uses, even though it is a shape.
    case 'textbox':
      return filter.text && board.textBoxes[ref.index] !== undefined;

    // A dimension follows its layer, exactly as a graphic does: upstream's
    // `PCB_SELECTION_FILTER_OPTIONS` has no dimension box of its own, and both
    // its `graphics` and `dimensions` cases route through the same
    // outline/tech-layer split. Note this makes the `text` box irrelevant to a
    // dimension, even though it carries text.
    case 'dimension': {
      const d = board.dimensions[ref.index];
      if (!d) return false;
      return d.layer === 'Edge.Cuts' ? filter.boardOutline : filter.techLayers;
    }

    case 'fptext':
      return filter.text && board.footprints[ref.index]?.texts[ref.sub ?? 0] !== undefined;

    default:
      return false;
  }
}

/** `filterSelection`: the surviving ids, in the order they were given. */
export function filterSelection(
  board: Board,
  selection: Iterable<string>,
  filter: SelectionFilter,
): string[] {
  return [...selection].filter((id) => itemPassesFilter(board, id, filter));
}

/**
 * The dialog's "All items" tri-state, as `GetSuggestedAllItemsState` computes
 * it: checked only when *every* box is ticked, unchecked when none is, and
 * indeterminate in between.
 *
 * The locked-footprints box is counted only while the footprints box it
 * belongs to is on; when that is off it is disabled and cannot be ticked.
 *
 * Upstream also drops it from the *denominator* in that case. Here that
 * adjustment cannot change the answer — with footprints off at most six of the
 * remaining boxes can be ticked, which falls short of seven or eight alike —
 * so it is left out rather than written as arithmetic that never decides
 * anything. Upstream needs it because it counts its checkboxes dynamically at
 * runtime.
 *
 * A consequence worth knowing rather than "fixing": the dialog's own default
 * (locked footprints off, everything else on) reads **mixed**, not checked.
 * Seven of eight boxes are ticked.
 */
export function allItemsState(filter: SelectionFilter): 'checked' | 'unchecked' | 'mixed' {
  // The eight checkboxes the dialog offers.
  const total = 8;
  let checked = 0;

  if (filter.footprints) {
    checked++;
    if (filter.lockedFootprints) checked++;
  }

  for (const f of [
    filter.tracks,
    filter.vias,
    filter.zones,
    filter.boardOutline,
    filter.techLayers,
    filter.text,
  ])
    if (f) checked++;

  if (checked === 0) return 'unchecked';
  if (checked === total) return 'checked';
  return 'mixed';
}

/** `forceCheckboxStates`: the All-items checkbox turning everything on or off. */
export function setAllFilterItems(on: boolean): SelectionFilter {
  return {
    footprints: on,
    lockedFootprints: on,
    tracks: on,
    vias: on,
    zones: on,
    boardOutline: on,
    techLayers: on,
    text: on,
  };
}
