// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_SWAP_LAYERS's window (dialog_swap_layers_base.cpp): a WX_GRID of
 * "Move items on:" / "To layer:" over the dialog's rows, minimum 250 x 150,
 * wxEXPAND|wxALL 5 inside a margin sizer of wxTOP|wxRIGHT|wxLEFT 10, then
 * OK / Cancel.
 *
 * Column 0 is read-only with a layer renderer on wxSYS_COLOUR_MENU; column 1 is
 * a GRID_CELL_LAYER_SELECTOR offering the board's enabled copper layers (the
 * editor is made with LSET::AllNonCuMask() as the layers it may not offer).
 * The two columns share the grid's width (adjustGridColumns).
 */
import { type JSX, useEffect, useState } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { LSET } from '@ziroeda/common/lset.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxGRID_VALUE_NUMBER,
  wxGridCellAttr,
  wxGridSelectionModes,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import {
  GRID_CELL_LAYER_RENDERER,
  GRID_CELL_LAYER_SELECTOR,
  choiceOf,
} from '../grid_layer_box_helpers.js';
import type { DIALOG_SWAP_LAYERS } from './dialog_swap_layers.js';

/** `LAYER_GRID_TABLE` (dialog_swap_layers.cpp:35-85), over the dialog's rows. */
class LAYER_GRID_TABLE extends WX_GRID_TABLE_BASE {
  constructor(private readonly m_dialog: DIALOG_SWAP_LAYERS) {
    super();
  }

  GetNumberRows(): number {
    return this.m_dialog.GetRows().length;
  }

  GetNumberCols(): number {
    return 2;
  }

  override GetColLabelValue(aCol: number): string {
    switch (aCol) {
      case 0:
        return 'Move items on:';
      case 1:
        return 'To layer:';
      default:
        return '';
    }
  }

  override CanGetValueAs(_aRow: number, _aCol: number, aTypeName: string): boolean {
    return aTypeName === wxGRID_VALUE_NUMBER;
  }

  override CanSetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return this.CanGetValueAs(aRow, aCol, aTypeName);
  }

  GetValue(): string {
    return 'undefined';
  }

  SetValue(): void {}

  override GetValueAsLong(aRow: number, aCol: number): number {
    const row = this.m_dialog.GetRows()[aRow];

    if (!row || aCol < 0 || aCol >= 2) return -1;

    return aCol === 0 ? row.from : row.to;
  }

  override SetValueAsLong(aRow: number, aCol: number, aValue: number): void {
    if (aCol === 1) this.m_dialog.SetDestination(aRow, aValue);
  }
}

export function DialogSwapLayers({
  dialog,
  copperLayerCount,
  onResult,
}: {
  dialog: DIALOG_SWAP_LAYERS;
  /** The board's copper layer count: the selector offers its enabled copper layers. */
  copperLayerCount: number;
  onResult: (aOk: boolean) => void;
}): JSX.Element {
  const [grid] = useState(() => {
    const g = new WX_GRID();
    g.SetTable(new LAYER_GRID_TABLE(dialog), true, wxGridSelectionModes.wxGridSelectCells);

    const notAllowed = dialog.GetNotAllowedLayers();
    const offered = LSET.AllCuMask(copperLayerCount)
      .UIOrder()
      .filter((l) => !notAllowed.Contains(l));

    const from = new wxGridCellAttr();
    from.SetRenderer(new GRID_CELL_LAYER_RENDERER(choiceOf));
    from.SetReadOnly();
    g.SetColAttr(0, from);

    const to = new wxGridCellAttr();
    to.SetRenderer(new GRID_CELL_LAYER_RENDERER(choiceOf));
    to.SetEditor(
      new GRID_CELL_LAYER_SELECTOR(() =>
        offered.map((layer) => {
          const c = choiceOf(layer);
          return { layer, label: c.label, swatch: c.swatch };
        }),
      ),
    );
    g.SetColAttr(1, to);

    return g;
  });

  useEffect(() => {
    grid.ForceRefresh();
  }, [grid]);

  const ok = (): void => {
    if (!grid.CommitPendingChanges()) return;

    if (dialog.TransferDataFromWindow()) onResult(true);
  };

  return (
    <DialogShim title="Swap Layers" onClose={() => onResult(false)} className="ze-swaplayers">
      <div className="ze-modal-body ze-swaplayers-body">
        <WxGridView
          grid={grid}
          rowLabels={false}
          flexCol={1}
          className="ze-swaplayers-grid"
          ariaLabel="Swap layers"
        />
      </div>
      <StdDialogButtons onOk={ok} onCancel={() => onResult(false)} />
    </DialogShim>
  );
}
