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

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { KiCadUriPrefix } from '@ziroeda/common/embedded_files.js';
import { ClampTextPenSize } from '@ziroeda/common/gr_text.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
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

/** `m_componentType`'s rows. [data] */
export const COMPONENT_TYPES = ['Through hole', 'SMD', 'Unspecified'] as const;

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

  GetFrame(): FOOTPRINT_EDIT_FRAME {
    return this.m_frame;
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

    if (aFootprintName === '') return { ok: false, message: 'Footprint must have a name.' };

    if (!FOOTPRINT.IsLibNameValid(aFootprintName))
      return {
        ok: false,
        message: `Footprint name may not contain '${FOOTPRINT.StringLibNameInvalidChars(true)}'.`,
      };

    const libraryName = fp.GetFPID().GetLibNickname();
    const originalFPName = fp.GetFPID().GetLibItemName();
    const adapter = this.m_frame.FootprintLibAdapter();

    if (
      aFootprintName !== originalFPName &&
      adapter?.FootprintExists(libraryName, aFootprintName)
    ) {
      const msg = `Footprint '${aFootprintName}' already exists in library '${libraryName}'.`;

      const answer = await this.m_frame.AskKiDialog({
        caption: 'Confirmation',
        message: msg,
        icon: 'warning',
        labels: { ok: 'Overwrite' },
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
        return { ok: false, message: 'Fields must have a name.', page: 'general', fieldRow: i };

      const minSize = pcbIUScale.mmToIU(TEXT_MIN_SIZE_MM);
      const maxSize = pcbIUScale.mmToIU(TEXT_MAX_SIZE_MM);
      const range = `${this.m_frame.GetUnitsProvider().StringFromValue(minSize, true)} and ${this.m_frame.GetUnitsProvider().StringFromValue(maxSize, true)}`;

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
          message: 'The text thickness is too large for the text size.\nIt will be clamped.',
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
          message:
            `You are trying to remove layers that are used by the footprint: ${LAYER_UTILS.AccumulateNamesFromSet(orphanLayers, this.m_frame.GetBoard())}.\n` +
            'Please remove the objects that use these layers first.',
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

    commit.Push('Edit Footprint Properties');

    return { ok: true };
  }
}
