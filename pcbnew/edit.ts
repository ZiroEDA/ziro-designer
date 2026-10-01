// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/edit.cpp`: `PCB_EDIT_FRAME::SwitchLayer` and `OnEditItemRequest`.
 * KiCad spreads `PCB_EDIT_FRAME`'s methods across many `.cpp` files; we
 * mirror that with the same `applyMixins` pattern `undo_redo.ts` already
 * uses for `PCB_BASE_EDIT_FRAME` — each method takes an explicit
 * `this: PCB_EDIT_FRAME` parameter, and `pcb_edit_frame.ts` merges this in
 * with `applyMixins`/`interface … extends EDIT_MIXIN`.
 *
 * `Process_Special_Functions` (this file's command-ID `switch` upstream) is
 * not ported here: it is legacy `wxCommandEvent` dispatch for the pre-TOOL_
 * MANAGER command IDs, and every command it handles already has its own
 * `PCB_ACTIONS`-shaped handler in `pcb_edit_frame_ui.tsx`'s own dispatch
 * (`onTopAction`/`buildPcbMenus`), which is where our port's equivalent
 * command routing already lives.
 */
import { IsCopperLayer, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from './board_item.js';
import type { PCB_EDIT_FRAME } from './pcb_edit_frame.js';

/** `PCB_EDIT_FRAME`'s `edit.cpp` half, mixed into that class by `pcb_edit_frame.ts`. */
export class EDIT_MIXIN {
  /**
   * `PCB_EDIT_FRAME::SwitchLayer( PCB_LAYER_ID )` (edit.cpp:72-95): the
   * validated entry point every layer-changing control goes through —
   * `SetActiveLayer` itself does not refuse a disabled copper layer.
   */
  SwitchLayer(this: PCB_EDIT_FRAME, layer: PCB_LAYER_ID): void {
    const curLayer = this.GetActiveLayer();

    // Check if the specified layer matches the present layer
    if (layer === curLayer) return;

    // Copper layers cannot be selected unconditionally; how many of those
    // layers are currently enabled needs to be checked.
    if (IsCopperLayer(layer)) {
      if (layer > this.GetBoard()!.GetCopperLayerStackMaxId()) return;
    }

    // Is yet more checking required? E.g. when the layer to be selected is a
    // non-copper layer, or when switching between a copper layer and a
    // non-copper layer, or vice-versa?

    this.SetActiveLayer(layer);

    if (this.GetDisplayOptions().m_ContrastModeDisplay !== HIGH_CONTRAST_MODE.NORMAL)
      this.GetCanvas()?.Refresh();
  }

  /** `PCB_EDIT_FRAME::OnEditItemRequest`: the item's properties dialog. */
  OnEditItemRequest(this: PCB_EDIT_FRAME, aItem: BOARD_ITEM | null): void {
    // `case PCB_GROUP_T:` (edit.cpp:161-164): GROUP_TOOL::GroupProperties.
    // Every other arm is still the window's.
    if (aItem?.Type() === KICAD_T.PCB_GROUP_T) {
      this.m_toolManager!.RunAction(ACTIONS.groupProperties, aItem);
      return;
    }

    this.hooks.onEditItemRequest(aItem);
  }
}
