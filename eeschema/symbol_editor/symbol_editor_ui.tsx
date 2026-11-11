// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window half of the dialogs symbol_editor.ts defines (symbol_editor.cpp): today
 * SAVE_SYMBOL_AS_DIALOG.
 */
import { EdaListDialog } from '@ziroeda/common/dialogs/eda_list_dialog.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { type JSX, useState } from 'react';
import { LibraryRowValue } from '../sch_base_frame_ui.js';
import { SAVE_AS_IDS, type SAVE_SYMBOL_AS_DIALOG } from './symbol_editor.js';
import { _ } from '@ziroeda/wx/translation.js';

/**
 * SAVE_SYMBOL_AS_DIALOG's window: the libraries, "Save in library:", a Name row at the head of the
 * tab order, a flatten checkbox for a derived symbol, and "New Library..." ending the modal with
 * ID_MAKE_NEW_LIBRARY. Save runs TransferDataFromWindow, whose validator may keep it up.
 */
export function SaveSymbolAsDialog({
  dlg,
  onClose,
}: {
  dlg: SAVE_SYMBOL_AS_DIALOG;
  onClose: (aRetCode: number) => void;
}): JSX.Element {
  // TransferDataToWindow(), once, as the dialog is shown.
  const [nameText] = useState(() => dlg.TransferDataToWindow());

  return (
    <EdaListDialog
      title={dlg.title}
      headers={dlg.headers}
      rows={dlg.items.map((item) => ({ value: LibraryRowValue(item[0]), cells: item }))}
      preselectText={dlg.selection}
      listLabel={dlg.listLabel}
      okLabel={dlg.okLabel}
      // No wxTextValidator on m_symbolNameCtrl: getSymbolName() escapes what was typed.
      nameRow={{ label: _('Name:'), value: nameText, excludeChars: '' }}
      extraCheckboxes={
        dlg.flattenLabel === null
          ? []
          : [{ label: dlg.flattenLabel, value: dlg.m_params.m_FlattenSymbol }]
      }
      extraButton={{ id: SAVE_AS_IDS.ID_MAKE_NEW_LIBRARY, label: _('New Library...') }}
      transferDataFromWindow={(aValue, aName, aExtras) =>
        dlg.TransferDataFromWindow(
          aName ?? '',
          aValue ?? '',
          aExtras.checkboxes[0] ?? dlg.m_params.m_FlattenSymbol,
        )
      }
      onResult={(aValue, _aName, aExtras) => {
        if (aExtras?.button !== undefined) onClose(aExtras.button);
        else onClose(aValue === null && !aExtras ? wxID_CANCEL : wxID_OK);
      }}
    />
  );
}
