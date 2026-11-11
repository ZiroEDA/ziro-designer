// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_TEXT_AND_GRAPHICS_BASE` (pcbnew/dialogs/panel_setup_text_and_graphics_base.cpp):
 * the heading, its rule and m_grid, the six layer classes by line and text properties. The first
 * of the three panels on Board Setup's Defaults page; the behaviour is
 * PANEL_SETUP_TEXT_AND_GRAPHICS's (panel_setup_text_and_graphics.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { StaticLine, StaticText } from '@ziroeda/wx/controls.js';
import { wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_SETUP_TEXT_AND_GRAPHICS_BASE_PROPS {
  m_grid: ReactNode;
}

export function PANEL_SETUP_TEXT_AND_GRAPHICS_BASE(
  p: PANEL_SETUP_TEXT_AND_GRAPHICS_BASE_PROPS,
): JSX.Element {
  return (
    // m_mainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* m_gridSizer */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={13}>
            <StaticText label={_('Default Properties for New Graphics and Text')} />
          </SizerItem>
          <Spacer width={0} height={2} border={5} />
          <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
            <StaticLine />
          </SizerItem>
          <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
          <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
            {/* bMargins */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxBOTTOM} border={15}>
                {p.m_grid}
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
