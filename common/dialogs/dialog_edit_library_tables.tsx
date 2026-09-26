// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EDIT_LIBRARY_TABLES` (common/dialogs/dialog_edit_library_tables.cpp):
 * the frame every library-table panel is installed into -
 *
 *     DIALOG_EDIT_LIBRARY_TABLES dlg( aParent, _( "Symbol Libraries" ) );
 *     dlg.InstallPanel( new PANEL_SYM_LIB_TABLE( &dlg, ... ) );
 *
 * (panel_sym_lib_table.cpp:1056; "Footprint Libraries" and "Design Block
 * Libraries" are the other two). `InstallPanel` builds the sizer: a WX_INFOBAR
 * at the top (wxEXPAND, 0), the panel at proportion 1 wxEXPAND|wxLEFT|wxTOP|
 * wxRIGHT 5 with a 1000 x 600 minimum, then OK / Cancel at wxALL|wxEXPAND 5.
 * The dialog is resizable (wxRESIZE_BORDER).
 */
import type { JSX, ReactNode } from 'react';
import { StdDialogButtons } from '../dialog_shim.js';
import { useModalEscape } from '../dialog_shim.js';

export function DIALOG_EDIT_LIBRARY_TABLES({
  title,
  infoBar,
  children,
  onOK,
  onCancel,
}: {
  /** `aTitle`: "Symbol Libraries", "Footprint Libraries", ... */
  title: string;
  /** `m_infoBar`, the panel's messages. */
  infoBar?: ReactNode;
  /** The installed panel (`m_contentPanel`). */
  children: ReactNode;
  /** `TransferDataFromWindow`, which is the panel's. */
  onOK: () => void;
  onCancel: () => void;
}): JSX.Element {
  useModalEscape(onCancel);
  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-libtables" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ze-modal-header">
          {title}
          <span className="x" title="Close" onClick={onCancel}>
            ✕
          </span>
        </div>
        {infoBar}
        <div className="ze-libtables-content">{children}</div>
        <StdDialogButtons onCancel={onCancel} onOk={onOK} />
      </div>
    </div>
  );
}
