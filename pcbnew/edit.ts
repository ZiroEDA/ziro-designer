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
import { DIALOG_TEXT_PROPERTIES } from './dialogs/dialog_text_properties.js';
import type { FOOTPRINT } from './footprint.js';
import type { PAD } from './pad.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import type { PCB_MARKER } from './pcb_marker.js';
import type { PCB_REFERENCE_IMAGE } from './pcb_reference_image.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_TARGET } from './pcb_target.js';
import type { PCB_TEXT } from './pcb_text.js';
import type { PCB_TEXTBOX } from './pcb_textbox.js';
import type { ZONE } from './zone.js';

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

  /** `PCB_EDIT_FRAME::OnEditItemRequest` (pcb_edit_frame.cpp:3384-3465). */
  OnEditItemRequest(this: PCB_EDIT_FRAME, aItem: BOARD_ITEM | null): void {
    if (!aItem) return;

    switch (aItem.Type()) {
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        this.ShowReferenceImagePropertiesDialog(aItem as unknown as PCB_REFERENCE_IMAGE);
        break;

      case KICAD_T.PCB_BARCODE_T:
        void this.ShowBarcodePropertiesDialog(aItem as unknown as PCB_BARCODE);
        break;

      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T:
        void this.ShowTextPropertiesDialog(
          new DIALOG_TEXT_PROPERTIES(this, aItem as unknown as PCB_TEXT),
        );
        break;

      case KICAD_T.PCB_TEXTBOX_T:
        void this.ShowTextBoxPropertiesDialog(aItem as unknown as PCB_TEXTBOX);
        break;

      case KICAD_T.PCB_TABLE_T:
        //QuasiModal required for Scintilla auto-complete
        void this.ShowTablePropertiesDialog(aItem as unknown as PCB_TABLE);
        break;

      case KICAD_T.PCB_PAD_T:
        this.ShowPadPropertiesDialog(aItem as unknown as PAD);
        break;

      case KICAD_T.PCB_FOOTPRINT_T:
        this.ShowFootprintPropertiesDialog(aItem as unknown as FOOTPRINT);
        break;

      case KICAD_T.PCB_TARGET_T:
        this.ShowTargetOptionsDialog(aItem as unknown as PCB_TARGET);
        break;

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
        this.ShowDimensionPropertiesDialog(aItem as unknown as PCB_DIMENSION_BASE);
        break;

      case KICAD_T.PCB_SHAPE_T:
        this.ShowGraphicItemPropertiesDialog(aItem as unknown as PCB_SHAPE);
        break;

      case KICAD_T.PCB_ZONE_T:
        this.Edit_Zone_Params(aItem as unknown as ZONE);
        break;

      case KICAD_T.PCB_GROUP_T:
        this.m_toolManager!.RunAction(ACTIONS.groupProperties, aItem);
        break;

      case KICAD_T.PCB_GENERATOR_T:
        // PCB_GENERATOR::ShowPropertiesDialog is not ported (no generator has a dialog yet).
        break;

      case KICAD_T.PCB_MARKER_T:
        (
          this.m_toolManager!.FindTool('pcbnew.DRCTool') as unknown as {
            CrossProbe(aMarker: PCB_MARKER): void;
          } | null
        )?.CrossProbe(aItem as unknown as PCB_MARKER);
        break;

      case KICAD_T.PCB_POINT_T:
        break;

      default:
        break;
    }
  }
}
