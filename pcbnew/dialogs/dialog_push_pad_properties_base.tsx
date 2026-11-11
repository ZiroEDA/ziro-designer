// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PUSH_PAD_PROPERTIES_BASE` (pcbnew/dialogs/dialog_push_pad_properties_base.cpp): the
 * sizer tree, Add() for Add(). The members are props; the behaviour is
 * DIALOG_PUSH_PAD_PROPERTIES's (dialog_push_pad_properties.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHECK, CheckBox } from '@ziroeda/wx/controls.js';
import { wxALL, wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, StaticBoxSizer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_PUSH_PAD_PROPERTIES_BASE_PROPS {
  title: string;
  m_Pad_Shape_Filter_CB: CHECK;
  m_Pad_Layer_Filter_CB: CHECK;
  m_Pad_Orient_Filter_CB: CHECK;
  m_Pad_Type_Filter_CB: CHECK;
  /** SetupStandardButtons' labels for wxID_OK and wxID_APPLY. */
  okLabel: string;
  applyLabel: string;
  /** `m_sdbSizer1Apply->Show( false )` in the footprint editor. */
  applyShown: boolean;
  /** wxID_OK and wxID_APPLY are both PadPropertiesAccept. */
  onOK: () => void;
  onApply: () => void;
  onCancel: () => void;
}

export function DIALOG_PUSH_PAD_PROPERTIES_BASE(
  p: DIALOG_PUSH_PAD_PROPERTIES_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          {/* bLeftSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              <StaticBoxSizer label={_('Options')} orient={wxVERTICAL}>
                <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox
                    label={_('Do not modify pads having a different shape')}
                    check={p.m_Pad_Shape_Filter_CB}
                  />
                </SizerItem>
                <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox
                    label={_('Do not modify pads having different layers')}
                    check={p.m_Pad_Layer_Filter_CB}
                  />
                </SizerItem>
                <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox
                    label={_('Do not modify pads having a different orientation')}
                    check={p.m_Pad_Orient_Filter_CB}
                  />
                </SizerItem>
                <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox
                    label={_('Do not modify pads having a different type')}
                    check={p.m_Pad_Type_Filter_CB}
                  />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer
            onOk={p.onOK}
            okLabel={p.okLabel}
            onApply={p.applyShown ? p.onApply : undefined}
            applyLabel={p.applyLabel}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
