// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_BOARD_STACKUP_BASE` (pcbnew/board_stackup_manager/panel_board_stackup_base.cpp):
 * the copper count, impedance control and add / remove dielectric row; the scrolled stackup grid;
 * the board thickness, adjust and export row. The grid is the one PANEL_SETUP_BOARD_STACKUP
 * rebuilds: wxFlexGridSizer( 0, 9, 0, 6 ) with its nine titles re-added, then a row per layer
 * from lazyBuildRowUI (panel_board_stackup.tsx).
 */
import type { JSX, ReactNode } from 'react';
import {
  Button,
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  Panel,
  StaticBitmap,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
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
import { ScrolledWindow } from '@ziroeda/wx/scrolwin.js';
import { BoxSizer, FlexGridSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';

/** m_choiceCopperLayersChoices: 2, 4, … 32. */
export const COPPER_LAYER_CHOICES = Array.from({ length: 16 }, (_, i) => String((i + 1) * 2));

export interface PANEL_SETUP_BOARD_STACKUP_BASE_PROPS {
  m_choiceCopperLayers: CHOICE;
  m_impedanceControlled: CHECK;
  onAddDielectricLayer: () => void;
  onRemoveDielectricLayer: () => void;
  removeEnabled: boolean;
  /** The class's SetBitmap( KiBitmapBundle( BITMAPS::locked ) ). */
  lockBitmap: string | undefined;
  /** lazyBuildRowUI's Insert()s: nine cells a row. */
  rows: ReactNode;
  /** m_tcCTValue, wxTE_READONLY, at least m_numericTextCtrlSize. */
  m_tcCTValue: string;
  minWidthText: string;
  onAdjustDielectricThickness: () => void;
  onExportToClipboard: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;
/** The rebuilt titles' `wxALIGN_CENTER_VERTICAL | wxALL | wxALIGN_CENTER_HORIZONTAL`. */
const TITLE = CV | wxALL | wxALIGN_CENTER_HORIZONTAL;

export function PANEL_SETUP_BOARD_STACKUP_BASE(
  p: PANEL_SETUP_BOARD_STACKUP_BASE_PROPS,
): JSX.Element {
  const title = (aLabel: string, aBorder: number) => (
    <SizerItem flag={TITLE} border={aBorder}>
      <StaticText label={aLabel} />
    </SizerItem>
  );
  const COPPER_TIP = wxGetTranslation('Select the number of copper layers in the stackup');

  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxALL} border={5}>
        {/* bTopSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={CV | wxTOP | wxBOTTOM} border={5}>
            <StaticText label={wxGetTranslation('Copper layers:')} title={COPPER_TIP} />
          </SizerItem>
          <SizerItem flag={CV | wxALL} border={5}>
            <Choice
              choices={COPPER_LAYER_CHOICES}
              choice={p.m_choiceCopperLayers}
              ariaLabel={wxGetTranslation('Copper layers')}
              title={COPPER_TIP}
            />
          </SizerItem>
          <Spacer width={40} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxALL | CV} border={5}>
            <CheckBox
              label={wxGetTranslation('Impedance controlled')}
              title={wxGetTranslation(
                'If Impedance Controlled option is set,\nLoss tangent and EpsilonR will be added to constraints.',
              )}
              check={p.m_impedanceControlled}
            />
          </SizerItem>
          <Spacer width={40} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <Button
              label={wxGetTranslation('Add Dielectric Layer...')}
              onClick={p.onAddDielectricLayer}
            />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxALL} border={5}>
            <Button
              label={wxGetTranslation('Remove Dielectric Layer...')}
              onClick={p.onRemoveDielectricLayer}
              disabled={!p.removeEnabled}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem proportion={3} flag={wxEXPAND | wxBOTTOM} border={5}>
        {/* m_sizerStackup */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* m_panel1, a WX_PANEL */}
            <Panel>
              {/* bSizer6 */}
              <BoxSizer orient={wxVERTICAL}>
                <Spacer width={0} height={1} flag={wxEXPAND} border={5} />
                <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={2}>
                  {/* m_scGridWin, wxBORDER_NONE|wxHSCROLL|wxVSCROLL */}
                  <ScrolledWindow>
                    {/* the rebuilt m_fgGridSizer = wxFlexGridSizer( 0, 9, 0, 2 ), SetHGap( 6 ) */}
                    <FlexGridSizer cols={9} hgap={6}>
                      {title(wxGetTranslation('Layer'), 2)}
                      {title(wxGetTranslation('Type'), 2)}
                      {title(wxGetTranslation('Id'), 5)}
                      {title(wxGetTranslation('Material'), 2)}
                      {title(wxGetTranslation('Thickness'), 2)}
                      <SizerItem flag={TITLE} border={1}>
                        <StaticBitmap bitmap={p.lockBitmap} />
                      </SizerItem>
                      {title(wxGetTranslation('Color'), 2)}
                      {title(wxGetTranslation('Epsilon R'), 2)}
                      {title(wxGetTranslation('Loss Tan'), 2)}
                      {p.rows}
                    </FlexGridSizer>
                  </ScrolledWindow>
                </SizerItem>
              </BoxSizer>
            </Panel>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
        {/* bBottomSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={CV} border={5}>
            <StaticText label={wxGetTranslation('Board thickness from stackup:')} />
          </SizerItem>
          <SizerItem flag={wxALL | CV} border={2}>
            <TextCtrl
              value={p.m_tcCTValue}
              readOnly
              minWidthText={p.minWidthText}
              ariaLabel="Board thickness from stackup"
            />
          </SizerItem>
          <Spacer width={10} height={0} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxALL | CV} border={2}>
            <Button
              label={wxGetTranslation('Adjust Dielectric Thickness')}
              onClick={p.onAdjustDielectricThickness}
            />
          </SizerItem>
          <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxBOTTOM | wxRIGHT | CV} border={2}>
            <Button
              label={wxGetTranslation('Export to Clipboard')}
              onClick={p.onExportToClipboard}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
