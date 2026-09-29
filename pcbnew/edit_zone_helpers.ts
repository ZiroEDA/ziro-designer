// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/edit_zone_helpers.cpp`: `PCB_EDIT_FRAME::Edit_Zone_Params`, the
 * case `OnEditItemRequest`'s `PCB_ZONE_T` arm delegates to (`edit.cpp:157-
 * 158`). KiCad spreads `PCB_EDIT_FRAME`'s methods across many `.cpp` files;
 * we mirror that with the same `applyMixins` pattern `undo_redo.ts` already
 * uses for `PCB_BASE_EDIT_FRAME`.
 *
 * Upstream also chooses which of `InvokeRuleAreaEditor`/
 * `InvokeCopperZonesEditor`/`InvokeNonCopperZonesEditor` to open — a modal
 * call that blocks for a `wxID_OK`/`wxID_CANCEL` result. Our dialogs are
 * modeless React components, so that choice is a render decision instead
 * (`pcb_edit_frame_ui.tsx`'s own `zonePropsIndex !== null &&
 * ....GetIsRuleArea()` conditions already make it, from the zone's own
 * model state); this method's job is only to open the properties dialog
 * for the requested zone, through the frame's hooks — the same seam
 * `OnEditItemRequest` (`edit.ts`) already uses.
 */
import type { PCB_EDIT_FRAME } from './pcb_edit_frame.js';

/** `PCB_EDIT_FRAME`'s `edit_zone_helpers.cpp` half, mixed in by `pcb_edit_frame.ts`. */
export class EDIT_ZONE_HELPERS_MIXIN {
  /**
   * `PCB_EDIT_FRAME::Edit_Zone_Params( ZONE* aZone )`: open the zone's
   * properties dialog. `aZone` is the zone's index into the live board
   * (`BOARD::Zones()`'s order), matching every other properties-dialog
   * trigger this port already tracks by index rather than by object.
   */
  Edit_Zone_Params(this: PCB_EDIT_FRAME, zoneIndex: number): void {
    this.hooks.editZoneParams(zoneIndex);
  }
}
