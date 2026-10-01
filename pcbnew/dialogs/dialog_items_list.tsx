// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ITEMS_LIST` (`pcbnew/dialogs/dialog_items_list.cpp`): a warning, and
 * under it a collapsed "Show Details" pane holding a one-column, headerless,
 * single-selection `wxListCtrl` of item descriptions. Selecting a row calls
 * the caller's callback with its index (`SetSelectionCallback`), which is how
 * `PANEL_SETUP_LAYERS::CheckCopperLayerCount` lets you look at an item that is
 * about to be deleted with its layer.
 *
 * The constructor builds the sizer by hand, no `_base`:
 *
 *     mainSizer (V)
 *       m_message                       wxALL|wxEXPAND 10
 *       m_collapsiblePane (collapsed)   proportion 1, wxALL|wxEXPAND 10
 *         paneSizer: m_listCtrl 400 x 200, wxLC_REPORT|wxLC_NO_HEADER|wxLC_SINGLE_SEL,
 *                    proportion 1, wxEXPAND|wxALL 5
 *       CreateSeparatedButtonSizer( wxOK|wxCANCEL )   wxEXPAND|wxALL 10
 *
 * `wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER`, and opening the pane re-fits the
 * dialog (`onCollapse`: `Layout(); Fit()`).
 *
 * The one caller is the layer-removal check of Board Setup > Board Editor
 * Layers, which needs `getRemovedLayersWithItems` on the live BOARD; our
 * `panel_setup_layers.tsx` edits a value copy and has no such check yet, so
 * nothing raises this dialog until that page grows it.
 */
import { useState, type JSX } from 'react';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { WxCollapsiblePane } from '@ziroeda/common/widgets/wx_collapsible_pane.js';

export function DialogItemsList({
  title,
  message,
  detailsLabel,
  items,
  onSelect,
  onResult,
}: {
  title: string;
  message: string;
  detailsLabel: string;
  /** `AddItems( aItems )`. */
  items: readonly string[];
  /** `SetSelectionCallback`: the index of the row just selected. */
  onSelect?: (index: number) => void;
  /** `ShowModal() == wxID_OK`. */
  onResult: (ok: boolean) => void;
}): JSX.Element {
  useModalEscape(() => onResult(false));

  // A wxCollapsiblePane opens collapsed.
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-items-list" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{title}</div>
        <div className="ze-modal-body ze-items-list-body">
          <div className="ze-items-list-message">{message}</div>
          <div className="ze-items-list-pane">
            <WxCollapsiblePane label={detailsLabel} collapsed={collapsed} onChange={setCollapsed}>
              <div className="ze-grid-pane ze-items-list-list">
                <table className="ze-grid">
                  <tbody>
                    {items.map((text, i) => (
                      // wxLC_SINGLE_SEL: a row select; the callback fires on selection.
                      <tr
                        // biome-ignore lint/suspicious/noArrayIndexKey: rows are the caller's ordered list
                        key={i}
                        onMouseDown={() => onSelect?.(i)}
                      >
                        <td>{text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </WxCollapsiblePane>
          </div>
        </div>
        <div className="ze-modal-footer ze-items-list-foot">
          <button type="button" onClick={() => onResult(false)}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onResult(true)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
