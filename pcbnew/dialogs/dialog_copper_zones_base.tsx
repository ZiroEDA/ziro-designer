// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_COPPER_ZONE_BASE` (pcbnew/dialogs/dialog_copper_zones_base.cpp): the sizer tree, Add() for
 * Add(). The members are props; the behaviour is DIALOG_COPPER_ZONE's (dialog_copper_zones.tsx),
 * which Insert()s the conversion box at the top and Add()s its PANEL_ZONE_PROPERTIES to
 * m_sizerRight.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Button, StaticText } from '@ziroeda/wx/controls.js';
import { type DATAVIEW_TOGGLE_ROW, DataViewListCtrl } from '@ziroeda/wx/dataview_ui.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_COPPER_ZONE_BASE_PROPS {
  title: string;
  /** `GetSizer()->Insert( 0, bConvertSizer, 0, wxALL|wxEXPAND, 10 )`, when converting. */
  conversionBox: ReactNode | null;
  /** `m_layers`, filled by ZONE_SETTINGS::SetupLayersList. */
  m_layers: readonly DATAVIEW_TOGGLE_ROW[];
  OnLayerSelection: (aRow: number, aOn: boolean) => void;
  /** `m_sizerRight`: the PANEL_ZONE_PROPERTIES. */
  m_sizerRight: ReactNode;
  /** `m_openZoneManager->Hide()` for a zone still in creation. */
  zoneManagerShown: boolean;
  /** Greyed while nothing would open the Zone Manager. */
  zoneManagerEnabled: boolean;
  onZoneManager: () => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_COPPER_ZONE_BASE(p: DIALOG_COPPER_ZONE_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* m_MainBoxSizer */}
      <BoxSizer orient={wxVERTICAL}>
        {p.conversionBox !== null && (
          <SizerItem flag={wxALL | wxEXPAND} border={10}>
            {p.conversionBox}
          </SizerItem>
        )}
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
          {/* bMainSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bSizerLeft */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={7}>
                  <StaticText label={_('Layers:')} />
                </SizerItem>
                <Spacer width={0} height={2} flag={wxEXPAND} border={5} />
                <SizerItem
                  proportion={1}
                  flag={wxEXPAND | wxRIGHT | wxLEFT}
                  border={5}
                  minSize={[180, -1]}
                >
                  {/* wxDV_NO_HEADER | wxBORDER_SIMPLE */}
                  <DataViewListCtrl
                    rows={p.m_layers}
                    onToggle={p.OnLayerSelection}
                    ariaLabel="Layers"
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer width={5} height={0} flag={wxEXPAND} border={5} />
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT} border={5}>
              {/* m_sizerRight */}
              <BoxSizer orient={wxVERTICAL}>{p.m_sizerRight}</BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
          {/* bSizerbottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5} shown={p.zoneManagerShown}>
              <Button
                label={_('Open Zone Manager...')}
                disabled={!p.zoneManagerEnabled}
                onClick={p.onZoneManager}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
