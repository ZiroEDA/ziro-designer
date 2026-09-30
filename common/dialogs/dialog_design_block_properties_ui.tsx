// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_DESIGN_BLOCK_PROPERTIES` (common/dialogs/dialog_design_block_properties.cpp),
 * the window: "Design Block Properties".
 *
 * The sizer tree (dialog_design_block_properties_base.cpp):
 *
 *   bMainSizer (V)
 *     bMargins (V)                                  1, wxEXPAND|wxRIGHT|wxLEFT, 5
 *       sbFields "Default Fields" (V)               1, wxEXPAND|wxTOP|wxRIGHT|wxLEFT, 5
 *         m_fieldsGrid (Name, Value)                1, wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT, 5
 *         bButtonSizer (H)                          0, wxEXPAND|wxBOTTOM|wxLEFT, 5
 *           m_bpAdd, m_bpMoveUp, m_bpMoveDown       each 0, wxALIGN_CENTER_VERTICAL|wxRIGHT, 5
 *           spacer 20 x 0
 *           m_bpDelete                              0, wxALIGN_CENTER_VERTICAL|wxRIGHT, 5
 *           stretch spacer                          1
 *     fgProperties (flex grid 0 x 2, vgap 5)        0, wxBOTTOM|wxEXPAND|wxLEFT|wxRIGHT|wxTOP, 10
 *       "Name:"        m_textName
 *       "Keywords:"    m_textKeywords
 *       "Description:" m_textDescription (wxTE_MULTILINE)
 *     m_stdButtons (OK / Cancel)                    0, wxALL|wxEXPAND, 5
 *
 * The grid is a WX_GRID with GRID_TRICKS, rows selected whole, column 1
 * autosized (`SetupColumnAutosizer( 1 )`).
 */
import { useState, type JSX } from 'react';
import type { DESIGN_BLOCK } from '../design_block.js';
import { StdDialogButtons, useModalEscape } from '../dialog_shim.js';
import { StdBitmapButton } from '../widgets/std_bitmap_button.js';
import type { WX_GRID } from '../widgets/wx_grid.js';
import { wxGridSelectionModes } from '../wx/grid.js';
import { useStringGrid, WxGridView } from '../wx/grid_ui.js';
import {
  DesignBlockPropertiesFromWindow,
  DesignBlockPropertiesToWindow,
  UNTITLED_FIELD,
} from './dialog_design_block_properties.js';

type Row = { name: string; value: string };

export function DialogDesignBlockProperties({
  designBlock,
  disableName = false,
  onClose,
  showError,
}: {
  /** `aDesignBlock`: written back on OK. */
  designBlock: DESIGN_BLOCK;
  /** `aDisableName`: the name is shown but not editable (updating an existing block). */
  disableName?: boolean;
  /** `ShowModal()`'s answer: true for wxID_OK. */
  onClose: (ok: boolean) => void;
  /** The error dialog `TransferDataFromWindow` raises (the dialog stays up). */
  showError: (message: string) => void;
}): JSX.Element {
  const [initial] = useState(() => DesignBlockPropertiesToWindow(designBlock));
  const [name, setName] = useState(initial.name);
  const [keywords, setKeywords] = useState(initial.keywords);
  const [description, setDescription] = useState(initial.description);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.fields.map(([n, v]) => ({ name: n, value: v })),
  );
  useModalEscape(() => onClose(false));

  const { grid, tricks, onUpdate } = useStringGrid<Row>({
    labels: ['Name', 'Value'],
    mode: wxGridSelectionModes.wxGridSelectRows,
    rows,
    toCells: (r) => [r.name, r.value],
    fromCells: (c) => ({ name: c[0]!, value: c[1]! }),
    onChange: setRows,
  });

  /** `OnAddField`: a row named "Untitled Field", its name cell selected. */
  const onAddField = (aGrid: WX_GRID): void =>
    aGrid.OnAddRow(() => {
      const row = aGrid.GetNumberRows();
      aGrid.AppendRows(1);
      aGrid.SetCellValue(row, 0, UNTITLED_FIELD);
      return [row, 0];
    });

  const onOk = (): void => {
    if (!grid.CommitPendingChanges()) return;

    const error = DesignBlockPropertiesFromWindow(designBlock, {
      name,
      keywords,
      description,
      fields: Array.from({ length: grid.GetNumberRows() }, (_, r) => [
        grid.GetCellValue(r, 0),
        grid.GetCellValue(r, 1),
      ]),
    });

    if (error !== null) {
      showError(error);
      return;
    }

    onClose(true);
  };

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-dbprops" role="dialog" aria-modal="true">
        <div className="ze-modal-header">Design Block Properties</div>
        <div className="ze-dbprops-margins">
          <fieldset className="ze-sbox ze-dbprops-fields">
            <legend>Default Fields</legend>
            <div className="ze-grid-pane ze-dbprops-gridpane">
              <WxGridView
                grid={grid}
                tricks={tricks}
                columns={[{ width: 120 }]}
                flexCol={1}
                onUpdate={onUpdate}
                ariaLabel="Default Fields"
              />
            </div>
            <div className="ze-grid-btns ze-dbprops-btns">
              <StdBitmapButton
                bitmap="small_plus"
                title="Add field"
                tooltip={null}
                onClick={() => onAddField(grid)}
              />
              <StdBitmapButton
                bitmap="small_up"
                title="Move up"
                tooltip={null}
                onClick={() => grid.OnMoveRowUp((row) => grid.SwapRows(row, row - 1))}
              />
              <StdBitmapButton
                bitmap="small_down"
                title="Move down"
                tooltip={null}
                // Upstream binds Move Down to `OnMoveRowUp` with a +1 swap
                // (dialog_design_block_properties.cpp:135-142).
                onClick={() => grid.OnMoveRowUp((row) => grid.SwapRows(row, row + 1))}
              />
              <span className="ze-dbprops-btngap" />
              <StdBitmapButton
                bitmap="small_trash"
                title="Delete field"
                tooltip={null}
                onClick={() => grid.OnDeleteRows((row) => grid.DeleteRows(row, 1))}
              />
            </div>
          </fieldset>
        </div>
        <div className="ze-dbprops-props">
          <label htmlFor="ze-dbprops-name">Name:</label>
          <input
            id="ze-dbprops-name"
            className="ze-input"
            value={name}
            readOnly={disableName}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="ze-dbprops-keywords">Keywords:</label>
          <input
            id="ze-dbprops-keywords"
            className="ze-input"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <label htmlFor="ze-dbprops-description">Description:</label>
          <textarea
            id="ze-dbprops-description"
            className="ze-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <StdDialogButtons onCancel={() => onClose(false)} onOk={onOk} />
      </div>
    </div>
  );
}
