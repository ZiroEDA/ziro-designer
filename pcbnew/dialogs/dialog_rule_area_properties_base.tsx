// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_RULE_AREA_PROPERTIES_BASE` (pcbnew/dialogs/dialog_rule_area_properties_base.cpp): the
 * sizer tree, Add() for Add(). The members are props; the behaviour is
 * DIALOG_RULE_AREA_PROPERTIES's (dialog_rule_area_properties.tsx), which adds the Keepouts and
 * Placement pages to m_areaPropertiesNb and, when converting, Insert()s the conversion box and a
 * wxStaticLine at the top.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import { type DATAVIEW_TOGGLE_ROW, DataViewListCtrl } from '@ziroeda/wx/dataview_ui.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { Notebook, type NotebookPage } from '@ziroeda/wx/notebook_ui.js';
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_RULE_AREA_PROPERTIES_BASE_PROPS {
  title: string;
  /** The conversion box CONVERT_TOOL's dialog Insert()s at 0, with its line at 1. */
  conversionBox: ReactNode | null;
  m_layers: readonly DATAVIEW_TOGGLE_ROW[];
  OnLayerSelection: (aRow: number, aOn: boolean) => void;
  m_tcName: { value: string; onChange: (aText: string) => void };
  m_cbLocked: CHECK;
  /** `m_areaPropertiesNb`: the pages the dialog adds, and the selection. */
  m_areaPropertiesNb: {
    pages: readonly NotebookPage[];
    selection: number;
    onPageChanged: (aPage: number) => void;
  };
  m_OutlineDisplayCtrl: CHOICE;
  m_outlineHatchPitch: { value: string; units: string; onChange: (aText: string) => void };
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_RULE_AREA_PROPERTIES_BASE(
  p: DIALOG_RULE_AREA_PROPERTIES_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        {p.conversionBox !== null && (
          <SizerItem flag={wxALL | wxEXPAND} border={10}>
            {p.conversionBox}
          </SizerItem>
        )}
        {p.conversionBox !== null && (
          <SizerItem flag={wxLEFT | wxRIGHT | wxEXPAND} border={10}>
            <StaticLine />
          </SizerItem>
        )}
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem
              proportion={4}
              flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT}
              border={5}
              minSize={[240, 560]}
            >
              {/* bLayersListSizer, SetMinSize( wxSize( 240,560 ) ) */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL} border={4}>
                  <StaticText label={_('Layers:')} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <DataViewListCtrl
                    rows={p.m_layers}
                    onToggle={p.OnLayerSelection}
                    ariaLabel="Layers"
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={7} flag={wxEXPAND | wxALL} border={5}>
              {/* bSizerRight */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND} border={5}>
                  {/* bSizer6 */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                      <StaticText
                        label={_('Area name:')}
                        title={_('A unique name for this rule area for use in DRC rules')}
                      />
                    </SizerItem>
                    <Spacer width={0} height={2} border={5} />
                    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT | wxEXPAND} border={5}>
                      <TextCtrl
                        value={p.m_tcName.value}
                        onChange={p.m_tcName.onChange}
                        ariaLabel={_('Area name')}
                        title={_('A unique name for this rule area for use in DRC rules')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALL} border={5}>
                      <CheckBox label={_('Locked')} check={p.m_cbLocked} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <Notebook
                    pages={p.m_areaPropertiesNb.pages}
                    selection={p.m_areaPropertiesNb.selection}
                    onPageChanged={p.m_areaPropertiesNb.onPageChanged}
                  />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxALL} border={5}>
                  {/* gbSizer1 = wxGridBagSizer( 3, 3 ), SetEmptyCellSize( wxSize( -1,2 ) ) */}
                  <GridBagSizer vgap={3} hgap={3} emptyCellSize={[-1, 2]}>
                    <SizerItem pos={[2, 0]} flag={CV | wxRIGHT} border={5}>
                      <StaticText label={_('Outline display:')} />
                    </SizerItem>
                    <SizerItem pos={[2, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                      <Choice
                        choices={[_('Line'), _('Hatched'), _('Fully hatched')]}
                        choice={p.m_OutlineDisplayCtrl}
                        ariaLabel={_('Outline display')}
                      />
                    </SizerItem>
                    <SizerItem pos={[3, 0]} flag={CV} border={5}>
                      <StaticText label={_('Outline hatch pitch:')} />
                    </SizerItem>
                    <SizerItem pos={[3, 1]} flag={CV} border={5}>
                      <TextCtrl
                        value={p.m_outlineHatchPitch.value}
                        onChange={p.m_outlineHatchPitch.onChange}
                        ariaLabel={_('Outline hatch pitch')}
                        title={_('Distance between parallel lines used for hatching the area')}
                      />
                    </SizerItem>
                    <SizerItem pos={[3, 2]} flag={CV} border={5}>
                      <StaticText label={p.m_outlineHatchPitch.units} />
                    </SizerItem>
                  </GridBagSizer>
                </SizerItem>
                <Spacer width={0} height={0} flag={wxEXPAND} border={5} />
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
