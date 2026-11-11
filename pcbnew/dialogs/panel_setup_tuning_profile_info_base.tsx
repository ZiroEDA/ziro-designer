// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_TUNING_PROFILE_INFO_BASE` (pcbnew/dialogs/panel_setup_tuning_profile_info_base.cpp):
 * one tuning profile - name, type and target impedance, the time-domain switch, and a horizontal
 * splitter (sash at 200) between the track propagation grid and the via propagation half.
 */
import { type JSX, type ReactNode, useState } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
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
import { BoxSizer, FlexGridSizer, GridBagSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { SplitterWindow } from '@ziroeda/wx/splitter.js';
import { _ } from '@ziroeda/wx/translation.js';

type ENTRY = { value: string; onChange: (aText: string) => void; onBlur?: () => void };

export interface PANEL_SETUP_TUNING_PROFILE_INFO_BASE_PROPS {
  m_name: ENTRY;
  m_type: CHOICE;
  m_targetImpedance: ENTRY;
  m_enableDelayTuning: CHECK;
  m_trackPropagationGrid: ReactNode;
  onAddTrackRow: () => void;
  onRemoveTrackRow: () => void;
  m_viaPropagationSpeed: ENTRY;
  /** m_viaPropSpeedUnits: the UNIT_BINDER's LENGTH_DELAY label. */
  viaUnits: string;
  m_viaOverrides: ReactNode;
  onAddViaOverride: () => void;
  onRemoveViaOverride: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function PANEL_SETUP_TUNING_PROFILE_INFO_BASE(
  p: PANEL_SETUP_TUNING_PROFILE_INFO_BASE_PROPS,
): JSX.Element {
  // m_splitter1->SplitHorizontally( …, 200 )
  const [sash, setSash] = useState(200);

  const trackPanel = (
    // bSizerTrackPropagation
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
        <StaticText label={_('Track Propagation')} />
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
        {p.m_trackPropagationGrid}
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bSizer9 */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxBOTTOM | wxLEFT | wxTOP} border={5}>
            <StdBitmapButton
              bitmap="small_plus"
              title="Add track propagation row"
              tooltip={null}
              onClick={p.onAddTrackRow}
            />
          </SizerItem>
          <Spacer width={20} height={0} border={5} />
          <SizerItem flag={wxBOTTOM | wxLEFT | wxTOP} border={5}>
            <StdBitmapButton
              bitmap="small_trash"
              title="Remove track propagation row"
              tooltip={null}
              onClick={p.onRemoveTrackRow}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const viaPanel = (
    // bSizerViaPropagation
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bSizer8 */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxALL | CV} border={5}>
            <StaticText label={_('Via Propagation')} />
          </SizerItem>
          <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={CV | wxTOP | wxBOTTOM | wxLEFT} border={5}>
            <StaticText label={_('Global unit delay:')} />
          </SizerItem>
          <SizerItem flag={wxALL | CV} border={5}>
            <TextCtrl
              value={p.m_viaPropagationSpeed.value}
              onChange={p.m_viaPropagationSpeed.onChange}
              onBlur={p.m_viaPropagationSpeed.onBlur}
              ariaLabel="Global unit delay"
            />
          </SizerItem>
          <SizerItem flag={CV | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StaticText label={p.viaUnits} />
          </SizerItem>
          <Spacer width={50} height={0} proportion={1} flag={wxEXPAND} border={5} />
        </BoxSizer>
      </SizerItem>
      <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
        <StaticText label={_('Via delay overrides:')} />
      </SizerItem>
      <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
        {p.m_viaOverrides}
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bSizer91 */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="small_plus"
              title="Add via delay override"
              tooltip={null}
              onClick={p.onAddViaOverride}
            />
          </SizerItem>
          <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="small_trash"
              title="Remove via delay override"
              tooltip={null}
              onClick={p.onRemoveViaOverride}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    // fgSizer1 = wxFlexGridSizer( 3, 1, 0, 0 ), growing column 0 and row 2
    <FlexGridSizer cols={1} growableCols={[0]} growableRows={[2]}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* fgSizer2 = wxFlexGridSizer( 1, 9, 0, 0 ), growing columns 2 and 5 */}
        <FlexGridSizer cols={9} growableCols={[2, 5]}>
          <SizerItem flag={CV | wxTOP | wxBOTTOM | wxLEFT} border={5}>
            <StaticText label={_('Name:')} />
          </SizerItem>
          <SizerItem flag={wxALL | wxEXPAND | CV} border={5}>
            <TextCtrl value={p.m_name.value} onChange={p.m_name.onChange} ariaLabel="Name" />
          </SizerItem>
          <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={CV | wxTOP | wxBOTTOM | wxLEFT} border={5}>
            <StaticText label={_('Type:')} />
          </SizerItem>
          <SizerItem flag={wxALL | CV} border={5}>
            <Choice choices={[_('Single'), _('Differential')]} choice={p.m_type} ariaLabel="Type" />
          </SizerItem>
          <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxALL | CV} border={5}>
            <StaticText label={_('Target impedance:')} />
          </SizerItem>
          <SizerItem flag={wxEXPAND | CV | wxTOP | wxBOTTOM} border={5}>
            {/* SetMaxLength( 15 ) */}
            <TextCtrl
              value={p.m_targetImpedance.value}
              onChange={p.m_targetImpedance.onChange}
              maxLength={15}
              ariaLabel="Target impedance"
            />
          </SizerItem>
          <SizerItem flag={wxALL | wxRIGHT | CV} border={5}>
            <StaticText label={_('ohms')} />
          </SizerItem>
        </FlexGridSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* gbSizer1, growing column 0 */}
        <GridBagSizer growableCols={[0]}>
          <SizerItem pos={[0, 0]} flag={wxALL} border={5}>
            <CheckBox label={_('Enable time domain tuning')} check={p.m_enableDelayTuning} />
          </SizerItem>
          <SizerItem pos={[1, 0]} span={[1, 2]} flag={wxEXPAND | wxALL} border={5}>
            <StaticLine />
          </SizerItem>
        </GridBagSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        <SplitterWindow
          split="horizontal"
          sashPosition={sash}
          onSashPosition={setSash}
          minimumPaneSize={0}
          window1={trackPanel}
          window2={viaPanel}
        />
      </SizerItem>
    </FlexGridSizer>
  );
}
