// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_PROPERTIES_3D_MODEL` (`pcbnew/dialogs/panel_fp_properties_3d_model.cpp`),
 * the 3D Models page of Footprint Properties: a grid of the footprint's
 * `FP_3DMODEL`s (a status icon, the file name, a Show check box), the Add /
 * Browse / Remove buttons, and `PANEL_PREVIEW_3D_MODEL` under it.
 *
 * This file is the panel's state and every decision in it; `_ui.tsx` is the
 * controls. What it asks of its surroundings is {@link PANEL_3D_MODEL_HOST}: the
 * frame's project (`FILENAME_RESOLVER`, the footprint library's base path), the
 * embedded-files pages, `DIALOG_SHIM::OnModify`, and `wxFileName::IsFileReadable`.
 *
 * `Configure Paths...` (`Cfg3DPath`, DIALOG_CONFIGURE_PATHS) is not here: it
 * edits environment variables that name directories on a disk, which a browser
 * does not have (the same decision `common/STRUCTURE.md` records for the dialog).
 */
import { useCallback, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxALIGN_CENTER,
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_CHANGING,
  wxEVT_GRID_SELECT_CELL,
  wxGridCellAttr,
  wxGridCellBoolRenderer,
  type wxGridEvent,
  wxGridSelectionModes,
  wxGridStringTable,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';

import { GridCellStatusIcon } from '@ziroeda/common/widgets/grid_icon_text_helpers.js';
import { PANEL_FP_PROPERTIES_3D_MODEL_BASE } from './panel_fp_properties_3d_model_base.js';
import type { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { wxFileExists } from '@ziroeda/wx/filefn.js';
import { FP_3DMODEL, type FOOTPRINT } from '../footprint.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `enum class MODEL_VALIDATE_ERRORS` (panel_fp_properties_3d_model.h). */
export enum MODEL_VALIDATE_ERRORS {
  MODEL_NO_ERROR,
  RESOLVE_FAIL,
  OPEN_FAIL,
  NO_FILENAME,
  ILLEGAL_FILENAME,
}

/** The grid's columns (`enum MODELS_TABLE_COLUMNS`). */
export enum MODELS_TABLE_COLUMNS {
  COL_PROBLEM = 0,
  COL_FILENAME = 1,
  COL_SHOWN = 2,
}

/** `GRID_CELL_STATUS_ICON_RENDERER`'s argument: 0 none, else the `wxICON_*` it draws. */
export type STATUS_ICON = 0 | 'warning' | 'error';

/** One grid row. */
export interface MODEL_ROW {
  /** The cell's value: the tooltip text, empty when nothing is wrong. */
  problem: string;
  icon: STATUS_ICON;
  /** The file-name cell. */
  filename: string;
  /** The Show cell, "1" or "0" as the grid stores it. */
  shown: '1' | '0';
}

/** What the panel asks of the program and the frame. */
export interface PANEL_3D_MODEL_HOST {
  /** `PROJECT_PCB::Get3DFilenameResolver( &m_frame->Prj() )`, or null with none. */
  resolver(): FILENAME_RESOLVER | null;
  /** `LIBRARY_MANAGER::GetFullURI( *row, true )` of the footprint's library, else empty. */
  footprintBasePath(aLibNickname: string): string;
  /** `{ m_filesPanel->GetLocalFiles(), m_frame->GetBoard()->GetEmbeddedFiles() }`. */
  embeddedFilesStack(): readonly EMBEDDED_FILES[];
  /** `m_filesPanel->AddEmbeddedFile( aFile )`'s link, or null when it failed. */
  addEmbeddedFile(aFullPath: string): string | null;
  /** `m_filesPanel->RemoveEmbeddedFile( aName )`; a name that is not embedded is ignored. */
  removeEmbeddedFile(aName: string): void;
  /** `wxFileName::IsFileReadable`. */
  isFileReadable?(aFullPath: string): boolean;
  /** `dlg->OnModify()`. */
  onModify(): void;
}

/** What `DIALOG_SELECT_3DMODEL` hands back: the chosen file and whether to embed it. */
export interface SELECTED_3D_MODEL {
  filename: string;
  /** `dm.IsEmbedded3DModel()`. */
  embedded: boolean;
}

export class PANEL_FP_PROPERTIES_3D_MODEL {
  m_shapes3D_list: FP_3DMODEL[] = [];
  m_rows: MODEL_ROW[] = [];
  /** The grid cursor's row, -1 with none. */
  m_selected = -1;
  m_inSelect = false;

  constructor(
    private readonly m_footprint: FOOTPRINT,
    private readonly m_host: PANEL_3D_MODEL_HOST,
  ) {}

  /** `TransferDataToWindow`. */
  TransferDataToWindow(): boolean {
    this.ReloadModelsFromFootprint();
    return true;
  }

  GetModelList(): FP_3DMODEL[] {
    return this.m_shapes3D_list;
  }

  /** `SplitAlias`'s display form, `alias:relative/path`. */
  private display(aFilename: string): string {
    const split = this.m_host.resolver()?.SplitAlias(aFilename) ?? null;

    return split ? `${split.alias}:${split.relpath}` : aFilename;
  }

  ReloadModelsFromFootprint(): void {
    this.m_shapes3D_list = [];
    this.m_rows = [];

    for (const model of this.m_footprint.Models()) {
      this.m_shapes3D_list.push(model.clone());
      this.m_rows.push({
        problem: '',
        icon: 0,
        filename: this.display(model.m_Filename),
        shown: model.m_Show ? '1' : '0',
      });

      // Must be after the filename is set
      this.updateValidateStatus(this.m_rows.length - 1);
    }

    this.select3DModel(0);
  }

  /** `select3DModel`: clamps the index, selects the row and puts the cursor on its file name. */
  select3DModel(aModelIdx: number): number {
    this.m_inSelect = true;

    aModelIdx = Math.max(0, aModelIdx);
    aModelIdx = Math.min(aModelIdx, this.m_rows.length - 1);

    this.m_selected = this.m_rows.length > 0 ? aModelIdx : -1;
    this.m_inSelect = false;

    // `m_previewPane->SetSelectedModel( aModelIdx )`
    return Math.max(0, aModelIdx);
  }

  /** `On3DModelSelected`. */
  On3DModelSelected(aRow: number): void {
    if (!this.m_inSelect) this.select3DModel(aRow);
  }

  /** `cleanupFilename`: no control characters, and a `:` in front of an alias. */
  cleanupFilename(aFilename: string): string {
    if (aFilename === '') return aFilename;

    aFilename = aFilename.replace(/\n/g, '').replace(/\r/g, '').replace(/\t/g, '');

    const hasAlias = { value: false };
    this.m_host.resolver()?.ValidateFileName(aFilename, hasAlias);

    // If the user has specified an alias in the name then prepend ':'
    if (hasAlias.value) aFilename = `:${aFilename}`;

    return aFilename;
  }

  /** `on3DModelCellChanging`: the status follows what is being typed. */
  on3DModelCellChanging(aRow: number, aCol: number, aTyped: string): void {
    if (aCol === MODELS_TABLE_COLUMNS.COL_FILENAME) this.updateValidateStatus(aRow, aTyped);
  }

  /** `On3DModelCellChanged`. `aValue` is the cell's new text. */
  On3DModelCellChanged(aRow: number, aCol: number, aValue: string): void {
    const row = this.m_rows[aRow];
    const shape = this.m_shapes3D_list[aRow];

    if (!row || !shape) return;

    if (aCol === MODELS_TABLE_COLUMNS.COL_FILENAME) {
      let filename = aValue;

      if (filename !== '') {
        filename = this.cleanupFilename(filename);

        // Update the grid with the modified filename
        row.filename = filename;
      } else {
        row.filename = '';
      }

      // Save the filename in the 3D shapes table
      shape.m_Filename = filename;

      // Update the validation status
      this.updateValidateStatus(aRow);
    } else if (aCol === MODELS_TABLE_COLUMNS.COL_SHOWN) {
      row.shown = aValue === '1' ? '1' : '0';
      shape.m_Show = aValue === '1';
    }

    this.m_host.onModify();
  }

  /** `OnAdd3DRow`: a new row with no file name and Show set. Returns the cell to edit. */
  OnAdd3DRow(): [number, number] {
    const model = new FP_3DMODEL();
    model.m_Show = true;
    this.m_shapes3D_list.push(model);

    const row = this.m_rows.length;
    this.m_rows.push({ problem: '', icon: 0, filename: '', shown: '1' });

    this.select3DModel(row);
    this.updateValidateStatus(row);
    this.m_host.onModify();

    return [row, MODELS_TABLE_COLUMNS.COL_FILENAME];
  }

  /**
   * The end of `OnAdd3DModel`, once `DIALOG_SELECT_3DMODEL` has answered: embed the
   * file when it asked to, then append the row. Returns false (and says why in
   * `error`) when embedding failed; "Error adding 3D model" upstream.
   */
  OnAdd3DModel(
    aChosen: SELECTED_3D_MODEL | null,
    aSelected: number,
  ): { ok: boolean; error?: string } {
    if (!aChosen || aChosen.filename === '') {
      if (aSelected >= 0) {
        this.select3DModel(aSelected);
        this.updateValidateStatus(aSelected);
      }

      return { ok: true };
    }

    const model = new FP_3DMODEL();
    model.m_Filename = aChosen.filename;

    if (aChosen.embedded) {
      const libraryName = this.m_footprint.GetFPID().GetLibNickname();
      const footprintBasePath = this.m_host.footprintBasePath(libraryName);
      const fullPath =
        this.m_host
          .resolver()
          ?.ResolvePath(model.m_Filename, footprintBasePath, this.m_host.embeddedFilesStack()) ??
        '';
      const link = this.m_host.addEmbeddedFile(fullPath);

      if (link === null) return { ok: false, error: _('Error adding 3D model') };

      model.m_Filename = link;
    }

    const filename = this.display(model.m_Filename);

    model.m_Show = true;
    this.m_shapes3D_list.push(model);

    const idx = this.m_rows.length;
    this.m_rows.push({ problem: '', icon: 0, filename, shown: '1' });

    this.select3DModel(idx);
    this.updateValidateStatus(idx);
    this.m_host.onModify();

    return { ok: true };
  }

  /**
   * `OnRemove3DModel`: delete the selected rows (or the cursor's row when none is),
   * highest first, un-embedding each file, then select the row that took their place.
   */
  OnRemove3DModel(aSelectedRows: readonly number[]): boolean {
    if (this.m_rows.length === 0 || this.m_shapes3D_list.length === 0) return false;

    const selectedRows = [...aSelectedRows];

    if (selectedRows.length === 0 && this.m_selected >= 0) selectedRows.push(this.m_selected);

    // wxBell()
    if (selectedRows.length === 0) return false;

    selectedRows.sort((a, b) => a - b);

    let nextSelection = selectedRows[0]!;
    let lastRow = -1;

    this.m_inSelect = true;

    for (let ii = selectedRows.length - 1; ii >= 0; --ii) {
      const row = selectedRows[ii]!;

      if (row === lastRow) continue;

      lastRow = row;

      if (row < 0 || row >= this.m_shapes3D_list.length) continue;

      // Not all files are embedded but this will ignore the ones that are not
      this.m_host.removeEmbeddedFile(this.m_shapes3D_list[row]!.m_Filename);
      this.m_shapes3D_list.splice(row, 1);
      this.m_rows.splice(row, 1);
    }

    nextSelection = this.m_rows.length > 0 ? Math.min(nextSelection, this.m_rows.length - 1) : 0;

    this.m_inSelect = false;
    this.select3DModel(nextSelection);
    this.m_host.onModify();

    return true;
  }

  /** `updateValidateStatus`. `aEditorValue` is the open cell editor's text, which wins. */
  updateValidateStatus(aRow: number, aEditorValue?: string): void {
    const row = this.m_rows[aRow];

    if (!row) return;

    const filename = aEditorValue ?? row.filename;
    let icon: STATUS_ICON = 0;
    let errStr = '';

    switch (this.validateModelExists(filename)) {
      case MODEL_VALIDATE_ERRORS.MODEL_NO_ERROR:
        icon = 0;
        errStr = '';
        break;

      case MODEL_VALIDATE_ERRORS.NO_FILENAME:
        icon = 'warning';
        errStr = _('No filename entered');
        break;

      case MODEL_VALIDATE_ERRORS.ILLEGAL_FILENAME:
        icon = 'error';
        errStr = _('Illegal filename');
        break;

      case MODEL_VALIDATE_ERRORS.RESOLVE_FAIL:
        icon = 'error';
        errStr = _('File not found');
        break;

      case MODEL_VALIDATE_ERRORS.OPEN_FAIL:
        icon = 'error';
        errStr = _('Unable to open file');
        break;

      default:
        icon = 'error';
        errStr = _('Unknown error');
        break;
    }

    row.problem = errStr;
    row.icon = icon;
  }

  validateModelExists(aFilename: string): MODEL_VALIDATE_ERRORS {
    if (aFilename === '') return MODEL_VALIDATE_ERRORS.NO_FILENAME;

    const hasAlias = { value: false };
    const resolv = this.m_host.resolver();

    if (!resolv) return MODEL_VALIDATE_ERRORS.RESOLVE_FAIL;

    if (!resolv.ValidateFileName(aFilename, hasAlias))
      return MODEL_VALIDATE_ERRORS.ILLEGAL_FILENAME;

    const libraryName = this.m_footprint.GetFPID().GetLibNickname();
    const footprintBasePath = this.m_host.footprintBasePath(libraryName);
    const fullPath = resolv.ResolvePath(
      aFilename,
      footprintBasePath,
      this.m_host.embeddedFilesStack(),
    );

    if (fullPath === '') return MODEL_VALIDATE_ERRORS.RESOLVE_FAIL;

    if (!(this.m_host.isFileReadable ?? wxFileExists)(fullPath))
      return MODEL_VALIDATE_ERRORS.OPEN_FAIL;

    return MODEL_VALIDATE_ERRORS.MODEL_NO_ERROR;
  }
}

const { COL_PROBLEM, COL_FILENAME, COL_SHOWN } = MODELS_TABLE_COLUMNS;

/** What the dialog that hosts the page reads back (`TransferDataFromWindow`). */
export interface PANEL_3D_MODEL_API {
  /** `m_modelsGrid->CommitPendingChanges()`. */
  CommitPendingChanges(): boolean;
  /** `GetModelList()`. */
  GetModelList(): FP_3DMODEL[];
}

export function PanelFpProperties3dModel({
  footprint,
  host,
  renderPreview,
  pickModel,
  apiRef,
}: {
  footprint: FOOTPRINT;
  host: PANEL_3D_MODEL_HOST;
  /** `m_previewPane`: the footprint's models drawn, the selected one first. */
  renderPreview: (aModels: readonly FP_3DMODEL[], aSelected: number, aVersion: number) => ReactNode;
  /** `DIALOG_SELECT_3DMODEL::ShowQuasiModal()`: the chosen file, or null for cancel. */
  pickModel: () => Promise<SELECTED_3D_MODEL | null>;
  /** Filled with the panel's API once it is built. */
  apiRef?: { current: PANEL_3D_MODEL_API | null };
}): JSX.Element {
  const [version, setVersion] = useState(0);
  const bump = useCallback((): void => setVersion((v) => v + 1), []);

  const [panel] = useState(() => {
    const p = new PANEL_FP_PROPERTIES_3D_MODEL(footprint, {
      ...host,
      onModify: () => {
        host.onModify();
        bump();
      },
    });
    p.TransferDataToWindow();
    return p;
  });

  const [{ grid, table, tricks }] = useState(() => {
    const g = new WX_GRID();
    const t = new wxGridStringTable(0, 3);
    g.SetTable(t, true, wxGridSelectionModes.wxGridSelectRows);
    g.SetColLabelValue(COL_PROBLEM, '');
    g.SetColLabelValue(COL_FILENAME, _('3D Model(s)'));
    g.SetColLabelValue(COL_SHOWN, _('Show'));

    // Icon showing warning/error information
    let attr = new wxGridCellAttr();
    attr.SetReadOnly();
    g.SetColAttr(COL_PROBLEM, attr);

    // Filename
    g.SetColAttr(COL_FILENAME, new wxGridCellAttr());

    // Show checkbox
    attr = new wxGridCellAttr();
    attr.SetRenderer(new wxGridCellBoolRenderer());
    attr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
    attr.SetAlignment(wxALIGN_CENTER);
    g.SetColAttr(COL_SHOWN, attr);

    const tr = new GRID_TRICKS(g);
    tr.SetTooltipEnable(COL_PROBLEM);

    return { grid: g, table: t, tricks: tr };
  });

  /** The grid shows what the panel holds: rows, cells, and the status cell's tooltip. */
  const syncGrid = (): void => {
    const rows = panel.m_rows;

    grid.BeginBatch();

    while (table.GetNumberRows() > rows.length) table.DeleteRows(table.GetNumberRows() - 1, 1);
    if (table.GetNumberRows() < rows.length) table.AppendRows(rows.length - table.GetNumberRows());

    rows.forEach((r, i) => {
      table.SetValue(i, COL_PROBLEM, r.problem);
      table.SetValue(i, COL_FILENAME, r.filename);
      table.SetValue(i, COL_SHOWN, r.shown);
    });

    grid.EndBatch();

    // `select3DModel`: `SelectRow`, then the cursor on the file name.
    if (panel.m_selected >= 0 && grid.GetGridCursorRow() !== panel.m_selected) {
      panel.m_inSelect = true;
      grid.SelectRow(panel.m_selected);
      grid.SetGridCursor(panel.m_selected, COL_FILENAME);
      panel.m_inSelect = false;
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the panel's change counter; the grid and panel are stable
  useLayoutEffect(syncGrid, [version]);

  useLayoutEffect(() => {
    const changing = (e: wxGridEvent): void => {
      // The editor's text is what is being committed: `GetString()` is the new value.
      panel.on3DModelCellChanging(e.GetRow(), e.GetCol(), e.GetString());
    };
    const changed = (e: wxGridEvent): void => {
      panel.On3DModelCellChanged(e.GetRow(), e.GetCol(), table.GetValue(e.GetRow(), e.GetCol()));
      bump();
    };
    const selected = (e: wxGridEvent): void => {
      if (!panel.m_inSelect) {
        panel.On3DModelSelected(e.GetRow());
        bump();
      }
    };

    grid.Connect(wxEVT_GRID_CELL_CHANGING, changing);
    grid.Connect(wxEVT_GRID_CELL_CHANGED, changed);
    grid.Connect(wxEVT_GRID_SELECT_CELL, selected);

    return () => {
      grid.Disconnect(wxEVT_GRID_CELL_CHANGING, changing);
      grid.Disconnect(wxEVT_GRID_CELL_CHANGED, changed);
      grid.Disconnect(wxEVT_GRID_SELECT_CELL, selected);
    };
  }, [grid, table, panel, bump]);

  if (apiRef) {
    apiRef.current = {
      CommitPendingChanges: () => grid.CommitPendingChanges(),
      GetModelList: () => panel.GetModelList(),
    };
  }

  const onRemove = (): void => {
    if (!grid.CommitPendingChanges()) return;

    const rows = new Set(grid.GetSelectedRows());

    for (const c of grid.GetSelectedCells?.() ?? []) rows.add(c.GetRow());

    const tl = grid.GetSelectionBlockTopLeft();
    const br = grid.GetSelectionBlockBottomRight();

    if (tl.length > 0 && br.length > 0)
      for (let r = tl[0]!.GetRow(); r <= br[0]!.GetRow(); ++r) rows.add(r);

    grid.ClearSelection();
    panel.OnRemove3DModel([...rows]);
    bump();
  };

  const onBrowse = async (): Promise<void> => {
    if (!grid.CommitPendingChanges()) return;

    const selected = grid.GetGridCursorRow();
    const chosen = await pickModel();
    const r = panel.OnAdd3DModel(chosen, selected);

    if (!r.ok && r.error) DisplayErrorMessage(r.error);

    bump();
  };

  // `SplitHorizontally( m_upperPanel, m_lowerPanel, 112 )`.
  const [sash, setSash] = useState(112);

  return (
    <PANEL_FP_PROPERTIES_3D_MODEL_BASE
      sashPosition={sash}
      onSashPosition={setSash}
      m_modelsGrid={
        <WxGridView
          grid={grid}
          tricks={tricks}
          // [data] `SetColSize( 0, 20 )`, `( 1, 120 )`, `( 2, 48 )`, `_base.cpp`.
          columns={[{ width: 20 }, { width: 120 }, { width: 48, center: true }]}
          flexCol={COL_FILENAME}
          ariaLabel="3D models"
          renderCell={(aRow, aCol, aValue) =>
            aCol === COL_PROBLEM ? (
              <GridCellStatusIcon status={panel.m_rows[aRow]?.icon ?? 0} tooltip={aValue} />
            ) : undefined
          }
        />
      }
      onAdd3DRow={() =>
        grid.OnAddRow(() => {
          const at = panel.OnAdd3DRow();
          bump();
          return at;
        })
      }
      onAdd3DModel={() => void onBrowse()}
      onRemove3DModel={onRemove}
      removeEnabled={panel.m_rows.length > 0}
      m_previewPane={renderPreview(panel.GetModelList(), Math.max(0, panel.m_selected), version)}
    />
  );
}
