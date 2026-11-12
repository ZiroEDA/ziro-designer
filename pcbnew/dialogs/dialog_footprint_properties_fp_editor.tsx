// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR`
 * (`pcbnew/dialogs/dialog_footprint_properties_fp_editor.cpp`) over the live
 * FOOTPRINT the footprint editor holds: what the window shows
 * (`TransferDataToWindow`), its checks (`Validate`), and what OK writes back
 * (`TransferDataFromWindow`), one commit.
 *
 * The window's controls are the values object; the fields grid is a list of
 * PCB_FIELD copies, as upstream's `FIELDS_GRID_TABLE` holds copies.
 *
 * Not ported: the Embedded Files page (`m_embeddedFiles`), which the
 * footprint editor here cannot add files to yet. Fields that point into the
 * footprint's embedded files are still released when they go, as OK does.
 */

import { type JSX, type ReactNode, useRef, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxGRID_VALUE_NUMBER,
  wxGRID_VALUE_STRING,
  wxGridCellAttr,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import {
  GRID_CELL_LAYER_RENDERER,
  GRID_CELL_LAYER_SELECTOR,
  allLayerChoices,
  choiceOf,
} from '../grid_layer_box_helpers.js';
import { PCB_FIELDS_GRID_TABLE } from '../pcb_fields_grid_table.js';
import type { PANEL_3D_MODEL_HOST, SELECTED_3D_MODEL } from './panel_fp_properties_3d_model.js';
import {
  PanelFpProperties3dModel,
  type PANEL_3D_MODEL_API,
} from './panel_fp_properties_3d_model.js';

import { unitLabel } from '@ziroeda/common/eda_units.js';
import { MARGIN_OFFSET_BINDER } from '@ziroeda/common/widgets/margin_offset_binder.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import {
  DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR_BASE,
  type GRID_BUTTONS,
} from './dialog_footprint_properties_fp_editor_base.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { KiCadUriPrefix } from '@ziroeda/common/embedded_files.js';
import { ClampTextPenSize } from '@ziroeda/common/gr_text.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { FIELD_T, GetUserFieldName } from '@ziroeda/common/template_fieldnames.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { BOARD_COMMIT } from '../board_commit.js';
import {
  FOOTPRINT,
  FOOTPRINT_STACKUP,
  type FP_3DMODEL,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
} from '../footprint.js';
import type { FOOTPRINT_EDIT_FRAME } from '../footprint_edit_frame.js';
import { LAYER_UTILS } from '../layer_utils.js';
import { PCB_FIELD } from '../pcb_field.js';
import { PCB_SELECTION_TOOL } from '../tools/pcb_selection_tool.js';
import { ZONE_CONNECTION } from '../zones.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `m_componentType`'s rows. [data] */
export const COMPONENT_TYPES = [_HKI('Through hole'), _HKI('SMD'), _HKI('Unspecified')] as const;

/** `m_ZoneConnectionChoice`'s rows, in `ZONE_CONNECTION` order 0..3. [data] */
const ZONE_CHOICE: readonly ZONE_CONNECTION[] = [
  ZONE_CONNECTION.INHERITED,
  ZONE_CONNECTION.FULL,
  ZONE_CONNECTION.THERMAL,
  ZONE_CONNECTION.NONE,
];

export interface FootprintFpEditorValues {
  /** `m_FootprintNameCtrl`. */
  footprintName: string;
  /** `m_DocCtrl`: the description, escaped for one line. */
  description: string;
  /** `m_KeywordCtrl`. */
  keywords: string;
  /** `m_fields`: copies of the footprint's fields, as the grid edits them. */
  fields: PCB_FIELD[];
  /** `m_componentType`: 0 through hole, 1 SMD, 2 unspecified. */
  componentType: 0 | 1 | 2;
  /** `m_privateLayers`. */
  privateLayers: PCB_LAYER_ID[];
  /** `m_cbCustomLayers`. */
  customLayers: boolean;
  /** `m_copperLayerCount`'s selection: (count / 2) - 1. */
  copperLayerCountSel: number;
  /** `m_customUserLayers`. */
  customUserLayers: PCB_LAYER_ID[];
  boardOnly: boolean;
  excludeFromPosFiles: boolean;
  excludeFromBOM: boolean;
  dnp: boolean;
  /** Clearance overrides; null is the empty control. */
  localClearance: number | null;
  localSolderMaskMargin: number | null;
  localSolderPasteMargin: number | null;
  localSolderPasteMarginRatio: number | null;
  allowMissingCourtyard: boolean;
  allowSolderMaskBridges: boolean;
  /** `m_ZoneConnectionChoice`'s selection. */
  zoneConnection: 0 | 1 | 2 | 3;
  /** `m_nettieGroupsGrid`'s rows. */
  netTieGroups: string[];
  duplicatePadsAreJumpers: boolean;
  /** `m_jumperGroupsGrid`'s rows: pad numbers joined by ", ". */
  jumperGroups: string[];
  /** `m_3dPanel->GetModelList()`. */
  models: FP_3DMODEL[];
}

/** What a failed check names: the message and where the focus goes. */
export interface FpEditorValidateResult {
  ok: boolean;
  message?: string;
  /** `m_delayedFocusPage`. */
  page?: 'general' | 'layers';
  /** `m_delayedFocusRow` in the fields grid, when the fault is a field's. */
  fieldRow?: number;
}

export class DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR {
  private readonly m_frame: FOOTPRINT_EDIT_FRAME;
  private readonly m_footprint: FOOTPRINT;

  constructor(aParent: FOOTPRINT_EDIT_FRAME, aFootprint: FOOTPRINT) {
    this.m_frame = aParent;
    this.m_footprint = aFootprint;
  }

  GetFootprint(): FOOTPRINT {
    return this.m_footprint;
  }

  /** `static NOTEBOOK_PAGES m_page`: the page the dialog was last left on. */
  static m_page = 0;

  GetFrame(): FOOTPRINT_EDIT_FRAME {
    return this.m_frame;
  }

  /**
   * `OnAddField` (:890-918): a user field named for its row, on the active
   * layer when that is a technical layer, else the last row's, sized by the
   * board's text defaults for that layer.
   */
  MakeNewField(aFields: readonly PCB_FIELD[]): PCB_FIELD {
    const dsnSettings = this.m_frame.GetDesignSettings();

    const newField = new PCB_FIELD(
      this.m_footprint,
      FIELD_T.USER,
      GetUserFieldName(aFields.length, true),
    );

    // Set active layer if legal; otherwise copy layer from previous text item
    if (LSET.AllTechMask().test(this.m_frame.GetActiveLayer()))
      newField.SetLayer(this.m_frame.GetActiveLayer());
    else newField.SetLayer(aFields[aFields.length - 1]!.GetLayer());

    newField.SetTextSize(dsnSettings.GetTextSize(newField.GetLayer()));
    newField.SetTextThickness(dsnSettings.GetTextThickness(newField.GetLayer()));
    newField.SetItalic(dsnSettings.GetTextItalic(newField.GetLayer()));

    return newField;
  }

  /**
   * `OnDeleteField`'s guard (:921-944): the mandatory rows cannot go. The
   * message to show, or null when the row may be deleted.
   */
  CanDeleteField(aRow: number, aFields: readonly PCB_FIELD[]): string | null {
    const mandatory = aFields.filter((f) => f.IsMandatory()).length;

    if (aRow < mandatory) return wxFormat(_('The first %d fields are mandatory.'), mandatory);

    return null;
  }

  /**
   * `onLayerGridRowAddUserLayer` (:961-977): the first user layer, stepping
   * by two, that the grid does not hold yet.
   */
  static NextUserLayer(aLayers: readonly PCB_LAYER_ID[]): PCB_LAYER_ID {
    let nextLayer = PCB_LAYER_ID.User_1;

    while (aLayers.includes(nextLayer) && nextLayer < PCB_LAYER_ID.User_45)
      nextLayer = (nextLayer + 2) as PCB_LAYER_ID;

    return nextLayer;
  }

  /** `TransferDataToWindow()` (:319-493). */
  TransferDataToWindow(): FootprintFpEditorValues {
    const fp = this.m_footprint;
    const attrs = fp.GetAttributes();
    const stackupLayers = fp.GetStackupLayers();
    const custom = fp.GetStackupMode() === FOOTPRINT_STACKUP.CUSTOM_LAYERS;

    return {
      footprintName: fp.GetFPID().GetLibItemName(),
      description: EscapeString(fp.GetLibDescription(), ESCAPE_CONTEXT.CTX_LINE),
      keywords: fp.GetKeywords(),
      fields: fp.GetFields().map((f) => PCB_FIELD.copyOfField(f)),
      componentType: attrs & FP_THROUGH_HOLE ? 0 : attrs & FP_SMD ? 1 : 2,
      privateLayers: [...fp.GetPrivateLayers().UIOrder()],
      customLayers: custom,
      copperLayerCountSel: custom ? stackupLayers.and(LSET.AllCuMask()).count() / 2 - 1 : 0,
      customUserLayers: custom ? [...stackupLayers.and(LSET.UserDefinedLayersMask()).Seq()] : [],
      boardOnly: (attrs & FP_BOARD_ONLY) !== 0,
      excludeFromPosFiles: (attrs & FP_EXCLUDE_FROM_POS_FILES) !== 0,
      excludeFromBOM: (attrs & FP_EXCLUDE_FROM_BOM) !== 0,
      dnp: (attrs & FP_DNP) !== 0,
      localClearance: fp.GetLocalClearance() ?? null,
      localSolderMaskMargin: fp.GetLocalSolderMaskMargin() ?? null,
      localSolderPasteMargin: fp.GetLocalSolderPasteMargin() ?? null,
      localSolderPasteMarginRatio: fp.GetLocalSolderPasteMarginRatio() ?? null,
      allowMissingCourtyard: fp.AllowMissingCourtyard(),
      allowSolderMaskBridges: fp.AllowSolderMaskBridges(),
      zoneConnection: Math.max(0, ZONE_CHOICE.indexOf(fp.GetLocalZoneConnection())) as
        | 0
        | 1
        | 2
        | 3,
      netTieGroups: fp.GetNetTiePadGroups().filter((g) => g !== ''),
      duplicatePadsAreJumpers: fp.GetDuplicatePadNumbersAreJumpers(),
      jumperGroups: fp.JumperPadGroups().map((g) => [...g].join(', ')),
      models: fp.Models().map((m) => m.clone()),
    };
  }

  /** `getCustomLayersFromControls()` (:537-558). */
  private getCustomLayersFromControls(v: FootprintFpEditorValues): LSET {
    const userLayers = new LSET();

    if (v.customLayers) {
      userLayers.or(LSET.AllCuMask((v.copperLayerCountSel + 1) * 2));

      for (const layer of v.customUserLayers) userLayers.set(layer);
    } else {
      // The default stackup restricts nothing, so every standard layer is available.
      userLayers.or(new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]));
      userLayers.or(LSET.InternalCuMask());
      userLayers.or(LSET.UserDefinedLayersMask());
    }

    return userLayers;
  }

  /**
   * `checkFootprintName( aFootprintName, doOverwrite )` (:496-534). Answers the
   * LIB_ID to overwrite when the user agreed to replace another footprint.
   */
  private async checkFootprintName(
    aFootprintName: string,
  ): Promise<{ ok: boolean; message?: string; overwrite?: { lib: string; name: string } }> {
    const fp = this.m_footprint;

    if (aFootprintName === '') return { ok: false, message: _('Footprint must have a name.') };

    if (!FOOTPRINT.IsLibNameValid(aFootprintName))
      return {
        ok: false,
        message: wxFormat(
          _("Footprint name may not contain '%s'."),
          FOOTPRINT.StringLibNameInvalidChars(true),
        ),
      };

    const libraryName = fp.GetFPID().GetLibNickname();
    const originalFPName = fp.GetFPID().GetLibItemName();
    const adapter = this.m_frame.FootprintLibAdapter();

    if (
      aFootprintName !== originalFPName &&
      adapter?.FootprintExists(libraryName, aFootprintName)
    ) {
      const msg = wxFormat(
        _("Footprint '%s' already exists in library '%s'."),
        aFootprintName,
        libraryName,
      );

      const answer = await this.m_frame.AskKiDialog({
        caption: _('Confirmation'),
        message: msg,
        icon: 'warning',
        labels: { ok: _('Overwrite') },
      });

      if (answer === 'ok')
        return { ok: true, overwrite: { lib: libraryName, name: aFootprintName } };
    }

    return { ok: true };
  }

  /** `Validate()` (:561-676). */
  async Validate(v: FootprintFpEditorValues): Promise<FpEditorValidateResult> {
    // First, test for invalid chars in footprint name
    const name = await this.checkFootprintName(v.footprintName);

    if (!name.ok) return { ok: false, message: name.message, page: 'general' };

    // Check for valid field text properties
    for (let i = 0; i < v.fields.length; ++i) {
      const field = v.fields[i]!;

      // Check for missing field names.
      if (field.GetName(false) === '')
        return { ok: false, message: _('Fields must have a name.'), page: 'general', fieldRow: i };

      const minSize = pcbIUScale.mmToIU(TEXT_MIN_SIZE_MM);
      const maxSize = pcbIUScale.mmToIU(TEXT_MAX_SIZE_MM);
      const range = wxFormat(
        _('%s and %s'),
        this.m_frame.GetUnitsProvider().StringFromValue(minSize, true),
        this.m_frame.GetUnitsProvider().StringFromValue(maxSize, true),
      );

      if (field.GetTextWidth() < minSize || field.GetTextWidth() > maxSize)
        return {
          ok: false,
          message: `The text width must be between ${range}.`,
          page: 'general',
          fieldRow: i,
        };

      if (field.GetTextHeight() < minSize || field.GetTextHeight() > maxSize)
        return {
          ok: false,
          message: `The text height must be between ${range}.`,
          page: 'general',
          fieldRow: i,
        };

      // Test for acceptable values for thickness and size and clamp if fails
      const maxPenWidth = ClampTextPenSize(field.GetTextThickness(), field.GetTextSize());

      if (field.GetTextThickness() > maxPenWidth) {
        field.SetTextThickness(maxPenWidth);

        return {
          ok: false,
          message: _('The text thickness is too large for the text size.\nIt will be clamped.'),
          page: 'general',
          fieldRow: i,
        };
      }
    }

    // m_netClearance.Validate( 0, INT_MAX )
    if (v.localClearance !== null && v.localClearance < 0) return { ok: false, page: 'general' };

    if (name.overwrite) {
      if (
        await this.m_frame.DeleteFootprintFromLibrary(
          new LIB_ID(name.overwrite.lib, name.overwrite.name),
          false /* already confirmed */,
        )
      )
        this.m_frame.SyncLibraryTree(true);
    }

    // A custom layer set restricts which layers the footprint may use, so check that the user
    // isn't removing a layer that is still used by the footprint. The default stackup imposes no
    // such restriction, so nothing can be orphaned in that case.
    if (v.customLayers) {
      const orphanLayers = LAYER_UTILS.GetOrphanedFootprintLayers(
        this.m_footprint,
        this.getCustomLayersFromControls(v),
      );

      if (orphanLayers.any())
        return {
          ok: false,
          message: wxFormat(
            _(
              'You are trying to remove layers that are used by the footprint: %s.\nPlease remove the objects that use these layers first.',
            ),
            LAYER_UTILS.AccumulateNamesFromSet(orphanLayers, this.m_frame.GetBoard()),
          ),
          page: 'layers',
        };
    }

    return { ok: true };
  }

  /** `TransferDataFromWindow()` (:679-887). */
  TransferDataFromWindow(v: FootprintFpEditorValues): { ok: boolean; message?: string } {
    const fp = this.m_footprint;
    const view = this.m_frame.GetCanvas()?.GetView() ?? null;
    const selectionTool = this.m_frame.GetToolManager()?.GetTool(PCB_SELECTION_TOOL) ?? null;
    const commit = new BOARD_COMMIT(this.m_frame);
    commit.Modify(fp);

    // Clear out embedded files that are no longer in use
    const files = new Set<string>();
    const filesToDelete = new Set<string>();

    // Get the new files from the footprint fields
    for (const field of v.fields) {
      if (field.GetText().startsWith(KiCadUriPrefix)) files.add(field.GetText());
    }

    // Find any files referenced in the old fields that are not in the new fields
    for (const field of fp.GetFields()) {
      if (field.GetText().startsWith(KiCadUriPrefix) && !files.has(field.GetText()))
        filesToDelete.add(field.GetText());
    }

    for (const file of filesToDelete) {
      // Skip "kicad-embed://"
      fp.RemoveFile(file.slice(KiCadUriPrefix.length + 3));
    }

    const fpID = fp.GetFPID();
    fpID.SetLibItemName(v.footprintName);
    fp.SetFPID(fpID);

    fp.SetLibDescription(unescapeString(v.description));
    fp.SetKeywords(v.keywords);

    // Update fields
    this.m_frame.GetToolManager()?.RunAction(ACTIONS.selectionClear);

    while (fp.GetFields().length > 0) {
      const existing = fp.GetFields()[0]!;
      view?.Remove(existing);
      fp.Remove(existing);
    }

    for (const field of v.fields) {
      const newField = field.CloneField();
      fp.Add(newField);
      view?.Add(newField);

      if (newField.IsSelected()) {
        // The old copy was in the selection list, but this one is not.  Remove the
        // out-of-sync selection flag so we can re-add the field to the selection.
        newField.ClearSelected();
        selectionTool?.AddItemToSel(newField, true);
      }
    }

    const privateLayers = new LSET();

    for (const layer of v.privateLayers) privateLayers.set(layer);

    fp.SetPrivateLayers(privateLayers);

    if (v.customLayers) {
      fp.SetStackupMode(FOOTPRINT_STACKUP.CUSTOM_LAYERS);
      fp.SetStackupLayers(this.getCustomLayersFromControls(v));
    } else {
      // Just use the default stackup mode
      fp.SetStackupMode(FOOTPRINT_STACKUP.EXPAND_INNER_LAYERS);
    }

    let attributes = 0;

    switch (v.componentType) {
      case 0:
        attributes |= FP_THROUGH_HOLE;
        break;
      case 1:
        attributes |= FP_SMD;
        break;
      default:
        break;
    }

    if (v.boardOnly) attributes |= FP_BOARD_ONLY;

    if (v.excludeFromPosFiles) attributes |= FP_EXCLUDE_FROM_POS_FILES;

    if (v.excludeFromBOM) attributes |= FP_EXCLUDE_FROM_BOM;

    if (v.dnp) attributes |= FP_DNP;

    fp.SetAttributes(attributes);

    fp.SetAllowMissingCourtyard(v.allowMissingCourtyard);
    fp.SetAllowSolderMaskBridges(v.allowSolderMaskBridges);

    // Initialize mask clearances
    fp.SetLocalClearance(v.localClearance ?? undefined);
    fp.SetLocalSolderMaskMargin(v.localSolderMaskMargin ?? undefined);
    fp.SetLocalSolderPasteMargin(v.localSolderPasteMargin ?? undefined);
    fp.SetLocalSolderPasteMarginRatio(v.localSolderPasteMarginRatio ?? undefined);

    fp.SetLocalZoneConnection(ZONE_CHOICE[v.zoneConnection] ?? ZONE_CONNECTION.INHERITED);

    fp.ClearNetTiePadGroups();

    for (const group of v.netTieGroups) if (group !== '') fp.AddNetTiePadGroup(group);

    fp.SetDuplicatePadNumbersAreJumpers(v.duplicatePadsAreJumpers);

    const availablePads = new Set<string>();

    for (const pad of fp.Pads()) availablePads.add(pad.GetNumber());

    const newJumpers: Set<string>[] = [];

    for (let ii = 0; ii < v.jumperGroups.length; ++ii) {
      const group = new Set<string>();
      newJumpers.push(group);

      // wxStringTokenizer( text, ", \t\r\n", wxTOKEN_STRTOK )
      for (const token of v.jumperGroups[ii]!.split(/[, \t\r\n]+/)) {
        if (token === '') continue;

        if (!availablePads.has(token)) {
          // Upstream returns here with the commit unpushed: the edits above stay on the
          // footprint, outside the undo list.
          return {
            ok: false,
            message: `Pad '${token}' in jumper pad group ${ii + 1} does not exist in this footprint.`,
          };
        }

        group.add(token);
      }
    }

    const jumpers = fp.JumperPadGroups();
    jumpers.length = 0;
    jumpers.push(...newJumpers);

    // Copy the models from the panel to the footprint
    const fpList = fp.Models();
    fpList.length = 0;
    fpList.push(...v.models);

    commit.Push(_('Edit Footprint Properties'));

    return { ok: true };
  }
}

type Page = 'general' | 'layers' | 'clearances' | 'padConnections' | 'models3d';

/** One text column, as `m_nettieGroupsGrid` / `m_jumperGroupsGrid` are. */
class STRING_LIST_TABLE extends WX_GRID_TABLE_BASE {
  constructor(public m_rows: string[]) {
    super();
  }
  GetNumberRows(): number {
    return this.m_rows.length;
  }
  GetNumberCols(): number {
    return 1;
  }
  override CanGetValueAs(_r: number, _c: number, aType: string): boolean {
    return aType === wxGRID_VALUE_STRING;
  }
  GetValue(aRow: number): string {
    return this.m_rows[aRow] ?? '';
  }
  SetValue(aRow: number, _aCol: number, aValue: string): void {
    this.m_rows[aRow] = aValue;
  }
  override AppendRows(aNum = 1): boolean {
    for (let i = 0; i < aNum; ++i) this.m_rows.push('');
    return super.AppendRows(aNum);
  }
  override DeleteRows(aPos = 0, aNum = 1): boolean {
    this.m_rows.splice(aPos, aNum);
    return super.DeleteRows(aPos, aNum);
  }
}

/** `LAYERS_GRID_TABLE`: one layer column, a layer selector to edit it. */
class LAYERS_GRID_TABLE extends WX_GRID_TABLE_BASE {
  constructor(public m_layers: PCB_LAYER_ID[]) {
    super();
  }
  GetNumberRows(): number {
    return this.m_layers.length;
  }
  GetNumberCols(): number {
    return 1;
  }
  override CanGetValueAs(_r: number, _c: number, aType: string): boolean {
    return aType === wxGRID_VALUE_NUMBER;
  }
  override CanSetValueAs(_r: number, _c: number, aType: string): boolean {
    return aType === wxGRID_VALUE_NUMBER;
  }
  GetValue(aRow: number): string {
    return String(this.m_layers[aRow] ?? '');
  }
  SetValue(): void {}
  override GetValueAsLong(aRow: number): number {
    return this.m_layers[aRow] ?? -1;
  }
  override SetValueAsLong(aRow: number, _aCol: number, aValue: number): void {
    this.m_layers[aRow] = aValue as PCB_LAYER_ID;
  }
  override DeleteRows(aPos = 0, aNum = 1): boolean {
    this.m_layers.splice(aPos, aNum);
    return super.DeleteRows(aPos, aNum);
  }
}

function makeGrid<T extends WX_GRID_TABLE_BASE>(
  aTable: T,
  aLayerCol = false,
): { grid: WX_GRID; table: T; tricks: GRID_TRICKS } {
  const grid = new WX_GRID();
  grid.SetTable(aTable, true, wxGridSelectionModes.wxGridSelectRows);

  if (aLayerCol) {
    const attr = new wxGridCellAttr();
    attr.SetRenderer(new GRID_CELL_LAYER_RENDERER(choiceOf));
    attr.SetEditor(
      new GRID_CELL_LAYER_SELECTOR(() =>
        allLayerChoices().map((c) => ({
          layer: LSET_NameToLayer(c.value),
          label: c.label,
          swatch: c.swatch,
        })),
      ),
    );
    grid.SetColAttr(0, attr);
  }

  return { grid, table: aTable, tricks: new GRID_TRICKS(grid) };
}

export interface DialogFootprintPropertiesFpEditorProps {
  dialog: DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR;
  units: StatusUnits;
  /** `EndModal`: true for wxID_OK, false for Cancel. */
  onClose: (aOk: boolean) => void;
  /** The 3D Models page and what it asks of the frame. */
  model3d?: {
    footprint: FOOTPRINT;
    host: PANEL_3D_MODEL_HOST;
    renderPreview: (
      aModels: readonly FP_3DMODEL[],
      aSelected: number,
      aVersion: number,
    ) => ReactNode;
    pickModel: () => Promise<SELECTED_3D_MODEL | null>;
  };
}

export function DialogFootprintPropertiesFpEditor({
  dialog,
  units,
  onClose,
  model3d,
}: DialogFootprintPropertiesFpEditorProps): JSX.Element {
  const [initial] = useState(() => dialog.TransferDataToWindow());
  const [v, setV] = useState<FootprintFpEditorValues>(initial);
  // `m_page`: the page it was last left on.
  const [page, setPage] = useState<Page>(
    (['general', 'layers', 'clearances', 'padConnections', 'models3d'] as const)[
      DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR.m_page
    ] ?? 'general',
  );
  const modelsApi = useRef<PANEL_3D_MODEL_API | null>(null);

  const [fields] = useState(() =>
    makeGrid(
      new PCB_FIELDS_GRID_TABLE(
        dialog.GetFrame().GetUnitsProvider(),
        initial.fields,
        dialog.GetFrame(),
      ),
    ),
  );
  const [netTies] = useState(() => makeGrid(new STRING_LIST_TABLE([...initial.netTieGroups])));
  const [jumpers] = useState(() => makeGrid(new STRING_LIST_TABLE([...initial.jumperGroups])));
  const [privateLayers] = useState(() =>
    makeGrid(new LAYERS_GRID_TABLE([...initial.privateLayers]), true),
  );
  const [customLayers] = useState(() =>
    makeGrid(new LAYERS_GRID_TABLE([...initial.customUserLayers]), true),
  );

  const set = (patch: Partial<FootprintFpEditorValues>): void => setV((p) => ({ ...p, ...patch }));

  const commitGrids = (): boolean =>
    [fields, netTies, jumpers, privateLayers, customLayers].every((g) =>
      g.grid.CommitPendingChanges(),
    );

  const collect = (): FootprintFpEditorValues => ({
    ...v,
    fields: [...fields.table.GetFields()],
    netTieGroups: [...netTies.table.m_rows],
    jumperGroups: [...jumpers.table.m_rows],
    privateLayers: [...privateLayers.table.m_layers],
    customUserLayers: [...customLayers.table.m_layers],
    // `m_netClearance.IsNull()`: a blank box.
    localClearance:
      binders.netClearance.GetText().trim() === '' ? null : binders.netClearance.GetValue(),
    localSolderMaskMargin:
      binders.solderMask.GetText().trim() === '' ? null : binders.solderMask.GetValue(),
    localSolderPasteMargin: binders.solderPaste.GetOffsetValue() ?? null,
    localSolderPasteMarginRatio: binders.solderPaste.GetRatioValue() ?? null,
    models: modelsApi.current ? modelsApi.current.GetModelList() : v.models,
  });

  const onOk = async (): Promise<void> => {
    if (!commitGrids()) return;
    if (modelsApi.current && !modelsApi.current.CommitPendingChanges()) return;

    const values = collect();
    const check = await dialog.Validate(values);

    if (!check.ok) {
      if (check.page) setPage(check.page);
      if (check.message) DisplayErrorMessage(check.message);
      return;
    }

    const r = dialog.TransferDataFromWindow(values);

    if (!r.ok) {
      if (r.message) DisplayErrorMessage(r.message);
      return;
    }

    onClose(true);
  };

  const frame = dialog.GetFrame();
  // m_netClearance, m_solderMask, m_solderPaste: the clearance page's three binders.
  const [binders] = useState(() => {
    const netClearance = new UNIT_BINDER(frame, _('Pad clearance:'));
    const solderMask = new UNIT_BINDER(frame, _('Solder mask expansion:'));
    const solderPaste = new MARGIN_OFFSET_BINDER(frame.GetIuScale(), frame.GetUserUnits());

    if (initial.localClearance !== null) netClearance.SetValue(initial.localClearance);
    if (initial.localSolderMaskMargin !== null) solderMask.SetValue(initial.localSolderMaskMargin);
    solderPaste.SetOffsetValue(initial.localSolderPasteMargin ?? undefined);
    solderPaste.SetRatioValue(initial.localSolderPasteMarginRatio ?? undefined);

    return { netClearance, solderMask, solderPaste };
  });
  const [, bumpBinders] = useState(0);
  const userUnits = unitLabel(frame.GetUserUnits());

  const binderEntry = (aBinder: UNIT_BINDER) => ({
    value: aBinder.GetText(),
    units: userUnits,
    onChange: (aText: string) => {
      aBinder.SetText(aText);
      bumpBinders((n) => n + 1);
    },
  });

  const PAGES: readonly Page[] = ['general', 'layers', 'clearances', 'padConnections', 'models3d'];
  const pageIndex = Math.max(0, PAGES.indexOf(page));

  const changePage = (aPage: number): void => {
    // `m_page`, remembered for the next opening.
    DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR.m_page = aPage;
    setPage(PAGES[aPage]!);
  };

  const check = (aKey: keyof FootprintFpEditorValues & string, aEnabled = true) => ({
    value: v[aKey] as boolean,
    enabled: aEnabled,
    onChange: (aOn: boolean) => set({ [aKey]: aOn } as Partial<FootprintFpEditorValues>),
  });

  /** `bButtonSize`'s pair over a grid: add a row, delete the selected one. */
  const gridButtons = (
    aGrid: { grid: WX_GRID; table: WX_GRID_TABLE_BASE },
    aAddTitle: string,
    aDeleteTitle: string,
    aOnAdd: () => void,
    aEnabled = true,
    aCanDelete: (aRow: number) => boolean = () => true,
  ): GRID_BUTTONS => ({
    addTitle: aAddTitle,
    deleteTitle: aDeleteTitle,
    enabled: aEnabled,
    onAdd: aOnAdd,
    onDelete: () =>
      aGrid.grid.OnDeleteRows(() => {
        const rows = aGrid.grid.GetSelectedRows();
        const row = rows.length > 0 ? rows[0]! : aGrid.grid.GetGridCursorRow();
        if (row >= 0 && aCanDelete(row)) aGrid.table.DeleteRows(row, 1);
      }),
  });

  const listGrid = (
    aGrid: { grid: WX_GRID; tricks: GRID_TRICKS },
    aWidth: number,
    aLabel: string,
  ) => (
    <WxGridView
      grid={aGrid.grid}
      tricks={aGrid.tricks}
      colLabels={false}
      columns={[{ width: aWidth }]}
      ariaLabel={aLabel}
    />
  );

  return (
    <DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR_BASE
      page={pageIndex}
      // OnPageChanging: a pending grid edit that will not commit vetoes the change.
      onPageChanging={() => commitGrids()}
      onPageChanged={changePage}
      extraPages={
        model3d
          ? [
              {
                text: _('3D Models'),
                content: (
                  <PanelFpProperties3dModel
                    footprint={model3d.footprint}
                    host={model3d.host}
                    renderPreview={model3d.renderPreview}
                    pickModel={model3d.pickModel}
                    apiRef={modelsApi}
                  />
                ),
              },
            ]
          : []
      }
      m_itemsGrid={
        <WxGridView grid={fields.grid} tricks={fields.tricks} flexCol={1} ariaLabel={_('Fields')} />
      }
      fieldButtons={gridButtons(
        fields,
        _('Add field'),
        _('Delete field'),
        () =>
          fields.grid.OnAddRow(() => {
            fields.table.push_back(dialog.MakeNewField(fields.table.GetFields()));
            // notify the grid
            fields.grid.ProcessTableMessage(
              wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
              1,
              0,
            );
            return [fields.table.GetNumberRows() - 1, 0];
          }),
        true,
        (aRow) => {
          const refusal = dialog.CanDeleteField(aRow, fields.table.GetFields());
          if (refusal) DisplayErrorMessage(refusal);
          return refusal === null;
        },
      )}
      m_FootprintNameCtrl={{
        value: v.footprintName,
        onChange: (aText) => set({ footprintName: aText }),
      }}
      m_DocCtrl={{ value: v.description, onChange: (aText) => set({ description: aText }) }}
      m_KeywordCtrl={{ value: v.keywords, onChange: (aText) => set({ keywords: aText }) }}
      m_componentType={{
        value: v.componentType,
        onChange: (aIndex) =>
          set({ componentType: aIndex as FootprintFpEditorValues['componentType'] }),
      }}
      m_boardOnly={check('boardOnly')}
      m_excludeFromPosFiles={check('excludeFromPosFiles')}
      m_excludeFromBOM={check('excludeFromBOM')}
      m_cbDNP={check('dnp')}
      m_cbCustomLayers={check('customLayers')}
      m_copperLayerCount={{
        value: v.copperLayerCountSel,
        enabled: v.customLayers,
        onChange: (aIndex) => set({ copperLayerCountSel: aIndex }),
      }}
      m_customUserLayersGrid={listGrid(customLayers, 180, 'User layers')}
      customLayerButtons={gridButtons(
        customLayers,
        'Add user layer',
        'Delete user layer',
        () =>
          customLayers.grid.OnAddRow(() => {
            customLayers.table.m_layers.push(
              DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR.NextUserLayer(customLayers.table.m_layers),
            );
            customLayers.table.AppendRows(1);
            return [customLayers.table.GetNumberRows() - 1, 0];
          }),
        v.customLayers,
      )}
      m_privateLayersGrid={listGrid(privateLayers, 180, 'Private layers')}
      privateLayerButtons={gridButtons(
        privateLayers,
        'Add private layer',
        'Delete private layer',
        () =>
          privateLayers.grid.OnAddRow(() => {
            privateLayers.table.m_layers.push(
              DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR.NextUserLayer(privateLayers.table.m_layers),
            );
            privateLayers.table.AppendRows(1);
            return [privateLayers.table.GetNumberRows() - 1, 0];
          }),
      )}
      m_NetClearanceCtrl={binderEntry(binders.netClearance)}
      m_SolderMaskMarginCtrl={binderEntry(binders.solderMask)}
      m_allowBridges={check('allowSolderMaskBridges')}
      m_SolderPasteMarginCtrl={{
        value: binders.solderPaste.GetText(),
        units: userUnits,
        onChange: (aText) => {
          binders.solderPaste.onTextChanged(aText);
          bumpBinders((n) => n + 1);
        },
      }}
      m_noCourtyards={check('allowMissingCourtyard')}
      m_ZoneConnectionChoice={{
        value: v.zoneConnection,
        onChange: (aIndex) =>
          set({ zoneConnection: aIndex as FootprintFpEditorValues['zoneConnection'] }),
      }}
      m_nettieGroupsGrid={listGrid(netTies, 320, 'Net tie pad groups')}
      nettieButtons={gridButtons(netTies, 'Add net-tie group', 'Remove net-tie group', () =>
        netTies.grid.OnAddRow(() => {
          netTies.table.AppendRows(1);
          return [netTies.table.GetNumberRows() - 1, 0];
        }),
      )}
      m_cbDuplicatePadsAreJumpers={check('duplicatePadsAreJumpers')}
      m_jumperGroupsGrid={listGrid(jumpers, 320, 'Jumper pad groups')}
      jumperButtons={gridButtons(jumpers, 'Add jumper group', 'Remove jumper group', () =>
        jumpers.grid.OnAddRow(() => {
          jumpers.table.AppendRows(1);
          return [jumpers.table.GetNumberRows() - 1, 0];
        }),
      )}
      onOK={() => void onOk()}
      onCancel={() => onClose(false)}
    />
  );
}
