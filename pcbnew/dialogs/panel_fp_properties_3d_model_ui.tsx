// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The controls of `PANEL_FP_PROPERTIES_3D_MODEL`
 * (`panel_fp_properties_3d_model_base.cpp`); the decisions are
 * `panel_fp_properties_3d_model.ts`.
 *
 *     bSizerMain3D (V)
 *       m_splitter1 (horizontal, sash 112, min pane 112, live update)
 *         m_upperPanel: bSizer4 (V)
 *           m_modelsGrid, WX_GRID, 3 columns 20 / 120 / 48, no grid lines, no row
 *             labels, column labels 22 px ( "" , "3D Model(s)", "Show" )   wxEXPAND|wxTOP|wxRIGHT|wxLEFT 5
 *           bSizer3DButtons (H)                                  wxEXPAND|wxTOP|wxBOTTOM 2
 *             small_plus  (Add)        wxALIGN_CENTER_VERTICAL|wxLEFT 5
 *             small_folder (Browse)    same
 *             20 px spacer
 *             small_trash (Remove)     wxALIGN_CENTER_VERTICAL
 *             stretch
 *             "Configure Paths..."     (not drawn, see the .ts header)
 *         m_lowerPanel: the PANEL_PREVIEW_3D_MODEL
 *
 * Web deltas: the file name cell is a plain text editor where upstream's is
 * `GRID_CELL_PATH_EDITOR` (a text box with a disk browse button), for the reason
 * `lib_table_grid_data_model.ts` gives for the same editor, since the Browse
 * button above does the picking; and the sash keeps the upper pane at its size
 * rather than sharing growth at gravity 0.5.
 *
 * The 3D preview (`PANEL_PREVIEW_3D_MODEL`) and the model picker
 * (`DIALOG_SELECT_3DMODEL`) live in `3d-viewer/`; they arrive as props, the way
 * the footprint chooser's 3D canvas does.
 */
import { useCallback, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { DialogIcon } from '@ziroeda/common/dialogs/dialog_message.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Sash } from '@ziroeda/common/widgets/wx_splitter_window.js';
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
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import type { FOOTPRINT, FP_3DMODEL } from '../footprint.js';
import {
  MODELS_TABLE_COLUMNS,
  PANEL_FP_PROPERTIES_3D_MODEL,
  type PANEL_3D_MODEL_HOST,
  type SELECTED_3D_MODEL,
} from './panel_fp_properties_3d_model.js';

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
    g.SetColLabelValue(COL_FILENAME, '3D Model(s)');
    g.SetColLabelValue(COL_SHOWN, 'Show');

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

  const upper = 112; // [data] `SplitHorizontally( m_upperPanel, m_lowerPanel, 112 )`, `_base.cpp`.
  const [sash, setSash] = useState(upper);
  const boxRef = useRef<HTMLDivElement>(null);
  const max = Math.max(upper, (boxRef.current?.clientHeight ?? 400) - upper);

  return (
    <div className="ze-fp3d" ref={boxRef}>
      <div className="ze-fp3d-upper" style={{ height: sash }}>
        <div className="ze-grid-pane ze-fp3d-grid">
          <WxGridView
            grid={grid}
            tricks={tricks}
            // [data] `SetColSize( 0, 20 )`, `( 1, 120 )`, `( 2, 48 )`, `_base.cpp`.
            columns={[{ width: 20 }, { width: 120 }, { width: 48, center: true }]}
            flexCol={COL_FILENAME}
            ariaLabel="3D models"
            renderCell={(_row, col, value) =>
              col === COL_PROBLEM
                ? (() => {
                    const icon = panel.m_rows[_row]?.icon ?? 0;
                    return icon === 0 ? null : (
                      <span className="ze-fp3d-status" title={value}>
                        <DialogIcon
                          icon={icon === 'error' ? 'error' : 'warning'}
                          className="ze-fp3d-icon"
                        />
                      </span>
                    );
                  })()
                : null
            }
          />
        </div>
        <div className="ze-fp3d-buttons">
          <StdBitmapButton
            bitmap="small_plus"
            title="Add 3D model"
            tooltip={null}
            onClick={() =>
              grid.OnAddRow(() => {
                const at = panel.OnAdd3DRow();
                bump();
                return at;
              })
            }
          />
          <StdBitmapButton
            bitmap="small_folder"
            title="Browse for 3D model"
            tooltip={null}
            onClick={() => void onBrowse()}
          />
          {/* `bSizer3DButtons->Add( 20, 0, 0, 0, 5 )`. */}
          <span className="ze-fp3d-gap" />
          <StdBitmapButton
            bitmap="small_trash"
            title="Remove 3D model"
            tooltip={null}
            disabled={panel.m_rows.length === 0}
            onClick={onRemove}
          />
        </div>
      </div>
      <Sash edge="bottom" size={sash} min={upper} max={max} onResize={setSash} />
      <div className="ze-fp3d-lower">
        {renderPreview(panel.GetModelList(), Math.max(0, panel.m_selected), version)}
      </div>
    </div>
  );
}
