// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EDIT_SYMBOLS_LIBID_BASE` (eeschema/dialogs/dialog_edit_symbols_libid_base.cpp): the
 * sizer tree, Add() for Add() - the WX_GRID, then bSizerButtons (Map Orphans, Update symbol fields
 * from new library, a stretch spacer and the standard pair). The behaviour is
 * DIALOG_EDIT_SYMBOLS_LIBID's.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Button, type CHECK, CheckBox } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, StdDialogButtonSizer, StretchSpacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_EDIT_SYMBOLS_LIBID_BASE_PROPS {
  /** m_grid, with the derived dialog's SetMinSize( wxSize( -1, 300 ) ). */
  m_grid: ReactNode;
  m_buttonOrphanItems: { enabled: boolean; onClick: () => void };
  m_checkBoxUpdateFields: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_EDIT_SYMBOLS_LIBID_BASE(
  p: DIALOG_EDIT_SYMBOLS_LIBID_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Symbol Library References')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem
          proportion={1}
          flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
          border={10}
          minSize={[-1, 300]}
        >
          {p.m_grid}
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
          {/* bSizerButtons */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <Button
                label={_('Map Orphans')}
                disabled={!p.m_buttonOrphanItems.enabled}
                title={
                  'If some symbols are orphaned (the linked symbol is not found anywhere),\n' +
                  'try to find a candidate having the same name in one of loaded symbol libraries.'
                }
                onClick={p.m_buttonOrphanItems.onClick}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              <CheckBox
                label={_('Update symbol fields from new library')}
                title={
                  'Replace current symbols fields by fields from the new library.\n' +
                  'Warning: fields "Value" and "Footprints" will be therefore replaced.'
                }
                check={p.m_checkBoxUpdateFields}
              />
            </SizerItem>
            <StretchSpacer />
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
