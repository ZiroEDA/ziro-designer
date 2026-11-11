// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMPORT_SYMBOL_SELECT_BASE` (eeschema/dialogs/dialog_import_symbol_select_base.cpp): the
 * sizer tree, Add() for Add(). The behaviour is DIALOG_IMPORT_SYMBOL_SELECT's
 * (dialog_import_symbol_select.tsx).
 */
import type { JSX, ReactNode, RefObject } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { Button, Panel, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { WxSearchCtrl } from '@ziroeda/wx/wx_search_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_IMPORT_SYMBOL_SELECT_BASE_PROPS {
  /** `SetTitle( "Import Symbols from %s" )`. */
  title: string;
  m_searchCtrl: string;
  onFilterTextChanged: (aText: string) => void;
  /** `SetInitialFocus( m_searchCtrl )`. */
  searchRef?: RefObject<HTMLInputElement>;
  /** `m_symbolList`, the wxDataViewListCtrl. */
  m_symbolList: ReactNode;
  onSelectAll: () => void;
  onSelectNone: () => void;
  /** `m_unitChoice`: its strings, the selection, whether it is enabled. */
  unitChoices: readonly string[];
  m_unitChoice: number;
  unitChoiceEnabled: boolean;
  onUnitChanged: (aSelection: number) => void;
  /** `m_previewPanel`'s contents: the SYMBOL_PREVIEW_WIDGET. */
  m_previewPanel: ReactNode;
  m_statusLine: string;
  /** `m_sdbSizerOK`, relabelled "Import", and whether it is enabled. */
  okEnabled: boolean;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_IMPORT_SYMBOL_SELECT_BASE(
  p: DIALOG_IMPORT_SYMBOL_SELECT_BASE_PROPS,
): JSX.Element {
  return (
    // SetSizeHints( wxSize( 600,450 ) ): the dialog's minimum size.
    <DialogShim
      title={p.title}
      onClose={p.onCancel}
      initialFocus={p.searchRef}
      // [data] SetSizeHints( wxSize( 600,450 ) ), dialog_import_symbol_select_base.cpp
      style={{ minWidth: 600, minHeight: 450 }}
    >
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* bContentSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={2} flag={wxEXPAND | wxALL} border={5}>
              {/* bLeftSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                  <WxSearchCtrl
                    value={p.m_searchCtrl}
                    onChange={p.onFilterTextChanged}
                    inputRef={p.searchRef}
                  />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {p.m_symbolList}
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP} border={5}>
                  {/* bButtonsSizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALL} border={5}>
                      <Button label={_('Select All')} onClick={p.onSelectAll} />
                    </SizerItem>
                    <SizerItem flag={wxALL} border={5}>
                      <Button label={_('Select None')} onClick={p.onSelectNone} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={3} flag={wxEXPAND | wxALL} border={5}>
              {/* bRightSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                  {/* bUnitSizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                      <StaticText label={_('Unit:')} disabled={!p.unitChoiceEnabled} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5} minSize={[100, -1]}>
                      <Combo
                        value={String(p.m_unitChoice)}
                        options={p.unitChoices.map((c, i) => ({ value: String(i), label: c }))}
                        onChange={(v) => p.onUnitChanged(Number(v))}
                        disabled={!p.unitChoiceEnabled}
                        ariaLabel="Unit"
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* m_previewPanel, its m_previewSizer */}
                  <Panel>{p.m_previewPanel}</Panel>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
          <StaticText label={p.m_statusLine} />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* m_sdbSizer: OK ("Import"), Cancel */}
          <StdDialogButtonSizer
            onOk={p.onOK}
            okLabel={_('Import')}
            okDisabled={!p.okEnabled}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
