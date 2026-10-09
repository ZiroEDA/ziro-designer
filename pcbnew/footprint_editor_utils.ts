// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/footprint_editor_utils.cpp`: FOOTPRINT_EDIT_FRAME's load from a
 * library, its item properties dispatch and the footprint properties dialog,
 * mixed into the frame; and the MAIL_FP_EDIT path resolution.
 */
import { fpNameOf } from './footprint_library_adapter.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { FOOTPRINT_EDIT_FRAME } from './footprint_edit_frame.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { BOARD_COMMIT } from './board_commit.js';
import type { BOARD_ITEM } from './board_item.js';
import type { FOOTPRINT } from './footprint.js';
import type { PAD } from './pad.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import type { PCB_REFERENCE_IMAGE } from './pcb_reference_image.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_TEXT } from './pcb_text.js';
import type { PCB_TEXTBOX } from './pcb_textbox.js';
import type { ZONE } from './zone.js';
import { ZONE_SETTINGS } from './zone_settings.js';
import { DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR } from './dialogs/dialog_footprint_properties_fp_editor.js';
import { DIALOG_TEXT_PROPERTIES } from './dialogs/dialog_text_properties.js';
import { DIALOG_COPPER_ZONE } from './dialogs/panel_zone_properties.js';
import { DIALOG_NON_COPPER_ZONES_EDITOR } from './dialogs/dialog_non_copper_zones_properties.js';
import { DIALOG_RULE_AREA_PROPERTIES } from './dialogs/dialog_rule_area_properties.js';

/**
 * `FOOTPRINT_EDIT_FRAME::KiwayMailIn`'s `MAIL_FP_EDIT` branch
 * (`footprint_editor_utils.cpp:336-375`), its `LIB_ID( libNickname,
 * fpFileName.GetName() )` half: resolve a project `.kicad_mod` path (the file
 * the project manager double-clicked) to the library nickname and footprint
 * name the manager keys it under. Mirrors the bootstrap grouping: a
 * footprint's library is its `.pretty` directory, its name the file basename.
 *
 * Moved here from `footprint_edit_frame_ui.tsx`, where it sat as a private
 * helper of the window.
 */
export function fpTargetOf(path: string): { lib: string; name: string } {
  const norm = path.replace(/\\/g, '/');
  const m = /([^/]+)\.pretty\//i.exec(norm);
  const dir = m ? `${m[1]}.pretty` : norm.split('/').slice(0, -1).join('/') || 'Project';
  const lib = dir
    .replace(/\.pretty$/i, '')
    .split('/')
    .pop()!;
  return { lib, name: fpNameOf(norm) };
}

/** `FOOTPRINT_EDIT_FRAME`'s `footprint_editor_utils.cpp` half, mixed into that class by `footprint_edit_frame.ts`. */
export class FOOTPRINT_EDITOR_UTILS_MIXIN {
  /**
   * `FOOTPRINT_EDIT_FRAME::LoadFootprintFromLibrary` (footprint_editor_utils.cpp:57-104):
   * the footprint out of its library onto an emptied holder board, with a
   * reference and value to see, unmodified.
   */
  async LoadFootprintFromLibrary(this: FOOTPRINT_EDIT_FRAME, aFPID: LIB_ID): Promise<void> {
    const footprint = await this.LoadFootprint(aFPID);

    if (!footprint) return;

    if (!(await this.Clear_Pcb(true))) return;

    this.GetCanvas()?.GetViewControls().SetCrossHairCursorPosition({ x: 0, y: 0 }, false);
    this.AddFootprintToBoard(footprint);

    footprint.ClearFlags();

    // if either reference or value are missing, reinstall them -
    // otherwise you cannot see what you are doing on board
    if (footprint.Reference().GetText() === '') footprint.SetReference('Ref**');

    if (footprint.Value().GetText() === '') footprint.SetValue('Val**');

    this.GetScreen()?.SetContentModified(false);

    // Zoom_Automatique, Update3DView, the tree's ExpandLibId and the idle
    // CenterLibId: the window's.
    this.hooks.onFootprintLoaded?.(aFPID);
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::editFootprintProperties` (footprint_editor_utils.cpp:186-205):
   * the properties dialog, then the tree and title in case the name changed.
   */
  async editFootprintProperties(this: FOOTPRINT_EDIT_FRAME, aFootprint: FOOTPRINT): Promise<void> {
    await this.ShowFootprintPropertiesFpEditorDialog(
      new DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR(this, aFootprint),
    );

    // Update design settings for footprint layers: `updateEnabledLayers()`
    // is the window's, which rebuilds the layer table from fpedit.json.

    // Update library tree and title in case of a name change
    // (`UpdateLibraryTree( treeItem, aFootprint )`: the row renamed in place).
    this.SyncLibraryTree(false);
    this.UpdateTitle();

    this.UpdateMsgPanel();
    this.hooks.updateUserInterface?.();
  }

  /** `FOOTPRINT_EDIT_FRAME::OnEditItemRequest` (footprint_editor_utils.cpp:208-302). */
  OnEditItemRequest(this: FOOTPRINT_EDIT_FRAME, aItem: BOARD_ITEM): void {
    switch (aItem.Type()) {
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        this.ShowReferenceImagePropertiesDialog(aItem as unknown as PCB_REFERENCE_IMAGE);
        break;

      case KICAD_T.PCB_BARCODE_T:
        void this.ShowBarcodePropertiesDialog(aItem as unknown as PCB_BARCODE);
        break;

      case KICAD_T.PCB_PAD_T:
        this.ShowPadPropertiesDialog(aItem as unknown as PAD);
        break;

      case KICAD_T.PCB_FOOTPRINT_T:
        void this.editFootprintProperties(aItem as unknown as FOOTPRINT).then(() =>
          this.GetCanvas()?.Refresh(),
        );
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

      case KICAD_T.PCB_SHAPE_T:
        this.ShowGraphicItemPropertiesDialog(aItem as unknown as PCB_SHAPE);
        break;

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
        this.ShowDimensionPropertiesDialog(aItem as unknown as PCB_DIMENSION_BASE);
        break;

      case KICAD_T.PCB_ZONE_T: {
        const zone = aItem as unknown as ZONE;
        const zoneSettings = new ZONE_SETTINGS();

        zoneSettings.importFrom(zone);

        let dlg: DIALOG_RULE_AREA_PROPERTIES | DIALOG_COPPER_ZONE | DIALOG_NON_COPPER_ZONES_EDITOR;

        if (zone.GetIsRuleArea()) dlg = new DIALOG_RULE_AREA_PROPERTIES(this, null, zoneSettings);
        else if (zone.IsOnCopperLayer()) dlg = new DIALOG_COPPER_ZONE(this, zone, zoneSettings);
        else dlg = new DIALOG_NON_COPPER_ZONES_EDITOR(this, null, zoneSettings);

        void this.ShowZoneSettingsDialog(dlg).then((success) => {
          if (!success) return;

          const commit = new BOARD_COMMIT(this);
          commit.Modify(zone);
          commit.Push('Edit Zone');
          zoneSettings.ExportSetting(zone);
        });
        break;
      }

      case KICAD_T.PCB_GROUP_T:
        this.m_toolManager!.RunAction(ACTIONS.groupProperties, aItem);
        break;

      case KICAD_T.PCB_MARKER_T:
        // FOOTPRINT_EDITOR_CONTROL::CrossProbe opens the Footprint Checker, which
        // is not ported yet.
        break;

      case KICAD_T.PCB_POINT_T:
        break;

      default:
        console.warn(
          `FOOTPRINT_EDIT_FRAME::OnEditItemRequest: unsupported item type ${aItem.GetClass()}`,
        );
        break;
    }
  }
}
