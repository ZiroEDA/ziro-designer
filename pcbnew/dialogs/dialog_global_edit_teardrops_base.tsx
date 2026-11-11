// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_EDIT_TEARDROPS_BASE` (pcbnew/dialogs/dialog_global_edit_teardrops_base.cpp): the
 * sizer tree, Add() for Add(). The members are props; the behaviour is
 * DIALOG_GLOBAL_EDIT_TEARDROPS's (dialog_global_edit_teardrops.tsx).
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
  HyperlinkCtrl,
  RadioButton,
  StaticBitmap,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_BOTTOM,
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
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { type CHECK3, TriStateCheck } from '@ziroeda/wx/wx_checkbox.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER over a wxTextCtrl: its text and Enable(). */
export interface ENTRY {
  label: string;
  value: string;
  units: string;
  enabled: boolean;
  onChange: (aText: string) => void;
}

/** The radio set of the Action box. */
export type TEARDROP_RADIO = 'remove' | 'removeAll' | 'addDefaults' | 'specified';

export interface DIALOG_GLOBAL_EDIT_TEARDROPS_BASE_PROPS {
  m_pthPads: CHECK;
  m_smdPads: CHECK;
  m_vias: CHECK;
  m_trackToTrack: CHECK;
  m_netFilterOpt: CHECK;
  m_netFilter: {
    netInfo: NetInfoList;
    netcode: number;
    enabled: boolean;
    onChange: (aNetcode: number) => void;
  };
  m_netclassFilterOpt: CHECK;
  m_netclassFilter: { items: readonly string[]; choice: CHOICE };
  m_layerFilterOpt: CHECK;
  m_layerFilter: {
    rows: readonly ComboOption[];
    value: string;
    enabled: boolean;
    onChange: (aLayer: string) => void;
  };
  m_roundPadsFilter: CHECK;
  m_existingFilter: CHECK;
  m_selectedItemsFilter: CHECK;
  action: TEARDROP_RADIO;
  onAction: (aAction: TEARDROP_RADIO) => void;
  addTeardropsLabel: string;
  specifiedValuesLabel: string;
  onBoardSetupLink: () => void;
  m_cbPreferZoneConnection: CHECK3;
  m_cbTeardropsUseNextTrack: CHECK3;
  m_tcHDRatio: ENTRY;
  /** `m_bitmapTeardrop->SetBitmap( KiBitmapBundle( BITMAPS::teardrop_sizes ) )`. */
  m_bitmapTeardrop: string;
  m_tcLenPercent: ENTRY;
  m_tcTdMaxLen: ENTRY;
  m_tcHeightPercent: ENTRY;
  m_tcMaxHeight: ENTRY;
  m_curvedEdges: CHECK3;
  onOK: () => void;
  /** wxID_APPLY: wxDialog's default, Validate() and TransferDataFromWindow() without closing. */
  onApply: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;
const RL = wxRIGHT | wxLEFT;
const BRL = wxBOTTOM | RL;

export function DIALOG_GLOBAL_EDIT_TEARDROPS_BASE(
  p: DIALOG_GLOBAL_EDIT_TEARDROPS_BASE_PROPS,
): JSX.Element {
  const entry = (e: ENTRY, aTitle?: string): JSX.Element => (
    <TextCtrl
      value={e.value}
      onChange={e.onChange}
      disabled={!e.enabled}
      ariaLabel={e.label.replace(/:$/, '')}
      title={aTitle}
    />
  );
  const label = (e: ENTRY, aTitle?: string): JSX.Element => (
    <StaticText label={e.label} disabled={!e.enabled} title={aTitle} />
  );
  /** `%(` *d* ` )`: the base's three static texts, the d italic. */
  const percentOf = (aEnabled: boolean): JSX.Element => (
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={CV} border={5}>
        <StaticText label="%(" disabled={!aEnabled} />
      </SizerItem>
      <SizerItem flag={wxALIGN_BOTTOM} border={1}>
        <StaticText label="d" italic disabled={!aEnabled} />
      </SizerItem>
      <SizerItem flag={CV | wxRIGHT} border={5}>
        <StaticText label=" )" disabled={!aEnabled} />
      </SizerItem>
    </BoxSizer>
  );
  const radio = (aLabel: string, aAction: TEARDROP_RADIO, aTitle?: string): JSX.Element => (
    <RadioButton
      label={aLabel}
      name="m_action"
      checked={p.action === aAction}
      title={aTitle}
      onChange={() => p.onAction(aAction)}
    />
  );

  return (
    <DialogShim title={_('Edit Teardrops')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | RL} border={5}>
              <StaticBoxSizer label={_('Scope')} orient={wxVERTICAL}>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('PTH pads')} check={p.m_pthPads} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('SMD pads')} check={p.m_smdPads} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Vias')} check={p.m_vias} />
                </SizerItem>
                <SizerItem flag={wxALL} border={5}>
                  <CheckBox label={_('Track to track')} check={p.m_trackToTrack} />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={2} flag={wxEXPAND | wxTOP | RL} border={5}>
              <StaticBoxSizer label={_('Filter Items')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* fgSizer3 = wxFlexGridSizer( 0, 2, 5, 0 ) */}
                  <FlexGridSizer cols={2} vgap={5} hgap={0} growableCols={[1]}>
                    <SizerItem flag={CV | RL} border={5}>
                      <CheckBox label={_('Filter items by net:')} check={p.m_netFilterOpt} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
                      <NetSelector
                        netInfo={p.m_netFilter.netInfo}
                        netcode={p.m_netFilter.netcode}
                        disabled={!p.m_netFilter.enabled}
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
                      <Choice
                        choices={p.m_netclassFilter.items}
                        choice={p.m_netclassFilter.choice}
                        ariaLabel="Net class filter"
                      />
                    </SizerItem>
                    <Spacer
                      width={0}
                      height={0}
                      proportion={1}
                      flag={wxEXPAND | wxTOP | wxBOTTOM}
                      border={3}
                    />
                    <Spacer
                      width={0}
                      height={0}
                      proportion={1}
                      flag={wxEXPAND | wxTOP | wxBOTTOM}
                      border={3}
                    />
                    <SizerItem flag={CV | RL} border={5}>
                      <CheckBox label={_('Filter items by layer:')} check={p.m_layerFilterOpt} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | CV | wxRIGHT} border={5}>
                      <Combo
                        value={p.m_layerFilter.value}
                        options={p.m_layerFilter.rows}
                        onChange={p.m_layerFilter.onChange}
                        disabled={!p.m_layerFilter.enabled}
                        ariaLabel="Layer filter"
                      />
                    </SizerItem>
                    <Spacer width={0} height={5} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                  </FlexGridSizer>
                </SizerItem>
                <Spacer width={0} height={5} border={5} />
                <SizerItem flag={RL} border={5}>
                  <CheckBox label={_('Round pads only')} check={p.m_roundPadsFilter} />
                </SizerItem>
                <SizerItem flag={wxTOP | RL} border={5}>
                  <CheckBox label={_('Existing teardrops only')} check={p.m_existingFilter} />
                </SizerItem>
                <SizerItem flag={wxALL} border={5}>
                  <CheckBox label={_('Selected items only')} check={p.m_selectedItemsFilter} />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={5}>
          <StaticBoxSizer label={_('Action')} orient={wxVERTICAL}>
            <SizerItem flag={wxBOTTOM | wxRIGHT} border={10}>
              {radio(
                _('Remove teardrops'),
                'remove',
                _('Remove teardrops according to filtering options'),
              )}
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxRIGHT} border={10}>
              {radio(
                _('Remove all teardrops'),
                'removeAll',
                _('Remove all teardrops, regardless of filtering options'),
              )}
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxBOTTOM} border={15}>
              {/* bSizer12 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} flag={CV} border={5}>
                  {radio(p.addTeardropsLabel, 'addDefaults')}
                </SizerItem>
                <SizerItem proportion={1} flag={CV | RL} border={10}>
                  <HyperlinkCtrl
                    label={_('Edit default values in Board Setup')}
                    onClick={p.onBoardSetupLink}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {radio(p.specifiedValuesLabel, 'specified')}
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxLEFT} border={25}>
              {/* bSizerSpecifiedValues */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxTOP} border={3}>
                  {/* bSizerCols11 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={3}>
                      {/* bSizerLeftCol11 */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
                          <TriStateCheck
                            label={_('Prefer zone connection')}
                            check={p.m_cbPreferZoneConnection}
                            title={_(
                              'Do not create teardrops on tracks connected to pads that are also connected to a copper zone.',
                            )}
                          />
                        </SizerItem>
                        <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
                          <TriStateCheck
                            label={_('Allow teardrops to span two track segments')}
                            check={p.m_cbTeardropsUseNextTrack}
                            title={_(
                              'Allows a teardrop to extend over the first 2 connected track segments if the first track segment is too short to accommodate the best length.',
                            )}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <Spacer width={25} height={0} flag={wxEXPAND} border={5} />
                    <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
                      {/* bSizerRightCol11 */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxEXPAND} border={3}>
                          {/* bSizer39 */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem flag={CV} border={5}>
                              {label(
                                p.m_tcHDRatio,
                                _(
                                  'Max pad/via size to track width ratio to create a teardrop.\n100 always creates a teardrop.',
                                ),
                              )}
                            </SizerItem>
                            <SizerItem flag={RL} border={5}>
                              {entry(
                                p.m_tcHDRatio,
                                _(
                                  'Tracks which are similar in size to the pad or via do not need teardrops.',
                                ),
                              )}
                            </SizerItem>
                            <SizerItem flag={wxRIGHT | CV} border={5}>
                              <StaticText label="%" disabled={!p.m_tcHDRatio.enabled} />
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                        <SizerItem flag={wxTOP | wxBOTTOM | wxLEFT} border={2}>
                          <StaticText
                            label={_('(as a percentage of pad/via minor dimension)')}
                            disabled={!p.m_tcHDRatio.enabled}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
                <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={3}>
                  {/* bSizerShapeColumns */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={10}>
                      {/* bSizerLeftCol */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem proportion={1} flag={wxALIGN_CENTER_HORIZONTAL | RL} border={5}>
                          <StaticBitmap bitmap={p.m_bitmapTeardrop} />
                        </SizerItem>
                        <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                          {/* bSizer41 */}
                          <BoxSizer orient={wxHORIZONTAL} />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <Spacer width={25} height={0} flag={wxEXPAND} border={5} />
                    <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
                      {/* bSizer121 */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
                          {/* fgSizerRightCol = wxFlexGridSizer( 0, 3, 5, 0 ) */}
                          <FlexGridSizer cols={3} vgap={5} hgap={0} growableCols={[1]}>
                            <SizerItem flag={CV} border={5}>
                              {label(p.m_tcLenPercent)}
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | RL | CV} border={5}>
                              {entry(p.m_tcLenPercent)}
                            </SizerItem>
                            <SizerItem flag={CV} border={5}>
                              {percentOf(p.m_tcLenPercent.enabled)}
                            </SizerItem>
                            <SizerItem flag={CV} border={5}>
                              {label(p.m_tcTdMaxLen)}
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | CV | RL} border={5}>
                              {entry(p.m_tcTdMaxLen)}
                            </SizerItem>
                            <SizerItem flag={CV | wxRIGHT} border={5}>
                              <StaticText
                                label={p.m_tcTdMaxLen.units}
                                disabled={!p.m_tcTdMaxLen.enabled}
                              />
                            </SizerItem>
                            <Spacer
                              width={0}
                              height={5}
                              proportion={1}
                              flag={wxEXPAND}
                              border={5}
                            />
                            <Spacer
                              width={0}
                              height={0}
                              proportion={1}
                              flag={wxEXPAND}
                              border={5}
                            />
                            <Spacer
                              width={0}
                              height={0}
                              proportion={1}
                              flag={wxEXPAND}
                              border={5}
                            />
                            <SizerItem flag={CV} border={10}>
                              {label(p.m_tcHeightPercent)}
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | RL | CV} border={5}>
                              {entry(p.m_tcHeightPercent)}
                            </SizerItem>
                            <SizerItem flag={CV} border={5}>
                              {percentOf(p.m_tcHeightPercent.enabled)}
                            </SizerItem>
                            <SizerItem flag={CV} border={10}>
                              {label(p.m_tcMaxHeight)}
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | CV | RL} border={5}>
                              {entry(p.m_tcMaxHeight)}
                            </SizerItem>
                            <SizerItem flag={CV | wxRIGHT} border={5}>
                              <StaticText
                                label={p.m_tcMaxHeight.units}
                                disabled={!p.m_tcMaxHeight.enabled}
                              />
                            </SizerItem>
                          </FlexGridSizer>
                        </SizerItem>
                        <Spacer width={0} height={8} flag={wxEXPAND} border={5} />
                        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT} border={3}>
                          {/* bSizer44 */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
                              <TriStateCheck label={_('Curved edges')} check={p.m_curvedEdges} />
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
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
