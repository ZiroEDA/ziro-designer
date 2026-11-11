// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS_BASE`
 * (pcbnew/dialogs/dialog_global_edit_tracks_and_vias_base.cpp): the sizer tree, Add() for Add().
 * The members are props; the behaviour is DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS's
 * (dialog_global_edit_tracks_and_vias.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type NetInfoList, NetSelector } from '@ziroeda/common/widgets/net_selector.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  RadioButton,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import { type CHECK_STATE, TriStateCheck } from '@ziroeda/wx/wx_checkbox.js';
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
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A wxChoice: its strings, the selection and Enable(). */
export interface CHOICE_FIELD {
  items: readonly string[];
  choice: CHOICE;
}

/** A UNIT_BINDER over a wxTextCtrl, with its unit text. */
export interface UNIT_FIELD {
  value: string;
  units: string;
  onChange: (aText: string) => void;
}

/** A PCB_LAYER_BOX_SELECTOR: its rows, the one shown, and Enable(). */
export interface LAYER_BOX {
  rows: readonly ComboOption[];
  value: string;
  enabled?: boolean;
  onChange: (aLayer: string) => void;
}

export interface DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS_BASE_PROPS {
  m_tracks: CHECK;
  /** `m_vias`, wxCHK_3STATE: null is the third state. */
  m_vias: { value: CHECK_STATE; onChange: (aValue: CHECK_STATE) => void };
  m_throughVias: CHECK;
  m_microVias: CHECK;
  m_blindVias: CHECK;
  m_buriedVias: CHECK;
  m_netFilterOpt: CHECK;
  m_netFilter: { netInfo: NetInfoList; netcode: number; onChange: (aNetcode: number) => void };
  m_netclassFilterOpt: CHECK;
  m_netclassFilter: CHOICE_FIELD;
  m_layerFilterOpt: CHECK;
  m_layerFilter: LAYER_BOX;
  m_filterByTrackWidth: CHECK;
  m_trackWidthFilter: UNIT_FIELD;
  m_filterByViaSize: CHECK;
  m_viaSizeFilter: UNIT_FIELD;
  m_selectedItemsFilter: CHECK;
  m_setToSpecifiedValues: { value: boolean; onSelect: (aSpecified: boolean) => void };
  m_layerCtrl: LAYER_BOX;
  m_trackWidthCtrl: CHOICE_FIELD;
  m_viaSizesCtrl: CHOICE_FIELD;
  m_annularRingsCtrl: CHOICE_FIELD;
  m_protectionFeatures: CHOICE_FIELD;
  onOK: () => void;
  /** wxID_APPLY: wxDialog's default, Validate() and TransferDataFromWindow() without closing. */
  onApply: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;
const BRL = wxBOTTOM | wxRIGHT | wxLEFT;
const RL = wxRIGHT | wxLEFT;

export function DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS_BASE(
  p: DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS_BASE_PROPS,
): JSX.Element {
  const choice = (c: CHOICE_FIELD, aName: string, aTitle?: string): JSX.Element => (
    <Choice choices={c.items} choice={c.choice} ariaLabel={aName} title={aTitle} />
  );
  const layerBox = (l: LAYER_BOX, aName: string): JSX.Element => (
    <Combo
      value={l.value}
      options={l.rows}
      onChange={l.onChange}
      disabled={l.enabled === false}
      ariaLabel={aName}
    />
  );
  const size = (f: UNIT_FIELD, aName: string): JSX.Element => (
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={CV} border={5}>
        <TextCtrl value={f.value} onChange={f.onChange} ariaLabel={aName} />
      </SizerItem>
      <SizerItem flag={CV | RL} border={5}>
        <StaticText label={f.units} />
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={_('Set Track and Via Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | RL} border={10}>
              <StaticBoxSizer label={_('Scope')} orient={wxVERTICAL}>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Tracks')} check={p.m_tracks} />
                </SizerItem>
                <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
                <SizerItem flag={BRL} border={5}>
                  <TriStateCheck
                    label={_('Vias')}
                    value={p.m_vias.value}
                    onChange={p.m_vias.onChange}
                  />
                </SizerItem>
                <SizerItem flag={wxLEFT} border={20}>
                  <CheckBox label={_('Through vias')} check={p.m_throughVias} />
                </SizerItem>
                <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxLEFT} border={20}>
                  <CheckBox label={_('Microvias')} check={p.m_microVias} />
                </SizerItem>
                <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxLEFT} border={20}>
                  <CheckBox label={_('Blind vias')} check={p.m_blindVias} />
                </SizerItem>
                <Spacer width={0} height={3} flag={wxLEFT} border={20} />
                <SizerItem flag={wxLEFT} border={20}>
                  <CheckBox label={_('Buried vias')} check={p.m_buriedVias} />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={2} flag={wxEXPAND | wxTOP | RL} border={10}>
              <StaticBoxSizer label={_('Filter Items')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
                  {/* fgSizer3 = wxFlexGridSizer( 0, 2, 3, 0 ) */}
                  <FlexGridSizer cols={2} vgap={3} hgap={0} growableCols={[1]}>
                    <SizerItem flag={CV | RL} border={5}>
                      <CheckBox label={_('Filter items by net:')} check={p.m_netFilterOpt} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
                      <NetSelector
                        netInfo={p.m_netFilter.netInfo}
                        netcode={p.m_netFilter.netcode}
                        onChange={p.m_netFilter.onChange}
                      />
                    </SizerItem>
                    <SizerItem flag={CV | RL} border={5}>
                      <CheckBox
                        label={_('Filter items by net class:')}
                        check={p.m_netclassFilterOpt}
                      />
                    </SizerItem>
                    <SizerItem flag={CV | wxEXPAND | wxRIGHT} border={5}>
                      {choice(p.m_netclassFilter, 'Net class filter')}
                    </SizerItem>
                    <Spacer width={0} height={7} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={CV | RL} border={5}>
                      <CheckBox label={_('Filter items by layer:')} check={p.m_layerFilterOpt} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | CV | wxRIGHT} border={5}>
                      {layerBox(p.m_layerFilter, 'Layer filter')}
                    </SizerItem>
                    <Spacer width={0} height={7} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={RL | CV} border={5}>
                      <CheckBox
                        label={_('Filter tracks by width:')}
                        check={p.m_filterByTrackWidth}
                      />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {size(p.m_trackWidthFilter, 'Track width filter')}
                    </SizerItem>
                    <SizerItem flag={CV | RL} border={5}>
                      <CheckBox label={_('Filter vias by diameter:')} check={p.m_filterByViaSize} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | CV} border={5}>
                      {size(p.m_viaSizeFilter, 'Via diameter filter')}
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
                <Spacer width={0} height={5} border={5} />
                <SizerItem flag={wxALL} border={5}>
                  <CheckBox label={_('Selected items only')} check={p.m_selectedItemsFilter} />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | RL} border={10}>
          <StaticBoxSizer label={_('Action')} orient={wxVERTICAL}>
            <SizerItem border={5}>
              <RadioButton
                label={_('Set to specified values:')}
                name="m_action"
                checked={p.m_setToSpecifiedValues.value}
                onChange={() => p.m_setToSpecifiedValues.onSelect(true)}
              />
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT} border={25}>
              {/* fgSizerTrackViaPopups = wxFlexGridSizer( 5, 2, 0, 10 ) */}
              <FlexGridSizer cols={2} vgap={0} hgap={10} growableCols={[1]}>
                <SizerItem flag={CV | wxTOP | wxBOTTOM} border={5}>
                  <StaticText label={_('Layer:')} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | CV | wxALL} border={5}>
                  {layerBox(p.m_layerCtrl, 'Layer')}
                </SizerItem>
                <SizerItem flag={CV | wxBOTTOM} border={5}>
                  <StaticText label={_('Track width:')} />
                </SizerItem>
                <SizerItem proportion={4} flag={wxEXPAND | CV | BRL} border={5}>
                  {choice(p.m_trackWidthCtrl, _HKI('Track width'))}
                </SizerItem>
                <SizerItem flag={CV | wxBOTTOM | wxRIGHT} border={5}>
                  <StaticText label={_('Via size:')} />
                </SizerItem>
                <SizerItem flag={CV | wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
                  {choice(p.m_viaSizesCtrl, 'Via size')}
                </SizerItem>
                <SizerItem flag={CV | wxRIGHT} border={15}>
                  <StaticText label={_('Via annular rings:')} />
                </SizerItem>
                <SizerItem flag={CV | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
                  {choice(p.m_annularRingsCtrl, 'Via annular rings')}
                </SizerItem>
                <SizerItem flag={CV | wxTOP | wxBOTTOM} border={5}>
                  <StaticText label={_('Via protection features:')} />
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  {choice(
                    p.m_protectionFeatures,
                    'Via protection features',
                    _('Select which protection feature according to IPC-4761 the via should have.'),
                  )}
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem flag={wxBOTTOM} border={5}>
              <RadioButton
                label={_('Set to net class / custom rule values')}
                name="m_action"
                checked={!p.m_setToSpecifiedValues.value}
                onChange={() => p.m_setToSpecifiedValues.onSelect(false)}
              />
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StdDialogButtonSizer
            okLabel={_('Apply and Close')}
            onOk={p.onOK}
            onApply={p.onApply}
            cancelLabel={_('Close')}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
