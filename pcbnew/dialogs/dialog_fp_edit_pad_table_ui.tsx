// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pad Table. Counterpart: `dialog_fp_edit_pad_table_base.cpp`:
 *
 *     topSizer (V)
 *       bSummarySizer (H)                         wxEXPAND|wxTOP|wxBOTTOM 5
 *         "Pad numbers:"  summary (ellipsized)     LEFT 5 / RIGHT|LEFT 5
 *         stretch
 *         "Pad count:"    count                    LEFT 10 / RIGHT|LEFT 5
 *         stretch
 *         "Duplicate pads:"  duplicates (ellipsized)   LEFT 10 / RIGHT|LEFT 5
 *       m_grid, 800 x 400, 11 columns             1, wxEXPAND|wxALL 5
 *       wxStdDialogButtonSizer                    wxALIGN_RIGHT|wxALL 5
 *
 * The decisions, and the WX_GRID itself, are `dialog_fp_edit_pad_table.ts`'s
 * `DIALOG_FP_EDIT_PAD_TABLE`; this window draws that grid and the three
 * summary labels. `onClose` is what `ShowQuasiModal()` returning ends: the
 * dialog is already `Destroy()`ed (a cancelled one has put the pads back).
 */
import { type JSX, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import {
  COL_SHAPE,
  DIALOG_FP_EDIT_PAD_TABLE,
  DIALOG_FP_EDIT_PAD_TABLE_TITLE,
  PAD_TABLE_COLUMN_WIDTHS,
} from './dialog_fp_edit_pad_table.js';

/** `FromDIP( 30 )`: "2*margin + arrow button" added to the longest shape name. */
const SHAPE_COLUMN_PADDING = 30;

export function DialogFpEditPadTable({
  dialog,
  onClose,
}: {
  dialog: DIALOG_FP_EDIT_PAD_TABLE;
  onClose: () => void;
}): JSX.Element {
  useSyncExternalStore(
    (listener) => dialog.Subscribe(listener),
    () => dialog.GetVersion(),
  );

  const paneRef = useRef<HTMLDivElement>(null);

  const cancel = (): void => {
    dialog.OnCancel();
    dialog.Destroy();
    onClose();
  };

  const ok = (): void => {
    if (!dialog.TransferDataFromWindow()) return;

    dialog.Destroy();
    onClose();
  };

  // `InitDialog`: TransferDataToWindow, once
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dialog is the one object this window is made for
  useLayoutEffect(() => {
    dialog.TransferDataToWindow();

    // Ensure the Shape column is wide enough for the longest shape text plus the dropdown arrow.
    const sizes = [...PAD_TABLE_COLUMN_WIDTHS];
    const ctx = document.createElement('canvas').getContext?.('2d') ?? null;

    if (ctx && paneRef.current) {
      ctx.font = getComputedStyle(paneRef.current).font;

      let maxWidth = 0;

      for (const name of DIALOG_FP_EDIT_PAD_TABLE.shapeNames())
        maxWidth = Math.max(maxWidth, ctx.measureText(name).width);

      sizes[COL_SHAPE] = Math.round(maxWidth) + SHAPE_COLUMN_PADDING;
    }

    dialog.SetColumnSizes(sizes);
  }, []);

  // `OnSize`: the columns keep their proportions as the grid's width changes.
  useEffect(() => {
    const pane = paneRef.current;

    if (!pane || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => dialog.OnSize(pane.clientWidth));
    observer.observe(pane);

    return () => observer.disconnect();
  }, [dialog]);

  return (
    <DialogShim title={DIALOG_FP_EDIT_PAD_TABLE_TITLE} onClose={cancel} className="ze-padtable">
      <div className="ze-modal-body ze-padtable-body">
        <div className="ze-padtable-summary">
          <span className="lbl l5">Pad numbers:</span>
          <span
            className="ze-padtable-ellipsis r5"
            title={dialog.m_pin_numbers_summaryToolTip || undefined}
          >
            {dialog.m_pin_numbers_summary}
          </span>
          <span className="stretch" />
          <span className="lbl l10">Pad count:</span>
          <span className="r5">{dialog.m_pin_count}</span>
          <span className="stretch" />
          <span className="lbl l10">Duplicate pads:</span>
          <span
            className="ze-padtable-ellipsis r5"
            title={dialog.m_duplicate_pinsToolTip || undefined}
          >
            {dialog.m_duplicate_pins}
          </span>
        </div>
        <div className="ze-grid-pane ze-padtable-grid" ref={paneRef}>
          <WxGridView
            grid={dialog.m_grid}
            tricks={dialog.m_tricks}
            columns={dialog.GetColumnWidths().map((width) => ({ width }))}
            ariaLabel="Pads"
            onUpdate={() => dialog.OnUpdateUI()}
          />
        </div>
      </div>
      <StdDialogButtons onCancel={cancel} onOk={ok} />
    </DialogShim>
  );
}
