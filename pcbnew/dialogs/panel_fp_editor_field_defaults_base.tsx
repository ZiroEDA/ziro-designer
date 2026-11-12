// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_EDITOR_FIELD_DEFAULTS_BASE` (pcbnew/dialogs/panel_fp_editor_field_defaults_base.cpp):
 * the footprint editor's Footprint Defaults page - the reference / value field grid, then the
 * default text items grid with its add and delete buttons. The behaviour is
 * PANEL_FP_EDITOR_FIELD_DEFAULTS's (panel_fp_editor_field_defaults.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { StaticText } from '@ziroeda/wx/controls.js';
import {
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

export interface PANEL_FP_EDITOR_FIELD_DEFAULTS_BASE_PROPS {
  m_fieldPropsGrid: ReactNode;
  m_textItemsGrid: ReactNode;
  onAddTextItem: () => void;
  onDeleteTextItem: () => void;
}

export function PANEL_FP_EDITOR_FIELD_DEFAULTS_BASE(
  p: PANEL_FP_EDITOR_FIELD_DEFAULTS_BASE_PROPS,
): JSX.Element {
  return (
    // bSizerMain
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* bSizerMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={8}>
            <StaticText label={_('Default Field Properties for New Footprints')} />
          </SizerItem>
          <Spacer width={0} height={4} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxEXPAND} border={5}>
            {/* defaultFieldPropertiesSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND} border={5}>
                {p.m_fieldPropsGrid}
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={5} height={25} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxLEFT | wxEXPAND} border={8}>
            <StaticText label={_('Default Text Items for New Footprints')} />
          </SizerItem>
          <Spacer width={0} height={4} flag={wxEXPAND} border={5} />
          <SizerItem proportion={1} flag={wxEXPAND} border={20}>
            {/* defaultTextItemsSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={5} minSize={[-1, 140]}>
                {p.m_textItemsGrid}
              </SizerItem>
              <SizerItem flag={wxEXPAND} border={5}>
                {/* bButtonSize */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxBOTTOM | wxLEFT | wxTOP} border={5} minSize={[30, 29]}>
                    <StdBitmapButton
                      bitmap="small_plus"
                      title={_('Add text item')}
                      tooltip={null}
                      onClick={p.onAddTextItem}
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
                      title={_('Delete text item')}
                      tooltip={null}
                      onClick={p.onDeleteTextItem}
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
