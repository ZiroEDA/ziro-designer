// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_BASE` (pcbnew/dialogs/panel_fp_editor_graphics_defaults_base.cpp):
 * the footprint editor's Default Values page - the heading, its rule and m_graphicsGrid. The class
 * Add()s the shared PANEL_SETUP_DIMENSIONS to the panel's sizer after it.
 */
import type { JSX, ReactNode } from 'react';
import { StaticLine, StaticText } from '@ziroeda/wx/controls.js';
import { wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_BASE_PROPS {
  m_graphicsGrid: ReactNode;
  /** `GetSizer()->Add( m_dimensionsPanel.get(), 0, wxEXPAND, 5 )`. */
  m_dimensionsPanel: ReactNode;
}

export function PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_BASE(
  p: PANEL_FP_EDITOR_GRAPHICS_DEFAULTS_BASE_PROPS,
): JSX.Element {
  return (
    // bSizerMain
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bSizerMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxTOP} border={5}>
            {/* defaultPropertiesSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={8}>
                <StaticText label={_('Default Properties for New Graphic Items')} />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={2}>
                <StaticLine />
              </SizerItem>
              <Spacer width={0} height={7} flag={wxEXPAND} border={5} />
              <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={1}>
                {p.m_graphicsGrid}
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={20} flag={wxEXPAND} border={5} />
        </BoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5}>
        {p.m_dimensionsPanel}
      </SizerItem>
    </BoxSizer>
  );
}
