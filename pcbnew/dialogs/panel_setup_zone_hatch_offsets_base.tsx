// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_ZONE_HATCH_OFFSETS_BASE` (pcbnew/dialogs/panel_setup_zone_hatch_offsets_base.cpp):
 * the panel's sizer tree, Add() for Add(). A Board Setup page; m_layerOffsetsGrid is the
 * Layer / X Offset / Y Offset WX_GRID the class fills.
 */
import type { JSX, ReactNode } from 'react';
import { StaticLine, StaticText } from '@ziroeda/wx/controls.js';
import { wxALL, wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_SETUP_ZONE_HATCH_OFFSETS_BASE_PROPS {
  m_layerOffsetsGrid: ReactNode;
}

export function PANEL_SETUP_ZONE_HATCH_OFFSETS_BASE(
  p: PANEL_SETUP_ZONE_HATCH_OFFSETS_BASE_PROPS,
): JSX.Element {
  return (
    // mainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={13}>
        <StaticText label={_('Zone Hatched Fill Offsets')} />
      </SizerItem>
      <Spacer width={0} height={2} border={5} />
      <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
        <StaticLine />
      </SizerItem>
      <SizerItem flag={wxALL} border={5}>
        {p.m_layerOffsetsGrid}
      </SizerItem>
    </BoxSizer>
  );
}
