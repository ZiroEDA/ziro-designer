// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The view of DIALOG_SYNC_SHEET_PINS (dialog_sync_sheet_pins_base.cpp): "Synchronize sheet pins
 * and hierarchical labels", a notebook of PANEL_SYNC_SHEET_PINS pages whose tab images say
 * whether anything is left to match, the tip, and Close. Modeless: it stands aside while the
 * user places from it, and comes back when the placement ends.
 */
import { type JSX, useEffect, useReducer } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import type { DIALOG_SYNC_SHEET_PINS } from './dialog_sync_sheet_pins.js';
import { PanelSyncSheetPins } from './panel_sync_sheet_pins_ui.js';

export function DialogSyncSheetPins({
  dlg,
  onClose,
}: {
  dlg: DIALOG_SYNC_SHEET_PINS;
  onClose: () => void;
}): JSX.Element | null {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const book = dlg.m_notebook;

  useEffect(() => book.AddRefreshListener(tick), [book]);

  if (!dlg.IsShown()) return null;

  const images = book.GetImageList();
  const page = book.GetSelection();

  return (
    <DialogShim
      title="Synchronize sheet pins and hierarchical labels"
      onClose={onClose}
      className="ze-sync-dialog"
    >
      <div className="ze-modal-body">
        <div className="ze-erc-tabs">
          {Array.from({ length: book.GetPageCount() }, (_, i) => (
            <div
              key={i}
              className={`tab${i === page ? ' active' : ''}`}
              onClick={() => book.SetSelection(i)}
            >
              {images[book.GetPageImage(i)] && <Icon name={images[book.GetPageImage(i)]!} />}{' '}
              {book.GetPageText(i)}
            </div>
          ))}
        </div>
        {page >= 0 && <PanelSyncSheetPins key={page} panel={book.GetPage(page)} />}
      </div>
      <div className="ze-modal-footer">
        <span className="ze-sync-tip">
          Changes made in this dialog occur immediately, use Undo in each affected document to undo
          them
        </span>
        <button type="button" className="ze-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </DialogShim>
  );
}
