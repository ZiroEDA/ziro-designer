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
