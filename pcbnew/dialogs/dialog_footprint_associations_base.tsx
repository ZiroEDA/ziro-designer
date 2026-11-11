// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FOOTPRINT_ASSOCIATIONS_BASE` (pcbnew/dialogs/dialog_footprint_associations_base.cpp):
 * the sizer tree, Add() for Add(). The two WX_GRIDs are the derived class's members; the
 * behaviour is DIALOG_FOOTPRINT_ASSOCIATIONS's (dialog_footprint_associations.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { BoxSizer, SizerItem, Spacer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_FOOTPRINT_ASSOCIATIONS_BASE_PROPS {
  m_gridLibrary: WX_GRID;
  m_gridSymbol: WX_GRID;
  onOK: () => void;
}

/** `SetColSize( 0, 100 )`, `( 1, 280 )`, `( 2, 360 )` on both grids. */
const COLUMNS = [{ width: 100 }, { width: 280 }, { width: 360 }];

export function DIALOG_FOOTPRINT_ASSOCIATIONS_BASE(
  p: DIALOG_FOOTPRINT_ASSOCIATIONS_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Footprint Associations')} onClose={p.onOK}>
      {/* bMainBoxSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={10}>
          {/* SetFont( KIUI::GetStatusFont( this ) ): the GUI font on GTK */}
          <StaticText label={_('Library Association')} />
        </SizerItem>
        <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={10}>
          {/* SetMaxSize( wxSize( -1,300 ) ), no labels, no grid lines */}
          <WxGridView
            grid={p.m_gridLibrary}
            columns={COLUMNS}
            rowLabels={false}
            colLabels={false}
            ariaLabel="Library association"
          />
        </SizerItem>
        <Spacer width={0} height={5} proportion={1} flag={wxEXPAND} border={5} />
        <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={10}>
          <StaticText label={_('Schematic Association')} />
        </SizerItem>
        <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
        <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={10}>
          <WxGridView
            grid={p.m_gridSymbol}
            columns={COLUMNS}
            rowLabels={false}
            colLabels={false}
            ariaLabel="Schematic association"
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bSizerBottom > m_sdbControlSizer: wxID_OK alone, the dialog never writes */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxBOTTOM | wxLEFT | wxRIGHT | wxTOP} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
