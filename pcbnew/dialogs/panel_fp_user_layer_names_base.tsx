// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_USER_LAYER_NAMES_BASE` (pcbnew/dialogs/panel_fp_user_layer_names_base.cpp): the
 * footprint editor's User layers count (0 to 9), then the Layer / Name grid with its add and delete
 * buttons. The behaviour is PANEL_FP_USER_LAYER_NAMES's (panel_fp_user_layer_names.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { type CHOICE, Choice, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_FP_USER_LAYER_NAMES_BASE_PROPS {
  m_choiceUserLayers: CHOICE;
  m_layerNamesGrid: ReactNode;
  onAddLayerItem: () => void;
  onDeleteLayerItem: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function PANEL_FP_USER_LAYER_NAMES_BASE(
  p: PANEL_FP_USER_LAYER_NAMES_BASE_PROPS,
): JSX.Element {
  return (
    // bSizerMain
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* bSizerMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT | wxEXPAND} border={8}>
            {/* bSizerUserLayerCount */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={CV | wxRIGHT} border={5}>
                <StaticText label={_('User layers:')} />
              </SizerItem>
              <SizerItem flag={CV} border={5}>
                <Choice
                  choices={['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']}
                  choice={p.m_choiceUserLayers}
                  ariaLabel="User layers"
                />
              </SizerItem>
              <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxLEFT | wxEXPAND} border={8}>
            <StaticText label={_('User Layer Names')} />
          </SizerItem>
          <Spacer width={0} height={4} flag={wxEXPAND} border={5} />
          <SizerItem proportion={1} flag={wxEXPAND} border={20}>
            {/* layerNamesSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={5} minSize={[-1, 140]}>
                {p.m_layerNamesGrid}
              </SizerItem>
              <SizerItem flag={wxEXPAND} border={5}>
                {/* bButtonSize */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxBOTTOM | wxLEFT | wxTOP} border={5} minSize={[30, 29]}>
                    <StdBitmapButton
                      bitmap="small_plus"
                      title="Add layer"
                      tooltip={null}
                      onClick={p.onAddLayerItem}
                    />
                  </SizerItem>
                  <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
                  <SizerItem
                    flag={wxBOTTOM | wxLEFT | wxRIGHT | wxTOP}
                    border={5}
                    minSize={[30, 29]}
                  >
                    <StdBitmapButton
                      bitmap="small_trash"
                      title="Delete layer"
                      tooltip={null}
                      onClick={p.onDeleteLayerItem}
                    />
                  </SizerItem>
                  <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                </BoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
