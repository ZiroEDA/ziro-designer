// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ENUM_PADS_BASE` (pcbnew/dialogs/dialog_enum_pads_base.cpp): the sizer tree, Add() for
 * Add(). The members are props; the behaviour is DIALOG_ENUM_PADS's (dialog_enum_pads.tsx).
 */
import type { JSX, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
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
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_ENUM_PADS_BASE_PROPS {
  title: string;
  m_padPrefix: { value: string; onChange: (aText: string) => void };
  /** `SetInitialFocus( m_padPrefix )`. */
  padPrefixRef: Ref<HTMLInputElement>;
  m_padStartNum: { value: number; onChange: (aValue: number) => void };
  m_padNumStep: { value: number; onChange: (aValue: number) => void };
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_ENUM_PADS_BASE(p: DIALOG_ENUM_PADS_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxALIGN_CENTER_HORIZONTAL} border={5}>
          <StaticText label={_('Pad names are restricted to 4 characters (including number).')} />
        </SizerItem>
        <Spacer flag={wxTOP | wxBOTTOM} border={5} />
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* fgSizer = wxFlexGridSizer( 0, 2, 0, 0 ) */}
          <FlexGridSizer cols={2} growableCols={[1]}>
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <StaticText label={_('Pad name prefix:')} />
            </SizerItem>
            <SizerItem flag={wxALL | wxEXPAND} border={5}>
              <TextCtrl
                value={p.m_padPrefix.value}
                onChange={p.m_padPrefix.onChange}
                onEnter={p.onOK}
                maxLength={4}
                inputRef={p.padPrefixRef}
                ariaLabel="Pad name prefix"
              />
            </SizerItem>
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <StaticText label={_('First pad number:')} />
            </SizerItem>
            <SizerItem flag={wxALL | wxEXPAND} border={5}>
              <SpinCtrl
                value={p.m_padStartNum.value}
                onChange={p.m_padStartNum.onChange}
                min={0}
                max={999}
                ariaLabel="First pad number"
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              <StaticText label={_('Numbering step:')} />
            </SizerItem>
            <SizerItem flag={wxALL | wxEXPAND} border={5}>
              <SpinCtrl
                value={p.m_padNumStep.value}
                onChange={p.m_padNumStep.onChange}
                min={0}
                max={999}
                ariaLabel="Numbering step"
              />
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
