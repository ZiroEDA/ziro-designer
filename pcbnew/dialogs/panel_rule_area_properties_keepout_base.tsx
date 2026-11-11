// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_RULE_AREA_PROPERTIES_KEEPOUT_BASE` (pcbnew/dialogs/panel_rule_area_properties_keepout_base.cpp):
 * the Rule Area dialog's "Keepouts" page. Upstream has no derived class: DIALOG_RULE_AREA_PROPERTIES
 * reads and writes these members itself.
 */
import type { JSX } from 'react';
import { type CHECK, CheckBox } from '@ziroeda/wx/controls.js';
import { wxEXPAND, wxLEFT, wxRIGHT } from '@ziroeda/wx/defs.js';
import { FlexGridSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_RULE_AREA_PROPERTIES_KEEPOUT_BASE_PROPS {
  m_cbTracksCtrl: CHECK;
  m_cbViasCtrl: CHECK;
  m_cbPadsCtrl: CHECK;
  m_cbCopperPourCtrl: CHECK;
  m_cbFootprintsCtrl: CHECK;
}

const RL = wxRIGHT | wxLEFT;

export function PANEL_RULE_AREA_PROPERTIES_KEEPOUT_BASE(
  p: PANEL_RULE_AREA_PROPERTIES_KEEPOUT_BASE_PROPS,
): JSX.Element {
  return (
    // m_keepoutRuleSizer = wxFlexGridSizer( 0, 1, 3, 0 )
    <FlexGridSizer cols={1} vgap={3} hgap={0}>
      <SizerItem flag={wxEXPAND | RL} border={5}>
        <CheckBox
          label={_('Keep out tracks')}
          check={p.m_cbTracksCtrl}
          title={_('Prevent tracks from routing into this area')}
        />
      </SizerItem>
      <SizerItem flag={wxEXPAND | RL} border={5}>
        <CheckBox
          label={_('Keep out vias')}
          check={p.m_cbViasCtrl}
          title={_('Prevent vias from being placed in this area')}
        />
      </SizerItem>
      <SizerItem flag={RL} border={5}>
        <CheckBox
          label={_('Keep out pads')}
          check={p.m_cbPadsCtrl}
          title={_('Raise a DRC error if a pad overlaps this area')}
        />
      </SizerItem>
      <SizerItem flag={wxEXPAND | RL} border={5}>
        <CheckBox
          label={_('Keep out zone fills')}
          check={p.m_cbCopperPourCtrl}
          title={_('Zones will not fill copper into this area')}
        />
      </SizerItem>
      <SizerItem flag={RL} border={5}>
        <CheckBox
          label={_('Keep out footprints')}
          check={p.m_cbFootprintsCtrl}
          title={_('Raise a DRC error if a footprint courtyard overlaps this area')}
        />
      </SizerItem>
    </FlexGridSizer>
  );
}
