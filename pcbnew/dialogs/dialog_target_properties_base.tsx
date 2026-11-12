// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TARGET_PROPERTIES_BASE` (pcbnew/dialogs/dialog_target_properties_base.cpp): the sizer
 * tree, Add() for Add(). The members are props; the behaviour is DIALOG_TARGET_PROPERTIES's
 * (dialog_target_properties.tsx).
 */
import type { JSX, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHOICE, Choice, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER: its entry text and units label. */
export interface UNIT {
  value: string;
  units: string;
  onChange: (aText: string) => void;
}

export interface DIALOG_TARGET_PROPERTIES_BASE_PROPS {
  m_Size: UNIT;
  /** `SetInitialFocus( m_sizeCtrl )`. */
  sizeCtrlRef: Ref<HTMLInputElement>;
  m_Thickness: UNIT;
  m_TargetShape: CHOICE;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_TARGET_PROPERTIES_BASE(p: DIALOG_TARGET_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Alignment Target Properties')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND} border={5}>
              {/* fgSizer = wxFlexGridSizer( 0, 3, 0, 0 ) */}
              <FlexGridSizer cols={3} growableCols={[1]}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
                  <StaticText label={_('Size:')} />
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  <TextCtrl
                    value={p.m_Size.value}
                    onChange={p.m_Size.onChange}
                    onEnter={p.onOK}
                    inputRef={p.sizeCtrlRef}
                    ariaLabel="Size"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
                  <StaticText label={p.m_Size.units} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Thickness:')} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <TextCtrl
                    value={p.m_Thickness.value}
                    onChange={p.m_Thickness.onChange}
                    onEnter={p.onOK}
                    ariaLabel="Thickness"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT} border={5}>
                  <StaticText label={p.m_Thickness.units} />
                </SizerItem>
                <SizerItem flag={wxTOP | wxBOTTOM | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Shape:')} />
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  <Choice choices={['+', 'X']} choice={p.m_TargetShape} ariaLabel="Shape" />
                </SizerItem>
                <Spacer proportion={1} flag={wxEXPAND} border={5} />
              </FlexGridSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
