// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/edit_track_width.cpp`: `PCB_EDIT_FRAME::SetTrackSegmentWidth`, the
 * single-item "use design-rule / netclass / current-selection width" action a
 * track or via gets right-clicked into. Ported as a free function over the
 * live `PCB_TRACK` / `PCB_VIA` (`aItem.GetBoard()!.GetDesignSettings()`
 * stands in for the frame's `GetDesignSettings()`), with the same
 * `PICKED_ITEMS_LIST` undo contract as the C++ rather than a `BOARD_COMMIT`
 * — this is the one caller-facing shape upstream itself uses.
 *
 * `Tracks_and_Vias_Size_Event` (the aux toolbar's width/via-size combo boxes)
 * is not ported: it is `wxCommandEvent` id-switch dispatch entirely over
 * window IDs (`ID_POPUP_PCB_SELECT_WIDTH1`..16, `m_SelTrackWidthBox`) with no
 * model-side logic of its own — everything it does bottoms out in
 * `BOARD_DESIGN_SETTINGS::SetTrackWidthIndex` / `SetViaSizeIndex`
 * (`board_design_settings.ts`, already ported) or this function.
 *
 * `dialog_global_edit_tracks_and_vias.ts` (`pcbnew/dialogs/`) is upstream's
 * other caller (`DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS::visitItem` calls
 * `SetTrackSegmentWidth` three times) but it operates on this repo's older
 * plain-data `Board`/`PcbTrack` model, not the live classes here, and is
 * being retired separately (see `pcbnew-live-board-architecture` / #636) —
 * left untouched to avoid fighting that migration.
 */
import type { MINOPTMAX } from '@ziroeda/core/minoptmax.js';
import {
  ITEM_PICKER,
  type PICKED_ITEMS_LIST,
  UNDO_REDO,
} from '@ziroeda/common/undo_redo_container.js';
import { VIATYPE } from './pcb_track_types.js';
import { PCB_VIA, type PCB_TRACK } from './pcb_track.js';

/**
 * `SetTrackSegmentWidth` (`edit_track_width.cpp:34`).
 *
 * With `aUseDesignRules`, the new width (and, for a via, the new drill) comes
 * from the DRC engine's constraint for the item — its `Opt()` if the
 * constraint has one, else its `Min()` if positive, else the item is left
 * alone. Without it: a microvia takes its netclass's microvia size/drill; any
 * other via takes the board's current via size/drill (the aux toolbar's
 * selection); anything else takes the board's current track width.
 *
 * Pushes an undo entry (an `ITEM_PICKER` linked to a `Clone()` of the item
 * *before* the edit) only when something actually changes, and returns
 * whether it did — so a caller visiting many items can count how many were
 * touched the same way the C++ implicitly does via the picker list's length.
 */
export function SetTrackSegmentWidth(
  aItem: PCB_TRACK,
  aItemsListPicker: PICKED_ITEMS_LIST,
  aUseDesignRules: boolean,
): boolean {
  const via = aItem instanceof PCB_VIA ? aItem : null;
  let new_width = -1;
  let new_drill = -1;

  if (aUseDesignRules) {
    let constraint: MINOPTMAX = aItem.GetWidthConstraint();

    if (constraint.HasOpt()) new_width = constraint.Opt();
    else if (constraint.Min() > 0) new_width = constraint.Min();

    if (via) {
      constraint = via.GetDrillConstraint();

      if (constraint.HasOpt()) new_drill = constraint.Opt();
      else if (constraint.Min() > 0) new_drill = constraint.Min();
    }
  } else if (via && via.GetViaType() === VIATYPE.MICROVIA) {
    const nc = aItem.GetEffectiveNetClass();
    new_width = nc.GetuViaDiameter();
    new_drill = nc.GetuViaDrill();
  } else if (via) {
    const bds = aItem.GetBoard()!.GetDesignSettings();
    new_width = bds.GetCurrentViaSize();
    new_drill = bds.GetCurrentViaDrill();
  } else {
    new_width = aItem.GetBoard()!.GetDesignSettings().GetCurrentTrackWidth();
  }

  if (new_width <= 0) new_width = aItem.GetWidth();

  if (via && new_drill <= 0) new_drill = via.GetDrillValue();

  if (aItem.GetWidth() !== new_width || (via && via.GetDrillValue() !== new_drill)) {
    const picker = new ITEM_PICKER(null, aItem, UNDO_REDO.CHANGED);
    picker.SetLink(aItem.Clone());
    aItemsListPicker.PushItem(picker);

    aItem.SetWidth(new_width);

    if (via && new_drill > 0) via.SetDrill(new_drill);

    return true;
  }

  return false;
}
