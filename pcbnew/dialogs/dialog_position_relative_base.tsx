// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_POSITION_RELATIVE_BASE` (pcbnew/dialogs/dialog_position_relative_base.cpp): the sizer tree,
 * Add() for Add(). The members are props; the behaviour is DIALOG_POSITION_RELATIVE's
 * (dialog_position_relative.tsx). The dialog is modeless.
 */
import type { JSX, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import {
  Button,
  type CHECK,
  CheckBox,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_LEFT,
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
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER: its label, text and unit; the entry's focus loss. */
export interface OFFSET_FIELD {
  label: string;
  value: string;
  units: string;
  onChange: (aText: string) => void;
  OnTextFocusLost: () => void;
  inputRef?: Ref<HTMLInputElement>;
}

export interface DIALOG_POSITION_RELATIVE_BASE_PROPS {
  title: string;
  m_referenceInfo: string;
  OnUseUserOriginClick: () => void;
  OnUseGridOriginClick: () => void;
  OnSelectItemClick: () => void;
  OnSelectPointClick: () => void;
  m_xEntry: OFFSET_FIELD;
  m_yEntry: OFFSET_FIELD;
  clearXTip: string;
  clearYTip: string;
  OnClearX: () => void;
  OnClearY: () => void;
  m_polarCoords: CHECK;
  OnOkClick: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_POSITION_RELATIVE_BASE(p: DIALOG_POSITION_RELATIVE_BASE_PROPS): JSX.Element {
  const entry = (f: OFFSET_FIELD, aName: string): JSX.Element => (
    <TextCtrl
      value={f.value}
      onChange={f.onChange}
      onBlur={f.OnTextFocusLost}
      // No wxTE_PROCESS_ENTER: Enter goes on to the default button, OK.
      inputRef={f.inputRef}
      ariaLabel={aName}
    />
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel} modeless>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxALL | wxEXPAND} border={5} minSize={[340, -1]}>
              <StaticText label={p.m_referenceInfo} />
            </SizerItem>
            <Spacer width={0} height={0} flag={wxEXPAND} border={5} />
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
              {/* bSizerButtOpts */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                  <Button label={_('Use Local Origin')} onClick={p.OnUseUserOriginClick} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                  <Button label={_('Use Grid Origin')} onClick={p.OnUseGridOriginClick} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                  <Button
                    label={_('Select Item...')}
                    exactFit
                    title={_(
                      'Click and select a board item.\nThe anchor position will be the position of the selected item.',
                    )}
                    onClick={p.OnSelectItemClick}
                  />
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL} border={5}>
                  <Button label={_('Select Point...')} onClick={p.OnSelectPointClick} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP} border={5}>
              {/* bSizer6 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND} border={10}>
                  <StaticLine />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* fgSizer2 = wxFlexGridSizer( 0, 5, 5, 0 ) */}
          <FlexGridSizer cols={5} vgap={5} hgap={0} growableCols={[1]}>
            <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={p.m_xEntry.label} />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
              {entry(p.m_xEntry, 'Offset X')}
            </SizerItem>
            <SizerItem flag={CV | wxALIGN_LEFT | wxRIGHT} border={5}>
              <StaticText label={p.m_xEntry.units} />
            </SizerItem>
            <Spacer
              width={10}
              height={0}
              proportion={1}
              flag={wxEXPAND | wxRIGHT | wxLEFT}
              border={5}
            />
            <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
              <Button label={_('Reset')} exactFit title={p.clearXTip} onClick={p.OnClearX} />
            </SizerItem>
            <SizerItem flag={CV | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={p.m_yEntry.label} />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
              {entry(p.m_yEntry, 'Offset Y')}
            </SizerItem>
            <SizerItem flag={CV | wxRIGHT} border={5}>
              <StaticText label={p.m_yEntry.units} />
            </SizerItem>
            <Spacer width={10} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
              <Button label={_('Reset')} exactFit title={p.clearYTip} onClick={p.OnClearY} />
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP} border={5}>
          {/* bSizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxLEFT} border={10}>
              <CheckBox label={_('Use polar coordinates')} check={p.m_polarCoords} />
            </SizerItem>
            <Spacer width={40} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxBOTTOM | wxTOP} border={5}>
              <StdDialogButtonSizer onOk={p.OnOkClick} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
