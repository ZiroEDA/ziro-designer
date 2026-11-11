// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_CLEANUP_TRACKS_AND_VIAS_BASE` (pcbnew/dialogs/dialog_cleanup_tracks_and_vias_base.cpp):
 * the sizer tree, Add() for Add(). The members are props; the behaviour is
 * DIALOG_CLEANUP_TRACKS_AND_VIAS's (dialog_cleanup_tracks_and_vias.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { RC_TREE_MODEL, RC_TREE_NODE, RC_TREE_VIEW_STATE } from '@ziroeda/common/rc_item.js';
import { type NetInfoList, NetSelector } from '@ziroeda/common/widgets/net_selector.js';
import { RcTreeView } from '@ziroeda/common/widgets/rc_tree_view.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_RIGHT,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { Simplebook } from '@ziroeda/wx/simplebook.js';
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

export interface DIALOG_CLEANUP_TRACKS_AND_VIAS_BASE_PROPS {
  m_cbRefillZones: CHECK;
  m_cleanShortCircuitOpt: CHECK;
  m_cleanViasOpt: CHECK;
  m_deleteDanglingViasOpt: CHECK;
  m_mergeSegmOpt: CHECK;
  m_deleteUnconnectedOpt: CHECK;
  m_deleteTracksInPadsOpt: CHECK;
  m_netFilterOpt: CHECK;
  /** `m_netFilter`, a NET_SELECTOR over the board's NETINFO_LIST. */
  m_netFilter: { netInfo: NetInfoList; netcode: number; onChange: (aNetcode: number) => void };
  m_netclassFilterOpt: CHECK;
  m_netclassFilterChoices: readonly string[];
  m_netclassFilter: CHOICE;
  m_layerFilterOpt: CHECK;
  /** `m_layerFilter`, a PCB_LAYER_BOX_SELECTOR. */
  m_layerFilter: {
    rows: readonly ComboOption[];
    value: string;
    onChange: (aLayer: string) => void;
  };
  m_selectedItemsFilter: CHECK;
  /** `m_outputBook`: 0 m_changesPanel, 1 m_runningPanel. */
  m_outputBook: number;
  m_changesTreeModel: RC_TREE_MODEL;
  m_changesView: RC_TREE_VIEW_STATE;
  OnSelectItem: (aNode: RC_TREE_NODE) => void;
  /** `m_tcReport`'s text. */
  m_tcReport: string;
  okLabel: string;
  okEnabled: boolean;
  onOK: () => void;
  onCancel: () => void;
}

const RL = wxRIGHT | wxLEFT;

export function DIALOG_CLEANUP_TRACKS_AND_VIAS_BASE(
  p: DIALOG_CLEANUP_TRACKS_AND_VIAS_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title="Cleanup Tracks & Vias" onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | RL} border={5}>
              <StaticBoxSizer label={_('Actions')} orient={wxVERTICAL}>
                <SizerItem flag={RL} border={5}>
                  <CheckBox
                    label={_('Refill zones before and after cleanup')}
                    check={p.m_cbRefillZones}
                  />
                </SizerItem>
                <Spacer width={0} height={12} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={RL} border={5}>
                  <CheckBox
                    label={_('Delete tracks connecting different nets')}
                    check={p.m_cleanShortCircuitOpt}
                    title={_(
                      'remove track segments connecting nodes belonging to different nets (short circuit)',
                    )}
                  />
                </SizerItem>
                <Spacer width={0} height={10} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={RL} border={5}>
                  <CheckBox
                    label={_('Delete redundant vias')}
                    check={p.m_cleanViasOpt}
                    title={_('remove vias on through hole pads and superimposed vias')}
                  />
                </SizerItem>
                <SizerItem flag={wxTOP | RL} border={5}>
                  <CheckBox
                    label={_('Delete vias connected on only one layer')}
                    check={p.m_deleteDanglingViasOpt}
                  />
                </SizerItem>
                <Spacer width={0} height={10} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={RL} border={5}>
                  <CheckBox
                    label={_HKI('Merge co-linear tracks')}
                    check={p.m_mergeSegmOpt}
                    title={_('merge aligned track segments, and remove null segments')}
                  />
                </SizerItem>
                <SizerItem flag={wxTOP | RL} border={5}>
                  <CheckBox
                    label={_('Delete tracks unconnected at one end')}
                    check={p.m_deleteUnconnectedOpt}
                    title={_('delete tracks having at least one dangling end')}
                  />
                </SizerItem>
                <SizerItem flag={wxALL} border={5}>
                  <CheckBox
                    label={_('Delete tracks fully inside pads')}
                    check={p.m_deleteTracksInPadsOpt}
                    title={_(
                      'Delete tracks that have both start and end positions inside of a pad',
                    )}
                  />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | RL} border={5}>
              <StaticBoxSizer label={_('Filter Items')} orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                  {/* fgSizer3 = wxFlexGridSizer( 0, 2, 3, 0 ) */}
                  <FlexGridSizer cols={2} vgap={3} hgap={0} growableCols={[1]}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | RL} border={5}>
                      <CheckBox label={_('Filter items by net:')} check={p.m_netFilterOpt} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
                      <NetSelector
                        netInfo={p.m_netFilter.netInfo}
                        netcode={p.m_netFilter.netcode}
                        onChange={p.m_netFilter.onChange}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | RL} border={5}>
                      <CheckBox
                        label={_('Filter items by net class:')}
                        check={p.m_netclassFilterOpt}
                      />
                    </SizerItem>
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT}
                      border={5}
                      minSize={[140, -1]}
                    >
                      <Choice
                        choices={p.m_netclassFilterChoices}
                        choice={p.m_netclassFilter}
                        ariaLabel="Net class filter"
                      />
                    </SizerItem>
                    <Spacer width={0} height={7} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | RL} border={5}>
                      <CheckBox label={_('Filter items by layer:')} check={p.m_layerFilterOpt} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                      <Combo
                        value={p.m_layerFilter.value}
                        options={p.m_layerFilter.rows}
                        onChange={p.m_layerFilter.onChange}
                        ariaLabel="Layer filter"
                      />
                    </SizerItem>
                    <Spacer width={0} height={7} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                  </FlexGridSizer>
                </SizerItem>
                <Spacer width={0} height={5} border={5} />
                <SizerItem flag={wxALL} border={5}>
                  <CheckBox label={_('Selected items only')} check={p.m_selectedItemsFilter} />
                </SizerItem>
                <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} minSize={[660, 250]}>
          {/* bLowerSizer, SetMinSize( wxSize( 660,250 ) ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              <Simplebook
                selection={p.m_outputBook}
                pages={[
                  // m_changesPanel: changesSizer
                  <BoxSizer key="changes" orient={wxVERTICAL}>
                    <SizerItem flag={wxTOP | RL} border={5}>
                      <StaticText label={_('Changes to be applied:')} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | wxTOP | RL} border={5}>
                      <RcTreeView
                        model={p.m_changesTreeModel}
                        view={p.m_changesView}
                        onSelect={p.OnSelectItem}
                        testId="cleanup-changes"
                      />
                    </SizerItem>
                  </BoxSizer>,
                  // m_runningPanel: progressSizer
                  <BoxSizer key="running" orient={wxVERTICAL}>
                    <SizerItem flag={wxALL} border={5}>
                      <StaticText label={_('Progress:')} />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | RL} border={3}>
                      <TextCtrl value={p.m_tcReport} multiLine readOnly ariaLabel="Progress" />
                    </SizerItem>
                  </BoxSizer>,
                ]}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT | wxALIGN_RIGHT} border={5}>
          <StdDialogButtonSizer
            okLabel={p.okLabel}
            okDisabled={!p.okEnabled}
            onOk={p.onOK}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
