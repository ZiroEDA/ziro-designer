// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_LAYERS_BASE` (pcbnew/dialogs/panel_setup_layers_base.cpp): the Add User Defined
 * Layer button pushed right, a rule, and m_LayersListPanel, a vertical-scrolling window around
 * m_LayersSizer = wxFlexGridSizer( 0, 3, 2, 8 ) growing columns 1 and 2. The base leaves the
 * sizer empty; PANEL_SETUP_LAYERS Add()s a checkbox / name / type row per layer.
 */
import type { JSX, ReactNode } from 'react';
import { Button, StaticLine } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { ScrolledWindow } from '@ziroeda/wx/scrolwin.js';
import { BoxSizer, FlexGridSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_SETUP_LAYERS_BASE_PROPS {
  onAddUserDefinedLayer: () => void;
  /** What the class Add()s to m_LayersSizer, three cells a layer. */
  m_LayersSizer: ReactNode;
}

export function PANEL_SETUP_LAYERS_BASE(p: PANEL_SETUP_LAYERS_BASE_PROPS): JSX.Element {
  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* bSizerMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT} border={5}>
            {/* bSizerLayerCnt */}
            <BoxSizer orient={wxHORIZONTAL}>
              <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT | wxLEFT} border={5}>
                <Button label={_('Add User Defined Layer...')} onClick={p.onAddUserDefinedLayer} />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={5}>
            <StaticLine />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
            {/* m_LayersListPanel, wxTAB_TRAVERSAL|wxVSCROLL */}
            <ScrolledWindow hscroll={false}>
              <FlexGridSizer cols={3} vgap={2} hgap={8} growableCols={[1, 2]}>
                {p.m_LayersSizer}
              </FlexGridSizer>
            </ScrolledWindow>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
