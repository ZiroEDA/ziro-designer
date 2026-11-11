// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_ZONES_BASE` (pcbnew/dialogs/panel_setup_zones_base.cpp): the heading and its rule.
 * PANEL_SETUP_ZONES Add()s the shared PANEL_ZONE_PROPERTIES under them, proportion 1, no flags.
 */
import type { JSX, ReactNode } from 'react';
import { StaticLine, StaticText } from '@ziroeda/wx/controls.js';
import { wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_SETUP_ZONES_BASE_PROPS {
  /** m_panelZoneProperties, which the class adds to m_mainSizer. */
  m_panelZoneProperties: ReactNode;
}

export function PANEL_SETUP_ZONES_BASE(p: PANEL_SETUP_ZONES_BASE_PROPS): JSX.Element {
  return (
    // m_mainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={13}>
        <StaticText label={_('Default Properties for New Zones')} />
      </SizerItem>
      <Spacer width={0} height={2} border={5} />
      <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
        <StaticLine />
      </SizerItem>
      <SizerItem proportion={1} border={5}>
        {p.m_panelZoneProperties}
      </SizerItem>
    </BoxSizer>
  );
}
