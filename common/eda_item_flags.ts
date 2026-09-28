// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eda_item_flags.h`: the bits of `EDA_ITEM::m_flags`.
 *
 * NB: DO NOT ADD FLAGS ANYWHERE BUT AT THE END: THE FLAG-SET IS STORED AS AN INTEGER IN FILES.
 */

export const IS_CHANGED = 1 << 0; ///< Item was edited, and modified
export const IS_LINKED = 1 << 1; ///< Used in calculation to mark linked items (temporary use)
export const IN_EDIT = 1 << 2; ///< Item currently edited
export const IS_MOVING = 1 << 3; ///< Item being moved
export const IS_NEW = 1 << 4; ///< New item, just created
export const IS_BROKEN = 1 << 5; ///< Is a segment just broken by BreakSegment

export const IS_DELETED = 1 << 7;

export const STARTPOINT = 1 << 9; ///< When a line is selected, these flags indicate which
export const ENDPOINT = 1 << 10; ///< ends.  (Used to support dragging.)
export const SELECTED = 1 << 11; ///< Item was manually selected by the user
export const SELECTED_BY_DRAG = 1 << 12; ///< Item was algorithmically selected as a dragged item
export const STRUCT_DELETED = 1 << 13; ///< flag indication structures to be erased
export const CANDIDATE = 1 << 14; ///< flag indicating that the structure is connected
export const SKIP_STRUCT = 1 << 15; ///< flag indicating that the structure should be ignored

export const IS_PASTED = 1 << 17; ///< Modifier on IS_NEW which indicates it came from clipboard
export const IS_SHOWN_AS_BITMAP = 1 << 18;
export const COURTYARD_CONFLICT = 1 << 19; ///< temporary set when moving footprints having courtyard overlapping
export const MALFORMED_F_COURTYARD = 1 << 20;
export const MALFORMED_B_COURTYARD = 1 << 21;
export const MALFORMED_COURTYARDS = MALFORMED_F_COURTYARD | MALFORMED_B_COURTYARD;

export const ROUTER_TRANSIENT = 1 << 22; ///< transient items that should NOT be cached

export const CONNECTIVITY_CANDIDATE = 1 << 23; ///< flag indicating that the structure is connected for connectivity

export const HOLE_PROXY = 1 << 24; ///< Indicates the BOARD_ITEM is a proxy for its hole
export const SHOW_ELEC_TYPE = 1 << 25; ///< Show pin electrical type
export const BRIGHTENED = 1 << 26; ///< item is drawn with a bright contour

export const MCT_SKIP_STRUCT = 1 << 27; ///< flag used by the multichannel tool to mark items that should be skipped

export const UR_TRANSIENT = 1 << 28; ///< indicates the item is owned by the undo/redo stack

export const IS_DANGLING = 1 << 29; ///< indicates a pin is dangling
export const ENTERED = 1 << 30; ///< indicates a group has been entered
// `1UL << 31`: kept unsigned, as `1 << 31` in JS is negative
export const SELECTION_CANDIDATE = 0x80000000; ///< indicates an item is a candidate for selection

// WARNING: if you add flags, you'll probably need to adjust the masks in GetEditFlags() and
// ClearTempFlags().

/** `UINT32_MAX`. */
export const EDA_ITEM_ALL_FLAGS = 0xffffffff;

/** `std::uint32_t`; every operation on it goes through `>>> 0`. */
export type EDA_ITEM_FLAGS = number;

// Helper function to convert flags to string descriptions
export function EDAItemFlagsToString(flags: EDA_ITEM_FLAGS): string {
  const flagDescs: [EDA_ITEM_FLAGS, string][] = [
    [IS_CHANGED, 'IS_CHANGED'],
    [IS_LINKED, 'IS_LINKED'],
    [IN_EDIT, 'IN_EDIT'],
    [IS_MOVING, 'IS_MOVING'],
    [IS_NEW, 'IS_NEW'],
    [IS_BROKEN, 'IS_BROKEN'],
    [IS_DELETED, 'IS_DELETED'],
    [STARTPOINT, 'STARTPOINT'],
    [ENDPOINT, 'ENDPOINT'],
    [SELECTED, 'SELECTED'],
    [SELECTED_BY_DRAG, 'SELECTED_BY_DRAG'],
    [STRUCT_DELETED, 'STRUCT_DELETED'],
    [CANDIDATE, 'CANDIDATE'],
    [SKIP_STRUCT, 'SKIP_STRUCT'],
    [IS_PASTED, 'IS_PASTED'],
    [IS_SHOWN_AS_BITMAP, 'IS_SHOWN_AS_BITMAP'],
    [COURTYARD_CONFLICT, 'COURTYARD_CONFLICT'],
    [MALFORMED_F_COURTYARD, 'MALFORMED_F_COURTYARD'],
    [MALFORMED_B_COURTYARD, 'MALFORMED_B_COURTYARD'],
    [ROUTER_TRANSIENT, 'ROUTER_TRANSIENT'],
    [CONNECTIVITY_CANDIDATE, 'CONNECTIVITY_CANDIDATE'],
    [HOLE_PROXY, 'HOLE_PROXY'],
    [SHOW_ELEC_TYPE, 'SHOW_ELEC_TYPE'],
    [BRIGHTENED, 'BRIGHTENED'],
    [UR_TRANSIENT, 'UR_TRANSIENT'],
    [IS_DANGLING, 'IS_DANGLING'],
    [ENTERED, 'ENTERED'],
    [SELECTION_CANDIDATE, 'SELECTION_CANDIDATE'],
  ];

  const setFlags: string[] = [];
  for (const [value, name] of flagDescs) {
    if ((flags & value) >>> 0) setFlags.push(name);
  }

  if (setFlags.length === 0) return '0';
  return setFlags.join(' | ');
}
