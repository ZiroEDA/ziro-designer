// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FOOTPRINT_PROPERTIES` (pcbnew/dialogs/dialog_footprint_properties.cpp), board side.
 *
 * The class is the dialog's logic on a live FOOTPRINT - TransferDataToWindow, Validate,
 * TransferDataFromWindow, the field add/delete rules and the return value - testable without a
 * window. `DialogFootprintProperties` below is the window: the binders, the fields grid and the
 * handlers over DIALOG_FOOTPRINT_PROPERTIES_BASE.
 *
 * Not here yet: the Embedded Files page (PANEL_EMBEDDED_FILES on the footprint's files), and the
 * Edit Footprint / Edit Library Footprint return values have no footprint editor to load into
 * from the board (`FOOTPRINT_EDIT_FRAME::LoadFootprintFromBoard` is unported).
 */
import { type JSX, type ReactNode, useReducer, useRef, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { pcbIUScale, unitLabel } from '@ziroeda/common/eda_units.js';
import { KiCadUriPrefix } from '@ziroeda/common/embedded_files.js';
import { ClampTextPenSize } from '@ziroeda/common/gr_text.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { FIELD_T, GetUserFieldName } from '@ziroeda/common/template_fieldnames.js';
import { MARGIN_OFFSET_BINDER } from '@ziroeda/common/widgets/margin_offset_binder.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridSelectionModes, wxGridTableRequest } from '@ziroeda/wx/grid.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD_COMMIT } from '../board_commit.js';
import {
  type FOOTPRINT,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
  type FP_3DMODEL,
} from '../footprint.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_FIELD } from '../pcb_field.js';
import { PCB_FIELDS_COL_ORDER, PCB_FIELDS_GRID_TABLE } from '../pcb_fields_grid_table.js';
import { PCB_SELECTION_TOOL } from '../tools/pcb_selection_tool.js';
import { ZONE_CONNECTION } from '../zones.js';
import {
  DIALOG_FOOTPRINT_PROPERTIES_BASE,
  ORIENTATION_CHOICES,
} from './dialog_footprint_properties_base.js';
import type { ZoneConnection } from './dialog_pad_properties.js';
import type { PANEL_3D_MODEL_HOST, SELECTED_3D_MODEL } from './panel_fp_properties_3d_model.js';
import {
  type PANEL_3D_MODEL_API,
  PanelFpProperties3dModel,
} from './panel_fp_properties_3d_model.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `FP_PROPS_RETVALUE`: the option that closed the dialog. */
export enum FP_PROPS_RETVALUE {
  FP_PROPS_CANCEL,
  FP_PROPS_UPDATE_FP,
  FP_PROPS_CHANGE_FP,
  FP_PROPS_OK,
  FP_PROPS_EDIT_BOARD_FP,
  FP_PROPS_EDIT_LIBRARY_FP,
}

/** The window: every control's value, as TransferDataToWindow leaves it. */
export interface FootprintValues {
  /** `m_fields`: copies of the footprint's fields, a variant's value in place, KIIDs as refs. */
  fields: PCB_FIELD[];
  /** Board-absolute anchor, IU. */
  x: number;
  y: number;
  /** Degrees, -180..180. */
  orientation: number;
  /** `m_BoardSideCtrl`; changing it is FOOTPRINT::Flip. */
  side: 'front' | 'back';
  locked: boolean;
  /** `m_componentType`: Through hole, SMD, Unspecified. */
  footprintType: 'through_hole' | 'smd' | 'unspecified';
  notInSchematic: boolean;
  doNotPopulate: boolean;
  excludeFromBom: boolean;
  excludeFromPosFiles: boolean;
  allowSolderMaskBridges: boolean;
  /** Clearance overrides; null is a blank box, "use the Board Setup value". */
  localClearance: number | null;
  localSolderMaskMargin: number | null;
  /** `m_solderPaste`'s two halves; undefined is no value of that kind. */
  localSolderPasteMargin: number | undefined;
  localSolderPasteMarginRatio: number | undefined;
  zoneConnection: ZoneConnection;
  /** `m_jumperGroupsText`: '' is "none". */
  jumperGroups: string;
  /**
   * `m_3dPanel->GetModelList()`, which OK copies onto the footprint (:729-733). Absent when the
   * page was not shown, and then the footprint's models are left alone.
   */
  models?: FP_3DMODEL[];
}

/** Validate's refusal: the message, and the grid cell `m_delayedFocus*` points at. */
export interface FootprintValidateResult {
  ok: boolean;
  message?: string;
  row?: number;
  col?: number;
}

/** `m_ZoneConnectionChoice`'s four entries, in order (:296-303, :640-647). */
const ZONE_CHOICE: readonly [ZoneConnection, ZONE_CONNECTION][] = [
  ['inherited', ZONE_CONNECTION.INHERITED],
  ['full', ZONE_CONNECTION.FULL],
  ['thermal', ZONE_CONNECTION.THERMAL],
  ['none', ZONE_CONNECTION.NONE],
];

/** `m_componentType`'s rows. */
const FOOTPRINT_TYPES: readonly FootprintValues['footprintType'][] = [
  'through_hole',
  'smd',
  'unspecified',
];

export class DIALOG_FOOTPRINT_PROPERTIES {
  /** remember the last open page during session */
  static m_page = 0;

  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_footprint: FOOTPRINT;
  /** the option that closed the dialog */
  private m_returnValue = FP_PROPS_RETVALUE.FP_PROPS_CANCEL;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aFootprint: FOOTPRINT) {
    this.m_frame = aFrame;
    this.m_footprint = aFootprint;
  }

  GetFootprint(): FOOTPRINT {
    return this.m_footprint;
  }

  GetFrame(): PCB_BASE_EDIT_FRAME {
    return this.m_frame;
  }

  GetReturnValue(): FP_PROPS_RETVALUE {
    return this.m_returnValue;
  }

  /** `TransferDataToWindow()` (:242-410). */
  TransferDataToWindow(): FootprintValues {
    const fp = this.m_footprint;
    const board = fp.GetBoard();
    const variantName = board?.GetCurrentVariant() ?? '';
    const attrs = fp.GetAttributes();
    const zc = ZONE_CHOICE.find(([, z]) => z === fp.GetLocalZoneConnection());

    // Footprint Fields
    const fields: PCB_FIELD[] = [];

    for (const srcField of fp.GetFields()) {
      if (!srcField) continue;

      const field = PCB_FIELD.copyOfField(srcField);
      const text = fp.GetFieldValueForVariant(variantName, field.GetName());
      field.SetText(board ? board.ConvertKIIDsToCrossReferences(text) : text);
      fields.push(field);
    }

    let jumperGroups = '';

    if (fp.GetDuplicatePadNumbersAreJumpers()) jumperGroups = _('all pads with duplicate numbers');

    for (const group of fp.JumperPadGroups()) {
      let groupTxt = '';

      for (const pinNumber of group) {
        if (groupTxt !== '') groupTxt += ', ';

        groupTxt += pinNumber;
      }

      if (jumperGroups !== '') jumperGroups += ';  ';

      jumperGroups += `(${groupTxt})`;
    }

    return {
      fields,
      x: fp.GetPosition().x,
      y: fp.GetPosition().y,
      orientation: new EDA_ANGLE(fp.GetOrientation().AsDegrees()).Normalize180().AsDegrees(),
      side: fp.GetLayer() === PCB_LAYER_ID.B_Cu ? 'back' : 'front',
      locked: fp.IsLocked(),
      footprintType:
        attrs & FP_THROUGH_HOLE ? 'through_hole' : attrs & FP_SMD ? 'smd' : 'unspecified',
      notInSchematic: (attrs & FP_BOARD_ONLY) !== 0,
      doNotPopulate: fp.GetDNPForVariant(variantName),
      excludeFromBom: fp.GetExcludedFromBOMForVariant(variantName),
      excludeFromPosFiles: fp.GetExcludedFromPosFilesForVariant(variantName),
      allowSolderMaskBridges: fp.AllowSolderMaskBridges(),
      localClearance: fp.GetLocalClearance() ?? null,
      localSolderMaskMargin: fp.GetLocalSolderMaskMargin() ?? null,
      localSolderPasteMargin: fp.GetLocalSolderPasteMargin(),
      localSolderPasteMarginRatio: fp.GetLocalSolderPasteMarginRatio(),
      zoneConnection: zc ? zc[0] : 'inherited',
      jumperGroups,
    };
  }

  /**
   * `OnAddField`'s new row (:779-791): a hidden user field on the side's Fab layer, at the
   * footprint's origin, in the board's text style.
   */
  MakeNewField(aFields: readonly PCB_FIELD[]): PCB_FIELD {
    const fp = this.m_footprint;
    const newField = new PCB_FIELD(fp, FIELD_T.USER, GetUserFieldName(aFields.length, true));

    newField.SetVisible(false);
    newField.SetLayer(
      fp.GetLayer() === PCB_LAYER_ID.F_Cu ? PCB_LAYER_ID.F_Fab : PCB_LAYER_ID.B_Fab,
    );
    newField.SetFPRelativePosition({ x: 0, y: 0 });
    newField.StyleFromSettings(this.m_frame.GetDesignSettings(), true);

    return newField;
  }

  /** `OnDeleteField`'s guard (:802-809): the mandatory rows stay. */
  CanDeleteField(aRow: number, aFields: readonly PCB_FIELD[]): string | null {
    const mandatory = aFields.filter((f) => f.IsMandatory()).length;

    if (aRow < mandatory) return `The first ${mandatory} fields are mandatory.`;

    return null;
  }

  /**
   * `Validate()` (:413-503). A size out of range is written back into the grid at the limit,
   * as `SetCellValue` does through the table, and refused with the cell to focus.
   */
  Validate(v: FootprintValues): FootprintValidateResult {
    const units = this.m_frame.GetUnitsProvider();

    // Validate texts.
    for (let i = 0; i < v.fields.length; ++i) {
      const field = v.fields[i]!;

      // Check for missing field names.
      if (field.GetName(false) === '')
        return {
          ok: false,
          message: _('Fields must have a name.'),
          row: i,
          col: PCB_FIELDS_COL_ORDER.PFC_NAME,
        };

      const minSize = pcbIUScale.mmToIU(TEXT_MIN_SIZE_MM);
      const maxSize = pcbIUScale.mmToIU(TEXT_MAX_SIZE_MM);
      const width = field.GetTextWidth();
      const height = field.GetTextHeight();

      if (width < minSize) {
        const min = units.StringFromValue(minSize, true);
        field.SetTextWidth(minSize);
        return {
          ok: false,
          message: `Text width must be at least ${min}.`,
          row: i,
          col: PCB_FIELDS_COL_ORDER.PFC_WIDTH,
        };
      } else if (width > maxSize) {
        const max = units.StringFromValue(maxSize, true);
        field.SetTextWidth(maxSize);
        return {
          ok: false,
          message: `Text width must be at most ${max}.`,
          row: i,
          col: PCB_FIELDS_COL_ORDER.PFC_WIDTH,
        };
      }

      if (height < minSize) {
        const min = units.StringFromValue(minSize, true);
        field.SetTextHeight(minSize);
        return {
          ok: false,
          message: `Text height must be at least ${min}.`,
          row: i,
          col: PCB_FIELDS_COL_ORDER.PFC_HEIGHT,
        };
      } else if (height > maxSize) {
        const max = units.StringFromValue(maxSize, true);
        field.SetTextHeight(maxSize);
        return {
          ok: false,
          message: `Text height must be at most ${max}.`,
          row: i,
          col: PCB_FIELDS_COL_ORDER.PFC_HEIGHT,
        };
      }

      // Test for acceptable values for thickness and size and clamp if fails
      const maxPenWidth = ClampTextPenSize(field.GetTextThickness(), field.GetTextSize());

      if (field.GetTextThickness() > maxPenWidth) {
        const clamped = units.StringFromValue(maxPenWidth, true);
        field.SetTextThickness(maxPenWidth);
        return {
          ok: false,
          message: `Text thickness is too large for the text size.\nIt will be clamped at ${clamped}.`,
          row: i,
          col: PCB_FIELDS_COL_ORDER.PFC_THICKNESS,
        };
      }
    }

    // m_netClearance.Validate( 0, INT_MAX )
    if (v.localClearance !== null && v.localClearance < 0)
      return {
        ok: false,
        message: `Pad clearance must be at least ${units.StringFromValue(0, true)}.`,
      };

    return { ok: true };
  }

  /**
   * `TransferDataFromWindow()` (:506-736): one BOARD_COMMIT, "Edit Footprint Properties". The
   * fields are replaced whole, a variant's value going onto the variant; then the overrides,
   * position, lock, attributes, a Rotate to the new orientation, a Flip when the side changed,
   * and the 3D models.
   */
  TransferDataFromWindow(
    v: FootprintValues,
    aReturnValue = FP_PROPS_RETVALUE.FP_PROPS_OK,
  ): FootprintValidateResult {
    const valid = this.Validate(v);

    if (!valid.ok) return valid;

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

    for (const file of filesToDelete) fp.RemoveFile(file.slice(KiCadUriPrefix.length + 3)); // Skip "kicad-embed://"

    // Update fields
    const board = fp.GetBoard();
    const variantName = board?.GetCurrentVariant() ?? '';

    // Save base field values before deletion so we can detect variant changes
    const baseFieldValues = new Map<string, string>();

    for (const existing of fp.GetFields())
      baseFieldValues.set(existing.GetName(), existing.GetText());

    for (const existing of [...fp.GetFields()]) {
      board?.UncacheItemById(existing.m_Uuid);

      existing.GetParentGroup()?.RemoveItem(existing);

      view?.Remove(existing);
      fp.Remove(existing);
    }

    let ordinal = 42; // Arbitrarily larger than any mandatory FIELD_T ids.

    for (const field of v.fields) {
      const newField = field.CloneField();
      const newText = commit.GetBoard()!.ConvertCrossReferencesToKIIDs(field.GetText());

      if (variantName !== '') {
        const baseText = baseFieldValues.get(field.GetName()) ?? '';
        const variant = fp.GetVariant(variantName) ?? fp.AddVariant(variantName);

        if (variant) variant.SetFieldValue(field.GetName(), newText);

        newField.SetText(baseText);
      } else {
        newField.SetText(newText);
      }

      if (!field.IsMandatory()) newField.SetOrdinal(ordinal++);

      fp.Add(newField);
      view?.Add(newField);

      newField.GetParentGroup()?.AddItem(newField);

      if (newField.IsSelected()) {
        // The old copy was in the selection list, but this one is not.  Remove the
        // out-of-sync selection flag so we can re-add the field to the selection.
        newField.ClearSelected();
        selectionTool?.AddItemToSel(newField, true);
      }
    }

    // Initialize masks clearances
    fp.SetLocalClearance(v.localClearance ?? undefined);
    fp.SetLocalSolderMaskMargin(v.localSolderMaskMargin ?? undefined);
    fp.SetLocalSolderPasteMargin(v.localSolderPasteMargin);
    fp.SetLocalSolderPasteMarginRatio(v.localSolderPasteMarginRatio);

    const zc = ZONE_CHOICE.find(([name]) => name === v.zoneConnection);
    fp.SetLocalZoneConnection(zc ? zc[1] : ZONE_CONNECTION.INHERITED);

    // Set Footprint Position
    fp.SetPosition({ x: v.x, y: v.y });
    fp.SetLocked(v.locked);

    let attributes = 0;

    if (v.footprintType === 'through_hole') attributes |= FP_THROUGH_HOLE;
    else if (v.footprintType === 'smd') attributes |= FP_SMD;

    if (v.notInSchematic) attributes |= FP_BOARD_ONLY;

    if (variantName !== '') {
      const variant = fp.GetVariant(variantName) ?? fp.AddVariant(variantName);

      if (variant) {
        variant.SetExcludedFromPosFiles(v.excludeFromPosFiles);
        variant.SetExcludedFromBOM(v.excludeFromBom);
        variant.SetDNP(v.doNotPopulate);
      }

      // Preserve base attribute flags for these three properties
      attributes |= fp.GetAttributes() & (FP_EXCLUDE_FROM_POS_FILES | FP_EXCLUDE_FROM_BOM | FP_DNP);
    } else {
      if (v.excludeFromPosFiles) attributes |= FP_EXCLUDE_FROM_POS_FILES;
      if (v.excludeFromBom) attributes |= FP_EXCLUDE_FROM_BOM;
      if (v.doNotPopulate) attributes |= FP_DNP;
    }

    fp.SetAttributes(attributes);

    fp.SetAllowSolderMaskBridges(v.allowSolderMaskBridges);

    const orient = new EDA_ANGLE(v.orientation).Normalize();

    if (!fp.GetOrientation().equals(orient))
      fp.Rotate(fp.GetPosition(), orient.sub(fp.GetOrientation()));

    // Set component side, that also have effect on the fields positions on board
    const change_layer =
      v.side === 'front'
        ? fp.GetLayer() === PCB_LAYER_ID.B_Cu
        : fp.GetLayer() === PCB_LAYER_ID.F_Cu;

    if (change_layer) fp.Flip(fp.GetPosition(), this.m_frame.GetPcbNewSettings().m_FlipDirection);

    // Copy the models from the panel to the footprint
    if (v.models) {
      const fpList = fp.Models();
      fpList.length = 0;
      fpList.push(...v.models.map((m) => m.clone()));
    }

    // This is a simple edit, we must create an undo entry
    if (fp.GetEditFlags() === 0) commit.Push(_('Edit Footprint Properties'));

    this.m_returnValue = aReturnValue;
    return { ok: true };
  }
}

// ---- The window: DIALOG_FOOTPRINT_PROPERTIES over DIALOG_FOOTPRINT_PROPERTIES_BASE ----

export interface DialogFootprintPropertiesProps {
  dlg: DIALOG_FOOTPRINT_PROPERTIES;
  /** `ShowQuasiModal()` returned: `GetReturnValue()` is what closed it. */
  onClose: () => void;
  /**
   * The 3D Models page (PANEL_FP_PROPERTIES_3D_MODEL, the constructor's first AddPage): what it
   * asks of the frame and the two `3d-viewer/` widgets it hosts. Absent, the page is not drawn.
   */
  model3d?: {
    host: PANEL_3D_MODEL_HOST;
    renderPreview: (
      aModels: readonly FP_3DMODEL[],
      aSelected: number,
      aVersion: number,
    ) => ReactNode;
    pickModel: () => Promise<SELECTED_3D_MODEL | null>;
  };
}

export function DialogFootprintProperties({
  dlg,
  onClose,
  model3d,
}: DialogFootprintPropertiesProps): JSX.Element {
  const frame = dlg.GetFrame();
  const fp = dlg.GetFootprint();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const modelsApi = useRef<PANEL_3D_MODEL_API | null>(null);

  // The constructor and TransferDataToWindow, once.
  const [init] = useState(() => {
    const w = dlg.TransferDataToWindow();
    const posX = new UNIT_BINDER(frame, 'X:');
    const posY = new UNIT_BINDER(frame, 'Y:');
    const orientation = new UNIT_BINDER(frame, _('Orientation:'));
    const netClearance = new UNIT_BINDER(frame, _('Pad clearance:'));
    const solderMask = new UNIT_BINDER(frame, _('Solder mask expansion:'));
    const solderPaste = new MARGIN_OFFSET_BINDER(frame.GetIuScale(), frame.GetUserUnits());

    // Configure display origin transforms
    posX.SetCoordType(COORD_TYPES_T.ABS_X_COORD);
    posY.SetCoordType(COORD_TYPES_T.ABS_Y_COORD);
    orientation.SetUnits('degrees');

    posX.SetValue(w.x);
    posY.SetValue(w.y);
    orientation.SetAngleValue(new EDA_ANGLE(w.orientation));

    if (w.localClearance !== null) netClearance.SetValue(w.localClearance);

    if (w.localSolderMaskMargin !== null) solderMask.SetValue(w.localSolderMaskMargin);

    solderPaste.SetOffsetValue(w.localSolderPasteMargin);
    solderPaste.SetRatioValue(w.localSolderPasteMarginRatio);

    const table = new PCB_FIELDS_GRID_TABLE(frame.GetUnitsProvider(), w.fields, frame);
    const grid = new WX_GRID();
    grid.SetTable(table, true, wxGridSelectionModes.wxGridSelectRows);
    const tricks = new GRID_TRICKS(grid);
    grid.ShowHideColumns('0 1 2 3 4 5 7');

    return {
      w,
      posX,
      posY,
      orientation,
      netClearance,
      solderMask,
      solderPaste,
      table,
      grid,
      tricks,
    };
  });
  const { posX, posY, orientation, netClearance, solderMask, solderPaste, table, grid, tricks } =
    init;

  const [w, setW] = useState<FootprintValues>(init.w);
  const set = (aPatch: Partial<FootprintValues>): void => setW((p) => ({ ...p, ...aPatch }));
  const [page, setPage] = useState(DIALOG_FOOTPRINT_PROPERTIES.m_page);

  const changePage = (aPage: number): void => {
    DIALOG_FOOTPRINT_PROPERTIES.m_page = aPage;
    setPage(aPage);
  };

  const userUnits = unitLabel(frame.GetUserUnits());

  const entry = (aBinder: UNIT_BINDER) => ({
    value: aBinder.GetText(),
    units: userUnits,
    onChange: (aText: string) => {
      aBinder.SetText(aText);
      bump();
    },
  });

  /** The window read back, for Validate and TransferDataFromWindow. */
  const collect = (): FootprintValues => ({
    ...w,
    fields: [...table.GetFields()],
    x: posX.GetValue(),
    y: posY.GetValue(),
    orientation: orientation.GetAngleValue().AsDegrees(),
    // `m_netClearance.IsNull()`: a blank box.
    localClearance: netClearance.GetText().trim() === '' ? null : netClearance.GetValue(),
    localSolderMaskMargin: solderMask.GetText().trim() === '' ? null : solderMask.GetValue(),
    localSolderPasteMargin: solderPaste.GetOffsetValue(),
    localSolderPasteMarginRatio: solderPaste.GetRatioValue(),
    models: modelsApi.current ? modelsApi.current.GetModelList() : undefined,
  });

  /** TransferDataFromWindow, then Close() with `aReturnValue`; a refusal shows its cell. */
  const close = (aReturnValue: FP_PROPS_RETVALUE): void => {
    if (!grid.CommitPendingChanges()) return;
    if (modelsApi.current && !modelsApi.current.CommitPendingChanges()) return;

    const r = dlg.TransferDataFromWindow(collect(), aReturnValue);

    if (!r.ok) {
      // OnUpdateUI's delayed focus: the General page, the grid cell, then the message.
      if (r.row !== undefined) {
        changePage(0);
        // MakeCellVisible + SetGridCursor.
        grid.GoToCell(r.row, r.col ?? 0);
        bump();
      }

      if (r.message) DisplayErrorMessage(r.message);
      return;
    }

    onClose();
  };

  return (
    <DIALOG_FOOTPRINT_PROPERTIES_BASE
      page={page}
      // OnPageChanging: a pending grid edit that will not commit vetoes the change.
      onPageChanging={() => grid.CommitPendingChanges()}
      onPageChanged={changePage}
      extraPages={
        model3d
          ? [
              {
                text: _('3D Models'),
                content: (
                  <PanelFpProperties3dModel
                    footprint={fp}
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
      m_itemsGrid={grid}
      itemsGridTricks={tricks}
      onAddField={() =>
        grid.OnAddRow(() => {
          table.push_back(dlg.MakeNewField(table.GetFields()));
          // notify the grid
          grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1, 0);
          bump();
          return [table.GetNumberRows() - 1, PCB_FIELDS_COL_ORDER.PFC_NAME];
        })
      }
      onDeleteField={() =>
        grid.OnDeleteRows(
          (aRow) => {
            const refusal = dlg.CanDeleteField(aRow, table.GetFields());
            if (refusal) DisplayErrorMessage(refusal);
            return refusal === null;
          },
          (aRow) => {
            table.erase(aRow);
            // notify the grid
            grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aRow, 1);
            bump();
          },
        )
      }
      m_posX={entry(posX)}
      m_posY={entry(posY)}
      m_orientation={{
        value: orientation.GetText(),
        onChange: (aText) => {
          orientation.SetText(aText);
          bump();
        },
      }}
      // "Set predefined rotations in combo dropdown": wxString::Format( "%.1f", rot ).
      orientationChoices={ORIENTATION_CHOICES.map((r) => Number(r).toFixed(1))}
      m_BoardSideCtrl={{
        value: w.side === 'back' ? 1 : 0,
        onChange: (aRow) => set({ side: aRow === 1 ? 'back' : 'front' }),
      }}
      m_cbLocked={{ value: w.locked, onChange: (v) => set({ locked: v }) }}
      m_componentType={{
        value: FOOTPRINT_TYPES.indexOf(w.footprintType),
        onChange: (aRow) => set({ footprintType: FOOTPRINT_TYPES[aRow] ?? 'unspecified' }),
      }}
      m_boardOnly={{ value: w.notInSchematic, onChange: (v) => set({ notInSchematic: v }) }}
      m_excludeFromPosFiles={{
        value: w.excludeFromPosFiles,
        onChange: (v) => set({ excludeFromPosFiles: v }),
      }}
      m_excludeFromBOM={{ value: w.excludeFromBom, onChange: (v) => set({ excludeFromBom: v }) }}
      m_cbDNP={{ value: w.doNotPopulate, onChange: (v) => set({ doNotPopulate: v }) }}
      updateFootprint={() => close(FP_PROPS_RETVALUE.FP_PROPS_UPDATE_FP)}
      changeFootprint={() => close(FP_PROPS_RETVALUE.FP_PROPS_CHANGE_FP)}
      editFootprint={() => close(FP_PROPS_RETVALUE.FP_PROPS_EDIT_BOARD_FP)}
      editLibraryFootprint={() => close(FP_PROPS_RETVALUE.FP_PROPS_EDIT_LIBRARY_FP)}
      m_netClearance={entry(netClearance)}
      m_solderMask={entry(solderMask)}
      m_allowSolderMaskBridges={{
        value: w.allowSolderMaskBridges,
        onChange: (v) => set({ allowSolderMaskBridges: v }),
      }}
      m_solderPaste={{
        value: solderPaste.GetText(),
        units: userUnits,
        onChange: (aText) => {
          solderPaste.onTextChanged(aText);
          bump();
        },
      }}
      infoPaste=""
      m_ZoneConnectionChoice={{
        value: ZONE_CHOICE.findIndex(([name]) => name === w.zoneConnection),
        onChange: (aRow) => set({ zoneConnection: ZONE_CHOICE[aRow]?.[0] ?? 'inherited' }),
      }}
      jumperGroups={w.jumperGroups === '' ? _('none') : w.jumperGroups}
      jumperGroupsItalic={w.jumperGroups === ''}
      libraryId={fp.GetFPID().Format()}
      onOK={() => close(FP_PROPS_RETVALUE.FP_PROPS_OK)}
      onCancel={onClose}
    />
  );
}
