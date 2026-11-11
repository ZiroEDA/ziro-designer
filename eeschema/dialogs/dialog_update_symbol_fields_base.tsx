// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_UPDATE_SYMBOL_FIELDS_BASE` (eeschema/dialogs/dialog_update_symbol_fields_base.cpp): the
 * sizer tree, Add() for Add() - the parent symbol's name, the fields to update with Select All /
 * Select None, the update options, and OK / Cancel. The behaviour is
 * DIALOG_UPDATE_SYMBOL_FIELDS's.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { CheckListBox } from '@ziroeda/wx/checklst.js';
import { Button, type CHECK, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import {
  BoxSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_UPDATE_SYMBOL_FIELDS_BASE_PROPS {
  /** m_parentSymbolReadOnly's value. */
  m_parentSymbolReadOnly: string;
  /** m_fieldsBox's rows and their checks. */
  fields: readonly string[];
  fieldsChecked: readonly boolean[];
  onCheckField: (aIndex: number, aOn: boolean) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  m_removeExtraBox: CHECK;
  m_resetEmptyFields: CHECK;
  m_resetFieldText: CHECK;
  m_resetFieldVisibilities: CHECK;
  m_resetFieldEffects: CHECK;
  m_resetFieldPositions: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_UPDATE_SYMBOL_FIELDS_BASE(
  p: DIALOG_UPDATE_SYMBOL_FIELDS_BASE_PROPS,
): JSX.Element {
  const opt = (c: CHECK, aLabel: string, aTitle?: string) => (
    <SizerItem flag={wxBOTTOM | wxRIGHT} border={4}>
      <CheckBox label={aLabel} title={aTitle} check={c} />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Update Symbol Fields')} onClose={p.onCancel}>
      {/* m_mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* m_newIdSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxLEFT} border={5}>
              <StaticText label={_('Parent symbol:')} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              {/* wxTE_READONLY, Enable( false ) */}
              <TextCtrl value={p.m_parentSymbolReadOnly} onChange={() => {}} readOnly disabled />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bSizerUpdate */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={8}>
              {/* m_updateFieldsSizer */}
              <StaticBoxSizer label={_('Update/reset Fields')} orient={wxVERTICAL}>
                <SizerItem
                  proportion={1}
                  flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                  border={5}
                  minSize={[-1, 120]}
                >
                  {/* m_fieldsBox: wxCheckListBox, wxLB_NEEDED_SB, SetMinSize( -1,120 ) [data] */}
                  <CheckListBox
                    items={p.fields}
                    checked={p.fieldsChecked}
                    onCheck={p.onCheckField}
                    ariaLabel={_('Update/reset Fields')}
                  />
                </SizerItem>
                <SizerItem flag={wxEXPAND} border={5}>
                  {/* m_selBtnSizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <Button label={_('Select All')} onClick={p.onSelectAll} />
                    </SizerItem>
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <Button label={_('Select None')} onClick={p.onSelectNone} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={8}>
              {/* m_updateOptionsSizer */}
              <StaticBoxSizer label={_('Update Options')} orient={wxVERTICAL}>
                {opt(
                  p.m_removeExtraBox,
                  _('Remove fields if not in parent symbol'),
                  _('Removes fields that do not occur in the original library symbols'),
                )}
                {opt(p.m_resetEmptyFields, _('Reset fields if empty in parent symbol'))}
                <Spacer width={0} height={15} flag={wxEXPAND} border={5} />
                {opt(p.m_resetFieldText, _('Update/reset field text'))}
                {opt(p.m_resetFieldVisibilities, _('Update/reset field visibilities'))}
                {opt(p.m_resetFieldEffects, _('Update/reset field sizes and styles'))}
                {opt(p.m_resetFieldPositions, _('Update/reset field positions'))}
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* m_sdbSizer: OK, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
